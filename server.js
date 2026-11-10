import {isPrimary,isSidearm} from './weapons.js';
import http from 'node:http';
import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {gzipSync} from 'node:zlib';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {WebSocketServer,WebSocket} from 'ws';
import {initial,action,tick,cleanInput,weapons,returnToLobby,configureMode} from './game.js';
import {setWorld} from './physics.js';
import {buildNavigation,createBrain,botInput} from './bot.js';
import {loadWorld} from './world.js';
const world=await loadWorld();setWorld(world);const navigation=buildNavigation(world);
const derivePassword=promisify(scrypt);
function roomPasswordError(message,code){const error=new Error(message);error.code=code;return error;}
function readRoomPassword(value){
 if(typeof value!=='string'||Array.from(value).length>24||/[\u0000-\u001f\u007f]/.test(value))throw roomPasswordError('방 비밀번호는 24자 이내로 입력하세요.','PASSWORD_INVALID');
 return value;
}
async function hashRoomPassword(value){const salt=randomBytes(16);return {salt,hash:await derivePassword(value,salt,32)};}
async function verifyRoomPassword(room,value,now){
 if(room.passwordUpdating)throw roomPasswordError('방장이 비밀번호를 설정 중입니다. 잠시 후 다시 참가하세요.','PASSWORD_CHANGED');
 if(!room.password)return;
 if(!value)throw roomPasswordError('방 비밀번호를 입력하세요.','PASSWORD_REQUIRED');
 room.authTokens=Math.min(10,room.authTokens+(now-room.authRefilledAt)/1000);room.authRefilledAt=now;
 if(room.authTokens<1)throw roomPasswordError('비밀번호 확인 요청이 많습니다. 잠시 후 다시 시도하세요.','PASSWORD_RATE_LIMIT');room.authTokens--;
 const version=room.passwordVersion,expected=room.password,actual=await derivePassword(value,expected.salt,32);
 if(version!==room.passwordVersion||room.passwordUpdating)throw roomPasswordError('방 비밀번호가 변경되었습니다. 다시 입력하세요.','PASSWORD_CHANGED');
 if(!timingSafeEqual(actual,expected.hash))throw roomPasswordError('방 비밀번호가 올바르지 않습니다.','PASSWORD_INCORRECT');
}
const assets={'/assets/soldier-rigged.glb':['public/assets/soldier-rigged.glb','model/gltf-binary'],'/assets/crouch-idle.json':['public/assets/crouch-idle.json','application/json'],'/assets/dying.json':['public/assets/dying.json','application/json'],'/assets/rifle-idle.json':['public/assets/rifle-idle.json','application/json'],'/remote-combat.js':['public/remote-combat.js','text/javascript'],'/weapon-model.js':['public/weapon-model.js','text/javascript'],'/weapons.js':['weapons.js','text/javascript'],'/':['public/index.html','text/html'],'/style.css':['public/style.css','text/css'],'/client.js':['public/client.js','text/javascript'],'/game.js':['game.js','text/javascript'],'/three.js':['node_modules/three/build/three.module.js','text/javascript']};
Object.assign(assets,{'/bvh.js':['node_modules/three-mesh-bvh/build/index.module.js','text/javascript'],'/collision-world.js':['collision-world.js','text/javascript'],'/spatial-audio.js':['public/spatial-audio.js','text/javascript'],'/audio/credits':['public/audio/CREDITS.md','text/plain'],'/environment.js':['environment.js','text/javascript'],'/physics.js':['physics.js','text/javascript'],'/map-data.js':['map-data.js','text/javascript'],'/assets/minimap.webp':['public/assets/minimap.webp','image/webp'],'/assets/collision.glb':['public/assets/collision.glb','model/gltf-binary'],'/assets/title-background.webp':['public/assets/title-background.webp','image/webp'],'/assets/death-match-logo.webp':['public/assets/death-match-logo.webp','image/webp'],'/assets/arena.glb':['public/assets/arena.glb','model/gltf-binary'],'/assets/soldier.glb':['public/assets/soldier.glb','model/gltf-binary'],'/assets/swat.glb':['public/assets/swat.glb','model/gltf-binary']});
for(const path of ['loaders/GLTFLoader.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js','math/Capsule.js'])assets['/addons/'+path]=['node_modules/three/examples/jsm/'+path,'text/javascript'];
for(const sound of ['rifle','sniper','pistol','explosion','step1','step2','throw'])assets['/audio/'+sound+'.wav']=['public/audio/'+sound+'.wav','audio/wav'];
for(const w of Object.values(weapons))if(w.model)for(const [ext,type]of [['glb','model/gltf-binary'],['webp','image/webp']])assets['/assets/weapons/'+w.model+'.'+ext]=['public/assets/weapons/'+w.model+'.'+ext,type];
const cachedAssets=new Map(await Promise.all(Object.entries(assets).map(async([path,[file,type]])=>[path,{body:await readFile(new URL(file,import.meta.url)),type}])));
for(const asset of cachedAssets.values())asset.gzip=gzipSync(asset.body,{level:6});
// Stream music on demand instead of caching or gzip-compressing full MP3 files.
const musicTracks=new Map(await Promise.all(['main-theme-wot','lobby-theme-mw2','result-victory','result-defeat','battle-intro-abbey'].map(async name=>{
 const file=new URL(`public/audio/${name}.mp3`,import.meta.url),info=await stat(file);
 return [`/audio/${name}.mp3`,{file,size:info.size}];
})));
function serveMusic(req,res,track){
 res.setHeader('Content-Type','audio/mpeg');res.setHeader('Accept-Ranges','bytes');
 res.setHeader('Cache-Control','public, max-age=86400');res.setHeader('X-Content-Type-Options','nosniff');
 let start=0,end=track.size-1;
 if(req.headers.range){
  const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
  const invalid=()=>{res.writeHead(416,{'Content-Range':`bytes */${track.size}`,'Content-Length':0});res.end();};
  if(!match||!match[1]&&!match[2]){invalid();return;}
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){invalid();return;}start=Math.max(0,track.size-suffix);}
  else{start=Number(match[1]);if(match[2])end=Number(match[2]);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=track.size||end<start){invalid();return;}
  end=Math.min(end,track.size-1);res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${track.size}`);
 }
 res.setHeader('Content-Length',end-start+1);
 if(req.method==='HEAD'){res.end();return;}
 const stream=createReadStream(track.file,{start,end});
 stream.on('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
}
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/api/rooms'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({rooms:[...rooms.values()].filter(r=>!r.private).map(r=>({code:r.code,host:r.state.players[0]?.name||'',count:r.state.players.filter(p=>p&&!p.isBot).length,capacity:2,phase:r.state.phase,mode:r.state.mode,locked:!!r.password}))}));return;}if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({status:'ok'}));return;}const music=musicTracks.get(pathname);if(music){serveMusic(req,res,music);return;}const asset=cachedAssets.get(pathname);if(!asset){res.writeHead(404).end();return;}res.setHeader('Content-Type',asset.type+(asset.type.startsWith('text/')?'; charset=utf-8':''));res.setHeader('Cache-Control',pathname==='/three.js'||pathname.startsWith('/addons/')||pathname.startsWith('/assets/')||pathname.startsWith('/audio/')?'public, max-age=86400':'no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Accept-Encoding');const useGzip=/\bgzip\b/.test(req.headers['accept-encoding']||'');if(useGzip)res.setHeader('Content-Encoding','gzip');const body=useGzip?asset.gzip:asset.body;res.setHeader('Content-Length',body.length);res.end(body);}catch{res.writeHead(500).end('Server error');}});
const wss=new WebSocketServer({server,maxPayload:4096});
const rooms=new Map(),sessions=new Map();
const RECONNECT_GRACE_MS=60000,STATE_BUFFER_LIMIT=65536;
let connectionId=0;
function send(ws,message,snapshot=false){
 if(!ws||ws.readyState!==WebSocket.OPEN)return false;
 // State snapshots supersede one another. Let queued data drain instead of kicking a slow client.
 if(snapshot&&ws.bufferedAmount>STATE_BUFFER_LIMIT)return false;
 if(ws.bufferedAmount>1024*1024)return false;
 try{ws.send(typeof message==='string'?message:JSON.stringify(message));return true;}catch{return false;}
}
function clearSeatInputs(room,team){room.inputs[team]=null;room.inputAt[team]=0;room.jumpPending[team]=room.interactPending[team]=room.firePending[team]=false;}
function resetMatch(room){room.state=returnToLobby(room.state);room.brain=createBrain();for(let i=0;i<2;i++){clearSeatInputs(room,i);if(room.sessions[i])room.sessions[i].lastSequence=0;}}
function broadcast(room){
 const connected=room.players.map(ws=>ws?.readyState===WebSocket.OPEN);
 const message=JSON.stringify({type:'state',serverTime:Date.now(),state:room.state,ready:room.state.players.every(Boolean),connected,passwordProtected:!!room.password});
 for(const ws of room.players)send(ws,message,true);
}
function closeRoom(room,message,code){
 if(rooms.get(room.code)!==room)return;
 rooms.delete(room.code);
 for(const session of room.sessions){if(!session)continue;clearTimeout(session.expiryTimer);sessions.delete(session.token);}
 for(const ws of room.players){if(!ws)continue;send(ws,{type:'closed',code,message});ws.close(1000,'Room closed');}
}
function reserveSeat(session,code,reason){
 const {room,team}=session;if(rooms.get(room.code)!==room)return;
 session.ws=null;session.expiresAt=Date.now()+RECONNECT_GRACE_MS;room.players[team]=null;clearSeatInputs(room,team);
 if(room.state.phase==='lobby')room.state.players[team].ready=false;
 console.info(JSON.stringify({event:'player_disconnected',team,code,reason:String(reason).slice(0,100),phase:room.state.phase,resumeSeconds:RECONNECT_GRACE_MS/1000}));
 clearTimeout(session.expiryTimer);
 session.expiryTimer=setTimeout(()=>{if(!session.ws&&Date.now()>=session.expiresAt)closeRoom(room,'상대의 재연결 대기 시간이 끝났습니다. 방 메뉴에서 다시 참가해 주세요.','peer_timeout');},RECONNECT_GRACE_MS+20);
 session.expiryTimer.unref();broadcast(room);
}
wss.on('connection',ws=>{
 if(wss.clients.size>220){ws.close(1013,'Server full');return;}
 ws.connectionId=++connectionId;ws.lastSeen=Date.now();ws.on('pong',()=>{ws.lastSeen=Date.now();});
 let room=null,team=null,session=null,tokens=240,refilledAt=Date.now(),lastRateNotice=0,joining=false;
 const joinTimer=setTimeout(()=>{if(!room)ws.close(1008,'Join timeout');},30000);
 function attach(next,resumed){
  session=next;room=next.room;team=next.team;
  const previous=next.ws;next.ws=ws;next.expiresAt=0;clearTimeout(next.expiryTimer);room.players[team]=ws;clearSeatInputs(room,team);clearTimeout(joinTimer);
  if(previous&&previous!==ws){send(previous,{type:'closed',code:'session_replaced',message:'다른 창에서 같은 플레이어로 접속했습니다.'});previous.close(4001,'Session replaced');}
  send(ws,{type:'joined',team,room:room.code,sessionToken:next.token,resumed,graceMs:RECONNECT_GRACE_MS,inputSequence:next.lastSequence});
  if(room.chat.length)send(ws,{type:'chatHistory',messages:room.chat});
  if(resumed)console.info(JSON.stringify({event:'player_resumed',team,phase:room.state.phase}));
  broadcast(room);
 }
 ws.on('message',async raw=>{let actionType=null;try{
  const now=Date.now();ws.lastSeen=now;
  tokens=Math.min(240,tokens+(now-refilledAt)*.12);refilledAt=now;
  // A short input burst is coalesced/dropped, never treated as a reason to delete a match.
  if(tokens<1){if(now-lastRateNotice>1000){lastRateNotice=now;console.warn(JSON.stringify({event:'input_throttled',connectionId:ws.connectionId}));}return;}tokens--;
  const a=JSON.parse(raw.toString());if(!a||typeof a!=='object'||Array.isArray(a))throw Error('올바른 명령 객체가 필요합니다.');actionType=a.type;
  if(!room){
   if(joining)return;joining=true;try{
    if(a.type==='resume'){
     const saved=typeof a.token==='string'&&a.token.length===32?sessions.get(a.token):null;
     if(!saved||rooms.get(saved.room.code)!==saved.room||saved.room.code!==a.room||saved.expiresAt&&now>=saved.expiresAt){
      send(ws,{type:'resumeRejected',message:'기존 전투를 복구할 수 없습니다. 서버 재시작 또는 재연결 대기 시간 만료입니다.'});ws.close(4004,'Session expired');return;
     }
     attach(saved,true);return;
    }
    if(a.type!=='join'||typeof a.room!=='string'||! /^[A-Za-z0-9_-]{1,24}$/.test(a.room))throw Error('방 코드는 영문·숫자 1~24자로 입력하세요.');
    if(a.name!==undefined&&(typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name)))throw Error('이름은 1~12자로 입력하세요.');
    if(a.createOnly&&rooms.has(a.room))throw Error('이미 존재하는 방 코드입니다. 다시 만들어 주세요.');if(a.joinExisting&&!rooms.has(a.room))throw Error('종료된 방입니다. 목록을 새로고침해 주세요.');
    if(!rooms.has(a.room)){
     if(rooms.size>=100)throw Error('서버 방이 가득 찼습니다.');
     rooms.set(a.room,{state:initial(),brain:createBrain(),players:[null,null],sessions:[null,null],inputs:[null,null],inputAt:[0,0],jumpPending:[false,false],interactPending:[false,false],firePending:[false,false],chat:[],private:!!a.private,code:a.room,password:null,passwordVersion:0,passwordRequest:0,passwordUpdating:false,authTokens:10,authRefilledAt:now});
    }
    const candidate=rooms.get(a.room);
    if(candidate.state.players.filter(p=>p&&!p.isBot).length>=2)throw Error('이미 두 명이 접속한 방입니다.');if(candidate.state.phase!=='lobby')throw Error('전투 또는 결과 확인이 진행 중입니다. 로비로 돌아온 뒤 참가해 주세요.');
    const passwordVersion=candidate.passwordVersion,suppliedPassword=readRoomPassword(a.password??'');
    if(candidate.password||candidate.passwordUpdating)await verifyRoomPassword(candidate,suppliedPassword,now);
    if(ws.readyState!==WebSocket.OPEN)return;
    if(rooms.get(a.room)!==candidate)throw Error('종료된 방입니다. 목록을 새로고침해 주세요.');
    if(passwordVersion!==candidate.passwordVersion||candidate.passwordUpdating)throw roomPasswordError('방 비밀번호가 변경되었습니다. 다시 입력하세요.','PASSWORD_CHANGED');
    // Recheck after the asynchronous password check before assigning a seat.
    const humans=candidate.state.players.filter(p=>p&&!p.isBot).length;
    if(humans>=2)throw Error('이미 두 명이 접속한 방입니다.');if(candidate.state.phase!=='lobby')throw Error('전투 또는 결과 확인이 진행 중입니다. 로비로 돌아온 뒤 참가해 주세요.');
    const seat=candidate.state.players.findIndex(p=>!p||p.isBot);
    candidate.state.players[seat]={name:a.name?.trim()||`오퍼레이터 ${seat+1}`,ready:false};
    configureMode(candidate.state,humans+1===2?'pvp':a.mode==='pvp'?'pvp':'ai');
    const unit=candidate.state.units[seat];
    if(Object.hasOwn(weapons,a.weapon)){unit.weapon=a.weapon;if(isPrimary(a.weapon))unit.primary=a.weapon;if(isSidearm(a.weapon))unit.secondary=a.weapon;}
    if(isPrimary(a.primary))unit.primary=a.primary;if(isSidearm(a.secondary))unit.secondary=a.secondary;
    const token=randomBytes(24).toString('base64url'),saved={token,room:candidate,team:seat,ws:null,expiresAt:0,expiryTimer:null,lastChatAt:0,lastSequence:unit.ack};
    sessions.set(token,saved);candidate.sessions[seat]=saved;attach(saved,false);return;
   }finally{joining=false;}
  }
  if(session?.ws!==ws||rooms.get(room.code)!==room)return;
  if(a.type==='ping'){send(ws,{type:'pong'});return;}
  if(a.type==='leaveRoom'){closeRoom(room,'상대가 방을 나갔습니다. 방 메뉴에서 다시 참가해 주세요.','peer_left');return;}
  if(a.type==='roomPassword'){
   if(team!==0)throw roomPasswordError('방장만 비밀번호를 설정할 수 있습니다.','PASSWORD_FORBIDDEN');
   if(room.state.phase!=='lobby')throw roomPasswordError('로비에서 비밀번호를 설정하세요.','PASSWORD_FORBIDDEN');
   const value=readRoomPassword(a.password),request=++room.passwordRequest;room.passwordUpdating=true;
   try{
    const password=value?await hashRoomPassword(value):null;
    if(session.ws!==ws||rooms.get(room.code)!==room)return;
    if(room.state.phase!=='lobby')throw roomPasswordError('로비에서 비밀번호를 설정하세요.','PASSWORD_FORBIDDEN');
    if(request!==room.passwordRequest)return;
    room.password=password;room.passwordVersion++;
    send(ws,{type:'passwordUpdated',passwordProtected:!!password});broadcast(room);
   }finally{if(request===room.passwordRequest)room.passwordUpdating=false;}
   return;
  }
  if(a.type==='input'){
   if(room.state.phase!=='battle'||room.state.winner!==null)return;
   const input=cleanInput(a);if(input.seq<=session.lastSequence)return;session.lastSequence=input.seq;
   if(input.fire&&!room.inputs[team]?.fire)room.firePending[team]=true;
   room.inputs[team]=input;room.inputAt[team]=now;if(input.jump)room.jumpPending[team]=true;if(input.interact)room.interactPending[team]=true;return;
  }
  if(a.type==='chat'){
   if(typeof a.text!=='string'||!a.text.trim()||Array.from(a.text.trim()).length>160||/[\u0000-\u001f\u007f]/.test(a.text))throw Error('채팅은 1~160자로 입력하세요.');
   if(now-session.lastChatAt<750)throw Error('잠시 후 메시지를 보내세요.');session.lastChatAt=now;
   const message={team,name:room.state.players[team].name,text:a.text.trim(),at:now};room.chat.push(message);if(room.chat.length>30)room.chat.shift();for(const other of room.players)send(other,{type:'chat',message});return;
  }
  if(a.type==='mode'){if(team!==0)throw Error('방장만 모드를 변경할 수 있습니다.');configureMode(room.state,a.mode);room.brain=createBrain();broadcast(room);return;}
  if(a.type==='confirmResult'){
   if(room.state.phase!=='results')return;room.state.resultsConfirmed[team]=true;
   if(room.state.players.every((p,id)=>!p||p.isBot||room.state.resultsConfirmed[id]))resetMatch(room);
   broadcast(room);return;
  }
  if(a.type==='leaveMatch'){if(room.state.phase==='battle'){resetMatch(room);broadcast(room);}return;}
  if(a.type==='ready'&&room.state.players.some((p,id)=>p&&!p.isBot&&room.players[id]?.readyState!==WebSocket.OPEN))throw Error('상대가 다시 연결할 때까지 기다려 주세요.');
  action(room.state,team,a,now);broadcast(room);
 }catch(e){send(ws,{type:'error',code:e.code||'REQUEST_FAILED',action:actionType,message:e.message});}});
 ws.on('error',()=>{});
 ws.on('close',(code,reason)=>{clearTimeout(joinTimer);if(session?.ws===ws)reserveSeat(session,code,reason);});
});
let frame=0;
const simulation=setInterval(()=>{const now=Date.now();frame++;for(const room of rooms.values()){
 if(!['intro','countdown','battle','ending'].includes(room.state.phase))continue;
 const inputs=room.inputs.map((input,i)=>{const current=input&&now-room.inputAt[i]<300?{...input,jump:room.jumpPending[i],interact:room.interactPending[i],fire:input.fire||room.firePending[i]}:{yaw:room.state.units[i].yaw,pitch:room.state.units[i].pitch,crouch:room.state.units[i].crouching};room.jumpPending[i]=false;room.interactPending[i]=false;room.firePending[i]=false;return current;});
 if(room.state.phase==='battle'&&room.state.mode==='ai'&&room.state.players[1]?.isBot)inputs[1]=botInput(room.state,room.brain,navigation,now);
 const previousPhase=room.state.phase;tick(room.state,inputs,now);
 if(room.state.phase!==previousPhase||frame%2===0)broadcast(room);
}},1000/30);
// Ping frames keep the WebSocket active and detect broken connections.
const heartbeat=setInterval(()=>{const now=Date.now();for(const ws of wss.clients){if(now-ws.lastSeen>45000){console.warn(JSON.stringify({event:'socket_timeout',connectionId:ws.connectionId}));ws.terminate();continue;}if(ws.readyState===WebSocket.OPEN)ws.ping();}},15000);
const port=Number(process.env.PORT)||3000;
server.listen(port,'0.0.0.0',()=>console.log(`Server listening on port ${port}`));
let stopping=false;
function shutdown(){
 if(stopping)return;stopping=true;clearInterval(heartbeat);clearInterval(simulation);
 for(const ws of wss.clients){send(ws,{type:'closed',code:'server_restart',message:'서버가 재시작됩니다. 잠시 후 다시 연결합니다.'});ws.close(1001,'Server restarting');}
 wss.close();server.close(()=>process.exit(0));
 setTimeout(()=>process.exit(0),5000).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

