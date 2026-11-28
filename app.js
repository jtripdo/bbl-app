import {db,auth,S,$,esc,clearSubs,today,setView,teamApi} from './core.js';
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {showLogin,showRedeem,signOut,inviteCode} from './auth.js';
import {showList} from './list.js';
import {showPar,showParHist} from './par.js';
import {showChat,showNeeds} from './team.js';
import {showEvents} from './events.js?v=20261125m';
import {showToday} from './today.js?v=20261125m';
import {showPeople} from './people.js';
import {showMealPrep,showMenu,ic} from './mealprep.js';
import {showRecipes} from './recipes.js';
import {showMpPar,showMpParHist} from './mppar.js';
import {showMode} from './mode.js';
import {showPopLoad,TEMPLATE} from './popload.js?v=20261125m';
import {showLabels,showPrepItems,showForecast} from './labels.js';
import {showLoyalty} from './loyalty.js';
import {showEightySix} from './eightysix.js';
import {showTemps} from './temps.js';
import {showHandoff} from './handoff.js';
import {watchAlerts} from './alerts.js';
import {showBO,showInvoices,showInvoiceForm,showProducts,showRecipeCosts,showRecipeForm,showCount,showPL} from './backoffice.js';

const cur={v:'who'};

function renderBar(){
  $('#bar').innerHTML=S.me?`<span>Signed in as <b>${esc(S.me)}</b></span><button class="link" id="signOut">Sign out</button>`:'';
}

// Page access by role (set by owners on the Team screen). Owners see everything.
const PAGE_OF={parhist:'par',mpmenu:'mealprep',mprecipes:'mealprep',mppar:'mealprep',mpparhist:'mealprep',load:'events',popload:'events',poptemplate:'events',bo:'backoffice',boinv:'backoffice',boinvnew:'backoffice',boprod:'backoffice',borec:'backoffice',borecedit:'backoffice',bocount:'backoffice',bopl:'backoffice',boforecast:'backoffice',prepitems:'labels'};
const MANAGER_ONLY=['people','backoffice'];
export const canSee=p=>S.role==='owner'||((S.access&&S.access[p])||(MANAGER_ONLY.includes(p)?['manager']:['manager','staff'])).includes(S.role);

function showDash(){
  const tiles=[['par','box','Par Sheets'],['opening','sun','Opening'],['closing','moon','Closing'],['cleaning','sparkles','Cleaning'],['prep','chef','Prep Sheet'],['mealprep','utensils','Meal Prep'],['chat','chat','Team Chat'],['needs','cart','Needs & Wants'],['events','calendar','Events'],['temps','thermo','Temp Log'],['handoff','note','Shift Handoff'],['eightysix','ban','86 Board'],['labels','tag','Prep & Labels'],['loyalty','star','Rewards'],['people','users','Team'],['backoffice','chart','Back Office'],['mode','tablet','Device Mode']];
  setView(`<p class="center mut">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p><div id="dashAlert"></div><div class="grid">${canSee('today')?`<button class="tile wide" data-go="today"><span>${ic('today',24)}</span>Today</button>`:''}${tiles.filter(t=>canSee(t[0])).map(t=>`<button class="tile" data-go="${t[0]}"><span>${ic(t[1],26)}</span>${t[2]}</button>`).join('')}</div>`);
  if(canSee('today'))watchAlerts(list=>{const el=document.getElementById('dashAlert');if(!el)return;const bad=list.some(a=>a.level==='bad');
    el.innerHTML=list.length?`<button class="card" data-go="today" style="width:100%;text-align:left;border:0;color:inherit;box-shadow:inset 4px 0 0 ${bad?'#ef8a6f':'var(--acc)'},var(--shadow);margin-bottom:12px"><b>${bad?'⚠️':'👀'} ${list.length} thing${list.length>1?'s':''} need${list.length>1?'':'s'} attention</b><div class="mut small">${list.slice(0,2).map(a=>a.text).join(' · ')}</div></button>`:'';});
}

function go(v,arg,title){
  clearSubs();
  cur.v=v;
  renderBar();
  if(!S.me){showLogin();return;}
  if(v!=='dash'&&!canSee(PAGE_OF[v]||v)){showDash();return;}
  const views={
    dash:showDash,today:showToday,people:showPeople,par:showPar,parhist:showParHist,
    mealprep:showMealPrep,mpmenu:showMenu,mprecipes:showRecipes,mppar:showMpPar,mpparhist:showMpParHist,
    opening:()=>showList('opening','Opening Checklist',{note:'This list resets every day.'}),
    closing:()=>showList('closing','Closing Checklist',{note:'This list resets every day.'}),
    cleaning:()=>showList('cleaning','Cleaning List',{note:'This list resets every day.'}),
    prep:()=>showList('prep_'+today(),'Prep Sheet',{ph:'Add a prep task (e.g. 4 lb butter, cubed)',note:'This list is just for today. Tomorrow starts fresh.'}),
    chat:showChat,needs:showNeeds,events:showEvents,mode:showMode,
    backoffice:showBO,bo:showBO,boinv:showInvoices,boinvnew:()=>showInvoiceForm(arg),boprod:showProducts,borec:showRecipeCosts,borecedit:()=>showRecipeForm(arg),bocount:showCount,bopl:showPL,boforecast:showForecast,labels:showLabels,prepitems:showPrepItems,loyalty:showLoyalty,eightysix:showEightySix,temps:showTemps,handoff:showHandoff,
    load:()=>showList('load_'+arg,'Load Out: '+(title||'Event'),{key:'event',back:'events',ph:'Add something to load (e.g. 2 hotel pans)'}),
    popload:()=>showPopLoad(arg,title),
    poptemplate:()=>showList(TEMPLATE,'Pop-up Load Out Template',{key:'template',back:'events',ph:'Add an item every pop-up needs',note:'Every pop-up gets these items on its Load Out Sheet. Mark items "Not needed" on a single pop-up instead of removing them here.'})
  };
  (views[v]||showDash)();
}

document.addEventListener('click',e=>{
  if(e.target.closest('#signOut')){if(confirm('Sign out of BBL on this device?'))signOut();return;}
  const t=e.target.closest('[data-go]');
  if(t)go(t.dataset.go,t.dataset.arg,t.dataset.title);
});

// Sign-in state: everything someone does is stamped with their own name.
onAuthStateChanged(auth,async user=>{
  clearSubs();
  if(!user){
    S.me=S.uid=S.role=S.username=null;renderBar();
    const code=inviteCode();
    if(code)showRedeem(code);else showLogin();
    return;
  }
  setView('<p class="center mut">Loading…</p>');
  let prof=null,why='This account is not active. Ask a manager.';
  for(let i=0;i<2&&!prof;i++){
    try{prof=await teamApi('me');}
    catch(e){why=e.message;if(/internet|fetch|network/i.test(why)){why='No internet connection. Try again.';break;}}
  }
  if(!prof){await signOut();showLogin(why);return;}
  S.me=prof.name;S.uid=user.uid;S.role=prof.role||'staff';S.username=prof.username;S.access=prof.access||null;
  if(inviteCode()){try{history.replaceState(null,'',location.pathname);}catch(e){}}
  go(canSee('today')?'today':'dash');
});
// END
