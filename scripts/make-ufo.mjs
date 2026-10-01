// Genera public/models/ufo.glb: platillo volante low-poly con sombreado suave (glTF: +Y arriba).
// Se mantiene ligero a propósito (~2.000 triángulos) para no penalizar el rendimiento.
import { writeFileSync } from 'node:fs';

const SEGMENTS = 40;

/**
 * Superficie de revolución con normales suaves a partir de un perfil [radio, altura]
 * ordenado de arriba abajo (de dentro hacia fuera). Devuelve una malla indexada.
 */
function lathe(profile) {
  // Normal 2D de cada tramo del perfil (hacia fuera) y normal suavizada en cada punto.
  const seg = [];
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    seg.push([-dy / l, dr / l]);
  }
  const pointNormal = profile.map((_, j) => {
    const a = seg[Math.max(0, j - 1)], b = seg[Math.min(seg.length - 1, j)];
    const n = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l];
  });

  const positions = [], normals = [], indices = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
    profile.forEach(([r, y], j) => {
      const [nr, ny] = pointNormal[j];
      positions.push(r * cos, y, r * sin);
      normals.push(nr * cos, ny, nr * sin);
    });
  }
  const P = profile.length;
  for (let i = 0; i < SEGMENTS; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = (i + 1) * P + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}

/** Luz del borde: pequeña esfera low-poly. */
function bulb(cx, cy, cz, radius) {
  const positions = [], normals = [], indices = [];
  const LAT = 5, LON = 8;
  for (let i = 0; i <= LAT; i++) {
    const t = (i / LAT) * Math.PI;
    for (let j = 0; j <= LON; j++) {
      const p = (j / LON) * Math.PI * 2;
      const n = [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
      positions.push(cx + n[0] * radius, cy + n[1] * radius, cz + n[2] * radius);
      normals.push(...n);
    }
  }
  for (let i = 0; i < LAT; i++) {
    for (let j = 0; j < LON; j++) {
      const a = i * (LON + 1) + j, b = a + LON + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}

function merge(meshes) {
  const out = { positions: [], normals: [], indices: [] };
  for (const m of meshes) {
    const base = out.positions.length / 3;
    out.positions.push(...m.positions);
    out.normals.push(...m.normals);
    out.indices.push(...m.indices.map((k) => k + base));
  }
  return out;
}

// Casco: parte superior e inferior por separado para que el borde quede marcado (arista viva).
const hullTop = lathe([[0, 0.42], [0.9, 0.4], [1.7, 0.3], [2.4, 0.15], [3.0, 0.02]]);
const hullBottom = lathe([[3.0, 0.02], [2.85, -0.12], [2.3, -0.3], [1.5, -0.45], [1.05, -0.5]]);
const dome = lathe(Array.from({ length: 10 }, (_, k) => {
  const t = (k / 9) * (Math.PI / 2);
  return [Math.max(0.0001, 1.2 * Math.sin(t)), 0.36 + 1.05 * Math.cos(t)];
}));
const engine = lathe([[1.05, -0.5], [1.0, -0.62], [0.6, -0.68], [0.0001, -0.7]]);

// Luces del borde en tres colores alternos: al girar el ovni se nota el movimiento.
const LIGHTS = 12;
const lights = [[], [], []];
for (let i = 0; i < LIGHTS; i++) {
  const a = (i / LIGHTS) * Math.PI * 2;
  lights[i % 3].push(bulb(2.78 * Math.cos(a), 0.06, 2.78 * Math.sin(a), 0.16));
}

const pbr = (color, metallic, roughness) => ({ baseColorFactor: color, metallicFactor: metallic, roughnessFactor: roughness });
const parts = [
  { mesh: merge([hullTop, hullBottom]), material: { name: 'casco', pbrMetallicRoughness: pbr([0.82, 0.85, 0.9, 1], 0.55, 0.3) } },
  { mesh: dome, material: { name: 'cupula', alphaMode: 'BLEND', pbrMetallicRoughness: pbr([0.55, 0.9, 1, 0.55], 0, 0.08) } },
  { mesh: engine, material: { name: 'motor', emissiveFactor: [0.35, 1, 0.85], pbrMetallicRoughness: pbr([0.35, 1, 0.85, 1], 0, 0.4) } },
  { mesh: merge(lights[0]), material: { name: 'luz-ambar', emissiveFactor: [1, 0.72, 0.2], pbrMetallicRoughness: pbr([1, 0.75, 0.25, 1], 0, 0.4) } },
  { mesh: merge(lights[1]), material: { name: 'luz-cian', emissiveFactor: [0.25, 0.9, 1], pbrMetallicRoughness: pbr([0.3, 0.9, 1, 1], 0, 0.4) } },
  { mesh: merge(lights[2]), material: { name: 'luz-coral', emissiveFactor: [1, 0.35, 0.3], pbrMetallicRoughness: pbr([1, 0.4, 0.35, 1], 0, 0.4) } },
];

// ---------- Escritura GLB ----------
const gltf = {
  asset: { version: '2.0', generator: 'FlyFly' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [] }], materials: [], buffers: [], bufferViews: [], accessors: [],
};
const chunks = [];
let offset = 0;
const addView = (typed, target) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  chunks.push(padded);
  gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
  offset += padded.length;
  return gltf.bufferViews.length - 1;
};

let triangles = 0;
for (const { mesh, material } of parts) {
  const pos = new Float32Array(mesh.positions);
  const min = [0, 1, 2].map((i) => Math.min(...mesh.positions.filter((_, j) => j % 3 === i)));
  const max = [0, 1, 2].map((i) => Math.max(...mesh.positions.filter((_, j) => j % 3 === i)));
  gltf.accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
  gltf.accessors.push({ bufferView: addView(new Float32Array(mesh.normals), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3' });
  gltf.accessors.push({ bufferView: addView(new Uint16Array(mesh.indices), 34963), componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
  gltf.materials.push({ ...material, doubleSided: true });
  const n = gltf.accessors.length;
  gltf.meshes[0].primitives.push({ attributes: { POSITION: n - 3, NORMAL: n - 2 }, indices: n - 1, material: gltf.materials.length - 1 });
  triangles += mesh.indices.length / 3;
}

const bin = Buffer.concat(chunks);
gltf.buffers.push({ byteLength: bin.length });
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
const chunk = (buf, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(buf.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, buf]); };
writeFileSync(new URL('../public/models/ufo.glb', import.meta.url), Buffer.concat([header, chunk(jsonPadded, 0x4e4f534a), chunk(bin, 0x004e4942)]));
console.log(`ufo.glb: ${triangles} triángulos, ${(bin.length / 1024).toFixed(0)} KB`);
