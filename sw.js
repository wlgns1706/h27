// Offline store for the phone app. build_pwa.mjs puts a hash of the app shell into BUILD (the only
// place its placeholder may appear), so a new shell installs a new worker. strategyFor() decides how each request is answered.
const BUILD = 'f57a4b4092f9';
const CACHE = 'h27-' + BUILD;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const DATA = 'data.enc';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function strategyFor(url, scope) {
  const u = new URL(url);
  const s = new URL(scope);
  if (FONT_HOSTS.includes(u.hostname)) return 'cache-first';
  if (u.origin !== s.origin || !u.pathname.startsWith(s.pathname)) return 'network';
  const rel = u.pathname.slice(s.pathname.length);
  if (rel === DATA) return 'network-first';
  if (rel === '' || SHELL.includes(rel)) return 'shell';
  return 'network';
}

// The trip data: always try the network first (bypassing the HTTP cache), keep what arrives,
// and fall back to the kept copy, marked with x-h27-cache: hit so the page can say it is offline.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await cache.put(DATA, res.clone());
    return res;
  } catch (err) {
    const kept = await cache.match(DATA);
    if (!kept) throw err;
    const headers = new Headers(kept.headers);
    headers.set('x-h27-cache', 'hit');
    return new Response(await kept.blob(), { status: 200, headers });
  }
}

async function shell(request, scope) {
  const cache = await caches.open(CACHE);
  const rel = new URL(request.url).pathname.slice(new URL(scope).pathname.length);
  return (await cache.match(rel === '' ? './' : rel, { ignoreSearch: true })) || fetch(request);
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') await cache.put(request, res.clone());
  return res;
}

// A new version starts with an empty cache: bring over the trip data and fonts so the app still
// opens offline right after an update, then delete the old caches.
async function carryOver() {
  const fresh = await caches.open(CACHE);
  for (const name of await caches.keys()) {
    if (name === CACHE || !name.startsWith('h27-')) continue;
    const old = await caches.open(name);
    for (const req of await old.keys()) {
      const u = new URL(req.url);
      const wanted = u.pathname.endsWith('/' + DATA) || FONT_HOSTS.includes(u.hostname);
      if (wanted && !(await fresh.match(req))) await fresh.put(req, await old.match(req));
    }
    await caches.delete(name);
  }
}

if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
  });
  self.addEventListener('activate', e => {
    e.waitUntil(carryOver().then(() => self.clients.claim()));
  });
  self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const scope = self.registration.scope;
    const kind = strategyFor(e.request.url, scope);
    if (kind === 'network-first') e.respondWith(networkFirst(e.request));
    else if (kind === 'shell') e.respondWith(shell(e.request, scope));
    else if (kind === 'cache-first') e.respondWith(cacheFirst(e.request));
  });
}
