import {S,TEAM,$,esc,clearSubs,today,setView} from './core.js';
import {showList} from './list.js';
import {showPar,showParHist} from './par.js';
import {showChat,showNeeds} from './team.js';
import {showEvents} from './events.js';

function renderBar(){
  $('#bar').innerHTML=S.me?`<span>Working as <b>${esc(S.me)}</b></span><button class="link" data-go="who">Switch</button>`:'';
}

function showWho(){
  setView(`<h2 class="center">Who's working?</h2>${TEAM.map(n=>`<button class="big" data-who="${esc(n)}">${esc(n)}</button>`).join('')}`);
}

function showDash(){
  const tiles=[['par','📦','Par Sheets'],['opening','☀️','Opening'],['closing','🌙','Closing'],['cleaning','🧽','Cleaning'],['prep','🔪','Prep Sheet'],['chat','💬','Team Chat'],['needs','🛒','Needs & Wants'],['events','📅','Events']];
  setView(`<p class="center mut">${new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}</p><div class="grid">${tiles.map(t=>`<button class="tile" data-go="${t[0]}"><span>${t[1]}</span>${t[2]}</button>`).join('')}</div>`);
}

function go(v,arg,title){
  clearSubs();
  if(!S.me&&v!=='who')v='who';
  renderBar();
  const views={
    who:showWho,dash:showDash,par:showPar,parhist:showParHist,
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
  if(w){S.me=w.dataset.who;try{localStorage.setItem('bblName',S.me);}catch(x){}go('dash');return;}
  const t=e.target.closest('[data-go]');
  if(t)go(t.dataset.go,t.dataset.arg,t.dataset.title);
});

go(S.me?'dash':'who');
// END
