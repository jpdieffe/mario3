import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NES } from '../site/vendor/jsnes/index.js';
import { CoopEngine, player, setPosition, collidePlayers, composite } from '../site/engine.js';
import { M } from '../site/memory.js';
const rom=readFileSync(new URL('../site/roms/mario3.nes',import.meta.url));
let start;
function run(engine,n){for(let i=0;i<n;i++)engine.step();}
function press(e,mask,n=2){e.input(0,mask);run(e,n);e.input(0,0);run(e,1);}
function boot(){
  const e=new CoopEngine(rom,{NES});
  if(!start){
    run(e,600);press(e,8);run(e,120);press(e,8);run(e,320);
    press(e,128,20);run(e,19);press(e,16,20);run(e,19);press(e,1);run(e,180);
    assert.equal(e.nes[0].cpu.mem[M.Level_Tileset],1);
    start=structuredClone(e.nes[0].toJSON());
  }else e.nes[0].fromJSON(structuredClone(start));
  return e;
}
test('drop-in player uses original ROM physics and independent controls',()=>{
  const e=boot();e.join();const mario=player(e.nes[0]);const luigi=player(e.nes[1]);
  assert.ok(Math.abs(mario.x-luigi.x)<=24);
  e.input(1,129);run(e,30);
  assert.equal(player(e.nes[0]).x,mario.x);
  assert.ok(player(e.nes[1]).x>luigi.x);
  assert.ok(player(e.nes[1]).y<luigi.y);
  assert.equal(e.nes[1].cpu.mem[M.Player_Current],1);
  assert.equal(e.nes[1].ppu.vramMem[0x3f11],0x2a);
});
test('head bounce changes original-ROM velocity; side collision separates both players',()=>{
  const e=boot();e.join();const [a,b]=e.nes;
  setPosition(a,60,366);setPosition(b,60,384);
  const oldA=player(a),oldB=player(b);
  setPosition(a,60,369);a.cpu.mem[M.Player_YVel]=32;
  assert.equal(collidePlayers(a,b,oldA,oldB,true),'mario-bounce');
  assert.ok(player(a).vy<0);
  assert.equal(player(b).y,384);
  setPosition(a,60,384);setPosition(b,65,384);
  assert.equal(collidePlayers(a,b,player(a),player(b)),'bump');
  assert.ok(player(b).x-player(a).x>=12);
});
test('cameras can separate by more than a screen without dragging the other player',()=>{
  const e=boot();e.join();
  for(let i=0;i<500;i++){
    for(const n of e.nes)n.cpu.mem[M.Player_FlashInv]=255;
    e.input(0,128+(i%60<40?1:0));
    e.step();
  }
  assert.ok(player(e.nes[0]).cameraX-player(e.nes[1]).cameraX>256,
    JSON.stringify(e.nes.map(player)));
  assert.ok(player(e.nes[1]).x<80);
});
test('terrain mutation propagates in both directions',()=>{
  const e=boot();e.join();
  const address=0x6000+25*16+8;
  e.nes[1].cpu.mem[address]=0x40;e.shareTiles();
  assert.equal(e.nes[0].cpu.mem[address],0x40);
  e.nes[0].cpu.mem[address]=0x41;e.shareTiles();
  assert.equal(e.nes[1].cpu.mem[address],0x41);
});
test('partner sprites are composited into both independent views',()=>{
  const e=boot();e.join();run(e,4);
  const output=new Uint32Array(256*240);composite(e,0,output);
  assert.ok(output.some((pixel,i)=>pixel!==e.frames[0][i]));
});
test('a disconnected player stops simulation and a new join uses current state',()=>{
  const e=boot();e.join();e.input(1,128);run(e,20);e.leave();
  const previous=player(e.nes[1]);run(e,30);assert.deepEqual(player(e.nes[1]),previous);
  e.join();assert.ok(Math.abs(player(e.nes[0]).x-player(e.nes[1]).x)<=24);
});
test('joining on the world map carries both players into the original level',()=>{
  const e=new CoopEngine(rom,{NES});e.nes[0].fromJSON(JSON.parse(readFileSync(new URL('../site/start.json',import.meta.url))));
  e.join();press(e,128,20);run(e,19);press(e,16,20);run(e,19);press(e,1);run(e,180);
  assert.equal(e.nes[0].cpu.mem[M.Level_Tileset],1);assert.equal(e.nes[1].cpu.mem[M.Level_Tileset],1);
  const before=player(e.nes[1]);e.input(1,129);run(e,30);
  assert.ok(player(e.nes[1]).x>before.x);assert.ok(player(e.nes[1]).y<before.y);
});
test('actor state transitions are shared and off-screen culling is not a shared kill',()=>{
  const e=boot();e.join();run(e,2);
  const actor=e.readActors(0).find(a=>a.data[15]!==0);
  assert.ok(actor);
  const candidates=e.readActors(1);const copy=candidates.find(a=>a.key===actor.key);assert.ok(copy);
  const before=[e.readActors(0),e.readActors(1)];
  e.nes[1].cpu.mem[0x661+copy.slot]=7;
  e.mergeActors(before);assert.equal(e.nes[0].cpu.mem[0x661+actor.slot],7);
  const offscreen=[e.readActors(0),e.readActors(1)];
  e.nes[0].cpu.mem[M.Horz_Scroll_Hi]=4;e.nes[0].cpu.mem[0x661+actor.slot]=0;
  e.mergeActors(offscreen);
  assert.equal(e.entities.get(actor.key).dead,false,'Culling outside Mario’s view must preserve Luigi’s actor.');
});
test('save/load restores a playable original-ROM scene without altering CHR graphics',()=>{
  const e=boot();e.join();run(e,4);
  const original=e.nes[0].rom.vromTile[20][200].pix.slice();const saved=JSON.parse(JSON.stringify(e.snapshot()));
  e.input(0,129);run(e,20);e.restore(saved);run(e,4);
  assert.equal(player(e.nes[0]).x,24);assert.deepEqual(e.nes[0].rom.vromTile[20][200].pix,original);
  assert.ok(new Set(e.frames[0]).size>=8);
});
test('falling into a pit respawns beside the living partner instead of pulling both to the map',()=>{
  const e=boot();e.join();setPosition(e.nes[0],24,440);run(e,100);
  assert.equal(e.nes[0].cpu.mem[M.Level_Tileset],1);
  assert.equal(player(e.nes[0]).dead,false);assert.ok(Math.abs(player(e.nes[0]).x-player(e.nes[1]).x)<30);
});
test('alternate-room junction flag does not lock Luigi into a shared transition',()=>{
  const e=boot();e.join();for(const n of e.nes)n.cpu.mem[M.Level_JctFlag]=1;
  const before=player(e.nes[1]);e.input(1,129);run(e,30);
  assert.ok(player(e.nes[1]).x>before.x);assert.equal(e.transition,null);
});
