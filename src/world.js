// Procedural living world: terrain, biomes, chunks, harvestable objects and map.
import {
  WORLD_SIZE, BIOMES
} from './data.js';
import {
  RNG, clamp, lerp, smoothstep, valueNoise, fbm, rgba, mix, shade, dist
} from './util.js';

export const CHUNK = 512;
const GRID = 200;
const WATER = 0.345;
const DEEP = 0.258;
const MAPRES = 100;

const OBJECT_META = {
  oak: { solid: 20, kind: 'wood', amount: 3, regrow: 120, label: 'Chop wood', verb: 'chopped' },
  pine: { solid: 18, kind: 'wood', amount: 3, regrow: 120, label: 'Chop wood', verb: 'chopped' },
  willow: { solid: 19, kind: 'wood', amount: 2, extra: { fiber: 2 }, regrow: 120, label: 'Cut willow', verb: 'cut' },
  acacia: { solid: 18, kind: 'wood', amount: 2, regrow: 120, label: 'Chop wood', verb: 'chopped' },
  bush: { solid: 0, kind: 'food', amount: 12, regrow: 48, label: 'Eat berries', verb: 'foraged' },
  mushroom: { solid: 0, kind: 'food', amount: 9, regrow: 36, label: 'Eat mushroom', verb: 'foraged' },
  rock: { solid: 20, kind: 'stone', amount: 3, regrow: 95, label: 'Mine stone', verb: 'mined' },
  reed: { solid: 0, kind: 'fiber', amount: 3, regrow: 45, label: 'Cut fiber', verb: 'cut' },
  crystal: { solid: 16, kind: 'crystal', amount: 2, regrow: 130, label: 'Harvest crystal', verb: 'harvested' },
  driftwood: { solid: 14, kind: 'wood', amount: 2, regrow: 80, label: 'Gather driftwood', verb: 'gathered' },
  obelisk: { solid: 20, kind: 'obelisk', amount: 0, regrow: Infinity, label: 'Touch the monolith', verb: 'read' },
  lily: { solid: 0, kind: null, amount: 0, regrow: 0, label: '', verb: '' }
};

export class World {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
    this.size = WORLD_SIZE;
    this.chunks = new Map();
    this.objects = new Map();
    this.taken = new Map(); // object id -> regrow-at (seconds)
    this.hidden = new Set();
    this.elev = new Float32Array(GRID * GRID);
    this.moist = new Float32Array(GRID * GRID);
    this.temp = new Float32Array(GRID * GRID);
    this.crys = new Float32Array(GRID * GRID);
    this.buildGrids();
    this.palettes = this.buildPalettes();
    this.mapBase = this.buildMapBase();
    this.findSpawn = this.findSpawn.bind(this);
  }

  buildGrids() {
    const s = this.seed;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const nx = gx / (GRID - 1);
        const ny = gy / (GRID - 1);
        const wx = nx * this.size;
        const wy = ny * this.size;
        const base = fbm(wx / 1050 + 7.2, wy / 1050 - 3.4, s + 11, 5, 2.02, 0.52);
        const ridge = Math.pow(fbm(wx / 520, wy / 520, s + 71, 4, 2.1, 0.5), 2.1);
        const dx = nx - 0.5;
        const dy = ny - 0.5;
        const fall = smoothstep(clamp((Math.hypot(dx, dy) * 2 - 0.55) / 0.62, 0, 1));
        let e = 0.19 + base * 0.68 + ridge * 0.17 - fall * 0.48;
        // winding river channels carved through the lowlands
        const river = Math.abs(fbm(wx / 470 + 51, wy / 470 - 23, s + 303, 3, 2.0, 0.55) - 0.5);
        if (river < 0.031 && e > 0.3 && e < 0.7) e -= (0.031 - river) * 2.5;
        const m = clamp(0.1 + fbm(wx / 860 + 14, wy / 720 - 8, s + 201, 4, 2.04, 0.5) * 0.78 + (0.48 - e) * 0.34, 0, 1);
        const t = clamp(0.22 + fbm(wx / 1500 + 3, wy / 1500 + 8, s + 337, 3, 2.1, 0.5) * 0.72 - ny * 0.08, 0, 1);
        const cr = fbm(wx / 640 - 6, wy / 640 + 3, s + 555, 3, 2.0, 0.5);
        const i = gy * GRID + gx;
        this.elev[i] = e;
        this.moist[i] = m;
        this.temp[i] = t;
        this.crys[i] = cr;
      }
    }
  }

  sample(arr, x, y) {
    const fx = clamp((x / this.size) * (GRID - 1), 0, GRID - 1.001);
    const fy = clamp((y / this.size) * (GRID - 1), 0, GRID - 1.001);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const i0 = y0 * GRID + x0;
    const i1 = i0 + GRID;
    const a = lerp(arr[i0], arr[i0 + 1], tx);
    const b = lerp(arr[i1], arr[i1 + 1], tx);
    return lerp(a, b, ty);
  }

  elevAt(x, y) { return this.sample(this.elev, x, y); }
  moistAt(x, y) { return this.sample(this.moist, x, y); }
  tempAt(x, y) { return this.sample(this.temp, x, y); }
  crystalAt(x, y) { return this.sample(this.crys, x, y); }
  isWater(x, y) { return this.elevAt(x, y) < WATER; }
  isDeep(x, y) { return this.elevAt(x, y) < DEEP; }

  biomeAt(x, y) {
    const e = this.elevAt(x, y);
    if (e < DEEP) return 'deep';
    if (e < WATER) return 'shallow';
    if (e > 0.755) return 'highland';
    const c = this.crystalAt(x, y);
    if (c > 0.71 && e > 0.41 && this.moistAt(x, y) > 0.44) return 'crystal';
    const t = this.tempAt(x, y);
    const m = this.moistAt(x, y);
    if (t > 0.785 && m < 0.36 && e > 0.43) return 'ash';
    if (e < 0.395) return 'sand';
    if (m > 0.655 && e < 0.5) return 'swamp';
    if (m > 0.6) return 'forest';
    if (m < 0.375) return 'savannah';
    if (e > 0.69) return 'highland';
    return 'meadow';
  }

  buildPalettes() {
    const out = {};
    for (const [key, b] of Object.entries(BIOMES)) {
      const list = [
        b.ground,
        mix(b.ground, b.alt, 0.25),
        mix(b.ground, b.alt, 0.5),
        mix(b.ground, b.alt, 0.78),
        b.alt,
        shade(b.ground, -0.08),
        shade(b.alt, 0.06),
        shade(b.ground, 0.07),
        b.detail
      ];
      out[key] = list;
    }
    return out;
  }

  cellColor(key, x, y) {
    const p = this.palettes[key];
    const n = valueNoise(x / 90, y / 90, this.seed + 31);
    const n2 = valueNoise(x / 23, y / 23, this.seed + 47);
    return p[Math.min(p.length - 1, Math.floor((n * 0.75 + n2 * 0.45) * p.length))];
  }

  getChunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK;
    canvas.height = CHUNK;
    const ctx = canvas.getContext('2d');
    this.paintChunk(ctx, cx, cy);
    c = { canvas, cx, cy, key };
    this.chunks.set(key, c);
    if (this.chunks.size > 70) {
      const first = this.chunks.keys().next().value;
      this.chunks.delete(first);
    }
    return c;
  }

  paintChunk(ctx, cx, cy) {
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;
    const rng = new RNG((this.seed ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0);
    const cells = 64;
    const step = CHUNK / cells;
    const pad = 1;
    const grid = cells + pad * 2;
    const waterCells = [];
    // Paint the base terrain at a modest resolution, then upscale it with
    // smoothing. One extra cell of bleed on every side keeps the colour
    // gradients continuous across chunk borders (no visible seams).
    const base = document.createElement('canvas');
    base.width = grid;
    base.height = grid;
    const bctx = base.getContext('2d');

    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const x = ox + (gx - pad) * step;
        const y = oy + (gy - pad) * step;
        const key = this.biomeAt(x + step * 0.5, y + step * 0.5);
        bctx.fillStyle = this.cellColor(key, x, y);
        bctx.fillRect(gx, gy, 1, 1);
        if (BIOMES[key].water) waterCells.push([gx, gy, key]);
      }
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, -pad * step, -pad * step, grid * step, grid * step);

    // soft blotches to break up the grid
    for (let i = 0; i < 130; i++) {
      const x = rng.range(0, CHUNK);
      const y = rng.range(0, CHUNK);
      const key = this.biomeAt(ox + x, oy + y);
      const b = BIOMES[key];
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = rng.chance(0.5) ? b.alt : b.ground;
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(10, 42), rng.range(8, 30), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // shoreline foam
    for (const [gx, gy, key] of waterCells) {
      const x = (gx - pad) * step;
      const y = (gy - pad) * step;
      const nx = ox + x + step / 2;
      const ny = oy + y + step / 2;
      let touches = false;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (!this.isWater(nx + Math.cos(ang) * step * 0.9, ny + Math.sin(ang) * step * 0.9)) { touches = true; break; }
      }
      if (touches) {
        ctx.globalAlpha = 0.35 + rng.next() * 0.2;
        ctx.fillStyle = key === 'deep' ? '#2b8490' : '#cfe3cf';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(x + rng.range(0, step), y + rng.range(0, step), rng.range(3, 9), rng.range(2, 5), rng.range(0, 6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;

    // biome-specific texture
    const counts = {
      meadow: 420, forest: 330, savannah: 300, swamp: 300, sand: 170,
      highland: 200, crystal: 170, ash: 210, deep: 70, shallow: 90
    };
    const mainKey = this.biomeAt(ox + CHUNK / 2, oy + CHUNK / 2);
    const count = counts[mainKey] || 200;
    for (let i = 0; i < count; i++) {
      const x = rng.range(0, CHUNK);
      const y = rng.range(0, CHUNK);
      const key = this.biomeAt(ox + x, oy + y);
      const b = BIOMES[key];
      if (b.water) {
        if (rng.chance(0.5)) {
          ctx.globalAlpha = rng.range(0.12, 0.34);
          ctx.strokeStyle = rng.chance(0.5) ? '#7ccfd0' : '#0a2637';
          ctx.lineWidth = rng.range(0.7, 1.6);
          ctx.beginPath();
          const len = rng.range(4, 14);
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + len / 2, y - rng.range(1, 4), x + len, y);
          ctx.stroke();
        } else {
          ctx.globalAlpha = rng.range(0.2, 0.5);
          ctx.fillStyle = '#d6f6f0';
          ctx.fillRect(x, y, rng.range(0.7, 1.8), rng.range(0.7, 1.8));
        }
        continue;
      }
      if (key === 'sand') {
        ctx.globalAlpha = rng.range(0.2, 0.5);
        ctx.fillStyle = rng.chance(0.6) ? b.detail : '#f2e3b8';
        ctx.beginPath();
        ctx.arc(x, y, rng.range(0.5, 1.6), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (key === 'meadow' || key === 'forest' || key === 'swamp') {
        ctx.globalAlpha = rng.range(0.22, 0.55);
        ctx.strokeStyle = rng.chance(0.55) ? b.detail : shade(b.alt, 0.12);
        ctx.lineWidth = rng.range(0.7, 1.5);
        const len = rng.range(2.5, 7);
        const lean = rng.range(-2, 2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.4, y - len * 0.6, x + lean, y - len);
        ctx.stroke();
      } else if (key === 'savannah') {
        if (rng.chance(0.4)) {
          ctx.globalAlpha = rng.range(0.18, 0.4);
          ctx.strokeStyle = b.detail;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rng.range(-5, 5), y + rng.range(-5, 5));
          ctx.stroke();
        } else {
          ctx.globalAlpha = rng.range(0.25, 0.55);
          ctx.strokeStyle = '#d8bf76';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rng.range(-1, 1), y - rng.range(3, 8));
          ctx.stroke();
        }
      } else if (key === 'highland' || key === 'ash') {
        ctx.globalAlpha = rng.range(0.18, 0.42);
        ctx.fillStyle = key === 'ash' && rng.chance(0.16) ? '#ff7a3c' : shade(b.detail, rng.range(-0.1, 0.15));
        ctx.beginPath();
        ctx.arc(x, y, rng.range(0.6, 2.2), 0, Math.PI * 2);
        ctx.fill();
        if (rng.chance(0.25)) {
          ctx.strokeStyle = rgba('#161212', 0.35);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rng.range(-8, 8), y + rng.range(-8, 8));
          ctx.stroke();
        }
      } else if (key === 'crystal') {
        ctx.globalAlpha = rng.range(0.15, 0.4);
        ctx.fillStyle = rng.chance(0.4) ? '#b58cff' : b.detail;
        ctx.beginPath();
        ctx.arc(x, y, rng.range(0.5, 1.8), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // flowers and little biome flourishes
    if (mainKey === 'meadow') {
      const flowers = ['#f2d35c', '#e6738f', '#f5f0d8', '#a68cf5'];
      for (let i = 0; i < 34; i++) {
        const x = rng.range(0, CHUNK);
        const y = rng.range(0, CHUNK);
        if (this.isWater(ox + x, oy + y)) continue;
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = rng.pick(flowers);
        ctx.beginPath();
        ctx.arc(x, y, rng.range(1.1, 2.3), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#3d6b35';
        ctx.fillRect(x - 0.4, y, 0.8, rng.range(2, 4));
      }
    }
    if (mainKey === 'forest' || mainKey === 'swamp') {
      for (let i = 0; i < 18; i++) {
        const x = rng.range(0, CHUNK);
        const y = rng.range(0, CHUNK);
        if (this.isWater(ox + x, oy + y)) continue;
        ctx.globalAlpha = rng.range(0.2, 0.45);
        ctx.fillStyle = rng.chance(0.5) ? '#8a6e36' : '#c1a04a';
        ctx.beginPath();
        ctx.ellipse(x, y, rng.range(2, 5), rng.range(1, 2.4), rng.range(0, 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  getObjects(cx, cy) {
    const key = cx + ',' + cy;
    let list = this.objects.get(key);
    if (list) return list;
    const rng = new RNG((this.seed ^ (cx * 83492791) ^ (cy * 2971215073) ^ 0x5f3759df) >>> 0);
    list = [];
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;
    const centerKey = this.biomeAt(ox + CHUNK / 2, oy + CHUNK / 2);
    let attempts = 34;
    for (let i = 0; i < attempts; i++) {
      const x = ox + rng.range(34, CHUNK - 34);
      const y = oy + rng.range(34, CHUNK - 34);
      const biome = this.biomeAt(x, y);
      const water = this.isWater(x, y);
      const table = this.objectTable(biome, water, centerKey, rng);
      const type = rng.pick(table);
      if (!type) continue;
      if (type === 'obelisk' && rng.chance(0.72)) continue;
      const meta = OBJECT_META[type];
      const obj = {
        id: `${cx}:${cy}:${i}:${type}`,
        type, x, y, cx, cy,
        r: type === 'oak' || type === 'pine' || type === 'willow' || type === 'acacia' ? rng.range(16, 22) : meta.solid,
        variant: rng.chance(0.25) ? 1 : 0,
        seed: rng.next(),
        poison: type === 'mushroom' && rng.chance(0.28)
      };
      if (type === 'lily' && !water) continue;
      list.push(obj);
    }
    this.objects.set(key, list);
    return list;
  }

  objectTable(biome, water, centerKey, rng) {
    if (water) return ['lily', 'lily', 'lily', 'reed', 'driftwood', null, null];
    switch (biome) {
      case 'forest': return ['oak', 'oak', 'pine', 'bush', 'bush', 'mushroom', 'rock', 'reed', null, null];
      case 'meadow': return ['bush', 'bush', 'bush', 'oak', 'rock', 'mushroom', 'reed', null, null];
      case 'savannah': return ['acacia', 'acacia', 'bush', 'rock', 'rock', 'mushroom', null, null];
      case 'swamp': return ['willow', 'willow', 'reed', 'reed', 'mushroom', 'mushroom', 'rock', null];
      case 'highland': return ['rock', 'rock', 'rock', 'pine', 'crystal', null, null];
      case 'crystal': return ['crystal', 'crystal', 'rock', 'crystal', 'obelisk', null];
      case 'ash': return ['rock', 'rock', 'crystal', 'obelisk', null, null];
      case 'sand': return ['driftwood', 'reed', 'rock', 'bush', null, null];
      default: return ['bush', 'rock', 'reed', null];
    }
  }

  isAvailable(obj, time) {
    const until = this.taken.get(obj.id);
    return !until || until <= time;
  }

  markHarvested(obj, time) {
    const meta = OBJECT_META[obj.type];
    const until = meta.regrow === Infinity ? Infinity : time + meta.regrow;
    this.taken.set(obj.id, until);
    return meta;
  }

  harvestInfo(obj) {
    return OBJECT_META[obj.type];
  }

  nearbyObjects(x, y, radius) {
    const minx = Math.floor((x - radius) / CHUNK);
    const maxx = Math.floor((x + radius) / CHUNK);
    const miny = Math.floor((y - radius) / CHUNK);
    const maxy = Math.floor((y + radius) / CHUNK);
    const out = [];
    for (let cy = miny; cy <= maxy; cy++) {
      for (let cx = minx; cx <= maxx; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK > this.size || cy * CHUNK > this.size) continue;
        for (const obj of this.getObjects(cx, cy)) {
          if (this.hidden.has(obj.id)) continue;
          if (dist(x, y, obj.x, obj.y) <= radius + obj.r) out.push(obj);
        }
      }
    }
    return out;
  }

  clearArea(x, y, radius) {
    for (const obj of this.nearbyObjects(x, y, radius)) {
      if (obj.type === 'obelisk') continue;
      this.hidden.add(obj.id);
    }
  }

  resolveCollision(x, y, radius) {
    const objs = this.nearbyObjects(x, y, radius + 30);
    let nx = x;
    let ny = y;
    for (const obj of objs) {
      const meta = OBJECT_META[obj.type];
      if (!meta.solid) continue;
      const rr = meta.solid + radius;
      const dx = nx - obj.x;
      const dy = ny - obj.y;
      const d = Math.hypot(dx, dy);
      if (d < rr && d > 0.001) {
        nx = obj.x + (dx / d) * rr;
        ny = obj.y + (dy / d) * rr;
      }
    }
    return { x: nx, y: ny };
  }

  drawGround(ctx, rect) {
    const minx = Math.floor(rect.x / CHUNK);
    const maxx = Math.floor((rect.x + rect.w) / CHUNK);
    const miny = Math.floor(rect.y / CHUNK);
    const maxy = Math.floor((rect.y + rect.h) / CHUNK);
    for (let cy = miny; cy <= maxy; cy++) {
      for (let cx = minx; cx <= maxx; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= this.size || cy * CHUNK >= this.size) continue;
        const c = this.getChunk(cx, cy);
        // One pixel of overlap hides the antialiased seam that appears when
        // adjacent canvases are composited at a fractional camera offset.
        ctx.drawImage(c.canvas, cx * CHUNK - 1, cy * CHUNK - 1, CHUNK + 2, CHUNK + 2);
      }
    }
  }

  drawObject(ctx, obj, time) {
    const available = this.isAvailable(obj, time);
    switch (obj.type) {
      case 'oak': this.drawOak(ctx, obj, time, available, 'oak'); break;
      case 'pine': this.drawPine(ctx, obj, time, available); break;
      case 'willow': this.drawWillow(ctx, obj, time, available); break;
      case 'acacia': this.drawAcacia(ctx, obj, time, available); break;
      case 'bush': this.drawBush(ctx, obj, available); break;
      case 'mushroom': this.drawMushroom(ctx, obj, available); break;
      case 'rock': this.drawRock(ctx, obj, available); break;
      case 'reed': this.drawReed(ctx, obj, time, available); break;
      case 'crystal': this.drawCrystal(ctx, obj, time, available); break;
      case 'driftwood': this.drawDriftwood(ctx, obj, available); break;
      case 'obelisk': this.drawObelisk(ctx, obj, time, available); break;
      case 'lily': this.drawLily(ctx, obj, time); break;
      default: break;
    }
  }

  drawShadow(ctx, x, y, rx, ry, a = 0.18) {
    ctx.fillStyle = `rgba(8,20,16,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawOak(ctx, obj, time, available, kind) {
    const { x, y, seed } = obj;
    const sway = Math.sin(time * 0.85 + seed * 19) * 2.2;
    this.drawShadow(ctx, x + 5, y + 3, 28, 11, 0.2);
    if (!available) {
      ctx.fillStyle = '#4c3422';
      ctx.fillRect(x - 5, y - 11, 10, 11);
      ctx.fillStyle = '#8a6640';
      ctx.beginPath(); ctx.ellipse(x, y - 11, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b99060'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y - 11, 3.5, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    ctx.fillStyle = '#5e3f28';
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.quadraticCurveTo(x - 3, y - 20, x - 2, y - 31);
    ctx.lineTo(x + 3, y - 31);
    ctx.quadraticCurveTo(x + 3, y - 19, x + 7, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(210,170,110,.28)';
    ctx.fillRect(x - 4, y - 27, 2, 25);
    const cx = x + sway;
    const cy = y - 40;
    const blobs = [
      [-19, 6, 17, '#244d2c'], [16, 4, 16, '#2a5630'], [-4, -8, 20, '#336737'],
      [10, -14, 15, '#3f7a40'], [-12, -17, 14, '#2f6234'], [0, 5, 20, '#386f3c']
    ];
    for (const [bx, by, br, col] of blobs) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx + bx, cy + by, br, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#62a052';
    for (let i = 0; i < 18; i++) {
      const a = seed * 30 + i * 2.7;
      const rr = 8 + ((i * 7 + seed * 13) % 17);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy - 4 + Math.sin(a) * rr * 0.7, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (obj.variant) {
      ctx.fillStyle = '#e05252';
      for (let i = 0; i < 5; i++) {
        const a = seed * 12 + i * 1.7;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 16, cy + Math.sin(a) * 11, 2.1, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawPine(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    const sway = Math.sin(time * 0.7 + seed * 11) * 1.6;
    this.drawShadow(ctx, x + 5, y + 2, 22, 9, 0.22);
    if (!available) {
      ctx.fillStyle = '#4a3220';
      ctx.fillRect(x - 4, y - 10, 8, 10);
      return;
    }
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(x - 4, y - 20, 8, 20);
    ctx.fillStyle = '#7a5531';
    ctx.fillRect(x - 2, y - 19, 2, 18);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const yy = y - 18 - i * 13;
      const w = 26 - i * 5;
      ctx.fillStyle = i % 2 ? '#244e33' : '#2c5b3a';
      ctx.beginPath();
      ctx.moveTo(x - w + sway, yy);
      ctx.lineTo(x + sway, yy - 22);
      ctx.lineTo(x + w + sway, yy);
      ctx.lineTo(x + w * 0.42 + sway, yy - 3);
      ctx.lineTo(x - w * 0.42 + sway, yy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(140,190,120,.16)';
      ctx.beginPath();
      ctx.moveTo(x + sway, yy - 20);
      ctx.lineTo(x + w * 0.65 + sway, yy - 2);
      ctx.lineTo(x + sway, yy - 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawWillow(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    const sway = Math.sin(time * 0.6 + seed * 17) * 2.5;
    this.drawShadow(ctx, x + 6, y + 3, 30, 12, 0.2);
    if (!available) {
      ctx.fillStyle = '#4d3a28'; ctx.fillRect(x - 5, y - 12, 10, 12); return;
    }
    ctx.strokeStyle = '#58452e';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 4, y - 24, x - 2, y - 38);
    ctx.stroke();
    ctx.strokeStyle = '#6e5637';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 2, y - 32); ctx.lineTo(x - 18 + sway, y - 44); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 1, y - 36); ctx.lineTo(x + 19 + sway, y - 47); ctx.stroke();
    const green = ['#4f7a44', '#5c8a4b', '#3f6b3d'];
    for (let i = 0; i < 30; i++) {
      const a = seed * 15 + i * 1.31;
      const bx = x + Math.cos(a) * (12 + (i % 5) * 6) + sway;
      const by = y - 42 + Math.sin(a) * 7;
      ctx.strokeStyle = green[i % 3];
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + Math.sin(time + i) * 2, by + 10, bx + Math.sin(time * 0.8 + i) * 4, by + 22 + (i % 4) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawAcacia(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    const sway = Math.sin(time * 0.75 + seed * 13) * 1.5;
    this.drawShadow(ctx, x + 8, y + 4, 34, 11, 0.17);
    if (!available) {
      ctx.fillStyle = '#5b4229'; ctx.fillRect(x - 4, y - 12, 8, 12); return;
    }
    ctx.strokeStyle = '#5b4229';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 2, y - 22, x + 1, y - 36);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y - 33); ctx.lineTo(x - 21, y - 44); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 35); ctx.lineTo(x + 23, y - 45); ctx.stroke();
    ctx.fillStyle = '#61773a';
    ctx.beginPath(); ctx.ellipse(x + sway, y - 48, 37, 11, -0.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#788f45';
    ctx.beginPath(); ctx.ellipse(x + sway - 4, y - 51, 28, 7, -0.04, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#a3b866';
    for (let i = 0; i < 12; i++) {
      const a = seed * 20 + i * 2.1;
      ctx.beginPath();
      ctx.arc(x + sway + Math.cos(a) * (10 + (i % 5) * 5), y - 49 + Math.sin(a) * 5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBush(ctx, obj, available) {
    const { x, y, seed } = obj;
    this.drawShadow(ctx, x + 3, y + 2, 18, 7, 0.16);
    const cols = obj.variant ? ['#315c36', '#3d6e3d', '#4f8346'] : ['#2f5d34', '#3c6f3c', '#518346'];
    for (let i = 0; i < 3; i++) {
      const bx = x + Math.cos(seed * 20 + i * 2.1) * 9;
      const by = y - 6 + Math.sin(seed * 17 + i * 1.7) * 4;
      ctx.fillStyle = cols[i];
      ctx.beginPath(); ctx.arc(bx, by, 10 - i * 1.4, 0, Math.PI * 2); ctx.fill();
    }
    if (available) {
      const berry = obj.variant ? '#5b7fd4' : '#d94d5c';
      ctx.fillStyle = berry;
      for (let i = 0; i < 6; i++) {
        const a = seed * 33 + i * 1.9;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 11, y - 7 + Math.sin(a) * 7, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.arc(x - 9, y - 13, 1, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = '#5d4a31';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x - 2, y - 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 1, y - 8); ctx.stroke();
    }
  }

  drawMushroom(ctx, obj, available) {
    const { x, y, seed } = obj;
    this.drawShadow(ctx, x + 2, y + 1, 11, 4, 0.15);
    if (!available) {
      ctx.strokeStyle = '#c9b48e';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 4); ctx.stroke();
      return;
    }
    const capW = 9 + (seed % 5);
    ctx.fillStyle = '#e7dcc2';
    ctx.fillRect(x - 1.5, y - 9, 3, 9);
    ctx.fillStyle = obj.poison ? '#b8404e' : '#9a7a4e';
    ctx.beginPath();
    ctx.ellipse(x, y - 10, capW, capW * 0.55, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = obj.poison ? '#ffd4d8' : '#c8a96e';
    for (let i = 0; i < 4; i++) {
      const a = seed * 10 + i * 1.7;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * capW * 0.5, y - 11 + Math.sin(a) * 2.4, 1.1, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawRock(ctx, obj, available) {
    const { x, y, seed } = obj;
    this.drawShadow(ctx, x + 3, y + 3, 21, 9, 0.2);
    const s = 15 + (seed % 8);
    if (!available) {
      ctx.fillStyle = '#6e6a62';
      ctx.beginPath(); ctx.ellipse(x, y - 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8f8a80';
      ctx.beginPath(); ctx.ellipse(x - 3, y - 4, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.fillStyle = '#65615a';
    ctx.beginPath();
    ctx.moveTo(x - s, y + 2);
    ctx.lineTo(x - s * 0.65, y - s * 0.7);
    ctx.lineTo(x + s * 0.1, y - s);
    ctx.lineTo(x + s * 0.8, y - s * 0.45);
    ctx.lineTo(x + s, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8a857b';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y - s * 0.62);
    ctx.lineTo(x + s * 0.08, y - s * 0.9);
    ctx.lineTo(x + s * 0.45, y - s * 0.35);
    ctx.lineTo(x - s * 0.25, y - s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(210,204,188,.35)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y - s * 0.82);
    ctx.lineTo(x + s * 0.36, y - s * 0.4);
    ctx.lineTo(x + s * 0.06, y - s * 0.32);
    ctx.closePath();
    ctx.fill();
    if (seed % 3 < 1) {
      ctx.fillStyle = '#6d8c4d';
      ctx.beginPath(); ctx.arc(x - s * 0.35, y - s * 0.55, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawReed(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    if (!available) {
      ctx.strokeStyle = '#6a6535';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 3 - 3, y); ctx.lineTo(x + i * 3 - 3, y - 5); ctx.stroke();
      }
      return;
    }
    for (let i = 0; i < 7; i++) {
      const a = seed * 21 + i * 1.13;
      const h = 12 + (i % 4) * 4;
      const sway = Math.sin(time * 1.1 + i + seed * 8) * 2;
      ctx.strokeStyle = i % 3 ? '#7f8c47' : '#a3a75c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 6, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * 7 + sway, y - h * 0.6, x + Math.cos(a) * 5 + sway * 1.5, y - h);
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.fillStyle = '#b4a35d';
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 5 + sway * 1.5, y - h, 1.6, 4, 0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawCrystal(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    if (!available) {
      ctx.fillStyle = '#4b3d68';
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 5); ctx.lineTo(x + 6, y); ctx.closePath(); ctx.fill();
      return;
    }
    const pulse = 0.7 + Math.sin(time * 1.7 + seed * 8) * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y - 16, 2, x, y - 16, 34);
    g.addColorStop(0, `rgba(160,110,255,${0.24 * pulse})`);
    g.addColorStop(1, 'rgba(120,80,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y - 16, 34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.drawShadow(ctx, x + 2, y + 2, 15, 5, 0.18);
    const shards = 4;
    for (let i = 0; i < shards; i++) {
      const bx = x + (i - 1.5) * 6;
      const h = 13 + ((i * 7 + seed * 11) % 16);
      ctx.fillStyle = i % 2 ? '#8a6ed0' : '#b08cff';
      ctx.beginPath();
      ctx.moveTo(bx - 3, y);
      ctx.lineTo(bx + 1, y - h);
      ctx.lineTo(bx + 4, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(235,220,255,.55)';
      ctx.beginPath();
      ctx.moveTo(bx + 0.5, y - h + 2);
      ctx.lineTo(bx + 1.8, y - 3);
      ctx.lineTo(bx, y - 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawDriftwood(ctx, obj, available) {
    const { x, y, seed } = obj;
    this.drawShadow(ctx, x + 3, y + 2, 18, 5, 0.16);
    ctx.save();
    ctx.translate(x, y - 3);
    ctx.rotate(seed * 4 - 2);
    ctx.fillStyle = available ? '#786146' : '#5c4c39';
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9b805d';
    ctx.beginPath(); ctx.ellipse(-2, -1.5, 13, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a4630';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(12, 1); ctx.stroke();
    if (available) {
      ctx.fillStyle = '#8e9f59';
      ctx.beginPath(); ctx.arc(5, -3, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawObelisk(ctx, obj, time, available) {
    const { x, y, seed } = obj;
    this.drawShadow(ctx, x + 4, y + 2, 19, 7, 0.24);
    ctx.fillStyle = '#4b4a5b';
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 7, y - 48);
    ctx.lineTo(x + 7, y - 54);
    ctx.lineTo(x + 10, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#626176';
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 3);
    ctx.lineTo(x - 4, y - 46);
    ctx.lineTo(x + 1, y - 50);
    ctx.lineTo(x + 2, y - 3);
    ctx.closePath();
    ctx.fill();
    const glow = available ? 0.55 + Math.sin(time * 1.3 + seed * 8) * 0.35 : 0.1;
    ctx.strokeStyle = `rgba(140,240,210,${glow})`;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      const yy = y - 10 - i * 8;
      ctx.beginPath();
      ctx.moveTo(x - 3, yy);
      ctx.lineTo(x + 1, yy - 3);
      ctx.lineTo(x + 3, yy);
      ctx.lineTo(x - 1, yy - 5);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(140,240,210,${glow * 0.25})`;
    ctx.beginPath(); ctx.arc(x, y - 28, 19, 0, Math.PI * 2); ctx.fill();
  }

  drawLily(ctx, obj, time) {
    const { x, y, seed } = obj;
    const bob = Math.sin(time * 1.2 + seed * 9) * 1.2;
    ctx.fillStyle = '#3f7c4a';
    ctx.beginPath();
    ctx.ellipse(x, y + bob, 10, 5.5, seed * 3, 0.3, Math.PI * 2 - 0.3);
    ctx.lineTo(x, y + bob);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,210,150,.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y + bob); ctx.lineTo(x + 7, y + bob - 2); ctx.stroke();
    if (seed > 0.72) {
      ctx.fillStyle = '#f3b8d4';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + seed;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 3, y + bob + Math.sin(a) * 2, 2.8, 1.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe37a';
      ctx.beginPath(); ctx.arc(x, y + bob, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  buildMapBase() {
    const c = document.createElement('canvas');
    c.width = MAPRES;
    c.height = MAPRES;
    const ctx = c.getContext('2d');
    for (let y = 0; y < MAPRES; y++) {
      for (let x = 0; x < MAPRES; x++) {
        const wx = (x + 0.5) / MAPRES * this.size;
        const wy = (y + 0.5) / MAPRES * this.size;
        const key = this.biomeAt(wx, wy);
        const b = BIOMES[key];
        const n = valueNoise(wx / 170, wy / 170, this.seed + 99);
        ctx.fillStyle = shade(b.map, (n - 0.5) * 0.16);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  findSpawn() {
    // Search for a beautiful, playable starting spot: meadow near water and woodland.
    let best = null;
    let bestScore = -Infinity;
    const R = new RNG(this.seed + 777);
    for (let i = 0; i < 320; i++) {
      const ang = R.range(0, Math.PI * 2);
      const rad = Math.sqrt(R.next()) * this.size * 0.34;
      const x = this.size / 2 + Math.cos(ang) * rad;
      const y = this.size / 2 + Math.sin(ang) * rad;
      const key = this.biomeAt(x, y);
      if (key !== 'meadow' && key !== 'sand' && key !== 'forest') continue;
      if (this.isWater(x, y)) continue;
      let water = 0;
      let forest = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const kk = this.biomeAt(x + Math.cos(a) * 280, y + Math.sin(a) * 280);
        if (BIOMES[kk].water) water++;
        if (kk === 'forest') forest++;
      }
      const score = (key === 'meadow' ? 3 : key === 'forest' ? 2 : 1) + water * 0.55 + forest * 0.35;
      if (score > bestScore) { bestScore = score; best = { x, y, key }; }
    }
    if (!best) best = { x: this.size / 2, y: this.size / 2 };
    return best;
  }
}
