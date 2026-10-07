/**
 * Fon sahnasi — sichqonchaga javob beradigan zarracha maydoni.
 *
 *  - WebGL (Three.js Points + ShaderMaterial): ~2200 zarracha, GPU da animatsiya (60 FPS)
 *  - WebGL bo'lmasa: Canvas 2D "gradient to'lqin" zaxira rejimi
 *  - "Kam harakat" rejimida: statik gradient (hech qanday animatsiya yo'q)
 */

const DESKTOP_POINTS = 2200;
const MOBILE_POINTS = 900;

export async function init({ reduced, small }) {
  const holder = document.querySelector("[data-scene]");
  if (!holder) return null;

  if (reduced) {
    staticBackdrop(holder);
    return null;
  }

  let THREE = null;
  try {
    THREE = await import("../vendor/three.module.min.js");
  } catch (error) {
    console.warn("[showcase] Three.js yuklanmadi:", error);
  }

  if (THREE && hasWebgl()) {
    try {
      return pointsField(THREE, holder, { small });
    } catch (error) {
      console.warn("[showcase] WebGL sahnasi ishga tushmadi, zaxira rejimga o'tildi:", error);
    }
  }
  return waveField(holder);
}

function hasWebgl() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

const VERTEX = `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  attribute float aScale;
  attribute vec3 aColor;
  varying float vGlow;
  varying vec3 vColor;

  void main() {
    vec3 pos = position;
    pos.x += sin(uTime * 0.32 + aSeed * 6.2831) * 9.0;
    pos.y += cos(uTime * 0.38 + aSeed * 9.4248) * 8.0;
    pos.z += sin(uTime * 0.50 + aSeed * 12.566) * 16.0;

    vec2 delta = pos.xy - uPointer;
    float distance = length(delta) + 0.001;
    pos.xy += (delta / distance) * exp(-distance * 0.02) * 32.0;

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = (aScale * uSize * uPixelRatio) / max(-view.z, 1.0);

    vGlow = clamp(exp(-distance * 0.012) * 1.25 + 0.22, 0.0, 1.0);
    vColor = aColor;
  }
`;

const FRAGMENT = `
  uniform float uOpacity;
  varying float vGlow;
  varying vec3 vColor;

  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    if (radius > 0.5) discard;
    float alpha = smoothstep(0.5, 0.0, radius);
    gl_FragColor = vec4(vColor * (0.55 + vGlow * 0.9), alpha * vGlow * uOpacity);
  }
`;

function pointsField(THREE, holder, { small }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 1, 1500);
  camera.position.z = 320;

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  holder.appendChild(renderer.domElement);

  const count = small ? MOBILE_POINTS : DESKTOP_POINTS;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const palette = [
    [0.65, 0.57, 0.98],
    [0.55, 0.9, 0.82],
    [0.95, 0.94, 1.0],
  ];

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 940;
    positions[index * 3 + 1] = (Math.random() - 0.5) * 620;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 340;
    seeds[index] = Math.random();
    scales[index] = 0.7 + Math.random() * 2.1;
    const tint = palette[(Math.random() * palette.length) | 0];
    colors[index * 3] = tint[0];
    colors[index * 3 + 1] = tint[1];
    colors[index * 3 + 2] = tint[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  const uniforms = {
    uTime: { value: 0 },
    uPointer: { value: new THREE.Vector2(0, 0) },
    uSize: { value: 26 },
    uOpacity: { value: 0.72 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const cloud = new THREE.Points(geometry, material);
  scene.add(cloud);

  const pointer = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  const clock = new THREE.Clock();
  let frame = 0;
  let visible = !document.hidden;

  const onPointerMove = (event) => {
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 900;
    pointer.y = -(event.clientY / window.innerHeight - 0.5) * 620;
  };

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uPixelRatio.value = renderer.getPixelRatio();
  };

  const render = () => {
    smooth.x += (pointer.x - smooth.x) * 0.055;
    smooth.y += (pointer.y - smooth.y) * 0.055;
    uniforms.uPointer.value.set(smooth.x, smooth.y);
    uniforms.uTime.value = clock.getElapsedTime();
    cloud.rotation.z = smooth.x * 0.00035;
    cloud.rotation.x = -smooth.y * 0.0004;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };

  const start = () => {
    if (frame || !visible) return;
    clock.start();
    frame = requestAnimationFrame(render);
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) start();
    else stop();
  };

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  start();

  return {
    renderer,
    destroy() {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Zaxira rejim: Canvas 2D yumshoq gradient "to'lqinlar" (WebGL kerak emas). */
function waveField(holder) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  holder.appendChild(canvas);
  const surface = canvas.getContext("2d");
  if (!surface) return null;

  const build = (color) => {
    const size = 256;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const paint = sprite.getContext("2d");
    const glow = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(8,9,15,0)");
    paint.fillStyle = glow;
    paint.fillRect(0, 0, size, size);
    return sprite;
  };

  const blobs = [
    { art: build("rgba(123,107,238,.85)"), x: 0.24, y: 0.3, r: 0.42, speed: 0.00021, phase: 0 },
    { art: build("rgba(140,228,206,.6)"), x: 0.74, y: 0.24, r: 0.34, speed: 0.00017, phase: 1.7 },
    { art: build("rgba(169,142,255,.72)"), x: 0.6, y: 0.72, r: 0.46, speed: 0.00013, phase: 3.1 },
    { art: build("rgba(96,86,190,.7)"), x: 0.16, y: 0.82, r: 0.38, speed: 0.00019, phase: 4.4 },
  ];

  const pointer = { x: 0.5, y: 0.5 };
  const smooth = { x: 0.5, y: 0.5 };
  let frame = 0;
  let ratio = 1;

  const resize = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    surface.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const render = (time) => {
    smooth.x += (pointer.x - smooth.x) * 0.04;
    smooth.y += (pointer.y - smooth.y) * 0.04;
    const width = window.innerWidth;
    const height = window.innerHeight;
    surface.clearRect(0, 0, width, height);
    surface.globalCompositeOperation = "lighter";

    blobs.forEach((blob) => {
      const drift = time * blob.speed;
      const x = blob.x * width + Math.sin(drift + blob.phase) * width * 0.06 + (smooth.x - 0.5) * 90;
      const y = blob.y * height + Math.cos(drift * 1.2 + blob.phase) * height * 0.05 + (smooth.y - 0.5) * 70;
      const radius = blob.r * Math.min(width, height) * (0.92 + Math.sin(drift * 2 + blob.phase) * 0.08);
      surface.globalAlpha = 0.75;
      surface.drawImage(blob.art, x - radius, y - radius, radius * 2, radius * 2);
    });

    surface.globalAlpha = 1;
    surface.globalCompositeOperation = "source-over";
    frame = requestAnimationFrame(render);
  };

  const onPointerMove = (event) => {
    pointer.x = event.clientX / window.innerWidth;
    pointer.y = event.clientY / window.innerHeight;
  };

  const start = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const onVisibility = () => (document.hidden ? stop() : start());

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  start();

  return {
    destroy() {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    },
  };
}

/** "Kam harakat" rejimi: bir marta chiziladigan statik nurli fon. */
function staticBackdrop(holder) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  holder.appendChild(canvas);
  const surface = canvas.getContext("2d");
  if (!surface) return;

  const draw = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    surface.setTransform(ratio, 0, 0, ratio, 0, 0);
    surface.clearRect(0, 0, width, height);
    const glow = surface.createRadialGradient(width * 0.5, height * 0.28, 0, width * 0.5, height * 0.28, width * 0.62);
    glow.addColorStop(0, "rgba(123,107,238,.3)");
    glow.addColorStop(0.55, "rgba(96,86,190,.12)");
    glow.addColorStop(1, "rgba(8,9,15,0)");
    surface.fillStyle = glow;
    surface.fillRect(0, 0, width, height);
  };

  draw();
  window.addEventListener("resize", draw);
}