import * as THREE from '/three.js';
import {SIZE,walls,initial,weapons} from '/game.js';
const $=id=>document.getElementById(id);
let socket,state=initial(),team=null,selected=null,ready=false;
const scene=new THREE.Scene();scene.background=new THREE.Color('#192327');
const camera=new THREE.PerspectiveCamera(40,1,.1,100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));$('viewport').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd6ebff,0x343a32,2.8));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(4,12,8);scene.add(sun);
const board=new THREE.Group();scene.add(board);const clickable=[],soldiers=new THREE.Group();scene.add(soldiers);
function box(w,h,d,color,x,y,z,parent=board){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));o.position.set(x,y,z);parent.add(o);return o;}
for(let x=0;x<SIZE;x++)for(let z=0;z<SIZE;z++){const tile=box(.96,.12,.96,(x+z)%2?'#2f4045':'#34474c',x-5.5,-.1,z-5.5);tile.userData={x,z};clickable.push(tile);}
for(const w of walls){box(.93,1.05,.93,'#738174',w.x-5.5,.48,w.z-5.5);box(.97,.08,.97,'#9ba68a',w.x-5.5,1.03,w.z-5.5);}
let angle=.7,distance=18;
function cameraUpdate(){camera.position.set(Math.sin(angle)*distance,distance*.95,Math.cos(angle)*distance);camera.lookAt(0,0,0);}cameraUpdate();
function draw(){soldiers.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});soldiers.clear();for(const u of state.units){if(u.hp<=0)continue;const g=new THREE.Group();g.position.set(u.x-5.5,0,u.z-5.5);soldiers.add(g);const color=u.team===0?0x76bfff:0xff8577;const body=box(.4,.55,.35,color,0,.48,0,g);body.userData={unit:u.id};const head=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),new THREE.MeshStandardMaterial({color}));head.position.y=.93;head.userData={unit:u.id};g.add(head);box(.12,.12,.55,0x18232b,.23,.65,-.1,g).userData={unit:u.id};const ring=new THREE.Mesh(new THREE.RingGeometry(.34,.43,32),new THREE.MeshBasicMaterial({color:u.id===selected?0xd0fc72:color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.015;g.add(ring);box(.7*(u.hp/100),.045,.06,0xd0fc72,0,1.3,0,g);}
 $('squad').replaceChildren();for(const u of state.units.filter(u=>u.team===team)){const b=document.createElement('button');b.className='unit'+(selected===u.id?' selected':'');b.textContent=`오퍼레이터 ${u.team+1}   ${u.hp} HP / ${u.ap} AP`;b.disabled=u.hp<=0;b.onclick=()=>{selected=u.id;draw();};$('squad').append(b);}
 updateHUD();
 $('round').textContent=`ROUND ${state.round}`;
 $('status').textContent=team===null?'접속 대기 중':state.winner!==null?`${state.winner===team?'승리':'패배'} · 작전 종료`:!ready?'상대 플레이어 대기 중':state.turn===team?'당신의 턴 · 명령을 내려주세요':'상대의 턴 · 작전 진행 중';
 $('end').disabled=!ready||state.turn!==team||state.winner!==null;
}
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,angle};renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(down){angle=down.angle+(e.clientX-down.x)*.008;cameraUpdate();}});
renderer.domElement.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(moved>5)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects([...soldiers.children,...board.children],true).find(h=>h.object.userData.unit!==undefined||h.object.userData.x!==undefined);if(!hit)return;const d=hit.object.userData;if(d.unit!==undefined){const u=state.units.find(u=>u.id===d.unit);if(u.team===team){selected=u.id;draw();}else if(selected!==null)send({type:'attack',id:selected,target:u.id});}else if(selected!==null)send({type:'move',id:selected,x:d.x,z:d.z});});
renderer.domElement.addEventListener('pointercancel',()=>down=null);
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance+e.deltaY*.01,10,28);cameraUpdate();},{passive:false});
function send(action){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(action));else $('notice').textContent='먼저 방에 참가하세요.';}
$('join').onsubmit=e=>{e.preventDefault();if(socket&&socket.readyState<2)return;const current=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}`);socket=current;$('connection').textContent='● CONNECTING';current.onopen=()=>send({type:'join',room:$('room').value.trim()});current.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='joined'){team=m.team;selected=team;$('team').textContent=team===0?'ALPHA / 나의 오퍼레이터':'BRAVO / 나의 오퍼레이터';$('connection').textContent='● ONLINE';$('notice').textContent='아군 선택 후 인접 칸 또는 적을 클릭하세요.';}if(m.type==='state'){state=m.state;ready=m.ready;$('notice').textContent=state.lastEvent;draw();}if(m.type==='error'||m.type==='closed'){$('notice').textContent=m.message;if(team===null)current.close();}};current.onclose=()=>{ready=false;team=null;selected=null;$('connection').textContent='● OFFLINE';draw();};current.onerror=()=>{$('notice').textContent='서버 연결 실패. 서버 실행 상태를 확인하세요.';};};
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
 const ctx=$('minimap').getContext('2d'),scale=12;ctx.fillStyle='#0a151b';ctx.fillRect(0,0,144,144);ctx.strokeStyle='#263c46';for(let i=0;i<=12;i++){ctx.beginPath();ctx.moveTo(i*scale,0);ctx.lineTo(i*scale,144);ctx.moveTo(0,i*scale);ctx.lineTo(144,i*scale);ctx.stroke();}ctx.fillStyle='#78877f';for(const v of walls)ctx.fillRect(v.x*scale,v.z*scale,scale,scale);for(const v of state.units){if(v.hp<=0)continue;ctx.fillStyle=v.team===team?'#76bfff':'#ff8577';ctx.beginPath();ctx.arc((v.x+.5)*scale,(v.z+.5)*scale,4,0,Math.PI*2);ctx.fill();}
}
$('reload').onclick=()=>send({type:'reload',id:team});
$('zoom-in').onclick=()=>{distance=Math.max(10,distance-2);cameraUpdate();};$('zoom-out').onclick=()=>{distance=Math.min(28,distance+2);cameraUpdate();};
$('end').onclick=()=>send({type:'end'});
new ResizeObserver(()=>{const el=$('viewport');renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();}).observe($('viewport'));
renderer.setAnimationLoop(()=>renderer.render(scene,camera));draw();
