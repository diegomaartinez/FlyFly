// Página "Anúnciate": solicitud de anuncio.
import '@fontsource-variable/outfit';
import 'leaflet/dist/leaflet.css';
import './style.css';
import './anunciate.css';
import L from 'leaflet';
import { track } from './analytics';
import { hydrateIcons } from './icons';
import { AdPreview3D } from './preview3d';

type AdType = 'lugar' | 'globo' | 'ovni' | 'avioneta';
interface Tarifa { nombre: string; descripcion: string; precioMes?: number; precio?: string; pago?: string }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
hydrateIcons();

/**
 * Dónde llegan las solicitudes. Por defecto, al email de la web (titular.js) a través de FormSubmit,
 * que no necesita cuenta. Con VITE_FORM_ENDPOINT se usa otro servicio (Formspree, Web3Forms…).
 * Si el envío falla, se ofrece mandarla por email y descargarla.
 */
const OWNER_EMAIL = ((window as any).TITULAR?.email as string | undefined)?.trim();
const FORM_ENDPOINT: string | undefined = import.meta.env.VITE_FORM_ENDPOINT
  || (OWNER_EMAIL && /^[^@\s\[]+@[^@\s]+\.[^@\s\]]+$/.test(OWNER_EMAIL) ? `https://formsubmit.co/ajax/${OWNER_EMAIL}` : undefined);
const MAX_PHOTOS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const COLORS = ['#e2602f', '#d6336c', '#7048e8', '#1c7ed6', '#0ca678', '#f08c00', '#212529'];

let type: AdType = 'lugar';
let tarifas: Record<string, Tarifa> = {};
let note = '';
let discounts: Record<string, number> = {};
let photos: File[] = [];
let point: { lat: number; lng: number } | undefined;

// ---------- 1. Tipo de anuncio y tarifas ----------
async function loadTarifas() {
  try {
    const data = await (await fetch('data/tarifas.json', { cache: 'no-cache' })).json();
    tarifas = data.tipos ?? {};
    note = data.nota ?? '';
    discounts = data.descuentos ?? {};
    if (data.oferta) { $('ad-offer').textContent = data.oferta; $('ad-offer').hidden = false; }
    // Descuento por duración en el desplegable.
    document.querySelectorAll<HTMLOptionElement>('#ad-months option').forEach((o) => {
      if (discounts[o.value]) o.textContent += ` (−${discounts[o.value]} %)`;
    });
  } catch { /* sin tarifas: solo nombres */ }
  const box = $('ad-types');
  box.innerHTML = '';
  for (const id of ['lugar', 'globo', 'ovni', 'avioneta'] as AdType[]) {
    const t = tarifas[id] ?? { nombre: id, descripcion: '' };
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.type = id;
    b.innerHTML = '<b></b><small></small><span class="price"></span>';
    b.querySelector('b')!.textContent = t.nombre;
    b.querySelector('small')!.textContent = t.descripcion;
    b.querySelector('.price')!.textContent = priceText(t);
    b.onclick = () => { type = id; renderType(); };
    box.append(b);
  }
  $('ad-price-note').textContent = note;
  renderType();
}

const euros = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + ' €';
const priceText = (t: Tarifa) => t.precio ?? (t.precioMes ? `${euros(t.precioMes)}/mes` : '');

/** Total de la duración elegida con su descuento. */
function renderTotal() {
  const t = tarifas[type];
  const months = Number(value('ad-months'));
  if (!t?.precioMes) { $('ad-total').textContent = ''; return; }
  const off = discounts[String(months)] ?? 0;
  const total = Math.round(t.precioMes * months * (100 - off)) / 100;
  $('ad-total').innerHTML = `Total: <b>${euros(total)}</b> + IVA por ${months} ${months === 1 ? 'mes' : 'meses'}` +
    (off ? ` (${euros(Math.round(total / months * 100) / 100)}/mes, ${off} % de descuento)` : '');
}

function renderType() {
  document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
  const t = tarifas[type];
  $('preview-type').textContent = t ? `${t.nombre}: ${t.descripcion}` : '';
  $('preview').classList.toggle('is-compact', type !== 'lugar');
  renderTotal();
  renderPreview();
}

// ---------- 2. Ubicación ----------
const params = new URLSearchParams(location.search);
const startLat = Number(params.get('lat')) || 40.4168;
const startLng = Number(params.get('lng')) || -3.7038;
const map = L.map('ad-map', { scrollWheelZoom: false }).setView([startLat, startLng], params.get('lat') ? 15 : 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a>',
}).addTo(map);
const pinIcon = L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [28, 36], iconAnchor: [14, 36] });
let marker: L.Marker | undefined;

function setPoint(lat: number, lng: number) {
  point = { lat, lng };
  if (!marker) {
    marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
    marker.on('dragend', () => { const p = marker!.getLatLng(); setPoint(p.lat, p.lng); });
  } else marker.setLatLng([lat, lng]);
  $('ad-coords').textContent = `Ubicación: ${lat.toFixed(5)}, ${lng.toFixed(5)}. Puedes arrastrar el marcador para ajustarla.`;
}
map.on('click', (e: L.LeafletMouseEvent) => setPoint(e.latlng.lat, e.latlng.lng));

async function searchAddress() {
  const q = $<HTMLInputElement>('ad-search').value.trim();
  if (!q) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(q)}`;
    const [hit] = await (await fetch(url)).json();
    if (!hit) { $('ad-coords').textContent = 'No encontré esa dirección. Prueba a hacer clic en el mapa.'; return; }
    map.setView([+hit.lat, +hit.lon], 18);
    setPoint(+hit.lat, +hit.lon);
  } catch {
    $('ad-coords').textContent = 'La búsqueda no está disponible. Haz clic en el mapa para marcar la ubicación.';
  }
}
$('ad-search-btn').onclick = searchAddress;
$('ad-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } });

// ---------- 3. Anuncio y vista previa ----------
const preview = $('preview');
const preview3d = AdPreview3D.create($<HTMLCanvasElement>('preview-3d'), preview);
function renderPreview() {
  preview3d?.set(type, $<HTMLInputElement>('ad-color').value, {
    color2: value('ad-color2'), basket: value('ad-basket'), banner: value('ad-banner') || value('ad-name'), bannerColor: value('ad-banner-color'),
  });
  $('ad-banner-field').hidden = type !== 'avioneta';
  // Colores según el tipo: el principal cambia de nombre y el globo y la avioneta tienen colores extra.
  $('ad-color-label').textContent = { lugar: 'Color de tu recuadro', globo: 'Color principal del globo', ovni: 'Color del ovni', avioneta: 'Color de la avioneta' }[type];
  $('ad-extra-colors').hidden = type !== 'globo' && type !== 'avioneta';
  document.querySelectorAll<HTMLElement>('#ad-extra-colors [data-for]').forEach((f) => (f.hidden = f.dataset.for !== type));
  const name = $<HTMLInputElement>('ad-name').value.trim();
  $('preview-name').textContent = name || 'Tu negocio';
  preview.style.setProperty('--brand', $<HTMLInputElement>('ad-color').value);
  const img = $<HTMLImageElement>('preview-img');
  img.parentElement!.hidden = !photos.length;
  if (photos.length) img.src = URL.createObjectURL(photos[0]);
  $('ad-text-count').textContent = String($<HTMLTextAreaElement>('ad-text').value.length);
}
['ad-name', 'ad-text', 'ad-color', 'ad-banner', 'ad-color2', 'ad-basket', 'ad-banner-color'].forEach((id) => $(id).addEventListener('input', renderPreview));

const swatches = $('ad-swatches');
for (const c of COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = c;
  b.setAttribute('aria-label', `Color ${c}`);
  b.onclick = () => { $<HTMLInputElement>('ad-color').value = c; renderPreview(); };
  swatches.append(b);
}

$('ad-photos').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  const valid = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= MAX_BYTES);
  photos = valid.slice(0, MAX_PHOTOS);
  const list = $('ad-photo-list');
  list.innerHTML = '';
  for (const f of photos) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.alt = '';
    list.append(img);
  }
  $('ad-error').textContent = valid.length < files.length || files.length > MAX_PHOTOS
    ? `Solo se admiten ${MAX_PHOTOS} fotos JPG, PNG o WebP de menos de 2 MB. Se han descartado las demás.`
    : '';
  renderPreview();
});

// ---------- 4. Envío ----------
const slug = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const readAsDataUrl = (f: File) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });

const customer = () => document.querySelector<HTMLInputElement>('input[name="cliente"]:checked')?.value ?? 'empresa';
document.querySelectorAll('input[name="cliente"]').forEach((i) => i.addEventListener('change', () => {
  $('ad-withdraw-row').hidden = customer() !== 'particular';
}));
$('ad-months').addEventListener('change', renderTotal);

function value(id: string) {
  return ($(id) as HTMLInputElement).value.trim();
}

/** Entrada lista para pegar en public/data/anunciantes.json (las fotos se guardan en public/anunciantes/). */
function buildEntry() {
  const id = `${slug(value('ad-name'))}-${Date.now().toString(36)}`;
  const months = Number(value('ad-months'));
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  return {
    id, name: value('ad-name'), type, lat: +point!.lat.toFixed(6), lng: +point!.lng.toFixed(6),
    color: value('ad-color'), description: value('ad-desc') || undefined, text: value('ad-text') || undefined,
    tags: value('ad-tags').split(',').map((t) => t.trim()).filter(Boolean),
    banner: type === 'avioneta' ? value('ad-banner') || undefined : undefined,
    bannerColor: type === 'avioneta' ? value('ad-banner-color') : undefined,
    color2: type === 'globo' ? value('ad-color2') : undefined,
    basket: type === 'globo' ? value('ad-basket') : undefined,
    images: photos.map((f, i) => `anunciantes/${id}-${i + 1}.${f.type.split('/')[1].replace('jpeg', 'jpg')}`),
    link: value('ad-link') || undefined, cta: value('ad-cta'), until: until.toISOString().slice(0, 10),
  };
}

function validate(): string {
  if (!point) return 'Marca la ubicación en el mapa.';
  if (!value('ad-name')) return 'Escribe el nombre del negocio.';
  const link = value('ad-link');
  if (link && !/^https?:\/\/.+\..+/.test(link)) return 'El enlace debe empezar por https://';
  if (!value('ad-contact')) return 'Indica una persona de contacto.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value('ad-email'))) return 'Escribe un email válido.';
  if (!value('ad-nif')) return 'Indica el NIF, CIF o DNI para la factura.';
  if (customer() === 'particular' && !$<HTMLInputElement>('ad-withdraw').checked) return 'Para publicar el anuncio dentro del plazo de desistimiento, marca la casilla correspondiente.';
  if (!$<HTMLInputElement>('ad-accept').checked) return 'Debes aceptar las condiciones y la política de privacidad.';
  return '';
}

$('ad-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = validate();
  $('ad-error').textContent = error;
  if (error) return;
  const entry = buildEntry();
  const contact: Record<string, string> = {
    contacto: value('ad-contact'), email: value('ad-email'), telefono: value('ad-phone'), nif: value('ad-nif'), meses: value('ad-months'),
    cliente: customer(), total: $('ad-total').textContent ?? '',
  };
  // Constancia de la solicitud expresa del consumidor (art. 98.8 y 108.3 TRLGDCU).
  if (contact.cliente === 'particular') contact.desistimiento = `Pide la ejecución inmediata y acepta pagar la parte proporcional si desiste (${new Date().toISOString()})`;
  const submit = $<HTMLButtonElement>('ad-submit');
  submit.disabled = true;
  submit.textContent = 'Enviando…';

  let sent = false;
  if (FORM_ENDPOINT) {
    const form = new FormData();
    form.append('_subject', `Anuncio FlyFly: ${entry.name} (${type})`);
    form.append('_template', 'table');
    form.append('_captcha', 'false');
    form.append('anuncio', JSON.stringify(entry, null, 2));
    Object.entries(contact).forEach(([k, v]) => form.append(k, v));
    photos.forEach((f, i) => form.append(`foto${i + 1}`, f, entry.images[i].split('/').pop()));
    try {
      const res = await fetch(FORM_ENDPOINT, { method: 'POST', body: form, headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      sent = res.ok && String(data.success) !== 'false';
    } catch { /* se ofrece el envío por email */ }
  }
  submit.disabled = false;
  submit.textContent = 'Enviar solicitud';
  track('solicitud-anuncio', { tipo: type, envio: sent ? 'formulario' : 'email' });
  showDone(entry, contact, sent);
});

async function showDone(entry: ReturnType<typeof buildEntry>, contact: Record<string, string>, sent: boolean) {
  $('ad-form').hidden = true;
  $('ad-done').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const owner = (window as any).TITULAR?.email as string | undefined;
  const pay = $<HTMLAnchorElement>('ad-pay');
  const payLink = tarifas[type]?.pago;
  if (sent) {
    $('ad-done-text').textContent = 'Hemos recibido tu solicitud. La revisaremos y te escribiremos al email que nos has dado.' +
      (payLink ? ' Si quieres, puedes dejar el pago hecho ya: no se publicará hasta que la aprobemos.' : '');
    if (payLink) {
      pay.hidden = false;
      pay.href = `${payLink}?${new URLSearchParams({ prefilled_email: contact.email, client_reference_id: entry.id })}`;
    }
    return;
  }
  // Sin servicio de formularios: email con los datos y descarga de la solicitud completa (con fotos).
  $('ad-done-text').textContent = 'Envíanos tu solicitud por email. Descarga también el archivo con tus fotos y adjúntalo al correo.';
  const mail = $<HTMLAnchorElement>('ad-mail');
  if (owner && owner.includes('@')) {
    mail.hidden = false;
    const body = `Solicitud de anuncio en FlyFly\n\n${JSON.stringify({ ...entry, contacto: contact }, null, 2)}\n\nAdjunto el archivo de la solicitud con las fotos.`;
    mail.href = `mailto:${owner}?subject=${encodeURIComponent(`Anuncio FlyFly: ${entry.name}`)}&body=${encodeURIComponent(body)}`;
  }
  const download = $('ad-download');
  download.hidden = false;
  download.onclick = async () => {
    const files = await Promise.all(photos.map(readAsDataUrl));
    const blob = new Blob([JSON.stringify({ anuncio: entry, contacto: contact, fotos: files }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `solicitud-flyfly-${entry.id}.json`;
    a.click();
  };
}

if (params.get('ciudad')) $<HTMLInputElement>('ad-search').value = params.get('ciudad')!;
loadTarifas();
renderPreview();
