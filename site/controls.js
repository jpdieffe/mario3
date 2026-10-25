import { InputSources, KEY_MAP, gamepadMask } from './protocol.js';

export function setupControls(onChange) {
  let enabled = false;
  const sources = new InputSources(mask => {
    document.querySelectorAll('[data-button]').forEach(el => el.classList.toggle('pressed', !!(mask & (1 << Number(el.dataset.button)))));
    for (const [name, button] of Object.entries({up:4,down:5,left:6,right:7})) document.querySelector(`.dpad .${name}`).classList.toggle('pressed', !!(mask & (1 << button)));
    onChange(mask);
  });
  const canInput = () => enabled && !document.hidden && !document.querySelector('dialog[open]');
  function key(event, down) {
    const button = KEY_MAP[event.code];
    if (button === undefined || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (!canInput()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sources.set(`key:${event.code}`, down ? 1 << button : 0);
  }
  window.addEventListener('keydown', e => key(e, true), true);
  window.addEventListener('keyup', e => key(e, false), true);
  document.querySelectorAll('[data-button]').forEach(button => {
    button.addEventListener('pointerdown', e => {
      if (!canInput()) return;
      e.preventDefault(); button.setPointerCapture(e.pointerId);
      sources.set(`pointer:${e.pointerId}`, 1 << Number(button.dataset.button));
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => sources.set(`pointer:${e.pointerId}`, 0));
    button.addEventListener('contextmenu', e => e.preventDefault());
  });
  const dpad = document.querySelector('#dpad');
  const movePad = e => {
    const rect = dpad.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 2 - 1;
    const y = (e.clientY - rect.top) / rect.height * 2 - 1;
    let mask = 0;
    if (x < -.28) mask |= 1 << 6;
    if (x > .28) mask |= 1 << 7;
    if (y < -.28) mask |= 1 << 4;
    if (y > .28) mask |= 1 << 5;
    sources.set(`pointer:${e.pointerId}`, mask);
  };
  dpad.addEventListener('pointerdown', e => { if (!canInput()) return; e.preventDefault(); dpad.setPointerCapture(e.pointerId); movePad(e); });
  dpad.addEventListener('pointermove', e => { if (canInput() && dpad.hasPointerCapture(e.pointerId)) movePad(e); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) dpad.addEventListener(event, e => sources.set(`pointer:${e.pointerId}`, 0));
  dpad.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('blur', () => sources.clear());
  document.addEventListener('visibilitychange', () => sources.clear());
  function poll() {
    const pad = canInput() ? Array.from(navigator.getGamepads?.() || []).find(p => p?.mapping === 'standard') : null;
    sources.set('gamepad', gamepadMask(pad));
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);
  return { clear: () => sources.clear(), enable: value => { enabled = value; if (!value) sources.clear(); } };
}
