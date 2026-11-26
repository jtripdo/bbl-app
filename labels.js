// Prep & Labels: print food rotation labels, track what's on hand, log used/tossed.
// Prep Forecast (owners/managers): Square sales on the same weekday → what to prep.
// Data: prepItems (label setup), prepLabels (one per printed label).
import {db,auth,S,$,esc,sub,dd,setView,topbar,today,dstr,dlabel,collection,doc,addDoc,updateDoc,onSnapshot,query,where,serverTimestamp} from './core.js';

const FN='https://us-central1-bbl-app-d58e6.cloudfunctions.net/backOffice';
async function boApi(action,body={}){
  const h={'Content-Type':'application/json'};
  if(auth.currentUser)h.Authorization='Bearer '+(await auth.currentUser.getIdToken());
  const r=await fetch(FN,{method:'POST',headers:h,body:JSON.stringify({action,...body})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');
  return d;
}
const isMgr=()=>S.role==='owner'||S.role==='manager';
const live=r=>r.active!==false;
const byName=(a,b)=>(a.name||'').localeCompare(b.name||'');
const num=v=>{const n=parseFloat(String(v).replace(/[^0-9.]/g,''));return isFinite(n)?n:0;};
const DAYS=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const when=ms=>new Date(ms).toLocaleString([], {weekday:'short',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'});
const shelfMs=it=>(Number(it.shelf)||0)*((it.shelfUnit==='hours')?3600000:86400000);
const shelfTxt=it=>it.shelf?`${it.shelf} ${it.shelfUnit==='hours'?'hr':'day'}${Number(it.shelf)===1?'':'s'}`:'no shelf life set';
const STYLE=`<style>
.pl-items{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pl-item{background:var(--card);border:0;border-radius:18px;padding:14px;text-align:left;color:var(--ink);box-shadow:var(--shadow);min-height:74px}
.pl-item b{display:block;font-size:16px}
.pl-on{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:16px;padding:12px 14px;margin-bottom:8px;box-shadow:var(--shadow)}
.pl-on .t{flex:1}
.pl-on.exp{box-shadow:inset 4px 0 0 #ef8a6f,var(--shadow)}
.pl-on.today{box-shadow:inset 4px 0 0 var(--acc),var(--shadow)}
.pl-b{background:var(--card2);color:var(--ink);border:0;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:700}
.pl-sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:20}
.pl-sheet>div{background:var(--bg);width:min(520px,100vw);border-radius:22px 22px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom))}
.pl-step{display:flex;align-items:center;gap:14px;justify-content:center;margin:12px 0}
.pl-step button{width:52px;height:52px;border-radius:50%;border:0;background:var(--card2);color:var(--ink);font-size:26px}
.pl-step b{font-size:28px;min-width:40px;text-align:center}
.bad{color:#ef8a6f}.warn{color:var(--acc)}.good{color:var(--ok)}
.bo-t{width:100%;border-collapse:collapse;font-size:14px}
.bo-t th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:700;padding:6px 4px}
.bo-t td{padding:9px 4px;border-top:1px solid var(--line);vertical-align:top}
.bo-t .r{text-align:right;white-space:nowrap}
#printArea{display:none}
@media print{
  @page{size:62mm 58mm;margin:0}
  html,body{background:#fff!important;padding:0!important;margin:0!important}
  body>*:not(#printArea){display:none!important}
  #printArea{display:block!important}
  .lbl{width:62mm;height:58mm;box-sizing:border-box;padding:2.5mm 3mm;color:#000;font-family:-apple-system,Helvetica,Arial,sans-serif;page-break-after:always;break-after:page;overflow:hidden;display:flex;flex-direction:column;gap:1mm}
  .lbl .nm{font-size:15pt;font-weight:800;line-height:1.05;max-height:12.5mm;overflow:hidden}
  .lbl .day{background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:15pt;font-weight:900;text-align:center;letter-spacing:.06em;padding:.6mm 0;border-radius:1mm}
  .lbl .rw{display:flex;justify-content:space-between;font-size:8.5pt;line-height:1.25}
  .lbl .rw b{font-size:9.5pt}
  .lbl .sm{font-size:7.5pt;line-height:1.2}
}
</style>`;

function ensurePrintArea(){let el=document.getElementById('printArea');if(!el){el=document.createElement('div');el.id='printArea';document.body.appendChild(el);}return el;}
function labelHtml(l){
  const use=new Date(l.useBy);
  return `<div class="lbl"><div class="nm">${esc(l.name)}</div>
  <div class="day">USE BY ${DAYS[use.getDay()]}</div>
  <div class="rw"><span>Use by</span><b>${esc(when(l.useBy))}</b></div>
  <div class="rw"><span>Prepped</span><span>${esc(when(l.preppedAt))}</span></div>
  <div class="rw"><span>By ${esc(l.by||'')}</span><span>#${esc(l.batch||'')}${l.amount?' · '+esc(l.amount):''}</span></div>
  ${l.allergens?`<div class="sm"><b>Allergens:</b> ${esc(l.allergens)}</div>`:''}
  ${l.storage?`<div class="sm">${esc(l.storage)}</div>`:''}</div>`;
}
function printLabels(list){
  ensurePrintArea().innerHTML=list.map(labelHtml).join('');
  setTimeout(()=>window.print(),150);
}

// ---------- Main: print + on hand ----------
export function showLabels(){
  setView(STYLE+topbar('Prep & Labels')+`<input id="lq" placeholder="Search prep items" maxlength="60">
  <div id="li" class="pl-items"></div>
  ${isMgr()?`<p class="center"><button class="link" data-go="prepitems">Set up label items</button>${''}</p>`:''}
  <div class="sec">On hand</div><div id="lo"><p class="mut small">Loading…</p></div>`);
  let items=[],labels=[];
  const drawItems=()=>{
    const q=($('#lq').value||'').trim().toLowerCase();
    const list=items.filter(i=>!q||(i.name||'').toLowerCase().includes(q));
    $('#li').innerHTML=list.length?list.map(i=>`<button class="pl-item" data-pi="${i.id}"><b>${esc(i.name)}</b><span class="mut small">${esc(shelfTxt(i))}${i.storage?' · '+esc(i.storage):''}</span></button>`).join('')
      :`<p class="mut" style="grid-column:1/-1">${items.length?'No items match.':(isMgr()?'No label items yet. Tap "Set up label items" to add them.':'No label items yet. Ask a manager to set them up.')}</p>`;
  };
  const drawOn=()=>{
    const now=Date.now(),eod=new Date();eod.setHours(23,59,59,999);
    const rows=labels.slice().sort((a,b)=>a.useBy-b.useBy);
    $('#lo').innerHTML=rows.length?rows.map(l=>{const cls=l.useBy<now?'exp':l.useBy<=eod.getTime()?'today':'';return `<div class="pl-on ${cls}"><div class="t"><b>${esc(l.name)}</b>${l.amount?` <span class="mut small">${esc(l.amount)}</span>`:''}<div class="small ${cls==='exp'?'bad':cls==='today'?'warn':'mut'}">${cls==='exp'?'Expired ':'Use by '}${esc(when(l.useBy))} · #${esc(l.batch)}</div></div><button class="pl-b" data-used="${l.id}">Used</button><button class="pl-b" data-toss="${l.id}">Tossed</button><button class="pl-b" data-re="${l.id}" title="Reprint">⎙</button></div>`;}).join('')
      :'<p class="mut small">Nothing labeled right now.</p>';
  };
  sub(onSnapshot(collection(db,'prepItems'),s=>{items=s.docs.map(dd).filter(live).sort(byName);drawItems();}));
  sub(onSnapshot(query(collection(db,'prepLabels'),where('status','==','on')),s=>{labels=s.docs.map(dd);drawOn();}));
  const tick=setInterval(()=>{if(!document.getElementById('lo'))return clearInterval(tick);drawOn();},60000);
  $('#lq').oninput=drawItems;
  $('#li').onclick=e=>{const b=e.target.closest('[data-pi]');if(b)openPrint(items.find(i=>i.id===b.dataset.pi));};
  $('#lo').onclick=async e=>{
    const u=e.target.closest('[data-used]'),t=e.target.closest('[data-toss]'),r=e.target.closest('[data-re]');
    if(u)await updateDoc(doc(db,'prepLabels',u.dataset.used),{status:'used',endedAt:Date.now(),endedBy:S.me});
    if(t&&confirm('Mark this as tossed? It counts as waste.'))await updateDoc(doc(db,'prepLabels',t.dataset.toss),{status:'tossed',endedAt:Date.now(),endedBy:S.me});
    if(r){const l=labels.find(x=>x.id===r.dataset.re);if(l)printLabels([l]);}
  };
}

function openPrint(it){
  if(!it)return;
  if(!it.shelf){alert('This item has no shelf life set yet. Ask a manager to set it under "Set up label items".');return;}
  let n=1;
  const wrap=document.createElement('div');wrap.className='pl-sheet';
  wrap.innerHTML=`<div><h2 style="margin:0 0 4px">${esc(it.name)}</h2><p class="mut small" style="margin:0">Good for ${esc(shelfTxt(it))} · use by <b id="ub"></b></p>
  <div class="pl-step"><button data-d="-1">−</button><b id="pn">1</b><button data-d="1">+</button></div><p class="mut small center" style="margin-top:-6px">labels (one per container)</p>
  <input id="pam" placeholder="Amount in each (optional, e.g. ${esc(it.container||'1/3 pan')})" maxlength="30">
  <button class="btn full" id="pgo">Print 1 label</button><button class="btn ghost full" id="px" style="margin-top:-8px">Cancel</button></div>`;
  document.body.appendChild(wrap);
  const at=Date.now(),use=at+shelfMs(it);
  wrap.querySelector('#ub').textContent=when(use);
  const upd=()=>{wrap.querySelector('#pn').textContent=n;wrap.querySelector('#pgo').textContent=`Print ${n} label${n>1?'s':''}`;};
  wrap.onclick=async e=>{
    if(e.target===wrap||e.target.id==='px'){wrap.remove();return;}
    const d=e.target.closest('[data-d]');if(d){n=Math.min(50,Math.max(1,n+Number(d.dataset.d)));upd();return;}
    if(e.target.id==='pgo'){
      e.target.disabled=true;
      const batch=dstr(new Date(at)).slice(2).replace(/-/g,'')+'-'+String(Math.floor(Math.random()*900)+100);
      const base={itemId:it.id,name:it.name,preppedAt:at,useBy:use,by:S.me,batch,amount:wrap.querySelector('#pam').value.trim(),allergens:it.allergens||'',storage:it.storage||'',portions:Number(it.portions)||0,status:'on',at:serverTimestamp()};
      const list=[];
      for(let i=0;i<n;i++){const l={...base};await addDoc(collection(db,'prepLabels'),l);list.push(l);}
      wrap.remove();printLabels(list);
    }
  };
}

// ---------- Setup (owners/managers) ----------
export function showPrepItems(){
  if(!isMgr()){setView(topbar('Label items','labels')+'<p class="mut">Only managers can change label items.</p>');return;}
  setView(STYLE+topbar('Label items','labels')+`<details class="add" id="pf"><summary>+ Add a prep item</summary><div>
    <input id="pn" placeholder="Name (e.g. Sausage gravy)" maxlength="60">
    <div class="two"><input id="ps" inputmode="decimal" placeholder="Shelf life"><select id="psu"><option value="days">days</option><option value="hours">hours</option></select></div>
    <div class="two"><input id="pst" list="sts" placeholder="Storage (e.g. Walk-in)" maxlength="30"><input id="pc" placeholder="Container (e.g. 1/3 pan)" maxlength="30"></div>
    <datalist id="sts"><option value="Walk-in"><option value="Reach-in"><option value="Freezer"><option value="Dry storage"><option value="Hot hold"></datalist>
    <input id="pa" placeholder="Allergens (e.g. Milk, Wheat, Egg)" maxlength="80">
    <div class="sec" style="margin-top:8px">For the prep forecast</div>
    <input id="pp" inputmode="decimal" placeholder="Portions one container covers (e.g. 40)">
    <label class="mut small">Menu items it goes into (from Square)</label>
    <div id="pm" class="small mut">Loading Square menu…</div>
    <button class="btn" id="psave">Add item</button></div></details><div id="pl"></div>`);
  let items=[],menu=[],eid=null,picked=new Set();
  const drawMenu=()=>{$('#pm').innerHTML=menu.length?menu.map(m=>`<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="checkbox" style="width:auto;margin:0" data-m="${esc(m)}" ${picked.has(m)?'checked':''}>${esc(m)}</label>`).join(''):'Square menu unavailable right now.';};
  boApi('menu').then(r=>{menu=[...new Set(r.items.map(i=>i.name))];drawMenu();}).catch(()=>{menu=[];drawMenu();});
  const draw=()=>{$('#pl').innerHTML=items.length?items.map(i=>`<div class="card"><div class="ih"><b>${esc(i.name)}</b><span class="mut small">${esc(shelfTxt(i))}</span></div><div class="mut small">${[i.storage,i.container,i.allergens&&('Allergens: '+i.allergens),i.portions&&(i.portions+' portions per container'),(i.menuItems||[]).length&&('Goes into: '+i.menuItems.join(', '))].filter(Boolean).map(esc).join(' · ')}</div><div style="margin-top:8px"><button class="link" data-e="${i.id}">Edit</button> · <button class="link" data-r="${i.id}">Remove</button></div></div>`).join(''):'<p class="mut center">No prep items yet. Add the first one above.</p>';};
  sub(onSnapshot(collection(db,'prepItems'),s=>{items=s.docs.map(dd).filter(live).sort(byName);draw();}));
  $('#pm').onchange=e=>{const m=e.target.dataset.m;if(m){e.target.checked?picked.add(m):picked.delete(m);}};
  $('#pl').onclick=async e=>{
    const ed=e.target.closest('[data-e]'),rm=e.target.closest('[data-r]');
    if(rm){if(confirm('Remove this prep item? Labels already printed stay on hand.'))await updateDoc(doc(db,'prepItems',rm.dataset.r),{active:false});return;}
    if(ed){const i=items.find(x=>x.id===ed.dataset.e);if(!i)return;eid=i.id;
      $('#pn').value=i.name||'';$('#ps').value=i.shelf||'';$('#psu').value=i.shelfUnit||'days';$('#pst').value=i.storage||'';$('#pc').value=i.container||'';$('#pa').value=i.allergens||'';$('#pp').value=i.portions||'';
      picked=new Set(i.menuItems||[]);drawMenu();$('#psave').textContent='Save changes';$('#pf').open=true;window.scrollTo(0,0);}
  };
  $('#psave').onclick=async()=>{
    const name=$('#pn').value.trim();if(!name){alert('Please enter a name.');return;}
    const shelf=num($('#ps').value);if(!shelf){alert('Please enter how long it keeps.');return;}
    const d={name,shelf,shelfUnit:$('#psu').value,storage:$('#pst').value.trim(),container:$('#pc').value.trim(),allergens:$('#pa').value.trim(),portions:num($('#pp').value),menuItems:[...picked]};
    if(eid)await updateDoc(doc(db,'prepItems',eid),{...d,editedBy:S.me,editedAt:serverTimestamp()});
    else await addDoc(collection(db,'prepItems'),{...d,by:S.me,at:serverTimestamp(),active:true});
    eid=null;picked=new Set();['pn','ps','pst','pc','pa','pp'].forEach(i=>$('#'+i).value='');$('#psu').value='days';drawMenu();
    $('#psave').textContent='Add item';$('#pf').open=false;
  };
}

// ---------- Prep forecast (owners/managers) ----------
export function showForecast(){
  const tmr=dstr(new Date(Date.now()+86400000));
  setView(STYLE+topbar('Prep Forecast','bo')+`<div class="two"><input type="date" id="fd" value="${tmr}"><select id="fw"><option value="4">Last 4 weeks</option><option value="6" selected>Last 6 weeks</option><option value="8">Last 8 weeks</option></select></div>
  <label class="mut small">Extra cushion</label><select id="fb"><option value="0">None</option><option value="0.1" selected>+10%</option><option value="0.2">+20%</option></select>
  <div id="fo"><p class="mut">Loading Square sales…</p></div>`);
  let items=[],labels=[],tossed=[],hist=null,seq=0;
  const load=async()=>{
    const my=++seq;hist=null;$('#fo').innerHTML='<p class="mut">Loading Square sales…</p>';
    try{const r=await boApi('history',{date:$('#fd').value,weeks:$('#fw').value});if(my===seq){hist=r;draw();}}
    catch(e){if(my===seq)$('#fo').innerHTML=`<p class="bad">${esc(e.message)}</p>`;}
  };
  const draw=()=>{
    if(!hist)return;
    const target=$('#fd').value,cushion=Number($('#fb').value);
    const open=hist.days.filter(d=>d.sales>0);
    const dname=DAYS[new Date(target+'T12:00').getDay()];
    if(!open.length){$('#fo').innerHTML=`<p class="mut">No sales on the last ${hist.days.length} ${dname.toLowerCase()}s, so there's nothing to forecast from yet.</p>`;return;}
    // Average units sold per menu item on this weekday
    const names=new Set();open.forEach(d=>Object.keys(d.items).forEach(n=>names.add(n)));
    const fc={};names.forEach(n=>{fc[n.toLowerCase()]={name:n,qty:open.reduce((a,d)=>a+(d.items[n]||0),0)/open.length};});
    const salesAvg=open.reduce((a,d)=>a+d.sales,0)/open.length/100;
    // Turn menu demand into containers to prep
    const endOfTarget=new Date(target+'T23:59').getTime();
    const rows=items.filter(i=>(i.menuItems||[]).length&&i.portions).map(i=>{
      const need=(i.menuItems||[]).reduce((a,m)=>a+((fc[m.toLowerCase()]||{}).qty||0),0)*(1+cushion);
      const onHand=labels.filter(l=>l.itemId===i.id&&l.useBy>=endOfTarget).length;
      const containers=Math.max(0,Math.ceil(need/i.portions-onHand-1e-9));
      const waste=tossed.filter(l=>l.itemId===i.id).length;
      return {i,need,onHand,containers,waste};
    }).sort((a,b)=>b.containers-a.containers);
    const unset=items.filter(i=>!(i.menuItems||[]).length||!i.portions);
    $('#fo').innerHTML=`<div class="card"><div class="ih"><span>Expected sales, ${esc(dlabel(target))}</span><b>$${Math.round(salesAvg).toLocaleString()}</b></div><div class="mut small">Average of ${open.length} recent ${dname.toLowerCase()}s with sales.</div></div>
    <div class="sec">Prep for ${esc(dlabel(target))}</div>
    ${rows.length?`<div class="card"><table class="bo-t"><tr><th>Item</th><th class="r">Need</th><th class="r">On hand</th><th class="r">Prep</th></tr>${rows.map(r=>`<tr><td><b>${esc(r.i.name)}</b>${r.waste?`<div class="warn small">${r.waste} tossed in the last 2 weeks</div>`:''}</td><td class="r">${Math.round(r.need)} portions</td><td class="r">${r.onHand}</td><td class="r"><b>${r.containers}</b> ${esc(r.i.container||'')}</td></tr>`).join('')}</table></div>
      <button class="btn full" id="toPrep">Add to the Prep Sheet for ${esc(dlabel(target))}</button><p id="fmsg" class="mut small"></p>`
      :'<p class="mut">No prep items are linked to menu items yet. Under Prep & Labels → Set up label items, add portions per container and the menu items each goes into.</p>'}
    ${unset.length&&rows.length?`<p class="mut small">Not in the forecast (no menu items or portions set): ${unset.map(i=>esc(i.name)).join(', ')}.</p>`:''}
    <div class="sec">Menu items expected to sell</div>
    <div class="card"><table class="bo-t">${Object.values(fc).sort((a,b)=>b.qty-a.qty).slice(0,25).map(f=>`<tr><td>${esc(f.name)}</td><td class="r">${Math.round(f.qty*10)/10}</td></tr>`).join('')}</table></div>
    <p class="mut small">Need = average sold on this weekday × portions, plus the cushion. On hand = labeled containers still good at the end of that day. Prep = containers still needed.</p>`;
    const b=$('#toPrep');if(b)b.onclick=async()=>{
      const todo=rows.filter(r=>r.containers>0);if(!todo.length){$('#fmsg').textContent='Nothing needs prepping.';return;}
      b.disabled=true;
      for(const r of todo)await addDoc(collection(db,'listItems'),{scope:'prep_'+target,text:`${r.i.name}: ${r.containers} ${r.i.container||'container'}${r.containers>1&&!r.i.container?'s':''}`,by:S.me,at:serverTimestamp(),active:true,fromForecast:true});
      $('#fmsg').textContent=`Added ${todo.length} item${todo.length>1?'s':''} to the Prep Sheet for ${dlabel(target)}.`;
    };
  };
  sub(onSnapshot(collection(db,'prepItems'),s=>{items=s.docs.map(dd).filter(live);draw();}));
  sub(onSnapshot(query(collection(db,'prepLabels'),where('status','==','on')),s=>{labels=s.docs.map(dd);draw();}));
  sub(onSnapshot(query(collection(db,'prepLabels'),where('status','==','tossed')),s=>{const since=Date.now()-14*86400000;tossed=s.docs.map(dd).filter(l=>(l.endedAt||0)>=since);draw();}));
  $('#fd').onchange=load;$('#fw').onchange=load;$('#fb').onchange=draw;
  load();
}
// END
