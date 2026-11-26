import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {prepareTursoDatabase} from '../gateway/turso-db.mjs';

test('Turso migration history binds parameters through the network driver transaction interface',async()=>{
 const sqlite=createClient({url:'file::memory:'});
 try{
  const client={
   execute:statement=>sqlite.execute(statement),
   async transaction(mode){
    const transaction=await sqlite.transaction(mode);
    // The network driver's transaction.execute accepts one argument.
    return {
     execute:statement=>transaction.execute(statement),
     commit:()=>transaction.commit(),
     rollback:()=>transaction.rollback(),
     close:()=>transaction.close()
    };
   }
  };
  const db=await prepareTursoDatabase(client);
  const migration='0014_launch_and_wallet_credits.sql';
  assert.ok(await db.prepare('SELECT 1 FROM turso_migrations WHERE name=?').bind(migration).first());
  const schedule=await db.prepare('SELECT launch_at FROM platform_launch WHERE id=1').bind().first();
  assert.ok(schedule.launch_at>0);
  await prepareTursoDatabase(client);
  assert.deepEqual(await db.prepare('SELECT launch_at FROM platform_launch WHERE id=1').bind().first(),schedule);
 }finally{sqlite.close();}
});

test('startup reconciles a missing migration history without recreating receipts or re-seeding settings',async()=>{
 const sqlite=createClient({url:'file::memory:'});
 try{
  const directory=new URL('../drizzle/',import.meta.url);
  const files=(await readdir(directory)).filter(name=>/^00(?:0\d|1[0-3])_.*\.sql$/.test(name)).sort();
  for(const file of files)await sqlite.executeMultiple(await readFile(new URL(file,directory),'utf8'));
  await sqlite.execute('CREATE TABLE turso_migrations (name TEXT PRIMARY KEY)');
  await sqlite.execute("INSERT INTO login_accounts (username,id,salt,verifier,email) VALUES ('wal','u1','salt','digest','wal@example.test')");
  await sqlite.execute("UPDATE manual_policy SET daily_bps=1000 WHERE id=1");
  await sqlite.execute('DROP INDEX receipt_user');
  const db=await prepareTursoDatabase(sqlite);
  const launch=await db.prepare('SELECT launch_at FROM platform_launch').bind().first();
  assert.ok(launch.launch_at>0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM turso_migrations').bind().first()).total,files.length+1);
  assert.ok(await db.prepare("SELECT name FROM sqlite_schema WHERE name='receipt_user'").bind().first());
  assert.equal((await db.prepare("SELECT email FROM login_accounts WHERE id='u1'").bind().first()).email,'wal@example.test');
  assert.equal((await db.prepare('SELECT daily_bps FROM manual_policy WHERE id=1').bind().first()).daily_bps,1000);
  await prepareTursoDatabase(sqlite);
  assert.deepEqual(await db.prepare('SELECT launch_at FROM platform_launch').bind().first(),launch);
 }finally{sqlite.close();}
});

test('startup fills a partial initial schema and preserves the existing receipt',async()=>{
 const sqlite=createClient({url:'file::memory:'});
 try{
  const initial=await readFile(new URL('../drizzle/0000_cashier.sql',import.meta.url),'utf8');
  await sqlite.execute(initial.split('--> statement-breakpoint')[0]);
  await sqlite.execute("INSERT INTO receipts (id,user_id,payout,amount,referrer,receiver,factory,vault,created) VALUES ('r1','u1','pay',12,'ref','recv','fact','vault',1)");
  const db=await prepareTursoDatabase(sqlite);
  const receipt=await db.prepare("SELECT amount,plan_id,contract_version FROM receipts WHERE id='r1'").bind().first();
  assert.deepEqual(receipt,{amount:12,plan_id:1,contract_version:1});
  assert.ok(await db.prepare("SELECT name FROM sqlite_schema WHERE name='withdrawals'").bind().first());
 }finally{sqlite.close();}
});

test('startup rejects an unrelated receipts table without changing it',async()=>{
 const sqlite=createClient({url:'file::memory:'});
 try{
  await sqlite.execute('CREATE TABLE receipts (id INTEGER PRIMARY KEY)');
  await sqlite.execute('INSERT INTO receipts VALUES (42)');
  await assert.rejects(()=>prepareTursoDatabase(sqlite),/receipts definition does not match/);
  assert.equal((await sqlite.execute('SELECT id FROM receipts')).rows[0].id,42);
  assert.equal((await sqlite.execute('SELECT COUNT(*) AS total FROM turso_migrations')).rows[0].total,0);
 }finally{sqlite.close();}
});

test('a failed migration identifies the statement and rolls back schema changes',async()=>{
 const sqlite=createClient({url:'file::memory:'});
 try{
  const client={
   execute:statement=>sqlite.execute(statement),
   async transaction(mode){
    const transaction=await sqlite.transaction(mode);
    return {
     async execute(statement){
      if(typeof statement==='string'&&statement.startsWith('CREATE INDEX receipt_user')){
       throw Object.assign(Error('no such table: receipts; debug-only secret'),{code:'SQL_INPUT_ERROR'});
      }
      return transaction.execute(statement);
     },
     commit:()=>transaction.commit(),
     rollback:()=>transaction.rollback(),
     close:()=>transaction.close()
    };
   }
  };
  await assert.rejects(()=>prepareTursoDatabase(client),{
   message:'Turso migration 0000_cashier.sql failed while applying statement 2 of 5 (SQL_INPUT_ERROR): no such table: receipts.'
  });
  const {rows}=await sqlite.execute("SELECT name FROM sqlite_schema WHERE name='receipts'");
  assert.equal(rows.length,0);
  assert.equal((await sqlite.execute('SELECT name FROM turso_migrations')).rows.length,0);
  await prepareTursoDatabase(sqlite);
  assert.equal((await sqlite.execute("SELECT 1 FROM turso_migrations WHERE name LIKE '0000%'")).rows.length,1);
 }finally{sqlite.close();}
});
