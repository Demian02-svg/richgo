// Rich Go v3 - Phase 2: system notifications + offline cache
const CACHE = 'richgo-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Phase 2: 알림 클릭 시 앱 열기/포커스
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const urlToOpen = e.notification.data && e.notification.data.url ? e.notification.data.url : './';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('notificationclose', e => {
  // 필요 시 분석용 로그
  // console.log('Notification closed', e.notification.tag);
});

// (선택) 백그라운드에서 주기적으로 체크 - Periodic Sync API 지원 시
// Chrome에서만 실험적 지원, 없어도 앱이 열릴 때 app.js에서 체크함
self.addEventListener('periodicsync', e => {
  if (e.tag === 'richgo-daily-check') {
    e.waitUntil(
      // 서비스워커만으로 DB를 읽기 어려우므로 클라이언트에 메시지
      self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'DAILY_CHECK' }));
      })
    );
  }
});
