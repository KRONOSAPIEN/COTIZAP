/**
 * COTIZAP · precios.js — Valorización de cantidades y pila de precio.
 *
 * Aquí (y sólo aquí) se leen los precios: `M.precios[<variable_referencial>]` y la lista del proveedor (`M.proveedor`,
 * ver proveedor.js). El levantamiento de cantidades (QTO) no conoce ningún precio.
 *
 *   CD = materiales + consumibles + mano de obra + equipo + herramienta menor
 *   CI = GIF·h_MOD + adm%·CD
 *   IMP = imp%·(CD + CI)                       ← imprevistos por clase de riesgo
 *   C_T = CD + CI + IMP
 *   FIN = C_T · tasa · días/365
 *   P   = (C_T + FIN) / (1 − u − c_ventas − otros)     ← márgenes sobre PRECIO
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./mano_obra'), require('./proveedor'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.precios = factory(root.COTIZAP.util, root.COTIZAP.manoObra, root.COTIZAP.proveedor);
  }
}(typeof self !== 'undefined' ? self : this, function (U, MO, PROV) {
  'use strict';

  function precioDe(M, ref) {
    const v = M.precios[ref];
    if (v === undefined || v === null || Number.isNaN(Number(v))) {
      throw new U.ErrorValidacion([`Falta el precio de la variable «${ref}» en las tablas maestras.`]);
    }
    return Number(v);
  }

  /**
   * Precio por kg (sin IVA) de la lámina de una partida: el de la hoja que cotiza el proveedor para ese material y
   * calibre (de `ancho_mm` si se dice: la yarda del tramo recto); si no hay (otro calibre, placa de espesor capturado,
   * otro material) se usa el de la tabla de precios.
   */
  function precioLamina(M, p, mat, ancho_mm) {
    const prov = PROV.laminaDe(M, p.material_id, p.espesor_mm > 0 ? 0 : p.calibre, ancho_mm);
    return prov || { fuente: 'TABLA', ref: mat.precio_ref, precio_kg: precioDe(M, mat.precio_ref) };
  }

  /** Igual para el perfil de un aro: la barra cotizada que lo enlaza, o el precio por kg de la tabla. */
  function precioPerfil(M, aro) {
    const prov = PROV.perfilDe(M, aro.perfil_id);
    return prov || { fuente: 'TABLA', ref: aro.precio_ref, precio_kg: precioDe(M, aro.precio_ref) };
  }

  const DRIVERS_SUBCONTRATO = ['PIEZA', 'KG_NETO', 'KG_BRUTO', 'M2_NETO', 'M_CORTE', 'M_SOLDADURA'];

  /** Valor por unidad de partida de cada driver de subcontrato. */
  function valorDriver(driver, q) {
    const { lam, her, tmp } = q;
    switch (driver) {
      case 'PIEZA': return 1;
      case 'KG_NETO': return lam.m_neta_kg + her.m_aros_neta_kg + her.m_aros_sueltos_neta_kg;
      case 'KG_BRUTO': return lam.m_bruta_kg + her.m_aros_bruta_kg + her.m_aros_sueltos_bruta_kg;
      case 'M2_NETO': return lam.A_neta_m2;
      case 'M_CORTE': return tmp.detalle.L_corte_m;
      case 'M_SOLDADURA': return tmp.detalle.L_soldadura_m;
      default: throw new U.ErrorValidacion([`Driver de subcontrato desconocido: ${driver}`]);
    }
  }

  /**
   * Costos directos de una partida (total = cantidad · unitario + setups).
   * `p.omitir_operaciones` apaga horas y consumibles de operaciones subcontratadas;
   * `p.subcontratos` agrega su costo por driver (sin horas de mano de obra).
   */
  function valorizar(q, M) {
    const n = q.cantidad;
    const { lam, her, tmp, con, mat } = q;
    const C = M.capas;
    const H = M.herrajes;
    const omitir = new Set((q.p && q.p.omitir_operaciones) || []);

    /* Materiales */
    const pLamina = precioLamina(M, q.p, mat, q.PF && q.PF.ancho_hoja_mm);
    const lamina = n * lam.m_bruta_kg * pLamina.precio_kg;
    const credito_chatarra = -n * C.recuperacion_chatarra_pct * lam.m_merma_kg * precioDe(M, mat.chatarra_ref);
    // cada aro se valoriza con el precio de SU perfil (solera ≠ ángulo); los aros sueltos también son material comprado
    const pPerfiles = {};
    const perfiles = [...her.aros, ...her.aros_sueltos].reduce((acc, a) => {
      if (!pPerfiles[a.perfil_id]) pPerfiles[a.perfil_id] = precioPerfil(M, a);
      return acc + n * a.m_aro_bruta_kg * pPerfiles[a.perfil_id].precio_kg;
    }, 0);
    let tornilleria = 0;
    Object.keys(her.tornillos_por_tipo).forEach((tipo) => {
      const reserva = M.herrajes.uniones.BRIDADO.f_reserva_tornilleria;
      tornilleria += n * her.tornillos_por_tipo[tipo] * (1 + reserva) * precioDe(M, H.tornillo_precio_ref[tipo]);
    });
    const fijaciones = her.n_fijaciones > 0
      ? n * her.n_fijaciones * (1 + M.herrajes.uniones.ESPIGA.f_reserva_fijaciones) * precioDe(M, H.precio_fijacion_ref) : 0;
    const empaque = her.L_empaque_m > 0 ? n * her.L_empaque_m * precioDe(M, H.empaque.precio_ref) : 0;
    const sellador = her.V_sellador_ml > 0
      ? n * her.V_sellador_ml * (precioDe(M, H.sellador.precio_cartucho_ref) / H.sellador.cartucho_ml) : 0;
    const flete = C.flete_material_pct * (lamina + perfiles);
    const materiales = { lamina, credito_chatarra, perfiles, tornilleria, fijaciones, empaque, sellador, flete };

    /* Consumibles */
    const alambre = omitir.has('soldadura') ? 0 : n * con.soldadura.kg_alambre * precioDe(M, mat.alambre_ref);
    const gas = omitir.has('soldadura') ? 0 : n * con.soldadura.V_gas_m3 * precioDe(M, mat.gas_ref);
    const corte = omitir.has('corte') ? 0 : n * con.corte.L_corte_m * precioDe(M, M.proceso.corte.consumible_ref[con.corte.proceso]);
    const pintura = omitir.has('pintura') ? 0 : n * (con.pintura.capas.reduce((s, c) => s + c.litros * precioDe(M, c.precio_ref), 0)
      + con.pintura.L_diluyente * (con.pintura.L_pintura > 0 ? precioDe(M, M.proceso.pintura.diluyente_precio_ref) : 0));
    const consumibles = { alambre, gas, corte, pintura };

    /* Mano de obra y equipo por operación */
    const eta = M.proceso.eficiencia_taller;
    const mano_obra = {};
    const equipo = {};
    const horas_std = {};
    const horas_reales = {};
    let h_MOD = 0;
    MO.OPERACIONES.forEach((op) => {
      const t_std = omitir.has(op) ? 0 : n * (tmp.unitarios_min[op] || 0) + (tmp.setup_min[op] || 0);
      const t_real = t_std / eta;
      const tar = MO.tarifa(M, op);
      horas_std[op] = t_std / 60;
      horas_reales[op] = t_real / 60;
      mano_obra[op] = (t_real / 60) * tar.mo_h;
      equipo[op] = (t_real / 60) * tar.equipo_h;
      h_MOD += t_real / 60;
    });
    const sumMO = U.suma(mano_obra);
    const herramienta_menor = C.herramienta_menor_pct_mo * sumMO;

    /* Subcontratos: costo = cantidad · driver · precio (sin horas de MOD) */
    const subcontratos = {};
    ((q.p && q.p.subcontratos) || []).forEach((sc, i) => {
      subcontratos[`${i + 1}. ${sc.concepto || 'Subcontrato'}`] = n * valorDriver(sc.driver, q) * Number(sc.precio);
    });

    const subtotales = {
      materiales: U.suma(materiales),
      consumibles: U.suma(consumibles),
      mano_obra: sumMO,
      equipo: U.suma(equipo),
      herramienta_menor,
      subcontratos: U.suma(subcontratos),
    };
    const CD = U.suma(subtotales);
    return {
      materiales, consumibles, mano_obra, equipo, herramienta_menor, subcontratos, subtotales, CD, h_MOD, horas_std, horas_reales,
      precios_usados: { lamina: pLamina, perfiles: pPerfiles },
    };
  }

  /** Pila de capas: CI, imprevistos, financiamiento, utilidad, comisión → precio antes de IVA. */
  function pila(CD, h_MOD, riesgo, M) {
    const C = M.capas;
    const clase = riesgo || 'MEDIO';
    const imp_pct = C.imprevistos_pct[clase];
    if (imp_pct === undefined) throw new U.ErrorValidacion([`Clase de riesgo desconocida: ${clase}`]);
    const divisor = 1 - C.utilidad_pct_precio - C.comision_ventas_pct_precio - C.otros_pct_precio;
    if (divisor <= 0) {
      throw new U.ErrorValidacion(['Utilidad + comisión + otros ≥ 100 % del precio: configuración de capas inválida.']);
    }
    const CI_fabrica = C.gif_por_hora_mod * h_MOD;
    const CI_admin = C.administracion_pct_cd * CD;
    const CI = CI_fabrica + CI_admin;
    const imprevistos = imp_pct * (CD + CI);
    const C_T = CD + CI + imprevistos;
    const f_fin = (C.financiamiento.tasa_anual * C.financiamiento.dias_cobro) / 365;
    const financiamiento = C_T * f_fin;
    const C_base = C_T + financiamiento;
    const precio = C_base / divisor;
    return {
      CD, CI_fabrica, CI_admin, CI, riesgo: clase, imp_pct, imprevistos, C_T, f_fin, financiamiento, C_base, divisor,
      utilidad: precio * C.utilidad_pct_precio, comision: precio * C.comision_ventas_pct_precio, otros: precio * C.otros_pct_precio,
      precio,
    };
  }

  return { DRIVERS_SUBCONTRATO, precioDe, precioLamina, precioPerfil, valorizar, pila };
}));
