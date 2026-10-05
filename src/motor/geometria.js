/**
 * COTIZAP · geometria.js — Motor geométrico.
 *
 * Cada familia devuelve un "perfil de fabricación" (PF) con las cantidades físicas que
 * necesitan los demás módulos: área desarrollada neta, longitudes de corte y soldadura,
 * número de piezas, extremos a unir, etc. Aquí NO hay precios ni tiempos.
 *
 * Convenciones:
 *  · D_nom = diámetro nominal según `ref_diametro` (INTERIOR por defecto).
 *  · D_med = D_int + e  (diámetro de la fibra neutra; es el que se desarrolla).
 *  · Longitudes en mm; áreas netas en m²; longitudes de proceso en m.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.geometria = factory(root.COTIZAP.util);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const { PI, rad, grados } = U;
  const sin = Math.sin;
  const cos = Math.cos;
  const tan = Math.tan;
  const sqrt = Math.sqrt;

  /* ------------------------------------------------------------------ */
  /* Dimensiones derivadas                                              */
  /* ------------------------------------------------------------------ */
  function dimensionesRedondas(D_nom_mm, e_mm, ref) {
    const exterior = ref === 'EXTERIOR';
    const D_int = exterior ? D_nom_mm - 2 * e_mm : D_nom_mm;
    return { D_int, D_med: D_int + e_mm, D_ext: D_int + 2 * e_mm };
  }

  function dimensionesRect(a_nom_mm, b_nom_mm, e_mm, ref) {
    const exterior = ref === 'EXTERIOR';
    const a_int = exterior ? a_nom_mm - 2 * e_mm : a_nom_mm;
    const b_int = exterior ? b_nom_mm - 2 * e_mm : b_nom_mm;
    return {
      a_int, b_int, a_med: a_int + e_mm, b_med: b_int + e_mm, a_ext: a_int + 2 * e_mm, b_ext: b_int + 2 * e_mm,
    };
  }

  const extremoRedondo = (d) => ({
    forma: 'REDONDA', D_ext_mm: d.D_ext, P_ext_mm: PI * d.D_ext, P_med_mm: PI * d.D_med,
  });

  const extremoRect = (d) => ({
    forma: 'RECTANGULAR', a_ext_mm: d.a_ext, b_ext_mm: d.b_ext,
    P_ext_mm: 2 * (d.a_ext + d.b_ext), P_med_mm: 2 * (d.a_med + d.b_med),
  });

  function nuevoPF(familia) {
    return {
      familia,
      A_neta_m2: 0,
      A_orificio_m2: 0,
      n_piezas: 1,
      n_virolas: 1,
      L_virola_m: 0,
      pasadas_rolado: null,
      k_rolado: 1,
      L_corte_m: 0,
      sold: { tope_m: 0, filete_m: 0 },
      engargolado_m: 0,
      n_juntas_internas: 0,
      extremos: [],
      espigas_defecto: 0,
      D_ref_mm: 0,
      A_ext_m2: 0,
      detalle: {},
      advertencias: [],
    };
  }

  function exigir(cond, msg) {
    if (!cond) throw new U.ErrorValidacion([msg]);
  }

  /* ------------------------------------------------------------------ */
  /* Integrales auxiliares                                              */
  /* ------------------------------------------------------------------ */

  /** (2/π)·E(k): promedio angular de √(1 − k² sin²φ). Integral elíptica completa normalizada. */
  function razonElipticaE(k) {
    return U.simpson((f) => sqrt(1 - (k * sin(f)) ** 2), 0, PI / 2, 200) / (PI / 2);
  }

  /** K(k) = A_orificio / (π r_b² / sinβ): corrección por curvatura del cuerpo principal. */
  function factorOrificio(k) {
    return (4 / PI) * U.simpson((ps) => cos(ps) ** 2 / sqrt(1 - (k * sin(ps)) ** 2), 0, PI / 2, 200);
  }

  /**
   * Área lateral (mm²) de un tronco de cono circular recto u oblicuo entre dos círculos paralelos.
   * r1 (base), r2 (tapa), L = distancia axial, c = desfase lateral entre centros.
   *   A = ((r1 + r2)/2) · ∫₀^{2π} √(L² + (Δr + c·cosφ)²) dφ ,   Δr = r2 − r1
   */
  function areaTroncoOblicuo(r1, r2, L, c) {
    const dr = r2 - r1;
    const mitad = U.simpson((f) => sqrt(L * L + (dr + c * cos(f)) ** 2), 0, PI, 360);
    return ((r1 + r2) / 2) * 2 * mitad;
  }

  /**
   * Transición redondo → rectángulo centrada (desarrollo estándar por triangulación):
   * 4 triángulos planos + 4 conos oblicuos con vértice en las esquinas.
   *   A = b·√(H² + (a/2 − r)²) + a·√(H² + (b/2 − r)²) + 2r·∫₀^{π/2} √(H² + (r − (a/2)cosφ − (b/2)sinφ)²) dφ
   */
  function areaTransicionRR(a, b, r, H) {
    const sx = sqrt(H * H + (a / 2 - r) ** 2);
    const sy = sqrt(H * H + (b / 2 - r) ** 2);
    const conos = 2 * r * U.simpson((f) => sqrt(H * H + (r - (a / 2) * cos(f) - (b / 2) * sin(f)) ** 2), 0, PI / 2, 240);
    return { total: b * sx + a * sy + conos, triangulos: b * sx + a * sy, conos };
  }

  /* ------------------------------------------------------------------ */
  /* Familias                                                           */
  /* ------------------------------------------------------------------ */

  function recto(p, e, M) {
    const PF = nuevoPF('RECTO');
    const forma = p.forma || 'REDONDA';
    const costura = M.proceso.costuras[p.tipo_costura || 'A_TOPE'];
    exigir(costura, `Tipo de costura desconocido: ${p.tipo_costura}`);
    exigir(p.L_mm > 0, 'La longitud total del tramo debe ser mayor que 0.');

    const L_total = p.L_mm;
    const L_max = p.L_max_pieza_mm || M.proceso.L_max_pieza_mm;
    const n_piezas = Math.max(1, Math.ceil(L_total / L_max - 1e-9));
    const L_pieza = L_total / n_piezas;
    const n_cost = forma === 'REDONDA' ? 1 : (p.n_costuras_long || 1);

    let P_med; let extremo;
    if (forma === 'REDONDA') {
      exigir(p.D_mm > 0, 'El diámetro debe ser mayor que 0.');
      const d = dimensionesRedondas(p.D_mm, e, p.ref_diametro);
      P_med = PI * d.D_med;
      extremo = extremoRedondo(d);
      PF.D_ref_mm = d.D_med;
      PF.detalle = { D_int_mm: d.D_int, D_med_mm: d.D_med, D_ext_mm: d.D_ext };
    } else {
      exigir(p.a_mm > 0 && p.b_mm > 0, 'Las dimensiones a × b deben ser mayores que 0.');
      const d = dimensionesRect(p.a_mm, p.b_mm, e, p.ref_diametro);
      P_med = 2 * (d.a_med + d.b_med);
      extremo = extremoRect(d);
      PF.D_ref_mm = P_med / PI;
      PF.detalle = { a_med_mm: d.a_med, b_med_mm: d.b_med, P_med_mm: P_med };
    }

    const B = P_med + n_cost * costura.allowance_mm;
    PF.A_neta_m2 = (B * L_total) / 1e6;
    PF.n_piezas = n_piezas;
    PF.n_virolas = n_piezas;
    PF.L_virola_m = L_pieza / 1000;
    PF.pasadas_rolado = forma === 'REDONDA' ? M.proceso.rolado.n_pasadas : M.proceso.rolado.n_pasadas_plegado;
    PF.L_corte_m = (n_piezas * 2 * (B + L_pieza)) / 1000;
    PF.extremos = Array.from({ length: 2 * n_piezas }, () => extremo);
    PF.espigas_defecto = n_piezas;
    PF.A_ext_m2 = (extremo.P_ext_mm * L_total) / 1e6;

    const L_costura_m = (n_cost * L_total) / 1000;
    if (costura.soldada) PF.sold[costura.cordon === 'TOPE' ? 'tope_m' : 'filete_m'] = L_costura_m;
    else PF.engargolado_m = L_costura_m;

    Object.assign(PF.detalle, {
      ancho_plantilla_mm: B, allowance_costura_mm: costura.allowance_mm, L_pieza_mm: L_pieza, n_costuras: n_cost,
    });
    return PF;
  }

  function codoRedondo(p, e, M) {
    const PF = nuevoPF('CODO');
    exigir(p.D_mm > 0, 'El diámetro debe ser mayor que 0.');
    const theta = rad(p.theta_deg || 90);
    exigir(theta > 0 && theta <= rad(180), 'El ángulo del codo debe estar entre 0° y 180°.');
    const alfa_max = rad(M.proceso.alfa_max_junta_deg);
    const j = p.n_gajos ? p.n_gajos - 1 : Math.max(1, Math.ceil(theta / alfa_max - 1e-9));
    exigir(j >= 1, 'Un codo segmentado necesita al menos 2 gajos.');
    const n_g = j + 1;
    const alfa = theta / j;
    const d = dimensionesRedondas(p.D_mm, e, p.ref_diametro);
    const k_R = p.k_R || M.proceso.k_R_defecto;
    exigir(k_R >= 1, 'La relación R/D debe ser ≥ 1.0.');
    const R = k_R * p.D_mm;
    const l_g = 2 * R * tan(alfa / 2);
    const L_eje = j * l_g;
    const L_tan = p.L_tangente_mm || 0;
    const L_tot = L_eje + 2 * L_tan;
    const kappa = sqrt(1 + tan(alfa / 2) ** 2 / 2);
    const P_j = PI * d.D_med * kappa;

    PF.A_neta_m2 = (PI * d.D_med * L_tot) / 1e6;
    PF.n_piezas = n_g;
    PF.n_virolas = n_g;
    PF.L_virola_m = L_tot / n_g / 1000;
    PF.k_rolado = 1;
    PF.L_corte_m = (PI * d.D_med * (2 * j * kappa + 2) + 2 * L_tot) / 1000;
    PF.sold.tope_m = (j * P_j + L_tot) / 1000;
    PF.n_juntas_internas = j;
    PF.extremos = [extremoRedondo(d), extremoRedondo(d)];
    PF.espigas_defecto = 2;
    PF.D_ref_mm = d.D_med;
    PF.A_ext_m2 = (PI * d.D_ext * L_tot) / 1e6;
    PF.detalle = {
      D_int_mm: d.D_int, D_med_mm: d.D_med, D_ext_mm: d.D_ext, n_gajos: n_g, n_juntas: j,
      alfa_deg: grados(alfa), R_mm: R, l_gajo_mm: l_g, L_eje_mm: L_eje, L_tangentes_mm: 2 * L_tan,
      F_arco: L_eje / (theta * R), lambda_L_eje_sobre_D: L_eje / p.D_mm, kappa_junta: kappa, P_junta_mm: P_j,
    };
    return PF;
  }

  function codoRect(p, e, M) {
    const PF = nuevoPF('CODO');
    exigir(p.a_mm > 0 && p.b_mm > 0, 'Las dimensiones a × b deben ser mayores que 0.');
    const theta = rad(p.theta_deg || 90);
    const d = dimensionesRect(p.a_mm, p.b_mm, e, p.ref_diametro);
    const k_R = p.k_R || M.proceso.k_R_defecto;
    exigir(k_R >= 0.5, 'La relación R/a debe ser ≥ 0.5.');
    const R = k_R * p.a_mm;
    const W = d.a_med;
    const H = d.b_med;
    const P_med = 2 * (W + H);
    PF.A_neta_m2 = (P_med * theta * R) / 1e6; // teorema de Pappus: exacto
    PF.n_piezas = 4;
    PF.n_virolas = 4;
    PF.L_virola_m = (theta * R) / 1000;
    PF.pasadas_rolado = 1;
    PF.L_corte_m = (8 * theta * R + 4 * (H + W)) / 1000;
    PF.sold.tope_m = (4 * theta * R) / 1000;
    PF.n_juntas_internas = 4;
    PF.extremos = [extremoRect(d), extremoRect(d)];
    PF.espigas_defecto = 2;
    PF.D_ref_mm = P_med / PI;
    PF.A_ext_m2 = (2 * (d.a_ext + d.b_ext) * theta * R) / 1e6;
    PF.detalle = { R_mm: R, arco_eje_mm: theta * R, P_med_mm: P_med, F_arco: 1 };
    return PF;
  }

  function reduccion(p, e, M) {
    const PF = nuevoPF('REDUCCION');
    exigir(p.D1_mm > 0 && p.D2_mm > 0, 'Los diámetros D1 y D2 deben ser mayores que 0.');
    const dA = dimensionesRedondas(p.D1_mm, e, p.ref_diametro);
    const dB = dimensionesRedondas(p.D2_mm, e, p.ref_diametro);
    const [grande, chico] = dA.D_med >= dB.D_med ? [dA, dB] : [dB, dA];
    const r1 = grande.D_med / 2;
    const r2 = chico.D_med / 2;
    const delta = r1 - r2;
    exigir(delta > 1e-9, 'D1 y D2 deben ser distintos para una reducción.');

    const semi_max = rad(M.proceso.semiangulo_max_deg);
    const L = p.L_mm || delta / tan(semi_max);
    exigir(L > 0, 'La longitud de la reducción debe ser mayor que 0.');
    const c = p.excentrica === 'CARA_PLANA' ? delta : 0;
    const A_mm2 = areaTroncoOblicuo(r1, r2, L, c);
    const dr = r2 - r1;
    const s_max = Math.max(sqrt(L * L + (dr + c) ** 2), sqrt(L * L + (dr - c) ** 2));
    const s_conc = sqrt(L * L + delta * delta);
    const semi = grados(Math.atan(delta / L));
    if (semi > M.proceso.semiangulo_max_deg + 1e-9) {
      PF.advertencias.push(`Semiángulo de la reducción ${semi.toFixed(1)}° excede el máximo recomendado (${M.proceso.semiangulo_max_deg}°): alargar la pieza.`);
    }

    PF.A_neta_m2 = A_mm2 / 1e6;
    PF.n_piezas = 1;
    PF.n_virolas = 1;
    PF.L_virola_m = s_max / 1000;
    PF.k_rolado = M.proceso.rolado.k_conico;
    PF.L_corte_m = (PI * (grande.D_med + chico.D_med) + 2 * s_max) / 1000;
    PF.sold.tope_m = s_max / 1000;
    PF.extremos = [extremoRedondo(grande), extremoRedondo(chico)];
    PF.espigas_defecto = 2;
    PF.D_ref_mm = (grande.D_med + chico.D_med) / 2;
    PF.detalle = {
      L_mm: L, semiangulo_deg: semi, generatriz_conc_mm: s_conc, generatriz_max_mm: s_max,
      A_concentrica_m2: (PI * (r1 + r2) * s_conc) / 1e6, F_excentricidad: A_mm2 / (PI * (r1 + r2) * s_conc),
      F_longitud: s_conc / L,
      patron: { sector_deg: grados((PI * (grande.D_med - chico.D_med)) / s_conc), R1_mm: (s_conc * grande.D_med) / (grande.D_med - chico.D_med), R2_mm: (s_conc * chico.D_med) / (grande.D_med - chico.D_med) },
    };
    return PF;
  }

  function transicion(p, e, M) {
    const PF = nuevoPF('TRANSICION');
    exigir(p.D_mm > 0 && p.a_mm > 0 && p.b_mm > 0, 'Diámetro y dimensiones a × b deben ser mayores que 0.');
    const dr = dimensionesRedondas(p.D_mm, e, p.ref_diametro);
    const dm = dimensionesRect(p.a_mm, p.b_mm, e, p.ref_diametro);
    const r = dr.D_med / 2;
    const a = dm.a_med;
    const b = dm.b_med;
    const semi_max = rad(M.proceso.semiangulo_max_deg);
    const H_def = Math.max(Math.max(Math.abs(a - dr.D_med), Math.abs(b - dr.D_med)) / (2 * tan(semi_max)), 0.5 * Math.max(a, b, dr.D_med));
    const H = p.H_mm || H_def;
    const n_cost = p.n_costuras_long || 2;

    const calc = areaTransicionRR(a, b, r, H);
    const P1 = 2 * (a + b);
    const P2 = PI * dr.D_med;
    const s_ref = (2 * calc.total) / (P1 + P2);
    const dif = Math.max(Math.abs(a - dr.D_med), Math.abs(b - dr.D_med)) / 2;
    const semi = grados(Math.atan(dif / H));
    if (semi > M.proceso.semiangulo_max_deg + 1e-9) {
      PF.advertencias.push(`Semiángulo equivalente de la transición ${semi.toFixed(1)}° excede el máximo recomendado (${M.proceso.semiangulo_max_deg}°).`);
    }

    PF.A_neta_m2 = calc.total / 1e6;
    PF.n_piezas = n_cost;
    PF.n_virolas = n_cost;
    PF.L_virola_m = s_ref / 1000;
    PF.k_rolado = M.proceso.rolado.k_conico;
    PF.L_corte_m = (P1 + P2 + 2 * n_cost * s_ref) / 1000;
    PF.sold.tope_m = (n_cost * s_ref) / 1000;
    PF.extremos = [extremoRedondo(dr), extremoRect(dm)];
    PF.espigas_defecto = 2;
    PF.D_ref_mm = (dr.D_med + P1 / PI) / 2;
    PF.detalle = {
      H_mm: H, H_defecto_mm: H_def, A_triangulos_m2: calc.triangulos / 1e6, A_conos_m2: calc.conos / 1e6,
      P_rect_mm: P1, P_redonda_mm: P2, generatriz_ref_mm: s_ref, semiangulo_equiv_deg: semi,
      A_aprox_semisuma_m2: (0.5 * (P1 + P2) * sqrt(H * H + ((P1 / PI - dr.D_med) / 2) ** 2)) / 1e6,
    };
    return PF;
  }

  /**
   * Injerto simple (id interno RAMAL): tronco recto de diámetro D con un injerto de diámetro d que entra a un ángulo β.
   * En el motor el tronco es el «cuerpo» y el injerto es el «ramal»; en el taller y en la interfaz, tronco e injerto.
   */
  function ramal(p, e, M) {
    const PF = nuevoPF('RAMAL');
    exigir(p.D_mm > 0 && p.d_mm > 0, 'Los diámetros del tronco y del injerto deben ser mayores que 0.');
    const dm = dimensionesRedondas(p.D_mm, e, p.ref_diametro);
    const db = dimensionesRedondas(p.d_mm, e, p.ref_diametro);
    const Rm = dm.D_med / 2;
    const rb = db.D_med / 2;
    const k = rb / Rm;
    exigir(k < 1, 'El injerto debe ser de menor diámetro que el tronco.');
    const beta_deg = p.beta_deg || M.proceso.beta_ramal_defecto_deg;
    exigir(beta_deg >= 20 && beta_deg <= 90, 'El ángulo del injerto β debe estar entre 20° y 90°.');
    const beta = rad(beta_deg);
    const t_med = (Rm / sin(beta)) * razonElipticaE(k);
    const t_max = (Rm + rb * cos(beta)) / sin(beta);
    const L_r = p.L_ramal_mm;
    exigir(L_r > t_max, `La longitud del injerto debe exceder ${t_max.toFixed(0)} mm (medida sobre su eje desde el eje del tronco).`);
    const L_c = p.L_cuerpo_mm;
    exigir(L_c > 0, 'La longitud del tronco debe ser mayor que 0.');
    if (L_c < (1.25 * 2 * rb) / sin(beta)) {
      PF.advertencias.push('El tramo recto del tronco es corto para alojar el injerto.');
    }
    if (k > 0.8) PF.advertencias.push('Relación d/D > 0.8: revisar el diseño; la entrada pierde el comportamiento de injerto.');

    const A_cuerpo = PI * dm.D_med * L_c;
    const A_ramal = PI * db.D_med * (L_r - t_med);
    const K = factorOrificio(k);
    const A_orificio = ((PI * rb * rb) / sin(beta)) * K;
    const P_h = PI * db.D_med * sqrt((1 + 1 / sin(beta) ** 2) / 2);
    const B_c = PI * dm.D_med + M.proceso.costuras.A_TOPE.allowance_mm;

    PF.A_neta_m2 = (A_cuerpo - A_orificio + A_ramal) / 1e6;
    PF.A_orificio_m2 = A_orificio / 1e6;
    PF.n_piezas = 2;
    PF.n_virolas = 2;
    PF.L_virola_m = (L_c + L_r) / 2 / 1000;
    PF.L_corte_m = (2 * (B_c + L_c) + P_h + 2 * (PI * db.D_med + L_r)) / 1000;
    PF.sold.tope_m = (L_c + (L_r - t_med)) / 1000;
    PF.sold.filete_m = P_h / 1000;
    PF.n_juntas_internas = 1;
    PF.extremos = [extremoRedondo(dm), extremoRedondo(dm), extremoRedondo(db)];
    PF.espigas_defecto = 3;
    PF.D_ref_mm = dm.D_med;
    PF.detalle = {
      D_med_mm: dm.D_med, d_med_mm: db.D_med, k_d_sobre_D: k, beta_deg, t_medio_mm: t_med, t_max_mm: t_max,
      A_cuerpo_m2: A_cuerpo / 1e6, A_ramal_m2: A_ramal / 1e6, K_orificio: K, P_orificio_mm: P_h,
    };
    return PF;
  }

  /**
   * Reducción con injerto: el tronco de diámetro mayor D1 lleva el injerto (diámetro d, a 30° o 45°, derecho o izquierdo)
   * y se cierra con un cono concéntrico hasta D2. Es una composición de dos piezas ya verificadas por separado:
   *   · injerto simple sobre un tramo recto de D1 (tronco − orificio + injerto)
   *   · reducción concéntrica D1 → D2 (tronco de cono)
   * más la costura circular que une el tramo recto con el cono. El lado (der/izq) sólo identifica la pieza: no cambia
   * ninguna cantidad, porque el injerto sale del mismo tronco redondo.
   */
  function reduccionInjerto(p, e, M) {
    const PF = nuevoPF('REDUCCION_INJERTO');
    exigir(p.D1_mm > 0 && p.D2_mm > 0 && p.d_mm > 0, 'Los diámetros del tronco (D1 y D2) y del injerto deben ser mayores que 0.');
    exigir(p.D2_mm < p.D1_mm, 'D2 debe ser menor que D1: el tronco se reduce de D1 a D2.');
    const permitidos = M.proceso.angulos_injerto_reduccion_deg;
    const beta_deg = p.beta_deg === undefined ? M.proceso.beta_ramal_defecto_deg : Number(p.beta_deg);
    exigir(permitidos.includes(beta_deg), `El injerto de la reducción es a ${permitidos.join('° o ')}°.`);
    const lado = p.lado === undefined ? 'DER' : p.lado;
    exigir(lado === 'DER' || lado === 'IZQ', 'El lado del injerto es derecho (DER) o izquierdo (IZQ).');

    const dT = dimensionesRedondas(p.D1_mm, e, p.ref_diametro);
    const dS = dimensionesRedondas(p.D2_mm, e, p.ref_diametro);
    const db = dimensionesRedondas(p.d_mm, e, p.ref_diametro);
    const beta = rad(beta_deg);
    // Largos automáticos (se pueden capturar): tramo recto mínimo para alojar el orificio con holgura, e injerto con
    // un tramo recto extra más allá de su generatriz más larga (así un cambio de ángulo nunca deja un injerto corto).
    const L_cuerpo_auto = (1.25 * db.D_med) / sin(beta);
    const L_cuerpo = p.L_cuerpo_mm > 0 ? p.L_cuerpo_mm : L_cuerpo_auto;
    const t_max = (dT.D_med / 2 + (db.D_med / 2) * cos(beta)) / sin(beta);
    const L_ramal_auto = t_max + M.proceso.injerto_largo_extra_mm;
    const L_ramal = p.L_ramal_mm > 0 ? p.L_ramal_mm : L_ramal_auto;
    const R = ramal({
      D_mm: p.D1_mm, d_mm: p.d_mm, L_cuerpo_mm: L_cuerpo, L_ramal_mm: L_ramal, beta_deg, ref_diametro: p.ref_diametro,
    }, e, M);
    const C = reduccion({
      D1_mm: p.D1_mm, D2_mm: p.D2_mm, L_mm: p.L_reduccion_mm, ref_diametro: p.ref_diametro, excentrica: 'NO',
    }, e, M);

    PF.A_neta_m2 = R.A_neta_m2 + C.A_neta_m2;
    PF.A_orificio_m2 = R.A_orificio_m2;
    PF.n_piezas = R.n_piezas + C.n_piezas;
    PF.n_virolas = R.n_virolas + C.n_virolas;
    // El rolado se calcula con un solo (L_virola, k_rolado): se promedian ponderando por longitud rolada, de modo que
    // n · k · L conserve el trabajo de rolado de cada pieza (cilindros k = 1, cono k = k_conico).
    const rolado_m = R.n_virolas * R.L_virola_m + C.n_virolas * C.L_virola_m;
    PF.L_virola_m = rolado_m / PF.n_virolas;
    PF.k_rolado = (R.n_virolas * R.k_rolado * R.L_virola_m + C.n_virolas * C.k_rolado * C.L_virola_m) / rolado_m;
    PF.L_corte_m = R.L_corte_m + C.L_corte_m;
    PF.sold.tope_m = R.sold.tope_m + C.sold.tope_m + (PI * dT.D_med) / 1000; // + costura circular tronco–cono
    PF.sold.filete_m = R.sold.filete_m;
    PF.n_juntas_internas = R.n_juntas_internas + 1; // silleta del injerto + unión tronco–cono
    PF.extremos = [extremoRedondo(dT), extremoRedondo(dS), extremoRedondo(db)];
    PF.espigas_defecto = 3;
    PF.D_ref_mm = (R.D_ref_mm * R.A_neta_m2 + C.D_ref_mm * C.A_neta_m2) / PF.A_neta_m2;
    PF.detalle = {
      ...R.detalle,
      L_cuerpo_mm: L_cuerpo,
      L_cuerpo_auto_mm: L_cuerpo_auto,
      L_ramal_mm: L_ramal,
      L_ramal_auto_mm: L_ramal_auto,
      L_reduccion_mm: C.detalle.L_mm,
      semiangulo_deg: C.detalle.semiangulo_deg,
      generatriz_max_mm: C.detalle.generatriz_max_mm,
      A_cono_m2: C.A_neta_m2,
      lado,
    };
    PF.advertencias.push(...R.advertencias, ...C.advertencias);
    return PF;
  }

  function pantalon(p, e, M) {
    const PF = nuevoPF('PANTALON');
    exigir(p.D_mm > 0 && p.d1_mm > 0 && p.d2_mm > 0, 'Diámetros del tronco y de los dos ramales deben ser mayores que 0.');
    const dT = dimensionesRedondas(p.D_mm, e, p.ref_diametro);
    const d1 = dimensionesRedondas(p.d1_mm, e, p.ref_diametro);
    const d2 = dimensionesRedondas(p.d2_mm, e, p.ref_diametro);
    exigir(p.L_tronco_mm > 0 && p.L1_mm > 0 && p.L2_mm > 0, 'Las longitudes del tronco y de los ramales deben ser mayores que 0.');
    const k_ent = p.k_entrepierna === undefined ? M.proceso.k_entrepierna : p.k_entrepierna;
    const A_tronco = PI * dT.D_med * p.L_tronco_mm;
    const A_r1 = PI * d1.D_med * p.L1_mm;
    const A_r2 = PI * d2.D_med * p.L2_mm;
    const razon = (d1.D_int ** 2 + d2.D_int ** 2) / dT.D_int ** 2;
    if (Math.abs(razon - 1) > M.proceso.tolerancia_area_pantalon) {
      PF.advertencias.push(`La suma de áreas de los ramales es ${(razon * 100).toFixed(0)} % del área del tronco: no conserva sección (se espera d1² + d2² ≈ D²).`);
    }

    PF.A_neta_m2 = (A_tronco + (A_r1 + A_r2) * (1 + k_ent)) / 1e6;
    PF.n_piezas = 3;
    PF.n_virolas = 3;
    PF.L_virola_m = (p.L_tronco_mm + p.L1_mm + p.L2_mm) / 3 / 1000;
    PF.L_corte_m = (2 * (PI * dT.D_med + p.L_tronco_mm) + 2 * (PI * d1.D_med + p.L1_mm) + 2 * (PI * d2.D_med + p.L2_mm) + PI * (d1.D_med + d2.D_med)) / 1000;
    PF.sold.tope_m = (p.L_tronco_mm + p.L1_mm + p.L2_mm) / 1000;
    PF.sold.filete_m = (PI * (d1.D_med + d2.D_med)) / 1000;
    PF.n_juntas_internas = 2;
    PF.extremos = [extremoRedondo(dT), extremoRedondo(d1), extremoRedondo(d2)];
    PF.espigas_defecto = 3;
    PF.D_ref_mm = dT.D_med;
    PF.detalle = { k_entrepierna: k_ent, razon_areas_ramales_tronco: razon, A_tronco_m2: A_tronco / 1e6, A_ramales_m2: (A_r1 + A_r2) / 1e6 };
    PF.advertencias.push('Familia retirada: sustituya el pantalón por una Reducción con injerto. Se conserva sólo para abrir cotizaciones anteriores (geometría aproximada, ±10 %).');
    return PF;
  }

  function personalizado(p, e, M) {
    const PF = nuevoPF('PERSONALIZADO');
    exigir(p.A_neta_m2 > 0, 'El área neta de la pieza personalizada debe ser mayor que 0.');
    const n_ext = p.n_extremos === undefined ? 0 : p.n_extremos;
    const D_ref = p.D_ref_mm || 0;
    exigir(n_ext === 0 || D_ref > 0, 'Indicar el diámetro de referencia de los extremos (D_ref_mm).');
    const dRef = D_ref ? dimensionesRedondas(D_ref, e, p.ref_diametro) : null;
    PF.A_neta_m2 = p.A_neta_m2;
    PF.n_piezas = p.n_piezas || 1;
    PF.n_virolas = p.n_virolas === undefined ? PF.n_piezas : p.n_virolas;
    PF.L_virola_m = p.L_virola_m || 1;
    PF.L_corte_m = p.L_corte_m || 0;
    PF.sold.tope_m = p.L_sold_tope_m || 0;
    PF.sold.filete_m = p.L_sold_filete_m || 0;
    PF.extremos = Array.from({ length: n_ext }, () => extremoRedondo(dRef));
    PF.espigas_defecto = n_ext;
    PF.D_ref_mm = dRef ? dRef.D_med : 0;
    PF.detalle = { origen: 'Cantidades capturadas manualmente (p. ej. desarrollo CAD)' };
    return PF;
  }

  /** Despachador por familia. */
  function perfilFabricacion(p, e, M) {
    let PF;
    switch (p.familia) {
      case 'RECTO': PF = recto(p, e, M); break;
      case 'CODO': PF = (p.forma === 'RECTANGULAR' ? codoRect(p, e, M) : codoRedondo(p, e, M)); break;
      case 'REDUCCION': PF = reduccion(p, e, M); break;
      case 'TRANSICION': PF = transicion(p, e, M); break;
      case 'RAMAL': PF = ramal(p, e, M); break;
      case 'REDUCCION_INJERTO': PF = reduccionInjerto(p, e, M); break;
      case 'PANTALON': PF = pantalon(p, e, M); break; // retirada: sólo para abrir cotizaciones anteriores
      case 'PERSONALIZADO': PF = personalizado(p, e, M); break;
      default: throw new U.ErrorValidacion([`Familia desconocida: ${p.familia}`]);
    }
    // Superficie exterior (pintura): exacta en recto y codo; en el resto A_ext ≈ A_neta · (D_ref + e)/D_ref
    if (!(PF.A_ext_m2 > 0)) PF.A_ext_m2 = PF.D_ref_mm > 0 ? PF.A_neta_m2 * (1 + e / PF.D_ref_mm) : PF.A_neta_m2;
    return PF;
  }

  return {
    perfilFabricacion,
    dimensionesRedondas,
    dimensionesRect,
    areaTroncoOblicuo,
    areaTransicionRR,
    razonElipticaE,
    factorOrificio,
    familias: { recto, codoRedondo, codoRect, reduccion, transicion, ramal, reduccionInjerto, pantalon, personalizado },
  };
}));
