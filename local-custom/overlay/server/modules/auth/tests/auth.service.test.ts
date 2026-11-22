import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createAuthService } from '../auth.service.js';

type AuthDependencies = Parameters<typeof createAuthService>[0];

function createDependencies(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    users: {
      completeOnboarding: () => undefined,
      hasUsers: () => false,
      createUser: (username, passwordHash) => ({ id: 1, username, password_hash: passwordHash }),
      getUserByUsername: () => undefined,
      updateLastLogin: () => undefined,
    },
    transaction: {
      begin: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    },
    hashPassword: async () => 'hashed-password',
    comparePassword: async () => false,
    generateToken: () => 'signed-token',
    ...overrides,
  };
}

test('register hashes credentials and commits through injected dependencies', async () => {
  const operations: string[] = [];
  const service = createAuthService(createDependencies({
    transaction: {
      begin: () => operations.push('begin'),
      commit: () => operations.push('commit'),
      rollback: () => operations.push('rollback'),
    },
    hashPassword: async (password) => {
      operations.push(`hash:${password}`);
      return 'hash';
    },
    users: {
      completeOnboarding: () => undefined,
      hasUsers: () => false,
      createUser: (username, passwordHash) => {
        operations.push(`create:${username}:${passwordHash}`);
        return { id: 1, username, password_hash: passwordHash };
      },
      getUserByUsername: () => undefined,
      updateLastLogin: (userId) => operations.push(`login:${userId}`),
    },
  }));

  const result = await service.register('alice', 'secret12');

  assert.equal(result.token, 'signed-token');
  assert.deepEqual(operations, ['hash:secret12', 'begin', 'create:alice:hash', 'commit', 'login:1']);
});

test('login rejects an invalid password without issuing a token', async () => {
  let tokenIssued = false;
  const service = createAuthService(createDependencies({
    users: {
      completeOnboarding: () => undefined,
      hasUsers: () => true,
      createUser: () => { throw new Error('unused'); },
      getUserByUsername: () => ({ id: 1, username: 'alice', password_hash: 'hash' }),
      updateLastLogin: () => undefined,
    },
    comparePassword: async () => false,
    generateToken: () => {
      tokenIssued = true;
      return 'token';
    },
  }));

  await assert.rejects(
    service.login('alice', 'wrong-password'),
    (error: unknown) => error instanceof AppError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.equal(tokenIssued, false);
});

test('refreshSession issues a replacement token for the authenticated user', () => {
  let tokenUser: { id: number | bigint; username: string } | undefined;
  const service = createAuthService(createDependencies({
    generateToken: (user) => {
      tokenUser = user;
      return 'replacement-token';
    },
  }));

  const result = service.refreshSession({ id: 7, username: 'alice' });

  assert.deepEqual(result, { token: 'replacement-token' });
  assert.deepEqual(tokenUser, { id: 7, username: 'alice' });
});


test('additional accounts preserve the caller session and return no token', async () => {
  let issued = false;
  const dependencies = createDependencies({generateToken: () => { issued = true; return 'token'; }});
  dependencies.users.hasUsers = () => true;
  const result = await createAuthService(dependencies).createAccount(' bob ', 'secret12');
  assert.deepEqual(result, {success: true, user: {id: 1, username: 'bob'}});
  assert.equal(issued, false);
});

test('public signup remains first-user only, including concurrent setup requests', async () => {
  let exists = false;
  const dependencies = createDependencies();
  dependencies.users.hasUsers = () => exists;
  dependencies.users.createUser = username => {exists = true; return {id: 1, username};};
  const service = createAuthService(dependencies);
  const results = await Promise.allSettled([service.register('alice','secret12'),service.register('other','secret12')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && rejected.reason.code, 'AUTH_USER_ALREADY_CONFIGURED');
  await assert.rejects(service.register('third', 'secret12'), {statusCode: 403});
});

test('duplicate accounts roll back; credentials are validated before hashing', async () => {
  let hashes = 0, rollbacks = 0;
  const dependencies = createDependencies({hashPassword: async () => {hashes++; return 'hash';}});
  dependencies.users.createUser = () => {throw Object.assign(new Error('duplicate'), {code:'SQLITE_CONSTRAINT_UNIQUE'});};
  dependencies.transaction.rollback = () => {rollbacks++;};
  const service = createAuthService(dependencies);
  for (const [username,password] of [['  ', 'secret12'],['ab','secret12'],['alice','short'],['a'.repeat(129),'secret12'],['alice','密'.repeat(25)]]) {
    await assert.rejects(service.createAccount(username,password),{statusCode:400});
  }
  assert.equal(hashes, 0);
  await assert.rejects(service.createAccount('alice','secret12'),{statusCode:409,code:'AUTH_USERNAME_CONFLICT'});
  assert.equal(rollbacks,1);
});
