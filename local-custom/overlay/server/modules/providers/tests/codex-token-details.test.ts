import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCodexUsageDetails } from '../list/codex/codex-token-details.js';
import { createProviderTokenUsageService } from '../services/provider-token-usage.service.js';

test('Codex snake and camel counters retain zero but omit missing/invalid details', () => {
  const expected = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0, reasoningTokens: 12 };
  assert.deepEqual(readCodexUsageDetails({ input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, cache_write_input_tokens: 0, reasoning_output_tokens: 12 }), expected);
  assert.deepEqual(readCodexUsageDetails({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, cacheWriteInputTokens: 0, reasoningOutputTokens: 12 }), expected);
  assert.deepEqual(readCodexUsageDetails({ cached_input_tokens: null, reasoning_output_tokens: -1 }), {});
  assert.deepEqual(readCodexUsageDetails({ cached_input_tokens: Infinity, output_tokens: '20' }), {});
});

test('usage API preserves cumulative and latest details without counting cached/reasoning twice', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'token-details-'));
  const file = path.join(directory, 'rollout.jsonl');
  const cumulative = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 200, reasoning_output_tokens: 120, total_tokens: 1200 };
  const last = { input_tokens: 100, cached_input_tokens: 80, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 12, total_tokens: 120 };
  try {
    await writeFile(file, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: cumulative, last_token_usage: last, model_context_window: 200000 } } }));
    const service = createProviderTokenUsageService({ getSessionById: () => ({ provider: 'codex', provider_session_id: 'fixture', jsonl_path: file }) as never });
    const result = await service.getSessionTokenUsage('fixture');
    assert.equal(result.used, 1200); assert.equal(result.contextUsed, 120);
    assert.equal(result.cacheReadTokens, 800); assert.equal(result.reasoningTokens, 120);
    assert.equal(result.cacheCreationTokens, undefined);
    assert.deepEqual(result.lastUsage, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0, reasoningTokens: 12 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
