import { M } from './memory.js';
import { validWeapon } from './protocol.js';

export const WEAPONS = [
  {name:'None'},
  {name:'Rocket launcher',cooldown:55,speed:4.5,life:140,color:'#f4ad52'},
  {name:'Sniper rifle',cooldown:42,range:960,color:'#c9a4ff'},
  {name:'Assault rifle',cooldown:6,speed:10,life:50,color:'#ffe584'},
];
const signed=n=>n>127?n-256:n;
const scene=n=>[M.Level_Tileset,M.Level_LayPtrOrig_AddrL,M.Level_LayPtrOrig_AddrH,M.Level_ObjPtrOrig_AddrL,M.Level_ObjPtrOrig_AddrH].map(a=>n.cpu.mem[a]).join(':');
const position=n=>{const m=n.cpu.mem;return {x:m[M.Player_X]+256*m[M.Player_XHi]+8,y:m[M.Player_Y]+256*m[M.Player_YHi]+(m[M.Player_Suit]?17:24)};};
const playing=n=>n.cpu.mem[M.Level_Tileset]>0&&n.cpu.mem[M.Level_Tileset]<15;

// Original ROM tile layout: 16 x 27 tiles per horizontal page, 16 x 15
// per vertical page. Bounds matter: the following RAM holds other game data.
export function tileAt(nes,x,y){
  const m=nes.cpu.mem,vertical=!!m[M.Level_7Vertical];
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=(vertical?256:3840)||y>=(vertical?3840:432))return null;
  const col=Math.floor(x/16),row=Math.floor(y/16);
  const index=vertical?row*16+col:Math.floor(col/16)*432+row*16+col%16;
  const value=m[0x6000+index],tileset=m[M.Level_Tileset];
  const giant=tileset===11&&value>=0x47&&value<=0x4a;
  const brick=value===0x67||value===0x32||giant;
  const quadrant=value>>6;
  const solid=brick||value>=Math.min(m[0x7e94+quadrant],m[0x7e98+quadrant]);
  return {index,value,x:col*16,y:row*16,solid,brick,giant};
}

export class WeaponSystem {
  constructor(engine){
    this.engine=engine;this.equipped=[0,0];this.cooldowns=[0,0];this.facing=[1,1];
    this.shots=[];this.effects=[];this.key=null;this.stats={fired:[0,0],bricks:0,hits:0};
  }
  equip(p,id){if((p===0||p===1)&&validWeapon(id))this.equipped[p]=id;}
  clear(){this.shots=[];this.effects=[];this.cooldowns=[0,0];this.key=null;}
  leave(){this.equipped[1]=0;this.shots=this.shots.filter(s=>s.owner!==1);}
  aim(p){
    const mask=this.engine.masks[p];
    if(mask&64)this.facing[p]=-1;else if(mask&128)this.facing[p]=1;
    else this.facing[p]=(this.engine.nes[p].cpu.mem[0xef]&0x40)?1:-1;
    let y=(mask&16)?-1:(mask&32)?1:0;
    let x=y?((mask&192)?this.facing[p]:0):this.facing[p];
    const length=Math.hypot(x,y);return {x:x/length,y:y/length};
  }
  step(){
    const e=this.engine,n=e.nes[0],key=scene(n);
    if(this.key!==key){this.clear();this.key=key;}
    if(!playing(n)||e.transition||n.cpu.mem[M.Player_InPipe]||n.cpu.mem[M.Player_EndLevel]){this.shots=[];this.effects=[];return;}
    for(const effect of this.effects){effect.life--;if(effect.kind==='chip'){effect.x+=effect.vx;effect.y+=effect.vy;effect.vy+=.15;}}
    this.effects=this.effects.filter(v=>v.life>0).slice(-180);
    for(let p=0;p<(e.joined?2:1);p++){
      if(this.cooldowns[p]>0)this.cooldowns[p]--;
      const direction=this.aim(p),id=this.equipped[p],m=e.nes[p].cpu.mem;
      if(!id||!(e.masks[p]&2)||this.cooldowns[p]||m[M.Player_IsDying]||m[M.Player_InPipe]||m[M.Player_EndLevel])continue;
      this.cooldowns[p]=WEAPONS[id].cooldown;this.stats.fired[p]++;
      const origin=position(e.nes[p]);
      this.sound(origin.x,origin.y,0x4f1,0x20); // Original fireball sound.
      // Start inside the weapon's barrel and sweep outward, so a muzzle placed
      // against a wall cannot teleport a shot through it.
      const shot={owner:p,id,x:origin.x,y:origin.y,dx:direction.x,dy:direction.y,life:WEAPONS[id].life};
      if(id===2)this.snipe(shot);else if(this.shots.length<64)this.shots.push(shot);
      this.effects.push({kind:'flash',x:origin.x+direction.x*12,y:origin.y+direction.y*12,life:3,max:3,color:WEAPONS[id].color});
    }
    const next=[];
    for(const shot of this.shots){
      if(--shot.life<=0)continue;
      if(this.travel(shot,WEAPONS[shot.id].speed))next.push(shot);
    }
    this.shots=next;
  }
  targets(){
    const e=this.engine,seen=new Set(),targets=[];
    for(let p=0;p<(e.joined?2:1);p++)for(const actor of e.readActors(p)){
      const m=e.nes[p].cpu.mem,id=m[0x671+actor.slot],state=m[0x661+actor.slot];
      // Preserve power-ups, moving platforms, level controllers and bosses.
      // Their special hit handlers must be left to the original game.
      const flags=e.rom[16+0x2f4+id];
      if(state<2||state>5||state===4||(flags&0xa0)||[0x0e,0x18,0x4b,0x4c].includes(id)||seen.has(actor.key)||e.entities.get(actor.key)?.dead)continue;
      seen.add(actor.key);
      const bound=16+0x2b4+(flags&15)*4;
      const left=actor.x+signed(e.rom[bound]),top=actor.y+signed(e.rom[bound+2]);
      targets.push({...actor,left,top,right:left+Math.max(10,e.rom[bound+1]),bottom:top+Math.max(12,e.rom[bound+3])});
    }
    return targets;
  }
  hit(target){
    const e=this.engine;if(e.entities.get(target.key)?.dead)return;
    e.entities.set(target.key,{...target,data:[...target.data],dead:true});
    for(let p=0;p<(e.joined?2:1);p++){
      const m=e.nes[p].cpu.mem;
      for(let s=0;s<8;s++)if(e.slotKeys[p][s]===target.key){m[0x661+s]=0;if(m[0x659+s]<48)m[0x7b10+m[0x659+s]]=0x80;}
    }
    this.stats.hits++;
    this.effects.push({kind:'burst',x:(target.left+target.right)/2,y:(target.top+target.bottom)/2,radius:12,life:12,max:12,color:'#fff2b3'});
  }
  travel(shot,distance,pierce=false){
    const count=Math.ceil(distance/2),step=distance/count;
    const targets=this.targets();
    for(let i=0;i<count;i++){
      shot.x+=shot.dx*step;shot.y+=shot.dy*step;
      const tile=tileAt(this.engine.nes[0],shot.x,shot.y);
      if(!tile)return false;
      if(tile.solid){
        if(shot.id===1)this.explode(shot.x,shot.y);
        else this.effects.push({kind:'flash',x:shot.x,y:shot.y,life:6,max:6,color:'#ffe584'});
        return false;
      }
      const target=targets.find(t=>!this.engine.entities.get(t.key)?.dead&&shot.x>=t.left-2&&shot.x<=t.right+2&&shot.y>=t.top-2&&shot.y<=t.bottom+2);
      if(target){
        if(shot.id===1){this.explode(shot.x,shot.y);return false;}
        this.hit(target);if(!pierce)return false;
      }
    }
    return true;
  }
  snipe(shot){
    const x=shot.x,y=shot.y;this.travel(shot,WEAPONS[2].range,true);
    this.effects.push({kind:'trace',x,y,endX:shot.x,endY:shot.y,life:9,max:9,color:WEAPONS[2].color});
  }
  breakBrick(tile){
    const e=this.engine,n=e.nes[0];
    const blocks=tile.giant?(()=>{
      const offset=tile.value-0x47,x=tile.x-(offset%2)*16,y=tile.y-Math.floor(offset/2)*16;
      return [[0,0],[16,0],[0,16],[16,16]].map(([dx,dy])=>tileAt(n,x+dx,y+dy));
    })():[tile];
    for(const block of blocks){
      if(!block?.brick||!tileAt(n,block.x,block.y)?.brick)continue;
      for(let p=0;p<(e.joined?2:1);p++){e.nes[p].cpu.mem[0x6000+block.index]=0x80;e.refreshTile(p,block.index,0x80);}
      if(e.tiles)e.tiles[block.index]=0x80;
      e.stats.tileEdits++;this.stats.bricks++;
      for(let i=0;i<4;i++)this.effects.push({kind:'chip',x:block.x+4+(i%2)*8,y:block.y+4+Math.floor(i/2)*8,vx:(i%2?1:-1)*(1+(i>>1)*.5),vy:-2-(i>>1),life:26,max:26,color:'#db9a55'});
    }
  }
  explode(x,y){
    const radius=32,n=this.engine.nes[0];
    this.effects.push({kind:'burst',x,y,radius,life:18,max:18,color:'#ffb144'});
    for(let ty=Math.floor((y-radius)/16)*16;ty<=y+radius;ty+=16)for(let tx=Math.floor((x-radius)/16)*16;tx<=x+radius;tx+=16){
      const tile=tileAt(n,tx,ty);
      if(tile?.brick&&Math.hypot(Math.max(tx-x,0,x-tx-16),Math.max(ty-y,0,y-ty-16))<=radius)this.breakBrick(tile);
    }
    for(const target of this.targets())if(Math.hypot(Math.max(target.left-x,0,x-target.right),Math.max(target.top-y,0,y-target.bottom))<=radius)this.hit(target);
    this.sound(x,y,0x4f3,1); // Original brick-crumble sound.
  }
  sound(x,y,address,mask){
    for(let p=0;p<(this.engine.joined?2:1);p++){
      const m=this.engine.nes[p].cpu.mem,cx=m[M.Horz_Scroll]+256*m[M.Horz_Scroll_Hi],cy=m[M.Level_VertScroll]+256*m[M.Level_VertScrollH];
      if(x>=cx-48&&x<=cx+304&&y>=cy-48&&y<=cy+256)m[address]|=mask;
    }
  }
  draw(context,p){
    const e=this.engine,n=e.nes[p],m=n.cpu.mem;
    if(!playing(n)||e.transition)return;
    const cx=m[M.Horz_Scroll]+256*m[M.Horz_Scroll_Hi],cy=m[M.Level_VertScroll]+256*m[M.Level_VertScrollH];
    context.save();context.beginPath();context.rect(0,0,256,208);context.clip();context.translate(-cx,-cy);
    for(let owner=0;owner<(e.joined?2:1);owner++){
      const id=this.equipped[owner],nes=e.nes[owner];if(!id||nes.cpu.mem[M.Player_IsDying]||nes.cpu.mem[M.Player_InPipe])continue;
      const pos=position(nes),aim=this.aim(owner);
      context.save();context.translate(Math.round(pos.x),Math.round(pos.y));context.rotate(Math.atan2(aim.y,aim.x));
      context.fillStyle='#182c30';context.fillRect(-2,-3,id===2?23:18,id===1?7:5);
      context.fillStyle=WEAPONS[id].color;context.fillRect(3,-2,id===2?12:10,3);
      context.fillStyle='#344c45';context.fillRect(3,2,4,4);
      if(id===2){context.fillStyle='#d5c0ff';context.fillRect(5,-6,7,3);}
      if(id===1){context.fillStyle='#e55b41';context.fillRect(15,-2,4,4);}
      context.restore();
    }
    for(const shot of this.shots){
      context.save();context.translate(Math.round(shot.x),Math.round(shot.y));context.rotate(Math.atan2(shot.dy,shot.dx));
      context.fillStyle=WEAPONS[shot.id].color;
      if(shot.id===1){context.fillStyle='#ffd779';context.fillRect(-11,-2,6,4);context.fillStyle='#d95c3c';context.fillRect(-6,-3,9,6);context.fillStyle='#f8efcc';context.fillRect(1,-2,4,4);}
      else context.fillRect(-6,-1,8,2);
      context.restore();
    }
    for(const effect of this.effects){
      context.globalAlpha=Math.min(1,effect.life/Math.min(effect.max,8));context.fillStyle=effect.color;context.strokeStyle=effect.color;
      if(effect.kind==='trace'){context.lineWidth=2;context.beginPath();context.moveTo(effect.x,effect.y);context.lineTo(effect.endX,effect.endY);context.stroke();}
      else if(effect.kind==='chip')context.fillRect(Math.round(effect.x),Math.round(effect.y),4,4);
      else if(effect.kind==='burst'){
        const radius=effect.radius*(1-effect.life/effect.max*.75);context.lineWidth=3;
        context.beginPath();context.arc(effect.x,effect.y,radius,0,Math.PI*2);context.stroke();
        context.fillStyle='#fff4b9';context.fillRect(effect.x-radius*.35,effect.y-radius*.35,radius*.7,radius*.7);
      }else{context.fillRect(effect.x-4,effect.y-1,8,2);context.fillRect(effect.x-1,effect.y-4,2,8);}
    }
    context.restore();
  }
}
