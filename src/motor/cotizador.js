/**
 * COTIZAP · cotizador.js — Orquestador del motor.
 *
 * Pipeline por partida (cantidades ≠ precios):
 *
 *   validar → geometría (PF) → herrajes → lámina (peso/merma) → pintura → tiempos →
 *   consumibles ══ QTO (sin precios) ══ → valorizar → pila de precio → KPIs
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./util'), require('./geometria'), require('./material'),
      require('./mano_obra'), require('./consumibles'), require('./precios'),
    );
  } else {
    const C = root.COTIZAP;
    root.COTIZAP.cotizador = factory(C.util, C.geometria, C.material, C.manoObra, C.consumibles, C.precios);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, MAT, MO, CON, PRE) {
  'use strict';

  const FAMILIAS = {
    RECTO: 'Tramo recto',
    CODO: 'Codo',
    REDUCCION: 'Reducción',
    TRANSICION: 'Transición redondo → rectángulo',
    RAMAL: 'Ramal en ángulo',
    PANTALON: 'Pantalón (Y simétrica)',
    PERSONALIZADO: 'Pieza personalizada (CAD)',
    COMPRADO: 'Artículo comprado',
  };

  const dimensionCaracteristica = (p) => Math.max(p.D_mm || 0, p.D1_mm || 0, p.D2_mm || 0, p.a_mm || 0, p.b_mm || 0);

  /** Validación previa. `errores` bloquean el cálculo; `advertencias` se reportan. */
  function validarPartida(p, M) {
    const errores = [];
    const advertencias = [];
    if (!FAMILIAS[p.familia]) errores.push(`Familia desconocida: ${p.familia}`);
    if (!(p.cantidad > 0) || !Number.isInteger(p.cantidad)) errores.push('La cantidad debe ser un entero mayor que 0.');
    if (p.familia === 'COMPRADO') {
      if (!(p.precio_compra_unitario >= 0)) errores.push('Capturar el costo de compra unitario.');
      return { errores, advertencias };
    }
    (p.omitir_operaciones || []).forEach((op) => {
      if (!MO.OPERACIONES.includes(op)) errores.push(`Operación desconocida en omitir_operaciones: ${op}`);
    });
    (p.subcontratos || []).forEach((sc, i) => {
      if (!PRE.DRIVERS_SUBCONTRATO.includes(sc.driver)) errores.push(`Subcontrato ${i + 1}: driver desconocido «${sc.driver}».`);
      if (!(Number(sc.precio) >= 0)) errores.push(`Subcontrato ${i + 1}: precio inválido.`);
    });
    const mat = M.materiales[p.material_id];
    if (!mat) {
      errores.push(`Material desconocido: ${p.material_id}`);
      return { errores, advertencias };
    }
    if (!(p.espesor_mm > 0)) {
      const tabla = M.calibres[mat.tabla_calibre];
      if (!tabla || tabla[p.calibre] === undefined) errores.push(`El calibre ${p.calibre} no existe en la tabla ${mat.tabla_calibre}.`);
    }
    const serv = M.servicios[p.servicio || 'POLVO'];
    if (serv && p.calibre && !(p.espesor_mm > 0)) {
      const dim = dimensionCaracteristica(p);
      const fila = serv.find((f) => dim <= f.hasta_mm);
      if (fila && p.calibre > fila.calibre_max) {
        advertencias.push(`Calibre ${p.calibre} más delgado que el mínimo recomendado (${fila.calibre_max}) para ${dim.toFixed(0)} mm en servicio ${p.servicio || 'POLVO'}.`);
      }
    }
    return { errores, advertencias };
  }

  /** Levantamiento de cantidades: todo lo físico, nada monetario. */
  function levantarCantidades(p, M) {
    const mat = M.materiales[p.material_id];
    const e = MAT.espesorMm(M, mat, p);
    const PF = GEO.perfilFabricacion(p, e, M);
    const her = MAT.herrajes(PF, p, mat, e, M);
    const lam = MAT.lamina(PF, her.A_espiga_m2, p, mat, e, M);
    const pint = MAT.pintura(PF, her, p, mat, M);
    const tmp = MO.tiempos(PF, her, lam, pint, p, mat, e, M);
    const con = CON.cantidades(PF, her, tmp, pint, mat, e, M);
    return {
      cantidad: p.cantidad, p, mat, e, PF, her, lam, pint, tmp, con,
    };
  }

  function cerrarPrecio(p, costos, capas, M, extra) {
    let precio_total = capas.precio;
    let aplico_cargo_minimo = false;
    if (precio_total < M.capas.cargo_minimo_partida) {
      precio_total = M.capas.cargo_minimo_partida;
      aplico_cargo_minimo = true;
    }
    const precio_unitario = U.redondear(precio_total / p.cantidad, 2);
    const importe = U.redondear(precio_unitario * p.cantidad, 2);
    return {
      costos,
      pila: capas,
      precio: { total_sin_redondeo: precio_total, unitario: precio_unitario, importe, aplico_cargo_minimo },
      indicadores: {
        costo_total: capas.C_T,
        precio_piso: capas.C_base / (1 - M.capas.comision_ventas_pct_precio - M.capas.otros_pct_precio),
        margen_contribucion_pct: precio_total > 0 ? (precio_total - costos.CD) / precio_total : 0,
        markup_sobre_costo_total: capas.C_T > 0 ? precio_total / capas.C_T - 1 : 0,
        horas_mod_reales: costos.h_MOD,
        ...extra,
      },
    };
  }

  function cotizarComprado(p, M) {
    const costo = p.precio_compra_unitario * p.cantidad;
    const costos = {
      materiales: { compra: costo }, consumibles: {}, mano_obra: {}, equipo: {}, herramienta_menor: 0, subcontratos: {},
      subtotales: { materiales: costo, consumibles: 0, mano_obra: 0, equipo: 0, herramienta_menor: 0, subcontratos: 0 },
      CD: costo, h_MOD: 0, horas_std: {}, horas_reales: {},
    };
    const capas = PRE.pila(costo, 0, p.riesgo, M);
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    return {
      ok: true, entrada: p, familia: 'COMPRADO', descripcion: p.descripcion || FAMILIAS.COMPRADO, advertencias: [],
      peso: { neto_unitario_kg: p.peso_kg || 0, neto_total_kg: (p.peso_kg || 0) * p.cantidad },
      ...cierre,
    };
  }

  function cotizarPartida(entrada, M) {
    const p = { cantidad: 1, ...entrada };
    const val = validarPartida(p, M);
    if (val.errores.length) throw new U.ErrorValidacion(val.errores);
    if (p.familia === 'COMPRADO') return cotizarComprado(p, M);

    const q = levantarCantidades(p, M);
    const costos = PRE.valorizar(q, M);
    const capas = PRE.pila(costos.CD, costos.h_MOD, p.riesgo, M);
    const peso_unit = q.lam.m_neta_kg + q.her.m_aros_neta_kg;
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    const importe = cierre.precio.importe;
    cierre.indicadores.precio_por_kg_neto = peso_unit > 0 ? importe / (peso_unit * p.cantidad) : null;
    cierre.indicadores.costo_por_kg_neto = peso_unit > 0 ? capas.C_T / (peso_unit * p.cantidad) : null;
    cierre.indicadores.horas_mod_por_kg_neto = peso_unit > 0 ? costos.h_MOD / (peso_unit * p.cantidad) : null;
    if (p.familia === 'RECTO') {
      cierre.indicadores.precio_por_m_lineal = importe / ((p.L_mm * p.cantidad) / 1000);
    }
    return {
      ok: true,
      entrada: p,
      familia: p.familia,
      descripcion: p.descripcion || FAMILIAS[p.familia],
      espesor_mm: q.e,
      material: q.mat.nombre,
      qto: q,
      geometria: q.PF,
      advertencias: [...val.advertencias, ...q.PF.advertencias],
      peso: {
        neto_unitario_kg: peso_unit,
        neto_total_kg: peso_unit * p.cantidad,
        lamina_neta_kg: q.lam.m_neta_kg,
        lamina_bruta_unitaria_kg: q.lam.m_bruta_kg,
        aros_neto_kg: q.her.m_aros_neta_kg,
      },
      ...cierre,
    };
  }

  /** Cotización completa: lista de partidas + totales con IVA. */
  function cotizar(cot, M) {
    const defs = { riesgo: cot.riesgo || 'MEDIO', servicio: cot.servicio, ...(cot.defaults || {}) };
    Object.keys(defs).forEach((k) => defs[k] === undefined && delete defs[k]);
    const filas = (cot.partidas || []).map((p, indice) => {
      try {
        return { indice, ...cotizarPartida({ ...defs, ...p }, M) };
      } catch (err) {
        if (err instanceof U.ErrorValidacion) return { ok: false, indice, errores: err.errores, entrada: p };
        throw err;
      }
    });
    const ok = filas.filter((f) => f.ok);
    const subtotal = U.redondear(ok.reduce((s, f) => s + f.precio.importe, 0), 2);
    const iva = U.redondear(subtotal * M.capas.iva_pct, 2);
    const peso_total = ok.reduce((s, f) => s + f.peso.neto_total_kg, 0);
    const CD_total = ok.reduce((s, f) => s + f.costos.CD, 0);
    const C_T_total = ok.reduce((s, f) => s + f.pila.C_T, 0);
    return {
      partidas: filas,
      totales: {
        subtotal, iva_pct: M.capas.iva_pct, iva, total: U.redondear(subtotal + iva, 2),
        peso_neto_kg: peso_total,
        precio_por_kg_neto: peso_total > 0 ? subtotal / peso_total : null,
        costo_directo: CD_total,
        costo_total: C_T_total,
        n_partidas_ok: ok.length,
        n_partidas_error: filas.length - ok.length,
      },
    };
  }

  return { FAMILIAS, validarPartida, levantarCantidades, cotizarPartida, cotizar };
}));
