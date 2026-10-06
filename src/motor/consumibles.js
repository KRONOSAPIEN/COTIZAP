/**
 * COTIZAP · consumibles.js — Cantidades de consumibles (por unidad de partida).
 *
 *  Alambre/varilla de aporte:  kg = Σ(L_cordón · A_cordón · ρ_dep) / (1000 · η_dep),   A_cordón = k · e²
 *  Gas de protección:          m³ = t_arco · Q_gas · (1 + f_pre/post) / 1000
 *  Pintura (por mano):         L  = A_pint / (cobertura_teórica · η_transferencia),
 *                              cobertura_teórica = 10 · SV% / DFT_µm   (m²/L)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.consumibles = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function cantidades(PF, her, tmp, pint, mat, e, M) {
    const S = M.proceso.soldadura;
    const proc = S.procesos[mat.proceso_sold];

    /* Soldadura */
    const A_tope = Math.max(S.A_cordon_min_mm2, S.k_cordon.TOPE * e * e);
    const A_fil = Math.max(S.A_cordon_min_mm2, S.k_cordon.FILETE * e * e);
    const L_tope = tmp.detalle.L_tope_m;
    const L_fil = tmp.detalle.L_filete_m;
    // 1 m · 1 mm² = 1 cm³  →  gramos = longitud[m] · área[mm²] · ρ[g/cm³]
    const m_dep_chapa_g = (L_tope * A_tope + L_fil * A_fil) * S.rho_dep_g_cm3;
    // La costura de cierre de cada aro lleva el cordón del espesor del PERFIL.
    const m_dep_cierres_g = her.sold_aros.cierres.reduce(
      (s_, c) => s_ + c.L_m * Math.max(S.A_cordon_min_mm2, S.k_cordon.TOPE * c.esp_mm * c.esp_mm) * S.rho_dep_g_cm3, 0,
    );
    const m_dep_g = m_dep_chapa_g + m_dep_cierres_g;
    const kg_alambre = m_dep_g / 1000 / proc.eta_dep;
    const V_gas_m3 = (tmp.detalle.t_arco_min * proc.Q_gas_L_min * (1 + proc.f_pre_post)) / 1000;

    /* Pintura */
    const capas = pint.capas.map((nombre) => {
      const c = M.proceso.pintura.capas[nombre];
      const cobertura_teorica = (10 * c.sv_pct) / c.dft_um;
      const cobertura_practica = cobertura_teorica * c.eta_transf;
      const litros = pint.A_pint_m2 / cobertura_practica;
      return {
        nombre, precio_ref: c.precio_ref, cobertura_teorica_m2_L: cobertura_teorica, cobertura_practica_m2_L: cobertura_practica, litros,
      };
    });
    const L_pintura = capas.reduce((s, c) => s + c.litros, 0);
    const L_diluyente = L_pintura * M.proceso.pintura.f_diluyente;

    return {
      soldadura: {
        A_cordon_tope_mm2: A_tope, A_cordon_filete_mm2: A_fil, m_depositado_chapa_g: m_dep_chapa_g, m_depositado_cierres_g: m_dep_cierres_g,
        m_depositado_g: m_dep_g, kg_alambre, V_gas_m3,
        alambre_ref: mat.alambre_ref, gas_ref: mat.gas_ref, eta_dep: proc.eta_dep,
      },
      pintura: { capas, L_pintura, L_diluyente },
      corte: { L_corte_m: tmp.detalle.L_corte_m, proceso: tmp.detalle.proceso_corte },
    };
  }

  return { cantidades };
}));
