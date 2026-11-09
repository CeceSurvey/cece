/* ============================================================
 * 测策 · 工程测量学习与实训系统 — Service Worker
 * 版权所有 © 2026 陈昱晨（ChaiYiChai）
 * 采用 CC BY-NC 4.0 许可证授权，详见项目根目录 LICENSE 文件
 *
 * 用于 PWA 离线缓存：首次访问后缓存核心静态资源，
 * 之后无网络也能打开应用（数据仍存 localStorage，本机持久化）。
 * ============================================================ */

const CACHE_NAME = 'cece-v3.0.1';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './core.js',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* 安装：预缓存核心资源 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

/* 激活：清理旧版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* 请求：缓存优先，命中则返回缓存，未命中则回退网络并缓存 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          // 仅缓存同源且成功的响应
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return resp;
        })
        .catch(() => {
          // 离线且未缓存时，导航请求回退到首页缓存
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
