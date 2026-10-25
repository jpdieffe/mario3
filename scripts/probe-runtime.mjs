// Original-ROM control experiment. This is NOT a multiplayer implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NES, Controller } from 'jsnes';

const romPath = process.argv[2] ?? '.research/smb3/smb3.nes';
const rom = readFileSync(romPath);
const romHash = createHash('sha256').update(rom).digest('hex');
assert.equal(romHash, '4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579',
  'Use the verified, unmodified SMB3 USA Rev 1 ROM for this control experiment.');

// Addresses from the verified disassembly's smb3.fns; gameplay context only.
const RAM = {
  playerX: 0x90, playerXHi: 0x75, playerY: 0xa2, playerYHi: 0x87,
  playerXVel: 0xbd, playerYVel: 0xcf, currentPlayer: 0x726,
  tileset: 0x70a, controller1: 0xf7, controller2: 0xf8,
  objectStates: 0x661, objectIds: 0x671,
};
function makeNES() {
  const nes = new NES({ emulateSound: false });
  nes.loadROM(rom);
  return nes;
}
function run(nes, count) { for (let i = 0; i < count; i++) nes.frame(); }
function press(nes, port, button, count = 2) {
  nes.buttonDown(port, button);
  run(nes, count);
  nes.buttonUp(port, button);
  run(nes, 1);
}
function scene(nes) {
  const m = nes.cpu.mem;
  return {
    x: m[RAM.playerX] + 256 * m[RAM.playerXHi],
    y: m[RAM.playerY] + 256 * m[RAM.playerYHi],
    xVelocity: m[RAM.playerXVel], yVelocity: m[RAM.playerYVel],
    currentPlayer: m[RAM.currentPlayer], tileset: m[RAM.tileset],
    objectStates: Array.from(m.slice(RAM.objectStates, RAM.objectStates + 8)),
    objectIds: Array.from(m.slice(RAM.objectIds, RAM.objectIds + 8)),
  };
}

// Reach World 1-1 through ordinary input. No cheats or RAM writes.
const nes = makeNES();
run(nes, 600);
press(nes, 1, Controller.BUTTON_START);
run(nes, 120);
press(nes, 1, Controller.BUTTON_START);
run(nes, 320);
press(nes, 1, Controller.BUTTON_RIGHT, 20);
run(nes, 19);
press(nes, 1, Controller.BUTTON_UP, 20);
run(nes, 19);
press(nes, 1, Controller.BUTTON_A);
run(nes, 180);
const initial = scene(nes);
assert.equal(initial.tileset, 1, 'Expected to enter the first plains level.');
assert.equal(initial.x, 24, 'Expected the original World 1-1 entry position.');
assert.equal(initial.y, 384);
const snapshot = nes.toJSON();

function branch(port) {
  const copy = makeNES();
  copy.fromJSON(structuredClone(snapshot));
  if (port) {
    copy.buttonDown(port, Controller.BUTTON_RIGHT);
    copy.buttonDown(port, Controller.BUTTON_A);
  }
  run(copy, 30);
  return { scene: scene(copy), input1: copy.cpu.mem[RAM.controller1],
    input2: copy.cpu.mem[RAM.controller2],
    ramHash: createHash('sha256').update(Uint8Array.from(copy.cpu.mem.slice(0, 0x800))).digest('hex') };
}
const idle = branch(null);
const replay = branch(null);
const secondPort = branch(2);
const firstPort = branch(1);
assert.deepEqual(replay, idle, 'Restoring the same state must reproduce the same result.');
assert.equal(secondPort.input2 & 0x81, 0x81, 'ROM must actually read port 2 right+jump input.');
assert.deepEqual(secondPort.scene, idle.scene,
  'Control experiment: port 2 must not spawn or move a second gameplay actor in the stock ROM.');
assert.ok(firstPort.scene.x > idle.scene.x, 'Port 1 should move Mario right.');
assert.ok(firstPort.scene.y < idle.scene.y, 'Port 1 should make Mario jump.');

const report = {
  emulator: 'jsnes 2.1.0', rom_sha256: romHash,
  scope: 'Headless single-player World 1-1 control experiment; no browser/mobile performance or co-op validation.',
  checks: {
    enters_world_1_1_without_ram_writes: true,
    snapshot_replay_repeatable_for_30_frames: true,
    second_controller_is_read: true,
    second_controller_does_not_spawn_player_in_this_scene: true,
    first_controller_moves_and_jumps: true,
  },
  initial, idle: idle.scene, secondPort, firstPort,
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/runtime-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
