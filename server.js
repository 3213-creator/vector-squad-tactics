import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {WebSocketServer,WebSocket} from 'ws';
import {initial,act,weapons,returnToLobby} from './game.js';
const assets={'/':['public/index.html','text/html'],'/style.css':['public/style.css','text/css'],'/client.js':['public/client.js','text/javascript'],'/game.js':['game.js','text/javascript'],'/three.js':['node_modules/three/build/three.module.js','text/javascript']};
Object.assign(assets,{'/map-data.js':['map-data.js','text/javascript'],'/assets/arena.glb':['public/assets/arena.glb','model/gltf-binary'],'/assets/soldier.glb':['public/assets/soldier.glb','model/gltf-binary'],'/assets/swat.glb':['public/assets/swat.glb','model/gltf-binary']});
for(const path of ['loaders/GLTFLoader.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js'])assets['/addons/'+path]=['node_modules/three/examples/jsm/'+path,'text/javascript'];
const cachedAssets=new Map(await Promise.all(Object.entries(assets).map(async([path,[file,type]])=>[path,{body:await readFile(new URL(file,import.meta.url)),type}])));
for(const asset of cachedAssets.values())asset.gzip=gzipSync(asset.body,{level:6});
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({status:'ok'}));return;}const asset=cachedAssets.get(pathname);if(!asset){res.writeHead(404).end();return;}res.setHeader('Content-Type',asset.type+(asset.type.startsWith('text/')?'; charset=utf-8':''));res.setHeader('Cache-Control',pathname==='/three.js'||pathname.startsWith('/addons/')||pathname.startsWith('/assets/')?'public, max-age=86400':'no-cache');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Accept-Encoding');const useGzip=/\bgzip\b/.test(req.headers['accept-encoding']||'');if(useGzip)res.setHeader('Content-Encoding','gzip');const body=useGzip?asset.gzip:asset.body;res.setHeader('Content-Length',body.length);res.end(body);}catch{res.writeHead(500).end('Server error');}});
const wss=new WebSocketServer({server,maxPayload:4096});
const rooms=new Map();
const send=(ws,msg)=>{if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>65536){ws.terminate();return;}ws.send(JSON.stringify(msg));};
function broadcast(room){for(const ws of room.players)send(ws,{type:'state',state:room.state,ready:room.players.length===2});}
wss.on('connection',ws=>{
 if(wss.clients.size>200){ws.close(1013,'Server full');return;}
 ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
 let room,team,last=0;
 const joinTimer=setTimeout(()=>{if(!room)ws.close(1008,'Join timeout');},30000);
 ws.on('message',raw=>{try{
 if(Date.now()-last<40)throw Error('너무 빠른 요청입니다. 다시 시도하세요.');last=Date.now();
 const a=JSON.parse(raw.toString());
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('올바른 명령 객체가 필요합니다.');
 if(!room){
 if(a.type!=='join'||typeof a.room!=='string'||! /^[A-Za-z0-9_-]{1,24}$/.test(a.room))throw Error('방 코드는 영문·숫자 1~24자로 입력하세요.');
 if(a.name!==undefined&&(typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name)))throw Error('이름은 1~12자로 입력하세요.');
 if(!rooms.has(a.room)){if(rooms.size>=100)throw Error('서버 방이 가득 찼습니다.');rooms.set(a.room,{state:initial(),players:[],code:a.room});}
 const candidate=rooms.get(a.room);
 if(candidate.players.length>=2)throw Error('이미 두 명이 접속한 방입니다.');
 room=candidate;clearTimeout(joinTimer);team=room.players.length;room.players.push(ws);room.state.players[team]={name:a.name?.trim()||`오퍼레이터 ${team+1}`,ready:false};if(Object.hasOwn(weapons,a.weapon))room.state.units[team].weapon=a.weapon;send(ws,{type:'joined',team});broadcast(room);return;
 }
 if(room.players.length!==2&&!['profile','equip','ready'].includes(a.type))throw Error('상대 접속을 기다리는 중입니다.');
 act(room.state,team,a);broadcast(room);
 if(room.state.winner!==null&&!room.resetTimer){room.resetTimer=setTimeout(()=>{if(rooms.get(room.code)!==room)return;room.state=returnToLobby(room.state);room.resetTimer=null;broadcast(room);},3000);}

 }catch(e){send(ws,{type:'error',message:e.message});}});
 ws.on('error',()=>{});
 ws.on('close',()=>{clearTimeout(joinTimer);if(!room||rooms.get(room.code)!==room)return;rooms.delete(room.code);clearTimeout(room.resetTimer);for(const other of room.players)if(other!==ws){send(other,{type:'closed',message:'상대가 연결을 종료했습니다. 다시 접속해 주세요.'});other.close();}});
});
// Ping frames keep the WebSocket active and detect broken connections.
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},25000);
const port=Number(process.env.PORT)||3000;
server.listen(port,'0.0.0.0',()=>console.log(`Server listening on port ${port}`));
let stopping=false;
function shutdown(){
 if(stopping)return;stopping=true;clearInterval(heartbeat);
 for(const ws of wss.clients){send(ws,{type:'closed',message:'서버가 재시작됩니다. 잠시 후 다시 접속해 주세요.'});ws.close(1001,'Server restarting');}
 wss.close();server.close(()=>process.exit(0));
 setTimeout(()=>process.exit(0),5000).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

