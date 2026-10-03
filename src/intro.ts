/**
 * Animación del menú principal: la Tierra gira despacio y el ovni se acerca por la derecha.
 * Al despegar, el ovni "arranca motores" (vibra, gira más rápido y destella) y viaja entre nubes
 * que pasan a toda velocidad mientras se cargan los datos y la ciudad; después vuela con la cámara
 * hasta la ciudad (5-7 s). Cesium precarga las teselas
 * del destino durante el vuelo, así que al llegar el mapa ya está casi listo.
 */
import {
  Billboard, BillboardCollection, Camera, Cartesian3, CesiumWidget, Color, ColorBlendMode, Ellipsoid, HeadingPitchRange,
  Math as CMath, Matrix3, Matrix4,
} from '@cesium/engine';
import { Craft } from './flight';

type Phase = 'off' | 'idle' | 'warmup' | 'flight';

/** Vista inicial: la Tierra entera con Europa y África en el centro. */
export const HOME = Cartesian3.fromDegrees(-12, 28, 21_000_000);

const RIGHT = 0.3; // posición horizontal del ovni en el menú (proporción de la distancia a la cámara)
const NEAR = 70; // distancia final del ovni a la cámara en el menú (m)
const FAR = 1200; // distancia desde la que llega al cargar la página (m)
const TILT = 0.32; // inclinación hacia la cámara para que se vea la cúpula (igual que en el juego)
const GLOW = Color.fromCssColorString('#7ff0ff');

// Nubes del viaje: se colocan respecto a la cámara y se acercan a toda velocidad (la cámara no se mueve).
const CLOUDS = 56;
const CLOUD_FAR = 950; // m: aparecen aquí…
const CLOUD_NEAR = 12; // …y desaparecen al pasar junto a la cámara
const CLOUD_SPEED = 420; // m/s

/** Textura de nube: varias bolas blancas difuminadas (tres variantes). */
function cloudTexture(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // Bolas siempre dentro del lienzo (si no, se ve el borde recto de la imagen al girarla).
  for (let i = 0; i < 9; i++) {
    const r = 34 + rnd() * 40, x = r + 8 + rnd() * (240 - 2 * r), y = 128 + (rnd() * 2 - 1) * (112 - r) * 0.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(248,251,255,0.8)');
    grad.addColorStop(1, 'rgba(230,240,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

interface Cloud { b: Billboard; x: number; y: number; z: number; size: number }

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

export class IntroScene {
  private phase: Phase = 'off';
  private t0 = 0; // inicio del menú (reloj, ms)
  private spin = 0;
  private spinRate = 0.8;
  private flight = { start: 0, duration: 6 };
  private done: Promise<void> = Promise.resolve();
  private finish: () => void = () => {};
  private arrived = false;
  private last = performance.now();
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly scratch: Camera;
  private readonly m = new Matrix4();
  private readonly rot = new Matrix3();
  private readonly v = { pos: new Cartesian3(), up: new Cartesian3(), x: new Cartesian3(), y: new Cartesian3(), tmp: new Cartesian3(), n: new Cartesian3() };

  private readonly clouds: Cloud[] = [];
  private readonly cloudLayer = new BillboardCollection();
  private cloudLevel = 0; // 0-1: intensidad de las nubes (aparecen y se desvanecen suavemente)

  constructor(private viewer: CesiumWidget, private ufo: Craft) {
    this.scratch = new Camera(viewer.scene);
    viewer.scene.primitives.add(this.cloudLayer);
    const textures = [1, 2, 3].map(cloudTexture);
    for (let i = 0; i < CLOUDS; i++) {
      const cloud: Cloud = { b: this.cloudLayer.add({ position: Cartesian3.ZERO, image: textures[i % 3], sizeInMeters: true, show: false }), x: 0, y: 0, z: 0, size: 0 };
      this.respawn(cloud, CLOUD_NEAR + Math.random() * (CLOUD_FAR - CLOUD_NEAR));
      this.clouds.push(cloud);
    }
    viewer.scene.preRender.addEventListener(() => this.tick());
  }

  /** Nueva nube a `z` metros, repartida por la vista (más abierta cuanto más lejos). */
  private respawn(c: Cloud, z = CLOUD_FAR) {
    c.z = z;
    c.x = (Math.random() * 2 - 1) * z * 0.75;
    c.y = (Math.random() * 2 - 1) * z * 0.45;
    c.size = 90 + Math.random() * 150;
    c.b.rotation = Math.random() * Math.PI * 2;
  }

  /** Mueve las nubes hacia la cámara y las coloca delante de ella. */
  private updateClouds(dt: number, target: number) {
    this.cloudLevel += (target - this.cloudLevel) * Math.min(1, 1.6 * dt);
    const visible = this.cloudLevel > 0.01;
    const { camera } = this.viewer;
    const { pos, tmp } = this.v;
    for (const c of this.clouds) {
      c.b.show = visible;
      if (!visible) continue;
      c.z -= CLOUD_SPEED * dt;
      if (c.z < CLOUD_NEAR) this.respawn(c);
      Cartesian3.multiplyByScalar(camera.directionWC, c.z, pos);
      Cartesian3.add(camera.positionWC, pos, pos);
      Cartesian3.add(pos, Cartesian3.multiplyByScalar(camera.rightWC, c.x, tmp), pos);
      Cartesian3.add(pos, Cartesian3.multiplyByScalar(camera.upWC, c.y, tmp), pos);
      c.b.position = pos;
      c.b.width = c.b.height = c.size;
      // Entran difuminadas desde lejos y se desvanecen al pasar junto a la cámara.
      const fade = Math.min(1, (CLOUD_FAR - c.z) / 260, (c.z - CLOUD_NEAR) / 70);
      c.b.color = Color.WHITE.withAlpha(Math.max(0, fade) * 0.85 * this.cloudLevel, c.b.color);
    }
  }

  /** Menú principal. `rotateAfter`: segundos antes de empezar a girar la Tierra (si la cámara aún está volando). */
  showIdle(rotateAfter = 0) {
    this.phase = 'idle';
    this.t0 = performance.now() + rotateAfter * 1000;
    this.spinRate = 0.8;
    this.glow(0);
  }

  /** Arranque de motores mientras se cargan los datos de la ciudad. */
  warmup() {
    if (this.phase === 'off') this.t0 = performance.now() - 10_000; // ya estaba en una ciudad: sin la llegada desde lejos
    this.phase = 'warmup';
  }

  /**
   * Prepara el vuelo hasta la posición de juego sobre la ciudad sin moverse todavía: el vuelo de la
   * cámara queda "en pausa" al principio, y mientras tanto Cesium descarga las teselas del destino
   * (precarga de destinos de vuelo). Cuando estén, `launch()` lo pone en marcha.
   */
  prepare(lat: number, lng: number, height: number, view: { heading: number; pitch: number; range: number }) {
    const { camera } = this.viewer;
    this.scratch.lookAt(Cartesian3.fromDegrees(lng, lat, height), new HeadingPitchRange(view.heading, view.pitch, view.range));
    const destination = Cartesian3.clone(this.scratch.positionWC);
    const orientation = { heading: this.scratch.heading, pitch: this.scratch.pitch, roll: this.scratch.roll };
    this.scratch.lookAtTransform(Matrix4.IDENTITY);
    camera.lookAtTransform(Matrix4.IDENTITY);
    const duration = this.still ? 1.5 : Cartesian3.distance(camera.positionWC, destination) > 3_000_000 ? 6.5 : 5;
    this.flight = { start: Infinity, duration };
    this.arrived = false;
    this.done = new Promise((resolve) => (this.finish = resolve));
    // La duración del vuelo de Cesium es solo un máximo: el avance real lo marca `flightProgress`.
    camera.flyTo({
      destination, orientation, duration: 3600,
      easingFunction: () => this.flightProgress(performance.now()),
      complete: () => this.finish(), cancel: () => this.finish(),
    });
  }

  /** Arranca el vuelo preparado (5-7 s). Se resuelve al llegar o si se cancela (p. ej. al volver al menú). */
  launch(): Promise<void> {
    this.flight.start = performance.now();
    this.phase = 'flight';
    this.glow(0);
    return this.done;
  }

  /** Fin de la animación: el ovni pasa a manos del juego. */
  stop() {
    this.phase = 'off';
    this.glow(0);
  }

  /** Avance del vuelo (0-1, suavizado) según el reloj, igual que el vuelo de la cámara. */
  private flightProgress(now: number) {
    return ease(Math.min(1, Math.max(0, (now - this.flight.start) / 1000 / this.flight.duration)));
  }

  /**
   * Destello de los motores (0-1). `light`: aclarado del casco, que en el espacio refleja el negro
   * y se ve oscuro; se desvanece al llegar a la ciudad.
   */
  private glow(amount: number, light = 0) {
    const model = this.ufo.mesh;
    if (!model) return;
    model.silhouetteColor = GLOW;
    model.silhouetteSize = amount * 3;
    model.color = Color.WHITE;
    model.colorBlendMode = ColorBlendMode.MIX;
    model.colorBlendAmount = Math.min(0.6, light + amount * 0.3);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const model = this.ufo.mesh;
    // Nubes: durante el arranque y la carga; se desvanecen al empezar el vuelo (y sin "reducir movimiento").
    const flightT = this.phase === 'flight' ? (now - this.flight.start) / 1000 : 0;
    this.updateClouds(dt, !this.still && (this.phase === 'warmup' || (this.phase === 'flight' && flightT < 0.6)) ? 1 : 0);
    if (this.phase === 'off' || !model) return;
    const { camera } = this.viewer;

    // Distancia y posición en pantalla del ovni respecto a la cámara (se interpolan durante el vuelo).
    let dist = NEAR, right = RIGHT, shake = 0, glow = 0, light = 0.45;
    if (this.phase === 'idle') {
      // La Tierra gira despacio (solo con la cámara en el espacio y quieta).
      const t = (now - this.t0) / 1000;
      if (t > 0 && !this.still && Cartesian3.magnitude(camera.positionWC) > 10_000_000) camera.rotate(Cartesian3.UNIT_Z, -0.035 * dt);
      dist = this.still ? NEAR : FAR + (NEAR - FAR) * ease(Math.min(1, Math.max(0, t) / 3.5));
      this.spinRate += (0.8 - this.spinRate) * Math.min(1, dt);
    } else if (this.phase === 'warmup') {
      this.spinRate += (6 - this.spinRate) * Math.min(1, 1.5 * dt);
      shake = this.still ? 0 : 0.35;
      glow = 0.5 + 0.5 * Math.sin(now / 90);
    } else {
      const p = this.flightProgress(now);
      if (p >= 1 && !this.arrived) {
        // Llegada: se termina el vuelo de la cámara (queda en el destino) fuera de este fotograma.
        this.arrived = true;
        this.finish();
        setTimeout(() => camera.cancelFlight());
      }
      const range = this.ufo.chaseView.range;
      dist = NEAR + (range - NEAR) * p;
      right = RIGHT * (1 - p);
      light = 0.45 * (1 - p);
      this.spinRate += (0.8 - this.spinRate) * Math.min(1, 0.6 * dt);
    }
    this.spin += this.spinRate * dt;
    this.glow(glow, light);

    // Posición: delante de la cámara, desplazado a la derecha y un poco abajo.
    const { pos, up, x, y, tmp, n } = this.v;
    Cartesian3.multiplyByScalar(camera.directionWC, dist, pos);
    Cartesian3.add(camera.positionWC, pos, pos);
    Cartesian3.add(pos, Cartesian3.multiplyByScalar(camera.rightWC, dist * right + Math.sin(now / 23) * shake, tmp), pos);
    Cartesian3.add(pos, Cartesian3.multiplyByScalar(camera.upWC, -dist * 0.03 + Math.cos(now / 29) * shake + Math.sin(now / 700) * 0.6, tmp), pos);

    // Orientación: cúpula hacia arriba e inclinada hacia la cámara; al final del vuelo, vertical del lugar.
    Cartesian3.multiplyByScalar(camera.upWC, Math.cos(TILT), up);
    Cartesian3.subtract(up, Cartesian3.multiplyByScalar(camera.directionWC, Math.sin(TILT), tmp), up);
    if (this.phase === 'flight') {
      const p = this.flightProgress(now);
      Ellipsoid.WGS84.geodeticSurfaceNormal(pos, n);
      Cartesian3.lerp(up, n, p, up);
    }
    Cartesian3.normalize(up, up);
    Cartesian3.subtract(camera.rightWC, Cartesian3.multiplyByScalar(up, Cartesian3.dot(camera.rightWC, up), tmp), x);
    Cartesian3.normalize(x, x);
    Cartesian3.cross(up, x, y);
    const m = Matrix4.fromArray([x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, up.x, up.y, up.z, 0, pos.x, pos.y, pos.z, 1], 0, this.m);
    Matrix3.fromRotationZ(this.spin + CMath.PI_OVER_TWO, this.rot);
    Matrix4.multiplyByMatrix3(m, this.rot, model.modelMatrix);
    model.show = true;
  }
}
