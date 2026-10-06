'use strict';
/**
 * Pruebas del motor completo: separación cantidades/precios, pila de precio, validaciones,
 * cantidades múltiples, uniones y materiales.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/motor/util');
const C = require('../src/motor/cotizador');
const PRE = require('../src/motor/precios');
const { crearMaestros } = require('../src/datos/maestros');

const M = crearMaestros();

const casi = (real, esperado, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(real - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${msg} esperado ${esperado}, obtenido ${real}`);
};

// 3 000 mm de ducto con brida de taller en ambos extremos (sin la regla del extremo del tramo de ajuste, que se prueba aparte): 2 aros, 1 junta
const recto = {
  familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO', extremo_ajuste: 'CON_BRIDA',
};
const codo = {
  familia: 'CODO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 304.8, theta_deg: 90, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO',
};

test('Cantidades ≠ precios: el levantamiento de cantidades no cambia al variar precios, tarifas ni márgenes', () => {
  const M2 = crearMaestros({
    precios: { precio_kg_acero_carbon: 99.9, precio_juego_tornillo_m10: 50, precio_L_primario: 999 },
    capas: { utilidad_pct_precio: 0.35, gif_por_hora_mod: 400, iva_pct: 0.08 },
    mano_obra: { FSR: 2.0 },
  });
  [recto, codo].forEach((p) => {
    const a = C.levantarCantidades({ cantidad: 1, ...p }, M);
    const b = C.levantarCantidades({ cantidad: 1, ...p }, M2);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});

test('Re-cotización por variable: +10 % en precio_kg_acero_carbon sube la lámina exactamente 10 % y no toca mano de obra', () => {
  const M2 = crearMaestros({ precios: { precio_kg_acero_carbon: M.precios.precio_kg_acero_carbon * 1.1 } });
  const a = C.cotizarPartida({ ...recto, cantidad: 1 }, M);
  const b = C.cotizarPartida({ ...recto, cantidad: 1 }, M2);
  casi(b.costos.materiales.lamina, a.costos.materiales.lamina * 1.1, 1e-12);
  casi(b.costos.subtotales.mano_obra, a.costos.subtotales.mano_obra, 1e-12);
  assert.ok(b.precio.unitario > a.precio.unitario);
});

test('Falta una variable de precio → error claro con el nombre de la variable', () => {
  const M2 = crearMaestros();
  delete M2.precios.precio_kg_acero_carbon;
  assert.throws(() => C.cotizarPartida({ ...recto, cantidad: 1 }, M2), (e) => e instanceof U.ErrorValidacion && /precio_kg_acero_carbon/.test(e.message));
});

test('Pila de precio: P·(1 − u − c − o) = C_base y la utilidad es u·P (margen sobre precio)', () => {
  const M2 = crearMaestros({ capas: { utilidad_pct_precio: 0.27, comision_ventas_pct_precio: 0.035, otros_pct_precio: 0.01 } });
  const r = C.cotizarPartida({ ...recto, cantidad: 1 }, M2);
  casi(r.pila.precio * (1 - 0.27 - 0.035 - 0.01), r.pila.C_base, 1e-12);
  casi(r.pila.utilidad / r.pila.precio, 0.27, 1e-12);
  casi(r.pila.comision / r.pila.precio, 0.035, 1e-12);
  casi(r.pila.C_base + r.pila.utilidad + r.pila.comision + r.pila.otros, r.pila.precio, 1e-12);
  // el imprevisto se calcula sobre CD + CI, y el financiamiento sobre el costo total
  casi(r.pila.imprevistos, 0.04 * (r.pila.CD + r.pila.CI), 1e-12);
  casi(r.pila.financiamiento, r.pila.C_T * ((0.14 * 45) / 365), 1e-12);
});

test('Pila de precio: clase de riesgo cambia sólo los imprevistos', () => {
  const bajo = C.cotizarPartida({ ...recto, riesgo: 'BAJO' }, M);
  const alto = C.cotizarPartida({ ...recto, riesgo: 'ALTO' }, M);
  casi(bajo.pila.imprevistos / (bajo.pila.CD + bajo.pila.CI), 0.02, 1e-12);
  casi(alto.pila.imprevistos / (alto.pila.CD + alto.pila.CI), 0.08, 1e-12);
  casi(bajo.pila.CD, alto.pila.CD, 1e-12);
  assert.throws(() => C.cotizarPartida({ ...recto, riesgo: 'EXTREMO' }, M), U.ErrorValidacion);
});

test('Pila de precio: utilidad + comisión + otros ≥ 100 % es una configuración inválida', () => {
  const M2 = crearMaestros({ capas: { utilidad_pct_precio: 0.9, comision_ventas_pct_precio: 0.1 } });
  assert.throws(() => C.cotizarPartida({ ...recto }, M2), U.ErrorValidacion);
  assert.throws(() => PRE.pila(1000, 1, 'MEDIO', M2), U.ErrorValidacion);
});

test('Cargo mínimo por partida', () => {
  const r = C.cotizarPartida({ familia: 'COMPRADO', descripcion: 'Tornillo suelto', precio_compra_unitario: 10, cantidad: 1 }, M);
  assert.equal(r.precio.aplico_cargo_minimo, true);
  assert.equal(r.precio.unitario, M.capas.cargo_minimo_partida);
});

test('Artículo comprado: pasa por la pila sin horas de mano de obra', () => {
  const r = C.cotizarPartida({ familia: 'COMPRADO', descripcion: 'Compuerta Ø12"', precio_compra_unitario: 1800, cantidad: 2, riesgo: 'BAJO' }, M);
  casi(r.costos.CD, 3600, 1e-12);
  assert.equal(r.costos.h_MOD, 0);
  casi(r.pila.CI_fabrica, 0, 1e-12);
  casi(r.pila.CI_admin, 0.08 * 3600, 1e-12);
});

test('Cantidades múltiples: sin setup el precio unitario no cambia; con corte CNC el setup se amortiza', () => {
  const r1 = C.cotizarPartida({ ...recto, cantidad: 1 }, M);
  const r10 = C.cotizarPartida({ ...recto, cantidad: 10 }, M);
  casi(r10.pila.precio, r1.pila.precio * 10, 1e-12);
  const c1 = C.cotizarPartida({ ...codo, cantidad: 1 }, M);
  const c10 = C.cotizarPartida({ ...codo, cantidad: 10 }, M);
  assert.ok(c10.precio.unitario < c1.precio.unitario, 'el setup de programación CNC debe amortizarse');

  // Ahorro exacto: P(10) = 10·P(1) − 9·ΔP_setup, con ΔP_setup = K·[(1+adm)·CD_setup + GIF·h_setup]
  const K = ((1 + 0.04) * (1 + (0.14 * 45) / 365)) / (1 - 0.2 - 0.02);
  const h_setup = M.proceso.corte.t_prog_cnc_min / M.proceso.eficiencia_taller / 60;
  const mo_h = 500 * 1.0; // $500 por hora, ya con prestaciones (FSR = 1.00)
  const CD_setup = h_setup * (mo_h + 45) + 0.03 * h_setup * mo_h;
  const dP_setup = K * ((1 + 0.08) * CD_setup + 85 * h_setup);
  casi(c10.pila.precio, c1.pila.precio * 10 - 9 * dP_setup, 1e-9);
});

test('Cotización: totales, IVA y partidas con error no tumban el resto', () => {
  const cot = {
    riesgo: 'MEDIO',
    partidas: [
      { ...recto, cantidad: 2 },
      { ...codo, cantidad: 1 },
      { ...recto, calibre: 99, cantidad: 1 }, // calibre inexistente
    ],
  };
  const r = C.cotizar(cot, M);
  assert.equal(r.totales.n_partidas_ok, 2);
  assert.equal(r.totales.n_partidas_error, 1);
  assert.equal(r.partidas[2].ok, false);
  assert.match(r.partidas[2].errores[0], /calibre 99/i);
  const suma = r.partidas.filter((f) => f.ok).reduce((s, f) => s + f.precio.importe, 0);
  casi(r.totales.subtotal, suma, 1e-12);
  casi(r.totales.iva, U.redondear(suma * 0.16, 2), 1e-12);
  casi(r.totales.total, r.totales.subtotal + r.totales.iva, 1e-12);
});

test('Validaciones de entrada', () => {
  assert.throws(() => C.cotizarPartida({ ...recto, cantidad: 0 }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, cantidad: 1.5 }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, material_id: 'TITANIO' }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, familia: 'MARCIANO' }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, tipo_union: 'PEGAMENTO' }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, clase_sellado: 'Z' }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, merma_pct: 1 }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, L_mm: 0 }, M), U.ErrorValidacion);
});

test('Advertencia de calibre mínimo por diámetro y servicio (tabla parametrizable)', () => {
  const ok = C.cotizarPartida({ ...recto, calibre: 16, servicio: 'POLVO' }, M);
  assert.equal(ok.advertencias.filter((x) => /Calibre/.test(x)).length, 0);
  const delgado = C.cotizarPartida({ ...recto, calibre: 22, servicio: 'POLVO' }, M);
  assert.ok(delgado.advertencias.some((x) => /Calibre 22/.test(x)));
  const abrasivo = C.cotizarPartida({ ...recto, calibre: 16, servicio: 'ABRASIVO' }, M);
  assert.ok(abrasivo.advertencias.some((x) => /Calibre 16/.test(x)));
});

test('Espesor capturado (placa) anula la tabla de calibres', () => {
  const r = C.cotizarPartida({ ...recto, calibre: undefined, espesor_mm: 4.763 }, M);
  casi(r.espesor_mm, 4.763, 1e-12);
});

test('La tabla de calibre depende del material: 16 ga negro ≠ galvanizado ≠ inoxidable', () => {
  const e = (material_id) => C.cotizarPartida({ ...recto, material_id }, M).espesor_mm;
  casi(e('ACERO_CARBON'), 0.0598 * 25.4, 1e-12);
  casi(e('GALVANIZADO'), 0.0635 * 25.4, 1e-12);
  casi(e('INOX_304'), 0.0625 * 25.4, 1e-12);
  assert.ok(e('GALVANIZADO') / e('ACERO_CARBON') > 1.06);
});

test('Unión ESPIGA: sin aros ni empaque; con prolongación de lámina, fijaciones y sellador', () => {
  const r = C.cotizarPartida({ ...recto, tipo_union: 'ESPIGA' }, M);
  const h = r.qto.her;
  assert.equal(h.n_aros, 0);
  assert.equal(h.L_empaque_m, 0);
  assert.equal(h.n_espigas, 1);
  assert.ok(h.n_fijaciones >= 4);
  casi(h.A_espiga_m2, (r.geometria.extremos[0].P_med_mm * 60) / 1e6, 1e-12);
  assert.ok(r.qto.lam.A_neta_m2 > r.geometria.A_neta_m2);
  assert.ok(h.V_sellador_ml > 0);
});

test('Clases de sellado SMACNA: A ≥ B ≥ C ≥ NINGUNA (costura engargolada cuenta desde B)', () => {
  const base = { ...recto, tipo_costura: 'PITTSBURGH', material_id: 'GALVANIZADO', calibre: 20, servicio: 'VENTILACION', L_penetraciones_m: 0.5 };
  const L = (clase) => C.cotizarPartida({ ...base, clase_sellado: clase }, M).qto.her.L_sellado_m;
  const [n, c, b, a] = ['NINGUNA', 'C', 'B', 'A'].map(L);
  assert.equal(n, 0);
  assert.ok(c > 0 && b > c && a > b);
  casi(b - c, 3.0, 1e-12, 'la costura longitudinal de 3 m se sella en clase B');
  casi(a - b, 0.5, 1e-12);
});

test('Costura soldada vs engargolada: Pittsburgh no suelda la costura longitudinal y suma tiempo de engargolado', () => {
  const sol = C.cotizarPartida({ ...recto, material_id: 'GALVANIZADO', calibre: 20, servicio: 'VENTILACION', tipo_union: 'ESPIGA' }, M);
  const eng = C.cotizarPartida({ ...recto, material_id: 'GALVANIZADO', calibre: 20, servicio: 'VENTILACION', tipo_union: 'ESPIGA', tipo_costura: 'PITTSBURGH' }, M);
  // Las yardas de una pieza siempre se engargolan entre sí: hay engargolado aun con la costura longitudinal soldada...
  assert.ok(sol.qto.tmp.unitarios_min.engargolado > 0);
  assert.equal(sol.qto.PF.engargolado_long_m, 0);
  casi(sol.qto.PF.engargolado_m, sol.qto.PF.engargolado_circ_m, 1e-12);
  // ...y con costura Pittsburgh se suma el de la costura de cada anillo
  assert.ok(eng.qto.tmp.unitarios_min.engargolado > sol.qto.tmp.unitarios_min.engargolado);
  casi(eng.qto.PF.engargolado_long_m, 3.0, 1e-12);
  assert.ok(sol.qto.con.soldadura.kg_alambre > 0);
  assert.equal(eng.qto.con.soldadura.kg_alambre, 0);
});

test('Pintura NINGUNA anula superficie, consumibles y tiempo; galvanizado no se pinta por defecto', () => {
  const sin = C.cotizarPartida({ ...recto, pintura: 'NINGUNA' }, M);
  assert.equal(sin.costos.consumibles.pintura, 0);
  assert.equal(sin.qto.tmp.unitarios_min.pintura, 0);
  const galv = C.cotizarPartida({ ...recto, material_id: 'GALVANIZADO' }, M);
  assert.equal(galv.qto.pint.sistema, 'NINGUNA');
  const dos = C.cotizarPartida({ ...recto, pintura: 'PRIMARIO_ESMALTE' }, M);
  const uno = C.cotizarPartida({ ...recto, pintura: 'PRIMARIO' }, M);
  assert.ok(dos.costos.consumibles.pintura > uno.costos.consumibles.pintura);
});

test('Inoxidable: soldadura TIG, varilla y argón propios; más horas de soldadura que acero al carbón', () => {
  const ac = C.cotizarPartida({ ...recto, calibre: 16 }, M);
  const ix = C.cotizarPartida({ ...recto, material_id: 'INOX_304', calibre: 16, pintura: 'NINGUNA' }, M);
  assert.equal(ix.qto.tmp.detalle.proceso_soldadura, 'GTAW');
  assert.equal(ix.qto.con.soldadura.alambre_ref, 'precio_kg_varilla_er308l');
  assert.equal(ix.qto.con.soldadura.gas_ref, 'precio_m3_gas_argon');
  assert.ok(ix.qto.tmp.unitarios_min.soldadura > 2 * ac.qto.tmp.unitarios_min.soldadura);
  assert.ok(ix.precio.unitario > 2 * ac.precio.unitario);
});

test('Recuperación de chatarra: crédito = recuperación · merma · precio de chatarra', () => {
  const M2 = crearMaestros({ capas: { recuperacion_chatarra_pct: 0.5 } });
  const r = C.cotizarPartida({ ...recto }, M2);
  casi(r.costos.materiales.credito_chatarra, -0.5 * r.qto.lam.m_merma_kg * M.precios.precio_kg_chatarra_acero, 1e-12);
  const base = C.cotizarPartida({ ...recto }, M);
  assert.ok(r.precio.unitario < base.precio.unitario);
});

test('Merma por familia: accesorios > recto, y puede sobreescribirse por partida', () => {
  const rec = C.cotizarPartida({ ...recto }, M);
  const cod = C.cotizarPartida({ ...codo }, M);
  assert.ok(cod.qto.lam.phi > rec.qto.lam.phi);
  const ov = C.cotizarPartida({ ...codo, merma_pct: 0.3 }, M);
  casi(ov.qto.lam.phi, 0.3, 1e-12);
  casi(ov.qto.lam.m_bruta_kg, ov.qto.lam.m_neta_kg / 0.7, 1e-12);
});

test('Merma como rendimiento: m_bruta = m_neta/(1−φ), no m_neta·(1+φ)', () => {
  const r = C.cotizarPartida({ ...codo }, M);
  casi(r.qto.lam.m_bruta_kg, r.qto.lam.m_neta_kg / 0.8, 1e-12);
  assert.ok(r.qto.lam.m_bruta_kg > r.qto.lam.m_neta_kg * 1.2);
});

test('Todas las familias cotizan y producen precio positivo con desglose consistente', () => {
  const base = { material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 1 };
  const casos = [
    { familia: 'RECTO', D_mm: 304.8, L_mm: 3000 },
    { familia: 'CODO', D_mm: 304.8, theta_deg: 90 },
    { familia: 'CODO', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, theta_deg: 90 },
    { familia: 'REDUCCION', D1_mm: 400, D2_mm: 200 },
    { familia: 'TRANSICION', D_mm: 300, a_mm: 400, b_mm: 300 },
    { familia: 'RAMAL', D_mm: 400, d_mm: 200, L_cuerpo_mm: 800, L_ramal_mm: 500, beta_deg: 45 },
    { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 },
    { familia: 'REDUCCION_INJERTO', D1_mm: 400, D2_mm: 300, d_mm: 200, beta_deg: 30 },
    { familia: 'PANTALON', D_mm: 500, d1_mm: 354, d2_mm: 354, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500 },
    { familia: 'PERSONALIZADO', A_neta_m2: 1.2, L_corte_m: 9, L_sold_tope_m: 4, n_piezas: 2, n_extremos: 2, D_ref_mm: 300 },
  ];
  casos.forEach((c) => {
    const r = C.cotizarPartida({ ...base, ...c }, M);
    assert.ok(r.precio.unitario > 0, c.familia);
    const sub = r.costos.subtotales;
    casi(sub.materiales + sub.consumibles + sub.mano_obra + sub.equipo + sub.herramienta_menor, r.costos.CD, 1e-12, `CD ${c.familia}`);
    casi(r.pila.C_base + r.pila.utilidad + r.pila.comision + r.pila.otros, r.pila.precio, 1e-12, `pila ${c.familia}`);
    assert.ok(r.peso.neto_total_kg > 0, c.familia);
  });
});

/* ====================================================================== */
/* Injerto simple y reducción con injerto                                 */
/* ====================================================================== */
const redInj = {
  familia: 'REDUCCION_INJERTO', material_id: 'ACERO_CARBON', calibre: 16, D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45,
  tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO',
};

test('Nombres de taller: "Injerto simple" (id RAMAL) y "Reducción con injerto"', () => {
  assert.equal(C.FAMILIAS.RAMAL, 'Injerto simple');
  assert.equal(C.FAMILIAS.REDUCCION_INJERTO, 'Reducción con injerto');
  assert.equal(C.cotizarPartida({ ...redInj }, M).descripcion, 'Reducción con injerto');
  assert.equal(C.cotizarPartida({ ...redInj, descripcion: 'Inj. 45°' }, M).descripcion, 'Inj. 45°');
});

test('Reducción con injerto: usa su merma (28 %) y su dificultad de armado (1.9), con tres extremos bridados', () => {
  const r = C.cotizarPartida({ ...redInj }, M);
  casi(r.qto.lam.phi, M.merma.REDUCCION_INJERTO, 1e-12);
  casi(r.qto.lam.phi, 0.28, 1e-12);
  assert.equal(r.qto.tmp.detalle.k_dif_armado, 1.9);
  assert.equal(r.qto.her.n_aros, 3);
  assert.equal(r.geometria.extremos.length, 3);
  // merma como rendimiento, como en toda familia
  casi(r.qto.lam.m_bruta_kg, r.qto.lam.m_neta_kg / (1 - 0.28), 1e-12);
});

test('Reducción con injerto: ya no hay "lado" ni "sentido" por partida; una cotización anterior que los traía cotiza igual, sin errores', () => {
  const base = C.cotizarPartida({ ...redInj }, M);
  [{ lado: 'DER' }, { lado: 'IZQ' }, { sentido: 'MAYOR' }, { sentido: 'MENOR' }].forEach((extra) => {
    const r = C.cotizarPartida({ ...redInj, ...extra }, M);
    assert.equal(r.ok, true, JSON.stringify(extra));
    assert.equal(r.precio.unitario, base.precio.unitario, JSON.stringify(extra));
    casi(r.peso.neto_unitario_kg, base.peso.neto_unitario_kg, 1e-12);
    assert.equal(JSON.stringify(r.qto.tmp.unitarios_min), JSON.stringify(base.qto.tmp.unitarios_min));
  });
});

test('Reducción con injerto: el injerto va de extremo mayor a menor (hacia D2); es un dato de maestros y cambia el precio unos puntos si se invirtiera', () => {
  const base = C.cotizarPartida({ ...redInj }, M);
  assert.equal(M.proceso.injerto_inclinado_hacia, 'MENOR');
  assert.equal(base.geometria.detalle.sentido, 'MENOR');
  const M2 = crearMaestros({ proceso: { injerto_inclinado_hacia: 'MAYOR' } });
  const inv = C.cotizarPartida({ ...redInj }, M2);
  assert.equal(inv.geometria.detalle.sentido, 'MAYOR');
  const dif = inv.precio.unitario / base.precio.unitario - 1;
  assert.ok(dif > 0.005 && dif < 0.1, `hacia D1 el orificio y la silleta crecen: ${(dif * 100).toFixed(2)} %`);
});

test('Reducción con injerto: un valor inválido de "injerto inclinado hacia" en maestros se avisa en las partidas de esa familia y no tumba las demás', () => {
  const M3 = crearMaestros({ proceso: { injerto_inclinado_hacia: 'ARRIBA' } });
  const r = C.cotizar({ partidas: [{ ...redInj }, { familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO' }] }, M3);
  assert.equal(r.totales.n_partidas_error, 1);
  assert.match(r.partidas[0].errores[0], /injerto inclinado hacia/);
  assert.equal(r.partidas[1].ok, true);
});

test('Reducción con injerto: la merma y la dificultad son datos de maestros, no del código', () => {
  const M2 = crearMaestros({ merma: { REDUCCION_INJERTO: 0.35 }, proceso: { armado: { k_dif: { REDUCCION_INJERTO: 2.5 } } } });
  const a = C.cotizarPartida({ ...redInj }, M);
  const b = C.cotizarPartida({ ...redInj }, M2);
  casi(b.qto.lam.phi, 0.35, 1e-12);
  assert.equal(b.qto.tmp.detalle.k_dif_armado, 2.5);
  assert.ok(b.precio.unitario > a.precio.unitario);
});

test('Reducción con injerto: lámina neta = (cono + pared del injerto − orificio)·ρ·e, y el injerto va sobre el cono de la reducción', () => {
  const ri = C.cotizarPartida({ ...redInj }, M);
  const d = ri.geometria.detalle;
  casi(ri.qto.lam.m_neta_kg, (d.A_cono_m2 + d.A_ramal_m2 - ri.geometria.A_orificio_m2) * ri.qto.lam.kg_m2, 1e-12);
  const cono = C.cotizarPartida({ ...redInj, familia: 'REDUCCION', L_mm: d.L_reduccion_mm }, M);
  casi(d.A_cono_m2, cono.geometria.A_neta_m2, 1e-12, 'el cono es el de la reducción de ese largo');
  assert.ok(ri.qto.lam.m_neta_kg > cono.qto.lam.m_neta_kg, 'con el injerto pesa más que el cono solo');
  assert.equal(ri.qto.her.n_aros, 3);
  assert.equal(ri.geometria.n_piezas, 2, 'cono e injerto');
});

test('Reducción con injerto: los datos inválidos devuelven errores claros sin tumbar el resto de la cotización', () => {
  const r = C.cotizar({ partidas: [
    { ...redInj, beta_deg: 60 },
    { ...redInj, D2_mm: 400 },
    { ...redInj },
  ] }, M);
  assert.equal(r.totales.n_partidas_error, 2);
  assert.match(r.partidas[0].errores[0], /30° o 45°/);
  assert.match(r.partidas[1].errores[0], /D2 debe ser menor que D1/);
  assert.equal(r.partidas[2].ok, true);
});

/* ====================================================================== */
/* Ángulos del taller: injertos 30° o 45° · codos 30°, 45°, 60° o 90°     */
/* ====================================================================== */
const injertoSimple = { familia: 'RAMAL', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 400, d_mm: 200, L_cuerpo_mm: 900, L_ramal_mm: 700, tipo_union: 'BRIDADO' };

test('Todo injerto (simple o en la reducción) es a 30° o 45°: cualquier otro ángulo se rechaza con un mensaje claro', () => {
  [injertoSimple, redInj].forEach((base) => {
    [30, 45, '30', '45'].forEach((b) => assert.doesNotThrow(() => C.cotizarPartida({ ...base, beta_deg: b }, M), `β=${b} ${base.familia}`));
    [20, 60, 90, 15, 0, 75].forEach((b) => assert.throws(() => C.cotizarPartida({ ...base, beta_deg: b }, M), /Todo injerto debe ser a 30° o 45° \(la partida trae/, `β=${b} ${base.familia}`));
  });
  assert.doesNotThrow(() => C.cotizarPartida({ ...injertoSimple }, M), 'sin ángulo: el de maestros (45°)');
});

test('La lista de ángulos de injerto es un dato de maestros (no una constante del código)', () => {
  const M3 = crearMaestros({ proceso: { angulos_injerto_deg: [30, 45, 60] } });
  assert.doesNotThrow(() => C.cotizarPartida({ ...injertoSimple, beta_deg: 60 }, M3));
  assert.throws(() => C.cotizarPartida({ ...injertoSimple, beta_deg: 60 }, M), /30° o 45°/);
  const solo45 = crearMaestros({ proceso: { angulos_injerto_deg: [45] } });
  assert.throws(() => C.cotizarPartida({ ...injertoSimple, beta_deg: 30 }, solo45), /Todo injerto debe ser a 45°/);
});

test('Los codos del taller son de 30°, 45°, 60° o 90°: otros ángulos se rechazan (también el codo rectangular)', () => {
  [30, 45, 60, 90, '60'].forEach((th) => assert.doesNotThrow(() => C.cotizarPartida({ ...codo, theta_deg: th }, M), `θ=${th}`));
  [15, 22.5, 75, 120, 180, 0].forEach((th) => assert.throws(() => C.cotizarPartida({ ...codo, theta_deg: th }, M), /Los codos del taller son de 30°, 45°, 60° o 90° \(la partida trae/, `θ=${th}`));
  const rect = { familia: 'CODO', material_id: 'ACERO_CARBON', calibre: 16, forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, tipo_union: 'BRIDADO' };
  assert.doesNotThrow(() => C.cotizarPartida({ ...rect, theta_deg: 45 }, M));
  assert.throws(() => C.cotizarPartida({ ...rect, theta_deg: 75 }, M), /Los codos del taller/);
  const sinAngulo = { ...codo };
  delete sinAngulo.theta_deg;
  assert.doesNotThrow(() => C.cotizarPartida(sinAngulo, M), 'sin ángulo: 90°');
});

test('Gajos automáticos de los codos del taller: 30° → 3, 45° → 3, 60° → 4, 90° → 5 (α ≤ 22.5° por junta)', () => {
  Object.entries({ 30: 3, 45: 3, 60: 4, 90: 5 }).forEach(([th, n]) => {
    const r = C.cotizarPartida({ ...codo, theta_deg: Number(th) }, M);
    assert.equal(r.geometria.detalle.n_gajos, n, `${th}°`);
    assert.ok(r.geometria.detalle.alfa_deg <= 22.5 + 1e-9, `${th}°`);
  });
});

test('La lista de ángulos de codo es un dato de maestros, y un ángulo no permitido sólo tumba su partida', () => {
  const M3 = crearMaestros({ proceso: { angulos_codo_deg: [15, 90] } });
  assert.doesNotThrow(() => C.cotizarPartida({ ...codo, theta_deg: 15 }, M3));
  assert.throws(() => C.cotizarPartida({ ...codo, theta_deg: 45 }, M3), /Los codos del taller son de 15° o 90°/);
  const r = C.cotizar({ partidas: [{ ...codo, theta_deg: 75 }, { ...codo, theta_deg: 45 }, { ...injertoSimple, beta_deg: 60 }, { ...injertoSimple }] }, M);
  assert.equal(r.totales.n_partidas_error, 2);
  assert.equal(r.totales.n_partidas_ok, 2);
  assert.equal(r.partidas[0].ok, false);
  assert.equal(r.partidas[1].ok, true);
  assert.equal(r.partidas[2].ok, false);
  assert.equal(r.partidas[3].ok, true);
});

test('Pantalón (retirado): una cotización anterior que lo trae sigue calculando, con aviso de familia retirada', () => {
  const r = C.cotizarPartida({
    familia: 'PANTALON', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 500, d1_mm: 354, d2_mm: 354, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500,
  }, M);
  assert.ok(r.precio.unitario > 0);
  assert.equal(r.descripcion, 'Pantalón (familia retirada)');
  assert.ok(r.advertencias.some((x) => /Familia retirada/.test(x)));
});

test('Maestros: mezclar no muta la base y ajusta sólo lo indicado', () => {
  const a = crearMaestros();
  const b = crearMaestros({ precios: { precio_kg_acero_carbon: 1 } });
  assert.equal(b.precios.precio_kg_acero_carbon, 1);
  assert.equal(b.precios.precio_kg_inox_304, a.precios.precio_kg_inox_304);
  assert.notEqual(crearMaestros().precios.precio_kg_acero_carbon, 1);
});

test('Subcontratos: omitir una operación quita sus horas y consumibles y suma el costo por driver', () => {
  const base = C.cotizarPartida({ ...recto }, M);
  const sub = C.cotizarPartida({
    ...recto,
    omitir_operaciones: ['pintura'],
    subcontratos: [{ concepto: 'Pintura electrostática', driver: 'M2_NETO', precio: 120 }],
  }, M);
  assert.equal(sub.costos.consumibles.pintura, 0);
  assert.equal(sub.costos.mano_obra.pintura, 0);
  assert.equal(sub.costos.equipo.pintura, 0);
  casi(sub.costos.subcontratos['1. Pintura electrostática'], 120 * base.qto.lam.A_neta_m2, 1e-12);
  casi(sub.costos.h_MOD, base.costos.h_MOD - base.costos.horas_reales.pintura, 1e-12);
  // el resto de operaciones no cambia
  casi(sub.costos.mano_obra.soldadura, base.costos.mano_obra.soldadura, 1e-12);
  casi(sub.costos.CD,
    base.costos.CD - base.costos.consumibles.pintura - base.costos.mano_obra.pintura - base.costos.equipo.pintura
    - 0.03 * base.costos.mano_obra.pintura + sub.costos.subcontratos['1. Pintura electrostática'], 1e-9);
});

test('Subcontratos: drivers disponibles y validación', () => {
  const r = C.cotizarPartida({
    ...recto,
    cantidad: 2,
    subcontratos: [
      { concepto: 'Galvanizado en caliente', driver: 'KG_NETO', precio: 10 },
      { concepto: 'Maquila', driver: 'PIEZA', precio: 100 },
      { concepto: 'Corte láser', driver: 'M_CORTE', precio: 5 },
    ],
  }, M);
  const base = C.cotizarPartida({ ...recto, cantidad: 2 }, M);
  casi(r.costos.subcontratos['1. Galvanizado en caliente'], 10 * base.peso.neto_total_kg, 1e-12);
  casi(r.costos.subcontratos['2. Maquila'], 200, 1e-12);
  casi(r.costos.subcontratos['3. Corte láser'], 5 * 2 * base.qto.tmp.detalle.L_corte_m, 1e-12);
  assert.throws(() => C.cotizarPartida({ ...recto, subcontratos: [{ concepto: 'X', driver: 'LITROS', precio: 1 }] }, M), U.ErrorValidacion);
  assert.throws(() => C.cotizarPartida({ ...recto, omitir_operaciones: ['teletransporte'] }, M), U.ErrorValidacion);
});

test('Indicadores: precio piso = costo base / (1 − comisión − otros); horas MOD por kg', () => {
  const r = C.cotizarPartida({ ...recto }, M);
  casi(r.indicadores.precio_piso, r.pila.C_base / (1 - 0.02 - 0), 1e-12);
  assert.ok(r.indicadores.precio_piso < r.precio.total_sin_redondeo);
  casi(r.indicadores.horas_mod_por_kg_neto, r.costos.h_MOD / r.peso.neto_total_kg, 1e-12);
});

/* ====================================================================== */
/* Estándar del taller: solera 1½" × 3/16", barreno Ø3/8", tornillo 5/16" × 1¼" */
/* ====================================================================== */
const MAT = require('../src/motor/material');

test('Solera 1½" × 3/16": peso lineal = ancho·espesor·ρ; fibra neutra y barreno al centro del ancho', () => {
  const p = MAT.perfilDerivado(M, 'SOL38x4.8');
  casi(p.area_mm2, 38.1 * 4.763, 1e-12);
  casi(p.peso_kg_m, (38.1 * 4.763 * 7.85) / 1000, 1e-12);
  casi(p.peso_kg_m, 1.4245, 1e-4, 'peso lineal');
  casi(p.c_centroide_mm, 19.05, 1e-12);
  casi(p.gramil_mm, 19.05, 1e-12);
  assert.equal(p.tipo, 'SOLERA');
});

test('El taller usa la misma brida en todos los diámetros: solera 1½"×3/16", barreno Ø3/8", tornillo 5/16"×1¼"', () => {
  [101.6, 203.2, 304.8, 609.6, 1219.2, 1828.8].forEach((D) => {
    const r = C.cotizarPartida({ ...recto, D_mm: D }, M);
    r.qto.her.aros.forEach((a) => {
      assert.equal(a.perfil_id, 'SOL38x4.8', `Ø${D}`);
      casi(a.diam_barreno_mm, 9.525, 1e-12);
      assert.equal(a.barreno_desc, '3/8"');
      assert.equal(a.tornillo_desc, '5/16" × 1¼"');
      assert.equal(a.tornillo, '5/16x1-1/4');
    });
    assert.deepEqual(Object.keys(r.qto.her.tornillos_por_tipo), ['5/16x1-1/4']);
  });
});

test('Aro de solera: L = π·(D_ext + ancho) + holgura; el círculo de barrenos coincide con la fibra neutra', () => {
  const r = C.cotizarPartida({ ...recto }, M);
  const D_ext = 304.8 + 2 * (0.0598 * 25.4);
  const a = r.qto.her.aros[0];
  casi(a.L_aro_mm, Math.PI * (D_ext + 38.1) + 3.0, 1e-12);
  casi(a.P_perno_mm, Math.PI * (D_ext + 38.1), 1e-12, 'D_bc = D_ext + 2·g con g = ancho/2');
  assert.equal(a.n_tornillos, 8);
});

test('Paso entre barrenos: n = múltiplo de 4 ≥ máx(4, ⌈π·D_bc / paso⌉)', () => {
  const M2 = crearMaestros({ herrajes: { uniones: { BRIDADO: { paso_tornillo_mm: 100 } } } });
  const n = (D, MM = M) => C.cotizarPartida({ ...recto, D_mm: D }, MM).qto.her.aros[0].n_tornillos;
  assert.equal(n(304.8, M2), 12);   // π·346 / 100 = 10.9 → 11 → 12
  assert.equal(n(101.6, M), 4);     // chico: mínimo 4
  assert.equal(n(609.6, M) % 4, 0);
});

test('Cada aro se valoriza con el precio de SU perfil: solera ≠ ángulo (barra cotizada o, si no la hay, precio por kg)', () => {
  // La solera estándar y el ángulo 1½" × 3/16" tienen barra cotizada: el precio por kg de la tabla no los toca.
  const base = C.cotizarPartida({ ...recto }, M);
  const sol = (precios) => C.cotizarPartida({ ...recto }, crearMaestros({ precios }));
  casi(sol({ precio_kg_solera: 999, precio_kg_perfil_angulo: 999 }).costos.materiales.perfiles, base.costos.materiales.perfiles, 1e-12, 'con barra cotizada manda la lista del proveedor');
  assert.equal(base.costos.precios_usados.perfiles['SOL38x4.8'].fuente, 'PROVEEDOR');
  // Con el precio de la barra ×1.1 el costo del perfil sube exactamente 10 %
  const barra = M.proveedor.barras.SOL_1_1_2X3_16;
  const caro = C.cotizarPartida({ ...recto }, crearMaestros({ proveedor: { barras: { SOL_1_1_2X3_16: { precio: barra.precio * 1.1 } } } }));
  casi(caro.costos.materiales.perfiles, base.costos.materiales.perfiles * 1.1, 1e-12);
  // El ángulo 1½" × 1/8" no tiene barra cotizada: usa el precio por kg de la tabla, y la solera no lo afecta
  const ang = (precios) => C.cotizarPartida({ ...recto, perfil_id: 'L38x3.2' }, crearMaestros({ precios }));
  const angBase = ang({});
  assert.equal(angBase.costos.precios_usados.perfiles['L38x3.2'].fuente, 'TABLA');
  casi(ang({ precio_kg_solera: 999 }).costos.materiales.perfiles, angBase.costos.materiales.perfiles, 1e-12, 'el precio de la solera no afecta al ángulo');
  casi(ang({ precio_kg_perfil_angulo: M.precios.precio_kg_perfil_angulo * 1.1 }).costos.materiales.perfiles, angBase.costos.materiales.perfiles * 1.1, 1e-12);
  assert.equal(angBase.qto.her.aros[0].perfil_id, 'L38x3.2');
  assert.equal(angBase.qto.her.aros[0].tornillo, 'M10');
});

test('El tornillo 5/16" × 1¼" se valoriza con su propia variable de precio', () => {
  const base = C.cotizarPartida({ ...recto }, M);
  const M2 = crearMaestros({ precios: { precio_juego_tornillo_5_16_x_1_1_4: M.precios.precio_juego_tornillo_5_16_x_1_1_4 * 1.1, precio_juego_tornillo_m10: 999 } });
  const r = C.cotizarPartida({ ...recto }, M2);
  casi(r.costos.materiales.tornilleria, base.costos.materiales.tornilleria * 1.1, 1e-12);
  casi(base.costos.materiales.tornilleria, 8 * 1.05 * M.precios.precio_juego_tornillo_5_16_x_1_1_4, 1e-12);
});

test('Cierre del aro: se suelda a tope en el espesor de la solera (cordón y velocidad propios)', () => {
  const r = C.cotizarPartida({ ...recto }, M);
  const cierres = r.qto.her.sold_aros.cierres;
  assert.equal(cierres.length, 2);
  cierres.forEach((c) => { casi(c.L_m, 0.0381, 1e-12); casi(c.esp_mm, 4.763, 1e-12); });
  const A_cierre = Math.max(2.0, 1.75 * 4.763 ** 2);
  casi(r.qto.con.soldadura.m_depositado_cierres_g, 2 * 0.0381 * A_cierre * 7.85, 1e-12);
  // velocidad de la tabla a 4.763 mm (extremo plano 0.24 m/min), más lenta que a 1.519 mm
  casi(r.qto.tmp.detalle.t_arco_cierres_min, (2 * 0.0381) / 0.24, 1e-12);
  assert.ok(r.qto.tmp.detalle.t_arco_cierres_min * 0.24 < r.qto.tmp.detalle.t_arco_chapa_min * r.qto.tmp.detalle.v_soldadura_m_min * 0.1);
});

test('Marco rectangular de solera: L = 2(a+b)_ext + 8c + 4·holgura; 4 cierres de una sección', () => {
  const r = C.cotizarPartida({ ...recto, forma: 'RECTANGULAR', a_mm: 500, b_mm: 300, L_mm: 1200 }, M);
  const e = 0.0598 * 25.4;
  const a_ext = 500 + 2 * e;
  const b_ext = 300 + 2 * e;
  const aro = r.qto.her.aros[0];
  casi(aro.L_aro_mm, 2 * (a_ext + b_ext) + 8 * 19.05 + 4 * 3.0, 1e-12);
  casi(aro.P_perno_mm, 2 * (a_ext + b_ext) + 8 * 19.05, 1e-12);
  assert.equal(aro.n_tornillos % 4, 0);
  casi(r.qto.her.sold_aros.cierres[0].L_m, (4 * 38.1) / 1000, 1e-12);
});

test('Los aros de solera no pesan lo del ángulo: la brida estándar es más ligera que el ángulo 1½×1½×1/8', () => {
  const sol = C.cotizarPartida({ ...recto }, M);
  const ang = C.cotizarPartida({ ...recto, perfil_id: 'L38x3.2' }, M);
  assert.ok(sol.qto.her.m_aros_neta_kg !== ang.qto.her.m_aros_neta_kg);
  casi(sol.qto.her.m_aros_neta_kg, 2 * (sol.qto.her.aros[0].L_aro_mm / 1000) * 1.4245, 1e-4);
});

test('Pintura de aros: dos caras + canto exterior de la solera', () => {
  const r = C.cotizarPartida({ ...recto }, M);
  const D = 304.8 + 2 * (0.0598 * 25.4);
  const Dre = D + 2 * 38.1;
  const un_aro = ((Math.PI / 2) * (Dre * Dre - D * D) + Math.PI * Dre * 4.763) / 1e6;
  casi(r.qto.her.A_pintura_aros_m2, 2 * un_aro, 1e-12);
});

test('ESPIGA no usa aros: no hay perfil, barrenos ni cierres', () => {
  const r = C.cotizarPartida({ ...recto, tipo_union: 'ESPIGA' }, M);
  assert.equal(r.qto.her.aros.length, 0);
  assert.equal(r.qto.her.n_barrenos, 0);
  assert.equal(r.qto.her.sold_aros.cierres.length, 0);
  assert.equal(r.costos.materiales.perfiles, 0);
});

/* ---------- Armado por yardas (regla del taller) ---------- */

const rectoYardas = { ...recto, extremo_ajuste: undefined }; // por omisión: el extremo del ajuste va como dicen las tablas (brida suelta)

test('Tramo de ajuste: sin brida, con brida de taller o con brida suelta — cuánto cambia cada cosa', () => {
  const sin = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'SIN_BRIDA' }, M); // 3 000 mm en yardas de 1 220 = 2 yardas + ajuste de 560: 1 brida
  const con = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA' }, M); // 2 bridas de taller
  assert.equal(sin.qto.her.n_aros, 1);
  assert.equal(con.qto.her.n_aros, 2);
  casi(sin.qto.her.m_aros_neta_kg * 2, con.qto.her.m_aros_neta_kg, 1e-12);
  assert.equal(sin.qto.her.n_barrenos * 2, con.qto.her.n_barrenos);
  casi(sin.qto.her.n_tornillos_asignados * 2, con.qto.her.n_tornillos_asignados, 1e-12);
  casi(sin.qto.her.L_empaque_m * 2, con.qto.her.L_empaque_m, 1e-12);
  casi(sin.qto.her.sold_aros.filete_m * 2, con.qto.her.sold_aros.filete_m, 1e-12);
  assert.equal(sin.qto.her.sold_aros.cierres.length, 1);
  casi(sin.costos.materiales.perfiles * 2, con.costos.materiales.perfiles, 1e-12);
  casi(sin.costos.materiales.tornilleria * 2, con.costos.materiales.tornilleria, 1e-12);
  // la lámina no cambia: el ducto es el mismo
  casi(sin.costos.materiales.lamina, con.costos.materiales.lamina, 1e-12);
  assert.ok(sin.precio.unitario < con.precio.unitario);
  assert.equal(sin.qto.her.aros_sueltos.length, 0);
  // un tramo que cae justo en yardas completas lleva brida en ambos extremos, sin pedirlo (y ningún aro suelto)
  const justo = C.cotizarPartida({ ...rectoYardas, L_mm: 3660 }, M);
  assert.equal(justo.qto.her.n_aros, 2);
  assert.equal(justo.qto.her.aros_sueltos.length, 0);
  assert.equal(justo.geometria.detalle.armado.extremo_libre, false);
});

test('Brida suelta (por omisión): el taller manda el aro, los tornillos y el empaque sin fabricarlos — sólo material, nada de mano de obra', () => {
  const sin = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'SIN_BRIDA' }, M);
  const con = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA' }, M);
  const suelta = C.cotizarPartida(rectoYardas, M); // sin pedirlo: manda la tabla maestra (SUELTA)
  const her = suelta.qto.her;
  assert.equal(suelta.geometria.detalle.armado.modo, 'SUELTA');
  // Una brida de taller (la del extremo de las yardas) y un aro suelto idéntico al de taller
  assert.equal(her.n_aros, 1);
  assert.equal(her.aros_sueltos.length, 1);
  assert.equal(her.aros_sueltos[0].suelta, true);
  assert.equal(her.aros[0].suelta, false);
  casi(her.aros_sueltos[0].L_aro_mm, her.aros[0].L_aro_mm, 1e-12);
  casi(her.m_aros_sueltos_neta_kg, her.m_aros_neta_kg, 1e-12);
  casi(her.m_aros_sueltos_bruta_kg, her.m_aros_bruta_kg, 1e-12);
  // Lo que se fabrica no cambia respecto de «sin brida»: ni barrenos, ni soldadura de aros, ni pintura de aros
  assert.equal(her.n_barrenos, sin.qto.her.n_barrenos);
  assert.equal(her.sold_aros.cierres.length, 1);
  casi(her.sold_aros.filete_m, sin.qto.her.sold_aros.filete_m, 1e-12);
  casi(her.A_pintura_aros_m2, sin.qto.her.A_pintura_aros_m2, 1e-12);
  casi(her.L_aros_m, sin.qto.her.L_aros_m, 1e-12);
  // El material de su junta sí está: el aro, la media tornillería y el medio empaque de ese extremo; el sellador no (se pone en obra)
  casi(her.n_tornillos_asignados, con.qto.her.n_tornillos_asignados, 1e-12);
  casi(her.L_empaque_m, con.qto.her.L_empaque_m, 1e-12);
  casi(her.L_sellado_m, sin.qto.her.L_sellado_m, 1e-12);
  casi(suelta.costos.materiales.perfiles, con.costos.materiales.perfiles, 1e-12);
  casi(suelta.costos.materiales.tornilleria, con.costos.materiales.tornilleria, 1e-12);
  casi(suelta.costos.materiales.empaque, con.costos.materiales.empaque, 1e-12);
  casi(suelta.costos.materiales.sellador, sin.costos.materiales.sellador, 1e-12);
  casi(suelta.costos.materiales.flete, con.costos.materiales.flete, 1e-12, 'el flete va sobre lámina y perfiles: también sobre el aro suelto');
  // Ninguna hora de taller ni consumible: horas, mano de obra, equipo y consumibles son los de «sin brida»
  Object.keys(sin.costos.horas_std).forEach((op) => casi(suelta.costos.horas_std[op], sin.costos.horas_std[op], 1e-12, op));
  assert.deepEqual(suelta.costos.consumibles, sin.costos.consumibles);
  casi(suelta.costos.subtotales.mano_obra, sin.costos.subtotales.mano_obra, 1e-12);
  casi(suelta.costos.subtotales.equipo, sin.costos.subtotales.equipo, 1e-12);
  // El aumento de costo directo es exactamente el material del aro (perfil + tornillería + empaque + su flete)
  const dif = (campo) => suelta.costos.materiales[campo] - sin.costos.materiales[campo];
  casi(suelta.costos.CD - sin.costos.CD, dif('perfiles') + dif('tornilleria') + dif('empaque') + dif('flete'), 1e-12);
  assert.ok(dif('perfiles') > 0 && dif('tornilleria') > 0 && dif('empaque') > 0 && dif('flete') > 0);
  // Cuesta más que no mandarla y bastante menos que fabricarla y soldarla en taller
  assert.ok(sin.precio.unitario < suelta.precio.unitario && suelta.precio.unitario < con.precio.unitario);
  assert.ok((suelta.precio.unitario - sin.precio.unitario) < 0.4 * (con.precio.unitario - sin.precio.unitario), 'el aro suelto es el material; fabricarlo es sobre todo mano de obra');
  // El peso que se manda incluye el aro suelto
  casi(suelta.peso.neto_unitario_kg - sin.peso.neto_unitario_kg, her.m_aros_sueltos_neta_kg, 1e-12);
  casi(suelta.peso.aros_sueltos_neto_kg, her.m_aros_sueltos_neta_kg, 1e-12);
  assert.equal(sin.peso.aros_sueltos_neto_kg, 0);
  // Se multiplica por la cantidad como todo el material
  const cinco = C.cotizarPartida({ ...rectoYardas, cantidad: 5 }, M);
  casi(cinco.costos.materiales.perfiles, 5 * suelta.costos.materiales.perfiles, 1e-12);
  casi(cinco.costos.materiales.tornilleria, 5 * suelta.costos.materiales.tornilleria, 1e-12);
});

test('Brida suelta: sigue las demás opciones de la unión (sin empaque, perfil de ángulo, unión de espiga, tablas maestras)', () => {
  // sin empaque: tampoco va el empaque del extremo suelto
  const sinEmp = C.cotizarPartida({ ...rectoYardas, usa_empaque: false }, M);
  assert.equal(sinEmp.qto.her.L_empaque_m, 0);
  assert.equal(sinEmp.qto.her.aros_sueltos.length, 1);
  // perfil de ángulo: el aro suelto es del mismo perfil que el de taller y se valoriza con su precio
  const ang = C.cotizarPartida({ ...rectoYardas, perfil_id: 'L38x4.8' }, M);
  assert.equal(ang.qto.her.aros_sueltos[0].perfil_id, 'L38x4.8');
  assert.deepEqual(Object.keys(ang.costos.precios_usados.perfiles), ['L38x4.8']);
  // unión de espiga o lisa: no hay aros, ni de taller ni sueltos
  ['ESPIGA', 'LISO'].forEach((tipo) => {
    const r = C.cotizarPartida({ ...rectoYardas, tipo_union: tipo }, M);
    assert.equal(r.qto.her.aros_sueltos.length, 0, tipo);
    assert.equal(r.costos.materiales.perfiles, 0, tipo);
  });
  // lo que diga la tabla maestra manda cuando la partida no pide nada; lo que pida la partida manda sobre la tabla
  const Msin = crearMaestros({ proceso: { armado_yardas: { extremo_ajuste_defecto: 'SIN_BRIDA' } } });
  assert.equal(C.cotizarPartida(rectoYardas, Msin).qto.her.aros_sueltos.length, 0);
  assert.equal(C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'SUELTA' }, Msin).qto.her.aros_sueltos.length, 1);
  const Mcon = crearMaestros({ proceso: { armado_yardas: { extremo_ajuste_defecto: 'CON_BRIDA' } } });
  assert.equal(C.cotizarPartida(rectoYardas, Mcon).qto.her.n_aros, 2);
  // Una tabla maestra con un valor que no existe se señala con su ruta (no se calcula con un valor inventado)
  const Mmal = U.clonar(M);
  Mmal.proceso.armado_yardas.extremo_ajuste_defecto = 'suelta';
  assert.throws(() => C.cotizarPartida(rectoYardas, Mmal), /extremo ajuste defecto: debe ser SUELTA, SIN_BRIDA, CON_BRIDA; vale suelta/);
  // La partida con un valor que no existe también se rechaza
  assert.throws(() => C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'NINGUNO' }, M), /Extremo del tramo de ajuste: «NINGUNO» no existe \(use SUELTA, SIN_BRIDA, CON_BRIDA\)/);
});

test('Partidas guardadas con la versión anterior (ajuste_sin_brida sí/no) conservan lo que significaban', () => {
  const si = C.cotizarPartida({ ...rectoYardas, ajuste_sin_brida: true }, M);
  const no = C.cotizarPartida({ ...rectoYardas, ajuste_sin_brida: false }, M);
  assert.equal(si.entrada.extremo_ajuste, 'SIN_BRIDA');
  assert.equal(no.entrada.extremo_ajuste, 'CON_BRIDA');
  assert.ok(!('ajuste_sin_brida' in si.entrada) && !('ajuste_sin_brida' in no.entrada));
  casi(si.precio.importe, C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'SIN_BRIDA' }, M).precio.importe, 1e-12);
  casi(no.precio.importe, C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA' }, M).precio.importe, 1e-12);
  // si trae las dos, manda la nueva
  assert.equal(C.cotizarPartida({ ...rectoYardas, ajuste_sin_brida: true, extremo_ajuste: 'SUELTA' }, M).entrada.extremo_ajuste, 'SUELTA');
});

test('Yardas: cada una se rola aparte y las juntas entre ellas se engargolan (más anillos, más tiempo de rolado y de engargolado)', () => {
  const por1220 = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA', yarda_mm: 1220 }, M); // 3 anillos
  const por914 = C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA', yarda_mm: 914 }, M); // 4 anillos
  assert.equal(por1220.geometria.n_virolas, 3);
  assert.equal(por914.geometria.n_virolas, 4);
  // el mismo ducto: misma área y misma lámina
  casi(por914.geometria.A_neta_m2, por1220.geometria.A_neta_m2, 1e-12);
  casi(por914.qto.lam.m_bruta_kg, por1220.qto.lam.m_bruta_kg, 1e-12);
  // rolado = Σ (tiempo fijo + pasadas · m / velocidad): cada anillo trae su tiempo fijo
  const t = (r) => r.qto.tmp.unitarios_min.rolado;
  casi(t(por914) - t(por1220), 3.0, 1e-9, 'un anillo más = un tiempo fijo de rolado más (3 min)');
  // juntas engargoladas: 2 y 2 (3 anillos en una pieza; 3 en una pieza y el ajuste aparte), pero 3 piezas vs 1 en el armado
  assert.equal(por914.geometria.n_piezas, 2);
  assert.equal(por1220.geometria.n_piezas, 1);
  assert.ok(por914.qto.tmp.unitarios_min.armado > por1220.qto.tmp.unitarios_min.armado);
  assert.equal(por914.qto.PF.n_engargolados, 2);
  casi(por914.qto.PF.engargolado_circ_m, 2 * (Math.PI * (304.8 + 0.0598 * 25.4)) / 1000, 1e-12);
  // el ancho de la hoja es el de la yarda: más hojas «equivalentes» al manejar la de 3 ft
  assert.ok(por914.qto.tmp.detalle.n_hojas_eq > por1220.qto.tmp.detalle.n_hojas_eq);
  casi(por914.qto.tmp.detalle.n_hojas_eq / por1220.qto.tmp.detalle.n_hojas_eq, 1220 / 914, 1e-12);
});

test('Sellado clase C: también se sellan las juntas engargoladas entre yardas (son transversales); NINGUNA no sella nada', () => {
  const sel = (clase, yarda) => C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA', yarda_mm: yarda, clase_sellado: clase }, M).qto.her.L_sellado_m;
  const P_med = Math.PI * (304.8 + 0.0598 * 25.4);
  const D_ext = 304.8 + 2 * 0.0598 * 25.4;
  casi(sel('C', 1220), (1 * Math.PI * D_ext) / 1000 + (2 * P_med) / 1000, 1e-12, '1 junta de bridas + 2 juntas engargoladas');
  // con yardas de 914 el ajuste es una pieza aparte (con brida en ambos extremos): una junta de bridas más, las engargoladas son las mismas
  casi(sel('C', 914) - sel('C', 1220), (Math.PI * D_ext) / 1000, 1e-12);
  assert.equal(sel('NINGUNA', 1220), 0);
  // la costura longitudinal soldada a tope no se sella; con Pittsburgh se suma desde la clase B
  const B = (tc) => C.cotizarPartida({ ...rectoYardas, extremo_ajuste: 'CON_BRIDA', clase_sellado: 'B', tipo_costura: tc }, M).qto.her.L_sellado_m;
  casi(B('PITTSBURGH') - B('A_TOPE'), 3.0, 1e-12);
});

test('Tramo recto largo: piezas de 3 yardas con brida en ambos extremos y el ajuste con brida suelta; el precio crece sin saltos locos', () => {
  const r = C.cotizarPartida({ ...rectoYardas, L_mm: 10000 }, M); // 8 yardas de 1 220 + ajuste de 240: [3][3][2+240]
  assert.deepEqual(r.geometria.detalle.armado.piezas.map((q) => `${q.yardas}${q.ajuste_mm ? `+${q.ajuste_mm}` : ''}`), ['3', '3', '2+240']);
  assert.equal(r.qto.her.n_aros, 5);
  assert.equal(r.qto.her.aros_sueltos.length, 1);
  assert.equal(r.geometria.n_virolas, 9);
  casi(r.geometria.A_neta_m2, ((Math.PI * (304.8 + 0.0598 * 25.4) + 1.0) * 10000) / 1e6, 1e-12);
  // el precio por metro lineal de un tramo largo no se dispara frente al de uno corto (las bridas son por pieza, no por metro)
  const corto = C.cotizarPartida({ ...rectoYardas, L_mm: 3660 }, M);
  assert.ok(r.indicadores.precio_por_m_lineal < corto.indicadores.precio_por_m_lineal * 1.1);
});

test('Ancho de la yarda de la cotización: lo heredan los tramos rectos que no traen el suyo (el ingeniero elige 3 ó 4 pies)', () => {
  const R = { ...rectoYardas, descripcion: 'Tramo' };
  const cot = (yarda, partidas) => C.cotizar({ yarda_mm: yarda, partidas }, M);
  // 3 000 mm: con yardas de 1 220 = 2 yardas y ajuste (1 pieza, 3 anillos); con 914 = 3 yardas y ajuste aparte (2 piezas, 4 anillos)
  const c914 = cot(914, [R]);
  const c1220 = cot(1220, [R]);
  assert.equal(c914.partidas[0].geometria.n_piezas, 2);
  assert.equal(c914.partidas[0].entrada.yarda_mm, 914);
  assert.equal(c1220.partidas[0].geometria.n_piezas, 1);
  assert.equal(c914.partidas[0].geometria.n_virolas, 4);
  // igual que pedirlo en la partida
  casi(c914.partidas[0].precio.importe, C.cotizarPartida({ ...R, yarda_mm: 914 }, M).precio.importe, 1e-12);
  // sin elegir, mandan las tablas maestras (1 220 mm)
  casi(cot(undefined, [R]).partidas[0].precio.importe, c1220.partidas[0].precio.importe, 1e-12);
  casi(cot('', [R]).partidas[0].precio.importe, c1220.partidas[0].precio.importe, 1e-12);
  // la partida que trae su propio ancho lo conserva
  const mixta = cot(914, [R, { ...R, yarda_mm: 1220 }, { ...R, yarda_mm: '' }, { ...R, yarda_mm: 0 }]);
  assert.deepEqual(mixta.partidas.map((f) => f.entrada.yarda_mm), [914, 1220, 914, 914]);
  assert.deepEqual(mixta.partidas.map((f) => f.geometria.n_piezas), [2, 1, 2, 2]);
  // sólo el tramo recto se arma por yardas: las demás familias no reciben el dato
  const otras = cot(914, [{ ...codo }, { ...R, forma: 'RECTANGULAR', D_mm: undefined, a_mm: 400, b_mm: 300, tipo_costura: 'PITTSBURGH' }]);
  assert.equal(otras.partidas[0].ok, true);
  assert.ok(!('yarda_mm' in otras.partidas[0].entrada), 'el codo no lleva ancho de yarda');
  assert.equal(otras.partidas[1].entrada.yarda_mm, 914, 'el tramo recto rectangular también se arma por yardas');
  // un número en texto vale (viene de un archivo)
  assert.equal(cot('914', [R]).partidas[0].entrada.yarda_mm, 914);
  // un ancho absurdo se ignora con un aviso: no se calcula con él
  [5000, 10, -914, 'abc', [914], {}, true, NaN].forEach((x) => {
    const r = cot(x, [R]);
    assert.equal(r.partidas[0].ok, true, String(x));
    assert.equal(r.partidas[0].entrada.yarda_mm, undefined, String(x));
    casi(r.partidas[0].precio.importe, c1220.partidas[0].precio.importe, 1e-12, String(x));
    assert.ok(r.avisos.some((a) => /Ancho de la yarda: .* no es válido \(debe estar entre 300 y 2000 mm\)/.test(a)), `aviso para ${String(x)}`);
  });
  assert.equal(cot(914, [R]).avisos.length, 0);
});

test('El resultado de cotizar() dice qué ancho de yarda rige en la cotización, y la función que lo decide se puede consultar', () => {
  const R = { ...rectoYardas };
  assert.equal(C.cotizar({ yarda_mm: 914, partidas: [R] }, M).yarda_mm, 914);
  assert.equal(C.cotizar({ yarda_mm: '914', partidas: [R] }, M).yarda_mm, 914, 'un texto numérico se convierte');
  assert.equal(C.cotizar({ partidas: [R] }, M).yarda_mm, undefined, 'sin ancho propio rige el de las tablas');
  assert.equal(C.cotizar({ yarda_mm: 5000, partidas: [R] }, M).yarda_mm, undefined, 'un ancho inválido no rige');
  // yardaDeCotizacion: { yarda_mm } si vale, { aviso } si no, {} si está vacío
  assert.deepEqual(C.yardaDeCotizacion({}, M), {});
  assert.deepEqual(C.yardaDeCotizacion({ yarda_mm: '' }, M), {});
  assert.deepEqual(C.yardaDeCotizacion({ yarda_mm: null }, M), {});
  assert.deepEqual(C.yardaDeCotizacion({ yarda_mm: 1220 }, M), { yarda_mm: 1220 });
  assert.deepEqual(C.yardaDeCotizacion({ yarda_mm: 300 }, M), { yarda_mm: 300 }, 'los límites son inclusivos');
  assert.deepEqual(C.yardaDeCotizacion({ yarda_mm: 2000 }, M), { yarda_mm: 2000 });
  [299.9, 2000.1, 0, -5, 'x', '', NaN, Infinity, [], {}, true].forEach((x) => {
    const r = C.yardaDeCotizacion({ yarda_mm: x }, M);
    if (x === '') assert.deepEqual(r, {});
    else {
      assert.equal(r.yarda_mm, undefined, String(x));
      assert.match(r.aviso, /Ancho de la yarda: .* no es válido \(debe estar entre 300 y 2000 mm\)/, String(x));
    }
  });
  // los límites salen de las tablas maestras
  const ancho = crearMaestros({ proceso: { limites: { yarda_max_mm: 1500 } } });
  assert.equal(C.yardaDeCotizacion({ yarda_mm: 1600 }, ancho).yarda_mm, undefined);
  assert.equal(C.yardaDeCotizacion({ yarda_mm: 1400 }, ancho).yarda_mm, 1400);
});

test('migrarPartida: el sí/no de la versión anterior pasa a extremo_ajuste sin tocar la partida recibida', () => {
  const V = require('../src/motor/validacion');
  const vieja = { familia: 'RECTO', ajuste_sin_brida: true };
  const nueva = V.migrarPartida(vieja);
  assert.deepEqual(nueva, { familia: 'RECTO', extremo_ajuste: 'SIN_BRIDA' });
  assert.deepEqual(vieja, { familia: 'RECTO', ajuste_sin_brida: true }, 'no muta la recibida');
  assert.equal(V.migrarPartida({ ajuste_sin_brida: false }).extremo_ajuste, 'CON_BRIDA');
  assert.equal(V.migrarPartida({ ajuste_sin_brida: false, extremo_ajuste: 'SUELTA' }).extremo_ajuste, 'SUELTA', 'lo nuevo manda');
  assert.equal(V.migrarPartida({ ajuste_sin_brida: false, extremo_ajuste: '' }).extremo_ajuste, 'CON_BRIDA', 'un vacío no cuenta como valor');
  ['no', 0, null, [], {}].forEach((x) => assert.deepEqual(V.migrarPartida({ ajuste_sin_brida: x }), {}, `${JSON.stringify(x)} se descarta`));
  // sin el campo viejo devuelve la misma partida; lo que no es una partida pasa tal cual
  const sin = { familia: 'CODO' };
  assert.equal(V.migrarPartida(sin), sin);
  [null, undefined, 5, 'x', []].forEach((x) => assert.equal(V.migrarPartida(x), x));
});
