/**
 * Estadísticas anónimas y sin cookies (opcional). Se activa con UNA de estas variables:
 *   VITE_UMAMI_ID (+ VITE_UMAMI_SRC si no usas Umami Cloud)  ·  VITE_PLAUSIBLE_DOMAIN  ·  VITE_CF_BEACON
 * Sin ninguna, no se carga nada. Umami y Plausible registran además los eventos de track()
 * (ciudad visitada, fichas de anunciantes abiertas, clics en su botón…); Cloudflare solo cuenta visitas.
 */
const env = import.meta.env;
const UMAMI_ID: string | undefined = env.VITE_UMAMI_ID || undefined;
const UMAMI_SRC: string = env.VITE_UMAMI_SRC || 'https://cloud.umami.is/script.js';
const PLAUSIBLE: string | undefined = env.VITE_PLAUSIBLE_DOMAIN || undefined;
const PLAUSIBLE_SRC: string = env.VITE_PLAUSIBLE_SRC || 'https://plausible.io/js/script.js';
const CF_BEACON: string | undefined = env.VITE_CF_BEACON || undefined;

function addScript(src: string, data: Record<string, string>) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  Object.entries(data).forEach(([k, v]) => s.setAttribute(`data-${k}`, v));
  document.head.append(s);
}

if (UMAMI_ID) addScript(UMAMI_SRC, { 'website-id': UMAMI_ID, 'do-not-track': 'true' });
else if (PLAUSIBLE) {
  // Cola para los eventos que lleguen antes de que cargue el script.
  (window as any).plausible ??= (...args: unknown[]) => ((window as any).plausible.q ??= []).push(args);
  addScript(PLAUSIBLE_SRC, { domain: PLAUSIBLE });
} else if (CF_BEACON) addScript('https://static.cloudflareinsights.com/beacon.min.js', { 'cf-beacon': JSON.stringify({ token: CF_BEACON }) });

const pending: [string, Record<string, string | number>][] = [];

/** Registra un evento anónimo (sin datos personales). No hace nada si no hay estadísticas configuradas. */
export function track(event: string, props: Record<string, string | number> = {}) {
  const w = window as any;
  if (UMAMI_ID) {
    if (w.umami) w.umami.track(event, props);
    else if (pending.push([event, props]) === 1) {
      let tries = 0;
      const flush = setInterval(() => {
        if (++tries > 30) { clearInterval(flush); pending.length = 0; } // bloqueado por el navegador
        if (!w.umami) return;
        clearInterval(flush);
        pending.splice(0).forEach(([e, p]) => w.umami.track(e, p));
      }, 1000);
    }
  } else if (PLAUSIBLE) w.plausible(event, { props });
}
