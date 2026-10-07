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
      require('./mano_obra'), require('./consumibles'), require('./precios'), require('./validacion'), require('./proveedor'), require('./compras'),
    );
  } else {
    const C = root.COTIZAP;
    root.COTIZAP.cotizador = factory(C.util, C.geometria, C.material, C.manoObra, C.consumibles, C.precios, C.validacion, C.proveedor, C.compras);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, MAT, MO, CON, PRE, VAL, PROV, COMP) {
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
    BRIDA: 'Bridas sueltas (sólo aros)',
    INSTALACION: 'Instalación en obra',
    SOPORTE: 'Soportería',
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
      if (!(p.precio_compra_unitario >= 0) && !p.articulo_id) errores.push('Capturar el costo de compra unitario (o elegir un artículo del catálogo).');
      return { p, errores, advertencias };
    }
    if (p.familia === 'INSTALACION') {
      if (p.personas === undefined) errores.push('Falta cuántas personas forman la cuadrilla.');
      if (p.dias === undefined) errores.push('Faltan los días en obra.');
      return { p, errores, advertencias };
    }
    if (p.familia === 'SOPORTE') {
      if (!p.barra_id) errores.push('Falta la barra de la que se cortan las piezas (de la lista del proveedor).');
      if (p.largo_pieza_mm === undefined) errores.push('Falta el largo de barra que lleva cada pieza.');
      const b = p.barra_id ? PROV.barra(M, p.barra_id) : null;
      if (p.barra_id && !b) errores.push(`La barra «${p.barra_id}» no tiene precio o largo válidos en la lista del proveedor.`);
      if (b && p.largo_pieza_mm > b.largo_mm) errores.push(`Cada pieza lleva ${p.largo_pieza_mm} mm y la barra mide ${b.largo_mm} mm: una pieza no sale de una sola barra.`);
      return { p, errores, advertencias };
    }
    if (p.familia === 'BRIDA' && p.tipo_union !== undefined && p.tipo_union !== 'BRIDADO') errores.push('Una partida de bridas sueltas sólo lleva unión bridada.');
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

  /** Precio sin IVA de un precio que puede traerlo (el IVA de las compras se acredita: no es costo). */
  const sinIvaCompras = (M, precio, conIva) => (conIva ? precio / (1 + M.compras.iva_pct) : precio);

  /** Costos de una partida que no se fabrica de lámina: { materiales, mano_obra, … } con sus subtotales y el costo directo. */
  function armarCostos(partes, h_MOD) {
    const costos = {
      materiales: partes.materiales || {}, consumibles: {}, mano_obra: partes.mano_obra || {}, equipo: partes.equipo || {},
      herramienta_menor: partes.herramienta_menor || 0, subcontratos: {}, viaticos: partes.viaticos || {},
      horas_std: partes.horas || {}, horas_reales: partes.horas || {}, h_MOD: h_MOD || 0,
    };
    costos.subtotales = {
      materiales: U.suma(costos.materiales), consumibles: 0, mano_obra: U.suma(costos.mano_obra), equipo: U.suma(costos.equipo),
      herramienta_menor: costos.herramienta_menor, subcontratos: 0, viaticos: U.suma(costos.viaticos),
    };
    costos.CD = U.suma(costos.subtotales);
    return costos;
  }

  /**
   * Artículo comprado: su precio (el capturado, o el del catálogo de compras si se eligió un artículo) por la cantidad.
   * Si el precio trae IVA se le quita (`compras.iva_pct`): el costo es sin IVA, como todo lo demás.
   */
  function cotizarComprado(p, M) {
    const art = p.articulo_id ? M.compras.articulos[p.articulo_id] : null;
    const capturado = p.precio_compra_unitario !== undefined;
    const precio = capturado ? p.precio_compra_unitario : art.precio;
    const iva_incluido = p.iva_incluido !== undefined ? p.iva_incluido : (!capturado && art ? art.iva_incluido : false);
    const unitario_sin_iva = sinIvaCompras(M, precio, iva_incluido);
    const costos = armarCostos({ materiales: { compra: unitario_sin_iva * p.cantidad } }, 0);
    const capas = PRE.pila(costos.CD, 0, p.riesgo, M);
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    return {
      ok: true, entrada: p, familia: 'COMPRADO', descripcion: p.descripcion || (art && art.descripcion) || FAMILIAS.COMPRADO, advertencias: [],
      // categoria: el renglón del control de gastos donde cae (la del artículo; lo que no es del catálogo, compra a terceros)
      compra: { articulo_id: p.articulo_id, unidad: art ? art.unidad : 'pza', precio, iva_incluido, unitario_sin_iva, categoria: (art && art.categoria) || 'PROVEEDOR' },
      peso: { neto_unitario_kg: p.peso_kg || 0, neto_total_kg: (p.peso_kg || 0) * p.cantidad },
      ...cierre,
    };
  }

  /**
   * Instalación en obra: la cuadrilla (personas × días × horas por día, a la tarifa de `instalacion`: horas reales, sin la
   * eficiencia del taller) y los viáticos (viajes con casetas y gasolina, hospedaje por persona y noche, comidas por persona
   * y día, otros gastos). Lo que se paga con factura se toma sin IVA (se acredita); sin factura, el IVA es costo.
   * Los indirectos por hora son los de la instalación (`capas.gif_por_hora_instalacion`), no los de la nave.
   */
  function cotizarInstalacion(p, M) {
    const n = p.cantidad;
    const horas_dia = p.horas_dia > 0 ? p.horas_dia : M.mano_obra.jornada.horas_dia;
    const horas = n * p.personas * p.dias * horas_dia;
    const tar = MO.tarifa(M, 'instalacion');
    const mo = horas * tar.mo_h;
    const factura = p.gastos_con_factura !== false;
    const comidas_factura = p.comidas_con_factura === true;
    const v = (x, conFactura) => sinIvaCompras(M, n * x, conFactura);
    const viaticos = {
      casetas: v((p.viajes || 0) * (p.casetas_viaje || 0), factura),
      gasolina: v((p.viajes || 0) * (p.gasolina_viaje || 0), factura),
      hospedaje: v(p.personas * (p.noches || 0) * (p.hospedaje_noche || 0), factura),
      comidas: v(p.personas * p.dias * (p.comida_dia || 0), comidas_factura),
      otros: v(p.otros_gastos || 0, factura),
    };
    const costos = armarCostos({
      mano_obra: { instalacion: mo }, equipo: { instalacion: horas * tar.equipo_h }, herramienta_menor: M.capas.herramienta_menor_pct_mo * mo,
      viaticos, horas: { instalacion: horas },
    }, horas);
    const capas = PRE.pila(costos.CD, horas, p.riesgo, M, { gif_por_hora: M.capas.gif_por_hora_instalacion });
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    return {
      ok: true, entrada: p, familia: 'INSTALACION', descripcion: p.descripcion || FAMILIAS.INSTALACION, advertencias: [],
      instalacion: { horas_dia, horas, horas_por_vez: horas / n, tarifa: tar, gastos_con_factura: factura, comidas_con_factura: comidas_factura },
      peso: { neto_unitario_kg: 0, neto_total_kg: 0 },
      ...cierre,
    };
  }

  /**
   * Soportería (ménsulas, abrazaderas, postes): piezas cortadas de una barra de la lista del proveedor, con sus anclajes y su
   * tornillería, y los minutos de taller de cada pieza (corte, doblez, barreno y punteo, a la tarifa de armado y con la
   * eficiencia del taller). El perfil se paga por la fracción de barra que usa cada pieza, con la merma de perfil; la lista
   * de compras dice cuántas barras completas hay que comprar.
   */
  function cotizarSoporte(p, M) {
    const n = p.cantidad;
    const S = M.proceso.soportes;
    const b = PROV.barra(M, p.barra_id);
    const art_id = p.articulo_anclaje || S.anclaje_defecto;
    const art = M.compras.articulos[art_id];
    const anclaje_unit = sinIvaCompras(M, art.precio, art.iva_incluido);
    const tornillo = S.tornillo;
    const precio_tornillo = PRE.precioDe(M, M.herrajes.tornillo_precio_ref[tornillo]);
    const L_m = (n * p.largo_pieza_mm) / 1000;
    const minutos = p.min_pieza > 0 ? p.min_pieza : S.t_fab_pieza_min;
    const horas = (n * minutos) / 60 / M.proceso.eficiencia_taller;
    const tar = MO.tarifa(M, 'armado');
    const mo = horas * tar.mo_h;
    const costos = armarCostos({
      materiales: {
        perfil: (L_m * b.precio_m) / (1 - M.merma.PERFIL),
        anclajes: n * (p.anclajes_pieza || 0) * anclaje_unit,
        tornilleria: n * (p.tornillos_pieza || 0) * precio_tornillo,
      },
      mano_obra: { armado: mo }, equipo: { armado: horas * tar.equipo_h }, herramienta_menor: M.capas.herramienta_menor_pct_mo * mo,
      horas: { armado: horas },
    }, horas);
    const capas = PRE.pila(costos.CD, horas, p.riesgo, M);
    const cierre = cerrarPrecio(p, costos, capas, M, {});
    const kg_pieza = b.kg_m === null ? 0 : (b.kg_m * p.largo_pieza_mm) / 1000;
    return {
      ok: true, entrada: p, familia: 'SOPORTE', descripcion: p.descripcion || FAMILIAS.SOPORTE, advertencias: [],
      soporte: {
        barra: b, L_total_m: L_m, minutos_pieza: minutos, horas, articulo_anclaje: art_id, anclaje: { ...art, unitario_sin_iva: anclaje_unit },
        anclajes: n * (p.anclajes_pieza || 0), tornillo, tornillos: n * (p.tornillos_pieza || 0), precio_tornillo,
      },
      peso: { neto_unitario_kg: kg_pieza, neto_total_kg: kg_pieza * n },
      ...cierre,
    };
  }

  // Las secciones de las tablas de las que depende cada familia que no es de lámina (las de lámina dependen de todas)
  const SECCIONES_FAMILIA = {
    COMPRADO: ['capas', 'compras'],
    INSTALACION: ['capas', 'compras', 'mano_obra'],
    SOPORTE: ['capas', 'compras', 'mano_obra', 'proveedor', 'merma', 'precios', 'herrajes', 'proceso'],
  };
  function exigirMaestrosSanos(M, familia, previos) {
    const todos = previos || VAL.problemasMaestros(M);
    const secciones = SECCIONES_FAMILIA[familia];
    const propios = secciones ? todos.filter((x) => secciones.includes(x.ruta[0])) : todos; // lo comprado sólo usa la pila de precio y el catálogo
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
    if (p.familia === 'INSTALACION') return exigirResultadoNumerico(cotizarInstalacion(p, M));
    if (p.familia === 'SOPORTE') return exigirResultadoNumerico(cotizarSoporte(p, M));

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
   * Venta pactada de la cotización (MXN sin IVA, lo que se acordó con el cliente): con ella se mide el margen real. Vacío = no
   * hay. Un valor inválido se ignora y se avisa. Devuelve { venta, aviso }.
   */
  function ventaPactada(cot) {
    if (sinValor(cot.venta_pactada)) return {};
    const v = typeof cot.venta_pactada === 'number' || typeof cot.venta_pactada === 'string' ? VAL.aNumero(cot.venta_pactada) : NaN;
    if (Number.isFinite(v) && v >= 0 && v <= 1e10) return { venta: v };
    return { aviso: `Venta pactada: «${String(cot.venta_pactada)}» no es un importe válido; se ignora.` };
  }

  /**
   * Partida automática que cobra el material sobrante de comprar piezas enteras (hojas, barras, tornillos, cartuchos y
   * envases completos): sólo la pila de precio, sin cargo mínimo (no es una partida que se fabrique).
   */
  function partidaSobrante(sobrante, riesgo, M) {
    const costos = armarCostos({ materiales: { sobrante } }, 0);
    const capas = PRE.pila(costos.CD, 0, riesgo, M);
    const importe = U.redondear(capas.precio, 2);
    return {
      ok: true, automatica: true, familia: 'AJUSTE_COMPRA', entrada: { familia: 'AJUSTE_COMPRA', cantidad: 1 },
      descripcion: 'Material sobrante al comprar piezas enteras (hojas, barras, tornillos y envases completos)', advertencias: [],
      costos, pila: capas, precio: { total_sin_redondeo: capas.precio, unitario: importe, importe, aplico_cargo_minimo: false },
      indicadores: { costo_total: capas.C_T, precio_piso: capas.C_base / (1 - M.capas.comision_ventas_pct_precio - M.capas.otros_pct_precio) },
      peso: { neto_unitario_kg: 0, neto_total_kg: 0 },
    };
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
    // Lista de compras (siempre) y, si la cotización lo pide, el sobrante de comprar piezas enteras como partida automática
    const compras = COMP.listaCompras(filas, M);
    const automaticas = c.piezas_enteras === true && compras.sobrante > 0.005 ? [partidaSobrante(compras.sobrante, defs.riesgo || 'MEDIO', M)] : [];
    const ok = [...filas.filter((f) => f.ok), ...automaticas];
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
    const C_base_total = ok.reduce((s, f) => s + f.pila.C_base, 0);
    const neto_ventas = 1 - C.comision_ventas_pct_precio - C.otros_pct_precio;
    const vp = ventaPactada(c);
    const avisos = [...ef.avisos];
    if (yarda.aviso) avisos.push(yarda.aviso);
    if (vp.aviso) avisos.push(vp.aviso);
    if (problemas.length) {
      avisos.push(`Tablas maestras con ${problemas.length === 1 ? 'un valor no válido' : `${problemas.length} valores no válidos`}: ${VAL.textoProblema(problemas[0])}${problemas.length > 1 ? ' (y otros)' : ''}.`);
    }
    return {
      partidas: filas,
      automaticas, // partidas que agrega el cálculo (el sobrante de comprar piezas enteras): no son de la lista del usuario
      compras,
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
        C_base_total,
        precio_minimo: C_base_total / neto_ventas, // vender por debajo de esto (sin IVA) es perder: no cubre costo, indirectos ni comisión
        venta: vp.venta === undefined ? null : {
          pactada: vp.venta,
          precio_calculado: subtotal_neto,
          diferencia: vp.venta - subtotal_neto,
          utilidad: vp.venta * neto_ventas - C_base_total,
          margen_pct: vp.venta > 0 ? (vp.venta * neto_ventas - C_base_total) / vp.venta : 0,
          cubre_costo_directo: vp.venta >= CD_total,
          cubre_precio_minimo: vp.venta >= C_base_total / neto_ventas - 0.005,
          iva: U.redondear(vp.venta * C.iva_pct, 2),
          total: U.redondear(vp.venta * (1 + C.iva_pct), 2),
        },
        n_partidas_ok: filas.filter((f) => f.ok).length, // sólo las del usuario: la automática del sobrante no cuenta
        n_partidas_error: filas.filter((f) => !f.ok).length,
        n_partidas_automaticas: automaticas.length,
      },
    };
  }

  return {
    FAMILIAS, PARAMETROS_COTIZACION, parametroDeMaestros, maestrosEfectivos, yardaDeCotizacion, ventaPactada, validarPartida, levantarCantidades, cotizarPartida, cotizar,
  };
}));
