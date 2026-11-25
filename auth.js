// Sign-in, invite sign-up, password reset links and first-time owner setup.
import {signInWithEmailAndPassword,signOut as fbSignOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {auth,teamApi,$,esc,setView} from './core.js';

const EMAIL_DOMAIN='staff.buttermilkbiscuitlab.com';
const emailFor=u=>`${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export const inviteCode=()=>new URLSearchParams(location.search).get('invite');
function clearInviteFromUrl(){try{history.replaceState(null,'',location.pathname);}catch(e){}}

const field=(id,label,type='text',extra='')=>`<label class="mut small" for="${id}" style="display:block;margin-top:12px">${label}</label><input id="${id}" type="${type}" ${extra} style="width:100%">`;
const err=()=>`<p id="aerr" class="small" style="color:#ff8a7a;min-height:1.3em"></p>`;
const showErr=m=>{const e=$('#aerr');if(e)e.textContent=m;};
const busy=(id,on,txt)=>{const b=$('#'+id);if(b){b.disabled=on;if(txt)b.textContent=txt;}};

export async function signIn(username,password){
  try{await signInWithEmailAndPassword(auth,emailFor(username),password);}
  catch(e){
    const c=String(e.code||'');
    if(c.includes('invalid-credential')||c.includes('wrong-password')||c.includes('user-not-found')||c.includes('invalid-email'))throw new Error('Wrong username or password.');
    if(c.includes('too-many-requests'))throw new Error('Too many tries. Wait a few minutes and try again.');
    if(c.includes('user-disabled'))throw new Error('This account was turned off. Ask a manager.');
    if(c.includes('network'))throw new Error('No internet connection.');
    throw new Error('Could not sign in. Please try again.');
  }
}
export const signOut=()=>fbSignOut(auth);

export async function showLogin(msg){
  setView(`<h2 class="center">Sign in</h2>
  <div class="card">${field('lu','Username','text','autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"')}
  ${field('lp','Password','password','autocomplete="current-password"')}
  ${err()}<button class="big" id="lgo">Sign in</button></div>
  <p class="mut small center">New to the team? Open the invite link a manager sent you.<br>Forgot your password? Ask a manager for a reset link.</p>
  <p class="center" id="setupLink"></p>`);
  if(msg)showErr(msg);
  const go=async()=>{
    const u=$('#lu').value.trim(),p=$('#lp').value;
    if(!u||!p)return showErr('Enter your username and password.');
    busy('lgo',true,'Signing in…');
    try{await signIn(u,p);}catch(e){showErr(e.message);busy('lgo',false,'Sign in');}
  };
  $('#lgo').onclick=go;
  $('#lp').onkeydown=e=>{if(e.key==='Enter')go();};
  try{const st=await teamApi('status');if(!st.hasOwner&&$('#setupLink'))$('#setupLink').innerHTML='<button class="link" id="ownerSetup">First time? Set up the owner account</button>';
    const b=$('#ownerSetup');if(b)b.onclick=showOwnerSetup;}catch(e){}
}

export function showOwnerSetup(){
  setView(`<h2 class="center">Set up BBL</h2><p class="mut center small">Create the owner account. You'll invite everyone else from the Team screen.</p>
  <div class="card">${field('on','Your name (shown on checklists)','text','maxlength="40" autocomplete="name"')}
  ${field('ou','Choose a username','text','autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"')}
  ${field('op','Choose a password (8+ characters)','password','autocomplete="new-password"')}
  ${field('op2','Type the password again','password','autocomplete="new-password"')}
  ${err()}<button class="big" id="ogo">Create owner account</button></div>`);
  $('#ogo').onclick=async()=>{
    const name=$('#on').value.trim(),u=$('#ou').value.trim().toLowerCase(),p=$('#op').value;
    if(p!==$('#op2').value)return showErr("The passwords don't match.");
    busy('ogo',true,'Creating…');
    try{await teamApi('setupOwner',{name,username:u,password:p});await signIn(u,p);}
    catch(e){showErr(e.message);busy('ogo',false,'Create owner account');}
  };
}

export async function showRedeem(code){
  setView('<p class="center mut">Checking your link…</p>');
  let inv;
  try{inv=await teamApi('checkInvite',{code});}
  catch(e){clearInviteFromUrl();return showLogin(e.message);}
  const reset=inv.kind==='reset';
  setView(`<h2 class="center">${reset?'Reset your password':'Welcome to BBL, '+esc(inv.name)+'!'}</h2>
  <p class="mut center small">${reset?'Username: <b>'+esc(inv.username)+'</b>':'Create your login. You\'ll use it to sign in to the BBL app.'}</p>
  <div class="card">${reset?'':field('ru','Choose a username','text','autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"')+'<div class="mut small">3–20 letters or numbers (dots, dashes and underscores are OK).</div>'}
  ${field('rp',reset?'New password (8+ characters)':'Choose a password (8+ characters)','password','autocomplete="new-password"')}
  ${field('rp2','Type the password again','password','autocomplete="new-password"')}
  ${err()}<button class="big" id="rgo">${reset?'Save new password':'Create my account'}</button></div>
  <p class="mut small center">After this, add the app to your home screen: tap Share, then Add to Home Screen.</p>`);
  $('#rgo').onclick=async()=>{
    const u=reset?inv.username:$('#ru').value.trim().toLowerCase(),p=$('#rp').value;
    if(p!==$('#rp2').value)return showErr("The passwords don't match.");
    busy('rgo',true,'Saving…');
    try{const r=await teamApi('redeem',{code,username:u,password:p});clearInviteFromUrl();await signIn(r.username||u,p);}
    catch(e){showErr(e.message);busy('rgo',false,reset?'Save new password':'Create my account');}
  };
}
// END
