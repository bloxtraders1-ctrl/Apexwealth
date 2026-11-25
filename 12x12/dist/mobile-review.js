const page=document.getElementById('review-page');
const size=document.getElementById('review-size');
const frame=document.getElementById('review-frame');
const display=document.getElementById('review-display');
const fit=document.getElementById('review-fit');
const phone=document.getElementById('review-phone');
const dimensions=document.getElementById('review-dimensions');
const zoom=document.getElementById('review-zoom');
const open=document.getElementById('review-open');
const query=new URLSearchParams(location.search);
let actualSize=false;

for(const [control,key] of [[page,'page'],[size,'size']]){
 if(Array.from(control.options).some(option=>option.value===query.get(key)))control.value=query.get(key);
}

function fitPhone(){
 const [width,height]=size.value.split('x').map(Number);
 frame.width=width;
 frame.height=height;
 const outerWidth=phone.offsetWidth;
 const outerHeight=phone.offsetHeight;
 const bounds=getComputedStyle(display);
 const widthSpace=display.clientWidth-parseFloat(bounds.paddingLeft)-parseFloat(bounds.paddingRight);
 const heightSpace=display.clientHeight-parseFloat(bounds.paddingTop)-parseFloat(bounds.paddingBottom);
 const scale=actualSize?1:Math.min(1,widthSpace/outerWidth,heightSpace/outerHeight);
 phone.style.transform='scale('+scale+')';
 fit.style.width=outerWidth*scale+'px';
 fit.style.height=outerHeight*scale+'px';
 dimensions.textContent=width+' × '+height+' px · '+Math.round(scale*100)+'%';
}

function saveSelection(){
 const url=new URL(location.href);
 url.searchParams.set('page',page.value);
 url.searchParams.set('size',size.value);
 history.replaceState(null,'',url);
}

function showPage(){
 if(frame.getAttribute('src')!==page.value||open.getAttribute('href')!==page.value)frame.src=page.value;
 frame.title=page.selectedOptions[0].textContent+' mobile preview';
 open.href=page.value;
}

frame.addEventListener('load',()=>{
 const viewed=frame.contentDocument?.location;
 if(viewed?.origin===location.origin){
  open.href=viewed.pathname+viewed.search+viewed.hash;
  const selection=viewed.pathname==='/'&&new URLSearchParams(viewed.search).get('wallet')==='deposit'
   ?'/?wallet=deposit':viewed.pathname;
  if(selection!==page.value&&Array.from(page.options).some(option=>option.value===selection)){
   page.value=selection;
   frame.title=page.selectedOptions[0].textContent+' mobile preview';
   saveSelection();
  }
 }
});
page.onchange=()=>{saveSelection();showPage();};
size.onchange=()=>{saveSelection();fitPhone();};
zoom.onclick=()=>{
 actualSize=!actualSize;
 zoom.setAttribute('aria-pressed',String(actualSize));
 fitPhone();
};
document.getElementById('review-reload').onclick=()=>{
 const viewed=frame.contentDocument?.location;
 if(viewed?.origin===location.origin)viewed.reload();
 else frame.src=page.value;
};

showPage();
new ResizeObserver(fitPhone).observe(display);
fitPhone();
