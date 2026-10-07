import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

function roundedBox(width, height, depth, radius = 0.08) {
  return new RoundedBoxGeometry(width, height, depth, 3, radius);
}

export default function Robot3D() {
  const hostRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer;
    let frameId = 0;
    let disposed = false;
    const geometries = [];
    const materials = [];
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

    function geometry(value) {
      geometries.push(value);
      return value;
    }

    function material(value) {
      materials.push(value);
      return value;
    }

    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 50);
      camera.position.set(0, 0.24, 8.3);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.shadowMap.enabled = false;
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xe9e5ff, 0x211b3b, 2.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
      keyLight.position.set(-3, 5, 6);
      scene.add(keyLight);
      const violetLight = new THREE.PointLight(0x9d78ff, 18, 8);
      violetLight.position.set(2, 0.2, 3);
      scene.add(violetLight);
      const mintLight = new THREE.PointLight(0x86f1d9, 8, 6);
      mintLight.position.set(-3, -1, 2);
      scene.add(mintLight);

      const robot = new THREE.Group();
      scene.add(robot);
      const metal = material(new THREE.MeshStandardMaterial({
        color: 0xd8d5e4, metalness: 0.62, roughness: 0.28,
      }));
      const sideMetal = material(new THREE.MeshStandardMaterial({ color: 0x77748c, metalness: 0.8, roughness: 0.3 }));
      const dark = material(new THREE.MeshStandardMaterial({ color: 0x10121e, metalness: 0.36, roughness: 0.2, emissive: 0x090c18 }));
      const eyeMaterial = material(new THREE.MeshPhysicalMaterial({ color: 0x9fffe9, emissive: 0x42ebc3, emissiveIntensity: 2.4, roughness: 0.12 }));
      const violet = material(new THREE.MeshStandardMaterial({ color: 0xb5a0ff, emissive: 0x7551e8, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.25 }));

      function addMesh(parent, shape, surface, position, scale) {
        if (!geometries.includes(shape)) geometries.push(shape);
        const mesh = new THREE.Mesh(shape, surface);
        mesh.position.set(...position);
        if (scale) mesh.scale.set(...scale);
        parent.add(mesh);
        return mesh;
      }

      function addJoint(parent, position, radius, surface = metal) {
        return addMesh(parent, new THREE.SphereGeometry(radius, 24, 18), surface, position);
      }

      const body = new THREE.Group();
      body.position.y = -0.72;
      robot.add(body);
      addMesh(body, geometry(roundedBox(1.42, 1.25, 0.8, 0.22)), metal, [0, 0, 0]);
      addMesh(body, geometry(roundedBox(0.94, 0.55, 0.08, 0.1)), dark, [0, -0.04, 0.44]);
      addMesh(body, geometry(roundedBox(0.48, 0.08, 0.04, 0.035)), violet, [0, 0.13, 0.5]);
      [-0.2, 0, 0.2].forEach((x, index) => {
        const light = material(new THREE.MeshStandardMaterial({
          color: [0x91f2d8, 0xb59aff, 0xf0a5c8][index],
          emissive: [0x45d6b2, 0x7551e8, 0xc44f92][index],
          emissiveIntensity: 1.8,
        }));
        addJoint(body, [x, -0.08, 0.5], 0.045, light);
      });
      addMesh(body, geometry(roundedBox(1.5, 0.16, 0.87, 0.07)), sideMetal, [0, -0.57, 0]);

      const headPivot = new THREE.Group();
      headPivot.position.set(0, 0.35, 0);
      robot.add(headPivot);
      const head = new THREE.Group();
      headPivot.add(head);
      addMesh(head, geometry(roundedBox(1.72, 1.3, 1.05, 0.2)), metal, [0, 0.76, 0]);
      addMesh(head, geometry(roundedBox(1.34, 0.79, 0.12, 0.12)), dark, [0, 0.74, 0.56]);
      addMesh(head, geometry(roundedBox(0.9, 0.035, 0.025, 0.015)), sideMetal, [0, 1.18, 0.63]);

      [-0.35, 0.35].forEach((x) => {
        addMesh(head, geometry(roundedBox(0.31, 0.42, 0.16, 0.14)), sideMetal, [x, 0.74, 0.65]);
        addJoint(head, [x, 0.76, 0.75], 0.115, eyeMaterial);
        addJoint(head, [x + 0.025, 0.76, 0.84], 0.048, dark);
        addJoint(head, [x + 0.04, 0.8, 0.88], 0.016, material(new THREE.MeshBasicMaterial({ color: 0xffffff })));
      });
      const mouth = addMesh(head, geometry(new THREE.BoxGeometry(0.2, 0.025, 0.025)), violet, [0, 0.47, 0.64]);
      mouth.rotation.z = -0.06;

      addMesh(head, geometry(roundedBox(0.15, 0.28, 0.15, 0.06)), sideMetal, [0, 1.49, 0]);
      const antenna = addJoint(head, [0, 1.68, 0], 0.105, eyeMaterial);
      addMesh(head, geometry(new THREE.CylinderGeometry(0.025, 0.035, 0.24, 16)), metal, [0, 1.56, 0]);

      const armPivots = [];
      [-1, 1].forEach((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.78, -0.38, 0);
        robot.add(pivot);
        armPivots.push({ pivot, side });
        addMesh(pivot, geometry(roundedBox(0.29, 0.72, 0.34, 0.13)), metal, [side * 0.09, -0.34, 0]);
        addJoint(pivot, [side * 0.11, -0.69, 0], 0.17, sideMetal);
        addMesh(pivot, geometry(roundedBox(0.34, 0.31, 0.36, 0.12)), metal, [side * 0.14, -0.88, 0.02]);
      });

      [-0.39, 0.39].forEach((x) => {
        const leg = new THREE.Group();
        leg.position.set(x, -1.38, 0);
        robot.add(leg);
        addMesh(leg, geometry(roundedBox(0.3, 0.52, 0.38, 0.12)), sideMetal, [0, -0.22, 0]);
        addMesh(leg, geometry(roundedBox(0.56, 0.23, 0.75, 0.1)), metal, [0, -0.55, 0.13]);
      });

      const floorGlow = new THREE.Mesh(
        geometry(new THREE.CircleGeometry(1.2, 48)),
        material(new THREE.MeshBasicMaterial({ color: 0x8065e8, transparent: true, opacity: 0.16, depthWrite: false })),
      );
      floorGlow.rotation.x = -Math.PI / 2;
      floorGlow.position.set(0, -2.03, -0.12);
      floorGlow.scale.set(1.4, 0.48, 1);
      scene.add(floorGlow);

      const pointerMove = (event) => {
        pointer.targetX = THREE.MathUtils.clamp((event.clientX / innerWidth - 0.5) * 2, -1, 1);
        pointer.targetY = THREE.MathUtils.clamp((event.clientY / innerHeight - 0.5) * 2, -1, 1);
      };
      const pointerLeave = () => {
        pointer.targetX = 0;
        pointer.targetY = 0;
      };
      window.addEventListener("pointermove", pointerMove, { passive: true });
      window.addEventListener("blur", pointerLeave);

      const resizeObserver = new ResizeObserver(() => {
        if (!host.clientWidth || !host.clientHeight) return;
        const bounds = host.getBoundingClientRect();
        renderer.setSize(bounds.width, bounds.height, false);
        camera.aspect = bounds.width / bounds.height;
        camera.updateProjectionMatrix();
      });
      resizeObserver.observe(host);

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      let previousTime = 0;
      let startedAt = 0;
      const render = (timestamp = 0) => {
        if (disposed || document.hidden) return;
        if (!startedAt) startedAt = timestamp;
        const delta = previousTime ? Math.min((timestamp - previousTime) / 1000, 0.05) : 1 / 60;
        previousTime = timestamp;
        frameId = window.requestAnimationFrame(render);
        const time = (timestamp - startedAt) / 1000;
        const follow = 1 - Math.exp(-delta * 13);
        pointer.x += (pointer.targetX - pointer.x) * follow;
        pointer.y += (pointer.targetY - pointer.y) * follow;
        const yaw = pointer.x * 0.72;
        const pitch = pointer.y * 0.46;
        headPivot.rotation.y += (yaw - headPivot.rotation.y) * follow;
        headPivot.rotation.x += (pitch - headPivot.rotation.x) * follow;
        robot.rotation.y += (pointer.x * 0.19 - robot.rotation.y) * follow * 0.72;
        if (!reducedMotion.matches) {
          robot.position.y = Math.sin(time * 1.25) * 0.07;
          antenna.scale.setScalar(1 + Math.sin(time * 4) * 0.12);
          armPivots.forEach(({ pivot, side }) => {
            pivot.rotation.z = Math.sin(time * 1.4 + side) * 0.06 * side;
          });
        }
        renderer.render(scene, camera);
      };
      const onVisibilityChange = () => {
        if (document.hidden) {
          window.cancelAnimationFrame(frameId);
          frameId = 0;
          previousTime = 0;
        } else {
          frameId = window.requestAnimationFrame(render);
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      frameId = window.requestAnimationFrame(render);

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frameId);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeObserver.disconnect();
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("blur", pointerLeave);
        geometries.forEach((item) => item.dispose());
        materials.forEach((item) => item.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (error) {
      console.error("Navo 3D robot could not initialize.", error);
      setFailed(true);
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      renderer?.dispose();
      renderer?.domElement.remove();
      return undefined;
    }
  }, []);

  return <div className={`robot-3d ${failed ? "robot-3d-failed" : ""}`} ref={hostRef} aria-hidden="true" />;
}
