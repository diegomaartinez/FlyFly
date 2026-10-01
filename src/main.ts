import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { Controls, Craft } from './flight';
import { bearing, distance, fetchSummary, loadCityPois, Poi, PoiLayer } from './pois';
import { createWorld, geocode, GeoResult, groundHeight, World } from './world';
import { EngineSound } from './sound';
import { defined, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const world = await createWorld($('world'));
const { viewer } = world;
const ufo = new Craft(viewer);
const pois = new PoiLayer(viewer);
const sound = new EngineSound();
await ufo.load('models/ufo.glb');

$('mode-note').textContent = world.error
  ? `No se pudo cargar la ciudad en 3D (${world.error}). Revisa el token de Cesium ion. Mostrando ortofoto plana.`
  : world.mode === 'free'
    ? 'Modo plano (ortofoto). Añade un token de Cesium ion para ver la ciudad en 3D.'
    : '';

// ---------- Búsqueda de ciudad ----------
let flying = false;
let paused = true;
const LAST_CITY_KEY = 'flyfly:lastCity';

const searchInput = $<HTMLInputElement>('search-input');
searchInput.disabled = $<HTMLButtonElement>('search-btn').disabled = false;
$('search-status').textContent = '';
try { searchInput.value = localStorage.getItem(LAST_CITY_KEY) ?? ''; } catch { /* sin almacenamiento */ }
searchInput.focus();

function openSearch() {
  $('intro').hidden = false;
  $('intro-close').hidden = !flying;
  $('results').innerHTML = '';
  paused = true;
  searchInput.select();
  searchInput.focus();
}
$('city-btn').onclick = openSearch;
$('intro-close').onclick = () => { $('intro').hidden = true; paused = false; };

$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  const status = $('search-status');
  const list = $('results');
  list.innerHTML = '';
  status.textContent = 'Buscando…';
  let hits: GeoResult[] = [];
  try {
    hits = await geocode(world, query);
  } catch {
    status.textContent = 'La búsqueda no está disponible ahora mismo. Inténtalo de nuevo.';
    return;
  }
  status.textContent = hits.length ? '' : 'No encontré ese lugar. Prueba con otro nombre.';
  if (hits.length === 1) return startFlight(hits[0]);
  for (const hit of hits) {
    const li = document.createElement('li');
    li.innerHTML = `<b></b><small></small>`;
    li.querySelector('b')!.textContent = hit.name;
    li.querySelector('small')!.textContent = hit.detail;
    li.onclick = () => startFlight(hit);
    list.append(li);
  }
});

async function startFlight(place: GeoResult) {
  try { localStorage.setItem(LAST_CITY_KEY, place.name); } catch { /* sin almacenamiento */ }
  sound.start();
  $('intro').hidden = true;
  await flyTo(place);
  flying = true;
  paused = false;
  document.body.classList.add('flying');
  banner(place.name, 'city');
  if (!pois.pois.size) setTimeout(() => banner('No se encontraron lugares aquí. Prueba con otra ciudad.', 'info'), 2200);
}

// ---------- Pantalla de carga ----------
function step(name: string, state: 'active' | 'done' | 'fail') {
  const li = document.querySelector<HTMLElement>(`#loading-steps [data-step="${name}"]`)!;
  li.className = state;
}

function setProgress(fraction: number) {
  $('loading-progress').style.width = `${Math.round(fraction * 100)}%`;
}

/** Espera a que carguen las teselas visibles mostrando el avance (máximo 20 s). */
function loadTiles(w: World): Promise<void> {
  return new Promise((resolve) => {
    let maxPending = 1;
    const update = (pending: number, processing: number) => {
      const left = pending + processing;
      maxPending = Math.max(maxPending, left);
      const f = 1 - left / maxPending;
      setProgress(0.4 + 0.6 * f);
      $('tiles-progress').textContent = `${Math.round(f * 100)}%`;
    };
    const finish = () => { clearTimeout(timer); removeProgress(); removeDone(); resolve(); };
    const timer = setTimeout(finish, 20000);
    const removeProgress = w.tileset
      ? w.tileset.loadProgress.addEventListener(update)
      : w.viewer.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => update(n, 0));
    const removeDone = w.tileset
      ? w.tileset.allTilesLoaded.addEventListener(finish)
      : w.viewer.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => n === 0 && finish());
  });
}

async function flyTo(place: GeoResult) {
  paused = true;
  closeCard();
  closeMenu();
  pois.clear();
  $('city-name').textContent = $('menu-city').textContent = $('loading-city').textContent = place.name;
  document.querySelectorAll('#loading-steps li').forEach((li) => (li.className = ''));
  $('tiles-progress').textContent = '';
  setProgress(0);
  $('loading').hidden = false;

  // 1. Coloca la cámara sobre la ciudad para que empiecen a cargar sus teselas y mide la altura del suelo.
  step('city', 'active');
  ufo.teleport(place.lat, place.lng);
  ufo.render(0);
  const ground = await groundHeight(world, place.lat, place.lng);
  ufo.teleport(place.lat, place.lng, ground);
  ufo.render(0);
  step('city', 'done');
  setProgress(0.15);

  // 2. Lugares de interés (Wikipedia) mientras siguen cargando las teselas.
  step('places', 'active');
  try {
    pois.add(await loadCityPois(place.lat, place.lng));
    step('places', 'done');
  } catch {
    step('places', 'fail');
  }
  setProgress(0.4);

  // 3. Edificios y terreno.
  step('tiles', 'active');
  await loadTiles(world);
  step('tiles', 'done');
  setProgress(1);
  updateHud();
  await new Promise((r) => setTimeout(r, 400));
  $('loading').hidden = true;
}

// ---------- Menú de lugares ----------
function renderMenu() {
  const { discovered, total } = pois.progress();
  const left = total - discovered;
  $('menu-summary').innerHTML = `<b>${discovered}</b> ${discovered === 1 ? 'descubierto' : 'descubiertos'} · <b>${left}</b> por descubrir`;
  $('menu-progress').style.width = total ? `${(discovered / total) * 100}%` : '0';

  const hints = $('menu-hints');
  hints.innerHTML = '';
  for (const { poi, dist } of pois.hints(ufo.lat, ufo.lng)) {
    const rel = bearing(ufo, poi) - (ufo.heading * 180) / Math.PI;
    const li = document.createElement('li');
    li.innerHTML = `<span class="hint-arrow" style="transform: rotate(${rel}deg)">▲</span><b>???</b><small>${dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`}</small>`;
    hints.append(li);
  }

  const list = $('menu-list');
  list.innerHTML = '';
  const found = [...pois.pois.values()].filter((p) => pois.isDiscovered(p));
  $('menu-empty').hidden = found.length > 0;
  for (const poi of found) {
    const li = document.createElement('li');
    li.className = 'found';
    li.innerHTML = `${poi.image ? `<img src="${poi.image}" alt="" />` : '<span class="thumb">✓</span>'}<b></b>`;
    li.querySelector('b')!.textContent = poi.name;
    li.onclick = () => openCard(poi);
    list.append(li);
  }
}

function closeMenu() {
  $('menu').hidden = true;
}
$('menu-btn').onclick = () => {
  $('menu').hidden = !$('menu').hidden;
  if (!$('menu').hidden) renderMenu();
};
$('menu-close').onclick = closeMenu;

// ---------- Ficha del lugar ----------
let openPoi: Poi | undefined;

async function openCard(poi: Poi) {
  openPoi = poi;
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
  sponsor.textContent = '★ Recomendado';
  const cta = $<HTMLAnchorElement>('card-cta');
  cta.hidden = !poi.sponsor?.link;
  if (poi.sponsor?.link) {
    cta.href = poi.sponsor.link;
    cta.textContent = poi.sponsor.cta ?? 'Visitar';
  }
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

// Clic/toque sobre un globo ya visible abre su ficha (si está descubierto).
new ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((e: { position: any }) => {
  const picked = viewer.scene.pick(e.position);
  const poi = defined(picked) && pois.pois.get(picked.id?.id);
  if (poi && pois.isDiscovered(poi)) openCard(poi);
  else if (poi) banner('¡Acércate para descubrirlo!', 'info');
}, ScreenSpaceEventType.LEFT_CLICK);

// ---------- Controles ----------
const keys = new Set<string>();
const stick = { x: 0, y: 0 };
let touchLift = 0;

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (e.code === 'KeyC') ufo.toggleCamera();
  if (e.code === 'KeyM') sound.toggle();
  if (e.code === 'Escape') { closeCard(); closeMenu(); }
  if (e.code === 'Tab') { e.preventDefault(); $('menu-btn').click(); }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const axis = (neg: string[], pos: string[]) =>
  (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

function readControls(): Controls {
  return {
    forward: axis(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']) - stick.y,
    turn: axis(['ArrowLeft'], ['ArrowRight']) + stick.x,
    strafe: axis(['KeyA'], ['KeyD']),
    lift: axis(['ShiftLeft', 'ShiftRight', 'KeyF'], ['Space', 'KeyR']) + touchLift,
  };
}

// Joystick táctil: arriba/abajo avanza o retrocede, a los lados gira.
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
document.querySelectorAll<HTMLButtonElement>('[data-lift]').forEach((b) => {
  b.onpointerdown = () => (touchLift = Number(b.dataset.lift));
  b.onpointerup = b.onpointerleave = () => (touchLift = 0);
});
$('cam-btn').onclick = () => ufo.toggleCamera();

// Cámara: arrastrar (ratón o un dedo) gira 360°, rueda o pellizco acerca/aleja.
const canvas = viewer.scene.canvas;
const pointers = new Map<number, { x: number; y: number }>();
const pinchDistance = () => {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 1) {
    ufo.orbit(e.clientX - prev.x, e.clientY - prev.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  } else if (pointers.size === 2) {
    const before = pinchDistance();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    ufo.zoom(before / Math.max(1, pinchDistance()));
  }
});
const releasePointer = (e: PointerEvent) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  ufo.zoom(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// ---------- HUD ----------
let bannerTimer = 0;
function banner(text: string, kind: 'found' | 'city' | 'info') {
  const b = $('banner');
  b.className = kind;
  b.innerHTML = kind === 'found' ? `<small>¡Descubierto!</small>${text}` : text;
  b.hidden = false;
  // Reinicia la animación de entrada.
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (b.hidden = true), kind === 'found' ? 2600 : 2000);
}

function updateHud() {
  $('altitude').textContent = `${Math.round(ufo.altitude)} m`;
  const { found, target } = pois.update(ufo.lat, ufo.lng);
  if (found) {
    sound.chime();
    banner(found.name, 'found');
    openCard(found);
  }
  const { discovered, total } = pois.progress();
  $('visited').textContent = String(discovered);
  $('total').textContent = String(total);

  // Brújula hacia el lugar más cercano por descubrir, sin revelar su nombre.
  $('nearest').hidden = !target;
  if (target) {
    $('nearest-dist').textContent = target.dist > 1000 ? `${(target.dist / 1000).toFixed(1)} km` : `${Math.round(target.dist)} m`;
    const rel = bearing(ufo, target.poi) - (ufo.heading * 180) / Math.PI;
    $('nearest-arrow').style.transform = `rotate(${rel}deg)`;
  }
  if (openPoi && distance(ufo, openPoi) > 1200) closeCard();
  if (!$('menu').hidden) renderMenu();
}

// ---------- Bucle principal ----------
let last = performance.now();
let slowTimer = 0;

viewer.scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (paused) return;
  ufo.update(dt, readControls());
  ufo.render(dt);
  sound.update(ufo.speed);

  slowTimer += dt;
  if (slowTimer > 0.25) {
    slowTimer = 0;
    ufo.sampleGround();
    updateHud();
  }
});

// Acceso para depuración en desarrollo (no se incluye en la web publicada).
if (import.meta.env.DEV) Object.assign(window, { flyfly: { ufo, pois, startFlight } });
