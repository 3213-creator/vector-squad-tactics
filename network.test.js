import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';

test('two sockets join, synchronize moves and reject out-of-turn commands',async()=>{
 const server=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'3199'},stdio:['ignore','pipe','pipe']});
 const clients=[];
 try{
 await Promise.race([once(server.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('server startup timeout')),5000))]);
 function connect(){const ws=new WebSocket('ws://127.0.0.1:3199');clients.push(ws);const queue=[],waiters=[];ws.on('message',raw=>{const m=JSON.parse(raw);const w=waiters.shift();if(w)w(m);else queue.push(m);});ws.next=()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiters.push(resolve));return ws;}
 const health=await fetch('http://127.0.0.1:3199/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
 for(const path of ['/','/style.css','/client.js','/game.js','/three.js'])assert.equal((await fetch('http://127.0.0.1:3199'+path)).status,200);
 const a=connect(),b=connect();await Promise.all([once(a,'open'),once(b,'open')]);
 a.send(JSON.stringify({type:'join',room:'TEST'}));assert.equal((await a.next()).team,0);assert.equal((await a.next()).ready,false);
 b.send(JSON.stringify({type:'join',room:'TEST'}));assert.equal((await b.next()).team,1);assert.equal((await b.next()).ready,true);await a.next();
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'move',id:0,x:2,z:2}));
 const sa=await a.next(),sb=await b.next();assert.deepEqual(sa,sb);assert.equal(sa.state.units[0].x,2);assert.equal(sa.state.units.length,2);
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'equip',id:0,weapon:'pistol'}));assert.equal((await a.next()).state.units[0].weapon,'pistol');assert.equal((await b.next()).state.units[0].weapon,'pistol');
 b.send(JSON.stringify({type:'end'}));assert.equal((await b.next()).type,'error');
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'end'}));assert.equal((await a.next()).state.turn,1);assert.equal((await b.next()).state.turn,1);
 a.close();assert.equal((await b.next()).type,'closed');
 }finally{clients.forEach(c=>c.terminate());server.kill();}
},{timeout:10000});
