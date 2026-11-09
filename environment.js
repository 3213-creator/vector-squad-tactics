import {mapData} from './map-data.js';
const s=mapData.scale;
// World-space interaction zones aligned to the uploaded map's existing geometry.
export const ladders=[
 {id:0,x:-3.04*s,z:1.13*s,attachX:-3.04*s,attachZ:.59,bottom:0,top:2.74,exitX:-3.04*s,exitZ:1.95,yaw:Math.PI},
 {id:1,x:3.04*s,z:-1.13*s,attachX:3.04*s,attachZ:-.59,bottom:0,top:2.74,exitX:3.04*s,exitZ:-1.95,yaw:0}
];
export const doors=[
 {id:0,x:-3.341*s,z:-1.2355*s,axis:'z',nx:0,nz:1,width:1.05,height:1.98},
 {id:1,x:-5.3385*s,z:3.344*s,axis:'x',nx:-1,nz:0,width:1.05,height:1.98},
 {id:2,x:3.375*s,z:1.2145*s,axis:'z',nx:0,nz:-1,width:1.05,height:1.98},
 {id:3,x:5.4305*s,z:-3.3125*s,axis:'x',nx:1,nz:0,width:1.05,height:1.98}
];
export function nearLadder(u){return ladders.find(l=>Math.hypot(u.x-l.attachX,u.z-l.attachZ)<1.05&&u.y>=l.bottom-.3&&u.y<=l.top+.35&&(u.y>l.top-.25||(u.z-l.z)*(l.attachZ-l.exitZ)>=0));}
export function toggleLadder(u){if(u.ladder!==null&&u.ladder!==undefined){u.ladder=null;u.vy=0;return true;}const l=nearLadder(u);if(!l||u.hp<=0)return false;u.ladder=l.id;u.x=l.attachX;u.z=l.attachZ;u.vx=u.vy=u.vz=0;u.grounded=false;return true;}
