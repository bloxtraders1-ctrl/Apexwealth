import test from 'node:test';
import assert from 'node:assert/strict';
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
