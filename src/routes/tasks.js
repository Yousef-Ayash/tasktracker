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
