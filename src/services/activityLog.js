export function logActivity(db, { actorId, action, entityType, entityId, details }) {
  db.prepare(`
    INSERT INTO activity_log (actor_id, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId, action, entityType, entityId, details ? JSON.stringify(details) : null);
}
