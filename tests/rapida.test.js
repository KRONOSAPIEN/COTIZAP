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
  delete M.proveedor.hojas.GALV_C22_3X10; // como antes de cotizar las galvanizadas de 3 ft
  delete M.proveedor.hojas.GALV_C22_3X8;
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
  // la de las tablas de arranque: 3 × 10 ft aproximada ($690 con IVA) → 15 hojas, casi el mismo precio que con yardas de 4 ft
  const arr = R.cotizar({ D_mm: 279.4, L_m: 40, yarda_mm: 914 }, crearMaestros());
  assert.equal(arr.hoja.id, 'GALV_C22_3X10');
  assert.equal(arr.hojas, 15);
  cerca(arr.lamina, 15 * 690 / 1.16, 1e-6);
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

test('Días: dan el plazo y suman su mano de obra (bridas: 1 persona × $500; instalación: 2 × $500) antes de la utilidad', () => {
  const M = crearMaestros();
  const sin = R.cotizar({ D_mm: 279.4, L_m: 40 }, M);
  assert.equal(sin.plazo, null);
  assert.equal(sin.mano_obra.fabricacion.importe + sin.mano_obra.instalacion.importe, 0, 'sin días, sin mano de obra');
  const con = R.cotizar({ D_mm: 279.4, L_m: 40, dias_fabricacion: 5, dias_instalacion: 2.5 }, M);
  assert.deepEqual(con.plazo, { fabricacion: 5, instalacion: 2.5, total: 7.5 });
  assert.deepEqual(con.mano_obra.fabricacion, { dias: 5, personas: 1, pago_dia: 500, importe: 2500 });
  assert.deepEqual(con.mano_obra.instalacion, { dias: 2.5, personas: 2, pago_dia: 500, importe: 2500 });
  cerca(con.costo, sin.costo + 2500 + 2500, 1e-9, 'la mano de obra se suma al costo');
  cerca(con.total, (sin.costo + 5000) * 1.2 * 1.16, 1e-6, 'y lleva utilidad e IVA');
  // el caso de la pestaña: 11″ y 40 m, 5 días de bridas y 3 de instalación → $51,048.00
  cerca(R.cotizar({ D_mm: 279.4, L_m: 40, dias_fabricacion: 5, dias_instalacion: 3 }, M).total, ((11 * 920 / 1.16) * 3 + 5000 + 2500 + 3000) * 1.2 * 1.16, 1e-6);
  assert.deepEqual(R.cotizar({ D_mm: 279.4, L_m: 40, dias_instalacion: 3 }, M).plazo, { fabricacion: 0, instalacion: 3, total: 3 });
  // las personas y el pago por día salen de las tablas
  const M3 = crearMaestros();
  M3.rapida.personas_instalacion = 3;
  M3.rapida.pago_dia_instalacion = 600;
  assert.equal(R.cotizar({ D_mm: 279.4, L_m: 40, dias_instalacion: 2 }, M3).mano_obra.instalacion.importe, 2 * 3 * 600);
  M3.rapida.personas_fabricacion = 1.5;
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40 }, M3), /personas fabricacion: debe ser un número entero de personas/);
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40, dias_fabricacion: -1 }, M), /días de fabricación deben ser de 0 a 365/);
  assert.throws(() => R.cotizar({ D_mm: 279.4, L_m: 40, dias_instalacion: NaN }, M), /días de instalación/);
});

test('El arreglo unifilar del 22-sep-2026: 31 m a 11″ en yardas de 3 ft — el desarrollo es el perímetro, no el diámetro', () => {
  const M = crearMaestros();
  const e = 0.0336 * 25.4; // cal. 22 galvanizado
  const desarrollo = Math.PI * (279.4 + e); // 880.4 mm
  const B = desarrollo + 32; // + la holgura del Pittsburgh: 912.4 mm
  // la nota del plano tomó el desarrollo como 279 × 914 (el diámetro): de una lámina de 3 × 8 ft «salen 8 yardas» → 34 ÷ 8 = 4.25 → 5 láminas
  assert.equal(R.acomodo(914, 2438, 914, 279).n, 8);
  assert.equal(Math.ceil(Math.ceil(31000 / 914) / 8), 5);
  // con el desarrollo de verdad, de una lámina de 3 × 8 ft salen 2 yardas y de una de 3 × 10 ft, 3
  assert.equal(R.acomodo(914, 2438, 914, B).n, 2);
  assert.equal(R.acomodo(914, 3048, 914, B).n, 3);
  const r = R.cotizar({ D_mm: 279.4, L_m: 31, yarda_mm: 914, dias_fabricacion: 4, dias_instalacion: 5 }, M);
  cerca(r.desarrollo_mm, desarrollo, 1e-6, 'desarrollo');
  cerca(r.plantilla_mm, B, 1e-6, 'plantilla');
  assert.equal(r.yardas, 34);
  assert.equal(r.hoja.id, 'GALV_C22_3X10', 'sin elegir: de las de 3 ft, la que menos desperdicia (3 × 10: 12 hojas; 3 × 8: 17)');
  assert.equal(r.hojas_comparadas, 2);
  assert.equal(r.hojas, 12);
  const r38 = R.cotizar({ D_mm: 279.4, L_m: 31, yarda_mm: 914, hoja_id: 'GALV_C22_3X8' }, M);
  assert.equal(r38.hojas, 17);
  assert.ok(r38.lamina > r.lamina);
  // el total de la regla con 4 días de bridas y 5 de instalación (2 personas)
  cerca(r.costo, (12 * 690 / 1.16) * 3 + 5000 + 4 * 500 + 5 * 2 * 500, 1e-6);
  cerca(r.total, 46512.0, 0.005);
});

test('Sin elegir lámina: del ancho de la yarda, la que menos desperdicia; la elegida manda', () => {
  const M = crearMaestros();
  assert.deepEqual(R.hojasDeLaYarda(M, 914), ['GALV_C22_3X10', 'GALV_C22_3X8']);
  assert.deepEqual(R.hojasDeLaYarda(M, 1220), ['GALV_C22_4X10']);
  // 6″ y 40 m: 3 × 8 ft da 4 por hoja (11 hojas) y 3 × 10 ft, 5 (9 hojas): por área gana la de 3 × 8
  const seis = R.cotizar({ D_mm: 152.4, L_m: 40, yarda_mm: 914 }, M);
  assert.equal(seis.hoja.id, 'GALV_C22_3X8');
  const otra = R.cotizar({ D_mm: 152.4, L_m: 40, yarda_mm: 914, hoja_id: 'GALV_C22_3X10' }, M);
  assert.ok(seis.lamina <= otra.lamina);
  // en todo diámetro, la que elige nunca cuesta más que la otra del mismo ancho
  [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18].forEach((pulg) => {
    const auto = R.cotizar({ D_mm: pulg * 25.4, L_m: 37, yarda_mm: 914 }, M);
    ['GALV_C22_3X10', 'GALV_C22_3X8'].forEach((id) => {
      assert.ok(auto.lamina <= R.cotizar({ D_mm: pulg * 25.4, L_m: 37, yarda_mm: 914, hoja_id: id }, M).lamina + 0.005, `${pulg}″ ${id}`);
    });
  });
  // con yardas de 4 ft sólo hay una del ancho: la de las tablas
  assert.equal(R.cotizar({ D_mm: 152.4, L_m: 40 }, M).hoja.id, 'GALV_C22_4X10');
});

test('Ménsulas por piezas: las que estime el ingeniero (o las sugeridas), del ángulo y la solera elegidos, costeadas como partidas', () => {
  const M = crearMaestros();
  const base = { D_mm: 279.4, L_m: 31, yarda_mm: 914.4, dias_fabricacion: 4, dias_instalacion: 5 };
  const no = R.cotizar(base, M);
  assert.equal(no.soporteria.menulas, 0, 'sin decir: no lleva (como antes)');
  assert.equal(no.soporteria.sugeridas, 13, 'pero dice cuántas se sugieren: 31 m ÷ 2.5 = 12.4 → 13');
  assert.equal(no.total, 46512);
  // las mismas piezas cotizadas como partidas de soportería dan el mismo costo directo
  const S = M.rapida.soporteria;
  const cd = (n, men, abz) => C.cotizarPartida({ familia: 'SOPORTE', cantidad: n, barra_id: men, largo_pieza_mm: S.menula_largo_mm, anclajes_pieza: S.menula_anclajes, min_pieza: S.menula_min }, M).costos.CD
    + C.cotizarPartida({ familia: 'SOPORTE', cantidad: n, barra_id: abz, abrazadera_D_mm: 279.4, abrazadera_vuelta: S.abrazadera_vuelta, min_pieza: S.abrazadera_min }, M).costos.CD;
  const au = R.cotizar({ ...base, menulas: 'AUTO' }, M);
  assert.equal(au.soporteria.menulas, 13);
  assert.equal(au.soporteria.sugeridas_usadas, true);
  assert.equal(S.abrazadera_barra, 'SOL_1_1_4X1_8', 'de arranque, solera 1¼″ × 1/8″');
  cerca(au.soporteria.importe, cd(13, 'ANG_1_1_4X1_8', 'SOL_1_1_4X1_8'), 1e-9);
  cerca(au.costo, no.costo + au.soporteria.importe, 1e-9);
  cerca(au.total, (no.costo + au.soporteria.importe) * 1.2 * 1.16, 1e-6);
  // las que estime el ingeniero, de ángulo 1½″ × 3/16″ y solera 1½″ × 3/16″
  const siete = R.cotizar({ ...base, menulas: 7, menula_barra: 'ANG_1_1_2X3_16', abrazadera_barra: 'SOL_1_1_2X3_16' }, M).soporteria;
  assert.equal(siete.menulas, 7);
  assert.equal(siete.sugeridas_usadas, false);
  cerca(siete.importe, cd(7, 'ANG_1_1_2X3_16', 'SOL_1_1_2X3_16'), 1e-9);
  assert.match(siete.menula.barra, /Ángulo 1½" × 3\/16"/);
  assert.match(siete.abrazadera.barra, /Solera 1½" × 3\/16"/);
  const siete14 = R.cotizar({ ...base, menulas: 7 }, M).soporteria;
  assert.ok(siete.unitario > siete14.unitario, 'el ángulo y la solera más gruesos cuestan más');
  cerca(siete14.importe, 2416.78, 0.005, '7 ménsulas de 1¼″ con su abrazadera: $2,416.78 (el caso real gastó $2,386.20)');
  assert.equal(R.cotizar({ ...base, menulas: 0 }, M).extras.soporteria, 0, '0 = no lleva');
  assert.equal(R.cotizar({ ...base, L_m: 40, menulas: 'AUTO' }, M).soporteria.menulas, 16);
  assert.equal(R.cotizar({ ...base, L_m: 1, menulas: 'AUTO' }, M).soporteria.menulas, 1, 'al menos una');
  const M2 = crearMaestros();
  M2.proceso.soportes.espaciado.horizontal_m = 2;
  assert.equal(R.cotizar({ ...base, menulas: 'AUTO' }, M2).soporteria.menulas, 16, 'la separación de Proceso › Soportería manda: 31 m ÷ 2 = 15.5 → 16');
  // listas para elegir: ángulos y soleras con precio
  assert.deepEqual(R.barrasDeTipo(M, 'ANGULO').map((b) => b.id), ['ANG_1_1_2X3_16', 'ANG_2X3_16', 'ANG_1_1_4X1_8', 'ANG_3_4X1_8']);
  assert.deepEqual(R.barrasDeTipo(M, 'SOLERA').map((b) => b.id), ['SOL_1_1_2X3_16', 'SOL_1_1_4X1_8', 'SOL_1X1_8']);
  // errores legibles
  assert.throws(() => R.cotizar({ ...base, menulas: 2.5 }, M), /Las ménsulas debe ser un número entero de piezas/);
  assert.throws(() => R.cotizar({ ...base, menulas: 3, menula_barra: 'NO_EXISTE' }, M), /El ángulo de la ménsula «NO_EXISTE»/);
  assert.throws(() => R.cotizar({ ...base, menulas: 3, abrazadera_barra: 'NO_EXISTE' }, M), /La solera de la abrazadera «NO_EXISTE»/);
  assert.doesNotThrow(() => R.cotizar({ ...base, menulas: 0, menula_barra: 'NO_EXISTE' }, M), 'sin ménsulas no importa la barra');
  const M3 = crearMaestros();
  M3.rapida.soporteria.menula_barra = 'NO_EXISTE';
  assert.throws(() => R.cotizar(base, M3), /menula barra: debe ser una barra de la lista del proveedor/);
});

test('Mangueras por tramos del catálogo con sus abrazaderas (6 por tramo si no se dice), y viáticos por importe', () => {
  const M = crearMaestros();
  const base = { D_mm: 279.4, L_m: 31, yarda_mm: 914.4, dias_fabricacion: 4, dias_instalacion: 5 };
  const no = R.cotizar(base, M);
  assert.deepEqual(no.extras, { mangueras: 0, soporteria: 0, viaticos: 0, importe: 0 });
  const tres = R.cotizar({ ...base, mangueras_tramos: 3 }, M).mangueras;
  assert.equal(tres.manguera.id, 'MANGUERA_6');
  assert.equal(tres.abrazaderas, 18, '6 por tramo');
  assert.equal(tres.abrazaderas_sugeridas, true);
  cerca(tres.abrazadera.unitario, 55 / 1.16, 1e-9, 'la abrazadera trae IVA: se cuesta sin él');
  cerca(tres.importe, 3 * 1807.49 + 18 * (55 / 1.16), 1e-9);
  cerca(tres.importe, 6275.92, 0.005, 'lo que gastó el caso real en mangueras');
  const cinco = R.cotizar({ ...base, mangueras_tramos: 2, manguera_id: 'MANGUERA_5', abrazaderas_manguera: 4 }, M).mangueras;
  cerca(cinco.importe, 2 * 1427.03 + 4 * (55 / 1.16), 1e-9);
  assert.equal(cinco.abrazaderas_sugeridas, false);
  assert.equal(R.cotizar({ ...base, abrazaderas_manguera: 2 }, M).mangueras.abrazaderas, 2, 'abrazaderas sueltas, sin tramos');
  assert.deepEqual(R.manguerasDelCatalogo(M).map((x) => x.id), ['MANGUERA_6', 'MANGUERA_5', 'MANGUERA_3']);
  // el caso real completo: 7 ménsulas, 3 tramos y los viáticos
  const todo = R.cotizar({ ...base, menulas: 7, mangueras_tramos: 3, viaticos: 1987.93 }, M);
  cerca(todo.extras.importe, 2416.78 + 6275.92 + 1987.93, 0.01);
  cerca(todo.costo, no.costo + todo.extras.importe, 1e-9);
  cerca(todo.total, 61379.44, 0.005);
  assert.equal(todo.entrada.mangueras_tramos, 3);
  assert.throws(() => R.cotizar({ ...base, mangueras_tramos: -1 }, M), /Los tramos de manguera debe ser un número entero/);
  assert.throws(() => R.cotizar({ ...base, mangueras_tramos: 1, manguera_id: 'NO_EXISTE' }, M), /La manguera «NO_EXISTE»/);
  assert.throws(() => R.cotizar({ ...base, viaticos: 'mucho' }, M), /importe de viáticos/);
  assert.deepEqual(V.problemasMaestros(crearMaestros(), { solo: ['rapida'] }), []);
  const M4 = crearMaestros();
  M4.rapida.mangueras.abrazaderas_por_tramo = 2.5;
  assert.match(V.problemasMaestros(M4, { solo: ['rapida'] }).map(V.textoProblema).join(' '), /abrazaderas por tramo/);
});
