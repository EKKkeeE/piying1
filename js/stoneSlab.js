/**
 * 阶段1巨型石板 + 手形凹槽渲染
 */

const SLAB_IMG = "assets/bg/stone/slab.jpg";
const GROOVE_IMG = "assets/bg/stone/hand_groove.png";
/** 凹槽相对 cover 尺寸的缩放（<1 缩小） */
const GROOVE_SCALE = 0.82;

export class StoneSlab {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "stone-slab-canvas";
    this.mount.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    /** @type {HTMLImageElement | null} */
    this.slabImg = null;
    /** @type {HTMLImageElement | null} */
    this.grooveImg = null;
    this._loadPromise = this._loadImages();
    this._w = 0;
    this._h = 0;
    this._pulseT = 0;
    /** @type {HTMLCanvasElement | null} */
    this._grooveCutMask = null;
    /** @type {HTMLCanvasElement | null} */
    this._grooveGlow = null;
    /** @type {HTMLCanvasElement | null} */
    this._grooveDepth = null;
    /** @type {HTMLCanvasElement | null} */
    this._grooveRelief = null;
    /** @type {HTMLCanvasElement | null} */
    this._grooveInnerShadow = null;
    /** @type {HTMLCanvasElement | null} */
    this._grooveRimLight = null;
  }

  /** 内壁阴影：边缘暗、中心相对亮 */
  _buildInnerShadow(cut, w, h) {
    const edge = document.createElement("canvas");
    edge.width = w;
    edge.height = h;
    const ectx = edge.getContext("2d");
    if (!ectx) return null;

    const blur = document.createElement("canvas");
    blur.width = w;
    blur.height = h;
    const bctx = blur.getContext("2d");
    bctx.filter = "blur(11px)";
    bctx.drawImage(cut, 0, 0);
    bctx.filter = "none";

    ectx.drawImage(blur, 0, 0);
    ectx.globalCompositeOperation = "destination-in";
    ectx.drawImage(cut, 0, 0);
    ectx.globalCompositeOperation = "source-atop";

    const rim = ectx.createRadialGradient(
      w * 0.5,
      h * 0.44,
      Math.min(w, h) * 0.18,
      w * 0.5,
      h * 0.48,
      Math.max(w, h) * 0.52
    );
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(0.58, "rgba(255,255,255,0)");
    rim.addColorStop(0.82, "rgba(40,32,26,0.75)");
    rim.addColorStop(1, "rgba(0,0,0,0.95)");
    ectx.fillStyle = rim;
    ectx.fillRect(0, 0, w, h);
    return edge;
  }

  /** 凹槽深浅渐变（multiply 用：越暗压得越狠） */
  _buildReliefShading(cut, w, h) {
    const relief = document.createElement("canvas");
    relief.width = w;
    relief.height = h;
    const ctx = relief.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#b8aea4";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(cut, 0, 0);
    ctx.globalCompositeOperation = "source-atop";

    const vgrad = ctx.createLinearGradient(0, 0, 0, h);
    vgrad.addColorStop(0, "rgba(255,255,255,0.45)");
    vgrad.addColorStop(0.35, "rgba(120,108,96,0.35)");
    vgrad.addColorStop(0.72, "rgba(40,34,28,0.7)");
    vgrad.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = vgrad;
    ctx.fillRect(0, 0, w, h);

    const rgrad = ctx.createRadialGradient(
      w * 0.5,
      h * 0.56,
      Math.min(w, h) * 0.04,
      w * 0.5,
      h * 0.52,
      Math.max(w, h) * 0.42
    );
    rgrad.addColorStop(0, "rgba(0,0,0,0.72)");
    rgrad.addColorStop(0.55, "rgba(50,42,36,0.35)");
    rgrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rgrad;
    ctx.fillRect(0, 0, w, h);
    return relief;
  }

  /** 上沿内缘高光（斜顶光） */
  _buildRimLight(glow, cut, w, h) {
    const rim = document.createElement("canvas");
    rim.width = w;
    rim.height = h;
    const ctx = rim.getContext("2d");
    if (!ctx) return null;

    ctx.save();
    ctx.translate(-3, -5);
    ctx.drawImage(glow, 0, 0);
    ctx.restore();
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(cut, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255, 236, 190, 0.72)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(glow, 0, 0);
    return rim;
  }

  /** 凹槽内壁暗线 */
  _buildGrooveLip(cut, w, h) {
    const lip = document.createElement("canvas");
    lip.width = w;
    lip.height = h;
    const ctx = lip.getContext("2d");
    if (!ctx) return null;

    ctx.filter = "blur(3px)";
    ctx.drawImage(cut, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-out";
    ctx.drawImage(cut, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(12, 10, 8, 0.9)";
    ctx.fillRect(0, 0, w, h);
    return lip;
  }

  /** 从凹槽图分离：手形镂空遮罩 + 纯发光边缘（去掉矩形深色底） */
  _buildGrooveLayers() {
    const img = this.grooveImg;
    if (!img) return;

    const w = img.width;
    const h = img.height;
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(img, 0, 0);
    const raw = sctx.getImageData(0, 0, w, h);

    const cut = document.createElement("canvas");
    cut.width = w;
    cut.height = h;
    const cutData = cut.getContext("2d").createImageData(w, h);

    const glow = document.createElement("canvas");
    glow.width = w;
    glow.height = h;
    const glowData = glow.getContext("2d").createImageData(w, h);

    for (let i = 0; i < raw.data.length; i += 4) {
      const r = raw.data[i];
      const g = raw.data[i + 1];
      const b = raw.data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const warm = r + g > b * 1.35 + 40;

      if (lum > 88 && warm) {
        const a = Math.min(255, (lum - 70) * 2.2);
        glowData.data[i] = r;
        glowData.data[i + 1] = g;
        glowData.data[i + 2] = b;
        glowData.data[i + 3] = a;
      } else if (lum >= 36 && lum <= 92) {
        cutData.data[i] = 255;
        cutData.data[i + 1] = 255;
        cutData.data[i + 2] = 255;
        cutData.data[i + 3] = Math.min(255, (lum - 30) * 4.5);
      }
    }

    cut.getContext("2d").putImageData(cutData, 0, 0);
    glow.getContext("2d").putImageData(glowData, 0, 0);

    this._grooveCutMask = cut;
    this._grooveGlow = glow;
    this._grooveRelief = this._buildReliefShading(cut, w, h);
    this._grooveInnerShadow = this._buildInnerShadow(cut, w, h);
    this._grooveRimLight = this._buildRimLight(glow, cut, w, h);
    this._grooveDepth = this._buildGrooveLip(cut, w, h);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} layer
   * @param {{ mirrorX?: boolean, alpha?: number, blend?: GlobalCompositeOperation }} opts
   */
  _drawGrooveLayer(ctx, layer, opts = {}) {
    const { dx, dy, dw, dh } = this._grooveRect(this.grooveImg);
    const { mirrorX = true, alpha = 1, blend = "source-over" } = opts;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blend;
    if (mirrorX) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(layer, 0, 0, dw, dh);
    } else {
      ctx.drawImage(layer, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  async _loadImages() {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    try {
      [this.slabImg, this.grooveImg] = await Promise.all([
        load(SLAB_IMG),
        load(GROOVE_IMG),
      ]);
      this._buildGrooveLayers();
    } catch {
      this.slabImg = null;
      this.grooveImg = null;
    }
  }

  resize() {
    const rect = this.mount.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this._w = rect.width;
    this._h = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** @param {HTMLImageElement} img */
  _coverRect(img, w = this._w, h = this._h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    return {
      dx: (w - dw) / 2,
      dy: (h - dh) / 2,
      dw,
      dh,
    };
  }

  /** 与背景同 cover 基准，再按 GROOVE_SCALE 居中缩小 */
  _grooveRect(img, w = this._w, h = this._h) {
    const cover = this._coverRect(img, w, h);
    const dw = cover.dw * GROOVE_SCALE;
    const dh = cover.dh * GROOVE_SCALE;
    return {
      dx: cover.dx + (cover.dw - dw) / 2,
      dy: cover.dy + (cover.dh - dh) / 2,
      dw,
      dh,
    };
  }

  /**
   * @param {number} [stageW]
   * @param {number} [stageH]
   */
  getGrooveBounds(stageW = this._w, stageH = this._h) {
    if (this.grooveImg && stageW > 0 && stageH > 0) {
      const gr = this._grooveRect(this.grooveImg, stageW, stageH);
      return {
        x0: gr.dx,
        y0: gr.dy,
        x1: gr.dx + gr.dw,
        y1: gr.dy + gr.dh,
        cx: gr.dx + gr.dw / 2,
        cy: gr.dy + gr.dh / 2,
        dw: gr.dw,
        dh: gr.dh,
      };
    }
    const cx = stageW * 0.5;
    const cy = stageH * 0.48;
    const r = Math.min(stageW, stageH) * 0.24;
    return {
      x0: cx - r,
      y0: cy - r,
      x1: cx + r,
      y1: cy + r,
      cx,
      cy,
      dw: r * 2,
      dh: r * 2,
    };
  }

  /** @returns {{ cx: number, cy: number, r: number }} */
  _grooveGeometry(w = this._w, h = this._h) {
    if (this.grooveImg && w > 0 && h > 0) {
      const gr = this._grooveRect(this.grooveImg, w, h);
      return {
        cx: gr.dx + gr.dw / 2,
        cy: gr.dy + gr.dh / 2,
        r: Math.min(gr.dw, gr.dh) * 0.36,
      };
    }
    return {
      cx: w * 0.5,
      cy: h * 0.48,
      r: Math.min(w, h) * 0.24,
    };
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLImageElement} img
   * @param {{ mirrorX?: boolean, alpha?: number, glow?: boolean, glowAlpha?: number, glowBlur?: number }} opts
   */
  _drawCoverImage(ctx, img, opts = {}) {
    const { dx, dy, dw, dh } = this._coverRect(img);
    const {
      mirrorX = false,
      alpha = 1,
      glow = false,
      glowAlpha = 0.6,
      glowBlur = 16,
    } = opts;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.shadowColor = `rgba(255, 200, 60, ${glowAlpha})`;
      ctx.shadowBlur = glowBlur;
    }
    if (mirrorX) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, dw, dh);
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ alpha?: number, glow?: boolean, glowAlpha?: number, glowBlur?: number, warm?: boolean }} opts
   */
  _drawGrooveGlow(ctx, opts = {}) {
    if (!this._grooveGlow) return;
    const {
      alpha = 0.9,
      glow = false,
      glowAlpha = 0.6,
      glowBlur = 16,
      warm = true,
    } = opts;

    ctx.save();
    if (glow) {
      ctx.shadowColor = `rgba(255, 200, 60, ${glowAlpha})`;
      ctx.shadowBlur = glowBlur;
    }
    this._drawGrooveLayer(ctx, this._grooveGlow, {
      mirrorX: true,
      alpha,
      blend: warm ? "screen" : "source-over",
    });
    ctx.restore();
  }

  /** 立体凹槽：压暗纹理 + 深浅渐变 + 内壁阴影 + 上沿高光 */
  _paintGrooveSculpt(ctx) {
    if (!this._grooveCutMask) return;

    if (this.slabImg) {
      ctx.save();
      const cover = this._coverRect(this.slabImg);
      ctx.filter = "brightness(0.38) contrast(1.18) saturate(0.75)";
      ctx.drawImage(this.slabImg, cover.dx, cover.dy, cover.dw, cover.dh);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "destination-in";
      this._drawGrooveLayer(ctx, this._grooveCutMask, {
        mirrorX: true,
        alpha: 1,
        blend: "source-over",
      });
      ctx.restore();
    } else {
      ctx.save();
      const { dx, dy, dw, dh } = this._grooveRect(this.grooveImg);
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.fillStyle = "rgb(22, 18, 14)";
      ctx.fillRect(0, 0, dw, dh);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this._grooveCutMask, 0, 0, dw, dh);
      ctx.restore();
    }

    if (this._grooveRelief) {
      this._drawGrooveLayer(ctx, this._grooveRelief, {
        mirrorX: true,
        alpha: 0.95,
        blend: "multiply",
      });
    }

    if (this._grooveInnerShadow) {
      this._drawGrooveLayer(ctx, this._grooveInnerShadow, {
        mirrorX: true,
        alpha: 0.82,
        blend: "multiply",
      });
    }

    if (this._grooveDepth) {
      this._drawGrooveLayer(ctx, this._grooveDepth, {
        mirrorX: true,
        alpha: 0.65,
        blend: "multiply",
      });
    }

    if (this._grooveRimLight) {
      this._drawGrooveLayer(ctx, this._grooveRimLight, {
        mirrorX: true,
        alpha: 0.62,
        blend: "soft-light",
      });
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ cx?: number, cy?: number, r?: number }} geo
   */
  _drawGrooveBreathe(ctx, geo = {}) {
    const wave = 0.5 + 0.5 * Math.sin(this._pulseT * 2.6);
    const peak = Math.pow(wave, 2.1);
    const alpha = 0.28 + 0.72 * peak;
    const blur = 22 + 78 * peak;
    const { cx, cy, r } = geo.cx != null ? geo : this._grooveGeometry();

    if (this._grooveGlow) {
      this._drawGrooveLayer(ctx, this._grooveGlow, {
        mirrorX: true,
        alpha: 0.28 + 0.62 * peak,
        blend: "screen",
      });
      this._drawGrooveGlow(ctx, {
        alpha: 0.48 + 0.52 * peak,
        glow: true,
        glowAlpha: alpha,
        glowBlur: blur * 1.7,
        warm: true,
      });
      this._drawGrooveGlow(ctx, {
        alpha: 0.62 + 0.38 * wave,
        glow: true,
        glowAlpha: 0.78 + 0.22 * peak,
        glowBlur: 18 + 32 * peak,
        warm: true,
      });
      if (peak > 0.22) {
        const hot = (peak - 0.22) / 0.78;
        ctx.save();
        ctx.shadowColor = `rgba(255, 248, 200, ${0.62 + 0.38 * hot})`;
        ctx.shadowBlur = 28 + 52 * hot;
        this._drawGrooveLayer(ctx, this._grooveGlow, {
          mirrorX: true,
          alpha: 0.52 + 0.48 * hot,
          blend: "lighter",
        });
        ctx.restore();
      }
      this._drawGrooveGlow(ctx, {
        alpha: 0.32 + 0.68 * peak,
        glow: false,
        warm: false,
      });
      return;
    }

    ctx.save();
    ctx.strokeStyle = `rgba(255, 245, 180, ${0.42 + 0.58 * peak})`;
    ctx.lineWidth = 3 + 4 * peak;
    ctx.shadowColor = `rgba(255, 220, 80, ${alpha})`;
    ctx.shadowBlur = blur;
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, false);
    ctx.strokeStyle = `rgba(255, 255, 245, ${0.35 + 0.65 * peak})`;
    ctx.lineWidth = 1.5 + 2.8 * peak;
    ctx.shadowColor = `rgba(255, 255, 220, ${0.55 + 0.45 * peak})`;
    ctx.shadowBlur = 12 + 38 * peak;
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, false);
    ctx.restore();
  }

  /**
   * @param {{ glowEdge?: boolean, grooveBreathe?: boolean, pulseShake?: boolean, edgeAlpha?: number, dt?: number }} opts
   */
  draw(opts = {}) {
    const ctx = this.ctx;
    if (!ctx || this._w <= 0) return;

    const {
      glowEdge = false,
      grooveBreathe = false,
      pulseShake = false,
      edgeAlpha = 0.6,
      dt = 0,
    } = opts;
    if (grooveBreathe || pulseShake) this._pulseT += dt;

    ctx.clearRect(0, 0, this._w, this._h);

    if (this.slabImg) {
      this._drawCoverImage(ctx, this.slabImg);
    } else {
      const grd = ctx.createLinearGradient(0, 0, this._w, this._h);
      grd.addColorStop(0, "#4a4438");
      grd.addColorStop(0.5, "#3a3530");
      grd.addColorStop(1, "#2e2a24");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this._w, this._h);
    }

    const { cx, cy, r } = this._grooveGeometry();
    const baseGlow = grooveBreathe ? 0.42 : 0.78;
    const baseEdge = grooveBreathe ? 0.18 : 0.35;

    if (this.grooveImg && this._grooveCutMask) {
      this._paintGrooveSculpt(ctx);
      this._drawGrooveGlow(ctx, { alpha: baseGlow, warm: true });
      this._drawGrooveGlow(ctx, { alpha: baseEdge, warm: false });
    } else if (this.grooveImg) {
      this._buildGrooveLayers();
      if (this._grooveCutMask) {
        this._paintGrooveSculpt(ctx);
        this._drawGrooveGlow(ctx, { alpha: baseGlow, warm: true });
        this._drawGrooveGlow(ctx, { alpha: baseEdge, warm: false });
      }
    } else {
      this._drawProceduralGroove(ctx, cx, cy, r);
    }

    if (grooveBreathe) {
      this._drawGrooveBreathe(ctx, { cx, cy, r });
    } else if (glowEdge || pulseShake) {
      let alpha = edgeAlpha;
      let blur = 16;
      if (pulseShake) {
        alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this._pulseT * 5));
        blur = 24;
      }
      if (this._grooveGlow) {
        this._drawGrooveGlow(ctx, {
          alpha: 1,
          glow: true,
          glowAlpha: alpha,
          glowBlur: blur,
          warm: true,
        });
        this._drawGrooveGlow(ctx, {
          alpha: 0.4 + alpha * 0.25,
          glow: false,
          warm: false,
        });
      } else {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 215, 80, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = `rgba(255, 200, 60, ${alpha})`;
        ctx.shadowBlur = blur;
        this._strokeGrooveOutline(ctx, cx, cy, r, alpha);
        ctx.restore();
      }
    }
  }

  _drawProceduralGroove(ctx, cx, cy, r) {
    ctx.save();
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, true);
    ctx.clip();

    const palmY = cy + r * 0.2;
    const grad = ctx.createLinearGradient(cx, cy - r, cx, palmY + r * 0.75);
    grad.addColorStop(0, "rgba(55, 48, 40, 0.55)");
    grad.addColorStop(0.45, "rgba(28, 24, 20, 0.82)");
    grad.addColorStop(1, "rgba(8, 6, 5, 0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r * 1.2, r * 2, r * 2.4);

    const pit = ctx.createRadialGradient(cx, cy + r * 0.15, 0, cx, cy, r * 0.95);
    pit.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    pit.addColorStop(0.65, "rgba(0, 0, 0, 0.2)");
    pit.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = pit;
    ctx.fillRect(cx - r, cy - r * 1.2, r * 2, r * 2.4);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 5;
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, false);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255, 210, 90, 0.75)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(255, 190, 50, 0.65)";
    ctx.shadowBlur = 14;
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, false);
    ctx.restore();

    ctx.save();
    ctx.translate(-1.5, -2);
    ctx.strokeStyle = "rgba(255, 248, 210, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    this._strokeGrooveOutline(ctx, cx, cy, r, 1, false);
    ctx.restore();
  }

  /** 左手张开（自拍镜像：拇指在右、小指在左） */
  _strokeGrooveOutline(ctx, cx, cy, r, _a, fill = false) {
    const tips = [
      [cx + r * 0.75, cy + r * 0.55],
      [cx + r * 0.55, cy - r * 0.85],
      [cx, cy - r * 1.05],
      [cx - r * 0.55, cy - r * 0.85],
      [cx - r * 0.75, cy + r * 0.55],
    ];
    const palm = [
      [cx + r * 0.85, cy + r * 0.2],
      [cx - r * 0.85, cy + r * 0.2],
      [cx - r * 0.65, cy + r * 0.75],
      [cx + r * 0.65, cy + r * 0.75],
    ];
    ctx.beginPath();
    ctx.moveTo(palm[0][0], palm[0][1]);
    for (const [x, y] of tips) ctx.lineTo(x, y);
    ctx.lineTo(palm[1][0], palm[1][1]);
    ctx.lineTo(palm[2][0], palm[2][1]);
    ctx.lineTo(palm[3][0], palm[3][1]);
    ctx.closePath();
    if (fill) ctx.fill();
    ctx.stroke();
  }

  /** 指尖锚点与凹槽几何同步（供对齐判定） */
  _tipAnchors(cx, cy, r) {
    return {
      thumb: { x: cx + r * 0.75, y: cy + r * 0.55 },
      index: { x: cx + r * 0.55, y: cy - r * 0.85 },
      middle: { x: cx, y: cy - r * 1.05 },
      ring: { x: cx - r * 0.55, y: cy - r * 0.85 },
      pinky: { x: cx - r * 0.75, y: cy + r * 0.55 },
    };
  }

  getGrooveAnchors(stageW = this._w, stageH = this._h) {
    const { cx, cy, r } = this._grooveGeometry(stageW, stageH);
    return this._tipAnchors(cx, cy, r);
  }

  getPuppetCenter(stageW = this._w, stageH = this._h) {
    const { cx, cy } = this._grooveGeometry(stageW, stageH);
    return { x: cx, y: cy };
  }

  async ready() {
    return this._loadPromise;
  }

  /** 仅隐藏石板绘制层，不影响震碎 canvas */
  hideSlab() {
    this.canvas.style.visibility = "hidden";
  }

  showSlab() {
    this.canvas.style.visibility = "";
  }

  /** 震碎动画结束后隐藏整个石板层 */
  hide() {
    this.hideSlab();
    this.mount.classList.add("stone-hidden");
  }

  show() {
    this.showSlab();
    this.mount.classList.remove("stone-hidden");
  }
}
