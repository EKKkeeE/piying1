import { PuppetRig } from "./puppetRig.js";
import { FingerMarionette } from "./fingerMarionette.js";
import { StringLines } from "./stringLines.js";
import { LayoutCache } from "./layoutCache.js";
import { createHandDetector, TARGET_DETECT_FPS } from "./handDetect.js";
import { BgmPlayer } from "./bgm.js";
import { BindingPhase } from "./bindingPhase.js";
import { StoneSlab } from "./stoneSlab.js";
import { ShatterEffect } from "./shatterEffect.js";

const CAMERA_TARGET_FPS = 60;
/** 皮影模拟固定步长，与手部检测对齐，避免高刷屏 variable-dt 插值节奏错乱 */
const SIM_DT = 1 / TARGET_DETECT_FPS;
const MAX_SIM_STEPS = 3;
const DEBUG =
  new URLSearchParams(location.search).has("debug") ||
  new URLSearchParams(location.search).has("d");
const FORCE_CPU = new URLSearchParams(location.search).has("cpu");
/** MediaPipe 是否成功启用 GPU 推理 */
let gpuHandEnabled = false;

/** @type {'binding' | 'free'} */
let experiencePhase = "binding";

/** @type {import('@mediapipe/tasks-vision').HandLandmarker | null} */
let handLandmarker = null;
/** @type {import('./puppetRig.js').PuppetRig | null} */
let playerRig = null;
let fingerCtrl = null;
/** @type {StringLines | null} */
let stringLines = null;
/** @type {LayoutCache | null} */
let layoutCache = null;
/** @type {ReturnType<createHandDetector> | null} */
let handDetector = null;
/** @type {BindingPhase | null} */
let bindingPhase = null;
/** @type {StoneSlab | null} */
let stoneSlab = null;
/** @type {ShatterEffect | null} */
let shatterEffect = null;
let shatterStarted = false;
let running = false;
let animId = 0;
let lastTs = 0;
let simAccum = 0;
/** @type {{ hasHand: boolean, bones: object, strings: Array } | null} */
let lastPose = null;
/** 阶段1分段操控是否激活（用于中断时复位姿态） */
let bindingPartialActive = false;
/** @type {MediaStream | null} */
let cameraStream = null;

const els = {
  startOverlay: document.getElementById("start-overlay"),
  startBtn: document.getElementById("start-btn"),
  errorBox: document.getElementById("error-box"),
  hud: document.getElementById("hud"),
  video: /** @type {HTMLVideoElement} */ (document.getElementById("camera")),
  debugCanvas: /** @type {HTMLCanvasElement} */ (
    document.getElementById("debug-canvas")
  ),
  stringCanvas: /** @type {HTMLCanvasElement} */ (
    document.getElementById("string-canvas")
  ),
  stageInteraction: document.getElementById("stage-interaction"),
  puppetMountPlayer: document.getElementById("puppet-mount-player"),
  stage: document.getElementById("stage"),
  stageStone: document.getElementById("stage-stone"),
  bindingHint: document.getElementById("binding-hint"),
  shatterCanvas: /** @type {HTMLCanvasElement} */ (
    document.getElementById("stone-shatter-canvas")
  ),
};

/** @type {BgmPlayer | null} */
let bgm = null;

function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }
  els.video.srcObject = null;
}

async function openCamera(videoConstraints) {
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints ?? { facingMode: "user" },
    audio: false,
  });
}

async function acquireCameraStream() {
  stopCamera();
  const fps = { ideal: CAMERA_TARGET_FPS, min: 30 };
  const attempts = [
    {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: fps,
    },
    {
      facingMode: "user",
      width: { ideal: 480 },
      height: { ideal: 360 },
      frameRate: fps,
    },
    { facingMode: "user", frameRate: fps },
    true,
  ];
  let lastErr = null;
  for (const video of attempts) {
    try {
      return await openCamera(video === true ? undefined : video);
    } catch (err) {
      lastErr = err;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("无法打开摄像头");
}

function formatStartError(err) {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return "摄像头权限被拒绝。请在浏览器地址栏左侧允许摄像头，或到系统设置中开启后刷新页面。";
    }
    if (err.name === "NotFoundError") {
      return "未检测到摄像头设备。请连接摄像头后重试。";
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return (
        "摄像头被占用（Device in use）。请关闭正在使用摄像头的软件或网页标签后重试。" +
        "建议使用 Chrome/Edge 打开本页。"
      );
    }
  }
  const text = err instanceof Error ? err.message : String(err);
  if (/device in use|not readable|could not start/i.test(text)) {
    return "摄像头被占用。请关闭其他占用摄像头的程序后重试。";
  }
  if (location.protocol === "file:") {
    return "请通过本地服务器访问（双击 start.bat），不要使用 file:// 打开。";
  }
  return `启动失败：${text}。请使用 Chrome 或 Edge 访问 http://localhost:5173 。`;
}

async function loadRig(path) {
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`无法加载骨骼配置：${path}`);
  return res.json();
}

async function initHandLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
  );
  const wasmPath =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
  const vision = await FilesetResolver.forVisionTasks(wasmPath);
  const delegates = FORCE_CPU ? ["CPU"] : ["GPU", "CPU"];
  let lastErr = null;

  for (const delegate of delegates) {
    try {
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate,
        },
        runningMode: "VIDEO",
        numHands: 1,
      });
      gpuHandEnabled = delegate === "GPU";
      console.info(
        `[hand] MediaPipe ${delegate} · ${TARGET_DETECT_FPS} fps · camera target ${CAMERA_TARGET_FPS} fps`
      );
      return;
    } catch (err) {
      lastErr = err;
      handLandmarker = null;
    }
  }

  throw lastErr ?? new Error("无法初始化手部识别");
}

function applyPose(pose) {
  if (!playerRig) return;
  playerRig.setRootTransform(pose.root.x, pose.root.y, pose.root.rotation);

  for (const [name, rot] of Object.entries(pose.bones)) {
    if (!playerRig.parts?.[name]) continue;
    playerRig.setBoneRotation(name, rot);
  }
}

function applyBindingSpawn() {
  if (!fingerCtrl || !playerRig) return;
  const pose = fingerCtrl.getBindingPose();
  fingerCtrl.root = { x: pose.root.x, y: pose.root.y, rotation: 0 };
  lastPose = pose;
  applyPose(pose);
  playerRig.update(0, { direct: true });
}

function initSpawnPositions() {
  if (experiencePhase === "binding") {
    applyBindingSpawn();
    return;
  }
  const playerX = 0;
  playerRig?.setRootTransform(playerX, 0, 0);
  if (fingerCtrl) {
    fingerCtrl.root = { x: playerX, y: 0, rotation: 0 };
  }
}

function drawDebugHands(result) {
  if (!DEBUG || !els.debugCanvas) return;
  const ctx = els.debugCanvas.getContext("2d");
  if (!ctx) return;
  const w = els.debugCanvas.width;
  const h = els.debugCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!result?.landmarks?.length) return;

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
  ];

  for (const lm of result.landmarks) {
    ctx.strokeStyle = "rgba(232, 197, 71, 0.5)";
    ctx.lineWidth = 1;
    for (const [a, b] of connections) {
      ctx.beginPath();
      ctx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
      ctx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
      ctx.stroke();
    }
  }
}

function clearShatterShake() {
  const t = "translate(0px, 0px)";
  if (els.stageStone) els.stageStone.style.transform = t;
  if (els.stage) els.stage.style.transform = t;
  if (els.puppetMountPlayer) els.puppetMountPlayer.style.transform = t;
  if (els.stageInteraction) els.stageInteraction.style.transform = t;
}

function applyShatterShake() {
  if (!shatterEffect?.active) return;
  const { x, y } = shatterEffect.getShake();
  const t = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  if (els.stageStone && !els.stageStone.classList.contains("stone-hidden")) {
    els.stageStone.style.transform = t;
  }
  if (els.stage) els.stage.style.transform = t;
  if (els.puppetMountPlayer) els.puppetMountPlayer.style.transform = t;
  if (els.stageInteraction) els.stageInteraction.style.transform = t;
}

function enterFreePhase() {
  experiencePhase = "free";
  bindingPhase?.markDone();
  clearShatterShake();
  revealStageBackground();
  hideStoneLayer();
  if (els.bindingHint) {
    els.bindingHint.hidden = true;
    els.bindingHint.classList.remove("pulse-hint");
  }
  if (!shatterStarted) {
    lastPose = fingerCtrl?.getInitialPose() ?? null;
    if (lastPose) applyPose(lastPose);
  }
  simAccum = 0;
  handDetector?.reset();
  if (!bgm) bgm = new BgmPlayer();
  bgm.scheduleStart(1500);
}

function revealStageBackground() {
  els.stage?.classList.remove("stage-hidden");
  els.stage?.classList.add("stage-visible");
}

function hideStoneLayer() {
  stoneSlab?.hideSlab();
  if (els.stageStone) {
    els.stageStone.classList.remove("stone-shattering");
    els.stageStone.classList.add("stone-hidden");
    els.stageStone.style.opacity = "";
  }
}

function beginShatterPuppetControl() {
  if (!fingerCtrl || !playerRig) return;
  fingerCtrl.setBindingPhaseControl(null);
  simAccum = 0;
  fingerCtrl.root = {
    x: playerRig.rootExtra.x,
    y: playerRig.rootExtra.y,
    rotation: 0,
  };
  for (const [name, limb] of fingerCtrl.limbs) {
    const deg = playerRig.displayRotations[name];
    if (deg != null) limb.angle = deg;
  }
}

function startShatter() {
  if (shatterStarted || !stoneSlab || !shatterEffect || !els.stageStone) return;
  shatterStarted = true;

  beginShatterPuppetControl();

  stoneSlab.draw({});
  const rect = els.stageStone.getBoundingClientRect();

  shatterEffect.resize(rect.width, rect.height);
  els.stageStone.classList.add("stone-shattering");

  if (els.bindingHint) {
    els.bindingHint.hidden = true;
  }

  const center = stoneSlab.getPuppetCenter(rect.width, rect.height);

  shatterEffect.start(
    rect.width,
    rect.height,
    center.x,
    center.y,
    stoneSlab.canvas,
    {
      onImpact: () => {
        revealStageBackground();
        stoneSlab.hideSlab();
      },
    }
  );
}

function initBindingPhase() {
  if (!els.stageStone || !els.shatterCanvas) return;

  stoneSlab = new StoneSlab(els.stageStone);
  stoneSlab.resize();
  shatterEffect = new ShatterEffect(els.shatterCanvas, enterFreePhase);
  shatterStarted = false;

  bindingPhase = new BindingPhase({
    getGrooveBounds: (w, h) => stoneSlab.getGrooveBounds(w, h),
    getGrooveAnchors: (w, h) => stoneSlab.getGrooveAnchors(w, h),
    onRestoreParts: (parts) => playerRig?.restorePartColor(parts),
    onRevertParts: (parts) => playerRig?.revertPartsToDust(parts),
    onShatterStart: startShatter,
  });

  experiencePhase = "binding";
  els.stage?.classList.add("stage-hidden");
  els.stage?.classList.remove("stage-visible");
  els.stageStone.classList.remove("stone-hidden");
  if (els.bindingHint) {
    els.bindingHint.hidden = false;
    els.bindingHint.textContent = "将左手放入凹槽，绑定皮影";
  }

  playerRig?.enableDustMode();
  applyBindingSpawn();

  stoneSlab.ready().then(() => {
    stoneSlab?.resize();
    stoneSlab?.draw({});
  });
}

/**
 * @param {number} ts
 * @param {number} frameDt
 */
function loopBinding(ts, frameDt) {
  if (!handLandmarker || !handDetector || !playerRig || !layoutCache || !bindingPhase) {
    return;
  }

  const handTick = handDetector.tick(handLandmarker, ts);
  const handResult = handTick?.result ?? handDetector.getCached();

  layoutCache.refresh(true);
  const stageRect = layoutCache.stageRect;
  const phase = bindingPhase.update(frameDt, handResult, stageRect, playerRig);

  if (phase.shatterTriggered && !shatterStarted) {
    startShatter();
  }

  const shatterActive = shatterEffect?.active;

  if (shatterActive && fingerCtrl) {
    fingerCtrl.setBindingPhaseControl(null);
    if (handTick?.fresh) {
      fingerCtrl.updateFromHand(handResult, layoutCache);
      if (DEBUG) drawDebugHands(handResult);
    }
    layoutCache.refresh();

    simAccum = Math.min(simAccum + frameDt, SIM_DT * MAX_SIM_STEPS);
    let steps = 0;
    while (simAccum >= SIM_DT && steps < MAX_SIM_STEPS) {
      simAccum -= SIM_DT;
      steps += 1;
      lastPose = fingerCtrl.step(SIM_DT, playerRig, layoutCache);
      applyPose(lastPose);
    }

    const pose = lastPose;
    playerRig.update(SIM_DT, {
      idle: !pose?.hasHand,
      direct: true,
      alpha: pose?.hasHand ? 0.45 : 0.12,
    });
    bindingPartialActive = false;
  } else {
    if (DEBUG && handTick?.fresh) drawDebugHands(handResult);

    layoutCache.refresh(true);

    const partialReady =
      (phase.state === "binding" || phase.state === "shakePrompt") &&
      phase.boundIds.size > 0;

    if (partialReady && fingerCtrl) {
      if (phase.state === "shakePrompt") {
        fingerCtrl.setBindingPhaseControl(null);
      } else {
        fingerCtrl.setBindingPhaseControl(phase.boundIds, true);
      }

      if (handTick?.fresh) {
        fingerCtrl.updateFromHand(handResult, layoutCache);
      }
      layoutCache.refresh();

      simAccum = Math.min(simAccum + frameDt, SIM_DT * MAX_SIM_STEPS);
      let steps = 0;
      while (simAccum >= SIM_DT && steps < MAX_SIM_STEPS) {
        simAccum -= SIM_DT;
        steps += 1;
        lastPose = fingerCtrl.step(SIM_DT, playerRig, layoutCache);
        applyPose(lastPose);
      }

      const pose = lastPose;
      playerRig.update(SIM_DT, {
        idle: !pose?.hasHand,
        direct: true,
        alpha: pose?.hasHand ? 0.38 : 0.08,
      });
      bindingPartialActive = true;
    } else {
      fingerCtrl?.setBindingPhaseControl(null);
      if (bindingPartialActive) {
        applyBindingSpawn();
        bindingPartialActive = false;
      }

      if (!lastPose && fingerCtrl) {
        lastPose = fingerCtrl.getBindingPose();
      }
      if (lastPose) {
        playerRig.applyKinematicSnapshot(
          lastPose.bones ?? {},
          lastPose.root?.x ?? 0,
          lastPose.root?.y ?? 0,
          0
        );
      }
      playerRig.update(SIM_DT, { idle: true, direct: true, alpha: 0.08 });
    }
  }

  if (els.bindingHint) {
    els.bindingHint.textContent = phase.hintText;
    els.bindingHint.classList.toggle("pulse-hint", phase.pulseShake);
  }

  if (stoneSlab && phase.state !== "shattering" && !shatterActive) {
    stoneSlab.draw({
      glowEdge: phase.glowEdge,
      grooveBreathe: phase.grooveBreathe,
      pulseShake: phase.pulseShake,
      dt: frameDt,
    });
  }

  if (shatterActive) {
    shatterEffect.update(frameDt);
    shatterEffect.draw();
    applyShatterShake();
  }

  if (shatterActive && fingerCtrl && lastPose) {
    const strings = fingerCtrl.buildStringsFromDom(playerRig, layoutCache);
    const handSkeleton = fingerCtrl.syncHandSkeletonWithStrings(
      lastPose.handSkeleton ?? { landmarks: [], connections: [] },
      strings
    );
    stringLines?.draw({ strings, handSkeleton });
  } else {
    stringLines?.draw({
      strings: phase.strings,
      handSkeleton: phase.handSkeleton,
      bindingMode: true,
      debug:
        DEBUG && !shatterActive
          ? {
              anchors: stoneSlab?.getGrooveAnchors(
                stageRect.width,
                stageRect.height
              ),
              bounds: stoneSlab?.getGrooveBounds(
                stageRect.width,
                stageRect.height
              ),
              distances: phase.debugDistances,
              fitRadius: phase.fitRadius,
              fitInCount: phase.fitInCount,
              shakeIntensity: phase.shakeIntensity,
            shakeSustain: phase.shakeSustain,
            }
          : undefined,
    });
  }
}

/**
 * @param {number} ts
 * @param {number} frameDt
 */
function loopFree(ts, frameDt) {
  if (!handLandmarker || !handDetector || !fingerCtrl || !playerRig || !layoutCache) {
    return;
  }

  const handTick = handDetector.tick(handLandmarker, ts);
  if (handTick?.fresh) {
    fingerCtrl.updateFromHand(handTick.result, layoutCache);
    if (DEBUG) drawDebugHands(handTick.result);
  }

  if (!lastPose) {
    lastPose = fingerCtrl.getInitialPose();
    applyPose(lastPose);
  }

  layoutCache.refresh();

  simAccum = Math.min(simAccum + frameDt, SIM_DT * MAX_SIM_STEPS);
  let steps = 0;
  while (simAccum >= SIM_DT && steps < MAX_SIM_STEPS) {
    simAccum -= SIM_DT;
    steps += 1;
    lastPose = fingerCtrl.step(SIM_DT, playerRig, layoutCache);
    applyPose(lastPose);
  }

  const pose = lastPose;
  playerRig.update(SIM_DT, {
    idle: !pose?.hasHand,
    direct: true,
    alpha: pose?.hasHand ? 0.45 : 0.12,
  });

  const strings = fingerCtrl.buildStringsFromDom(playerRig, layoutCache);
  const handSkeleton = fingerCtrl.syncHandSkeletonWithStrings(
    lastPose.handSkeleton ?? { landmarks: [], connections: [] },
    strings
  );

  stringLines?.draw({
    fingerNodes: [],
    strings: strings.length ? strings : lastPose.strings ?? [],
    handSkeleton,
  });
}

function loop(ts) {
  if (!running) return;
  animId = requestAnimationFrame(loop);

  const frameDt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : SIM_DT;
  lastTs = ts;

  if (experiencePhase === "binding") {
    loopBinding(ts, frameDt);
    return;
  }

  loopFree(ts, frameDt);
}

async function initPuppet() {
  const playerRigData = await loadRig("assets/wukong/rig.json");

  els.puppetMountPlayer.innerHTML = "";

  playerRig = new PuppetRig(els.puppetMountPlayer, playerRigData);
  fingerCtrl = new FingerMarionette(playerRigData);
  layoutCache = new LayoutCache(
    els.stageInteraction,
    () => playerRig,
    els.puppetMountPlayer
  );
  layoutCache.refresh(true);

  initSpawnPositions();

  lastPose = fingerCtrl.getInitialPose();
  applyPose(lastPose);
  playerRig.update(0, { direct: true });
}

async function startExperience() {
  hideError();
  els.startBtn.disabled = true;
  els.startBtn.textContent = "正在加载…";

  try {
    const stream = await acquireCameraStream();
    cameraStream = stream;
    els.video.srcObject = stream;
    await els.video.play();

    await initHandLandmarker();
    handDetector = createHandDetector(els.video, {
      detectFps: TARGET_DETECT_FPS,
    });

    if (DEBUG) {
      els.debugCanvas.width = els.video.videoWidth || 640;
      els.debugCanvas.height = els.video.videoHeight || 480;
    }

    stringLines = new StringLines(els.stringCanvas, els.stageInteraction);
    stringLines.resize();

    await initPuppet();
    initBindingPhase();

    els.startOverlay.classList.add("hidden");

    if (!bgm) bgm = new BgmPlayer();

    running = true;
    lastTs = 0;
    simAccum = 0;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
    if (DEBUG) {
      document.getElementById("camera-panel")?.classList.add("debug-on");
    }
  } catch (err) {
    console.error(err);
    stopCamera();
    running = false;
    showError(formatStartError(err));
    els.startBtn.disabled = false;
    els.startBtn.textContent = "重试";
  }
}

els.startBtn?.addEventListener("click", startExperience);

window.addEventListener("pagehide", () => {
  running = false;
  cancelAnimationFrame(animId);
  bgm?.stop();
  stopCamera();
});

window.addEventListener("resize", () => {
  stringLines?.resize();
  layoutCache?.refresh(true);
  stoneSlab?.resize();
  if (els.stageStone && shatterEffect) {
    const rect = els.stageStone.getBoundingClientRect();
    shatterEffect.resize(rect.width, rect.height);
  }
  initSpawnPositions();
  if (DEBUG && els.video.videoWidth) {
    els.debugCanvas.width = els.video.videoWidth;
    els.debugCanvas.height = els.video.videoHeight;
  }
});
