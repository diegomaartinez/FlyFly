/** Zumbido de ovni sintetizado con Web Audio (sin ficheros de audio). */
export class EngineSound {
  private ctx?: AudioContext;
  private osc?: OscillatorNode;
  private gain?: GainNode;
  private muted = false;

  start() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sine';
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.05;
    this.osc.connect(filter).connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
  }

  update(speed: number) {
    if (!this.ctx || !this.osc || !this.gain) return;
    const t = this.ctx.currentTime;
    // Ondulación lenta al flotar y tono más agudo al moverse.
    const wobble = Math.sin(t * 5) * 6;
    this.osc.frequency.setTargetAtTime(95 + speed * 1.6 + wobble, t, 0.1);
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.03 + Math.min(speed, 60) * 0.0006, t, 0.2);
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
