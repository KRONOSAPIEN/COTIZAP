/**
 * Medir la lectura (src/motor/unifilar_evaluacion.js y scripts/evaluar-unifilares.js): comparar la lectura de Claude con la
 * corregida da las métricas de §12 del documento, y el caso de demostración de docs/evaluacion las marca.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const E = require('../src/motor/unifilar_evaluacion');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');

const M = crearMaestros();
const caso = (n) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'evaluacion', 'ejemplo-perturbado', n), 'utf8');

test('Una lectura igual a la esperada cumple todo', () => {
  const r = E.comparar(EJEMPLO, JSON.stringify(EJEMPLO), M);
  assert.deepEqual(r.metricas, { nodos_f1: 1, aristas_f1: 1, diametros: 1, cotas: 1, accesorios: 1, costo_dif: 0, errores_silenciosos: 0 });
  assert.equal(r.todo, true);
});

test('El caso de demostración: un Ø leído mal con seguridad es un error silencioso; una cota mal, baja la exactitud', () => {
  const r = E.comparar(caso('obtenida.json'), caso('esperada.json'), M);
  assert.deepEqual([r.metricas.nodos_f1, r.metricas.aristas_f1, r.metricas.accesorios], [1, 1, 1], 'la campana corrida 25 px sigue emparejada');
  assert.equal(r.metricas.diametros, 0.8333);
  assert.equal(r.metricas.cotas, 0.8571);
  assert.equal(r.metricas.errores_silenciosos, 1);
  assert.deepEqual(r.detalle.silenciosos, ['A-003: Ø 8 con confianza 0.95']);
  assert.ok(r.detalle.diferencias.includes('A-004: 3.8 m en vez de 3.6 m'));
  assert.ok(r.metricas.costo_dif < -0.05, 'sin manguera de 8″ en el catálogo, el despiece cuesta menos');
  assert.equal(r.todo, false);
});

test('Nodos y aristas que faltan o sobran bajan el F1; los accesorios se comparan en el nodo emparejado', () => {
  const obt = JSON.parse(JSON.stringify(EJEMPLO));
  // la derivación a la máquina A no se leyó
  obt.red.aristas = obt.red.aristas.filter((a) => a.id !== 'A-003');
  obt.red.nodos = obt.red.nodos.filter((n) => n.id !== 'N-004');
  obt.equipos = obt.equipos.filter((e) => e.id !== 'EQ-02');
  const r = E.comparar(obt, EJEMPLO, M);
  assert.equal(r.detalle.nodos.emparejados, 8);
  assert.equal(r.metricas.nodos_f1, 0.9412);
  assert.equal(r.metricas.aristas_f1, 0.9333);
  assert.ok(r.metricas.accesorios < 1, 'sin el ramal, en N-003 ya no sale la reducción con injerto');
  assert.ok(r.detalle.diferencias.some((d) => /RINJ-001 en N-003/.test(d)));
  assert.throws(() => E.comparar('{', EJEMPLO, M), /obtenida no sirve/);
});

test('resumir: qué fracción de los croquis cumple cada meta', () => {
  const bien = E.comparar(EJEMPLO, EJEMPLO, M);
  const mal = E.comparar(caso('obtenida.json'), caso('esperada.json'), M);
  const s = E.resumir([bien, mal]);
  assert.deepEqual([s.croquis, s.por_meta.nodos_f1, s.por_meta.diametros, s.costo_en_5pct, s.cumple_costo, s.silenciosos], [2, 1, 0.5, 0.5, false, 1]);
});
