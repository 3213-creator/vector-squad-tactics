import * as THREE from 'three';
import {weapons,isSidearm,isSniper,aimProfiles} from '../weapons.js';
// One cached texture serves all first-person and opponent flashes without extra asset requests.
let muzzleTexture=null;
const MUZZLE_FLASH_MS=60;
export function createMuzzleFlash(key){
 if(!muzzleTexture){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d'),glow=ctx.createRadialGradient(64,64,3,64,64,62);
  glow.addColorStop(0,'#fff');glow.addColorStop(.16,'#fffde0');glow.addColorStop(.38,'#ffe582');glow.addColorStop(.72,'#ffad3566');glow.addColorStop(1,'#ff741000');
  ctx.fillStyle=glow;ctx.beginPath();
  for(let i=0;i<24;i++){const angle=i*Math.PI/12,radius=i%2?15+(i%3)*3:42+(i%5)*4,x=64+Math.cos(angle)*radius,y=64+Math.sin(angle)*radius;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}
  ctx.closePath();ctx.fill();
  muzzleTexture=new THREE.CanvasTexture(canvas);muzzleTexture.colorSpace=THREE.SRGBColorSpace;
 }
 const root=new THREE.Group();root.name='muzzle-flash';root.visible=false;
 const flare=new THREE.Sprite(new THREE.SpriteMaterial({map:muzzleTexture,color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
 flare.position.z=-.2;root.add(flare);
 const core=new THREE.Mesh(new THREE.ConeGeometry(.12,.8,6),new THREE.MeshBasicMaterial({color:0xfff0b5,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
 core.rotation.x=-Math.PI/2;core.position.z=-.4;root.add(core);
 root.userData={flare,core,size:isSidearm(key)?.12:isSniper(key)?.2:.16};return root;
}
export function updateMuzzleFlash(root,age,shot=0,sizeScale=1){
 if(!root)return;
 root.visible=age>=0&&age<MUZZLE_FLASH_MS;if(!root.visible)return;
 const fade=1-age/MUZZLE_FLASH_MS,{flare,core,size}=root.userData;
 root.scale.setScalar(size*sizeScale*(.85+Math.sin(shot*12.9898)*.12)*(.8+.2*fade));
 flare.material.rotation=shot*2.39996;flare.material.opacity=Math.min(1,fade*1.5);core.material.opacity=fade*.8;
}
// All uploaded files become metre-scaled, with their muzzle at (0,0,0), facing -Z.
export function createWeaponModel(source,key){
 const model=source.clone(true),outer=new THREE.Group(),w=weapons[key];outer.name='weapon-model-'+key;outer.add(model);
 model.traverse(o=>{if(!o.isMesh)return;o.geometry=o.geometry.clone();const convert=m=>new THREE.MeshLambertMaterial({color:m.color,vertexColors:m.vertexColors,side:THREE.DoubleSide,transparent:m.transparent,opacity:m.opacity});o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
 const raw=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());model.rotation.y=raw.x>raw.z?Math.PI/2:0;
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),length=isSniper(key)?1.2:isSidearm(key)?.42:w.category==='smg'?.72:.95,scale=length/size.z;
 model.scale.multiplyScalar(scale);model.position.copy(bounds.getCenter(new THREE.Vector3()).multiplyScalar(-scale));model.position.z+=length/2;model.updateMatrixWorld(true);
 let minY=Infinity,maxY=-Infinity;const point=new THREE.Vector3();model.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(point.z<length*.025){minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}}});if(Number.isFinite(minY))model.position.y-=(minY+maxY)/2;
 if(aimProfiles[key])addSights(outer,aimProfiles[key]);
 return outer;
}

function addSights(gun,p){
 const group=new THREE.Group();group.name='weapon-sights';gun.add(group);
 const metal=new THREE.MeshLambertMaterial({color:0x202b2d}),accent=new THREE.MeshBasicMaterial({color:p.kind==='u-notch'?0xffa335:0xd8f0d5});
 function part(parent,x,y,z,w,h,d,material=metal){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
 function dot(parent,x,y,z,color,r=.0018){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,8,6),new THREE.MeshBasicMaterial({color}));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
 const rear=new THREE.Group(),front=new THREE.Group();rear.name='ads-rear';front.name='ads-front';rear.position.set(0,p.height,p.rear);front.position.set(0,p.height,p.front);group.add(rear,front);
 if(p.kind==='ring-reflex'||p.kind==='open-reflex'){
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(.058,.056),new THREE.MeshBasicMaterial({color:0x75c8ce,transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide}));rear.add(glass);
  if(p.kind==='ring-reflex'){const ring=new THREE.Mesh(new THREE.TorusGeometry(.033,.0055,8,32),metal);rear.add(ring);part(rear,0,-.043,0,.06,.02,.045);}
  else{part(rear,-.034,0,0,.008,.068,.025);part(rear,.034,0,0,.008,.068,.025);part(rear,0,.034,0,.065,.007,.025);part(rear,0,-.034,0,.073,.008,.04);}
  part(rear,0,-.06,0,.035,.035,.045);
  dot(front,0,0,0,p.kind==='ring-reflex'?0xff4e32:0x74ff74,.0015);
 }else{
  if(p.kind==='aperture'){rear.add(new THREE.Mesh(new THREE.TorusGeometry(.022,.005,8,28),metal));part(rear,0,-.031,0,.065,.018,.025);}
  else if(p.kind==='v-notch'){const left=part(rear,-.011,-.003,0,.007,.026,.018),right=part(rear,.011,-.003,0,.007,.026,.018);left.rotation.z=-.28;right.rotation.z=.28;part(rear,0,-.018,0,.036,.008,.02);}
  else{const gap=p.kind==='notch'?.013:.011;part(rear,-gap-.005,-.003,0,.01,.025,.02);part(rear,gap+.005,-.003,0,.01,.025,.02);part(rear,0,-.018,0,.045,.008,.022);}
  part(front,0,-.012,0,.007,.024,.014);
  part(front,0,-.031,0,.025,.017,.02);
  if(p.kind==='notch'){part(front,-.015,-.008,0,.004,.036,.016);part(front,.015,-.008,0,.004,.036,.016);}
  if(p.kind==='three-dot'){dot(rear,-.016,-.004,.012,0xe2f4d4);dot(rear,.016,-.004,.012,0xe2f4d4);dot(front,0,-.004,.008,0x9cf9b4);}
  if(p.kind==='u-notch'){part(front,0,-.005,.009,.004,.009,.002,accent);part(rear,0,-.013,.012,.024,.003,.002,accent);}
 }
 gun.userData.aimProfile=p;
}

export function createHeldGrenade(){const root=new THREE.Group();root.name='held-grenade';const shell=new THREE.Mesh(new THREE.SphereGeometry(.058,10,8),new THREE.MeshLambertMaterial({color:0x58643b}));shell.scale.y=1.35;root.add(shell);const top=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.035,8),new THREE.MeshLambertMaterial({color:0x263529}));top.position.y=.086;root.add(top);const lever=new THREE.Mesh(new THREE.BoxGeometry(.018,.09,.018),new THREE.MeshLambertMaterial({color:0x999a7c}));lever.position.set(.045,.06,0);lever.rotation.z=.2;root.add(lever);const pin=new THREE.Mesh(new THREE.TorusGeometry(.018,.003,5,16),new THREE.MeshLambertMaterial({color:0xb8bba8}));pin.position.set(-.025,.08,0);root.add(pin);return root;}
