// "Heads up": things the team should deal with now. Used by Today and the home screen.
import {db,S,sub,dd,collection,onSnapshot,query,where} from './core.js';
import {unseen} from './handoff.js';
import {lastByUnit,unitStatus} from './temps.js';

// Calls cb(list) whenever anything changes. Each item: {level:'bad'|'warn', text, go}
export function watchAlerts(cb){
  let notes=[],units=[],logs=[],cools=[],labels=[];
  const run=()=>{
    const out=[];
    const n=unseen(notes);
    if(n.length)out.push({level:'warn',text:`${n.length} shift note${n.length>1?'s':''} for you`,go:'handoff',notes:n});
    const last=lastByUnit(logs);
    units.forEach(u=>{const st=unitStatus(u,last[u.id]);if(st==='bad')out.push({level:'bad',text:`${u.name} was out of range at last check`,go:'temps'});});
    const due=units.filter(u=>unitStatus(u,last[u.id])==='due');
    if(due.length)out.push({level:'warn',text:`Temp check due: ${due.map(u=>u.name).join(', ')}`,go:'temps'});
    cools.forEach(c=>{const lim=c.startAt+(c.check2?6:2)*3600000;if(Date.now()>lim)out.push({level:'bad',text:`Cooling check late: ${c.item}`,go:'temps'});else if(lim-Date.now()<20*60000)out.push({level:'warn',text:`Cooling check due soon: ${c.item}`,go:'temps'});});
    const eod=new Date();eod.setHours(23,59,59,999);
    const expired=labels.filter(l=>l.useBy<Date.now()),todayL=labels.filter(l=>l.useBy>=Date.now()&&l.useBy<=eod.getTime());
    if(expired.length)out.push({level:'bad',text:`${expired.length} labeled item${expired.length>1?'s':''} expired: ${[...new Set(expired.map(l=>l.name))].slice(0,3).join(', ')}`,go:'labels'});
    if(todayL.length)out.push({level:'warn',text:`Use today: ${[...new Set(todayL.map(l=>l.name))].slice(0,4).join(', ')}`,go:'labels'});
    cb(out);
  };
  sub(onSnapshot(query(collection(db,'handoffs'),where('at','>=',Date.now()-2*86400000)),s=>{notes=s.docs.map(dd);run();},()=>{}));
  sub(onSnapshot(collection(db,'tempUnits'),s=>{units=s.docs.map(dd).filter(u=>u.active!==false);run();},()=>{}));
  sub(onSnapshot(query(collection(db,'tempLogs'),where('at','>=',Date.now()-86400000)),s=>{logs=s.docs.map(dd);run();},()=>{}));
  sub(onSnapshot(query(collection(db,'coolLogs'),where('status','==','open')),s=>{cools=s.docs.map(dd);run();},()=>{}));
  sub(onSnapshot(query(collection(db,'prepLabels'),where('status','==','on')),s=>{labels=s.docs.map(dd);run();},()=>{}));
  const t=setInterval(()=>{if(!document.getElementById('view'))return clearInterval(t);run();},60000);
}
export function alertsHtml(list,esc){
  return list.map(a=>`<div class="card" data-go="${a.go}" style="box-shadow:inset 4px 0 0 ${a.level==='bad'?'#ef8a6f':'var(--acc)'},var(--shadow);padding:12px 14px;margin-bottom:8px"><b class="${a.level==='bad'?'bad':''}" style="${a.level==='bad'?'color:#ef8a6f':''}">${a.level==='bad'?'⚠️':'👀'} ${esc(a.text)}</b></div>`).join('');
}
