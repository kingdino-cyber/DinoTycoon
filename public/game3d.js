// ── Dino Tycoon — Third-Person 3D Engine (Three.js) ──────────────────────────
(function() {
'use strict';

const WORLD_SIZE = 3200;
const PAD_SIZE = 620;
const WU = 1 / 24;          // server units -> three.js units — bigger than before so the world feels larger
const REACH = 320;          // server units — matches old click-to-attack reach
const PICKUP_RADIUS = 42;   // server units — "touch" radius for coin pickup
const CAM_DISTANCE = 4.2;   // three.js units behind the player, rear-view camera
const CAM_BASE_HEIGHT = 2.0;// camera height above ground

const PADS_DATA = [
  { x:100,  y:100,  hex:0xe84393 },
  { x:2480, y:100,  hex:0x1e90ff },
  { x:100,  y:2480, hex:0x2ed573 },
  { x:2480, y:2480, hex:0xffa502 },
  { x:1290, y:100,  hex:0xa29bfe },
  { x:1290, y:2480, hex:0xfd79a8 },
  { x:100,  y:1290, hex:0x00cec9 },
  { x:2480, y:1290, hex:0xfdcb6e },
];

const WALL_TYPES = ['stoneWall', 'fossilFortress'];
const INCOME_UPGRADE_IDS = ['bonePile1', 'bonePile2', 'bonePile3', 'bonePile4', 'bonePile5'];

function sx(serverX) { return serverX * WU; }
function sz(serverY) { return serverY * WU; }
function dirToRotY(theta) { return Math.PI / 2 - theta; }
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // Lighting — bright sunny daytime
    this.scene.add(new THREE.AmbientLight(0xcce4ff, 1.0));
    const sun = new THREE.DirectionalLight(0xfff8e0, 1.1);
    sun.position.set(50, 80, 30);
    this.scene.add(sun);

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
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3cb043 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, W / 2);
    this.scene.add(ground);

    // Grid lines for depth perception
    const grid = new THREE.GridHelper(W, 32, 0x2d8a35, 0x2d8a35);
    grid.position.set(W / 2, 0.01, W / 2);
    this.scene.add(grid);

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

    // Central battle arena marker
    const arena = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 13, 0.12, 32),
      new THREE.MeshLambertMaterial({ color: 0xff4400, transparent: true, opacity: 0.25 })
    );
    arena.position.set(sx(1600), 0.06, sz(1600));
    this.scene.add(arena);
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
      const ch = document.getElementById('crosshair3d');
      if (ch) ch.style.display = this.locked ? 'block' : 'none';
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const sens = 0.0008 + ((window.GAME_SETTINGS?.mouseSensitivity ?? 50) / 100) * 0.004;
      this.yawObject.rotation.y -= e.movementX * sens;
      this.pitchObject.rotation.x += e.movementY * sens;
      this.pitchObject.rotation.x = Math.max(-0.55, Math.min(0.65, this.pitchObject.rotation.x));
    });
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        // Gate on pointer lock like the other gameplay keys — without this, pressing
        // Space while paused (pointer unlocked) queues a jump impulse that update()
        // skips applying while paused, then fires unexpectedly the instant you resume.
        if (this.locked && this._jumpY === 0 && !this.myPlayer?.isDead) this._jumpVel = 9; // jump
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
    group.scale.setScalar(1);
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
    this.scene.remove(obj.group);
    delete this.buildingObjs[id];
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
    obj.group.scale.set(1.08, 1.08, 1.15);
    setTimeout(() => { obj.group.scale.set(1, 1, 1); }, 160);
    if (obj.armPivots) { obj._armSwinging = true; obj._armSwingT = 0; }
  }

  showHitAnim(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    // Turn red
    obj.group.traverse(o => { if (o.isMesh) o.material.color.set(0xff1111); });
    obj.group.scale.set(0.88, 1.12, 0.88);
    // Cancel any in-flight restore so rapid hits don't compound
    clearTimeout(obj._hitT1); clearTimeout(obj._hitT2);
    obj._hitT1 = setTimeout(() => obj.group.scale.set(1.1, 0.9, 1.1), 60);
    obj._hitT2 = setTimeout(() => {
      obj.group.scale.set(1, 1, 1);
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
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 });
    const geo = new THREE.BoxGeometry(len, 0.25 * WU, 0.25 * WU);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sx((fromX + toX) / 2), 0.4 * WU, sz((fromY + toY) / 2));
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.scene.add(mesh);
    const t0 = Date.now();
    const fade = () => {
      const t = (Date.now() - t0) / 450;
      if (t >= 1) { this.scene.remove(mesh); geo.dispose(); mat.dispose(); return; }
      mat.opacity = 0.75 * (1 - t);
      requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  showRoarRing(x, y, range, colorHex) {
    const col = new THREE.Color(colorHex || '#ff6b6b');
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const geo = new THREE.RingGeometry(0.01, 1, 48);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sx(x), 0.15 * WU, sz(y));
    mesh.rotation.x = -Math.PI / 2;
    const maxR = range * WU;
    this.scene.add(mesh);
    const t0 = Date.now();
    const expand = () => {
      const t = (Date.now() - t0) / 650;
      if (t >= 1) { this.scene.remove(mesh); geo.dispose(); mat.dispose(); return; }
      const s = maxR * t; mesh.scale.set(s, s, 1);
      mat.opacity = 0.55 * (1 - t);
      requestAnimationFrame(expand);
    };
    requestAnimationFrame(expand);
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
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 32px Segoe UI'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff5555';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    ctx.strokeText('-' + amount, 48, 32); ctx.fillText('-' + amount, 48, 32);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    spr.scale.set(0.1, 0.05, 1);
    spr.position.set(sx(x), 1.8, sz(y));
    this.scene.add(spr);
    let t = 0;
    const tick = () => {
      t += 1; spr.position.y += 0.012; spr.material.opacity = 1 - t / 40;
      if (t < 40) requestAnimationFrame(tick); else this.scene.remove(spr);
    };
    requestAnimationFrame(tick);
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
        if (!blocked) {
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
      if (myObj) {
        myObj.group.position.set(px, jY, pz);
        myObj.group.rotation.y = phi;
        myObj.group.rotation.x = -pitch * 0.4;
        myObj.group.scale.set(jumpScaleXZ, jumpScaleY, jumpScaleXZ);
        myObj.group.visible = !this.myPlayer.isDead;
        myObj.data.x = this.myPlayer.x; myObj.data.y = this.myPlayer.y;
      }
      const forwardCam = { x: Math.sin(phi), z: Math.cos(phi) };
      const pitchLift = Math.sin(pitch) * 1.8;
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
        const eyeH = 1.85 + jY + headBob;
        this.camera.position.set(px + forwardCam.x * 0.25 + shakeX, eyeH + shakeY, pz + forwardCam.z * 0.25);
        const lx = px + forwardCam.x * Math.cos(pitch) * 10;
        const ly = eyeH - Math.sin(pitch) * 10;
        const lz = pz + forwardCam.z * Math.cos(pitch) * 10;
        this.camera.lookAt(lx, ly, lz);
      } else if (this._camMode === 2) {
        // ── Third-person front (facing camera) ────────────────────────────
        if (myObj) myObj.group.visible = !this.myPlayer.isDead;
        this.camera.position.set(
          px + forwardCam.x * CAM_DISTANCE * pitchPull + shakeX,
          CAM_BASE_HEIGHT + pitchLift + shakeY + jY,
          pz + forwardCam.z * CAM_DISTANCE * pitchPull
        );
        this.camera.lookAt(px, 1.3 + jY, pz);
      } else {
        // ── Third-person back (default) ───────────────────────────────────
        if (myObj) myObj.group.visible = !this.myPlayer.isDead;
        this.camera.position.set(
          px - forwardCam.x * CAM_DISTANCE * pitchPull + shakeX,
          CAM_BASE_HEIGHT + pitchLift + shakeY + jY,
          pz - forwardCam.z * CAM_DISTANCE * pitchPull
        );
        this.camera.lookAt(px, 1.3 + jY, pz);
      }
    }

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

  s.on('attackResult', ({ attackerId, targetId, damage, targetHp, targetMaxHp, knockback }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[targetId]; if (!tgt) return;
    tgt.data.hp = targetHp; tgt.data.maxHp = targetMaxHp;
    redrawHPSprite(tgt.hpSprite, targetHp, targetMaxHp);
    const predicted = attackerId === scene.myId && scene._lastAttackTargetId === targetId;
    if (predicted) scene._lastAttackTargetId = null;
    // Always show authoritative damage number and hit animation
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    scene.showHitAnim(targetId);
    // Only show laser/hit-flash/bite if we didn't already predict them locally
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

  s.on('playerDied', ({ victimId, killerId, loot, killerMoney }) => {
    const scene = gs(); if (!scene) return;
    const victim = scene.playerObjs[victimId];
    const killer = scene.playerObjs[killerId];
    if (victim) { victim.data.isDead = true; victim.group.visible = false; }
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
    }
    const vName = victim?.data?.username || 'A dinosaur';
    const kName = killer?.data?.username || 'something';
    const vc = victim?.data?.color || '#ccc';
    const kc = killer?.data?.color || '#fff';
    const kIsBot = killer?.data?.isBot, vIsBot = victim?.data?.isBot;
    if (killerId === null) {
      window.addKillFeed?.(`☄️ <span style="color:${vc}">${vName}</span> was struck by a meteor!`);
      window.addChatMessage?.('☄️ Meteor', `${vName} was struck by a meteor!`, '#ff6600');
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
      scene.myPlayer.x = toX; scene.myPlayer.y = toY;
      scene._camShake = 0.25;
    }
    scene.setNetPos(playerId, toX, toY, obj?.data?.dir ?? 0);
    scene.showChargeTrail(fromX, fromY, toX, toY, color);
  });

  s.on('roarResult', ({ playerId, x, y, range }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[playerId];
    scene.showRoarRing(x, y, range, obj?.data?.color || '#ff6b6b');
    if (playerId === scene.myId) scene._camShake = 0.4;
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
