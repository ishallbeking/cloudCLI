export { initializeDatabase } from './init-db.js';
export { closeConnection, getConnection, getDatabasePath } from './connection.js';
export { apiKeysDb } from './repositories/api-keys.js';
export { appConfigDb } from './repositories/app-config.js';
export { credentialsDb } from './repositories/credentials.js';
export { githubTokensDb } from './repositories/github-tokens.js';
export { notificationChannelEndpointsDb } from './repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from './repositories/notification-preferences.js';
// providerModelsDb: used by Providers to persist user-managed custom model rows.
export { providerModelsDb } from './repositories/provider-models.js';
// projectsDb: used by Projects, Worktrees, Git, WebSocket, and notification modules to persist and resolve project records.
export { projectsDb } from './repositories/projects.db.js';
export { pushSubscriptionsDb } from './repositories/push-subscriptions.js';
export { scanStateDb } from './repositories/scan-state.db.js';
// sessionDraftsDb: used by User for drafts and Scheduled Messages for server-owned queued turns.
export { sessionDraftsDb } from './repositories/session-drafts.db.js';
export { sessionsDb } from './repositories/sessions.db.js';
export { userDb } from './repositories/users.js';
// userPreferencesDb: used by the User module to persist the settings that used to live in browser localStorage.
export { userPreferencesDb } from './repositories/user-preferences.db.js';
export { vapidKeysDb } from './repositories/vapid-keys.js';
export { scheduledMessagesDb } from './repositories/scheduled-messages.db.js';
// sessionGroupsDb: used by Providers for cross-project conversation groups.
export { sessionGroupsDb } from './repositories/session-groups.db.js';
