import {Vector3,Ray} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {moveBody,bodyHeight,setCrates,setDoors,raycastWorld} from './physics.js';
import {ladders} from './environment.js';

export const ZOMBIE_TOTAL=100;
let navigation=[];
const brains=new WeakMap();
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function createHorde(){return {total:ZOMBIE_TOTAL,spawned:0,killed:0,nextSpawnAt:0,intervalMs:10000};}
export function beginHorde(s,now){s.zombies=[];s.horde=createHorde();s.horde.nextSpawnAt=now;brains.set(s,{agents:new Map(),flow:null,flowAt:0,goal:-1});}
export function buildHordeNavigation(world){
 const step=.65,nodes=[],grid=new Map();
 const clear=(x,y,z)=>{const hit=world.capsuleIntersect(new Capsule(new Vector3(x,y+.29,z),new Vector3(x,y+1.46,z),.27));return !hit||hit.depth<.012;};
 for(let gx=0;gx<=35;gx++)for(let gz=0;gz<=22;gz++){
  const x=-11.4+gx*step,z=-7.4+gz*step,layers=[];
  for(const height of [.45,4.8]){
   const hit=world.rayIntersect(new Ray(new Vector3(x,height,z),new Vector3(0,-1,0)));
   if(!hit||hit.position.y<-.2||hit.position.y>3.5||layers.some(n=>Math.abs(n.y-hit.position.y)<.25)||!clear(x,hit.position.y,z))continue;
   const node={id:nodes.length,gx,gz,x,y:hit.position.y,z,neighbors:[]};nodes.push(node);layers.push(node);
  }
  grid.set(`${gx},${gz}`,layers);
 }
 for(const node of nodes)for(const [dx,dz]of [[1,0],[0,1],[-1,0],[0,-1]])for(const next of grid.get(`${node.gx+dx},${node.gz+dz}`)||[]){
  if(Math.abs(next.y-node.y)>.3)continue;
  if([.3,.6].every(t=>clear(node.x+(next.x-node.x)*t,node.y+(next.y-node.y)*t,node.z+(next.z-node.z)*t)))node.neighbors.push({id:next.id});
 }
 navigation=nodes;
 for(const l of ladders){
  const lower=nearestNode({x:l.attachX,y:l.bottom,z:l.attachZ}),upper=nearestNode({x:l.exitX,y:l.top,z:l.exitZ});
  if(lower&&upper&&Math.abs(lower.y-upper.y)>1){lower.neighbors.push({id:upper.id,ladder:l.id,direction:1});upper.neighbors.push({id:lower.id,ladder:l.id,direction:-1});}
 }
 return nodes;
}
function nearestNode(point){let best=null,distance=Infinity;for(const n of navigation){const d=(n.x-point.x)**2+(n.z-point.z)**2+(n.y-point.y)**2*5;if(d<distance){distance=d;best=n;}}return best;}
function crateBlocks(n,crates){return crates.some(c=>!c.broken&&n.y<c.y+.8&&n.y+1.7>c.y&&Math.abs(n.x-c.x)<.65&&Math.abs(n.z-c.z)<.65);}
function refreshFlow(s,brain,player,now){
 if(now<brain.flowAt)return;brain.flowAt=now+300;
 const goal=nearestNode(player);if(!goal)return;
 const flow=new Int16Array(navigation.length);flow.fill(-1);const queue=[goal.id];flow[goal.id]=0;
 for(let i=0;i<queue.length;i++){const node=navigation[queue[i]];for(const edge of node.neighbors){if(flow[edge.id]>=0||crateBlocks(navigation[edge.id],s.crates))continue;flow[edge.id]=flow[node.id]+1;queue.push(edge.id);}}
 brain.flow=flow;brain.goal=goal.id;
}
function newZombie(s,now,random){
 const n=s.horde.spawned,angle=random()*Math.PI*2,radius=random()*.6;
 const zombie={id:n+2,isZombie:true,kind:random()<.5?0:1,gait:random()<.5?'walk':'run',x:7.5+Math.cos(angle)*radius,y:.15,z:.5+Math.sin(angle)*radius,yaw:Math.PI/2,pitch:0,vx:0,vy:0,vz:0,grounded:false,ladder:null,crouching:false,hp:100,lives:1,armor:0,shieldUntil:0,weapon:'knife',lastAttack:0,diedAt:0,spawnedAt:now};
 s.zombies.push(zombie);s.horde.spawned++;s.horde.intervalMs=Math.max(800,Math.round(10000*.96**Math.max(0,n)));s.horde.nextSpawnAt=now+s.horde.intervalMs;return zombie;
}
function visibleToPlayer(z,player){
 const from=new Vector3(z.x,z.y+1.15,z.z),delta=new Vector3(player.x,player.y+bodyHeight(player)*.55,player.z).sub(from),distance=delta.length();
 if(distance<.001)return true;const hit=raycastWorld(new Ray(from,delta.normalize()));return !hit||hit.distance>=distance-.2;
}
export function hurtZombie(s,z,damage,attacker,now,emit){
 if(z.hp<=0||s.phase!=='battle'||s.winner!==null)return;
 z.hp=Math.max(0,z.hp-damage);emit('hit',{actor:attacker,target:z.id,damage});
 if(z.hp===0){z.diedAt=now;z.vx=z.vy=z.vz=0;z.ladder=null;s.horde.killed++;s.scores[1].deaths++;if(attacker===0)s.scores[0].kills++;emit('death',{actor:attacker,target:z.id});}
}
export function advanceHorde(s,now,dt,hurtPlayer,emit,random=Math.random){
 if(s.phase!=='battle'||s.mode!=='zombie'||s.winner!==null)return;
 let brain=brains.get(s);if(!brain){brain={agents:new Map(),flow:null,flowAt:0,goal:-1};brains.set(s,brain);}
 if(s.horde.spawned<s.horde.total&&now>=s.horde.nextSpawnAt)newZombie(s,now,random);
 const player=s.units[0];setCrates(s.crates);setDoors(s.doors);refreshFlow(s,brain,player,now);
 const bins=new Map();for(const z of s.zombies){if(z.hp<=0)continue;const key=`${Math.floor(z.x)},${Math.floor(z.z)}`,bin=bins.get(key)||[];bin.push(z);bins.set(key,bin);}
 for(const z of s.zombies){
  if(z.hp<=0)continue;
  let a=brain.agents.get(z.id);if(!a){a={gaitAt:now+3000+random()*4000,nodeAt:0,node:null,edge:null,climb:1};brain.agents.set(z.id,a);}
  if(now>=a.gaitAt){z.gait=random()<.5?'walk':'run';a.gaitAt=now+3000+random()*5000;}
  if(z.ladder!==null){
   const l=ladders.find(l=>l.id===z.ladder);moveBody(z,{yaw:l?.yaw??z.yaw,pitch:0,forward:a.climb},dt);a.nodeAt=0;
  }else{
   if(now>=a.nodeAt){
    a.nodeAt=now+200+(z.id%5)*15;a.node=nearestNode(z);a.edge=null;
    if(a.node&&brain.flow){const choices=a.node.neighbors.filter(e=>brain.flow[e.id]>=0&&brain.flow[e.id]<brain.flow[a.node.id]);if(choices.length)a.edge=choices[z.id%choices.length];}
   }
   let goal=player,interact=false;
   if(a.edge){
    goal=navigation[a.edge.id];
    if(a.edge.ladder!==undefined){
     const l=ladders.find(l=>l.id===a.edge.ladder);a.climb=a.edge.direction;
     goal={x:l.attachX,z:a.climb>0?l.attachZ:l.z+(l.exitZ-l.attachZ)*.1};
     if(Math.hypot(z.x-l.attachX,z.z-l.attachZ)<1&&Math.abs(z.y-(a.climb>0?l.bottom:l.top))<.4)interact=true;
    }
   }
   let dx=goal.x-z.x,dz=goal.z-z.z,distance=Math.hypot(dx,dz),speed=z.gait==='run'?3.25:1.45;
   if(a.node&&brain.flow&&brain.flow[a.node.id]<0){dx=player.x-z.x;dz=player.z-z.z;distance=Math.hypot(dx,dz);}
   if(distance>.001){dx/=distance;dz/=distance;}
   let separateX=0,separateZ=0;
   for(let gx=Math.floor(z.x)-1;gx<=Math.floor(z.x)+1;gx++)for(let gz=Math.floor(z.z)-1;gz<=Math.floor(z.z)+1;gz++)for(const other of bins.get(`${gx},${gz}`)||[]){
    if(other===z||Math.abs(other.y-z.y)>1)continue;const x=z.x-other.x,zz=z.z-other.z,d=Math.hypot(x,zz);if(d>.001&&d<.55){separateX+=x/d*(.55-d);separateZ+=zz/d*(.55-d);}
   }
   const nearPlayer=Math.hypot(player.x-z.x,player.z-z.z)<.95&&Math.abs(player.y-z.y)<1;
   if(!nearPlayer){dx+=separateX*1.5;dz+=separateZ*1.5;}
   const desired=Math.atan2(-dx,-dz);z.yaw+=Math.max(-dt*5,Math.min(dt*5,wrap(desired-z.yaw)));
   const input={yaw:z.yaw,pitch:0,forward:nearPlayer?0:speed/3.8,interact};
   if(interact)input.forward=a.climb;
   moveBody(z,input,dt);
  }
  if(z.y< -5){hurtZombie(s,z,1000,1,now,emit);continue;}
  const close=Math.hypot(player.x-z.x,player.z-z.z)<1.2&&Math.abs(player.y-z.y)<1.1;
  if(close&&player.hp>0&&now-z.lastAttack>=1000&&visibleToPlayer(z,player)){z.lastAttack=now;hurtPlayer(player,20,1,now);}
  else if(now-z.lastAttack>=850){const crate=s.crates.find(c=>!c.broken&&Math.hypot(z.x-c.x,z.z-c.z)<1.05&&Math.abs(z.y-c.y)<1);if(crate){z.lastAttack=now;crate.hp-=20;if(crate.hp<=0){crate.broken=true;emit('crate',{x:crate.x,y:crate.y,z:crate.z});brain.flowAt=0;}}}
  if(s.winner!==null)break;
 }
 s.zombies=s.zombies.filter(z=>z.hp>0||now-z.diedAt<2400);
 for(const id of brain.agents.keys())if(!s.zombies.some(z=>z.id===id))brain.agents.delete(id);
}
export function packZombies(zombies){return zombies.map(z=>({id:z.id,kind:z.kind,gait:z.gait,hp:z.hp,x:+z.x.toFixed(3),y:+z.y.toFixed(3),z:+z.z.toFixed(3),yaw:+z.yaw.toFixed(3),vx:+z.vx.toFixed(2),vz:+z.vz.toFixed(2),ladder:z.ladder,lastAttack:z.lastAttack,diedAt:z.diedAt,spawnedAt:z.spawnedAt}));}
