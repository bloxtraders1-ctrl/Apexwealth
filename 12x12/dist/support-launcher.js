import {api,element,link} from './cashier-api.js';
import {icon} from './ui.js';
import {button} from './manual-ui.js';

const styles=element('link');
styles.rel='stylesheet';
styles.href='/support.css';
document.head.append(styles);

const control=button(null,open,'support-launcher');
control.innerHTML=icon('support');
control.setAttribute('aria-label','Support');
control.setAttribute('aria-haspopup','dialog');
control.title='Support';
const dialog=element('dialog',null,'support-dialog');
dialog.setAttribute('aria-labelledby','support-title');
const header=element('header',null,'support-dialog-head');
const title=element('h2','12x12 Support');title.id='support-title';
const close=button('×',()=>dialog.close(),'wallet-close support-close');
close.setAttribute('aria-label','Close support');
header.append(title,close);
const body=element('div',null,'support-dialog-body');
dialog.append(header,body);
document.body.append(control,dialog);
let revision=0;
let widgetReady;
const widget={organization:'a12x12',appId:'b1c8fb61-d743-41ae-b821-8b9cecbeed00'};
function loadWidget(){
 return widgetReady??=new Promise((resolve,reject)=>{
  window.helpcrunchSettings={...widget,showWidget:false};
  function queue(){queue.q.push(arguments);}
  queue.q=[];
  window.HelpCrunch=queue;
  const script=element('script');
  script.async=true;
  script.src='https://embed.helpcrunch.com/sdk.js';
  const timeout=setTimeout(fail,12000);
  function fail(){
   clearTimeout(timeout);
   script.remove();
   if(window.HelpCrunch===queue)delete window.HelpCrunch;
   reject(new Error('Live chat is unavailable right now. You can still open a support ticket.'));
  }
  script.addEventListener('error',fail,{once:true});
  queue('onReady',()=>{
   clearTimeout(timeout);
   script.removeEventListener('error',fail);
   resolve();
  });
  document.head.append(script);
 }).catch(error=>{
  widgetReady=undefined;
  throw error;
 });
}

function offerLiveChat(panel,current){
 const feedback=element('p',null,'wallet-feedback');
 feedback.setAttribute('role','status');
 const chat=button('Start live chat',async()=>{
  chat.disabled=true;
  feedback.textContent='Opening live chat…';
  try{
   await loadWidget();
   if(current===revision&&dialog.open){
    dialog.close();
    window.HelpCrunch('openChat');
   }
  }catch(error){feedback.textContent=error.message;}
  finally{chat.disabled=false;}
 },'primary');
 panel.append(chat,feedback);
 panel.hidden=false;
}

async function open(){
 if(dialog.open)return;
 const current=++revision;
 const panel=element('section');
 panel.append(element('p','Loading support tickets…','secondary'));
 const live=element('section',null,'support-live-chat');
 live.hidden=true;
 body.replaceChildren(live,panel);
 dialog.showModal();
 if(['index','plan','referrals','faq','how-it-works'].includes(document.body.dataset.page)){
  offerLiveChat(live,current);
 }
 try{
  const [status,{mountSupport}]=await Promise.all([api('status'),import('./support-ui.js')]);
  if(current!==revision)return;
  if(!status.signedIn){
   panel.replaceChildren(element('p','Log in to open a ticket or read replies.','secondary'),
    link('/login?next='+encodeURIComponent('/?support=open'),'Log in','primary'));
   return;
  }
  await mountSupport(panel);
 }catch(error){if(current===revision)panel.replaceChildren(element('p',error.message,'wallet-feedback'));}
}
dialog.addEventListener('close',()=>{
 revision++;
 const url=new URL(location.href);
 if(url.searchParams.get('support')==='open'){url.searchParams.delete('support');history.replaceState(null,'',url);}
});
if(new URLSearchParams(location.search).get('support')==='open')open();
