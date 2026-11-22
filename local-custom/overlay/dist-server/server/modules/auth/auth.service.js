import { AppError } from './../../shared/utils.js';
function numericUserId(userId) {
    return Number(userId);
}
function isUniqueConstraintError(error) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}
/**
 * Creates the Auth application service around explicit persistence, crypto,
 * transaction, and token dependencies.
 */
export function createAuthService(dependencies) {
    // Password hashing is asynchronous. Keep it outside the shared SQLite
    // transaction so other requests cannot join or commit an unfinished signup.
    async function createAccount(usernameInput, passwordInput, initialSetup) {
        const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
        const password = typeof passwordInput === 'string' ? passwordInput : '';
        if (!username || !password) {
            throw new AppError('Username and password are required', {
                code: 'AUTH_CREDENTIALS_REQUIRED', statusCode: 400,
            });
        }
        if (username.length < 3 || password.length < 6) {
            throw new AppError('Username must be at least 3 characters, password at least 6 characters', {
                code: 'AUTH_CREDENTIALS_TOO_SHORT', statusCode: 400,
            });
        }
        if (username.length > 128 || Buffer.byteLength(password, 'utf8') > 72) {
            throw new AppError('Username must be at most 128 characters, password at most 72 UTF-8 bytes', {
                code: 'AUTH_CREDENTIALS_TOO_LONG', statusCode: 400,
            });
        }
        const assertSetupAvailable = () => {
            if (initialSetup && dependencies.users.hasUsers()) {
                throw new AppError('Please sign in and create additional accounts in Settings > Account.', {
                    code: 'AUTH_USER_ALREADY_CONFIGURED', statusCode: 403,
                });
            }
        };
        assertSetupAvailable();
        const passwordHash = await dependencies.hashPassword(password);
        dependencies.transaction.begin();
        try {
            // Check again after hashing: only one concurrent first-user request wins.
            assertSetupAvailable();
            const created = dependencies.users.createUser(username, passwordHash);
            const user = { id: numericUserId(created.id), username: created.username };
            // Settings-created accounts use an already configured installation. Do
            // not prompt each new account to reconfigure the shared CLI/Git setup.
            if (!initialSetup)
                dependencies.users.completeOnboarding(user.id);
            const token = initialSetup ? dependencies.generateToken(user) : undefined;
            dependencies.transaction.commit();
            return { user, token };
        }
        catch (error) {
            dependencies.transaction.rollback();
            if (isUniqueConstraintError(error)) {
                throw new AppError('Username already exists', {
                    code: 'AUTH_USERNAME_CONFLICT', statusCode: 409,
                });
            }
            throw error;
        }
    }
    return {
        getStatus() {
            return { needsSetup: !dependencies.users.hasUsers(), isAuthenticated: false };
        },
        async register(usernameInput, passwordInput) {
            const result = await createAccount(usernameInput, passwordInput, true);
            dependencies.users.updateLastLogin(result.user.id);
            return { success: true, ...result };
        },
        // Additional accounts are created through an authenticated route. Creating
        // one never replaces the caller's login or grants access to their groups.
        async createAccount(usernameInput, passwordInput) {
            const { user } = await createAccount(usernameInput, passwordInput, false);
            return { success: true, user };
        },
        async login(usernameInput, passwordInput) {
            const username = typeof usernameInput === 'string' ? usernameInput.trim() : '';
            const password = typeof passwordInput === 'string' ? passwordInput : '';
            if (!username || !password) {
                throw new AppError('Username and password are required', {
                    code: 'AUTH_CREDENTIALS_REQUIRED',
                    statusCode: 400,
                });
            }
            const user = dependencies.users.getUserByUsername(username);
            const validPassword = user
                ? await dependencies.comparePassword(password, user.password_hash)
                : false;
            if (!user || !validPassword) {
                throw new AppError('Invalid username or password', {
                    code: 'AUTH_INVALID_CREDENTIALS',
                    statusCode: 401,
                });
            }
            dependencies.users.updateLastLogin(numericUserId(user.id));
            return {
                success: true,
                user: { id: user.id, username: user.username },
                token: dependencies.generateToken(user),
            };
        },
        getCurrentUser(user) {
            return { user };
        },
        refreshSession(user) {
            if (typeof user !== 'object'
                || user === null
                || !('id' in user)
                || !('username' in user)
                || (typeof user.id !== 'number' && typeof user.id !== 'bigint')
                || typeof user.username !== 'string') {
                throw new AppError('Authenticated user is required', {
                    code: 'AUTH_USER_REQUIRED',
                    statusCode: 401,
                });
            }
            return { token: dependencies.generateToken(user) };
        },
        logout() {
            return { success: true, message: 'Logged out successfully' };
        },
    };
}
