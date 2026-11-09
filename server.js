import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {WebSocketServer,WebSocket} from 'ws';
import {initial,act} from './game.js';
const assets={'/':['public/index.html','text/html'],'/style.css':['public/style.css','text/css'],'/client.js':['public/client.js','text/javascript'],'/game.js':['game.js','text/javascript'],'/three.js':['node_modules/three/build/three.module.js','text/javascript']};
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({status:'ok'}));return;}const asset=assets[pathname];if(!asset){res.writeHead(404).end();return;}res.setHeader('Content-Type',asset[1]+'; charset=utf-8');res.end(await readFile(new URL(asset[0],import.meta.url)));}catch{res.writeHead(500).end('Server error');}});
const wss=new WebSocketServer({server,maxPayload:4096});
const rooms=new Map();
const send=(ws,msg)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));};
function broadcast(room){for(const ws of room.players)send(ws,{type:'state',state:room.state,ready:room.players.length===2});}
wss.on('connection',ws=>{
 ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
 let room,team,last=0;
 ws.on('message',raw=>{try{
 if(Date.now()-last<40)return;last=Date.now();
 const a=JSON.parse(raw.toString());
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('올바른 명령 객체가 필요합니다.');
 if(!room){
 if(a.type!=='join'||typeof a.room!=='string'||! /^[A-Za-z0-9_-]{1,24}$/.test(a.room))throw Error('방 코드는 영문·숫자 1~24자로 입력하세요.');
 if(!rooms.has(a.room)){if(rooms.size>=100)throw Error('서버 방이 가득 찼습니다.');rooms.set(a.room,{state:initial(),players:[],code:a.room});}
 const candidate=rooms.get(a.room);
 if(candidate.players.length>=2)throw Error('이미 두 명이 접속한 방입니다.');
 room=candidate;team=room.players.length;room.players.push(ws);send(ws,{type:'joined',team});broadcast(room);return;
 }
 if(room.players.length!==2)throw Error('상대 접속을 기다리는 중입니다.');
 act(room.state,team,a);broadcast(room);
 }catch(e){send(ws,{type:'error',message:e.message});}});
 ws.on('error',()=>{});
 ws.on('close',()=>{if(!room||rooms.get(room.code)!==room)return;rooms.delete(room.code);for(const other of room.players)if(other!==ws){send(other,{type:'closed',message:'상대가 연결을 종료했습니다. 다시 접속해 주세요.'});other.close();}});
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

