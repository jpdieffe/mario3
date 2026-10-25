import { M, OBJECT_FIELDS } from './memory.js';

const signed = n => n > 127 ? n - 256 : n;
const TILE_START = 0x6000, TILE_END = 0x7950;
const FIELDS = OBJECT_FIELDS.filter(([name]) => name !== 'Objects_PlayerHitStat');
const fieldIndex = name => FIELDS.findIndex(([n]) => n === name);
const STATE = fieldIndex('Objects_State'), ID = fieldIndex('Level_ObjectID');
const SPAWN = fieldIndex('Objects_SpawnIdx');
const X = fieldIndex('Objects_X'), XHI = fieldIndex('Objects_XHi');
const Y = fieldIndex('Objects_Y'), YHI = fieldIndex('Objects_YHi');

export function player(nes) {
  const m = nes.cpu.mem;
  return { x:m[M.Player_X] + 256*m[M.Player_XHi], y:m[M.Player_Y] + 256*m[M.Player_YHi],
    vx:signed(m[M.Player_XVel]), vy:signed(m[M.Player_YVel]),
    height:m[M.Player_Suit] ? 28 : 16, dead:!!m[M.Player_IsDying],
    cameraX:m[M.Horz_Scroll] + 256*m[M.Horz_Scroll_Hi],
    cameraY:m[M.Level_VertScroll] + 256*m[M.Level_VertScrollH] };
}
export function setPosition(nes, x, y) {
  const m = nes.cpu.mem;
  x=Math.max(0,Math.round(x)); y=Math.max(0,Math.round(y));
  m[M.Player_X]=x&255; m[M.Player_XHi]=(x>>8)&255;
  m[M.Player_Y]=y&255; m[M.Player_YHi]=(y>>8)&255;
}
export function inLevel(nes) { const t=nes.cpu.mem[M.Level_Tileset]; return t>0 && t<15; }
export function sceneKey(nes) {
  const m=nes.cpu.mem;
  return [M.Level_Tileset,M.Level_LayPtrOrig_AddrL,M.Level_LayPtrOrig_AddrH,
    M.Level_ObjPtrOrig_AddrL,M.Level_ObjPtrOrig_AddrH].map(a=>m[a]).join(':');
}
function scriptedTransition(nes) {
  const m=nes.cpu.mem;
  // Level_JctFlag is a persistent alternate-room toggle, NOT an animation flag.
  // Player_InPipe can also be left set by the original death action dispatcher.
  return !m[M.Player_IsDying] && !!(m[M.Player_InPipe]||m[M.Level_PipeMove]||m[M.Player_EndLevel]);
}

// The ROM's Y is the top of a 32-pixel sprite, even for small Mario.
function box(p) { return {left:p.x+2,right:p.x+14,top:p.y+32-p.height,bottom:p.y+32}; }
export function collidePlayers(a, b, oldA, oldB, jumpA=false, jumpB=false) {
  const pa=player(a), pb=player(b), A=box(pa), B=box(pb), OA=box(oldA), OB=box(oldB);
  if(pa.dead || pb.dead || A.right<=B.left || B.right<=A.left || A.bottom<B.top || B.bottom<A.top) return null;
  const bounce=(top,bottom,tp,bp,jump)=>{
    setPosition(top,tp.x,bp.y+32-bp.height-32);
    top.cpu.mem[M.Player_YVel]=(jump ? -72 : -56)&255;
    top.cpu.mem[M.Player_InAir]=1;
    // A grounded partner supports the bounce; do not push them through the floor.
    if(bottom.cpu.mem[M.Player_InAir]) bottom.cpu.mem[M.Player_YVel]=Math.max(0,bp.vy)&255;
  };
  if(pa.vy>=pb.vy && OA.bottom<=OB.top+5) { bounce(a,b,pa,pb,jumpA); return 'mario-bounce'; }
  if(pb.vy>=pa.vy && OB.bottom<=OA.top+5) { bounce(b,a,pb,pa,jumpB); return 'luigi-bounce'; }
  if(Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top)<4) return null;
  const left=pa.x<=pb.x, overlap=left?A.right-B.left:B.right-A.left;
  const shift=Math.ceil(overlap/2);
  setPosition(a,pa.x+(left?-shift:shift),pa.y);
  setPosition(b,pb.x+(left?shift:-shift),pb.y);
  a.cpu.mem[M.Player_XVel]=(left?-12:12)&255;
  b.cpu.mem[M.Player_XVel]=(left?12:-12)&255;
  return 'bump';
}

/** Two original-ROM simulation contexts, one host-owned shared world.
 * Each context retains its own player physics, scrolling, PPU and sound state.
 * Terrain edits and persistent actors are reconciled at frame boundaries.
 * No client is trusted to supply RAM, positions, or save states.
 */
export class CoopEngine {
  constructor(rom, {NES, onAudio=()=>{}, onEvent=()=>{}}) {
    this.rom=rom; this.NES=NES; this.onEvent=onEvent;
    this.frames=[new Uint32Array(256*240),new Uint32Array(256*240)];
    this.nes=[0,1].map(p=>{
      const nes=new NES({emulateSound:true,onFrame:frame=>this.frames[p].set(frame),
        onAudioSample:(l,r)=>onAudio(l,r,p),sampleRate:44100});
      nes.loadROM(rom); return nes;
    });
    this.masks=[0,0]; this.joined=false; this.frame=0; this.grace=0;
    this.entities=new Map(); this.slotKeys=[Array(8).fill(null),Array(8).fill(null)];
    this.serial=0; this.deaths=[0,0]; this.paused=false; this.transition=null; this.stats={bounces:0,bumps:0,tileEdits:0};
  }
  input(p,mask) {
    // UI mask follows NES button order: A,B,Select,Start,Up,Down,Left,Right.
    if((mask&8) && !(this.masks[p]&8) && inLevel(this.nes[0])) {
      this.paused=!this.paused; this.onEvent(this.paused?'Paused':'Playing');
    }
    this.masks[p]=mask&255;
  }
  applyInput(p) {
    const n=this.nes[p], mask=this.masks[p] & (inLevel(n)?247:255);
    const port=p+1;
    for(let b=0;b<8;b++) (mask&(1<<b)) ? n.buttonDown(port,b) : n.buttonUp(port,b);
    for(let b=0;b<8;b++) n.buttonUp(3-port,b);
  }
  copy(from,to,{keepSuit=false}={}) {
    const suit=this.nes[to].cpu.mem[M.Player_Suit];
    this.nes[to].fromJSON(structuredClone(this.nes[from].toJSON()));
    this.frames[to].set(this.frames[from]);
    if(keepSuit) this.nes[to].cpu.mem[M.Player_Suit]=suit;
    this.nes[to].cpu.mem[M.Player_Current]=to;
    this.slotKeys[to]=[...this.slotKeys[from]];
    this.applyInput(to);
  }
  join() {
    this.joined=true; this.copy(0,1); this.resetWorld(); this.grace=90;
    const p=player(this.nes[0]);
    if(inLevel(this.nes[0])) setPosition(this.nes[1],Math.max(p.cameraX+8,p.x-18),p.y);
    this.onEvent('Luigi joined');
  }
  leave() { if(this.transition?.leader===1)this.copy(1,0,{keepSuit:true});this.transition=null;this.joined=false; this.input(1,0); this.entities.clear(); }
  resetWorld() {
    this.key=sceneKey(this.nes[0]);
    this.tiles=Uint8Array.from(this.nes[0].cpu.mem.slice(TILE_START,TILE_END));
    this.entities.clear(); this.slotKeys=[Array(8).fill(null),Array(8).fill(null)];
    this.deaths=[0,0];
  }
  recolor(p) {
    if(p!==1 || !inLevel(this.nes[p])) return;
    const n=this.nes[p], suit=n.cpu.mem[M.Player_Suit];
    n.cpu.mem[M.Player_Current]=1;
    if(suit===0 || suit===1 || suit===3) {
      n.ppu.mirroredWrite(0x3f11,0x2a);
      n.cpu.mem[M.Palette_Buffer+0x11]=0x2a;
    }
  }
  step() {
    if(this.paused) return;
    this.frame++;
    if(!this.joined) { this.applyInput(0); this.nes[0].frame(); return; }
    if(this.transition){this.advanceTransition();return;}
    const a=this.nes[0], b=this.nes[1];
    if(!inLevel(a)) {
      this.applyInput(0); a.frame(); this.frames[1].set(this.frames[0]);
      if(inLevel(a)) { this.copy(0,1); this.resetWorld(); this.grace=90; }
      return;
    }
    if(!this.tiles || sceneKey(a)!==this.key || sceneKey(b)!==this.key) {
      const leader=sceneKey(b)!==this.key && sceneKey(a)===this.key ? 1 : 0;
      this.copy(leader,1-leader,{keepSuit:true}); this.resetWorld(); this.grace=60;
    }
    // Pipes, goal animations, and room changes are a shared transition. Their
    // original scripted logic executes once, then both contexts resume there.
    const transition=[a,b].findIndex(scriptedTransition);
    if(transition>=0) {
      this.transition={leader:transition};this.advanceTransition();
      return;
    }
    const old=[player(a),player(b)];
    const before=[this.readActors(0),this.readActors(1)];
    for(let p=0;p<2;p++) {
      this.restoreActors(p,before[p]); this.applyInput(p); this.recolor(p);
      this.nes[p].frame(); this.recolor(p);
    }
    // A new room wins over any deltas from the old scene.
    if(sceneKey(a)!==this.key || sceneKey(b)!==this.key) {
      const leader=sceneKey(a)!==this.key?0:1;
      this.copy(leader,1-leader,{keepSuit:true}); this.resetWorld(); this.grace=60; return;
    }
    this.shareTiles();
    this.mergeActors(before);
    for(let p=0;p<2;p++) {
      this.deaths[p]=player(this.nes[p]).dead?this.deaths[p]+1:0;
      if(this.deaths[p]>45 && !player(this.nes[1-p]).dead) {
        this.copy(1-p,p); this.nes[p].cpu.mem[M.Player_Suit]=0;
        this.nes[p].cpu.mem[M.Player_FlashInv]=120;
        this.deaths[p]=0; this.grace=90; this.onEvent(p?'Luigi rejoined Mario':'Mario rejoined Luigi');
      }
    }
    if(this.grace>0) this.grace--;
    else {
      const hit=collidePlayers(a,b,old[0],old[1],!!(this.masks[0]&1),!!(this.masks[1]&1));
      if(hit==='bump') this.stats.bumps++;
      else if(hit) this.stats.bounces++;
    }
  }
  advanceTransition() {
    const leader=this.transition.leader,n=this.nes[leader],m=n.cpu.mem;
    this.applyInput(leader);n.frame();this.frames[1-leader].set(this.frames[leader]);
    if(m[M.Player_IsDying]){this.transition=null;return;}
    if(!inLevel(n) || !scriptedTransition(n)){
      this.copy(leader,1-leader,{keepSuit:true});this.transition=null;this.resetWorld();this.grace=60;
    }
  }
  readActors(p) {
    const m=this.nes[p].cpu.mem, result=[];
    for(let slot=0;slot<8;slot++) {
      if(!m[0x661+slot]) { this.slotKeys[p][slot]=null; continue; }
      const data=FIELDS.map(([,addr,count])=>slot<count?m[addr+slot]:0);
      const spawn=data[SPAWN];
      let key=spawn<48 ? `level:${spawn}` : this.slotKeys[p][slot];
      if(!key || (spawn>=48 && key.startsWith('level:'))) key=`dynamic:${p}:${this.serial++}`;
      this.slotKeys[p][slot]=key;
      result.push({key,slot,data,x:data[X]+256*data[XHI],y:data[Y]+256*data[YHI]});
    }
    return result;
  }
  restoreActors(p,actors) {
    const n=this.nes[p], m=n.cpu.mem;
    for(const actor of actors) {
      const saved=this.entities.get(actor.key);
      if(!saved) continue;
      if(saved.dead) { m[0x661+actor.slot]=0; if(actor.data[SPAWN]<48)m[0x7b10+actor.data[SPAWN]]=0x80; continue; }
      this.writeActor(p,actor.slot,saved.data);
    }
    // A power-up or other dynamic actor created by the partner needs an actual
    // local ROM actor too. Place it in a regular free slot when it enters view.
    const view=player(n);
    for(const [key,entity] of this.entities) {
      if(entity.dead || !key.startsWith('dynamic:') || this.slotKeys[p].includes(key))continue;
      if(Math.abs(entity.x-view.x)>180 || Math.abs(entity.y-view.y)>180)continue;
      let slot=-1; for(let s=4;s>=0;s--) if(!m[0x661+s]){slot=s;break;}
      if(slot<0)break;
      this.writeActor(p,slot,entity.data); this.slotKeys[p][slot]=key;
    }
  }
  writeActor(p,slot,data) {
    const m=this.nes[p].cpu.mem;
    FIELDS.forEach(([,addr,count],i)=>{if(slot<count)m[addr+slot]=data[i];});
  }
  mergeActors(before) {
    const after=[this.readActors(0),this.readActors(1)], candidates=new Map();
    for(let p=0;p<2;p++) for(const actor of after[p]) {
      if(!candidates.has(actor.key))candidates.set(actor.key,[]);
      candidates.get(actor.key).push({...actor,p});
    }
    for(const [key,choices] of candidates) {
      const previous=this.entities.get(key);
      // A stomp, pickup, kicked shell, or damage transition outranks ordinary
      // movement. Otherwise the closest player owns that actor's next state.
      choices.sort((a,b)=>{
        const changed=v=>previous && v.data[STATE]!==previous.data[STATE] ? -10000 : 0;
        const distance=v=>Math.abs(v.x-player(this.nes[v.p]).x)+Math.abs(v.y-player(this.nes[v.p]).y);
        return changed(a)+distance(a)-changed(b)-distance(b);
      });
      const chosen=choices[0];
      if(previous?.dead)continue;
      this.entities.set(key,{...chosen,data:[...chosen.data],dead:false});
    }
    for(let p=0;p<2;p++) for(const actor of before[p]) {
      if(after[p].some(next=>next.key===actor.key))continue;
      const view=player(this.nes[p]);
      // Off-screen culling is local; a visible disappearance is a shared kill
      // or pickup. Keep distant actors so the other camera can still own them.
      const visible=actor.x>=view.cameraX-8 && actor.x<=view.cameraX+240 && actor.y>=view.cameraY-24 && actor.y<=view.cameraY+200;
      if(visible) this.entities.set(actor.key,{...actor,data:[...actor.data],dead:true});
    }
    for(let p=0;p<2;p++) for(const actor of after[p]) {
      const saved=this.entities.get(actor.key);
      if(saved?.dead) {this.nes[p].cpu.mem[0x661+actor.slot]=0;if(actor.data[SPAWN]<48)this.nes[p].cpu.mem[0x7b10+actor.data[SPAWN]]=0x80;}
      else if(saved)this.writeActor(p,actor.slot,saved.data);
    }
  }
  shareTiles() {
    const [a,b]=this.nes.map(n=>n.cpu.mem);
    for(let i=0;i<this.tiles.length;i++) {
      const addr=TILE_START+i, previous=this.tiles[i], av=a[addr], bv=b[addr];
      if(av===previous && bv===previous)continue;
      const value=av!==previous?av:bv;
      this.tiles[i]=value; this.stats.tileEdits++;
      if(av!==value){a[addr]=value;this.refreshTile(0,i,value);}
      if(bv!==value){b[addr]=value;this.refreshTile(1,i,value);}
    }
  }
  refreshTile(p,index,value) {
    const n=this.nes[p], m=n.cpu.mem, view=player(n), vertical=m[M.Level_7Vertical];
    const screen=Math.floor(index/(vertical?240:432));
    const offset=index%(vertical?240:432);
    const x=(vertical?0:screen*256)+(offset%16)*16;
    const y=(vertical?screen*240:0)+Math.floor(offset/16)*16;
    if(x+16<view.cameraX || x>view.cameraX+256 || y+16<view.cameraY || y>view.cameraY+224)return;
    const banks=[11,15,21,16,17,19,18,18,18,20,23,19,17,19,13];
    const bank=banks[m[M.Level_Tileset]];
    if(bank===undefined)return;
    const base=16+bank*8192;
    for(let qx=0;qx<2;qx++)for(let qy=0;qy<2;qy++) {
      const col=((x>>3)+qx)%32,row=((y>>3)+qy)%30;
      const table=0x2000+((Math.floor(y/240)%2)*0x800);
      n.ppu.mirroredWrite(table+row*32+col,this.rom[base+(qx*2+qy)*256+value]);
    }
    const row=Math.floor(y/8)%30,col=Math.floor(x/8)%32;
    const addr=0x23c0+(Math.floor(y/240)%2)*0x800+Math.floor(row/4)*8+Math.floor(col/4);
    const shift=((row&2)?4:0)+((col&2)?2:0);
    const previous=n.ppu.vramMem[n.ppu.vramMirrorTable[addr]];
    n.ppu.mirroredWrite(addr,(previous&~(3<<shift))|((value>>6)<<shift));
  }
  snapshot() {return {version:1,rom:'smb3-us-rev1',state:this.nes[0].toJSON()};}
  restore(saved) {
    if(saved?.version!==1 || saved.rom!=='smb3-us-rev1')throw new Error('This save is for a different game version.');
    this.nes[0].fromJSON(saved.state); this.input(0,0); this.paused=false;this.transition=null;
    if(this.joined)this.join();
  }
}

// Composite the partner's original CHR/OAM sprites in the local world's
// coordinates. The NES still draws its own character and the complete level.
export function composite(engine,p,output) {
  const local=engine.nes[p], other=engine.nes[1-p];
  output.set(engine.frames[p]);
  if(!engine.joined || engine.transition || !inLevel(local) || sceneKey(local)!==sceneKey(other))return output;
  const lp=player(local), rp=player(other), pp=other.ppu;
  const root=Math.floor(other.cpu.mem[M.Player_SprOff]/4);
  const dx=rp.cameraX-lp.cameraX, dy=rp.cameraY-lp.cameraY;
  for(let s=root;s<root+6 && s<64;s++) {
    const sy=pp.sprY[s]+1, sx=pp.sprX[s];
    if(sy>=224)continue;
    // At the end of the NES frame the HUD has already banked out the player
    // graphics. Read the player's selected CHR bank, not that HUD-time cache.
    const tile=pp.sprTile[s], bank=other.cpu.mem[0x71b];
    const tiles=other.rom.vromTile[Math.floor(bank/4)];
    const top=(bank%4)*64+(tile&0x3e);
    for(let y=0;y<16;y++)for(let x=0;x<8;x++) {
      const fy=pp.vertFlip[s]?15-y:y, fx=pp.horiFlip[s]?7-x:x;
      const color=tiles[top+(fy>>3)]?.pix[(fy&7)*8+fx];
      if(!color)continue;
      const tx=Math.round(sx+dx+x), ty=Math.round(sy+dy+y);
      if(tx<0||tx>=256||ty<0||ty>=208)continue;
      output[ty*256+tx]=pp.sprPalette[pp.sprCol[s]+color];
    }
  }
  return output;
}
