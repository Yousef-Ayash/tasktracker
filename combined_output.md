# Combined Directory/Project Files

## `.env.example`

```
# Copy this to .env and fill in real values before running.

# --- Server ---
PORT=3000
NODE_ENV=production

# --- Database & session ---
# Paths are relative to the project root (or /app inside the container).
DB_PATH=./data/tasktracker.db
SESSION_KEY_PATH=./data/session-key

# --- First-run admin account ---
# Only used once, when the users table is empty. Change the password
# after first login; there's no self-registration in this app.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-now

# --- Push notifications (optional) ---
# Leave blank to disable push; in-app notifications still work either way.
# NTFY_URL=https://ntfy.yourdomain.com
# NTFY_TOPIC=tasktracker-alerts

```

## `package.json`

```json
{
  "name": "tasktracker",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "description": "Self-hosted hierarchical task tracker (Fastify + SQLite + HTMX).",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "@fastify/formbody": "^7.4.0",
    "@fastify/secure-session": "^7.5.1",
    "@fastify/static": "^7.0.4",
    "@fastify/view": "^9.1.0",
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^13.0.0",
    "dotenv": "^16.4.5",
    "ejs": "^3.1.10",
    "fastify": "^4.28.1",
    "sodium-native": "^4.1.1"
  }
}
```

## `README.md`

```markdown
# Task Tracker

Self-hosted task management for a team with a manager hierarchy. Node + Fastify + SQLite + HTMX. See `docs/overview.md` for the full idea, roles, and permission model.

## Status

Fully functional: auth, the permission hierarchy, tasks (create, status, due date, reassignment, soft-delete), notes, notifications (in-app + ntfy), the due-soon/overdue scheduler, and the HTMX-driven views are all built and have been exercised end-to-end over real HTTP requests.

Verified by `npm test` (`tests/permissions.test.js`, 11 passing): manager-of-report can act on logistics, unrelated users cannot, creators and assignees can always act on their own content/status, and the visibility SQL is scoped correctly per role.

Not yet done:
- PWA icons (`public/icons/` is empty — `manifest.json` references none yet)
- Service worker for push notifications / offline (ntfy handles delivery, but there's no `sw.js` yet to receive it inside the installed PWA)
- The Docker build hasn't been tested with a real Docker daemon (none available in the dev sandbox) — verify `docker compose up -d --build` on the actual Proxmox host
- Migration runner (see `src/db/migrations/README.md`) — not needed until the first real schema change after data exists

## Run it (Docker)

```bash
cp .env.example .env
# edit .env: set ADMIN_USERNAME / ADMIN_PASSWORD at minimum
docker compose up -d --build
curl http://localhost:3000/healthz
```

First boot seeds the admin account from `.env`. There's no public registration — every other account gets created by an admin once the Users page exists.

## Run it (without Docker, for local dev)

```bash
npm install
cp .env.example .env
npm run dev
```

## Project layout

```
src/
  server.js        Boot: plugins, session, DB, routes
  config.js         Reads .env once; nothing else touches process.env
  db/               schema.sql (current schema) + migrations/ (future changes)
  middleware/        auth.js (who are you) + permissions.js (what can you do)
  queries/           All SQL, kept out of route handlers
  routes/            Thin: validate input, check permission, call a query
  services/          Activity log, notifications (+ ntfy push), scheduler
  views/             EJS templates + HTMX partials
public/              CSS, vendored htmx.min.js, PWA manifest + icons
deploy/              Caddyfile example for the separate reverse-proxy host
docs/                overview.md — the idea, roles, and workflow, kept
                     separate from implementation detail
tests/               Permission-hierarchy tests — the part most worth
                     covering, since that's where subtle bugs hide
```

## Notes

- SQLite runs in WAL mode; the file and session key live in `./data`, bind-mounted into the container so rebuilding the image never touches data.
- Push notifications go through a self-hosted **ntfy** instance — set `NTFY_URL` / `NTFY_TOPIC` in `.env` once one exists. An optional ntfy service is sketched (commented out) in `docker-compose.yml`.
- This container exposes port 3000 directly; HTTPS and the friendly hostname are handled by a separate reverse-proxy host, not by this service.

```

## `tests/permissions.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  visibleTasksClause,
  canEditContent,
  canChangeStatus,
  canChangeLogistics,
} from '../src/middleware/permissions.js';

// In-memory DB seeded with the same schema, so canChangeLogistics (which
// looks up manager_id) behaves exactly as it does in production.
function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schemaPath = path.join(import.meta.dirname, '../src/db/schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (1, ?, ?, 1, NULL)').run('admin', 'x');
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (2, ?, ?, 2, NULL)').run('sara', 'x'); // manager
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (3, ?, ?, 3, 2)').run('ali', 'x');    // reports to sara
  db.prepare('INSERT INTO users (id, username, password, role_id, manager_id) VALUES (4, ?, ?, 3, NULL)').run('ben', 'x'); // no manager

  return db;
}

const admin = { id: 1, role: 'admin' };
const sara = { id: 2, role: 'manager' };
const ali = { id: 3, role: 'user' };
const ben = { id: 4, role: 'user' };

test('canChangeLogistics: manager can act on their report\'s task', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, sara, [ali.id], db), true);
});

test('canChangeLogistics: unrelated user cannot act on someone else\'s task', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, ben, [ali.id], db), false);
});

test('canChangeLogistics: creator always can, regardless of role', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, ali, [ali.id], db), true);
});

test('canChangeLogistics: admin always can', () => {
  const db = makeTestDb();
  const task = { id: 1, created_by: ali.id };
  assert.equal(canChangeLogistics(task, admin, [ali.id], db), true);
});

test('canChangeLogistics: manager of a DIFFERENT user cannot act on this task', () => {
  const db = makeTestDb();
  // ben has no manager, so sara should not be able to touch ben's task
  const task = { id: 1, created_by: ben.id };
  assert.equal(canChangeLogistics(task, sara, [ben.id], db), false);
});

test('canChangeStatus: any current assignee can change status', () => {
  const task = { id: 1, created_by: ben.id, status: 'pending' };
  assert.equal(canChangeStatus(task, ali, [ali.id, ben.id]), true);
});

test('canChangeStatus: a non-assignee, non-creator cannot change status', () => {
  const task = { id: 1, created_by: ben.id, status: 'pending' };
  const stranger = { id: 99, role: 'user' };
  assert.equal(canChangeStatus(task, stranger, [ali.id, ben.id]), false);
});

test('canEditContent: only the creator or admin', () => {
  const task = { id: 1, created_by: ali.id };
  assert.equal(canEditContent(task, ali), true);
  assert.equal(canEditContent(task, admin), true);
  assert.equal(canEditContent(task, sara), false); // manager, but not creator
});

test('visibleTasksClause: admin sees everything (no scoping filter)', () => {
  const { where, params } = visibleTasksClause(admin);
  assert.equal(where, 'deleted_at IS NULL');
  assert.deepEqual(params, []);
});

test('visibleTasksClause: manager clause includes reports-to check', () => {
  const { where, params } = visibleTasksClause(sara);
  assert.match(where, /manager_id = \?/);
  assert.deepEqual(params, [sara.id, sara.id, sara.id]);
});

test('visibleTasksClause: user clause has no reports-to check at all', () => {
  const { where, params } = visibleTasksClause(ali);
  assert.doesNotMatch(where, /manager_id/);
  assert.deepEqual(params, [ali.id, ali.id]);
});

```

## `src/server.js`

```javascript
import Fastify from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import view from '@fastify/view';
import ejs from 'ejs';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import secureSession from '@fastify/secure-session';
import sodium from 'sodium-native';

import { config } from './config.js';
import db from './db/index.js';

import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import userRoutes from './routes/users.js';
import notificationRoutes from './routes/notifications.js';
import { startScheduler } from './services/scheduler.js';
import { notify } from './services/notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: config.nodeEnv !== 'test' });

app.decorate('db', db);

await app.register(formbody);
await app.register(fastifyStatic, { root: path.join(__dirname, '../public') });
await app.register(view, {
  engine: { ejs },
  root: path.join(__dirname, 'views'),
});

// Session signing key: generated once and persisted to disk, so sessions
// survive a restart instead of logging everyone out on every deploy.
// @fastify/secure-session doesn't export a generateKey() function directly;
// this mirrors exactly what its own genkey CLI does under the hood.
fs.mkdirSync(path.dirname(config.sessionKeyPath), { recursive: true });
if (!fs.existsSync(config.sessionKeyPath)) {
  const key = Buffer.allocUnsafe(sodium.crypto_secretbox_KEYBYTES);
  sodium.randombytes_buf(key);
  fs.writeFileSync(config.sessionKeyPath, key);
}
await app.register(secureSession, {
  key: fs.readFileSync(config.sessionKeyPath),
  cookie: { path: '/', httpOnly: true, sameSite: 'lax' },
});

// Health check — used by Docker's healthcheck and handy for manual checks.
app.get('/healthz', async () => ({ status: 'ok' }));

await app.register(authRoutes);
await app.register(taskRoutes);
await app.register(userRoutes);
await app.register(notificationRoutes);
startScheduler(db, notify);

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

```

## `src/config.js`

```javascript
import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  dbPath: process.env.DB_PATH || './data/tasktracker.db',
  sessionKeyPath: process.env.SESSION_KEY_PATH || './data/session-key',

  adminUsername: process.env.ADMIN_USERNAME || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,

  ntfyUrl: process.env.NTFY_URL || null,
  ntfyTopic: process.env.NTFY_TOPIC || null,
};

```

## `src/views/tasks.ejs`

```
<%- include('partials/header', { user }) %>
<h1>Tasks</h1>

<details class="new-task">
  <summary>+ New task</summary>
  <form hx-post="/tasks" hx-target="#task-list" hx-swap="afterbegin"
        hx-on::after-request="if(event.detail.successful) this.reset()">
    <label>Name
      <input type="text" name="name" required>
    </label>
    <label>Description
      <textarea name="description" rows="2"></textarea>
    </label>
    <label>Due
      <input type="datetime-local" name="expected_done_at">
    </label>
    <label>Assign to
      <select name="assignees" multiple size="<%= Math.min(assignableUsers.length, 4) %>">
        <% assignableUsers.forEach(u => { %>
          <option value="<%= u.id %>" <%= u.id === user.id ? 'selected' : '' %>><%= u.username %></option>
        <% }) %>
      </select>
    </label>
    <button type="submit">Create task</button>
  </form>
</details>

<div id="detail-panel"></div>

<% if (tasks.length === 0) { %>
  <p class="empty-state">No tasks yet. Create one above to get started.</p>
<% } %>

<ul id="task-list" class="task-list">
  <% tasks.forEach(task => { %>
    <%- include('partials/task-row', { task, user }) %>
  <% }) %>
</ul>

<%- include('partials/footer') %>

```

## `src/views/users.ejs`

```
<%- include('partials/header', { user }) %>
<h1>Users</h1>

<details class="new-task">
  <summary>+ New user</summary>
  <form method="POST" action="/users">
    <label>Username
      <input type="text" name="username" required>
    </label>
    <label>Password
      <input type="password" name="password" required minlength="8">
    </label>
    <label>Role
      <select name="role">
        <option value="user">User</option>
        <option value="manager">Manager</option>
        <option value="admin">Admin</option>
      </select>
    </label>
    <label>Reports to
      <select name="manager_id">
        <option value="">— none —</option>
        <% managers.forEach(m => { %><option value="<%= m.id %>"><%= m.username %></option><% }) %>
      </select>
    </label>
    <button type="submit">Create user</button>
  </form>
</details>

<table>
  <thead><tr><th>Username</th><th>Role</th><th>Reports to</th></tr></thead>
  <tbody>
  <% users.forEach(u => { %>
    <tr>
      <td><%= u.username %></td>
      <td><%= u.role %></td>
      <td><%= u.manager_name || '—' %></td>
    </tr>
  <% }) %>
  </tbody>
</table>

<%- include('partials/footer') %>

```

## `src/views/login.ejs`

```
<%- include('partials/header', { user: null }) %>
<div class="login-card">
  <h1>Sign in</h1>
  <% if (error) { %><p class="error"><%= error %></p><% } %>
  <form method="POST" action="/login">
    <label>Username
      <input type="text" name="username" required autofocus autocomplete="username">
    </label>
    <label>Password
      <input type="password" name="password" required autocomplete="current-password">
    </label>
    <button type="submit">Sign in</button>
  </form>
</div>
<%- include('partials/footer') %>

```

## `src/views/partials/header.ejs`

```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Task Tracker</title>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#2F6F62">
  <script src="/js/htmx.min.js"></script>
</head>
<body>
<% if (typeof user !== 'undefined' && user) { %>
  <%- include('nav', { user }) %>
<% } %>
<main class="container">

```

## `src/views/partials/task-detail.ejs`

```
<div class="task-detail">
  <div class="task-detail-head">
    <h2><%= task.name %></h2>
    <button class="link-btn" onclick="document.getElementById('detail-panel').innerHTML=''">close</button>
  </div>
  <% if (task.description) { %><p><%= task.description %></p><% } %>
  <p class="task-meta">Status: <strong><%= task.status.replace('_', ' ') %></strong> ·
     Assigned to: <%= task.assignees.map(a => a.username).join(', ') || '—' %></p>

  <% if (canEditLogistics) { %>
    <form hx-post="/tasks/<%= task.id %>/due-date" hx-target="#detail-panel" hx-swap="innerHTML">
      <label>Due date
        <input type="datetime-local" name="expected_done_at"
               value="<%= task.expected_done_at ? task.expected_done_at.slice(0,16) : '' %>">
      </label>
      <button type="submit">Update due date</button>
    </form>

    <form hx-post="/tasks/<%= task.id %>/assignees" hx-target="#detail-panel" hx-swap="innerHTML">
      <label>Reassign
        <select name="assignees" multiple size="<%= Math.min(assignableUsers.length, 4) %>">
          <% assignableUsers.forEach(u => { %>
            <option value="<%= u.id %>" <%= task.assignees.some(a => a.id === u.id) ? 'selected' : '' %>>
              <%= u.username %>
            </option>
          <% }) %>
        </select>
      </label>
      <button type="submit">Save assignees</button>
    </form>

    <button
      class="danger-btn"
      hx-post="/tasks/<%= task.id %>/delete"
      hx-target="#task-<%= task.id %>"
      hx-swap="outerHTML"
      hx-confirm="Delete this task? This can't be undone from the UI.">
      Delete task
    </button>
  <% } %>

  <h3>Notes</h3>
  <div id="notes-list">
    <%- include('notes-list', { notes }) %>
  </div>
  <form hx-post="/tasks/<%= task.id %>/notes" hx-target="#notes-list" hx-swap="innerHTML"
        hx-on::after-request="if(event.detail.successful) this.reset()">
    <textarea name="text" rows="2" required placeholder="Add a note"></textarea>
    <button type="submit">Add note</button>
  </form>
</div>

```

## `src/views/partials/task-row.ejs`

```
<li id="task-<%= task.id %>" class="task-row status-<%= task.status %>">
  <div class="task-main" hx-get="/tasks/<%= task.id %>" hx-target="#detail-panel" hx-swap="innerHTML">
    <span class="task-name"><%= task.name %></span>
    <span class="task-assignees"><%= task.assignees.map(a => a.username).join(', ') %></span>
    <% if (task.expected_done_at) { %>
      <span class="task-due">due <%= task.expected_done_at.replace('T', ' ').slice(0, 16) %></span>
    <% } %>
  </div>
  <button
    class="status-btn"
    hx-post="/tasks/<%= task.id %>/status"
    hx-target="#task-<%= task.id %>"
    hx-swap="outerHTML">
    <%= task.status.replace('_', ' ') %>
  </button>
</li>

```

## `src/views/partials/footer.ejs`

```

</main>
</body>
</html>

```

## `src/views/partials/notifications.ejs`

```
🔔<% if (notifs.length) { %> <span class="notif-count"><%= notifs.length %></span><% } %>
<% if (notifs.length) { %>
<div class="notif-dropdown">
  <% notifs.forEach(n => { %>
    <div class="notif-item" hx-post="/notifications/<%= n.id %>/read" hx-target="closest .notif-bell" hx-swap="innerHTML">
      <%= n.message %>
    </div>
  <% }) %>
</div>
<% } %>

```

## `src/views/partials/notes-list.ejs`

```
<ul class="notes-list">
  <% if (notes.length === 0) { %>
    <li class="empty-state">No notes yet.</li>
  <% } %>
  <% notes.forEach(n => { %>
    <li><strong><%= n.username %>:</strong> <%= n.text %>
      <span class="note-time"><%= n.created_at %></span>
    </li>
  <% }) %>
</ul>

```

## `src/views/partials/nav.ejs`

```
<nav class="nav">
  <div class="nav-brand">Task Tracker</div>
  <div class="nav-links">
    <a href="/tasks">Tasks</a>
    <% if (user.role === 'admin') { %><a href="/users">Users</a><% } %>
  </div>
  <div class="nav-user">
    <div class="notif-bell" hx-get="/notifications/panel" hx-trigger="load, every 30s" hx-swap="innerHTML"></div>
    <span><%= user.username %> · <%= user.role %></span>
    <form method="POST" action="/logout" style="display:inline">
      <button type="submit" class="link-btn">Log out</button>
    </form>
  </div>
</nav>

```

## `src/services/notify.js`

```javascript
import { config } from '../config.js';

// Writes a row to `notifications` (source of the in-app bell) and, if
// NTFY_URL / NTFY_TOPIC are configured, fires a push through a self-hosted
// ntfy server. Push failures are swallowed on purpose — a notification
// going astray should never break the request that triggered it.
export function notify(db, { userId, type, taskId, message }) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, task_id, message)
    VALUES (?, ?, ?, ?)
  `).run(userId, type, taskId ?? null, message);

  if (config.ntfyUrl && config.ntfyTopic) {
    fetch(`${config.ntfyUrl.replace(/\/$/, '')}/${config.ntfyTopic}`, {
      method: 'POST',
      body: message,
      headers: { Title: type },
    }).catch((err) => console.warn('ntfy push failed:', err.message));
  }
}

```

## `src/services/activityLog.js`

```javascript
export function logActivity(db, { actorId, action, entityType, entityId, details }) {
  db.prepare(`
    INSERT INTO activity_log (actor_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId, action, entityType, entityId, details ? JSON.stringify(details) : null);
}

```

## `src/services/scheduler.js`

```javascript
export function startScheduler(db, notifyFn, intervalMs = 15 * 60 * 1000) {
  function check() {
    const dueSoon = db.prepare(`
      SELECT tasks.id, tasks.name, ta.user_id
      FROM tasks
      JOIN task_assignees ta ON ta.task_id = tasks.id
      WHERE tasks.deleted_at IS NULL
        AND tasks.status NOT IN ('done', 'cancelled')
        AND tasks.expected_done_at IS NOT NULL
        AND datetime(tasks.expected_done_at) <= datetime('now', '+1 day')
        AND datetime(tasks.expected_done_at) > datetime('now')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.task_id = tasks.id AND n.user_id = ta.user_id AND n.type = 'due_soon'
        )
    `).all();

    for (const row of dueSoon) {
      notifyFn(db, {
        userId: row.user_id, type: 'due_soon', taskId: row.id,
        message: `"${row.name}" is due within a day`,
      });
    }

    const overdue = db.prepare(`
      SELECT tasks.id, tasks.name, ta.user_id
      FROM tasks
      JOIN task_assignees ta ON ta.task_id = tasks.id
      WHERE tasks.deleted_at IS NULL
        AND tasks.status NOT IN ('done', 'cancelled')
        AND tasks.expected_done_at IS NOT NULL
        AND datetime(tasks.expected_done_at) <= datetime('now')
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.task_id = tasks.id AND n.user_id = ta.user_id AND n.type = 'overdue'
        )
    `).all();

    for (const row of overdue) {
      notifyFn(db, {
        userId: row.user_id, type: 'overdue', taskId: row.id,
        message: `"${row.name}" is overdue`,
      });
    }
  }

  check();
  return setInterval(check, intervalMs);
}

```

## `src/db/schema.sql`

```sql
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

```

## `src/db/index.js`

```javascript
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

// First-run convenience: if there are no users yet and ADMIN_USERNAME /
// ADMIN_PASSWORD are set, create the initial admin account. There is no
// public self-registration — an admin creates every other account.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0 && config.adminUsername && config.adminPassword) {
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare('INSERT INTO users (username, password, role_id) VALUES (?, ?, 1)')
    .run(config.adminUsername, hash);
  console.log(`Seeded initial admin user "${config.adminUsername}". Change the password after logging in.`);
}

export default db;

```

## `src/db/migrations/README.md`

```markdown
# Migrations

`schema.sql` one level up is the current baseline — it's applied in full on every boot (every statement is `CREATE TABLE IF NOT EXISTS`, so re-running it is always safe).

Once the app has real data in it, schema *changes* belong here instead of being edited directly into `schema.sql`:

```
001_add_task_cancelled_state.sql
002_add_completed_at_to_task_assignees.sql
```

Each file is a plain `.sql` script with the one change it makes. None of this is wired up yet — `db/index.js` only runs `schema.sql` today. Add a tiny migration runner (track applied filenames in a `migrations` table, run any not-yet-applied ones in order on boot) once the first real migration is needed. No need to build that machinery before it's needed.

```

## `src/middleware/permissions.js`

```javascript
// This file is the single source of truth for "who can see/do what."
// Every task route calls into these functions instead of re-implementing
// the rules inline.

// SQL WHERE fragment (+ params) describing which tasks a given user may see.
//   admin:   everything not soft-deleted
//   manager: their own tasks, tasks assigned to them, or tasks assigned to
//            anyone whose manager_id points back at them
//   user:    only tasks they created or are assigned to
export function visibleTasksClause(user) {
  if (user.role === 'admin') {
    return { where: 'deleted_at IS NULL', params: [] };
  }

  if (user.role === 'manager') {
    return {
      where: `deleted_at IS NULL AND (
        created_by = ?
        OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)
        OR id IN (
          SELECT ta.task_id FROM task_assignees ta
          JOIN users u ON u.id = ta.user_id
          WHERE u.manager_id = ?
        )
      )`,
      params: [user.id, user.id, user.id],
    };
  }

  // ordinary user
  return {
    where: `deleted_at IS NULL AND (
      created_by = ?
      OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)
    )`,
    params: [user.id, user.id],
  };
}

// Content (name/description) belongs to whoever created the task, or admin.
export function canEditContent(task, user) {
  return user.role === 'admin' || task.created_by === user.id;
}

// Status is shared: the creator or any current assignee can change it.
export function canChangeStatus(task, user, assigneeIds) {
  return user.role === 'admin' || task.created_by === user.id || assigneeIds.includes(user.id);
}

// "Logistics" = due date, reassignment, soft-delete. Held by the creator,
// admin, or a manager who manages at least one current assignee.
export function canChangeLogistics(task, user, assigneeIds, db) {
  if (user.role === 'admin' || task.created_by === user.id) return true;
  if (user.role !== 'manager') return false;
  if (assigneeIds.length === 0) return false;

  const placeholders = assigneeIds.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT 1 FROM users WHERE id IN (${placeholders}) AND manager_id = ? LIMIT 1
  `).get(...assigneeIds, user.id);
  return !!row;
}

```

## `src/middleware/auth.js`

```javascript
import { findById, touchLastSeen } from '../queries/users.js';

// Runs before every protected route: confirms the session cookie points at
// a real user, loads that user (role name included) onto the request, and
// stamps last_seen_at. Redirects to /login otherwise.
export async function requireAuth(request, reply) {
  const userId = request.session.get('userId');
  if (!userId) return reply.redirect('/login');

  const user = findById(request.server.db, userId);
  if (!user) {
    request.session.delete();
    return reply.redirect('/login');
  }

  touchLastSeen(request.server.db, user.id);
  request.user = user;
}

// Usage: { preHandler: requireRole('admin') } on a route, after requireAuth
// has already run and set request.user.
export function requireRole(...roles) {
  return async (request, reply) => {
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send('Forbidden: your role cannot do this.');
    }
  };
}

```

## `src/routes/notifications.js`

```javascript
import { requireAuth } from '../middleware/auth.js';
import { unreadFor, markRead } from '../queries/notifications.js';

export default async function notificationRoutes(app) {
  app.addHook('preHandler', requireAuth);
  const db = app.db;

  app.get('/notifications/panel', async (request, reply) => {
    return reply.view('partials/notifications.ejs', { notifs: unreadFor(db, request.user.id) });
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    markRead(db, request.params.id, request.user.id);
    return reply.view('partials/notifications.ejs', { notifs: unreadFor(db, request.user.id) });
  });
}

```

## `src/routes/tasks.js`

```javascript
import { requireAuth } from '../middleware/auth.js';
import { visibleTasksClause, canChangeStatus, canChangeLogistics } from '../middleware/permissions.js';
import { getAssignableUsers } from '../queries/users.js';
import {
  getTaskWithAssignees, listVisibleTaskIds, createTask, addAssignee,
  replaceAssignees, setStatus, setDueDate, softDelete, addNote, listNotes,
} from '../queries/tasks.js';
import { logActivity } from '../services/activityLog.js';
import { notify } from '../services/notify.js';

export default async function taskRoutes(app) {
  app.addHook('preHandler', requireAuth);
  const db = app.db;

  app.get('/', async (request, reply) => reply.redirect('/tasks'));

  app.get('/tasks', async (request, reply) => {
    const { where, params } = visibleTasksClause(request.user);
    const rows = listVisibleTaskIds(db, where, params);
    const tasks = rows.map((r) => getTaskWithAssignees(db, r.id));
    return reply.view('tasks.ejs', {
      user: request.user, tasks, assignableUsers: getAssignableUsers(db, request.user),
    });
  });

  app.post('/tasks', async (request, reply) => {
    const { name, description, expected_done_at } = request.body;
    if (!name || !name.trim()) return reply.code(400).send('A task needs a name.');

    let requested = request.body.assignees || [String(request.user.id)];
    if (!Array.isArray(requested)) requested = [requested];

    const allowedIds = getAssignableUsers(db, request.user).map((u) => u.id);
    let assignees = requested.map(Number).filter((id) => allowedIds.includes(id));
    if (assignees.length === 0) assignees = [request.user.id];

    const result = createTask(db, {
      name: name.trim(), description, createdBy: request.user.id, expectedDoneAt: expected_done_at,
    });
    const taskId = result.lastInsertRowid;

    for (const uid of assignees) {
      addAssignee(db, { taskId, userId: uid, assignedBy: request.user.id });
      if (uid !== request.user.id) {
        notify(db, { userId: uid, type: 'task_assigned', taskId, message: `You were assigned: ${name}` });
      }
    }

    logActivity(db, { actorId: request.user.id, action: 'task.created', entityType: 'task', entityId: taskId });

    return reply.view('partials/task-row.ejs', { task: getTaskWithAssignees(db, taskId), user: request.user });
  });

  app.get('/tasks/:id', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');

    const assigneeIds = task.assignees.map((a) => a.id);
    const canEditLogistics = canChangeLogistics(task, request.user, assigneeIds, db);
    const canSee =
      request.user.role === 'admin' ||
      task.created_by === request.user.id ||
      assigneeIds.includes(request.user.id) ||
      canEditLogistics;
    if (!canSee) return reply.code(403).send('Forbidden');

    return reply.view('partials/task-detail.ejs', {
      task, notes: listNotes(db, taskId), user: request.user,
      assignableUsers: getAssignableUsers(db, request.user), canEditLogistics,
    });
  });

  app.post('/tasks/:id/status', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');

    const assigneeIds = task.assignees.map((a) => a.id);
    if (!canChangeStatus(task, request.user, assigneeIds)) return reply.code(403).send('Forbidden');

    const order = ['pending', 'in_progress', 'done'];
    const next = request.body?.status || order[(order.indexOf(task.status) + 1) % order.length];
    setStatus(db, taskId, next);
    logActivity(db, {
      actorId: request.user.id, action: 'task.status_changed',
      entityType: 'task', entityId: taskId, details: { from: task.status, to: next },
    });

    return reply.view('partials/task-row.ejs', { task: getTaskWithAssignees(db, taskId), user: request.user });
  });

  app.post('/tasks/:id/due-date', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');

    const assigneeIds = task.assignees.map((a) => a.id);
    if (!canChangeLogistics(task, request.user, assigneeIds, db)) return reply.code(403).send('Forbidden');

    setDueDate(db, taskId, request.body.expected_done_at);
    logActivity(db, { actorId: request.user.id, action: 'task.due_date_changed', entityType: 'task', entityId: taskId });
    return reply.redirect(`/tasks/${taskId}`);
  });

  app.post('/tasks/:id/assignees', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');

    const currentIds = task.assignees.map((a) => a.id);
    if (!canChangeLogistics(task, request.user, currentIds, db)) return reply.code(403).send('Forbidden');

    let requested = request.body.assignees || [];
    if (!Array.isArray(requested)) requested = [requested];
    requested = requested.map(Number);

    const allowedIds = getAssignableUsers(db, request.user).map((u) => u.id);
    const valid = requested.filter((id) => allowedIds.includes(id));
    if (valid.length === 0) return reply.code(400).send('Pick at least one valid assignee.');

    replaceAssignees(db, taskId);
    for (const uid of valid) {
      addAssignee(db, { taskId, userId: uid, assignedBy: request.user.id });
      if (!currentIds.includes(uid)) {
        notify(db, { userId: uid, type: 'task_assigned', taskId, message: `You were assigned: ${task.name}` });
      }
    }

    logActivity(db, {
      actorId: request.user.id, action: 'task.reassigned',
      entityType: 'task', entityId: taskId, details: { assignees: valid },
    });
    return reply.redirect(`/tasks/${taskId}`);
  });

  app.post('/tasks/:id/notes', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');
    if (!request.body.text || !request.body.text.trim()) return reply.code(400).send('Note text is required.');

    const assigneeIds = task.assignees.map((a) => a.id);
    const canSee =
      request.user.role === 'admin' ||
      task.created_by === request.user.id ||
      assigneeIds.includes(request.user.id) ||
      canChangeLogistics(task, request.user, assigneeIds, db);
    if (!canSee) return reply.code(403).send('Forbidden');

    addNote(db, { taskId, text: request.body.text.trim(), createdBy: request.user.id });
    logActivity(db, { actorId: request.user.id, action: 'note.created', entityType: 'task', entityId: taskId });

    for (const uid of assigneeIds) {
      if (uid !== request.user.id) {
        notify(db, { userId: uid, type: 'note_added', taskId, message: `New note on: ${task.name}` });
      }
    }

    return reply.view('partials/notes-list.ejs', { notes: listNotes(db, taskId) });
  });

  app.post('/tasks/:id/delete', async (request, reply) => {
    const taskId = Number(request.params.id);
    const task = getTaskWithAssignees(db, taskId);
    if (!task) return reply.code(404).send('Task not found.');

    const assigneeIds = task.assignees.map((a) => a.id);
    if (!canChangeLogistics(task, request.user, assigneeIds, db)) return reply.code(403).send('Forbidden');

    softDelete(db, taskId);
    logActivity(db, { actorId: request.user.id, action: 'task.deleted', entityType: 'task', entityId: taskId });
    return reply.send('');
  });
}

```

## `src/routes/auth.js`

```javascript
import bcrypt from 'bcryptjs';
import { findByUsername } from '../queries/users.js';

export default async function authRoutes(app) {
  app.get('/login', async (request, reply) => {
    if (request.session.get('userId')) return reply.redirect('/tasks');
    return reply.view('login.ejs', { error: null });
  });

  app.post('/login', async (request, reply) => {
    const { username, password } = request.body;
    const user = findByUsername(app.db, username);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return reply.view('login.ejs', { error: 'Incorrect username or password.' });
    }

    request.session.set('userId', user.id);
    return reply.redirect('/tasks');
  });

  app.post('/logout', async (request, reply) => {
    request.session.delete();
    return reply.redirect('/login');
  });
}

```

## `src/routes/users.js`

```javascript
import bcrypt from 'bcryptjs';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listAllWithManager, listManagersAndAdmins, createUser, findRoleByName } from '../queries/users.js';

export default async function userRoutes(app) {
  app.addHook('preHandler', requireAuth);
  const db = app.db;

  app.get('/users', { preHandler: requireRole('admin') }, async (request, reply) => {
    return reply.view('users.ejs', {
      user: request.user,
      users: listAllWithManager(db),
      managers: listManagersAndAdmins(db),
    });
  });

  app.post('/users', { preHandler: requireRole('admin') }, async (request, reply) => {
    const { username, password, role, manager_id } = request.body;
    const roleRow = findRoleByName(db, role);

    if (!roleRow || !username || !password) {
      return reply.code(400).send('Missing or invalid fields.');
    }

    try {
      createUser(db, {
        username,
        passwordHash: bcrypt.hashSync(password, 10),
        roleId: roleRow.id,
        managerId: manager_id,
      });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return reply.code(400).send('That username is already taken.');
      }
      throw err;
    }

    return reply.redirect('/users');
  });
}

```

## `src/queries/notifications.js`

```javascript
export function unreadFor(db, userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? AND read = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

export function markRead(db, notifId, userId) {
  db.prepare(`UPDATE notifications SET read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(notifId, userId);
}

```

## `src/queries/tasks.js`

```javascript
export function getTaskWithAssignees(db, taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return null;
  const assignees = db.prepare(`
    SELECT users.id, users.username FROM task_assignees
    JOIN users ON users.id = task_assignees.user_id
    WHERE task_assignees.task_id = ?
    ORDER BY users.username
  `).all(taskId);
  return { ...task, assignees };
}

export function listVisibleTaskIds(db, where, params) {
  return db.prepare(`
    SELECT id FROM tasks WHERE ${where}
    ORDER BY expected_done_at IS NULL, expected_done_at ASC, created_at DESC
  `).all(...params);
}

export function createTask(db, { name, description, createdBy, expectedDoneAt }) {
  return db.prepare(`
    INSERT INTO tasks (name, description, created_by, expected_done_at)
    VALUES (?, ?, ?, ?)
  `).run(name, description || null, createdBy, expectedDoneAt || null);
}

export function addAssignee(db, { taskId, userId, assignedBy }) {
  db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_by) VALUES (?, ?, ?)')
    .run(taskId, userId, assignedBy);
}

export function replaceAssignees(db, taskId) {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
}

export function setStatus(db, taskId, status) {
  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, taskId);
}

export function setDueDate(db, taskId, dueDate) {
  db.prepare(`UPDATE tasks SET expected_done_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(dueDate || null, taskId);
}

export function softDelete(db, taskId) {
  db.prepare(`UPDATE tasks SET deleted_at = datetime('now') WHERE id = ?`).run(taskId);
}

export function addNote(db, { taskId, text, createdBy }) {
  db.prepare('INSERT INTO notes (text, task, created_by) VALUES (?, ?, ?)').run(text, taskId, createdBy);
}

export function listNotes(db, taskId) {
  return db.prepare(`
    SELECT notes.*, users.username FROM notes
    JOIN users ON users.id = notes.created_by
    WHERE task = ? ORDER BY created_at DESC
  `).all(taskId);
}

```

## `src/queries/users.js`

```javascript
export function findByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findById(db, id) {
  return db.prepare(`
    SELECT users.*, roles.name AS role FROM users
    JOIN roles ON roles.id = users.role_id
    WHERE users.id = ?
  `).get(id);
}

export function touchLastSeen(db, id) {
  db.prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(id);
}

export function listAllWithManager(db) {
  return db.prepare(`
    SELECT users.id, users.username, roles.name AS role,
           users.manager_id, m.username AS manager_name
    FROM users
    JOIN roles ON roles.id = users.role_id
    LEFT JOIN users m ON m.id = users.manager_id
    ORDER BY users.username
  `).all();
}

export function listManagersAndAdmins(db) {
  return db.prepare(`
    SELECT users.id, users.username FROM users
    JOIN roles ON roles.id = users.role_id
    WHERE roles.name IN ('manager', 'admin')
    ORDER BY users.username
  `).all();
}

export function findRoleByName(db, name) {
  return db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
}

export function createUser(db, { username, passwordHash, roleId, managerId }) {
  return db.prepare(`
    INSERT INTO users (username, password, role_id, manager_id)
    VALUES (?, ?, ?, ?)
  `).run(username, passwordHash, roleId, managerId || null);
}

// Who a given user is allowed to assign a task to:
//   admin -> anyone, manager -> their reports + themselves, user -> only themselves
export function getAssignableUsers(db, user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT id, username FROM users ORDER BY username').all();
  }
  if (user.role === 'manager') {
    return db.prepare(
      'SELECT id, username FROM users WHERE manager_id = ? OR id = ? ORDER BY username'
    ).all(user.id, user.id);
  }
  return db.prepare('SELECT id, username FROM users WHERE id = ?').all(user.id);
}

```

