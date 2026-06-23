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
    case 'bonePile1': {
      // Dirt mound with three crossed bones on top — mirrors the 2D "pile of bones" art
      const mound = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x8b7355 })
      );
      mound.position.y = 0.05; mound.scale.set(1, 0.4, 1); group.add(mound);
      const boneMat = new THREE.MeshLambertMaterial({ color: 0xf0e6c8 });
      const boneAngles = [0.4, -0.7, 1.4];
      for (let i = 0; i < 3; i++) {
        const bone = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6), boneMat);
        shaft.rotation.z = Math.PI / 2; bone.add(shaft);
        for (const ex of [-0.35, 0.35]) {
          const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), boneMat);
          knob.position.x = ex; bone.add(knob);
        }
        bone.position.set((i - 1) * 0.16, 0.16 + i * 0.1, (i - 1) * 0.08);
        bone.rotation.y = boneAngles[i];
        group.add(bone);
      }
      break;
    }
    case 'bonePile2': {
      // Fossil Mine — long receding tunnel shaft with wooden support frames,
      // a stone entrance arch, rail track, and an ore cart out front
      const postMat = new THREE.MeshLambertMaterial({ color: 0x6b6354 });
      const beamMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
      const tieMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
      const railMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });

      // Entrance arch (stone posts + top beam) at the mouth of the shaft
      addBox(0.28, 1.3, 0.3, 0x6b6354, -0.68, 0.65, 0);
      addBox(0.28, 1.3, 0.3, 0x6b6354,  0.68, 0.65, 0);
      addBox(1.65, 0.3, 0.34, 0x8b7355, 0, 1.45, 0);

      // Hollow tunnel shell boring back into the hill — built from floor/ceiling/walls
      // instead of a solid box, so the front entrance actually opens onto a dark
      // interior instead of showing a flat black wall right behind the arch.
      // A second opening is left in the right-hand wall partway along the shaft.
      //
      // Each panel gets a PER-FACE material: only the single face that actually
      // faces the cave interior is black — every other face (what you see from
      // outside the structure) is the same stone color as the entrance arch, so
      // the mine doesn't read as a giant black box from any other angle.
      const rockHex = 0x6b6354;
      const darkHex = 0x0a0a08;
      function addCaveWall(w, h, d, x, y, z, darkFaceIdx) {
        const mats = [];
        for (let i = 0; i < 6; i++) mats.push(new THREE.MeshLambertMaterial({ color: i === darkFaceIdx ? darkHex : rockHex }));
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
        mesh.position.set(x, y, z);
        group.add(mesh);
      }
      // BoxGeometry material face order: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z
      addCaveWall(1.0, 0.06, 1.7,  0,    0.05, -0.85, 2); // floor   — top (+y) faces inside
      addCaveWall(1.0, 0.06, 1.7,  0,    1.05, -0.85, 3); // ceiling — bottom (-y) faces inside
      addCaveWall(1.0, 1.0,  0.06, 0,    0.55, -1.7,  4); // back wall — +z faces inside (toward entrance)
      addCaveWall(0.06, 1.0, 1.7, -0.5,  0.55, -0.85, 0); // left wall — +x faces inside
      // Right wall, split in two so a gap remains for the second entrance — -x faces inside
      addCaveWall(0.06, 1.0, 0.5,  0.5,  0.55, -0.25, 1); // near segment (z: 0 to -0.5)
      addCaveWall(0.06, 1.0, 0.7,  0.5,  0.55, -1.35, 1); // far segment (z: -1.0 to -1.7)
      // Small frame around the side entrance (the gap between the two right-wall segments)
      addBox(0.14, 1.0, 0.14, 0x6b6354, 0.5, 0.55, -0.5);
      addBox(0.14, 1.0, 0.14, 0x6b6354, 0.5, 0.55, -1.0);
      addBox(0.14, 0.16, 0.62, 0x8b7355, 0.5, 1.08, -0.75);

      // Wooden support frames spaced along the shaft's length, getting visibly
      // further away — sells the depth/length of the mine
      for (const bz of [-0.35, -0.85, -1.35]) {
        const frame = new THREE.Group();
        const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 0.14), beamMat);
        leftPost.position.set(-0.4, 0.46, 0); frame.add(leftPost);
        const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.92, 0.14), beamMat);
        rightPost.position.set(0.4, 0.46, 0); frame.add(rightPost);
        const topBeam = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.14, 0.16), beamMat);
        topBeam.position.set(0, 0.92, 0); frame.add(topBeam);
        frame.position.z = bz;
        group.add(frame);
      }

      // Rail track running from inside the shaft out past the entrance
      for (const rx of [-0.18, 0.18]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.3), railMat);
        rail.position.set(rx, 0.04, -0.15); group.add(rail);
      }
      for (let i = 0; i < 6; i++) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.08), tieMat);
        tie.position.set(0, 0.02, -1.3 + i * 0.4); group.add(tie);
      }

      // Ore cart parked on the rails just outside the entrance
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.38), tieMat);
      cart.position.set(0, 0.24, 0.85); group.add(cart);
      const ore = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshLambertMaterial({ color: 0xd4af37 }));
      ore.position.set(0, 0.44, 0.85); group.add(ore);
      for (const wx of [-0.18, 0.18]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }));
        wheel.rotation.x = Math.PI / 2; wheel.position.set(wx, 0.09, 0.85); group.add(wheel);
      }

      // Small lantern glowing above the entrance
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), new THREE.MeshLambertMaterial({ color: 0xffcc44, emissive: 0xffaa00, emissiveIntensity: 0.6 }));
      lantern.position.set(0, 1.2, 0.05); group.add(lantern);
      break;
    }
    case 'bonePile3': {
      // Amber vault — glowing dome on a pedestal with an embedded fossil silhouette
      addBox(0.95, 0.28, 0.95, 0x554433, 0, 0.14, 0);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.68, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xffb300 })
      );
      dome.position.y = 0.3; group.add(dome);
      const hi = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xffe680, transparent: true, opacity: 0.5 })
      );
      hi.position.set(-0.2, 0.62, -0.15); group.add(hi);
      const fossil = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 6), new THREE.MeshLambertMaterial({ color: 0x4a3520 }));
      fossil.position.set(0.05, 0.52, 0.1); fossil.scale.set(1.4, 0.6, 1); group.add(fossil);
      break;
    }
    case 'bonePile4': {
      // Dino Museum — columned building with a triangular pediment roof
      addBox(1.75, 1.15, 1.35, 0xccbbaa, 0, 0.58, 0);
      addBox(1.95, 0.14, 1.55, 0xddccbb, 0, 0.07, 0.08);
      const colMat = new THREE.MeshLambertMaterial({ color: 0xeee0cc });
      for (const cx of [-0.62, -0.21, 0.21, 0.62]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.25, 8), colMat);
        col.position.set(cx, 0.62, 0.75); group.add(col);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.6, 4), new THREE.MeshLambertMaterial({ color: 0x8a6d4f }));
      roof.position.y = 1.45; roof.rotation.y = Math.PI / 4; group.add(roof);
      break;
    }
    case 'bonePile5': {
      // Prehistoric Bank — glass-blue vault, marble columns, gold dome + spire
      addBox(1.95, 1.55, 1.55, 0xaaddff, 0, 0.78, 0);
      addBox(2.05, 0.2, 1.65, 0xd4af37, 0, 0.1, 0);
      const colMat2 = new THREE.MeshLambertMaterial({ color: 0xfafafa });
      for (const cx of [-0.78, -0.26, 0.26, 0.78]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.45, 8), colMat2);
        col.position.set(cx, 0.73, 0.82); group.add(col);
      }
      const dome2 = new THREE.Mesh(
        new THREE.SphereGeometry(0.54, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xffd700 })
      );
      dome2.position.y = 1.6; group.add(dome2);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
      spire.position.y = 2.18; group.add(spire);
      break;
    }
    case 'fossilFortress':
      addBox(1.8, 1.8, 1.8, 0x887766, 0, 0.9, 0);
      addBox(0.5, 2.4, 0.5, 0x887766, -0.8, 1.2, 0);
      addBox(0.5, 2.4, 0.5, 0x887766, 0.8, 1.2, 0);
      { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8), darkMat); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.9, 1.0, 0); group.add(barrel); }
      break;
    case 'stoneWall':
      addBox(1.8, 1.8, 0.45, 0x888880, 0, 0.9, 0);
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
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.0, 8), new THREE.MeshLambertMaterial({ color: 0xaa8866 }));
      tower.position.y = 1.0; group.add(tower);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), darkMat);
      barrel.rotation.z = Math.PI / 2; barrel.position.set(0.6, 1.5, 0); group.add(barrel);
      break;
    }
    case 'lavaPit': {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 12), new THREE.MeshLambertMaterial({ color: 0xff4400 }));
      pit.position.y = 0.08; group.add(pit);
      break;
    }
    case 'iceTower': {
      const tower = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x99eeff }));
      tower.position.y = 1.2; group.add(tower);
      break;
    }
    case 'boneCannon':
      addBox(0.9, 0.6, 0.9, 0xddddcc, 0, 0.3, 0);
      { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xeeeedd })); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.8, 0.5, 0); group.add(barrel); }
      break;
    case 'healingTotem': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.0, 6), new THREE.MeshLambertMaterial({ color: 0x8855dd }));
      pole.position.y = 1.0; group.add(pole);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshLambertMaterial({ color: 0xff66ff }));
      orb.position.y = 2.1; group.add(orb);
      break;
    }
    case 'tarPit': {
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 12), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
      pit.position.y = 0.06; group.add(pit);
      break;
    }
    case 'conveyorBelt': {
      // Flat belt surface with an animated arrow-stripe texture (offset is scrolled
      // each frame by game3d.js) plus side rails and support legs
      const stripeCanvas = document.createElement('canvas');
      stripeCanvas.width = 64; stripeCanvas.height = 16;
      const sctx = stripeCanvas.getContext('2d');
      sctx.fillStyle = '#3a3a3a'; sctx.fillRect(0, 0, 64, 16);
      sctx.fillStyle = '#ffd700';
      for (let i = 0; i < 4; i++) {
        sctx.beginPath();
        sctx.moveTo(i * 16, 16); sctx.lineTo(i * 16 + 8, 0); sctx.lineTo(i * 16 + 16, 16);
        sctx.closePath(); sctx.fill();
      }
      const stripeTex = new THREE.CanvasTexture(stripeCanvas);
      stripeTex.wrapS = THREE.RepeatWrapping; stripeTex.wrapT = THREE.RepeatWrapping;
      stripeTex.repeat.set(1, 3);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 1.8), new THREE.MeshLambertMaterial({ map: stripeTex }));
      belt.position.set(0, 0.2, 0); group.add(belt);
      group.userData.beltTexture = stripeTex; // animated by game3d.js each frame

      addBox(0.08, 0.22, 1.8, 0x6b6354, -0.49, 0.26, 0);
      addBox(0.08, 0.22, 1.8, 0x6b6354,  0.49, 0.26, 0);
      const legMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
      for (const lz of [-0.75, 0, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.14), legMat);
        leg.position.set(0, 0.08, lz); group.add(leg);
      }
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
