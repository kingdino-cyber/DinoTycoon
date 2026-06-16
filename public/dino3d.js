// ── Dino Tycoon — Shared Three.js 3D model builders ─────────────────────────
// Used by both the homepage hero canvas and the in-game first-person engine,
// so the dino you see in the lobby is the exact same model/geometry as in-game.
'use strict';

function hexStr2numTHREE(s) { return parseInt(s.replace('#', ''), 16); }
function adjColorTHREE(hex, amt) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return (r << 16) | (g << 8) | b;
}

// Builds a low-poly blocky dino (Roblox-tycoon style), facing +Z.
// Returns a THREE.Group with userData.legs/arms for walk animation.
function buildDino3DModel(THREE, colorHex) {
  const base = hexStr2numTHREE(colorHex);
  const dark = adjColorTHREE(base, -55);
  const light = adjColorTHREE(base, 45);
  const belly = 0xf5e6c8;
  const isPanda = colorHex === '#f5f5f5';

  const baseMat  = new THREE.MeshLambertMaterial({ color: base });
  const darkMat  = new THREE.MeshLambertMaterial({ color: isPanda ? 0x161616 : dark });
  const lightMat = new THREE.MeshLambertMaterial({ color: light });
  const bellyMat = new THREE.MeshLambertMaterial({ color: belly });
  const blackMat = new THREE.MeshLambertMaterial({ color: 0x161616 });
  const eyeWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const eyeBlack = new THREE.MeshLambertMaterial({ color: 0x161616 });

  const group = new THREE.Group();

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 1.5), baseMat);
  body.position.set(0, 0.62, 0);
  group.add(body);

  // Belly patch
  const bellyBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.85), bellyMat);
  bellyBox.position.set(0, 0.42, 0.15);
  group.add(bellyBox);

  // Tail — tapering segments behind body
  for (let i = 0; i < 5; i++) {
    const s = 0.42 - i * 0.07;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), i === 4 ? darkMat : baseMat);
    seg.position.set(0, 0.52 - i * 0.045, -0.85 - i * 0.32);
    group.add(seg);
  }

  // Back legs (load-bearing, animated)
  const legMat = isPanda ? blackMat : darkMat;
  const legGeo = new THREE.BoxGeometry(0.3, 0.55, 0.3);
  const legs = [];
  for (const x of [-0.28, 0.28]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.45, -0.05);
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(0, -0.27, 0);
    pivot.add(leg);
    group.add(pivot);
    legs.push(pivot);
  }

  // Front arms (small, animated opposite to legs)
  const armMat = isPanda ? blackMat : darkMat;
  const armGeo = new THREE.BoxGeometry(0.2, 0.38, 0.2);
  const arms = [];
  for (const x of [-0.42, 0.42]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.75, 0.55);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(0, -0.19, 0);
    pivot.add(arm);
    group.add(pivot);
    arms.push(pivot);
  }

  // Neck
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.5), baseMat);
  neck.position.set(0, 0.95, 0.72);
  neck.rotation.x = -0.35;
  group.add(neck);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.62), baseMat);
  head.position.set(0, 1.25, 1.02);
  group.add(head);
  // Head highlight (top-left, subtle, matches the 2D look)
  const headHi = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), lightMat);
  headHi.position.set(-0.15, 1.46, 0.95);
  group.add(headHi);

  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.42), baseMat);
  snout.position.set(0, 1.14, 1.42);
  group.add(snout);

  // Back spikes
  const spikeZ = [-0.55, -0.25, 0.05, 0.35, 0.6];
  for (const sz of spikeZ) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 4), darkMat);
    spike.position.set(0, 1.05, sz);
    group.add(spike);
  }

  // Eyes
  for (const ex of [-0.17, 0.17]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eyeWhite);
    white.position.set(ex, 1.34, 1.28);
    group.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeBlack);
    pupil.position.set(ex, 1.34, 1.34);
    group.add(pupil);
  }

  // Panda markings
  if (isPanda) {
    for (const ex of [-0.27, 0.27]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), blackMat);
      ear.position.set(ex, 1.54, 0.9);
      group.add(ear);
    }
    for (const ex of [-0.17, 0.17]) {
      const patch = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), blackMat);
      patch.position.set(ex, 1.33, 1.2);
      patch.scale.set(1, 1, 0.35);
      group.add(patch);
    }
  }

  group.userData.legs = legs;
  group.userData.arms = arms;
  group.userData.walkPhase = 0;
  return group;
}

// Animates legs/arms in-place based on a walk phase (radians)
function animateDinoWalk(group, phase) {
  const legs = group.userData.legs, arms = group.userData.arms;
  if (!legs) return;
  legs[0].rotation.x = Math.sin(phase) * 0.55;
  legs[1].rotation.x = Math.sin(phase + Math.PI) * 0.55;
  if (arms) {
    arms[0].rotation.x = Math.sin(phase + Math.PI / 2) * 0.3;
    arms[1].rotation.x = Math.sin(phase + Math.PI / 2 + Math.PI) * 0.3;
  }
}

// Builds a low-poly 3D building model for the given upgrade type.
function buildBuilding3DModel(THREE, upgradeId, ownerColorHex) {
  const group = new THREE.Group();
  const ownerMat = new THREE.MeshLambertMaterial({ color: hexStr2numTHREE(ownerColorHex || '#888888') });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });

  function addBox(w, h, d, color, x, y, z, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    if (rotY) m.rotation.y = rotY;
    group.add(m);
    return m;
  }

  switch (upgradeId) {
    case 'bonePile1':
      addBox(1.1, 0.4, 1.1, 0xf0e6c8, 0, 0.2, 0);
      break;
    case 'bonePile2':
      addBox(1.4, 0.9, 1.4, 0x554433, 0, 0.45, 0);
      addBox(0.8, 0.6, 0.8, 0x1a1a10, 0, 0.5, 0);
      break;
    case 'bonePile3': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
      dome.position.y = 0.45; group.add(dome);
      break;
    }
    case 'bonePile4':
      addBox(1.8, 1.1, 1.4, 0xccbbaa, 0, 0.55, 0);
      { const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 4), new THREE.MeshLambertMaterial({ color: 0x665544 })); roof.position.y = 1.45; roof.rotation.y = Math.PI / 4; group.add(roof); }
      break;
    case 'bonePile5':
      addBox(2.0, 1.4, 1.6, 0xaaddff, 0, 0.7, 0);
      { const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffd700 })); dome.position.y = 1.6; group.add(dome); }
      break;
    case 'fossilFortress':
      addBox(1.8, 1.3, 1.8, 0x887766, 0, 0.65, 0);
      addBox(0.5, 1.7, 0.5, 0x887766, -0.8, 0.85, 0);
      addBox(0.5, 1.7, 0.5, 0x887766, 0.8, 0.85, 0);
      { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8), darkMat); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.9, 0.7, 0); group.add(barrel); }
      break;
    case 'stoneWall':
      addBox(1.8, 0.9, 0.45, 0x888880, 0, 0.45, 0);
      break;
    case 'spikeTrap':
      addBox(1.6, 0.15, 1.6, 0x444400, 0, 0.08, 0);
      for (let i = -2; i <= 2; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0xcccc00 }));
        spike.position.set(i * 0.3, 0.3, 0); group.add(spike);
      }
      break;
    case 'thornHedge': {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), new THREE.MeshLambertMaterial({ color: 0x2d8a2d }));
      bush.position.y = 0.5; bush.scale.set(1, 0.75, 1); group.add(bush);
      break;
    }
    case 'dinoTurret': {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xaa8866 }));
      tower.position.y = 0.65; group.add(tower);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), darkMat);
      barrel.rotation.z = Math.PI / 2; barrel.position.set(0.6, 1.0, 0); group.add(barrel);
      break;
    }
    case 'lavaPit': {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 12), new THREE.MeshLambertMaterial({ color: 0xff4400 }));
      pit.position.y = 0.08; group.add(pit);
      break;
    }
    case 'iceTower': {
      const tower = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 6), new THREE.MeshLambertMaterial({ color: 0x99eeff }));
      tower.position.y = 0.8; group.add(tower);
      break;
    }
    case 'boneCannon':
      addBox(0.9, 0.6, 0.9, 0xddddcc, 0, 0.3, 0);
      { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xeeeedd })); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.8, 0.5, 0); group.add(barrel); }
      break;
    case 'healingTotem': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x8855dd }));
      pole.position.y = 0.7; group.add(pole);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshLambertMaterial({ color: 0xff66ff }));
      orb.position.y = 1.5; group.add(orb);
      break;
    }
    case 'tarPit': {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 12), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
      pit.position.y = 0.06; group.add(pit);
      break;
    }
    default:
      addBox(1, 1, 1, hexStr2numTHREE(ownerColorHex || '#888888'), 0, 0.5, 0);
  }
  return group;
}

window.buildDino3DModel = buildDino3DModel;
window.animateDinoWalk = animateDinoWalk;
window.buildBuilding3DModel = buildBuilding3DModel;
window.hexStr2numTHREE = hexStr2numTHREE;
window.adjColorTHREE = adjColorTHREE;
