import {db,S,$,esc,clearSubs,today,setView,DEFAULT_TEAM,slug,collection,doc,setDoc,onSnapshot,serverTimestamp} from './core.js';
import {showList} from './list.js';
import {showPar,showParHist} from './par.js';
import {showChat,showNeeds} from './team.js';
import {showEvents} from './events.js';
import {showToday} from './today.js';
import {showPeople} from './people.js';
import {showMealPrep,showMenu,ic} from './mealprep.js';
import {showRecipes} from './recipes.js';
import {showMpPar,showMpParHist} from './mppar.js';

const cur={v:'who'};

function renderBar(){
  $('#bar').innerHTML=S.me?`<span>Working as <b>${esc(S.me)}</b></span><button class="link" data-go="who">Switch</button>`:'';
}

function showWho(){
  setView(`<h2 class="center">Who's working?</h2>`+(S.team.length?S.team.map(n=>`<button class="big" data-who="${esc(n)}">${esc(n)}</button>`).join(''):'<p class="mut center">Loading your team...</p>'));
}

function showDash(){
  const tiles=[['par','box','Par Sheets'],['opening','sun','Opening'],['closing','moon','Closing'],['cleaning','sparkles','Cleaning'],['prep','chef','Prep Sheet'],['mealprep','utensils','Meal Prep'],['chat','chat','Team Chat'],['needs','cart','Needs & Wants'],['events','calendar','Events'],['people','users','Team']];
  setView(`<p class="center mut">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p><div class="grid"><button class="tile wide" data-go="today"><span>${ic('today',24)}</span>Today</button>${tiles.map(t=>`<button class="tile" data-go="${t[0]}"><span>${ic(t[1],26)}</span>${t[2]}</button>`).join('')}</div>`);
}

function go(v,arg,title){
  clearSubs();
  if(!S.me&&v!=='who')v='who';
  cur.v=v;
  renderBar();
  const views={
    who:showWho,dash:showDash,today:showToday,people:showPeople,par:showPar,parhist:showParHist,
    mealprep:showMealPrep,mpmenu:showMenu,mprecipes:showRecipes,mppar:showMpPar,mpparhist:showMpParHist,
    opening:()=>showList('opening','Opening Checklist',{note:'This list resets every day.'}),
    closing:()=>showList('closing','Closing Checklist',{note:'This list resets every day.'}),
    cleaning:()=>showList('cleaning','Cleaning List',{note:'This list resets every day.'}),
    prep:()=>showList('prep_'+today(),'Prep Sheet',{ph:'Add a prep task (e.g. 4 lb butter, cubed)',note:'This list is just for today. Tomorrow starts fresh.'}),
    chat:showChat,needs:showNeeds,events:showEvents,
    load:()=>showList('load_'+arg,'Load Out: '+(title||'Event'),{key:'event',back:'events',ph:'Add something to load (e.g. 2 hotel pans)'})
  };
  (views[v]||showDash)();
}

document.addEventListener('click',e=>{
  const w=e.target.closest('[data-who]');
  if(w){S.me=w.dataset.who;try{localStorage.setItem('bblName',S.me);}catch(x){}go('today');return;}
  const t=e.target.closest('[data-go]');
  if(t)go(t.dataset.go,t.dataset.arg,t.dataset.title);
});

// Keeps the team list up to date, and fills it with the starting names the very first time
let seeded=false;
onSnapshot(collection(db,'team'),{includeMetadataChanges:true},snap=>{
  if(snap.empty){
    if(!snap.metadata.fromCache&&!seeded){
      seeded=true;
      DEFAULT_TEAM.forEach(n=>setDoc(doc(db,'team',slug(n)),{name:n,active:true,at:serverTimestamp()}));
    }
    return;
  }
  S.team=snap.docs.map(d=>d.data()).filter(p=>p.active!==false).map(p=>p.name).sort((a,b)=>a.localeCompare(b));
  if(S.me&&S.team.length&&!S.team.includes(S.me)){
    S.me=null;try{localStorage.removeItem('bblName');}catch(x){}
    go('who');return;
  }
  if(cur.v==='who')showWho();
});

go(S.me?'today':'who');
// END
