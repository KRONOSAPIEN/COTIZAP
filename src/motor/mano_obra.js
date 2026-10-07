/**
 * COTIZAP · mano_obra.js — Tiempos estándar por operación y tarifas.
 *
 * Los tiempos se calculan con "drivers" geométricos (m de corte, m de soldadura, nº de piezas…)
 * y se devuelven en MINUTOS ESTÁNDAR por unidad. La eficiencia del taller (η) se aplica al
 * valorizar:  t_real = t_estándar / η.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.manoObra = factory(root.COTIZAP.util);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const OPERACIONES = ['corte', 'rolado', 'armado', 'aros', 'soldadura', 'engargolado', 'barrenado', 'acabado', 'pintura', 'qc_embalaje'];

  /**
   * Costo de una hora trabajada de la operación. El taller paga por día y la semana paga más días de los que se trabajan
   * (el séptimo día): salario_hora = salario_diario × días pagados ÷ (días trabajados × horas por día); con $500 por día,
   * 7 días pagados y 5 de 8 h trabajados, $87.50. mo_h = salario_hora · FSR (el factor de salario real suma las prestaciones;
   * con FSR = 1 el salario ya es el costo).
   */
  function tarifa(M, op) {
    const o = M.mano_obra.operaciones[op];
    if (!o) throw new U.ErrorValidacion([`Operación sin tarifa: ${op}`]);
    if (!(Number(o.salario_diario) >= 0)) throw new U.ErrorValidacion([`Falta el salario por día de la operación «${op}» en las tablas maestras.`]);
    const J = M.mano_obra.jornada;
    const salario_hora = (o.salario_diario * J.dias_pagados_semana) / (J.dias_trabajados_semana * J.horas_dia);
    const mo_h = salario_hora * M.mano_obra.FSR;
    return { salario_hora, mo_h, equipo_h: o.equipo_h, total_h: mo_h + o.equipo_h };
  }

  /**
   * Tiempos por unidad (min estándar) y setups por partida.
   * Devuelve además los datos intermedios (velocidades, tiempo de arco) para trazabilidad.
   */
  function tiempos(PF, her, lam, pint, p, mat, e, M) {
    const P = M.proceso;
    const fam = PF.familia;

    /* --- Corte --- */
    const procCorte = p.proceso_corte || (fam === 'RECTO' ? P.corte.proceso_recto : P.corte.proceso_perfilado);
    const tablaV = P.corte.v_m_min[procCorte];
    if (!tablaV) throw new U.ErrorValidacion([`Proceso de corte desconocido: ${procCorte}`]);
    const v_corte = U.interpolar(tablaV, e);
    const L_corte_m = PF.L_corte_m + her.L_corte_extra_m;
    const A_hoja_m2 = ((PF.ancho_hoja_mm || P.hoja.ancho_mm) * P.hoja.largo_mm) / 1e6; // en el tramo recto la hoja es del ancho de la yarda
    const n_hojas_eq = lam.A_bruta_m2 / A_hoja_m2;
    const t_corte = n_hojas_eq * P.corte.t_manejo_hoja_min + L_corte_m / v_corte;
    const setup_corte = procCorte === 'GUILLOTINA' || !(L_corte_m > 0) ? 0 : P.corte.t_prog_cnc_min; // sin lámina que cortar no hay programa

    /* --- Rolado / plegado --- */
    const v_rol = U.interpolar(P.rolado.v_m_min, e);
    const pasadas = PF.pasadas_rolado || P.rolado.n_pasadas;
    const t_rolado = PF.n_virolas * (P.rolado.t_fijo_min + (pasadas * PF.k_rolado * PF.L_virola_m) / v_rol);

    /* --- Armado y punteo (incluye ajuste de aros, fijación y formado de espigas) --- */
    const A = P.armado;
    const k_dif = A.k_dif[fam] === undefined ? 1 : A.k_dif[fam];
    const t_junta = A.t_junta_base_min + A.t_junta_por_m_min * (PF.D_ref_mm / 1000);
    const t_armado = k_dif * (PF.n_piezas * A.t_fijo_pieza_min + PF.n_juntas_internas * t_junta
      + her.n_aros * A.t_ajuste_aro_min + her.n_fijaciones * A.t_fijacion_min + her.n_espigas * A.t_formado_espiga_min);

    /* --- Fabricación de aros de brida (rolado de la solera): los que se arman al ducto y los que se mandan sueltos --- */
    const t_aros = [...her.aros, ...her.aros_sueltos].reduce((s, a) => s + P.aros.t_fijo_aro_min + P.aros.t_roll_aro_min_m * (a.L_aro_mm / 1000), 0);

    /* --- Soldadura --- */
    const S = P.soldadura;
    const proc = S.procesos[mat.proceso_sold];
    if (!proc) throw new U.ErrorValidacion([`Proceso de soldadura desconocido: ${mat.proceso_sold}`]);
    const L_tope = PF.sold.tope_m;
    const L_fil = PF.sold.filete_m + her.sold_aros.filete_m;
    const L_cierres = her.sold_aros.cierres.reduce((s_, c) => s_ + c.L_m, 0);
    const L_sold = L_tope + L_fil + L_cierres;
    const vSold = (esp) => U.interpolar(S.v_m_min, esp) * proc.v_mult;
    const t_arco_chapa = (L_tope + L_fil) / vSold(e);
    // El cierre del aro se suelda en el espesor del perfil (más grueso que la lámina): su velocidad es menor.
    const t_arco_cierres = her.sold_aros.cierres.reduce((s_, c) => s_ + c.L_m / vSold(c.esp_mm), 0);
    const t_arco = t_arco_chapa + t_arco_cierres;
    const t_sold = (t_arco / proc.FO) * mat.f_sold;

    /* --- Engargolado (costuras mecánicas) --- */
    const E = P.engargolado;
    const v_eng = U.interpolar(E.v_m_min, e);
    const n_engargolados = PF.n_engargolados === null ? PF.n_piezas : PF.n_engargolados; // una operación por costura o junta engargolada
    const t_engargolado = PF.engargolado_m > 0 ? n_engargolados * E.t_fijo_pieza_min + PF.engargolado_m / v_eng : 0;

    /* --- Barrenado --- */
    const t_barrenado = her.n_barrenos * P.barrenado.t_barreno_min;

    /* --- Acabado (esmerilado, limpieza, decapado en inoxidable) --- */
    const t_acabado = mat.f_acabado * t_sold;

    /* --- Pintura (preparación + aplicación por mano) --- */
    // cada parte (ducto, bridas) se prepara una vez y recibe sus propias manos
    const t_pintura = pint.partes.reduce((s, x) => s + x.A_m2 * (P.pintura.t_prep_min_m2 + x.capas.length * P.pintura.t_aplic_min_m2), 0);

    /* --- Inspección y embalaje --- */
    const m_neta_total = lam.m_neta_kg + her.m_aros_neta_kg + her.m_aros_sueltos_neta_kg; // todo lo que se manda se inspecciona y se embala
    const t_qc = P.qc.t_fijo_min + P.qc.k_manejo_min_kg * m_neta_total;

    return {
      unitarios_min: {
        corte: t_corte, rolado: t_rolado, armado: t_armado, aros: t_aros, soldadura: t_sold,
        engargolado: t_engargolado, barrenado: t_barrenado, acabado: t_acabado, pintura: t_pintura, qc_embalaje: t_qc,
      },
      setup_min: { corte: setup_corte },
      detalle: {
        proceso_corte: procCorte, v_corte_m_min: v_corte, L_corte_m, n_hojas_eq,
        v_rolado_m_min: v_rol, pasadas, k_dif_armado: k_dif, t_junta_min: t_junta,
        proceso_soldadura: mat.proceso_sold, v_soldadura_m_min: vSold(e), FO: proc.FO, L_soldadura_m: L_sold,
        L_tope_m: L_tope, L_filete_m: L_fil, L_cierres_m: L_cierres, t_arco_chapa_min: t_arco_chapa, t_arco_cierres_min: t_arco_cierres, t_arco_min: t_arco,
        peso_neto_total_kg: m_neta_total,
      },
    };
  }

  return { OPERACIONES, tarifa, tiempos };
}));
