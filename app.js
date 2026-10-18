/* 宿命刻の姫君 構成台帳（ドライブ版） */
(function(){
const STATUSES=["確定","詳細プロット","骨格のみ","たたき台","未着手"];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let eps=[], meta=null, loaded=false, view="edit", selId=null, q="";
let pendingDelete=null, exportOpen=false;
let chars=[], charSel=null, cq="";
const CHAR_STATUSES=["決定","決定（細部は検討中）","決定（名前未定）","決定（中身未定）","検討中","未配置"];
try{charSel=localStorage.getItem("kozo.char");}catch(e){}
const dirty=new Map(); // id -> timer
const local=new Map(); // id -> object under edit
try{const v=localStorage.getItem("kozo.view"); if(v) view=v; selId=localStorage.getItem("kozo.sel");}catch(e){}

/* ---------- 計算 ---------- */
function rowsFor(t,min){const s=String(t||"");const lines=s.split("\n").reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/48)),0);return Math.min(Math.max(min,lines+1),40)}
function count(e){return (e.parts&&e.parts.length)?e.parts.length:(Number(e.webCount)||0)}
function ranges(){ // Web話数を通し番号で自動計算
  let n=1, unknown=false; const r={};
  eps.forEach((e,i)=>{const c=count(e);
    if(unknown||!c){r[e.id]={ep:i+1,from:null,to:null,c};unknown=unknown||!c;return}
    r[e.id]={ep:i+1,from:n,to:n+c-1,c}; n+=c;});
  return r;
}
const rng=x=>x.from==null?"未定":(x.from===x.to?`${x.from}`:`${x.from}〜${x.to}`);
const arcName=id=>(meta&&meta.arcs||[]).find(a=>a.id===id)?.name||"（編なし）";
const isReal=o=>/本物|吸収|誕生/.test(o||"");

/* ---------- 端末内のデータ ---------- */
const recs=new Map(); // "meta" / "e:<id>" / "c:<id>" → {data, updatedAt, base, dirty, deleted}
const urlCache=new Map(); // 画像ID → 表示用URL
const PLACEHOLDER="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"><rect width="3" height="4" fill="#8888"/></svg>');
const stripId=o=>{const {id:_,...b}=o;return b};
const keyOf=id=>id==="__meta"?"meta":id.startsWith("c:")?id:"e:"+id;
function blob(id){return urlCache.get(id)||PLACEHOLDER}
function defaultMeta(){return {title:"宿命刻の姫君",tagline:"",logline:"",policy:"",arcs:[]}}
function rebuild(){
  eps=[]; chars=[]; let m=null;
  for(const [k,r] of recs){
    if(!r||r.deleted||!r.data) continue;
    if(k==="meta") m={...r.data};
    else if(k.startsWith("e:")) eps.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("c:")) chars.push({id:k.slice(2),...structuredClone(r.data)});
  }
  eps.sort((a,b)=>(a.order||0)-(b.order||0)); chars.sort((a,b)=>(a.order||0)-(b.order||0));
  meta=m||defaultMeta(); meta.arcs=meta.arcs||[];
}
function setSave(t,err){const s=$("#save");s.textContent=t;s.classList.toggle("err",!!err)}
const timers=new Map();
function touch(key,data,deleted){
  const r=recs.get(key)||{base:0};
  r.data=data; r.updatedAt=Date.now(); r.dirty=true; r.deleted=!!deleted; recs.set(key,r);
  if(timers.has(key)) clearTimeout(timers.get(key));
  setSave("編集中…");
  timers.set(key,setTimeout(()=>persist(key),300));
}
async function persist(key){
  if(timers.has(key)){clearTimeout(timers.get(key));timers.delete(key);}
  try{ await Store.put("docs",key,recs.get(key)); if(!timers.size) setSave("端末に保存しました"); updateSyncBadge(); }
  catch(e){ setSave("端末に保存できませんでした（空き容量を確認してください）",true); }
}
function flushAll(){ for(const k of [...timers.keys()]) persist(k); }
window.addEventListener("pagehide",flushAll);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") flushAll(); });
function edit(id,mut){
  const isC=id.startsWith("c:"), cid=id.slice(2);
  const obj=id==="__meta"?meta:isC?chars.find(c=>c.id===cid):eps.find(e=>e.id===id);
  if(!obj) return;
  mut(obj);
  touch(keyOf(id),structuredClone(stripId(obj)),false);
}
function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
async function addDoc(kind,body){
  const id=newId(kind==="c"?"ch":"ep"); const key=(kind==="c"?"c:":"e:")+id;
  touch(key,body,false); await persist(key); rebuild(); return id;
}
async function removeDoc(id){
  const key=keyOf(id); const r=recs.get(key); if(!r) return;
  touch(key,r.data,true); await persist(key); rebuild(); setSave("削除しました");
}

/* 画像：大きすぎる写真は縮めてから端末に保存する */
async function shrink(file){
  try{
    if(file.type==="image/gif") return file;
    const bmp=await createImageBitmap(file); const max=1600;
    const s=Math.min(1,max/Math.max(bmp.width,bmp.height));
    if(s===1&&file.size<1.5e6) return file;
    const c=document.createElement("canvas"); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    const out=await new Promise(r=>c.toBlob(r,"image/webp",0.86));
    return out||file;
  }catch(e){ return file; }
}
async function addImage(file){
  const b=await shrink(file);
  const id=newId("img_");
  await Store.put("images",id,{blob:b,driveId:null,name:file.name});
  urlCache.set(id,URL.createObjectURL(b)); updateSyncBadge();
  return {id};
}
async function removeImage(id){
  // 参照を外すだけで十分（使われていない画像は同期で配らない）。端末の容量のため本体も消す
  try{ await Store.del("images",id); }catch(e){}
  const u=urlCache.get(id); if(u&&u.startsWith("blob:")) URL.revokeObjectURL(u); urlCache.delete(id);
}

/* ---------- 同期 ---------- */
async function kvGet(k){try{return await Store.get("kv",k)}catch(e){return null}}
async function kvSet(k,v){try{await Store.put("kv",k,v)}catch(e){}}
async function unsyncedCount(){
  let n=0; for(const r of recs.values()) if(r&&r.dirty) n++;
  try{ for(const [,v] of await Store.entries("images")) if(v&&!v.driveId) n++; }catch(e){}
  return n;
}
async function updateSyncBadge(){
  const b=$("#b-sync"); if(!b) return;
  const n=await unsyncedCount();
  b.querySelector(".badge").textContent=n?String(n):"";
  b.querySelector(".badge").hidden=!n;
  $("#net").textContent=navigator.onLine?"":"オフライン";
}
window.addEventListener("online",updateSyncBadge); window.addEventListener("offline",updateSyncBadge);

const stable=v=>Array.isArray(v)?"["+v.map(stable).join(",")+"]":(v&&typeof v==="object")?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(v);
function labelKey(k,d){return k==="meta"?"作品情報・編":(k.startsWith("c:")?"キャラクター「":"エピソード「")+((d&&(d.title||d.name))||"?")+"」"}

function chooseConflicts(list){
  return new Promise(res=>{
    const ov=$("#overlay");
    ov.innerHTML=`<div class="dialog"><h2 class="sec">両方で変更された項目があります</h2>
      <div class="hint">この端末とドライブの両方で、前回の同期のあとに変更されています。どちらを残すか選んでください。</div>
      <ul class="planlist">${list.map((c,i)=>`<li>${esc(labelKey(c.k,c.L.data||c.R.data))}
        <select data-ci="${i}"><option value="L">この端末の内容</option><option value="R">ドライブの内容</option></select></li>`).join("")}</ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="cf-ok">この内容で同期する</button><button class="btn" id="cf-cancel">同期をやめる</button></div></div>`;
    ov.hidden=false;
    $("#cf-ok").onclick=()=>{const ch={}; document.querySelectorAll("[data-ci]").forEach(s=>ch[s.dataset.ci]=s.value); res(ch);};
    $("#cf-cancel").onclick=()=>res(null);
  });
}
function busy(text){const ov=$("#overlay"); if(text==null){ov.hidden=true; ov.innerHTML=""; return;} ov.hidden=false; ov.innerHTML=`<div class="dialog"><p>${esc(text)}</p></div>`;}

let syncing=false;
async function sync(){
  if(syncing) return;
  if(!Drive.configured()){ setSave("Googleドライブの設定がまだです（config.js にクライアントIDを入れてください）",true); return; }
  if(!navigator.onLine){ setSave("オフラインのため同期できません。つながってからもう一度押してください",true); return; }
  syncing=true;
  try{
    await Drive.signIn();              // ボタン操作の直後にログイン画面を出す
    flushAll();
    busy("ドライブと同期しています…");
    const folder=await Drive.ensureFolder(await kvGet("folderId")); await kvSet("folderId",folder);
    const fileId=await Drive.findData(folder,await kvGet("dataFileId"));
    const remote=fileId?await Drive.readJson(fileId):{format:"kozo-drive",version:1,docs:{},images:{}};
    if(remote.format!=="kozo-drive") throw new Error("ドライブのデータの形式が違います");
    const rdocs=remote.docs||{}; const merged={...rdocs}; const toLocal=[]; const conflicts=[];
    const keys=new Set([...recs.keys(),...Object.keys(rdocs)]);
    const pack=L=>({data:L.data,updatedAt:L.updatedAt||Date.now(),deleted:!!L.deleted});
    for(const k of keys){
      const L=recs.get(k), R=rdocs[k];
      if(!L){ toLocal.push([k,{data:R.data,updatedAt:R.updatedAt,deleted:!!R.deleted,base:R.updatedAt,dirty:false}]); continue; }
      if(!R){ merged[k]=pack(L); toLocal.push([k,{...L,base:L.updatedAt,dirty:false}]); continue; }
      const Ru=R.updatedAt||0;
      if(!L.dirty){ if(Ru>(L.base||0)) toLocal.push([k,{data:R.data,updatedAt:Ru,deleted:!!R.deleted,base:Ru,dirty:false}]); continue; }
      if(Ru<=(L.base||0)){ merged[k]=pack(L); toLocal.push([k,{...L,base:L.updatedAt,dirty:false}]); continue; }
      if(stable(L.data)===stable(R.data)&&!!L.deleted===!!R.deleted){ toLocal.push([k,{...L,updatedAt:Ru,base:Ru,dirty:false}]); continue; }
      conflicts.push({k,L,R});
    }
    if(conflicts.length){
      busy(null);
      const ch=await chooseConflicts(conflicts);
      if(!ch){ busy(null); setSave("同期をやめました"); return; }
      busy("ドライブと同期しています…");
      conflicts.forEach((c,i)=>{
        if(ch[i]==="L"){ const now=Date.now(); merged[c.k]={...pack(c.L),updatedAt:now}; toLocal.push([c.k,{...c.L,updatedAt:now,base:now,dirty:false}]); }
        else toLocal.push([c.k,{data:c.R.data,updatedAt:c.R.updatedAt,deleted:!!c.R.deleted,base:c.R.updatedAt,dirty:false}]);
      });
    }
    // 画像：この端末で追加した画像を上げる
    const rimgs=remote.images||{};
    const limgs=new Map(await Store.entries("images"));
    let up=0;
    for(const [id,v] of limgs){
      if(!v) continue;
      if(!v.driveId){ busy(`画像を送っています…（${++up}）`); v.driveId=await Drive.uploadImage(folder,id,v.blob); await Store.put("images",id,v); }
      if(!rimgs[id]) rimgs[id]={driveId:v.driveId,type:v.blob.type||""};
    }
    const out={format:"kozo-drive",version:1,updatedAt:Date.now(),docs:merged,images:rimgs};
    busy("台帳データを保存しています…");
    if(fileId) await Drive.updateJson(fileId,out); else await kvSet("dataFileId",await Drive.createJson(folder,out));
    // ドライブに書けてから、端末側を同期済みにする
    await Store.putMany("docs",toLocal);
    for(const [k,v] of toLocal){
      if(timers.has(k)) continue; // 同期中に入力されたものは、端末側の最新を優先
      recs.set(k,v);
    }
    rebuild();
    // 画像：使われていて端末にない画像を取ってくる
    const used=new Set(); chars.forEach(c=>(c.images||[]).forEach(im=>used.add(im.id)));
    let dn=0;
    for(const id of used){
      if(limgs.has(id)||!rimgs[id]) continue;
      busy(`画像を受け取っています…（${++dn}）`);
      try{ const b=await Drive.downloadBlob(rimgs[id].driveId); await Store.put("images",id,{blob:b,driveId:rimgs[id].driveId,name:id}); urlCache.set(id,URL.createObjectURL(b)); }catch(e){}
    }
    const now=Date.now(); await kvSet("lastSync",now);
    busy(null); render(); updateSyncBadge();
    setSave(`同期しました（${new Date(now).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}）`);
  }catch(e){
    busy(null); setSave(e&&e.message?e.message:"同期できませんでした",true);
  }finally{ syncing=false; }
}

/* ---------- 取り込み（claude.ai の台帳や控えのファイル） ---------- */
function exportPayload(){
  return {format:"kozo-sync",version:1,exportedAt:Date.now(),source:"tablet",
    meta:stripId(meta), episodes:eps.map(e=>{const r=recs.get("e:"+e.id);return {...e,updatedAt:r&&r.updatedAt||0}}),
    characters:chars.map(c=>{const r=recs.get("c:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}})};
}
function downloadFile(name,text,type){
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type:type||"application/json"}));
  a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
}
function planImport(text,out){
  let d; try{ d=JSON.parse(text); }catch(e){ out.innerHTML=`<p class="err-t">読み込めませんでした。同期用のJSONか確認してください。</p>`; return; }
  if(!d||d.format!=="kozo-sync"){ out.innerHTML=`<p class="err-t">この台帳の書き出しファイルではありません。</p>`; return; }
  const items=[]; const t0=d.exportedAt||Date.now();
  const consider=(key,doc)=>{ if(!doc) return; const {id:_,baseUpdatedAt:__,...data}=doc; const iu=doc.updatedAt||t0; delete data.updatedAt;
    const cur=recs.get(key); let action;
    if(!cur||cur.deleted) action="add"; else if(iu>(cur.updatedAt||0)) action="update"; else action="skip";
    items.push({key,data,iu,action}); };
  consider("meta",d.meta); (d.episodes||[]).forEach(e=>consider("e:"+e.id,e)); (d.characters||[]).forEach(c=>consider("c:"+c.id,c));
  const todo=items.filter(i=>i.action!=="skip"); const cnt=a=>items.filter(i=>i.action===a).length;
  const imgs=Object.entries(d.images||{}).filter(([id])=>!urlCache.has(id));
  out.innerHTML=`<div class="plan"><p>追加 <b>${cnt("add")}</b>・更新 <b>${cnt("update")}</b>・変更なし（端末の方が新しい） <b>${cnt("skip")}</b>${imgs.length?`・画像 <b>${imgs.length}</b>`:""}</p>
    ${todo.length||imgs.length?`<button class="btn sm primary" id="i-apply">取り込む</button>`:`<p class="hint">取り込むものはありません。</p>`}</div>`;
  if(!todo.length&&!imgs.length) return;
  $("#i-apply").onclick=async()=>{
    $("#i-apply").disabled=true;
    const pairs=todo.map(i=>{const r={data:i.data,updatedAt:i.iu,base:(recs.get(i.key)||{}).base||0,dirty:true,deleted:false}; recs.set(i.key,r); return [i.key,r];});
    await Store.putMany("docs",pairs);
    let ni=0;
    for(const [id,im] of imgs){
      try{ const bin=atob(im.data); const u=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++) u[k]=bin.charCodeAt(k);
        const b=new Blob([u],{type:im.type||"image/png"}); await Store.put("images",id,{blob:b,driveId:null,name:id}); urlCache.set(id,URL.createObjectURL(b)); ni++; }catch(e){}
    }
    rebuild(); updateSyncBadge();
    out.innerHTML=`<p>${todo.length}件${ni?`と画像${ni}枚`:""}を取り込みました。「同期」を押すとドライブにも反映されます。</p>`;
  };
}

/* ---------- 描画 ---------- */
function renderHead(){
  if(meta){ $("#h-title").textContent=meta.title||"宿命刻の姫君"; $("#h-tag").textContent=meta.tagline||""; }
  ["edit","table","chars","policy"].forEach(v=>$("#v-"+v).setAttribute("aria-pressed",String(view===v)));
  if(view==="chars"){ $("#stats").innerHTML=loaded?`<span>キャラクター <b>${chars.length}</b></span><span>画像あり <b>${chars.filter(c=>c.images&&c.images.length).length}</b></span>`:""; return; }
  const r=ranges(); const total=eps.reduce((s,e)=>s+count(e),0);
  const by=s=>eps.filter(e=>e.status===s).length;
  const lastFixed=[...eps].reverse().find(e=>e.status==="確定"||e.status==="詳細プロット");
  $("#stats").innerHTML=loaded&&eps.length?
    `<span>エピソード <b>${eps.length}</b></span><span>Web話数（目安） <b>${total}</b></span>`+
    STATUSES.map(s=>by(s)?`<span>${s} <b>${by(s)}</b></span>`:"").join("")+
    (lastFixed?`<span>プロットがあるのは EP<b>${r[lastFixed.id].ep}</b>（Web<b>${rng(r[lastFixed.id])}</b>）まで</span>`:""):"";
}
function render(){
  renderHead();
  const m=$("#main");
  if(!loaded){ m.innerHTML=`<div class="notice">構成データを読み込んでいます…</div>`; return; }
  if(!eps.length&&!chars.length) return renderWelcome();
  if(view==="chars") return renderChars();
  if(view==="table") return renderTable();
  if(view==="policy") return renderPolicy();
  renderEdit();
}

function spineHTML(r){
  const ql=q.trim(); let html="", lastArc=null;
  eps.forEach(e=>{
    const hay=[e.title,e.summary,e.presents,e.orb,e.memo,e.open,(e.parts||[]).map(p=>p.title+p.beats+(p.note||"")).join("")].join(" ");
    if(ql&&!hay.includes(ql)) return;
    if(e.arc!==lastArc){ lastArc=e.arc;
      const inArc=eps.filter(x=>x.arc===e.arc); const a=r[inArc[0].id], b=r[inArc[inArc.length-1].id];
      html+=`<div class="arc">${esc(arcName(e.arc))}<span>EP${a.ep}${a.ep!==b.ep?"–"+b.ep:""}</span></div>`; }
    const x=r[e.id];
    html+=`<button class="row" data-id="${e.id}" aria-current="${e.id===selId}">
      <span class="no">EP${x.ep}</span><span class="t">${esc(e.title||"（無題）")}</span>
      <span class="w">Web ${rng(x)}</span><span class="st"><span class="chip s-${esc(e.status)}">${esc(e.status||"")}</span></span></button>`;
  });
  return html||`<div class="empty" style="padding:12px">「${esc(ql)}」に一致するエピソードはありません。</div>`;
}

function renderEdit(){
  const r=ranges();
  if(!eps.find(e=>e.id===selId)) selId=eps[0].id;
  const e=eps.find(x=>x.id===selId), x=r[e.id], idx=eps.indexOf(e);
  const m=$("#main");
  const hasParts=e.parts&&e.parts.length;
  m.innerHTML=`<div class="work ${window._mobileEditing?"editing":""}">
  <nav class="spine" aria-label="エピソード一覧">
    <div class="search"><input type="search" id="q" placeholder="題・内容・宿命刻で絞り込む" value="${esc(q)}"></div>
    <div id="spinelist">${spineHTML(r)}</div>
  </nav>
  <section class="desk">
    <div class="card">
      <div class="edhead">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn sm back" id="b-back">← 一覧</button>
          <span class="num">EP${x.ep} ・ Web ${rng(x)}（${x.c||"?"}話）</span>
          <span class="chip orb ${isReal(e.orb)?"real":""}">${esc(e.orb||"宿命刻：—")}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" id="b-up" ${idx===0?"disabled":""}>↑ 前へ</button>
          <button class="btn sm" id="b-down" ${idx===eps.length-1?"disabled":""}>↓ 後へ</button>
          <button class="btn sm" id="b-addafter">＋ この後に挿入</button>
          <button class="btn sm danger" id="b-del">削除</button>
        </div>
      </div>
      <div id="confirm"></div>
      <input class="titlein" id="f-title" value="${esc(e.title)}" aria-label="エピソードの題">
      <div class="grid">
        <label class="f">編<select id="f-arc">${(meta.arcs||[]).map(a=>`<option value="${a.id}" ${a.id===e.arc?"selected":""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="f">状態<select id="f-status">${STATUSES.map(s=>`<option ${s===e.status?"selected":""}>${s}</option>`).join("")}</select></label>
        <label class="f">トーン<input id="f-tone" value="${esc(e.tone)}"></label>
        <label class="f">Web話数${hasParts?"（各話の数から自動）":""}<input id="f-wc" type="number" min="0" max="20" value="${count(e)}" ${hasParts?"disabled":""}></label>
      </div>
      <label class="f block">宿命刻<input id="f-orb" value="${esc(e.orb)}" placeholder="例：本物：I 獄炎（ゼナ吸収）／ハズレ"></label>
      <label class="f block">内容<textarea id="f-summary" rows="5">${esc(e.summary)}</textarea></label>
      <label class="f block">提示するもの<textarea id="f-presents" rows="2">${esc(e.presents)}</textarea></label>
    </div>

    <div class="card">
      <h2 class="sec">各話のプロット <button class="btn sm" id="b-addpart">＋ 話を追加</button></h2>
      <div class="hint">1行が1つの流れ（ビート）です。話を足したり減らしたりすると、以降のWeb話数が自動で振り直されます。</div>
      <div class="parts">${hasParts?e.parts.map((p,i)=>`
        <div class="part">
          <div class="ph">
            <span class="pn">第${x.from!=null?x.from+i:"?"}話</span>
            <input class="pt" data-pi="${i}" value="${esc(p.title)}" aria-label="第${i+1}話の題">
            <button class="iconbtn" data-pup="${i}" aria-label="上へ" ${i===0?"disabled":""}>↑</button>
            <button class="iconbtn" data-pdown="${i}" aria-label="下へ" ${i===e.parts.length-1?"disabled":""}>↓</button>
            <button class="iconbtn" data-pdel="${i}" aria-label="この話を削除">×</button>
          </div>
          <textarea data-pb="${i}" rows="${rowsFor(p.beats,3)}" aria-label="第${i+1}話の流れ">${esc(p.beats)}</textarea>
          <label class="pnote"><span>補足・要確認</span><textarea data-pnote="${i}" rows="${rowsFor(p.note,1)}" placeholder="この話の演出メモ、字数配分、要確認など">${esc(p.note)}</textarea></label>
        </div>`).join(""):`<div class="empty">各話の割り振りはまだありません。「＋ 話を追加」で第1話から書き始められます。</div>`}
      </div>
    </div>

    <div class="card">
      <h2 class="sec">設計・演出メモ</h2>
      <div class="hint">決定事項、狙い、伏線、★の提案など。【】で見出しを付けると書き出しでも読みやすくなります。</div>
      <label class="f block" style="margin-top:6px"><textarea id="f-memo" rows="${rowsFor(e.memo,4)}" aria-label="設計・演出メモ">${esc(e.memo)}</textarea></label>
    </div>

    <div class="card">
      <h2 class="sec">未決・確認事項</h2>
      <label class="f block" style="margin-top:6px"><textarea id="f-open" rows="3" aria-label="未決・確認事項">${esc(e.open)}</textarea></label>
      <label class="f block">元の資料<input id="f-source" value="${esc(e.source)}"></label>
    </div>
  </section></div>`;
  wireEdit(e);
}

function wireEdit(e){
  const id=e.id;
  $("#q").oninput=ev=>{q=ev.target.value; $("#spinelist").innerHTML=spineHTML(ranges()); wireSpine();};
  wireSpine();
  const bind=(sel,key,num)=>{$(sel).oninput=ev=>{edit(id,o=>{o[key]=num?Number(ev.target.value)||0:ev.target.value}); if(key==="title"||key==="webCount") refreshSide();};};
  bind("#f-title","title"); bind("#f-tone","tone"); bind("#f-orb","orb"); bind("#f-summary","summary");
  bind("#f-presents","presents"); bind("#f-open","open"); bind("#f-memo","memo");
  document.querySelectorAll("[data-pnote]").forEach(el=>el.oninput=ev=>edit(id,o=>o.parts[+el.dataset.pnote].note=ev.target.value)); bind("#f-source","source"); bind("#f-wc","webCount",true);
  $("#f-arc").onchange=ev=>{edit(id,o=>o.arc=ev.target.value); render();};
  $("#f-status").onchange=ev=>{edit(id,o=>o.status=ev.target.value); render();};
  document.querySelectorAll("[data-pi]").forEach(el=>el.oninput=ev=>edit(id,o=>o.parts[+el.dataset.pi].title=ev.target.value));
  document.querySelectorAll("[data-pb]").forEach(el=>el.oninput=ev=>edit(id,o=>o.parts[+el.dataset.pb].beats=ev.target.value));
  const mv=(a,b)=>edit(id,o=>{const t=o.parts[a];o.parts[a]=o.parts[b];o.parts[b]=t});
  document.querySelectorAll("[data-pup]").forEach(el=>el.onclick=()=>{mv(+el.dataset.pup,+el.dataset.pup-1);render()});
  document.querySelectorAll("[data-pdown]").forEach(el=>el.onclick=()=>{mv(+el.dataset.pdown,+el.dataset.pdown+1);render()});
  document.querySelectorAll("[data-pdel]").forEach(el=>el.onclick=()=>{
    const i=+el.dataset.pdel; const p=e.parts[i];
    if((p.title||p.beats)&&pendingDelete!=="p"+i){pendingDelete="p"+i; el.textContent="?"; el.setAttribute("aria-label","もう一度押すと削除"); el.title="もう一度押すと削除"; return;}
    pendingDelete=null; edit(id,o=>{o.parts.splice(i,1); if(!o.parts.length) o.webCount=1;}); render();});
  $("#b-addpart").onclick=()=>{edit(id,o=>{o.parts=o.parts||[];o.parts.push({title:"新しい話",beats:""})}); render();
    const ts=document.querySelectorAll("[data-pi]"); ts[ts.length-1]?.select();};
  $("#b-up").onclick=()=>moveEp(id,-1); $("#b-down").onclick=()=>moveEp(id,1);
  $("#b-addafter").onclick=()=>addEp(id);
  $("#b-back").onclick=()=>{window._mobileEditing=false; render();};
  $("#b-del").onclick=()=>{
    $("#confirm").innerHTML=`<div class="confirm" style="margin-top:10px">「${esc(e.title)}」を削除します。各話のプロットも消えます。<button class="btn sm danger" id="b-delyes">削除する</button><button class="btn sm" id="b-delno">やめる</button></div>`;
    $("#b-delno").onclick=()=>$("#confirm").innerHTML="";
    $("#b-delyes").onclick=async()=>{const i=eps.findIndex(x=>x.id===id); await removeDoc(id); selId=(eps[i+1]||eps[i-1]||{}).id; render();};
  };
}
function wireSpine(){document.querySelectorAll(".row").forEach(b=>b.onclick=()=>{selId=b.dataset.id; window._mobileEditing=true; try{localStorage.setItem("kozo.sel",selId)}catch(e){} render(); window.scrollTo({top:0})});}
function refreshSide(){ const s=$("#spinelist"); if(s){ s.innerHTML=spineHTML(ranges()); wireSpine(); } renderHead(); }

async function moveEp(id,dir){
  const i=eps.findIndex(e=>e.id===id), j=i+dir; if(j<0||j>=eps.length) return;
  const a=eps[i], b=eps[j];
  // 違う編に移るときは、移動先の編に合わせる
  const oa=a.order, ob=b.order;
  edit(a.id,o=>{o.order=ob; if(b.arc!==a.arc&&eps.filter(x=>x.arc===a.arc).length>1) o.arc=b.arc;});
  edit(b.id,o=>{o.order=oa;});
  eps.sort((x,y)=>x.order-y.order); render();
}
async function addEp(afterId){
  const i=afterId?eps.findIndex(e=>e.id===afterId):-1;
  const prev=eps[i], next=eps[i+1];
  const order=prev?(next?(prev.order+next.order)/2:prev.order+10):(eps[0]?eps[0].order-10:10);
  const body={title:"新しいエピソード",arc:prev?prev.arc:(meta.arcs[0]||{}).id,status:"未着手",tone:"",orb:"",webCount:3,summary:"",presents:"",parts:[],open:"",source:"",order};
  selId=await addDoc("e",body); window._mobileEditing=true; render();
}

function renderTable(){
  const r=ranges(); let html="", last=null;
  eps.forEach(e=>{
    if(e.arc!==last){last=e.arc; html+=`<tr class="arcrow"><td colspan="6">${esc(arcName(e.arc))}</td></tr>`;}
    const x=r[e.id];
    html+=`<tr class="ep" data-id="${e.id}" tabindex="0"><td class="n">${x.ep}</td><td class="w">${rng(x)}</td>
      <td><span class="tt">${esc(e.title)}</span><span class="chip s-${esc(e.status)}">${esc(e.status)}</span> ${e.tone?`<span class="hint">${esc(e.tone)}</span>`:""}</td>
      <td class="sum">${esc(e.summary)}</td><td class="pres">${esc(e.presents)}</td>
      <td><span class="chip orb ${isReal(e.orb)?"real":""}">${esc(e.orb||"—")}</span></td></tr>`;
  });
  $("#main").innerHTML=`<div class="tablewrap"><table><thead><tr><th>EP</th><th>Web話数</th><th>題・状態</th><th>内容</th><th>提示するもの</th><th>宿命刻</th></tr></thead><tbody>${html}</tbody></table></div>`;
  document.querySelectorAll("tr.ep").forEach(t=>{const go=()=>{selId=t.dataset.id; view="edit"; window._mobileEditing=true; saveView(); render(); window.scrollTo({top:0})}; t.onclick=go; t.onkeydown=ev=>{if(ev.key==="Enter")go()};});
}

function renderPolicy(){
  const r=ranges();
  $("#main").innerHTML=`<div class="policy">
    <div class="card">
      <h2 class="sec">作品</h2>
      <label class="f block">題<input id="m-title" value="${esc(meta.title)}"></label>
      <label class="f block">キャッチ<input id="m-tag" value="${esc(meta.tagline)}"></label>
      <label class="f block">ログライン<textarea id="m-log" rows="3">${esc(meta.logline)}</textarea></label>
      <label class="f block">構成の方針（1行に1項目）<textarea id="m-policy" rows="10">${esc(meta.policy)}</textarea></label>
    </div>
    <div class="card">
      <h2 class="sec">編 <button class="btn sm" id="b-addarc">＋ 編を追加</button></h2>
      <div class="hint">名前を変えると一覧と構成表に反映されます。エピソードの所属は編集台の「編」で変えます。</div>
      <div class="arclist">${(meta.arcs||[]).map((a,i)=>{const n=eps.filter(e=>e.arc===a.id); const w=n.reduce((s,e)=>s+count(e),0);
        return `<div class="arcedit"><input data-ai="${i}" value="${esc(a.name)}" aria-label="編の名前"><span class="cnt">${n.length}話/${w}</span>
        <button class="iconbtn" data-adel="${i}" aria-label="この編を削除" ${n.length?"disabled title='エピソードがある編は削除できません'":""}>×</button></div>`}).join("")}</div>
    </div></div>`;
  const b=(s,k)=>$(s).oninput=ev=>{edit("__meta",o=>o[k]=ev.target.value); if(k==="title"||k==="tagline") renderHead();};
  b("#m-title","title"); b("#m-tag","tagline"); b("#m-log","logline"); b("#m-policy","policy");
  document.querySelectorAll("[data-ai]").forEach(el=>el.oninput=ev=>edit("__meta",o=>o.arcs[+el.dataset.ai].name=ev.target.value));
  document.querySelectorAll("[data-adel]").forEach(el=>el.onclick=()=>{edit("__meta",o=>o.arcs.splice(+el.dataset.adel,1)); render();});
  $("#b-addarc").onclick=()=>{edit("__meta",o=>o.arcs.push({id:"a"+Date.now().toString(36),name:"新しい編"})); render();};
  renderSyncCard();
}

/* ---------- キャラクター ---------- */
function aliasesOf(c){return String(c.aliases||c.name||"").split(/[,、，]/).map(s=>s.trim()).filter(s=>s.length>=2)}
function appearances(c){
  const al=aliasesOf(c); if(!al.length) return [];
  const r=ranges();
  return eps.filter(e=>{const t=[e.title,e.summary,e.presents,(e.parts||[]).map(p=>p.title+" "+p.beats).join(" ")].join(" ");return al.some(a=>t.includes(a))}).map(e=>({e,x:r[e.id]}));
}
function charListHTML(){
  const ql=cq.trim(); let html="", last=null;
  chars.forEach(c=>{
    const hay=[c.name,c.aliases,c.role,c.group,c.orb,c.profile,c.personality,c.arc,c.relations].join(" ");
    if(ql&&!hay.includes(ql)) return;
    if(c.group!==last){last=c.group; html+=`<div class="arc">${esc(c.group||"（区分なし）")}<span>${chars.filter(x=>x.group===c.group).length}人</span></div>`;}
    const img=c.images&&c.images[0];
    html+=`<button class="crow" data-cid="${c.id}" aria-current="${c.id===charSel}">
      <span class="av">${img?`<img src="${blob(img.id)}" alt="" loading="lazy">`:`<span>${esc((c.name||"？").slice(0,1))}</span>`}</span>
      <span class="ct"><b>${esc(c.name||"（名前未定）")}</b><span>${esc(c.role)}</span></span></button>`;
  });
  return html||`<div class="empty" style="padding:12px">「${esc(ql)}」に一致する人物はいません。</div>`;
}
function wireCharList(){document.querySelectorAll(".crow").forEach(b=>b.onclick=()=>{charSel=b.dataset.cid; window._mobileEditing=true; try{localStorage.setItem("kozo.char",charSel)}catch(e){} render(); window.scrollTo({top:0})});}

function renderChars(){
  const m=$("#main");
  if(!chars.length){ m.innerHTML=`<div class="notice">まだキャラクターがいません。<button class="btn primary" id="c-first">最初の人物を追加</button></div>`; $("#c-first").onclick=()=>addChar(null); return; }
  if(!chars.find(c=>c.id===charSel)) charSel=chars[0].id;
  const c=chars.find(x=>x.id===charSel), idx=chars.indexOf(c), id="c:"+c.id;
  const imgs=c.images||[]; const groups=[...new Set(chars.map(x=>x.group).filter(Boolean))];
  const ap=appearances(c);
  const ta=(k,label,min,hint)=>`<label class="f block">${label}${hint?`<span class="hint" style="letter-spacing:0">${hint}</span>`:""}<textarea data-ck="${k}" rows="${rowsFor(c[k],min)}">${esc(c[k])}</textarea></label>`;
  m.innerHTML=`<div class="work ${window._mobileEditing?"editing":""}">
  <nav class="spine" aria-label="キャラクター一覧">
    <div class="search"><input type="search" id="cq" placeholder="名前・役割・宿命刻で絞り込む" value="${esc(cq)}"></div>
    <div id="charlist">${charListHTML()}</div>
    <div style="padding:10px"><button class="btn sm" id="c-add" style="width:100%">＋ 人物を追加</button></div>
  </nav>
  <section class="desk">
    <div class="card">
      <div class="edhead">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn sm back" id="c-back">← 一覧</button>
          <span class="chip s-${c.status&&c.status.startsWith("決定")?"確定":"たたき台"}">${esc(c.status||"")}</span>
          <span class="chip orb ${c.orb&&!/^—/.test(c.orb)?"real":""}">${esc(c.orb||"宿命刻：—")}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" id="c-up" ${idx===0?"disabled":""}>↑ 前へ</button>
          <button class="btn sm" id="c-down" ${idx===chars.length-1?"disabled":""}>↓ 後へ</button>
          <button class="btn sm danger" id="c-del">削除</button>
        </div>
      </div>
      <div id="cconfirm"></div>
      <div class="charhead">
        <figure class="portrait">${imgs[0]?`<img src="${blob(imgs[0].id)}" alt="${esc(c.name)}のイメージ">`:`<div class="noimg">${esc((c.name||"？").slice(0,1))}<span>画像なし</span></div>`}</figure>
        <div class="charmain">
          <input class="titlein" data-ck="name" value="${esc(c.name)}" aria-label="名前">
          <input class="rolein" data-ck="role" value="${esc(c.role)}" placeholder="一行の役割" aria-label="役割">
          <div class="grid">
            <label class="f">区分<input data-ck="group" list="grouplist" value="${esc(c.group)}"><datalist id="grouplist">${groups.map(g=>`<option value="${esc(g)}">`).join("")}</datalist></label>
            <label class="f">状態<input data-ck="status" list="cstatus" value="${esc(c.status)}"><datalist id="cstatus">${CHAR_STATUSES.map(s=>`<option value="${s}">`).join("")}</datalist></label>
            <label class="f">初登場<input data-ck="first" value="${esc(c.first)}"></label>
          </div>
          <label class="f block">宿命刻<input data-ck="orb" value="${esc(c.orb)}"></label>
          <label class="f block">呼び名（読点区切り。登場エピソードの検索に使います）<input data-ck="aliases" value="${esc(c.aliases)}"></label>
        </div>
      </div>
      <div class="block"><span class="hint">本文に名前が出るエピソード（${ap.length}）</span>
        <div class="apps">${ap.length?ap.map(a=>`<button class="chip appchip" data-goep="${a.e.id}">EP${a.x.ep} ${esc(a.e.title)}</button>`).join(""):`<span class="hint">見つかりません</span>`}</div></div>
    </div>

    <div class="card">
      <h2 class="sec">イメージ画像 <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="hint" id="up-state"></span><label class="btn sm primary" id="up-label" hidden>＋ 画像を追加<input type="file" id="up" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label></span></h2>
      <div class="hint" id="up-hint">先頭の画像が一覧と見出しに使われます。</div>
      <div class="gallery">${imgs.length?imgs.map((im,i)=>`
        <figure class="gimg">
          <img src="${blob(im.id)}" alt="${esc(im.caption||c.name)}" loading="lazy">
          <input data-cap="${i}" value="${esc(im.caption)}" placeholder="説明（例：参考画像 2026-10-08版）" aria-label="画像の説明">
          <div class="gbtns">${i?`<button class="btn sm" data-main="${i}">先頭にする</button>`:`<span class="hint">メイン</span>`}<button class="btn sm danger" data-idel="${i}">外す</button></div>
        </figure>`).join(""):`<div class="empty">まだ画像はありません。「＋ 画像を追加」から、PNG・JPEG・WebP・GIFを登録できます。大きな写真は自動で縮めて保存します。</div>`}</div>
    </div>

    <div class="card">
      <h2 class="sec">設定</h2>
      ${ta("profile","基本設定",4)}
      ${ta("personality","性格・口調・癖",3)}
      ${ta("appearance","外見",2)}
      ${ta("arc","物語での変化・テーマ・終盤",3)}
      ${ta("relations","関係（1行に1人）",2)}
      ${ta("memo","未決・★案",2)}
    </div>
  </section></div>`;
  wireChars(c,id);
}
function wireChars(c,id){
  $("#cq").oninput=ev=>{cq=ev.target.value; $("#charlist").innerHTML=charListHTML(); wireCharList();};
  wireCharList();
  document.querySelectorAll("[data-ck]").forEach(el=>el.oninput=ev=>{const k=el.dataset.ck; edit(id,o=>o[k]=ev.target.value);
    if(k==="name"||k==="role"||k==="group"){ $("#charlist").innerHTML=charListHTML(); wireCharList(); }});
  document.querySelectorAll("[data-cap]").forEach(el=>el.oninput=ev=>edit(id,o=>o.images[+el.dataset.cap].caption=ev.target.value));
  document.querySelectorAll("[data-main]").forEach(el=>el.onclick=()=>{const i=+el.dataset.main; edit(id,o=>{const [im]=o.images.splice(i,1); o.images.unshift(im)}); render();});
  document.querySelectorAll("[data-idel]").forEach(el=>el.onclick=()=>{
    const i=+el.dataset.idel;
    if(pendingDelete!=="img"+i){pendingDelete="img"+i; el.textContent="もう一度押すと外す"; return;}
    pendingDelete=null; const im=c.images[i];
    edit(id,o=>o.images.splice(i,1)); render();
    if(im) removeImage(im.id);
  });
  document.querySelectorAll("[data-goep]").forEach(el=>el.onclick=()=>{selId=el.dataset.goep; view="edit"; window._mobileEditing=true; saveView(); render(); window.scrollTo({top:0})});
  $("#c-back").onclick=()=>{window._mobileEditing=false; render();};
  $("#c-add").onclick=()=>addChar(c.id);
  $("#c-up").onclick=()=>moveChar(c.id,-1); $("#c-down").onclick=()=>moveChar(c.id,1);
  $("#c-del").onclick=()=>{
    $("#cconfirm").innerHTML=`<div class="confirm" style="margin-top:10px">「${esc(c.name)}」を削除します。設定と画像の登録も消えます。<button class="btn sm danger" id="c-delyes">削除する</button><button class="btn sm" id="c-delno">やめる</button></div>`;
    $("#c-delno").onclick=()=>$("#cconfirm").innerHTML="";
    $("#c-delyes").onclick=async()=>{const i=chars.findIndex(x=>x.id===c.id); await removeDoc("c:"+c.id); charSel=(chars[i+1]||chars[i-1]||{}).id; render();};
  };
  // 画像のアップロード（編集できる人だけ）
  if(true){
    $("#up-label").hidden=false;
    $("#up").onchange=async ev=>{
      const files=[...ev.target.files]; ev.target.value="";
      for(const f of files){
        $("#up-state").textContent=`アップロード中… ${f.name}`;
        try{ const r=await addImage(f); edit(id,o=>{o.images=o.images||[]; o.images.push({id:r.id,caption:""})}); }
        catch(e){ const msg={too_large:"20MBを超える画像は登録できません",unsupported_type:"PNG・JPEG・WebP・GIFのみ登録できます",quota_or_state:"保存容量がいっぱいです",rate_limited:"少し待ってからもう一度お試しください"}[e&&e.code]||"アップロードできませんでした";
          $("#up-state").textContent=msg+`（${f.name}）`; return; }
      }
      $("#up-state").textContent=""; render();
    };
  } else {
    $("#up-hint").textContent="画像の追加は、この台帳を編集できる人だけができます。";
  }
}
function moveChar(cid,dir){
  const i=chars.findIndex(c=>c.id===cid), j=i+dir; if(j<0||j>=chars.length) return;
  const a=chars[i], b=chars[j], oa=a.order, ob=b.order;
  edit("c:"+a.id,o=>{o.order=ob; if(b.group!==a.group) o.group=b.group;}); edit("c:"+b.id,o=>{o.order=oa;});
  chars.sort((x,y)=>x.order-y.order); render();
}
async function addChar(afterId){
  const i=afterId?chars.findIndex(c=>c.id===afterId):-1; const prev=chars[i], next=chars[i+1];
  const order=prev?(next?(prev.order+next.order)/2:prev.order+10):10;
  const body={name:"新しい人物",aliases:"",group:prev?prev.group:"主人公たち",role:"",status:"検討中",orb:"",first:"",profile:"",personality:"",appearance:"",arc:"",relations:"",memo:"",images:[],order};
  charSel=await addDoc("c",body); window._mobileEditing=true; render();
}

/* ---------- 書き出し ---------- */
function toMarkdown(){
  const r=ranges(); const L=[];
  L.push(`# ${meta.title}　シリーズ構成（構成台帳から書き出し）`,"",`- 書き出し：${new Date().toLocaleString("ja-JP")}`,"");
  if(meta.logline) L.push(meta.logline,"");
  if(meta.policy){L.push("## 構成の方針","");meta.policy.split("\n").filter(Boolean).forEach(l=>L.push("- "+l));L.push("");}
  L.push("## 構成表","","| エピソード | Web話数 | 編 | 題 | 状態 | 内容 | 提示するもの | 宿命刻 |","|---|---|---|---|---|---|---|---|");
  const cell=s=>String(s||"").replace(/\|/g,"／").replace(/\n/g," ");
  eps.forEach(e=>{const x=r[e.id]; L.push(`| ${x.ep} | ${rng(x)} | ${cell(arcName(e.arc))} | ${cell(e.title)} | ${e.status} | ${cell(e.summary)} | ${cell(e.presents)} | ${cell(e.orb)} |`)});
  L.push("");
  eps.forEach(e=>{const x=r[e.id];
    L.push("---","",`## エピソード${x.ep}「${e.title}」（Web${rng(x)}話）`,"",`- 編：${arcName(e.arc)}／状態：${e.status}${e.tone?"／トーン："+e.tone:""}${e.orb?"／宿命刻："+e.orb:""}`);
    if(e.source) L.push(`- 元の資料：${e.source}`);
    L.push("");
    if(e.summary) L.push(e.summary,"");
    (e.parts||[]).forEach((p,i)=>{L.push(`### 第${x.from!=null?x.from+i:"?"}話　${p.title}`,"");(p.beats||"").split("\n").filter(Boolean).forEach((b,k)=>L.push(`${k+1}. ${b}`));L.push("");
      if(p.note){L.push("**補足・要確認**","");p.note.split("\n").filter(Boolean).forEach(n=>L.push("- "+n));L.push("");}});
    if(e.memo){L.push("### 設計・演出メモ","");e.memo.split("\n").filter(Boolean).forEach(n=>L.push("- "+n));L.push("");}
    if(e.open) L.push("**未決**："+e.open.replace(/\n/g,"／"),"");
  });
  if(chars.length){
    L.push("---","","## キャラクター","");
    let g=null;
    chars.forEach(c=>{
      if(c.group!==g){g=c.group; L.push(`### ${g||"（区分なし）"}`,"");}
      L.push(`#### ${c.name}${c.role?"　— "+c.role:""}`,"",`- 状態：${c.status||"—"}／宿命刻：${c.orb||"—"}／初登場：${c.first||"—"}`);
      if(c.aliases) L.push(`- 呼び名：${c.aliases}`);
      L.push("");
      [["基本設定","profile"],["性格・口調・癖","personality"],["外見","appearance"],["物語での変化・テーマ・終盤","arc"],["関係","relations"],["未決・★案","memo"]].forEach(([h,k])=>{
        if(!c[k]) return; L.push(`**${h}**`,""); c[k].split("\n").filter(Boolean).forEach(l=>L.push("- "+l)); L.push("");});
    });
  }
  return L.join("\n");
}
$("#b-export").onclick=async()=>{
  if(!loaded||!eps.length) return;
  const md=toMarkdown(); const m=$("#main");
  const box=document.createElement("div"); box.className="card"; box.style.margin="8px 0";
  box.innerHTML=`<h2 class="sec">Markdownで書き出す <span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" id="x-copy">コピー</button><button class="btn sm" id="x-dl" hidden>.mdファイルを保存</button><button class="btn sm" id="x-close">閉じる</button></span></h2>
    <div class="hint">プロジェクトの資料（シリーズ構成.md など）に貼り付けられる形です。</div><pre class="md" id="x-pre"></pre>`;
  m.prepend(box); $("#x-pre").textContent=md;
  $("#x-close").onclick=()=>box.remove();
  $("#x-copy").onclick=async()=>{try{await navigator.clipboard.writeText(md);$("#x-copy").textContent="コピーしました"}catch(e){const s=getSelection(),rg=document.createRange();rg.selectNodeContents($("#x-pre"));s.removeAllRanges();s.addRange(rg);$("#x-copy").textContent="選択しました（Ctrl+Cでコピー）"}};
  const dl={save:async({filename,data})=>downloadFile(filename,data,"text/markdown")};
  if(dl){ $("#x-dl").hidden=false; $("#x-dl").onclick=async()=>{try{await dl.save({filename:"シリーズ構成_書き出し.md",data:md})}catch(e){}}; }
};

function saveView(){try{localStorage.setItem("kozo.view",view)}catch(e){}}
["edit","table","chars","policy"].forEach(v=>$("#v-"+v).onclick=()=>{view=v; saveView(); if(v==="edit"||v==="chars") window._mobileEditing=false; render();});


/* ---------- 同期とデータ（方針・編タブ） ---------- */
async function renderSyncCard(){
  const host=document.querySelector(".policy"); if(!host) return;
  const last=await kvGet("lastSync"); const n=await unsyncedCount();
  let quota=""; try{ const e=await navigator.storage.estimate(); quota=`端末の使用量 ${(e.usage/1048576).toFixed(1)}MB`; }catch(e){}
  let persisted=false; try{ persisted=await navigator.storage.persisted(); }catch(e){}
  if(!document.querySelector(".policy")) return;
  host.insertAdjacentHTML("beforeend",`<div class="card" style="grid-column:1/-1">
    <h2 class="sec">同期とデータ</h2>
    <div class="syncgrid">
      <div><b>Googleドライブ</b>
        <p class="hint">${Drive.configured()?`保存先：マイドライブ「${esc(Drive.FOLDER)}」フォルダ`:"まだ設定されていません（config.js にクライアントIDを入れてください）"}</p>
        <p class="hint">前回の同期：${last?new Date(last).toLocaleString("ja-JP"):"まだありません"}／未同期 ${n}件</p>
        <button class="btn sm primary" id="s-sync">今すぐ同期</button></div>
      <div><b>取り込む</b><p class="hint">claude.ai の台帳や、控えのファイル（JSON）から読み込みます。新しい方が残ります。</p>
        <label class="btn sm">ファイルを選ぶ<input type="file" id="s-file" accept=".json,application/json" hidden></label>
        <div id="s-plan"></div></div>
      <div><b>控えを書き出す</b><p class="hint">この端末の内容をファイル（JSON）に保存します。画像は含まれません。</p>
        <button class="btn sm" id="s-dl">ファイルに保存</button></div>
      <div><b>この端末</b><p class="hint">${quota}${quota?"／":""}${persisted?"データは自動では消されない設定です":"空き容量が少ないと、ブラウザがデータを消すことがあります。こまめに同期してください"}</p></div>
    </div></div>`);
  $("#s-sync").onclick=()=>sync();
  $("#s-file").onchange=async ev=>{const f=ev.target.files[0]; ev.target.value=""; if(f) planImport(await f.text(),$("#s-plan"));};
  $("#s-dl").onclick=()=>{const d=new Date(); downloadFile(`宿命刻の姫君_控え_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.json`,JSON.stringify(exportPayload()));};
}

/* ---------- データがないときの最初の画面 ---------- */
function renderWelcome(){
  $("#main").innerHTML=`<div class="card welcome">
    <h2 class="sec">はじめに</h2>
    <p>この端末にはまだ台帳のデータがありません。どちらかの方法で始めてください。</p>
    <div class="syncgrid">
      <div><b>Googleドライブから読み込む</b><p class="hint">ほかの端末で同期したことがあれば、こちら。</p><button class="btn primary" id="w-sync">同期して読み込む</button></div>
      <div><b>ファイルから取り込む</b><p class="hint">claude.ai の台帳から書き出したファイル（JSON）を選びます。最初の移行はこちら。</p>
        <label class="btn">ファイルを選ぶ<input type="file" id="w-file" accept=".json,application/json" hidden></label><div id="w-plan"></div></div>
    </div></div>`;
  $("#w-sync").onclick=()=>sync();
  $("#w-file").onchange=async ev=>{const f=ev.target.files[0]; ev.target.value=""; if(!f) return; planImport(await f.text(),$("#w-plan"));
    const b=$("#i-apply"); if(b){ const orig=b.onclick; b.onclick=async()=>{ await orig(); render(); }; } };
}

/* ---------- 起動 ---------- */
$("#b-sync").onclick=()=>sync();
(async()=>{
  try{ if(navigator.storage&&navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  try{
    for(const [k,v] of await Store.entries("docs")) recs.set(k,v);
    for(const [k,v] of await Store.entries("images")) if(v&&v.blob) urlCache.set(k,URL.createObjectURL(v.blob));
  }catch(e){ setSave("端末の保存領域を開けませんでした",true); }
  rebuild(); loaded=true; render(); updateSyncBadge();
  if(navigator.onLine&&Drive.configured()) Drive.preload().catch(()=>{});
})();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));

})();
