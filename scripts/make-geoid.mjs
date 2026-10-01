// Genera public/data/geoid-egm96-1deg.bin: ondulación del geoide EGM96 (altura del nivel medio del mar
// sobre el elipsoide WGS84) en una malla de 1° (181 x 361 valores Int16 en decímetros, ~130 KB).
// La web la interpola para mostrar la altitud sobre el nivel del mar sin cargar el modelo completo (5 MB).
import { mkdirSync, writeFileSync } from 'node:fs';
import { meanSeaLevel } from 'egm96-universal';

const ROWS = 181; // latitud 90 → -90
const COLS = 361; // longitud -180 → 180
const grid = new Int16Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) grid[r * COLS + c] = Math.round(meanSeaLevel(90 - r, c - 180) * 10);
}
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/geoid-egm96-1deg.bin', import.meta.url), Buffer.from(grid.buffer));

// Comprobación de precisión frente al modelo completo.
const at = (lat, lng) => {
  const y = 90 - lat, x = lng + 180;
  const r = Math.min(Math.floor(y), ROWS - 2), c = Math.min(Math.floor(x), COLS - 2);
  const fy = y - r, fx = x - c, g = (rr, cc) => grid[rr * COLS + cc] / 10;
  return (g(r, c) * (1 - fx) + g(r, c + 1) * fx) * (1 - fy) + (g(r + 1, c) * (1 - fx) + g(r + 1, c + 1) * fx) * fy;
};
let max = 0, sum = 0, n = 0;
for (let i = 0; i < 20000; i++) {
  const lat = -80 + Math.random() * 160, lng = -180 + Math.random() * 360;
  const e = Math.abs(at(lat, lng) - meanSeaLevel(lat, lng));
  max = Math.max(max, e); sum += e; n++;
}
const spain = [[43.3713, -8.396, 'A Coruña'], [40.4168, -3.7038, 'Madrid'], [41.3851, 2.1734, 'Barcelona'], [43.263, -2.935, 'Bilbao'], [28.4636, -16.2518, 'Tenerife']];
console.log(`geoide 1°: error medio ${(sum / n).toFixed(2)} m, máximo ${max.toFixed(2)} m`);
for (const [lat, lng, name] of spain) console.log(`  ${name}: N=${meanSeaLevel(lat, lng).toFixed(2)} m, malla=${at(lat, lng).toFixed(2)} m`);
