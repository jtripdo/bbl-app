import {db,S,$,esc,sub,dd,slug,setView,topbar,collection,doc,setDoc,updateDoc,onSnapshot,serverTimestamp} from './core.js';

export function showPeople(){
  setView(topbar('Team')+`<div class="addrow"><input id="pn" placeholder="New team member (e.g. Sam R.)" maxlength="40"><button class="btn" id="pa">Add</button></div><div class="sec">On the team</div><div id="pl"></div><p class="mut small">Removing someone only hides them from the "Who's working?" list. Everything they already did stays on record.</p>`);
  sub(onSnapshot(collection(db,'team'),s=>{
    const rows=s.docs.map(dd).filter(p=>p.active!==false).sort((a,b)=>a.name.localeCompare(b.name));
    $('#pl').innerHTML=rows.length?rows.map(p=>`<div class="row"><div class="txt">${esc(p.name)}${p.name===S.me?' <span class="mut small">(you)</span>':''}</div><button class="x" data-rmt="${esc(p.id)}" data-nm="${esc(p.name)}" aria-label="Remove">✕</button></div>`).join(''):'<p class="mut center">No one yet. Add a name above.</p>';
  }));
  $('#pl').onclick=e=>{
    const r=e.target.closest('[data-rmt]');if(!r)return;
    if(r.dataset.nm===S.me){alert('You are working as this name right now. Switch to another name first, then remove it.');return;}
    if(confirm('Remove '+r.dataset.nm+' from the team list?'))updateDoc(doc(db,'team',r.dataset.rmt),{active:false});
  };
  const add=()=>{
    const n=$('#pn').value.trim().replace(/\s+/g,' ');
    if(!n)return;
    const id=slug(n);
    if(!id){alert('Please use letters or numbers in the name.');return;}
    setDoc(doc(db,'team',id),{name:n,active:true,at:serverTimestamp()});
    $('#pn').value='';
  };
  $('#pa').onclick=add;
  $('#pn').onkeydown=e=>{if(e.key==='Enter')add();};
}
// END
