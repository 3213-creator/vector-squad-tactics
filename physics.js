import {ladders,nearLadder,toggleLadder} from './environment.js';
import {Vector3,Ray,Box3} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
export const STEP=1/30,EYE=1.5,HEIGHT=1.75,RADIUS=.28;
let world=null,crates=[],doors=[];
export function setWorld(value){world=value;}
export function setDoors(value){doors=value||[];}
export function doorBox(d){return new Box3(new Vector3(d.x-(d.axis==='z'?d.width/2:.055),0,d.z-(d.axis==='x'?d.width/2:.055)),new Vector3(d.x+(d.axis==='z'?d.width/2:.055),d.height,d.z+(d.axis==='x'?d.width/2:.055)));}
export function raycastWorld(ray){let hit=world?.rayIntersect(ray);for(const d of doors){if(d.open)continue;const point=ray.intersectBox(doorBox(d),new Vector3());if(point){const distance=ray.origin.distanceTo(point);if(!hit||distance<hit.distance)hit={position:point,distance,dynamic:true};}}return hit;}
export function setCrates(value){crates=value||[];}
export function getWorld(){return world;}
export function look(yaw,pitch){return new Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));}
export function moveBody(u,input={},dt=STEP){
 if(u.hp<=0)return;
 if(input.interact)toggleLadder(u);
 if(u.ladder!==null&&u.ladder!==undefined){const l=ladders.find(l=>l.id===u.ladder);if(l){if(input.jump){u.ladder=null;u.vy=6;}else{u.yaw=Number.isFinite(input.yaw)?input.yaw:u.yaw;u.pitch=Number.isFinite(input.pitch)?input.pitch:u.pitch;u.x=l.attachX;u.z=l.attachZ;u.vx=u.vz=0;u.vy=(input.forward||0)*2;u.y+=u.vy*dt;u.grounded=false;if(u.y>=l.top&&u.vy>0){u.x=l.exitX;u.z=l.exitZ;u.y=l.top+.025;u.ladder=null;u.grounded=true;u.vy=0;}else if(u.y<=l.bottom&&u.vy<0){u.y=l.bottom+.025;u.ladder=null;u.vy=0;u.grounded=true;}return;}}else u.ladder=null;}

 const yaw=Number.isFinite(input.yaw)?input.yaw:u.yaw;u.yaw=yaw;u.pitch=Number.isFinite(input.pitch)?input.pitch:u.pitch;
 let f=input.forward||0,r=input.strafe||0;const len=Math.hypot(f,r);if(len>1){f/=len;r/=len;}
 if(input.forward>0){for(const d of doors){if(d.open||u.y>.4)continue;const dx=d.x-u.x,dz=d.z-u.z,dist=Math.hypot(dx,dz),lateral=d.axis==='z'?Math.abs(dx):Math.abs(dz);if(dist<1.5&&lateral<d.width/2+.25&&(-Math.sin(yaw)*dx-Math.cos(yaw)*dz)/Math.max(dist,.01)>.3)d.open=true;}}
 const speed=input.sprint?5.8:3.8;u.vx=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*speed;u.vz=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*speed;
 if(input.jump&&u.grounded){u.vy=7;u.grounded=false;}u.vy-=22*dt;
 const capsule=new Capsule(new Vector3(u.x,u.y+RADIUS,u.z),new Vector3(u.x,u.y+HEIGHT-RADIUS,u.z),RADIUS);
 capsule.translate(new Vector3(u.vx*dt,u.vy*dt,u.vz*dt));u.grounded=false;
 if(world){for(let i=0;i<4;i++){const hit=world.capsuleIntersect(capsule);if(!hit)break;capsule.translate(hit.normal.clone().multiplyScalar(hit.depth+.00001));if(hit.normal.y>.45){u.grounded=true;if(u.vy<0)u.vy=0;}else{const vel=new Vector3(u.vx,u.vy,u.vz);vel.addScaledVector(hit.normal,-Math.min(0,vel.dot(hit.normal)));u.vx=vel.x;u.vy=vel.y;u.vz=vel.z;}}}
 if(world&&u.vy<=0){const foot=capsule.start.y-RADIUS,ground=world.rayIntersect(new Ray(new Vector3(capsule.start.x,foot+.15,capsule.start.z),new Vector3(0,-1,0)));if(ground&&ground.distance<=.21){capsule.translate(new Vector3(0,ground.position.y-foot,0));u.grounded=true;u.vy=0;}}
 for(const c of [...crates,...doors.filter(d=>!d.open).map(d=>({...d,y:0,halfX:d.axis==='z'?d.width/2:.055,halfZ:d.axis==='x'?d.width/2:.055}))]){if(c.broken)continue;const halfX=c.halfX??.4,halfZ=c.halfZ??.4,height=c.height??.75;const foot=capsule.start.y-RADIUS,top=c.y+height;if(foot>=top-.14&&u.vy<=0){const x=capsule.start.x,z=capsule.start.z;if(Math.abs(x-c.x)<halfX+RADIUS&&Math.abs(z-c.z)<halfZ+RADIUS&&foot<=top){capsule.translate(new Vector3(0,top-foot,0));u.grounded=true;u.vy=0;}continue;}if(foot+HEIGHT<c.y||foot>top)continue;const x=capsule.start.x,z=capsule.start.z,nx=Math.max(c.x-halfX,Math.min(c.x+halfX,x)),nz=Math.max(c.z-halfZ,Math.min(c.z+halfZ,z));let dx=x-nx,dz=z-nz,d=Math.hypot(dx,dz);if(d<RADIUS){if(d<.0001){if(Math.abs(x-c.x)>Math.abs(z-c.z))dx=x>=c.x?1:-1;else dz=z>=c.z?1:-1;d=1;capsule.translate(new Vector3(dx*(RADIUS+halfX),0,dz*(RADIUS+halfZ)));}else capsule.translate(new Vector3(dx/d*(RADIUS-d+.0001),0,dz/d*(RADIUS-d+.0001)));}}
 u.x=Math.max(-12,Math.min(12,capsule.start.x));u.y=capsule.start.y-RADIUS;u.z=Math.max(-8,Math.min(8,capsule.start.z));
}

export function shotOrigin(u){const direction=look(u.yaw,u.pitch),eye=new Vector3(u.x,u.y+EYE,u.z);if((u.scoped&&u.weapon==='sniper')||u.weapon==='knife')return eye;const right=new Vector3(Math.cos(u.yaw),0,-Math.sin(u.yaw)),up=new Vector3().crossVectors(right,direction).normalize();const scale=u.weapon==='pistol'?.7:1;return eye.addScaledVector(right,.25*scale).addScaledVector(up,-.25*scale).addScaledVector(direction,u.weapon==='sniper'?1.18:u.weapon==='pistol'?.65:.93);}
