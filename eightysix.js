// 86 Board: mark menu items out. They disappear (show "Sold out") on the kiosk,
// online ordering and catering right away, at the chosen location or everywhere.
import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,setDoc,deleteDoc,onSnapshot} from './core.js';

const FN='https://us-central1-bbl-app-d58e6.cloudfunctions.net';
const STYLE=`<style>
.e6-locs{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px}
.e6-locs button{flex:none;background:var(--card);color:var(--ink);border:0;border-radius:999px;padding:9px 14px;font-weight:600;box-shadow:var(--shadow)}
.e6-locs button.on{background:var(--acc);color:#1a1208}
.e6-row{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:14px;padding:11px 14px;margin-bottom:7px;box-shadow:var(--shadow)}
.e6-row .t{flex:1}
.e6-row.out{box-shadow:inset 4px 0 0 #ef8a6f,var(--shadow)}
.e6-b{border:0;border-radius:999px;padding:9px 14px;font-weight:800;font-size:13px}
.e6-86{background:#ef8a6f;color:#1a1208}.e6-on{background:var(--ok);color:#0d1a12}
.e6-sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:20}
.e6-sheet>div{background:var(--bg);width:min(520px,100vw);border-radius:22px 22px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom))}
</style>`;
const endOfDay=()=>{const d=new Date();d.setHours(23,59,59,999);return d.getTime();};
const keyOf=(itemId,loc)=>`${itemId}__${loc}`;

export function showEightySix(){
  setView(STYLE+topbar('86 Board')+`<p class="mut small">86 an item and it shows <b>Sold out</b> on the kiosk, online ordering and catering right away. Also mark it on the Square register if you're selling there.</p>
    <div class="e6-locs" id="locs"><button class="on" data-loc="all">All locations</button></div>
    <div class="sec">86'd now</div><div id="outList"><p class="mut small">Loading…</p></div>
    <input id="q" placeholder="Search menu" maxlength="40">
    <div id="menu"><p class="mut">Loading menu…</p></div>`);
  let locs=[],loc='all',menus={},out=[],menuItems=[];
  const locName=id=>id==='all'?'All locations':((locs.find(l=>l.id===id)||{}).name||'');
  const active=()=>out.filter(e=>!e.until||e.until>Date.now());
  const isOut=(itemId)=>active().find(e=>e.itemId===itemId&&(e.location==='all'||e.location===loc||loc==='all'));
  const drawOut=()=>{
    const list=active().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    $('#outList').innerHTML=list.length?list.map(e=>`<div class="e6-row out"><div class="t"><b>${esc(e.name)}</b><div class="mut small">${esc(e.location==='all'?'All locations':e.locationName||'')} · ${e.until?'until close today':'until turned back on'} · ${esc(e.by||'')}</div></div><button class="e6-b e6-on" data-on="${esc(e.id)}">Back on</button></div>`).join('')
      :'<p class="mut small">Nothing 86\'d. 🎉</p>';
  };
  const drawMenu=()=>{
    const q=($('#q').value||'').trim().toLowerCase();
    const list=menuItems.filter(i=>!q||i.name.toLowerCase().includes(q));
    $('#menu').innerHTML=list.length?list.map(i=>{const o=isOut(i.id);const sq=!o&&i.squareOut;return `<div class="e6-row${o||sq?' out':''}"><div class="t"><b>${esc(i.name)}</b>${sq?'<div class="small" style="color:#ef8a6f">Sold out in Square</div>':''}</div>${o?'<span class="mut small">86\'d</span>':`<button class="e6-b e6-86" data-86="${esc(i.id)}" data-nm="${esc(i.name)}">86</button>`}</div>`;}).join('')
      :`<p class="mut">${menuItems.length?'No items match.':'No menu items found.'}</p>`;
  };
  const loadMenu=async()=>{
    $('#menu').innerHTML='<p class="mut">Loading menu…</p>';
    const ids=loc==='all'?locs.map(l=>l.id):[loc];
    const byId={};
    await Promise.all(ids.map(async id=>{
      if(!menus[id]){try{menus[id]=await fetch(`${FN}/kioskMenu?loc=${encodeURIComponent(id)}`).then(r=>r.json());}catch(e){menus[id]={items:[]};}}
      (menus[id].items||[]).forEach(i=>{const o=byId[i.id]||(byId[i.id]={id:i.id,name:i.name,squareOut:true});o.squareOut=o.squareOut&&i.variations.every(v=>v.soldOut)&&!i.eightySixed;});
    }));
    menuItems=Object.values(byId).sort((a,b)=>a.name.localeCompare(b.name));
    drawMenu();
  };
  fetch(`${FN}/kdsLocations`).then(r=>r.json()).then(d=>{
    locs=d.locations||[];
    $('#locs').innerHTML=`<button class="on" data-loc="all">All locations</button>`+locs.map(l=>`<button data-loc="${esc(l.id)}">${esc(l.name)}</button>`).join('');
    loadMenu();
  }).catch(()=>{$('#menu').innerHTML='<p class="bad">Couldn\'t load locations.</p>';});
  sub(onSnapshot(collection(db,'eighty6'),s=>{out=s.docs.map(dd);drawOut();drawMenu();}));
  $('#locs').onclick=e=>{const b=e.target.closest('[data-loc]');if(!b)return;loc=b.dataset.loc;[...$('#locs').children].forEach(x=>x.classList.toggle('on',x===b));loadMenu();};
  $('#q').oninput=drawMenu;
  $('#outList').onclick=async e=>{const b=e.target.closest('[data-on]');if(b){b.disabled=true;await deleteDoc(doc(db,'eighty6',b.dataset.on));}};
  $('#menu').onclick=e=>{
    const b=e.target.closest('[data-86]');if(!b)return;
    const itemId=b.dataset['86'],name=b.dataset.nm;
    const w=document.createElement('div');w.className='e6-sheet';
    w.innerHTML=`<div><h2 style="margin:0 0 4px">86 ${esc(name)}?</h2><p class="mut small" style="margin:0 0 14px">${esc(locName(loc))}</p>
      <button class="btn full" data-u="today">Until close today</button>
      <button class="btn ghost full" data-u="off">Until I turn it back on</button>
      <button class="link full" data-x>Cancel</button></div>`;
    document.body.appendChild(w);
    w.onclick=async ev=>{
      if(ev.target===w||ev.target.closest('[data-x]')){w.remove();return;}
      const u=ev.target.closest('[data-u]');if(!u)return;
      await setDoc(doc(db,'eighty6',keyOf(itemId,loc)),{itemId,name,location:loc,locationName:locName(loc),until:u.dataset.u==='today'?endOfDay():null,by:S.me,at:Date.now()});
      w.remove();
    };
  };
}
