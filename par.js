import {db,S,$,esc,sub,fmt,dd,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,query,orderBy,limit,serverTimestamp} from './core.js';
import {icon} from './icons.js';

export function showPar(){
  setView(topbar('Par Sheet')+`<div><button class="btn ghost sm" data-go="parhist">Past sheets</button></div><div id="pb"></div><button class="btn full" id="pSub" style="display:none">Submit Par Sheet</button>
  <details class="add"><summary>+ Add a par item</summary><div>
  <input id="pSec" list="secs" placeholder="Section (e.g. Walk-In)"><datalist id="secs"></datalist>
  <input id="pName" placeholder="Item name" maxlength="100">
  <div class="two"><input id="pUnit" placeholder="Unit (lb, case)" maxlength="20"><input id="pPar" type="number" inputmode="decimal" placeholder="Par level"></div>
  <button class="btn" id="pAdd">Add item</button></div></details>`);
  let items=[];const vals={};
  const needOf=i=>{const v=vals[i.id];if(v===undefined||v===''||isNaN(parseFloat(v)))return null;return Math.max(0,i.par-parseFloat(v));};
  const needTxt=i=>{const n=needOf(i);return n===null?'—':(Math.round(n*100)/100)+' '+i.unit;};
  const draw=()=>{
    const secs={};
    items.forEach(i=>{(secs[i.section]=secs[i.section]||[]).push(i);});
    $('#secs').innerHTML=Object.keys(secs).map(s=>`<option value="${esc(s)}">`).join('');
    $('#pb').innerHTML=items.length?Object.keys(secs).map(s=>`<div class="sec">${esc(s)}</div>`+secs[s].map(i=>`
      <div class="card"><div class="ih"><b>${esc(i.item)}</b><span class="mut small">Par ${i.par} ${esc(i.unit)}</span></div>
      <div class="oh"><label>On hand</label><input type="number" inputmode="decimal" min="0" step="any" data-in="${i.id}" value="${esc(vals[i.id]??'')}"></div>
      <div class="need">Need: <b id="n_${i.id}">${esc(needTxt(i))}</b></div>
      <div><button class="link" data-par="${i.id}">Edit par</button> · <button class="link" data-rmp="${i.id}">Remove</button></div></div>`).join('')).join('')
      :'<p class="mut center">No items yet. Tap "Add a par item" below to start.</p>';
    $('#pSub').style.display=items.length?'block':'none';
  };
  sub(onSnapshot(query(collection(db,'parItems')),s=>{
    items=s.docs.map(dd).filter(i=>i.active!==false).sort((a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0));
    draw();
  }));
  $('#pb').oninput=e=>{
    const t=e.target.closest('[data-in]');if(!t)return;
    vals[t.dataset.in]=t.value;
    const i=items.find(x=>x.id===t.dataset.in);
    if(i)$('#n_'+i.id).textContent=needTxt(i);
  };
  $('#pb').onclick=e=>{
    const ep=e.target.closest('[data-par]'),rp=e.target.closest('[data-rmp]');
    if(ep){const i=items.find(x=>x.id===ep.dataset.par);const v=prompt('New par level for '+i.item+' ('+i.unit+')',i.par);if(v===null)return;const n=parseFloat(v);if(isNaN(n))return;updateDoc(doc(db,'parItems',i.id),{par:n});}
    if(rp){if(confirm('Remove this item from the par sheet?'))updateDoc(doc(db,'parItems',rp.dataset.rmp),{active:false});}
  };
  $('#pAdd').onclick=()=>{
    const section=$('#pSec').value.trim()||'General',item=$('#pName').value.trim(),unit=$('#pUnit').value.trim(),par=parseFloat($('#pPar').value);
    if(!item||!unit||isNaN(par)){alert('Please fill in the item name, unit, and par level.');return;}
    addDoc(collection(db,'parItems'),{section,item,unit,par,by:S.me,at:serverTimestamp(),active:true});
    ['pName','pUnit','pPar'].forEach(i=>$('#'+i).value='');
  };
  $('#pSub').onclick=()=>{
    const entries=items.map(i=>{
      const v=vals[i.id];const has=v!==undefined&&v!==''&&!isNaN(parseFloat(v));
      const oh=has?parseFloat(v):null;
      return {item:i.item,section:i.section,unit:i.unit,par:i.par,onHand:oh,need:has?Math.max(0,i.par-oh):null};
    });
    const miss=entries.filter(x=>x.onHand===null).length;
    if(miss&&!confirm(miss+' item(s) have no count entered. Submit anyway?'))return;
    addDoc(collection(db,'parSheets'),{by:S.me,at:serverTimestamp(),entries}).catch(()=>alert('Could not save the par sheet. Please try again.'));
    setView(topbar('Par Sheet')+`<div class="center"><h2 class="okc"><span class="ib">${icon('check',28)} Submitted</span></h2><p class="mut">Saved under ${esc(S.me)}.</p><button class="btn" data-go="dash">Back to home</button> <button class="btn ghost" data-go="parhist">Past sheets</button></div>`);
  };
}

export function showParHist(){
  setView(topbar('Past Par Sheets','par')+'<div id="h"></div>');
  sub(onSnapshot(query(collection(db,'parSheets'),orderBy('at','desc'),limit(20)),s=>{
    const rows=s.docs.map(dd);
    $('#h').innerHTML=rows.length?rows.map(r=>`<details class="card"><summary><b>${esc(r.by)}</b> · ${fmt(r.at)}</summary>${(r.entries||[]).map(e=>`<div class="hl">${esc(e.item)}: ${e.onHand===null?'not counted':`${e.onHand} / ${e.par} ${esc(e.unit)} → need <b>${e.need}</b>`}</div>`).join('')}</details>`).join(''):'<p class="mut center">No sheets submitted yet.</p>';
  }));
}
// END
