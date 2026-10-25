import { NES, Controller } from '../site/vendor/jsnes/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const nes=new NES({emulateSound:true,sampleRate:44100});
nes.loadROM(readFileSync('site/roms/mario3.nes'));
const frames=n=>{for(let i=0;i<n;i++)nes.frame();};
const start=()=>{nes.buttonDown(1,Controller.BUTTON_START);frames(2);nes.buttonUp(1,Controller.BUTTON_START);frames(1);};
frames(600);start();frames(120);start();frames(320);
writeFileSync('site/start.json',JSON.stringify(nes.toJSON()));
console.log('Built original World 1 map start state through controller input.');
