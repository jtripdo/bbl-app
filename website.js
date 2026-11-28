// Team app → Website (managers): weekly special and Instagram posts shown on the website.
import {db,S,$,esc,setView,topbar,doc,getDoc,setDoc,serverTimestamp} from './core.js';
import {takePhoto} from './photo.js';

const sunday=()=>{const d=new Date();d.setDate(d.getDate()+((7-d.getDay())%7));return d.toLocaleDateString('en-CA');};

export async function showWebsite(){
  setView(topbar('Website')+`<p class="mut small">What shows on buttermilkbiscuitlab.com, the kiosk and online ordering. Changes go live right away.</p>
  <div class="sec">Weekly special</div>
  <div class="card">
    <label class="ib" style="gap:8px;margin-bottom:8px"><input type="checkbox" id="on" style="width:auto"> Show the special</label>
    <input id="ti" placeholder="Name (e.g. The Hot Honey Hog)" maxlength="50">
    <textarea id="de" rows="3" maxlength="240" placeholder="One or two mouth-watering lines"></textarea>
    <div class="two"><input id="pr" placeholder="Price (e.g. $14)" maxlength="20"><input id="en" type="date"></div>
    <select id="wh"><option value="order">Button: Order online</option><option value="popups">Button: See the pop-up calendar</option><option value="none">No button</option></select>
    <div style="display:flex;gap:10px;align-items:center;margin:8px 0"><img id="pv" style="width:72px;height:72px;object-fit:cover;border-radius:12px;display:none"><button class="btn ghost sm" id="ph">📷 Add a photo</button><button class="link" id="phx" style="display:none">Remove photo</button></div>
    <label class="ib" style="gap:8px"><input type="checkbox" id="cd" style="width:auto" checked> Show a countdown to the end date</label>
    <button class="btn full" id="sv">Save special</button><p id="msg" class="small"></p>
  </div>
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
  $('#sv').onclick=async()=>{
    if($('#on').checked&&!$('#ti').value.trim()){alert('Give the special a name.');return;}
    await setDoc(doc(db,'site','special'),{on:$('#on').checked,title:$('#ti').value.trim(),desc:$('#de').value.trim(),price:$('#pr').value.trim(),ends:$('#en').value,cta:$('#wh').value,countdown:$('#cd').checked,img,by:S.me,at:serverTimestamp()});
    $('#msg').innerHTML='<span style="color:var(--ok)">Saved. It\'s live.</span>';
  };
  $('#ig').value=((ig.exists()&&ig.data().posts)||[]).join('\n');
  $('#igs').onclick=async()=>{
    const posts=[...new Set($('#ig').value.split(/\s+/).map(u=>u.trim()).filter(u=>/^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/.test(u)).map(u=>u.split('?')[0].replace(/\/?$/,'/')))].slice(0,6);
    await setDoc(doc(db,'site','instagram'),{posts,by:S.me,at:serverTimestamp()});
    $('#ig').value=posts.join('\n');$('#igm').innerHTML=`<span style="color:var(--ok)">Saved ${posts.length} post${posts.length===1?'':'s'}.</span>`;
  };
}
