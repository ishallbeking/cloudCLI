import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codexAppServer } from '../package/dist-server/server/modules/providers/list/codex/codex-app-server.client.js';
import { CodexProviderModels } from '../package/dist-server/server/modules/providers/list/codex/codex-models.provider.js';

const nativeModels = [
  {
    id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol',
    description: 'CLI catalog', isDefault: true,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: ['low', 'high', 'ultra'].map(reasoningEffort => ({ reasoningEffort })),
  },
  {
    id: 'gpt-6-luna', model: 'gpt-6-luna', displayName: 'GPT-6-Luna',
    description: 'CLI catalog', isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'max'].map(reasoningEffort => ({ reasoningEffort })),
  },
];

async function fixture(t, config) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'webui-model-sync-'));
  const oldHome = process.env.CODEX_HOME;
  const oldList = codexAppServer.listModels;
  process.env.CODEX_HOME = home;
  codexAppServer.listModels = async () => nativeModels;
  await writeFile(path.join(home, 'config.toml'), config);
  t.after(async () => {
    if (oldHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldHome;
    codexAppServer.listModels = oldList;
    await rm(home, { recursive: true, force: true });
  });
  return { home, adapter: new CodexProviderModels() };
}

test('uses the CLI catalog, preserves its order/capabilities, and follows configured defaults', async t => {
  const { adapter } = await fixture(t, 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\n');
  const catalog = await adapter.getSupportedModels();
  assert.equal(catalog.DEFAULT, 'gpt-6.1-sol');
  assert.deepEqual(catalog.OPTIONS.map(m => m.value), nativeModels.map(m => m.model));
  assert.equal(catalog.OPTIONS[0].label, 'GPT-6.1-Sol');
  assert.equal(catalog.OPTIONS[0].effort.default, 'high');
  assert.deepEqual(catalog.OPTIONS[1].effort.values.map(v => v.value), ['low', 'medium', 'high', 'max']);
  assert.deepEqual(await adapter.getCurrentActiveModel(), { model: 'gpt-6.1-sol' });
});

test('shares concurrent discovery and invalidates its cache immediately when config changes', async t => {
  const { home, adapter } = await fixture(t, 'model = "gpt-6.1-sol"\n');
  let calls = 0;
  codexAppServer.listModels = async () => { calls++; return nativeModels; };
  await Promise.all([adapter.getSupportedModels(), adapter.getSupportedModels()]);
  assert.equal(calls, 1);
  await writeFile(path.join(home, 'config.toml'), 'model = "gpt-6-luna"\nmodel_reasoning_effort = "max"\n');
  const updated = await adapter.getSupportedModels();
  assert.equal(updated.DEFAULT, 'gpt-6-luna');
  assert.equal(updated.OPTIONS[1].effort.default, 'max');
  assert.equal(calls, 2);
});

test('retains custom configured models without inventing supported effort levels', async t => {
  const { adapter } = await fixture(t, 'model = "gateway-model"\nmodel_reasoning_effort = "high"\n');
  const catalog = await adapter.getSupportedModels();
  assert.equal(catalog.DEFAULT, 'gateway-model');
  assert.deepEqual(catalog.OPTIONS[0].effort.values, [{ value: 'high' }]);
  assert.equal(catalog.OPTIONS.filter(m => m.value === 'gateway-model').length, 1);
});

test('recovers after CLI discovery fails rather than caching the fallback', async t => {
  const { adapter } = await fixture(t, 'model = "gateway-model"\n');
  codexAppServer.listModels = async () => { throw new Error('CLI temporarily unavailable'); };
  const fallback = await adapter.getSupportedModels();
  assert.equal(fallback.DEFAULT, 'gateway-model');
  assert.equal(fallback.OPTIONS[0].effort, undefined);
  codexAppServer.listModels = async () => nativeModels;
  const recovered = await adapter.getSupportedModels();
  assert.deepEqual(recovered.OPTIONS.map(m => m.value), ['gateway-model', ...nativeModels.map(m => m.model)]);
});

test('honors the active CLI profile and handles malformed config', async t => {
  const { home, adapter } = await fixture(t,
    'model = "gpt-6.1-sol"\nprofile = "daily"\n[profiles.daily]\nmodel = "gpt-6-luna"\n');
  assert.equal((await adapter.getSupportedModels()).DEFAULT, 'gpt-6-luna');
  await writeFile(path.join(home, 'config.toml'), 'model = [broken');
  assert.equal((await adapter.getSupportedModels()).DEFAULT, 'gpt-6.1-sol');
});
