// Deer Springs Ranch Map - offline service worker
// Map data and the page: try the network first (so updates show up), fall back to the saved copy.
// Imagery tiles and code libraries: use the saved copy first, network if missing.

const DATA_CACHE = 'dsr-data-v1';
const TILE_CACHE = 'dsr-tiles-v1';
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = [DATA_CACHE, TILE_CACHE];
        const names = await caches.keys();
        await Promise.all(names.filter(n => n.startsWith('dsr-') && !keep.includes(n)).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

function isTile(url) {
    return url.hostname === 'basemap.nationalmap.gov' ||
           url.hostname.endsWith('arcgisonline.com') ||
           url.hostname.endsWith('openstreetmap.org') ||
           url.hostname.endsWith('opentopomap.org');
}

function isLibrary(url) {
    return url.hostname === 'unpkg.com';
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    try {
        const response = await fetch(request);
        // Only keep USGS tiles and libraries; other basemaps stay online-only
        const url = new URL(request.url);
        if (response.ok && (url.hostname === 'basemap.nationalmap.gov' || isLibrary(url))) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

async function networkFirst(request) {
    const cache = await caches.open(DATA_CACHE);
    try {
        const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
        ]);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
        if (hit) return hit;
        if (request.mode === 'navigate') {
            const page = await cache.match('./index.html', { ignoreSearch: true }) ||
                         await cache.match('./', { ignoreSearch: true });
            if (page) return page;
        }
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    if (isTile(url)) {
        event.respondWith(cacheFirst(event.request, TILE_CACHE));
    } else if (isLibrary(url)) {
        event.respondWith(cacheFirst(event.request, DATA_CACHE));
    } else if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(event.request));
    }
});
