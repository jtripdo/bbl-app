// Back Office: invoices, product prices, recipe costing, inventory counts, food cost & P&L.
// Data lives in Firestore (boProducts, boPrices, boInvoices, boRecipes, boCounts).
// Square sales and menu come from the backOffice server function.
import {db,auth,S,$,esc,sub,dd,setView,topbar,today,dstr,dlabel,collection,doc,addDoc,updateDoc,deleteDoc,onSnapshot,getDocs,serverTimestamp,query,where,orderBy,limit} from './core.js';

const FN='https://us-central1-bbl-app-d58e6.cloudfunctions.net/backOffice';
async function boApi(action,body={}){
  const h={'Content-Type':'application/json'};
  if(auth.currentUser)h.Authorization='Bearer '+(await auth.currentUser.getIdToken());
  const r=await fetch(FN,{method:'POST',headers:h,body:JSON.stringify({action,...body})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Something went wrong. Please try again.');
  return d;
}

const ALERT_PCT=5; // flag price changes of 5% or more
const money=n=>'$'+(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const money0=n=>'$'+Math.round(Number(n)||0).toLocaleString('en-US');
const per=(n,u)=>money(n)+(u?'/'+esc(u):'');
const num=v=>{const n=parseFloat(String(v).replace(/[$,]/g,''));return isFinite(n)?n:0;};
const pct=(a,b)=>b?(a/b*100):0;
const pctTxt=n=>(Math.round(n*10)/10)+'%';
const chg=p=>p.prevPrice&&p.lastPrice?(p.lastPrice-p.prevPrice)/p.prevPrice*100:0;
const byName=(a,b)=>(a.name||'').localeCompare(b.name||'');
const live=r=>r.active!==false;
const fcClass=p=>p>=35?'bad':p>=28?'warn':'good';
const STYLE=`<style>
.bo-kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}
.bo-kpi{background:var(--card);border-radius:18px;padding:14px 16px;box-shadow:var(--shadow)}
.bo-kpi b{display:block;font-size:24px;letter-spacing:-.02em;margin-top:2px}
.bo-t{width:100%;border-collapse:collapse;font-size:14px}
.bo-t th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);font-weight:700;padding:6px 4px}
.bo-t td{padding:9px 4px;border-top:1px solid var(--line);vertical-align:top}
.bo-t .r{text-align:right;white-space:nowrap}
.bo-up{color:#ef8a6f;font-weight:700}.bo-down{color:var(--ok);font-weight:700}
.good{color:var(--ok)}.warn{color:var(--acc)}.bad{color:#ef8a6f}
.bo-line{display:grid;grid-template-columns:1fr 78px 92px 30px;gap:6px;align-items:start}
.bo-line input{margin-bottom:6px}
.bo-ing{display:grid;grid-template-columns:1fr 84px 30px;gap:6px;align-items:start}
.bo-ing input{margin-bottom:6px}
.bo-pill{display:inline-block;font-size:12px;font-weight:700;border-radius:999px;padding:2px 9px;background:var(--card2)}
.bo-range{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.bo-range button{background:var(--card);color:var(--ink);border:0;border-radius:999px;padding:8px 14px;font-size:14px;font-weight:600;box-shadow:var(--shadow)}
.bo-range button.on{background:var(--acc);color:#1a1208}
.bo-cnt{display:grid;grid-template-columns:1fr 96px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}
.bo-cnt input{margin:0;text-align:right}
</style>`;

// Live product list shared by the screens
function watchProducts(cb){
  sub(onSnapshot(collection(db,'boProducts'),s=>cb(s.docs.map(dd).filter(live).sort(byName))));
}
const prodOpts=list=>list.map(p=>`<option value="${esc(p.name)}">`).join('');
const findProd=(list,name)=>list.find(p=>(p.name||'').toLowerCase()===String(name||'').trim().toLowerCase());

// Cost of one batch of a recipe and per portion
export function recipeCost(r,prods){
  let batch=0,missing=0;
  (r.ingredients||[]).forEach(i=>{const p=prods.find(x=>x.id===i.productId);if(p&&p.lastPrice)batch+=p.lastPrice*(Number(i.qty)||0);else missing++;});
  const portions=Math.max(1,Number(r.portions)||1);
  return {batch,each:batch/portions,missing};
}

// ---------- Home ----------
export function showBO(){
  setView(STYLE+topbar('Back Office')+`
  <div class="bo-kpis">
    <div class="bo-kpi"><span class="mut small">Sales, last 7 days</span><b id="k1">…</b></div>
    <div class="bo-kpi"><span class="mut small">Purchases, last 7 days</span><b id="k2">…</b></div>
    <div class="bo-kpi"><span class="mut small">Purchases ÷ sales</span><b id="k3">…</b></div>
    <div class="bo-kpi"><span class="mut small">Inventory on hand</span><b id="k4">…</b></div>
  </div>
  <div class="grid" style="margin-top:14px">
    <button class="tile" data-go="boinv">Invoices</button>
    <button class="tile" data-go="boprod">Products & Prices</button>
    <button class="tile" data-go="borec">Recipe Costing</button>
    <button class="tile" data-go="bocount">Inventory Count</button>
    <button class="tile wide" data-go="bopl">Food Cost & P&L</button>
  </div>
  <div class="sec">Price alerts</div><div id="alerts"><p class="mut small">Loading…</p></div>`);
  const from=dstr(new Date(Date.now()-6*86400000)),to=today();
  let sales=null,purch=null;
  const k3=()=>{if(sales!=null&&purch!=null)$('#k3').innerHTML=sales?`<span class="${fcClass(pct(purch,sales))}">${pctTxt(pct(purch,sales))}</span>`:'—';};
  boApi('sales',{from,to}).then(r=>{sales=r.days.reduce((a,d)=>a+d.sales,0)/100;$('#k1').textContent=money0(sales);k3();})
    .catch(e=>{$('#k1').textContent='—';$('#k1').title=e.message;});
  sub(onSnapshot(query(collection(db,'boInvoices'),where('date','>=',from)),s=>{
    purch=s.docs.map(dd).filter(i=>i.date<=to).reduce((a,i)=>a+(Number(i.total)||0),0);$('#k2').textContent=money0(purch);k3();
  }));
  sub(onSnapshot(query(collection(db,'boCounts'),orderBy('date','desc'),limit(1)),s=>{
    const c=s.docs.map(dd)[0];$('#k4').innerHTML=c?`${money0(c.value)}<div class="mut small" style="font-size:12px;font-weight:400">${esc(dlabel(c.date))}</div>`:'—';
  }));
  watchProducts(list=>{
    const a=list.filter(p=>Math.abs(chg(p))>=ALERT_PCT).sort((x,y)=>Math.abs(chg(y))-Math.abs(chg(x))).slice(0,8);
    $('#alerts').innerHTML=a.length?`<div class="card"><table class="bo-t">${a.map(p=>{const c=chg(p);return `<tr><td>${esc(p.name)}<div class="mut small">${esc(p.vendor||'')}</div></td><td class="r">${per(p.lastPrice,p.unit)}<div class="${c>0?'bo-up':'bo-down'}">${c>0?'▲':'▼'} ${pctTxt(Math.abs(c))}</div></td></tr>`;}).join('')}</table></div>`
      :'<p class="mut small">No price changes of '+ALERT_PCT+'% or more on your latest invoices.</p>';
  });
}

// ---------- Invoices ----------
export function showInvoices(){
  setView(STYLE+topbar('Invoices','bo')+`<button class="btn full" data-go="boinvnew">+ Enter an invoice</button><div id="il"><p class="mut">Loading…</p></div>`);
  sub(onSnapshot(query(collection(db,'boInvoices'),orderBy('date','desc'),limit(100)),s=>{
    const rows=s.docs.map(dd);
    $('#il').innerHTML=rows.length?rows.map(i=>`<div class="card" data-go="boinvnew" data-arg="${i.id}"><div class="ih"><b>${esc(i.vendor)}</b><b>${money(i.total)}</b></div><div class="mut small">${esc(dlabel(i.date))}${i.number?' · #'+esc(i.number):''} · ${(i.lines||[]).length} item${(i.lines||[]).length===1?'':'s'}</div></div>`).join('')
      :'<p class="mut center">No invoices yet. Enter your first one above.</p>';
  }));
}

export function showInvoiceForm(id){
  setView(STYLE+topbar(id?'Invoice':'Enter an invoice','boinv')+`
  ${id?'':`<label class="btn full" style="display:block;text-align:center;margin-top:0">📷 Snap the invoice<input id="scan" type="file" accept="image/*" capture="environment" multiple hidden></label>
  <p class="mut small" id="scanMsg" style="margin-top:-8px">Take a photo (or up to 4 for long invoices). The lines fill in below so you can check them before saving.</p>`}
  <div class="card">
    <input id="iv" list="ivs" placeholder="Vendor (e.g. Sysco, Restaurant Depot)" maxlength="60"><datalist id="ivs"></datalist>
    <div class="two"><input id="idt" type="date"><input id="inum" placeholder="Invoice # (optional)" maxlength="40"></div>
  </div>
  <p class="mut small">One line per product. Quantity is in the unit you use it in (lb, each, qt…), so a 40 lb case is 40. Enter the line total from the invoice.</p>
  <div class="bo-line mut small" style="font-weight:700"><span>Product</span><span>Qty</span><span>Line total</span><span></span></div>
  <div id="lines"></div><datalist id="pl"></datalist>
  <button class="link" id="addl">+ Add a line</button>
  <div class="card" style="margin-top:12px"><div class="ih"><span>Invoice total</span><b id="itot">$0.00</b></div><div id="new" class="mut small"></div></div>
  <button class="btn full" id="isave">${id?'Save changes':'Save invoice'}</button>
  ${id?'<button class="link" id="idel">Delete this invoice</button>':''}
  <p id="imsg" class="mut small"></p>`);
  let prods=[],inv=null;
  $('#idt').value=today();
  const lineHtml=(l={})=>`<div class="bo-line" data-l data-unit="${esc(l.unit||'')}"><input data-f="name" list="pl" placeholder="Product" maxlength="80" value="${esc(l.name||'')}"><input data-f="qty" inputmode="decimal" placeholder="Qty" value="${l.qty??''}"><input data-f="total" inputmode="decimal" placeholder="$" value="${l.total??''}"><button class="x" data-rml>✕</button></div>`;
  const read=()=>[...document.querySelectorAll('[data-l]')].map(r=>({unit:r.dataset.unit||'',name:r.querySelector('[data-f=name]').value.trim(),qty:num(r.querySelector('[data-f=qty]').value),total:num(r.querySelector('[data-f=total]').value)})).filter(l=>l.name);
  const tally=()=>{
    const ls=read();$('#itot').textContent=money(ls.reduce((a,l)=>a+l.total,0));
    const fresh=[...new Set(ls.filter(l=>!findProd(prods,l.name)).map(l=>l.name))];
    $('#new').innerHTML=fresh.length?'New products will be added: '+fresh.map(esc).join(', ')+'. Check their units under Products & Prices.':'';
  };
  const addLine=l=>{$('#lines').insertAdjacentHTML('beforeend',lineHtml(l));};
  watchProducts(list=>{prods=list;$('#pl').innerHTML=prodOpts(list);$('#ivs').innerHTML=[...new Set(list.map(p=>p.vendor).filter(Boolean))].map(v=>`<option value="${esc(v)}">`).join('');tally();});
  if(id){
    sub(onSnapshot(doc(db,'boInvoices',id),s=>{
      if(inv||!s.exists())return;inv={id:s.id,...s.data()};
      $('#iv').value=inv.vendor||'';$('#idt').value=inv.date||today();$('#inum').value=inv.number||'';
      $('#lines').innerHTML='';(inv.lines||[]).forEach(addLine);addLine();tally();
    }));
  } else {for(let i=0;i<3;i++)addLine();}
  $('#lines').addEventListener('input',e=>{
    tally();
    const rows=[...document.querySelectorAll('[data-l]')];
    if(rows.length&&rows[rows.length-1].querySelector('[data-f=name]').value.trim())addLine();
    const r=e.target.closest('[data-l]');
    if(r&&e.target.dataset.f==='name'){const p=findProd(prods,e.target.value);r.querySelector('[data-f=qty]').placeholder=p&&p.unit?p.unit:'Qty';}
  });
  $('#lines').addEventListener('click',e=>{if(e.target.closest('[data-rml]')){e.target.closest('[data-l]').remove();tally();}});
  $('#addl').onclick=()=>addLine();
  if(!id)$('#scan').onchange=async e=>{
    const files=[...e.target.files].slice(0,4);e.target.value='';if(!files.length)return;
    $('#scanMsg').innerHTML='<b>Reading the invoice…</b> this takes about 10–20 seconds.';
    try{
      const images=await Promise.all(files.map(shrink));
      const r=await boApi('scan',{images,known:prods.map(p=>p.name)});
      if(r.vendor&&!$('#iv').value.trim())$('#iv').value=r.vendor;
      if(r.date)$('#idt').value=r.date;
      if(r.invoiceNumber)$('#inum').value=r.invoiceNumber;
      $('#lines').innerHTML='';(r.lines||[]).forEach(l=>addLine({name:(findProd(prods,l.name)||{}).name||l.name,qty:l.qty,unit:l.unit,total:l.total.toFixed(2)}));addLine();tally();
      const sum=(r.lines||[]).reduce((a,l)=>a+l.total,0);
      const off=r.invoiceTotal&&Math.abs(r.invoiceTotal-sum)>0.05;
      $('#scanMsg').innerHTML=`Found ${(r.lines||[]).length} lines. <b>Check each one</b>, then save.`+(off?` <span class="warn">Lines add up to ${money(sum)} but the invoice says ${money(r.invoiceTotal)} (tax or fees may explain it).</span>`:'');
    }catch(err){$('#scanMsg').innerHTML=`<span class="bad">${esc(err.message)}</span> You can still type the lines in.`;}
  };
  if(id)$('#idel').onclick=async()=>{if(!confirm('Delete this invoice? Product prices already updated from it stay as they are.'))return;await deleteDoc(doc(db,'boInvoices',id));document.querySelector('[data-go=boinv]').click();};
  $('#isave').onclick=async()=>{
    const vendor=$('#iv').value.trim(),date=$('#idt').value,ls=read();
    if(!vendor){alert('Please enter the vendor.');return;}
    if(!date){alert('Please pick the invoice date.');return;}
    if(!ls.length){alert('Add at least one line.');return;}
    if(ls.some(l=>!(l.qty>0)||!(l.total>=0))){alert('Each line needs a quantity and a line total.');return;}
    $('#isave').disabled=true;$('#imsg').textContent='Saving…';
    try{
      const lines=[];
      for(const l of ls){
        let p=findProd(prods,l.name);
        const unitPrice=Math.round(l.total/l.qty*10000)/10000;
        if(!p){
          const ref=await addDoc(collection(db,'boProducts'),{name:l.name,unit:l.unit||'',category:'',vendor,lastPrice:unitPrice,prevPrice:null,lastDate:date,by:S.me,at:serverTimestamp(),active:true});
          p={id:ref.id,name:l.name,unit:'',lastPrice:unitPrice,lastDate:date};prods.push(p);
        } else if(!p.lastDate||date>=p.lastDate){
          // Newest invoice sets the current price; older ones only go into history
          const upd={lastPrice:unitPrice,lastDate:date,vendor};
          if(p.lastPrice!==unitPrice)upd.prevPrice=p.lastPrice??null;
          await updateDoc(doc(db,'boProducts',p.id),upd);Object.assign(p,upd);
        }
        await addDoc(collection(db,'boPrices'),{productId:p.id,price:unitPrice,date,vendor,at:serverTimestamp()});
        lines.push({productId:p.id,name:p.name,qty:l.qty,total:l.total,unitPrice});
      }
      const d={vendor,date,number:$('#inum').value.trim(),lines,total:Math.round(lines.reduce((a,l)=>a+l.total,0)*100)/100};
      if(id)await updateDoc(doc(db,'boInvoices',id),{...d,editedBy:S.me,editedAt:serverTimestamp()});
      else await addDoc(collection(db,'boInvoices'),{...d,by:S.me,at:serverTimestamp()});
      document.querySelector('[data-go=boinv]').click();
    }catch(e){$('#imsg').textContent='Couldn\'t save: '+e.message;$('#isave').disabled=false;}
  };
}

// Shrinks a phone photo so it uploads fast but stays readable.
function shrink(file){
  return new Promise((ok,bad)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{const max=2000,k=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);ok(c.toDataURL('image/jpeg',0.85));};
    img.onerror=()=>{URL.revokeObjectURL(url);bad(new Error('That photo couldn\'t be opened.'));};
    img.src=url;
  });
}

// ---------- Products & prices ----------
export function showProducts(){
  setView(STYLE+topbar('Products & Prices','bo')+`<input id="pq" placeholder="Search products" maxlength="60">
  <p class="mut small">Prices update from your newest invoice. Set each product's unit (how you measure it in recipes and counts) and a category.</p><div id="pl"></div>`);
  let list=[],open=null;
  const draw=()=>{
    const q=($('#pq').value||'').trim().toLowerCase();
    const rows=list.filter(p=>!q||((p.name||'')+' '+(p.category||'')+' '+(p.vendor||'')).toLowerCase().includes(q));
    const g={};rows.forEach(p=>{const c=p.category||'Uncategorized';(g[c]=g[c]||[]).push(p);});
    const cats=[...new Set(list.map(p=>p.category).filter(Boolean))];
    $('#pl').innerHTML=rows.length?Object.keys(g).sort().map(c=>`<div class="sec">${esc(c)}</div><div class="card"><table class="bo-t">`+g[c].map(p=>{const ch=chg(p);return `<tr data-p="${p.id}"><td><b>${esc(p.name)}</b><div class="mut small">${esc(p.vendor||'')}${p.lastDate?' · '+esc(dlabel(p.lastDate)):''}</div>${!p.unit?'<span class="bo-pill warn">Set unit</span>':''}</td><td class="r">${p.lastPrice?per(p.lastPrice,p.unit):'—'}${Math.abs(ch)>=0.05?`<div class="${ch>0?'bo-up':'bo-down'} small">${ch>0?'▲':'▼'} ${pctTxt(Math.abs(ch))}</div>`:''}</td></tr>`+(open===p.id?`<tr><td colspan="2"><div class="two"><input id="eu" placeholder="Unit (lb, each, oz)" maxlength="12" value="${esc(p.unit||'')}"><input id="ec" list="cats" placeholder="Category" maxlength="40" value="${esc(p.category||'')}"></div><datalist id="cats">${cats.map(x=>`<option value="${esc(x)}">`).join('')}</datalist><input id="en" placeholder="Name" maxlength="80" value="${esc(p.name)}"><div id="ph" class="mut small">Loading price history…</div><button class="btn sm" data-sv="${p.id}">Save</button> <button class="link" data-rm="${p.id}">Remove product</button></td></tr>`:'');}).join('')+'</table></div>').join('')
      :`<p class="mut center">${list.length?'No products match.':'No products yet. They\'re added automatically when you enter an invoice.'}</p>`;
    if(open){
      getHistory(open).then(h=>{const el=$('#ph');if(el)el.innerHTML=h.length?'<div class="sec" style="margin-top:6px">Price history</div>'+h.map(x=>`<div class="hl ih"><span>${esc(dlabel(x.date))} · ${esc(x.vendor||'')}</span><span>${money(x.price)}</span></div>`).join(''):'No price history yet.';});
    }
  };
  watchProducts(l=>{list=l;draw();});
  $('#pq').oninput=draw;
  $('#pl').onclick=async e=>{
    const sv=e.target.closest('[data-sv]'),rm=e.target.closest('[data-rm]'),row=e.target.closest('[data-p]');
    if(sv){const name=$('#en').value.trim();if(!name){alert('Name can\'t be empty.');return;}await updateDoc(doc(db,'boProducts',sv.dataset.sv),{unit:$('#eu').value.trim(),category:$('#ec').value.trim(),name});open=null;draw();return;}
    if(rm){if(confirm('Remove this product? Recipes using it will show it as missing.')){await updateDoc(doc(db,'boProducts',rm.dataset.rm),{active:false});open=null;}return;}
    if(row){open=open===row.dataset.p?null:row.dataset.p;draw();}
  };
}
async function getHistory(pid){
  const s=await getDocs(query(collection(db,'boPrices'),where('productId','==',pid)));
  return s.docs.map(dd).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,12);
}

// ---------- Recipe costing ----------
let menuCache=null;
async function squareMenu(){if(!menuCache)menuCache=await boApi('menu').then(r=>r.items).catch(()=>[]);return menuCache;}

export function showRecipeCosts(){
  setView(STYLE+topbar('Recipe Costing','bo')+`<button class="btn full" data-go="borecedit">+ Cost a menu item</button>
  <p class="mut small">Food cost % = ingredient cost ÷ menu price. Green under 28%, amber 28–35%, red 35% and up.</p><div id="rl"><p class="mut">Loading…</p></div>`);
  let prods=[],recs=[];
  const draw=()=>{
    $('#rl').innerHTML=recs.length?`<div class="card"><table class="bo-t"><tr><th>Item</th><th class="r">Cost</th><th class="r">Price</th><th class="r">Food cost</th></tr>${recs.map(r=>{const c=recipeCost(r,prods);const fc=pct(c.each,r.price);return `<tr data-go="borecedit" data-arg="${r.id}"><td><b>${esc(r.name)}</b>${c.missing?`<div class="warn small">${c.missing} ingredient${c.missing>1?'s':''} without a price</div>`:''}</td><td class="r">${money(c.each)}</td><td class="r">${r.price?money(r.price):'—'}</td><td class="r ${r.price?fcClass(fc):''}"><b>${r.price?pctTxt(fc):'—'}</b></td></tr>`;}).join('')}</table></div>`
      :'<p class="mut center">No menu items costed yet.</p>';
  };
  watchProducts(l=>{prods=l;draw();});
  sub(onSnapshot(collection(db,'boRecipes'),s=>{recs=s.docs.map(dd).filter(live).sort(byName);draw();}));
}

export function showRecipeForm(id){
  setView(STYLE+topbar(id?'Edit menu item':'Cost a menu item','borec')+`
  <div class="card">
    <input id="rn" placeholder="Menu item name" maxlength="80">
    <label class="mut small">Square item (links sales to this recipe)</label>
    <select id="rsq"><option value="">Loading Square menu…</option></select>
    <div class="two"><div><label class="mut small">Menu price</label><input id="rp" inputmode="decimal" placeholder="$"></div><div><label class="mut small">Portions per batch</label><input id="rpo" inputmode="numeric" value="1"></div></div>
  </div>
  <div class="sec">Ingredients for one batch</div>
  <div class="bo-ing mut small" style="font-weight:700"><span>Product</span><span>Amount</span><span></span></div>
  <div id="ings"></div><datalist id="pl"></datalist>
  <button class="link" id="addi">+ Add an ingredient</button>
  <div class="card" style="margin-top:12px" id="sum"></div>
  <button class="btn full" id="rsave">Save</button>${id?'<button class="link" id="rdel">Remove this item</button>':''}`);
  let prods=[],rec=null,menu=[];
  const ingHtml=(i={})=>{const p=prods.find(x=>x.id===i.productId);return `<div class="bo-ing" data-i><input data-f="name" list="pl" placeholder="Product" maxlength="80" value="${esc(p?p.name:(i.name||''))}"><input data-f="qty" inputmode="decimal" placeholder="${esc(p&&p.unit||'Amount')}" value="${i.qty??''}"><button class="x" data-rmi>✕</button></div>`;};
  const read=()=>[...document.querySelectorAll('[data-i]')].map(r=>{const name=r.querySelector('[data-f=name]').value.trim();const p=findProd(prods,name);return {name,productId:p?p.id:null,qty:num(r.querySelector('[data-f=qty]').value)};}).filter(i=>i.name);
  const calc=()=>{
    const ings=read(),r={ingredients:ings,portions:num($('#rpo').value)||1};const c=recipeCost(r,prods);const price=num($('#rp').value);
    const unknown=ings.filter(i=>!i.productId).map(i=>i.name);
    $('#sum').innerHTML=`<div class="ih"><span>Batch cost</span><b>${money(c.batch)}</b></div><div class="ih"><span>Cost per portion</span><b>${money(c.each)}</b></div>`+
      (price?`<div class="ih"><span>Food cost</span><b class="${fcClass(pct(c.each,price))}">${pctTxt(pct(c.each,price))}</b></div><div class="ih"><span>Profit per portion</span><b>${money(price-c.each)}</b></div>`:'')+
      (unknown.length?`<div class="warn small">Not in your products yet: ${unknown.map(esc).join(', ')}. Enter an invoice with them first.</div>`:'');
  };
  watchProducts(l=>{prods=l;$('#pl').innerHTML=prodOpts(l);if(!document.querySelector('[data-i]'))init();calc();});
  const init=()=>{
    if(id&&!rec)return;
    $('#ings').innerHTML='';((rec&&rec.ingredients)||[]).forEach(i=>$('#ings').insertAdjacentHTML('beforeend',ingHtml(i)));
    $('#ings').insertAdjacentHTML('beforeend',ingHtml());calc();
  };
  if(id)sub(onSnapshot(doc(db,'boRecipes',id),s=>{if(rec||!s.exists())return;rec={id:s.id,...s.data()};$('#rn').value=rec.name||'';$('#rp').value=rec.price||'';$('#rpo').value=rec.portions||1;fillMenu();init();}));
  const fillMenu=()=>{
    const want=(rec&&rec.squareName)||'';
    const opts=menu.flatMap(m=>(m.variations.length>1?m.variations:[{name:'',price:(m.variations[0]||{}).price||0}]).map(v=>({label:m.name+(v.name&&m.variations.length>1?' · '+v.name:''),name:m.name,price:v.price})));
    $('#rsq').innerHTML='<option value="">Not linked</option>'+opts.map(o=>`<option value="${esc(o.name)}" data-price="${o.price}" ${o.name===want?'selected':''}>${esc(o.label)}${o.price?' · '+money(o.price/100):''}</option>`).join('')+(want&&!opts.some(o=>o.name===want)?`<option selected value="${esc(want)}">${esc(want)}</option>`:'');
  };
  squareMenu().then(m=>{menu=m;fillMenu();});
  $('#rsq').onchange=e=>{const o=e.target.selectedOptions[0];if(o&&o.value){if(!$('#rn').value.trim())$('#rn').value=o.value;if(o.dataset.price&&Number(o.dataset.price))$('#rp').value=(Number(o.dataset.price)/100).toFixed(2);calc();}};
  $('#ings').addEventListener('input',e=>{
    const rows=[...document.querySelectorAll('[data-i]')];
    if(rows[rows.length-1].querySelector('[data-f=name]').value.trim())$('#ings').insertAdjacentHTML('beforeend',ingHtml());
    const r=e.target.closest('[data-i]');if(r&&e.target.dataset.f==='name'){const p=findProd(prods,e.target.value);r.querySelector('[data-f=qty]').placeholder=p&&p.unit?p.unit:'Amount';}
    calc();
  });
  $('#ings').addEventListener('click',e=>{if(e.target.closest('[data-rmi]')){e.target.closest('[data-i]').remove();calc();}});
  ['rp','rpo'].forEach(i=>$('#'+i).oninput=calc);
  $('#addi').onclick=()=>$('#ings').insertAdjacentHTML('beforeend',ingHtml());
  if(id)$('#rdel').onclick=async()=>{if(confirm('Remove this menu item\'s costing?')){await updateDoc(doc(db,'boRecipes',id),{active:false});document.querySelector('[data-go=borec]').click();}};
  $('#rsave').onclick=async()=>{
    const name=$('#rn').value.trim();if(!name){alert('Please enter the menu item name.');return;}
    const ings=read().filter(i=>i.productId).map(({productId,qty})=>({productId,qty}));
    const d={name,squareName:$('#rsq').value,price:num($('#rp').value),portions:Math.max(1,num($('#rpo').value)||1),ingredients:ings};
    if(id)await updateDoc(doc(db,'boRecipes',id),{...d,editedBy:S.me,editedAt:serverTimestamp()});
    else await addDoc(collection(db,'boRecipes'),{...d,by:S.me,at:serverTimestamp(),active:true});
    document.querySelector('[data-go=borec]').click();
  };
}

// ---------- Inventory counts ----------
export function showCount(){
  setView(STYLE+topbar('Inventory Count','bo')+`<p class="mut small">Count what's on the shelves in each product's unit. Leave blank anything you didn't count (it counts as zero).</p>
  <input type="date" id="cd"><div id="cl"><p class="mut">Loading…</p></div>
  <div class="card"><div class="ih"><span>Value on hand</span><b id="cv">$0.00</b></div></div>
  <button class="btn full" id="csave">Save count</button><p id="cmsg" class="mut small"></p>
  <div class="sec">Past counts</div><div id="ch"></div>`);
  $('#cd').value=today();
  let prods=[],last=null,vals={};
  const draw=()=>{
    const g={};prods.forEach(p=>{const c=p.category||'Uncategorized';(g[c]=g[c]||[]).push(p);});
    $('#cl').innerHTML=prods.length?Object.keys(g).sort().map(c=>`<div class="sec">${esc(c)}</div><div class="card">`+g[c].map(p=>`<div class="bo-cnt"><div>${esc(p.name)}<div class="mut small">${p.lastPrice?per(p.lastPrice,p.unit):'no price yet'}${last&&last[p.id]!=null?' · last '+last[p.id]:''}</div></div><input data-c="${p.id}" inputmode="decimal" placeholder="${esc(p.unit||'qty')}" value="${vals[p.id]??''}"></div>`).join('')+'</div>').join('')
      :'<p class="mut center">No products yet. Enter an invoice first.</p>';
    total();
  };
  const total=()=>{$('#cv').textContent=money(prods.reduce((a,p)=>a+(num(vals[p.id])*(p.lastPrice||0)),0));};
  watchProducts(l=>{prods=l;draw();});
  sub(onSnapshot(query(collection(db,'boCounts'),orderBy('date','desc'),limit(12)),s=>{
    const rows=s.docs.map(dd);last=rows[0]?Object.fromEntries((rows[0].lines||[]).map(l=>[l.productId,l.qty])):null;
    $('#ch').innerHTML=rows.length?'<div class="card">'+rows.map(c=>`<div class="hl ih"><span>${esc(dlabel(c.date))} · ${esc(c.by||'')}</span><b>${money(c.value)}</b></div>`).join('')+'</div>':'<p class="mut small">No counts yet.</p>';
    if(!document.activeElement||!document.activeElement.dataset.c)draw();
  }));
  $('#cl').addEventListener('input',e=>{if(e.target.dataset.c){vals[e.target.dataset.c]=e.target.value;total();}});
  $('#csave').onclick=async()=>{
    const date=$('#cd').value;if(!date){alert('Pick the count date.');return;}
    const lines=prods.filter(p=>String(vals[p.id]??'').trim()!=='').map(p=>({productId:p.id,name:p.name,qty:num(vals[p.id]),price:p.lastPrice||0}));
    if(!lines.length){alert('Enter at least one count.');return;}
    const value=Math.round(lines.reduce((a,l)=>a+l.qty*l.price,0)*100)/100;
    $('#csave').disabled=true;
    try{await addDoc(collection(db,'boCounts'),{date,lines,value,by:S.me,at:serverTimestamp()});vals={};$('#cmsg').textContent='Saved. Value on hand: '+money(value);draw();}
    catch(e){$('#cmsg').textContent='Couldn\'t save: '+e.message;}
    $('#csave').disabled=false;
  };
}

// ---------- Food cost & P&L ----------
function ranges(){
  const t=new Date(),d=n=>dstr(new Date(t.getFullYear(),t.getMonth(),t.getDate()-n));
  const first=new Date(t.getFullYear(),t.getMonth(),1),lastStart=new Date(t.getFullYear(),t.getMonth()-1,1),lastEnd=new Date(t.getFullYear(),t.getMonth(),0);
  return {today:['Today',today(),today()],week:['Last 7 days',d(6),today()],month:['This month',dstr(first),today()],last:['Last month',dstr(lastStart),dstr(lastEnd)]};
}
export function showPL(){
  const R=ranges();
  setView(STYLE+topbar('Food Cost & P&L','bo')+`<div class="bo-range">${Object.entries(R).map(([k,v])=>`<button data-r="${k}" class="${k==='week'?'on':''}">${v[0]}</button>`).join('')}</div>
  <div id="pl"><p class="mut">Loading sales from Square…</p></div>`);
  let prods=[],recs=[],key='week',seq=0;
  const load=async()=>{
    const my=++seq;const [,from,to]=R[key];
    $('#pl').innerHTML='<p class="mut">Loading sales from Square…</p>';
    try{
          const [sales,invS,cntS]=await Promise.all([
        boApi('sales',{from,to}),
        getDocs(query(collection(db,'boInvoices'),where('date','>=',from))),
        getDocs(query(collection(db,'boCounts'),orderBy('date','desc'),limit(60)))
      ]);
      if(my!==seq)return;
      const invs=invS.docs.map(dd).filter(i=>i.date<=to);
      const counts=cntS.docs.map(dd);
      render(from,to,sales,invs,counts);
    }catch(e){if(my===seq)$('#pl').innerHTML=`<p class="bad">${esc(e.message)}</p>`;}
  };
  const render=(from,to,sales,invs,counts)=>{
    const S$=sales.days.reduce((a,d)=>a+d.sales,0)/100,orders=sales.days.reduce((a,d)=>a+d.orders,0);
    const P$=invs.reduce((a,i)=>a+(Number(i.total)||0),0);
    // Theoretical cost: what sold × recipe cost
    const recBy={};recs.forEach(r=>{if(r.squareName)recBy[r.squareName.toLowerCase()]=r;recBy[r.name.toLowerCase()]=recBy[r.name.toLowerCase()]||r;});
    let theo=0,covered=0;
    const itemRows=sales.items.map(it=>{const r=recBy[it.name.toLowerCase()];const each=r?recipeCost(r,prods).each:null;if(r){theo+=each*it.qty;covered+=it.sales;}return {...it,each};});
    // Actual cost: opening count + purchases − closing count
    const open=counts.filter(c=>c.date<from)[0],close=counts.filter(c=>c.date<=to&&c.date>=from)[0];
    const actual=open&&close?open.value+invs.filter(i=>i.date>open.date&&i.date<=close.date).reduce((a,i)=>a+(Number(i.total)||0),0)-close.value:null;
    const byDay={};sales.days.forEach(d=>byDay[d.date]={date:d.date,sales:d.sales/100,orders:d.orders,purch:0});
    invs.forEach(i=>{(byDay[i.date]=byDay[i.date]||{date:i.date,sales:0,orders:0,purch:0}).purch+=Number(i.total)||0;});
    const days=Object.values(byDay).sort((a,b)=>b.date.localeCompare(a.date));
    $('#pl').innerHTML=`
    <div class="bo-kpis">
      <div class="bo-kpi"><span class="mut small">Net sales</span><b>${money0(S$)}</b><span class="mut small">${orders} orders</span></div>
      <div class="bo-kpi"><span class="mut small">Purchases</span><b>${money0(P$)}</b><span class="mut small ${S$?fcClass(pct(P$,S$)):''}">${S$?pctTxt(pct(P$,S$))+' of sales':''}</span></div>
      <div class="bo-kpi"><span class="mut small">Ideal food cost</span><b class="${S$?fcClass(pct(theo,S$)):''}">${S$&&theo?pctTxt(pct(theo,S$)):'—'}</b><span class="mut small">${theo?money0(theo)+' from recipes':'cost your menu items'}</span></div>
      <div class="bo-kpi"><span class="mut small">Actual food cost</span><b class="${actual!=null&&S$?fcClass(pct(actual,S$)):''}">${actual!=null&&S$?pctTxt(pct(actual,S$)):'—'}</b><span class="mut small">${actual!=null?money0(actual)+' used':'needs counts before & during'}</span></div>
    </div>
    ${S$&&covered<S$*0.7&&recs.length?`<p class="mut small">Recipes cover ${pctTxt(pct(covered,S$))} of sales. Cost more menu items for a fuller ideal food cost.</p>`:''}
    ${sales.partial?'<p class="warn small">Very busy range: only part of the sales loaded. Pick a shorter range.</p>':''}
    <div class="sec">Daily P&L</div>
    <div class="card"><table class="bo-t"><tr><th>Day</th><th class="r">Sales</th><th class="r">Purchases</th><th class="r">Gross</th></tr>
      ${days.length?days.map(d=>`<tr><td>${esc(dlabel(d.date))}<div class="mut small">${d.orders} orders</div></td><td class="r">${money0(d.sales)}</td><td class="r">${d.purch?money0(d.purch):'—'}</td><td class="r">${money0(d.sales-d.purch)}</td></tr>`).join(''):'<tr><td colspan="4" class="mut">No sales or invoices in this range.</td></tr>'}
    </table></div>
    <div class="sec">What sold</div>
    <div class="card"><table class="bo-t"><tr><th>Item</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Food cost</th></tr>
      ${itemRows.length?itemRows.slice(0,40).map(it=>{const fc=it.each!=null&&it.sales?pct(it.each*it.qty,it.sales/100):null;return `<tr><td>${esc(it.name)}</td><td class="r">${Math.round(it.qty*100)/100}</td><td class="r">${money0(it.sales/100)}</td><td class="r ${fc!=null?fcClass(fc):'mut'}">${fc!=null?pctTxt(fc):'—'}</td></tr>`;}).join(''):'<tr><td colspan="4" class="mut">No items sold in this range.</td></tr>'}
    </table></div>
    <p class="mut small">Ideal food cost = what sold × each item's recipe cost. Actual food cost = last count before the range + purchases − latest count in the range. Gross = sales − purchases (labor and other costs aren't included).</p>`;
  };
  watchProducts(l=>{prods=l;});
  sub(onSnapshot(collection(db,'boRecipes'),s=>{recs=s.docs.map(dd).filter(live);}));
  document.querySelector('.bo-range').onclick=e=>{const b=e.target.closest('[data-r]');if(!b)return;key=b.dataset.r;document.querySelectorAll('.bo-range button').forEach(x=>x.classList.toggle('on',x===b));load();};
  setTimeout(load,300);
}
// END
