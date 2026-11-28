// Team app: BBL Rewards — look up members, add register sales, redeem, adjust, email the list.
import {auth,S,$,esc,setView,topbar} from './core.js';

const FN='https://us-central1-bbl-app-d58e6.cloudfunctions.net/loyaltyAdmin';
async function api(action,body={}){
  const h={'Content-Type':'application/json'};
  if(auth.currentUser)h.Authorization='Bearer '+(await auth.currentUser.getIdToken());
  const r=await fetch(FN,{method:'POST',headers:h,body:JSON.stringify({action,...body})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');
  return d;
}
const isMgr=()=>S.role==='owner'||S.role==='manager';
const money=c=>'$'+((c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const ago=ms=>{if(!ms)return'—';const d=Math.floor((Date.now()-ms)/86400000);return d<1?'today':d===1?'yesterday':d<30?d+' days ago':new Date(ms).toLocaleDateString();};
const STYLE=`<style>
.ly-kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.ly-kpi{background:var(--card);border-radius:18px;padding:14px 16px;box-shadow:var(--shadow)}
.ly-kpi b{display:block;font-size:26px;letter-spacing:-.02em}
.ly-row{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:16px;padding:12px 14px;margin-bottom:8px;box-shadow:var(--shadow);cursor:pointer}
.ly-row .t{flex:1}.ly-pts{font-size:20px;font-weight:800}
.ly-big{font-size:54px;font-weight:800;letter-spacing:-.03em;line-height:1}
.ly-bar{height:10px;border-radius:999px;background:var(--card2);overflow:hidden;margin:8px 0}
.ly-bar i{display:block;height:100%;background:var(--acc)}
.ly-h td{padding:8px 4px;border-top:1px solid var(--line);font-size:14px;vertical-align:top}
.ly-h td:last-child{text-align:right;font-weight:700;white-space:nowrap}
.bad{color:#ef8a6f}.good{color:var(--ok)}
</style>`;

export function showLoyalty(){
  setView(STYLE+topbar('BBL Rewards')+`
  <div class="ly-kpis"><div class="ly-kpi"><span class="mut small">Members</span><b id="k1">…</b></div><div class="ly-kpi"><span class="mut small">Pop-up email list</span><b id="k2">…</b></div></div>
  <input id="lq" placeholder="Phone number or name" inputmode="search" maxlength="40">
  <div id="ll"><p class="mut">Loading…</p></div>
  <details class="add" id="ljoin"><summary>+ Sign up a customer</summary><div>
    <input id="jn" placeholder="Name" maxlength="40"><input id="jp" type="tel" placeholder="Phone" maxlength="16"><input id="je" type="email" placeholder="Email" maxlength="80">
    <button class="btn" id="jgo">Sign up (+25 points)</button><p id="jm" class="small"></p></div></details>
  ${isMgr()?`<details class="add" id="lmail"><summary>✉️ Email the pop-up list</summary><div>
    <input id="ms" placeholder="Subject (e.g. Double points this Saturday!)" maxlength="90">
    <textarea id="mm" rows="6" placeholder="Your message" maxlength="3000"></textarea>
    <button class="btn" id="mgo">Send to everyone on the list</button><p id="mmsg" class="small"></p></div></details>`:''}`);
  let seq=0;
  const search=async()=>{
    const my=++seq;const q=$('#lq').value.trim();
    try{const r=await api('search',{q});if(my!==seq)return;
      $('#ll').innerHTML=r.members.length?(q?'':'<div class="sec">Top regulars</div>')+r.members.map(m=>`<div class="ly-row" data-ph="${esc(m.phone)}"><div class="t"><b>${esc(m.name||m.pretty)}</b><div class="mut small">${esc(m.pretty)} · ${m.visits} visit${m.visits===1?'':'s'} · last ${esc(ago(m.lastVisit))}</div></div><div class="ly-pts">${m.points}</div></div>`).join('')
        :`<p class="mut">${q?'No member found. Sign them up below.':'No members yet.'}</p>`;
    }catch(e){if(my===seq)$('#ll').innerHTML=`<p class="bad">${esc(e.message)}</p>`;}
  };
  api('stats').then(s=>{$('#k1').textContent=s.members;$('#k2').textContent=s.subscribers;}).catch(()=>{$('#k1').textContent='—';$('#k2').textContent='—';});
  search();
  let t;$('#lq').oninput=()=>{clearTimeout(t);t=setTimeout(search,350);};
  $('#ll').onclick=e=>{const r=e.target.closest('[data-ph]');if(r)showMember(r.dataset.ph);};
  $('#jgo').onclick=async()=>{
    $('#jgo').disabled=true;$('#jm').textContent='';
    try{const r=await api('join',{name:$('#jn').value.trim(),phone:$('#jp').value,email:$('#je').value.trim(),alerts:true});showMember(r.member.phone);}
    catch(e){$('#jm').innerHTML=`<span class="bad">${esc(e.message)}</span>`;$('#jgo').disabled=false;}
  };
  if(isMgr())$('#mgo').onclick=async()=>{
    const subject=$('#ms').value.trim(),message=$('#mm').value.trim();
    if(!subject||!message){$('#mmsg').innerHTML='<span class="bad">Add a subject and a message.</span>';return;}
    if(!confirm(`Email "${subject}" to everyone on the pop-up list?`))return;
    $('#mgo').disabled=true;$('#mmsg').textContent='Sending…';
    try{const r=await api('broadcast',{subject,message});$('#mmsg').innerHTML=`<span class="good">Sent to ${r.sent} people.</span>`;$('#ms').value='';$('#mm').value='';}
    catch(e){$('#mmsg').innerHTML=`<span class="bad">${esc(e.message)}</span>`;}
    $('#mgo').disabled=false;
  };
}

async function showMember(phone){
  setView(STYLE+topbar('Rewards member','loyalty')+`<div id="lm"><p class="mut">Loading…</p></div>`);
  const draw=(d)=>{
    const m=d.member,R=100;
    $('#lm').innerHTML=`<div class="card"><b style="font-size:18px">${esc(m.name||'Member')}</b><div class="mut small">${esc(m.pretty)} · ${esc(m.email)}</div>
      <div class="ly-big" style="margin-top:10px">${m.points}</div><div class="mut small">points</div>
      <div class="ly-bar"><i style="width:${Math.min(100,m.points/R*100)}%"></i></div>
      <div class="small">${m.points>=R?'<b class="good">Has a free biscuit sandwich ready</b>':`${R-m.points} to a free biscuit sandwich`}</div>
      <div class="mut small" style="margin-top:6px">${m.visits} visits · ${money(m.spent)} spent · joined ${esc(ago(m.joinedAt))}${m.birthday?` · birthday ${esc(m.birthday.replace('-','/'))}`:''} · friend code ${esc(m.refCode)}</div></div>
    <div class="card"><b>Register sale</b><p class="mut small" style="margin:2px 0 8px">Rang them up on the Square register? Add the sale total so they earn points.</p>
      <div class="two"><input id="sa" inputmode="decimal" placeholder="$ total before tax"><label class="ib" style="gap:6px"><input type="checkbox" id="sp" style="width:auto"> At a pop-up (2×)</label></div>
      <button class="btn" id="sgo">Add points</button>
      ${m.points>=R?'<button class="btn ghost" id="rgo">Redeem free biscuit sandwich (−100)</button>':''}<p id="smsg" class="small"></p></div>
    ${isMgr()?`<details class="add"><summary>Adjust points (managers)</summary><div><div class="two"><input id="ad" inputmode="numeric" placeholder="+20 or -20"><input id="ar" placeholder="Reason" maxlength="80"></div><button class="btn" id="ago">Save</button><p id="amsg" class="small"></p></div></details>`:''}
    <div class="sec">History</div><div class="card"><table style="width:100%;border-collapse:collapse" class="ly-h">${d.history.map(h=>`<tr><td>${esc(h.reason)}<div class="mut small">${h.at?new Date(h.at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}${h.by?' · '+esc(h.by):''}</div></td><td class="${h.delta<0?'bad':'good'}">${h.delta>0?'+':''}${h.delta}</td></tr>`).join('')}</table></div>`;
    const busy=(id,msg)=>{$('#'+id).innerHTML=msg;};
    $('#sgo').onclick=async()=>{busy('smsg','Saving…');try{draw(await api('sale',{phone:m.phone,amount:$('#sa').value.replace(/[^0-9.]/g,''),popup:$('#sp').checked}));}catch(e){busy('smsg',`<span class="bad">${esc(e.message)}</span>`);}};
    if($('#rgo'))$('#rgo').onclick=async()=>{if(!confirm('Give them a free biscuit sandwich and take 100 points?'))return;try{draw(await api('redeem',{phone:m.phone}));}catch(e){busy('smsg',`<span class="bad">${esc(e.message)}</span>`);}};
    if($('#ago'))$('#ago').onclick=async()=>{try{draw(await api('adjust',{phone:m.phone,delta:$('#ad').value,reason:$('#ar').value}));}catch(e){busy('amsg',`<span class="bad">${esc(e.message)}</span>`);}};
  };
  try{draw(await api('member',{phone}));}catch(e){$('#lm').innerHTML=`<p class="bad">${esc(e.message)}</p>`;}
}
