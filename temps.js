// Temperature logs: coolers/freezers/hot holding checks with corrective actions,
// plus a cooling log (135°F → 70°F within 2 hours, → 41°F within 6 hours total).
import {db,S,$,esc,sub,today,dd,dlabel,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,query,where,serverTimestamp} from './core.js';

const DUE_HOURS=4;
const ACTIONS=['Adjusted the thermostat','Moved food to another unit','Discarded the food','Reheated to 165°F','Closed the door / checked the seal','Called for repair'];
const STD=[{name:'Walk-in cooler',max:41},{name:'Reach-in cooler',max:41},{name:'Freezer',max:0},{name:'Hot holding',min:135}];
const isMgr=()=>S.role==='owner'||S.role==='manager';
const ok=(u,t)=>(u.min==null||t>=u.min)&&(u.max==null||t<=u.max);
const rangeTxt=u=>u.min!=null&&u.max!=null?`${u.min}–${u.max}°F`:u.max!=null?`${u.max}°F or below`:u.min!=null?`${u.min}°F or above`:'';
const hm=ms=>new Date(ms).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const ago=ms=>{const m=Math.round((Date.now()-ms)/60000);return m<60?`${m} min ago`:`${Math.floor(m/60)} hr ${m%60} min ago`;};
const STYLE=`<style>
.tp-u{display:flex;align-items:center;gap:12px;background:var(--card);border-radius:16px;padding:14px;margin-bottom:8px;box-shadow:var(--shadow)}
.tp-u .t{flex:1}.tp-u .v{font-size:26px;font-weight:800}
.tp-u.bad{box-shadow:inset 4px 0 0 #ef8a6f,var(--shadow)}.tp-u.due{box-shadow:inset 4px 0 0 var(--acc),var(--shadow)}
.bad{color:#ef8a6f}.warn{color:var(--acc)}.good{color:var(--ok)}
.tp-sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:20}
.tp-sheet>div{background:var(--bg);width:min(520px,100vw);border-radius:22px 22px 0 0;padding:20px 18px calc(20px + env(safe-area-inset-bottom));max-height:90vh;overflow:auto}
.tp-big{font-size:40px;text-align:center;font-weight:800}
.tp-h td{padding:7px 4px;border-top:1px solid var(--line);font-size:14px;vertical-align:top}
</style>`;

export function lastByUnit(logs){const m={};logs.forEach(l=>{if(!m[l.unitId]||l.at>m[l.unitId].at)m[l.unitId]=l;});return m;}
export function unitStatus(u,last){if(!last)return 'due';if(!last.ok)return 'bad';if(Date.now()-last.at>DUE_HOURS*3600000)return 'due';return 'ok';}

export function showTemps(){
  setView(STYLE+topbar('Temperature Log')+`<p class="mut small">Check each unit at least every ${DUE_HOURS} hours. Coolers 41°F or below, freezers 0°F or below, hot holding 135°F or above.</p>
    <div id="units"><p class="mut">Loading…</p></div>
    <div class="sec">Cooling log</div><div id="cool"></div>
    <button class="btn ghost full" id="coolNew">+ Start cooling something</button>
    <div class="sec">Readings</div><input type="date" id="day" value="${today()}"><div id="hist"></div>
    ${isMgr()?`<details class="add" id="edit"><summary>Set up units (managers)</summary><div id="editBody"></div></details>`:''}`);
  let units=[],logs=[],cools=[];
  const day=()=>$('#day').value||today();
  const draw=()=>{
    const last=lastByUnit(logs);
    $('#units').innerHTML=units.length?units.map(u=>{const l=last[u.id],st=unitStatus(u,l);return `<div class="tp-u ${st==='ok'?'':st}" data-u="${u.id}"><div class="t"><b>${esc(u.name)}</b><div class="small ${st==='bad'?'bad':st==='due'?'warn':'mut'}">${rangeTxt(u)} · ${l?`${st==='bad'?'OUT OF RANGE · ':''}${ago(l.at)} by ${esc(l.by)}`:'No reading yet today'}${st==='due'&&l?' · check due':''}</div></div><div class="v ${st==='bad'?'bad':''}">${l?l.temp+'°':'—'}</div></div>`;}).join('')
      :(isMgr()?'<p class="mut">No units yet.</p><button class="btn" id="seed">Add walk-in, reach-in, freezer and hot holding</button>':'<p class="mut">No units yet. Ask a manager to set them up.</p>');
    const seed=$('#seed');if(seed)seed.onclick=async()=>{for(const u of STD)await addDoc(collection(db,'tempUnits'),{...u,active:true,by:S.me,at:serverTimestamp()});};
    const dl=logs.filter(l=>l.day===day()).sort((a,b)=>b.at-a.at);
    $('#hist').innerHTML=dl.length?`<div class="card"><table style="width:100%;border-collapse:collapse" class="tp-h">${dl.map(l=>`<tr><td>${hm(l.at)}</td><td>${esc(l.unitName)}${l.action?`<div class="small warn">${esc(l.action)}</div>`:''}</td><td class="${l.ok?'':'bad'}" style="text-align:right;font-weight:700">${l.temp}°F</td><td class="mut small" style="text-align:right">${esc(l.by)}</td></tr>`).join('')}</table></div>`:'<p class="mut small">No readings this day.</p>';
    const open=cools.filter(c=>c.status==='open');
    $('#cool').innerHTML=open.length?open.map(c=>{
      const at2=c.startAt+2*3600000,at6=c.startAt+6*3600000;
      const step=!c.check2?['2-hour check: must be 70°F or below',at2,'check2']:['Final check: must be 41°F or below',at6,'check6'];
      const late=Date.now()>step[1];
      return `<div class="tp-u ${late?'bad':''}"><div class="t"><b>${esc(c.item)}</b><div class="small mut">Started ${hm(c.startAt)} at ${c.startTemp}°F by ${esc(c.by)}${c.check2?` · 2 hr: ${c.check2.temp}°F`:''}</div><div class="small ${late?'bad':'warn'}">${step[0]} by ${hm(step[1])}${late?' · LATE':''}</div></div><button class="btn sm" data-ck="${c.id}" data-step="${step[2]}">Log</button></div>`;}).join(''):'<p class="mut small">Nothing cooling right now.</p>';
    if(isMgr()&&$('#editBody'))$('#editBody').innerHTML=units.map(u=>`<div class="two" style="align-items:center"><input data-en="${u.id}" value="${esc(u.name)}" maxlength="30"><div class="two"><input data-emin="${u.id}" inputmode="numeric" placeholder="min °F" value="${u.min??''}"><input data-emax="${u.id}" inputmode="numeric" placeholder="max °F" value="${u.max??''}"></div></div>`).join('')+`<button class="btn sm" id="esave">Save</button> <button class="btn ghost sm" id="eadd">+ Add a unit</button>`;
    const es=$('#esave');if(es)es.onclick=async()=>{for(const u of units){const n=document.querySelector(`[data-en="${u.id}"]`).value.trim();const mn=document.querySelector(`[data-emin="${u.id}"]`).value.trim(),mx=document.querySelector(`[data-emax="${u.id}"]`).value.trim();await updateDoc(doc(db,'tempUnits',u.id),{name:n||u.name,min:mn===''?null:Number(mn),max:mx===''?null:Number(mx)});}alert('Saved.');};
    const ea=$('#eadd');if(ea)ea.onclick=async()=>{const n=prompt('Name of the unit (e.g. Prep cooler 2)');if(n)await addDoc(collection(db,'tempUnits'),{name:n.trim().slice(0,30),max:41,active:true,by:S.me,at:serverTimestamp()});};
  };
  sub(onSnapshot(collection(db,'tempUnits'),s=>{units=s.docs.map(dd).filter(u=>u.active!==false).sort((a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0));draw();}));
  const since=Date.now()-14*86400000;
  sub(onSnapshot(query(collection(db,'tempLogs'),where('at','>=',since)),s=>{logs=s.docs.map(dd);draw();}));
  sub(onSnapshot(query(collection(db,'coolLogs'),where('status','==','open')),s=>{cools=s.docs.map(dd);draw();}));
  $('#day').onchange=draw;
  const tick=setInterval(()=>{if(!document.getElementById('units'))return clearInterval(tick);draw();},60000);
  $('#units').onclick=e=>{const r=e.target.closest('[data-u]');if(r)logReading(units.find(u=>u.id===r.dataset.u));};
  $('#coolNew').onclick=()=>sheet(`<h2 style="margin:0 0 8px">Start cooling</h2><input id="ci" placeholder="What is it? (e.g. Sausage gravy, 2 hotel pans)" maxlength="60"><input id="ct" inputmode="numeric" placeholder="Starting temp °F (135 or above)"><button class="btn full" id="cgo">Start the clock</button>`,w=>{
    w.querySelector('#cgo').onclick=async()=>{const item=w.querySelector('#ci').value.trim(),t=Number(w.querySelector('#ct').value);if(!item||!isFinite(t)||w.querySelector('#ct').value===''){alert('Enter the item and its starting temperature.');return;}
      await addDoc(collection(db,'coolLogs'),{item,startTemp:t,startAt:Date.now(),by:S.me,status:'open',day:today()});w.remove();};
  });
  $('#cool').onclick=e=>{const b=e.target.closest('[data-ck]');if(!b)return;const c=cools.find(x=>x.id===b.dataset.ck),step=b.dataset.step,limit=step==='check2'?70:41;
    sheet(`<h2 style="margin:0 0 4px">${esc(c.item)}</h2><p class="mut small">${step==='check2'?'Must be 70°F or below within 2 hours.':'Must be 41°F or below within 6 hours of the start.'}</p><input id="kt" inputmode="numeric" placeholder="Temperature °F" class="tp-big"><button class="btn full" id="kgo">Save</button>`,w=>{
      w.querySelector('#kgo').onclick=async()=>{const v=w.querySelector('#kt').value;if(v===''){return;}const t=Number(v);const passed=t<=limit;
        const late=Date.now()>c.startAt+(step==='check2'?2:6)*3600000;
        let action='';
        if(!passed||late){action=prompt(`${!passed?`${t}°F is above ${limit}°F`:'This check is late'}. What did you do? (e.g. Reheated to 165°F and restarted, Discarded)`)||'';if(!action){alert('Please note what you did.');return;}}
        const upd={[step]:{temp:t,at:Date.now(),by:S.me,ok:passed&&!late,action}};
        if(step==='check6'||!passed||late)upd.status=passed&&!late?'done':'failed';
        await updateDoc(doc(db,'coolLogs',c.id),upd);w.remove();};
    });
  };
}

function sheet(html,bind){
  const w=document.createElement('div');w.className='tp-sheet';
  w.innerHTML=`<div>${html}<button class="link full" data-x>Cancel</button></div>`;
  w.onclick=e=>{if(e.target===w||e.target.closest('[data-x]'))w.remove();};
  document.body.appendChild(w);bind(w);
  const f=w.querySelector('input');if(f)setTimeout(()=>f.focus(),50);
}

function logReading(u){
  if(!u)return;
  sheet(`<h2 style="margin:0 0 4px">${esc(u.name)}</h2><p class="mut small">Safe: ${rangeTxt(u)}</p>
    <input id="tv" inputmode="decimal" placeholder="°F" class="tp-big">
    <div id="act" class="hide"><p class="bad small"><b>Out of range.</b> What did you do about it?</p>
      <select id="as"><option value="">Choose one…</option>${ACTIONS.map(a=>`<option>${esc(a)}</option>`).join('')}<option value="other">Something else…</option></select>
      <input id="ao" class="hide" placeholder="What you did" maxlength="120"></div>
    <button class="btn full" id="tgo">Save reading</button>`,w=>{
    const tv=w.querySelector('#tv'),act=w.querySelector('#act'),as=w.querySelector('#as'),ao=w.querySelector('#ao');
    tv.oninput=()=>{const t=Number(tv.value);act.classList.toggle('hide',tv.value===''||ok(u,t));};
    as.onchange=()=>ao.classList.toggle('hide',as.value!=='other');
    w.querySelector('#tgo').onclick=async()=>{
      if(tv.value===''||!isFinite(Number(tv.value))){alert('Enter the temperature.');return;}
      const t=Math.round(Number(tv.value)*10)/10,good=ok(u,t);
      const action=good?'':(as.value==='other'?ao.value.trim():as.value);
      if(!good&&!action){alert('Out of range: please choose what you did about it.');return;}
      await addDoc(collection(db,'tempLogs'),{unitId:u.id,unitName:u.name,temp:t,ok:good,action,min:u.min??null,max:u.max??null,by:S.me,at:Date.now(),day:today()});
      w.remove();
    };
  });
}
// END
