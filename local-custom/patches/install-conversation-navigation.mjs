import fs from 'node:fs/promises';
const root = new URL('../package/', import.meta.url);
export async function installConversationNavigation() {
  for (const relative of ['server/modules/providers/services/conversation-navigation.js', 'server/modules/providers/conversation-navigation.routes.js']) {
    await fs.copyFile(new URL(relative, root), new URL('dist-server/' + relative, root));
  }
  for (const relative of ['server/modules/providers/provider.routes.ts', 'dist-server/server/modules/providers/provider.routes.js']) {
    const path = new URL(relative, root);
    let code = await fs.readFile(path, 'utf8');
    if (!code.includes("import { conversationNavigationRouter }")) {
      const anchor = "import { codexQuestionRouter } from './list/codex/codex-question.routes.js';";
      if (code.split(anchor).length !== 2) throw new Error('Navigation router import anchor changed');
      code = code.replace(anchor, anchor + "\nimport { conversationNavigationRouter } from './conversation-navigation.routes.js';");
    }
    if (!code.includes('router.use(conversationNavigationRouter);')) {
      if (code.split('router.use(codexQuestionRouter);').length !== 2) throw new Error('Navigation router mount changed');
      code = code.replace('router.use(codexQuestionRouter);', 'router.use(codexQuestionRouter);\nrouter.use(conversationNavigationRouter);');
    }
    await fs.writeFile(path, code);
  }
  console.log('Conversation navigation server installed');
}
if (process.argv[1] === new URL(import.meta.url).pathname) await installConversationNavigation();
