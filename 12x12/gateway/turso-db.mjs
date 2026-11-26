import {readdir,readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const migrations = new URL('../drizzle/', import.meta.url);

export async function prepareTursoDatabase(client) {
 const files=(await readdir(migrations)).filter(file=>/^\d+_.*\.sql$/.test(file)).sort();
 const {rows}=await client.execute(
  "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('receipts','turso_migrations')"
 );
 const tables=new Set(rows.map(({name})=>name));
 if(tables.has('receipts')&&!tables.has('turso_migrations')){
  throw new Error('This database already contains 12x12 data. Use a database with a 12x12 migration history or migrate the existing database first.');
 }
 await client.execute('CREATE TABLE IF NOT EXISTS turso_migrations (name TEXT PRIMARY KEY)');
 const applied=new Set((await client.execute('SELECT name FROM turso_migrations')).rows.map(({name})=>name));
 for(const file of files){
  if(applied.has(file))continue;
  const sql=await readFile(new URL(file,migrations),'utf8');
  const transaction=await client.transaction('write');
  try{
   const {rows:history}=await transaction.execute('SELECT 1 FROM turso_migrations WHERE name = ?', [file]);
   if(!history.length){
    await transaction.executeMultiple(sql);
    await transaction.execute('INSERT INTO turso_migrations (name) VALUES (?)', [file]);
   }
   await transaction.commit();
  }finally{
   transaction.close();
  }
 }
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
  const code=typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?' ('+error.code+')':'';
  const reason=error.message.startsWith('This database already contains 12x12 data')?error.message:
   'Could not initialize the Turso database. Check its URL, token, and database status.';
  throw new Error(reason+code);
 }
}
