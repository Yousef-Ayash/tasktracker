import { config } from '../config.js';

// Writes a row to `notifications` (source of the in-app bell) and, if
// NTFY_URL / NTFY_TOPIC are configured, fires a push through a self-hosted
// ntfy server. Push failures are swallowed on purpose — a notification
// going astray should never break the request that triggered it.
export function notify(db, { userId, type, taskId, message }) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, task_id, message)
    VALUES (?, ?, ?, ?)
  `).run(userId, type, taskId ?? null, message);

  if (config.ntfyUrl && config.ntfyTopic) {
    fetch(`${config.ntfyUrl.replace(/\/$/, '')}/${config.ntfyTopic}`, {
      method: 'POST',
      body: message,
      headers: { Title: type },
    }).catch((err) => console.warn('ntfy push failed:', err.message));
  }
}
