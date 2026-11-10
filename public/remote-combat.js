import * as THREE from 'three';
import {weapons,isSidearm} from '../weapons.js';
import {createWeaponModel,createHeldGrenade,createMuzzleFlash,updateMuzzleFlash} from './weapon-model.js';
import {EYE,CROUCH_EYE} from '/physics.js';
const clamp=THREE.MathUtils.clamp;
function box(parent,w,h,d,x,y,z,color){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color}));m.position.set(x,y,z);parent.add(m);return m;}
function dispose(group){group.traverse(o=>{if(!o.isSprite)o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});group.removeFromParent();}
export function resetRemoteCombatPose(actor){const c=actor.combat;if(c?.basePose){for(const [name,q]of c.basePose)c.bones[name]?.quaternion.copy(q);c.basePose=null;}}
export function disposeRemoteCombat(actor){resetRemoteCombatPose(actor);if(actor.combat){dispose(actor.combat.pivot);dispose(actor.combat.heldGrenade);actor.combat=null;}}
function rotateWorld(bone,q){const world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(q),parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();bone.quaternion.copy(parent.multiply(world));bone.updateMatrixWorld(true);}
function aimBone(bone,child,target){const p=bone.getWorldPosition(new THREE.Vector3()),direction=child.getWorldPosition(new THREE.Vector3()).sub(p).normalize(),desired=target.clone().sub(p).normalize();rotateWorld(bone,new THREE.Quaternion().setFromUnitVectors(direction,desired));}
// Two-bone IK keeps hands on the held weapon while locomotion clips drive the legs.
function solveArm(upper,lower,wrist,target,pole){if(!upper||!lower||!wrist)return;const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=wrist.getWorldPosition(new THREE.Vector3()),l1=a.distanceTo(b),l2=b.distanceTo(c);if(l1<.001||l2<.001)return;
 const direction=target.clone().sub(a),distance=clamp(direction.length(),Math.abs(l1-l2)+.001,l1+l2-.001);direction.normalize();const bend=pole.clone().sub(a);bend.addScaledVector(direction,-bend.dot(direction));if(bend.lengthSq()<.00001)bend.set(0,-1,0);bend.normalize();const cosine=clamp((l1*l1+distance*distance-l2*l2)/(2*l1*distance),-1,1),elbow=a.clone().addScaledVector(direction,l1*cosine).addScaledVector(bend,l1*Math.sqrt(1-cosine*cosine));aimBone(upper,lower,elbow);aimBone(lower,wrist,a.clone().addScaledVector(direction,distance));
}
export function resetRemoteStancePose(actor){
 const stance=actor.stance;if(!stance?.applied)return;
 for(const saved of stance.saved){saved.bone.position.copy(saved.position);saved.bone.quaternion.copy(saved.quaternion);}stance.applied=false;
}
export function updateRemoteStance(actor,u,dt){
 if(!actor.stance){
  const bone=name=>actor.root.getObjectByName(name.replaceAll('.',''))||actor.root.getObjectByName(name);
  const legs=['L','R'].map(side=>({upper:bone('UpperLeg.'+side),lower:bone('LowerLeg.'+side),ankle:bone('LowerLeg.'+side+'_end'),foot:bone('Foot.'+side),side:side==='L'?1:-1,target:new THREE.Vector3(),footPoint:new THREE.Vector3()}));
  const bones=legs.flatMap(leg=>[leg.upper,leg.lower,leg.foot]).filter(Boolean);
  actor.stance={legs,blend:0,walkBlend:0,phase:0,applied:false,direction:new THREE.Vector3(),delta:new THREE.Vector3(),saved:bones.map(bone=>({bone,position:new THREE.Vector3(),quaternion:new THREE.Quaternion()}))};
 }
 const stance=actor.stance,speed=Math.hypot(u.vx||0,u.vz||0);stance.blend=THREE.MathUtils.lerp(stance.blend,u.crouching?1:0,Math.min(1,dt*14));
 stance.walkBlend=THREE.MathUtils.lerp(stance.walkBlend,u.crouching&&u.grounded&&speed>.2?Math.min(1,speed/1.9):0,Math.min(1,dt*14));
 if(!u.crouching||actor.currentAction!=='Crouch'||stance.walkBlend<.001)return;
 // The uploaded FBX supplies the full crouched pose. Add short foot steps only while moving.
 for(const saved of stance.saved){saved.position.copy(saved.bone.position);saved.quaternion.copy(saved.bone.quaternion);}stance.applied=true;
 actor.root.updateMatrixWorld(true);stance.phase+=dt*(6+speed*2);stance.direction.set(u.vx||0,0,u.vz||0).normalize();
 for(const leg of stance.legs){
  if(!leg.upper||!leg.lower||!leg.ankle||!leg.foot)continue;
  const phase=stance.phase+(leg.side<0?Math.PI:0);stance.delta.copy(stance.direction).multiplyScalar(Math.sin(phase)*.17*stance.walkBlend);stance.delta.y=Math.max(0,Math.cos(phase))*.07*stance.walkBlend;
  leg.ankle.getWorldPosition(leg.target).add(stance.delta);leg.foot.getWorldPosition(leg.footPoint).add(stance.delta);
  solveArm(leg.upper,leg.lower,leg.ankle,leg.target,actor.root.localToWorld(new THREE.Vector3(leg.side*.17,.35,.7)));
  leg.foot.position.copy(leg.foot.parent.worldToLocal(leg.footPoint));leg.foot.updateMatrixWorld(true);
 }
}
export function updateRemoteCombat(actor,u,assets,now=Date.now()){
 const key=actor.remoteMeleeUntil>now?'knife':u.weapon,w=weapons[key];if(!w)return;
 if(!actor.combat||actor.combat.key!==key){disposeRemoteCombat(actor);const pivot=new THREE.Group();pivot.name='remote-combat';actor.root.add(pivot);let gun;
 if(key==='knife'){gun=new THREE.Group();box(gun,.045,.045,.42,0,0,.21,0xaabcc3);box(gun,.1,.06,.06,0,0,.4,0x273a35);}else{if(!assets[key]){pivot.removeFromParent();return;}gun=createWeaponModel(assets[key],key);}gun.rotation.y=Math.PI;pivot.add(gun);
 const magazine=box(pivot,.065,.17,.11,0,-.17,.38,0x283d3c),flash=createMuzzleFlash(key);gun.add(flash);
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,1)]),new THREE.LineBasicMaterial({color:0xffd788,transparent:true,opacity:.7}));pivot.add(line);const heldGrenade=createHeldGrenade();heldGrenade.visible=false;actor.root.add(heldGrenade);
 actor.combat={key,pivot,gun,magazine,flash,line,heldGrenade,bones:Object.fromEntries(['UpperArmR','LowerArmR','WristR','UpperArmL','LowerArmL','WristL','Head'].map(name=>[name,actor.root.getObjectByName(name)]))};
 }
 const crouchDrop=(EYE-CROUCH_EYE)*(actor.stance?.blend||0),c=actor.combat,side=isSidearm(key),knife=key==='knife',depth=knife?.52:side?.54:w.category==='sniper'?1.0:.84,reloading=!knife&&u.reloadUntil>now,progress=reloading?clamp(1-(u.reloadUntil-now)/w.reload,0,1):0,reloadTilt=Math.sin(progress*Math.PI),kick=knife?0:Math.max(0,1-(now-u.lastShot)/130),melee=knife?clamp((now-Math.max(u.lastShot||0,u.lastMelee||0))/380,0,1):1,swing=Math.sin(melee*Math.PI),throwing=u.throwUntil>now;
 const speed=Math.hypot(u.vx||0,u.vz||0),moving=u.grounded&&speed>.25&&!u.scoped&&!reloading&&!throwing&&!kick&&!knife?Math.min(1,speed/3.8):0,dt=clamp((now-(c.lastAt??now-33))/1000,0,.1);c.lastAt=now;c.moveBlend=THREE.MathUtils.lerp(c.moveBlend||0,moving,Math.min(1,dt*14));if(c.moveBlend<.001)c.moveBlend=0;const carry=u.scoped||reloading||kick?0:c.moveBlend,fast=speed>4.4?1:0,wave=Math.sin(now*(fast?.012:.008));c.pivot.position.set((u.scoped&&!knife?-.06:-.18)-carry*.025,(u.scoped&&!knife?1.39:1.22)-crouchDrop-carry*(.1+fast*.04)+carry*Math.cos(now*.016)*.01,.08-kick*.035);c.pivot.rotation.set(-u.pitch-kick*.04+reloadTilt*.16+carry*(.16+fast*.05),knife?swing*.95:carry*(.27+fast*.08+wave*.02),reloadTilt*.42+(knife?swing*.5:carry*(.2+wave*.025)));c.gun.position.set(0,0,depth);c.gun.visible=!throwing;
 const pull=progress<.32?progress/.32:progress<.46?1:Math.max(0,1-(progress-.46)/.3);c.magazine.visible=reloading&&!knife&&!throwing;c.magazine.position.set(-.03*reloadTilt,-.16-pull*.3,side?.24:.38);
 if(u.shots>0&&u.shots!==(actor.muzzleShots??0)){actor.muzzleFlashAt=now;actor.muzzleFlashWeapon=u.weapon;}actor.muzzleShots=u.shots;
 updateMuzzleFlash(c.flash,!knife&&!throwing&&actor.muzzleFlashWeapon===key?now-(actor.muzzleFlashAt??-Infinity):Infinity,u.shots);
 c.line.visible=c.flash.visible;c.line.position.set(0,0,depth+.06);
 actor.root.updateMatrixWorld(true);
 const handR=c.pivot.localToWorld(new THREE.Vector3(0,-.09,side?.24:knife?.29:.23)),handL=c.pivot.localToWorld(new THREE.Vector3(.055,-.08,side?.26:.54));
 if(reloading){const mag=c.magazine.getWorldPosition(new THREE.Vector3());handL.lerp(mag,Math.sin(Math.PI*clamp(progress/.8,0,1)));if(progress>.78&&progress<.96)handL.copy(c.pivot.localToWorld(new THREE.Vector3(-.07,.01,.28+Math.sin((progress-.78)/.18*Math.PI)*.1)));}
 if(throwing){const p=clamp((now-(u.throwUntil-650))/650,0,1),push=clamp((p-.35)/.22,0,1);handR.copy(actor.root.localToWorld(new THREE.Vector3(-.2,1.5-crouchDrop+.1*Math.sin(p*Math.PI)-push*.18,-.08+push*.68)));}c.heldGrenade.visible=throwing&&!!u.throwAt&&now<u.throwAt;
 const b=c.bones;c.basePose=Object.entries(b).filter(([,bone])=>bone).map(([name,bone])=>[name,bone.quaternion.clone()]);solveArm(b.UpperArmR,b.LowerArmR,b.WristR,handR,actor.root.localToWorld(new THREE.Vector3(-.65,.8-crouchDrop,.05)));
 if(!knife)solveArm(b.UpperArmL,b.LowerArmL,b.WristL,handL,actor.root.localToWorld(new THREE.Vector3(.55,.85-crouchDrop,.1)));
 if(c.heldGrenade.visible){const wrist=b.WristR?.getWorldPosition(new THREE.Vector3())||handR;c.heldGrenade.position.copy(actor.root.worldToLocal(wrist.clone())).add(new THREE.Vector3(0,.055,.02));}
 if(b.Head){const axis=new THREE.Vector3(1,0,0).applyQuaternion(actor.root.getWorldQuaternion(new THREE.Quaternion()));rotateWorld(b.Head,new THREE.Quaternion().setFromAxisAngle(axis,-u.pitch*.65));}
 c.pivot.userData={weapon:key,reloading,progress,pitch:u.pitch,muzzleDirection:new THREE.Vector3(0,0,1).transformDirection(c.pivot.matrixWorld).toArray()};
}

export function updateRemoteLife(actor,u,now=Date.now()){
 if(u.hp>0){if(actor.dying){actor.mixer?.stopAllAction();actor.idle?.reset().play();actor.currentAction='Idle';actor.dying=false;}if(actor.combat)actor.combat.pivot.visible=true;return false;}
 if(actor.stance)actor.stance.blend=actor.stance.walkBlend=0;
 if(!actor.dying){resetRemoteCombatPose(actor);actor.mixer?.stopAllAction();const action=actor.directional?.User_Dying||actor.directional?.Death;if(action){action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();actor.deathAction=action;}actor.dying=true;actor.currentAction='Dying';}
 if(actor.deathAction){actor.deathAction.time=Math.min(actor.deathAction.getClip().duration,Math.max(0,(now-(u.diedAt||now))/1000)*1.6);actor.mixer.update(0);}
 if(actor.combat){actor.combat.pivot.visible=false;actor.combat.heldGrenade.visible=false;}return true;
}
export function disposeLobbyWeapon(actor){if(actor.lobbyWeapon){dispose(actor.lobbyWeapon.gun);actor.lobbyWeapon=null;}}
export function updateLobbyWeapon(actor,key,assets){if(!assets[key])return;if(actor.lobbyWeapon?.key!==key){disposeLobbyWeapon(actor);const gun=createWeaponModel(assets[key],key);actor.root.add(gun);actor.lobbyWeapon={key,gun};}actor.root.updateMatrixWorld(true);const right=actor.root.getObjectByName('WristR'),left=actor.root.getObjectByName('WristL');if(!right||!left)return;const r=actor.root.worldToLocal(right.getWorldPosition(new THREE.Vector3())),l=actor.root.worldToLocal(left.getWorldPosition(new THREE.Vector3())),direction=l.sub(r).normalize(),scale=actor.height/1.75,depth=weapons[key].category==='sniper'?.78:weapons[key].category==='smg'?.45:.6,gun=actor.lobbyWeapon.gun;gun.scale.setScalar(scale);gun.position.copy(r).addScaledVector(direction,depth*scale);gun.position.y+=.025*scale;gun.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);}
