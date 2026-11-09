import {isPrimary,isSidearm} from './weapons.js';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {WebSocketServer,WebSocket} from 'ws';
import {initial,action,tick,cleanInput,weapons,returnToLobby,configureMode} from './game.js';
import {setWorld} from './physics.js';
import {buildNavigation,createBrain,botInput} from './bot.js';
import {loadWorld} from './world.js';
const world=await loadWorld();setWorld(world);const navigation=buildNavigation(world);
const assets={'/assets/soldier-rigged.glb':['public/assets/soldier-rigged.glb','model/gltf-binary'],'/assets/dying.json':['public/assets/dying.json','application/json'],'/assets/rifle-idle.json':['public/assets/rifle-idle.json','application/json'],'/remote-combat.js':['public/remote-combat.js','text/javascript'],'/weapon-model.js':['public/weapon-model.js','text/javascript'],'/weapons.js':['weapons.js','text/javascript'],'/':['public/index.html','text/html'],'/style.css':['public/style.css','text/css'],'/client.js':['public/client.js','text/javascript'],'/game.js':['game.js','text/javascript'],'/three.js':['node_modules/three/build/three.module.js','text/javascript']};
Object.assign(assets,{'/bvh.js':['node_modules/three-mesh-bvh/build/index.module.js','text/javascript'],'/collision-world.js':['collision-world.js','text/javascript'],'/spatial-audio.js':['public/spatial-audio.js','text/javascript'],'/audio/credits':['public/audio/CREDITS.md','text/plain'],'/environment.js':['environment.js','text/javascript'],'/physics.js':['physics.js','text/javascript'],'/map-data.js':['map-data.js','text/javascript'],'/assets/minimap.webp':['public/assets/minimap.webp','image/webp'],'/assets/collision.glb':['public/assets/collision.glb','model/gltf-binary'],'/assets/title-background.webp':['public/assets/title-background.webp','image/webp'],'/assets/death-match-logo.webp':['public/assets/death-match-logo.webp','image/webp'],'/assets/arena.glb':['public/assets/arena.glb','model/gltf-binary'],'/assets/soldier.glb':['public/assets/soldier.glb','model/gltf-binary'],'/assets/swat.glb':['public/assets/swat.glb','model/gltf-binary']});
for(const path of ['loaders/GLTFLoader.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js','math/Capsule.js'])assets['/addons/'+path]=['node_modules/three/examples/jsm/'+path,'text/javascript'];
for(const sound of ['rifle','sniper','pistol','explosion','step1','step2','throw'])assets['/audio/'+sound+'.wav']=['public/audio/'+sound+'.wav','audio/wav'];
for(const w of Object.values(weapons))if(w.model)for(const [ext,type]of [['glb','model/gltf-binary'],['webp','image/webp']])assets['/assets/weapons/'+w.model+'.'+ext]=['public/assets/weapons/'+w.model+'.'+ext,type];
const cachedAssets=new Map(await Promise.all(Object.entries(assets).map(async([path,[file,type]])=>[path,{body:await readFile(new URL(file,import.meta.url)),type}])));
for(const asset of cachedAssets.values())asset.gzip=gzipSync(asset.body,{level:6});
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/api/rooms'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({rooms:[...rooms.values()].filter(r=>!r.private).map(r=>({code:r.code,host:r.state.players[0]?.name||'',count:r.players.length,capacity:2,phase:r.state.phase,mode:r.state.mode}))}));return;}if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({status:'ok'}));return;}const asset=cachedAssets.get(pathname);if(!asset){res.writeHead(404).end();return;}res.setHeader('Content-Type',asset.type+(asset.type.startsWith('text/')?'; charset=utf-8':''));res.setHeader('Cache-Control',pathname==='/three.js'||pathname.startsWith('/addons/')||pathname.startsWith('/assets/')||pathname.startsWith('/audio/')?'public, max-age=86400':'no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Accept-Encoding');const useGzip=/\bgzip\b/.test(req.headers['accept-encoding']||'');if(useGzip)res.setHeader('Content-Encoding','gzip');const body=useGzip?asset.gzip:asset.body;res.setHeader('Content-Length',body.length);res.end(body);}catch{res.writeHead(500).end('Server error');}});
const wss=new WebSocketServer({server,maxPayload:4096});
const rooms=new Map();
const send=(ws,msg)=>{if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>65536){ws.terminate();return;}ws.send(JSON.stringify(msg));};
function broadcast(room){for(const ws of room.players)send(ws,{type:'state',serverTime:Date.now(),state:room.state,ready:room.state.players.every(Boolean)});}
wss.on('connection',ws=>{
 if(wss.clients.size>200){ws.close(1013,'Server full');return;}
 ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
 let room,team,windowAt=Date.now(),messages=0,lastChatAt=0,lastSequence=-1;
 const joinTimer=setTimeout(()=>{if(!room)ws.close(1008,'Join timeout');},30000);
 ws.on('message',raw=>{try{
 if(Date.now()-windowAt>1000){windowAt=Date.now();messages=0;}if(++messages>90){ws.close(1008,'Input rate exceeded');return;}
 const a=JSON.parse(raw.toString());
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('올바른 명령 객체가 필요합니다.');
 if(!room){
 if(a.type!=='join'||typeof a.room!=='string'||! /^[A-Za-z0-9_-]{1,24}$/.test(a.room))throw Error('방 코드는 영문·숫자 1~24자로 입력하세요.');
 if(a.name!==undefined&&(typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name)))throw Error('이름은 1~12자로 입력하세요.');
 if(a.createOnly&&rooms.has(a.room))throw Error('이미 존재하는 방 코드입니다. 다시 만들어 주세요.');if(a.joinExisting&&!rooms.has(a.room))throw Error('종료된 방입니다. 목록을 새로고침해 주세요.');
 if(!rooms.has(a.room)){if(rooms.size>=100)throw Error('서버 방이 가득 찼습니다.');rooms.set(a.room,{state:initial(),brain:createBrain(),players:[],inputs:[null,null],inputAt:[0,0],jumpPending:[false,false],interactPending:[false,false],firePending:[false,false],chat:[],private:!!a.private,code:a.room});}
 const candidate=rooms.get(a.room);
 if(candidate.players.length>=2)throw Error('이미 두 명이 접속한 방입니다.');if(candidate.state.phase!=='lobby')throw Error('AI 대전이 진행 중입니다. 방장이 로비로 돌아온 뒤 참가해 주세요.');
 room=candidate;clearTimeout(joinTimer);team=room.players.length;room.players.push(ws);room.state.players[team]={name:a.name?.trim()||`오퍼레이터 ${team+1}`,ready:false};configureMode(room.state,room.players.length===2?'pvp':a.mode==='pvp'?'pvp':'ai');if(Object.hasOwn(weapons,a.weapon)){room.state.units[team].weapon=a.weapon;if(isPrimary(a.weapon))room.state.units[team].primary=a.weapon;if(isSidearm(a.weapon))room.state.units[team].secondary=a.weapon;}if(isPrimary(a.primary))room.state.units[team].primary=a.primary;if(isSidearm(a.secondary))room.state.units[team].secondary=a.secondary;send(ws,{type:'joined',team});if(room.chat.length)send(ws,{type:'chatHistory',messages:room.chat});broadcast(room);return;
 }
 if(a.type==='input'){
 if(room.state.phase!=='battle'||room.state.winner!==null)return;const input=cleanInput(a);if(input.seq<=lastSequence)return;lastSequence=input.seq;if(input.fire&&!room.inputs[team]?.fire)room.firePending[team]=true;room.inputs[team]=input;room.inputAt[team]=Date.now();if(input.jump)room.jumpPending[team]=true;if(input.interact)room.interactPending[team]=true;return;
 }
 if(a.type==='chat'){const now=Date.now();if(typeof a.text!=='string'||!a.text.trim()||Array.from(a.text.trim()).length>160||/[\u0000-\u001f\u007f]/.test(a.text))throw Error('채팅은 1~160자로 입력하세요.');if(now-lastChatAt<750)throw Error('잠시 후 메시지를 보내세요.');lastChatAt=now;const message={team,name:room.state.players[team].name,text:a.text.trim(),at:now};room.chat.push(message);if(room.chat.length>30)room.chat.shift();for(const other of room.players)send(other,{type:'chat',message});return;}
 if(a.type==='mode'){if(team!==0)throw Error('방장만 모드를 변경할 수 있습니다.');configureMode(room.state,a.mode);room.brain=createBrain();broadcast(room);return;}
 if(a.type==='leaveMatch'){if(room.state.phase==='battle'){clearTimeout(room.resetTimer);room.state=returnToLobby(room.state);room.brain=createBrain();room.resetTimer=null;room.inputs=[null,null];room.inputAt=[0,0];room.jumpPending=[false,false];room.interactPending=[false,false];room.firePending=[false,false];broadcast(room);}return;}
 action(room.state,team,a);broadcast(room);
 }catch(e){send(ws,{type:'error',message:e.message});}});
 ws.on('error',()=>{});
 ws.on('close',()=>{clearTimeout(joinTimer);if(!room||rooms.get(room.code)!==room)return;rooms.delete(room.code);clearTimeout(room.resetTimer);for(const other of room.players)if(other!==ws){send(other,{type:'closed',message:'상대가 연결을 종료했습니다. 다시 접속해 주세요.'});other.close();}});
});
let frame=0;
const simulation=setInterval(()=>{const now=Date.now();frame++;for(const room of rooms.values()){
 if(room.state.phase!=='battle')continue;
 const inputs=room.inputs.map((input,i)=>{const current=input&&now-room.inputAt[i]<300?{...input,jump:room.jumpPending[i],interact:room.interactPending[i],fire:input.fire||room.firePending[i]}:{yaw:room.state.units[i].yaw,pitch:room.state.units[i].pitch};room.jumpPending[i]=false;room.interactPending[i]=false;room.firePending[i]=false;return current;});
 if(room.state.mode==='ai'&&room.state.players[1]?.isBot)inputs[1]=botInput(room.state,room.brain,navigation,now);
 tick(room.state,inputs,now);
 if(room.state.winner!==null&&!room.resetTimer){broadcast(room);room.resetTimer=setTimeout(()=>{if(rooms.get(room.code)!==room)return;room.state=returnToLobby(room.state);room.brain=createBrain();room.inputs=[null,null];room.inputAt=[0,0];room.jumpPending=[false,false];room.interactPending=[false,false];room.firePending=[false,false];room.resetTimer=null;broadcast(room);},3000);}
 if(frame%2===0)broadcast(room);
}},1000/30);
// Ping frames keep the WebSocket active and detect broken connections.
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},25000);
const port=Number(process.env.PORT)||3000;
server.listen(port,'0.0.0.0',()=>console.log(`Server listening on port ${port}`));
let stopping=false;
function shutdown(){
 if(stopping)return;stopping=true;clearInterval(heartbeat);clearInterval(simulation);
 for(const ws of wss.clients){send(ws,{type:'closed',message:'서버가 재시작됩니다. 잠시 후 다시 접속해 주세요.'});ws.close(1001,'Server restarting');}
 wss.close();server.close(()=>process.exit(0));
 setTimeout(()=>process.exit(0),5000).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

