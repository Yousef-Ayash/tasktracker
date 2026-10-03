export function unreadFor(db, userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? AND read = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

export function markRead(db, notifId, userId) {
  db.prepare(`UPDATE notifications SET read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(notifId, userId);
}
