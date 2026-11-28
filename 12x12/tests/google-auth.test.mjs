import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {authenticate} from '../gateway/auth.mjs';
import {localDB} from '../gateway/local-db.mjs';

const base='https://12x12.example',password='a-fixture-password';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const cookies=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]);
function fixture(t){
 const DB=localDB(':memory:');
 const env={DB,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_REDIRECT_URI:base+'/api/google/callback'};
 let identity={};
 let nonce;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url.endsWith('/certs'))return Response.json({keys:[key]});
  assert.equal(url,'https://oauth2.googleapis.com/token');
  assert.equal(init.body.get('client_secret'),env.GOOGLE_CLIENT_SECRET);
  assert.equal(init.body.get('redirect_uri'),env.GOOGLE_REDIRECT_URI);
  assert.match(init.body.get('code_verifier'),/^[0-9a-f]{64}$/);
  const now=Math.floor(Date.now()/1000);
  const body=encode({alg:'RS256',kid:key.kid})+'.'+encode({
   iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,iat:now,exp:now+60,
   sub:'google-fixture',email:'google@example.net',email_verified:true,nonce,...identity
  });
  const signature=sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
  return Response.json({id_token:body+'.'+signature});
 });
 const call=(route,body,cookie='',origin=base)=>authenticate(new Request(base+'/api/'+route,{
  method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined
 }),env,null,'selfhost','fixture');
 const open=async(body={intent:'login'},cookie)=>{
  const response=await call('google/start',body,cookie);
  assert.equal(response.status,200);
  const [stateCookie]=cookies(response);
  const auth=new URL((await response.json()).url);
  assert.equal(auth.origin,'https://accounts.google.com');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  nonce=auth.searchParams.get('nonce');
  const suffix='&state='+auth.searchParams.get('state');
  return {finish:(session=cookie,code='code=fixture')=>call('google/callback?'+code+suffix,null,
   [stateCookie,session].filter(Boolean).join('; ')),suffix,stateCookie};
 };
 return {DB,env,call,open,claims:value=>identity=value};
}

test('Google sign-up and returning login reuse the same 12x12 account and session format',async t=>{
 const f=fixture(t);
 assert.equal((await (await f.call('google/status')).json()).enabled,true);
 const signup=await f.open({intent:'register',next:'/plan?invest=1'});
 const result=await signup.finish();
 assert.equal(result.status,303);
 assert.equal(result.headers.get('location'),'/plan?invest=1');
 const [clear,session]=cookies(result);
 assert.equal(clear,'12x12_google_state=');
 const account=(await f.call('status',null,session)).user;
 assert.match(account,/^apex-/);
 assert.equal((await f.call('login',{email:'google@example.net',password})).status,401);
 assert.deepEqual(await (await f.call('google/status',null,session)).json(),{enabled:true,linked:true});
 f.claims({email:'changed@example.net'});
 const login=await f.open({intent:'login',next:'//outside.example'},session);
 const returned=await login.finish();
 assert.equal(returned.headers.get('location'),'/');
 const newSession=cookies(returned)[1];
 assert.equal((await f.call('status',null,newSession)).user,account);
 assert.equal((await f.call('status',null,session)).user,null);
 assert.equal(f.DB.prepare('SELECT email FROM login_accounts WHERE id=?').bind(account).first().email,'google@example.net');
});

test('matching emails require explicit password-confirmed linking and preserve the account ID and wallet ownership',async t=>{
 const f=fixture(t);
 const response=await f.call('register',{email:'google@example.net',password});
 const [session]=cookies(response);
 const account=(await f.call('status',null,session)).user;
 f.DB.prepare('INSERT INTO wallet_profiles VALUES(?,?)').bind(account,'Original member').run();
 const attempt=await f.open();
 const rejected=await attempt.finish();
 assert.match(rejected.headers.get('location'),/^\/login\?google=existing/);
 assert.equal(cookies(rejected).length,1);
 assert.equal((await f.call('google/start',{intent:'link',password})).status,401);
 assert.equal((await f.call('google/start',{intent:'link',password:'wrong'},session)).status,401);
 const switched=await f.open({intent:'link',password},session);
 assert.match((await switched.finish('')).headers.get('location'),/^\/profile\?google=expired/);
 const link=await f.open({intent:'link',password},session);
 assert.equal((await link.finish()).headers.get('location'),'/profile?google=linked');
 const login=await f.open();
 const returned=await login.finish();
 assert.equal((await f.call('status',null,cookies(returned)[1])).user,account);
 assert.equal(f.DB.prepare('SELECT display_name FROM wallet_profiles WHERE user_id=?').bind(account).first().display_name,'Original member');
 assert.equal((await f.call('login',{email:'google@example.net',password})).status,200);
});

test('Google callback rejects mismatched state, replay, incorrect token claims, and unverified email',async t=>{
 const f=fixture(t);
 assert.equal((await f.call('google/start',{intent:'login'},'','https://outside.example')).status,403);
 const flow=await f.open();
 const invalid=await f.call('google/callback?code=fixture&state=bad',null,flow.stateCookie);
 assert.match(invalid.headers.get('location'),/google=expired/);
 const canceled=await flow.finish('', 'error=access_denied');
 assert.match(canceled.headers.get('location'),/google=cancelled/);
 assert.match((await flow.finish()).headers.get('location'),/google=expired/);
 for(const claims of [{aud:'another-client'},{nonce:'wrong'},{exp:1},{iss:'https://outside.example'}]){
  f.claims(claims);
  assert.match((await (await f.open()).finish()).headers.get('location'),/google=failed/);
 }
 f.claims({email_verified:false});
 assert.match((await (await f.open()).finish()).headers.get('location'),/google=email/);
 assert.equal(f.DB.prepare('SELECT COUNT(*) AS total FROM login_accounts').bind().first().total,0);
 f.env.GOOGLE_REDIRECT_URI='https://different.example/api/google/callback';
 assert.equal((await (await f.call('google/status')).json()).enabled,false);
 assert.equal((await f.call('google/start',{intent:'login'})).status,503);
});
