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
