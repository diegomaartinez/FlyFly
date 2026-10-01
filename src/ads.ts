/**
 * Publicidad con Google AdSense, desactivada mientras no se configure VITE_ADSENSE_CLIENT.
 * El consentimiento (RGPD) lo gestiona el aviso certificado de Google ("Privacidad y mensajes" en AdSense),
 * obligatorio para mostrar anuncios en el Espacio Económico Europeo: no hace falta otro banner.
 */
const client: string | undefined = import.meta.env.VITE_ADSENSE_CLIENT || undefined; // ca-pub-XXXXXXXXXXXXXXXX
const sheetSlot: string | undefined = import.meta.env.VITE_ADSENSE_SLOT_FICHA || undefined;

export const adsEnabled = Boolean(client && sheetSlot);
let loaded = false;
let lastShown = 0;

function loadScript() {
  if (loaded || !client) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
  document.head.append(s);
}

/** Muestra un anuncio en el contenedor (como mucho uno nuevo por minuto, para no saturar). */
export function showAd(container: HTMLElement) {
  if (!adsEnabled) return;
  container.hidden = false;
  if (Date.now() - lastShown < 60_000 && container.querySelector('ins')) return;
  lastShown = Date.now();
  loadScript();
  container.querySelector('ins')?.remove();
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = client;
  ins.dataset.adSlot = sheetSlot;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  container.append(ins);
  try {
    ((window as any).adsbygoogle ||= []).push({});
  } catch { /* bloqueador de anuncios o sin consentimiento */ }
}

/** Reabre el aviso de consentimiento de Google para cambiar la decisión. */
export function manageConsent(): boolean {
  const fc = (window as any).googlefc;
  if (!fc) return false;
  fc.callbackQueue.push(fc.showRevocationMessage);
  return true;
}
