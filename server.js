const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 10000,
});

const JWT_SECRET = 'dino_tycoon_secret_2024';
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';

// ── MongoDB ───────────────────────────────────────────────────────────────────
let usersCol, savesCol;
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('dinotycoon');
  usersCol = db.collection('users');
  savesCol = db.collection('saves');
  await usersCol.createIndex({ username_lower: 1 }, { unique: true });
  console.log('✅ MongoDB connected');
}

async function findUser(u) {
  return usersCol.findOne({ username_lower: u.toLowerCase() });
}
// In-memory save cache — eliminates repeated DB round-trips per session
const _saveCache = new Map(); // userId -> { data, ts }
const SAVE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function _stripId(obj) {
  // Remove MongoDB _id so it's never passed to $set (causes "Mod on _id not allowed")
  const { _id, ...rest } = obj;
  return rest;
}
async function getSave(id) {
  const hit = _saveCache.get(id);
  if (hit && Date.now() - hit.ts < SAVE_CACHE_TTL) return JSON.parse(JSON.stringify(hit.data));
  const s = await savesCol.findOne({ userId: id });
  if (s && s.customSkin && !s.customSkins) {
    s.customSkins = [{ id: 'imported', name: 'My Skin', base64: s.customSkin }];
    s.customSkin = undefined;
    if (s.equippedSkin === 'custom') s.equippedSkin = 'custom_imported';
  }
  const raw = s || { money:0, total_earned:0, level:1, xp:0, upgrades:[], kills:0, deaths:0, prestige:0, savedGames:[], points:0, lobbyItems:{skins:[],tags:[]}, equippedSkin:'default', equippedTag:'none', customSkins:[] };
  const result = _stripId(raw);
  _saveCache.set(id, { data: result, ts: Date.now() });
  return JSON.parse(JSON.stringify(result));
}
async function putSave(id, data) {
  const clean = _stripId(data);
  _saveCache.set(id, { data: JSON.parse(JSON.stringify(clean)), ts: Date.now() });
  await savesCol.updateOne({ userId: id }, { $set: { ...clean, userId: id } }, { upsert: true });
}

// ── Game Constants ────────────────────────────────────────────────────────────
const WORLD_SIZE = 3200;
const PAD_SIZE = 620;
const PADS = [
  { x:100,  y:100,  color:'#e84393', name:'Lava Zone' },
  { x:2480, y:100,  color:'#1e90ff', name:'Ice Tundra' },
  { x:100,  y:2480, color:'#2ed573', name:'Jungle' },
  { x:2480, y:2480, color:'#ffa502', name:'Desert' },
  { x:1290, y:100,  color:'#a29bfe', name:'Sky Cliffs' },
  { x:1290, y:2480, color:'#fd79a8', name:'Swamp' },
  { x:100,  y:1290, color:'#00cec9', name:'Ocean Reef' },
  { x:2480, y:1290, color:'#fdcb6e', name:'Volcano' },
];
const PLAYER_COLORS = PADS.map(p => p.color);

const BOT_NAMES = ['RaptorBot','T-RexBot','TriceBot','BrachBot','AnkyBot','SpinoBot','CarnoBot','ParaBot','DilophBot','AlloBot'];
const HARDCORE_NAMES = ['TERROR','ALPHA','APEX','TYRANT','GOLIATH','LEVIATHAN','DOMINUS','WARLORD'];
const BOT_COLORS = ['#ff6348','#74b9ff','#55efc4','#fdcb6e','#a29bfe','#fd79a8','#00b894','#e17055'];

const UPGRADES = {
  // Income
  bonePile1:   { name:'Bone Pile',        cost:150,   icon:'🦴', effect:{mps:3},    req:null,           desc:'+$3/sec',   cat:'income' },
  bonePile2:   { name:'Fossil Mine',      cost:500,   icon:'⛏️',  effect:{mps:12},   req:'bonePile1',    desc:'+$12/sec',  cat:'income' },
  bonePile3:   { name:'Amber Vault',      cost:2500,  icon:'🌿', effect:{mps:50},   req:'bonePile2',    desc:'+$50/sec',  cat:'income' },
  bonePile4:   { name:'Dino Museum',      cost:10000, icon:'🏛️', effect:{mps:200},  req:'bonePile3',    desc:'+$200/sec', cat:'income' },
  bonePile5:   { name:'Prehistoric Bank', cost:50000, icon:'💎', effect:{mps:1000}, req:'bonePile4',    desc:'+$1k/sec',  cat:'income' },
  // Speed
  swiftStride: { name:'Swift Stride',     cost:120,   icon:'👟', effect:{speed:30},  req:null,           desc:'+30 Speed (starter)', cat:'speed' },
  raptorLegs:  { name:'Raptor Legs',      cost:300,   icon:'🦵', effect:{speed:60},  req:'swiftStride',  desc:'+60 Speed', cat:'speed' },
  pterodactyl: { name:'Pterodactyl Wings',cost:1200,  icon:'🦅', effect:{speed:120}, req:'raptorLegs',   desc:'+120 Speed',cat:'speed' },
  lightningDino:{ name:'Lightning Dino',  cost:5000,  icon:'⚡', effect:{speed:200}, req:'pterodactyl',  desc:'+200 Speed',cat:'speed' },
  meteorDash:  { name:'Meteor Dash',      cost:18000, icon:'🌠', effect:{speed:400}, req:'lightningDino',desc:'+400 Speed — blazing fast!', cat:'speed' },
  // Attack
  raptorClaw:  { name:'Raptor Claws',     cost:400,   icon:'🦖', effect:{damage:18}, req:null,           desc:'+18 Dmg',   cat:'attack' },
  trexJaw:     { name:'T-Rex Jaws',       cost:1500,  icon:'🦷', effect:{damage:35}, req:'raptorClaw',   desc:'+35 Dmg',   cat:'attack' },
  meteorStrike:{ name:'Meteor Strike',    cost:6000,  icon:'☄️', effect:{damage:80}, req:'trexJaw',      desc:'+80 Dmg',   cat:'attack' },
  // Defense
  ankyloTail:  { name:'Ankylosaur Tail',  cost:350,   icon:'🛡️', effect:{defense:10},req:null,           desc:'+10 Def',   cat:'defense' },
  thickHide:   { name:'Thick Dino Hide',  cost:1400,  icon:'🐊', effect:{defense:22},req:'ankyloTail',   desc:'+22 Def',   cat:'defense' },
  boneArmor:   { name:'Bone Armor',       cost:5500,  icon:'💀', effect:{defense:45},req:'thickHide',    desc:'+45 Def',   cat:'defense' },
  // HP
  dinoBlood:   { name:'Dino Blood',       cost:250,   icon:'❤️', effect:{maxHp:120}, req:null,           desc:'+120 HP',   cat:'health' },
  titanBody:   { name:'Titan Dino Body',  cost:900,   icon:'🦕', effect:{maxHp:300}, req:'dinoBlood',    desc:'+300 HP',   cat:'health' },
  immortalDino:{ name:'Immortal Dino',    cost:4000,  icon:'✨', effect:{maxHp:700}, req:'titanBody',    desc:'+700 HP',   cat:'health' },
  // Regen (now its own chain starting from no req)
  mossCloth:   { name:'Moss Cloth',       cost:100,   icon:'🍃', effect:{regen:2},   req:null,           desc:'+2 HP/s — starter regen',  cat:'health' },
  healingFern: { name:'Healing Ferns',    cost:600,   icon:'🌿', effect:{regen:5},   req:'mossCloth',    desc:'+5 HP/s',   cat:'health' },
  dinoVitality:{ name:'Dino Vitality',    cost:2500,  icon:'💚', effect:{regen:12},  req:'healingFern',  desc:'+12 HP/s',  cat:'health' },
  ancientBlood:{ name:'Ancient Blood',    cost:8000,  icon:'🩸', effect:{regen:30},  req:'dinoVitality', desc:'+30 HP/s',  cat:'health' },
  titanRegen:  { name:'Titan Regen',      cost:25000, icon:'💉', effect:{regen:80},  req:'ancientBlood', desc:'+80 HP/s — near unkillable!', cat:'health' },
  // ── Defense Buildings (placed on your base) ──
  stoneWall:     { name:'Stone Wall',      cost:120,   icon:'🪨', effect:{}, req:null, desc:'Blocks everyone including you (250 HP). Damages on contact.', cat:'build' },
  spikeTrap:     { name:'Spike Trap',      cost:300,   icon:'🔺', effect:{}, req:null, desc:'Damages enemies on your base (20 dmg)',    cat:'build' },
  thornHedge:    { name:'Thorn Hedge',     cost:400,   icon:'🌵', effect:{}, req:null, desc:'Slows & hurts intruders (12 dmg)',          cat:'build' },
  dinoTurret:    { name:'Dino Turret',     cost:900,   icon:'🗼', effect:{}, req:null, desc:'Auto-attacks nearby enemies (20 dmg)',      cat:'build' },
  fossilFortress:{ name:'Fossil Fortress', cost:3000,  icon:'🏰', effect:{}, req:null, desc:'Heavy fortress — powerful auto-turret (45 dmg)', cat:'build' },
  lavaPit:       { name:'Lava Pit',        cost:600,   icon:'🌋', effect:{}, req:null, desc:'Burns enemies who step on it (35 dmg, wide range)', cat:'build' },
  iceTower:      { name:'Ice Tower',       cost:1200,  icon:'🧊', effect:{}, req:null, desc:'Freezes & slows nearby enemies — long range turret (15 dmg)', cat:'build' },
  boneCannon:    { name:'Bone Cannon',     cost:2000,  icon:'💣', effect:{}, req:null, desc:'Long range cannon (55 dmg, slow fire rate)', cat:'build' },
  healingTotem:  { name:'Healing Totem',   cost:800,   icon:'🪄', effect:{}, req:null, desc:'Heals YOU when you stand near it (+20 HP/s)', cat:'build' },
  tarPit:        { name:'Tar Pit',         cost:500,   icon:'🕳️', effect:{}, req:null, desc:'Severely slows enemies who walk through it', cat:'build' },
};

// ── Lobby Shop ────────────────────────────────────────────────────────────────
const LOBBY_SHOP = {
  skins: [
    { id:'teal',    name:'Ocean Rex',     cost:1000, color:'#00bcd4', spike:'#006064', desc:'Ruler of the ancient seas.' },
    { id:'red',     name:'Lava Dino',     cost:800,  color:'#ff4757', spike:'#b71c1c', desc:'Born from the volcano\'s heart.' },
    { id:'purple',  name:'Shadow Raptor', cost:600,  color:'#9c27b0', spike:'#4a148c', desc:'Lurks in the prehistoric shadows.' },
    { id:'panda',   name:'Panda Rex',     cost:500,  color:'#f5f5f5', spike:'#111111', desc:'Black and white and fierce all over.' },
    { id:'gold',    name:'Dino King',     cost:400,  color:'#ffd700', spike:'#e65100', desc:'Royalty of the prehistoric world.' },
    { id:'blue',    name:'Glacier Rex',   cost:150,  color:'#1e90ff', spike:'#0d47a1', desc:'Ice-cold and calculating.' },
    { id:'pink',    name:'Fringling',     cost:50,   color:'#e84393', spike:'#c2185b', desc:'The iconic pink dino from the game.' },
    { id:'default', name:'Jungle Rex',    cost:0,    color:'#4caf50', spike:'#2d7a1e', desc:'The original dino. Classic.' },
  ],
  tags: [
    { id:'none',   name:'No Tag',    cost:0,    prefix:'' },
    { id:'fossil', name:'Fossil',    cost:100,  prefix:'🦴 ' },
    { id:'alpha',  name:'Alpha',     cost:250,  prefix:'[ALPHA] ' },
    { id:'king',   name:'King',      cost:500,  prefix:'👑 ' },
    { id:'terror', name:'Terror',    cost:750,  prefix:'[TERROR] ' },
    { id:'pro',    name:'Pro',       cost:1500, prefix:'⚔️ ' },
  ]
};

// ── Building Data ─────────────────────────────────────────────────────────────
const BUILDING_DATA = {
  // Income buildings (auto-placed when income upgrade bought)
  bonePile1:     { maxHp:80,  type:'income', mps:3 },
  bonePile2:     { maxHp:150, type:'income', mps:12 },
  bonePile3:     { maxHp:250, type:'income', mps:50 },
  bonePile4:     { maxHp:380, type:'income', mps:200 },
  bonePile5:     { maxHp:500, type:'income', mps:1000 },
  // Defense buildings
  stoneWall:     { maxHp:250, type:'defense', defType:'wall' },
  spikeTrap:     { maxHp:120, type:'defense', defType:'trap',    damage:20, range:70 },
  thornHedge:    { maxHp:180, type:'defense', defType:'trap',    damage:12, range:80, slow:true },
  dinoTurret:    { maxHp:200, type:'defense', defType:'turret',  damage:20, range:340, cooldown:1800 },
  fossilFortress:{ maxHp:600,  type:'defense', defType:'turret',  damage:45, range:440, cooldown:1400 },
  lavaPit:       { maxHp:150,  type:'defense', defType:'trap',    damage:35, range:100, burn:true },
  iceTower:      { maxHp:280,  type:'defense', defType:'turret',  damage:15, range:400, cooldown:2000, slow:true },
  boneCannon:    { maxHp:350,  type:'defense', defType:'turret',  damage:55, range:520, cooldown:3500 },
  healingTotem:  { maxHp:200,  type:'defense', defType:'totem',   healRate:20, range:120 },
  tarPit:        { maxHp:100,  type:'defense', defType:'trap',    damage:5,  range:90,  slow:true, slowAmt:0.25 },
};
// Slot offsets from player's base (income slots then defense slots)
const INCOME_OFFSETS  = [{dx:-90,dy:-70},{dx:0,dy:-90},{dx:90,dy:-70},{dx:-50,dy:60},{dx:50,dy:60}];
const DEFENSE_OFFSETS = [{dx:-160,dy:-120},{dx:160,dy:-120},{dx:-160,dy:120},{dx:160,dy:120},{dx:0,dy:-180}];
let buildingIdCounter = 1;

// ── Building Helpers ──────────────────────────────────────────────────────────
// Buildings that physically block movement
function isWallBuilding(upgradeId) {
  return upgradeId === 'stoneWall' || upgradeId === 'fossilFortress';
}

// Smart wall placement — snaps new wall adjacent to existing wall chain
const WALL_STEP = 46;

function getWallPlacement(room, player, upgradeId, dropX, dropY) {
  const ownerId = player.id || player.socketId;
  const myWalls = Object.values(room.buildings).filter(b =>
    b.ownerId === ownerId && isWallBuilding(b.upgradeId)
  );

  const px = dropX !== undefined ? dropX : player.x;
  const py = dropY !== undefined ? dropY : player.y;

  // ── Orientation: based on which direction the dino is facing ──
  // Facing left/right (horizontal) → horizontal wall (—)
  // Facing up/down   (vertical)   → vertical wall   (|)
  // Fallback to base-position if no direction known
  let orientation;
  if (player.dir !== undefined) {
    const facingH = Math.abs(Math.cos(player.dir)) >= Math.abs(Math.sin(player.dir));
    orientation = facingH ? 'h' : 'v';
  } else {
    const base = padCenter(player.padIdx || 0);
    orientation = Math.abs(py - base.y) >= Math.abs(px - base.x) ? 'h' : 'v';
  }

  // ── Position: place at player's feet ──
  let x = px, y = py;

  // ── Alignment: snap to row/column AND snap along-axis to wall grid ──
  const ALIGN = 100;
  if (orientation === 'h') {
    // 1. Snap Y to match the nearest horizontal row
    const row = myWalls
      .filter(w => (w.orientation||'h') === 'h' && Math.abs(w.y - py) < ALIGN)
      .sort((a,b) => Math.abs(a.y-py) - Math.abs(b.y-py));
    if (row.length) {
      y = row[0].y;
      // 2. Snap X to the nearest WALL_STEP grid relative to that row's walls
      //    so gaps are automatically filled
      const rowRef = row[0].x;
      const offset = ((px - rowRef) % WALL_STEP + WALL_STEP) % WALL_STEP;
      x = offset < WALL_STEP/2
        ? px - offset              // snap left
        : px + (WALL_STEP - offset); // snap right
    }
  } else {
    // 1. Snap X to match the nearest vertical column
    const col = myWalls
      .filter(w => (w.orientation||'h') === 'v' && Math.abs(w.x - px) < ALIGN)
      .sort((a,b) => Math.abs(a.x-px) - Math.abs(b.x-px));
    if (col.length) {
      x = col[0].x;
      // 2. Snap Y to the nearest WALL_STEP grid relative to that column's walls
      const colRef = col[0].y;
      const offset = ((py - colRef) % WALL_STEP + WALL_STEP) % WALL_STEP;
      y = offset < WALL_STEP/2
        ? py - offset
        : py + (WALL_STEP - offset);
    }
  }

  return { x, y, orientation };
}

function isInsideBase(player) {
  const base = padCenter(player.padIdx || 0);
  const half = PAD_SIZE / 2;
  return Math.abs(player.x - base.x) < half && Math.abs(player.y - base.y) < half;
}

function isPositionInsideBase(player, x, y) {
  const base = padCenter(player.padIdx || 0);
  const half = PAD_SIZE / 2;
  return Math.abs(x - base.x) < half && Math.abs(y - base.y) < half;
}

const MAX_BUILDINGS_PER_OWNER = 40; // caps base sprawl — keeps server tick cost and client render cost bounded

function countOwnerBuildings(room, ownerId) {
  let c = 0;
  for (const b of Object.values(room.buildings)) if (b.ownerId === ownerId) c++;
  return c;
}

function placeBuilding(room, player, upgradeId, targetPos) {
  const bd = BUILDING_DATA[upgradeId]; if (!bd) return;
  const isIncome  = bd.type === 'income';
  const isDefense = bd.type === 'defense';
  if (!isIncome && !isDefense) return;

  let bx, by, wallOrientation = 'h';
  if (targetPos && isDefense && isWallBuilding(upgradeId)) {
    const pos = getWallPlacement(room, player, upgradeId, targetPos.x, targetPos.y);
    bx = pos.x; by = pos.y; wallOrientation = pos.orientation || 'h';
  } else if (targetPos) {
    // Dragged-and-dropped from the shop onto a specific spot in the base
    bx = targetPos.x; by = targetPos.y;
  } else if (isDefense && isWallBuilding(upgradeId) && isInsideBase(player)) {
    const pos = getWallPlacement(room, player, upgradeId);
    bx = pos.x; by = pos.y; wallOrientation = pos.orientation || 'h';
  } else if (isInsideBase(player)) {
    // Other buildings: place at player's feet when inside base
    bx = player.x + (Math.random()-0.5)*16;
    by = player.y + (Math.random()-0.5)*16;
  } else {
    // Outside base: use numbered slots around the base centre
    const offsets = isIncome ? INCOME_OFFSETS : DEFENSE_OFFSETS;
    const slotKey = isIncome ? 'incomeSlot' : 'defenseSlot';
    const slot    = player[slotKey] || 0;
    player[slotKey] = slot + 1;
    const off = offsets[slot % offsets.length];
    bx = (player.baseX || player.x) + off.dx;
    by = (player.baseY || player.y) + off.dy;
  }
  const bid = 'b_' + (buildingIdCounter++);

  const building = {
    id: bid, upgradeId, ownerId: player.id || player.socketId,
    ownerColor: player.color, ownerName: player.username,
    x: bx, y: by,
    hp: bd.maxHp, maxHp: bd.maxHp,
    type: bd.type, defType: bd.defType || null,
    orientation: isWallBuilding(upgradeId) ? wallOrientation : undefined,
    damage: bd.damage || 0, range: bd.range || 0,
    cooldown: bd.cooldown || 2000, lastFired: 0,
    mps: bd.mps || 0,
    slow: bd.slow || false,
    slowAmt: bd.slowAmt || 0,
    healRate: bd.healRate || 0,
  };
  room.buildings[bid] = building;
  emitToRoom(room, 'buildingPlaced', building);
}

function destroyBuilding(room, buildingId, attacker) {
  const b = room.buildings[buildingId]; if (!b) return;
  // If it was an income building, reduce owner's mps
  if (b.type === 'income' && b.mps > 0) {
    const owner = room.players[b.ownerId];
    if (owner) { owner.mps = Math.max(1, owner.mps - b.mps); }
  }
  emitToRoom(room, 'buildingDestroyed', {
    id: buildingId,
    destroyerName: attacker ? attacker.username : 'Unknown',
    ownerName: b.ownerName,
    buildingName: UPGRADES[b.upgradeId]?.name || b.upgradeId,
  });
  delete room.buildings[buildingId];
}

// ── Room System ───────────────────────────────────────────────────────────────
const rooms = {};           // roomId -> room
const socketRoom = {};      // socketId -> roomId
const onlineByName = {};    // username.lower -> socketId
const pendingInvites = {};  // socketId -> [{roomId, from}]
let botIdCounter = 1;

function makeId(len=6) { return crypto.randomBytes(len).toString('base64url').slice(0,len).toUpperCase(); }

function applyDifficultyCosts(upgrades, difficulty) {
  const mult = difficulty === 'easy' ? 0.3 : difficulty === 'hard' ? 1.5 : 1.0;
  if (mult === 1.0) return upgrades;
  const result = {};
  for (const [id, u] of Object.entries(upgrades)) {
    result[id] = { ...u, cost: Math.max(1, Math.round(u.cost * mult)) };
  }
  return result;
}

function createRoom(hostSocketId, hostUsername, settings={}) {
  const roomId = makeId(6);
  // Use custom code if provided and not already taken
  let inviteCode = makeId(6);
  if (settings.customCode) {
    const code = String(settings.customCode).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if (code.length >= 4 && !Object.values(rooms).some(r => r.inviteCode === code)) {
      inviteCode = code;
    } else if (code.length >= 4) {
      // Code taken — append suffix
      inviteCode = code.slice(0,5) + makeId(2);
    }
  }
  const room = {
    id: roomId,
    inviteCode,
    name: settings.name || `${hostUsername}'s Jungle`,
    hostId: hostSocketId,
    isPublic: settings.isPublic !== false,
    maxPlayers: Math.min(8, Math.max(2, settings.maxPlayers||8)),
    gameMode: settings.gameMode || 'classic',
    botCount: 0,
    _soloMode: settings._soloMode || false,
    difficulty: settings.difficulty || 'medium',
    loadSavedGame: settings.loadSavedGame || false,
    freshStart: settings.freshStart || false,
    matchDuration: settings.matchDuration || 0,
    matchStartTime: null,
    status: 'waiting', // waiting | playing
    players: {},       // socketId -> playerData (in-game)
    lobbyPlayers: {},  // socketId -> {username, ready, color}
    bots: {},          // botId -> botData
    buildings: {},    // buildingId -> building object
    moneyDrops: [],
    nextDropId: 1,
    intervals: [],
    createdAt: Date.now(),
  };
  rooms[roomId] = room;
  return room;
}

function getRoomPublicInfo(room) {
  const count = Object.keys(room.lobbyPlayers).length + Object.keys(room.bots).length;
  return {
    id: room.id, name: room.name, hostId: room.hostId,
    hostName: room.lobbyPlayers[room.hostId]?.username || '?',
    playerCount: count, maxPlayers: room.maxPlayers,
    gameMode: room.gameMode, status: room.status, isPublic: room.isPublic,
    _soloMode: room._soloMode || false,
    freshStart: room.freshStart || false,
    matchDuration: room.matchDuration || 0,
  };
}

function broadcastLobbyUpdate() {
  const publicRooms = Object.values(rooms)
    .filter(r => r.isPublic)
    .map(getRoomPublicInfo);
  io.emit('lobbyUpdate', { rooms: publicRooms, online: Object.keys(onlineByName).length });
}

function getRoomSockets(room) { return Object.keys(room.lobbyPlayers); }

function emitToRoom(room, event, data) {
  for (const sid of getRoomSockets(room)) io.to(sid).emit(event, data);
}

// ── Stats calc ────────────────────────────────────────────────────────────────
function calcStats(upgrades) {
  let mps=1, speed=260, damage=15, defense=0, maxHp=100, regen=0;
  for (const id of upgrades) {
    const u = UPGRADES[id]; if (!u) continue;
    if (u.effect.mps)     mps     += u.effect.mps;
    if (u.effect.speed)   speed   += u.effect.speed;
    if (u.effect.damage)  damage  += u.effect.damage;
    if (u.effect.defense) defense += u.effect.defense;
    if (u.effect.maxHp)   maxHp   += u.effect.maxHp;
    if (u.effect.regen)   regen   += u.effect.regen;
  }
  return { mps, speed, damage, defense, maxHp, regen };
}

function xpForLevel(l) { return Math.floor(100 * Math.pow(1.4, l-1)); }

function addXP(player, amount, room) {
  player.xp += amount;
  while (player.xp >= xpForLevel(player.level)) {
    player.xp -= xpForLevel(player.level);
    player.level++; player.maxHp += 12; player.damage += 2;
    player.hp = Math.min(player.hp+60, player.maxHp);
    if (player.socketId) io.to(player.socketId).emit('levelUp', { level:player.level, maxHp:player.maxHp, damage:player.damage });
  }
}

function padCenter(idx) { return { x: PADS[idx].x + PAD_SIZE/2, y: PADS[idx].y + PAD_SIZE/2 }; }

function dist(a,b) { return Math.hypot(a.x-b.x, a.y-b.y); }

function getFreePad(room) {
  const used = new Set([
    ...Object.values(room.players).map(p=>p.padIdx),
    ...Object.values(room.lobbyPlayers).map(p=>p.padIdx),  // check lobby players too
    ...Object.values(room.bots).map(b=>b.padIdx),
  ]);
  for (let i=0; i<PADS.length; i++) if (!used.has(i)) return i;
  // All 8 pads taken — pick least contested one
  const counts = Array(PADS.length).fill(0);
  for (const idx of used) if (idx < PADS.length) counts[idx]++;
  return counts.indexOf(Math.min(...counts));
}

function createPlayerData(socketId, username, save, padIdx, color) {
  const stats = calcStats(save.upgrades||[]);
  const {x,y} = padCenter(padIdx);
  return {
    socketId, id: socketId, username, x, y, hp: stats.maxHp,
    isDead: false, lastAttack: 0, kills: save.kills||0, deaths: save.deaths||0,
    money: save.money||0, totalEarned: save.total_earned||0,
    level: save.level||1, xp: save.xp||0, prestige: save.prestige||0,
    upgrades: [...(save.upgrades||[])],
    points: save.points||0,
    padIdx, color, dbUserId: null, isBot: false, ...stats,
  };
}

async function persistPlayer(p) {
  if (!p.dbUserId) return;
  const existing = await getSave(p.dbUserId);
  await putSave(p.dbUserId, {
    money: Math.floor(p.money), total_earned: Math.floor(p.totalEarned),
    level: p.level, xp: p.xp, upgrades: p.upgrades,
    kills: p.kills, deaths: p.deaths, prestige: p.prestige,
    points: Math.floor(p.points || 0),
    savedGames: existing.savedGames || [],
    lobbyItems: existing.lobbyItems || { skins:[], tags:[] },
    equippedSkin: existing.equippedSkin || 'default',
    equippedTag: existing.equippedTag || 'none',
    customSkins: existing.customSkins || [],
  });
}

// ── Bot AI ────────────────────────────────────────────────────────────────────
function randomArenaPos(cx, cy, radius) {
  const angle = Math.random() * Math.PI * 2;
  const r = 100 + Math.random() * radius;
  return { x: cx + Math.cos(angle)*r, y: cy + Math.sin(angle)*r };
}

function createBot(room, difficulty='medium') {
  const padIdx = getFreePad(room);
  const botId = 'bot_' + (botIdCounter++);
  const isHardcore = difficulty === 'hardcore';
  const name = isHardcore
    ? HARDCORE_NAMES[Math.floor(Math.random()*HARDCORE_NAMES.length)] + '-' + Math.floor(Math.random()*999)
    : BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)] + Math.floor(Math.random()*99);
  const color = isHardcore ? '#ff2222' : BOT_COLORS[(botIdCounter-1) % BOT_COLORS.length];
  const stats = calcStats([]);
  const dmgMult   = isHardcore ? 2.2 : difficulty==='easy' ? 0.5 : difficulty==='hard' ? 1.2 : 0.8;
  const speedMult = isHardcore ? 1.3 : difficulty==='easy' ? 0.55: difficulty==='hard' ? 1.1 : 0.85;
  const hpMult    = isHardcore ? 2.0 : difficulty==='easy' ? 0.6 : difficulty==='hard' ? 1.2 : 0.9;

  // Spawn at their assigned pad — bots behave like real players with a home base
  const base = padCenter(padIdx);
  const pos  = { x: base.x + (Math.random()-0.5)*100, y: base.y + (Math.random()-0.5)*100 };

  return {
    id: botId, socketId: botId, username: name, isBot: true, difficulty,
    x: pos.x, y: pos.y,
    baseX: base.x, baseY: base.y, padIdx, color,
    hp: stats.maxHp * hpMult, maxHp: stats.maxHp * hpMult, isDead: false,
    kills:0, deaths:0, money:0, totalEarned:0, level:1, xp:0, prestige:0,
    upgrades:[], buildUpgrades:[],   // buildUpgrades tracks build items (can repeat)
    incomeSlot:0, defenseSlot:0,
    mps: isHardcore ? 8 : 2,
    dmgMult,
    speed:   stats.speed   * speedMult,
    damage:  stats.damage  * dmgMult,
    defense: isHardcore ? stats.defense * 1.8 : stats.defense,
    regen:   isHardcore ? 8 : 0,
    lastAttack: 0,
    // Phases: 'build' → spend time at base building up; 'hunt' → attack enemies; 'retreat' → go home to heal
    aiState: 'build',
    aiTimer: 20 + Math.random()*20,  // build for 20-40s before hunting
    wanderX: pos.x, wanderY: pos.y,
    panicThreshold: isHardcore ? 0.08 : difficulty==='easy' ? 0.45+Math.random()*0.2
                  : difficulty==='hard' ? 0.1+Math.random()*0.1 : 0.2+Math.random()*0.2,
    neverRetreat: isHardcore || (difficulty==='hard' && Math.random()<0.5),
    scale: isHardcore ? 1.35 : 1.0,
    isHardcore,
  };
}

function tickBot(bot, room, dt, allEntitiesArr, buildingsArr, wallBuildingsArr) {
  if (bot.isDead) return;
  const now = Date.now();
  bot.aiTimer -= dt;

  // ── Income + regen ──
  bot.money += bot.mps * dt; bot.totalEarned += bot.mps * dt;
  if (bot.regen > 0 && bot.hp < bot.maxHp) bot.hp = Math.min(bot.maxHp, bot.hp + bot.regen * dt);

  // ── Collect nearby drops ──
  for (const drop of room.moneyDrops) {
    if (dist(bot, drop) < 70) {
      bot.money += drop.amount; bot.totalEarned += drop.amount;
      const idx = room.moneyDrops.indexOf(drop); if (idx > -1) room.moneyDrops.splice(idx, 1);
      emitToRoom(room, 'dropCollected', { dropId: drop.id, playerId: bot.id, money: bot.money }); break;
    }
  }

  // ── Smart purchasing — income first, then defenses, then combat ──
  const diffMult = room.difficulty==='easy' ? 0.3 : room.difficulty==='hard' ? 1.5 : 1.0;
  if (now - (bot._lastBuyCheck||0) > 5000) {   // check every 5 seconds (not too fast)
    bot._lastBuyCheck = now;
    const atHome = Math.hypot(bot.x - bot.baseX, bot.y - bot.baseY) < PAD_SIZE/2;

    // Check if ALL income upgrades are bought (bots must max income before building defenses)
    const allIncomeIds = Object.keys(UPGRADES).filter(id => UPGRADES[id].cat === 'income');
    const allIncomeBought = allIncomeIds.every(id => bot.upgrades.includes(id));

    // Priority: income always first → build only if all income owned → combat last
    const atBuildingCap = countOwnerBuildings(room, bot.id) >= MAX_BUILDINGS_PER_OWNER;
    const cats = allIncomeBought
      ? (bot.aiState === 'build' && !atBuildingCap ? ['build','defense','health','attack','speed'] : ['attack','speed','health','defense'])
      : ['income'];   // must buy all income upgrades first, no exceptions

    for (const cat of cats) {
      const opts = Object.entries(UPGRADES).filter(([id, u]) => {
        if (u.cat !== cat) return false;
        const realCost = Math.max(1, Math.round(u.cost * diffMult));
        // Must have 20% buffer above cost — no spending last pennies
        if (bot.money < realCost * 1.2) return false;
        if (u.cat === 'build') return (!u.req || bot.upgrades.includes(u.req)) && atHome;
        return !bot.upgrades.includes(id) && (!u.req || bot.upgrades.includes(u.req));
      }).sort((a,b) => a[1].cost - b[1].cost);

      if (!opts.length) continue;
      const [id, upg] = opts[0];
      const realCost = Math.max(1, Math.round(upg.cost * diffMult));
      if (bot.money < realCost) continue;   // final safety check
      bot.money -= realCost;
      const isBuild = upg.cat === 'build';
      if (!isBuild && !bot.upgrades.includes(id)) {
        bot.upgrades.push(id);
        bot.speed   += upg.effect.speed   || 0;
        bot.maxHp   += upg.effect.maxHp   || 0;
        bot.defense += upg.effect.defense || 0;
        bot.regen   += upg.effect.regen   || 0;
        bot.mps     += upg.effect.mps     || 0;
        bot.damage  += (upg.effect.damage || 0) * (bot.dmgMult || 1);
      }
      emitToRoom(room, 'playerUpgraded', { id: bot.id, upgradeId: id });
      if ((isBuild || upg.cat === 'income') && atHome) placeBuilding(room, bot, id);
      break;  // one purchase per check
    }
  }

  // ── Find nearest enemy ──
  let nearestEnemy = null, nearestDist = Infinity;
  for (const p of allEntitiesArr) {
    if (p === bot || p.isDead) continue;
    const d = dist(bot, p);
    const eff = p.isBot ? d + 150 : d; // prefer humans
    if (eff < nearestDist) { nearestDist = eff; nearestEnemy = p; }
  }
  const trueDist = nearestEnemy ? dist(bot, nearestEnemy) : Infinity;

  // ── State machine ──
  const atBase = Math.hypot(bot.x - bot.baseX, bot.y - bot.baseY) < PAD_SIZE/2;
  const shouldRetreat = !bot.neverRetreat && bot.hp < bot.maxHp * (bot.panicThreshold||0.25);
  if (shouldRetreat && bot.aiState !== 'retreat') {
    bot.aiState = 'retreat'; bot.aiTimer = 0;
  } else if (bot.aiState === 'build') {
    if (bot.aiTimer <= 0) { bot.aiState = 'hunt'; bot.aiTimer = 0; } // done building — go fight
  } else if (bot.aiState === 'retreat') {
    if (atBase && bot.hp > bot.maxHp * 0.7) { bot.aiState = 'hunt'; bot.aiTimer = 0; }
  } else {
    // Hunt — occasionally wander back to base to buy things
    if (bot.aiTimer <= 0) {
      const goHome = Math.random() < 0.3;
      bot.aiState = goHome ? 'build' : 'hunt';
      bot.aiTimer = goHome ? 8 + Math.random()*8 : 3 + Math.random()*4;
    }
  }

  // ── Movement target ──
  let tx = bot.wanderX || bot.baseX, ty = bot.wanderY || bot.baseY;
  if (bot.aiState === 'hunt' && nearestEnemy) {
    tx = nearestEnemy.x; ty = nearestEnemy.y;
  } else if (bot.aiState === 'build' || bot.aiState === 'retreat') {
    // Go back to own base
    tx = bot.baseX + (Math.random()-0.5)*80;
    ty = bot.baseY + (Math.random()-0.5)*80;
  } else if (bot.aiTimer <= 0) {
    bot.wanderX = bot.baseX + (Math.random()-0.5)*300;
    bot.wanderY = bot.baseY + (Math.random()-0.5)*300;
    bot.aiTimer = 2 + Math.random()*3;
    tx = bot.wanderX; ty = bot.wanderY;
  }

  // ── Move (with wall collision for ENEMY walls only — own walls passable) ──
  const mdx = tx - bot.x, mdy = ty - bot.y, mdist = Math.hypot(mdx, mdy);
  if (mdist > 10) {
    const nx = bot.x + (mdx/mdist) * bot.speed * dt;
    const ny = bot.y + (mdy/mdist) * bot.speed * dt;
    const blockedByWall = wallBuildingsArr.find(b => {
      if (!b.hp || b.ownerId === bot.id) return false;
      const isH = (b.orientation||'h') === 'h';
      const hw = isH ? 28 : 9, hh = isH ? 9 : 28;
      return Math.abs(nx-b.x) < hw && Math.abs(ny-b.y) < hh;
    });
    if (!blockedByWall) {
      bot.x = Math.max(20, Math.min(WORLD_SIZE-20, nx));
      bot.y = Math.max(20, Math.min(WORLD_SIZE-20, ny));
    } else if (now - (bot._lastWallContact||0) > 800) {
      bot._lastWallContact = now;
      bot.hp -= 4;
      emitToRoom(room, 'attackResult', { attackerId: blockedByWall.ownerId, targetId: bot.id, damage: 4, targetHp: bot.hp, targetMaxHp: bot.maxHp });
      if (bot.hp <= 0) { bot.isDead = true; bot.deaths++; emitToRoom(room, 'playerDied', { victimId: bot.id, killerId: blockedByWall.ownerId, loot: 0, killerMoney: 0 }); }
    }
  }

  // ── Attack buildings on enemy base when hunting ──
  if (bot.aiState === 'hunt' && now - bot.lastAttack > 900) {
    const nearBuilding = buildingsArr.find(b =>
      b.ownerId !== bot.id && b.hp > 0 && dist(bot, b) < 200
    );
    if (nearBuilding) {
      bot.lastAttack = now;
      const dmg = Math.max(1, Math.floor(bot.damage * 0.6));
      nearBuilding.hp -= dmg;
      emitToRoom(room, 'buildingDamaged', { id: nearBuilding.id, hp: nearBuilding.hp, maxHp: nearBuilding.maxHp, damage: dmg });
      if (nearBuilding.hp <= 0) destroyBuilding(room, nearBuilding.id, bot);
    }
  }

  // ── Attack players/bots ──
  const atkCooldown = bot.isHardcore ? 1200 : bot.difficulty==='hard' ? 1400 : bot.difficulty==='easy' ? 2200 : 1800;
  if (nearestEnemy && trueDist < 240 && now - bot.lastAttack > atkCooldown) {
    bot.lastAttack = now; handleAttack(bot, nearestEnemy, room);
  }
}

function scheduleRespawn(target, room) {
  const deadSocketId = target.socketId || target.id;
  setTimeout(() => {
    const stillInRoom = room.players[deadSocketId] || room.bots[deadSocketId];
    if (!stillInRoom) return;
    const stats = calcStats(target.upgrades);
    target.isDead = false; target.hp = stats.maxHp;
    const rbase = target.baseX ? { x:target.baseX, y:target.baseY } : padCenter(target.padIdx||0);
    target.x = rbase.x + (Math.random()-0.5)*80;
    target.y = rbase.y + (Math.random()-0.5)*80;
    if (target.isBot) { target.aiState = 'build'; target.aiTimer = 10 + Math.random()*10; }
    const respawnData = { id: target.id, x: target.x, y: target.y, hp: target.hp, maxHp: target.maxHp };
    emitToRoom(room, 'playerRespawned', respawnData);
    if (!target.isBot) {
      const sock = io.sockets.sockets.get(deadSocketId);
      if (sock) sock.emit('playerRespawned', respawnData);
    }
  }, 5000);
}

function handleAttack(attacker, target, room) {
  if (attacker.isDead || target.isDead) return;
  const now = Date.now();
  const rawDmg = attacker.damage + Math.floor(Math.random()*10) - 5;
  const dmg = Math.max(1, rawDmg - target.defense);
  target.hp -= dmg;

  // Knockback direction: attacker → target
  const kbLen = Math.hypot(target.x - attacker.x, target.y - attacker.y) || 1;
  const kbDx  = (target.x - attacker.x) / kbLen;
  const kbDy  = (target.y - attacker.y) / kbLen;
  const KNOCKBACK = 120;
  target.x = Math.max(20, Math.min(WORLD_SIZE-20, target.x + kbDx * KNOCKBACK));
  target.y = Math.max(20, Math.min(WORLD_SIZE-20, target.y + kbDy * KNOCKBACK));

  emitToRoom(room, 'attackResult', {
    attackerId: attacker.id, targetId: target.id,
    damage: dmg, targetHp: target.hp, targetMaxHp: target.maxHp,
    knockback: { x: target.x, y: target.y },
  });

  if (target.hp <= 0) {
    target.isDead = true; target.deaths++;
    attacker.kills++;
    attacker.points = (attacker.points || 0) + 10;  // +10 Dino Points per kill
    const loot = Math.floor(target.money * 0.25);
    target.money = Math.max(0, target.money - loot);
    attacker.money += loot; attacker.totalEarned += loot;
    addXP(attacker, 80 + target.level*10, room);
    emitToRoom(room, 'playerDied', { victimId: target.id, killerId: attacker.id, loot, killerMoney: attacker.money });

    if (!target.isBot) persistPlayer(target);
    scheduleRespawn(target, room);
  }
}

// ── Room Game Loop ─────────────────────────────────────────────────────────────
function startRoomLoop(room) {
  room.status = 'playing';
  room.matchStartTime = Date.now();
  let lastTick = Date.now();

  // Main tick
  const tickInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    const allEntities = [...Object.values(room.players), ...Object.values(room.bots)];
    for (const p of allEntities) {
      if (p.isDead) continue;
      p.money += p.mps * dt; p.totalEarned += p.mps * dt;
      if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
    }
    // Tick bots — precompute shared arrays once per tick instead of per-bot to avoid O(bots*buildings) reallocation
    const buildingsArr = Object.values(room.buildings);
    const wallBuildingsArr = buildingsArr.filter(b => isWallBuilding(b.upgradeId));
    for (const bot of Object.values(room.bots)) tickBot(bot, room, dt, allEntities, buildingsArr, wallBuildingsArr);

    // Tick buildings (turrets fire, traps trigger)
    for (const b of buildingsArr) {
      if (b.hp <= 0) continue;
      if (b.defType === 'turret') {
        // Find nearest enemy (not the owner)
        let nearest = null, nearestD = b.range;
        for (const e of allEntities) {
          if (e.isDead || (e.id||e.socketId) === b.ownerId) continue;
          const d = dist(b, e);
          if (d < nearestD) { nearestD = d; nearest = e; }
        }
        if (nearest && now - b.lastFired > b.cooldown) {
          b.lastFired = now;
          const dmg = Math.max(1, b.damage + Math.floor(Math.random()*6)-3);
          nearest.hp -= dmg;
          emitToRoom(room, 'turretFired', { buildingId: b.id, targetId: nearest.id||nearest.socketId, damage: dmg, targetHp: nearest.hp, x: b.x, y: b.y });
          if (nearest.hp <= 0) {
            nearest.isDead = true; nearest.deaths++;
            emitToRoom(room, 'playerDied', { victimId: nearest.id||nearest.socketId, killerId: b.ownerId, loot: 0, killerMoney: 0 });
            if (!nearest.isBot) persistPlayer(nearest);
            scheduleRespawn(nearest, room);
          }
        }
      } else if (b.defType === 'trap') {
        // Damage (and optionally slow) enemies who walk over the trap
        for (const e of allEntities) {
          if (e.isDead || (e.id||e.socketId) === b.ownerId) continue;
          if (dist(b, e) < b.range && now - (b['_trap_'+e.id] || 0) > 1200) {
            b['_trap_'+e.id] = now;
            const dmg = Math.max(1, b.damage);
            e.hp -= dmg;
            const slowAmt = b.slow ? (b.slowAmt || 0.4) : 0;
            emitToRoom(room, 'trapTriggered', { buildingId: b.id, targetId: e.id||e.socketId, damage: dmg, targetHp: e.hp, slow: b.slow || false, slowAmt });
            if (e.hp <= 0) {
              e.isDead = true; e.deaths++;
              emitToRoom(room, 'playerDied', { victimId: e.id||e.socketId, killerId: b.ownerId, loot: 0, killerMoney: 0 });
              if (!e.isBot) persistPlayer(e);
              scheduleRespawn(e, room);
            }
          }
        }
      } else if (b.defType === 'totem') {
        // Heal the building owner when they stand nearby
        const owner = allEntities.find(e => (e.id||e.socketId) === b.ownerId && !e.isDead);
        if (owner && dist(b, owner) < b.range) {
          const maxHp = 100 + (owner.upgrades && owner.upgrades.includes('dinoBlood') ? 50 : 0);
          if (owner.hp < maxHp && now - (b._lastHeal || 0) > 1000) {
            b._lastHeal = now;
            owner.hp = Math.min(maxHp, owner.hp + (b.healRate || 20));
            const sock = io.sockets.sockets.get(owner.socketId);
            if (sock) sock.emit('healed', { hp: owner.hp, source: 'totem' });
          }
        }
      }
    }

    // Broadcast bot positions
    if (Object.keys(room.bots).length > 0) {
      const botPositions = Object.values(room.bots).map(b => ({ id:b.id, x:b.x, y:b.y }));
      emitToRoom(room, 'botPositions', botPositions);
    }

    // Match timer
    if (room.matchDuration > 0 && room.matchStartTime) {
      const elapsed = (Date.now() - room.matchStartTime) / 1000;
      const remaining = Math.max(0, room.matchDuration - elapsed);
      // Broadcast remaining every tick so clients can show countdown
      emitToRoom(room, 'matchTimer', { remaining: Math.ceil(remaining) });
      if (remaining <= 0 && !room._matchEnded) {
        room._matchEnded = true;
        // Build final leaderboard
        const all = [...Object.values(room.players), ...Object.values(room.bots)];
        const lb = all.sort((a,b) => b.totalEarned - a.totalEarned).map(p => ({
          username: p.username, color: p.color, money: Math.floor(p.money),
          kills: p.kills, isBot: p.isBot
        }));
        emitToRoom(room, 'matchOver', { leaderboard: lb });
        // Freeze the world immediately — stop bot AI/attacks/building and money sync so
        // nothing keeps acting (or making sound) during the post-match results screen
        stopRoomLoop(room);
        // Clean up after 10s
        setTimeout(() => destroyRoom(room.id), 10000);
        return;
      }
    }
  }, 50);

  // Sync + drops
  const syncInterval = setInterval(() => {
    const allPlayers = [...Object.values(room.players), ...Object.values(room.bots)];

    // Stat sync
    const sync = {};
    for (const p of allPlayers) {
      sync[p.id] = { hp: Math.round(p.hp), money: Math.floor(p.money), mps: p.mps, isDead: p.isDead };
    }
    emitToRoom(room, 'statSync', sync);

    // Leaderboard
    const lb = allPlayers.sort((a,b)=>b.totalEarned-a.totalEarned).slice(0,10)
      .map(p=>({ username:p.username, money:Math.floor(p.money), totalEarned:Math.floor(p.totalEarned), level:p.level, kills:p.kills, prestige:p.prestige, color:p.color, isBot:p.isBot }));
    emitToRoom(room, 'leaderboard', lb);

    // Money drops
    for (const p of allPlayers) {
      if (p.isDead || p.mps <= 1) continue;
      if (Math.random() < 0.5) {
        const pad = PADS[p.padIdx];
        const drop = {
          id: room.nextDropId++,
          x: pad.x + 70 + Math.random()*(PAD_SIZE-140),
          y: pad.y + 70 + Math.random()*(PAD_SIZE-140),
          amount: Math.floor(p.mps * 2 + Math.random()*p.mps),
          color: p.color,
        };
        if (room.moneyDrops.length < 250) {
          room.moneyDrops.push(drop);
          emitToRoom(room, 'moneyDropSpawned', drop);
        }
      }
    }

    // Persist humans
    for (const p of Object.values(room.players)) persistPlayer(p);
  }, 2000);

  room.intervals.push(tickInterval, syncInterval);
}

function stopRoomLoop(room) {
  for (const iv of room.intervals) clearInterval(iv);
  room.intervals = [];
}

function destroyRoom(roomId) {
  const room = rooms[roomId]; if (!room) return;
  stopRoomLoop(room);
  for (const sid of getRoomSockets(room)) { delete socketRoom[sid]; }
  delete rooms[roomId];
  broadcastLobbyUpdate();
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Image Proxy (for custom skin background removal — avoids CORS) ────────────
app.get('/api/proxy-image', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'No URL provided' });
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'http/https only' });

  const lib = parsed.protocol === 'https:' ? https : require('http');
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*' },
    timeout: 10000,
  };
  const proxyReq = lib.request(options, proxyRes => {
    // Handle redirects
    if ((proxyRes.statusCode === 301 || proxyRes.statusCode === 302) && proxyRes.headers.location) {
      proxyRes.resume();
      return res.redirect('/api/proxy-image?url=' + encodeURIComponent(proxyRes.headers.location));
    }
    const ct = proxyRes.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      proxyRes.resume();
      return res.status(400).json({ error: 'URL is not an image' });
    }
    // Limit to 5 MB
    let size = 0;
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    proxyRes.on('data', chunk => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { proxyRes.destroy(); res.status(413).end(); return; }
      res.write(chunk);
    });
    proxyRes.on('end', () => res.end());
  });
  proxyReq.on('error', () => res.status(502).json({ error: 'Could not fetch image' }));
  proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(408).json({ error: 'Fetch timed out' }); });
  proxyReq.end();
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body||{};
    if (!username||!password) return res.status(400).json({error:'Missing fields'});
    if (username.length<3||username.length>20) return res.status(400).json({error:'Username 3-20 chars'});
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({error:'Letters/numbers/underscore only'});
    if (password.length<4) return res.status(400).json({error:'Password min 4 chars'});
    if (await findUser(username)) return res.status(400).json({error:'Username taken'});
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2);
    const hash = await bcrypt.hash(password, 10);
    await usersCol.insertOne({ id, username, username_lower: username.toLowerCase(), password: hash });
    const token = jwt.sign({id, username}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, username});
  } catch(e) {
    console.error('Register error:', e);
    res.status(503).json({error:'Server starting up, please try again in a moment'});
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const {username, password} = req.body||{};
    if (!username||!password) return res.status(400).json({error:'Missing fields'});
    if (!usersCol) return res.status(503).json({error:'Server starting up, please try again in a moment'});
    const user = await findUser(username);
    if (!user) return res.status(401).json({error:'Invalid credentials'});
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({error:'Invalid credentials'});
    const token = jwt.sign({id: user.id, username: user.username}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, username: user.username});
  } catch(e) {
    console.error('Login error:', e);
    res.status(503).json({error:'Server starting up, please try again in a moment'});
  }
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let authedUser = null; // { id, username }

  // ── Auth ──
  socket.on('authenticate', async (token) => {
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET); }
    catch { socket.emit('authError', 'Session expired, please login again'); return; }

    // Kick any existing session for this username
    const existingSocketId = onlineByName[decoded.username.toLowerCase()];
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        existingSocket.emit('authError', 'You logged in from another tab or device.');
        existingSocket.disconnect(true);
      }
    }

    authedUser = { id: decoded.id, username: decoded.username };
    onlineByName[decoded.username.toLowerCase()] = socket.id;

    // Send lobby data including player's stats
    const publicRooms = Object.values(rooms).filter(r=>r.isPublic).map(getRoomPublicInfo);
    const save = await getSave(decoded.id);

    // JoyfulPanda always gets the Panda Rex skin for free
    if (decoded.username.toLowerCase() === 'joyfulpanda') {
      if (!save.lobbyItems) save.lobbyItems = { skins:[], tags:[] };
      if (!save.lobbyItems.skins.includes('panda')) save.lobbyItems.skins.push('panda');
      if (save.equippedSkin !== 'panda') {
        save.equippedSkin = 'panda';
        await putSave(decoded.id, save);
      }
    }

    socket.emit('lobbyReady', {
      username: decoded.username,
      rooms: publicRooms,
      online: Object.keys(onlineByName).length,
      upgrades: UPGRADES,
      stats: { ...save, username: decoded.username },
      points: save.points || 0,
      lobbyItems: save.lobbyItems || { skins:[], tags:[] },
      equippedSkin: save.equippedSkin || 'default',
      equippedTag: save.equippedTag || 'none',
      lobbyShop: LOBBY_SHOP,
      customSkins: save.customSkins || [],
      lastDailyReward: save.lastDailyReward || 0,
    });
    broadcastLobbyUpdate();
    io.emit('lobbyChatMsg', { username: 'System', text: `${decoded.username} joined the lobby! 🦕`, system: true });
  });

  // ── Save / Load game ──
  socket.on('saveGame', async (saveName) => {
    if (!authedUser) return;
    const room = rooms[socketRoom[socket.id]]; if (!room || room.status !== 'playing') return;
    const p = room.players[socket.id]; if (!p) return;
    const myBuildings = Object.values(room.buildings)
      .filter(b => b.ownerId === socket.id)
      .map(b => ({ upgradeId: b.upgradeId, dx: b.x - p.baseX, dy: b.y - p.baseY, hp: b.hp, maxHp: b.maxHp }));

    // Snapshot every guest's state so they can be restored next session
    const guestStates = {};
    for (const [sid, gp] of Object.entries(room.players)) {
      if (sid === socket.id) continue; // skip host, handled above
      const gBuildings = Object.values(room.buildings)
        .filter(b => b.ownerId === sid)
        .map(b => ({ upgradeId: b.upgradeId, dx: b.x - gp.baseX, dy: b.y - gp.baseY, hp: b.hp, maxHp: b.maxHp }));
      guestStates[gp.username.toLowerCase()] = {
        money: Math.floor(gp.money), upgrades: [...gp.upgrades],
        buildings: gBuildings, kills: gp.kills, level: gp.level,
      };
    }

    const save = await getSave(authedUser.id);
    if (!Array.isArray(save.savedGames)) save.savedGames = [];
    const entry = {
      id: Date.now(),
      name: String(saveName||'').trim().slice(0,24) || `Save ${new Date().toLocaleDateString()}`,
      money: Math.floor(p.money), upgrades: [...p.upgrades],
      buildings: myBuildings, savedAt: new Date().toISOString(),
      difficulty: room.difficulty||'medium', kills: p.kills, level: p.level,
      guestStates,
    };
    save.savedGames.unshift(entry);
    await putSave(authedUser.id, save);
    socket.emit('gameSaved', { entry });
  });

  socket.on('getSavedGames', async () => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    socket.emit('savedGamesList', { games: Array.isArray(save.savedGames) ? save.savedGames : [] });
  });

  socket.on('deleteSavedGame', async (id) => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    if (Array.isArray(save.savedGames))
      save.savedGames = save.savedGames.filter(g => g.id !== id);
    await putSave(authedUser.id, save);
    socket.emit('savedGamesList', { games: save.savedGames });
  });

  // ── Stats ──
  socket.on('getStats', async () => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    socket.emit('statsData', { ...save, username: authedUser.username });
  });

  // ── Lobby ──
  socket.on('getLobby', () => {
    const publicRooms = Object.values(rooms).filter(r=>r.isPublic).map(getRoomPublicInfo);
    socket.emit('lobbyData', { rooms: publicRooms, online: Object.keys(onlineByName).length });
  });

  // ── Lobby Shop ──
  // ── Custom Skin ──
  socket.on('setCustomSkin', async ({ name, base64 }) => {
    if (!authedUser) return;
    if (typeof base64 !== 'string') return;
    if (base64.length > 300000) { socket.emit('lobbyShopError', 'Image too large — try a smaller one'); return; }
    if (!base64.startsWith('data:image/png;base64,')) return;
    const save = await getSave(authedUser.id);
    const customSkins = save.customSkins || [];
    if (customSkins.length >= 9) { socket.emit('lobbyShopError', 'Max 9 custom skins — delete one first'); return; }
    const id = 'cs_' + Date.now();
    const slotName = (typeof name === 'string' && name.trim()) ? name.trim().slice(0,24) : 'My Skin';
    customSkins.push({ id, name: slotName, base64 });
    save.customSkins = customSkins;
    save.equippedSkin = 'custom_' + id;
    await putSave(authedUser.id, save);
    socket.emit('customSkinSet', { id, name: slotName, base64, equippedSkin: save.equippedSkin, customSkins });
  });

  socket.on('deleteCustomSkin', async ({ id }) => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    save.customSkins = (save.customSkins || []).filter(s => s.id !== id);
    if (save.equippedSkin === 'custom_' + id) save.equippedSkin = 'default';
    await putSave(authedUser.id, save);
    socket.emit('customSkinSet', { id: null, name: null, base64: null, equippedSkin: save.equippedSkin, customSkins: save.customSkins });
  });

  socket.on('claimDailyReward', async () => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    const now = Date.now();
    const last = save.lastDailyReward || 0;
    const MS_PER_DAY = 86400000;
    if (now - last < MS_PER_DAY) {
      const msLeft = MS_PER_DAY - (now - last);
      return socket.emit('dailyRewardResult', { error: true, msLeft });
    }
    const pts = Math.floor(Math.random() * 41) + 20; // 20–60
    save.points = (save.points || 0) + pts;
    save.lastDailyReward = now;
    await putSave(authedUser.id, save);
    socket.emit('dailyRewardResult', { pts, totalPoints: save.points });
  });

  socket.on('getLobbyShop', async () => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    socket.emit('lobbyShopData', {
      shop: LOBBY_SHOP,
      points: save.points || 0,
      lobbyItems: save.lobbyItems || { skins:[], tags:[] },
      equippedSkin: save.equippedSkin || 'default',
      equippedTag: save.equippedTag || 'none',
      customSkins: save.customSkins || [],
    });
  });

  socket.on('buyLobbyItem', async ({ type, itemId }) => {
    if (!authedUser) return;
    const items = type === 'skin' ? LOBBY_SHOP.skins : LOBBY_SHOP.tags;
    const item = items.find(i => i.id === itemId);
    if (!item || item.cost === 0) return;
    const save = await getSave(authedUser.id);
    if ((save.points || 0) < item.cost) { socket.emit('lobbyShopError', 'Not enough Dino Points!'); return; }
    if (!save.lobbyItems) save.lobbyItems = { skins:[], tags:[] };
    const owned = save.lobbyItems[type === 'skin' ? 'skins' : 'tags'] || [];
    if (owned.includes(itemId)) { socket.emit('lobbyShopError', 'Already owned!'); return; }
    save.points = (save.points || 0) - item.cost;
    save.lobbyItems[type === 'skin' ? 'skins' : 'tags'] = [...owned, itemId];
    await putSave(authedUser.id, save);
    socket.emit('lobbyItemBought', { type, itemId, points: save.points, lobbyItems: save.lobbyItems });
  });

  socket.on('equipLobbyItem', async ({ type, itemId }) => {
    if (!authedUser) return;
    const save = await getSave(authedUser.id);
    // Custom skins (custom_<id>) are always equippable if the slot exists
    if (type === 'skin' && typeof itemId === 'string' && itemId.startsWith('custom_')) {
      const csId = itemId.slice(7);
      const exists = (save.customSkins || []).some(s => s.id === csId);
      if (!exists) { socket.emit('lobbyShopError', 'Custom skin not found!'); return; }
      save.equippedSkin = itemId;
      await putSave(authedUser.id, save);
      socket.emit('lobbyItemEquipped', { type, itemId });
      return;
    }
    const items = type === 'skin' ? LOBBY_SHOP.skins : LOBBY_SHOP.tags;
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (item.cost > 0) {
      const owned = save.lobbyItems?.[type === 'skin' ? 'skins' : 'tags'] || [];
      if (!owned.includes(itemId)) { socket.emit('lobbyShopError', 'Not owned!'); return; }
    }
    const field = type === 'skin' ? 'equippedSkin' : 'equippedTag';
    save[field] = itemId;
    await putSave(authedUser.id, save);
    socket.emit('lobbyItemEquipped', { type, itemId });
  });

  socket.on('lobbyChat', (text) => {
    if (!authedUser) return;
    if (typeof text !== 'string') return;
    const clean = text.trim().slice(0, 120);
    if (!clean) return;
    // broadcast to all connected sockets (the whole lobby)
    io.emit('lobbyChatMsg', { username: authedUser.username, text: clean });
  });

  socket.on('createRoom', (settings={}) => {
    if (!authedUser) return;
    if (socketRoom[socket.id]) { socket.emit('roomError','Already in a room'); return; }
    const room = createRoom(socket.id, authedUser.username, settings);
    const padIdx = 0;
    room.lobbyPlayers[socket.id] = { username: authedUser.username, ready: false, padIdx, color: PLAYER_COLORS[0] };
    socketRoom[socket.id] = room.id;

    // Auto-add bots specified at room creation
    if (settings._initialBots) {
      const validDiffs = ['easy','medium','hard','hardcore'];
      for (const diff of validDiffs) {
        const count = parseInt(settings._initialBots[diff]) || 0;
        for (let i = 0; i < count; i++) {
          if (Object.keys(room.lobbyPlayers).length + Object.keys(room.bots).length >= room.maxPlayers) break;
          const bot = createBot(room, diff);
          room.bots[bot.id] = bot;
        }
      }
    }

    socket.emit('roomJoined', {
      room: { ...getRoomPublicInfo(room), inviteCode: room.inviteCode },
      lobbyPlayers: room.lobbyPlayers,
      isHost: true,
    });
    // Send current bots to the host
    for (const bot of Object.values(room.bots)) {
      socket.emit('botAdded', {
        id: bot.id, username: bot.username, color: bot.color, padIdx: bot.padIdx,
        x: bot.x, y: bot.y, hp: bot.hp, maxHp: bot.maxHp, level: bot.level,
        difficulty: bot.difficulty, isHardcore: bot.isHardcore, scale: bot.scale,
      });
    }
    broadcastLobbyUpdate();
    console.log(`Room created: ${room.id} by ${authedUser.username}`);
  });

  socket.on('joinRoom', ({ roomId, inviteCode }) => {
    if (!authedUser) return;
    if (socketRoom[socket.id]) { socket.emit('roomError','Already in a room'); return; }
    let room = rooms[roomId];
    if (!room && inviteCode) room = Object.values(rooms).find(r=>r.inviteCode===inviteCode.toUpperCase());
    if (!room) { socket.emit('roomError','Room not found'); return; }
    if (Object.keys(room.lobbyPlayers).length >= room.maxPlayers) { socket.emit('roomError','Room is full'); return; }

    const padIdx = getFreePad(room);
    const color = PLAYER_COLORS[padIdx % PLAYER_COLORS.length];
    room.lobbyPlayers[socket.id] = { username: authedUser.username, ready: false, padIdx, color };
    socketRoom[socket.id] = room.id;

    socket.emit('roomJoined', {
      room: { ...getRoomPublicInfo(room), inviteCode: room.inviteCode },
      lobbyPlayers: room.lobbyPlayers,
      isHost: room.hostId === socket.id,
    });
    emitToRoom(room, 'lobbyPlayerJoined', { socketId: socket.id, username: authedUser.username, padIdx, color });
    broadcastLobbyUpdate();
  });

  socket.on('leaveRoom', () => {
    leaveRoom(socket);
    socket.emit('leftRoom');
    broadcastLobbyUpdate();
  });

  function leaveRoom(socket) {
    const roomId = socketRoom[socket.id]; if (!roomId) return;
    const room = rooms[roomId]; if (!room) return;
    delete room.lobbyPlayers[socket.id];
    delete room.players[socket.id];
    delete socketRoom[socket.id];

    // Persist if was playing
    if (room.players[socket.id]) persistPlayer(room.players[socket.id]);

    emitToRoom(room, 'roomPlayerLeft', { socketId: socket.id });

    if (Object.keys(room.lobbyPlayers).length === 0) {
      destroyRoom(roomId); return;
    }
    // Transfer host
    if (room.hostId === socket.id) {
      room.hostId = Object.keys(room.lobbyPlayers)[0];
      emitToRoom(room, 'hostChanged', { newHostId: room.hostId });
    }
  }

  socket.on('updateRoomSettings', (settings) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.hostId !== socket.id) return;
    if (settings.name) room.name = String(settings.name).slice(0,40);
    if (settings.maxPlayers) room.maxPlayers = Math.min(8, Math.max(2, settings.maxPlayers));
    if (typeof settings.isPublic === 'boolean') room.isPublic = settings.isPublic;
    if (settings.gameMode) room.gameMode = settings.gameMode;
    emitToRoom(room, 'settingsUpdated', { name: room.name, maxPlayers: room.maxPlayers, isPublic: room.isPublic, gameMode: room.gameMode });
    broadcastLobbyUpdate();
  });

  socket.on('addBot', (difficulty='medium') => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.hostId !== socket.id) return;
    if (Object.keys(room.lobbyPlayers).length + Object.keys(room.bots).length >= room.maxPlayers) return;
    const validDiffs = ['easy','medium','hard','hardcore'];
    const diff = validDiffs.includes(difficulty) ? difficulty : 'medium';
    const bot = createBot(room, diff);
    room.bots[bot.id] = bot;
    emitToRoom(room, 'botAdded', {
      id: bot.id, username: bot.username, color: bot.color, padIdx: bot.padIdx,
      x: bot.x, y: bot.y, hp: bot.hp, maxHp: bot.maxHp, level: bot.level,
      difficulty: diff, isHardcore: bot.isHardcore, scale: bot.scale,
    });
  });

  socket.on('removeBot', (botId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!room.bots[botId]) return;
    emitToRoom(room, 'botRemoved', { id: botId });
    delete room.bots[botId];
  });

  socket.on('kickPlayer', (targetSocketId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.hostId !== socket.id) return;
    if (!room.lobbyPlayers[targetSocketId]) return;
    io.to(targetSocketId).emit('kicked', 'You were kicked by the host');
    delete room.lobbyPlayers[targetSocketId];
    delete room.players[targetSocketId];
    delete socketRoom[targetSocketId];
    emitToRoom(room, 'roomPlayerLeft', { socketId: targetSocketId });
  });

  socket.on('invitePlayer', (targetUsername) => {
    if (!authedUser) return;
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const targetSocketId = onlineByName[targetUsername.toLowerCase()];
    if (!targetSocketId) { socket.emit('inviteError', `${targetUsername} is not online`); return; }
    if (socketRoom[targetSocketId]) { socket.emit('inviteError', `${targetUsername} is already in a room`); return; }
    io.to(targetSocketId).emit('inviteReceived', {
      from: authedUser.username, roomId: room.id, roomName: room.name,
    });
    socket.emit('inviteSent', targetUsername);
  });

  socket.on('acceptInvite', ({ roomId }) => {
    if (!authedUser) return;
    if (socketRoom[socket.id]) { socket.emit('roomError','Already in a room'); return; }
    const room = rooms[roomId];
    if (!room) { socket.emit('roomError','Room no longer exists'); return; }
    if (Object.keys(room.lobbyPlayers).length >= room.maxPlayers) { socket.emit('roomError','Room is full'); return; }
    const padIdx = getFreePad(room);
    const color = PLAYER_COLORS[padIdx % PLAYER_COLORS.length];
    room.lobbyPlayers[socket.id] = { username: authedUser.username, ready: false, padIdx, color };
    socketRoom[socket.id] = room.id;
    socket.emit('roomJoined', {
      room: { ...getRoomPublicInfo(room), inviteCode: room.inviteCode },
      lobbyPlayers: room.lobbyPlayers, isHost: false,
    });
    emitToRoom(room, 'lobbyPlayerJoined', { socketId: socket.id, username: authedUser.username, padIdx, color });
    broadcastLobbyUpdate();
  });

  socket.on('declineInvite', ({ roomId }) => {
    const room = rooms[roomId]; if (!room) return;
    io.to(room.hostId).emit('inviteDeclined', { username: authedUser?.username });
  });

  socket.on('startGame', async () => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.status === 'playing') return;
    room.status = 'starting';

    // Initialize all players from lobby — fetch all saves in parallel
    const playerEntries = Object.entries(room.lobbyPlayers);
    const playerSaveData = await Promise.all(playerEntries.map(async ([sid, lp]) => {
      const userDoc = await usersCol.findOne({ username: lp.username });
      const dbId = userDoc ? userDoc.id : null;
      const rawSave = dbId ? await getSave(dbId) : {};
      return { sid, lp, dbId, rawSave };
    }));
    for (const { sid, lp, dbId, rawSave } of playerSaveData) {
      let save2 = room.freshStart
        ? { money:0, total_earned:0, level:1, xp:0, upgrades:[], kills:0, deaths:0, prestige:0 }
        : { money:0, total_earned:0, level:1, xp:0, upgrades:[], kills:0, deaths:0, prestige:0, ...rawSave };
      // Load a saved game slot if requested
      const sg = room.loadSavedGame && Array.isArray(rawSave.savedGames)
        ? rawSave.savedGames.find(g => g.id === room.loadSavedGame) || null
        : null;
      // Check if this player is the host or a returning guest
      const isHost = sid === room.hostId;
      const guestSnap = (!isHost && sg?.guestStates)
        ? sg.guestStates[lp.username.toLowerCase()] || null
        : null;
      if (sg && !room.freshStart) {
        if (isHost) {
          save2.money = sg.money || 0;
          save2.upgrades = sg.upgrades || [];
        } else if (guestSnap) {
          // Returning guest — restore their exact state from last save
          save2.money = guestSnap.money || 0;
          save2.upgrades = guestSnap.upgrades || [];
        }
        // If guest has no prior state in this save, they keep their own account stats (default)
      }
      const player = createPlayerData(sid, lp.username, save2, lp.padIdx, lp.color);
      player.dbUserId = dbId;
      // Equipped skin — override color if a non-default skin is equipped
      const equippedSkinId = rawSave.equippedSkin || 'default';
      if (equippedSkinId.startsWith('custom_')) {
        const csId = equippedSkinId.slice(7);
        const csSlot = (rawSave.customSkins || []).find(s => s.id === csId);
        player.customSkin = csSlot ? csSlot.base64 : null;
        player.skinColor = null;
      } else {
        const skinDef = LOBBY_SHOP.skins.find(s => s.id === equippedSkinId);
        player.skinColor = skinDef ? skinDef.color : null;
        player.customSkin = null;
      }
      // Base regen from difficulty — easy=6, medium=3, hard=2 HP/s
      const baseRegen = room.difficulty==='easy' ? 6 : room.difficulty==='hard' ? 2 : 3;
      player.regen = (player.regen || 0) + baseRegen;
      // Spawn at assigned pad center (their home base)
      const base = padCenter(player.padIdx);
      player.x = base.x + (Math.random()-0.5)*80;
      player.y = base.y + (Math.random()-0.5)*80;
      player.baseX = base.x;
      player.baseY = base.y;
      player.incomeSlot = 0; player.defenseSlot = 0;
      room.players[sid] = player;

      // Restore buildings — host from sg.buildings, returning guest from guestSnap.buildings
      const buildingsToRestore = isHost ? sg?.buildings : guestSnap?.buildings;
      if (buildingsToRestore?.length) {
        for (const sb of buildingsToRestore) {
          const bd = BUILDING_DATA[sb.upgradeId]; if (!bd) continue;
          const bid = 'b_' + (buildingIdCounter++);
          room.buildings[bid] = {
            id: bid, upgradeId: sb.upgradeId, ownerId: sid,
            ownerColor: player.color, ownerName: player.username,
            x: player.baseX + sb.dx, y: player.baseY + sb.dy,
            hp: sb.hp, maxHp: sb.maxHp,
            type: bd.type, defType: bd.defType||null,
            damage: bd.damage||0, range: bd.range||0,
            cooldown: bd.cooldown||2000, lastFired: 0,
            mps: bd.mps||0, slow: bd.slow||false, slowAmt: bd.slowAmt||0, healRate: bd.healRate||0,
          };
        }
      }
    }

    // Send gameStarted immediately so Phaser loads, but with countdown flag
    for (const [sid, lp] of Object.entries(room.lobbyPlayers)) {
      const myPlayer = room.players[sid];
      io.to(sid).emit('gameStarted', {
        myPlayer,
        allPlayers: Object.values(room.players),
        allBots: Object.values(room.bots).map(b=>({
          ...b, isHardcore: b.isHardcore||false, scale: b.scale||1
        })),
        upgrades: applyDifficultyCosts(UPGRADES, room.difficulty),
        difficulty: room.difficulty,
        pads: PADS, worldSize: WORLD_SIZE, padSize: PAD_SIZE,
        gameMode: room.gameMode,
        buildings: Object.values(room.buildings),
        savedGame: null,
      });
    }
    broadcastLobbyUpdate();

    // 5-second countdown then start the loop
    let count = 5;
    emitToRoom(room, 'countdown', { count });
    const cdInterval = setInterval(() => {
      count--;
      if (count > 0) {
        emitToRoom(room, 'countdown', { count });
      } else {
        clearInterval(cdInterval);
        emitToRoom(room, 'countdown', { count: 0, go: true });
        startRoomLoop(room);
      }
    }, 1000);
  });

  // ── In-Game Events ──
  socket.on('move', (data) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const p = room.players[socket.id]; if (!p||p.isDead) return;
    p.x = Math.max(20, Math.min(WORLD_SIZE-20, data.x));
    p.y = Math.max(20, Math.min(WORLD_SIZE-20, data.y));
    if (data.dir !== undefined) p.dir = data.dir;  // store facing direction
    socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dir: data.dir });
  });

  socket.on('attack', (targetId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.status !== 'playing') return;  // block during countdown
    const atk = room.players[socket.id]; if (!atk || atk.isDead) return;
    const now = Date.now();
    if (now - atk.lastAttack < 800) return;  // 0.8s cooldown
    const tgt = room.players[targetId] || room.bots[targetId];
    if (!tgt || tgt.isDead) return;
    if (dist(atk, tgt) > 450) return;  // very lenient — client already validated range
    atk.lastAttack = now;
    handleAttack(atk, tgt, room);
  });

  socket.on('collectDrop', (dropId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const p = room.players[socket.id]; if (!p||p.isDead) return;
    const idx = room.moneyDrops.findIndex(d=>d.id===dropId); if (idx===-1) return;
    const drop = room.moneyDrops[idx];
    if (dist(p, drop) > 100) return;
    p.money += drop.amount; p.totalEarned += drop.amount;
    room.moneyDrops.splice(idx, 1);
    emitToRoom(room, 'dropCollected', { dropId, playerId: socket.id, money: p.money });
  });

  socket.on('buyUpgrade', (payload) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const p = room.players[socket.id]; if (!p) return;
    const upgradeId = typeof payload === 'string' ? payload : payload?.upgradeId;
    const targetPos = (payload && typeof payload === 'object' && payload.x !== undefined && payload.y !== undefined)
      ? { x: payload.x, y: payload.y } : null;
    const upg = UPGRADES[upgradeId]; if (!upg) return;
    const isBuild = upg.cat === 'build';
    const placesBuilding = isBuild || upg.cat === 'income';

    // Build/income items spawn a building — dragged-and-dropped onto a spot in your own base
    if (placesBuilding && targetPos && !isPositionInsideBase(p, targetPos.x, targetPos.y)) {
      socket.emit('upgradeError', 'Must place inside your own base!'); return;
    }

    // Build items can be bought unlimited times; stat upgrades only once
    if (!isBuild && p.upgrades.includes(upgradeId)) return;
    if (upg.req && !p.upgrades.includes(upg.req)) { socket.emit('upgradeError',`Requires ${UPGRADES[upg.req].name}!`); return; }
    const diffMult = room.difficulty==='easy' ? 0.3 : room.difficulty==='hard' ? 1.5 : 1.0;
    const actualCost = Math.max(1, Math.round(upg.cost * diffMult));
    if (p.money < actualCost) { socket.emit('upgradeError','Not enough fossils!'); return; }

    p.money -= actualCost;
    if (!isBuild) {
      // Stat upgrade — add once, recalc stats, persist
      p.upgrades.push(upgradeId);
      const stats = calcStats(p.upgrades);
      Object.assign(p, stats); p.hp = Math.min(p.hp, p.maxHp);
      persistPlayer(p);
    }
    socket.emit('upgradeSuccess', { upgradeId, money: p.money, stats: calcStats(p.upgrades) });
    emitToRoom(room, 'playerUpgraded', { id: socket.id, upgradeId });

    // Place building (income or defense) — at the dropped position if dragged from the
    // shop, otherwise falls back to the legacy "place near where you're standing" behavior
    placeBuilding(room, p, upgradeId, targetPos);
  });

  socket.on('wallContact', (buildingId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const p = room.players[socket.id]; if (!p || p.isDead) return;
    const b = room.buildings[buildingId]; if (!b || b.hp <= 0) return;
    if (!isWallBuilding(b.upgradeId) || b.ownerId === socket.id) return;
    const now = Date.now();
    if (now - (p._lastWallContact||0) < 700) return;   // server-side cooldown
    p._lastWallContact = now;
    // Player takes 4 damage from the wall
    const dmg = 4;
    p.hp -= dmg;
    emitToRoom(room, 'attackResult', { attackerId: b.ownerId, targetId: socket.id, damage: dmg, targetHp: p.hp, targetMaxHp: p.maxHp });
    if (p.hp <= 0) {
      p.isDead = true; p.deaths++;
      const loot = Math.floor(p.money * 0.15);
      p.money = Math.max(0, p.money - loot);
      const owner = room.players[b.ownerId]; if (owner) { owner.money += loot; owner.kills++; }
      emitToRoom(room, 'playerDied', { victimId: socket.id, killerId: b.ownerId, loot, killerMoney: owner?.money||0 });
      persistPlayer(p);
    }
  });

  socket.on('attackBuilding', (buildingId) => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    if (room.status !== 'playing') return;
    const atk = room.players[socket.id]; if (!atk || atk.isDead) return;
    const b = room.buildings[buildingId]; if (!b || b.hp <= 0) return;
    if (b.ownerId === socket.id) return;  // can't attack own buildings
    const now = Date.now();
    if (now - atk.lastAttack < 800) return;
    if (dist(atk, b) > 400) return;
    atk.lastAttack = now;
    const rawDmg = atk.damage + Math.floor(Math.random()*8) - 4;
    const dmg = Math.max(1, rawDmg);
    b.hp -= dmg;
    emitToRoom(room, 'buildingDamaged', { id: buildingId, hp: b.hp, maxHp: b.maxHp, damage: dmg });
    if (b.hp <= 0) destroyBuilding(room, buildingId, atk);
  });

  socket.on('prestige', () => {
    const room = rooms[socketRoom[socket.id]]; if (!room) return;
    const p = room.players[socket.id]; if (!p) return;
    if (p.money < 100000) { socket.emit('upgradeError','Need $100k fossils to prestige!'); return; }
    p.prestige++; p.money = 0; p.upgrades = [];
    const stats = calcStats([]);
    p.mps = stats.mps + p.prestige*25; p.speed = stats.speed;
    p.damage = stats.damage + p.prestige*6; p.defense = stats.defense + p.prestige*3;
    p.maxHp = stats.maxHp + p.prestige*60; p.hp = p.maxHp;
    socket.emit('prestigeSuccess', { prestige: p.prestige });
    emitToRoom(room, 'playerPrestiged', { id: socket.id, prestige: p.prestige });
    persistPlayer(p);
  });

  socket.on('chat', (msg) => {
    const room = rooms[socketRoom[socket.id]]; if (!room||!authedUser) return;
    const safe = String(msg).slice(0,120).replace(/</g,'&lt;').replace(/>/g,'&gt;');
    emitToRoom(room, 'chatMessage', { username: authedUser.username, message: safe, color: room.lobbyPlayers[socket.id]?.color||'#fff' });
  });

  socket.on('disconnect', () => {
    if (authedUser) delete onlineByName[authedUser.username.toLowerCase()];
    leaveRoom(socket);
    broadcastLobbyUpdate();
    console.log(`Disconnected: ${authedUser?.username||socket.id}`);
  });
});

connectDB().then(() => {
  server.listen(PORT, () => console.log(`\n🦕 Dino Tycoon → http://localhost:${PORT}\n`));
}).catch(err => { console.error('❌ MongoDB connection failed:', err); process.exit(1); });
