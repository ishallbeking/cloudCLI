import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createCommandsRouter } from '../commands.routes.js';
/**
 * Stands in for `providerModelsService`. `resolveSessionModel` mirrors the real
 * precedence closely enough for the command handlers: a model recorded for the
 * session wins, otherwise the client's requested model, otherwise the catalog
 * default.
 */
function createModelsService(sessionModels = {}) {
    return {
        getProviderModels: async () => ({
            OPTIONS: [{ value: 'default', label: 'Default' }],
            DEFAULT: 'default',
        }),
        getCurrentActiveModel: async () => ({ model: 'default' }),
        setSessionModel: () => null,
        resolveSessionModel: async (provider, options = {}) => {
            const recorded = options.sessionId ? sessionModels[options.sessionId] : undefined;
            const model = recorded || options.requestedModel || 'default';
            return {
                provider,
                sessionId: options.sessionId ?? null,
                model,
                source: model === 'default' ? 'default' : 'session',
            };
        },
        resolveResumeModel: async () => undefined,
    };
}
async function executeCommand(commandName, context, sessionModels = {}) {
    const router = createCommandsRouter({
        fileSystem: {
            readFile: async () => JSON.stringify({ name: 'claude-code-ui', version: '0.0.0-test' }),
        },
        homeDirectory: () => '/home/test',
        appRoot: '/app',
        models: createModelsService(sessionModels),
        runtime: {
            uptime: () => 0,
            memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
            version: 'v22', platform: 'linux', pid: 1,
        },
    });
    const app = express().use(express.json()).use('/api/commands', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/commands/execute`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ commandName, context }),
        });
        assert.equal(response.status, 200);
        return await response.json();
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
test('models command returns models only for the active provider using injected catalog', async () => {
    const result = await executeCommand('/models', { provider: 'codex' });
    const data = result.data;
    assert.deepEqual(Object.keys(data.available), ['codex']);
});
test('models command falls back to claude for unsupported providers', async () => {
    const result = await executeCommand('/models', { provider: 'unknown-provider' });
    const data = result.data;
    assert.equal(data.current.provider, 'claude');
});
test('models command reports the model recorded for the session', async () => {
    const result = await executeCommand('/models', { provider: 'claude', sessionId: 'session-1', model: 'sonnet' }, { 'session-1': 'haiku' });
    const data = result.data;
    assert.equal(data.current.model, 'haiku');
});
test('models command reports the composer model for a chat with no session yet', async () => {
    const result = await executeCommand('/models', { provider: 'claude', model: 'haiku' });
    const data = result.data;
    assert.equal(data.current.model, 'haiku');
});
test('cost and status commands report the same resolved model as /models', async () => {
    const context = { provider: 'claude', sessionId: 'session-1', model: 'sonnet' };
    const sessionModels = { 'session-1': 'haiku' };
    const cost = await executeCommand('/cost', context, sessionModels);
    const status = await executeCommand('/status', context, sessionModels);
    assert.equal(cost.data.model, 'haiku');
    assert.equal(status.data.model, 'haiku');
});
test('cost forwards optional cache, reasoning and last-request measurements without double counting', async () => {
    const usage = { used: 1200, total: 200000, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, reasoningTokens: 120, lastUsage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheCreationTokens: 0 } };
    const result = await executeCommand('/cost', { provider: 'codex', model: 'default', tokenUsage: usage });
    const data = result.data;
    assert.deepEqual(data.tokenUsage, usage);
    assert.deepEqual(data.tokenBreakdown, { input: 1000, output: 200 });
});
