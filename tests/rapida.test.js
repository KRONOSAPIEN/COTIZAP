'use strict';
/**
 * Cotización rápida (motor/rapida.js): la regla del taller del 7-oct-2026.
 *   lámina en hojas enteras × precio sin IVA × 3 + bridas por metros (≤ 40 m $5,000; ≤ 80 m $12,000; ≤ 120 m $18,000)
 *   + utilidad sobre el costo + IVA.
 * El oráculo se calcula aquí a mano, con los datos de la lista del proveedor y de las tablas, sin usar el motor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const R = require('../src/motor/rapida');
const V = require('../src/motor/validacion');
const C = require('../src/motor/cotizador');
const U = require('../src/motor/util');

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 0.005), `${msg || ''}: ${a} ≠ ${b}`);

test('Oráculo: ducto de 11″ y 40 m en lámina galvanizada cal. 22 de 4 × 10 ft', () => {
  const M = crearMaestros();
  const r = R.cotizar({ D_mm: 11 * 25.4, L_m: 40 }, M);
  // hoja de 1219 × 3048 mm a $920 con IVA → $793.10 sin IVA; cal. 22 galvanizado = 0.0336″ = 0.85344 mm
  const e = 0.0336 * 25.4;
  const B = Math.PI * (279.4 + e) + 32; // perímetro medio + holgura del Pittsburgh (el galvanizado se engargola)
  cerca(r.plantilla_mm, B, 1e-6, 'plantilla');
  assert.equal(r.yardas, Math.ceil(40000 / 1219)); // 33 yardas de 1.219 m
  assert.equal(r.yardas_por_hoja, Math.floor(3048 / B)); // 3 por hoja
  assert.equal(r.hojas, 11);
  const hoja = 920 / 1.16;
  cerca(r.lamina, 11 * hoja, 1e-6, 'lámina');
  cerca(r.lamina_factor, 3 * 11 * hoja, 1e-6, 'lámina × 3');
  assert.equal(r.bridas.importe, 5000);
  const costo = 3 * 11 * hoja + 5000;
  cerca(r.costo, costo, 1e-6, 'costo');
  cerca(r.utilidad, 0.2 * costo, 1e-6, 'utilidad sobre el costo');
  cerca(r.precio, 1.2 * costo, 1e-6, 'precio antes de IVA');
  cerca(r.iva, 0.16 * 1.2 * costo, 1e-6, 'IVA');
  cerca(r.total, 1.16 * 1.2 * costo, 1e-6, 'total');
  cerca(r.total, 43392.0, 0.005, 'total redondeado');
});

test('Bridas por metros: 40 m o menos, de 40 a 80 y de 80 a 120; más de 120 m es error', () => {
  const M = crearMaestros();
  const bridas = (L) => R.cotizar({ D_mm: 279.4, L_m: L }, M).bridas.importe;
  assert.equal(bridas(0.5), 5000);
  assert.equal(bridas(40), 5000, '40 m todavía son $5,000');
  assert.equal(bridas(40.01), 12000);
  assert.equal(bridas(80), 12000);
  assert.equal(bridas(80.5), 18000);
  assert.equal(bridas(120), 18000);
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 121 }, M), (e) => e instanceof U.ErrorValidacion && /llegan a 120 m/.test(e.message));
  // un renglón más en las tablas lo cubre
  M.rapida.bridas_por_metros.push({ hasta_m: 160, importe: 24000 });
  assert.equal(bridas(121), 24000);
});

test('Utilidad de la cotización y factor de las tablas', () => {
  const M = crearMaestros();
  const base = R.cotizar({ D_mm: 152.4, L_m: 60 }, M);
  const sin = R.cotizar({ D_mm: 152.4, L_m: 60, utilidad_pct: 0 }, M);
  assert.equal(sin.utilidad, 0);
  cerca(sin.precio, base.costo, 1e-9);
  cerca(base.precio, base.costo * 1.2, 1e-9);
  M.rapida.factor_lamina = 2.5;
  const f = R.cotizar({ D_mm: 152.4, L_m: 60 }, M);
  cerca(f.lamina_factor, base.lamina * 2.5, 1e-9);
  assert.equal(f.hojas, base.hojas);
});

test('Hojas: más metros o más diámetro nunca piden menos hojas; la plantilla más larga que la hoja también se cuenta', () => {
  const M = crearMaestros();
  let previo = 0;
  [10, 20, 40, 41, 80, 120].forEach((L) => { const n = R.cotizar({ D_mm: 254, L_m: L }, M).hojas; assert.ok(n >= previo, `${L} m`); previo = n; });
  previo = 0;
  [76.2, 127, 203.2, 279.4, 457.2, 609.6, 914.4, 1219.2].forEach((D) => { const n = R.cotizar({ D_mm: D, L_m: 20 }, M).hojas; assert.ok(n >= previo, `${D} mm`); previo = n; });
  // 1 200 mm: plantilla de ~3 805 mm > 3 048 → por yarda una hoja completa y un retazo de ~757 mm (4 retazos por hoja)
  const g = R.cotizar({ D_mm: 1200, L_m: 10 }, M);
  assert.equal(g.yardas, 9);
  assert.equal(g.hojas, 9 + Math.ceil(9 / 4));
  assert.equal(g.advertencias.length, 1);
  // las hojas alcanzan para el área que se pide
  [[101.6, 7], [279.4, 40], [508, 95]].forEach(([D, L]) => {
    const r = R.cotizar({ D_mm: D, L_m: L }, M);
    assert.ok(r.hojas * r.hoja.ancho_mm * r.hoja.largo_mm >= r.plantilla_mm * L * 1000 - 1, `${D} mm × ${L} m`);
    assert.ok(r.aprovechamiento > 0 && r.aprovechamiento <= 1);
  });
});

test('Otra lámina: la hoja elegida cambia el precio y el tamaño; sólo se ofrecen láminas con precio (no placas)', () => {
  const M = crearMaestros();
  const ids = R.hojas(M).map((x) => x.id);
  assert.ok(ids.includes('GALV_C22_4X10') && ids.includes('NEGRA_C12_3X10'));
  assert.ok(!ids.some((id) => /PLACA/.test(id)));
  const c24 = R.cotizar({ D_mm: 279.4, L_m: 40, hoja_id: 'GALV_C24_4X10' }, M);
  cerca(c24.hoja.sin_iva, 700 / 1.16, 1e-9);
  const negra = R.cotizar({ D_mm: 279.4, L_m: 40, hoja_id: 'NEGRA_C12_3X10' }, M);
  assert.equal(negra.yardas, Math.ceil(40000 / 914)); // yardas de 3 ft
  assert.equal(negra.costura, 'A_TOPE');
  cerca(negra.holgura_mm, M.proceso.costuras.A_TOPE.allowance_mm, 1e-9, 'la costura soldada a tope no lleva la holgura del Pittsburgh');
});

test('Errores legibles: datos vacíos, fuera de rango o tablas rotas', () => {
  const M = crearMaestros();
  const msgs = (entrada, Mx) => { try { R.cotizar(entrada, Mx || M); return []; } catch (e) { assert.ok(e instanceof U.ErrorValidacion); return e.errores; } };
  assert.deepEqual(msgs({}), ['Capture el diámetro máximo.', 'Capture los metros hasta el punto más alejado.']);
  assert.match(msgs({ D_mm: 10, L_m: 5 })[0], /al menos 25 mm/);
  assert.match(msgs({ D_mm: 279.4, L_m: -3 })[0], /metros/);
  assert.match(msgs({ D_mm: 279.4, L_m: 5, hoja_id: 'NO_EXISTE' })[0], /no está en la lista del proveedor/);
  assert.match(msgs({ D_mm: 279.4, L_m: 5, utilidad_pct: NaN })[0], /utilidad/);
  const Mx = crearMaestros();
  Mx.rapida.factor_lamina = 0;
  Mx.rapida.bridas_por_metros = [{ hasta_m: 80, importe: 12000 }, { hasta_m: 40, importe: 5000 }];
  const m = msgs({ D_mm: 279.4, L_m: 5 }, Mx).join(' | ');
  assert.match(m, /factor lamina/);
  assert.match(m, /de menor a mayor/);
});

test('Las tablas de arranque están sanas y una tabla rápida rota no bloquea la cotización detallada', () => {
  assert.deepEqual(V.problemasMaestros(crearMaestros()), []);
  const Mx = crearMaestros();
  Mx.rapida.hoja_defecto = 'NO_EXISTE';
  assert.equal(V.problemasMaestros(Mx).length, 1);
  const res = C.cotizar({ partidas: [{ id: 'p1', familia: 'RECTO', material_id: 'GALVANIZADO', calibre: 22, D_mm: 279.4, L_mm: 3000, cantidad: 1 }] }, Mx);
  assert.equal(res.totales.n_partidas_error, 0);
  // un parche guardado con otra forma se descarta y queda el valor de arranque
  const M2 = crearMaestros({ rapida: { factor_lamina: 'tres', bridas_por_metros: [{ hasta_m: 50, importe: 6000 }] } });
  assert.equal(M2.rapida.factor_lamina, 3);
  assert.deepEqual(M2.rapida.bridas_por_metros, [{ hasta_m: 50, importe: 6000 }]);
});
