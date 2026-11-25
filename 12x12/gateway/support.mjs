import {check} from './chain.mjs';

const ticketFields=`t.id,t.subject,t.created,t.updated,t.answered`;
const validId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function requestId(value){
 check(typeof value==='string'&&validId.test(value),'Invalid ticket or message reference.');
 return value;
}
function ticketText(value,label,min,max){
 const text=typeof value==='string'?value.trim():'';
 check(text.length>=min&&text.length<=max,label+' must be '+min+'–'+max+' characters.');
 return text;
}

export function supportTickets({read,all,run,user,admin,now}){
 const accountFields=',t.user_id,COALESCE(a.email,a.username) AS account';
 const accountJoin=' LEFT JOIN login_accounts a ON a.id=t.user_id';
 function scope(asAdmin){
  check(!asAdmin||admin,'Cashier administrator access required.',403);
  return asAdmin?{fields:accountFields,join:accountJoin,filter:'1=1',params:[]}
   :{fields:'',join:'',filter:'t.user_id=?',params:[user]};
 }
 async function find(id,asAdmin){
  const {fields,join,filter,params}=scope(asAdmin);
  const result=await read('SELECT '+ticketFields+',t.body'+fields+' FROM support_tickets t'+join+
   ' WHERE t.id=? AND '+filter,id,...params);
  check(result,'Support ticket not found.',404);
  return result;
 }
 return {
  async list(offset,asAdmin){
   const page=Number(offset||0);
   check(Number.isSafeInteger(page)&&page>=0,'Invalid ticket page.');
   const {fields,join,filter,params}=scope(asAdmin);
   const rows=await all('SELECT '+ticketFields+fields+' FROM support_tickets t'+join+
    ' WHERE '+filter+' ORDER BY t.updated DESC,t.id DESC LIMIT 51 OFFSET ?',...params,page);
   return {tickets:rows.slice(0,50),next:rows.length>50?page+50:null};
  },
  async thread(value,asAdmin){
   const id=requestId(value);
   const ticket=await find(id,asAdmin);
   const replies=await all('SELECT from_support,body,created FROM support_replies WHERE ticket_id=? ORDER BY seq',id);
   return {ticket,messages:[{from_support:0,body:ticket.body,created:ticket.created},...replies]};
  },
  async create(body){
   const id=requestId(body.id);
   const subject=ticketText(body.subject,'Subject',3,120),message=ticketText(body.message,'Message',1,2000);
   await run('INSERT OR IGNORE INTO support_tickets(id,user_id,subject,body,created,updated) VALUES(?,?,?,?,?,?)',
    id,user,subject,message,now,now);
   const ticket=await find(id,false);
   check(ticket.subject===subject&&ticket.body===message,'This request ID is already in use.',409);
   return {id};
  },
  async reply(body,asAdmin){
   const id=requestId(body.id),ticketId=requestId(body.ticketId),message=ticketText(body.message,'Reply',1,2000);
   await find(ticketId,asAdmin);
   await run('INSERT OR IGNORE INTO support_replies(id,ticket_id,author_id,from_support,body,created) VALUES(?,?,?,?,?,?)',
    id,ticketId,user,Number(asAdmin),message,now);
   const row=await read('SELECT ticket_id,body,from_support FROM support_replies WHERE id=? AND author_id=?',id,user);
   check(row?.ticket_id===ticketId&&row.body===message&&row.from_support===Number(asAdmin),'This message ID is already in use.',409);
   return {id};
  }
 };
}
