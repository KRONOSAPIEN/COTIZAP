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
  assert.equal(r.yarda_mm, 1220, 'sin elegirla, la yarda de las tablas: 4 ft');
  assert.equal(r.yardas, Math.ceil(40000 / 1220)); // 33 yardas de 1.22 m
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
  const g = R.cotizar({ D_mm: 1200, L_m: 10, yarda_mm: 1219 }, M);
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
  const negra = R.cotizar({ D_mm: 279.4, L_m: 40, hoja_id: 'NEGRA_C12_3X10', yarda_mm: 914 }, M);
  assert.equal(negra.yardas, Math.ceil(40000 / 914)); // yardas de 3 ft
  assert.equal(negra.yardas_por_hoja, 3);
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

test('Yarda de 3 o 4 ft: con la hoja de 4 × 10 ft la de 3 ft deja una franja de sobrante; con la de 3 × 10 ft la ocupa entera', () => {
  const M = crearMaestros();
  const de4 = R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 1220 }, M);
  const de3 = R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 914 }, M);
  assert.equal(de3.yardas, Math.ceil(40000 / 914)); // 44 yardas de 3 ft
  assert.equal(de3.yardas_por_hoja, 3);
  assert.equal(de3.hojas, Math.ceil(44 / 3));
  assert.equal(de3.hoja.id, 'GALV_C22_4X10', 'en galvanizado sólo hay hoja de 4 ft en la lista');
  assert.ok(de3.total > de4.total && de3.aprovechamiento < de4.aprovechamiento);
  // si el proveedor tiene la hoja de 3 × 10 ft del mismo material y calibre, la yarda de 3 ft la toma sola
  M.proveedor.hojas.GALV_C22_3X10 = { descripcion: 'Lámina galvanizada 3 × 10 ft · cal. 22', material: 'GALVANIZADO', calibre: 22, esp_mm: 0, ancho_mm: 914, largo_mm: 3048, precio: 700 };
  const con3 = R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 914 }, M);
  assert.equal(con3.hoja.id, 'GALV_C22_3X10');
  assert.equal(con3.yardas_por_hoja, 3);
  assert.ok(con3.aprovechamiento > 0.85);
  assert.equal(R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 1220 }, M).hoja.id, 'GALV_C22_4X10', 'la de 4 ft sigue en la hoja de 4 ft');
  assert.equal(R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 914, hoja_id: 'GALV_C22_4X10' }, M).hoja.id, 'GALV_C22_4X10', 'la lámina elegida manda');
  // la yarda que no cabe en la hoja, o fuera de los límites, es error
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 100 }, M), /yarda debe ser de 300 a 2000 mm/);
  assert.deepEqual(R.yardas(M), [914, 1220]);
});

test('Acomodo: las plantillas no se enciman, caen dentro de la hoja y nadie acomoda más que el área', () => {
  const casos = [[1219, 3048, 1220, 912], [1219, 3048, 914, 912], [1219, 3048, 914, 274], [1219, 3048, 1220, 434], [914, 3048, 914, 1471], [1219, 2438, 914, 640], [1219, 3048, 914, 3300]];
  casos.forEach(([A, L, Y, B]) => {
    const a = R.acomodo(A, L, Y, B);
    assert.equal(a.n, a.piezas.length);
    const tol = 3;
    a.piezas.forEach((p, i) => {
      assert.ok(p.x >= -1e-9 && p.y >= -1e-9 && p.x + p.w <= L + tol && p.y + p.h <= A + tol, `${A}×${L} ${Y}×${B}: pieza ${i} fuera de la hoja`);
      assert.ok((p.girada ? [p.w, p.h] : [p.h, p.w]).every((v, k) => Math.abs(v - [Y, B][k]) < 1e-9), 'cada pieza mide yarda × plantilla');
      a.piezas.slice(i + 1).forEach((q) => {
        const cruza = p.x < q.x + q.w - 1e-6 && q.x < p.x + p.w - 1e-6 && p.y < q.y + q.h - 1e-6 && q.y < p.y + p.h - 1e-6;
        assert.ok(!cruza, `${A}×${L} ${Y}×${B}: piezas encimadas`);
      });
    });
    assert.ok(a.n * Y * B <= (A + tol) * (L + tol), 'no más plantillas que el área');
    // nunca peor que todas derechas o todas giradas
    const rej = (w, h) => Math.floor((L + tol) / w) * Math.floor((A + tol) / h);
    assert.ok(a.n >= rej(B, Y) && a.n >= rej(Y, B));
  });
  // 3″ con yarda de 3 ft en la hoja de 4 × 10: 11 derechas y una franja de 3 giradas en el sobrante
  const mixto = R.acomodo(1219, 3048, 914, 274);
  assert.equal(mixto.n, 14);
  assert.equal(mixto.forma, 'MIXTO');
  assert.equal(R.acomodo(1219, 3048, 914, 3300).n, 0, 'la plantilla más larga que la hoja no se acomoda');
});

test('Plazo: los días de fabricación e instalación se informan y no cambian el precio', () => {
  const M = crearMaestros();
  const sin = R.cotizar({ D_mm: 279.4, L_m: 40 }, M);
  assert.equal(sin.plazo, null);
  const con = R.cotizar({ D_mm: 279.4, L_m: 40, dias_fabricacion: 5, dias_instalacion: 2.5 }, M);
  assert.deepEqual(con.plazo, { fabricacion: 5, instalacion: 2.5, total: 7.5 });
  assert.equal(con.total, sin.total);
  assert.deepEqual(R.cotizar({ D_mm: 279.4, L_m: 40, dias_instalacion: 3 }, M).plazo, { fabricacion: 0, instalacion: 3, total: 3 });
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40, dias_fabricacion: -1 }, M), /días de fabricación deben ser de 0 a 365/);
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40, dias_instalacion: NaN }, M), /días de instalación/);
});
