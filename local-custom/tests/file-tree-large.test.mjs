import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createFileTreeService } from '../package/dist-server/server/modules/file-tree/file-tree.service.js';
import { createFileTreeRouter } from '../package/dist-server/server/modules/file-tree/file-tree.routes.js';
import express from '../package/node_modules/express/index.js';
import { once } from 'node:events';

function fixture({ largeDirectory = false, gitignore = '' } = {}) {
  const root = '/test/project';
  const listings = new Map();
  const directories = new Set([root]);
  const reads = [];
  const entry = (name, directory) => ({ name, isDirectory: () => directory });
  const children = [];
  for (let index = 0; index < (largeDirectory ? 10001 : 101); index++) {
    const name = largeDirectory ? `file-${index}.txt` : `run-${index}`;
    children.push(entry(name, !largeDirectory));
    if (!largeDirectory) {
      directories.add(`${root}/${name}`);
      listings.set(`${root}/${name}`, Array.from({ length: 101 }, (_, i) => entry(`result-${i}.dat`, false)));
    }
  }
  listings.set(root, children);
  const stats = candidate => ({
    size: 0, mtime: new Date(0), mode: 0o755,
    isDirectory: () => directories.has(candidate), isSymbolicLink: () => false,
  });
  const service = createFileTreeService({
    fileSystemConcurrency: 4,
    fileSystem: {
      access: async () => {},
      stat: async candidate => stats(candidate),
      lstat: async candidate => stats(candidate),
      realpath: async candidate => candidate === root + '/escape' ? '/outside' : candidate,
      readTextFile: async () => gitignore,
      openDirectory: async function* (candidate) {
        reads.push(candidate);
        yield* listings.get(candidate) ?? [];
      },
    },
    projects: { getProjectPathById: async () => root },
    workspace: { rootPath: root },
    logger: { error: () => {} },
    resolveMimeType: () => 'text/plain',
  });
  return { service, root, reads, listings, entry };
}

test('oversized recursive tree falls back to complete root listing and loads a child independently', async () => {
  const { service, root } = fixture();
  await assert.rejects(service.listProjectFiles('id'), error => error.code === 'FILE_TREE_TOO_LARGE');
  const tree = await service.listProjectFiles('id', { allowShallowFallback: true });
  assert.equal(tree.length, 101);
  assert.ok(tree.every(item => item.childrenLoaded === false && item.children === undefined));
  const files = await service.listProjectFiles('id', { directory: root + '/run-37', shallow: true });
  assert.equal(files.length, 101);
  assert.ok(files.every(item => item.path.startsWith(root + '/run-37/') && item.type === 'file'));
});

test('shallow listing never traverses descendants and applies root gitignore rules', async () => {
  const { service, root, reads, listings, entry } = fixture({ gitignore: 'run-0/\nrun-1/result-0.dat' });
  listings.get(root + '/run-1').push(entry('node_modules', true));
  const tree = await service.listProjectFiles('id', { shallow: true, respectGitignore: true });
  assert.equal(tree.length, 100);
  assert.deepEqual(reads, [root]);
  const files = await service.listProjectFiles('id', { directory: 'run-1', shallow: true, respectGitignore: true });
  assert.equal(files.length, 100);
  assert.ok(files.every(item => item.name !== 'result-0.dat' && item.name !== 'node_modules'));
});

test('directory listing rejects traversal, outside absolute paths, symlink escapes, and files', async () => {
  const { service, root } = fixture();
  for (const directory of ['../outside', '/outside', root + '/escape']) {
    await assert.rejects(service.listProjectFiles('id', { directory, shallow: true }), error => error.statusCode === 403);
  }
  await assert.rejects(service.listProjectFiles('id', { directory: 'run-0/result-0.dat', shallow: true }), error => error.statusCode === 400);
  for (const directory of ['.', root]) {
    assert.equal((await service.listProjectFiles('id', { directory, shallow: true })).length, 101);
  }
});

test('explicit complete listing keeps the cap so folder downloads cannot silently omit descendants', async () => {
  const { service } = fixture();
  await assert.rejects(service.listProjectFiles('id', { allowShallowFallback: false }), error => error.code === 'FILE_TREE_TOO_LARGE');
});

test('a single oversized directory still stops at the entry budget', async () => {
  const { service } = fixture({ largeDirectory: true });
  await assert.rejects(service.listProjectFiles('id', { shallow: true }), error => error.code === 'FILE_TREE_TOO_LARGE');
});

test('HTTP route forwards shallow directory loads and keeps complete downloads strict', async () => {
  const calls = [];
  const app = express();
  app.use(createFileTreeRouter({ listProjectFiles: async (...args) => { calls.push(args); return []; } },
    (_req, _res, next) => next(), {}, { error: () => {} }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/projects/id/files`;
  try {
    const url = new URL(base);
    url.search = new URLSearchParams({ directory: '/project/a b', shallow: 'true', respectGitignore: 'true' });
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(base + '?directory=runs&complete=true')).status, 200);
    assert.deepEqual(calls, [
      ['id', { directory: '/project/a b', shallow: true, respectGitignore: true, allowShallowFallback: true }],
      ['id', { directory: 'runs', shallow: false, respectGitignore: false, allowShallowFallback: false }],
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
