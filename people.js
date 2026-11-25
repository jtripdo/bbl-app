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
    ${S.role==='owner'?'<select id="prole" style="max-width:130px"><option value="staff">Team</option><option value="manager">Manager</option></select>':''}
    <button class="btn" id="pa">Invite</button></div>
    <div id="pout"></div>
    <div class="sec">On the team</div><div id="pl"><p class="mut small">Loading…</p></div>
    <div class="sec">Invites waiting</div><div id="pi"></div>
    <p class="mut small">Removing someone signs them out and turns off their login. Everything they already did stays on record.</p>`);
  const load=async()=>{
    try{
      const d=await teamApi('list');
      if(!$('#pl'))return;
      $('#pl').innerHTML=d.staff.map(p=>`<div class="row"><div class="txt"><b>${esc(p.name)}</b>${p.uid===d.me?' <span class="mut small">(you)</span>':''}<div class="mut small">@${esc(p.username)} · ${ROLE[p.role]||'Team'}</div></div>
        <button class="link" data-reset="${esc(p.uid)}" data-nm="${esc(p.name)}">Reset link</button>
        ${p.role!=='owner'&&p.uid!==d.me?`<button class="x" data-rm="${esc(p.uid)}" data-nm="${esc(p.name)}" aria-label="Remove">✕</button>`:''}</div>`).join('');
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
