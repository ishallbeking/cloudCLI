// Apply readable server additions to this binary-only CloudCLI distribution.
import fs from 'node:fs/promises';
import { installMessageOrderServer } from './install-message-order-server.mjs';
import { installApproveForMeServer } from './install-approve-for-me-server.mjs';
import { installCompressedHistoryServer } from './install-compressed-history-server.mjs';
import { installConversationNavigation } from './install-conversation-navigation.mjs';
import { installContextUsageServer } from './install-context-usage-server.mjs';
import { installFileCopyServer } from './install-file-copy-server.mjs';
const root = new URL('../package/', import.meta.url);
const relative = 'server/modules/providers/list/codex/';
for (const name of ['codex-rpc.js', 'codex-async-questions.js', 'codex-question.routes.js', 'codex-interactive-runtime.js', 'codex-rollout-files.js', 'codex-history-synchronizer.js', 'codex-session-synchronizer.provider.js']) {
  await fs.copyFile(new URL(relative + name, root), new URL('dist-server/' + relative + name, root));
}
const runtime = new URL('dist-server/' + relative + 'codex-runtime.provider.js', root);
await fs.writeFile(runtime, "// Interactive transport shares the daemon owning terminal and browser threads.\nexport { codexInteractiveRuntime as codexRuntime } from './codex-interactive-runtime.js';\n");
async function patch(relativePath, before, after) {
  const file = new URL('dist-server/' + relativePath, root);
  let code = await fs.readFile(file, 'utf8');
  if (code.includes(after)) return;
  if (code.split(before).length !== 2) throw new Error(`Upstream changed: ${relativePath}: ${before.slice(0, 60)}`);
  await fs.writeFile(file, code.replace(before, after));
}
await patch('server/modules/providers/provider.routes.js', "import express from 'express';", "import express from 'express';\nimport { codexQuestionRouter } from './list/codex/codex-question.routes.js';");
await patch('server/modules/providers/provider.routes.js', 'const router = express.Router();', 'const router = express.Router();\nrouter.use(codexQuestionRouter);');
await patch(relative + 'codex-sessions.provider.js', "const item = readObjectRecord(payload.item);\n                if (item?.type === 'UserMessage')", `const item = readObjectRecord(payload.item);
                if (item?.type === 'AgentMessage' && Array.isArray(item.questions) && item.questions.length) {
                    const existing = messages.find(row => row.toolCallId === item.id);
                    const codexQuestions = { requestId: item.id, questions: item.questions };
                    if (existing) existing.codexQuestions = codexQuestions;
                    else messages.push({ type: 'tool_use', timestamp, toolName: 'request_user_input_async',
                        toolCallId: item.id, toolInput: { questions: item.questions }, codexQuestions });
                }
                if (item?.type === 'UserMessage')`);
if (!(await fs.readFile(new URL('dist-server/' + relative + 'codex-sessions.provider.js', root), 'utf8')).includes('const baseId = raw.itemId || raw.uuid ||')) {
  await patch(relative + 'codex-sessions.provider.js', "const ts = raw.timestamp || new Date().toISOString();\n        const baseId = raw.uuid || generateMessageId('codex');\n        if (raw.type === 'status_note'", "const ts = raw.timestamp || new Date().toISOString();\n        const baseId = raw.itemId || raw.uuid || generateMessageId('codex');\n        if (raw.type === 'status_note'");
}
await patch(relative + 'codex-sessions.provider.js', '                    content,\n                    memoryCitations: raw.memoryCitations,', '                    content,\n                    codexQuestions: raw.codexQuestions || (raw.questions?.length ? { requestId: raw.itemId || baseId, questions: raw.questions } : undefined),\n                    memoryCitations: raw.memoryCitations,');
await patch(relative + 'codex-sessions.provider.js', '                    toolInput: raw.toolInput,\n                    toolId:', '                    toolInput: raw.toolInput,\n                    codexQuestions: raw.codexQuestions,\n                    toolId:');
console.log('Codex interactive server installed');
// Keep transport tests aligned with the active implementation rather than the
// former SDK exec mocks. Original upstream files are retained in patches/.
const tests = await fs.readFile(new URL('../design/test-codex-questions.mjs', import.meta.url), 'utf8');
await fs.writeFile(new URL('dist-server/server/modules/providers/tests/codex-runtime.test.js', root), tests.replaceAll('../package/dist-server/server/', '../../../'));
await fs.writeFile(new URL('server/modules/providers/tests/codex-runtime.test.ts', root),
  '// @ts-nocheck -- Executable JavaScript compatibility tests for the binary distribution.\n' + tests.replaceAll('../package/dist-server/server/', '@/'));

await installMessageOrderServer();
await installApproveForMeServer();
await installCompressedHistoryServer();

await installConversationNavigation();
await installContextUsageServer();
await installFileCopyServer();
