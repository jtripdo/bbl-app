// Team app → Website (managers): weekly special and Instagram posts shown on the website.
import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,getDoc,setDoc,updateDoc,deleteDoc,onSnapshot,serverTimestamp} from './core.js';
import {takePhoto} from './photo.js';

const sunday=()=>{const d=new Date();d.setDate(d.getDate()+((7-d.getDay())%7));return d.toLocaleDateString('en-CA');};

export async function showWebsite(){
  setView(topbar('Website')+`<p class="mut small">What shows on buttermilkbiscuitlab.com, the kiosk and online ordering. Changes go live right away.</p>
  <div class="sec">Weekly special</div>
  <div class="card" style="display:flex;align-items:center;gap:12px"><div style="flex:1"><b id="stT">…</b><div class="mut small" id="stS"></div></div><button class="btn" id="tog">…</button></div>
  <div class="card">
    <input type="checkbox" id="on" style="display:none">
    <input id="ti" placeholder="Name (e.g. The Hot Honey Hog)" maxlength="50">
    <textarea id="de" rows="3" maxlength="240" placeholder="One or two mouth-watering lines"></textarea>
    <div class="two"><input id="pr" placeholder="Price (e.g. $14)" maxlength="20"><input id="en" type="date"></div>
    <select id="wh"><option value="order">Button: Order online</option><option value="popups">Button: See the pop-up calendar</option><option value="none">No button</option></select>
    <div style="display:flex;gap:10px;align-items:center;margin:8px 0"><img id="pv" style="width:72px;height:72px;object-fit:cover;border-radius:12px;display:none"><button class="btn ghost sm" id="ph">📷 Add a photo</button><button class="link" id="phx" style="display:none">Remove photo</button></div>
    <label class="ib" style="gap:8px"><input type="checkbox" id="cd" style="width:auto" checked> Show a countdown to the end date</label>
    <button class="btn full" id="sv">Save special</button><p id="msg" class="small"></p>
  </div>
  <div class="sec">Saved specials</div><div id="lib"><p class="mut small">Specials you save show up here so you can run them again.</p></div>
  <div class="sec">Instagram on the home page</div>
  <div class="card"><p class="mut small">Paste links to up to 6 Instagram posts or reels from @welovebbl (Share → Copy link). They show as a row on the home page.</p>
    <textarea id="ig" rows="6" placeholder="https://www.instagram.com/p/…"></textarea>
    <button class="btn full" id="igs">Save posts</button><p id="igm" class="small"></p></div>`);
  let img='';
  const [sp,ig]=await Promise.all([getDoc(doc(db,'site','special')),getDoc(doc(db,'site','instagram'))]);
  const s=sp.exists()?sp.data():{};
  $('#on').checked=!!s.on;$('#ti').value=s.title||'';$('#de').value=s.desc||'';$('#pr').value=s.price||'';$('#en').value=s.ends||sunday();$('#wh').value=s.cta||'order';$('#cd').checked=s.countdown!==false;
  img=s.img||'';const showImg=()=>{$('#pv').style.display=img?'block':'none';$('#pv').src=img||'';$('#phx').style.display=img?'inline':'none';};showImg();
  $('#ph').onclick=async()=>{try{const p=await takePhoto();if(p){img=p;showImg();}}catch(e){alert(e.message);}};
  $('#phx').onclick=()=>{img='';showImg();};
  // One-tap on/off
  const status=()=>{
    const on=$('#on').checked,title=$('#ti').value.trim(),end=$('#en').value;
    const ended=end&&new Date(end+'T23:59:59').getTime()<Date.now();
    $('#stT').innerHTML=on&&!ended?`<span style="color:var(--ok)">● LIVE</span> ${esc(title)}`:`<span class="mut">● OFF</span>${title?' '+esc(title):''}`;
    $('#stS').textContent=on&&ended?'The end date has passed, so it isn\'t showing. Pick a new end date.':on?`Showing on the website, order page and kiosk${end?' until '+new Date(end+'T12:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}):''}.`:'Not showing anywhere.';
    $('#tog').textContent=on?'Turn off':'Turn on';
  };
  status();
  $('#tog').onclick=async()=>{
    const want=!$('#on').checked;
    if(want&&!$('#ti').value.trim()){alert('Fill in the special below first.');return;}
    if(want&&$('#en').value&&new Date($('#en').value+'T23:59:59').getTime()<Date.now())$('#en').value=sunday();
    $('#on').checked=want;
    await save(false);status();$('#msg').textContent='';
  };
  const save=async(toLib)=>{
    const d={on:$('#on').checked,title:$('#ti').value.trim(),desc:$('#de').value.trim(),price:$('#pr').value.trim(),ends:$('#en').value,cta:$('#wh').value,countdown:$('#cd').checked,img};
    await setDoc(doc(db,'site','special'),{...d,by:S.me,at:serverTimestamp()});
    if(toLib&&d.title){const id=d.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60);await setDoc(doc(db,'specials',id),{title:d.title,desc:d.desc,price:d.price,cta:d.cta,img:d.img,countdown:d.countdown,lastRun:Date.now(),by:S.me});}
  };
  $('#sv').onclick=async()=>{
    if(!$('#ti').value.trim()){alert('Give the special a name.');return;}
    await save(true);status();
    $('#msg').innerHTML=`<span style="color:var(--ok)">Saved${$('#on').checked?'. It\'s live.':'. Tap "Turn on" above when you\'re ready.'}</span>`;
  };
  // Saved specials library
  let lib=[];
  sub(onSnapshot(collection(db,'specials'),sn=>{lib=sn.docs.map(dd).sort((a,b)=>(b.lastRun||0)-(a.lastRun||0));
    $('#lib').innerHTML=lib.length?lib.map(x=>`<div class="card" style="display:flex;gap:10px;align-items:center">${x.img?`<img src="${x.img}" style="width:48px;height:48px;object-fit:cover;border-radius:10px">`:''}<div style="flex:1"><b>${esc(x.title)}</b><div class="mut small">${esc(x.price||'')}${x.lastRun?' · last run '+new Date(x.lastRun).toLocaleDateString():''}</div></div><button class="btn sm" data-use="${x.id}">Use</button><button class="x" data-del="${x.id}">✕</button></div>`).join(''):'<p class="mut small">Specials you save show up here so you can run them again.</p>';}));
  $('#lib').onclick=async e=>{
    const u=e.target.closest('[data-use]'),dl=e.target.closest('[data-del]');
    if(dl){if(confirm('Remove this saved special?'))await deleteDoc(doc(db,'specials',dl.dataset.del));return;}
    if(!u)return;const x=lib.find(y=>y.id===u.dataset.use);if(!x)return;
    $('#ti').value=x.title||'';$('#de').value=x.desc||'';$('#pr').value=x.price||'';$('#wh').value=x.cta||'order';$('#cd').checked=x.countdown!==false;img=x.img||'';showImg();$('#en').value=sunday();
    status();window.scrollTo(0,0);$('#msg').textContent='Loaded. Check the end date, then Save or Turn on.';
  };
  $('#ig').value=((ig.exists()&&ig.data().posts)||[]).join('\n');
  $('#igs').onclick=async()=>{
    const posts=[...new Set($('#ig').value.split(/\s+/).map(u=>u.trim()).filter(u=>/^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/.test(u)).map(u=>u.split('?')[0].replace(/\/?$/,'/')))].slice(0,6);
    await setDoc(doc(db,'site','instagram'),{posts,by:S.me,at:serverTimestamp()});
    $('#ig').value=posts.join('\n');$('#igm').innerHTML=`<span style="color:var(--ok)">Saved ${posts.length} post${posts.length===1?'':'s'}.</span>`;
  };
}
