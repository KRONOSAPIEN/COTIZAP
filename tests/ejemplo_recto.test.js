'use strict';
/**
 * VECTOR DE PRUEBA (golden test) — Ejemplo A del documento de arquitectura.
 *
 * Tramo recto de 3 m · Ø12" (interior) · calibre 16 · acero al carbón · bridado (estándar del taller: solera 1½" × 3/16",
 * barreno Ø3/8", tornillo 5/16" × 1¼") · sellado clase C · primario · servicio POLVO · riesgo MEDIO · 1 pieza.
 * Armado por yardas de 4 ft (1 220 mm): 3 000 mm = 2 yardas completas + un tramo de ajuste de 560 mm, engargolados en una
 * sola pieza; el extremo del ajuste va sin brida (se corta en campo), así que la pieza lleva UNA brida.
 *
 * El oráculo recalcula TODO paso a paso con aritmética directa (sin llamar a las funciones del motor)
 * y compara contra la salida del motor. Los valores monetarios dependen de las tablas maestras
 * (mano de obra a $500/h, lista del proveedor, valores ilustrativos): si se cambian, este vector debe regenerarse.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');

const M = crearMaestros();
const PI = Math.PI;
const P = M.precios;

const casi = (real, esperado, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(real - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${msg} esperado ${esperado}, obtenido ${real}`);
};

function interp(tabla, x) {
  if (x <= tabla[0][0]) return tabla[0][1];
  for (let i = 1; i < tabla.length; i += 1) {
    if (x <= tabla[i][0]) {
      const [x0, y0] = tabla[i - 1];
      const [x1, y1] = tabla[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tabla[tabla.length - 1][1];
}

const entrada = {
  familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, D_mm: 12 * 25.4, L_mm: 3000, tipo_costura: 'A_TOPE',
  tipo_union: 'BRIDADO', clase_sellado: 'C', pintura: 'PRIMARIO', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 1,
};

test('Ejemplo A — recálculo independiente paso a paso', () => {
  const r = C.cotizarPartida(entrada, M);

  /* Paso 1 · espesor y diámetros */
  const e = 0.0598 * 25.4;
  const D_int = 304.8;
  const D_med = D_int + e;
  const D_ext = D_int + 2 * e;
  casi(r.espesor_mm, e);

  /* Paso 2 · armado por yardas: 3 000 mm con yardas de 1 220 mm = 2 yardas + un tramo de ajuste de 560 mm (3 anillos, 1 pieza) */
  const Y = 1220;
  const anillos = [1220, 1220, 560];
  const n_anillos = anillos.length;
  const L_capa = anillos.reduce((a, x) => a + x, 0);
  assert.equal(L_capa, 3000);
  const n_juntas = n_anillos - 1;               // juntas engargoladas entre los anillos de la pieza
  const n_bridas = 1;                           // la pieza trae el ajuste: su extremo libre va sin brida
  assert.equal(r.geometria.n_piezas, 1);
  assert.equal(r.geometria.n_virolas, n_anillos);
  assert.equal(r.geometria.extremos.length, n_bridas);

  /* Paso 3 · desarrollo (plantilla) y área neta */
  const P_med = PI * D_med;
  const B = P_med + 1.0;
  const A = (B * L_capa) / 1e6;
  casi(r.geometria.A_neta_m2, A);

  /* Paso 4 · peso neto */
  const kg_m2 = (7850 * e) / 1000;
  const m_neta = A * kg_m2;
  casi(r.qto.lam.m_neta_kg, m_neta);

  /* Paso 5 · merma (φ = 8 %) y peso bruto */
  const phi = 0.08;
  const m_bruta = m_neta / (1 - phi);
  casi(r.qto.lam.m_bruta_kg, m_bruta);
  const costo_lamina = m_bruta * P.precio_kg_acero_carbon;

  /* Paso 6 · aro de brida: solera 1½" × 3/16" rolada de canto (centroide y barreno al centro del ancho) */
  const ancho = 38.1; const esp = 4.763; const gramil = ancho / 2;
  const w = (ancho * esp * 7.85) / 1000;
  const c = ancho / 2;
  const L_aro = PI * (D_ext + 2 * c) + 3.0;
  const m_aros_neta = (n_bridas * L_aro * w) / 1000;
  const m_aros_bruta = m_aros_neta / (1 - 0.05);
  casi(r.qto.her.m_aros_neta_kg, m_aros_neta);
  casi(r.qto.her.m_aros_bruta_kg, m_aros_bruta);
  // la solera estándar se cotiza por barra y con IVA: $/kg = (precio / (1 + IVA)) / (kg/m · largo de la barra)
  const barra = M.proveedor.barras.SOL_1_1_2X3_16;
  const precio_kg_solera = (barra.precio / (1 + M.proveedor.iva_incluido_pct)) / (w * (barra.largo_mm / 1000));
  const costo_perfiles = m_aros_bruta * precio_kg_solera;

  /* Paso 7 · tornillería: 8 por junta; cada brida aporta media junta; reserva 5 % */
  const P_perno = PI * (D_ext + 2 * gramil);
  const n_tornillos = Math.ceil(Math.max(4, Math.ceil(P_perno / 150 - 1e-9)) / 4 - 1e-9) * 4;
  assert.equal(n_tornillos, 8);
  const juntas_asignadas = n_bridas * 0.5;
  const costo_tornilleria = n_tornillos * juntas_asignadas * 1.05 * P.precio_juego_tornillo_5_16_x_1_1_4;

  /* Paso 8 · empaque (media junta por brida · perímetro de tornillos · 1.05) */
  const L_emp = (juntas_asignadas * P_perno * 1.05) / 1000;
  const costo_empaque = L_emp * P.precio_m_empaque_neopreno;

  /* Paso 9 · sellador clase C: media junta por brida + las juntas engargoladas entre yardas (también son transversales) */
  const L_eng_circ = (n_juntas * P_med) / 1000;
  const L_sel = (juntas_asignadas * PI * D_ext) / 1000 + L_eng_circ;
  casi(r.qto.her.L_sellado_m, L_sel);
  const V_sel = L_sel * 20 * 1.15;
  const costo_sellador = V_sel * (P.precio_cartucho_sellador_300ml / 300);

  /* Paso 10 · flete de entrada sobre lámina y perfil */
  const costo_flete = 0.02 * (costo_lamina + costo_perfiles);

  /* Paso 11 · longitudes de proceso */
  // Corte: la yarda es el ancho de la hoja, así que cada yarda completa sale con un tajo de 1 220 mm;
  // el tramo de ajuste (560 mm) necesita el corte a lo largo de la hoja (B) y su tajo de 560 mm.
  const L_corte = (2 * 1220 + B + 560) / 1000;
  const L_tope = 3.0;                           // costura longitudinal: una por anillo, 3 m en total
  const L_fil = (n_bridas * PI * D_ext) / 1000; // filete aro–ducto (continuo)
  const L_cierres = (n_bridas * ancho) / 1000;  // cierre del aro: una sección de solera
  const L_sold = L_tope + L_fil + L_cierres;
  casi(r.qto.tmp.detalle.L_soldadura_m, L_sold);

  /* Paso 12 · tiempos estándar (min) */
  const A_hoja = (Y * 3048) / 1e6;              // la hoja es del ancho de la yarda
  const A_bruta = m_bruta / kg_m2;
  const t_corte = (A_bruta / A_hoja) * 4.0 + L_corte / interp([[0.5, 9], [1.5, 8], [3.0, 6], [6.0, 3.5]], e);
  // cada yarda se rola por separado: 3 anillos, 3 m rolados en total
  const v_rol = interp([[0.6, 8], [1.0, 7], [1.5, 6], [2.0, 5], [3.0, 3.5], [4.5, 2.5]], e);
  const t_rolado = n_anillos * 3.0 + (3 * 1 * (L_capa / 1000)) / v_rol;
  const t_armado = 1.0 * (1 * 6.0 + 0 * 0 + n_bridas * 4.0);
  const t_aros = n_bridas * (4.0 + 2.5 * (L_aro / 1000));
  const tablaVs = [[0.6, 0.9], [1.0, 0.7], [1.5, 0.5], [2.0, 0.42], [3.0, 0.32], [4.5, 0.24]];
  const v_sold = interp(tablaVs, e) * 1.0;
  const v_cierre = interp(tablaVs, esp) * 1.0;   // el cierre se suelda en el espesor de la solera
  const t_arco = (L_tope + L_fil) / v_sold + L_cierres / v_cierre;
  const t_sold = (t_arco / 0.4) * 1.0;
  // engargolado: la costura longitudinal es a tope (soldada), así que sólo las 2 juntas entre yardas
  const v_eng = interp([[0.5, 3.0], [1.0, 2.5], [1.5, 1.8], [2.0, 1.2]], e);
  const t_eng = n_juntas * 2.0 + L_eng_circ / v_eng;
  const t_barren = n_bridas * n_tornillos * 0.35;
  const t_acab = 0.25 * t_sold;
  const A_aro_pint = ((PI / 2) * ((D_ext + 2 * ancho) ** 2 - D_ext ** 2) + PI * (D_ext + 2 * ancho) * esp) / 1e6;
  const A_pint = (PI * D_ext * L_capa) / 1e6 + n_bridas * A_aro_pint;
  const t_pint = A_pint * (4.0 + 1 * 3.0);
  const t_qc = 3.0 + 0.05 * (m_neta + m_aros_neta);
  const T = r.qto.tmp.unitarios_min;
  casi(T.corte, t_corte); casi(T.rolado, t_rolado); casi(T.armado, t_armado); casi(T.aros, t_aros);
  casi(T.soldadura, t_sold); casi(T.engargolado, t_eng); casi(T.barrenado, t_barren); casi(T.acabado, t_acab); casi(T.pintura, t_pint);
  casi(T.qc_embalaje, t_qc);

  /* Paso 13 · consumibles */
  const A_tope = Math.max(2.0, 1.75 * e * e);
  const A_fil = Math.max(2.0, 1.0 * e * e);
  const A_cierre = Math.max(2.0, 1.75 * esp * esp);  // cordón a tope en el espesor de la solera
  const kg_alambre = ((L_tope * A_tope + L_fil * A_fil + L_cierres * A_cierre) * 7.85) / 1000 / 0.93;
  const V_gas = (t_arco * 15 * 1.1) / 1000;
  const costo_alambre = kg_alambre * P.precio_kg_alambre_er70s6;
  const costo_gas = V_gas * P.precio_m3_gas_mezcla_ar_co2;
  const costo_corte = L_corte * P.precio_m_corte_guillotina;
  const litros = A_pint / (((10 * 55) / 50) * 0.65);
  const costo_pintura = litros * P.precio_L_primario + litros * 0.1 * P.precio_L_diluyente;

  /* Paso 14 · mano de obra y equipo (η = 0.80) */
  // los trabajadores ganan $500 por hora y esa cifra ya incluye las prestaciones: FSR = 1.00
  const FSR = 1.0;
  const tar = (s_, eq) => ({ mo: s_ * FSR, eq });
  const ops = {
    corte: [t_corte, tar(500, 45)], rolado: [t_rolado, tar(500, 55)], armado: [t_armado, tar(500, 25)], aros: [t_aros, tar(500, 40)],
    soldadura: [t_sold, tar(500, 45)], engargolado: [t_eng, tar(500, 35)], barrenado: [t_barren, tar(500, 25)], acabado: [t_acab, tar(500, 20)],
    pintura: [t_pint, tar(500, 40)], qc_embalaje: [t_qc, tar(500, 0)],
  };
  let MO = 0; let EQ = 0; let hMOD = 0;
  Object.values(ops).forEach(([t, tr]) => {
    const h = t / 0.8 / 60;
    MO += h * tr.mo; EQ += h * tr.eq; hMOD += h;
  });
  const HM = 0.03 * MO;

  /* Paso 15 · costo directo */
  const CD = costo_lamina + costo_perfiles + costo_tornilleria + costo_empaque + costo_sellador + costo_flete
    + costo_alambre + costo_gas + costo_corte + costo_pintura + MO + EQ + HM;
  casi(r.costos.CD, CD, 1e-9, 'CD');
  casi(r.costos.h_MOD, hMOD, 1e-9, 'h_MOD');

  /* Paso 16 · pila de precio */
  const CI = 85.0 * hMOD + 0.08 * CD;
  const IMP = 0.04 * (CD + CI);
  const C_T = CD + CI + IMP;
  const FIN = C_T * ((0.14 * 45) / 365);
  const precio = (C_T + FIN) / (1 - 0.2 - 0.02 - 0.0);
  casi(r.pila.CI, CI, 1e-9, 'CI');
  casi(r.pila.imprevistos, IMP, 1e-9, 'imprevistos');
  casi(r.pila.C_T, C_T, 1e-9, 'C_T');
  casi(r.pila.financiamiento, FIN, 1e-9, 'financiamiento');
  casi(r.pila.precio, precio, 1e-9, 'precio');
  assert.equal(r.precio.unitario, Math.round(precio * 100) / 100);
  assert.equal(r.precio.importe, r.precio.unitario);

  /* Identidad de la pila: precio = costo base + utilidad + comisión + otros */
  casi(r.pila.C_base + r.pila.utilidad + r.pila.comision + r.pila.otros, r.pila.precio, 1e-12);
  casi(r.pila.utilidad / r.pila.precio, 0.2, 1e-12);
});

test('Ejemplo A — con brida en ambos extremos el tramo lleva dos aros y cuesta más (pero no cambia la lámina)', () => {
  const uno = C.cotizarPartida(entrada, M);
  const dos = C.cotizarPartida({ ...entrada, ajuste_sin_brida: false }, M);
  assert.equal(uno.qto.her.n_aros, 1);
  assert.equal(dos.qto.her.n_aros, 2);
  casi(dos.qto.her.m_aros_neta_kg, 2 * uno.qto.her.m_aros_neta_kg, 1e-12);
  casi(dos.geometria.A_neta_m2, uno.geometria.A_neta_m2, 1e-12);
  casi(dos.costos.materiales.lamina, uno.costos.materiales.lamina, 1e-12);
  assert.ok(dos.precio.unitario > uno.precio.unitario);
});

test('Ejemplo A — la merma NO se omite: con φ=0 el costo de lámina baja exactamente φ', () => {
  const con = C.cotizarPartida(entrada, M);
  const sin = C.cotizarPartida({ ...entrada, merma_pct: 0 }, M);
  casi(sin.costos.materiales.lamina, con.costos.materiales.lamina * (1 - 0.08), 1e-12);
  assert.ok(sin.precio.unitario < con.precio.unitario);
});

/* Vector de referencia: coincide con las cifras del Ejemplo A del documento de arquitectura. */
const GOLDEN = {
  espesor_mm: 1.5189,
  D_med_mm: 306.3189,
  ancho_plantilla_mm: 963.329,
  A_neta_m2: 2.89,
  m_neta_kg: 34.459,
  m_bruta_kg: 37.455,
  n_anillos: 3,
  n_piezas: 1,
  n_aros: 1,
  L_aro_mm: 1089.8,
  n_tornillos: 8,
  horas_mod_reales: 1.878,
  CD: 2119.08,
  C_T: 2546.2,
  precio_unitario: 3320.71,
};

test('Ejemplo A — vector de referencia (valores redondeados que cita el documento)', () => {
  const r = C.cotizarPartida(entrada, M);
  const f = (x, d) => Number(x.toFixed(d));
  assert.deepEqual({
    espesor_mm: f(r.espesor_mm, 4),
    D_med_mm: f(r.geometria.detalle.D_med_mm, 4),
    ancho_plantilla_mm: f(r.geometria.detalle.ancho_plantilla_mm, 3),
    A_neta_m2: f(r.geometria.A_neta_m2, 4),
    m_neta_kg: f(r.qto.lam.m_neta_kg, 3),
    m_bruta_kg: f(r.qto.lam.m_bruta_kg, 3),
    n_anillos: r.geometria.n_virolas,
    n_piezas: r.geometria.n_piezas,
    n_aros: r.qto.her.n_aros,
    L_aro_mm: f(r.qto.her.aros[0].L_aro_mm, 1),
    n_tornillos: r.qto.her.aros[0].n_tornillos,
    horas_mod_reales: f(r.costos.h_MOD, 3),
    CD: f(r.costos.CD, 2),
    C_T: f(r.pila.C_T, 2),
    precio_unitario: r.precio.unitario,
  }, GOLDEN);
});

