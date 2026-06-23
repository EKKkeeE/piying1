/**
 * 石板震碎：蓄力颤动 → 冲击爆裂为碎石 → 舞台露出 → 余震
 */

export class ShatterEffect {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => void} onComplete
   */
  constructor(canvas, onComplete) {
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");
    this.onComplete = onComplete;
    this.active = false;
    /** @type {HTMLCanvasElement | null} */
    this._sourceCanvas = null;
    /** @type {HTMLCanvasElement | null} */
    this._shardSource = null;
    /** @type {(() => void) | null} */
    this._onImpact = null;
    /** @type {Array<object>} */
    this._shards = [];
    /** @type {Array<object>} */
    this._dust = [];
    this._w = 0;
    this._h = 0;
    this._cx = 0;
    this._cy = 0;
    this._t = 0;
    this._impactFired = false;
    this._impactTime = 0;
    this.rumbleDuration = 0.62;
    this.shardFadeDuration = 1.15;
    this.duration = 2.1;
    this._shakeX = 0;
    this._shakeY = 0;
    this._shakeSeed = Math.random() * 1000;
  }

  get impactAt() {
    return this.rumbleDuration;
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {number} w
   * @param {number} h
   * @param {number} cx
   * @param {number} cy
   * @param {HTMLCanvasElement | null} [sourceCanvas]
   * @param {{ onImpact?: () => void }} [opts]
   */
  start(w, h, cx, cy, sourceCanvas = null, opts = {}) {
    this.active = true;
    this._t = 0;
    this._w = w;
    this._h = h;
    this._cx = cx;
    this._cy = cy;
    this._sourceCanvas = sourceCanvas;
    this._shardSource = sourceCanvas;
    this._onImpact = opts.onImpact ?? null;
    this._impactFired = false;
    this._impactTime = 0;
    this._shards = [];
    this._dust = [];
    this._shakeSeed = Math.random() * 1000;

    this.canvas.removeAttribute("hidden");
    this.canvas.classList.add("shatter-active");
  }

  _buildShards() {
    const w = this._w;
    const h = this._h;
    const cx = this._cx;
    const cy = this._cy;
    const cols = 16;
    const rows = 11;
    const cellW = w / cols;
    const cellH = h / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = col * cellW;
        const sy = row * cellH;
        const px = sx + cellW * 0.5;
        const py = sy + cellH * 0.5;
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const burst = 380 + Math.random() * 320 + dist * 0.3;

        this._shards.push({
          sx,
          sy,
          sw: cellW + 1,
          sh: cellH + 1,
          x: px,
          y: py,
          w: cellW,
          h: cellH,
          vx: nx * burst + (Math.random() - 0.5) * 150,
          vy: ny * burst * 0.68 - 180 - Math.random() * 110,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 18,
        });
      }
    }

    for (let i = 0; i < 72; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 260;
      this._dust.push({
        x: cx + (Math.random() - 0.5) * w * 0.4,
        y: cy + (Math.random() - 0.5) * h * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        r: 4 + Math.random() * 18,
        life: 0.45 + Math.random() * 0.5,
      });
    }
  }

  _fireImpact() {
    if (this._impactFired) return;
    this._impactFired = true;
    this._impactTime = this._t;
    this._buildShards();
    this._sourceCanvas = null;
    this._onImpact?.();
  }

  getShake() {
    return { x: this._shakeX, y: this._shakeY };
  }

  _updateShake(t) {
    const rumble = this.rumbleDuration;
    const shakeEnd = this.duration - 0.1;

    if (t > shakeEnd) {
      this._shakeX = 0;
      this._shakeY = 0;
      return;
    }

    let intensity;
    if (t < rumble) {
      const p = t / rumble;
      intensity = p * p * 0.85;
    } else if (t < rumble + 0.28) {
      const p = (t - rumble) / 0.28;
      intensity = 1 - p * 0.3;
    } else {
      const p = (t - rumble - 0.28) / (shakeEnd - rumble - 0.28);
      intensity = 0.7 * (1 - p);
    }

    const s = this._shakeSeed;
    const freq = t < rumble ? 9 + (t / rumble) * 7 : 14 + (t - rumble) * 5;
    const wave1 = Math.sin((t + s) * freq * Math.PI * 2);
    const wave2 = Math.cos((t + s * 0.65) * freq * 1.21 * Math.PI * 2);

    const ampX = 30 * intensity;
    const ampY = 24 * intensity;
    this._shakeX = wave1 * ampX + wave2 * ampX * 0.3;
    this._shakeY = wave2 * ampY + wave1 * ampY * 0.35;

    if (t >= rumble && t < rumble + 0.16) {
      const kick = 1 - (t - rumble) / 0.16;
      this._shakeX += (Math.random() - 0.5) * 56 * kick;
      this._shakeY += (Math.random() - 0.5) * 44 * kick;
    }
  }

  /** @param {number} dt */
  update(dt) {
    if (!this.active) return false;
    this._t += dt;
    const t = this._t;
    const g = 680;

    this._updateShake(t);

    if (t >= this.rumbleDuration) {
      this._fireImpact();
    }

    if (this._impactFired) {
      for (const shard of this._shards) {
        shard.vy += g * dt;
        shard.vx *= 1 - dt * 0.28;
        shard.x += shard.vx * dt;
        shard.y += shard.vy * dt;
        shard.rot += shard.vr * dt;
      }

      const dustT = t - this._impactTime;
      for (const d of this._dust) {
        if (dustT > d.life) continue;
        d.vy += 220 * dt;
        d.vx *= 1 - dt * 0.75;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
    }

    if (t >= this.duration) {
      this.active = false;
      this._shakeX = 0;
      this._shakeY = 0;
      this._shards = [];
      this._dust = [];
      this._shardSource = null;
      this.ctx.clearRect(0, 0, this._w, this._h);
      this.canvas.setAttribute("hidden", "");
      this.canvas.classList.remove("shatter-active");
      this.onComplete?.();
      return false;
    }
    return true;
  }

  draw() {
    if (!this.active) return;
    const ctx = this.ctx;
    const w = this._w;
    const h = this._h;
    const t = this._t;
    const sx = this._shakeX;
    const sy = this._shakeY;
    const rumble = this.rumbleDuration;

    ctx.clearRect(0, 0, w, h);

    if (!this._impactFired && this._sourceCanvas) {
      const rumbleProg = t / rumble;
      const squash = 1 + Math.sin(t * 28) * 0.014 * Math.min(1, rumbleProg);

      ctx.save();
      ctx.translate(w / 2 + sx, h / 2 + sy);
      ctx.scale(squash, squash);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(this._sourceCanvas, 0, 0, w, h);
      ctx.restore();
      return;
    }

    if (!this._impactFired) return;

    const sinceImpact = t - this._impactTime;
    const shardFade = Math.max(0, 1 - sinceImpact / this.shardFadeDuration);
    const src = this._shardSource;

    if (sinceImpact < 0.12) {
      const flash = (1 - sinceImpact / 0.12) * 0.5;
      const grad = ctx.createRadialGradient(
        this._cx + sx,
        this._cy + sy,
        0,
        this._cx + sx,
        this._cy + sy,
        Math.max(w, h) * 0.55
      );
      grad.addColorStop(0, `rgba(255, 245, 220, ${flash})`);
      grad.addColorStop(0.35, `rgba(220, 200, 170, ${flash * 0.35})`);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    if (src && shardFade > 0.02) {
      for (const shard of this._shards) {
        ctx.save();
        ctx.globalAlpha = shardFade * 0.98;
        ctx.translate(shard.x + sx * 0.55, shard.y + sy * 0.55);
        ctx.rotate(shard.rot);
        ctx.drawImage(
          src,
          shard.sx * (src.width / w),
          shard.sy * (src.height / h),
          shard.sw * (src.width / w),
          shard.sh * (src.height / h),
          -shard.w / 2,
          -shard.h / 2,
          shard.w,
          shard.h
        );
        ctx.restore();
      }
    }

    for (const d of this._dust) {
      const localT = sinceImpact;
      if (localT > d.life) continue;
      const a = (1 - localT / d.life) * 0.55 * shardFade;
      ctx.beginPath();
      ctx.arc(d.x + sx * 0.4, d.y + sy * 0.4, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110, 100, 88, ${a})`;
      ctx.fill();
    }
  }
}
