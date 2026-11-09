import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CollisionWorld} from './collision-world.js';
import {mapData} from './map-data.js';
export async function loadWorld(){const b=await readFile(new URL('public/assets/collision.glb',import.meta.url));const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');gltf.scene.scale.setScalar(mapData.scale);gltf.scene.updateMatrixWorld(true);return new CollisionWorld(gltf.scene);}
