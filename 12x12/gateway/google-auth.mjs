const path='/api/google/callback';
const cookieName='12x12_google_state';
const ttl=600;
const issuers=new Set(['https://accounts.google.com','accounts.google.com']);
const returnPaths=new Set(['/','/plan','/admin/cashier','/cashier-review','/profile','/portfolio','/referrals','/faq','/how-it-works']);
const utf8=new TextEncoder();
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const decode=value=>JSON.parse(new TextDecoder().decode(bytes(value)));

function cookie(value,age,url){
 return cookieName+'='+value+'; Path='+path+'; HttpOnly; SameSite=Lax; Max-Age='+age+(url.protocol==='https:'?'; Secure':'');
}

function redirect(location,headers={}){
 return new Response(null,{status:303,headers:{'Location':location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
}

function returnPath(value,url){
 if(typeof value!=='string'||value.length>1024)return '/';
 const target=new URL(value,url);
 return target.origin===url.origin&&returnPaths.has(target.pathname)?target.pathname+target.search:'/';
}

async function googleIdentity({clientId,clientSecret,callback,flow,code,now}){
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',
  headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'authorization_code',code,client_id:clientId,client_secret:clientSecret,
   redirect_uri:callback,code_verifier:flow.verifier}),
  redirect:'error',signal:AbortSignal.timeout(8000)
 });
 if(!tokenResponse.ok)throw Error('Google token exchange failed');
 const {id_token:token}=await tokenResponse.json();
 if(typeof token!=='string'||token.length>8192||!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))throw Error('Invalid Google token');
 const [header,payload,signature]=token.split('.');
 const {alg,kid}=decode(header);
 if(alg!=='RS256'||typeof kid!=='string'||!kid)throw Error('Invalid Google token header');
 const keyResponse=await fetch('https://www.googleapis.com/oauth2/v3/certs',{redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!keyResponse.ok)throw Error('Google public keys unavailable');
 const {keys}=await keyResponse.json();
 const jwk=keys.find(key=>key.kid===kid&&key.kty==='RSA'&&key.use==='sig');
 if(!jwk)throw Error('Unknown Google signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(signature),utf8.encode(header+'.'+payload)))throw Error('Invalid Google signature');
 const claims=decode(payload);
 if(!issuers.has(claims.iss)||claims.aud!==clientId||(claims.azp!==undefined&&claims.azp!==clientId)||
  !Number.isSafeInteger(claims.exp)||claims.exp<=now||!Number.isSafeInteger(claims.iat)||claims.iat>now+60||
  claims.nonce!==flow.nonce||typeof claims.sub!=='string'||!/^[\x21-\x7e]{1,255}$/.test(claims.sub)){
  throw Error('Invalid Google identity');
 }
 return claims;
}

export async function googleAuth(req,env,{query,session,token,issueSession,validPassword,validEmail,digest,random,reply,now,ip}){
 const url=new URL(req.url),callback=url.origin+path;
 const clientId=env.GOOGLE_CLIENT_ID,clientSecret=env.GOOGLE_CLIENT_SECRET;
 const enabled=Boolean(clientId&&clientSecret&&env.GOOGLE_REDIRECT_URI===callback);
 if(url.pathname==='/api/google/status'&&req.method==='GET'){
  const user=session.mode==='account'&&session.user;
  const account=enabled&&user&&await query('SELECT google_subject FROM login_accounts WHERE id=?',user).first();
  return reply({enabled,linked:Boolean(account?.google_subject)});
 }
 if(url.pathname==='/api/google/start'){
  if(req.method!=='POST'||req.headers.get('origin')!==url.origin||!req.headers.get('content-type')?.includes('application/json')){
   return reply({error:'Invalid Google sign-in request.'},403);
  }
  if(!enabled)return reply({error:'Google sign-in is unavailable.'},503);
  let data;
  try{data=await req.json();}catch{return reply({error:'Invalid request.'},400);}
  const intent=data?.intent;
  if(!['login','register','link'].includes(intent))return reply({error:'Invalid Google sign-in request.'},400);
  await query('DELETE FROM login_limits WHERE until_ts<=?',now).run();
  const bucket=await digest('google:'+ip);
  const limit=await query('INSERT INTO login_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts',bucket,now+ttl).first();
  if(limit.attempts>30)return reply({error:'Too many attempts. Try again in ten minutes.'},429);
  let linkSession=null;
  if(intent==='link'){
   if(session.mode!=='account'||!session.user)return reply({error:'Sign in with your 12x12 password first.'},401);
   const account=await query('SELECT salt,verifier,google_subject FROM login_accounts WHERE id=?',session.user).first();
   if(account?.google_subject)return reply({error:'Google is already linked.'},409);
   const password=data.password;
   if(typeof password!=='string'||!password.length||password.length>128||!await validPassword(password,account)){
    return reply({error:'Incorrect 12x12 password.'},401);
   }
   linkSession=await digest(token);
  }
  const state=random(32),verifier=random(32),nonce=random(32);
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(verifier))));
  let next='/';
  try{next=intent==='link'?'/profile':returnPath(data.next,url);}catch{}
  const returnPage='/'+(intent==='link'?'profile':intent);
  await query('DELETE FROM google_signin_requests WHERE expires<=?',now).run();
  await query('INSERT INTO google_signin_requests VALUES(?,?,?,?,?,?,?)',
   await digest(state),now+ttl,verifier,nonce,next,returnPage,linkSession).run();
  const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorization.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',
   scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'});
  return reply({url:authorization.href},200,{'Set-Cookie':cookie(state,ttl,url)});
 }
 if(url.pathname!==path||req.method!=='GET')return reply({error:'Google sign-in route not found.'},404);
 if(!enabled)return redirect('/login?google=unavailable');
 const state=url.searchParams.get('state');
 const browserState=(req.headers.get('cookie')||'').match(/(?:^|; *)12x12_google_state=([0-9a-f]{64})(?:;|$)/)?.[1];
 if(!browserState||state!==browserState)return redirect('/login?google=expired');
 const clear={'Set-Cookie':cookie('',0,url)};
 const flow=await query('DELETE FROM google_signin_requests WHERE state_digest=? AND expires>? RETURNING *',await digest(state),now).first();
 if(!flow)return redirect('/login?google=expired',clear);
 const fail=reason=>{
  const params=new URLSearchParams({google:reason,next:flow.next_path});
  return redirect(flow.return_page+'?'+params,clear);
 };
 const code=url.searchParams.get('code');
 if(url.searchParams.get('error')||!code||code.length>2048)return fail('cancelled');
 if(flow.link_session&&(!session.user||session.mode!=='account'||await digest(token)!==flow.link_session))return fail('expired');
 let claims;
 try{claims=await googleIdentity({clientId,clientSecret,callback,flow,code,now});}
 catch{return fail('failed');}
 if(flow.link_session){
  const update=await query(`UPDATE OR IGNORE login_accounts SET google_subject=? WHERE id=? AND google_subject IS NULL
   AND EXISTS(SELECT 1 FROM login_sessions WHERE digest=? AND account_id=? AND expires>unixepoch())`,
   claims.sub,session.user,flow.link_session,session.user).run();
  if(!update.meta.changes)return fail('linked_elsewhere');
  return redirect('/profile?google=linked',clear);
 }
 const lookup=()=>query('SELECT id FROM login_accounts WHERE google_subject=?',claims.sub).first();
 let account=await lookup();
 if(!account){
  const email=typeof claims.email==='string'?claims.email.trim().toLowerCase():'';
  if(claims.email_verified!==true||!validEmail(email))return fail('email');
  if(flow.return_page==='/login'){
   const existing=await query('SELECT 1 FROM login_accounts WHERE email=?',email).first();
   return fail(existing?'existing':'unregistered');
  }
  const id='apex-'+random(16);
  await query('INSERT OR IGNORE INTO login_accounts(username,id,salt,verifier,email,google_subject) VALUES(?,?,?,?,?,?)',
   id,id,random(16),'',email,claims.sub).run();
  account=await lookup();
  if(!account)return fail('existing');
 }
 const response=redirect(flow.next_path,clear);
 response.headers.append('Set-Cookie',await issueSession(account.id));
 return response;
}
