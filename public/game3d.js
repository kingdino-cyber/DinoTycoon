// ── Dino Tycoon — Third-Person 3D Engine (Three.js) ──────────────────────────
(function() {
'use strict';

const WORLD_SIZE = 5600;   // expanded 40% so the bigger volcano doesn't crowd base territories
const PAD_SIZE = 620;
const WU = 1 / 24;          // server units -> three.js units — bigger than before so the world feels larger
const DINO_SCALE = 1.4;     // base scale for all dino models
const REACH = 320;          // server units — matches old click-to-attack reach
const PICKUP_RADIUS = 42;   // server units — "touch" radius for coin pickup
const CAM_DISTANCE_DEFAULT = 4.2;
const CAM_DISTANCE = 4.2;   // three.js units behind the player, rear-view camera
const CAM_BASE_HEIGHT = 2.0;// camera height above ground

const MAP_THEMES = {
  jungle:   { sky:0x6ec6ff, fogNear:45, fogFar:130, ground:0x3cb043, grid:0x2d8a35, ambient:0xcce4ff, sun:0xfff8e0 },
  desert:   { sky:0xe8c16a, fogNear:50, fogFar:150, ground:0xc9a96e, grid:0xa8855a, ambient:0xffe8a0, sun:0xffe060 },
  volcanic: { sky:0x1a0808, fogNear:30, fogFar:100, ground:0x3d1a0a, grid:0x6b2a0a, ambient:0xff6030, sun:0xff4400 },
  arctic:   { sky:0xd0e8f4, fogNear:40, fogFar:120, ground:0xd8edf8, grid:0x90c0d8, ambient:0xd0eeff, sun:0xffffff },
  swamp:    { sky:0x1e2e14, fogNear:25, fogFar: 90, ground:0x2a3e14, grid:0x1a2e0a, ambient:0x88aa60, sun:0xaabb80 },
};

const PADS_DATA = [
  { x:140,  y:140,  hex:0xe84393 },
  { x:4592, y:140,  hex:0x1e90ff },
  { x:140,  y:4592, hex:0x2ed573 },
  { x:4592, y:4592, hex:0xffa502 },
  { x:2366, y:140,  hex:0xa29bfe },
  { x:2366, y:4592, hex:0xfd79a8 },
  { x:140,  y:2366, hex:0x00cec9 },
  { x:4592, y:2366, hex:0xfdcb6e },
];

// ── Volcano ───────────────────────────────────────────────────────────────────
const VOLCANO_CX_SRV = 2800, VOLCANO_CZ_SRV = 2800;
const VOLCANO_BASE_R   = 1107 * WU;   // base radius in Three.js units — 35% bigger footprint
const VOLCANO_PEAK_H   = 52;          // summit height — unchanged, not taller
const VOLCANO_CRATER_R = 8.0;         // giant summit vent — a real hole, not a pinhole
const VOLCANO_CRATER_FLOOR = 38.0;    // deep open crater
const VOLCANO_BASE_R_SRV = 1107;
// ─────────────────────────────────────────────────────────────────────────────

const WALL_TYPES = ['stoneWall', 'fossilFortress'];
const INCOME_UPGRADE_IDS = ['bonePile1', 'bonePile2', 'bonePile3', 'bonePile4', 'bonePile5'];

function sx(serverX) { return serverX * WU; }
function sz(serverY) { return serverY * WU; }
function dirToRotY(theta) { return Math.PI / 2 - theta; }

// Returns the terrain elevation at a Three.js (worldX, worldZ) position due to the volcano.
// This must be the exact inverse of the body mesh's radius profile
// (profileR = crRtop + (bR-crRtop)*(1-t)^1.40, where t is height/pH) — an
// approximate inverse (e.g. a plain pow(1-d/bR, 0.75)) is off by several units
// partway up the slope, which is what read as players floating above / clipping
// through the mountain.
function volcanoHeightAt(worldX, worldZ) {
  const d = Math.hypot(worldX - sx(VOLCANO_CX_SRV), worldZ - sz(VOLCANO_CZ_SRV));
  if (d >= VOLCANO_BASE_R) return 0;
  const crRtop   = VOLCANO_CRATER_R * 0.88; // body mesh's summit radius (t=1)
  const ventTopR = VOLCANO_CRATER_R * 0.90; // crater wall's rim radius (matches buildVolcano)
  const ventBotR = VOLCANO_CRATER_R * 0.36; // crater wall's floor radius
  const outerH = (dist) => {
    const frac = Math.max(0, (dist - crRtop) / (VOLCANO_BASE_R - crRtop));
    const t = 1 - Math.pow(frac, 1 / 1.40); // exact inverse of the body's (1-t)^1.40 profile
    return t * VOLCANO_PEAK_H;
  };
  if (d <= ventBotR) return VOLCANO_CRATER_FLOOR; // flat lava pool floor
  if (d <= ventTopR) {
    // Crater wall is a true linear frustum — interpolate the same way
    const rimH = outerH(ventTopR);
    const ct = (d - ventBotR) / (ventTopR - ventBotR);
    return VOLCANO_CRATER_FLOOR + (rimH - VOLCANO_CRATER_FLOOR) * ct;
  }
  return outerH(d);
}
function hexStr2num(s) { return parseInt(s.replace('#', ''), 16); }

function makeTextSprite(text) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 100;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 62px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 9;
  ctx.strokeText(text, 160, 50);
  ctx.fillStyle = '#ffe433';
  ctx.fillText(text, 160, 50);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(1.4, 0.48, 1);
  return sp;
}

// ── Canvas-texture sprite helpers (nametags / HP bars) ──────────────────────
function makeNameSprite(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 56;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 32px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, 128, 30);
  ctx.fillStyle = color || '#ffffff'; ctx.fillText(text, 128, 30);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.22, 0.05, 1);
  return spr;
}

function makeHPBarSprite() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 18;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.13, 0.018, 1);
  spr.userData.ctx = ctx; spr.userData.tex = tex;
  return spr;
}
function redrawHPSprite(spr, hp, maxHp) {
  const ctx = spr.userData.ctx;
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  ctx.clearRect(0, 0, 128, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 128, 18);
  // Colorblind-friendly palette swaps green/red (hard to tell apart) for blue/orange
  const cb = window.GAME_SETTINGS?.colorblindHpBar;
  ctx.fillStyle = cb
    ? (pct > 0.6 ? '#2196f3' : pct > 0.3 ? '#ffb300' : '#e65100')
    : (pct > 0.6 ? '#44dd44' : pct > 0.3 ? '#ffaa00' : '#ff3333');
  ctx.fillRect(2, 2, (128 - 4) * pct, 14);
  spr.userData.tex.needsUpdate = true;
}

// ── Main engine ───────────────────────────────────────────────────────────
class Game3D {
  constructor(container) {
    this._is3D = true; // guards socket events so they bail when Phaser is active
    this._camMode = 0; // 0=third-person back, 1=first-person, 2=third-person front
    this.scene = new THREE.Scene();
    const skyColor = 0x6ec6ff; // sunny sky blue
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 45, 130);

    this.camera = new THREE.PerspectiveCamera(window.GAME_SETTINGS?.fov ?? 70, window.innerWidth / window.innerHeight, 0.1, 300);
    this.scene.add(this.camera);
    // yawObject/pitchObject are NOT added to the scene — they're just lightweight
    // rotation accumulators for mouse-look (third-person camera is positioned
    // manually behind the player each frame in update(), see below)
    this.yawObject = new THREE.Object3D();
    this.pitchObject = new THREE.Object3D();

    // First-person arms render through a SEPARATE camera with a fixed FOV — classic
    // FPS "decoupled view-model" trick. The arms sit at a fixed offset from the eye, so
    // when the main camera's FOV changes (e.g. to a wide 110°), that same offset projects
    // to a very different on-screen size/position than the rest of the world, making the
    // arms look like they're floating disconnected from the body. Keeping their own
    // camera fixed at 70° avoids that regardless of what the player sets world FOV to.
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 10);
    this.viewmodelScene.add(this.viewmodelCamera);
    // Mirror the main scene's lighting recipe so the arms shade the same way they did
    // when they were lit by the world scene's lights.
    this.viewmodelScene.add(new THREE.AmbientLight(0xcce4ff, 1.0));
    const vmSun = new THREE.DirectionalLight(0xfff8e0, 1.1);
    vmSun.position.set(50, 80, 30);
    this.viewmodelScene.add(vmSun);

    const lowQ = window.GAME_SETTINGS?.lowQuality === true;
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowQ, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(lowQ ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // Lighting — bright sunny daytime
    this._ambientLight = new THREE.AmbientLight(0xcce4ff, 1.0);
    this.scene.add(this._ambientLight);
    this._sunLight = new THREE.DirectionalLight(0xfff8e0, 1.1);
    this._sunLight.position.set(50, 80, 30);
    this.scene.add(this._sunLight);

    this._volcanoCollidables = []; // solid volcano meshes the third-person camera can't see through — must exist before buildWorld() -> buildVolcano() populates it
    this.buildWorld();

    this.playerObjs = {};     // id -> { group, nameSprite, hpSprite, data, targetPos, walkPhase }
    this.buildingObjs = {};   // id -> { group, hpSprite, data }
    this.moneyDropObjs = {};  // id -> { group, data }
    this.myId = null;
    this.myPlayer = null;
    this._countdown = 0;
    this._collectedRecently = new Set();

    this.keys = {};
    this.locked = false;
    this.lastMoveEmit = 0;
    this._raycaster = new THREE.Raycaster();
    this._camRaycaster = new THREE.Raycaster();
    this._jumpY = 0;
    this._jumpVel = 0;
    this._walkPhase = 0;
    this._isWalking = false;
    this._kbDur = 0; this._kbT = 0;
    this._kbFromX = 0; this._kbFromY = 0;
    this._kbToX   = 0; this._kbToY   = 0;

    this.setupInput();
    this._buildArms();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.viewmodelCamera.aspect = window.innerWidth / window.innerHeight;
      this.viewmodelCamera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this._lastFrame = performance.now();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _buildArms() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    this._armMat = mat;
    const clawMat = new THREE.MeshLambertMaterial({ color: 0xfff0cc });
    this._clawMat = clawMat;

    const clawOffsets = [-0.07, 0, 0.07]; // three claws spread across the tip

    const makeArm = (xOff) => {
      const arm = new THREE.Group();
      arm.position.set(xOff, -0.32, -0.55);
      arm.rotation.x = 0.18;

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.40, 0.12), mat);
      arm.add(body);

      // Three small curved claws at the bottom tip of the arm
      for (const cx of clawOffsets) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 5), clawMat);
        claw.position.set(cx, -0.25, -0.03); // hang below the arm, slightly forward
        claw.rotation.x = -0.5; // angle forward like a claw
        arm.add(claw);
      }

      this.viewmodelCamera.add(arm);
      return arm;
    };

    this._armL = makeArm(-0.22);
    this._armR = makeArm( 0.22);
    this._armL.visible = false;
    this._armR.visible = false;
    this._armSwinging = false;
    this._armSwingT = 0;
  }

  buildWorld() {
    const W = WORLD_SIZE * WU;
    // Ground — bright sunny grass
    this._groundMat = new THREE.MeshLambertMaterial({ color: 0x3cb043 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), this._groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, W / 2);
    this.scene.add(ground);

    // Grid lines for depth perception
    this._grid = new THREE.GridHelper(W, 32, 0x2d8a35, 0x2d8a35);
    this._grid.position.set(W / 2, 0.01, W / 2);
    this.scene.add(this._grid);

    // World border (low walls)
    const borderMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const borderH = 1.2, borderT = 0.4;
    [[W / 2, -borderT / 2, W, borderH, borderT], [W / 2, W + borderT / 2, W, borderH, borderT]].forEach(([x, z, w, h, t]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), borderMat);
      b.position.set(x, h / 2, z); this.scene.add(b);
    });
    [[-borderT / 2, W / 2, borderT, borderH, W], [W + borderT / 2, W / 2, borderT, borderH, W]].forEach(([x, z, w, h, d]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), borderMat);
      b.position.set(x, h / 2, z); this.scene.add(b);
    });

    // Base pads — colored platforms so players can orient themselves
    for (const pad of PADS_DATA) {
      const cx = sx(pad.x + PAD_SIZE / 2), cz = sz(pad.y + PAD_SIZE / 2);
      const plat = new THREE.Mesh(
        new THREE.CylinderGeometry(PAD_SIZE * WU * 0.85, PAD_SIZE * WU * 0.85, 0.1, 24),
        new THREE.MeshLambertMaterial({ color: pad.hex, transparent: true, opacity: 0.35 })
      );
      plat.position.set(cx, 0.05, cz);
      this.scene.add(plat);
    }

    this.buildSky();
    this.buildDecorations();
    this.buildVolcano();
  }

  applyMapTheme(map) {
    const t = MAP_THEMES[map] || MAP_THEMES.jungle;
    this.scene.background.setHex(t.sky);
    this.scene.fog.color.setHex(t.sky);
    this.scene.fog.near = t.fogNear;
    this.scene.fog.far  = t.fogFar;
    this._groundMat.color.setHex(t.ground);
    const gridMats = Array.isArray(this._grid.material) ? this._grid.material : [this._grid.material];
    gridMats.forEach(m => m.color.setHex(t.grid));
    this._ambientLight.color.setHex(t.ambient);
    this._sunLight.color.setHex(t.sun);
    if (this._sunMesh) {
      this._sunMesh.material.color.setHex(t.sun);
      this._sunHalo.material.color.setHex(t.sun);
    }
  }

  buildSky() {
    const W = WORLD_SIZE * WU;
    const rng = (a, b) => a + Math.random() * (b - a);
    const lowQ = window.GAME_SETTINGS?.lowQuality === true;

    // Sun sphere + halo
    const sunGeo = new THREE.SphereGeometry(3.5, 16, 16);
    this._sunMesh = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xffe060 }));
    this._sunMesh.position.set(W * 0.15, 55, W * 0.1);
    this.scene.add(this._sunMesh);

    const haloGeo = new THREE.SphereGeometry(5.8, 16, 16);
    this._sunHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffe060, transparent: true, opacity: 0.13 }));
    this._sunHalo.position.copy(this._sunMesh.position);
    this.scene.add(this._sunHalo);

    // Drifting clouds — skip in low quality mode
    this._clouds = [];
    if (lowQ) return;
    const COLS = 4, ROWS = 3;
    const cellW = (W + 20) / COLS, cellD = (W + 20) / ROWS;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cw = rng(7, 17), ch = rng(0.5, 1.1), cd = rng(4, 10);
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: rng(0.5, 0.78) })
        );
        mesh.scale.set(cw, ch, cd);
        mesh.position.set(
          -10 + col * cellW + rng(cellW * 0.1, cellW * 0.9),
          rng(18, 45),
          row * cellD + rng(cellD * 0.1, cellD * 0.9)
        );
        mesh._cloudSpeed = rng(0.25, 0.65);
        this.scene.add(mesh);
        this._clouds.push(mesh);
      }
    }
  }

  buildDecorations() {
    if (window.GAME_SETTINGS?.lowQuality === true) return;
    const rng = (a, b) => a + Math.random() * (b - a);
    const padZones = PADS_DATA.map(p => ({
      cx: p.x + PAD_SIZE / 2, cy: p.y + PAD_SIZE / 2, r: PAD_SIZE * 0.65
    }));
    const inPad = (x, y) => padZones.some(z => Math.hypot(x - z.cx, y - z.cy) < z.r);
    const dummy = new THREE.Object3D();

    // Rocks — single InstancedMesh for all 90 rocks (1 draw call instead of 90)
    const rockGeo = new THREE.BoxGeometry(1, 1, 1);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x7a7060 });
    const ROCK_COUNT = 90;
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
    rockMesh.castShadow = false; rockMesh.receiveShadow = false;
    let placed = 0, attempts = 0;
    while (placed < ROCK_COUNT && attempts < 500) {
      attempts++;
      const wx = rng(60, WORLD_SIZE - 60), wy = rng(60, WORLD_SIZE - 60);
      if (inPad(wx, wy)) continue;
      const s = rng(0.14, 0.5);
      dummy.position.set(sx(wx), s * 0.28, sz(wy));
      dummy.rotation.set(rng(-0.18, 0.18), rng(0, Math.PI * 2), rng(-0.18, 0.18));
      dummy.scale.set(s * rng(0.7, 1.5), s * rng(0.5, 1.0), s * rng(0.7, 1.5));
      dummy.updateMatrix();
      rockMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(rockMesh);

    // Fossil shards — single InstancedMesh (1 draw call instead of 40)
    const fossilGeo = new THREE.BoxGeometry(1, 1, 1);
    const fossilMat = new THREE.MeshLambertMaterial({ color: 0xd4b896 });
    const FOSSIL_COUNT = 40;
    const fossilMesh = new THREE.InstancedMesh(fossilGeo, fossilMat, FOSSIL_COUNT);
    fossilMesh.castShadow = false; fossilMesh.receiveShadow = false;
    placed = 0; attempts = 0;
    while (placed < FOSSIL_COUNT && attempts < 300) {
      attempts++;
      const wx = rng(60, WORLD_SIZE - 60), wy = rng(60, WORLD_SIZE - 60);
      if (inPad(wx, wy)) continue;
      dummy.position.set(sx(wx), 0.035, sz(wy));
      dummy.rotation.set(0, rng(0, Math.PI * 2), 0);
      dummy.scale.set(rng(0.18, 0.55), 0.07, rng(0.08, 0.22));
      dummy.updateMatrix();
      fossilMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    fossilMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(fossilMesh);
  }

  buildVolcano() {
    const cx = sx(VOLCANO_CX_SRV), cz = sz(VOLCANO_CZ_SRV);
    const bR = VOLCANO_BASE_R, pH = VOLCANO_PEAK_H, crR = VOLCANO_CRATER_R;
    const cFloor = VOLCANO_CRATER_FLOOR;

    // ── Noise helpers ─────────────────────────────────────────────────────────
    const _h = (a, b) => { const n = Math.sin(a*127.1+b*311.7)*43758.5453; return n-Math.floor(n); };
    const vn = (x, y) => {
      const ix=x|0,iy=y|0,fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
      return _h(ix,iy)*(1-u)*(1-v)+_h(ix+1,iy)*u*(1-v)+_h(ix,iy+1)*(1-u)*v+_h(ix+1,iy+1)*u*v;
    };
    const fbm = (x,y,o=5) => {
      let a=0,f=1,amp=0.5,mx=0;
      for(let i=0;i<o;i++){a+=vn(x*f,y*f)*amp;mx+=amp;amp*=0.5;f*=2.07;}
      return a/mx;
    };

    // ── Height-stratified diffuse texture ─────────────────────────────────────
    // UV.v=0 at base, UV.v=1 at summit. ty/TH=0=jungle base, 1=dark rock summit.
    const TW=256, TH=512;
    const rcv=document.createElement('canvas'); rcv.width=TW; rcv.height=TH;
    const rct=rcv.getContext('2d'), rid=rct.createImageData(TW,TH);
    for(let ty=0;ty<TH;ty++) for(let tx=0;tx<TW;tx++){
      const t=ty/TH; // 0=base, 1=summit
      const n1=fbm(tx/TW*6.0+0.3, ty/TH*8.5, 6);
      const n2=fbm(tx/TW*22+4.1, ty/TH*30+1.3, 3);
      // Subtle vertical channels (lighter than before)
      const ang=tx/TW*Math.PI*2;
      const gullyRaw=Math.pow(Math.max(0,-Math.sin(ang*6+n1*2.0)),4)*(1-t*0.6)*Math.min(1,t*4+0.1);
      const gully=Math.min(0.7,gullyRaw*1.5);
      // Five altitude zones
      const vegStr  =Math.max(0,Math.min(1,(0.22-t)/0.14));              // jungle 0–0.22
      const scrubStr=Math.max(0,Math.min(1,(t-0.12)/0.12))*Math.max(0,Math.min(1,(0.38-t)/0.13)); // scrub 0.12–0.38
      const rockStr =Math.max(0,Math.min(1,(t-0.26)/0.14))*Math.max(0,Math.min(1,(0.78-t)/0.16)); // rock 0.26–0.78
      const ashStr  =Math.max(0,Math.min(1,(t-0.68)/0.12))*Math.max(0,Math.min(1,(0.92-t)/0.08)); // ash 0.68–0.92
      const summStr =Math.max(0,Math.min(1,(t-0.88)/0.08));              // near-black summit 0.88–1
      // Colors
      const vegR=28+n1*14, vegG=48+n1*18, vegB=14+n1*7;
      const scrR=62+n1*28, scrG=54+n1*22, scrB=28+n1*12;
      const rkR =82+n1*54, rkG =66+n1*38, rkB =50+n1*26;
      const ashR=52+n1*30, ashG=44+n1*22, ashB=38+n1*16;
      const summR=22+n1*14, summG=18+n1*10, summB=16+n1*8;
      let r=vegR,g=vegG,b=vegB;
      r=r*(1-scrubStr)+scrR*scrubStr; g=g*(1-scrubStr)+scrG*scrubStr; b=b*(1-scrubStr)+scrB*scrubStr;
      r=r*(1-rockStr)+rkR*rockStr;    g=g*(1-rockStr)+rkG*rockStr;    b=b*(1-rockStr)+rkB*rockStr;
      r=r*(1-ashStr)+ashR*ashStr;     g=g*(1-ashStr)+ashG*ashStr;     b=b*(1-ashStr)+ashB*ashStr;
      r=r*(1-summStr)+summR*summStr;  g=g*(1-summStr)+summG*summStr;  b=b*(1-summStr)+summB*summStr;
      r*=(1-gully*0.50); g*=(1-gully*0.46); b*=(1-gully*0.38);
      r=Math.min(255,Math.max(0,r+(n2-0.5)*22)); g=Math.min(255,Math.max(0,g+(n2-0.5)*16)); b=Math.min(255,Math.max(0,b+(n2-0.5)*10));
      const i4=(ty*TW+tx)*4;
      rid.data[i4]=r|0; rid.data[i4+1]=g|0; rid.data[i4+2]=b|0; rid.data[i4+3]=255;
    }
    rct.putImageData(rid,0,0);
    const rockTex=new THREE.CanvasTexture(rcv);
    rockTex.wrapS=THREE.RepeatWrapping; rockTex.wrapT=THREE.ClampToEdgeWrapping;
    rockTex.repeat.set(4,1);

    // ── Bump map (same altitude orientation) ─────────────────────────────────
    const bcv=document.createElement('canvas'); bcv.width=TW; bcv.height=TH;
    const bct=bcv.getContext('2d'), bid=bct.createImageData(TW,TH);
    for(let ty=0;ty<TH;ty++) for(let tx=0;tx<TW;tx++){
      const t=ty/TH;
      const n=fbm(tx/TW*10,ty/TH*14,6);
      const n2=fbm(tx/TW*38+3,ty/TH*52+6,3);
      const ang=tx/TW*Math.PI*2;
      const vch=Math.pow(Math.max(0,-Math.sin(ang*8)),2)*0.38*(1-t*0.5);
      const v=((n*0.55+n2*0.25+vch*0.20)*255)|0;
      const i4=(ty*TW+tx)*4;
      bid.data[i4]=bid.data[i4+1]=bid.data[i4+2]=Math.min(255,v); bid.data[i4+3]=255;
    }
    bct.putImageData(bid,0,0);
    const bumpTex=new THREE.CanvasTexture(bcv);
    bumpTex.wrapS=THREE.RepeatWrapping; bumpTex.wrapT=THREE.ClampToEdgeWrapping;
    bumpTex.repeat.set(4,1);

    // ── Lava texture (domain-warped, offset-animated) ─────────────────────────
    const lcv=document.createElement('canvas'); lcv.width=lcv.height=128;
    const lct=lcv.getContext('2d'), lid=lct.createImageData(128,128);
    for(let y=0;y<128;y++) for(let x=0;x<128;x++){
      const wx=fbm(x/128*5,y/128*5+1.3,3), wy=fbm(x/128*5+2.7,y/128*5,3);
      const n=fbm(x/128*7+wx*0.8,y/128*7+wy*0.8,5);
      const i4=(y*128+x)*4;
      lid.data[i4]=Math.min(255,(200+n*55)|0);
      lid.data[i4+1]=Math.min(255,(n*n*n*180)|0);
      lid.data[i4+2]=Math.min(255,n>0.85?((n-0.85)*6*120)|0:0);
      lid.data[i4+3]=255;
    }
    lct.putImageData(lid,0,0);
    const lavaTex=new THREE.CanvasTexture(lcv);
    lavaTex.wrapS=lavaTex.wrapT=THREE.RepeatWrapping;
    this._lavaTex=lavaTex;

    // ── Smoke sprite texture (billowing cream/white ash) ──────────────────────
    const scv=document.createElement('canvas'); scv.width=scv.height=128;
    const sct=scv.getContext('2d');
    const sg=sct.createRadialGradient(64,64,0,64,64,62);
    sg.addColorStop(0,   'rgba(242,238,232,0.96)');
    sg.addColorStop(0.2, 'rgba(220,215,208,0.84)');
    sg.addColorStop(0.5, 'rgba(190,185,178,0.46)');
    sg.addColorStop(0.78,'rgba(155,150,143,0.15)');
    sg.addColorStop(1,   'rgba(120,115,108,0)');
    sct.fillStyle=sg; sct.fillRect(0,0,128,128);
    const smokeTex=new THREE.CanvasTexture(scv);
    this._smokeTex=smokeTex;

    // ── Materials ─────────────────────────────────────────────────────────────
    const rockMat=new THREE.MeshStandardMaterial({
      map:rockTex, bumpMap:bumpTex, bumpScale:1.4,
      roughness:0.93, metalness:0.02,
      side:THREE.DoubleSide, // the body is open-ended (real crater hole) — if any
      // viewing angle ever catches an interior backface, it must still render lit
      // rock instead of an unlit black void.
    });
    const lavaMat=new THREE.MeshBasicMaterial({map:lavaTex, side:THREE.DoubleSide});

    // ── Volcano body — concave stratovolcano profile ───────────────────────────
    // Reshape each vertex from a plain cylinder to an exponential concave profile:
    // steep near summit (like Arenal, Fuji), gently flaring at the base.
    const bodyGeo=new THREE.CylinderGeometry(crR*0.88, bR, pH, 80, 40, true);
    const pos=bodyGeo.attributes.position;
    for(let vi=0;vi<pos.count;vi++){
      const vx=pos.getX(vi),vy=pos.getY(vi),vz=pos.getZ(vi);
      const t=(vy+pH*0.5)/pH; // 0=base, 1=summit
      const currentR=Math.sqrt(vx*vx+vz*vz);
      if(currentR<0.01) continue;
      const ang=Math.atan2(vz,vx);
      // Concave exponential profile
      const profileR=(crR*0.88)+(bR-(crR*0.88))*Math.pow(1-t,1.40);
      // Large-scale asymmetric bumps (angular, not height-based) — kept subtle so
      // volcanoHeightAt()'s idealized profile stays a close match to the real mesh;
      // a bigger wobble here reads as "floating"/clipping for anything standing on it.
      const n1=fbm(Math.cos(ang)*2.5+5,Math.sin(ang)*2.5+t*2,4);
      const broadDisp=(n1-0.5)*profileR*0.008*(1-t*0.32);
      // Erosion gullies — radially inward only, no Y change (prevents banding)
      const gullyD=profileR*0.008*(1-t*0.65)*Math.min(1,t*4+0.12);
      const gl1=Math.pow(Math.max(0,-Math.sin(ang*8+n1*3.0)),4)*gullyD;
      const gl2=Math.pow(Math.max(0,-Math.sin(ang*13+n1*4.5+1.1)),5)*gullyD*0.52;
      // Fine surface roughness
      const n2=fbm(Math.cos(ang)*6+t*4+2,Math.sin(ang)*6+1,3);
      const fineDisp=(n2-0.5)*profileR*0.008*(1-t*0.42);
      const finalR=profileR+broadDisp+fineDisp-gl1-gl2;
      pos.setXYZ(vi, Math.cos(ang)*finalR, vy, Math.sin(ang)*finalR);
    }
    bodyGeo.computeVertexNormals();
    const bodyMesh=new THREE.Mesh(bodyGeo,rockMat);
    bodyMesh.position.set(cx,pH/2,cz);
    this.scene.add(bodyMesh);
    this._volcanoCollidables.push(bodyMesh);

    // ── Floor cap — the body is open-ended (real crater hole at the summit) so
    // CylinderGeometry also strips its BOTTOM cap; without this the mountain is a
    // fully hollow shell and some viewing angles look straight through the base
    // into an unlit black void. A simple opaque disc closes it off completely.
    const bodyFloor=new THREE.Mesh(
      new THREE.CircleGeometry(bR*1.02,64),
      new THREE.MeshLambertMaterial({color:0x0e0c08})
    );
    bodyFloor.rotation.x=-Math.PI/2;
    bodyFloor.position.set(cx,0.01,cz);
    this.scene.add(bodyFloor);
    this._volcanoCollidables.push(bodyFloor);

    // ── Crater inner walls — funnel from the body's real open summit down to the vent
    const ventTopR=crR*0.90, ventBotR=crR*0.36;
    const cwGeo=new THREE.CylinderGeometry(ventTopR,ventBotR,pH-cFloor,32,4,true);
    const cwMat=new THREE.MeshPhongMaterial({
      map:rockTex,bumpMap:bumpTex,bumpScale:2.5,
      shininess:18,specular:new THREE.Color(0xff3300),
      emissive:new THREE.Color(0x4a1400),
      side:THREE.DoubleSide,
    });
    const crWall=new THREE.Mesh(cwGeo,cwMat);
    crWall.position.set(cx,(pH+cFloor)/2,cz);
    this.scene.add(crWall);
    this._volcanoCollidables.push(crWall);

    // ── Animated lava pool — sits flush at the bottom of the vent funnel ───────
    const poolMat=new THREE.MeshStandardMaterial({
      map:lavaTex,emissiveMap:lavaTex,
      emissive:new THREE.Color(0xff5500),emissiveIntensity:2.5,
      roughness:0.9,metalness:0.0,
    });
    const poolMesh=new THREE.Mesh(new THREE.CylinderGeometry(ventBotR,ventBotR,0.22,32),poolMat);
    poolMesh.position.set(cx,cFloor-0.08,cz);
    this.scene.add(poolMesh);
    this._lavaPool=poolMesh;
    this._lavaPoolMat=poolMat;

    // ── Rock boulders at base ─────────────────────────────────────────────────
    const boulderMat=new THREE.MeshStandardMaterial({
      map:rockTex,bumpMap:bumpTex,bumpScale:2.0,
      roughness:0.92,metalness:0.02,color:0xaaaaaa,
    });
    for(let i=0;i<20;i++){
      const bang=Math.random()*Math.PI*2, brad=bR*(0.72+Math.random()*0.26);
      const bx=cx+Math.cos(bang)*brad, bz2=cz+Math.sin(bang)*brad;
      const bs=0.20+Math.random()*0.72;
      const bGeo=new THREE.DodecahedronGeometry(bs,0);
      const bp2=bGeo.attributes.position;
      for(let vi=0;vi<bp2.count;vi++){
        const vx=bp2.getX(vi),vy=bp2.getY(vi),vz=bp2.getZ(vi);
        const n=fbm(vx*4.5+i,vy*4.5,3)*0.38-0.19;
        bp2.setXYZ(vi,vx+n*vx,vy+n*vy,vz+n*vz);
      }
      bGeo.computeVertexNormals();
      const bl=new THREE.Mesh(bGeo,boulderMat);
      bl.position.set(bx,volcanoHeightAt(bx,bz2)+bs*0.28,bz2);
      bl.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
      this.scene.add(bl);
    }

    // ── Dark ash/scorch field ─────────────────────────────────────────────────
    const ashMesh=new THREE.Mesh(
      new THREE.RingGeometry(bR*0.78,bR*1.18,52),
      new THREE.MeshLambertMaterial({color:0x0e0c08,transparent:true,opacity:0.88})
    );
    ashMesh.rotation.x=-Math.PI/2;
    ashMesh.position.set(cx,0.02,cz);
    this.scene.add(ashMesh);

    // ── Lights ────────────────────────────────────────────────────────────────
    const crLight=new THREE.PointLight(0xff4400,10,60);
    crLight.position.set(cx,cFloor+1.5,cz);
    this.scene.add(crLight);
    this._volcanoLight=crLight;

    const topGlow=new THREE.PointLight(0xff3300,4.0,140);
    topGlow.position.set(cx,pH+3,cz);
    this.scene.add(topGlow);
    this._volcanoTopGlow=topGlow;

    const midLight=new THREE.PointLight(0xff6600,2.8,95);
    midLight.position.set(cx,pH*0.45,cz);
    this.scene.add(midLight);

    const fillLight=new THREE.PointLight(0xff5500,1.8,75);
    fillLight.position.set(cx+bR*0.4,pH*0.3,cz+bR*0.4);
    this.scene.add(fillLight);

    // ── Rising ash/smoke plume ────────────────────────────────────────────────
    this._volcanoSmoke=[];
    for(let i=0;i<55;i++){
      const dur=5+Math.random()*8;
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({
        map:smokeTex, transparent:true, depthWrite:false,
        opacity:0.58+Math.random()*0.28,
        color:new THREE.Color().setHSL(0.06,0.05,0.62+Math.random()*0.22),
      }));
      const ang=Math.random()*Math.PI*2;
      const r=Math.random()*VOLCANO_CRATER_R*0.60;
      sp._smokeDur=dur;
      sp._smokeLife=dur*Math.random();
      sp._smokePX=cx+Math.cos(ang)*r;
      sp._smokePZ=cz+Math.sin(ang)*r;
      sp._smokeVX=(Math.random()-0.5)*0.35;
      sp._smokeVZ=(Math.random()-0.5)*0.35;
      sp._smokeSpd=2.5+Math.random()*2.5;
      sp._smokeStartY=cFloor+0.4;
      const frac0=sp._smokeLife/dur;
      sp.position.set(sp._smokePX,sp._smokeStartY+sp._smokeSpd*frac0*dur,sp._smokePZ);
      sp.scale.setScalar(0.5+frac0*6.5);
      this.scene.add(sp);
      this._volcanoSmoke.push(sp);
    }

  }

  showVolcanoErupt(bombs, erupAt) {
    const cx = sx(VOLCANO_CX_SRV), cz = sz(VOLCANO_CZ_SRV);
    const originY = VOLCANO_PEAK_H + 1;
    // Compensate for network delay between the server starting the eruption and
    // this client receiving it, so lava bombs still land on the impact area
    // exactly when the server's damage/landing event fires.
    const latencyMs = erupAt ? Math.max(0, Date.now() - erupAt) : 0;
    const nowAdj = () => performance.now() - latencyMs;

    // ── Crater flash ─────────────────────────────────────────────────────────
    if (this._volcanoLight)  { this._volcanoLight.intensity  = 30; }
    if (this._volcanoTopGlow){ this._volcanoTopGlow.intensity = 16; }
    setTimeout(() => {
      if (this._volcanoLight)   this._volcanoLight.intensity  = 6.0;
      if (this._volcanoTopGlow) this._volcanoTopGlow.intensity = 1.6;
    }, Math.max(0, 900 - latencyMs));

    // ── Instant eruption jet — a bright column that whooshes up from the vent the
    // moment it blows, before the particle debris takes over ─────────────────────
    const jetMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 });
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 1, 12, 1, true), jetMat);
    jet.position.set(cx, originY, cz);
    this.scene.add(jet);
    const jetStart = performance.now();
    const stepJet = () => {
      const t = Math.min((performance.now() - jetStart) / 550, 1);
      jet.scale.set(1 + t * 0.6, 1 + t * 26, 1 + t * 0.6);
      jet.position.y = originY + t * 13;
      jetMat.opacity = 0.9 * (1 - t);
      if (t < 1) requestAnimationFrame(stepJet);
      else this.scene.remove(jet);
    };
    requestAnimationFrame(stepJet);

    // ── Upward burst particles — fine ash/ember debris ─────────────────────────
    const burstGeo = new THREE.SphereGeometry(0.36, 5, 4);
    const BURST = 90;
    this._volcanoParticles = this._volcanoParticles || [];
    for (let i = 0; i < BURST; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0x552200 : (i % 3 === 1 ? 0xff5500 : 0xff9900) });
      const p = new THREE.Mesh(burstGeo, mat);
      const ang = Math.random() * Math.PI * 2;
      const spd = 10 + Math.random() * 22;
      p._vx = Math.cos(ang) * spd * 0.3;
      p._vy = spd;
      p._vz = Math.sin(ang) * spd * 0.3;
      p._g  = -30;
      p._born = nowAdj();
      p._life = 1.3 + Math.random() * 1.1;
      p.position.set(cx + (Math.random() - 0.5) * VOLCANO_CRATER_R * 0.6, originY, cz + (Math.random() - 0.5) * VOLCANO_CRATER_R * 0.6);
      this.scene.add(p);
      this._volcanoParticles.push(p);
    }

    // ── Molten lava chunks — bigger, brighter, glowing debris that reads as
    // actual lava flying out (not just fine ash), a few carrying their own light ──
    const chunkGeo = new THREE.SphereGeometry(1, 6, 5);
    const CHUNKS = 18;
    for (let i = 0; i < CHUNKS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xff6a00 : 0xffcc33 });
      const chunk = new THREE.Mesh(chunkGeo, mat);
      chunk.scale.setScalar(0.7 + Math.random() * 0.9);
      const ang = Math.random() * Math.PI * 2;
      const spd = 16 + Math.random() * 16;
      chunk._vx = Math.cos(ang) * spd * 0.45;
      chunk._vy = spd;
      chunk._vz = Math.sin(ang) * spd * 0.45;
      chunk._g  = -26;
      chunk._born = nowAdj();
      chunk._life = 2.2 + Math.random() * 1.4;
      chunk.position.set(cx + (Math.random() - 0.5) * VOLCANO_CRATER_R * 0.5, originY, cz + (Math.random() - 0.5) * VOLCANO_CRATER_R * 0.5);
      if (i % 3 === 0) chunk.add(new THREE.PointLight(0xff5500, 3.5, 9));
      this.scene.add(chunk);
      this._volcanoParticles.push(chunk);
    }

    // ── Billowing ash cloud filling the sky above the crater ───────────────────
    const ashPuffs = [];
    const ASH_N = 60;
    for (let i = 0; i < ASH_N; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._smokeTex, transparent: true, depthWrite: false,
        opacity: 0,
        color: new THREE.Color().setHSL(0.05, 0.08, 0.28 + Math.random() * 0.30),
      }));
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * VOLCANO_CRATER_R * 3.0;
      sp.position.set(cx + Math.cos(ang) * r, originY, cz + Math.sin(ang) * r);
      sp._apVX = (Math.random() - 0.5) * 5.5;
      sp._apVZ = (Math.random() - 0.5) * 5.5;
      sp._apVY = 3.5 + Math.random() * 5.0;
      sp._apAge = -Math.random() * 1.2;
      sp._apLife = 11 + Math.random() * 9;
      sp._apScaleEnd = 12 + Math.random() * 16;
      sp.scale.setScalar(1);
      this.scene.add(sp);
      ashPuffs.push(sp);
    }
    let ashLastT = nowAdj();
    const stepAsh = () => {
      const now = performance.now();
      const dt = Math.min((now - ashLastT) / 1000, 0.1);
      ashLastT = now;
      let alive = false;
      for (const sp of ashPuffs) {
        sp._apAge += dt;
        if (sp._apAge < 0) { alive = true; continue; }
        if (sp._apAge >= sp._apLife) { this.scene.remove(sp); continue; }
        alive = true;
        const frac = sp._apAge / sp._apLife;
        sp.position.x += sp._apVX * dt * (1 - frac * 0.5);
        sp.position.z += sp._apVZ * dt * (1 - frac * 0.5);
        sp.position.y += sp._apVY * dt * (1 - frac * 0.6);
        sp.scale.setScalar(1 + frac * sp._apScaleEnd);
        sp.material.opacity = frac < 0.12 ? frac / 0.12 * 0.78 : (frac > 0.6 ? (1 - frac) / 0.4 * 0.78 : 0.78);
      }
      if (alive) requestAnimationFrame(stepAsh);
    };
    requestAnimationFrame(stepAsh);

    // ── Lava bombs arcing to target positions ─────────────────────────────────
    this._lavaBombsInFlight = this._lavaBombsInFlight || [];
    const TRAVEL = 3.5; // seconds — must match server setTimeout delay
    for (const bomb of bombs) {
      const tx = sx(bomb.x), tz = sz(bomb.y);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
      const geo = new THREE.SphereGeometry(0.75, 8, 6);
      const ball = new THREE.Mesh(geo, mat);
      ball.position.set(cx, originY, cz);
      const light = new THREE.PointLight(0xff5500, 4.5, 10);
      ball.add(light);
      this.scene.add(ball);
      ball._lbStart  = nowAdj();
      ball._lbTravel = TRAVEL * 1000;
      ball._lbSX = cx; ball._lbSY = originY; ball._lbSZ = cz;
      ball._lbTX = tx; ball._lbTZ = tz;
      ball._lbPeakY = originY + 16 + Math.random() * 10;
      this._lavaBombsInFlight.push(ball);
    }

    // ── Shockwave rings at crater (double pulse) ────────────────────────────────
    const spawnShockwave = (delay) => setTimeout(() => {
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1, 4.5, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, VOLCANO_PEAK_H + 0.5, cz);
      this.scene.add(ring);
      const rStart = performance.now();
      const expandRing = () => {
        const t = Math.min((performance.now() - rStart) / 1400, 1);
        ring.scale.setScalar(1 + t * 16);
        ringMat.opacity = 0.75 * (1 - t);
        if (t < 1) requestAnimationFrame(expandRing);
        else this.scene.remove(ring);
      };
      requestAnimationFrame(expandRing);
    }, delay);
    spawnShockwave(0);
    spawnShockwave(220);

    // Camera shake if player is on/near the volcano
    if (this.myPlayer) {
      const dSrv = Math.hypot(this.myPlayer.x - VOLCANO_CX_SRV, this.myPlayer.y - VOLCANO_CZ_SRV);
      if (dSrv < 1400) this._shakeUntil = performance.now() + 900;
    }
    window.addChatMessage?.('🌋 Volcano', 'The volcano erupts! Take cover!', '#ff4400');
    window.SFX?.crunch?.();
  }

  showLavaBombsLand(bombs) {
    for (const bomb of bombs) {
      this.showHitEffect(bomb.x, bomb.y, 0xff4400);
      const cx2 = sx(bomb.x), cz2 = sz(bomb.y);
      const scorchMat = new THREE.MeshBasicMaterial({ color: 0x330800, transparent: true, opacity: 0.8 });
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(VOLCANO_BASE_R * 0.45, 18), scorchMat);
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.set(cx2, 0.03, cz2);
      this.scene.add(scorch);
      const sStart = performance.now();
      const fadeScorch = () => {
        const t = Math.min((performance.now() - sStart) / 4000, 1);
        scorchMat.opacity = 0.8 * (1 - t);
        if (t < 1) requestAnimationFrame(fadeScorch);
        else this.scene.remove(scorch);
      };
      requestAnimationFrame(fadeScorch);

      // Smoke puffs rising from the impact site
      const puffs = [];
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._smokeTex, transparent: true, depthWrite: false,
          opacity: 0, color: new THREE.Color().setHSL(0.06, 0.06, 0.32 + Math.random() * 0.26),
        }));
        sp.position.set(cx2 + (Math.random() - 0.5) * 3, 0.3, cz2 + (Math.random() - 0.5) * 3);
        sp._pVY = 1.4 + Math.random() * 1.8;
        sp._pLife = 4.5 + Math.random() * 4.5;
        sp._pAge = -Math.random() * 1.5;
        sp._pScaleEnd = 3.5 + Math.random() * 4;
        sp.scale.setScalar(0.6);
        this.scene.add(sp);
        puffs.push(sp);
      }
      let pLastT = performance.now();
      const stepPuffs = () => {
        const now = performance.now();
        const dt = Math.min((now - pLastT) / 1000, 0.1);
        pLastT = now;
        let alive = false;
        for (const sp of puffs) {
          sp._pAge += dt;
          if (sp._pAge < 0) { alive = true; continue; }
          if (sp._pAge >= sp._pLife) { this.scene.remove(sp); continue; }
          alive = true;
          const frac = sp._pAge / sp._pLife;
          sp.position.y += sp._pVY * dt;
          sp.scale.setScalar(0.6 + frac * sp._pScaleEnd);
          sp.material.opacity = frac < 0.15 ? frac / 0.15 * 0.62 : (frac > 0.65 ? (1 - frac) / 0.35 * 0.62 : 0.62);
        }
        if (alive) requestAnimationFrame(stepPuffs);
      };
      requestAnimationFrame(stepPuffs);

      if (this.myPlayer) {
        const d = Math.hypot(this.myPlayer.x - bomb.x, this.myPlayer.y - bomb.y);
        if (d < 250) this._shakeUntil = performance.now() + 300;
      }
    }
    window.SFX?.crunch?.();
  }

  setupInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      // Don't re-acquire pointer lock while shop/pause overlay is open
      if (typeof _paused !== 'undefined' && _paused) return;
      if (!this.locked) { canvas.requestPointerLock()?.catch(() => {}); return; }
      this.tryAttackOrCollect();
    });
    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      // Right after the lock engages, some browsers report one bogus movementX/Y
      // spike (e.g. the OS cursor's jump to the lock point leaking through) —
      // skip that first event instead of turning it into a camera snap.
      if (this.locked) this._skipNextMouseMove = true;
      const ch = document.getElementById('crosshair3d');
      if (ch) ch.style.display = this.locked ? 'block' : 'none';
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this._skipNextMouseMove) { this._skipNextMouseMove = false; return; }
      // Clamp each event's delta — a stutter (slow GPU, dropped frames) can let the
      // browser coalesce several frames' worth of mouse movement into one oversized
      // event, which otherwise reads as the camera instantly snapping to a new angle.
      const MAX_DELTA = 80;
      const mx = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementX));
      const my = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.movementY));
      const sens = 0.0008 + ((window.GAME_SETTINGS?.mouseSensitivity ?? 50) / 100) * 0.004;
      this.yawObject.rotation.y -= mx * sens;
      this.pitchObject.rotation.x += my * sens;
      this.pitchObject.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitchObject.rotation.x));
    });
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        // Gate on pointer lock like the other gameplay keys — without this, pressing
        // Space while paused (pointer unlocked) queues a jump impulse that update()
        // skips applying while paused, then fires unexpectedly the instant you resume.
        if (this.locked && this._jumpY === 0 && !this.myPlayer?.isDead) this._jumpVel = 11; // jump
      }
      if (e.code === 'Tab' && this.locked && window.gameSocket) {
        e.preventDefault();
        window.gameSocket.emit('collectPadDrops');
      }
      if (e.code === 'F5') {
        e.preventDefault();
        this._camMode = (this._camMode + 1) % 3;
        const labels = ['🎥 Third-person', '👁️ First-person', '🔄 Front-cam'];
        window.showToast?.(labels[this._camMode], 1200);
      }
      if (e.code === 'KeyX' && this.locked) {
        e.preventDefault();
        this.tryDemolish();
      }
      if (e.code === 'KeyQ' && this.locked && window.gameSocket && !this.myPlayer?.isDead) {
        e.preventDefault();
        // Send facing yaw as charge direction (convert from Three.js yaw to server angle)
        const yaw = this.yawObject?.rotation.y ?? 0;
        const dir = Math.PI / 2 - yaw; // Three.js yaw → server-space angle
        window.gameSocket.emit('chargeAttack', { dir });
        window.SFX?.crunch?.();
      }
      if (e.code === 'KeyE' && this.locked && window.gameSocket && !this.myPlayer?.isDead) {
        e.preventDefault();
        window.gameSocket.emit('roarAttack');
        window.SFX?.roar?.();
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  // Projects a screen point onto the ground plane (y=0) and returns server-unit (x,y).
  // Used by the shop's drag-and-drop building placement.
  screenToServerXY(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const ray = this._raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    const wx = ray.origin.x + ray.direction.x * t;
    const wz = ray.origin.z + ray.direction.z * t;
    return { x: wx / WU, y: wz / WU };
  }

  // Semi-transparent preview of the building being dragged from the shop
  updateBuildGhost(upgradeId, clientX, clientY) {
    const pos = this.screenToServerXY(clientX, clientY);
    if (!pos) return;
    if (this._ghost && this._ghostUpgradeId !== upgradeId) {
      this.scene.remove(this._ghost);
      this._ghost = null;
    }
    if (!this._ghost) {
      this._ghost = window.buildBuilding3DModel(THREE, upgradeId, this.myPlayer?.color || '#4caf50');
      this._ghost.traverse(o => {
        if (!o.material) return;
        // The Fossil Mine's cave walls use a per-face material array instead of
        // a single material — clone() doesn't exist on arrays, so handle both shapes.
        if (Array.isArray(o.material)) {
          o.material = o.material.map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.5; return c; });
        } else {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.5;
        }
      });
      if (INCOME_UPGRADE_IDS.includes(upgradeId)) this._ghost.scale.setScalar(2);
      this._ghostUpgradeId = upgradeId;
      this.scene.add(this._ghost);
    }
    this._ghost.position.set(sx(pos.x), 0, sz(pos.y));
    // Rotate wall ghost to match the orientation the server will pick (based on player facing)
    if (WALL_TYPES.includes(upgradeId)) {
      const phi = this.yawObject?.rotation.y ?? 0;
      // Server: facingH = |cos(theta)| >= |sin(theta)| where theta = PI/2 - phi
      //       = |sin(phi)| >= |cos(phi)|
      const facingH = Math.abs(Math.sin(phi)) >= Math.abs(Math.cos(phi));
      this._ghost.rotation.y = facingH ? 0 : Math.PI / 2;
    }
  }

  hideBuildGhost() {
    if (this._ghost) { this.scene.remove(this._ghost); this._ghost = null; this._ghostUpgradeId = null; }
  }

  tryAttackOrCollect() {
    if (!this.myPlayer || this.myPlayer.isDead || this._countdown > 0) return;
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const targets = [];
    for (const [id, obj] of Object.entries(this.playerObjs)) {
      if (id === this.myId || obj.data.isDead) continue;
      targets.push({ id, type: 'player', group: obj.group, data: obj.data, dist: Math.hypot(this.myPlayer.x - obj.data.x, this.myPlayer.y - obj.data.y) });
    }
    for (const [id, obj] of Object.entries(this.buildingObjs)) {
      if (obj.data.ownerId === this.myId) continue;
      targets.push({ id, type: 'building', group: obj.group, data: obj.data, dist: Math.hypot(this.myPlayer.x - obj.data.x, this.myPlayer.y - obj.data.y) });
    }
    // Raycast against all candidate group meshes
    const meshLookup = new Map();
    const meshes = [];
    for (const t of targets) {
      t.group.traverse(o => { if (o.isMesh) { meshes.push(o); meshLookup.set(o, t); } });
    }
    const hits = this._raycaster.intersectObjects(meshes, false);
    let chosen = null;
    if (hits.length) {
      const t = meshLookup.get(hits[0].object);
      if (t && t.dist <= REACH) chosen = t;
    }
    if (chosen) {
      if (chosen.type === 'player') {
        window.gameSocket.emit('attack', chosen.id);
        this._lastAttackTargetId = chosen.id;
        this.showBite(this.myId);
        this._armSwinging = true; this._armSwingT = 0;
        window.SFX?.crunch();
        // Instant client-side prediction — no waiting for server round-trip
        this.showLaser(this.myPlayer.x, this.myPlayer.y, chosen.data.x, chosen.data.y);
        this.showHitEffect(chosen.data.x, chosen.data.y, 0xff2222);
        this.showHitAnim(chosen.id);
        const adx = chosen.data.x - this.myPlayer.x, ady = chosen.data.y - this.myPlayer.y;
        const ad = Math.hypot(adx, ady) || 1;
        const ptgt = this.playerObjs[chosen.id];
        if (ptgt) {
          ptgt._kbFromX = chosen.data.x; ptgt._kbFromY = chosen.data.y;
          ptgt._kbToX = chosen.data.x + (adx / ad) * 120;
          ptgt._kbToY = chosen.data.y + (ady / ad) * 120;
          ptgt._kbT = 0; ptgt._kbDur = 0.22;
        }
      } else {
        window.gameSocket.emit('attackBuilding', chosen.id);
        this.showBite(this.myId);
        this._armSwinging = true; this._armSwingT = 0;
        window.SFX?.crunch();
      }
    } else {
      // Nothing in crosshair — still swing arms so the attack feels responsive
      this._armSwinging = true; this._armSwingT = 0;
    }
  }

  // Tear down one of YOUR OWN buildings — fixes misplaced walls/structures without
  // needing to wait for someone else to destroy it. Aim at it and press X.
  tryDemolish() {
    if (!this.myPlayer || this.myPlayer.isDead || this._countdown > 0) return;
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const targets = [];
    for (const [id, obj] of Object.entries(this.buildingObjs)) {
      if (obj.data.ownerId !== this.myId) continue;
      targets.push({ id, group: obj.group, data: obj.data, dist: Math.hypot(this.myPlayer.x - obj.data.x, this.myPlayer.y - obj.data.y) });
    }
    if (!targets.length) { window.showToast?.('🔨 You have no buildings to demolish', 1500); return; }
    const meshLookup = new Map();
    const meshes = [];
    for (const t of targets) {
      t.group.traverse(o => { if (o.isMesh) { meshes.push(o); meshLookup.set(o, t); } });
    }
    const hits = this._raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const t = meshLookup.get(hits[0].object);
      if (t && t.dist <= REACH) {
        window.gameSocket.emit('demolishBuilding', t.id);
        window.SFX?.crunch();
        return;
      }
    }
    window.showToast?.('🔨 Aim at one of your own buildings to demolish it', 1500);
  }

  spawnPlayer(data) {
    const group = window.buildDino3DModel(THREE, data.customSkin ? '#4caf50' : (data.skinColor || data.color));
    group.scale.setScalar(DINO_SCALE);
    this.scene.add(group);

    const nameSprite = makeNameSprite((data.tagPrefix || '') + data.username, data.color);
    nameSprite.position.set(0, 2.05, 0);
    group.add(nameSprite);

    const hpSprite = makeHPBarSprite();
    hpSprite.position.set(0, 1.85, 0);
    group.add(hpSprite);
    redrawHPSprite(hpSprite, data.hp, data.maxHp);

    // Snapshot original mesh colors so showHitAnim can always restore correctly
    // even when called repeatedly before the previous restore fires.
    const origColors = new Map();
    group.traverse(o => { if (o.isMesh) origColors.set(o.uuid, o.material.color.clone()); });
    group.userData.origColors = origColors;

    const obj = { group, nameSprite, hpSprite, data: { ...data }, walkPhase: 0 };

    // Add visible claw tips to the dino's world-space arm pivots (seen by all players)
    const wArmPivots = group.userData.arms;
    if (wArmPivots) {
      const wClawMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
      for (const pivot of wArmPivots) {
        for (const cx of [-0.065, 0, 0.065]) {
          const wClaw = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.11, 5), wClawMat);
          wClaw.position.set(cx, -0.44, 0.06);
          wClaw.rotation.x = -0.55;
          pivot.add(wClaw);
        }
      }
      obj.armPivots = wArmPivots;
    }
    obj._armSwinging = false;
    obj._armSwingT = 0;

    this.playerObjs[data.id] = obj;
    this.setPos(data.id, data.x, data.y, data.dir || 0);
    // Third person — own dino is visible (camera follows behind it), unlike first-person
    return obj;
  }

  removePlayer(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    this.scene.remove(obj.group);
    delete this.playerObjs[id];
  }

  // Instant teleport — snaps the visual group AND resyncs the interpolation
  // target so a following setNetPos doesn't slide back from a stale target.
  setPos(id, x, y, dir) {
    const obj = this.playerObjs[id]; if (!obj) return;
    obj.group.position.set(sx(x), 0, sz(y));
    if (dir !== undefined) { obj.group.rotation.y = dirToRotY(dir); obj.data.dir = dir; }
    obj.data.x = x; obj.data.y = y;
    obj._netTargetX = x; obj._netTargetY = y;
    if (dir !== undefined) obj._netTargetDir = dir;
  }

  // Network position update — updates logical data immediately (for raycasting/
  // distance checks) but only sets an interpolation target; the visual group
  // smoothly eases toward it each frame in update(), avoiding the teleport-y
  // "glitching" look from snapping directly to each 50ms server tick.
  setNetPos(id, x, y, dir) {
    const obj = this.playerObjs[id]; if (!obj) return;
    obj.data.x = x; obj.data.y = y;
    if (dir !== undefined) obj.data.dir = dir;
    obj._netTargetX = x; obj._netTargetY = y;
    if (dir !== undefined) obj._netTargetDir = dir;
  }

  redrawHP(hpSpriteOrObjId, hp, maxHp) {
    // Accept either a sprite directly (compat) or be called with obj
    if (hpSpriteOrObjId && hpSpriteOrObjId.userData && hpSpriteOrObjId.userData.ctx) {
      redrawHPSprite(hpSpriteOrObjId, hp, maxHp);
    }
  }

  spawnBuilding(b) {
    const model = window.buildBuilding3DModel(THREE, b.upgradeId, b.ownerColor);
    if (b.orientation === 'v') model.rotation.y = Math.PI / 2;
    const isIncome = b.type === 'income';
    if (isIncome) model.scale.setScalar(2); // income structures stand out twice as large
    // Wrap in an unscaled outer group so the HP bar sprite (added below) stays
    // normal-sized instead of also being doubled by the model's scale.
    const group = new THREE.Group();
    group.add(model);
    group.position.set(sx(b.x), 0, sz(b.y));
    this.scene.add(group);

    const hpSprite = makeHPBarSprite();
    hpSprite.position.set(0, isIncome ? 5.4 : 2.8, 0); // above the (now taller) structure
    group.add(hpSprite);
    redrawHPSprite(hpSprite, b.hp, b.maxHp);

    this.buildingObjs[b.id] = { group, hpSprite, data: { ...b } };
  }

  removeBuilding(id) {
    const obj = this.buildingObjs[id]; if (!obj) return;
    const pos = obj.group.position.clone();
    const color = obj.data.ownerColor || '#888888';
    this._spawnCrumble3D(pos, color);
    // Shrink + sink the original group over 300ms, then remove
    const startScale = obj.group.scale.x;
    const startY = obj.group.position.y;
    const startTime = performance.now();
    const dur = 300;
    const group = obj.group;
    const scene = this.scene;
    const tick = () => {
      const t = Math.min(1, (performance.now() - startTime) / dur);
      const ease = t * t;
      group.scale.setScalar(startScale * (1 - ease));
      group.position.y = startY - ease * 1.5;
      if (t < 1) requestAnimationFrame(tick);
      else scene.remove(group);
    };
    requestAnimationFrame(tick);
    delete this.buildingObjs[id];
  }

  _spawnCrumble3D(pos, colorHex) {
    if (!this._crumbleFragments) this._crumbleFragments = [];
    const baseColor = new THREE.Color(colorHex);
    const grey = new THREE.Color(0x777777);
    const count = 14;
    for (let i = 0; i < count; i++) {
      const s = (0.12 + Math.random() * 0.22);
      const geo = new THREE.BoxGeometry(s, s, s);
      const mat = new THREE.MeshLambertMaterial({
        color: baseColor.clone().lerp(grey, 0.3 + Math.random() * 0.4),
        transparent: true, opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.6,
        pos.y + Math.random() * 1.2,
        pos.z + (Math.random() - 0.5) * 0.6,
      );
      const angle = Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 4;
      mesh.userData = {
        vx: Math.cos(angle) * spd, vy: 4 + Math.random() * 5, vz: Math.sin(angle) * spd,
        rx: (Math.random() - 0.5) * 10, ry: (Math.random() - 0.5) * 10,
        age: 0, maxAge: 0.65 + Math.random() * 0.35,
      };
      this.scene.add(mesh);
      this._crumbleFragments.push(mesh);
    }
    // Expanding dust ring on the ground
    const ringGeo = new THREE.RingGeometry(0.01, 0.15, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xbbaa99, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.02, pos.z);
    ring.userData = { isDustRing: true, age: 0, maxAge: 0.6 };
    this.scene.add(ring);
    this._crumbleFragments.push(ring);
  }

  spawnDrop(drop) {
    const group = new THREE.Group();
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12),
      new THREE.MeshLambertMaterial({ color: 0xffd700 })
    );
    coin.rotation.x = Math.PI / 2;
    group.add(coin);
    const label = makeTextSprite('$' + (window.fmt ? window.fmt(drop.amount) : drop.amount));
    label.position.y = 0.45;
    group.add(label);

    // If the server tagged this drop with where it actually popped out from (an
    // owned income building), toss it from there to its landing spot instead of
    // just appearing — the "coin pops out of the dropper" Roblox-tycoon feel.
    const hasArc = drop.srcX !== undefined && drop.srcY !== undefined &&
                   (drop.srcX !== drop.x || drop.srcY !== drop.y);
    const startX = hasArc ? drop.srcX : drop.x;
    const startY = hasArc ? drop.srcY : drop.y;
    group.position.set(sx(startX), 0.4, sz(startY));
    this.scene.add(group);

    const obj = { group, data: { ...drop, x: startX, y: startY } };
    if (hasArc) {
      obj._arcT = 0; obj._arcDur = 0.55;
      obj._arcFromX = drop.srcX; obj._arcFromY = drop.srcY;
      obj._arcToX = drop.x; obj._arcToY = drop.y;
    }
    this.moneyDropObjs[drop.id] = obj;
  }

  removeDrop(id) {
    const obj = this.moneyDropObjs[id]; if (!obj) return;
    this.scene.remove(obj.group);
    delete this.moneyDropObjs[id];
  }

  spawnCollectorHole() {
    if (this._collectorHole) return;
    const p = this.myPlayer;
    if (!p || p.padIdx === undefined) return;
    const pad = PADS_DATA[p.padIdx]; if (!pad) return;
    const cx = sx(pad.x + PAD_SIZE / 2);
    const cz = sz(pad.y + PAD_SIZE / 2);

    const group = new THREE.Group();

    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(sx(50), 32),
      new THREE.MeshBasicMaterial({ color: 0x110022, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    );
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = 0.02;
    group.add(disk);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(sx(48), sx(56), 32),
      new THREE.MeshBasicMaterial({ color: 0x9b59b6, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(sx(20), sx(26), 24),
      new THREE.MeshBasicMaterial({ color: 0xe056fd, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.05;
    group.add(innerRing);

    group.position.set(cx, 0, cz);
    this.scene.add(group);
    this._collectorHole = group;
    this._collectorHolePos = { x: pad.x + PAD_SIZE / 2, y: pad.y + PAD_SIZE / 2 };
  }

  showBite(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    obj.group.scale.set(1.08 * DINO_SCALE, 1.08 * DINO_SCALE, 1.15 * DINO_SCALE);
    setTimeout(() => { obj.group.scale.setScalar(DINO_SCALE); }, 160);
    if (obj.armPivots) { obj._armSwinging = true; obj._armSwingT = 0; }
  }

  showHitAnim(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    // Turn red
    obj.group.traverse(o => { if (o.isMesh) o.material.color.set(0xff1111); });
    obj.group.scale.set(0.88 * DINO_SCALE, 1.12 * DINO_SCALE, 0.88 * DINO_SCALE);
    clearTimeout(obj._hitT1); clearTimeout(obj._hitT2);
    obj._hitT1 = setTimeout(() => obj.group.scale.set(1.1 * DINO_SCALE, 0.9 * DINO_SCALE, 1.1 * DINO_SCALE), 60);
    obj._hitT2 = setTimeout(() => {
      obj.group.scale.setScalar(DINO_SCALE);
      // Always restore from the snapshot taken at spawn, never from current (red) state
      const oc = obj.group.userData.origColors;
      if (oc) obj.group.traverse(o => { if (o.isMesh && oc.has(o.uuid)) o.material.color.copy(oc.get(o.uuid)); });
    }, 140);
  }

  showHitEffect(x, y, colorHex) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.7 }));
    flash.position.set(sx(x), 1.0, sz(y));
    this.scene.add(flash);
    let t = 0;
    const tick = () => {
      t += 1; flash.scale.multiplyScalar(1.12); flash.material.opacity *= 0.85;
      if (t < 10) requestAnimationFrame(tick); else this.scene.remove(flash);
    };
    requestAnimationFrame(tick);
  }

  showChargeTrail(fromX, fromY, toX, toY, colorHex) {
    const col = new THREE.Color(colorHex || '#ffffff');
    const dx = (toX - fromX) * WU, dz = (toY - fromY) * WU;
    const len = Math.hypot(dx, dz); if (len < 0.01) return;
    const angle = -Math.atan2(dz, dx);
    const midX = sx((fromX + toX) / 2), midZ = sz((fromY + toY) / 2);
    // Main wide trail
    const mats = [], meshes = [];
    const widths = [0.7, 0.35, 0.18];
    const opacities = [0.9, 0.65, 0.4];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: opacities[i] });
      const geo = new THREE.BoxGeometry(len, widths[i] * WU, widths[i] * WU);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(midX, (0.3 + i * 0.15) * WU, midZ);
      mesh.rotation.y = angle;
      this.scene.add(mesh);
      mats.push(mat); meshes.push({ mesh, geo });
    }
    const t0 = Date.now();
    const fade = () => {
      const t = (Date.now() - t0) / 380;
      if (t >= 1) {
        meshes.forEach(({ mesh, geo }) => { this.scene.remove(mesh); geo.dispose(); });
        mats.forEach(m => m.dispose());
        return;
      }
      mats.forEach((m, i) => { m.opacity = opacities[i] * (1 - t); });
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  showRoarRing(x, y, range, colorHex) {
    const col = new THREE.Color(colorHex || '#ff6b6b');
    const maxR = range * WU;
    // Three concentric rings staggered in time for a shockwave feel
    const rings = [
      { delay: 0,   duration: 550, maxScale: maxR,        opacity: 1.0  },
      { delay: 70,  duration: 650, maxScale: maxR * 1.35, opacity: 0.75 },
      { delay: 140, duration: 780, maxScale: maxR * 1.75, opacity: 0.50 },
      { delay: 220, duration: 950, maxScale: maxR * 2.2,  opacity: 0.28 },
    ];
    for (const cfg of rings) {
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide });
      const geo = new THREE.RingGeometry(0.01, 1, 64);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(sx(x), 0.12 * WU, sz(y));
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      const t0 = Date.now() + cfg.delay;
      const expand = () => {
        const elapsed = Date.now() - t0;
        if (elapsed < 0) { requestAnimationFrame(expand); return; }
        const t = Math.min(1, elapsed / cfg.duration);
        const ease = 1 - Math.pow(1 - t, 2); // ease-out quad
        mesh.scale.set(cfg.maxScale * ease, cfg.maxScale * ease, 1);
        mat.opacity = cfg.opacity * (1 - t);
        if (t >= 1) { this.scene.remove(mesh); geo.dispose(); mat.dispose(); return; }
        requestAnimationFrame(expand);
      };
      requestAnimationFrame(expand);
    }
    // Ground flash — brief bright disc at centre
    const flashMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const flashGeo = new THREE.CircleGeometry(maxR * 0.7, 64);
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.set(sx(x), 0.08 * WU, sz(y));
    flashMesh.rotation.x = -Math.PI / 2;
    this.scene.add(flashMesh);
    const ft0 = Date.now();
    const flashFade = () => {
      const t = Math.min(1, (Date.now() - ft0) / 400);
      flashMat.opacity = 0.9 * (1 - t);
      if (t >= 1) { this.scene.remove(flashMesh); flashGeo.dispose(); flashMat.dispose(); return; }
      requestAnimationFrame(flashFade);
    };
    requestAnimationFrame(flashFade);
  }

  // Hard-mode meteor strike — a falling glowing sphere lands at (x,y), leaves a
  // fading scorch ring sized to the actual damage radius, and shakes the camera
  // if the local player was standing inside the blast.
  showMeteorStrike(x, y, radius) {
    const startY = 30;
    const meteor = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4400 })
    );
    meteor.position.set(sx(x), startY, sz(y));
    const light = new THREE.PointLight(0xff6600, 3, 15);
    meteor.add(light);
    this.scene.add(meteor);

    const fallDuration = 700;
    const startTime = performance.now();
    const fall = () => {
      const t = Math.min((performance.now() - startTime) / fallDuration, 1);
      meteor.position.y = startY * (1 - t);
      meteor.rotation.x += 0.3; meteor.rotation.y += 0.2;
      if (t < 1) { requestAnimationFrame(fall); return; }
      this.scene.remove(meteor);
      this.showHitEffect(x, y, 0xff6600);
      window.SFX?.crunch();

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.1, Math.max(0.2, radius * WU), 24),
        new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sx(x), 0.05, sz(y));
      this.scene.add(ring);
      let rt = 0;
      const fade = () => {
        rt += 1; ring.material.opacity *= 0.88; ring.scale.multiplyScalar(1.03);
        if (rt < 25) requestAnimationFrame(fade); else this.scene.remove(ring);
      };
      requestAnimationFrame(fade);

      if (this.myPlayer && Math.hypot(this.myPlayer.x - x, this.myPlayer.y - y) < radius) {
        this._shakeUntil = performance.now() + 400;
      }
    };
    requestAnimationFrame(fall);
  }

  showLaser(fromX, fromY, toX, toY) {
    const start = new THREE.Vector3(sx(fromX), 1.05, sz(fromY));
    const end   = new THREE.Vector3(sx(toX),   1.05, sz(toY));
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length(); if (len < 0.01) return;
    const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.95 });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.lerpVectors(start, end, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(beam);
    let t = 0;
    const fade = () => {
      beam.material.opacity *= 0.78;
      if (++t < 10) requestAnimationFrame(fade); else this.scene.remove(beam);
    };
    requestAnimationFrame(fade);
  }

  showDamageNum(x, y, amount) {
    const big = amount >= 30;
    const size = big ? 48 : 32;
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = `bold ${size}px Segoe UI`; ctx.textAlign = 'center';
    ctx.fillStyle = big ? '#ffdd00' : '#ff5555';
    ctx.strokeStyle = '#000'; ctx.lineWidth = big ? 6 : 4;
    ctx.strokeText('-' + amount, 64, 44); ctx.fillText('-' + amount, 64, 44);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    spr.scale.set(big ? 0.14 : 0.1, big ? 0.065 : 0.05, 1);
    spr.position.set(sx(x), 1.8 + (big ? 0.3 : 0), sz(y));
    this.scene.add(spr);
    let t = 0;
    const tick = () => {
      t++; spr.position.y += big ? 0.018 : 0.012; spr.material.opacity = 1 - t / 42;
      if (t < 42) requestAnimationFrame(tick); else this.scene.remove(spr);
    };
    requestAnimationFrame(tick);
  }

  showKillExplosion(x, y, colorHex) {
    const col = new THREE.Color(colorHex || '#ff4444');
    const count = 18;
    for (let i = 0; i < count; i++) {
      const size = 0.06 + Math.random() * 0.1;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(size, 4, 4),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffdd00 : col, transparent: true, opacity: 1 })
      );
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = 0.06 + Math.random() * 0.1;
      m.position.set(sx(x), 0.8 + Math.random() * 0.8, sz(y));
      this.scene.add(m);
      const vx = Math.cos(angle) * spd, vz = Math.sin(angle) * spd, vy = 0.04 + Math.random() * 0.06;
      let t = 0;
      const tick = () => {
        t += 1; m.position.x += vx; m.position.y += vy - t * 0.003; m.position.z += vz;
        m.material.opacity = 1 - t / 35;
        if (t < 35) requestAnimationFrame(tick); else this.scene.remove(m);
      };
      requestAnimationFrame(tick);
    }
    // Big flash ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.5, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(sx(x), 0.05, sz(y));
    this.scene.add(ring);
    let rt = 0;
    const rtick = () => {
      rt += 1; ring.scale.setScalar(1 + rt * 0.18); ring.material.opacity = 0.9 * (1 - rt / 20);
      if (rt < 20) requestAnimationFrame(rtick); else this.scene.remove(ring);
    };
    requestAnimationFrame(rtick);
  }

  showCoinSparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 1 })
      );
      const angle = (i / 8) * Math.PI * 2;
      m.position.set(sx(x), 0.6, sz(y));
      this.scene.add(m);
      const vx = Math.cos(angle) * 0.04, vz = Math.sin(angle) * 0.04;
      let t = 0;
      const tick = () => {
        t++; m.position.x += vx; m.position.y += 0.025 - t * 0.002; m.position.z += vz;
        m.material.opacity = 1 - t / 20;
        if (t < 20) requestAnimationFrame(tick); else this.scene.remove(m);
      };
      requestAnimationFrame(tick);
    }
  }

  showRangeIndicator(x, y) {
    window.showToast?.('⚔️ Too far!', 1200);
  }

  dispose() {
    this._stopped = true;
    this.renderer.dispose();
    if (this._onPointerLockChange) document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    const btn = document.getElementById('collectHoleBtn');
    if (btn) btn.style.display = 'none';
    const ch = document.getElementById('crosshair3d');
    if (ch) ch.style.display = 'none';
  }

  _animate() {
    if (this._stopped) return;
    requestAnimationFrame(this._animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
    this._lastFrame = now;
    this.update(dt);

    // Main world pass — uses the player's chosen FOV
    this.renderer.render(this.scene, this.camera);

    // View-model pass — fixed-FOV camera mirrors the main camera's pose so the
    // first-person arms still follow look/bob, just without the wide-FOV distortion.
    // clearDepth() (not a full clear) lets the arms draw over the world without
    // erasing what was just rendered.
    this.viewmodelCamera.position.copy(this.camera.position);
    this.viewmodelCamera.quaternion.copy(this.camera.quaternion);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
    this.renderer.autoClear = true;
  }

  // Third-person camera collision: cast from the orbit pivot toward the desired
  // camera spot and pull the camera in if solid volcano geometry is in the way —
  // never let the view clip through into the mountain, the way a first-person
  // block game stops your camera at a wall instead of letting you peek past it.
  _camDistWithCollision(originX, originY, originZ, dirX, dirY, dirZ, desiredDist) {
    if (!this._volcanoCollidables.length) return desiredDist;
    this._camRaycaster.set({ x: originX, y: originY, z: originZ }, { x: dirX, y: dirY, z: dirZ });
    this._camRaycaster.far = desiredDist;
    const hits = this._camRaycaster.intersectObjects(this._volcanoCollidables, false);
    if (!hits.length) return desiredDist;
    return Math.max(0.6, hits[0].distance - 0.35);
  }

  update(dt) {
    if (typeof _paused !== 'undefined' && _paused) return;
    const phi = this.yawObject.rotation.y;     // mouse-controlled facing yaw (also the dino model's rotation.y)
    const pitch = this.pitchObject.rotation.x; // mouse-controlled camera pitch, clamped in setupInput

    // Smooth self knockback — ease-out cubic lerp toward knockback target
    if (this._kbDur > 0 && this.myPlayer) {
      this._kbT += dt;
      const t = Math.min(this._kbT / this._kbDur, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      this.myPlayer.x = this._kbFromX + (this._kbToX - this._kbFromX) * ease;
      this.myPlayer.y = this._kbFromY + (this._kbToY - this._kbFromY) * ease;
      if (t >= 1) this._kbDur = 0;
    }

    // Smooth charge glide — ease-out quint for a fast-then-decelerate feel
    if (this._chargeAnim && this.myPlayer) {
      const { fromX, fromY, toX, toY, startTime, duration } = this._chargeAnim;
      const t = Math.min(1, (Date.now() - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 5); // ease-out quint — very fast start, smooth stop
      this.myPlayer.x = fromX + (toX - fromX) * ease;
      this.myPlayer.y = fromY + (toY - fromY) * ease;
      if (t >= 1) { this._chargeAnim = null; this.myPlayer.x = toX; this.myPlayer.y = toY; }
    }

    if (this.myPlayer && this.myId && !this.myPlayer.isDead && this._countdown <= 0) {
      const speed = (this.myPlayer.speed || 260) * WU;
      // forward/right use the SAME convention as the dino model's facing (rotation.y = phi
      // means the model's front points toward (sin(phi), cos(phi)) in x,z)
      const forward = { x: Math.sin(phi), z: Math.cos(phi) };
      const right   = { x: -Math.cos(phi), z: Math.sin(phi) };
      let mx = 0, mz = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += forward.x; mz += forward.z; }
      if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= forward.x; mz -= forward.z; }
      if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= right.x; mz -= right.z; }
      if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += right.x; mz += right.z; }
      const mlen = Math.hypot(mx, mz);
      this._isWalking = mlen > 0.001;
      if (this._isWalking) this._walkPhase += dt * 8;
      if (mlen > 0.001) {
        mx /= mlen; mz /= mlen;
        let nx = sx(this.myPlayer.x) + mx * speed * dt;
        let nz = sz(this.myPlayer.y) + mz * speed * dt;
        const W = WORLD_SIZE * WU;
        nx = Math.max(0.5, Math.min(W - 0.5, nx));
        nz = Math.max(0.5, Math.min(W - 0.5, nz));

        // Wall collision (server units for comparison)
        const sxToServer = nx / WU, szToServer = nz / WU;
        const blocked = Object.values(this.buildingObjs).find(b => {
          if (!WALL_TYPES.includes(b.data.upgradeId) || b.data.hp <= 0 || b.data.ownerId === this.myId) return false;
          const isH = (b.data.orientation || 'h') === 'h';
          const hw = isH ? 28 : 9, hh = isH ? 9 : 28;
          return Math.abs(sxToServer - b.data.x) < hw && Math.abs(szToServer - b.data.y) < hh;
        });
        // Crater rim acts as a low wall — walking into/out of it is blocked, same as
        // a building wall, but jumping (space bar) lets you clear it, the way hopping
        // over a ledge would. Only the CROSSING is blocked; once you've landed inside
        // (or are already outside), normal grounded movement resumes.
        const craterCX = sx(VOLCANO_CX_SRV), craterCZ = sz(VOLCANO_CZ_SRV);
        const ventTopR = VOLCANO_CRATER_R * 0.90;
        const oldD = Math.hypot(sx(this.myPlayer.x) - craterCX, sz(this.myPlayer.y) - craterCZ);
        const newD = Math.hypot(nx - craterCX, nz - craterCZ);
        const crossingRim = (oldD >= ventTopR) !== (newD >= ventTopR);
        const craterBlocked = crossingRim && this._jumpY <= 0;
        if (!blocked && !craterBlocked) {
          this.myPlayer.x = sxToServer; this.myPlayer.y = szToServer;
        }

        // theta is chosen so dirToRotY(theta) === phi, keeping other clients' rendering consistent
        const theta = Math.PI / 2 - phi;
        const now = performance.now();
        if (now - this.lastMoveEmit > 48) {
          window.gameSocket.emit('move', { x: this.myPlayer.x, y: this.myPlayer.y, dir: theta });
          this.lastMoveEmit = now;
        }
      }
    }

    // Own dino model + rear-view camera follow every frame (even when standing still,
    // since looking around with the mouse should still orbit the camera)
    if (this.myPlayer) {
      // Jump physics
      const wasAirborne = this._jumpY > 0;
      if (this._jumpVel !== 0 || this._jumpY > 0) {
        this._jumpVel -= 38 * dt; // gravity
        this._jumpY = Math.max(0, this._jumpY + this._jumpVel * dt);
        if (this._jumpY === 0 && wasAirborne) { this._jumpVel = 0; this._landSquashT = 0; } // just landed
      }
      const jY = this._jumpY;

      // Subtle squash-and-stretch: stretch tall while rising/falling fast, squash on landing
      let jumpScaleY = 1, jumpScaleXZ = 1;
      if (jY > 0) {
        const stretch = Math.max(-0.05, Math.min(0.07, this._jumpVel * 0.006));
        jumpScaleY = 1 + stretch; jumpScaleXZ = 1 - stretch * 0.5;
      } else if (this._landSquashT !== undefined && this._landSquashT < 0.12) {
        this._landSquashT += dt;
        const squash = (1 - this._landSquashT / 0.12) * 0.1;
        jumpScaleY = 1 - squash; jumpScaleXZ = 1 + squash * 0.5;
      }

      const myObj = this.playerObjs[this.myId];
      const px = sx(this.myPlayer.x), pz = sz(this.myPlayer.y);
      const terrainH = volcanoHeightAt(px, pz);
      if (myObj) {
        myObj.group.position.set(px, jY + terrainH, pz);
        if (myObj._dinoRotY === undefined) myObj._dinoRotY = phi;
        const _rd = phi - myObj._dinoRotY;
        const _rn = _rd - Math.round(_rd / (Math.PI * 2)) * (Math.PI * 2);
        const _maxStep = Math.PI * 6 * dt; // max 1080°/s — fast but physically bounded, never snaps
        myObj._dinoRotY += Math.max(-_maxStep, Math.min(_maxStep, _rn));
        myObj.group.rotation.y = myObj._dinoRotY;
        myObj.group.rotation.x = -pitch * 0.4;
        myObj.group.scale.set(jumpScaleXZ * DINO_SCALE, jumpScaleY * DINO_SCALE, jumpScaleXZ * DINO_SCALE);
        myObj.group.visible = !this.myPlayer.isDead;
        myObj.data.x = this.myPlayer.x; myObj.data.y = this.myPlayer.y;
      }
      const forwardCam = { x: Math.sin(phi), z: Math.cos(phi) };
      // Orbit camera around a point CAM_BASE_HEIGHT above the player at a constant
      // radius _cd, decomposed into horizontal/vertical spherical components. Scaling
      // pitchLift by a fixed 1.8 instead of _cd broke that: cos(pitch) shrinks the
      // horizontal offset toward 0 as you look straight up/down, but the vertical
      // offset barely grew to compensate, so the camera collapsed onto the player —
      // the "snapping" zoom when tilting the view.
      const _cd = (window.GAME_SETTINGS?.camDist ?? CAM_DISTANCE_DEFAULT) * WU * 24;
      const pitchLift = Math.sin(pitch) * _cd;
      const pitchPull = Math.cos(pitch);
      let shakeX = 0, shakeY = 0;
      if (this._shakeUntil && performance.now() < this._shakeUntil) {
        shakeX = (Math.random() - 0.5) * 0.12; shakeY = (Math.random() - 0.5) * 0.12;
      }

      const fp = this._camMode === 1;
      if (this._armL) { this._armL.visible = fp; this._armR.visible = fp; }

      // Arm animation — idle bob + attack swing
      const viewBobOn = window.GAME_SETTINGS?.viewBobbing !== false;
      if (fp && this._armL && this._armR) {
        const now3 = performance.now();
        const breathe = viewBobOn ? Math.sin(now3 * 0.0018) * 0.016 : 0;
        const walk    = viewBobOn ? Math.sin(now3 * 0.0042) : 0;

        if (this._armSwinging) {
          this._armSwingT += dt;
          const SWING_DUR = 0.25;
          const t = Math.min(this._armSwingT / SWING_DUR, 1);
          const sw = Math.sin(t * Math.PI); // 0 → peak → 0

          // Both arms swing up — shoulder stays fixed, rotation pivots the arm forward
          this._armR.position.set( 0.22, -0.32 + breathe, -0.55);
          this._armR.rotation.x = 0.18 - sw * 1.1;
          this._armL.position.set(-0.22, -0.32 + breathe, -0.55);
          this._armL.rotation.x = 0.18 - sw * 1.1;

          if (t >= 1) { this._armSwinging = false; this._armSwingT = 0; }
        } else {
          // Idle: breathe + gentle alternating walk sway (only when view bobbing is on)
          this._armR.position.set( 0.22, -0.32 + breathe + walk * 0.018, -0.55);
          this._armR.rotation.x = 0.18 + walk * 0.04;
          this._armL.position.set(-0.22, -0.32 + breathe - walk * 0.018, -0.55);
          this._armL.rotation.x = 0.18 - walk * 0.04;
        }
      }

      if (fp) {
        // ── First-person ─────────────────────────────────────────────────
        if (myObj) myObj.group.visible = false;
        // Suppress head-bob while airborne — combining the walk-bob sine wave with
        // the jump arc made jumping look jittery instead of a clean smooth curve
        const headBob = (viewBobOn && this._isWalking && jY === 0) ? Math.sin(this._walkPhase) * 0.038 : 0;
        const eyeH = 1.85 + jY + terrainH + headBob;
        this.camera.position.set(px + forwardCam.x * 0.25 + shakeX, eyeH + shakeY, pz + forwardCam.z * 0.25);
        const lx = px + forwardCam.x * Math.cos(pitch) * 10;
        const ly = eyeH - Math.sin(pitch) * 10;
        const lz = pz + forwardCam.z * Math.cos(pitch) * 10;
        this.camera.lookAt(lx, ly, lz);
      } else if (this._camMode === 2) {
        if (myObj) myObj.group.visible = !this.myPlayer.isDead;
        const pivotY = CAM_BASE_HEIGHT + terrainH;
        const dirX = forwardCam.x * pitchPull, dirY = Math.sin(pitch), dirZ = forwardCam.z * pitchPull;
        const dist = this._camDistWithCollision(px, pivotY, pz, dirX, dirY, dirZ, _cd);
        this.camera.position.set(
          px + dirX * dist + shakeX,
          pivotY + dirY * dist + shakeY + jY,
          pz + dirZ * dist
        );
        this.camera.lookAt(px, 1.3 + jY + terrainH, pz);
      } else {
        if (myObj) myObj.group.visible = !this.myPlayer.isDead;
        const pivotY = CAM_BASE_HEIGHT + terrainH;
        const dirX = -forwardCam.x * pitchPull, dirY = Math.sin(pitch), dirZ = -forwardCam.z * pitchPull;
        const dist = this._camDistWithCollision(px, pivotY, pz, dirX, dirY, dirZ, _cd);
        this.camera.position.set(
          px + dirX * dist + shakeX,
          pivotY + dirY * dist + shakeY + jY,
          pz + dirZ * dist
        );
        this.camera.lookAt(px, 1.3 + jY + terrainH, pz);
      }
    }

    // ── Volcano animations ────────────────────────────────────────────────────
    const nowMs = performance.now();

    // Lava texture flow animation
    if (this._lavaTex) {
      this._lavaTex.offset.x = (nowMs * 0.000058) % 1;
      this._lavaTex.offset.y = (nowMs * 0.000034) % 1;
    }
    // Crater light intensity pulse (simulates churning lava)
    if (this._volcanoLight) {
      this._volcanoLight.intensity = 9.0 + Math.sin(nowMs*0.0031)*2.5 + Math.sin(nowMs*0.0073)*1.5;
    }
    if (this._volcanoTopGlow) {
      this._volcanoTopGlow.intensity = 3.5 + Math.sin(nowMs*0.0019)*1.0 + Math.sin(nowMs*0.0051)*0.5;
    }

    // Smoke particles
    if (this._volcanoSmoke) {
      for (const sm of this._volcanoSmoke) {
        sm._smokeLife -= dt;
        if (sm._smokeLife <= 0) {
          // Reset particle
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * VOLCANO_CRATER_R * 0.7;
          sm._smokePX = sx(VOLCANO_CX_SRV) + Math.cos(angle) * r;
          sm._smokePZ = sz(VOLCANO_CZ_SRV) + Math.sin(angle) * r;
          sm._smokeVX = (Math.random() - 0.5) * 0.45;
          sm._smokeVZ = (Math.random() - 0.5) * 0.45;
          sm._smokeSpd  = 2.5 + Math.random() * 2.5;
          sm._smokeDur  = 5.0 + Math.random() * 8.0;
          sm._smokeLife = sm._smokeDur;
          sm.position.set(sm._smokePX, sm._smokeStartY, sm._smokePZ);
          sm.scale.setScalar(0.5);
        } else {
          const frac = 1 - sm._smokeLife / sm._smokeDur;
          sm.position.x = sm._smokePX + sm._smokeVX * frac * sm._smokeDur;
          sm.position.z = sm._smokePZ + sm._smokeVZ * frac * sm._smokeDur;
          sm.position.y = sm._smokeStartY + sm._smokeSpd * frac * sm._smokeDur;
          sm.scale.setScalar(0.5 + frac * 6.5);
          sm.material.opacity = frac < 0.15 ? frac / 0.15 * 0.65 : (frac > 0.72 ? (1 - frac) / 0.28 * 0.65 : 0.65);
        }
      }
    }

    // Burst particles (eruption plume)
    if (this._volcanoParticles) {
      const still = [];
      for (const p of this._volcanoParticles) {
        const age = (nowMs - p._born) / 1000;
        if (age >= p._life) { this.scene.remove(p); continue; }
        p.position.x += p._vx * dt;
        p.position.y += (p._vy + p._g * age) * dt;
        p.position.z += p._vz * dt;
        still.push(p);
      }
      this._volcanoParticles = still;
    }

    // Lava bombs in flight
    if (this._lavaBombsInFlight) {
      const flying = [];
      for (const ball of this._lavaBombsInFlight) {
        const t = Math.min((nowMs - ball._lbStart) / ball._lbTravel, 1);
        // Parabolic arc: quadratic in XZ, sine-bell in Y
        ball.position.x = ball._lbSX + (ball._lbTX - ball._lbSX) * t;
        ball.position.z = ball._lbSZ + (ball._lbTZ - ball._lbSZ) * t;
        const arcY = ball._lbSY + (ball._lbPeakY - ball._lbSY) * Math.sin(t * Math.PI);
        const landH = volcanoHeightAt(ball._lbTX, ball._lbTZ);
        ball.position.y = arcY + (landH - ball._lbSY) * t;
        ball.rotation.x += dt * 3; ball.rotation.z += dt * 2;
        if (t < 1) { flying.push(ball); }
        else { this.scene.remove(ball); }
      }
      this._lavaBombsInFlight = flying;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Auto-collect nearby drops
    if (this.myPlayer && !this.myPlayer.isDead) {
      for (const [id, drop] of Object.entries(this.moneyDropObjs)) {
        if (this._collectedRecently.has(id)) continue;
        if (Math.hypot(this.myPlayer.x - drop.data.x, this.myPlayer.y - drop.data.y) < PICKUP_RADIUS) {
          this._collectedRecently.add(id);
          window.gameSocket.emit('collectDrop', parseInt(id));
        }
      }
      // coin bob/spin + collector hole drift
      const holePos = this._collectorHolePos;
      const myPad = holePos && this.myPlayer?.padIdx !== undefined ? PADS_DATA[this.myPlayer.padIdx] : null;
      for (const obj of Object.values(this.moneyDropObjs)) {
        if (obj._arcT !== undefined) {
          // Mid-toss — fly from the source structure to the landing spot on an arc
          obj._arcT += dt;
          const t = Math.min(obj._arcT / obj._arcDur, 1);
          const ease = 1 - Math.pow(1 - t, 2);
          const nx = obj._arcFromX + (obj._arcToX - obj._arcFromX) * ease;
          const ny = obj._arcFromY + (obj._arcToY - obj._arcFromY) * ease;
          obj.data.x = nx; obj.data.y = ny;
          const arcHeight = Math.sin(t * Math.PI) * 1.1;
          obj.group.position.set(sx(nx), 0.4 + arcHeight, sz(ny));
          obj.group.rotation.z += dt * 6;
          if (t >= 1) delete obj._arcT;
          continue;
        }
        if (holePos && myPad) {
          const onPad = obj.data.x >= myPad.x && obj.data.x <= myPad.x + PAD_SIZE &&
                        obj.data.y >= myPad.y && obj.data.y <= myPad.y + PAD_SIZE;
          if (onPad) {
            const dx = holePos.x - obj.data.x;
            const dz = holePos.y - obj.data.y;
            const d = Math.hypot(dx, dz);
            if (d > 8) {
              const spd = Math.min(d, 350 * dt);
              obj.data.x += (dx / d) * spd;
              obj.data.y += (dz / d) * spd;
              obj.group.position.x = sx(obj.data.x);
              obj.group.position.z = sz(obj.data.y);
            }
          }
        }
        obj.group.rotation.z += dt * 2;
        obj.group.position.y = 0.4 + Math.sin(performance.now() * 0.003) * 0.05;
      }
      // animate collector hole rings + float Collect button above hole in screen space
      const btn = document.getElementById('collectHoleBtn');
      if (this._collectorHole) {
        this._collectorHole.children[1].rotation.z += dt * 1.2;
        this._collectorHole.children[2].rotation.z -= dt * 2.0;
        if (btn) {
          const wp = new THREE.Vector3();
          this._collectorHole.getWorldPosition(wp);
          wp.y += 3.5; // float well above the hole
          const p = wp.clone().project(this.camera);
          if (p.z < 1) { // in front of camera
            btn.style.left = ((p.x * 0.5 + 0.5) * window.innerWidth) + 'px';
            btn.style.top  = ((-p.y * 0.5 + 0.5) * window.innerHeight) + 'px';
            btn.style.display = 'block';
          } else {
            btn.style.display = 'none';
          }
        }
      } else {
        if (btn) btn.style.display = 'none';
      }
    }

    // Walk animation + world arm swing for all players
    for (const [id, obj] of Object.entries(this.playerObjs)) {
      // Smooth knockback lerp for this player (ease-out cubic) takes priority
      if (obj._kbDur > 0) {
        obj._kbT += dt;
        const t = Math.min(obj._kbT / obj._kbDur, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const nx = obj._kbFromX + (obj._kbToX - obj._kbFromX) * ease;
        const ny = obj._kbFromY + (obj._kbToY - obj._kbFromY) * ease;
        this.setPos(id, nx, ny);
        if (t >= 1) obj._kbDur = 0;
      } else if (id !== this.myId && obj._chargeAnim) {
        // Dedicated charge glide for other players — same ease-out quint
        const { fromX, fromY, toX, toY, startTime, duration } = obj._chargeAnim;
        const t = Math.min(1, (Date.now() - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 5);
        obj.group.position.set(sx(fromX + (toX - fromX) * ease), 0, sz(fromY + (toY - fromY) * ease));
        if (t >= 1) obj._chargeAnim = null;
      } else if (id !== this.myId && obj._netTargetX !== undefined) {
        // Smoothly ease the visual model toward the latest network position/rotation
        // instead of snapping every ~50ms server tick — removes the "glitchy" teleport look
        const tx = sx(obj._netTargetX), tz = sz(obj._netTargetY);
        const smooth = 1 - Math.pow(0.0001, dt); // frame-rate independent exponential smoothing
        obj.group.position.x += (tx - obj.group.position.x) * smooth;
        obj.group.position.z += (tz - obj.group.position.z) * smooth;
        if (obj._netTargetDir !== undefined) {
          const targetRotY = dirToRotY(obj._netTargetDir);
          let diff = ((targetRotY - obj.group.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          obj.group.rotation.y += diff * smooth;
        }
      }

      if (id !== this.myId) {
        const moved = obj._lastX !== undefined ? Math.hypot(obj.data.x - obj._lastX, obj.data.y - obj._lastY) : 0;
        obj._lastX = obj.data.x; obj._lastY = obj.data.y;
        if (moved > 0.3) {
          obj.walkPhase = (obj.walkPhase + moved * 0.18) % (Math.PI * 2);
          window.animateDinoWalk(obj.group, obj.walkPhase);
        } else {
          window.animateDinoWalk(obj.group, 0);
        }
      }

      // World-space arm swing animation (visible to all players)
      if (obj._armSwinging && obj.armPivots) {
        obj._armSwingT += dt;
        const t = Math.min(obj._armSwingT / 0.3, 1);
        const sw = Math.sin(t * Math.PI);
        for (const pivot of obj.armPivots) pivot.rotation.x = -sw * 0.85;
        if (t >= 1) {
          obj._armSwinging = false; obj._armSwingT = 0;
          for (const pivot of obj.armPivots) pivot.rotation.x = 0;
        }
      }
    }

    // Drifting clouds
    if (this._clouds) {
      const W = WORLD_SIZE * WU;
      for (const c of this._clouds) {
        c.position.x += c._cloudSpeed * dt;
        if (c.position.x > W + 15) c.position.x = -15;
      }
    }

    // Hit wobble — brief roll of local player model on taking damage
    if (this._hitWobble !== undefined) {
      const myObj = this.playerObjs[this.myId];
      const elapsed = performance.now() - this._hitWobble;
      const dur = 380;
      if (elapsed < dur) {
        if (myObj) myObj.group.rotation.z = Math.sin((elapsed / dur) * Math.PI * 3) * (1 - elapsed / dur) * 0.28;
      } else {
        if (myObj) myObj.group.rotation.z = 0;
        this._hitWobble = undefined;
      }
    }

    // Crumble fragments from destroyed buildings
    if (this._crumbleFragments?.length) {
      const GRAVITY = 16;
      const dead = [];
      for (const f of this._crumbleFragments) {
        f.userData.age += dt;
        const t = f.userData.age / f.userData.maxAge;
        if (t >= 1) { dead.push(f); continue; }
        if (f.userData.isDustRing) {
          const s = 1 + t * 8;
          f.scale.set(s, s, s);
          f.material.opacity = 0.7 * (1 - t);
        } else {
          f.userData.vy -= GRAVITY * dt;
          f.position.x += f.userData.vx * dt;
          f.position.y += f.userData.vy * dt;
          f.position.z += f.userData.vz * dt;
          f.rotation.x += f.userData.rx * dt;
          f.rotation.y += f.userData.ry * dt;
          f.material.opacity = 1 - t * t;
        }
      }
      for (const f of dead) {
        this.scene.remove(f);
        this._crumbleFragments.splice(this._crumbleFragments.indexOf(f), 1);
      }
    }
  }
}

// ── Bootstrapping — same global names the lobby expects (loadGameScripts callback) ──
function startPhaserGame(readyCb) {
  const container = document.getElementById('gameContainer');
  container.innerHTML = '';
  const engine = new Game3D(container);
  window._game3D = engine;
  window._gameScene = engine;
  window._gameReady = true;
  // Call the per-mode readyCb (not window.onGameReady which may be overwritten by the other engine)
  if (readyCb && window._pendingGameData) readyCb(window._pendingGameData);
}
window.startPhaserGame = startPhaserGame;

window.onGameReady = function (data) {
  const s = window._gameScene;

  for (const id of Object.keys(s.playerObjs || {})) s.removePlayer(id);
  for (const id of Object.keys(s.moneyDropObjs || {})) s.removeDrop(id);
  for (const id of Object.keys(s.buildingObjs || {})) s.removeBuilding(id);
  s.playerObjs = {}; s.moneyDropObjs = {}; s.buildingObjs = {};
  s._collectedRecently = new Set();
  if (s._collectorHole) { s.scene.remove(s._collectorHole); s._collectorHole = null; s._collectorHolePos = null; }

  s.applyMapTheme(data.map || 'jungle');

  s.myId = data.myPlayer.id;
  s.myPlayer = data.myPlayer;
  s.myBaseX = data.myPlayer.x; // store pad spawn position for death camera
  s.myBaseY = data.myPlayer.y;
  s._countdown = 5;
  if (s._armMat) {
    // Match the same color the dino body actually renders with — not just the raw
    // player.color, which ignores an equipped skin/custom skin override and caused
    // the arms to show the wrong color (e.g. pink arms on a green-skinned dino).
    const mp = data.myPlayer;
    const armColor = mp.customSkin ? '#4caf50' : (mp.skinColor || mp.color);
    if (armColor) s._armMat.color.set(armColor);
  }

  s.spawnPlayer(data.myPlayer);
  for (const p of data.allPlayers) if (p.id !== data.myPlayer.id) s.spawnPlayer(p);
  for (const b of data.allBots) s.spawnPlayer(b);
  for (const b of (data.buildings || [])) s.spawnBuilding(b);
  if (data.myPlayer.upgrades?.includes('collectorsHole')) s.spawnCollectorHole();

  window.updateHUD(data.myPlayer);
  window.updateXPBar(data.myPlayer.xp, data.myPlayer.level);
  window.buildShop(data.upgrades, data.myPlayer.upgrades);
  const diffLabel = { easy: '🌿 Easy', medium: '⚔️ Medium', hard: '☄️ Hard' }[data.difficulty] || '';
  window.showToast(`🦕 ${data.myPlayer.username} — ${diffLabel} mode! Build your Dino Empire!`, 4000);
  setTimeout(() => window.SFX?.start(), 300);

  if (!window._gameSocketEventsSetup) {
    window._gameSocketEventsSetup = true;
    setupGameSocketEvents();
  }
};

function setupGameSocketEvents() {
  const s = window.gameSocket;
  // Only return the scene when we're actually in 3D mode — prevents 3D handlers
  // from firing on the Phaser scene after a mode switch.
  const gs = () => { const sc = window._gameScene; return sc?._is3D ? sc : null; };

  s.on('playerJoined', p => {
    const scene = gs(); if (!scene) return;
    scene.spawnPlayer(p);
    window.showToast(`🦕 ${p.username} joined!`);
    window.addChatMessage('🌿 System', `${p.username} entered the jungle!`, '#88aa88');
  });

  s.on('playerLeft', id => {
    const scene = gs(); if (!scene) return;
    const u = scene.playerObjs[id]?.data?.username || 'A dinosaur';
    scene.removePlayer(id);
    window.addChatMessage('🌿 System', `${u} left.`, '#88aa88');
  });

  s.on('playerMoved', ({ id, x, y, dir }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[id]; if (!obj) return;
    scene.setNetPos(id, x, y, dir || 0);
  });

  s.on('botPositions', positions => {
    const scene = gs(); if (!scene) return;
    for (const { id, x, y } of positions) {
      const obj = scene.playerObjs[id]; if (!obj) continue;
      const dir = Math.atan2(y - obj.data.y, x - obj.data.x);
      scene.setNetPos(id, x, y, dir);
    }
  });

  s.on('attackResult', ({ attackerId, targetId, damage, targetHp, targetMaxHp, knockback, combo }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[targetId]; if (!tgt) return;
    tgt.data.hp = targetHp; tgt.data.maxHp = targetMaxHp;
    redrawHPSprite(tgt.hpSprite, targetHp, targetMaxHp);
    const predicted = attackerId === scene.myId && scene._lastAttackTargetId === targetId;
    if (predicted) scene._lastAttackTargetId = null;
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    scene.showHitAnim(targetId);
    if (!predicted) {
      scene.showHitEffect(tgt.data.x, tgt.data.y, hexStr2num(tgt.data.color || '#ffffff'));
      scene.showBite(attackerId);
      const atk = scene.playerObjs[attackerId];
      if (atk) scene.showLaser(atk.data.x, atk.data.y, tgt.data.x, tgt.data.y);
    }
    // Always apply authoritative knockback — smoothly lerped (Minecraft-style ease-out)
    if (knockback) {
      const KB_DUR = 0.22;
      if (targetId === scene.myId) {
        scene._kbFromX = scene.myPlayer.x; scene._kbFromY = scene.myPlayer.y;
        scene._kbToX = knockback.x; scene._kbToY = knockback.y;
        scene._kbT = 0; scene._kbDur = KB_DUR;
        scene._hitWobble = performance.now();
        if ((window.GAME_SETTINGS || {}).cameraShake !== false)
          scene._shakeUntil = performance.now() + 200;
      } else {
        const kbObj = scene.playerObjs[targetId];
        if (kbObj) {
          kbObj._kbFromX = kbObj.data.x; kbObj._kbFromY = kbObj.data.y;
          kbObj._kbToX = knockback.x; kbObj._kbToY = knockback.y;
          kbObj._kbT = 0; kbObj._kbDur = KB_DUR;
        }
      }
    }
    if (targetId === scene.myId) window.updateHUD(scene.myPlayer);
    window.SFX?.hit();
  });

  s.on('playerDied', ({ victimId, killerId, cause, loot, killerMoney }) => {
    const scene = gs(); if (!scene) return;
    const victim = scene.playerObjs[victimId];
    const killer = scene.playerObjs[killerId];
    if (victim) {
      if ((window.GAME_SETTINGS?.killExplosions) !== false) scene.showKillExplosion(victim.data.x, victim.data.y, victim.data.color);
      victim.data.isDead = true; victim.group.visible = false;
    }
    if (victimId === scene.myId) {
      scene.myPlayer.isDead = true;
      // Move camera to base immediately so player watches their base while waiting to respawn
      if (scene.myBaseX !== undefined) { scene.myPlayer.x = scene.myBaseX; scene.myPlayer.y = scene.myBaseY; }
      window.SFX?.death();
      // Show death screen with respawn countdown (same as 2D mode)
      document.getElementById('deathScreen').classList.add('active');
      document.getElementById('deathMsg').textContent = 'Respawning 5...';
      let _sec = 5;
      const _iv = setInterval(() => {
        _sec--;
        if (_sec > 0) {
          document.getElementById('deathMsg').textContent = `Respawning ${_sec}...`;
          window.SFX?.countdown?.();
        } else { clearInterval(_iv); }
      }, 1000);
    } else {
      window.SFX?.kill();
    }
    if (killer && killerId === scene.myId) {
      scene.myPlayer.money = killerMoney;
      window.updateHUD(scene.myPlayer);
      const vName = victim?.data?.username || 'enemy';
      if ((window.GAME_SETTINGS?.killBannerOn) !== false) window.showKillBanner?.(`☠️ ${vName} eliminated! +$${loot}`);
    }
    const vName = victim?.data?.username || 'A dinosaur';
    const kName = killer?.data?.username || 'something';
    const vc = victim?.data?.color || '#ccc';
    const kc = killer?.data?.color || '#fff';
    const kIsBot = killer?.data?.isBot, vIsBot = victim?.data?.isBot;
    if (killerId === null) {
      if (cause === 'heat') {
        window.addKillFeed?.(`🌋 <span style="color:${vc}">${vName}</span> was incinerated by the volcano!`);
        window.addChatMessage?.('🌋 Volcano', `${vName} jumped into the volcano!`, '#ff4400');
      } else if (cause === 'lava') {
        window.addKillFeed?.(`🌋 <span style="color:${vc}">${vName}</span> was obliterated by a lava bomb!`);
        window.addChatMessage?.('🌋 Volcano', `${vName} was hit by a lava bomb!`, '#ff5500');
      } else {
        window.addKillFeed?.(`☄️ <span style="color:${vc}">${vName}</span> was struck by a meteor!`);
        window.addChatMessage?.('☄️ Meteor', `${vName} was struck by a meteor!`, '#ff6600');
      }
    } else if (victimId === killerId) {
      window.addKillFeed?.(`☠️ <span style="color:${vc}">${vName}</span> perished`);
      window.addChatMessage?.('⚔️ Arena', `☠️ ${vName} perished`, '#a29bfe');
    } else {
      window.addKillFeed?.(`<span style="color:${kc}">${kName}</span> ☄️ <span style="color:${vc}">${vName}</span> <span style="color:#ffd700">(+$${loot})</span>`);
      const KILL_MSGS = [
        (k,v)=>`🦷 ${k} chomped ${v} into fossils!`,
        (k,v)=>`☄️ ${k} sent ${v} back to the Cretaceous!`,
        (k,v)=>`💀 ${v} is now extinct — eliminated by ${k}!`,
        (k,v)=>`🦴 ${k} turned ${v} into a bone pile!`,
        (k,v)=>`🌋 ${k} obliterated ${v}!`,
        (k,v)=>`🦖 ${k} devoured ${v} whole!`,
      ];
      const msg = KILL_MSGS[Math.floor(Math.random() * KILL_MSGS.length)](kName, vName);
      const chatColor = kIsBot && vIsBot ? '#a29bfe' : kIsBot ? '#ff7675' : '#ffd700';
      window.addChatMessage?.('⚔️ Arena', msg, chatColor);
    }
  });

  s.on('chargeResult', ({ playerId, fromX, fromY, toX, toY }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[playerId];
    const color = obj?.data?.color || '#ffffff';
    if (playerId === scene.myId && scene.myPlayer) {
      // Smooth glide — animation runs in update() each frame
      scene._chargeAnim = { fromX, fromY, toX, toY, startTime: Date.now(), duration: 220 };
      scene._camShake = 0.2;
    } else if (obj) {
      // Other players: dedicated per-obj charge anim for their group
      obj._chargeAnim = { fromX, fromY, toX, toY, startTime: Date.now(), duration: 220 };
      obj.data.x = toX; obj.data.y = toY;
      obj._netTargetX = toX; obj._netTargetY = toY;
    }
    scene.showChargeTrail(fromX, fromY, toX, toY, color);
  });

  s.on('roarResult', ({ playerId, x, y, range }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[playerId];
    scene.showRoarRing(x, y, range, obj?.data?.color || '#ff6b6b');
    // Strong camera shake for anyone nearby
    if (scene.myPlayer) {
      const distToRoar = Math.hypot(scene.myPlayer.x - x, scene.myPlayer.y - y);
      const shakeMag = Math.max(0, 1 - distToRoar / (range * 2));
      if (shakeMag > 0) {
        scene._camShake = 1.2 * shakeMag;
        // Screen flash overlay
        const flash = document.createElement('div');
        Object.assign(flash.style, {
          position:'fixed', inset:'0', zIndex:'99998', pointerEvents:'none',
          background: obj?.data?.color || '#ff4444',
          opacity: String(0.25 * shakeMag), transition:'opacity 0.4s ease',
        });
        document.body.appendChild(flash);
        requestAnimationFrame(() => { flash.style.opacity = '0'; });
        setTimeout(() => flash.remove(), 500);
      }
    }
  });

  s.on('prestigeSuccess', ({ prestige, speed, damage, defense, maxHp, hp, mps, regen, incomeBonus, milestone }) => {
    const scene = gs(); if (!scene || !scene.myPlayer) return;
    Object.assign(scene.myPlayer, { prestige, money: 0, upgrades: [], speed, damage, defense, maxHp, hp, mps, regen });
    window.updateHUD?.(scene.myPlayer);
    window.buildShop?.(window._allUpgrades, []);
    const obj = scene.playerObjs[scene.myId];
    if (obj) {
      if (!obj._presLabel) {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 20;
        const ctx = canvas.getContext('2d'); ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center'; ctx.fillText(`★${prestige}`, 32, 14);
        const tex = new THREE.CanvasTexture(canvas);
        obj._presLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        obj._presLabel.scale.set(1.2 * WU * 24, 0.4 * WU * 24, 1);
        obj.group.add(obj._presLabel);
      }
      obj._presLabel.position.y = 3.2 * WU * 24;
    }
    window.showToast?.(`⭐ PRESTIGE ${prestige}! +${incomeBonus || 0}% income bonus!`, 4000);
    if (milestone) setTimeout(() => window.showToast?.(`🎁 ${milestone}`, 4000), 1600);
  });

  s.on('playerRespawned', ({ id, x, y, hp, maxHp }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[id]; if (!obj) return;
    obj.data.isDead = false; obj.data.hp = hp; obj.data.maxHp = maxHp;
    obj.group.visible = id !== scene.myId;
    redrawHPSprite(obj.hpSprite, hp, maxHp);
    scene.setPos(id, x, y);
    if (id === scene.myId) {
      scene.myPlayer.isDead = false; scene.myPlayer.hp = hp; scene.myPlayer.maxHp = maxHp;
      scene.myPlayer.x = x; scene.myPlayer.y = y; // teleport camera to respawn point
      document.getElementById('deathScreen').classList.remove('active');
      window.updateHUD(scene.myPlayer);
    }
  });

  s.on('buildingPlaced', b => { const scene = gs(); if (scene) scene.spawnBuilding(b); window.SFX?.upgrade(); });

  s.on('buildingDamaged', ({ id, hp, maxHp, damage }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.buildingObjs[id]; if (!obj) return;
    obj.data.hp = hp;
    redrawHPSprite(obj.hpSprite, hp, maxHp);
    scene.showDamageNum(obj.data.x, obj.data.y, damage);
  });

  s.on('meteorStrike', ({ x, y, radius }) => {
    const scene = gs(); if (!scene) return;
    scene.showMeteorStrike(x, y, radius);
  });

  s.on('meteorDamage', ({ id, hp, maxHp, damage }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[id]; if (!tgt) return;
    tgt.data.hp = hp; tgt.data.maxHp = maxHp;
    redrawHPSprite(tgt.hpSprite, hp, maxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    scene.showHitAnim(id);
    if (id === scene.myId) { scene.myPlayer.hp = hp; window.updateHUD(scene.myPlayer); }
  });

  s.on('volcanoErupt', ({ bombs, erupAt }) => {
    const scene = gs(); if (!scene) return;
    scene.showVolcanoErupt(bombs, erupAt);
  });

  s.on('lavaBombsLand', ({ bombs }) => {
    const scene = gs(); if (!scene) return;
    scene.showLavaBombsLand(bombs);
  });

  s.on('lavaDamage', ({ id, hp, maxHp, damage }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[id]; if (!tgt) return;
    tgt.data.hp = hp; tgt.data.maxHp = maxHp;
    redrawHPSprite(tgt.hpSprite, hp, maxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    scene.showHitAnim(id);
    if (id === scene.myId) { scene.myPlayer.hp = hp; window.updateHUD(scene.myPlayer); }
  });

  s.on('heatDamage', ({ id, hp, maxHp, damage }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[id]; if (!tgt) return;
    tgt.data.hp = hp; tgt.data.maxHp = maxHp;
    redrawHPSprite(tgt.hpSprite, hp, maxHp);
    if (damage > 0) scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    if (id === scene.myId) {
      scene.myPlayer.hp = hp; window.updateHUD(scene.myPlayer);
      // Red heat vignette flash
      const vig = document.getElementById('hitFlash') || (() => {
        const d = document.createElement('div');
        d.id = 'hitFlash';
        d.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 40%,rgba(255,60,0,0.55) 100%);z-index:9000;opacity:0;transition:opacity 0.08s';
        document.body.appendChild(d); return d;
      })();
      vig.style.opacity = '1';
      clearTimeout(vig._t);
      vig._t = setTimeout(() => { vig.style.opacity = '0'; }, 180);
    }
  });

  s.on('buildingDestroyed', ({ id, destroyerName, ownerName, buildingName, selfDemolish }) => {
    const scene = gs(); if (!scene) return;
    scene.removeBuilding(id);
    if (selfDemolish) {
      if (destroyerName === scene.myPlayer?.username) window.showToast?.(`🔨 Demolished your ${buildingName}`, 1500);
      window.addChatMessage?.('🔨 Demolish', `${ownerName} demolished their own ${buildingName}.`, '#88aa88');
    } else {
      window.addKillFeed?.(`<span style="color:#ff6b35">🏚️ ${destroyerName}</span> destroyed <span style="color:#ffd700">${ownerName}'s ${buildingName}</span>!`);
      window.addChatMessage?.('🏚️ Destroy', `${destroyerName} destroyed ${ownerName}'s ${buildingName}!`, '#ff6b35');
    }
    window.SFX?.crunch();
  });

  s.on('turretFired', ({ buildingId, targetId, damage, targetHp, x, y }) => {
    const scene = gs(); if (!scene) return;
    const b = scene.buildingObjs[buildingId];
    const tgt = scene.playerObjs[targetId];
    if (b && tgt) {
      const points = [new THREE.Vector3(sx(b.data.x), 1.0, sz(b.data.y)), new THREE.Vector3(sx(tgt.data.x), 1.0, sz(tgt.data.y))];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xff4400 }));
      scene.scene.add(line);
      setTimeout(() => scene.scene.remove(line), 120);
    }
    if (tgt) { tgt.data.hp = targetHp; redrawHPSprite(tgt.hpSprite, targetHp, tgt.data.maxHp); scene.showDamageNum(x, y, damage); }
    if (targetId === scene.myId) { scene.myPlayer.hp = targetHp; window.updateHUD(scene.myPlayer); }
  });

  s.on('trapTriggered', ({ buildingId, targetId, damage, targetHp }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[targetId]; if (!tgt) return;
    tgt.data.hp = targetHp;
    redrawHPSprite(tgt.hpSprite, targetHp, tgt.data.maxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    if (targetId === scene.myId) { scene.myPlayer.hp = targetHp; window.updateHUD(scene.myPlayer); }
  });

  s.on('moneyDropSpawned', drop => { const scene = gs(); if (scene) scene.spawnDrop(drop); });

  s.on('dropCollected', ({ dropId, playerId, money }) => {
    const scene = gs(); if (!scene) return;
    const dropObj = scene.moneyDropObjs[dropId];
    if (dropObj && (window.GAME_SETTINGS?.coinSparkles) !== false) scene.showCoinSparkle(dropObj.data.x, dropObj.data.y);
    scene.removeDrop(dropId);
    if (playerId === scene.myId) { scene.myPlayer.money = money; window.updateHUD(scene.myPlayer); window.SFX?.coin(); }
  });

  s.on('statSync', stats => {
    const scene = gs(); if (!scene) return;
    for (const [id, st] of Object.entries(stats)) {
      const obj = scene.playerObjs[id]; if (!obj) continue;
      obj.data.hp = st.hp; obj.data.money = st.money; obj.data.mps = st.mps; obj.data.isDead = st.isDead;
      redrawHPSprite(obj.hpSprite, st.hp, obj.data.maxHp || 100);
      if (id === scene.myId) { Object.assign(scene.myPlayer, st); window.updateHUD(scene.myPlayer); }
    }
  });

  s.on('upgradeSuccess', ({ upgradeId, money, stats }) => {
    const scene = gs(); if (!scene) return;
    scene.myPlayer.money = money;
    Object.assign(scene.myPlayer, stats);
    if (!scene.myPlayer.upgrades) scene.myPlayer.upgrades = [];
    if (!scene.myPlayer.upgrades.includes(upgradeId)) scene.myPlayer.upgrades.push(upgradeId);
    window.updateHUD(scene.myPlayer);
    window.SFX?.upgrade();
    if (window._shopUpgrades) window.buildShop(window._shopUpgrades, scene.myPlayer.upgrades);
    if (upgradeId === 'collectorsHole') scene.spawnCollectorHole();
  });

  s.on('upgradeError', msg => window.showToast('❌ ' + msg, 2000));

  s.on('playerUpgraded', ({ id, upgradeId }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[id]; if (!obj) return;
    if (!obj.data.upgrades) obj.data.upgrades = [];
    if (!obj.data.upgrades.includes(upgradeId)) obj.data.upgrades.push(upgradeId);
  });

  s.on('levelUp', ({ level, maxHp, damage }) => {
    const scene = gs(); if (!scene) return;
    scene.myPlayer.level = level; scene.myPlayer.maxHp = maxHp; scene.myPlayer.damage = damage;
    window.updateXPBar(0, level);
    window.SFX?.levelUp();
    window.showToast(`⭐ Level ${level}!`, 2500);
  });

  s.on('leaderboard', lb => {
    window.updateLeaderboard(lb);
    window.updateXPBar(window._gameScene?.myPlayer?.xp || 0, window._gameScene?.myPlayer?.level || 1);
  });

  s.on('chatMessage', ({ username, message, color }) => window.addChatMessage(username, message, color));

  s.on('prestigeSuccess', ({ prestige, speed, damage, defense, maxHp, hp, mps, regen }) => {
    const scene = gs(); if (!scene || !scene.myPlayer) return;
    Object.assign(scene.myPlayer, {
      prestige, money: 0, upgrades: [],
      speed, damage, defense, maxHp, hp, mps, regen,
    });
    window.updateHUD(scene.myPlayer);
    const shopList = window._shopUpgrades || window._allUpgrades;
    if (shopList) window.buildShop(shopList, []);
    window.showToast(`⭐ Prestige ${prestige}! Permanent boosts unlocked! Shop reset.`, 4000);
    window.SFX?.levelUp();
  });

  s.on('playerPrestiged', ({ id, prestige }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[id]; if (!obj) return;
    obj.data.prestige = prestige;
    window.addKillFeed?.(`<span style="color:#ffd700">⭐ ${obj.data.username} prestiged (★${prestige})!</span>`);
  });
}
window.setupGameSocketEvents = setupGameSocketEvents;
})();
