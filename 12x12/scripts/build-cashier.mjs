import {build} from 'esbuild';
import {readdirSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
await build({stdin:{contents:"export {toCanvas} from 'qrcode';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',minify:true,outfile:'dist/assets/receipt-qr.js'});
const files={};
function collect(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const file=join(dir,entry.name);
  if(entry.name.startsWith('.')||['server','client'].includes(entry.name))continue;
  if(entry.isDirectory())collect(file);
  else files[file.slice(4)]=readFileSync(file).toString('base64');
 }
}
collect('dist');
await build({entryPoints:['gateway/worker.mjs'],bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022',outfile:'dist/server/index.js',plugins:[{name:'apex-files',setup(b){
 b.onResolve({filter:/^apex:files$/},()=>({path:'files',namespace:'apex'}));b.onLoad({filter:/.*/,namespace:'apex'},()=>({contents:'export default '+JSON.stringify(files)}));
}}]});
mkdirSync('dist/.openai',{recursive:true});copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
