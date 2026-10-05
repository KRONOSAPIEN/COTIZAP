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

const recto = {
  familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO',
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
  const mo_h = (480 * 1.55) / 8;
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

test('Costura soldada vs engargolada: Pittsburgh no suelda la costura y suma tiempo de engargolado', () => {
  const sol = C.cotizarPartida({ ...recto, material_id: 'GALVANIZADO', calibre: 20, servicio: 'VENTILACION', tipo_union: 'ESPIGA' }, M);
  const eng = C.cotizarPartida({ ...recto, material_id: 'GALVANIZADO', calibre: 20, servicio: 'VENTILACION', tipo_union: 'ESPIGA', tipo_costura: 'PITTSBURGH' }, M);
  assert.equal(sol.qto.tmp.unitarios_min.engargolado, 0);
  assert.ok(eng.qto.tmp.unitarios_min.engargolado > 0);
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
