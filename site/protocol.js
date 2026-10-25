export const PROTOCOL = 1;
export const BUTTON_COUNT = 8;
export const ALL_BUTTONS = (1 << BUTTON_COUNT) - 1;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(excluded = new Set()) {
  const size = ROOM_ALPHABET.length;
  const start = crypto.getRandomValues(new Uint16Array(1))[0] % (size * size);
  for (let offset = 0; offset < size * size; offset++) {
    const index = (start + offset) % (size * size);
    const code = ROOM_ALPHABET[Math.floor(index / size)] + ROOM_ALPHABET[index % size];
    if (!excluded.has(code)) return code;
  }
  throw new Error('No room codes are available. Please try again shortly.');
}
export function parseRoomCode(value) {
  let code = value.trim();
  if (/^https?:\/\//i.test(code)) {
    try { code = new URLSearchParams(new URL(code).hash.slice(1)).get('room') || ''; } catch { return null; }
  }
  code = code.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 2 && [...code].every(c => ROOM_ALPHABET.includes(c)) ? code : null;
}
export function validInput(message) {
  return message?.type === 'input' && Number.isSafeInteger(message.seq) && message.seq >= 0 &&
    Number.isInteger(message.mask) && message.mask >= 0 && message.mask <= ALL_BUTTONS;
}
export function applyMask(previous, next, emit) {
  for (let button = 0; button < BUTTON_COUNT; button++) {
    if ((previous ^ next) & (1 << button)) emit(button, (next >> button) & 1);
  }
  return next;
}
export class InputSources {
  constructor(onChange) { this.sources = new Map(); this.mask = 0; this.onChange = onChange; }
  set(source, mask) {
    if (mask) this.sources.set(source, mask & ALL_BUTTONS); else this.sources.delete(source);
    let next = 0;
    for (const value of this.sources.values()) next |= value;
    if (next !== this.mask) { this.mask = next; this.onChange(next); }
  }
  clear() { this.sources.clear(); if (this.mask) { this.mask = 0; this.onChange(0); } }
}
export const KEY_MAP = { ArrowUp:4, ArrowDown:5, ArrowLeft:6, ArrowRight:7, KeyZ:0, Space:0, KeyX:1, KeyS:1, ShiftLeft:2, ShiftRight:2, Enter:3 };
export function gamepadMask(pad) {
  if (!pad || pad.mapping !== 'standard') return 0;
  const mapping = {0:0,1:1,2:1,3:0,8:2,9:3,12:4,13:5,14:6,15:7};
  let mask = 0;
  for (const [index, button] of Object.entries(mapping)) if (pad.buttons[index]?.pressed) mask |= 1 << button;
  if (pad.axes[0] < -.4) mask |= 1 << 6;
  if (pad.axes[0] > .4) mask |= 1 << 7;
  if (pad.axes[1] < -.4) mask |= 1 << 4;
  if (pad.axes[1] > .4) mask |= 1 << 5;
  return mask;
}
