import { Cartesian3, HeadingPitchRange, HeadingPitchRoll, Math as CMath, Matrix4, Model, Transforms, Viewer } from 'cesium';

const R = 6378137;
const G = 9.81;
const MIN_SPEED = 35; // m/s (~68 kt), por debajo una avioneta entra en pérdida
const MAX_SPEED = 120; // m/s (~233 kt)
const MIN_CLEARANCE = 25; // metros sobre suelo/edificios

export interface Controls { pitch: number; roll: number; yaw: number; throttle: number }
export type CameraMode = 'chase' | 'cockpit';

export class Plane {
  lat = 0; lng = 0; height = 600; // grados, metros
  heading = 0; pitch = 0; roll = 0; // radianes (heading 0 = norte, horario)
  speed = 60;
  throttle = 0.4;
  ground = 0;
  cameraMode: CameraMode = 'chase';
  private camHeading = 0;
  private model?: Model;

  constructor(private viewer: Viewer) {}

  async load(url: string) {
    this.model = await Model.fromGltfAsync({ url, scale: 1.0 });
    this.viewer.scene.primitives.add(this.model);
  }

  teleport(lat: number, lng: number, headingDeg: number, height = 600) {
    const h = CMath.toRadians(headingDeg);
    // Aparece 3 km antes del centro para llegar volando hacia él.
    this.lat = lat - (3000 * Math.cos(h)) / R * CMath.DEGREES_PER_RADIAN;
    this.lng = lng - (3000 * Math.sin(h)) / (R * Math.cos(CMath.toRadians(lat))) * CMath.DEGREES_PER_RADIAN;
    this.height = height;
    this.heading = this.camHeading = h;
    this.pitch = this.roll = 0;
    this.speed = 60;
    this.ground = 0;
  }

  get position() {
    return Cartesian3.fromDegrees(this.lng, this.lat, this.height);
  }

  update(dt: number, c: Controls) {
    // Motor: la velocidad tiende a la marcada por el acelerador; subir cuesta velocidad y bajar la da.
    this.throttle = CMath.clamp(this.throttle + c.throttle * 0.5 * dt, 0, 1);
    const target = MIN_SPEED + this.throttle * (MAX_SPEED - MIN_SPEED);
    this.speed += ((target - this.speed) * 0.35 - G * Math.sin(this.pitch) * 0.6) * dt;
    this.speed = CMath.clamp(this.speed, MIN_SPEED * 0.8, MAX_SPEED * 1.15);

    // Alabeo y cabeceo con retorno suave a nivel cuando se sueltan los mandos.
    this.roll += c.roll * 1.3 * dt;
    if (!c.roll) this.roll -= this.roll * 1.2 * dt;
    this.roll = CMath.clamp(this.roll, -1.1, 1.1);
    this.pitch += c.pitch * 0.7 * dt;
    if (!c.pitch) this.pitch -= this.pitch * 0.4 * dt;
    this.pitch = CMath.clamp(this.pitch, -0.6, 0.6);

    // Viraje coordinado: la inclinación de alas produce el giro.
    this.heading += ((G * Math.tan(this.roll)) / this.speed + c.yaw * 0.25) * dt;
    this.heading = CMath.zeroToTwoPi(this.heading);

    const horiz = this.speed * Math.cos(this.pitch) * dt;
    this.lat += ((horiz * Math.cos(this.heading)) / R) * CMath.DEGREES_PER_RADIAN;
    this.lng += ((horiz * Math.sin(this.heading)) / (R * Math.cos(CMath.toRadians(this.lat)))) * CMath.DEGREES_PER_RADIAN;
    this.height += this.speed * Math.sin(this.pitch) * dt;

    const floor = this.ground + MIN_CLEARANCE;
    if (this.height < floor) {
      this.height = floor;
      this.pitch = Math.max(this.pitch, 0.08);
    }
    this.height = Math.min(this.height, 6000);
  }

  /** Muestrea la altura del terreno/edificios bajo el avión (llamar unas pocas veces por segundo). */
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
    const hpr = new HeadingPitchRoll(this.heading - CMath.PI_OVER_TWO, this.pitch, this.roll);
    if (this.model) {
      Transforms.headingPitchRollToFixedFrame(pos, hpr, undefined, undefined, this.model.modelMatrix);
      this.model.show = this.cameraMode === 'chase';
    }

    const camera = this.viewer.camera;
    if (this.cameraMode === 'chase') {
      // La cámara sigue el rumbo con algo de retardo, como una cámara de persecución.
      const diff = CMath.negativePiToPi(this.heading - this.camHeading);
      this.camHeading += diff * Math.min(1, 2.5 * dt);
      camera.lookAt(pos, new HeadingPitchRange(this.camHeading, -0.18 - this.pitch * 0.3, 70));
    } else {
      camera.lookAtTransform(Matrix4.IDENTITY);
      camera.setView({
        destination: pos,
        orientation: { heading: this.heading, pitch: this.pitch - 0.08, roll: this.roll },
      });
    }
  }

  toggleCamera() {
    this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }
}
