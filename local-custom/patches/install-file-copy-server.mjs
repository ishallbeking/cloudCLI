import fs from 'node:fs/promises';
const root = new URL('../package/', import.meta.url);
export async function installFileCopyServer() {
  async function patch(file, before, after) {
    const url = new URL(file, root);
    const code = await fs.readFile(url, 'utf8');
    if (code.includes(after)) return;
    if (code.split(before).length !== 2) throw new Error(`File copy upstream changed: ${file}: ${before.slice(0, 70)}`);
    const backup = new URL('./backups-file-copy/' + file, import.meta.url);
    await fs.mkdir(new URL('.', backup), {recursive: true});
    try { await fs.writeFile(backup, code, {flag: 'wx'}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await fs.writeFile(url, code.replace(before, after));
  }
  for (const tree of ['server/', 'dist-server/server/']) {
    const extension = tree === 'server/' ? 'ts' : 'js';
    const prefix = tree + 'modules/file-tree/';
    await patch(prefix + `file-tree.service.${extension}`, "import path from 'node:path';", "import path from 'node:path';\nimport { createFileTreeCopier } from './file-tree-copy.js';");
    await patch(prefix + `file-tree.service.${extension}`, 'return {\n' + (extension === 'ts' ? '    ' : '        ') + 'async browseWorkspace(inputPath)',
      'return {\n' + (extension === 'ts' ? '    ' : '        ') + 'copyEntry: createFileTreeCopier(dependencies),\n' + (extension === 'ts' ? '    ' : '        ') + 'async browseWorkspace(inputPath)');
    await patch(prefix + `file-tree.module.${extension}`,
      'copyFile: (sourcePath, destinationPath) => fsPromises.copyFile(sourcePath, destinationPath),',
      'copyFile: (sourcePath, destinationPath, exclusive = false) => fsPromises.copyFile(sourcePath, destinationPath, exclusive ? fs.constants.COPYFILE_EXCL : 0),');
    const indent = extension === 'ts' ? '  ' : '    ';
    const anchor = indent + "router.post('/projects/:projectId/files/create',";
    const route = `${indent}router.post('/projects/:projectId/files/copy', createRouteHandler(async (request, response) => {
${indent}  const body = readBody(request);
${indent}  response.json(await services.copyEntry({
${indent}    projectId: readProjectId(request),
${indent}    sourceProjectId: readRequiredString(body.sourceProjectId, 'sourceProjectId'),
${indent}    sourcePath: readRequiredString(body.sourcePath, 'sourcePath'),
${indent}    targetPath: readOptionalString(body.targetPath) ?? '',
${indent}  }));
${indent}}, logger));

`;
    await patch(prefix + `file-tree.routes.${extension}`, anchor, route + anchor);
  }
  await patch('server/shared/types.ts', 'copyFile(sourcePath: string, destinationPath: string): Promise<void>;', 'copyFile(sourcePath: string, destinationPath: string, exclusive?: boolean): Promise<void>;');
  await patch('server/shared/types.ts', 'export type FileTreeServices = {', `export type FileTreeServices = {
  copyEntry(input: { projectId: string; sourceProjectId: string; sourcePath: string; targetPath: string }): Promise<{
    success: boolean; path: string; name: string; type: string;
  }>;`);
  await fs.copyFile(new URL('server/modules/file-tree/file-tree-copy.js', root), new URL('dist-server/server/modules/file-tree/file-tree-copy.js', root));
  console.log('Project file/folder copy installed');
}
if (process.argv[1] === new URL(import.meta.url).pathname) await installFileCopyServer();
