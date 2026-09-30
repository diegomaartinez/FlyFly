import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { CITIES, City } from './cities';
import { Controls, Plane } from './flight';
import { bearing, distance, fetchSummary, loadCurated, Poi, PoiLayer } from './pois';
import { createWorld, geocode, worldMode } from './world';
import { EngineSound } from './sound';
import { defined, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const OPEN_DISTANCE = 350; // metros: la ficha se abre al pasar cerca del globo
const CLOSE_DISTANCE = 900;

const viewer = await createWorld($('world'));
const plane = new Plane(viewer);
const pois = new PoiLayer(viewer);
const sound = new EngineSound();
await plane.load('models/plane.glb');

$('mode-note').textContent = {
  google: 'Modo fotorrealista 3D (Google Photorealistic 3D Tiles).',
  ion: 'Modo fotorrealista 3D (Google Photorealistic 3D Tiles vía Cesium ion).',
  free: 'Modo gratuito: ortofoto PNOA/Sentinel-2 sin relieve. Añade un token de Cesium ion en .env para ver la ciudad en 3D real.',
}[worldMode];

// ---------- Ciudades y búsqueda ----------
async function flyTo(city: City) {
  pois.clear();
  plane.teleport(city.lat, city.lng, city.heading);
  if (city.places) pois.add(await loadCurated(city.places));
  await pois.explore(city.lat, city.lng);
  closeCard();
  toast(`Rumbo a ${city.name}`);
  document.querySelectorAll('#cities button').forEach((b) => b.classList.toggle('active', b.textContent === city.name));
}

for (const city of CITIES) {
  const b = document.createElement('button');
  b.textContent = city.name;
  b.onclick = () => flyTo(city);
  $('cities').append(b);
}

$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('search-input');
  const query = input.value.trim();
  if (!query) return;
  input.blur();
  try {
    const hit = await geocode(viewer, query);
    if (hit) await flyTo({ id: 'search', name: hit.name, lat: hit.lat, lng: hit.lng, heading: plane.heading * 57.3 });
    else toast('No encontré ese lugar');
  } catch {
    toast('Búsqueda no disponible ahora mismo');
  }
});

// ---------- Ficha del lugar ----------
let openPoi: Poi | undefined;

async function openCard(poi: Poi) {
  openPoi = poi;
  pois.markVisited(poi.id);
  $('card-title').textContent = poi.name;
  $('card-text').textContent = poi.description ?? '';
  const img = $<HTMLImageElement>('card-img');
  img.hidden = !poi.image;
  if (poi.image) img.src = poi.image;
  const link = $<HTMLAnchorElement>('card-link');
  link.hidden = !poi.url && !poi.wikiTitle;
  link.href = poi.url ?? '#';
  const sponsor = $('card-sponsor');
  sponsor.hidden = !poi.sponsor;
  if (poi.sponsor) sponsor.innerHTML = `⭐ Patrocinado${poi.sponsor.link ? ` · <a href="${poi.sponsor.link}" target="_blank" rel="noopener">${poi.sponsor.cta ?? 'Visitar'}</a>` : ''}`;
  $('card').hidden = false;

  if (poi.wikiTitle) {
    const s = await fetchSummary(poi.wikiTitle).catch(() => undefined);
    if (s && openPoi === poi) {
      $('card-text').textContent = s.extract;
      if (s.image) { img.src = s.image; img.hidden = false; }
      link.href = s.url;
    }
  }
}

function closeCard() {
  openPoi = undefined;
  $('card').hidden = true;
}
$('card-close').onclick = closeCard;

// Clic/toque sobre un globo abre su ficha aunque esté lejos.
new ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((e: { position: any }) => {
  const picked = viewer.scene.pick(e.position);
  const poi = defined(picked) && pois.pois.get(picked.id?.id);
  if (poi) openCard(poi);
}, ScreenSpaceEventType.LEFT_CLICK);

// ---------- Controles ----------
const keys = new Set<string>();
const stick = { x: 0, y: 0 };
let touchThrottle = 0;

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (e.code === 'KeyC') plane.toggleCamera();
  if (e.code === 'KeyM') sound.toggle();
  if (e.code === 'Escape') closeCard();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const axis = (neg: string[], pos: string[]) =>
  (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

function readControls(): Controls {
  return {
    pitch: axis(['ArrowDown'], ['ArrowUp']) - stick.y,
    roll: axis(['ArrowLeft'], ['ArrowRight']) + stick.x,
    yaw: axis(['KeyA'], ['KeyD']),
    throttle: axis(['KeyS', 'ControlLeft'], ['KeyW', 'ShiftLeft']) + touchThrottle,
  };
}

// Joystick táctil: la posición del dedo respecto al centro controla alabeo y cabeceo.
const stickEl = $('stick');
const knob = stickEl.firstElementChild as HTMLElement;
stickEl.addEventListener('pointerdown', (e) => stickEl.setPointerCapture(e.pointerId));
stickEl.addEventListener('pointermove', (e) => {
  if (!stickEl.hasPointerCapture(e.pointerId)) return;
  const r = stickEl.getBoundingClientRect();
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  stick.x = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2));
  stick.y = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2));
  knob.style.transform = `translate(${stick.x * 40}px, ${stick.y * 40}px)`;
});
const releaseStick = () => { stick.x = stick.y = 0; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', releaseStick);
stickEl.addEventListener('pointercancel', releaseStick);
document.querySelectorAll<HTMLButtonElement>('[data-throttle]').forEach((b) => {
  b.onpointerdown = () => (touchThrottle = Number(b.dataset.throttle));
  b.onpointerup = b.onpointerleave = () => (touchThrottle = 0);
});
$('cam-btn').onclick = () => plane.toggleCamera();

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 2500);
}

function updateHud() {
  $('hud-speed').textContent = String(Math.round(plane.speed * 1.944));
  $('hud-alt').textContent = String(Math.round(plane.height - plane.ground));
  $('hud-heading').textContent = String(Math.round((plane.heading * 180) / Math.PI) % 360).padStart(3, '0');
  $('hud-throttle').style.height = `${plane.throttle * 100}%`;
  $('visited').textContent = String(pois.visited.size);
  $('total').textContent = String(pois.pois.size);

  const near = pois.nearest(plane.lat, plane.lng);
  $('nearest').hidden = !near;
  if (!near) return;
  $('nearest-name').textContent = near.poi.name;
  $('nearest-dist').textContent = near.dist > 1000 ? `${(near.dist / 1000).toFixed(1)} km` : `${Math.round(near.dist)} m`;
  const rel = bearing(plane, near.poi) - (plane.heading * 180) / Math.PI;
  $('nearest-arrow').style.transform = `rotate(${rel - 90}deg)`;

  if (near.dist < OPEN_DISTANCE && openPoi !== near.poi) openCard(near.poi);
  if (openPoi && distance(plane, openPoi) > CLOSE_DISTANCE) closeCard();
}

// ---------- Bucle principal ----------
let last = performance.now();
let slowTimer = 0;
let started = false;

viewer.scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (started) plane.update(dt, readControls());
  plane.render(dt);
  sound.update(plane.throttle, plane.speed);

  slowTimer += dt;
  if (slowTimer > 0.25) {
    slowTimer = 0;
    plane.sampleGround();
    updateHud();
    pois.explore(plane.lat, plane.lng);
  }
});

await flyTo(CITIES[0]);
const start = $<HTMLButtonElement>('start');
start.disabled = false;
start.textContent = 'Despegar';
start.onclick = () => {
  started = true;
  sound.start();
  $('intro').remove();
};
