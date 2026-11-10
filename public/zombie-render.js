import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export class ZombieRenderer{
 constructor(scene,camera){this.scene=scene;this.camera=camera;this.assets=[];this.actors=new Map();this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.sphere=new THREE.Sphere(new THREE.Vector3(),1.35);this.target=new THREE.Vector3();this.axis=new THREE.Vector3(1,0,0);this.rotation=new THREE.Quaternion();}
 async load(){
  this.assets=await Promise.all(['zombie-cop','zombie-embedded'].map(async(key,kind)=>{
   const [gltf,response]=await Promise.all([new GLTFLoader().loadAsync(`/assets/${key}.glb`),fetch(`/assets/${key}-motions.json`)]);
   if(!response.ok)throw Error('Zombie motions');const data=await response.json(),clips=Object.fromEntries(data.clips.map(c=>[c.name,THREE.AnimationClip.parse(c)])),materials=new Map();
   gltf.scene.traverse(o=>{if(!o.isMesh)return;const convert=m=>{if(!materials.has(m)){const color=m.color.clone();if(kind===1)color.multiply(new THREE.Color(.78,.87,.71));materials.set(m,new THREE.MeshLambertMaterial({map:m.map,color,side:m.side,vertexColors:m.vertexColors,transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest}));}return materials.get(m);};o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
   return {scene:gltf.scene,clips};
  }));
 }
 make(z){
  const asset=this.assets[z.kind];if(!asset)return null;
  const root=new THREE.Group(),model=cloneSkeleton(asset.scene);root.add(model);model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),scale=1.75/size.y;
  model.scale.multiplyScalar(scale);model.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);
  model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});
  const mixer=new THREE.AnimationMixer(model),actions={walk:mixer.clipAction(asset.clips.Zombie_walk),run:mixer.clipAction(asset.clips.Zombie_run)};
  const current=z.gait==='run'?'run':'walk';actions[current].time=(z.id*.137)%actions[current].getClip().duration;actions[current].play();mixer.update(0);
  const bones=['LeftArm','RightArm'].map(name=>model.getObjectByName(name)).filter(Boolean).map(bone=>({bone,base:new THREE.Quaternion()}));
  root.position.set(z.x,z.y,z.z);root.rotation.order='YXZ';root.rotation.y=z.yaw+Math.PI;this.scene.add(root);
  const actor={root,model,mixer,actions,current,bones,procedural:false,elapsed:0,updateAt:0,revealed:false};this.actors.set(z.id,actor);return actor;
 }
 release(id,actor){
  actor.mixer.stopAllAction();actor.mixer.uncacheRoot(actor.model);const skeletons=new Set();
  actor.root.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);if(o.userData.revealBase){o.material.dispose();o.material=o.userData.revealBase;delete o.userData.revealBase;}});
  for(const skeleton of skeletons)skeleton.dispose();actor.root.removeFromParent();this.actors.delete(id);
 }
 clear(){for(const [id,actor]of this.actors)this.release(id,actor);}
 update(zombies,dt,time,now,revealed=false){
  this.matrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
  const ids=new Set();
  for(const z of zombies){
   ids.add(z.id);const a=this.actors.get(z.id)||this.make(z);if(!a)continue;
   const dying=z.hp<=0,fall=dying?THREE.MathUtils.smoothstep((now-z.diedAt)/1000,0,.8):0;
   this.target.set(z.x,z.y-fall*.06,z.z);if(a.root.position.distanceToSquared(this.target)>16)a.root.position.copy(this.target);else a.root.position.lerp(this.target,Math.min(1,dt*18));
   a.root.rotation.y+=wrap(z.yaw+Math.PI-a.root.rotation.y)*Math.min(1,dt*14);
   a.root.rotation.z=-fall*1.48;
   this.sphere.center.copy(a.root.position).y+=.85;a.root.visible=this.frustum.intersectsSphere(this.sphere);a.elapsed=Math.min(.25,a.elapsed+dt);
   if(revealed!==a.revealed){a.root.traverse(o=>{if(!o.isMesh)return;if(revealed){o.userData.revealBase=o.material;o.material=new THREE.MeshBasicMaterial({color:0xff9d49,depthTest:false,transparent:true,opacity:.8});o.renderOrder=9;}else if(o.userData.revealBase){o.material.dispose();o.material=o.userData.revealBase;delete o.userData.revealBase;o.renderOrder=0;}});a.revealed=revealed;}
   if(!a.root.visible||dying||time<a.updateAt)continue;
   if(a.procedural){for(const part of a.bones)part.bone.quaternion.copy(part.base);a.procedural=false;}
   const gait=z.gait==='run'?'run':'walk';
   if(gait!==a.current){a.actions[a.current].fadeOut(.16);a.actions[gait].reset().setEffectiveWeight(1).fadeIn(.16).play();a.current=gait;}
   const moving=Math.hypot(z.vx||0,z.vz||0)>.15||z.ladder!==null;a.mixer.update(moving?a.elapsed:0);a.elapsed=0;
   a.updateAt=time+(a.root.position.distanceToSquared(this.camera.position)<49?1000/30:1000/15);
   const attackAge=now-z.lastAttack,attack=attackAge>=0&&attackAge<450?Math.sin(attackAge/450*Math.PI):0;
   if(attack||z.ladder!==null){for(const [i,part]of a.bones.entries()){part.base.copy(part.bone.quaternion);const angle=z.ladder!==null?-.35+Math.sin(now*.008+i*Math.PI)*.35:-attack*.7;part.bone.quaternion.multiply(this.rotation.setFromAxisAngle(this.axis,angle));}a.procedural=true;}
  }
  for(const [id,actor]of this.actors)if(!ids.has(id))this.release(id,actor);
 }
}
