import {chromium,devices} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from '../scripts/serve.mjs';
const server=createServer(4178);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']});
await mkdir('test-results',{recursive:true});
const errors=[];
try{
  const desktop=await browser.newPage({viewport:{width:1360,height:900}});
  await desktop.goto('http://127.0.0.1:4178/?test=1');
  await desktop.screenshot({path:'test-results/lobby.png',fullPage:true});await desktop.close();
  const hostContext=await browser.newContext({...devices['Pixel 5'],viewport:{width:851,height:393},deviceScaleFactor:1});
  await hostContext.addInitScript(()=>{
    window.holdAudio=true;
    const resume=AudioContext.prototype.resume;
    AudioContext.prototype.resume=function(){return window.holdAudio?new Promise(()=>{}):resume.call(this);};
  });
  const guestContext=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const host=await hostContext.newPage(), guest=await guestContext.newPage();
  for(const [name,page]of[['host',host],['guest',guest]]){
    page.on('pageerror',e=>{errors.push(e.message);console.error(name,e.stack);});
    page.on('console',m=>{if(m.type()==='error')console.log(name,m.text().slice(0,200));});
  }
  await host.goto('http://127.0.0.1:4178/?test=1');await host.locator('#host-button').tap();
  await host.waitForFunction(()=>window.__mario?.room?.code && window.__mario.room.peer?.open,{},{timeout:45000});
  const code=await host.locator('#room-label').textContent();assert.match(code,/^[A-Z2-9]{2}$/);
  await host.evaluate(()=>{
    const e=window.__mario.engine;
    function run(n){for(let i=0;i<n;i++)e.step();}
    e.input(0,128);run(20);e.input(0,0);run(20);
    e.input(0,16);run(20);e.input(0,0);run(20);
    e.input(0,1);run(2);e.input(0,0);run(180);window.__mario.draw();
  });
  assert.equal(await host.evaluate(()=>window.__mario.engine.nes[0].cpu.mem[0x70a]),1);
  await guest.goto(`http://127.0.0.1:4178/?test=1#room=${code}`);await guest.locator('#join-button').tap();
  await guest.waitForFunction(()=>document.querySelector('#remote-video').videoWidth>0,{},{timeout:45000});
  const media=await guest.evaluate(()=>{const v=document.querySelector('#remote-video');return {width:v.videoWidth,height:v.videoHeight,audio:v.srcObject.getAudioTracks().length,video:v.srcObject.getVideoTracks().length};});
  assert.deepEqual(media,{width:256,height:240,audio:1,video:1});
  console.log('PASS: phone host delivers a separate Luigi video and audio stream',code);
  console.log('PASS: a pending audio resume does not block hosting or video');
  const before=await host.evaluate(()=>window.__mario.engine.nes[1].cpu.mem[0xa2]);
  await guest.keyboard.down('KeyZ');await guest.keyboard.down('ArrowRight');
  await host.waitForFunction(y=>window.__mario.engine.nes[1].cpu.mem[0xa2]!==y,before,{timeout:5000});
  await guest.keyboard.up('KeyZ');await guest.keyboard.up('ArrowRight');
  await host.waitForFunction(()=>window.__mario.engine.masks[1]===0);
  console.log('PASS: guest inputs drive original Luigi physics and release correctly');
  await host.evaluate(()=>window.holdAudio=false);await host.locator('#sound-button').tap();
  await guest.locator('#sound-button').tap();assert.equal(await guest.locator('#remote-video').evaluate(v=>v.muted),false);
  const peak=await guest.evaluate(async()=>{
    const context=new AudioContext();await context.resume();
    const source=context.createMediaStreamSource(document.querySelector('#remote-video').srcObject);
    const analyser=context.createAnalyser();source.connect(analyser);const buffer=new Float32Array(analyser.fftSize);let peak=0;
    for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,50));analyser.getFloatTimeDomainData(buffer);for(const sample of buffer)peak=Math.max(peak,Math.abs(sample));}
    await context.close();return peak;
  });
  assert.ok(peak>.001,`Expected game audio, received peak ${peak}`);console.log('PASS: game audio starts after a host tap',peak);
  await host.screenshot({path:'test-results/phone-host.png'});await guest.screenshot({path:'test-results/phone-guest.png'});
  for(const page of[host,guest])assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight),'Landscape game must fit without scrolling.');
  await host.evaluate(()=>{
    const e=window.__mario.engine;
    for(let i=0;i<500;i++){for(const n of e.nes)n.cpu.mem[0x552]=255;e.input(0,128+(i%60<40?1:0));e.step();}
    e.input(0,0);window.__mario.draw();
  });
  const cameras=await host.evaluate(()=>window.__mario.engine.nes.map(n=>n.cpu.mem[0xfd]+256*n.cpu.mem[0x12]));
  assert.ok(cameras[0]-cameras[1]>256,JSON.stringify(cameras));
  console.log('PASS: independent cameras remain separated by more than a full screen',cameras);
  await host.screenshot({path:'test-results/separate-host.png'});await guest.screenshot({path:'test-results/separate-guest.png'});
  const third=await browser.newPage();await third.goto(`http://127.0.0.1:4178/#room=${code}`);await third.locator('#join-button').click();
  await third.waitForFunction(()=>document.querySelector('#status').textContent.includes('already has two'),{},{timeout:20000});await third.close();
  console.log('PASS: third player rejected');
  await host.evaluate(()=>window.__mario.room.connection.close());
  await host.waitForFunction(()=>!window.__mario.engine.joined,{},{timeout:18000});
  await guest.locator('#retry-button').waitFor({state:'visible',timeout:18000});
  await guest.locator('#retry-button').tap();
  await guest.waitForFunction(()=>window.__mario.room?.accepted && document.querySelector('#remote-video').videoWidth>0,{},{timeout:30000});
  assert.equal(await guest.locator('#room-label').textContent(),code);
  assert.equal(await guest.locator('#retry-button').isVisible(),false);
  console.log('PASS: disconnect and one-tap retry into the same room');
  assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
