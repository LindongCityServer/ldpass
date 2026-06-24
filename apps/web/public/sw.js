const cacheName = 'ldpass-app-shell-v2';
const appShellUrls = [
  '/',
  '/manifest.webmanifest',
  '/brand/ldpass_app_icon.svg',
  '/brand/ldpass_app_icon_192.png',
  '/brand/ldpass_app_icon_512.png',
  '/brand/ldpass_apple_touch_icon.png',
  '/brand/ldpass_icon_color.svg',
  '/brand/ldpass_icon.svg',
  '/brand/ldpass_favicon_32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(appShellUrls))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'));
    return;
  }

  if (['style', 'script', 'font', 'image', 'manifest'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(fallbackUrl)) ?? new Response('离线状态下暂时无法打开该页面。', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 503,
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  const networkResponsePromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cachedResponse ?? (await networkResponsePromise) ?? new Response('', { status: 504 });
}
