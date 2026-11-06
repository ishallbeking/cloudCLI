import path from 'node:path';
import { AppError } from '../../shared/utils.js';

const fail = (message, statusCode = 400) => new AppError(message, {statusCode, code: 'FILE_TREE_COPY_ERROR'});
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

/** @param {import('../../shared/types.js').FileTreeServiceDependencies} dependencies */
export function createFileTreeCopier({fileSystem: fs, projects, workspace, logger}) {
  return async function copyEntry({projectId, sourceProjectId = projectId, sourcePath, targetPath = ''}) {
    const sourceProject = await projects.getProjectPathById(sourceProjectId);
    const targetProject = await projects.getProjectPathById(projectId);
    if (!sourceProject || !targetProject) throw fail('项目不存在', 404);
    const sourceRoot = await fs.realpath(sourceProject);
    const targetRoot = await fs.realpath(targetProject);
    const source = path.resolve(sourceRoot, sourcePath);
    const target = path.resolve(targetRoot, targetPath || '.');
    if (!inside(sourceRoot, source) || source === sourceRoot || !inside(targetRoot, target)) {
      throw fail('复制和粘贴的路径必须位于对应项目内', 403);
    }
    const sourceReal = await fs.realpath(source);
    const targetReal = await fs.realpath(target);
    if (!inside(sourceRoot, sourceReal) || !inside(targetRoot, targetReal)) {
      throw fail('不能通过符号链接访问项目外的内容', 403);
    }
    const policy = await workspace.validatePath(targetReal);
    if (!policy.valid) throw fail(policy.error || '目标目录不可写', 403);
    if (!(await fs.stat(targetReal)).isDirectory()) throw fail('粘贴目标必须是文件夹');
    const sourceStat = await fs.lstat(source);
    if (sourceStat.isDirectory() && inside(sourceReal, targetReal)) throw fail('不能将文件夹粘贴到自身或其子目录');

    // Validate the entire tree before creating anything. Never follow symlinks,
    // special files, or traverse beyond the source project's real root.
    const entries = [];
    async function scan(candidate, relative) {
      if (entries.length >= 10000) throw fail('复制内容超过 10,000 项，请选择更小的文件夹');
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw fail('暂不支持复制含符号链接的内容，请选择普通文件或文件夹');
      if (!inside(sourceRoot, await fs.realpath(candidate))) throw fail('源文件超出项目范围', 403);
      const directory = stat.isDirectory();
      if (!directory && (stat.mode & 0o170000) !== 0o100000) throw fail('只能复制普通文件或文件夹');
      entries.push({source: candidate, relative, directory});
      if (directory) for await (const entry of fs.openDirectory(candidate)) {
        await scan(path.join(candidate, entry.name), path.join(relative, entry.name));
      }
    }
    await scan(source, '');
    const name = path.basename(source);
    const extension = sourceStat.isDirectory() ? '' : path.extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    let destination;
    for (let index = 0; index < 10000; index++) {
      const candidateName = index === 0 ? name : `${stem} (副本${index === 1 ? '' : ' ' + index})${extension}`;
      const candidate = path.join(targetReal, candidateName);
      try {
        // Both operations claim the destination exclusively; a concurrent copy
        // cannot overwrite any existing entry or follow a destination symlink.
        if (sourceStat.isDirectory()) await fs.makeDirectory(candidate, false);
        else await fs.copyFile(source, candidate, true);
        destination = candidate;
        break;
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
    }
    if (!destination) throw fail('同名副本过多，请整理目标文件夹', 409);
    try {
      for (const entry of entries.slice(1)) {
        // Recheck before each operation in case the source changed after scan.
        const stat = await fs.lstat(entry.source);
        if (stat.isSymbolicLink() || !inside(sourceRoot, await fs.realpath(entry.source))) throw fail('源文件在复制期间发生变化');
        const destinationEntry = path.join(destination, entry.relative);
        if (entry.directory) await fs.makeDirectory(destinationEntry, false);
        else await fs.copyFile(entry.source, destinationEntry, true);
      }
    } catch (error) {
      try {
        if (sourceStat.isDirectory()) await fs.removeDirectory(destination);
        else await fs.unlink(destination);
      } catch (cleanupError) { logger.error('Unable to remove incomplete file copy', cleanupError); }
      throw error;
    }
    return {success: true, path: destination, name: path.basename(destination), type: sourceStat.isDirectory() ? 'directory' : 'file'};
  };
}
