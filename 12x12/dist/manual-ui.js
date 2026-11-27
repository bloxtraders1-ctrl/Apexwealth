import {api,element,link} from './cashier-api.js';

export const cashier=(path,body)=>api('manual/'+path,body);
const usd = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
export const cents=value=>usd.format(Number(value)/100);
export const when=seconds=>new Date(seconds*1000).toLocaleString();
const networkLabels={bsc:'BNB Smart Chain',xrpl:'XRP Ledger'};
export const assetLabel=option=>option.symbol+' · '+(networkLabels[option.network]||option.network);
export const statusLabel=status=>({
 pending:'Awaiting review',approved:'Credited',processing:'In review',broadcasting:'Payout in progress',
 sent:'Sent · awaiting cashier approval',completed:'Completed',rejected:'Rejected',cancelled:'Cancelled'
}[status]||status);

export function field(parent,label,attributes={}){
 const {tag='input',...props}=attributes;
 const input=Object.assign(element(tag,null,'field'),props);
 const wrapper=element('label',label,'manual-field');
 wrapper.append(input);parent.append(wrapper);
 return input;
}
export function button(text,handler,style='muted-button'){
 const control=element('button',text,style);
 control.type='button';if(handler)control.onclick=handler;
 return control;
}
export function notice(){
 const message=element('p',null,'wallet-feedback');
 message.setAttribute('role','status');return message;
}
export function bindForm(form,submit,message,handler){
 let busy=false;
 form.onsubmit=async event=>{
  event.preventDefault();
  if(busy)return;
  const label=submit.textContent;
  busy=true;submit.disabled=true;message.textContent='';
  submit.textContent='Working…';
  message.dataset.tone='success';
  try{await handler();}
  catch(error){message.dataset.tone='error';message.textContent=error.message;}
  finally{busy=false;submit.disabled=false;if(submit.textContent==='Working…')submit.textContent=label;}
 };
}
export function submitButton(form,label){
 const submit=element('button',label,'primary');submit.type='submit';form.append(submit);return submit;
}
export function makeDetails(values){
 const list=element('dl',null,'manual-record');
 for(const [name,value] of values){
  const term=element('dt',name), detail=element('dd');
  if(value instanceof Node)detail.append(value);else detail.textContent=value??'—';
  list.append(term,detail);
 }
 return list;
}
export function transactionLink(option,tx){
 if(!tx||!option?.explorer)return tx||'—';
 const a=link(option.explorer+encodeURIComponent(tx),tx+' ↗');
 a.target='_blank';a.rel='noopener noreferrer';
 return a;
}
export function appendPager(container,rows,next){
 if(rows.length===50)container.append(button('Load older requests',()=>next(rows.at(-1))));
}
