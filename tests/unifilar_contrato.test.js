/**
 * Contrato de la lectura de unifilares (docs/vision-unifilares.md): el caso de prueba cumple el esquema
 * (docs/unifilar-bom.schema.json), su red es un árbol consistente, su despiece cuadra con el motor de COTIZAP, es el que
 * dan las reglas a la lectura del ejemplo y el documento trae el esquema y el caso tal como están en sus archivos.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const SOP = require('../src/motor/soportes');
const R = require('../src/motor/rapida');
const UF = require('../src/motor/unifilar');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');
const CAD = require('../src/motor/unifilar_cad');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const ESQUEMA = JSON.parse(leer('docs/unifilar-bom.schema.json'));
const CASO = JSON.parse(leer('docs/ejemplos/unifilar-caso-prueba.json'));
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);

/** Validador mínimo de JSON Schema: $ref, type, enum, required, properties, additionalProperties, items, anyOf, minimum, maximum, pattern. */
function validar(v, s, ruta, errores) {
  if (s.$ref) return validar(v, s.$ref.split('/').slice(1).reduce((o, k) => o[k], ESQUEMA), ruta, errores);
  if (s.anyOf) {
    if (!s.anyOf.some((alt) => { const e = []; validar(v, alt, ruta, e); return !e.length; })) errores.push(`${ruta}: no cumple ninguna alternativa`);
    return errores;
  }
  const tipos = s.type === undefined ? null : [].concat(s.type);
  const tipoDe = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
  if (tipos && !tipos.some((t) => t === tipoDe(v) || (t === 'number' && tipoDe(v) === 'integer'))) { errores.push(`${ruta}: tipo ${tipoDe(v)}, se esperaba ${tipos}`); return errores; }
  if (s.enum && !s.enum.includes(v)) errores.push(`${ruta}: ${JSON.stringify(v)} no está en ${JSON.stringify(s.enum)}`);
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errores.push(`${ruta}: ${v} < ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errores.push(`${ruta}: ${v} > ${s.maximum}`);
  }
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) errores.push(`${ruta}: «${v}» no cumple ${s.pattern}`);
  if (Array.isArray(v) && s.items) v.forEach((x, i) => validar(x, s.items, `${ruta}[${i}]`, errores));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    (s.required || []).forEach((k) => { if (!(k in v)) errores.push(`${ruta}: falta ${k}`); });
    Object.keys(v).forEach((k) => {
      if (s.properties && s.properties[k]) validar(v[k], s.properties[k], `${ruta}.${k}`, errores);
      else if (s.additionalProperties === false) errores.push(`${ruta}: sobra ${k}`);
    });
  }
  return errores;
}

test('El despiece que sale del dibujo del unifilar también cumple el esquema (textos de origen USUARIO, equipos y uniones)', () => {
  const M = crearMaestros();
  // el ejemplo dibujado y otro con lo que el ejemplo no tiene: bajada, máquina con brida y boca, extremo abierto, accesorios pegados
  let m = CAD.agregarTramo(CAD.nuevo(M), M, 'N-001', { dir: 'H', az_deg: 0, largo_mm: 6000, D_in: 12 }).modelo;
  m = CAD.injertar(m, M, 'A-001', 3000, { az_deg: 45, largo_mm: 650, D_in: 8 }).modelo;
  m = CAD.agregarTramo(m, M, 'N-004', { dir: 'H', az_deg: 90, largo_mm: 2000, D_in: 8 }).modelo;
  m = CAD.agregarTramo(m, M, 'N-005', { dir: 'BAJA', largo_mm: 2500, D_in: 8 }).modelo;
  m = CAD.ponerEquipo(m, 'N-006', 'MAQUINA_BRIDA').modelo;
  m = CAD.editarEquipo(m, 'EQ-02', { boca_in: 6 });
  m = CAD.ponerEquipo(m, 'N-002', 'ABIERTO').modelo; // el final del tronco
  m = CAD.aplicarRespuestas(m, M, { 'A-003': { encimado: 'UNION' } });
  [CAD.dibujoEjemplo(M), m].forEach((dibujo, i) => {
    const { lectura, respuestas } = CAD.aLectura(dibujo, M, { fecha: '2026-10-09T00:00:00Z' });
    const bom = UF.despiezar(lectura, M, respuestas);
    assert.deepEqual(validar(bom, ESQUEMA, '$', []), [], `dibujo ${i}`);
    assert.ok(bom.red.textos.every((t) => t.origen === 'USUARIO' && t.tipo === 'ANGULO'));
  });
  const bom = UF.despiezar(CAD.aLectura(m, M, {}).lectura, M, CAD.aLectura(m, M, {}).respuestas);
  assert.ok(bom.elementos_union.some((j) => j.tipo === 'UNION_ENGARGOLADA'), 'los accesorios pegados');
  assert.ok(bom.accesorios.some((a) => a.tipo === 'REDUCCION' && a.nodo_id === 'N-006'), 'la reducción a la boca de 6″');
});

/** Los bloques ```json de un documento Markdown. */
const bloquesJson = (md) => [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('El caso de prueba cumple el esquema de salida', () => {
  assert.deepEqual(validar(CASO, ESQUEMA, '$', []), []);
  // y el validador sí rechaza lo que no cumple
  const malo = JSON.parse(JSON.stringify(CASO));
  malo.ductos_rectos[0].posicion = 'DIAGONAL';
  malo.accesorios[0].extra = 1;
  delete malo.resumen.estado;
  malo.red.textos[0].confianza_ocr = 1.2;
  const e = validar(malo, ESQUEMA, '$', []);
  assert.equal(e.length, 4, e.join('\n'));
});

test('La lectura (lo que llena el modelo multimodal) es apta para salidas estructuradas: objetos cerrados, todo requerido y sin recursión', () => {
  const lectura = ['metadatos', 'red', 'equipos', 'alertas_ambiguedad'];
  const vistos = new Set();
  const recorrer = (s, pila, ruta) => {
    if (s.$ref) {
      assert.ok(!pila.includes(s.$ref), `recursión en ${ruta}`);
      vistos.add(s.$ref);
      return recorrer(s.$ref.split('/').slice(1).reduce((o, k) => o[k], ESQUEMA), [...pila, s.$ref], ruta);
    }
    (s.anyOf || []).forEach((alt, i) => recorrer(alt, pila, `${ruta}|${i}`));
    if (s.items) recorrer(s.items, pila, `${ruta}[]`);
    if (s.properties) {
      assert.equal(s.additionalProperties, false, `${ruta}: additionalProperties debe ser false`);
      assert.deepEqual([...(s.required || [])].sort(), Object.keys(s.properties).sort(), `${ruta}: todas sus propiedades deben ser requeridas (los opcionales van como null)`);
      Object.keys(s.properties).forEach((k) => recorrer(s.properties[k], pila, `${ruta}.${k}`));
    }
  };
  lectura.forEach((k) => recorrer(ESQUEMA.properties[k], [], k));
  assert.ok(vistos.has('#/$defs/medida') && vistos.has('#/$defs/nodo') && vistos.has('#/$defs/alerta'));
});

test('La red es un árbol consistente: identificadores únicos, referencias que existen y un solo colector', () => {
  const { nodos, aristas, textos } = CASO.red;
  const ids = [...nodos, ...aristas, ...textos, ...CASO.equipos, ...CASO.ductos_rectos, ...CASO.accesorios, ...CASO.elementos_union, ...CASO.soportes, ...CASO.alertas_ambiguedad].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'identificadores únicos');
  const existe = new Set([...ids, ...CASO.red.cotas_totales.map((c) => c.id), 'metadatos']); // «metadatos»: el material y el calibre de todo el croquis
  const N = new Map(nodos.map((n) => [n.id, n]));
  aristas.forEach((a) => {
    assert.ok(N.has(a.nodo_a) && N.has(a.nodo_b), `${a.id}: nodos`);
    assert.ok(N.get(a.nodo_a).aristas.includes(a.id) && N.get(a.nodo_b).aristas.includes(a.id), `${a.id}: el nodo la lista`);
    assert.ok(existe.has(a.ducto_id), `${a.id}: su ducto`);
  });
  nodos.forEach((n) => {
    assert.equal(n.grado, n.aristas.length, `${n.id}: grado`);
    if (n.tipo === 'EXTREMO') assert.ok(n.equipo_id && existe.has(n.equipo_id), `${n.id}: un extremo termina en un equipo`);
    if (n.accesorio_id) assert.equal(CASO.accesorios.find((x) => x.id === n.accesorio_id).nodo_id, n.id);
  });
  textos.forEach((t) => { if (t.asociado_a) assert.ok(existe.has(t.asociado_a), `${t.id}: ${t.asociado_a}`); });
  CASO.alertas_ambiguedad.forEach((a) => a.referencias.forEach((r) => assert.ok(existe.has(r), `${a.id}: ${r}`)));
  // árbol: conexo y con una arista menos que nodos
  assert.equal(aristas.length, nodos.length - 1);
  const colector = CASO.equipos.filter((e) => e.tipo === 'COLECTOR');
  assert.equal(colector.length, 1);
  assert.equal(CASO.metadatos.flujo_hacia, colector[0].id);
  const alcanzados = new Set([colector[0].nodo_id]);
  for (let cambio = true; cambio;) {
    cambio = false;
    aristas.forEach((a) => { if (alcanzados.has(a.nodo_a) !== alcanzados.has(a.nodo_b)) { alcanzados.add(a.nodo_a); alcanzados.add(a.nodo_b); cambio = true; } });
  }
  assert.equal(alcanzados.size, nodos.length, 'conexo');
  // el diámetro no crece al alejarse del colector (nodo_a es el lado del colector)
  aristas.forEach((a) => {
    aristas.filter((b) => b.nodo_a === a.nodo_b).forEach((b) => assert.ok(b.diametro.valor <= a.diametro.valor, `${b.id} (${b.diametro.valor}″) no puede ser mayor que ${a.id} (${a.diametro.valor}″)`));
  });
});

test('El despiece cuadra: longitud neta = cota − lo que ocupan los accesorios, y el resumen suma lo que lista', () => {
  CASO.ductos_rectos.forEach((d) => {
    const ar = CASO.red.aristas.find((a) => a.id === d.arista_id);
    cerca(d.longitud_cota_mm, ar.longitud_cota.valor * 1000, 1e-6, `${d.id}: cota`);
    cerca(d.longitud_neta_mm, d.longitud_cota_mm - d.descuentos.reduce((s, x) => s + x.mm, 0), 0.051, `${d.id}: neta`);
    d.descuentos.forEach((x) => assert.ok(CASO.accesorios.find((a) => a.id === x.accesorio_id).aristas.includes(d.arista_id), `${d.id}: ${x.accesorio_id} está en uno de sus extremos`));
    assert.equal(d.partida_cotizap.L_mm, d.longitud_neta_mm);
    assert.ok(d.longitud_neta_mm > 0);
  });
  // el codo de 90° de 12″ con R = 1.5 D ocupa R · tan(45°) en cada pierna
  cerca(CASO.ductos_rectos[0].descuentos[0].mm, 1.5 * 304.8, 0.05);
  const r = CASO.resumen;
  cerca(r.longitud_total_neta_m, CASO.ductos_rectos.reduce((s, d) => s + d.longitud_neta_mm, 0) / 1000, 0.006);
  cerca(r.longitud_total_cotas_m, CASO.red.aristas.reduce((s, a) => s + a.longitud_cota.valor, 0), 1e-6);
  // el camino más largo desde el colector, por las cotas
  const hijos = (n) => CASO.red.aristas.filter((a) => a.nodo_a === n);
  const masLargo = (n) => Math.max(0, ...hijos(n).map((a) => a.longitud_cota.valor + masLargo(a.nodo_b)));
  cerca(r.longitud_al_punto_mas_alejado_m, masLargo(CASO.equipos.find((e) => e.tipo === 'COLECTOR').nodo_id), 1e-6);
  const J = CASO.elementos_union;
  assert.equal(r.conteo.aros, J.reduce((s, j) => s + j.aros, 0));
  assert.equal(r.conteo.aros_sueltos, J.reduce((s, j) => s + j.aros_sueltos, 0));
  assert.equal(r.conteo.tornillos_juegos, J.reduce((s, j) => s + j.tornillos_juegos, 0));
  assert.equal(r.conteo.juntas_bridadas, J.filter((j) => j.tipo === 'JUNTA_BRIDADA').length);
  ['BLOQUEANTE', 'CONFIRMAR', 'ADVERTENCIA', 'INFO'].forEach((s) => assert.equal(r.alertas[s], CASO.alertas_ambiguedad.filter((a) => a.severidad === s).length));
  assert.equal(r.estado, r.alertas.BLOQUEANTE ? 'NO_COTIZABLE' : r.alertas.CONFIRMAR ? 'PRELIMINAR' : 'DEFINITIVA');
});

test('Las partidas se cotizan con el motor y sus bridas, ménsulas y abrazaderas son las del despiece', () => {
  const M = crearMaestros();
  const partidas = [...CASO.ductos_rectos, ...CASO.accesorios, ...CASO.soportes].map((x) => x.partida_cotizap).concat(CASO.partidas_compradas);
  const res = C.cotizar({ yarda_mm: CASO.metadatos.yarda_mm, partidas }, M);
  assert.deepEqual(res.partidas.filter((f) => !f.ok).map((f) => [f.indice, f.errores]), []);
  const conAros = res.partidas.filter((f) => f.qto && f.qto.her);
  assert.equal(conAros.reduce((s, f) => s + f.qto.her.n_aros + f.qto.her.aros_sueltos.length, 0), CASO.resumen.conteo.aros, 'los aros del despiece son los que cobra el motor');
  assert.equal(conAros.reduce((s, f) => s + f.qto.her.aros_sueltos.length, 0), CASO.resumen.conteo.aros_sueltos);
  // cada junta bridada lleva los barrenos del aro del motor para ese diámetro
  CASO.elementos_union.filter((j) => j.aros > 0).forEach((j) => {
    const aro = C.cotizarPartida({ familia: 'CODO', material_id: 'GALVANIZADO', calibre: '22', D_mm: j.diametro_in * 25.4, theta_deg: 90, cantidad: 1 }, M).qto.her.aros[0];
    assert.equal(j.tornillos_juegos, aro.n_tornillos, j.id);
    cerca(j.sellador_ml, (aro.P_perno_mm / 1000) * 40, 0.06, j.id);
  });
  // las ménsulas automáticas son las de la regla del taller, y cada una lleva su abrazadera
  const men = CASO.soportes.find((s) => s.tipo === 'MENSULA');
  assert.equal(res.partidas[CASO.ductos_rectos.length + CASO.accesorios.length].entrada.cantidad, men.cantidad);
  assert.equal(SOP.contar(res.partidas, M).n, men.cantidad);
  assert.equal(CASO.soportes.filter((s) => s.tipo === 'ABRAZADERA').reduce((s, x) => s + x.cantidad, 0), men.cantidad);
  assert.equal(CASO.resumen.conteo.menulas, men.cantidad);
  // y las entradas de la cotización rápida se cotizan
  const q = CASO.resumen.cotizacion_rapida;
  const rap = R.cotizar({ D_mm: q.D_mm, L_m: q.L_m, yarda_mm: q.yarda_mm, menulas: q.menulas, mangueras_tramos: q.mangueras_tramos }, M);
  assert.ok(rap.total > 0);
  assert.equal(rap.soporteria.menulas, men.cantidad);
});

test('El caso de prueba es lo que dan las reglas (motor/unifilar.js) a la lectura de src/datos/unifilar_ejemplo.js', () => {
  const { lectura, errores } = UF.leer(EJEMPLO);
  assert.deepEqual(errores, []);
  assert.deepEqual(UF.despiezar(lectura, crearMaestros(), {}), CASO, 'regenere con npm run caso:unifilar');
});

test('El documento trae el esquema y el caso de prueba tal como están en sus archivos', () => {
  const bloques = bloquesJson(leer('docs/vision-unifilares.md')).map((b) => { try { return JSON.parse(b); } catch (e) { return null; } });
  assert.ok(bloques.some((b) => b && JSON.stringify(b) === JSON.stringify(ESQUEMA)), 'el esquema completo');
  assert.ok(bloques.some((b) => b && JSON.stringify(b) === JSON.stringify(CASO)), 'el JSON completo del caso de prueba');
});
