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
