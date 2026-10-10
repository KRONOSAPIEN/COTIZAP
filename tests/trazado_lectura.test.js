/**
 * Del trazado isométrico a las partidas (src/motor/trazado_lectura.js; docs/trazado-isometrico.md §1.5, §5.6): el trazo
 * pasa por las reglas del unifilar como una lectura de origen USUARIO. El ejemplo de §1.6 da un despiece definitivo que
 * cuadra con el trazo; la compuerta, la reducción excéntrica, los adaptadores de brida y de manguera, el tramo corto (sin
 * decidir, pegado y aceptado) y la T a 90° salen como deben; la proyección esquiva las alineaciones falsas; `verificar`
 * encuentra las diferencias; y en una caminata al azar el despiece cuadra con el trazo, cada junta es del Ø de sus piezas y
 * las partidas se cotizan.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const TZ = require('../src/motor/trazado_iso');
const TB = require('../src/web/trazado_tablero');
const TL = require('../src/motor/trazado_lectura');
const UF = require('../src/motor/unifilar');
const { validarEsquema } = require('./esquema_json');
const ESQUEMA = require('../docs/unifilar-bom.schema.json');

const M = crearMaestros();
const FECHA = '2026-10-10T00:00:00Z';
const clonar = (x) => JSON.parse(JSON.stringify(x));
const despiece = (t, o) => TL.despiece(t, M, { fecha: FECHA, ...(o || {}) });
const abiertas = (bom, sev) => bom.alertas_ambiguedad.filter((a) => !a.resuelta && (!sev || a.severidad === sev)).map((a) => a.codigo);
const piezas = (bom) => bom.accesorios.map((a) => `${a.tipo} ${a.nodo_id}`).sort();
const netas = (bom) => Object.fromEntries(bom.ductos_rectos.map((d) => [d.arista_id, d.longitud_neta_mm]));
const juntasEn = (bom, nodo) => bom.elementos_union.filter((j) => j.nodo_id === nodo).map((j) => `${j.tipo} ${j.piezas.join('+')} ${j.diametro_in}`).sort();

/** Las partidas del despiece se cotizan todas, cada una con su pieza del despiece. */
function cotiza(bom, msg) {
  const partidas = UF.aPartidas(bom);
  assert.ok(partidas.length > 0, msg);
  assert.ok(partidas.every((p) => typeof p.unifilar_id === 'string'), msg);
  const r = C.cotizar({ yarda_mm: bom.metadatos.yarda_mm, partidas }, M);
  assert.ok(r.partidas.every((f) => f.ok), `${msg || ''} ${r.partidas.filter((f) => !f.ok).map((f) => f.errores).join(' ')}`);
  return r;
}

/** Una máquina nueva con su toma (con brida o con manguera) y su subida de 2.1 m; devuelve el trazo y el nodo de arriba. */
function maquina(t0, pos, D, manguera) {
  let t = TZ.ponerEquipo(t0, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: pos, caja_mm: { largo: 600, ancho: 600, alto: 900 } });
  const eq = t.equipos[t.equipos.length - 1].id;
  t = TZ.agregarPuerto(t, M, eq, { posicion_local_mm: { x: 0, y: 0, z: 900 }, diametro_in: D, caudal_m3_h: 600, coef_entrada_K: 0.5 });
  const pu = t.equipos[t.equipos.length - 1].puertos[0];
  t = manguera ? TZ.acoplarManguera(t, M, pu.id) : TZ.acoplarBrida(t, M, pu.id);
  const p = t.equipos[t.equipos.length - 1].puertos[0];
  t = TZ.trazar(t, M, manguera ? p.acople.nodo_transicion : p.nodo, { direccion: { azimut_deg: 0, elevacion_deg: 90 }, largo_mm: 2100 });
  return { t, cola: t.ultimo.nodo };
}

/* ------------------------------------------------------------------ el ejemplo */

test('El ejemplo de §1.6: la lectura, sus respuestas y un despiece definitivo que cuadra con el trazo; sus partidas se cotizan', () => {
  const t = TB.ejemplo(M);
  const antes = JSON.stringify(t);
  const r = despiece(t);
  assert.equal(r.error, undefined);
  assert.equal(JSON.stringify(t), antes, 'no cambia el trazo');
  assert.deepEqual(despiece(t), r, 'el mismo trazo da lo mismo');
  // la lectura: de origen USUARIO, en el isométrico NE (ningún par de tramos se ve alineado sin estarlo)
  assert.ok(TL.esDeTrazado(r.lectura));
  assert.ok(!TL.esDeTrazado(UF.leer(require('../src/datos/unifilar_ejemplo')).lectura));
  assert.deepEqual(UF.leer(r.lectura).errores, []);
  assert.deepEqual(r.vista, { azimut_deg: 45, elevacion_deg: 35.3, calidad_deg: 30 });
  assert.deepEqual([r.lectura.metadatos.vista, r.lectura.metadatos.convencion_cotas, r.lectura.metadatos.flujo_hacia], ['ISOMETRICO', 'EJES', 'EQ-01-PU-01']);
  assert.deepEqual(r.lectura.red.aristas.map((a) => `${a.id} ${a.nodo_a}←${a.nodo_b} ${a.eje_iso} ${a.diametro.valor}″ ${a.longitud_cota.valor} m`),
    ['TR-001 N-003←N-004 Z 6″ 1.8 m', 'TR-002 N-002←N-003 X 6″ 6.5 m', 'TR-003 N-001←N-002 X 8″ 3.5 m', 'TR-005 N-005←N-006 Z 5″ 1.1 m', 'TR-006 N-002←N-005 NINGUNO 5″ 3.889087 m'],
    'los tramos rígidos, con el nodo aguas abajo primero (la manguera no es arista: se compra)');
  assert.ok(r.lectura.red.aristas.every((a) => a.diametro.origen === 'USUARIO' && a.longitud_cota.origen === 'USUARIO'));
  assert.deepEqual(r.lectura.red.textos.map((x) => `${x.asociado_a} ${x.tipo} ${x.contenido_normalizado}`).sort(), ['N-002 ANGULO 45', 'N-003 ANGULO 90', 'N-005 ANGULO 90']);
  assert.deepEqual(r.lectura.equipos.map((e) => `${e.id} ${e.tipo} ${e.nodo_id} ${e.conexion} ${e.boca_diametro.valor}`),
    ['EQ-01-PU-01 COLECTOR N-001 BRIDA_EQUIPO 8', 'EQ-02-PU-02 MAQUINA N-004 BRIDA_EQUIPO 6', 'EQ-03-PU-03 MAQUINA N-006 MANGUERA 5'], 'la toma con manguera, en su punto de transición');
  assert.deepEqual(r.respuestas, { 'EQ-01-PU-01': { boca_in: 8 }, 'EQ-02-PU-02': { boca_in: 6 }, 'EQ-03-PU-03': { boca_in: 5, manguera_tramos: 1 } });
  // el despiece: definitivo, sin nada que preguntar, y cuadra con el trazo
  const { bom } = r;
  assert.deepEqual(validarEsquema(bom, ESQUEMA), []);
  assert.equal(bom.resumen.estado, 'DEFINITIVA');
  assert.deepEqual([abiertas(bom, 'BLOQUEANTE'), abiertas(bom, 'CONFIRMAR'), abiertas(bom, 'ADVERTENCIA')], [[], [], []]);
  assert.deepEqual([r.diferencias, r.avisos], [[], []]);
  const s = TZ.aSistema(t, M);
  s.tramos.filter((x) => x.tipo === 'RIGIDO').forEach((x) => assert.ok(Math.abs(netas(bom)[x.id] - x.longitud_neta_mm) <= TL.TOL_NETA_MM, `${x.id}: ${netas(bom)[x.id]} ≠ ${x.longitud_neta_mm}`));
  assert.deepEqual(netas(bom), { 'TR-001': 1571.4, 'TR-002': 6165.7, 'TR-003': 3394.3, 'TR-005': 909.5, 'TR-006': 3372.1 });
  assert.deepEqual(bom.accesorios.map((a) => [a.tipo, a.nodo_id, a.partida_cotizap.theta_deg || a.partida_cotizap.beta_deg]).sort(),
    [['CODO', 'N-003', 90], ['CODO', 'N-005', 90], ['REDUCCION_INJERTO', 'N-002', 45]]);
  assert.deepEqual(bom.partidas_compradas.map((p) => [p.articulo_id, p.cantidad]), [['MANGUERA_5', 1], ['ABRAZADERA_MANGUERA', 2]]);
  assert.deepEqual(juntasEn(bom, 'N-006'), ['JUNTA_MANGUERA DUCT-004+EQ-03-PU-03 5']);
  assert.deepEqual(juntasEn(bom, 'N-004'), ['JUNTA_EQUIPO DUCT-001+EQ-02-PU-02 6']);
  assert.equal(bom.resumen.conteo.menulas, 12);
  cotiza(bom, 'el ejemplo');
  // la yarda de la cotización llega a las partidas del tramo recto
  assert.ok(UF.aPartidas(despiece(t, { yarda_mm: 1220 }).bom).filter((p) => p.familia === 'RECTO').every((p) => p.yarda_mm === 1220));
});

test('Lo que no se puede pasar (sin colector, un problema de geometría, dos bocas) y lo que sí, con su aviso (una toma sin caudal o sin ducto)', () => {
  assert.match(TL.aLectura(TZ.nuevo(M), M).error, /todavía no llega a la boca de un colector/);
  const corto = TZ.cambiarLargo(TB.ejemplo(M), M, 'TR-005', 150);
  assert.match(TL.despiece(corto, M).error, /^Para pasarlo a partidas, primero corrija el problema del trazo: Los accesorios del tramo TR-005 ocupan 40 mm más que su largo\./);
  let dos = TZ.agregarPuerto(TB.ejemplo(M), M, 'EQ-01', { rol: 'ENTRADA', posicion_local_mm: { x: 0, y: 750, z: 2000 }, diametro_in: 6 });
  dos = TZ.trazar(dos, M, dos.equipos[0].puertos[1].nodo, { direccion: { azimut_deg: 90, elevacion_deg: 0 }, largo_mm: 2000 });
  assert.match(TL.aLectura(dos, M).error, /El trazo llega a 2 bocas \(PU-01, PU-04\)/);
  assert.throws(() => TL.aLectura(null, M));
  // lo que no cambia el despiece no lo detiene: una toma sin caudal o sin ducto, con su aviso
  let t = TZ.editarPuerto(TB.ejemplo(M), M, 'PU-03', { caudal_m3_h: null });
  t = TZ.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: { x: 6000, y: 3000, z: 0 }, caja_mm: { largo: 600, ancho: 600, alto: 900 } });
  t = TZ.agregarPuerto(t, M, t.equipos[3].id, { posicion_local_mm: { x: 0, y: 0, z: 900 }, diametro_in: 4, caudal_m3_h: 600 });
  t = TZ.acoplarBrida(t, M, t.equipos[3].puertos[0].id);
  const r = despiece(t);
  assert.deepEqual([r.bom.resumen.estado, r.diferencias], ['DEFINITIVA', []]);
  assert.deepEqual(r.avisos, ['La toma PU-03 (Cepillo) no tiene caudal de diseño. No cambia el despiece; el cálculo de pérdidas sí lo necesita.', 'La toma PU-04 (Lijadora) no tiene ducto. Esa toma no entra al despiece.']);
  assert.deepEqual(r.bom.equipos.map((e) => e.id), ['EQ-01-PU-01', 'EQ-02-PU-02', 'EQ-03-PU-03']);
});

/* ------------------------------------------------------------------ las piezas del trazo */

test('Compuerta, reducción excéntrica y adaptadores de brida y de manguera: cada pieza del trazo sale en el despiece', () => {
  const E = TB.ejemplo(M);
  // la compuerta: una compra, en su nodo, entre dos tramos de 6″, con media junta de cada lado
  const cp = despiece(TZ.ponerCompuerta(E, M, { tramo: 'TR-002', s_mm: 3000 }));
  assert.deepEqual([cp.bom.resumen.estado, cp.diferencias], ['DEFINITIVA', []]);
  const comp = cp.bom.accesorios.find((a) => a.tipo === 'COMPUERTA');
  assert.deepEqual([comp.nodo_id, comp.partida_cotizap.familia, comp.partida_cotizap.precio_compra_unitario], ['N-008', 'COMPRADO', 0]);
  assert.deepEqual(abiertas(cp.bom, 'ADVERTENCIA'), ['COMPUERTA_SIN_CATALOGO'], 'sin compuerta en el catálogo: su precio por capturar');
  assert.deepEqual(juntasEn(cp.bom, 'N-008'), ['JUNTA_EQUIPO DUCT-002+COMP-001 6', 'JUNTA_EQUIPO DUCT-006+COMP-001 6']);
  cotiza(cp.bom, 'compuerta');
  // la reducción horizontal en polvo es excéntrica (cara plana abajo); el adaptador a la brida de la sierra, concéntrico
  const re = despiece(TZ.reducir(E, M, { tramo: 'TR-002', s_mm: 3000 }, 5));
  assert.deepEqual([re.bom.resumen.estado, re.diferencias], ['DEFINITIVA', []]);
  assert.ok(re.lectura.red.textos.some((x) => x.asociado_a === 'N-008' && x.tipo === 'NOTA' && x.contenido_normalizado === 'EXC'));
  const red = (r, nodo) => r.bom.accesorios.find((a) => a.tipo === 'REDUCCION' && a.nodo_id === nodo);
  assert.deepEqual([red(re, 'N-008').excentrica, red(re, 'N-008').partida_cotizap.excentrica], [true, 'CARA_PLANA']);
  assert.deepEqual([red(re, 'N-004').excentrica, red(re, 'N-004').diametro_entrada_in, red(re, 'N-004').diametro_salida_in], [false, 6, 5]);
  assert.deepEqual(juntasEn(re.bom, 'N-004'), ['JUNTA_BRIDADA DUCT-001+RED-002 5', 'JUNTA_EQUIPO RED-002+EQ-02-PU-02 6'], 'el ducto de 5″ a la reducción, la reducción a la boca de 6″');
  cotiza(re.bom, 'reducción');
  // la boca de la sierra de 5″ en un ducto de 6″: la junta de cada lado, de su Ø
  const br = despiece(TZ.editarPuerto(E, M, 'PU-02', { diametro_in: 5 }));
  assert.deepEqual([br.bom.resumen.estado, br.diferencias], ['DEFINITIVA', []]);
  assert.deepEqual(juntasEn(br.bom, 'N-004'), ['JUNTA_BRIDADA DUCT-001+RED-001 6', 'JUNTA_EQUIPO RED-001+EQ-02-PU-02 5']);
  assert.equal(netas(br.bom)['TR-001'], 1524, 'el adaptador ocupa su largo del tramo');
  // la manguera del cepillo de 6″ en un ducto de 5″: el adaptador en el punto de transición, con su lado de 6″ liso
  const mg = despiece(TZ.editarPuerto(E, M, 'PU-03', { diametro_in: 6 }));
  if (mg.error) assert.fail(mg.error);
  assert.deepEqual(mg.diferencias, []);
  const ad = red(mg, 'N-006');
  assert.deepEqual([ad.diametro_entrada_in, ad.diametro_salida_in, ad.partida_cotizap.extremos_sin_brida], [6, 5, ['D1']]);
  assert.deepEqual(juntasEn(mg.bom, 'N-006'), ['JUNTA_BRIDADA DUCT-004+RED-001 5', 'JUNTA_MANGUERA RED-001+EQ-03-PU-03 6']);
  assert.deepEqual(mg.bom.partidas_compradas.map((p) => [p.articulo_id, p.cantidad]), [['MANGUERA_6', 1], ['ABRAZADERA_MANGUERA', 2]]);
  assert.ok(Math.abs(netas(mg.bom)['TR-005'] - TZ.aSistema(TZ.editarPuerto(E, M, 'PU-03', { diametro_in: 6 }), M).tramos.find((x) => x.id === 'TR-005').longitud_neta_mm) <= TL.TOL_NETA_MM);
  cotiza(mg.bom, 'manguera de otro Ø');
});

test('Tramo corto: sin decidir lo pregunta el despiece (y lo avisa); PEGAR lo arma pegado; ACEPTAR lo fabrica con bridas', () => {
  const u = TZ.reducir(TB.ejemplo(M), M, { tramo: 'TR-002', s_mm: 300 }, 5); // entre el codo de N-003 y la reducción quedan 86 mm
  const sin = despiece(u);
  assert.deepEqual([sin.bom.resumen.estado, abiertas(sin.bom, 'CONFIRMAR'), sin.diferencias], ['PRELIMINAR', ['ACCESORIOS_ENCIMADOS'], []]);
  assert.equal(sin.avisos.length, 1);
  assert.match(sin.avisos[0], /Entre CO-001 y RE-001 quedan 86 mm de recto en TR-002 \(mínimo 150\)\. El trazo no dice si se pegan las piezas o se fabrica el tramo corto: el despiece lo pregunta/);
  const pegar = despiece(TZ.decidirCorto(u, M, 'TR-002', 'PEGAR'));
  assert.deepEqual([pegar.bom.resumen.estado, pegar.diferencias, pegar.avisos], ['DEFINITIVA', [], []]);
  assert.deepEqual(pegar.respuestas['TR-002'], { encimado: 'UNION' });
  assert.ok(!pegar.bom.ductos_rectos.some((d) => d.arista_id === 'TR-002'), 'pegado: sin tramo');
  assert.deepEqual(pegar.bom.elementos_union.filter((j) => j.tipo === 'UNION_ENGARGOLADA').map((j) => j.piezas.join('+')), ['RED-001+CODO-002']);
  assert.deepEqual(pegar.bom.accesorios.filter((a) => a.partida_cotizap.extremos_sin_brida).map((a) => `${a.id} ${a.partida_cotizap.extremos_sin_brida}`), ['RED-001 D2', 'CODO-002 A']);
  cotiza(pegar.bom, 'pegar');
  const aceptar = despiece(TZ.decidirCorto(u, M, 'TR-002', 'ACEPTAR'));
  assert.deepEqual([aceptar.bom.resumen.estado, aceptar.diferencias, aceptar.respuestas['TR-002']], ['DEFINITIVA', [], { encimado: 'TRAMO', aceptado: true }]);
  assert.equal(netas(aceptar.bom)['TR-002'], 85.8);
  cotiza(aceptar.bom, 'aceptar');
});

test('La T a 90° (ventilación) sale como injerto a 45°, que se pregunta; el aviso dice que no se fabrica', () => {
  const { t, cola } = maquina(TZ.cambiarProyecto(TB.ejemplo(M), M, { servicio: 'VENTILACION' }), { x: 2000, y: 3000, z: 0 }, 4);
  const ruta = TZ.rutas(t, M, cola, { tramo: 'TR-003' }, { max: 12 }).find((x) => x.beta_deg === 90 && x.segmentos.length === 1);
  const r = despiece(TZ.conectar(t, M, cola, ruta));
  const te = TZ.aSistema(TZ.conectar(t, M, cola, ruta), M).accesorios.find((a) => a.tipo === 'T_90');
  assert.ok(te);
  assert.deepEqual([r.bom.resumen.estado, abiertas(r.bom, 'CONFIRMAR'), r.diferencias], ['PRELIMINAR', ['ANGULO_DERIVACION_NO_PERMITIDO'], []]);
  const inj = r.bom.accesorios.find((a) => a.nodo_id === te.nodo);
  assert.deepEqual([inj.tipo, inj.partida_cotizap.beta_deg], ['INJERTO', 45]);
  assert.ok(r.avisos.some((x) => x.startsWith(`La T a 90° de ${te.nodo} no la fabrica el taller`)));
});

test('La proyección: si en el isométrico NE dos tramos de un nodo se ven alineados sin estarlo, se elige otra vista', () => {
  const eje = (az, el) => TL.ejeDe({ azimut_deg: az, elevacion_deg: el });
  assert.deepEqual([eje(180, 0), eje(270, 0), eje(0, -90), eje(45, 0), eje(0, 30), eje(-360, 0), eje(90, 90)], ['X', 'Y', 'Z', 'NINGUNO', 'NINGUNO', 'X', 'Z']);
  // una subida y una horizontal a 45° se ven como una sola línea en el NE: la vista cambia y ya no se confunden
  const ady = new Map([['N', [{ x: 0, y: 0, z: 1 }, { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }]]]);
  const v = TL.proyeccion(['N'], ady);
  assert.ok(v.calidad >= 20 && !(v.az === 45 && Math.abs(v.el - 35.26) < 0.1), JSON.stringify(v));
  // en un trazo: la subida de la lijadora y su tramo a 225° (con codo) hasta el tronco
  const { t, cola } = maquina(TB.ejemplo(M), { x: 6000, y: 3000, z: 0 }, 4);
  const ruta = TZ.rutas(t, M, cola, { tramo: 'TR-003' }, { max: 12 }).find((x) => x.segmentos.length === 1 && x.segmentos[0].direccion.azimut_deg === 225);
  const r = despiece(TZ.aplicarDimensiones(TZ.conectar(t, M, cola, ruta), M));
  assert.deepEqual(r.vista, { azimut_deg: 90, elevacion_deg: 55, calidad_deg: 39.3 });
  assert.deepEqual([r.bom.resumen.estado, r.diferencias, r.avisos], ['DEFINITIVA', [], []]);
  assert.deepEqual(piezas(r.bom), ['CODO N-003', 'CODO N-005', 'CODO N-009', 'REDUCCION N-001', 'REDUCCION_INJERTO N-002', 'REDUCCION_INJERTO N-010']);
  cotiza(r.bom, 'proyección');
});

test('verificar dice dónde no cuadra el despiece con el trazo', () => {
  const t = TB.ejemplo(M);
  const { bom } = despiece(t);
  assert.deepEqual(TL.verificar(t, M, bom), []);
  const mal = clonar(bom);
  mal.ductos_rectos.find((d) => d.arista_id === 'TR-002').longitud_neta_mm += 20;
  mal.ductos_rectos.find((d) => d.arista_id === 'TR-003').diametro_in = 9;
  mal.ductos_rectos = mal.ductos_rectos.filter((d) => d.arista_id !== 'TR-001');
  mal.accesorios.find((a) => a.nodo_id === 'N-003').partida_cotizap.theta_deg = 60;
  mal.accesorios.find((a) => a.nodo_id === 'N-002').partida_cotizap.beta_deg = 30;
  mal.accesorios = mal.accesorios.filter((a) => a.nodo_id !== 'N-005');
  mal.accesorios.push({ ...clonar(bom.accesorios[0]), id: 'RED-009', tipo: 'REDUCCION', nodo_id: 'N-004' });
  assert.deepEqual(TL.verificar(t, M, mal), [
    'TR-001 no salió en el despiece.',
    'TR-002: 6165.7 mm netos en el trazo y 6185.7 mm en el despiece.',
    'TR-003: 8″ en el trazo y 9″ en el despiece.',
    'CO-001: codo de 90° en el trazo y de 60° en el despiece.',
    'CO-002 (codo en N-005) no salió en el despiece.',
    'RI-001: injerto a 45° en el trazo y a 30° en el despiece.',
    'El despiece agregó RED-009 (reduccion) en N-004, que el trazo no tiene.',
  ]);
});

/* ------------------------------------------------------------------ caminata al azar */

test('Caminata al azar: el despiece cuadra con el trazo, cada junta es del Ø de sus piezas y las partidas se cotizan', () => {
  let total = 0;
  const vistos = new Set();
  [11, 2026, 77, 909].forEach((semilla0) => {
    let semilla = semilla0;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    const uno = (xs) => xs[Math.floor(azar() * xs.length)];
    let t = TB.ejemplo(M);
    const ops = [
      () => { // otra máquina con brida o con manguera, a veces con un codo, y su ramal hasta un tramo que ya llega al colector
        let { t: m, cola } = maquina(t, { x: 1000 * Math.round(2 + azar() * 10), y: 1000 * Math.round(-6 + azar() * 12), z: 0 }, uno([4, 5, 6]), azar() < 0.35);
        if (azar() < 0.5) { m = TZ.trazar(m, M, cola, { direccion: { azimut_deg: uno([0, 90, 180, 270, 45, 135]), elevacion_deg: uno([0, 0, 30, 45]) }, largo_mm: uno([600, 1200, 1800]) }); cola = m.ultimo.nodo; }
        const g = TZ.calcular(m, M);
        const rs = TZ.rutas(m, M, cola, { tramo: uno(m.tramos.filter((x) => x.tipo === 'RIGIDO' && g.conocido(x.id))).id });
        return rs.length ? TZ.aplicarDimensiones(TZ.conectar(m, M, cola, uno(rs)), M) : t;
      },
      () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return TZ.ponerCompuerta(t, M, { tramo: tr.id, s_mm: 1000 * Math.round(TZ.calcular(t, M).seg.get(tr.id).L / 2000) || 500 }); },
      () => { const n = uno(t.nodos.filter((x) => x.compuerta)); return n ? TZ.quitarCompuerta(t, M, n.id) : t; },
      () => TZ.aplicarDimensiones(t, M),
      () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return TZ.cambiarDiametro(t, M, tr.id, uno([5, 6, 7, 8, 9]), { cadena: true }); },
      () => { const g = TZ.calcular(t, M); const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO' && g.neta.get(x.id) < t.politicas.recto_min_entre_accesorios_mm)); return tr ? TZ.decidirCorto(t, M, tr.id, uno(['PEGAR', 'ACEPTAR', null])) : t; },
      () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return TZ.reducir(t, M, { tramo: tr.id, s_mm: 1000 * Math.round(TZ.calcular(t, M).seg.get(tr.id).L / 2000) || 500 }, uno([4, 5, 6])); },
      () => TZ.cambiarMaterial(t, M, uno(['GALVANIZADO', 'ACERO_CARBON']), uno([20, 22, 18]), { todos: azar() < 0.7 }),
    ];
    for (let i = 0; i < 35; i += 1) {
      const antes = t;
      try { t = uno(ops)(); } catch (e) { if (!(e instanceof TZ.TrazadoError)) throw e; }
      try { TZ.aSistema(t, M); } catch (e) { if (!(e instanceof TZ.TrazadoError)) throw e; t = antes; } // un paso que deja problemas se deshace
      const msg = `semilla ${semilla0}, paso ${i}`;
      const r = despiece(t);
      assert.equal(r.error, undefined, `${msg}: ${r.error}`);
      assert.deepEqual(r.diferencias, [], msg);
      assert.deepEqual(abiertas(r.bom, 'BLOQUEANTE'), [], msg);
      assert.deepEqual(validarEsquema(r.bom, ESQUEMA), [], msg);
      // cada junta es del Ø de un extremo de cada pieza que une
      const ext = new Map();
      r.bom.ductos_rectos.forEach((d) => ext.set(d.id, [d.diametro_in]));
      r.bom.accesorios.forEach((a) => ext.set(a.id, [a.diametro_entrada_in, a.diametro_salida_in, a.d_ramal_in].filter((x) => x !== null)));
      r.bom.equipos.forEach((e) => ext.set(e.id, [r.respuestas[e.id].boca_in]));
      r.bom.elementos_union.filter((j) => j.tipo !== 'UNION_ENGARGOLADA').forEach((j) => j.piezas.forEach((pz) => {
        assert.ok(ext.has(pz), `${msg}: ${j.id} une ${pz}`);
        assert.ok(ext.get(pz).includes(j.diametro_in), `${msg}: ${j.id} (${j.tipo}) de ${j.diametro_in}″ en ${pz} (${ext.get(pz).join(', ')}″)`);
      }));
      cotiza(r.bom, msg);
      r.bom.accesorios.forEach((a) => vistos.add(a.tipo));
      if (r.bom.elementos_union.some((j) => j.tipo === 'UNION_ENGARGOLADA')) vistos.add('PEGADO');
      if (r.bom.partidas_compradas.some((p) => p.articulo_id && p.articulo_id.startsWith('MANGUERA') && p.articulo_id !== 'MANGUERA_5')) vistos.add('OTRA_MANGUERA');
      total += 1;
    }
  });
  assert.ok(total >= 140, `se revisaron ${total} trazos`);
  ['CODO', 'REDUCCION', 'INJERTO', 'REDUCCION_INJERTO', 'COMPUERTA'].forEach((x) => assert.ok(vistos.has(x), `salió ${x} (${[...vistos].join(', ')})`));
});
