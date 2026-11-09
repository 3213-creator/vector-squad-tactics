export const SIZE=12;
export const walls=[{x:4,z:3},{x:4,z:4},{x:7,z:7},{x:7,z:8},{x:5,z:6},{x:6,z:5}];
export function initial(){return {turn:0,round:1,winner:null,units:[0,1].flatMap(team=>Array.from({length:5},(_,i)=>({id:team*5+i,team,x:team?10:1,z:2+i*2,hp:100,ap:2}))) };}
export function act(s,team,a){
 if(s.winner!==null)throw Error('게임이 종료되었습니다.');
 if(team!==s.turn)throw Error('상대의 턴입니다.');
 if(a.type==='end') {s.turn=1-s.turn;s.round++;s.units.filter(u=>u.team===s.turn).forEach(u=>u.ap=2);return;}
 const u=s.units.find(u=>u.id===a.id&&u.team===team&&u.hp>0);
 if(!u||u.ap<1)throw Error('행동 가능한 아군을 선택하세요.');
 if(a.type==='move'){
 const {x,z}=a;
 if(!Number.isInteger(x)||!Number.isInteger(z)||x<0||z<0||x>=SIZE||z>=SIZE||Math.abs(u.x-x)+Math.abs(u.z-z)!==1||walls.some(w=>w.x===x&&w.z===z)||s.units.some(v=>v.hp>0&&v.x===x&&v.z===z))throw Error('인접한 빈 칸으로 이동하세요.');
 u.x=x;u.z=z;
 }else if(a.type==='attack'){
 const v=s.units.find(v=>v.id===a.target&&v.team!==team&&v.hp>0);
 if(!v||Math.hypot(u.x-v.x,u.z-v.z)>5)throw Error('사거리 5칸 안의 적을 선택하세요.');
 // Grid-sampled line of sight: obstacles block fire.
 const n=Math.max(Math.abs(v.x-u.x),Math.abs(v.z-u.z))*4;
 for(let i=1;i<n;i++)if(walls.some(w=>w.x===Math.round(u.x+(v.x-u.x)*i/n)&&w.z===Math.round(u.z+(v.z-u.z)*i/n)))throw Error('장애물에 가려진 적입니다.');
 v.hp=Math.max(0,v.hp-35);
 if(!s.units.some(v=>v.team!==team&&v.hp>0))s.winner=team;
 }else throw Error('지원하지 않는 행동입니다.');
 u.ap--;
}
