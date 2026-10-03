import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { runMigrations } from './migrations/runner.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

// Run any pending migrations from src/db/migrations/
runMigrations(db);

// First-run convenience: if there are no users yet and ADMIN_USERNAME /
// ADMIN_PASSWORD are set, create the initial admin account. There is no
// public self-registration — an admin creates every other account.
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0 && config.adminUsername && config.adminPassword) {
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare('INSERT INTO users (username, password, role_id) VALUES (?, ?, 1)')
    .run(config.adminUsername, hash);
  console.log(`Seeded initial admin user "${config.adminUsername}". Change the password after logging in.`);
}

export default db;