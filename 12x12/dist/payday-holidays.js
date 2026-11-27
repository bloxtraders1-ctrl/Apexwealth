import {api,element} from './cashier-api.js';

const list=document.getElementById('payday-holidays');
const status=document.getElementById('payday-status');
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeZone:'UTC'});
try{
 const {holidays}=await api('payday-holidays');
 for(const {day,name} of holidays){
  const item=element('li');
  const date=element('time',dateFormat.format(new Date(day+'T00:00:00Z')));
  date.dateTime=day;
  item.append(date,element('span',name));
  list.append(item);
 }
 list.hidden=!holidays.length;
 status.textContent=holidays.length?'':'No upcoming holidays are listed.';
 status.hidden=holidays.length>0;
}catch{
 status.textContent='Upcoming holidays are unavailable. Observed U.S. federal holidays still do not count as paydays.';
}
