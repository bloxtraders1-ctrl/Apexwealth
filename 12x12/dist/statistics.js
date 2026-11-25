const field=id=>document.getElementById(id);
const format=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const units=n=>format.format(n/1e6);
let loading=false;
async function refresh(){
 if(loading||document.hidden)return;loading=true;
 try{
  const res=await fetch('/api/statistics',{cache:'no-store'});
  if(!res.ok)throw Error();
  const data=await res.json();
  field('total-invested').textContent=units(data.invested);field('total-paid').textContent=units(data.paid);
 }catch{
  for(const id of ['total-invested','total-paid'])field(id).textContent='—';
 }finally{loading=false;}
}
refresh();
document.addEventListener('visibilitychange',refresh);
setInterval(refresh,60000);
