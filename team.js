import {db,S,$,esc,sub,fmt,dd,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,query,orderBy,limit,serverTimestamp} from './core.js';

export function showChat(){
  setView(topbar('Team Chat')+`<div id="msgs" class="msgs"></div><div class="addrow"><input id="mt" placeholder="Message the team" maxlength="500"><button class="btn" id="ms">Send</button></div>`);
  let first=true;
  sub(onSnapshot(query(collection(db,'chat'),orderBy('at','desc'),limit(100)),s=>{
    const m=s.docs.map(dd).reverse();const box=$('#msgs');
    const stick=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
    box.innerHTML=m.length?m.map(x=>`<div class="msg${x.by===S.me?' me':''}"><div class="mh">${esc(x.by)} · ${fmt(x.at)}</div><div>${esc(x.text)}</div></div>`).join(''):'<p class="mut center">No messages yet. Say hi!</p>';
    if(stick||first)box.scrollTop=box.scrollHeight;
    first=false;
  }));
  const send=()=>{
    const t=$('#mt').value.trim();if(!t)return;$('#mt').value='';
    addDoc(collection(db,'chat'),{by:S.me,text:t,at:serverTimestamp()});
  };
  $('#ms').onclick=send;
  $('#mt').onkeydown=e=>{if(e.key==='Enter')send();};
}

export function showNeeds(){
  setView(topbar('Needs & Wants')+`<div><div class="two kt"><select id="nk"><option value="need">Need</option><option value="want">Want</option></select><input id="nx" placeholder="What is it?" maxlength="200"></div><button class="btn" id="na">Add</button></div><div class="sec">Open</div><div id="open"></div><div class="sec">Done</div><div id="dn"></div>`);
  sub(onSnapshot(query(collection(db,'needs'),orderBy('at','desc'),limit(100)),s=>{
    const all=s.docs.map(dd);
    const open=all.filter(n=>!n.done),done=all.filter(n=>n.done).slice(0,15);
    $('#open').innerHTML=open.length?open.map(n=>`<div class="card"><span class="tag ${n.kind==='want'?'want':''}">${n.kind==='want'?'WANT':'NEED'}</span> ${esc(n.text)}<div class="who">Added by ${esc(n.by)} · ${fmt(n.at)}</div><button class="btn sm" data-done="${n.id}">Mark done</button></div>`).join(''):'<p class="mut center">Nothing open.</p>';
    $('#dn').innerHTML=done.length?done.map(n=>`<div class="card dim"><s>${esc(n.text)}</s><div class="who">Done by ${esc(n.doneBy)} · ${fmt(n.doneAt)}</div></div>`).join(''):'<p class="mut center">Nothing done yet.</p>';
  }));
  $('#open').onclick=e=>{
    const b=e.target.closest('[data-done]');
    if(b)updateDoc(doc(db,'needs',b.dataset.done),{done:true,doneBy:S.me,doneAt:serverTimestamp()});
  };
  const add=()=>{
    const t=$('#nx').value.trim();if(!t)return;
    addDoc(collection(db,'needs'),{kind:$('#nk').value,text:t,by:S.me,at:serverTimestamp(),done:false});
    $('#nx').value='';
  };
  $('#na').onclick=add;
  $('#nx').onkeydown=e=>{if(e.key==='Enter')add();};
}
// END
