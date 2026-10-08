import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp} from './core.js';
import {icon} from './icons.js';

const X={
utensils:'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
book:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
list:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>'
};
export const ic=(n,s=24)=>X[n]?`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${X[n]}</svg>`:icon(n,s);

export function showMealPrep(){
  const t=[['mpmenu','list','Menu'],['mprecipes','book','Recipes'],['mppar','box','Par Sheets']];
  setView(topbar('Meal Prep')+t.map(x=>`<button class="big ib" style="justify-content:center;gap:12px" data-go="${x[0]}">${ic(x[1],26)} ${x[2]}</button>`).join(''));
}

export function showMenu(){
  setView(topbar('Menu','mealprep')+`<details class="add"><summary>+ Add a menu item</summary><div>
  <input id="mn" placeholder="Dish name" maxlength="100">
  <input id="mc" list="mcs" placeholder="Category (e.g. Breakfast, Lunch)" maxlength="40"><datalist id="mcs"></datalist>
  <textarea id="mo" rows="2" placeholder="Notes (optional)" maxlength="300"></textarea>
  <button class="btn" id="ma">Add to menu</button></div></details><div id="ml"></div>`);
  sub(onSnapshot(collection(db,'menu'),s=>{
    const rows=s.docs.map(dd).filter(m=>m.active!==false).sort((a,b)=>(a.at?.seconds||0)-(b.at?.seconds||0));
    const g={};rows.forEach(m=>{const c=m.category||'Other';(g[c]=g[c]||[]).push(m);});
    $('#mcs').innerHTML=Object.keys(g).map(c=>`<option value="${esc(c)}">`).join('');
    $('#ml').innerHTML=rows.length?Object.keys(g).map(c=>`<div class="sec">${esc(c)}</div>`+g[c].map(m=>`<div class="card"><b>${esc(m.name)}</b>${m.notes?`<div class="mut small">${esc(m.notes)}</div>`:''}<div><button class="link" data-rmm="${m.id}">Remove</button></div></div>`).join('')).join(''):'<p class="mut center">No menu items yet. Add the first one above.</p>';
  }));
  $('#ml').onclick=e=>{
    const r=e.target.closest('[data-rmm]');
    if(r&&confirm('Remove this menu item?'))updateDoc(doc(db,'menu',r.dataset.rmm),{active:false});
  };
  $('#ma').onclick=()=>{
    const name=$('#mn').value.trim();
    if(!name){alert('Please enter a dish name.');return;}
    addDoc(collection(db,'menu'),{name,category:$('#mc').value.trim(),notes:$('#mo').value.trim(),by:S.me,at:serverTimestamp(),active:true});
    ['mn','mc','mo'].forEach(i=>$('#'+i).value='');
    document.querySelector('details.add').open=false;
  };
}
// END
