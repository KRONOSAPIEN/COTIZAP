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
    exigir(D_int > 0, `El diámetro exterior (${D_nom_mm} mm) debe ser mayor que el doble del espesor (${2 * e_mm} mm): con esa medida no existe el diámetro interior.`);
    return { D_int, D_med: D_int + e_mm, D_ext: D_int + 2 * e_mm };
  }

  function dimensionesRect(a_nom_mm, b_nom_mm, e_mm, ref) {
    const exterior = ref === 'EXTERIOR';
    const a_int = exterior ? a_nom_mm - 2 * e_mm : a_nom_mm;
    const b_int = exterior ? b_nom_mm - 2 * e_mm : b_nom_mm;
    exigir(a_int > 0 && b_int > 0, `Los lados exteriores a × b deben ser mayores que el doble del espesor (${2 * e_mm} mm): con esa medida no existe el interior.`);
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

  /** Protección del motor, aunque los maestros no traigan límites: ningún arreglo de extremos o piezas pasa de esto. */
  const TOPE_PIEZAS = 100000;

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
      engargolado_m: 0, // total (longitudinal + entre yardas): lo que se cobra en tiempo de engargolado
      engargolado_long_m: 0, // costura longitudinal engargolada (Pittsburgh)
      engargolado_circ_m: 0, // juntas engargoladas entre yardas (transversales: se sellan en toda clase de sellado)
      n_engargolados: null, // operaciones de engargolado (una por costura o junta); null = una por pieza
      ancho_hoja_mm: 0, // ancho de la hoja de la que sale la pieza (0 = el de la hoja estándar): en el tramo recto es la yarda
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

  /** Cuántas yardas completas caben en `L` y cuánto sobra como tramo de ajuste (con la tolerancia). Es barato: no arma nada. */
  function partirEnYardas(L, Y, tol) {
    const n_completas = Math.floor((L + tol) / Y);
    let ajuste = L - n_completas * Y;
    if (n_completas === 0) ajuste = L; // un tramo más corto que una yarda es todo tramo de ajuste
    else if (ajuste <= tol) ajuste = 0; // a ±tol de un múltiplo: son yardas completas
    return { n_completas, ajuste };
  }

  /**
   * Armado de un tramo recto por «yardas», como lo hace el taller. Una yarda es un anillo rolado del ANCHO de la lámina
   * (914 mm = 3 ft ó 1 220 mm = 4 ft): así se aprovecha toda la hoja.
   *   · Las yardas se engargolan entre sí en piezas de hasta `maxY` (3): primero salen las piezas de 3 yardas.
   *   · Lo que falta son las yardas completas que sobren (0, 1 ó 2) y un tramo de ajuste —menos de una yarda— engargolado a ellas.
   *   · Cada pieza lleva brida en ambos extremos, menos la que trae el tramo de ajuste: su extremo libre va SIN brida, para
   *     cortarlo y ponerlo en campo ajustando la distancia (`sinBridaEnAjuste` = false pide brida en ambos).
   * `tol` (mm): un sobrante menor que esto no es tramo de ajuste (a ±tol de un múltiplo de la yarda se cuentan yardas completas).
   * Devuelve { yarda_mm, largo_mm, n_completas, ajuste_mm, L_capa_mm, anillos: [mm…], piezas: [{ yardas, ajuste_mm, n_anillos,
   * largo_mm, bridas, juntas }], n_anillos, n_piezas, n_bridas, n_juntas, extremo_libre }.
   */
  function distribuirYardas(L, Y, maxY, tol, sinBridaEnAjuste) {
    const tope = Math.max(1, Math.floor(maxY));
    const { n_completas, ajuste } = partirEnYardas(L, Y, tol);
    const grupos = [];
    for (let i = 0; i < Math.floor(n_completas / tope); i += 1) grupos.push({ yardas: tope, ajuste_mm: 0 });
    const sobran = n_completas % tope;
    if (sobran > 0 || ajuste > 0) grupos.push({ yardas: sobran, ajuste_mm: ajuste });
    const anillos = [];
    const piezas = grupos.map((g) => {
      const n_anillos = g.yardas + (g.ajuste_mm > 0 ? 1 : 0);
      for (let j = 0; j < g.yardas; j += 1) anillos.push(Y);
      if (g.ajuste_mm > 0) anillos.push(g.ajuste_mm);
      return {
        yardas: g.yardas, ajuste_mm: g.ajuste_mm, n_anillos, largo_mm: g.yardas * Y + g.ajuste_mm, bridas: g.ajuste_mm > 0 && sinBridaEnAjuste ? 1 : 2, juntas: n_anillos - 1,
      };
    });
    const suma = (campo) => piezas.reduce((acc, q) => acc + q[campo], 0);
    return {
      yarda_mm: Y,
      largo_mm: L,
      n_completas,
      ajuste_mm: ajuste,
      L_capa_mm: anillos.reduce((acc, x) => acc + x, 0),
      anillos,
      piezas,
      n_anillos: anillos.length,
      n_piezas: piezas.length,
      n_bridas: suma('bridas'),
      n_juntas: suma('juntas'),
      extremo_libre: ajuste > 0 && sinBridaEnAjuste,
    };
  }

  function recto(p, e, M) {
    const PF = nuevoPF('RECTO');
    const forma = p.forma || 'REDONDA';
    const costura = M.proceso.costuras[p.tipo_costura || 'A_TOPE'];
    exigir(costura, `Tipo de costura desconocido: ${p.tipo_costura}`);
    exigir(p.L_mm > 0, 'La longitud total del tramo debe ser mayor que 0.');

    const AY = M.proceso.armado_yardas;
    const Y = p.yarda_mm || AY.yarda_defecto_mm;
    exigir(Y > 0, 'El ancho de la yarda debe ser mayor que 0.');
    exigir(AY.yardas_por_pieza_max >= 1, 'En las tablas maestras, las yardas por pieza deben ser al menos 1.');
    const junta = M.proceso.costuras[AY.junta_entre_yardas];
    exigir(junta, `En las tablas maestras, la junta entre yardas «${AY.junta_entre_yardas}» no es un tipo de costura conocido.`);
    const L_total = p.L_mm;
    // Antes de armar nada: cuántos anillos saldrían (un arreglo desorbitado no se construye)
    const tope = Math.min(M.proceso.limites && M.proceso.limites.piezas_max > 0 ? M.proceso.limites.piezas_max : Infinity, TOPE_PIEZAS);
    const cuenta = partirEnYardas(L_total, Y, AY.ajuste_tolerancia_mm);
    const n_cuenta = cuenta.n_completas + (cuenta.ajuste > 0 ? 1 : 0);
    exigir(n_cuenta <= tope, `Un tramo de ${L_total} mm en yardas de ${Y} mm serían ${n_cuenta} anillos (el máximo es ${tope}): revise la longitud total y el ancho de la yarda.`);
    const arm = distribuirYardas(L_total, Y, AY.yardas_por_pieza_max, AY.ajuste_tolerancia_mm, p.ajuste_sin_brida !== false);
    const L_capa = arm.L_capa_mm; // lo que realmente se corta: las yardas completas y el ajuste
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

    const B = P_med + n_cost * costura.allowance_mm; // plantilla de un anillo: perímetro medio + holgura de la costura longitudinal
    PF.A_neta_m2 = (B * L_capa) / 1e6;
    PF.n_piezas = arm.n_piezas;
    PF.n_virolas = arm.n_anillos; // cada yarda se rola por separado
    PF.L_virola_m = L_capa / arm.n_anillos / 1000; // promedio: n · L conserva el metro rolado total
    PF.pasadas_rolado = forma === 'REDONDA' ? M.proceso.rolado.n_pasadas : M.proceso.rolado.n_pasadas_plegado;
    // Corte: la yarda ES el ancho de la hoja, así que cada plantilla de una yarda completa sale con un solo tajo a lo ancho;
    // el tramo de ajuste, más angosto que la hoja, necesita además el corte a lo largo de la hoja (B en total) y su tajo.
    PF.L_corte_m = (arm.n_completas * n_cost * Y + (arm.ajuste_mm > 0 ? B + n_cost * arm.ajuste_mm : 0)) / 1000;
    PF.extremos = [];
    arm.piezas.forEach((q) => { for (let i = 0; i < q.bridas; i += 1) PF.extremos.push(extremo); }); // sólo los extremos con brida
    PF.espigas_defecto = arm.n_piezas;
    PF.A_ext_m2 = (extremo.P_ext_mm * L_capa) / 1e6;
    PF.ancho_hoja_mm = Y;

    // Costura longitudinal: una por anillo y por línea de costura
    const L_costura_m = (n_cost * L_capa) / 1000;
    let n_eng = 0;
    if (costura.soldada) PF.sold[costura.cordon === 'TOPE' ? 'tope_m' : 'filete_m'] += L_costura_m;
    else { PF.engargolado_long_m = L_costura_m; n_eng += arm.n_anillos * n_cost; }
    // Juntas entre yardas de una misma pieza (engargoladas, o soldadas si así lo dicen las tablas)
    const L_juntas_m = (arm.n_juntas * P_med) / 1000;
    if (arm.n_juntas > 0) {
      if (junta.soldada) {
        PF.sold[junta.cordon === 'TOPE' ? 'tope_m' : 'filete_m'] += L_juntas_m;
        PF.n_juntas_internas = arm.n_juntas;
      } else { PF.engargolado_circ_m = L_juntas_m; n_eng += arm.n_juntas; }
    }
    PF.engargolado_m = PF.engargolado_long_m + PF.engargolado_circ_m;
    PF.n_engargolados = n_eng;
    if (B > M.proceso.hoja.largo_mm) {
      PF.advertencias.push(`La plantilla de cada yarda (${B.toFixed(0)} mm) es más larga que la hoja (${M.proceso.hoja.largo_mm} mm): cada anillo saldría de varias plantillas, con más costuras longitudinales de las cotizadas.`);
    }

    Object.assign(PF.detalle, {
      ancho_plantilla_mm: B, allowance_costura_mm: costura.allowance_mm, n_costuras: n_cost,
      yarda_mm: Y, n_anillos: arm.n_anillos, n_juntas_yardas: arm.n_juntas, L_capa_mm: L_capa, armado: arm,
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
   * Silleta de un injerto cilíndrico (radio rb) sobre un cono recto: eje x, radio r(x) = R1 − m·x (grande en x = 0).
   * El eje del injerto cruza el eje del cono en (xj, 0, 0) y forma el ángulo β con él; se inclina hacia x creciente
   * (extremo menor) si sentido = +1 o hacia x decreciente (extremo mayor) si sentido = −1.
   *
   * Cada generatriz φ del injerto toca el cono a la distancia axial t(φ) de ese cruce: es la raíz positiva de una
   * cuadrática (cilindro ∩ cono es una cuádrica por recta). De ahí salen, sin mallas:
   *   · t medio y máximo  → área de pared del injerto A = π·d_med·(L_ramal − t_med) y largo mínimo del injerto
   *   · perímetro P_h     → soldadura de la silleta
   *   · área del orificio → integral de línea ∮ G(x) dθ sobre el cono, con G' = r·√(1 + m²) (teorema de Green en (x, θ))
   *   · alcance axial     → para saber si la silleta cabe en el cono
   * Devuelve { ok: false, motivo } si la geometría no existe (injerto demasiado tendido o demasiado grande).
   */
  function silletaInjertoCono({ R1, m, xj, rb, beta, sentido, N = 2880 }) {
    const ux = sentido * cos(beta);
    const uy = sin(beta);
    const A0 = R1 - m * xj; // radio del cono en el punto donde el eje del injerto cruza el eje
    const a = uy * uy - m * m * ux * ux;
    if (!(a > 1e-9)) return { ok: false, motivo: 'tendido' };
    const xs = new Float64Array(N);
    const ys = new Float64Array(N);
    const zs = new Float64Array(N);
    let sumaT = 0;
    let tMax = -Infinity;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < N; i += 1) {
      const phi = (2 * PI * i) / N;
      const sp = sin(phi);
      const cp = cos(phi);
      const c = rb * sp * ux;
      const d0 = A0 + m * uy * rb * sp;
      const b = 2 * (uy * c + m * ux * d0);
      const g = c * c + rb * rb * cp * cp - d0 * d0;
      const disc = b * b - 4 * a * g;
      if (!(disc > 0)) return { ok: false, motivo: 'grande' };
      const t = (-b + sqrt(disc)) / (2 * a);
      xs[i] = xj + t * ux - rb * sp * uy;
      ys[i] = t * uy + rb * sp * ux;
      zs[i] = rb * cp;
      if (!(R1 - m * xs[i] > 0)) return { ok: false, motivo: 'grande' }; // la silleta pasa del vértice del cono
      sumaT += t;
      tMax = Math.max(tMax, t);
      xMin = Math.min(xMin, xs[i]);
      xMax = Math.max(xMax, xs[i]);
    }
    const k = sqrt(1 + m * m);
    const G = (x) => k * (R1 * x - (m * x * x) / 2);
    let perimetro = 0;
    let area = 0;
    for (let i = 0; i < N; i += 1) {
      const j = (i + 1) % N;
      perimetro += Math.hypot(xs[j] - xs[i], ys[j] - ys[i], zs[j] - zs[i]);
      let dth = Math.atan2(zs[j], ys[j]) - Math.atan2(zs[i], ys[i]);
      if (dth > PI) dth -= 2 * PI;
      else if (dth <= -PI) dth += 2 * PI;
      area += 0.5 * (G(xs[i]) + G(xs[j])) * dth;
    }
    return {
      ok: true, t_med: sumaT / N, t_max: tMax, P_h: perimetro, A_orificio: Math.abs(area), x_min: xMin, x_max: xMax,
    };
  }

  /** Cruce (xj) del eje del injerto con el eje del cono para que su silleta quede centrada en x = xc (sobre la generatriz superior). */
  function cruceInjertoCono({ R1, m, beta, sentido, xc }) {
    const ux = sentido * cos(beta);
    const uy = sin(beta);
    return (xc * (uy + m * ux) - ux * R1) / uy;
  }

  /**
   * Reducción con injerto: el injerto (diámetro d, a 30° o 45°) va SOBRE EL CONO de la reducción D1 → D2. La pieza es
   * el cono con el orificio de la silleta más la pared del injerto: 2 piezas, 1 junta interna y 3 extremos bridados
   * (D1, D2 y d). La silleta se centra en el largo del cono; el largo de la reducción es el menor que la aloja con
   * holgura a cada extremo (o el que se capture). El taller siempre lo lleva de extremo mayor a menor: el injerto se
   * inclina hacia D2 (dato de maestros proceso.injerto_inclinado_hacia; no se captura por partida). Hacia dónde se
   * inclina cambia el desarrollo, porque el cono se ensancha o se cierra en ese sentido.
   */
  function reduccionInjerto(p, e, M) {
    const PF = nuevoPF('REDUCCION_INJERTO');
    exigir(p.D1_mm > 0 && p.D2_mm > 0 && p.d_mm > 0, 'Los diámetros de la reducción (D1 y D2) y del injerto deben ser mayores que 0.');
    exigir(p.D2_mm < p.D1_mm, 'D2 debe ser menor que D1: la reducción va de D1 a D2.');
    const vacio = p.beta_deg === undefined || p.beta_deg === null || p.beta_deg === '';
    const beta_deg = vacio ? M.proceso.beta_ramal_defecto_deg : Number(p.beta_deg);
    exigir(beta_deg >= 20 && beta_deg <= 90, 'El ángulo del injerto β debe estar entre 20° y 90°.'); // límite del modelo; el taller maneja 30° y 45°
    const inclinacion = String(M.proceso.injerto_inclinado_hacia).trim().toUpperCase();
    exigir(inclinacion === 'MAYOR' || inclinacion === 'MENOR', 'En las tablas maestras, "injerto inclinado hacia" debe ser MENOR (de extremo mayor a menor, como lo maneja el taller) o MAYOR.');
    const sentido = inclinacion === 'MENOR' ? 1 : -1;

    const dT = dimensionesRedondas(p.D1_mm, e, p.ref_diametro);
    const dS = dimensionesRedondas(p.D2_mm, e, p.ref_diametro);
    const db = dimensionesRedondas(p.d_mm, e, p.ref_diametro);
    const R1 = dT.D_med / 2;
    const R2 = dS.D_med / 2;
    const rb = db.D_med / 2;
    const r_med = (R1 + R2) / 2; // radio del cono a la mitad de su largo
    exigir(rb < r_med, `El injerto debe ser de menor diámetro que la reducción en el punto donde se asienta (Ø${(2 * r_med).toFixed(0)} mm).`);
    const beta = rad(beta_deg);
    const margen = M.proceso.injerto_margen_cono_mm;

    // Con la silleta centrada en L/2: ¿cuánto cono hace falta para alojarla con holgura a cada extremo?
    const ajuste = (L) => {
      const m = (R1 - R2) / L;
      const xj = cruceInjertoCono({ R1, m, beta, sentido, xc: L / 2 });
      const g = silletaInjertoCono({ R1, m, xj, rb, beta, sentido });
      if (!g.ok) return { ok: false, motivo: g.motivo };
      const medio = Math.max(L / 2 - g.x_min, g.x_max - L / 2);
      return { ok: true, g, necesario: 2 * (medio + margen) };
    };
    // El largo automático es el punto fijo L = máx(largo de 15°, lo que necesita la silleta con ese largo): el menor que cabe.
    const L15 = (R1 - R2) / tan(rad(M.proceso.semiangulo_max_deg));
    let L_auto = Math.max(L15, 2 * (margen + rb / sin(beta)));
    let aj;
    let convergio = false;
    for (let i = 0; i < 80 && !convergio; i += 1) {
      aj = ajuste(L_auto);
      if (!aj.ok) { L_auto *= 1.25; continue; }
      const siguiente = Math.max(L15, aj.necesario);
      convergio = Math.abs(siguiente - L_auto) < 1e-7;
      L_auto = siguiente;
    }
    exigir(convergio, 'El injerto no cabe en la reducción: revise los diámetros y el ángulo.');
    aj = ajuste(L_auto);
    const L = p.L_reduccion_mm > 0 ? p.L_reduccion_mm : L_auto;
    if (L !== L_auto) {
      aj = ajuste(L);
      exigir(aj.ok, 'El injerto no cabe en esa reducción: alargue la reducción o reduzca el injerto.');
      exigir(L >= aj.necesario - 1e-6, `La reducción es corta para alojar el injerto: necesita al menos ${Math.ceil(L_auto)} mm (con ${margen} mm de holgura a cada extremo).`);
    }
    const g = aj.g;
    const L_ramal_auto = g.t_max + M.proceso.injerto_largo_extra_mm;
    const L_r = p.L_ramal_mm > 0 ? p.L_ramal_mm : L_ramal_auto;
    exigir(L_r > g.t_max, `La longitud del injerto debe exceder ${g.t_max.toFixed(0)} mm (medida sobre su eje desde el eje de la reducción).`);

    const C = reduccion({
      D1_mm: p.D1_mm, D2_mm: p.D2_mm, L_mm: L, ref_diametro: p.ref_diametro, excentrica: 'NO',
    }, e, M);
    const s_cono = C.detalle.generatriz_max_mm;
    const A_cono = C.A_neta_m2 * 1e6;
    const A_injerto = PI * db.D_med * (L_r - g.t_med);
    const k = rb / r_med;
    if (k > 0.8) PF.advertencias.push('El injerto es casi del diámetro de la reducción (d/D > 0.8 en su punto medio): revisar el diseño.');

    PF.A_neta_m2 = (A_cono - g.A_orificio + A_injerto) / 1e6;
    PF.A_orificio_m2 = g.A_orificio / 1e6;
    PF.n_piezas = 2; // cono e injerto
    PF.n_virolas = 2;
    // Un solo (L_virola, k_rolado) para el rolado: n·k·L conserva el trabajo de cada pieza (cono k = k_conico; cilindro k = 1).
    const rolado_m = s_cono + L_r;
    PF.L_virola_m = rolado_m / 2 / 1000;
    PF.k_rolado = (M.proceso.rolado.k_conico * s_cono + L_r) / rolado_m;
    PF.L_corte_m = (PI * (dT.D_med + dS.D_med) + 2 * s_cono + g.P_h + 2 * (PI * db.D_med + L_r)) / 1000;
    PF.sold.tope_m = (s_cono + (L_r - g.t_med)) / 1000; // costura del cono + costura del injerto
    PF.sold.filete_m = g.P_h / 1000; // silleta
    PF.n_juntas_internas = 1;
    PF.extremos = [extremoRedondo(dT), extremoRedondo(dS), extremoRedondo(db)];
    PF.espigas_defecto = 3;
    PF.D_ref_mm = (dT.D_med + dS.D_med) / 2;
    PF.advertencias.push(...C.advertencias);
    PF.detalle = {
      d_med_mm: db.D_med, k_d_sobre_D: k, beta_deg, t_medio_mm: g.t_med, t_max_mm: g.t_max,
      A_cono_m2: A_cono / 1e6, A_ramal_m2: A_injerto / 1e6, P_orificio_mm: g.P_h,
      L_reduccion_mm: L, L_reduccion_auto_mm: L_auto, L_ramal_mm: L_r, L_ramal_auto_mm: L_ramal_auto,
      semiangulo_deg: C.detalle.semiangulo_deg, generatriz_max_mm: s_cono,
      x_silleta_min_mm: g.x_min, x_silleta_max_mm: g.x_max, holgura_mm: Math.min(g.x_min, L - g.x_max),
      sentido: inclinacion,
    };
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

  function personalizado(p, e) {
    const PF = nuevoPF('PERSONALIZADO');
    exigir(p.A_neta_m2 > 0, 'El área neta de la pieza personalizada debe ser mayor que 0.');
    const n_ext = p.n_extremos === undefined ? 0 : p.n_extremos;
    exigir(Number.isInteger(n_ext) && n_ext >= 0 && n_ext <= 1000, 'Los extremos a unir deben ser un entero de 0 a 1000.');
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
      case 'PERSONALIZADO': PF = personalizado(p, e); break;
      default: throw new U.ErrorValidacion([`Familia desconocida: ${p.familia}`]);
    }
    // Superficie exterior (pintura): exacta en recto y codo; en el resto A_ext ≈ A_neta · (D_ref + e)/D_ref
    if (!(PF.A_ext_m2 > 0)) PF.A_ext_m2 = PF.D_ref_mm > 0 ? PF.A_neta_m2 * (1 + e / PF.D_ref_mm) : PF.A_neta_m2;
    return PF;
  }

  return {
    perfilFabricacion,
    distribuirYardas,
    dimensionesRedondas,
    dimensionesRect,
    areaTroncoOblicuo,
    areaTransicionRR,
    razonElipticaE,
    factorOrificio,
    silletaInjertoCono,
    cruceInjertoCono,
    familias: { recto, codoRedondo, codoRect, reduccion, transicion, ramal, reduccionInjerto, pantalon, personalizado },
  };
}));
