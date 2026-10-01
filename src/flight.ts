import { Cartesian3, HeadingPitchRange, HeadingPitchRoll, Math as CMath, Matrix4, Model, Transforms, Viewer } from 'cesium';

const R = 6378137;
const MAX_SPEED = 55; // m/s en horizontal
const MAX_LIFT = 25; // m/s en vertical
const TURN_RATE = 1.4; // rad/s
const RESPONSE = 2.2; // cuanto mayor, antes alcanza la velocidad deseada (y antes se detiene)
const MIN_CLEARANCE = 15; // metros sobre suelo/edificios
const MAX_ALTITUDE = 1500; // metros sobre el suelo
const START_ALTITUDE = 250;

/** Mandos normalizados entre -1 y 1. */
export interface Controls { forward: number; strafe: number; turn: number; lift: number }
export type CameraMode = 'chase' | 'drone';

/** Ovni que se mueve como un dron: flota en el sitio, avanza, se desplaza de lado, sube y baja. */
export class Craft {
  lat = 0; lng = 0; height = 0; // grados, metros
  heading = 0; // radianes, 0 = norte, sentido horario
  ground = 0;
  cameraMode: CameraMode = 'chase';
  private vel = { e: 0, n: 0, u: 0 }; // m/s
  private camHeading = 0;
  private time = 0;
  private model?: Model;

  constructor(private viewer: Viewer) {}

  async load(url: string) {
    this.model = await Model.fromGltfAsync({ url, scale: 2 });
    this.viewer.scene.primitives.add(this.model);
  }

  teleport(lat: number, lng: number, ground = 0) {
    this.lat = lat;
    this.lng = lng;
    this.ground = ground;
    this.height = ground + START_ALTITUDE;
    this.vel = { e: 0, n: 0, u: 0 };
  }

  get position() {
    return Cartesian3.fromDegrees(this.lng, this.lat, this.height);
  }

  get speed() {
    return Math.hypot(this.vel.e, this.vel.n, this.vel.u);
  }

  update(dt: number, c: Controls) {
    this.time += dt;
    this.heading = CMath.zeroToTwoPi(this.heading + c.turn * TURN_RATE * dt);

    // Velocidad deseada en coordenadas locales (este, norte, arriba) según el rumbo.
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const fwd = c.forward * MAX_SPEED, side = c.strafe * MAX_SPEED;
    const target = { e: fwd * sin + side * cos, n: fwd * cos - side * sin, u: c.lift * MAX_LIFT };
    const k = Math.min(1, RESPONSE * dt);
    this.vel.e += (target.e - this.vel.e) * k;
    this.vel.n += (target.n - this.vel.n) * k;
    this.vel.u += (target.u - this.vel.u) * k;

    this.lat += ((this.vel.n * dt) / R) * CMath.DEGREES_PER_RADIAN;
    this.lng += ((this.vel.e * dt) / (R * Math.cos(CMath.toRadians(this.lat)))) * CMath.DEGREES_PER_RADIAN;
    this.height += this.vel.u * dt;

    const floor = this.ground + MIN_CLEARANCE;
    if (this.height < floor) { this.height = floor; this.vel.u = Math.max(0, this.vel.u); }
    const ceiling = this.ground + MAX_ALTITUDE;
    if (this.height > ceiling) { this.height = ceiling; this.vel.u = Math.min(0, this.vel.u); }
  }

  /** Muestrea la altura del terreno/edificios bajo el ovni (llamar unas pocas veces por segundo). */
  sampleGround() {
    const scene = this.viewer.scene;
    const carto = scene.globe.ellipsoid.cartesianToCartographic(this.position);
    const h = scene.sampleHeightSupported
      ? scene.sampleHeight(carto, this.model ? [this.model] : [])
      : scene.globe.getHeight(carto);
    if (h !== undefined) this.ground = h;
  }

  render(dt: number) {
    const pos = this.position;
    if (this.model) {
      // Se inclina hacia donde se mueve y se balancea un poco al flotar.
      const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
      const fwd = (this.vel.e * sin + this.vel.n * cos) / MAX_SPEED;
      const side = (this.vel.e * cos - this.vel.n * sin) / MAX_SPEED;
      const bob = Math.sin(this.time * 2) * 0.6;
      const hpr = new HeadingPitchRoll(this.heading - CMath.PI_OVER_TWO, -fwd * 0.3, side * 0.3);
      const at = Cartesian3.fromDegrees(this.lng, this.lat, this.height + bob);
      Transforms.headingPitchRollToFixedFrame(at, hpr, undefined, undefined, this.model.modelMatrix);
      this.model.show = this.cameraMode === 'chase';
    }

    const camera = this.viewer.camera;
    const diff = CMath.negativePiToPi(this.heading - this.camHeading);
    this.camHeading += diff * Math.min(1, 4 * dt);
    if (this.cameraMode === 'chase') {
      camera.lookAt(pos, new HeadingPitchRange(this.camHeading, -0.22, 45));
    } else {
      // Cámara de dron: desde el propio ovni, mirando hacia delante y abajo.
      camera.lookAtTransform(Matrix4.IDENTITY);
      camera.setView({ destination: pos, orientation: { heading: this.camHeading, pitch: -0.5, roll: 0 } });
    }
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'chase' ? 'drone' : 'chase';
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }
}
