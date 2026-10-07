'use strict';
/**
 * Parámetros de precio propios de la cotización (margen, comisión, descuento, días de cobro, administración,
 * financiamiento, IVA): anulan a las capas de las tablas maestras sólo para esa cotización.
 * Las capas se recalculan aquí con aritmética directa desde `pila.C_base`, sin llamar a la pila del motor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/motor/cotizador');
const { crearMaestros } = require('../src/datos/maestros');

const M = crearMaestros();
const casi = (real, esperado, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(real - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${msg} esperado ${esperado}, obtenido ${real}`);
};

const base = { material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO' };
const partidas = [
  { ...base, familia: 'RECTO', D_mm: 304.8, L_mm: 3000, cantidad: 3 },
  { ...base, familia: 'CODO', D_mm: 304.8, theta_deg: 90, k_R: 1.5, cantidad: 2 },
  { familia: 'COMPRADO', precio_compra_unitario: 1850, peso_kg: 9, cantidad: 1 },
];
const cot = (parametros, extra) => ({ riesgo: 'MEDIO', servicio: 'POLVO', partidas, ...(parametros ? { parametros } : {}), ...extra });
const BASE = C.cotizar(cot(), M);
const CAPAS = M.capas;

test('Sin parámetros propios todo sale de las tablas maestras y los totales no cambian de forma', () => {
  assert.deepEqual(BASE.capas, M.capas);
  assert.deepEqual(BASE.parametros, {});
  assert.deepEqual(BASE.avisos, []);
  const T = BASE.totales;
  casi(T.subtotal, [...BASE.partidas, ...BASE.automaticas].reduce((s, f) => s + f.precio.importe, 0), 1e-12);
  assert.equal(T.descuento, 0);
  assert.equal(T.descuento_pct, 0);
  assert.equal(T.subtotal_neto, T.subtotal);
  casi(T.iva, Math.round(T.subtotal * 0.16 * 100) / 100, 1e-12);
  casi(T.total, T.subtotal + T.iva, 1e-9);
  casi(T.margen_real_pct, CAPAS.utilidad_pct_precio, 1e-3, 'con el margen de las tablas la utilidad real es la de las tablas');
});

test('Margen de utilidad propio: P = C_base / (1 − u − comisión − otros) y la utilidad es u del precio', () => {
  const r = C.cotizar(cot({ utilidad_pct_precio: 0.25 }), M);
  assert.deepEqual(r.parametros, { utilidad_pct_precio: 0.25 });
  r.partidas.forEach((f, i) => {
    casi(f.pila.C_base, BASE.partidas[i].pila.C_base, 1e-12, 'el costo no depende del margen');
    casi(f.pila.precio, f.pila.C_base / (1 - 0.25 - CAPAS.comision_ventas_pct_precio - CAPAS.otros_pct_precio), 1e-12);
    casi(f.pila.utilidad / f.pila.precio, 0.25, 1e-12);
    assert.ok(f.precio.unitario > BASE.partidas[i].precio.unitario);
  });
  assert.ok(r.totales.subtotal > BASE.totales.subtotal);
  casi(r.totales.margen_real_pct, 0.25, 1e-3);
  // margen cero: se vende al piso (costo + comisión) y la utilidad real es cero
  const cero = C.cotizar(cot({ utilidad_pct_precio: 0 }), M);
  casi(cero.totales.margen_real_pct, 0, 1, 'sin margen');
  assert.ok(Math.abs(cero.totales.utilidad) < 5, `utilidad ≈ 0 (redondeo de centavos): ${cero.totales.utilidad}`);
});

test('Comisión de ventas propia: la paga el precio, no el costo', () => {
  const r = C.cotizar(cot({ comision_ventas_pct_precio: 0.05 }), M);
  r.partidas.forEach((f) => {
    casi(f.pila.precio, f.pila.C_base / (1 - CAPAS.utilidad_pct_precio - 0.05 - CAPAS.otros_pct_precio), 1e-12);
    casi(f.pila.comision / f.pila.precio, 0.05, 1e-12);
    casi(f.pila.utilidad / f.pila.precio, CAPAS.utilidad_pct_precio, 1e-12);
  });
  casi(r.capas.comision_ventas_pct_precio, 0.05, 1e-12);
});

test('Administración propia: CI_admin = administración · CD', () => {
  const r = C.cotizar(cot({ administracion_pct_cd: 0.1 }), M);
  r.partidas.forEach((f, i) => {
    casi(f.costos.CD, BASE.partidas[i].costos.CD, 1e-12);
    casi(f.pila.CI_admin, 0.1 * f.costos.CD, 1e-12);
  });
});

test('Días de cobro y financiamiento anual propios: financiamiento = C_T · tasa · días / 365', () => {
  const r = C.cotizar(cot({ dias_cobro: 90, tasa_anual: 0.2 }), M);
  r.partidas.forEach((f) => {
    casi(f.pila.financiamiento, f.pila.C_T * ((0.2 * 90) / 365), 1e-12);
  });
  const contado = C.cotizar(cot({ dias_cobro: 0 }), M);
  contado.partidas.forEach((f) => casi(f.pila.financiamiento, 0, 1e-12, 'de contado no hay financiamiento'));
  assert.ok(contado.totales.subtotal < BASE.totales.subtotal);
  assert.equal(r.capas.financiamiento.dias_cobro, 90);
  assert.equal(r.capas.financiamiento.tasa_anual, 0.2);
});

test('IVA propio: sólo cambia el IVA de los totales, no el precio de las partidas', () => {
  const r = C.cotizar(cot({ iva_pct: 0.08 }), M);
  assert.equal(r.totales.iva_pct, 0.08);
  casi(r.totales.iva, Math.round(r.totales.subtotal * 0.08 * 100) / 100, 1e-12);
  assert.equal(r.totales.subtotal, BASE.totales.subtotal);
  const cero = C.cotizar(cot({ iva_pct: 0 }), M);
  assert.equal(cero.totales.iva, 0);
  assert.equal(cero.totales.total, cero.totales.subtotal);
});

test('Descuento: se resta del subtotal, el IVA se calcula sobre el precio ya descontado y las partidas no cambian', () => {
  const r = C.cotizar(cot({ descuento_pct: 0.1 }), M);
  const T = r.totales;
  assert.equal(T.subtotal, BASE.totales.subtotal, 'el subtotal de lista no cambia');
  casi(T.descuento, Math.round(T.subtotal * 0.1 * 100) / 100, 1e-12);
  casi(T.subtotal_neto, T.subtotal - T.descuento, 1e-9);
  casi(T.iva, Math.round(T.subtotal_neto * 0.16 * 100) / 100, 1e-12);
  casi(T.total, T.subtotal_neto + T.iva, 1e-9);
  casi(T.precio_por_kg_neto, T.subtotal_neto / T.peso_neto_kg, 1e-12);
  r.partidas.forEach((f, i) => assert.equal(f.precio.unitario, BASE.partidas[i].precio.unitario, 'el descuento es de la cotización'));
  assert.equal(T.costo_directo, BASE.totales.costo_directo);
  assert.equal(T.costo_total, BASE.totales.costo_total);
});

test('Utilidad real con descuento: Σ [importe·(1 − d)·(1 − comisión − otros) − C_base]; si el descuento pasa del piso hay pérdida', () => {
  const calcular = (d) => {
    const r = C.cotizar(cot({ descuento_pct: d }), M);
    const util = [...r.partidas, ...r.automaticas].reduce((s, f) => s + f.precio.importe * (1 - d) * (1 - CAPAS.comision_ventas_pct_precio - CAPAS.otros_pct_precio) - f.pila.C_base, 0);
    return { r, util };
  };
  [0, 0.05, 0.1, 0.2].forEach((d) => {
    const { r, util } = calcular(d);
    casi(r.totales.utilidad, util, 1e-12, `d = ${d}`);
    casi(r.totales.margen_real_pct, util / r.totales.subtotal_neto, 1e-12);
  });
  assert.ok(calcular(0.1).r.totales.margen_real_pct < calcular(0.05).r.totales.margen_real_pct, 'más descuento, menos margen');
  // una sola partida sin cargo mínimo ni redondeos relevantes: forma cerrada (1 − c − o)·(1 − piso / P′)
  const una = C.cotizar({ riesgo: 'MEDIO', servicio: 'POLVO', partidas: [{ ...base, familia: 'RECTO', D_mm: 304.8, L_mm: 3000, cantidad: 100 }], parametros: { descuento_pct: 0.1 } }, M);
  const f = una.partidas[0];
  const piso = f.indicadores.precio_piso;
  const Pd = f.precio.importe * 0.9;
  casi(una.totales.margen_real_pct, (1 - CAPAS.comision_ventas_pct_precio - CAPAS.otros_pct_precio) * (1 - piso / Pd), 1e-4);
  // más del descuento máximo (≈ 1 − piso/precio): se pierde dinero
  const perdida = C.cotizar(cot({ descuento_pct: 0.3 }), M);
  assert.ok(perdida.totales.utilidad < 0 && perdida.totales.margen_real_pct < 0);
});

test('Un parámetro inválido se ignora y se avisa con su nombre; el resto de la cotización sigue calculando', () => {
  const r = C.cotizar(cot({
    utilidad_pct_precio: 0.95, comision_ventas_pct_precio: -0.01, dias_cobro: 30.5, tasa_anual: 'abc', iva_pct: 2, descuento_pct: 0.9,
    administracion_pct_cd: null, desconocido: 5,
  }), M);
  assert.deepEqual(r.parametros, {});
  assert.equal(r.avisos.length, 6);
  ['Margen de utilidad', 'Comisión de ventas', 'Descuento', 'Días de cobro', 'Financiamiento anual', 'IVA'].forEach((n, i) => assert.ok(r.avisos[i].startsWith(`${n}:`), r.avisos[i]));
  assert.match(r.avisos[0], /entre 0 % y 80 %/);
  assert.match(r.avisos[3], /entre 0 y 365/);
  assert.equal(r.totales.subtotal, BASE.totales.subtotal);
  assert.equal(r.totales.total, BASE.totales.total);
  assert.deepEqual(r.capas, M.capas);
  // vacío, parámetros que no son un objeto y números en texto
  assert.deepEqual(C.cotizar(cot({ utilidad_pct_precio: '' }), M).avisos, []);
  [[], 'x', 5, null].forEach((raro) => assert.equal(C.cotizar({ riesgo: 'MEDIO', partidas, parametros: raro }, M).totales.total, BASE.totales.total));
  casi(C.cotizar(cot({ utilidad_pct_precio: '0.25' }), M).totales.margen_real_pct, 0.25, 1e-3, 'un número en texto (de un JSON) vale');
});

test('Los límites incluyen el cero y el valor de las tablas maestras siempre es válido', () => {
  Object.keys(C.PARAMETROS_COTIZACION).forEach((k) => {
    const def = C.PARAMETROS_COTIZACION[k];
    const v = C.parametroDeMaestros(M, k);
    assert.ok(v >= def.min && v <= def.max, `${k}: ${v} dentro de [${def.min}, ${def.max}]`);
    assert.equal(def.min, 0, `${k}: el cero es válido`);
    const r = C.cotizar(cot({ [k]: def.min }), M);
    assert.deepEqual(r.avisos, [], `${k} = ${def.min}`);
    const r2 = C.cotizar(cot({ [k]: def.max }), M);
    assert.deepEqual(r2.avisos, [], `${k} = ${def.max}`);
  });
  assert.equal(C.parametroDeMaestros(M, 'descuento_pct'), 0, 'el descuento no existe en maestros: 0');
});

test('No muta las tablas maestras; las capas de la cotización se devuelven aparte y la vista previa de una partida coincide', () => {
  const antes = JSON.stringify(M);
  const r = C.cotizar(cot({ utilidad_pct_precio: 0.3, dias_cobro: 15, iva_pct: 0.08 }), M);
  assert.equal(JSON.stringify(M), antes);
  assert.notEqual(r.maestros, M);
  assert.notEqual(r.maestros.capas, M.capas);
  assert.equal(r.maestros.capas, r.capas);
  assert.equal(r.maestros.proceso, M.proceso, 'lo demás se comparte sin copiar');
  // la vista previa del diálogo usa las mismas capas: mismo precio que en la lista
  const suelta = C.cotizarPartida({ ...base, riesgo: 'MEDIO', ...partidas[0] }, r.maestros);
  assert.equal(suelta.precio.unitario, r.partidas[0].precio.unitario);
  const conMaestros = C.cotizarPartida({ ...base, riesgo: 'MEDIO', ...partidas[0] }, M);
  assert.notEqual(conMaestros.precio.unitario, suelta.precio.unitario, 'con las capas de las tablas el precio sería otro');
});

test('El margen y la comisión propios no pasan del 100 % del precio: el error de capas inválidas sale por partida, no tumba la cotización', () => {
  const ext = crearMaestros({ capas: { otros_pct_precio: 0.5 } });
  const r = C.cotizar(cot({ utilidad_pct_precio: 0.8, comision_ventas_pct_precio: 0.2 }), ext);
  assert.equal(r.totales.n_partidas_error, r.partidas.length);
  assert.match(r.partidas[0].errores[0], /Utilidad \+ comisión \+ otros ≥ 100 %/);
});
