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
