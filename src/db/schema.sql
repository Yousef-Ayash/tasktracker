-- Task Tracker — baseline schema.
-- Applied automatically on boot (see db/index.js). Safe to re-run.

CREATE TABLE IF NOT EXISTS roles (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);
INSERT OR IGNORE INTO roles (id, name) VALUES (1, 'admin'), (2, 'manager'), (3, 'user');

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT UNIQUE NOT NULL,
  password     TEXT NOT NULL,                 -- bcrypt hash
  role_id      INTEGER NOT NULL REFERENCES roles(id),
  manager_id   INTEGER REFERENCES users(id),  -- reports-to link; the whole hierarchy hangs off this
  last_seen_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);

CREATE TABLE IF NOT EXISTS tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','done','cancelled')),
  created_by       INTEGER NOT NULL REFERENCES users(id),
  parent_task      INTEGER REFERENCES tasks(id),
  expected_done_at TEXT,
  deleted_at       TEXT,  -- soft delete; never hard-delete (would orphan notes/activity_log)
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_parent     ON tasks(parent_task);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);

-- Multi-assignee: several people can share one task, any of them can
-- mark it done. This replaces a single assigned_to column on tasks.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  task       INTEGER NOT NULL REFERENCES tasks(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_task ON notes(task);

-- Full audit trail. Every action, by everyone, kept indefinitely.
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id),  -- null = system-generated (e.g. scheduler)
  action      TEXT NOT NULL,                 -- 'task.created', 'task.status_changed', ...
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  details     TEXT,                          -- JSON blob, e.g. {"from":"pending","to":"done"}
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

-- User-facing subset of the above: only what a specific person needs to
-- be told about, with read/unread state. Separate from activity_log so
-- it can be pruned without losing the audit history.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,   -- 'task_assigned' | 'due_soon' | 'overdue' | 'note_added'
  task_id    INTEGER REFERENCES tasks(id),
  message    TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
