import '@cesium/engine/Source/Widget/CesiumWidget.css';
import '@fontsource-variable/outfit';
import './style.css';
import { CITY_ALTITUDE, Controls, Craft } from './flight';
import { geoidHeight, loadGeoid } from './geoid';
import { hydrateIcons, icon, IconName } from './icons';
import { adsEnabled, manageConsent, showAd } from './ads';
import { AdvertiserLayer, loadAdvertisers } from './advertisers';
import { track } from './analytics';
import { bearing, distance, fetchImageCredit, fetchSummary, formatDistance, FoundVisibility, loadCityPois, loadSponsors, Poi, PoiLayer, wikiUrl } from './pois';
import { createWorld, geocode, GeoResult, groundHeight, initialQuality, Quality, setQuality, World } from './world';
// Sonido desactivado (para reactivarlo, descomenta las líneas marcadas con "Sonido").
// import { EngineSound } from './sound'; // Sonido
import { Matrix4 } from '@cesium/engine';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
hydrateIcons();

const [world] = await Promise.all([createWorld($('world')), loadGeoid()]);
const { viewer } = world;
const ufo = new Craft(viewer);
const pois = new PoiLayer(viewer, $('markers'));
const ads = new AdvertiserLayer(viewer, $('markers'));
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
let currentCity: GeoResult | undefined;

// Modo de juego: turismo (lugares de Wikipedia por descubrir) o recreativo (negocios y anunciantes).
type Mode = 'turismo' | 'recreativo';
const MODE_KEY = 'flyfly:mode';
let mode: Mode = (() => {
  try { return localStorage.getItem(MODE_KEY) === 'recreativo' ? 'recreativo' : 'turismo'; } catch { return 'turismo'; }
})();
/** Modo de la ciudad que se está sobrevolando (el del menú cuando se eligió la ciudad). */
let flightMode: Mode = mode;
let lastPos: { lat: number; lng: number } | undefined;

// Estadísticas por ciudad (en el navegador): primer descubrimiento, finalización y distancia recorrida.
interface CityStats { first?: number; completed?: number; km?: number }
const STATS_KEY = 'flyfly:cities';
const cityKey = (c: GeoResult) => `${c.name}|${c.lat.toFixed(2)}|${c.lng.toFixed(2)}`;
function loadStats(): Record<string, CityStats> {
  try { return JSON.parse(localStorage.getItem(STATS_KEY) ?? '{}'); } catch { return {}; }
}
function cityStats(): CityStats {
  return currentCity ? loadStats()[cityKey(currentCity)] ?? {} : {};
}
function saveCityStats(patch: CityStats) {
  if (!currentCity) return;
  const all = loadStats();
  all[cityKey(currentCity)] = { ...all[cityKey(currentCity)], ...patch };
  try { localStorage.setItem(STATS_KEY, JSON.stringify(all)); } catch { /* sin almacenamiento */ }
}
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

function renderMode() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('advertise-note').hidden = mode !== 'recreativo';
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
  b.onclick = () => {
    mode = b.dataset.mode as Mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* sin almacenamiento */ }
    renderMode();
  };
});
renderMode();

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

/** Vuelve al menú principal: deja la ciudad y muestra el planeta con el buscador. */
function goHome() {
  stopAutopilot();
  closePanels();
  $('victory').hidden = true;
  flying = false;
  paused = true;
  document.body.classList.remove('flying', 'mode-recreativo');
  pois.clear();
  ads.clear();
  ufo.hide();
  viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  viewer.camera.flyHome(2);
  searchInput.value = '';
  $('results').innerHTML = '';
  setStatus('');
  renderRecent();
  renderMode();
  $('intro-close').hidden = true;
  $('intro').hidden = false;
}
$('home-btn').onclick = goHome;
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
  stopAutopilot();
  saveRecent(place);
  currentCity = place;
  flightMode = mode;
  document.body.classList.toggle('mode-recreativo', flightMode === 'recreativo');
  const advertise = $<HTMLAnchorElement>('advertise-btn');
  advertise.hidden = flightMode !== 'recreativo';
  advertise.href = `anunciate.html?${new URLSearchParams({ ciudad: place.name, lat: place.lat.toFixed(5), lng: place.lng.toFixed(5) })}`;
  lastPos = undefined;
  track('ciudad', { ciudad: place.name, modo: flightMode });
  // sound.start(); // Sonido
  $('intro').hidden = true;
  $('results').innerHTML = '';
  setStatus('');
  await flyTo(place);
  flying = true;
  paused = false;
  document.body.classList.add('flying');
  if (flightMode === 'recreativo') {
    const n = ads.pois.length;
    showAreaTitle(place.name, n ? `${n} ${n === 1 ? 'negocio' : 'negocios y anunciantes'} en el mapa` : 'Todavía no hay anunciantes aquí. ¡Sé el primero!');
  } else {
    const { total } = pois.progress();
    showAreaTitle(place.name, total ? `${total} lugares escondidos por descubrir` : 'No hay lugares registrados en esta zona');
  }
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

/** Espera a que carguen las teselas visibles (como mucho `maxMs`), informando del avance de 0 a 1. */
function loadTiles(w: World, onProgress: (f: number) => void = () => {}, maxMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let maxPending = 1;
    const update = (pending: number, processing: number) => {
      const left = pending + processing;
      maxPending = Math.max(maxPending, left);
      onProgress(1 - left / maxPending);
    };
    const finish = () => { clearTimeout(timer); removeProgress(); removeDone(); resolve(); };
    const timer = setTimeout(finish, maxMs);
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
  ads.clear();
  const placesStep = document.querySelector('#loading-steps [data-step="places"]')!;
  placesStep.lastChild!.textContent = flightMode === 'recreativo' ? 'Buscando negocios y anunciantes' : 'Buscando lugares de interés';
  $('city-name').textContent = $('drawer-city').textContent = $('loading-city').textContent = place.name;
  document.querySelectorAll<HTMLElement>('#loading-steps li').forEach((li) => {
    li.className = '';
    li.querySelector('.step-icon')!.innerHTML = '';
  });
  $('tiles-progress').textContent = '';
  setProgress(0);
  $('loading').hidden = false;

  // Los lugares se piden a la vez que se coloca la cámara y se mide el terreno.
  const tourism = flightMode === 'turismo';
  const places = tourism ? loadCityPois(place.lat, place.lng) : Promise.resolve([]);
  const sponsors = tourism ? loadSponsors(place.lat, place.lng) : Promise.resolve([]);
  const advertisers = tourism ? Promise.resolve([]) : loadAdvertisers(place.lat, place.lng);
  places.catch(() => {}); // se gestiona más abajo

  step('city', 'active');
  ufo.teleport(place.lat, place.lng, 0, CITY_ALTITUDE);
  ufo.render(0);
  const ground = await Promise.race([groundHeight(world, place.lat, place.lng), timeout(8000, 0)]);
  ufo.teleport(place.lat, place.lng, ground, CITY_ALTITUDE);
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
  try {
    pois.add(await sponsors);
  } catch { /* sin patrocinadores */ }
  if (!tourism) await ads.add(await advertisers, ufo.excluded);
  setProgress(0.35);

  step('tiles', 'active');
  await loadTiles(world, (f) => {
    setProgress(0.35 + 0.65 * f);
    $('tiles-progress').textContent = `${Math.round(f * 100)} %`;
  });
  step('tiles', 'done');
  setProgress(1);
  updateHud();
  await timeout(350, 0);
  $('loading').hidden = true;
}

// ---------- Viajar a un lugar (teletransporte) ----------
/** Lleva el ovni junto a un lugar con una animación de 2 a 4 s mientras se cargan las teselas. */
async function travelTo(poi: Poi) {
  closePanels();
  paused = true;
  const warp = $('warp');
  $('warp-name').textContent = poi.name;
  warp.classList.remove('is-leaving');
  warp.hidden = false;
  await timeout(450, 0);
  // Aparece 150 m al sur del lugar, mirando hacia él.
  const lat = poi.lat - 150 / 111320, lng = poi.lng;
  ufo.teleport(lat, lng, ufo.ground);
  ufo.heading = 0;
  ufo.render(0);
  const [ground] = await Promise.all([
    Promise.race([groundHeight(world, lat, lng), timeout(4000, ufo.ground)]),
    timeout(1400, 0),
  ]);
  ufo.teleport(lat, lng, ground);
  ufo.heading = 0;
  ufo.render(0);
  lastPos = { lat, lng };
  await loadTiles(world, () => {}, 3500);
  warp.classList.add('is-leaving');
  await timeout(350, 0);
  warp.hidden = true;
  paused = false;
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
  if (poi.id.startsWith('ad_')) track('anuncio-ficha', { anuncio: poi.id.slice(3) });
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
  $('sheet-text').textContent = poi.body ?? '';
  const gallery = $('sheet-gallery');
  gallery.innerHTML = '';
  gallery.hidden = (poi.gallery?.length ?? 0) < 2;
  for (const src of poi.gallery ?? []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<img alt="" loading="lazy" />';
    b.querySelector('img')!.src = src;
    b.onclick = () => { img.src = src; };
    gallery.append(b);
  }
  const link = $<HTMLAnchorElement>('sheet-link');
  link.hidden = !poi.wikiTitle && !poi.url;
  link.href = poi.url ?? (poi.wikiTitle ? wikiUrl(poi.wikiTitle) : '#');
  const cta = $<HTMLAnchorElement>('sheet-cta');
  cta.hidden = !poi.sponsor?.link;
  if (poi.sponsor?.link) {
    cta.href = poi.sponsor.link;
    cta.textContent = poi.sponsor.cta ?? 'Visitar web';
  }
  const travelBtn = $('sheet-travel');
  travelBtn.hidden = !(pois.isDiscovered(poi) || poi.id.startsWith('ad_')) || distance(ufo, poi) < 300;
  travelBtn.onclick = () => travelTo(poi);
  const credit = $('sheet-credit');
  credit.textContent = '';
  $('sheet').hidden = false;
  if (adsEnabled && !poi.sponsor) showAd($('sheet-ad'));
  else $('sheet-ad').hidden = true;

  const [summary, photo] = await Promise.all([
    poi.wikiTitle ? fetchSummary(poi.wikiTitle).catch(() => undefined) : undefined,
    poi.image ? fetchImageCredit(poi.image).catch(() => undefined) : undefined,
  ]);
  if (openPoi !== poi) return;
  $('sheet-text').textContent = summary?.extract ?? poi.body ?? '';
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
  if (poi.id.startsWith('ad_')) credit.append(`Contenido publicitario proporcionado por ${poi.name}.`);
}

function closeSheet() {
  openPoi = undefined;
  $('sheet').hidden = true;
}
$('sheet-close').onclick = closeSheet;

ads.onSelect = (poi) => openSheet(poi);
// Estadísticas anónimas para los anunciantes: veces que se ha visto su anuncio, se ha abierto su ficha y se ha pulsado su botón.
ads.onSeen = (ad) => track('anuncio-visto', { anuncio: ad.id, tipo: ad.type });
$('sheet-cta').addEventListener('click', () => {
  if (openPoi?.id.startsWith('ad_')) track('anuncio-clic', { anuncio: openPoi.id.slice(3) });
});
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
  const recreational = flightMode === 'recreativo';
  $('drawer-kind').textContent = recreational ? 'Negocios' : 'Lugares';
  $('drawer-grid-title').textContent = recreational ? 'En el mapa' : 'Descubiertos';
  $('drawer-empty').textContent = recreational
    ? 'Todavía no hay anunciantes en esta ciudad.'
    : 'Todavía no has descubierto ningún lugar. Sigue la flecha y los haces de luz naranjas.';
  const found = recreational ? ads.pois : [...pois.pois.values()].filter((p) => pois.isDiscovered(p) && !p.sponsor);
  $('drawer-empty').hidden = found.length > 0;
  if (found.length === gridCount) return;
  gridCount = found.length;
  const grid = $('drawer-grid');
  grid.innerHTML = '';
  for (const poi of found) {
    // Al pulsar se abre la ficha, que tiene el botón "Viajar aquí".
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'place';
    tile.innerHTML = '<img alt="" loading="lazy" /><span></span>';
    if (poi.thumb) tile.querySelector('img')!.src = poi.thumb;
    tile.querySelector('span')!.textContent = poi.name;
    tile.onclick = () => openSheet(poi);
    grid.append(tile);
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

const FOUND_KEY = 'flyfly:showFound';
function renderFoundVisibility() {
  document.querySelectorAll<HTMLButtonElement>('[data-found]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.found === pois.foundVisibility));
  });
}
try {
  const saved = localStorage.getItem(FOUND_KEY) as FoundVisibility | null;
  if (saved === 'todos' || saved === 'cercanos' || saved === 'ninguno') pois.foundVisibility = saved;
} catch { /* sin almacenamiento */ }
document.querySelectorAll<HTMLButtonElement>('[data-found]').forEach((b) => {
  b.onclick = () => {
    pois.foundVisibility = b.dataset.found as FoundVisibility;
    try { localStorage.setItem(FOUND_KEY, pois.foundVisibility); } catch { /* sin almacenamiento */ }
    renderFoundVisibility();
    if (flying) updateHud();
  };
});
renderFoundVisibility();

$('reset-progress').onclick = () => {
  if (!confirm('¿Reiniciar los lugares descubiertos en esta ciudad?')) return;
  pois.resetProgress();
  gridCount = -1;
  closePopovers();
  updateHud();
  toast({ title: 'Progreso reiniciado', iconName: 'reset' });
};
$('consent-btn').hidden = !adsEnabled;
$('consent-btn').onclick = () => {
  closePopovers();
  if (!manageConsent()) toast({ title: 'No hay cookies que gestionar ahora mismo', iconName: 'cookie' });
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

// ---------- Ciudad completada ----------
function formatDuration(ms: number) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} días`;
}

function showVictory() {
  if (!currentCity) return;
  track('ciudad-completada', { ciudad: currentCity.name });
  const { total } = pois.progress();
  const stats = cityStats();
  $('victory-title').textContent = currentCity.name;
  $('v-places').textContent = `${total} de ${total}`;
  $('v-time').textContent = stats.first && stats.completed ? formatDuration(stats.completed - stats.first) : '-';
  $('v-km').textContent = `${(stats.km ?? 0).toFixed(1).replace('.', ',')} km`;
  // Confeti: piezas con posición, color y retraso aleatorios (solo CSS; se borra al cerrar).
  const box = $('confetti');
  box.innerHTML = '';
  const colors = ['#e2602f', '#f0b43c', '#34b277', '#4aa8e8', '#ffffff'];
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 1.6}s`;
    piece.style.animationDuration = `${2.6 + Math.random() * 2}s`;
    box.append(piece);
  }
  closePanels();
  paused = true;
  $('victory').hidden = false;
}

function closeVictory() {
  $('victory').hidden = true;
  $('confetti').innerHTML = '';
  paused = false;
}
$('v-close').onclick = closeVictory;
$('v-auto').onclick = () => { closeVictory(); startAutopilot(); };

$('v-share').onclick = async () => {
  const url = `${location.origin}${location.pathname}`;
  const text = `He completado mi exploración de ${currentCity?.name ?? 'una ciudad'} en FlyFly. ¿Te atreves a explorar la tuya?`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'FlyFly', text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast({ title: 'Enlace copiado: pégalo donde quieras', iconName: 'share' });
  } catch {
    // Se canceló el diálogo de compartir.
  }
};

// ---------- Exploración automática (ciudad completada) ----------
interface Autopilot { visited: Set<string>; target?: Poi; pauseUntil: number }
let auto: Autopilot | null = null;
const AUTO_ALTITUDE = 110; // metros sobre el suelo

function isCityComplete() {
  const { discovered, total } = pois.progress();
  return total > 0 && discovered === total;
}

function renderAutoButton() {
  const btn = $('auto-btn');
  btn.hidden = !flying || !isCityComplete();
  btn.setAttribute('aria-pressed', String(!!auto));
  btn.classList.toggle('is-active', !!auto);
  $('auto-label').textContent = auto ? 'Detener' : 'Exploración automática';
  $('auto-icon').innerHTML = icon(auto ? 'stop' : 'path');
}

async function startAutopilot() {
  const places = [...pois.pois.values()].filter((p) => pois.isDiscovered(p) && !p.sponsor);
  if (!places.length) return;
  const start = places[Math.floor(Math.random() * places.length)];
  await travelTo(start);
  auto = { visited: new Set([start.id]), pauseUntil: performance.now() + 2000 };
  renderAutoButton();
  toast({ title: 'Exploración automática activada', iconName: 'path' });
}

function stopAutopilot() {
  if (!auto) return;
  auto = null;
  renderAutoButton();
}
$('auto-btn').onclick = () => (auto ? stopAutopilot() : startAutopilot());

/** Mandos del piloto automático: va en línea recta al lugar más cercano aún no visitado en este recorrido. */
function autopilotControls(now: number): Controls {
  const idle: Controls = { forward: 0, turn: 0, strafe: 0, lift: 0 };
  if (!auto) return idle;
  const lift = Math.max(-1, Math.min(1, (AUTO_ALTITUDE - ufo.altitude) / 40));
  if (now < auto.pauseUntil) return { ...idle, lift };
  if (!auto.target) {
    let best: { poi: Poi; d: number } | undefined;
    for (const p of pois.pois.values()) {
      if (p.sponsor || !pois.isDiscovered(p) || auto.visited.has(p.id)) continue;
      const d = distance(ufo, p);
      if (!best || d < best.d) best = { poi: p, d };
    }
    if (!best) {
      stopAutopilot();
      toast({ title: 'Recorrido completo: has visitado todos los lugares', iconName: 'confetti' });
      return idle;
    }
    auto.target = best.poi;
  }
  const target = auto.target;
  const d = distance(ufo, target);
  if (d < 40) {
    auto.visited.add(target.id);
    auto.target = undefined;
    auto.pauseUntil = now + 2500;
    toast({ label: 'De paso por', title: target.name, image: target.thumb });
    return { ...idle, lift };
  }
  const diff = ((((bearing(ufo, target) - (ufo.heading * 180) / Math.PI) % 360) + 540) % 360) - 180;
  const turn = Math.max(-1, Math.min(1, diff / 45));
  const forward = Math.abs(diff) > 50 ? 0.15 : d > 400 ? 1 : Math.max(0.35, d / 400);
  return { forward, turn, strafe: 0, lift };
}

// ---------- Mandos ----------
const keys = new Set<string>();
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const stick = { x: 0, y: 0 };
let touchLift = 0;

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || about.open) return;
  keys.add(e.code);
  if (MOVE_KEYS.includes(e.code)) stopAutopilot();
  if (e.code === 'KeyC') ufo.toggleCamera();
  // if (e.code === 'KeyM') sound.toggle(); // Sonido
  if (e.code === 'Escape') { closePanels(); if (!$('victory').hidden) closeVictory(); }
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
stickEl.addEventListener('pointerdown', (e) => {
  stickEl.setPointerCapture(e.pointerId);
  stopAutopilot();
});
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
  b.onpointerdown = () => {
    stopAutopilot();
    touchLift = Number(b.dataset.lift);
  };
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
  const { discovered, total } = pois.progress();
  if (found) {
    // sound.chime(); // Sonido
    gridCount = -1;
    if (!cityStats().first) saveCityStats({ first: Date.now() });
    if (discovered === total && total > 0) {
      saveCityStats({ completed: Date.now(), km: (cityStats().km ?? 0) + pendingKm });
      pendingKm = 0;
      showVictory();
    } else {
      toast({ label: 'Descubierto', title: found.name, image: found.thumb });
      openSheet(found, true);
    }
  }
  renderAutoButton();
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
let pendingKm = 0;
let kmSaveTimer = 0;

/** Suma la distancia recorrida en la ciudad (los saltos de teletransporte no cuentan). */
function trackDistance(dt: number) {
  if (lastPos) {
    const d = distance(lastPos, ufo);
    if (d < 500) pendingKm += d / 1000;
  }
  lastPos = { lat: ufo.lat, lng: ufo.lng };
  kmSaveTimer += dt;
  if (kmSaveTimer > 5 && pendingKm > 0) {
    saveCityStats({ km: (cityStats().km ?? 0) + pendingKm });
    pendingKm = 0;
    kmSaveTimer = 0;
  }
}

viewer.scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (paused) return;
  const manual = readControls();
  // Cualquier mando manual desactiva el piloto automático.
  if (auto && (manual.forward || manual.turn || manual.strafe || manual.lift)) stopAutopilot();
  ufo.update(dt, auto ? autopilotControls(now) : manual);
  ufo.render(dt);
  // sound.update(ufo.speed); // Sonido

  slowTimer += dt;
  if (slowTimer > 0.25) {
    slowTimer = 0;
    ufo.sampleGround([...pois.excluded, ...ads.excluded]);
    trackDistance(0.25);
    updateHud();
  }
});
// Los marcadores HTML se recolocan después de cada fotograma, con la cámara ya actualizada.
let lastRender = performance.now();
viewer.scene.postRender.addEventListener(() => {
  const now = performance.now();
  pois.render();
  ads.render(Math.min((now - lastRender) / 1000, 0.1));
  lastRender = now;
});

// Acceso para depuración en desarrollo (no se incluye en la web publicada).
if (import.meta.env.DEV) Object.assign(window, { flyfly: { ufo, pois, ads, goHome, startFlight, openSheet, travelTo, showVictory, startAutopilot } });
