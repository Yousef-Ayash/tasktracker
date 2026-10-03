import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  dbPath: process.env.DB_PATH || './data/tasktracker.db',
  sessionKeyPath: process.env.SESSION_KEY_PATH || './data/session-key',

  adminUsername: process.env.ADMIN_USERNAME || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,

  ntfyUrl: process.env.NTFY_URL || null,
  ntfyTopic: process.env.NTFY_TOPIC || null,
};
