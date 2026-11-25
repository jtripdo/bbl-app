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

const cur={v:'who'};

function renderBar(){
  $('#bar').innerHTML=S.me?`<span>Signed in as <b>${esc(S.me)}</b></span><button class="link" id="signOut">Sign out</button>`:'';
}

// Page access by role (set by owners on the Team screen). Owners see everything.
const PAGE_OF={parhist:'par',mpmenu:'mealprep',mprecipes:'mealprep',mppar:'mealprep',mpparhist:'mealprep',load:'events',popload:'events',poptemplate:'events'};
export const canSee=p=>S.role==='owner'||((S.access&&S.access[p])||['manager','staff']).includes(S.role);

function showDash(){
  const tiles=[['par','box','Par Sheets'],['opening','sun','Opening'],['closing','moon','Closing'],['cleaning','sparkles','Cleaning'],['prep','chef','Prep Sheet'],['mealprep','utensils','Meal Prep'],['chat','chat','Team Chat'],['needs','cart','Needs & Wants'],['events','calendar','Events'],['people','users','Team'],['mode','tablet','Device Mode']];
  setView(`<p class="center mut">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p><div class="grid">${canSee('today')?`<button class="tile wide" data-go="today"><span>${ic('today',24)}</span>Today</button>`:''}${tiles.filter(t=>canSee(t[0])).map(t=>`<button class="tile" data-go="${t[0]}"><span>${ic(t[1],26)}</span>${t[2]}</button>`).join('')}</div>`);
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
