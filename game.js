import {mapData} from './map-data.js';
export const SIZE=mapData.width,DEPTH=mapData.depth;
export const walls=mapData.walls;
export const weapons={rifle:{name:'AR-01 라이플',slot:'주무기',damage:35,rpm:600,mag:30,range:6},pistol:{name:'P-09 권총',slot:'보조무기',damage:25,rpm:300,mag:12,range:4},knife:{name:'K-01 전투 나이프',slot:'근접무기',damage:60,rpm:90,mag:null,range:1.5}};
export function initial(){return {phase:'lobby',players:[null,null],turn:0,round:1,winner:null,units:[0,1].map(team=>({id:team,team,...mapData.spawns[team],hp:100,ap:2,weapon:'rifle',ammo:{rifle:30,pistol:12},lastAttack:0})),lastEvent:'1 대 1 결투 준비'};}
export function act(s,team,a,now=Date.now()){
 if(s.phase==='lobby'){
 const player=s.players[team];if(!player)throw Error('먼저 방에 참가하세요.');
 if(a.type==='profile'){if(typeof a.name!=='string'||!a.name.trim()||Array.from(a.name.trim()).length>12||/[\u0000-\u001f\u007f]/.test(a.name))throw Error('이름은 1~12자로 입력하세요.');player.name=a.name.trim();return;}
 if(a.type==='equip'){if(a.id!==team||!Object.hasOwn(weapons,a.weapon))throw Error('잘못된 무기 선택입니다.');s.units[team].weapon=a.weapon;player.ready=false;return;}
 if(a.type==='ready'){player.ready=!player.ready;if(s.players.every(p=>p?.ready)){s.phase='battle';s.lastEvent='두 플레이어 준비 완료 · 결투 시작';}return;}
 throw Error('두 플레이어가 게임 시작을 눌러야 합니다.');
 }
 if(s.winner!==null)throw Error('게임이 종료되었습니다.');
 if(team!==s.turn)throw Error('상대의 턴입니다.');
 if(a.type==='end'){s.turn=1-s.turn;s.round++;s.units[s.turn].ap=2;s.lastEvent='턴이 변경되었습니다.';return;}
 const u=s.units.find(u=>u.id===a.id&&u.team===team&&u.hp>0);
 if(!u)throw Error('자신의 캐릭터만 조작할 수 있습니다.');
 if(a.type==='equip'){if(!Object.hasOwn(weapons,a.weapon))throw Error('잘못된 무기입니다.');u.weapon=a.weapon;s.lastEvent=weapons[a.weapon].name+' 장착';return;}
 if(u.ap<1)throw Error('행동력이 없습니다. 턴을 종료하세요.');
 const w=weapons[u.weapon];
 if(a.type==='reload'){if(w.mag===null)throw Error('칼은 재장전하지 않습니다.');if(u.ammo[u.weapon]===w.mag)throw Error('탄창이 가득 찼습니다.');u.ammo[u.weapon]=w.mag;s.lastEvent=w.name+' 재장전';}
 else if(a.type==='move'){
 const {x,z}=a;if(!Number.isInteger(x)||!Number.isInteger(z)||x<0||z<0||x>=SIZE||z>=DEPTH||Math.abs(u.x-x)+Math.abs(u.z-z)!==1||walls.some(w=>w.x===x&&w.z===z)||s.units.some(v=>v.hp>0&&v.x===x&&v.z===z))throw Error('인접한 빈 칸으로 이동하세요.');u.x=x;u.z=z;s.lastEvent='전술 이동';
 }else if(a.type==='attack'){
 const v=s.units.find(v=>v.id===a.target&&v.team!==team&&v.hp>0);
 if(!v||Math.hypot(u.x-v.x,u.z-v.z)>w.range)throw Error(`사거리 ${w.range}칸 안의 적을 선택하세요.`);
 if(now-u.lastAttack<60000/w.rpm)throw Error('다음 공격을 준비 중입니다.');
 if(w.mag!==null&&u.ammo[u.weapon]<1)throw Error('탄약이 없습니다. 재장전하세요.');
 const n=Math.max(Math.abs(v.x-u.x),Math.abs(v.z-u.z))*4;
 for(let i=1;i<n;i++)if(walls.some(w=>w.x===Math.round(u.x+(v.x-u.x)*i/n)&&w.z===Math.round(u.z+(v.z-u.z)*i/n)))throw Error('장애물에 가려진 적입니다.');
 if(w.mag!==null)u.ammo[u.weapon]--;u.lastAttack=now;v.hp=Math.max(0,v.hp-w.damage);s.lastEvent=`${w.name} · ${w.damage} 피해`;if(v.hp===0)s.winner=team;
 }else throw Error('지원하지 않는 행동입니다.');u.ap--;
}

export function returnToLobby(old){const next=initial();next.players=old.players.map(p=>p?{...p,ready:false}:null);next.units.forEach((u,i)=>u.weapon=old.units[i].weapon);next.lastEvent='결투 종료 · 다시 준비해 주세요.';return next;}
