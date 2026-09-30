// Genera public/models/paper-plane.glb: un avión de papel low-poly (glTF: +Z adelante, +Y arriba).
import { writeFileSync } from 'node:fs';

const N = [0, 0.05, 2.2]; // morro
const C = [0, 0, -1.8]; // centro de la cola (pliegue)
const K = [0, -0.45, -1.6]; // quilla
const WL = [1.7, 0.3, -2.0]; // punta ala izquierda
const WR = [-1.7, 0.3, -2.0]; // punta ala derecha
const FL = [0.12, 0.02, -1.9]; // pliegue interior izq.
const FR = [-0.12, 0.02, -1.9];

// Cada triángulo con su color: alas blancas, pliegues algo más oscuros, quilla con franja de color.
const tris = [
  [N, FL, WL, [0.98, 0.98, 0.96]],
  [N, WR, FR, [0.98, 0.98, 0.96]],
  [N, C, FL, [0.86, 0.87, 0.9]],
  [N, FR, C, [0.86, 0.87, 0.9]],
  [N, K, C, [1.0, 0.42, 0.33]],
];

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

const pos = [], nor = [], col = [];
for (const [a, b, c, color] of tris) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  for (const v of [a, b, c]) { pos.push(...v); nor.push(...n); col.push(...color, 1); }
}
const count = pos.length / 3;
const bin = Buffer.concat([pos, nor, col].map((a) => Buffer.from(new Float32Array(a).buffer)));
const min = [0, 1, 2].map((i) => Math.min(...pos.filter((_, j) => j % 3 === i)));
const max = [0, 1, 2].map((i) => Math.max(...pos.filter((_, j) => j % 3 === i)));

const gltf = {
  asset: { version: '2.0', generator: 'FlyFly' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, material: 0 }] }],
  materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.95 } }],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: count * 12 },
    { buffer: 0, byteOffset: count * 12, byteLength: count * 12 },
    { buffer: 0, byteOffset: count * 24, byteLength: count * 16 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count, type: 'VEC4' },
  ],
};

const pad = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const data = pad(bin, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + data.length, 8);
const chunk = (buf, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(buf.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, buf]); };
writeFileSync(new URL('../public/models/paper-plane.glb', import.meta.url), Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(data, 0x004e4942)]));
console.log(`paper-plane.glb: ${tris.length} triángulos`);
