// ── Dino Tycoon — Phaser 3 Game Engine ───────────────────────────────────────
(function() {
'use strict';

const WORLD_SIZE = 3200;
const PAD_SIZE = 620;
const ATTACK_RANGE = 220;

const PADS_DATA = [
  { x:100,  y:100,  color:'#e84393', hex:0xe84393 },
  { x:2480, y:100,  color:'#1e90ff', hex:0x1e90ff },
  { x:100,  y:2480, color:'#2ed573', hex:0x2ed573 },
  { x:2480, y:2480, color:'#ffa502', hex:0xffa502 },
  { x:1290, y:100,  color:'#a29bfe', hex:0xa29bfe },
  { x:1290, y:2480, color:'#fd79a8', hex:0xfd79a8 },
  { x:100,  y:1290, color:'#00cec9', hex:0x00cec9 },
  { x:2480, y:1290, color:'#fdcb6e', hex:0xfdcb6e },
];

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  return { r:(hex>>16)&0xff, g:(hex>>8)&0xff, b:hex&0xff };
}
function adjustHex(hex, amt) {
  const c = hexToRgb(hex);
  return Phaser.Display.Color.GetColor(
    Math.min(255,Math.max(0,c.r+amt)),
    Math.min(255,Math.max(0,c.g+amt)),
    Math.min(255,Math.max(0,c.b+amt))
  );
}
function hexStr2num(s) {
  return parseInt(s.replace('#',''), 16);
}

// ── 3D Dino Drawing ───────────────────────────────────────────────────────────
// Draws a detailed dino (facing right) using Phaser Graphics
// The container is then rotated for direction
function drawDino3D(gfx, colorHex, upgrades=[], biting=false, walkPhase=0) {
  gfx.clear();
  const base = hexStr2num(colorHex);
  const light  = adjustHex(base,  70);
  const dark   = adjustHex(base, -70);
  const belly  = 0xf5e6c8;
  const isPanda = colorHex === '#f5f5f5';
  const hasFireStaff = upgrades.includes('fireStaff') || upgrades.includes('meteorStrike');
  const hasDiamondArmor = upgrades.includes('diamondArmor');
  const hasJetBoots = upgrades.includes('jetBoots');

  const lLeg = Math.sin(walkPhase) * 5;
  const rLeg = Math.sin(walkPhase + Math.PI) * 5;
  const armSway = Math.sin(walkPhase + Math.PI / 2) * 2;

  // === GROUND SHADOW ===
  gfx.fillStyle(0x000000, 0.22);
  gfx.fillEllipse(4, 25, 68, 18);

  // === TAIL ===
  const tailPts = [[-16,-2],[-22,-5],[-28,-9],[-32,-13],[-34,-16],[-35,-18]];
  const tailSizes = [12, 10, 8, 6, 4, 2.5];
  for (let i = tailPts.length-1; i >= 0; i--) {
    gfx.fillStyle(i===0 ? base : dark, 1);
    gfx.fillCircle(tailPts[i][0], tailPts[i][1], tailSizes[i]);
  }
  gfx.fillStyle(light, 0.20);
  gfx.fillCircle(-16, -4, 7);

  // === BACK LEGS ===
  gfx.fillStyle(isPanda ? 0x111111 : dark, 1);
  gfx.fillRoundedRect(-12, 14 + lLeg, 10, 18, 4);
  gfx.fillRoundedRect(-2, 14 + rLeg, 10, 18, 4);
  // Feet
  gfx.fillStyle(isPanda ? 0x111111 : adjustHex(base,-100), 1);
  gfx.fillRoundedRect(-14, 29 + lLeg, 14, 6, 3);
  gfx.fillRoundedRect(-4, 29 + rLeg, 14, 6, 3);
  // Claws
  gfx.fillStyle(0x222222, 1);
  for(let cx=0; cx<3; cx++) {
    gfx.fillTriangle(-14+cx*4, 34+lLeg, -13+cx*4, 37+lLeg, -10+cx*4, 34+lLeg);
    gfx.fillTriangle(-4+cx*4, 34+rLeg, -3+cx*4, 37+rLeg, 0+cx*4, 34+rLeg);
  }

  // === BODY ===
  gfx.fillStyle(dark, 1);
  gfx.fillEllipse(5, 4, 58, 40);
  gfx.fillStyle(base, 1);
  gfx.fillEllipse(1, 0, 54, 37);
  gfx.fillStyle(light, 0.55);
  gfx.fillEllipse(-6, -8, 26, 16);
  gfx.fillStyle(belly, 0.55);
  gfx.fillEllipse(6, 9, 26, 20);

  // === DIAMOND ARMOR ===
  if (hasDiamondArmor) {
    gfx.lineStyle(2, 0x00e5ff, 0.6);
    gfx.strokeEllipse(1, 0, 56, 39);
    gfx.lineStyle(1, 0x00e5ff, 0.3);
    gfx.strokeEllipse(1, 0, 48, 33);
    gfx.fillStyle(0x00e5ff, 0.7);
    [[-10,0],[4,4],[16,0],[10,-8],[-4,-8]].forEach(([ax,ay])=>{
      gfx.fillRect(ax-3, ay-3, 6, 6);
    });
  }

  // === BACK SPIKES ===
  gfx.fillStyle(dark, 1);
  const spikePositions = [[-8,-14],[-2,-16],[4,-16],[10,-15],[15,-13]];
  const spikeHeights = [8, 10, 11, 9, 7];
  for(let i=0; i<spikePositions.length; i++) {
    const [sx, sy] = spikePositions[i];
    const h = spikeHeights[i];
    gfx.fillTriangle(sx-5, sy+3, sx, sy-h, sx+5, sy+3);
  }
  gfx.fillStyle(0xffffff, 0.15);
  for(let i=0; i<spikePositions.length; i++) {
    const [sx, sy] = spikePositions[i];
    const h = spikeHeights[i];
    gfx.fillTriangle(sx-4, sy+2, sx, sy-h+1, sx, sy+2);
  }

  // === FRONT ARMS ===
  gfx.fillStyle(isPanda ? 0x111111 : dark, 1);
  gfx.fillRoundedRect(10, -4 + armSway, 8, 12, 3);
  gfx.fillRoundedRect(16, 4 + armSway, 7, 8, 3);
  gfx.fillStyle(0x222222, 1);
  gfx.fillTriangle(16, 11+armSway, 15, 14+armSway, 20, 12+armSway);
  gfx.fillTriangle(20, 11+armSway, 19, 14+armSway, 23, 11+armSway);

  // === NECK ===
  gfx.fillStyle(dark, 1);
  gfx.fillEllipse(20, -10, 20, 14);
  gfx.fillStyle(base, 1);
  gfx.fillEllipse(18, -12, 17, 12);

  // === HEAD ===
  gfx.fillStyle(dark, 1);
  gfx.fillCircle(31, -16, 17);
  gfx.fillStyle(base, 1);
  gfx.fillCircle(29, -18, 15);
  gfx.fillStyle(light, 0.55);
  gfx.fillCircle(23, -23, 7);

  // === SNOUT & JAW ===
  const jawDrop = biting ? 11 : 0;
  gfx.fillStyle(dark, 1);
  gfx.fillRoundedRect(38, -24, 17, 11, 4);
  gfx.fillStyle(base, 1);
  gfx.fillRoundedRect(37, -25, 15, 10, 3);
  gfx.fillStyle(light, 0.30);
  gfx.fillRoundedRect(38, -25, 7, 4, 2);
  gfx.fillStyle(adjustHex(base,-130), 1);
  gfx.fillCircle(48, -21, 2.2);
  gfx.fillCircle(43, -21, 2.2);

  // Upper teeth
  gfx.fillStyle(0xffffff, 1);
  gfx.fillTriangle(39,-15, 42,-12-jawDrop/3, 45,-15);
  gfx.fillTriangle(45,-15, 48,-12-jawDrop/3, 51,-15);

  // Lower jaw
  gfx.fillStyle(dark, 1);
  gfx.fillRoundedRect(39, -14+jawDrop, 15, 8, 3);
  gfx.fillStyle(adjustHex(base, -40), 1);
  gfx.fillRoundedRect(40, -13+jawDrop, 13, 6, 2);

  if (biting) {
    gfx.fillStyle(0xffffff, 1);
    gfx.fillTriangle(41, -13+jawDrop, 44, -17, 47, -13+jawDrop);
    gfx.fillTriangle(47, -13+jawDrop, 50, -17, 53, -13+jawDrop);
    gfx.fillStyle(0xff4400, 0.35);
    gfx.fillEllipse(45, -14+jawDrop/2, 18, jawDrop+4);
  }

  // === EYE ===
  gfx.fillStyle(0xdddddd, 1);
  gfx.fillCircle(28, -23, 5.5);
  gfx.fillStyle(0xffffff, 1);
  gfx.fillCircle(27, -24, 5);
  gfx.fillStyle(0x2b1400, 1);
  gfx.fillCircle(29, -23, 3.2);
  gfx.fillStyle(0x080808, 1);
  gfx.fillCircle(29, -23, 1.8);
  gfx.fillStyle(0xffffff, 1);
  gfx.fillCircle(30, -24, 1.4);
  gfx.fillStyle(0xffffff, 0.6);
  gfx.fillCircle(28, -25, 0.7);
  gfx.lineStyle(2.5, dark, 1);
  gfx.beginPath(); gfx.moveTo(23,-28); gfx.lineTo(33,-27); gfx.strokePath();

  // === PANDA MARKINGS ===
  if (isPanda) {
    gfx.fillStyle(0x111111, 1);
    gfx.fillCircle(20, -32, 6);   // left ear
    gfx.fillCircle(35, -31, 6);   // right ear
    gfx.fillStyle(0x111111, 0.85);
    gfx.fillEllipse(28, -23, 15, 12); // eye patch
    // Redraw eye on top of patch
    gfx.fillStyle(0xffffff, 1); gfx.fillCircle(27, -24, 5);
    gfx.fillStyle(0x2b1400, 1); gfx.fillCircle(29, -23, 3.2);
    gfx.fillStyle(0x080808, 1); gfx.fillCircle(29, -23, 1.8);
    gfx.fillStyle(0xffffff, 1); gfx.fillCircle(30, -24, 1.4);
  }

  // === JET BOOTS ===
  if (hasJetBoots) {
    gfx.fillStyle(0xff6600, 0.7);
    gfx.fillCircle(-14, 35 + lLeg, 6);
    gfx.fillCircle(-4, 35 + rLeg, 6);
    gfx.fillStyle(0xffcc00, 0.9);
    gfx.fillTriangle(-17, 35+lLeg, -11, 35+lLeg, -14, 44+lLeg);
    gfx.fillTriangle(-7, 35+rLeg, -1, 35+rLeg, -4, 44+rLeg);
  }

  // === WEAPON ===
  if (hasFireStaff) {
    gfx.lineStyle(3, 0x8B4513, 1);
    gfx.beginPath(); gfx.moveTo(22, 10); gfx.lineTo(35, -5); gfx.strokePath();
    gfx.fillStyle(0xff4400, 1); gfx.fillCircle(36, -6, 6);
    gfx.fillStyle(0xffcc00, 0.9); gfx.fillCircle(36, -6, 4);
    gfx.fillStyle(0xffffff, 0.7); gfx.fillCircle(36, -7, 2);
  } else if (upgrades.includes('trexJaw') || upgrades.includes('raptorClaw')) {
    gfx.lineStyle(3, 0xaaaaaa, 1);
    gfx.beginPath(); gfx.moveTo(18, 8); gfx.lineTo(28, -8); gfx.strokePath();
    gfx.fillStyle(0xcccccc, 1); gfx.fillRect(26,-10,5,3);
    gfx.lineStyle(2, 0xffd700, 1);
    gfx.beginPath(); gfx.moveTo(19,6); gfx.lineTo(21,2); gfx.strokePath();
  }
}

// ── GameScene ─────────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  preload() {
    // Generate tree/fern texture
    this.treeTex = this.make.graphics({x:0,y:0,add:false});
    this.treeTex.fillStyle(0x1a4a10,1); this.treeTex.fillCircle(15,15,15);
    this.treeTex.fillStyle(0x2d7a1e,1); this.treeTex.fillCircle(15,12,12);
    this.treeTex.fillStyle(0x4a9a30,1); this.treeTex.fillCircle(15,10,8);
  }

  create() {
    this.playerObjs   = {};
    this.moneyDropObjs= {};
    this.buildingObjs = {};  // id -> { gfx, hpBar, hpBg, label, data }
    this.myId = null;
    this.myPlayer = null;
    this.padGraphics = [];
    this.lastMoveTime = 0;
    this.keys = this.input.keyboard.addKeys({
      up:Phaser.Input.Keyboard.KeyCodes.W, down:Phaser.Input.Keyboard.KeyCodes.S,
      left:Phaser.Input.Keyboard.KeyCodes.A, right:Phaser.Input.Keyboard.KeyCodes.D,
      upArr:Phaser.Input.Keyboard.KeyCodes.UP, downArr:Phaser.Input.Keyboard.KeyCodes.DOWN,
      leftArr:Phaser.Input.Keyboard.KeyCodes.LEFT, rightArr:Phaser.Input.Keyboard.KeyCodes.RIGHT,
      space:Phaser.Input.Keyboard.KeyCodes.SPACE,
    });

    this.buildWorld();
    this.setupInput();
  }

  buildWorld() {
    const g = this.add.graphics();

    // ── World background ──
    g.fillStyle(0x0d1f0d,1); g.fillRect(0,0,WORLD_SIZE,WORLD_SIZE);
    // Texture blotches
    for(let i=0;i<400;i++){
      const x=Math.random()*WORLD_SIZE, y=Math.random()*WORLD_SIZE;
      g.fillStyle(Math.random()<0.5?0x0f300f:0x112211, 0.35);
      g.fillEllipse(x,y,60+Math.random()*100,40+Math.random()*70);
    }
    // Faint grid
    g.lineStyle(1,0x1a3a1a,0.2);
    for(let x=0;x<=WORLD_SIZE;x+=200){g.beginPath();g.moveTo(x,0);g.lineTo(x,WORLD_SIZE);g.strokePath();}
    for(let y=0;y<=WORLD_SIZE;y+=200){g.beginPath();g.moveTo(0,y);g.lineTo(WORLD_SIZE,y);g.strokePath();}
    // World border
    g.lineStyle(16,0x444444,1); g.strokeRect(8,8,WORLD_SIZE-16,WORLD_SIZE-16);
    g.lineStyle(4,0x888888,0.4); g.strokeRect(20,20,WORLD_SIZE-40,WORLD_SIZE-40);

    // ── Paths from each base to arena centre ──
    const pathG = this.add.graphics().setDepth(1);
    for(const pad of PADS_DATA){
      pathG.lineStyle(60,0x151f15,1);
      pathG.beginPath();
      pathG.moveTo(pad.x+PAD_SIZE/2, pad.y+PAD_SIZE/2);
      pathG.lineTo(1600,1600); pathG.strokePath();
      // Cobblestone edge
      pathG.lineStyle(3,0x223322,0.4);
      pathG.beginPath();
      pathG.moveTo(pad.x+PAD_SIZE/2, pad.y+PAD_SIZE/2);
      pathG.lineTo(1600,1600); pathG.strokePath();
    }

    // ── Central Battle Arena ──
    const ax=1050,ay=1050,aw=1100,ah=1100;
    const ag = this.add.graphics().setDepth(2);
    // Dark stone floor
    ag.fillStyle(0x1a0d00,1); ag.fillRect(ax,ay,aw,ah);
    // Floor tiles
    ag.lineStyle(1,0x2a1800,0.5);
    for(let tx=ax;tx<ax+aw;tx+=80){ag.beginPath();ag.moveTo(tx,ay);ag.lineTo(tx,ay+ah);ag.strokePath();}
    for(let ty=ay;ty<ay+ah;ty+=80){ag.beginPath();ag.moveTo(ax,ty);ag.lineTo(ax+aw,ty);ag.strokePath();}
    // Lava cracks
    ag.lineStyle(3,0xff4400,0.55);
    const cracks=[[1100,1100,1300,1250],[1400,1100,1200,1400],[1600,1200,1500,1500],[1800,1100,1700,1300],[1100,1700,1300,1600],[1700,1700,1500,1800],[1300,1400,1600,1350],[1500,1600,1700,1450]];
    for(const [x1,y1,x2,y2] of cracks){ag.beginPath();ag.moveTo(x1,y1);ag.lineTo(x2,y2);ag.strokePath();}
    // Arena outer glow ring
    ag.lineStyle(6,0xff4400,0.8); ag.strokeRect(ax,ay,aw,ah);
    ag.lineStyle(3,0xff8800,0.35); ag.strokeRect(ax+30,ay+30,aw-60,ah-60);
    // Craters
    for(let i=0;i<7;i++){
      const cx=ax+100+Math.random()*(aw-200),cy=ay+100+Math.random()*(ah-200),cr=25+Math.random()*30;
      ag.fillStyle(0x2a1000,1); ag.fillCircle(cx,cy,cr);
      ag.lineStyle(2,0xff4400,0.5); ag.strokeCircle(cx,cy,cr);
    }
    this.add.text(ax+aw/2,ay+ah/2,'☄️\nBATTLE ARENA',{fontSize:'32px',color:'#ff4400',fontFamily:'Segoe UI',align:'center',fontStyle:'bold'}).setOrigin(0.5).setAlpha(0.2).setDepth(3);

    // ── 8 Themed Base Areas ──
    this.padGraphics = [];
    const BASE_THEMES = [
      // 0 Lava Zone
      { floor:0x2a0800, mid:0x4a1200, accent:0xff4400, deco:(g,px,py)=>{
        // Lava pools
        for(let i=0;i<5;i++){const lx=px+80+Math.random()*460,ly=py+80+Math.random()*460;g.fillStyle(0xff3300,0.45);g.fillEllipse(lx,ly,60+Math.random()*60,40+Math.random()*40);}
        // Volcanic rocks
        for(let i=0;i<8;i++){const rx=px+40+Math.random()*540,ry=py+40+Math.random()*540;g.fillStyle(0x333322,1);g.fillCircle(rx,ry,8+Math.random()*12);}
      }, label:'🌋 Lava Zone' },
      // 1 Ice Tundra
      { floor:0x0d1a2a, mid:0x1a3a5a, accent:0x1e90ff, deco:(g,px,py)=>{
        // Ice crystals
        for(let i=0;i<10;i++){const ix=px+40+Math.random()*540,iy=py+40+Math.random()*540,ih=20+Math.random()*30;g.fillStyle(0x88ddff,0.5);g.fillTriangle(ix,iy+ih,ix-ih/3,iy,ix+ih/3,iy);}
        // Snow patches
        for(let i=0;i<6;i++){const sx=px+60+Math.random()*500,sy=py+60+Math.random()*500;g.fillStyle(0xddeeff,0.2);g.fillEllipse(sx,sy,70+Math.random()*50,40+Math.random()*30);}
      }, label:'❄️ Ice Tundra' },
      // 2 Jungle
      { floor:0x0a1f0a, mid:0x163316, accent:0x2ed573, deco:(g,px,py)=>{
        // Dense ferns
        for(let i=0;i<14;i++){const fx=px+30+Math.random()*560,fy=py+30+Math.random()*560,fr=14+Math.random()*18;g.fillStyle(0x1a5c1a,1);g.fillCircle(fx,fy,fr);g.fillStyle(0x2d8a2d,0.7);g.fillCircle(fx-4,fy-4,fr*0.6);}
        // Vines
        for(let i=0;i<4;i++){const vx=px+100+i*130;g.lineStyle(2,0x2d6a1e,0.5);g.beginPath();g.moveTo(vx,py);g.lineTo(vx+20,py+PAD_SIZE);g.strokePath();}
      }, label:'🌿 Jungle' },
      // 3 Desert
      { floor:0x2a1e00, mid:0x4a3600, accent:0xffa502, deco:(g,px,py)=>{
        // Sand dunes
        for(let i=0;i<6;i++){const dx=px+40+Math.random()*520,dy=py+40+Math.random()*520;g.fillStyle(0xc8a830,0.25);g.fillEllipse(dx,dy,100+Math.random()*80,40+Math.random()*30);}
        // Cactus silhouettes
        for(let i=0;i<5;i++){const cx=px+60+Math.random()*500,cy=py+60+Math.random()*500;g.fillStyle(0x3a6a10,0.8);g.fillRect(cx-5,cy-20,10,30);g.fillRect(cx-16,cy-8,10,16);g.fillRect(cx+6,cy-8,10,16);}
      }, label:'🏜️ Desert' },
      // 4 Sky Cliffs
      { floor:0x150d2a, mid:0x261850, accent:0xa29bfe, deco:(g,px,py)=>{
        // Cloud platforms
        for(let i=0;i<5;i++){const cx=px+60+Math.random()*480,cy=py+60+Math.random()*480;g.fillStyle(0xddddff,0.12);g.fillEllipse(cx,cy,90+Math.random()*60,40+Math.random()*20);}
        // Stars
        for(let i=0;i<20;i++){const sx=px+Math.random()*PAD_SIZE,sy=py+Math.random()*PAD_SIZE;g.fillStyle(0xffffff,0.3+Math.random()*0.4);g.fillCircle(sx,sy,1.5);}
      }, label:'⛅ Sky Cliffs' },
      // 5 Swamp
      { floor:0x0d1a0d, mid:0x1a2e14, accent:0xfd79a8, deco:(g,px,py)=>{
        // Murky pools
        for(let i=0;i<5;i++){const mx=px+50+Math.random()*500,my=py+50+Math.random()*500;g.fillStyle(0x1a3320,0.55);g.fillEllipse(mx,my,80+Math.random()*60,50+Math.random()*40);}
        // Mushrooms
        for(let i=0;i<8;i++){const sx=px+40+Math.random()*540,sy=py+40+Math.random()*540;g.fillStyle(0xdd3388,0.7);g.fillCircle(sx,sy-8,10+Math.random()*8);g.fillStyle(0x888866,1);g.fillRect(sx-3,sy,6,14);}
      }, label:'🍄 Swamp' },
      // 6 Ocean Reef
      { floor:0x001a2a, mid:0x003050, accent:0x00cec9, deco:(g,px,py)=>{
        // Water ripples
        for(let i=0;i<8;i++){const rx=px+40+Math.random()*540,ry=py+40+Math.random()*540,rr=20+Math.random()*35;g.lineStyle(1,0x00aacc,0.25);g.strokeCircle(rx,ry,rr);}
        // Coral
        for(let i=0;i<10;i++){const cx=px+30+Math.random()*550,cy=py+30+Math.random()*550;g.fillStyle(Math.random()<0.5?0xff6b9d:0x00e5ff,0.5);g.fillTriangle(cx,cy-16,cx-6,cy+8,cx+6,cy+8);}
      }, label:'🐚 Ocean Reef' },
      // 7 Volcano
      { floor:0x1a0800, mid:0x2e1000, accent:0xfdcb6e, deco:(g,px,py)=>{
        // Magma rivers
        for(let i=0;i<4;i++){const mx=px+60+i*130;g.lineStyle(8,0xff6600,0.4);g.beginPath();g.moveTo(mx,py);g.lineTo(mx+30,py+PAD_SIZE);g.strokePath();}
        // Embers
        for(let i=0;i<18;i++){const ex=px+Math.random()*PAD_SIZE,ey=py+Math.random()*PAD_SIZE;g.fillStyle(0xff8800,0.4+Math.random()*0.4);g.fillCircle(ex,ey,2+Math.random()*4);}
      }, label:'🔥 Volcano' },
    ];

    for(let i=0;i<PADS_DATA.length;i++){
      const pad  = PADS_DATA[i];
      const theme= BASE_THEMES[i];
      const cx   = pad.x+PAD_SIZE/2, cy = pad.y+PAD_SIZE/2;
      const bg   = this.add.graphics().setDepth(2);

      // Base floor
      bg.fillStyle(theme.floor,1); bg.fillRect(pad.x,pad.y,PAD_SIZE,PAD_SIZE);
      // Floor tile grid
      bg.lineStyle(1,theme.mid,0.5);
      for(let tx=pad.x;tx<=pad.x+PAD_SIZE;tx+=60){bg.beginPath();bg.moveTo(tx,pad.y);bg.lineTo(tx,pad.y+PAD_SIZE);bg.strokePath();}
      for(let ty=pad.y;ty<=pad.y+PAD_SIZE;ty+=60){bg.beginPath();bg.moveTo(pad.x,ty);bg.lineTo(pad.x+PAD_SIZE,ty);bg.strokePath();}
      // Theme colour wash
      bg.fillStyle(pad.hex,0.07); bg.fillRect(pad.x,pad.y,PAD_SIZE,PAD_SIZE);

      // Theme decorations
      theme.deco(bg,pad.x,pad.y);

      // Outer wall — thick stone perimeter
      bg.lineStyle(14,theme.mid,1);   bg.strokeRect(pad.x,pad.y,PAD_SIZE,PAD_SIZE);
      bg.lineStyle(4,theme.accent,0.8); bg.strokeRect(pad.x+6,pad.y+6,PAD_SIZE-12,PAD_SIZE-12);

      // Corner towers
      const corners=[[pad.x,pad.y],[pad.x+PAD_SIZE-28,pad.y],[pad.x,pad.y+PAD_SIZE-28],[pad.x+PAD_SIZE-28,pad.y+PAD_SIZE-28]];
      for(const [tx,ty] of corners){
        bg.fillStyle(theme.mid,1);   bg.fillRect(tx,ty,28,28);
        bg.fillStyle(theme.accent,0.7); bg.fillRect(tx+4,ty+4,20,20);
        bg.fillStyle(0x000000,0.3); bg.fillCircle(tx+14,ty+14,8);
      }

      // Gate / entrance in the wall facing the arena
      // Direction toward centre
      const toArenaX = 1600-cx, toArenaY = 1600-cy;
      const angle    = Math.atan2(toArenaY,toArenaX);
      const gx = cx + Math.cos(angle)*(PAD_SIZE/2-20);
      const gy = cy + Math.sin(angle)*(PAD_SIZE/2-20);
      bg.fillStyle(theme.floor,1); bg.fillRect(gx-22,gy-14,44,28);
      bg.lineStyle(3,theme.accent,0.9); bg.strokeRect(gx-22,gy-14,44,28);
      bg.fillStyle(0x000000,0.5); bg.fillRect(gx-14,gy-8,28,22);  // gate arch

      // Building slots — faint outlines so player knows where to build
      const INCOME_OFFSETS_local  = [[-90,-70],[0,-90],[90,-70],[-50,60],[50,60]];
      const DEFENSE_OFFSETS_local = [[-160,-120],[160,-120],[-160,120],[160,120],[0,-180]];
      for(const [dx,dy] of INCOME_OFFSETS_local){
        bg.lineStyle(2,theme.accent,0.2);
        bg.strokeRect(cx+dx-22,cy+dy-18,44,36);
        bg.fillStyle(theme.accent,0.05); bg.fillRect(cx+dx-22,cy+dy-18,44,36);
      }
      for(const [dx,dy] of DEFENSE_OFFSETS_local){
        bg.lineStyle(2,0xffffff,0.1);
        bg.strokeCircle(cx+dx,cy+dy,22);
      }

      // Animated pulse layer (separate graphics per pad)
      const pg = this.add.graphics().setDepth(3);
      this.padGraphics.push(pg);

      // Zone label banner
      const banner = this.add.graphics().setDepth(4);
      banner.fillStyle(0x000000,0.6); banner.fillRoundedRect(cx-80,pad.y+8,160,26,8);
      banner.lineStyle(2,pad.hex,0.8); banner.strokeRoundedRect(cx-80,pad.y+8,160,26,8);
      this.add.text(cx,pad.y+21,theme.label,{fontSize:'13px',color:'#'+theme.accent.toString(16).padStart(6,'0'),fontFamily:'Segoe UI',fontStyle:'bold',stroke:'#000',strokeThickness:3}).setOrigin(0.5).setDepth(5);
    }

    // ── Wild jungle between bases ──
    for(let i=0;i<80;i++){
      const x=Math.random()*WORLD_SIZE,y=Math.random()*WORLD_SIZE;
      if(this.isPadOrArena(x,y)) continue;
      const fg=this.add.graphics().setDepth(1);
      const r=10+Math.random()*22;
      fg.fillStyle(0x0a2e0a,1); fg.fillCircle(x,y,r+5);
      fg.fillStyle(0x165816,1); fg.fillCircle(x,y,r);
      fg.fillStyle(0x259020,0.6); fg.fillCircle(x-r*.2,y-r*.2,r*.6);
    }

    // ── Fossil veins in wild area ──
    const fossilG=this.add.graphics().setDepth(1);
    for(let i=0;i<24;i++){
      const x=250+Math.random()*(WORLD_SIZE-500),y=250+Math.random()*(WORLD_SIZE-500);
      if(this.isPadOrArena(x,y)) continue;
      fossilG.fillStyle(0xd4af37,0.1);
      fossilG.fillEllipse(x,y,50+Math.random()*80,20+Math.random()*30);
    }

  }

  isPadOrArena(x, y) {
    for(const pad of PADS_DATA) if(x>pad.x&&x<pad.x+PAD_SIZE&&y>pad.y&&y<pad.y+PAD_SIZE) return true;
    if(x>1000&&x<2200&&y>1000&&y<2200) return true;
    return false;
  }

  setupInput() {
    // ── Skill-based click-to-attack (Minecraft style) ─────────────────────────
    // You must click DIRECTLY ON an opponent. No auto-aim. You need both:
    //   1. Click lands within HIT_RADIUS px of the opponent's body (world space)
    //   2. Your dino is within REACH units of the opponent
    const HIT_RADIUS = 60;   // how precisely you need to click on them (world px)
    const REACH     = 320;   // max attack range from your dino

    this.input.on('pointerdown', (ptr) => {
      if(!this.myPlayer||this.myPlayer.isDead) return;

      // World-space click position
      const wx = ptr.worldX, wy = ptr.worldY;

      // 1. Did you click ON an opponent?
      let hitTarget = null;
      let bestDist = HIT_RADIUS;
      for(const [id,obj] of Object.entries(this.playerObjs)) {
        if(id===this.myId || obj.data.isDead) continue;
        const clickDist = Phaser.Math.Distance.Between(wx, wy, obj.data.x, obj.data.y);
        if(clickDist < bestDist) {
          bestDist = clickDist;
          hitTarget = id;
        }
      }

      if(hitTarget) {
        // 2. Are you close enough? (reach check)
        const obj = this.playerObjs[hitTarget];
        const myDist = Phaser.Math.Distance.Between(
          this.myPlayer.x, this.myPlayer.y, obj.data.x, obj.data.y
        );
        if(myDist <= REACH) {
          // ATTACK!
          window.gameSocket.emit('attack', hitTarget);
          this.showBite(this.myId);
          this.showSwipe(this.myPlayer.x, this.myPlayer.y, obj.data.x, obj.data.y);
          window.SFX?.crunch();
        } else {
          // Clicked on them but too far — show "out of range" hint
          this.showRangeIndicator(obj.data.x, obj.data.y);
        }
      } else {
        // Check if clicked on an enemy building
        let hitBuilding = null;
        for (const [bid, bobj] of Object.entries(this.buildingObjs)) {
          if (bobj.data.ownerId === this.myId) continue;
          const cd = Phaser.Math.Distance.Between(wx, wy, bobj.data.x, bobj.data.y);
          if (cd < 38) { hitBuilding = bid; break; }
        }
        if (hitBuilding) {
          const bd = this.buildingObjs[hitBuilding];
          const md = Phaser.Math.Distance.Between(this.myPlayer.x, this.myPlayer.y, bd.data.x, bd.data.y);
          if (md <= REACH) {
            window.gameSocket.emit('attackBuilding', hitBuilding);
            this.showBite(this.myId);
            window.SFX?.crunch();
          } else {
            this.showRangeIndicator(bd.data.x, bd.data.y);
          }
        } else {
          // Collect nearby drop
          for(const [id,drop] of Object.entries(this.moneyDropObjs)) {
            if(Phaser.Math.Distance.Between(this.myPlayer.x,this.myPlayer.y,drop.data.x,drop.data.y)<90) {
              window.gameSocket.emit('collectDrop',parseInt(id)); break;
            }
          }
        }
      }
    });
    this.keys.space.on('down',()=>{
      if(!this.myPlayer||this.myPlayer.isDead||!window.gameSocket) return;
      window.gameSocket.emit('collectPadDrops');
    });
  }

  spawnPlayer(data) {
    const colorHex = data.skinColor || data.color;
    const colorNum = hexStr2num(colorHex);

    // Shadow beneath dino
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.25);
    shadow.fillEllipse(0,0,70,20);

    // Dino body graphics
    const sprite = this.add.graphics();
    drawDino3D(sprite, colorHex, data.upgrades||[]);
    // Hardcore bots are bigger
    if (data.scale && data.scale !== 1) sprite.setScale(data.scale);

    // Custom skin: overlay base64 image on top of graphics dino
    if (data.customSkin) {
      const texKey = 'cskin_' + data.id;
      const applyCustomImg = () => {
        const obj = this.playerObjs[data.id]; if (!obj) return;
        const img = this.add.image(0, 0, texKey).setDisplaySize(72, 72);
        if (data.scale && data.scale !== 1) img.setScale(data.scale);
        obj.customImg = img;
        obj.sprite.setVisible(false);
        this.setPos(data.id, obj.data.x, obj.data.y);
      };
      if (!this.textures.exists(texKey)) {
        this.textures.addBase64(texKey, data.customSkin);
        this.textures.once('addtexture-' + texKey, applyCustomImg);
      } else {
        this.time.delayedCall(20, applyCustomImg);
      }
    }

    // Name label — hardcore gets skull prefix and bigger font
    const nameLabel = data.isHardcore ? `💀 ${data.username}` : data.username;
    const nameText = this.add.text(0, -52, nameLabel, {
      fontSize: data.isHardcore ? '15px' : '13px',
      color: data.isHardcore ? '#ff4444' : colorHex,
      fontFamily:'Segoe UI', fontStyle:'bold',
      stroke:'#000000', strokeThickness: data.isHardcore ? 5 : 4
    }).setOrigin(0.5);

    // Prestige star
    const presText = data.prestige>0 ? this.add.text(0,-66,`★${data.prestige}`,{
      fontSize:'11px',color:'#ffd700',fontFamily:'Segoe UI',stroke:'#000',strokeThickness:3
    }).setOrigin(0.5) : null;

    // HP bar bg
    const hpBg = this.add.graphics();
    hpBg.fillStyle(0x000000, 0.6);
    hpBg.fillRoundedRect(-26,-42,52,8,4);

    // HP bar
    const hpBar = this.add.graphics();
    this.redrawHP(hpBar, data.hp, data.maxHp);

    // Target ring
    const targetRing = this.add.graphics().setVisible(false);

    // Weapon glow for fire staff
    let weaponGlow = null;
    if(data.upgrades&&data.upgrades.includes('fireStaff')){
      weaponGlow=this.add.graphics();
      weaponGlow.fillStyle(0xff4400,0.3);
      weaponGlow.fillCircle(36,-5,12);
    }

    const obj={sprite,nameText,hpBg,hpBar,shadow,data:{...data},targetRing,presText,weaponGlow,dir:0,customImg:null};
    this.playerObjs[data.id]=obj;
    this.setPos(data.id,data.x,data.y);
    return obj;
  }

  redrawHP(hpBar, hp, maxHp) {
    hpBar.clear();
    const pct=Math.max(0,Math.min(1,hp/maxHp));
    const c=pct>0.6?0x44dd44:pct>0.3?0xffaa00:0xff3333;
    hpBar.fillStyle(c,1);
    hpBar.fillRoundedRect(-25,-41,50*pct,6,3);
  }

  setPos(id, x, y, dir) {
    const obj=this.playerObjs[id]; if(!obj) return;
    // Walk animation: update leg phase based on distance moved
    if (!obj.customImg && obj.data.x !== undefined) {
      const moved = Math.hypot(x - obj.data.x, y - obj.data.y);
      if (moved > 0.5) {
        obj.walkPhase = ((obj.walkPhase || 0) + moved * 0.18) % (Math.PI * 2);
        drawDino3D(obj.sprite, obj.data.skinColor || obj.data.color, obj.data.upgrades || [], false, obj.walkPhase);
      }
    }
    const dep=y;
    obj.shadow.setPosition(x,y+22).setDepth(dep-1);
    obj.sprite.setPosition(x,y).setDepth(dep);
    if(dir!==undefined) obj.sprite.setRotation(dir);
    obj.nameText.setPosition(x,y-50).setDepth(dep+2);
    obj.hpBg.setPosition(x,y).setDepth(dep+2);
    obj.hpBar.setPosition(x,y).setDepth(dep+3);
    obj.targetRing.setPosition(x,y).setDepth(dep+3);
    if(obj.presText) obj.presText.setPosition(x,y-64).setDepth(dep+2);
    if(obj.weaponGlow) obj.weaponGlow.setPosition(x,y).setDepth(dep+1);
    if(obj.customImg) obj.customImg.setPosition(x,y).setDepth(dep+0.5);
    // Update stored data
    obj.data.x=x; obj.data.y=y;
  }

  removePlayer(id) {
    const obj=this.playerObjs[id]; if(!obj) return;
    [obj.sprite,obj.nameText,obj.hpBg,obj.hpBar,obj.shadow,obj.targetRing,obj.presText,obj.weaponGlow,obj.customImg]
      .filter(Boolean).forEach(o=>o.destroy());
    delete this.playerObjs[id];
  }

  // ── Bite animation — jaw snaps open for 280ms then closes ─────────────────
  showBite(id) {
    const obj = this.playerObjs[id]; if(!obj) return;
    if(obj.customImg) return; // custom skin — no graphics bite animation needed
    const col = obj.data.skinColor || obj.data.color;
    drawDino3D(obj.sprite, col, obj.data.upgrades||[], true, obj.walkPhase||0);
    this.time.delayedCall(260, () => {
      const o = this.playerObjs[id]; if(!o) return;
      drawDino3D(o.sprite, o.data.skinColor || o.data.color, o.data.upgrades||[], false, o.walkPhase||0);
    });
  }

  // ── "Out of reach" indicator — red ring pulses at target then fades ───────
  showRangeIndicator(x, y) {
    const g = this.add.graphics().setDepth(800);
    g.lineStyle(3, 0xff2200, 0.9);
    g.strokeCircle(x, y, 36);
    const txt = this.add.text(x, y-52, '⚔️ Too far!', {
      fontSize:'13px', color:'#ff4444', fontFamily:'Segoe UI',
      stroke:'#000', strokeThickness:3
    }).setOrigin(0.5).setDepth(801);
    this.tweens.add({targets:[g,txt], alpha:0, duration:600, onComplete:()=>{g.destroy();txt.destroy();}});
  }

  spawnDrop(drop) {
    if(this.moneyDropObjs[drop.id]) return;
    const g=this.add.graphics();
    // Bone/fossil coin appearance
    g.fillStyle(0xd4af37,1); g.fillCircle(0,0,11);
    g.fillStyle(0xffd700,1); g.fillCircle(0,0,9);
    g.fillStyle(0xffec80,0.7); g.fillCircle(-3,-3,4);
    // 🦴 symbol via text
    const icon=this.add.text(0,0,'🦴',{fontSize:'12px'}).setOrigin(0.5);
    g.setPosition(drop.x,drop.y).setDepth(60);
    icon.setPosition(drop.x,drop.y).setDepth(61);
    const amtText=this.add.text(drop.x,drop.y-18,`$${drop.amount}`,{
      fontSize:'10px',color:'#ffd700',fontFamily:'Segoe UI',fontStyle:'bold',stroke:'#000',strokeThickness:3
    }).setOrigin(0.5).setDepth(62);
    this.tweens.add({targets:[g,icon,amtText],y:'+=5',yoyo:true,repeat:-1,duration:900,ease:'Sine.InOut'});
    this.moneyDropObjs[drop.id]={gfx:g,icon,label:amtText,data:drop};
  }

  removeDrop(id) {
    const d=this.moneyDropObjs[id]; if(!d) return;
    [d.gfx,d.icon,d.label].forEach(o=>{this.tweens.add({targets:o,y:'-=30',alpha:0,duration:350,onComplete:()=>o.destroy()});});
    delete this.moneyDropObjs[id];
  }

  // ── Buildings ──────────────────────────────────────────────────────────────
  spawnBuilding(b) {
    if (this.buildingObjs[b.id]) return;
    const isOwn  = b.ownerId === this.myId;
    const isWall = b.upgradeId === 'stoneWall' || b.upgradeId === 'fossilFortress';

    // Main building graphic
    const gfx = this.add.graphics().setDepth(50);
    gfx._wallOrientation = b.orientation || 'h';  // pass orientation to draw function
    this.drawBuilding(gfx, b.upgradeId, b.ownerColor, b.type, b.defType, 1.0, {orientation: b.orientation||'h'});
    gfx.setPosition(b.x, b.y);

    // HP bar — width matches the wall's longer dimension
    const wallW = isWall ? 28 : 22;
    const hpBg = this.add.graphics().setDepth(51);
    hpBg.fillStyle(0x000000, 0.7); hpBg.fillRoundedRect(-wallW, -28, wallW*2, 6, 3);
    hpBg.setPosition(b.x, b.y);

    // HP bar fill
    const hpBar = this.add.graphics().setDepth(52);
    this._redrawBuildingHP(hpBar, b.hp, b.maxHp, b.x, b.y, b.type, wallW);

    // Name label
    const icons = {bonePile1:'🦴',bonePile2:'⛏️',bonePile3:'🌿',bonePile4:'🏛️',bonePile5:'💎',
                   stoneWall:'🪨',spikeTrap:'🔺',thornHedge:'🌵',dinoTurret:'🗼',fossilFortress:'🏰',
                   iceTower:'🧊',tarPit:'🕳️',lavaPit:'🌋',healingTotem:'✨',boneCannon:'💣',conveyorBelt:'➡️'};
    const label = this.add.text(b.x, b.y-48, (icons[b.upgradeId]||'🏗️'), {
      fontSize:'18px', stroke:'#000', strokeThickness:3
    }).setOrigin(0.5).setDepth(53);

    // Owner ring (coloured border around building)
    const ring = this.add.graphics().setDepth(49);
    const col = parseInt(b.ownerColor.replace('#',''), 16);
    ring.lineStyle(2, col, 0.5); ring.strokeCircle(b.x, b.y, 30);

    this.buildingObjs[b.id] = { gfx, hpBg, hpBar, label, ring, data: {...b} };
  }

  drawBuilding(gfx, upgradeId, ownerColor, type, defType, alpha=1, upgInfo={}) {
    gfx.clear();
    const col = parseInt(ownerColor.replace('#',''), 16);
    const dark = 0x222222;

    // 3D depth: offset shadow beneath building to suggest height/volume
    gfx.fillStyle(0x000000, 0.28 * alpha);
    if (defType === 'wall') {
      const _o = upgInfo?.orientation || 'h';
      const _hw = _o === 'h' ? 26 : 7, _hh = _o === 'h' ? 7 : 26;
      gfx.fillRect(-_hw + 5, -_hh + 6, _hw * 2, _hh * 2);
    } else {
      gfx.fillEllipse(5, 8, 56, 20);
    }

    if (upgradeId === 'bonePile1') {
      // Pile of bones
      gfx.fillStyle(0xd4c49a,alpha); gfx.fillEllipse(0,8,40,16);
      gfx.fillStyle(0xf0e6c8,alpha); gfx.fillRoundedRect(-12,-8,24,12,4);
      gfx.fillStyle(0xf0e6c8,alpha); gfx.fillRoundedRect(-8,-14,16,10,3);
      gfx.fillStyle(0xfff8e0,0.6*alpha); gfx.fillCircle(-10,-5,5); gfx.fillCircle(10,-5,5);
    } else if (upgradeId === 'bonePile2') {
      // Fossil mine — shaft entrance
      gfx.fillStyle(0x555544,alpha); gfx.fillRect(-22,-18,44,28);
      gfx.fillStyle(0x1a1a10,alpha); gfx.fillRect(-14,-12,28,22);
      gfx.fillStyle(0x8b7355,alpha); gfx.fillRect(-22,-22,44,6);
      gfx.fillStyle(0xd4af37,0.7*alpha); gfx.fillRect(-4,-6,8,14);  // cart
      gfx.lineStyle(2,0xd4af37,alpha); gfx.beginPath(); gfx.moveTo(0,-22); gfx.lineTo(0,-18); gfx.strokePath();
    } else if (upgradeId === 'bonePile3') {
      // Amber vault — dome
      gfx.fillStyle(0xffa500,0.3*alpha); gfx.fillEllipse(0,-4,52,40);
      gfx.fillStyle(0xffd700,alpha); gfx.fillEllipse(0,-6,44,34);
      gfx.fillStyle(0xffe680,0.5*alpha); gfx.fillEllipse(-8,-12,20,14);
      gfx.fillStyle(0x886600,alpha); gfx.fillRect(-20,10,40,8);
    } else if (upgradeId === 'bonePile4') {
      // Dino Museum — columned building
      gfx.fillStyle(0xccbbaa,alpha); gfx.fillRect(-26,-22,52,32);
      gfx.fillStyle(0xddccbb,alpha); gfx.fillRect(-30,-26,60,8);
      gfx.fillStyle(0xbbaa99,alpha);
      for(let cx=-20;cx<=20;cx+=10){ gfx.fillRect(cx-3,-22,6,28); }
      gfx.fillStyle(0x665544,alpha); gfx.fillTriangle(-30,-26,0,-44,30,-26);
    } else if (upgradeId === 'bonePile5') {
      // Prehistoric Bank — grand structure
      gfx.fillStyle(0x88ccff,0.15*alpha); gfx.fillRect(-32,-30,64,42);
      gfx.fillStyle(0xaaddff,alpha); gfx.fillRect(-28,-26,56,38);
      gfx.fillStyle(0x66aadd,alpha); gfx.fillRect(-32,-30,64,6);
      gfx.fillStyle(0x224466,alpha); gfx.fillRect(-8,-16,16,20);  // door
      gfx.fillStyle(0xffd700,alpha); gfx.fillCircle(0,-30,10); gfx.fillStyle(0xfff,0.6*alpha); gfx.fillCircle(-2,-32,5);
    } else if (defType === 'wall') {
      const orient = upgInfo?.orientation || gfx._wallOrientation || 'h';
      const isH = (orient === 'h');
      const W = 52, T = 13;  // length, thickness
      const hw = isH ? W/2 : T/2, hh = isH ? T/2 : W/2;
      // Base stone
      gfx.fillStyle(0x777770,alpha); gfx.fillRect(-hw,-hh,hw*2,hh*2);
      // Stone block lines
      gfx.lineStyle(1,0x555550,0.7*alpha);
      if (isH) {
        gfx.strokeRect(-hw,-hh,hw*2,hh*2);
        gfx.beginPath(); gfx.moveTo(-hw/2,-hh); gfx.lineTo(-hw/2,hh); gfx.strokePath();
        gfx.beginPath(); gfx.moveTo(hw/2,-hh);  gfx.lineTo(hw/2,hh);  gfx.strokePath();
      } else {
        gfx.strokeRect(-hw,-hh,hw*2,hh*2);
        gfx.beginPath(); gfx.moveTo(-hw,-hh/2); gfx.lineTo(hw,-hh/2); gfx.strokePath();
        gfx.beginPath(); gfx.moveTo(-hw,hh/2);  gfx.lineTo(hw,hh/2);  gfx.strokePath();
      }
      // Top highlight
      gfx.fillStyle(0xaaaaaa,0.25*alpha); gfx.fillRect(-hw,-hh,hw*2,3);
      // Battlements (small notches along top)
      gfx.fillStyle(0x777770,alpha);
      if (isH) {
        for(let bx=-hw+4;bx<hw-4;bx+=12){ gfx.fillRect(bx,-hh-5,7,5); }
      } else {
        for(let by=-hh+4;by<hh-4;by+=12){ gfx.fillRect(-hw-5,by,5,7); }
      }
    } else if (upgradeId === 'spikeTrap') {
      // Spike trap — ground spikes
      gfx.fillStyle(0x444400,alpha); gfx.fillRect(-24,-4,48,12);
      gfx.fillStyle(0xcccc00,alpha);
      for(let sx=-18;sx<=18;sx+=9){ gfx.fillTriangle(sx,-4,sx+4,8,sx+8,-4); }
    } else if (upgradeId === 'thornHedge') {
      // Thorn hedge — spiky bush
      gfx.fillStyle(0x1a5c1a,alpha); gfx.fillEllipse(0,4,50,28);
      gfx.fillStyle(0x2d8a2d,alpha); gfx.fillEllipse(-12,-2,24,20); gfx.fillEllipse(12,-2,24,20); gfx.fillEllipse(0,-8,22,18);
      gfx.fillStyle(0x888800,alpha);
      [[-18,0],[18,0],[0,-16],[-10,-10],[10,-10]].forEach(([tx,ty])=>{
        gfx.fillTriangle(tx-3,ty,tx,ty-8,tx+3,ty);
      });
    } else if (upgradeId === 'dinoTurret') {
      // Dino turret — tower with barrel
      gfx.fillStyle(0x886644,alpha); gfx.fillRect(-12,0,24,20);
      gfx.fillStyle(0xaa8866,alpha); gfx.fillRect(-14,-18,28,20);
      gfx.fillStyle(0x775533,alpha); gfx.fillRect(-14,-22,28,6);
      // Battlements
      gfx.fillStyle(0xaa8866,alpha);
      gfx.fillRect(-14,-28,8,8); gfx.fillRect(-2,-28,8,8); gfx.fillRect(8,-28,8,8);
      // Barrel
      gfx.fillStyle(0x444444,alpha); gfx.fillRect(10,-12,16,6);
      gfx.fillStyle(0x222222,alpha); gfx.fillCircle(26,-9,4);
    } else if (upgradeId === 'fossilFortress') {
      // Fossil Fortress — big castle
      gfx.fillStyle(0x665544,alpha); gfx.fillRect(-26,-10,52,30);
      gfx.fillStyle(0x887766,alpha); gfx.fillRect(-28,-30,56,22);
      gfx.fillStyle(0x998877,alpha); gfx.fillRect(-32,-34,64,6);
      // Towers
      gfx.fillStyle(0x887766,alpha); gfx.fillRect(-32,-24,14,14); gfx.fillRect(18,-24,14,14);
      gfx.fillStyle(0x998877,alpha);
      gfx.fillRect(-34,-28,8,6); gfx.fillRect(-28,-28,8,6);
      gfx.fillRect(20,-28,8,6);  gfx.fillRect(26,-28,8,6);
      // Big cannon barrel
      gfx.fillStyle(0x333333,alpha); gfx.fillRect(14,-8,24,8);
      gfx.fillStyle(0x111111,alpha); gfx.fillCircle(38,-4,5);
      gfx.fillStyle(0x222222,alpha); gfx.fillRect(-12,-4,10,18); // gate
    } else if (upgradeId === 'tarPit') {
      // Dark bubbling tar pool
      gfx.fillStyle(0x0a0a0a,alpha); gfx.fillEllipse(0,4,52,28);
      gfx.fillStyle(0x1a1a1a,alpha); gfx.fillEllipse(-2,2,42,20);
      gfx.fillStyle(0x2a2a2a,0.7*alpha); gfx.fillCircle(-10,0,5); gfx.fillCircle(8,2,4); gfx.fillCircle(-2,-4,3);
      gfx.fillStyle(0x111111,0.5*alpha); gfx.fillCircle(-10,0,3); gfx.fillCircle(8,2,2);
    } else if (upgradeId === 'lavaPit') {
      // Glowing orange lava pool
      gfx.fillStyle(0x8b1a00,alpha); gfx.fillEllipse(0,4,54,30);
      gfx.fillStyle(0xff4400,alpha); gfx.fillEllipse(0,2,44,22);
      gfx.fillStyle(0xff7700,0.7*alpha); gfx.fillEllipse(-6,-2,24,12); gfx.fillEllipse(10,4,18,10);
      gfx.fillStyle(0xffaa00,0.5*alpha); gfx.fillEllipse(-4,-4,12,6);
      gfx.fillStyle(0xff5500,0.8*alpha); gfx.fillCircle(-8,0,4); gfx.fillCircle(10,-2,3);
    } else if (upgradeId === 'iceTower') {
      // Blue ice cone tower with icicles
      gfx.fillStyle(0x2266aa,alpha); gfx.fillRect(-10,0,20,20);
      gfx.fillStyle(0x99eeff,alpha); gfx.fillTriangle(-13,0,13,0,0,-30);
      gfx.fillStyle(0xbbf4ff,0.55*alpha); gfx.fillTriangle(-4,-2,4,-2,0,-18);
      gfx.fillStyle(0xaadeee,alpha);
      gfx.fillTriangle(-8,20,-4,20,-6,30); gfx.fillTriangle(-1,20,3,20,1,27); gfx.fillTriangle(5,20,9,20,7,33);
    } else if (upgradeId === 'healingTotem') {
      // Purple pole with glowing healing orb
      gfx.fillStyle(0x5533aa,alpha); gfx.fillRect(-6,-8,12,28);
      gfx.fillStyle(0x7744cc,alpha); gfx.fillRect(-9,-14,18,8);
      gfx.fillStyle(0xff66ff,alpha); gfx.fillCircle(0,-22,11);
      gfx.fillStyle(0xffaaff,0.55*alpha); gfx.fillCircle(-3,-25,5);
      gfx.fillStyle(0x00ff88,0.9*alpha); gfx.fillRect(-1,-28,2,12); gfx.fillRect(-5,-24,10,2);
    } else if (upgradeId === 'boneCannon') {
      // Bone-white cannon on wheels
      gfx.fillStyle(0xbbbbaa,alpha); gfx.fillRect(-16,-6,30,22);
      gfx.fillStyle(0xddddcc,alpha); gfx.fillRect(-14,-10,26,18);
      gfx.fillStyle(0x998877,alpha); gfx.fillCircle(-10,12,7); gfx.fillCircle(10,12,7);
      gfx.fillStyle(0x776655,alpha); gfx.fillCircle(-10,12,4); gfx.fillCircle(10,12,4);
      gfx.fillStyle(0xeeeedd,alpha); gfx.fillRect(10,-4,26,10);
      gfx.fillStyle(0xccccbb,alpha); gfx.fillCircle(36,1,7);
      gfx.fillStyle(0xfff8e0,0.6*alpha); gfx.fillCircle(-4,2,4); gfx.fillCircle(4,2,4);
    } else if (upgradeId === 'conveyorBelt') {
      // Top-down belt strip with arrow chevrons
      gfx.fillStyle(0x6b6354,alpha); gfx.fillRoundedRect(-16,-34,32,68,6);
      gfx.fillStyle(0x3a3a3a,alpha); gfx.fillRoundedRect(-12,-30,24,60,4);
      gfx.fillStyle(0xffd700,0.9*alpha);
      for (let i=-2;i<=1;i++){ gfx.fillTriangle(-8,i*14+2, 8,i*14+2, 0,i*14+12); }
    }
  }

  _redrawBuildingHP(bar, hp, maxHp, x, y, type, w=22) {
    bar.clear();
    const pct = Math.max(0, hp/maxHp);
    const col = type === 'income' ? 0xffd700 : 0x00aaff;
    bar.fillStyle(col, 0.9);
    bar.fillRoundedRect(x-w, y-28, w*2*pct, 6, 3);
  }

  removeBuilding(id) {
    const obj = this.buildingObjs[id]; if (!obj) return;
    [obj.gfx, obj.hpBg, obj.hpBar, obj.label, obj.ring].filter(Boolean).forEach(o => {
      this.tweens.add({ targets:o, alpha:0, scaleX:1.5, scaleY:1.5, duration:400, onComplete:()=>o.destroy() });
    });
    delete this.buildingObjs[id];
  }

  showSwipe(x1,y1,x2,y2) {
    const g=this.add.graphics();
    g.lineStyle(4,0xff4400,0.8);
    g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.strokePath();
    g.setDepth(700);
    this.tweens.add({targets:g,alpha:0,duration:250,onComplete:()=>g.destroy()});
  }

  showDamageNum(x,y,dmg) {
    const t=this.add.text(x,y-30,`-${dmg}`,{
      fontSize: dmg>40?'22px':'15px', color: dmg>40?'#ff4400':'#fff',
      fontFamily:'Segoe UI',fontStyle:'bold',stroke:'#000',strokeThickness:4
    }).setOrigin(0.5).setDepth(750);
    this.tweens.add({targets:t,y:y-80,alpha:0,duration:1000,ease:'Power2',onComplete:()=>t.destroy()});
  }

  showHitEffect(x,y,colorNum) {
    for(let i=0;i<10;i++){
      const a=(i/10)*Math.PI*2;
      const p=this.add.graphics(); p.fillStyle(colorNum,1); p.fillCircle(0,0,3+Math.random()*3);
      p.setPosition(x,y).setDepth(700);
      this.tweens.add({targets:p,x:x+Math.cos(a)*50,y:y+Math.sin(a)*50,alpha:0,duration:400+Math.random()*200,onComplete:()=>p.destroy()});
    }
  }

  showDeathEffect(x,y) {
    // Big bone explosion
    for(let i=0;i<20;i++){
      const a=(i/20)*Math.PI*2, d=20+Math.random()*80;
      const p=this.add.text(x,y,'🦴',{fontSize:`${8+Math.random()*12}px`}).setDepth(750);
      this.tweens.add({targets:p,x:x+Math.cos(a)*d,y:y+Math.sin(a)*d,alpha:0,angle:Math.random()*360,duration:700+Math.random()*400,onComplete:()=>p.destroy()});
    }
    this.cameras.main.flash(400,255,50,0);
  }

  showCollectFX(x,y,amount) {
    const t=this.add.text(x,y,`+$${amount}`,{fontSize:'15px',color:'#ffd700',fontFamily:'Segoe UI',fontStyle:'bold',stroke:'#000',strokeThickness:3}).setOrigin(0.5).setDepth(700);
    this.tweens.add({targets:t,y:y-60,alpha:0,duration:1000,ease:'Power2',onComplete:()=>t.destroy()});
  }

  showLevelUpFX(x,y,level) {
    const t=this.add.text(x,y-50,`🌟 LEVEL ${level}!`,{fontSize:'22px',color:'#ffd700',fontFamily:'Segoe UI',fontStyle:'bold',stroke:'#000',strokeThickness:4}).setOrigin(0.5).setDepth(750);
    this.tweens.add({targets:t,y:y-110,alpha:0,duration:2200,onComplete:()=>t.destroy()});
    this.cameras.main.flash(300,255,215,0);
  }

  update(time, delta) {
    if(!this.myPlayer||!this.myId) return;
    // No movement/actions while dead or during countdown
    if(this.myPlayer.isDead || this._countdown > 0) return;
    const dt=delta/1000;
    const speed=this.myPlayer.speed||260;
    let vx=0,vy=0;
    if(this.keys.left.isDown||this.keys.leftArr.isDown)  vx-=1;
    if(this.keys.right.isDown||this.keys.rightArr.isDown) vx+=1;
    if(this.keys.up.isDown||this.keys.upArr.isDown)       vy-=1;
    if(this.keys.down.isDown||this.keys.downArr.isDown)   vy+=1;
    if(vx&&vy){vx*=0.707;vy*=0.707;}

    const moving=vx||vy;
    let dir=this.playerObjs[this.myId]?.dir||0;
    if(moving){
      const WALL_TYPES  = ['stoneWall','fossilFortress'];
      const WALL_RADIUS = 32;
      const KNOCKBACK   = 120;  // pixels pushed back on wall contact or being hit
      const nx=Math.max(22,Math.min(WORLD_SIZE-22,this.myPlayer.x+vx*speed*dt));
      const ny=Math.max(22,Math.min(WORLD_SIZE-22,this.myPlayer.y+vy*speed*dt));

      // Rectangular collision for slim walls — matches visual exactly
      const wallHit = (b, px, py) => {
        if (!WALL_TYPES.includes(b.data.upgradeId) || b.data.hp <= 0) return false;
        if (b.data.ownerId === this.myId) return false;   // owner passes through
        const isH = (b.data.orientation || 'h') === 'h';
        const hw = isH ? 28 : 9, hh = isH ? 9 : 28;     // half-extents + player radius (4px)
        return Math.abs(px - b.data.x) < hw && Math.abs(py - b.data.y) < hh;
      };

      const collidingWall = Object.entries(this.buildingObjs).find(([,b]) => wallHit(b, nx, ny));
      if (!collidingWall) {
        this.myPlayer.x = nx; this.myPlayer.y = ny;
      } else {
        const hitX = Object.values(this.buildingObjs).some(b => wallHit(b, nx, this.myPlayer.y));
        const hitY = Object.values(this.buildingObjs).some(b => wallHit(b, this.myPlayer.x, ny));
        if (!hitX) this.myPlayer.x = nx;
        if (!hitY) this.myPlayer.y = ny;

        // Contact damage + knockback away from wall
        const now2 = Date.now();
        if (!this._lastWallHit || now2 - this._lastWallHit > 800) {
          this._lastWallHit = now2;
          const [wid, wobj] = collidingWall;
          window.gameSocket.emit('wallContact', wid);
          window.SFX?.hit();
          // Knockback: push player away from wall centre
          const wx = wobj.data.x, wy = wobj.data.y;
          const klen = Math.hypot(this.myPlayer.x - wx, this.myPlayer.y - wy) || 1;
          this.myPlayer.x = Math.max(22, Math.min(WORLD_SIZE-22,
            this.myPlayer.x + ((this.myPlayer.x - wx) / klen) * KNOCKBACK));
          this.myPlayer.y = Math.max(22, Math.min(WORLD_SIZE-22,
            this.myPlayer.y + ((this.myPlayer.y - wy) / klen) * KNOCKBACK));
          if ((window.GAME_SETTINGS||{}).cameraShake !== false) this.cameras.main.shake(120, 0.012);
        }
      }
      dir=Math.atan2(vy,vx);
      if(this.playerObjs[this.myId]) this.playerObjs[this.myId].dir=dir;
      this.setPos(this.myId,this.myPlayer.x,this.myPlayer.y,dir);
      this.cameras.main.scrollX=this.myPlayer.x-this.cameras.main.width/2;
      this.cameras.main.scrollY=this.myPlayer.y-this.cameras.main.height/2;
      if(time-this.lastMoveTime>48){
        window.gameSocket.emit('move',{x:this.myPlayer.x,y:this.myPlayer.y,dir});
        this.lastMoveTime=time;
      }
    }

    // ── Pad pulse animation ──
    if(this.myPlayer.padIdx!==undefined&&this.padGraphics[this.myPlayer.padIdx]) {
      const pad=PADS_DATA[this.myPlayer.padIdx];
      const pg=this.padGraphics[this.myPlayer.padIdx];
      pg.clear();
      const pulse=0.1+0.06*Math.sin(time*0.003);
      pg.fillStyle(pad.hex,pulse);
      pg.fillRect(pad.x,pad.y,PAD_SIZE,PAD_SIZE);
      pg.lineStyle(4,pad.hex,0.7+0.3*Math.sin(time*0.003));
      pg.strokeRect(pad.x,pad.y,PAD_SIZE,PAD_SIZE);
    }

    // ── Attack range highlight — shows ring on enemies within reach ──
    const ptr = this.input.activePointer;
    const pwx = ptr.worldX, pwy = ptr.worldY;
    let anyHovered = false;
    for(const [id,obj] of Object.entries(this.playerObjs)) {
      if(id===this.myId) continue;
      const myDist = Phaser.Math.Distance.Between(this.myPlayer.x,this.myPlayer.y,obj.data.x,obj.data.y);
      const inReach = myDist <= 280 && !obj.data.isDead;
      // Is cursor hovering near this opponent?
      const hovered = Phaser.Math.Distance.Between(pwx,pwy,obj.data.x,obj.data.y) < 52;
      obj.targetRing.clear(); obj.targetRing.setVisible(inReach||hovered);
      if(inReach && hovered) {
        // Green ring: in reach AND hovering = can attack
        obj.targetRing.lineStyle(3, 0x00ff44, 0.85);
        obj.targetRing.strokeCircle(0,0,34);
        obj.targetRing.lineStyle(1, 0xffffff, 0.25);
        obj.targetRing.strokeCircle(0,0,40);
        anyHovered = true;
      } else if(inReach) {
        // Orange ring: in reach but not hovering
        obj.targetRing.lineStyle(2,0xff8800,0.5+0.3*Math.sin(time*0.006));
        obj.targetRing.strokeCircle(0,0,32);
      } else if(hovered) {
        // Red ring: hovering but too far
        obj.targetRing.lineStyle(2,0xff2200,0.6);
        obj.targetRing.strokeCircle(0,0,32);
        anyHovered = true;
      }
    }
    // Change cursor to crosshair when hovering an opponent
    this.game.canvas.style.cursor = anyHovered ? 'crosshair' : 'default';

    // ── Auto-collect drops ──
    for(const [id,d] of Object.entries(this.moneyDropObjs)) {
      if(Phaser.Math.Distance.Between(this.myPlayer.x,this.myPlayer.y,d.data.x,d.data.y)<55) {
        window.gameSocket.emit('collectDrop',parseInt(id));
      }
    }
  }
}

// ── Start Phaser ──────────────────────────────────────────────────────────────
function startPhaserGame(readyCb) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'gameContainer',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0d2a0d',
    scene: [GameScene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  window.addEventListener('resize',()=>game.scale.resize(window.innerWidth,window.innerHeight));

  // Wait for scene ready
  const poll = setInterval(()=>{
    const scene = game.scene.getScene('GameScene');
    if(scene&&scene.sys.isActive()){
      clearInterval(poll);
      window._gameReady=true;
      window._gameScene=scene;
      const cb = readyCb || window.onGameReady;
      if(window._pendingGameData) cb(window._pendingGameData);
    }
  },100);
}

window.startPhaserGame = startPhaserGame;

// ── Game data init ────────────────────────────────────────────────────────────
window.onGameReady = function(data) {
  const s = window._gameScene;

  // ── FULL RESET: destroy every object from any previous match ──
  for (const id of Object.keys(s.playerObjs||{}))    s.removePlayer(id);
  for (const id of Object.keys(s.moneyDropObjs||{})) s.removeDrop(id);
  for (const id of Object.keys(s.buildingObjs||{}))  s.removeBuilding(id);
  s.playerObjs    = {};
  s.moneyDropObjs = {};
  s.buildingObjs  = {};

  s.myId      = data.myPlayer.id;
  s.myPlayer  = data.myPlayer;
  s._countdown = 5;  // block input until server sends GO

  // Spawn everyone fresh
  s.spawnPlayer(data.myPlayer);
  s.cameras.main.centerOn(data.myPlayer.x, data.myPlayer.y);
  s.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
  for (const p of data.allPlayers) if (p.id !== data.myPlayer.id) s.spawnPlayer(p);
  for (const b of data.allBots)    s.spawnPlayer(b);

  // Spawn any pre-existing buildings
  for (const b of (data.buildings||[])) s.spawnBuilding(b);

  window.updateHUD(data.myPlayer);
  window.updateXPBar(data.myPlayer.xp, data.myPlayer.level);
  window.buildShop(data.upgrades, data.myPlayer.upgrades);
  const diffLabel = {easy:'🌿 Easy',medium:'⚔️ Medium',hard:'☄️ Hard'}[data.difficulty]||'';
  window.showToast(`🦕 ${data.myPlayer.username} — ${diffLabel} mode! Build your Dino Empire!`, 4000);
  setTimeout(()=>window.SFX?.start(), 300);

  // Only wire socket events once — re-running adds duplicate listeners
  if (!window._gameSocketEventsSetup) {
    window._gameSocketEventsSetup = true;
    setupGameSocketEvents();
  }
};

// ── Socket event handlers ─────────────────────────────────────────────────────
function setupGameSocketEvents() {
  const s = window.gameSocket;
  // Only return scene when we're in 2D mode — prevents 2D handlers from running
  // on the Three.js scene when the player switches back to 3D.
  const gs = ()=>{ const sc=window._gameScene; return (sc&&!sc._is3D)?sc:null; };

  s.on('playerJoined', p=>{
    const scene=gs(); if(!scene) return;
    scene.spawnPlayer(p);
    window.showToast(`🦕 ${p.username} joined!`);
    window.addChatMessage('🌿 System',`${p.username} entered the jungle!`,'#88aa88');
  });

  s.on('playerLeft', id=>{
    const scene=gs(); if(!scene) return;
    const u=scene.playerObjs[id]?.data?.username||'A dinosaur';
    scene.removePlayer(id);
    window.addChatMessage('🌿 System',`${u} left.`,'#88aa88');
  });

  s.on('playerMoved', ({id,x,y,dir})=>{
    const scene=gs(); if(!scene) return;
    const obj=scene.playerObjs[id]; if(!obj) return;
    const px=obj.data.x, py=obj.data.y;
    scene.tweens.add({
      targets:{t:0},t:1,duration:80,
      onUpdate:tw=>{
        const o=scene.playerObjs[id]; if(!o) return;
        const ox=Phaser.Math.Linear(px,x,tw.progress), oy=Phaser.Math.Linear(py,y,tw.progress);
        scene.setPos(id,ox,oy,dir||0);
      }
    });
    obj.data.x=x; obj.data.y=y;
  });

  s.on('botPositions', positions=>{
    const scene=gs(); if(!scene) return;
    for(const {id,x,y} of positions) {
      const obj=scene.playerObjs[id]; if(!obj) return;
      const dir=Math.atan2(y-obj.data.y, x-obj.data.x);
      const px=obj.data.x,py=obj.data.y;
      scene.tweens.add({
        targets:{t:0},t:1,duration:120,
        onUpdate:tw=>{
          const o=scene.playerObjs[id]; if(!o) return;
          scene.setPos(id,Phaser.Math.Linear(px,x,tw.progress),Phaser.Math.Linear(py,y,tw.progress),dir);
        }
      });
      obj.data.x=x; obj.data.y=y;
    }
  });

  s.on('attackResult', ({attackerId,targetId,damage,targetHp,targetMaxHp,knockback})=>{
    const scene=gs(); if(!scene) return;
    const tgt=scene.playerObjs[targetId]; if(!tgt) return;
    tgt.data.hp=targetHp; tgt.data.maxHp=targetMaxHp;
    scene.redrawHP(tgt.hpBar,targetHp,targetMaxHp);
    scene.showDamageNum(tgt.data.x,tgt.data.y,damage);
    scene.showHitEffect(tgt.data.x,tgt.data.y,hexStr2num(tgt.data.color));
    scene.showBite(attackerId);
    // Apply knockback position
    if (knockback) {
      if (targetId === scene.myId) {
        // Instant knockback — no tween so WASD input doesn't fight it
        scene.myPlayer.x = knockback.x;
        scene.myPlayer.y = knockback.y;
        scene.setPos(scene.myId, knockback.x, knockback.y);
        // Snap camera instantly too
        scene.cameras.main.scrollX = knockback.x - scene.cameras.main.width/2;
        scene.cameras.main.scrollY = knockback.y - scene.cameras.main.height/2;
        if ((window.GAME_SETTINGS||{}).cameraShake !== false)
          scene.cameras.main.shake(140, 0.014);
        window.SFX?.hit();
      } else {
        tgt.data.x = knockback.x; tgt.data.y = knockback.y;
        scene.setPos(targetId, knockback.x, knockback.y);
      }
    }
    if(targetId===scene.myId) window.SFX?.hit();
    else window.SFX?.crunch();
    const atk=scene.playerObjs[attackerId];
    if(atk&&attackerId!==scene.myId) scene.showSwipe(atk.data.x,atk.data.y,tgt.data.x,tgt.data.y);
    if(targetId===scene.myId){
      scene.myPlayer.hp=targetHp;
      window.updateHUD(scene.myPlayer);
      scene.cameras.main.shake(180,0.01);
    }
  });

  const KILL_MSGS = [
    (k,v)=>`🦷 ${k} chomped ${v} into fossils!`,
    (k,v)=>`☄️ ${k} sent ${v} back to the Cretaceous!`,
    (k,v)=>`💀 ${v} is now extinct — eliminated by ${k}!`,
    (k,v)=>`🦴 ${k} turned ${v} into a bone pile!`,
    (k,v)=>`🌋 ${k} obliterated ${v}!`,
    (k,v)=>`🦖 ${k} devoured ${v} whole!`,
    (k,v)=>`⚡ ${v} couldn't survive ${k}'s rampage!`,
  ];
  s.on('playerDied', ({victimId,killerId,loot,killerMoney})=>{
    const scene=gs(); if(!scene) return;
    const victim=scene.playerObjs[victimId];
    const killer=scene.playerObjs[killerId];
    if(victim){
      scene.showDeathEffect(victim.data.x,victim.data.y);
      victim.data.isDead=true;
      victim.sprite.setAlpha(0.2); victim.nameText.setAlpha(0.3);
    }
    if(killer) killer.data.money=killerMoney;
    const vn=victim?.data?.username||'???', kn=killer?.data?.username||'???';
    const vc=victim?.data?.color||'#ccc', kc=killer?.data?.color||'#fff';
    const vIsBot=victim?.data?.isBot, kIsBot=killer?.data?.isBot;

    // Kill feed (top-right visual)
    window.addKillFeed(`<span style="color:${kc}">${kn}</span> ☄️ <span style="color:${vc}">${vn}</span> <span style="color:#ffd700">(+$${loot})</span>`);

    // Activity chat message
    const msg = KILL_MSGS[Math.floor(Math.random()*KILL_MSGS.length)](kn, vn);
    const chatColor = kIsBot&&vIsBot ? '#a29bfe' : kIsBot ? '#ff7675' : '#ffd700';
    window.addChatMessage('⚔️ Arena', msg, chatColor);

    if(victimId===scene.myId){
      scene.myPlayer.isDead=true;
      window.SFX?.death();
      document.getElementById('deathScreen').classList.add('active');
      let sec=5;
      const iv=setInterval(()=>{
        sec--;
        document.getElementById('deathMsg').textContent=sec>0?`Respawning in ${sec}s...`:'Respawning...';
        if(sec<=0)clearInterval(iv);
        if(sec>0) window.SFX?.countdown();
      },1000);
    }
    if(killerId===scene.myId){
      scene.myPlayer.money=killerMoney; scene.myPlayer.kills++;
      window.updateHUD(scene.myPlayer);
      window.SFX?.kill();
      window.showToast(`☄️ Fossilized ${vn}! +$${loot}`);
    }
  });

  s.on('playerRespawned', ({id,x,y,hp,maxHp})=>{
    const scene=gs(); if(!scene) return;
    const obj=scene.playerObjs[id]; if(!obj) return;
    obj.data.isDead=false; obj.data.hp=hp; obj.data.maxHp=maxHp;
    obj.sprite.setAlpha(1); obj.nameText.setAlpha(1);
    scene.setPos(id,x,y); scene.redrawHP(obj.hpBar,hp,maxHp);
    if(id===scene.myId){
      scene.myPlayer.isDead=false; scene.myPlayer.hp=hp; scene.myPlayer.maxHp=maxHp;
      scene.myPlayer.x=x; scene.myPlayer.y=y;
      document.getElementById('deathScreen').classList.remove('active');
      scene.cameras.main.centerOn(x,y);
      window.updateHUD(scene.myPlayer);
      window.showToast('🦕 Respawned! Back from extinction!');
    }
  });

  // ── Building events ──
  s.on('buildingPlaced', b=>{ const scene=gs(); if(scene) scene.spawnBuilding(b); window.SFX?.upgrade(); });

  s.on('buildingDamaged', ({id,hp,maxHp,damage})=>{
    const scene=gs(); if(!scene) return;
    const obj=scene.buildingObjs[id]; if(!obj) return;
    obj.data.hp=hp; obj.data.maxHp=maxHp;
    const bIsWall = obj.data.upgradeId==='stoneWall'||obj.data.upgradeId==='fossilFortress';
    scene._redrawBuildingHP(obj.hpBar, hp, maxHp, obj.data.x, obj.data.y, obj.data.type, bIsWall?28:22);
    scene.showDamageNum(obj.data.x, obj.data.y, damage);
    // Walls dim as they take damage to signal they're weakening
    const pct = hp/maxHp;
    obj.gfx.setAlpha(0.4 + pct*0.6);
    // Screen shake if it's your building being hit
    if(obj.data.ownerId === scene.myId) scene.cameras.main.shake(80, 0.005);
    window.SFX?.hit();
  });

  s.on('buildingDestroyed', ({id, destroyerName, ownerName, buildingName})=>{
    const scene=gs(); if(!scene) return;
    scene.removeBuilding(id);
    window.addChatMessage('🏚️ Destroy', `${destroyerName} destroyed ${ownerName}'s ${buildingName}!`, '#ff6b35');
    window.SFX?.death();
    window.addKillFeed(`<span style="color:#ff6b35">🏚️ ${destroyerName}</span> destroyed <span style="color:#ffd700">${ownerName}'s ${buildingName}</span>!`);
  });

  s.on('turretFired', ({buildingId, targetId, damage, targetHp, x, y})=>{
    const scene=gs(); if(!scene) return;
    const tgt=scene.playerObjs[targetId]; if(!tgt) return;
    tgt.data.hp=targetHp;
    scene.redrawHP(tgt.hpBar, targetHp, tgt.data.maxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    // Draw turret projectile line
    const g=scene.add.graphics().setDepth(800);
    g.lineStyle(2,0xff6600,0.9); g.beginPath(); g.moveTo(x,y); g.lineTo(tgt.data.x,tgt.data.y); g.strokePath();
    scene.tweens.add({targets:g,alpha:0,duration:200,onComplete:()=>g.destroy()});
    if(targetId===scene.myId){ window.SFX?.hit(); scene.cameras.main.shake(120,0.008); }
  });

  s.on('trapTriggered', ({buildingId, targetId, damage, targetHp})=>{
    const scene=gs(); if(!scene) return;
    const tgt=scene.playerObjs[targetId]; if(!tgt) return;
    tgt.data.hp=targetHp;
    scene.redrawHP(tgt.hpBar, targetHp, tgt.data.maxHp);
    scene.showDamageNum(tgt.data.x, tgt.data.y, damage);
    if(targetId===scene.myId){ window.SFX?.hit(); }
  });

  s.on('moneyDropSpawned', drop=>{ const scene=gs(); if(scene) scene.spawnDrop(drop); });

  s.on('dropsMoved', moved=>{
    // Coin drops nudged along a Conveyor Belt this tick — without this the 2D view
    // never reflects the server-side pull, leaving drops visually frozen while their
    // real (server) position drifts away, eventually making them look uncollectible.
    const scene=gs(); if(!scene) return;
    for(const {id,x,y} of moved) {
      const d=scene.moneyDropObjs[id]; if(!d) continue;
      d.data.x=x; d.data.y=y;
      d.gfx.setPosition(x,y); d.icon.setPosition(x,y); d.label.setPosition(x,y-18);
    }
  });

  s.on('dropCollected', ({dropId,playerId,money})=>{
    const scene=gs(); if(!scene) return;
    const drop=scene.moneyDropObjs[dropId];
    if(drop) scene.showCollectFX(drop.data.x,drop.data.y,drop.data.amount);
    scene.removeDrop(dropId);
    if(playerId===scene.myId){ scene.myPlayer.money=money; window.updateHUD(scene.myPlayer); window.SFX?.coin(); }
    else if(scene.playerObjs[playerId]) scene.playerObjs[playerId].data.money=money;
  });

  s.on('statSync', stats=>{
    const scene=gs(); if(!scene) return;
    for(const [id,st] of Object.entries(stats)){
      const obj=scene.playerObjs[id]; if(!obj) continue;
      obj.data.hp=st.hp; obj.data.isDead=st.isDead;
      scene.redrawHP(obj.hpBar,st.hp,obj.data.maxHp||100);
      if(id===scene.myId&&scene.myPlayer){
        scene.myPlayer.hp=st.hp; scene.myPlayer.money=st.money; scene.myPlayer.mps=st.mps;
        window.updateHUD(scene.myPlayer);
      }
    }
  });

  s.on('upgradeSuccess', ({upgradeId,money,stats})=>{
    const scene=gs(); if(!scene) return;
    scene.myPlayer.money=money; scene.myPlayer.upgrades.push(upgradeId);
    Object.assign(scene.myPlayer,stats);
    window.updateHUD(scene.myPlayer);
    window.buildShop(window._allUpgrades,scene.myPlayer.upgrades);
    // Redraw my dino with new upgrades
    const obj=scene.playerObjs[scene.myId];
    if(obj){ drawDino3D(obj.sprite,scene.myPlayer.color,scene.myPlayer.upgrades); }
    const u=window._allUpgrades?.[upgradeId];
    if(u) window.showToast(`${u.icon} ${u.name} acquired! ${u.desc}`);
  });

  s.on('upgradeError', msg=>window.showToast('❌ '+msg,2000));

  s.on('playerUpgraded', ({id,upgradeId})=>{
    const scene=gs(); if(!scene) return;
    const obj=scene.playerObjs[id]; if(!obj) return;
    obj.data.upgrades=obj.data.upgrades||[];
    obj.data.upgrades.push(upgradeId);
    drawDino3D(obj.sprite,obj.data.color,obj.data.upgrades);
    const u=window._allUpgrades?.[upgradeId];
    if(u){const t=scene.add.text(obj.data.x,obj.data.y-60,u.icon+' '+u.name,{fontSize:'13px',color:'#ffd700',fontFamily:'Segoe UI',stroke:'#000',strokeThickness:3}).setOrigin(0.5).setDepth(600);scene.tweens.add({targets:t,y:obj.data.y-110,alpha:0,duration:1500,onComplete:()=>t.destroy()});}
  });

  s.on('levelUp', ({level,maxHp,damage})=>{
    const scene=gs(); if(!scene||!scene.myPlayer) return;
    scene.myPlayer.level=level; scene.myPlayer.maxHp=maxHp; scene.myPlayer.damage=damage;
    window.updateHUD(scene.myPlayer);
    scene.showLevelUpFX(scene.myPlayer.x,scene.myPlayer.y,level);
    window.SFX?.levelUp();
    window.showToast(`🌟 Level Up! You reached Level ${level}!`,3000);
  });

  s.on('leaderboard', lb=>{ window.updateLeaderboard(lb); window.updateXPBar(window._gameScene?.myPlayer?.xp||0,window._gameScene?.myPlayer?.level||1); });
  s.on('chatMessage', ({username,message,color})=>window.addChatMessage(username,message,color));

  s.on('prestigeSuccess', ({prestige, speed, damage, defense, maxHp, hp, mps, regen})=>{
    const scene=gs(); if(!scene||!scene.myPlayer) return;
    Object.assign(scene.myPlayer, { prestige, money:0, upgrades:[], speed, damage, defense, maxHp, hp, mps, regen });
    window.updateHUD(scene.myPlayer);
    window.buildShop(window._allUpgrades,[]);
    const obj=scene.playerObjs[scene.myId];
    if(obj){ drawDino3D(obj.sprite,scene.myPlayer.color,[]); if(!obj.presText){obj.presText=scene.add.text(0,-66,`★${prestige}`,{fontSize:'11px',color:'#ffd700',stroke:'#000',strokeThickness:3}).setOrigin(0.5);}else obj.presText.setText(`★${prestige}`); }
    window.showToast(`⭐ PRESTIGE ${prestige}! You are a Dino Legend!`,4000);
  });

  s.on('playerPrestiged', ({id,prestige})=>{
    const scene=gs(); if(!scene) return;
    const obj=scene.playerObjs[id]; if(!obj) return;
    obj.data.prestige=prestige;
    if(obj.presText) obj.presText.setText(`★${prestige}`);
    else if(scene){obj.presText=scene.add.text(obj.data.x,obj.data.y-66,`★${prestige}`,{fontSize:'11px',color:'#ffd700',stroke:'#000',strokeThickness:3}).setOrigin(0.5).setDepth(900);}
    window.addKillFeed(`<span style="color:#ffd700">⭐ ${obj.data.username} prestiged (★${prestige})!</span>`);
  });
}
})();
