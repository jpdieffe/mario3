import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NES} from '../site/vendor/jsnes/index.js';
import {CoopEngine,setPosition} from '../site/engine.js';
import {M} from '../site/memory.js';
import {tileAt} from '../site/weapons.js';
import {validInput} from '../site/protocol.js';
const rom=readFileSync(new URL('../site/roms/mario3.nes',import.meta.url));
let level;
function boot(joined=true){
  const e=new CoopEngine(rom,{NES});
  if(!level){
    e.nes[0].fromJSON(JSON.parse(readFileSync(new URL('../site/start.json',import.meta.url))));
    for(const [mask,count]of [[128,20],[0,20],[16,20],[0,20],[1,2],[0,180]]){e.input(0,mask);for(let i=0;i<count;i++)e.step();}
    level=structuredClone(e.nes[0].toJSON());
  }else e.nes[0].fromJSON(structuredClone(level));
  if(joined)e.join();else e.resetWorld();
  for(const n of e.nes){n.cpu.mem[0xef]=0x40;setPosition(n,24,384);}
  e.weapons.step();return e;
}
function placeTile(e,x,y,value){
  const tile=tileAt(e.nes[0],x,y);assert.ok(tile);
  for(let p=0;p<(e.joined?2:1);p++){e.nes[p].cpu.mem[0x6000+tile.index]=value;e.refreshTile(p,tile.index,value);}
  e.tiles[tile.index]=value;return tile.index;
}
const frames=(e,n)=>{for(let i=0;i<n;i++)e.weapons.step();};

test('Luigi rockets remove collision tiles and redraw bricks in both original-ROM contexts',()=>{
  const e=boot(),index=placeTile(e,80,400,0x67),question=placeTile(e,96,384,0x60);
  const before=e.nes.map(n=>n.ppu.vramMem.slice());
  e.weapons.equip(1,1);e.input(1,2);frames(e,15);
  assert.equal(e.weapons.stats.bricks,1);
  assert.equal(e.tiles[index],0x80);
  for(let p=0;p<2;p++){
    assert.equal(e.nes[p].cpu.mem[0x6000+index],0x80);
    assert.equal(e.nes[p].cpu.mem[0x6000+question],0x60,'Question blocks and their power-ups survive');
    assert.equal(tileAt(e.nes[p],80,400).solid,false,'The removed brick must no longer block the ROM player');
    assert.ok(e.nes[p].ppu.vramMem.some((v,i)=>v!==before[p][i]),'Both cameras must redraw the missing brick');
  }
});

test('rockets work before a partner joins, and a late join inherits destroyed terrain',()=>{
  const e=boot(false),index=placeTile(e,80,400,0x67);
  e.weapons.equip(0,1);e.input(0,2);frames(e,15);e.input(0,0);
  assert.equal(e.nes[0].cpu.mem[0x6000+index],0x80);
  e.join();assert.equal(e.nes[1].cpu.mem[0x6000+index],0x80);
});

test('rifle shots cannot tunnel through a brick to hit an enemy behind it',()=>{
  const e=boot(),index=placeTile(e,80,400,0x67);
  const enemy=e.readActors(0).find(a=>e.nes[0].cpu.mem[0x671+a.slot]===0x72);assert.ok(enemy);
  e.weapons.equip(0,2);e.input(0,2);frames(e,1);
  assert.equal(e.weapons.stats.hits,0);assert.equal(e.nes[0].cpu.mem[0x6000+index],0x67);
  assert.ok(e.weapons.effects.some(f=>f.kind==='trace'&&f.endX<=82));
});

test('a sniper hit removes an ordinary enemy from both simulations without harming the partner',()=>{
  const e=boot();const before=e.nes.map(n=>n.cpu.mem[M.Player_IsDying]);
  e.weapons.equip(1,2);e.input(1,2);frames(e,1);
  assert.ok(e.weapons.stats.hits>=1);
  const dead=[...e.entities.values()].find(v=>v.dead);assert.ok(dead);
  for(let p=0;p<2;p++){
    assert.ok(!e.readActors(p).some(a=>a.key===dead.key));
    assert.equal(e.nes[p].cpu.mem[M.Player_IsDying],before[p]);
  }
  e.input(1,0);for(let i=0;i<3;i++)e.step();
  assert.equal(e.entities.get(dead.key).dead,true,'An enemy killed by either player must not reappear');
});

test('weapon cadence is distinct; releasing B, putting away a gun, and disconnecting stop fire',()=>{
  const counts=[];
  for(const id of [1,2,3]){
    const e=boot();e.weapons.equip(1,id);e.input(1,2);frames(e,60);counts.push(e.weapons.stats.fired[1]);
    e.input(1,0);frames(e,60);assert.equal(e.weapons.stats.fired[1],counts.at(-1));
    e.weapons.equip(1,0);e.input(1,2);frames(e,60);assert.equal(e.weapons.stats.fired[1],counts.at(-1));
    e.weapons.equip(1,id);e.leave();frames(e,60);assert.equal(e.weapons.stats.fired[1],counts.at(-1));
  }
  assert.deepEqual(counts,[2,2,10]);
});

test('scene changes and save loads clear projectiles; vertical tile lookup stays inside its grid',()=>{
  const e=boot();e.weapons.equip(0,1);e.input(0,2);frames(e,1);assert.ok(e.weapons.shots.length);
  e.input(0,0);e.nes[0].cpu.mem[M.Level_LayPtrOrig_AddrL]^=1;frames(e,1);assert.equal(e.weapons.shots.length,0);
  const saved=e.snapshot();e.weapons.equip(0,3);e.restore(saved);assert.equal(e.weapons.equipped[0],1);assert.equal(e.weapons.shots.length,0);
  e.nes[0].cpu.mem[M.Level_7Vertical]=1;
  assert.equal(tileAt(e.nes[0],16,240).index,241);
  assert.equal(tileAt(e.nes[0],256,240),null);assert.equal(tileAt(e.nes[0],16,3840),null);
});

test('network weapon selection accepts only the four supported values',()=>{
  for(const weapon of [0,1,2,3])assert.equal(validInput({type:'input',seq:0,mask:2,weapon}),true);
  for(const weapon of [-1,4,1.5,'1',null,NaN])assert.equal(validInput({type:'input',seq:0,mask:2,weapon}),false);
  assert.equal(validInput({type:'input',seq:0,mask:2}),true,'Existing clients remain compatible');
});
