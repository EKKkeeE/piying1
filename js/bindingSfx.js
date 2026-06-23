/** 阶段1占位音效：Web Audio 合成，无需外部 mp3 */

export class BindingSfx {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** @param {number} freq @param {number} dur @param {number} gain */
  _tone(freq, dur, gain = 0.15) {
    const ctx = this._ensureCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.4, ctx.currentTime + dur * 0.3);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  playBindFlash() {
    this._tone(880, 0.35, 0.12);
    this._tone(1320, 0.25, 0.06);
  }

  playStringBreak() {
    const ctx = this._ensureCtx();
    const now = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start(now);
    this._tone(220, 0.18, 0.1);
  }

  playDustShake() {
    const ctx = this._ensureCtx();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "highpass";
    filt.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.value = 0.08;
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  playShatter() {
    const ctx = this._ensureCtx();
    const now = ctx.currentTime;
    const impactAt = 0.62;

    const rumbleDur = impactAt + 0.5;
    const rumbleBuf = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * rumbleDur),
      ctx.sampleRate
    );
    const rumbleData = rumbleBuf.getChannelData(0);
    for (let i = 0; i < rumbleData.length; i++) {
      const t = i / rumbleData.length;
      const amp = t < impactAt / rumbleDur ? (t / (impactAt / rumbleDur)) * 0.5 : 0.35 * (1 - t);
      rumbleData[i] = (Math.random() * 2 - 1) * amp;
    }
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = rumbleBuf;
    const rumbleFilt = ctx.createBiquadFilter();
    rumbleFilt.type = "lowpass";
    rumbleFilt.frequency.value = 180;
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = 0.22;
    rumbleSrc.connect(rumbleFilt);
    rumbleFilt.connect(rumbleG);
    rumbleG.connect(ctx.destination);
    rumbleSrc.start(now);

    const thud = ctx.createOscillator();
    const thudG = ctx.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(52, now + impactAt);
    thud.frequency.exponentialRampToValueAtTime(22, now + impactAt + 0.45);
    thudG.gain.setValueAtTime(0, now + impactAt);
    thudG.gain.linearRampToValueAtTime(0.38, now + impactAt + 0.03);
    thudG.gain.exponentialRampToValueAtTime(0.001, now + impactAt + 0.55);
    thud.connect(thudG);
    thudG.connect(ctx.destination);
    thud.start(now + impactAt);
    thud.stop(now + impactAt + 0.55);

    const dur = 1.0;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t) * 0.7;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(320, now + impactAt);
    filt.frequency.exponentialRampToValueAtTime(80, now + impactAt + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now + impactAt);
    g.gain.linearRampToValueAtTime(0.3, now + impactAt + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + impactAt + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start(now + impactAt);
  }
}
