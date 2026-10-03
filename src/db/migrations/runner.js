import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

    const appliedRows = db.prepare('SELECT filename FROM migrations').all();
    const appliedFiles = new Set(appliedRows.map((r) => r.filename));

    const files = fs.readdirSync(__dirname)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        if (!appliedFiles.has(file)) {
            const filePath = path.join(__dirname, file);
            const sql = fs.readFileSync(filePath, 'utf8');

            const executeMigration = db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(file);
            });

            executeMigration();
            console.log(`Applied migration: ${file}`);
        }
    }
}