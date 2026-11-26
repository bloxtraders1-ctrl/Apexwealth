const phase=document.getElementById('launch-phase');
const title=document.getElementById('launch-title');
const date=document.getElementById('launch-date');
const clock=document.getElementById('launch-clock');
const parts=clock.querySelectorAll('[data-clock-value]');
const sign=document.getElementById('launch-sign');

async function loadSchedule(){
 try{
  const started=performance.now();
  const response=await fetch('/api/launch',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Launch schedule unavailable.');
  const {launchAt,now}=await response.json();
  if(!Number.isSafeInteger(launchAt)||!Number.isSafeInteger(now))throw Error('Launch schedule unavailable.');
  const reference=(started+performance.now())/2;
  const launch=new Date(launchAt*1000);
  date.dateTime=launch.toISOString();
  date.textContent=new Intl.DateTimeFormat('en-GB',{
   dateStyle:'medium',timeStyle:'short',timeZone:'UTC'
  }).format(launch)+' UTC';
  const update=()=>{
   const difference=(now-launchAt)+(performance.now()-reference)/1000;
   const live=difference>=0;
   const seconds=live?Math.floor(difference):Math.ceil(-difference);
   const values=[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60];
   if(phase.dataset.live!==String(live)){
    phase.dataset.live=String(live);
    phase.textContent=live?'Launched':'Pre-launch';
    title.textContent=live?'Time since launch':'Time until launch';
    clock.setAttribute('aria-label',title.textContent);
    sign.hidden=live;
   }
   parts.forEach((part,index)=>{part.textContent=String(values[index]).padStart(2,'0');});
  };
  update();
  setInterval(update,250);
 }catch{
  phase.textContent='Loading schedule';
  setTimeout(loadSchedule,10000);
 }
}

loadSchedule();
