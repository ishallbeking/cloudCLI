import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { codexAppServer, type CodexCliModel } from './codex-app-server.client.js';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderModelOption,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** Curated Codex catalog shipped as immutable CloudCLI defaults. */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-sol',
      label: 'GPT-6 Sol',
      description: 'Workhorse model for coding and everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      description: 'Fast and affordable model for easier tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

// The live CLI catalog is cached briefly; config and binary changes invalidate it.
const CATALOG_TTL_MS = 30_000;

async function readCodexConfig() {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const raw = await readFile(path.join(home, 'config.toml'), 'utf8');
    const parsed = readObjectRecord(TOML.parse(raw)) ?? {};
    const profiles = readObjectRecord(parsed.profiles);
    const profileName = readOptionalString(parsed.profile);
    const profile = profileName ? readObjectRecord(profiles?.[profileName]) : null;
    const config = { ...parsed, ...profile };
    return {
      raw,
      model: readOptionalString(config.model),
      effort: readOptionalString(config.model_reasoning_effort),
    };
  } catch {
    return { raw: '', model: undefined, effort: undefined };
  }
}

function cliModelOption(model: CodexCliModel): ProviderModelOption {
  const values = (model.supportedReasoningEfforts ?? []).map((effort) => ({
    value: effort.reasoningEffort,
    description: effort.description,
  }));
  return {
    value: model.model || model.id,
    label: model.displayName || model.model || model.id,
    description: model.description,
    ...(values.length ? { effort: { default: model.defaultReasoningEffort, values } } : {}),
  };
}

/** Use the same CLI binary and model/list catalog as terminal Codex. */
export class CodexProviderModels implements IProviderModels {
  private cached: { key: string; expires: number; catalog: ProviderModelsDefinition } | undefined;
  private pending: { key: string; promise: Promise<ProviderModelsDefinition> } | undefined;

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const config = await readCodexConfig();
    const cli = process.env.CODEX_CLI_PATH || '';
    const binary = cli ? await stat(cli).catch(() => null) : null;
    const key = JSON.stringify([config.raw, process.env.CODEX_HOME, cli, binary?.mtimeMs, binary?.ino]);
    if (this.cached?.key === key && this.cached.expires > Date.now()) return this.cached.catalog;
    if (this.pending?.key === key) return this.pending.promise;

    const promise = (async () => {
      let options: ProviderModelOption[];
      let cliDefault: string | undefined;
      let discovered = false;
      try {
        const models = await codexAppServer.listModels();
        options = models.map(cliModelOption);
        cliDefault = models.find((model) => model.isDefault)?.model;
        discovered = true;
      } catch {
        // Keep the picker usable if the CLI is unavailable; retry on the next read.
        options = CODEX_PREDEFINED_MODELS.OPTIONS.map((option) => ({ ...option }));
      }

      if (config.model) {
        const active = options.find((option) => option.value === config.model);
        if (active) {
          if (config.effort && active.effort?.values.some(({ value }) => value === config.effort)) {
            active.effort = { ...active.effort, default: config.effort };
          }
        } else {
          // Custom provider ids remain selectable, without inventing their capabilities.
          options.unshift({
            value: config.model,
            label: config.model,
            description: 'Model configured in the Codex CLI.',
            ...(config.effort ? {
              effort: { default: config.effort, values: [{ value: config.effort }] },
            } : {}),
          });
        }
      }
      const catalog = {
        OPTIONS: options,
        DEFAULT: config.model || cliDefault || CODEX_PREDEFINED_MODELS.DEFAULT,
      };
      if (discovered) this.cached = { key, expires: Date.now() + CATALOG_TTL_MS, catalog };
      return catalog;
    })();
    this.pending = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.pending?.promise === promise) this.pending = undefined;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const config = await readCodexConfig();
    return config.model
      ? { model: config.model }
      : buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
