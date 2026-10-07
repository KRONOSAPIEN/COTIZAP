'use strict';
/**
 * Lista de precios del proveedor y mano de obra por hora.
 *
 * El proveedor cotiza por pieza (hoja, barra) y con IVA incluido; el motor cuesta el acero por kg y SIN IVA.
 * Los kg de cada pieza se recalculan aquí con aritmética directa desde las medidas (calibres en pulgadas, como
 * los publica la norma), sin llamar a las funciones del módulo que se prueba.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PROV = require('../src/motor/proveedor');
const MO = require('../src/motor/mano_obra');
const C = require('../src/motor/cotizador');
const { crearMaestros, migrarParche } = require('../src/datos/maestros');

const M = crearMaestros();
const IN = 25.4;
const casi = (real, esperado, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(real - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${msg} esperado ${esperado}, obtenido ${real}`);
};
const kgHoja = (ancho_mm, largo_mm, esp_mm, dens = 7850) => (ancho_mm / 1000) * (largo_mm / 1000) * (esp_mm / 1000) * dens;
const todos = () => { const t = PROV.tablas(M); return [...t.hojas, ...t.barras]; };
const porId = (id) => todos().find((r) => r.id === id);

/* ---------- la lista reproduce la factura y las cotizaciones ---------- */

test('La lista reproduce la factura del 30-sep-2026: precio con IVA ÷ 1.16 = precio unitario sin IVA de la factura (al centavo)', () => {
  const factura = {
    NEGRA_C12_4X10: 1741.38, NEGRA_C12_4X8: 1396.55, NEGRA_C12_3X10: 1306.03, NEGRA_C12_3X8: 1043.1, PLACA_3_16_4X8: 2431.03,
    SOL_1_1_2X3_16: 215.52, ANG_1_1_2X3_16: 405.17, ANG_2X3_16: 531.03, ANG_3_4X1_8: 137.93, CANAL_U_6: 1876.88,
  };
  Object.entries(factura).forEach(([id, neto]) => {
    const r = porId(id);
    assert.ok(r, `falta ${id}`);
    assert.ok(Math.abs(r.sin_iva - neto) < 0.006, `${id}: ${r.sin_iva.toFixed(3)} contra ${neto} de la factura`);
  });
});

test('Cotizaciones de WhatsApp: galvanizada 4 × 10 cal. 22 = $920, cal. 24 = $700, ángulo 1¼" × 1/8" = $260, solera 1¼" × 1/8" = $150', () => {
  assert.equal(M.proveedor.hojas.GALV_C22_4X10.precio, 920);
  assert.equal(M.proveedor.hojas.GALV_C24_4X10.precio, 700);
  assert.equal(M.proveedor.barras.ANG_1_1_4X1_8.precio, 260);
  assert.equal(M.proveedor.barras.SOL_1_1_4X1_8.precio, 150);
  assert.equal(M.proveedor.iva_incluido_pct, 0.16, 'los precios traen IVA');
  // con IVA incluido el $/kg de cada pieza cae en la banda de la factura (acero negro ≈ $22.5/kg; perfiles ≈ $24–27/kg sin IVA)
  const kg = (id) => porId(id).precio_kg;
  assert.ok(kg('ANG_1_1_4X1_8') > 24 && kg('ANG_1_1_4X1_8') < 28);
  assert.ok(kg('SOL_1_1_4X1_8') > 24 && kg('SOL_1_1_4X1_8') < 28);
  assert.ok(kg('GALV_C22_4X10') > 28 && kg('GALV_C22_4X10') < 33);
});

/* ---------- kg por pieza y $/kg ---------- */

test('Hojas: kg = ancho · largo · espesor del calibre · densidad; $/kg = (precio / 1.16) / kg', () => {
  const casos = [
    ['GALV_C22_4X10', kgHoja(1219, 3048, 0.0336 * IN), 920], // GSG cal. 22 = 0.0336 in
    ['GALV_C24_4X10', kgHoja(1219, 3048, 0.0276 * IN), 700], // GSG cal. 24 = 0.0276 in
    ['NEGRA_C12_4X10', kgHoja(1219, 3048, 0.1046 * IN), 2020], // MSG cal. 12 = 0.1046 in
    ['NEGRA_C12_3X8', kgHoja(914, 2438, 0.1046 * IN), 1210],
    ['PLACA_3_16_4X8', kgHoja(1219, 2438, 4.7625), 2820], // placa: el espesor se captura (3/16")
  ];
  casos.forEach(([id, kg, precio]) => {
    const r = porId(id);
    casi(r.kg, kg, 1e-12, `kg ${id}`);
    casi(r.sin_iva, precio / 1.16, 1e-12, `sin IVA ${id}`);
    casi(r.precio_kg, precio / 1.16 / kg, 1e-12, `$/kg ${id}`);
  });
  casi(porId('GALV_C22_4X10').kg, 24.892, 1e-4);
  casi(porId('GALV_C22_4X10').precio_kg, 31.862, 1e-4);
  casi(porId('GALV_C24_4X10').precio_kg, 29.510, 1e-3);
});

test('Barras: peso lineal del perfil (solera b·t, ángulo t·(2b − t)) × largo; canal con kg/m capturado', () => {
  const sol = (38.1 * 4.763 * 7.85) / 1000; // la solera estándar sale de la tabla de perfiles (esp. 4.763 mm)
  casi(porId('SOL_1_1_2X3_16').kg, sol * 6, 1e-12); // el taller considera barras de 6 m
  casi(porId('SOL_1_1_2X3_16').precio_kg, 250 / 1.16 / (sol * 6), 1e-12);
  const ang = (3.175 * (2 * 31.75 - 3.175) * 7.85) / 1000; // ángulo 1¼" × 1/8" sin perfil de brida: usa sus medidas
  casi(porId('ANG_1_1_4X1_8').kg, ang * 6, 1e-12);
  const solera14 = (31.75 * 3.175 * 7.85) / 1000;
  casi(porId('SOL_1_1_4X1_8').kg, solera14 * 6, 1e-12);
  casi(porId('SOL_1_1_4X1_8').precio_kg, 150 / 1.16 / (solera14 * 6), 1e-12);
  Object.values(M.proveedor.barras).forEach((b) => assert.equal(b.largo_mm, 6000, `${b.descripcion}: barras de 6 m`));
  casi(porId('CANAL_U_6').kg, 12.2 * 6, 1e-12);
  casi(porId('CANAL_U_6').precio_kg, 2177.18 / 1.16 / 73.2, 1e-12);
});

test('IVA: si los precios se capturan antes de IVA (iva_incluido_pct = 0) el sin IVA es el mismo precio', () => {
  const M0 = crearMaestros({ proveedor: { iva_incluido_pct: 0 } });
  const h = PROV.tablas(M0).hojas.find((x) => x.id === 'GALV_C22_4X10');
  casi(h.sin_iva, 920, 1e-12);
  casi(h.precio_kg, 920 / kgHoja(1219, 3048, 0.0336 * IN), 1e-12);
  assert.equal(PROV.ivaIncluido(crearMaestros({ proveedor: { iva_incluido_pct: -1 } })), 0, 'un valor absurdo se toma como 0');
});

/* ---------- qué renglón usa el cálculo ---------- */

test('El cálculo usa la hoja cotizada de ese material y calibre (la del tamaño estándar del taller) y la barra del perfil', () => {
  assert.equal(PROV.laminaDe(M, 'GALVANIZADO', 22).id, 'GALV_C22_4X10');
  assert.equal(PROV.laminaDe(M, 'GALVANIZADO', '24').id, 'GALV_C24_4X10', 'el calibre puede venir como texto de la lista');
  assert.equal(PROV.laminaDe(M, 'GALVANIZADO', 16), null, 'sin cotizar: se usa la tabla por kg');
  assert.equal(PROV.laminaDe(M, 'ACERO_CARBON', 16), null);
  assert.equal(PROV.laminaDe(M, 'INOX_304', 22), null);
  assert.equal(PROV.laminaDe(M, 'ACERO_CARBON', 12).id, 'NEGRA_C12_4X10', 'hoja estándar 4 × 10');
  const M3 = crearMaestros({ proceso: { hoja: { ancho_mm: 914, largo_mm: 2438 } } });
  assert.equal(PROV.laminaDe(M3, 'ACERO_CARBON', 12).id, 'NEGRA_C12_3X8', 'si el estándar fuera 3 × 8, manda esa hoja');
  assert.equal(PROV.perfilDe(M, 'SOL38x4.8').id, 'SOL_1_1_2X3_16');
  assert.equal(PROV.perfilDe(M, 'L38x4.8').id, 'ANG_1_1_2X3_16');
  assert.equal(PROV.perfilDe(M, 'L51x4.8').id, 'ANG_2X3_16');
  assert.equal(PROV.perfilDe(M, 'L25x3.2'), null);
  const usos = Object.fromEntries(todos().map((r) => [r.id, r.uso]));
  // la hoja de 3 ft (914 mm) también se usa: es la de las yardas de 3 ft
  assert.deepEqual(Object.keys(usos).filter((k) => usos[k] === 'CALCULO').sort(),
    ['ANG_1_1_2X3_16', 'ANG_2X3_16', 'GALV_C22_4X10', 'GALV_C24_4X10', 'NEGRA_C12_3X10', 'NEGRA_C12_4X10', 'SOL_1_1_2X3_16']);
  assert.equal(usos.CANAL_U_6, 'REFERENCIA');
  assert.equal(usos.PLACA_3_16_4X8, 'REFERENCIA');
  assert.equal(usos.NEGRA_C12_4X8, 'REFERENCIA', 'otro largo de la misma lámina: no es la hoja de ninguna yarda');
  assert.equal(usos.NEGRA_C12_3X8, 'REFERENCIA');
});

test('La lámina de una yarda es la hoja de ese ancho (3 ft = 914 mm, 4 ft = 1 220 mm); sin esa hoja cotizada, la estándar', () => {
  assert.equal(PROV.laminaDe(M, 'ACERO_CARBON', 12, 914).id, 'NEGRA_C12_3X10');
  assert.equal(PROV.laminaDe(M, 'ACERO_CARBON', 12, 1220).id, 'NEGRA_C12_4X10', '1 220 y 1 219 son la misma hoja de 4 ft');
  assert.equal(PROV.laminaDe(M, 'ACERO_CARBON', 12).id, 'NEGRA_C12_4X10', 'sin ancho, la hoja estándar del taller');
  assert.equal(PROV.laminaDe(M, 'GALVANIZADO', 22, 914).id, 'GALV_C22_4X10', 'no hay galvanizada de 3 ft cotizada: se usa la de 4 ft');
  // por kg cuestan lo mismo (el proveedor cobra por área): cambiar de ancho de hoja no mueve el precio de la lámina
  casi(PROV.laminaDe(M, 'ACERO_CARBON', 12, 914).precio_kg, PROV.laminaDe(M, 'ACERO_CARBON', 12, 1220).precio_kg, 1e-3);
  // y el desglose de una partida dice cuál usó
  const p = (yarda) => C.cotizarPartida({ familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 12, D_mm: 304.8, L_mm: 3660, yarda_mm: yarda, tipo_union: 'LISO', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 1 }, M);
  assert.equal(p(914).costos.precios_usados.lamina.id, 'NEGRA_C12_3X10');
  assert.equal(p(1220).costos.precios_usados.lamina.id, 'NEGRA_C12_4X10');
});

test('Un precio inválido (0, negativo o sin medidas) no se usa: el cálculo cae a la tabla por kg', () => {
  [0, -5, 'abc'].forEach((precio) => {
    const Mx = crearMaestros();
    Mx.proveedor.hojas.GALV_C22_4X10.precio = precio; // a mano: crearMaestros descarta un parche con un texto donde va un número
    assert.equal(PROV.laminaDe(Mx, 'GALVANIZADO', 22), null, `precio ${precio}`);
  });
  const Msm = crearMaestros({ proveedor: { hojas: { GALV_C22_4X10: { ancho_mm: 0 } } } });
  assert.equal(PROV.laminaDe(Msm, 'GALVANIZADO', 22), null);
  assert.equal(PROV.tablas(Msm).hojas.find((r) => r.id === 'GALV_C22_4X10').precio_kg, null, 'se muestra sin $/kg');
  assert.doesNotThrow(() => PROV.tablas({ ...M, proveedor: undefined }), 'maestros sin lista: no se rompe');
});

/* ---------- integración con el cotizador ---------- */

const galv = (calibre, extra) => ({
  familia: 'RECTO', material_id: 'GALVANIZADO', calibre, D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 1, ...extra,
});

test('Cotizador: la lámina galvanizada cal. 22 se cuesta con la hoja de $920 (sin IVA, por kg de la hoja)', () => {
  const r = C.cotizarPartida(galv(22), M);
  const precio_kg = 920 / 1.16 / kgHoja(1219, 3048, 0.0336 * IN);
  casi(r.costos.materiales.lamina, r.qto.lam.m_bruta_kg * precio_kg, 1e-12);
  const u = r.costos.precios_usados.lamina;
  assert.equal(u.fuente, 'PROVEEDOR');
  assert.equal(u.id, 'GALV_C22_4X10');
  casi(u.precio_kg, precio_kg, 1e-12);
  // el cal. 24 usa su propia hoja
  const r24 = C.cotizarPartida(galv(24), M);
  casi(r24.costos.materiales.lamina, r24.qto.lam.m_bruta_kg * (700 / 1.16 / kgHoja(1219, 3048, 0.0276 * IN)), 1e-12);
});

test('Cotizador: un calibre sin cotizar, una placa de espesor capturado o el inoxidable usan el precio por kg de la tabla', () => {
  const r20 = C.cotizarPartida(galv(20), M);
  casi(r20.costos.materiales.lamina, r20.qto.lam.m_bruta_kg * M.precios.precio_kg_acero_galvanizado, 1e-12);
  assert.equal(r20.costos.precios_usados.lamina.fuente, 'TABLA');
  assert.equal(r20.costos.precios_usados.lamina.ref, 'precio_kg_acero_galvanizado');
  const placa = C.cotizarPartida(galv(22, { espesor_mm: 0.9 }), M);
  assert.equal(placa.costos.precios_usados.lamina.fuente, 'TABLA', 'con espesor capturado no se conoce el calibre');
  const inox = C.cotizarPartida({ ...galv(16), material_id: 'INOX_304' }, M);
  assert.equal(inox.costos.precios_usados.lamina.ref, 'precio_kg_inox_304');
  const negra16 = C.cotizarPartida({ ...galv(16), material_id: 'ACERO_CARBON' }, M);
  casi(negra16.costos.materiales.lamina, negra16.qto.lam.m_bruta_kg * M.precios.precio_kg_acero_carbon, 1e-12);
  const negra12 = C.cotizarPartida({ ...galv(12), material_id: 'ACERO_CARBON' }, M);
  assert.equal(negra12.costos.precios_usados.lamina.id, 'NEGRA_C12_4X10', 'la lámina negra cal. 12 viene de la factura');
});

test('Cotizador: cambiar el precio de la hoja o el IVA incluido mueve el costo de lámina en proporción exacta', () => {
  const base = C.cotizarPartida(galv(22), M);
  const caro = C.cotizarPartida(galv(22), crearMaestros({ proveedor: { hojas: { GALV_C22_4X10: { precio: 920 * 1.25 } } } }));
  casi(caro.costos.materiales.lamina, base.costos.materiales.lamina * 1.25, 1e-12);
  const sinIva = C.cotizarPartida(galv(22), crearMaestros({ proveedor: { iva_incluido_pct: 0 } }));
  casi(sinIva.costos.materiales.lamina, base.costos.materiales.lamina * 1.16, 1e-12, 'precios capturados antes de IVA');
  // el precio por kg de la tabla no mueve lo cotizado
  const tabla = C.cotizarPartida(galv(22), crearMaestros({ precios: { precio_kg_acero_galvanizado: 999 } }));
  casi(tabla.costos.materiales.lamina, base.costos.materiales.lamina, 1e-12);
});

/* ---------- mano de obra: salario por día y jornada ---------- */

test('Mano de obra: $500 por día sin utilidades ni prestaciones (FSR = 1.00); la hora es el salario del día ÷ 8 h = $62.50 + equipo', () => {
  [...MO.OPERACIONES, 'instalacion'].forEach((op) => assert.equal(M.mano_obra.operaciones[op].salario_diario, 500, op));
  assert.deepEqual(M.mano_obra.jornada, { horas_dia: 8 });
  assert.equal(M.mano_obra.FSR, 1, 'la hora como la calcula el taller: sin los días de descanso pagados ni prestaciones');
  const t = MO.tarifa(M, 'corte');
  casi(t.salario_hora, 62.5, 1e-12, '500 ÷ 8');
  casi(t.mo_h, 62.5, 1e-12);
  casi(t.equipo_h, 45, 1e-12);
  casi(t.total_h, 107.5, 1e-12);
  casi(MO.tarifa(M, 'instalacion').mo_h, 62.5, 1e-12, 'la cuadrilla de instalación también');
  // el trabajador gana $3,500 a la semana: ÷ 7 días = $500 por día, ÷ 8 h = $62.50
  casi(3500 / 7 / 8, t.salario_hora, 1e-12);
  // el factor recupera lo que se paga y no se trabaja: 7 días pagados por 5 trabajados → FSR 7/5 = 1.40 → $87.50
  casi(MO.tarifa(crearMaestros({ mano_obra: { FSR: 1.4 } }), 'soldadura').mo_h, 87.5, 1e-12);
  casi(MO.tarifa(crearMaestros({ mano_obra: { FSR: 1.4 } }), 'soldadura').mo_h * 40, 3500, 1e-9, 'con 1.40, las 40 h trabajadas pagan la semana completa');
  casi(MO.tarifa(crearMaestros({ mano_obra: { operaciones: { soldadura: { salario_diario: 600 } } } }), 'soldadura').mo_h, 600 / 8, 1e-12);
  casi(MO.tarifa(crearMaestros({ mano_obra: { jornada: { horas_dia: 10 } } }), 'corte').mo_h, 50, 1e-12);
  assert.equal('salario_hora' in M.mano_obra.operaciones.corte, false, 'el salario se captura por día, no por hora');
});

test('Mano de obra: un salario por día ausente o una jornada imposible se avisan con su ruta', () => {
  const Mx = crearMaestros();
  delete Mx.mano_obra.operaciones.rolado.salario_diario;
  assert.throws(() => MO.tarifa(Mx, 'rolado'), /salario por día de la operación «rolado»/);
  const r = C.cotizar({ partidas: [{ ...galv(22) }] }, Mx);
  assert.equal(r.totales.n_partidas_error, 1);
  assert.match(r.partidas[0].errores[0], /salario por día/);
  const malas = [
    [{ horas_dia: 0 }, /horas dia: debe ser un número mayor que 0/],
    [{ horas_dia: 25 }, /un día tiene 24 horas/],
  ];
  malas.forEach(([jornada, re]) => {
    const rr = C.cotizar({ partidas: [{ ...galv(22) }] }, crearMaestros({ mano_obra: { jornada } }));
    assert.equal(rr.totales.n_partidas_error, 1, JSON.stringify(jornada));
    assert.match(rr.partidas[0].errores.join(' '), re);
  });
});

test('Mano de obra: el costo de la partida sube en proporción al salario; con el doble de salario la MOD cuesta el doble', () => {
  const base = C.cotizarPartida(galv(22), M);
  const ops = Object.fromEntries(MO.OPERACIONES.map((op) => [op, { salario_diario: 1000 }]));
  const doble = C.cotizarPartida(galv(22), crearMaestros({ mano_obra: { operaciones: ops } }));
  casi(doble.costos.subtotales.mano_obra, base.costos.subtotales.mano_obra * 2, 1e-12);
  casi(doble.costos.subtotales.equipo, base.costos.subtotales.equipo, 1e-12, 'el equipo no cambia');
});

/* ---------- parches guardados con las tablas anteriores ---------- */

test('migrarParche: descarta el «salario por hora» de la versión 1.5 (se capturó con el valor del día), conserva el salario diario y pasa la jornada de antes a horas por día', () => {
  const viejo = {
    precios: { precio_kg_acero_carbon: 25 },
    mano_obra: { FSR: 1.6, jornada_h: 9, operaciones: { corte: { salario_diario: 700 }, rolado: { salario_diario: 650, equipo_h: 60 }, soldadura: { salario_hora: 650 } } },
  };
  const copia = JSON.parse(JSON.stringify(viejo));
  const nuevo = migrarParche(viejo);
  assert.deepEqual(viejo, copia, 'no muta el parche recibido');
  assert.deepEqual(nuevo, {
    precios: { precio_kg_acero_carbon: 25 },
    mano_obra: { FSR: 1.6, jornada: { horas_dia: 9 }, operaciones: { corte: { salario_diario: 700 }, rolado: { salario_diario: 650, equipo_h: 60 } } },
  });
  // una jornada de hoy no la pisa la de antes
  assert.deepEqual(migrarParche({ mano_obra: { jornada_h: 9, jornada: { horas_dia: 10 } } }), { mano_obra: { jornada: { horas_dia: 10 } } });
  // los días pagados y trabajados de la versión 1.6 se descartan: la hora es el salario del día ÷ horas por día
  assert.deepEqual(migrarParche({ mano_obra: { jornada: { dias_pagados_semana: 7, dias_trabajados_semana: 5, horas_dia: 9 } } }), { mano_obra: { jornada: { horas_dia: 9 } } });
  assert.deepEqual(migrarParche({ mano_obra: { FSR: 1.2, jornada: { dias_pagados_semana: 6 } } }), { mano_obra: { FSR: 1.2 } });
  assert.deepEqual(migrarParche({ mano_obra: { jornada: { dias_trabajados_semana: 5 } } }), {});
  // un parche que sólo tenía lo obsoleto queda sin la rama
  assert.deepEqual(migrarParche({ mano_obra: { operaciones: { corte: { salario_hora: 500 } } } }), {});
  // el cartucho de sellador de 300 mL de antes: el precio viejo se descarta y la referencia vuelve a la de hoy
  assert.deepEqual(migrarParche({ precios: { precio_cartucho_sellador_300ml: 130 }, herrajes: { sellador: { precio_cartucho_ref: 'precio_cartucho_sellador_300ml' } } }), {});
  assert.deepEqual(migrarParche({ herrajes: { sellador: { precio_cartucho_ref: 'precio_cartucho_sellador_300ml', ml_por_m: 25 } } }), { herrajes: { sellador: { ml_por_m: 25 } } });
  // entradas raras pasan tal cual
  assert.equal(migrarParche(null), null);
  assert.deepEqual(migrarParche([1, 2]), [1, 2]);
  assert.deepEqual(migrarParche({}), {});
  // y el resultado ya se mezcla con los maestros sin dejar campos sueltos
  const Mm = crearMaestros(viejo);
  assert.equal('jornada_h' in Mm.mano_obra, false);
  assert.equal(Mm.mano_obra.jornada.horas_dia, 9);
  assert.equal('salario_hora' in Mm.mano_obra.operaciones.soldadura, false);
  assert.equal(Mm.mano_obra.operaciones.soldadura.salario_diario, 500, 'rige el salario diario de las tablas');
  assert.equal(Mm.mano_obra.operaciones.corte.salario_diario, 700);
});
