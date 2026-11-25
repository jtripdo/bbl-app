// Device mode: one app for everything. Each device remembers what it is used for
// and opens straight into it next time.
import {setView,esc} from './core.js';
import {ic} from './mealprep.js';

export const MODE_KEY='bblMode';
const MODES=[
  ['team','users','Team app','Checklists, par sheets, prep, chat and events.'],
  ['kds','monitor','Kitchen display','Live order tickets for one location. Good for the kitchen iPad.'],
  ['kiosk','tablet','Customer kiosk','Self-order screen for customers. To get back here, hold the logo on its start screen for 3 seconds.']
];

export function currentMode(){try{return localStorage.getItem(MODE_KEY)||'team';}catch(e){return 'team';}}

export function showMode(){
  const cur=currentMode();
  setView(`<div class="top"><button class="back" data-go="dash">← Menu</button><h2>Device Mode</h2></div>
  <p class="mut">Choose what this device is used for. It will open in this mode every time.</p>
  ${MODES.map(m=>`<button class="card modebtn" data-mode="${m[0]}" style="width:100%;text-align:left;${m[0]===cur?'outline:2px solid #f2c14e;':''}">
    <div class="ib" style="gap:10px"><b class="ib" style="gap:10px">${ic(m[1],24)} ${esc(m[2])}</b>${m[0]===cur?'<span class="small mut">· this device</span>':''}</div>
    <div class="mut small" style="margin-top:6px">${esc(m[3])}</div></button>`).join('')}`);
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-mode]');
  if(!b)return;
  const m=b.dataset.mode;
  try{localStorage.setItem(MODE_KEY,m);}catch(x){}
  if(m==='kds')location.href='kds.html';
  else if(m==='kiosk')location.href='kiosk.html';
  else showMode();
});
// END
