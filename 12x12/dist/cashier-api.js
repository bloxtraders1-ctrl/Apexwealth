const keyName='apex-direct-account';
export function savedKey(){try{return localStorage.getItem(keyName)||'';}catch{return '';}}
export function setKey(value){localStorage.setItem(keyName,value);}
export async function api(path,body){
 const headers={'Accept':'application/json'};
 const key=savedKey();if(key)headers.Authorization='Bearer '+key;
 if(body)headers['Content-Type']='application/json';
 const res=await fetch('/api/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'Cashier request failed.'),{status:res.status});return data;
}
export function element(tag,content,cls){const node=document.createElement(tag);if(content!=null)node.textContent=content;if(cls)node.className=cls;return node;}
export function action(label,fn,cls='muted-button'){
 const b=element('button',label,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){const feedback=document.getElementById('feedback')||document.getElementById('cash-status');feedback.textContent=e.message;feedback.scrollIntoView({block:'nearest'});}finally{b.disabled=false;}};return b;
}
const usd = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:6});
export const money = atomic => usd.format(Number(atomic) / 1e6);
export const tokenAmount = atomic => (Number(atomic) / 1e6).toLocaleString('en-US', {useGrouping:false, maximumFractionDigits:6});
export function link(href,label,cls='plain'){const a=element('a',label,cls);a.href=href;return a;}
export function explorer(tx){const a=link('https://basescan.org/tx/'+tx,'View transfer ↗');a.target='_blank';a.rel='noopener noreferrer';return a;}
export const statuses={created:'Awaiting transfer',review:'In cashier review',active:'Plan active',refunded:'Refund processed',archived:'Archived',paid:'Paid','refund-requested':'Refund requested'};
