import {DatabaseSync} from 'node:sqlite';

const schemaQuery="SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'";
const migrationRecord='INSERT OR IGNORE INTO turso_migrations (name) VALUES (?)';
const seedTables=new Set(['manual_policy','activity_opening_totals','platform_launch','wallet_payday_policy','us_federal_holidays']);

// Compare SQL tokens without changing quoted strings or ignoring constraints.
const fingerprint=sql=>JSON.stringify((sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[\w]+|[^\s]/g)||[])
 .map(token=>/^[\w]+$/.test(token)?token.toLowerCase():token));
const definitions=rows=>new Map(rows.map(({name,sql})=>[name,fingerprint(sql)]));

export class SchemaMismatch extends Error {}

function referencePlan(migrations){
 const reference=new DatabaseSync(':memory:');
 try{
  const catalog=reference.prepare(schemaQuery);
  const known=new Map();
  const operations=[];
  let before=new Map();
  for(const statements of migrations.values()){
   for(const statement of statements){
    reference.exec(statement);
    const after=definitions(catalog.all());
    const seed=statement.match(/^INSERT INTO (\w+)/i)?.[1];
    if(seedTables.has(seed)){
     operations.push({statement,seed});
    }else{
     const changed=[...new Set([...before.keys(),...after.keys()])].filter(name=>before.get(name)!==after.get(name));
     if(changed.length!==1)throw new SchemaMismatch('An unsupported migration statement requires review');
     const [name]=changed;
     const versions=known.get(name)||new Map();
     const prior=versions.get(before.get(name));
     const version=after.has(name)?operations.length:undefined;
     if(version!==undefined)versions.set(after.get(name),version);
     known.set(name,versions);
     operations.push({statement,name,prior,version});
    }
    before=after;
   }
  }
  return {known,operations};
 }finally{reference.close();}
}

export async function reconcileTursoSchema(client,migrations){
 const transaction=await client.transaction('write');
 try{
  const {rows}=await transaction.execute(schemaQuery);
  if(!rows.some(({name})=>name==='receipts'||name==='withdrawals')){
   await transaction.commit();
   return false;
  }

  const {known,operations}=referencePlan(migrations);
  const current=new Map();
  for(const [name,definition] of definitions(rows)){
   const versions=known.get(name);
   if(!versions)continue;
   const version=versions.get(definition);
   if(version===undefined)throw new SchemaMismatch('The existing '+name+' definition does not match a 12x12 migration');
   current.set(name,version);
  }
  const seeded=new Set();
  for(const table of seedTables){
   if(!current.has(table))continue;
   const {rows:records}=await transaction.execute('SELECT 1 FROM '+table+(table==='us_federal_holidays'?' LIMIT 1':' WHERE id=1'));
   if(records.length)seeded.add(table);
  }
  const missing=[];
  for(const {statement,seed,name,prior,version} of operations){
   if(seed){
    if(!seeded.has(seed))missing.push(statement);
    continue;
   }
   const installed=current.get(name);
   if(version===undefined){
    if(installed!==undefined&&installed<=prior){
     missing.push(statement);
     current.delete(name);
    }
   }else if(installed===undefined||installed<version){
    missing.push(statement);
    current.set(name,version);
   }
  }
  await transaction.batch([
   ...missing,
   ...Array.from(migrations.keys(),file=>({sql:migrationRecord,args:[file]}))
  ]);
  await transaction.commit();
  return true;
 }catch(error){
  await transaction.rollback().catch(()=>{});
  throw error;
 }finally{transaction.close();}
}
