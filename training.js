// Training: recipe cards (with batch scaling) and SOP cards (steps, photos, video),
// plus "I've got it" sign-offs so managers can see who's trained on what.
import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp} from './core.js';
import {takePhoto,viewPhoto} from './photo.js';

const isMgr=()=>S.role==='owner'||S.role==='manager';
const STYLE=`<style>
.tr-tabs{display:flex;gap:8px;margin-bottom:10px}.tr-tabs button{flex:1;background:var(--card);color:var(--ink);border:0;border-radius:999px;padding:10px;font-weight:700;box-shadow:var(--shadow)}
.tr-tabs button.on{background:var(--acc);color:#1a1208}
.tr-c{display:flex;align-items:center;gap:12px;background:var(--card);border-radius:16px;padding:13px 14px;margin-bottom:8px;box-shadow:var(--shadow)}
.tr-c .t{flex:1}.tr-ok{color:var(--ok);font-weight:800}
.tr-steps{counter-reset:s;padding:0;margin:0;list-style:none}
.tr-steps li{counter-increment:s;position:relative;padding:10px 0 10px 40px;border-top:1px solid var(--line)}
.tr-steps li:before{content:counter(s);position:absolute;left:0;top:9px;width:28px;height:28px;border-radius:50%;background:var(--acc);color:#1a1208;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px}
.tr-ph{display:flex;gap:8px;overflow-x:auto;margin:10px 0}.tr-ph img{height:110px;border-radius:12px;cursor:pointer}
.tr-x{display:flex;gap:6px;margin:8px 0}.tr-x button{flex:1;background:var(--card2);color:var(--ink);border:0;border-radius:999px;padding:8px;font-weight:700}
.tr-x button.on{background:var(--acc);color:#1a1208}
.tr-ing div{padding:7px 0;border-top:1px solid var(--line)}
</style>`;

// Scale the amount at the start of an ingredient line: "1 1/2 cups", "1/2 lb", "2.5 qt".
function scaleLine(line,k){
  if(k===1)return line;
  const m=line.match(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(.*)$/);
  if(!m)return line;
  const n=m[1].includes('/')?m[1].trim().split(/\s+/).reduce((a,p)=>a+(p.includes('/')?Number(p.split('/')[0])/Number(p.split('/')[1]):Number(p)),0):Number(m[1]);
  const v=Math.round(n*k*100)/100;
  const whole=Math.floor(v),frac=v-whole,F={0.25:'1/4',0.33:'1/3',0.5:'1/2',0.67:'2/3',0.75:'3/4'};
  const f=F[Math.round(frac*100)/100];
  const txt=frac<0.01?String(whole):f?(whole?`${whole} ${f}`:f):String(v);
  return txt+m[2];
}

export function showTraining(){
  setView(STYLE+topbar('Training')+`<div class="tr-tabs"><button data-tab="sop" class="on">How-to (SOPs)</button><button data-tab="recipe">Recipes</button></div>
    <input id="q" placeholder="Search" maxlength="40"><div id="list"><p class="mut">Loading…</p></div>
    ${isMgr()?`<button class="btn full" id="new">+ New card</button><div class="sec">Who's trained</div><div id="who"><p class="mut small">Loading…</p></div>`:''}`);
  let tab='sop',cards=[],done=[];
  const mine=id=>done.some(d=>d.cardId===id&&d.uid===S.uid);
  const draw=()=>{
    if(!$('#q')||!$('#list'))return;
    const q=($('#q').value||'').trim().toLowerCase();
    const list=cards.filter(c=>c.type===tab&&(!q||((c.title||'')+' '+(c.category||'')).toLowerCase().includes(q)));
    const g={};list.forEach(c=>{const k=c.category||'General';(g[k]=g[k]||[]).push(c);});
    $('#list').innerHTML=list.length?Object.keys(g).sort().map(k=>`<div class="sec">${esc(k)}</div>`+g[k].map(c=>`<div class="tr-c" data-open="${c.id}"><div class="t"><b>${esc(c.title)}</b><div class="mut small">${c.type==='recipe'?esc(c.yield||'Recipe'):`${(c.steps||'').split('\n').filter(x=>x.trim()).length} steps`}${c.video?' · ▶ video':''}${c.photoCount?` · 📷 ${c.photoCount}`:''}</div></div>${mine(c.id)?'<span class="tr-ok">✓</span>':'<span class="mut small">to learn</span>'}</div>`).join('')).join('')
      :`<p class="mut">${cards.some(c=>c.type===tab)?'Nothing matches.':isMgr()?'No cards yet. Tap "+ New card" to add one.':'No cards yet.'}</p>`;
    if(isMgr()&&$('#who')){
      const people={};done.forEach(d=>{(people[d.by]=people[d.by]||new Set()).add(d.cardId);});
      const total=cards.length;
      $('#who').innerHTML=Object.keys(people).length?`<div class="card">${Object.keys(people).sort().map(n=>`<div class="ih" style="padding:6px 0"><span>${esc(n)}</span><b>${[...people[n]].filter(id=>cards.some(c=>c.id===id)).length} / ${total}</b></div>`).join('')}</div>`:'<p class="mut small">No one has signed off on a card yet.</p>';
    }
  };
  sub(onSnapshot(collection(db,'training'),s=>{cards=s.docs.map(dd).filter(c=>c.active!==false).sort((a,b)=>(a.title||'').localeCompare(b.title||''));draw();}));
  sub(onSnapshot(collection(db,'trainingDone'),s=>{done=s.docs.map(dd);draw();}));
  document.querySelector('.tr-tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;tab=b.dataset.tab;[...b.parentNode.children].forEach(x=>x.classList.toggle('on',x===b));draw();};
  $('#q').oninput=draw;
  $('#list').onclick=e=>{const r=e.target.closest('[data-open]');if(r)showCard(r.dataset.open);};
  if(isMgr())$('#new').onclick=()=>editCard(null,tab);
}

async function showCard(id){
  setView(STYLE+topbar('Training','training')+`<div id="card"><p class="mut">Loading…</p></div>`);
  const [s,dn]=await Promise.all([getDoc(doc(db,'training',id)),getDoc(doc(db,'trainingDone',`${id}__${S.uid}`))]);
  if(!s.exists()){$('#card').innerHTML='<p class="mut">This card was removed.</p>';return;}
  const c={id,...s.data()};let k=1;
  const photos=[];for(let i=0;i<(c.photoCount||0);i++){const p=await getDoc(doc(db,'trainingPhotos',`${id}_${i}`));if(p.exists())photos.push(p.data().img);}
  const vid=c.video?`<a class="btn ghost full" href="${esc(c.video)}" target="_blank" rel="noopener">▶ Watch the video</a>`:'';
  const draw=()=>{
    $('#card').innerHTML=`<div class="card"><div class="mut small">${esc(c.category||'General')}${c.type==='recipe'&&c.yield?' · makes '+esc(c.yield):''}</div><h2 style="margin:4px 0 8px">${esc(c.title)}</h2>
      ${photos.length?`<div class="tr-ph">${photos.map((p,i)=>`<img src="${p}" data-ph="${i}">`).join('')}</div>`:''}${vid}
      ${c.type==='recipe'&&c.ingredients?`<div class="sec">Ingredients</div><div class="tr-x">${[0.5,1,2,3].map(x=>`<button data-k="${x}" class="${x===k?'on':''}">${x===0.5?'½':x}×</button>`).join('')}</div>
        <div class="tr-ing">${c.ingredients.split('\n').filter(x=>x.trim()).map(x=>`<div>${esc(scaleLine(x,k))}</div>`).join('')}</div>`:''}
      ${c.steps?`<div class="sec">${c.type==='recipe'?'Method':'Steps'}</div><ol class="tr-steps">${c.steps.split('\n').filter(x=>x.trim()).map(x=>`<li>${esc(x.replace(/^\s*\d+[.)]\s*/,''))}</li>`).join('')}</ol>`:''}
      ${c.notes?`<div class="sec">Good to know</div><div style="white-space:pre-wrap">${esc(c.notes)}</div>`:''}</div>
      ${dn.exists()?`<p class="center tr-ok">✓ You signed off ${new Date(dn.data().at).toLocaleDateString()}</p>`:`<button class="btn full" id="got">I've got it ✓</button>`}
      ${isMgr()?`<p class="center"><button class="link" id="ed">Edit</button> · <button class="link" id="rm">Remove</button></p>`:''}`;
  };
  draw();
  $('#card').onclick=async e=>{
    const kb=e.target.closest('[data-k]');if(kb){k=Number(kb.dataset.k);draw();return;}
    const ph=e.target.closest('[data-ph]');if(ph){viewPhoto(photos[Number(ph.dataset.ph)]);return;}
    if(e.target.id==='got'){await setDoc(doc(db,'trainingDone',`${id}__${S.uid}`),{cardId:id,uid:S.uid,by:S.me,at:Date.now()});showTraining();return;}
    if(e.target.id==='ed'){editCard(c,c.type,photos);return;}
    if(e.target.id==='rm'){if(confirm('Remove this card?')){await updateDoc(doc(db,'training',id),{active:false});showTraining();}}
  };
}

function editCard(c,type,existing=[]){
  const t=c?c.type:type;
  setView(STYLE+topbar(c?'Edit card':'New card','training')+`<div class="card">
    <select id="ty"><option value="sop">How-to (SOP)</option><option value="recipe">Recipe</option></select>
    <input id="ti" placeholder="Title (e.g. Opening the flat-top / Buttermilk biscuits)" maxlength="80">
    <div class="two"><input id="ca" list="cas" placeholder="Category (e.g. Opening, Line, Prep)" maxlength="30"><input id="yi" placeholder="Makes (e.g. 48 biscuits)" maxlength="40"></div>
    <datalist id="cas"><option value="Opening"><option value="Closing"><option value="Line"><option value="Prep"><option value="Cleaning"><option value="Food safety"><option value="Catering"><option value="Pop-ups"><option value="Register"></datalist>
    <textarea id="ing" rows="6" maxlength="3000" placeholder="Ingredients, one per line, amount first (e.g. 2 1/2 lb flour)"></textarea>
    <textarea id="st" rows="8" maxlength="5000" placeholder="Steps, one per line"></textarea>
    <textarea id="no" rows="3" maxlength="1500" placeholder="Good to know: allergens, shelf life, common mistakes (optional)"></textarea>
    <input id="vi" placeholder="Video link (YouTube, Instagram, Google Drive…) optional" maxlength="300">
    <div id="phs" class="tr-ph"></div><button class="btn ghost sm" id="ap">📷 Add a photo</button> <span class="mut small">up to 4</span>
    <button class="btn full" id="sv">Save card</button></div>`);
  let photos=[...existing];
  const drawPh=()=>{$('#phs').innerHTML=photos.map((p,i)=>`<span style="position:relative"><img src="${p}"><button class="x" data-rp="${i}" style="position:absolute;top:2px;right:2px">✕</button></span>`).join('');};
  $('#ty').value=t;$('#ti').value=c?c.title:'';$('#ca').value=c?c.category||'':'';$('#yi').value=c?c.yield||'':'';$('#ing').value=c?c.ingredients||'':'';$('#st').value=c?c.steps||'':'';$('#no').value=c?c.notes||'':'';$('#vi').value=c?c.video||'':'';
  const sync=()=>{const r=$('#ty').value==='recipe';$('#ing').style.display=r?'':'none';$('#yi').style.display=r?'':'none';};sync();$('#ty').onchange=sync;
  drawPh();
  $('#phs').onclick=e=>{const b=e.target.closest('[data-rp]');if(b){photos.splice(Number(b.dataset.rp),1);drawPh();}};
  $('#ap').onclick=async()=>{if(photos.length>=4){alert('Up to 4 photos.');return;}try{const p=await takePhoto();if(p){photos.push(p);drawPh();}}catch(e){alert(e.message);}};
  $('#sv').onclick=async()=>{
    const title=$('#ti').value.trim();if(!title){alert('Add a title.');return;}
    const vid=$('#vi').value.trim();
    if(vid&&!/^https:\/\//.test(vid)){alert('The video link should start with https://');return;}
    $('#sv').disabled=true;
    const d={type:$('#ty').value,title,category:$('#ca').value.trim(),yield:$('#yi').value.trim(),ingredients:$('#ing').value,steps:$('#st').value,notes:$('#no').value.trim(),video:vid,photoCount:photos.length,by:S.me,at:serverTimestamp(),active:true};
    let id=c&&c.id;
    if(id)await updateDoc(doc(db,'training',id),d);else id=(await addDoc(collection(db,'training'),d)).id;
    for(let i=0;i<photos.length;i++)await setDoc(doc(db,'trainingPhotos',`${id}_${i}`),{img:photos[i],cardId:id});
    for(let i=photos.length;i<(c?c.photoCount||0:0);i++)await deleteDoc(doc(db,'trainingPhotos',`${id}_${i}`));
    showCard(id);
  };
}
// END
