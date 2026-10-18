/* 端末内の保存（IndexedDB）
   docs   : キー "meta" / "e:<id>" / "c:<id>" → {data, updatedAt, base, dirty, deleted}
   images : キー 画像ID → {blob, driveId, name}
   kv     : 設定や同期の状態 */
const Store = (() => {
  const NAME = "kozo-pwa", VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ["docs", "images", "kv"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  async function get(s, k) {
    const d = await open();
    return new Promise((res, rej) => { const r = d.transaction(s).objectStore(s).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function put(s, k, v) { const d = await open(); const t = d.transaction(s, "readwrite"); t.objectStore(s).put(v, k); return done(t); }
  async function del(s, k) { const d = await open(); const t = d.transaction(s, "readwrite"); t.objectStore(s).delete(k); return done(t); }
  async function putMany(s, pairs) { const d = await open(); const t = d.transaction(s, "readwrite"); const o = t.objectStore(s); for (const [k, v] of pairs) o.put(v, k); return done(t); }
  async function entries(s) {
    const d = await open();
    return new Promise((res, rej) => {
      const out = []; const r = d.transaction(s).objectStore(s).openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
      r.onerror = () => rej(r.error);
    });
  }
  return { get, put, del, putMany, entries };
})();
