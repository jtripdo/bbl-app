import {db,S,$,esc,sub,dd,setView,topbar,collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp} from './core.js';

export function showRecipes(){
  setView(topbar('Recipes','mealprep')+`<input id="rq" placeholder="Search recipes" maxlength="60"><details class="add" id="rf"><summary>+ Add a recipe</summary><div>
  <input id="rn" placeholder="Recipe name" maxlength="120">
  <div class="two"><input id="rc" list="rcs" placeholder="Category" maxlength="40"><input id="ry" placeholder="Yield (e.g. 12 portions)" maxlength="60"></div><datalist id="rcs"></datalist>
  <textarea id="ri" rows="5" placeholder="Ingredients, one per line (e.g. 2 lb chicken thighs)" maxlength="3000"></textarea>
  <textarea id="rs" rows="6" placeholder="Instructions" maxlength="5000"></textarea>
  <textarea id="rt" rows="2" placeholder="Notes: storage, shelf life, allergens (optional)" maxlength="1000"></textarea>
  <button class="btn" id="ra">Add recipe</button></div></details><div id="rl"></div>`);
  let rows=[],eid=null;
  const draw=()=>{
    const q=($('#rq').value||'').trim().toLowerCase();
    const list=rows.filter(r=>!q||((r.name||'')+' '+(r.category||'')).toLowerCase().includes(q));
    const g={};list.forEach(r=>{const c=r.category||'Other';(g[c]=g[c]||[]).push(r);});
    $('#rcs').innerHTML=[...new Set(rows.map(r=>r.category).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join('');
    $('#rl').innerHTML=list.length?Object.keys(g).sort().map(c=>`<div class="sec">${esc(c)}</div>`+g[c].map(r=>`<details class="card"><summary><b>${esc(r.name)}</b>${r.yieldTxt?` <span class="mut small">· ${esc(r.yieldTxt)}</span>`:''}</summary>
      <div class="sec">Ingredients</div>${(r.ingredients||'').split('\n').filter(x=>x.trim()).map(x=>`<div class="hl">${esc(x)}</div>`).join('')}
      <div class="sec">Instructions</div><div style="white-space:pre-wrap">${esc(r.steps||'')}</div>
      ${r.notes?`<div class="sec">Notes</div><div class="mut" style="white-space:pre-wrap">${esc(r.notes)}</div>`:''}
      <div style="margin-top:10px"><button class="link" data-er="${r.id}">Edit</button> · <button class="link" data-rr="${r.id}">Remove</button></div></details>`).join('')).join(''):'<p class="mut center">'+(rows.length?'No recipes match your search.':'No recipes yet. Add the first one above.')+'</p>';
  };
  sub(onSnapshot(collection(db,'recipes'),s=>{
    rows=s.docs.map(dd).filter(r=>r.active!==false).sort((a,b)=>(a.name||'').localeCompare(b.name||''));draw();
  }));
  $('#rq').oninput=draw;
  $('#rl').onclick=e=>{
    const er=e.target.closest('[data-er]'),rr=e.target.closest('[data-rr]');
    if(rr){if(confirm('Remove this recipe?'))updateDoc(doc(db,'recipes',rr.dataset.rr),{active:false});return;}
    if(er){
      const r=rows.find(x=>x.id===er.dataset.er);if(!r)return;
      eid=r.id;
      $('#rn').value=r.name||'';$('#rc').value=r.category||'';$('#ry').value=r.yieldTxt||'';
      $('#ri').value=r.ingredients||'';$('#rs').value=r.steps||'';$('#rt').value=r.notes||'';
      $('#ra').textContent='Save changes';$('#rf').open=true;window.scrollTo(0,0);
    }
  };
  $('#ra').onclick=()=>{
    const name=$('#rn').value.trim();
    if(!name){alert('Please enter a recipe name.');return;}
    const d={name,category:$('#rc').value.trim(),yieldTxt:$('#ry').value.trim(),ingredients:$('#ri').value.trim(),steps:$('#rs').value.trim(),notes:$('#rt').value.trim()};
    if(eid)updateDoc(doc(db,'recipes',eid),{...d,editedBy:S.me,editedAt:serverTimestamp()});
    else addDoc(collection(db,'recipes'),{...d,by:S.me,at:serverTimestamp(),active:true});
    eid=null;['rn','rc','ry','ri','rs','rt'].forEach(i=>$('#'+i).value='');
    $('#ra').textContent='Add recipe';$('#rf').open=false;
  };
}
// END
