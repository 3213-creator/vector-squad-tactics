import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {WebSocket} from 'ws';
test('two real-time sockets share names, ready state, continuous movement, fire, reload and weapon swap',{timeout:15000},async()=>{
 const server=spawn(process.execPath,['server.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'3299'},stdio:['ignore','pipe','pipe']});const clients=[];
 try{await Promise.race([once(server.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(Error('startup timeout')),5000))]);
 const health=await fetch('http://127.0.0.1:3299/healthz');assert.equal(health.status,200);
 for(const path of ['/','/client.js','/physics.js','/collision-world.js','/bvh.js','/addons/math/Capsule.js'])assert.equal((await fetch('http://127.0.0.1:3299'+path)).status,200);
 function connect(){const ws=new WebSocket('ws://127.0.0.1:3299');clients.push(ws);const queue=[],waiters=[];ws.on('message',r=>{const m=JSON.parse(r);if(waiters.length)waiters.shift()(m);else queue.push(m);});ws.next=()=>queue.length?Promise.resolve(queue.shift()):new Promise(r=>waiters.push(r));ws.state=async predicate=>{for(;;){const m=await ws.next();assert.notEqual(m.type,'error',m.message);if(m.type==='state'&&predicate(m.state))return m.state;}};return ws;}
 const a=connect(),b=connect();await Promise.all([once(a,'open'),once(b,'open')]);a.send(JSON.stringify({type:'join',room:'NET',name:'Alpha'}));assert.equal((await a.next()).team,0);await a.next();b.send(JSON.stringify({type:'join',room:'NET',name:'Bravo'}));assert.equal((await b.next()).team,1);assert.equal((await b.next()).state.players[0].name,'Alpha');
 a.send(JSON.stringify({type:'ready'}));b.send(JSON.stringify({type:'ready'}));await a.state(s=>s.phase==='battle');await b.state(s=>s.phase==='battle');
 for(let seq=1;seq<=15;seq++){a.send(JSON.stringify({type:'input',seq,forward:1,strafe:0,yaw:-Math.PI/2,pitch:0,fire:seq<5}));await new Promise(r=>setTimeout(r,35));}
 const moved=await a.state(s=>s.units[0].ack>=15);assert.ok(moved.units[0].x>-6.5);assert.ok(moved.units[0].ammo.rifle<30);assert.equal(moved.units[0].lives,3);assert.equal(moved.units[0].hp,100);assert.equal(moved.crates.length,8);
 b.send(JSON.stringify({type:'equip',weapon:'sniper'}));const swapped=await a.state(s=>s.units[1].weapon==='sniper');assert.equal(swapped.units[1].primary,'sniper');a.send(JSON.stringify({type:'reload'}));await a.state(s=>s.units[0].reloadUntil>0);const loaded=await a.state(s=>s.units[0].reloadUntil===0&&s.units[0].ammo.rifle===30);assert.ok(loaded.units[0].reserve.rifle<90);
 a.send(JSON.stringify({type:'input',seq:16,yaw:-Math.PI/2,pitch:0,fire:true}));a.send(JSON.stringify({type:'input',seq:17,yaw:-Math.PI/2,pitch:0,fire:false}));await a.state(s=>s.units[0].ack>=17&&s.units[0].ammo.rifle===29);
 a.close();for(;;){const m=await b.next();if(m.type==='closed')break;}
 }finally{clients.forEach(c=>c.terminate());server.kill();}
});
