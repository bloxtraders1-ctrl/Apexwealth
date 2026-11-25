import {runtimeConfig} from './runtime-config.mjs';
import {manualCashier} from './manual-cashier.mjs';
import {authenticate} from './auth.mjs';
import {handleAPI} from './api.mjs';
import {assetPath,mime,walletRedirect} from './paths.mjs';
import files from 'apex:files';
export default {async fetch(req,env){
 const url=new URL(req.url), path=url.pathname;
 if(path==='/healthz'){
  await env.DB.prepare('SELECT 1').bind().first();
  return new Response('ok',{headers:{'Cache-Control':'no-store'}});
 }
 if(path==='/config.json')return Response.json(runtimeConfig(env.APEX_CONFIG_JSON),{headers:{'Cache-Control':'no-store'}});
 if(path.startsWith('/api/')){
  const auth=await authenticate(req,env,req.headers.get('oai-authenticated-user-id'),'hosted',req.headers.get('cf-connecting-ip')||'hosted');
  if(auth instanceof Response)return auth;
  if(path.startsWith('/api/manual/'))return manualCashier(req,{...env,settings:runtimeConfig(env.APEX_CONFIG_JSON)},auth.user);
  return handleAPI(req,{...env,settings:runtimeConfig(env.APEX_CONFIG_JSON)},auth.user,auth.mode);
 }
 if(!['GET','HEAD'].includes(req.method))return new Response(null,{status:405});
 const redirect=walletRedirect(url);
 if(redirect)return new Response(null,{status:302,headers:{Location:redirect,'Cache-Control':'no-store'}});
 const name=assetPath(path);if(!Object.hasOwn(files,name))return new Response('Page not found',{status:404});
 const raw=atob(files[name]);return new Response(req.method==='HEAD'?null:Uint8Array.from(raw,c=>c.charCodeAt(0)),{headers:{'Content-Type':mime[name.split('.').pop()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}});
}};
