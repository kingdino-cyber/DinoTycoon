// ── Dino Tycoon — First-Person 3D Engine (Three.js) ─────────────────────────
// Replaces the old Phaser top-down renderer. The server protocol is 100%
// unchanged: it's still authoritative over a flat (x,y) plane. Here we map
// server x,y -> three.js x,z (height/y is always ~ground level), and render
// a real first-person 3D world on top of the exact same socket events.
'use strict';

const WORLD_SIZE = 3200;
const PAD_SIZE = 620;
const WU = 1 / 40;          // server units -> three.js units
const EYE_HEIGHT = 1.55;    // camera height above ground, in three.js units
const REACH = 320;          // server units — matches old click-to-attack reach
const PICKUP_RADIUS = 95;   // server units — auto-collect drops within this range

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

function sx(serverX) { return serverX * WU; }
function sz(serverY) { return serverY * WU; }
function dirToRotY(theta) { return Math.PI / 2 - theta; }
function hexStr2num(s) { return parseInt(s.replace('#', ''), 16); }

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
  ctx.fillStyle = pct > 0.6 ? '#44dd44' : pct > 0.3 ? '#ffaa00' : '#ff3333';
  ctx.fillRect(2, 2, (128 - 4) * pct, 14);
  spr.userData.tex.needsUpdate = true;
}

// ── Main engine ───────────────────────────────────────────────────────────
class Game3D {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1f0d);
    this.scene.fog = new THREE.Fog(0x0d1f0d, 25, 70);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    this.yawObject = new THREE.Object3D();
    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(this.camera);
    this.yawObject.add(this.pitchObject);
    this.yawObject.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.yawObject);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.8));
    const sun = new THREE.DirectionalLight(0xfff4dd, 0.9);
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

    this.setupInput();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this._lastFrame = performance.now();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  buildWorld() {
    const W = WORLD_SIZE * WU;
    // Ground
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x0d2a0d });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, W / 2);
    this.scene.add(ground);

    // Grid lines for depth perception
    const grid = new THREE.GridHelper(W, 32, 0x1a3a1a, 0x1a3a1a);
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
        new THREE.CylinderGeometry(PAD_SIZE * WU * 0.55, PAD_SIZE * WU * 0.55, 0.1, 24),
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
      if (!this.locked) { canvas.requestPointerLock(); return; }
      this.tryAttackOrCollect();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const sens = 0.0022;
      this.yawObject.rotation.y -= e.movementX * sens;
      this.pitchObject.rotation.x -= e.movementY * sens;
      this.pitchObject.rotation.x = Math.max(-1.3, Math.min(1.3, this.pitchObject.rotation.x));
    });
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  tryAttackOrCollect() {
    if (!this.myPlayer || this.myPlayer.isDead || this._countdown > 0) return;
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const targets = [];
    for (const [id, obj] of Object.entries(this.playerObjs)) {
      if (id === this.myId || obj.data.isDead) continue;
      targets.push({ id, type: 'player', group: obj.group, dist: Math.hypot(this.myPlayer.x - obj.data.x, this.myPlayer.y - obj.data.y) });
    }
    for (const [id, obj] of Object.entries(this.buildingObjs)) {
      if (obj.data.ownerId === this.myId) continue;
      targets.push({ id, type: 'building', group: obj.group, dist: Math.hypot(this.myPlayer.x - obj.data.x, this.myPlayer.y - obj.data.y) });
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
    if (!chosen) {
      // Fallback: nearest target within reach (aiming precisely in FP is hard)
      const inReach = targets.filter(t => t.dist <= REACH).sort((a, b) => a.dist - b.dist);
      chosen = inReach[0] || null;
    }
    if (chosen) {
      if (chosen.type === 'player') {
        window.gameSocket.emit('attack', chosen.id);
        this.showBite(this.myId);
        window.SFX?.crunch();
      } else {
        window.gameSocket.emit('attackBuilding', chosen.id);
        this.showBite(this.myId);
        window.SFX?.crunch();
      }
    } else {
      window.showToast?.('⚔️ Nothing in range!', 1200);
    }
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

    const obj = { group, nameSprite, hpSprite, data: { ...data }, walkPhase: 0 };
    this.playerObjs[data.id] = obj;
    this.setPos(data.id, data.x, data.y, data.dir || 0);

    if (data.id === this.myId) {
      group.visible = false; // first-person — don't render own body
    }
    return obj;
  }

  removePlayer(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    this.scene.remove(obj.group);
    delete this.playerObjs[id];
  }

  setPos(id, x, y, dir) {
    const obj = this.playerObjs[id]; if (!obj) return;
    obj.group.position.set(sx(x), 0, sz(y));
    if (dir !== undefined) { obj.group.rotation.y = dirToRotY(dir); obj.data.dir = dir; }
    obj.data.x = x; obj.data.y = y;
    if (id === this.myId) {
      this.yawObject.position.set(sx(x), EYE_HEIGHT, sz(y));
    }
  }

  redrawHP(hpSpriteOrObjId, hp, maxHp) {
    // Accept either a sprite directly (compat) or be called with obj
    if (hpSpriteOrObjId && hpSpriteOrObjId.userData && hpSpriteOrObjId.userData.ctx) {
      redrawHPSprite(hpSpriteOrObjId, hp, maxHp);
    }
  }

  spawnBuilding(b) {
    const group = window.buildBuilding3DModel(THREE, b.upgradeId, b.ownerColor);
    if (b.orientation === 'v') group.rotation.y = Math.PI / 2;
    group.position.set(sx(b.x), 0, sz(b.y));
    this.scene.add(group);

    const hpSprite = makeHPBarSprite();
    hpSprite.position.set(0, 1.8, 0);
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
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12),
      new THREE.MeshLambertMaterial({ color: 0xffd700 })
    );
    coin.rotation.x = Math.PI / 2;
    coin.position.set(sx(drop.x), 0.4, sz(drop.y));
    this.scene.add(coin);
    this.moneyDropObjs[drop.id] = { group: coin, data: { ...drop } };
  }

  removeDrop(id) {
    const obj = this.moneyDropObjs[id]; if (!obj) return;
    this.scene.remove(obj.group);
    delete this.moneyDropObjs[id];
  }

  showBite(id) {
    const obj = this.playerObjs[id]; if (!obj) return;
    const head = obj.group.children.find(c => c.geometry && c.geometry.type === 'BoxGeometry');
    // Quick lunge animation
    const origZ = obj.group.position.z;
    obj.group.scale.set(1.08, 1.08, 1.15);
    setTimeout(() => { obj.group.scale.set(1, 1, 1); }, 160);
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

  _animate() {
    requestAnimationFrame(this._animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
    this._lastFrame = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    if (typeof _paused !== 'undefined' && _paused) return;
    if (this.myPlayer && this.myId && !this.myPlayer.isDead && this._countdown <= 0) {
      const speed = (this.myPlayer.speed || 260) * WU;
      let mx = 0, mz = 0;
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, this.yawObject.rotation.y, 0));
      const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.yawObject.rotation.y, 0));
      if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += forward.x; mz += forward.z; }
      if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= forward.x; mz -= forward.z; }
      if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= right.x; mz -= right.z; }
      if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += right.x; mz += right.z; }
      const mlen = Math.hypot(mx, mz);
      if (mlen > 0.001) {
        mx /= mlen; mz /= mlen;
        let nx = this.yawObject.position.x + mx * speed * dt;
        let nz = this.yawObject.position.z + mz * speed * dt;
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
          this.yawObject.position.x = nx;
          this.yawObject.position.z = nz;
          this.myPlayer.x = sxToServer; this.myPlayer.y = szToServer;
        }

        const dir = Math.atan2(mz, mx);
        const now = performance.now();
        if (now - this.lastMoveEmit > 48) {
          window.gameSocket.emit('move', { x: this.myPlayer.x, y: this.myPlayer.y, dir });
          this.lastMoveEmit = now;
        }
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
      // coin bob/spin
      for (const obj of Object.values(this.moneyDropObjs)) {
        obj.group.rotation.z += dt * 2;
        obj.group.position.y = 0.4 + Math.sin(performance.now() * 0.003) * 0.05;
      }
    }

    // Walk animation for all non-self players based on movement
    for (const [id, obj] of Object.entries(this.playerObjs)) {
      if (id === this.myId) continue;
      const moved = obj._lastX !== undefined ? Math.hypot(obj.data.x - obj._lastX, obj.data.y - obj._lastY) : 0;
      obj._lastX = obj.data.x; obj._lastY = obj.data.y;
      if (moved > 0.3) {
        obj.walkPhase = (obj.walkPhase + moved * 0.18) % (Math.PI * 2);
        window.animateDinoWalk(obj.group, obj.walkPhase);
      }
    }
  }
}

// ── Bootstrapping — same global names the lobby expects (loadGameScripts callback) ──
function startPhaserGame() {
  const container = document.getElementById('gameContainer');
  container.innerHTML = '';
  const engine = new Game3D(container);
  window._game3D = engine;
  window._gameScene = engine; // compat alias used throughout index.html
  window._gameReady = true;
  if (window._pendingGameData) window.onGameReady(window._pendingGameData);
}
window.startPhaserGame = startPhaserGame;

window.onGameReady = function (data) {
  const s = window._gameScene;

  for (const id of Object.keys(s.playerObjs || {})) s.removePlayer(id);
  for (const id of Object.keys(s.moneyDropObjs || {})) s.removeDrop(id);
  for (const id of Object.keys(s.buildingObjs || {})) s.removeBuilding(id);
  s.playerObjs = {}; s.moneyDropObjs = {}; s.buildingObjs = {};
  s._collectedRecently = new Set();

  s.myId = data.myPlayer.id;
  s.myPlayer = data.myPlayer;
  s._countdown = 5;

  s.spawnPlayer(data.myPlayer);
  s.yawObject.position.set(sx(data.myPlayer.x), EYE_HEIGHT, sz(data.myPlayer.y));
  for (const p of data.allPlayers) if (p.id !== data.myPlayer.id) s.spawnPlayer(p);
  for (const b of data.allBots) s.spawnPlayer(b);
  for (const b of (data.buildings || [])) s.spawnBuilding(b);

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
  const gs = () => window._gameScene;

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
    scene.setPos(id, x, y, dir || 0);
  });

  s.on('botPositions', positions => {
    const scene = gs(); if (!scene) return;
    for (const { id, x, y } of positions) {
      const obj = scene.playerObjs[id]; if (!obj) continue;
      const dir = Math.atan2(y - obj.data.y, x - obj.data.x);
      scene.setPos(id, x, y, dir);
    }
  });

  s.on('attackResult', ({ attackerId, targetId, damage, targetHp, targetMaxHp, knockback }) => {
    const scene = gs(); if (!scene) return;
    const tgt = scene.playerObjs[targetId]; if (!tgt) return;
    tgt.data.hp = targetHp; tgt.data.maxHp = targetMaxHp;
    redrawHPSprite(tgt.hpSprite, targetHp, targetMaxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    scene.showHitEffect(tgt.data.x, tgt.data.y, hexStr2num(tgt.data.color || '#ffffff'));
    scene.showBite(attackerId);
    if (knockback) {
      if (targetId === scene.myId) {
        scene.myPlayer.x = knockback.x; scene.myPlayer.y = knockback.y;
        scene.setPos(scene.myId, knockback.x, knockback.y);
        if ((window.GAME_SETTINGS || {}).cameraShake !== false) {
          const orig = scene.camera.position.clone();
          let t = 0;
          const shake = () => {
            t++; scene.camera.position.set(orig.x + (Math.random() - 0.5) * 0.05, orig.y + (Math.random() - 0.5) * 0.05, orig.z);
            if (t < 8) requestAnimationFrame(shake); else scene.camera.position.copy(orig);
          };
          shake();
        }
      } else {
        scene.setPos(targetId, knockback.x, knockback.y);
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
      window.showToast('💀 You were defeated! Respawning...', 4000);
      window.SFX?.death();
    } else {
      window.SFX?.kill();
    }
    if (killer && killerId === scene.myId) {
      scene.myPlayer.money = killerMoney;
      window.updateHUD(scene.myPlayer);
    }
    const vName = victim?.data?.username || 'A dinosaur';
    const kName = killer?.data?.username || 'something';
    window.addKillFeed?.(
      victimId === killerId ? `☠️ ${vName} perished` : `🦷 ${kName} chomped ${vName} into fossils!`
    );
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

  s.on('buildingDestroyed', ({ id, destroyerName, ownerName, buildingName }) => {
    const scene = gs(); if (!scene) return;
    scene.removeBuilding(id);
    window.addKillFeed?.(`💥 ${destroyerName} destroyed ${ownerName}'s ${buildingName}!`);
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
    window.updateHUD(scene.myPlayer);
    window.SFX?.upgrade();
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

  s.on('prestigeSuccess', ({ prestige }) => {
    const scene = gs(); if (!scene) return;
    scene.myPlayer.prestige = prestige;
    window.showToast(`⭐ Prestige ${prestige}!`, 3000);
    window.SFX?.levelUp();
  });

  s.on('playerPrestiged', ({ id, prestige }) => {
    const scene = gs(); if (!scene) return;
    const obj = scene.playerObjs[id]; if (!obj) return;
    obj.data.prestige = prestige;
  });
}
window.setupGameSocketEvents = setupGameSocketEvents;
