import {createWalletControl} from './wallet-dialog.js';
import {api,element,link,setKey} from './cashier-api.js';
import {icon} from './ui.js';
const nextParam=new URLSearchParams(location.search).get('next');
let target;
try{target=new URL(nextParam||'/',location.origin);}catch{target=new URL('/',location.origin);}
const authPages=['/','/plan','/admin/cashier','/cashier-review','/profile','/portfolio','/referrals','/faq','/how-it-works'];
target.searchParams.delete('wallet');
const next=target.origin===location.origin&&authPages.includes(target.pathname)?target.pathname+target.search:'/';
const mode=document.body.dataset.page;
const form=document.getElementById('auth-form');
if(form){
 const other=document.getElementById('switch-auth');
 other.href=other.pathname+'?next='+encodeURIComponent(next);
 form.onsubmit=async e=>{
  e.preventDefault();
  const feedback=document.getElementById('feedback'), pass=form.elements.password.value;
  if(mode==='register'&&pass!==document.getElementById('confirm').value){feedback.textContent='Passwords must match.';return;}
  const button=form.querySelector('button');button.disabled=true;
  try{
   await api(mode,{email:form.elements.email.value,password:pass});
   location.assign(next);
  }catch(error){feedback.textContent=error.message;}
  finally{button.disabled=false;}
 };
}
const nav=document.querySelector('.account-nav');
if(nav){
 const statusRequest=api('status');
 const wallet=statusRequest.then(createWalletControl);
 document.addEventListener('click',event=>{
  const anchor=event.target.closest('a[href]');
  if(!anchor||anchor.target==='_blank'||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const dest=new URL(anchor.href);
  const page=dest.pathname.replace(/(?:\.html|\/)$/,'');
  if(dest.origin!==location.origin||!['/deposit','/withdraw','/cashier'].includes(page))return;
  event.preventDefault();
  const direction=page==='/withdraw'||dest.searchParams.get('wallet')==='withdraw'?'Withdraw':'Deposit';
  wallet.then(control=>control.open(direction,dest.searchParams,anchor)).catch(()=>location.assign(anchor.href));
 });
 const initial=new URLSearchParams(location.search);
 if(['deposit','withdraw'].includes(initial.get('wallet'))){
  wallet.then(control=>control.open(initial.get('wallet')==='withdraw'?'Withdraw':'Deposit',initial,
   nav.querySelector('button, a'))).catch(()=>{});
 }
 statusRequest.then(async status=>{
  if(!status.signedIn){
   if(!form)for(const a of nav.querySelectorAll('a'))a.search='?next='+encodeURIComponent(location.pathname+location.search);
   return;
  }
  const logout=element('button','Log out','muted-button');
  logout.onclick=async()=>{logout.disabled=true;try{await api('logout',{});setKey('');location.assign('/login');}catch{logout.textContent='Retry logout';logout.disabled=false;}};
  const accountMenu=element('details',null,'account-menu');
  const menuTrigger=element('summary',null,'profile-trigger');
  menuTrigger.innerHTML=icon('profile');
  menuTrigger.setAttribute('aria-label','Account menu');
  const choices=element('div',null,'account-menu-links');
  const profile=link('/profile','Profile','plain');
  if(mode==='profile')profile.setAttribute('aria-current','page');
  choices.append(profile,logout);
  accountMenu.append(menuTrigger,choices);
  document.addEventListener('click',event=>{if(!accountMenu.contains(event.target))accountMenu.open=false;});
  accountMenu.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&accountMenu.open){event.preventDefault();accountMenu.open=false;menuTrigger.focus();}
  });
  nav.replaceChildren((await wallet).trigger,accountMenu);
 }).catch(()=>{});
 wallet.catch(()=>{});
}

if(mode==='login'){
 const legacy=element('details',null,'panel auth-panel');
 const oldForm=element('form');
 oldForm.className='manual-form';
 for(const [name,label,type,autocomplete] of [
  ['username','Existing username','text','username'],
  ['password','Existing password','password','current-password'],
  ['email','Email address to use','email','email']
 ]){
  const field=element('input',null,'field');
  field.id='link-'+name;field.name=name;field.type=type;field.autocomplete=autocomplete;field.required=true;
  field.maxLength={username:32,password:128,email:254}[name];
  const labelNode=element('label',label);labelNode.htmlFor=field.id;
  oldForm.append(labelNode,field);
 }
 const submit=element('button','Link email','primary');
 const feedback=element('p',null,'feedback');feedback.setAttribute('role','status');
 oldForm.append(submit,feedback);
 legacy.append(element('summary','Link email to an existing account'),oldForm);
 form.after(legacy);
 oldForm.onsubmit=async e=>{
  e.preventDefault();
  submit.disabled=true;
  feedback.textContent='';
  try{await api('link-email',Object.fromEntries(new FormData(oldForm)));location.assign(next);}
  catch(error){feedback.textContent=error.message;}
  finally{submit.disabled=false;}
 };
 const status=await api('status').catch(()=>null);
 if(status?.mode==='selfhost'||(status?.mode==='account'&&status?.environment==='selfhost')){
  const details=element('details',null,'panel auth-panel');
  const restore=element('form'), input=element('input',null,'field');
  input.type='password';input.required=true;input.pattern='[a-fA-F0-9]{64}';input.autocomplete='off';input.id='legacy-key';
  const label=element('label','Existing recovery key');label.htmlFor=input.id;
  restore.append(label,input,element('button','Restore account','muted-button'));
  details.append(element('summary','Use an existing recovery key'),restore);form.after(details);
  restore.onsubmit=async e=>{e.preventDefault();try{
    const val=input.value.toLowerCase();
    const res=await fetch('/api/restore-key',{method:'POST',headers:{Authorization:'Bearer '+val,'Content-Type':'application/json'},body:'{}'});
    if(!res.ok)throw Error('Could not restore this account.');
    setKey(val);location.assign(next);
   }catch(err){document.getElementById('feedback').textContent=err.message;}};
 }
}
