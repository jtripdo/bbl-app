import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {initializeFirestore,getFirestore,persistentLocalCache,persistentMultipleTabManager,collection,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,where,orderBy,limit,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export {collection,doc,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,where,orderBy,limit,serverTimestamp};

const firebaseConfig={
  apiKey:"AIzaSyCV4nlJD5Uq6pS-P_sabpzHUjgi2kf_6Uk",
  authDomain:"bbl-app-d58e6.firebaseapp.com",
  projectId:"bbl-app-d58e6",
  storageBucket:"bbl-app-d58e6.firebasestorage.app",
  messagingSenderId:"159270496914",
  appId:"1:159270496914:web:8076c4dda73557bc2f544b"
};
const app=initializeApp(firebaseConfig);
let _db;
try{_db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});}
catch(e){_db=getFirestore(app);}
export const db=_db;

// Only used the very first time, to fill the team list. After that, use the Team tile in the app.
export const DEFAULT_TEAM=["Joe D.","Noel C.","Bernard S."];

export const S={me:null,subs:[],team:[]};
try{S.me=localStorage.getItem('bblName');}catch(e){}

export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const slug=n=>String(n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
export const sub=u=>S.subs.push(u);
export const clearSubs=()=>{S.subs.forEach(u=>u());S.subs=[];};
export const dstr=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
export const today=()=>dstr(new Date());
export const fmt=ts=>{const d=ts&&ts.toDate?ts.toDate():new Date();return d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
export const dd=d=>({id:d.id,...d.data({serverTimestamps:'estimate'})});
export const dlabel=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'});};
export const t12=t=>{if(!t)return '';const [h,m]=t.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM');};
export const setView=h=>{$('#view').innerHTML=h;window.scrollTo(0,0);};
export const topbar=(t,back='dash')=>`<div class="top"><button class="back" data-go="${back}">← Back</button><h2>${esc(t)}</h2></div>`;
// END
