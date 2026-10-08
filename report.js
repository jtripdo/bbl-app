import {EMAIL} from './config.js';
import {dlabel} from './core.js';

const tm=ts=>{try{return ts.toDate().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}catch(e){return '';}};

export async function sendReport(title,key,items,checks){
  if(!EMAIL||!EMAIL.serviceId||EMAIL.serviceId.startsWith('PASTE'))throw new Error('Email is not set up yet');
  const done=items.filter(i=>checks[i.id]);
  const names=[...new Set(done.map(i=>checks[i.id].by))];
  const last=done.map(i=>checks[i.id].at).filter(Boolean).sort((a,b)=>a.toMillis()-b.toMillis()).pop();
  const lines=items.map(i=>{const c=checks[i.id];return (c?'✓ ':'✗ ')+i.text+(c?' — '+c.by+', '+tm(c.at):' — NOT DONE');});
  const message=title+' — '+dlabel(key)+'\nCompleted by: '+names.join(', ')+'\nFinished at: '+(last?tm(last):'')+'\n'+done.length+' of '+items.length+' tasks done\n\n'+lines.join('\n');
  const r=await fetch('https://api.emailjs.com/api/v1.0/email/send',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({service_id:EMAIL.serviceId,template_id:EMAIL.templateId,user_id:EMAIL.publicKey,template_params:{subject:title+' report — '+dlabel(key),message}})
  });
  if(!r.ok)throw new Error(await r.text());
}
// END
