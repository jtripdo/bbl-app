import {db,S,$,esc,sub,today,dd,dlabel,t12,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp} from './core.js';

export function showEvents(){
  setView(topbar('Events')+`<details class="add"><summary>+ Add an event</summary><div>
  <input id="et" placeholder="Event name" maxlength="120">
  <div class="two"><input id="ed" type="date"><input id="etm" type="time"></div>
  <input id="el" placeholder="Location" maxlength="150">
  <textarea id="en" rows="2" placeholder="Notes (optional)" maxlength="500"></textarea>
  <button class="btn" id="ea">Add event</button></div></details><div id="ev"></div>`);
  sub(onSnapshot(collection(db,'events'),s=>{
    const t=today();
    const rows=s.docs.map(dd).filter(e=>e.active!==false&&e.date&&e.date>=t).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
    $('#ev').innerHTML=rows.length?rows.map(e=>`<div class="card"><div><span class="mut small">${dlabel(e.date)}${e.time?' · '+t12(e.time):''}</span> ${e.date===t?'<span class="tag today">TODAY</span>':''}</div>
    <h3 style="margin:4px 0">${esc(e.title)}</h3>
    ${e.location?`<div>📍 ${esc(e.location)}</div>`:''}${e.notes?`<div class="mut small">${esc(e.notes)}</div>`:''}
    <div style="margin-top:8px"><button class="btn sm" data-go="load" data-arg="${e.id}" data-title="${esc(e.title)}">Load Out Sheet</button> <button class="link" data-rme="${e.id}">Remove</button></div></div>`).join(''):'<p class="mut center">No upcoming events. Add one above.</p>';
  }));
  $('#ev').onclick=e=>{
    const r=e.target.closest('[data-rme]');
    if(r&&confirm('Remove this event?'))updateDoc(doc(db,'events',r.dataset.rme),{active:false});
  };
  $('#ea').onclick=()=>{
    const title=$('#et').value.trim(),date=$('#ed').value;
    if(!title||!date){alert('Please enter an event name and date.');return;}
    addDoc(collection(db,'events'),{title,date,time:$('#etm').value,location:$('#el').value.trim(),notes:$('#en').value.trim(),by:S.me,at:serverTimestamp(),active:true});
    ['et','ed','etm','el','en'].forEach(i=>$('#'+i).value='');
    document.querySelector('details.add').open=false;
  };
}
// END
