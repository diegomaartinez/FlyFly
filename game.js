/**
 * ═══════════════════════════════════════════════════════════════
 *  SKYEXPLORER — game.js
 *  Motor: OpenLayers 10 + Esri World Imagery (sin token)
 *
 *  Novedades:
 *  - Avioneta dibujada con canvas apuntando en la dirección correcta
 *  - Marcadores POI ocultos hasta estar a menos de 1200 m
 *  - Distancia de descubrimiento: 200 m (primera vez → pausa + ficha)
 *  - Bitácora: registro de lugares descubiertos, consultable con 📖
 * ═══════════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════
//  CONSTANTES
// ════════════════════════════════════════════════════════════════
const DEG_PER_METER   = 1 / 111320;
const TURN_RATE       = 2.3;    // grados/frame
const VERT_SPEED      = 8;      // m/frame
const ALT_MIN         = 40;
const ALT_MAX         = 1000;
const DIST_DISCOVER   = 200;    // metros → descubrir lugar (primera vez)
const DIST_SHOW_LABEL = 1000;   // metros → mostrar marcador en mapa

// ════════════════════════════════════════════════════════════════
//  ESTADO
// ════════════════════════════════════════════════════════════════
const flight = {
  lat:     43.3623,
  lng:     -8.4115,
  alt:     350,
  heading: 0,
  speed:   50,       // m/s
  keys:    {},
  paused:  false,    // true mientras está abierta la ventana de descubrimiento
  userPaused: false, // true cuando el jugador pulsa P
};

const poiState = {
  places:      [],   // cargado desde places.json
  features:    {},   // id → ol.Feature del marcador
  discovered:  new Set(),  // ids ya descubiertos
  logbook:     [],   // array de {place, date} en orden de descubrimiento
  open:        null,
  photoIndex:  0,
};

// ════════════════════════════════════════════════════════════════
//  AVIONETA — canvas personalizado para que apunte hacia heading
// ════════════════════════════════════════════════════════════════
function makePlaneCanvas(heading) {
  const size = 52;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.translate(size / 2, size / 2);
  // heading 0 = Norte; el emoji ✈ por defecto apunta al este (45°), ajustamos −45°
  // ctx.rotate((heading - 45) * Math.PI / 180);

  // Sombra / halo
  ctx.shadowColor = '#00d4ff';
  ctx.shadowBlur  = 8;

  // Emoji avioneta
  ctx.font         = '30px serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⬆️', 0, 0);

  ctx.restore();
  return canvas;
}

// ════════════════════════════════════════════════════════════════
//  MAPA OPENLAYERS
// ════════════════════════════════════════════════════════════════
const satelliteLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attributions: '© Esri',
  }),
});

const labelsLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
  }),
  opacity: 0.7,
});

const markerSource = new ol.source.Vector();
const markerLayer  = new ol.layer.Vector({ source: markerSource });

const view = new ol.View({
  center:         ol.proj.fromLonLat([flight.lng, flight.lat]),
  zoom:           altitudeToZoom(flight.alt),
  rotation:       0,
  enableRotation: true,
});

const map = new ol.Map({
  target:   'map',
  layers:   [satelliteLayer, labelsLayer, markerLayer],
  view:     view,
  controls: [],
});

// ─── Feature avioneta ─────────────────────────────────────────
const planeFeature = new ol.Feature({
  geometry: new ol.geom.Point(ol.proj.fromLonLat([flight.lng, flight.lat])),
});
planeFeature.setStyle(makePlaneStyle(0));
markerSource.addFeature(planeFeature);

function makePlaneStyle(heading) {
  return new ol.style.Style({
    image: new ol.style.Icon({
      img:       makePlaneCanvas(heading),
      imgSize:   [52, 52],
      anchor:    [0.5, 0.5],
      anchorXUnits: 'fraction',
      anchorYUnits: 'fraction',
    }),
  });
}

// ─── Estilos POI ──────────────────────────────────────────────
function makePoiStyle(icon, discovered) {
  const fillColor  = discovered ? 'rgba(74,222,128,0.18)' : 'rgba(0,212,255,0.18)';
  const ringColor  = discovered ? '#4ade80' : '#00d4ff';
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: 18,
      fill:   new ol.style.Fill({ color: fillColor }),
      stroke: new ol.style.Stroke({ color: ringColor, width: 2 }),
    }),
    text: new ol.style.Text({
      text:    icon,
      font:    '18px serif',
      offsetY: 1,
      fill:    new ol.style.Fill({ color: '#fff' }),
    }),
  });
}

// ─── Click en mapa → abrir panel si ya descubierto ────────────
map.on('click', evt => {
  map.forEachFeatureAtPixel(evt.pixel, feature => {
    const id = feature.get('poiId');
    if (!id) return;
    if (!poiState.discovered.has(id)) return;  // no descubierto: ignorar
    const place = poiState.places.find(p => p.id === id);
    if (place) openPoiPanel(place);
  }, { hitTolerance: 10 });
});

map.on('pointermove', evt => {
  const hit = map.hasFeatureAtPixel(evt.pixel, { hitTolerance: 10 });
  map.getTargetElement().style.cursor = hit ? 'pointer' : '';
});

// ════════════════════════════════════════════════════════════════
//  CARGAR PLACES.JSON
// ════════════════════════════════════════════════════════════════
fetch('places.json')
  .then(r => r.json())
  .then(data => {
    poiState.places = data;
    createPoiFeatures();
  })
  .catch(err => console.warn('No se pudo cargar places.json:', err))
  .finally(() => {
    hideSplash();
    notify('✈ ¡Usa las flechas para volar! Descubre lugares acercándote.');
    requestAnimationFrame(gameLoop);
  });

function createPoiFeatures() {
  poiState.places.forEach(place => {
    const feature = new ol.Feature({
      geometry: new ol.geom.Point(ol.proj.fromLonLat([place.lng, place.lat])),
      poiId:    place.id,
    });
    // Empieza invisible
    feature.setStyle(new ol.style.Style({}));
    markerSource.addFeature(feature);
    poiState.features[place.id] = feature;
  });
}

// ════════════════════════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════════════════════════
let lastTimestamp = null;

function gameLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  if (!flight.paused && !flight.userPaused) {
    processInput(dt);
    checkPoiProximity();
  }

  updatePlane();
  updateCamera();
  updateHUD();

  requestAnimationFrame(gameLoop);
}

// ─── Input ────────────────────────────────────────────────────
function processInput(dt) {
  const k = flight.keys;
  if (k['ArrowLeft'])              flight.heading = (flight.heading - TURN_RATE + 360) % 360;
  if (k['ArrowRight'])             flight.heading = (flight.heading + TURN_RATE) % 360;
  if (k['ArrowUp']   || k['KeyW']) flight.alt = Math.min(ALT_MAX, flight.alt + VERT_SPEED);
  if (k['ArrowDown'] || k['KeyS']) flight.alt = Math.max(ALT_MIN, flight.alt - VERT_SPEED);

  const rad  = flight.heading * Math.PI / 180;
  const dist = flight.speed * dt;
  flight.lat += Math.cos(rad) * dist * DEG_PER_METER;
  flight.lng += Math.sin(rad) * dist * DEG_PER_METER / Math.cos(flight.lat * Math.PI / 180);
  flight.lat  = Math.max(-85, Math.min(85, flight.lat));
  flight.lng  = ((flight.lng + 180) % 360 + 360) % 360 - 180;
}

// ─── Avioneta: posición + rotación ───────────────────────────
function updatePlane() {
  const coord = ol.proj.fromLonLat([flight.lng, flight.lat]);
  planeFeature.getGeometry().setCoordinates(coord);
  planeFeature.setStyle(makePlaneStyle(flight.heading));
}

// ─── Cámara ───────────────────────────────────────────────────
function updateCamera() {
  view.setCenter(ol.proj.fromLonLat([flight.lng, flight.lat]));
  view.setZoom(altitudeToZoom(flight.alt));
  view.setRotation(-flight.heading * Math.PI / 180);
}

function altitudeToZoom(alt) {
  if (alt < 80)   return 17.5;
  if (alt < 150)  return 16.5;
  if (alt < 300)  return 15.5;
  if (alt < 600)  return 14.5;
  if (alt < 1000) return 13.5;
  return 12.5;
}

// ─── HUD ──────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('i-alt').textContent = `${Math.round(flight.alt)} m`;
  document.getElementById('i-spd').textContent = `${Math.round(flight.speed * 3.6)} km/h (${flight.speed} m/s)`;
  document.getElementById('i-hdg').textContent = `${Math.round(flight.heading)}°`;
  document.getElementById('i-lat').textContent = `${flight.lat.toFixed(3)}°`;
  document.getElementById('i-lng').textContent = `${flight.lng.toFixed(3)}°`;
}

// ════════════════════════════════════════════════════════════════
//  PROXIMIDAD Y DESCUBRIMIENTO DE POIs
// ════════════════════════════════════════════════════════════════
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkPoiProximity() {
  poiState.places.forEach(place => {
    const dist    = haversineDistance(flight.lat, flight.lng, place.lat, place.lng);
    const feature = poiState.features[place.id];
    if (!feature) return;

    const isDiscovered = poiState.discovered.has(place.id);

    // ── Mostrar / ocultar marcador según distancia ──────────
    if (dist < DIST_SHOW_LABEL) {
      feature.setStyle(makePoiStyle(place.icon || 'ℹ️', isDiscovered));
    } else {
      feature.setStyle(new ol.style.Style({}));  // invisible
    }

    // ── Descubrimiento (primera vez a < 200 m) ──────────────
    if (!isDiscovered && dist < DIST_DISCOVER) {
      triggerDiscovery(place, feature);
    }
  });
}

// ════════════════════════════════════════════════════════════════
//  VENTANA DE DESCUBRIMIENTO
// ════════════════════════════════════════════════════════════════
function triggerDiscovery(place, feature) {
  // Marcar como descubierto inmediatamente para no volver a triggerar
  poiState.discovered.add(place.id);

  // Añadir a bitácora
  poiState.logbook.push({ place, date: new Date() });
  updateLogbookUI();

  // Pausar vuelo
  flight.paused = true;

  // Parpadeo del marcador en el mapa (animamos cambiando estilo rápido)
  let blinks = 0;
  const blinkInterval = setInterval(() => {
    blinks++;
    const visible = blinks % 2 === 0;
    feature.setStyle(visible
      ? makePoiStyle(place.icon || 'ℹ️', true)
      : new ol.style.Style({})
    );
    if (blinks >= 10) {
      clearInterval(blinkInterval);
      feature.setStyle(makePoiStyle(place.icon || 'ℹ️', true));
    }
  }, 150);

  // Rellenar ventana de descubrimiento
  document.getElementById('disc-icon').textContent        = place.icon || '📍';
  document.getElementById('disc-name').textContent        = place.name;
  document.getElementById('disc-description').textContent = place.description;
  document.getElementById('disc-coords').textContent      =
    `📍 ${place.lat.toFixed(4)}°N  ${Math.abs(place.lng).toFixed(4)}°${place.lng < 0 ? 'O' : 'E'}`;

  buildGallery('disc', place);

  // Mostrar overlay
  document.getElementById('discovery-overlay').classList.add('active');
}

document.getElementById('discovery-close').addEventListener('click', () => {
  document.getElementById('discovery-overlay').classList.remove('active');
  flight.paused = false;
});

// ════════════════════════════════════════════════════════════════
//  BITÁCORA
// ════════════════════════════════════════════════════════════════
document.getElementById('logbook-btn').addEventListener('click', () => {
  document.getElementById('logbook-panel').classList.toggle('open');
  // Cerrar poi-panel si estaba abierto
  document.getElementById('poi-panel').classList.remove('open');
});

document.getElementById('logbook-close').addEventListener('click', () => {
  document.getElementById('logbook-panel').classList.remove('open');
});

function updateLogbookUI() {
  const count  = poiState.logbook.length;
  const list   = document.getElementById('logbook-list');
  const empty  = document.getElementById('logbook-empty');
  const badge  = document.getElementById('logbook-count');

  badge.textContent = count;

  // Pulso en el botón
  const btn = document.getElementById('logbook-btn');
  btn.classList.remove('new-entry');
  void btn.offsetWidth;  // reflow para reiniciar animación
  btn.classList.add('new-entry');

  if (count === 0) {
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  // Reconstruir lista (orden cronológico inverso)
  list.innerHTML = '';
  [...poiState.logbook].reverse().forEach(entry => {
    const { place, date } = entry;
    const dateStr = date.toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const el = document.createElement('div');
    el.className = 'logbook-entry';
    el.innerHTML = `
      <div class="logbook-entry-icon">${place.icon || '📍'}</div>
      <div class="logbook-entry-info">
        <div class="logbook-entry-name">${place.name}</div>
        <div class="logbook-entry-date">Descubierto el ${dateStr}</div>
      </div>
      <div class="logbook-entry-arrow">›</div>
    `;
    el.addEventListener('click', () => {
      document.getElementById('logbook-panel').classList.remove('open');
      openPoiPanel(place);
    });
    list.appendChild(el);
  });
}

// ════════════════════════════════════════════════════════════════
//  PANEL DE INFORMACIÓN (desde bitácora o click en mapa)
// ════════════════════════════════════════════════════════════════
function openPoiPanel(place) {
  poiState.open       = place;
  poiState.photoIndex = 0;

  document.getElementById('poi-icon').textContent        = place.icon || '📍';
  document.getElementById('poi-name').textContent        = place.name;
  document.getElementById('poi-description').textContent = place.description;
  document.getElementById('poi-coords').textContent      =
    `📍 ${place.lat.toFixed(4)}°N  ${Math.abs(place.lng).toFixed(4)}°${place.lng < 0 ? 'O' : 'E'}`;

  buildGallery('poi', place);
  document.getElementById('poi-panel').classList.add('open');
}

document.getElementById('poi-close').addEventListener('click', () => {
  document.getElementById('poi-panel').classList.remove('open');
  poiState.open = null;
});

// ════════════════════════════════════════════════════════════════
//  GALERÍA DE FOTOS (reutilizable para disc y poi)
// ════════════════════════════════════════════════════════════════
function buildGallery(prefix, place) {
  // prefix: 'poi' o 'disc'
  const container = document.getElementById(`${prefix}-photos`);
  container.querySelectorAll('img').forEach(img => img.remove());
  document.getElementById(`${prefix}-photo-dots`).innerHTML = '';

  if (!place.photos || place.photos.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  place.photos.forEach((url, i) => {
    const img = document.createElement('img');
    img.src = url; img.alt = place.name;
    if (i === 0) img.classList.add('active');
    container.insertBefore(img, document.getElementById(`${prefix}-photo-prev`));

    const dot = document.createElement('div');
    dot.className = `photo-dot${i === 0 ? ' active' : ''}`;
    dot.addEventListener('click', () => setGalleryPhoto(prefix, i, place));
    document.getElementById(`${prefix}-photo-dots`).appendChild(dot);
  });

  const multi = place.photos.length > 1;
  document.getElementById(`${prefix}-photo-prev`).style.display = multi ? 'flex' : 'none';
  document.getElementById(`${prefix}-photo-next`).style.display = multi ? 'flex' : 'none';
  document.getElementById(`${prefix}-photo-dots`).style.display = multi ? 'flex' : 'none';
}

function setGalleryPhoto(prefix, index, place) {
  const n    = place.photos.length;
  const idx  = ((index % n) + n) % n;
  if (prefix === 'poi') poiState.photoIndex = idx;

  document.querySelectorAll(`#${prefix}-photos img`).forEach((img, i) =>
    img.classList.toggle('active', i === idx));
  document.querySelectorAll(`#${prefix}-photo-dots .photo-dot`).forEach((dot, i) =>
    dot.classList.toggle('active', i === idx));
}

// Botones galería POI
document.getElementById('photo-prev').addEventListener('click', () => {
  if (poiState.open) setGalleryPhoto('poi', poiState.photoIndex - 1, poiState.open);
});
document.getElementById('photo-next').addEventListener('click', () => {
  if (poiState.open) setGalleryPhoto('poi', poiState.photoIndex + 1, poiState.open);
});

// Botones galería Discovery
let discPhotoIndex = 0;
document.getElementById('disc-photo-prev').addEventListener('click', () => {
  const place = poiState.logbook[poiState.logbook.length - 1]?.place;
  if (place) { discPhotoIndex--; setGalleryPhoto('disc', discPhotoIndex, place); }
});
document.getElementById('disc-photo-next').addEventListener('click', () => {
  const place = poiState.logbook[poiState.logbook.length - 1]?.place;
  if (place) { discPhotoIndex++; setGalleryPhoto('disc', discPhotoIndex, place); }
});

// ════════════════════════════════════════════════════════════════
//  BÚSQUEDA DE CIUDAD
// ════════════════════════════════════════════════════════════════
document.getElementById('search-input').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const query = e.target.value.trim();
  if (!query) return;

  setSearchStatus('Buscando…');

  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();

    if (!data.length) { setSearchStatus('No encontrado. Prueba con otra ciudad.'); return; }

    const { lat, lon, display_name } = data[0];
    const cityName = display_name.split(',')[0];

    flight.lat     = parseFloat(lat);
    flight.lng     = parseFloat(lon);
    flight.alt     = 400;
    flight.heading = 0;

    setSearchStatus(`✈ Volando hacia ${cityName}`);
    notify(`✈ Bienvenido a ${cityName}`);
    e.target.blur();
    setTimeout(() => document.getElementById('search-status').classList.remove('visible'), 3500);

  } catch { setSearchStatus('Error de red. Comprueba tu conexión.'); }
});

function setSearchStatus(msg) {
  const el = document.getElementById('search-status');
  el.textContent = msg;
  el.classList.add('visible');
}

// ════════════════════════════════════════════════════════════════
//  TECLADO
// ════════════════════════════════════════════════════════════════
window.addEventListener('keydown', e => {
  if (document.activeElement === document.getElementById('search-input')) return;

  flight.keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();

  // ── Tecla P → pausar / reanudar ──────────────────────────────
  if (e.code === 'KeyP') {
    if (!flight.paused) {  // no interrumpir pausa de descubrimiento
      flight.userPaused = !flight.userPaused;
      togglePauseScreen(flight.userPaused);
    }
  }

  if (e.code === 'Escape') {
    document.getElementById('poi-panel').classList.remove('open');
    document.getElementById('logbook-panel').classList.remove('open');
    if (document.getElementById('discovery-overlay').classList.contains('active')) {
      document.getElementById('discovery-overlay').classList.remove('active');
      flight.paused = false;
    }
    poiState.open = null;
  }
});

window.addEventListener('keyup', e => { flight.keys[e.code] = false; });

// ════════════════════════════════════════════════════════════════
//  PANTALLA DE PAUSA
// ════════════════════════════════════════════════════════════════
function togglePauseScreen(show) {
  const el = document.getElementById('pause-overlay');
  if (show) {
    el.classList.add('active');
  } else {
    el.classList.remove('active');
  }
}

document.getElementById('pause-resume-btn').addEventListener('click', () => {
  flight.userPaused = false;
  togglePauseScreen(false);
});

// ════════════════════════════════════════════════════════════════
//  NOTIFICACIONES
// ════════════════════════════════════════════════════════════════
let notifTimeout;
function notify(msg) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => el.classList.remove('show'), 4500);
}

// ════════════════════════════════════════════════════════════════
//  SPLASH
// ════════════════════════════════════════════════════════════════
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.style.display === 'none') return;
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 800);
}
