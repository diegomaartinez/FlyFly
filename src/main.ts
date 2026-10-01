import 'cesium/Build/Cesium/Widgets/widgets.css';
import '@fontsource-variable/outfit';
import './style.css';
import { Controls, Craft } from './flight';
import { geoidHeight, loadGeoid } from './geoid';
import { hydrateIcons, icon, IconName } from './icons';
import { bearing, distance, fetchImageCredit, fetchSummary, formatDistance, loadCityPois, Poi, PoiLayer, wikiUrl } from './pois';
import { createWorld, geocode, GeoResult, groundHeight, initialQuality, Quality, setQuality, World } from './world';
// Sonido desactivado (para reactivarlo, descomenta las líneas marcadas con "Sonido").
// import { EngineSound } from './sound'; // Sonido

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
hydrateIcons();

const [world] = await Promise.all([createWorld($('world')), loadGeoid()]);
const { viewer } = world;
const ufo = new Craft(viewer);
const pois = new PoiLayer(viewer, $('markers'));
// const sound = new EngineSound(); // Sonido
await ufo.load('models/ufo.glb');
let quality: Quality = initialQuality();
setQuality(world, quality);

$('mode-note').textContent = world.error
  ? `No se pudo cargar la ciudad en 3D (${world.error}). Revisa el token de Cesium ion. Se muestra la ortofoto plana.`
  : world.mode === 'free'
    ? 'Modo plano (ortofoto). Añade un token de Cesium ion para ver las ciudades en 3D.'
    : '';

let flying = false;
let paused = true;
const timeout = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

// ---------- Avisos ----------
let toastTimer = 0;
function toast(opts: { title: string; label?: string; image?: string; iconName?: IconName }) {
  const t = $('toast');
  t.innerHTML = '';
  t.className = opts.label ? 'toast' : 'toast is-info';
  if (opts.image) {
    const img = document.createElement('img');
    img.src = opts.image;
    img.alt = '';
    t.append(img);
  } else if (opts.iconName) {
    const i = document.createElement('span');
    i.className = 'toast-icon';
    i.innerHTML = icon(opts.iconName);
    t.append(i);
  }
  const text = document.createElement('div');
  if (opts.label) {
    const small = document.createElement('small');
    small.textContent = opts.label;
    text.append(small);
  }
  const b = document.createElement('b');
  b.textContent = opts.title;
  text.append(b);
  t.append(text);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3200);
}

let areaTimer = 0;
function showAreaTitle(name: string, sub: string) {
  const el = $('area-title');
  $('area-name').textContent = name;
  $('area-sub').textContent = sub;
  el.hidden = true;
  void el.offsetWidth; // reinicia la animación
  el.hidden = false;
  clearTimeout(areaTimer);
  areaTimer = window.setTimeout(() => (el.hidden = true), 3300);
}

// ---------- Búsqueda de ciudad ----------
const searchInput = $<HTMLInputElement>('search-input');
const searchBtn = $<HTMLButtonElement>('search-btn');
const RECENT_KEY = 'flyfly:recent';

function setStatus(text: string, error = false) {
  const s = $('search-status');
  s.textContent = text;
  s.classList.toggle('is-error', error);
}

function loadRecent(): GeoResult[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(place: GeoResult) {
  const list = [place, ...loadRecent().filter((p) => p.name !== place.name || p.detail !== place.detail)].slice(0, 4);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* sin almacenamiento */ }
}

function renderRecent() {
  const list = loadRecent();
  const box = $('recent-list');
  box.innerHTML = '';
  $('recent').hidden = !list.length;
  for (const place of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${icon('recent')}<span></span>`;
    b.querySelector('span')!.textContent = place.name;
    b.title = place.detail;
    b.onclick = () => startFlight(place);
    box.append(b);
  }
}

searchInput.disabled = searchBtn.disabled = false;
setStatus('');
renderRecent();
searchInput.focus();

function openSearch() {
  closePanels();
  paused = true;
  $('results').innerHTML = '';
  setStatus('');
  renderRecent();
  $('intro-close').hidden = !flying;
  $('intro').hidden = false;
  searchInput.select();
  searchInput.focus();
}
$('city-btn').onclick = openSearch;
$('intro-close').onclick = () => {
  $('intro').hidden = true;
  paused = false;
};

$('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  const list = $('results');
  list.innerHTML = '';
  if (!query) {
    setStatus('Escribe el nombre de una ciudad o lugar.', true);
    searchInput.focus();
    return;
  }
  setStatus('Buscando…');
  searchBtn.disabled = true;
  let hits: GeoResult[] = [];
  try {
    hits = await geocode(world, query);
  } catch {
    setStatus('La búsqueda no está disponible ahora mismo. Inténtalo de nuevo.', true);
    return;
  } finally {
    searchBtn.disabled = false;
  }
  if (!hits.length) return setStatus('No encontré ese lugar. Prueba con otro nombre.', true);
  if (hits.length === 1) return startFlight(hits[0]);
  setStatus('Hay varios lugares con ese nombre. Elige uno:');
  for (const hit of hits) {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button">${icon('pin')}<span><b></b><small></small></span></button>`;
    li.querySelector('b')!.textContent = hit.name;
    li.querySelector('small')!.textContent = hit.detail;
    li.querySelector('button')!.onclick = () => startFlight(hit);
    list.append(li);
  }
});

async function startFlight(place: GeoResult) {
  saveRecent(place);
  // sound.start(); // Sonido
  $('intro').hidden = true;
  $('results').innerHTML = '';
  setStatus('');
  await flyTo(place);
  flying = true;
  paused = false;
  document.body.classList.add('flying');
  const { total } = pois.progress();
  showAreaTitle(place.name, total ? `${total} lugares escondidos por descubrir` : 'No hay lugares registrados en esta zona');
  showHelpOnce();
}

// ---------- Pantalla de carga ----------
function step(name: string, state: 'active' | 'done' | 'fail') {
  const li = document.querySelector<HTMLElement>(`#loading-steps [data-step="${name}"]`)!;
  li.className = state;
  li.querySelector('.step-icon')!.innerHTML = icon(state === 'done' ? 'check' : state === 'fail' ? 'warning' : 'loader');
}

function setProgress(fraction: number) {
  $('loading-progress').style.width = `${Math.round(fraction * 100)}%`;
}

/** Espera a que carguen las teselas visibles mostrando el avance (máximo 15 s). */
function loadTiles(w: World): Promise<void> {
  return new Promise((resolve) => {
    let maxPending = 1;
    const update = (pending: number, processing: number) => {
      const left = pending + processing;
      maxPending = Math.max(maxPending, left);
      const f = 1 - left / maxPending;
      setProgress(0.35 + 0.65 * f);
      $('tiles-progress').textContent = `${Math.round(f * 100)} %`;
    };
    const finish = () => { clearTimeout(timer); removeProgress(); removeDone(); resolve(); };
    const timer = setTimeout(finish, 15000);
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
  closePanels();
  pois.clear();
  $('city-name').textContent = $('drawer-city').textContent = $('loading-city').textContent = place.name;
  document.querySelectorAll<HTMLElement>('#loading-steps li').forEach((li) => {
    li.className = '';
    li.querySelector('.step-icon')!.innerHTML = '';
  });
  $('tiles-progress').textContent = '';
  setProgress(0);
  $('loading').hidden = false;

  // Los lugares se piden a la vez que se coloca la cámara y se mide el terreno.
  const places = loadCityPois(place.lat, place.lng);

  step('city', 'active');
  ufo.teleport(place.lat, place.lng);
  ufo.render(0);
  const ground = await Promise.race([groundHeight(world, place.lat, place.lng), timeout(8000, 0)]);
  ufo.teleport(place.lat, place.lng, ground);
  ufo.render(0);
  step('city', 'done');
  setProgress(0.15);

  step('places', 'active');
  try {
    pois.add(await places);
    step('places', 'done');
  } catch {
    step('places', 'fail');
  }
  setProgress(0.35);

  step('tiles', 'active');
  await loadTiles(world);
  step('tiles', 'done');
  setProgress(1);
  updateHud();
  await timeout(350, 0);
  $('loading').hidden = true;
}

// ---------- Ficha del lugar ----------
let openPoi: Poi | undefined;
let sheetFromDiscovery = false;

function setTag(el: HTMLElement, kind: 'found' | 'sponsor' | 'mystery') {
  const label = { found: 'Descubierto', sponsor: 'Patrocinado', mystery: 'Por descubrir' }[kind];
  const iconName: IconName = { found: 'check', sponsor: 'star', mystery: 'question' }[kind] as IconName;
  el.className = `tag tag-${kind}`;
  el.innerHTML = `${icon(iconName)}<span></span>`;
  el.querySelector('span')!.textContent = label;
}

async function openSheet(poi: Poi, fromDiscovery = false) {
  openPoi = poi;
  sheetFromDiscovery = fromDiscovery;
  closeDrawer();
  closePopovers();
  const img = $<HTMLImageElement>('sheet-img');
  $('sheet').classList.toggle('no-media', !poi.image);
  img.hidden = !poi.image;
  if (poi.image) img.src = poi.image;
  img.alt = poi.name;
  setTag($('sheet-status'), poi.sponsor ? 'sponsor' : pois.isDiscovered(poi) ? 'found' : 'mystery');
  $('sheet-dist').textContent = `A ${formatDistance(distance(ufo, poi))}`;
  $('sheet-title').textContent = poi.name;
  const desc = poi.description ? poi.description[0].toUpperCase() + poi.description.slice(1) : '';
  $('sheet-desc').textContent = desc;
  $('sheet-desc').hidden = !desc;
  $('sheet-text').textContent = '';
  const link = $<HTMLAnchorElement>('sheet-link');
  link.hidden = !poi.wikiTitle && !poi.url;
  link.href = poi.url ?? (poi.wikiTitle ? wikiUrl(poi.wikiTitle) : '#');
  const cta = $<HTMLAnchorElement>('sheet-cta');
  cta.hidden = !poi.sponsor?.link;
  if (poi.sponsor?.link) {
    cta.href = poi.sponsor.link;
    cta.textContent = poi.sponsor.cta ?? 'Visitar web';
  }
  const credit = $('sheet-credit');
  credit.textContent = '';
  $('sheet').hidden = false;

  const [summary, photo] = await Promise.all([
    poi.wikiTitle ? fetchSummary(poi.wikiTitle).catch(() => undefined) : undefined,
    poi.image ? fetchImageCredit(poi.image).catch(() => undefined) : undefined,
  ]);
  if (openPoi !== poi) return;
  $('sheet-text').textContent = summary?.extract ?? '';
  if (summary?.url) link.href = summary.url;
  if (!poi.image && summary?.image) {
    img.src = summary.image;
    img.hidden = false;
    $('sheet').classList.remove('no-media');
  }
  // Atribución obligatoria: autor y licencia de la foto, y licencia del texto.
  credit.textContent = '';
  if (photo) {
    credit.append('Foto: ');
    const a = document.createElement('a');
    a.href = photo.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = photo.artist;
    credit.append(a, photo.license ? ` (${photo.license}). ` : '. ');
  }
  if (poi.wikiTitle) credit.append('Texto: Wikipedia (CC BY-SA 4.0).');
}

function closeSheet() {
  openPoi = undefined;
  $('sheet').hidden = true;
}
$('sheet-close').onclick = closeSheet;

pois.onSelect = (poi) => {
  if (pois.isDiscovered(poi) || poi.sponsor) openSheet(poi);
  else toast({ title: 'Acércate para descubrir este lugar', iconName: 'question' });
};

// ---------- Lugares descubiertos ----------
let gridCount = -1;

function renderDrawer() {
  const { discovered, total } = pois.progress();
  $('drawer-found').textContent = String(discovered);
  $('drawer-total').textContent = String(total);
  $('drawer-bar').style.width = total ? `${(discovered / total) * 100}%` : '0';

  const hints = pois.hints(ufo.lat, ufo.lng);
  $('drawer-hints-section').hidden = !hints.length;
  const list = $('drawer-hints');
  list.innerHTML = '';
  for (const { poi, dist } of hints) {
    const rel = bearing(ufo, poi) - (ufo.heading * 180) / Math.PI;
    const li = document.createElement('li');
    li.innerHTML = `<span class="compass-arrow" style="transform: rotate(${(rel + 45).toFixed(0)}deg)">${icon('nav')}</span>${formatDistance(dist)}`;
    list.append(li);
  }

  // La cuadrícula solo se rehace cuando cambia el número de descubiertos (evita recargar fotos).
  const found = [...pois.pois.values()].filter((p) => pois.isDiscovered(p) && !p.sponsor);
  $('drawer-empty').hidden = found.length > 0;
  if (found.length === gridCount) return;
  gridCount = found.length;
  const grid = $('drawer-grid');
  grid.innerHTML = '';
  for (const poi of found) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'place';
    b.innerHTML = '<img alt="" loading="lazy" /><span></span>';
    if (poi.thumb) b.querySelector('img')!.src = poi.thumb;
    b.querySelector('span')!.textContent = poi.name;
    b.onclick = () => openSheet(poi);
    grid.append(b);
  }
}

function closeDrawer() {
  $('drawer').hidden = true;
}
function toggleDrawer() {
  const drawer = $('drawer');
  if (!drawer.hidden) return closeDrawer();
  closePopovers();
  closeSheet();
  gridCount = -1;
  renderDrawer();
  drawer.hidden = false;
}
$('menu-btn').onclick = toggleDrawer;
$('drawer-close').onclick = closeDrawer;

// ---------- Ajustes y controles ----------
function closePopovers() {
  $('settings').hidden = true;
  $('help').hidden = true;
}
function closePanels() {
  closePopovers();
  closeDrawer();
  closeSheet();
}
function togglePopover(id: 'settings' | 'help') {
  const el = $(id);
  const open = el.hidden;
  closePopovers();
  el.hidden = !open;
}
$('settings-btn').onclick = (e) => { e.stopPropagation(); togglePopover('settings'); };
$('help-btn').onclick = (e) => { e.stopPropagation(); togglePopover('help'); };
document.addEventListener('pointerdown', (e) => {
  const t = e.target as Node;
  for (const id of ['settings', 'help']) {
    const el = $(id);
    if (!el.hidden && !el.contains(t) && !$(`${id}-btn`).contains(t)) el.hidden = true;
  }
});

function renderQuality() {
  document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.quality === quality));
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) => {
  b.onclick = () => {
    quality = b.dataset.quality as Quality;
    setQuality(world, quality);
    renderQuality();
  };
});
renderQuality();

$('reset-progress').onclick = () => {
  if (!confirm('¿Reiniciar los lugares descubiertos en esta ciudad?')) return;
  pois.resetProgress();
  gridCount = -1;
  closePopovers();
  updateHud();
  toast({ title: 'Progreso reiniciado', iconName: 'reset' });
};
const about = $<HTMLDialogElement>('about');
$('about-btn').onclick = () => { closePopovers(); about.showModal(); };
$('about-close').onclick = () => about.close();

const HELP_KEY = 'flyfly:helpSeen';
function showHelpOnce() {
  if (matchMedia('(pointer: coarse)').matches) return;
  try {
    if (localStorage.getItem(HELP_KEY)) return;
    localStorage.setItem(HELP_KEY, '1');
  } catch { /* sin almacenamiento */ }
  $('help').hidden = false;
  setTimeout(() => ($('help').hidden = true), 9000);
}

// ---------- Mandos ----------
const keys = new Set<string>();
const stick = { x: 0, y: 0 };
let touchLift = 0;

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || about.open) return;
  keys.add(e.code);
  if (e.code === 'KeyC') ufo.toggleCamera();
  // if (e.code === 'KeyM') sound.toggle(); // Sonido
  if (e.code === 'Escape') closePanels();
  if (e.code === 'Tab' && flying) { e.preventDefault(); toggleDrawer(); }
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
  b.onpointerup = b.onpointerleave = b.onpointercancel = () => (touchLift = 0);
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
  closePopovers();
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
function updateHud() {
  const { found, target } = pois.update(ufo.lat, ufo.lng, ufo.ground, ufo.excluded);
  if (found) {
    // sound.chime(); // Sonido
    toast({ label: 'Descubierto', title: found.name, image: found.thumb });
    openSheet(found, true);
    gridCount = -1;
  }
  const { discovered, total } = pois.progress();
  $('visited').textContent = String(discovered);
  $('total').textContent = String(total);

  // Brújula hacia el lugar oculto más cercano (la flecha del icono apunta al noroeste: +45°).
  $('compass').hidden = !target;
  if (target) {
    $('compass-dist').textContent = formatDistance(target.dist);
    const rel = bearing(ufo, target.poi) - (ufo.heading * 180) / Math.PI;
    $('compass-arrow').style.transform = `rotate(${(rel + 45).toFixed(1)}deg)`;
  }

  // Altitud sobre el nivel del mar: las teselas 3D usan alturas elipsoidales (WGS84), se corrige con el geoide.
  const msl = world.tileset ? ufo.height - geoidHeight(ufo.lat, ufo.lng) : ufo.height;
  $('altitude-value').textContent = `${Math.round(msl)} m`;

  if (openPoi) {
    const d = distance(ufo, openPoi);
    $('sheet-dist').textContent = `A ${formatDistance(d)}`;
    if (sheetFromDiscovery && d > 900) closeSheet();
  }
  if (!$('drawer').hidden) renderDrawer();
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
  // sound.update(ufo.speed); // Sonido

  slowTimer += dt;
  if (slowTimer > 0.25) {
    slowTimer = 0;
    ufo.sampleGround(pois.excluded);
    updateHud();
  }
});
// Los marcadores HTML se recolocan después de cada fotograma, con la cámara ya actualizada.
viewer.scene.postRender.addEventListener(() => pois.render());

// Acceso para depuración en desarrollo (no se incluye en la web publicada).
if (import.meta.env.DEV) Object.assign(window, { flyfly: { ufo, pois, startFlight, openSheet } });
