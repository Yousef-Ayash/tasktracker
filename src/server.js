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
