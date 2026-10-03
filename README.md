# Task Tracker

Self-hosted task management for a team with a manager hierarchy. Node + Fastify + SQLite + HTMX. See `docs/overview.md` for the full idea, roles, and permission model.

## Status

Fully functional: auth, the permission hierarchy, tasks (create, status, due date, reassignment, soft-delete), notes, notifications (in-app + ntfy), the due-soon/overdue scheduler, and the HTMX-driven views are all built and have been exercised end-to-end over real HTTP requests.

Verified by `npm test` (`tests/permissions.test.js`, 11 passing): manager-of-report can act on logistics, unrelated users cannot, creators and assignees can always act on their own content/status, and the visibility SQL is scoped correctly per role.

Not yet done:
- The Docker build hasn't been tested with a real Docker daemon (none available in the dev sandbox) — verify `docker compose up -d --build` on the actual Proxmox host
- Migration runner (see `src/db/migrations/README.md`) — intentionally deferred until the first real schema change after data exists

Done since the last pass:
- **PWA icons** — generated at `public/icons/` (192, 512, and a maskable 512) and wired into `manifest.json`
- **Service worker** (`public/sw.js`) — satisfies installability requirements and caches the static shell for offline resilience. It does **not** handle push: push delivery goes through a self-hosted **ntfy** instance and its own app, installed separately on the phone (see `docs/overview.md`). Building browser Web Push into this PWA would mean managing VAPID keys and per-user subscriptions for no real benefit when ntfy already solves delivery — so that's not planned, not just postponed.
- **better-sqlite3 crash on Node 24.19+** — fixed by upgrading to `better-sqlite3@^13`, which moved off the legacy native API that was crashing on cleanup (see commit history / chat log for the root cause if curious)

## Run it (Docker)

```bash
cp .env.example .env
# edit .env: set ADMIN_USERNAME / ADMIN_PASSWORD at minimum
docker compose up -d --build
curl http://localhost:3000/healthz
```

First boot seeds the admin account from `.env`. There's no public registration — every other account gets created by an admin once the Users page exists.

## Run it (without Docker, for local dev)

```bash
npm install
cp .env.example .env
npm run dev
```

## Project layout

```
src/
  server.js        Boot: plugins, session, DB, routes
  config.js         Reads .env once; nothing else touches process.env
  db/               schema.sql (current schema) + migrations/ (future changes)
  middleware/        auth.js (who are you) + permissions.js (what can you do)
  queries/           All SQL, kept out of route handlers
  routes/            Thin: validate input, check permission, call a query
  services/          Activity log, notifications (+ ntfy push), scheduler
  views/             EJS templates + HTMX partials
public/              CSS, vendored htmx.min.js, PWA manifest + icons
deploy/              Caddyfile example for the separate reverse-proxy host
docs/                overview.md — the idea, roles, and workflow, kept
                     separate from implementation detail
tests/               Permission-hierarchy tests — the part most worth
                     covering, since that's where subtle bugs hide
```

## Notes

- SQLite runs in WAL mode; the file and session key live in `./data`, bind-mounted into the container so rebuilding the image never touches data.
- Push notifications go through a self-hosted **ntfy** instance — set `NTFY_URL` / `NTFY_TOPIC` in `.env` once one exists. An optional ntfy service is sketched (commented out) in `docker-compose.yml`.
- This container exposes port 3000 directly; HTTPS and the friendly hostname are handled by a separate reverse-proxy host, not by this service.