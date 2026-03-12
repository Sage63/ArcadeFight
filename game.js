// ═══════════════════════════════════════════════
//  PIXEL BRAWL — Expandable Arcade Fighter Engine
//  Architecture: Entity-Component style, game loop
//  with requestAnimationFrame, pixel canvas rendering
// ═══════════════════════════════════════════════

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const W = 960, H = 420;
const FLOOR_Y = 385;
const GRAVITY = 0.7;
const JUMP_FORCE = -16;
const MAP_ZOOM = 1.08;

function makeSprite(src, frames, frameDelay, loop = true, frameW = 0, frameH = 0) {
  const image = new Image();
  image.src = encodeURI(src);
  return { image, frames, frameDelay, loop, frameW, frameH };
}

function makeMapLayer(src) {
  const image = new Image();
  image.src = encodeURI(src);
  return image;
}

// ── GAME STATE ──
let gameState = 'title'; // title | select | countdown | fighting | finishSlowmo | paused | roundOver | gameOver
let roundTimer = 99;
let timerInterval = null;
let roundNum = 1;
let p1Wins = 0;
let p2Wins = 0;
let countdownVal = 3;
let animFrame = null;
let lastTime = 0;
let particles = [];
let hitEffects = [];
let bgStars = [];
let projectiles = [];
let winFocusFighter = null;
let cameraZoom = 1;
let cameraFocusX = W / 2;
let cameraFocusY = H / 2;
let mobileControlLayout = 'large';
let lastMobileVibrationAt = 0;
let screenShake = 0;
let specialFreezeFrames = 0;
let lastCombatSfxAt = 0;
let finishSlowmoFrames = 0;
let finishSlowmoTick = 0;
let pendingRoundEndReason = null;

const ATTACK_DURATIONS = { punch: 16, kick: 24, special: 32 };
const STAMINA_MAX = 100;
const STAMINA_REGEN_IDLE = 0.55;
const STAMINA_REGEN_ACTIVE = 0.32;
const STAMINA_BLOCK_DRAIN = 0.38;
const STAMINA_COST = { punch: 16, kick: 24, special: 46 };
const SPECIAL_PROJECTILE_DAMAGE = 36;
const SPECIAL_PROJECTILE_SPEED = 11;
const SPECIAL_PROJECTILE_RADIUS = 12;
const SPECIAL_PROJECTILE_LIFE = 90;
const ROUND_FINISH_SLOWMO_FRAMES = 44;
const ROUND_FINISH_SLOWMO_SKIP = 3;
const ROUND_ANNOUNCE_TOTAL_MS = 3600;
const INTER_ROUND_DELAY_MS = 4600;

const SFX_SRC = {
  coin: 'assets/sfx/8d82b5_Street_Fighter_Coin_Sound_Effect.mp3',
  choose: 'assets/sfx/8d82b5_Street_Fighter_Choose_Sound_Effect.mp3',
  introBgm: 'assets/sfx/intro-music-bg.mp3',
  round: 'assets/sfx/8d82b5_Street_Fighter_Round_Sound_Effect.mp3',
  one: 'assets/sfx/8d82b5_Street_Fighter_One_Sound_Effect.mp3',
  two: 'assets/sfx/8d82b5_Street_Fighter_Two_Sound_Effect.mp3',
  three: 'assets/sfx/8d82b5_Street_Fighter_Three_Sound_Effect.mp3',
  four: 'assets/sfx/8d82b5_Street_Fighter_Four_Sound_Effect.mp3',
  fight: 'assets/sfx/8d82b5_Street_Fighter_Fight_Sound_Effect.mp3',
  win: 'assets/sfx/8d82b5_Street_Fighter_Win_Sound_Effect.mp3',
  lose: 'assets/sfx/8d82b5_Street_Fighter_Lose_Sound_Effect.mp3',
  ko: 'assets/sfx/Street Fighter K.O - QuickSounds.com.mp3',
  you: 'assets/sfx/8d82b5_Street_Fighter_You_Sound_Effect.mp3',
  punch: 'assets/sfx/8d82b5_Street_Fighter_Little_Punch_Sound_Effect.mp3',
  kick: 'assets/sfx/8d82b5_Street_Fighter_Little_Kick_Sound_Effect.mp3',
  hadouken: 'assets/sfx/8d82b5_Street_Fighter_Hadouken_Sound_Effect.mp3',
};

const SFX_BANK = Object.fromEntries(
  Object.entries(SFX_SRC).map(([name, src]) => {
    const audio = new Audio(encodeURI(src));
    audio.preload = 'auto';
    return [name, audio];
  })
);

function playSfx(name, volume = 0.9) {
  const base = SFX_BANK[name];
  if (!base) return;
  const clip = base.cloneNode(true);
  clip.volume = Math.max(0, Math.min(1, volume));
  clip.play().catch(() => {});
}

// Voice/announcer lines should play on a dedicated channel to keep timing stable and clear.
function playVoice(name, volume = 1) {
  const clip = SFX_BANK[name];
  if (!clip) return;
  clip.pause();
  clip.currentTime = 0;
  clip.volume = Math.max(0, Math.min(1, volume));
  clip.play().catch(() => {});
}

function playRoundSfx(round) {
  setTimeout(() => playVoice('round', 1), 120);
  const numKey = round <= 1 ? 'one' : round === 2 ? 'two' : round === 3 ? 'three' : 'four';
  setTimeout(() => playVoice(numKey, 1), 1050);
  setTimeout(() => playVoice('fight', 1), 2250);
}

const introBgm = SFX_BANK.introBgm;
if (introBgm) {
  introBgm.loop = true;
  introBgm.volume = 0.42;
}

function tryStartIntroBgm() {
  if (!introBgm) return;
  if (gameState !== 'title') return;
  introBgm.play().catch(() => {});
}

function stopIntroBgm() {
  if (!introBgm) return;
  introBgm.pause();
  introBgm.currentTime = 0;
}

function playOutcomeSfx(outcome) {
  playVoice('you', 1);
  setTimeout(() => playVoice(outcome, 1), 640);
}

function queueOutcomeSfx(outcome, extraDelayMs = 0) {
  const elapsed = performance.now() - lastCombatSfxAt;
  const delay = Math.max(extraDelayMs, Math.max(0, 850 - elapsed));
  setTimeout(() => playOutcomeSfx(outcome), delay);
}

function triggerRoundFinishSlowmo(reason) {
  if (gameState !== 'fighting') return;
  clearInterval(timerInterval);
  gameState = 'finishSlowmo';
  pendingRoundEndReason = reason;
  finishSlowmoFrames = ROUND_FINISH_SLOWMO_FRAMES;
  finishSlowmoTick = 0;
}

// Generate background stars once
for (let i = 0; i < 60; i++) {
  bgStars.push({ x: Math.random() * W, y: Math.random() * 200, size: Math.random() < 0.3 ? 2 : 1, blink: Math.random() });
}

// ── FIGHTER DEFINITION ──
// Extend this object to add new characters, moves, specials
const FIGHTER_DEFS = {
  HERO_KNIGHT_2: {
    name: 'HERO KNIGHT',
    color: '#00e5ff',
    width: 40,
    height: 60,
    speed: 5,
    jumpForce: -16,
    maxHP: 200,
    special: 'SURGE',
    specialColor: '#00ffff',
    spriteScale: 4.6,
    spriteFeetY: 83,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/hero-knight-2/Idle.png', 11, 7, true, 140, 140),
      walk: makeSprite('assets/characters/hero-knight-2/Run.png', 8, 5, true, 140, 140),
      jump: makeSprite('assets/characters/hero-knight-2/Jump.png', 4, 6, false, 140, 140),
      fall: makeSprite('assets/characters/hero-knight-2/Fall.png', 4, 6, false, 140, 140),
      punch: makeSprite('assets/characters/hero-knight-2/Attack.png', 6, 3, false, 140, 140),
      kick: makeSprite('assets/characters/hero-knight-2/Dash.png', 4, 4, false, 140, 140),
      block: makeSprite('assets/characters/hero-knight-2/Idle.png', 11, 12, true, 140, 140),
      hurt: makeSprite('assets/characters/hero-knight-2/Take Hit.png', 4, 4, false, 140, 140),
      special: makeSprite('assets/characters/hero-knight-2/Attack.png', 6, 2, false, 140, 140),
      ko: makeSprite('assets/characters/hero-knight-2/Death.png', 9, 6, false, 140, 140),
    },
  },
  MARTIAL_HERO_1: {
    name: 'MARTIAL HERO',
    color: '#7ad1ff',
    width: 42,
    height: 62,
    speed: 5,
    jumpForce: -15.6,
    maxHP: 205,
    special: 'DRAGON FURY',
    specialColor: '#6ec6ff',
    spriteScale: 3.6,
    spriteFeetY: 122,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/martial-hero-1/Idle.png', 8, 7, true, 200, 200),
      walk: makeSprite('assets/characters/martial-hero-1/Run.png', 8, 5, true, 200, 200),
      jump: makeSprite('assets/characters/martial-hero-1/Jump.png', 2, 7, false, 200, 200),
      fall: makeSprite('assets/characters/martial-hero-1/Fall.png', 2, 7, false, 200, 200),
      punch: makeSprite('assets/characters/martial-hero-1/Attack1.png', 6, 3, false, 200, 200),
      kick: makeSprite('assets/characters/martial-hero-1/Attack2.png', 6, 3, false, 200, 200),
      block: makeSprite('assets/characters/martial-hero-1/Idle.png', 8, 12, true, 200, 200),
      hurt: makeSprite('assets/characters/martial-hero-1/Take Hit.png', 4, 5, false, 200, 200),
      special: makeSprite('assets/characters/martial-hero-1/Attack2.png', 6, 2, false, 200, 200),
      ko: makeSprite('assets/characters/martial-hero-1/Death.png', 6, 6, false, 200, 200),
    },
  },
  MARTIAL_HERO_2: {
    name: 'MARTIAL HERO 2',
    color: '#6cffcc',
    width: 44,
    height: 64,
    speed: 4.8,
    jumpForce: -15,
    maxHP: 220,
    special: 'TIGER DASH',
    specialColor: '#7dffdb',
    spriteScale: 3.4,
    spriteFeetY: 128,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/martial-hero-2/Idle.png', 4, 8, true, 200, 200),
      walk: makeSprite('assets/characters/martial-hero-2/Run.png', 8, 5, true, 200, 200),
      jump: makeSprite('assets/characters/martial-hero-2/Jump.png', 2, 7, false, 200, 200),
      fall: makeSprite('assets/characters/martial-hero-2/Fall.png', 2, 7, false, 200, 200),
      punch: makeSprite('assets/characters/martial-hero-2/Attack1.png', 4, 3, false, 200, 200),
      kick: makeSprite('assets/characters/martial-hero-2/Attack2.png', 4, 3, false, 200, 200),
      block: makeSprite('assets/characters/martial-hero-2/Idle.png', 4, 12, true, 200, 200),
      hurt: makeSprite('assets/characters/martial-hero-2/Take hit.png', 3, 5, false, 200, 200),
      special: makeSprite('assets/characters/martial-hero-2/Attack2.png', 4, 2, false, 200, 200),
      ko: makeSprite('assets/characters/martial-hero-2/Death.png', 7, 6, false, 200, 200),
    },
  },
  MARTIAL_HERO_3: {
    name: 'MARTIAL HERO 3',
    color: '#ff4444',
    width: 44,
    height: 62,
    speed: 4.5,
    jumpForce: -15,
    maxHP: 220,
    special: 'INFERNO',
    specialColor: '#ff8800',
    spriteScale: 4.4,
    spriteFeetY: 82,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/martial-hero-3/Idle.png', 10, 7, true, 126, 126),
      walk: makeSprite('assets/characters/martial-hero-3/Run.png', 8, 5, true, 126, 126),
      jump: makeSprite('assets/characters/martial-hero-3/Going Up.png', 3, 5, false, 126, 126),
      fall: makeSprite('assets/characters/martial-hero-3/Going Down.png', 3, 5, false, 126, 126),
      punch: makeSprite('assets/characters/martial-hero-3/Attack1.png', 7, 3, false, 126, 126),
      kick: makeSprite('assets/characters/martial-hero-3/Attack2.png', 6, 3, false, 126, 126),
      block: makeSprite('assets/characters/martial-hero-3/Idle.png', 10, 12, true, 126, 126),
      hurt: makeSprite('assets/characters/martial-hero-3/Take Hit.png', 3, 4, false, 126, 126),
      special: makeSprite('assets/characters/martial-hero-3/Attack3.png', 9, 2, false, 126, 126),
      ko: makeSprite('assets/characters/martial-hero-3/Death.png', 11, 6, false, 126, 126),
    },
  },
  EVIL_WIZARD_2: {
    name: 'EVIL WIZARD',
    color: '#f16dff',
    width: 42,
    height: 62,
    speed: 4.7,
    jumpForce: -15.4,
    maxHP: 195,
    special: 'VOID BLAST',
    specialColor: '#ff6ff6',
    spriteScale: 2.35,
    spriteFeetY: 167,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/evil-wizard-2/Idle.png', 8, 7, true, 250, 250),
      walk: makeSprite('assets/characters/evil-wizard-2/Run.png', 8, 5, true, 250, 250),
      jump: makeSprite('assets/characters/evil-wizard-2/Jump.png', 2, 7, false, 250, 250),
      fall: makeSprite('assets/characters/evil-wizard-2/Fall.png', 2, 7, false, 250, 250),
      punch: makeSprite('assets/characters/evil-wizard-2/Attack1.png', 8, 3, false, 250, 250),
      kick: makeSprite('assets/characters/evil-wizard-2/Attack2.png', 8, 3, false, 250, 250),
      block: makeSprite('assets/characters/evil-wizard-2/Idle.png', 8, 12, true, 250, 250),
      hurt: makeSprite('assets/characters/evil-wizard-2/Take hit.png', 3, 5, false, 250, 250),
      special: makeSprite('assets/characters/evil-wizard-2/Attack2.png', 8, 2, false, 250, 250),
      ko: makeSprite('assets/characters/evil-wizard-2/Death.png', 7, 6, false, 250, 250),
    },
  },
  WIZARD_PACK: {
    name: 'BATTLE WIZARD',
    color: '#ffd24d',
    width: 42,
    height: 62,
    speed: 4.6,
    jumpForce: -15.2,
    maxHP: 200,
    special: 'ARCANE STORM',
    specialColor: '#ffe680',
    spriteScale: 2.0,
    spriteFeetY: 141,
    spriteOffsetX: 0,
    spriteOffsetY: 0,
    sprites: {
      idle: makeSprite('assets/characters/wizard-pack/Idle.png', 6, 7, true, 231, 190),
      walk: makeSprite('assets/characters/wizard-pack/Run.png', 8, 5, true, 231, 190),
      jump: makeSprite('assets/characters/wizard-pack/Jump.png', 2, 7, false, 231, 190),
      fall: makeSprite('assets/characters/wizard-pack/Fall.png', 2, 7, false, 231, 190),
      punch: makeSprite('assets/characters/wizard-pack/Attack1.png', 8, 3, false, 231, 190),
      kick: makeSprite('assets/characters/wizard-pack/Attack2.png', 8, 3, false, 231, 190),
      block: makeSprite('assets/characters/wizard-pack/Idle.png', 6, 12, true, 231, 190),
      hurt: makeSprite('assets/characters/wizard-pack/Hit.png', 4, 5, false, 231, 190),
      special: makeSprite('assets/characters/wizard-pack/Attack2.png', 8, 2, false, 231, 190),
      ko: makeSprite('assets/characters/wizard-pack/Death.png', 7, 6, false, 231, 190),
    },
  }
};

const ROSTER = Object.keys(FIGHTER_DEFS);
const PROFILE_IMAGE_BY_KEY = {
  HERO_KNIGHT_2: 'assets/characters_profile/hero knight.png',
  MARTIAL_HERO_1: 'assets/characters_profile/martial 1.png',
  MARTIAL_HERO_2: 'assets/characters_profile/martial 2.png',
  MARTIAL_HERO_3: 'assets/characters_profile/martial 3.png',
  EVIL_WIZARD_2: 'assets/characters_profile/evil wizard.png',
  WIZARD_PACK: 'assets/characters_profile/wizard.png',
};

function getProfileImage(key) {
  return PROFILE_IMAGE_BY_KEY[key] || 'assets/characters_profile/hero knight.png';
}

const BALANCED_STATS = {
  maxHP: 210,
  speed: 4.8,
  jumpForce: -15.3,
};

Object.values(FIGHTER_DEFS).forEach(def => {
  def.maxHP = BALANCED_STATS.maxHP;
  def.speed = BALANCED_STATS.speed;
  def.jumpForce = BALANCED_STATS.jumpForce;
});

let selectedP1Key = ROSTER[0];
let selectedP2Key = ROSTER[3] || ROSTER[1];
let selectTurn = 1;
let selectPhase = 'mode';
let gameMode = 'pvp';
let cpuDifficulty = 'medium';
let specialEffectActive = 0;

const AI_DIFFICULTY = {
  easy: { attackRange: 95, approachRange: 145, attackChance: 0.03, specialChance: 0.005, jumpChance: 0.003, blockChance: 0.12 },
  medium: { attackRange: 105, approachRange: 160, attackChance: 0.06, specialChance: 0.012, jumpChance: 0.005, blockChance: 0.24 },
  hard: { attackRange: 120, approachRange: 180, attackChance: 0.09, specialChance: 0.02, jumpChance: 0.007, blockChance: 0.36 },
};

const MAP_DEFS = {
  CITY1_BRIGHT: {
    name: 'CITY 1 - BRIGHT',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/City1.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/Sky.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/buildings.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/wall1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/wall2.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/City1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/boxes&container.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/wheels&hydrant.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Bright/road&border.png',
    ],
  },
  CITY1_PALE: {
    name: 'CITY 1 - PALE',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/City1.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/sky.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/buildings.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/wall1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/wall2.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/City1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/boxes&container.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/wheels&hydrant.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City1/Pale/road&border.png',
    ],
  },
  CITY2_BRIGHT: {
    name: 'CITY 2 - BRIGHT',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/City2.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/Sky.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/back.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/houses1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/houses3.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/City2.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/minishop&callbox.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Bright/road&lamps.png',
    ],
  },
  CITY2_PALE: {
    name: 'CITY 2 - PALE',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/City2_pale.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/Sky_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/Back_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/houses1_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/Houses3_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/City2_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/minishop&callbox_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City2/Pale/road&lamps_pale.png',
    ],
  },
  CITY3_BRIGHT: {
    name: 'CITY 3 - BRIGHT',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/City3.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/sky.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/houses1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/houses3.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/houded2.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/City3.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/crosswalk.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Bright/road.png',
    ],
  },
  CITY3_PALE: {
    name: 'CITY 3 - PALE',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/City3_pale.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/sky_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/houses1_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/houses3_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/houded2_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/City3_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/crosswalk_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City3/Pale/road_pale.png',
    ],
  },
  CITY4_BRIGHT: {
    name: 'CITY 4 - BRIGHT',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/City4.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/Sky.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/houses.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/houses1.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/houses2.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/City4.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/fountain&bush.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/umbrella&policebox.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Bright/road.png',
    ],
  },
  CITY4_PALE: {
    name: 'CITY 4 - PALE',
    preview: 'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/City4_pale.png',
    layers: [
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/Sky_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/houses_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/houses1_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/houses2_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/City4_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/fountain&bush_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/umbrella&policebox_pale.png',
      'assets/Free-Pixel-Art-Street-2D-Backgrounds/PNG/City4/Pale/road_pale.png',
    ],
  },
};

Object.values(MAP_DEFS).forEach(map => {
  map.previewImage = makeMapLayer(map.preview);
  map.layerImages = map.layers.map(makeMapLayer);
});

const MAP_KEYS = Object.keys(MAP_DEFS);
let selectedMapKey = MAP_KEYS[0];

// ── FIGHTER CLASS ──
class Fighter {
  constructor(def, x, facing, controls) {
    this.def = def;
    this.name = def.name;
    this.x = x;
    this.y = FLOOR_Y - def.height;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing; // 1 = right, -1 = left
    this.onGround = true;
    this.hp = def.maxHP;
    this.maxHP = def.maxHP;
    this.controls = controls;
    this.state = 'idle'; // idle | walk | jump | punch | kick | block | hurt | special | taunt | ko
    this.stateTimer = 0;
    this.blocking = false;
    this.specialMeter = 0; // 0-100
    this.maxStamina = STAMINA_MAX;
    this.stamina = STAMINA_MAX;
    this.hitbox = null;
    this.frameCount = 0;
    this.idlePhase = 0;
    this.combo = 0;
    this.lastHitTime = 0;
    this.invincible = 0;
    this.attackCooldown = 0;
    this.blockCooldown = 0;
    this.width = def.width;
    this.height = def.height;
    this.animState = 'idle';
    this.animFrame = 0;
    this.animTick = 0;
    this.attackHasHit = false;
    this.attackDuration = 0;
    // Shake effect
    this.shakeX = 0;
    this.shakeTimer = 0;
  }

  get cx() { return this.x + this.width / 2; }
  get cy() { return this.y + this.height / 2; }

  isAttacking() {
    return this.state === 'punch' || this.state === 'kick' || this.state === 'special';
  }

  startAttack(type, duration, cooldown) {
    const cost = STAMINA_COST[type] || 0;
    this.stamina = Math.max(0, this.stamina - cost);
    this.state = type;
    this.stateTimer = duration;
    this.attackDuration = duration;
    this.attackHasHit = false;
    this.attackCooldown = cooldown;
  }

  isAttackActive() {
    if (!this.isAttacking() || this.attackDuration <= 0) return false;
    const progress = 1 - (this.stateTimer / this.attackDuration);
    if (this.state === 'punch') return progress >= 0.25 && progress <= 0.6;
    if (this.state === 'kick') return progress >= 0.2 && progress <= 0.7;
    if (this.state === 'special') return progress >= 0.2 && progress <= 0.85;
    return false;
  }

  getAttackBox() {
    if (!this.isAttacking()) return null;
    if (this.state === 'special') return null;
    const reach = this.state === 'kick' ? 70 : (this.state === 'special' ? 110 : 58);
    const yOffset = this.state === 'kick' ? 20 : 8;
    const h = this.state === 'kick' ? 22 : 18;
    return {
      x: this.facing === 1 ? this.x + this.width : this.x - reach,
      y: this.y + yOffset,
      w: reach,
      h: h,
      dmg: this.state === 'special' ? 35 : (this.state === 'kick' ? 18 : 12),
      type: this.state
    };
  }

  getHurtbox() {
    return { x: this.x + 4, y: this.y + 4, w: this.width - 8, h: this.height - 4 };
  }

  takeDamage(amount, attacker, hitType = 'punch') {
    if (this.invincible > 0 || this.state === 'ko') return 0;
    const blocked = this.blocking && this.onGround;
    const dmg = blocked ? Math.floor(amount * 0.15) : amount;
    this.hp = Math.max(0, this.hp - dmg);
    if (!blocked && this.hp <= 0) {
      this.state = 'ko';
      this.stateTimer = 9999;
      this.vx = 0;
      this.vy = 0;
      this.onGround = true;
      this.invincible = 0;
    } else if (!blocked) {
      this.state = 'hurt';
      if (hitType === 'special' || hitType === 'projectile') {
        this.stateTimer = 28;
        this.vx = attacker.facing * 9;
        this.vy = -9.5;
        this.onGround = false;
      } else if (hitType === 'kick') {
        this.stateTimer = 22;
        this.vx = attacker.facing * 7;
        this.vy = -5.5;
        this.onGround = false;
      } else {
        this.stateTimer = 16;
        this.vx = attacker.facing * 5.5;
        if (this.onGround) this.vy = -1.5;
      }
      this.invincible = 20;
      this.shakeX = 8;
      this.shakeTimer = 8;
    }
    return dmg;
  }

  update(keys, opponent) {
    this.frameCount++;
    this.idlePhase = Math.sin(this.frameCount * 0.06) * 2;

    // Shake
    if (this.shakeTimer > 0) {
      this.shakeX = (Math.random() - 0.5) * 8;
      this.shakeTimer--;
    } else { this.shakeX = 0; }

    if (this.invincible > 0) this.invincible--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.blockCooldown > 0) this.blockCooldown--;

    if (this.blocking) {
      this.stamina = Math.max(0, this.stamina - STAMINA_BLOCK_DRAIN);
    }

    // KO
    if (this.hp <= 0 && this.state !== 'ko') {
      this.state = 'ko';
      this.stateTimer = 9999;
      this.vx = 0;
      return;
    }

    // State timer
    if (this.stateTimer > 0) {
      this.stateTimer--;
      if (this.stateTimer === 0 && this.state !== 'ko') this.state = 'idle';
    }

    // Auto-face opponent
    if (this.state === 'idle' || this.state === 'walk') {
      this.facing = opponent.cx > this.cx ? 1 : -1;
    }

    // Input
    if (this.state !== 'hurt' && this.state !== 'ko') {
      this.blocking = false;

      // Block
      if (keys[this.controls.block] && this.onGround && this.blockCooldown === 0) {
        if (this.stamina > 8) {
          this.blocking = true;
          this.state = 'block';
          this.stateTimer = 3;
        }
      }

      // Attack
      if (!this.isAttacking() && this.stateTimer === 0) {
        if (keys[this.controls.special] && this.specialMeter >= 100 && this.stamina >= STAMINA_COST.special) {
          this.startAttack('special', ATTACK_DURATIONS.special, 40);
          lastCombatSfxAt = performance.now();
          playSfx('hadouken', 0.95);
          this.specialMeter = 0;
          spawnSpecialEffect(this);
          spawnSpecialProjectile(this);
        } else if (keys[this.controls.kick] && this.attackCooldown === 0 && this.stamina >= STAMINA_COST.kick) {
          this.startAttack('kick', ATTACK_DURATIONS.kick, 28);
          lastCombatSfxAt = performance.now();
          playSfx('kick', 0.8);
        } else if (keys[this.controls.punch] && this.attackCooldown === 0 && this.stamina >= STAMINA_COST.punch) {
          this.startAttack('punch', ATTACK_DURATIONS.punch, 18);
          lastCombatSfxAt = performance.now();
          playSfx('punch', 0.8);
        }
      }

      // Move
      if (!this.isAttacking() && this.state !== 'block') {
        if (keys[this.controls.left]) {
          this.vx = -this.def.speed;
          if (this.onGround) this.state = 'walk';
        } else if (keys[this.controls.right]) {
          this.vx = this.def.speed;
          if (this.onGround) this.state = 'walk';
        } else {
          this.vx *= 0.7;
          if (this.onGround && this.state === 'walk') this.state = 'idle';
        }

        // Jump
        if (keys[this.controls.jump] && this.onGround) {
          this.vy = this.def.jumpForce;
          this.onGround = false;
          this.state = 'jump';
        }
      }
    }

    // Physics
    this.vy += GRAVITY;
    this.x += this.vx;
    this.y += this.vy;

    // Floor
    if (this.y >= FLOOR_Y - this.height) {
      this.y = FLOOR_Y - this.height;
      this.vy = 0;
      this.onGround = true;
      if (this.state === 'jump') this.state = 'idle';
    }

    if (this.state === 'hurt' && this.onGround) {
      this.vx *= 0.86;
    }

    // Walls
    this.x = Math.max(10, Math.min(W - this.width - 10, this.x));

    // Special meter fill (slow passive + on hit)
    if (this.specialMeter < 100) this.specialMeter = Math.min(100, this.specialMeter + 0.05);

    // Stamina regen: faster while neutral, slower during active movement/actions.
    const staminaRegen = (!this.isAttacking() && this.state !== 'block') ? STAMINA_REGEN_IDLE : STAMINA_REGEN_ACTIVE;
    this.stamina = Math.min(this.maxStamina, this.stamina + staminaRegen);

    this.updateAnimation();
  }

  getAnimState() {
    if (this.state === 'ko') return 'ko';
    if (this.state === 'hurt') return 'hurt';
    if (this.state === 'taunt') return 'taunt';
    if (this.state === 'jump') return this.vy >= 0 ? 'fall' : 'jump';
    if (this.state === 'punch') return 'punch';
    if (this.state === 'kick') return 'kick';
    if (this.state === 'special') return 'special';
    if (this.state === 'block') return 'block';
    if (this.state === 'walk') return 'walk';
    return 'idle';
  }

  updateAnimation() {
    const nextState = this.getAnimState();
    const anim = this.def.sprites[nextState] || this.def.sprites.idle;
    if (!anim) return;

    if (nextState !== this.animState) {
      this.animState = nextState;
      this.animFrame = 0;
      this.animTick = 0;
      return;
    }

    this.animTick++;
    if (this.animTick >= anim.frameDelay) {
      this.animTick = 0;
      if (anim.loop) {
        this.animFrame = (this.animFrame + 1) % anim.frames;
      } else {
        this.animFrame = Math.min(anim.frames - 1, this.animFrame + 1);
      }
    }
  }

  // ── SPRITE DRAWING ──
  draw(ctx) {
    const dx = this.x + this.shakeX;
    const dy = this.y;
    const col = this.def.color;

    ctx.save();
    // Flash on hurt/invincible
    if (this.invincible > 0 && Math.floor(this.invincible / 3) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    const S = this.state;
    drawFighterSprite(ctx, this, dx, dy);

    ctx.restore();
  }
}

function drawFighterSprite(ctx, fighter, dx, dy) {
  const state = fighter.animState || 'idle';
  const anim = fighter.def.sprites[state] || fighter.def.sprites.idle;
  if (!anim || !anim.image || !anim.image.complete) {
    // Fallback box while sprite is loading.
    ctx.fillStyle = fighter.def.color;
    ctx.fillRect(dx, dy, fighter.width, fighter.height);
    return;
  }

  const frameW = anim.frameW || Math.floor(anim.image.width / anim.frames);
  const frameH = anim.frameH || anim.image.height;
  const sx = Math.min(anim.frames - 1, fighter.animFrame) * frameW;

  const scale = fighter.def.spriteScale || 1;
  const drawW = Math.round(frameW * scale);
  const drawH = Math.round(frameH * scale);
  const offsetX = fighter.def.spriteOffsetX || 0;
  const offsetY = fighter.def.spriteOffsetY || 0;
  const feetY = fighter.def.spriteFeetY || frameH;

  const drawX = fighter.cx - drawW / 2 + offsetX;
  // Anchor to a configurable feet row inside each frame to avoid floating caused by transparent padding.
  const drawY = dy + fighter.height - (feetY * scale) + offsetY;

  ctx.save();
  if (fighter.facing === -1) {
    ctx.translate(drawX + drawW / 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(anim.image, sx, 0, frameW, frameH, -drawW / 2, drawY, drawW, drawH);
  } else {
    ctx.drawImage(anim.image, sx, 0, frameW, frameH, drawX, drawY, drawW, drawH);
  }
  ctx.restore();
}

// ── PIXEL DRAWING HELPERS ──
// ── SPECIAL EFFECT ──
function spawnSpecialEffect(fighter) {
  vibrateMobile([12, 18, 24, 14], 120);
  specialEffectActive = 45;
  screenShake = 14;
  specialFreezeFrames = 6;
  triggerSpecialFlash();
  
  // Main burst - intense particle cloud
  for (let i = 0; i < 48; i++) {
    const angle = (Math.PI * 2 * i) / 48;
    const speed = 16 + Math.random() * 12;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    particles.push({
      x: fighter.cx,
      y: fighter.cy,
      vx: vx,
      vy: vy,
      life: 50 + Math.random() * 30,
      maxLife: 80,
      color: fighter.def.specialColor,
      size: 5 + Math.random() * 8,
    });
  }
  
  // Outer ring of secondary particles
  for (let i = 0; i < 32; i++) {
    const angle = (Math.PI * 2 * i) / 32;
    const speed = 20 + Math.random() * 10;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    particles.push({
      x: fighter.cx,
      y: fighter.cy,
      vx: vx,
      vy: vy,
      life: 35 + Math.random() * 20,
      maxLife: 55,
      color: '#ffffff',
      size: 2 + Math.random() * 4,
    });
  }
}

function triggerSpecialFlash() {
  const overlay = document.getElementById('special-effect-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  void overlay.offsetWidth;
  overlay.classList.add('active');
  
  setTimeout(() => {
    overlay.classList.remove('active');
  }, 420);
}

function spawnHitEffect(x, y, color) {
  vibrateMobile(14, 60);
  for (let i = 0; i < 12; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.8) * 8,
      life: 20 + Math.random() * 10,
      maxLife: 30,
      color,
      size: 3 + Math.random() * 4,
    });
  }
  hitEffects.push({ x, y, life: 12, text: 'HIT!' });
}

function spawnBlockEffect(x, y) {
  hitEffects.push({ x, y, life: 10, text: 'BLOCK' });
}

function spawnSpecialProjectile(fighter) {
  const dir = fighter.facing;
  projectiles.push({
    owner: fighter,
    x: fighter.cx + dir * (fighter.width / 2 + 12),
    y: fighter.y + fighter.height * 0.45,
    vx: dir * SPECIAL_PROJECTILE_SPEED,
    radius: SPECIAL_PROJECTILE_RADIUS,
    life: SPECIAL_PROJECTILE_LIFE,
    damage: SPECIAL_PROJECTILE_DAMAGE,
    color: fighter.def.specialColor,
  });
}

function updateProjectiles() {
  if (!p1 || !p2) return;

  projectiles = projectiles.filter(pr => pr.life > 0 && pr.x > -40 && pr.x < W + 40);
  projectiles.forEach(pr => {
    pr.x += pr.vx;
    pr.life--;

    const target = pr.owner === p1 ? p2 : p1;
    if (!target || target.state === 'ko') return;
    const hb = target.getHurtbox();
    const hit = pr.x + pr.radius > hb.x && pr.x - pr.radius < hb.x + hb.w && pr.y + pr.radius > hb.y && pr.y - pr.radius < hb.y + hb.h;
    if (hit) {
      const dmg = target.takeDamage(pr.damage, pr.owner, 'projectile');
      if (dmg > 0) {
        pr.owner.specialMeter = Math.min(100, pr.owner.specialMeter + 10);
        spawnHitEffect(target.cx, target.cy - 16, pr.color);
      } else if (target.blocking) {
        spawnBlockEffect(target.cx, target.cy - 16);
      }
      pr.life = 0;
    }
  });
}

function drawProjectiles() {
  projectiles.forEach(pr => {
    const alpha = Math.max(0.4, pr.life / SPECIAL_PROJECTILE_LIFE);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pr.color;
    ctx.shadowBlur = 14;
    ctx.shadowColor = pr.color;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  });
}

// ── BACKGROUND DRAWING ──
function drawBackground() {
  const selectedMap = MAP_DEFS[selectedMapKey];
  if (selectedMap && selectedMap.layerImages && selectedMap.layerImages.length > 0) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
    selectedMap.layerImages.forEach(img => {
      if (img && img.complete) drawImageCover(img, 0, 0, W, H);
    });
    return;
  }

  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  grad.addColorStop(0, '#0a0a1e');
  grad.addColorStop(1, '#1a0a2e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, FLOOR_Y);

  // Stars
  bgStars.forEach(s => {
    const alpha = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() * 0.001 + s.blink * 10));
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  });

  // Distant city silhouette
  ctx.fillStyle = '#0f0f22';
  const buildings = [
    [0,40,60,120],[60,60,40,100],[100,30,80,130],[180,50,50,110],[230,20,70,140],
    [300,45,55,115],[360,35,65,125],[420,55,45,105],[470,25,75,135],[550,50,50,110],
    [600,40,60,120],[660,30,70,130],[730,50,50,110],[760,60,40,100]
  ];
  buildings.forEach(([x,y,w,h]) => {
    ctx.fillRect(x, FLOOR_Y - h, w, h);
    // Windows
    ctx.fillStyle = Math.random() < 0.005 ? '#ffee88' : '#1a1a3e';
    for (let wx = x + 5; wx < x + w - 5; wx += 10) {
      for (let wy = FLOOR_Y - h + 8; wy < FLOOR_Y - 8; wy += 12) {
        ctx.fillRect(wx, wy, 6, 6);
      }
    }
    ctx.fillStyle = '#0f0f22';
  });

  // Floor
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
  ctx.fillStyle = '#252542';
  ctx.fillRect(0, FLOOR_Y, W, 4);

  // Floor grid lines
  ctx.strokeStyle = '#252542';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 40) {
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(gx, FLOOR_Y);
    ctx.lineTo(gx + 20, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawImageCover(image, dx, dy, dw, dh) {
  const imgRatio = image.width / image.height;
  const canvasRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (imgRatio > canvasRatio) {
    sw = image.height * canvasRatio;
    sx = (image.width - sw) * 0.5;
  } else {
    sh = image.width / canvasRatio;
    sy = (image.height - sh) * 0.5;
  }

  const zoom = MAP_ZOOM;
  const zW = dw * zoom;
  const zH = dh * zoom;
  const zX = dx - (zW - dw) * 0.5;
  const zY = dy - (zH - dh) * 0.5;

  ctx.drawImage(image, sx, sy, sw, sh, zX, zY, zW, zH);
}

// ── COLLISION DETECTION ──
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function checkHits(attacker, defender) {
  if (!attacker.isAttackActive() || attacker.attackHasHit) return;
  const atk = attacker.getAttackBox();
  const def = defender.getHurtbox();
  if (atk && rectsOverlap(atk, def)) {
    const dmg = defender.takeDamage(atk.dmg, attacker, atk.type);
    attacker.attackHasHit = true;
    if (dmg > 0) {
      attacker.specialMeter = Math.min(100, attacker.specialMeter + 12);
      spawnHitEffect(defender.cx, defender.cy - 20, attacker.def.color);
      updateHUD();
    } else if (defender.blocking) {
      spawnBlockEffect(defender.cx, defender.cy - 20);
    }
  }
}

// ── INPUT ──
const keys = {};
document.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    togglePause();
    e.preventDefault();
    return;
  }
  keys[e.code] = true;
  e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
const cpuKeys = {};

function vibrateMobile(pattern, minGapMs = 0) {
  if (!('vibrate' in navigator) || typeof navigator.vibrate !== 'function') return;
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const now = performance.now();
  if (minGapMs > 0 && now - lastMobileVibrationAt < minGapMs) return;
  lastMobileVibrationAt = now;
  navigator.vibrate(pattern);
}

function syncMobileControlsMode() {
  const root = document.getElementById('mobile-controls');
  if (!root) return;
  root.classList.toggle('hide-p2', gameMode === 'cpu');
}

function setMobileControlLayout(layout) {
  if (layout !== 'compact' && layout !== 'large') return;
  mobileControlLayout = layout;
  const root = document.getElementById('mobile-controls');
  if (!root) return;

  root.classList.remove('compact', 'large');
  root.classList.add(layout);

  const compactBtn = document.getElementById('layout-compact');
  const largeBtn = document.getElementById('layout-large');
  if (compactBtn) compactBtn.classList.toggle('active', layout === 'compact');
  if (largeBtn) largeBtn.classList.toggle('active', layout === 'large');
}

function bindMobileControls() {
  const root = document.getElementById('mobile-controls');
  if (!root) return;

  const setButtonState = (btn, isDown) => {
    const key = btn.dataset.key;
    if (!key) return;
    keys[key] = isDown;
    btn.classList.toggle('active', isDown);
  };

  const releaseAll = () => {
    root.querySelectorAll('[data-key]').forEach(btn => setButtonState(btn, false));
  };

  root.querySelectorAll('[data-key]').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      setButtonState(btn, true);
    });

    btn.addEventListener('pointerup', e => {
      e.preventDefault();
      setButtonState(btn, false);
    });

    btn.addEventListener('pointercancel', e => {
      e.preventDefault();
      setButtonState(btn, false);
    });

    btn.addEventListener('pointerleave', () => {
      if (btn.classList.contains('active')) setButtonState(btn, false);
    });
  });

  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseAll();
  });

  setMobileControlLayout(mobileControlLayout);
  syncMobileControlsMode();
}

bindMobileControls();

// Control maps
const P1_CONTROLS = { left:'KeyA', right:'KeyD', jump:'KeyW', punch:'KeyF', kick:'KeyG', block:'KeyR', special:'KeyT' };
const P2_CONTROLS = { left:'ArrowLeft', right:'ArrowRight', jump:'ArrowUp', punch:'Comma', kick:'Period', block:'Slash', special:'Quote' };

// ── FIGHTERS ──
let p1, p2;

function createFighters() {
  p1 = new Fighter(FIGHTER_DEFS[selectedP1Key], 150, 1, P1_CONTROLS);
  p2 = new Fighter(FIGHTER_DEFS[selectedP2Key], W - 210, -1, P2_CONTROLS);
}

function renderCharacterSelect() {
  const grid = document.getElementById('select-grid');
  const summary = document.getElementById('select-summary');
  const turn = document.getElementById('select-turn');
  const lockBtn = document.getElementById('lock-btn');

  const p1Name = FIGHTER_DEFS[selectedP1Key]?.name || '-';
  const p2Name = FIGHTER_DEFS[selectedP2Key]?.name || '-';
  const mapName = MAP_DEFS[selectedMapKey]?.name || '-';
  const modeText = gameMode === 'cpu' ? `VS CPU (${cpuDifficulty.toUpperCase()})` : '2 PLAYER';

  document.getElementById('diff-easy').classList.toggle('active', cpuDifficulty === 'easy');
  document.getElementById('diff-medium').classList.toggle('active', cpuDifficulty === 'medium');
  document.getElementById('diff-hard').classList.toggle('active', cpuDifficulty === 'hard');
  document.getElementById('difficulty-row').style.display = gameMode === 'cpu' ? 'flex' : 'none';
  syncMobileControlsMode();

  if (selectPhase === 'fighters') {
    const isP2Turn = gameMode === 'pvp' && selectTurn === 2;
    turn.textContent = isP2Turn ? 'PLAYER 2 PICK YOUR FIGHTER' : 'PLAYER 1 PICK YOUR FIGHTER';
    lockBtn.textContent = gameMode === 'cpu' ? 'CONFIRM & LOCK' : (isP2Turn ? 'LOCK P2' : 'LOCK P1');

    grid.innerHTML = ROSTER.map(key => {
      const c = FIGHTER_DEFS[key];
      const p1Class = selectedP1Key === key ? 'selected-p1' : '';
      const p2Class = selectedP2Key === key ? 'selected-p2' : '';
      const activeClass = (isP2Turn ? selectedP2Key === key : selectedP1Key === key) ? 'active-turn' : '';
      const unavailable = isP2Turn && selectedP1Key === key;
      const unavailableClass = unavailable ? 'unavailable' : '';
      const clickAttr = unavailable ? '' : `onclick="pickCharacter('${key}')"`;
      const profile = getProfileImage(key);
      return `<div class="char-card ${p1Class} ${p2Class} ${activeClass} ${unavailableClass}" ${clickAttr}>
        <div class="char-portrait"><img src="${encodeURI(profile)}" alt="${c.name} profile"></div>
        <div class="char-name">${c.name}</div>
      </div>`;
    }).join('');
  } else if (selectPhase === 'map') {
    turn.textContent = 'PICK YOUR MAP';
    lockBtn.textContent = 'START FIGHT';

    grid.innerHTML = MAP_KEYS.map(key => {
      const m = MAP_DEFS[key];
      const selectedClass = selectedMapKey === key ? 'selected-map' : '';
      return `<div class="map-card ${selectedClass}" onclick="pickMap('${key}')">
        <div class="map-thumb" style="background-image:url('${encodeURI(m.preview)}')"></div>
        <div class="map-name">${m.name}</div>
      </div>`;
    }).join('');
  }

  summary.textContent = `MODE: ${modeText}  |  P1: ${p1Name}  |  P2: ${p2Name}  |  MAP: ${mapName}`;
}

function setGameMode(mode) {
  if (mode !== 'pvp' && mode !== 'cpu') return;
  gameMode = mode;
  syncMobileControlsMode();
  renderCharacterSelect();
}

function setDifficulty(level) {
  if (!AI_DIFFICULTY[level]) return;
  cpuDifficulty = level;
  renderCharacterSelect();
}

function updateCPUInput(cpu, target) {
  const cfg = AI_DIFFICULTY[cpuDifficulty] || AI_DIFFICULTY.medium;
  cpuKeys[cpu.controls.left] = false;
  cpuKeys[cpu.controls.right] = false;
  cpuKeys[cpu.controls.jump] = false;
  cpuKeys[cpu.controls.punch] = false;
  cpuKeys[cpu.controls.kick] = false;
  cpuKeys[cpu.controls.block] = false;
  cpuKeys[cpu.controls.special] = false;

  const dist = target.cx - cpu.cx;
  const absDist = Math.abs(dist);

  if (absDist > cfg.approachRange) {
    if (dist > 0) cpuKeys[cpu.controls.right] = true;
    else cpuKeys[cpu.controls.left] = true;
  } else if (absDist > cfg.attackRange) {
    if (dist > 0) cpuKeys[cpu.controls.right] = Math.random() < 0.75;
    else cpuKeys[cpu.controls.left] = Math.random() < 0.75;
  }

  if (target.isAttacking() && absDist < cfg.attackRange + 16 && Math.random() < cfg.blockChance) {
    cpuKeys[cpu.controls.block] = true;
  }

  if (cpu.onGround && Math.random() < cfg.jumpChance) {
    cpuKeys[cpu.controls.jump] = true;
  }

  if (absDist <= cfg.attackRange) {
    if (cpu.specialMeter >= 100 && Math.random() < cfg.specialChance) {
      cpuKeys[cpu.controls.special] = true;
    } else if (Math.random() < cfg.attackChance) {
      if (Math.random() < 0.5) cpuKeys[cpu.controls.punch] = true;
      else cpuKeys[cpu.controls.kick] = true;
    }
  }
}

function pickCharacter(key) {
  if (!FIGHTER_DEFS[key]) return;
  if (selectTurn === 1) {
    selectedP1Key = key;
    if (gameMode === 'cpu') {
      playSfx('choose', 0.9);
      autoPickCPUCharacter();
      selectPhase = 'map';
      renderCharacterSelect();
    } else {
      if (selectedP2Key === selectedP1Key) {
        const fallback = ROSTER.find(k => k !== selectedP1Key);
        if (fallback) selectedP2Key = fallback;
      }
      selectTurn = 2;
      renderCharacterSelect();
    }
  } else {
    if (key === selectedP1Key) return;
    selectedP2Key = key;
    renderCharacterSelect();
  }
}

function autoPickCPUCharacter() {
  const available = ROSTER.filter(k => k !== selectedP1Key);
  const pool = available.length ? available : ROSTER;
  const randomIdx = Math.floor(Math.random() * pool.length);
  selectedP2Key = pool[randomIdx];
}

function lockSelection() {
  if (selectPhase === 'fighters') {
    if (selectTurn === 2) {
      playSfx('choose', 0.9);
      selectPhase = 'map';
      renderCharacterSelect();
      return;
    }
  } else if (selectPhase === 'map') {
    playSfx('choose', 0.9);
    beginMatch();
  }
}

function pickMap(key) {
  if (!MAP_DEFS[key]) return;
  selectedMapKey = key;
  renderCharacterSelect();
}

function showPauseMenu() {
  const pm = document.getElementById('pause-menu');
  if (pm) pm.style.display = 'flex';
}

function hidePauseMenu() {
  const pm = document.getElementById('pause-menu');
  if (pm) pm.style.display = 'none';
}

function togglePause() {
  if (gameState === 'fighting') {
    gameState = 'paused';
    showPauseMenu();
    return;
  }
  if (gameState === 'paused') {
    gameState = 'fighting';
    hidePauseMenu();
  }
}

function resumeGame() {
  if (gameState !== 'paused') return;
  gameState = 'fighting';
  hidePauseMenu();
}

function restartMatchFromPause() {
  hidePauseMenu();
  beginMatch();
}

function backToSelectFromPause() {
  hidePauseMenu();
  openCharacterSelect();
}

function showModeSelect() {
  gameState = 'select';
  clearInterval(timerInterval);
  winFocusFighter = null;
  cameraZoom = 1;
  cameraFocusX = W / 2;
  cameraFocusY = H / 2;
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  hideOverlay();
  hidePauseMenu();
  document.getElementById('title-screen').style.display = 'none';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('game-canvas').style.display = 'none';
  document.getElementById('character-select').style.display = 'none';
  document.getElementById('mode-select').style.display = 'flex';
  selectTurn = 1;
  selectPhase = 'mode';
}

function startModeSelect(mode) {
  gameMode = mode;
  syncMobileControlsMode();
  selectPhase = 'fighters';
  selectTurn = 1;
  document.getElementById('mode-select').style.display = 'none';
  document.getElementById('character-select').style.display = 'flex';
  renderCharacterSelect();
}

function backToModeSelect() {
  document.getElementById('character-select').style.display = 'none';
  document.getElementById('mode-select').style.display = 'flex';
  selectPhase = 'mode';
  selectTurn = 1;
}

function openCharacterSelect() {
  showModeSelect();
}

function beginMatch() {
  hidePauseMenu();
  document.getElementById('character-select').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('game-canvas').style.display = 'block';

  p1Wins = 0;
  p2Wins = 0;
  roundNum = 1;
  particles = [];
  hitEffects = [];
  projectiles = [];

  createFighters();
  updateHUD();
  startCountdown();

  if (animFrame) cancelAnimationFrame(animFrame);
  gameLoop(0);
}

window.pickCharacter = pickCharacter;
window.lockSelection = lockSelection;
window.pickMap = pickMap;
window.setGameMode = setGameMode;
window.setDifficulty = setDifficulty;
window.setMobileControlLayout = setMobileControlLayout;
window.startModeSelect = startModeSelect;
window.backToModeSelect = backToModeSelect;
window.resumeGame = resumeGame;
window.restartMatchFromPause = restartMatchFromPause;
window.backToSelectFromPause = backToSelectFromPause;

// ── HUD ──
function updateHUD() {
  const p1Pct = (p1.hp / p1.maxHP * 100).toFixed(1);
  const p2Pct = (p2.hp / p2.maxHP * 100).toFixed(1);
  const p1StaPct = (p1.stamina / p1.maxStamina * 100).toFixed(1);
  const p2StaPct = (p2.stamina / p2.maxStamina * 100).toFixed(1);
  const p1SpPct = p1.specialMeter.toFixed(1);
  const p2SpPct = p2.specialMeter.toFixed(1);
  document.getElementById('p1-health').style.width = p1Pct + '%';
  document.getElementById('p2-health').style.width = p2Pct + '%';
  document.getElementById('p1-stamina').style.width = p1StaPct + '%';
  document.getElementById('p2-stamina').style.width = p2StaPct + '%';
  document.getElementById('p1-special').style.width = p1SpPct + '%';
  document.getElementById('p2-special').style.width = p2SpPct + '%';
  document.getElementById('p1-special').classList.toggle('ready', p1.specialMeter >= 100);
  document.getElementById('p2-special').classList.toggle('ready', p2.specialMeter >= 100);
  document.getElementById('p1-name').textContent = p1.name;
  document.getElementById('p2-name').textContent = p2.name;
  document.getElementById('p1-profile').src = encodeURI(getProfileImage(selectedP1Key));
  document.getElementById('p2-profile').src = encodeURI(getProfileImage(selectedP2Key));
  updateStars();
}

function updateStars() {
  const p1s = document.getElementById('p1-stars');
  const p2s = document.getElementById('p2-stars');

  const makeDots = wins => {
    return Array.from({ length: 2 }, (_, i) => {
      const filled = i < wins ? 'filled' : '';
      return `<span class="round-dot ${filled}"></span>`;
    }).join('');
  };

  p1s.innerHTML = makeDots(p1Wins);
  p2s.innerHTML = makeDots(p2Wins);
}

// ── OVERLAY ──
function showOverlay(text, sub, color) {
  const ov = document.getElementById('overlay');
  const ot = document.getElementById('overlay-text');
  const os = document.getElementById('overlay-sub');
  ov.style.display = 'block';
  ot.textContent = text;
  ot.style.color = color || '#ffd700';
  os.textContent = sub || '';
  os.style.display = sub ? 'block' : 'none';
}

function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// ── ROUND TIMER ──
function startRoundTimer() {
  roundTimer = 99;
  document.getElementById('timer').textContent = roundTimer;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (gameState !== 'fighting') return;
    roundTimer--;
    document.getElementById('timer').textContent = roundTimer;
    if (roundTimer <= 0) {
      triggerRoundFinishSlowmo('timeout');
    }
  }, 1000);
}

// ── ROUND/GAME LOGIC ──
function endRound(reason) {
  if (gameState === 'roundOver' || gameState === 'gameOver') return;
  gameState = 'roundOver';
  clearInterval(timerInterval);

  let winner = null;
  if (reason === 'timeout') {
    winner = p1.hp >= p2.hp ? 'p1' : 'p2';
  } else {
    winner = p1.hp <= 0 ? 'p2' : 'p1';
  }

  if (winner === 'p1') p1Wins++;
  else p2Wins++;

  if (reason === 'ko') {
    const loser = winner === 'p1' ? p2 : p1;
    const winnerFighter = winner === 'p1' ? p1 : p2;
    loser.state = 'ko';
    loser.stateTimer = 9999;
    loser.vx = 0;
    loser.vy = 0;
    loser.onGround = true;
    winnerFighter.state = 'taunt';
    winnerFighter.stateTimer = 9999;
    winnerFighter.vx = 0;
    winFocusFighter = winnerFighter;
  } else {
    winFocusFighter = winner === 'p1' ? p1 : p2;
  }

  updateStars();

  const isFinalRound = p1Wins >= 2 || p2Wins >= 2;

  const winCol = winner === 'p1' ? '#00e5ff' : '#ff4444';
  if (gameMode === 'cpu') {
    if (winner === 'p1') {
      showOverlay(reason === 'timeout' ? 'YOU WIN (TIME)' : 'YOU WIN', '', '#00e5ff');
      if (!isFinalRound) queueOutcomeSfx('win');
    } else {
      showOverlay(reason === 'timeout' ? 'YOU LOSE (TIME)' : 'YOU LOSE', '', '#ff4444');
      if (!isFinalRound) queueOutcomeSfx('lose');
    }
  } else {
    const winnerName = winner === 'p1' ? p1.name : p2.name;
    const tag = reason === 'timeout' ? ' (TIME!)' : ' WINS!';
    showOverlay(winnerName + tag, '', winCol);
  }

  if (p1Wins >= 2 || p2Wins >= 2) {
    endGame(winner, reason);
    return;
  }

  setTimeout(() => {
    hideOverlay();
    nextRound();
  }, INTER_ROUND_DELAY_MS);
}

function endGame(winner, reason = 'ko') {
  gameState = 'gameOver';
  winFocusFighter = winner === 'p1' ? p1 : p2;
  // Snap camera partway to winner so final zoom starts instantly.
  cameraZoom = 1.35;
  cameraFocusX = winFocusFighter ? winFocusFighter.cx : W / 2;
  cameraFocusY = winFocusFighter ? (winFocusFighter.cy - 44) : H / 2;
  if (reason === 'ko') {
    playSfx('ko', 1);
  }

  if (gameMode === 'cpu') {
    if (winner === 'p1') {
      showOverlay('YOU WIN', 'PRESS START TO REPLAY', '#00e5ff');
      queueOutcomeSfx('win', reason === 'ko' ? 1200 : 0);
    } else {
      showOverlay('GAME OVER', 'YOU LOSE - PRESS START', '#ff4444');
      queueOutcomeSfx('lose', reason === 'ko' ? 1200 : 0);
    }
  } else {
    const winnerName = winner === 'p1' ? p1.name : p2.name;
    const winCol = winner === 'p1' ? '#00e5ff' : '#ff4444';
    showOverlay('🏆 ' + winnerName, 'PRESS START TO REPLAY', winCol);
  }
  document.getElementById('overlay-sub').style.display = 'block';
  document.getElementById('overlay').addEventListener('click', () => openCharacterSelect(), { once: true });
  document.addEventListener('keydown', function restartHandler(e) {
    if (e.code === 'Enter' || e.code === 'Space') {
      document.removeEventListener('keydown', restartHandler);
      openCharacterSelect();
    }
  });
}

function nextRound() {
  roundNum++;
  particles = [];
  hitEffects = [];
  projectiles = [];
  winFocusFighter = null;
  pendingRoundEndReason = null;
  finishSlowmoFrames = 0;
  finishSlowmoTick = 0;
  cameraZoom = 1;
  cameraFocusX = W / 2;
  cameraFocusY = H / 2;
  createFighters();
  updateHUD();
  startCountdown();
}

function updateWinCamera() {
  // Zoom only on final match winner (game over), not each round winner.
  const shouldFocus = gameState === 'gameOver' && winFocusFighter;
  const targetZoom = shouldFocus ? 2.05 : 1;
  const targetX = shouldFocus ? winFocusFighter.cx : W / 2;
  const targetY = shouldFocus ? (winFocusFighter.cy - 44) : H / 2;
  if (shouldFocus) {
    cameraZoom = targetZoom;
    cameraFocusX = targetX;
    cameraFocusY = targetY;
    return;
  }
  cameraZoom += (targetZoom - cameraZoom) * 0.16;
  cameraFocusX += (targetX - cameraFocusX) * 0.16;
  cameraFocusY += (targetY - cameraFocusY) * 0.16;
}

function startCountdown() {
  gameState = 'countdown';
  countdownVal = 3;
  const roundLabel = Math.min(roundNum, 4);
  showOverlay('ROUND ' + roundLabel, '', '#ffd700');
  playRoundSfx(roundNum);

  // Street Fighter style text transition: ROUND X -> FIGHT!
  setTimeout(() => {
    showOverlay('FIGHT!', '', '#00ff88');
  }, 2250);

  setTimeout(() => {
    hideOverlay();
    gameState = 'fighting';
    startRoundTimer();
  }, ROUND_ANNOUNCE_TOTAL_MS);
}

// ── GAME START ──
function startGame() {
  stopIntroBgm();
  playSfx('coin', 1);
  openCharacterSelect();
}

window.startGame = startGame;

['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, tryStartIntroBgm, { passive: true });
});
tryStartIntroBgm();

// ── MAIN GAME LOOP ──
function gameLoop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  
  if (specialFreezeFrames > 0) {
    specialFreezeFrames--;
    if (animFrame) animFrame = requestAnimationFrame(gameLoop);
    return;
  }
  
  if (screenShake > 0) screenShake--;

  updateWinCamera();

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  
  if (screenShake > 0) {
    const shake = (screenShake / 14) * 8;
    ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
  }
  
  if (cameraZoom > 1.001) {
    const clampedX = Math.max(W * 0.22, Math.min(W * 0.78, cameraFocusX));
    const clampedY = Math.max(H * 0.35, Math.min(H * 0.72, cameraFocusY));
    ctx.translate(W / 2, H / 2);
    ctx.scale(cameraZoom, cameraZoom);
    ctx.translate(-clampedX, -clampedY);
  }
  drawBackground();

  // Update
  if (gameState === 'fighting') {
    p1.update(keys, p2);
    if (gameMode === 'cpu') {
      updateCPUInput(p2, p1);
      p2.update(cpuKeys, p1);
    } else {
      p2.update(keys, p1);
    }
    checkHits(p1, p2);
    checkHits(p2, p1);
    updateProjectiles();

    if (p1.hp <= 0 || p2.hp <= 0) triggerRoundFinishSlowmo('ko');
  }

  if (gameState === 'finishSlowmo') {
    finishSlowmoTick++;
    if (finishSlowmoTick % ROUND_FINISH_SLOWMO_SKIP === 0 && p1 && p2) {
      p1.updateAnimation();
      p2.updateAnimation();
    }
    finishSlowmoFrames--;
    if (finishSlowmoFrames <= 0) {
      const reason = pendingRoundEndReason || 'ko';
      pendingRoundEndReason = null;
      endRound(reason);
    }
  }

  // Keep fighters alive visually during countdown with idle loop animation.
  if (gameState === 'countdown' && p1 && p2) {
    if (p1.state !== 'ko' && p1.state !== 'hurt') p1.state = 'idle';
    if (p2.state !== 'ko' && p2.state !== 'hurt') p2.state = 'idle';
    p1.updateAnimation();
    p2.updateAnimation();
  }

  // Keep one-shot animations (like KO/death) advancing during round-over freeze.
  if (gameState === 'roundOver' && p1 && p2) {
    p1.updateAnimation();
    p2.updateAnimation();
  }
  if (gameState === 'gameOver' && p1 && p2) {
    p1.updateAnimation();
    p2.updateAnimation();
  }

  // Particles
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.3;
    p.life--;
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.shadowBlur = 0;
  });
  ctx.globalAlpha = 1;

  // Hit effects
  hitEffects = hitEffects.filter(h => h.life > 0);
  hitEffects.forEach(h => {
    const alpha = h.life / 12;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(h.text, h.x, h.y - (12 - h.life) * 2);
    h.life--;
  });
  ctx.globalAlpha = 1;

  // Draw fighters
  if (p1 && p2) {
    p1.draw(ctx);
    p2.draw(ctx);
    drawProjectiles();
  }

  // Shadow under fighters
  [p1, p2].forEach(f => {
    if (!f) return;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(f.cx, FLOOR_Y + 2, f.width / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.restore();

  updateHUD();

  animFrame = requestAnimationFrame(gameLoop);
}
