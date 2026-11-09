import {doors as doorTemplates} from './environment.js';
import {Vector3,Ray,Sphere,Box3} from 'three';
import {moveBody,look,EYE,STEP,getWorld,setCrates,shotOrigin,setDoors,raycastWorld,shotDirection} from './physics.js';
import {weapons,isPrimary,isSidearm,canAim} from './weapons.js';
export {weapons} from './weapons.js';
export function spawnPoint(id){return {x:id?7.5:-7.5,y:.15,z:.5,yaw:id?Math.PI/2:-Math.PI/2,pitch:0};}
function body(id){return {id,...spawnPoint(id),vx:0,vy:0,vz:0,grounded:false,ladder:null,hp:100,lives:3,diedAt:0,weapon:'rifle',primary:'rifle',secondary:'pistol',ammo:Object.fromEntries(Object.entries(weapons).filter(([,w])=>w.mag!==null).map(([key,w])=>[key,w.mag])),reserve:Object.fromEntries(Object.entries(weapons).filter(([,w])=>w.mag!==null).map(([key,w])=>[key,w.mag*3])),grenades:2,throwAt:0,throwUntil:0,lastShot:0,nextShotAt:0,stepDistance:0,lastMelee:0,reloadUntil:0,respawnAt:0,shieldUntil:0,coins:300,armor:0,damageBoost:1,thermalUntil:0,pendingUpgrades:{damage:false,shield:false,reveal:false},ack:0,shots:0};}
export function initial(mode='pvp'){return {phase:'lobby',mode,players:[null,null],winner:null,scores:[{kills:0,deaths:0},{kills:0,deaths:0}],resultsConfirmed:[false,false],introReady:[false,false],introStartedAt:0,battleStartsAt:0,units:[body(0),body(1)],grenades:[],crates:[],doors:doorTemplates.map(d=>({...d,open:false})),impacts:[],impactSeq:0,events:[],clock:0,lastEvent:'1 대 1 FPS 준비'};}
export function returnToLobby(old){const next=initial(old.mode);next.players=old.players.map(p=>p?{...p,ready:!!p.isBot}:null);next.units.forEach((u,i)=>{u.weapon=old.units[i].weapon;u.primary=old.units[i].primary;u.secondary=old.units[i].secondary;});return next;}
function event(s,type,data={}){s.events.push({id:++s.clock,type,...data});if(s.events.length>16)s.events.shift();}
export function action(s,id,a,now=Date.now()){
 setDoors(s.doors);const u=s.units[id],player=s.players[id];if(!player)throw Error('먼저 방에 참가하세요.');if(s.phase==='results')return;
 if(a.type==='introReady'){
  if(s.phase!=='intro'||now-s.introStartedAt<5000)return;
  s.introReady[id]=true;
  if(s.players.every((p,i)=>p&&(p.isBot||s.introReady[i]))){s.phase='countdown';s.battleStartsAt=now+3000;event(s,'countdown');}
  return;
 }
 if(s.phase==='intro'||s.phase==='countdown')return;
 if(a.type==='profile'){if(s.phase!=='lobby'||typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name))throw Error('로비에서 이름을 1~12자로 입력하세요.');player.name=a.name.trim();return;}
 if(a.type==='ready'){if(s.phase!=='lobby')return;player.ready=!player.ready;if(s.players.every(p=>p?.ready)){s.phase='intro';s.introStartedAt=now;s.battleStartsAt=0;s.introReady=s.players.map(p=>!!p?.isBot);s.crates=makeCrates();s.units.forEach(u=>{u.weapon=u.primary;u.vx=u.vy=u.vz=0;u.scoped=false;u.shieldUntil=0;});event(s,'intro');}return;}
 if(a.type==='equip'){
 if(!Object.hasOwn(weapons,a.weapon))throw Error('잘못된 무기입니다.');if(s.phase==='battle'&&(u.hp<=0||s.winner!==null||u.throwUntil>now))return;
 u.weapon=a.weapon;if(isPrimary(a.weapon))u.primary=a.weapon;if(isSidearm(a.weapon))u.secondary=a.weapon;u.reloadUntil=0;if(s.phase==='lobby')player.ready=false;return;
 }
 if(a.type==='buy'){
 if(s.phase!=='battle'||s.winner!==null||u.hp>0||u.lives<=0||!u.respawnAt)throw Error('부활 대기 중에만 구매할 수 있습니다.');
 if(!['damage','shield','reveal'].includes(a.item))throw Error('잘못된 보급품입니다.');if(u.pendingUpgrades[a.item])throw Error('이미 구매했습니다.');if(u.coins<50)throw Error('코인이 부족합니다.');u.coins-=50;u.pendingUpgrades[a.item]=true;event(s,'purchase',{actor:id,item:a.item});return;
 }
 if(s.phase!=='battle'||s.winner!==null||u.hp<=0)return;
 if((u.ladder!==null||u.throwUntil>now)&&['reload','melee','grenade'].includes(a.type))return;
 if(a.type==='reload'){beginReload(s,u,now);return;}
 if(a.type==='melee'){if(now-u.lastMelee<800||u.reloadUntil)return;u.lastMelee=now;strike(s,u,40,2.1,now,true,100);event(s,'melee',{actor:id});return;}
 if(a.type==='grenade'){if(u.grenades<=0||s.grenades.length>=8)return;u.grenades--;u.reloadUntil=0;u.scoped=false;u.throwAt=now+300;u.throwUntil=now+650;event(s,'grenadeWindup',{actor:id,x:u.x,y:u.y+EYE,z:u.z});return;}
}
function beginReload(s,u,now){const w=weapons[u.weapon];if(w.mag!==null&&!u.reloadUntil&&!u.throwUntil&&u.ammo[u.weapon]<w.mag&&u.reserve[u.weapon]>0){u.reloadUntil=now+w.reload;u.scoped=false;event(s,'reload',{actor:u.id});}}
export function hurt(s,target,damage,attacker,now){
 if(s.phase!=='battle'||target.hp<=0||s.winner!==null||now<target.shieldUntil)return;
 const absorbed=Math.min(target.armor||0,damage);target.armor-=absorbed;damage-=absorbed;
 target.hp=Math.max(0,target.hp-damage);event(s,'hit',{actor:attacker,target:target.id,damage});
 if(target.hp===0){
  s.scores[target.id].deaths++;
  if(attacker!==target.id&&s.scores[attacker])s.scores[attacker].kills++;
  target.lives--;target.diedAt=now;target.reloadUntil=0;target.throwAt=target.throwUntil=0;
  target.respawnAt=target.lives>0?now+5000:0;event(s,'death',{actor:attacker,target:target.id});
  if(target.lives===0){
   s.winner=1-target.id;s.phase='results';s.resultsConfirmed=s.players.map(p=>!!p?.isBot);
   for(const p of s.players)if(p)p.ready=!!p.isBot;
   event(s,'victory',{actor:s.winner});
  }
 }
}
function strike(s,u,damage,range,now,melee=false,headDamage=damage){const origin=melee?new Vector3(u.x,u.y+EYE,u.z):shotOrigin(u),direction=melee?look(u.yaw,u.pitch):shotDirection(u,s.units),ray=new Ray(origin,direction),v=s.units[1-u.id];
 let distance=Infinity,headshot=false;const point=new Vector3();let crateDistance=Infinity,selectedCrate=null;
 for(const c of s.crates){if(c.broken)continue;let dist=Infinity;if(melee){const delta=new Vector3(c.x,c.y+.4,c.z).sub(origin);if(delta.length()<=range&&delta.clone().normalize().dot(direction)>.4)dist=delta.length();}else{const p=ray.intersectBox(new Box3(new Vector3(c.x-.4,c.y,c.z-.4),new Vector3(c.x+.4,c.y+.75,c.z+.4)),new Vector3());if(p)dist=origin.distanceTo(p);}if(dist<crateDistance){crateDistance=dist;selectedCrate=c;}}
 const cover=raycastWorld(ray);if(!melee){const eye=new Vector3(u.x,u.y+EYE,u.z),barrel=origin.clone().sub(eye),barrelLength=barrel.length(),obstruction=raycastWorld(new Ray(eye,barrel.normalize()));if(obstruction&&obstruction.distance<barrelLength)return obstruction;}if(melee&&selectedCrate&&crateDistance<=range&&(!cover||cover.distance>=crateDistance-.3)){selectedCrate.hp-=damage;if(selectedCrate.hp<=0){selectedCrate.broken=true;event(s,'crate',{x:selectedCrate.x,y:selectedCrate.y,z:selectedCrate.z});}return;}
 if(melee){const delta=new Vector3(v.x,v.y+.9,v.z).sub(origin);if(delta.length()<=range&&delta.normalize().dot(direction)>.4)distance=origin.distanceTo(new Vector3(v.x,v.y+.9,v.z));}else{for(const [height,radius] of [[.7,.34],[1.1,.34],[1.5,.25]]){const hit=ray.intersectSphere(new Sphere(new Vector3(v.x,v.y+height,v.z),radius),point);if(hit&&origin.distanceTo(hit)<distance){distance=origin.distanceTo(hit);headshot=height===1.5;}}}
 if(melee&&distance<=range){const head=ray.intersectSphere(new Sphere(new Vector3(v.x,v.y+1.5,v.z),.28),new Vector3());headshot=!!head&&origin.distanceTo(head)<=range;const fromVictim=new Vector3(u.x-v.x,0,u.z-v.z).normalize();if(fromVictim.dot(look(v.yaw,0))<-.5)headshot=true;}
 const wall=raycastWorld(ray);if(!melee&&selectedCrate&&crateDistance<=range&&(v.hp<=0||crateDistance<=distance)&&(!wall||wall.distance>=crateDistance-.001)){selectedCrate.hp-=damage;if(selectedCrate.hp<=0){selectedCrate.broken=true;event(s,'crate',{x:selectedCrate.x,y:selectedCrate.y,z:selectedCrate.z});}return;}if(v.hp>0&&distance<=range&&distance<crateDistance&&(!wall||wall.distance+0.03>=distance))hurt(s,v,headshot?headDamage:damage,u.id,now);else if(!melee&&wall&&!wall.dynamic&&wall.distance<=range&&wall.distance<=distance&&wall.distance<crateDistance)return wall;
}
export function tick(s,inputs,now=Date.now(),dt=STEP){
 if(s.phase==='countdown'&&now>=s.battleStartsAt){s.phase='battle';s.units.forEach(u=>{u.shieldUntil=now+3000;});event(s,'start');return;}
 if(s.phase!=='battle'||s.winner!==null)return;
 for(const u of s.units){if(u.hp<=0){if(u.respawnAt&&now>=u.respawnAt){const lives=u.lives,weapon=u.weapon,primary=u.primary,secondary=u.secondary,ack=u.ack,coins=u.coins,upgrades=u.pendingUpgrades;Object.assign(u,body(u.id),{lives,weapon,primary,secondary,ack,coins,damageBoost:upgrades.damage?1.1:1,armor:upgrades.shield?20:0,thermalUntil:upgrades.reveal?now+8000:0,shieldUntil:now+3000});event(s,'respawn',{target:u.id});}continue;}
 const input=inputs[u.id]||{};setCrates(s.crates);setDoors(s.doors);const oldX=u.x,oldZ=u.z;moveBody(u,input,dt);if(u.grounded&&u.ladder===null){u.stepDistance+=Math.hypot(u.x-oldX,u.z-oldZ);if(u.stepDistance>(input.sprint?1.7:1.35)){u.stepDistance=0;event(s,'footstep',{actor:u.id,x:u.x,y:u.y+.12,z:u.z});}}u.scoped=!!input.scoped&&canAim(u.weapon)&&!u.reloadUntil&&!u.throwUntil&&u.ladder===null;if(Number.isInteger(input.seq))u.ack=input.seq;if(u.y< -5){hurt(s,u,1000,u.id,now);continue;}
 if(u.throwAt&&now>=u.throwAt){const d=look(u.yaw,u.pitch);s.grenades.push({id:++s.clock,owner:u.id,x:u.x+d.x*.5,y:u.y+EYE,z:u.z+d.z*.5,vx:d.x*18,vy:d.y*18+5,vz:d.z*18,explodeAt:now+2200});u.throwAt=0;event(s,'grenadeThrow',{actor:u.id,x:u.x,y:u.y+EYE,z:u.z});}if(u.throwUntil&&now>=u.throwUntil)u.throwUntil=0;
 if(u.reloadUntil&&now>=u.reloadUntil){const amount=Math.min(weapons[u.weapon].mag-u.ammo[u.weapon],u.reserve[u.weapon]);u.ammo[u.weapon]+=amount;u.reserve[u.weapon]-=amount;u.reloadUntil=0;}
 const w=weapons[u.weapon];if(w.mag!==null&&u.ammo[u.weapon]===0)beginReload(s,u,now);if(input.fire&&!u.throwUntil&&u.ladder===null&&!u.reloadUntil&&now>=u.nextShotAt){if(w.mag!==null&&u.ammo[u.weapon]<=0)continue;if(w.mag!==null)u.ammo[u.weapon]--;u.lastShot=now;const interval=60000/w.rpm;u.nextShotAt=u.nextShotAt>now-interval?u.nextShotAt+interval:now+interval;if(w.mag!==null)u.shots++;const impact=strike(s,u,w.mag===null?w.damage:Math.round(w.damage*u.damageBoost),w.range,now,w.mag===null,w.mag===null?w.head:Math.round(w.head*u.damageBoost));if(w.mag!==null&&impact&&!impact.dynamic&&impact.normal){s.impacts.push({id:++s.impactSeq,p:impact.position.toArray().map(v=>+v.toFixed(3)),n:impact.normal.toArray().map(v=>+v.toFixed(4))});if(s.impacts.length>48)s.impacts.shift();}event(s,w.mag===null?'melee':'shot',{actor:u.id,weapon:u.weapon,x:u.x,y:u.y+EYE,z:u.z});if(w.mag!==null&&u.ammo[u.weapon]===0)beginReload(s,u,now);}
 }
 for(const c of s.crates){if(!c.broken||c.taken)continue;for(const u of s.units){if(u.hp>0&&Math.hypot(u.x-c.x,u.z-c.z)<1.25&&Math.abs(u.y-c.y)<1.5){c.taken=true;if(c.loot==='life')u.lives++;else{const key=u.weapon==='knife'?u.primary:u.weapon;u.reserve[key]+=30;}event(s,'loot',{actor:u.id,loot:c.loot});break;}}}
 const world=getWorld();for(const g of s.grenades){g.vy-=15*dt;g.x+=g.vx*dt;g.y+=g.vy*dt;g.z+=g.vz*dt;const hit=world?.sphereIntersect(new Sphere(new Vector3(g.x,g.y,g.z),.12));if(hit){g.x+=hit.normal.x*(hit.depth+.001);g.y+=hit.normal.y*(hit.depth+.001);g.z+=hit.normal.z*(hit.depth+.001);const velocity=new Vector3(g.vx,g.vy,g.vz);velocity.addScaledVector(hit.normal,-1.45*velocity.dot(hit.normal));g.vx=velocity.x*.8;g.vy=velocity.y*.8;g.vz=velocity.z*.8;}
 if(now>=g.explodeAt){event(s,'explosion',{x:g.x,y:g.y,z:g.z});for(const v of s.units){const source=new Vector3(g.x,g.y+.15,g.z),delta=new Vector3(v.x,v.y+.8,v.z).sub(source),distance=delta.length();if(distance<4){const wall=world?.rayIntersect(new Ray(source,delta.normalize()));if(!wall||wall.distance>=distance-.2)hurt(s,v,Math.max(1,Math.round(100*(1-distance/4))),g.owner,now);}}}}
 s.grenades=s.grenades.filter(g=>now<g.explodeAt);
}
export function cleanInput(a){if(!Number.isSafeInteger(a.seq)||a.seq<0||a.seq>1e9||!Number.isFinite(a.yaw)||!Number.isFinite(a.pitch))throw Error('잘못된 입력입니다.');return {seq:a.seq,forward:Math.max(-1,Math.min(1,Number(a.forward)||0)),strafe:Math.max(-1,Math.min(1,Number(a.strafe)||0)),yaw:a.yaw%(Math.PI*2),pitch:Math.max(-1.48,Math.min(1.48,a.pitch)),jump:!!a.jump,sprint:!!a.sprint,fire:!!a.fire,interact:!!a.interact,scoped:!!a.scoped};}

export function makeCrates(random=Math.random){const candidates=[];const world=getWorld();for(let x=-10;x<=10;x+=2)for(let z=-6;z<=6;z+=2){if([spawnPoint(0),spawnPoint(1)].some(p=>Math.hypot(x-p.x,z-p.z)<2.5))continue;const hit=world?.rayIntersect(new Ray(new Vector3(x,8,z),new Vector3(0,-1,0)));if(world&&(!hit||hit.position.y>.4))continue;candidates.push({x,y:hit?.position.y||0,z});}for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}return candidates.slice(0,8).map((p,i)=>({id:i,...p,hp:55,broken:false,taken:false,loot:random()<.5?'ammo':'life'}));}

export function configureMode(s,mode){if(s.phase!=='lobby')throw Error('로비에서 모드를 변경하세요.');if(!['ai','pvp'].includes(mode))throw Error('잘못된 모드입니다.');const humans=s.players.filter(p=>p&&!p.isBot).length;if(mode==='ai'&&humans>1)throw Error('AI 모드는 혼자 접속했을 때 이용할 수 있습니다.');s.mode=mode;if(mode==='ai')s.players[1]={name:'AI SENTINEL',isBot:true,ready:true};else if(s.players[1]?.isBot)s.players[1]=null;for(const p of s.players)if(p&&!p.isBot)p.ready=false;return s;}
