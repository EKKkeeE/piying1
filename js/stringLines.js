/**
 * 在皮影背景场景上绘制五指结点与绷紧提线（指尖→孔位直线，与示意图一致）
 */

export class StringLines {
  constructor(canvas, stageLayer) {
    this.canvas = canvas;
    this.stageLayer = stageLayer;
    this.ctx = canvas.getContext("2d");
  }

  resize() {
    const rect = this.stageLayer.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  draw(payload) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._w, this._h);

    const strings = payload.strings ?? [];
    const handSkeleton = payload.handSkeleton ?? { landmarks: [], connections: [] };
    const bindingMode = payload.bindingMode ?? false;

    if (bindingMode || handSkeleton.landmarks?.length) {
      this._drawHandSkeleton(ctx, handSkeleton, bindingMode);
    }

    for (const s of strings) {
      const finger = s.fingerPt ?? s.finger;
      if (!finger || !s.joint) continue;

      const grow = s.grow ?? 1;
      const jx = finger.x + (s.joint.x - finger.x) * grow;
      const jy = finger.y + (s.joint.y - finger.y) * grow;

      if (s.flash) {
        this._drawGoldFlash(ctx, finger.x, finger.y);
      }

      ctx.beginPath();
      ctx.moveTo(finger.x, finger.y);
      ctx.lineTo(jx, jy);
      ctx.strokeStyle = grow < 1 ? "rgba(255, 220, 100, 0.9)" : "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = grow < 1 ? 2 : 1.5;
      ctx.stroke();

      if (grow >= 0.95) {
        ctx.beginPath();
        ctx.arc(finger.x, finger.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 215, 70, 0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    for (const s of strings) {
      if (!s.joint || (s.grow ?? 1) < 0.95) continue;
      ctx.beginPath();
      ctx.arc(s.joint.x, s.joint.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
      ctx.fill();
    }

    if (payload.debug) {
      this._drawDebug(ctx, payload.debug);
    }
  }

  _drawGoldFlash(ctx, x, y) {
    const r = 28;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255, 245, 180, 0.95)");
    grd.addColorStop(0.35, "rgba(255, 210, 60, 0.55)");
    grd.addColorStop(1, "rgba(255, 180, 40, 0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * @param {{ anchors?: Record<string,{x:number,y:number}>, distances?: Record<string,number>, fitRadius?: number, shakeIntensity?: number }} debug
   */
  _drawDebug(ctx, debug) {
    if (debug.bounds) {
      const b = debug.bounds;
      ctx.strokeStyle = "rgba(0, 200, 255, 0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.setLineDash([]);
    }
    if (debug.anchors) {
      for (const [finger, pt] of Object.entries(debug.anchors)) {
        const d = debug.distances?.[finger];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 200, 60, 0.35)";
        ctx.fill();
        ctx.fillStyle = "#ffe";
        ctx.font = "11px monospace";
        ctx.fillText(`${finger}:${d != null ? Math.round(d) : "?"}`, pt.x + 6, pt.y - 4);
      }
    }
    if (debug.fitInCount != null) {
      ctx.fillStyle = "#fff";
      ctx.font = "13px monospace";
      ctx.fillText(`fit: ${debug.fitInCount}/5`, 12, 24);
    }
    if (debug.shakeIntensity != null) {
      ctx.fillStyle = "#fff";
      ctx.font = "13px monospace";
      const sustain =
        debug.shakeSustain != null
          ? ` ${Math.round(debug.shakeSustain * 100)}%`
          : "";
      ctx.fillText(
        `shake: ${Math.round(debug.shakeIntensity)}${sustain}`,
        12,
        42
      );
    }
  }

  clear() {
    this.ctx?.clearRect(0, 0, this._w, this._h);
  }

  _drawHandSkeleton(ctx, handSkeleton, bindingMode = false) {
    const landmarks = handSkeleton.landmarks ?? [];
    const connections = handSkeleton.connections ?? [];
    if (!landmarks.length) return;

    const byIndex = new Map(landmarks.map((lm) => [lm.index, lm]));

    ctx.strokeStyle = bindingMode
      ? "rgba(255, 215, 80, 0.65)"
      : "rgba(232, 197, 71, 0.42)";
    ctx.lineWidth = bindingMode ? 1.8 : 1.2;
    for (const [a, b] of connections) {
      const p0 = byIndex.get(a);
      const p1 = byIndex.get(b);
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    for (const lm of landmarks) {
      const r = lm.isTip ? (bindingMode ? 5 : 0) : 3.5;
      if (!lm.isTip || bindingMode) {
        ctx.beginPath();
        ctx.arc(lm.x, lm.y, r, 0, Math.PI * 2);
        ctx.fillStyle = bindingMode
          ? "rgba(255, 215, 70, 0.85)"
          : "rgba(232, 197, 71, 0.55)";
        ctx.fill();
        if (!bindingMode) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }
}
