import test from 'node:test';
import assert from 'node:assert/strict';
import {localDB} from '../gateway/local-db.mjs';
import {authenticate} from '../gateway/auth.mjs';
test('account registration, session visibility, login, logout and invalid credentials',async()=>{
 const env={DB:localDB(':memory:')},base='https://apex.example',body={email:'Tester@example.net',password:'test-password-for-fixture'};
 function call(path,payload,cookie='',origin=base){
  const req=new Request(base+'/api/'+path,{method:payload?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
  return authenticate(req,env,null,'selfhost','local');
 }
 const registration=await call('register',body);
 assert.equal(registration.status,200);
 assert.match(registration.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
 const cookie=registration.headers.get('set-cookie').split(';')[0], id=(await call('status',null,cookie)).user;
 assert.match(id,/^apex-/);
 assert.equal((await call('register',{...body,email:'tester@example.net'})).status,409);
 assert.equal((await call('login',{username:'tester',password:body.password})).status,400);
 assert.equal((await call('login',{...body,password:'wrong'})).status,401);
 assert.equal((await call('logout',{},cookie,'https://elsewhere.example')).status,403);
 assert.equal((await call('logout',{},cookie)).status,200);
 assert.equal((await call('status',null,cookie)).user,null);
 const login=await call('login',body);
 assert.equal(login.status,200);
 assert.equal((await call('status',null,login.headers.get('set-cookie').split(';')[0])).user,id);
});


test('an existing login can link an email once without changing its account ID',async()=>{
 const DB=localDB(':memory:'),env={DB},base='https://apex.example';
 const password='existing-password',salt='fixture-salt',username='olduser',email='old@example.net';
 const utf8=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',utf8.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:utf8.encode(salt),hash:'SHA-512',iterations:100000},key,512);
 const verifier=Buffer.from(bits).toString('hex');
 DB.prepare('INSERT INTO login_accounts(username,id,salt,verifier) VALUES(?,?,?,?)').bind(username,'original-id',salt,verifier).run();
 const call=(path,body,origin=base)=>authenticate(new Request(base+'/api/'+path,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)
 }),env,null,'selfhost','local');
 assert.equal((await call('link-email',{username,password,email},'https://other.example')).status,403);
 assert.equal((await call('link-email',{username,password:'wrong',email})).status,401);
 assert.equal((await call('register',{email:'taken@example.net',password})).status,200);
 assert.equal((await call('link-email',{username,password,email:'taken@example.net'})).status,409);
 const linked=await call('link-email',{username,password,email});
 assert.equal(linked.status,200);
 const login=await call('login',{email:'OLD@EXAMPLE.NET',password});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const session=await authenticate(new Request(base+'/api/status',{headers:{cookie}}),env,null,'selfhost','local');
 assert.equal(session.user,'original-id');
 assert.equal((await call('link-email',{username,password,email:'different@example.net'})).status,401);
});
