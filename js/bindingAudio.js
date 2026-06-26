/** 绑定牵线完成：五声拨弦（宫商角徵羽，对应连线顺序） */

/** D 调五声（Hz）：宫商角徵羽 */
const PENTATONIC = [
  { name: "宫", freq: 293.66 },
  { name: "商", freq: 329.63 },
  { name: "角", freq: 369.99 },
  { name: "徵", freq: 440.0 },
  { name: "羽", freq: 493.88 },
];

export class BindingLineAudio {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
  }

  /** 用户点击开始后解锁 AudioContext */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.38;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  /**
   * @param {number} index 0..4，与 BINDING_SEQUENCE 顺序一致
   */
  playLine(index) {
    if (!this.ctx || !this.master) return;
    const note = PENTATONIC[index];
    if (!note) return;
    this._pluckPipa(note.freq);
  }

  /** @param {number} freq */
  _pluckPipa(freq) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const dur = 1.65;

    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 0.014));
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      nd[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const pickFilter = ctx.createBiquadFilter();
    pickFilter.type = "bandpass";
    pickFilter.frequency.value = Math.min(freq * 2.4, 1800);
    pickFilter.Q.value = 0.9;
    const pickGain = ctx.createGain();
    pickGain.gain.setValueAtTime(0.28, now);
    pickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    noise.connect(pickFilter);
    pickFilter.connect(pickGain);
    pickGain.connect(master);
    noise.start(now);
    noise.stop(now + 0.04);

    const partials = [
      [1, 1.0, 0.014],
      [2, 0.46, 0.01],
      [3, 0.26, 0.008],
      [4.08, 0.15, 0.006],
      [5.25, 0.09, 0.005],
    ];

    for (const [ratio, amp, attack] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const f0 = freq * ratio;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.997, now + 0.18);

      const toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.001, now);
      toneGain.gain.linearRampToValueAtTime(amp * 0.12, now + attack);
      toneGain.gain.exponentialRampToValueAtTime(
        0.001,
        now + dur * (1.05 - ratio * 0.07)
      );

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(freq * 9, now);
      lp.frequency.exponentialRampToValueAtTime(freq * 2.8, now + 0.45);

      osc.connect(lp);
      lp.connect(toneGain);
      toneGain.connect(master);
      osc.start(now);
      osc.stop(now + dur);
    }
  }
}
