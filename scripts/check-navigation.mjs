// Run against `npm start` with NAV_BASE_URL, or start an isolated local server.
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {WebSocket} from 'ws';
import {once} from 'node:events';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.NAV_BASE_URL||'http://127.0.0.1:3409';
const output=process.env.NAV_ARTIFACT_DIR||'/tmp/death-match-navigation';await mkdir(output,{recursive:true});
const server=process.env.NAV_BASE_URL?null:spawn(process.execPath,['server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'3409'},stdio:'ignore'});
let browser;const clients=[];
async function waitForServer(){for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server did not start');}
async function peer(room){const ws=new WebSocket(base.replace(/^http/,'ws'));clients.push(ws);let latest;ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')latest=m.state;});await once(ws,'open');ws.send(JSON.stringify({type:'join',room,name:'Opponent',mode:'pvp',createOnly:true}));for(let i=0;i<100&&!latest;i++)await new Promise(r=>setTimeout(r,20));assert.ok(latest);return ws;}
const views=['title-screen','menu-screen','rooms-screen','private-screen','lobby','battle-main'];
async function only(page,id){for(const view of views)assert.equal(await page.locator('#'+view).isVisible(),view===id,`${view} visibility on ${id}`);if(id!=='lobby')assert.equal(await page.locator('header').isVisible(),false);if(!['lobby','battle-main'].includes(id))assert.equal(await page.locator('#chat-panel').isVisible(),false);}
try{
 await waitForServer();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 // Hidden defaults prevent the previous all-screens flash even before JavaScript starts.
 const raw=await browser.newContext({javaScriptEnabled:false});const noJS=await raw.newPage();await noJS.goto(base);await only(noJS,'title-screen');await raw.close();
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:.5});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Native=WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='state')window.lastState=m.state;});}};});
 // Navigation tests keep real assets and sockets, but pause GPU frames on software Chromium.
 if(!process.env.NAV_RENDER)await page.route('**/client.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+';window.pauseNavigationRendering=()=>renderer.setAnimationLoop(null);'});});
 await page.goto(base);if(!process.env.NAV_RENDER){await page.waitForFunction(()=>window.pauseNavigationRendering);await page.evaluate(()=>window.pauseNavigationRendering());}await only(page,'title-screen');await page.screenshot({path:output+'/01-title.png'});
 await page.locator('#press-start').click();await only(page,'menu-screen');await page.locator('#browser-create').click();assert.match(await page.locator('#menu-status').textContent(),/이름/);await only(page,'menu-screen');
 await page.locator('#room-player-name').fill('테스트');await page.screenshot({path:output+'/02-menu.png'});
 const room='NAV_'+Date.now();const opponent=await peer(room);
 await page.locator('#open-public').click();await only(page,'rooms-screen');await page.locator(`[data-room="${room}"]`).waitFor();await page.screenshot({path:output+'/03-public.png'});
 await page.locator(`[data-room="${room}"]`).click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');await only(page,'lobby');assert.equal(await page.locator('#room').inputValue(),room);assert.equal(await page.locator('#enemy-name').textContent(),'Opponent');
 await page.waitForFunction(()=>document.getElementById('asset-status').textContent.includes('준비 완료'));opponent.send(JSON.stringify({type:'ready'}));await page.locator('#start-game').click();await page.waitForFunction(()=>document.body.dataset.screen==='battle');await only(page,'battle-main');
 await page.locator('#return-lobby').click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');await only(page,'lobby');await page.locator('#leave-room').click();await page.waitForFunction(()=>document.body.dataset.screen==='menu');await only(page,'menu-screen');
 console.log('PASS START -> menu -> PUBLIC list -> selected lobby -> battle -> lobby -> menu');
 await page.locator('#browser-create').click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');await only(page,'lobby');assert.match(await page.locator('#room').inputValue(),/^[A-F0-9]{6}$/);await page.locator('#leave-room').click();await page.waitForFunction(()=>document.body.dataset.screen==='menu');
 await page.locator('#open-private').click();await only(page,'private-screen');await page.locator('#private-room-code').fill('MISSING_'+Date.now());await page.locator('#code-join button').click();await page.waitForFunction(()=>document.getElementById('private-status').textContent.includes('종료된 방'));await only(page,'private-screen');
 await page.locator('#private-back').click();await only(page,'menu-screen');await page.locator('#browser-create').click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');await page.locator('#leave-room').click();await page.waitForFunction(()=>document.body.dataset.screen==='menu');
 console.log('PASS HOST opens own lobby; invalid PRIVATE code stays on code screen; reconnect succeeds');
 await page.locator('#menu-ai').click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');assert.equal(await page.evaluate(()=>window.lastState.mode),'ai');await page.locator('#start-game').click();await page.waitForFunction(()=>document.body.dataset.screen==='battle');await only(page,'battle-main');await page.locator('#return-lobby').click();await page.waitForFunction(()=>document.body.dataset.screen==='lobby');await page.locator('#leave-room').click();await page.waitForFunction(()=>document.body.dataset.screen==='menu');
 await page.locator('#menu-back').click();await only(page,'title-screen');await page.keyboard.press('Enter');await only(page,'menu-screen');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/04-mobile-menu.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#open-public').click();await only(page,'rooms-screen');await page.locator('#rooms-back').click();await only(page,'menu-screen');await page.locator('#open-private').click();await only(page,'private-screen');await page.locator('#private-back').click();await only(page,'menu-screen');
 assert.deepEqual(errors,[]);console.log('PASS AI lobby/battle, back navigation, mobile isolation, no browser errors');
}finally{for(const ws of clients)ws.terminate();await browser?.close();server?.kill();}
