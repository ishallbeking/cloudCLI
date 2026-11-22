import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { initializeDatabase, closeConnection, sessionsDb } from './../../database/index.js';
import { createSessionGroupsRouter } from '../session-groups.routes.js';
test('authenticated account registration, login and group ownership work end to end', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-accounts-'));
    const previous = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, 'auth.db');
    await writeFile(process.env.DATABASE_PATH, '');
    await initializeDatabase();
    const { authRoutes, authenticateToken } = await import('./../../auth/index.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api/providers', authenticateToken, createSessionGroupsRouter());
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: { message: error.message, code: error.code } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (suffix, method = 'GET', body, token) => {
        const response = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: response.status, data: await response.json() };
    };
    try {
        assert.equal((await request('/auth/accounts', 'POST', { username: 'intruder', password: 'secret12' })).status, 401);
        const alice = await request('/auth/register', 'POST', { username: 'alice', password: 'secret12' });
        assert.equal(alice.status, 200);
        const a = alice.data.token;
        const created = await request('/auth/accounts', 'POST', { username: ' bob ', password: 'secret34' }, a);
        assert.equal(created.status, 201);
        assert.equal(created.data.user.username, 'bob');
        assert.equal(created.data.token, undefined);
        assert.equal((await request('/auth/user', 'GET', undefined, a)).data.user.username, 'alice');
        assert.equal((await request('/auth/register', 'POST', { username: 'outsider', password: 'secret12' })).status, 403);
        assert.equal((await request('/auth/accounts', 'POST', { username: 'bob', password: 'secret34' }, a)).status, 409);
        assert.equal((await request('/auth/accounts', 'POST', { username: 'bad', password: 'short' }, a)).status, 400);
        assert.equal((await request('/auth/accounts', 'POST', undefined, a)).status, 400);
        assert.equal((await request('/auth/login', 'POST', { username: 'bob', password: 'wrong' })).status, 401);
        const bob = await request('/auth/login', 'POST', { username: 'bob', password: 'secret34' });
        assert.equal(bob.status, 200);
        const b = bob.data.token;
        assert.notEqual(bob.data.user.id, alice.data.user.id);
        const groupA = (await request('/providers/session-groups', 'POST', { name: '我的组' }, a)).data.data;
        assert.deepEqual((await request('/providers/session-groups', 'GET', undefined, b)).data.data.groups, []);
        const groupB = (await request('/providers/session-groups', 'POST', { name: '我的组' }, b)).data.data;
        assert.notEqual(groupA.id, groupB.id);
        sessionsDb.createAppSession('accounts-session-a', 'codex', '/tmp/account-alpha', 'Alpha');
        sessionsDb.createAppSession('accounts-session-b', 'claude', '/tmp/account-beta', 'Beta');
        assert.equal((await request('/providers/session-groups/' + groupA.id + '/sessions', 'POST', { sessionIds: ['accounts-session-a', 'accounts-session-b'] }, a)).status, 200);
        for (const [suffix, method, body] of [[groupA.id, 'PATCH', { name: 'stolen' }], [groupA.id, 'DELETE', undefined], [groupA.id + '/sessions', 'POST', { sessionIds: ['accounts-session-a'] }], [groupA.id + '/sessions/accounts-session-a', 'DELETE', undefined]]) {
            assert.equal((await request('/providers/session-groups/' + suffix, method, body, b)).status, 404);
        }
        const ownA = (await request('/providers/session-groups', 'GET', undefined, a)).data.data.groups;
        const ownB = (await request('/providers/session-groups', 'GET', undefined, b)).data.data.groups;
        assert.equal(ownA.length, 1);
        assert.equal(ownA[0].sessions.length, 2);
        assert.equal(ownB.length, 1);
        assert.equal(ownB[0].sessions.length, 0);
        assert.equal((await request('/auth/logout', 'POST', {}, b)).status, 200);
        const relogin = await request('/auth/login', 'POST', { username: 'bob', password: 'secret34' });
        assert.equal((await request('/providers/session-groups', 'GET', undefined, relogin.data.token)).data.data.groups[0].id, groupB.id);
        const refreshed = await request('/auth/refresh', 'POST', {}, b);
        assert.equal((await request('/auth/user', 'GET', undefined, refreshed.data.token)).data.user.username, 'bob');
        const concurrent = await Promise.all(['charlie', 'david'].map(username => request('/auth/accounts', 'POST', { username, password: 'secret56' }, a)));
        assert.deepEqual(concurrent.map(response => response.status), [201, 201]);
        closeConnection();
        assert.equal((await request('/providers/session-groups', 'GET', undefined, a)).data.data.groups[0].id, groupA.id);
    }
    finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        closeConnection();
        if (previous === undefined)
            delete process.env.DATABASE_PATH;
        else
            process.env.DATABASE_PATH = previous;
        await rm(dir, { recursive: true, force: true });
    }
});
