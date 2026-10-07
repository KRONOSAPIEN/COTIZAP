/**
 * COTIZAP · web/rapida_ui.js — Pestaña «Cotización rápida»: un precio en minutos con el diámetro mayor y los metros hasta el
 * punto más alejado (motor/rapida.js). Se elige la yarda (3 o 4 ft), se ve cómo salen las yardas de cada lámina (el acomodo
 * dibujado a escala y una tira con todas las láminas) y se anotan los días de fabricación de bridas y de instalación: dan el
 * plazo y suman su mano de obra (días × personas × pago por día, de las tablas).
 * Lo capturado se recuerda en este navegador; los valores de la regla (factor, bridas por metros, utilidad y lámina de
 * arranque) están en Tablas maestras › Cotización rápida.
 * Depende de app.js (W.estadoApp) para las tablas maestras y la unidad de diámetro de la cotización.
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);

  const E = () => W.estadoApp;
  const LLAVE = 'cotizap.rapida.v1';
  const NS = 'http://www.w3.org/2000/svg';
  const MM_PIE = 304.8;
  const MAX_TIRA = 24; // láminas que se dibujan en la tira; más se resumen

  /** Lo capturado (textos, como se tecleó): diámetro (en la unidad de la cotización), metros, yarda (mm), lámina, utilidad (%) y días. */
  const VACIA = { diam: '', metros: '', yarda: '', hoja_id: '', utilidad: '', dias_fab: '', dias_ins: '' };
  let captura = null;
  function leerGuardado() {
    try {
      const x = JSON.parse(root.localStorage.getItem(LLAVE) || 'null');
      return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
    } catch (err) { return {}; }
  }
  function guardar() {
    try { root.localStorage.setItem(LLAVE, JSON.stringify(captura)); } catch (err) { /* sin almacenamiento: sólo dura esta visita */ }
  }

  const enPulgadas = () => (E().cot.unidad_diam || 'in') === 'in';
  const texto = (v) => (typeof v === 'string' ? v : '');
  /** 40 · 40.5 · 3 (sin ceros de sobra) */
  const corto = (x) => W.num(x, 2).replace(/\.?0+$/, '');
  const mm = (x) => W.num(Math.round(x), 0);
  const pies = (y) => `${corto(y / MM_PIE)} ft`;
  const plural = (n, uno, varios) => `${W.num(n, 0)} ${n === 1 ? uno : varios}`;

  /** Un número tecleado: vacío → undefined; ilegible → NaN (el motor lo señala). */
  const numero = (v) => (texto(v).trim() === '' ? undefined : W.leerNumero(v));

  /** La entrada del motor a partir de lo capturado; los campos vacíos o inválidos quedan sin número (el motor dice qué falta). */
  function entrada() {
    const d = W.leerNumero(captura.diam);
    const L = W.leerNumero(captura.metros);
    const u = numero(captura.utilidad);
    return {
      D_mm: Number.isFinite(d) ? d * (enPulgadas() ? W.MM_IN : 1) : undefined,
      L_m: Number.isFinite(L) ? L : undefined,
      yarda_mm: captura.yarda ? Number(captura.yarda) : undefined,
      hoja_id: captura.hoja_id || undefined,
      utilidad_pct: u === undefined ? undefined : u / 100,
      dias_fabricacion: numero(captura.dias_fab),
      dias_instalacion: numero(captura.dias_ins),
    };
  }

  /* ---------- Dibujo de la lámina ---------- */
  function svg(tag, attrs, ...hijos) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); });
    hijos.flat().forEach((c) => { if (c !== null && c !== undefined) el.append(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  /** La hoja a escala con sus plantillas numeradas, el sobrante rayado y las medidas (en mm). `n` = cuántas lleva (la última puede llevar menos). */
  function dibujoHoja(r, n, completo) {
    const { ancho_mm: A, largo_mm: L } = r.hoja;
    const piezas = r.acomodo.piezas.slice(0, n);
    const m = completo ? 150 : 30; // margen para las cotas
    const idTrama = `trama-${Math.random().toString(36).slice(2, 8)}`;
    const fuente = Math.max(50, Math.min(95, L / 34));
    const el = svg('svg', {
      viewBox: `${-m} ${-m} ${L + (completo ? 1.2 : 2) * m} ${A + (completo ? 1.2 : 2) * m}`, class: completo ? 'lam-svg' : 'lam-mini', role: completo ? 'img' : null,
      'aria-hidden': completo ? null : 'true', preserveAspectRatio: 'xMidYMid meet',
    },
    svg('defs', null, svg('pattern', { id: idTrama, width: 60, height: 60, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('line', { x1: 0, y1: 0, x2: 0, y2: 60, class: 'lam-trama' }))),
    svg('rect', { x: 0, y: 0, width: L, height: A, class: 'lam-hoja' }),
    svg('rect', { x: 0, y: 0, width: L, height: A, fill: `url(#${idTrama})`, class: 'lam-sobra' }),
    piezas.map((p, i) => svg('g', { class: `lam-yarda${p.girada ? ' lam-girada' : ''}` },
      svg('rect', { x: p.x, y: p.y, width: p.w, height: p.h }),
      completo ? svg('text', { x: p.x + p.w / 2, y: p.y + p.h / 2, 'font-size': Math.min(fuente * 1.6, p.h * 0.45, p.w * 0.45), class: 'lam-num' }, String(i + 1)) : null)));
    if (completo) {
      const t = (x, y, txt, extra) => svg('text', { x, y, 'font-size': fuente, class: 'lam-cota', ...extra }, txt);
      el.append(
        // las medidas de la hoja: el largo arriba y el ancho a la izquierda, con su línea de cota
        svg('line', { x1: 0, y1: -m * 0.25, x2: L, y2: -m * 0.25, class: 'lam-linea' }),
        t(L / 2, -m * 0.62, `${mm(L)} mm`),
        svg('line', { x1: -m * 0.25, y1: 0, x2: -m * 0.25, y2: A, class: 'lam-linea' }),
        t(-m * 0.62, A / 2, `${mm(A)} mm`, { transform: `rotate(-90 ${-m * 0.62} ${A / 2})` }));
    }
    return el;
  }

  function seccionAcomodo(r) {
    const n = r.yardas_por_hoja;
    if (!(n > 0)) {
      return h('div', { class: 'tarjeta lam' }, h('h3', null, 'Cómo salen las yardas de cada lámina'),
        h('p', { class: 'nota' }, W.icono('aviso'), `La plantilla de cada yarda (${mm(r.plantilla_mm)} mm) no cabe en la lámina de ${mm(r.hoja.ancho_mm)} × ${mm(r.hoja.largo_mm)} mm: cada yarda sale de varias piezas (${plural(r.hojas, 'lámina', 'láminas')} en total).`));
    }
    const giradas = r.acomodo.piezas.filter((p) => p.girada).length;
    const forma = r.acomodo.forma === 'MIXTO' ? ` (${W.num(n - giradas, 0)} a lo ancho y ${W.num(giradas, 0)} a lo largo de la lámina)`
      : r.acomodo.forma === 'GIRADAS' ? ' (con la yarda a lo largo de la lámina)' : '';
    const ultima = r.yardas_ultima_hoja;
    const resumen = `Cada lámina de ${mm(r.hoja.ancho_mm)} × ${mm(r.hoja.largo_mm)} mm da ${plural(n, 'yarda', 'yardas')}${forma}. ${plural(r.yardas, 'yarda', 'yardas')} ÷ ${W.num(n, 0)} = ${plural(r.hojas, 'lámina', 'láminas')}${r.hojas > 1 && ultima < n ? `; la última lleva ${plural(ultima, 'yarda', 'yardas')}` : ''}. Se aprovecha el ${W.num(r.aprovechamiento * 100, 0)} % de la lámina.`;
    const grande = dibujoHoja(r, n, true);
    grande.setAttribute('aria-label', `Una lámina con ${plural(n, 'yarda', 'yardas')} acomodadas; lo rayado es el sobrante.`);
    // la tira: cada lámina con las yardas que lleva (la última, las que faltan)
    const lleva = (i) => (i === r.hojas - 1 ? ultima : n);
    const indices = r.hojas <= MAX_TIRA ? [...Array(r.hojas).keys()] : [...Array(MAX_TIRA - 1).keys(), r.hojas - 1];
    const tira = h('ol', { class: 'lam-tira', 'aria-label': `${plural(r.hojas, 'lámina', 'láminas')}: ${r.hojas > 1 && ultima < n ? `${W.num(r.hojas - 1, 0)} con ${W.num(n, 0)} yardas y la última con ${W.num(ultima, 0)}` : `todas con ${W.num(n, 0)} yardas`}` },
      indices.map((i, k) => [
        r.hojas > MAX_TIRA && k === MAX_TIRA - 1 ? h('li', { class: 'lam-mas', 'aria-hidden': 'true' }, `… ${W.num(r.hojas - MAX_TIRA, 0)} más`) : null,
        h('li', { class: lleva(i) < n ? 'lam-parcial' : null, 'aria-hidden': 'true' }, dibujoHoja(r, lleva(i), false), h('span', null, `${W.num(i + 1, 0)} · ${W.num(lleva(i), 0)}`)),
      ]));
    return h('div', { class: 'tarjeta lam' },
      h('h3', null, 'Cómo salen las yardas de cada lámina'),
      h('p', { class: 'lam-resumen', id: 'rapida-acomodo' }, resumen),
      h('div', { class: 'lam-dibujo' }, grande),
      h('p', { class: 'lam-leyenda' },
        giradas < n ? [h('span', { class: 'lam-ley lam-ley-yarda' }), giradas ? 'Yarda a lo ancho de la lámina' : 'Yarda'] : null,
        giradas ? [h('span', { class: 'lam-ley lam-ley-girada' }), 'Yarda a lo largo de la lámina'] : null,
        h('span', { class: 'lam-ley lam-ley-sobra' }), 'Sobrante'),
      h('p', { class: 'lam-medida' }, `Cada yarda: ${mm(r.yarda_mm)} × ${mm(r.plantilla_mm)} mm (largo × perímetro más la costura).`),
      h('div', { class: 'lam-tira-tit' }, `Las ${plural(r.hojas, 'lámina', 'láminas')} (número · yardas que lleva)`),
      tira);
  }

  /* ---------- Resultado ---------- */
  const renglon = (concepto, detalle, importe, clase) => h('tr', { class: clase || null },
    h('td', null, h('div', { class: 'r-concepto' }, concepto), detalle ? h('div', { class: 'r-detalle' }, detalle) : null),
    h('td', { class: 'num' }, importe));

  /** «2 personas × $500 por día» */
  const cuadrilla = (personas, pago) => `${plural(personas, 'persona', 'personas')} × ${W.mxn(pago)} por día`;
  /** El renglón de la mano de obra de unos días (sólo si se capturaron). */
  const manoDeObra = (concepto, m) => (m.dias > 0 ? renglon(`${concepto}: ${corto(m.dias)} ${m.dias === 1 ? 'día' : 'días'}`, `${corto(m.dias)} ${m.dias === 1 ? 'día' : 'días'} × ${cuadrilla(m.personas, m.pago_dia)}.`, W.mxn(m.importe)) : null);

  function nominal(D_mm) {
    return enPulgadas() ? `${corto(D_mm / W.MM_IN)}″` : `${corto(D_mm)} mm`;
  }

  function textoPlazo(p) {
    const partes = [p.fabricacion > 0 ? `${corto(p.fabricacion)} ${p.fabricacion === 1 ? 'día' : 'días'} de fabricación de bridas` : '', p.instalacion > 0 ? `${corto(p.instalacion)} ${p.instalacion === 1 ? 'día' : 'días'} de instalación` : ''].filter(Boolean);
    return partes.length ? `${partes.join(' + ')}${partes.length > 1 ? ` = ${corto(p.total)} ${p.total === 1 ? 'día' : 'días'}` : ''}` : 'sin días';
  }

  function resultado(r) {
    const hj = r.hoja;
    const tramo = r.bridas.desde_m > 0 ? `de ${W.num(r.bridas.desde_m, 0)} a ${W.num(r.bridas.hasta_m, 0)} m` : `hasta ${W.num(r.bridas.hasta_m, 0)} m`;
    const cuenta = r.yardas_por_hoja > 0
      ? `${corto(r.entrada.L_m)} m son ${plural(r.yardas, 'yarda', 'yardas')} de ${pies(r.yarda_mm)}; cada lámina da ${plural(r.yardas_por_hoja, 'yarda', 'yardas')} de ${nominal(r.entrada.D_mm)}.`
      : `${corto(r.entrada.L_m)} m son ${plural(r.yardas, 'yarda', 'yardas')} de ${pies(r.yarda_mm)}; cada una sale de varias piezas.`;
    const total = h('div', { class: 'hero' },
      h('div', { class: 'hero-et' }, 'Total con IVA'),
      h('div', { class: 'hero-val', id: 'rapida-total-val' }, W.mxn(r.total)),
      h('div', { class: 'hero-sub' }, `${W.mxn(r.precio)} + IVA ${W.pct(r.iva_pct, 0)} · ${plural(r.hojas, 'lámina', 'láminas')} · yardas de ${pies(r.yarda_mm)}`));
    const plazo = r.plazo ? h('p', { class: 'r-plazo', id: 'rapida-plazo' }, h('strong', null, 'Plazo: '), textoPlazo(r.plazo)) : null;
    const desglose = h('table', { class: 'tabla rapida-tabla', id: 'rapida-desglose' },
      h('caption', { class: 'solo-lector' }, 'Desglose de la cotización rápida'),
      h('tbody', null,
        renglon(`Lámina: ${plural(r.hojas, 'hoja', 'hojas')} × ${W.mxn(hj.sin_iva)}`, `${hj.descripcion}, sin IVA. ${cuenta}`, W.mxn(r.lamina)),
        renglon(`Lámina × ${corto(r.factor)}`, 'Cubre la mano de obra, los accesorios y lo demás.', W.mxn(r.lamina_factor)),
        renglon('Bridas', `Por ${corto(r.entrada.L_m)} m: ${tramo}.`, W.mxn(r.bridas.importe)),
        manoDeObra('Fabricación de bridas', r.mano_obra.fabricacion),
        manoDeObra('Instalación', r.mano_obra.instalacion),
        renglon('Costo', null, W.mxn(r.costo), 'r-sub'),
        renglon(`Utilidad ${corto(r.utilidad_pct * 100)} %`, 'Sobre el costo.', W.mxn(r.utilidad)),
        renglon('Precio antes de IVA', null, W.mxn(r.precio), 'r-sub'),
        renglon(`IVA ${W.pct(r.iva_pct, 0)}`, null, W.mxn(r.iva)),
        renglon('Total', null, W.mxn(r.total), 'r-total')));
    return [
      h('div', { class: 'tarjeta totales' }, total, plazo, ...r.advertencias.map((a) => h('p', { class: 'nota' }, W.icono('aviso'), a))),
      seccionAcomodo(r),
      h('div', { class: 'tarjeta' }, desglose),
    ];
  }

  /** Los botones de la yarda (3 ft · 4 ft), marcado el capturado o el de las tablas. */
  function renderYardas(M) {
    const cont = $('#r_yarda');
    const opciones = C.rapida.yardas(M);
    const defecto = M.proceso && M.proceso.armado_yardas ? M.proceso.armado_yardas.yarda_defecto_mm : opciones[opciones.length - 1];
    const marcada = opciones.some((y) => String(y) === captura.yarda) ? Number(captura.yarda) : defecto;
    W.reemplazar(cont, ...opciones.map((y) => h('label', { class: 'segmento' },
      h('input', {
        type: 'radio', name: 'r_yarda', value: String(y), checked: y === marcada,
        onchange: () => { captura.yarda = String(y); guardar(); render(); },
      }),
      h('span', null, pies(y), h('small', null, `${mm(y)} mm`)))));
  }

  function render() {
    if (!captura || !E()) return;
    const M = E().M;
    // la unidad del diámetro es la de la cotización
    $('#r_diam_unidad').textContent = enPulgadas() ? 'pulgadas' : 'mm';
    renderYardas(M);
    // las hojas de la lista del proveedor (sólo las que tienen precio); sin elegir, la de las tablas o la del ancho de la yarda
    const hojas = C.rapida.hojas(M);
    const sel = $('#r_hoja');
    const yarda = captura.yarda ? Number(captura.yarda) : undefined;
    const auto = M.rapida ? C.rapida.hojaPara(M, '', yarda || (M.proceso.armado_yardas || {}).yarda_defecto_mm) : '';
    const elegida = hojas.some((x) => x.id === captura.hoja_id) ? captura.hoja_id : '';
    W.reemplazar(sel, h('option', { value: '' }, (hojas.find((x) => x.id === auto) || { descripcion: auto || '—' }).descripcion),
      ...hojas.map((x) => h('option', { value: x.id }, x.descripcion)));
    sel.value = elegida;
    $('#r_utilidad').placeholder = M.rapida ? `${corto(M.rapida.utilidad_pct * 100)} (de las tablas)` : '';
    if (M.rapida) {
      $('#r_fab_nota').textContent = cuadrilla(M.rapida.personas_fabricacion, M.rapida.pago_dia_fabricacion);
      $('#r_ins_nota').textContent = cuadrilla(M.rapida.personas_instalacion, M.rapida.pago_dia_instalacion);
    }
    const cont = $('#rapida-resultado');
    const e = entrada();
    if (e.D_mm === undefined && e.L_m === undefined) {
      W.reemplazar(cont, h('div', { class: 'tarjeta rapida-vacia' },
        h('p', null, 'Capture el diámetro máximo y los metros hasta el punto más alejado.'),
        h('p', { class: 'nota' }, `Regla: lámina en hojas enteras × ${M.rapida ? corto(M.rapida.factor_lamina) : '3'}, más las bridas según los metros, más la utilidad y el IVA. Se cambia en Tablas maestras › Cotización rápida.`)));
      return;
    }
    try {
      W.reemplazar(cont, ...resultado(C.rapida.cotizar(e, M)));
    } catch (err) {
      const msgs = err && err.errores ? err.errores : [String(err && err.message ? err.message : err)];
      W.reemplazar(cont, h('div', { class: 'tarjeta rapida-error', role: 'alert' }, h('ul', null, msgs.map((m) => h('li', null, m)))));
    }
  }

  function iniciar() {
    captura = { ...VACIA, ...leerGuardado() };
    const campos = [['#r_diam', 'diam'], ['#r_metros', 'metros'], ['#r_utilidad', 'utilidad'], ['#r_dias_fab', 'dias_fab'], ['#r_dias_ins', 'dias_ins']];
    campos.forEach(([sel, k]) => {
      const el = $(sel);
      el.value = texto(captura[k]);
      el.addEventListener('input', () => { captura[k] = el.value; guardar(); render(); });
    });
    $('#r_hoja').addEventListener('change', (ev) => { captura.hoja_id = ev.target.value; guardar(); render(); });
    $('#rapida-form').addEventListener('submit', (ev) => ev.preventDefault());
    $('#rapida-limpiar').addEventListener('click', () => {
      captura = { ...VACIA };
      campos.forEach(([sel]) => { $(sel).value = ''; });
      guardar();
      render();
      $('#r_diam').focus();
    });
  }

  W.rapidaUI = { render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
