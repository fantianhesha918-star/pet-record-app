/* 3Dチンチラ表示(three.js)。モデルはライフロードの3D素材(Meshy→Blender軽量化、Draco圧縮)を流用 */
import * as THREE from "three";
import { GLTFLoader } from "https://unpkg.com/three@0.169.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://unpkg.com/three@0.169.0/examples/jsm/loaders/DRACOLoader.js";

const draco = new DRACOLoader();
draco.setDecoderPath("https://unpkg.com/three@0.169.0/examples/jsm/libs/draco/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const cache = new Map(); // url -> Promise<Object3D>
function loadModel(url) {
  if (!cache.has(url)) cache.set(url, new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej)));
  return cache.get(url);
}
const modelUrl = (coat, costume) =>
  new URL(costume && costume !== "none" ? `./models/costume-${costume}_chinchilla-${coat}.glb` : `./models/chinchilla-${coat}.glb`, import.meta.url).href;

export function createViewer() {
  const el = document.createElement("div");
  el.className = "v3d";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c9a8, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);

  const pivot = new THREE.Group(); // 回転・ジャンプ用
  scene.add(pivot);
  let model = null, wantKey = "", fit = { r: 1.6 }, widthScale = 1, bounce = 0;
  let userAngle = 0, lastTouch = 0, dragging = false, moved = false, lastX = 0;

  function resize() {
    const w = el.clientWidth || 300, h = el.clientHeight || 260;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);

  async function setLook({ coat, costume, scale }) {
    widthScale = scale || 1;
    const key = `${coat}|${costume}`;
    if (key === wantKey) return;
    wantKey = key;
    try {
      const tpl = await loadModel(modelUrl(coat, costume));
      if (wantKey !== key) return; // 後から別の指定が来た
      if (model) pivot.remove(model);
      model = tpl.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.sub(c); // 中心を原点へ
      const size = box.getSize(new THREE.Vector3());
      fit.r = Math.max(size.x, size.y, size.z) * 0.5;
      pivot.add(model);
      camera.position.set(0, fit.r * 0.3, fit.r * 4.5);
      camera.lookAt(0, 0, 0);
      el.dataset.ready = "1";
    } catch (e) {
      console.error(e);
      el.dataset.failed = "1";
    }
  }

  const down = (e) => { dragging = true; moved = false; lastX = e.clientX; el.setPointerCapture && el.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    if (Math.abs(dx) > 2) moved = true;
    userAngle += dx * 0.012; lastX = e.clientX; lastTouch = performance.now();
  };
  const up = () => { if (dragging && !moved) bounce = 1; dragging = false; lastTouch = performance.now(); };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  function tick() {
    requestAnimationFrame(tick);
    if (!el.isConnected || document.visibilityState === "hidden" || !model) return;
    if (!dragging && performance.now() - lastTouch > 2500) userAngle *= 0.96; // 放置すると正面へ戻る
    pivot.rotation.y = (el.dataset.front ? Number(el.dataset.front) : 0) + userAngle;
    if (bounce > 0) { bounce = Math.max(0, bounce - 0.035); pivot.position.y = Math.sin(bounce * Math.PI) * fit.r * 0.25; } else pivot.position.y = 0;
    model.scale.set(widthScale, 1, widthScale);
    renderer.render(scene, camera);
  }
  tick();
  return { el, setLook };
}
