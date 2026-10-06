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
      require('./mano_obra'), require('./consumibles'), require('./precios'), require('./validacion'),
    );
  } else {
    const C = root.COTIZAP;
    root.COTIZAP.cotizador = factory(C.util, C.geometria, C.material, C.manoObra, C.consumibles, C.precios, C.validacion);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, MAT, MO, CON, PRE, VAL) {
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

  /**
   * Validación previa de una partida. Primero la compuerta de entrada (tipos, rangos, listas y pertenencia: validacion.js);
   * si pasa, la política del taller (ángulos) y lo que depende de las tablas (calibre, servicio). `errores` bloquean el
   * cálculo; `advertencias` se reportan. `p` es la partida normalizada (números ya convertidos), la que se calcula.
   */
  function validarPartida(entrada, M) {
    const { p, errores } = VAL.normalizarPartida(entrada, M);
    const advertencias = [];
    if (errores.length) return { p, errores, advertencias };
    validarAngulos(p, M, errores);
    if (p.familia === 'COMPRADO') {
      if (!(p.precio_compra_unitario >= 0)) errores.push('Capturar el costo de compra unitario.');
      return { p, errores, advertencias };
    }
    const mat = M.materiales[p.material_id];
    if (!(p.espesor_mm > 0)) {
      const tabla = M.calibres[mat.tabla_calibre];
      if (p.calibre === undefined) errores.push('Falta el calibre (o capture el espesor propio).');
      else if (!tabla || tabla[p.calibre] === undefined) errores.push(`El calibre ${p.calibre} no existe en la tabla ${mat.tabla_calibre}.`);
    }
    const serv = M.servicios[p.servicio || 'POLVO'];
    if (serv && p.calibre && !(p.espesor_mm > 0)) {
      const dim = dimensionCaracteristica(p);
      const fila = serv.find((f) => dim <= f.hasta_mm);
      if (fila && p.calibre > fila.calibre_max) {
        advertencias.push(`Calibre ${p.calibre} más delgado que el mínimo recomendado (${fila.calibre_max}) para ${dim.toFixed(0)} mm en servicio ${p.servicio || 'POLVO'}.`);
      }
    }
    return { p, errores, advertencias };
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

  /** Las tablas maestras deben estar sanas para calcular: un cero en un divisor o un valor negativo no dan un precio, dan basura. */
  function exigirMaestrosSanos(M, familia, previos) {
    const todos = previos || VAL.problemasMaestros(M);
    const propios = familia === 'COMPRADO' ? todos.filter((x) => x.ruta[0] === 'capas') : todos; // lo comprado sólo usa la pila de precio
    if (propios.length) {
      const lista = propios.slice(0, 6).map((x) => `Tablas maestras · ${VAL.textoProblema(x)}`);
      if (propios.length > lista.length) lista.push(`…y ${propios.length - lista.length} valores más en las tablas maestras.`);
      throw new U.ErrorValidacion(lista);
    }
  }

  /** Nada que salga del cálculo puede ser NaN ni infinito: si algo se escapó a la validación, se dice dónde. */
  function exigirResultadoNumerico(resultado) {
    const malos = VAL.noFinitos(resultado);
    if (malos.length) {
      throw new U.ErrorValidacion([`El cálculo dio un resultado que no es un número (${malos.join(', ')}): revise los datos de la partida y las tablas maestras.`]);
    }
    return resultado;
  }

  /** Una partida: validar → levantar cantidades → valorizar → pila de precio. `previos` = problemas de maestros ya calculados (cotizar() los calcula una vez). */
  function cotizarPartida(entrada, M, previos) {
    exigirMaestrosSanos(M, entrada && entrada.familia, previos);
    const val = validarPartida(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada) ? { cantidad: 1, ...entrada } : entrada, M);
    if (val.errores.length) throw new U.ErrorValidacion(val.errores);
    const p = val.p;
    if (p.familia === 'COMPRADO') return exigirResultadoNumerico(cotizarComprado(p, M));

    const q = levantarCantidades(p, M);
    const costos = PRE.valorizar(q, M);
    const capas = PRE.pila(costos.CD, costos.h_MOD, p.riesgo, M);
    const peso_unit = q.lam.m_neta_kg + q.her.m_aros_neta_kg + q.her.m_aros_sueltos_neta_kg; // lo que se manda: incluye los aros sueltos
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    const importe = cierre.precio.importe;
    cierre.indicadores.precio_por_kg_neto = peso_unit > 0 ? importe / (peso_unit * p.cantidad) : null;
    cierre.indicadores.costo_por_kg_neto = peso_unit > 0 ? capas.C_T / (peso_unit * p.cantidad) : null;
    cierre.indicadores.horas_mod_por_kg_neto = peso_unit > 0 ? costos.h_MOD / (peso_unit * p.cantidad) : null;
    if (p.familia === 'RECTO') {
      cierre.indicadores.precio_por_m_lineal = importe / ((p.L_mm * p.cantidad) / 1000);
    }
    return exigirResultadoNumerico({
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
        aros_sueltos_neto_kg: q.her.m_aros_sueltos_neta_kg,
      },
      ...cierre,
    });
  }

  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const sinValor = (v) => v === undefined || v === null || v === '';

  /**
   * Ancho de la yarda de la cotización (914 mm = 3 ft ó 1 220 mm = 4 ft, lo elige el ingeniero que diseña): lo heredan los
   * tramos rectos que no traen el suyo. Vacío = el de las tablas maestras. Un valor inválido (no numérico, fuera de los
   * límites de la yarda) se ignora y se avisa. Devuelve { yarda_mm, aviso }, cada uno undefined si no aplica.
   */
  function yardaDeCotizacion(cot, M) {
    if (sinValor(cot.yarda_mm)) return {};
    const L = VAL.limitesDe(M);
    const v = typeof cot.yarda_mm === 'number' || typeof cot.yarda_mm === 'string' ? VAL.aNumero(cot.yarda_mm) : NaN;
    if (Number.isFinite(v) && v > 0 && !(v < L.yarda_min_mm) && !(v > L.yarda_max_mm)) return { yarda_mm: v };
    return { aviso: `Ancho de la yarda: «${String(cot.yarda_mm)}» no es válido (debe estar entre ${L.yarda_min_mm} y ${L.yarda_max_mm} mm); se usa el de las tablas maestras.` };
  }

  /**
   * Cotización completa: lista de partidas + totales con IVA. Nunca lanza por una partida: la que no se puede calcular
   * queda como { ok: false, errores } (y `interno: true` si fue una falla inesperada del cálculo, no de los datos).
   * Una cotización o una lista de partidas mal formada se toma como vacía.
   */
  function cotizar(cot, M0) {
    const c = esObjeto(cot) ? cot : {};
    const ef = maestrosEfectivos(c, M0);
    const M = ef.M;
    const problemas = VAL.problemasMaestros(M); // una sola vez para todas las partidas
    // Valores de la cotización que heredan las partidas que no los traen (o los dejan vacíos: «según la cotización»)
    const defs = { riesgo: c.riesgo || 'MEDIO', servicio: c.servicio, ubicacion: c.ubicacion, ...(esObjeto(c.defaults) ? c.defaults : {}) };
    Object.keys(defs).forEach((k) => sinValor(defs[k]) && delete defs[k]);
    const yarda = yardaDeCotizacion(c, M);
    const heredar = (p) => {
      const fusion = { ...defs, ...p };
      Object.keys(defs).forEach((k) => { if (sinValor(p[k])) fusion[k] = defs[k]; });
      // sólo el tramo recto se arma por yardas; en la partida, vacío o 0 significa «según la cotización»
      if (p.familia === 'RECTO' && yarda.yarda_mm !== undefined && (sinValor(p.yarda_mm) || VAL.aNumero(p.yarda_mm) === 0)) fusion.yarda_mm = yarda.yarda_mm;
      return fusion;
    };
    const lista = Array.isArray(c.partidas) ? c.partidas : [];
    const filas = lista.map((p, indice) => {
      try {
        if (!esObjeto(p)) throw new U.ErrorValidacion(['La partida no es válida (se esperaba un objeto con sus datos).']);
        return { indice, ...cotizarPartida(heredar(p), M, problemas) };
      } catch (err) {
        if (err instanceof U.ErrorValidacion) return { ok: false, indice, errores: err.errores, entrada: p };
        return {
          ok: false, indice, interno: true, errores: [`No se pudo calcular esta partida (falla inesperada: ${String((err && err.message) || err)}). Revise sus datos y las tablas maestras.`], entrada: p,
        };
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
    const avisos = [...ef.avisos];
    if (yarda.aviso) avisos.push(yarda.aviso);
    if (problemas.length) {
      avisos.push(`Tablas maestras con ${problemas.length === 1 ? 'un valor no válido' : `${problemas.length} valores no válidos`}: ${VAL.textoProblema(problemas[0])}${problemas.length > 1 ? ' (y otros)' : ''}.`);
    }
    return {
      partidas: filas,
      maestros: M, // las tablas con las capas de esta cotización: lo que usó cada partida
      capas: C,
      parametros: ef.aplicados,
      yarda_mm: yarda.yarda_mm, // el ancho de yarda propio de la cotización (undefined = el de las tablas maestras)
      avisos,
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
    FAMILIAS, PARAMETROS_COTIZACION, parametroDeMaestros, maestrosEfectivos, yardaDeCotizacion, validarPartida, levantarCantidades, cotizarPartida, cotizar,
  };
}));
