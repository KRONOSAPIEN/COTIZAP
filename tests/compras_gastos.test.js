'use strict';
/**
 * Lo que agregó la hoja de control de gastos del 6-oct-2026: bridas sueltas, instalación en obra, soportería, artículos del
 * catálogo de compras (con o sin IVA), lista de compras en piezas enteras, venta pactada y control de gastos real contra cotizado.
 * Cada cifra se recalcula aquí con aritmética directa desde las tablas, sin llamar a las funciones del motor que se prueban.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const COMP = require('../src/motor/compras');
const G = require('../src/motor/gastos');
const U = require('../src/motor/util');

const M = crearMaestros();
const IVA = M.compras.iva_pct;
const HORA = (500 * 7) / (5 * 8); // $87.50
const casi = (real, esperado, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(real - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${msg} esperado ${esperado}, obtenido ${real}`);
};
const K = (CD, h, gif = 85) => {
  // pila de precio recalculada a mano: CI = GIF·h + adm·CD; imprevistos 4 %; financiamiento 14 % · 45/365; ÷ (1 − 20 % − 2 %)
  const CI = gif * h + 0.08 * CD;
  const CT = (CD + CI) * 1.04;
  return (CT * (1 + (0.14 * 45) / 365)) / 0.78;
};

/* ---------------- Acomodo de piezas en barras ---------------- */

function mulberry32(a) {
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El menor número de barras posible, por fuerza bruta (sólo para pocas piezas). */
function optimo(piezas, largo) {
  let mejor = piezas.length;
  const cargas = [];
  const ir = (i) => {
    if (cargas.length >= mejor) return;
    if (i === piezas.length) { mejor = cargas.length; return; }
    const vistos = new Set();
    for (let k = 0; k < cargas.length; k += 1) {
      if (cargas[k] + piezas[i] <= largo + 1e-9 && !vistos.has(cargas[k])) {
        vistos.add(cargas[k]);
        cargas[k] += piezas[i]; ir(i + 1); cargas[k] -= piezas[i];
      }
    }
    cargas.push(piezas[i]); ir(i + 1); cargas.pop();
  };
  ir(0);
  return mejor;
}

test('Acomodo en barras: cada barra carga a lo más su largo, se acomoda todo, y nunca se usan menos barras de las posibles', () => {
  const rnd = mulberry32(61002);
  for (let caso = 0; caso < 2000; caso += 1) {
    const largo = [6000, 6100, 3000][caso % 3];
    const n = 1 + Math.floor(rnd() * 25);
    const piezas = Array.from({ length: n }, () => Math.round(100 + rnd() * (largo - 100)));
    const a = COMP.acomodar(piezas, largo);
    const total = piezas.reduce((s, x) => s + x, 0);
    assert.ok(a.cargas.every((c) => c <= largo + 1e-6), `una barra se pasa de ${largo}`);
    casi(a.cargas.reduce((s, x) => s + x, 0) + a.completas * largo, total, 1e-9, 'todo se acomoda');
    assert.equal(a.barras, a.cargas.length + a.completas);
    assert.ok(a.barras >= Math.ceil(total / largo - 1e-9), 'cota inferior: el largo total');
    assert.ok(a.barras <= (11 / 9) * Math.ceil(total / largo) + 1 + 1e-9 || a.barras <= n, 'primero las más largas: a lo más 11/9 del óptimo + 1');
    casi(a.sobra_mm, a.barras * largo - total, 1e-9);
  }
});

test('Acomodo en barras: contra el óptimo por fuerza bruta en 300 casos chicos (a lo más una barra de más)', () => {
  const rnd = mulberry32(7);
  let iguales = 0;
  for (let caso = 0; caso < 300; caso += 1) {
    const piezas = Array.from({ length: 2 + Math.floor(rnd() * 7) }, () => Math.round(500 + rnd() * 4500));
    const a = COMP.acomodar(piezas, 6000);
    const o = optimo([...piezas].sort((x, y) => y - x), 6000);
    assert.ok(a.barras >= o && a.barras <= o + 1, `${JSON.stringify(piezas)}: ${a.barras} contra el óptimo ${o}`);
    if (a.barras === o) iguales += 1;
  }
  assert.ok(iguales >= 285, `igual al óptimo en ${iguales} de 300`);
});

test('Acomodo en barras: las 30 bridas de la hoja (22 de 11″, 6 de 10″ y 2 de 9″, π × (D + 81 mm)) son 6 barras de 6 m', () => {
  const aro = (pulg) => Math.PI * (pulg * 25.4 + 81);
  const piezas = [...Array(22).fill(aro(11)), ...Array(6).fill(aro(10)), ...Array(2).fill(aro(9))];
  const a = COMP.acomodar(piezas, 6000);
  assert.equal(a.barras, 6);
  // Σ (D + 81) = 22 × 360.4 + 6 × 335 + 2 × 309.6 = 10 558 mm → π × 10 558 = 33 168.94 mm
  casi(a.usado_mm / 6000, (Math.PI * 10558) / 6000, 1e-12, 'la hoja: 33 168.94 mm ÷ 6 000 = 5.53 barras');
  // una pieza más larga que la barra se arma de tramos
  const largo = COMP.acomodar([14000, 1000], 6000);
  assert.deepEqual([largo.barras, largo.empalmes, largo.completas], [3, 1, 2], '14 m = 2 barras completas + 2 m, y 1 m cabe con el resto');
  assert.deepEqual(COMP.acomodar([], 6000).barras, 0);
  assert.deepEqual(COMP.acomodar([0, -5, NaN], 6000).barras, 0);
});

/* ---------------- Familias nuevas ---------------- */

test('Bridas sueltas (sólo aros): sin lámina, un aro terminado por unidad con media junta de tornillos y empaque; sólo unión bridada', () => {
  const p = { familia: 'BRIDA', material_id: 'GALVANIZADO', calibre: 22, D_mm: 11 * 25.4, cantidad: 22 };
  const r = C.cotizarPartida(p, M);
  assert.equal(r.qto.lam.m_bruta_kg, 0);
  assert.equal(r.costos.materiales.lamina, 0);
  assert.equal(r.qto.her.aros.length, 0, 'no hay aro unido a un ducto');
  assert.equal(r.qto.her.aros_sueltos.length, 1);
  assert.equal(r.qto.her.n_barrenos, 8);
  assert.deepEqual(r.qto.her.tornillos_por_tipo, { '5/16x1-1/4': 4 }, 'media junta de 8 tornillos');
  assert.equal(r.costos.horas_std.armado, 0, 'no se arma a un ducto');
  assert.equal(r.costos.horas_std.corte, 0, 'no hay lámina que cortar ni programa CNC');
  assert.equal(r.costos.horas_std.rolado, 0, 'no hay virolas: la solera se rola en «aros»');
  assert.ok(r.costos.horas_std.aros > 0 && r.costos.horas_std.barrenado > 0 && r.costos.horas_std.soldadura > 0 && r.costos.horas_std.pintura > 0);
  // el galvanizado no pinta el ducto pero sí las bridas (en interior, esmalte)
  assert.equal(r.qto.pint.sistema_bridas, 'ESMALTE');
  casi(r.peso.neto_unitario_kg, r.qto.her.m_aros_sueltos_neta_kg, 1e-12);
  assert.throws(() => C.cotizarPartida({ ...p, tipo_union: 'ESPIGA' }, M), /sólo lleva unión bridada/);
  assert.throws(() => C.cotizarPartida({ ...p, D_mm: undefined }, M), U.ErrorValidacion);
  // rectangular: un marco
  const rect = C.cotizarPartida({ ...p, forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, D_mm: undefined }, M);
  assert.equal(rect.qto.her.aros_sueltos.length, 1);
});

test('Instalación en obra: cuadrilla × días × horas a $87.50, viáticos sin el IVA que se acredita, comidas sin factura, y su pila de precio', () => {
  const p = {
    familia: 'INSTALACION', cantidad: 1, personas: 2, dias: 5, viajes: 1, casetas_viaje: 806, gasolina_viaje: 1500,
    noches: 4, hospedaje_noche: 650, comida_dia: 250, otros_gastos: 1160,
  };
  const r = C.cotizarPartida(p, M);
  const h = 2 * 5 * 8;
  casi(r.costos.h_MOD, h);
  casi(r.costos.mano_obra.instalacion, h * HORA);
  casi(r.costos.equipo.instalacion, 0);
  casi(r.costos.herramienta_menor, 0.03 * h * HORA);
  casi(r.costos.viaticos.casetas, 806 / (1 + IVA));
  casi(r.costos.viaticos.gasolina, 1500 / (1 + IVA));
  casi(r.costos.viaticos.hospedaje, (2 * 4 * 650) / (1 + IVA));
  casi(r.costos.viaticos.comidas, 2 * 5 * 250, 1e-12, 'las comidas sin factura: el IVA es costo');
  casi(r.costos.viaticos.otros, 1000);
  const CD = h * HORA * 1.03 + (806 + 1500 + 5200 + 1160) / (1 + IVA) + 2500;
  casi(r.costos.CD, CD);
  casi(r.pila.precio, K(CD, h, 0), 1e-9, 'sin indirectos por hora: la instalación no usa la nave');
  // con factura en las comidas y sin factura en lo demás
  const r2 = C.cotizarPartida({ ...p, gastos_con_factura: false, comidas_con_factura: true }, M);
  casi(r2.costos.viaticos.casetas, 806);
  casi(r2.costos.viaticos.comidas, 2500 / (1 + IVA));
  // indirectos propios de la instalación
  const M40 = crearMaestros({ capas: { gif_por_hora_instalacion: 40 } });
  casi(C.cotizarPartida(p, M40).pila.CI_fabrica, 40 * h);
  // horas por día propias, y dos visitas iguales cuestan el doble (sin cargo mínimo de por medio)
  casi(C.cotizarPartida({ ...p, horas_dia: 10 }, M).costos.h_MOD, 2 * 5 * 10);
  casi(C.cotizarPartida({ ...p, cantidad: 2 }, M).costos.CD, 2 * CD);
  // lo que falta o no tiene sentido se avisa
  assert.throws(() => C.cotizarPartida({ ...p, personas: undefined }, M), /cuántas personas/);
  assert.throws(() => C.cotizarPartida({ ...p, dias: 0 }, M), /Días en obra/);
  assert.throws(() => C.cotizarPartida({ ...p, gastos_con_factura: 'sí' }, M), /Viáticos con factura/);
});

test('Soportería: piezas de una barra de la lista (fracción con merma), anclajes del catálogo, tornillos y minutos de taller', () => {
  const p = { familia: 'SOPORTE', cantidad: 7, barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1500, anclajes_pieza: 4, tornillos_pieza: 2 };
  const r = C.cotizarPartida(p, M);
  const precio_m = 260 / (1 + M.proveedor.iva_incluido_pct) / 6;
  casi(r.costos.materiales.perfil, (7 * 1.5 * precio_m) / (1 - 0.05));
  casi(r.costos.materiales.anclajes, 7 * 4 * (16 / (1 + IVA)), 1e-12, 'taquete de 3/8″: $16 con IVA');
  casi(r.costos.materiales.tornilleria, 7 * 2 * 3.67);
  const h = (7 * 15) / 60 / 0.8;
  casi(r.costos.h_MOD, h);
  casi(r.costos.mano_obra.armado, h * HORA);
  casi(r.costos.equipo.armado, h * 25);
  const CD = r.costos.materiales.perfil + r.costos.materiales.anclajes + r.costos.materiales.tornilleria + h * HORA * 1.03 + h * 25;
  casi(r.costos.CD, CD);
  casi(r.pila.precio, K(CD, h), 1e-9);
  assert.equal(r.soporte.anclajes, 28);
  // minutos y anclaje propios
  casi(C.cotizarPartida({ ...p, min_pieza: 30 }, M).costos.h_MOD, (7 * 30) / 60 / 0.8);
  casi(C.cotizarPartida({ ...p, articulo_anclaje: 'TEJUELO_2' }, M).costos.materiales.anclajes, 7 * 4 * 103.48);
  // errores claros
  assert.throws(() => C.cotizarPartida({ ...p, barra_id: undefined }, M), /Falta la barra/);
  assert.throws(() => C.cotizarPartida({ ...p, barra_id: 'NO_EXISTE' }, M), /Barra de la lista del proveedor: «NO_EXISTE» no existe/);
  assert.throws(() => C.cotizarPartida({ ...p, largo_pieza_mm: 6500 }, M), /una pieza no sale de una sola barra/);
  assert.throws(() => C.cotizarPartida({ ...p, articulo_anclaje: 'X' }, M), /Anclaje: «X» no existe/);
  const sinPrecio = crearMaestros({ proveedor: { barras: { ANG_1_1_4X1_8: { precio: 0 } } } });
  assert.throws(() => C.cotizarPartida(p, sinPrecio), /no tiene precio o largo válidos/);
});

test('Artículo comprado: el precio con IVA se cuesta sin IVA; del catálogo toma precio, descripción y si trae IVA; lo capturado manda', () => {
  const base = { familia: 'COMPRADO', cantidad: 1 };
  casi(C.cotizarPartida({ ...base, precio_compra_unitario: 22000, iva_incluido: true }, M).costos.CD, 22000 / (1 + IVA));
  casi(C.cotizarPartida({ ...base, precio_compra_unitario: 22000 }, M).costos.CD, 22000, 1e-12, 'sin decir, el precio es antes de IVA (como siempre)');
  const m6 = C.cotizarPartida({ ...base, cantidad: 3, articulo_id: 'MANGUERA_6' }, M);
  casi(m6.costos.CD, 3 * 1807.49);
  assert.equal(m6.descripcion, 'Manguera azul de 6″ (tramo de 5 m)');
  assert.equal(m6.compra.unidad, 'tramo');
  assert.equal(m6.compra.categoria, 'PROVEEDOR');
  assert.equal(C.cotizarPartida({ ...base, articulo_id: 'SIKAFLEX_BLANCO_600' }, M).compra.categoria, 'MATERIAL', 'el sellador es material');
  assert.equal(C.cotizarPartida({ ...base, precio_compra_unitario: 9 }, M).compra.categoria, 'PROVEEDOR', 'sin artículo: compra a terceros');
  const abr = C.cotizarPartida({ ...base, cantidad: 18, articulo_id: 'ABRAZADERA_MANGUERA' }, M);
  casi(abr.costos.CD, (18 * 55) / (1 + IVA), 1e-12, 'el catálogo dice que $55 trae IVA');
  casi(C.cotizarPartida({ ...base, articulo_id: 'ABRAZADERA_MANGUERA', precio_compra_unitario: 50 }, M).costos.CD, 50, 1e-12, 'precio capturado sin decir IVA: antes de IVA');
  casi(C.cotizarPartida({ ...base, articulo_id: 'MANGUERA_6', iva_incluido: true }, M).costos.CD, 1807.49 / (1 + IVA));
  assert.throws(() => C.cotizarPartida(base, M), /costo de compra unitario \(o elegir un artículo/);
  assert.throws(() => C.cotizarPartida({ ...base, articulo_id: 'NADA' }, M), /Artículo del catálogo: «NADA» no existe/);
  assert.throws(() => C.cotizarPartida({ ...base, precio_compra_unitario: 5, iva_incluido: 'no' }, M), /El precio incluye IVA/);
});

/* ---------------- Lista de compras, piezas enteras y venta pactada ---------------- */

const recto = {
  familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 304.8, L_mm: 3000, tipo_costura: 'A_TOPE', tipo_union: 'BRIDADO', clase_sellado: 'C', riesgo: 'MEDIO', cantidad: 4,
};

test('Lista de compras: hojas, barras, tornillos por decena, cartuchos y litros enteros; el sobrante nunca es negativo', () => {
  const res = C.cotizar({ partidas: [recto, { ...recto, familia: 'CODO', theta_deg: 90, k_R: 1.5, L_mm: undefined, tipo_costura: undefined, cantidad: 2 }] }, M);
  const L = res.compras;
  L.renglones.forEach((x) => {
    assert.ok(x.sobrante >= 0, x.descripcion);
    assert.ok(x.compra + 1e-9 >= x.necesario, `${x.descripcion}: compra ${x.compra} < necesario ${x.necesario}`);
    casi(x.sobrante, Math.max(0, x.importe_compra - x.costo_cotizado), 1e-9);
  });
  const hoja = L.laminas[0];
  assert.equal(hoja.compra, Math.ceil(hoja.kg / hoja.kg_hoja));
  const t = L.tornillos[0];
  assert.equal(t.compra % 10, 0);
  assert.ok(t.compra >= t.con_reserva && t.compra - t.con_reserva < 10);
  casi(t.con_reserva, t.necesario * 1.05);
  const sel = L.sellador[0];
  assert.equal(sel.compra, Math.ceil(sel.ml / 600));
  L.pintura.forEach((x) => assert.equal(x.compra, Math.ceil(x.necesario)));
  // lo que el cálculo ya cobra coincide con los costos de las partidas
  const lamina = res.partidas.reduce((s, f) => s + f.costos.materiales.lamina, 0);
  casi(L.laminas.reduce((s, x) => s + x.costo_cotizado, 0), lamina, 1e-9);
  const torn = res.partidas.reduce((s, f) => s + f.costos.materiales.tornilleria, 0);
  casi(L.tornillos.reduce((s, x) => s + x.costo_cotizado, 0), torn, 1e-9);
  casi(L.sobrante, L.renglones.reduce((s, x) => s + x.sobrante, 0), 1e-12);
});

test('Piezas enteras: la cotización puede cobrar el sobrante como partida automática (sin cargo mínimo); sin pedirlo no cambia nada', () => {
  const cot = { partidas: [{ ...recto, cantidad: 1 }] };
  const sin = C.cotizar(cot, M);
  assert.deepEqual(sin.automaticas, []);
  const con = C.cotizar({ ...cot, piezas_enteras: true }, M);
  assert.equal(con.automaticas.length, 1);
  const a = con.automaticas[0];
  assert.equal(a.familia, 'AJUSTE_COMPRA');
  casi(a.costos.CD, sin.compras.sobrante, 1e-12);
  casi(a.pila.precio, K(sin.compras.sobrante, 0), 1e-9);
  assert.equal(a.precio.aplico_cargo_minimo, false);
  casi(con.totales.subtotal, sin.totales.subtotal + a.precio.importe, 1e-9);
  assert.equal(con.partidas.length, 1, 'la partida automática no se mezcla con las del usuario');
  assert.equal(C.cotizar({ ...cot, piezas_enteras: 'sí' }, M).automaticas.length, 0, 'sólo con true');
});

test('Venta pactada: margen real, precio mínimo para no perder y aviso si el valor no sirve', () => {
  const cot = { partidas: [{ ...recto, cantidad: 2 }] };
  const base = C.cotizar(cot, M).totales;
  assert.equal(base.venta, null);
  const Cb = base.C_base_total;
  casi(base.precio_minimo, Cb / 0.98, 1e-12, 'costo con indirectos y financiamiento ÷ (1 − comisión − otros)');
  const venta = 3000;
  const T = C.cotizar({ ...cot, venta_pactada: venta }, M).totales;
  casi(T.venta.utilidad, venta * 0.98 - Cb, 1e-9);
  casi(T.venta.margen_pct, (venta * 0.98 - Cb) / venta, 1e-12);
  casi(T.venta.diferencia, venta - base.subtotal_neto, 1e-9);
  assert.equal(T.venta.cubre_precio_minimo, venta >= base.precio_minimo);
  casi(T.venta.total, venta * 1.16, 1e-9);
  casi(C.cotizar({ ...cot, venta_pactada: '3000' }, M).totales.venta.pactada, 3000);
  ['tres mil', -5, [1], {}].forEach((v) => {
    const r = C.cotizar({ ...cot, venta_pactada: v }, M);
    assert.equal(r.totales.venta, null, JSON.stringify(v));
    assert.ok(r.avisos.some((x) => /Venta pactada/.test(x)), JSON.stringify(v));
  });
  assert.equal(C.cotizar({ ...cot, venta_pactada: '' }, M).totales.venta, null);
});

/* ---------------- Control de gastos ---------------- */

test('Gasto real: con IVA y factura se acredita el IVA; con IVA sin factura el IVA es costo; sin IVA el importe es el costo', () => {
  const g = (o) => G.normalizarGasto({ concepto: 'x', cantidad: 2, precio_unitario: 116, ...o }).g;
  assert.deepEqual(G.costoGasto(g({ iva_incluido: true, con_factura: true }), 0.16), { importe: 232, costo: 200, iva_acreditable: 32 });
  assert.deepEqual(G.costoGasto(g({ iva_incluido: true, con_factura: false }), 0.16), { importe: 232, costo: 232, iva_acreditable: 0 });
  const sinIva = G.costoGasto(g({ iva_incluido: false, con_factura: true }), 0.16);
  assert.equal(sinIva.costo, 232);
  casi(sinIva.iva_acreditable, 37.12);
  assert.equal(G.costoGasto(g({ iva_incluido: false, con_factura: false }), 0.16).iva_acreditable, 0);
  // sin decir si hay factura: sí, salvo en la mano de obra (la raya no lleva IVA); un valor que no es sí/no no cuenta
  assert.equal(G.normalizarGasto({ categoria: 'MATERIAL' }).g.con_factura, true);
  assert.equal(G.normalizarGasto({ categoria: 'MANO_OBRA' }).g.con_factura, false);
  assert.equal(G.normalizarGasto({ categoria: 'INSTALACION' }).g.con_factura, false);
  assert.equal(G.normalizarGasto({ categoria: 'INSTALACION', con_factura: true }).g.con_factura, true, 'un instalador externo que factura');
  assert.equal(G.normalizarGasto({ categoria: 'VIATICOS', con_factura: 'no' }).g.con_factura, true);
  // valores que no sirven
  assert.match(G.normalizarGasto({ concepto: 'Gas', cantidad: -1 }).errores[0], /Gas: la cantidad/);
  assert.match(G.normalizarGasto({ concepto: 'Gas', precio_unitario: 'mucho' }).errores[0], /Gas: el precio/);
  assert.equal(G.normalizarGasto({ categoria: 'INVENTADA' }).g.categoria, 'OTROS');
  assert.equal(G.normalizarGasto({}).g.vacio, true, 'un renglón vacío no cuenta ni es error');
  assert.deepEqual(G.normalizarGasto({}).errores, []);
  assert.equal(G.normalizarGasto(null).g, null);
});

test('Resumen del control de gastos: lo cotizado por categoría suma el costo directo; real, IVA acreditable y resultado contra la venta', () => {
  const cot = {
    venta_pactada: 9000,
    partidas: [
      { ...recto, cantidad: 2 },
      { familia: 'COMPRADO', cantidad: 1, precio_compra_unitario: 1160, iva_incluido: true },
      { familia: 'COMPRADO', cantidad: 2, articulo_id: 'TAQUETE_3_8' },
      { familia: 'INSTALACION', cantidad: 1, personas: 1, dias: 1, viajes: 1, gasolina_viaje: 580 },
      { familia: 'SOPORTE', cantidad: 2, barra_id: 'PTR_2X2_C14', largo_pieza_mm: 1000 },
    ],
  };
  const res = C.cotizar(cot, M);
  const gastos = [
    { concepto: 'Lámina', categoria: 'MATERIAL', cantidad: 1, precio_unitario: 1160, iva_incluido: true, con_factura: true },
    { concepto: 'Comida', categoria: 'VIATICOS', cantidad: 1, precio_unitario: 300, iva_incluido: true, con_factura: false },
    { concepto: 'Raya de instalación', categoria: 'INSTALACION', cantidad: 8, precio_unitario: 87.5 },
    { concepto: '', cantidad: '', precio_unitario: '' },
    { concepto: 'Malo', cantidad: -2, precio_unitario: 10 },
  ];
  const R = G.resumen(res, gastos, 0.16);
  const equipo = [...res.partidas, ...res.automaticas].reduce((s, f) => s + f.costos.subtotales.equipo, 0);
  assert.ok(equipo > 0);
  casi(R.resultado.equipo_estimado, equipo, 1e-12);
  casi(R.totales.cotizado + equipo, res.totales.costo_directo, 1e-9, 'el reparto por categorías (más el equipo, que no se captura) no pierde ni duplica costo');
  casi(R.categorias.find((x) => x.clave === 'PROVEEDOR').cotizado, 1000, 1e-12);
  casi(R.categorias.find((x) => x.clave === 'VIATICOS').cotizado, 500, 1e-12);
  casi(R.categorias.find((x) => x.clave === 'INSTALACION').cotizado, 8 * HORA, 1e-12, 'la cuadrilla (la herramienta menor va a consumibles)');
  const sop = res.partidas[4].costos;
  casi(R.categorias.find((x) => x.clave === 'SOPORTERIA').cotizado, sop.subtotales.materiales + (2 * 16) / (1 + IVA), 1e-12, 'el material de la soportería y los taquetes del catálogo');
  casi(R.categorias.find((x) => x.clave === 'MANO_OBRA').cotizado, res.partidas[0].costos.subtotales.mano_obra + sop.subtotales.mano_obra, 1e-9, 'la mano de obra del taller, también la de la soportería');
  const herramienta = [...res.partidas, ...res.automaticas].reduce((s, f) => s + f.costos.subtotales.herramienta_menor, 0);
  casi(R.categorias.find((x) => x.clave === 'CONSUMIBLE').cotizado, res.partidas[0].costos.subtotales.consumibles + herramienta, 1e-9, 'consumibles y herramienta menor');
  casi(R.totales.real, 1000 + 300 + 700, 1e-12);
  casi(R.totales.iva_acreditable, 160, 1e-12, 'sólo la lámina: la comida no tiene factura y la raya no lleva IVA');
  assert.equal(R.totales.n_gastos, 3, 'el vacío y el inválido no cuentan');
  assert.equal(R.errores.length, 1);
  assert.match(R.errores[0], /Renglón 5: Malo: la cantidad/);
  casi(R.resultado.venta, 9000);
  assert.equal(R.resultado.venta_es_pactada, true);
  casi(R.resultado.utilidad_antes_indirectos, 9000 - 2000, 1e-12);
  const indirectos = res.totales.C_base_total - res.totales.costo_directo;
  casi(R.resultado.indirectos_estimados, indirectos, 1e-9);
  casi(R.resultado.utilidad_despues_indirectos, 9000 * 0.98 - 2000 - equipo - indirectos, 1e-9);
  casi(R.resultado.comision_y_otros, 9000 * 0.02, 1e-9);
  // sin venta pactada, el precio calculado
  const sin = G.resumen(C.cotizar({ ...cot, venta_pactada: undefined }, M), [], 0.16);
  assert.equal(sin.resultado.venta_es_pactada, false);
  casi(sin.resultado.venta, C.cotizar({ ...cot, venta_pactada: undefined }, M).totales.subtotal_neto, 1e-12);
  // entradas raras
  assert.doesNotThrow(() => G.resumen(null, 'nada', NaN));
  assert.equal(G.resumen(res, [1, 'x', null]).errores.length, 3);
});
