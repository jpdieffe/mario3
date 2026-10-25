export class GameAudio {
  constructor({audible=true}={}){
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    this.context=new Context({sampleRate:44100});
    this.destination=this.context.createMediaStreamDestination();
    this.gain=this.context.createGain();this.gain.gain.value=audible?1:0;this.gain.connect(this.context.destination);
    this.samples=new Float32Array(2048);this.offset=0;
    this.ready=this.context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url)).then(()=>{
      this.node=new AudioWorkletNode(this.context,'mario-audio',{outputChannelCount:[2]});
      this.node.connect(this.gain);this.node.connect(this.destination);
    }).catch(error=>{this.error=error;});
    this.resume();
  }
  push(left,right){if(!this.node||this.context.state!=='running')return;this.samples[this.offset++]=(left+right)/2;if(this.offset===this.samples.length){this.node.port.postMessage(this.samples,[this.samples.buffer]);this.samples=new Float32Array(2048);this.offset=0;}}
  resume(){this.context?.resume().catch(()=>{});}
  close(){this.node?.disconnect();this.context?.close().catch(()=>{});}
}
