// Team screen: managers invite people, send password reset links and remove access.
import {S,$,esc,setView,topbar,teamApi} from './core.js';

const ROLE={owner:'Owner',manager:'Manager',staff:'Team'};
const linkFor=code=>location.origin+location.pathname.replace(/[^/]*$/,'')+'app.html?invite='+encodeURIComponent(code);

function shareBox(title,url,name){
  const text=`Hi ${name}! Here's your link to the Buttermilk Biscuit Lab team app: ${url}`;
  return `<div class="card" id="shareBox"><b>${esc(title)}</b>
    <p class="mut small" style="word-break:break-all">${esc(url)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-share="${esc(url)}" data-text="${esc(text)}">Share</button>
      <a class="btn" href="sms:&body=${encodeURIComponent(text)}">Text</a>
      <a class="btn" href="mailto:?subject=${encodeURIComponent('Your BBL app invite')}&body=${encodeURIComponent(text)}">Email</a>
      <button class="btn" data-copy="${esc(url)}">Copy link</button>
    </div><p class="mut small">The link works once and expires in 7 days.</p></div>`;
}

export async function showPeople(){
  if(S.role!=='owner'&&S.role!=='manager'){
    setView(topbar('Team')+`<div class="card"><b>${esc(S.me)}</b><div class="mut small">@${esc(S.username||'')} · ${ROLE[S.role]||'Team'}</div></div><p class="mut small">Only managers can invite people or reset passwords. Forgot your password? Ask a manager for a reset link.</p>`);
    return;
  }
  setView(topbar('Team')+`<div class="sec">Invite someone</div>
    <div class="addrow"><input id="pn" placeholder="Their name (e.g. Sam R.)" maxlength="40">
    ${S.role==='owner'?'<select id="prole" style="max-width:130px"><option value="staff">Team</option><option value="manager">Manager</option><option value="owner">Owner</option></select>':''}
    <button class="btn" id="pa">Invite</button></div>
    <div id="pout"></div>
    <div class="sec">On the team</div><div id="pl"><p class="mut small">Loading…</p></div>
    <div class="sec">Invites waiting</div><div id="pi"></div>
    ${S.role==='owner'?'<div class="sec">Page access</div><p class="mut small">Choose which pages Managers and Team members can open. Owners always see everything.</p><div id="pacc"></div>':''}
    <p class="mut small">Removing someone signs them out and turns off their login. Everything they already did stays on record.</p>`);
  const load=async()=>{
    try{
      const d=await teamApi('list');
      if(!$('#pl'))return;
      const owner=d.myRole==='owner';
      const mine=p=>owner||(p.role||'staff')==='staff';
      $('#pl').innerHTML=d.staff.map(p=>`<div class="row"><div class="txt"><b>${esc(p.name)}</b>${p.uid===d.me?' <span class="mut small">(you)</span>':''}<div class="mut small">@${esc(p.username)}${owner&&p.uid!==d.me?'':' · '+(ROLE[p.role]||'Team')}</div>
        ${owner&&p.uid!==d.me?`<select data-role="${esc(p.uid)}" data-nm="${esc(p.name)}" style="margin-top:6px;max-width:140px">${['staff','manager','owner'].map(r=>`<option value="${r}" ${r===(p.role||'staff')?'selected':''}>${ROLE[r]}</option>`).join('')}</select>`:''}</div>
        ${mine(p)||p.uid===d.me?`<button class="link" data-reset="${esc(p.uid)}" data-nm="${esc(p.name)}">Reset link</button>`:''}
        ${p.uid!==d.me&&mine(p)?`<button class="x" data-rm="${esc(p.uid)}" data-nm="${esc(p.name)}" aria-label="Remove">✕</button>`:''}</div>`).join('');
      if(owner&&$('#pacc'))drawAccess(d.access);
      $('#pi').innerHTML=d.invites.length?d.invites.map(i=>`<div class="row"><div class="txt">${esc(i.name)} <span class="mut small">· ${ROLE[i.role]||'Team'}</span></div>
        <button class="link" data-resend="${esc(i.code)}" data-nm="${esc(i.name)}">Send again</button>
        <button class="x" data-cancel="${esc(i.code)}" data-nm="${esc(i.name)}" aria-label="Cancel invite">✕</button></div>`).join(''):'<p class="mut small">None.</p>';
    }catch(e){if($('#pl'))$('#pl').innerHTML=`<p class="small" style="color:#ff8a7a">${esc(e.message)}</p>`;}
  };
  const invite=async()=>{
    const name=$('#pn').value.trim();
    if(!name)return;
    $('#pa').disabled=true;
    try{
      const r=await teamApi('invite',{name,role:$('#prole')?$('#prole').value:'staff'});
      $('#pn').value='';
      $('#pout').innerHTML=shareBox('Invite for '+name,linkFor(r.code),name);
      load();
    }catch(e){alert(e.message);}
    $('#pa').disabled=false;
  };
  const LABEL={today:'Today',par:'Par Sheets',opening:'Opening',closing:'Closing',cleaning:'Cleaning',prep:'Prep Sheet',mealprep:'Meal Prep',chat:'Team Chat',needs:'Needs & Wants',events:'Events',eightysix:'86 Board',labels:'Prep & Labels',loyalty:'Rewards',people:'Team',backoffice:'Back Office',mode:'Device Mode'};
  const drawAccess=acc=>{
    $('#pacc').innerHTML=`<div class="card"><div class="row" style="font-weight:700"><div class="txt">Page</div><div style="width:80px;text-align:center">Manager</div><div style="width:80px;text-align:center">Team</div></div>
      ${Object.keys(LABEL).map(pg=>`<div class="row"><div class="txt">${LABEL[pg]}</div>
        ${['manager','staff'].map(r=>`<label style="width:80px;text-align:center"><input type="checkbox" data-acc="${pg}" data-r="${r}" ${(acc[pg]||[]).includes(r)?'checked':''} style="width:22px;height:22px"></label>`).join('')}</div>`).join('')}
      <button class="btn" id="accSave" style="margin-top:10px">Save page access</button> <span id="accMsg" class="mut small"></span></div>`;
    $('#accSave').onclick=async()=>{
      const access={};
      Object.keys(LABEL).forEach(pg=>{access[pg]=[...document.querySelectorAll(`[data-acc="${pg}"]:checked`)].map(x=>x.dataset.r);});
      $('#accSave').disabled=true;
      try{await teamApi('setAccess',{access});S.access=access;$('#accMsg').textContent='Saved. Changes apply next time people open the app.';}
      catch(x){alert(x.message);}
      $('#accSave').disabled=false;
    };
  };
  $('#view').onchange=async e=>{
    const sel=e.target.closest('[data-role]');
    if(!sel)return;
    if(!confirm(`Make ${sel.dataset.nm} ${ROLE[sel.value]}?`)){load();return;}
    try{await teamApi('setRole',{uid:sel.dataset.role,role:sel.value});load();}catch(x){alert(x.message);load();}
  };
  $('#pa').onclick=invite;
  $('#pn').onkeydown=e=>{if(e.key==='Enter')invite();};
  $('#view').onclick=async e=>{
    const sh=e.target.closest('[data-share]');
    if(sh){if(navigator.share){navigator.share({title:'BBL team app',text:sh.dataset.text}).catch(()=>{});}else{navigator.clipboard&&navigator.clipboard.writeText(sh.dataset.text);alert('Copied. Paste it into a text or email.');}return;}
    const cp=e.target.closest('[data-copy]');
    if(cp){try{await navigator.clipboard.writeText(cp.dataset.copy);cp.textContent='Copied';}catch(x){prompt('Copy this link:',cp.dataset.copy);}return;}
    const rs=e.target.closest('[data-reset]');
    if(rs){if(!confirm('Make a password reset link for '+rs.dataset.nm+'?'))return;
      try{const r=await teamApi('resetLink',{uid:rs.dataset.reset});$('#pout').innerHTML=shareBox('Password reset for '+rs.dataset.nm,linkFor(r.code),rs.dataset.nm);window.scrollTo(0,0);}catch(x){alert(x.message);}return;}
    const again=e.target.closest('[data-resend]');
    if(again){$('#pout').innerHTML=shareBox('Invite for '+again.dataset.nm,linkFor(again.dataset.resend),again.dataset.nm);window.scrollTo(0,0);return;}
    const cn=e.target.closest('[data-cancel]');
    if(cn){if(!confirm('Cancel the invite for '+cn.dataset.nm+'? The link will stop working.'))return;
      try{await teamApi('cancelInvite',{code:cn.dataset.cancel});load();}catch(x){alert(x.message);}return;}
    const rm=e.target.closest('[data-rm]');
    if(rm){if(!confirm('Remove '+rm.dataset.nm+'? They will be signed out and their login turned off.'))return;
      try{await teamApi('remove',{uid:rm.dataset.rm});load();}catch(x){alert(x.message);}return;}
  };
  load();
}
// END
