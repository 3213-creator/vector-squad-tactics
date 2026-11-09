import {Vector3,Ray,Sphere,Box3} from 'three';
import {moveBody,look,EYE,STEP,getWorld,setCrates,shotOrigin} from './physics.js';
export const weapons={
 rifle:{name:'AR-01 라이플',slot:'주무기',damage:30,head:60,rpm:600,mag:30,range:80,reload:1800},
 sniper:{name:'SR-08 저격총',slot:'주무기',damage:85,head:110,rpm:50,mag:5,range:120,reload:2600},
 pistol:{name:'P-09 권총',slot:'보조무기',damage:18,head:40,rpm:300,mag:12,range:45,reload:1200},
 knife:{name:'K-01 전투 나이프',slot:'근접무기',damage:40,head:100,rpm:90,mag:null,range:2,reload:0}
};
export function spawnPoint(id){return {x:id?7.5:-7.5,y:.15,z:.5,yaw:id?Math.PI/2:-Math.PI/2,pitch:0};}
function body(id){return {id,...spawnPoint(id),vx:0,vy:0,vz:0,grounded:false,hp:100,lives:3,weapon:'rifle',primary:'rifle',ammo:{rifle:30,sniper:5,pistol:12},reserve:{rifle:90,sniper:15,pistol:36},grenades:2,lastShot:0,nextShotAt:0,lastMelee:0,reloadUntil:0,respawnAt:0,shieldUntil:0,ack:0,shots:0};}
export function initial(){return {phase:'lobby',players:[null,null],winner:null,units:[body(0),body(1)],grenades:[],crates:[],events:[],clock:0,lastEvent:'1 대 1 FPS 준비'};}
export function returnToLobby(old){const next=initial();next.players=old.players.map(p=>p?{...p,ready:false}:null);next.units.forEach((u,i)=>{u.weapon=old.units[i].weapon;u.primary=old.units[i].primary;});return next;}
function event(s,type,data={}){s.events.push({id:++s.clock,type,...data});if(s.events.length>16)s.events.shift();}
export function action(s,id,a,now=Date.now()){
 const u=s.units[id],player=s.players[id];if(!player)throw Error('먼저 방에 참가하세요.');
 if(a.type==='profile'){if(s.phase!=='lobby'||typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name))throw Error('로비에서 이름을 1~12자로 입력하세요.');player.name=a.name.trim();return;}
 if(a.type==='ready'){if(s.phase!=='lobby')return;player.ready=!player.ready;if(s.players.every(p=>p?.ready)){s.phase='battle';s.crates=makeCrates();s.units.forEach(u=>u.shieldUntil=now+1500);event(s,'start');}return;}
 if(a.type==='equip'){
 if(!Object.hasOwn(weapons,a.weapon))throw Error('잘못된 무기입니다.');if(s.phase==='battle'&&(u.hp<=0||s.winner!==null))return;
 u.weapon=a.weapon;if(a.weapon==='rifle'||a.weapon==='sniper')u.primary=a.weapon;u.reloadUntil=0;if(s.phase==='lobby')player.ready=false;return;
 }
 if(s.phase!=='battle'||s.winner!==null||u.hp<=0)return;
 if(a.type==='reload'){const w=weapons[u.weapon];if(w.mag!==null&&!u.reloadUntil&&u.ammo[u.weapon]<w.mag&&u.reserve[u.weapon]>0){u.reloadUntil=now+w.reload;event(s,'reload',{actor:id});}return;}
 if(a.type==='melee'){if(now-u.lastMelee<800||u.reloadUntil)return;u.lastMelee=now;strike(s,u,40,2.1,now,true,100);event(s,'melee',{actor:id});return;}
 if(a.type==='grenade'){if(u.grenades<=0||s.grenades.length>=8)return;u.grenades--;const d=look(u.yaw,u.pitch);s.grenades.push({id:++s.clock,owner:id,x:u.x+d.x*.5,y:u.y+EYE,z:u.z+d.z*.5,vx:d.x*10,vy:d.y*10+3,vz:d.z*10,explodeAt:now+1700});return;}
}
export function hurt(s,target,damage,attacker,now){if(target.hp<=0||s.winner!==null||now<target.shieldUntil)return;target.hp=Math.max(0,target.hp-damage);event(s,'hit',{actor:attacker,target:target.id,damage});if(target.hp===0){target.lives--;target.reloadUntil=0;target.respawnAt=target.lives>0?now+2000:0;event(s,'death',{target:target.id});if(target.lives===0){s.winner=1-target.id;event(s,'victory',{actor:s.winner});}}}
function strike(s,u,damage,range,now,melee=false,headDamage=damage){const origin=melee?new Vector3(u.x,u.y+EYE,u.z):shotOrigin(u),direction=look(u.yaw,u.pitch),ray=new Ray(origin,direction),v=s.units[1-u.id];
 let distance=Infinity,headshot=false;const point=new Vector3();let crateDistance=Infinity,selectedCrate=null;
 for(const c of s.crates){if(c.broken)continue;let dist=Infinity;if(melee){const delta=new Vector3(c.x,c.y+.4,c.z).sub(origin);if(delta.length()<=range&&delta.clone().normalize().dot(direction)>.4)dist=delta.length();}else{const p=ray.intersectBox(new Box3(new Vector3(c.x-.4,c.y,c.z-.4),new Vector3(c.x+.4,c.y+.75,c.z+.4)),new Vector3());if(p)dist=origin.distanceTo(p);}if(dist<crateDistance){crateDistance=dist;selectedCrate=c;}}
 const cover=getWorld()?.rayIntersect(ray);if(!melee){const eye=new Vector3(u.x,u.y+EYE,u.z),barrel=origin.clone().sub(eye),barrelLength=barrel.length(),obstruction=getWorld()?.rayIntersect(new Ray(eye,barrel.normalize()));if(obstruction&&obstruction.distance<barrelLength)return;}if(melee&&selectedCrate&&crateDistance<=range&&(!cover||cover.distance>=crateDistance-.3)){selectedCrate.hp-=damage;if(selectedCrate.hp<=0){selectedCrate.broken=true;event(s,'crate',{x:selectedCrate.x,y:selectedCrate.y,z:selectedCrate.z});}return;}
 if(melee){const delta=new Vector3(v.x,v.y+.9,v.z).sub(origin);if(delta.length()<=range&&delta.normalize().dot(direction)>.4)distance=origin.distanceTo(new Vector3(v.x,v.y+.9,v.z));}else{for(const [height,radius] of [[.7,.34],[1.1,.34],[1.5,.25]]){const hit=ray.intersectSphere(new Sphere(new Vector3(v.x,v.y+height,v.z),radius),point);if(hit&&origin.distanceTo(hit)<distance){distance=origin.distanceTo(hit);headshot=height===1.5;}}}
 if(melee&&distance<=range){const head=ray.intersectSphere(new Sphere(new Vector3(v.x,v.y+1.5,v.z),.28),new Vector3());headshot=!!head&&origin.distanceTo(head)<=range;const fromVictim=new Vector3(u.x-v.x,0,u.z-v.z).normalize();if(fromVictim.dot(look(v.yaw,0))<-.5)headshot=true;}
 const wall=getWorld()?.rayIntersect(ray);if(v.hp>0&&distance<=range&&distance<crateDistance&&(!wall||wall.distance+0.03>=distance))hurt(s,v,headshot?headDamage:damage,u.id,now);
}
export function tick(s,inputs,now=Date.now(),dt=STEP){if(s.phase!=='battle'||s.winner!==null)return;
 for(const u of s.units){if(u.hp<=0){if(u.respawnAt&&now>=u.respawnAt){const lives=u.lives,weapon=u.weapon,primary=u.primary,ack=u.ack;Object.assign(u,body(u.id),{lives,weapon,primary,ack,shieldUntil:now+1500});event(s,'respawn',{target:u.id});}continue;}
 const input=inputs[u.id]||{};setCrates(s.crates);moveBody(u,input,dt);u.scoped=!!input.scoped&&u.weapon==='sniper';if(Number.isInteger(input.seq))u.ack=input.seq;if(u.y< -5){hurt(s,u,1000,1-u.id,now);continue;}
 if(u.reloadUntil&&now>=u.reloadUntil){const amount=Math.min(weapons[u.weapon].mag-u.ammo[u.weapon],u.reserve[u.weapon]);u.ammo[u.weapon]+=amount;u.reserve[u.weapon]-=amount;u.reloadUntil=0;}
 const w=weapons[u.weapon];if(input.fire&&!u.reloadUntil&&now>=u.nextShotAt){if(w.mag!==null&&u.ammo[u.weapon]<=0)continue;if(w.mag!==null)u.ammo[u.weapon]--;u.lastShot=now;const interval=60000/w.rpm;u.nextShotAt=u.nextShotAt>now-interval?u.nextShotAt+interval:now+interval;u.shots++;strike(s,u,w.damage,w.range,now,w.mag===null,w.head);event(s,'shot',{actor:u.id,weapon:u.weapon});}
 }
 for(const c of s.crates){if(!c.broken||c.taken)continue;for(const u of s.units){if(u.hp>0&&Math.hypot(u.x-c.x,u.z-c.z)<1.25&&Math.abs(u.y-c.y)<1.5){c.taken=true;if(c.loot==='life')u.lives++;else{const key=u.weapon==='knife'?u.primary:u.weapon;u.reserve[key]+=30;}event(s,'loot',{actor:u.id,loot:c.loot});break;}}}
 const world=getWorld();for(const g of s.grenades){g.vy-=15*dt;g.x+=g.vx*dt;g.y+=g.vy*dt;g.z+=g.vz*dt;const hit=world?.sphereIntersect(new Sphere(new Vector3(g.x,g.y,g.z),.12));if(hit){g.x+=hit.normal.x*(hit.depth+.001);g.y+=hit.normal.y*(hit.depth+.001);g.z+=hit.normal.z*(hit.depth+.001);const velocity=new Vector3(g.vx,g.vy,g.vz);velocity.addScaledVector(hit.normal,-1.45*velocity.dot(hit.normal));g.vx=velocity.x*.8;g.vy=velocity.y*.8;g.vz=velocity.z*.8;}
 if(now>=g.explodeAt){event(s,'explosion',{x:g.x,y:g.y,z:g.z});for(const v of s.units){const source=new Vector3(g.x,g.y+.15,g.z),delta=new Vector3(v.x,v.y+.8,v.z).sub(source),distance=delta.length();if(distance<4){const wall=world?.rayIntersect(new Ray(source,delta.normalize()));if(!wall||wall.distance>=distance-.2)hurt(s,v,Math.max(1,Math.round(100*(1-distance/4))),g.owner,now);}}}}
 s.grenades=s.grenades.filter(g=>now<g.explodeAt);
}
export function cleanInput(a){if(!Number.isSafeInteger(a.seq)||a.seq<0||a.seq>1e9||!Number.isFinite(a.yaw)||!Number.isFinite(a.pitch))throw Error('잘못된 입력입니다.');return {seq:a.seq,forward:Math.max(-1,Math.min(1,Number(a.forward)||0)),strafe:Math.max(-1,Math.min(1,Number(a.strafe)||0)),yaw:a.yaw%(Math.PI*2),pitch:Math.max(-1.48,Math.min(1.48,a.pitch)),jump:!!a.jump,sprint:!!a.sprint,fire:!!a.fire,scoped:!!a.scoped};}

export function makeCrates(random=Math.random){const candidates=[];const world=getWorld();for(let x=-10;x<=10;x+=2)for(let z=-6;z<=6;z+=2){if([spawnPoint(0),spawnPoint(1)].some(p=>Math.hypot(x-p.x,z-p.z)<2.5))continue;const hit=world?.rayIntersect(new Ray(new Vector3(x,8,z),new Vector3(0,-1,0)));if(world&&(!hit||hit.position.y>.4))continue;candidates.push({x,y:hit?.position.y||0,z});}for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}return candidates.slice(0,8).map((p,i)=>({id:i,...p,hp:55,broken:false,taken:false,loot:random()<.5?'ammo':'life'}));}
