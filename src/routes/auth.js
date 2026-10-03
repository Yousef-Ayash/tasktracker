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
