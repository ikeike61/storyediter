/* Google ドライブとのやり取り
   権限は drive.file（このアプリが作ったファイルだけを読み書きできる）に限定する */
const Drive = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FOLDER = "宿命刻の姫君_構成台帳";
  const DATAFILE = "kozo-data.json";
  const API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  let token = null, tokenExp = 0, client = null, gisPromise = null;

  const configured = () => !!(window.KOZO_CONFIG && /\.apps\.googleusercontent\.com$/.test(window.KOZO_CONFIG.CLIENT_ID || ""));

  function preload() {
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => res(); s.onerror = () => { gisPromise = null; rej(new Error("Googleのログイン部品を読み込めませんでした")); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  /* ボタンを押した直後に呼ぶ（ポップアップが止められないように） */
  function signIn() {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    if (!(window.google && google.accounts && google.accounts.oauth2)) return preload().then(signIn);
    return new Promise((res, rej) => {
      if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: window.KOZO_CONFIG.CLIENT_ID, scope: SCOPE, callback: () => {} });
      client.callback = r => {
        if (r.error) return rej(new Error("Googleへのログインが完了しませんでした（" + r.error + "）"));
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000; res(token);
      };
      client.error_callback = e => rej(new Error(e && e.type === "popup_closed" ? "ログイン画面が閉じられました" : "ログイン画面を開けませんでした（ポップアップの許可を確認してください）"));
      client.requestAccessToken({ prompt: "" });
    });
  }

  async function api(url, opt = {}) {
    if (!token) throw new Error("ログインしていません");
    const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + token } });
    if (r.status === 401) { token = null; throw new Error("ログインの有効期限が切れました。もう一度同期してください"); }
    if (!r.ok) { let t = ""; try { t = await r.text(); } catch (e) {} const err = new Error("ドライブとの通信に失敗しました（" + r.status + "）"); err.status = r.status; err.detail = t; throw err; }
    return r;
  }
  const q = s => encodeURIComponent(s);

  function multipart(meta, blob) {
    const b = "kozo" + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
      blob, `\r\n--${b}--`
    ]);
    return { body, type: `multipart/related; boundary=${b}` };
  }

  async function exists(id) {
    try { const r = await api(`${API}/${id}?fields=id,trashed`); const j = await r.json(); return !j.trashed; }
    catch (e) { if (e.status === 404) return false; throw e; }
  }
  async function find(query) {
    const r = await api(`${API}?q=${q(query + " and trashed=false")}&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=10`);
    return (await r.json()).files || [];
  }

  async function ensureFolder(cachedId) {
    if (cachedId && await exists(cachedId)) return cachedId;
    const f = await find(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder'`);
    if (f.length) return f[0].id;
    const r = await api(API + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }) });
    return (await r.json()).id;
  }
  async function findData(folderId, cachedId) {
    if (cachedId && await exists(cachedId)) return cachedId;
    const f = await find(`name='${DATAFILE}' and '${folderId}' in parents`);
    return f.length ? f[0].id : null;
  }
  async function readJson(fileId) { const r = await api(`${API}/${fileId}?alt=media`); return r.json(); }
  async function createJson(folderId, obj) {
    const m = multipart({ name: DATAFILE, parents: [folderId], mimeType: "application/json" }, new Blob([JSON.stringify(obj)], { type: "application/json" }));
    const r = await api(UPLOAD + "?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": m.type }, body: m.body });
    return (await r.json()).id;
  }
  async function updateJson(fileId, obj) {
    await api(`${UPLOAD}/${fileId}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  }
  async function uploadImage(folderId, name, blob) {
    const m = multipart({ name, parents: [folderId] }, blob);
    const r = await api(UPLOAD + "?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": m.type }, body: m.body });
    return (await r.json()).id;
  }
  async function downloadBlob(fileId) { const r = await api(`${API}/${fileId}?alt=media`); return r.blob(); }

  return { configured, preload, signIn, ensureFolder, findData, readJson, createJson, updateJson, uploadImage, downloadBlob, FOLDER };
})();
