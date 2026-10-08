import {EMAIL} from './config.js';
import {dlabel,dstr} from './core.js';

const tm=ts=>{try{return ts.toDate().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(e){return '';}};
const fm=n=>Math.round(n*100)/100;

async function post(subject,message){
  if(!EMAIL||!EMAIL.serviceId||EMAIL.serviceId.startsWith('PASTE'))throw new Error('Email is not set up yet');
  const r=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({service_id:EMAIL.serviceId,template_id:EMAIL.templateId,user_id:EMAIL.publicKey,template_params:{subject,message}})
  });
  if(!r.ok)throw new Error(await r.text());
}

export async function sendReport(title,key,items,checks){
  const done=items.filter(i=>checks[i.id]);
  const names=[...new Set(done.map(i=>checks[i.id].by))];
  const last=done.map(i=>checks[i.id].at).filter(Boolean).sort((a,b)=>a.toMillis()-b.toMillis()).pop();
  const lines=items.map(i=>{const c=checks[i.id];return (c?'✓ ':'✗ ')+i.text+(c?' — '+c.by+', '+tm(c.at):' — NOT DONE');});
  const message=title+' — '+dlabel(key)+'\nCompleted by: '+names.join(', ')+'\nFinished at: '+(last?tm(last):'')+'\n'+done.length+' of '+items.length+' tasks done\n\n'+lines.join('\n');
  await post(title+' report — '+dlabel(key),message);
}

export async function sendParReport(by,entries){
  const now=new Date();
  const when=now.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const day=dlabel(dstr(now));
  const need=entries.filter(e=>e.onHand!==null&&e.need>0);
  const ok=entries.filter(e=>e.onHand!==null&&e.need===0);
  const miss=entries.filter(e=>e.onHand===null);
  const bySec={};
  need.forEach(e=>{(bySec[e.section]=bySec[e.section]||[]).push(e);});
  let m='Par Sheet — '+day+'\nSubmitted by: '+by+' at '+when+'\n\n';
  m+='NEED ('+need.length+' item'+(need.length===1?'':'s')+')\n';
  if(!need.length)m+='Nothing needed. Everything counted is at or above par.\n';
  Object.keys(bySec).forEach(s=>{
    m+='\n'+s.toUpperCase()+'\n';
    bySec[s].forEach(e=>{m+='• '+e.item+': need '+fm(e.need)+' '+e.unit+' (have '+fm(e.onHand)+', par '+fm(e.par)+')\n';});
  });
  if(ok.length){m+='\nAT OR ABOVE PAR ('+ok.length+')\n';ok.forEach(e=>{m+='✓ '+e.item+': have '+fm(e.onHand)+', par '+fm(e.par)+' '+e.unit+'\n';});}
  if(miss.length){m+='\nNOT COUNTED ('+miss.length+')\n';miss.forEach(e=>{m+='? '+e.item+'\n';});}
  await post('Par Sheet — '+day+' — '+by,m);
}
// END
