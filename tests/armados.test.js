'use strict';
/**
 * Conjuntos armados en taller (motor/armados.js): dos piezas que se unen en taller no llevan brida en las caras que se juntan.
 * Sugerencias con su ahorro real, reglas (pareja, Ø, caras libres, límite de 3,660 mm), partir y juntar partidas, compatibilidad con
 * cotizaciones sin armados y el JSON de ida y vuelta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const A = require('../src/motor/armados');
const LF = require('../src/motor/lista_fabricacion');
const E = require('../src/datos/ejemplos');

const M = crearMaestros();
const pulg = (x) => x * 25.4;
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const lam = { material_id: 'GALVANIZADO', calibre: 22, tipo_union: 'BRIDADO', ref_diametro: 'INTERIOR', cantidad: 1 };
const clon = (x) => JSON.parse(JSON.stringify(x));

// el caso: reducción con injerto 11→10 con injerto de 5″ a 30°, codo de 60° de 5″, recto de 5″ de 914 mm y codo de 90° de 5″
const reduccionInjerto = (extra) => ({ id: 'ri', familia: 'REDUCCION_INJERTO', ...lam, D1_mm: pulg(11), D2_mm: pulg(10), d_mm: pulg(5), beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450, ...extra });
const codo = (id, theta, extra) => ({ id, familia: 'CODO', ...lam, D_mm: pulg(5), theta_deg: theta, k_R: 1.5, n_gajos: theta === 90 ? 5 : 3, ...extra });
const recto = (extra) => ({ id: 'rt', familia: 'RECTO', ...lam, D_mm: pulg(5), L_mm: 914, ...extra });
const caso = () => ({ riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', yarda_mm: 914, partidas: [reduccionInjerto(), codo('c60', 60), recto(), codo('c90', 90)] });
// el subtotal REAL de la cotización (con el sobrante de lámina): es contra lo que se mide el ahorro de las sugerencias
const sub = (res) => res.totales.subtotal;
const porId = (cot, res, id) => res.partidas[cot.partidas.findIndex((p) => p.id === id)];
const caras = (f) => f.qto.her.bridas.map((b) => b.extremo);

test('Sugerir: injerto + codo de 60° (90°) y recto + codo de 90°, cada uno con ahorro; codo + codo no se sugiere', () => {
  const cot = caso();
  const res = C.cotizar(cot, M);
  const sug = A.sugerirArmados(cot, res, M);
  assert.equal(sug.length, 2);
  const [s1, s2] = sug;
  assert.ok(s1.ahorro >= s2.ahorro, 'de mayor a menor ahorro');
  const par = (s) => s.piezas.map((q) => q.partida).sort().join('+');
  const pares = sug.map(par).sort();
  assert.deepEqual(pares, ['c60+ri', 'c90+rt']);
  const inj = sug.find((s) => par(s) === 'c60+ri');
  assert.equal(inj.pareja, 'a');
  assert.equal(inj.angulo_deg, 90);
  assert.equal(inj.es_90, true);
  assert.equal(inj.piezas.find((q) => q.partida === 'ri').cara, 'injerto');
  const rec = sug.find((s) => par(s) === 'c90+rt');
  assert.equal(rec.pareja, 'b');
  assert.equal(rec.piezas.find((q) => q.partida === 'rt').cara, 'final');
  sug.forEach((s) => {
    assert.ok(s.ahorro > 0, 'ahorra');
    assert.equal(s.n, 1);
    assert.equal(s.junta, 'engargolada', 'galvanizado');
    assert.equal(s.D_mm, pulg(5));
    assert.ok(s.dim_mm > 0 && s.dim_mm <= s.limite_mm && s.limite_mm === 3660);
    // el desglose: aros, tornillos, juntas y mano de obra ahorran; las partes suman el ahorro del costo directo
    assert.ok(s.desglose.aros > 0 && s.desglose.tornillos > 0 && s.desglose.juntas > 0 && s.desglose.mano_obra > 0);
    casi(s.desglose.aros + s.desglose.tornillos + s.desglose.juntas + s.desglose.mano_obra + s.desglose.otros + s.desglose.bridas_otra_partida + s.desglose.sobrante, s.ahorro_costo, 1e-9);
    casi(s.antes - s.despues, s.ahorro, 0.006);
  });
  assert.ok(!sug.some((s) => s.piezas.every((q) => q.partida.startsWith('c'))), 'codo + codo no');
  // no modifica la cotización
  assert.deepEqual(cot, caso());
});

test('Aplicar las sugerencias: baja el subtotal de las partidas en la suma de los ahorros y se quitan los aros correctos', () => {
  const cot = caso();
  const res0 = C.cotizar(cot, M);
  const sug = A.sugerirArmados(cot, res0, M);
  sug.forEach((s) => assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true));
  assert.equal(cot.armados.length, 2);
  const res1 = C.cotizar(cot, M);
  assert.deepEqual(res1.armados.map((a) => [a.marca, a.ok]), [['E1', true], ['E2', true]]);
  assert.equal(res1.avisos.length, 0);
  // las partidas del usuario más las dos juntas de armado
  assert.equal(res1.partidas.length, 6);
  assert.equal(res1.totales.n_partidas_ok, 4, 'las juntas derivadas no cuentan como partidas del usuario');
  // el ahorro mostrado ya incluye el cambio del material sobrante de comprar piezas enteras: es el cambio real del subtotal
  casi(res0.totales.subtotal - res1.totales.subtotal, sug.reduce((s, x) => s + x.ahorro, 0), 0.006, 'el subtotal baja exactamente en la suma de los ahorros');
  casi(res0.totales.total - res1.totales.total, (res0.totales.subtotal - res1.totales.subtotal) * (1 + M.capas.iva_pct), 0.02, 'total = ahorros con IVA');
  assert.ok(res1.totales.total < res0.totales.total);
  // los aros que quedan: la reducción con injerto pierde el del injerto, el codo de 60° el A, el recto el de su extremo final, el codo de 90° el A
  assert.deepEqual(caras(porId(cot, res0, 'ri')), ['D1', 'D2', 'injerto']);
  assert.deepEqual(caras(porId(cot, res1, 'ri')), ['D1', 'D2']);
  assert.deepEqual(caras(porId(cot, res1, 'c60')), ['B']);
  assert.deepEqual(caras(porId(cot, res1, 'c90')), ['B']);
  assert.equal(porId(cot, res0, 'rt').qto.her.n_aros, 2);
  assert.equal(porId(cot, res1, 'rt').qto.her.n_aros, 1);
  assert.deepEqual(porId(cot, res1, 'ri').geometria.extremos_sin_brida, ['injerto']);
  // las juntas: una UNION por armado, del Ø común, derivada del armado
  const uniones = res1.partidas.filter((f) => f.entrada.familia === 'UNION');
  assert.equal(uniones.length, 2);
  uniones.forEach((u, i) => {
    assert.equal(u.ok, true);
    assert.equal(u.entrada.armado_id, cot.armados[i].id);
    assert.equal(u.entrada.D_mm, pulg(5));
    assert.equal(u.entrada.n_uniones, 1);
    assert.equal(u.geometria.costura, 'ENGARGOLADA');
    assert.ok(u.precio.importe > 0);
  });
  // la cotización del usuario no se tocó: las caras sin brida sólo existen en las partidas efectivas
  assert.equal(cot.partidas.every((p) => p.extremos_sin_brida === undefined && p.extremo_ajuste === undefined), true);
  // y con las caras armadas ya no hay más que sugerir (cada pieza que queda tiene otra cara pero ninguna otra pareja)
  assert.deepEqual(A.sugerirArmados(cot, res1, M).map((s) => s.piezas.map((q) => q.partida).sort().join('+')), []);
});

test('Acero al carbón: la junta es soldada', () => {
  const cot = caso();
  cot.partidas.forEach((p) => { p.material_id = 'ACERO_CARBON'; p.calibre = 16; });
  const sug = A.sugerirArmados(cot, null, M);
  assert.ok(sug.length >= 1);
  sug.forEach((s) => assert.equal(s.junta, 'soldada'));
  A.armar(cot, sug[0].piezas, sug[0].n, M);
  const res = C.cotizar(cot, M);
  const u = res.partidas.find((f) => f.entrada.familia === 'UNION');
  assert.equal(u.geometria.costura, 'SOLDADA');
  assert.ok(u.geometria.sold.filete_m > 0);
  assert.deepEqual(LF.conjuntosDe(res, [])[0].junta, 'soldada');
});

test('Límite de 3,660 mm: un recto de 3,500 mm con un codo no cabe y no se sugiere; el límite es política editable', () => {
  const cot = { yarda_mm: 914, partidas: [recto({ L_mm: 3500 }), codo('c90', 90)] };
  assert.deepEqual(A.sugerirArmados(cot, null, M), []);
  const v = A.validarArmado(cot.partidas, { id: 'x', piezas: [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], n: 1 }, M);
  assert.equal(v.ok, false);
  assert.match(v.errores.join(' '), /mediría hasta 3,8\d\d mm y el máximo .* es 3,660 mm/);
  assert.ok(v.dim_mm > 3660);
  // un recto de 3,000 mm sí cabe
  cot.partidas[0].L_mm = 3000;
  assert.equal(A.sugerirArmados(cot, null, M).length, 1);
  // la política vive en maestros: con 3,500 mm de límite ya no cabe y con 5,000 mm sí cabe el de 3,500
  assert.equal(M.proceso.conjuntos_armados.dim_max_mm, 3660);
  assert.deepEqual(A.sugerirArmados(cot, null, crearMaestros({ proceso: { conjuntos_armados: { dim_max_mm: 3300 } } })), []);
  cot.partidas[0].L_mm = 3500;
  assert.equal(A.sugerirArmados(cot, null, crearMaestros({ proceso: { conjuntos_armados: { dim_max_mm: 5000 } } })).length, 1);
});

test('Validaciones: Ø distinto, pareja no permitida, caras inexistentes u ocupadas, material distinto', () => {
  const ok = (ps, piezas, n) => A.validarArmado(ps, { id: 'v', piezas, n: n === undefined ? 1 : n }, M);
  const base = [reduccionInjerto(), codo('c60', 60), recto(), codo('c90', 90), codo('c45', 45)];
  assert.equal(ok(base, [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'A' }]).ok, true);
  // Ø distinto
  const seis = [...base, { ...codo('c6', 90), D_mm: pulg(6) }];
  let v = ok(seis, [{ partida: 'rt', cara: 'final' }, { partida: 'c6', cara: 'A' }]);
  assert.equal(v.ok, false);
  assert.match(v.errores.join(' '), /no miden lo mismo: 5″ .* contra 6″/);
  // la cara del tronco de la reducción con injerto es de 11″ o 10″, no de 5″
  v = ok(base, [{ partida: 'ri', cara: 'D1' }, { partida: 'c60', cara: 'A' }]);
  assert.equal(v.ok, false);
  assert.match(v.errores.join(' '), /no miden lo mismo/);
  // pareja no permitida: codo + codo, recto + recto, el injerto con un codo que no lo deja a 90°
  v = ok(base, [{ partida: 'c60', cara: 'A' }, { partida: 'c90', cara: 'A' }]);
  assert.match(v.errores.join(' '), /No se arma un codo con otro codo/);
  v = ok([...base, recto({ id: 'rt2' })], [{ partida: 'rt', cara: 'final' }, { partida: 'rt2', cara: 'final' }]);
  assert.match(v.errores.join(' '), /Pareja no permitida/);
  v = ok(base, [{ partida: 'ri', cara: 'injerto' }, { partida: 'c90', cara: 'A' }]);
  assert.equal(v.ok, false);
  assert.equal(v.angulo_deg, 120);
  assert.equal(v.es_90, false);
  assert.match(v.errores.join(' '), /sale a 120°, no a 90°: use un codo de 60°/);
  // el injerto se arma por su cara «injerto», no por el tronco
  v = ok([reduccionInjerto({ d_mm: pulg(10) - 0.001 }), codo('cc', 60, { D_mm: pulg(10) - 0.001 })], [{ partida: 'ri', cara: 'D2' }, { partida: 'cc', cara: 'A' }]);
  assert.equal(v.ok, false);
  // caras inexistentes
  v = ok(base, [{ partida: 'rt', cara: 'A' }, { partida: 'c60', cara: 'C' }]);
  assert.match(v.errores.join(' '), /La cara «A» no existe/);
  // partida inexistente, la misma partida dos veces, n inválido
  assert.match(ok(base, [{ partida: 'nada', cara: 'A' }, { partida: 'c60', cara: 'A' }]).errores.join(' '), /ya no existe/);
  assert.match(ok(base, [{ partida: 'c60', cara: 'A' }, { partida: 'c60', cara: 'B' }]).errores.join(' '), /partidas distintas/);
  assert.match(ok(base, [{ partida: 'rt', cara: 'final' }, { partida: 'c60', cara: 'A' }], 0).errores.join(' '), /entero de 1 a 50/);
  // cara ocupada: ya va sin brida a mano, el extremo final del recto ya es SIN_BRIDA o SUELTA
  const ocupadas = [reduccionInjerto(), codo('c60', 60, { extremos_sin_brida: ['A'] }), recto({ extremo_ajuste: 'SIN_BRIDA' }), codo('c90', 90)];
  v = ok(ocupadas, [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'A' }]);
  assert.match(v.errores.join(' '), /no está libre: esa cara ya va sin brida/);
  assert.equal(ok(ocupadas, [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'B' }]).ok, true, 'la otra cara del codo sí');
  v = ok(ocupadas, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }]);
  assert.match(v.errores.join(' '), /el extremo final del tramo ya va sin brida/);
  ocupadas[2].extremo_ajuste = 'SUELTA';
  assert.match(ok(ocupadas, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }]).errores.join(' '), /brida suelta/);
  ocupadas[2].extremo_ajuste = 'CON_BRIDA';
  assert.equal(ok(ocupadas, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }]).ok, true);
  // otro armado en esa cara
  const otro = [{ id: 'a1', piezas: [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'A' }], n: 1 }];
  v = A.validarArmado(base, { id: 'a2', piezas: [{ partida: 'rt', cara: 'final' }, { partida: 'c60', cara: 'A' }], n: 1 }, M, { armados: otro });
  assert.match(v.errores.join(' '), /ya está armada \(a1\)/);
  assert.equal(A.validarArmado(base, { id: 'a2', piezas: [{ partida: 'rt', cara: 'final' }, { partida: 'c60', cara: 'B' }], n: 1 }, M, { armados: otro }).ok, true);
  // material distinto, pieza sin bridas, rectangular
  v = ok([recto(), codo('cx', 90, { material_id: 'ACERO_CARBON', calibre: 16 })], [{ partida: 'rt', cara: 'final' }, { partida: 'cx', cara: 'A' }]);
  assert.match(v.errores.join(' '), /mismo material y calibre/);
  v = ok([recto(), codo('cl', 90, { tipo_union: 'LISO' })], [{ partida: 'rt', cara: 'final' }, { partida: 'cl', cara: 'A' }]);
  assert.match(v.errores.join(' '), /no lleva bridas/);
  v = ok([recto(), { id: 'cr', familia: 'CODO', ...lam, forma: 'RECTANGULAR', a_mm: 300, b_mm: 200, theta_deg: 90 }], [{ partida: 'rt', cara: 'final' }, { partida: 'cr', cara: 'A' }]);
  assert.match(v.errores.join(' '), /sólo se arman piezas redondas/);
  // las cantidades deben ser las del armado (se parten al aceptar)
  v = ok([recto({ cantidad: 3 }), codo('c90', 90)], [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }]);
  assert.match(v.errores.join(' '), /tiene 3 piezas y el armado es de 1/);
});

test('Injerto a 45°: la pareja es con un codo de 45° (β + θ = 90°)', () => {
  const cot = { yarda_mm: 914, partidas: [reduccionInjerto({ beta_deg: 45 }), codo('c60', 60), codo('c45', 45)] };
  const sug = A.sugerirArmados(cot, null, M);
  assert.equal(sug.length, 1);
  assert.deepEqual(sug[0].piezas.map((q) => q.partida).sort(), ['c45', 'ri']);
  assert.equal(sug[0].angulo_deg, 90);
  assert.equal(A.validarArmado(cot.partidas, { id: 'x', piezas: [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'A' }], n: 1 }, M).angulo_deg, 105);
  // el injerto simple (RAMAL) también se arma con el codo
  const ramal = { id: 'rm', familia: 'RAMAL', ...lam, D_mm: pulg(8), d_mm: pulg(5), beta_deg: 30, L_cuerpo_mm: 600, L_ramal_mm: 500 };
  const s2 = A.sugerirArmados({ partidas: [ramal, codo('c60', 60)] }, null, M);
  assert.equal(s2.length, 1);
  assert.equal(s2[0].piezas.find((q) => q.partida === 'rm').cara, 'injerto');
  assert.equal(s2[0].angulo_deg, 90);
});

test('Reducción con la pieza de su lado: codo, recto, injerto o reducción con injerto del mismo Ø; no con otra reducción', () => {
  const red = { id: 'rd', familia: 'REDUCCION', ...lam, D1_mm: pulg(8), D2_mm: pulg(5), L_mm: 600 };
  const cot = { yarda_mm: 914, partidas: [red, { ...codo('cA', 90), D_mm: pulg(8) }] };
  let sug = A.sugerirArmados(cot, null, M);
  assert.equal(sug.length, 1);
  assert.equal(sug[0].pareja, 'c');
  assert.equal(sug[0].piezas.find((q) => q.partida === 'rd').cara, 'D1', 'el codo de 8″ va en el extremo mayor');
  // un recto de 5″ se une por el extremo menor
  cot.partidas = [red, recto({ id: 'r5' })];
  sug = A.sugerirArmados(cot, null, M);
  assert.equal(sug.length, 1);
  assert.equal(sug[0].piezas.find((q) => q.partida === 'rd').cara, 'D2');
  // una reducción con otra reducción: no
  cot.partidas = [red, { ...red, id: 'rd2', D1_mm: pulg(5), D2_mm: pulg(4) }];
  assert.deepEqual(A.sugerirArmados(cot, null, M), []);
  // reducción con injerto (por su extremo mayor) y reducción: el Ø de D1 coincide con el D1 de la reducción
  cot.partidas = [{ ...red, D1_mm: pulg(11), D2_mm: pulg(10) }, reduccionInjerto({ D1_mm: pulg(12), D2_mm: pulg(11) })];
  sug = A.sugerirArmados(cot, null, M);
  assert.equal(sug.length, 1);
  assert.deepEqual(sug[0].piezas.map((q) => `${q.partida}:${q.cara}`).sort(), ['rd:D1', 'ri:D2']);
  // el injerto simple por su tronco
  cot.partidas = [red, { id: 'rm', familia: 'RAMAL', ...lam, D_mm: pulg(5), d_mm: pulg(3), beta_deg: 30, L_cuerpo_mm: 500, L_ramal_mm: 300 }];
  sug = A.sugerirArmados(cot, null, M);
  assert.equal(sug.length, 1);
  assert.match(sug[0].piezas.find((q) => q.partida === 'rm').cara, /^tronco_/);
});

test('Una partida en varias parejas: la de mayor ahorro, sin repetir piezas', () => {
  // el codo de 60° puede ir con la reducción con injerto o con el recto; sólo con una (la que más ahorra)
  const cot = { yarda_mm: 914, partidas: [reduccionInjerto(), codo('c60', 60), recto()] };
  const res = C.cotizar(cot, M);
  const sug = A.sugerirArmados(cot, res, M);
  assert.equal(sug.length, 1);
  const usadas = sug.flatMap((s) => s.piezas.map((q) => q.partida));
  assert.equal(new Set(usadas).size, usadas.length);
  assert.ok(usadas.includes('c60'));
  // tras aceptarla, la otra cara del codo ya no está en la sugerencia anterior, pero queda libre para la siguiente ronda
  A.armar(cot, sug[0].piezas, 1, M);
  const otra = A.sugerirArmados(cot, null, M);
  assert.equal(otra.length, 1);
  const q = otra[0].piezas.find((x) => x.partida === 'c60');
  assert.equal(q.cara, 'B');
});

test('Partir y juntar cantidades: n armadas y el resto normal; al deshacer se vuelven a juntar si son idénticas', () => {
  const cot = { riesgo: 'MEDIO', yarda_mm: 914, partidas: [recto({ cantidad: 1 }), codo('c90', 90, { cantidad: 3 })] };
  const original = clon(cot);
  const res0 = C.cotizar(cot, M);
  const sug = A.sugerirArmados(cot, res0, M);
  assert.equal(sug.length, 1);
  assert.equal(sug[0].n, 1, 'n = lo que cabe en la partida con menos piezas');
  // el ahorro es el de las partidas con y sin armado, partiendo la de 3 codos en 2 + 1
  const r = A.armar(cot, sug[0].piezas, sug[0].n, M, { nuevoId: () => 'nuevo1' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.partidas_nuevas, ['nuevo1']);
  assert.deepEqual(cot.partidas.map((p) => [p.id, p.cantidad]), [['rt', 1], ['c90', 2], ['nuevo1', 1]]);
  assert.deepEqual(cot.armados[0].piezas, [{ partida: 'rt', cara: 'final', origen: 'rt' }, { partida: 'nuevo1', cara: 'A', origen: 'c90' }]);
  const res1 = C.cotizar(cot, M);
  casi(sub(res0) - sub(res1), sug[0].ahorro, 0.006, 'el ahorro prometido es el real, con la partida partida');
  assert.deepEqual(res1.partidas[1].geometria.extremos_sin_brida, [], 'los 2 codos del resto quedan con sus dos bridas');
  assert.deepEqual(res1.partidas[2].geometria.extremos_sin_brida, ['A'], 'el codo armado pierde la brida del extremo A');
  assert.equal(res1.partidas[2].entrada.cantidad, 1);
  // deshacer: las dos partidas de codos vuelven a ser una, con la cantidad y el id de la primera
  const d = A.deshacerArmado(cot, cot.armados[0].id);
  assert.deepEqual(d, { ok: true, juntadas: 1 });
  assert.deepEqual(cot.partidas, original.partidas);
  assert.equal(cot.armados.length, 0);
  assert.equal(C.cotizar(cot, M).totales.total, res0.totales.total);
  // si la parte armada ya no es idéntica (se editó), no se junta
  A.armar(cot, sug[0].piezas, 1, M, { nuevoId: () => 'nuevo2' });
  cot.partidas[2].descripcion = 'Codo especial';
  assert.deepEqual(A.deshacerArmado(cot, cot.armados[0].id), { ok: true, juntadas: 0 });
  assert.equal(cot.partidas.length, 3);
  // con la misma cantidad no se parte nada
  const c2 = { yarda_mm: 914, partidas: [recto({ cantidad: 2 }), codo('c90', 90, { cantidad: 2 })] };
  const s2 = A.sugerirArmados(c2, null, M);
  assert.equal(s2[0].n, 2);
  const r2 = A.armar(c2, s2[0].piezas, 2, M);
  assert.deepEqual(r2.partidas_nuevas, []);
  assert.equal(c2.partidas.length, 2);
  assert.equal(C.cotizar(c2, M).partidas.find((f) => f.entrada.familia === 'UNION').entrada.n_uniones, 2);
  assert.equal(A.deshacerArmado(c2, 'no-existe').ok, false);
  // un armado inválido no cambia nada
  const antes = clon(c2);
  assert.equal(A.armar(c2, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 2, M).ok, false, 'las caras ya están armadas');
  assert.deepEqual(c2, antes);
});

test('Deshacer un armado cuando el codo está en otro: no se junta lo que sigue armado', () => {
  const cot = { yarda_mm: 914, partidas: [reduccionInjerto(), codo('c60', 60, { cantidad: 2 }), recto(), codo('c90', 90)] };
  A.armar(cot, [{ partida: 'ri', cara: 'injerto' }, { partida: 'c60', cara: 'A' }], 1, M, { nuevoId: () => 'n1' });
  A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'n1', cara: 'B' }], 1, M);
  assert.deepEqual(cot.partidas.map((p) => [p.id, p.cantidad]), [['ri', 1], ['c60', 1], ['n1', 1], ['rt', 1], ['c90', 1]]);
  // se deshace el primero: el codo n1 sigue armado con el recto, así que no se junta con c60
  assert.deepEqual(A.deshacerArmado(cot, cot.armados[0].id), { ok: true, juntadas: 0 });
  assert.equal(cot.partidas.length, 5);
  const res = C.cotizar(cot, M);
  assert.deepEqual(res.armados.map((a) => [a.marca, a.ok]), [['E1', true]]);
  assert.deepEqual(res.partidas[2].geometria.extremos_sin_brida, ['B']);
});

test('Cotizaciones sin armados dan exactamente lo mismo que antes', () => {
  // los totales de las muestras, calculados con la versión anterior a los armados
  const pedido = C.cotizar(E.pedidoDucteria(), M);
  assert.equal(pedido.totales.total, 54254.29);
  assert.equal(pedido.totales.subtotal, 46770.94);
  assert.equal(pedido.partidas.length, 36);
  assert.equal(pedido.automaticas.length, 1);
  assert.deepEqual(pedido.armados, []);
  const gastos = C.cotizar(E.casoControlGastos(), M);
  assert.equal(gastos.totales.total, 83512.58);
  assert.equal(gastos.partidas.length, 13);
  // sin armados, o con una lista vacía, o mal formada: el mismo resultado byte a byte
  const cot = E.pedidoDucteria();
  const a = JSON.stringify(C.cotizar(cot, M));
  assert.equal(JSON.stringify(C.cotizar({ ...cot, armados: [] }, M)), a);
  assert.equal(JSON.stringify(C.cotizar({ ...cot, armados: 'basura' }, M)), a);
  assert.equal(JSON.stringify(C.cotizar({ ...cot, armados: [null, 3] }, M)), a, 'lo que no es un armado se ignora');
  const malo = C.cotizar({ ...cot, armados: [{ id: 'x', piezas: 'x' }] }, M);
  assert.equal(malo.totales.total, pedido.totales.total, 'un armado mal formado no cambia el precio');
  assert.match(malo.avisos.join(' '), /Armado E1: El armado debe unir exactamente dos piezas/);
  // la lista de partidas es la misma (no se copia) cuando no hay armados
  assert.equal(A.aplicarArmados(cot.partidas, undefined, M).partidas, cot.partidas);
  assert.equal(A.aplicarArmados(cot.partidas, [], M).partidas, cot.partidas);
  // las partidas manuales con «extremos sin brida» y UNION a mano siguen como estaban: sus caras no se vuelven a sugerir
  cot.partidas.forEach((p, i) => { p.id = `p${i}`; });
  const sug = A.sugerirArmados(cot, null, M);
  sug.forEach((s) => assert.ok(s.ahorro > 0 && s.dim_mm <= 3660));
});

test('Un armado que ya no vale (se editó la partida o se borró) se avisa y se cotiza sin armar', () => {
  const cot = caso();
  const sug = A.sugerirArmados(cot, null, M);
  sug.forEach((s) => A.armar(cot, s.piezas, s.n, M));
  const total = C.cotizar(cot, M).totales.total;
  // el codo cambia de Ø: el armado deja de valer
  const roto = clon(cot);
  roto.partidas.find((p) => p.id === 'c60').D_mm = pulg(6);
  const r = C.cotizar(roto, M);
  assert.equal(r.armados[0].ok, false);
  assert.equal(r.armados[1].ok, true);
  assert.match(r.avisos.join(' '), /Armado E\d: Las caras que se unen no miden lo mismo.*Se cotiza sin armar/);
  assert.equal(r.partidas.filter((f) => f.entrada.familia === 'UNION').length, 1, 'sólo la junta del armado vigente');
  // la partida se borra
  const sinRecto = clon(cot);
  sinRecto.partidas = sinRecto.partidas.filter((p) => p.id !== 'rt');
  const r2 = C.cotizar(sinRecto, M);
  assert.match(r2.avisos.join(' '), /ya no existe en la cotización/);
  assert.ok(r2.totales.total > 0 && total > 0);
  // el armado no válido tampoco quita bridas
  assert.deepEqual(caras(r2.partidas.find((f) => f.entrada.id === 'c90')), ['A', 'B']);
  // un recto cuya cantidad cambió no cuadra con el armado
  const cant = clon(cot);
  cant.partidas.find((p) => p.id === 'rt').cantidad = 2;
  assert.match(C.cotizar(cant, M).avisos.join(' '), /tiene 2 piezas y el armado es de 1/);
});

test('JSON de ida y vuelta: la cotización con armados da el mismo resultado; los armados mal formados se descartan', () => {
  const cot = caso();
  A.sugerirArmados(cot, null, M).forEach((s) => A.armar(cot, s.piezas, s.n, M));
  const vuelta = JSON.parse(JSON.stringify(cot));
  assert.deepEqual(vuelta, cot);
  assert.equal(C.cotizar(vuelta, M).totales.total, C.cotizar(cot, M).totales.total);
  assert.deepEqual(A.limpiarArmados(vuelta.armados), vuelta.armados, 'limpiar es idempotente');
  assert.deepEqual(A.limpiarArmados([
    { id: 'a1', piezas: [{ partida: 'x', cara: 'A' }, { partida: 'y', cara: 'B' }], n: 2 },
    { id: 'a1', piezas: [{ partida: 'x', cara: 'B' }, { partida: 'z', cara: 'B' }], n: 99 },
    { piezas: [{ partida: 'x', cara: 'A' }] }, null, 'texto', { id: 'a3', piezas: [{ partida: 1, cara: 'A' }, { partida: 'y', cara: 'A' }] },
  ]).map((a) => [a.id === 'a1' || /^a/.test(a.id), a.piezas.length, a.n]), [[true, 2, 2], [true, 2, 1]]);
  assert.deepEqual(A.limpiarArmados(undefined), []);
  // la lista de fabricación trae los conjuntos con las marcas de sus piezas
  const res = C.cotizar(cot, M);
  const lista = LF.listaFabricacion(cot, res, M);
  assert.equal(lista.totales.armados, 2);
  assert.equal(lista.totales.conjuntos, 2);
  assert.equal(lista.conjuntos.length, 2);
  const e1 = lista.conjuntos[0];
  assert.equal(e1.marca, 'E1');
  assert.equal(e1.junta, 'engargolada');
  assert.match(e1.nota, /^Se arma en taller: sin brida en esta cara; junta engargolada\.$/);
  assert.deepEqual(e1.piezas.map((q) => q.marca).sort(), ['C1', 'I1'], 'las marcas son las de Planos: injerto I1 y codo C1');
  assert.deepEqual(e1.piezas.map((q) => q.cara).sort(), ['A', 'injerto']);
  assert.equal(e1.angulo_deg, 90);
  const c1 = lista.piezas.find((q) => q.marca === 'C1');
  assert.match(c1.notas.join(' '), /Conjunto E1: se arma en taller con I1/);
  assert.equal(lista.piezas.length, 4, 'las juntas derivadas no son piezas de la lista');
  assert.equal(lista.aparte.length, 0);
});

test('Cantidades y ahorro: la UNION de un armado de varias piezas lleva n uniones y el ahorro es el del lote', () => {
  const cot = { yarda_mm: 914, partidas: [recto({ cantidad: 4 }), codo('c90', 90, { cantidad: 4 })] };
  const sug = A.sugerirArmados(cot, null, M);
  const uno = A.sugerirArmados({ yarda_mm: 914, partidas: [recto(), codo('c90', 90)] }, null, M);
  assert.equal(sug[0].n, 4);
  assert.ok(sug[0].ahorro > 3.5 * uno[0].ahorro, 'cuatro conjuntos ahorran cuatro veces lo de uno (la junta se cobra una vez, con su montaje)');
});

/* ------------------------------------------------------------------ */
/* Bridas de otra partida (bridas_aparte): el armado las libera y se descuentan de la partida de bridas */
/* ------------------------------------------------------------------ */

const aparte = { bridas_aparte: true };
const brida5 = (cantidad, extra) => ({ id: 'br', familia: 'BRIDA', material_id: 'GALVANIZADO', calibre: 22, ref_diametro: 'INTERIOR', D_mm: pulg(5), cantidad, ...extra });
const comprada5 = (cantidad) => ({ id: 'cp', familia: 'COMPRADO', articulo_id: 'BRIDA_PLACA_5', cantidad });
const casoAparte = (n, stock) => ({
  riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', yarda_mm: 914,
  partidas: [recto({ ...aparte, cantidad: n }), codo('c90', 90, { ...aparte, cantidad: n }), ...stock],
});
const cuadre5 = (res) => res.bridas.filas.find((f) => f.D_nom_mm === pulg(5));

test('Bridas de otra partida: el ahorro incluye la brida que se libera y coincide con el cambio real de cotizar()', () => {
  const cot = casoAparte(1, [brida5(4)]);
  const res0 = C.cotizar(cot, M);
  assert.equal(res0.bridas.cuadra, true, 'cuadrado antes: piden 4, hay 4');
  const sug = A.sugerirArmados(cot, res0, M);
  assert.equal(sug.length, 1);
  const s = sug[0];
  assert.equal(s.bridas_liberadas, 2);
  assert.equal(s.bridas_consumidas, 2);
  assert.ok(s.desglose.bridas_otra_partida > 0 && s.ahorro_bridas > 0);
  assert.equal(s.bridas[0].de[0].partida, 'br');
  casi(s.antes - s.despues, s.ahorro, 0.006);
  assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true);
  const res1 = C.cotizar(cot, M);
  casi(sub(res0) - sub(res1), s.ahorro, 0.006, 'el ahorro es el cambio medido del subtotal');
  assert.ok(s.ahorro > 0);
  // la partida de bridas baja en 2n y el cuadre sigue cuadrado: piden 2, hay 2
  assert.equal(porId(cot, res1, 'br').entrada.cantidad, 2);
  assert.equal(porId(cot, res1, 'br').armados_consumidas, 2);
  assert.equal(porId(cot, res1, 'br').cantidad_capturada, 4);
  assert.equal(res1.bridas.cuadra, true);
  assert.deepEqual([cuadre5(res1).piden, cuadre5(res1).hay, cuadre5(res1).armados], [2, 2, 2]);
  assert.equal(res1.bridas.armados, 2);
  assert.equal(res1.armados[0].bridas_consumidas, 2);
  assert.equal(res1.avisos.length, 0);
  // la cotización del usuario no se toca
  assert.equal(cot.partidas.find((p) => p.id === 'br').cantidad, 4);
});

test('Bridas de otra partida: n conjuntos descuentan 2n y res.partidas sigue alineado con cot.partidas', () => {
  const cot = casoAparte(3, [brida5(12)]);
  const res0 = C.cotizar(cot, M);
  assert.equal(res0.bridas.cuadra, true);
  const s = A.sugerirArmados(cot, res0, M)[0];
  assert.equal(s.n, 3);
  assert.equal(s.bridas_consumidas, 6);
  A.armar(cot, s.piezas, s.n, M);
  const antes = clon(cot.partidas);
  const res1 = C.cotizar(cot, M);
  assert.deepEqual(cot.partidas, antes, 'cotizar no muta cot.partidas');
  assert.equal(res1.partidas.length, cot.partidas.length + 1, 'la UNION derivada va al final');
  cot.partidas.forEach((p, i) => assert.equal(res1.partidas[i].entrada.familia, p.familia, 'alineada'));
  assert.equal(res1.partidas[cot.partidas.length].entrada.familia, 'UNION');
  assert.equal(porId(cot, res1, 'br').entrada.cantidad, 6);
  assert.equal(res1.bridas.cuadra, true);
});

test('Bridas de otra partida: sin partida BRIDA del Ø se descuenta de las bridas compradas del ducto', () => {
  const cot = casoAparte(1, [comprada5(4)]);
  const res0 = C.cotizar(cot, M);
  assert.equal(res0.bridas.cuadra, true);
  const s = A.sugerirArmados(cot, res0, M)[0];
  assert.equal(s.bridas[0].de[0].tipo, 'COMPRADO');
  A.armar(cot, s.piezas, s.n, M);
  const res1 = C.cotizar(cot, M);
  casi(sub(res0) - sub(res1), s.ahorro, 0.006);
  assert.equal(porId(cot, res1, 'cp').entrada.cantidad, 2);
  assert.equal(res1.bridas.cuadra, true);
  // y si hay las dos, primero la de taller y luego la comprada
  const c2 = casoAparte(1, [brida5(1), comprada5(3)]);
  const s2 = A.sugerirArmados(c2, null, M)[0];
  assert.deepEqual(s2.bridas[0].de.map((x) => [x.tipo, x.consumidas]), [['BRIDA', 1], ['COMPRADO', 1]]);
  A.armar(c2, s2.piezas, s2.n, M);
  const r2 = C.cotizar(c2, M);
  assert.equal(porId(c2, r2, 'br').entrada.cantidad, 0);
  assert.equal(porId(c2, r2, 'cp').entrada.cantidad, 2);
  assert.equal(r2.bridas.cuadra, true);
});

test('Bridas de otra partida: sin partida de bridas de ese Ø no se descuenta nada (el cuadre muestra que sobran)', () => {
  const cot = casoAparte(1, [brida5(4, { D_mm: pulg(6) })]);
  const res0 = C.cotizar(cot, M);
  assert.deepEqual(A.sugerirArmados(cot, res0, M), [], 'sin las bridas que se ahorran el armado no conviene');
  A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 1, M);
  const res1 = C.cotizar(cot, M);
  assert.equal(porId(cot, res1, 'br').entrada.cantidad, 4, 'la de 6″ no se toca');
  assert.equal(porId(cot, res1, 'br').armados_consumidas, undefined);
  assert.match(res1.avisos.join(' '), /libera 2 bridas que están en otra partida y no hay una partida de bridas del mismo diámetro/);
  assert.equal(res1.armados[0].bridas_consumidas, 0);
  assert.equal(res1.bridas.armados, 0);
});

test('Bridas de otra partida: varias sugerencias compiten por un stock limitado y no gastan más de lo que hay', () => {
  // dos pares (recto + codo) que liberan 2 bridas cada uno; la partida de bridas tiene 3
  const cot = {
    yarda_mm: 914,
    partidas: [recto({ ...aparte, id: 'r1' }), codo('k1', 90, aparte), recto({ ...aparte, id: 'r2', L_mm: 1828 }), codo('k2', 90, aparte), brida5(3)],
  };
  const sug = A.sugerirArmados(cot, null, M);
  const consumidas = sug.reduce((s, x) => s + x.bridas_consumidas, 0);
  assert.ok(sug.length >= 1);
  assert.ok(consumidas <= 3, `no se descuentan más de las 3 que hay (${consumidas})`);
  sug.forEach((s) => assert.ok(s.ahorro > 0));
  // aplicadas todas las sugeridas, la partida de bridas no queda negativa y el ahorro total coincide con lo medido
  const res0 = C.cotizar(cot, M);
  sug.forEach((s) => A.armar(cot, s.piezas, s.n, M));
  const res1 = C.cotizar(cot, M);
  assert.ok(porId(cot, res1, 'br').entrada.cantidad >= 0);
  casi(sub(res0) - sub(res1), sug.reduce((s, x) => s + x.ahorro, 0), 0.01);
});

test('Bridas de otra partida: si se descuentan todas la partida queda en $0 y sin error', () => {
  const cot = casoAparte(1, [brida5(2)]);
  const res0 = C.cotizar(cot, M);
  const s = A.sugerirArmados(cot, res0, M)[0];
  assert.equal(s.bridas_consumidas, 2);
  A.armar(cot, s.piezas, s.n, M);
  const res1 = C.cotizar(cot, M);
  const f = porId(cot, res1, 'br');
  assert.equal(f.ok, true);
  assert.equal(f.agotada_por_armados, true);
  assert.equal(f.entrada.cantidad, 0);
  assert.equal(f.precio.importe, 0);
  assert.equal(f.costos.CD, 0);
  assert.equal(f.peso.neto_total_kg, 0);
  assert.equal(res1.totales.n_partidas_error, 0);
  casi(sub(res0) - sub(res1), s.ahorro, 0.006);
  assert.equal(cuadre5(res1).diferencia, cuadre5(res0).diferencia, 'el cuadre queda igual de desajustado (faltaban 2 desde el principio)');
  assert.equal(res1.avisos.length, 0);
  // lo comprado en cero tampoco cuenta en la lista de compras
  const c2 = casoAparte(1, [comprada5(2)]);
  const s2 = A.sugerirArmados(c2, null, M)[0];
  A.armar(c2, s2.piezas, s2.n, M);
  const r2 = C.cotizar(c2, M);
  assert.equal(porId(c2, r2, 'cp').precio.importe, 0);
  assert.equal(r2.compras.comprados.some((x) => x.cantidad === 0), false);
});

test('Bridas de otra partida: si se borra o se reduce la partida de bridas, se descuenta lo que hay y nunca queda negativa', () => {
  const cot = casoAparte(1, [brida5(4)]);
  const s = A.sugerirArmados(cot, null, M)[0];
  A.armar(cot, s.piezas, s.n, M);
  // se reduce a 1: sólo se puede descontar 1
  cot.partidas.find((p) => p.id === 'br').cantidad = 1;
  const r1 = C.cotizar(cot, M);
  assert.equal(porId(cot, r1, 'br').entrada.cantidad, 0);
  assert.equal(r1.armados[0].bridas_consumidas, 1);
  assert.equal(r1.armados[0].bridas_liberadas, 2);
  assert.match(r1.avisos.join(' '), /sólo se pudieron descontar 1/);
  // se borra: no hay de dónde descontar y el armado sigue válido
  cot.partidas = cot.partidas.filter((p) => p.id !== 'br');
  const r2 = C.cotizar(cot, M);
  assert.equal(r2.armados[0].ok, true);
  assert.equal(r2.armados[0].bridas_consumidas, 0);
  assert.ok(r2.partidas.every((f) => f.ok));
  // deshacer sigue funcionando
  assert.equal(A.deshacerArmado(cot, cot.armados[0].id).ok, true);
});

test('Ejemplo del pedido del 30-sep: las bridas de otra partida dan sugerencias con ahorro y el cuadre no se desajusta', () => {
  const cot = E.pedidoDucteria();
  cot.partidas.forEach((p, i) => { p.id = `p${i}`; });
  const res0 = C.cotizar(cot, M);
  const dif0 = res0.bridas.filas.map((f) => [f.D_nom_mm, f.diferencia]);
  const sug = A.sugerirArmados(cot, res0, M);
  assert.ok(sug.length >= 3, `hay sugerencias (${sug.length})`);
  sug.forEach((s) => { assert.ok(s.ahorro > 0); assert.ok(s.ahorro_bridas > 0); });
  assert.ok(sug.reduce((s, x) => s + x.bridas_consumidas, 0) > 0);
  for (let ronda = 0; ronda < 6; ronda += 1) {
    const r = C.cotizar(cot, M);
    const nuevas = A.sugerirArmados(cot, r, M);
    if (!nuevas.length) break;
    nuevas.forEach((s) => assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true));
  }
  const res1 = C.cotizar(cot, M);
  assert.equal(res1.totales.n_partidas_error, 0);
  assert.ok(res1.totales.total < res0.totales.total);
  assert.deepEqual(res1.bridas.filas.map((f) => [f.D_nom_mm, f.diferencia]), dif0, 'descontar lo que se libera no cambia lo que sobra o falta');
  assert.ok(res1.bridas.armados > 0);
  assert.ok(res1.partidas.every((f) => f.ok));
});

test('Bridas de otra partida: la lista de fabricación usa la cantidad efectiva de bridas y anota lo que se ahorra; una partida agotada va «aparte»', () => {
  const cot = casoAparte(1, [brida5(6)]);
  const s = A.sugerirArmados(cot, null, M)[0];
  A.armar(cot, s.piezas, s.n, M);
  const lista = LF.listaFabricacion(cot, C.cotizar(cot, M), M);
  const b = lista.piezas.find((q) => q.id === 'br');
  assert.equal(b.cantidad, 4, 'las 6 capturadas menos las 2 que se ahorran');
  assert.ok(b.notas.some((n) => /2 se ahorran por conjuntos armados/.test(n)), b.notas.join(' | '));
  // si se ahorran todas, la partida no es una tarjeta: se explica en «No se fabrican aquí»
  const c2 = casoAparte(1, [brida5(2)]);
  A.armar(c2, A.sugerirArmados(c2, null, M)[0].piezas, 1, M);
  const l2 = LF.listaFabricacion(c2, C.cotizar(c2, M), M);
  assert.equal(l2.piezas.some((q) => q.id === 'br'), false);
  assert.match(l2.aparte.find((a) => a.id === 'br').motivo, /se ahorran por conjuntos armados/);
});
