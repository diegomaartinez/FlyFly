import {
  Cartesian2, Cartesian3, Cartographic, CesiumWidget, Color, ColorBlendMode, HeadingPitchRoll, Math as CMath, Matrix3, Matrix4,
  Model, SceneTransforms, Transforms,
} from '@cesium/engine';
import { balloonUrl, BANNER_FONT, planeUrl } from './models';
import { distance, Poi } from './pois';
import { validHeight } from './world';

/** Formas de aparecer de los anunciantes (cada una con su tarifa). */
export type AdType = 'lugar' | 'globo' | 'ovni' | 'avioneta';

/** Anunciante tal y como se escribe en public/data/anunciantes.json. */
export interface Advertiser {
  id: string;
  name: string;
  type: AdType;
  lat: number;
  lng: number;
  /** Color del recuadro y del globo, ovni o avioneta (#rrggbb). */
  color?: string;
  /** Frase corta bajo el nombre. */
  description?: string;
  /** Texto de la ficha. */
  text?: string;
  /** Fotos (la primera es la principal). */
  images?: string[];
  link?: string;
  cta?: string;
  /** Último día visible (AAAA-MM-DD). */
  until?: string;
  /** Categoría y palabras clave para el buscador (p. ej. ["cafetería", "desayunos"]). */
  tags?: string[];
  /** Importe mensual que paga: ordena los resultados del buscador (si falta, el precio de su tipo). */
  pagado?: number;
  /** Texto de la pancarta de la avioneta (si falta, el nombre). */
  banner?: string;
}

const LABEL_DISTANCE = 3000; // las etiquetas se ven desde 3 km
const RADIUS = 8000; // anunciantes a menos de 8 km del centro de la ciudad

/** Anunciantes vigentes cerca de la ciudad. */
export async function loadAdvertisers(lat: number, lng: number): Promise<Advertiser[]> {
  try {
    const res = await fetch('data/anunciantes.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const list: Advertiser[] = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    return list.filter((a) => (!a.until || a.until >= today) && distance(a, { lat, lng }) < RADIUS);
  } catch {
    return [];
  }
}

/** Convierte un anunciante en un lugar para reutilizar la ficha. */
export function advertiserPoi(a: Advertiser): Poi {
  return {
    id: `ad_${a.id}`, name: a.name, lat: a.lat, lng: a.lng, description: a.description,
    image: a.images?.[0], thumb: a.images?.[0], body: a.text, gallery: a.images,
    sponsor: { tier: 'gold', cta: a.cta, link: a.link, color: a.color },
  };
}

interface Item {
  ad: Advertiser;
  poi: Poi;
  ground: number;
  model?: Model;
  el: HTMLButtonElement;
  phase: number;
  anchor: Cartesian3;
}

export class AdvertiserLayer {
  onSelect?: (poi: Poi) => void;
  /** Se llama una vez por anunciante y visita cuando el jugador lo tiene a la vista (para las estadísticas). */
  onSeen?: (ad: Advertiser) => void;
  private seen = new Set<string>();
  private items: Item[] = [];
  private time = 0;
  private win = new Cartesian2();
  private to = new Cartesian3();
  private spin = new Matrix3();

  constructor(private viewer: CesiumWidget, private container: HTMLElement) {}

  get pois(): Poi[] {
    return this.items.map((i) => i.poi);
  }

  /** Modelos 3D de los anunciantes: no deben contar como suelo al medir alturas. */
  get excluded(): object[] {
    return this.items.flatMap((i) => (i.model ? [i.model] : []));
  }

  clear() {
    for (const i of this.items) {
      i.el.remove();
      if (i.model) this.viewer.scene.primitives.remove(i.model);
    }
    this.items = [];
    this.seen.clear();
  }

  async add(list: Advertiser[], exclude: object[]) {
    const { scene } = this.viewer;
    // Altura del suelo de todos a la vez.
    let heights: number[] = [];
    try {
      const c = await scene.sampleHeightMostDetailed(list.map((a) => Cartographic.fromDegrees(a.lng, a.lat)), exclude);
      heights = c.map((x) => validHeight(x?.height));
    } catch { /* sin teselas: altura 0 */ }

    for (const [k, ad] of list.entries()) {
      const color = ad.color && /^#[0-9a-f]{6}$/i.test(ad.color) ? ad.color : '#e2602f';
      const item: Item = {
        ad, poi: advertiserPoi(ad), ground: heights[k] ?? 0, el: this.createLabel(ad, color),
        phase: Math.random() * Math.PI * 2, anchor: new Cartesian3(),
      };
      try {
        if (ad.type === 'globo') item.model = await Model.fromGltfAsync({ url: balloonUrl(color), scale: 1.5 });
        if (ad.type === 'avioneta') {
          await document.fonts?.load(BANNER_FONT).catch(() => undefined);
          item.model = await Model.fromGltfAsync({ url: planeUrl(color, ad.banner || ad.name), scale: 2 });
        }
        if (ad.type === 'ovni') {
          item.model = await Model.fromGltfAsync({
            url: 'models/ufo.glb', scale: 6,
            color: Color.fromCssColorString(color), colorBlendMode: ColorBlendMode.MIX, colorBlendAmount: 0.55,
          });
        }
      } catch { /* sin modelo: queda la etiqueta */ }
      if (item.model) scene.primitives.add(item.model);
      this.items.push(item);
    }
  }

  private createLabel(ad: Advertiser, color: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `marker is-found is-sponsor is-ad ${ad.type === 'lugar' ? '' : 'is-compact'}`;
    el.style.setProperty('--brand', color);
    el.innerHTML = `
      <span class="marker-card">
        <span class="marker-photo"><img alt="" decoding="async" /></span>
        <span class="marker-text"><b></b><small>Patrocinado</small></span>
      </span>
      <span class="marker-tail"></span>`;
    el.querySelector('b')!.textContent = ad.name;
    const img = el.querySelector('img')!;
    if (ad.images?.[0]) img.src = ad.images[0];
    else img.parentElement!.remove();
    el.setAttribute('aria-label', `${ad.name} (patrocinado)`);
    el.addEventListener('click', () => this.onSelect?.(this.items.find((i) => i.el === el)!.poi));
    this.container.append(el);
    return el;
  }

  /** Anima globos, ovnis y avionetas y coloca las etiquetas (llamar en cada fotograma). */
  render(dt: number) {
    this.time += dt;
    const { scene, camera } = this.viewer;
    for (const it of this.items) {
      const { ad } = it;
      const t = this.time + it.phase;
      let lat = ad.lat, lng = ad.lng, height = it.ground, labelUp = 35;
      if (ad.type === 'globo') { height += 160 + Math.sin(t * 0.4) * 6; labelUp = 40; }
      if (ad.type === 'ovni') { height += 120 + Math.sin(t * 1.2) * 3; labelUp = 22; }
      let heading = 0, roll = 0;
      if (ad.type === 'avioneta') {
        // Vuelta completa cada ~70 s a 350 m del punto, en sentido horario (visto desde arriba).
        const R = 350, w = (2 * Math.PI) / 70, a = t * w;
        lat += (R * Math.cos(a)) / 111320;
        lng += (R * Math.sin(a)) / (111320 * Math.cos((ad.lat * Math.PI) / 180));
        height += 220;
        heading = a + Math.PI / 2; // tangente al círculo
        roll = 0.3; // inclinada hacia el centro del giro
        labelUp = 12;
      }
      const pos = Cartesian3.fromDegrees(lng, lat, height);
      if (it.model) {
        const hpr = new HeadingPitchRoll(heading - CMath.PI_OVER_TWO, 0, roll);
        Transforms.headingPitchRollToFixedFrame(pos, hpr, undefined, undefined, it.model.modelMatrix);
        if (ad.type !== 'avioneta') {
          Matrix3.fromRotationZ(t * (ad.type === 'ovni' ? 0.6 : 0.08), this.spin);
          Matrix4.multiplyByMatrix3(it.model.modelMatrix, this.spin, it.model.modelMatrix);
        }
      }

      // Etiqueta HTML encima del objeto.
      Cartesian3.fromDegrees(lng, lat, height + labelUp, undefined, it.anchor);
      const to = Cartesian3.subtract(it.anchor, camera.positionWC, this.to);
      const d = Cartesian3.magnitude(to);
      const win = d < LABEL_DISTANCE && Cartesian3.dot(to, camera.directionWC) > 0
        ? SceneTransforms.worldToWindowCoordinates(scene, it.anchor, this.win)
        : undefined;
      if (!win) {
        it.el.style.visibility = 'hidden';
        continue;
      }
      const scale = Math.min(1, Math.max(0.85, 500 / d));
      it.el.style.visibility = '';
      it.el.style.transform = `translate3d(${win.x.toFixed(1)}px, ${win.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      it.el.style.zIndex = String(100000 - Math.round(d));
      if (d < 1500 && !this.seen.has(ad.id)) { this.seen.add(ad.id); this.onSeen?.(ad); }
    }
  }
}
