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
  const hoy = () => new Date().toISOString().slice(0, 10);

  function cotizacionEjemplo() {
    const base = { cantidad: 1, material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', clase_sellado: 'C', ref_diametro: 'INTERIOR' };
    const P = (o) => ({ id: idNuevo(), ...base, ...o });
    return {
      cliente: 'Cliente de ejemplo', proyecto: 'Colector de polvo · línea 2', fecha: hoy(), vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm',
      riesgo: 'MEDIO', servicio: 'POLVO', ejemplo: true,
      partidas: [
        P({ familia: 'RECTO', descripcion: 'Tramo recto Ø12″ × 3 m', D_mm: 304.8, L_mm: 3000, tipo_costura: 'A_TOPE', cantidad: 4 }),
        P({ familia: 'CODO', descripcion: 'Codo 90° · 5 gajos Ø12″', D_mm: 304.8, theta_deg: 90, k_R: 1.5, cantidad: 2 }),
        P({ familia: 'REDUCCION', descripcion: 'Reducción excéntrica Ø12″ → Ø8″', D1_mm: 304.8, D2_mm: 203.2, excentrica: 'CARA_PLANA' }),
        P({ familia: 'RAMAL', descripcion: 'Injerto simple a 45° Ø8″ sobre Ø12″', D_mm: 304.8, d_mm: 203.2, L_cuerpo_mm: 700, L_ramal_mm: 450, beta_deg: 45, cantidad: 2 }),
        P({ familia: 'REDUCCION_INJERTO', descripcion: 'Reducción con injerto 45° Ø12″ → Ø10″ + Ø6″', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 }),
        P({ familia: 'TRANSICION', descripcion: 'Transición Ø12″ → 400 × 300 mm', D_mm: 304.8, a_mm: 400, b_mm: 300 }),
        { id: idNuevo(), familia: 'COMPRADO', descripcion: 'Compuerta de guillotina Ø12″ (compra)', precio_compra_unitario: 1850, peso_kg: 9, cantidad: 1 },
      ],
    };
  }

  function cotizacionVacia() {
    return { cliente: '', proyecto: '', fecha: hoy(), vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm', riesgo: 'MEDIO', servicio: 'POLVO', ejemplo: false, partidas: [] };
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
    estado.M = parche ? U.mezclar(base, parche) : base;
    const c = leerLS(LLAVE_COT);
    estado.cot = c && Array.isArray(c.partidas) ? { ...cotizacionVacia(), ...c } : cotizacionEjemplo();
    migrarUnidades(estado.cot);
    if (estado.cot.ejemplo === true) {
      // La cotización de muestra que nadie ha tocado se renueva con la versión actual de la muestra (nombres de taller,
      // partidas nuevas); se respetan los ajustes generales que ya hubiera cambiado.
      const guardada = estado.cot;
      estado.cot = { ...cotizacionEjemplo(), ...Object.fromEntries(['unidad_diam', 'unidad_long', 'riesgo', 'servicio', 'fecha', 'vigencia_dias'].filter((k) => guardada[k] !== undefined).map((k) => [k, guardada[k]])) };
    }
    estado.cot.partidas.forEach((p) => { if (!p.id) p.id = idNuevo(); });
    estado.sel = estado.cot.partidas.length ? estado.cot.partidas[0].id : null;
  }

  /** Cotizaciones guardadas con la unidad única anterior pasan a unidades por eje. */
  function migrarUnidades(cot) {
    if (cot.unidad && !cot.unidad_diam) { cot.unidad_diam = cot.unidad; cot.unidad_long = 'mm'; }
    delete cot.unidad;
    if (!cot.unidad_diam) cot.unidad_diam = 'in';
    if (!cot.unidad_long) cot.unidad_long = 'mm';
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
    estado.M = U.mezclar(U.mezclar(base, remoto), ediciones);
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

  function calcular() {
    const cot = estado.cot;
    estado.res = C.cotizador.cotizar({ riesgo: cot.riesgo, servicio: cot.servicio, partidas: cot.partidas }, estado.M);
  }

  /* ================================================================== */
  /* Utilidades de presentación                                         */
  /* ================================================================== */
  const NOMBRE_FAM = Object.fromEntries([...W.FAMILIAS, ...W.FAMILIAS_RETIRADAS]);
  const ETQ_OP = Object.fromEntries(W.OPERACIONES);
  const nombreMaterial = (p) => {
    const m = estado.M.materiales[p.material_id];
    return m ? m.nombre.split(' (')[0] : p.material_id;
  };
  const resumenMaterial = (p) => (p.familia === 'COMPRADO' ? '' : `${nombreMaterial(p)} · ${p.espesor_mm > 0 ? `${p.espesor_mm} mm` : `cal. ${p.calibre}`}`);

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
  ];

  function composicion(filas) {
    const v = { mat: 0, mo: 0, ci: 0, imp: 0, util: 0 };
    filas.forEach((f) => {
      const s = f.costos.subtotales;
      v.mat += s.materiales + s.consumibles;
      v.mo += s.mano_obra + s.equipo + s.herramienta_menor + s.subcontratos;
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
    ['cliente', 'proyecto', 'fecha', 'vigencia_dias', 'unidad_diam', 'unidad_long', 'riesgo', 'servicio'].forEach((k) => {
      const el = $(`#c_${k}`);
      if (el && document.activeElement !== el) el.value = c[k] === undefined ? '' : c[k];
    });
  }

  function enlazarEncabezado() {
    ['cliente', 'proyecto', 'fecha', 'vigencia_dias', 'unidad_diam', 'unidad_long', 'riesgo', 'servicio'].forEach((k) => {
      const el = $(`#c_${k}`);
      el.addEventListener('input', () => {
        estado.cot[k] = k === 'vigencia_dias' ? Number(el.value) || 0 : el.value;
        if (estado.cot.ejemplo && (k === 'cliente' || k === 'proyecto')) estado.cot.ejemplo = false;
        persistir();
        render();
      });
    });
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
      W.iconoFamilia(p.familia),
      h('div', { class: 'partida-txt' },
        h('div', { class: 'partida-titulo' }, p.descripcion || NOMBRE_FAM[p.familia]),
        h('div', { class: 'partida-meta' }, [W.resumenDims(p, unidades()), resumenMaterial(p)].filter(Boolean).join(' · ')),
        chips.length ? h('div', { class: 'partida-chips' }, chips) : null)),
      h('div', { class: 'partida-der' },
        h('div', { class: 'partida-cifras' },
          h('div', { class: 'partida-cant' }, `${p.cantidad} × ${f && f.ok ? W.mxn(f.precio.unitario) : '—'}`),
          h('div', { class: 'partida-importe' }, f && f.ok ? W.mxn(f.precio.importe) : '—')),
        h('div', { class: 'partida-acc' },
          h('button', { type: 'button', class: 'btn-icono', 'aria-label': `Editar ${p.descripcion || NOMBRE_FAM[p.familia]}`, title: 'Editar', onclick: () => abrirDialogo(p.id) }, W.icono('editar')),
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
        h('button', { type: 'button', class: 'btn btn-primario', onclick: () => abrirDialogo(null) }, W.icono('mas'), 'Agregar la primera partida')));
      return;
    }
    reemplazar(ul, ps.map(filaPartida));
  }

  function duplicar(id) {
    const i = estado.cot.partidas.findIndex((p) => p.id === id);
    if (i < 0) return;
    const copia = U.clonar(estado.cot.partidas[i]);
    copia.id = idNuevo();
    copia.descripcion = `${copia.descripcion || NOMBRE_FAM[copia.familia]} (copia)`;
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
    const ok = R.partidas.filter((f) => f.ok);
    const piso = ok.reduce((s, f) => s + f.indicadores.precio_piso, 0);
    const margenMax = T.subtotal > 0 ? 1 - piso / T.subtotal : 0;
    const hMOD = ok.reduce((s, f) => s + f.costos.h_MOD, 0);
    const cont = $('#totales');
    reemplazar(cont,
      h('div', { class: 'hero' },
        h('div', { class: 'hero-et' }, 'Total con IVA'),
        h('div', { class: 'hero-val' }, W.mxn(T.total)),
        h('div', { class: 'hero-sub' }, `Subtotal ${W.mxn(T.subtotal)} · IVA ${W.pct(T.iva_pct, 0)} ${W.mxn(T.iva)}`)),
      h('div', { class: 'tiles' },
        tile('Peso neto', `${W.num(T.peso_neto_kg, 1)} kg`, `${T.n_partidas_ok} ${T.n_partidas_ok === 1 ? 'partida' : 'partidas'}${T.n_partidas_error ? ` · ${T.n_partidas_error} con error` : ''}`),
        tile('Precio por kg neto', T.precio_por_kg_neto ? `${W.mxn(T.precio_por_kg_neto)}` : '—', 'antes de IVA'),
        tile('Mano de obra directa', `${W.num(hMOD, 1)} h`, 'horas reales de taller'),
        tile('Piso de negociación', W.mxn(piso), ok.length ? `hasta −${W.num(margenMax * 100, 1)} % con utilidad cero` : '')),
      ok.length ? barraComposicion(composicion(ok), 'De qué se compone el precio') : null);
  }

  /* ================================================================== */
  /* Desglose de la partida seleccionada                                */
  /* ================================================================== */
  const ETQ_DET = {
    D_int_mm: ['Diámetro interior', 'mm', 2], D_med_mm: ['Diámetro medio (fibra neutra)', 'mm', 3], D_ext_mm: ['Diámetro exterior', 'mm', 3],
    ancho_plantilla_mm: ['Ancho de plantilla B', 'mm', 3], allowance_costura_mm: ['Holgura de costura', 'mm', 1], L_pieza_mm: ['Longitud por pieza', 'mm', 1],
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

  /** Plantilla de un tramo recto sobre la hoja estándar, a escala. */
  function svgHoja(f) {
    const d = f.geometria.detalle;
    const hoja = estado.M.proceso.hoja;
    const largoH = hoja.largo_mm;
    const anchoH = hoja.ancho_mm;
    const B = d.ancho_plantilla_mm;
    const Lp = d.L_pieza_mm;
    const nx = Math.floor(largoH / Lp + 1e-9);
    const ny = Math.floor(anchoH / B + 1e-9);
    const cabe = nx >= 1 && ny >= 1;
    const W_ = 320;
    const s = W_ / largoH;
    const alto = anchoH * s;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, at) => { const e = document.createElementNS(NS, tag); Object.keys(at).forEach((k) => e.setAttribute(k, at[k])); return e; };
    const svg = el('svg', { viewBox: `0 0 ${W_ + 20} ${alto + 34}`, class: 'hoja', role: 'img', 'aria-label': `Plantilla de ${W.num(B, 0)} por ${W.num(Lp, 0)} mm sobre hoja de ${anchoH} por ${largoH} mm` });
    svg.append(el('rect', { x: 10, y: 6, width: W_, height: alto, class: 'hoja-borde' }));
    let usadas = 0;
    if (cabe) {
      for (let iy = 0; iy < Math.min(ny, 4); iy += 1) {
        for (let ix = 0; ix < Math.min(nx, 4); ix += 1) {
          svg.append(el('rect', { x: 10 + ix * Lp * s, y: 6 + iy * B * s, width: Lp * s, height: B * s, class: 'hoja-pieza' }));
          usadas += 1;
        }
      }
      const t = el('text', { x: 10 + (Lp * s) / 2, y: 6 + (B * s) / 2 + 4, class: 'hoja-txt', 'text-anchor': 'middle' });
      t.textContent = `${W.num(B, 0)} × ${W.num(Lp, 0)} mm`;
      svg.append(t);
    } else {
      svg.append(el('rect', { x: 10, y: 6, width: Math.min(Lp * s, W_), height: Math.min(B * s, alto), class: 'hoja-fuera' }));
    }
    const pie = el('text', { x: 10, y: alto + 24, class: 'hoja-txt' });
    pie.textContent = `Hoja ${W.num(anchoH, 0)} × ${W.num(largoH, 0)} mm`;
    svg.append(pie);
    const aprov = cabe ? (nx * ny * B * Lp) / (anchoH * largoH) : 0;
    return { svg, cabe, aprov, porHoja: nx * ny, usadas };
  }

  function seccionHoja(f) {
    const r = svgHoja(f);
    const info = r.cabe
      ? h('p', { class: 'nota' }, `Caben ${r.porHoja} ${r.porHoja === 1 ? 'plantilla' : 'plantillas'} por hoja: aprovechamiento geométrico ${W.pct(r.aprov, 1)}. La merma de tabla (${W.pct(f.qto.lam.phi, 0)}) supone reaprovechar parte del retazo en piezas pequeñas.`)
      : h('p', { class: 'nota nota-adv' }, W.icono('aviso'), 'La plantilla excede la hoja estándar: use otro ancho de hoja o de rollo, o reduzca la longitud por pieza.');
    return h('div', { class: 'hoja-fig' }, h('div', { class: 'hoja-env' }, r.svg), info);
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
      f.familia === 'RECTO' ? seccionHoja(f) : null,
    ];
  }

  function detalleHerrajes(f) {
    const her = f.qto.her;
    const con = f.qto.con;
    const kvs = h('dl', { class: 'kvs' });
    kvs.append(kv('Unión', her.tipo_union), kv('Clase de sellado', her.clase_sellado));
    if (her.n_aros) {
      kvs.append(
        kv('Aros de brida', String(her.n_aros)),
        kv('Perfil de aros, neto / bruto', `${W.num(her.m_aros_neta_kg, 3)} / ${W.num(her.m_aros_bruta_kg, 3)}`, 'kg'),
        kv('Juegos de tornillería (asignados)', W.num(her.n_tornillos_asignados, 1)),
        kv('Barrenos', String(her.n_barrenos)),
        kv('Empaque', W.num(her.L_empaque_m, 3), 'm'));
    }
    if (her.n_espigas) kvs.append(kv('Espigas', String(her.n_espigas)), kv('Fijaciones', String(her.n_fijaciones)), kv('Lámina extra de espiga', W.num(her.A_espiga_m2, 4), 'm²'));
    kvs.append(kv('Sellado', `${W.num(her.L_sellado_m, 3)} m · ${W.num(her.V_sellador_ml, 1)}`, 'mL'));
    const cons = h('dl', { class: 'kvs' },
      kv('Depósito de soldadura', W.num(con.soldadura.m_depositado_g, 1), 'g'),
      kv('Alambre / varilla', W.num(con.soldadura.kg_alambre, 4), 'kg'),
      kv('Gas de protección', W.num(con.soldadura.V_gas_m3, 4), 'm³'),
      kv('Corte', `${W.num(con.corte.L_corte_m, 3)} m · ${con.corte.proceso}`),
      kv('Superficie a pintar', W.num(f.qto.pint.A_pint_m2, 3), 'm²'),
      kv('Pintura / diluyente', `${W.num(con.pintura.L_pintura, 3)} / ${W.num(con.pintura.L_diluyente, 3)}`, 'L'));
    const barreno = (a) => (a.barreno_desc ? `Ø${a.barreno_desc} (${W.num(a.diam_barreno_mm, 2)} mm)` : `Ø${W.num(a.diam_barreno_mm, 2)} mm`);
    const aros = her.aros.length
      ? tabla([{ t: 'Aro' }, { t: 'Perfil' }, { t: 'Barra', num: true }, { t: 'Barrenos', num: true }, { t: 'Tornillo' }, { t: 'Peso', num: true }],
        her.aros.map((a, i) => [`#${i + 1}`, a.descripcion || a.perfil_id, `${W.num(a.L_aro_mm, 1)} mm`,
          `${a.n_tornillos} × ${barreno(a)}`, a.tornillo_desc, `${W.num(a.m_aro_kg, 3)} kg`])) : null;
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

  function detalleCostos(f) {
    const c = f.costos;
    const filas = [];
    const ETQ = {
      lamina: 'Lámina', credito_chatarra: 'Crédito por chatarra', perfiles: 'Perfil de aros', tornilleria: 'Tornillería', fijaciones: 'Fijaciones de espiga', empaque: 'Empaque',
      sellador: 'Sellador', flete: 'Flete de entrada', compra: 'Compra', alambre: 'Alambre / varilla', gas: 'Gas de protección', corte: 'Consumibles de corte', pintura: 'Pintura y diluyente',
    };
    const grupo = (tit, obj) => {
      const ks = Object.keys(obj).filter((k) => Math.abs(obj[k]) > 0);
      if (!ks.length) return;
      filas.push({ clase: 'grupo', celdas: [tit, ''] });
      ks.forEach((k) => filas.push([`  ${ETQ[k] || k}`, W.mxn(obj[k])]));
    };
    grupo('Materiales', c.materiales);
    grupo('Consumibles', c.consumibles);
    filas.push({ clase: 'grupo', celdas: ['Mano de obra, equipo y terceros', ''] });
    filas.push(['  Mano de obra directa', W.mxn(c.subtotales.mano_obra)]);
    filas.push(['  Equipo (hora-máquina)', W.mxn(c.subtotales.equipo)]);
    filas.push(['  Herramienta menor', W.mxn(c.subtotales.herramienta_menor)]);
    Object.keys(c.subcontratos || {}).forEach((k) => filas.push([`  Subcontrato ${k}`, W.mxn(c.subcontratos[k])]));
    filas.push({ clase: 'total', celdas: ['Costo directo (CD)', W.mxn(c.CD)] });
    return tabla([{ t: 'Concepto' }, { t: 'MXN', num: true }], filas);
  }

  function detallePila(f) {
    const p = f.pila;
    const C = estado.M.capas;
    const filas = [
      ['Costo directo (CD)', '', W.mxn(p.CD)],
      ['CI de fábrica', `GIF ${W.mxn(C.gif_por_hora_mod)}/h × ${W.num(f.costos.h_MOD, 3)} h`, W.mxn(p.CI_fabrica)],
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
      W.iconoFamilia(p.familia),
      h('div', null, h('h3', null, p.descripcion || NOMBRE_FAM[p.familia]), h('p', { class: 'det-sub' }, [W.resumenDims(p, unidades()), resumenMaterial(p)].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'btn', onclick: () => abrirDialogo(p.id) }, W.icono('editar'), 'Editar'));
    if (!f.ok) {
      reemplazar(cont, cab, h('div', { class: 'errores' }, h('p', { class: 'errores-tit' }, W.icono('error'), 'No se puede calcular esta partida'), h('ul', null, f.errores.map((e) => h('li', null, e)))));
      return;
    }
    if (p.familia === 'COMPRADO') {
      reemplazar(cont, cab, detalleResumen(f), seccion('Pila de precio', detallePila(f), true));
      return;
    }
    reemplazar(cont, cab, detalleResumen(f),
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
    if (clave === 'perfiles') return [['', 'Estándar del taller'], ...Object.keys(M.herrajes.perfiles).map((k) => [k, `${k} · ${M.herrajes.perfiles[k].descripcion}`])];
    return W.OPC[clave];
  }

  function opcionesCalibre(materialId) {
    const M = estado.M;
    const mat = M.materiales[materialId];
    const tabla_ = mat ? M.calibres[mat.tabla_calibre] : {};
    return [...Object.keys(tabla_).map(Number).sort((a, b) => a - b).map((c) => [String(c), `${c} · ${W.num(tabla_[c] * W.MM_IN, 3)} mm`]), ['PROPIO', 'Espesor propio (placa)']];
  }

  function crearControl(c, valor) {
    const id = `f_${c.id}`;
    let ctl;
    if (c.tipo === 'select' || c.tipo === 'calibre') {
      let ops = c.tipo === 'calibre' ? opcionesCalibre(dlg.valores.material_id) : opcionesDe(c.opciones);
      // Un ángulo guardado que ya no está en la lista del taller se muestra tal cual, marcado, para que se vea qué hay que corregir.
      if (c.numerico && valor !== undefined && valor !== '' && !ops.some(([v]) => String(v) === String(valor))) ops = [[String(valor), `${valor}° (no permitido)`], ...ops];
      ctl = h('select', { id, name: c.id }, ops.map(([v, t]) => h('option', { value: v, selected: String(valor) === String(v) }, t)));
    } else if (c.tipo === 'dim') {
      ctl = h('input', { id, name: c.id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valor === undefined || valor === '' ? '' : aUnidad(valor, c.eje), placeholder: c.opcional ? 'auto' : '' });
      // El campo muestra el valor redondeado a la unidad elegida; si el usuario no lo toca, al guardar se conserva el valor exacto en mm.
      if (valor !== undefined && valor !== '') { ctl.dataset.mm = String(valor); ctl.dataset.texto = ctl.value; }
    } else if (c.tipo === 'text') {
      ctl = h('input', { id, name: c.id, type: 'text', autocomplete: 'off', value: valor || '' });
    } else {
      const v = c.tipo === 'pct' && valor !== undefined && valor !== '' ? Number((valor * 100).toFixed(3)) : valor;
      ctl = h('input', {
        id, name: c.id, type: 'number', inputmode: 'decimal', value: v === undefined ? '' : v, min: c.min, max: c.max, step: c.paso || (c.tipo === 'int' ? 1 : 'any'), placeholder: c.opcional ? 'auto' : '',
      });
    }
    const sufijo = c.tipo === 'dim' ? W.sufijoUnidad(unidadEje(c.eje)) : c.unidad;
    return h('div', { class: 'campo', dataset: { campo: c.id } },
      h('label', { for: id }, c.etiqueta),
      h('div', { class: 'ctl' }, ctl, sufijo ? h('span', { class: 'sufijo' }, sufijo) : null),
      c.ayuda ? h('div', { class: 'ayuda' }, c.ayuda) : null);
  }

  /** Lee el formulario → objeto de partida (mm). Los vacíos opcionales se omiten. */
  function leerDialogo() {
    const p = { familia: dlg.familia };
    if (dlg.id) p.id = dlg.id;
    const campos = [...W.CAMPOS[dlg.familia], ...(dlg.familia === 'COMPRADO' ? [] : [...W.CAMPOS_MATERIAL, ...W.CAMPOS_AVANZADOS])];
    const crudo = {};
    $$('#dlg-campos [name]').forEach((el) => { crudo[el.name] = el.value; });
    campos.forEach((c) => {
      const el = $(`#f_${c.id}`);
      if (!el) return;
      if (c.visible && !c.visible(crudo)) return;
      let v = el.value;
      if (c.tipo === 'select') {
        if (v === '') return;
        p[c.id] = c.id === 'caras_pintadas' || c.numerico ? Number(v) : v;
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
        else { v = W.leerNumero(v); p[c.id] = Number.isNaN(v) ? undefined : deUnidad(v, c.eje); }
      } else if (c.tipo === 'pct') p[c.id] = Number(v) / 100;
      else p[c.id] = Number(v);
    });
    p.descripcion = ($('#f_descripcion') || { value: '' }).value.trim();
    p.cantidad = Number(($('#f_cantidad') || { value: 1 }).value);
    if (dlg.familia !== 'COMPRADO') {
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
    const campos = [...W.CAMPOS[dlg.familia], ...(dlg.familia === 'COMPRADO' ? [] : [...W.CAMPOS_MATERIAL, ...W.CAMPOS_AVANZADOS])];
    campos.forEach((c) => {
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
    const grid = (campos) => h('div', { class: 'grid-campos' }, campos.map((c) => crearControl(c, v[c.id])));
    const partes = [
      h('fieldset', null, h('legend', null, 'Descripción y cantidad'),
        h('div', { class: 'grid-campos' },
          crearControl({ id: 'descripcion', etiqueta: 'Descripción', tipo: 'text' }, v.descripcion),
          crearControl({ id: 'cantidad', etiqueta: 'Cantidad', tipo: 'int', min: 1, paso: 1 }, v.cantidad))),
      h('fieldset', null, h('legend', null, fam === 'COMPRADO' ? 'Artículo comprado' : 'Dimensiones'), grid(W.CAMPOS[fam])),
    ];
    if (fam !== 'COMPRADO') {
      partes.push(h('fieldset', null, h('legend', null, 'Material y proceso'), grid(W.CAMPOS_MATERIAL.filter((c) => !c.familias || c.familias.includes(fam)))));
      const subs = (v.subcontratos || []).map(filaSub);
      const contSubs = h('div', { class: 'subs' }, subs);
      partes.push(h('details', { class: 'avanzado', open: !!(v.subcontratos || v.omitir_operaciones || v.merma_pct !== undefined || v.perfil_id) },
        h('summary', null, 'Opciones avanzadas'),
        grid(W.CAMPOS_AVANZADOS),
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
    ['descripcion', 'cantidad', 'material_id', 'calibre', 'espesor_mm', 'ref_diametro', 'tipo_union', 'clase_sellado', 'pintura', 'servicio', 'riesgo', 'caras_pintadas', 'proceso_corte', 'merma_pct', 'subcontratos', 'omitir_operaciones'].forEach((c) => {
      if (previo[c] !== undefined && !(k === 'COMPRADO' && !['descripcion', 'cantidad'].includes(c))) nuevo[c] = previo[c];
    });
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
    try {
      const defs = { riesgo: estado.cot.riesgo, servicio: estado.cot.servicio };
      const f = C.cotizador.cotizarPartida({ ...defs, ...p }, estado.M);
      const ind = f.indicadores;
      cont.replaceChildren(tit,
        h('div', { class: 'prev-precio' }, h('div', { class: 'tile-et' }, 'Precio unitario'), h('div', { class: 'prev-val' }, W.mxn(f.precio.unitario)), h('div', { class: 'tile-sub' }, `${p.cantidad} × = ${W.mxn(f.precio.importe)}`)),
        h('dl', { class: 'kvs kvs-1' },
          kv('Peso neto', W.num(f.peso.neto_total_kg, 2), 'kg'),
          kv('Precio por kg', ind.precio_por_kg_neto ? W.mxn(ind.precio_por_kg_neto) : '—'),
          kv('Mano de obra', W.num(ind.horas_mod_reales, 2), 'h'),
          f.geometria ? kv('Área de lámina', W.num(f.geometria.A_neta_m2, 3), 'm²') : null,
          f.qto ? kv('Lámina bruta', W.num(f.qto.lam.m_bruta_kg, 2), 'kg') : null),
        f.advertencias.length ? h('ul', { class: 'avisos' }, f.advertencias.map((a) => h('li', null, W.icono('aviso'), h('span', null, a)))) : h('p', { class: 'nota ok' }, W.icono('check'), 'Datos consistentes'));
      dlg.error = null;
    } catch (err) {
      const msgs = err instanceof U.ErrorValidacion ? err.errores : [String(err.message || err)];
      dlg.error = msgs;
      cont.replaceChildren(tit, h('div', { class: 'errores' }, h('p', { class: 'errores-tit' }, W.icono('error'), 'Revise estos datos'), h('ul', null, msgs.map((m) => h('li', null, m)))));
    }
  }

  function abrirDialogo(id) {
    const dialogo = $('#dlg-partida');
    dlg.id = id;
    let p;
    if (id) {
      p = U.clonar(estado.cot.partidas.find((x) => x.id === id));
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
    const delegar = () => { actualizarVisibilidad(); actualizarPreview(); };
    form.addEventListener('input', delegar);
    form.addEventListener('change', (e) => {
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
  function csvPartidas() {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const filas = [['Descripción', 'Familia', 'Material', 'Calibre', 'Cantidad', 'Precio unitario', 'Importe', 'Peso neto total kg'].map(esc).join(',')];
    estado.res.partidas.forEach((f, i) => {
      const p = estado.cot.partidas[i];
      if (!f.ok) { filas.push([p.descripcion, p.familia, '', '', p.cantidad, 'ERROR', '', ''].map(esc).join(',')); return; }
      filas.push([p.descripcion || NOMBRE_FAM[p.familia], p.familia, p.familia === 'COMPRADO' ? '' : nombreMaterial(p), p.calibre || p.espesor_mm || '', p.cantidad,
        f.precio.unitario.toFixed(2), f.precio.importe.toFixed(2), f.peso.neto_total_kg.toFixed(3)].map(esc).join(','));
    });
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
    if (!obj || !obj.cotizacion || !Array.isArray(obj.cotizacion.partidas)) { toast('El archivo no contiene una cotización de COTIZAP'); return false; }
    estado.cot = { ...cotizacionVacia(), ...obj.cotizacion };
    estado.cot.partidas.forEach((p) => { if (!p.id) p.id = idNuevo(); });
    // La versión 1 exportaba los maestros completos, con los herrajes de arranque de entonces (ángulos por diámetro):
    // se descartan para que mande el estándar de bridas del taller; precios, tarifas y procesos sí se respetan.
    const antigua = !!obj.maestros && !(Number(obj.version) >= 2);
    if (obj.maestros) {
      const { herrajes, ...resto } = obj.maestros;
      estado.M = U.mezclar(C.maestros.crearMaestros(), antigua ? resto : obj.maestros);
    }
    estado.sel = estado.cot.partidas[0] ? estado.cot.partidas[0].id : null;
    persistir();
    sincronizarEncabezado();
    render();
    if (root.COTIZAP.web.maestrosUI) root.COTIZAP.web.maestrosUI.render();
    toast(antigua ? 'Cotización cargada · archivo de una versión anterior: se aplicó la brida estándar del taller' : 'Cotización cargada');
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
    const T = estado.res.totales;
    const filas = estado.res.partidas.map((f, i) => ({ f, p: c.partidas[i] })).filter((x) => x.f.ok);
    const sec = $('#propuesta');
    sec.replaceChildren(
      h('header', { class: 'prop-cab' },
        h('h1', null, 'Propuesta de fabricación de ductería'),
        h('dl', null,
          kv('Cliente', c.cliente || '—'), kv('Proyecto', c.proyecto || '—'), kv('Fecha', fechaLarga(c.fecha)), kv('Vigencia', `${c.vigencia_dias} días naturales`))),
      tabla([{ t: 'Partida' }, { t: 'Material' }, { t: 'Cant.', num: true }, { t: 'P. unitario', num: true }, { t: 'Importe', num: true }],
        filas.map(({ f, p }) => [h('div', null, h('strong', null, p.descripcion || NOMBRE_FAM[p.familia]), h('div', { class: 'prop-dim' }, W.resumenDims(p, { diam: c.unidad_diam, long: c.unidad_long }))), resumenMaterial(p) || 'Compra', String(p.cantidad), W.mxn(f.precio.unitario), W.mxn(f.precio.importe)])),
      h('dl', { class: 'prop-tot' }, kv('Subtotal', W.mxn(T.subtotal)), kv(`IVA ${W.pct(T.iva_pct, 0)}`, W.mxn(T.iva)), kv('Total', W.mxn(T.total))),
      h('p', { class: 'prop-nota' }, `Precios en pesos mexicanos (MXN), antes de IVA salvo indicación. Peso neto aproximado: ${W.num(T.peso_neto_kg, 1)} kg. Vigencia de ${c.vigencia_dias} días a partir de la fecha de emisión; sujeta a variación del precio del acero.`));
  }

  /* ================================================================== */
  /* Pestañas, avisos y arranque                                        */
  /* ================================================================== */
  function irPestana(t) {
    estado.tab = t;
    $$('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.panel').forEach((p) => { p.hidden = p.id !== `panel-${t}`; });
    if (t === 'maestros' && W.maestrosUI) W.maestrosUI.render();
  }

  function renderAvisos() {
    $('#aviso-ilustrativo').hidden = !!estado.M.meta.revisado;
    $('#aviso-ejemplo').hidden = !estado.cot.ejemplo;
    const nErr = estado.res.totales.n_partidas_error;
    const el = $('#aviso-error');
    el.hidden = !nErr;
    if (nErr) el.querySelector('.aviso-txt').textContent = `${nErr} ${nErr === 1 ? 'partida no se puede calcular' : 'partidas no se pueden calcular'}: revise sus datos o las tablas maestras.`;
  }

  function render() {
    calcular();
    if (!estado.cot.partidas.some((p) => p.id === estado.sel)) estado.sel = estado.cot.partidas[0] ? estado.cot.partidas[0].id : null;
    renderAvisos();
    renderPartidas();
    renderTotales();
    renderDetalle();
    renderPropuesta();
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
    enlazarEncabezado();
    enlazarDialogo();
    enlazarIntercambio();
    sincronizarEncabezado();
    render();
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
  W.recalcular = () => { persistir(); render(); };
  W.toast = toast;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
}(typeof self !== 'undefined' ? self : this));
