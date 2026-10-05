'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/motor/util');
const { crearMaestros } = require('../src/datos/maestros');

test('igual: comparación profunda de datos JSON', () => {
  assert.equal(U.igual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(U.igual({ a: [1, 2] }, { a: [1, 3] }), false);
  assert.equal(U.igual([1, 2], { 0: 1, 1: 2 }), false);
  assert.equal(U.igual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(U.igual(null, null), true);
  assert.equal(U.igual(null, {}), false);
});

test('diferencia: base idéntica → parche vacío', () => {
  const M = crearMaestros();
  assert.deepEqual(U.diferencia(crearMaestros(), M), {});
});

test('diferencia/mezclar: mezclar(base, diferencia(base, actual)) reconstruye actual', () => {
  const base = crearMaestros();
  const actual = crearMaestros();
  actual.precios.precio_kg_acero_carbon = 31.5;
  actual.capas.imprevistos_pct.ALTO = 0.1;
  actual.proceso.soldadura.v_m_min[2][1] = 0.55;            // se edita una celda de un arreglo
  actual.herrajes.uniones.BRIDADO.paso_tornillo_mm = 100;
  actual.meta.revisado = true;
  const parche = U.diferencia(base, actual);
  assert.deepEqual(Object.keys(parche).sort(), ['capas', 'herrajes', 'meta', 'precios', 'proceso']);
  assert.equal(parche.precios.precio_kg_acero_carbon, 31.5);
  assert.equal(Object.keys(parche.precios).length, 1, 'sólo lo editado');
  assert.deepEqual(U.mezclar(crearMaestros(), parche), actual);
});

test('diferencia: los valores de arranque nuevos llegan a quien no los editó', () => {
  // Un usuario que sólo editó un precio sigue recibiendo los valores de arranque vigentes (p. ej. la solera).
  const base = crearMaestros();
  const suyo = crearMaestros();
  suyo.precios.precio_kg_solera = 25;
  const guardado = JSON.parse(JSON.stringify(U.diferencia(base, suyo)));
  const futuro = crearMaestros();
  futuro.herrajes.seleccion_perfil = [{ hasta_mm: 99999, perfil: 'L38x3.2' }];   // el valor de arranque cambia en otra versión
  const cargado = U.mezclar(futuro, guardado);
  assert.equal(cargado.precios.precio_kg_solera, 25, 'se respeta su edición');
  assert.equal(cargado.herrajes.seleccion_perfil[0].perfil, 'L38x3.2', 'el valor de arranque nuevo no queda enmascarado');
});

test('mezclar: un parche con un arreglo editado lo reemplaza completo', () => {
  const base = crearMaestros();
  const parche = { proceso: { corte: { v_m_min: { PLASMA: [[1, 9], [2, 7]] } } } };
  const r = U.mezclar(base, parche);
  assert.deepEqual(r.proceso.corte.v_m_min.PLASMA, [[1, 9], [2, 7]]);
  assert.deepEqual(r.proceso.corte.v_m_min.LASER, base.proceso.corte.v_m_min.LASER);
});
