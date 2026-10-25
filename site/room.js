import { PROTOCOL, newRoomCode, validInput, validWeapon } from './protocol.js';
const PREFIX = 'mario3-together-v1-';
const networkAdvice = () => /Android/i.test(globalThis.navigator?.userAgent || '')
  ? 'In Android Settings > Apps > your browser > Permissions, allow Nearby devices / Local network, then retry. See Help for other connection options.'
  : 'Check local-network permissions and Wi-Fi isolation, or configure a TURN relay in Help.';
const messageFor = error => ({
  'peer-unavailable':'That room is not available. Check the code and ask the host to keep the game open.',
  'network':'The room service is unreachable. Check your connection and try again.',
  'server-error':'The room service is unavailable. Try again or set your own PeerServer in Help.',
  'unavailable-id':'That room code is already in use. Create another room.',
  'webrtc':`The direct connection failed. ${networkAdvice()}`,
  'browser-incompatible':'This browser does not support the connection. Use a current Safari or Chrome browser.',
}[error?.type] || error?.message || 'The room connection failed. Please try again.');

export class Room {
  constructor(events = {}, settings = {}) {
    this.events = events; this.settings = settings; this.mask = 0; this.seq = 0; this.lastSeq = -1;
    this.remoteMask = 0; this.lastInput = 0; this.closed = false; this.isHost = false;this.weapon=0;
  }
  emit(name, ...args) { this.events[name]?.(...args); }
  async open(host, code) {
    this.isHost = host; this.code = host ? newRoomCode() : code;
    if (!window.Peer) throw new Error('The room library could not load. Reload the page.');
    const iceServers = [{ urls:'stun:stun.l.google.com:19302' }, { urls:'stun:global.stun.twilio.com:3478' }];
    if (this.settings.turn) iceServers.push({urls:this.settings.turn,username:this.settings.username,credential:this.settings.credential});
    const options = {debug:0,config:{iceServers}};
    if (this.settings.host) Object.assign(options, {host:this.settings.host,port:this.settings.port || 443,path:this.settings.path || '/',secure:true});
    const attempted = new Set();
    for (let attempt = 0; ; attempt++) {
      attempted.add(this.code);
      try { await this.reservePeer(host ? PREFIX + this.code : undefined, options); break; }
      catch (error) {
        this.peer?.destroy();
        if (this.closed || !host || error.type !== 'unavailable-id') throw error;
        if (attempt >= 19) throw new Error('Could not find a free room code. Please try again shortly.');
        this.code = newRoomCode(attempted);
      }
    }
    if (this.closed) return;
    this.peer.on('error', error => {
      // A missing/offline room is terminal for this attempt. Do not replace its
      // useful error with a generic ICE timeout later.
      if(error.type==='peer-unavailable' && !this.accepted)this.failPending(messageFor(error));
      else this.emit('error', messageFor(error));
    });
    this.peer.on('connection', connection => {
      if (!this.isHost || this.connection) { connection.on('open', () => { connection.send({type:'busy'}); setTimeout(() => connection.close(), 100); }); return; }
      this.attach(connection);
    });
    this.peer.on('call', call => {
      if (this.isHost || call.peer !== PREFIX + this.code || !this.connection?.open || call.metadata?.protocol !== PROTOCOL) { call.close(); return; }
      this.call?.close(); this.call = call;
      call.on('stream', stream => { this.mediaReceived=true; clearTimeout(this.mediaTimeout); this.emit('stream', stream); });
      call.on('error', error => this.emit('error', messageFor(error)));
      call.on('close', () => { if (!this.closed && this.call === call) this.emit('mediaClosed'); });
      call.answer();
    });
    this.peer.on('disconnected', () => {
      if (!this.closed) { this.emit('status', 'Room service disconnected; reconnecting…'); this.peer.reconnect(); }
    });
    this.peer.on('close', () => { if (!this.closed) this.emit('error','The room closed. Create or join a new room.'); });
    if (!host) this.attach(this.peer.connect(PREFIX + code, {reliable:true,serialization:'json',metadata:{protocol:PROTOCOL}}));
    this.timer = setInterval(() => {
      if (!this.isHost && this.accepted) this.send({type:'input',mask:document.hidden ? 0 : this.mask,weapon:this.weapon,seq:this.seq++});
      if (this.isHost && this.remoteMask && performance.now() - this.lastInput > 600) { this.remoteMask = 0; this.emit('input',0); }
      if(this.accepted && this.lastHeard && performance.now()-this.lastHeard>12000) this.connection?.close();
    }, 50);
    this.pingTimer = setInterval(() => this.send({type:'ping',at:Date.now()}), 2000);
    return this.code;
  }
  reservePeer(id, options) {
    const peer = this.peer = new window.Peer(id, options);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        peer.off('open', onOpen); peer.off('error', onError); peer.off('close', onClose);
        this.cancelOpen = null;
      };
      const fail = error => { cleanup(); reject(error); };
      const onOpen = () => { cleanup(); resolve(); };
      const onError = error => fail(Object.assign(new Error(messageFor(error)), {type:error.type}));
      const onClose = () => fail(new Error('The room closed before connecting. Please try again.'));
      const timeout = setTimeout(() => fail(new Error('The room service did not respond. Check your connection and try again.')), 20000);
      this.cancelOpen = () => fail(new Error('Room creation canceled.'));
      peer.on('open', onOpen); peer.on('error', onError); peer.on('close', onClose);
    });
  }
  attach(connection) {
    this.connection = connection; this.accepted = false; this.lastSeq = -1;this.mediaReceived=false;this.lastHeard=0;
    this.connectTimeout = setTimeout(() => {
      if (this.connection === connection && !this.accepted) {
        this.failPending(this.connectionFailure(connection));
      }
    }, 30000);
    const pc=connection.peerConnection;
    pc?.addEventListener('iceconnectionstatechange',()=>{
      if(this.connection!==connection || this.closed)return;
      if(pc.iceConnectionState==='checking')this.emit('status','Room found. Connecting the two devices…');
      if(pc.iceConnectionState==='failed'&&!this.accepted)this.failPending(this.connectionFailure(connection));
    });
    connection.on('open', () => {
      if (this.closed) { connection.close(); return; }
      if (!this.isHost) this.send({type:'hello',protocol:PROTOCOL});
    });
    connection.on('data', data => {
      if (this.connection !== connection || !data || typeof data !== 'object') return;
      this.lastHeard=performance.now();
      if (data.type === 'busy') { this.emit('error','This room already has two players.'); connection.close(); return; }
      if (data.type === 'hello' && this.isHost && !this.accepted) {
        if (data.protocol !== PROTOCOL) { connection.close(); return; }
        this.accepted = true; clearTimeout(this.connectTimeout);
        this.send({type:'welcome',protocol:PROTOCOL}); this.emit('connected'); return;
      }
      if (data.type === 'welcome' && !this.isHost && !this.accepted && data.protocol === PROTOCOL) {
        this.accepted = true; clearTimeout(this.connectTimeout);
        this.emit('connected');
        if(!this.mediaReceived)this.mediaTimeout = setTimeout(() => this.emit('error','Connected, but the game stream has not arrived. Ask the host to keep the game visible, or try a different network.'), 30000);
        return;
      }
      if (!this.accepted) return;
      if (this.isHost && validInput(data) && data.seq > this.lastSeq) {
        this.lastSeq = data.seq; this.lastInput = performance.now(); this.remoteMask = data.mask; this.emit('input',data.mask,data.weapon??0);
      } else if (data.type === 'ping' && Number.isFinite(data.at)) this.send({type:'pong',at:data.at});
      else if (data.type === 'pong' && Number.isFinite(data.at)) this.emit('latency',Math.max(0,Date.now()-data.at));
      else if(this.isHost && data.type==='regroup' && performance.now()-(this.lastRegroup||0)>3000) {this.lastRegroup=performance.now();this.emit('regroup');}
      else if (!this.isHost && data.type === 'state' && typeof data.text === 'string') this.emit('status',data.text.slice(0,180),data.phase === 'audio-blocked' || data.phase === 'playing' ? data.phase : undefined);
    });
    connection.on('close', () => {
      if (this.connection !== connection) return;
      const wasAccepted = this.accepted;
      clearTimeout(this.connectTimeout); clearTimeout(this.mediaTimeout);
      this.connection = null; this.accepted = false; this.remoteMask = 0;
      this.call?.close(); this.call = null;
      this.emit('input',0);
      if (!this.closed && wasAccepted) this.emit('disconnected');
    });
    connection.on('error', error => { if (this.connection === connection) { connection.close(); this.emit('error',messageFor(error)); } });
  }
  connectionFailure(connection) {
    if(connection.peerConnection?.remoteDescription) return `Room found, but the devices could not establish a direct connection. ${networkAdvice()}`;
    return 'The room did not answer. Ask the host to keep the game tab visible, reload it, and share the new room code.';
  }
  failPending(text) {
    clearTimeout(this.connectTimeout);clearTimeout(this.mediaTimeout);
    if(!this.accepted){const connection=this.connection;this.connection=null;connection?.close();}
    this.emit('error',text);
  }
  send(data) { if (this.connection?.open) { try { this.connection.send(data); } catch {} } }
  setInput(mask) { this.mask = mask; if (this.accepted && !this.isHost) this.send({type:'input',mask,weapon:this.weapon,seq:this.seq++}); }
  setWeapon(id) {if(validWeapon(id)){this.weapon=id;this.setInput(this.mask);}}
  broadcast(text, phase) { this.send({type:'state',text,phase}); }
  stream(media) {
    if (!this.isHost || !this.accepted || !this.connection?.open) return;
    this.call?.close();
    this.call = this.peer.call(this.connection.peer,media,{metadata:{protocol:PROTOCOL}});
    this.call?.on('error', error => this.emit('error',messageFor(error)));
  }
  close() {
    this.setInput(0); this.closed = true;
    this.cancelOpen?.();
    clearInterval(this.timer); clearInterval(this.pingTimer); clearTimeout(this.connectTimeout); clearTimeout(this.mediaTimeout);
    this.call?.close(); this.connection?.close(); this.peer?.destroy();
    this.connection = null; this.call = null; this.accepted = false; this.emit('input',0);
  }
}
