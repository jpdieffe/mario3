import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Room} from '../site/room.js';
import {PROTOCOL} from '../site/protocol.js';

class Connection extends EventEmitter {
  constructor(){super();this.open=true;this.peerConnection=new EventTarget();this.sent=[];}
  send(value){this.sent.push(value);}
  close(){this.open=false;this.emit('close');}
}
class Peer extends EventEmitter {
  constructor(){super();queueMicrotask(()=>this.emit('open'));}
  connect(){this.connection=new Connection();queueMicrotask(()=>this.connection.emit('open'));return this.connection;}
  destroy(){this.emit('close');}
}
function environment(t){
  globalThis.window={Peer};globalThis.document={hidden:false};
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  t.after(()=>{delete globalThis.window;delete globalThis.document;});
}
test('an unavailable room keeps its specific error instead of a later generic timeout',async t=>{
  environment(t);const errors=[];const room=new Room({error:text=>errors.push(text)});t.after(()=>room.close());
  await room.open(false,'AB');
  room.peer.emit('error',{type:'peer-unavailable'});
  assert.equal(room.connection,null);assert.match(errors[0],/not available/);
  t.mock.timers.tick(31000);
  assert.equal(errors.length,1);
});
test('failed ICE after a remote answer identifies device connectivity and frees the pending slot',async t=>{
  environment(t);const errors=[];const room=new Room({error:text=>errors.push(text)});t.after(()=>room.close());
  await room.open(false,'AB');const pc=room.connection.peerConnection;
  pc.remoteDescription={type:'answer'};pc.iceConnectionState='failed';
  pc.dispatchEvent(new Event('iceconnectionstatechange'));
  assert.equal(room.connection,null);assert.match(errors[0],/Room found/);
  t.mock.timers.tick(31000);assert.equal(errors.length,1);
});
test('a signaling timeout does not incorrectly claim that a room was reached',async t=>{
  environment(t);const errors=[];const room=new Room({error:text=>errors.push(text)});t.after(()=>room.close());
  await room.open(false,'AB');t.mock.timers.tick(30001);
  assert.equal(errors.length,1);assert.match(errors[0],/did not answer/);
});
test('a stream arriving before welcome does not arm a false missing-video timeout',async t=>{
  environment(t);const errors=[];const room=new Room({error:text=>errors.push(text)});t.after(()=>room.close());
  await room.open(false,'AB');const connection=room.connection;
  const call=new EventEmitter();Object.assign(call,{peer:'mario3-together-v1-AB',metadata:{protocol:PROTOCOL},answer(){},close(){}});
  room.peer.emit('call',call);call.emit('stream',{});
  connection.emit('data',{type:'welcome',protocol:PROTOCOL});
  assert.equal(room.accepted,true);assert.equal(room.mediaTimeout,undefined);
  t.mock.timers.tick(31000);assert.deepEqual(errors,[]);
});
