// Minimal service worker. It exists so the app satisfies PWA installability
// requirements (Chrome/Android require one with a fetch handler before
// offering "Add to Home Screen") and so the static shell still loads if the
// network drops mid-session.
//
// This deliberately does NOT handle push events. Notification delivery goes
// through a self-hosted ntfy instance and its own app, installed separately
// on the phone (see docs/overview.md) — building browser Web Push here would
// mean managing VAPID keys and per-user subscriptions for no real benefit.

const CACHE_NAME = 'tasktracker-shell-v2';
const SHELL_ASSETS = [
    '/css/style.css',
    '/js/htmx.min.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only the static shell is ever cached. Task pages, HTMX fragments, and
    // form posts always hit the network — this app's data changes too often,
    // and is too permission-sensitive, to ever serve from a cache.
    if (event.request.method !== 'GET' || !SHELL_ASSETS.includes(url.pathname)) {
        return;
    }

    // Network-first, cache as fallback. A cache-first strategy here would mean
    // a normal reload keeps serving whatever was cached on first visit even
    // after the file changes on the server — only a force-reload (which
    // bypasses the service worker entirely) would show the real version. This
    // way the live file always wins when the network's up, and the cache
    // (kept fresh on every successful fetch) only matters once you're offline.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});