/** Zumbido de motor de hélice sintetizado con Web Audio (sin ficheros de audio). */
export class EngineSound {
  private ctx?: AudioContext;
  private osc?: OscillatorNode;
  private gain?: GainNode;
  private muted = false;

  start() {
    this.ctx = new AudioContext();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.05;
    this.osc.connect(filter).connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
  }

  update(throttle: number, speed: number) {
    if (!this.ctx || !this.osc || !this.gain) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(38 + throttle * 45 + speed * 0.15, t, 0.3);
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.03 + throttle * 0.05, t, 0.3);
  }

  toggle() {
    this.muted = !this.muted;
  }
}
