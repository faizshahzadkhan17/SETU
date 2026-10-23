/*
 * scene.js
 * The 3D world: a floating river-valley diorama, the bridge built from the
 * engine's analysis, vehicles, and the collapse animation.
 * Units are metres. x runs along the bridge, y is up, z is across.
 */
(function (root) {
  'use strict';
  const T = root.THREE;

  const flat = (color, extra) => new T.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0.0 }, extra || {}));
  const COLS = { grass: 0x7fcf6a, grass2: 0x6bbd5b, soil: 0xb98352, soil2: 0x9c6a3f, rock: 0x8e8a86, sand: 0xe6cf98, water: 0x39b5f0, road: 0x5b6270, path: 0xc99a62, concrete: 0xd7d9de };

  function utilColor(u) {
    const stops = [[0, [61, 123, 255]], [0.45, [33, 181, 115]], [0.8, [255, 194, 26]], [1.0, [255, 77, 61]]];
    u = Math.max(0, Math.min(1.2, u));
    for (let i = 1; i < stops.length; i++) {
      if (u <= stops[i][0] || i === stops.length - 1) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        const t = Math.max(0, Math.min(1, (u - a) / (b - a)));
        return new T.Color((ca[0] + (cb[0] - ca[0]) * t) / 255, (ca[1] + (cb[1] - ca[1]) * t) / 255, (ca[2] + (cb[2] - ca[2]) * t) / 255);
      }
    }
    return new T.Color(1, 0.3, 0.24);
  }

  function rnd(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function cylinderBetween(a, b, r, mat) {
    const d = new T.Vector3().subVectors(b, a), len = d.length();
    const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 8, 1), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    return m;
  }

  function World(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new T.Scene();
    this.scene.background = null;
    r.setClearColor(0x000000, 0);
    this.scene.fog = new T.Fog(0xdff1ff, 120, 260);
    this.camera = new T.PerspectiveCamera(40, 1, 0.5, 600);
    this.controls = new T.OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 12; this.controls.maxDistance = 180;
    this.controls.target.set(0, -1, 0);

    this.hemi = new T.HemisphereLight(0xdff2ff, 0x8a7a5a, 0.75);
    this.scene.add(this.hemi);
    const sun = this.sun = new T.DirectionalLight(0xfff1d6, 1.25);
    sun.position.set(-40, 70, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 50; sc.bottom = -50; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.world = new T.Group(); this.scene.add(this.world);
    // night: lamp lights on the banks, lights along the deck, a headlight
    this.night = false; this.nightK = 0;
    this.lampLights = [];
    for (let i = 0; i < 4; i++) { const L = new T.PointLight(0xffb85c, 0, 20, 2); this.scene.add(L); this.lampLights.push(L); }
    this.deckLights = [];
    for (let i = 0; i < 3; i++) { const L = new T.PointLight(0xffd99a, 0, 16, 2); this.scene.add(L); this.deckLights.push(L); }
    this.headLight = new T.PointLight(0xfff4d0, 0, 22, 1.4); this.scene.add(this.headLight);
    // stars and the moon
    const sp = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.42, r = 260;
      sp.set([r * Math.cos(th) * Math.sin(ph), r * Math.cos(ph) * 0.9 + 10, r * Math.sin(th) * Math.sin(ph)], i * 3);
    }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
    this.stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    this.moon = new T.Mesh(new T.SphereGeometry(6, 24, 16), new T.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0, fog: false }));
    this.moon.position.set(-90, 95, -170);
    this.scene.add(this.moon);
    this.glowMats = [];          // lamp heads, windows, bulbs: glow only at night
    this.bridge = new T.Group(); this.scene.add(this.bridge);
    this.vehicle = null;
    this.clouds = new T.Group(); this.scene.add(this.clouds);
    this.makeClouds();
    this.fx = [];
    this.collapseState = null;
    this.clock = new T.Clock();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  World.prototype.resize = function () {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };

  World.prototype.makeClouds = function () {
    const mat = flat(0xffffff, { roughness: 1 });
    const R = rnd(5);
    for (let c = 0; c < 9; c++) {
      const g = new T.Group();
      const n = 3 + Math.floor(R() * 4);
      for (let i = 0; i < n; i++) {
        const s = new T.Mesh(new T.IcosahedronGeometry(2 + R() * 2.5, 0), mat);
        s.position.set(i * 2.6 - n * 1.3, R() * 1.5, (R() - 0.5) * 2.5);
        g.add(s);
      }
      g.position.set((R() - 0.5) * 200, 32 + R() * 18, -60 - R() * 70);
      g.userData.v = 0.6 + R() * 0.8;
      this.clouds.add(g);
    }
  };

  // ------------------------------------------------------------------
  // The valley
  // ------------------------------------------------------------------
  World.prototype.setSite = function (span, loadKey, matKey) {
    this.span = span; this.loadKey = loadKey; this.matKey = matKey;
    const W = { people: 2.5, car: 4.5, truck: 6 }[loadKey];
    this.deckW = W;
    while (this.world.children.length) this.world.remove(this.world.children[0]);
    const g = this.world;
    const bank = 26, depth = 34, L = span + bank * 2;
    const half = span / 2;
    const box = (w, h, d, col, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), flat(col)); m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = false; g.add(m); return m; };
    for (const s of [-1, 1]) {
      const cx = s * (half + bank / 2);
      box(bank, 1, depth, COLS.grass, cx, -0.5, 0);
      box(bank, 4, depth, COLS.soil, cx, -3, 0);
      box(bank, 3, depth, COLS.soil2, cx, -6.5, 0);
      box(bank, 2, depth, COLS.rock, cx, -9, 0);
      // grassy lip overhang
      box(bank + 0.6, 0.5, depth + 0.6, COLS.grass2, cx, -0.2, 0);
    }
    // river bed + water
    box(span + 0.2, 1.5, depth, COLS.sand, 0, -7.25, 0);
    box(span + 0.2, 2, depth, COLS.rock, 0, -9, 0);
    const wg = new T.PlaneGeometry(span + 0.4, depth, Math.max(10, Math.round(span)), 20);
    wg.rotateX(-Math.PI / 2);
    const water = new T.Mesh(wg, new T.MeshStandardMaterial({ color: COLS.water, transparent: true, opacity: 0.88, roughness: 0.25, metalness: 0.1, flatShading: true }));
    water.position.y = -3.8; water.receiveShadow = true;
    g.add(water);
    this.water = water; this.waterBase = wg.attributes.position.array.slice();
    // river side faces of the diorama (cut-away look)
    for (const z of [-1, 1]) {
      const side = new T.Mesh(new T.PlaneGeometry(span + 0.2, 2.3), new T.MeshStandardMaterial({ color: 0x1f8fd0, transparent: true, opacity: 0.75 }));
      side.position.set(0, -5.1, z * depth / 2); if (z < 0) side.rotation.y = Math.PI;
      g.add(side);
    }
    // road / path on both banks
    const road = loadKey === 'people' ? COLS.path : COLS.road;
    for (const s of [-1, 1]) {
      box(bank, 0.12, W, road, s * (half + bank / 2), 0.06, 0);
      if (loadKey !== 'people') for (let x = 2; x < bank - 1; x += 4) box(1.8, 0.14, 0.18, 0xffe066, s * (half + x), 0.07, 0);
      // abutment
      box(2.2, 4.5, W + 2, COLS.concrete, s * (half + 0.6), -2.1, 0);
    }
    // rocks along the water
    const R = rnd(span * 7 + 3);
    const rockMat = flat(0x9a948c);
    for (let i = 0; i < 26; i++) {
      const m = new T.Mesh(new T.DodecahedronGeometry(0.5 + R() * 1.1, 0), rockMat);
      const s = R() < 0.5 ? -1 : 1;
      m.position.set(s * (half - 0.4 - R() * 2), -4 + R() * 0.8, (R() - 0.5) * depth * 0.9);
      m.rotation.set(R() * 3, R() * 3, R() * 3); m.castShadow = true;
      g.add(m);
    }
    // trees, bamboo, a hut
    const trunk = flat(0x8b5a33), leaf = [flat(0x4caf50), flat(0x3d9a48), flat(0x5fbf4f), flat(0x7ccf4a)];
    for (let i = 0; i < 34; i++) {
      const s = R() < 0.5 ? -1 : 1, x = s * (half + 3 + R() * (bank - 5)), z = (R() - 0.5) * (depth - 3);
      if (Math.abs(z) < W / 2 + 2.5) continue;
      const t = new T.Group();
      const h = 2 + R() * 2.5;
      const tr = new T.Mesh(new T.CylinderGeometry(0.18, 0.28, h, 6), trunk); tr.position.y = h / 2; tr.castShadow = true; t.add(tr);
      if (R() < 0.5) {
        const c = new T.Mesh(new T.ConeGeometry(1.4 + R(), 3 + R() * 2, 7), leaf[Math.floor(R() * 4)]); c.position.y = h + 1.2; c.castShadow = true; t.add(c);
      } else {
        const c = new T.Mesh(new T.IcosahedronGeometry(1.5 + R() * 0.8, 0), leaf[Math.floor(R() * 4)]); c.position.y = h + 0.9; c.castShadow = true; t.add(c);
      }
      t.position.set(x, 0, z);
      g.add(t);
    }
    const bambooMat = flat(0x9cc947);
    for (let k = 0; k < 3; k++) {
      const cx = -(half + 6 + k * 5), cz = 9 + k * 2.5;
      for (let i = 0; i < 9; i++) {
        const h = 6 + R() * 4;
        const b = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, h, 5), bambooMat);
        b.position.set(cx + (R() - 0.5) * 1.6, h / 2, cz + (R() - 0.5) * 1.6);
        b.rotation.z = (R() - 0.5) * 0.15; b.castShadow = true;
        g.add(b);
      }
    }
    const hut = new T.Group();
    const wall = new T.Mesh(new T.BoxGeometry(4, 2.6, 3.4), flat(0xf3e2c3)); wall.position.y = 1.3; wall.castShadow = true; hut.add(wall);
    const roof = new T.Mesh(new T.ConeGeometry(3.4, 2, 4), flat(0xd8573b)); roof.position.y = 3.6; roof.rotation.y = Math.PI / 4; roof.castShadow = true; hut.add(roof);
    const door = new T.Mesh(new T.BoxGeometry(0.9, 1.6, 0.05), flat(0x7a4b2a)); door.position.set(0, 0.8, 1.72); hut.add(door);
    const winMat = new T.MeshStandardMaterial({ color: 0x3a3020, emissive: 0xffb84d, emissiveIntensity: 0 });
    this.glowMats.push(winMat);
    for (const z of [-0.9, 0.9]) { const wdw = new T.Mesh(new T.BoxGeometry(0.06, 0.7, 0.6), winMat); wdw.position.set(2.02, 1.5, z); hut.add(wdw); }
    hut.position.set(half + 10, 0, -9); hut.rotation.y = -0.4;
    g.add(hut);
    // street lamps at the four corners of the bridge
    this.glowMats = this.glowMats.filter((m) => m === winMat);
    const lampHead = new T.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc56b, emissiveIntensity: 0 });
    this.glowMats.push(lampHead);
    const poleMat = flat(0x3b4352, { roughness: 0.6 });
    let li = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lamp = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(0.09, 0.12, 5, 6), poleMat); pole.position.y = 2.5; pole.castShadow = true; lamp.add(pole);
      const arm = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 1.1), poleMat); arm.position.set(0, 4.95, -sz * 0.5); lamp.add(arm);
      const head = new T.Mesh(new T.CylinderGeometry(0.28, 0.16, 0.3, 8), lampHead); head.position.set(0, 4.85, -sz * 1.0); lamp.add(head);
      lamp.position.set(sx * (half + 2.2), 0, sz * (W / 2 + 0.9));
      g.add(lamp);
      this.lampLights[li++].position.set(sx * (half + 2.2), 4.6, sz * (W / 2 - 0.1));
    }
    // camera framing
    const d = Math.max(36, span * 1.35);
    this.home = new T.Vector3(d * 0.55, d * 0.42 + 4, d * 0.95);
    if (!this.placed) { this.camera.position.copy(this.home); this.placed = true; }
  };

  World.prototype.flyHome = function () { this.tween = { from: this.camera.position.clone(), to: this.home.clone(), t: 0 }; };
  World.prototype.flyTo = function (pos, target) { this.tween = { from: this.camera.position.clone(), to: pos.clone(), t: 0, target }; };

  // ------------------------------------------------------------------
  // The bridge
  // ------------------------------------------------------------------
  // view = { xy, members:[{a,b,D}], util:[..], disp, map, mat, exag }
  World.prototype.setBridge = function (view) {
    if (this.collapseState) return;
    const g = this.bridge;
    while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); }
    this.view = view;
    if (!view) return;
    const half = this.span / 2, W = this.deckW;
    const pos = (i) => {
      let x = view.xy[i * 2], y = view.xy[i * 2 + 1];
      if (view.disp && view.map && view.map[i] >= 0) { x += (view.disp[view.map[i]] / 1000) * view.exag; y += (view.disp[view.map[i] + 1] / 1000) * view.exag; }
      return [x - half, y + 0.35];
    };
    const matKey = this.matKey;
    const jointMat = flat(0x2c3340, { roughness: 0.5, metalness: 0.4 });
    view.members.forEach((m, j) => {
      const [x1, y1] = pos(m.a), [x2, y2] = pos(m.b);
      const r = Math.max(0.05, Math.min(0.32, (m.D / 1000) * (matKey === 'steel' ? 1.3 : 0.9)));
      const col = view.util ? utilColor(view.util[j]) : new T.Color(0x9aa4b5);
      const mat = new T.MeshStandardMaterial({ color: col, roughness: matKey === 'steel' ? 0.35 : 0.8, metalness: matKey === 'steel' ? 0.35 : 0, flatShading: true, emissive: col, emissiveIntensity: view.util && view.util[j] > 1 ? 0.6 : 0.08 + 0.32 * this.nightK });
      for (const z of [-W / 2, W / 2]) {
        const c = cylinderBetween(new T.Vector3(x1, y1, z), new T.Vector3(x2, y2, z), r, mat);
        c.userData.member = j;
        g.add(c);
      }
    });
    // joints, deck, cross beams, top bracing
    const n = view.n;
    const deckMat = flat(matKey === 'steel' ? 0xc9ccd3 : matKey === 'timber' ? 0xb98656 : 0xd8c27a);
    const beamMat = flat(0x3b4352);
    for (let i = 0; i < view.xy.length / 2; i++) {
      if (!view.used[i]) continue;
      const [x, y] = pos(i);
      for (const z of [-W / 2, W / 2]) { const s = new T.Mesh(new T.SphereGeometry(0.22, 8, 6), jointMat); s.position.set(x, y, z); g.add(s); }
      if (i <= n) { const cb = cylinderBetween(new T.Vector3(x, y - 0.05, -W / 2), new T.Vector3(x, y - 0.05, W / 2), 0.12, beamMat); g.add(cb); }
      else if (view.xy[i * 2 + 1] > 3.2) { const cb = cylinderBetween(new T.Vector3(x, y, -W / 2), new T.Vector3(x, y, W / 2), 0.08, beamMat); g.add(cb); }
    }
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pos(i), [x2, y2] = pos(i + 1);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const slab = new T.Mesh(new T.BoxGeometry(len + 0.02, 0.28, W - 0.2), deckMat);
      slab.position.set((x1 + x2) / 2, (y1 + y2) / 2 + 0.05, 0);
      slab.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      slab.castShadow = true; slab.receiveShadow = true;
      g.add(slab);
      if (this.loadKey !== 'people') {
        const mk = new T.Mesh(new T.BoxGeometry(len * 0.45, 0.02, 0.15), flat(0xffe066));
        mk.position.set((x1 + x2) / 2, (y1 + y2) / 2 + 0.2, 0); mk.rotation.z = slab.rotation.z; g.add(mk);
      }
    }
    // string lights along the top chord and the deck edges
    const bulbMat = new T.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: this.nightK, fog: false });
    this.bulbMat = bulbMat;
    view.members.forEach((m) => {
      const top = m.a > n || m.b > n;
      if (!top) return;
      const [x1, y1] = pos(m.a), [x2, y2] = pos(m.b);
      if (!(m.a > n && m.b > n) && Math.abs(y2 - y1) < 0.5) return;
      const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 1.2));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        if (!(m.a > n && m.b > n) && t > 0) continue;  // only joints of non-top members
        for (const z of [-W / 2, W / 2]) {
          const b = new T.Mesh(new T.SphereGeometry(0.15, 6, 4), bulbMat);
          b.position.set(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + 0.22, z);
          g.add(b);
        }
      }
    });
    for (let i = 0; i <= n; i++) {
      const [x, y] = pos(i);
      for (const z of [-W / 2 - 0.15, W / 2 + 0.15]) { const b = new T.Mesh(new T.SphereGeometry(0.17, 6, 4), bulbMat); b.position.set(x, y + 0.25, z); g.add(b); }
    }
    this.deckLights.forEach((L, k) => { const [x, y] = pos(Math.round(((k + 1) / 4) * n)); L.position.set(x, y + 2.5, 0); });
    this.deckY = (x) => {          // deck height at bridge coordinate x (0..span)
      const f = Math.max(0, Math.min(n - 0.0001, (x / this.span) * n)), i = Math.floor(f), t = f - i;
      return pos(i)[1] * (1 - t) + pos(i + 1)[1] * t + 0.2;
    };
  };

  // ------------------------------------------------------------------
  // Vehicles
  // ------------------------------------------------------------------
  function truckModel() {
    const g = new T.Group();
    const body = flat(0xffc21a), cargo = flat(0x2f6bff), dark = flat(0x22262e), glass = flat(0x9fd7ff, { roughness: 0.2 });
    const cab = new T.Mesh(new T.BoxGeometry(2.2, 2.4, 2.4), body); cab.position.set(-1.1, 1.7, 0); g.add(cab);
    const win = new T.Mesh(new T.BoxGeometry(0.05, 0.9, 2.0), glass); win.position.set(0.02, 2.2, 0); g.add(win);
    const box = new T.Mesh(new T.BoxGeometry(5.6, 2.8, 2.5), cargo); box.position.set(-5.2, 1.9, 0); g.add(box);
    const stripe = new T.Mesh(new T.BoxGeometry(5.62, 0.35, 2.52), flat(0xffffff)); stripe.position.set(-5.2, 1.4, 0); g.add(stripe);
    for (const z of [-0.8, 0.8]) { const hl = new T.Mesh(new T.BoxGeometry(0.08, 0.3, 0.45), new T.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff2c0, emissiveIntensity: 0 })); hl.position.set(0.04, 1.0, z); hl.userData.headlight = true; g.add(hl); }
    for (const x of [-0.9, -4.4, -5.7]) for (const z of [-1.1, 1.1]) {
      const w = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.4, 12), dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function autoModel() {
    const g = new T.Group();
    const green = flat(0x2bb35a), yellow = flat(0xffd23f), dark = flat(0x22262e);
    const body = new T.Mesh(new T.BoxGeometry(2.6, 1.0, 1.4), green); body.position.set(-1.3, 0.85, 0); g.add(body);
    const hood = new T.Mesh(new T.BoxGeometry(2.4, 0.15, 1.5), yellow); hood.position.set(-1.4, 2.15, 0); g.add(hood);
    for (const z of [-0.65, 0.65]) { const p = new T.Mesh(new T.BoxGeometry(0.1, 1.1, 0.1), dark); p.position.set(-0.4, 1.6, z); g.add(p); const q = p.clone(); q.position.x = -2.5; g.add(q); }
    const hl = new T.Mesh(new T.SphereGeometry(0.16, 8, 6), new T.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff2c0, emissiveIntensity: 0 })); hl.position.set(0.02, 1.1, 0); hl.userData.headlight = true; g.add(hl);
    for (const [x, z] of [[-0.1, 0], [-2.4, -0.6], [-2.4, 0.6]]) { const w = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.25, 10), dark); w.rotation.x = Math.PI / 2; w.position.set(x, 0.35, z); g.add(w); }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function crowdModel(R) {
    const g = new T.Group();
    const cols = [0xff6b6b, 0x4d96ff, 0xffd93d, 0x6bcb77, 0xb15eff, 0xff9a3c];
    for (let i = 0; i < 26; i++) {
      const p = new T.Group();
      const b = new T.Mesh(new T.CylinderGeometry(0.22, 0.26, 1.1, 6), flat(cols[i % cols.length])); b.position.y = 0.75; p.add(b);
      const h = new T.Mesh(new T.SphereGeometry(0.2, 8, 6), flat(0x8d5a3b)); h.position.y = 1.5; p.add(h);
      p.position.set(-R() * 30, 0, (R() - 0.5) * 1.8);
      p.userData.phase = R() * 6;
      p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(p);
    }
    return g;
  }

  World.prototype.setVehicle = function (type) {
    if (this.vehicle) this.scene.remove(this.vehicle);
    this.vehicle = type === 'truck' ? truckModel() : type === 'car' ? autoModel() : crowdModel(rnd(4));
    this.vehicle.userData.type = type;
    this.vehicle.visible = false;
    this.vehicle.traverse((o) => { if (o.userData && o.userData.headlight) this.glowMats.push(o.material); });
    this.scene.add(this.vehicle);
  };
  // x = front position along the bridge (m from the left support)
  World.prototype.placeVehicle = function (x, t) {
    const v = this.vehicle;
    if (!v || this.collapseState) return;
    v.visible = true;
    const half = this.span / 2;
    if (v.userData.type === 'people') {
      v.position.set(x - half, 0, 0);
      v.children.forEach((p) => {
        const px = x + p.position.x;
        p.position.y = px > 0 && px < this.span && this.deckY ? this.deckY(px) - 0.1 : 0.12;
        p.visible = px > -24;
        p.rotation.z = Math.sin(t * 6 + p.userData.phase) * 0.08;
      });
    } else {
      const y = x > 0 && x < this.span && this.deckY ? this.deckY(Math.min(this.span, Math.max(0, x - 1))) : 0.12;
      v.position.set(x - half, y, v.userData.type === 'truck' ? -this.deckW * 0.18 : -this.deckW * 0.2);
      this.headLight.position.set(v.position.x + 3, y + 1.4, v.position.z);
    }
  };

  // ------------------------------------------------------------------
  // Collapse: the bridge folds at the failed member and drops into the river
  // ------------------------------------------------------------------
  World.prototype.collapse = function (failX) {
    if (this.collapseState) return;
    const half = this.span / 2, xf = failX - half;
    const L = new T.Group(), R = new T.Group();
    L.position.set(-half, 0.3, 0); R.position.set(half, 0.3, 0);
    this.scene.add(L); this.scene.add(R);
    const kids = this.bridge.children.slice();
    for (const k of kids) {
      const wp = new T.Vector3(); k.getWorldPosition(wp);
      (wp.x < xf ? L : R).attach(k);
    }
    this.collapseState = { L, R, t: 0, xf, veh: this.vehicle, vy: 0, splashed: false };
  };
  // ------------------------------------------------------------------
  // Day / night
  // ------------------------------------------------------------------
  World.prototype.setNight = function (on, animate) {
    this.night = on;
    if (!animate) { this.nightK = on ? 1 : 0; this.applyNight(); }
  };
  World.prototype.applyNight = function () {
    const k = this.nightK, mix = (a, b) => a + (b - a) * k;
    const lerpC = (a, b) => new T.Color(a).lerp(new T.Color(b), k);
    this.hemi.intensity = mix(0.75, 0.38);
    this.hemi.color.copy(lerpC(0xdff2ff, 0x7f97d8));
    this.hemi.groundColor.copy(lerpC(0x8a7a5a, 0x2a3150));
    this.sun.intensity = mix(1.25, 0.32);
    this.sun.color.copy(lerpC(0xfff1d6, 0xb9ccff));
    this.sun.position.set(mix(-40, -60), mix(70, 80), mix(45, -60));
    this.scene.fog.color.copy(lerpC(0xdff1ff, 0x0d1733));
    this.renderer.toneMappingExposure = mix(1.05, 1.0);
    if (this.water) { this.water.material.color.copy(lerpC(0x39b5f0, 0x1c4f86)); this.water.material.roughness = mix(0.25, 0.5); }
    this.stars.material.opacity = k * 0.9;
    this.moon.material.opacity = k;
    this.lampLights.forEach((L) => { L.intensity = 1.4 * k; });
    this.deckLights.forEach((L) => { L.intensity = 0.8 * k; });
    this.headLight.intensity = this.vehicle && this.vehicle.visible ? 2.5 * k : 0;
    this.glowMats.forEach((m) => { m.emissiveIntensity = 1.6 * k; });
    if (this.bulbMat) this.bulbMat.opacity = k;
    this.clouds.children.forEach((c) => c.children.forEach((p) => { p.material.color.copy(lerpC(0xffffff, 0x4a5880)); }));
  };

  World.prototype.resetCollapse = function () {
    const c = this.collapseState;
    if (!c) return;
    this.scene.remove(c.L); this.scene.remove(c.R);
    this.collapseState = null;
    if (this.vehicle) { this.vehicle.rotation.set(0, 0, 0); this.vehicle.visible = false; }
  };
  World.prototype.splash = function (x, z) {
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const s = new T.Mesh(new T.IcosahedronGeometry(0.25 + Math.random() * 0.35, 0), mat.clone());
      s.position.set(x + (Math.random() - 0.5) * 4, -3.6, z + (Math.random() - 0.5) * 4);
      s.userData.v = new T.Vector3((Math.random() - 0.5) * 8, 6 + Math.random() * 9, (Math.random() - 0.5) * 8);
      this.scene.add(s);
      this.fx.push({ m: s, t: 0 });
    }
  };

  World.prototype.render = function () {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    // water ripples
    if (this.water) {
      const p = this.water.geometry.attributes.position, a = p.array, b = this.waterBase;
      for (let i = 0; i < a.length; i += 3) a[i + 1] = b[i + 1] + Math.sin(b[i] * 0.6 + t * 1.6) * 0.12 + Math.cos(b[i + 2] * 0.5 + t * 1.2) * 0.1;
      p.needsUpdate = true;
      this.water.geometry.computeVertexNormals();
    }
    this.clouds.children.forEach((c) => { c.position.x += c.userData.v * dt; if (c.position.x > 110) c.position.x = -110; });
    const target = this.night ? 1 : 0;
    if (Math.abs(this.nightK - target) > 0.001) { this.nightK += Math.sign(target - this.nightK) * Math.min(Math.abs(target - this.nightK), dt * 1.5); this.applyNight(); }
    else if (this.night) this.headLight.intensity = this.vehicle && this.vehicle.visible ? 2.5 : 0;
    // collapse animation
    const c = this.collapseState;
    if (c) {
      c.t += dt;
      const k = Math.min(1, c.t / 1.6), ang = 0.75 * k * k;
      c.L.rotation.z = -ang; c.R.rotation.z = ang;
      c.L.position.y = 0.3 - 2.5 * k * k; c.R.position.y = 0.3 - 2.5 * k * k;
      const v = c.veh;
      if (v && v.visible && v.userData.type !== 'people') {
        c.vy -= 18 * dt;
        v.position.y = Math.max(-5.2, v.position.y + c.vy * dt);
        v.rotation.z = Math.max(-0.9, v.rotation.z - dt * 0.9 * Math.sign(v.position.x - (c.xf)) * -1);
        if (!c.splashed && v.position.y < -3.4) { c.splashed = true; this.splash(v.position.x, v.position.z); }
      }
      if (v && v.userData.type === 'people' && c.t < 0.1) v.visible = false;
      if (!c.splashedBridge && c.t > 1.4) { c.splashedBridge = true; this.splash(c.xf, 0); }
    }
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      f.m.userData.v.y -= 20 * dt;
      f.m.position.addScaledVector(f.m.userData.v, dt);
      f.m.material.opacity = Math.max(0, 0.9 - f.t * 0.7);
      if (f.t > 1.4) { this.scene.remove(f.m); return false; }
      return true;
    });
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 1.4);
      const e = 1 - Math.pow(1 - tw.t, 3);
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      if (tw.target) this.controls.target.lerp(tw.target, 0.08);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  root.SetuWorld = World;
  root.utilColor = utilColor;
})(window);
