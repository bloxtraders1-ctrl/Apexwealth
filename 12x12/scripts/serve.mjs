import {manualCashier} from '../gateway/manual-cashier.mjs';
import {authenticate} from '../gateway/auth.mjs';
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {handleAPI} from '../gateway/api.mjs';
import {assetPath,mime,walletRedirect} from '../gateway/paths.mjs';
import {runtimeConfig} from '../gateway/runtime-config.mjs';
import {localDB} from '../gateway/local-db.mjs';
const flag=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const root=path.resolve('dist'),DB=localDB(process.env.APEX_DB_PATH||'.cashier/accounts.sqlite');
const settings=runtimeConfig(process.env.APEX_CONFIG_JSON);
const env={DB,settings,BASE_RPC_URL:process.env.BASE_RPC_URL,accountEnvironment:"selfhost",APEX_CASHIER_ADMIN_IDS:process.env.APEX_CASHIER_ADMIN_IDS};
const port=Number(flag('--port')||process.env.PORT||3000);
http.createServer(async(req,res)=>{
 try{
  const origin=process.env.PUBLIC_ORIGIN||'http://'+req.headers.host;
  const url=new URL(req.url,origin);
  if(url.pathname==='/healthz'){
   await DB.prepare('SELECT 1').bind().first();
   res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok');return;
  }
  if(url.pathname==='/config.json'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(settings));return;
  }
  if(url.pathname.startsWith('/api/')){
   const auth=req.headers.authorization||'',key=auth.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
   const user=key?createHash('sha256').update(key).digest('hex'):null;
   const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>8192){res.writeHead(413);res.end();return;}chunks.push(b);}
   const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});
   const session=await authenticate(request,env,user,'selfhost',req.socket.remoteAddress);
   const out=session instanceof Response?session:await (url.pathname.startsWith('/api/manual/')?manualCashier(request,env,session.user):handleAPI(request,env,session.user,session.mode));res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));return;
  }
  const redirect=walletRedirect(url);
  if(redirect&&['GET','HEAD'].includes(req.method)){res.writeHead(302,{Location:redirect,'Cache-Control':'no-store'});res.end();return;}
  const name=assetPath(decodeURIComponent(url.pathname));if(!/^\/(?:assets\/[a-z0-9_.\/-]+|[a-z0-9_-]+\.(?:html|css|json|js))$/i.test(name)||name.includes('..'))throw Error();
  const data=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch{res.writeHead(404);res.end('Page not found');}
}).listen(port,flag('--host')||'0.0.0.0',()=>console.log('12x12 running at http://localhost:'+port));
