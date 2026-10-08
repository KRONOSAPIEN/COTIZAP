/**
 * Regenera el caso de prueba de la lectura de unifilares desde las reglas: despieza la lectura de
 * src/datos/unifilar_ejemplo.js con src/motor/unifilar.js y escribe docs/ejemplos/unifilar-caso-prueba.json, y el mismo JSON
 * en su bloque de docs/vision-unifilares.md. Uso: npm run caso:unifilar
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { crearMaestros } = require('../src/datos/maestros');
const UF = require('../src/motor/unifilar');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');

const RAIZ = path.join(__dirname, '..');
const { lectura, errores } = UF.leer(EJEMPLO);
if (errores.length) throw new Error(errores.join('\n'));
const bom = UF.despiezar(lectura, crearMaestros(), {});

// JSON compacto: cada elemento de una lista en un renglón mientras quepa
function enLinea(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(enLinea).join(', ')}]`;
  return `{ ${Object.keys(v).map((k) => `${JSON.stringify(k)}: ${enLinea(v[k])}`).join(', ')} }`;
}
function compacto(v, sangria, elemento) {
  const s = enLinea(v);
  if (s.length + sangria.length <= (elemento ? 330 : 250) || v === null || typeof v !== 'object') return s;
  const dentro = `${sangria}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => dentro + compacto(x, dentro, true)).join(',\n')}\n${sangria}]`;
  return `{\n${Object.keys(v).map((k) => `${dentro}${JSON.stringify(k)}: ${compacto(v[k], dentro)}`).join(',\n')}\n${sangria}}`;
}
const texto = compacto(bom, '');
fs.writeFileSync(path.join(RAIZ, 'docs/ejemplos/unifilar-caso-prueba.json'), `${texto}\n`);

// el bloque del documento que trae el caso de prueba (el único con despiece)
const doc = path.join(RAIZ, 'docs/vision-unifilares.md');
let cambios = 0;
const md = fs.readFileSync(doc, 'utf8').replace(/```json\n([\s\S]*?)\n```/g, (todo, cuerpo) => {
  let j = null;
  try { j = JSON.parse(cuerpo); } catch (e) { return todo; }
  if (!j || !Array.isArray(j.ductos_rectos)) return todo;
  cambios += 1;
  return `\`\`\`json\n${texto}\n\`\`\``;
});
if (cambios !== 1) throw new Error(`docs/vision-unifilares.md: se esperaba un bloque con el caso de prueba y hay ${cambios}.`);
fs.writeFileSync(doc, md);

const r = bom.resumen;
console.log(`Caso de prueba: ${r.estado}, ${r.conteo.ductos_rectos} tramos, ${r.conteo.accesorios} accesorios, ${r.conteo.aros} aros, ${r.conteo.menulas} ménsulas; alertas ${JSON.stringify(r.alertas)}.`);
