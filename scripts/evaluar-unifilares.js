/**
 * Mide qué tan bien se leyeron croquis unifilares (docs/vision-unifilares.md §12). Cada carpeta de croquis trae:
 *   obtenida.json  la lectura de Claude («Copiar la lectura de Claude» en Importar unifilar)
 *   esperada.json  la lectura corregida por el ingeniero (por ejemplo «Copiar el despiece en JSON» con todo respondido y revisado)
 * y, si se quiere, la foto. Uso: npm run evaluar:unifilares [-- carpeta]   (por omisión docs/evaluacion)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { crearMaestros } = require('../src/datos/maestros');
const E = require('../src/motor/unifilar_evaluacion');

const raiz = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'evaluacion'));
const M = crearMaestros();
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)} %`);
const carpetas = fs.readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
  .map((d) => path.join(raiz, d.name)).filter((c) => fs.existsSync(path.join(c, 'obtenida.json')) && fs.existsSync(path.join(c, 'esperada.json')));
if (!carpetas.length) {
  console.log(`No hay croquis en ${raiz}: cada carpeta lleva obtenida.json y esperada.json.`);
  process.exit(0);
}
const resultados = [];
console.log('Croquis | Nodos F1 | Aristas F1 | Ø | Cotas | Accesorios | Costo directo | Errores silenciosos | Cumple');
console.log('--- | --- | --- | --- | --- | --- | --- | --- | ---');
carpetas.forEach((c) => {
  const leer = (n) => fs.readFileSync(path.join(c, n), 'utf8');
  try {
    const r = E.comparar(leer('obtenida.json'), leer('esperada.json'), M);
    resultados.push(r);
    const m = r.metricas;
    console.log([path.basename(c), pct(m.nodos_f1), pct(m.aristas_f1), pct(m.diametros), pct(m.cotas), pct(m.accesorios),
      m.costo_dif === null ? '—' : `${m.costo_dif >= 0 ? '+' : ''}${(m.costo_dif * 100).toFixed(1)} %`, m.errores_silenciosos, r.todo ? 'sí' : 'no'].join(' | '));
    r.detalle.diferencias.forEach((d) => console.log(`  · ${d}`));
    r.detalle.silenciosos.forEach((d) => console.log(`  ! silencioso: ${d}`));
  } catch (e) {
    console.log(`${path.basename(c)} | no se pudo comparar: ${e.message}`);
  }
});
const s = E.resumir(resultados);
console.log(`\n${s.croquis} croquis. Costo directo a ±5 %: ${pct(s.costo_en_5pct)} (meta: 90 %). Errores silenciosos: ${s.silenciosos} (meta: 0).`);
Object.entries(s.por_meta).forEach(([k, v]) => console.log(`  ${k}: cumple en ${pct(v)} de los croquis`));
