import {updateRemoteCombat,disposeRemoteCombat,resetRemoteCombatPose,updateRemoteLife,updateLobbyWeapon,disposeLobbyWeapon} from '/remote-combat.js';
import {createWeaponModel,createHeldGrenade} from '/weapon-model.js';
import {loadoutSlots,isSniper,isSidearm,canAim,aimProfiles} from '/weapons.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {CollisionWorld} from '/collision-world.js';
import {weapons,initial} from '/game.js';
import {moveBody,look,STEP,EYE,setWorld,setCrates,getWorld,shotOrigin,setDoors,raycastWorld,shotDirection} from '/physics.js';
import {nearLadder,ladders,doors as doorTemplates} from '/environment.js';
import {mapData} from '/map-data.js';
import {SpatialAudio} from '/spatial-audio.js';
const spatialAudio=new SpatialAudio();
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);},clamp=THREE.MathUtils.clamp;
function setHUDText(id,value){const el=$(id),text=String(value);if(el.textContent!==text)el.textContent=text;}
let state=initial(),team=null,socket=null,entered=false,profileName='',chosen='rifle',chosenSecondary='pistol',chosenMode='ai',startPending=false,assetsReady=false,inBattle=false,seq=0,pending=[],predicted=null,lastEvent=0;
let screen='title',connecting=false,connectionNotice='',roomsRequest=0,serverClockOffset=0,resultReturnPending=false;
function remoteNow(){return Date.now()+serverClockOffset;}
// Menu/lobby themes loop; the ten-second battle intro and final result themes play once.
const backgroundMusic=new Audio();backgroundMusic.preload='none';backgroundMusic.volume=.32;
const musicSources={menu:'/audio/main-theme-wot.mp3',lobby:'/audio/lobby-theme-mw2.mp3',battleIntro:'/audio/battle-intro-abbey.mp3',victory:'/audio/result-victory.mp3',defeat:'/audio/result-defeat.mp3'};
let musicTrack=null,musicPending=false,musicBlocked=false,musicGeneration=0,musicFinished=false;
function isOneShotMusic(track){return track==='battleIntro'||track==='victory'||track==='defeat';}
let battleIntroLoading=null;
function preloadBattleIntro(){if(!battleIntroLoading)battleIntroLoading=fetch('/audio/battle-intro-abbey.mp3').then(response=>{if(!response.ok)throw Error('Intro audio');return response.blob();}).then(blob=>{musicSources.battleIntro=URL.createObjectURL(blob);}).catch(()=>{battleIntroLoading=null;});}
function isMatchPreparing(){return state.phase==='intro'||state.phase==='countdown';}
let introViewElapsed=0,introFrameAt=0,introReadySentAt=-Infinity,introGoUntil=0,lastCountdownBeat=null;
function desiredMusicTrack(){
 if(screen==='battle')return 'battleIntro';
 if(screen==='results'&&team!==null&&state.winner!==null)return state.winner===team?'victory':'defeat';
 return ['title','menu','rooms','private'].includes(screen)?'menu':screen==='lobby'?'lobby':null;
}
function updateMusicControl(){
 for(const id of ['audio-toggle','lobby-audio-toggle']){setHUDText(id,spatialAudio.muted?'소리 끔':'소리 켬');$(id).setAttribute('aria-pressed',String(spatialAudio.muted));}
}
function syncBackgroundMusic(retry=false){
 const desired=desiredMusicTrack();if(desired==='lobby')preloadBattleIntro();backgroundMusic.muted=spatialAudio.muted;
 if(musicTrack!==desired){
  musicGeneration++;backgroundMusic.pause();musicPending=false;musicBlocked=false;musicFinished=false;musicTrack=desired;
  backgroundMusic.loop=desired==='menu'||desired==='lobby';
  if(desired)backgroundMusic.src=musicSources[desired];else{backgroundMusic.removeAttribute('src');backgroundMusic.load();}
 }
 if(!desired||spatialAudio.muted){musicGeneration++;musicPending=false;backgroundMusic.pause();updateMusicControl();return;}
 // Keep a completed one-shot silent through further snapshots, key presses and clicks.
 if(isOneShotMusic(desired)&&(musicFinished||backgroundMusic.ended)){musicFinished=true;updateMusicControl();return;}
 if(!backgroundMusic.paused||musicPending||musicBlocked&&!retry){updateMusicControl();return;}
 // Attempt immediately; a gesture retries only when the browser blocks sound autoplay.
 const generation=musicGeneration;musicPending=true;musicBlocked=false;
 try{Promise.resolve(backgroundMusic.play()).catch(error=>{
  if(generation===musicGeneration&&error.name!=='AbortError')musicBlocked=true;
 }).finally(()=>{if(generation===musicGeneration){musicPending=false;updateMusicControl();}});}
 catch{musicPending=false;musicBlocked=true;}
 updateMusicControl();
}
backgroundMusic.addEventListener('playing',()=>{if(!desiredMusicTrack()||spatialAudio.muted){backgroundMusic.pause();return;}musicBlocked=false;updateMusicControl();});
backgroundMusic.addEventListener('ended',()=>{if(isOneShotMusic(musicTrack)&&backgroundMusic.ended)musicFinished=true;});
function retryMusicFromGesture(e){const desired=desiredMusicTrack();if(!desired||spatialAudio.muted||isOneShotMusic(desired)&&musicFinished||!backgroundMusic.paused&&!musicBlocked)return;if(!e.repeat)syncBackgroundMusic(true);}
for(const type of ['pointerdown','pointerup','keydown'])document.addEventListener(type,retryMusicFromGesture,{capture:true,passive:true});
let touchScope=false,chatResume=false,adsBlend=0,moveBlend=0,runBlend=0,walkPhase=0,sprintRequested=false,lastWDown=-Infinity;
let yaw=0,pitch=0,fire=false,jump=false,scoped=false,dragMode=false,dragAim=null,hitUntil=0,damageUntil=0,recoil=0,meleeStarted=0,meleeUntil=0,interact=false;
let heldGrenade=null,magazine=null,bolt=null,supportHand=null,mapRoot=null;
let lobbyDrag=null;const lobbyRotationOffsets=new Map();
const keys=new Set(),touch={forward:0,strafe:0,active:false};
try{profileName=localStorage.getItem('vector-name')||'';}catch{}
$('player-name').value=profileName;$('room-player-name').value=profileName;$('profile-form').hidden=true;
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1));renderer.outputColorSpace=THREE.SRGBColorSpace;
const MAX_RENDER_PIXELS=1920*1080;
let renderScale=1,renderWidth=0,renderHeight=0,qualityFrames=0,qualityElapsed=0,qualityWindowAt=0,lastQualityChange=0;
const scene=new THREE.Scene();scene.background=new THREE.Color('#8b9fa7');scene.fog=new THREE.Fog('#8b9fa7',35,100);
scene.add(new THREE.HemisphereLight(0xe3f1ff,0x565a43,2));const sun=new THREE.DirectionalLight(0xffeccb,2.6);sun.position.set(6,14,7);scene.add(sun);
const flyoverCamera=new THREE.PerspectiveCamera(55,1,.1,200);
const camera=new THREE.PerspectiveCamera(80,1,.05,150);camera.rotation.order='YXZ';scene.add(camera);
const viewModel=new THREE.Group();camera.add(viewModel);const muzzle=new THREE.PointLight(0xffbb44,0,3);muzzle.position.set(.25,-.22,-.7);camera.add(muzzle);
const lobbyScene=new THREE.Scene();lobbyScene.background=new THREE.Color('#14212a');lobbyScene.fog=new THREE.Fog('#14212a',14,35);lobbyScene.add(new THREE.HemisphereLight(0xcce9ff,0x343c2d,2.5));const light=new THREE.DirectionalLight(0xffe3be,3);light.position.set(-4,6,5);lobbyScene.add(light);
const lobbyCamera=new THREE.PerspectiveCamera(38,1,.1,60);lobbyCamera.position.set(0,2.6,9);lobbyCamera.lookAt(0,1.5,0);
const titleCamera=lobbyCamera.clone();const lobbyActors=new THREE.Group();lobbyScene.add(lobbyActors);
function box(parent,w,h,d,color,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.75}));m.position.set(x,y,z);parent.add(m);return m;}
box(lobbyScene,40,.1,35,0x303c3e,0,-.1,0);box(lobbyScene,30,9,.2,0x26343c,0,4,-7);for(let x=-12;x<=12;x+=4){box(lobbyScene,.2,7,.2,0x64737a,x,3.4,-6.8);box(lobbyScene,.12,.05,12,0xa0c3cf,x,5,-1);}lobbyScene.add(new THREE.GridHelper(35,35,0x627272,0x34434a));
for(const x of [-4,4])box(lobbyScene,1.5,1.1,1.5,0x536048,x,.5,-3);
const assets={},weaponAssets={},motionClips={},lobbyActorRecords=[],mixers=[],actorObjects=new Map();let lobbyRevision='',assetVersion=0,viewWeapon='';
function makeActor(key,height,purpose='lobby'){const asset=assets[key];if(!asset)return null;const root=new THREE.Group(),model=cloneSkeleton(asset.scene);root.add(model);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),scale=height/size.y;model.scale.multiplyScalar(scale);model.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);model.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});const head=model.getObjectByName('Head'),faceLocalAxis=new THREE.Vector3(0,0,1);if(head)faceLocalAxis.applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert());let mixer=null,idle=null,run=null;if(asset.animations.length||motionClips['rifle-idle']){mixer=new THREE.AnimationMixer(model);const clip=purpose==='lobby'&&motionClips['rifle-idle']?motionClips['rifle-idle']:asset.animations.find(a=>/Idle_Neutral/.test(a.name))||asset.animations[0]||motionClips['rifle-idle'];idle=mixer.clipAction(clip);idle.play();mixer.update(0);const walk=asset.animations.find(a=>/\|Run$/.test(a.name));if(walk)run=mixer.clipAction(walk);mixers.push(mixer);}const directional={};if(mixer)for(const name of ['Run','Run_Back','Run_Left','Run_Right','Sword_Slash','Interact','Death']){const c=asset.animations.find(a=>a.name.endsWith('|'+name));if(c)directional[name]=mixer.clipAction(c);}if(mixer&&motionClips.dying)directional.User_Dying=mixer.clipAction(motionClips.dying);const forward=head?faceLocalAxis.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())):new THREE.Vector3(0,0,1),frontYaw=-Math.atan2(forward.x,forward.z);return {root,height,frontYaw,faceLocalAxis,mixer,idle,run,directional,currentAction:'Idle',attackUntil:0,moving:false};}
function rebuildLobby(){
 const other=team===null?null:state.players[1-team],sig=[!!other,assetVersion].join();
 if(sig===lobbyRevision)return;
 lobbyRevision=sig;finishLobbyTurn();
 for(const record of lobbyActorRecords)disposeLobbyWeapon(record.actor);
 lobbyActorRecords.length=0;lobbyActors.clear();mixers.length=0;
 const slots=[{own:true,x:other?-1.1:0},...(other?[{own:false,x:1.1}]:[])];
 for(const {own,x} of slots){
  const actor=makeActor('swat',2.9);
  if(!actor)continue;
  actor.root.position.x=x;
  actor.root.rotation.y=actor.frontYaw+(lobbyRotationOffsets.get(own?'own':'opponent')||0);
  lobbyActors.add(actor.root);lobbyActorRecords.push({actor,own});
 }
}
function weaponIcon(key){const w=weapons[key];return w.model?`<img src="/assets/weapons/${w.model}.webp" alt="${w.name} 모양" loading="lazy">`:'<svg viewBox="0 0 56 40" aria-hidden="true"><path d="M6 28L32 4h15L22 28z M18 25l9 9"/></svg>';}
function weaponCard(key,onClick,active){const w=weapons[key],b=document.createElement('button');b.className='lobby-weapon'+(active?' active':'');b.dataset.weapon=key;b.setAttribute('aria-pressed',String(active));b.innerHTML=`<span class="weapon-slot">${w.category.toUpperCase()}${active?' · 장착 중':''}</span>${weaponIcon(key)}<strong>${w.name}</strong><span class="weapon-stats"><span>몸통 / 헤드 <b>${w.damage} / ${w.head}</b></span><span>연사 <b>${w.rpm} RPM</b></span><span>장탄 <b>${w.mag??'∞'}</b></span></span><small>${isSniper(key)?'Shift · 저격 스코프':key==='knife'?'근접 전용':aimProfiles[key].label+' · Shift'}</small>`;b.onclick=onClick;return b;}
function currentLoadout(){return team===null?{primary:chosen,secondary:chosenSecondary,melee:'knife'}:{primary:state.units[team].primary,secondary:state.units[team].secondary,melee:'knife'};}
let loadoutRevision='';
function renderLoadout(){const loadout=currentLoadout(),disabled=!!state.players[team]?.ready||startPending||state.phase==='results',revision=JSON.stringify([loadout,disabled]);if(revision===loadoutRevision)return;loadoutRevision=revision;$('lobby-weapons').replaceChildren();for(const slot of loadoutSlots){const key=loadout[slot.key],button=document.createElement('button');button.className='loadout-bar';button.dataset.slot=slot.key;button.disabled=disabled;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','weapon-picker');button.innerHTML=`<span class="loadout-bar-title"><b>${slot.name}</b><i>0${slot.number}</i></span>${weaponIcon(key)}<strong>${weapons[key].name}</strong><span class="loadout-change">선택 / 변경 ↗</span>`;button.onclick=()=>openWeaponPicker(slot);$('lobby-weapons').append(button);}}
function openWeaponPicker(slot){if(state.players[team]?.ready||startPending||state.phase==='results')return;const loadout=currentLoadout();$('weapon-picker-title').textContent=slot.name+' 선택';$('weapon-picker-help').textContent=slot.number+'번 키로 사용할 무기 · 아이콘을 눌러 장착하세요.';$('weapon-options').replaceChildren();for(const [key,w]of Object.entries(weapons)){if(w.slot!==slot.name)continue;$('weapon-options').append(weaponCard(key,()=>{if(team===null){if(slot.key==='primary')chosen=key;if(slot.key==='secondary')chosenSecondary=key;}else send({type:'equip',weapon:key});$('weapon-picker').close();displayLobby();},loadout[slot.key]===key));}$('weapon-picker').showModal();}
$('close-weapon-picker').onclick=()=>$('weapon-picker').close();$('weapon-picker').addEventListener('click',e=>{if(e.target===$('weapon-picker')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
function displayLobby(){
 const previousScreen=screen,connected=team!==null&&!!state.players[team],waitingForResult=connected&&state.phase==='results'&&!!state.resultsConfirmed?.[team];
 if(connected)screen=state.phase==='results'&&!waitingForResult?'results':['intro','countdown','battle'].includes(state.phase)?'battle':'lobby';else if(['lobby','battle','results'].includes(screen))screen='menu';
 syncBackgroundMusic();if(screen!=='lobby')finishLobbyTurn();entered=screen!=='title';const battle=screen==='battle';document.body.dataset.screen=screen;
 for(const [id,value]of [['title-screen','title'],['menu-screen','menu'],['rooms-screen','rooms'],['private-screen','private'],['lobby','lobby'],['battle-main','battle'],['results-screen','results']])$(id).hidden=screen!==value;
 document.querySelector('header').hidden=screen!=='lobby';document.querySelector('footer').hidden=true;$('chat-panel').hidden=screen!=='lobby'&&!battle;
 const chatAnchor=$(battle?'battle-chat-anchor':'lobby-chat-anchor');if($('chat-panel').parentElement!==chatAnchor)chatAnchor.append($('chat-panel'));
 if(screen==='lobby'||battle){const parent=$(battle?'viewport':'lobby-viewport');if(renderer.domElement.parentElement!==parent){parent.append(renderer.domElement);requestAnimationFrame(resize);}}
 for(const id of ['browser-create','open-public','open-private','menu-ai','menu-back','rooms-back','private-back','refresh-rooms'])$(id).disabled=connecting;
 $('room-player-name').disabled=connecting;$('code-join').querySelector('button').disabled=connecting;$('private-room-code').disabled=connecting;
 const me=team===null?null:state.players[team],other=team===null?null:state.players[1-team];$('lobby-coins').textContent=`◉ ${team===null?300:state.units[team].coins}`;$('display-name').textContent=me?.name||profileName||'이름을 설정하세요';$('own-label').textContent=me?.name||profileName||'나의 오퍼레이터';$('own-ready').textContent=me?.ready?'READY / 준비 완료':me?'대기 중':'접속 전';$('opponent-label').hidden=!other;$('enemy-name').textContent=other?.name||'';$('enemy-ready').textContent=other?.ready?'READY / 준비 완료':'입장 · 준비 중';$('lobby').classList.toggle('has-opponent',!!other);
 const mode=me?state.mode:chosenMode,humans=state.players.filter(p=>p&&!p.isBot).length;for(const value of ['ai','pvp']){const b=$('mode-'+value);b.setAttribute('aria-pressed',String(mode===value));b.disabled=waitingForResult||!!me&&(team!==0||(value==='ai'&&humans>1));}$('mode-hint').textContent=humans>1?'두 명 접속 · PVP 대전':mode==='ai'?'혼자 플레이 · 순찰/교전 AI':'같은 방 코드로 친구를 초대하세요';$('launch-help').textContent=waitingForResult?'상대가 결과를 확인하면 다음 경기를 시작할 수 있습니다.':mode==='ai'?'게임 시작을 누르면 AI와 바로 전투':'두 플레이어 모두 준비하면 전투 시작';
 $('lobby-status').textContent=waitingForResult?'상대가 전투 결과를 확인하고 있습니다. 잠시 기다려 주세요.':!assetsReady?'맵과 캐릭터를 불러오는 중입니다.':startPending?'AI 전투에 접속하는 중입니다…':!me?(mode==='ai'?'게임 시작을 누르면 AI 훈련에 바로 접속합니다.':'이름을 저장한 뒤 같은 방으로 접속하세요.'):!other?'상대 접속을 기다리는 중입니다.':other.isBot?'AI 준비 완료 · 게임 시작을 눌러 주세요.':me.ready?'상대의 준비를 기다리는 중입니다.':`${other.name} 님이 입장했습니다. 시작을 눌러 주세요.`;
 $('start-game').disabled=waitingForResult||!assetsReady||startPending||(mode==='pvp'&&(!me||!other));$('start-game').innerHTML=`<span>REAL-TIME FPS / 3 LIVES</span>${waitingForResult?'상대 확인 대기':startPending?'접속 중…':!assetsReady?'에셋 로딩 중…':me?.ready?'준비 취소':'게임 시작'} ↗`;$('leave-room').disabled=connecting;
 if(waitingForResult){$('own-ready').textContent='로비 대기 중';$('enemy-ready').textContent='전투 결과 확인 중';}$('edit-name').disabled=waitingForResult;
 renderLoadout();rebuildLobby();
 if(screen!=='lobby'&&$('weapon-picker').open)$('weapon-picker').close();if(battle&&!inBattle)startBattle();if(!battle&&inBattle)leaveBattle();if(screen==='results'){updateMatchResults();if(previousScreen!=='results')requestAnimationFrame(()=>{if(screen==='results')$('result-confirm').focus({preventScroll:true});});}syncRenderLoop();
}
function send(a){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(a));}
$('press-start').onclick=()=>{if(screen!=='title')return;spatialAudio.unlock();showScreen('menu');};
$('edit-name').onclick=()=>{$('profile-form').hidden=false;$('player-name').focus();};
$('profile-form').onsubmit=e=>{e.preventDefault();const name=$('player-name').value.trim();if(!name||Array.from(name).length>12)return;profileName=name;$('room-player-name').value=name;try{localStorage.setItem('vector-name',name);}catch{}if(team!==null)send({type:'profile',name});$('profile-form').hidden=true;displayLobby();if(startPending){startPending=false;launchGame();}};
function connectRoom(autoStart=false,options={}){
 if(!profileName||connecting||socket&&socket.readyState<2)return;
 const request={type:'join',room:$('room').value.trim(),name:profileName,weapon:chosen,primary:chosen,secondary:chosenSecondary,mode:chosenMode,...options};
 connecting=true;connectionNotice='';startPending=autoStart;socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);const current=socket;
 $('connection').textContent='● CONNECTING';setNavigationStatus('방에 접속하는 중…');displayLobby();
 current.onopen=()=>{if(current===socket)send(request);};
 current.onmessage=e=>{if(current!==socket)return;const m=JSON.parse(e.data);
  if(m.type==='chatHistory'){ $('chat-messages').replaceChildren();for(const message of m.messages)addChat(message);}
  if(m.type==='chat')addChat(m.message);
  if(m.type==='joined'){ $('chat-messages').replaceChildren();$('chat-input').value='';team=m.team;$('connection').textContent='● ONLINE';}
  if(m.type==='state'){if(Number.isFinite(m.serverTime))serverClockOffset=m.serverTime-Date.now();connecting=false;receive(m.state);if(startPending){startPending=false;if(m.state.mode==='ai'&&m.state.phase==='lobby'&&m.state.players[1]?.isBot)send({type:'ready'});displayLobby();}}
  if(m.type==='error'||m.type==='closed'){startPending=false;connectionNotice=m.message;setNavigationStatus(m.message);$('lobby-status').textContent=m.message;$('match-notice').textContent=m.message;$('shop-status').textContent=m.message;$('chat-status').textContent=m.message;if(team===null)current.close();}
 };
 current.onclose=()=>{if(current!==socket)return;connecting=false;startPending=false;finishLobbyTurn();lobbyRotationOffsets.clear();lobbyRevision='';team=null;state=initial();pending=[];resultReturnPending=false;$('profile-form').hidden=true;$('connection').textContent='● OFFLINE';displayLobby();setNavigationStatus(connectionNotice);};
 current.onerror=()=>{connectionNotice='서버에 연결할 수 없습니다. 잠시 후 다시 참가하세요.';setNavigationStatus(connectionNotice);};
}
for(const mode of ['ai','pvp'])$('mode-'+mode).onclick=()=>{if(team===null){chosenMode=mode;displayLobby();}else send({type:'mode',mode});};
$('return-lobby').onclick=()=>send({type:'leaveMatch'});
function launchGame(){if(!assetsReady||startPending||state.phase==='results')return;if(team!==null){send({type:'ready'});return;}if(chosenMode!=='ai')return;if(!profileName){startPending=true;$('profile-form').hidden=false;$('player-name').focus();return;}$('room').value='AI_'+crypto.randomUUID().replaceAll('-','').slice(0,18);connectRoom(true,{private:true,createOnly:true});}
$('start-game').onclick=launchGame;
function updateMatchResults(){
 if(team===null||state.winner===null)return;
 const won=state.winner===team,own=state.scores[team],enemy=state.scores[1-team];
 $('results-screen').dataset.outcome=won?'victory':'defeat';
 setHUDText('result-title',won?'VICTORY':'DEFEAT');setHUDText('result-message',won?'승리했습니다! 상대의 모든 목숨을 소진시켰습니다.':'패배했습니다. 다음 전투에서 다시 도전하세요.');
 setHUDText('result-mode',state.mode==='ai'?'AI TRAINING · 1 VS 1':'PVP · 1 VS 1');
 const name=state.players[team]?.name||'OPERATOR';setHUDText('result-player-name',name+' · 전투 보고서');
 setHUDText('result-kills',own.kills);setHUDText('result-deaths',own.deaths);
 setHUDText('result-own-name',name+' (나)');setHUDText('result-own-kills',own.kills);setHUDText('result-own-deaths',own.deaths);
 setHUDText('result-enemy-name',state.players[1-team]?.name||'상대');setHUDText('result-enemy-kills',enemy.kills);setHUDText('result-enemy-deaths',enemy.deaths);
 $('result-confirm').disabled=resultReturnPending;setHUDText('result-confirm',resultReturnPending?'로비로 이동 중…':'확인 · 로비로');
}
$('result-confirm').onclick=()=>{if(resultReturnPending||state.phase!=='results'||socket?.readyState!==WebSocket.OPEN)return;resultReturnPending=true;updateMatchResults();send({type:'confirmResult'});};

function finishMatchPreparation(){
 if(state.phase!=='battle'||team===null)return;
 keys.clear();fire=false;scoped=false;touchScope=false;jump=interact=false;pending=[];
 predicted={...state.units[team]};yaw=predicted.yaw;pitch=predicted.pitch;
 touch.active=matchMedia('(pointer:coarse)').matches;dragMode=!touch.active&&document.pointerLockElement!==renderer.domElement;
 $('battle-main').classList.remove('preparing');$('capture-overlay').hidden=true;$('return-lobby').disabled=false;
 introGoUntil=performance.now()+1100;
}
function updateStartAnnouncement(time){
 const overlay=$('match-intro');overlay.hidden=time>=introGoUntil;
 if(overlay.hidden)return;
 overlay.dataset.stage='go';$('intro-number').hidden=false;$('intro-progress').hidden=true;
 setHUDText('intro-number','게임 시작!');
 if(lastCountdownBeat!=='GO'){lastCountdownBeat='GO';spatialAudio.playCountdownImpact(true);}
}
function renderMatchPreparation(time){
 const overlay=$('match-intro'),u=state.units[team];overlay.hidden=false;viewModel.visible=false;
 $('battle-main').classList.add('preparing');$('capture-overlay').hidden=true;$('return-lobby').disabled=true;
 for(const shield of spawnShields.values())shield.visible=false;
 for(const [id,actor]of actorObjects){const unit=state.units[id];actor.root.position.set(unit.x,unit.y,unit.z);actor.root.rotation.y=unit.yaw+Math.PI;updateRemoteCombat(actor,unit,weaponAssets,remoteNow());}
 for(const d of state.doors){const mesh=doorObjects.get(d.id);mesh.userData.angle=d.open?1:0;mesh.rotation.y=mesh.userData.base+mesh.userData.angle*Math.PI/2*(d.axis==='z'?-d.nz:d.nx);}
 syncBattleProps(time);
 if(state.phase==='intro'){
  if(introFrameAt)introViewElapsed=Math.min(5,introViewElapsed+Math.min((time-introFrameAt)/1000,.25));introFrameAt=time;
  const progress=introViewElapsed/5,angle=-Math.PI*.7+progress*Math.PI*.9,scale=Math.max(1,1.2/flyoverCamera.aspect);
  flyoverCamera.position.set(Math.sin(angle)*18*scale,(16-2*Math.sin(progress*Math.PI))*scale,Math.cos(angle)*18*scale);flyoverCamera.lookAt(0,1,0);
  overlay.dataset.stage=progress<1?'flyover':'waiting';$('intro-number').hidden=true;$('intro-progress').hidden=false;
  $('intro-progress-fill').style.transform=`scaleX(${progress})`;
  setHUDText('intro-title',progress<1?'작전 지역 정찰':'정찰 완료 · 상대 준비 대기');
  setHUDText('intro-caption','맵 정찰 5초 · 이동과 공격은 시작 신호 후에 가능합니다.');
  if(progress>=1&&!state.introReady[team]&&time-introReadySentAt>=500){introReadySentAt=time;send({type:'introReady'});}
  renderer.render(scene,flyoverCamera);return;
 }
 overlay.dataset.stage='countdown';$('intro-number').hidden=false;$('intro-progress').hidden=true;
 const beat=String(clamp(Math.ceil((state.battleStartsAt-remoteNow())/1000),1,3));
 setHUDText('intro-title','전투 시작 준비');setHUDText('intro-number',beat);setHUDText('intro-caption','시작 신호를 기다리세요.');
 if(lastCountdownBeat!==beat){lastCountdownBeat=beat;spatialAudio.playCountdownImpact();}
 camera.position.set(u.x,u.y+EYE,u.z);camera.rotation.set(u.pitch,u.yaw,0,'YXZ');if(camera.fov!==80){camera.fov=80;camera.updateProjectionMatrix();}
 renderer.render(scene,camera);
}
$('match-intro').addEventListener('pointerdown',()=>{if(isMatchPreparing())capture();});
function startBattle(){spatialAudio.unlock();for(const mark of impactObjects.values()){impactLayer.remove(mark);mark.geometry.dispose();}impactObjects.clear();inBattle=true;introViewElapsed=0;introFrameAt=0;introReadySentAt=-Infinity;introGoUntil=0;lastCountdownBeat=null;dragMode=false;dragAim=null;touch.active=false;touch.forward=touch.strafe=0;jump=interact=false;lastEvent=state.clock;pending=[];predicted={...state.units[team]};yaw=predicted.yaw;pitch=predicted.pitch;actorObjects.clear();const enemy=makeActor('swat',1.75,'battle');if(enemy){const idleClip=assets.swat.animations.find(c=>c.name.endsWith('|Idle_Gun_Pointing'));if(idleClip){enemy.mixer.stopAllAction();enemy.idle=enemy.mixer.clipAction(idleClip);enemy.idle.reset().play();}scene.add(enemy.root);actorObjects.set(1-team,enemy);}scoped=false;viewWeapon='';$('capture-overlay').hidden=isMatchPreparing();$('capture-title').textContent='실시간 1인칭 전투';$('capture-help').textContent='WASD 이동 · 마우스 조준 · 터치패드 탭/클릭으로 발사 · SPACE 점프';$('battle-main').classList.toggle('preparing',isMatchPreparing());$('match-intro').hidden=!isMatchPreparing();$('return-lobby').disabled=isMatchPreparing();document.activeElement?.blur?.();if(!isMatchPreparing())finishMatchPreparation();updateHUD();}
function leaveBattle(){$('match-intro').hidden=true;$('battle-main').classList.remove('preparing');$('return-lobby').disabled=false;introGoUntil=0;lastCountdownBeat=null;dragAim=null;inBattle=false;fire=false;sprintRequested=false;moveBlend=runBlend=0;keys.clear();pending=[];scoped=false;predicted=null;for(const actor of actorObjects.values()){disposeRemoteCombat(actor);scene.remove(actor.root);const index=mixers.indexOf(actor.mixer);if(index>=0)mixers.splice(index,1);}actorObjects.clear();document.exitPointerLock?.();$('death-overlay').hidden=true;}
function receive(next){const previousPhase=state.phase,wasDead=state.units[team]?.hp<=0,oldHp=state.units[team]?.hp;state=next;if(state.phase!=='results'||state.resultsConfirmed?.[team])resultReturnPending=false;setCrates(state.crates);setDoors(state.doors);if(state.phase!=='battle'){if(!isMatchPreparing()||!inBattle)displayLobby();return;}if(!inBattle){displayLobby();return;}if(previousPhase!=='battle')finishMatchPreparation();
 const own=state.units[team];if(own.ladder!==null)scoped=false;pending=pending.filter(i=>i.seq>own.ack);predicted={...own};for(const input of pending)moveBody(predicted,input);if(!wasDead&&own.hp<=0){$('shop-status').textContent='';keys.clear();fire=false;scoped=false;touchScope=false;$('capture-overlay').hidden=true;}if(wasDead&&own.hp>0){$('capture-overlay').hidden=true;if(!document.pointerLockElement&&!touch.active)dragMode=true;if($('respawn-shop').contains(document.activeElement))document.activeElement.blur();yaw=own.yaw;pitch=own.pitch;pending=[];predicted={...own};}if(oldHp!==undefined&&own.hp<oldHp)damageUntil=performance.now()+250;
 for(const e of state.events){if(e.id<=lastEvent)continue;lastEvent=e.id;if(e.type==='shot'){if(e.actor===team){if(e.weapon!=='knife'){recoil=1;muzzle.intensity=4;}}if(e.weapon!=='knife')spatialAudio.play(weapons[e.weapon]?.category==='smg'?'rifle':weapons[e.weapon]?.category||e.weapon,[e.x,e.y,e.z],e.actor===team?.8:1);}if(e.type==='footstep')spatialAudio.play(Math.random()<.5?'step1':'step2',[e.x,e.y,e.z],e.actor===team?.35:.8);if(e.type==='grenadeWindup'){spatialAudio.play('throw',[e.x,e.y,e.z],.6);if(e.actor===team){scoped=false;sprintRequested=false;buildViewWeapon('grenade');}}if(e.type==='purchase'&&e.actor===team){$('shop-status').textContent='구매 완료 · 50코인 차감';sound('hit');}if(e.type==='melee'){const remote=actorObjects.get(e.actor);if(remote)remote.remoteMeleeUntil=remoteNow()+380;if(e.actor===team){meleeStarted=performance.now();meleeUntil=meleeStarted+380;recoil=0;muzzle.intensity=0;buildViewWeapon('knife');}else{const actor=actorObjects.get(e.actor);const slash=actor?.directional.Sword_Slash;if(slash){actor.mixer.stopAllAction();slash.setLoop(THREE.LoopOnce,1);slash.clampWhenFinished=true;slash.reset().play();actor.attackUntil=performance.now()+500;actor.currentAction='Sword_Slash';}}}if(e.type==='hit'&&e.actor===team&&e.target!==team){hitUntil=performance.now()+140;sound('hit');}if(e.type==='loot'&&e.actor===team){$('match-notice').textContent=e.loot==='life'?'목숨 +1 획득':'예비 탄약 +30 획득';lootMessage=e.loot==='life'?'목숨 +1 획득':'예비 탄약 +30 획득';lootUntil=performance.now()+2000;sound('hit');}if(e.type==='explosion'){const flash=new THREE.Mesh(new THREE.SphereGeometry(.5,8,6),new THREE.MeshBasicMaterial({color:0xffb548,transparent:true,opacity:.7}));flash.position.set(e.x,e.y,e.z);scene.add(flash);setTimeout(()=>{scene.remove(flash);flash.geometry.dispose();flash.material.dispose();},250);spatialAudio.play('explosion',[e.x,e.y,e.z],1);}}
 syncImpacts();updateHUD();}
function buildViewWeapon(key){adsBlend=0;muzzle.position.set(isSidearm(key)?.175:.25,isSidearm(key)?-.175:-.25,isSniper(key)?-1.18:isSidearm(key)?-.65:-.93);viewWeapon=key;heldGrenade=magazine=bolt=supportHand=null;viewModel.position.set(0,0,0);viewModel.rotation.set(0,0,0);viewModel.scale.setScalar(1);viewModel.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});viewModel.clear();
 if(key==='grenade'){const hand=new THREE.Group();hand.position.set(.08,-.26,-.5);viewModel.add(hand);heldGrenade=createHeldGrenade();heldGrenade.position.y=.04;hand.add(heldGrenade);const palm=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshLambertMaterial({color:0x394744}));palm.scale.set(.052,.064,.036);palm.position.set(0,-.025,.025);hand.add(palm);const wrist=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.11,3,8),new THREE.MeshLambertMaterial({color:0x2d3b38}));wrist.rotation.x=Math.PI/2;wrist.position.set(0,-.06,.12);hand.add(wrist);for(let i=0;i<4;i++){const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.012,.065,3,6),new THREE.MeshLambertMaterial({color:0x54645b}));finger.rotation.z=Math.PI/2;finger.position.set(.005,.055-i*.022,-.045);hand.add(finger);}supportHand=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshLambertMaterial({color:0x3d4d44}));supportHand.scale.set(.045,.05,.035);supportHand.position.set(-.05,-.16,-.46);viewModel.add(supportHand);supportHand.userData.rest=supportHand.position.clone();return;}
 if(key==='knife'){box(viewModel,.045,.05,.55,0xbbced7,.25,-.28,-.55);box(viewModel,.12,.045,.08,0x29372e,.25,-.28,-.27);}else if(weaponAssets[key]){const gun=createWeaponModel(weaponAssets[key],key),side=isSidearm(key),x=side?.175:.25;gun.position.set(x,side?-.175:-.25,isSniper(key)?-1.18:side?-.65:-.93);viewModel.add(gun);magazine=box(viewModel,.065,.17,.11,0x26343b,x,-.39,-.43);magazine.visible=false;magazine.userData.rest=magazine.position.clone();bolt=box(viewModel,.04,.025,.055,0x68737c,x+.08,-.21,-.46);bolt.visible=false;bolt.userData.rest=bolt.position.clone();}
 box(viewModel,.13,.15,.27,0x8d7560,.25,-.43,-.25);supportHand=box(viewModel,.12,.13,.22,0x967c62,.12,-.37,-.58);supportHand.userData.rest=supportHand.position.clone();}

function beginLobbyTurn(e){
 if(screen!=='lobby'||lobbyDrag||e.button!==0&&e.pointerType!=='touch'||e.target.closest('button,input,textarea,select,form,dialog,a,#chat-panel,.lobby-profile,#lobby-join,.mode-selector,.lobby-bottom,.lobby-heading'))return;
 const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height||e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
 lobbyCamera.updateMatrixWorld(true);lobbyActors.updateMatrixWorld(true);
 let record=null,nearest=Infinity;
 // Use the displayed character centres, not animated triangle hit tests, to pick a preview.
 for(const candidate of lobbyActorRecords){const point=candidate.actor.root.localToWorld(new THREE.Vector3(0,candidate.actor.height*.5,0)).project(lobbyCamera);const x=rect.left+(point.x*.5+.5)*rect.width,distance=Math.abs(e.clientX-x);if(distance<nearest){nearest=distance;record=candidate;}}
 if(!record)return;const surface=$('lobby');lobbyDrag={id:e.pointerId,x:e.clientX,record,surface};surface.setPointerCapture?.(e.pointerId);surface.classList.add('turning');renderer.domElement.classList.add('turning');$('lobby-rotation-hint').textContent=record.own?'내 캐릭터 회전 중':'상대 캐릭터 회전 중';e.preventDefault();
}
function moveLobbyTurn(e){if(lobbyDrag?.id!==e.pointerId)return;if(screen!=='lobby'||!lobbyActorRecords.includes(lobbyDrag.record)){finishLobbyTurn();return;}const record=lobbyDrag.record,key=record.own?'own':'opponent',offset=(lobbyRotationOffsets.get(key)||0)+(e.clientX-lobbyDrag.x)*.009;lobbyRotationOffsets.set(key,Math.atan2(Math.sin(offset),Math.cos(offset)));record.actor.root.rotation.y=record.actor.frontYaw+lobbyRotationOffsets.get(key);lobbyDrag.x=e.clientX;e.preventDefault();}
function finishLobbyTurn(){if(!lobbyDrag)return;const {id,surface}=lobbyDrag;lobbyDrag=null;surface.classList.remove('turning');renderer.domElement.classList.remove('turning');if(surface.hasPointerCapture?.(id))surface.releasePointerCapture(id);$('lobby-rotation-hint').textContent='캐릭터를 좌우로 드래그해 회전';}
$('lobby').addEventListener('pointerdown',beginLobbyTurn,{passive:false});
window.addEventListener('pointermove',moveLobbyTurn,{passive:false});
window.addEventListener('pointercancel',e=>{if(lobbyDrag?.id===e.pointerId)finishLobbyTurn();});
$('lobby').addEventListener('lostpointercapture',e=>{if(lobbyDrag?.id===e.pointerId)finishLobbyTurn();});
function activeControl(){return state.phase==='battle'&&!document.hidden&&document.activeElement!==$('chat-input')&&inBattle&&(document.pointerLockElement===renderer.domElement||dragMode||touch.active)&&state.units[team]?.hp>0&&state.winner===null;}
function swap(key){if(!inBattle||state.phase!=='battle')return;scoped=false;send({type:'equip',weapon:key});}
function slot(n){const u=state.units[team];if(u)swap(n===1?u.primary:n===2?u.secondary:'knife');}
function command(type){if(activeControl())send({type});}
async function capture(){if(!inBattle)return;spatialAudio.unlock();if(matchMedia('(pointer: coarse)').matches){touch.active=true;$('capture-overlay').hidden=true;return;}try{await renderer.domElement.requestPointerLock();}catch{$('capture-help').textContent='브라우저가 마우스 잠금을 차단했습니다. 새 탭에서 게임 링크를 열거나 드래그 조작을 사용하세요.';$('fallback-mouse').hidden=false;}}
$('capture-mouse').onclick=capture;$('fallback-mouse').onclick=()=>{dragMode=true;$('capture-overlay').hidden=true;};
document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===renderer.domElement;if(inBattle){$('capture-overlay').hidden=isMatchPreparing()||state.units[team]?.hp<=0||state.winner!==null||locked||dragMode||touch.active;if(!locked){fire=false;keys.clear();}}});
document.addEventListener('mousemove',e=>{if(state.phase!=='battle'||document.pointerLockElement!==renderer.domElement)return;yaw-=e.movementX*(scoped?(isSniper(state.units[team]?.weapon)?.00055:.0012):.002);pitch=clamp(pitch-e.movementY*(scoped?(isSniper(state.units[team]?.weapon)?.00055:.0012):.002),-1.48,1.48);});
document.addEventListener('keydown',e=>{if(!entered&&(e.key==='Enter'||e.code==='Space')){e.preventDefault();$('press-start').click();return;}if(screen==='battle'&&isMatchPreparing()){if(!e.ctrlKey&&!e.metaKey)e.preventDefault();return;}if(/INPUT|TEXTAREA/.test(e.target.tagName))return;if((screen==='lobby'||screen==='battle')&&e.code==='KeyM'){e.preventDefault();focusChat();return;}if(!inBattle)return;if(state.units[team]?.hp<=0&&state.winner===null&&/^Digit[123]$/.test(e.code)){e.preventDefault();if(!e.repeat)$('buy-'+['damage','shield','reveal'][Number(e.code.slice(-1))-1]).click();return;}if(['Space','ArrowUp','ArrowDown','Enter','NumpadEnter'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyW'){const now=performance.now();if(now-lastWDown<280)sprintRequested=true;lastWDown=now;}if(e.code==='Space')jump=true;if(e.code==='KeyF')interact=true;if(e.code==='KeyR')command('reload');if(e.code==='KeyV')command('melee');if(e.code==='KeyG')command('grenade');if(/^Digit[123]$/.test(e.code))slot(Number(e.code.slice(-1)));if(e.code==='Escape'){dragMode=false;touch.active=false;fire=false;$('capture-overlay').hidden=state.units[team]?.hp<=0;}inputFrame();});
document.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='KeyW')sprintRequested=false;inputFrame();});window.addEventListener('blur',()=>{finishLobbyTurn();keys.clear();sprintRequested=false;scoped=false;touchScope=false;fire=false;touch.forward=touch.strafe=0;});
renderer.domElement.addEventListener('pointerdown',e=>{if(screen==='lobby')return;if(!inBattle)return;if(e.pointerType==='touch'){touch.active=true;dragAim={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);return;}if(e.button===0&&activeControl()){if(dragMode&&document.pointerLockElement!==renderer.domElement)capture();fire=true;inputFrame();if(dragMode){dragAim={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);}}});
renderer.domElement.addEventListener('pointermove',e=>{if(state.phase!=='battle'||!dragAim||dragAim.id!==e.pointerId)return;yaw-=(e.clientX-dragAim.x)*.004;pitch=clamp(pitch-(e.clientY-dragAim.y)*.004,-1.48,1.48);dragAim.x=e.clientX;dragAim.y=e.clientY;});
window.addEventListener('pointerup',e=>{if(lobbyDrag?.id===e.pointerId)finishLobbyTurn();if(e.button===0){fire=false;inputFrame();}if(dragAim?.id===e.pointerId)dragAim=null;});renderer.domElement.addEventListener('pointercancel',()=>{finishLobbyTurn();fire=false;dragAim=null;inputFrame();});renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('wheel',e=>{if(!activeControl())return;e.preventDefault();const u=state.units[team],list=[u.primary,u.secondary,'knife'];swap(list[(list.indexOf(u.weapon)+(e.deltaY>0?1:2))%3]);},{passive:false});
$('touch-fire').onpointerdown=e=>{e.preventDefault();touch.active=true;fire=true;inputFrame();e.target.setPointerCapture(e.pointerId);};$('touch-fire').onpointerup=()=>{fire=false;inputFrame();};$('touch-fire').onpointercancel=()=>{fire=false;inputFrame();};
$('touch-interact').onclick=()=>{interact=true;inputFrame();};$('touch-jump').onclick=()=>{jump=true;};$('touch-reload').onclick=()=>command('reload');$('touch-melee').onclick=()=>command('melee');$('touch-grenade').onclick=()=>command('grenade');$('touch-scope').onpointerdown=e=>{e.preventDefault();touchScope=true;touch.active=true;e.target.setPointerCapture(e.pointerId);inputFrame();};for(const type of ['pointerup','pointercancel'])$('touch-scope').addEventListener(type,()=>{touchScope=false;inputFrame();});
$('joystick').onpointerdown=e=>{touch.active=true;e.currentTarget.setPointerCapture(e.pointerId);};$('joystick').onpointermove=e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const r=e.currentTarget.getBoundingClientRect();touch.strafe=clamp((e.clientX-r.left-r.width/2)/40,-1,1);touch.forward=clamp(-(e.clientY-r.top-r.height/2)/40,-1,1);e.currentTarget.firstElementChild.style.transform=`translate(${touch.strafe*25}px,${-touch.forward*25}px)`;};for(const type of ['pointerup','pointercancel'])$('joystick').addEventListener(type,()=>{touch.forward=touch.strafe=0;$('joystick').firstElementChild.style.transform='';});
function inputFrame(){if(state.phase!=='battle'||!inBattle||!predicted||socket?.readyState!==WebSocket.OPEN||state.winner!==null)return;if(predicted.ladder!==null)scoped=false;const enabled=activeControl();scoped=enabled&&canAim(state.units[team]?.weapon)&&!state.units[team].reloadUntil&&!state.units[team].throwUntil&&performance.now()>=meleeUntil&&predicted.ladder===null&&(touchScope||keys.has('ShiftLeft')||keys.has('ShiftRight'));if(scoped||fire||state.units[team].reloadUntil||state.units[team].throwUntil||predicted.ladder!==null)sprintRequested=false;const input={type:'input',seq:++seq,yaw,pitch,forward:enabled?touch.forward+(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0):0,strafe:enabled?touch.strafe+(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0):0,jump:enabled&&jump,interact:enabled&&interact,sprint:enabled&&!scoped&&!fire&&!state.units[team].reloadUntil&&!state.units[team].throwUntil&&(sprintRequested||(state.units[team]?.weapon==='knife'&&(keys.has('ShiftLeft')||keys.has('ShiftRight')))),fire:enabled&&fire,scoped};jump=false;interact=false;send(input);pending.push(input);if(pending.length>90)pending.shift();moveBody(predicted,input);spatialAudio.updateListener(predicted,yaw,pitch);}
// Bake the unchanged map once; only the local player's marker is redrawn.
const radarCanvas=$('minimap'),radarContext=radarCanvas.getContext('2d',{alpha:false});
let radarBackground;
try{radarBackground=new OffscreenCanvas(radarCanvas.width,radarCanvas.height);}catch{}
if(!radarBackground?.getContext('2d')){radarBackground=document.createElement('canvas');radarBackground.width=radarCanvas.width;radarBackground.height=radarCanvas.height;}
const radarBackgroundContext=radarBackground.getContext('2d',{alpha:false}),minimapImage=new Image();
let radarDirty=true,lastRadarAt=0,lastRadarSignature='',weaponStripRevision='';
function cacheRadarBackground(){
 const ctx=radarBackgroundContext,width=radarBackground.width,height=radarBackground.height;
 ctx.fillStyle='#233331';ctx.fillRect(0,0,width,height);
 if(minimapImage.complete&&minimapImage.naturalWidth)ctx.drawImage(minimapImage,0,0,width,height);
 else{ctx.fillStyle='#78877f';for(const w of mapData.walls)ctx.fillRect(w.x*8,w.z*8,8,8);}
 radarDirty=true;
}
minimapImage.onload=cacheRadarBackground;minimapImage.src='/assets/minimap.webp';cacheRadarBackground();
function radar(){
 if(team===null)return;
 const u=predicted||state.units[team],angle=predicted?yaw:u.yaw,signature=[team,u.x,u.z,angle].join();
 if(!radarDirty&&signature===lastRadarSignature)return;
 radarDirty=false;lastRadarSignature=signature;
 const ctx=radarContext,x=(u.x+12)*8,z=(u.z+8)*8,color=team===0?'#75cbff':'#ff8877';
 ctx.drawImage(radarBackground,0,0);setHUDText('minimap-player-label','내 위치 · '+(team===0?'BLUE':'RED'));
 ctx.save();ctx.translate(x,z);ctx.rotate(-angle);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(-3,-4);ctx.lineTo(3,-4);ctx.closePath();ctx.fill();ctx.restore();ctx.beginPath();ctx.arc(x,z,4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#fff';ctx.stroke();
}
function updateHUD(){
 if(team===null)return;
 const u=state.units[team],enemy=state.units[1-team],w=weapons[u.weapon];
 setHUDText('battle-mode',state.mode==='ai'?'DEATH MATCH / AI TRAINING':'DEATH MATCH / PVP');
 setHUDText('battle-coins',`◉ ${u.coins}`);setHUDText('battle-name',state.players[team]?.name||'OPERATOR');
 setHUDText('lives',Array.from({length:Math.max(3,Math.min(u.lives,7))},(_,i)=>i<u.lives?'♥':'♡').join(' ')+(u.lives>7?` +${u.lives-7}`:''));
 setHUDText('life-label',`남은 목숨 ${u.lives} · 시작 3개`);setHUDText('enemy-lives',`상대 목숨 ${enemy.lives}`);
 setHUDText('hp-text',`${u.hp}${u.armor>0?' + 보호막 '+u.armor:''}`);
 const hpWidth=u.hp+'%';if($('hp-fill').style.width!==hpWidth)$('hp-fill').style.width=hpWidth;
 setHUDText('grenade-count',`G 수류탄 ${u.grenades}`);setHUDText('equipped-name',w.name);
 setHUDText('ammo-current',w.mag===null?'∞':u.ammo[u.weapon]);setHUDText('ammo-max',w.mag===null?' / 근접':` / ${w.mag}`);
 setHUDText('reload-status',u.reloadUntil?'재장전 중…':u.throwUntil?'수류탄 투척 중…':w.mag!==null&&u.ammo[u.weapon]===0&&u.reserve[u.weapon]===0?'탄약 없음 · 무기 교체 / 보급 상자':`R 재장전 · 예비탄 ${u.reserve[u.weapon]??'—'}`);
 if(!canAim(u.weapon)||u.reloadUntil||u.throwUntil||u.hp<=0)scoped=false;
 const desiredView=u.throwUntil>remoteNow()?'grenade':performance.now()<meleeUntil?'knife':u.weapon;
 if(viewWeapon!==desiredView)buildViewWeapon(desiredView);
 const stripRevision=[u.primary,u.secondary,u.weapon].join();
 if(stripRevision!==weaponStripRevision){
  weaponStripRevision=stripRevision;$('weapon-strip').replaceChildren();
  for(const [i,key] of [u.primary,u.secondary,'knife'].entries()){const b=document.createElement('button');b.textContent=`${i+1} ${weapons[key].name}`;b.className=u.weapon===key?'selected':'';b.onclick=()=>swap(key);$('weapon-strip').append(b);}
 }
 $('death-overlay').hidden=u.hp>0&&state.winner===null;
 if(state.winner!==null){setHUDText('death-title',state.winner===team?'VICTORY':'DEFEAT');setHUDText('death-text','전투 종료 · 전투 결과를 확인하세요.');fire=false;if(document.pointerLockElement)document.exitPointerLock?.();}
 else if(u.hp<=0){setHUDText('death-title','DOWN');setHUDText('death-text',`${Math.max(0,(u.respawnAt-Date.now())/1000).toFixed(1)}초 후 자동 부활 · 확인 없이 전투 재개 · 남은 목숨 ${u.lives}`);fire=false;}
 $('respawn-shop').hidden=u.hp>0||state.winner!==null||u.lives<=0;setHUDText('shop-coins',`◉ ${u.coins}`);
 for(const item of ['damage','shield','reveal']){const button=$('buy-'+item);button.disabled=!!u.pendingUpgrades[item]||u.coins<50;button.classList.toggle('purchased',!!u.pendingUpgrades[item]);}
 setHUDText('match-notice',performance.now()<lootUntil?lootMessage:u.shieldUntil>Date.now()?`부활 보호 ${Math.max(0,(u.shieldUntil-Date.now())/1000).toFixed(1)}초`:u.reloadUntil?'재장전 중…':u.ladder!==null?'F 놓기 · W/S 오르내리기 · Space 뛰어내리기':nearLadder(u)?'F 사다리 잡기':state.doors.some(d=>!d.open&&Math.hypot(u.x-d.x,u.z-d.z)<1.6)?'W 문 열고 이동':'');
}
for(const item of ['damage','shield','reveal'])$('buy-'+item).onclick=()=>{$('shop-status').textContent='';send({type:'buy',item});};
for(const id of ['audio-toggle','lobby-audio-toggle'])$(id).onclick=()=>{spatialAudio.unlock();spatialAudio.setMuted(!spatialAudio.muted);syncBackgroundMusic(true);};
let lootMessage='',lootUntil=0;
const spawnShields=new Map();for(const id of [0,1]){const shield=new THREE.Mesh(new THREE.SphereGeometry(1.03,20,14),new THREE.MeshBasicMaterial({color:0x267ee8,side:THREE.FrontSide}));shield.visible=false;scene.add(shield);spawnShields.set(id,shield);}
const impactLayer=new THREE.Group();impactLayer.name='bullet-impacts';scene.add(impactLayer);const impactObjects=new Map();let impactMaterial=null;
function syncImpacts(){if(!inBattle)return;if(!impactMaterial){const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d'),gradient=c.createRadialGradient(32,32,3,32,32,30);gradient.addColorStop(0,'rgba(4,3,2,.98)');gradient.addColorStop(.25,'rgba(18,13,8,.95)');gradient.addColorStop(.55,'rgba(37,26,17,.7)');gradient.addColorStop(1,'rgba(25,18,10,0)');c.fillStyle=gradient;c.fillRect(0,0,64,64);c.strokeStyle='rgba(12,9,5,.8)';for(let i=0;i<9;i++){const a=i*2.4;c.beginPath();c.moveTo(32+Math.cos(a)*7,32+Math.sin(a)*7);c.lineTo(32+Math.cos(a)*22,32+Math.sin(a)*22);c.stroke();}impactMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:THREE.DoubleSide});}
for(const hit of state.impacts||[]){if(impactObjects.has(hit.id))continue;const normal=new THREE.Vector3(...hit.n).normalize();let point=new THREE.Vector3(...hit.p);if(mapRoot){const ray=new THREE.Raycaster(point.clone().addScaledVector(normal,.25),normal.clone().negate(),0,.5),exact=ray.intersectObject(mapRoot,true)[0];if(exact)point=exact.point;}const mark=new THREE.Mesh(new THREE.PlaneGeometry(.14,.14),impactMaterial);mark.position.copy(point).addScaledVector(normal,.005);mark.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mark.rotateZ(hit.id*2.4);impactLayer.add(mark);impactObjects.set(hit.id,mark);}for(const [id,mark]of impactObjects){if(!state.impacts.some(h=>h.id===id)){impactLayer.remove(mark);mark.geometry.dispose();impactObjects.delete(id);}}}
function poseWeapon(time,dt){const u=state.units[team];if(u.throwUntil>remoteNow()){if(viewWeapon!=='grenade')buildViewWeapon('grenade');const p=clamp((remoteNow()-(u.throwUntil-650))/650,0,1),pull=Math.sin(Math.min(1,p/.38)*Math.PI/2),push=clamp((p-.35)/.22,0,1),follow=Math.sin(clamp((p-.46)/.54,0,1)*Math.PI);adsBlend=0;viewModel.rotation.set(.35*pull-.5*push,-.1*pull+.1*push,-.12*follow);viewModel.position.set(.02*pull,.025+.08*push-.05*follow,.08*pull-.28*push);if(heldGrenade)heldGrenade.visible=!!u.throwAt&&remoteNow()<u.throwAt;if(supportHand){supportHand.position.copy(supportHand.userData.rest);supportHand.position.x-=clamp(p/.35,0,1)*.22;supportHand.position.y-=clamp(p/.35,0,1)*.2;}muzzle.intensity=0;return;}const profile=aimProfiles[u.weapon],target=scoped&&profile?1:0;adsBlend=THREE.MathUtils.lerp(adsBlend,target,Math.min(1,dt*22));if(Math.abs(adsBlend-target)<.001)adsBlend=target;viewModel.rotation.set(0,0,0);const speed=predicted?Math.hypot(predicted.vx,predicted.vz):0,moving=predicted?.grounded&&speed>.25?Math.min(1,speed/3.8):0;moveBlend=THREE.MathUtils.lerp(moveBlend,moving,Math.min(1,dt*14));runBlend=THREE.MathUtils.lerp(runBlend,moving&&speed>4.4?1:0,Math.min(1,dt*14));if(moveBlend<.001)moveBlend=0;if(runBlend<.001)runBlend=0;walkPhase+=dt*(8+runBlend*4);const carry=moveBlend*(1-adsBlend)*(u.reloadUntil||fire||recoil>.05?0:1),wave=Math.sin(walkPhase);viewModel.rotation.set(carry*(-.12-runBlend*.06+Math.cos(walkPhase*2)*.015),carry*(.23+runBlend*.1+wave*.022),carry*(-.25-runBlend*.08+wave*.035));viewModel.position.set(carry*(.055+wave*.012),carry*(-.07-runBlend*.025+Math.cos(walkPhase*2)*.012)-recoil*.03,carry*.04);if(profile&&viewWeapon===u.weapon){const side=isSidearm(u.weapon),x=side?.175:.25,y=side?.175:.25,depth=side?.65:.93;viewModel.position.x+=-x*adsBlend;viewModel.position.y=viewModel.position.y*(1-adsBlend)+(y-profile.height)*adsBlend;viewModel.position.z+=(depth-profile.rear-profile.eye)*adsBlend;muzzle.position.set(x*(1-adsBlend),-y+(y-profile.height)*adsBlend,-depth+(depth-profile.rear-profile.eye)*adsBlend);}if(magazine){magazine.position.copy(magazine.userData.rest);magazine.visible=!!u.reloadUntil;}if(bolt){bolt.position.copy(bolt.userData.rest);bolt.visible=!!u.reloadUntil;}if(supportHand)supportHand.position.copy(supportHand.userData.rest);
if(time<meleeUntil){const p=clamp((time-meleeStarted)/380,0,1),swing=Math.sin(p*Math.PI);viewModel.rotation.set(-.15*swing,1.0*swing,-.65*swing);viewModel.position.x=-.2*swing;viewModel.position.z=-.12*swing;muzzle.intensity=0;return;}if(viewWeapon!==u.weapon)buildViewWeapon(u.weapon);
if(u.reloadUntil&&weapons[u.weapon].mag!==null){const p=clamp(1-(u.reloadUntil-Date.now())/weapons[u.weapon].reload,0,1),tilt=Math.sin(Math.PI*clamp(p/.18,0,1)/2)*Math.min(1,(1-p)/.12);viewModel.rotation.set(.22*tilt,-.15*tilt,-.6*tilt);viewModel.position.y-=.07*tilt;let pull;if(p<.32)pull=p/.32;else if(p<.46)pull=1;else pull=Math.max(0,1-(p-.46)/.3);if(magazine){magazine.position.y-=pull*.4;magazine.position.x-=Math.sin(p*Math.PI)*.12;}if(supportHand){supportHand.position.y-=pull*.28;supportHand.position.x-=pull*.12;if(p>.78&&p<.96){const boltPull=Math.sin((p-.78)/.18*Math.PI);supportHand.position.set(.36,-.22,-.44+boltPull*.13);if(bolt)bolt.position.z+=boltPull*.13;}}setHUDText('reload-status',p<.34?'탄창 분리':p<.76?'새 탄창 삽입':'장전 손잡이 · 준비');}}
function updateAimingPresentation(dt,time){const targetFov=scoped?(isSniper(state.units[team].weapon)?20:aimProfiles[state.units[team].weapon].fov):80;let nextFov=THREE.MathUtils.lerp(camera.fov,targetFov,Math.min(1,dt*14));if(Math.abs(nextFov-targetFov)<.02)nextFov=targetFov;if(camera.fov!==nextFov){camera.fov=nextFov;camera.updateProjectionMatrix();}poseWeapon(time,dt);$('scope').hidden=!(scoped&&isSniper(state.units[team].weapon));$('crosshair').hidden=scoped||adsBlend>.1;viewModel.visible=!(scoped&&isSniper(state.units[team].weapon))&&state.units[team]?.hp>0&&predicted?.ladder===null;}
const doorObjects=new Map();for(const d of doorTemplates){const root=new THREE.Group(),axis=d.axis==='x'?-Math.PI/2:0;root.position.set(d.x-(d.axis==='z'?d.width/2:0),0,d.z-(d.axis==='x'?d.width/2:0));root.rotation.y=axis;root.userData.base=axis;root.userData.angle=0;box(root,d.width,d.height,.075,0x66513a,d.width/2,d.height/2,0);for(let i=1;i<5;i++)box(root,.016,d.height-.08,.082,0x392c20,i*d.width/5,d.height/2,0);box(root,.07,.07,.1,0xb5ad82,d.width-.12,1,.075);scene.add(root);doorObjects.set(d.id,root);if(d.axis==='z'){box(scene,.07,d.height+.05,.15,0x4c4032,d.x-d.width/2-.025,d.height/2,d.z);box(scene,.07,d.height+.05,.15,0x4c4032,d.x+d.width/2+.025,d.height/2,d.z);box(scene,d.width+.12,.08,.15,0x4c4032,d.x,d.height+.02,d.z);}else{box(scene,.15,d.height+.05,.07,0x4c4032,d.x,d.height/2,d.z-d.width/2-.025);box(scene,.15,d.height+.05,.07,0x4c4032,d.x,d.height/2,d.z+d.width/2+.025);box(scene,.15,.08,d.width+.12,0x4c4032,d.x,d.height+.02,d.z);}}
let audio=null;function sound(type){if(spatialAudio.muted)return;try{audio??=new AudioContext();if(audio.state==='suspended')audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);osc.type=type==='hit'?'sine':'sawtooth';osc.frequency.setValueAtTime(type==='shot'?130:type==='boom'?50:type==='hit'?900:220,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(30,audio.currentTime+.08);gain.gain.setValueAtTime(.025,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.1);osc.start();osc.stop(audio.currentTime+.11);}catch{}}
function resize(){
 const el=renderer.domElement.parentElement;if(!el?.clientWidth||!el.clientHeight)return;
 const width=el.clientWidth,height=el.clientHeight,pixelRatio=Math.min(devicePixelRatio||1,1,Math.sqrt(MAX_RENDER_PIXELS/(width*height)))*renderScale;
 const ratioChanged=Math.abs(renderer.getPixelRatio()-pixelRatio)>.001;
 if(ratioChanged)renderer.setPixelRatio(pixelRatio);
 if(ratioChanged||renderWidth!==width||renderHeight!==height){renderer.setSize(width,height,false);renderWidth=width;renderHeight=height;}
 const cam=!entered?titleCamera:inBattle?camera:lobbyCamera;
 flyoverCamera.aspect=width/height;flyoverCamera.updateProjectionMatrix();cam.aspect=width/height;if(cam!==camera){cam.position.z=cam.aspect<.7?12:9;cam.lookAt(0,1.5,0);}cam.updateProjectionMatrix();
}
function adaptRenderResolution(elapsed,time){
 qualityFrames++;qualityElapsed+=Math.min(elapsed,250);
 if(time-qualityWindowAt<2000)return;
 const average=qualityElapsed/qualityFrames;let nextScale=renderScale;
 if(average>23&&renderScale>.6)nextScale=Math.max(.6,renderScale-.1);
 else if(average<18.5&&renderScale<1&&time-lastQualityChange>10000)nextScale=Math.min(1,renderScale+.05);
 qualityFrames=0;qualityElapsed=0;qualityWindowAt=time;
 if(Math.abs(nextScale-renderScale)>.001){renderScale=nextScale;lastQualityChange=time;resize();}
}
const observer=new ResizeObserver(resize);for(const id of ['title-viewport','lobby-viewport','viewport'])observer.observe($(id));
// Network input and physics stay at their original fixed 30 Hz, independent of display refresh.
const inputTimer=setInterval(inputFrame,1000/30);
const grenadeObjects=new Map(),crateObjects=new Map(),cameraTarget=new THREE.Vector3(),remoteTarget=new THREE.Vector3(),aimRay=new THREE.Ray(),aimBox=new THREE.Box3(),aimHit=new THREE.Vector3();
let lastTime=0,frameRequest=0;
function syncRenderLoop(){
 if(document.hidden||(screen!=='lobby'&&screen!=='battle')){if(frameRequest)cancelAnimationFrame(frameRequest);frameRequest=0;lastTime=0;return;}
 if(!frameRequest){lastTime=0;qualityFrames=qualityElapsed=0;qualityWindowAt=performance.now();frameRequest=requestAnimationFrame(renderFrame);}
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){introFrameAt=0;keys.clear();fire=false;scoped=false;touchScope=false;sprintRequested=false;touch.forward=touch.strafe=0;inputFrame();}
 syncRenderLoop();
});
window.addEventListener('beforeunload',()=>{clearInterval(inputTimer);if(frameRequest)cancelAnimationFrame(frameRequest);});
function syncBattleProps(time){
 for(const c of state.crates){let obj=crateObjects.get(c.id);const version=c.broken?'loot':'box';if(obj?.userData.version!==version){if(obj){scene.remove(obj);obj.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}obj=new THREE.Group();obj.userData.version=version;if(!c.broken){box(obj,.8,.75,.8,0x775539,0,.375,0);box(obj,.84,.07,.84,0xaca074,0,.72,0);box(obj,.07,.7,.82,0x332e23,-.27,.36,0);box(obj,.07,.7,.82,0x332e23,.27,.36,0);}else{box(obj,.28,.35,.24,c.loot==='life'?0x70e1b0:0xe9c16d,0,.4,0);if(c.loot==='life'){box(obj,.2,.05,.03,0xffffff,0,.42,.14);box(obj,.05,.2,.03,0xffffff,0,.42,.14);}}scene.add(obj);crateObjects.set(c.id,obj);}obj.visible=!c.taken;obj.position.set(c.x,c.y+(c.broken?Math.sin(time*.003)*.08:0),c.z);}
 for(const [id,obj] of crateObjects)if(!state.crates.some(c=>c.id===id)){scene.remove(obj);obj.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});crateObjects.delete(id);}
 for(const g of state.grenades){let mesh=grenadeObjects.get(g.id);if(!mesh){mesh=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshStandardMaterial({color:0x76854c}));scene.add(mesh);grenadeObjects.set(g.id,mesh);}mesh.position.set(g.x,g.y,g.z);}for(const [id,mesh] of grenadeObjects)if(!state.grenades.some(g=>g.id===id)){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();grenadeObjects.delete(id);}
}
function renderFrame(time){
 frameRequest=0;
 if(document.hidden||(screen!=='lobby'&&screen!=='battle')){lastTime=0;return;}
 frameRequest=requestAnimationFrame(renderFrame);
 const elapsed=lastTime?time-lastTime:1000/60,dt=Math.min(elapsed/1000,.08);lastTime=time;
 adaptRenderResolution(elapsed,time);
 if(inBattle){for(const actor of actorObjects.values()){resetRemoteCombatPose(actor);actor.mixer?.update(dt);}}
 else for(const {actor}of lobbyActorRecords)actor.mixer?.update(dt);
 if(inBattle&&isMatchPreparing()){renderMatchPreparation(time);return;}
 if(inBattle)updateStartAnnouncement(time);
 if(inBattle){if(predicted){const dead=state.units[team].hp<=0,fall=dead?THREE.MathUtils.smoothstep((remoteNow()-state.units[team].diedAt)/1000,0,2.1):0;const target=cameraTarget.set(predicted.x,predicted.y+EYE*(1-fall)+.25*fall,predicted.z);if(camera.position.distanceTo(target)>3)camera.position.copy(target);else camera.position.lerp(target,Math.min(1,dt*28));camera.rotation.set(pitch+recoil*.025-fall*.35,yaw,fall*.7,'YXZ');}updateAimingPresentation(dt,time);camera.updateMatrixWorld(true);if(predicted&&!$('crosshair').hidden){const aimUnit={...predicted,yaw,pitch,weapon:state.units[team].weapon,scoped},origin=shotOrigin(aimUnit),direction=shotDirection(aimUnit,state.units),ray=aimRay.set(origin,direction);let distance=raycastWorld(ray)?.distance??80;for(const c of state.crates){if(c.broken)continue;aimBox.min.set(c.x-.4,c.y,c.z-.4);aimBox.max.set(c.x+.4,c.y+.75,c.z+.4);const hit=ray.intersectBox(aimBox,aimHit);if(hit)distance=Math.min(distance,origin.distanceTo(hit));}const point=origin.addScaledVector(direction,Math.max(.05,distance)).project(camera);const left=clamp((point.x*.5+.5)*100,1,99).toFixed(2)+'%',top=clamp((-point.y*.5+.5)*100,1,99).toFixed(2)+'%',style=$('crosshair').style;if(style.left!==left)style.left=left;if(style.top!==top)style.top=top;}for(const d of state.doors){const mesh=doorObjects.get(d.id);mesh.userData.angle=THREE.MathUtils.lerp(mesh.userData.angle,d.open?1:0,Math.min(1,dt*9));mesh.rotation.y=mesh.userData.base+mesh.userData.angle*Math.PI/2*(d.axis==='z'?-d.nz:d.nx);}recoil=Math.max(0,recoil-dt*8);muzzle.intensity=Math.max(0,muzzle.intensity-dt*60);$('hit-marker').hidden=time>hitUntil;$('damage-flash').style.opacity=time<damageUntil?'.5':'0';for(const u of state.units){const shield=spawnShields.get(u.id);shield.visible=u.hp>0&&u.shieldUntil>Date.now();const pos=u.id===team&&predicted?predicted:u;shield.position.set(pos.x,pos.y+.86,pos.z);}$('spawn-shield-overlay').hidden=state.units[team].hp<=0||state.units[team].shieldUntil<=Date.now();for(const [id,actor] of actorObjects){const u=state.units[id];actor.root.visible=true;actor.root.position.lerp(remoteTarget.set(u.x,u.y,u.z),Math.min(1,dt*18));actor.root.rotation.y=u.yaw+Math.PI;if(updateRemoteLife(actor,u,remoteNow()))continue;const revealed=state.units[team].thermalUntil>Date.now();if(actor.revealed!==revealed){actor.root.traverse(o=>{if(!o.isMesh)return;if(revealed){o.userData.baseMaterial=o.material;o.material=new THREE.MeshBasicMaterial({color:0xff9c38,transparent:true,opacity:.8,depthTest:false,depthWrite:false});o.renderOrder=10;}else if(o.userData.baseMaterial){o.material.dispose();o.material=o.userData.baseMaterial;o.renderOrder=0;}});actor.revealed=revealed;}updateRemoteCombat(actor,u,weaponAssets,remoteNow());if(time<actor.attackUntil)continue;const forward=u.vx*(-Math.sin(u.yaw))+u.vz*(-Math.cos(u.yaw)),right=u.vx*Math.cos(u.yaw)-u.vz*Math.sin(u.yaw);let anim=u.ladder!==null?'Interact':Math.hypot(u.vx,u.vz)<.3?'Idle':Math.abs(forward)>=Math.abs(right)?forward>=0?'Run':'Run_Back':right>=0?'Run_Right':'Run_Left';if(anim!==actor.currentAction){actor.mixer?.stopAllAction();(anim==='Idle'?actor.idle:actor.directional[anim]||actor.run)?.reset().play();actor.currentAction=anim;}}

 syncBattleProps(time);if(time-lastRadarAt>=50){radar();lastRadarAt=time;}renderer.render(scene,camera);
 }else{for(const record of lobbyActorRecords){const id=record.own?team:1-team,key=team===null?chosen:state.units[id]?.primary||'rifle';updateLobbyWeapon(record.actor,key,weaponAssets);}renderer.render(lobbyScene,lobbyCamera);}
}
async function loadAssets(){try{await Promise.all([...['dying','rifle-idle'].map(async key=>{const response=await fetch(`/assets/${key}.json`);if(!response.ok)throw Error('Motion '+key);motionClips[key]=THREE.AnimationClip.parse(await response.json());assetVersion++;displayLobby();}),...Object.entries(weapons).filter(([,w])=>w.model).map(async([key,w])=>{weaponAssets[key]=(await new GLTFLoader().loadAsync(`/assets/weapons/${w.model}.glb`)).scene;}),...['swat','arena','collision'].map(async key=>{const gltf=await new GLTFLoader().loadAsync(`/assets/${key}.glb?v=6`);if(key!=='collision'){const materials=new Map(),convert=m=>{if(!materials.has(m))materials.set(m,new THREE.MeshLambertMaterial({color:m.color,vertexColors:m.vertexColors,side:key==='arena'?THREE.DoubleSide:m.side,transparent:m.transparent,opacity:m.opacity}));return materials.get(m);};gltf.scene.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});}if(key==='arena'){gltf.scene.scale.setScalar(mapData.scale);scene.add(gltf.scene);gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});mapRoot=gltf.scene;}else if(key==='collision'){gltf.scene.scale.setScalar(mapData.scale);gltf.scene.updateMatrixWorld(true);setWorld(new CollisionWorld(gltf.scene));}else assets[key]=gltf;assetVersion++;displayLobby();})]);assetsReady=true;$('asset-status').textContent='REAL-TIME FPS · 맵/캐릭터/충돌 준비 완료';displayLobby();}catch(error){console.error(error);$('asset-status').textContent='3D 에셋을 불러오지 못했습니다. 새로고침해 주세요.';}}
displayLobby();loadAssets();

function addChat(message){if(message.team===team&&$('chat-input').value.trim()===message.text)$('chat-input').value='';const row=document.createElement('div'),name=document.createElement('b'),body=document.createElement('span');name.textContent=message.name+': ';name.style.color=message.team===0?'#75cbff':'#ff8877';body.textContent=message.text;row.append(name,body);$('chat-messages').append(row);while($('chat-messages').children.length>30)$('chat-messages').firstElementChild.remove();$('chat-messages').scrollTop=$('chat-messages').scrollHeight;$('chat-status').textContent='같은 방 채팅 · M 입력';}
function focusChat(){chatResume=!!document.pointerLockElement||dragMode;keys.clear();sprintRequested=false;fire=false;scoped=false;touchScope=false;inputFrame();document.exitPointerLock?.();setTimeout(()=>$('chat-input').focus(),0);}
$('chat-input').addEventListener('focus',()=>{keys.clear();sprintRequested=false;fire=false;scoped=false;touchScope=false;inputFrame();});
function finishChat(){ $('chat-input').blur();if(inBattle&&chatResume){chatResume=false;capture();}}
$('chat-input').addEventListener('keydown',e=>{e.stopPropagation();if(e.code==='Escape'){e.preventDefault();finishChat();}});
$('chat-form').onsubmit=e=>{e.preventDefault();const text=$('chat-input').value.trim();if(!text)return;if(team===null){$('chat-status').textContent='먼저 방 참가 또는 AI 게임 시작으로 접속하세요.';return;}send({type:'chat',text});finishChat();};

// Only one full screen is visible. Connection success alone opens a room lobby.
function showScreen(next){if(connecting)return;screen=next;setNavigationStatus('');displayLobby();if(next==='rooms')refreshRooms();requestAnimationFrame(()=>{const focus={menu:'room-player-name',rooms:'rooms-back',private:'private-room-code',title:'press-start'}[next];if(focus)$(focus).focus({preventScroll:true});});}
function setNavigationStatus(message){for(const id of ['menu-status','rooms-status','private-status'])$(id).textContent=message||'';}
async function refreshRooms(){
 if(screen!=='rooms'||connecting)return;const request=++roomsRequest;const list=$('room-list');$('rooms-status').textContent='방 목록을 불러오는 중…';
 try{const response=await fetch('/api/rooms',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(request!==roomsRequest||screen!=='rooms'||connecting)return;
 list.replaceChildren();for(const room of data.rooms){const row=document.createElement('button');row.className='room-row';row.dataset.room=room.code;row.disabled=room.count>=room.capacity||room.phase!=='lobby';
 row.classList.toggle('room-in-battle',room.phase!=='lobby');
 const badge=document.createElement('span');badge.className='room-badge';badge.setAttribute('aria-hidden','true');badge.innerHTML='<svg viewBox="0 0 40 48"><path d="M5 5L20 1l15 4v20c0 11-15 21-15 21S5 36 5 25z" fill="#273535" stroke="#b4ac7b" stroke-width="2"/><path d="M20 9l3 8 9 1-7 6 2 9-7-5-7 5 2-9-7-6 9-1z" fill="#bcb889"/></svg>';
 const label=document.createElement('span');label.className='room-description';const title=document.createElement('strong'),code=document.createElement('small');title.textContent=room.host+'의 방';code.textContent=room.code+' · '+room.mode.toUpperCase();label.append(title,code);
 const soldier=document.createElement('span');soldier.className='room-soldier';soldier.setAttribute('aria-hidden','true');soldier.innerHTML='<svg viewBox="0 0 44 54"><path d="M10 50V37l8-5h9l8 5 3 13" fill="#596363" stroke="#97a09b"/><path d="M13 23V13a10 10 0 0120 0v10l-6 10h-8z" fill="#343f41" stroke="#a2aca4"/><path d="M11 15C11 0 35 0 35 16l-4 3H14z" fill="#717b72" stroke="#b2b7a5"/><path d="M15 19h16v6H15z" fill="#111d22"/><path d="M17 37h14v14H17z" fill="#2b3737" stroke="#9ca99c"/><path d="M20 38v13m7-13v13" stroke="#6b7b70"/></svg>';
 const status=document.createElement('span');status.className='room-capacity';const count=document.createElement('b'),phase=document.createElement('small');count.textContent=room.count+'/'+room.capacity;phase.textContent=room.phase==='intro'?'맵 정찰 중':room.phase==='countdown'?'전투 준비':room.phase==='results'?'결과 확인 중':room.phase==='battle'?'전투 중':room.count>=2?'가득 참':'참가 가능';status.append(count,phase);
 const crate=document.createElement('span');crate.className='room-crate';crate.setAttribute('aria-hidden','true');crate.innerHTML='<svg viewBox="0 0 54 46"><path d="M5 14L20 5l29 4-13 10z" fill="#778577" stroke="#a8b3a0"/><path d="M5 14l31 5v24L5 37z" fill="#46534c" stroke="#829081"/><path d="M36 19l13-10v25L36 43z" fill="#293c36" stroke="#829081"/><path d="M13 15v24m15-21v23M41 15v24" stroke="#a4aa8e" stroke-width="3"/><path d="M17 25l7 1v6l-7-1z" fill="#98aa9a"/></svg>';
 row.append(badge,label,soldier,status,crate);row.setAttribute('aria-label',room.host+'의 방 '+room.code+' '+room.count+'/'+room.capacity+' '+phase.textContent);
 row.onclick=()=>{if(connecting)return;chosenMode='pvp';$('room').value=room.code;connectRoom(false,{joinExisting:true});};list.append(row);}
 $('rooms-status').textContent=data.rooms.length?'공개 방 '+data.rooms.length+'개':'열린 방이 없습니다. 메뉴로 돌아가 HOST로 새 방을 만들어 주세요.';
 }catch{if(request===roomsRequest&&screen==='rooms')$('rooms-status').textContent='방 목록을 불러오지 못했습니다. 새로고침해 주세요.';}
}
function saveRoomName(){const name=$('room-player-name').value.trim();if(!name||Array.from(name).length>12||/[\u0000-\u001f\u007f]/.test(name)){setNavigationStatus('플레이어 이름을 1~12자로 입력하세요.');$('room-player-name').focus();return false;}profileName=name;$('player-name').value=name;$('profile-form').hidden=true;try{localStorage.setItem('vector-name',name);}catch{}return true;}
function createRoom(mode='pvp'){if(team!==null||!saveRoomName())return;chosenMode=mode;$('room').value=crypto.randomUUID().replaceAll('-','').slice(0,6).toUpperCase();connectRoom(false,{createOnly:true,private:mode==='ai'});}
$('browser-create').onclick=()=>createRoom();$('menu-ai').onclick=()=>createRoom('ai');
$('open-public').onclick=()=>{if(saveRoomName())showScreen('rooms');};$('open-private').onclick=()=>{if(saveRoomName())showScreen('private');};
$('menu-back').onclick=()=>showScreen('title');$('rooms-back').onclick=() =>showScreen('menu');$('private-back').onclick=()=>showScreen('menu');$('refresh-rooms').onclick=refreshRooms;
$('leave-room').onclick=()=>{if(team!==null){chosen=state.units[team].primary;chosenSecondary=state.units[team].secondary;}connectionNotice='';connecting=true;displayLobby();socket?.close();$('chat-messages').replaceChildren();};
$('code-join').onsubmit=e=>{e.preventDefault();if(connecting||team!==null)return;chosenMode='pvp';$('room').value=$('private-room-code').value.trim();connectRoom(false,{joinExisting:true});};
setInterval(()=>{if(screen==='rooms'&&!connecting)refreshRooms();},5000);
