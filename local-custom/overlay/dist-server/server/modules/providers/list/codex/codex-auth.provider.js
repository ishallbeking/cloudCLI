import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { probeCliVersion, readObjectRecord, readOptionalString } from '../../../../shared/utils.js';
export class CodexProviderAuth {
    /**
     * Checks whether the Codex CLI that chats run is available, and which version
     * it is. That is the `@openai/codex` package CloudCLI depends on, which
     * `@openai/codex-sdk` resolves from node_modules, not a `codex` on PATH.
     */
    checkInstalled() {
        if (process.env.CODEX_CLI_PATH) {
            return probeCliVersion(process.env.CODEX_CLI_PATH, ['--version']);
        }
        let launcherPath;
        try {
            launcherPath = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
        }
        catch {
            return { installed: false, exitCode: null, version: null };
        }
        return probeCliVersion(process.execPath, [launcherPath, '--version']);
    }
    /**
     * Returns Codex SDK availability and credential status.
     */
    async getStatus() {
        const { installed, version: installedVersion } = this.checkInstalled();
        const credentials = await this.checkCredentials();
        return {
            installed,
            provider: 'codex',
            installedVersion,
            authenticated: credentials.authenticated,
            email: credentials.email,
            method: credentials.method,
            error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
        };
    }
    /**
     * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
     */
    async checkCredentials() {
        try {
            const authPath = path.join(os.homedir(), '.codex', 'auth.json');
            const content = await readFile(authPath, 'utf8');
            const auth = readObjectRecord(JSON.parse(content)) ?? {};
            const tokens = readObjectRecord(auth.tokens) ?? {};
            const idToken = readOptionalString(tokens.id_token);
            const accessToken = readOptionalString(tokens.access_token);
            if (idToken || accessToken) {
                return {
                    authenticated: true,
                    email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
                    method: 'credentials_file',
                };
            }
            if (readOptionalString(auth.OPENAI_API_KEY)) {
                return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
            }
            return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
        }
        catch (error) {
            const code = error.code;
            return {
                authenticated: false,
                email: null,
                method: null,
                error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
            };
        }
    }
    /**
     * Extracts the user email from a Codex id_token when a readable JWT payload exists.
     */
    readEmailFromIdToken(idToken) {
        try {
            const parts = idToken.split('.');
            if (parts.length >= 2) {
                const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
                return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
            }
        }
        catch {
            // Fall back to a generic authenticated marker if the token payload is not readable.
        }
        return 'Authenticated';
    }
}
//# sourceMappingURL=codex-auth.provider.js.map