/**
 * Reglas del croquis unifilar (src/motor/unifilar.js): revisión de la lectura, despiece del caso de prueba, respuestas del
 * ingeniero, casos que bloquean, geometría en planta y las partidas que salen hacia la cotización.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const UF = require('../src/motor/unifilar');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');
const CASO = require('../docs/ejemplos/unifilar-caso-prueba.json');

const M = crearMaestros();
const clonar = (x) => JSON.parse(JSON.stringify(x));
const lecturaEjemplo = () => UF.leer(EJEMPLO).lectura;
const despiezar = (lectura, respuestas) => UF.despiezar(lectura, M, respuestas || {});
const codigos = (bom, sev) => bom.alertas_ambiguedad.filter((a) => !a.resuelta && (!sev || a.severidad === sev)).map((a) => a.codigo);
const ducto = (bom, arista) => bom.ductos_rectos.find((d) => d.arista_id === arista);

/** Un croquis en planta mínimo: nodos [id, x, y], aristas [id, a, b, Ø″, m] y equipos [id, tipo, nodo, conexión]. */
function planta(nodos, aristas, equipos, extra) {
  const med = (valor, unidad) => ({ valor, unidad, origen: 'OCR', confianza: valor === null ? 0 : 0.95, texto_id: null });
  return {
    metadatos: { vista: 'PLANTA', material: med('GALVANIZADO', null), calibre: med(22, null), yarda_mm: 914.4 },
    red: {
      nodos: nodos.map(([id, x, y]) => ({ id, tipo: 'VERTICE', pos_px: { x, y } })),
      aristas: aristas.map(([id, a, b, d, m]) => ({ id, nodo_a: a, nodo_b: b, diametro: med(d, 'in'), longitud_cota: med(m, 'm') })),
      textos: (extra && extra.textos) || [],
    },
    equipos: equipos.map(([id, tipo, nodo_id, conexion]) => ({ id, tipo, nombre: id, nodo_id, conexion })),
  };
}

test('leer: acepta el objeto o su texto, y rechaza lo que no es una red utilizable', () => {
  assert.deepEqual(UF.leer(EJEMPLO).errores, []);
  assert.deepEqual(UF.leer(JSON.stringify(EJEMPLO)).errores, []);
  assert.match(UF.leer('{ no es json').errores[0], /no es un JSON válido/);
  assert.match(UF.leer([1, 2]).errores[0], /Se esperaba un objeto/);
  assert.deepEqual(UF.leer({ red: {} }).errores, ['Falta «metadatos».']);
  const repetido = clonar(EJEMPLO);
  repetido.red.aristas[1].id = 'A-001';
  assert.ok(UF.leer(repetido).errores.some((e) => /«A-001» está repetido/.test(e)));
  const suelta = clonar(EJEMPLO);
  suelta.red.aristas[0].nodo_b = 'N-999';
  assert.ok(UF.leer(suelta).errores.some((e) => /une nodos que no existen/.test(e)));
  const sinPos = clonar(EJEMPLO);
  delete sinPos.red.nodos[3].pos_px;
  assert.ok(UF.leer(sinPos).errores.some((e) => /N-004 no trae su posición/.test(e)));
});

test('leer: el grado y las aristas de cada nodo salen de las aristas; se descarta lo que puso una regla y las alertas que no son de lectura', () => {
  const x = clonar(EJEMPLO);
  x.red.nodos[2].aristas = ['A-002'];
  x.red.nodos[2].grado = 7;
  x.red.aristas[5].diametro = { valor: 10, unidad: 'in', origen: 'INFERIDO', confianza: 0.8, texto_id: null };
  x.alertas_ambiguedad = [{ codigo: 'ASOCIACION_AMBIGUA', severidad: 'CONFIRMAR', referencias: ['T-009'], mensaje: 'Dos aristas a la misma distancia.' }, { codigo: 'COTA_ILEGIBLE', referencias: [] }];
  const { lectura } = UF.leer(x);
  const n3 = lectura.red.nodos.find((n) => n.id === 'N-003');
  assert.deepEqual(n3.aristas, ['A-002', 'A-003', 'A-004']);
  assert.equal(n3.grado, 3);
  assert.equal(lectura.red.aristas[5].diametro.valor, null, 'un Ø heredado se vuelve a calcular');
  assert.deepEqual(lectura.alertas_ambiguedad.map((a) => a.codigo), ['ASOCIACION_AMBIGUA']);
  const bom = despiezar(lectura);
  assert.ok(bom.alertas_ambiguedad.some((a) => a.codigo === 'ASOCIACION_AMBIGUA' && a.severidad === 'CONFIRMAR'));
});

test('El caso de prueba: las reglas dan las piezas, las longitudes netas y las alertas del documento', () => {
  const bom = despiezar(lecturaEjemplo());
  assert.equal(bom.resumen.estado, 'PRELIMINAR');
  assert.deepEqual(codigos(bom, 'CONFIRMAR'), ['COTA_ILEGIBLE', 'ANGULO_DERIVACION_NO_PERMITIDO', 'ORIENTACION_AMBIGUA', 'CONEXION_EQUIPO']);
  assert.deepEqual(codigos(bom, 'ADVERTENCIA'), ['MANGUERA_SIN_LARGO', 'MANGUERA_SIN_LARGO', 'CALIBRE_BAJO_TABLA']);
  assert.deepEqual(codigos(bom, 'BLOQUEANTE'), []);
  assert.deepEqual(bom.ductos_rectos.map((d) => d.longitud_neta_mm), [2542.8, 3919.6, 1389.5, 3301.8, 950, 1777.6, 2326.3, 1373.7]);
  assert.deepEqual(bom.accesorios.map((a) => `${a.id} ${a.nodo_id}`), ['CODO-001 N-002', 'RINJ-001 N-003', 'INJ-001 N-005', 'RED-001 N-007', 'CODO-002 N-008']);
  // la cota «1.? m» se estima con la escala de las aristas acotadas paralelas a los ejes y se pregunta
  const a5 = bom.red.aristas.find((a) => a.id === 'A-005');
  assert.deepEqual([a5.longitud_cota.valor, a5.longitud_cota.origen], [1.3, 'ESCALA']);
  // los Ø que faltan se heredan: del tronco de un injerto simple y de un codo
  assert.deepEqual(['A-006', 'A-008'].map((id) => bom.red.aristas.find((a) => a.id === id).diametro.valor), [10, 8]);
  assert.equal(bom.accesorios[1].partida_cotizap.beta_deg, 45, 'el ángulo anotado del injerto');
  assert.equal(bom.accesorios[0].partida_cotizap.theta_deg, 90, 'del eje Z al eje X: codo de 90°');
  assert.equal(bom.accesorios[4].partida_cotizap.theta_deg, 45);
  assert.equal(ducto(bom, 'A-008').posicion, 'HORIZONTAL', 'la cota «45°» manda sobre el trazo vertical');
  assert.equal(ducto(bom, 'A-003').extremo_fin, 'LISO_MANGUERA');
  assert.equal(ducto(bom, 'A-003').partida_cotizap.extremo_ajuste, 'SIN_BRIDA');
  assert.deepEqual([bom.resumen.conteo.aros, bom.resumen.conteo.aros_sueltos, bom.resumen.conteo.menulas], [30, 6, 14]);
  // cada alerta lleva también la pieza que le tocó
  assert.deepEqual(bom.alertas_ambiguedad[0].referencias, ['A-005', 'T-011', 'DUCT-005']);
  assert.equal(bom.alertas_ambiguedad[0].mensaje, 'La cota del tramo de 5″ a «Máquina B» (A-005) dice «1.? m» (lectura 0.41).');
});

test('Las reglas no cambian lo que reciben y el despiece se puede volver a leer: da el mismo despiece', () => {
  const lectura = lecturaEjemplo();
  const antes = JSON.stringify(lectura);
  const respuestas = { 'A-005': { longitud_m: 1.6 } };
  despiezar(lectura, respuestas);
  assert.equal(JSON.stringify(lectura), antes);
  assert.deepEqual(respuestas, { 'A-005': { longitud_m: 1.6 } });
  const otra = despiezar(UF.leer(JSON.stringify(CASO)).lectura);
  assert.deepEqual(otra, CASO);
});

test('Respuestas: cada una quita su pregunta, queda como respondida (con su control) y cambia las piezas', () => {
  const L = lecturaEjemplo();
  const cota = despiezar(L, { 'A-005': { longitud_m: 1.6 } });
  assert.ok(!codigos(cota).includes('COTA_ILEGIBLE'));
  assert.equal(ducto(cota, 'A-005').longitud_neta_mm, 1600 - 350);
  const r = cota.alertas_ambiguedad.find((a) => a.resuelta && a.codigo === 'COTA_ILEGIBLE');
  assert.deepEqual([r.severidad, r.respuesta.elemento, r.respuesta.campo, r.respuesta.propuesta], ['INFO', 'A-005', 'longitud_m', 1.6]);

  const baja = despiezar(L, { 'A-008': { posicion: 'VERTICAL' } });
  assert.equal(baja.accesorios.find((a) => a.id === 'CODO-002').partida_cotizap.theta_deg, 90);
  assert.equal(ducto(baja, 'A-008').posicion, 'VERTICAL');
  assert.ok(baja.ductos_rectos.find((d) => d.arista_id === 'A-007').longitud_neta_mm < 2326.3, 'el codo de 90° ocupa más');

  const boca = despiezar(L, { 'EQ-01': { boca_in: 14 } });
  const red = boca.accesorios.find((a) => a.nodo_id === 'N-001');
  assert.deepEqual([red.tipo, red.diametro_entrada_in, red.diametro_salida_in], ['REDUCCION', 14, 12]);
  assert.ok(boca.elementos_union.some((j) => j.tipo === 'JUNTA_EQUIPO' && j.piezas.includes(red.id) && j.diametro_in === 14));

  const tramos = despiezar(L, { 'EQ-02': { manguera_tramos: 3 } });
  assert.equal(tramos.partidas_compradas.find((c) => c.articulo_id === 'MANGUERA_6').cantidad, 3);

  const todo = despiezar(L, {
    'A-005': { longitud_m: 1.6 }, 'N-005': { angulo_deg: 30 }, 'A-008': { posicion: 'HORIZONTAL' }, 'EQ-01': { boca_in: 12 },
    'EQ-02': { manguera_tramos: 1 }, 'EQ-03': { manguera_tramos: 1 }, metadatos: { calibre: 22 },
  });
  assert.equal(todo.resumen.estado, 'DEFINITIVA');
  assert.deepEqual(codigos(todo).filter((c) => c !== 'TEXTO_SIN_ASOCIAR' && c !== 'DIAMETRO_INFERIDO' && c !== 'ANGULO_INFERIDO' && c !== 'TRANSICION_INSERTADA'), []);
  assert.equal(todo.accesorios.find((a) => a.id === 'INJ-001').partida_cotizap.beta_deg, 30);
  assert.equal(UF.pendientes(todo).length, 0);
});

test('Lo que bloquea: sin colector, un ciclo, un ramal sin diámetro, una cota sin escala posible', () => {
  const sinColector = clonar(EJEMPLO);
  sinColector.equipos[0].tipo = 'MAQUINA';
  const b1 = despiezar(UF.leer(sinColector).lectura);
  assert.deepEqual([b1.resumen.estado, codigos(b1, 'BLOQUEANTE')], ['NO_COTIZABLE', ['SIN_COLECTOR']]);
  assert.equal(b1.ductos_rectos.length, 0);

  const ciclo = clonar(EJEMPLO);
  ciclo.red.aristas.push({ id: 'A-009', nodo_a: 'N-004', nodo_b: 'N-006', diametro: { valor: 6, unidad: 'in', confianza: 0.9 }, longitud_cota: { valor: 1, unidad: 'm', confianza: 0.9 } });
  assert.deepEqual(codigos(despiezar(UF.leer(ciclo).lectura), 'BLOQUEANTE'), ['CICLO_EN_RED']);

  const ramal = clonar(EJEMPLO);
  ramal.red.aristas[2].diametro = { valor: null, unidad: 'in', origen: 'OCR', confianza: 0, texto_id: null };
  const b3 = despiezar(UF.leer(ramal).lectura);
  assert.deepEqual(codigos(b3, 'BLOQUEANTE'), ['DIAMETRO_FALTANTE']);
  assert.equal(b3.resumen.estado, 'NO_COTIZABLE');
  const q = UF.pendientes(b3).find((a) => a.codigo === 'DIAMETRO_FALTANTE');
  assert.deepEqual([q.respuesta.tipo, q.respuesta.elemento, q.respuesta.campo], ['NUMERO', 'A-003', 'diametro_in']);
  assert.equal(despiezar(UF.leer(ramal).lectura, { 'A-003': { diametro_in: 6 } }).resumen.estado, 'PRELIMINAR');

  const cotas = clonar(EJEMPLO);
  cotas.red.aristas.forEach((a, i) => { if (i > 0) a.longitud_cota = { valor: null, unidad: 'm', confianza: 0 }; });
  const b4 = despiezar(UF.leer(cotas).lectura);
  assert.ok(codigos(b4, 'BLOQUEANTE').includes('COTA_FALTANTE'));
  assert.equal(b4.resumen.estado, 'NO_COTIZABLE');
});

test('En planta: el ángulo del codo se mide, una Y simétrica pasa a injerto, el ramal contra el flujo se voltea y un extremo suelto se pregunta', () => {
  // colector → 2 m al este → codo (medido 90°) → 1.5 m al norte → máquina con brida del taller
  const codo = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 400, -300]],
    [['A-1', 'N-1', 'N-2', 8, 2], ['A-2', 'N-2', 'N-3', 8, 1.5]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['MAQ', 'MAQUINA', 'N-3', 'BRIDA_TALLER']])).lectura);
  assert.equal(codo.accesorios[0].partida_cotizap.theta_deg, 90);
  assert.equal(codo.accesorios[0].angulo.origen, 'INFERIDO');
  assert.ok(codigos(codo, 'INFO').includes('ANGULO_INFERIDO'));
  // un codo de 70° en el dibujo no es de taller: se usa el permitido más cercano y se pregunta
  const raro = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 400 + 300 * Math.cos(Math.PI * 70 / 180), -300 * Math.sin(Math.PI * 70 / 180)]],
    [['A-1', 'N-1', 'N-2', 8, 2], ['A-2', 'N-2', 'N-3', 8, 1.5]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['MAQ', 'MAQUINA', 'N-3', 'BRIDA_TALLER']])).lectura);
  assert.ok(codigos(raro, 'CONFIRMAR').includes('ANGULO_NO_PERMITIDO'));
  assert.equal(raro.accesorios[0].partida_cotizap.theta_deg, 60);

  // Y simétrica: dos hijos a ±30° del eje del tronco (ninguno sigue al tronco)
  const y = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 700, -173], ['N-4', 700, 173]],
    [['A-1', 'N-1', 'N-2', 10, 2], ['A-2', 'N-2', 'N-3', 8, 1.5], ['A-3', 'N-2', 'N-4', 6, 1.5]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-3', 'BRIDA_TALLER'], ['M2', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  assert.ok(codigos(y, 'CONFIRMAR').includes('PANTALON_RETIRADO'));
  const pieza = y.accesorios.find((a) => a.nodo_id === 'N-2');
  assert.deepEqual([pieza.tipo, pieza.aristas], ['REDUCCION_INJERTO', ['A-1', 'A-2', 'A-3']], 'el hijo de mayor Ø es el tronco');
  assert.equal(codigos(despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 700, -173], ['N-4', 700, 173]],
    [['A-1', 'N-1', 'N-2', 10, 2], ['A-2', 'N-2', 'N-3', 8, 1.5], ['A-3', 'N-2', 'N-4', 6, 1.5]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-3', 'BRIDA_TALLER'], ['M2', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura, { 'N-2': { aceptado: true } })).filter((c) => c === 'PANTALON_RETIRADO').length, 0);

  // ramal que entra contra el flujo (a 135° del tronco que sigue): se voltea a 45°
  const contra = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 800, 0], ['N-4', 400 + 200, 200]],
    [['A-1', 'N-1', 'N-2', 10, 2], ['A-2', 'N-2', 'N-3', 10, 2], ['A-3', 'N-2', 'N-4', 5, 1]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-3', 'BRIDA_TALLER'], ['M2', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  // N-4 está «adelante» del nodo: el ramal sale a 45° del tronco que sigue, a favor del flujo
  assert.ok(!codigos(contra).includes('DERIVACION_CONTRA_FLUJO'));
  const atras = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 800, 0], ['N-4', 400 - 200, 200]],
    [['A-1', 'N-1', 'N-2', 10, 2], ['A-2', 'N-2', 'N-3', 10, 2], ['A-3', 'N-2', 'N-4', 5, 1]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-3', 'BRIDA_TALLER'], ['M2', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  assert.ok(codigos(atras, 'CONFIRMAR').includes('DERIVACION_CONTRA_FLUJO'));
  assert.equal(atras.accesorios[0].tipo, 'INJERTO');
  assert.equal(atras.accesorios[0].partida_cotizap.beta_deg, 45);

  // un extremo que no llega a ningún equipo queda abierto y se pregunta
  const suelto = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0]], [['A-1', 'N-1', 'N-2', 8, 2]], [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO']])).lectura);
  assert.ok(codigos(suelto, 'CONFIRMAR').includes('TRAZO_SIN_CONECTAR'));
  assert.equal(suelto.ductos_rectos[0].extremo_fin, 'ABIERTO');
  assert.ok(!codigos(despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0]], [['A-1', 'N-1', 'N-2', 8, 2]], [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO']])).lectura, { 'N-2': { aceptado: true } })).includes('TRAZO_SIN_CONECTAR'));
});

test('Un ramal mayor que su tronco bloquea (la pieza no se fabrica) y un tramo corto entre accesorios se pregunta', () => {
  const mal = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 800, 0], ['N-4', 600, -200]],
    [['A-1', 'N-1', 'N-2', 10, 2], ['A-2', 'N-2', 'N-3', 6, 2], ['A-3', 'N-2', 'N-4', 8, 1]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-3', 'BRIDA_TALLER'], ['M2', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  assert.ok(codigos(mal, 'BLOQUEANTE').includes('DIAMETRO_INCONSISTENTE'));
  assert.equal(mal.resumen.estado, 'NO_COTIZABLE');
  // dos codos de 90° de 12″ a 0.9 m: cada uno ocupa 457.2 mm del tramo de en medio
  const corto = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 400, -200], ['N-4', 800, -200]],
    [['A-1', 'N-1', 'N-2', 12, 2], ['A-2', 'N-2', 'N-3', 12, 0.9], ['A-3', 'N-3', 'N-4', 12, 2]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  assert.ok(codigos(corto, 'BLOQUEANTE').includes('ACCESORIOS_ENCIMADOS'), 'no queda tramo recto');
  const justo = despiezar(UF.leer(planta(
    [['N-1', 0, 0], ['N-2', 400, 0], ['N-3', 400, -200], ['N-4', 800, -200]],
    [['A-1', 'N-1', 'N-2', 12, 2], ['A-2', 'N-2', 'N-3', 12, 1.0], ['A-3', 'N-3', 'N-4', 12, 2]],
    [['COL', 'COLECTOR', 'N-1', 'BRIDA_EQUIPO'], ['M1', 'MAQUINA', 'N-4', 'BRIDA_TALLER']])).lectura);
  assert.equal(ducto(justo, 'A-2').longitud_neta_mm, 85.6);
  assert.ok(codigos(justo, 'CONFIRMAR').includes('ACCESORIOS_ENCIMADOS'));
});

test('aPartidas: tramos, accesorios, soportes y compras, cada una con su pieza; todas se cotizan', () => {
  const bom = despiezar(lecturaEjemplo());
  const ps = UF.aPartidas(bom);
  assert.equal(ps.length, 22);
  assert.deepEqual(ps.slice(0, 2).map((p) => p.unifilar_id), ['DUCT-001', 'DUCT-002']);
  assert.ok(ps.some((p) => p.unifilar_id === 'COMPRA-MANGUERA_6' && p.familia === 'COMPRADO' && p.cantidad === 1));
  assert.ok(ps.some((p) => p.unifilar_id === 'SOP-001' && p.cantidad_modo === 'AUTO'));
  const res = C.cotizar({ partidas: ps }, M);
  assert.equal(res.partidas.filter((f) => !f.ok).length, 0);
  assert.equal(res.totales.n_partidas_error, 0);
  // no se comparten objetos con el despiece
  ps[0].L_mm = 1;
  assert.notEqual(bom.ductos_rectos[0].partida_cotizap.L_mm, 1);
});

test('respuestasValidas: sólo { elemento: { campo: valor } } con campos conocidos y valores simples', () => {
  assert.deepEqual(UF.respuestasValidas({
    'A-005': { longitud_m: 1.6, otro: 3 }, 'N-005': { angulo_deg: '30' }, 'EQ-01': { boca_in: Infinity }, metadatos: { aceptado: true },
    'mal id!': { longitud_m: 2 }, 'A-006': 'no', 'A-007': { posicion: { x: 1 } }, 'A-008': { posicion: 'x'.repeat(41) },
  }), { 'A-005': { longitud_m: 1.6 }, 'N-005': { angulo_deg: '30' }, metadatos: { aceptado: true } });
  assert.deepEqual(UF.respuestasValidas(null), {});
  assert.deepEqual(UF.respuestasValidas([1]), {});
});
