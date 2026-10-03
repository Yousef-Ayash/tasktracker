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
