# ✈ FlyFly

Sobrevuela ciudades reales en 3D con una avioneta y acércate a los globos para descubrir sus lugares de interés.

## Arrancar

```bash
npm install
cp .env.example .env   # y rellena VITE_CESIUM_ION_TOKEN (ver abajo)
npm run dev
```

## Publicar en GitHub Pages

1. **Settings → Pages → Source:** *GitHub Actions*.
2. **Settings → Secrets and variables → Actions → New repository secret:** `VITE_CESIUM_ION_TOKEN` con tu token.
3. Cada push a `main` compila y publica en `https://<usuario>.github.io/FlyFly/`.

> El token acaba dentro del JavaScript público (es inevitable en una web sin servidor). En Cesium ion, restringe el token a la URL de tu GitHub Pages para que nadie pueda usarlo desde otro sitio.

## Calidad visual (gratis)

| Modo | Qué se ve | Cómo activarlo |
|---|---|---|
| **Fotorrealista vía Cesium ion** (recomendado) | Ciudades en 3D real (Google Photorealistic 3D Tiles), como Google Earth | Crea una cuenta gratuita en [ion.cesium.com](https://ion.cesium.com/tokens), añade el asset *Google Photorealistic 3D Tiles* desde *Asset Depot* y pon el token en `VITE_CESIUM_ION_TOKEN` |
| Fotorrealista con clave de Google | Lo mismo, facturado directamente por Google (con cuota gratuita mensual) | Activa *Map Tiles API* en Google Cloud y usa `VITE_GOOGLE_MAPS_API_KEY` |
| Libre (sin claves) | Ortofoto PNOA del IGN (España, ~25 cm/píxel) y Sentinel-2 en el resto, en plano | Nada |

`VITE_TILE_DETAIL` controla la nitidez de las teselas 3D (8 = alta, 16 = la de Cesium por defecto, más ligera).

> ⚠️ El plan gratuito de Cesium ion es para uso no comercial o de evaluación. Para la versión de ayuntamientos/negocios hará falta un plan comercial de Cesium o una clave de Google con facturación. Las atribuciones de Google/Cesium en pantalla son obligatorias: no las ocultes.

## Controles

| Teclado | Acción |
|---|---|
| ↑ ↓ | subir / bajar morro |
| ← → | alabear (girar) |
| W / S (o Shift / Ctrl) | acelerar / reducir |
| A / D | timón |
| C | cámara exterior / cabina |
| M | silenciar motor |
| Esc | cerrar ficha |

En móvil aparecen un joystick y botones táctiles. Se puede hacer clic en cualquier globo para abrir su ficha.

## Lugares de interés

- **Wikipedia en directo**: artículos geolocalizados con foto alrededor del avión (se van cargando al volar, en cualquier ciudad del mundo).
- **JSON curados** en `public/places/*.json` (formato de la versión anterior). Sirven para que un ayuntamiento controle su contenido y para marcar lugares patrocinados:

```json
{ "id": "bar_pepe", "name": "Bar Pepe", "lat": 43.37, "lng": -8.40,
  "description": "…", "photos": ["https://…"],
  "sponsor": { "tier": "gold", "cta": "Reservar mesa", "link": "https://…" } }
```

`scripts/scraper.py` (de la versión anterior) genera estos JSON desde Wikipedia sin conexión.

## Estructura

```
src/world.ts    visor Cesium, modo de teselas y geocodificación
src/flight.ts   física de vuelo y cámaras
src/pois.ts     carga de lugares, globos y distancias
src/main.ts     HUD, fichas, controles y bucle principal
src/sound.ts    sonido de motor sintetizado
src/cities.ts   ciudades predefinidas
```
