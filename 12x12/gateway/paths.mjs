export const pages={'/':'index','/plan':'plan','/how-it-works':'how-it-works','/referrals':'referrals','/profile':'profile','/review':'mobile-review','/faq':'faq','/cashier-review':'cashier-review','/admin/cashier':'manual-admin','/login':'login','/register':'register'};
export function assetPath(path){
 const clean=path.length>1?path.replace(/\/$/,''):path;
 return Object.hasOwn(pages,clean)?'/'+pages[clean]+'.html':clean;
}
export function walletRedirect(url){
 const page=url.pathname.replace(/\/$/,'').replace(/\.html$/,'');
 if(page==='/portfolio')return '/profile'+url.search;
 if(!['/deposit','/withdraw','/cashier'].includes(page))return null;
 const target=new URL('/',url.origin);
 target.search=url.search;
 target.searchParams.set('wallet',page==='/withdraw'||url.searchParams.get('wallet')==='withdraw'?'withdraw':'deposit');
 return target.pathname+target.search;
}
export const mime={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',json:'application/json',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',txt:'text/plain'};
