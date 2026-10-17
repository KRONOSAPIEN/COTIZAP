'use strict';
/**
 * Las cuentas de los armados y de las partidas agotadas: el ahorro mostrado es el cambio real del subtotal (con el sobrante de
 * lámina), la partida agotada vale cero en todo lo que se suma, `armar` valida cantidades, `deshacerArmado` vuelve a la partida de
 * origen y el cargo mínimo nunca cobra menos que el cargo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const A = require('../src/motor/armados');
const E = require('../src/datos/ejemplos');

const M = crearMaestros();
const pulg = (x) => x * 25.4;
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const clon = (x) => JSON.parse(JSON.stringify(x));
const lam = { material_id: 'GALVANIZADO', calibre: 22, tipo_union: 'BRIDADO', ref_diametro: 'INTERIOR', cantidad: 1 };
const codo = (id, theta, extra) => ({ id, familia: 'CODO', ...lam, D_mm: pulg(5), theta_deg: theta, k_R: 1.5, n_gajos: theta === 90 ? 5 : 3, ...extra });
const recto = (extra) => ({ id: 'rt', familia: 'RECTO', ...lam, D_mm: pulg(5), L_mm: 914, ...extra });
const brida5 = (cantidad) => ({ id: 'br', familia: 'BRIDA', material_id: 'GALVANIZADO', calibre: 22, ref_diametro: 'INTERIOR', D_mm: pulg(5), cantidad });
const pedido = () => { const c = E.pedidoDucteria(); c.partidas.forEach((p, i) => { p.id = `p${i}`; }); return c; };

/* ------------------------------------------------------------------ */
/* 1. El ahorro sugerido es el cambio real del subtotal                */
/* ------------------------------------------------------------------ */

test('Sugerir en el pedido del 30-sep: cada ahorro mostrado es lo que baja totales.subtotal, y todas las rondas suman lo mismo', () => {
  const cot = pedido();
  const sub0 = C.cotizar(cot, M).totales.subtotal;
  let mostrado = 0;
  let vistas = 0;
  for (let ronda = 0; ronda < 8; ronda += 1) {
    const t0 = Date.now();
    const sug = A.sugerirArmados(cot, null, M);
    if (ronda === 0) assert.ok(Date.now() - t0 < 1500, `las sugerencias del ejemplo tardan poco (${Date.now() - t0} ms)`);
    if (!sug.length) break;
    sug.forEach((s) => {
      assert.ok(s.ahorro > 0.005, 'sólo se sugiere lo que ahorra de verdad');
      // las partes del costo directo suman el ahorro del costo directo, con el sobrante como un concepto propio
      const d = s.desglose;
      casi(d.aros + d.tornillos + d.juntas + d.mano_obra + d.otros + d.bridas_otra_partida + d.sobrante, s.ahorro_costo, 1e-6, 'conceptos');
      casi(s.antes - s.despues, s.ahorro, 0.011, 'antes − después');
      // cada una, evaluada tras las anteriores de la misma ronda, baja el subtotal justo lo que dice
      const antes = C.cotizar(cot, M).totales.subtotal;
      assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true);
      const despues = C.cotizar(cot, M).totales.subtotal;
      casi(antes - despues, s.ahorro, 0.01, `ahorro de ${s.descripcion}`);
      mostrado += s.ahorro;
      vistas += 1;
    });
  }
  assert.ok(vistas >= 3);
  casi(sub0 - C.cotizar(cot, M).totales.subtotal, mostrado, 0.01 * vistas, 'todas las rondas');
  // el sobrante de lámina sube al gastar menos hoja: algún concepto de sobrante es negativo (cuesta) y está en el desglose
  const cot2 = pedido();
  const primera = A.sugerirArmados(cot2, null, M);
  assert.ok(primera.some((s) => s.desglose.sobrante < -0.005), 'el sobrante de lámina aparece como concepto');
  assert.ok(primera.every((s) => Number.isFinite(s.ahorro_sobrante)));
});

test('Sugerir: «Armar todas» de la ronda baja el subtotal exactamente la suma mostrada', () => {
  const cot = pedido();
  const sub0 = C.cotizar(cot, M).totales.subtotal;
  const sug = A.sugerirArmados(cot, null, M);
  sug.forEach((s) => assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true));
  casi(sub0 - C.cotizar(cot, M).totales.subtotal, sug.reduce((s, x) => s + x.ahorro, 0), 0.01);
});

/* ------------------------------------------------------------------ */
/* 2. Partida agotada                                                  */
/* ------------------------------------------------------------------ */

const caminar = (o, ruta, fn) => {
  if (typeof o === 'number') fn(ruta, o);
  else if (o && typeof o === 'object' && !Array.isArray(o)) Object.keys(o).forEach((k) => caminar(o[k], `${ruta}.${k}`, fn));
};

test('Partida agotada por armados: cero en todo lo que se suma, con su ficha y su geometría; no cuenta como partida ni como bridas', () => {
  const cot = { riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', yarda_mm: 914, partidas: [recto({ bridas_aparte: true }), codo('c90', 90, { bridas_aparte: true }), brida5(2)] };
  const s = A.sugerirArmados(cot, null, M)[0];
  assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true);
  const res = C.cotizar(cot, M);
  const f = res.partidas[2];
  assert.equal(f.agotada_por_armados, true);
  assert.equal(f.entrada.cantidad, 0);
  const conservar = /\.(imp_pct|f_fin|divisor|gif_por_hora)$|\.precios_usados\./;
  ['costos', 'pila', 'precio', 'peso', 'indicadores'].forEach((k) => {
    caminar(f[k], k, (ruta, v) => { if (!conservar.test(ruta)) assert.equal(v, 0, `${ruta} debe ser 0`); });
  });
  ['costos.CD', 'costos.subtotales.materiales', 'costos.subtotales.mano_obra', 'pila.CI', 'pila.CI_fabrica', 'pila.CI_admin', 'pila.imprevistos',
    'pila.financiamiento', 'pila.utilidad', 'pila.comision', 'pila.otros', 'precio.unitario', 'precio.importe', 'peso.neto_total_kg', 'costos.h_MOD'].forEach((ruta) => {
    const v = ruta.split('.').reduce((o, k) => o[k], f);
    assert.equal(v, 0, ruta);
  });
  assert.ok(f.geometria && f.descripcion, 'conserva su ficha y su geometría');
  // los totales: la agotada no aporta nada y no cuenta como partida
  const otras = res.partidas.filter((x) => x.ok && !x.agotada_por_armados);
  const sumaImporte = [...otras, ...res.automaticas].reduce((t, x) => t + x.precio.importe, 0);
  casi(res.totales.subtotal, sumaImporte, 0.011);
  assert.equal(res.totales.n_partidas_agotadas, 1);
  assert.equal(res.totales.n_partidas_ok, 2);
  // el cuadre de bridas no cuenta una partida de bridas agotada
  assert.equal(res.bridas.filas.find((x) => x.D_nom_mm === pulg(5)).partidas_hay, 0);
  // sin armados nadie está agotado
  assert.equal(C.cotizar({ ...cot, armados: [] }, M).totales.n_partidas_agotadas, 0);
});

/* ------------------------------------------------------------------ */
/* 3. armar valida n y cantidades                                      */
/* ------------------------------------------------------------------ */

test('armar: rechaza piezas con menos cantidad que n y no deja la cotización a medias; n se normaliza', () => {
  const cot = { yarda_mm: 914, armados: [], partidas: [recto({ cantidad: 1 }), codo('c90', 90, { cantidad: 3 })] };
  const antes = clon(cot);
  const r = A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 2, M);
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /tiene 1 pieza y el armado pide 2: no alcanza/);
  assert.deepEqual(cot, antes, 'no cambia nada');
  // n inválido: error claro, sin NaN en las cantidades
  [0, -1, 2.5, 'x', NaN, 10000].forEach((n) => {
    const q = A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], n, M);
    assert.equal(q.ok, false, `n = ${n}`);
    assert.match(q.errores[0], /entero de 1 a/);
  });
  assert.deepEqual(cot, antes);
  // sin n (undefined) es 1
  const ok = A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], undefined, M);
  assert.equal(ok.ok, true);
  assert.equal(cot.armados[0].n, 1);
  assert.ok(cot.partidas.every((p) => Number.isInteger(p.cantidad) && p.cantidad >= 1));
});

/* ------------------------------------------------------------------ */
/* 4. deshacerArmado vuelve a la partida de origen                     */
/* ------------------------------------------------------------------ */

test('deshacerArmado: con dos partidas idénticas del usuario vuelve a la de origen y deja la lista exacta', () => {
  const cot = { yarda_mm: 914, partidas: [codo('k', 90, { cantidad: 2 }), recto({ cantidad: 1 }), codo('c90', 90, { cantidad: 3 })] };
  const original = clon(cot.partidas);
  const r = A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 1, M, { nuevoId: () => 'nuevo' });
  assert.equal(r.ok, true);
  assert.equal(cot.armados[0].piezas[1].origen, 'c90');
  assert.deepEqual(A.deshacerArmado(cot, cot.armados[0].id), { ok: true, juntadas: 1 });
  assert.deepEqual(cot.partidas, original, 'la lista queda exactamente como estaba (la partida «k» no se tocó)');
  assert.equal(cot.armados.length, 0);
});

test('deshacerArmado: si no se partió nada, la partida se queda como está y no se funde con otra igual', () => {
  const cot = { yarda_mm: 914, partidas: [codo('k', 90, { cantidad: 2 }), recto({ cantidad: 2 }), codo('c90', 90, { cantidad: 2 })] };
  const original = clon(cot.partidas);
  assert.equal(A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 2, M).ok, true);
  assert.deepEqual(A.deshacerArmado(cot, cot.armados[0].id), { ok: true, juntadas: 0 });
  assert.deepEqual(cot.partidas, original);
});

test('deshacerArmado: si la partida de origen ya no existe o cambió, la parte armada se queda; un armado antiguo (sin origen) junta como antes', () => {
  const nuevo = () => {
    const cot = { yarda_mm: 914, partidas: [recto({ cantidad: 1 }), codo('c90', 90, { cantidad: 3 })] };
    A.armar(cot, [{ partida: 'rt', cara: 'final' }, { partida: 'c90', cara: 'A' }], 1, M, { nuevoId: () => 'nuevo' });
    return cot;
  };
  const sinOrigen = nuevo();
  sinOrigen.partidas.splice(1, 1); // el usuario borró la de origen
  assert.deepEqual(A.deshacerArmado(sinOrigen, sinOrigen.armados[0].id), { ok: true, juntadas: 0 });
  assert.deepEqual(sinOrigen.partidas.map((p) => p.id), ['rt', 'nuevo']);
  const editada = nuevo();
  editada.partidas[1].descripcion = 'Codo especial';
  assert.deepEqual(A.deshacerArmado(editada, editada.armados[0].id), { ok: true, juntadas: 0 });
  assert.equal(editada.partidas.length, 3);
  // armado guardado antes de existir `origen`
  const viejo = nuevo();
  viejo.armados[0].piezas.forEach((q) => { delete q.origen; });
  assert.deepEqual(A.deshacerArmado(viejo, viejo.armados[0].id), { ok: true, juntadas: 1 });
  assert.deepEqual(viejo.partidas.map((p) => [p.id, p.cantidad]), [['rt', 1], ['c90', 3]]);
  // el JSON de ida y vuelta conserva el origen
  const l = A.limpiarArmados(clon(nuevo().armados));
  assert.equal(l[0].piezas[1].origen, 'c90');
});

/* ------------------------------------------------------------------ */
/* 5. Cargo mínimo                                                     */
/* ------------------------------------------------------------------ */

test('Cargo mínimo: el importe nunca queda por debajo del cargo (cantidades de 1 a 12) y no se pasa de un centavo por pieza', () => {
  const cargos = [10000, 12345.67, 9999.99, 7000.01]; // por encima del precio de 12 piezas de esta partida, para que el cargo mínimo aplique siempre
  cargos.forEach((cargo) => {
    const Mc = clon(M);
    Mc.capas.cargo_minimo_partida = cargo;
    for (let n = 1; n <= 12; n += 1) {
      const f = C.cotizarPartida({ id: 'x', familia: 'RECTO', ...lam, D_mm: pulg(3), L_mm: 100, cantidad: n }, Mc);
      assert.equal(f.precio.aplico_cargo_minimo, true, `cargo ${cargo}, n = ${n}`);
      assert.ok(f.precio.importe >= cargo - 1e-9, `importe ${f.precio.importe} ≥ ${cargo} con ${n} piezas`);
      assert.ok(f.precio.importe - cargo < 0.01 * n + 1e-9, `no se pasa de un centavo por pieza (${f.precio.importe})`);
      casi(f.precio.importe, f.precio.unitario * n, 0.0051, 'importe = unitario × cantidad');
    }
  });
  // el caso del reporte (250 entre 3 piezas daba 83.33 × 3 = 249.99), a escala: 10,000 entre 3
  const Mc = clon(M);
  Mc.capas.cargo_minimo_partida = 10000;
  const f = C.cotizarPartida({ id: 'x', familia: 'RECTO', ...lam, D_mm: pulg(3), L_mm: 100, cantidad: 3 }, Mc);
  assert.equal(f.precio.unitario, 3333.34);
  assert.equal(f.precio.importe, 10000.02);
  // y con el cargo de 250 sobre una partida que sí queda debajo: la unión de un armado de 1 pieza
  const Mu = clon(M);
  Mu.capas.cargo_minimo_partida = 250;
  for (let n = 1; n <= 12; n += 1) {
    const u = C.cotizarPartida({ familia: 'UNION', material_id: 'GALVANIZADO', calibre: 22, tipo_union: 'LISO', ref_diametro: 'INTERIOR', D_mm: pulg(3), n_uniones: 1, cantidad: n }, Mu);
    if (u.precio.aplico_cargo_minimo) assert.ok(u.precio.importe >= 250, `unión ${n}: ${u.precio.importe}`);
  }
});

test('Sin cargo mínimo el redondeo es el de siempre (unitario al centavo, importe = unitario × cantidad)', () => {
  const f = C.cotizarPartida({ id: 'x', familia: 'RECTO', ...lam, D_mm: pulg(8), L_mm: 3000, cantidad: 7 }, M);
  assert.equal(f.precio.aplico_cargo_minimo, false);
  assert.equal(f.precio.unitario, Math.round((f.precio.total_sin_redondeo / 7) * 100) / 100);
  casi(f.precio.importe, f.precio.unitario * 7, 0.0051);
});
