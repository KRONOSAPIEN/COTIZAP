'use strict';
/**
 * Lo que piden los planos de yardas y de armado de piezas del 30-sep / 2-oct-2026:
 *   · el extremo final del tramo recto («bridas en ambos extremos» / «brida en un extremo»), con o sin tramo de ajuste;
 *   · extremos sin brida en codos, reducciones e injertos (se unen a otra pieza o a una manguera);
 *   · bridas de otra partida (las piezas sólo las unen al ducto; los aros, su tornillería y su junta se cotizan aparte);
 *   · la familia «Armado de piezas» (la unión entre dos piezas: engargolada en galvanizado, soldada en los demás);
 *   · el cuadre de bridas por diámetro: las que piden las piezas contra las partidas de bridas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const G = require('../src/motor/geometria');

const M = crearMaestros();
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const galv24 = { material_id: 'GALVANIZADO', calibre: 24, tipo_union: 'BRIDADO', clase_sellado: 'C', cantidad: 1 };
const calc = (p) => C.cotizarPartida({ ...galv24, ...p }, M);
const e24 = 0.0276 * 25.4; // galvanizado cal. 24 en la tabla del material (calibre de lámina galvanizada)

test('Tramo recto: el extremo final vale sin tramo de ajuste («brida en un extremo» de los planos de yardas)', () => {
  const tramo = (L, extra) => calc({ familia: 'RECTO', D_mm: 279.4, L_mm: L, yarda_mm: 914, ...extra }).geometria.detalle.armado;
  const resumen = (a) => a.piezas.map((q) => `${q.yardas}+${q.ajuste_mm}:${q.bridas}/${q.sueltas}`).join(' ');
  // 3 yardas unidas (2,742 mm)
  assert.equal(resumen(tramo(2742)), '3+0:2/0', 'sin elegirlo: bridas en ambos extremos');
  assert.equal(resumen(tramo(2742, { extremo_ajuste: 'CON_BRIDA' })), '3+0:2/0');
  assert.equal(resumen(tramo(2742, { extremo_ajuste: 'SIN_BRIDA' })), '3+0:1/0', 'brida en un extremo');
  assert.equal(resumen(tramo(2742, { extremo_ajuste: 'SUELTA' })), '3+0:1/1', 'brida de taller y una suelta');
  // 2 yardas + 600 mm de ajuste (2,428 mm): el ajuste trae su extremo libre como antes
  assert.equal(resumen(tramo(2428)), '2+600:1/1', 'el de las tablas maestras: brida suelta');
  assert.equal(resumen(tramo(2428, { extremo_ajuste: 'SIN_BRIDA' })), '2+600:1/0');
  // dos piezas (6 yardas): sólo la última pierde la brida de su extremo final
  assert.equal(resumen(tramo(6 * 914, { extremo_ajuste: 'SIN_BRIDA' })), '3+0:2/0 3+0:1/0');
  assert.equal(tramo(2742, { extremo_ajuste: 'SIN_BRIDA' }).extremo_libre, true);
  assert.equal(tramo(2742).extremo_libre, false);
  // el sí/no de una versión anterior era sólo del tramo de ajuste: sin ajuste sigue con bridas en ambos extremos
  assert.equal(resumen(tramo(2742, { ajuste_sin_brida: true })), '3+0:2/0');
  assert.equal(resumen(tramo(2428, { ajuste_sin_brida: true })), '2+600:1/0');
  // la herramienta pura
  const a = G.distribuirYardas(1828, 914, 3, 25, 'SIN_BRIDA', true);
  assert.equal(a.n_bridas, 1);
  assert.equal(G.distribuirYardas(1828, 914, 3, 25, 'SIN_BRIDA', false).n_bridas, 2);
});

test('Extremos sin brida: cada familia nombra sus extremos y la brida del que se une a otra pieza no se cotiza', () => {
  assert.deepEqual(G.EXTREMOS_FAMILIA, {
    CODO: ['A', 'B'], REDUCCION: ['D1', 'D2'], TRANSICION: ['redondo', 'rectangular'], RAMAL: ['tronco_1', 'tronco_2', 'injerto'], REDUCCION_INJERTO: ['D1', 'D2', 'injerto'],
  });
  const codo = { familia: 'CODO', D_mm: 127, theta_deg: 90, k_R: 1.5, n_gajos: 5 };
  const dos = calc(codo).qto.her;
  const uno = calc({ ...codo, extremos_sin_brida: ['B'] }).qto.her;
  assert.equal(dos.n_aros, 2);
  assert.equal(uno.n_aros, 1);
  assert.equal(uno.n_tornillos_asignados, dos.n_tornillos_asignados / 2, 'media junta menos');
  assert.equal(uno.n_barrenos, dos.n_barrenos / 2);
  casi(uno.sold_aros.filete_m, dos.sold_aros.filete_m / 2, 1e-12, 'filete aro–ducto de una sola brida');
  assert.deepEqual(uno.bridas.map((b) => b.extremo), ['A']);
  // en la reducción con injerto, la brida que queda es la de su medida: D1 = 11″ y D2 = 10″ sin la del injerto de 5″
  const red = calc({ familia: 'REDUCCION_INJERTO', D1_mm: 279.4, D2_mm: 254, d_mm: 127, beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450, extremos_sin_brida: ['injerto'] });
  assert.deepEqual(red.qto.her.bridas.map((b) => [b.extremo, b.D_nom_mm]), [['D1', 279.4], ['D2', 254]]);
  // un injerto cuyo tronco se une arriba y abajo y su injerto va a una manguera: sin bridas, como si fuera liso
  const inj = { familia: 'RAMAL', D_mm: 152.4, d_mm: 76.2, L_cuerpo_mm: 400, L_ramal_mm: 260, beta_deg: 30 };
  const sin = calc({ ...inj, extremos_sin_brida: ['tronco_1', 'tronco_2', 'injerto'] });
  assert.equal(sin.qto.her.n_aros, 0);
  casi(sin.costos.CD, calc({ ...inj, tipo_union: 'LISO' }).costos.CD, 1e-9, 'igual que con extremos lisos');
});

test('Bridas de otra partida: la pieza sólo arma y fija el aro al ducto; los aros, su tornillería y su junta no se cuentan aquí', () => {
  const p = { familia: 'CODO', D_mm: 279.4, theta_deg: 90, k_R: 1.5, n_gajos: 5 };
  const propia = calc(p);
  const aparte = calc({ ...p, bridas_aparte: true });
  const h = aparte.qto.her;
  assert.equal(h.bridas_aparte, true);
  assert.equal(h.n_aros, 0, 'no fabrica aros');
  assert.equal(h.n_aros_aparte, 2, 'arma los dos de la otra partida');
  assert.equal(h.m_aros_neta_kg, 0);
  assert.equal(h.n_tornillos_asignados, 0);
  assert.equal(h.n_barrenos, 0);
  assert.equal(h.sold_aros.cierres.length, 0, 'el cierre del aro lo hace la otra partida');
  assert.equal(h.A_pintura_aros_m2, 0);
  assert.equal(h.V_sellador_junta_ml, 0, 'el Sikaflex de la junta va con la brida');
  // en galvanizado la brida no se suelda: se mete y se le hace una ceja al ducto, igual que a una brida propia
  const P_ext = Math.PI * (279.4 + 2 * e24);
  assert.equal(h.sold_aros.filete_m, 0, 'sin filete aro–ducto');
  assert.deepEqual([h.brida_al_ducto, h.n_cejas, propia.qto.her.n_cejas], ['CEJA', 2, 2]);
  casi(h.L_cejas_m, (2 * P_ext) / 1000, 1e-9, '2 · π · D_ext de ceja');
  casi(h.A_ceja_m2, (2 * P_ext * M.herrajes.uniones.BRIDADO.ceja_mm) / 1e6, 1e-12, 'la franja de lámina que se dobla');
  // el armado: el ajuste de los dos aros (con la dificultad del codo) y las dos cejas (sin ella)
  const A = M.proceso.armado;
  const liso = calc({ ...p, tipo_union: 'LISO' });
  casi(aparte.qto.tmp.unitarios_min.armado - liso.qto.tmp.unitarios_min.armado,
    A.k_dif.CODO * 2 * A.t_ajuste_aro_min + 2 * A.t_ceja_aro_min + ((2 * P_ext) / 1000) * A.t_ceja_aro_min_m, 1e-9, 'ajuste + ceja');
  casi(aparte.qto.lam.A_neta_m2 - liso.qto.lam.A_neta_m2, h.A_ceja_m2, 1e-12, 'la lámina de las cejas entra en la pieza');
  // en acero al carbón sí: el filete aro–ducto de las dos bridas
  const negro = C.cotizarPartida({ ...galv24, ...p, material_id: 'ACERO_CARBON', calibre: 16, bridas_aparte: true }, M).qto.her;
  casi(negro.sold_aros.filete_m, (2 * Math.PI * (279.4 + 2 * 0.0598 * 25.4)) / 1000, 1e-9, '2 · π · D_ext (cal. 16 MSG)');
  assert.equal(negro.n_cejas, 0);
  // el ajuste del aro en el armado: el mismo tiempo que con aros propios
  casi(aparte.qto.tmp.unitarios_min.armado, propia.qto.tmp.unitarios_min.armado, 1e-9);
  assert.equal(aparte.qto.tmp.unitarios_min.aros, 0, 'no se rola solera aquí');
  assert.equal(aparte.qto.tmp.unitarios_min.barrenado, 0);
  assert.ok(aparte.costos.CD < propia.costos.CD);
  assert.ok(aparte.costos.CD > calc({ ...p, tipo_union: 'LISO' }).costos.CD, 'unirlas al ducto cuesta');
  // las sueltas de otra partida no cuestan nada aquí, pero se cuentan para el cuadre
  const t = calc({ familia: 'RECTO', D_mm: 279.4, L_mm: 2428, yarda_mm: 914, bridas_aparte: true }).qto.her;
  assert.deepEqual(t.bridas.map((b) => [b.suelta, b.aparte]), [[false, true], [true, true]]);
  assert.equal(t.n_aros_aparte, 1);
  // en una partida de bridas sueltas no aplica: ella es la que hace las bridas
  assert.equal(calc({ familia: 'BRIDA', D_mm: 279.4, bridas_aparte: true }).qto.her.aros_sueltos.length, 1);
});

test('Armado de piezas: una junta de armado por unión; en galvanizado se engargola (como las yardas), en acero al carbón se suelda', () => {
  const u = calc({ familia: 'UNION', D_mm: 279.4 });
  assert.equal(u.ok, true);
  const PF = u.geometria;
  assert.equal(PF.n_juntas_internas, 1);
  assert.equal(PF.n_piezas, 0);
  // galvanizado: la unión es una junta transversal engargolada, sin soldadura
  const L_union = (Math.PI * (279.4 + 2 * e24)) / 1000;
  assert.equal(PF.costura, 'ENGARGOLADA');
  assert.equal(PF.sold.filete_m, 0);
  casi(PF.engargolado_circ_m, L_union, 1e-9, 'π · D_ext engargolado');
  assert.equal(PF.n_engargolados, 1);
  const Eg = M.proceso.engargolado;
  const U = require('../src/motor/util');
  casi(u.qto.tmp.unitarios_min.engargolado, Eg.t_fijo_pieza_min + L_union / U.interpolar(Eg.v_m_min, e24), 1e-9, 'una operación de engargolado');
  casi(u.qto.her.L_sellado_m, L_union, 1e-9, 'la junta engargolada se sella (clase C)');
  assert.equal(u.peso.neto_total_kg, 0);
  assert.equal(u.qto.her.n_aros, 0);
  const A = M.proceso.armado;
  const t_junta = A.t_junta_base_min + A.t_junta_por_m_min * (PF.D_ref_mm / 1000);
  casi(u.qto.tmp.unitarios_min.armado, t_junta, 1e-9, 'una junta de armado (k_dif 1)');
  // acero al carbón: un filete continuo al perímetro exterior
  const negro = C.cotizarPartida({ ...galv24, familia: 'UNION', D_mm: 279.4, material_id: 'ACERO_CARBON', calibre: 16 }, M).geometria;
  casi(negro.sold.filete_m, (Math.PI * (279.4 + 2 * 0.0598 * 25.4)) / 1000, 1e-9, 'π · D_ext soldado');
  assert.equal(negro.engargolado_m, 0);
  // dos uniones en la misma pieza: el doble de engargolado y de armado
  const dos = calc({ familia: 'UNION', D_mm: 279.4, n_uniones: 2 });
  casi(dos.geometria.engargolado_circ_m, 2 * PF.engargolado_circ_m, 1e-12);
  assert.equal(dos.geometria.n_engargolados, 2);
  casi(dos.qto.tmp.unitarios_min.armado, 2 * t_junta, 1e-9);
  assert.ok(u.costos.CD > 0 && u.precio.unitario > 0);
  assert.throws(() => calc({ familia: 'UNION', D_mm: 279.4, n_uniones: 0 }), /Uniones por pieza/);
  assert.throws(() => calc({ familia: 'UNION' }), /diámetro de la unión/i);
});

test('Cuadre de bridas por diámetro: las que piden las piezas (de taller y sueltas) contra las partidas de bridas', () => {
  const aparte = { ...galv24, bridas_aparte: true };
  const cot = {
    partidas: [
      { ...aparte, familia: 'RECTO', D_mm: 279.4, L_mm: 2742, yarda_mm: 914, cantidad: 4 }, // 8
      { ...aparte, familia: 'RECTO', D_mm: 279.4, L_mm: 2428, yarda_mm: 914 }, // 1 + 1 suelta
      { ...aparte, familia: 'CODO', D_mm: 127, theta_deg: 90, k_R: 1.5, cantidad: 2, extremos_sin_brida: ['B'] }, // 2 de 5″
      { ...aparte, familia: 'REDUCCION_INJERTO', D1_mm: 279.4, D2_mm: 254, d_mm: 127, beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450 }, // 11″, 10″ y 5″
      { ...galv24, familia: 'RECTO', D_mm: 254, L_mm: 2742, yarda_mm: 914 }, // bridas propias: no piden
      { ...galv24, familia: 'BRIDA', D_mm: 279.4, cantidad: 9 },
      { familia: 'COMPRADO', articulo_id: 'BRIDA_PLACA_5', cantidad: 4 },
      { familia: 'COMPRADO', articulo_id: 'BRIDA_PLACA_6', cantidad: 2 },
    ],
  };
  const B = C.cotizar(cot, M).bridas;
  assert.equal(B.activo, true);
  const fila = (D) => B.filas.find((x) => x.D_nom_mm === D) || {};
  assert.deepEqual([fila(279.4).piden, fila(279.4).hay, fila(279.4).diferencia], [11, 9, -2], '11″: faltan 2');
  assert.deepEqual([fila(254).piden, fila(254).hay, fila(254).diferencia], [1, 0, -1], '10″: la del tramo con bridas propias no cuenta');
  assert.deepEqual([fila(127).piden, fila(127).hay, fila(127).diferencia], [3, 4, 1], '5″: sobra 1');
  assert.deepEqual([fila(152.4).piden, fila(152.4).hay, fila(152.4).diferencia], [0, 2, 2], '6″: nadie las pide');
  assert.deepEqual(B.filas.map((x) => x.D_nom_mm), [279.4, 254, 152.4, 127], 'del diámetro mayor al menor');
  assert.equal(B.piden, 15);
  assert.equal(B.cuadra, false);
  // sin piezas con bridas de otra partida no hay qué cuadrar
  assert.equal(C.cotizar({ partidas: cot.partidas.filter((p) => !p.bridas_aparte) }, M).bridas.activo, false);
  // las bridas de placa del catálogo dicen para qué ducto son
  assert.deepEqual(['BRIDA_PLACA_5', 'BRIDA_PLACA_6', 'BRIDA_PLACA_7'].map((k) => M.compras.articulos[k].ducto_D_mm), [127, 152.4, 177.8]);
});

test('Galvanizado: las costuras y juntas que en otro material se sueldan se engargolan (holgura en la lámina, sellador en las juntas)', () => {
  const soldado = crearMaestros({ materiales: { GALVANIZADO: { costura: 'A_TOPE', brida_al_ducto: 'SOLDADA' } } });
  const p = { ...galv24, familia: 'CODO', D_mm: 279.4, theta_deg: 90, k_R: 1.5, n_gajos: 5, clase_sellado: 'B' };
  const s = C.cotizarPartida(p, soldado).geometria;
  const g = C.cotizarPartida(p, M);
  const PF = g.geometria;
  const hol = M.proceso.costuras.PITTSBURGH.allowance_mm;
  // lo que se soldaba ahora se engargola: las juntas entre gajos (transversales) y las costuras de cada gajo (longitudinales)
  casi(PF.engargolado_m, s.sold.tope_m + s.sold.filete_m, 1e-12, 'los mismos metros');
  casi(PF.engargolado_circ_m, s.sold_transversal_m, 1e-12, 'las 4 juntas entre gajos');
  casi(PF.engargolado_long_m, s.sold.tope_m - s.sold_transversal_m, 1e-12, 'las costuras de los 5 gajos');
  assert.deepEqual([PF.sold.tope_m, PF.sold.filete_m, PF.n_engargolados], [0, 0, 5 + 4]);
  casi(PF.A_neta_m2 - s.A_neta_m2, (PF.engargolado_long_m * hol) / 1000, 1e-12, 'la holgura del Pittsburgh en las costuras longitudinales');
  // el sellador: con clase B, las juntas y las costuras engargoladas (con Sikaflex en la cara de las bridas, nada más)
  casi(g.qto.her.L_sellado_m, PF.engargolado_circ_m + PF.engargolado_long_m, 1e-9);
  assert.ok(g.qto.tmp.unitarios_min.soldadura < C.cotizarPartida(p, soldado).qto.tmp.unitarios_min.soldadura, 'sólo queda el cierre de los aros');
  // la reducción con injerto: la silleta es junta transversal
  const r = C.cotizarPartida({ ...galv24, familia: 'REDUCCION_INJERTO', D1_mm: 279.4, D2_mm: 254, d_mm: 127, beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450 }, M).geometria;
  const rs = C.cotizarPartida({ ...galv24, familia: 'REDUCCION_INJERTO', D1_mm: 279.4, D2_mm: 254, d_mm: 127, beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450 }, soldado).geometria;
  casi(r.engargolado_circ_m, rs.sold.filete_m, 1e-12, 'la silleta');
  casi(r.engargolado_long_m, rs.sold.tope_m, 1e-12, 'la costura del cono y la del injerto');
  // el acero al carbón y la pieza personalizada no cambian
  assert.equal(C.cotizarPartida({ ...p, material_id: 'ACERO_CARBON', calibre: 16 }, M).geometria.engargolado_m, 0);
  const pers = { ...galv24, familia: 'PERSONALIZADO', A_neta_m2: 1, L_corte_m: 4, L_sold_tope_m: 2, n_piezas: 1, n_extremos: 0 };
  assert.equal(C.cotizarPartida(pers, M).geometria.sold.tope_m, 2, 'lo capturado manda');
});
