// Shared catalogue: lobby selections and authoritative combat use the same stats.
export const weapons={
 rifle:{name:'AR-01 라이플',slot:'주무기',category:'rifle',maker:'Quaternius',damage:30,head:60,rpm:600,mag:30,range:80,reload:1800,model:'rifle'},
 rifle_z:{name:'AR-02 라이플',slot:'주무기',category:'rifle',maker:'Zsky',damage:34,head:68,rpm:520,mag:30,range:80,reload:1900,model:'rifle_z'},
 smg_z:{name:'SMG-01 기관단총',slot:'주무기',category:'smg',maker:'Zsky',damage:24,head:50,rpm:780,mag:30,range:55,reload:1600,model:'smg_z'},
 smg_q:{name:'SMG-02 기관단총',slot:'주무기',category:'smg',maker:'Quaternius',damage:26,head:52,rpm:700,mag:32,range:60,reload:1700,model:'smg_q'},
 sniper:{name:'SR-01 저격총',slot:'주무기',category:'sniper',maker:'J-Toastie',damage:85,head:110,rpm:50,mag:5,range:120,reload:2600,model:'sniper'},
 awp:{name:'AWP 저격총',slot:'주무기',category:'sniper',maker:'Kyler Swanson',damage:90,head:120,rpm:40,mag:5,range:120,reload:2800,model:'awp'},
 pistol:{name:'P-01 권총',slot:'보조무기',category:'pistol',maker:'Quaternius',damage:18,head:40,rpm:300,mag:12,range:45,reload:1200,model:'pistol'},
 pistol_z:{name:'P-02 권총',slot:'보조무기',category:'pistol',maker:'Zsky',damage:16,head:35,rpm:360,mag:15,range:45,reload:1300,model:'pistol_z'},
 revolver:{name:'R-06 리볼버',slot:'보조무기',category:'pistol',maker:'Quaternius',damage:20,head:45,rpm:200,mag:6,range:50,reload:1600,model:'revolver'},
 knife:{name:'K-01 전투 나이프',slot:'근접무기',category:'knife',damage:40,head:100,rpm:90,mag:null,range:2,reload:0}
};
export const loadoutSlots=[{key:'primary',name:'주무기',number:1},{key:'secondary',name:'보조무기',number:2},{key:'melee',name:'근접무기',number:3}];
export const isSniper=key=>weapons[key]?.category==='sniper';
export const isSidearm=key=>weapons[key]?.slot==='보조무기';
export const isPrimary=key=>weapons[key]?.slot==='주무기';
