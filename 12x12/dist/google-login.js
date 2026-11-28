import {api,element} from './cashier-api.js';

const outcomes={
 cancelled:'Google sign-in was canceled.',
 existing:'This email already has a 12x12 account. Sign in with your password, then link Google from Profile.',
 expired:'Google sign-in expired. Start again.',
 failed:'Could not verify your Google account. Try again.',
 linked:'Google is linked to this 12x12 account.',
 linked_elsewhere:'This Google account is already linked.',
 email:'Choose a Google account with a verified email address.',
 unregistered:'This Google account has no 12x12 account. Select Create an account to sign up with Google.',
 unavailable:'Google sign-in is currently unavailable. You can still use your email and password.'
};

function messageForPage(){
 const url=new URL(location.href);
 const key=url.searchParams.get('google');
 const result=Object.hasOwn(outcomes,key)?outcomes[key]:'';
 if(result){
  url.searchParams.delete('google');
  history.replaceState(history.state,'',url);
 }
 return typeof result==='string'?result:'';
}

function loadStyles(){
 if(!document.getElementById('google-login-styles')){
  const stylesheet=element('link');
  stylesheet.id='google-login-styles';
  stylesheet.rel='stylesheet';
  stylesheet.href='/google-login.css';
  document.head.append(stylesheet);
 }
}

function googleButton(label){
 loadStyles();
 const button=element('button',null,'google-login-button');
 const image=element('img');
 image.alt='';
 image.src='/assets/google-signin.svg';
 image.width=image.height=18;
 button.append(image,element('span',label));
 return button;
}

async function begin(intent,next,button,status,password){
 button.disabled=true;
 status.textContent='';
 try{
  const {url}=await api('google/start',{intent,next,password});
  location.assign(url);
 }catch(error){
  status.textContent=error.status===503||error.status===404||!error.status
   ?outcomes.unavailable:error.message;
  button.disabled=false;
 }
}

export function addGoogleSignIn(form,intent,next){
 const feedback=document.getElementById('feedback');
 const message=messageForPage();
 if(message)feedback.textContent=message;
 const button=form.querySelector('#google-auth-button');
 if(button)button.onclick=()=>begin(intent,next,button,feedback);
}

export function addGoogleLink(container){
 const message=messageForPage();
 void api('google/status').then(({enabled,linked})=>{
  if(!enabled&&!message)return;
  loadStyles();
  const section=element('section',null,'google-account');
  const status=element('p',message,'feedback');
  status.setAttribute('role','status');
  section.append(element('h3','Google sign-in'),status);
  if(linked){
   if(!message)status.textContent='Connected.';
  }else if(enabled){
   const form=element('form',null,'manual-form');
   const input=element('input',null,'field');
   input.id='google-link-password';
   input.type='password';
   input.required=true;
   input.maxLength=128;
   input.autocomplete='current-password';
   const label=element('label','Confirm your 12x12 password');
   label.htmlFor=input.id;
   const button=googleButton('Link Google account');
   button.type='submit';
   form.append(label,input,button);
   form.onsubmit=event=>{
    event.preventDefault();
    void begin('link','/profile',button,status,input.value);
    input.value='';
   };
   section.append(form);
  }
  container.append(section);
 }).catch(()=>{});
}
