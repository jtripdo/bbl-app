import {db,$,esc,sub,today,dstr,fmt,dd,dlabel,t12,setView,collection,onSnapshot,query,where,orderBy,limit} from './core.js';
import {icon} from './icons.js';

export function showToday(){
  const t=today();
  const lists=[['opening','Opening','sun','opening'],['closing','Closing','moon','closing'],['cleaning','Cleaning','sparkles','cleaning'],['prep_'+t,'Prep Sheet','chef','prep']];
  const scopes=lists.map(l=>l[0]);
  let items=[],checks=[],events=[],needs=0,lastPar=null;
  setView(`<div class="top"><button class="back" data-go="dash">← Menu</button><h2>Today</h2></div>
  <p class="mut">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p>
  <div class="sec">Events</div><div id="te"><p class="mut small">Loading...</p></div>
  <div class="sec">Checklists</div><div id="tl"></div>
  <div class="sec">Other</div><div id="to"></div>`);

  const evCard=e=>`<div class="card"><div class="mut small">${e.date===t?'Today':dlabel(e.date)}${e.time?' · '+t12(e.time):''}</div><b>${esc(e.title)}</b>${e.location?`<div class="small mut ib">${icon('pin',14)} ${esc(e.location)}</div>`:''}<div><button class="btn sm" data-go="load" data-arg="${e.id}" data-title="${esc(e.title)}">Load Out Sheet</button></div></div>`;

  const draw=()=>{
    if(!$('#te'))return;
    const todays=events.filter(e=>e.date===t);
    const soon=events.filter(e=>e.date>t).slice(0,3);
    $('#te').innerHTML=(todays.length?todays.map(evCard).join(''):'<p class="mut small">No events today.</p>')+(soon.length?'<div class="sec">Coming up</div>'+soon.map(evCard).join(''):'');

    const doneIds=new Set(checks.map(c=>c.key+'#'+c.itemId));
    $('#tl').innerHTML=lists.map(l=>{
      const its=items.filter(i=>i.scope===l[0]);
      const left=its.filter(i=>!doneIds.has(l[0]+'|'+t+'#'+i.id));
      const n=its.length,dn=n-left.length;
      const status=n?(left.length?dn+' of '+n+' done':`<span class="ib okc">${icon('check',16)} All done</span>`):'No items yet';
      return `<div class="card" data-go="${l[3]}"><div class="ih"><b class="ib">${icon(l[2],18)} ${l[1]}</b><span class="small ${left.length||!n?'mut':''}">${status}</span></div>${left.slice(0,4).map(i=>`<div class="hl">${esc(i.text)}</div>`).join('')}${left.length>4?`<div class="mut small">+${left.length-4} more</div>`:''}</div>`;
    }).join('');

    const parDone=lastPar&&lastPar.at&&lastPar.at.toDate&&dstr(lastPar.at.toDate())===t;
    $('#to').innerHTML=`<div class="card" data-go="par"><div class="ih"><b class="ib">${icon('box',18)} Par Sheet</b><span class="small ${parDone?'':'mut'}">${parDone?`<span class="ib okc">${icon('check',16)} Done today</span>`:'Not done yet today'}</span></div>${lastPar?`<div class="who">Last submitted: ${esc(lastPar.by)} · ${fmt(lastPar.at)}</div>`:''}</div>
    <div class="card" data-go="needs"><div class="ih"><b class="ib">${icon('cart',18)} Needs and Wants</b><span class="small">${needs} open</span></div></div>`;
  };

  sub(onSnapshot(query(collection(db,'listItems'),where('scope','in',scopes)),s=>{
    items=s.docs.map(dd).filter(i=>i.active!==false).sort((a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0));draw();
  }));
  sub(onSnapshot(query(collection(db,'checks'),where('key','in',scopes.map(x=>x+'|'+t))),s=>{
    checks=s.docs.map(dd);draw();
  }));
  sub(onSnapshot(collection(db,'events'),s=>{
    events=s.docs.map(dd).filter(e=>e.active!==false&&e.date&&e.date>=t).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));draw();
  }));
  sub(onSnapshot(query(collection(db,'needs'),where('done','==',false)),s=>{
    needs=s.size;draw();
  }));
  sub(onSnapshot(query(collection(db,'parSheets'),orderBy('at','desc'),limit(1)),s=>{
    lastPar=s.docs.length?dd(s.docs[0]):null;draw();
  }));
}
// END
