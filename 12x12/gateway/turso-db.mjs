import {readdir,readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {reconcileTursoSchema,SchemaMismatch} from './turso-reconcile.mjs';

const migrations = new URL('../drizzle/', import.meta.url);
const errorCode=error=>typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?' ('+error.code+')':'';
const schemaDetail=error=>{
 const diagnostic=String(error.message).match(/\b(?:no such (?:table|index|trigger|column|function|view): [a-z_][a-z0-9_.]*|(?:table|index|trigger|view) [a-z_][a-z0-9_.]* already exists|duplicate column name: [a-z_][a-z0-9_.]*|near "[a-z_][a-z0-9_]*": syntax error)\b/i);
 return diagnostic?': '+diagnostic[0]:'';
};
class TursoMigrationError extends Error {}

export async function prepareTursoDatabase(client) {
 const files=(await readdir(migrations)).filter(file=>/^\d+_.*\.sql$/.test(file)).sort();
 await client.execute('CREATE TABLE IF NOT EXISTS turso_migrations (name TEXT PRIMARY KEY)');
 const applied=new Set((await client.execute('SELECT name FROM turso_migrations')).rows.map(({name})=>name));
 if(files.every(file=>applied.has(file)))return adapter(client);
 const migrationsByFile=new Map(await Promise.all(files.map(async file=>{
  const sql=await readFile(new URL(file,migrations),'utf8');
  return [file,sql.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean)];
 })));
 if(!applied.has(files[0])){
  try{
   if(await reconcileTursoSchema(client,migrationsByFile))return adapter(client);
  }catch(error){
   const detail=error instanceof SchemaMismatch?': '+error.message:errorCode(error)+schemaDetail(error);
   throw new TursoMigrationError('Turso schema reconciliation failed'+detail+'.');
  }
 }
 for(const file of files){
  if(applied.has(file))continue;
  const statements=migrationsByFile.get(file);
  let transaction;
  let step='opening the write transaction';
  try{
   transaction=await client.transaction('write');
   step='checking migration history';
   const {rows:history}=await transaction.execute({sql:'SELECT 1 FROM turso_migrations WHERE name = ?',args:[file]});
   if(!history.length){
    for(const [index,statement] of statements.entries()){
     step='applying statement '+(index+1)+' of '+statements.length;
     await transaction.execute(statement);
    }
    step='recording migration history';
    await transaction.execute({sql:'INSERT INTO turso_migrations (name) VALUES (?)',args:[file]});
   }
   step='committing the transaction';
   await transaction.commit();
  }catch(error){
   if(transaction)await transaction.rollback().catch(()=>{});
   throw new TursoMigrationError('Turso migration '+file+' failed while '+step+errorCode(error)+schemaDetail(error)+'.');
  }finally{
   transaction?.close();
  }
 }
 return adapter(client);
}

function adapter(client){
 return {
  prepare(sql){
   return {
    bind(...args){
     const execute=()=>client.execute({sql,args});
     return {
      async first(){return (await execute()).rows[0]??null;},
      async all(){return {results:(await execute()).rows};},
      async run(){return {meta:{changes:(await execute()).rowsAffected}};}
     };
    }
   };
  }
 };
}

export async function openTurso(url,authToken) {
 if(!url||!authToken){
  throw new Error('Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the backend environment.');
 }
 if(!/^libsql:\/\/[^/?#@]+\/?$/.test(url)){
  throw new Error('TURSO_DATABASE_URL must be the libsql:// URL displayed in the Turso database dashboard.');
 }
 const client=createClient({url,authToken});
 try{
  return await prepareTursoDatabase(client);
 }catch(error){
  client.close();
  // Keep connection details and tokens out of startup logs.
  if(error instanceof TursoMigrationError)throw error;
  throw new Error('Could not connect to or inspect the Turso database'+errorCode(error)+'.');
 }
}
