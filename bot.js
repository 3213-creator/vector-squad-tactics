import {Vector3,Ray} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {STEP,EYE,look,shotOrigin,setDoors,setCrates,raycastWorld} from './physics.js';
import {action} from './game.js';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const approach=(from,to,amount)=>from+Math.max(-amount,Math.min(amount,wrap(to-from)));
export function buildNavigation(world){
 const step=.65,nodes=[],byGrid=new Map();
 function clear(x,y,z){return !world.capsuleIntersect(new Capsule(new Vector3(x,y+.36,z),new Vector3(x,y+1.45,z),.3));}
 for(let gx=0;gx<=35;gx++)for(let gz=0;gz<=22;gz++){
 const x=-11.4+gx*step,z=-7.4+gz*step,hit=world.rayIntersect(new Ray(new Vector3(x,.35,z),new Vector3(0,-1,0)));
 if(!hit||hit.distance>.6||hit.position.y>.15||!clear(x,hit.position.y,z))continue;
 const node={id:nodes.length,gx,gz,x,y:hit.position.y,z,neighbors:[]};nodes.push(node);byGrid.set(`${gx},${gz}`,node);
 }
 for(const node of nodes)for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const next=byGrid.get(`${node.gx+dx},${node.gz+dz}`);if(!next||Math.abs(next.y-node.y)>.12)continue;let pass=true;for(const t of [.25,.5,.75])if(!clear(node.x+(next.x-node.x)*t,node.y+(next.y-node.y)*t,node.z+(next.z-node.z)*t)){pass=false;break;}if(pass)node.neighbors.push(next.id);}
 return nodes;
}
export function createBrain(random=Math.random){return {random,route:[],thinkAt:0,planAt:0,visible:false,noticeAt:0,seenAt:0,lastSeen:null,aimYaw:Math.PI/2,aimPitch:0,forward:0,strafe:0,stuckAt:0,lastPosition:null,patrolGoal:null};}
function blocked(node,crates){return crates.some(c=>!c.broken&&Math.abs(node.x-c.x)<.76&&Math.abs(node.z-c.z)<.76);}
function nearest(nodes,x,z,crates){let best=null,distance=Infinity;for(const n of nodes){const d=(x-n.x)**2+(z-n.z)**2;if(d<distance&&!blocked(n,crates)){best=n;distance=d;}}return best;}
function routeTo(nodes,start,end,crates){if(!start||!end)return [];const queue=[start.id],parent=new Map([[start.id,null]]);for(let i=0;i<queue.length;i++){const id=queue[i];if(id===end.id)break;for(const other of nodes[id].neighbors){if(parent.has(other)||blocked(nodes[other],crates))continue;parent.set(other,id);queue.push(other);}}if(!parent.has(end.id))return [];const route=[];for(let id=end.id;id!==start.id;id=parent.get(id))route.unshift(nodes[id]);return route;}
function sees(s,bot,target){if(target.hp<=0)return false;const origin=new Vector3(bot.x,bot.y+EYE,bot.z),delta=new Vector3(target.x,target.y+1,target.z).sub(origin),distance=delta.length();if(distance>20||distance<.001)return false;const direction=delta.clone().normalize();if(direction.dot(look(bot.yaw,bot.pitch))<.35)return false;const hit=raycastWorld(new Ray(origin,direction));return !hit||hit.distance>distance-.3;}
export function botInput(s,brain,navigation,now=Date.now()){
 const bot=s.units[1],target=s.units[0];setDoors(s.doors);setCrates(s.crates);
 if(bot.hp<=0||s.winner!==null)return {yaw:bot.yaw,pitch:bot.pitch};
 if(bot.ammo[bot.weapon]===0&&!bot.reloadUntil){if(bot.reserve[bot.weapon]>0)action(s,1,{type:'reload'},now);else if(bot.weapon!=='pistol'&&bot.ammo.pistol+bot.reserve.pistol>0)action(s,1,{type:'equip',weapon:'pistol'},now);}
 if(now>=brain.thinkAt){
 brain.thinkAt=now+120;const visible=sees(s,bot,target);if(visible){if(!brain.visible)brain.noticeAt=now+450;brain.lastSeen={x:target.x,y:target.y,z:target.z};brain.seenAt=now;}brain.visible=visible;
 if(visible){const origin=shotOrigin(bot),delta=new Vector3(target.x,target.y+1,target.z).sub(origin);brain.aimYaw=Math.atan2(-delta.x,-delta.z)+Math.sin(now*.0021)*.035;brain.aimPitch=Math.atan2(delta.y,Math.hypot(delta.x,delta.z))+Math.sin(now*.0017)*.018;const d=delta.length();brain.forward=d<3?-.25:0;brain.strafe=Math.sin(now*.0015)>.2?.28:-.28;}
 else{
 const distanceMoved=brain.lastPosition?Math.hypot(bot.x-brain.lastPosition.x,bot.z-brain.lastPosition.z):1;if(distanceMoved<.035&&brain.forward>0){if(!brain.stuckAt)brain.stuckAt=now;}else brain.stuckAt=0;brain.lastPosition={x:bot.x,z:bot.z};
 while(brain.route.length&&Math.hypot(bot.x-brain.route[0].x,bot.z-brain.route[0].z)<.25)brain.route.shift();
 if(now>=brain.planAt||!brain.route.length||(brain.stuckAt&&now-brain.stuckAt>900)){
 const start=nearest(navigation,bot.x,bot.z,s.crates);let destination=null;if(brain.lastSeen&&now-brain.seenAt<3500)destination=nearest(navigation,brain.lastSeen.x,brain.lastSeen.z,s.crates);
 if(!destination||destination===start){for(let attempt=0;attempt<16;attempt++){const candidate=navigation[Math.floor(brain.random()*navigation.length)];if(candidate&&!blocked(candidate,s.crates)&&Math.hypot(candidate.x-bot.x,candidate.z-bot.z)>3){const path=routeTo(navigation,start,candidate,s.crates);if(path.length){destination=candidate;break;}}}}
 brain.route=routeTo(navigation,start,destination,s.crates);brain.planAt=now+2500;brain.stuckAt=0;
 }
 const next=brain.route[0];brain.forward=next ? .85 : 0;brain.strafe=0;if(next)brain.aimYaw=Math.atan2(-(next.x-bot.x),-(next.z-bot.z));else brain.aimYaw=bot.yaw+.4;brain.aimPitch=0;
 }
 }
 const yaw=approach(bot.yaw,brain.aimYaw,3.2*STEP),pitch=bot.pitch+Math.max(-2*STEP,Math.min(2*STEP,brain.aimPitch-bot.pitch)),aligned=Math.abs(wrap(brain.aimYaw-yaw))<.11;
 const fire=brain.visible&&target.hp>0&&now>=target.shieldUntil&&now>=bot.shieldUntil&&now>=brain.noticeAt&&aligned&&(now%1050)<550&&!bot.reloadUntil;
 return {yaw,pitch,forward:Math.abs(wrap(brain.aimYaw-yaw))<.65?brain.forward:0,strafe:brain.strafe,fire,jump:!!(brain.stuckAt&&now-brain.stuckAt>650&&bot.grounded)};
}
