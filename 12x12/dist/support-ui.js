import {element} from './cashier-api.js';
import {cashier,when,field,button,notice,bindForm,submitButton} from './manual-ui.js';

export async function mountSupport(container,{admin=false}={}){
 const path=(admin?'admin/':'')+'support/';
 const loading=element('p','Loading tickets…','secondary');
 container.replaceChildren(loading);
 const report=notice();

 async function list(offset=0){
  const {tickets,next}=await cashier(path+'tickets?offset='+offset);
  const title=element('h2',admin?'Support tickets':'Your tickets');
  const cards=element('div',null,'support-list');
  const nextPage=async()=>{if(next!==null)await list(next);};
  const controls=element('div',null,'support-actions');
  const actions=element('div',null,'support-actions');
  if(!admin)controls.append(button('New ticket',create,'primary'));
  controls.append(button('Refresh',()=>perform(()=>list(offset))));
  for(const ticket of tickets){
   const row=button(null,()=>perform(()=>thread(ticket.id,offset)),'support-ticket');
   row.append(element('strong',ticket.subject),
    element('span',(ticket.answered?'Answered':'Waiting for support')+' · '+when(ticket.updated),'support-ticket-meta'));
   if(admin)row.append(element('span',ticket.account||ticket.user_id,'support-ticket-meta'));
   cards.append(row);
  }
  if(!tickets.length)cards.append(element('p','No support tickets yet.','secondary'));
  if(offset>0)actions.append(button('Newer tickets',()=>perform(()=>list(Math.max(0,offset-50)))));
  if(next!==null)actions.append(button('Older tickets',()=>perform(nextPage)));
  container.replaceChildren(title,controls,report,cards,actions);
 }
 async function perform(operation){
  report.textContent='';
  try{await operation();}catch(error){report.textContent=error.message;}
 }
 function draft(){
  let pending;
  return data=>{
   const text=JSON.stringify(data);
   if(pending?.text!==text)pending={text,id:crypto.randomUUID()};
   return {...data,id:pending.id};
  };
 }
 function create(){
  const form=element('form',null,'manual-form support-form');
  const subject=field(form,'Subject',{required:true,minLength:3,maxLength:120});
  const message=field(form,'What can we help with?',{tag:'textarea',required:true,maxLength:2000,rows:4});
  const submit=submitButton(form,'Send ticket'),feedback=notice(),payload=draft();
  form.append(feedback);
  bindForm(form,submit,feedback,async()=>{
   const result=await cashier(path+'create',payload({subject:subject.value.trim(),message:message.value.trim()}));
   await thread(result.id);
  });
  container.replaceChildren(button('Back to tickets',()=>perform(()=>list())),element('h2','New ticket'),report,form);
  subject.focus();
 }
 async function thread(id,offset=0){
  const {ticket,messages}=await cashier(path+'thread?id='+encodeURIComponent(id));
  const stream=element('ol',null,'support-thread');
  const detail=element('p',(ticket.answered?'Answered':'Waiting for support')+' · Ticket '+ticket.id,'support-ticket-meta');
  for(const message of messages){
   const entry=element('li',null,'support-message');
   const sender=message.from_support?'12x12 Support':(admin?(ticket.account||ticket.user_id):'You');
   const header=element('div',null,'support-message-heading');
   const date=element('time',when(message.created));
   date.dateTime=new Date(message.created*1000).toISOString();
   header.append(element('strong',sender),date);
   entry.append(header,element('p',message.body));
   stream.append(entry);
  }
  const form=element('form',null,'manual-form support-form');
  const reply=field(form,'Reply',{tag:'textarea',required:true,maxLength:2000,rows:3});
  const submit=submitButton(form,'Send reply'),feedback=notice(),payload=draft();
  form.append(feedback);
  bindForm(form,submit,feedback,async()=>{
   await cashier(path+'reply',payload({ticketId:id,message:reply.value.trim()}));
   await thread(id,offset);
  });
  container.replaceChildren(button('Back to tickets',()=>perform(()=>list(offset))),
   element('h2',ticket.subject),detail,report,stream,form);
 }

 try{await list();}catch(error){container.replaceChildren(element('p',error.message,'wallet-feedback'));}
}
