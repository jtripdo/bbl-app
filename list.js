import {db,S,$,esc,sub,today,fmt,dd,setView,topbar,collection,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,where,serverTimestamp} from './core.js';

export function showList(scope,title,opt={}){
  const key=opt.key||today();
  const pre=scope+'__'+key+'__';
  setView(topbar(title,opt.back||'dash')+`<div class="mut" id="prog"></div><div id="items"></div><div class="addrow"><input id="nt" placeholder="${esc(opt.ph||'Add an item')}" maxlength="200"><button class="btn" id="ab">Add</button></div>${opt.note?`<p class="mut small">${esc(opt.note)}</p>`:''}`);
  let items=[],checks={};
  const draw=()=>{
    const done=items.filter(i=>checks[i.id]).length;
    $('#prog').textContent=items.length?`${done} of ${items.length} done`:'';
    $('#items').innerHTML=items.length?items.map(i=>{
      const c=checks[i.id];
      return `<div class="row${c?' done':''}" data-t="${i.id}"><div class="chk">${c?'✓':''}</div><div class="txt">${esc(i.text)}${c?`<div class="who">${esc(c.by)} · ${fmt(c.at)}</div>`:''}</div><button class="x" data-rm="${i.id}" aria-label="Remove">✕</button></div>`;
    }).join(''):'<p class="mut center">Nothing here yet. Add the first item below.</p>';
  };
  sub(onSnapshot(query(collection(db,'listItems'),where('scope','==',scope)),s=>{
    items=s.docs.map(dd).filter(i=>i.active!==false).sort((a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0));
    draw();
  }));
  sub(onSnapshot(query(collection(db,'checks'),where('key','==',scope+'|'+key)),s=>{
    checks={};s.docs.map(dd).forEach(c=>{checks[c.itemId]=c;});
    draw();
  }));
  $('#items').onclick=e=>{
    const rm=e.target.closest('[data-rm]');
    if(rm){if(confirm('Remove this item from the list?'))updateDoc(doc(db,'listItems',rm.dataset.rm),{active:false});return;}
    const row=e.target.closest('[data-t]');if(!row)return;
    const id=row.dataset.t,ref=doc(db,'checks',pre+id);
    if(checks[id]){if(confirm('Undo this check?'))deleteDoc(ref);}
    else setDoc(ref,{key:scope+'|'+key,itemId:id,by:S.me,at:serverTimestamp()});
  };
  const add=()=>{
    const t=$('#nt').value.trim();if(!t)return;$('#nt').value='';
    addDoc(collection(db,'listItems'),{scope,text:t,by:S.me,at:serverTimestamp(),active:true});
  };
  $('#ab').onclick=add;
  $('#nt').onkeydown=e=>{if(e.key==='Enter')add();};
}
// END
