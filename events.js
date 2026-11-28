import {db,S,$,esc,sub,today,dd,dlabel,t12,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp} from './core.js';
import {icon} from './icons.js';

export function showEvents(){
  setView(topbar('Events')+`<p class="small"><button class="link" data-go="poptemplate">Pop-up load out template</button></p><details class="add"><summary>+ Add an event</summary><div>
  <input id="et" placeholder="Event name" maxlength="120">
  <div class="two"><input id="ed" type="date"><input id="etm" type="time" aria-label="Start time"></div>
  <div class="two"><span class="mut small" style="align-self:center">Ends at (optional)</span><input id="ete" type="time" aria-label="End time"></div>
  <input id="el" placeholder="Location" maxlength="150">
  <textarea id="en" rows="2" placeholder="Notes (optional, never shown on the website)" maxlength="500"></textarea>
  <label class="ib" style="gap:8px;margin:6px 0"><input type="checkbox" id="epu" style="width:auto"> Show on website pop-up calendar</label>
  <label class="ib" style="gap:8px;margin:6px 0"><input type="checkbox" id="epre" style="width:auto" checked> Customers can pre-order online</label>
  <button class="btn" id="ea">Add event</button></div></details><div id="ev"></div><details class="add" style="margin-top:14px"><summary>Past events (last 60 days)</summary><div id="past"></div></details>`);
  sub(onSnapshot(collection(db,'events'),s=>{
    const t=today();
    const rows=s.docs.map(dd).filter(e=>e.active!==false&&e.date&&e.date>=t).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
    $('#ev').innerHTML=rows.length?rows.map(e=>`<div class="card"><div><span class="mut small">${dlabel(e.date)}${e.time?' · '+t12(e.time):''}${e.endTime?' – '+t12(e.endTime):''}</span> ${e.date===t?'<span class="tag today">TODAY</span>':''} ${e.popup?'<span class="tag">ON WEBSITE</span>':''} ${e.popup?(e.preorder===false?'<span class="tag">WALK-UP ONLY</span>':'<span class="tag">PRE-ORDERS ON</span>'):''}</div>
    <h3 style="margin:4px 0">${esc(e.title)}</h3>
    ${e.location?`<div class="ib mut">${icon('pin',16)} ${esc(e.location)}</div>`:''}${e.notes?`<div class="mut small">${esc(e.notes)}</div>`:''}
    <div style="margin-top:8px"><button class="btn sm" data-go="${e.popup?'popload':'load'}" data-arg="${e.id}" data-title="${esc(e.title)}">Load Out Sheet</button> <button class="link" data-pop="${e.id}" data-on="${e.popup?1:0}">${e.popup?'Hide from website':'Show on website'}</button>${e.popup?` <button class="link" data-pre="${e.id}" data-on="${e.preorder===false?0:1}">${e.preorder===false?'Turn on pre-orders':'Turn off pre-orders'}</button>`:''} <button class="link" data-rme="${e.id}">Remove</button></div></div>`).join(''):'<p class="mut center">No upcoming events. Add one above.</p>';
    const cut=new Date(Date.now()-60*864e5).toLocaleDateString('en-CA');
    const past=s.docs.map(dd).filter(e=>e.active!==false&&e.date&&e.date<t&&e.date>=cut).sort((a,b)=>b.date.localeCompare(a.date));
    $('#past').innerHTML=past.length?past.map(e=>`<div class="card"><span class="mut small">${dlabel(e.date)}</span><h3 style="margin:4px 0">${esc(e.title)}</h3><button class="btn sm" data-go="${e.popup?'popload':'load'}" data-arg="${e.id}" data-title="${esc(e.title)}">Load Out Sheet</button></div>`).join(''):'<p class="mut small">No past events.</p>';
  }));
  $('#ev').onclick=e=>{
    const p=e.target.closest('[data-pop]');
    if(p){const on=p.dataset.on!=='1';updateDoc(doc(db,'events',p.dataset.pop),on?{popup:true,needsAnnounce:true}:{popup:false});return;}
    const pr=e.target.closest('[data-pre]');
    if(pr){updateDoc(doc(db,'events',pr.dataset.pre),{preorder:pr.dataset.on!=='1'});return;}
    const r=e.target.closest('[data-rme]');
    if(r&&confirm('Remove this event?'))updateDoc(doc(db,'events',r.dataset.rme),{active:false});
  };
  $('#ea').onclick=()=>{
    const title=$('#et').value.trim(),date=$('#ed').value;
    if(!title||!date){alert('Please enter an event name and date.');return;}
    addDoc(collection(db,'events'),{title,date,time:$('#etm').value,endTime:$('#ete').value,location:$('#el').value.trim(),notes:$('#en').value.trim(),popup:$('#epu').checked,needsAnnounce:$('#epu').checked,preorder:$('#epre').checked,by:S.me,at:serverTimestamp(),active:true});
    ['et','ed','etm','ete','el','en'].forEach(i=>$('#'+i).value='');$('#epu').checked=false;$('#epre').checked=true;
    document.querySelector('details.add').open=false;
  };
}
// END
