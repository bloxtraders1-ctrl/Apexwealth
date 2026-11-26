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
     executeMultiple:sql=>transaction.executeMultiple(sql),
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
