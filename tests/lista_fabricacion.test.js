'use strict';
/**
 * Lista de fabricación (src/motor/lista_fabricacion.js): las piezas del pedido de ductería del 30-sep-2026 con sus marcas (las de la
 * pestaña Planos), sus medidas, bridas y pesos, sacados del resultado del motor; lo que no se fabrica queda en `aparte`; no lleva
 * precios.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const E = require('../src/datos/ejemplos');
const C = require('../src/motor/cotizador');
const LF = require('../src/motor/lista_fabricacion');

const M = crearMaestros();
const cot = E.pedidoDucteria();
const res = C.cotizar(cot, M);
const L = LF.listaFabricacion(cot, res, res.maestros);
const med = (q, et) => (q.medidas.find((m) => m.etiqueta === et) || {}).valor;

/** Todos los textos de la lista (los del dibujo también). */
function textos(x, acum = []) {
  if (typeof x === 'string') acum.push(x);
  else if (Array.isArray(x)) x.forEach((y) => textos(y, acum));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => textos(y, acum));
  return acum;
}

test('Lista: el pedido del 30-sep trae sus 36 piezas con la marca de Planos', () => {
  assert.equal(L.piezas.length, 36);
  assert.equal(L.aparte.length, 0);
  const marcas = L.piezas.map((q) => q.marca);
  assert.equal(new Set(marcas).size, 36, 'marcas únicas');
  const esperadas = [
    ...Array.from({ length: 6 }, (_, i) => `B${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `C${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `I${i + 1}`), ...Array.from({ length: 11 }, (_, i) => `D${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `A${i + 1}`),
  ];
  assert.deepEqual(marcas, esperadas);
  // las mismas que arma `agrupar`, que es lo que usa la pestaña Planos
  const A = LF.agrupar(cot, res, res.maestros);
  assert.deepEqual(A.hojas.flatMap((h) => h.items.map((x) => x.marca)), marcas);
  assert.equal(A.n, 36);
  assert.ok(L.piezas.every((q) => q.cantidad > 0 && q.titulo && q.familia));
});

test('Lista: un codo trae gajos, R, R/D, ángulo por gajo y su material y calibre', () => {
  const c = L.piezas.find((q) => q.marca === 'C1');
  assert.equal(c.familia, 'CODO');
  assert.equal(c.cantidad, 2);
  assert.equal(med(c, 'Gajos'), '5');
  assert.equal(med(c, 'Radio R'), '190.5 mm');
  assert.equal(med(c, 'R/D'), '1.50');
  assert.equal(med(c, 'Ángulo por gajo'), '22.5°');
  assert.equal(med(c, 'Ángulo'), '90°');
  assert.equal(c.calibre, 22);
  assert.equal(c.material, 'Acero galvanizado');
  assert.ok(Math.abs(c.espesor_mm - 0.853) < 0.001);
  assert.equal(c.costura, 'Engargolada');
  // el extremo B va sin brida y el A lleva la brida de otra partida
  assert.match(c.extremos.find((x) => x.etiqueta === 'Extremo B').valor, /Sin brida/);
  assert.match(c.extremos.find((x) => x.etiqueta === 'Extremo A').valor, /otra partida/);
});

test('Lista: un ducto recto trae sus yardas, el ajuste y las bridas de cada pieza', () => {
  const d = L.piezas.find((q) => q.marca === 'D1'); // 11″ × 2742 mm
  assert.equal(d.familia, 'RECTO');
  assert.equal(med(d, 'Yardas completas'), '3');
  assert.equal(med(d, 'Armado'), '3 yardas');
  assert.equal(med(d, 'Largo L'), '2,742 mm');
  assert.equal(med(d, 'Yarda (ancho de lámina)'), '914 mm');
  const aj = L.piezas.find((q) => q.familia === 'RECTO' && /ajuste/.test(med(q, 'Armado') || ''));
  assert.ok(aj, 'hay un tramo con ajuste');
  assert.match(med(aj, 'Tramo de ajuste'), /mm$/);
  assert.match(d.titulo, /^Tramo recto Ø11″ × 2,742 mm$/);
});

test('Lista: una brida trae sus barrenos y los datos del aro', () => {
  const b = L.piezas.find((q) => q.marca === 'B1'); // 22 bridas de 11″
  assert.equal(b.cantidad, 22);
  assert.equal(med(b, 'Barrenos'), '8 de Ø9.5 mm');
  assert.equal(b.bridas.length, 1);
  const a = b.bridas[0];
  assert.equal(a.n_tornillos, 8);
  assert.equal(a.ancho_mm, 38.1);
  assert.equal(a.gramil_mm, 24);
  assert.ok(Math.abs(a.diam_barreno_mm - 9.525) < 1e-6);
  assert.ok(Math.abs(a.paso_mm - a.P_perno_mm / 8) < 1e-9);
  // la de placa comprada con círculo de barrenos también se lista, como en Planos
  const pl = L.piezas.find((q) => q.familia === 'COMPRADO');
  assert.ok(pl && /^B/.test(pl.marca));
  assert.match(med(pl, 'Ø de barrenos (Dperf)'), /mm$/);
});

test('Lista: los kg son los del motor y las piezas son las del pedido', () => {
  const suma = res.partidas.reduce((s, f) => s + f.peso.neto_total_kg, 0);
  assert.ok(Math.abs(L.totales.kg - suma) < 1e-9, `${L.totales.kg} vs ${suma}`);
  assert.equal(L.totales.piezas, cot.partidas.reduce((s, p) => s + p.cantidad, 0));
  assert.equal(L.totales.partidas, 36);
  L.piezas.forEach((q) => {
    const f = res.partidas[q.indice];
    assert.equal(q.peso_unitario_kg, f.peso.neto_unitario_kg);
    assert.equal(q.peso_total_kg, f.peso.neto_total_kg);
  });
  assert.equal(L.encabezado.fecha, '2026-09-30');
  assert.equal(L.encabezado.material, 'Acero galvanizado · cal. 22');
});

test('Lista: instalación, compras sin barrenos, personalizadas y errores quedan en «aparte» con su motivo', () => {
  const base = { cantidad: 1, material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', ref_diametro: 'INTERIOR' };
  const cot2 = {
    cliente: 'Cliente de ejemplo', proyecto: 'Colector', fecha: '2026-10-16', riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', unidad_diam: 'in', unidad_long: 'mm',
    partidas: [
      { id: 'a', ...base, familia: 'CODO', D_mm: 304.8, theta_deg: 90, k_R: 1.5, cantidad: 2 },
      { id: 'b', familia: 'COMPRADO', descripcion: 'Compuerta de guillotina', precio_compra_unitario: 1850, peso_kg: 9, cantidad: 1 },
      { id: 'c', familia: 'INSTALACION', descripcion: 'Instalación en obra', personas: 2, dias: 2, viajes: 1, gasolina_viaje: 600, comida_dia: 200, cantidad: 1 },
      { id: 'd', ...base, familia: 'PERSONALIZADO', descripcion: 'Campana a la medida', A_neta_m2: 2, cantidad: 1 },
      { id: 'e', ...base, familia: 'RECTO', D_mm: 0, L_mm: 100, cantidad: 1 },
      { id: 'f', familia: 'SOPORTE', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, cantidad: 6 },
    ],
  };
  const r2 = C.cotizar(cot2, M);
  const l2 = LF.listaFabricacion(cot2, r2, r2.maestros);
  assert.deepEqual(l2.piezas.map((q) => q.marca), ['C1', 'S1']);
  assert.deepEqual(l2.aparte.map((a) => a.id), ['b', 'c', 'd', 'e']);
  const motivo = (id) => l2.aparte.find((a) => a.id === id).motivo;
  assert.match(motivo('b'), /comprado/i);
  assert.match(motivo('c'), /instalación/i);
  assert.match(motivo('d'), /personalizada/i);
  assert.match(motivo('e'), /errores/i);
  // piezas + aparte son todas las partidas: nada se oculta
  assert.equal(l2.piezas.length + l2.aparte.length, cot2.partidas.length);
  const suma = [0, 5].reduce((s, i) => s + r2.partidas[i].peso.neto_total_kg, 0);
  assert.ok(Math.abs(l2.totales.kg - suma) < 1e-9);
});

test('Lista: una tapa tiene su hoja y su marca (no se pierde)', () => {
  const cot3 = { proyecto: 'T', fecha: '2026-10-16', partidas: [{ id: 't', familia: 'TAPA', material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', D_mm: 304.8, cantidad: 2 }] };
  const r3 = C.cotizar(cot3, M);
  const l3 = LF.listaFabricacion(cot3, r3, r3.maestros);
  assert.deepEqual(l3.piezas.map((q) => q.marca), ['P1']);
  assert.equal(med(l3.piezas[0], 'Ø'), '12″ (304.8 mm)');
});

test('Lista: es una hoja de taller, sin precios ni signos de pesos', () => {
  const todos = textos({ ...L, piezas: L.piezas.map((q) => ({ ...q })) });
  assert.ok(todos.length > 500);
  assert.ok(todos.every((t) => !t.includes('$')), todos.find((t) => t.includes('$')));
  assert.doesNotMatch(JSON.stringify(Object.keys(L.piezas[0])), /precio|importe|costo/i);
  assert.doesNotMatch(JSON.stringify(Object.keys(L.totales)), /precio|importe|costo/i);
});

test('Lista: sin la advertencia de calibre «mínimo recomendado»; las demás notas siguen y la cotización la conserva', () => {
  // la cotización detallada sí la trae (es una recomendación de cotización, no de taller)
  assert.ok(res.partidas.some((f) => (f.advertencias || []).some((w) => /mínimo recomendado/.test(w))));
  assert.ok(L.piezas.every((q) => [...q.advertencias, ...q.notas].every((n) => !/mínimo recomendado/.test(n))));
  const notas = new Set(L.piezas.flatMap((q) => q.notas));
  assert.ok(notas.has('Costuras y juntas engargoladas'));
  assert.ok([...notas].some((n) => /^Bridas con ceja/.test(n)));
  assert.ok([...notas].some((n) => /^Bridas de otra partida/.test(n)));
});
