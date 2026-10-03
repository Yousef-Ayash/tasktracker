# Migrations

`schema.sql` one level up is the current baseline — it's applied in full on every boot (every statement is `CREATE TABLE IF NOT EXISTS`, so re-running it is always safe).

Once the app has real data in it, schema *changes* belong here instead of being edited directly into `schema.sql`:

```
001_add_task_cancelled_state.sql
002_add_completed_at_to_task_assignees.sql
```

Each file is a plain `.sql` script with the one change it makes. None of this is wired up yet — `db/index.js` only runs `schema.sql` today. Add a tiny migration runner (track applied filenames in a `migrations` table, run any not-yet-applied ones in order on boot) once the first real migration is needed. No need to build that machinery before it's needed.
