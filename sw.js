// sw.js
// FIX: 升级版本号，触发缓存更新
const CACHE_NAME = 'prescription-cache-v2'; // v1 -> v2
const urlsToCache = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/utils/encoding.js',
  '/js/utils/llm-adapter.js',
  '/js/utils/storage.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting()) // FIX: 强制激活
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim()) // FIX: 立即控制所有客户端
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});