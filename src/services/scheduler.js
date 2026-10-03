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
