import * as THREE from '/three.js';
import {SIZE,DEPTH,walls,initial,weapons} from '/game.js';
import {mapData} from '/map-data.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
const $=id=>document.getElementById(id);
let socket,state=initial(),team=null,selected=null,ready=false,profileName='',previewWeapon='rifle',entered=false;
try{profileName=localStorage.getItem('vector-name')||'';}catch{}
$('lobby-join').append($('join'));$('player-name').value=profileName;
$('profile-form').hidden=!!profileName;
const scene=new THREE.Scene();scene.background=new THREE.Color('#192327');
const camera=new THREE.PerspectiveCamera(40,1,.1,100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));$('viewport').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd6ebff,0x343a32,2.8));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(4,12,8);scene.add(sun);
const board=new THREE.Group();scene.add(board);const clickable=[],soldiers=new THREE.Group();scene.add(soldiers);
function box(w,h,d,color,x,y,z,parent=board){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));o.position.set(x,y,z);parent.add(o);return o;}
for(let x=0;x<SIZE;x++)for(let z=0;z<DEPTH;z++){const tile=box(.96,.025,.96,'#9ac9a0',x-(SIZE-1)/2,.025,z-(DEPTH-1)/2);tile.material.transparent=true;tile.material.opacity=walls.some(w=>w.x===x&&w.z===z)?0:.05;tile.material.depthWrite=false;tile.userData={x,z};clickable.push(tile);}
let angle=.55,distance=28;
function cameraUpdate(){camera.position.set(Math.sin(angle)*distance,distance*.95,Math.cos(angle)*distance);camera.lookAt(0,0,0);}cameraUpdate();
function releaseGroup(group){group.traverse(o=>{if(!o.userData.sharedAsset){o.geometry?.dispose();o.material?.dispose();}});group.clear();}
function draw(){releaseGroup(soldiers);battleMixers.length=0;for(const u of state.units){if(u.hp<=0)continue;const g=new THREE.Group();g.position.set(u.x-(SIZE-1)/2,0,u.z-(DEPTH-1)/2);soldiers.add(g);const color=u.team===team?0x76bfff:0xff8577;const key=u.team===team?'soldier':'swat';const model=instantiateOperator(key,1.65);if(model){g.add(model.root);model.root.traverse(o=>{if(o.isMesh)o.userData.unit=u.id;});if(model.mixer)battleMixers.push(model.mixer);}else{const body=box(.4,.7,.35,color,0,.5,0,g);body.userData.unit=u.id;}
 const ring=new THREE.Mesh(new THREE.RingGeometry(.34,.44,32),new THREE.MeshBasicMaterial({color:u.id===selected?0xd0fc72:color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.04;g.add(ring);box(.7*(u.hp/100),.045,.06,0xd0fc72,0,1.95,0,g);}
 const own=state.units.find(u=>u.team===team);for(const tile of clickable){const d=tile.userData;const blocked=walls.some(w=>w.x===d.x&&w.z===d.z);const next=own&&Math.abs(own.x-d.x)+Math.abs(own.z-d.z)===1;tile.material.opacity=blocked?0:next ? .28 : .04;}
 $('squad').replaceChildren();for(const u of state.units.filter(u=>u.team===team)){const b=document.createElement('button');b.className='unit'+(selected===u.id?' selected':'');b.textContent=`오퍼레이터 ${u.team+1}   ${u.hp} HP / ${u.ap} AP`;b.disabled=u.hp<=0;b.onclick=()=>{selected=u.id;draw();};$('squad').append(b);}
 updateHUD();updateLobby();
 $('round').textContent=`ROUND ${state.round}`;
 $('status').textContent=team===null?'접속 대기 중':state.winner!==null?`${state.winner===team?'승리':'패배'} · 작전 종료`:!ready?'상대 플레이어 대기 중':state.turn===team?'당신의 턴 · 명령을 내려주세요':'상대의 턴 · 작전 진행 중';
 $('end').disabled=!ready||state.turn!==team||state.winner!==null;
}

const operatorAssets={},battleMixers=[],lobbyMixers=[];let assetRevision=0,mapLoaded=false;const loader=new GLTFLoader();
function instantiateOperator(key,height){const asset=operatorAssets[key];if(!asset)return null;const root=new THREE.Group(),model=cloneSkeleton(asset.scene);root.add(model);model.traverse(o=>{o.userData.sharedAsset=true;if(o.isMesh)o.frustumCulled=false;});model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());const scale=height/size.y;model.scale.multiplyScalar(scale);model.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);let mixer=null;const idle=asset.animations.find(a=>/Idle_Neutral/.test(a.name))||asset.animations.find(a=>/Idle/.test(a.name));if(idle){mixer=new THREE.AnimationMixer(model);mixer.clipAction(idle).play();}return {root,mixer};}
async function loadAssets(){const tasks=[['soldier','/assets/soldier.glb?v=1'],['swat','/assets/swat.glb?v=1'],['arena','/assets/arena.glb?v=1']];const failed=[];await Promise.all(tasks.map(async([key,url])=>{try{const gltf=await loader.loadAsync(url);if(key==='arena'){gltf.scene.scale.setScalar(mapData.scale);scene.add(gltf.scene);mapLoaded=true;}else operatorAssets[key]=gltf;assetRevision++;draw();}catch(error){failed.push(key);console.error('Asset load failed:',key,error);}}));$('asset-status').textContent=failed.length?'일부 모델 로딩 실패 · 새로고침해 주세요.':'CUSTOM MAP / Soldier · SWAT 준비 완료';$('start-game').disabled=team===null||!state.players[1-team]||!mapLoaded||!operatorAssets.soldier||!operatorAssets.swat;}
// Hangar lobby with uploaded characters and a separate title diorama.
const lobbyScene=new THREE.Scene();lobbyScene.background=new THREE.Color('#111c23');lobbyScene.fog=new THREE.Fog('#111c23',12,35);
const lobbyCamera=new THREE.PerspectiveCamera(38,1,.1,70);lobbyCamera.position.set(0,2.7,9);lobbyCamera.lookAt(0,1.65,0);
lobbyScene.add(new THREE.HemisphereLight(0xbfd9e6,0x34372b,2.6));
const keyLight=new THREE.DirectionalLight(0xffe5bd,4);keyLight.position.set(-3,6,5);lobbyScene.add(keyLight);const rim=new THREE.DirectionalLight(0x71c5ff,3);rim.position.set(4,4,-3);lobbyScene.add(rim);
const hangar=new THREE.Group();lobbyScene.add(hangar);
box(40,.2,40,0x2c3433,0,-.15,0,hangar);box(30,12,.3,0x24333b,0,5,-8,hangar);
for(let i=-3;i<=3;i++){box(.22,7,.3,0x52616a,i*3,3.4,-7.7,hangar);box(.3,7,14,0x293941,i*4,6,-2,hangar);box(.08,.06,8,0x95b5c1,i*3,5.9,-2,hangar);}
for(const [x,z] of [[-4,-3],[4,-4],[-5,-5],[5,-6]]){box(1.5,1.1,1.2,0x495441,x,.5,z,hangar);box(1.55,.08,1.25,0x78806b,x,1.1,z,hangar);}
const grid=new THREE.GridHelper(40,40,0x536168,0x35434a);lobbyScene.add(grid);
const avatars=new THREE.Group();lobbyScene.add(avatars);
const titleScene=new THREE.Scene();titleScene.background=new THREE.Color('#bd6040');titleScene.fog=new THREE.Fog('#bd6040',9,24);const splashCamera=new THREE.PerspectiveCamera(40,1,.1,60);splashCamera.position.set(0,2.7,10);splashCamera.lookAt(0,1.5,0);
titleScene.add(new THREE.HemisphereLight(0xffd9a4,0x67452f,3));const titleLight=new THREE.DirectionalLight(0xffe3a5,4);titleLight.position.set(-4,6,5);titleScene.add(titleLight);const titleFloor=new THREE.Group();titleScene.add(titleFloor);box(50,.1,40,0x8c5738,0,-.12,0,titleFloor);
const smoke=new THREE.Group();titleScene.add(smoke);for(let i=0;i<22;i++){const sphere=new THREE.Mesh(new THREE.SphereGeometry(.8+(i%4)*.3,12,8),new THREE.MeshStandardMaterial({color:i%3?0x766b43:0x9a8252,roughness:1}));sphere.position.set(Math.sin(i*2.4)*2.2,1.5+(i%7)*.65,-3-Math.cos(i*1.9));smoke.add(sphere);}
const titleAvatars=new THREE.Group();titleScene.add(titleAvatars);let titleRevision=-1;
$('press-start').onclick=()=>{entered=true;updateLobby();if(!profileName)$('player-name').focus();};
document.addEventListener('keydown',e=>{if(!entered&&(e.key==='Enter'||e.code==='Space')){e.preventDefault();$('press-start').click();}});

function makeOperator(x,enemy,weapon){const loaded=instantiateOperator(enemy?'swat':'soldier',2.9);if(loaded){loaded.root.position.x=x;avatars.add(loaded.root);if(loaded.mixer)lobbyMixers.push(loaded.mixer);return loaded.root;}const g=new THREE.Group();g.position.x=x;avatars.add(g);const cloth=enemy?0x665449:0x4f5b4a,vest=0x26312e,skin=0xc6a184;
 const part=(w,h,d,c,px,py,pz)=>box(w,h,d,c,px,py,pz,g);
 // Combat boots, articulated trousers, plate carrier and helmet.
 for(const sign of [-1,1]){part(.26,.22,.48,0x20282a,sign*.21,.14,.08);part(.27,.65,.3,cloth,sign*.21,.56,0);part(.3,.19,.34,0x343c36,sign*.21,.76,.07);part(.31,.62,.34,cloth,sign*.21,1.05,0);}
 part(.72,.76,.4,cloth,0,1.76,0);part(.78,.57,.47,vest,0,1.77,.035);part(.7,.1,.46,0x1b2424,0,1.36,0);
 for(const px of [-.23,0,.23])part(.18,.25,.13,0x5b6550,px,1.65,.3);
 part(.18,.2,.2,skin,0,2.2,0);part(.38,.45,.36,skin,0,2.51,0);part(.45,.18,.43,cloth,0,2.76,0);part(.47,.05,.48,vest,0,2.68,.04);part(.33,.09,.06,0x242e32,0,2.56,.2);
 for(const sign of [-1,1]){const arm=part(.23,.65,.25,cloth,sign*.48,1.84,.04);arm.rotation.z=sign*.16;part(.2,.4,.23,skin,sign*.54,1.36,.09);part(.21,.18,.24,0x26312c,sign*.54,1.1,.1);}
 part(.15,.13,.04,enemy?0xff8677:0x85c9ff,-.3,2,.26);
 if(weapon==='rifle'){const gun=part(.14,.17,1.0,0x172126,.33,1.35,.43);gun.rotation.x=-.3;part(.12,.26,.18,0x202c32,.33,1.18,.38);}else if(weapon==='pistol'){part(.12,.16,.4,0x172126,.53,1.13,.25);}else{const blade=part(.08,.53,.04,0xc5d5dc,.53,.96,.23);blade.rotation.z=-.2;}
 const base=new THREE.Mesh(new THREE.CylinderGeometry(.7,.76,.05,48),new THREE.MeshStandardMaterial({color:enemy?0x6d3934:0x405b58,metalness:.5,roughness:.6}));base.position.y=.005;g.add(base);return g;}
let lobbySignature='';
function updateLobby(){
 const inLobby=state.phase!=='battle';$('title-screen').hidden=entered;$('lobby').hidden=!entered||!inLobby;$('battle-main').hidden=!entered||inLobby;document.querySelector('header').hidden=!entered;document.querySelector('footer').hidden=!entered||inLobby;
 const parent=!entered?$('title-viewport'):inLobby?$('lobby-viewport'):$('viewport');if(renderer.domElement.parentElement!==parent){parent.append(renderer.domElement);requestAnimationFrame(resizeView);}
 const me=team===null?null:state.players[team],other=team===null?null:state.players[1-team];const myName=me?.name||profileName||'이름을 설정하세요';
 $('display-name').textContent=myName;$('own-label').textContent=myName;$('own-ready').textContent=me?(me.ready?'READY / 준비 완료':'대기 중'):'접속 전';
 $('opponent-label').hidden=!other;$('enemy-name').textContent=other?.name||'';$('enemy-ready').textContent=other?.ready?'READY / 준비 완료':'로비 입장 · 준비 중';
 if(team===null)$('lobby-status').textContent=profileName?'같은 방 코드로 접속해 상대를 초대하세요.':'이름을 저장한 뒤 방에 참가하세요.';
 else $('lobby-status').textContent=!other?'상대 접속을 기다리는 중입니다.':me.ready?'상대의 게임 시작을 기다리는 중입니다.':`${other.name} 님이 입장했습니다. 게임 시작을 눌러 주세요.`;
 $('start-game').disabled=team===null||!other||!mapLoaded||!operatorAssets.soldier||!operatorAssets.swat;$('start-game').innerHTML=`<span>DEPLOY / 1 VS 1</span>${me?.ready?'준비 취소':'게임 시작'} <b>↗</b>`;
 $('room').disabled=team!==null;$('join').querySelector('button').disabled=team!==null;
 const equipped=team===null?previewWeapon:state.units[team].weapon;
 $('lobby-weapons').replaceChildren();for(const [key,w] of Object.entries(weapons)){const b=document.createElement('button');b.className='lobby-weapon'+(equipped===key?' active':'');b.setAttribute('aria-pressed',String(equipped===key));const source=$('weapons').children[Object.keys(weapons).indexOf(key)];b.innerHTML=source.innerHTML;b.disabled=!!me?.ready;b.onclick=()=>{if(team===null){previewWeapon=key;updateLobby();}else send({type:'equip',id:team,weapon:key});};$('lobby-weapons').append(b);}
 const sig=JSON.stringify([assetRevision,!!other,equipped,other?state.units[1-team].weapon:null]);if(sig!==lobbySignature){lobbySignature=sig;releaseGroup(avatars);lobbyMixers.length=0;makeOperator(other?-1.05:0,false,equipped);if(other)makeOperator(1.05,true,state.units[1-team].weapon);}
 if(titleRevision!==assetRevision){titleRevision=assetRevision;releaseGroup(titleAvatars);for(const [key,x] of [['soldier',-1.25],['swat',1.25]]){const model=instantiateOperator(key,3.6);if(model){model.root.position.set(x,0,0);model.root.rotation.y=key==='soldier'?.15:-.15;titleAvatars.add(model.root);}}}
 $('lobby').classList.toggle('has-opponent',!!other);
}
$('profile-form').onsubmit=e=>{e.preventDefault();const name=$('player-name').value.trim();if(!name||Array.from(name).length>12||/[\u0000-\u001f\u007f]/.test(name))return;
 if(team!==null)send({type:'profile',name});profileName=name;try{localStorage.setItem('vector-name',name);}catch{}$('profile-form').hidden=true;updateLobby();};
$('edit-name').onclick=()=>{$('profile-form').hidden=false;$('player-name').focus();};
$('start-game').onclick=()=>send({type:'ready'});

const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
renderer.domElement.addEventListener('pointerdown',e=>{if(state.phase!=='battle')return;down={x:e.clientX,y:e.clientY,angle};renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(down){angle=down.angle+(e.clientX-down.x)*.008;cameraUpdate();}});
renderer.domElement.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(moved>5)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects([...soldiers.children,...board.children],true).find(h=>h.object.userData.unit!==undefined||h.object.userData.x!==undefined);if(!hit)return;const d=hit.object.userData;if(d.unit!==undefined){const u=state.units.find(u=>u.id===d.unit);if(u.team===team){selected=u.id;draw();}else if(selected!==null)send({type:'attack',id:selected,target:u.id});}else if(selected!==null)send({type:'move',id:selected,x:d.x,z:d.z});});
renderer.domElement.addEventListener('pointercancel',()=>down=null);
renderer.domElement.addEventListener('wheel',e=>{if(state.phase!=='battle')return;e.preventDefault();distance=THREE.MathUtils.clamp(distance+e.deltaY*.01,14,45);cameraUpdate();},{passive:false});
function send(action){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(action));else $('notice').textContent='먼저 방에 참가하세요.';}
$('join').onsubmit=e=>{e.preventDefault();if(!profileName){$('profile-form').hidden=false;$('player-name').focus();$('lobby-status').textContent='먼저 이름을 저장하세요.';return;}if(socket&&socket.readyState<2)return;const current=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);socket=current;$('connection').textContent='● CONNECTING';current.onopen=()=>send({type:'join',room:$('room').value.trim(),name:profileName,weapon:previewWeapon});current.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='joined'){team=m.team;selected=team;$('team').textContent=team===0?'ALPHA / 나의 오퍼레이터':'BRAVO / 나의 오퍼레이터';$('connection').textContent='● ONLINE';$('notice').textContent='아군 선택 후 인접 칸 또는 적을 클릭하세요.';}if(m.type==='state'){state=m.state;ready=m.ready;$('notice').textContent=state.lastEvent;draw();}if(m.type==='error'||m.type==='closed'){$('notice').textContent=m.message;$('lobby-status').textContent=m.message;if(team===null)current.close();}};current.onclose=()=>{ready=false;team=null;selected=null;state=initial();$('connection').textContent='● OFFLINE';draw();};current.onerror=()=>{$('notice').textContent='서버 연결 실패. 서버 실행 상태를 확인하세요.';};};
function updateHUD(){
 const u=state.units.find(u=>u.team===team),w=weapons[u?.weapon||'rifle'];
 $('hp-text').textContent=u?`${u.hp} HP`:'— HP';$('hp-fill').style.width=(u?.hp||0)+'%';$('ap-text').textContent=u?`${u.ap} / 2 AP`:'접속 대기';
 $('equipped-name').textContent=w.name;$('ammo-current').textContent=w.mag===null?'∞':u?.ammo[u.weapon]??'—';$('ammo-max').textContent=w.mag===null?' / 근접':` / ${w.mag}`;
 const enabled=ready&&state.turn===team&&state.winner===null;
 $('weapons').replaceChildren();
 const icons={rifle:'M3 12h35v5H20l-3 9h-5l2-9H3z M23 17v7h5v-7 M38 12h13v3H38 M8 9h12v3H8',pistol:'M8 8h32v8H24l-5 15H9l5-16H8z M25 16v7h8v-7',knife:'M6 28L32 4h15L22 28z M18 25l9 9 M7 36l11-11'};
 for(const [key,stat] of Object.entries(weapons)){
 const b=document.createElement('button');b.className='weapon-card'+(u?.weapon===key?' active':'');b.disabled=!enabled;b.setAttribute('aria-pressed',String(u?.weapon===key));
 b.innerHTML=`<span class="weapon-slot">${stat.slot} / ${key.toUpperCase()}</span><svg viewBox="0 0 56 40" aria-hidden="true"><path d="${icons[key]}"/></svg><strong>${stat.name}</strong><span class="weapon-stats"><span>데미지 <b>${stat.damage}</b></span><span>연사 <b>${stat.rpm} RPM</b></span><span>장탄 <b>${stat.mag??'∞ (칼)'}</b></span></span><small>사거리 ${stat.range}칸 · ${u?.weapon===key?'장착 중':'선택'}</small>`;
 b.onclick=()=>send({type:'equip',id:team,weapon:key});$('weapons').append(b);
 }
 $('reload').disabled=!enabled||!u||u.ap<1||w.mag===null||u.ammo[u.weapon]===w.mag;
 const ctx=$('minimap').getContext('2d'),scale=8;ctx.fillStyle='#0a151b';ctx.fillRect(0,0,SIZE*scale,DEPTH*scale);ctx.strokeStyle='#263c46';for(let i=0;i<=SIZE;i++){ctx.beginPath();ctx.moveTo(i*scale,0);ctx.lineTo(i*scale,DEPTH*scale);ctx.stroke();}for(let i=0;i<=DEPTH;i++){ctx.beginPath();ctx.moveTo(0,i*scale);ctx.lineTo(SIZE*scale,i*scale);ctx.stroke();}ctx.fillStyle='#78877f';for(const v of walls)ctx.fillRect(v.x*scale,v.z*scale,scale,scale);for(const v of state.units){if(v.hp<=0)continue;ctx.fillStyle=v.team===team?'#76bfff':'#ff8577';ctx.beginPath();ctx.arc((v.x+.5)*scale,(v.z+.5)*scale,3,0,Math.PI*2);ctx.fill();}

}
$('reload').onclick=()=>send({type:'reload',id:team});
$('zoom-in').onclick=()=>{distance=Math.max(14,distance-2);cameraUpdate();};$('zoom-out').onclick=()=>{distance=Math.min(45,distance+2);cameraUpdate();};
$('end').onclick=()=>send({type:'end'});
function resizeView(){const el=renderer.domElement.parentElement;if(!el?.clientWidth||!el.clientHeight)return;renderer.setSize(el.clientWidth,el.clientHeight);const active=!entered?splashCamera:state.phase==='battle'?camera:lobbyCamera;active.aspect=el.clientWidth/el.clientHeight;if(active===lobbyCamera){lobbyCamera.position.z=active.aspect<.7?12:9;lobbyCamera.lookAt(0,1.65,0);}if(active===splashCamera){splashCamera.position.z=active.aspect<.7?13:9;splashCamera.lookAt(0,1.7,0);}active.updateProjectionMatrix();}
const observer=new ResizeObserver(resizeView);observer.observe($('viewport'));observer.observe($('lobby-viewport'));observer.observe($('title-viewport'));
let lastFrame=0;renderer.setAnimationLoop(time=>{const delta=Math.min((time-lastFrame)/1000,.05);lastFrame=time;for(const mixer of (state.phase==='battle'?battleMixers:lobbyMixers))mixer.update(delta);if(!entered){smoke.rotation.y=Math.sin(time*.00008)*.035;renderer.render(titleScene,splashCamera);}else if(state.phase==='battle')renderer.render(scene,camera);else{for(const avatar of avatars.children)avatar.rotation.y=Math.sin(time*.0004)*.035;renderer.render(lobbyScene,lobbyCamera);}});draw();loadAssets();
