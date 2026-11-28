import {googleAuth} from './google-auth.mjs';

const utf8 = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const random = length => hex(crypto.getRandomValues(new Uint8Array(length)));
const digest = async str => hex(await crypto.subtle.digest('SHA-256',utf8.encode(str)));
const lifetime = 7*86400;
const reply = (data,status=200,headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const sessionToken = req => (req.headers.get('cookie')||'').match(/(?:^|; *)apex_session=([a-z0-9]+)(?:;|$)/)?.[1];
async function verifier(password,salt){
 const key=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:utf8.encode(salt),hash:'SHA-512',iterations:100000},key,512));
}
const validEmail = email => email.length<=254&&/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email);
async function validPassword(password,account){
 const supplied=await verifier(password,account?.salt||'0'.repeat(32));
 const stored=account?.verifier||'0'.repeat(supplied.length);
 let mismatch=0;
 for(let i=0;i<supplied.length;i++)mismatch|=supplied.charCodeAt(i)^stored.charCodeAt(i);
 return Boolean(account?.verifier)&&mismatch===0;
}
export async function authenticate(req,env,existingUser,mode,ip){
 const path=new URL(req.url).pathname.slice(5), db=env.DB;
 const token=sessionToken(req), now=Math.floor(Date.now()/1000);
 const query=(sql,...args)=>db.prepare(sql).bind(...args);
 const cookie=(value,seconds)=>'apex_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+(new URL(req.url).protocol==='https:'?'; Secure':'');
 async function readSession(){
  if(!token)return {user:existingUser,mode};
  const row=token==='off'?null:await query('SELECT account_id FROM login_sessions WHERE digest=? AND expires>?',await digest(token),now).first();
  return {user:row?.account_id||null,mode:'account'};
 }
 async function issueSession(id){
  const fresh=random(32);
  await query('DELETE FROM login_sessions WHERE expires<=?',now).run();
  if(token&&token!=='off')await query('DELETE FROM login_sessions WHERE digest=?',await digest(token)).run();
  await query('INSERT INTO login_sessions VALUES(?,?,?)',await digest(fresh),id,now+lifetime).run();
  return cookie(fresh,lifetime);
 }
 if(path.startsWith('google/')){
  return googleAuth(req,env,{query,session:await readSession(),token,issueSession,validPassword,validEmail,digest,random,reply,now,ip});
 }
 if(['login','register','link-email','logout','restore-key'].includes(path)){
  if(req.method!=='POST'||req.headers.get('origin')!==new URL(req.url).origin||!req.headers.get('content-type')?.includes('application/json'))return reply({error:'Invalid account request.'},403);
  if(path==='restore-key'){
   if(mode!=='selfhost'||!existingUser)return reply({error:'A valid recovery key is required.'},403);
   return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(path==='logout'){
   if(token&&token!=='off')await query('DELETE FROM login_sessions WHERE digest=?',await digest(token)).run();
   return reply({ok:true},200,{'Set-Cookie':cookie('off',lifetime)});
  }
  const raw=await req.text();
  if(raw.length>4096)return reply({error:'Request too large.'},413);
  let data;try{data=JSON.parse(raw);}catch{return reply({error:'Invalid request.'},400);}
  const email=typeof data?.email==='string'?data.email.trim().toLowerCase():'';
  const username=path==='link-email'&&typeof data?.username==='string'?data.username.trim().toLowerCase():'';
  const pw=data?.password;
  if(!validEmail(email))return reply({error:'Enter a valid email address.'},400);
  if(path==='link-email'&&!/^[a-z0-9_]{3,32}$/.test(username))return reply({error:'Enter the username of your existing account.'},400);
  if(typeof pw!=='string'||pw.length<1||pw.length>128)return reply({error:'Enter a valid password.'},400);
  if(path==='register'&&pw.length<12)return reply({error:'Use a password with at least 12 characters.'},400);
  await query('DELETE FROM login_limits WHERE until_ts<=?',now).run();
  for(const [key,limit] of [['network:'+ip,60],[path+':'+(username||email),12]]){
   const hit=await query('INSERT INTO login_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts',await digest(key),now+600).first();
   if(hit.attempts>limit)return reply({error:'Too many attempts. Try again in ten minutes.'},429);
  }
  let id;
  if(path==='register'){
   const salt=random(16);id='apex-'+random(16);
   const result=await query('INSERT OR IGNORE INTO login_accounts(username,id,salt,verifier,email) VALUES(?,?,?,?,?)',id,id,salt,await verifier(pw,salt),email).run();
   if(!result.meta.changes)return reply({error:'That email address is unavailable.'},409);
  }else{
   const legacy=path==='link-email';
   const account=legacy
    ?await query('SELECT id,salt,verifier FROM login_accounts WHERE username=? AND email IS NULL',username).first()
    :await query('SELECT id,salt,verifier FROM login_accounts WHERE email=?',email).first();
   if(!await validPassword(pw,account))return reply({error:legacy?'Could not verify the existing account. If you already linked an email, use email login.':'Incorrect email or password.'},401);
   id=account.id;
   if(legacy){
    const result=await query('UPDATE OR IGNORE login_accounts SET email=? WHERE id=? AND email IS NULL',email,id).run();
    if(!result.meta.changes)return reply({error:'Could not link that email address. It might already be in use.'},409);
   }
  }
  return reply({ok:true},200,{'Set-Cookie':await issueSession(id)});
 }
 return readSession();
}
