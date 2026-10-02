// Publica una solicitud descargada desde la página Anúnciate (solicitud-flyfly-*.json):
//   node scripts/importar-anuncio.mjs ruta/a/solicitud-flyfly-xxx.json
// Guarda las fotos en public/anunciantes/ y añade (o actualiza) el anuncio en public/data/anunciantes.json.
// Revisa siempre el contenido antes de publicarlo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/importar-anuncio.mjs solicitud-flyfly-xxx.json');
  process.exit(1);
}
const { anuncio, contacto, fotos = [] } = JSON.parse(readFileSync(file, 'utf8'));
const root = new URL('../public/', import.meta.url);

mkdirSync(new URL('anunciantes/', root), { recursive: true });
fotos.forEach((dataUrl, i) => {
  const path = anuncio.images?.[i];
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl ?? '');
  if (!path || !m) return;
  writeFileSync(new URL(path, root), Buffer.from(m[2], 'base64'));
  console.log(`Foto guardada: public/${path}`);
});

const listPath = new URL('data/anunciantes.json', root);
const list = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : [];
const clean = Object.fromEntries(Object.entries(anuncio).filter(([, v]) => v !== undefined && v !== ''));
// Importe mensual para ordenar el buscador: el precio de su tipo si no se indica otro (edítalo si cobraste distinto).
if (clean.pagado == null) {
  const tarifas = JSON.parse(readFileSync(new URL('data/tarifas.json', root), 'utf8'));
  clean.pagado = tarifas.tipos?.[clean.type]?.precioMes ?? 0;
}
const i = list.findIndex((a) => a.id === clean.id);
if (i >= 0) list[i] = clean;
else list.push(clean);
writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);

console.log(`Anuncio «${clean.name}» (${clean.type}) añadido a public/data/anunciantes.json, visible hasta ${clean.until}.`);
if (contacto) console.log(`Contacto: ${contacto.contacto} <${contacto.email}>, NIF ${contacto.nif}, ${contacto.meses} mes(es).`);
console.log('Revisa el texto, las fotos y la ubicación; después haz commit y push para publicarlo.');
