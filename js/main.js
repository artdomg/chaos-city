import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { appendSceneAsync } from '@babylonjs/core/Loading/sceneLoader.js';
// Side-effects: pantalla de carga por defecto del SceneLoader y lector de .glb.
import '@babylonjs/core/Loading/loadingScreen.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';

import { generate, SIZE, T } from './city.js';
import { mulberry32 } from './rng.js';

const seedEl = document.getElementById('seed');
const verEl = document.getElementById('ver');
if (verEl) verEl.textContent = 'rev 10 (móvil)';
const urlSeed = new URLSearchParams(location.search).get('seed');
let pendingSeed = urlSeed ? (parseInt(urlSeed, 10) | 0) : null;
let city = null;

function cnv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function makeFlatTiles(seed) {
  const rng = mulberry32(seed);
  const t = {};
  function base(w, h, draw) {
    const c = cnv(w, h);
    draw(c.getContext('2d'));
    return c;
  }
  function noise(g, cols, n) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[(rng() * cols.length) | 0];
      g.fillRect((rng() * 16) | 0, (rng() * 16) | 0, 1, 1);
    }
  }
  t.grass = base(16, 16, g => {
    g.fillStyle = '#63b155';
    g.fillRect(0, 0, 16, 16);
    noise(g, ['#5aa74d', '#6dbb60'], 10);
  });
  t.side = base(16, 16, g => {
    g.fillStyle = '#c8c4b6';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#b6b2a4';
    g.fillRect(0, 0, 16, 1);
    g.fillRect(0, 0, 1, 16);
    noise(g, ['#d0ccbe', '#bebcb0'], 5);
  });
  const roadBase = g => {
    g.fillStyle = '#33363c';
    g.fillRect(0, 0, 16, 16);
  };
  t.rx = base(16, 16, g => {
    roadBase(g);
    g.fillStyle = '#d8b73a';
    g.fillRect(0, 7, 6, 2);
    g.fillRect(10, 7, 6, 2);
  });
  t.ry = base(16, 16, g => {
    roadBase(g);
    g.fillStyle = '#d8b73a';
    g.fillRect(7, 0, 2, 6);
    g.fillRect(7, 10, 2, 6);
  });
  t.int = base(16, 16, g => {
    roadBase(g);
  });
  t.cwX = base(16, 16, g => {
    roadBase(g);
    g.fillStyle = '#c9c5ba';
    for (let x = 1; x < 15; x += 4) g.fillRect(x, 3, 2, 10);
  });
  t.cwY = base(16, 16, g => {
    roadBase(g);
    g.fillStyle = '#c9c5ba';
    for (let y = 1; y < 15; y += 4) g.fillRect(3, y, 10, 2);
  });
  t.pier = base(16, 16, g => {
    g.fillStyle = '#8a5a33';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#75492a';
    for (let x = 3; x < 16; x += 4) g.fillRect(x, 0, 1, 16);
  });
  t.sand = base(16, 16, g => {
    g.fillStyle = '#d9c58c';
    g.fillRect(0, 0, 16, 16);
    noise(g, ['#ccb67c', '#e4d29a'], 12);
  });
  t.bed = base(16, 16, g => {
    g.fillStyle = '#1c5493';
    g.fillRect(0, 0, 16, 16);
    noise(g, ['#164a86', '#215da1'], 10);
  });
  t.water = [0, 1].map(f => base(16, 16, g => {
    g.fillStyle = '#2f7fd6';
    g.fillRect(0, 0, 16, 16);
    noise(g, ['#2a73c2', '#3f8ce0'], 12);
    g.fillStyle = '#a8d0f5';
    for (let i = 0; i < 4; i++) g.fillRect(((rng() * 14) | 0) + f, (rng() * 16) | 0, 2, 1);
  }));
  return t;
}

const flat = makeFlatTiles(9182);

function bakeGround() {
  const c = cnv(SIZE * 16, SIZE * 16);
  const g = c.getContext('2d');
  g.translate(0, c.height);
  g.scale(1, -1);
  const at = (x, y) => y * SIZE + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  const landish = tl => tl === T.GRASS || tl === T.SIDE || tl === T.BUILD || tl === T.ROAD;
  const timg = (x, y) => {
    const tl = city.tiles[at(x, y)];
    if (tl === T.GRASS) return flat.grass;
    if (tl === T.ROAD) return flat[city.variant[at(x, y)] || 'int'];
    return flat.side;
  };
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const tl = city.tiles[at(x, y)];
      let img;
      if (tl === T.WATER) {
        const shelf = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
          inB(x + dx, y + dy) && city.tiles[at(x + dx, y + dy)] === T.SAND);
        img = shelf ? flat.sand : flat.bed;
      }
      else if (tl === T.ROAD) img = flat[city.variant[at(x, y)] || 'int'];
      else if (tl === T.SIDE) img = flat.side;
      else if (tl === T.GRASS) img = flat.grass;
      else if (tl === T.PIER) img = flat.pier;
      else if (tl === T.SAND) img = flat.sand;
      else img = flat.side;
      g.drawImage(img, x * 16, y * 16);
    }
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (city.tiles[at(x, y)] !== T.SAND) continue;
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny) || !inB(x + dx, y) || !inB(x, y + dy)) continue;
        if (!landish(city.tiles[at(nx, ny)]) || !landish(city.tiles[at(x + dx, y)]) || !landish(city.tiles[at(x, y + dy)])) continue;
        const X = x * 16, Y = y * 16;
        const cx = dx === 1 ? X + 16 : X, cy = dy === 1 ? Y + 16 : Y;
        g.save();
        g.beginPath();
        g.moveTo(cx - dx * 16, cy);
        g.lineTo(cx, cy - dy * 16);
        g.lineTo(cx, cy);
        g.closePath();
        g.clip();
        g.drawImage(timg(nx, ny), X, Y);
        g.restore();
      }
    }
  return c;
}

let hgrid = null;
function buildHeightGrid() {
  const rngH = mulberry32((city.seed ^ 0x9e3779b9) | 0);
  const CS = 7;
  const gw = Math.ceil(SIZE / CS) + 2;
  const coarse = new Float32Array(gw * gw);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rngH();
  const sm = (x, y) => {
    const gx = x / CS, gy = y / CS;
    const x0 = gx | 0, y0 = gy | 0;
    const fx = gx - x0, fy = gy - y0;
    const a = coarse[y0 * gw + x0], b = coarse[y0 * gw + x0 + 1];
    const c = coarse[(y0 + 1) * gw + x0], d = coarse[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const th = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const tl = city.tiles[y * SIZE + x];
      if (tl === T.WATER) th[y * SIZE + x] = -0.35;
      else if (tl === T.SAND) th[y * SIZE + x] = 0.02;
      else if (tl === T.GRASS) th[y * SIZE + x] = 0.06 + sm(x, y) * 0.38;
      else th[y * SIZE + x] = 0;
    }
  hgrid = new Float32Array((SIZE + 1) * (SIZE + 1));
  for (let j = 0; j <= SIZE; j++)
    for (let i = 0; i <= SIZE; i++) {
      const cx = i - 0.5, cy = j - 0.5;
      const x0 = Math.max(0, Math.min(SIZE - 1, cx | 0));
      const y0 = Math.max(0, Math.min(SIZE - 1, cy | 0));
      const x1 = Math.min(SIZE - 1, x0 + 1), y1 = Math.min(SIZE - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, cx - x0)), fy = Math.max(0, Math.min(1, cy - y0));
      const a = th[y0 * SIZE + x0], b = th[y0 * SIZE + x1];
      const c = th[y1 * SIZE + x0], d = th[y1 * SIZE + x1];
      let h = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      if (city.tiles[y0 * SIZE + x0] === T.PIER || city.tiles[y0 * SIZE + x1] === T.PIER ||
          city.tiles[y1 * SIZE + x0] === T.PIER || city.tiles[y1 * SIZE + x1] === T.PIER)
        h = Math.max(h, 0.06);
      hgrid[j * (SIZE + 1) + i] = h;
    }
}
function heightAt(x, y) {
  if (!hgrid) return 0;
  const gx = Math.max(0, Math.min(SIZE, x + 0.5));
  const gy = Math.max(0, Math.min(SIZE, y + 0.5));
  const i0 = gx | 0, j0 = gy | 0;
  const i1 = Math.min(SIZE, i0 + 1), j1 = Math.min(SIZE, j0 + 1);
  const fx = gx - i0, fy = gy - j0;
  const a = hgrid[j0 * (SIZE + 1) + i0], b = hgrid[j0 * (SIZE + 1) + i1];
  const c = hgrid[j1 * (SIZE + 1) + i0], d = hgrid[j1 * (SIZE + 1) + i1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function buildGroundMesh(mat) {
  const n = SIZE + 1;
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      pos.push(i - SIZE / 2, hgrid[j * n + i], j - SIZE / 2);
      uvs.push(i / SIZE, j / SIZE);
    }
  for (let j = 0; j < SIZE; j++)
    for (let i = 0; i < SIZE; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const normals = [];
  VertexData.ComputeNormals(pos, idx, normals);
  const vd = new VertexData();
  vd.positions = pos;
  vd.uvs = uvs;
  vd.indices = idx;
  vd.normals = normals;
  const m = new Mesh('g', scene);
  vd.applyToMesh(m);
  m.position = new Vector3(SIZE / 2 - 0.5, 0, SIZE / 2 - 0.5);
  m.material = mat;
  return m;
}

const WALK = new Set([T.ROAD, T.SIDE, T.GRASS, T.PIER, T.SAND]);
function walkable(x, y) {
  const tx = x | 0, ty = y | 0;
  if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) return false;
  return WALK.has(city.tiles[ty * SIZE + tx]);
}
let solids = [];
function solidAt(px, py) {
  for (const s of solids) {
    if (s.r) {
      const d = (px - s.x) * (px - s.x) + (py - s.y) * (py - s.y);
      if (d < (s.r + 0.2) * (s.r + 0.2)) return true;
    } else if (Math.abs(px - s.x) < s.rx + 0.2 && Math.abs(py - s.y) < s.ry + 0.2) return true;
  }
  return false;
}
function canStand(x, y) {
  const r = 0.25;
  return walkable(x - r, y - r) && walkable(x + r, y - r) &&
         walkable(x - r, y + r) && walkable(x + r, y + r) &&
         !solidAt(x, y);
}

const canvas = document.getElementById('game');
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.52, 0.72, 0.9, 1);
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
scene.ambientColor = new Color3(0.25, 0.28, 0.32);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogColor = new Color3(0.52, 0.72, 0.9);
scene.fogStart = 95;
scene.fogEnd = 170;

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.5;
hemi.groundColor = new Color3(0.4, 0.42, 0.45);
const sun = new DirectionalLight('sun', new Vector3(-0.6, -0.9, -0.4), scene);
sun.diffuse = new Color3(1, 0.95, 0.85);
sun.intensity = 1.6;

const OFF = new Vector3(0.72, 0.78, 0.72).normalize().scale(58);
const camera = new FreeCamera('cam', OFF.clone(), scene);
camera.setTarget(Vector3.Zero());
camera.minZ = 1;
camera.maxZ = 300;

const BASE_FOV = 0.42;
// Sin esto el buffer de render conserva el tamaño inicial: al girar el móvil o
// al aparecer/ocultarse la barra del navegador la imagen sale estirada.
function applyView() {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  // El fov se aplica siempre al lado corto de la pantalla, así girar el
  // dispositivo no cambia la escala: el lado largo enseña más ciudad.
  camera.fovMode = w < h ? Camera.FOVMODE_HORIZONTAL_FIXED : Camera.FOVMODE_VERTICAL_FIXED;
  // En pantallas pequeñas acercamos la cámara (hasta ~1.7x) para que el
  // personaje no se quede diminuto.
  const k = Math.min(1, Math.max(0.58, Math.min(w, h) / 700));
  camera.fov = 2 * Math.atan(Math.tan(BASE_FOV / 2) * k);
  // Los móviles tienen DPR 3-4; limitamos a 2 para no hundir el rendimiento.
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
  engine.resize();
}
applyView();
window.addEventListener('resize', applyView);
// En iOS el resize llega antes de que la ventana tenga su tamaño definitivo.
window.addEventListener('orientationchange', () => setTimeout(applyView, 300));
if (window.visualViewport) window.visualViewport.addEventListener('resize', applyView);

let cityAnchors = [];
let cityMats = [];
let groundMesh = null;
let groundMats = [];
let waterPlane = null;
let waterMats = [];
let shadowMat = null;
let traffic = [];
let parked = [];
let peds = [];

const templates = {};
const ASSET_NAMES = [];
for (let si = 0; si < 4; si++)
  for (let pi = 0; pi < 3; pi++) ASSET_NAMES.push('bld_' + si + '_' + pi);
ASSET_NAMES.push('tree_round', 'tree_cone', 'lamp', 'car', 'boat', 'player');

async function loadAssets() {
  for (const n of ASSET_NAMES) {
    const before = new Set(scene.meshes);
    await appendSceneAsync('assets/' + n + '.glb', scene);
    const added = scene.meshes.filter(m => !before.has(m));
    const addedSet = new Set(added);
    const roots = added.filter(m => !m.parent || !addedSet.has(m.parent));
    for (const r of roots) r.setEnabled(false);
    templates[n] = roots;
  }
}

function spawn(name) {
  const anchor = new TransformNode('a', scene);
  for (const r of templates[name]) {
    const cl = r.instantiateHierarchy();
    if (cl) cl.parent = anchor;
  }
  for (const m of anchor.getChildMeshes()) m.setEnabled(true);
  cityAnchors.push(anchor);
  return anchor;
}

function clearCity() {
  for (const a of cityAnchors) a.dispose(false, false);
  for (const m of cityMats) m.dispose();
  if (shadowMat) { shadowMat.dispose(); shadowMat = null; }
  if (groundMesh) { groundMesh.dispose(); groundMesh = null; }
  for (const m of groundMats) {
    if (m.diffuseTexture) m.diffuseTexture.dispose();
    m.dispose();
  }
  if (waterPlane) { waterPlane.dispose(); waterPlane = null; }
  for (const m of waterMats) {
    if (m.diffuseTexture) m.diffuseTexture.dispose();
    m.dispose();
  }
  waterMats = [];
  traffic = [];
  parked = [];
  peds = [];
  for (const b of booms) {
    b.m.dispose();
    b.mat.dispose();
  }
  booms = [];
  for (const n of nades) n.m.dispose();
  nades = [];
  for (const tr of tracers) tr.m.dispose();
  tracers = [];
  if (meteor) {
    meteor.disc.dispose();
    meteor.dm.dispose();
    meteor.rock.dispose();
    meteor = null;
  }
  cityAnchors = [];
  cityMats = [];
  groundMats = [];
  limbs = null;
}

const CAR_COLORS = [
  [0.78, 0.16, 0.16], [0.85, 0.65, 0.15], [0.9, 0.9, 0.88],
  [0.18, 0.38, 0.65], [0.25, 0.55, 0.3], [0.35, 0.32, 0.4]
];

function blob(sx, sz, parent, y) {
  const b = CreateDisc('blob', { radius: 0.5, tessellation: 20 }, scene);
  b.rotation.x = Math.PI / 2;
  b.scaling.x = sx;
  b.scaling.y = sz;
  b.material = shadowMat;
  b.parent = parent || null;
  b.position.y = y != null ? y : 0.02;
  return b;
}

const PED_COLORS = [
  [0.85, 0.45, 0.15], [0.3, 0.55, 0.75], [0.55, 0.3, 0.55],
  [0.85, 0.75, 0.3], [0.3, 0.6, 0.4], [0.75, 0.3, 0.35]
];
const CRIM_COLORS = [
  [0.12, 0.12, 0.14], [0.2, 0.08, 0.08], [0.08, 0.16, 0.1], [0.15, 0.1, 0.2]
];

function deinstance(anchor, match) {
  const list = anchor.getChildMeshes().filter(m => m.getClassName && m.getClassName() === 'InstancedMesh' && m.name.indexOf(match) >= 0);
  for (const inst of list) {
    const full = inst.sourceMesh.clone(inst.name + 'full');
    full.parent = inst.parent;
    full.position = inst.position.clone();
    full.rotation = inst.rotation.clone();
    full.scaling = inst.scaling.clone();
    full.setEnabled(true);
    inst.dispose();
  }
}

function recolorBody(anchor, col) {
  for (const m of anchor.getChildMeshes()) {
    if (m.name.indexOf('body') >= 0 && m.material) {
      const cm = m.material.clone('bodymat');
      cm.albedoColor = new Color3(col[0], col[1], col[2]);
      m.material = cm;
      cityMats.push(cm);
    }
  }
}

function spawnTraffic() {
  const rx = city.roadX, ry = city.roadY;
  if (!rx.length && !ry.length) return;
  for (let i = 0; i < 12; i++) {
    const vert = rx.length ? (i % 2 === 0 || !ry.length) : false;
    const a = spawn('car');
    deinstance(a, 'cb');
    const col = CAR_COLORS[(i * 2 + 1) % CAR_COLORS.length];
    for (const m of a.getChildMeshes()) {
      if (m.material && m.material.name.indexOf('car_body') === 0) {
        const cm = m.material.clone('carmat');
        cm.albedoColor = new Color3(col[0], col[1], col[2]);
        m.material = cm;
        cityMats.push(cm);
      }
    }
    blob(1.3, 0.8, a);
    const c = { idx: i, node: a, axis: 'x', dir: 1, fixed: 0, pos: 0, ri: 0, speed: 2.6 + (i % 5) * 0.4, cool: 0, x: 0, y: 0, crashed: false, crashT: 0, fire: null };
    assignLane(c, vert, rx, ry);
    traffic.push(c);
    placeCar(c);
  }
}
function assignLane(c, vert, rx, ry) {
  if (vert) {
    c.axis = 'y';
    c.ri = (Math.random() * rx.length) | 0;
    c.dir = Math.random() < 0.5 ? 1 : -1;
    c.fixed = rx[c.ri] + (c.dir === 1 ? 0.5 : 1.5);
    c.pos = 2 + Math.random() * Math.max(2, city.shoreEndX[c.ri] - 4);
  } else {
    c.axis = 'x';
    c.ri = (Math.random() * ry.length) | 0;
    c.dir = Math.random() < 0.5 ? 1 : -1;
    c.fixed = ry[c.ri] + (c.dir === 1 ? 1.5 : 0.5);
    c.pos = 2 + Math.random() * (SIZE - 6);
  }
}
function backToLane(c) {
  let bi = -1, bd = 1e9;
  for (let i = 0; i < city.roadY.length; i++) {
    const d = Math.abs(city.roadY[i] + 1 - c.y);
    if (d < bd) { bd = d; bi = i; }
  }
  let bj = -1, bx = 1e9;
  for (let j = 0; j < city.roadX.length; j++) {
    const d = Math.abs(city.roadX[j] + 1 - c.x);
    if (d < bx) { bx = d; bj = j; }
  }
  if (bi >= 0 && bd <= bx) {
    c.axis = 'x';
    c.ri = bi;
    c.dir = c.chdx >= 0 ? 1 : -1;
    c.fixed = city.roadY[bi] + (c.dir === 1 ? 1.5 : 0.5);
    c.pos = Math.max(1.5, Math.min(SIZE - 2.5, c.x));
  } else if (bj >= 0) {
    c.axis = 'y';
    c.ri = bj;
    c.dir = c.chdy >= 0 ? 1 : -1;
    c.fixed = city.roadX[bj] + (c.dir === 1 ? 0.5 : 1.5);
    c.pos = Math.max(1.5, Math.min((city.shoreEndX[bj] || SIZE - 2) - 0.5, c.y));
  } else {
    assignLane(c, false, city.roadX, city.roadY);
  }
  c.chase = null;
  c.vx = 0;
  c.vz = 0;
  placeCar(c);
}
let fireMat = null, smokeMat = null;
function launch(o, dx, dy, pow) {
  o.fy = 0.01;
  o.vy = (pow || 3.5) + Math.random() * 2;
  o.vx = dx * (2 + Math.random() * 2) + (Math.random() - 0.5);
  o.vz = dy * (2 + Math.random() * 2) + (Math.random() - 0.5);
  o.sx = (Math.random() - 0.5) * 14;
  o.sy = (Math.random() - 0.5) * 8;
  o.sz = (Math.random() - 0.5) * 14;
}
function flyStep(o, dt) {
  if (o.fy > 0 || o.vy) {
    o.vy -= 10 * dt;
    o.fy += o.vy * dt;
    if (o.fy <= 0) {
      o.fy = 0;
      o.vy = 0;
      o.vx = 0;
      o.vz = 0;
      o.sx *= 0.15;
      o.sy *= 0.15;
      o.sz *= 0.15;
    }
    o.x += (o.vx || 0) * dt;
    o.y += (o.vz || 0) * dt;
  }
  o.node.rotation.x += (o.sx || 0) * dt;
  o.node.rotation.y += (o.sy || 0) * dt;
  o.node.rotation.z += (o.sz || 0) * dt;
}
function fireAnim(c) {
  if (!c.fire) return;
  for (const f of c.fire.flames) {
    const s = 1 + Math.sin(c.crashT * 22 + f.ph) * 0.35;
    f.m.scaling.setAll(s);
    f.m.position.y = 0.35 + Math.sin(c.crashT * 17 + f.ph) * 0.06;
  }
  for (const sm of c.fire.smokes) {
    const t2 = (c.crashT * 0.7 + sm.ph) % 1.4;
    sm.m.position.set(Math.sin(sm.ph * 9 + t2 * 3) * 0.15, 0.5 + t2, 0);
    sm.m.scaling.setAll(0.6 + t2 * 0.9);
  }
}
function makeFire(c) {
  c.boom = Math.random() < 0.3;
  c.boomT = 1.5 + Math.random() * 2.5;
  if (!fireMat) {
    fireMat = new StandardMaterial('fire', scene);
    fireMat.diffuseColor = new Color3(1, 0.35, 0.05);
    fireMat.emissiveColor = new Color3(1, 0.45, 0.08);
    fireMat.specularColor = new Color3(0, 0, 0);
    smokeMat = new StandardMaterial('smoke', scene);
    smokeMat.diffuseColor = new Color3(0.15, 0.15, 0.15);
    smokeMat.emissiveColor = new Color3(0.1, 0.1, 0.1);
    smokeMat.alpha = 0.55;
    smokeMat.specularColor = new Color3(0, 0, 0);
  }
  const flames = [], smokes = [];
  for (let i = 0; i < 3; i++) {
    const f = CreateBox('flame', { size: 0.28 }, scene);
    f.material = fireMat;
    f.parent = c.node;
    f.position.set((Math.random() - 0.5) * 0.7, 0.35, (Math.random() - 0.5) * 0.4);
    flames.push({ m: f, ph: Math.random() * 6 });
  }
  for (let i = 0; i < 2; i++) {
    const s = CreateBox('smoke', { size: 0.34 }, scene);
    s.material = smokeMat;
    s.parent = c.node;
    smokes.push({ m: s, ph: Math.random() * 1.4 });
  }
  c.fire = { flames, smokes };
}
function ignite(c) {
  if (c.crashed) return;
  c.crashed = true;
  c.crashT = 0;
  c.chase = null;
  launch(c, c.axis === 'x' ? c.dir : 0, c.axis === 'y' ? c.dir : 0, 3.5);
  makeFire(c);
}
function douse(c) {
  if (!c.fire) return;
  for (const f of c.fire.flames) f.m.dispose();
  for (const s of c.fire.smokes) s.m.dispose();
  c.fire = null;
}
let camp = { x: 0, y: 0, t: 0 };
let meteor = null;
function spawnMeteor(tx, ty) {
  const disc = CreateDisc('mwarn', { radius: 3, tessellation: 24 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(tx, 0.09, ty);
  const dm = new StandardMaterial('mwarnM', scene);
  dm.emissiveColor = new Color3(1, 0.25, 0.1);
  dm.diffuseColor = new Color3(0.8, 0.15, 0.05);
  dm.alpha = 0.35;
  dm.specularColor = new Color3(0, 0, 0);
  dm.backFaceCulling = false;
  disc.material = dm;
  const rock = CreateSphere('meteor', { diameter: 1.3, segments: 10 }, scene);
  const rm = new StandardMaterial('meteorM', scene);
  rm.diffuseColor = new Color3(0.25, 0.15, 0.1);
  rm.emissiveColor = new Color3(1, 0.4, 0.08);
  rm.specularColor = new Color3(0, 0, 0);
  rock.material = rm;
  rock.position.set(tx + 6, 26, ty - 3);
  return { t: 0, warn: 2.2, fall: 1.1, tx, ty, disc, dm, rock };
}
function updateMeteor(dt) {
  if (!P.down) {
    if (camp.t < 0) {
      camp.t += dt;
    } else if (Math.hypot(P.x - camp.x, P.y - camp.y) > 4) {
      camp.x = P.x;
      camp.y = P.y;
      camp.t = 0;
    } else {
      camp.t += dt;
    }
    if (camp.t > 10 && !meteor) {
      meteor = spawnMeteor(P.x, P.y);
      camp.x = P.x;
      camp.y = P.y;
      camp.t = -8;
    }
  }
  if (!meteor) return;
  meteor.t += dt;
  if (meteor.t < meteor.warn) {
    meteor.dm.alpha = 0.25 + 0.2 * Math.sin(meteor.t * 16);
  } else if (meteor.t < meteor.warn + meteor.fall) {
    const k = (meteor.t - meteor.warn) / meteor.fall;
    meteor.rock.position.set(meteor.tx + 6 * (1 - k), 26 * (1 - k * k) + 0.4, meteor.ty - 3 * (1 - k));
    meteor.rock.rotation.x += dt * 10;
  } else {
    const tx = meteor.tx, ty = meteor.ty;
    meteor.disc.dispose();
    meteor.dm.dispose();
    meteor.rock.dispose();
    meteor = null;
    explode(tx, ty, 3.0);
  }
}
let nadeMat = null;
let nades = [];
function throwNade(p, tx, ty) {
  if (!nadeMat) {
    nadeMat = new StandardMaterial('nade', scene);
    nadeMat.diffuseColor = new Color3(0.1, 0.18, 0.08);
    nadeMat.emissiveColor = new Color3(0.05, 0.1, 0.04);
    nadeMat.specularColor = new Color3(0, 0, 0);
  }
  const m = CreateBox('nade', { size: 0.14 }, scene);
  m.material = nadeMat;
  const T = 0.9;
  const h0 = 0.6;
  m.position.set(p.x, h0, p.y);
  nades.push({
    m,
    x: p.x,
    y: p.y,
    h: h0,
    vx: (tx - p.x) / T,
    vz: (ty - p.y) / T,
    vh: 5 * T - h0 / T,
    t: 0,
    T
  });
}
function updateNades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    n.t += dt;
    n.vh -= 10 * dt;
    n.h += n.vh * dt;
    n.x += n.vx * dt;
    n.y += n.vz * dt;
    n.m.position.set(n.x, Math.max(0.07, n.h), n.y);
    n.m.rotation.x += dt * 9;
    n.m.rotation.y += dt * 7;
    if (n.t >= n.T || n.h <= 0.05) {
      n.m.dispose();
      nades.splice(i, 1);
      explode(n.x, n.y);
    }
  }
}
let booms = [];
function boomStep(c) {
  if (!c.boom) return;
  if (c.crashT >= c.boomT) {
    c.boom = false;
    explode(c.x, c.y);
  }
}
function explode(x, y, R) {
  R = R || 2.6;
  const m = new StandardMaterial('boomM', scene);
  m.emissiveColor = new Color3(1, 0.32, 0.04);
  m.diffuseColor = new Color3(0.9, 0.25, 0.02);
  m.specularColor = new Color3(0, 0, 0);
  m.alpha = 0.9;
  const s = CreateSphere('boom', { diameter: 1.2, segments: 12 }, scene);
  s.material = m;
  s.position.set(x, 0.7, y);
  booms.push({ m: s, mat: m, t: 0 });
  const away = (o) => {
    const d = Math.hypot(o.x - x, o.y - y) || 0.001;
    if (d > R) return false;
    launch(o, (o.x - x) / d, (o.y - y) / d, 3.5);
    return true;
  };
  for (const o of traffic) {
    if (!away(o)) continue;
    if (!o.crashed) {
      o.crashed = true;
      o.crashT = 0;
      o.chase = null;
      makeFire(o);
    }
  }
  for (const o of parked) {
    if (!away(o)) continue;
    if (!o.crashed) {
      o.crashed = true;
      o.crashT = 0;
      makeFire(o);
    }
  }
  for (const p of peds) {
    if (!away(p)) continue;
    if (p.down <= 0) p.down = 1.6;
  }
  if (!P.down && Math.hypot(P.x - x, P.y - y) < R) {
    P.down = true;
    downT = 2;
    launch(P, (P.x - x) / (Math.hypot(P.x - x, P.y - y) || 0.001), (P.y - y) / (Math.hypot(P.x - x, P.y - y) || 0.001), 3.5);
  }
}
function placeCar(c) {
  const x = c.axis === 'y' ? c.fixed : c.pos;
  const y = c.axis === 'y' ? c.pos : c.fixed;
  c.node.position.set(x, 0, y);
  c.node.rotation.x = 0;
  c.node.rotation.z = 0;
  c.node.rotation.y = Math.atan2(-(c.axis === 'y' ? c.dir : 0), c.axis === 'x' ? c.dir : 0);
  c.x = x;
  c.y = y;
}
function runOverCheck(c, flying) {
  const hx = flying ? 1.0 : (c.axis === 'x' ? 0.75 : 0.45);
  const hy = flying ? 1.0 : (c.axis === 'x' ? 0.45 : 0.75);
  const dx = flying ? Math.sign(c.vx || 0) : (c.axis === 'x' ? c.dir : 0);
  const dy = flying ? Math.sign(c.vz || 0) : (c.axis === 'y' ? c.dir : 0);
  if (!P.down && Math.abs(c.x - P.x) < hx && Math.abs(c.y - P.y) < hy) {
    P.down = true;
    downT = 2;
    launch(P, dx, dy, 2.5);
  }
  for (const p of peds) {
    if (p.down <= 0 && Math.abs(c.x - p.x) < hx && Math.abs(c.y - p.y) < hy) {
      p.down = 1.6;
      launch(p, dx, dy, 2.5);
    }
  }
}
function updateTraffic(dt) {
  for (const c of traffic) {
    if (c.crashed) {
      c.crashT += dt;
      flyStep(c, dt);
      c.node.position.set(c.x, c.fy, c.y);
      fireAnim(c);
      boomStep(c);
      if (c.fy > 0 || Math.abs(c.vx || 0) + Math.abs(c.vz || 0) > 0.3) runOverCheck(c, true);
      if (c.crashT > 7) {
        douse(c);
        c.crashed = false;
        const vert = city.roadX.length > 0 && (city.roadY.length === 0 || Math.random() < 0.5);
        assignLane(c, vert, city.roadX, city.roadY);
        placeCar(c);
      }
      continue;
    }
    if (!c.chase) {
      let best = null, bdist = 5;
      for (const p of peds) {
        if (p.down > 0) continue;
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < bdist) { bdist = d; best = p; }
      }
      if (!P.down) {
        const d = Math.hypot(P.x - c.x, P.y - c.y);
        if (d < bdist) { bdist = d; best = P; }
      }
      if (best) c.chase = best;
    }
    if (c.chase) {
      const p = c.chase;
      if (p.down > 0) {
        backToLane(c);
      } else {
        const dx = p.x - c.x, dy = p.y - c.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ux = dx / d, uy = dy / d;
        c.chdx = ux;
        c.chdy = uy;
        c.vx = ux * c.speed;
        c.vz = uy * c.speed;
        const sp = c.speed * 1.9 * dt;
        const nx = c.x + ux * sp, ny = c.y + uy * sp;
        if (!canStand(nx, ny)) {
          ignite(c);
          continue;
        }
        c.x = nx;
        c.y = ny;
        c.node.position.set(c.x, 0, c.y);
        c.node.rotation.x = 0;
        c.node.rotation.z = 0;
        c.node.rotation.y = Math.atan2(-uy, ux);
        runOverCheck(c, true);
        for (const o of traffic) {
          if (o === c) continue;
          if (Math.hypot(o.x - c.x, o.y - c.y) < 1.05) { ignite(c); ignite(o); break; }
        }
        if (!c.crashed) {
          for (const pk of parked) {
            if (pk.crashed) continue;
            if (Math.hypot(pk.x - c.x, pk.y - c.y) < 1.0) { ignite(c); ignite(pk); break; }
          }
        }
        continue;
      }
    }
    c.cool = Math.max(0, c.cool - dt);
    const moved = c.dir * c.speed * dt;
    c.pos += moved;
    const end = c.axis === 'y' ? city.shoreEndX[c.ri] : SIZE - 2;
    if (c.pos > end - 0.5 || c.pos < 1.5) {
      c.dir *= -1;
      c.fixed = c.axis === 'y'
        ? city.roadX[c.ri] + (c.dir === 1 ? 0.5 : 1.5)
        : city.roadY[c.ri] + (c.dir === 1 ? 1.5 : 0.5);
      c.pos = Math.max(1.5, Math.min(end - 0.5, c.pos));
      c.cool = 2;
    }
    if (c.cool <= 0) {
      const ti = (c.pos | 0) * SIZE + (c.fixed | 0);
      if (city.variant[ti] === 'int' && Math.random() < dt * 0.8) {
        if (c.axis === 'y' && city.roadY.length) {
          let bj = 0;
          for (let j = 1; j < city.roadY.length; j++)
            if (Math.abs(city.roadY[j] + 1 - c.pos) < Math.abs(city.roadY[bj] + 1 - c.pos)) bj = j;
          const ix = city.roadX[c.ri] + 1;
          c.axis = 'x';
          c.pos = ix;
          c.fixed = city.roadY[bj] + (c.dir === 1 ? 1.5 : 0.5);
          c.cool = 2;
        } else if (c.axis === 'x' && city.roadX.length) {
          let bj = 0;
          for (let j = 1; j < city.roadX.length; j++)
            if (Math.abs(city.roadX[j] + 1 - c.pos) < Math.abs(city.roadX[bj] + 1 - c.pos)) bj = j;
          const iy = city.roadY[c.ri] + 1;
          c.axis = 'y';
          c.pos = iy;
          c.fixed = city.roadX[bj] + (c.dir === 1 ? 0.5 : 1.5);
          c.cool = 2;
        }
      }
    }
    placeCar(c);
    for (const o of traffic) {
      if (o === c) continue;
      if (Math.hypot(o.x - c.x, o.y - c.y) < 1.05) { ignite(c); ignite(o); break; }
    }
    for (const pk of parked) {
      if (pk.crashed) continue;
      if (Math.hypot(pk.x - c.x, pk.y - c.y) < 1.0) { ignite(c); ignite(pk); break; }
    }
    if (Math.abs(moved) > 0.0001) runOverCheck(c, false);
  }
}
function updateParked(dt) {
  for (const pk of parked) {
    if (!pk.crashed) continue;
    pk.crashT += dt;
    flyStep(pk, dt);
    pk.node.position.set(pk.x, pk.fy, pk.y);
    boomStep(pk);
    if (pk.sol) {
      pk.sol.x = pk.x;
      pk.sol.y = pk.y;
    }
    fireAnim(pk);
    if (pk.crashT > 7) {
      douse(pk);
      pk.crashed = false;
      pk.fy = 0;
      pk.x = pk.ox;
      pk.y = pk.oy;
      pk.node.rotation.x = 0;
      pk.node.rotation.z = 0;
      pk.node.position.set(pk.x, 0, pk.y);
      if (pk.sol) {
        pk.sol.x = pk.x;
        pk.sol.y = pk.y;
      }
    }
  }
}

let pedSpots = [];
function spawnPeds() {
  pedSpots = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const tl = city.tiles[y * SIZE + x];
      if (tl === T.SIDE || tl === T.GRASS || tl === T.SAND) pedSpots.push([x, y]);
    }
  if (!pedSpots.length) return;
  for (let i = 0; i < 10; i++) makePed(false, i);
  for (let i = 0; i < 4; i++) makePed(true, i);
}
function makePed(crim, i) {
  const [tx, ty] = pedSpots[(Math.random() * pedSpots.length) | 0];
  const a = spawn('player');
  deinstance(a, 'body');
  recolorBody(a, crim ? CRIM_COLORS[i % CRIM_COLORS.length] : PED_COLORS[i % PED_COLORS.length]);
  if (crim) crimGear(a);
  const limb = { ll: null, lr: null, al: null, ar: null };
  a.getChildMeshes().forEach(m => {
    m.rotationQuaternion = null;
    if (m.name.indexOf('legL') >= 0) limb.ll = m;
    else if (m.name.indexOf('legR') >= 0) limb.lr = m;
    else if (m.name.indexOf('armL') >= 0) limb.al = m;
    else if (m.name.indexOf('armR') >= 0) limb.ar = m;
  });
  blob(0.5, 0.5, a);
  peds.push({ node: a, limb, x: tx + 0.5, y: ty + 0.5, dx: 0, dy: 0, t: 0, ph: Math.random() * 6, swing: 0, down: 0, crim, nadeT: 2 + Math.random() * 4 });
}
const GUER_COLORS = [
  [0.33, 0.38, 0.2], [0.28, 0.33, 0.17], [0.4, 0.37, 0.24], [0.25, 0.3, 0.2]
];
let tracers = [];
let tracerMat = null;
function tracer(x1, y1, x2, y2) {
  if (!tracerMat) {
    tracerMat = new StandardMaterial('tr', scene);
    tracerMat.emissiveColor = new Color3(1, 0.85, 0.3);
    tracerMat.diffuseColor = new Color3(1, 0.7, 0.1);
    tracerMat.specularColor = new Color3(0, 0, 0);
  }
  const d = Math.hypot(x2 - x1, y2 - y1) || 0.001;
  const m = CreateBox('tracer', { width: d, height: 0.035, depth: 0.035 }, scene);
  m.material = tracerMat;
  m.position.set((x1 + x2) / 2, 0.55, (y1 + y2) / 2);
  m.rotation.y = Math.atan2(-(y2 - y1), x2 - x1);
  tracers.push({ m, t: 0 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.t += dt;
    if (tr.t > 0.09) {
      tr.m.dispose();
      tracers.splice(i, 1);
    }
  }
}
let gearMats = null;
function gearSetup() {
  if (gearMats) return gearMats;
  const dark = new StandardMaterial('gearD', scene);
  dark.diffuseColor = new Color3(0.08, 0.08, 0.09);
  dark.specularColor = new Color3(0, 0, 0);
  const olive = new StandardMaterial('gearO', scene);
  olive.diffuseColor = new Color3(0.3, 0.35, 0.16);
  olive.specularColor = new Color3(0, 0, 0);
  const black = new StandardMaterial('gearB', scene);
  black.diffuseColor = new Color3(0.05, 0.05, 0.06);
  black.specularColor = new Color3(0, 0, 0);
  gearMats = { dark, olive, black };
  return gearMats;
}
function guerGear(a) {
  const M = gearSetup();
  const head = a.getChildMeshes().find(m => m.name.indexOf('head') >= 0);
  const band = CreateBox('band', { width: 0.34, height: 0.12, depth: 0.34 }, scene);
  band.material = M.olive;
  band.parent = head || a;
  band.position.y = 0.16;
  const rifle = CreateBox('rifle', { width: 0.07, height: 0.09, depth: 0.9 }, scene);
  rifle.material = M.dark;
  rifle.parent = a;
  rifle.position.set(0.16, 0.62, 0.28);
}
function crimGear(a) {
  const M = gearSetup();
  const head = a.getChildMeshes().find(m => m.name.indexOf('head') >= 0);
  const cap = CreateBox('cap', { width: 0.34, height: 0.1, depth: 0.34 }, scene);
  cap.material = M.black;
  cap.parent = head || a;
  cap.position.y = 0.2;
  const brim = CreateBox('brim', { width: 0.3, height: 0.04, depth: 0.22 }, scene);
  brim.material = M.black;
  brim.parent = head || a;
  brim.position.set(0, 0.16, 0.26);
  const mask = CreateBox('mask', { width: 0.32, height: 0.09, depth: 0.1 }, scene);
  mask.material = M.black;
  mask.parent = head || a;
  mask.position.set(0, 0.02, 0.16);
}
let guerT = 5;
function spawnGuerr() {
  if (!city.roadY.length) return;
  const n = 3 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const row = city.roadY[(Math.random() * city.roadY.length) | 0];
    const ltr = Math.random() < 0.5;
    const y = row + 1 + (Math.random() - 0.5) * 0.6;
    const x = ltr ? 0.6 : SIZE - 1.6;
    const a = spawn('player');
    deinstance(a, 'body');
    recolorBody(a, GUER_COLORS[i % GUER_COLORS.length]);
    guerGear(a);
    const limb = { ll: null, lr: null, al: null, ar: null };
    a.getChildMeshes().forEach(m => {
      m.rotationQuaternion = null;
      if (m.name.indexOf('legL') >= 0) limb.ll = m;
      else if (m.name.indexOf('legR') >= 0) limb.lr = m;
      else if (m.name.indexOf('armL') >= 0) limb.al = m;
      else if (m.name.indexOf('armR') >= 0) limb.ar = m;
    });
    blob(0.5, 0.5, a);
    peds.push({
      node: a,
      limb,
      x,
      y,
      dx: 0,
      dy: 0,
      t: 0,
      ph: Math.random() * 6,
      swing: 0,
      down: 0,
      guer: true,
      gx: ltr ? 1 : -1,
      baseY: y,
      shootT: 1 + Math.random() * 2,
      life: 60
    });
  }
}
function guerShoot(p) {
  let best = null, bd = 9, kind = 0;
  for (const c of traffic) {
    if (c.crashed) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) { bd = d; best = c; kind = 1; }
  }
  if (!best) {
    for (const q of peds) {
      if (q === p || q.guer || q.down > 0) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; kind = 2; }
    }
  }
  if (!best && !P.down) {
    const d = Math.hypot(P.x - p.x, P.y - p.y);
    if (d < bd) { best = P; kind = 3; }
  }
  if (!best) return;
  const ux = (best.x - p.x) / (bd || 0.001), uy = (best.y - p.y) / (bd || 0.001);
  tracer(p.x, p.y, best.x, best.y);
  if (kind === 1) {
    best.hp = (best.hp == null ? 2 : best.hp) - 1;
    if (best.hp <= 0) ignite(best);
  } else if (kind === 2) {
    best.down = 1.6;
    launch(best, ux, uy, 1.5);
  } else {
    P.down = true;
    downT = 2;
    launch(P, ux, uy, 1.5);
  }
}
function respawnPed(p) {
  if (pedSpots.length) {
    const [tx, ty] = pedSpots[(Math.random() * pedSpots.length) | 0];
    p.x = tx + 0.5;
    p.y = ty + 0.5;
  }
  p.down = 0;
  p.drown = false;
  p.sink = 0;
  p.fy = 0;
  p.node.rotation.x = 0;
  p.node.rotation.z = 0;
  for (const m of p.node.getChildMeshes()) if (m.name === 'blob') m.setEnabled(true);
  p.t = 0.5;
  p.dx = 0;
  p.dy = 0;
  p.node.position.set(p.x, heightAt(p.x, p.y), p.y);
}
function updatePeds(dt) {
  guerT -= dt;
  if (guerT <= 0) {
    guerT = 18 + Math.random() * 10;
    if (peds.filter(p => p.guer).length < 8) spawnGuerr();
  }
  let anyDead = false;
  for (const p of peds) {
    if (p.dead) {
      anyDead = true;
      continue;
    }
    if (p.down > 0 || p.drown) {
      p.down -= dt;
      flyStep(p, dt);
      p.x = Math.max(1.5, Math.min(SIZE - 2.5, p.x));
      p.y = Math.max(1.5, Math.min(SIZE - 2.5, p.y));
      for (const m of p.node.getChildMeshes()) if (m.name === 'blob') m.setEnabled(false);
      if (city.tiles[(p.y | 0) * SIZE + (p.x | 0)] === T.WATER) p.drown = true;
      if (p.drown) {
        p.sink = (p.sink || 0) + dt;
        p.node.position.set(p.x, -0.15 - p.sink * 0.6, p.y);
        if (p.sink > 1.1) respawnPed(p);
        continue;
      }
      if (p.down <= 0) {
        p.node.rotation.x = 0;
        p.node.rotation.z = 0;
        p.fy = 0;
        for (const m of p.node.getChildMeshes()) if (m.name === 'blob') m.setEnabled(true);
        p.t = 0.5;
        p.dx = 0;
        p.dy = 0;
      }
      p.node.position.set(p.x, heightAt(p.x, p.y) + (p.fy || 0), p.y);
      continue;
    }
    if (p.guer) {
      p.life -= dt;
      if (p.life <= 0 || p.x < 0.8 || p.x > SIZE - 0.8) {
        p.dead = true;
        const ai = cityAnchors.indexOf(p.node);
        if (ai >= 0) cityAnchors.splice(ai, 1);
        p.node.dispose();
        continue;
      }
      const sp = 2.4 * dt;
      const nx = p.x + p.gx * sp;
      let ny = null;
      if (canStand(nx, p.baseY)) ny = p.baseY;
      else {
        for (const off of [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
          if (canStand(nx, p.baseY + off)) { ny = p.baseY + off; break; }
        }
      }
      if (ny != null) { p.x = nx; p.y = ny; }
      p.node.rotation.y = Math.atan2(p.gx, 0);
      p.ph += dt * 10;
      const gsw = Math.sin(p.ph) * 0.6;
      p.swing += (gsw - p.swing) * Math.min(1, dt * 12);
      if (p.limb.ll) {
        p.limb.ll.rotation.x = p.swing;
        p.limb.lr.rotation.x = -p.swing;
        p.limb.al.rotation.x = -p.swing * 0.7;
        p.limb.ar.rotation.x = p.swing * 0.7;
      }
      p.shootT -= dt;
      if (p.shootT <= 0) {
        p.shootT = 0.9 + Math.random() * 1.6;
        guerShoot(p);
      }
      p.node.position.set(p.x, heightAt(p.x, p.y), p.y);
      continue;
    }
    p.t -= dt;
    if (p.t <= 0) {
      if (Math.random() < 0.35) { p.dx = 0; p.dy = 0; p.t = 0.8 + Math.random() * 1.5; }
      else {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
        const d = dirs[(Math.random() * dirs.length) | 0];
        p.dx = d[0];
        p.dy = d[1];
        p.t = 1.5 + Math.random() * 3;
      }
    }
    const moving = !!(p.dx || p.dy);
    if (moving) {
      const l = Math.hypot(p.dx, p.dy);
      const sp = (1.7 * dt) / l;
      const nx = p.x + p.dx * sp, ny = p.y + p.dy * sp;
      if (canStand(nx, ny)) { p.x = nx; p.y = ny; }
      else p.t = 0;
      p.node.rotation.y = Math.atan2(p.dx, p.dy);
      p.ph += dt * 9;
    }
    const target = moving ? Math.sin(p.ph) * 0.6 : 0;
    p.swing += (target - p.swing) * Math.min(1, dt * 12);
    if (p.limb.ll) {
      p.limb.ll.rotation.x = p.swing;
      p.limb.lr.rotation.x = -p.swing;
      p.limb.al.rotation.x = -p.swing * 0.7;
      p.limb.ar.rotation.x = p.swing * 0.7;
    }
    if (p.crim) {
      p.nadeT -= dt;
      if (p.nadeT <= 0) {
        let best = null, bd = 7;
        for (const c of traffic) {
          if (c.crashed) continue;
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bd) { bd = d; best = c; }
        }
        if (best) {
          const cvx = best.chase ? (best.vx || 0) : (best.axis === 'x' ? best.dir * best.speed : 0);
          const cvz = best.chase ? (best.vz || 0) : (best.axis === 'y' ? best.dir * best.speed : 0);
          throwNade(p, best.x + cvx * 0.9, best.y + cvz * 0.9);
          p.nadeT = 4 + Math.random() * 5;
        } else {
          p.nadeT = 1;
        }
      }
    }
    p.node.position.set(p.x, heightAt(p.x, p.y), p.y);
  }
  if (anyDead) peds = peds.filter(p => !p.dead);
}

const P = { x: 0, y: 0, moving: false, down: false };
let downT = 0;
let playerNode = null;
let limbs = null;
let walkT = 0;
let swing = 0;
let idleAmp = 0;
const follow = new Vector3(0, 0, 0);

function buildCity(seed) {
  clearCity();
  city = generate(seed);
  solids = [];
  seedEl.textContent = 'seed: ' + seed;

  const gm = new StandardMaterial('g', scene);
  const gdt = new DynamicTexture('gt', { width: SIZE * 16, height: SIZE * 16 }, scene, true);
  gdt.getContext().drawImage(bakeGround(), 0, 0);
  gdt.update();
  gm.diffuseTexture = gdt;
  gm.specularColor = new Color3(0, 0, 0);
  groundMats = [gm];
  buildHeightGrid();
  groundMesh = buildGroundMesh(gm);

  waterMats = [0, 1].map(f => {
    const m = new StandardMaterial('w', scene);
    const wt = new DynamicTexture('wt' + f, { width: 16, height: 16 }, scene, true);
    wt.getContext().drawImage(flat.water[f], 0, 0);
    wt.update();
    wt.uScale = SIZE;
    wt.vScale = SIZE;
    wt.wrapAddressModeU = Texture.WRAP_ADDRESSMODE;
    wt.wrapAddressModeV = Texture.WRAP_ADDRESSMODE;
    m.diffuseTexture = wt;
    m.alpha = 0.95;
    m.specularColor = new Color3(0.15, 0.15, 0.15);
    return m;
  });
  waterPlane = CreateGround('water', { width: SIZE, height: SIZE }, scene);
  waterPlane.position = new Vector3(SIZE / 2 - 0.5, -0.08, SIZE / 2 - 0.5);
  waterPlane.material = waterMats[0];

  shadowMat = new StandardMaterial('sh', scene);
  shadowMat.diffuseColor = new Color3(0, 0, 0);
  shadowMat.emissiveColor = new Color3(0, 0, 0);
  shadowMat.specularColor = new Color3(0, 0, 0);
  shadowMat.alpha = 0.32;
  shadowMat.backFaceCulling = false;

  for (const b of city.buildings) {
    const a = spawn('bld_' + b.si + '_' + b.pi);
    a.position = new Vector3(b.x + b.w / 2 - 0.5, 0, b.y + b.d / 2 - 0.5);
    a.scaling.y = 0.65 + ((b.x * 13 + b.y * 7 + b.si * 5) % 10) / 11;
    a.scaling.x = a.scaling.z = 0.92 + ((b.x + b.y * 3) % 4) * 0.03;
    blob(b.w + 0.25, b.d + 0.25, a);
  }

  for (const dcr of city.decor) {
    const x = dcr.x, z = dcr.y;
    if (dcr.kind === 'tree') {
      solids.push({ x, y: z, r: 0.28 });
      const a = spawn(dcr.v ? 'tree_cone' : 'tree_round');
      a.position = new Vector3(x, heightAt(x, z), z);
      a.rotation.y = ((x * 7 + z * 13) % 628) / 100;
      const sc = 0.9 + ((x + z) % 3) * 0.12;
      a.scaling.setAll(sc);
      blob(0.95 * sc, 0.95 * sc, a);
    } else if (dcr.kind === 'lamp') {
      solids.push({ x, y: z, r: 0.15 });
      const a = spawn('lamp');
      a.position = new Vector3(x, heightAt(x, z), z);
      blob(0.3, 0.3, a);
    } else if (dcr.kind === 'car') {
      const sol = dcr.orient === 'ry'
        ? { x, y: z, rx: 0.35, ry: 0.65 }
        : { x, y: z, rx: 0.65, ry: 0.35 };
      solids.push(sol);
      const a = spawn('car');
      deinstance(a, 'cb');
      a.position = new Vector3(x, 0, z);
      if (dcr.orient === 'ry') a.rotation.y = Math.PI / 2;
      parked.push({
        node: a,
        x,
        y: z,
        ox: x,
        oy: z,
        sol,
        axis: dcr.orient === 'ry' ? 'y' : 'x',
        dir: 1,
        crashed: false,
        crashT: 0,
        fire: null,
        fy: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        sx: 0,
        sy: 0,
        sz: 0,
      });
      blob(1.3, 0.8, a);
      const col = CAR_COLORS[dcr.v % CAR_COLORS.length];
      for (const m of a.getChildMeshes()) {
        if (m.material && m.material.name.indexOf('car_body') === 0) {
          const cm = m.material.clone();
          cm.albedoColor = new Color3(col[0], col[1], col[2]);
          m.material = cm;
          cityMats.push(cm);
        }
      }
    } else {
      const a = spawn('boat');
      a.position = new Vector3(x, -0.05, z);
      a.rotation.y = ((x * 31) % 2) ? Math.PI / 2 : 0;
      blob(1.9, 0.85, a, 0.03);
    }
  }

  P.x = city.start.x;
  P.y = city.start.y;
  camp.x = P.x;
  camp.y = P.y;
  camp.t = 0;
  playerNode = spawn('player');
  P.node = playerNode;
  playerNode.position = new Vector3(P.x, 0, P.y);
  blob(0.5, 0.5, playerNode);
  limbs = { ll: null, lr: null, al: null, ar: null, bb: null, bbY: 0 };
  playerNode.getChildMeshes().forEach(m => {
    m.rotationQuaternion = null;
    if (m.name.indexOf('legL') >= 0) limbs.ll = m;
    else if (m.name.indexOf('legR') >= 0) limbs.lr = m;
    else if (m.name.indexOf('armL') >= 0) limbs.al = m;
    else if (m.name.indexOf('armR') >= 0) limbs.ar = m;
    else if (m.name.indexOf('body') >= 0) limbs.bb = m;
  });
  if (limbs.bb) limbs.bbY = limbs.bb.position.y;
  walkT = 0;
  swing = 0;
  idleAmp = 0;
  P.down = false;
  downT = 0;
  follow.copyFrom(playerNode.position);
  camera.position.set(follow.x + OFF.x, OFF.y, follow.z + OFF.z);
  spawnTraffic();
  spawnPeds();
}

const keys = {};
// Magnitud del movimiento actual (0..1): las teclas dan siempre 1, el joystick
// es analógico.
let moveMag = 0;
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'run', ShiftRight: 'run'
};
window.addEventListener('keydown', e => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR') buildCity((Math.random() * 1e9) | 0);
});
window.addEventListener('keyup', e => {
  if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
});
document.getElementById('new').addEventListener('click', () => buildCity((Math.random() * 1e9) | 0));

// Panel de ayuda: en pantallas pequeñas tapaba media ciudad, así que arranca
// plegado y sólo deja el título y el cronómetro.
const uiEl = document.getElementById('ui');
const uiToggle = document.getElementById('uitoggle');
let uiManual = false;
function setUi(open) {
  uiEl.classList.toggle('collapsed', !open);
  uiToggle.textContent = open ? '\u2212' : '+';
  uiToggle.setAttribute('aria-expanded', String(open));
}
const uiFits = () => window.innerWidth >= 720 && window.innerHeight >= 520;
setUi(uiFits());
uiToggle.addEventListener('click', () => {
  uiManual = true;
  setUi(uiEl.classList.contains('collapsed'));
});
window.addEventListener('resize', () => { if (!uiManual) setUi(uiFits()); });

// --- Controles táctiles ---------------------------------------------------
// Joystick flotante (aparece donde toques) + botones de sprint y nueva ciudad.
const touchMove = { dx: 0, dy: 0, mag: 0 };
const isTouch = new URLSearchParams(location.search).has('touch') ||
  (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
if (isTouch) setupTouch();

function setupTouch() {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('knob');
  const R = 52;      // radio útil del joystick, en px
  const DEAD = 0.16; // zona muerta para no derivar con el pulgar quieto
  let id = null;
  let cx = 0;
  let cy = 0;

  const place = (x, y) => { stick.style.left = x + 'px'; stick.style.top = y + 'px'; };
  const rest = () => place(88, window.innerHeight - Math.min(116, window.innerHeight * 0.32));

  function start(e) {
    if (id !== null) return;
    id = e.pointerId;
    cx = e.clientX;
    cy = e.clientY;
    stick.classList.add('on');
    place(cx, cy);
    move(e);
  }
  function move(e) {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    const m = Math.min(1, d / R);
    if (m < DEAD) { touchMove.mag = 0; return; }
    // Pantalla -> isométrico: el mismo giro que hacen las teclas.
    const wx = dy - dx;
    const wy = dy + dx;
    const l = Math.hypot(wx, wy) || 1;
    touchMove.dx = wx / l;
    touchMove.dy = wy / l;
    touchMove.mag = (m - DEAD) / (1 - DEAD);
  }
  function end(e) {
    if (e.pointerId !== id) return;
    id = null;
    touchMove.mag = 0;
    knob.style.transform = '';
    stick.classList.remove('on');
    rest();
  }
  // El joystick escucha en el canvas (los botones quedan por encima), así el
  // pulgar puede arrancar en cualquier punto libre de la pantalla.
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    start(e);
  });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (id === null) rest(); });
  rest();

  const runBtn = document.getElementById('brun');
  const setRun = v => { keys.run = v; runBtn.classList.toggle('on', v); };
  runBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    // Con captura el dedo puede salirse del botón sin soltar el sprint.
    try { runBtn.setPointerCapture(e.pointerId); } catch (_) { /* pointer sintético */ }
    setRun(true);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'])
    runBtn.addEventListener(t, () => setRun(false));
  document.getElementById('bnew').addEventListener('click', () => buildCity((Math.random() * 1e9) | 0));
}
const aliveEl = document.getElementById('alive');
let aliveT = 0;
let bestT = 0;
let prevDown = false;
let lastAliveS = -1;
function fmtT(t) {
  t = Math.floor(t);
  const m = (t / 60) | 0;
  const s = t % 60;
  return m > 0 ? m + 'm' + (s < 10 ? '0' : '') + s + 's' : s + 's';
}
const stamBar = document.getElementById('stam');
const stamFill = document.getElementById('stamf');
let stam = 1;
let exhausted = false;
let running = false;

let last = performance.now();
let waterT = 0;
engine.runRenderLoop(() => {
  try {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (city && playerNode) {
    if (P.down) {
      downT -= dt;
      P.moving = false;
      moveMag = 0;
      flyStep(P, dt);
      for (const m of playerNode.getChildMeshes()) if (m.name === 'blob') m.setEnabled(false);
      if (downT <= 0) {
        P.down = false;
        playerNode.rotation.x = 0;
        playerNode.rotation.z = 0;
        P.fy = 0;
        P.x = city.start.x;
        P.y = city.start.y;
        for (const m of playerNode.getChildMeshes()) if (m.name === 'blob') m.setEnabled(true);
        follow.copyFrom(playerNode.position);
      }
    } else {
    let dx = 0, dy = 0;
    if (keys.up) { dx -= 1; dy -= 1; }
    if (keys.down) { dx += 1; dy += 1; }
    if (keys.left) { dx += 1; dy -= 1; }
    if (keys.right) { dx -= 1; dy += 1; }
    if (dx || dy) {
      const l = Math.hypot(dx, dy);
      dx /= l;
      dy /= l;
      moveMag = 1;
    } else if (touchMove.mag > 0) {
      dx = touchMove.dx;
      dy = touchMove.dy;
      moveMag = touchMove.mag;
    } else {
      moveMag = 0;
    }
    P.moving = moveMag > 0;
    running = false;
    if (exhausted && stam > 0.35) exhausted = false;
    if (keys.run && P.moving && !exhausted && stam > 0) {
      running = true;
      stam = Math.max(0, stam - dt / 3);
      if (stam === 0) exhausted = true;
    } else {
      stam = Math.min(1, stam + dt / 4.5);
    }
    if (P.moving) {
      const base = exhausted ? 4.6 * 0.55 : 4.6;
      const sp = (running ? base * 1.75 : base) * dt * moveMag;
      const nx = P.x + dx * sp;
      const ny = P.y + dy * sp;
      if (canStand(nx, P.y)) P.x = nx;
      if (canStand(P.x, ny)) P.y = ny;
      playerNode.rotation.y = Math.atan2(dx, dy);
    }
    }
    stamBar.style.opacity = running || stam < 0.999 ? '1' : '0';
    stamFill.style.width = (stam * 100).toFixed(1) + '%';
    stamFill.style.background = exhausted ? '#d3575a' : running ? '#ffd977' : '#7dd35a';
    if (!prevDown && P.down) {
      bestT = Math.max(bestT, aliveT);
      aliveT = 0;
      lastAliveS = -1;
    }
    prevDown = P.down;
    if (!P.down) aliveT += dt;
    if (Math.floor(aliveT) !== lastAliveS) {
      lastAliveS = Math.floor(aliveT);
      aliveEl.textContent = 'sin morir: ' + fmtT(aliveT) + ' (record ' + fmtT(bestT) + ')';
    }
    if (P.moving) walkT += dt * (running ? 16 : 11) * (0.45 + 0.55 * moveMag);
    const swT = P.moving ? Math.sin(walkT) * 0.7 : 0;
    swing += (swT - swing) * Math.min(1, dt * 15);
    idleAmp += ((P.moving ? 0 : 1) - idleAmp) * Math.min(1, dt * 5);
    const sway = Math.sin(waterT * 2.2) * 0.06 * idleAmp;
    if (limbs.ll) {
      limbs.ll.rotation.x = swing;
      limbs.lr.rotation.x = -swing;
      limbs.al.rotation.x = -swing * 0.7 + sway;
      limbs.ar.rotation.x = swing * 0.7 - sway;
      if (limbs.bb) {
        limbs.bb.position.y = limbs.bbY +
          Math.sin(walkT * 2) * 0.02 * (P.moving ? 1 : 0) +
          Math.sin(waterT * 2.2) * 0.008 * idleAmp;
      }
    }
    updateTraffic(dt);
    updateParked(dt);
    updatePeds(dt);
    updateNades(dt);
    updateTracers(dt);
    updateMeteor(dt);
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      b.t += dt;
      const k = b.t / 0.55;
      b.m.scaling.setAll(1 + k * 3.5);
      b.mat.alpha = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) {
        b.m.dispose();
        b.mat.dispose();
        booms.splice(i, 1);
      }
    }
    playerNode.position.x = P.x;
    playerNode.position.y = heightAt(P.x, P.y) + (P.fy || 0);
    playerNode.position.z = P.y;
    follow.x += (P.x - follow.x) * Math.min(1, dt * 6);
    follow.z += (P.y - follow.z) * Math.min(1, dt * 6);
    camera.position.x = follow.x + OFF.x;
    camera.position.z = follow.z + OFF.z;
  }

  waterT += dt;
  if (waterPlane && waterT > 0.7) {
    waterT = 0;
    waterPlane.material = waterMats[((performance.now() / 700) | 0) % 2];
  }
  scene.render();
  } catch (e) { window.__loopErr = e.message; }
});

window.__game = { scene, camera, engine, build: buildCity, get city() { return city; }, get P() { return P; }, get limbs() { return limbs; }, get swing() { return swing; }, get traffic() { return traffic; }, get parked() { return parked; }, get peds() { return peds; }, get nades() { return nades; }, get off() { return OFF; }, get pedSpots() { return pedSpots; }, get stam() { return stam; }, get exhausted() { return exhausted; }, get running() { return running; }, get moveMag() { return moveMag; }, get meteor() { return meteor; }, get camp() { return camp; }, respawnPed, ignite, explode };

loadAssets().then(() => {
  buildCity(pendingSeed != null ? pendingSeed : (Math.random() * 1e9) | 0);
});
