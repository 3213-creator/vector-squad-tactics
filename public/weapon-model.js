import * as THREE from 'three';
import {weapons,isSidearm,isSniper} from '../weapons.js';
// All uploaded files become metre-scaled, with their muzzle at (0,0,0), facing -Z.
export function createWeaponModel(source,key){
 const model=source.clone(true),outer=new THREE.Group(),w=weapons[key];outer.name='weapon-model-'+key;outer.add(model);
 model.traverse(o=>{if(!o.isMesh)return;o.geometry=o.geometry.clone();const convert=m=>new THREE.MeshLambertMaterial({color:m.color,vertexColors:m.vertexColors,side:THREE.DoubleSide,transparent:m.transparent,opacity:m.opacity});o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
 const raw=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());model.rotation.y=raw.x>raw.z?Math.PI/2:0;
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),length=isSniper(key)?1.2:isSidearm(key)?.42:w.category==='smg'?.72:.95,scale=length/size.z;
 model.scale.multiplyScalar(scale);model.position.copy(bounds.getCenter(new THREE.Vector3()).multiplyScalar(-scale));model.position.z+=length/2;model.updateMatrixWorld(true);
 let minY=Infinity,maxY=-Infinity;const point=new THREE.Vector3();model.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(point.z<length*.025){minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}}});if(Number.isFinite(minY))model.position.y-=(minY+maxY)/2;
 return outer;
}
