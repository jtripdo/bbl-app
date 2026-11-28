// Shift handoff notes: what the next shift needs to know. Shows on Today until each person taps "Got it".
import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,getDoc,setDoc,addDoc,updateDoc,onSnapshot,query,where,serverTimestamp,arrayUnion} from './core.js';
import {takePhoto,viewPhoto} from './photo.js';

const when=ms=>new Date(ms).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});
export const unseen=(notes)=>notes.filter(n=>n.by!==S.me&&!(n.seenBy||[]).includes(S.me)&&Date.now()-n.at<36*3600000);
export function noteCard(n){
  return `<div class="card" style="box-shadow:inset 4px 0 0 var(--acc),var(--shadow)"><div class="mut small">${esc(n.by)} · ${when(n.at)}${n.shift?' · '+esc(n.shift):''}</div>
    <div style="white-space:pre-wrap;margin:6px 0">${esc(n.text)}</div>
    ${n.hasPhoto?`<button class="link" data-hph="${n.id}">📷 View photo</button> `:''}
    ${n.by!==S.me&&!(n.seenBy||[]).includes(S.me)?`<button class="btn sm" data-seen="${n.id}">Got it</button>`:`<span class="mut small">${(n.seenBy||[]).length?'Seen by '+esc(n.seenBy.join(', ')):'Not seen yet'}</span>`}</div>`;
}
export async function handleNoteClick(e){
  const s=e.target.closest('[data-seen]');
  if(s){s.disabled=true;await updateDoc(doc(db,'handoffs',s.dataset.seen),{seenBy:arrayUnion(S.me)});return true;}
  const p=e.target.closest('[data-hph]');
  if(p){const d=await getDoc(doc(db,'handoffPhotos',p.dataset.hph));if(d.exists())viewPhoto(d.data().img);return true;}
  return false;
}

export function showHandoff(){
  setView(topbar('Shift Handoff')+`<p class="mut small">Leave a note for the next shift: what's low, what's prepped, anything broken, special orders. It shows on everyone's Today screen until they tap "Got it."</p>
    <div class="card"><select id="hs"><option>Opening → Mid</option><option>Mid → Closing</option><option>Closing → Opening</option><option value="">Other</option></select>
    <textarea id="ht" rows="5" maxlength="1500" placeholder="e.g. Out of hot honey, used the last of the cream. Walk-in door sticks, push hard. Catering for 40 picks up at 10:30."></textarea>
    <div style="display:flex;gap:8px;align-items:center"><button class="btn ghost sm" id="hp">📷 Add a photo</button><span id="hpn" class="mut small"></span></div>
    <button class="btn full" id="hgo">Post note</button></div>
    <div class="sec">Recent notes</div><div id="hl"><p class="mut small">Loading…</p></div>`);
  let photo=null,notes=[];
  $('#hp').onclick=async()=>{try{photo=await takePhoto();$('#hpn').textContent=photo?'Photo added ✓':'';}catch(e){alert(e.message);}};
  $('#hgo').onclick=async()=>{
    const text=$('#ht').value.trim();if(!text){alert('Write a note first.');return;}
    $('#hgo').disabled=true;
    const ref=await addDoc(collection(db,'handoffs'),{text,shift:$('#hs').value,by:S.me,at:Date.now(),seenBy:[],hasPhoto:!!photo});
    if(photo)await setDoc(doc(db,'handoffPhotos',ref.id),{img:photo,by:S.me,at:serverTimestamp()});
    $('#ht').value='';photo=null;$('#hpn').textContent='';$('#hgo').disabled=false;
  };
  sub(onSnapshot(query(collection(db,'handoffs'),where('at','>=',Date.now()-7*86400000)),s=>{
    notes=s.docs.map(dd).sort((a,b)=>b.at-a.at);
    $('#hl').innerHTML=notes.length?notes.map(noteCard).join(''):'<p class="mut small">No notes this week.</p>';
  }));
  $('#hl').onclick=handleNoteClick;
}
// END
