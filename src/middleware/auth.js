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
