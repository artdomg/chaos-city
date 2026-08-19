#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera los modelos .glb de assets/ sin dependencias externas.

Los .glb del juego se sacaban a mano de Blender (tools/blender_bridge.py) y eran
cajas casi peladas. Aquí se construyen por código: mismas piezas, mismos nombres
de nodo y de material -- js/main.js busca varios por nombre -- pero con bastante
más detalle: ventanas con marco y repisa, cornisas, tejados con peto y trastos
encima, coches con lunas, llantas y faros, árboles de varias copas, etc.

Contrato con js/main.js (no tocar sin mirar el .js):
  * car.glb    -> la carrocería va en nodos cuyo nombre contiene 'cb' y con
                  material que empieza por 'car_body' (deinstance + recolor).
  * player.glb -> nodos 'body', 'head', 'armL', 'armR', 'legL', 'legR'; los
                  miembros giran sobre su propio origen (hombro / cadera) y
                  'body' se recolorea por peatón.
  * bld_S_P    -> S es el índice de SHAPES (ancho, fondo, plantas) y P la
                  variante de estilo; el juego los estira en Y (0.65..1.6).
  * El motor mira desde +X/+Z (cámara isométrica fija), así que el portal, los
    balcones y los toldos van en esas dos fachadas.

Uso:  python3 tools/gen_assets.py [directorio_salida]
"""

import json
import math
import os
import random
import struct
import sys

# --- Álgebra mínima ---------------------------------------------------------


def ident():
    return (1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0)


def mul(a, b):
    """Compone dos matrices afines 3x4 (aplica b y luego a)."""
    out = []
    for r in range(3):
        for c in range(3):
            out.append(a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c])
        out.append(a[r * 4 + 0] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3])
    return tuple(out)


def trans(x, y, z):
    return (1.0, 0, 0, x, 0, 1.0, 0, y, 0, 0, 1.0, z)


def scale(x, y, z):
    return (x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return (1.0, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0)


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return (c, 0, s, 0, 0, 1.0, 0, 0, -s, 0, c, 0)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return (c, -s, 0, 0, s, c, 0, 0, 0, 0, 1.0, 0)


def xf(m, p):
    if m is None:
        return p
    x, y, z = p
    return (m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def unit(v):
    l = math.sqrt(dot(v, v))
    if l < 1e-9:
        return (0.0, 1.0, 0.0)
    return (v[0] / l, v[1] / l, v[2] / l)


# --- Piezas y modelo -------------------------------------------------------


class Part:
    """Un nodo del .glb: geometría de un solo material."""

    def __init__(self, name, mat, translation=(0, 0, 0), parent=None):
        self.name = name
        self.mat = mat
        self.translation = translation
        self.parent = parent
        self.pos = []
        self.nrm = []
        self.idx = []
        self._seen = {}

    def vertex(self, p, n):
        key = (round(p[0], 5), round(p[1], 5), round(p[2], 5),
               round(n[0], 3), round(n[1], 3), round(n[2], 3))
        i = self._seen.get(key)
        if i is None:
            i = len(self.pos) // 3
            self._seen[key] = i
            self.pos.extend((p[0], p[1], p[2]))
            self.nrm.extend((n[0], n[1], n[2]))
        return i

    def empty(self):
        return not self.idx


class Model:
    def __init__(self):
        self.mats = []
        self._mat_idx = {}
        self.parts = []

    def mat(self, name, color, rough=0.85, metal=0.0, emissive=None, alpha=None):
        if name in self._mat_idx:
            return name
        m = {
            'name': name,
            'doubleSided': False,
            'pbrMetallicRoughness': {
                'baseColorFactor': [round(color[0], 4), round(color[1], 4), round(color[2], 4),
                                    1.0 if alpha is None else alpha],
                'metallicFactor': metal,
                'roughnessFactor': rough,
            },
        }
        if emissive:
            m['emissiveFactor'] = [round(emissive[0], 4), round(emissive[1], 4), round(emissive[2], 4)]
        if alpha is not None and alpha < 1.0:
            m['alphaMode'] = 'BLEND'
        self._mat_idx[name] = len(self.mats)
        self.mats.append(m)
        return name

    def part(self, name, mat, translation=(0, 0, 0), parent=None):
        p = Part(name, mat, translation, parent)
        self.parts.append(p)
        return p


# --- Primitivas ------------------------------------------------------------


def tri(p, a, b, c, inside=None, m=None):
    a, b, c = xf(m, a), xf(m, b), xf(m, c)
    n = unit(cross(sub(b, a), sub(c, a)))
    if inside is not None:
        mid = ((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)
        if dot(n, sub(mid, xf(m, inside))) < 0:
            a, b, c = a, c, b
            n = (-n[0], -n[1], -n[2])
    p.idx.extend((p.vertex(a, n), p.vertex(b, n), p.vertex(c, n)))


def quad(p, a, b, c, d, inside=None, m=None):
    a, b, c, d = xf(m, a), xf(m, b), xf(m, c), xf(m, d)
    n = unit(cross(sub(b, a), sub(c, a)))
    if inside is not None:
        mid = ((a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4)
        if dot(n, sub(mid, xf(m, inside))) < 0:
            a, b, c, d = d, c, b, a
            n = (-n[0], -n[1], -n[2])
    i0 = p.vertex(a, n)
    i1 = p.vertex(b, n)
    i2 = p.vertex(c, n)
    i3 = p.vertex(d, n)
    p.idx.extend((i0, i1, i2, i0, i2, i3))


def box(p, center, size, skip=(), m=None):
    """Caja alineada; con m (giro/escala) se transforma sobre su propio centro.

    skip: caras a omitir ('-y' para las que se apoyan, o la trasera de un
    detalle pegado a una pared, que nunca se ve).
    """
    sx, sy, sz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    base = trans(*center)
    if m is not None:
        base = mul(base, m)
    faces = {
        '+x': ((sx, -sy, -sz), (sx, -sy, sz), (sx, sy, sz), (sx, sy, -sz)),
        '-x': ((-sx, -sy, sz), (-sx, -sy, -sz), (-sx, sy, -sz), (-sx, sy, sz)),
        '+z': ((sx, -sy, sz), (-sx, -sy, sz), (-sx, sy, sz), (sx, sy, sz)),
        '-z': ((-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz)),
        '+y': ((-sx, sy, -sz), (sx, sy, -sz), (sx, sy, sz), (-sx, sy, sz)),
        '-y': ((-sx, -sy, sz), (sx, -sy, sz), (sx, -sy, -sz), (-sx, -sy, -sz)),
    }
    for k, pts in faces.items():
        if k in skip:
            continue
        quad(p, pts[0], pts[1], pts[2], pts[3], inside=(0, 0, 0), m=base)


def frustum(p, y0, y1, s0, s1, c0=(0, 0), c1=None, cap_top=True, cap_bottom=False, m=None):
    """Prisma de base rectangular con sección variable (para troncos, torsos...)."""
    if c1 is None:
        c1 = c0
    ax, az = s0[0] / 2.0, s0[1] / 2.0
    bx, bz = s1[0] / 2.0, s1[1] / 2.0
    a = [(c0[0] - ax, y0, c0[1] - az), (c0[0] + ax, y0, c0[1] - az),
         (c0[0] + ax, y0, c0[1] + az), (c0[0] - ax, y0, c0[1] + az)]
    b = [(c1[0] - bx, y1, c1[1] - bz), (c1[0] + bx, y1, c1[1] - bz),
         (c1[0] + bx, y1, c1[1] + bz), (c1[0] - bx, y1, c1[1] + bz)]
    inside = ((c0[0] + c1[0]) / 2, (y0 + y1) / 2, (c0[1] + c1[1]) / 2)
    for i in range(4):
        j = (i + 1) % 4
        quad(p, a[i], a[j], b[j], b[i], inside=inside, m=m)
    if cap_top:
        quad(p, b[0], b[1], b[2], b[3], inside=inside, m=m)
    if cap_bottom:
        quad(p, a[0], a[1], a[2], a[3], inside=inside, m=m)


def cyl(p, center, r, h, seg=12, r_top=None, axis='y', caps=True, m=None):
    if r_top is None:
        r_top = r
    base = trans(*center)
    if m is not None:
        base = mul(base, m)
    if axis == 'z':
        base = mul(base, rot_x(math.pi / 2))
    elif axis == 'x':
        base = mul(base, rot_z(math.pi / 2))
    y0, y1 = -h / 2.0, h / 2.0
    inside = (0.0, 0.0, 0.0)
    ring0, ring1 = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring0.append((math.cos(a) * r, y0, math.sin(a) * r))
        ring1.append((math.cos(a) * r_top, y1, math.sin(a) * r_top))
    for i in range(seg):
        j = (i + 1) % seg
        quad(p, ring0[i], ring0[j], ring1[j], ring1[i], inside=inside, m=base)
    if caps:
        for i in range(1, seg - 1):
            tri(p, ring1[0], ring1[i], ring1[i + 1], inside=inside, m=base)
            tri(p, ring0[0], ring0[i], ring0[i + 1], inside=inside, m=base)


def cone(p, base_center, r, h, seg=10, m=None):
    base = mul(trans(*base_center), m) if m else trans(*base_center)
    inside = (0, h * 0.35, 0)
    ring = [(math.cos(2 * math.pi * i / seg) * r, 0.0, math.sin(2 * math.pi * i / seg) * r) for i in range(seg)]
    apex = (0.0, h, 0.0)
    for i in range(seg):
        j = (i + 1) % seg
        tri(p, ring[i], ring[j], apex, inside=inside, m=base)
    for i in range(1, seg - 1):
        tri(p, ring[0], ring[i], ring[i + 1], inside=inside, m=base)


def blob(p, center, radius, seg=8, rings=5, squash=(1.0, 1.0, 1.0), jitter=0.0, rng=None, m=None):
    """Esfera de pocos lados; con jitter queda orgánica (copas de árbol)."""
    base = mul(trans(*center), m) if m else trans(*center)
    def pt(ri, si):
        phi = math.pi * ri / rings
        th = 2 * math.pi * si / seg
        r = radius
        if jitter and rng is not None:
            r *= 1.0 + (rng.random() - 0.5) * jitter
        return (math.sin(phi) * math.cos(th) * r * squash[0],
                math.cos(phi) * r * squash[1],
                math.sin(phi) * math.sin(th) * r * squash[2])
    grid = [[pt(ri, si) for si in range(seg)] for ri in range(rings + 1)]
    # Los polos son un punto único.
    for si in range(seg):
        grid[0][si] = (0.0, grid[0][0][1], 0.0)
        grid[rings][si] = (0.0, grid[rings][0][1], 0.0)
    inside = (0.0, 0.0, 0.0)
    for ri in range(rings):
        for si in range(seg):
            sj = (si + 1) % seg
            a, b = grid[ri][si], grid[ri][sj]
            c, d = grid[ri + 1][sj], grid[ri + 1][si]
            if ri == 0:
                tri(p, a, c, d, inside=inside, m=base)
            elif ri == rings - 1:
                tri(p, a, b, c, inside=inside, m=base)
            else:
                quad(p, a, b, c, d, inside=inside, m=base)


def gable(p, center, size, h, along='x', m=None):
    """Tejado a dos aguas: dos faldones y dos hastiales."""
    cx, cy, cz = center
    sx, sz = size[0] / 2.0, size[1] / 2.0
    inside = (cx, cy + h * 0.3, cz)
    if along == 'x':
        r0 = (cx - sx, cy + h, cz)
        r1 = (cx + sx, cy + h, cz)
        quad(p, (cx - sx, cy, cz + sz), (cx + sx, cy, cz + sz), r1, r0, inside=inside, m=m)
        quad(p, (cx + sx, cy, cz - sz), (cx - sx, cy, cz - sz), r0, r1, inside=inside, m=m)
        tri(p, (cx - sx, cy, cz - sz), (cx - sx, cy, cz + sz), r0, inside=inside, m=m)
        tri(p, (cx + sx, cy, cz + sz), (cx + sx, cy, cz - sz), r1, inside=inside, m=m)
    else:
        r0 = (cx, cy + h, cz - sz)
        r1 = (cx, cy + h, cz + sz)
        quad(p, (cx + sx, cy, cz - sz), (cx + sx, cy, cz + sz), r1, r0, inside=inside, m=m)
        quad(p, (cx - sx, cy, cz + sz), (cx - sx, cy, cz - sz), r0, r1, inside=inside, m=m)
        tri(p, (cx - sx, cy, cz - sz), (cx + sx, cy, cz - sz), r0, inside=inside, m=m)
        tri(p, (cx + sx, cy, cz + sz), (cx - sx, cy, cz + sz), r1, inside=inside, m=m)


# --- Espejo en X -----------------------------------------------------------


def mirror_x(model):
    """Invierte el modelo en X antes de escribirlo.

    El cargador de glTF de Babylon mete un nodo __root__ con scaling.z = -1 y
    un giro de 180° en Y para pasar a su sistema zurdo, y spawn() en main.js
    clona ese nodo, así que lo que llega a la escena sale reflejado en X. Aquí
    modelamos en coordenadas de juego (morro del coche a +X, fachadas vistas
    por la cámara en +X/+Z, cara del personaje a +Z) y compensamos al final.
    """
    for p in model.parts:
        for i in range(0, len(p.pos), 3):
            p.pos[i] = -p.pos[i]
            p.nrm[i] = -p.nrm[i]
        # Al reflejar, los triángulos quedan al revés: se recupera el orden.
        for i in range(0, len(p.idx), 3):
            p.idx[i + 1], p.idx[i + 2] = p.idx[i + 2], p.idx[i + 1]
        p.translation = (-p.translation[0], p.translation[1], p.translation[2])
    return model


# --- Escritura .glb --------------------------------------------------------


def write_glb(path, model):
    bin_parts = []
    offset = 0
    accessors = []
    buffer_views = []
    meshes = []
    nodes = []
    node_of = {}

    def add_view(data, target=None):
        nonlocal offset
        pad = (-len(data)) % 4
        bin_parts.append(data + b'\x00' * pad)
        bv = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        buffer_views.append(bv)
        offset += len(data) + pad
        return len(buffer_views) - 1

    parts = [p for p in model.parts if not p.empty()]
    # Sólo van al fichero los materiales que alguna pieza usa.
    used = []
    mat_idx = {}
    for p in parts:
        if p.mat not in mat_idx:
            mat_idx[p.mat] = len(used)
            used.append(model.mats[model._mat_idx[p.mat]])
    for p in parts:
        pos = struct.pack('<%df' % len(p.pos), *p.pos)
        nrm = struct.pack('<%df' % len(p.nrm), *p.nrm)
        n_vert = len(p.pos) // 3
        if n_vert > 65535:
            raise SystemExit('demasiados vértices en %s (%d)' % (p.name, n_vert))
        idx = struct.pack('<%dH' % len(p.idx), *p.idx)
        v_pos = add_view(pos, 34962)
        v_nrm = add_view(nrm, 34962)
        v_idx = add_view(idx, 34963)
        mins = [min(p.pos[i::3]) for i in range(3)]
        maxs = [max(p.pos[i::3]) for i in range(3)]
        a_pos = len(accessors)
        accessors.append({'bufferView': v_pos, 'componentType': 5126, 'count': n_vert,
                          'type': 'VEC3', 'min': mins, 'max': maxs})
        a_nrm = len(accessors)
        accessors.append({'bufferView': v_nrm, 'componentType': 5126, 'count': n_vert, 'type': 'VEC3'})
        a_idx = len(accessors)
        accessors.append({'bufferView': v_idx, 'componentType': 5123, 'count': len(p.idx), 'type': 'SCALAR'})
        meshes.append({
            'name': p.name,
            'primitives': [{
                'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm},
                'indices': a_idx,
                'material': mat_idx[p.mat],
            }],
        })
        node = {'name': p.name, 'mesh': len(meshes) - 1}
        if tuple(p.translation) != (0, 0, 0):
            node['translation'] = [round(v, 5) for v in p.translation]
        node_of[id(p)] = len(nodes)
        nodes.append(node)

    roots = []
    for p in parts:
        i = node_of[id(p)]
        if p.parent is not None and id(p.parent) in node_of:
            parent = nodes[node_of[id(p.parent)]]
            parent.setdefault('children', []).append(i)
        else:
            roots.append(i)

    blob_bin = b''.join(bin_parts)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'chaos-city tools/gen_assets.py'},
        'scene': 0,
        'scenes': [{'name': 'Scene', 'nodes': roots}],
        'nodes': nodes,
        'meshes': meshes,
        'materials': used,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(blob_bin)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob_bin))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(blob_bin), 0x004E4942) + blob_bin
    with open(path, 'wb') as f:
        f.write(out)
    return len(out), sum(len(p.pos) // 3 for p in parts), len(parts)


# --- Árboles ---------------------------------------------------------------


def tree_round(seed=11):
    rng = random.Random(seed)
    m = Model()
    m.mat('leaf', (0.27, 0.53, 0.24), rough=0.9)
    m.mat('leafhi', (0.36, 0.61, 0.27), rough=0.9)
    m.mat('trunk', (0.35, 0.24, 0.13), rough=0.95)
    tr = m.part('tr', 'trunk')
    cn = m.part('cn', 'leaf')
    cn2 = m.part('cn2', 'leafhi')
    # Tronco con ensanche en la base y dos ramas hacia la copa.
    cyl(tr, (0, 0.04, 0), 0.135, 0.08, seg=8, r_top=0.1)
    cyl(tr, (0, 0.34, 0), 0.1, 0.54, seg=8, r_top=0.062)
    cyl(tr, (0.1, 0.66, -0.02), 0.035, 0.3, seg=6, r_top=0.02, m=rot_z(-0.7))
    cyl(tr, (-0.09, 0.72, 0.05), 0.032, 0.26, seg=6, r_top=0.02, m=rot_z(0.6))
    # Copa: varias masas que se solapan, más las de luz en el lado de la cámara.
    for c, r, sq in (((0, 1.0, 0), 0.44, (1.0, 0.92, 1.0)),
                     ((0.19, 0.78, -0.16), 0.29, (1.0, 0.9, 1.0)),
                     ((-0.21, 0.87, 0.17), 0.28, (1.0, 0.95, 1.0)),
                     ((0.02, 1.26, 0.03), 0.27, (1.0, 0.95, 1.0))):
        blob(cn, c, r, seg=8, rings=5, squash=sq, jitter=0.22, rng=rng)
    for c, r in (((0.17, 1.19, 0.15), 0.19), ((0.25, 0.97, 0.09), 0.15), ((0.05, 1.32, 0.18), 0.13)):
        blob(cn2, c, r, seg=7, rings=4, jitter=0.25, rng=rng)
    return m


def tree_cone(seed=23):
    rng = random.Random(seed)
    m = Model()
    m.mat('leaf2', (0.2, 0.42, 0.26), rough=0.9)
    m.mat('leafhi', (0.27, 0.5, 0.29), rough=0.9)
    m.mat('trunk', (0.33, 0.22, 0.12), rough=0.95)
    tr = m.part('tr', 'trunk')
    cn = m.part('cn', 'leaf2')
    cn2 = m.part('cn2', 'leafhi')
    cyl(tr, (0, 0.03, 0), 0.13, 0.06, seg=8, r_top=0.095)
    cyl(tr, (0, 0.26, 0), 0.09, 0.46, seg=8, r_top=0.055)
    # Tres pisos de copa, cada uno un poco girado para que no se alineen.
    for y, r, h, rotv in ((0.24, 0.5, 0.72, 0.0), (0.66, 0.4, 0.62, 0.5), (1.04, 0.27, 0.56, 1.1)):
        cone(cn, (0, y, 0), r, h, seg=10, m=rot_y(rotv))
    for y, r, h in ((0.5, 0.2, 0.3), (0.88, 0.15, 0.26), (1.3, 0.11, 0.3)):
        cone(cn2, (0.04, y, 0.04), r, h, seg=8)
    return m


# --- Farola ----------------------------------------------------------------


def lamp():
    m = Model()
    m.mat('pole', (0.16, 0.17, 0.2), rough=0.6, metal=0.3)
    m.mat('lamphead', (1.0, 0.88, 0.55), rough=0.35, emissive=(0.5, 0.4, 0.16))
    lp = m.part('lp', 'pole')
    lh = m.part('lh', 'lamphead')
    box(lp, (0, 0.025, 0), (0.2, 0.05, 0.2), skip=('-y',))
    box(lp, (0, 0.075, 0), (0.15, 0.06, 0.15))
    cyl(lp, (0, 0.55, 0), 0.055, 0.9, seg=8, r_top=0.036)
    # Anillo decorativo a media altura y brazo del farol.
    cyl(lp, (0, 0.62, 0), 0.055, 0.05, seg=8)
    box(lp, (0, 1.02, 0), (0.13, 0.035, 0.13))
    # Farol: cristal troncocónico y sombrerete.
    frustum(lh, 1.04, 1.19, (0.11, 0.11), (0.2, 0.2), cap_top=False, cap_bottom=True)
    frustum(lp, 1.19, 1.28, (0.24, 0.24), (0.07, 0.07), cap_top=True, cap_bottom=True)
    cyl(lp, (0, 1.31, 0), 0.03, 0.06, seg=6, r_top=0.015)
    return m


# --- Coche (frente hacia +X) ----------------------------------------------


def car():
    m = Model()
    m.mat('car_body', (0.75, 0.15, 0.15), rough=0.35, metal=0.15)
    m.mat('glass', (0.38, 0.52, 0.63), rough=0.12, metal=0.1, alpha=0.85)
    m.mat('tire', (0.08, 0.08, 0.09), rough=0.95)
    m.mat('rim', (0.72, 0.74, 0.78), rough=0.35, metal=0.6)
    m.mat('trim', (0.2, 0.21, 0.23), rough=0.5, metal=0.4)
    m.mat('headlight', (1.0, 0.96, 0.8), rough=0.15, emissive=(0.35, 0.33, 0.24))
    m.mat('taillight', (0.8, 0.12, 0.1), rough=0.2, emissive=(0.3, 0.04, 0.03))
    cb = m.part('cb', 'car_body')
    cc = m.part('cc', 'glass')
    wh = m.part('wh', 'tire')
    rim = m.part('rim', 'rim')
    tp = m.part('trim', 'trim')
    lf = m.part('lampf', 'headlight')
    lr = m.part('lampr', 'taillight')

    # Carrocería: bajos, cintura y capó/maletero con caída hacia los extremos.
    frustum(cb, 0.15, 0.3, (1.1, 0.5), (1.15, 0.6), cap_bottom=True, cap_top=False)
    frustum(cb, 0.3, 0.44, (1.15, 0.6), (1.14, 0.58), cap_top=False)
    frustum(cb, 0.44, 0.5, (1.05, 0.56), (0.9, 0.5), cap_top=True)
    # Capó y maletero, ligeramente más bajos que la cintura.
    box(cb, (0.36, 0.485, 0), (0.44, 0.05, 0.55))
    box(cb, (-0.44, 0.5, 0), (0.26, 0.06, 0.52))
    # Cabina: pilares y techo.
    box(cb, (-0.105, 0.705, 0), (0.48, 0.05, 0.49))
    box(cb, (0.145, 0.6, 0), (0.06, 0.24, 0.44), m=rot_z(0.42))
    box(cb, (-0.36, 0.61, 0), (0.06, 0.24, 0.46), m=rot_z(-0.3))
    for sz in (0.245, -0.245):
        box(cb, (-0.1, 0.53, sz), (0.5, 0.09, 0.03))
    # Pasos de rueda.
    for sx in (0.38, -0.38):
        for sz in (0.3, -0.3):
            box(cb, (sx, 0.3, sz), (0.42, 0.16, 0.05))
    # Lunas.
    box(cc, (0.115, 0.6, 0), (0.03, 0.23, 0.42), m=rot_z(0.42))
    box(cc, (-0.335, 0.61, 0), (0.03, 0.22, 0.42), m=rot_z(-0.3))
    for sz in (0.235, -0.235):
        box(cc, (-0.11, 0.615, sz), (0.44, 0.15, 0.025))
    # Ruedas con llanta.
    for sx in (0.38, -0.38):
        for sz in (0.285, -0.285):
            cyl(wh, (sx, 0.16, sz), 0.16, 0.11, seg=10, axis='z')
            cyl(rim, (sx, 0.16, sz), 0.085, 0.13, seg=8, axis='z')
            cyl(rim, (sx, 0.16, sz), 0.03, 0.15, seg=6, axis='z')
    # Parachoques, rejilla, retrovisores y matrículas.
    box(tp, (0.552, 0.3, 0), (0.05, 0.13, 0.55))
    box(tp, (-0.552, 0.32, 0), (0.05, 0.13, 0.53))
    box(tp, (0.555, 0.44, 0), (0.04, 0.07, 0.3))
    box(tp, (-0.556, 0.44, 0), (0.04, 0.06, 0.22))
    for sz in (0.29, -0.29):
        box(tp, (0.06, 0.63, sz), (0.09, 0.05, 0.06))
        box(tp, (-0.1, 0.47, sz), (0.16, 0.03, 0.02))
    # Faros y pilotos.
    for sz in (0.2, -0.2):
        box(lf, (0.562, 0.46, sz), (0.035, 0.06, 0.12))
        box(lr, (-0.562, 0.475, sz), (0.035, 0.055, 0.11))
    return m


# --- Barca (proa hacia +X) ------------------------------------------------


def boat():
    m = Model()
    m.mat('hull', (0.9, 0.9, 0.92), rough=0.5)
    m.mat('bcab', (0.5, 0.57, 0.64), rough=0.7)
    m.mat('bwin', (0.13, 0.18, 0.26), rough=0.25)
    m.mat('btrim', (0.55, 0.32, 0.16), rough=0.8)
    bt = m.part('bt', 'hull')
    bc = m.part('bc', 'bcab')
    bw = m.part('bwin', 'bwin')
    tp = m.part('trim', 'btrim')

    # Casco por secciones: se estrecha en proa y en popa.
    secs = [(-0.85, 0.42, 0.12), (-0.6, 0.56, 0.06), (-0.15, 0.64, 0.02),
            (0.3, 0.58, 0.04), (0.62, 0.4, 0.09), (0.85, 0.1, 0.16)]
    for i in range(len(secs) - 1):
        x0, w0, y0 = secs[i]
        x1, w1, y1 = secs[i + 1]
        deck = 0.35
        a = [(x0, y0, -w0 / 2), (x0, y0, w0 / 2), (x0, deck, w0 / 2), (x0, deck, -w0 / 2)]
        b = [(x1, y1, -w1 / 2), (x1, y1, w1 / 2), (x1, deck, w1 / 2), (x1, deck, -w1 / 2)]
        inside = ((x0 + x1) / 2, (y0 + y1) / 2 + 0.1, 0)
        quad(bt, a[1], b[1], b[2], a[2], inside=inside)   # costado +z
        quad(bt, a[0], b[0], b[3], a[3], inside=inside)   # costado -z
        quad(bt, a[0], b[0], b[1], a[1], inside=inside)   # pantoque
        quad(bt, a[3], b[3], b[2], a[2], inside=(0, 0, 0))  # cubierta
    box(bt, (-0.85, 0.235, 0), (0.03, 0.24, 0.42))
    # Bañera hundida en la cubierta, cabina y ventanas.
    box(bt, (0.12, 0.33, 0), (0.44, 0.06, 0.42))
    frustum(bc, 0.35, 0.6, (0.58, 0.42), (0.5, 0.36), c0=(-0.3, 0), cap_top=False)
    box(bc, (-0.3, 0.62, 0), (0.56, 0.045, 0.42))
    for sz in (0.19, -0.19):
        box(bw, (-0.3, 0.5, sz), (0.34, 0.12, 0.02))
    box(bw, (-0.035, 0.5, 0), (0.02, 0.13, 0.28))
    # Regala: sigue el perfil del casco en vez de salirse por la proa.
    for i in range(len(secs) - 1):
        x0, w0, _ = secs[i]
        x1, w1, _ = secs[i + 1]
        for sd in (1, -1):
            mid = ((x0 + x1) / 2, 0.35, 0.0)
            d0 = (x0, 0.31, sd * (w0 / 2 + 0.015))
            d1 = (x1, 0.31, sd * (w1 / 2 + 0.015))
            o0 = (x0, 0.4, sd * (w0 / 2 + 0.03))
            o1 = (x1, 0.4, sd * (w1 / 2 + 0.03))
            n0 = (x0, 0.4, sd * (w0 / 2 - 0.035))
            n1 = (x1, 0.4, sd * (w1 / 2 - 0.035))
            quad(tp, d0, d1, o1, o0, inside=mid)
            quad(tp, o0, o1, n1, n0, inside=(mid[0], 0.0, 0.0))
    # Bita de proa, mástil con antena y motor fuera borda.
    box(tp, (0.66, 0.42, 0), (0.1, 0.05, 0.16))
    cyl(bc, (-0.15, 0.73, 0), 0.016, 0.24, seg=6)
    box(bc, (-0.15, 0.84, 0), (0.16, 0.02, 0.02))
    box(tp, (-0.88, 0.28, 0), (0.08, 0.2, 0.16))
    return m


# --- Personaje -------------------------------------------------------------


def player():
    m = Model()
    skin = (0.87, 0.66, 0.5)
    shirt = (0.72, 0.18, 0.16)
    pants = (0.16, 0.2, 0.35)
    m.mat('M_body.001', shirt, rough=0.7)
    m.mat('M_head.001', skin, rough=0.6)
    m.mat('M_armL.001', skin, rough=0.6)
    m.mat('M_armR.001', skin, rough=0.6)
    m.mat('M_legL.001', pants, rough=0.75)
    m.mat('M_legR.001', pants, rough=0.75)
    m.mat('M_hair', (0.16, 0.11, 0.08), rough=0.85)
    m.mat('M_shoe', (0.12, 0.1, 0.1), rough=0.8)

    # Torso: el juego lo recolorea por peatón, así que todo lo que deba
    # cambiar de color (incluidas las mangas) va en esta pieza.
    body = m.part('body', 'M_body.001', translation=(0, 0.5, 0))
    frustum(body, -0.16, -0.05, (0.2, 0.115), (0.215, 0.125), cap_bottom=True, cap_top=False)
    frustum(body, -0.05, 0.09, (0.215, 0.125), (0.245, 0.135), cap_top=False)
    frustum(body, 0.09, 0.15, (0.245, 0.135), (0.2, 0.115), cap_top=True)
    for sx in (0.148, -0.148):
        frustum(body, 0.055, 0.13, (0.1, 0.11), (0.085, 0.095), c0=(sx, 0), cap_bottom=True)
    box(body, (0, 0.165, 0), (0.13, 0.035, 0.1))
    box(body, (0, -0.045, 0), (0.222, 0.025, 0.132))

    head = m.part('head', 'M_head.001', translation=(0, 0.72, 0))
    frustum(head, -0.075, -0.13, (0.075, 0.07), (0.08, 0.075), cap_bottom=True, cap_top=False)
    frustum(head, -0.085, 0.045, (0.15, 0.145), (0.16, 0.155), cap_bottom=True, cap_top=False)
    frustum(head, 0.045, 0.088, (0.16, 0.155), (0.105, 0.1), cap_top=True)
    box(head, (0, -0.012, 0.086), (0.035, 0.032, 0.03))
    for sx in (0.082, -0.082):
        box(head, (sx, -0.005, -0.005), (0.02, 0.045, 0.035))

    hair = m.part('hair', 'M_hair', translation=(0, 0.72, 0))
    frustum(hair, 0.02, 0.096, (0.168, 0.163), (0.11, 0.105), cap_top=True, cap_bottom=False)
    box(hair, (0, 0.005, -0.072), (0.15, 0.085, 0.03))
    for sx in (0.077, -0.077):
        box(hair, (sx, 0.005, 0.0), (0.025, 0.055, 0.11))

    for side, name, mat in ((-1, 'armL', 'M_armL.001'), (1, 'armR', 'M_armR.001')):
        arm = m.part(name, mat, translation=(0.15 * side, 0.61, 0))
        frustum(arm, -0.015, -0.15, (0.075, 0.085), (0.062, 0.07), cap_top=True)
        frustum(arm, -0.15, -0.255, (0.062, 0.07), (0.052, 0.058), cap_top=False)
        frustum(arm, -0.255, -0.305, (0.058, 0.062), (0.045, 0.05), cap_top=False, cap_bottom=True)

    for side, name, mat, sname in ((-1, 'legL', 'M_legL.001', 'shoeL'), (1, 'legR', 'M_legR.001', 'shoeR')):
        leg = m.part(name, mat, translation=(0.07 * side, 0.35, 0))
        frustum(leg, 0.01, -0.17, (0.095, 0.105), (0.085, 0.095), cap_top=True)
        frustum(leg, -0.17, -0.31, (0.085, 0.095), (0.072, 0.08), cap_top=False)
        # El zapato cuelga del nodo de la pierna: gira con ella al andar.
        shoe = m.part(sname, 'M_shoe', parent=leg)
        frustum(shoe, -0.355, -0.305, (0.09, 0.135), (0.082, 0.115), c0=(0, 0.022), cap_bottom=True)
        box(shoe, (0, -0.325, 0.075), (0.075, 0.04, 0.05))
    return m


# --- Edificios -------------------------------------------------------------

FLOOR_H = 0.9
SHAPES = [(2, 2, 4), (3, 2, 3), (3, 3, 3), (4, 3, 2)]

# Un color de fachada por (estilo, forma); el material sigue llamándose
# wall_S_P para no romper nada que lo busque por nombre.
PALETTE = [
    [(0.62, 0.34, 0.26), (0.54, 0.29, 0.23), (0.7, 0.43, 0.3), (0.5, 0.31, 0.27)],
    [(0.70, 0.75, 0.79), (0.55, 0.61, 0.67), (0.80, 0.82, 0.83), (0.45, 0.54, 0.62)],
    [(0.90, 0.83, 0.67), (0.82, 0.72, 0.56), (0.75, 0.79, 0.71), (0.86, 0.76, 0.70)],
]
TRIM_COL = [(0.87, 0.84, 0.77), (0.44, 0.47, 0.51), (0.94, 0.92, 0.87)]
ROOF_COL = [(0.46, 0.25, 0.19), (0.26, 0.27, 0.3), (0.3, 0.31, 0.34)]
AWN_COL = [(0.72, 0.24, 0.2), (0.2, 0.45, 0.55), (0.3, 0.5, 0.32), (0.76, 0.6, 0.22)]


def face_ref(key, hx, hz):
    """Devuelve (put, ancho) para colocar piezas pegadas a una fachada.

    put(pieza, u, y, ancho, alto, fondo, inset): u recorre la fachada y el
    fondo se mide desde el paramento hacia fuera (inset negativo la separa).
    """
    if key == '+x':
        surf, sgn, ax, span = hx, 1, 'x', 2 * hz
    elif key == '-x':
        surf, sgn, ax, span = -hx, -1, 'x', 2 * hz
    elif key == '+z':
        surf, sgn, ax, span = hz, 1, 'z', 2 * hx
    else:
        surf, sgn, ax, span = -hz, -1, 'z', 2 * hx

    def put(part, u, y, w, h, dep, inset=0.0):
        c = surf + sgn * (dep / 2.0 - inset)
        if ax == 'x':
            box(part, (c, y, u), (dep, h, w), skip=('-x' if sgn > 0 else '+x',))
        else:
            box(part, (u, y, c), (w, h, dep), skip=('-z' if sgn > 0 else '+z',))

    return put, span


def awning(part, key, hx, hz, u, y, w, dep=0.44, tilt=0.34):
    """Toldo inclinado hacia fuera, con dos costados."""
    if key == '+z':
        mm = mul(rot_x(tilt), trans(0, 0, dep / 2))
        box(part, (u, y, hz), (w, 0.05, dep), m=mm)
        for sx in (w / 2 - 0.02, -w / 2 + 0.02):
            box(part, (u, y, hz), (0.03, 0.06, dep), m=mul(mm, trans(sx, -0.04, 0)))
    else:
        mm = mul(rot_z(-tilt), trans(dep / 2, 0, 0))
        box(part, (hx, y, u), (dep, 0.05, w), m=mm)
        for sz in (w / 2 - 0.02, -w / 2 + 0.02):
            box(part, (hx, y, u), (dep, 0.06, 0.03), m=mul(mm, trans(0, -0.04, sz)))


def building(si, pi):
    w, d, floors = SHAPES[si]
    hx, hz = w / 2.0 - 0.06, d / 2.0 - 0.06
    H = floors * FLOOR_H
    rng = random.Random(si * 131 + pi * 17 + 3)
    m = Model()
    wname = 'wall_%d_%d' % (si, pi)
    m.mat(wname, PALETTE[pi][si], rough=0.92)
    m.mat('trimm', TRIM_COL[pi], rough=0.85)
    m.mat('win', (0.11, 0.16, 0.24) if pi != 1 else (0.12, 0.2, 0.29), rough=0.25, metal=0.2)
    m.mat('blindm', (0.85, 0.82, 0.74) if pi != 1 else (0.5, 0.53, 0.56), rough=0.9)
    m.mat('roofm', ROOF_COL[pi], rough=0.9)
    m.mat('propm', (0.6, 0.6, 0.62), rough=0.8, metal=0.2)
    m.mat('doorm', (0.34, 0.2, 0.12) if pi != 1 else (0.16, 0.18, 0.2), rough=0.7)
    m.mat('shopg', (0.14, 0.22, 0.26), rough=0.2, metal=0.2)
    m.mat('awnm', AWN_COL[si], rough=0.9)
    m.mat('railm', (0.68, 0.7, 0.72), rough=0.45, metal=0.5)
    m.mat('porchm', (1.0, 0.9, 0.62), rough=0.3, emissive=(0.45, 0.36, 0.15))

    W = m.part('w', wname)
    TR = m.part('trim', 'trimm')
    WIN = m.part('win', 'win')
    BL = m.part('blind', 'blindm')
    RF = m.part('rf', 'roofm')
    AC = m.part('ac', 'propm')
    DR = m.part('door', 'doorm')
    SH = m.part('shop', 'shopg')
    AW = m.part('awn', 'awnm')
    RA = m.part('rail', 'railm')
    PO = m.part('porch', 'porchm')

    brick, office, resi = pi == 0, pi == 1, pi == 2
    shops = office or resi

    # Cuerpo, zócalo, esquinas y cornisa.
    box(W, (0, H / 2, 0), (2 * hx, H, 2 * hz), skip=('-y',))
    if brick or resi:
        box(TR, (0, 0.1, 0), (2 * hx + 0.1, 0.2, 2 * hz + 0.1), skip=('-y',))
    if brick:
        for f in range(1, floors):
            box(TR, (0, f * FLOOR_H, 0), (2 * hx + 0.07, 0.07, 2 * hz + 0.07))
        for sx in (hx, -hx):
            for sz in (hz, -hz):
                box(TR, (sx, (H - 0.1) / 2 + 0.05, sz), (0.2, H - 0.2, 0.2))
        box(TR, (0, H - 0.16, 0), (2 * hx + 0.14, 0.1, 2 * hz + 0.14))
        box(TR, (0, H - 0.055, 0), (2 * hx + 0.24, 0.11, 2 * hz + 0.24))
    elif office:
        box(TR, (0, H - 0.07, 0), (2 * hx + 0.06, 0.14, 2 * hz + 0.06))
    else:
        box(TR, (0, H - 0.1, 0), (2 * hx + 0.16, 0.16, 2 * hz + 0.16))

    for key in ('+x', '-x', '+z', '-z'):
        put, span = face_ref(key, hx, hz)
        front = key in ('+x', '+z')
        cols = max(1, int(round((span - 0.25) / 0.82)))
        step = span / cols
        skip_ground = shops and front

        for f in range(floors):
            y0 = f * FLOOR_H
            if f == 0 and skip_ground:
                continue
            cy = y0 + 0.48
            if office:
                bw = span - 0.34
                put(TR, 0, cy + 0.31, bw + 0.12, 0.11, 0.1)
                put(TR, 0, cy - 0.31, bw + 0.12, 0.11, 0.1)
                put(WIN, 0, cy, bw, 0.5, 0.05)
                for c in range(cols + 1):
                    u = max(-bw / 2 + 0.04, min(bw / 2 - 0.04, -span / 2 + step * c))
                    put(TR, u, cy, 0.08, 0.5, 0.08)
                continue
            ww = min(0.5, step * 0.54)
            wh = 0.5
            for c in range(cols):
                u = -span / 2 + step * (c + 0.5)
                put(TR, u - ww / 2 - 0.04, cy, 0.08, wh + 0.07, 0.06)
                put(TR, u + ww / 2 + 0.04, cy, 0.08, wh + 0.07, 0.06)
                put(TR, u, cy + wh / 2 + 0.05, ww + 0.16, 0.07, 0.075)
                put(TR, u, cy - wh / 2 - 0.055, ww + 0.22, 0.08, 0.12)
                put(WIN, u, cy, ww, wh, 0.03)
                put(TR, u, cy, 0.05, wh, 0.045)
                if rng.random() < (0.3 if brick else 0.42):
                    put(BL, u, cy + wh * 0.24, ww - 0.05, wh * 0.46, 0.04)

        # Balcones (residencial) y escaparates con toldo en las fachadas vistas.
        if resi and front:
            bw = min(span * 0.64, 1.5)
            nb = max(3, int(bw / 0.17))
            for f in range(1, floors):
                y0 = f * FLOOR_H
                put(TR, 0, y0 + 0.05, bw + 0.1, 0.08, 0.32)
                put(RA, 0, y0 + 0.41, bw + 0.08, 0.05, 0.09, inset=-0.25)
                put(RA, 0, y0 + 0.13, bw, 0.04, 0.05, inset=-0.27)
                for i in range(nb + 1):
                    put(RA, -bw / 2 + bw * i / nb, y0 + 0.27, 0.035, 0.3, 0.035, inset=-0.285)
                for sd in (1, -1):
                    put(RA, sd * bw / 2, y0 + 0.41, 0.05, 0.05, 0.32)
                    put(RA, sd * bw / 2, y0 + 0.27, 0.045, 0.3, 0.045, inset=-0.285)

        if not front:
            continue

        # Planta baja: portal en +z y escaparate con el resto del hueco.
        door_u = 0.0
        if key == '+z':
            door_u = -span / 2 + 0.52 if shops else 0.0
            put(TR, door_u, 0.05, 0.9, 0.1, 0.26)
            put(TR, door_u, 0.14, 0.78, 0.09, 0.16)
            put(TR, door_u, 0.56, 0.8, 1.0, 0.07)
            put(DR, door_u, 0.56, 0.58, 0.86, 0.1)
            put(TR, door_u, 0.56, 0.05, 0.86, 0.11)
            put(TR, door_u, 1.1, 0.98, 0.08, 0.3)
            for s in (1, -1):
                put(PO, door_u + s * 0.45, 0.82, 0.09, 0.16, 0.09)
        if shops:
            if key == '+z':
                x0 = door_u + 0.5
                x1 = span / 2 - 0.16
            else:
                x0 = -span / 2 + 0.16
                x1 = span / 2 - 0.16
            sw = x1 - x0
            if sw > 0.75:
                su = (x0 + x1) / 2
                put(TR, su, 0.13, sw + 0.08, 0.18, 0.08)
                put(SH, su, 0.52, sw, 0.6, 0.05)
                put(TR, su, 0.87, sw + 0.14, 0.14, 0.11)
                n = max(1, int(sw / 0.7))
                for c in range(1, n):
                    put(TR, x0 + sw * c / n, 0.52, 0.06, 0.6, 0.07)
                awning(AW, key, hx, hz, su, 0.97, sw - 0.04)

    # Cubierta: forjado y, según estilo, tejado a dos aguas o peto.
    over = 0.06
    box(RF, (0, H + 0.03, 0), (2 * (hx + over), 0.06, 2 * (hz + over)), skip=('-y',))
    if brick:
        along = 'x' if w >= d else 'z'
        gable(RF, (0, H + 0.06, 0), (2 * (hx + 0.08), 2 * (hz + 0.08)), 0.34 + 0.05 * floors, along=along)
        cx = (hx - 0.3) * (1 if si % 2 == 0 else -1)
        cz = (hz - 0.28) * (1 if si < 2 else -1)
        box(TR, (cx, H + 0.34, cz), (0.24, 0.68, 0.24))
        box(TR, (cx, H + 0.71, cz), (0.32, 0.07, 0.32))
        cyl(AC, (cx * -0.5, H + 0.55, cz * -0.4), 0.02, 0.5, seg=5)
        for yy in (0.68, 0.76):
            box(AC, (cx * -0.5, H + yy, cz * -0.4), (0.02, 0.02, 0.3))
    else:
        t = 0.1
        ph = 0.26
        for sx in (hx + over - t / 2, -(hx + over - t / 2)):
            box(RF, (sx, H + 0.06 + ph / 2, 0), (t, ph, 2 * (hz + over)))
            box(TR, (sx, H + 0.06 + ph + 0.02, 0), (t + 0.05, 0.05, 2 * (hz + over) + 0.05))
        for sz in (hz + over - t / 2, -(hz + over - t / 2)):
            box(RF, (0, H + 0.06 + ph / 2, sz), (2 * (hx + over) - 2 * t, ph, t))
            box(TR, (0, H + 0.06 + ph + 0.02, sz), (2 * (hx + over) - 2 * t, 0.05, t + 0.05))

        # Trastos de cubierta: depósito, climatizadores, salidas y antena.
        spots = []
        gx = max(1, int(2 * hx / 0.75))
        gz = max(1, int(2 * hz / 0.75))
        for i in range(gx):
            for j in range(gz):
                spots.append(((i + 0.5) / gx * 2 * hx - hx, (j + 0.5) / gz * 2 * hz - hz))
        rng.shuffle(spots)
        y = H + 0.06

        sx, sz = spots.pop()
        for dx in (0.14, -0.14):
            for dz in (0.12, -0.12):
                box(AC, (sx + dx, y + 0.07, sz + dz), (0.05, 0.14, 0.05))
        cyl(AC, (sx, y + 0.31, sz), 0.21, 0.34, seg=10)
        box(AC, (sx, y + 0.5, sz), (0.36, 0.04, 0.36))

        for _ in range(2 if len(spots) > 2 else 1):
            if not spots:
                break
            sx, sz = spots.pop()
            box(AC, (sx, y + 0.11, sz), (0.36, 0.22, 0.3))
            box(AC, (sx, y + 0.23, sz), (0.3, 0.03, 0.24))
            for dz in (0.08, -0.08):
                box(AC, (sx + 0.185, y + 0.12, sz + dz), (0.02, 0.14, 0.05))

        if spots and w * d >= 9:
            sx, sz = spots.pop()
            box(AC, (sx, y + 0.24, sz), (0.5, 0.48, 0.44))
            box(TR, (sx, y + 0.5, sz), (0.56, 0.05, 0.5))
        if spots:
            sx, sz = spots.pop()
            for dx, r, h in ((0.0, 0.06, 0.3), (0.16, 0.045, 0.2)):
                cyl(AC, (sx + dx, y + h / 2, sz), r, h, seg=6)
                cyl(AC, (sx + dx, y + h + 0.02, sz), r + 0.02, 0.05, seg=6)
        if spots:
            sx, sz = spots.pop()
            cyl(AC, (sx, y + 0.3, sz), 0.022, 0.6, seg=5)
            for yy, ln in ((0.42, 0.32), (0.5, 0.24), (0.57, 0.16)):
                box(AC, (sx, y + yy, sz), (0.02, 0.02, ln))
            # Parabólica: pie corto y plato inclinado hacia la cámara.
            cyl(AC, (sx + 0.24, y + 0.09, sz + 0.02), 0.03, 0.18, seg=6)
            cone(AC, (sx + 0.24, y + 0.19, sz + 0.02), 0.15, 0.13, seg=9,
                 m=mul(rot_y(0.7), rot_x(2.1)))
    return m


# --- Programa --------------------------------------------------------------


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
    out = os.path.normpath(out)
    os.makedirs(out, exist_ok=True)
    jobs = [('tree_round', tree_round), ('tree_cone', tree_cone), ('lamp', lamp),
            ('car', car), ('boat', boat), ('player', player)]
    for si in range(len(SHAPES)):
        for pi in range(3):
            jobs.append(('bld_%d_%d' % (si, pi), lambda s=si, p=pi: building(s, p)))
    total = 0
    for name, fn in jobs:
        path = os.path.join(out, name + '.glb')
        size, verts, parts = write_glb(path, mirror_x(fn()))
        total += size
        print('%-12s %7d B  %5d vértices  %2d piezas' % (name, size, verts, parts))
    print('total %.1f KB' % (total / 1024.0))


if __name__ == '__main__':
    main()
