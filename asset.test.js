import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
test('supplied GLB map and both character models parse and clone without external assets',async()=>{
 for(const name of ['arena','soldier','swat']){
 const bytes=await readFile(new URL(`public/assets/${name}.glb`,import.meta.url));assert.equal(bytes.toString('ascii',0,4),'glTF');
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const scene=clone(gltf.scene);scene.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());assert.ok(size.x>0&&size.y>0&&size.z>0);let meshes=0;scene.traverse(o=>{if(o.isMesh)meshes++;});assert.ok(meshes>0);
 if(name==='swat')assert.ok(gltf.animations.some(a=>/Idle_Neutral/.test(a.name)));
 }
});

test('all nine uploaded guns parse and normalize to a forward-facing first-person muzzle',async()=>{
 const {weapons,isSidearm,isSniper}=await import('./weapons.js');const {createWeaponModel}=await import('./public/weapon-model.js');const guns=Object.entries(weapons).filter(([,w])=>w.model);assert.equal(guns.length,9);
 for(const [key,w]of guns){const bytes=await readFile(new URL(`public/assets/weapons/${w.model}.glb`,import.meta.url)),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const before=new THREE.Box3().setFromObject(gltf.scene),model=createWeaponModel(gltf.scene,key),bounds=new THREE.Box3().setFromObject(model),length=isSniper(key)?1.2:isSidearm(key)?.42:w.category==='smg'?.72:.95;assert.ok(Math.abs(bounds.min.z)<.001,key+' muzzle');assert.ok(Math.abs(bounds.max.z-length)<.001,key+' length');assert.ok(bounds.getSize(new THREE.Vector3()).y>0);assert.ok(new THREE.Box3().setFromObject(gltf.scene).equals(before),key+' preserves source');const icon=await readFile(new URL(`public/assets/weapons/${w.model}.webp`,import.meta.url));assert.equal(icon.toString('ascii',8,12),'WEBP');}
});
