// SPORE GENESIS — a handcrafted evolution survival game.
// Main simulation, rendering and UI controller.
import { World, CHUNK } from './world.js';
import {
  BIOMES, STAGES, GENES, CATEGORIES, MODULES, DEN_COST, MATERIALS,
  SPECIES, NAMES, QUESTS, ACHIEVEMENTS, deriveStats, DAY_LENGTH,
  WORLD_SIZE
} from './data.js';
import {
  drawCreature, drawCreaturePreview, makePlayerPheno, makeSpeciesPheno
} from './creature.js';
import {
  clamp, lerp, dist, angleDiff, approachAngle, TAU, rgba, hsl, mix,
  fmtClock, pickWeighted, roman, pointInArc, smoothstep
} from './util.js';

const SAVE_KEY = 'spore-genesis-save-v1';
const SAVE_VERSION = 1;
const CELL = 64;
const MAPRES = 100;

const ABILITY_INFO = {
  roar: { name: 'Terrifying Roar', icon: '📣', cd: 26 },
  pulse: { name: 'Static Pulse', icon: '⚡', cd: 17 },
  cloud: { name: 'Toxic Cloud', icon: '☠', cd: 20 },
  dash: { name: 'Wing Dash', icon: '⌁', cd: 11 },
  burrow: { name: 'Burrow', icon: '⌄', cd: 22 }
};

const WEATHER_INFO = {
  clear: { icon: '☀', name: 'Clear' },
  rain: { icon: '🌧', name: 'Rain' },
  fog: { icon: '🌫', name: 'Fog' },
  storm: { icon: '⛈', name: 'Storm' }
};

const LORE = [
  'The monolith hums a name that is not yours. You understand it anyway.',
  'Old claw marks spiral up the stone. Something enormous once leaned here.',
  'A memory of rain, of eggs, of a hundred small heartbeats. The stone remembers.',
  'The runes rearrange themselves into a single word: CONTINUE.',
  'Beneath your feet the world is still dreaming. You are part of the dream now.'
];

const $ = (id) => document.getElementById(id);

class Sound {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.wind = null;
    this.lastChirp = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.55 : 0;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 2);
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.97 + white * 0.03;
        data[i] = last * 2.4;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 460;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.12;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start();
      this.wind = gain;
    } catch { /* audio is optional */ }
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.init();
    if (this.master) this.master.gain.value = this.enabled ? 0.55 : 0;
    return this.enabled;
  }
  tone(freq, dur = 0.12, type = 'sine', vol = 0.14, slide = 0, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }
  noise(dur = 0.2, vol = 0.12, cutoff = 900, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
  }
  ui() { this.tone(620, 0.04, 'sine', 0.05); }
  eat() { this.tone(280, 0.08, 'triangle', 0.1, 110); this.tone(420, 0.06, 'sine', 0.05, 50, 0.05); }
  attack() { this.noise(0.12, 0.08, 1500); this.tone(180, 0.08, 'sawtooth', 0.05, -60); }
  hit() { this.noise(0.1, 0.12, 380); this.tone(90, 0.12, 'sine', 0.12, -30); }
  hurt() { this.tone(110, 0.2, 'sawtooth', 0.1, -60); this.noise(0.18, 0.1, 300); }
  gather() { this.noise(0.1, 0.06, 800); this.tone(240, 0.08, 'triangle', 0.07, 70); }
  splash() { this.noise(0.16, 0.06, 1100); }
  levelup() {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.11, 0, i * 0.085));
  }
  evolve() {
    [330, 440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.09, 0, i * 0.07));
    this.noise(0.7, 0.06, 2200);
  }
  error() { this.tone(150, 0.12, 'square', 0.06, -40); }
  heart() { this.tone(660, 0.1, 'sine', 0.08, 80); this.tone(880, 0.12, 'sine', 0.06, 40, 0.08); }
  thunder() { this.noise(0.9, 0.16, 160); this.tone(55, 1.2, 'sine', 0.1, -20); }
  chirp() {
    const f = 1200 + Math.random() * 900;
    this.tone(f, 0.06, 'sine', 0.025, 260);
    this.tone(f + 180, 0.05, 'sine', 0.02, -120, 0.08);
  }
}

export class Game {
  constructor() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d');
    this.sound = new Sound();
    this.started = false;
    this.paused = false;
    this.dead = false;
    this.hasSave = false;
    this.panel = null;
    this.introShown = false;
    this.keys = new Set();
    this.joystick = { x: 0, y: 0, active: false };
    this.touchSprint = false;
    this.mouse = { x: 0, y: 0 };
    this.particles = [];
    this.floaters = [];
    this.corpses = [];
    this.npcs = [];
    this.companions = [];
    this.clouds = [];
    this.slashes = [];
    this.rain = [];
    this.landmarks = [];
    this.heirs = [];
    this.mate = null;
    this.den = null;
    this.alpha = null;
    this.materials = { wood: 0, stone: 0, fiber: 0, crystal: 0 };
    this.stats = this.emptyStats();
    this.flags = {};
    this.questIndex = 0;
    this.lineage = 0;
    this.generation = 1;
    this.discovered = { biomes: new Set(), species: new Set() };
    this.explored = new Set();
    this.achievements = new Set();
    this.weather = { type: 'clear', intensity: 0, target: 0, timer: 90, flash: 0, lightning: 7 };
    this.time = 0;
    this.tod = 0.28;
    this.day = 1;
    this.seed = 1;
    this.camera = { x: 0, y: 0, zoom: 1, shake: 0 };
    this.timers = { explore: 0, quest: 0, ach: 0, spawn: 1, hud: 0, minimap: 0, save: 0, prompt: 0, avatar: 0, ambient: 4 };
    this.hurtFlash = 0;
    this.lightning = 0;
    this.deathCause = '';
    this.deathPos = null;
    this.interaction = null;
    this.interactionKey = '';
    this.lastBiome = '';
    this.courtCd = 0;
    this.denShrineTimer = 0;
    this.awayTimer = 0;
    this.mapTmp = null;
    this.mapTmpCtx = null;
    this.mapBaseData = null;
    this.vignette = null;
    this.zoomTarget = 1;
    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.lastFrame = performance.now() / 1000;
    this.now = 0;
    this.looping = false;
  }

  emptyStats() {
    return {
      eats: 0, drinks: 0, mutations: 0, kills: 0, gathered: 0,
      breeds: 0, deaths: 0, nights: 0, distance: 0
    };
  }

  boot() {
    this.resize();
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.started && !this.dead) this.saveGame();
    });
    $('hud').classList.add('hidden');
    $('death').classList.add('hidden');
    let loaded = false;
    try { loaded = this.loadGame(); } catch { loaded = false; }
    if (!loaded) this.newGame(false);
    this.updateTitleFoot();
  }

  newGame(autoStart = false, forcedSeed = null) {
    this.seed = forcedSeed != null ? forcedSeed : ((Math.random() * 1e9) | 0);
    this.world = new World(this.seed);
    this.mapBaseData = null;
    this.mapTmp = null;
    this.mapTmpCtx = null;
    this.started = false;
    this.paused = false;
    this.dead = false;
    this.panel = null;
    this.keys.clear();
    this.joystick = { x: 0, y: 0, active: false };
    this.touchSprint = false;
    this.particles = [];
    this.floaters = [];
    this.corpses = [];
    this.npcs = [];
    this.companions = [];
    this.clouds = [];
    this.slashes = [];
    this.rain = [];
    this.landmarks = [];
    this.heirs = [];
    this.mate = null;
    this.den = null;
    this.alpha = null;
    this.materials = { wood: 0, stone: 0, fiber: 0, crystal: 0 };
    this.stats = this.emptyStats();
    this.flags = {};
    this.questIndex = 0;
    this.lineage = 0;
    this.generation = 1;
    this.discovered = { biomes: new Set(), species: new Set() };
    this.explored = new Set();
    this.achievements = new Set();
    this.weather = { type: 'clear', intensity: 0, target: 0, timer: 100, flash: 0, lightning: 8 };
    this.time = 0;
    this.tod = 0.27;
    this.day = 1;
    this.lastBiome = '';
    this.courtCd = 0;
    this.denShrineTimer = 0;
    this.deathCause = '';
    this.deathPos = null;
    this.hurtFlash = 0;
    this.lightning = 0;
    this.hasSave = false;
    this.introShown = false;
    const spawn = this.world.findSpawn();
    this.spawnPoint = { x: spawn.x, y: spawn.y };
    const hue = 90 + Math.floor(Math.random() * 160);
    this.player = {
      name: this.pickName(),
      hue,
      genes: {},
      dna: 20,
      xp: 0,
      stage: 1,
      x: spawn.x,
      y: spawn.y,
      angle: -0.5,
      hp: 100,
      stamina: 100,
      food: 78,
      water: 82,
      anim: 0,
      moving: false,
      sprinting: false,
      flash: 0,
      invuln: 0,
      attackCd: 0,
      abilityCd: 0,
      abilityMax: 26,
      burrowT: 0,
      reviveUsed: false,
      stepT: 0,
      drinkCd: 0,
      poison: 0,
      dead: false
    };
    this.recalcPlayer(true);
    this.player.hp = this.pstats.maxHp;
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.timers.explore = 0;
    this.markExplored(this.player.x, this.player.y, this.pstats.vision * 0.8);
    this.discoverBiome(this.world.biomeAt(this.player.x, this.player.y), true);
    this.spawnInitialNPCs();
    if (autoStart) {
      this.started = true;
      this.saveGame();
      this.hasSave = true;
      this.enterWorld();
    }
    this.updateTitleFoot();
  }

  pickName() {
    return NAMES[(Math.random() * NAMES.length) | 0];
  }

  serialize() {
    const taken = [];
    for (const [id, until] of this.world.taken) {
      if (taken.length > 3000) break;
      taken.push([id, until === Infinity ? 0 : Math.round(until * 10) / 10]);
    }
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      time: this.time,
      tod: this.tod,
      day: this.day,
      weather: this.weather,
      player: {
        name: this.player.name, hue: this.player.hue, genes: this.player.genes,
        dna: this.player.dna, xp: this.player.xp, stage: this.player.stage,
        x: this.player.x, y: this.player.y, angle: this.player.angle,
        hp: this.player.hp, stamina: this.player.stamina, food: this.player.food,
        water: this.player.water, reviveUsed: this.player.reviveUsed
      },
      spawnPoint: this.spawnPoint,
      lineage: this.lineage,
      generation: this.generation,
      heirs: this.heirs,
      den: this.den,
      materials: this.materials,
      mate: this.mate ? {
        name: this.mate.name, hue: this.mate.hue, genes: this.mate.genes,
        stage: this.mate.stage, affinity: this.mate.affinity, x: this.mate.x, y: this.mate.y
      } : null,
      companions: this.companions.map((c) => ({
        name: c.name, hue: c.hue, genes: c.genes, stage: c.stage,
        x: c.x, y: c.y, hp: c.hp
      })),
      questIndex: this.questIndex,
      stats: this.stats,
      flags: this.flags,
      explored: Array.from(this.explored),
      discovered: {
        biomes: Array.from(this.discovered.biomes),
        species: Array.from(this.discovered.species)
      },
      achievements: Array.from(this.achievements),
      landmarks: this.landmarks,
      taken
    };
  }

  saveGame(manual = false) {
    if (!this.started || this.dead || !this.player) return false;
    try {
      const data = this.serialize();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.hasSave = true;
      if (manual) this.toast('Lineage saved.', 'gold');
      return true;
    } catch {
      if (manual) this.toast('Could not save in this browser.', 'red');
      return false;
    }
  }

  loadGame() {
    let raw;
    try { raw = localStorage.getItem(SAVE_KEY); } catch { return false; }
    if (!raw) return false;
    let data;
    try { data = JSON.parse(raw); } catch { return false; }
    if (!data || data.version !== SAVE_VERSION || !data.player) return false;
    try {
      this.seed = data.seed >>> 0;
      this.world = new World(this.seed);
      this.mapBaseData = null;
      this.mapTmp = null;
      this.mapTmpCtx = null;
      this.stats = { ...this.emptyStats(), ...(data.stats || {}) };
      this.flags = data.flags || {};
      this.questIndex = clamp(data.questIndex || 0, 0, QUESTS.length);
      this.lineage = data.lineage || 0;
      this.generation = data.generation || 1;
      this.heirs = data.heirs || [];
      this.materials = { wood: 0, stone: 0, fiber: 0, crystal: 0, ...(data.materials || {}) };
      this.den = data.den || null;
      this.landmarks = data.landmarks || [];
      this.explored = new Set(Array.isArray(data.explored) ? data.explored : []);
      this.discovered = {
        biomes: new Set((data.discovered && data.discovered.biomes) || []),
        species: new Set((data.discovered && data.discovered.species) || [])
      };
      this.achievements = new Set(data.achievements || []);
      this.time = data.time || 0;
      this.tod = data.tod != null ? data.tod : 0.28;
      this.day = data.day || 1;
      this.weather = { ...this.weather, ...(data.weather || {}) };
      this.spawnPoint = data.spawnPoint || { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
      const p = data.player;
      this.player = {
        name: p.name || this.pickName(),
        hue: p.hue != null ? p.hue : 120,
        genes: p.genes || {},
        dna: p.dna || 0,
        xp: p.xp || 0,
        stage: clamp(p.stage || 1, 1, 5),
        x: p.x, y: p.y,
        angle: p.angle != null ? p.angle : -0.5,
        hp: p.hp, stamina: p.stamina != null ? p.stamina : 100,
        food: p.food != null ? p.food : 70,
        water: p.water != null ? p.water : 70,
        anim: 0, moving: false, sprinting: false, flash: 0, invuln: 2,
        attackCd: 0, abilityCd: 0, abilityMax: 26, burrowT: 0,
        reviveUsed: !!p.reviveUsed, stepT: 0, drinkCd: 0, poison: 0, dead: false
      };
      this.recalcPlayer(true);
      this.player.hp = clamp(p.hp != null ? p.hp : this.pstats.maxHp, 1, this.pstats.maxHp);
      if (this.den) {
        this.den.modules = this.den.modules || {};
        this.world.clearArea(this.den.x, this.den.y, 135);
      }
      this.mate = null;
      if (data.mate) {
        const m = data.mate;
        const stage = clamp(m.stage || 2, 1, 5);
        this.mate = {
          name: m.name || 'Kindred',
          hue: m.hue != null ? m.hue : 220,
          genes: m.genes || {},
          stage,
          affinity: clamp(m.affinity || 0, 0, 100),
          x: m.x != null ? m.x : (this.den ? this.den.x + 45 : this.player.x + 40),
          y: m.y != null ? m.y : (this.den ? this.den.y + 25 : this.player.y + 20),
          angle: 0, phase: Math.random() * 9, wanderT: 0, wx: 0, wy: 0
        };
        this.mate.pheno = makePlayerPheno(this.mate.genes, stage, this.mate.hue, 4);
        this.mate.r = Math.max(10, this.mate.pheno.len * 0.32);
        this.mate.size = this.mate.pheno.scale;
        this.mate.moving = false;
      }
      this.companions = (data.companions || []).map((c) => {
        const stage = clamp(c.stage || 1, 1, 5);
        const cstats = deriveStats(c.genes || {}, stage, this.lineage);
        return {
          name: c.name || this.pickName(), hue: c.hue != null ? c.hue : 140,
          genes: c.genes || {}, stage,
          pheno: makePlayerPheno(c.genes || {}, stage, c.hue != null ? c.hue : 140, 6),
          stats: cstats, hp: clamp(c.hp || cstats.maxHp, 0, cstats.maxHp),
          maxHp: cstats.maxHp, x: c.x || this.player.x, y: c.y || this.player.y,
          r: Math.max(10, makePlayerPheno(c.genes || {}, stage, c.hue != null ? c.hue : 140, 6).len * 0.32),
          size: STAGES[stage - 1].scale,
          angle: 0, attackCd: 0, flash: 0, phase: Math.random() * 9,
          dead: false, respawnT: 0, stepT: 0, moving: false
        };
      });
      this.npcs = [];
      this.alpha = null;
      this.corpses = [];
      this.clouds = [];
      this.particles = [];
      this.floaters = [];
      this.slashes = [];
      this.rain = [];
      this.joystick = { x: 0, y: 0, active: false };
      this.touchSprint = false;
      this.keys.clear();
      this.world.taken = new Map();
      for (const entry of (data.taken || [])) {
        if (!Array.isArray(entry)) continue;
        this.world.taken.set(entry[0], entry[1] === 0 ? Infinity : entry[1]);
      }
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
      this.dead = false;
      this.paused = false;
      this.panel = null;
      this.started = false;
      this.hasSave = true;
      this.introShown = false;
      this.hurtFlash = 0;
      this.lightning = 0;
      this.lastBiome = '';
      this.courtCd = 0;
      this.denShrineTimer = 0;
      this.timers.explore = 0;
      this.timers.spawn = 1;
      this.markExplored(this.player.x, this.player.y, this.pstats.vision * 0.8);
      this.spawnInitialNPCs();
      this.updateTitleFoot();
      return true;
    } catch (err) {
      console.error('Save load failed:', err);
      try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
      return false;
    }
  }

  recalcPlayer(keepRatio = false) {
    const oldMax = this.player.maxHp || this.pstats?.maxHp || 100;
    const ratio = this.player.hp != null ? clamp(this.player.hp / oldMax, 0, 1) : 1;
    this.pstats = deriveStats(this.player.genes, this.player.stage, this.lineage);
    this.player.maxHp = this.pstats.maxHp;
    this.player.size = this.pstats.size;
    this.player.pheno = makePlayerPheno(this.player.genes, this.player.stage, this.player.hue, this.seed % 97);
    if (keepRatio) this.player.hp = clamp(ratio * this.player.maxHp, 1, this.player.maxHp);
    else this.player.hp = clamp(this.player.hp, 0, this.player.maxHp);
    const ab = ABILITY_INFO[this.pstats.ability] || ABILITY_INFO.roar;
    this.player.abilityMax = ab.cd;
  }

  updateTitleFoot() {
    const foot = $('title-foot');
    if (!foot) return;
    if (this.hasSave && this.player) {
      foot.textContent = `Your lineage awaits: ${this.player.name} · Generation ${this.generation} · ${STAGES[this.player.stage - 1].name}`;
    } else {
      foot.textContent = 'WASD move · Shift sprint · Space bite · E interact · M evolve · B build';
    }
    const btn = $('btn-start');
    if (btn) btn.textContent = 'Start';
  }

  startGame() {
    if (this.started) return;
    this.sound.init();
    this.started = true;
    this.paused = false;
    this.dead = false;
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('death').classList.add('hidden');
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;
    this.camera.shake = 0;
    this.timers.prompt = 0;
    this.resize();
    this.enterWorld();
    this.render(performance.now() / 1000);
    this.startLoop();
  }

  startLoop() {
    if (this.looping) return;
    this.looping = true;
    this.lastFrame = performance.now() / 1000;
    requestAnimationFrame((t) => this.loop(t));
  }

  enterWorld() {
    if (!this.introShown) {
      this.introShown = true;
      const mobile = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;
      setTimeout(() => this.toast('You wake beneath a wide sky. Eat, drink, and do not die.', 'gold', 4200), 250);
      setTimeout(() => this.toast(mobile ? 'Joystick to move · Bite to hunt · E to interact' : 'WASD move · Shift sprint · Space bite · E interact · M evolve', '', 5200), 1300);
    }
    this.updateHUD();
  }

  /* ============================ MAIN LOOP ============================ */

  loop(ts) {
    const now = ts / 1000;
    let dt = now - this.lastFrame;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(0.05, dt);
    this.lastFrame = now;
    this.now = now;
    if (!this.dead && !this.paused && !this.panel) {
      if (!this.started) this.updateIdle(dt);
      else this.update(dt);
    }
    this.render(now);
    if (this.started) this.updateHUD();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const w = Math.max(320, window.innerWidth);
    const h = Math.max(320, window.innerHeight);
    const fullDpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = this.started ? fullDpr : Math.min(0.5, fullDpr);
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.zoomTarget = w < 700 ? 0.8 : clamp(Math.min(w, h) / 900, 0.86, 1.1);
    this.camera.zoom = this.zoomTarget;
    this.vignette = null;
    this.rain = [];
  }

  updateIdle(dt) {
    this.time += dt;
    this.tod += (dt / DAY_LENGTH) * 0.45;
    if (this.tod >= 1) { this.tod -= 1; this.day++; }
    this.updateWeather(dt);
    this.updateNPCs(dt);
    this.updateMate(dt);
    this.updateCompanions(dt);
    this.updateCorpses(dt);
    this.updateParticles(dt);
    this.updateClouds(dt);
    this.updateSlashes(dt);
    this.updateCamera(dt, true);
  }

  update(dt) {
    this.time += dt;
    this.updateTime(dt);
    this.updateWeather(dt);
    this.updatePlayer(dt);
    if (this.dead) return;
    this.updateNPCs(dt);
    this.npcs = this.npcs.filter((n) => !n.dead);
    this.updateCompanions(dt);
    this.updateMate(dt);
    this.updateDen(dt);
    this.updateCorpses(dt);
    this.updateParticles(dt);
    this.updateClouds(dt);
    this.updateSlashes(dt);
    this.spawner(dt);
    this.updateExploration(dt);
    this.courtCd = Math.max(0, this.courtCd - dt);

    this.timers.quest -= dt;
    if (this.timers.quest <= 0) { this.timers.quest = 0.35; this.checkQuests(); }
    this.timers.ach -= dt;
    if (this.timers.ach <= 0) { this.timers.ach = 0.7; this.checkAchievements(); }
    this.timers.save -= dt;
    if (this.timers.save <= 0) { this.timers.save = 12; this.saveGame(); }

    this.timers.ambient -= dt;
    if (this.timers.ambient <= 0) {
      this.timers.ambient = 5 + Math.random() * 9;
      if (!this.isNight() && this.sound.enabled) this.sound.chirp();
    }
    this.updateCamera(dt, false);
    if (this.player.hp <= 0) this.die(this.deathCause || 'Your body gave out.');
  }

  updateTime(dt) {
    this.tod += dt / DAY_LENGTH;
    if (this.tod >= 1) {
      this.tod -= 1;
      this.day++;
      this.stats.nights++;
      this.gainXp(28);
      this.toast(`Dawn breaks — Day ${this.day}. You survived the night.`, 'gold', 4200);
      this.sound.levelup();
      this.saveGame();
    }
  }

  isNight() {
    return this.nightAmount() > 0.45;
  }

  nightAmount() {
    const t = this.tod % 1;
    if (t < 0.18) return 1 - smoothstep(t / 0.18);
    if (t < 0.68) return 0;
    if (t < 0.78) return smoothstep((t - 0.68) / 0.1);
    return 1;
  }

  updateWeather(dt) {
    const w = this.weather;
    w.timer -= dt;
    if (w.timer <= 0) {
      const options = [['clear', 44], ['rain', 24], ['fog', 18], ['storm', 14]];
      const type = pickWeighted({ next: Math.random }, options);
      w.timer = 65 + Math.random() * 95;
      if (type !== w.type) {
        w.type = type;
        if (type === 'storm') this.toast('Storm clouds gather. The world grows loud.', '', 3400);
        else if (type === 'fog') this.toast('A pale fog rolls through the low ground.', '', 3000);
      }
    }
    w.target = w.type === 'clear' ? 0 : 1;
    w.intensity += (w.target - w.intensity) * Math.min(1, dt * 0.55);
    if (w.intensity < 0.01) w.intensity = 0;

    // screen-space rain
    const target = Math.round(w.intensity * (w.type === 'storm' ? 240 : 150));
    const w2 = this.viewW || 1200;
    const h2 = this.viewH || 800;
    while (this.rain.length < target) {
      this.rain.push({
        x: Math.random() * (w2 + 200) - 100,
        y: Math.random() * h2,
        len: 8 + Math.random() * 18,
        speed: 520 + Math.random() * 480,
        drift: (w.type === 'storm' ? 150 : 60) * (0.5 + Math.random() * 0.6)
      });
    }
    if (this.rain.length > target) this.rain.length = target;
    for (const drop of this.rain) {
      drop.y += drop.speed * dt;
      drop.x += drop.drift * dt;
      if (drop.y > h2 + 30) {
        drop.y = -30 - Math.random() * 80;
        drop.x = Math.random() * (w2 + 200) - 100;
      }
    }

    // lightning and wet ground
    w.lightning -= dt;
    if (w.type === 'storm' && w.intensity > 0.4 && w.lightning <= 0) {
      w.lightning = 5 + Math.random() * 11;
      this.lightning = 0.85;
      this.camera.shake = Math.max(this.camera.shake, 7);
      this.sound.thunder();
    }
    this.lightning = Math.max(0, this.lightning - dt * 2.4);

    if (w.intensity > 0.15 && this.player) {
      this.rainSplash = (this.rainSplash || 0) - dt;
      if (this.rainSplash <= 0) {
        this.rainSplash = 0.11;
        for (let i = 0; i < 2; i++) {
          const x = this.player.x + (Math.random() - 0.5) * 600;
          const y = this.player.y + (Math.random() - 0.5) * 420;
          if (!this.world.isWater(x, y)) {
            this.particle(x, y, { type: 'ring', size: 2, life: 0.35, color: '#b7d7e2', grow: 9, alpha: 0.25 });
          }
        }
      }
    }

    if (this.isNight() && this.started) {
      this.fireflyT = (this.fireflyT || 0) - dt;
      if (this.fireflyT <= 0) {
        this.fireflyT = 0.35;
        const a = Math.random() * TAU;
        const r = 80 + Math.random() * 380;
        this.particle(this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r, {
          type: 'firefly', size: 1.6 + Math.random() * 1.6, life: 4 + Math.random() * 4,
          color: Math.random() < 0.3 ? '#a7c8ff' : '#c8ff9a', vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6
        });
      }
    }
  }

  isSprinting() {
    return this.touchSprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  updatePlayer(dt) {
    const p = this.player;
    const stats = this.pstats;
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.abilityCd = Math.max(0, p.abilityCd - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.drinkCd = Math.max(0, p.drinkCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 22);

    if (p.burrowT > 0) {
      p.burrowT -= dt;
      if (p.burrowT <= 0) {
        p.burrowT = 0;
        this.particlesBurst(p.x, p.y, 14, '#8a6d4a', { speed: 70, life: 0.6, size: 3 });
        this.sound.gather();
      }
    }

    let ix = 0;
    let iy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy += 1;
    if (this.joystick.active) { ix += this.joystick.x; iy += this.joystick.y; }
    let mag = Math.hypot(ix, iy);
    if (!this.panel && mag > 0.08) {
      ix /= mag; iy /= mag; mag = 1;
    } else if (this.panel) {
      ix = 0; iy = 0; mag = 0;
    }
    p.moving = mag > 0.08;
    if (p.moving) p.angle = approachAngle(p.angle, Math.atan2(iy, ix), Math.min(1, dt * 13));

    const wet = this.world.isWater(p.x, p.y);
    const deep = this.world.isDeep(p.x, p.y);
    const gills = (p.genes.gills || 0) > 0;
    let speed = stats.speed;
    p.sprinting = false;
    if (this.isSprinting() && p.moving && p.stamina > 0.5 && p.burrowT <= 0) {
      p.sprinting = true;
      speed *= 1.56;
      p.stamina = Math.max(0, p.stamina - 18 * dt);
    } else {
      p.stamina = Math.min(100, p.stamina + 14 * dt);
    }
    if (deep) speed *= gills ? 0.9 : 0.42;
    else if (wet) speed *= gills ? 0.96 : 0.66;
    if (p.burrowT > 0) speed *= 0.35;
    if (p.food <= 0 || p.water <= 0) speed *= 0.72;

    if (p.moving) {
      const nx = p.x + ix * speed * dt;
      const ny = p.y + iy * speed * dt;
      const res = this.world.resolveCollision(nx, ny, p.size * 13);
      const oldX = p.x;
      const oldY = p.y;
      p.x = clamp(res.x, 60, WORLD_SIZE - 60);
      p.y = clamp(res.y, 60, WORLD_SIZE - 60);
      this.stats.distance += Math.hypot(p.x - oldX, p.y - oldY);
      p.stepT -= dt;
      if (p.stepT <= 0) {
        p.stepT = p.sprinting ? 0.1 : 0.17;
        if (wet) {
          this.particle(p.x, p.y + 8, { type: 'ring', size: 2, life: 0.4, color: '#9fdfe8', grow: 9, alpha: 0.4, vx: -ix * 15, vy: -iy * 15 });
        } else {
          this.particle(p.x - ix * 8, p.y - iy * 8 + 8, { type: 'dust', size: 2.4, life: 0.45, color: '#b7a77c', vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 8 });
        }
      }
    }

    if (deep && !gills) {
      p.hp -= 2.6 * dt;
      p.stamina = Math.max(0, p.stamina - 5 * dt);
      if (!this.drownToast || this.time > this.drownToast) {
        this.drownToast = this.time + 8;
        this.toast('Deep water is crushing you. Surface, or evolve gills.', 'red');
      }
      if (Math.random() < dt * 8) {
        this.particle(p.x + (Math.random() - 0.5) * 18, p.y + (Math.random() - 0.5) * 18, { type: 'bubble', size: 1.5 + Math.random() * 2, life: 0.8, color: '#bff4ff', vy: -20 - Math.random() * 20 });
      }
    }

    const hide = p.genes.hide || 0;
    const weatherHarsh = this.weather.type === 'storm' ? 0.018 : this.weather.type === 'rain' ? 0.008 : 0;
    p.food -= dt * (0.205 + weatherHarsh * (1 - hide * 0.25));
    p.water -= dt * 0.17 * stats.thirstRate * (1 - hide * 0.12);
    if (this.weather.type === 'rain') p.water += dt * 0.055 * this.weather.intensity;
    if (!this.isNight()) p.food += stats.photo * dt;
    p.hp += stats.regen * dt;

    if (p.food <= 0) { p.food = 0; p.hp -= 1.5 * dt; }
    if (p.water <= 0) { p.water = 0; p.hp -= 1.8 * dt; }
    p.food = clamp(p.food, 0, 100);
    p.water = clamp(p.water, 0, 100);
    p.hp = clamp(p.hp, 0, stats.maxHp);

    if ((this.keys.has('Space') || this.keys.has('KeyF')) && p.attackCd <= 0 && p.burrowT <= 0) this.attack();

    if (p.hp <= 0) {
      this.deathCause = p.food <= 0 ? 'Hunger hollowed you out.' : p.water <= 0 ? 'Thirst took you under.' : (deep && !gills) ? 'You drowned in the deep water.' : this.deathCause || 'Your body gave out.';
    }
  }

  updateCamera(dt, idle) {
    const p = this.player;
    let tx = p.x;
    let ty = p.y;
    if (idle) {
      tx = p.x + 220 + Math.sin(this.time * 0.07) * 70;
      ty = p.y + 18 + Math.cos(this.time * 0.05) * 40;
    }
    const k = 1 - Math.exp(-dt * (idle ? 0.8 : 8));
    this.camera.x += (tx - this.camera.x) * k;
    this.camera.y += (ty - this.camera.y) * k;
    this.camera.zoom += (this.zoomTarget - this.camera.zoom) * Math.min(1, dt * 3);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 22);
  }

  /* ============================ FEEDBACK ============================ */

  toast(text, kind = '', duration = 3400) {
    const wrap = $('toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    wrap.appendChild(el);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 420);
    }, duration);
  }

  floatText(x, y, text, color = '#eafff2', size = 13, opts = {}) {
    if (this.floaters.length > 90) this.floaters.shift();
    this.floaters.push({
      x, y, text, color, size, life: opts.life || 1, max: opts.life || 1,
      vy: opts.vy != null ? opts.vy : -28, vx: opts.vx || 0
    });
  }

  particle(x, y, opts = {}) {
    if (this.particles.length > 520) this.particles.shift();
    const life = opts.life || 0.6;
    this.particles.push({
      x, y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life, max: life,
      size: opts.size || 2,
      color: opts.color || '#ffffff',
      type: opts.type || 'dot',
      grav: opts.grav || 0,
      drag: opts.drag != null ? opts.drag : 0.98,
      grow: opts.grow || 0,
      alpha: opts.alpha != null ? opts.alpha : 1,
      rot: opts.rot || 0,
      vr: opts.vr || 0,
      width: opts.width || 1
    });
  }

  particlesBurst(x, y, count, color, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = (opts.speed || 90) * (0.3 + Math.random());
      this.particle(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: (opts.life || 0.7) * (0.6 + Math.random() * 0.7),
        size: (opts.size || 2.5) * (0.5 + Math.random()),
        color, type: opts.type || 'dot', grav: opts.grav || 0,
        drag: opts.drag != null ? opts.drag : 0.94
      });
    }
  }

  ringBurst(x, y, color, radius = 90, count = 3) {
    for (let i = 0; i < count; i++) {
      this.particle(x, y, {
        type: 'ring', size: 4 + i * 4, grow: radius / (0.65 + i * 0.18),
        life: 0.65 + i * 0.18, color, alpha: 0.7 - i * 0.16, width: 2.5
      });
    }
  }

  gainDNA(amount, x = null, y = null, quiet = false) {
    amount = Math.round(amount);
    if (!amount || amount < 0) return;
    this.player.dna += amount;
    if (x != null && y != null && !quiet) {
      this.floatText(x, y, `+${amount} DNA`, '#ffb7d4', 13, { vy: -34 });
    }
  }

  gainXp(amount) {
    if (amount <= 0) return;
    this.player.xp += amount;
    while (this.player.stage < 5 && this.player.xp >= STAGES[this.player.stage].xp) {
      const oldStage = this.player.stage;
      this.player.stage++;
      this.recalcPlayer(true);
      this.player.hp = this.player.maxHp;
      this.player.stamina = 100;
      this.sound.evolve();
      this.camera.shake = 14;
      this.ringBurst(this.player.x, this.player.y, '#9dffc4', 150, 4);
      this.particlesBurst(this.player.x, this.player.y, 30, '#b8ffd6', { speed: 160, life: 1.1, size: 3 });
      this.gainDNA(30 + this.player.stage * 12, this.player.x, this.player.y - 40);
      this.toast(`EVOLUTION — ${STAGES[this.player.stage - 1].name}`, 'gold', 4600);
      const unlock = oldStage === 1
        ? 'Nest Instinct is now available in the Social gene tree.'
        : this.player.stage === 3
          ? 'Apex Presence is now available. Predators will learn to hesitate.'
          : this.player.stage === 4
            ? 'Ascendant Spark is now available. One step from myth.'
            : 'You have reached the final evolution.';
      setTimeout(() => this.toast(unlock, 'purple', 4600), 1500);
      this.updateAvatar();
    }
  }

  /* ============================ WILD LIFE ============================ */

  spawnInitialNPCs() {
    this.npcs = [];
    this.alpha = null;
    const p = this.player;
    const options = [
      ['grazer', 250, -160], ['hopper', -230, 190], ['grazer', 420, 240],
      ['hopper', 180, 340], ['croaker', -350, -220], ['fish', 360, -80],
      ['stalker', -430, 320]
    ];
    for (const [key, ox, oy] of options) {
      if (Math.random() < 0.18 && key === 'stalker') continue;
      this.spawnNPC(key, p.x + ox, p.y + oy);
    }
  }

  findGroundNear(x, y, wantWater) {
    if (!!this.world.isWater(x, y) === wantWater) return { x, y };
    for (let r = 35; r <= 240; r += 35) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + r * 0.3;
        const xx = clamp(x + Math.cos(a) * r, 80, WORLD_SIZE - 80);
        const yy = clamp(y + Math.sin(a) * r, 80, WORLD_SIZE - 80);
        if (!!this.world.isWater(xx, yy) === wantWater) return { x: xx, y: yy };
      }
    }
    return null;
  }

  chooseSpecies(biome, night) {
    const tables = {
      meadow: [['grazer', 3], ['hopper', 3], ['stalker', 0.9]],
      forest: [['grazer', 2], ['hopper', 2.2], ['stalker', 2]],
      savannah: [['grazer', 2.4], ['hopper', 2], ['ram', 1], ['stalker', 1.2], ['ravager', 0.4]],
      swamp: [['croaker', 3], ['stalker', 1.7], ['fish', 1.5]],
      highland: [['ram', 1.8], ['ravager', 1.8], ['stalker', 0.7]],
      crystal: [['crawler', 2], ['ram', 1], ['ravager', 0.9]],
      ash: [['ravager', 2.4], ['crawler', 1.2]],
      sand: [['grazer', 1.2], ['hopper', 2], ['fish', 1]],
      shallow: [['fish', 4]],
      deep: [['fish', 3]]
    };
    let list = tables[biome] || tables.meadow;
    list = list.filter(([key]) => {
      if (key === 'ravager' || key === 'crawler') return this.player.stage >= 2;
      return true;
    });
    if (night) {
      list = list.map(([key, w]) => [key, (key === 'stalker' || key === 'ravager' || key === 'crawler') ? w * 2.4 : w * 0.7]);
    }
    const key = pickWeighted({ next: Math.random }, list);
    return key;
  }

  spawnNPC(key, x, y, opts = {}) {
    const sp = SPECIES[key];
    if (!sp) return null;
    const wantWater = !!sp.aquatic;
    const spot = this.findGroundNear(x, y, wantWater);
    if (!spot) return null;
    const stageScale = 1 + (this.player.stage - 1) * 0.14;
    const bossScale = sp.boss ? 1.14 : 1;
    const pheno = makeSpeciesPheno(sp, bossScale);
    const hp = Math.round(sp.hp * stageScale * (sp.boss ? 1.12 : 1));
    const n = {
      key, species: sp, role: sp.role, name: sp.name,
      x: spot.x, y: spot.y, homeX: spot.x, homeY: spot.y,
      angle: Math.random() * TAU, phase: Math.random() * 9,
      hp, maxHp: hp,
      dmg: sp.dmg * (1 + (this.player.stage - 1) * 0.1),
      speed: sp.speed * (1 + (this.player.stage - 1) * 0.018),
      pheno, size: pheno.scale, r: Math.max(9, pheno.len * 0.32),
      detect: sp.detect || 300, aggro: sp.aggro || 340,
      state: 'wander', wanderT: 0, tx: spot.x, ty: spot.y,
      attackCd: 0.5, attackAnim: 0, stun: 0, poison: 0, poisonDps: 0,
      poisonTick: 0, fear: 0, flash: 0, dead: false, moving: false, t: 0,
      boss: !!sp.boss, golden: key === 'golden', stepT: 0
    };
    if (n.boss) {
      n.hp = Math.round(n.hp * 1.3);
      n.maxHp = n.hp;
      this.alpha = n;
    }
    this.npcs.push(n);
    if (key === 'golden') {
      this.particlesBurst(n.x, n.y, 10, '#ffd86b', { speed: 40, life: 0.9, size: 2 });
    }
    return n;
  }

  spawner(dt) {
    this.timers.spawn -= dt;
    if (this.timers.spawn > 0) return;
    this.timers.spawn = 2.2;
    const p = this.player;
    const alive = this.npcs.filter((n) => !n.dead && !n.boss).length;
    const night = this.isNight();
    const target = Math.min(23, 7 + p.stage * 2 + (night ? 2 : 0));
    if (alive < target) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const a = Math.random() * TAU;
        const r = 620 + Math.random() * 560;
        const x = clamp(p.x + Math.cos(a) * r, 120, WORLD_SIZE - 120);
        const y = clamp(p.y + Math.sin(a) * r, 120, WORLD_SIZE - 120);
        if (this.world.isDeep(x, y) && Math.random() < 0.5) continue;
        if (this.den && dist(x, y, this.den.x, this.den.y) < this.denRadius() + 120) continue;
        const biome = this.world.biomeAt(x, y);
        const key = Math.random() < 0.025 && !BIOMES[biome].water ? 'golden' : this.chooseSpecies(biome, night);
        const sp = SPECIES[key];
        if (sp && !!sp.aquatic !== !!BIOMES[biome].water) {
          const spot = this.findGroundNear(x, y, !!sp.aquatic);
          if (!spot) continue;
        }
        if (this.spawnNPC(key, x, y)) break;
      }
    }

    if (p.stage >= 3 && !this.alpha && !this.flags.alphaSlain) {
      let bossSpot = null;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * TAU;
        const r = 1050 + Math.random() * 700;
        const x = clamp(p.x + Math.cos(a) * r, 150, WORLD_SIZE - 150);
        const y = clamp(p.y + Math.sin(a) * r, 150, WORLD_SIZE - 150);
        const biome = this.world.biomeAt(x, y);
        if ((biome === 'ash' || biome === 'crystal' || biome === 'highland') && !this.world.isWater(x, y)) {
          bossSpot = { x, y };
          break;
        }
      }
      if (bossSpot) {
        this.flags.alphaSpawned = true;
        const n = this.spawnNPC('alpha', bossSpot.x, bossSpot.y);
        if (n) {
          this.toast('A roar rolls across the wastes. The Hollow King has awakened.', 'red', 5600);
          this.sound.thunder();
        }
      }
    }
  }

  stepNPC(n, tx, ty, speed, dt) {
    if (n.stun > 0) { n.moving = false; return; }
    const dx = tx - n.x;
    const dy = ty - n.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) { n.moving = false; return; }
    n.angle = approachAngle(n.angle, Math.atan2(dy, dx), Math.min(1, dt * 8));
    let sp = speed;
    if (this.world.isDeep(n.x, n.y) && !n.species?.aquatic) sp *= 0.28;
    else if (this.world.isWater(n.x, n.y) && !n.species?.aquatic) sp *= 0.64;
    const nx = n.x + (dx / d) * sp * dt;
    const ny = n.y + (dy / d) * sp * dt;
    const res = this.world.resolveCollision(nx, ny, n.r);
    n.x = clamp(res.x, 50, WORLD_SIZE - 50);
    n.y = clamp(res.y, 50, WORLD_SIZE - 50);
    n.moving = true;
    n.stepT -= dt;
    if (n.stepT <= 0) {
      n.stepT = 0.22 + Math.random() * 0.12;
      if (this.world.isWater(n.x, n.y)) {
        this.particle(n.x, n.y + 6, { type: 'ring', size: 1.5, life: 0.35, color: '#a7e6ee', grow: 7, alpha: 0.28 });
      } else if (n.size > 0.9) {
        this.particle(n.x - Math.cos(n.angle) * 8, n.y + 8, { type: 'dust', size: 2, life: 0.35, color: '#ab9c72' });
      }
    }
  }

  updateNPCs(dt) {
    const p = this.player;
    const canTargetPlayer = this.started && !this.dead && !p.dead && p.burrowT <= 0;
    const camo = (p.genes.camouflage || 0) > 0 ? this.pstats.detectMod : 1;
    for (const n of this.npcs) {
      if (n.dead) continue;
      n.t += dt;
      n.flash = Math.max(0, n.flash - dt);
      n.attackAnim = Math.max(0, n.attackAnim - dt);
      n.stun = Math.max(0, n.stun - dt);
      n.fear = Math.max(0, n.fear - dt);
      n.attackCd = Math.max(0, n.attackCd - dt);

      if (n.poison > 0) {
        n.poison -= dt;
        n.hp -= n.poisonDps * dt;
        n.poisonTick -= dt;
        if (n.poisonTick <= 0) {
          n.poisonTick = 1;
          this.floatText(n.x, n.y - 18, `${Math.round(n.poisonDps)}`, '#a6ff7a', 11, { life: 0.7 });
          this.particle(n.x, n.y, { type: 'bubble', size: 2, life: 0.5, color: '#8aff6a', vy: -16 });
        }
        if (n.hp <= 0) { this.killNPC(n); continue; }
      }

      if (n.stun > 0) { n.moving = false; continue; }
      const dpl = dist(n.x, n.y, p.x, p.y);
      const denSafe = this.den ? dist(n.x, n.y, this.den.x, this.den.y) < this.denRadius() + 10 : false;
      const detect = n.detect * camo * (this.weather.type === 'fog' ? 0.62 : 1) * (this.isNight() && !p.genes.nightvision ? 0.84 : 1);
      let moved = false;

      if (n.role === 'prey') {
        let threat = null;
        if (canTargetPlayer && !denSafe && dpl < detect) threat = p;
        if (!threat && canTargetPlayer) {
          for (const other of this.npcs) {
            if (other.dead || other.role !== 'predator') continue;
            if (dist(n.x, n.y, other.x, other.y) < 250) { threat = other; break; }
          }
        }
        if (n.fear > 0 && canTargetPlayer) threat = threat || p;
        if (threat) {
          const ax = n.x - threat.x;
          const ay = n.y - threat.y;
          const d = Math.hypot(ax, ay) || 1;
          this.stepNPC(n, n.x + (ax / d) * 150, n.y + (ay / d) * 150, n.speed * 1.35, dt);
          moved = true;
          if (dist(n.x, n.y, threat.x, threat.y) > detect * 1.8) n.state = 'wander';
        }
        if (!moved) {
          n.wanderT -= dt;
          if (n.wanderT <= 0) {
            n.wanderT = 2 + Math.random() * 4;
            n.tx = n.homeX + (Math.random() - 0.5) * 210;
            n.ty = n.homeY + (Math.random() - 0.5) * 210;
          }
          this.stepNPC(n, n.tx, n.ty, n.speed * 0.55, dt);
        }
      } else if (n.role === 'predator') {
        if (denSafe && !n.boss) {
          const ax = n.x - this.den.x;
          const ay = n.y - this.den.y;
          const d = Math.hypot(ax, ay) || 1;
          this.stepNPC(n, n.x + (ax / d) * 180, n.y + (ay / d) * 180, n.speed * 1.1, dt);
          continue;
        }
        if (this.player.genes.intimidation && p.stage >= 3 && !n.boss && dpl < 310 && Math.random() < dt * 0.22) {
          n.fear = 3.2;
        }
        let target = null;
        if (canTargetPlayer && dpl < n.aggro) target = p;
        for (const c of this.companions) {
          if (c.dead) continue;
          const d = dist(n.x, n.y, c.x, c.y);
          if (canTargetPlayer && d < n.aggro * 0.85 && (!target || d < dist(n.x, n.y, target.x, target.y))) target = c;
        }
        const flee = n.fear > 0 && canTargetPlayer;
        if (flee) {
          const ax = n.x - p.x;
          const ay = n.y - p.y;
          const d = Math.hypot(ax, ay) || 1;
          this.stepNPC(n, n.x + (ax / d) * 160, n.y + (ay / d) * 160, n.speed * 1.25, dt);
          continue;
        }
        if (target) {
          const d = dist(n.x, n.y, target.x, target.y);
          const range = n.r + (target === p ? p.size * 13 : target.r || 14) + 15;
          if (d > range) {
            this.stepNPC(n, target.x, target.y, n.speed * (n.boss ? 1.08 : 1), dt);
          } else if (n.attackCd <= 0) {
            n.attackCd = (n.boss ? 1.0 : 1.25) + Math.random() * 0.5;
            n.attackAnim = 0.26;
            n.moving = false;
            if (target === p) this.hurtPlayer(n.dmg, n);
            else this.hurtCompanion(target, n.dmg, n);
          }
        } else {
          n.wanderT -= dt;
          if (n.wanderT <= 0) {
            n.wanderT = 3 + Math.random() * 4;
            n.tx = n.homeX + (Math.random() - 0.5) * (n.boss ? 420 : 240);
            n.ty = n.homeY + (Math.random() - 0.5) * (n.boss ? 420 : 240);
          }
          this.stepNPC(n, n.tx, n.ty, n.speed * 0.42, dt);
        }
      }

      if (!n.boss && dist(n.x, n.y, p.x, p.y) > 2700) n.dead = true;
    }
  }

  hurtCompanion(c, dmg, source) {
    if (c.dead) return;
    c.hp -= dmg;
    c.flash = 0.2;
    this.floatText(c.x, c.y - 24, `-${Math.round(dmg)}`, '#ff9a9a', 12);
    this.particlesBurst(c.x, c.y, 5, '#a33a46', { speed: 60, life: 0.4, size: 2 });
    if (c.hp <= 0) {
      c.dead = true;
      c.respawnT = 12;
      this.toast(`${c.name} was driven off. They will return to the den.`, 'red');
      this.particlesBurst(c.x, c.y, 20, '#ffb8c0', { speed: 90, life: 0.8, size: 2.5 });
    }
  }

  updateCompanions(dt) {
    const p = this.player;
    for (let i = 0; i < this.companions.length; i++) {
      const c = this.companions[i];
      c.flash = Math.max(0, c.flash - dt);
      c.attackCd = Math.max(0, c.attackCd - dt);
      if (c.dead) {
        c.respawnT -= dt;
        if (c.respawnT <= 0 && !this.dead) {
          c.dead = false;
          c.hp = c.maxHp;
          c.x = p.x + (Math.random() - 0.5) * 80;
          c.y = p.y + (Math.random() - 0.5) * 80;
          this.toast(`${c.name} has recovered and returned to your side.`, 'pink');
          this.ringBurst(c.x, c.y, '#ff9ec7', 60, 2);
        }
        continue;
      }
      let target = null;
      let td = 320;
      for (const n of this.npcs) {
        if (n.dead || n.role !== 'predator') continue;
        const d = dist(c.x, c.y, n.x, n.y);
        if (d < td) { td = d; target = n; }
      }
      if (target) {
        const d = dist(c.x, c.y, target.x, target.y);
        if (d > c.r + target.r + 12) {
          this.stepNPC(c, target.x, target.y, c.stats.speed * 1.1, dt);
        } else if (c.attackCd <= 0) {
          c.attackCd = 0.95;
          const mult = 1 + (p.genes.pack || 0) * 0.2;
          const dmg = c.stats.damage * mult * (0.9 + Math.random() * 0.2);
          this.damageNPC(target, dmg, { venom: (c.genes.venom || 0) > 0 });
          this.sound.attack();
        }
      } else {
        const followDist = dist(c.x, c.y, p.x, p.y);
        if (followDist > 560) {
          c.x = p.x + Math.cos(i * 2.4) * 50;
          c.y = p.y + Math.sin(i * 2.4) * 50;
        } else if (followDist > 96) {
          const a = i * 2.4 + 0.7;
          this.stepNPC(c, p.x + Math.cos(a) * 58, p.y + Math.sin(a) * 58, c.stats.speed * 0.96, dt);
        } else {
          c.moving = false;
          c.angle = approachAngle(c.angle, p.angle, dt * 3);
        }
      }
    }
  }

  updateMate(dt) {
    const m = this.mate;
    if (!m) return;
    const p = this.player;
    m.phase += dt;
    const anchor = this.den || p;
    const dPlayer = dist(m.x, m.y, p.x, p.y);
    if (dPlayer < 96) {
      m.angle = approachAngle(m.angle, Math.atan2(p.y - m.y, p.x - m.x), dt * 4);
      if (m.affinity >= 100 && Math.random() < dt * 0.7) {
        this.particle(m.x, m.y - 26, { type: 'heart', size: 4, life: 1.4, color: '#ff9ec7', vy: -18, vx: (Math.random() - 0.5) * 8 });
      }
    } else {
      m.wanderT = (m.wanderT || 0) - dt;
      if (m.wanderT <= 0) {
        m.wanderT = 2.5 + Math.random() * 3;
        const a = Math.random() * TAU;
        const r = 40 + Math.random() * 130;
        m.wx = anchor.x + Math.cos(a) * r;
        m.wy = anchor.y + Math.sin(a) * r;
      }
      this.stepNPC(m, m.wx || anchor.x, m.wy || anchor.y, 52, dt);
    }
    if (dPlayer < 500 && this.mate.affinity >= 100 && Math.random() < dt * 0.35) {
      this.particle(m.x + (Math.random() - 0.5) * 20, m.y - 30, { type: 'sparkle', size: 2, life: 1, color: '#ffd6e8', vy: -10 });
    }
  }

  updateDen(dt) {
    if (!this.den) return;
    const den = this.den;
    den.pulse = (den.pulse || 0) + dt;
    if (den.modules.nest && !this.mate) this.spawnMate();
    const p = this.player;
    if (dist(p.x, p.y, den.x, den.y) < this.denRadius()) {
      p.hp = Math.min(p.maxHp, p.hp + 1.15 * dt);
      p.stamina = Math.min(100, p.stamina + 5 * dt);
      const garden = den.modules.garden || 0;
      if (garden) p.food = Math.min(100, p.food + garden * 0.032 * dt);
      const shrine = den.modules.shrine || 0;
      if (shrine) {
        this.denShrineTimer += dt;
        if (this.denShrineTimer >= 25) {
          this.denShrineTimer = 0;
          this.gainDNA(shrine, p.x, p.y - 38);
          this.particle(p.x, p.y - 20, { type: 'sparkle', size: 4, life: 1.1, color: '#ffd479', vy: -26 });
          this.sound.tone(760, 0.18, 'sine', 0.06, 120);
        }
      }
    }
  }

  denRadius() {
    if (!this.den) return 0;
    return 118 + (this.den.modules.walls || 0) * 55 + (this.den.modules.nest ? 8 : 0);
  }

  updateCorpses(dt) {
    for (const c of this.corpses) c.decay -= dt;
    this.corpses = this.corpses.filter((c) => c.decay > 0);
  }

  updateClouds(dt) {
    for (const cloud of this.clouds) {
      cloud.t += dt;
      cloud.tick -= dt;
      if (cloud.tick <= 0) {
        cloud.tick = 0.5;
        for (const n of this.npcs) {
          if (n.dead) continue;
          if (dist(n.x, n.y, cloud.x, cloud.y) < cloud.r + n.r) {
            this.damageNPC(n, cloud.dps * 0.5, {});
          }
        }
        if (Math.random() < 0.7) {
          this.particle(cloud.x + (Math.random() - 0.5) * cloud.r, cloud.y + (Math.random() - 0.5) * cloud.r, {
            type: 'smoke', size: 10 + Math.random() * 12, life: 1.2, color: '#7cff9a', vx: (Math.random() - 0.5) * 12, vy: -8
          });
        }
      }
    }
    this.clouds = this.clouds.filter((c) => c.t < c.max);
  }

  updateSlashes(dt) {
    for (const s of this.slashes) s.t += dt;
    this.slashes = this.slashes.filter((s) => s.t < s.max);
  }

  updateExploration(dt) {
    this.timers.explore -= dt;
    if (this.timers.explore > 0) return;
    this.timers.explore = 0.22;
    const p = this.player;
    let radius = this.pstats.vision * (this.weather.type === 'fog' ? 0.62 : 1);
    if (this.den && (this.den.modules.lookout || 0) > 0 && dist(p.x, p.y, this.den.x, this.den.y) < this.denRadius() + 200) {
      radius += this.den.modules.lookout * 260;
    }
    this.markExplored(p.x, p.y, radius);
    this.discoverBiome(this.world.biomeAt(p.x, p.y));
    for (const n of this.npcs) {
      if (n.dead || this.discovered.species.has(n.key)) continue;
      if (dist(p.x, p.y, n.x, n.y) < this.pstats.vision * 0.9) {
        this.discovered.species.add(n.key);
        this.gainDNA(8, n.x, n.y - 26);
        this.gainXp(6);
        this.toast(`New species observed — ${n.name}.`, 'purple', 3200);
        break;
      }
    }
  }

  markExplored(x, y, radius) {
    const minx = clamp(Math.floor((x - radius) / CELL), 0, MAPRES - 1);
    const maxx = clamp(Math.floor((x + radius) / CELL), 0, MAPRES - 1);
    const miny = clamp(Math.floor((y - radius) / CELL), 0, MAPRES - 1);
    const maxy = clamp(Math.floor((y + radius) / CELL), 0, MAPRES - 1);
    const r2 = radius * radius;
    for (let cy = miny; cy <= maxy; cy++) {
      for (let cx = minx; cx <= maxx; cx++) {
        const wx = (cx + 0.5) * CELL;
        const wy = (cy + 0.5) * CELL;
        const dx = wx - x;
        const dy = wy - y;
        if (dx * dx + dy * dy <= r2) this.explored.add(cy * MAPRES + cx);
      }
    }
  }

  discoverBiome(key, silent = false) {
    if (!key || !BIOMES[key]) return;
    this.lastBiome = key;
    if (this.discovered.biomes.has(key)) return;
    this.discovered.biomes.add(key);
    if (!silent) {
      this.gainDNA(18, this.player.x, this.player.y - 42);
      this.gainXp(16);
      this.toast(`Biome discovered — ${BIOMES[key].name}.`, 'gold', 4000);
      this.sound.tone(700, 0.15, 'sine', 0.06, 90);
      const desc = BIOMES[key].desc;
      setTimeout(() => this.toast(desc, '', 4200), 900);
    }
  }

  /* ============================ PROGRESSION ============================ */

  checkQuests() {
    if (!this.started) return;
    let guard = 0;
    while (this.questIndex < QUESTS.length && guard++ < 12) {
      const q = QUESTS[this.questIndex];
      let progress = 0;
      try { progress = q.progress(this); } catch { progress = 0; }
      if (progress >= q.goal) {
        this.questIndex++;
        this.gainDNA(q.reward, this.player.x, this.player.y - 54);
        if (q.xp) this.gainXp(q.xp);
        this.toast(`Objective complete — ${q.title}`, 'gold', 4200);
        this.sound.levelup();
        this.saveGame();
      } else break;
    }
  }

  questHint() {
    const q = QUESTS[this.questIndex];
    if (!q) return 'All objectives complete. This world is yours.';
    if (q.id === 'eat') return 'Look for berry bushes, mushrooms, or hunt small prey.';
    if (q.id === 'drink') return 'Stand near any water and press E.';
    if (q.id === 'mutate') return 'Press M to open the genome tree. Spend DNA on any gene.';
    if (q.id === 'stage2') return 'Eat, hunt and explore to fill the evolution bar.';
    if (q.id === 'nestgene') return 'Open the genome tree (M), Social tab, and unlock Nest Instinct.';
    if (q.id === 'den') {
      if (!(this.player.genes.nest || 0)) return 'Unlock Nest Instinct first (M → Social).';
      const missing = this.costShortfall(DEN_COST);
      if (missing) return `Gather materials: ${missing}. Trees, rocks and reeds provide them.`;
      return 'Press B to found your den on dry ground.';
    }
    if (q.id === 'nest') return 'Press B to open your den, then build a Brood Nest.';
    if (q.id === 'court') return 'Your kindred waits by the nest. Get close and press E to court.';
    if (q.id === 'breed') return 'Open your den (B), then choose Breeding when affinity is full.';
    if (q.id === 'stage4' || q.id === 'stage5') return 'Hunt, explore new biomes, and complete objectives for XP.';
    return q.text;
  }

  canAfford(cost) {
    for (const [key, amount] of Object.entries(cost)) {
      if ((this.materials[key] || 0) < amount) return false;
    }
    return true;
  }

  costShortfall(cost) {
    const missing = [];
    for (const [key, amount] of Object.entries(cost)) {
      const have = this.materials[key] || 0;
      if (have < amount) missing.push(`${amount - have} ${MATERIALS[key].name.toLowerCase()}`);
    }
    return missing.join(', ');
  }

  takeCost(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [key, amount] of Object.entries(cost)) this.materials[key] -= amount;
    return true;
  }

  checkAchievements() {
    if (!this.started) return;
    const conditions = {
      firstKill: this.stats.kills >= 1,
      gatherer: this.stats.gathered >= 25,
      explorer: this.discovered.biomes.size >= 5,
      den: !!this.den,
      parent: this.stats.breeds >= 1,
      nightOwl: this.day >= 2,
      alpha: !!this.flags.alphaSlain,
      golden: !!this.flags.goldenSlain,
      crystals: !!this.flags.crystalGathered,
      apex: this.player.stage >= 4,
      ascendant: this.player.stage >= 5
    };
    for (const a of ACHIEVEMENTS) {
      if (this.achievements.has(a.id) || !conditions[a.id]) continue;
      this.achievements.add(a.id);
      this.gainDNA(25, this.player.x, this.player.y - 60);
      this.toast(`Achievement — ${a.name}. ${a.desc}`, 'gold', 4200);
      this.sound.tone(880, 0.2, 'sine', 0.06, 160);
    }
  }

  /* ============================ ACTIONS & COMBAT ============================ */

  attack() {
    const p = this.player;
    if (!this.started || this.paused || this.dead || p.attackCd > 0 || p.burrowT > 0) return;
    if (p.stamina < 5) {
      if (Math.random() < 0.3) this.toast('Too exhausted to bite. Catch your breath.', '', 2000);
      return;
    }
    p.attackCd = 0.45;
    p.stamina = Math.max(0, p.stamina - 6);
    p.flash = 0.08;
    const range = this.pstats.attackRange + 12;
    const half = 1.12;
    this.slashes.push({
      x: p.x, y: p.y, angle: p.angle, t: 0, max: 0.2, range,
      color: (p.genes.venom || 0) > 0 ? '#9aff7c' : '#eaffd4'
    });
    this.sound.attack();
    this.camera.shake = Math.max(this.camera.shake, 2.2);
    let hitAny = false;
    for (const n of this.npcs) {
      if (n.dead) continue;
      if (!pointInArc(p.x, p.y, p.angle, range + n.r, half, n.x, n.y)) continue;
      hitAny = true;
      const dmg = this.pstats.damage * (0.9 + Math.random() * 0.24);
      this.damageNPC(n, dmg, {
        venom: (p.genes.venom || 0) > 0,
        knock: 24 + (p.genes.might || 0) * 8
      });
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      n.x += Math.cos(a) * 12;
      n.y += Math.sin(a) * 12;
    }
    if (hitAny) {
      this.sound.hit();
      this.camera.shake = Math.max(this.camera.shake, 5);
    }
  }

  damageNPC(n, amount, opts = {}) {
    if (!n || n.dead) return;
    const armor = n.pheno ? (n.pheno.armor || 0) * 0.08 : 0;
    const dmg = Math.max(1, amount * (1 - armor));
    n.hp -= dmg;
    n.flash = 0.17;
    this.floatText(n.x + (Math.random() - 0.5) * 10, n.y - n.pheno.wid * 0.45 - 8, `-${Math.round(dmg)}`, '#ffe6b0', 13);
    this.particlesBurst(n.x, n.y, 4, '#8f2732', { speed: 70, life: 0.45, size: 2.2, grav: 120 });
    if (opts.venom) {
      n.poison = Math.max(n.poison, 5);
      n.poisonDps = Math.max(n.poisonDps, 2.4 * (this.player.genes.venom || 1));
      n.poisonTick = Math.min(n.poisonTick || 1, 0.4);
    }
    if (opts.stun) n.stun = Math.max(n.stun, opts.stun);
    if (n.role === 'prey') n.fear = Math.max(n.fear, 3.4);
    if (n.hp <= 0) this.killNPC(n);
  }

  killNPC(n) {
    if (!n || n.dead) return;
    n.dead = true;
    const sp = n.species;
    this.stats.kills++;
    this.gainXp(sp.xp + (n.boss ? 80 : 0));
    this.gainDNA(sp.dna + (n.boss ? 80 : 0), n.x, n.y - 32);
    this.corpses.push({
      x: n.x, y: n.y, name: sp.name,
      food: sp.food, dna: Math.round(sp.dna * 0.32), xp: Math.round(sp.xp * 0.25),
      decay: 95, max: 95, color1: n.pheno.color1, color2: n.pheno.color2,
      size: n.size, angle: n.angle + Math.PI * 0.5
    });
    this.particlesBurst(n.x, n.y, 18, '#7c2530', { speed: 120, life: 0.8, size: 3, grav: 160 });
    this.particlesBurst(n.x, n.y, 8, n.pheno.color3 || '#ffe6b0', { speed: 80, life: 0.6, size: 2 });
    this.sound.hit();
    this.camera.shake = Math.max(this.camera.shake, n.boss ? 16 : 6);
    if (n.boss) {
      this.flags.alphaSlain = true;
      this.alpha = null;
      this.toast('The Hollow King is slain. The wastes fall silent.', 'gold', 6000);
      this.ringBurst(n.x, n.y, '#ff7b5a', 200, 3);
      this.sound.evolve();
    } else if (n.golden) {
      this.flags.goldenSlain = true;
      this.toast('The Gilded Drifter falls. Fortune is yours.', 'gold', 4600);
      this.ringBurst(n.x, n.y, '#ffd86b', 130, 2);
    }
  }

  hurtPlayer(amount, source = null) {
    const p = this.player;
    if (this.dead || p.invuln > 0 || p.burrowT > 0) return;
    let dmg = amount * (1 - this.pstats.armor);
    if (this.den && dist(p.x, p.y, this.den.x, this.den.y) < this.denRadius()) {
      dmg *= 1 - (this.den.modules.walls || 0) * 0.08;
    }
    dmg = Math.max(1, dmg);
    p.hp -= dmg;
    p.invuln = 0.58;
    p.flash = 0.22;
    this.hurtFlash = 1;
    this.camera.shake = Math.max(this.camera.shake, 7);
    this.sound.hurt();
    this.floatText(p.x, p.y - 32, `-${Math.round(dmg)}`, '#ff8080', 15);
    this.particlesBurst(p.x, p.y, 8, '#b82e42', { speed: 100, life: 0.6, size: 2.4, grav: 100 });
    if (source && !source.dead) {
      this.deathCause = `${source.name} tore you apart.`;
      if ((p.genes.spikes || 0) > 0) {
        this.damageNPC(source, dmg * this.pstats.spikes, {});
      }
    } else {
      this.deathCause = this.deathCause || 'The world wore you down.';
    }
    if (p.hp <= 0) this.die(this.deathCause);
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.paused = true;
    this.stats.deaths++;
    this.deathCause = cause || this.deathCause || 'The world wore you down.';
    this.player.hp = 0;
    this.player.dead = true;
    this.player.dna = Math.floor(this.player.dna * 0.85);
    this.sound.hurt();
    this.sound.thunder();
    this.particlesBurst(this.player.x, this.player.y, 30, '#ff8f9c', { speed: 150, life: 1.2, size: 3 });
    this.ringBurst(this.player.x, this.player.y, '#ff6b7a', 120, 2);
    $('prompt').classList.add('hidden');
    $('death-text').textContent = this.deathCause;
    $('death-stats').innerHTML = `
      <div><b>${this.day}</b>Days</div>
      <div><b>${this.stats.kills}</b>Kills</div>
      <div><b>${this.stats.breeds}</b>Heirs</div>
      <div><b>${this.generation}</b>Generation</div>`;
    const den = this.den;
    $('btn-respawn').textContent = den ? 'Wake at your den' : 'Return to the world';
    $('death').classList.remove('hidden');
    setTimeout(() => this.saveGame(), 50);
  }

  respawn() {
    const p = this.player;
    this.dead = false;
    this.paused = false;
    p.dead = false;
    p.hp = Math.max(1, Math.round(this.pstats.maxHp * 0.62));
    p.stamina = 100;
    p.food = Math.max(p.food, 45);
    p.water = Math.max(p.water, 45);
    p.invuln = 3.5;
    p.flash = 0;
    p.burrowT = 0;
    p.poison = 0;
    if (this.den) {
      p.x = this.den.x + 60;
      p.y = this.den.y + 45;
      this.tod = 0.23;
      this.day++;
      this.stats.nights++;
    } else {
      p.x = this.spawnPoint.x;
      p.y = this.spawnPoint.y;
    }
    for (const c of this.companions) {
      c.dead = false;
      c.hp = c.maxHp;
      c.x = p.x + (Math.random() - 0.5) * 60;
      c.y = p.y + (Math.random() - 0.5) * 60;
    }
    for (const n of this.npcs) {
      if (n.role === 'predator' && dist(n.x, n.y, p.x, p.y) < 520) n.fear = 4;
    }
    this.clouds = [];
    this.camera.x = p.x;
    this.camera.y = p.y;
    this.camera.shake = 0;
    $('death').classList.add('hidden');
    this.ringBurst(p.x, p.y, '#9dffc4', 100, 2);
    this.toast(this.den ? 'You wake at your den. The world kept turning.' : 'You wake at the place where your story began.', 'gold', 3800);
    this.sound.levelup();
    this.saveGame();
    this.updateHUD();
  }

  useAbility() {
    const p = this.player;
    if (!this.started || this.paused || this.dead || p.abilityCd > 0 || p.burrowT > 0) return;
    if (p.stamina < 20) { this.toast('Not enough stamina for that.', '', 1800); return; }
    const ability = this.pstats.ability;
    const info = ABILITY_INFO[ability] || ABILITY_INFO.roar;
    p.stamina -= 22;
    p.abilityCd = info.cd;
    p.abilityMax = info.cd;
    p.flash = 0.12;
    if (ability === 'pulse') {
      const radius = 170;
      this.ringBurst(p.x, p.y, '#9fe8ff', radius, 3);
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU;
        this.particle(p.x, p.y, {
          type: 'spark', size: 3, life: 0.5, color: '#b9f0ff',
          vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, drag: 0.9
        });
      }
      for (const n of this.npcs) {
        if (n.dead) continue;
        if (dist(n.x, n.y, p.x, p.y) < radius + n.r) {
          this.damageNPC(n, this.pstats.damage * (0.85 + (p.genes.electric || 0) * 0.18), { stun: 2.1 });
          this.particle((n.x + p.x) / 2, (n.y + p.y) / 2, { type: 'bolt', size: 2, life: 0.25, color: '#d3f6ff', width: 2 });
        }
      }
      this.sound.tone(160, 0.3, 'sawtooth', 0.12, -90);
      this.sound.noise(0.3, 0.1, 2400);
      this.camera.shake = 9;
    } else if (ability === 'cloud') {
      this.clouds.push({ x: p.x, y: p.y, r: 160, t: 0, max: 5, dps: 3.2 + (p.genes.venom || 0) * 1.8, tick: 0 });
      this.ringBurst(p.x, p.y, '#8aff6a', 160, 3);
      this.sound.noise(0.6, 0.08, 500);
      this.sound.tone(120, 0.7, 'sine', 0.08, -40);
    } else if (ability === 'dash') {
      const d = 195;
      const nx = p.x + Math.cos(p.angle) * d;
      const ny = p.y + Math.sin(p.angle) * d;
      const res = this.world.resolveCollision(nx, ny, p.size * 12);
      for (let i = 0; i < 10; i++) {
        this.particle(p.x + (Math.random() - 0.5) * 18, p.y + (Math.random() - 0.5) * 18, {
          type: 'wing', size: 3, life: 0.6, color: '#c8fff0',
          vx: -Math.cos(p.angle) * 80 + (Math.random() - 0.5) * 60,
          vy: -Math.sin(p.angle) * 80 + (Math.random() - 0.5) * 60
        });
      }
      p.x = clamp(res.x, 60, WORLD_SIZE - 60);
      p.y = clamp(res.y, 60, WORLD_SIZE - 60);
      p.invuln = Math.max(p.invuln, 0.6);
      p.stamina = Math.max(0, p.stamina - 4);
      this.sound.noise(0.2, 0.08, 1600);
      this.camera.shake = 4;
    } else if (ability === 'burrow') {
      p.burrowT = 2.8;
      p.invuln = Math.max(p.invuln, 2.9);
      this.particlesBurst(p.x, p.y, 18, '#8a6d4a', { speed: 80, life: 0.7, size: 3 });
      this.ringBurst(p.x, p.y, '#a8875c', 50, 2);
      this.sound.gather();
      this.toast('You burrow into the earth. Nothing can reach you.', '', 2600);
    } else {
      this.ringBurst(p.x, p.y, '#ffd479', 280, 3);
      for (const n of this.npcs) {
        if (n.dead) continue;
        if (dist(n.x, n.y, p.x, p.y) < 320) {
          n.fear = 4.2;
          if (n.role === 'predator') n.stun = Math.max(n.stun, 0.8);
        }
      }
      this.sound.tone(95, 0.8, 'sawtooth', 0.14, 40);
      this.sound.noise(0.7, 0.1, 300);
      this.camera.shake = 10;
      this.toast('Your roar rolls through the undergrowth.', '', 2200);
    }
  }

  getInteraction() {
    if (!this.started || this.dead) return null;
    const p = this.player;
    if (this.mate) {
      const d = dist(p.x, p.y, this.mate.x, this.mate.y);
      if (d < 96) {
        return {
          type: 'mate',
          label: this.mate.affinity >= 100 ? `Breed with ${this.mate.name}` : `Court ${this.mate.name} · ${Math.floor(this.mate.affinity)}%`,
          target: this.mate
        };
      }
    }
    if (this.den) {
      const d = dist(p.x, p.y, this.den.x, this.den.y);
      if (d < 132) {
        return {
          type: 'den',
          label: this.den.modules.nest ? 'Tend your den & brood nest' : 'Tend your den',
          target: this.den
        };
      }
    }
    let best = null;
    let bestScore = Infinity;
    for (const c of this.corpses) {
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < 82 && d < bestScore) {
        bestScore = d;
        best = { type: 'corpse', label: `Eat ${c.name} remains`, target: c };
      }
    }
    if (best) return best;
    for (const obj of this.world.nearbyObjects(p.x, p.y, 92)) {
      const meta = this.world.harvestInfo(obj);
      if (!meta || !meta.kind) continue;
      if (!this.world.isAvailable(obj, this.time)) continue;
      const d = dist(p.x, p.y, obj.x, obj.y) - obj.r * 0.4;
      if (d < bestScore) {
        bestScore = d;
        best = { type: 'object', label: meta.label, target: obj, meta };
      }
    }
    if (best) return best;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const x = p.x + Math.cos(a) * 50;
      const y = p.y + Math.sin(a) * 50;
      if (this.world.isWater(x, y)) return { type: 'water', label: 'Drink water' };
    }
    return null;
  }

  doInteract() {
    if (!this.started || this.dead || this.panel) return;
    const it = this.getInteraction();
    if (!it) {
      this.toast('Nothing within reach. Explore a little further.', '', 1800);
      return;
    }
    if (it.type === 'mate') {
      if (it.target.affinity >= 100) {
        if (this.den && this.den.modules.nest) this.openBreed();
        else this.toast('Affinity is full. Build a Brood Nest to breed.', 'pink', 3000);
      } else this.courtMate();
    } else if (it.type === 'den') {
      this.openBuild();
    } else if (it.type === 'corpse') {
      this.eatCorpse(it.target);
    } else if (it.type === 'object') {
      this.harvestObject(it.target);
    } else if (it.type === 'water') {
      this.drink();
    }
  }

  harvestObject(obj) {
    const p = this.player;
    const meta = this.world.harvestInfo(obj);
    if (!meta || !this.world.isAvailable(obj, this.time)) return;
    this.world.markHarvested(obj, this.time);
    if (meta.kind === 'food') {
      let food = meta.amount * this.pstats.foodValue;
      let poison = false;
      if (obj.type === 'mushroom' && obj.poison && !(p.genes.toxin || 0)) {
        poison = true;
        food *= 0.45;
        p.hp -= 9;
        this.toast('Bitter poison burns your throat. Toxin Filter would help.', 'red', 3000);
        this.floatText(p.x, p.y - 36, '-9', '#ff9a72', 14);
      }
      p.food = Math.min(100, p.food + food);
      p.water = Math.min(100, p.water + 2);
      this.stats.eats++;
      this.gainDNA(obj.type === 'mushroom' ? 2 : 2, p.x, p.y - 30);
      this.gainXp(4);
      this.floatText(p.x + 18, p.y - 24, `+${Math.round(food)} food`, '#ffd7a8', 11, { life: 0.9 });
      this.particlesBurst(obj.x, obj.y - 5, 9, obj.variant ? '#7f9bff' : '#e85a6c', { speed: 50, life: 0.6, size: 2 });
      this.sound.eat();
      if (poison) this.sound.hurt();
    } else if (meta.kind === 'obelisk') {
      this.gainDNA(45, p.x, p.y - 44);
      this.gainXp(34);
      this.markExplored(obj.x, obj.y, 1200);
      this.landmarks.push({ x: obj.x, y: obj.y, name: 'Echo Monolith' });
      const lore = LORE[Math.min(LORE.length - 1, this.landmarks.length - 1)];
      this.toast(lore, 'purple', 6200);
      this.ringBurst(obj.x, obj.y, '#8ef0d0', 160, 3);
      this.camera.shake = 5;
      this.sound.evolve();
      this.saveGame();
    } else {
      const kind = meta.kind;
      const amount = meta.amount + (meta.extra?.[kind] || 0);
      this.materials[kind] = (this.materials[kind] || 0) + amount;
      if (meta.extra) {
        for (const [k, v] of Object.entries(meta.extra)) {
          if (k !== kind) this.materials[k] = (this.materials[k] || 0) + v;
        }
      }
      this.stats.gathered++;
      this.gainDNA(1, obj.x, obj.y - 20, true);
      this.gainXp(2);
      this.floatText(obj.x, obj.y - obj.r - 12, `+${amount} ${MATERIALS[kind].name}`, MATERIALS[kind].color, 11);
      this.particlesBurst(obj.x, obj.y - 8, 8, MATERIALS[kind].color, { speed: 55, life: 0.55, size: 2, grav: 80 });
      this.sound.gather();
      if (kind === 'crystal') {
        this.flags.crystalGathered = true;
        this.gainDNA(2, obj.x, obj.y - 26, true);
      }
    }
    this.checkQuests();
    this.updateHUD();
  }

  drink() {
    const p = this.player;
    if (p.drinkCd > 0) return;
    if (p.water >= 98) { this.toast('You are already quenched.', '', 1600); return; }
    p.water = Math.min(100, p.water + 34);
    p.drinkCd = 2.2;
    this.stats.drinks++;
    this.gainXp(1);
    this.sound.splash();
    this.floatText(p.x, p.y - 30, '+34 water', '#a8e9ff', 11);
    for (let i = 0; i < 7; i++) {
      this.particle(p.x + (Math.random() - 0.5) * 24, p.y + 8, {
        type: 'ring', size: 2, life: 0.5, color: '#a8e9ff', grow: 12, alpha: 0.4
      });
    }
    this.checkQuests();
  }

  eatCorpse(c) {
    const p = this.player;
    const food = c.food * this.pstats.foodValue;
    p.food = Math.min(100, p.food + food);
    this.stats.eats++;
    this.gainDNA(c.dna, p.x, p.y - 34);
    this.gainXp(c.xp);
    this.floatText(p.x + 10, p.y - 20, `+${Math.round(food)} food`, '#ffd7a8', 12);
    this.particlesBurst(c.x, c.y, 12, '#7c2530', { speed: 70, life: 0.7, size: 2.5, grav: 100 });
    this.corpses = this.corpses.filter((x) => x !== c);
    this.sound.eat();
    this.checkQuests();
  }

  courtMate() {
    const m = this.mate;
    if (!m || this.courtCd > 0) return;
    if (m.affinity >= 100) {
      if (this.den && this.den.modules.nest) this.openBreed();
      else this.toast('Affinity is full. Build a Brood Nest to breed.', 'pink', 3000);
      return;
    }
    if (this.player.food < 18) {
      this.toast('Courtship needs energy. Eat something first.', '', 2600);
      return;
    }
    const gain = 12 + (this.player.genes.charm || 0) * 7 + ((this.player.genes.biolum || 0) ? 4 : 0);
    m.affinity = Math.min(100, m.affinity + gain);
    this.courtCd = 1.05;
    this.player.food = Math.max(0, this.player.food - 1.5);
    this.gainXp(2);
    this.sound.heart();
    this.particlesBurst(m.x, m.y - 24, 8, '#ff9ec7', { speed: 36, life: 0.9, size: 3, grav: -20 });
    this.floatText(m.x, m.y - 36, `+${gain} affinity`, '#ff9ec7', 11);
    if (m.affinity >= 100) {
      this.toast(`${m.name} is ready. Return to your Brood Nest to breed.`, 'pink', 5200);
      this.ringBurst(m.x, m.y, '#ff9ec7', 70, 2);
      this.checkQuests();
    } else if (m.affinity >= 50 && !this.courtToast50) {
      this.courtToast50 = true;
      this.toast(`${m.name} is warming to you.`, 'pink', 2800);
    }
    this.checkQuests();
  }

  spawnMate() {
    if (this.mate || !this.den || !this.den.modules.nest) return;
    const stage = Math.max(2, this.player.stage);
    const charm = this.player.genes.charm || 0;
    const pool = GENES.filter((g) => g.stage <= stage);
    const chosen = new Set();
    const count = Math.min(6, 2 + charm + (stage >= 3 ? 1 : 0));
    while (chosen.size < count && pool.length) {
      const g = pool[(Math.random() * pool.length) | 0];
      if (chosen.has(g.id)) continue;
      chosen.add(g.id);
    }
    const genes = {};
    for (const id of chosen) {
      const g = GENES.find((x) => x.id === id);
      let rank = 1;
      if (Math.random() < 0.25 + charm * 0.12 + stage * 0.05) rank++;
      if (Math.random() < 0.06 + charm * 0.04) rank++;
      genes[id] = Math.min(g.max, rank);
    }
    const hue = (this.player.hue + 100 + Math.random() * 160) % 360;
    this.mate = {
      name: this.pickName(),
      hue,
      genes,
      stage,
      affinity: 0,
      x: this.den.x + 55,
      y: this.den.y + 20,
      angle: Math.PI,
      phase: Math.random() * 9,
      wanderT: 0,
      wx: this.den.x + 45,
      wy: this.den.y + 35
    };
    this.mate.pheno = makePlayerPheno(genes, stage, hue, 4);
    this.mate.r = Math.max(10, this.mate.pheno.len * 0.32);
    this.mate.size = this.mate.pheno.scale;
    this.sound.heart();
    this.ringBurst(this.mate.x, this.mate.y, '#ff9ec7', 80, 2);
    this.toast(`A kindred has been drawn to your den. ${this.mate.name} waits nearby.`, 'pink', 6000);
    this.saveGame();
    this.checkQuests();
  }

  makeHeirPreview() {
    if (!this.mate) return null;
    const p = this.player;
    const m = this.mate;
    const stage = Math.max(1, p.stage - 1);
    const ids = new Set([...Object.keys(p.genes), ...Object.keys(m.genes)]);
    const genes = {};
    const upgraded = [];
    const hatchery = this.den ? (this.den.modules.hatchery || 0) : 0;
    const parental = p.genes.parental || 0;
    const chance = Math.min(0.78, 0.2 + hatchery * 0.12 + parental * 0.08);
    for (const id of ids) {
      const def = GENES.find((g) => g.id === id);
      if (!def) continue;
      const a = p.genes[id] || 0;
      const b = m.genes[id] || 0;
      let rank = Math.max(a, b);
      if (rank === 0) continue;
      if (rank < def.max && Math.random() < chance) {
        rank++;
        upgraded.push(id);
      }
      genes[id] = rank;
    }
    if (Math.random() < 0.16 + parental * 0.05) {
      const pool = GENES.filter((g) => g.stage <= Math.max(2, p.stage) && !genes[g.id]);
      if (pool.length) {
        const g = pool[(Math.random() * pool.length) | 0];
        genes[g.id] = 1;
        upgraded.push(g.id);
      }
    }
    const hue = Math.round((p.hue * 0.62 + m.hue * 0.38 + (Math.random() - 0.5) * 30 + 360) % 360);
    let name = this.pickName();
    let guard = 0;
    while (name === p.name && guard++ < 8) name = this.pickName();
    return { genes, hue, name, stage, upgraded };
  }

  breed() {
    if (!this.den || !this.den.modules.nest) {
      this.toast('You need a Brood Nest first.', '', 2600);
      return;
    }
    if (!this.mate || this.mate.affinity < 100) {
      this.toast('Your mate is not ready. Court them first with E.', 'pink', 3000);
      return;
    }
    if (this.player.food < 15) {
      this.toast('You need at least 15 food to breed.', '', 2600);
      return;
    }
    if (!this.heirPreview) this.heirPreview = this.makeHeirPreview();
    const prev = this.heirPreview;
    if (!prev) return;
    const stage = prev.stage;
    const cstats = deriveStats(prev.genes, stage, this.lineage);
    const heir = {
      name: prev.name,
      hue: prev.hue,
      genes: prev.genes,
      stage,
      pheno: makePlayerPheno(prev.genes, stage, prev.hue, 6),
      stats: cstats,
      maxHp: cstats.maxHp,
      hp: cstats.maxHp,
      x: this.den.x + (Math.random() - 0.5) * 70,
      y: this.den.y + 40 + Math.random() * 30,
      angle: 0, attackCd: 0, flash: 0, phase: Math.random() * 9,
      dead: false, respawnT: 0, stepT: 0, moving: false
    };
    heir.r = Math.max(10, heir.pheno.len * 0.32);
    if (this.companions.length >= 3) this.companions.shift();
    this.companions.push(heir);
    this.heirs.push({
      name: prev.name, hue: prev.hue, genes: prev.genes,
      generation: this.generation + 1, stage
    });
    this.generation++;
    this.lineage = Math.min(0.4, this.lineage + 0.04);
    this.recalcPlayer(true);
    this.stats.breeds++;
    this.player.food = Math.max(0, this.player.food - 15);
    this.mate.affinity = 0;
    this.mate.affinityReset = true;
    this.courtToast50 = false;
    this.gainXp(55);
    this.gainDNA(20, this.den.x, this.den.y - 60);
    this.sound.evolve();
    this.ringBurst(this.den.x, this.den.y, '#ffd479', 120, 3);
    this.particlesBurst(this.den.x, this.den.y - 15, 30, '#ffd6e8', { speed: 100, life: 1.1, size: 3, grav: -20 });
    this.toast(`${prev.name} hatched! Generation ${this.generation}. Legacy +4%.`, 'gold', 5600);
    this.heirPreview = this.makeHeirPreview();
    this.checkQuests();
    this.saveGame();
    this.updateAvatar();
    if (this.panel === 'breed') this.renderBreed();
  }

  foundDen() {
    if (this.den) return;
    if (!(this.player.genes.nest || 0)) {
      this.toast('You need the Nest Instinct gene first.', '', 3000);
      return;
    }
    const p = this.player;
    if (p.x < 200 || p.y < 200 || p.x > WORLD_SIZE - 200 || p.y > WORLD_SIZE - 200) {
      this.toast('Too close to the edge of the world for a den.', '', 2600);
      return;
    }
    for (const [ox, oy] of [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]]) {
      if (this.world.isWater(p.x + ox, p.y + oy)) {
        this.toast('A den needs dry ground. Step further from the water.', '', 3000);
        return;
      }
    }
    if (!this.takeCost(DEN_COST)) {
      this.toast(`Not enough materials — need ${this.costShortfall(DEN_COST)}.`, 'red', 3000);
      return;
    }
    this.den = { x: p.x, y: p.y, modules: {}, pulse: 0, foundedDay: this.day };
    this.world.clearArea(p.x, p.y, 140);
    this.sound.levelup();
    this.camera.shake = 9;
    this.ringBurst(p.x, p.y, '#ffd479', 150, 3);
    this.particlesBurst(p.x, p.y, 26, '#c7a56b', { speed: 90, life: 0.8, size: 3, grav: 80 });
    this.toast('Den founded. A place that is yours. Press B to build inside it.', 'gold', 5200);
    this.denShrineTimer = 0;
    this.checkAchievements();
    this.checkQuests();
    this.saveGame();
    this.renderBuild();
    this.updateHUD();
  }

  buildModule(id) {
    if (!this.den) return;
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) return;
    const rank = this.den.modules[id] || 0;
    if (rank >= mod.max) return;
    if (!this.canAfford(mod.cost)) {
      this.toast(`Not enough materials — need ${this.costShortfall(mod.cost)}.`, 'red', 3000);
      return;
    }
    this.takeCost(mod.cost);
    this.den.modules[id] = rank + 1;
    this.sound.levelup();
    this.camera.shake = 3;
    this.ringBurst(this.den.x, this.den.y, mod.id === 'shrine' ? '#ffd479' : '#9dffc4', 90, 2);
    this.particlesBurst(this.den.x, this.den.y - 10, 14, '#c7a56b', { speed: 60, life: 0.7, size: 2.5, grav: 60 });
    this.toast(`${mod.name} built${mod.max > 1 ? ` (${roman(rank + 1)})` : ''}.`, 'gold', 3600);
    if (id === 'nest') {
      this.spawnMate();
      this.toast('Your brood nest is ready. A kindred will find you.', 'pink', 4600);
    }
    if (id === 'walls') this.world.clearArea(this.den.x, this.den.y, this.denRadius() + 30);
    this.checkQuests();
    this.checkAchievements();
    this.saveGame();
    this.renderBuild();
    this.updateHUD();
  }

  restDen() {
    if (!this.den) return;
    const larder = this.den.modules.larder || 0;
    this.day++;
    this.tod = 0.22;
    this.stats.nights++;
    const p = this.player;
    p.hp = Math.min(this.pstats.maxHp, p.hp + this.pstats.maxHp * 0.55);
    p.stamina = 100;
    p.food = Math.min(100, p.food + 18 + larder * 18);
    p.water = Math.min(100, p.water + 12 + larder * 10);
    p.invuln = 3;
    for (const c of this.companions) {
      if (c.dead) { c.dead = false; c.respawnT = 0; c.x = p.x; c.y = p.y; }
      c.hp = c.maxHp;
    }
    this.particlesBurst(p.x, p.y, 18, '#ffd479', { speed: 40, life: 1.1, size: 2.5, grav: -15 });
    this.sound.levelup();
    this.closePanel();
    this.toast(`You sleep until dawn — Day ${this.day}. The den kept you safe.`, 'gold', 4800);
    this.gainXp(18);
    this.checkAchievements();
    this.saveGame();
  }

  /* ============================ RENDER ============================ */

  render(now) {
    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;
    if (!w || !h || !this.world || !this.player) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#07130f';
    ctx.fillRect(0, 0, w, h);

    const cam = this.camera;
    const zoom = cam.zoom;
    const shake = cam.shake;
    const shx = (Math.random() - 0.5) * shake;
    const shy = (Math.random() - 0.5) * shake;
    this.renderShake = { x: shx, y: shy };
    ctx.save();
    ctx.translate(w / 2 + shx, h / 2 + shy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);
    const rect = {
      x: cam.x - w / (2 * zoom) - 80,
      y: cam.y - h / (2 * zoom) - 80,
      w: w / zoom + 160,
      h: h / zoom + 160
    };

    if (this.den) this.drawDenGround(ctx, this.den);
    this.world.drawGround(ctx, rect);

    const drawables = [];
    const mincx = Math.max(0, Math.floor(rect.x / CHUNK));
    const maxcx = Math.min(MAPRES - 1, Math.floor((rect.x + rect.w) / CHUNK));
    const mincy = Math.max(0, Math.floor(rect.y / CHUNK));
    const maxcy = Math.min(MAPRES - 1, Math.floor((rect.y + rect.h) / CHUNK));
    for (let cy = mincy; cy <= maxcy; cy++) {
      for (let cx = mincx; cx <= maxcx; cx++) {
        for (const obj of this.world.getObjects(cx, cy)) {
          if (this.world.hidden.has(obj.id)) continue;
          if (obj.x < rect.x - 40 || obj.x > rect.x + rect.w + 40 || obj.y < rect.y - 80 || obj.y > rect.y + rect.h + 40) continue;
          drawables.push({ y: obj.y, kind: 'object', obj });
        }
      }
    }
    if (this.den) drawables.push({ y: this.den.y + 10, kind: 'den', obj: this.den });
    for (const c of this.corpses) {
      if (c.x < rect.x - 40 || c.x > rect.x + rect.w + 40 || c.y < rect.y - 40 || c.y > rect.y + rect.h + 40) continue;
      drawables.push({ y: c.y, kind: 'corpse', obj: c });
    }
    for (const n of this.npcs) {
      if (n.dead) continue;
      if (n.x < rect.x - 80 || n.x > rect.x + rect.w + 80 || n.y < rect.y - 80 || n.y > rect.y + rect.h + 80) continue;
      drawables.push({ y: n.y, kind: 'npc', obj: n });
    }
    for (const c of this.companions) {
      if (c.dead) continue;
      if (c.x < rect.x - 80 || c.x > rect.x + rect.w + 80 || c.y < rect.y - 80 || c.y > rect.y + rect.h + 80) continue;
      drawables.push({ y: c.y, kind: 'companion', obj: c });
    }
    if (this.mate) drawables.push({ y: this.mate.y, kind: 'mate', obj: this.mate });
    drawables.push({ y: this.player.y, kind: 'player', obj: this.player });
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d.kind === 'object') this.world.drawObject(ctx, d.obj, this.time);
      else if (d.kind === 'den') this.drawDen(ctx, d.obj);
      else if (d.kind === 'corpse') this.drawCorpse(ctx, d.obj);
      else if (d.kind === 'npc') this.drawNPC(ctx, d.obj);
      else if (d.kind === 'companion') this.drawCompanion(ctx, d.obj);
      else if (d.kind === 'mate') this.drawMate(ctx, d.obj);
      else if (d.kind === 'player') this.drawPlayer(ctx);
    }

    this.drawHealthBars(ctx, rect);
    this.drawClouds(ctx);
    this.drawSlashes(ctx);
    this.drawParticles(ctx);
    this.drawFloaters(ctx);
    ctx.restore();

    this.drawLighting(ctx, w, h);
    this.drawWeather(ctx, w, h);
    this.drawVignette(ctx, w, h);
  }

  drawPlayer(ctx) {
    const p = this.player;
    if (this.dead) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      drawCreature(ctx, p.x, p.y, p.angle + Math.PI * 0.5, p.pheno, this.time, { moving: false, flash: 0 });
      ctx.restore();
      return;
    }
    ctx.save();
    if (p.burrowT > 0) ctx.globalAlpha = 0.34;
    drawCreature(ctx, p.x, p.y, p.angle, p.pheno, this.time, {
      moving: p.moving, phase: 0, flash: p.flash, selected: true
    });
    ctx.restore();
    if (p.burrowT > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(180,145,95,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 24, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (p.invuln > 0 && this.dead === false) {
      ctx.save();
      ctx.globalAlpha = 0.18 + Math.sin(this.time * 18) * 0.08;
      ctx.strokeStyle = '#d6ffe8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.pheno.len * 0.7, p.pheno.wid * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawNPC(ctx, n) {
    const opts = {
      moving: n.moving, phase: n.phase, flash: n.flash
    };
    drawCreature(ctx, n.x, n.y, n.angle, n.pheno, this.time, opts);
    if (n.stun > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#b9f0ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(n.x, n.y - n.pheno.wid * 0.7, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (n.golden) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + Math.sin(this.time * 4) * 0.15;
      ctx.fillStyle = '#ffd86b';
      ctx.beginPath();
      ctx.arc(n.x, n.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawCompanion(ctx, c) {
    drawCreature(ctx, c.x, c.y, c.angle, c.pheno, this.time, {
      moving: c.moving, phase: c.phase, flash: c.flash
    });
    if (c.hp < c.maxHp) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#ff9ec7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 2, c.pheno.len * 0.5, c.pheno.wid * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawMate(ctx, m) {
    drawCreature(ctx, m.x, m.y, m.angle, m.pheno, this.time, { moving: m.moving, phase: m.phase, flash: 0 });
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = m.affinity >= 100 ? '#ff9ec7' : '#ffd0e2';
    ctx.font = '13px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.affinity >= 100 ? '♥' : '♡', m.x, m.y - m.pheno.wid * 0.9 - 8);
    ctx.restore();
  }

  drawDenGround(ctx, den) {
    const r = this.denRadius();
    ctx.save();
    const g = ctx.createRadialGradient(den.x, den.y, 8, den.x, den.y, r);
    g.addColorStop(0, 'rgba(110,82,48,.30)');
    g.addColorStop(0.55, 'rgba(72,60,38,.14)');
    g.addColorStop(1, 'rgba(60,50,35,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(den.x, den.y, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = '#ffd479';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([8, 13]);
    ctx.beginPath();
    ctx.ellipse(den.x, den.y, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawDen(ctx, den) {
    const x = den.x;
    const y = den.y;
    const m = den.modules;
    const t = this.time;
    const seed = (den.x * 13 + den.y * 7) % 1000;
    ctx.save();
    // entrance path
    ctx.fillStyle = 'rgba(122,96,56,.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 34, 24, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    // garden rows
    if (m.garden) {
      for (let i = 0; i < m.garden * 2 + 2; i++) {
        const gx = x - 92 + (i % 4) * 17 + (i > 3 ? 6 : 0);
        const gy = y - 8 + Math.floor(i / 4) * 17;
        ctx.strokeStyle = '#6b8d45';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(gx, gy + 6);
        ctx.quadraticCurveTo(gx - 2, gy, gx + Math.sin(t + i) * 1.5, gy - 7);
        ctx.stroke();
        ctx.fillStyle = i % 3 === 0 ? '#d95b6e' : '#8dbb5d';
        ctx.beginPath();
        ctx.arc(gx + Math.sin(t + i) * 1.5, gy - 7, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // shrine behind
    if (m.shrine) {
      const sx = x - 2;
      const sy = y - 66;
      ctx.fillStyle = '#6b5a48';
      ctx.fillRect(sx - 5, sy - 20, 10, 38);
      ctx.fillStyle = '#82705a';
      ctx.fillRect(sx - 3, sy - 20, 3, 36);
      ctx.fillStyle = '#e6d9bd';
      ctx.beginPath();
      ctx.arc(sx, sy - 25, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b3029';
      ctx.beginPath();
      ctx.arc(sx - 2.4, sy - 26, 1.5, 0, Math.PI * 2);
      ctx.arc(sx + 2.4, sy - 26, 1.5, 0, Math.PI * 2);
      ctx.fill();
      const glow = 0.45 + Math.sin(t * 2 + seed) * 0.2 + m.shrine * 0.05;
      ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(sx, sy - 20, 1, sx, sy - 20, 34 + m.shrine * 8);
      gg.addColorStop(0, `rgba(255,212,121,${glow * 0.32})`);
      gg.addColorStop(1, 'rgba(255,212,121,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(sx, sy - 20, 34 + m.shrine * 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // lookout
    if (m.lookout) {
      const lx = x + 70;
      const ly = y - 58;
      ctx.strokeStyle = '#6b5236';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lx, y + 4);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.fillStyle = '#d9b06d';
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 24, ly + 7 + Math.sin(t * 2.2) * 2);
      ctx.lineTo(lx, ly + 17);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,50,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, ly - 2);
      ctx.lineTo(lx - 14, y + 2);
      ctx.stroke();
    }

    // palisade
    const walls = m.walls || 0;
    if (walls) {
      const count = 22;
      const radius = 76 + walls * 8;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        if (a > 1.12 && a < 2.03) continue;
        const px = x + Math.cos(a) * radius;
        const py = y + Math.sin(a) * radius * 0.78;
        const h = 17 + (i % 3) * 4;
        ctx.strokeStyle = i % 2 ? '#6e4f31' : '#83613c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px, py + 6);
        ctx.lineTo(px, py - h);
        ctx.stroke();
        ctx.fillStyle = '#a58251';
        ctx.beginPath();
        ctx.moveTo(px - 2.5, py - h);
        ctx.lineTo(px, py - h - 4);
        ctx.lineTo(px + 2.5, py - h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(80,58,35,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * 0.78, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // nest
    if (m.nest) {
      ctx.fillStyle = '#5e4528';
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 37, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a4834c';
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 33, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6c532f';
      ctx.beginPath();
      ctx.ellipse(x, y + 3, 25, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c5a265';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + seed;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 16, y + Math.sin(a) * 10);
        ctx.lineTo(x + Math.cos(a) * 31, y + Math.sin(a) * 19);
        ctx.stroke();
      }
      const eggCount = this.mate && this.mate.affinity >= 100 ? 3 : 2;
      for (let i = 0; i < eggCount; i++) {
        const ex = x - 8 + i * 8;
        const ey = y + 3 + (i % 2) * 4;
        ctx.fillStyle = '#f3e5c9';
        ctx.beginPath();
        ctx.ellipse(ex, ey, 4.6, 6.2, 0.12 * (i - 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(140,110,70,.5)';
        ctx.beginPath(); ctx.arc(ex - 1, ey - 1, 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + 1.4, ey + 1.5, 0.7, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // simple sleeping hollow before the nest is built
      ctx.fillStyle = 'rgba(103,80,48,.5)';
      ctx.beginPath();
      ctx.ellipse(x, y + 5, 26, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // larder
    if (m.larder) {
      const lx = x + 48;
      const ly = y + 12;
      ctx.strokeStyle = '#6c4e31';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(lx - 14, ly + 10); ctx.lineTo(lx - 14, ly - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx + 14, ly + 10); ctx.lineTo(lx + 14, ly - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx - 17, ly - 15); ctx.lineTo(lx + 17, ly - 15); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 1 ? '#b85d4b' : '#c17c57';
        ctx.beginPath();
        ctx.ellipse(lx - 8 + i * 8, ly - 9, 3.4, 6 + i, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // hatchery
    if (m.hatchery) {
      const hx = x - 52;
      const hy = y + 26;
      ctx.fillStyle = '#6d655b';
      ctx.beginPath(); ctx.ellipse(hx, hy, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.fillStyle = '#8e8578';
        ctx.beginPath(); ctx.arc(hx + Math.cos(a) * 19, hy + Math.sin(a) * 10, 3.2, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#f3e5c9';
        ctx.beginPath();
        ctx.ellipse(hx - 7 + i * 7, hy - 2 + (i % 2) * 3, 3.6, 5, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      const pulse = 0.2 + Math.sin(t * 2.4) * 0.1;
      ctx.globalCompositeOperation = 'lighter';
      const hg = ctx.createRadialGradient(hx, hy, 2, hx, hy, 34);
      hg.addColorStop(0, `rgba(255,220,160,${pulse})`);
      hg.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(hx, hy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    // small fire near the den if it has a shrine or larder
    if (m.shrine || m.larder) {
      const fx = x + 24;
      const fy = y + 30;
      ctx.fillStyle = '#4b3a2a';
      ctx.beginPath(); ctx.ellipse(fx, fy, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
      const flick = 0.7 + Math.sin(t * 11 + seed) * 0.25;
      ctx.fillStyle = '#ffb35c';
      ctx.beginPath();
      ctx.moveTo(fx - 4, fy - 2);
      ctx.quadraticCurveTo(fx - 1, fy - 14 * flick, fx + 1, fy - 4);
      ctx.quadraticCurveTo(fx + 4, fy - 13, fx + 5, fy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe38a';
      ctx.beginPath();
      ctx.moveTo(fx - 2, fy - 2);
      ctx.quadraticCurveTo(fx, fy - 8 * flick, fx + 2, fy - 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawCorpse(ctx, c) {
    const alpha = c.decay < 15 ? clamp(c.decay / 15, 0.2, 1) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(8,18,14,.22)';
    ctx.beginPath(); ctx.ellipse(4, 6, c.size * 20, c.size * 7, c.angle, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(c.angle);
    ctx.fillStyle = c.color2;
    ctx.beginPath(); ctx.ellipse(0, 0, c.size * 20, c.size * 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.color1;
    ctx.beginPath(); ctx.ellipse(0, -1, c.size * 15, c.size * 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(240,230,205,.6)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5, -c.size * 5);
      ctx.lineTo(i * 5 + 2, c.size * 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHealthBars(ctx, rect) {
    for (const n of this.npcs) {
      if (n.dead) continue;
      if (n.hp >= n.maxHp && !n.boss) continue;
      if (n.x < rect.x || n.x > rect.x + rect.w || n.y < rect.y || n.y > rect.y + rect.h) continue;
      const w = clamp(n.pheno.len * 0.95, 26, 90);
      const y = n.y - n.pheno.wid * 0.8 - 20;
      const frac = clamp(n.hp / n.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(4,10,7,.72)';
      ctx.fillRect(n.x - w / 2, y, w, 4);
      ctx.fillStyle = n.boss ? '#ff5a45' : n.role === 'predator' ? '#ff7a5a' : '#87d46c';
      ctx.fillRect(n.x - w / 2, y, w * frac, 4);
      if (n.boss) {
        ctx.fillStyle = '#ffd7c9';
        ctx.font = '700 7px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('THE HOLLOW KING', n.x, y - 4);
      }
    }
    for (const c of this.companions) {
      if (c.dead || c.hp >= c.maxHp) continue;
      const w = 32;
      const y = c.y - c.pheno.wid * 0.8 - 16;
      ctx.fillStyle = 'rgba(4,10,7,.72)';
      ctx.fillRect(c.x - w / 2, y, w, 3);
      ctx.fillStyle = '#ff9ec7';
      ctx.fillRect(c.x - w / 2, y, w * clamp(c.hp / c.maxHp, 0, 1), 3);
    }
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const frac = clamp(p.life / p.max, 0, 1);
      const alpha = frac * p.alpha;
      if (alpha <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.type === 'ring') {
        const r = p.size + (1 - frac) * p.grow;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width || 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'firefly') {
        ctx.globalCompositeOperation = 'lighter';
        const pulse = 0.65 + Math.sin(this.time * 3 + p.x * 0.1) * 0.35;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8 * pulse, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'heart') {
        ctx.fillStyle = p.color;
        ctx.font = `${p.size * 3}px "Trebuchet MS", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('♥', p.x, p.y);
      } else if (p.type === 'spark' || p.type === 'bolt') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width || 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.014, p.y - p.vy * 0.014);
        ctx.stroke();
      } else if (p.type === 'bubble') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'smoke') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else if (p.type === 'wing') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 1.8, p.size * 0.6, p.rot, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + frac * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawFloaters(ctx) {
    for (const f of this.floaters) {
      const frac = clamp(f.life / f.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = clamp(frac * 1.4, 0, 1);
      ctx.font = `700 ${f.size}px "Trebuchet MS", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3,10,6,.7)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  drawClouds(ctx) {
    for (const c of this.clouds) {
      const frac = 1 - c.t / c.max;
      ctx.save();
      const g = ctx.createRadialGradient(c.x, c.y, 8, c.x, c.y, c.r);
      g.addColorStop(0, `rgba(110,255,130,${0.16 * frac})`);
      g.addColorStop(0.7, `rgba(70,200,90,${0.08 * frac})`);
      g.addColorStop(1, 'rgba(40,150,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSlashes(ctx) {
    for (const s of this.slashes) {
      const frac = clamp(1 - s.t / s.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = frac * 0.8;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.range * 0.82, s.angle - 0.95, s.angle + 0.95);
      ctx.stroke();
      ctx.globalAlpha = frac * 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.range * 0.95, s.angle - 0.7, s.angle + 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ============================ SIMULATION EXTRAS ============================ */

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      const drag = Math.pow(p.drag != null ? p.drag : 0.98, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.rot += (p.vr || 0) * dt;
    }
    if (this.particles.length) this.particles = this.particles.filter((p) => p.life > 0);

    for (const f of this.floaters) {
      f.life -= dt;
      f.x += (f.vx || 0) * dt;
      f.y += (f.vy || 0) * dt;
      f.vy *= Math.pow(0.965, dt * 60);
    }
    if (this.floaters.length) this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  /* ============================ LIGHT, WEATHER & MAPS ============================ */

  worldToScreen(x, y) {
    return {
      x: this.viewW / 2 + (x - this.camera.x) * this.camera.zoom,
      y: this.viewH / 2 + (y - this.camera.y) * this.camera.zoom
    };
  }

  drawLighting(ctx, w, h) {
    if (!this.player) return;
    const night = this.nightAmount();
    const nv = (this.player.genes.nightvision || 0) > 0;
    const bio = (this.player.genes.biolum || 0) > 0;
    const storm = this.weather.type === 'storm' ? this.weather.intensity * 0.2 : 0;
    const darkness = clamp(night * (nv ? 0.34 : bio ? 0.58 : 0.79) + storm, 0, 0.86);
    if (darkness <= 0.015) return;
    const s = this.worldToScreen(this.player.x, this.player.y);
    const radius = (nv ? 430 : bio ? 290 : 230) * this.camera.zoom;
    const g = ctx.createRadialGradient(s.x, s.y, 12, s.x, s.y, radius);
    g.addColorStop(0, 'rgba(7,15,27,0)');
    g.addColorStop(0.42, `rgba(7,15,27,${darkness * 0.2})`);
    g.addColorStop(0.8, `rgba(5,11,22,${darkness * 0.82})`);
    g.addColorStop(1, `rgba(3,8,17,${darkness})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (bio && night > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      const hueGlow = hsl(this.player.hue + 80, 90, 60, 0.09);
      const gg = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 120 * this.camera.zoom);
      gg.addColorStop(0, hueGlow);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 120 * this.camera.zoom, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawWeather(ctx, w, h) {
    const weather = this.weather;
    if (!weather) return;
    const amount = weather.intensity;
    if (amount > 0.01) {
      if (weather.type === 'storm') {
        ctx.save();
        ctx.fillStyle = `rgba(5,10,20,${0.16 * amount})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (weather.type === 'fog') {
        ctx.save();
        ctx.fillStyle = `rgba(198,211,201,${0.06 * amount})`;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 5; i++) {
          const t = this.time * (0.018 + i * 0.006) + i * 1.7;
          const x = w * (0.15 + 0.7 * ((i / 5 + t * 0.05) % 1));
          const y = h * (0.2 + ((i * 0.22 + Math.sin(t) * 0.08 + 1) % 1) * 0.62);
          const r = Math.max(w, h) * (0.24 + (i % 3) * 0.06);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(220,229,219,${0.11 * amount})`);
          g.addColorStop(0.55, `rgba(205,216,206,${0.05 * amount})`);
          g.addColorStop(1, 'rgba(190,205,195,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      if (weather.type === 'rain' || weather.type === 'storm') {
        ctx.save();
        ctx.strokeStyle = `rgba(174,211,228,${0.18 + amount * 0.3})`;
        ctx.lineWidth = weather.type === 'storm' ? 1.3 : 1;
        ctx.beginPath();
        for (const drop of this.rain) {
          ctx.moveTo(drop.x, drop.y);
          const drift = (weather.type === 'storm' ? 0.12 : 0.05) * drop.len;
          ctx.lineTo(drop.x - drift, drop.y - drop.len);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    if (this.lightning > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(226,242,255,${clamp(this.lightning, 0, 1) * 0.28})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  drawVignette(ctx, w, h) {
    if (!this.vignette || this.vignette.w !== w || this.vignette.h !== h) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.3, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.68, 'rgba(2,8,6,0.08)');
      g.addColorStop(1, 'rgba(1,5,4,0.48)');
      this.vignette = { w, h, g };
    }
    ctx.save();
    ctx.fillStyle = this.vignette.g;
    ctx.fillRect(0, 0, w, h);
    if (this.hurtFlash > 0.01) {
      const hf = this.hurtFlash;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.24, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(120,8,20,0)');
      g.addColorStop(1, `rgba(145,12,28,${hf * 0.38})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  ensureMapFog() {
    if (!this.mapTmp) {
      this.mapTmp = document.createElement('canvas');
      this.mapTmp.width = MAPRES;
      this.mapTmp.height = MAPRES;
      this.mapTmpCtx = this.mapTmp.getContext('2d');
      this._fogVersion = -1;
    }
    if (!this.mapTmpCtx) this.mapTmpCtx = this.mapTmp.getContext('2d');
    if (this._fogVersion !== this.explored.size) {
      this._fogVersion = this.explored.size;
      const img = this.mapTmpCtx.createImageData(MAPRES, MAPRES);
      const d = img.data;
      for (let i = 0; i < MAPRES * MAPRES; i++) {
        const j = i * 4;
        if (this.explored.has(i)) {
          d[j + 3] = 0;
        } else {
          d[j] = 3;
          d[j + 1] = 11;
          d[j + 2] = 8;
          d[j + 3] = 238;
        }
      }
      this.mapTmpCtx.putImageData(img, 0, 0);
    }
    return this.mapTmp;
  }

  drawMapCanvas(canvas, cx, cy, span, opts = {}) {
    if (!canvas || !this.world || !this.world.mapBase) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#06140f';
    ctx.fillRect(0, 0, w, h);

    let left;
    let top;
    let rw;
    let rh;
    if (opts.whole) {
      left = 0;
      top = 0;
      rw = WORLD_SIZE;
      rh = WORLD_SIZE;
    } else {
      rw = span;
      rh = span * (h / w);
      left = clamp(cx - rw / 2, 0, Math.max(0, WORLD_SIZE - rw));
      top = clamp(cy - rh / 2, 0, Math.max(0, WORLD_SIZE - rh));
    }
    const sx = (left / WORLD_SIZE) * MAPRES;
    const sy = (top / WORLD_SIZE) * MAPRES;
    const sw = (rw / WORLD_SIZE) * MAPRES;
    const sh = (rh / WORLD_SIZE) * MAPRES;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.world.mapBase, sx, sy, sw, sh, 0, 0, w, h);
    const fog = this.ensureMapFog();
    ctx.drawImage(fog, sx, sy, sw, sh, 0, 0, w, h);

    const px = (wx) => ((wx - left) / rw) * w;
    const py = (wy) => ((wy - top) / rh) * h;
    const inView = (wx, wy) => wx >= left && wx <= left + rw && wy >= top && wy <= top + rh;

    if (opts.whole) {
      ctx.save();
      ctx.strokeStyle = 'rgba(160,230,190,.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const x = (i / 8) * w;
        const y = (i / 8) * h;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.restore();
    }

    for (const lm of this.landmarks) {
      if (!inView(lm.x, lm.y)) continue;
      const x = px(lm.x);
      const y = py(lm.y);
      ctx.save();
      ctx.fillStyle = '#8ef0d0';
      ctx.strokeStyle = 'rgba(3,10,7,.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (this.den && inView(this.den.x, this.den.y)) {
      const x = px(this.den.x);
      const y = py(this.den.y);
      ctx.save();
      ctx.fillStyle = '#ffd479';
      ctx.strokeStyle = 'rgba(4,10,7,.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, opts.whole ? 6 : 5, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5b3d13';
      ctx.beginPath();
      ctx.arc(x, y, opts.whole ? 2.5 : 2, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    if (this.mate && inView(this.mate.x, this.mate.y)) {
      ctx.fillStyle = '#ff9ec7';
      ctx.beginPath();
      ctx.arc(px(this.mate.x), py(this.mate.y), 3.2, 0, TAU);
      ctx.fill();
    }

    if (this.player) {
      const x = px(this.player.x);
      const y = py(this.player.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(this.player.angle);
      ctx.fillStyle = '#eafff2';
      ctx.strokeStyle = 'rgba(3,12,8,.88)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(opts.whole ? 8 : 7, 0);
      ctx.lineTo(-5, 5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, -5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (opts.whole) {
        ctx.save();
        ctx.strokeStyle = 'rgba(230,255,240,.32)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (opts.whole) {
      ctx.save();
      ctx.font = '700 12px "Trebuchet MS", sans-serif';
      ctx.fillStyle = 'rgba(6,20,15,.65)';
      ctx.beginPath(); ctx.arc(23, 23, 15, 0, TAU); ctx.fill();
      ctx.fillStyle = '#bfe9d0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', 23, 23);
      ctx.restore();
    }
  }

  updateMinimap() {
    const c = $('minimap');
    if (!c || !this.player) return;
    this.drawMapCanvas(c, this.player.x, this.player.y, 2300);
  }

  drawBigMap() {
    const c = $('bigmap');
    if (!c || !this.world) return;
    if (c.width !== 1000) {
      c.width = 1000;
      c.height = 820;
    }
    this.drawMapCanvas(c, WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE, { whole: true });
  }

  drawPanelPreviews() {
    if (this.panel === 'mutations') {
      const cv = $('preview-canvas');
      if (cv && this.player.pheno) drawCreaturePreview(cv, this.player.pheno, this.now);
    } else if (this.panel === 'breed') {
      if (this.mate && this.mate.pheno) {
        const cv = $('mate-canvas');
        if (cv) drawCreaturePreview(cv, this.mate.pheno, this.now);
      }
      const prev = this.heirPreview;
      if (prev) {
        const cv = $('heir-canvas');
        if (cv) {
          if (!this._heirPheno || this._heirPreviewRef !== prev) {
            this._heirPheno = makePlayerPheno(prev.genes, prev.stage, prev.hue, 8);
            this._heirPreviewRef = prev;
          }
          drawCreaturePreview(cv, this._heirPheno, this.now);
        }
      }
    }
  }

  /* ============================ HUD & PROMPTS ============================ */

  geneCost(gene, rank) {
    return Math.round(gene.cost * (1 + rank * 0.4));
  }

  updateHUD() {
    if (!this.player || !this.pstats) return;
    const p = this.player;
    const s = this.pstats;
    const stage = STAGES[p.stage - 1] || STAGES[0];
    const next = STAGES[p.stage];
    const cache = this._hudCache || (this._hudCache = {});
    const txt = (id, value) => {
      if (cache[id] === value) return;
      cache[id] = value;
      const el = $(id);
      if (el) el.textContent = value;
    };
    const width = (id, value) => {
      if (cache[id] === value) return;
      cache[id] = value;
      const el = $(id);
      if (el) el.style.width = value;
    };
    const pct = (value, max) => `${clamp((value / Math.max(1, max)) * 100, 0, 100).toFixed(1)}%`;

    txt('player-name', p.name);
    txt('gen', `GEN ${this.generation}`);
    txt('stage-name', stage.name);
    txt('stage-num', `Stage ${roman(p.stage)}`);
    const xpFrac = next ? clamp((p.xp - stage.xp) / Math.max(1, next.xp - stage.xp), 0, 1) : 1;
    width('xp-fill', `${(xpFrac * 100).toFixed(1)}%`);
    txt('xp-text', next ? `${Math.round(p.xp - stage.xp)} / ${next.xp - stage.xp} XP` : `${Math.round(p.xp)} XP · MAX`);

    txt('hp-text', String(Math.max(0, Math.round(p.hp))));
    txt('stamina-text', String(Math.round(p.stamina)));
    txt('food-text', String(Math.round(p.food)));
    txt('water-text', String(Math.round(p.water)));
    width('hp-fill', pct(p.hp, s.maxHp));
    width('stamina-fill', pct(p.stamina, 100));
    width('food-fill', pct(p.food, 100));
    width('water-fill', pct(p.water, 100));

    const hpBar = document.querySelector('.bar.hp');
    if (hpBar) hpBar.classList.toggle('low', p.hp / s.maxHp < 0.3);
    const low = $('low-health');
    if (low) low.style.opacity = p.hp / s.maxHp < 0.3 ? String(0.55 + Math.sin(this.now * 4) * 0.16) : '0';

    txt('dna-count', String(Math.round(p.dna)));
    const biome = this.world.biomeAt(p.x, p.y);
    txt('biome-name', BIOMES[biome] ? BIOMES[biome].name : 'Unknown');
    txt('clock', fmtClock(this.tod));
    const wi = WEATHER_INFO[this.weather.type] || WEATHER_INFO.clear;
    txt('weather', `${wi.icon} ${wi.name}`);
    txt('day', `Day ${this.day}`);

    const linen = this.lineageCard || (this.lineageCard = $('lineage-card'));
    if (linen) {
      const show = this.generation > 1 || this.heirs.length > 0;
      linen.classList.toggle('hidden', !show);
      if (show) {
        txt('lineage-gen', `Gen ${this.generation}`);
        txt('lineage-bonus', `+${Math.round(this.lineage * 100)}% legacy`);
        txt('heir-count', `${this.heirs.length} ${this.heirs.length === 1 ? 'heir' : 'heirs'}`);
      }
    }

    const q = QUESTS[this.questIndex];
    if (q) {
      let progress = 0;
      try { progress = q.progress(this); } catch { progress = 0; }
      txt('quest-count', `${Math.min(this.questIndex + 1, QUESTS.length)}/${QUESTS.length}`);
      txt('quest-title', q.title);
      txt('quest-text', q.text);
      width('quest-fill', `${clamp(progress / q.goal, 0, 1) * 100}%`);
      txt('quest-hint', this.questHint());
    } else {
      txt('quest-count', `${QUESTS.length}/${QUESTS.length}`);
      txt('quest-title', 'World Without End');
      txt('quest-text', 'Every objective is complete. The world is yours to shape.');
      width('quest-fill', '100%');
      txt('quest-hint', 'Keep exploring. Your lineage can still grow.');
    }

    const info = ABILITY_INFO[s.ability] || ABILITY_INFO.roar;
    const short = { roar: 'Roar', pulse: 'Pulse', cloud: 'Cloud', dash: 'Dash', burrow: 'Burrow' }[s.ability] || 'Roar';
    txt('hotbar-ability', short);
    const cd = $('ability-cd');
    if (cd) cd.style.transform = `scaleY(${clamp(p.abilityCd / Math.max(0.01, p.abilityMax), 0, 1)})`;

    if (!this._promptAt || this.now - this._promptAt > 0.12) {
      this._promptAt = this.now;
      this.updatePrompt();
    }
    if (!this._avatarAt || this.now - this._avatarAt > 0.3) {
      this._avatarAt = this.now;
      this.updateAvatar();
    }
    if (!this._minimapAt || this.now - this._minimapAt > 0.42) {
      this._minimapAt = this.now;
      this.updateMinimap();
    }
    if (!this._panelPreviewAt || this.now - this._panelPreviewAt > 0.1) {
      this._panelPreviewAt = this.now;
      this.drawPanelPreviews();
    }
  }

  updatePrompt() {
    const el = $('prompt');
    if (!el) return;
    if (!this.started || this.dead || this.panel) {
      el.classList.add('hidden');
      this.interaction = null;
      return;
    }
    const it = this.getInteraction();
    this.interaction = it;
    if (!it) {
      el.classList.add('hidden');
      return;
    }
    const text = $('prompt-text');
    if (text && text.textContent !== it.label) text.textContent = it.label;
    el.classList.toggle('alt', it.type === 'den' || it.type === 'mate');
    el.classList.remove('hidden');
  }

  updateAvatar() {
    const c = $('avatar');
    if (!c || !this.player || !this.player.pheno) return;
    drawCreaturePreview(c, this.player.pheno, this.now);
  }

  /* ============================ PANELS ============================ */

  openPanel(type) {
    if (!this.started || this.dead) return;
    this.panel = type;
    this.keys.clear();
    this.joystick = { x: 0, y: 0, active: false };
    const stick = $('stick');
    if (stick) stick.style.transform = 'translate(-50%, -50%)';
    const modal = $('modal');
    if (modal) modal.classList.remove('hidden');
    if (type === 'mutations') this.renderMutations();
    else if (type === 'build') this.renderBuild();
    else if (type === 'breed') this.renderBreed();
    else if (type === 'journal') this.renderJournal();
    else if (type === 'map') this.renderMapPanel();
    else if (type === 'pause') this.renderPause();
    this.sound.ui();
  }

  closePanel() {
    const prev = this.panel;
    this.panel = null;
    const modal = $('modal');
    if (modal) modal.classList.add('hidden');
    if (prev === 'breed') {
      this.heirPreview = null;
      this._heirPheno = null;
      this._heirPreviewRef = null;
    }
    this.sound.ui();
  }

  openMutations() { this.openPanel('mutations'); }
  openBuild() { this.openPanel('build'); }
  openBreed() { this.openPanel('breed'); }
  openJournal() { this.openPanel('journal'); }
  openMap() { this.openPanel('map'); }
  openPause() { this.openPanel('pause'); }

  materialRow() {
    const cells = Object.entries(MATERIALS).map(([key, m]) => (
      `<div class="mat"><span>${m.icon}</span><b>${this.materials[key] || 0}</b><span>${m.name}</span></div>`
    )).join('');
    return `<div class="mat-row">${cells}</div>`;
  }

  statCell(label, value, width) {
    return `<div class="stat"><span>${label}</span><b>${value}</b><i style="--w:${clamp(width, 0, 1) * 100}%"></i></div>`;
  }

  renderMutations() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'Evolution';
    if (sub) sub.textContent = 'Spend DNA to reshape your body. Every rank is permanent.';
    if (!this.mutationCat) this.mutationCat = 'all';
    const p = this.player;
    const s = this.pstats;
    const cat = this.mutationCat;
    const cats = [{ id: 'all', name: 'All Genes', icon: '🧬' }, ...CATEGORIES];
    const tabs = cats.map((c) => (
      `<button data-cat="${c.id}" class="${cat === c.id ? 'active' : ''}">${c.icon || ''} ${c.name}</button>`
    )).join('');
    const genes = GENES.filter((g) => cat === 'all' || g.cat === cat);
    const maxStat = { hp: Math.max(1, s.maxHp), speed: 260, dmg: 60, armor: 0.55, vision: 1000, regen: 1.2 };
    const cards = genes.map((g) => {
      const rank = p.genes[g.id] || 0;
      const stageOk = g.stage <= p.stage;
      const maxed = rank >= g.max;
      const cost = this.geneCost(g, rank);
      const afford = p.dna >= cost;
      const cls = maxed ? 'maxed' : !stageOk ? 'locked' : afford ? 'can-buy' : 'broke';
      const costLabel = maxed
        ? '<span class="g-cost max-label">MAX</span>'
        : !stageOk
          ? `<span class="g-cost locked-label">Stage ${roman(g.stage)}</span>`
          : `<span class="g-cost">${cost} DNA</span>`;
      const showRank = maxed ? rank : Math.min(g.max, rank + 1);
      const pips = Array.from({ length: g.max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      return `
        <button class="gene-card ${cls}" data-buy="${g.id}" style="--c:${g.color}">
          <div class="g-head">
            <div class="g-icon">${g.icon}</div>
            <div class="g-title"><h3>${g.name}</h3><div class="cat">${CATEGORIES.find((c) => c.id === g.cat)?.name || g.cat}</div></div>
            <span class="g-rank">${rank}/${g.max}</span>
          </div>
          <p class="g-blurb">${g.blurb}</p>
          <div class="g-pips">${pips}</div>
          <div class="g-foot">
            <span class="g-effect">${g.effect(showRank)}</span>
            ${costLabel}
          </div>
        </button>`;
    }).join('');

    body.innerHTML = `
      <div class="mut-hero">
        <div class="preview-card">
          <canvas id="preview-canvas" width="300" height="150"></canvas>
          <div class="preview-info">
            <div class="preview-name"><b>${p.name}</b><span>${STAGES[p.stage - 1].name}</span></div>
            <div class="stat-grid" style="margin-top:8px">
              ${this.statCell('Health', Math.round(s.maxHp), s.maxHp / maxStat.hp)}
              ${this.statCell('Speed', s.speed, (s.speed - 90) / (maxStat.speed - 90))}
              ${this.statCell('Damage', s.damage.toFixed(1), s.damage / maxStat.dmg)}
              ${this.statCell('Armor', Math.round(s.armor * 100) + '%', s.armor / maxStat.armor)}
              ${this.statCell('Vision', Math.round(s.vision), (s.vision - 400) / (maxStat.vision - 400))}
              ${this.statCell('Regen', s.regen.toFixed(2), s.regen / maxStat.regen)}
            </div>
          </div>
        </div>
        <div class="mut-summary">
          <div class="dna-big">${Math.round(p.dna)}<small>DNA AVAILABLE</small></div>
          <h3>${cat === 'all' ? 'The whole genome' : CATEGORIES.find((c) => c.id === cat)?.name + ' genes'}</h3>
          <p>${this.stats.mutations} mutations expressed · Generation ${this.generation} · Legacy +${Math.round(this.lineage * 100)}%. Higher stages unlock deeper, stranger genes.</p>
          <p style="color:#ffd479">Stage ${roman(p.stage)} ${STAGES[p.stage - 1].name}${p.stage < 5 ? ` · next evolution at ${STAGES[p.stage].xp} XP` : ' · final evolution reached'}.</p>
        </div>
      </div>
      <div class="cat-tabs">${tabs}</div>
      <div class="gene-grid">${cards}</div>`;
    this.drawPanelPreviews();
  }

  buyGene(id) {
    const g = GENES.find((x) => x.id === id);
    if (!g || !this.player) return;
    const rank = this.player.genes[id] || 0;
    if (g.stage > this.player.stage) {
      this.toast(`${g.name} needs Stage ${roman(g.stage)}. Keep growing.`, '', 2800);
      this.sound.error();
      return;
    }
    if (rank >= g.max) {
      this.toast(`${g.name} is already fully expressed.`, '', 2200);
      return;
    }
    const cost = this.geneCost(g, rank);
    if (this.player.dna < cost) {
      this.toast(`Not enough DNA — ${cost - Math.floor(this.player.dna)} more needed.`, 'red', 2400);
      this.sound.error();
      return;
    }
    this.player.dna -= cost;
    this.player.genes[id] = rank + 1;
    this.stats.mutations++;
    this.recalcPlayer(true);
    this.heirPreview = null;
    this._heirPheno = null;
    this._heirPreviewRef = null;
    this.sound.evolve();
    this.sound.tone(820, 0.14, 'sine', 0.06, 180);
    this.ringBurst(this.player.x, this.player.y, g.color, 60, 2);
    this.particlesBurst(this.player.x, this.player.y, 12, g.color, { speed: 70, life: 0.7, size: 2.4, grav: -20 });
    this.floatText(this.player.x, this.player.y - 38, `${g.name} ${roman(rank + 1)}`, g.color, 13);
    this.toast(`${g.name} ${roman(rank + 1)} — ${g.effect(rank + 1)}`, 'purple', 3400);
    this.gainXp(4);
    this.checkQuests();
    this.checkAchievements();
    this.saveGame();
    const body = $('panel-body');
    const scroll = body ? body.scrollTop : 0;
    this.renderMutations();
    if (body) body.scrollTop = scroll;
    this.updateAvatar();
    this.updateHUD();
  }

  renderBuild() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'Den & Craft';
    if (sub) sub.textContent = 'A place that is yours. Build it one branch at a time.';
    if (!this.den) {
      const nestRank = this.player.genes.nest || 0;
      const afford = this.canAfford(DEN_COST);
      const missing = this.costShortfall(DEN_COST);
      const cost = Object.entries(DEN_COST).map(([k, v]) => `${v} ${MATERIALS[k].name}`).join(' · ');
      body.innerHTML = `
        ${this.materialRow()}
        <div class="den-banner">
          <div class="big-icon">🏕</div>
          <div>
            <h3>No den yet</h3>
            <p>${nestRank
              ? 'Find dry ground away from water and lay the first stones. Your den becomes a safe place to heal, build, breed and rest.'
              : 'The Nest Instinct gene is still dormant. Open the genome tree and unlock it in the Social branch.'}</p>
          </div>
          <div class="spacer"></div>
          ${nestRank
            ? `<button class="panel-btn gold" data-act="found-den" ${afford ? '' : 'disabled'}>Found Den</button>`
            : '<button class="panel-btn" data-act="open-mutations">Open Genome</button>'}
        </div>
        <div class="empty-state">
          <b>Founding cost</b>
          ${cost}<br />
          ${afford ? 'You carry everything you need. Stand on dry land and press B.' : `Still needed: ${missing}. Trees, rocks and reeds can be gathered with E.`}
        </div>
        <p class="breed-note" style="margin-top:14px">Gather wood from oaks and pines, stone from rocks, and fiber from reeds and willows. Your den clears a safe circle of ground.</p>`;
      return;
    }
    const den = this.den;
    const modulesBuilt = Object.values(den.modules || {}).reduce((a, b) => a + b, 0);
    const cards = MODULES.map((mod) => {
      const rank = den.modules[mod.id] || 0;
      const maxed = rank >= mod.max;
      const afford = this.canAfford(mod.cost);
      const cls = maxed ? 'maxed' : rank > 0 ? 'built' : '';
      const costBits = Object.entries(mod.cost).map(([k, v]) => {
        const enough = (this.materials[k] || 0) >= v;
        return `<b style="color:${enough ? '#eaf7ef' : '#ff6b7a'}">${v}${MATERIALS[k].icon}</b>`;
      }).join(' ');
      return `
        <div class="module-card ${cls}">
          <div class="mc-head">
            <span class="mic">${mod.icon}</span>
            <h3>${mod.name}</h3>
            <span class="rank">${rank}/${mod.max}</span>
          </div>
          <p>${mod.desc}</p>
          <span class="effect">${mod.effect(Math.max(1, maxed ? rank : rank + 1))}</span>
          <div class="mc-foot">
            <span class="mc-cost">${maxed ? 'Fully built' : `Cost ${costBits}`}</span>
            <button class="panel-btn ${maxed ? '' : 'primary'}" data-mod="${mod.id}" ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'Complete' : rank ? 'Upgrade' : 'Build'}</button>
          </div>
        </div>`;
    }).join('');
    body.innerHTML = `
      ${this.materialRow()}
      <div class="den-banner">
        <div class="big-icon">🏕</div>
        <div>
          <h3>Your den · founded day ${den.foundedDay || 1}</h3>
          <p>${modulesBuilt} improvements built · ${Math.round(this.denRadius())} paces of safe ground. Predators hesitate at its edge.</p>
        </div>
        <div class="spacer"></div>
        ${den.modules.nest ? '<button class="panel-btn pink" data-act="open-breed">Breeding</button>' : ''}
        <button class="panel-btn gold" data-act="rest">Sleep until dawn</button>
      </div>
      <div class="module-grid">${cards}</div>
      <p class="breed-note" style="margin-top:14px">Sleeping restores health, stamina, food and water. A Brood Nest draws a kindred to your den and unlocks breeding.</p>`;
  }

  renderBreed() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'Breeding';
    if (sub) sub.textContent = 'Two genomes. One heir. The lineage continues.';
    const denReady = this.den && this.den.modules.nest;
    if (!denReady) {
      body.innerHTML = `
        <div class="empty-state">
          <b>No brood nest yet</b>
          Build a Brood Nest in your den first. It needs fiber and wood.<br /><br />
          <button class="panel-btn primary" data-act="open-build">Open Den & Craft</button>
        </div>`;
      return;
    }
    const m = this.mate;
    if (!m) {
      body.innerHTML = `
        <div class="empty-state">
          <b>Waiting for a kindred</b>
          A mate will be drawn to a finished brood nest. Return to your den and wait a moment.<br /><br />
          <button class="panel-btn" data-act="open-build">Back to the den</button>
        </div>`;
      return;
    }
    if (!this.heirPreview) this.heirPreview = this.makeHeirPreview();
    const prev = this.heirPreview;
    if (!prev) return;
    const mateGenes = Object.entries(m.genes || {})
      .map(([id, rank]) => ({ g: GENES.find((x) => x.id === id), rank }))
      .filter((x) => x.g)
      .sort((a, b) => a.g.name.localeCompare(b.g.name))
      .map(({ g, rank }) => `<span class="gene-chip" title="${g.effect(rank)}">${g.name} ${roman(rank)}</span>`)
      .join('') || '<span class="gene-chip">No expressed genes</span>';
    const upgraded = new Set(prev.upgraded || []);
    const heirGenes = Object.entries(prev.genes || {})
      .map(([id, rank]) => ({ g: GENES.find((x) => x.id === id), rank }))
      .filter((x) => x.g)
      .sort((a, b) => a.g.name.localeCompare(b.g.name))
      .map(({ g, rank }) => `<span class="gene-chip ${upgraded.has(g.id) ? 'up' : ''}">${g.name} ${roman(rank)}${upgraded.has(g.id) ? ' ↑' : ''}</span>`)
      .join('') || '<span class="gene-chip">No expressed genes</span>';
    const canBreed = m.affinity >= 100 && this.player.food >= 15;
    body.innerHTML = `
      <div class="breed-layout">
        <div class="mate-card">
          <canvas id="mate-canvas" class="creature-preview" width="360" height="150"></canvas>
          <h3>${m.name} <span style="font-size:10px;color:#ff9ec7">· ${STAGES[m.stage - 1].name}</span></h3>
          <div class="affinity"><i style="width:${clamp(m.affinity, 0, 100)}%"></i></div>
          <div class="mate-meta"><span>Affinity ${Math.floor(m.affinity)}%</span><span>${m.affinity >= 100 ? 'Ready to breed' : 'Court with E or below'}</span></div>
          <div class="genome-list">${mateGenes}</div>
          <div class="breed-actions">
            <button class="panel-btn pink" data-act="court" ${m.affinity >= 100 ? 'disabled' : ''}>${m.affinity >= 100 ? 'Affinity full' : 'Court'}</button>
            <button class="panel-btn" data-act="open-build">Back to den</button>
          </div>
          <p class="breed-note">Courtship costs a little food. ${m.affinity >= 100 ? 'They are waiting for you at the nest.' : 'Colour, dance and a full belly win them over faster.'}</p>
        </div>
        <div class="heir-card">
          <canvas id="heir-canvas" class="creature-preview" width="360" height="150"></canvas>
          <h3>${prev.name} <span style="font-size:10px;color:#ffd479">· ${STAGES[prev.stage - 1].name}</span></h3>
          <div class="mate-meta"><span>Generation ${this.generation + 1}</span><span>${prev.upgraded?.length || 0} gene boosts</span></div>
          <div class="genome-list">${heirGenes}</div>
          <div class="breed-actions">
            <button class="panel-btn gold" data-act="breed" ${canBreed ? '' : 'disabled'}>Hatch heir</button>
          </div>
          <p class="breed-note">Breeding costs 15 food and resets affinity. The heir joins you as a companion, and your lineage grows stronger. ${canBreed ? '' : !m.affinity ? 'Court your mate first.' : this.player.food < 15 ? 'You need at least 15 food.' : ''}</p>
        </div>
      </div>`;
    this._heirPheno = null;
    this._heirPreviewRef = null;
    this.drawPanelPreviews();
  }

  renderJournal() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'Field Journal';
    if (sub) sub.textContent = 'Everything this world has taught you so far.';
    const st = this.stats;
    const biomes = Object.entries(BIOMES).map(([key, b]) => (
      `<span class="disc ${this.discovered.biomes.has(key) ? 'found' : ''}">${this.discovered.biomes.has(key) ? b.name : '???'}</span>`
    )).join('');
    const speciesFound = Array.from(this.discovered.species).map((key) => {
      const sp = SPECIES[key];
      return sp ? `<span class="disc found">${sp.name}</span>` : '';
    }).join('');
    const speciesCount = SPECIES ? Object.keys(SPECIES).length : 11;
    const achs = ACHIEVEMENTS.map((a) => (
      `<div class="ach ${this.achievements.has(a.id) ? 'done' : ''}"><span class="dot"></span><span><b>${a.name}</b> — ${a.desc}</span></div>`
    )).join('');
    const heirs = this.heirs.length
      ? this.heirs.map((h) => `<div class="heir"><b>${h.name}</b> · generation ${h.generation} · ${STAGES[h.stage - 1].name}</div>`).join('')
      : '<span style="color:var(--muted)">No heirs yet. Build a Brood Nest and continue the line.</span>';
    const dayCount = this.day;
    body.innerHTML = `
      <div class="journal-grid">
        <div class="jcard">
          <h3>Journey</h3>
          <div class="stats-grid">
            ${this.statCell('Days', dayCount, dayCount / 20)}
            ${this.statCell('Kills', st.kills, st.kills / 40)}
            ${this.statCell('Meals', st.eats, st.eats / 50)}
            ${this.statCell('Mutations', st.mutations, st.mutations / 20)}
            ${this.statCell('Gathered', st.gathered, st.gathered / 60)}
            ${this.statCell('Distance', `${Math.round(st.distance / 10)}m`, st.distance / 40000)}
          </div>
        </div>
        <div class="jcard">
          <h3>Lineage</h3>
          <div class="lineage-list">
            <div><b>${this.player.name}</b> · generation ${this.generation} · ${STAGES[this.player.stage - 1].name}</div>
            <div style="color:#ffd479">Legacy bonus +${Math.round(this.lineage * 100)}% · ${this.heirs.length} heirs raised · ${st.breeds} broods</div>
            <div style="height:1px;background:var(--line);margin:3px 0"></div>
            ${heirs}
          </div>
        </div>
        <div class="jcard">
          <h3>Biomes · ${this.discovered.biomes.size}/${Object.keys(BIOMES).length}</h3>
          <div class="disc-grid">${biomes}</div>
          <h3 style="margin-top:14px">Species · ${this.discovered.species.size}/${speciesCount}</h3>
          <div class="disc-grid">${speciesFound || '<span style="color:var(--muted);font-size:9px">None observed yet.</span>'}</div>
        </div>
        <div class="jcard">
          <h3>Achievements · ${this.achievements.size}/${ACHIEVEMENTS.length}</h3>
          <div class="ach-list">${achs}</div>
        </div>
        <div class="jcard wide">
          <h3>Controls</h3>
          <div class="controls-list">
            <span><b>WASD / Arrows</b> move</span><span><b>Shift</b> sprint</span>
            <span><b>Space / F</b> bite</span><span><b>Q</b> special ability</span>
            <span><b>E</b> interact / eat / drink</span><span><b>M</b> evolution</span>
            <span><b>B</b> den & craft</span><span><b>Tab</b> world map</span>
            <span><b>J</b> journal</span><span><b>Esc</b> pause</span>
          </div>
          <div class="breed-actions">
            <button class="panel-btn" data-act="save">Save lineage</button>
            <button class="panel-btn" data-act="open-map">World map</button>
            <button class="panel-btn" data-act="close">Return to the wild</button>
          </div>
        </div>
      </div>`;
  }

  renderMapPanel() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'The Living Map';
    if (sub) sub.textContent = 'Every step uncovers a little more of a very large world.';
    const legend = Object.entries(BIOMES).map(([key, b]) => (
      `<span class="leg"><i style="background:${b.map}"></i>${b.water ? '≈ ' : ''}${b.name}</span>`
    )).join('');
    const pct = (this.explored.size / (MAPRES * MAPRES)) * 100;
    body.innerHTML = `
      <div class="map-stats" style="margin:0 0 10px">
        <span>Explored <b>${pct.toFixed(1)}%</b></span>
        <span>Biomes <b>${this.discovered.biomes.size}/${Object.keys(BIOMES).length}</b></span>
        <span>Landmarks <b>${this.landmarks.length}</b></span>
        <span>Den <b>${this.den ? `founded day ${this.den.foundedDay || 1}` : 'none'}</b></span>
      </div>
      <div class="map-legend" style="margin-top:0">${legend}</div>
      <div class="map-wrap" style="margin-top:12px"><canvas id="bigmap" width="1000" height="820"></canvas></div>
      <div class="breed-actions" style="margin-top:14px">
        <button class="panel-btn" data-act="close">Back to the wild</button>
        <button class="panel-btn" data-act="open-journal">Field journal</button>
      </div>
      <p class="breed-note">The gold circle is your den. Pink is your kindred. Diamond marks are echoes and monoliths you have touched. Scroll the panel to see the whole map.</p>`;
    this.drawBigMap();
  }

  renderPause() {
    const title = $('panel-title');
    const sub = $('panel-sub');
    const body = $('panel-body');
    if (!body) return;
    if (title) title.textContent = 'Paused';
    if (sub) sub.textContent = 'The world waits. Take a breath.';
    const soundOn = this.sound.enabled;
    body.innerHTML = `
      <div class="pause-grid">
        <button class="panel-btn primary" data-act="resume">Resume</button>
        <button class="panel-btn" data-act="open-mutations">Evolution · ${Math.round(this.player.dna)} DNA</button>
        <button class="panel-btn" data-act="open-build">Den & Craft</button>
        <button class="panel-btn" data-act="open-map">World Map</button>
        <button class="panel-btn" data-act="open-journal">Field Journal</button>
        <button class="panel-btn" data-act="save">Save Lineage</button>
        <button class="panel-btn" data-act="sound">Sound: ${soundOn ? 'On' : 'Off'}</button>
        <button class="panel-btn danger" data-act="newgame">Abandon & New Game</button>
      </div>
      <p class="pause-note">${this.player.name} · ${STAGES[this.player.stage - 1].name} · Day ${this.day} · Generation ${this.generation}</p>
      <p class="pause-note">Tip: pressing M, B, J or Tab opens a panel directly. Esc closes any panel.</p>`;
  }

  /* ============================ INPUT & BOOTSTRAP ============================ */

  bindUI() {
    const start = $('btn-start');
    if (start) start.addEventListener('click', () => { this.sound.init(); this.startGame(); });
    const fresh = $('btn-new');
    if (fresh) {
      fresh.addEventListener('click', () => {
        try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
        this.newGame(false);
        this.startGame();
      });
    }
    const close = $('panel-close');
    if (close) close.addEventListener('click', () => this.closePanel());
    const modal = $('modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this.closePanel(); });

    const btnMut = $('btn-mutations');
    if (btnMut) btnMut.addEventListener('click', () => this.openMutations());
    const btnBuild = $('btn-build');
    if (btnBuild) btnBuild.addEventListener('click', () => this.openBuild());
    const btnMap = $('btn-map');
    if (btnMap) btnMap.addEventListener('click', () => this.openMap());
    const btnJournal = $('btn-journal');
    if (btnJournal) btnJournal.addEventListener('click', () => this.openJournal());
    const btnPause = $('btn-pause');
    if (btnPause) btnPause.addEventListener('click', () => this.openPause());
    const btnSound = $('btn-sound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const on = this.sound.toggle();
        btnSound.textContent = on ? '🔊' : '🔇';
        this.toast(on ? 'Sound on.' : 'Sound off.', '', 1600);
        if (this.panel === 'pause') this.renderPause();
      });
    }
    const respawn = $('btn-respawn');
    if (respawn) respawn.addEventListener('click', () => this.respawn());

    const panelBody = $('panel-body');
    if (panelBody) {
      panelBody.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        if (button.dataset.cat) {
          this.mutationCat = button.dataset.cat;
          this.renderMutations();
          return;
        }
        if (button.dataset.buy) {
          this.buyGene(button.dataset.buy);
          return;
        }
        if (button.dataset.mod) {
          const body = $('panel-body');
          const scroll = body ? body.scrollTop : 0;
          this.buildModule(button.dataset.mod);
          if (body) body.scrollTop = scroll;
          return;
        }
        const act = button.dataset.act;
        if (!act) return;
        if (act === 'resume') this.closePanel();
        else if (act === 'close') this.closePanel();
        else if (act === 'save') {
          this.saveGame(true);
          if (this.panel === 'pause') this.renderPause();
        } else if (act === 'sound') {
          const on = this.sound.toggle();
          const soundBtn = $('btn-sound');
          if (soundBtn) soundBtn.textContent = on ? '🔊' : '🔇';
          this.renderPause();
        } else if (act === 'open-mutations') this.openMutations();
        else if (act === 'open-build') this.openBuild();
        else if (act === 'open-breed') this.openBreed();
        else if (act === 'open-map') this.openMap();
        else if (act === 'open-journal') this.openJournal();
        else if (act === 'found-den') this.foundDen();
        else if (act === 'rest') this.restDen();
        else if (act === 'court') {
          this.courtMate();
          if (this.panel === 'breed') this.renderBreed();
        } else if (act === 'breed') this.breed();
        else if (act === 'newgame') {
          if (window.confirm('Abandon this lineage and begin again?')) {
            try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
            this.panel = null;
            const m = $('modal');
            if (m) m.classList.add('hidden');
            this.newGame(false);
            this.startGame();
          }
        }
      });
    }

    const moveCodes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'];
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (code === 'Escape') {
        e.preventDefault();
        if (this.panel) this.closePanel();
        else if (this.started && !this.dead) this.openPause();
        return;
      }
      if (this.panel || this.dead) return;
      if (moveCodes.includes(code)) {
        this.keys.add(code);
        if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      }
      if (!this.started) return;
      if (e.repeat) return;
      if (code === 'KeyM') { e.preventDefault(); this.openMutations(); }
      else if (code === 'KeyB') { e.preventDefault(); this.openBuild(); }
      else if (code === 'KeyJ') { e.preventDefault(); this.openJournal(); }
      else if (code === 'Tab') { e.preventDefault(); this.openMap(); }
      else if (code === 'KeyP') { e.preventDefault(); this.openPause(); }
      else if (code === 'KeyE') { e.preventDefault(); this.doInteract(); }
      else if (code === 'KeyQ') { e.preventDefault(); this.useAbility(); }
      else if (code === 'Space' || code === 'KeyF') { e.preventDefault(); this.attack(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.joystick = { x: 0, y: 0, active: false };
      this.touchSprint = false;
      const stick = $('stick');
      if (stick) stick.style.transform = 'translate(-50%, -50%)';
      const sprintBtn = $('btn-touch-sprint');
      if (sprintBtn) sprintBtn.classList.remove('active');
    });

    const canvas = this.canvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        if (!this.started || this.panel || this.dead) return;
        this.attack();
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Virtual joystick
    const joy = $('joystick');
    const stick = $('stick');
    if (joy && stick) {
      let pointerId = null;
      let cx = 0;
      let cy = 0;
      const radius = () => Math.max(28, joy.getBoundingClientRect().width * 0.34);
      const moveStick = (dx, dy) => {
        stick.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      };
      const update = (e) => {
        if (e.pointerId !== pointerId) return;
        const max = radius();
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d > max) {
          dx = (dx / d) * max;
          dy = (dy / d) * max;
        }
        this.joystick.x = dx / max;
        this.joystick.y = dy / max;
        this.joystick.active = Math.hypot(this.joystick.x, this.joystick.y) > 0.12;
        moveStick(dx, dy);
      };
      const reset = () => {
        pointerId = null;
        this.joystick = { x: 0, y: 0, active: false };
        moveStick(0, 0);
      };
      joy.addEventListener('pointerdown', (e) => {
        if (!this.started || this.panel || this.dead) return;
        e.preventDefault();
        const rect = joy.getBoundingClientRect();
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
        pointerId = e.pointerId;
        try { joy.setPointerCapture(pointerId); } catch { /* ignore */ }
        update(e);
      });
      joy.addEventListener('pointermove', update);
      joy.addEventListener('pointerup', reset);
      joy.addEventListener('pointercancel', reset);
      joy.addEventListener('lostpointercapture', reset);
    }

    const bindTouch = (id, down, up) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        if (!this.started || this.panel || this.dead) return;
        e.preventDefault();
        down();
      });
      if (up) {
        el.addEventListener('pointerup', (e) => { e.preventDefault(); up(); });
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
      }
    };
    bindTouch('btn-touch-attack', () => this.attack());
    bindTouch('btn-touch-interact', () => this.doInteract());
    bindTouch('btn-touch-ability', () => this.useAbility());
    bindTouch('btn-touch-sprint', () => {
      this.touchSprint = true;
      const b = $('btn-touch-sprint');
      if (b) b.classList.add('active');
    }, () => {
      this.touchSprint = false;
      const b = $('btn-touch-sprint');
      if (b) b.classList.remove('active');
    });
  }
}

const game = new Game();
game.boot();
if (typeof window !== 'undefined') window.sporeGenesis = game;
