import { mulberry32 } from './rng.js';

export const SIZE = 48;
export const T = { WATER: 0, ROAD: 1, SIDE: 2, GRASS: 3, PIER: 4, BUILD: 5, SAND: 6 };
export const SHAPES = [[2, 2, 4], [3, 2, 3], [3, 3, 3], [4, 3, 2]];

export function generate(seed) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(SIZE * SIZE).fill(T.GRASS);
  const variant = new Array(SIZE * SIZE).fill(null);
  const at = (x, y) => y * SIZE + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

  const shore = new Array(SIZE);
  let s = SIZE - 4 - ((rng() * 3) | 0);
  for (let x = 0; x < SIZE; x++) {
    if (rng() < 0.3) s += rng() < 0.5 ? -1 : 1;
    s = Math.max(SIZE - 7, Math.min(SIZE - 2, s));
    shore[x] = s;
  }
  for (let x = 0; x < SIZE; x++)
    for (let y = shore[x]; y < SIZE; y++) tiles[at(x, y)] = T.WATER;

  const roadX = [], roadY = [];
  let rx0 = 2 + ((rng() * 3) | 0);
  while (rx0 < SIZE - 5) { roadX.push(rx0); rx0 += 5 + ((rng() * 9) | 0); }
  let ry0 = 2 + ((rng() * 3) | 0);
  while (ry0 < SIZE - 9) { roadY.push(ry0); ry0 += 5 + ((rng() * 9) | 0); }

  for (const rx of roadX)
    for (let yy = 0; yy < SIZE; yy++)
      for (let dx = 0; dx < 2; dx++) {
        if (rx + dx >= SIZE) continue;
        if (yy < shore[rx + dx] - 1) {
          tiles[at(rx + dx, yy)] = T.ROAD;
          variant[at(rx + dx, yy)] = 'ry';
        }
      }
  for (const ry of roadY)
    for (let xx = 0; xx < SIZE; xx++)
      for (let dy = 0; dy < 2; dy++) {
        if (ry + dy < shore[xx] - 1) {
          const i = at(xx, ry + dy);
          if (tiles[i] === T.ROAD) variant[i] = 'int';
          else { tiles[i] = T.ROAD; variant[i] = 'rx'; }
        }
      }
  for (const rx of roadX)
    for (const ry of roadY) {
      const set = (xx, yy, v) => {
        if (inB(xx, yy) && tiles[at(xx, yy)] === T.ROAD) variant[at(xx, yy)] = v;
      };
      set(rx - 1, ry, 'cwX'); set(rx - 1, ry + 1, 'cwX');
      set(rx + 2, ry, 'cwX'); set(rx + 2, ry + 1, 'cwX');
      set(rx, ry - 1, 'cwY'); set(rx + 1, ry - 1, 'cwY');
      set(rx, ry + 2, 'cwY'); set(rx + 1, ry + 2, 'cwY');
    }

  for (let yy = 0; yy < SIZE; yy++)
    for (let xx = 0; xx < SIZE; xx++) {
      const i = at(xx, yy);
      if (tiles[i] !== T.GRASS) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
        inB(xx + dx, yy + dy) && tiles[at(xx + dx, yy + dy)] === T.ROAD);
      if (near) tiles[i] = T.SIDE;
    }

  for (let yy = 0; yy < SIZE; yy++)
    for (let xx = 0; xx < SIZE; xx++) {
      const i = at(xx, yy);
      if (tiles[i] !== T.GRASS && tiles[i] !== T.SIDE) continue;
      const nearW = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) =>
        inB(xx + dx, yy + dy) && tiles[at(xx + dx, yy + dy)] === T.WATER);
      if (nearW) tiles[i] = T.SAND;
    }

  const piers = [];
  for (let p = 0; p < 2; p++) {
    const px = 3 + ((rng() * (SIZE - 8)) | 0);
    const len = 3 + ((rng() * 3) | 0);
    for (let yy = shore[px] - 1; yy < Math.min(SIZE, shore[px] + len); yy++)
      for (let dx = 0; dx < 2; dx++)
        if (px + dx < SIZE) tiles[at(px + dx, yy)] = T.PIER;
    piers.push({ x: px, y: Math.min(SIZE - 1, shore[px] + len) });
  }

  const buildings = [];
  const decor = [];
  const center = SIZE / 2;

  const ranges = (lines, max) => {
    const out = [];
    let prev = -2;
    for (const l of [...lines, max]) {
      out.push([prev + 3, l - 2]);
      prev = l + 1;
    }
    return out;
  };
  const vrx = ranges(roadX, SIZE);
  const vry = ranges(roadY, SIZE);

  function place(x0, y0, x1, y1) {
    const W = x1 - x0 + 1, D = y1 - y0 + 1;
    if (W < 2 || D < 2) return;
    const opts = [];
    SHAPES.forEach((sh, i) => {
      if (sh[0] <= W && sh[1] <= D) opts.push([i, sh[0], sh[1]]);
      if (sh[1] !== sh[0] && sh[1] <= W && sh[0] <= D) opts.push([i, sh[1], sh[0]]);
    });
    if (!opts.length) return;
    const [si, w, d] = opts[(rng() * opts.length) | 0];
    const bx = x0 + ((rng() * (W - w + 1)) | 0);
    const by = y0 + ((rng() * (D - d + 1)) | 0);
    buildings.push({ x: bx, y: by, w, d, si, pi: (rng() * 3) | 0 });
    for (let yy = by; yy < by + d; yy++)
      for (let xx = bx; xx < bx + w; xx++) tiles[at(xx, yy)] = T.BUILD;
    place(x0, y0, bx - 1, y1);
    place(bx + w, y0, x1, y1);
    place(bx, y0, bx + w - 1, by - 1);
    place(bx, by + d, bx + w - 1, y1);
  }

  for (const [xa, xb] of vrx)
    for (const [ya, yb] of vry) {
      if (xb - xa < 1 || yb - ya < 1) continue;
      let y1 = yb;
      for (let tx = xa; tx <= xb; tx++) y1 = Math.min(y1, shore[tx] - 3);
      if (y1 - ya < 1) continue;
      if (rng() < 0.15) {
        for (let ty = ya; ty <= y1; ty++)
          for (let tx = xa; tx <= xb; tx++)
            if (rng() < 0.25) {
              tiles[at(tx, ty)] = T.BUILD;
              decor.push({ kind: 'tree', x: tx, y: ty, v: (rng() * 2) | 0 });
            }
        continue;
      }
      place(xa, ya, xb, y1);
    }

  let start = null;
  outer:
  for (let rad = 0; rad < SIZE; rad++) {
    const c0 = center | 0;
    for (let yy = Math.max(0, c0 - rad); yy <= Math.min(SIZE - 1, c0 + rad); yy++)
      for (let xx = Math.max(0, c0 - rad); xx <= Math.min(SIZE - 1, c0 + rad); xx++) {
        if (tiles[at(xx, yy)] === T.SIDE) {
          start = { x: xx + 0.5, y: yy + 0.5 };
          break outer;
        }
      }
  }
  if (!start) start = { x: center, y: center };

  const sx0 = start.x | 0, sy0 = start.y | 0;
  for (let yy = 0; yy < SIZE; yy++)
    for (let xx = 0; xx < SIZE; xx++) {
      const i = at(xx, yy);
      if (xx === sx0 && yy === sy0) continue;
      if (tiles[i] === T.SIDE) {
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
          inB(xx + dx, yy + dy) && tiles[at(xx + dx, yy + dy)] === T.ROAD);
        if (near && rng() < 0.06) decor.push({ kind: 'lamp', x: xx, y: yy });
        else if (rng() < 0.05) decor.push({ kind: 'tree', x: xx, y: yy, v: (rng() * 2) | 0 });
      } else if (tiles[i] === T.ROAD && (variant[i] === 'rx' || variant[i] === 'ry') && rng() < 0.03) {
        decor.push({ kind: 'car', x: xx, y: yy, orient: variant[i], v: (rng() * 5) | 0 });
      }
    }
  for (const p of piers)
    if (p.x + 2 < SIZE) decor.push({ kind: 'boat', x: p.x + 2, y: p.y - 1 });

  const shoreEndX = roadX.map(rx => {
    const a = shore[rx], b = rx + 1 < SIZE ? shore[rx + 1] : a;
    return Math.min(a, b) - 1;
  });

  return { tiles, variant, buildings, decor, start, seed, roadX, roadY, shoreEndX };
}
