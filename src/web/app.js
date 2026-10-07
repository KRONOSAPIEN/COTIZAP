/**
 * COTIZAP · web/app.js — Interfaz de cotización (estado, lista, totales, desglose, diálogo de partida).
 * Depende de: COTIZAP.util, .maestros, .cotizador (motor) y COTIZAP.web (dom.js, esquemas.js).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const U = C.util;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const SOLO_COPIAR = !!root.COTIZAP_ENTORNO_ARTIFACT; // en un visor restringido no hay descargas ni impresión

  const LLAVE_COT = 'cotizap.cotizacion.v1';
  // v2: se guarda sólo el PARCHE de lo que el usuario editó (v1 guardaba el objeto completo y dejaba fijos los valores de arranque viejos)
  const LLAVE_MAE = 'cotizap.maestros.v2';
  const LLAVE_MAE_V1 = 'cotizap.maestros.v1';
  const LLAVE_MIGRADO = 'cotizap.maestros.migrado_v1';
  const LLAVE_PENDIENTE = 'cotizap.maestros.pendiente'; // hay cambios en las tablas que todavía no llegaron al almacén del artefacto

  /* ================================================================== */
  /* Estado y persistencia                                              */
  /* ================================================================== */
  const estado = { cot: null, M: null, res: null, sel: null, tab: 'cotizacion', eliminada: null };
  W.estado = estado;

  const guardarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const leerLS = (k) => { try { const t = root.localStorage.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const borrarLS = (k) => { try { root.localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } };

  /** Guardado automático de las tablas maestras: en el artefacto (capacidad db) y, siempre, en este navegador. */
  const Almacen = C.almacen.crear({
    claude: () => root.claude,
    ls: { leer: leerLS, guardar: guardarLS, borrar: borrarLS },
    llavePendiente: LLAVE_PENDIENTE,
    alEstado: (e, info) => { if (W.maestrosUI) W.maestrosUI.mostrarGuardado(e, info); },
  });
  W.almacen = Almacen;
  const idNuevo = () => `p${Math.random().toString(36).slice(2, 8)}`;
  /** Fecha de hoy (AAAA-MM-DD) en la hora LOCAL: toISOString() da la fecha UTC y de noche, en México, ya sería «mañana». */
  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function cotizacionEjemplo() {
    const base = { cantidad: 1, material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', clase_sellado: 'C', ref_diametro: 'INTERIOR' };
    const P = (o) => ({ id: idNuevo(), ...base, ...o });
    return {
      cliente: 'Cliente de ejemplo', proyecto: 'Colector de polvo · línea 2', fecha: hoy(), vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm',
      riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: ubicacionPorOmision(), ejemplo: true,
      partidas: [
        P({ familia: 'RECTO', descripcion: 'Tramo recto Ø12″ × 3 m', D_mm: 304.8, L_mm: 3000, tipo_costura: 'A_TOPE', cantidad: 4 }),
        P({ familia: 'CODO', descripcion: 'Codo 90° · 5 gajos Ø12″', D_mm: 304.8, theta_deg: 90, k_R: 1.5, cantidad: 2 }),
        P({ familia: 'REDUCCION', descripcion: 'Reducción excéntrica Ø12″ → Ø8″', D1_mm: 304.8, D2_mm: 203.2, excentrica: 'CARA_PLANA' }),
        P({ familia: 'RAMAL', descripcion: 'Injerto simple a 45° Ø8″ sobre Ø12″', D_mm: 304.8, d_mm: 203.2, L_cuerpo_mm: 700, L_ramal_mm: 450, beta_deg: 45, cantidad: 2 }),
        P({ familia: 'REDUCCION_INJERTO', descripcion: 'Reducción con injerto 45° Ø12″ → Ø10″ + Ø6″', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 }),
        P({ familia: 'TRANSICION', descripcion: 'Transición Ø12″ → 400 × 300 mm', D_mm: 304.8, a_mm: 400, b_mm: 300 }),
        { id: idNuevo(), familia: 'COMPRADO', descripcion: 'Compuerta de guillotina Ø12″ (compra)', precio_compra_unitario: 1850, peso_kg: 9, cantidad: 1 },
        { id: idNuevo(), familia: 'SOPORTE', descripcion: 'Ménsulas de ángulo 1¼″ (brazo y pierna de 650 mm)', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, anclajes_pieza: 4, cantidad: 6 },
        { id: idNuevo(), familia: 'INSTALACION', descripcion: 'Instalación en obra (2 personas, 2 días)', personas: 2, dias: 2, viajes: 1, gasolina_viaje: 600, comida_dia: 200, cantidad: 1 },
      ],
    };
  }

  /** Dónde va instalado el ducto cuando nadie lo dice: lo que traen las tablas (interior, bajo techo). */
  function ubicacionPorOmision() {
    const P = estado.M && estado.M.proceso && estado.M.proceso.pintura;
    return P && C.material.UBICACIONES.includes(P.ubicacion_defecto) ? P.ubicacion_defecto : 'INTERIOR';
  }

  function cotizacionVacia() {
    return {
      cliente: '', proyecto: '', fecha: hoy(), vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm', riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: ubicacionPorOmision(), ejemplo: false, partidas: [], gastos: [],
    };
  }

  function cargarEstado() {
    const base = C.maestros.crearMaestros();
    let parche = leerLS(LLAVE_MAE);
    if (!leerLS(LLAVE_MIGRADO)) {
      // Una sola vez: los precios que se capturaron con la versión 1 (que guardaba los maestros completos) no se pierden.
      const v1 = leerLS(LLAVE_MAE_V1);
      if (v1 && (!parche || !Object.keys(parche).length)) {
        parche = C.almacen.parcheDesdeV1(base, v1);
        guardarLS(LLAVE_MAE, parche);
      }
      guardarLS(LLAVE_MIGRADO, true);
    }
    estado.M = parche ? C.maestros.crearMaestros(parche) : base; // sólo entra lo que tiene la forma de las tablas
    estado.cot = cotizacionValida(leerLS(LLAVE_COT), estado.M) || cotizacionEjemplo();
    if (estado.cot.ejemplo === true) {
      // La cotización de muestra que nadie ha tocado se renueva con la versión actual de la muestra (nombres de taller,
      // partidas nuevas); se respetan los ajustes generales que ya hubiera cambiado.
      const guardada = estado.cot;
      estado.cot = cotizacionValida({
        ...cotizacionEjemplo(),
        ...Object.fromEntries(['unidad_diam', 'unidad_long', 'riesgo', 'servicio', 'ubicacion', 'fecha', 'vigencia_dias', 'parametros', 'yarda_mm', 'venta_pactada', 'venta_pactada_con_iva', 'piezas_enteras', 'gastos'].filter((k) => guardada[k] !== undefined).map((k) => [k, guardada[k]])),
      }, estado.M);
    }
    estado.sel = estado.cot.partidas.length ? estado.cot.partidas[0].id : null;
  }

  /** Cotizaciones guardadas con la unidad única anterior pasan a unidades por eje. */
  function migrarUnidades(cot) {
    if (cot.unidad && !cot.unidad_diam) { cot.unidad_diam = cot.unidad; cot.unidad_long = 'mm'; }
    delete cot.unidad;
    if (!cot.unidad_diam) cot.unidad_diam = 'in';
    if (!cot.unidad_long) cot.unidad_long = 'mm';
  }

  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  /**
   * Un gasto real capturado, con la forma que espera la pantalla: lo que no sirve se repone y un número que no es número
   * queda vacío (el control de gastos lo marca). `estimado`: vino de la lista de compras y todavía no se cambia por lo real.
   */
  function gastoValido(g) {
    const G = C.gastos;
    const num = (v) => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : '';
      return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : '';
    };
    const categoria = Object.prototype.hasOwnProperty.call(G.CATEGORIAS, g.categoria) ? g.categoria : 'OTROS';
    return {
      id: typeof g.id === 'string' && g.id ? g.id : idNuevo(),
      fecha: typeof g.fecha === 'string' ? g.fecha.slice(0, 10) : '',
      concepto: typeof g.concepto === 'string' ? g.concepto.slice(0, 200) : '',
      categoria,
      cantidad: num(g.cantidad),
      precio_unitario: num(g.precio_unitario),
      iva_incluido: g.iva_incluido === true,
      con_factura: typeof g.con_factura === 'boolean' ? g.con_factura : !G.SIN_FACTURA_POR_DEFECTO.includes(categoria),
      ...(g.estimado === true ? { estimado: true } : {}),
    };
  }

  /**
   * Una cotización que viene de fuera (navegador o archivo): conserva lo que tiene la forma esperada y repone el resto
   * (textos, unidades, riesgo, servicio, parámetros, id únicos de las partidas). null si ni siquiera trae una lista de partidas.
   * Lo que no se puede calcular (medidas absurdas, familia desconocida) se deja tal cual: el motor lo marca partida por partida.
   */
  function cotizacionValida(c, M) {
    if (!esObjeto(c) || !Array.isArray(c.partidas)) return null;
    const vacia = cotizacionVacia();
    const crudo = { ...c };
    migrarUnidades(crudo);
    const cot = { ...vacia, ...crudo };
    ['cliente', 'proyecto', 'fecha'].forEach((k) => { if (typeof cot[k] !== 'string') cot[k] = typeof cot[k] === 'number' ? String(cot[k]) : vacia[k]; });
    if (!(Number.isFinite(cot.vigencia_dias) && cot.vigencia_dias >= 0)) cot.vigencia_dias = vacia.vigencia_dias;
    if (!['in', 'mm'].includes(cot.unidad_diam)) cot.unidad_diam = vacia.unidad_diam;
    if (!['mm', 'm', 'in'].includes(cot.unidad_long)) cot.unidad_long = vacia.unidad_long;
    if (!Object.keys(M.capas.imprevistos_pct).includes(cot.riesgo)) cot.riesgo = vacia.riesgo;
    if (!Object.keys(M.servicios).includes(cot.servicio)) cot.servicio = vacia.servicio;
    if (!C.material.UBICACIONES.includes(cot.ubicacion)) cot.ubicacion = vacia.ubicacion;
    if (cot.parametros !== undefined && !esObjeto(cot.parametros)) delete cot.parametros;
    // Ancho de la yarda de la cotización: sólo vale uno dentro de los límites de las tablas (vacío o inválido = el de las tablas)
    const yarda = C.cotizador.yardaDeCotizacion(cot, M).yarda_mm;
    if (yarda === undefined) delete cot.yarda_mm; else cot.yarda_mm = yarda;
    // Venta pactada con el cliente, como se capturó (con IVA sólo si se marcó): sólo un importe válido (vacío o inválido = no hay);
    // cobrar el sobrante, sólo sí/no
    const venta = C.cotizador.ventaPactada(cot).capturada;
    if (venta === undefined) delete cot.venta_pactada; else cot.venta_pactada = venta;
    if (venta === undefined || cot.venta_pactada_con_iva !== true) delete cot.venta_pactada_con_iva;
    if (cot.piezas_enteras !== true) delete cot.piezas_enteras;
    const vistosG = new Set();
    cot.gastos = (Array.isArray(c.gastos) ? c.gastos : []).filter(esObjeto).slice(0, 5000).map((g) => {
      const q = gastoValido(g);
      while (vistosG.has(q.id)) q.id = idNuevo();
      vistosG.add(q.id);
      return q;
    });
    cot.ejemplo = cot.ejemplo === true;
    const vistos = new Set();
    cot.partidas = c.partidas.filter(esObjeto).map((p) => {
      const q = { ...C.validacion.migrarPartida({ ...p }) }; // lo guardado con campos de versiones anteriores pasa a los de hoy
      if (q.descripcion !== undefined && typeof q.descripcion !== 'string') q.descripcion = typeof q.descripcion === 'number' ? String(q.descripcion) : '';
      while (typeof q.id !== 'string' || !q.id || vistos.has(q.id)) q.id = idNuevo();
      vistos.add(q.id);
      return q;
    });
    return cot;
  }
  const unidades = () => ({ diam: estado.cot.unidad_diam, long: estado.cot.unidad_long });

  /** Sólo lo que el usuario cambió respecto de los valores de arranque. */
  const parcheMaestros = () => U.diferencia(C.maestros.crearMaestros(), estado.M);

  function persistir() {
    const parche = parcheMaestros();
    guardarLS(LLAVE_COT, estado.cot);
    guardarLS(LLAVE_MAE, parche);
    Almacen.programar(parche); // al artefacto, tras una pausa corta y sólo si el parche cambió
  }

  /**
   * Aplica lo guardado en el artefacto. Lo que el usuario cambió en las tablas mientras se consultaba el almacén
   * (`arranque` es el parche con el que abrió la página) se conserva encima de lo guardado.
   */
  function aplicarRemoto(remoto, arranque) {
    const base = C.maestros.crearMaestros();
    const ediciones = U.diferencia(U.mezclar(base, arranque), estado.M);
    estado.M = U.mezclar(C.maestros.crearMaestros(remoto), ediciones); // lo del almacén compartido también se sanea: puede traerlo otra versión o un colaborador
    persistir();
    render();
    if (estado.tab === 'maestros' && W.maestrosUI) {
      const cuerpo = $('#maestros-cuerpo');
      if (cuerpo.contains(document.activeElement)) {
        // No se reconstruye el editor bajo el cursor: se actualiza al soltar el campo.
        cuerpo.addEventListener('focusout', () => setTimeout(() => W.maestrosUI.render(), 0), { once: true });
      } else W.maestrosUI.render();
    }
  }

  /** Lo que se cotiza: la cotización abierta tal como la calcula la pantalla. */
  const entradaCotizacion = () => {
    const cot = estado.cot;
    return {
      riesgo: cot.riesgo, servicio: cot.servicio, ubicacion: cot.ubicacion, parametros: cot.parametros, yarda_mm: cot.yarda_mm,
      venta_pactada: cot.venta_pactada, venta_pactada_con_iva: cot.venta_pactada_con_iva === true, piezas_enteras: cot.piezas_enteras === true, partidas: cot.partidas,
    };
  };

  function calcular() {
    const cot = estado.cot;
    try {
      estado.res = C.cotizador.cotizar(entradaCotizacion(), estado.M);
    } catch (err) {
      // No debería pasar (cotizar() atrapa lo que falle en cada partida): si pasa, la pantalla sigue viva y lo dice.
      const msg = `No se pudo calcular la cotización (${String((err && err.message) || err)}). Revise las tablas maestras.`;
      estado.res = C.cotizador.cotizar({ partidas: [] }, C.maestros.crearMaestros());
      estado.res.partidas = cot.partidas.map((p, indice) => ({ ok: false, indice, interno: true, errores: [msg], entrada: p }));
      estado.res.totales.n_partidas_error = cot.partidas.length;
      estado.res.avisos = [msg];
    }
  }

  /* ================================================================== */
  /* Utilidades de presentación                                         */
  /* ================================================================== */
  const NOMBRE_FAM = Object.assign(Object.create(null), Object.fromEntries([...W.FAMILIAS, ...W.FAMILIAS_RETIRADAS]));
  const ETQ_OP = Object.assign(Object.create(null), Object.fromEntries([...W.OPERACIONES, ...W.OPERACIONES_EXTRA]));
  const esLamina = (fam) => W.esDeLamina(fam);
  const nombreMaterial = (p) => {
    const m = estado.M.materiales[p.material_id];
    return m ? m.nombre.split(' (')[0] : p.material_id;
  };
  const resumenMaterial = (p) => (!esLamina(p.familia) ? '' : `${nombreMaterial(p)} · ${p.espesor_mm > 0 ? `${p.espesor_mm} mm` : `cal. ${p.calibre}`}`);
  /**
   * Título de una partida: su descripción; sin ella, la del artículo del catálogo (lo comprado), el nombre de la pieza como en
   * los planos de pedido («Reducción de 11″ a 10″ con injerto de 5″ a 30°») o el de la familia.
   */
  const tituloPartida = (p) => {
    if (p.descripcion) return p.descripcion;
    const art = p.familia === 'COMPRADO' && p.articulo_id && estado.M.compras.articulos[p.articulo_id];
    if (art && art.descripcion) return art.descripcion;
    return C.planos.titulo(p) || NOMBRE_FAM[p.familia];
  };
  /** El dibujo acotado de una partida calculada (o null si su familia no se dibuja). opciones: las de planos.arbol. */
  function figuraPlano(f, opciones) {
    const d = f && f.ok ? C.planos.plano(f, estado.res.maestros) : null;
    return d ? W.svgArbol(C.planos.arbol(d, opciones)) : null;
  }
  /** Miniatura de la pieza para la lista (o el ícono de su familia). */
  const miniatura = (p, f) => h('span', { class: 'mini-plano' }, figuraPlano(f, { px: 64, alto_max: 44, compacto: true }) || W.iconoFamilia(p.familia));
  const dims = (p) => W.resumenDims(p, unidades(), estado.M);
  /** Las partidas que suman al total: las del usuario que se calcularon y las automáticas (el sobrante de comprar piezas enteras). */
  const filasOk = (R) => [...R.partidas.filter((f) => f.ok), ...(R.automaticas || [])];

  function toast(msg, accion) {
    const cont = $('#toasts');
    const t = h('div', { class: 'toast', role: 'status' }, h('span', null, msg));
    if (accion) {
      t.append(h('button', { type: 'button', class: 'btn-texto', onclick: () => { accion.fn(); t.remove(); } }, accion.texto));
    }
    cont.append(t);
    setTimeout(() => t.remove(), accion ? 8000 : 4500);
  }

  function tile(etiqueta, valor, sub, clase) {
    return h('div', { class: `tile ${clase || ''}` },
      h('div', { class: 'tile-et' }, etiqueta),
      h('div', { class: 'tile-val' }, valor),
      sub ? h('div', { class: 'tile-sub' }, sub) : null);
  }

  /** Tabla con columnas [{t, num}] y filas [[celdas] | {celdas, clase}]. */
  function tabla(cols, filas) {
    return h('div', { class: 'tabla-env' },
      h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.num ? 'num' : '', scope: 'col' }, c.t)))),
        h('tbody', null, filas.map((f) => {
          const celdas = Array.isArray(f) ? f : f.celdas;
          return h('tr', { class: Array.isArray(f) ? '' : f.clase || '' }, celdas.map((c, i) => h('td', { class: cols[i].num ? 'num' : '' }, c)));
        }))));
  }

  /** replaceChildren seguro: ignora null/false (que de otro modo se insertarían como texto). */
  const reemplazar = (cont, ...nodos) => cont.replaceChildren(...nodos.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));

  /** 16 % · 8.5 %: sin decimales cuando sobran. */
  const pctCorto = (x) => W.pct(x, Number.isInteger(Number((x * 100).toFixed(6))) ? 0 : 1);

  const kv = (et, val, un) => h('div', { class: 'kv' }, h('dt', null, et), h('dd', null, val, un ? h('span', { class: 'un' }, ` ${un}`) : null));

  function seccion(titulo, hijos, abierta, nota) {
    return h('details', { class: 'sec', open: abierta },
      h('summary', null, h('span', { class: 'sec-tit' }, titulo), nota ? h('span', { class: 'sec-nota' }, nota) : null),
      h('div', { class: 'sec-cuerpo' }, hijos));
  }

  /* ================================================================== */
  /* Barra de composición del precio (parte-todo)                       */
  /* ================================================================== */
  const SERIES = [
    { clave: 'mat', etiqueta: 'Materiales y consumibles', css: 'var(--s1)', on: 'var(--on-s1)' },
    { clave: 'mo', etiqueta: 'Mano de obra, equipo y terceros', css: 'var(--s2)', on: 'var(--on-s2)' },
    { clave: 'ci', etiqueta: 'Indirectos de fábrica y administración', css: 'var(--s3)', on: 'var(--on-s3)' },
    { clave: 'imp', etiqueta: 'Imprevistos y financiamiento', css: 'var(--s4)', on: 'var(--on-s4)' },
    { clave: 'util', etiqueta: 'Utilidad y comisión', css: 'var(--s5)', on: 'var(--on-s5)' },
    { clave: 'via', etiqueta: 'Viáticos y gastos de obra', css: 'var(--s6)', on: 'var(--on-s6)' },
  ];

  function composicion(filas) {
    const v = { mat: 0, mo: 0, ci: 0, imp: 0, util: 0, via: 0 };
    filas.forEach((f) => {
      const s = f.costos.subtotales;
      v.mat += s.materiales + s.consumibles;
      v.mo += s.mano_obra + s.equipo + s.herramienta_menor + s.subcontratos;
      v.via += s.viaticos || 0;
      v.ci += f.pila.CI;
      v.imp += f.pila.imprevistos + f.pila.financiamiento;
      v.util += f.pila.utilidad + f.pila.comision + f.pila.otros + (f.precio.total_sin_redondeo - f.pila.precio);
    });
    return v;
  }

  let tooltipEl = null;
  function mostrarTip(ev, et, valor) {
    if (!tooltipEl) { tooltipEl = h('div', { class: 'tip', role: 'tooltip' }); document.body.append(tooltipEl); }
    tooltipEl.replaceChildren(h('div', { class: 'tip-val' }, valor), h('div', { class: 'tip-et' }, et));
    tooltipEl.style.display = 'block';
    const r = tooltipEl.getBoundingClientRect();
    let x = ev.clientX + 12;
    let y = ev.clientY - r.height - 10;
    if (ev.type === 'focus') { const b = ev.target.getBoundingClientRect(); x = b.left; y = b.top - r.height - 8; }
    x = Math.max(8, Math.min(x, root.innerWidth - r.width - 8));
    if (y < 8) y += r.height + 24;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }
  const ocultarTip = () => { if (tooltipEl) tooltipEl.style.display = 'none'; };

  function barraComposicion(v, titulo) {
    const total = U.suma(v);
    const segs = SERIES.map((s) => ({ ...s, valor: v[s.clave], p: total > 0 ? v[s.clave] / total : 0 })).filter((s) => s.valor > 0);
    const resumen = segs.map((s) => `${s.etiqueta} ${W.pct(s.p, 0)}`).join(', ');
    const barra = h('div', { class: 'comp-barra', role: 'img', 'aria-label': `${titulo}: ${resumen}` },
      segs.map((s) => {
        const el = h('div', {
          class: 'seg', style: `flex:${s.valor} 1 0; background:${s.css}`, tabindex: '0', 'aria-label': `${s.etiqueta}: ${W.mxn(s.valor)}, ${W.pct(s.p, 1)}`,
        }, h('span', { class: 'seg-txt', style: `color:${s.on}` }, W.pct(s.p, 0)));
        const tip = (ev) => mostrarTip(ev, s.etiqueta, `${W.mxn(s.valor)} · ${W.pct(s.p, 1)}`);
        el.addEventListener('pointermove', tip);
        el.addEventListener('pointerleave', ocultarTip);
        el.addEventListener('focus', tip);
        el.addEventListener('blur', ocultarTip);
        return el;
      }));
    const leyenda = h('ul', { class: 'comp-ley' }, segs.map((s) => h('li', null,
      h('span', { class: 'sw', style: `background:${s.css}` }),
      h('span', { class: 'ley-et' }, s.etiqueta),
      h('span', { class: 'ley-val' }, W.mxn(s.valor)),
      h('span', { class: 'ley-p' }, W.pct(s.p, 1)))));
    const fig = h('figure', { class: 'comp' }, h('figcaption', null, titulo), barra, leyenda);
    // las etiquetas dentro del segmento sólo se muestran cuando caben con holgura
    requestAnimationFrame(() => $$('.seg', fig).forEach((el) => { el.classList.toggle('con-txt', el.offsetWidth >= 46); }));
    return fig;
  }

  /* ================================================================== */
  /* Encabezado de la cotización                                        */
  /* ================================================================== */
  function sincronizarEncabezado() {
    const c = estado.cot;
    ['cliente', 'proyecto', 'fecha', 'vigencia_dias', 'unidad_diam', 'unidad_long', 'riesgo', 'servicio', 'ubicacion'].forEach((k) => {
      const el = $(`#c_${k}`);
      if (el && document.activeElement !== el) el.value = c[k] === undefined ? '' : c[k];
    });
    // Ancho de la yarda: las opciones salen de las tablas maestras (pueden cambiar) y un ancho guardado que no está en la lista se muestra tal cual
    const sel = $('#c_yarda_mm');
    const valor = c.yarda_mm === undefined ? '' : String(c.yarda_mm);
    let ops = opcionesDe('yardas_cotizacion');
    if (valor !== '' && !ops.some(([v]) => v === valor)) ops = [...ops, [valor, `${valor} mm`]];
    const firma = JSON.stringify(ops);
    if (sel.dataset.ops !== firma) {
      sel.dataset.ops = firma;
      sel.replaceChildren(...ops.map(([v, t]) => h('option', { value: v }, t)));
    }
    if (document.activeElement !== sel) sel.value = valor;
  }

  function enlazarEncabezado() {
    ['cliente', 'proyecto', 'fecha', 'vigencia_dias', 'unidad_diam', 'unidad_long', 'riesgo', 'servicio', 'ubicacion'].forEach((k) => {
      const el = $(`#c_${k}`);
      el.addEventListener('input', () => {
        estado.cot[k] = k === 'vigencia_dias' ? Number(el.value) || 0 : el.value;
        if (estado.cot.ejemplo && (k === 'cliente' || k === 'proyecto')) estado.cot.ejemplo = false;
        persistir();
        render();
      });
    });
    $('#c_yarda_mm').addEventListener('change', (ev) => {
      if (ev.target.value === '') delete estado.cot.yarda_mm; else estado.cot.yarda_mm = Number(ev.target.value);
      persistir();
      render();
    });
  }

  /* ================================================================== */
  /* Parámetros de precio de la cotización (anulan a las tablas maestras) */
  /* ================================================================== */
  const PARAMS = W.PARAMETROS_COT;
  const ctlParam = {};
  const aPantalla = (d, v) => (d.pct ? Number((v * 100).toFixed(6)) : v);
  const dePantalla = (d, n) => (d.pct ? Number((n / 100).toFixed(9)) : n);
  const deMaestros = (d) => C.cotizador.parametroDeMaestros(estado.M, d.clave);
  const propio = (d) => (estado.cot.parametros ? estado.cot.parametros[d.clave] : undefined);
  const modificado = (d) => propio(d) !== undefined && Math.abs(propio(d) - deMaestros(d)) >= 1e-9;
  const tx = (d, v) => `${Number(aPantalla(d, v).toFixed(2))}\u00a0${d.pct ? '%' : 'días'}`; // 20 % · 22.5 % · 45 días (sin partirse en dos renglones)

  function crearParametros() {
    PARAMS.forEach((d) => {
      const id = `c_${d.id}`;
      const el = h('input', { id, type: 'number', min: String(d.min), max: String(d.max), step: String(d.paso), inputmode: d.entero ? 'numeric' : 'decimal', 'aria-describedby': `${id}_nota` });
      const nota = h('div', { class: 'ayuda param-nota', id: `${id}_nota` });
      const reset = h('button', { type: 'button', class: 'btn-texto param-reset', hidden: true, onclick: () => restablecerParametro(d) }, 'Restablecer');
      const campo = h('div', { class: 'campo campo-param', dataset: { param: d.id } },
        h('label', { for: id }, d.etiqueta),
        h('div', { class: `ctl${d.entero ? ' ctl-dias' : ''}` }, el, h('span', { class: 'sufijo' }, d.sufijo)),
        h('div', { class: 'param-pie' }, nota, reset));
      $(d.grupo === 'mas' ? '#c_parametros_mas_cuerpo' : '#c_parametros').append(campo);
      ctlParam[d.id] = { el, nota, reset, campo };
      el.addEventListener('input', () => editarParametro(d));
      el.addEventListener('blur', () => sincronizarParametros());
    });
  }

  function editarParametro(d) {
    const { el, nota, campo } = ctlParam[d.id];
    const crudo = el.value.trim();
    const par = estado.cot.parametros || (estado.cot.parametros = {});
    if (crudo === '') {
      delete par[d.clave]; // vacío = el de las tablas maestras
    } else {
      const n = Number(crudo);
      const valido = Number.isFinite(n) && n >= d.min && n <= d.max && (!d.entero || Number.isInteger(n));
      campo.classList.toggle('invalido', !valido);
      el.setAttribute('aria-invalid', String(!valido));
      if (!valido) { nota.textContent = `Debe ser ${d.entero ? 'un entero ' : ''}de ${d.min} a ${d.max}${d.pct ? ' %' : ' días'}.`; return; }
      const v = dePantalla(d, n);
      if (Math.abs(v - deMaestros(d)) < 1e-9) delete par[d.clave]; else par[d.clave] = v;
    }
    if (!Object.keys(par).length) delete estado.cot.parametros;
    persistir();
    render();
  }

  function restablecerParametro(d) {
    if (estado.cot.parametros) delete estado.cot.parametros[d.clave];
    if (estado.cot.parametros && !Object.keys(estado.cot.parametros).length) delete estado.cot.parametros;
    persistir();
    render();
  }

  /** Pone en cada campo el valor que vale (el propio o el de las tablas), marca los modificados y escribe su nota. */
  function sincronizarParametros(abrirMas) {
    if (!ctlParam.utilidad) return;
    const R = estado.res;
    const ok = R ? filasOk(R) : [];
    const piso = ok.reduce((t, f) => t + f.indicadores.precio_piso, 0);
    const sub = R ? R.totales.subtotal : 0;
    PARAMS.forEach((d) => {
      const { el, nota, reset, campo } = ctlParam[d.id];
      const mod = modificado(d);
      const valor = propio(d) !== undefined ? propio(d) : deMaestros(d);
      if (document.activeElement !== el) {
        el.value = String(aPantalla(d, valor));
        campo.classList.remove('invalido');
        el.removeAttribute('aria-invalid');
      }
      if (!campo.classList.contains('invalido')) {
        const partes = [d.base];
        if (d.id === 'utilidad') partes.push(`equivale a ${W.num((valor / (1 - valor)) * 100, 1)}\u00a0% sobre el costo`);
        if (d.id === 'descuento' && sub > 0) partes.push(`hasta ${W.num(Math.max(0, 1 - piso / sub) * 100, 1)}\u00a0% sin perder utilidad`);
        if (mod) partes.push(`maestros: ${tx(d, deMaestros(d))}`);
        nota.textContent = partes.join(' · ');
      }
      campo.classList.toggle('modificado', mod);
      reset.hidden = !mod;
    });
    const nMas = PARAMS.filter((d) => d.grupo === 'mas' && modificado(d)).length;
    $('#c_mas_n').textContent = nMas ? ` · ${nMas} ${nMas === 1 ? 'modificado' : 'modificados'}` : '';
    if (abrirMas && nMas) $('#c_parametros_mas').open = true;
  }

  /* ================================================================== */
  /* Lista de partidas                                                  */
  /* ================================================================== */
  function seleccionar(id) {
    estado.sel = id;
    $$('#lista-partidas .partida').forEach((li) => {
      const s = li.dataset.id === id;
      li.classList.toggle('sel', s);
      $('.partida-main', li).setAttribute('aria-pressed', String(s));
    });
    renderDetalle();
    const det = $('#detalle');
    if (det && root.matchMedia('(max-width: 1099px)').matches) det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filaPartida(p, i) {
    const f = estado.res.partidas[i];
    const sel = p.id === estado.sel;
    const adv = f && f.ok ? f.advertencias.length : 0;
    const chips = [];
    if (f && !f.ok) chips.push(h('span', { class: 'chip chip-err', title: f.errores.join('\n') }, W.icono('error'), 'Revisar datos'));
    if (adv) chips.push(h('span', { class: 'chip chip-adv', title: f.advertencias.join('\n') }, W.icono('aviso'), `${adv} ${adv === 1 ? 'aviso' : 'avisos'}`));
    const activar = () => seleccionar(p.id);
    const li = h('li', { class: `partida${sel ? ' sel' : ''}${f && !f.ok ? ' err' : ''}`, dataset: { id: p.id } },
      h('div', {
        class: 'partida-main', role: 'button', tabindex: '0', 'aria-pressed': String(sel),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activar(); } },
      },
      miniatura(p, f),
      h('div', { class: 'partida-txt' },
        h('div', { class: 'partida-titulo' }, tituloPartida(p)),
        h('div', { class: 'partida-meta' }, [dims(p), resumenMaterial(p)].filter(Boolean).join(' · ')),
        chips.length ? h('div', { class: 'partida-chips' }, chips) : null)),
      h('div', { class: 'partida-der' },
        h('div', { class: 'partida-cifras' },
          h('div', { class: 'partida-cant' }, `${p.cantidad} × ${f && f.ok ? W.mxn(f.precio.unitario) : '—'}`),
          h('div', { class: 'partida-importe' }, f && f.ok ? W.mxn(f.precio.importe) : '—')),
        h('div', { class: 'partida-acc' },
          h('button', { type: 'button', class: 'btn-icono', 'aria-label': `Editar ${tituloPartida(p)}`, title: 'Editar', onclick: () => abrirDialogo(p.id) }, W.icono('editar')),
          h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Duplicar', title: 'Duplicar', onclick: () => duplicar(p.id) }, W.icono('copiar')),
          h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Eliminar', title: 'Eliminar', onclick: () => eliminar(p.id) }, W.icono('basura')))));
    li.addEventListener('click', (e) => { if (!e.target.closest('.partida-acc')) activar(); });
    return li;
  }

  function renderPartidas() {
    const ul = $('#lista-partidas');
    const ps = estado.cot.partidas;
    if (!ps.length) {
      reemplazar(ul, h('li', { class: 'vacio' },
        h('p', { class: 'vacio-tit' }, 'Todavía no hay partidas'),
        h('p', null, 'Agregue tramos rectos, codos, reducciones, transiciones, injertos o piezas compradas. El precio se calcula mientras captura.'),
        h('div', { class: 'vacio-acc' },
          h('button', { type: 'button', class: 'btn btn-primario', onclick: () => abrirDialogo(null) }, W.icono('mas'), 'Agregar la primera partida'),
          h('button', { type: 'button', class: 'btn btn-sec', onclick: () => W.planosUI.verEjemplo() }, 'Ver un pedido de ejemplo'))));
      return;
    }
    reemplazar(ul, ps.map(filaPartida), (estado.res.automaticas || []).map(filaAutomatica));
  }

  /** La partida que agrega el cálculo (el sobrante de comprar piezas enteras): se ve en la lista pero no se edita aquí. */
  function filaAutomatica(f) {
    return h('li', { class: 'partida partida-auto', dataset: { auto: f.familia } },
      h('div', { class: 'partida-main' },
        W.iconoFamilia(f.familia),
        h('div', { class: 'partida-txt' },
          h('div', { class: 'partida-titulo' }, f.descripcion),
          h('div', { class: 'partida-meta' }, `Costo ${W.mxn(f.costos.CD)} sin IVA · partida automática: se cobra porque la cotización pide piezas enteras`),
          h('div', { class: 'partida-chips' }, h('span', { class: 'chip chip-auto' }, W.icono('info'), 'Automática')))),
      h('div', { class: 'partida-der' },
        h('div', { class: 'partida-cifras' },
          h('div', { class: 'partida-cant' }, `1 × ${W.mxn(f.precio.unitario)}`),
          h('div', { class: 'partida-importe' }, W.mxn(f.precio.importe))),
        h('div', { class: 'partida-acc' },
          h('button', { type: 'button', class: 'btn-texto', onclick: () => irPestana('compras', '#cg-lista') }, 'Ver la lista de compras'))));
  }

  function duplicar(id) {
    const i = estado.cot.partidas.findIndex((p) => p.id === id);
    if (i < 0) return;
    const copia = U.clonar(estado.cot.partidas[i]);
    copia.id = idNuevo();
    copia.descripcion = `${tituloPartida(copia)} (copia)`;
    estado.cot.partidas.splice(i + 1, 0, copia);
    estado.sel = copia.id;
    persistir();
    render();
  }

  function eliminar(id) {
    const i = estado.cot.partidas.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = estado.cot.partidas.splice(i, 1);
    estado.eliminada = { p, i };
    if (estado.sel === id) estado.sel = estado.cot.partidas[Math.min(i, estado.cot.partidas.length - 1)]?.id || null;
    persistir();
    render();
    toast('Partida eliminada', {
      texto: 'Deshacer',
      fn: () => {
        if (!estado.eliminada) return;
        estado.cot.partidas.splice(estado.eliminada.i, 0, estado.eliminada.p);
        estado.sel = estado.eliminada.p.id;
        estado.eliminada = null;
        persistir();
        render();
      },
    });
  }

  /* ================================================================== */
  /* Totales                                                            */
  /* ================================================================== */
  function renderTotales() {
    const R = estado.res;
    const T = R.totales;
    const ok = filasOk(R);
    const piso = ok.reduce((s, f) => s + f.indicadores.precio_piso, 0);
    const margenMax = T.subtotal > 0 ? 1 - piso / T.subtotal : 0; // cuánto se puede descontar del precio de lista antes de perder la utilidad
    const bajoPiso = ok.length > 0 && T.subtotal_neto < piso - 0.005;
    const hMOD = ok.filter((f) => f.familia !== 'INSTALACION').reduce((s, f) => s + f.costos.h_MOD, 0);
    const hObra = ok.filter((f) => f.familia === 'INSTALACION').reduce((s, f) => s + f.costos.h_MOD, 0);
    const auto = (R.automaticas || []).reduce((s, f) => s + f.precio.importe, 0);
    const cont = $('#totales');
    const resumen = [`Subtotal ${W.mxn(T.subtotal)}`];
    if (T.descuento > 0) resumen.push(`Descuento ${pctCorto(T.descuento_pct)} −${W.mxn(T.descuento)}`);
    resumen.push(`IVA ${pctCorto(T.iva_pct)} ${W.mxn(T.iva)}`);
    reemplazar(cont,
      h('div', { class: 'hero' },
        h('div', { class: 'hero-et' }, 'Total con IVA'),
        h('div', { class: 'hero-val' }, W.mxn(T.total)),
        h('div', { class: 'hero-sub' }, resumen.join(' · '))),
      h('div', { class: 'tiles' },
        tile('Peso neto', `${W.num(T.peso_neto_kg, 1)} kg`, `${T.n_partidas_ok} ${T.n_partidas_ok === 1 ? 'partida' : 'partidas'}${auto > 0 ? ' + sobrante' : ''}${T.n_partidas_error ? ` · ${T.n_partidas_error} con error` : ''}`),
        tile('Precio por kg neto', T.precio_por_kg_neto ? `${W.mxn(T.precio_por_kg_neto)}` : '—', 'antes de IVA'),
        tile('Mano de obra directa', `${W.num(hMOD, 1)} h`, hObra > 0 ? `de taller · más ${W.num(hObra, 1)} h en obra` : 'horas reales de taller'),
        tile('Piso de negociación', W.mxn(piso), bajoPiso ? 'El descuento deja el precio por debajo del piso' : ok.length ? `hasta −${W.num(margenMax * 100, 1)} % con utilidad cero` : '', bajoPiso ? 'tile-adv' : ''),
        tile('Utilidad', W.mxn(T.utilidad), ok.length ? `${W.num(T.margen_real_pct * 100, 1)} % del precio${T.descuento > 0 ? ' con el descuento' : ''}` : '', T.utilidad < 0 ? 'tile-adv' : ''),
        tile('Costo total', W.mxn(T.costo_total), 'directo + indirectos + imprevistos')),
      auto > 0 ? h('p', { class: 'nota' }, W.icono('info'), `Incluye ${W.mxn(auto)} por el material sobrante de comprar piezas enteras (hojas, barras, tornillos y envases completos).`) : null,
      T.venta ? ventaResumen(T) : null,
      ok.length ? barraComposicion(composicion(ok), 'De qué se compone el precio') : null);
  }

  /** La venta pactada contra lo calculado: lo que se gana (o pierde) y si cubre el precio mínimo. */
  function ventaResumen(T) {
    const V = T.venta;
    const clase = V.utilidad < 0 ? (V.cubre_costo_directo ? 'venta-res venta-adv' : 'venta-res venta-mal') : 'venta-res venta-ok';
    const juicio = V.utilidad >= 0 ? 'cubre todo el costo y deja utilidad'
      : V.cubre_costo_directo ? `cubre el costo directo pero no los indirectos: el precio mínimo es ${W.mxn(T.precio_minimo)}`
        : 'ni siquiera cubre el costo directo';
    return h('div', { class: clase, role: 'note' },
      h('div', { class: 'venta-res-cab' },
        h('span', { class: 'venta-res-et' }, 'Venta pactada'),
        h('strong', null, V.con_iva ? `${W.mxn(V.capturada)} con IVA` : `${W.mxn(V.pactada)} + IVA`),
        h('button', { type: 'button', class: 'btn-texto', onclick: () => irPestana('compras') }, 'Compras y gastos')),
      h('p', null, `${V.con_iva ? `Antes de IVA son ${W.mxn(V.pactada)}. ` : ''}Utilidad ${W.mxn(V.utilidad)} (${W.num(V.margen_pct * 100, 1)} %): ${juicio}. Precio calculado ${W.mxn(V.precio_calculado)} (${V.diferencia >= 0 ? '+' : '−'}${W.mxn(Math.abs(V.diferencia))}).`));
  }

  /* ================================================================== */
  /* Desglose de la partida seleccionada                                */
  /* ================================================================== */
  const ETQ_DET = {
    D_int_mm: ['Diámetro interior', 'mm', 2], D_med_mm: ['Diámetro medio (fibra neutra)', 'mm', 3], D_ext_mm: ['Diámetro exterior', 'mm', 3],
    ancho_plantilla_mm: ['Ancho de plantilla B', 'mm', 3], allowance_costura_mm: ['Holgura de costura', 'mm', 1],
    yarda_mm: ['Ancho de la yarda (hoja)', 'mm', 0], n_anillos: ['Yardas (anillos rolados)', '', 0], n_juntas_yardas: ['Juntas engargoladas entre yardas', '', 0], L_capa_mm: ['Largo que se corta', 'mm', 1],
    n_costuras: ['Costuras longitudinales', '', 0], a_med_mm: ['Ancho medio a', 'mm', 2], b_med_mm: ['Alto medio b', 'mm', 2], P_med_mm: ['Perímetro medio', 'mm', 1],
    n_gajos: ['Gajos', '', 0], n_juntas: ['Juntas elípticas', '', 0], alfa_deg: ['Desviación por junta α', '°', 2], R_mm: ['Radio de eje R', 'mm', 1],
    l_gajo_mm: ['Longitud de eje de un gajo', 'mm', 2], L_eje_mm: ['Longitud total de eje', 'mm', 2], L_tangentes_mm: ['Tangentes', 'mm', 1],
    F_arco: ['Factor F vs. recto de igual arco', '', 5], lambda_L_eje_sobre_D: ['λ = L_eje / D', '', 5], kappa_junta: ['κ de la junta elíptica', '', 5],
    P_junta_mm: ['Perímetro de cada junta', 'mm', 1], arco_eje_mm: ['Arco de eje', 'mm', 1],
    L_mm: ['Longitud axial', 'mm', 1], semiangulo_deg: ['Semiángulo', '°', 2], generatriz_conc_mm: ['Generatriz (concéntrica)', 'mm', 1], generatriz_max_mm: ['Generatriz máxima', 'mm', 1],
    A_concentrica_m2: ['Área si fuera concéntrica', 'm²', 4], F_excentricidad: ['Factor de excentricidad', '', 4], F_longitud: ['Factor s/L (sec del semiángulo)', '', 4],
    H_mm: ['Longitud axial', 'mm', 1], H_defecto_mm: ['Longitud automática (15°)', 'mm', 1], A_triangulos_m2: ['Área de los 4 triángulos', 'm²', 4], A_conos_m2: ['Área de los 4 conos', 'm²', 4],
    P_rect_mm: ['Perímetro rectangular', 'mm', 1], P_redonda_mm: ['Perímetro redondo', 'mm', 1], generatriz_ref_mm: ['Generatriz de referencia', 'mm', 1],
    semiangulo_equiv_deg: ['Semiángulo equivalente', '°', 2], A_aprox_semisuma_m2: ['Revisión rápida ½(P₁+P₂)·s', 'm²', 4],
    d_med_mm: ['Diámetro medio del injerto', 'mm', 3], k_d_sobre_D: ['k = d / D', '', 3], beta_deg: ['Ángulo del injerto β', '°', 1], t_medio_mm: ['Distancia media a la silleta', 'mm', 2],
    t_max_mm: ['Distancia máxima a la silleta', 'mm', 2], A_cuerpo_m2: ['Área del tronco (sin orificio)', 'm²', 4], A_ramal_m2: ['Área del injerto', 'm²', 4],
    K_orificio: ['Corrección K del orificio', '', 4], P_orificio_mm: ['Perímetro del orificio', 'mm', 1],
    L_ramal_mm: ['Longitud del injerto', 'mm', 1], L_ramal_auto_mm: ['Longitud automática del injerto', 'mm', 1],
    L_reduccion_mm: ['Longitud de la reducción', 'mm', 1], L_reduccion_auto_mm: ['Largo mínimo de la reducción (automático)', 'mm', 1], A_cono_m2: ['Área del cono de la reducción', 'm²', 4],
    x_silleta_min_mm: ['Silleta: desde el extremo mayor', 'mm', 1], x_silleta_max_mm: ['Silleta: hasta', 'mm', 1], holgura_mm: ['Holgura de la silleta al extremo del cono', 'mm', 1],
    k_entrepierna: ['Factor de entrepierna', '', 3], razon_areas_ramales_tronco: ['Σ áreas ramales / área del tronco', '', 3], A_tronco_m2: ['Área del tronco', 'm²', 4], A_ramales_m2: ['Área de los ramales', 'm²', 4],
  };

  /**
   * Plantillas de un tramo recto sobre la hoja, a escala. La yarda ES el ancho de la hoja (914 ó 1 220 mm): cada plantilla
   * (perímetro B × yarda) ocupa todo el ancho y se corta con un tajo a lo ancho; a lo largo de la hoja caben floor(largo / B).
   */
  function svgHoja(f) {
    const d = f.geometria.detalle;
    const largoH = estado.M.proceso.hoja.largo_mm;
    const anchoH = d.yarda_mm;
    const B = d.ancho_plantilla_mm;
    const nx = Math.floor(largoH / B + 1e-9);
    const cabe = nx >= 1;
    const W_ = 320;
    const s = W_ / largoH;
    const alto = anchoH * s;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, at) => { const e = document.createElementNS(NS, tag); Object.keys(at).forEach((k) => e.setAttribute(k, at[k])); return e; };
    const svg = el('svg', { viewBox: `0 0 ${W_ + 20} ${alto + 34}`, class: 'hoja', role: 'img', 'aria-label': `Plantillas de ${W.num(B, 0)} por ${W.num(anchoH, 0)} mm sobre hoja de ${W.num(anchoH, 0)} por ${W.num(largoH, 0)} mm` });
    svg.append(el('rect', { x: 10, y: 6, width: W_, height: alto, class: 'hoja-borde' }));
    if (cabe) {
      for (let ix = 0; ix < nx; ix += 1) svg.append(el('rect', { x: 10 + ix * B * s, y: 6, width: B * s, height: alto, class: 'hoja-pieza' }));
      const t = el('text', { x: 10 + (B * s) / 2, y: 6 + alto / 2 + 4, class: 'hoja-txt', 'text-anchor': 'middle' });
      t.textContent = `${W.num(B, 0)} × ${W.num(anchoH, 0)} mm`;
      svg.append(t);
    } else {
      svg.append(el('rect', { x: 10, y: 6, width: Math.min(B * s, W_), height: alto, class: 'hoja-fuera' }));
    }
    const pie = el('text', { x: 10, y: alto + 24, class: 'hoja-txt' });
    pie.textContent = `Hoja ${W.num(anchoH, 0)} × ${W.num(largoH, 0)} mm`;
    svg.append(pie);
    return { svg, cabe, aprov: cabe ? (nx * B) / largoH : 0, porHoja: nx };
  }

  function seccionHoja(f) {
    const r = svgHoja(f);
    const info = r.cabe
      ? h('p', { class: 'nota' }, `Caben ${r.porHoja} ${r.porHoja === 1 ? 'plantilla' : 'plantillas'} por hoja (una por yarda, con un tajo a lo ancho): aprovechamiento geométrico ${W.pct(r.aprov, 1)}. La merma de tabla (${W.pct(f.qto.lam.phi, 0)}) supone reaprovechar parte del retazo en piezas pequeñas.`)
      : h('p', { class: 'nota nota-adv' }, W.icono('aviso'), 'La plantilla de la yarda es más larga que la hoja: cada anillo saldría de varias plantillas, con más costuras longitudinales de las cotizadas.');
    return h('div', { class: 'hoja-fig' }, h('div', { class: 'hoja-env' }, r.svg), info);
  }

  /** «2 × 3 yardas y 2 yardas + ajuste de 240 mm»: las piezas separadas por «y»; dentro de una pieza, «+» (engargoladas). */
  function armadoTexto(arm) {
    const yardas = (n) => `${n} ${n === 1 ? 'yarda' : 'yardas'}`;
    const una = (q) => (q.ajuste_mm > 0 ? `${q.yardas ? `${yardas(q.yardas)} + ` : ''}ajuste de ${W.num(q.ajuste_mm, 0)} mm` : yardas(q.yardas));
    const grupos = [];
    arm.piezas.forEach((q) => {
      const g = grupos.find((x) => x.q.yardas === q.yardas && x.q.ajuste_mm === q.ajuste_mm);
      if (g) g.n += 1; else grupos.push({ n: 1, q });
    });
    return grupos.map((g) => (g.n > 1 ? `${g.n} × ${una(g.q)}` : una(g.q))).join(' y ');
  }

  /** Lo que lleva el extremo libre del ajuste, para el rótulo y la lectura en voz alta. */
  const libreTexto = (arm) => (arm.modo === 'SUELTA' ? 'con la brida suelta (aro terminado que se suelda en obra)' : 'sin brida');

  /** Diagrama del armado: cada yarda un anillo, las piezas con sus bridas (barras) y el extremo libre del ajuste, sin brida de taller (con su aro suelto, si se manda). */
  function svgArmado(arm) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, at, txt) => { const e = document.createElementNS(NS, tag); Object.keys(at).forEach((k) => e.setAttribute(k, at[k])); if (txt !== undefined) e.textContent = txt; return e; };
    // Con muchas piezas se dibujan las primeras y las últimas (el diagrama es un esquema, no un plano)
    const MAX = 7;
    const piezas = arm.piezas.length > MAX ? [...arm.piezas.slice(0, 4), null, ...arm.piezas.slice(-2)] : arm.piezas;
    const SEP = 10; const MARGEN = 12; const ANCHO = 440; const ALTO_ANILLO = 28; const Y0 = 14;
    const reales = piezas.filter(Boolean);
    const largoDibujado = reales.reduce((a, q) => a + q.largo_mm, 0);
    const huecos = piezas.length - 1;
    const escala = (ANCHO - 2 * MARGEN - huecos * SEP) / largoDibujado;
    const svg = el('svg', {
      viewBox: `0 0 ${ANCHO} ${Y0 + ALTO_ANILLO + 46}`, class: 'arm', role: 'img',
      'aria-label': `Armado: ${armadoTexto(arm)}. ${arm.n_piezas} ${arm.n_piezas === 1 ? 'pieza' : 'piezas'}, ${arm.n_bridas} ${arm.n_bridas === 1 ? 'brida' : 'bridas'} de taller${arm.extremo_libre ? `, el extremo final ${libreTexto(arm)}` : ''}.`,
    });
    let x = MARGEN;
    piezas.forEach((q, i) => {
      if (q === null) {
        svg.append(el('text', { x: x + SEP / 2, y: Y0 + ALTO_ANILLO / 2 + 6, class: 'arm-txt', 'text-anchor': 'middle' }, '···'));
        x += SEP;
        return;
      }
      const x0 = x;
      const anillos = [...Array(q.yardas).fill(arm.yarda_mm), ...(q.ajuste_mm > 0 ? [q.ajuste_mm] : [])];
      anillos.forEach((mm, k) => {
        const parcial = q.ajuste_mm > 0 && k === anillos.length - 1;
        svg.append(el('rect', { x, y: Y0, width: mm * escala, height: ALTO_ANILLO, class: parcial ? 'arm-ajuste' : 'arm-anillo' }));
        x += mm * escala;
      });
      svg.append(el('rect', { x: x0 - 2, y: Y0 - 6, width: 4, height: ALTO_ANILLO + 12, class: 'arm-brida' }));
      if (q.bridas === 2) svg.append(el('rect', { x: x - 2, y: Y0 - 6, width: 4, height: ALTO_ANILLO + 12, class: 'arm-brida' }));
      else {
        svg.append(el('line', { x1: x, x2: x, y1: Y0 - 6, y2: Y0 + ALTO_ANILLO + 6, class: 'arm-libre' }));
        if (q.sueltas > 0) svg.append(el('rect', { x: x + 5, y: Y0 - 6, width: 4, height: ALTO_ANILLO + 12, class: 'arm-suelta' })); // el aro, aparte: no se suelda en taller
        svg.append(el('text', { x, y: Y0 + ALTO_ANILLO + 36, class: 'arm-txt arm-txt-adv', 'text-anchor': 'end' }, q.sueltas > 0 ? 'brida suelta' : 'sin brida'));
      }
      // El rótulo largo si cabe bajo la pieza; si no, el corto («3», «2+aj.»)
      const largo = q.ajuste_mm > 0 ? `${q.yardas ? `${q.yardas} + ` : ''}ajuste ${W.num(q.ajuste_mm, 0)} mm` : `${q.yardas} ${q.yardas === 1 ? 'yarda' : 'yardas'}`;
      const corto = q.ajuste_mm > 0 ? `${q.yardas ? `${q.yardas}+` : ''}aj.` : String(q.yardas);
      svg.append(el('text', { x: (x0 + x) / 2, y: Y0 + ALTO_ANILLO + 22, class: 'arm-txt', 'text-anchor': 'middle' }, largo.length * 5.6 <= x - x0 ? largo : corto));
      x += i < piezas.length - 1 ? SEP : 0;
    });
    return svg;
  }

  /** Armado por yardas de un tramo recto: diagrama, piezas y qué lleva cada una. */
  function detalleArmado(f) {
    const arm = f.geometria.detalle.armado;
    const filas = arm.piezas.length > 12 ? arm.piezas.slice(0, 11) : arm.piezas;
    const bridas = (q) => (q.bridas === 1 ? (q.sueltas > 0 ? '1 + 1 suelta' : '1 (un extremo sin brida)') : String(q.bridas));
    const tabla_ = tabla([{ t: 'Pieza' }, { t: 'Yardas', num: true }, { t: 'Largo', num: true }, { t: 'Juntas engargoladas', num: true }, { t: 'Bridas', num: true }],
      [...filas.map((q, i) => [`#${i + 1}`, q.ajuste_mm > 0 ? `${q.yardas ? `${q.yardas} + ` : ''}ajuste` : String(q.yardas), `${W.num(q.largo_mm, 0)} mm`, String(q.juntas), bridas(q)]),
        ...(arm.piezas.length > filas.length ? [['…', '', '', '', '']] : []),
        { clase: 'total', celdas: ['Total', `${arm.n_completas}${arm.ajuste_mm > 0 ? ' + ajuste' : ''}`, `${W.num(arm.L_capa_mm, 0)} mm`, String(arm.n_juntas), `${arm.n_bridas}${arm.n_sueltas ? ` + ${arm.n_sueltas} ${arm.n_sueltas === 1 ? 'suelta' : 'sueltas'}` : ''}`] }]);
    const notas = [];
    const sinAjuste = arm.ajuste_mm === 0;
    notas.push(`Yardas de ${W.num(arm.yarda_mm, 0)} mm (el ancho de la hoja): cada una se rola por separado y se engargolan hasta ${estado.M.proceso.armado_yardas.yardas_por_pieza_max} por pieza; las piezas llevan brida de taller en ambos extremos${arm.extremo_libre ? ', menos el extremo final del tramo' : ''}.`);
    if (sinAjuste && arm.extremo_libre && arm.modo === 'SUELTA') {
      notas.push('Se pidió brida suelta en el extremo final del tramo: ahí el taller no suelda la brida al ducto, manda suelto el aro terminado con sus tornillos y el material de su junta, para soldarlo en obra.');
    } else if (sinAjuste && arm.extremo_libre) {
      notas.push('Brida en un extremo: el extremo final del tramo va liso, para unirlo a otra pieza (armado de piezas) o a una manguera; ahí no se cotiza brida.');
    } else if (arm.extremo_libre && arm.modo === 'SUELTA') {
      notas.push(`El tramo de ajuste (${W.num(arm.ajuste_mm, 0)} mm, menos de una yarda) lleva brida de taller sólo en el extremo de las yardas. El otro extremo se corta y se ajusta en campo: ahí el taller no suelda la brida al ducto, manda suelto el aro terminado (rolado, con el cierre soldado, barrenado y pintado) con sus tornillos y el material de su junta, para soldarlo en obra.`);
    } else if (arm.extremo_libre) {
      notas.push(`El tramo de ajuste (${W.num(arm.ajuste_mm, 0)} mm, menos de una yarda) va sin brida en su extremo libre para cortarlo y ponerlo en campo: la brida y la junta de ese extremo no están en este precio.`);
    } else if (arm.ajuste_mm > 0) {
      notas.push(`Se pidió brida de taller en ambos extremos del tramo de ajuste (${W.num(arm.ajuste_mm, 0)} mm): no queda un extremo libre para ajustar la distancia en campo.`);
    }
    return h('div', { class: 'arm-fig' },
      h('h4', null, 'Armado por yardas'),
      h('p', { class: 'arm-resumen' }, armadoTexto(arm)),
      h('div', { class: 'arm-env' }, svgArmado(arm)),
      tabla_,
      notas.map((n) => h('p', { class: 'nota' }, n)));
  }

  function detalleResumen(f) {
    const ind = f.indicadores;
    const tiles = h('div', { class: 'tiles tiles-3' },
      tile('Precio unitario', W.mxn(f.precio.unitario), f.precio.aplico_cargo_minimo ? 'cargo mínimo aplicado' : 'antes de IVA', 'tile-principal'),
      tile('Importe', W.mxn(f.precio.importe), `${f.entrada.cantidad} ${f.entrada.cantidad === 1 ? 'pieza' : 'piezas'}`),
      tile('Peso neto', `${W.num(f.peso.neto_total_kg, 2)} kg`, f.peso.neto_unitario_kg ? `${W.num(f.peso.neto_unitario_kg, 2)} kg c/u` : ''),
      tile('Precio por kg', ind.precio_por_kg_neto ? W.mxn(ind.precio_por_kg_neto) : '—', ind.precio_por_m_lineal ? `${W.mxn(ind.precio_por_m_lineal)} por m lineal` : 'neto, antes de IVA'),
      tile('Mano de obra', `${W.num(ind.horas_mod_reales, 2)} h`, ind.horas_mod_por_kg_neto ? `${W.num(ind.horas_mod_por_kg_neto, 3)} h/kg` : ''),
      tile('Margen de contribución', W.pct(ind.margen_contribucion_pct, 1), `piso ${W.mxn(ind.precio_piso)}`));
    const avisos = f.advertencias.length
      ? h('ul', { class: 'avisos' }, f.advertencias.map((a) => h('li', null, W.icono('aviso'), h('span', null, a)))) : null;
    return [tiles, avisos];
  }

  function detalleGeometria(f) {
    const g = f.geometria;
    const lam = f.qto.lam;
    const kvs = h('dl', { class: 'kvs' });
    kvs.append(kv('Espesor', W.num(f.espesor_mm, 4), 'mm'));
    Object.keys(g.detalle).forEach((k) => {
      const v = g.detalle[k];
      if (typeof v === 'number') {
        const e = ETQ_DET[k];
        kvs.append(kv(e ? e[0] : k, W.num(v, e ? e[2] : 3), e ? e[1] : ''));
      } else if (k === 'sentido') {
        kvs.append(kv('El injerto se inclina hacia', v === 'MENOR' ? 'El extremo menor (D2)' : 'El extremo mayor (D1)'));
      } else if (k === 'patron' && v) {
        kvs.append(kv('Patrón plano · sector', W.num(v.sector_deg, 2), '°'), kv('Patrón plano · R1', W.num(v.R1_mm, 1), 'mm'), kv('Patrón plano · R2', W.num(v.R2_mm, 1), 'mm'));
      }
    });
    kvs.append(kv('Área neta de lámina', W.num(g.A_neta_m2, 4), 'm²'));
    if (g.A_orificio_m2) kvs.append(kv('Orificio descontado', W.num(g.A_orificio_m2, 4), 'm²'));
    kvs.append(kv('Piezas a armar', String(g.n_piezas)), kv('Longitud de corte', W.num(f.qto.tmp.detalle.L_corte_m, 3), 'm'), kv('Longitud de soldadura', W.num(f.qto.tmp.detalle.L_soldadura_m, 3), 'm'));
    const mat = h('dl', { class: 'kvs' },
      kv('Densidad', W.num(f.qto.mat.densidad_kg_m3, 0), 'kg/m³'),
      kv('Peso por m² (ρ·e)', W.num(lam.kg_m2, 4), 'kg/m²'),
      kv('Peso neto de lámina', W.num(lam.m_neta_kg, 3), 'kg'),
      kv('Merma φ', W.pct(lam.phi, 1)),
      kv('Lámina bruta = neto / (1 − φ)', W.num(lam.m_bruta_kg, 3), 'kg'),
      kv('Merma en kg', W.num(lam.m_merma_kg, 3), 'kg'));
    return [
      h('div', { class: 'dos-col' }, h('div', null, h('h4', null, 'Geometría'), kvs), h('div', null, h('h4', null, 'Peso y merma'), mat)),
      f.familia === 'RECTO' ? detalleArmado(f) : null,
      f.familia === 'RECTO' ? seccionHoja(f) : null,
    ];
  }

  /** Qué se pinta y con qué: «Interior · ducto: sin pintura · bridas: sólo pintura (esmalte)» (o «Elegida en la partida · …»). */
  function pinturaTexto(f) {
    const pint = f.qto.pint;
    if (!pint.A_pint_m2) return 'Sin pintura';
    const nombre = Object.fromEntries(W.OPC.pintura.filter(([v]) => v));
    const sistema = (id) => { const t = nombre[id] || id; return t.charAt(0).toLowerCase() + t.slice(1); };
    const origen = f.entrada.pintura ? 'Elegida en la partida' : (pint.ubicacion === 'EXTERIOR' ? 'Exterior' : 'Interior');
    return `${origen} · ducto: ${sistema(pint.sistema)} · bridas: ${sistema(pint.sistema_bridas)}`;
  }

  function detalleHerrajes(f) {
    const her = f.qto.her;
    const con = f.qto.con;
    const kvs = h('dl', { class: 'kvs' });
    kvs.append(kv('Unión', her.tipo_union), kv('Clase de sellado', her.clase_sellado));
    const sueltos = her.aros_sueltos.length;
    if (her.n_aros || sueltos) {
      kvs.append(
        kv(sueltos ? 'Aros de brida de taller' : 'Aros de brida', String(her.n_aros)),
        kv('Perfil de aros, neto / bruto', `${W.num(her.m_aros_neta_kg, 3)} / ${W.num(her.m_aros_bruta_kg, 3)}`, 'kg'));
      if (sueltos) {
        kvs.append(
          kv('Aros sueltos (terminados, sin unir al ducto)', String(sueltos)),
          kv('Perfil de aros sueltos, neto / bruto', `${W.num(her.m_aros_sueltos_neta_kg, 3)} / ${W.num(her.m_aros_sueltos_bruta_kg, 3)}`, 'kg'));
      }
      kvs.append(
        kv('Juegos de tornillería (asignados)', W.num(her.n_tornillos_asignados, 1)),
        kv('Barrenos', String(her.n_barrenos)),
        her.junta === 'SELLADOR'
          ? kv('Junta: cordón de Sikaflex sobre los barrenos', `${W.num(her.L_junta_sellador_m, 3)} m · ${W.num(her.V_sellador_junta_ml, 1)}`, 'mL')
          : kv('Junta: empaque', W.num(her.L_empaque_m, 3), 'm'));
    }
    if (her.n_espigas) kvs.append(kv('Espigas', String(her.n_espigas)), kv('Fijaciones', String(her.n_fijaciones)), kv('Lámina extra de espiga', W.num(her.A_espiga_m2, 4), 'm²'));
    kvs.append(kv(her.junta === 'SELLADOR' ? 'Sellado de la clase (sin las juntas de bridas)' : 'Sellado', `${W.num(her.L_sellado_m, 3)} m`),
      kv('Sellador en total', W.num(her.V_sellador_ml, 1), 'mL'));
    const cons = h('dl', { class: 'kvs' },
      kv('Depósito de soldadura', W.num(con.soldadura.m_depositado_g, 1), 'g'),
      kv('Alambre / varilla', W.num(con.soldadura.kg_alambre, 4), 'kg'),
      kv('Gas de protección', W.num(con.soldadura.V_gas_m3, 4), 'm³'),
      kv('Corte', `${W.num(con.corte.L_corte_m, 3)} m · ${con.corte.proceso}`),
      kv('Pintura', pinturaTexto(f)),
      kv('Superficie a pintar', W.num(f.qto.pint.A_pint_m2, 3), 'm²'),
      kv('Pintura / diluyente', `${W.num(con.pintura.L_pintura, 3)} / ${W.num(con.pintura.L_diluyente, 3)}`, 'L'));
    const barreno = (a) => (a.barreno_desc ? `Ø${a.barreno_desc} (${W.num(a.diam_barreno_mm, 2)} mm)` : `Ø${W.num(a.diam_barreno_mm, 2)} mm`);
    const filasAros = [
      ...her.aros.map((a, i) => [`#${i + 1}`, a.descripcion || a.perfil_id, `${W.num(a.L_aro_mm, 1)} mm`, `${a.n_tornillos} × ${barreno(a)}`, a.tornillo_desc, `${W.num(a.m_aro_kg, 3)} kg`]),
      // el aro suelto sale terminado (rolado, con el cierre soldado, barrenado y pintado); lo que no se hace en taller es unirlo al ducto
      ...her.aros_sueltos.map((a, i) => [`Suelto #${i + 1}`, a.descripcion || a.perfil_id, `${W.num(a.L_aro_mm, 1)} mm`, `${a.n_tornillos} × ${barreno(a)}`, a.tornillo_desc, `${W.num(a.m_aro_kg, 3)} kg`]),
    ];
    const aros = filasAros.length ? tabla([{ t: 'Aro' }, { t: 'Perfil' }, { t: 'Barra', num: true }, { t: 'Barrenos', num: true }, { t: 'Tornillo' }, { t: 'Peso', num: true }], filasAros) : null;
    return [h('div', { class: 'dos-col' }, h('div', null, h('h4', null, 'Herrajes de unión'), kvs), h('div', null, h('h4', null, 'Consumibles'), cons)), aros];
  }

  function detalleTiempos(f) {
    const tmp = f.qto.tmp;
    const c = f.costos;
    const n = f.entrada.cantidad;
    const filas = Object.keys(c.horas_reales).filter((op) => c.horas_reales[op] > 0).map((op) => [
      ETQ_OP[op] || op,
      W.num(((tmp.unitarios_min[op] || 0) * n) + (tmp.setup_min[op] || 0), 2),
      W.num(c.horas_reales[op] * 60, 2),
      W.mxn(c.mano_obra[op] + c.equipo[op]),
    ]);
    const tot = Object.keys(c.horas_reales).reduce((s, op) => s + c.horas_reales[op], 0);
    return [
      tabla([{ t: 'Operación' }, { t: 'Min estándar', num: true }, { t: 'Min reales', num: true }, { t: 'Costo MO + equipo', num: true }],
        [...filas, { clase: 'total', celdas: ['Total', '', `${W.num(tot * 60, 2)} (${W.num(tot, 3)} h)`, W.mxn(c.subtotales.mano_obra + c.subtotales.equipo)] }]),
      h('p', { class: 'nota' }, `Minutos para ${n} ${n === 1 ? 'pieza' : 'piezas'}, con η de taller = ${W.num(estado.M.proceso.eficiencia_taller, 2)}.`),
    ];
  }

  /** Base de cálculo de los dos materiales que se compran por kg: cuántos kg, a qué precio y de dónde sale ese precio. */
  function basesMaterial(f) {
    const pu = f.costos.precios_usados;
    const q = f.qto;
    const base = {};
    if (!pu || !q) return base;
    const n = f.entrada.cantidad;
    const fuente = (p) => (p.fuente === 'PROVEEDOR' ? ` (${p.descripcion} · ${W.mxn(p.precio)} con IVA)` : ' (precio por kg de la tabla)');
    base.lamina = `${W.num(q.lam.m_bruta_kg * n, 3)} kg × ${W.mxn(pu.lamina.precio_kg)}/kg${fuente(pu.lamina)}`;
    const porPerfil = {};
    [...q.her.aros, ...q.her.aros_sueltos].forEach((a) => { porPerfil[a.perfil_id] = (porPerfil[a.perfil_id] || 0) + a.m_aro_bruta_kg * n; });
    const ids = Object.keys(porPerfil);
    if (ids.length) base.perfiles = ids.map((id) => `${W.num(porPerfil[id], 3)} kg × ${W.mxn(pu.perfiles[id].precio_kg)}/kg${fuente(pu.perfiles[id])}`).join(' · ');
    return base;
  }

  function detalleCostos(f) {
    const c = f.costos;
    const filas = [];
    const bases = { Materiales: f.qto ? basesMaterial(f) : basesSoporte(f), 'Viáticos': basesViaticos(f) };
    const ETQ = {
      lamina: 'Lámina', credito_chatarra: 'Crédito por chatarra', perfiles: 'Perfil de aros', tornilleria: 'Tornillería', fijaciones: 'Fijaciones de espiga', empaque: 'Empaque',
      sellador: 'Sellador', flete: 'Flete de entrada', compra: 'Compra', alambre: 'Alambre / varilla', gas: 'Gas de protección', corte: 'Consumibles de corte', pintura: 'Pintura y diluyente',
      perfil: 'Perfil (fracción de barra, con merma)', anclajes: 'Anclajes', sobrante: 'Material sobrante',
      casetas: 'Casetas', gasolina: 'Gasolina', hospedaje: 'Hospedaje', comidas: 'Comidas', otros: 'Otros gastos de obra',
    };
    const grupo = (tit, obj) => {
      const ks = Object.keys(obj || {}).filter((k) => Math.abs(obj[k]) > 0);
      if (!ks.length) return;
      filas.push({ clase: 'grupo', celdas: [tit, '', ''] });
      ks.forEach((k) => filas.push([`  ${ETQ[k] || k}`, (bases[tit] || {})[k] || '', W.mxn(obj[k])]));
    };
    grupo('Materiales', c.materiales);
    grupo('Consumibles', c.consumibles);
    grupo('Viáticos', c.viaticos);
    filas.push({ clase: 'grupo', celdas: ['Mano de obra, equipo y terceros', '', ''] });
    filas.push(['  Mano de obra directa', c.h_MOD > 0 ? `${W.num(c.h_MOD, 3)} h reales` : '', W.mxn(c.subtotales.mano_obra)]);
    filas.push(['  Equipo (hora-máquina)', '', W.mxn(c.subtotales.equipo)]);
    filas.push(['  Herramienta menor', '', W.mxn(c.subtotales.herramienta_menor)]);
    Object.keys(c.subcontratos || {}).forEach((k) => filas.push([`  Subcontrato ${k}`, '', W.mxn(c.subcontratos[k])]));
    filas.push({ clase: 'total', celdas: ['Costo directo (CD)', '', W.mxn(c.CD)] });
    return tabla([{ t: 'Concepto' }, { t: 'Base' }, { t: 'MXN', num: true }], filas);
  }

  const NOMBRE_CAT = (k) => (C.gastos.CATEGORIAS[k] || k).split(':')[0];
  /** El tornillo como se lee en el taller (5/16″ × 1¼″), del perfil que lo usa; si ninguno lo usa, su clave. */
  const descTornillo = (clave) => {
    const p = Object.values(estado.res.maestros.herrajes.perfiles).find((x) => x && x.tornillo === clave && x.tornillo_desc);
    return p ? p.tornillo_desc : clave;
  };

  /** Lo comprado: de dónde sale el precio, si traía IVA y en qué renglón del control de gastos cae. */
  function detalleCompra(f) {
    const k = f.compra;
    const art = k.articulo_id ? estado.res.maestros.compras.articulos[k.articulo_id] : null;
    const n = f.entrada.cantidad;
    return [
      h('dl', { class: 'kvs' },
        kv('Artículo', art ? `${art.descripcion} (${k.articulo_id})` : 'Capturado en la partida (fuera del catálogo)'),
        kv('Precio de compra', `${W.mxn(k.precio)} ${k.iva_incluido ? 'con IVA' : 'antes de IVA'}`, `por ${k.unidad}`),
        kv('Origen del precio', f.entrada.precio_compra_unitario !== undefined ? 'Capturado en la partida' : 'Del catálogo de compras'),
        kv('Costo sin IVA', W.mxn(k.unitario_sin_iva), `por ${k.unidad}`),
        kv(`Compra de ${W.num(n, 0)} × ${k.unidad}`, W.mxn(f.costos.materiales.compra)),
        k.tornillos > 0 ? kv('Tornillería', W.mxn(f.costos.materiales.tornilleria), `${W.num(k.tornillos, 0)} juegos de ${descTornillo(k.tornillo)} + ${W.pct(k.reserva_tornillos, 0)} de reserva`) : null,
        k.junta === 'SELLADOR' ? kv('Junta: Sikaflex sobre los barrenos', W.mxn(f.costos.materiales.sellador), `Ø${W.num(k.circulo_barrenos_mm, 0)} mm · ${W.num(k.V_sellador_ml, 1)} mL por pieza`) : null,
        k.junta === 'EMPAQUE' ? kv('Junta: empaque sobre los barrenos', W.mxn(f.costos.materiales.empaque), `Ø${W.num(k.circulo_barrenos_mm, 0)} mm · ${W.num(k.L_empaque_m, 3)} m por pieza`) : null,
        kv('Costo directo', W.mxn(f.costos.CD)),
        kv('Renglón del control de gastos', `${NOMBRE_CAT(k.categoria)}${k.tornillos > 0 || k.junta ? ' (su tornillería y su junta, en material)' : ''}`)),
      k.iva_incluido ? h('p', { class: 'nota' }, `Al precio se le quita el IVA (${W.pct(estado.res.maestros.compras.iva_pct, 0)}): se acredita, no es costo.`) : null,
      k.tornillos > 0 || k.junta ? h('p', { class: 'nota' }, 'Se atornilla como brida: lleva la mitad de la tornillería y del material de la junta (la otra mitad es de la pieza con que se une).') : null,
    ];
  }

  /** Bases de los viáticos: con factura el monto se toma sin IVA (se acredita); sin factura, completo. */
  function basesViaticos(f) {
    const I = f.instalacion;
    if (!I) return {};
    const e = f.entrada;
    const t = (fact) => (fact ? 'sin IVA (con factura)' : 'con IVA (sin factura)');
    const vez = e.cantidad > 1 ? ` × ${e.cantidad} veces` : '';
    return {
      casetas: `${e.viajes || 0} viajes × ${W.mxn(e.casetas_viaje || 0)}${vez} · ${t(I.gastos_con_factura)}`,
      gasolina: `${e.viajes || 0} viajes × ${W.mxn(e.gasolina_viaje || 0)}${vez} · ${t(I.gastos_con_factura)}`,
      hospedaje: `${e.personas} × ${e.noches || 0} noches × ${W.mxn(e.hospedaje_noche || 0)}${vez} · ${t(I.gastos_con_factura)}`,
      comidas: `${e.personas} × ${W.num(e.dias, 1)} días × ${W.mxn(e.comida_dia || 0)}${vez} · ${t(I.comidas_con_factura)}`,
      otros: `${W.mxn(e.otros_gastos || 0)}${vez} · ${t(I.gastos_con_factura)}`,
    };
  }

  /** Bases del material de la soportería: la fracción de barra, los anclajes del catálogo y la tornillería. */
  function basesSoporte(f) {
    const s = f.soporte;
    if (!s) return {};
    return {
      perfil: `${W.num(s.L_total_m, 3)} m × ${W.mxn(s.barra.precio_m)}/m ÷ (1 − merma ${W.pct(estado.res.maestros.merma.PERFIL, 0)})`,
      anclajes: `${s.anclajes} × ${W.mxn(s.anclaje.unitario_sin_iva)} (${s.anclaje.descripcion})`,
      tornilleria: `${s.tornillos} juegos de ${descTornillo(s.tornillo)} × ${W.mxn(s.precio_tornillo)}`,
    };
  }

  /** Instalación en obra: la cuadrilla (horas reales, sin la eficiencia del taller) y cada viático. */
  function detalleInstalacion(f) {
    const I = f.instalacion;
    const e = f.entrada;
    const v = f.costos.viaticos;
    const bases = basesViaticos(f);
    const ETQ_V = { casetas: 'Casetas', gasolina: 'Gasolina', hospedaje: 'Hospedaje', comidas: 'Comidas', otros: 'Otros gastos de obra' };
    const J = estado.res.maestros.mano_obra.jornada;
    return [
      h('dl', { class: 'kvs' },
        kv('Cuadrilla', `${e.personas} ${e.personas === 1 ? 'persona' : 'personas'} × ${W.num(e.dias, 1)} ${e.dias === 1 ? 'día' : 'días'} × ${W.num(I.horas_dia, 1)} h${e.cantidad > 1 ? ` × ${e.cantidad} veces` : ''}`),
        kv('Horas en obra', W.num(I.horas, 2), 'h'),
        kv('Costo por hora', W.mxn(I.tarifa.mo_h), `salario por día ÷ ${W.num(J.horas_dia, Number.isInteger(J.horas_dia) ? 0 : 1)} h${estado.res.maestros.mano_obra.FSR !== 1 ? ` × FSR ${W.num(estado.res.maestros.mano_obra.FSR, 2)}` : ''}`),
        kv('Mano de obra de instalación', W.mxn(f.costos.subtotales.mano_obra)),
        kv('Viáticos', W.mxn(f.costos.subtotales.viaticos))),
      tabla([{ t: 'Viático' }, { t: 'Base' }, { t: 'Costo', num: true }],
        [...Object.keys(ETQ_V).filter((k) => v[k] > 0).map((k) => [ETQ_V[k], bases[k], W.mxn(v[k])]),
          { clase: 'total', celdas: ['Total de viáticos', '', W.mxn(f.costos.subtotales.viaticos)] }]),
      h('p', { class: 'nota' }, 'Los montos se capturan con IVA, como en el ticket. Lo que se paga con factura se cuesta sin IVA (se acredita); lo que no, completo. En obra se pagan horas reales: no se aplica la eficiencia del taller.'),
    ];
  }

  /** Soportería: la barra de la que se cortan las piezas, los anclajes, la tornillería y el tiempo de taller. */
  function detalleSoporte(f) {
    const s = f.soporte;
    const e = f.entrada;
    const b = s.barra;
    return [
      h('dl', { class: 'kvs' },
        kv('Barra', `${b.descripcion} · ${W.num(b.largo_mm / 1000, 2)} m`, `${W.mxn(b.precio)} → ${W.mxn(b.sin_iva)} sin IVA`),
        kv('Precio por metro', W.mxn(b.precio_m), 'sin IVA'),
        kv('Largo por pieza', W.num(s.largo_pieza_mm, 0), s.largo_calculado ? `mm · abrazadera de media vuelta para Ø${W.num(e.abrazadera_D_mm, 1)} mm con dos orejas` : 'mm'),
        kv('Barra que usan las piezas', W.num(s.L_total_m, 3), 'm'),
        kv('Anclajes', s.anclajes ? `${s.anclajes} × ${s.anclaje.descripcion}` : 'Ninguno'),
        kv('Tornillería', s.tornillos ? `${s.tornillos} juegos de ${descTornillo(s.tornillo)}` : 'Ninguna'),
        kv('Tiempo de taller', `${W.num(s.minutos_pieza, 2)} min reales por pieza → ${W.num(s.horas, 2)} h`),
        kv('Peso', W.num(f.peso.neto_total_kg, 2), 'kg')),
      h('p', { class: 'nota' }, 'Cada pieza paga la fracción de barra que usa, con la merma de perfil. Cuántas barras completas hay que comprar lo dice la lista de compras (pestaña Compras y gastos). Los minutos son reales (lo que tarda el taller): no se les aplica la eficiencia.'),
    ];
  }

  function detallePila(f) {
    const p = f.pila;
    const C = estado.res.capas; // las de esta cotización: las de maestros con los parámetros propios encima
    const obra = f.familia === 'INSTALACION'; // la cuadrilla en obra no usa la nave: sus indirectos por hora son otros
    const filas = [
      ['Costo directo (CD)', '', W.mxn(p.CD)],
      [obra ? 'CI de la instalación' : 'CI de fábrica', `GIF ${W.mxn(p.gif_por_hora)}/h × ${W.num(f.costos.h_MOD, 3)} h`, W.mxn(p.CI_fabrica)],
      ['CI de administración', `${W.pct(C.administracion_pct_cd, 1)} del CD`, W.mxn(p.CI_admin)],
      ['Imprevistos', `riesgo ${p.riesgo} · ${W.pct(p.imp_pct, 1)} de CD + CI`, W.mxn(p.imprevistos)],
      { clase: 'total', celdas: ['Costo total', '', W.mxn(p.C_T)] },
      ['Financiamiento', `${W.pct(C.financiamiento.tasa_anual, 1)} anual · ${C.financiamiento.dias_cobro} días`, W.mxn(p.financiamiento)],
      { clase: 'total', celdas: ['Costo base', '', W.mxn(p.C_base)] },
      ['Utilidad', `${W.pct(C.utilidad_pct_precio, 1)} del precio`, W.mxn(p.utilidad)],
      ['Comisión de ventas', `${W.pct(C.comision_ventas_pct_precio, 1)} del precio`, W.mxn(p.comision)],
    ];
    if (p.otros) filas.push(['Otros', `${W.pct(C.otros_pct_precio, 1)} del precio`, W.mxn(p.otros)]);
    filas.push({ clase: 'total', celdas: ['Precio antes de IVA', `costo base ÷ ${W.num(p.divisor, 3)}`, W.mxn(f.precio.total_sin_redondeo)] });
    return [
      tabla([{ t: 'Capa' }, { t: 'Base' }, { t: 'MXN', num: true }], filas),
      f.precio.aplico_cargo_minimo ? h('p', { class: 'nota nota-adv' }, W.icono('aviso'), `Se aplicó el cargo mínimo de partida (${W.mxn(C.cargo_minimo_partida)}).`) : null,
    ];
  }

  /** El plano de la pieza en el desglose: el dibujo acotado y sus datos, como en los planos de pedido. */
  function seccionPlano(f) {
    const d = C.planos.plano(f, estado.res.maestros);
    if (!d) return null;
    return seccion('Plano de la pieza', h('figure', { class: 'det-plano' },
      W.svgArbol(C.planos.arbol(d, { px: 520, alto_max: 360 })),
      h('figcaption', null, h('strong', null, d.titulo), h('ul', { class: 'plano-datos' },
        d.datos.filter(Boolean).map((x) => h('li', null, x)), d.notas.map((x) => h('li', { class: 'plano-nota' }, x))))), true, 'medidas en mm');
  }

  function renderDetalle() {
    const cont = $('#detalle');
    const i = estado.cot.partidas.findIndex((p) => p.id === estado.sel);
    if (i < 0) {
      reemplazar(cont, h('div', { class: 'vacio vacio-det' }, h('p', { class: 'vacio-tit' }, 'Desglose de la partida'), h('p', null, 'Seleccione una partida para ver geometría, merma, tiempos, consumibles y la pila de precio paso a paso.')));
      return;
    }
    const p = estado.cot.partidas[i];
    const f = estado.res.partidas[i];
    const cab = h('div', { class: 'det-cab' },
      miniatura(p, f),
      h('div', null, h('h3', null, tituloPartida(p)), h('p', { class: 'det-sub' }, [dims(p), resumenMaterial(p)].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'btn', onclick: () => abrirDialogo(p.id) }, W.icono('editar'), 'Editar'));
    if (!f.ok) {
      reemplazar(cont, cab, h('div', { class: 'errores' }, h('p', { class: 'errores-tit' }, W.icono('error'), 'No se puede calcular esta partida'), h('ul', null, f.errores.map((e) => h('li', null, e)))));
      return;
    }
    const plano = seccionPlano(f);
    if (p.familia === 'COMPRADO') {
      reemplazar(cont, cab, detalleResumen(f), plano, seccion('Compra', detalleCompra(f), true, W.mxn(f.costos.CD)), seccion('Pila de precio', detallePila(f), true));
      return;
    }
    if (p.familia === 'INSTALACION' || p.familia === 'SOPORTE') {
      const obra = p.familia === 'INSTALACION';
      reemplazar(cont, cab, detalleResumen(f), plano,
        obra ? seccion('Cuadrilla y viáticos', detalleInstalacion(f), true, `${W.num(f.instalacion.horas, 1)} h · ${W.mxn(f.costos.subtotales.viaticos)} de viáticos`)
          : seccion('Pieza, barra y anclajes', detalleSoporte(f), true, `${W.num(f.soporte.L_total_m, 2)} m de barra`),
        seccion('Pila de precio', detallePila(f), true, W.mxn(f.precio.total_sin_redondeo)),
        seccion('Costo directo por concepto', detalleCostos(f), false, W.mxn(f.costos.CD)));
      return;
    }
    if (p.familia === 'BRIDA') { // sólo aros: no hay lámina; lo que importa son los aros, su tornillería y su junta
      const a = f.qto.her.aros_sueltos[0];
      reemplazar(cont, cab, detalleResumen(f), plano,
        seccion('Aros, tornillería y junta', detalleHerrajes(f), true, a ? `${W.num(a.L_aro_mm, 0)} mm de solera por aro` : ''),
        seccion('Pila de precio', detallePila(f), true, W.mxn(f.precio.total_sin_redondeo)),
        seccion('Tiempos de fabricación', detalleTiempos(f), false, `${W.num(f.costos.h_MOD, 2)} h`),
        seccion('Costo directo por concepto', detalleCostos(f), false, W.mxn(f.costos.CD)));
      return;
    }
    reemplazar(cont, cab, detalleResumen(f), plano,
      seccion('Geometría, peso y merma', detalleGeometria(f), true, `${W.num(f.geometria.A_neta_m2, 3)} m² · ${W.num(f.qto.lam.m_bruta_kg, 2)} kg brutos`),
      seccion('Pila de precio', detallePila(f), true, W.mxn(f.precio.total_sin_redondeo)),
      seccion('Tiempos de fabricación', detalleTiempos(f), false, `${W.num(f.costos.h_MOD, 2)} h`),
      seccion('Herrajes y consumibles', detalleHerrajes(f), false),
      seccion('Costo directo por concepto', detalleCostos(f), false, W.mxn(f.costos.CD)));
  }

  /* ================================================================== */
  /* Diálogo de partida                                                 */
  /* ================================================================== */
  const dlg = { id: null, familia: 'RECTO', valores: null, subs: [], omitir: [] };

  const unidadEje = (eje) => (eje === 'long' ? estado.cot.unidad_long : estado.cot.unidad_diam);
  const aUnidad = (mm, eje) => Number((mm / W.factorUnidad(unidadEje(eje))).toFixed(4));
  const deUnidad = (v, eje) => v * W.factorUnidad(unidadEje(eje));

  function opcionesDe(clave) {
    const M = estado.M;
    if (clave === 'materiales') return Object.keys(M.materiales).map((k) => [k, M.materiales[k].nombre]);
    if (clave === 'angulos_injerto') return M.proceso.angulos_injerto_deg.map((a) => [String(a), `${a}°`]);
    if (clave === 'angulos_codo') return M.proceso.angulos_codo_deg.map((a) => [String(a), `${a}°`]);
    if (clave === 'yardas' || clave === 'yardas_cotizacion') {
      // «yardas_cotizacion» es el encabezado (vacío = el de las tablas); «yardas», la partida (vacío = el de la cotización)
      const AY = M.proceso.armado_yardas;
      const pies = (mm) => { const ft = mm / 304.8; return Math.abs(ft - Math.round(ft)) < 0.02 ? ` · ${Math.round(ft)} ft` : ''; };
      const ancho = (mm) => `${W.num(mm, 0)} mm${pies(mm)}`;
      const vigente = clave === 'yardas' && estado.res && estado.res.yarda_mm !== undefined ? estado.res.yarda_mm : AY.yarda_defecto_mm;
      return [['', clave === 'yardas' ? `Según la cotización · ${ancho(vigente)}` : `Predeterminada · ${ancho(AY.yarda_defecto_mm)}`], ...AY.yardas_mm.map((y) => [String(y), ancho(y)])];
    }
    if (clave === 'ajuste') {
      const nombre = Object.fromEntries(W.OPC.ajuste);
      // sin elegirlo: el tramo de ajuste toma el de las tablas y un tramo sin ajuste lleva brida de taller en ambos extremos
      const tablas = nombre[M.proceso.armado_yardas.extremo_ajuste_defecto] || '—';
      return [['', `Predeterminado · con ajuste, ${tablas.split(' (')[0].toLowerCase()}; sin ajuste, bridas en ambos extremos`], ...W.OPC.ajuste];
    }
    if (clave === 'extremos') return W.EXTREMOS[dlg.familia] || [];
    if (clave === 'perfiles') return [['', 'Estándar del taller'], ...Object.keys(M.herrajes.perfiles).map((k) => [k, `${k} · ${M.herrajes.perfiles[k].descripcion}`])];
    const art = (k) => {
      const a = M.compras.articulos[k];
      return [k, `${a.descripcion || k} · ${W.mxn(a.precio)}${a.iva_incluido ? ' con IVA' : ' + IVA'} por ${a.unidad || 'pza'}`];
    };
    if (clave === 'articulos') return [['', 'Ninguno: capturo el precio'], ...Object.keys(M.compras.articulos).map(art)];
    if (clave === 'anclajes') {
      const d = M.proceso.soportes.anclaje_defecto;
      const a = M.compras.articulos[d];
      return [['', `Predeterminado · ${a ? a.descripcion : d}`], ...Object.keys(M.compras.articulos).map(art)];
    }
    if (clave === 'barras') {
      return Object.keys(M.proveedor.barras).map((k) => {
        const b = M.proveedor.barras[k];
        return [k, `${b.descripcion || k} · ${W.num((b.largo_mm || 0) / 1000, 2)} m · ${W.mxn(b.precio || 0)}`];
      });
    }
    return W.OPC[clave];
  }

  /** Los campos de una familia: los propios y, si es de lámina, los de material y los avanzados que le tocan. */
  function camposDe(fam) {
    const deFam = (lista) => lista.filter((c) => !c.familias || c.familias.includes(fam));
    return [...W.CAMPOS[fam], ...(esLamina(fam) ? [...deFam(W.CAMPOS_MATERIAL), ...deFam(W.CAMPOS_AVANZADOS)] : [])];
  }

  function opcionesCalibre(materialId) {
    const M = estado.M;
    const mat = M.materiales[materialId];
    const tabla_ = mat ? M.calibres[mat.tabla_calibre] : {};
    return [...Object.keys(tabla_).map(Number).sort((a, b) => a - b).map((c) => [String(c), `${c} · ${W.num(tabla_[c] * W.MM_IN, 3)} mm`]), ['PROPIO', 'Espesor propio (placa)']];
  }

  function crearControl(c, valorDado) {
    const id = `f_${c.id}`;
    // una lista sin valor guardado muestra el que usa el cálculo (su `defecto`), no la primera opción: así editar y guardar sin
    // tocar nada no cambia la partida (p. ej. «comidas con factura», que el motor toma como «no» si no se dice)
    const valor = valorDado === undefined && c.tipo === 'select' && c.defecto !== undefined ? c.defecto : valorDado;
    let ctl;
    if (c.tipo === 'select' || c.tipo === 'calibre') {
      let ops = c.tipo === 'calibre' ? opcionesCalibre(dlg.valores.material_id) : opcionesDe(c.opciones);
      // Un ángulo guardado que ya no está en la lista del taller se muestra tal cual, marcado, para que se vea qué hay que corregir.
      if (c.numerico && valor !== undefined && valor !== '' && !ops.some(([v]) => String(v) === String(valor))) ops = [[String(valor), `${valor}${c.sufijoFuera || ''}`], ...ops];
      ctl = h('select', { id, name: c.id }, ops.map(([v, t]) => h('option', { value: v, selected: String(valor) === String(v) }, t)));
    } else if (c.tipo === 'dim') {
      ctl = h('input', { id, name: c.id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valor === undefined || valor === '' ? '' : aUnidad(valor, c.eje), placeholder: c.opcional ? 'auto' : '' });
      // El campo muestra el valor redondeado a la unidad elegida; si el usuario no lo toca, al guardar se conserva el valor exacto en mm.
      if (valor !== undefined && valor !== '') { ctl.dataset.mm = String(valor); ctl.dataset.texto = ctl.value; }
    } else if (c.tipo === 'text') {
      ctl = h('input', { id, name: c.id, type: 'text', autocomplete: 'off', value: valor || '' });
    } else if (c.tipo === 'marcas') {
      // casillas: la partida guarda la lista de lo marcado (sin `name`, para no confundirse con los campos de un solo valor)
      const marcadas = Array.isArray(valor) ? valor : [];
      ctl = h('div', { id, class: 'marcas', role: 'group', 'aria-labelledby': `${id}_et` },
        opcionesDe(c.opciones).map(([v, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: v, checked: marcadas.includes(v) }), t)));
    } else {
      const v = c.tipo === 'pct' && valor !== undefined && valor !== '' ? Number((valor * 100).toFixed(3)) : valor;
      ctl = h('input', {
        id, name: c.id, type: 'number', inputmode: 'decimal', value: v === undefined ? '' : v, min: c.min, max: c.max, step: c.paso || (c.tipo === 'int' ? 1 : 'any'), placeholder: c.opcional ? 'auto' : '',
      });
    }
    const sufijo = c.tipo === 'dim' ? W.sufijoUnidad(unidadEje(c.eje)) : c.unidad;
    return h('div', { class: `campo${c.tipo === 'marcas' ? ' campo-marcas' : ''}`, dataset: { campo: c.id } },
      c.tipo === 'marcas' ? h('span', { class: 'etq-campo', id: `${id}_et` }, c.etiqueta) : h('label', { for: id }, c.etiqueta),
      h('div', { class: 'ctl' }, ctl, sufijo ? h('span', { class: 'sufijo' }, sufijo) : null),
      c.ayuda ? h('div', { class: 'ayuda' }, c.ayuda) : null);
  }

  /** Lee el formulario → objeto de partida (mm). Los vacíos opcionales se omiten. */
  function leerDialogo() {
    const p = { familia: dlg.familia };
    if (dlg.id) p.id = dlg.id;
    const campos = camposDe(dlg.familia);
    const crudo = {};
    $$('#dlg-campos [name]').forEach((el) => { crudo[el.name] = el.value; });
    dlg.invalidos = []; // lo que se escribió y no es un número: no se deja pasar como «automático» en silencio
    campos.forEach((c) => {
      const el = $(`#f_${c.id}`);
      if (!el) return;
      if (c.visible && !c.visible(crudo)) return;
      if (c.tipo === 'marcas') {
        const marcadas = $$('input:checked', el).map((x) => x.value);
        if (marcadas.length) p[c.id] = marcadas;
        return;
      }
      let v = el.value;
      if (el.validity && el.validity.badInput) dlg.invalidos.push(`${c.etiqueta}: lo escrito no es un número.`);
      if (c.tipo === 'select') {
        if (v === '') return;
        p[c.id] = c.id === 'caras_pintadas' || c.numerico ? Number(v) : c.booleano ? v === 'true' : v;
        return;
      }
      if (c.tipo === 'calibre') {
        if (v === 'PROPIO') return;
        p.calibre = Number(v);
        return;
      }
      if (v === '') return;
      if (c.tipo === 'dim') {
        if (el.dataset.mm !== undefined && v === el.dataset.texto) p[c.id] = Number(el.dataset.mm); // campo sin tocar: valor exacto
        else {
          const texto = v;
          v = W.leerNumero(v);
          if (Number.isNaN(v)) dlg.invalidos.push(`${c.etiqueta}: «${texto}» no es una medida válida (use 12, 12.5, 12 1/2 o 3/8).`);
          p[c.id] = Number.isNaN(v) ? undefined : deUnidad(v, c.eje);
        }
      } else if (c.tipo === 'pct') p[c.id] = Number(v) / 100;
      else p[c.id] = Number(v);
    });
    p.descripcion = ($('#f_descripcion') || { value: '' }).value.trim();
    p.cantidad = Number(($('#f_cantidad') || { value: 1 }).value);
    if (esLamina(dlg.familia)) {
      $$('.sub-fila', $('#dlg-campos')).forEach((fila, i) => {
        const el = $('.sc-precio', fila);
        if ((el.validity && el.validity.badInput) || Number(el.value || 0) < 0) dlg.invalidos.push(`Subcontrato ${i + 1}: el precio debe ser un número, 0 o mayor.`);
      });
      const subs = $$('.sub-fila', $('#dlg-campos')).map((fila) => ({
        concepto: $('.sc-concepto', fila).value.trim() || 'Subcontrato', driver: $('.sc-driver', fila).value, precio: Number($('.sc-precio', fila).value || 0),
      })).filter((s) => s.precio > 0);
      if (subs.length) p.subcontratos = subs;
      const omit = $$('.omitir input:checked', $('#dlg-campos')).map((x) => x.value);
      if (omit.length) p.omitir_operaciones = omit;
    }
    Object.keys(p).forEach((k) => p[k] === undefined && delete p[k]);
    return p;
  }

  function actualizarVisibilidad() {
    const crudo = {};
    $$('#dlg-campos [name]').forEach((el) => { crudo[el.name] = el.value; });
    camposDe(dlg.familia).forEach((c) => {
      const w = $(`.campo[data-campo="${c.id}"]`);
      if (w) w.hidden = c.visible ? !c.visible(crudo) : false;
    });
  }

  function filaSub(sc) {
    const fila = h('div', { class: 'sub-fila' },
      h('input', { type: 'text', class: 'sc-concepto', placeholder: 'Concepto (p. ej. Galvanizado en caliente)', value: sc.concepto || '', 'aria-label': 'Concepto del subcontrato' }),
      h('select', { class: 'sc-driver', 'aria-label': 'Base de cobro' }, W.OPC.driver.map(([v, t]) => h('option', { value: v, selected: sc.driver === v }, t))),
      h('input', { type: 'number', class: 'sc-precio', min: '0', step: 'any', placeholder: 'MXN', value: sc.precio === undefined ? '' : sc.precio, 'aria-label': 'Precio por unidad de la base de cobro' }),
      h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Quitar subcontrato', onclick: () => { fila.remove(); actualizarPreview(); } }, W.icono('cerrar')));
    return fila;
  }

  function renderCamposDialogo() {
    const v = dlg.valores;
    const cont = $('#dlg-campos');
    const fam = dlg.familia;
    const grid = (campos, clase) => h('div', { class: `grid-campos${clase ? ` ${clase}` : ''}` }, campos.map((c) => crearControl(c, v[c.id])));
    const deFam = (lista) => lista.filter((c) => !c.familias || c.familias.includes(fam));
    const partes = [
      h('fieldset', null, h('legend', null, 'Descripción y cantidad'),
        h('div', { class: 'grid-campos' },
          crearControl({ id: 'descripcion', etiqueta: 'Descripción', tipo: 'text' }, v.descripcion),
          crearControl({ id: 'cantidad', etiqueta: W.ETIQUETA_CANTIDAD[fam] || 'Cantidad', tipo: 'int', min: 1, paso: 1 }, v.cantidad))),
      h('fieldset', null, h('legend', null, W.TITULO_CAMPOS[fam] || 'Dimensiones'), grid(W.CAMPOS[fam].filter((c) => !c.grupo))),
    ];
    // Los cuadros propios (armado por yardas, viáticos), en el orden en que aparecen sus campos
    [...new Set(W.CAMPOS[fam].filter((c) => c.grupo).map((c) => c.grupo))].forEach((g) => {
      partes.push(h('fieldset', null, h('legend', null, W.GRUPOS_CAMPOS[g] || g), grid(W.CAMPOS[fam].filter((c) => c.grupo === g), `grid-${g}`)));
    });
    if (esLamina(fam)) {
      partes.push(h('fieldset', null, h('legend', null, fam === 'BRIDA' ? 'Material del ducto y proceso' : 'Material y proceso'), grid(deFam(W.CAMPOS_MATERIAL))));
      const subs = (v.subcontratos || []).map(filaSub);
      const contSubs = h('div', { class: 'subs' }, subs);
      partes.push(h('details', { class: 'avanzado', open: !!(v.subcontratos || v.omitir_operaciones || v.merma_pct !== undefined || v.perfil_id) },
        h('summary', null, 'Opciones avanzadas'),
        grid(deFam(W.CAMPOS_AVANZADOS)),
        h('div', { class: 'bloque-adv' },
          h('div', { class: 'etq' }, 'Operaciones subcontratadas (se omiten del taller)'),
          h('div', { class: 'omitir' }, W.OPERACIONES.map(([k, t]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: k, checked: (v.omitir_operaciones || []).includes(k) }), t)))),
        h('div', { class: 'bloque-adv' },
          h('div', { class: 'etq' }, 'Subcontratos (costo de terceros)'),
          contSubs,
          h('button', { type: 'button', class: 'btn btn-sec', onclick: () => { contSubs.append(filaSub({ driver: 'KG_NETO' })); } }, W.icono('mas'), 'Agregar subcontrato'))));
    }
    cont.replaceChildren(...partes);
    actualizarVisibilidad();
    if (fam === 'COMPRADO') sincronizarArticulo(false);
  }

  /**
   * Artículo comprado: con un artículo del catálogo, el precio vacío es el del catálogo (se ve como sugerencia en el campo) y
   * la descripción vacía, la del artículo. `limpiar`: al elegir otro artículo se borra el precio y la regla del IVA, para que
   * manden los del catálogo.
   */
  function sincronizarArticulo(limpiar) {
    const sel = $('#f_articulo_id');
    const precio = $('#f_precio_compra_unitario');
    if (!sel || !precio) return;
    const a = sel.value ? estado.M.compras.articulos[sel.value] : null;
    if (limpiar && a) {
      precio.value = '';
      const iva = $('#f_iva_incluido');
      if (iva) iva.value = '';
    }
    precio.placeholder = a ? String(a.precio) : '';
    const torn = $('#f_tornillos_pieza');
    const circ = $('#f_circulo_barrenos_mm');
    if (limpiar && a) {
      if (torn) torn.value = '';
      if (circ) circ.value = '';
    }
    if (torn) torn.placeholder = String((a && a.tornillos_pieza) || 0);
    if (circ) circ.placeholder = String((a && a.circulo_barrenos_mm) || 0);
    const desc = $('#f_descripcion');
    if (desc) desc.placeholder = a ? a.descripcion : '';
  }

  function renderFamilias() {
    const cont = $('#dlg-familias');
    // Una familia retirada sólo aparece mientras se edita una partida anterior que la usa.
    const familias = [...W.FAMILIAS, ...W.FAMILIAS_RETIRADAS.filter(([k]) => k === dlg.familia)];
    cont.replaceChildren(...familias.map(([k, t]) => h('button', {
      type: 'button', class: `fam${k === dlg.familia ? ' act' : ''}`, role: 'radio', 'aria-checked': String(k === dlg.familia),
      onclick: () => cambiarFamilia(k),
    }, W.iconoFamilia(k), h('span', null, t))));
  }

  function cambiarFamilia(k) {
    if (k === dlg.familia) return;
    const previo = leerDialogo();
    const nuevo = W.partidaNueva(k);
    // De una familia de lámina a otra se conservan el material y el proceso; a una que no es de lámina, sólo descripción y cantidad
    ['descripcion', 'cantidad', 'material_id', 'calibre', 'espesor_mm', 'ref_diametro', 'tipo_union', 'bridas_aparte', 'clase_sellado', 'pintura', 'ubicacion', 'servicio', 'riesgo', 'caras_pintadas', 'proceso_corte', 'merma_pct', 'subcontratos', 'omitir_operaciones'].forEach((c) => {
      if (previo[c] !== undefined && (['descripcion', 'cantidad'].includes(c) || (esLamina(k) && esLamina(dlg.familia)))) nuevo[c] = previo[c];
    });
    if (k === 'BRIDA') delete nuevo.tipo_union; // las bridas sueltas siempre son bridadas
    if (k === 'UNION') { nuevo.tipo_union = 'LISO'; delete nuevo.bridas_aparte; } // la unión no lleva bridas
    if (nuevo.espesor_mm > 0) nuevo.calibre = 'PROPIO';
    if (nuevo.calibre !== undefined) nuevo.calibre = String(nuevo.calibre);
    dlg.familia = k;
    dlg.valores = nuevo;
    renderFamilias();
    renderCamposDialogo();
    actualizarPreview();
  }

  function actualizarPreview() {
    const cont = $('#dlg-prev');
    const p = leerDialogo();
    const tit = h('h3', null, 'Vista previa');
    const bloqueErrores = (msgs) => h('div', { class: 'errores' }, h('p', { class: 'errores-tit' }, W.icono('error'), 'Revise estos datos'), h('ul', null, msgs.map((m) => h('li', null, m))));
    if (dlg.invalidos.length) {
      dlg.error = dlg.invalidos;
      cont.replaceChildren(tit, bloqueErrores(dlg.invalidos));
      return;
    }
    try {
      const defs = { riesgo: estado.cot.riesgo, servicio: estado.cot.servicio, ubicacion: estado.cot.ubicacion };
      if (p.familia === 'RECTO' && estado.res.yarda_mm !== undefined) defs.yarda_mm = estado.res.yarda_mm; // lo que decide la cotización, si la partida no elige
      const f = C.cotizador.cotizarPartida({ ...defs, ...p }, estado.res.maestros);
      const ind = f.indicadores;
      const fig = figuraPlano(f, { px: 300, alto_max: 250 });
      cont.replaceChildren(tit,
        fig ? h('div', { class: 'prev-plano' }, fig) : null,
        h('div', { class: 'prev-precio' }, h('div', { class: 'tile-et' }, 'Precio unitario'), h('div', { class: 'prev-val' }, W.mxn(f.precio.unitario)), h('div', { class: 'tile-sub' }, `${p.cantidad} × = ${W.mxn(f.precio.importe)}`)),
        h('dl', { class: 'kvs kvs-1' },
          kv('Peso neto', W.num(f.peso.neto_total_kg, 2), 'kg'),
          kv('Precio por kg', ind.precio_por_kg_neto ? W.mxn(ind.precio_por_kg_neto) : '—'),
          kv('Mano de obra', W.num(ind.horas_mod_reales, 2), 'h'),
          f.geometria && f.geometria.A_neta_m2 > 0 ? kv('Área de lámina', W.num(f.geometria.A_neta_m2, 3), 'm²') : null,
          f.familia === 'RECTO' ? kv('Armado', armadoTexto(f.geometria.detalle.armado)) : null,
          f.qto && f.qto.lam.m_bruta_kg > 0 ? kv('Lámina bruta', W.num(f.qto.lam.m_bruta_kg, 2), 'kg') : null,
          f.familia === 'BRIDA' && f.qto.her.aros_sueltos[0] ? kv('Solera por aro', W.num(f.qto.her.aros_sueltos[0].L_aro_mm, 0), 'mm') : null,
          f.compra ? kv('Costo sin IVA', W.mxn(f.compra.unitario_sin_iva), `por ${f.compra.unidad}`) : null,
          f.soporte ? kv('Barra', `${W.num(f.soporte.L_total_m, 2)} m de ${f.soporte.barra.descripcion}`) : null,
          f.costos.subtotales.viaticos > 0 ? kv('Viáticos (costo)', W.mxn(f.costos.subtotales.viaticos)) : null),
        f.advertencias.length ? h('ul', { class: 'avisos' }, f.advertencias.map((a) => h('li', null, W.icono('aviso'), h('span', null, a)))) : h('p', { class: 'nota ok' }, W.icono('check'), 'Datos consistentes'));
      dlg.error = null;
      resaltarCota();
    } catch (err) {
      const msgs = err instanceof U.ErrorValidacion ? err.errores : [String(err.message || err)];
      dlg.error = msgs;
      cont.replaceChildren(tit, bloqueErrores(msgs));
    }
    const desc = $('#f_descripcion');
    if (desc && p.familia !== 'COMPRADO') desc.placeholder = C.planos.titulo(p) || NOMBRE_FAM[p.familia] || '';
  }

  /** En el dibujo del diálogo se resalta la cota del dato que se está capturando. */
  function resaltarCota() {
    const el = document.activeElement;
    const campo = el && el.id && el.id.startsWith('f_') ? el.id.slice(2) : null;
    $$('#dlg-prev .pl-cotas[data-campo]').forEach((g) => g.classList.toggle('activa', g.dataset.campo === campo));
  }

  function abrirDialogo(id) {
    const dialogo = $('#dlg-partida');
    dlg.id = id;
    let p;
    if (id) {
      const original = estado.cot.partidas.find((x) => x.id === id);
      if (!original || !Object.prototype.hasOwnProperty.call(W.CAMPOS, original.familia)) {
        toast('Esta partida tiene una familia que no existe en esta versión: elimínela y vuelva a capturarla.');
        return;
      }
      p = U.clonar(original);
      dlg.familia = p.familia;
      if (p.espesor_mm > 0) p.calibre = 'PROPIO';
      if (p.calibre !== undefined) p.calibre = String(p.calibre);
      if (p.caras_pintadas !== undefined) p.caras_pintadas = String(p.caras_pintadas);
    } else {
      dlg.familia = 'RECTO';
      p = W.partidaNueva('RECTO');
    }
    dlg.valores = p;
    $('#dlg-titulo').textContent = id ? 'Editar partida' : 'Nueva partida';
    $('#dlg-guardar').textContent = id ? 'Guardar cambios' : 'Agregar partida';
    $('#dlg-unidad-diam').value = estado.cot.unidad_diam;
    $('#dlg-unidad-long').value = estado.cot.unidad_long;
    renderFamilias();
    renderCamposDialogo();
    actualizarPreview();
    if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', '');
  }

  function cerrarDialogo() {
    const dialogo = $('#dlg-partida');
    if (typeof dialogo.close === 'function') dialogo.close(); else dialogo.removeAttribute('open');
    ocultarTip();
  }

  function enlazarDialogo() {
    const form = $('#form-partida');
    form.addEventListener('focusin', resaltarCota);
    // tocar una cota del dibujo lleva al dato que mide
    $('#dlg-prev').addEventListener('click', (e) => {
      const g = e.target.closest && e.target.closest('.pl-cotas[data-campo]');
      const campo = g && $(`#f_${g.dataset.campo}`);
      if (campo) { campo.focus(); resaltarCota(); }
    });
    const delegar = () => { actualizarVisibilidad(); actualizarPreview(); };
    form.addEventListener('input', delegar);
    form.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'f_articulo_id') sincronizarArticulo(true);
      if (e.target && e.target.id === 'f_material_id') {
        dlg.valores.material_id = e.target.value;
        const sel = $('#f_calibre');
        const previo = sel.value;
        const ops = opcionesCalibre(e.target.value);
        sel.replaceChildren(...ops.map(([v, t]) => h('option', { value: v, selected: v === previo }, t)));
        if (!ops.some(([v]) => v === previo)) sel.value = ops.some(([v]) => v === '16') ? '16' : ops[0][0];
      }
      delegar();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = leerDialogo();
      actualizarPreview();
      if (dlg.error) { $('#dlg-prev').scrollIntoView({ block: 'nearest' }); return; }
      if (dlg.id) {
        const i = estado.cot.partidas.findIndex((x) => x.id === dlg.id);
        estado.cot.partidas[i] = p;
        estado.sel = p.id;
      } else {
        p.id = idNuevo();
        estado.cot.partidas.push(p);
        estado.sel = p.id;
      }
      estado.cot.ejemplo = false;
      persistir();
      cerrarDialogo();
      render();
      toast(dlg.id ? 'Partida actualizada' : 'Partida agregada');
    });
    $('#dlg-cancelar').addEventListener('click', cerrarDialogo);
    $('#dlg-cerrar').addEventListener('click', cerrarDialogo);
    const cambiarUnidad = (clave) => (e) => {
      const p = leerDialogo();
      estado.cot[clave] = e.target.value;
      dlg.valores = { ...p, calibre: p.calibre === undefined ? 'PROPIO' : String(p.calibre), caras_pintadas: p.caras_pintadas === undefined ? undefined : String(p.caras_pintadas) };
      persistir();
      renderCamposDialogo();
      actualizarPreview();
      sincronizarEncabezado();
      render();
    };
    $('#dlg-unidad-diam').addEventListener('change', cambiarUnidad('unidad_diam'));
    $('#dlg-unidad-long').addEventListener('change', cambiarUnidad('unidad_long'));
    $('#dlg-partida').addEventListener('click', (e) => { if (e.target === e.currentTarget) cerrarDialogo(); });
  }

  /* ================================================================== */
  /* Intercambio (guardar / cargar / CSV) y propuesta impresa           */
  /* ================================================================== */
  const esc = (s) => `"${String(s === undefined || s === null ? '' : s).replace(/"/g, '""')}"`;
  // Un texto que empieza con = + - @ se tomaría por fórmula al abrirlo en Excel: se le antepone una comilla.
  const txt = (s) => esc(/^[=+\-@\t\r]/.test(String(s === undefined || s === null ? '' : s)) ? `'${s}` : s);
  /** CSV de una tabla [[celda…]…]: los números tal cual, los textos protegidos contra fórmulas. */
  W.csv = (filas) => filas.map((f) => f.map((c) => (typeof c === 'number' ? esc(String(c)) : txt(c))).join(',')).join('\n');

  function csvPartidas() {
    const fila = (c) => [txt(c[0]), txt(c[1]), txt(c[2]), esc(c[3]), esc(c[4]), esc(c[5]), esc(c[6]), esc(c[7])].join(',');
    const filas = [fila(['Descripción', 'Familia', 'Material', 'Calibre', 'Cantidad', 'Precio unitario', 'Importe', 'Peso neto total kg'])];
    estado.res.partidas.forEach((f, i) => {
      const p = estado.cot.partidas[i];
      if (!f.ok) { filas.push(fila([tituloPartida(p), p.familia, '', '', p.cantidad, 'ERROR', '', ''])); return; }
      filas.push(fila([tituloPartida(p), p.familia, esLamina(p.familia) ? nombreMaterial(p) : '', esLamina(p.familia) ? p.calibre || p.espesor_mm || '' : '', p.cantidad,
        f.precio.unitario.toFixed(2), f.precio.importe.toFixed(2), f.peso.neto_total_kg.toFixed(3)]));
    });
    (estado.res.automaticas || []).forEach((f) => filas.push(fila([f.descripcion, f.familia, '', '', 1, f.precio.unitario.toFixed(2), f.precio.importe.toFixed(2), '0.000'])));
    return filas.join('\n');
  }

  function jsonIntercambio() {
    return JSON.stringify({ app: 'COTIZAP', version: 2, exportado: new Date().toISOString(), cotizacion: estado.cot, maestros: parcheMaestros() }, null, 2);
  }

  async function copiar(texto, area) {
    try { await root.navigator.clipboard.writeText(texto); toast('Copiado al portapapeles'); } catch (e) {
      area.focus(); area.select(); toast('Texto seleccionado: cópielo con Ctrl+C');
    }
  }

  function cargarJSON(txt) {
    let obj;
    try { obj = JSON.parse(txt); } catch (e) { toast('El texto no es un JSON válido'); return false; }
    // La versión 1 exportaba los maestros completos, con los herrajes de arranque de entonces (ángulos por diámetro):
    // se descartan para que mande el estándar de bridas del taller; precios, tarifas y procesos sí se respetan.
    const antigua = esObjeto(obj) && esObjeto(obj.maestros) && !(Number(obj.version) >= 2);
    let parche = null;
    if (esObjeto(obj) && esObjeto(obj.maestros)) {
      const { herrajes, ...resto } = obj.maestros;
      parche = antigua ? resto : obj.maestros;
    }
    const M = parche ? C.maestros.crearMaestros(parche) : estado.M;
    const cot = esObjeto(obj) ? cotizacionValida(obj.cotizacion, M) : null;
    if (!cot) { toast('El archivo no contiene una cotización de COTIZAP'); return false; }
    const ignorados = parche ? C.maestros.leerParche(parche).descartados.length : 0;
    estado.M = M;
    estado.cot = cot;
    estado.sel = estado.cot.partidas[0] ? estado.cot.partidas[0].id : null;
    persistir();
    sincronizarEncabezado();
    render();
    if (root.COTIZAP.web.maestrosUI) root.COTIZAP.web.maestrosUI.render();
    toast(antigua ? 'Cotización cargada · archivo de una versión anterior: se aplicó la brida estándar del taller'
      : ignorados ? `Cotización cargada · ${ignorados} ${ignorados === 1 ? 'valor' : 'valores'} de las tablas no tenían la forma esperada y se ignoraron` : 'Cotización cargada');
    return true;
  }

  function enlazarIntercambio() {
    const dialogo = $('#dlg-io');
    const area = $('#io-texto');
    const abrir = () => {
      area.value = jsonIntercambio();
      if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', '');
    };
    $('#btn-io').addEventListener('click', abrir);
    $('#io-cerrar').addEventListener('click', () => dialogo.close());
    $('#io-copiar').addEventListener('click', () => copiar(area.value, area));
    $('#io-csv').addEventListener('click', () => { area.value = csvPartidas(); copiar(area.value, area); });
    $('#io-json').addEventListener('click', () => { area.value = jsonIntercambio(); });
    $('#io-cargar').addEventListener('click', () => { if (cargarJSON(area.value)) dialogo.close(); });
    $('#io-archivo').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const lector = new FileReader();
      lector.onload = () => { area.value = String(lector.result); if (cargarJSON(area.value)) dialogo.close(); };
      lector.readAsText(f);
      e.target.value = '';
    });
    const bajar = $('#io-descargar');
    if (SOLO_COPIAR) bajar.hidden = true;
    bajar.addEventListener('click', () => {
      const blob = new Blob([area.value], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `cotizap-${estado.cot.fecha || hoy()}.json` });
      document.body.append(a); a.click(); a.remove();
    });
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
  }

  function fechaLarga(iso) {
    if (!iso) return '—';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function renderPropuesta() {
    const c = estado.cot;
    const vigencia = Number.isFinite(c.vigencia_dias) && c.vigencia_dias > 0 ? Math.min(3650, Math.round(c.vigencia_dias)) : 0;
    const T = estado.res.totales;
    const filas = estado.res.partidas.map((f, i) => ({ f, p: c.partidas[i] })).filter((x) => x.f.ok);
    const dias = estado.res.capas.financiamiento.dias_cobro;
    const sec = $('#propuesta');
    sec.replaceChildren(
      h('header', { class: 'prop-cab' },
        h('h1', null, 'Propuesta de fabricación de ductería'),
        h('dl', null,
          kv('Cliente', c.cliente || '—'), kv('Proyecto', c.proyecto || '—'), kv('Fecha', fechaLarga(c.fecha)), kv('Vigencia', vigencia ? `${vigencia} días naturales` : '—'))),
      tabla([{ t: 'Partida' }, { t: 'Material' }, { t: 'Cant.', num: true }, { t: 'P. unitario', num: true }, { t: 'Importe', num: true }],
        [...filas.map(({ f, p }) => [h('div', null, h('strong', null, tituloPartida(p)), h('div', { class: 'prop-dim' }, W.resumenDims(p, { diam: c.unidad_diam, long: c.unidad_long }, estado.M))), resumenMaterial(p) || (p.familia === 'INSTALACION' ? 'Servicio' : 'Compra'), String(p.cantidad), W.mxn(f.precio.unitario), W.mxn(f.precio.importe)]),
          ...(estado.res.automaticas || []).map((f) => [h('div', null, h('strong', null, f.descripcion)), 'Material', '1', W.mxn(f.precio.unitario), W.mxn(f.precio.importe)])]),
      h('dl', { class: 'prop-tot' },
        kv('Subtotal', W.mxn(T.subtotal)),
        T.descuento > 0 ? kv(`Descuento ${pctCorto(T.descuento_pct)}`, `−${W.mxn(T.descuento)}`) : null,
        kv(`IVA ${pctCorto(T.iva_pct)}`, W.mxn(T.iva)),
        kv('Total', W.mxn(T.total))),
      h('p', { class: 'prop-nota' }, `Precios en pesos mexicanos (MXN), antes de IVA salvo indicación. Peso neto aproximado: ${W.num(T.peso_neto_kg, 1)} kg. ${vigencia ? `Vigencia de ${vigencia} días a partir de la fecha de emisión; ` : ''}sujeta a variación del precio del acero. Condiciones de pago: ${dias > 0 ? `crédito a ${dias} días` : 'de contado'}.`));
  }

  /* ================================================================== */
  /* Pestañas, avisos y arranque                                        */
  /* ================================================================== */
  function irPestana(t, destino) {
    estado.tab = t;
    $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.panel').forEach((p) => { p.hidden = p.id !== `panel-${t}`; });
    if (t === 'maestros' && W.maestrosUI) W.maestrosUI.render();
    if (t === 'planos' && W.planosUI) W.planosUI.render();
    const el = destino ? $(destino) : null;
    if (el) el.scrollIntoView({ block: 'start', behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function renderAvisos() {
    $('#aviso-ilustrativo').hidden = !!estado.M.meta.revisado;
    $('#aviso-ejemplo').hidden = !estado.cot.ejemplo;
    const nErr = estado.res.totales.n_partidas_error;
    const avisos = estado.res.avisos || [];
    const el = $('#aviso-error');
    el.hidden = !nErr && !avisos.length;
    el.querySelector('.aviso-txt').textContent = [
      nErr ? `${nErr} ${nErr === 1 ? 'partida no se puede calcular' : 'partidas no se pueden calcular'}: revise sus datos o las tablas maestras.` : '',
      ...avisos,
    ].filter(Boolean).join(' ');
  }

  function render() {
    calcular();
    if (!estado.cot.partidas.some((p) => p.id === estado.sel)) estado.sel = estado.cot.partidas[0] ? estado.cot.partidas[0].id : null;
    renderAvisos();
    renderPartidas();
    renderTotales();
    sincronizarParametros();
    renderDetalle();
    renderPropuesta();
    if (W.comprasUI) W.comprasUI.render();
    if (W.planosUI && estado.tab === 'planos') W.planosUI.render(); // los planos se dibujan sólo a la vista
  }
  W.render = render;
  W.persistir = persistir;

  function iniciar() {
    cargarEstado();
    $('#btn-agregar').addEventListener('click', () => abrirDialogo(null));
    $('#btn-nueva').addEventListener('click', () => {
      estado.cot = cotizacionVacia();
      estado.sel = null;
      persistir();
      sincronizarEncabezado();
      render();
      toast('Cotización nueva');
    });
    $('#btn-vaciar-ejemplo').addEventListener('click', () => {
      estado.cot = { ...cotizacionVacia(), unidad_diam: estado.cot.unidad_diam, unidad_long: estado.cot.unidad_long };
      estado.sel = null;
      persistir();
      sincronizarEncabezado();
      render();
    });
    $('#btn-imprimir').addEventListener('click', () => root.print());
    if (SOLO_COPIAR) $('#btn-imprimir').hidden = true;
    $$('[role="tab"]').forEach((b) => b.addEventListener('click', () => irPestana(b.dataset.tab)));
    $('#ir-maestros').addEventListener('click', () => irPestana('maestros'));
    $('#btn-ya-revise').addEventListener('click', () => { estado.M.meta.revisado = true; persistir(); render(); });
    $('.datos').addEventListener('submit', (e) => e.preventDefault());
    crearParametros();
    enlazarEncabezado();
    enlazarDialogo();
    enlazarIntercambio();
    sincronizarEncabezado();
    render();
    sincronizarParametros(true);
    irPestana('cotizacion');
    root.addEventListener('resize', () => $$('.seg').forEach((el) => el.classList.toggle('con-txt', el.offsetWidth >= 46)));
    iniciarAlmacen();
  }

  /** Abre el guardado automático: al cerrar o ocultar la página se escribe lo pendiente sin esperar la pausa. */
  function iniciarAlmacen() {
    $('#maestros-reintentar').addEventListener('click', () => Almacen.reintentar());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Almacen.vaciar(); });
    root.addEventListener('pagehide', () => Almacen.vaciar());
    const arranque = parcheMaestros();
    Almacen.iniciar(arranque).then((r) => {
      if (r.origen === 'remoto') aplicarRemoto(r.parche, arranque);
      else persistir(); // lo local manda (cambios pendientes o primera vez): se sube
    });
  }

  W.estadoApp = estado;
  W.tituloPartida = tituloPartida;
  W.resumenMaterial = resumenMaterial;
  /** Lleva a una partida de la cotización (desde los planos): la selecciona y muestra su desglose. */
  W.verPartida = (id) => {
    if (!estado.cot.partidas.some((p) => p.id === id)) return;
    estado.sel = id;
    render();
    irPestana('cotizacion', '#detalle');
  };
  /** Cotiza la cotización abierta con otras tablas maestras, sin tocar el estado: la ayuda de las tablas lo usa para «¿y si…?». */
  W.cotizarCon = (M) => C.cotizador.cotizar(entradaCotizacion(), M);
  W.recalcular = () => { persistir(); render(); };
  W.toast = toast;
  W.tile = tile;
  W.tabla = tabla;
  W.reemplazar = reemplazar;

  /** Copia un texto al portapapeles; si el navegador no deja, lo muestra seleccionado en «Guardar y cargar» para copiarlo a mano. */
  W.copiarTexto = async (texto, mensaje) => {
    try {
      await root.navigator.clipboard.writeText(texto);
      toast(mensaje || 'Copiado al portapapeles');
    } catch (e) {
      const dialogo = $('#dlg-io');
      const area = $('#io-texto');
      area.value = texto;
      if (!dialogo.open) { if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', ''); }
      area.focus();
      area.select();
      toast('Texto seleccionado: cópielo con Ctrl+C');
    }
  };

  /** Abre otra cotización en lugar de la actual (p. ej. un ejemplo); con «Deshacer» vuelve la anterior. */
  W.abrirCotizacion = (otra, mensaje) => {
    const cot = cotizacionValida(otra, estado.M);
    if (!cot) return false;
    const previa = { cot: estado.cot, sel: estado.sel };
    estado.cot = cot;
    estado.sel = cot.partidas[0] ? cot.partidas[0].id : null;
    persistir();
    sincronizarEncabezado();
    render();
    toast(mensaje || 'Cotización abierta', {
      texto: 'Deshacer',
      fn: () => {
        estado.cot = previa.cot;
        estado.sel = previa.sel;
        persistir();
        sincronizarEncabezado();
        render();
      },
    });
    return true;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
}(typeof self !== 'undefined' ? self : this));
