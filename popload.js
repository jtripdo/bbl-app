// Pop-up load out: one shared template for every pop-up, plus extras per pop-up.
// Template items can be marked "Not needed" for a single pop-up without changing the template.
import {db,S,$,esc,sub,fmt,dd,setView,topbar,collection,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,where,serverTimestamp} from './core.js';

export const TEMPLATE='load_popup_template';

export function showPopLoad(eventId,title){
  const own='load_'+eventId;               // extras just for this pop-up (and older lists)
  const checkKey=own+'|event';             // packed checks (same key the old sheet used)
  const skipKey='skipload|'+eventId;       // "not needed" marks for this pop-up
  setView(topbar('Load Out: '+(title||'Pop-up'),'events')+`<div id="plRoot"><div class="mut" id="prog"></div>
    <p class="mut small">Tap an item when it's packed. Tap "Not needed" for anything you won't bring to this pop-up.</p>
    <div id="convert"></div>
    <div class="sec">Pop-up template</div><div id="tItems"></div>
    <div class="sec">Just for this pop-up</div><div id="oItems"></div>
    <div class="addrow"><input id="nt" placeholder="Add something just for this pop-up" maxlength="200"><button class="btn" id="ab">Add</button></div>
    <p class="small"><button class="link" data-go="poptemplate">Edit the pop-up template</button> <span class="mut">(changes apply to every pop-up)</span></p></div>`);
  let tItems=[],oItems=[],checks={},skips={};
  const row=(i,isTemplate)=>{
    const c=checks[i.id],skip=isTemplate&&skips[i.id];
    return `<div class="row${c?' done':''}" data-t="${i.id}" style="${skip?'opacity:.4':''}">
      <div class="chk">${c?'✓':''}</div>
      <div class="txt">${skip?`<s>${esc(i.text)}</s> <span class="small mut">not needed</span>`:esc(i.text)}${c?`<div class="who">${esc(c.by)} · ${fmt(c.at)}</div>`:''}</div>
      ${isTemplate?`<button class="link" data-skip="${i.id}" style="white-space:nowrap">${skip?'Need it':'Not needed'}</button>`:`<button class="x" data-rm="${i.id}" aria-label="Remove">✕</button>`}</div>`;
  };
  const draw=()=>{
    const live=[...tItems.filter(i=>!skips[i.id]),...oItems];
    const done=live.filter(i=>checks[i.id]).length;
    $('#prog').textContent=live.length?`${done} of ${live.length} packed`:'';
    $('#tItems').innerHTML=tItems.length?tItems.map(i=>row(i,true)).join(''):'<p class="mut small">The template is empty. Use "Edit the pop-up template" below to add items.</p>';
    $('#oItems').innerHTML=oItems.length?oItems.map(i=>row(i,false)).join(''):'<p class="mut small">Nothing extra.</p>';
    // One-time: turn an existing pop-up list into the shared template.
    $('#convert').innerHTML=(!tItems.length&&oItems.length&&(S.role==='owner'||S.role==='manager'))
      ?`<div class="card"><b>Use this list for every pop-up?</b><p class="mut small">Moves these ${oItems.length} items into the pop-up template so every pop-up gets them.</p><button class="btn" id="mkTpl">Make this the pop-up template</button></div>`:'';
    const mk=$('#mkTpl');
    if(mk)mk.onclick=async()=>{
      if(!confirm('Make these '+oItems.length+' items the load out for every pop-up?'))return;
      mk.disabled=true;
      for(const i of oItems){
        const ref=await addDoc(collection(db,'listItems'),{scope:TEMPLATE,text:i.text,by:S.me,at:serverTimestamp(),active:true});
        await updateDoc(doc(db,'listItems',i.id),{active:false});
        if(checks[i.id])await setDoc(doc(db,'checks',own+'__event__'+ref.id),{key:checkKey,itemId:ref.id,by:checks[i.id].by,at:serverTimestamp()});
      }
    };
  };
  const sortAt=(a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0);
  sub(onSnapshot(query(collection(db,'listItems'),where('scope','==',TEMPLATE)),s=>{tItems=s.docs.map(dd).filter(i=>i.active!==false).sort(sortAt);draw();}));
  sub(onSnapshot(query(collection(db,'listItems'),where('scope','==',own)),s=>{oItems=s.docs.map(dd).filter(i=>i.active!==false).sort(sortAt);draw();}));
  sub(onSnapshot(query(collection(db,'checks'),where('key','==',checkKey)),s=>{checks={};s.docs.map(dd).forEach(c=>{checks[c.itemId]=c;});draw();}));
  sub(onSnapshot(query(collection(db,'checks'),where('key','==',skipKey)),s=>{skips={};s.docs.map(dd).forEach(c=>{skips[c.itemId]=c;});draw();}));

  $('#plRoot').onclick=e=>{
    const sk=e.target.closest('[data-skip]');
    if(sk){const id=sk.dataset.skip,ref=doc(db,'checks','skip__'+eventId+'__'+id);
      if(skips[id])deleteDoc(ref);else setDoc(ref,{key:skipKey,itemId:id,by:S.me,at:serverTimestamp()});
      return;}
    const rm=e.target.closest('[data-rm]');
    if(rm){if(confirm('Remove this item from this pop-up?'))updateDoc(doc(db,'listItems',rm.dataset.rm),{active:false});return;}
    const r=e.target.closest('[data-t]');if(!r||e.target.closest('button'))return;
    const id=r.dataset.t;
    if(skips[id])return; // not needed: nothing to pack
    const ref=doc(db,'checks',own+'__event__'+id);
    if(checks[id]){if(confirm('Undo this check?'))deleteDoc(ref);}
    else setDoc(ref,{key:checkKey,itemId:id,by:S.me,at:serverTimestamp()});
  };
  const add=()=>{const t=$('#nt').value.trim();if(!t)return;$('#nt').value='';
    addDoc(collection(db,'listItems'),{scope:own,text:t,by:S.me,at:serverTimestamp(),active:true});};
  $('#ab').onclick=add;
  $('#nt').onkeydown=e=>{if(e.key==='Enter')add();};
}
// END
