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
    RAMAL: 'Injerto simple',
    REDUCCION_INJERTO: 'Reducción con injerto',
    PANTALON: 'Pantalón (familia retirada)',
    PERSONALIZADO: 'Pieza personalizada (CAD)',
    COMPRADO: 'Artículo comprado',
  };

  /** «30° o 45°» · «30°, 45°, 60° o 90°» */
  const listaGrados = (a) => (a.length === 1 ? `${a[0]}°` : `${a.slice(0, -1).join('°, ')}° o ${a[a.length - 1]}°`);

  /**
   * Política del taller: sólo se manejan ciertos ángulos (datos de maestros, no constantes). La geometría vale para
   * cualquier ángulo físicamente posible; aquí se decide cuáles se cotizan.
   */
  function validarAngulos(p, M, errores) {
    if (p.familia === 'RAMAL' || p.familia === 'REDUCCION_INJERTO') {
      const permitidos = M.proceso.angulos_injerto_deg;
      const vacio = p.beta_deg === undefined || p.beta_deg === null || p.beta_deg === '';
      const beta = vacio ? M.proceso.beta_ramal_defecto_deg : Number(p.beta_deg);
      if (!permitidos.includes(beta)) errores.push(`Todo injerto debe ser a ${listaGrados(permitidos)} (la partida trae ${vacio ? '—' : `${p.beta_deg}°`}).`);
    }
    if (p.familia === 'CODO') {
      const permitidos = M.proceso.angulos_codo_deg;
      const vacio = p.theta_deg === undefined || p.theta_deg === null || p.theta_deg === '';
      const theta = vacio ? 90 : Number(p.theta_deg);
      if (!permitidos.includes(theta)) errores.push(`Los codos del taller son de ${listaGrados(permitidos)} (la partida trae ${p.theta_deg}°).`);
    }
  }

  /**
   * Parámetros de precio que una cotización puede traer propios (`cot.parametros`) y que anulan, sólo para esa
   * cotización, a las capas de las tablas maestras: así el margen, la comisión o los días de cobro se ajustan al
   * cotizar sin tocar los maestros. Valores en fracción (0.25 = 25 %); `dias_cobro` en días enteros. `ruta` dice
   * dónde vive el valor en `M.capas`; el descuento no existe en maestros (0 por omisión) y se aplica al subtotal.
   * `min`/`max` son los límites válidos (la interfaz usa los mismos).
   */
  const PARAMETROS_COTIZACION = {
    utilidad_pct_precio: { nombre: 'Margen de utilidad', ruta: ['utilidad_pct_precio'], min: 0, max: 0.8 },
    comision_ventas_pct_precio: { nombre: 'Comisión de ventas', ruta: ['comision_ventas_pct_precio'], min: 0, max: 0.2 },
    descuento_pct: { nombre: 'Descuento', ruta: null, min: 0, max: 0.5 },
    dias_cobro: { nombre: 'Días de cobro', ruta: ['financiamiento', 'dias_cobro'], min: 0, max: 365, entero: true },
    administracion_pct_cd: { nombre: 'Administración', ruta: ['administracion_pct_cd'], min: 0, max: 0.5 },
    tasa_anual: { nombre: 'Financiamiento anual', ruta: ['financiamiento', 'tasa_anual'], min: 0, max: 1 },
    iva_pct: { nombre: 'IVA', ruta: ['iva_pct'], min: 0, max: 0.3 },
  };

  /** Valor de un parámetro en las tablas maestras (el descuento no existe allí: 0). */
  function parametroDeMaestros(M, clave) {
    const def = PARAMETROS_COTIZACION[clave];
    return def.ruta ? def.ruta.reduce((o, k) => o[k], M.capas) : 0;
  }

  const textoLimite = (def, x) => (def.entero ? String(x) : `${U.redondear(x * 100, 2)} %`);

  /**
   * Maestros con las capas de precio de ESTA cotización: las de las tablas con los parámetros propios encima.
   * No muta `M`. Un parámetro inválido (fuera de rango, no numérico, días no enteros) se ignora y se avisa.
   * Devuelve { M, capas, descuento_pct, aplicados, avisos }.
   */
  function maestrosEfectivos(cot, M) {
    const capas = U.clonar(M.capas);
    const crudos = cot && cot.parametros && typeof cot.parametros === 'object' && !Array.isArray(cot.parametros) ? cot.parametros : {};
    const avisos = [];
    const aplicados = {};
    let descuento_pct = 0;
    Object.keys(PARAMETROS_COTIZACION).forEach((clave) => {
      const crudo = Object.prototype.hasOwnProperty.call(crudos, clave) ? crudos[clave] : undefined;
      if (crudo === undefined || crudo === null || crudo === '') return;
      const def = PARAMETROS_COTIZACION[clave];
      const v = typeof crudo === 'number' || typeof crudo === 'string' ? Number(crudo) : NaN;
      if (!(Number.isFinite(v) && v >= def.min && v <= def.max && (!def.entero || Number.isInteger(v)))) {
        avisos.push(`${def.nombre}: «${String(crudo)}» no es válido (debe estar entre ${textoLimite(def, def.min)} y ${textoLimite(def, def.max)}); se usa el valor de las tablas maestras.`);
        return;
      }
      aplicados[clave] = v;
      if (def.ruta) {
        const padre = def.ruta.slice(0, -1).reduce((o, k) => o[k], capas);
        padre[def.ruta[def.ruta.length - 1]] = v;
      } else {
        descuento_pct = v;
      }
    });
    return { M: { ...M, capas }, capas, descuento_pct, aplicados, avisos };
  }

  const dimensionCaracteristica = (p) => Math.max(p.D_mm || 0, p.D1_mm || 0, p.D2_mm || 0, p.a_mm || 0, p.b_mm || 0);

  /** Validación previa. `errores` bloquean el cálculo; `advertencias` se reportan. */
  function validarPartida(p, M) {
    const errores = [];
    const advertencias = [];
    if (!FAMILIAS[p.familia]) errores.push(`Familia desconocida: ${p.familia}`);
    if (!(p.cantidad > 0) || !Number.isInteger(p.cantidad)) errores.push('La cantidad debe ser un entero mayor que 0.');
    validarAngulos(p, M, errores);
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
  function cotizar(cot, M0) {
    const ef = maestrosEfectivos(cot, M0);
    const M = ef.M;
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
    const C = M.capas;
    const subtotal = U.redondear(ok.reduce((s, f) => s + f.precio.importe, 0), 2);
    const descuento = U.redondear(subtotal * ef.descuento_pct, 2);
    const subtotal_neto = U.redondear(subtotal - descuento, 2); // el IVA se calcula sobre el precio ya descontado
    const iva = U.redondear(subtotal_neto * C.iva_pct, 2);
    const peso_total = ok.reduce((s, f) => s + f.peso.neto_total_kg, 0);
    const CD_total = ok.reduce((s, f) => s + f.costos.CD, 0);
    const C_T_total = ok.reduce((s, f) => s + f.pila.C_T, 0);
    // Utilidad real = lo que queda del precio descontado después de la comisión y de todo el costo (C_base, con financiamiento)
    const utilidad = ok.reduce((s, f) => s + f.precio.importe * (1 - ef.descuento_pct) * (1 - C.comision_ventas_pct_precio - C.otros_pct_precio) - f.pila.C_base, 0);
    return {
      partidas: filas,
      maestros: M, // las tablas con las capas de esta cotización: lo que usó cada partida
      capas: C,
      parametros: ef.aplicados,
      avisos: ef.avisos,
      totales: {
        subtotal, descuento_pct: ef.descuento_pct, descuento, subtotal_neto,
        iva_pct: C.iva_pct, iva, total: U.redondear(subtotal_neto + iva, 2),
        peso_neto_kg: peso_total,
        precio_por_kg_neto: peso_total > 0 ? subtotal_neto / peso_total : null,
        costo_directo: CD_total,
        costo_total: C_T_total,
        utilidad,
        margen_real_pct: subtotal_neto > 0 ? utilidad / subtotal_neto : 0,
        n_partidas_ok: ok.length,
        n_partidas_error: filas.length - ok.length,
      },
    };
  }

  return {
    FAMILIAS, PARAMETROS_COTIZACION, parametroDeMaestros, maestrosEfectivos, validarPartida, levantarCantidades, cotizarPartida, cotizar,
  };
}));
