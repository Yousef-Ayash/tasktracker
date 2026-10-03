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
