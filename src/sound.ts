/** Zumbido de motor de hélice sintetizado con Web Audio (sin ficheros de audio). */
export class EngineSound {
  private ctx?: AudioContext;
  private osc?: OscillatorNode;
  private gain?: GainNode;
  private muted = false;

  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'triangle';
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
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.015 + throttle * 0.035, t, 0.3);
  }

  /** Arpegio alegre al descubrir un lugar. */
  chime() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(this.ctx!.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  toggle() {
    this.muted = !this.muted;
  }
}
