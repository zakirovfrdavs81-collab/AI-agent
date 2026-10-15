const FULL_TURN = Math.PI * 2;
const ROTATION_SPEED = 0.22;

export async function init({ reduced, small }) {
  const holder = document.querySelector("[data-core-scene]");
  const stage = holder?.closest("[data-core-stage]");
  if (!holder || !stage) return null;

  const THREE = await import("../vendor/three.module.min.js");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !small,
      powerPreference: "low-power",
    });
  } catch (error) {
    console.warn("[showcase] 3D yadro uchun WebGL mavjud emas; CSS zaxira vizuali ishlatiladi.", error);
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  camera.position.set(0, 0, 7.1);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("role", "presentation");
  renderer.domElement.setAttribute("aria-hidden", "true");
  holder.appendChild(renderer.domElement);

  const geometries = [];
  const materials = [];
  const makeMaterial = (material) => {
    materials.push(material);
    return material;
  };
  const makeGeometry = (geometry) => {
    geometries.push(geometry);
    return geometry;
  };

  scene.add(new THREE.AmbientLight(0xaeb7ff, 1.25));
  const violetLight = new THREE.PointLight(0x8064ff, 24, 12);
  violetLight.position.set(-3.2, 2.5, 3.4);
  scene.add(violetLight);
  const mintLight = new THREE.PointLight(0x53f3d7, 20, 11);
  mintLight.position.set(3.1, -1.8, 2.8);
  scene.add(mintLight);
  const rimLight = new THREE.PointLight(0x6c73ff, 15, 9);
  rimLight.position.set(0, 3.4, -2.5);
  scene.add(rimLight);

  const assembly = new THREE.Group();
  const spinGroup = new THREE.Group();
  assembly.add(spinGroup);
  scene.add(assembly);

  const crystalGeometry = makeGeometry(new THREE.IcosahedronGeometry(1.05, 1));
  const crystalMaterial = makeMaterial(new THREE.MeshPhysicalMaterial({
    color: 0xb8b4ff,
    metalness: 0.72,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    emissive: 0x34266f,
    emissiveIntensity: 0.48,
    flatShading: true,
  }));
  const crystal = new THREE.Mesh(crystalGeometry, crystalMaterial);
  spinGroup.add(crystal);

  const shell = new THREE.LineSegments(
    makeGeometry(new THREE.EdgesGeometry(crystalGeometry)),
    makeMaterial(new THREE.LineBasicMaterial({ color: 0xc7c1ff, transparent: true, opacity: 0.52 })),
  );
  shell.scale.setScalar(1.012);
  spinGroup.add(shell);

  const heart = new THREE.Mesh(
    makeGeometry(new THREE.IcosahedronGeometry(0.47, 2)),
    makeMaterial(new THREE.MeshStandardMaterial({
      color: 0x6debd6,
      metalness: 0.18,
      roughness: 0.2,
      emissive: 0x239f94,
      emissiveIntensity: 1.2,
    })),
  );
  spinGroup.add(heart);

  const ringSpecs = [
    { radius: 1.55, tube: 0.018, color: 0xa99bfa, rotation: [0.66, 0.14, -0.42] },
    { radius: 1.8, tube: 0.012, color: 0x69e8d2, rotation: [1.18, -0.35, 0.52] },
    { radius: 1.32, tube: 0.009, color: 0x747aff, rotation: [0.12, 0.84, 0.22] },
  ];
  ringSpecs.forEach(({ radius, tube, color, rotation }, index) => {
    const ring = new THREE.Mesh(
      makeGeometry(new THREE.TorusGeometry(radius, tube, 8, 128)),
      makeMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: index === 0 ? 0.72 : 0.5 })),
    );
    ring.rotation.set(...rotation);
    spinGroup.add(ring);
  });

  const satelliteMaterial = makeMaterial(new THREE.MeshStandardMaterial({
    color: 0xe3dcff,
    emissive: 0x7767ff,
    emissiveIntensity: 0.8,
    metalness: 0.35,
    roughness: 0.22,
  }));
  const satellites = [
    { position: [-1.66, 0.45, 0.2], scale: 0.085 },
    { position: [1.38, -0.94, 0.12], scale: 0.065 },
    { position: [0.62, 1.65, -0.25], scale: 0.055 },
  ];
  satellites.forEach(({ position, scale }) => {
    const satellite = new THREE.Mesh(makeGeometry(new THREE.SphereGeometry(scale, 12, 10)), satelliteMaterial);
    satellite.position.set(...position);
    spinGroup.add(satellite);
  });

  const particleCount = small ? 90 : 180;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const distance = 2 + Math.random() * 2.2;
    const azimuth = Math.random() * FULL_TURN;
    const elevation = Math.acos(2 * Math.random() - 1);
    particlePositions[index * 3] = distance * Math.sin(elevation) * Math.cos(azimuth);
    particlePositions[index * 3 + 1] = distance * Math.sin(elevation) * Math.sin(azimuth);
    particlePositions[index * 3 + 2] = distance * Math.cos(elevation);
  }
  const particleGeometry = makeGeometry(new THREE.BufferGeometry());
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(
    particleGeometry,
    makeMaterial(new THREE.PointsMaterial({
      color: 0xc6c1ff,
      size: small ? 0.025 : 0.03,
      transparent: true,
      opacity: 0.68,
      sizeAttenuation: true,
      depthWrite: false,
    })),
  );
  scene.add(particles);

  const pointer = { x: 0, y: 0 };
  const motion = { x: 0, y: 0 };
  const reducedMotion = reduced;
  let elapsed = 0;
  let lastFrameTime = 0;
  let frame = 0;
  let visible = false;
  let active = !document.hidden;
  let disposed = false;
  let lastTurn = -1;

  const render = (time) => {
    frame = 0;
    if (disposed || !visible || !active) return;

    const delta = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 0;
    lastFrameTime = time;
    elapsed += delta;
    const bounds = stage.getBoundingClientRect();
    const scrollProgress = Math.max(-1, Math.min(1, (window.innerHeight * 0.5 - (bounds.top + bounds.height * 0.5)) / (window.innerHeight + bounds.height)));
    const targetX = reducedMotion ? 0 : pointer.y * 0.11 + scrollProgress * 0.12;
    const targetY = reducedMotion ? 0 : pointer.x * 0.14 + scrollProgress * 0.16;
    motion.x += (targetX - motion.x) * 0.035;
    motion.y += (targetY - motion.y) * 0.035;

    spinGroup.rotation.set(motion.x, elapsed * ROTATION_SPEED + motion.y, Math.sin(elapsed * 0.16) * 0.035);
    heart.rotation.set(elapsed * 0.17, -elapsed * 0.24, elapsed * 0.08);
    particles.rotation.set(elapsed * 0.012, -elapsed * 0.018, elapsed * 0.01);
    camera.position.y = -scrollProgress * 0.16;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    const turns = Math.floor(elapsed * ROTATION_SPEED / FULL_TURN);
    if (turns !== lastTurn) {
      lastTurn = turns;
      stage.dataset.coreTurns = String(turns);
    }
    if (!reducedMotion) frame = requestAnimationFrame(render);
  };

  const scheduleRender = () => {
    if (!disposed && visible && active && !frame) frame = requestAnimationFrame(render);
  };

  const resize = () => {
    const width = Math.max(1, holder.clientWidth);
    const height = Math.max(1, holder.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    scheduleRender();
  };

  const onPointerMove = (event) => {
    if (reducedMotion || (event.pointerType && event.pointerType !== "mouse")) return;
    const bounds = stage.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    pointer.y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
  };

  const onPointerLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
  };

  const onVisibilityChange = () => {
    active = !document.hidden;
    if (active) scheduleRender();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) scheduleRender();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }, { threshold: 0.01 });
  intersectionObserver.observe(stage);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(holder);
  stage.addEventListener("pointermove", onPointerMove, { passive: true });
  stage.addEventListener("pointerleave", onPointerLeave, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  resize();

  stage.classList.add("has-webgl");
  return {
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      stage.classList.remove("has-webgl");
      delete stage.dataset.coreTurns;
    },
  };
}
