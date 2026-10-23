/* 宿命刻の姫君 構成台帳（ドライブ版） */
(function(){
const STATUSES=["確定","詳細プロット","骨格のみ","たたき台","未着手"];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let eps=[], meta=null, loaded=false, view="edit", selId=null, q="";
let pendingDelete=null, exportOpen=false;
let chars=[], charSel=null, cq="";
let setts=[], orbs=[], loreSel=null, lq="", loreMode="items";
let threads=[], decisions=[], drafts=[]; // 伏線（f:）・決定ログ（d:）・本文の下書き（w:）
try{loreSel=localStorage.getItem("kozo.lore"); loreMode=localStorage.getItem("kozo.loreMode")||"items";}catch(e){}
const CHAR_STATUSES=["決定","決定（細部は検討中）","決定（名前未定）","決定（中身未定）","検討中","未配置"];
try{charSel=localStorage.getItem("kozo.char");}catch(e){}
const dirty=new Map(); // id -> timer
const local=new Map(); // id -> object under edit
try{const v=localStorage.getItem("kozo.view"); if(v) view=v; selId=localStorage.getItem("kozo.sel");}catch(e){}
let draftRefSaved=null; try{draftRefSaved=JSON.parse(localStorage.getItem("kozo.dr")||"null")}catch(e){}

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
const recs=new Map(); // "meta" / "e:<id>" / "c:<id>" / "s:<id>"（設定） / "o:<文字>"（宿命刻） → {data, updatedAt, base, dirty, deleted}
const urlCache=new Map(); // 画像ID → 表示用URL
const PLACEHOLDER="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"><rect width="3" height="4" fill="#8888"/></svg>');
const stripId=o=>{const {id:_,...b}=o;return b};
const keyOf=id=>id==="__meta"?"meta":/^[csofdw]:/.test(id)?id:"e:"+id;
function blob(id){return urlCache.get(id)||PLACEHOLDER}
function defaultMeta(){return {title:"宿命刻の姫君",tagline:"",logline:"",policy:"",arcs:[]}}
function rebuild(){
  eps=[]; chars=[]; setts=[]; orbs=[]; threads=[]; decisions=[]; drafts=[]; let m=null;
  for(const [k,r] of recs){
    if(!r||r.deleted||!r.data) continue;
    if(k==="meta") m={...r.data};
    else if(k.startsWith("e:")) eps.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("c:")) chars.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("s:")) setts.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("o:")) orbs.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("f:")) threads.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("d:")) decisions.push({id:k.slice(2),...structuredClone(r.data)});
    else if(k.startsWith("w:")) drafts.push({id:k.slice(2),...structuredClone(r.data)});
  }
  decisions.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  eps.sort((a,b)=>(a.order||0)-(b.order||0)); chars.sort((a,b)=>(a.order||0)-(b.order||0));
  setts.sort((a,b)=>(a.order||0)-(b.order||0)); orbs.sort((a,b)=>String(a.letter||a.id).localeCompare(String(b.letter||b.id)));
  meta=m||defaultMeta(); meta.arcs=meta.arcs||[];
}
function setSave(t,err){const s=$("#save");s.textContent=t;s.classList.toggle("err",!!err)}
const timers=new Map();
/* ---------- 履歴（この端末で記録。項目ごとに最新15件） ---------- */
const HIST_MAX=15, HIST_GAP=10*60*1000;
const histLast=new Map(); // docキー → 最後に記録した時刻
let histChain=Promise.resolve();
function histAdd(key,kind,rec){
  if(!rec||rec.data==null) return histChain;
  const snap={data:structuredClone(rec.data),deleted:!!rec.deleted,updatedAt:rec.updatedAt||0};
  histChain=histChain.then(async()=>{
    try{
      const mine=(await Store.entries("history")).filter(([k])=>k.startsWith(key+"|")).sort((a,b)=>b[1].ts-a[1].ts);
      // 直前の記録と同じ内容なら、種類だけ違っても重ねて残さない（競合は必ず残す）
      if(mine[0]&&/^(編集前|同期で送った版|戻す前)$/.test(kind)&&stable(mine[0][1].data)===stable(snap.data)&&mine[0][1].deleted===snap.deleted){ histLast.set(key,Date.now()); return; }
      const ts=Date.now()+Math.random(); // 同じ瞬間の記録が重ならないように
      await Store.put("history",key+"|"+ts,{key,ts,kind,...snap});
      histLast.set(key,Date.now());
      for(const [k] of mine.slice(HIST_MAX-1)) await Store.del("history",k);
    }catch(e){}
  });
  return histChain;
}
function touch(key,data,deleted){
  let r=recs.get(key);
  // しばらく間をあけて編集を始めたときは、編集前の状態を履歴に残す
  if(r&&r.data&&Date.now()-(histLast.get(key)||0)>HIST_GAP) histAdd(key,"編集前",r);
  if(!r) r={base:0,snap:null};                 // 新しく作った項目（破棄すると消える）
  else if(!r.dirty) r.snap={data:r.data,updatedAt:r.updatedAt,deleted:!!r.deleted}; // 同期済みの状態を控える
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
  const cid=id.slice(2);
  const obj=id==="__meta"?meta:id.startsWith("c:")?chars.find(c=>c.id===cid):id.startsWith("s:")?setts.find(c=>c.id===cid):id.startsWith("o:")?orbs.find(c=>c.id===cid):id.startsWith("f:")?threads.find(c=>c.id===cid):id.startsWith("d:")?decisions.find(c=>c.id===cid):id.startsWith("w:")?drafts.find(c=>c.id===cid):eps.find(e=>e.id===id);
  if(!obj) return;
  mut(obj);
  touch(keyOf(id),structuredClone(stripId(obj)),false);
}
function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
async function addDoc(kind,body){
  const id=newId({c:"ch",s:"st",f:"fs",d:"dc"}[kind]||"ep"); const key=("csfd".includes(kind)?kind+":":"e:")+id;
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
  const d=$("#b-discard"); if(d) d.hidden=!n;
  $("#net").textContent=navigator.onLine?"":"オフライン";
}
window.addEventListener("online",updateSyncBadge); window.addEventListener("offline",updateSyncBadge);

const stable=v=>Array.isArray(v)?"["+v.map(stable).join(",")+"]":(v&&typeof v==="object")?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(v);
function labelKey(k,d){if(k==="meta")return "作品情報・編"; if(k.startsWith("o:"))return "宿命刻 "+k.slice(2); if(k.startsWith("w:")) return typeof draftLabel==="function"&&drafts.length?draftLabel(k):"本文「"+((d&&d.title)||"?")+"」"; if(k.startsWith("d:")) return "決定ログ「"+((d&&d.item)||"?")+"」"; return ({c:"キャラクター「",s:"設定「",f:"伏線「"}[k[0]]||"エピソード「")+((d&&(d.title||d.name))||"?")+"」"}

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
/* 待ち時間の表示：三点リーダーと、足踏みする3人（左からギア・ゼナ・ティル） */
const WALKERS=["gia","zena","til"], WALK_ORDER=[0,1,2,1], STEP_MS=350; // 4拍で1周：点0〜3個／コマ1→2→3→2
let walkTimer=null, walkStep=0;
const reduceMotion=()=>!!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches);
WALKERS.forEach(n=>[1,2,3].forEach(k=>{const im=new Image(); im.src=`sprites/${n}_walk_${k}.png`;})); // 先に読んでおく
function paintWalk(){
  const ov=$("#overlay"); const still=reduceMotion(); const st=still?3:walkStep;
  ov.querySelectorAll(".dots").forEach(d=>d.dataset.n=st);
  ov.querySelectorAll(".walker").forEach(w=>w.dataset.f=still?1:WALK_ORDER[st]);
}
function busy(text){
  const ov=$("#overlay");
  if(text==null){ ov.hidden=true; ov.innerHTML=""; clearInterval(walkTimer); walkTimer=null; return; }
  ov.hidden=false;
  const dots=`<span class="dots" data-n="0"><i>.</i><i>.</i><i>.</i></span>`;
  const t=String(text), at=t.indexOf("…");
  const shown=at>=0?esc(t.slice(0,at))+dots+esc(t.slice(at+1)):esc(t)+dots;
  ov.innerHTML=`<div class="dialog busy" role="status"><p class="busy-t"><span class="sr">${esc(t)}</span><span aria-hidden="true">${shown}</span></p>
    <div class="walkers" aria-hidden="true">${WALKERS.map(n=>`<span class="walker" data-f="0">${[1,2,3].map(k=>`<img src="sprites/${n}_walk_${k}.png" alt="" width="40" height="65">`).join("")}</span>`).join("")}</div></div>`;
  if(!walkTimer&&!reduceMotion()){ walkStep=0; walkTimer=setInterval(()=>{walkStep=(walkStep+1)%4; paintWalk();},STEP_MS); }
  paintWalk();
}

async function loadRemote(){
  const folder=await Drive.ensureFolder(await kvGet("folderId")); await kvSet("folderId",folder);
  const fileId=await Drive.findData(folder,await kvGet("dataFileId"));
  // 版の番号を先に読む（中身より古い番号を持つ分には、書く前の確認でやり直しになるだけで安全）
  const version=fileId&&Drive.getVersion?await Drive.getVersion(fileId):null;
  const remote=fileId?await Drive.readJson(fileId):{format:"kozo-drive",version:1,docs:{},images:{}};
  if(remote.format!=="kozo-drive") throw new Error("ドライブのデータの形式が違います");
  remote.docs=remote.docs||{}; remote.images=remote.images||{};
  return {folder,fileId,remote,version};
}
function usedImageIds(){const used=new Set(); for(const r of recs.values()) if(r&&!r.deleted&&r.data) (r.data.images||[]).forEach(im=>used.add(im.id)); return used;}
// 使われていて端末にない画像を、ドライブから取ってくる
async function fetchMissingImages(rimgs){
  const local=new Set((await Store.entries("images")).map(([k])=>k)); let dn=0;
  for(const id of usedImageIds()){
    if(local.has(id)||!rimgs[id]) continue;
    busy(`画像を受け取っています…（${++dn}）`);
    try{ const b=await Drive.downloadBlob(rimgs[id].driveId); await Store.put("images",id,{blob:b,driveId:rimgs[id].driveId,name:id}); urlCache.set(id,URL.createObjectURL(b)); }catch(e){}
  }
}
// どこからも使われなくなった、まだドライブに送っていない画像を片付ける
async function dropOrphanImages(){
  const used=usedImageIds();
  for(const [id,v] of await Store.entries("images")) if(v&&!v.driveId&&!used.has(id)) await removeImage(id);
}
function cancelTimers(keys){ for(const k of keys){ if(timers.has(k)){ clearTimeout(timers.get(k)); timers.delete(k); } } }

/* ---------- 変更の破棄 ---------- */
async function openDiscard(){
  if(syncing) return;
  flushAll();
  const list=[...recs].filter(([,r])=>r&&r.dirty);
  const newImgs=(await Store.entries("images")).filter(([,v])=>v&&!v.driveId).length;
  if(!list.length&&!newImgs){ setSave("取り消す変更はありません"); return; }
  const kind=r=>(r.snap===null||(!("snap" in r)&&!r.base))?"新規":r.deleted?"削除":"変更";
  const ov=$("#overlay");
  ov.innerHTML=`<div class="dialog">
    <h2 class="sec">変更を破棄</h2>
    <div class="warn">前回の同期のあとにこの端末で加えた変更を取り消します。<b>取り消した変更は元に戻せません。</b></div>
    ${list.length?`<div class="hint" style="margin-top:10px">まだドライブに送っていない変更（${list.length}件）</div>
    <ul class="planlist discard">${list.map(([k,r],i)=>`<li><label><input type="checkbox" data-dk="${i}" checked> ${esc(labelKey(k,r.data))} <span class="chip">${kind(r)}</span></label></li>`).join("")}</ul>`:""}
    ${newImgs?`<p class="hint">まだ送っていない画像 ${newImgs}枚は、取り消した項目で使われていなければ一緒に消えます。</p>`:""}
    <div class="dbtns">
      ${list.length?`<button class="btn danger" id="d-revert">選んだ変更を破棄する</button>`:""}
      <button class="btn" id="d-drive">すべて破棄して、ドライブの内容に置き換える</button>
      <button class="btn" id="d-cancel">やめる</button>
    </div>
    <p class="hint">「選んだ変更を破棄する」は、前回同期した状態に戻します（オフラインでも使えます）。<br>「ドライブの内容に置き換える」は、ドライブの最新を読み込み直します（ほかの端末の変更も入ります。オンラインのときだけ使えます）。</p>
  </div>`;
  ov.hidden=false;
  $("#d-cancel").onclick=()=>busy(null);
  if(list.length) $("#d-revert").onclick=async()=>{
    const keys=[...document.querySelectorAll("[data-dk]")].filter(x=>x.checked).map(x=>list[+x.dataset.dk][0]);
    if(!keys.length){ busy(null); return; }
    try{ await revertKeys(keys); }catch(e){ busy(null); setSave(e&&e.message?e.message:"破棄できませんでした",true); }
  };
  $("#d-drive").onclick=async()=>{ try{ await replaceWithDrive(); }catch(e){ busy(null); setSave(e&&e.message?e.message:"ドライブから読み込めませんでした",true); } };
}
async function revertKeys(keys){
  cancelTimers(keys);
  // 以前の版で編集した項目は控えがないので、ドライブから元の状態を読む
  const needRemote=keys.filter(k=>{const r=recs.get(k); return r&&!("snap" in r)&&r.base;});
  let rdocs={};
  if(needRemote.length){
    if(!navigator.onLine) throw new Error(`${needRemote.length}件は前回同期の状態が端末にないため、オンラインのときに破棄してください`);
    syncing=true;
    try{ await Drive.signIn(); busy("ドライブから前回の状態を読んでいます…"); rdocs=(await loadRemote()).remote.docs; }
    finally{ syncing=false; }
  }
  const puts=[], dels=[];
  for(const k of keys){
    const r=recs.get(k); if(!r) continue;
    histAdd(k,"破棄した変更",r);
    let s;
    if("snap" in r) s=r.snap;
    else if(r.base){ const R=rdocs[k]; s=R?{data:R.data,updatedAt:R.updatedAt,deleted:!!R.deleted}:null; }
    else s=null;
    if(!s){ dels.push(k); recs.delete(k); continue; }
    const v={data:s.data,updatedAt:s.updatedAt,deleted:!!s.deleted,base:r.base||s.updatedAt,dirty:false};
    recs.set(k,v); puts.push([k,v]);
  }
  if(puts.length) await Store.putMany("docs",puts);
  for(const k of dels) await Store.del("docs",k);
  rebuild(); await dropOrphanImages();
  const missing=[...usedImageIds()].filter(id=>!urlCache.has(id)).length;
  busy(null); render(); updateSyncBadge();
  setSave(`${keys.length}件の変更を破棄しました${missing?"（外した画像は次の同期で戻ります）":""}`);
}
async function replaceWithDrive(){
  if(!Drive.configured()) throw new Error("Googleドライブの設定がまだです");
  if(!navigator.onLine) throw new Error("オフラインのため、ドライブから読み込めません");
  syncing=true;
  try{
    await Drive.signIn();
    busy("ドライブの内容を読み込んでいます…");
    const {remote}=await loadRemote(); const rdocs=remote.docs;
    cancelTimers([...timers.keys()]);
    const puts=[], dels=[];
    for(const [k,r] of [...recs]){
      if(r&&r.data&&(r.dirty||(rdocs[k]&&stable(rdocs[k].data)!==stable(r.data)))) histAdd(k,"ドライブの内容で置き換える前",r);
      if(rdocs[k]) continue;
      if(r&&r.dirty){ dels.push(k); recs.delete(k); }   // ドライブにない＝この端末で作っただけの項目
    }
    for(const [k,R] of Object.entries(rdocs)){
      const v={data:R.data,updatedAt:R.updatedAt,deleted:!!R.deleted,base:R.updatedAt,dirty:false};
      recs.set(k,v); puts.push([k,v]);
    }
    await Store.putMany("docs",puts);
    for(const k of dels) await Store.del("docs",k);
    rebuild(); await dropOrphanImages(); await fetchMissingImages(remote.images);
    const now=Date.now(); await kvSet("lastSync",now);
    busy(null); render(); updateSyncBadge();
    setSave("ドライブの内容に置き換えました");
  }finally{ syncing=false; }
}

let syncing=false;
async function sync(){
  if(syncing) return;
  if(!Drive.configured()){ setSave("Googleドライブの設定がまだです（config.js にクライアントIDを入れてください）",true); return; }
  if(!navigator.onLine){ setSave("オフラインのため同期できません。つながってからもう一度押してください",true); return; }
  syncing=true;
  try{
    await Drive.signIn();              // ボタン操作の直後にログイン画面を出す
    flushAll();
    busy("同期中…");
    const chosen=new Map();            // やり直しのときに、同じ競合を二度聞かない
    const pack=L=>({data:L.data,updatedAt:L.updatedAt||Date.now(),deleted:!!L.deleted});
    let rimgs, done=false, lastFolder=null, lastOut=null;
    for(let attempt=0; !done; attempt++){
      if(attempt) busy(`ほかの端末の同期と重なったため、読み直しています…（${attempt}回目）`);
      const {folder,fileId,remote,version}=await loadRemote();
      const rdocs=remote.docs||{}; const merged={...rdocs}; const toLocal=[]; const conflicts=[];
      const keys=new Set([...recs.keys(),...Object.keys(rdocs)]); const hist=[];
      for(const k of keys){
        const L=recs.get(k), R=rdocs[k];
        if(!L){ toLocal.push([k,{data:R.data,updatedAt:R.updatedAt,deleted:!!R.deleted,base:R.updatedAt,dirty:false}]); continue; }
        if(!R){ merged[k]=pack(L); toLocal.push([k,{...L,base:L.updatedAt,dirty:false}]); continue; }
        const Ru=R.updatedAt||0;
        if(!L.dirty){
          if(Ru>(L.base||0)){ if(L.data&&(stable(L.data)!==stable(R.data)||!!L.deleted!==!!R.deleted)) hist.push([k,"別の端末の内容に置き換わる前",L]); toLocal.push([k,{data:R.data,updatedAt:Ru,deleted:!!R.deleted,base:Ru,dirty:false}]); }
          else if(Ru<(L.base||0)&&L.data){ merged[k]=pack(L); } // 以前の同期で届かなかった変更を送り直す
          continue;
        }
        if(Ru<=(L.base||0)){ merged[k]=pack(L); hist.push([k,"同期で送った版",L]); toLocal.push([k,{...L,base:L.updatedAt,dirty:false}]); continue; }
        if(stable(L.data)===stable(R.data)&&!!L.deleted===!!R.deleted){ toLocal.push([k,{...L,updatedAt:Ru,base:Ru,dirty:false}]); continue; }
        conflicts.push({k,L,R});
      }
      if(conflicts.length){
        const ask=conflicts.filter(c=>{const m=chosen.get(c.k); return !m||m.ru!==c.R.updatedAt;});
        if(ask.length){
          busy(null);
          const ch=await chooseConflicts(ask);
          if(!ch){ busy(null); setSave("同期をやめました"); return; }
          ask.forEach((c,i)=>chosen.set(c.k,{ru:c.R.updatedAt,pick:ch[i]}));
          busy("同期中…");
        }
        conflicts.forEach(c=>{
          if(chosen.get(c.k).pick==="L"){ const now=Date.now(); merged[c.k]={...pack(c.L),updatedAt:now}; hist.push([c.k,"競合：残さなかったドライブ側",c.R]); hist.push([c.k,"同期で送った版",c.L]); toLocal.push([c.k,{...c.L,updatedAt:now,base:now,dirty:false}]); }
          else { hist.push([c.k,"競合：残さなかった端末側",c.L]); toLocal.push([c.k,{data:c.R.data,updatedAt:c.R.updatedAt,deleted:!!c.R.deleted,base:c.R.updatedAt,dirty:false}]); }
        });
      }
      // 画像：この端末で追加した画像を上げる（上げ済みの画像は二度送らない）
      rimgs=remote.images||{};
      const limgs=new Map(await Store.entries("images"));
      let up=0;
      for(const [id,v] of limgs){
        if(!v) continue;
        if(!v.driveId){ busy(`画像を送っています…（${++up}）`); v.driveId=await Drive.uploadImage(folder,id,v.blob); await Store.put("images",id,v); }
        if(!rimgs[id]) rimgs[id]={driveId:v.driveId,type:v.blob.type||""};
      }
      const out={format:"kozo-drive",version:1,updatedAt:Date.now(),docs:merged,images:rimgs}; lastFolder=folder; lastOut=out;
      busy("台帳データを保存しています…");
      // 書く直前：読んだあとに、ほかの端末が書いていないか
      if(fileId&&version!=null){
        const now=await Drive.getVersion(fileId);
        if(now!==version){ if(attempt<4) continue; throw new Error("ほかの端末の同期と重なりました。少し待ってから、もう一度「同期」を押してください"); }
      }
      let wrote;
      if(fileId) wrote=await Drive.updateJson(fileId,out); else { const id=await Drive.createJson(folder,out); await kvSet("dataFileId",id); }
      // 書いた後：ほぼ同時に書いた端末に、自分の変更が上書きされていないか
      if(fileId&&wrote!=null){
        await new Promise(r=>setTimeout(r,1500));
        const after=await Drive.getVersion(fileId);
        if(after!==wrote){
          const re=await Drive.readJson(fileId); const rd=re.docs||{};
          const lost=Object.keys(out.docs).filter(k=>(out.docs[k].updatedAt||0)>((rd[k]&&rd[k].updatedAt)||0));
          if(lost.length){ if(attempt<4) continue; throw new Error("ほかの端末の同期と重なりました。少し待ってから、もう一度「同期」を押してください"); }
        }
      }
      // ドライブに書けたことを確かめてから、端末側を同期済みにする
      for(const [k,kind,rec] of hist) histAdd(k,kind,rec);
      await histChain;
      toLocal.forEach(([,v])=>delete v.snap);
      await Store.putMany("docs",toLocal);
      for(const [k,v] of toLocal){
        if(timers.has(k)) continue; // 同期中に入力されたものは、端末側の最新を優先
        recs.set(k,v);
      }
      done=true;
    }
    rebuild();
    await fetchMissingImages(rimgs);
    const bk=await maybeBackup(lastFolder,lastOut);
    const now=Date.now(); await kvSet("lastSync",now);
    busy(null); render(); updateSyncBadge();
    setSave(`同期しました（${new Date(now).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}）${bk?"・バックアップを作りました":""}`);
  }catch(e){
    busy(null); setSave(e&&e.message?e.message:"同期できませんでした",true);
  }finally{ syncing=false; }
}

/* ---------- 取り込み（claude.ai の台帳や控えのファイル） ---------- */
function exportPayload(){
  return {format:"kozo-sync",version:1,exportedAt:Date.now(),source:"tablet",
    meta:stripId(meta), episodes:eps.map(e=>{const r=recs.get("e:"+e.id);return {...e,updatedAt:r&&r.updatedAt||0}}),
    characters:chars.map(c=>{const r=recs.get("c:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}}),
    settings:setts.map(c=>{const r=recs.get("s:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}}),
    orbs:orbs.map(c=>{const r=recs.get("o:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}}),
    threads:threads.map(c=>{const r=recs.get("f:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}}),
    decisions:decisions.map(c=>{const r=recs.get("d:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}}),
    drafts:drafts.map(c=>{const r=recs.get("w:"+c.id);return {...c,updatedAt:r&&r.updatedAt||0}})};
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
  (d.settings||[]).forEach(c=>consider("s:"+c.id,c)); (d.orbs||[]).forEach(c=>consider("o:"+c.id,c));
  (d.threads||[]).forEach(c=>consider("f:"+c.id,c)); (d.decisions||[]).forEach(c=>consider("d:"+c.id,c)); (d.drafts||[]).forEach(c=>consider("w:"+c.id,c));
  const todo=items.filter(i=>i.action!=="skip"); const cnt=a=>items.filter(i=>i.action===a).length;
  const imgs=Object.entries(d.images||{}).filter(([id])=>!urlCache.has(id));
  out.innerHTML=`<div class="plan"><p>追加 <b>${cnt("add")}</b>・更新 <b>${cnt("update")}</b>・変更なし（端末の方が新しい） <b>${cnt("skip")}</b>${imgs.length?`・画像 <b>${imgs.length}</b>`:""}</p>
    ${todo.length||imgs.length?`<button class="btn sm primary" id="i-apply">取り込む</button>`:`<p class="hint">取り込むものはありません。</p>`}</div>`;
  if(!todo.length&&!imgs.length) return;
  $("#i-apply").onclick=async()=>{
    $("#i-apply").disabled=true;
    todo.forEach(i=>{const cur=recs.get(i.key); if(cur&&cur.data&&!cur.deleted) histAdd(i.key,"取り込みで上書きされる前",cur);});
    const pairs=todo.map(i=>{const cur=recs.get(i.key);
      const snap=!cur?null:cur.dirty?("snap" in cur?cur.snap:undefined):{data:cur.data,updatedAt:cur.updatedAt,deleted:!!cur.deleted};
      const r={data:i.data,updatedAt:i.iu,base:(cur||{}).base||0,dirty:true,deleted:false}; if(snap!==undefined) r.snap=snap;
      recs.set(i.key,r); return [i.key,r];});
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
  if(meta){ const t=meta.title||"宿命刻の姫君", isLogo=t==="宿命刻の姫君"; // 作品名を変えたときは文字で表示する
    $("#h-title").textContent=t; $("#h-title").hidden=isLogo; $("#h-logo").hidden=!isLogo; $("#h-tag").textContent=meta.tagline||""; document.title=t+" 構成台帳"; }
  ["edit","table","chars","lore","policy","drafts","manage"].forEach(v=>$("#v-"+v).setAttribute("aria-pressed",String(view===v||(v==="drafts"&&view==="draft"&&draftFrom==="list"))));
  if(view==="drafts"){ const rs=loaded?draftRows():[]; $("#stats").innerHTML=loaded?`<span>下書き <b>${rs.length}</b>話</span><span>合計 <b>${rs.reduce((s,x)=>s+x.chars,0).toLocaleString()}</b>文字</span>`:""; return; }
  if(view==="manage"){ $("#stats").innerHTML=loaded?mgStats():""; return; }
  if(view==="draft"){ $("#stats").innerHTML=""; return; }
  if(view==="lore"){ $("#stats").innerHTML=loaded?`<span>設定の項目 <b>${setts.length}</b></span><span>未決 <b>${setts.filter(s=>s.status==="未決").length}</b></span><span>宿命刻 <b>${orbs.filter(o=>o.holder&&o.holder.trim()).length}</b>／${orbs.length||26}</span>`:""; return; }
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
  if(!eps.length&&!chars.length&&!setts.length) return renderWelcome();
  if(view==="lore") return renderLore();
  if(view==="chars") return renderChars();
  if(view==="table") return renderTable();
  if(view==="policy") return renderPolicy();
  if(view==="manage") return renderManage();
  if(view==="draft") return renderDraft();
  if(view==="drafts") return renderDraftList();
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
    html+=`<button class="row" data-id="${esc(e.id)}" aria-current="${e.id===selId}">
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
        <label class="f">編<select id="f-arc">${(meta.arcs||[]).map(a=>`<option value="${esc(a.id)}" ${a.id===e.arc?"selected":""}>${esc(a.name)}</option>`).join("")}</select></label>
        <label class="f">状態<select id="f-status">${STATUSES.map(s=>`<option ${s===e.status?"selected":""}>${s}</option>`).join("")}</select></label>
        <label class="f">トーン<input id="f-tone" value="${esc(e.tone)}"></label>
        <label class="f">Web話数${hasParts?"（各話の数から自動）":""}<input id="f-wc" type="number" min="0" max="20" value="${count(e)}" ${hasParts?"disabled":""}></label>
      </div>
      <label class="f block">宿命刻<input id="f-orb" value="${esc(e.orb)}" placeholder="例：本物：I 獄炎（ゼナ吸収）／ハズレ"></label>
      <label class="f block">内容<textarea id="f-summary" rows="5">${esc(e.summary)}</textarea></label>
      <label class="f block">提示するもの<textarea id="f-presents" rows="2">${esc(e.presents)}</textarea></label>
      ${mentionChipsHTML(mentionsIn(epText(e)),"この話に出てくる人物・用語")}
    </div>

    <div class="card">
      <h2 class="sec">各話のプロット <button class="btn sm" id="b-addpart">＋ 話を追加</button></h2>
      <div class="hint">1行が1つの流れ（ビート）です。話を足したり減らしたりすると、以降のWeb話数が自動で振り直されます。</div>
      ${count(e)?`<div class="drlinks"><span class="hint">本文の下書き</span>${Array.from({length:count(e)},(_,i)=>{const c=draftCount(e,i); return `<button class="btn sm drl ${c?"has":""}" data-draft="${i}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg>${x.from!=null?`第${x.from+i}話`:`${i+1}話目`}<span class="mono">${c!=null?c.toLocaleString()+"字":"—"}</span></button>`;}).join("")}</div>`:""}
      <div class="parts">${hasParts?e.parts.map((p,i)=>`
        <div class="part">
          <div class="ph">
            <span class="pn">第${x.from!=null?x.from+i:"?"}話</span>
            <input class="pt" data-pi="${i}" value="${esc(p.title)}" aria-label="第${i+1}話の題">
            <button class="iconbtn" data-pup="${i}" aria-label="上へ" ${i===0?"disabled":""}>↑</button>
            <button class="iconbtn" data-pdown="${i}" aria-label="下へ" ${i===e.parts.length-1?"disabled":""}>↓</button>
            <button class="iconbtn" data-pdel="${i}" aria-label="この話を削除">×</button>
            <button class="btn sm" data-draft="${i}" title="この話の本文を書く">本文</button>
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
  document.querySelectorAll("[data-draft]").forEach(b=>b.onclick=()=>{draftFrom="ep"; openDraft(id,+b.dataset.draft);});
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
    html+=`<tr class="ep" data-id="${esc(e.id)}" tabindex="0"><td class="n">${x.ep}</td><td class="w">${rng(x)}</td>
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
      <h2 class="sec">シリーズ構成 <button class="btn sm" id="b-addarc">＋ 〇〇編を追加</button></h2>
      <div class="hint">名前を変えると一覧と構成表に反映されます。↑↓で編を動かすと、所属するエピソードもまとめて移動し、Web話数が振り直されます。エピソードの所属は編集台の「編」で変えます。</div>
      <div id="arcmsg" class="hint"></div>
      <div class="arclist">${(meta.arcs||[]).map((a,i,all)=>{const n=eps.filter(e=>e.arc===a.id); const w=n.reduce((s,e)=>s+count(e),0); const x0=n[0]&&r[n[0].id], x1=n.length&&r[n[n.length-1].id];
        return `<div class="arcedit"><input data-ai="${i}" value="${esc(a.name)}" aria-label="編の名前"><span class="cnt">${n.length?`EP${x0.ep}${x1.ep!==x0.ep?"–"+x1.ep:""}・`:""}${n.length}話/${w}</span>
        <span class="sbtn"><button class="iconbtn" data-aup="${i}" aria-label="この編を上へ" ${i===0?"disabled":""}>↑</button><button class="iconbtn" data-adown="${i}" aria-label="この編を下へ" ${i===all.length-1?"disabled":""}>↓</button><button class="iconbtn" data-aadd="${i}" aria-label="この後に編を挿入" title="この後に編を挿入">＋</button>
        <button class="iconbtn" data-adel="${i}" aria-label="この編を削除" ${n.length?"disabled title='エピソードがある編は削除できません'":""}>×</button></span></div>`}).join("")}</div>
    </div></div>`;
  const b=(s,k)=>$(s).oninput=ev=>{edit("__meta",o=>o[k]=ev.target.value); if(k==="title"||k==="tagline") renderHead();};
  b("#m-title","title"); b("#m-tag","tagline"); b("#m-log","logline"); b("#m-policy","policy");
  document.querySelectorAll("[data-ai]").forEach(el=>el.oninput=ev=>edit("__meta",o=>o.arcs[+el.dataset.ai].name=ev.target.value));
  document.querySelectorAll("[data-adel]").forEach(el=>el.onclick=()=>{edit("__meta",o=>o.arcs.splice(+el.dataset.adel,1)); render();});
  const addArc=at=>{edit("__meta",o=>o.arcs.splice(at,0,{id:"a"+Date.now().toString(36),name:"〇〇編"})); render();
    const ins=document.querySelectorAll("[data-ai]"); const t=ins[at]; if(t){t.focus(); t.setSelectionRange(0,2);} };
  $("#b-addarc").onclick=()=>addArc((meta.arcs||[]).length);
  document.querySelectorAll("[data-aadd]").forEach(el=>el.onclick=()=>addArc(+el.dataset.aadd+1));
  document.querySelectorAll("[data-aup]").forEach(el=>el.onclick=()=>moveArc(+el.dataset.aup,-1));
  document.querySelectorAll("[data-adown]").forEach(el=>el.onclick=()=>moveArc(+el.dataset.adown,1));
}
// 編を入れ替える。両方の編のエピソードがひと続きで隣り合っていれば、エピソードもまとめて入れ替える
function moveArc(i,dir){
  const arcs=meta.arcs||[], j=i+dir; if(j<0||j>=arcs.length) return;
  const A=arcs[i], B=arcs[j];
  const pos=id=>eps.map((e,k)=>e.arc===id?k:-1).filter(k=>k>=0);
  const pa=pos(A.id), pb=pos(B.id);
  const contiguous=p=>!p.length||p[p.length-1]-p[0]===p.length-1;
  let moved=false, note="";
  if(pa.length&&pb.length){
    const [first,second]=dir<0?[pb,pa]:[pa,pb]; // first が前にある編
    if(contiguous(pa)&&contiguous(pb)&&first[first.length-1]+1===second[0]){
      const span=[...first,...second].map(k=>eps[k]); const orders=span.map(e=>e.order);
      const reordered=[...second.map(k=>eps[k]),...first.map(k=>eps[k])];
      reordered.forEach((e,k)=>{ if(e.order!==orders[k]) edit(e.id,o=>o.order=orders[k]); });
      eps.sort((x,y)=>x.order-y.order); moved=true;
    } else note="エピソードの並びが編ごとにまとまっていないため、編の順だけを入れ替えました（エピソードの並びはそのままです）。";
  }
  edit("__meta",o=>{const t=o.arcs[i]; o.arcs[i]=o.arcs[j]; o.arcs[j]=t;});
  render();
  const m=$("#arcmsg"); if(m) m.textContent=note||(moved?`「${A.name}」と「${B.name}」を、エピソードごと入れ替えました。`:"");
}

/* ---------- キャラクター ---------- */
function aliasesOf(c){return [...new Set([c.name,...String(c.aliases||"").split(/[,、，]/)].map(s=>String(s||"").trim()).filter(s=>s.length>=2))]}
function appearances(c){
  const al=aliasesOf(c); if(!al.length) return [];
  const r=ranges();
  return eps.filter(e=>{const t=[e.title,e.summary,e.presents,(e.parts||[]).map(p=>p.title+" "+p.beats).join(" ")].join(" ");return al.some(a=>t.includes(a))}).map(e=>({e,x:r[e.id]}));
}
/* 関係：[{name, cid, text}]。古い形（1行に1人の文章）は表示のときに読み替える */
function relsOf(c){
  if(Array.isArray(c.rels)) return c.rels;
  return String(c.relations||"").split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{
    const m=l.match(/^([^：:]{1,30})[：:]\s*(.*)$/); return m?{name:m[1].trim(),cid:"",text:m[2]}:{name:"",cid:"",text:l};});
}
function relsText(rels){return rels.filter(r=>r.name||r.text).map(r=>{const n=relName(r); const t=String(r.text||"").replace(/\n/g," "); return n?`${n}：${t}`:t;}).join("\n")}
function charByName(n){
  n=String(n||"").trim(); if(!n) return null;
  return chars.find(c=>c.name===n)||chars.find(c=>aliasesOf(c).includes(n))||null;
}
function relChars(r){ // 関係の相手（キャラクター欄にいる人物）。「ギア・ゼナ」のような並びも見る
  const byId=r.cid&&chars.find(c=>c.id===r.cid); if(byId) return [byId];
  const whole=charByName(r.name); if(whole) return [whole];
  const parts=String(r.name||"").split(/[・、,，]/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>1){ const cs=parts.map(charByName); if(cs.every(Boolean)) return cs; }
  return [];
}
function relName(r){const byId=r.cid&&chars.find(c=>c.id===r.cid); return byId?byId.name:(r.name||"")}
function relIconHTML(r){
  return relChars(r).filter(c=>c.images&&c.images[0]).map(c=>`<button class="av rav" data-gochar="${esc(c.id)}" title="${esc(c.name)}を開く"><img src="${blob(c.images[0].id)}" alt="${esc(c.name)}"></button>`).join("");
}
function relsHTML(c){
  const rels=relsOf(c);
  return `<div class="block"><span class="hint">関係</span>
    <div class="rels">${rels.map((r,i)=>`<div class="rel" data-ri="${i}">
      <div class="ricons" id="ri-${i}">${relIconHTML(r)}</div>
      <input class="rname" data-rn="${i}" list="relnames" value="${esc(relName(r))}" placeholder="相手の名前" aria-label="相手の名前">
      <textarea class="rtext" data-rt="${i}" rows="1" placeholder="関係（自由記述）" aria-label="関係の内容">${esc(r.text)}</textarea>
      <button class="btn sm rdel" data-rdel="${i}" title="この関係を削除" aria-label="この関係を削除">×</button>
    </div>`).join("")||`<div class="empty">まだ関係はありません。</div>`}</div>
    <datalist id="relnames">${chars.filter(x=>x.id!==c.id).map(x=>`<option value="${esc(x.name)}">`).join("")}</datalist>
    <button class="btn sm" id="r-add" style="margin-top:8px">＋ 関係を追加</button></div>`;
}
// 関係の説明は、全文が見えるように高さを中身に合わせる
function fitText(el){ if(!el.isConnected||!el.offsetWidth) return; el.style.height="auto"; el.style.height=(el.scrollHeight+2)+"px"; }
let fitTimer=null;
try{ document.fonts.ready.then(()=>document.querySelectorAll(".rtext").forEach(fitText)); }catch(e){}
window.addEventListener("resize",()=>{ clearTimeout(fitTimer); fitTimer=setTimeout(()=>document.querySelectorAll(".rtext").forEach(fitText),100); });
function editRels(id,mut){
  edit(id,o=>{ const rels=structuredClone(relsOf(o)); mut(rels); o.rels=rels; o.relations=relsText(rels); });
}

function charListHTML(){
  const ql=cq.trim(); let html="", last=null;
  chars.forEach(c=>{
    const hay=[c.name,c.aliases,c.role,c.group,c.orb,c.profile,c.personality,c.arc,c.relations].join(" ");
    if(ql&&!hay.includes(ql)) return;
    if(c.group!==last){last=c.group; html+=`<div class="arc">${esc(c.group||"（区分なし）")}<span>${chars.filter(x=>x.group===c.group).length}人</span></div>`;}
    const img=c.images&&c.images[0];
    html+=`<button class="crow" data-cid="${esc(c.id)}" aria-current="${c.id===charSel}">
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
        <div class="apps">${ap.length?ap.map(a=>`<button class="chip appchip" data-goep="${esc(a.e.id)}">EP${a.x.ep} ${esc(a.e.title)}</button>`).join(""):`<span class="hint">見つかりません</span>`}</div></div>
      ${mentionChipsHTML(mentionsIn([c.profile,c.personality,c.appearance,c.arc,c.memo].join(" "),"c:"+c.id),"設定文に出てくる人物・用語")}
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
      ${relsHTML(c)}
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
  // 関係
  const wireIcons=()=>document.querySelectorAll("[data-gochar]").forEach(el=>el.onclick=()=>{charSel=el.dataset.gochar; try{localStorage.setItem("kozo.char",charSel)}catch(e){} render(); window.scrollTo({top:0})});
  wireIcons();
  document.querySelectorAll("[data-rn]").forEach(el=>el.oninput=ev=>{
    const i=+el.dataset.rn, v=ev.target.value; const hit=chars.find(x=>x.name===v.trim());
    editRels(id,rels=>{ rels[i].name=v.trim(); rels[i].cid=hit?hit.id:""; });
    const cur=chars.find(x=>x.id===c.id); $("#ri-"+i).innerHTML=relIconHTML(relsOf(cur)[i]); wireIcons();
  });
  document.querySelectorAll("[data-rt]").forEach(el=>{ fitText(el); el.oninput=ev=>{fitText(el); const i=+el.dataset.rt; editRels(id,rels=>{rels[i].text=ev.target.value});}; });
  document.querySelectorAll("[data-rdel]").forEach(el=>el.onclick=()=>{
    const i=+el.dataset.rdel;
    if(pendingDelete!=="rel"+i){ pendingDelete="rel"+i; el.textContent="削除する"; el.classList.add("danger"); return; }
    pendingDelete=null; editRels(id,rels=>rels.splice(i,1)); render();
  });
  $("#r-add").onclick=()=>{ editRels(id,rels=>rels.push({name:"",cid:"",text:""})); render();
    const ins=document.querySelectorAll("[data-rn]"); const last=ins[ins.length-1]; if(last) last.focus(); };
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
  const body={name:"新しい人物",aliases:"",group:prev?prev.group:"主人公たち",role:"",status:"検討中",orb:"",first:"",profile:"",personality:"",appearance:"",arc:"",relations:"",rels:[],memo:"",images:[],order};
  charSel=await addDoc("c",body); window._mobileEditing=true; render();
}

/* ---------- 設定（世界観・用語・組織など） ---------- */
const LORE_STATUSES=["決定","検討中","★提案","旧設定（参考）","未決"];
function loreListHTML(){
  const ql=lq.trim(); let html="", last=null;
  setts.forEach(s=>{
    const hay=[s.title,s.summary,s.category,s.body,s.memo,s.keywords].join(" ");
    if(ql&&!hay.includes(ql)) return;
    if(s.category!==last){last=s.category; html+=`<div class="arc">${esc(s.category||"（区分なし）")}<span>${setts.filter(x=>x.category===s.category).length}件</span></div>`;}
    html+=`<button class="srow" data-sid="${esc(s.id)}" aria-current="${s.id===loreSel}">
      <span class="ct"><b>${esc(s.title||"（無題）")}</b><span>${esc(s.summary)}</span></span>
      ${s.status&&s.status!=="決定"?`<span class="chip ${s.status==="未決"?"s-未着手":"s-たたき台"}">${esc(s.status)}</span>`:""}</button>`;
  });
  return html||`<div class="empty" style="padding:12px">${ql?`「${esc(ql)}」に一致する項目はありません。`:"まだ項目がありません。"}</div>`;
}
function wireLoreList(){document.querySelectorAll(".srow").forEach(b=>b.onclick=()=>{loreSel=b.dataset.sid; loreMode="items"; window._mobileEditing=true; try{localStorage.setItem("kozo.lore",loreSel)}catch(e){} render(); window.scrollTo({top:0})});}
function keywordsOf(s){return String(s.keywords||"").split(/[,、，]/).map(x=>x.trim()).filter(x=>x.length>=2)}
function loreAppearances(s){
  const kw=keywordsOf(s); if(!kw.length) return [];
  const r=ranges();
  return eps.filter(e=>{const t=[e.title,e.summary,e.presents,e.memo,(e.parts||[]).map(p=>p.title+" "+p.beats).join(" ")].join(" ");return kw.some(a=>t.includes(a))}).map(e=>({e,x:r[e.id]}));
}

function renderLore(){
  const m=$("#main");
  const modeBar=`<div class="seg lore-mode" role="group" aria-label="設定の表示"><button id="lm-items" aria-pressed="${loreMode==="items"}">項目</button><button id="lm-orbs" aria-pressed="${loreMode==="orbs"}">宿命刻（A〜Z）</button></div>`;
  if(loreMode==="orbs") return renderOrbs(modeBar);
  if(!setts.length){
    m.innerHTML=`${modeBar}<div class="notice">まだ設定の項目がありません。<button class="btn primary" id="l-first">最初の項目を追加</button><br><span class="hint">設定資料から作った初期データは、「管理」タブの「同期とデータ」にある「取り込む」から読み込めます。</span></div>`;
    $("#l-first").onclick=()=>addLore(null); wireLoreMode(); return;
  }
  if(!setts.find(s=>s.id===loreSel)) loreSel=setts[0].id;
  const s=setts.find(x=>x.id===loreSel), idx=setts.indexOf(s), id="s:"+s.id;
  const imgs=s.images||[]; const cats=[...new Set(setts.map(x=>x.category).filter(Boolean))];
  const ap=loreAppearances(s);
  m.innerHTML=`${modeBar}<div class="work ${window._mobileEditing?"editing":""}">
  <nav class="spine" aria-label="設定の一覧">
    <div class="search"><input type="search" id="lq" placeholder="項目名・本文で絞り込む" value="${esc(lq)}"></div>
    <div id="lorelist">${loreListHTML()}</div>
    <div style="padding:10px"><button class="btn sm" id="l-add" style="width:100%">＋ 項目を追加</button></div>
  </nav>
  <section class="desk">
    <div class="card">
      <div class="edhead">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn sm back" id="l-back">← 一覧</button>
          <span class="hint">${esc(s.category||"（区分なし）")}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" id="l-up" ${idx===0?"disabled":""}>↑ 前へ</button>
          <button class="btn sm" id="l-down" ${idx===setts.length-1?"disabled":""}>↓ 後へ</button>
          <button class="btn sm" id="l-addafter">＋ この後に追加</button>
          <button class="btn sm danger" id="l-del">削除</button>
        </div>
      </div>
      <div id="lconfirm"></div>
      <input class="titlein" data-lk="title" value="${esc(s.title)}" aria-label="項目名">
      <input class="rolein" data-lk="summary" value="${esc(s.summary)}" placeholder="一行の要約" aria-label="要約">
      <div class="grid">
        <label class="f">区分<input data-lk="category" list="catlist" value="${esc(s.category)}"><datalist id="catlist">${cats.map(c=>`<option value="${esc(c)}">`).join("")}</datalist></label>
        <label class="f">状態<input data-lk="status" list="lstatus" value="${esc(s.status)}"><datalist id="lstatus">${LORE_STATUSES.map(x=>`<option value="${x}">`).join("")}</datalist></label>
      </div>
      <label class="f block">関連語（読点区切り。本文に出てくるエピソードを探します）<input data-lk="keywords" value="${esc(s.keywords)}"></label>
      <div class="block"><span class="hint">関連語が出てくるエピソード（${ap.length}）</span>
        <div class="apps">${ap.length?ap.map(a=>`<button class="chip appchip" data-goep="${esc(a.e.id)}">EP${a.x.ep} ${esc(a.e.title)}</button>`).join(""):`<span class="hint">${keywordsOf(s).length?"見つかりません":"関連語を入れると表示されます"}</span>`}</div></div>
      ${mentionChipsHTML(mentionsIn([s.summary,s.body,s.memo].join(" "),"s:"+s.id),"本文に出てくる人物・用語")}
    </div>
    <div class="card">
      <h2 class="sec">内容</h2>
      <label class="f block" style="margin-top:6px"><textarea data-lk="body" rows="${rowsFor(s.body,8)}" aria-label="内容">${esc(s.body)}</textarea></label>
      <label class="f block">未決・★案<textarea data-lk="memo" rows="${rowsFor(s.memo,2)}">${esc(s.memo)}</textarea></label>
      <label class="f block">元の資料<input data-lk="source" value="${esc(s.source)}"></label>
    </div>
    <div class="card">
      <h2 class="sec">画像 <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="hint" id="lup-state"></span><label class="btn sm primary">＋ 画像を追加<input type="file" id="lup" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label></span></h2>
      <div class="hint">地図、紋章、衣装、資料の写真など。</div>
      <div class="gallery">${imgs.length?imgs.map((im,i)=>`
        <figure class="gimg wide">
          <img src="${blob(im.id)}" alt="${esc(im.caption||s.title)}" loading="lazy">
          <input data-lcap="${i}" value="${esc(im.caption)}" placeholder="説明" aria-label="画像の説明">
          <div class="gbtns">${i?`<button class="btn sm" data-lmain="${i}">先頭にする</button>`:""}<button class="btn sm danger" data-lidel="${i}">外す</button></div>
        </figure>`).join(""):`<div class="empty">画像はありません。</div>`}</div>
    </div>
  </section></div>`;
  wireLore(s,id); wireLoreMode();
}
function wireLoreMode(){
  $("#lm-items").onclick=()=>{loreMode="items"; saveLoreMode(); render();};
  $("#lm-orbs").onclick=()=>{loreMode="orbs"; saveLoreMode(); render();};
}
function saveLoreMode(){try{localStorage.setItem("kozo.loreMode",loreMode)}catch(e){}}
function wireLore(s,id){
  $("#lq").oninput=ev=>{lq=ev.target.value; $("#lorelist").innerHTML=loreListHTML(); wireLoreList();};
  wireLoreList();
  document.querySelectorAll("[data-lk]").forEach(el=>el.oninput=ev=>{const k=el.dataset.lk; edit(id,o=>o[k]=ev.target.value);
    if(k==="title"||k==="summary"||k==="category"||k==="status"){ $("#lorelist").innerHTML=loreListHTML(); wireLoreList(); }});
  document.querySelectorAll("[data-lcap]").forEach(el=>el.oninput=ev=>edit(id,o=>o.images[+el.dataset.lcap].caption=ev.target.value));
  document.querySelectorAll("[data-lmain]").forEach(el=>el.onclick=()=>{const i=+el.dataset.lmain; edit(id,o=>{const [im]=o.images.splice(i,1); o.images.unshift(im)}); render();});
  document.querySelectorAll("[data-lidel]").forEach(el=>el.onclick=()=>{
    const i=+el.dataset.lidel;
    if(pendingDelete!=="limg"+i){pendingDelete="limg"+i; el.textContent="もう一度押すと外す"; return;}
    pendingDelete=null; const im=s.images[i]; edit(id,o=>o.images.splice(i,1)); render(); if(im) removeImage(im.id);
  });
  document.querySelectorAll("[data-goep]").forEach(el=>el.onclick=()=>{selId=el.dataset.goep; view="edit"; window._mobileEditing=true; saveView(); render(); window.scrollTo({top:0})});
  $("#l-back").onclick=()=>{window._mobileEditing=false; render();};
  $("#l-add").onclick=()=>addLore(s.id); $("#l-addafter").onclick=()=>addLore(s.id);
  $("#l-up").onclick=()=>moveLore(s.id,-1); $("#l-down").onclick=()=>moveLore(s.id,1);
  $("#l-del").onclick=()=>{
    $("#lconfirm").innerHTML=`<div class="confirm" style="margin-top:10px">「${esc(s.title)}」を削除します。<button class="btn sm danger" id="l-delyes">削除する</button><button class="btn sm" id="l-delno">やめる</button></div>`;
    $("#l-delno").onclick=()=>$("#lconfirm").innerHTML="";
    $("#l-delyes").onclick=async()=>{const i=setts.findIndex(x=>x.id===s.id); await removeDoc("s:"+s.id); loreSel=(setts[i+1]||setts[i-1]||{}).id; render();};
  };
  $("#lup").onchange=async ev=>{
    const files=[...ev.target.files]; ev.target.value="";
    for(const f of files){ $("#lup-state").textContent=`保存中… ${f.name}`;
      try{ const r=await addImage(f); edit(id,o=>{o.images=o.images||[]; o.images.push({id:r.id,caption:""})}); }catch(e){ $("#lup-state").textContent=`保存できませんでした（${f.name}）`; return; } }
    $("#lup-state").textContent=""; render();
  };
}
function moveLore(sid,dir){
  const i=setts.findIndex(s=>s.id===sid), j=i+dir; if(j<0||j>=setts.length) return;
  const a=setts[i], b=setts[j], oa=a.order, ob=b.order;
  edit("s:"+a.id,o=>{o.order=ob; if(b.category!==a.category) o.category=b.category;}); edit("s:"+b.id,o=>{o.order=oa;});
  setts.sort((x,y)=>x.order-y.order); render();
}
async function addLore(afterId){
  const i=afterId?setts.findIndex(s=>s.id===afterId):-1; const prev=setts[i], next=setts[i+1];
  const order=prev?(next?(prev.order+next.order)/2:prev.order+10):10;
  const body={title:"新しい項目",summary:"",category:prev?prev.category:"世界観",status:"検討中",keywords:"",body:"",memo:"",source:"",images:[],order};
  loreSel=await addDoc("s",body); loreMode="items"; window._mobileEditing=true; render();
}

/* 宿命刻（A〜Z）の一覧表 */
function renderOrbs(modeBar){
  const m=$("#main");
  if(!orbs.length){
    m.innerHTML=`${modeBar}<div class="notice">宿命刻の一覧がまだありません。<button class="btn primary" id="o-make">A〜Z の表を作る</button><br><span class="hint">設定資料から作った初期データを取り込むと、名称や保持者が入った状態で表示されます。</span></div>`;
    $("#o-make").onclick=async()=>{ for(let k=0;k<26;k++){ const L=String.fromCharCode(65+k); touch("o:"+L,{letter:L,name:"",holder:"",status:"未割当",note:"",order:k},false); await persist("o:"+L);} rebuild(); render(); };
    wireLoreMode(); return;
  }
  const filled=orbs.filter(o=>o.holder&&o.holder.trim()).length;
  m.innerHTML=`${modeBar}<div class="card orbcard">
    <div class="hint">26刻（A〜Z）。保持者や登場回が決まっている刻 <b class="mono">${filled}</b>／26。セルをそのまま書き換えられます。</div>
    <div class="tablewrap" style="margin-block:10px 0"><table class="orbtable"><thead><tr><th>刻</th><th>名称</th><th>保持者・登場</th><th>状態</th><th>備考</th></tr></thead><tbody>
    ${orbs.map(o=>`<tr class="${o.holder&&o.holder.trim()?"has":""}"><td class="n">${esc(o.letter)}</td>
      <td><textarea data-ok="name" data-ol="${esc(o.id)}" rows="${rowsFor(o.name,1)}" aria-label="${esc(o.letter)}の名称">${esc(o.name)}</textarea></td>
      <td><textarea data-ok="holder" data-ol="${esc(o.id)}" rows="${rowsFor(o.holder,1)}" aria-label="${esc(o.letter)}の保持者">${esc(o.holder)}</textarea></td>
      <td><input data-ok="status" data-ol="${esc(o.id)}" list="ostat" value="${esc(o.status)}" aria-label="${esc(o.letter)}の状態"></td>
      <td><textarea data-ok="note" data-ol="${esc(o.id)}" rows="${rowsFor(o.note,1)}" aria-label="${esc(o.letter)}の備考">${esc(o.note)}</textarea></td></tr>`).join("")}
    </tbody></table></div>
    <datalist id="ostat"><option value="決定"><option value="暫定"><option value="★提案"><option value="未割当"></datalist>
  </div>`;
  document.querySelectorAll("[data-ok]").forEach(el=>el.oninput=ev=>{const k=el.dataset.ok; edit("o:"+el.dataset.ol,o=>o[k]=ev.target.value); if(k==="holder") el.closest("tr").classList.toggle("has",!!ev.target.value.trim());});
  wireLoreMode();
}

/* ---------- 管理（表記・伏線・宿命刻の回収・連載・未決・登場表） ---------- */
let mgMode="names", thSel=null, castGap=5, openFilter="all", openQ="", openStar=false, orbAt=null;
try{mgMode=localStorage.getItem("kozo.mg")||"names"; thSel=localStorage.getItem("kozo.th");}catch(e){}
const MG_MODES=[["names","表記チェック"],["threads","伏線"],["orbs","宿命刻の回収"],["serial","連載"],["open","未決"],["cast","登場表"],["history","履歴"],["data","同期とデータ"],["links","リンク"]];
const epPos=id=>eps.findIndex(e=>e.id===id);
function epOptions(sel,blank){return (blank!=null?`<option value="">${esc(blank)}</option>`:"")+eps.map((e,i)=>`<option value="${esc(e.id)}" ${e.id===sel?"selected":""}>EP${i+1} ${esc(e.title)}</option>`).join("")}
function gotoEp(id){selId=id; view="edit"; window._mobileEditing=true; saveView(); try{localStorage.setItem("kozo.sel",id)}catch(e){} render(); window.scrollTo({top:0})}
function gotoChar(id){charSel=id; view="chars"; window._mobileEditing=true; saveView(); try{localStorage.setItem("kozo.char",id)}catch(e){} render(); window.scrollTo({top:0})}
function gotoDoc(docId){
  if(docId==="__meta"){ view="policy"; saveView(); render(); return; }
  const p=docId.slice(0,2), id=docId.slice(2);
  if(p==="c:") return gotoChar(id);
  if(p==="s:"){ loreSel=id; loreMode="items"; view="lore"; window._mobileEditing=true; saveView(); render(); window.scrollTo({top:0}); return; }
  if(p==="o:"){ loreMode="orbs"; view="lore"; saveView(); render(); return; }
  if(p==="f:"){ thSel=id; mgMode="threads"; view="manage"; saveView(); render(); return; }
  if(p==="w:"){ const w=draftWhere(docId); if(w) openDraft(w.e.id,w.i); return; }
  gotoEp(docId);
}
function docLabel(docId){
  if(docId==="__meta") return "作品情報・方針";
  const p=docId.slice(0,2), id=docId.slice(2);
  if(p==="c:"){const c=chars.find(x=>x.id===id); return `キャラ「${c?c.name:"?"}」`;}
  if(p==="s:"){const s=setts.find(x=>x.id===id); return `設定「${s?s.title:"?"}」`;}
  if(p==="o:") return `宿命刻 ${id}`;
  if(p==="f:"){const t=threads.find(x=>x.id===id); return `伏線「${t?t.title:"?"}」`;}
  if(p==="w:") return draftLabel(docId);
  const i=epPos(docId); return i<0?"（削除されたEP）":`EP${i+1}「${eps[i].title}」`;
}
function mgStats(){
  const warn=threads.filter(t=>checkThread(t).length).length;
  return `<span>伏線 <b>${threads.length}</b>${warn?`（要確認 <b>${warn}</b>）`:""}</span><span>未決 <b>${collectOpen().length}</b></span><span>決定ログ <b>${decisions.length}</b></span>`;
}
function renderManage(){
  const m=$("#main");
  m.innerHTML=`<div class="seg mg-mode" role="group" aria-label="管理の表示">${MG_MODES.map(([k,l])=>`<button data-mg="${k}" aria-pressed="${mgMode===k}">${l}</button>`).join("")}</div><div id="mg"></div>`;
  document.querySelectorAll("[data-mg]").forEach(b=>b.onclick=()=>{mgMode=b.dataset.mg; try{localStorage.setItem("kozo.mg",mgMode)}catch(e){} render();});
  ({names:mgNames,threads:mgThreads,orbs:mgOrbs,serial:mgSerial,open:mgOpen,cast:mgCast,history:mgHistory,data:h=>{h.innerHTML=""; renderSyncCard(h);},links:mgLinks}[mgMode]||mgNames)($("#mg"));
}

/* 1. 表記チェック：旧表記の残りを探して置き換える */
const RENAME_SEED=[
  {from:"エルメンヒルト",to:"イレーネ",note:"聖女の名前（2026-10-09）"},
  {from:"ジード",to:"オルヴァ",note:"宿命刻の読み（2026-10-11）"},
  {from:"G巨神",to:"D破壊",note:"ギアの宿命刻（2026-10-16）"},
  {from:"G（ギア）",to:"D（ギア）",note:"ギアの宿命刻（2026-10-16）"},
  {from:"22刻",to:"26刻",note:"宿命刻の数（2026-10-16）"},
  {from:"22柱",to:"26柱",note:"旧神の数（2026-10-16）"},
  {from:"聖堂教院",to:"聖導教院",note:"表記ゆれ"},
  {from:"神聖騎士隊",to:"星煌騎士団",note:"術師編の配下（2026-10-09）"}];
const SKIP_KEYS=new Set(["id","order","ep","slot","pid","cid","arc","appearEp","collectEp","joinPrev","web","renames","plan","status","fate","kind","role","letter"]);
const FIELD_LABEL={title:"題",summary:"内容",presents:"提示するもの",memo:"メモ",open:"未決",beats:"流れ",note:"補足",tone:"トーン",orb:"宿命刻",source:"元の資料",
  name:"名前",aliases:"呼び名",role:"役割",group:"区分",first:"初登場",profile:"基本設定",personality:"性格",appearance:"外見",arc:"変化・終盤",relations:"関係",rels:"関係",text:"内容",caption:"画像の説明",
  body:"本文",keywords:"キーワード",category:"区分",holder:"保持者",tagline:"キャッチ",logline:"ログライン",policy:"方針",arcs:"編",parts:"各話",images:"画像",steps:"段階"};
function walkStrings(v,path,cb){
  if(typeof v==="string"){ cb(path,v); return; }
  if(Array.isArray(v)){ v.forEach((x,i)=>walkStrings(x,[...path,i],cb)); return; }
  if(v&&typeof v==="object") for(const k of Object.keys(v)) if(!SKIP_KEYS.has(k)) walkStrings(v[k],[...path,k],cb);
}
const getPath=(o,p)=>p.reduce((a,k)=>a==null?a:a[k],o);
function setPath(o,p,val){const last=p[p.length-1]; const parent=getPath(o,p.slice(0,-1)); if(parent!=null) parent[last]=val;}
function pathLabel(p){const names=p.filter(k=>typeof k==="string").map(k=>FIELD_LABEL[k]||k); const nums=p.filter(k=>typeof k==="number"); return names.join("・")+(p[0]==="parts"&&nums.length?`（第${nums[0]+1}話）`:"");}
function allDocs(){return [["__meta",meta],...eps.map(e=>[e.id,e]),...chars.map(c=>["c:"+c.id,c]),...setts.map(s=>["s:"+s.id,s]),...orbs.map(o=>["o:"+o.id,o]),...threads.map(t=>["f:"+t.id,t]),...drafts.map(d=>["w:"+d.id,d])];}
function scanNames(rules){
  const hits=[];
  rules.forEach((r,ri)=>{ if(!r.from) return;
    for(const [docId,doc] of allDocs()) walkStrings(doc,[],(path,s)=>{
      let i=s.indexOf(r.from);
      while(i>=0){
        const pre=s.slice(Math.max(0,i-8),i), post=s.slice(i+r.from.length,i+r.from.length+8);
        const hist=/旧|元の|以前|かつての名/.test(pre)||/^[」』）)]?(から|より)(変更|差し替|改名|変え)/.test(post);
        hits.push({ri,docId,path,idx:i,hist,pre:s.slice(Math.max(0,i-24),i),post:s.slice(i+r.from.length,i+r.from.length+24)});
        i=s.indexOf(r.from,i+r.from.length);
      }
    });
  });
  return hits;
}
function applyReplacements(list,rules){
  const groups=new Map();
  list.forEach(h=>{const k=h.docId+"\u0000"+JSON.stringify(h.path); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(h);});
  for(const hs of groups.values()){
    hs.sort((a,b)=>b.idx-a.idx);
    edit(hs[0].docId,o=>{ let s=getPath(o,hs[0].path); if(typeof s!=="string") return;
      for(const h of hs){ const r=rules[h.ri]; if(s.substr(h.idx,r.from.length)===r.from) s=s.slice(0,h.idx)+r.to+s.slice(h.idx+r.from.length); }
      setPath(o,hs[0].path,s); });
  }
}
function mgNames(host){
  const rules=meta.renames||[];
  const hits=scanNames(rules); const live=hits.filter(h=>!h.hist);
  const missingSeed=RENAME_SEED.filter(s=>!rules.some(r=>r.from===s.from));
  host.innerHTML=`<div class="card">
    <h2 class="sec">読み替えの対応表</h2>
    <div class="hint">改名や表記の変更を登録しておくと、台帳全体から旧表記の残りを探します。</div>
    <div class="rnlist">${rules.map((r,i)=>`<div class="rn"><input data-rf="${i}" value="${esc(r.from)}" placeholder="旧表記" aria-label="旧表記"><span aria-hidden="true">→</span><input data-rt2="${i}" value="${esc(r.to)}" placeholder="新表記" aria-label="新表記"><input class="rnote" data-rno="${i}" value="${esc(r.note)}" placeholder="メモ（いつ・なぜ）" aria-label="メモ"><button class="btn sm" data-rdel2="${i}" aria-label="削除">×</button></div>`).join("")||`<div class="empty">まだ登録がありません。</div>`}</div>
    <div class="btnrow"><button class="btn sm" id="rn-add">＋ 追加</button>${missingSeed.length?`<button class="btn sm primary" id="rn-seed">設定資料の変更履歴から追加（${missingSeed.length}件）</button>`:""}</div>
  </div>
  <div class="card">
    <h2 class="sec">旧表記の残り <span class="hint" style="letter-spacing:0">${hits.length}か所（うち記録として残していそうなもの ${hits.length-live.length}）</span></h2>
    ${hits.length?`<div class="hint">「旧〜」「〜から変更」のように、変更の記録として書いている箇所には「記録」の印を付け、一括置き換えから外しています。</div>
    <div class="btnrow">${live.length?`<button class="btn sm primary" id="rn-all">記録以外をすべて置き換える（${live.length}か所）</button>`:""}</div>`:`<div class="empty">${rules.length?"旧表記は見つかりませんでした。":"対応表を登録すると、ここに結果が出ます。"}</div>`}
    ${rules.map((r,ri)=>{const hs=hits.filter(h=>h.ri===ri); if(!hs.length) return "";
      return `<h3 class="sub">${esc(r.from)} → ${esc(r.to)}<span>${hs.length}</span></h3><div class="hits">${hs.map(h=>{const n=hits.indexOf(h); return `<div class="hit">
        <button class="loc" data-go="${esc(h.docId)}">${esc(docLabel(h.docId))}<span>${esc(pathLabel(h.path))}</span></button>
        <div class="snip">…${esc(h.pre)}<mark>${esc(r.from)}</mark>${esc(h.post)}…</div>
        <div class="hb">${h.hist?`<span class="chip">記録</span>`:""}<button class="btn sm" data-rep="${n}">置き換え</button></div></div>`;}).join("")}</div>`;}).join("")}
  </div>`;
  const setRules=mut=>{ edit("__meta",o=>{o.renames=structuredClone(o.renames||[]); mut(o.renames);}); };
  host.querySelectorAll("[data-rf]").forEach(el=>el.onchange=ev=>{setRules(r=>r[+el.dataset.rf].from=ev.target.value.trim()); render();});
  host.querySelectorAll("[data-rt2]").forEach(el=>el.onchange=ev=>{setRules(r=>r[+el.dataset.rt2].to=ev.target.value.trim()); render();});
  host.querySelectorAll("[data-rno]").forEach(el=>el.oninput=ev=>setRules(r=>r[+el.dataset.rno].note=ev.target.value));
  host.querySelectorAll("[data-rdel2]").forEach(el=>el.onclick=()=>{setRules(r=>r.splice(+el.dataset.rdel2,1)); render();});
  $("#rn-add").onclick=()=>{setRules(r=>r.push({from:"",to:"",note:""})); render(); const ins=host.querySelectorAll("[data-rf]"); ins[ins.length-1]?.focus();};
  if($("#rn-seed")) $("#rn-seed").onclick=()=>{setRules(r=>missingSeed.forEach(s=>r.push({...s}))); render();};
  if($("#rn-all")) $("#rn-all").onclick=()=>{applyReplacements(live,rules); setSave(`${live.length}か所を置き換えました`); render();};
  host.querySelectorAll("[data-rep]").forEach(el=>el.onclick=()=>{applyReplacements([hits[+el.dataset.rep]],rules); render();});
  host.querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>gotoDoc(el.dataset.go));
}

/* 2. 伏線：張る→段階→回収をエピソードの並びの上で見る */
const TH_KINDS=["伏線","段階","謎"], TH_ROLES=["張る","段階","回収"];
function checkThread(t){
  const out=[]; const st=t.steps||[];
  if(!st.length) return ["まだ段階がありません"];
  const gone=st.filter(s=>s.ep&&epPos(s.ep)<0).length; if(gone) out.push(`削除されたエピソードを指している段階が${gone}件あります`);
  if(st.some(s=>!s.ep)) out.push("エピソードが未設定の段階があります");
  if(t.kind!=="段階"&&!st.some(s=>s.role==="回収")) out.push("まだ回収されていません");
  for(let i=1;i<st.length;i++){ const a=epPos(st[i-1].ep), b=epPos(st[i].ep);
    if(a>=0&&b>=0&&b<a) out.push(`${i+1}番目「${st[i].note||st[i].role}」が、ひとつ前の段階（EP${a+1}）より前の EP${b+1} にあります`); }
  return out;
}
function threadSpan(t){const ps=(t.steps||[]).map(s=>epPos(s.ep)).filter(p=>p>=0); return ps.length?[Math.min(...ps),Math.max(...ps)]:[1e9,1e9];}
function sortedThreads(){return [...threads].sort((a,b)=>threadSpan(a)[0]-threadSpan(b)[0]||(a.order||0)-(b.order||0));}
const EXAMPLE_THREAD={title:"アルブレヒトの登場",kind:"段階",memo:"中盤以降の縦軸メモ 1章「登場の段階」より",steps:[
  {ep:"e04",role:"張る",note:"予告のワンカット（イレーネとともに知らせを聞く）"},{ep:"e10",role:"段階",note:"頭目の証言で組織名「異端審問庁」"},
  {ep:"e11",role:"段階",note:"術師がイレーネと団長の名を口にする"},{ep:"e12",role:"段階",note:"増援として現れ、ギアと邂逅"},
  {ep:"e15",role:"段階",note:"過去編：病院を包囲した騎士団の長として名前だけ"},{ep:"e19",role:"段階",note:"遺跡の宿命刻の回収に関わっていた影"}]};
function mgThreads(host){
  const list=sortedThreads();
  if(!list.find(t=>t.id===thSel)) thSel=list[0]?.id||null;
  const t=threads.find(x=>x.id===thSel);
  const N=eps.length;
  const cols=`minmax(120px,190px) repeat(${N},22px)`;
  const canExample=!threads.length&&EXAMPLE_THREAD.steps.every(s=>epPos(s.ep)>=0);
  host.innerHTML=`<div class="card">
    <h2 class="sec">伏線と段階 <span class="btnrow" style="margin:0"><button class="btn sm primary" id="th-add">＋ 新しい伏線</button>${canExample?`<button class="btn sm" id="th-ex">例：アルブレヒトの登場を入れる</button>`:""}</span></h2>
    <div class="hint">○＝張る、・＝段階、●＝回収。エピソードを並べ替えて順序が逆になったり、回収が抜けたりすると ⚠ が付きます。</div>
    ${list.length?`<div class="tl-wrap"><div class="tl" style="grid-template-columns:${cols}">
      <div class="tl-h tl-name">伏線</div>${eps.map((e,i)=>`<button class="tl-h" data-tlep="${esc(e.id)}" title="EP${i+1} ${esc(e.title)}">${i+1}</button>`).join("")}
      ${list.map(th=>{const [a,b]=threadSpan(th); const iss=checkThread(th); const at=new Map(); (th.steps||[]).forEach(s=>{const p=epPos(s.ep); if(p>=0){ const prev=at.get(p); at.set(p,prev==="回収"?"回収":s.role==="回収"?"回収":prev||s.role);} });
        return `<button class="tl-name tl-row ${th.id===thSel?"cur":""}" data-th="${esc(th.id)}">${iss.length?`<span class="warn-i" title="${esc(iss.join("／"))}">⚠</span>`:""}${esc(th.title||"（無題）")}</button>`+
          eps.map((e,i)=>{const r=at.get(i); const inSpan=i>=a&&i<=b; return `<span class="tl-c ${inSpan?"span":""} ${i===a?"first":""} ${i===b?"last":""} ${th.id===thSel?"cur":""}" title="EP${i+1}${r?"："+r:""}">${r?`<i class="mk ${r==="張る"?"open":r==="回収"?"done":"mid"}"></i>`:""}</span>`;}).join("");}).join("")}
    </div></div>`:`<div class="empty">まだ伏線がありません。「＋ 新しい伏線」から登録できます。</div>`}
  </div>
  ${t?threadEditorHTML(t):""}`;
  $("#th-add").onclick=async()=>{ const order=Math.max(0,...threads.map(x=>x.order||0))+10;
    thSel=await addDoc("f",{title:"新しい伏線",kind:"伏線",memo:"",steps:[{ep:selId&&epPos(selId)>=0?selId:(eps[0]||{}).id||"",role:"張る",note:""}],order}); render(); };
  if($("#th-ex")) $("#th-ex").onclick=async()=>{ thSel=await addDoc("f",{...structuredClone(EXAMPLE_THREAD),order:10}); render(); };
  host.querySelectorAll("[data-th]").forEach(b=>b.onclick=()=>{thSel=b.dataset.th; try{localStorage.setItem("kozo.th",thSel)}catch(e){} render();});
  host.querySelectorAll("[data-tlep]").forEach(b=>b.onclick=()=>gotoEp(b.dataset.tlep));
  if(t) wireThreadEditor(t);
}
function threadEditorHTML(t){
  const iss=checkThread(t);
  return `<div class="card">
    <div class="edhead"><input class="titlein" id="th-title" value="${esc(t.title)}" aria-label="伏線の名前" style="flex:1 1 240px">
      <div class="btnrow" style="margin:0"><label class="f" style="margin:0">種類<select id="th-kind">${TH_KINDS.map(k=>`<option ${k===t.kind?"selected":""}>${k}</option>`).join("")}</select></label><button class="btn sm danger" id="th-del">削除</button></div></div>
    ${iss.length?`<div class="issues">${iss.map(s=>`<div>⚠ ${esc(s)}</div>`).join("")}</div>`:`<div class="okline">✓ 順序と回収に問題はありません</div>`}
    <div class="steps">${(t.steps||[]).map((s,i)=>`<div class="step">
      <span class="sn">${i+1}</span>
      <select data-sep="${i}" aria-label="エピソード">${epOptions(s.ep,"（エピソードを選ぶ）")}${s.ep&&epPos(s.ep)<0?`<option value="${esc(s.ep)}" selected>（削除されたEP）</option>`:""}</select>
      <select data-srole="${i}" aria-label="役割">${TH_ROLES.map(r=>`<option ${r===s.role?"selected":""}>${r}</option>`).join("")}</select>
      <input data-snote="${i}" value="${esc(s.note)}" placeholder="この段階で見せること" aria-label="内容">
      <span class="sbtn"><button class="iconbtn" data-sup="${i}" aria-label="上へ" ${i===0?"disabled":""}>↑</button><button class="iconbtn" data-sdown="${i}" aria-label="下へ" ${i===t.steps.length-1?"disabled":""}>↓</button><button class="iconbtn" data-sdel="${i}" aria-label="この段階を削除">×</button></span>
    </div>`).join("")}</div>
    <button class="btn sm" id="th-step" style="margin-top:8px">＋ 段階を追加</button>
    <label class="f block" style="margin-top:12px">メモ<textarea id="th-memo" rows="${rowsFor(t.memo,2)}">${esc(t.memo)}</textarea></label>
  </div>`;
}
function wireThreadEditor(t){
  const id="f:"+t.id;
  $("#th-title").onchange=ev=>{edit(id,o=>o.title=ev.target.value); render();};
  $("#th-kind").onchange=ev=>{edit(id,o=>o.kind=ev.target.value); render();};
  $("#th-memo").oninput=ev=>edit(id,o=>o.memo=ev.target.value);
  document.querySelectorAll("[data-sep]").forEach(el=>el.onchange=ev=>{edit(id,o=>o.steps[+el.dataset.sep].ep=ev.target.value); render();});
  document.querySelectorAll("[data-srole]").forEach(el=>el.onchange=ev=>{edit(id,o=>o.steps[+el.dataset.srole].role=ev.target.value); render();});
  document.querySelectorAll("[data-snote]").forEach(el=>el.oninput=ev=>edit(id,o=>o.steps[+el.dataset.snote].note=ev.target.value));
  const mv=(a,b)=>{edit(id,o=>{const x=o.steps[a];o.steps[a]=o.steps[b];o.steps[b]=x}); render();};
  document.querySelectorAll("[data-sup]").forEach(el=>el.onclick=()=>mv(+el.dataset.sup,+el.dataset.sup-1));
  document.querySelectorAll("[data-sdown]").forEach(el=>el.onclick=()=>mv(+el.dataset.sdown,+el.dataset.sdown+1));
  document.querySelectorAll("[data-sdel]").forEach(el=>el.onclick=()=>{edit(id,o=>o.steps.splice(+el.dataset.sdel,1)); render();});
  $("#th-step").onclick=()=>{edit(id,o=>{o.steps=o.steps||[]; const last=o.steps[o.steps.length-1]; o.steps.push({ep:last?last.ep:"",role:"段階",note:""});}); render(); const ins=document.querySelectorAll("[data-snote]"); ins[ins.length-1]?.focus();};
  $("#th-del").onclick=async ev=>{ if(pendingDelete!=="th"){pendingDelete="th"; ev.target.textContent="もう一度押すと削除"; return;} pendingDelete=null; await removeDoc(id); thSel=null; render(); };
}

/* 3. 宿命刻の回収表 */
const FATES=["ゼナが保持","ゼナが吸収","ギアが保持","味方が保持","盟主が保管","騎士団が回収","敵が保持","未定"];
const ZENA=f=>f==="ゼナが保持"||f==="ゼナが吸収";
function zenaAt(p){return orbs.filter(o=>ZENA(o.fate)&&(o.collectEp||o.appearEp)&&epPos(o.collectEp||o.appearEp)>=0&&epPos(o.collectEp||o.appearEp)<=p);}
function guessOrbs(){
  const filled=[];
  for(const o of orbs){
    if(o.letter==="A"&&/ゼナ/.test(o.holder||"")&&!o.appearEp&&eps[0]){ edit("o:"+o.id,x=>{x.appearEp=eps[0].id; if(!x.fate) x.fate="ゼナが保持";}); filled.push("A"); continue; }
    if(o.appearEp||o.collectEp) continue;
    const e=eps.find(e=>{const s=String(e.orb||""); if(/^候補|ハズレ/.test(s)) return false; const m=s.match(/(?:^|：|★)\s*([A-Z])(?=[\s　]|[^\x00-\x7F])/); return m&&m[1]===o.letter;});
    if(!e) continue;
    const s=String(e.orb||""); const fate=/ゼナ[^）)]*(吸収|乗っ取り)/.test(s)?"ゼナが吸収":/（ギア）|\(ギア\)/.test(s)?"ギアが保持":"";
    edit("o:"+o.id,x=>{x.appearEp=e.id; if(fate==="ゼナが吸収") x.collectEp=e.id; if(fate&&!x.fate) x.fate=fate;}); filled.push(o.letter);
  }
  return filled;
}
function mgOrbs(host){
  if(!orbs.length){ host.innerHTML=`<div class="notice">宿命刻の表がまだありません。「設定」タブの「宿命刻（A〜Z）」で作るか、設定データを取り込んでください。</div>`; return; }
  const assigned=orbs.filter(o=>o.holder&&o.holder.trim()).length, placed=orbs.filter(o=>o.appearEp).length;
  if(orbAt==null||orbAt>=eps.length) orbAt=eps.length-1;
  const counts=eps.map((e,i)=>zenaAt(i).length); const max=Math.max(1,...counts);
  const r=ranges(); const now=zenaAt(orbAt); const at=eps[orbAt];
  host.innerHTML=`<div class="card">
    <h2 class="sec">ゼナが持っている刻の数 <span class="hint" style="letter-spacing:0">割り当て済み ${assigned}／26・登場EP決定 ${placed}／26</span></h2>
    <div class="zbars" role="img" aria-label="エピソードごとのゼナの刻の数">${counts.map((c,i)=>`<button class="zb ${i===orbAt?"cur":""}" data-zat="${i}" title="EP${i+1}：${c}刻"><i style="height:${Math.round(c/max*100)}%"></i><span>${i+1}</span></button>`).join("")}</div>
    <div class="zat">${at?`<b>EP${orbAt+1}「${esc(at.title)}」</b>（Web ${rng(r[at.id])}）の時点で、ゼナは <b class="mono">${now.length}</b> 刻：${now.map(o=>`<span class="chip orb real">${esc(o.letter)} ${esc(String(o.name||"").split(/[ →（(]/)[0])}</span>`).join(" ")||"—"}`:""}</div>
    <div class="hint">「回収EP」（なければ「登場EP」）の時点で、行き先が「ゼナが保持／ゼナが吸収」の刻を数えています。棒を押すとその時点の内訳が出ます。</div>
  </div>
  <div class="card">
    <h2 class="sec">回収表 <button class="btn sm" id="og-guess">エピソードの宿命刻欄から推定して埋める</button></h2>
    <div class="hint" id="og-msg">空欄だけを埋めます。入っている値は変えません。</div>
    <div class="tablewrap" style="margin-block:10px 0"><table class="orbtable cl"><thead><tr><th>刻</th><th>名称</th><th>保持者</th><th>登場EP</th><th>回収EP</th><th>行き先</th></tr></thead><tbody>
    ${orbs.map(o=>{const a=epPos(o.appearEp), c=epPos(o.collectEp); const bad=a>=0&&c>=0&&c<a;
      return `<tr class="${o.holder&&o.holder.trim()?"has":""}"><td class="n">${esc(o.letter)}</td><td>${esc(o.name)}</td><td>${esc(o.holder)}</td>
      <td><select data-oe="appearEp" data-ol="${esc(o.id)}" aria-label="${esc(o.letter)}の登場EP">${epOptions(o.appearEp,"—")}</select></td>
      <td><select data-oe="collectEp" data-ol="${esc(o.id)}" aria-label="${esc(o.letter)}の回収EP">${epOptions(o.collectEp,"—")}</select>${bad?`<div class="bad-t">⚠ 登場より前</div>`:""}</td>
      <td><select data-oe="fate" data-ol="${esc(o.id)}" aria-label="${esc(o.letter)}の行き先"><option value="">—</option>${FATES.map(f=>`<option ${f===o.fate?"selected":""}>${f}</option>`).join("")}</select></td></tr>`;}).join("")}
    </tbody></table></div>
  </div>`;
  host.querySelectorAll("[data-zat]").forEach(b=>b.onclick=()=>{orbAt=+b.dataset.zat; render();});
  host.querySelectorAll("[data-oe]").forEach(el=>el.onchange=ev=>{edit("o:"+el.dataset.ol,o=>o[el.dataset.oe]=ev.target.value); render();});
  $("#og-guess").onclick=()=>{const f=guessOrbs(); render(); const m=$("#og-msg"); if(m) m.textContent=f.length?`${f.join("・")} を埋めました。内容を確かめてください。`:"推定できる空欄はありませんでした。";};
}

/* 4. 連載：公開ブロックと書き溜め */
const WSTAT=["未着手","執筆中","推敲","予約","公開済"];
const planOf=()=>({need:4,pace:1,per:3000,...(meta.plan||{})});
function webOf(e){const n=count(e); const w=(e.web||[]).slice(0,n); while(w.length<n) w.push({st:"未着手",n:0}); return w;}
function blocksOf(){const out=[]; eps.forEach((e,i)=>{ if(i===0||!e.joinPrev) out.push([]); out[out.length-1].push(e); }); return out;}
function webView(e){ return webOf(e).map((w,j)=>{ const dc=draftCount(e,j); return dc!=null?{...w,n:dc,auto:true}:w; }); }
function mgSerial(host){
  const P=planOf(), r=ranges(), bl=blocksOf();
  const all=eps.flatMap(e=>webView(e)); const total=all.length;
  const done=all.filter(w=>WSTAT.indexOf(w.st)>=2).length, pub=all.filter(w=>w.st==="公開済").length, chars_=all.reduce((s,w)=>s+(Number(w.n)||0),0);
  const pre=bl.slice(0,P.need).flat().flatMap(e=>webView(e)); const preDone=pre.filter(w=>WSTAT.indexOf(w.st)>=2).length;
  const left=total-done; const weeks=P.pace>0?Math.ceil(left/P.pace):null;
  const eta=weeks!=null?new Date(Date.now()+weeks*7*864e5):null;
  const unknown=eps.filter(e=>!count(e)).length;
  host.innerHTML=`<div class="card">
    <h2 class="sec">連載の見通し</h2>
    <div class="kpis">
      <div><span>公開ブロック</span><b class="mono">${bl.length}</b></div>
      <div><span>書き上がり（推敲以降）</span><b class="mono">${done}<small>／${total}話</small></b></div>
      <div><span>公開済み</span><b class="mono">${pub}<small>話</small></b></div>
      <div><span>記録した字数</span><b class="mono">${chars_.toLocaleString()}<small>字</small></b></div>
    </div>
    <div class="plan2">
      <div><b>開始前の書き溜め</b>（ブロック1〜${P.need}、Web ${pre.length}話）<br>${pre.length&&preDone>=pre.length?`<span class="okline">✓ 達成しています</span>`:`あと <b class="mono">${pre.length-preDone}</b>話（約 ${((pre.length-preDone)*P.per).toLocaleString()}字）`}
        <div class="meter"><i style="width:${pre.length?Math.round(preDone/pre.length*100):0}%"></i></div></div>
      <div><b>今の構成を書き終えるまで</b><br>${weeks!=null?`残り ${left}話 ÷ 週${P.pace}話 ＝ 約 <b class="mono">${weeks}</b>週（${eta.getFullYear()}年${eta.getMonth()+1}月ごろ）`:"—"}${unknown?`<br><span class="hint">Web話数が未定のエピソード（${unknown}本）は数えていません</span>`:""}</div>
    </div>
    <div class="grid" style="margin-top:10px">
      <label class="f">開始前に書き溜めるブロック数<input type="number" min="0" max="${bl.length}" id="pl-need" value="${P.need}"></label>
      <label class="f">書くペース（週に何話）<input type="number" min="0.5" step="0.5" id="pl-pace" value="${P.pace}"></label>
      <label class="f">1話の字数の目安<input type="number" min="500" step="100" id="pl-per" value="${P.per}"></label>
    </div>
  </div>
  <div class="card">
    <h2 class="sec">公開ブロック</h2>
    <div class="hint">各話の四角を押すと、状態が「未着手→執筆中→推敲→予約→公開済」の順に変わります。字数は「字数」を開いて入力します。</div>
    ${bl.map((b,bi)=>{const ws=b.flatMap(e=>webView(e)); const d=ws.filter(w=>WSTAT.indexOf(w.st)>=2).length; const x0=r[b[0].id], x1=r[b[b.length-1].id];
      return `<div class="blk ${bi<P.need?"pre":""}"><div class="blkh"><b>ブロック ${bi+1}</b><span>Web ${x0.from!=null&&x1.to!=null?`${x0.from}〜${x1.to}`:"未定"}（${ws.length}話）</span><span>書き上がり ${d}／${ws.length}</span>${bi<P.need?`<span class="chip">開始前</span>`:""}</div>
      ${b.map((e,k)=>{const x=r[e.id]; const w=webView(e); const gi=epPos(e.id);
        return `<div class="blkrow">
          <button class="ep-l" data-goep2="${esc(e.id)}">EP${x.ep} ${esc(e.title)}</button>
          <div class="wchips">${w.length?w.map((s,j)=>`<button class="wc st${WSTAT.indexOf(s.st)}" data-wc="${esc(e.id)}:${j}" title="${s.st}">${x.from!=null?x.from+j:j+1}</button>`).join(""):`<span class="hint">Web話数未定</span>`}</div>
          ${w.length?`<details class="wn"><summary>字数</summary>${w.map((s,j)=>`<label>${x.from!=null?x.from+j:j+1}<input type="number" min="0" step="100" data-wn="${esc(e.id)}:${j}" value="${s.n||""}" ${s.auto?"disabled title='本文の下書きから自動で数えています'":""}></label>`).join("")}</details>`:""}
          ${gi>0?`<button class="btn sm" data-join="${esc(e.id)}">${k===0?"前のブロックとつなぐ":"ここで区切る"}</button>`:""}
        </div>`;}).join("")}</div>`;}).join("")}
  </div>`;
  const setPlan=(k,v)=>edit("__meta",o=>{o.plan={...planOf(),...(o.plan||{}),[k]:v};});
  $("#pl-need").onchange=ev=>{setPlan("need",Math.max(0,Number(ev.target.value)||0)); render();};
  $("#pl-pace").onchange=ev=>{setPlan("pace",Math.max(0.5,Number(ev.target.value)||1)); render();};
  $("#pl-per").onchange=ev=>{setPlan("per",Math.max(500,Number(ev.target.value)||3000)); render();};
  host.querySelectorAll("[data-wc]").forEach(b=>b.onclick=()=>{const [id,j]=b.dataset.wc.split(":"); edit(id,o=>{o.web=webOf(o); const s=o.web[+j]; s.st=WSTAT[(WSTAT.indexOf(s.st)+1)%WSTAT.length];}); render();});
  host.querySelectorAll("[data-wn]").forEach(el=>el.onchange=ev=>{const [id,j]=el.dataset.wn.split(":"); edit(id,o=>{o.web=webOf(o); o.web[+j].n=Math.max(0,Number(ev.target.value)||0);}); render();});
  host.querySelectorAll("[data-join]").forEach(b=>b.onclick=()=>{edit(b.dataset.join,o=>o.joinPrev=!o.joinPrev); render();});
  host.querySelectorAll("[data-goep2]").forEach(b=>b.onclick=()=>gotoEp(b.dataset.goep2));
}

/* 5. 未決：散らばった要確認を集め、決めたら決定ログへ */
function splitSegs(line){ // 「」（）の外にある ／ と / で区切る
  const out=[]; let depth=0, cur="";
  for(const ch of line){ if("「『（(【".includes(ch)) depth++; else if("」』）)】".includes(ch)) depth=Math.max(0,depth-1);
    if((ch==="／"||ch==="/")&&depth===0){ out.push(cur); cur=""; } else cur+=ch; }
  out.push(cur); return out.map(s=>s.trim());
}
function collectOpen(){
  const items=[];
  const add=(docId,field,text,kind)=>String(text||"").split("\n").forEach((line,li)=>splitSegs(line).forEach((seg,si)=>{ if(seg&&!/^~~.*~~$/.test(seg)) items.push({docId,field,li,si,text:seg,kind}); }));
  eps.forEach(e=>add(e.id,"open",e.open,"ep"));
  chars.forEach(c=>add("c:"+c.id,"memo",c.memo,"char"));
  setts.forEach(s=>{ add("s:"+s.id,"memo",s.memo,"sett"); if(s.status==="未決") items.push({docId:"s:"+s.id,field:"status",text:`「${s.title}」の扱い`,kind:"sett"}); });
  return items;
}
function removeSeg(text,li,si){
  const lines=String(text||"").split("\n");
  const segs=splitSegs(lines[li]||""); segs.splice(si,1);
  lines[li]=segs.filter(Boolean).join("／");
  return lines.filter(l=>l.trim()).join("\n");
}
const today=()=>{const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
function mgOpen(host){
  const all=collectOpen();
  const items=all.filter(it=>(openFilter==="all"||it.kind===openFilter)&&(!openQ.trim()||(it.text+docLabel(it.docId)).includes(openQ.trim()))&&(!openStar||it.text.includes("★")));
  host.innerHTML=`<div class="card">
    <h2 class="sec">未決・確認事項 <span class="hint" style="letter-spacing:0">${items.length}／${all.length}件</span></h2>
    <div class="hint">エピソードの「未決・確認事項」、キャラと設定の「未決・★案」を、1行ずつ（「／」の区切りも1件として）集めています。「決定」を押すと元の欄から外し、決定ログに日付つきで残します。</div>
    <div class="ofil">
      <div class="seg" role="group" aria-label="絞り込み">${[["all","すべて"],["ep","エピソード"],["char","キャラ"],["sett","設定"]].map(([k,l])=>`<button data-of="${k}" aria-pressed="${openFilter===k}">${l}</button>`).join("")}</div>
      <input type="search" id="oq" placeholder="言葉で絞り込む" value="${esc(openQ)}">
      <label class="ck"><input type="checkbox" id="ostar" ${openStar?"checked":""}> ★を含むものだけ</label>
    </div>
    <div class="olist">${items.map((it,i)=>`<div class="oi" data-oi="${all.indexOf(it)}">
      <button class="loc" data-go="${esc(it.docId)}">${esc(docLabel(it.docId))}</button>
      <div class="ot">${esc(it.text)}</div>
      <button class="btn sm" data-dec="${all.indexOf(it)}">決定</button>
      <div class="decf" hidden><input placeholder="決めた内容（空欄でも可）" aria-label="決めた内容"><button class="btn sm primary" data-decok="${all.indexOf(it)}">決定ログに記録</button><button class="btn sm" data-decno>やめる</button></div>
    </div>`).join("")||`<div class="empty">該当する未決はありません。</div>`}</div>
  </div>
  <div class="card">
    <h2 class="sec">決定ログ <span class="hint" style="letter-spacing:0">${decisions.length}件</span></h2>
    <div class="dlog">${decisions.map(d=>`<div class="di"><span class="mono dd">${esc(d.date)}</span><div><b>${esc(d.item)}</b>${d.decision?` → ${esc(d.decision)}`:""}<div class="hint">${esc(d.srcLabel||"")}</div></div><button class="btn sm" data-undo="${esc(d.id)}">元に戻す</button></div>`).join("")||`<div class="empty">まだ記録はありません。</div>`}</div>
  </div>`;
  host.querySelectorAll("[data-of]").forEach(b=>b.onclick=()=>{openFilter=b.dataset.of; render();});
  $("#oq").oninput=ev=>{openQ=ev.target.value; clearTimeout(window._oqT); window._oqT=setTimeout(()=>{render(); const q2=$("#oq"); if(q2){q2.focus(); q2.setSelectionRange(q2.value.length,q2.value.length);}},250);};
  $("#ostar").onchange=ev=>{openStar=ev.target.checked; render();};
  host.querySelectorAll("[data-go]").forEach(el=>el.onclick=()=>gotoDoc(el.dataset.go));
  host.querySelectorAll("[data-dec]").forEach(b=>b.onclick=()=>{const f=b.parentElement.querySelector(".decf"); f.hidden=false; b.hidden=true; f.querySelector("input").focus();});
  host.querySelectorAll("[data-decno]").forEach(b=>b.onclick=()=>{const p=b.closest(".oi"); p.querySelector(".decf").hidden=true; p.querySelector("[data-dec]").hidden=false;});
  host.querySelectorAll("[data-decok]").forEach(b=>b.onclick=async()=>{
    const it=all[+b.dataset.decok]; const decision=b.parentElement.querySelector("input").value.trim();
    if(it.field==="status") edit(it.docId,o=>o.status="決定");
    else edit(it.docId,o=>o[it.field]=removeSeg(o[it.field],it.li,it.si));
    await addDoc("d",{date:today(),item:it.text,decision,src:it.docId,srcField:it.field,srcLabel:docLabel(it.docId),createdAt:Date.now()});
    setSave("決定ログに記録しました"); render();
  });
  host.querySelectorAll("[data-undo]").forEach(b=>b.onclick=async()=>{
    const d=decisions.find(x=>x.id===b.dataset.undo); if(!d) return;
    if(pendingDelete!=="undo"+d.id){ pendingDelete="undo"+d.id; b.textContent="元の欄に戻す？"; return; } pendingDelete=null;
    const exists=d.src==="__meta"||recs.has(keyOf(d.src))&&!recs.get(keyOf(d.src)).deleted;
    if(exists){ if(d.srcField==="status") edit(d.src,o=>o.status="未決"); else edit(d.src,o=>o[d.srcField]=[o[d.srcField],d.item].filter(x=>String(x||"").trim()).join("\n")); }
    await removeDoc("d:"+d.id); setSave(exists?"元の欄に戻しました":"元の項目がないため、ログだけ消しました"); render();
  });
}

/* 7. リンク：カクヨムの管理画面など、よく開くページ */
const DEFAULT_LINKS=[{title:"カクヨム 作品の管理画面",url:"https://kakuyomu.jp/my/works/16818023213562242212",note:"エピソードの投稿・予約公開・作品情報の編集"}];
const linksOf=()=>Array.isArray(meta.links)?meta.links:DEFAULT_LINKS;
const safeUrl=u=>/^https?:\/\/[^\s]+$/i.test(String(u||"").trim())?String(u).trim():"";
let linkEdit=false;
function mgLinks(host){
  const links=linksOf();
  host.innerHTML=`<div class="card">
    <h2 class="sec">リンク <button class="btn sm" id="lk-edit">${linkEdit?"編集を終える":"編集"}</button></h2>
    <div class="hint">押すと新しいタブ（アプリから開いた場合はブラウザ）で開きます。</div>
    <div class="links">${links.map((l,i)=>{const u=safeUrl(l.url); return linkEdit?`<div class="lkedit">
        <input data-lt="${i}" value="${esc(l.title)}" placeholder="名前" aria-label="名前">
        <input data-lu="${i}" value="${esc(l.url)}" placeholder="https://…" aria-label="アドレス" inputmode="url">
        <input data-ln="${i}" value="${esc(l.note)}" placeholder="メモ" aria-label="メモ">
        <span class="sbtn"><button class="iconbtn" data-lup="${i}" aria-label="上へ" ${i===0?"disabled":""}>↑</button><button class="iconbtn" data-ldel="${i}" aria-label="削除">×</button></span>
        ${l.url&&!u?`<div class="bad-t">https:// から始まるアドレスを入れてください</div>`:""}</div>`
      :`<a class="lk" ${u?`href="${esc(u)}" target="_blank" rel="noopener noreferrer"`:""}><b>${esc(l.title||u||"（名前なし）")}</b><span class="mono">${esc(u||"アドレスが未設定です")}</span>${l.note?`<span>${esc(l.note)}</span>`:""}<i aria-hidden="true">↗</i></a>`;}).join("")||`<div class="empty">リンクはまだありません。</div>`}</div>
    ${linkEdit?`<button class="btn sm" id="lk-add" style="margin-top:8px">＋ リンクを追加</button>`:""}
  </div>`;
  const setLinks=mut=>edit("__meta",o=>{o.links=structuredClone(Array.isArray(o.links)?o.links:DEFAULT_LINKS); mut(o.links);});
  $("#lk-edit").onclick=()=>{linkEdit=!linkEdit; render();};
  host.querySelectorAll("[data-lt]").forEach(el=>el.oninput=ev=>setLinks(l=>l[+el.dataset.lt].title=ev.target.value));
  host.querySelectorAll("[data-lu]").forEach(el=>el.onchange=ev=>{setLinks(l=>l[+el.dataset.lu].url=ev.target.value.trim()); render();});
  host.querySelectorAll("[data-ln]").forEach(el=>el.oninput=ev=>setLinks(l=>l[+el.dataset.ln].note=ev.target.value));
  host.querySelectorAll("[data-lup]").forEach(el=>el.onclick=()=>{const i=+el.dataset.lup; setLinks(l=>{const x=l[i];l[i]=l[i-1];l[i-1]=x}); render();});
  host.querySelectorAll("[data-ldel]").forEach(el=>el.onclick=()=>{setLinks(l=>l.splice(+el.dataset.ldel,1)); render();});
  if($("#lk-add")) $("#lk-add").onclick=()=>{setLinks(l=>l.push({title:"",url:"",note:""})); render(); const ins=host.querySelectorAll("[data-lt]"); ins[ins.length-1]?.focus();};
}

/* 8. 履歴：競合で残さなかった内容や、上書き・編集の前の状態を見返して戻す */
let histFilter="all", histKey="", histOpen=null;
const HIST_GROUPS=[["all","すべて"],["conflict","競合"],["sync","同期"],["edit","編集"],["discard","破棄・置き換え"]];
const histGroup=k=>k.startsWith("競合")?"conflict":/同期|別の端末/.test(k)?"sync":/編集|戻す/.test(k)?"edit":"discard";
function fmtVal(v){
  if(v==null) return "";
  if(typeof v!=="object") return String(v);
  if(Array.isArray(v)) return v.map(x=>x&&typeof x==="object"?Object.entries(x).filter(([k,y])=>!SKIP_KEYS.has(k)&&k!=="id"&&typeof y==="string"&&y).map(([,y])=>y).join(" ／ "):String(x)).filter(Boolean).join("\n");
  return Object.entries(v).filter(([k])=>!SKIP_KEYS.has(k)).map(([k,y])=>`${FIELD_LABEL[k]||k}：${fmtVal(y)}`).join("\n");
}
function lineDiff(a,b){ // 行単位の差分（LCS）
  const A=String(a).split("\n"), B=String(b).split("\n"); const n=A.length, m=B.length;
  if(n*m>40000) return [...A.map(t=>["-",t]),...B.map(t=>["+",t])];
  const L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[]; let i=0,j=0;
  while(i<n&&j<m){ if(A[i]===B[j]){out.push(["=",A[i]]);i++;j++;} else if(L[i+1][j]>=L[i][j+1]) out.push(["-",A[i++]]); else out.push(["+",B[j++]]); }
  while(i<n) out.push(["-",A[i++]]); while(j<m) out.push(["+",B[j++]]);
  return out;
}
function histDiff(old,cur,oldDel,curDel){
  if(curDel===undefined) return `<div class="hint">この項目は今はありません（削除されています）。戻すと復活します。</div>`;
  const keys=[...new Set([...Object.keys(old||{}),...Object.keys(cur||{})])].filter(k=>!["order","updatedAt","web","joinPrev"].includes(k)&&!(k==="relations"&&("rels" in (old||{})||"rels" in (cur||{}))));
  const ch=keys.filter(k=>stable(old?.[k])!==stable(cur?.[k]));
  let html="";
  if(!!oldDel!==!!curDel) html+=`<div class="hint">${oldDel?"この版では削除されていました":"今は削除されています"}</div>`;
  if(!ch.length) return html+`<div class="okline">今の内容と同じです</div>`;
  return html+ch.map(k=>{const d=lineDiff(fmtVal(old?.[k]),fmtVal(cur?.[k]));
    return `<div class="hdf"><b>${esc(FIELD_LABEL[k]||k)}</b><div class="dl">${d.filter((x,ix)=>x[0]!=="="||d[ix-1]?.[0]!=="="||d[ix+1]?.[0]!=="=").map(([t,l])=>`<div class="d${t==="-"?"o":t==="+"?"n":"s"}">${t==="-"?"当時":t==="+"?"今":"　"}<span>${esc(l)||"&nbsp;"}</span></div>`).join("")}</div></div>`;}).join("");
}
async function mgHistory(host){
  host.innerHTML=`<div class="card"><div class="hint">履歴を読み込んでいます…</div></div>`;
  let list=[]; try{ list=(await Store.entries("history")).map(([id,h])=>({id,...h})).sort((a,b)=>b.ts-a.ts); }catch(e){}
  if(mgMode!=="history"||view!=="manage") return;
  const keysWith=[...new Set(list.map(h=>h.key))];
  const shown=list.filter(h=>(histFilter==="all"||histGroup(h.kind)===histFilter)&&(!histKey||h.key===histKey));
  const conflicts=list.filter(h=>h.kind.startsWith("競合")).length;
  const fmtT=ts=>{const d=new Date(ts); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;};
  host.innerHTML=`<div class="card">
    <h2 class="sec">履歴 <span class="hint" style="letter-spacing:0">${list.length}件${conflicts?`・競合 ${conflicts}件`:""}</span></h2>
    <div class="hint">この端末で記録した、編集前・同期・競合・破棄の前の状態です。項目ごとに最新${HIST_MAX}件を残します。押すと今の内容と見比べられ、「この版に戻す」で戻せます。</div>
    <div class="ofil">
      <div class="seg" role="group" aria-label="種類で絞り込む">${HIST_GROUPS.map(([k,l])=>`<button data-hf="${k}" aria-pressed="${histFilter===k}">${l}</button>`).join("")}</div>
      <select id="hk" aria-label="項目で絞り込む"><option value="">すべての項目</option>${keysWith.map(k=>`<option value="${esc(k)}" ${k===histKey?"selected":""}>${esc(labelKey(k,(recs.get(k)||list.find(h=>h.key===k)||{}).data))}</option>`).join("")}</select>
    </div>
    <div class="hlist">${shown.slice(0,200).map(h=>{const cur=recs.get(h.key); const open=histOpen===h.id;
      return `<div class="hi ${open?"open":""}">
        <button class="hrow" data-ho="${esc(h.id)}" aria-expanded="${open}"><span class="mono dd">${fmtT(h.ts)}</span><span class="chip ${histGroup(h.kind)==="conflict"?"s-未着手":""}">${esc(h.kind)}</span><b>${esc(labelKey(h.key,(recs.get(h.key)&&recs.get(h.key).data)||h.data))}</b></button>
        ${open?`<div class="hbody">${histDiff(h.data,cur&&!cur.deleted?cur.data:null,h.deleted,cur&&!cur.deleted?false:undefined)}
          <div class="btnrow"><button class="btn sm primary" data-hr="${esc(h.id)}">この版に戻す</button><button class="btn sm" data-hk="${esc(h.key)}">この項目の履歴だけ見る</button></div></div>`:""}
      </div>`;}).join("")||`<div class="empty">${list.length?"該当する履歴はありません。":"まだ履歴はありません。編集や同期をすると、ここに記録されます。"}</div>`}</div>
  </div>`;
  host.querySelectorAll("[data-hf]").forEach(b=>b.onclick=()=>{histFilter=b.dataset.hf; render();});
  $("#hk").onchange=ev=>{histKey=ev.target.value; render();};
  host.querySelectorAll("[data-ho]").forEach(b=>b.onclick=()=>{histOpen=histOpen===b.dataset.ho?null:b.dataset.ho; render();});
  host.querySelectorAll("[data-hk]").forEach(b=>b.onclick=()=>{histKey=b.dataset.hk; histFilter="all"; render();});
  host.querySelectorAll("[data-hr]").forEach(b=>b.onclick=async()=>{
    const h=list.find(x=>x.id===b.dataset.hr); if(!h) return;
    if(pendingDelete!=="hr"+h.id){ pendingDelete="hr"+h.id; b.textContent="もう一度押すと戻す"; return; } pendingDelete=null;
    const cur=recs.get(h.key);
    if(cur&&cur.data) await histAdd(h.key,"戻す前",cur);
    touch(h.key,structuredClone(h.data),!!h.deleted); await persist(h.key); rebuild();
    setSave(`${labelKey(h.key,h.data)}を ${fmtT(h.ts)} の版に戻しました（同期でほかの端末にも反映されます）`); histOpen=null; render();
  });
}

/* 6. 登場表：キャラ×エピソード */
function mgCast(host){
  const N=eps.length; const rows=chars.map(c=>{const s=new Set(appearances(c).map(a=>epPos(a.e.id))); return {c,s};});
  const gapCells=row=>{const ps=[...row.s].sort((a,b)=>a-b); const g=new Set(); for(let k=1;k<ps.length;k++) if(ps[k]-ps[k-1]-1>=castGap) for(let i=ps[k-1]+1;i<ps[k];i++) g.add(i); return g;};
  let last=null;
  host.innerHTML=`<div class="card">
    <h2 class="sec">登場表 <label class="f" style="margin:0;flex-direction:row;align-items:center;gap:6px">空白の強調<select id="cg">${[3,5,8,12].map(n=>`<option value="${n}" ${n===castGap?"selected":""}>${n}話以上</option>`).join("")}</select></label></h2>
    <div class="hint">エピソードの題・内容・提示するもの・各話の流れに、名前か呼び名（キャラクタータブで設定）が出る話を●で示します。登場の間が空いているところに色を付けています。</div>
    <div class="tl-wrap"><div class="cast" style="grid-template-columns:minmax(110px,160px) repeat(${N},22px)">
      <div class="tl-h tl-name">人物</div>${eps.map((e,i)=>`<button class="tl-h" data-tlep="${esc(e.id)}" title="EP${i+1} ${esc(e.title)}">${i+1}</button>`).join("")}
      ${rows.map(row=>{const g=gapCells(row); let h="";
        if(row.c.group!==last){ last=row.c.group; h+=`<div class="cg-h" style="grid-column:1/-1">${esc(last||"（区分なし）")}</div>`; }
        return h+`<button class="tl-name tl-row" data-gc="${esc(row.c.id)}">${esc(row.c.name)}<span>${row.s.size}</span></button>`+
          eps.map((e,i)=>`<button class="tl-c cc ${g.has(i)?"gap":""}" data-tlep="${esc(e.id)}" title="EP${i+1} ${esc(e.title)}${row.s.has(i)?"：登場":""}">${row.s.has(i)?`<i class="mk done"></i>`:""}</button>`).join("");}).join("")}
    </div></div>
  </div>`;
  $("#cg").onchange=ev=>{castGap=+ev.target.value; render();};
  host.querySelectorAll("[data-tlep]").forEach(b=>b.onclick=()=>gotoEp(b.dataset.tlep));
  host.querySelectorAll("[data-gc]").forEach(b=>b.onclick=()=>gotoChar(b.dataset.gc));
}

/* ---------- 名前の自動リンク：文中の人物・用語を見つけて、押すと概要を出す ---------- */
function loreTerms(s){return [...new Set([s.title,...keywordsOf(s)].map(x=>String(x||"").trim()).filter(x=>x.length>=2))]}
function mentionsIn(text,exclude){
  const t=String(text||""); if(!t) return [];
  const out=[];
  chars.forEach(c=>{ const k="c:"+c.id; if(k!==exclude&&aliasesOf(c).some(a=>t.includes(a))) out.push(k); });
  setts.forEach(s=>{ const k="s:"+s.id; if(k!==exclude&&loreTerms(s).some(a=>t.includes(a))) out.push(k); });
  return out;
}
function mentionChipsHTML(keys,title){
  if(!keys.length) return "";
  const cs=keys.filter(k=>k.startsWith("c:")), ss=keys.filter(k=>k.startsWith("s:"));
  const chip=k=>{ if(k.startsWith("c:")){ const c=chars.find(x=>x.id===k.slice(2)); if(!c) return ""; const img=c.images&&c.images[0];
      return `<button class="mchip" data-peek="${esc(k)}">${img?`<img src="${blob(img.id)}" alt="">`:`<span class="mi">${esc((c.name||"？").slice(0,1))}</span>`}${esc(c.name)}</button>`; }
    const s=setts.find(x=>x.id===k.slice(2)); return s?`<button class="mchip lore" data-peek="${esc(k)}"><span class="mi">設</span>${esc(s.title)}</button>`:""; };
  return `<div class="mentions"><span class="hint">${esc(title||"出てくる人物・用語")}</span><div class="mrow">${cs.map(chip).join("")}${ss.map(chip).join("")}</div></div>`;
}
function closePeek(){ document.querySelectorAll(".peek").forEach(p=>p.remove()); }
function openPeek(btn){
  closePeek();
  const k=btn.dataset.peek; let html="";
  if(k.startsWith("c:")){ const c=chars.find(x=>x.id===k.slice(2)); if(!c) return; const img=c.images&&c.images[0];
    html=`<div class="pk-h">${img?`<img src="${blob(img.id)}" alt="">`:""}<div><b>${esc(c.name)}</b><span>${esc(c.role||"")}</span></div></div>
      ${c.orb?`<div class="pk-m">宿命刻：${esc(c.orb)}</div>`:""}<p>${esc(String(c.profile||c.personality||"").slice(0,180))}${String(c.profile||"").length>180?"…":""}</p>`;
  } else { const s=setts.find(x=>x.id===k.slice(2)); if(!s) return;
    html=`<div class="pk-h"><div><b>${esc(s.title)}</b><span>${esc(s.category||"")}${s.status&&s.status!=="決定"?"・"+esc(s.status):""}</span></div></div>
      ${s.summary?`<div class="pk-m">${esc(s.summary)}</div>`:""}<p>${esc(String(s.body||"").slice(0,180))}${String(s.body||"").length>180?"…":""}</p>`; }
  const pk=document.createElement("div"); pk.className="peek"; pk.setAttribute("role","dialog");
  pk.innerHTML=html+`<div class="btnrow" style="margin:6px 0 0"><button class="btn sm primary" data-pkgo>開く</button><button class="btn sm" data-pkclose>閉じる</button></div>`;
  document.body.appendChild(pk);
  const r=btn.getBoundingClientRect(), w=Math.min(320,innerWidth-24);
  pk.style.width=w+"px"; pk.style.left=Math.max(12,Math.min(r.left,innerWidth-w-12))+"px";
  const below=r.bottom+8+pk.offsetHeight<innerHeight; pk.style.top=(below?r.bottom+8:Math.max(12,r.top-8-pk.offsetHeight))+"px";
  pk.querySelector("[data-pkgo]").onclick=()=>{closePeek(); gotoDoc(k);};
  pk.querySelector("[data-pkclose]").onclick=closePeek;
}
document.addEventListener("click",ev=>{
  const b=ev.target.closest&&ev.target.closest("[data-peek]"); if(b){ ev.preventDefault(); openPeek(b); return; }
  if(!(ev.target.closest&&ev.target.closest(".peek"))) closePeek();
});
document.addEventListener("keydown",ev=>{ if(ev.key==="Escape") closePeek(); });
window.addEventListener("scroll",closePeek,{passive:true});
function epText(e){return [e.title,e.summary,e.presents,e.memo,e.open,(e.parts||[]).map(p=>[p.title,p.beats,p.note].join(" ")).join(" "),drafts.filter(d=>d.ep===e.id).map(d=>d.body).join(" ")].join(" ")}

/* ---------- 本文の下書き（カクヨム風） ---------- */
let draftRef=null, draftMode="edit", draftVertical=false, draftSide=true;
try{ draftVertical=localStorage.getItem("kozo.dv")==="1"; draftSide=localStorage.getItem("kozo.ds")!=="0"; }catch(e){}
// Web話の「場所」：各話のプロットがあるときは話ごとの印（pid）、ないときは番号
function slotOf(e,i){ const p=(e.parts||[])[i]; return p?(p.pid||null):"n"+i; }
function ensureSlot(e,i){ let s=slotOf(e,i); if(s) return s; s=newId("p"); edit(e.id,o=>{o.parts[i].pid=s;}); return s; }
function draftKey(epId,slot){return "w:"+epId+"~"+slot}
function draftOf(e,i){ const s=slotOf(e,i); if(!s) return null; return drafts.find(d=>d.id===e.id+"~"+s)||null; }
function draftWhere(id){ // "w:<ep>~<slot>" → {e,i}
  const d=drafts.find(x=>"w:"+x.id===id); const e=d&&eps.find(z=>z.id===d.ep); if(!e) return null;
  const pi=(e.parts||[]).findIndex(p=>p.pid===d.slot); const i=pi>=0?pi:/^n\d+$/.test(d.slot)?Number(d.slot.slice(1)):-1;
  return i>=0&&i<count(e)?{e,i,d}:null;
}
function draftLabel(id){ const w=draftWhere(id); if(!w) return "本文（行き先のない下書き）"; const x=ranges()[w.e.id]; return `本文 ${x.from!=null?`第${x.from+w.i}話`:`${w.i+1}話目`}（EP${x.ep}「${w.e.title}」）`; }
function plainOf(src){ return String(src||"").replace(/《《([^《》\n]*?)》》/g,"$1").replace(/[|｜]([^|｜《》\n]{1,50}?)《[^《》\n]{0,50}?》/g,"$1").replace(/([一-鿿々〆ヵヶ]+)《[^《》\n]{1,50}?》/g,"$1").replace(/[|｜]《/g,"《"); }
function countChars(src){ return [...plainOf(src).replace(/\s/g,"")].length; }
function kakuyomuHTML(src){
  let t=esc(src);
  t=t.replace(/《《([^《》\n]+?)》》/g,'<em class="bouten">$1</em>');
  t=t.replace(/[|｜]([^|｜《》\n]{1,50}?)《([^《》\n]{1,50}?)》/g,'<ruby>$1<rt>$2</rt></ruby>');
  t=t.replace(/([一-鿿々〆ヵヶ]+)《([^《》\n]{1,50}?)》/g,'<ruby>$1<rt>$2</rt></ruby>');
  t=t.replace(/[|｜]《/g,"《");
  return t.split("\n").map(l=>`<p>${l||"<br>"}</p>`).join("");
}
function webList(){ // すべてのWeb話を順に並べる
  const r=ranges(), out=[];
  eps.forEach(e=>{ const n=count(e); for(let i=0;i<n;i++) out.push({e,i,no:r[e.id].from!=null?r[e.id].from+i:null,title:(e.parts&&e.parts[i]&&e.parts[i].title)||""}); });
  return out;
}
function draftCount(e,i){const d=draftOf(e,i); return d?countChars(d.body):null;}
function openDraft(epid,i){ draftRef={ep:epid,i}; try{localStorage.setItem("kozo.dr",JSON.stringify(draftRef))}catch(e){} view="draft"; draftMode="edit"; saveView(); render(); window.scrollTo({top:0}); }
function renderDraft(){
  const m=$("#main");
  const e=draftRef&&eps.find(x=>x.id===draftRef.ep);
  if(!e||draftRef.i>=count(e)){ m.innerHTML=`<div class="notice">この話は見つかりませんでした。<button class="btn" id="dr-out">エピソードへ戻る</button></div>`; $("#dr-out").onclick=()=>{view="edit"; render();}; return; }
  const i=draftRef.i, r=ranges(), x=r[e.id], no=x.from!=null?x.from+i:null, part=(e.parts||[])[i]||null;
  const d=draftOf(e,i); const body=d?d.body:"", title=d?d.title:(part?part.title:"");
  const list=webList(); const pos=list.findIndex(w=>w.e.id===e.id&&w.i===i); const prev=list[pos-1], next=list[pos+1];
  const ment=mentionsIn([body,part?part.beats:"",part?part.note:""].join(" "));
  m.innerHTML=`<div class="draft ${draftSide?"":"noside"}">
    <div class="dr-bar">
      <button class="btn sm" id="dr-back">← ${draftFrom==="list"?"下書き一覧":`EP${x.ep}`}</button>
      <span class="dr-where"><b>${no!=null?`第${no}話`:`EP${x.ep}の${i+1}話目`}</b><span>EP${x.ep}「${esc(e.title)}」</span></span>
      <span class="dr-tools">
        <span class="seg" role="group" aria-label="表示"><button id="dr-edit" aria-pressed="${draftMode==="edit"}">執筆</button><button id="dr-prev" aria-pressed="${draftMode==="preview"}">プレビュー</button></span>
        ${draftMode==="preview"?`<span class="seg" role="group" aria-label="向き"><button id="dr-h" aria-pressed="${!draftVertical}">横書き</button><button id="dr-v" aria-pressed="${draftVertical}">縦書き</button></span>`:`<button class="btn sm" id="dr-ruby" title="選んだ文字にルビを振る">ルビ</button><button class="btn sm" id="dr-dot" title="選んだ文字に傍点を付ける">傍点</button>`}
        <button class="btn sm" id="dr-copy">本文をコピー</button>
        <button class="btn sm" id="dr-side" aria-pressed="${draftSide}">${draftSide?"資料を隠す":"資料を見る"}</button>
      </span>
    </div>
    <div class="dr-main">
      <section class="dr-paper">
        ${draftMode==="edit"?`<input class="dr-title" id="dr-title" value="${esc(title)}" placeholder="エピソードタイトル" aria-label="エピソードタイトル">
        <textarea class="dr-text" id="dr-text" placeholder="本文を入力してください" aria-label="本文">${esc(body)}</textarea>`
        :`<div class="dr-view ${draftVertical?"vert":""}"><h2>${esc(title||"（無題）")}</h2>${body?kakuyomuHTML(body):`<p class="hint">本文はまだありません。</p>`}</div>`}
        <div class="dr-foot"><span><b class="mono" id="dr-count">${countChars(body).toLocaleString()}</b>文字<span class="hint">（空白・改行・ルビを除く）</span></span>
          <span class="dr-nav">${prev?`<button class="btn sm" data-dnav="${esc(prev.e.id)}:${prev.i}">← ${prev.no!=null?`第${prev.no}話`:"前の話"}</button>`:""}${next?`<button class="btn sm" data-dnav="${esc(next.e.id)}:${next.i}">${next.no!=null?`第${next.no}話`:"次の話"} →</button>`:""}</span></div>
        <div class="hint dr-help">ルビ：<code>|漢字《かんじ》</code>（漢字だけなら <code>漢字《かんじ》</code>）　傍点：<code>《《言葉》》</code>　カクヨムと同じ書き方なので、そのまま貼り付けられます。</div>
      </section>
      ${draftSide?`<aside class="dr-side">
        <div class="card"><h2 class="sec">この話のプロット</h2>
          ${part?`<div class="dr-pt">${esc(part.title||"")}</div><ol class="dr-beats">${String(part.beats||"").split("\n").filter(Boolean).map(b=>`<li>${esc(b)}</li>`).join("")||`<li class="hint">流れはまだありません</li>`}</ol>${part.note?`<div class="hint">補足：${esc(part.note)}</div>`:""}`
            :`<div class="hint">この話の流れは未記入です。エピソードの内容：</div><p class="dr-sum">${esc(e.summary||"")}</p>`}
        </div>
        <div class="card">${mentionChipsHTML(ment,"出てくる人物・用語")||`<div class="hint">本文やプロットに人物・用語が出てくると、ここに並びます。</div>`}</div>
      </aside>`:""}
    </div></div>`;
  $("#dr-back").onclick=()=>{ if(draftFrom==="list"){ view="drafts"; saveView(); render(); return; } selId=e.id; view="edit"; window._mobileEditing=true; saveView(); render();};
  $("#dr-edit").onclick=()=>{draftMode="edit"; render();};
  $("#dr-prev").onclick=()=>{draftMode="preview"; render();};
  if($("#dr-h")){ $("#dr-h").onclick=()=>{draftVertical=false; try{localStorage.setItem("kozo.dv","0")}catch(err){} render();}; $("#dr-v").onclick=()=>{draftVertical=true; try{localStorage.setItem("kozo.dv","1")}catch(err){} render();}; }
  $("#dr-side").onclick=()=>{draftSide=!draftSide; try{localStorage.setItem("kozo.ds",draftSide?"1":"0")}catch(err){} render();};
  document.querySelectorAll("[data-dnav]").forEach(b=>b.onclick=()=>{const [id,j]=b.dataset.dnav.split(":"); openDraft(id,+j);});
  $("#dr-copy").onclick=async()=>{ const cur=draftOf(e,i); const t=cur?cur.body:""; try{ await navigator.clipboard.writeText(t); setSave("本文をコピーしました。カクヨムの本文欄に貼り付けられます"); }catch(err){ setSave("コピーできませんでした",true); } };
  if(draftMode!=="edit") return;
  const save=(patch)=>{
    const slot=ensureSlot(e,i); const key=draftKey(e.id,slot);
    const cur=recs.get(key); const base=cur&&!cur.deleted&&cur.data?cur.data:{ep:e.id,slot,title:title,body:""};
    const data={...structuredClone(base),...patch};
    touch(key,data,false);
    const k2=key.slice(2), dd=drafts.find(z=>z.id===k2); if(dd) Object.assign(dd,data); else drafts.push({id:k2,...data});
    // 連載の状態：書き始めたら「執筆中」に
    if(data.body&&String(data.body).trim()){ const w=webOf(e)[i]; if(w&&w.st==="未着手") edit(e.id,o=>{o.web=webOf(o); o.web[i].st="執筆中";}); }
  };
  const ta=$("#dr-text");
  $("#dr-title").oninput=ev=>save({title:ev.target.value});
  const grow=()=>{ const y=window.scrollY; ta.style.height="auto"; ta.style.height=Math.max(ta.scrollHeight+4,window.innerHeight*0.5)+"px"; window.scrollTo(0,y); };
  ta.oninput=ev=>{ save({body:ev.target.value}); $("#dr-count").textContent=countChars(ev.target.value).toLocaleString(); grow(); };
  requestAnimationFrame(grow);
  // 選んだ文字を記法で囲む（ルビは《》の中にカーソルを置く）
  const wrap=(pre,post,ph,inside)=>{ const s=ta.selectionStart, en=ta.selectionEnd, sel=ta.value.slice(s,en)||ph;
    ta.setRangeText(pre+sel+post,s,en,"end"); if(inside){ const c=s+pre.length+sel.length+1; ta.setSelectionRange(c,c); }
    ta.focus(); ta.dispatchEvent(new Event("input")); };
  $("#dr-ruby").onclick=()=>wrap("|","《》","親文字",true);
  $("#dr-dot").onclick=()=>wrap("《《","》》","言葉",false);
}

/* ---------- 下書き一覧 ---------- */
let dlSort="updated"; try{dlSort=localStorage.getItem("kozo.dls")||"updated";}catch(e){}
let draftFrom="ep";
const DL_SORTS=[["updated","更新日時（新しい順）"],["updated_asc","更新日時（古い順）"],["order","話の順"],["chars","文字数（多い順）"],["chars_asc","文字数（少ない順）"]];
function draftRows(){
  const r=ranges();
  return drafts.filter(d=>String(d.body||"").trim()||String(d.title||"").trim()).map(d=>{
    const id="w:"+d.id, rec=recs.get(id), w=draftWhere(id);
    const x=w&&r[w.e.id]; const no=w&&x.from!=null?x.from+w.i:null;
    const st=w?(webOf(w.e)[w.i]||{}).st:"";
    return {d,id,w,no,ep:w?x.ep:null,epTitle:w?w.e.title:"",pos:w?epPos(w.e.id)*1000+w.i:1e9,updated:(rec&&rec.updatedAt)||0,chars:countChars(d.body),st,dirty:!!(rec&&rec.dirty)};
  });
}
function renderDraftList(){
  const m=$("#main"); const rows=draftRows();
  const cmp={updated:(a,b)=>b.updated-a.updated,updated_asc:(a,b)=>a.updated-b.updated,order:(a,b)=>a.pos-b.pos,chars:(a,b)=>b.chars-a.chars,chars_asc:(a,b)=>a.chars-b.chars}[dlSort]||((a,b)=>b.updated-a.updated);
  rows.sort(cmp);
  const total=rows.reduce((s,x)=>s+x.chars,0);
  const fmt=ts=>{ if(!ts) return "—"; const d=new Date(ts); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
  m.innerHTML=`<div class="card dlist">
    <h2 class="sec">下書き一覧 <label class="f" style="margin:0;flex-direction:row;align-items:center;gap:6px">並び替え<select id="dl-sort">${DL_SORTS.map(([k,l])=>`<option value="${k}" ${k===dlSort?"selected":""}>${l}</option>`).join("")}</select></label></h2>
    <div class="hint">${rows.length}話・合計 ${total.toLocaleString()}文字。押すとその話の執筆画面を開きます。新しく書くときは、エピソードの「本文の下書き」から始めます。</div>
    ${rows.length?`<div class="dl-rows">${rows.map(x=>`<button class="dl-row" data-dl="${esc(x.id)}">
        <span class="dl-no">${x.no!=null?`第${x.no}話`:x.w?`EP${x.ep}`:"行き先なし"}</span>
        <span class="dl-main"><b>${esc(x.d.title||"（無題）")}</b><span class="hint">${x.w?`EP${x.ep}「${esc(x.epTitle)}」`:"元の話が削除されています"}</span>
          <span class="dl-pre">${esc(plainOf(x.d.body).replace(/\s+/g," ").slice(0,90))}${plainOf(x.d.body).length>90?"…":""}</span></span>
        <span class="dl-meta"><span class="mono"><b>${x.chars.toLocaleString()}</b>字</span>${x.st?`<span class="chip wst st${WSTAT.indexOf(x.st)}">${esc(x.st)}</span>`:""}<span class="mono hint">${fmt(x.updated)}${x.dirty?"・未同期":""}</span></span>
      </button>`).join("")}</div>`:`<div class="empty">まだ下書きはありません。エピソードの「各話のプロット」にある「本文の下書き」から書き始められます。</div>`}
  </div>`;
  $("#dl-sort").onchange=ev=>{dlSort=ev.target.value; try{localStorage.setItem("kozo.dls",dlSort)}catch(e){} render();};
  m.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>{ const w=draftWhere(b.dataset.dl); if(w){ draftFrom="list"; openDraft(w.e.id,w.i); } });
}

/* ---------- 全体検索 ---------- */
function openSearch(){
  closePeek();
  const ov=$("#overlay"); ov.hidden=false;
  ov.innerHTML=`<div class="dialog search-d" role="dialog" aria-label="全体検索">
    <div class="sd-h"><input type="search" id="gs" placeholder="エピソード・キャラ・設定・本文などをまとめて検索" aria-label="検索する言葉"><button class="btn sm" id="gs-close">閉じる</button></div>
    <div id="gs-res" class="gs-res"><div class="hint">2文字以上で探します。</div></div></div>`;
  const inp=$("#gs"); inp.focus();
  let tm=null; inp.oninput=()=>{clearTimeout(tm); tm=setTimeout(()=>runSearch(inp.value),150);};
  $("#gs-close").onclick=()=>busy(null);
  ov.onclick=ev=>{ if(ev.target===ov) busy(null); };
}
function runSearch(q){
  q=q.trim(); const box=$("#gs-res"); if(!box) return;
  if(q.length<2){ box.innerHTML=`<div class="hint">2文字以上で探します。</div>`; return; }
  const docs=[...allDocs(),...decisions.map(d=>["d:"+d.id,d])];
  const res=[];
  for(const [docId,doc] of docs){
    const hits=[];
    walkStrings(doc,[],(path,s)=>{ let i=s.indexOf(q); let n=0; while(i>=0&&n<2){ hits.push({path,pre:s.slice(Math.max(0,i-20),i),post:s.slice(i+q.length,i+q.length+30)}); i=s.indexOf(q,i+q.length); n++; } });
    if(hits.length) res.push({docId,hits});
  }
  const kindOf=id=>id==="__meta"?"作品":({c:"キャラ",s:"設定",o:"宿命刻",f:"伏線",d:"決定ログ",w:"本文"}[id[1]===":"?id[0]:""]||"エピソード");
  const lab=id=>{ if(id.startsWith("d:")){const d=decisions.find(x=>"d:"+x.id===id); return `決定ログ「${d?d.item:""}」`;}
    return docLabel(id); };
  box.innerHTML=res.length?`<div class="hint">${res.length}件の項目で見つかりました</div>`+res.slice(0,150).map(r=>`<button class="gs-item" data-gsgo="${esc(r.docId)}"><span class="chip">${kindOf(r.docId)}</span><b>${esc(lab(r.docId))}</b>
      ${r.hits.slice(0,3).map(h=>`<span class="gs-snip"><span class="hint">${esc(pathLabel(h.path))}</span> …${esc(h.pre)}<mark>${esc(q)}</mark>${esc(h.post)}…</span>`).join("")}</button>`).join("")
    :`<div class="empty">「${esc(q)}」は見つかりませんでした。</div>`;
  box.querySelectorAll("[data-gsgo]").forEach(b=>b.onclick=()=>{ const id=b.dataset.gsgo; busy(null);
    if(id.startsWith("d:")){ mgMode="open"; view="manage"; saveView(); render(); return; }
    gotoDoc(id); });
}
document.addEventListener("keydown",ev=>{
  const tag=(ev.target.tagName||"").toLowerCase(), typing=tag==="input"||tag==="textarea"||tag==="select";
  if(((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==="k")||(!typing&&ev.key==="/")){ ev.preventDefault(); openSearch(); }
  if(ev.key==="Escape"&&$("#gs")) busy(null);
});

/* ---------- 自動バックアップ（ドライブに日付つきの控え。30日分） ---------- */
const BACKUP_KEEP=30;
let forceBackup=false;
async function maybeBackup(folder,out){
  const day=today();
  if(!forceBackup&&(await kvGet("lastBackup"))===day) return null;
  forceBackup=false;
  try{
    busy("バックアップを作っています…");
    const name=`backup_${day}.json`;
    const list=await Drive.listByPrefix(folder,"backup_");
    const same=list.find(f=>f.name===name);
    if(same) await Drive.updateJson(same.id,out); else await Drive.createNamedJson(folder,name,out);
    const all=(await Drive.listByPrefix(folder,"backup_")).sort((a,b)=>b.name.localeCompare(a.name));
    for(const f of all.slice(BACKUP_KEEP)) await Drive.trash(f.id);
    await kvSet("lastBackup",day);
    return name;
  }catch(e){ return null; }
}
async function listBackups(host){
  host.innerHTML=`<div class="hint">一覧を読み込んでいます…</div>`;
  try{
    await Drive.signIn();
    const folder=await Drive.ensureFolder(await kvGet("folderId"));
    const list=(await Drive.listByPrefix(folder,"backup_")).sort((a,b)=>b.name.localeCompare(a.name));
    host.innerHTML=list.length?`<div class="bklist">${list.map(f=>`<div class="bk"><span class="mono">${esc(f.name.replace(/^backup_|\.json$/g,""))}</span><span class="hint">${f.size?Math.round(f.size/1024).toLocaleString()+"KB":""}</span><button class="btn sm" data-bk="${esc(f.id)}" data-bkn="${esc(f.name)}">この日の状態に戻す</button></div>`).join("")}</div>`:`<div class="empty">まだバックアップはありません。次の同期で作られます。</div>`;
    host.querySelectorAll("[data-bk]").forEach(b=>b.onclick=async()=>{
      if(pendingDelete!=="bk"+b.dataset.bk){ pendingDelete="bk"+b.dataset.bk; b.textContent="もう一度押すと戻す"; return; } pendingDelete=null;
      b.disabled=true; b.textContent="戻しています…";
      try{
        const bk=await Drive.readJson(b.dataset.bk); const docs=bk.docs||{}; let n=0;
        for(const [k,R] of Object.entries(docs)){
          const L=recs.get(k);
          if(L&&stable(L.data)===stable(R.data)&&!!L.deleted===!!R.deleted) continue;
          if(L&&L.data) histAdd(k,"バックアップから戻す前",L);
          touch(k,structuredClone(R.data),!!R.deleted); n++;
        }
        flushAll(); await histChain; rebuild(); render();
        setSave(`${b.dataset.bkn.replace(/^backup_|\.json$/g,"")} の状態に${n}件を戻しました。「同期」でドライブとほかの端末にも反映されます`);
      }catch(e){ setSave("バックアップを読み込めませんでした",true); b.disabled=false; b.textContent="この日の状態に戻す"; }
    });
  }catch(e){ host.innerHTML=`<div class="err-t">${esc(e&&e.message?e.message:"一覧を読み込めませんでした")}</div>`; }
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
  if(setts.length){
    L.push("---","","## 設定","");
    let g=null;
    setts.forEach(st=>{
      if(st.category!==g){g=st.category; L.push(`### ${g||"（区分なし）"}`,"");}
      L.push(`#### ${st.title}${st.status&&st.status!=="決定"?`（${st.status}）`:""}`,"");
      if(st.summary) L.push(st.summary,"");
      if(st.body){ st.body.split("\n").filter(Boolean).forEach(l=>L.push("- "+l)); L.push(""); }
      if(st.memo) L.push("**未決・★案**："+st.memo.replace(/\n/g,"／"),"");
    });
  }
  if(threads.length){
    L.push("---","","## 伏線と段階","");
    sortedThreads().forEach(t=>{ const iss=checkThread(t);
      L.push(`### ${t.title}（${t.kind||"伏線"}）`,"");
      (t.steps||[]).forEach(s=>{const p=epPos(s.ep); L.push(`- ${p>=0?"EP"+(p+1):"（EP未設定）"}【${s.role}】${s.note||""}`);});
      if(t.memo) L.push("",t.memo);
      if(iss.length) L.push("",`**要確認**：${iss.join("／")}`);
      L.push("");});
  }
  if(decisions.length){
    L.push("---","","## 決定ログ","","| 日付 | 項目 | 決定 | 元の場所 |","|---|---|---|---|");
    const c2=v=>String(v||"").replace(/\|/g,"／").replace(/\n/g," ");
    decisions.forEach(d=>L.push(`| ${d.date} | ${c2(d.item)} | ${c2(d.decision)} | ${c2(d.srcLabel)} |`)); L.push("");
  }
  if(orbs.length){
    const cell=v=>String(v||"").replace(/\|/g,"／").replace(/\n/g," ");
    L.push("---","","## 宿命刻（A〜Z）","","| 刻 | 名称 | 保持者・登場 | 状態 | 備考 |","|---|---|---|---|---|");
    orbs.forEach(o=>L.push(`| ${o.letter} | ${cell(o.name)} | ${cell(o.holder)} | ${cell(o.status)} | ${cell(o.note)} |`));
    L.push("");
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
["edit","table","chars","lore","policy","drafts","manage"].forEach(v=>$("#v-"+v).onclick=()=>{view=v; saveView(); if(v!=="table"&&v!=="policy") window._mobileEditing=false; render();});


/* ---------- 同期とデータ（管理タブ） ---------- */
async function renderSyncCard(host){
  if(!host) return;
  const last=await kvGet("lastSync"); const n=await unsyncedCount();
  let quota=""; try{ const e=await navigator.storage.estimate(); quota=`端末の使用量 ${(e.usage/1048576).toFixed(1)}MB`; }catch(e){}
  let persisted=false; try{ persisted=await navigator.storage.persisted(); }catch(e){}
  if(!host.isConnected) return;
  host.insertAdjacentHTML("beforeend",`<div class="card">
    <h2 class="sec">同期とデータ</h2>
    <div class="syncgrid">
      <div><b>Googleドライブ</b>
        <p class="hint">${Drive.configured()?`保存先：マイドライブ「${esc(Drive.FOLDER)}」フォルダ`:"まだ設定されていません（config.js にクライアントIDを入れてください）"}</p>
        <p class="hint">前回の同期：${last?new Date(last).toLocaleString("ja-JP"):"まだありません"}／未同期 ${n}件</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" id="s-sync">今すぐ同期</button><button class="btn sm danger" id="s-discard">変更を破棄</button></div></div>
      <div><b>取り込む</b><p class="hint">claude.ai の台帳や、控えのファイル（JSON）から読み込みます。新しい方が残ります。</p>
        <label class="btn sm">ファイルを選ぶ<input type="file" id="s-file" accept=".json,application/json" hidden></label>
        <div id="s-plan"></div></div>
      <div><b>自動バックアップ</b><p class="hint">1日1回、同期のときにドライブへ日付つきの控えを作ります（${BACKUP_KEEP}日分）。前回：${esc((await kvGet("lastBackup"))||"まだありません")}</p>
        <div class="btnrow" style="margin:0"><button class="btn sm" id="s-bknow">今すぐバックアップ</button><button class="btn sm" id="s-bklist">一覧と復元</button></div>
        <div id="s-bk"></div></div>
      <div><b>控えを書き出す</b><p class="hint">この端末の内容をファイル（JSON）に保存します。画像は含まれません。</p>
        <button class="btn sm" id="s-dl">ファイルに保存</button></div>
      <div><b>この端末</b><p class="hint">アプリの版：${APP_VERSION}<br>${quota}${quota?"／":""}${persisted?"データは自動では消されない設定です":"空き容量が少ないと、ブラウザがデータを消すことがあります。こまめに同期してください"}</p></div>
    </div></div>`);
  $("#s-sync").onclick=()=>sync();
  $("#s-discard").onclick=()=>openDiscard();
  $("#s-bknow").onclick=()=>{forceBackup=true; sync();};
  $("#s-bklist").onclick=()=>listBackups($("#s-bk"));
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

/* 画像を押すと全体を大きく表示する */
document.addEventListener("click",ev=>{
  const img=ev.target.closest&&ev.target.closest(".portrait img, .gimg img"); if(!img) return;
  const lb=document.createElement("div"); lb.className="lightbox"; lb.setAttribute("role","dialog"); lb.setAttribute("aria-label","画像の拡大表示");
  lb.innerHTML=`<img src="${esc(img.src)}" alt="${esc(img.alt)}">`;
  const close=()=>{lb.remove(); document.removeEventListener("keydown",onKey);}; const onKey=e=>{if(e.key==="Escape") close();};
  lb.onclick=close; document.addEventListener("keydown",onKey); document.body.appendChild(lb);
});
/* ---------- 起動 ---------- */
$("#b-sync").onclick=()=>sync();
$("#b-discard").onclick=()=>openDiscard();
$("#b-search").onclick=()=>openSearch();
(async()=>{
  try{ if(navigator.storage&&navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  try{
    for(const [k,v] of await Store.entries("docs")) recs.set(k,v);
    for(const [k,v] of await Store.entries("images")) if(v&&v.blob) urlCache.set(k,URL.createObjectURL(v.blob));
    for(const [,h] of await Store.entries("history")) if(h&&h.key) histLast.set(h.key,Math.max(histLast.get(h.key)||0,h.ts));
  }catch(e){ setSave("端末の保存領域を開けませんでした",true); }
  rebuild(); loaded=true; if(view==="draft") draftRef=draftRefSaved; render(); updateSyncBadge();
  if(navigator.onLine&&Drive.configured()) Drive.preload().catch(()=>{});
})();
/* 新しい版が届いたら、保存を済ませてから自動で切り替える */
const APP_VERSION="kozo-v19";
if("serviceWorker" in navigator){
  const hadController=!!navigator.serviceWorker.controller; let reloading=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(!hadController||reloading) return; reloading=true;
    flushAll(); setSave("新しい版に切り替えています…");
    setTimeout(()=>location.reload(),600);
  });
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").then(r=>{
    // 開いているあいだも、ときどき新しい版を確かめる
    setInterval(()=>r.update().catch(()=>{}),30*60*1000);
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") r.update().catch(()=>{}); });
  }).catch(()=>{}));
}

})();
