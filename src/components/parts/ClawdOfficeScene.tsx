'use client';

/**
 * Supplied `clawd_office_timer.html` の canvas scene を React に移したもの。
 * タイマーの残り時間は描画せず `ClawdWorkWindow` のストアを読むだけなので、
 * この canvas を開いても別の setInterval / 時間源は生まれない。
 */

import { useEffect, useRef } from 'react';

export type OfficeWeather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm';
export type OfficeScenePhase = 'work' | 'pause' | 'done';

export interface ClawdOfficeSceneProps {
  phase: OfficeScenePhase;
  timeMinutes: number;
  weather: OfficeWeather;
  /** 親からのクリック合図。canvas 内のリアクションはここでだけ起動する。 */
  pokeNonce: number;
  /** 参照HTMLと同じ位置にcanvas内表示する一時メッセージ。 */
  toastMessage: string;
  onPoke?: () => void;
}

const SW = 1200;
const SH = 735;
const PITCH = 6;
const DOT = 2.2;
const CELL = 8.7;
const WIN = { x: 345, y: 52, w: 455, h: 404 };
const DESK = { x: 500, y: 517, w: 295, h: 18 };
const CX = 356 - CELL;
const CY = 428;

type Palette = {
  top: string;
  mid: string;
  bot: string;
  light: string;
  li: number;
  star: number;
  lampOn: boolean;
  bg: string;
  dotAlpha: number;
  dotColor: string;
  weather: OfficeWeather;
  rain: number;
  snow: number;
  clouds: number;
  bolt: boolean;
};

type RuntimePhase = 'open' | 'work' | 'close' | 'pause' | 'done';
type Runtime = {
  phase: RuntimePhase;
  wanted: OfficeScenePhase;
  anim: number;
  laptopY: number;
  lid: number;
  laptopVis: number;
  typing: number;
  look: number;
  raise: number;
  gaze: number;
  blink: number;
  nextBlink: number;
  react: number;
  toast: string;
  toastA: number;
  toastT: number;
};

const KEYS = [
  { h: 0, top: '#070b1a', mid: '#0b1226', bot: '#161d36', light: '#7c8fc9', li: 0.05, star: 1 },
  { h: 5, top: '#131a3a', mid: '#3a2e55', bot: '#6b4560', light: '#b08aa8', li: 0.07, star: 0.45 },
  { h: 6.5, top: '#3e4c86', mid: '#b0708a', bot: '#e9a46b', light: '#f0b183', li: 0.13, star: 0 },
  { h: 9, top: '#5c93d6', mid: '#9cc4ec', bot: '#dceaf7', light: '#eaf2fb', li: 0.17, star: 0 },
  { h: 13, top: '#4e8ad4', mid: '#8fbeea', bot: '#d6e9f8', light: '#ffffff', li: 0.19, star: 0 },
  { h: 16.5, top: '#6e8fd0', mid: '#e2a06c', bot: '#f3c98d', light: '#ffc489', li: 0.15, star: 0 },
  { h: 18.5, top: '#2e2c5e', mid: '#8a4b6b', bot: '#e0794f', light: '#e08a5a', li: 0.1, star: 0.15 },
  { h: 20, top: '#111633', mid: '#1e2044', bot: '#39304f', light: '#8a7fb0', li: 0.06, star: 0.7 },
  { h: 24, top: '#070b1a', mid: '#0b1226', bot: '#161d36', light: '#7c8fc9', li: 0.05, star: 1 },
] as const;

const WEATHER: Record<OfficeWeather, { tint: string; amt: number; dim: number; clouds: number; rain: number; snow: number; bolt: boolean }> = {
  clear: { tint: '#8aa4c8', amt: 0, dim: 1, clouds: 0, rain: 0, snow: 0, bolt: false },
  cloudy: { tint: '#8e949c', amt: 0.46, dim: 0.62, clouds: 5, rain: 0, snow: 0, bolt: false },
  rain: { tint: '#5a6068', amt: 0.6, dim: 0.44, clouds: 6, rain: 110, snow: 0, bolt: false },
  snow: { tint: '#b9c2cc', amt: 0.52, dim: 0.56, clouds: 5, rain: 0, snow: 70, bolt: false },
  storm: { tint: '#3a3f49', amt: 0.74, dim: 0.3, clouds: 7, rain: 150, snow: 0, bolt: true },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smooth(value: number): number {
  const v = clamp(value, 0, 1);
  return v * v * (3 - 2 * v);
}

function random(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function mix(a: string, b: string, t: number): string {
  const left = hexRgb(a);
  const right = hexRgb(b);
  const values = left.map((value, index) => Math.round(value + (right[index] - value) * t));
  return `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function paletteFor(minutes: number, weather: OfficeWeather): Palette {
  const h = (((minutes / 60) % 24) + 24) % 24;
  let index = 0;
  while (index < KEYS.length - 2 && h > KEYS[index + 1].h) index += 1;
  const a = KEYS[index];
  const b = KEYS[index + 1];
  const progress = smooth((h - a.h) / (b.h - a.h));
  const wx = WEATHER[weather];
  const li = (a.li + (b.li - a.li) * progress) * wx.dim;
  const mid = mix(mix(a.mid, b.mid, progress), wx.tint, wx.amt);
  return {
    top: mix(mix(a.top, b.top, progress), wx.tint, wx.amt),
    mid,
    bot: mix(mix(a.bot, b.bot, progress), wx.tint, wx.amt),
    light: mix(a.light, b.light, progress),
    li,
    star: (a.star + (b.star - a.star) * progress) * (1 - wx.amt),
    lampOn: li < 0.085,
    bg: mix('#121212', '#20242b', clamp(li * 3.2, 0, 0.85)),
    dotAlpha: clamp(0.52 + li * 1.9, 0.5, 0.95),
    dotColor: mix('#ffffff', mix(a.light, b.light, progress), 0.25),
    weather,
    rain: wx.rain,
    snow: wx.snow,
    clouds: wx.clouds,
    bolt: wx.bolt,
  };
}

function createMask(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = SW;
  canvas.height = SH;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  context.fillStyle = '#000';
  context.fillRect(0, 0, SW, SH);
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  context.lineWidth = 4;
  context.lineCap = 'butt';
  context.lineJoin = 'miter';
  return context;
}

function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function polyline(g: CanvasRenderingContext2D, points: Array<[number, number]>, close = false): void {
  g.beginPath();
  g.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => g.lineTo(x, y));
  if (close) g.closePath();
  g.stroke();
}

function sprig(g: CanvasRenderingContext2D, x: number, y: number, radius: number, count: number, seed: number): void {
  const rd = random(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (rd() - 0.5) * 2.5;
    const distance = radius * (0.45 + rd() * 0.55);
    const tx = x + Math.cos(angle) * distance;
    const ty = y + Math.sin(angle) * distance;
    line(g, x, y, tx, ty);
    g.fillRect(tx - 3, ty - 3, 6, 6);
  }
}

function drawRoom(g: CanvasRenderingContext2D): void {
  line(g, 0, 458, 1200, 458); line(g, 0, 466, 1200, 466);
  line(g, 0, 668, 1200, 668); line(g, 0, 676, 1200, 676);
  g.strokeRect(WIN.x, WIN.y, WIN.w, WIN.h);
  line(g, WIN.x + 2, WIN.y + WIN.h - 2, WIN.x + WIN.w - 2, WIN.y + WIN.h - 2);
  g.beginPath(); g.arc(116, 166, 36, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(116, 166, 10, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    line(g, 116, 166, 116 + Math.cos(angle) * 17, 166 + Math.sin(angle) * 17);
  }
  g.strokeRect(80, 222, 74, 84);
  g.strokeRect(168, 140, 154, 182);
  polyline(g, [[186, 200], [204, 180], [226, 196], [244, 176], [244, 200]]);
  g.strokeRect(256, 170, 50, 32);
  polyline(g, [[186, 232], [186, 268], [300, 268], [300, 232]]);
  polyline(g, [[198, 250], [222, 238], [250, 254], [276, 240], [292, 252]]);
  polyline(g, [[186, 300], [212, 286], [240, 302], [266, 286], [300, 300]]);
  g.strokeRect(52, 396, 258, 8);
  sprig(g, 96, 378, 52, 11, 7);
  polyline(g, [[96, 396], [88, 414], [100, 430], [86, 444]]);
  polyline(g, [[146, 392], [158, 368], [172, 386], [186, 364], [198, 384], [204, 372]]);
  polyline(g, [[238, 396], [238, 368], [246, 356], [266, 356], [274, 368], [274, 396]]);
  g.beginPath(); g.arc(256, 378, 8, 0, Math.PI * 2); g.stroke();
  line(g, 818, 190, 818, 548);
  g.strokeRect(818, 190, 382, 8); g.strokeRect(818, 288, 382, 8);
  sprig(g, 904, 178, 52, 10, 21);
  g.strokeRect(1042, 140, 66, 50);
  polyline(g, [[1050, 182], [1068, 158], [1082, 172], [1100, 150]]);
  g.strokeRect(840, 252, 20, 36); g.strokeRect(864, 226, 20, 62); g.strokeRect(888, 242, 20, 46);
  polyline(g, [[930, 288], [930, 254], [948, 240], [966, 256], [984, 238], [996, 252], [996, 288]]);
  g.beginPath(); g.arc(1138, 258, 30, 0, Math.PI * 2); g.stroke();
  line(g, 1138, 258, 1138, 228); line(g, 1138, 258, 1166, 266);
  polyline(g, [[1052, 388], [1070, 306], [1088, 388]]);
  g.strokeRect(1100, 326, 38, 32); g.strokeRect(1152, 318, 14, 70); g.strokeRect(1170, 326, 12, 62);
  g.strokeRect(824, 398, 146, 44); g.strokeRect(982, 398, 146, 44); g.strokeRect(1140, 398, 60, 44);
  sprig(g, 968, 540, 92, 16, 33); g.strokeRect(912, 582, 116, 14);
  polyline(g, [[922, 596], [934, 658], [1006, 658], [1018, 596]]);
  polyline(g, [[34, 506], [46, 474], [70, 474], [80, 506]]);
  g.strokeRect(0, 506, 176, 176); g.strokeRect(12, 540, 138, 48); g.strokeRect(12, 598, 138, 48);
  g.strokeRect(188, 598, 96, 14); polyline(g, [[196, 612], [206, 682], [268, 682], [278, 612]]);
  polyline(g, [[272, 462], [298, 438], [338, 462], [338, 520], [272, 520]], true);
  g.fillRect(338, 553, 130, 13); g.fillRect(382, 566, 22, 84); g.fillRect(344, 656, 132, 13);
  line(g, 394, 650, 346, 662); line(g, 394, 650, 470, 662);
  g.fillRect(DESK.x, DESK.y, DESK.w, DESK.h); line(g, 572, 506, DESK.x + DESK.w, 506);
  g.fillRect(518, 535, 10, 133); g.fillRect(758, 535, 10, 133);
  g.fillRect(734, 454, 8, 63); line(g, 720, 514, 752, 514);
}

function drawLamp(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(642, 454);
  g.quadraticCurveTo(688, 392, 734, 454);
  g.closePath();
  g.fill();
}

function drawOutside(g: CanvasRenderingContext2D): void {
  const rd = random(99);
  g.save();
  g.beginPath();
  g.rect(WIN.x + 4, WIN.y + 4, WIN.w - 8, WIN.h - 8);
  g.clip();
  line(g, 349, 450, 796, 450);
  polyline(g, [[556, 450], [642, 384], [684, 414], [726, 374], [790, 450]]);
  g.beginPath();
  g.moveTo(524, 456); g.lineTo(552, 302); g.lineTo(574, 196); g.lineTo(596, 118);
  g.lineTo(628, 120); g.lineTo(624, 212); g.lineTo(616, 318); g.lineTo(614, 456);
  g.closePath(); g.fill();
  g.lineWidth = 10;
  line(g, 562, 272, 488, 206); line(g, 492, 210, 452, 180); line(g, 582, 208, 528, 160);
  line(g, 606, 168, 664, 132); line(g, 620, 262, 704, 212); line(g, 700, 214, 748, 184);
  line(g, 626, 146, 678, 112); g.lineWidth = 6;
  line(g, 470, 192, 438, 168); line(g, 730, 196, 764, 172); line(g, 540, 150, 506, 124);
  g.lineWidth = 4;
  const canopies: Array<[number, number, number, number]> = [[686, 200, 124, 560], [566, 136, 74, 240], [470, 190, 58, 130]];
  canopies.forEach(([x, y, radius, count], canopyIndex) => {
    for (let i = 0; i < count; i += 1) {
      const angle = rd() * Math.PI * 2;
      const distance = Math.pow(rd(), canopyIndex === 0 ? 0.42 : 0.5) * radius;
      g.fillRect(x + Math.cos(angle) * distance * (canopyIndex === 0 ? 1.16 : 1.2), y + Math.sin(angle) * distance * 0.86, 6, 6);
    }
  });
  for (let i = 0; i < 34; i += 1) {
    const x = 380 + rd() * 400;
    const y = 180 + rd() * 250;
    line(g, x, y, x + 7, y + 11);
  }
  g.restore();
}

function dots(g: CanvasRenderingContext2D): number[] {
  const pixels = g.getImageData(0, 0, SW, SH).data;
  const result: number[] = [];
  for (let y = 0; y < SH; y += PITCH) {
    for (let x = 0; x < SW; x += PITCH) {
      let on = false;
      for (let row = 1; row < PITCH - 1 && !on; row += 1) {
        for (let col = 1; col < PITCH - 1; col += 1) {
          const px = x + col;
          const py = y + row;
          if (px < SW && py < SH && pixels[(py * SW + px) * 4] > 110) { on = true; break; }
        }
      }
      if (on) result.push(x, y);
    }
  }
  return result;
}

function baked(source: number[], color: string, alpha: number, scale: number): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.ceil(SW * scale));
  layer.height = Math.max(1, Math.ceil(SH * scale));
  const g = layer.getContext('2d');
  if (!g) return layer;
  g.fillStyle = color;
  g.globalAlpha = alpha;
  const size = Math.max(1, Math.round(DOT * scale));
  const offset = (PITCH * scale - size) / 2;
  for (let i = 0; i < source.length; i += 2) {
    g.fillRect(Math.round(source[i] * scale + offset), Math.round(source[i + 1] * scale + offset), size, size);
  }
  return layer;
}

const CLAWD = [
  '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...', '.XXXXXXEEXXXXXXEE...',
  '.XXXXXXEEXXXXXXEE...', '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...',
  '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...', '.XXXXXXXXXXXXXXXX...', '.XX..XX....XX..XX...',
  'XXX.XXX...XXX.XXX...', 'XX..XX....XX..XX....',
];

function drawClawd(ctx: CanvasRenderingContext2D, now: number, state: Runtime, reduced: boolean): void {
  const body = '#D77656';
  const dark = '#C1684C';
  const bob = (reduced ? 0 : state.typing > 0.45 ? (Math.sin(now / 260) > 0.75 ? -1 : 0) : (Math.sin(now / 1700) > 0.6 ? -1 : 0)) - 3 * state.raise;
  const cell = (column: number, row: number, width: number, height: number, dx = 0, dy = 0) => {
    ctx.fillRect(CX + column * CELL + dx, CY + row * CELL + dy, Math.ceil(width * CELL) + 0.5, Math.ceil(height * CELL) + 0.5);
  };
  ctx.fillStyle = body;
  CLAWD.forEach((lineValue, row) => {
    for (let column = 5; column < lineValue.length; column += 1) if (lineValue.charAt(column) !== '.') cell(column, row, 1, 1, 0, bob);
  });
  ctx.fillStyle = dark;
  CLAWD.forEach((lineValue, row) => {
    for (let column = 0; column < 5; column += 1) if (lineValue.charAt(column) === 'X') cell(column, row, 1, 1, 0, bob);
  });
  const wave = reduced ? 0 : now / 125;
  let nearY = -19 * state.typing * (0.5 + 0.5 * Math.cos(wave));
  let farY = -19 * state.typing * (0.5 + 0.5 * Math.cos(wave + 2.7)) - 3.5 * state.typing;
  let nearX = 5 * state.typing * Math.sin(wave * 0.5);
  let farX = 5 * state.typing * Math.sin(wave * 0.5 + 2.2) + 6 * state.typing;
  if (state.raise > 0.001) {
    const wiggle = reduced ? 0 : Math.sin(now / 150) * 2.4 * state.raise;
    nearX = nearX * (1 - state.raise) + (8 + wiggle) * state.raise;
    nearY = nearY * (1 - state.raise) + (-70 - wiggle) * state.raise;
    farX = farX * (1 - state.raise) + (-26 - wiggle) * state.raise;
    farY = farY * (1 - state.raise) + (-78 + wiggle) * state.raise;
  }
  const paw = (dx: number, dy: number, color: string) => {
    const start = CX + 17 * CELL;
    ctx.fillStyle = color;
    ctx.fillRect(start + dx, CY + 5 * CELL + dy, Math.ceil(3 * CELL) + 0.5, Math.ceil(4 * CELL) + 0.5);
  };
  paw(farX, farY + bob, dark); paw(nearX, nearY + bob, body);
  const gaze = clamp(state.gaze - state.look, 0, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(CX + CELL, CY - 4 * CELL + bob, 16 * CELL, 18 * CELL); ctx.clip();
  ctx.fillStyle = '#141414';
  if (state.blink > 0) {
    cell(7, 4, 2, 0.45, 2.8 * gaze, bob + 1.9 * gaze); cell(15, 4, 2, 0.45, 2.8 * gaze, bob + 1.9 * gaze);
  } else {
    const grow = 0.16 * state.look;
    cell(7 - grow, 3 - grow, 2 + grow * 2, 2 + grow * 2, 2.8 * gaze, bob + 1.9 * gaze);
    cell(15 - grow, 3 - grow, 2 + grow * 2, 2 + grow * 2, 2.8 * gaze, bob + 1.9 * gaze);
  }
  ctx.restore();
}

function drawLaptop(ctx: CanvasRenderingContext2D, now: number, state: Runtime): void {
  if (state.laptopVis <= 0) return;
  const rise = state.laptopY;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, SW, DESK.y + 2); ctx.clip(); ctx.globalAlpha = state.laptopVis;
  const angle = (-Math.PI / 2) * (1 - state.lid) + 0.62 * state.lid;
  const glow = state.phase === 'work' ? 1 : state.lid > 0.6 ? 0.5 : 0;
  ctx.save(); ctx.translate(570, 515 + rise); ctx.rotate(angle);
  ctx.fillStyle = '#E4DFD7'; ctx.fillRect(-9, -52, 9, 52); ctx.fillStyle = '#B9B3AA'; ctx.fillRect(-9, -52, 9, 2.5);
  if (glow > 0) {
    ctx.fillStyle = `rgba(150,205,255,${0.85 * glow})`; ctx.fillRect(-11.4, -48, 2.4, 44);
    ctx.fillStyle = `rgba(210,235,255,${0.5 * glow})`;
    for (let i = 0; i < 3; i += 1) ctx.fillRect(-11.4, -43 + i * 13, 2.4 * (0.4 + 0.6 * Math.abs(Math.sin(now / 380 + i * 1.9))), 6);
  }
  ctx.restore();
  ctx.fillStyle = '#E4DFD7'; ctx.fillRect(512, 507 + rise, 60, 8); ctx.fillStyle = '#B9B3AA'; ctx.fillRect(512, 513 + rise, 60, 2);
  ctx.restore();
}

export function ClawdOfficeScene({ phase, timeMinutes, weather, pokeNonce, toastMessage, onPoke }: ClawdOfficeSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ phase, timeMinutes, weather, pokeNonce, toastMessage, onPoke });
  propsRef.current = { phase, timeMinutes, weather, pokeNonce, toastMessage, onPoke };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // createMask is intentionally called afresh for each source layer: the source
    // reference bakes the static line work once and recolors it when light changes.
    const roomMask = createMask(); drawRoom(roomMask); const roomDots = dots(roomMask);
    const outMask = createMask(); drawOutside(outMask); const outDots = dots(outMask);
    const lampMask = createMask(); drawLamp(lampMask); const lampDots = dots(lampMask);
    let scale = 1;
    let ox = 0;
    let oy = 0;
    let palette = paletteFor(propsRef.current.timeMinutes, propsRef.current.weather);
    let roomLayer: HTMLCanvasElement | null = null;
    let outLayer: HTMLCanvasElement | null = null;
    let lampLayer: HTMLCanvasElement | null = null;
    const drops = Array.from({ length: 170 }, (_, index) => {
      const rd = random(4242 + index * 19);
      return { x: WIN.x + rd() * WIN.w, y: WIN.y + rd() * WIN.h, v: 520 + rd() * 380, l: 12 + rd() * 16 };
    });
    const flakes = Array.from({ length: 90 }, (_, index) => {
      const rd = random(817 + index * 37);
      return { x: WIN.x + rd() * WIN.w, y: WIN.y + rd() * WIN.h, v: 26 + rd() * 34, p: rd() * 6.28, a: 0.45 + rd() * 0.5, s: 2 + Math.round(rd() * 2) };
    });
    const clouds = Array.from({ length: 8 }, (_, index) => {
      const rd = random(331 + index * 11);
      return { x: rd() * WIN.w, y: WIN.y + 18 + rd() * 130, w: 110 + rd() * 130, h: 26 + rd() * 22, v: 5 + rd() * 9, o: 0.1 + rd() * 0.16 };
    });
    const state: Runtime = { phase: phase === 'work' ? 'work' : phase, wanted: phase, anim: 0, laptopY: phase === 'work' ? 0 : 70, lid: phase === 'work' ? 1 : 0, laptopVis: phase === 'work' ? 1 : 0, typing: phase === 'work' ? 1 : 0, look: 0, raise: phase === 'done' ? 1 : 0, gaze: phase === 'work' ? 1 : 0, blink: 0, nextBlink: 2200, react: -1, toast: '', toastA: 0, toastT: 0 };
    let frame = 0;
    let previous = 0;
    let flash = 0;
    let nextBolt = 6000;
    let bolt: { p: Array<[number, number]>; life: number } | null = null;
    let lastPaletteKey = '';
    let lastPokeNonce = propsRef.current.pokeNonce;
    let lastToastMessage = propsRef.current.toastMessage;
    if (lastToastMessage) {
      state.toast = lastToastMessage;
      state.toastT = 4500;
    }

    const bake = () => {
      roomLayer = baked(roomDots, palette.dotColor, palette.dotAlpha, scale);
      const [r, g, b] = hexRgb(palette.mid);
      const luminosity = r * 0.299 + g * 0.587 + b * 0.114;
      const color = luminosity > 96 ? mix('#161a1f', palette.mid, 0.14) : mix('#ffffff', palette.mid, 0.3);
      const alpha = luminosity > 96 ? 0.8 : clamp(palette.dotAlpha * 0.95, 0.45, 0.92);
      outLayer = baked(outDots, color, alpha, scale);
      lampLayer = baked(lampDots, color, alpha, scale);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      scale = Math.max(canvas.width / SW, canvas.height / SH);
      ox = (canvas.width - SW * scale) * 0.34;
      oy = (canvas.height - SH * scale) * 0.6;
      bake();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const drawSky = (now: number, dt: number) => {
      ctx.save(); ctx.beginPath(); ctx.rect(WIN.x + 3, WIN.y + 3, WIN.w - 6, WIN.h - 6); ctx.clip();
      const gradient = ctx.createLinearGradient(0, WIN.y, 0, WIN.y + WIN.h);
      gradient.addColorStop(0, palette.top); gradient.addColorStop(0.55, palette.mid); gradient.addColorStop(1, palette.bot);
      ctx.fillStyle = gradient; ctx.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
      if (palette.star > 0.02) {
        const rd = random(77); ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 70; i += 1) { ctx.globalAlpha = palette.star * (0.25 + 0.75 * Math.abs(Math.sin(now / 900 + i))); ctx.fillRect(WIN.x + rd() * WIN.w, WIN.y + rd() * WIN.h * 0.75, 2, 2); }
        ctx.globalAlpha = 1;
      }
      clouds.slice(0, palette.clouds).forEach((cloud) => {
        const x = WIN.x + ((cloud.x + now / 1000 * cloud.v) % (WIN.w + cloud.w * 2)) - cloud.w;
        ctx.fillStyle = `rgba(255,255,255,${cloud.o})`; ctx.beginPath(); ctx.ellipse(x, cloud.y, cloud.w * 0.5, cloud.h * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(x + cloud.w * 0.22, cloud.y - cloud.h * 0.3, cloud.w * 0.32, cloud.h * 0.46, 0, 0, Math.PI * 2); ctx.fill();
      });
      if (outLayer) ctx.drawImage(outLayer, 0, 0, SW, SH);
      if (palette.rain) {
        ctx.strokeStyle = 'rgba(196,220,255,.46)'; ctx.lineWidth = 1.6; ctx.beginPath();
        drops.slice(0, palette.rain).forEach((drop) => { drop.y += drop.v * dt; drop.x += drop.v * dt * 0.16; if (drop.y > WIN.y + WIN.h) { drop.y = WIN.y - 20; drop.x = WIN.x + Math.random() * WIN.w; } if (drop.x > WIN.x + WIN.w) drop.x -= WIN.w; ctx.moveTo(drop.x, drop.y); ctx.lineTo(drop.x - drop.l * 0.16, drop.y - drop.l); });
        ctx.stroke();
      }
      if (palette.snow) flakes.slice(0, palette.snow).forEach((flake) => { flake.y += flake.v * dt; flake.x += Math.sin(now / 1200 + flake.p) * 0.35; if (flake.y > WIN.y + WIN.h) { flake.y = WIN.y - 8; flake.x = WIN.x + Math.random() * WIN.w; } ctx.fillStyle = `rgba(255,255,255,${flake.a})`; ctx.fillRect(flake.x, flake.y, flake.s, flake.s); });
      if (bolt && bolt.life > 0) { ctx.strokeStyle = `rgba(255,255,255,${clamp(bolt.life * 3, 0, 0.9)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...bolt.p[0]); bolt.p.slice(1).forEach((point) => ctx.lineTo(...point)); ctx.stroke(); }
      ctx.restore();
    };

    const drawLights = () => {
      const a = clamp(palette.li * 1.1 + flash * 0.35, 0, 0.24);
      if (a > 0.012) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.beginPath(); ctx.rect(0, WIN.y + WIN.h - 4, SW, SH); ctx.clip();
        for (let i = 0; i < 3; i += 1) { const t = i / 2; const gradient = ctx.createLinearGradient(0, WIN.y + WIN.h, 0, SH - 10); gradient.addColorStop(0, `rgba(255,255,255,${a * (0.42 - i * 0.1)})`); gradient.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(WIN.x + 30 - t * 30, WIN.y + WIN.h - 4); ctx.lineTo(WIN.x + WIN.w - 30 + t * 30, WIN.y + WIN.h - 4); ctx.lineTo(WIN.x + WIN.w + 40 + t * 110, SH); ctx.lineTo(WIN.x - 40 - t * 110, SH); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }
      if (palette.lampOn) { const gradient = ctx.createRadialGradient(688, 440, 12, 688, 440, 260); gradient.addColorStop(0, 'rgba(255,198,124,.20)'); gradient.addColorStop(1, 'rgba(255,198,124,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gradient; ctx.fillRect(420, 200, 540, 480); ctx.restore(); }
      if (state.phase === 'work' && state.laptopVis > 0.4) { const gradient = ctx.createRadialGradient(578, 490, 8, 578, 490, 175); gradient.addColorStop(0, 'rgba(150,200,255,.17)'); gradient.addColorStop(1, 'rgba(150,200,255,0)'); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gradient; ctx.fillRect(380, 300, 400, 240); ctx.restore(); }
    };

    const drawToast = () => {
      if (state.toastA <= 0.01) return;
      const x = 430;
      const y = 372;
      const pad = 14;
      const height = 34;
      ctx.save();
      ctx.globalAlpha = state.toastA;
      ctx.font = "600 17px -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
      ctx.textBaseline = 'middle';
      const width = ctx.measureText(state.toast).width + pad * 2;
      ctx.fillStyle = 'rgba(18,18,18,.86)';
      ctx.strokeStyle = 'rgba(255,255,255,.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x - width / 2, y - height / 2, width, height, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(state.toast, x, y + 1);
      ctx.fillStyle = 'rgba(18,18,18,.86)'; ctx.beginPath(); ctx.moveTo(x - 7, y + height / 2 - 1); ctx.lineTo(x + 7, y + height / 2 - 1); ctx.lineTo(x, y + height / 2 + 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    const tick = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0.016;
      previous = now;
      const input = propsRef.current;
      const paletteKey = `${Math.floor(input.timeMinutes)}:${input.weather}`;
      if (paletteKey !== lastPaletteKey) { palette = paletteFor(input.timeMinutes, input.weather); lastPaletteKey = paletteKey; bake(); }
      if (input.phase !== state.wanted) {
        state.wanted = input.phase;
        state.anim = 0;
        if (input.phase === 'work') state.phase = state.phase === 'pause' || state.phase === 'close' ? 'open' : 'work';
        else if (input.phase === 'pause') state.phase = state.phase === 'work' || state.phase === 'open' ? 'close' : 'pause';
        else state.phase = state.laptopVis > 0.02 ? 'close' : 'done';
      }
      if (input.pokeNonce !== lastPokeNonce) {
        lastPokeNonce = input.pokeNonce;
        if (state.phase === 'work' && state.react < 0) {
          state.react = 0;
          state.blink = 120;
          state.nextBlink = 2600 + Math.random() * 3200;
          state.toast = 'ん？';
          state.toastT = 2400;
        }
      }
      if (input.toastMessage !== lastToastMessage) {
        lastToastMessage = input.toastMessage;
        if (input.toastMessage) {
          state.toast = input.toastMessage;
          state.toastT = 4500;
        }
      }
      state.anim += dt * 1000;
      if (state.phase === 'open') { state.laptopVis = 1; state.laptopY = 70 * clamp(1 - state.anim / 430, 0, 1); state.lid = clamp((state.anim - 380) / 420, 0, 1); if (state.anim > 830) { state.phase = 'work'; state.anim = 0; state.laptopY = 0; state.lid = 1; } }
      else if (state.phase === 'close') { state.lid = clamp(1 - state.anim / 420, 0, 1); state.laptopY = 70 * clamp((state.anim - 420) / 460, 0, 1); state.laptopVis = 1 - clamp((state.anim - 700) / 280, 0, 1); if (state.anim > 1000) { state.phase = state.wanted === 'done' ? 'done' : 'pause'; state.anim = 0; state.laptopVis = 0; } }
      else if (state.phase === 'work') { state.laptopVis = 1; state.laptopY = 0; state.lid = 1; }
      else if (state.phase === 'done') { state.laptopVis = 0; state.lid = 0; state.laptopY = 70; }
      if (state.react >= 0) { state.react += dt * 1000; if (state.react > 5050 || state.phase !== 'work') state.react = -1; }
      if (state.react < 0) { state.typing += ((state.phase === 'work' ? 1 : 0) - state.typing) * Math.min(1, dt * 9); state.look -= state.look * Math.min(1, dt * 9); state.raise += (((state.phase === 'done' ? 1 : 0) - state.raise) * Math.min(1, dt * 5)); }
      else { const reaction = state.react; state.typing = reaction < 300 ? 1 - smooth(reaction / 300) : reaction > 4750 ? smooth((reaction - 4750) / 300) : 0; state.look = reaction < 280 ? smooth(reaction / 280) : reaction > 4400 ? 1 - smooth((reaction - 4400) / 520) : 1; state.raise = reaction < 2100 ? 0 : reaction < 2420 ? smooth((reaction - 2100) / 320) : reaction < 4420 ? 1 : 1 - smooth((reaction - 4420) / 360); }
      state.gaze += (((state.phase === 'work' && state.react < 0 ? 1 : 0) - state.gaze) * Math.min(1, dt * 5));
      state.nextBlink -= dt * 1000; if (state.nextBlink <= 0) { state.blink = 130; state.nextBlink = 2600 + Math.random() * 4200; } if (state.blink > 0) state.blink -= dt * 1000;
      if (state.toastT > 0) { state.toastT -= dt * 1000; state.toastA = Math.min(1, state.toastA + dt * 4); }
      else state.toastA = Math.max(0, state.toastA - dt * 2.5);
      if (palette.bolt && !reduced) { nextBolt -= dt * 1000; if (nextBolt <= 0) { nextBolt = 4200 + Math.random() * 6000; flash = 1; let x = WIN.x + 60 + Math.random() * (WIN.w - 120); let y = WIN.y + 10; const points: Array<[number, number]> = [[x, y]]; for (let i = 0; i < 5; i += 1) { x += (Math.random() - 0.5) * 70; y += 40 + Math.random() * 40; points.push([x, y]); } bolt = { p: points, life: 0.34 }; } }
      flash = Math.max(0, flash - dt * 3.4); if (bolt) bolt.life -= dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = palette.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.setTransform(scale, 0, 0, scale, ox, oy);
      drawSky(now, dt); drawLights(); if (lampLayer) ctx.drawImage(lampLayer, 0, 0, SW, SH); if (roomLayer) ctx.drawImage(roomLayer, 0, 0, SW, SH); drawClawd(ctx, now, state, reduced); drawLaptop(ctx, now, state); drawToast();
      if (flash > 0.01) { ctx.fillStyle = `rgba(226,238,255,${flash * 0.16})`; ctx.fillRect(0, 0, SW, SH); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); const vignette = ctx.createRadialGradient(canvas.width * 0.42, canvas.height * 0.5, Math.min(canvas.width, canvas.height) * 0.28, canvas.width * 0.42, canvas.height * 0.5, Math.max(canvas.width, canvas.height) * 0.78); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.42)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, canvas.width, canvas.height);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const poke = () => {
    if (propsRef.current.phase !== 'work') return;
    propsRef.current.onPoke?.();
  };

  return <canvas ref={canvasRef} className="clawd-office__scene" role="img" aria-label="窓の外の景色が動くClawdくんのオフィス" tabIndex={0} onClick={poke} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); poke(); } }} />;
}
