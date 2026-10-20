/* オフラインでも開けるように、アプリ本体を端末に保存しておく */
const VERSION = "kozo-v17";
const SHELL = ["./", "./index.html", "./app.js", "./store.js", "./drive.js", "./config.js", "./styles.css",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png",
  ...["gia", "zena", "til"].flatMap(n => [1, 2, 3].map(k => `./sprites/${n}_walk_${k}.png`))];

self.addEventListener("install", e => {
  // 新しい版は、ブラウザの一時保存を通さず必ずサーバーから取り直す
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "kozo-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Google のログインやドライブへの通信は、そのままネットへ
  if (/(^|\.)googleapis\.com$/.test(url.hostname) && url.hostname !== "fonts.googleapis.com") return;
  if (url.hostname === "accounts.google.com") return;
  // フォントは一度読んだら端末に残す
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open("kozo-fonts").then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const r = await fetch(req); c.put(req, r.clone()); return r; } catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // アプリ本体：まず端末の保存分を返し、裏で新しい版を取りに行く（次に開いたときに反映）
  e.respondWith(caches.open(VERSION).then(async c => {
    const key = req.mode === "navigate" ? "./index.html" : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req, { cache: "no-cache" }).then(r => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response("オフラインです", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
