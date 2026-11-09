import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {walls,SIZE,DEPTH} from './game.js';

test('two sockets join, synchronize moves and reject out-of-turn commands',{timeout:25000},async()=>{
 const server=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'3199'},stdio:['ignore','pipe','pipe']});
 const clients=[];
 try{
 await Promise.race([once(server.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('server startup timeout')),5000))]);
 function connect(){const ws=new WebSocket('ws://127.0.0.1:3199');clients.push(ws);const queue=[],waiters=[];ws.on('message',raw=>{const m=JSON.parse(raw);const w=waiters.shift();if(w)w(m);else queue.push(m);});ws.next=()=>queue.length?Promise.resolve(queue.shift()):new Promise(resolve=>waiters.push(resolve));return ws;}
 const health=await fetch('http://127.0.0.1:3199/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
 for(const path of ['/','/style.css','/client.js','/game.js','/map-data.js','/three.js','/addons/loaders/GLTFLoader.js','/addons/utils/BufferGeometryUtils.js','/addons/utils/SkeletonUtils.js'])assert.equal((await fetch('http://127.0.0.1:3199'+path)).status,200);
 const a=connect(),b=connect();await Promise.all([once(a,'open'),once(b,'open')]);
 a.send(JSON.stringify({type:'join',room:'TEST',name:'ALPHA'}));assert.equal((await a.next()).team,0);assert.equal((await a.next()).ready,false);
 b.send(JSON.stringify({type:'join',room:'TEST'}));assert.equal((await b.next()).team,1);assert.equal((await b.next()).ready,true);await a.next();
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'ready'}));assert.equal((await a.next()).state.phase,'lobby');await b.next();
 await new Promise(resolve=>setTimeout(resolve,60));b.send(JSON.stringify({type:'ready'}));assert.equal((await b.next()).state.phase,'battle');await a.next();
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'move',id:0,x:1,z:8}));
 const sa=await a.next(),sb=await b.next();assert.deepEqual(sa,sb);assert.equal(sa.state.units[0].x,1);assert.equal(sa.state.units.length,2);
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'equip',id:0,weapon:'pistol'}));assert.equal((await a.next()).state.units[0].weapon,'pistol');assert.equal((await b.next()).state.units[0].weapon,'pistol');
 b.send(JSON.stringify({type:'end'}));assert.equal((await b.next()).type,'error');
 await new Promise(resolve=>setTimeout(resolve,60));a.send(JSON.stringify({type:'end'}));let current=(await a.next()).state;assert.equal(current.turn,1);assert.equal((await b.next()).state.turn,1);
 async function command(team,action){await new Promise(r=>setTimeout(r,65));clients[team].send(JSON.stringify(action));const response=await clients[team].next();assert.equal(response.type,'state',response.message);assert.deepEqual(await clients[1-team].next(),response);current=response.state;}
 async function turn(){if(current.turn===1)await command(1,{type:'end'});if(current.units[0].ap===0){await command(0,{type:'end'});await command(1,{type:'end'});}}
 const blocked=new Set(walls.map(w=>`${w.x},${w.z}`)),target=current.units[1],q=[{...current.units[0],path:[]}],seen=new Set();let path;
 for(let i=0;i<q.length;i++){const node=q[i],key=`${node.x},${node.z}`;if(seen.has(key))continue;seen.add(key);if(Math.abs(node.x-target.x)+Math.abs(node.z-target.z)===1){path=node.path;break;}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=node.x+dx,z=node.z+dz;if(x>=0&&z>=0&&x<SIZE&&z<DEPTH&&!blocked.has(`${x},${z}`)&&!seen.has(`${x},${z}`)&&!(x===target.x&&z===target.z))q.push({x,z,path:[...node.path,{x,z}]});}}
 assert.ok(path);for(const step of path){await turn();await command(0,{type:'move',id:0,...step});}
 await turn();await command(0,{type:'equip',id:0,weapon:'rifle'});while(current.winner===null){await turn();await new Promise(r=>setTimeout(r,110));await command(0,{type:'attack',id:0,target:1});}
 assert.equal(current.winner,0);const reset=await a.next();assert.deepEqual(await b.next(),reset);assert.equal(reset.state.phase,'lobby');assert.equal(reset.state.players[0].name,'ALPHA');assert.equal(reset.state.players[0].ready,false);assert.equal(reset.state.units[1].hp,100);

 a.close();assert.equal((await b.next()).type,'closed');
 }finally{clients.forEach(c=>c.terminate());server.kill();}
});
