import { NES } from './vendor/jsnes/index.js';
import { CoopEngine, composite, inLevel } from './engine.js';
import { GameAudio } from './audio.js';
import { Room } from './room.js';
import { parseRoomCode } from './protocol.js';
import { setupControls } from './controls.js';
import { WEAPONS } from './weapons.js';

const $=id=>document.getElementById(id);
let engine,room,audio,guestAudio,media,role,loop,previous=0,accumulator=0,busy=false;
let toastTimer,wakeLock,selectedWeapon=0;
const canvases=[$('game'),$('guest-canvas')];
const contexts=canvases.map(c=>c.getContext('2d',{alpha:false}));
const images=contexts.map(c=>c.createImageData(256,240));
const outputs=images.map(i=>new Uint32Array(i.data.buffer));
const pixels=[new Uint32Array(256*240),new Uint32Array(256*240)];
const controls=setupControls(mask=>{if(role==='host')engine?.input(0,mask);else room?.setInput(mask);});

function status(text,persistent=false){$('status').textContent=text;clearTimeout(toastTimer);if(!persistent)toastTimer=setTimeout(()=>$('status').textContent='',6500);}
function message(text){$('screen-message').hidden=!text;$('screen-message').textContent=text;}
function selectWeapon(id,announce=true){
  selectedWeapon=id;
  document.querySelectorAll('[data-weapon]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.weapon)===id)));
  $('weapon-hint').textContent=id?'B fires · ↑ / ↓ aim':'Tap to equip · tap again to put away';
  $('b-caption').textContent=id?'RUN / FIRE':'RUN';
  document.querySelector('.button-b').setAttribute('aria-label',id?'B fire weapon and run':'B run or hold');
  if(role==='host')engine?.weapons.equip(0,id);else room?.setWeapon(id);
  if(announce)status(id?`${WEAPONS[id].name} equipped. Hold B / X to fire.`:'Weapon put away.');
}
function showGame(host){
  role=host?'host':'guest';$('lobby').hidden=true;$('play').hidden=false;document.body.classList.add('playing');
  $('game').hidden=!host;$('remote-video').hidden=host;
  $('player-label').textContent=host?'MARIO':'LUIGI';$('partner-label').textContent=host?'Waiting for Luigi':'Connecting to Mario';
  $('save-button').disabled=!host;$('load-button').disabled=!host;
  $('retry-button').hidden=true;
  selectWeapon(0,false);
  controls.enable(true);message(host?'Loading the original game…':'Connecting to your friend…');
  navigator.wakeLock?.request('screen').then(lock=>wakeLock=lock).catch(()=>{});
}
function draw(){
  for(let p=0;p<2;p++){
    if(p===1&&!engine.joined)pixels[p].set(engine.frames[0]);else composite(engine,p,pixels[p]);
    for(let i=0;i<pixels[p].length;i++)outputs[p][i]=pixels[p][i]|0xff000000;
    contexts[p].putImageData(images[p],0,0);
    if(p===0||engine.joined)engine.weapons.draw(contexts[p],p);
  }
}
function tick(now){
  loop=requestAnimationFrame(tick);
  if(!engine || document.hidden){previous=now;accumulator=0;return;}
  if(!previous)previous=now;
  accumulator+=Math.min(now-previous,70);previous=now;
  let frames=0;
  try{while(accumulator>=1000/60&&frames<4){engine.step();accumulator-=1000/60;frames++;}if(frames)draw();}
  catch(error){cancelAnimationFrame(loop);status(`Game stopped: ${error.message}. Load your save or leave and create a new room.`,true);room?.broadcast('The host’s game stopped. Ask them to load a save.');console.error(error);}
}
function settings(){try{return JSON.parse(localStorage.getItem('mario3-network')||'{}');}catch{return {};}}
function regroup(){if(!engine?.joined)return;engine.copy(0,1,{keepSuit:true});engine.resetWorld();engine.grace=90;status('Luigi is back beside Mario.');}
function makeRoom(){
  return new Room({
    connected(){
      $('partner-label').textContent=role==='host'?'Luigi connected':'Mario connected';
      $('connection-label').textContent='P2P CONNECTED';
      if(role==='host'){
        engine.join();draw();
        media?.getTracks().filter(t=>t.kind==='video').forEach(t=>t.stop());
        media=canvases[1].captureStream(30);
        guestAudio?.destination?.stream.getAudioTracks().forEach(track=>media.addTrack(track));
        room.stream(media);room.broadcast('Luigi joined. You have your own camera.','playing');
        status('Luigi joined your adventure.');
      }else message('Connected. Starting your view…');
    },
    stream(stream){
      const video=$('remote-video');video.srcObject=stream;video.muted=true;
      video.onloadeddata=()=>{message('');$('sound-button').textContent='Sound on';};
      video.play().then(()=>message('')).catch(()=>message('Tap Sound on to start your view.'));
    },
    input(mask,weapon){engine?.input(1,mask);if(weapon!==undefined)engine?.weapons.equip(1,weapon);},
    regroup,
    status(text){status(text);if(role==='guest'&&!$('remote-video').videoWidth)message(text);},
    latency(ms){$('connection-label').textContent=`P2P · ${Math.round(ms)} MS`;},
    error(text){status(text,true);if(role==='guest'){$('retry-button').hidden=false;if(!$('remote-video').videoWidth)message(text);}},
    disconnected(){
      $('partner-label').textContent=role==='host'?'Waiting for Luigi':'Host disconnected';
      $('connection-label').textContent='DISCONNECTED';
      if(role==='host'){engine.leave();status('Luigi left. They can rejoin with the same code.');}
      else {controls.enable(false);$('retry-button').hidden=false;message('The host disconnected. Tap Retry to reconnect.');}
    },
    mediaClosed(){if(role==='guest'&&room?.accepted){$('retry-button').hidden=false;message('Video disconnected. Tap Retry to reconnect.');}},
  },settings());
}
async function host(){
  if(busy||role)return;busy=true;
  try{
    audio=new GameAudio();guestAudio=new GameAudio({audible:false});showGame(true);
    const updateSound=()=>{$('sound-button').textContent=audio?.context?.state==='running'&&audio?.gain?.gain.value?'Mute':'Sound on';};
    if(audio.context)audio.context.onstatechange=updateSound;updateSound();
    const [romResponse,stateResponse]=await Promise.all([fetch('roms/mario3.nes'),fetch('start.json')]);
    if(!romResponse.ok||!stateResponse.ok)throw new Error('Game files could not load. Reload and try again.');
    const [rom,state]=await Promise.all([romResponse.arrayBuffer(),stateResponse.json()]);
    engine=new CoopEngine(new Uint8Array(rom),{NES,onAudio:(l,r,p)=>{
      if(p===0){audio?.push(l,r);if(!engine?.joined||!inLevel(engine.nes[0])||engine.transition?.leader===0)guestAudio?.push(l,r);}
      else{guestAudio?.push(l,r);if(engine?.transition?.leader===1)audio?.push(l,r);}
    },onEvent:text=>status(text)});
    engine.weapons.equip(0,selectedWeapon);
    engine.nes[0].fromJSON(state);engine.nes[0].frame();draw();message('');
    previous=0;accumulator=0;loop=requestAnimationFrame(tick);
    room=makeRoom();const code=await room.open(true);
    $('room-label').textContent=code;location.hash=`room=${code}`;
    status(`Room ${code} is ready. Share the code with your friend.`);
  }catch(error){status(error.message,true);if(!engine)leave(false);}
  finally{busy=false;}
}
async function join(event){
  event?.preventDefault();if(busy||role)return;
  const code=parseRoomCode($('room-input').value);
  if(!code){status('Enter the two-character room code, such as AB.');$('room-input').focus();return;}
  busy=true;showGame(false);$('room-label').textContent=code;
  try{room=makeRoom();room.setWeapon(selectedWeapon);await room.open(false,code);location.hash=`room=${code}`;}
  catch(error){status(error.message,true);message(error.message);$('retry-button').hidden=false;}
  finally{busy=false;}
}
function leave(clearStatus=true){
  cancelAnimationFrame(loop);controls.enable(false);room?.close();room=null;
  media?.getVideoTracks().forEach(t=>t.stop());media=null;audio?.close();audio=null;guestAudio?.close();guestAudio=null;engine=null;
  $('remote-video').pause();$('remote-video').srcObject=null;role=null;busy=false;
  wakeLock?.release().catch(()=>{});wakeLock=null;
  $('play').hidden=true;$('lobby').hidden=false;document.body.classList.remove('playing');
  $('menu').close();message('');if(clearStatus)status('Room closed.');
  history.replaceState(null,'',location.pathname+location.search);
}
$('host-button').addEventListener('click',host);
$('join-form').addEventListener('submit',join);
document.querySelectorAll('[data-weapon]').forEach(button=>button.addEventListener('click',()=>{
  if(!role)return;const id=Number(button.dataset.weapon);selectWeapon(selectedWeapon===id?0:id);
}));
window.addEventListener('keydown',event=>{
  if(!role||event.repeat||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  const id={Digit1:1,Digit2:2,Digit3:3}[event.code];
  if(id){event.preventDefault();selectWeapon(selectedWeapon===id?0:id);}
});
$('retry-button').addEventListener('click',()=>{const code=room?.code;leave(false);if(code){$('room-input').value=code;join();}});
$('leave-button').addEventListener('click',()=>leave());
$('copy-room').addEventListener('click',async()=>{
  if(!room?.code)return;
  const url=new URL(location.href);url.hash=`room=${room.code}`;
  try{await navigator.clipboard.writeText(url.href);status(`Invite copied. Room ${room.code}.`);}
  catch{status(`Your room code is ${room.code}.`,true);}
});
$('sound-button').addEventListener('click',()=>{
  if(role==='host'){
    const suspended=audio?.context?.state!=='running';
    audio?.resume();guestAudio?.resume();if(audio?.gain){audio.gain.gain.value=suspended?1:(audio.gain.gain.value?0:1);$('sound-button').textContent=audio.gain.gain.value?'Mute':'Sound on';}
  }else{
    const video=$('remote-video');video.muted=!video.muted;video.play().then(()=>message('')).catch(error=>status(error.message));
    $('sound-button').textContent=video.muted?'Sound on':'Mute';
  }
});
$('fullscreen-button').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status('For a larger view on iPhone, add this page to your Home Screen.');}
  try{await screen.orientation?.lock('landscape');}catch{}
});
for(const [button,dialog] of [['help-button','help'],['menu-button','menu']])$(button).addEventListener('click',()=>{controls.clear();$(dialog).showModal();});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
$('save-button').addEventListener('click',()=>{
  if(!engine)return;try{localStorage.setItem('mario3-save',JSON.stringify(engine.snapshot()));status('Progress saved on this device.');$('menu').close();}catch{status('This browser could not store the save. Check available storage.');}
});
$('load-button').addEventListener('click',()=>{
  if(!engine)return;try{const data=localStorage.getItem('mario3-save');if(!data)throw new Error('No saved progress on this device yet.');engine.restore(JSON.parse(data));selectWeapon(engine.weapons.equipped[0],false);$('menu').close();status('Progress restored.');}catch(error){status(error.message);}
});
$('regroup-button').addEventListener('click',()=>{if(role==='host')regroup();else {room?.send({type:'regroup'});status('Asked Mario to regroup.');}$('menu').close();});
$('network-save').addEventListener('click',()=>{
  const turn=$('turn-url').value.trim();if(turn&&!/^turns?:\S+$/.test(turn)){status('Enter a TURN URL beginning with turn: or turns:.');return;}
  try{localStorage.setItem('mario3-network',JSON.stringify({turn,username:$('turn-user').value,credential:$('turn-password').value}));status('Connection settings saved.');}catch{status('Could not save connection settings.');}
});
const savedSettings=settings();$('turn-url').value=savedSettings.turn||'';$('turn-user').value=savedSettings.username||'';$('turn-password').value=savedSettings.credential||'';
const invite=parseRoomCode(location.href);if(invite)$('room-input').value=invite;
document.addEventListener('visibilitychange',()=>{
  if(role==='host')room?.broadcast(document.hidden?'Host paused: return to the game on the host’s phone.':'Host is back.','playing');
  previous=0;accumulator=0;
});
window.addEventListener('pagehide',()=>room?.close());
window.addEventListener('pageshow',event=>{if(event.persisted&&role){leave();status('The browser closed this connection. Create or join a room again.');}});
if(new URLSearchParams(location.search).has('test'))window.__mario={get engine(){return engine;},get room(){return room;},draw};
