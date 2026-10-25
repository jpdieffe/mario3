class GameAudio extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(65536);this.read=0;this.write=0;this.port.onmessage=event=>{for(const sample of event.data){this.buffer[this.write++&65535]=sample;}if(this.write-this.read>16384)this.read=this.write-4096;};}
  process(inputs,outputs){const output=outputs[0];for(let i=0;i<output[0].length;i++){const value=this.read<this.write?this.buffer[this.read++&65535]:0;for(const channel of output)channel[i]=value;}return true;}
}
registerProcessor('mario-audio',GameAudio);
