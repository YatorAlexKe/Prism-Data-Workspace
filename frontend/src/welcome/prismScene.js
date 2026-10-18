import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The welcome scene: a glass prism, the user's sources orbiting it, threads of
// light converging into it, and a spectrum fanning out into the three result
// views (chart / table / map). Plain three.js, no React — Welcome.jsx owns the
// DOM (text, labels, controls) and talks to this through the returned handle.
//
// Everything is driven by one intro clock `t` so the sequence can be played,
// compressed for return visits, skipped, or frozen at its final frame for
// reduced motion.

const BG = 0x0d0f14;
const SPECTRUM = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa'];

// Intro timeline, seconds.
const T = {
  prism: [0.15, 1.7],
  arrive: [0.8, 3.0],
  beams: [2.1, 3.9],
  core: [2.9, 4.4],
  fan: [3.7, 5.1],
  outputs: [4.3, 5.8],
  reveal: 4.5,
  end: 6.2,
};

const FAN_LENGTH = 6.4;
const OUTPUT_DIST = 4.7;
const OUTPUT_GAP = 1.8;
const ORBIT_REACH = 4.75; // widest orbit radius + half a glyph
const EXIT = new THREE.Vector3(0.5, 0.3, 0); // centre of the prism's right face

const clamp01 = x => Math.min(1, Math.max(0, x));
const ease = x => 1 - Math.pow(1 - x, 3);
const ramp = (t, [a, b]) => ease(clamp01((t - a) / (b - a)));
const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

export function createPrismScene(canvas, opts) {
  const {
    items,                 // [{ shape, color, size }]
    outputs,               // [{ key, color }]
    returning = false,
    reducedMotion = false,
    tier = 'high',         // 'high' | 'low'
    wideQuery,             // MediaQueryList shared with the CSS layout
    safeLeft = () => 0,    // px: right edge of the copy column (wide layout)
    onReveal = () => {},
    onProject = () => {},
    onLost = () => {},     // GL context lost, or the device can't keep up
  } = opts;

  // ── renderer ────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', powerPreference: 'high-performance' });
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, tier === 'high' ? 1.75 : 1);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.03);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = true;
  let bloomHalf = false;   // perf step: bloom at half resolution

  const glowTex = makeGlowTexture();

  // ── lights ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x8a96c0, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c8cff, 1.2);
  rim.position.set(3, -2, -6);
  scene.add(rim);
  const coreLight = new THREE.PointLight(0xffffff, 0, 12, 1.6);
  scene.add(coreLight);

  // ── backdrop halo ───────────────────────────────────────────────────────
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x5b5fd6, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.set(11, 11, 1);
  halo.position.set(0, 0.2, -3);
  scene.add(halo);

  // ── prism ───────────────────────────────────────────────────────────────
  const prism = new THREE.Group();
  scene.add(prism);

  let prismGeo = new THREE.CylinderGeometry(1.2, 1.2, 1.5, 3, 1);
  prismGeo.rotateX(-Math.PI / 2);           // triangle faces the camera, apex up
  prismGeo = prismGeo.toNonIndexed();       // flat-shaded facets
  prismGeo.computeVertexNormals();

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 1.5,
    dispersion: 5,
    iridescence: 0.35,
    iridescenceIOR: 1.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    attenuationColor: new THREE.Color(0xd4dcff),
    attenuationDistance: 5,
    transparent: true,
    opacity: 0,
  });
  const prismMesh = new THREE.Mesh(prismGeo, glass);
  prism.add(prismMesh);

  // Glass shows its far edges, so the edge lines ignore depth (this also
  // avoids z-fighting with the faces they sit on).
  const prismEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(prismGeo),
    new THREE.LineBasicMaterial({
      color: 0xe6ecff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }),
  );
  prismEdges.renderOrder = 10;
  prism.add(prismEdges);

  // Fresnel rim: facets brighten as they turn edge-on to the camera.
  const rimShell = new THREE.Mesh(prismGeo, new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 col = mix(vec3(0.55, 0.62, 1.0), vec3(0.9, 0.95, 1.0), f);
        float a = (0.06 + 0.5 * f) * uOpacity;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }));
  rimShell.renderOrder = 9;
  prism.add(rimShell);

  // The core sits inside the glass, so it must not be depth-tested against it.
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
  }));
  core.scale.set(1.6, 1.6, 1);
  core.renderOrder = 11;
  prism.add(core);

  // ── layout-dependent framing ────────────────────────────────────────────
  let orbitScale = 1;
  let outputScale = 1;
  const view = { w: 1, h: 1, wide: true };

  function layout() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    view.w = w; view.h = h;
    view.wide = wideQuery ? wideQuery.matches : aspect >= 1.25;

    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let fx, fy, dist;
    if (view.wide) {
      // Prism sits right of centre; the text column owns the left third.
      fx = 0.63; fy = 0.5;
      orbitScale = 1;
      fanGroup.scale.setScalar(1);
      outputScale = 1;
      const rightNeed = (EXIT.x + FAN_LENGTH * 0.92) / (2 * (1 - fx));
      // Keep the far side of the orbit clear of the copy column.
      const roomPx = fx * w - safeLeft() - 24;
      const leftNeed = roomPx > 40 ? (ORBIT_REACH * w) / (2 * roomPx) : 0;
      dist = Math.max(rightNeed / (tan * aspect), leftNeed / (tan * aspect), 4.6 / tan);
    } else {
      // Stacked: scene in the upper part, text below.
      fx = 0.5; fy = aspect < 0.8 ? 0.36 : 0.34;
      orbitScale = 0.82;
      fanGroup.scale.setScalar(0.6);
      outputScale = 0.72;
      const halfW = 4.5 * orbitScale + 0.4;
      dist = Math.max(halfW / (tan * aspect), (4.5 * orbitScale) / (2 * fy * tan));
    }
    camera.aspect = aspect;
    camera.position.set(0, 0.35, dist);
    baseCamZ = dist;
    scene.fog.density = 0.42 / dist;
    // Shift the projection so the world origin lands at (fx, fy) of the screen.
    camera.setViewOffset(w, h, (0.5 - fx) * w, (0.5 - fy) * h, w, h);
    camera.updateProjectionMatrix();

    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    if (bloomHalf) bloom.setSize((w * pixelRatio) / 2, (h * pixelRatio) / 2);
    dust.material.uniforms.uPx.value = pixelRatio * Math.min(1, h / 900) * 1.6 + 0.6;
  }
  let baseCamZ = 14;

  // ── orbiting sources ────────────────────────────────────────────────────
  const orbitPlane = new THREE.Euler(0.3, 0, -0.16);
  const orbiters = items.map((item, i) => {
    const n = items.length;
    const glyph = makeGlyph(item.shape, item.color);
    scene.add(glyph);

    const radius = 3.5 + (i % 3) * 0.42;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      orbitPlane.x + ((i % 3) - 1) * 0.09, orbitPlane.y, orbitPlane.z,
    ));
    const beam = makeBeam(item.color, i);
    scene.add(beam.line);

    return {
      glyph, beam, tilt, radius,
      phase: (i / n) * Math.PI * 2 + 0.4,
      size: item.size || 1,
      delay: i * (0.9 / Math.max(1, n)),
      gain: 1,
      hover: 0,
      scale: 0.0001,
      world: new THREE.Vector3(),
    };
  });

  // Travelling photons along the beams (3 per beam).
  const PHOTONS_PER = 3;
  const photonGeo = new THREE.BufferGeometry();
  const photonPos = new Float32Array(orbiters.length * PHOTONS_PER * 3);
  const photonCol = new Float32Array(orbiters.length * PHOTONS_PER * 3);
  orbiters.forEach((o, i) => {
    const c = new THREE.Color(items[i].color);
    for (let k = 0; k < PHOTONS_PER; k++) c.toArray(photonCol, (i * PHOTONS_PER + k) * 3);
  });
  photonGeo.setAttribute('position', new THREE.BufferAttribute(photonPos, 3).setUsage(THREE.DynamicDrawUsage));
  photonGeo.setAttribute('color', new THREE.BufferAttribute(photonCol, 3));
  const photons = new THREE.Points(photonGeo, new THREE.PointsMaterial({
    size: 0.22, map: glowTex, vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  photons.frustumCulled = false;
  scene.add(photons);

  // ── spectrum fan + outputs ──────────────────────────────────────────────
  const fanGroup = new THREE.Group();
  fanGroup.position.copy(EXIT);
  scene.add(fanGroup);

  const SPREAD = 0.075;
  const BASE_ANGLE = -0.1;
  const bands = SPECTRUM.map((hex, k) => {
    const mat = makeBandMaterial(hex);
    const mesh = new THREE.Mesh(makeBandGeometry(FAN_LENGTH, SPREAD), mat);
    mesh.rotation.z = BASE_ANGLE + (2.5 - k) * SPREAD;
    mesh.renderOrder = 2;
    fanGroup.add(mesh);
    return mesh;
  });

  const outputGlyphs = outputs.map((o, k) => {
    // Stacked top→bottom where the warm / green / cool parts of the fan land.
    // The holder carries layout scale; the glyph animates its own scale.
    const holder = new THREE.Group();
    holder.position.set(
      Math.cos(BASE_ANGLE) * OUTPUT_DIST,
      Math.sin(BASE_ANGLE) * OUTPUT_DIST + (1 - k) * OUTPUT_GAP,
      0.4,
    );
    holder.add(makeOutput(o.key, o.color));
    fanGroup.add(holder);
    return holder;
  });

  // ── dust ────────────────────────────────────────────────────────────────
  const dust = makeDust(tier === 'high' ? 1100 : 420);
  scene.add(dust);

  // ── interaction state ───────────────────────────────────────────────────
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let highlight = -1;

  function onPointerMove(e) {
    if (reducedMotion) return;
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function onContextLost(e) {
    e.preventDefault();
    stop();
    onLost();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);

  // ── clocks ──────────────────────────────────────────────────────────────
  let t = reducedMotion ? T.end : 0;          // intro clock (wall time, so slow GPUs don't drag it out)
  let time = 0;                                // ambient clock (dust, bobbing)
  let orbitAngle = 0;                          // advances only while nothing is hovered
  let orbitSpeed = 0.07;
  const introSpeed = returning ? 3.4 : 1;
  let revealed = false;
  let raf = 0;
  let last = 0;
  let running = false;

  // Frame-time guard: if frames are slow, shed resolution, then bloom quality,
  // then bloom, and finally hand over to the static fallback.
  const perf = { samples: [], stage: 0, warm: 0, strikes: 0 };

  const tmpV = new THREE.Vector3();
  const projected = {
    items: orbiters.map(() => ({ x: 0, y: 0, visible: false, front: true })),
    outputs: outputGlyphs.map(() => ({ x: 0, y: 0, visible: false })),
  };

  function update(dt) {
    const pPrism = ramp(t, T.prism);
    const pBeams = ramp(t, T.beams);
    const pCore = ramp(t, T.core);
    const pFan = ramp(t, T.fan);
    const settled = clamp01((t - T.end + 0.5) / 0.5);

    pointer.x = damp(pointer.x, pointer.tx, 3, dt);
    pointer.y = damp(pointer.y, pointer.ty, 3, dt);

    // Camera: slow breathing dolly + pointer parallax.
    const drift = reducedMotion ? 0 : Math.sin(time * 0.15) * 0.25;
    camera.position.x = pointer.x * 0.7;
    camera.position.y = 0.35 - pointer.y * 0.45;
    camera.position.z = baseCamZ + drift + (1 - pPrism) * 2.2;
    camera.lookAt(0, 0, 0);

    // Prism.
    glass.opacity = pPrism;
    prismEdges.material.opacity = 0.15 + pPrism * 0.35 + pCore * 0.25;
    rimShell.material.uniforms.uOpacity.value = pPrism;
    prism.scale.setScalar(0.85 + 0.15 * pPrism);
    prism.rotation.y = Math.sin(time * 0.22) * 0.32 + pointer.x * 0.18;
    prism.rotation.x = Math.sin(time * 0.17 + 1) * 0.08 - pointer.y * 0.1;
    prism.position.y = Math.sin(time * 0.5) * 0.06;
    core.material.opacity = pCore * (0.75 + Math.sin(time * 1.3) * 0.08);
    core.scale.setScalar(1.1 + pCore * 0.9);
    coreLight.intensity = pCore * 14;
    halo.material.opacity = 0.08 * pPrism + 0.22 * pCore;

    // Orbiters + beams.
    // Orbits ease to a stop while a label is hovered/focused so it's easy to hit.
    const anyHover = highlight >= 0;
    orbitSpeed = damp(orbitSpeed, anyHover ? 0 : 0.07, 5, dt);
    if (!reducedMotion) orbitAngle += orbitSpeed * dt;
    orbiters.forEach((o, i) => {
      const arrive = ease(clamp01((t - T.arrive[0] - o.delay) / (T.arrive[1] - T.arrive[0] - 0.4)));
      const a = o.phase + orbitAngle;
      const r = o.radius * orbitScale * (1 + (1 - arrive) * 1.6);
      tmpV.set(Math.cos(a) * r, Math.sin(time * 0.6 + i) * 0.08, Math.sin(a) * r).applyQuaternion(o.tilt);
      o.world.copy(tmpV);
      o.glyph.position.copy(tmpV);

      o.hover = damp(o.hover, highlight === i ? 1 : 0, 8, dt);
      const s = (0.5 + 0.4 * arrive) * o.size * orbitScale * (1 + o.hover * 0.35);
      o.scale = Math.max(0.0001, s * arrive);
      o.glyph.scale.setScalar(o.scale);
      o.glyph.rotation.y += dt * (0.35 + i * 0.01) * (0.3 + 0.7 * (orbitSpeed / 0.07));
      o.glyph.rotation.x = Math.sin(time * 0.3 + i) * 0.35;
      for (const m of o.glyph.userData.materials) m.opacity = arrive * m.userData.base;

      const beamDraw = clamp01((t - T.beams[0] - o.delay * 0.6) / (T.beams[1] - T.beams[0] - 0.5));
      o.gain = damp(o.gain, anyHover ? (highlight === i ? 2.4 : 0.35) : 1, 6, dt);
      updateBeam(o.beam, o.world, ease(beamDraw), time, o.gain * (1 - 0.35 * settled));

      // Photons ride the beam once it's drawn.
      for (let k = 0; k < PHOTONS_PER; k++) {
        const u = (time * (0.32 - 0.14 * settled) + k / PHOTONS_PER + i * 0.137) % 1;
        const show = beamDraw >= 1 ? 1 : 0;
        bezier(o.world, u, tmpV);
        tmpV.multiplyScalar(show || 1e-4).toArray(photonPos, (i * PHOTONS_PER + k) * 3);
      }
    });
    photonGeo.attributes.position.needsUpdate = true;
    photons.material.opacity = pBeams * (0.9 - 0.4 * settled);

    // Spectrum.
    fanGroup.rotation.z = -pointer.y * 0.05;
    bands.forEach((b, k) => {
      b.material.uniforms.uReveal.value = clamp01((pFan * 1.15) - k * 0.025);
      b.material.uniforms.uTime.value = time;
    });
    outputGlyphs.forEach((holder, k) => {
      const p = ease(clamp01((t - T.outputs[0] - k * 0.25) / (T.outputs[1] - T.outputs[0] - 0.5)));
      holder.children[0].userData.reveal(p, time);
      holder.scale.setScalar(outputScale);
      holder.rotation.z = -fanGroup.rotation.z;
    });

    dust.material.uniforms.uTime.value = time;
    dust.material.uniforms.uOpacity.value = 0.25 + 0.75 * ramp(t, [0, 1.2]);
  }

  function project() {
    const w = view.w, h = view.h;
    // Anchors sit just below each glyph in world units, so captions track
    // the glyph's size on every screen.
    orbiters.forEach((o, i) => {
      const p = projected.items[i];
      const v = tmpV.copy(o.world);
      v.y -= 0.42 * o.scale;
      v.project(camera);
      p.x = (v.x * 0.5 + 0.5) * w;
      p.y = (-v.y * 0.5 + 0.5) * h;
      p.visible = t > T.arrive[0] + o.delay + 0.9;
      p.front = o.world.z > -0.6;
    });
    outputGlyphs.forEach((g, k) => {
      const p = projected.outputs[k];
      g.getWorldPosition(tmpV);
      tmpV.y -= 0.7 * fanGroup.scale.y * outputScale;
      tmpV.project(camera);
      p.x = (tmpV.x * 0.5 + 0.5) * w;
      p.y = (-tmpV.y * 0.5 + 0.5) * h;
      p.visible = t > T.outputs[0] + k * 0.25 + 0.6;
    });
    onProject(projected);
  }

  function render() {
    if (useBloom) composer.render();
    else renderer.render(scene, camera);
  }

  function frame(now) {
    if (!running) return;
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    const dt = Math.min(0.05, raw);                 // smooth motion
    time += dt;
    t = Math.min(T.end, t + Math.min(0.25, raw) * introSpeed);
    update(dt);
    render();
    project();
    if (!revealed && t >= T.reveal) { revealed = true; onReveal(); }
    if (!running) return;                           // watchPerf may hand over to the fallback
    watchPerf(raw);
    raf = requestAnimationFrame(frame);
  }

  // Uses the median frame time of a window, and ignores pauses (hidden tab,
  // screenshots, GC) so one long frame can't trigger a downgrade.
  function watchPerf(raw) {
    if (perf.stage >= 3) return;
    if (perf.warm < 20) { perf.warm++; return; }    // ignore shader-compile hitches
    if (raw > 0.25) return;
    perf.samples.push(raw);
    if (perf.samples.length < 45) return;
    const sorted = perf.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    perf.samples = [];
    if (median < 1 / 30) { perf.stage = 3; return; }  // healthy — stop checking
    if (perf.stage === 0 && pixelRatio > 1) {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      layout();
      perf.stage = 1;
    } else if (perf.stage <= 1 && !bloomHalf) {
      bloomHalf = true;
      layout();
      perf.stage = 1;
    } else if (perf.stage <= 1 && useBloom) {
      useBloom = false;
      perf.stage = 2;
    } else if (median > 1 / 15 && ++perf.strikes >= 2) {
      // Still under ~15fps with everything shed: a still image is kinder.
      stop();
      onLost();
      perf.stage = 3;
    } else if (median <= 1 / 15) {
      perf.stage = 3;
    }
  }

  // Render a single still frame (reduced motion) — re-run on resize/hover.
  function renderStill() {
    update(1 / 60);
    render();
    project();
  }

  function start() {
    if (reducedMotion) {
      // Freeze at the composed final frame.
      time = 6;
      renderStill();
      revealed = true;
      onReveal();
      return;
    }
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  const onResize = () => {
    layout();
    if (reducedMotion) renderStill();
  };
  window.addEventListener('resize', onResize);
  wideQuery?.addEventListener?.('change', onResize);

  layout();
  start();

  return {
    skip() {
      if (t < T.end) t = T.end - 0.001;
    },
    setHighlight(i) {
      highlight = i;
      if (reducedMotion) {
        orbiters.forEach((o, k) => {
          o.hover = k === i ? 1 : 0;
          o.gain = i < 0 ? 1 : (k === i ? 2.4 : 0.35);
        });
        renderStill();
      }
    },
    dispose() {
      stop();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      wideQuery?.removeEventListener?.('change', onResize);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      scene.traverse(obj => {
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m?.dispose());
      });
      glowTex.dispose();
      envRT.dispose();
      pmrem.dispose();
      composer.dispose?.();
      renderer.dispose();
    },
  };
}

// ── builders ──────────────────────────────────────────────────────────────

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lineMaterial(color, opacity = 1) {
  return new THREE.LineBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function gridLines(w, h, nx, ny, z, mat, border = false) {
  const pts = [];
  const x0 = -w / 2, y0 = -h / 2;
  for (let i = border ? 0 : 1; i <= (border ? nx : nx - 1); i++) {
    const x = x0 + (i * w) / nx;
    pts.push(x, y0, z, x, y0 + h, z);
  }
  for (let j = border ? 0 : 1; j <= (border ? ny : ny - 1); j++) {
    const y = y0 + (j * h) / ny;
    pts.push(x0, y, z, x0 + w, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, mat);
}

function polyline(points, mat, closed = false) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z = 0]) => new THREE.Vector3(x, y, z)));
  return closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
}

// Small glyph per source kind. Solid emissive body + additive edge lines.
function makeGlyph(shape, color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  // Bodies stay translucent and dim; the edge lines carry the colour, so
  // large clusters of one kind don't bloom into a blob.
  const solid = new THREE.MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.18), emissive: c, emissiveIntensity: 0.22,
    roughness: 0.35, metalness: 0.25, transparent: true, depthWrite: false,
  });
  solid.userData.base = 0.45;
  const line = lineMaterial(c);
  line.userData.base = 0.9;
  const add = (geo, { edges = true, fill = true } = {}) => {
    if (fill) g.add(new THREE.Mesh(geo, solid));
    if (edges) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), line));
  };

  switch (shape) {
    case 'rows':
      for (const y of [-0.17, 0, 0.17]) add(new THREE.BoxGeometry(0.62, 0.1, 0.42).translate(0, y, 0));
      break;
    case 'grid':
      add(new THREE.BoxGeometry(0.46, 0.46, 0.46));
      g.add(gridLines(0.46, 0.46, 3, 3, 0.232, line));
      break;
    case 'sheet':
      add(new THREE.BoxGeometry(0.44, 0.58, 0.03));
      g.add(gridLines(0.44, 0.58, 3, 4, 0.017, line));
      break;
    case 'nest':
      add(new THREE.IcosahedronGeometry(0.33, 0), { fill: false });
      add(new THREE.OctahedronGeometry(0.15, 0));
      break;
    case 'ring':
      add(new THREE.TorusGeometry(0.19, 0.05, 10, 36).translate(-0.11, 0, 0), { edges: false });
      add(new THREE.TorusGeometry(0.19, 0.05, 10, 36).rotateX(Math.PI / 2).translate(0.11, 0, 0), { edges: false });
      break;
    case 'db':
      for (const y of [-0.17, 0, 0.17]) add(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 28).translate(0, y, 0));
      break;
    case 'frame':
      add(new THREE.TorusGeometry(0.34, 0.035, 4, 4).rotateZ(Math.PI / 4), { edges: false });
      g.add(polyline([[-0.2, -0.15], [-0.06, 0.03], [0.03, -0.06], [0.2, 0.1]], line));
      add(new THREE.SphereGeometry(0.05, 12, 8).translate(0.1, 0.13, 0), { edges: false });
      break;
    default:
      add(new THREE.BoxGeometry(0.4, 0.4, 0.4));
  }
  g.userData.materials = [solid, line];
  return g;
}

// A converging thread of light: a quadratic curve from the source into the
// prism, coloured at the source and whitening as it reaches the core.
const BEAM_SEGMENTS = 40;
const BEAM_END = new THREE.Vector3(0, 0, 0);
const _ctrl = new THREE.Vector3();

function bezier(from, u, out) {
  _ctrl.copy(from).multiplyScalar(0.45);
  _ctrl.z += 0.9;
  _ctrl.y += 0.35;
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return out.set(
    a * from.x + b * _ctrl.x + c * BEAM_END.x,
    a * from.y + b * _ctrl.y + c * BEAM_END.y,
    a * from.z + b * _ctrl.z + c * BEAM_END.z,
  );
}

function makeBeam(color, seed) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((BEAM_SEGMENTS + 1) * 3);
  const tAttr = new Float32Array(BEAM_SEGMENTS + 1);
  for (let i = 0; i <= BEAM_SEGMENTS; i++) tAttr[i] = i / BEAM_SEGMENTS;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uDraw: { value: 0 },
      uTime: { value: 0 },
      uGain: { value: 1 },
      uSeed: { value: seed * 0.173 },
    },
    vertexShader: /* glsl */`
      attribute float aT;
      varying float vT;
      void main() {
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uDraw, uTime, uGain, uSeed;
      varying float vT;
      void main() {
        if (vT > uDraw) discard;
        float head = smoothstep(uDraw - 0.18, uDraw, vT) * (1.0 - step(0.999, uDraw));
        float p = fract(vT - uTime * 0.22 + uSeed);
        float pulse = pow(smoothstep(0.7, 1.0, p), 2.0);
        float ends = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.92, 1.0, vT) * 0.6);
        float a = (0.3 + 0.6 * pulse + 1.3 * head) * ends * uGain;
        vec3 col = mix(uColor, vec3(1.0), smoothstep(0.55, 1.0, vT) * 0.7);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  return { line, pos, geo, mat };
}

const _bp = new THREE.Vector3();
function updateBeam(beam, from, draw, time, gain) {
  for (let i = 0; i <= BEAM_SEGMENTS; i++) {
    bezier(from, (i / BEAM_SEGMENTS) * 0.97, _bp).toArray(beam.pos, i * 3);
  }
  beam.geo.attributes.position.needsUpdate = true;
  beam.mat.uniforms.uDraw.value = draw;
  beam.mat.uniforms.uTime.value = time;
  beam.mat.uniforms.uGain.value = gain;
}

// One band of the spectrum: a thin wedge widening away from the prism.
function makeBandGeometry(length, spread) {
  const half = Math.tan(spread / 2) * length * 1.08;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -0.015, 0, length, -half, 0, length, half, 0,
    0, -0.015, 0, length, half, 0, 0, 0.015, 0,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ], 2));
  return geo;
}

function makeBandMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uReveal: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uReveal, uTime;
      varying vec2 vUv;
      void main() {
        float u = vUv.x;
        float mask = 1.0 - smoothstep(uReveal - 0.06, uReveal, u);
        float across = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
        float falloff = pow(1.0 - u, 1.35);
        float shimmer = 0.9 + 0.1 * sin(u * 30.0 - uTime * 1.5);
        float a = mask * falloff * mix(0.5, 1.0, across) * shimmer * 0.62;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// The three result views, drawn as luminous line art.
function makeOutput(kind, color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const line = lineMaterial(c, 0);
  const fill = new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mats = [line, fill];

  if (kind === 'chart') {
    const heights = [0.42, 0.78, 0.56, 1.0];
    const bars = heights.map((h, i) => {
      const bar = new THREE.Group();
      const geo = new THREE.BoxGeometry(0.16, h, 0.16).translate(0, h / 2, 0);
      bar.add(new THREE.Mesh(geo, fill));
      bar.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), line));
      bar.position.set(-0.36 + i * 0.24, -0.5, 0);
      g.add(bar);
      return bar;
    });
    g.add(polyline([[-0.52, -0.5], [0.52, -0.5]], line));
    g.userData.reveal = (p) => {
      mats.forEach(m => { m.opacity = m === fill ? p * 0.28 : p; });
      bars.forEach((b, i) => { b.scale.y = Math.max(0.0001, ease(clamp01(p * 1.4 - i * 0.12))); });
    };
  } else if (kind === 'table') {
    g.add(gridLines(1.2, 0.84, 3, 4, 0, line, true));
    const header = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.21), fill);
    header.position.y = 0.315;
    g.add(header);
    g.userData.reveal = (p) => {
      line.opacity = p;
      fill.opacity = p * 0.3;
      g.scale.set(1, 0.6 + 0.4 * p, 1);
    };
  } else {
    // map → a small wireframe globe with a few lit points.
    const globe = new THREE.Group();
    const R = 0.46;
    const circle = (r, y) => {
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      }
      return polyline(pts, line, true);
    };
    for (const lat of [-0.6, 0, 0.6]) globe.add(circle(R * Math.cos(lat), R * Math.sin(lat)));
    for (let m = 0; m < 4; m++) {
      const meridian = circle(R, 0);
      meridian.rotation.x = Math.PI / 2;
      meridian.rotation.z = (m / 4) * Math.PI;
      const holder = new THREE.Group();
      holder.add(meridian);
      holder.rotation.y = (m / 4) * Math.PI;
      globe.add(holder);
    }
    const dots = [[0.4, 0.3], [-0.2, 1.4], [0.7, 2.6], [-0.5, 3.6], [0.1, 4.8]].map(([lat, lon]) => new THREE.Vector3(
      R * Math.cos(lat) * Math.cos(lon), R * Math.sin(lat), R * Math.cos(lat) * Math.sin(lon),
    ));
    const dotMat = new THREE.PointsMaterial({
      color: c, size: 0.12, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    mats.push(dotMat);
    globe.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(dots), dotMat));
    globe.rotation.x = 0.35;
    g.add(globe);
    g.userData.reveal = (p, time) => {
      line.opacity = p * 0.8;
      dotMat.opacity = p;
      globe.rotation.y = time * 0.25;
      g.scale.setScalar(0.7 + 0.3 * p);
    };
  }
  g.userData.reveal(0, 0);
  return g;
}

function makeDust(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 16;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * 9;
    pos[i * 3 + 2] = -12 + Math.random() * 16;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1.5 }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uTime, uPx;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.08 + aSeed * 6.283) * 0.4;
        p.x += cos(uTime * 0.06 + aSeed * 12.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (0.5 + aSeed) * (9.0 / -mv.z);
        vA = 0.2 + 0.8 * pow(abs(sin(uTime * 0.4 + aSeed * 40.0)), 3.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uOpacity * 0.55;
        gl_FragColor = vec4(vec3(0.78, 0.84, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
