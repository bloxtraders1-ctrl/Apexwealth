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
async function open(){
 if(dialog.open)return;
 const current=++revision;
 body.replaceChildren(element('p','Loading support…','secondary'));
 dialog.showModal();
 try{
  const [status,{mountSupport}]=await Promise.all([api('status'),import('./support-ui.js')]);
  if(current!==revision)return;
  if(!status.signedIn){
   body.replaceChildren(element('p','Log in to open a ticket or read replies.','secondary'),
    link('/login?next='+encodeURIComponent('/?support=open'),'Log in','primary'));
   return;
  }
  const panel=element('section');
  body.replaceChildren(panel);
  await mountSupport(panel);
 }catch(error){if(current===revision)body.replaceChildren(element('p',error.message,'wallet-feedback'));}
}
dialog.addEventListener('close',()=>{
 revision++;
 const url=new URL(location.href);
 if(url.searchParams.get('support')==='open'){url.searchParams.delete('support');history.replaceState(null,'',url);}
});
if(new URLSearchParams(location.search).get('support')==='open')open();
