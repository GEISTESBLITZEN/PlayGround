// Procedural creature anatomy and rendering.
import { hsl, shade, rgba, clamp } from './util.js';
import { STAGES } from './data.js';

const DEFAULT = {
  len: 48, wid: 24, head: 16, legLen: 15, legs: 4,
  tail: 20, tailType: 'taper', spikes: 0, horns: 0, ears: 0,
  fin: 0, wing: 0, eyes: 2, pattern: 'spots', patternColor: '#2a4d33',
  color1: '#63c98a', color2: '#2d5f45', color3: '#b8f0c9',
  eye: '#ffe37a', glow: null, armor: 0, claws: 0, scale: 1,
  pupil: '#1a211c', teeth: 0
};

export function makePlayerPheno(genes, stage, hue, seed = 0) {
  const g = (id) => genes[id] || 0;
  const scale = STAGES[stage - 1].scale * (1 + g('might') * 0.12);
  const base = {
    ...DEFAULT,
    len: 50 * scale,
    wid: 25 * scale,
    head: 17 * scale,
    legLen: 16 * scale,
    tail: (18 + g('swift') * 2 + g('wings') * 2) * scale,
    legs: 4,
    color1: hsl(hue, 56, 55),
    color2: hsl(hue, 50, 33),
    color3: hsl((hue + 24) % 360, 62, 74),
    patternColor: hsl((hue + 320) % 360, 52, 32),
    eye: g('nightvision') ? '#bffcff' : '#ffe37a',
    glow: g('biolum') ? hsl((hue + 80) % 360, 95, 68) : g('electric') ? '#8fd6ff' : g('venom') ? '#8aff6a' : null,
    pattern: ['spots', 'stripes', 'spots', 'none'][seed % 4],
    spikes: g('spikes') * 2 + (stage >= 4 ? 2 : 0),
    horns: g('might') + (stage >= 3 ? 1 : 0),
    fin: g('gills') ? 1 : 0,
    wing: g('wings'),
    armor: g('carapace'),
    claws: g('claws'),
    teeth: g('claws') > 0 ? 1 : 0,
    scale
  };
  if (g('venom')) base.patternColor = '#4d7a2b';
  return base;
}

export function makeSpeciesPheno(species, extraScale = 1) {
  const p = { ...DEFAULT, ...species.pheno };
  const s = (species.size || 1) * extraScale;
  const out = { ...p };
  out.len = (p.len || 40) * s;
  out.wid = (p.wid || 20) * s;
  out.head = (p.head || 14) * s;
  out.legLen = (p.legLen || 12) * s;
  out.tail = (p.tail || 0) * s;
  out.scale = s;
  return out;
}

export function makeHeirPheno(genes, stage, hue, seed = 1) {
  return makePlayerPheno(genes, Math.max(1, stage - 1), hue, seed);
}

function bodyPath(ctx, len, wid) {
  ctx.beginPath();
  ctx.ellipse(0, 0, len * 0.5, wid * 0.5, 0, 0, Math.PI * 2);
}

export function drawCreature(ctx, x, y, angle, p, time, opts = {}) {
  const moving = opts.moving ? 1 : 0;
  const phase = opts.phase || 0;
  const len = p.len;
  const wid = p.wid;
  const head = p.head;
  const legLen = p.legLen;

  // ground shadow (unrotated)
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(8,18,14,0.22)';
  ctx.beginPath();
  ctx.ellipse(3, 6, len * 0.48, wid * 0.38, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);

  if (opts.selected) {
    ctx.strokeStyle = 'rgba(150,255,200,.35)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.72, wid * 0.9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.rotate(angle);
  const walk = time * (moving ? 12 : 2.2) + phase;
  const bob = moving ? Math.sin(walk * 2) * 1.1 : Math.sin(walk) * 0.35;
  ctx.translate(0, bob);

  // wings (under body)
  if (p.wing) {
    const flap = Math.sin(time * 6 + phase) * 0.22 * (moving ? 1 : 0.4);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(1, side);
      ctx.rotate(flap * side);
      const wg = ctx.createLinearGradient(0, -wid * 0.3, 0, -wid * 1.35);
      wg.addColorStop(0, rgba('#d8fff0', 0.24));
      wg.addColorStop(1, rgba('#9fe0cf', 0.08));
      ctx.fillStyle = wg;
      ctx.strokeStyle = rgba('#c8ffee', 0.32);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-len * 0.18, -wid * 0.22);
      ctx.quadraticCurveTo(-len * 0.15, -wid * (0.95 + p.wing * 0.16), len * 0.1, -wid * (1.08 + p.wing * 0.18));
      ctx.quadraticCurveTo(len * 0.24, -wid * 0.5, len * 0.28, -wid * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // tail
  if (p.tail > 0 && p.tailType !== 'none') {
    const sway = Math.sin(walk * 0.9 + phase) * (moving ? 0.22 : 0.09);
    ctx.save();
    ctx.translate(-len * 0.42, 0);
    ctx.rotate(sway);
    if (p.tailType === 'whip' || p.tailType === 'spike') {
      ctx.strokeStyle = p.color2;
      ctx.lineWidth = Math.max(2.4, wid * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-p.tail * 0.55, 0, -p.tail, p.tail * 0.1);
      ctx.stroke();
      if (p.tailType === 'spike') {
        ctx.fillStyle = p.color3;
        for (let i = 0; i < 3; i++) {
          const t = 0.35 + i * 0.2;
          ctx.beginPath();
          ctx.moveTo(-p.tail * t, 0);
          ctx.lineTo(-p.tail * (t + 0.08), -3 - i);
          ctx.lineTo(-p.tail * (t + 0.12), 0);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (p.tailType === 'fin') {
      ctx.fillStyle = rgba(p.color3, 0.55);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-p.tail * 0.6, -p.tail * 0.55, -p.tail, 0);
      ctx.quadraticCurveTo(-p.tail * 0.6, p.tail * 0.55, 0, 0);
      ctx.fill();
    } else if (p.tailType === 'puff' || p.tailType === 'tuft') {
      ctx.fillStyle = p.color3;
      ctx.beginPath();
      ctx.ellipse(-p.tail * 0.7, 0, p.tail * 0.36, p.tail * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color2;
      ctx.beginPath();
      ctx.ellipse(-p.tail * 0.55, 0, p.tail * 0.24, p.tail * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color2;
      ctx.beginPath();
      ctx.moveTo(0, -wid * 0.16);
      ctx.quadraticCurveTo(-p.tail * 0.7, -wid * 0.24, -p.tail, 0);
      ctx.quadraticCurveTo(-p.tail * 0.7, wid * 0.24, 0, wid * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // legs
  if (p.legs > 0 && legLen > 0) {
    const pairs = Math.ceil(p.legs / 2);
    for (let i = 0; i < pairs; i++) {
      const side = i / 2 + 0.5;
      const lx = -len * 0.3 + (i / Math.max(1, pairs - 1)) * len * 0.6;
      for (const s of [-1, 1]) {
        const swing = Math.sin(walk + i * 1.7 + (s > 0 ? Math.PI : 0)) * (moving ? 0.55 : 0.15);
        const hipX = lx;
        const hipY = s * wid * 0.34;
        const footX = hipX + Math.sin(swing) * legLen * 0.55;
        const footY = hipY + s * legLen * (0.64 + Math.abs(Math.cos(swing)) * 0.2);
        ctx.strokeStyle = p.color2;
        ctx.lineWidth = Math.max(2, wid * 0.13);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.quadraticCurveTo(hipX + footX * 0.15, hipY + s * legLen * 0.55, footX, footY);
        ctx.stroke();
        ctx.fillStyle = p.color3;
        ctx.beginPath();
        ctx.arc(footX, footY, Math.max(1.3, wid * 0.075), 0, Math.PI * 2);
        ctx.fill();
        if (p.claws > 0) {
          ctx.strokeStyle = '#f1ead8';
          ctx.lineWidth = 0.9;
          for (let c = -1; c <= 1; c++) {
            ctx.beginPath();
            ctx.moveTo(footX + c * 2.1, footY + s * 1.2);
            ctx.lineTo(footX + c * 2.8, footY + s * 4 + (c === 0 ? 1 : 0));
            ctx.stroke();
          }
        }
      }
    }
  }

  // dorsal fin
  if (p.fin || p.tailType === 'fin') {
    ctx.fillStyle = rgba(p.color3, 0.5);
    ctx.beginPath();
    ctx.moveTo(-len * 0.15, -wid * 0.44);
    ctx.quadraticCurveTo(-len * 0.02, -wid * 0.95, len * 0.18, -wid * 0.44);
    ctx.closePath();
    ctx.fill();
  }

  // side spikes
  if (p.spikes > 0) {
    ctx.fillStyle = p.color3;
    for (let i = 0; i < p.spikes; i++) {
      const t = (i + 0.5) / p.spikes;
      const sx = -len * 0.28 + t * len * 0.58;
      const s = i % 2 === 0 ? -1 : 1;
      const sh = wid * (0.38 + (i % 3) * 0.08);
      ctx.beginPath();
      ctx.moveTo(sx - 3, s * wid * 0.35);
      ctx.lineTo(sx, s * (wid * 0.5 + sh));
      ctx.lineTo(sx + 4, s * wid * 0.36);
      ctx.closePath();
      ctx.fill();
    }
  }

  // body
  const grad = ctx.createRadialGradient(-len * 0.12, -wid * 0.24, wid * 0.1, 0, 0, len * 0.6);
  grad.addColorStop(0, p.color3);
  grad.addColorStop(0.42, p.color1);
  grad.addColorStop(1, p.color2);
  ctx.fillStyle = grad;
  bodyPath(ctx, len, wid);
  ctx.fill();

  // patterns clipped to body
  ctx.save();
  bodyPath(ctx, len, wid);
  ctx.clip();
  ctx.fillStyle = rgba(p.patternColor, 0.62);
  if (p.pattern === 'spots') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (p.scale || 1);
      const rr = 0.18 + ((i * 37) % 24) / 100;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * len * rr * 0.7, Math.sin(a) * wid * rr * 0.64, wid * (0.055 + (i % 3) * 0.02), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.pattern === 'stripes') {
    for (let i = -2; i <= 2; i++) {
      ctx.save();
      ctx.translate(i * len * 0.13, 0);
      ctx.rotate(0.28);
      ctx.fillRect(-len * 0.022, -wid, len * 0.052, wid * 2);
      ctx.restore();
    }
  }
  ctx.restore();

  // carapace plates
  if (p.armor > 0) {
    ctx.strokeStyle = rgba('#f2ead6', 0.35);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3 + p.armor; i++) {
      const px = -len * 0.25 + (i / (2 + p.armor)) * len * 0.55;
      ctx.beginPath();
      ctx.ellipse(px, 0, len * 0.06, wid * 0.39, 0, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
    }
    ctx.fillStyle = rgba('#f2ead6', 0.22);
    ctx.beginPath();
    ctx.ellipse(-len * 0.02, -wid * 0.12, len * 0.28, wid * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // rim light
  ctx.strokeStyle = rgba('#ffffff', 0.14);
  ctx.lineWidth = 1.2;
  bodyPath(ctx, len, wid);
  ctx.stroke();

  // head
  const hx = len * 0.43;
  const hg = ctx.createRadialGradient(hx - head * 0.18, -head * 0.28, 1, hx, 0, head * 1.2);
  hg.addColorStop(0, p.color3);
  hg.addColorStop(0.5, p.color1);
  hg.addColorStop(1, p.color2);
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(hx + head * 0.1, 0, head * 0.66, head * 0.58, 0, 0, Math.PI * 2);
  ctx.fill();

  // snout
  ctx.fillStyle = p.color1;
  ctx.beginPath();
  ctx.ellipse(hx + head * 0.72, 0, head * 0.3, head * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(p.color2, 0.9);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(hx + head * 0.78, 0, head * 0.2, -0.8, 0.8);
  ctx.stroke();
  if (p.teeth) {
    ctx.fillStyle = '#f7f0dd';
    for (let i = 0; i < 3; i++) {
      const tx = hx + head * 0.7 + i * 2.1;
      ctx.beginPath();
      ctx.moveTo(tx, head * 0.13);
      ctx.lineTo(tx + 1.4, head * 0.13);
      ctx.lineTo(tx + 0.6, head * 0.25);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ears
  if (p.ears > 0) {
    ctx.fillStyle = p.color2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hx - head * 0.18, s * head * 0.42, head * 0.2, head * 0.11, s * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color3;
      ctx.beginPath();
      ctx.ellipse(hx - head * 0.18, s * head * 0.42, head * 0.11, head * 0.06, s * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color2;
    }
  }

  // horns
  if (p.horns > 0) {
    ctx.fillStyle = '#e9dfc6';
    ctx.strokeStyle = 'rgba(80,60,40,.35)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < p.horns; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const hlen = head * (0.7 + (i % 3) * 0.15);
      ctx.beginPath();
      ctx.moveTo(hx + head * 0.18, s * head * 0.3);
      ctx.quadraticCurveTo(hx + head * 0.55, s * head * 0.66, hx + head * 0.45, s * (head * 0.3 + hlen));
      ctx.quadraticCurveTo(hx + head * 0.32, s * head * 0.55, hx + head * 0.05, s * head * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // eyes
  const eyeCount = Math.min(3, p.eyes || 2);
  for (let i = 0; i < eyeCount; i++) {
    const s = eyeCount === 1 ? 0 : i === 0 ? -1 : 1;
    const ex = hx + head * 0.28 + (i === 2 ? -head * 0.22 : 0);
    const ey = s * head * 0.27;
    if (p.glow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(p.glow, 0.22);
      ctx.beginPath();
      ctx.arc(ex, ey, head * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = p.eye;
    ctx.beginPath();
    ctx.ellipse(ex, ey, head * 0.16, head * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.pupil;
    ctx.beginPath();
    ctx.ellipse(ex + head * 0.035, ey, head * 0.06, head * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(ex - head * 0.04, ey - head * 0.04, head * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  // bioluminescent dots
  if (p.glow) {
    ctx.fillStyle = rgba(p.glow, 0.8);
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      ctx.beginPath();
      ctx.arc(-len * 0.22 + t * len * 0.4, (i % 2 ? 1 : -1) * wid * 0.18, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (opts.flash) {
    ctx.globalAlpha = clamp(opts.flash, 0, 0.75);
    ctx.fillStyle = '#fff4e0';
    bodyPath(ctx, len, wid);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx + head * 0.1, 0, head * 0.66, head * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

export function drawCreaturePreview(canvas, pheno, time = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * 0.8);
  g.addColorStop(0, 'rgba(90,190,140,.15)');
  g.addColorStop(1, 'rgba(90,190,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const maxDim = Math.max(pheno.len, pheno.wid);
  const scale = Math.min(1.6, (h * 0.62) / maxDim);
  ctx.save();
  ctx.translate(w / 2, h / 2 + 6);
  ctx.scale(scale, scale);
  ctx.translate(-pheno.len * 0.06, 0);
  drawCreature(ctx, 0, 0, -Math.PI / 2, pheno, time, { moving: false, selected: false });
  ctx.restore();
}
