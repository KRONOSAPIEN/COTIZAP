/**
 * COTIZAP · web/rapida_ui.js — Pestaña «Cotización rápida»: un precio en minutos con el diámetro mayor y los metros hasta el
 * punto más alejado (motor/rapida.js). Lo capturado se recuerda en este navegador; los valores de la regla (factor, bridas por
 * metros, utilidad y lámina de arranque) están en Tablas maestras › Cotización rápida.
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

  /** Lo capturado: { diam (texto, en la unidad de la cotización), metros (texto), hoja_id, utilidad (texto, en %) }. */
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

  /** La entrada del motor a partir de lo capturado; los campos vacíos o inválidos quedan sin número (el motor dice qué falta). */
  function entrada() {
    const d = W.leerNumero(captura.diam);
    const L = W.leerNumero(captura.metros);
    const u = W.leerNumero(captura.utilidad);
    return {
      D_mm: Number.isFinite(d) ? d * (enPulgadas() ? W.MM_IN : 1) : undefined,
      L_m: Number.isFinite(L) ? L : undefined,
      hoja_id: captura.hoja_id || undefined,
      utilidad_pct: texto(captura.utilidad).trim() === '' ? undefined : (Number.isFinite(u) ? u / 100 : NaN),
    };
  }

  /* ---------- Resultado ---------- */
  const renglon = (concepto, detalle, importe, clase) => h('tr', { class: clase || null },
    h('td', null, h('div', { class: 'r-concepto' }, concepto), detalle ? h('div', { class: 'r-detalle' }, detalle) : null),
    h('td', { class: 'num' }, importe));

  /** 40 · 40.5 · 3 (sin ceros de sobra) */
  const corto = (x) => W.num(x, 2).replace(/\.?0+$/, '');

  function nominal(D_mm) {
    return enPulgadas() ? `${corto(D_mm / W.MM_IN)}″` : `${corto(D_mm)} mm`;
  }

  function resultado(r) {
    const hj = r.hoja;
    const yardaM = W.num(hj.ancho_mm / 1000, 2);
    const cuenta = r.yardas_por_hoja > 0
      ? `${corto(r.entrada.L_m)} m son ${W.num(r.yardas, 0)} ${r.yardas === 1 ? 'yarda' : 'yardas'} de ${yardaM} m (el ancho de la hoja); cada hoja da ${W.num(r.yardas_por_hoja, 0)} ${r.yardas_por_hoja === 1 ? 'yarda' : 'yardas'} de ${nominal(r.entrada.D_mm)} (plantilla de ${W.num(r.plantilla_mm, 0)} mm).`
      : `${corto(r.entrada.L_m)} m son ${W.num(r.yardas, 0)} yardas de ${yardaM} m; la plantilla de cada una (${W.num(r.plantilla_mm, 0)} mm) es más larga que la hoja.`;
    const tramo = r.bridas.desde_m > 0 ? `de ${W.num(r.bridas.desde_m, 0)} a ${W.num(r.bridas.hasta_m, 0)} m` : `hasta ${W.num(r.bridas.hasta_m, 0)} m`;
    const total = h('div', { class: 'hero' },
      h('div', { class: 'hero-et' }, 'Total con IVA'),
      h('div', { class: 'hero-val', id: 'rapida-total-val' }, W.mxn(r.total)),
      h('div', { class: 'hero-sub' }, `${W.mxn(r.precio)} + IVA ${W.pct(r.iva_pct, 0)} · ${W.num(r.hojas, 0)} ${r.hojas === 1 ? 'hoja' : 'hojas'} de lámina`));
    const desglose = h('table', { class: 'tabla rapida-tabla', id: 'rapida-desglose' },
      h('caption', { class: 'solo-lector' }, 'Desglose de la cotización rápida'),
      h('tbody', null,
        renglon(`Lámina: ${W.num(r.hojas, 0)} ${r.hojas === 1 ? 'hoja' : 'hojas'} × ${W.mxn(hj.sin_iva)}`, `${hj.descripcion}, sin IVA. ${cuenta}`, W.mxn(r.lamina)),
        renglon(`Lámina × ${corto(r.factor)}`, 'Cubre la mano de obra, los accesorios y lo demás.', W.mxn(r.lamina_factor)),
        renglon('Bridas', `Por ${corto(r.entrada.L_m)} m: ${tramo}.`, W.mxn(r.bridas.importe)),
        renglon('Costo', null, W.mxn(r.costo), 'r-sub'),
        renglon(`Utilidad ${corto(r.utilidad_pct * 100)} %`, 'Sobre el costo.', W.mxn(r.utilidad)),
        renglon('Precio antes de IVA', null, W.mxn(r.precio), 'r-sub'),
        renglon(`IVA ${W.pct(r.iva_pct, 0)}`, null, W.mxn(r.iva)),
        renglon('Total', null, W.mxn(r.total), 'r-total')));
    return [h('div', { class: 'tarjeta totales' }, total, ...r.advertencias.map((a) => h('p', { class: 'nota' }, W.icono('aviso'), a))), h('div', { class: 'tarjeta' }, desglose)];
  }

  function render() {
    if (!captura || !E()) return;
    const M = E().M;
    // la unidad del diámetro es la de la cotización
    $('#r_diam_unidad').textContent = enPulgadas() ? 'pulgadas' : 'mm';
    // las hojas de la lista del proveedor (sólo las que tienen precio)
    const hojas = C.rapida.hojas(M);
    const sel = $('#r_hoja');
    const defecto = M.rapida && M.rapida.hoja_defecto;
    const elegida = hojas.some((x) => x.id === captura.hoja_id) ? captura.hoja_id : '';
    W.reemplazar(sel, h('option', { value: '' }, (hojas.find((x) => x.id === defecto) || { descripcion: defecto || '—' }).descripcion),
      ...hojas.map((x) => h('option', { value: x.id }, x.descripcion)));
    sel.value = elegida;
    $('#r_utilidad').placeholder = M.rapida ? `${corto(M.rapida.utilidad_pct * 100)} (de las tablas)` : '';
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
    captura = { diam: '', metros: '', hoja_id: '', utilidad: '', ...leerGuardado() };
    const campos = [['#r_diam', 'diam'], ['#r_metros', 'metros'], ['#r_utilidad', 'utilidad']];
    campos.forEach(([sel, k]) => {
      const el = $(sel);
      el.value = texto(captura[k]);
      el.addEventListener('input', () => { captura[k] = el.value; guardar(); render(); });
    });
    $('#r_hoja').addEventListener('change', (ev) => { captura.hoja_id = ev.target.value; guardar(); render(); });
    $('#rapida-form').addEventListener('submit', (ev) => ev.preventDefault());
    $('#rapida-limpiar').addEventListener('click', () => {
      captura = { diam: '', metros: '', hoja_id: '', utilidad: '' };
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
