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
