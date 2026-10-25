import test from 'node:test';
import assert from 'node:assert/strict';
import {newRoomCode,parseRoomCode,validInput,ROOM_ALPHABET,InputSources} from '../site/protocol.js';
test('two-character codes are collision-safe within the available namespace',()=>{
  const used=new Set();for(let i=0;i<ROOM_ALPHABET.length**2;i++){const code=newRoomCode(used);assert.equal(code.length,2);assert.ok(!used.has(code));used.add(code);}
  assert.throws(()=>newRoomCode(used));
});
test('room parsing and network input reject malformed values',()=>{
  assert.equal(parseRoomCode(' ab '),'AB');assert.equal(parseRoomCode('https://example.com/#room=AB'),'AB');
  assert.equal(parseRoomCode('ABC'),null);assert.equal(parseRoomCode('I0'),null);
  assert.ok(validInput({type:'input',mask:255,seq:1}));
  assert.ok(!validInput({type:'input',mask:256,seq:1}));assert.ok(!validInput({type:'input',mask:1,seq:-1}));
});
test('releasing one input source does not release another held button',()=>{
  const values=[],inputs=new InputSources(v=>values.push(v));inputs.set('key',1);inputs.set('touch',2);inputs.set('key',0);inputs.clear();assert.deepEqual(values,[1,3,2,0]);
});
