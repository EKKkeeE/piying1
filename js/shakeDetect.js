/** 剧烈晃手检测：滑动窗口内指尖累计位移 + 持续时长 + 峰值 */

const TIP_INDICES = [0, 4, 8, 12, 16, 20];
/** 位移采样窗口（毫秒） */
const WINDOW_MS = 380;
/** 窗口内指尖累计位移达到此值视为「剧烈」 */
export const SHAKE_THRESHOLD_PX = 155;
/** 窗口内峰值位移至少达到此值（防止轻晃凑时长） */
const MIN_PEAK_PX = 210;
/** 累计剧烈晃动时长（毫秒） */
const SUSTAIN_MS = 900;
/** 连续超阈值帧数 */
const CONSECUTIVE_FRAMES = 5;
/** 低于阈值时，已累计时长衰减倍率 */
const SUSTAIN_DECAY = 2.2;

export class ShakeDetector {
  constructor() {
    /** @type {Array<{ t: number, pts: Array<{x:number,y:number}> }>} */
    this._history = [];
    this._overCount = 0;
    this._sustainMs = 0;
    this._peakIntensity = 0;
    this._lastFeedAt = 0;
    this.lastIntensity = 0;
    this.sustainProgress = 0;
  }

  reset() {
    this._history = [];
    this._overCount = 0;
    this._sustainMs = 0;
    this._peakIntensity = 0;
    this._lastFeedAt = 0;
    this.lastIntensity = 0;
    this.sustainProgress = 0;
  }

  /**
   * @param {Array<{ x: number, y: number }>} fingertipPts 舞台坐标指尖（含手腕）
   * @param {number} now
   */
  feed(fingertipPts, now) {
    if (!fingertipPts?.length) {
      this._overCount = 0;
      this._sustainMs = 0;
      this.lastIntensity = 0;
      this.sustainProgress = 0;
      return false;
    }

    const dt =
      this._lastFeedAt > 0 ? Math.min(Math.max(now - this._lastFeedAt, 0), 100) : 16;
    this._lastFeedAt = now;

    this._history.push({ t: now, pts: fingertipPts.map((p) => ({ ...p })) });
    const cutoff = now - WINDOW_MS;
    while (this._history.length && this._history[0].t < cutoff) {
      this._history.shift();
    }

    if (this._history.length < 2) {
      this.lastIntensity = 0;
      this.sustainProgress = this._sustainMs / SUSTAIN_MS;
      return false;
    }

    const first = this._history[0];
    const last = this._history[this._history.length - 1];
    let total = 0;
    const n = Math.min(first.pts.length, last.pts.length);
    for (let i = 0; i < n; i++) {
      total += Math.hypot(last.pts[i].x - first.pts[i].x, last.pts[i].y - first.pts[i].y);
    }
    this.lastIntensity = total;
    if (total > this._peakIntensity) this._peakIntensity = total;

    if (total >= SHAKE_THRESHOLD_PX) {
      this._overCount += 1;
      this._sustainMs += dt;
    } else {
      this._overCount = 0;
      this._sustainMs = Math.max(0, this._sustainMs - dt * SUSTAIN_DECAY);
    }

    this.sustainProgress = Math.min(1, this._sustainMs / SUSTAIN_MS);

    return (
      this._sustainMs >= SUSTAIN_MS &&
      this._peakIntensity >= MIN_PEAK_PX &&
      this._overCount >= CONSECUTIVE_FRAMES
    );
  }
}

export { TIP_INDICES as SHAKE_TRACK_INDICES };
