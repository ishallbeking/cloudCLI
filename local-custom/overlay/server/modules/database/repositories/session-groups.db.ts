import { getConnection } from '../connection.js';

// Initialize once per connection; reopening a test/database gets its own schema.
const initialized = new WeakSet<object>();
function connection() {
  const db = getConnection();
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_groups (
        group_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        name TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS session_group_members (
        group_id TEXT NOT NULL, session_id TEXT NOT NULL, added_at TEXT NOT NULL,
        PRIMARY KEY(group_id, session_id),
        FOREIGN KEY(group_id) REFERENCES session_groups(group_id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS session_group_members_session ON session_group_members(session_id);
      CREATE TRIGGER IF NOT EXISTS session_group_member_cleanup AFTER DELETE ON sessions
      BEGIN DELETE FROM session_group_members WHERE session_id = OLD.session_id; END;
    `);
    initialized.add(db);
  }
  return db;
}

const sessionColumns = `s.session_id AS sessionId, s.provider,
  COALESCE(NULLIF(TRIM(s.custom_name), ''), s.session_id) AS sessionTitle,
  p.project_id AS projectId, s.project_path AS projectPath,
  p.custom_project_name AS projectName,
  COALESCE(s.updated_at, s.created_at) AS lastActivity`;
const visible = `s.isArchived = 0 AND COALESCE(p.isArchived, 0) = 0`;
type SessionRecord = {sessionId: string; provider: string; sessionTitle: string;
  projectId: string | null; projectPath: string | null; projectName: string | null; lastActivity: string | null};

/** Used by Providers to persist user-owned groups independently of project boundaries. */
export const sessionGroupsDb = {
  list(userId: number) {
    return connection().prepare('SELECT group_id AS id, name, created_at AS createdAt FROM session_groups WHERE user_id = ? ORDER BY created_at, group_id')
      .all(userId) as Array<{id: string; name: string; createdAt: string}>;
  },
  get(userId: number, id: string) {
    return connection().prepare('SELECT group_id AS id, name FROM session_groups WHERE user_id = ? AND group_id = ?')
      .get(userId, id) as {id: string; name: string} | undefined;
  },
  create(userId: number, id: string, name: string) {
    connection().prepare('INSERT INTO session_groups(group_id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(id, userId, name, new Date().toISOString());
  },
  rename(userId: number, id: string, name: string) {
    return connection().prepare('UPDATE session_groups SET name = ? WHERE user_id = ? AND group_id = ?').run(name, userId, id).changes;
  },
  remove(userId: number, id: string) {
    const db = connection();
    db.transaction(() => {
      if (!this.get(userId, id)) return;
      db.prepare('DELETE FROM session_group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM session_groups WHERE user_id = ? AND group_id = ?').run(userId, id);
    })();
  },
  members(userId: number) {
    return connection().prepare(`SELECT m.group_id AS groupId, ${sessionColumns}
      FROM session_group_members m JOIN session_groups g ON g.group_id = m.group_id
      JOIN sessions s ON s.session_id = m.session_id LEFT JOIN projects p ON p.project_path = s.project_path
      WHERE g.user_id = ? AND ${visible}
      ORDER BY julianday(COALESCE(s.updated_at, s.created_at)) DESC, s.session_id`)
      .all(userId) as Array<SessionRecord & {groupId: string}>;
  },
  add(userId: number, id: string, sessionIds: string[]) {
    const db = connection();
    return db.transaction(() => {
      if (!this.get(userId, id)) return false;
      // Validate the entire batch before inserting anything. Duplicates are idempotent.
      const exists = db.prepare('SELECT 1 FROM sessions WHERE session_id = ?');
      if (sessionIds.some(sessionId => !exists.get(sessionId))) return false;
      const add = db.prepare('INSERT OR IGNORE INTO session_group_members(group_id, session_id, added_at) VALUES (?, ?, ?)');
      for (const sessionId of sessionIds) add.run(id, sessionId, new Date().toISOString());
      return true;
    })();
  },
  removeMember(userId: number, id: string, sessionId: string) {
    connection().prepare(`DELETE FROM session_group_members WHERE group_id = ? AND session_id = ?
      AND EXISTS (SELECT 1 FROM session_groups WHERE group_id = ? AND user_id = ?)`).run(id, sessionId, id, userId);
  },
  candidates(query: string, limit: number, offset: number) {
    const db = connection();
    // instr treats %, _ and quotes as literal search text, not SQL patterns.
    const where = `${visible} AND (? = '' OR instr(lower(COALESCE(s.custom_name, '') || ' ' || s.session_id || ' ' || COALESCE(s.project_path, '') || ' ' || COALESCE(p.custom_project_name, '')), lower(?)) > 0)`;
    const rows = db.prepare(`SELECT ${sessionColumns} FROM sessions s LEFT JOIN projects p ON p.project_path = s.project_path
      WHERE ${where} ORDER BY julianday(COALESCE(s.updated_at, s.created_at)) DESC, s.session_id LIMIT ? OFFSET ?`)
      .all(query, query, limit, offset) as SessionRecord[];
    const {total} = db.prepare(`SELECT COUNT(*) AS total FROM sessions s LEFT JOIN projects p ON p.project_path = s.project_path WHERE ${where}`)
      .get(query, query) as {total: number};
    return {rows, total};
  },
};
