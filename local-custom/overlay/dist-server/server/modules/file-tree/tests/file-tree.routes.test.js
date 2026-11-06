import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createFileTreeRouter } from '../../../modules/file-tree/file-tree.routes.js';
function createFakeServices(overrides = {}) {
    const unexpectedOperation = async () => {
        throw new Error('Unexpected File Tree service call');
    };
    return {
        browseWorkspace: unexpectedOperation,
        createWorkspaceFolder: unexpectedOperation,
        readTextFile: unexpectedOperation,
        openFile: unexpectedOperation,
        saveTextFile: unexpectedOperation,
        listProjectFiles: unexpectedOperation,
        createEntry: unexpectedOperation,
        renameEntry: unexpectedOperation,
        deleteEntry: unexpectedOperation,
        storeUploadedFiles: unexpectedOperation,
        ...overrides,
    };
}
const passUploadRequest = (_request, _response, next) => next();
async function withFileTreeServer(services, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/file-tree', createFileTreeRouter(services, passUploadRequest, { maximumFileSizeMegabytes: 200, maximumFileCount: 20 }, { error: () => undefined }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        await run(`http://127.0.0.1:${address.port}`);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}
test('project files route uses the File Tree API namespace and forwards the project id', async () => {
    const inputs = [];
    const services = createFakeServices({
        listProjectFiles: async (...input) => {
            inputs.push(input);
            return [];
        },
    });
    await withFileTreeServer(services, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), []);
    });
    assert.deepEqual(inputs, [['project-1', { respectGitignore: false, directory: null, shallow: false, allowShallowFallback: true }]]);
});
test('project files route requests gitignore filtering when explicitly enabled', async () => {
    const inputs = [];
    const services = createFakeServices({
        listProjectFiles: async (...input) => {
            inputs.push(input);
            return [];
        },
    });
    await withFileTreeServer(services, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files?respectGitignore=true`);
        assert.equal(response.status, 200);
    });
    assert.deepEqual(inputs, [['project-1', { respectGitignore: true, directory: null, shallow: false, allowShallowFallback: true }]]);
});
test('create route parses the transport payload before invoking the service', async () => {
    const inputs = [];
    const services = createFakeServices({
        createEntry: async (input) => {
            inputs.push(input);
            return {
                success: true,
                path: '/workspace/project/src/example.ts',
                name: input.name,
                type: input.type,
                message: 'File created successfully',
            };
        },
    });
    await withFileTreeServer(services, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                path: '/workspace/project/src',
                type: 'file',
                name: 'example.ts',
            }),
        });
        assert.equal(response.status, 200);
    });
    assert.deepEqual(inputs, [{
            projectId: 'project-1',
            parentPath: '/workspace/project/src',
            type: 'file',
            name: 'example.ts',
        }]);
});
test('create route rejects invalid entry types without calling the service', async () => {
    let createCalled = false;
    const services = createFakeServices({
        createEntry: async () => {
            createCalled = true;
            throw new Error('createEntry should not run for invalid input');
        },
    });
    await withFileTreeServer(services, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/file-tree/projects/project-1/files/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'link', name: 'example' }),
        });
        const payload = await response.json();
        assert.equal(response.status, 400);
        assert.equal(payload.error, 'Type must be "file" or "directory"');
    });
    assert.equal(createCalled, false);
});
//# sourceMappingURL=file-tree.routes.test.js.map
