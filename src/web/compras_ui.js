/**
 * COTIZAP · web/compras_ui.js — Pestaña «Compras y gastos».
 *
 *   Venta y precio mínimo — la venta pactada con el cliente (sin IVA) contra el costo directo, el precio mínimo (no perder) y el
 *                           precio calculado, en una regla de tres zonas: pierde · no cubre indirectos · gana.
 *   Lista de compras      — lo que hay que comprar en piezas enteras (hojas, barras, tornillos por decena, cartuchos, envases),
 *                           lo que ya cobran las partidas y el sobrante, que la cotización siempre cobra.
 *   Control de gastos     — cada ticket o factura real (con o sin IVA, con o sin factura) y su comparación con lo cotizado,
 *                           por categoría, hasta la utilidad real del proyecto.
 *
 * Los renglones de gastos se redibujan sólo cuando cambia la lista (agregar, quitar, otra cotización): al teclear se actualizan
 * sus cifras sin reconstruir los campos, para no perder el cursor. Depende de app.js (W.estadoApp, W.persistir, W.render…).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const G = C.gastos;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const E = () => W.estadoApp;
  const corta = (k) => (G.CATEGORIAS[k] || k).split(':')[0];
  const red = (x, d) => Number(Number(x).toFixed(d === undefined ? 2 : d));
  const SIN_PLURAL = ['L', 'm', 'mL', 'kg', 'm³'];
  const unidad = (n, u) => (SIN_PLURAL.includes(u) || Math.abs(n - 1) < 1e-9 ? u : `${u}s`);
  const cifra = (n) => W.num(n, Number.isInteger(red(n, 6)) ? 0 : 2);
  const idNuevo = () => `g${Math.random().toString(36).slice(2, 8)}`;
  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /* ================================================================== */
  /* Venta y precio mínimo                                              */
  /* ================================================================== */

  /** Regla de tres zonas: de 0 al costo directo se pierde; hasta el precio mínimo no se cubren indirectos; arriba, se gana. */
  function regla(CD, minimo, calculado, venta) {
    const tope = Math.max(calculado, minimo, venta || 0, CD) * 1.08 || 1;
    const p = (x) => Math.max(0, Math.min(100, (x / tope) * 100));
    const zona = (a, b, cls) => h('div', { class: `cg-zona ${cls}`, style: `left:${p(a).toFixed(2)}%;width:${Math.max(0, p(b) - p(a)).toFixed(2)}%` });
    const marca = (x, et, cls) => {
      const pos = p(x);
      const lado = pos > 78 ? ' cg-marca-der' : pos < 22 ? ' cg-marca-izq' : '';
      return h('div', { class: `cg-marca ${cls}${lado}`, style: `left:${pos.toFixed(2)}%` }, h('span', { class: 'cg-marca-et' }, `${et} ${W.mxn(x)}`));
    };
    const texto = `Costo directo ${W.mxn(CD)}; precio mínimo ${W.mxn(minimo)}; precio calculado ${W.mxn(calculado)}${venta !== null ? `; venta pactada ${W.mxn(venta)}` : ''}.`;
    return h('figure', { class: `cg-regla${venta !== null ? ' cg-regla-venta' : ''}`, role: 'img', 'aria-label': texto },
      h('div', { class: 'cg-regla-barra' },
        zona(0, CD, 'cg-pierde'), zona(CD, minimo, 'cg-justo'), zona(minimo, tope, 'cg-gana'),
        marca(calculado, 'Calculado', 'cg-marca-calc'),
        venta !== null ? marca(venta, 'Pactada', 'cg-marca-venta') : null),
      h('figcaption', { class: 'cg-regla-ley' },
        h('span', null, h('i', { class: 'sw cg-pierde' }), 'Pierde: no cubre el costo directo'),
        h('span', null, h('i', { class: 'sw cg-justo' }), 'Cubre el costo directo, no los indirectos'),
        h('span', null, h('i', { class: 'sw cg-gana' }), 'Arriba del precio mínimo: gana')));
  }

  function renderVenta() {
    const cont = $('#cg-resultado');
    if (!cont) return;
    const R = E().res;
    const T = R.totales;
    const V = T.venta;
    const hay = T.n_partidas_ok > 0;
    if (!hay) {
      W.reemplazar(cont, h('p', { class: 'nota' }, W.icono('info'), 'Agregue partidas a la cotización para ver su costo directo, su precio mínimo y lo que deja la venta.'));
      return;
    }
    const CD = T.costo_directo;
    const util = R.capas.utilidad_pct_precio;
    const tiles = h('div', { class: 'tiles' },
      W.tile('Costo directo', W.mxn(CD), 'material, mano de obra, compras y viáticos'),
      W.tile('Precio mínimo', W.mxn(T.precio_minimo), 'cubre indirectos, financiamiento y comisión; utilidad cero'),
      W.tile('Precio calculado', W.mxn(T.subtotal_neto), `con ${W.pct(util, 0)} de utilidad${T.descuento > 0 ? ' y el descuento' : ''}`),
      V ? W.tile('Venta pactada', W.mxn(V.pactada), `${V.con_iva ? `antes de IVA (${W.mxn(V.capturada)} con IVA) · ` : ''}${V.diferencia >= 0 ? '+' : '−'}${W.mxn(Math.abs(V.diferencia))} contra lo calculado`, 'tile-principal') : null,
      V ? W.tile('Utilidad con la venta', W.mxn(V.utilidad), `${W.num(V.margen_pct * 100, 1)} % de la venta`, V.utilidad < 0 ? 'tile-adv' : '')
        : W.tile('Utilidad calculada', W.mxn(T.utilidad), `${W.num(T.margen_real_pct * 100, 1)} % del precio`));
    let juicio;
    if (!V) juicio = 'Sin venta pactada: el resultado se mide con el precio calculado. Capture arriba lo que se acordó con el cliente (y si ya trae IVA) para ver lo que de verdad deja.';
    else if (V.utilidad >= 0) juicio = `La venta cubre todo el costo (directo, indirectos, financiamiento y comisión) y deja ${W.mxn(V.utilidad)} de utilidad.`;
    else if (V.cubre_costo_directo) juicio = `La venta cubre el costo directo, pero le faltan ${W.mxn(T.precio_minimo - V.pactada)} para llegar al precio mínimo: no paga sus indirectos, el financiamiento ni la comisión.`;
    else juicio = `La venta no alcanza ni el costo directo: faltan ${W.mxn(CD - V.pactada)} sólo para pagar material, mano de obra, compras y viáticos.`;
    W.reemplazar(cont,
      regla(CD, T.precio_minimo, T.subtotal_neto, V ? V.pactada : null),
      tiles,
      h('p', { class: `nota${V && V.utilidad < 0 ? ' nota-adv' : ''}` }, W.icono(V && V.utilidad < 0 ? 'aviso' : 'info'), juicio),
      V ? h('p', { class: 'nota' }, V.con_iva
        ? `Se capturó con IVA: ${W.mxn(V.capturada)} ÷ (1 + ${W.pct(T.iva_pct, 0)}) = ${W.mxn(V.pactada)} antes de IVA. El IVA (${W.mxn(V.iva)}) es del SAT: no es venta.`
        : `Con IVA (${W.pct(T.iva_pct, 0)}), la venta pactada factura ${W.mxn(V.total)}.`) : null);
  }

  /* ================================================================== */
  /* Lista de compras                                                   */
  /* ================================================================== */
  const NOMBRE_GRUPO = {
    lamina: 'Lámina (hojas)', barra: 'Perfiles y soportería (barras)', tornillo: 'Tornillería', sellador: 'Sellador', pintura: 'Pintura',
    empaque: 'Empaque', anclaje: 'Anclajes', comprado: 'Artículos comprados',
  };

  function necesarioTexto(r) {
    switch (r.grupo) {
      case 'lamina': return `${W.num(r.necesario, 2)} hojas · ${W.num(r.kg, 1)} kg`;
      case 'barra': return `${W.num(r.metros, 2)} m · ${r.piezas} ${r.piezas === 1 ? 'pieza' : 'piezas'}${r.empalmes ? ` (${r.empalmes} con empalme)` : ''}`;
      case 'tornillo': return `${cifra(r.necesario)} + reserva = ${W.num(r.con_reserva, 1)}`;
      case 'sellador': return `${W.num(r.ml, 0)} mL`;
      case 'pintura': return `${W.num(r.necesario, 2)} L`;
      case 'empaque': return `${W.num(r.necesario, 2)} m`;
      default: return `${cifra(r.necesario)} ${unidad(r.necesario, r.unidad)}`;
    }
  }
  const compraTexto = (r) => `${cifra(r.compra)} ${unidad(r.compra, r.unidad)}${r.grupo === 'barra' && r.sobra_m > 0.0005 ? ` · sobran ${W.num(r.sobra_m, 2)} m` : ''}`;

  function renderLista() {
    const cont = $('#cg-lista');
    if (!cont) return;
    const R = E().res;
    const L = R.compras;
    if (!L.renglones.length) {
      W.reemplazar(cont, h('p', { class: 'nota' }, W.icono('info'), 'Sin compras todavía: la lista sale de las partidas de la cotización.'));
      return;
    }
    const filas = [];
    Object.keys(NOMBRE_GRUPO).forEach((g) => {
      const rs = L.renglones.filter((r) => r.grupo === g);
      if (!rs.length) return;
      filas.push({ clase: 'grupo', celdas: [NOMBRE_GRUPO[g], '', '', '', '', '', ''] });
      rs.forEach((r) => filas.push({
        clase: r.sobrante > 0.005 ? 'cg-con-sobrante' : '',
        celdas: [
          h('div', null, r.descripcion, r.medida ? h('span', { class: 'cg-medida' }, ` · ${r.medida}`) : null),
          necesarioTexto(r), h('strong', null, compraTexto(r)), W.mxn(r.unitario_sin_iva), W.mxn(r.importe_compra), W.mxn(r.costo_cotizado), r.sobrante > 0.005 ? W.mxn(r.sobrante) : '—',
        ],
      }));
    });
    filas.push({ clase: 'total', celdas: ['Total', '', '', '', W.mxn(L.importe_compra), W.mxn(L.costo_cotizado), W.mxn(L.sobrante)] });
    const auto = (R.automaticas || [])[0];
    const nota = auto
      ? `El sobrante (${W.mxn(L.sobrante)} de costo) se cobra en la cotización: partida automática de ${W.mxn(auto.precio.importe)} con su indirecto y su utilidad.`
      : L.sobrante > 0.005
        ? `El sobrante (${W.mxn(L.sobrante)}) no se cobra: sale de la utilidad o queda como retazo en el taller. Márquelo arriba para cobrarlo.`
        : 'Lo que se compra entero ya lo cobran las partidas: no hay sobrante.';
    const sold = L.soldadura.filter((s) => s.kg_alambre > 0);
    const nombre = (ref) => { const a = C.ayudaMaestros.buscar(['precios', ref]); return a ? a.t.charAt(0).toLowerCase() + a.t.slice(1) : ref; };
    W.reemplazar(cont,
      W.tabla([{ t: 'Concepto' }, { t: 'Se necesita' }, { t: 'Comprar' }, { t: 'Precio sin IVA', num: true }, { t: 'Importe', num: true }, { t: 'Cotizado', num: true }, { t: 'Sobrante', num: true }], filas),
      h('p', { class: `nota${auto ? ' ok' : ''}` }, W.icono(auto ? 'check' : 'info'), nota),
      sold.length ? h('p', { class: 'nota' }, W.icono('info'),
        `Soldadura (se compra por kg y se cotiza lo que se usa): ${sold.map((s) => `${W.num(s.kg_alambre, 2)} kg de ${nombre(s.alambre_ref)} y ${W.num(s.m3_gas, 3)} m³ de ${nombre(s.gas_ref)}`).join('; ')}.`) : null);
  }

  /** CSV de la lista de compras (para el proveedor o Excel). */
  function csvLista() {
    const L = E().res.compras;
    const filas = [['Grupo', 'Concepto', 'Medida', 'Se necesita', 'Comprar', 'Unidad', 'Precio unitario sin IVA', 'Importe sin IVA', 'Cotizado', 'Sobrante']];
    L.renglones.forEach((r) => filas.push([NOMBRE_GRUPO[r.grupo] || r.grupo, r.descripcion, r.medida || '', necesarioTexto(r), red(r.compra, 3), r.unidad,
      red(r.unitario_sin_iva), red(r.importe_compra), red(r.costo_cotizado), red(r.sobrante)]));
    return W.csv(filas);
  }

  /* ================================================================== */
  /* Control de gastos                                                  */
  /* ================================================================== */
  const gastos = () => {
    const c = E().cot;
    if (!Array.isArray(c.gastos)) c.gastos = [];
    return c.gastos;
  };
  const ivaCompras = () => E().M.compras.iva_pct;
  let firmaCaptura = null; // los id de los renglones dibujados: si cambian, se redibuja la captura

  function filaGasto(g, i) {
    const n = i + 1;
    const num = (v) => (v === '' || v === undefined || v === null ? '' : String(v));
    return h('tr', { class: g.estimado ? 'cg-estimado' : '', dataset: { id: g.id } },
      h('td', null, h('input', { type: 'date', class: 'cg-in-fecha', value: g.fecha || '', dataset: { campo: 'fecha' }, 'aria-label': `Fecha del gasto ${n}` })),
      h('td', { class: 'cg-td-concepto' },
        h('input', { type: 'text', class: 'cg-in-concepto', value: g.concepto, maxlength: '200', placeholder: 'Concepto (p. ej. 6 soleras 1½″ × 3/16″)', dataset: { campo: 'concepto' }, 'aria-label': `Concepto del gasto ${n}` }),
        g.estimado ? h('span', { class: 'chip chip-adv cg-chip-est', title: 'Viene de la lista de compras con el precio cotizado: cámbielo por el del ticket' }, 'estimado') : null),
      h('td', null, h('select', { dataset: { campo: 'categoria' }, 'aria-label': `Categoría del gasto ${n}` },
        Object.keys(G.CATEGORIAS).map((k) => h('option', { value: k, selected: k === g.categoria }, corta(k))))),
      h('td', { class: 'num' }, h('input', { type: 'number', class: 'cg-in-num', min: '0', step: 'any', inputmode: 'decimal', value: num(g.cantidad), placeholder: '1', dataset: { campo: 'cantidad' }, 'aria-label': `Cantidad del gasto ${n}` })),
      h('td', { class: 'num' }, h('input', { type: 'number', class: 'cg-in-num', min: '0', step: 'any', inputmode: 'decimal', value: num(g.precio_unitario), placeholder: '0.00', dataset: { campo: 'precio_unitario' }, 'aria-label': `Precio unitario del gasto ${n}` })),
      h('td', { class: 'cg-c' }, h('input', { type: 'checkbox', checked: g.iva_incluido === true, dataset: { campo: 'iva_incluido' }, 'aria-label': `El precio del gasto ${n} trae IVA` })),
      h('td', { class: 'cg-c' }, h('input', { type: 'checkbox', checked: g.con_factura === true, dataset: { campo: 'con_factura' }, 'aria-label': `El gasto ${n} tiene factura` })),
      h('td', { class: 'num cg-costo', dataset: { campo: 'costo' } }, '—'),
      h('td', null, h('button', { type: 'button', class: 'btn-icono', title: 'Quitar', 'aria-label': `Quitar el gasto ${n}`, dataset: { quitar: g.id } }, W.icono('basura'))));
  }

  function renderCaptura() {
    const cont = $('#cg-captura');
    if (!cont) return;
    const gs = gastos();
    firmaCaptura = gs.map((g) => g.id).join('|');
    if (!gs.length) {
      W.reemplazar(cont, h('div', { class: 'vacio cg-vacio' },
        h('p', { class: 'vacio-tit' }, 'Todavía no hay gastos capturados'),
        h('p', null, 'Capture cada ticket o factura del proyecto, o use la lista de compras como base y cambie cada precio por el real.'),
        h('div', { class: 'cg-acc' },
          h('button', { type: 'button', class: 'btn btn-primario', onclick: agregar }, W.icono('mas'), 'Agregar el primer gasto'),
          h('button', { type: 'button', class: 'btn btn-sec', onclick: () => desdeLista() }, 'Usar la lista de compras'),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'cg-ejemplo', onclick: verEjemplo }, 'Ver el ejemplo: proyecto vendido en $45,710'))));
      return;
    }
    W.reemplazar(cont, h('div', { class: 'tabla-env' }, h('table', { class: 'tabla cg-tabla-gastos' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Fecha'), h('th', { scope: 'col' }, 'Concepto'), h('th', { scope: 'col' }, 'Categoría'),
        h('th', { scope: 'col', class: 'num' }, 'Cantidad'), h('th', { scope: 'col', class: 'num' }, 'Precio unitario'),
        h('th', { scope: 'col', title: 'El precio capturado ya trae IVA (como el ticket)' }, 'Trae IVA'), h('th', { scope: 'col', title: 'Hay factura: el IVA se acredita' }, 'Factura'),
        h('th', { scope: 'col', class: 'num' }, 'Costo sin IVA'), h('th', { scope: 'col' }, h('span', { class: 'solo-lector' }, 'Quitar')))),
      h('tbody', null, gs.map(filaGasto)))));
  }

  /** Cifras de cada renglón (costo, renglón inválido) sin tocar los campos. */
  function actualizarCifras(R) {
    const porId = new Map(gastos().map((g, i) => [g.id, R.gastos.find((x) => x.indice === i)]));
    $$('#cg-captura tr[data-id]').forEach((tr) => {
      const x = porId.get(tr.dataset.id);
      const celda = $('[data-campo="costo"]', tr);
      const mal = !!(x && !x.valido);
      tr.classList.toggle('cg-mal', mal);
      tr.title = mal ? R.errores.filter((e) => e.startsWith(`Renglón ${x.indice + 1}:`)).map((e) => e.replace(/^Renglón \d+: /, '')).join(' ') : '';
      if (celda) celda.textContent = !x || mal ? '—' : x.vacio ? '' : W.mxn(x.costo);
    });
  }

  function renderComparacion(R) {
    const cont = $('#cg-comparacion');
    if (!cont) return;
    const T = E().res.totales;
    const filas = R.categorias.filter((c) => c.cotizado > 0.005 || c.real > 0.005).map((c) => {
      const avance = c.cotizado > 0 ? c.real / c.cotizado : (c.real > 0 ? Infinity : 0);
      const barra = h('div', { class: `cg-avance${avance > 1.0005 ? ' cg-avance-pasa' : ''}`, role: 'img', 'aria-label': Number.isFinite(avance) ? `${W.num(avance * 100, 0)} % de lo cotizado` : 'sin cotizado' },
        h('span', { style: `width:${Math.min(100, Number.isFinite(avance) ? avance * 100 : 100).toFixed(1)}%` }));
      const dif = c.diferencia;
      return [
        h('div', null, corta(c.clave)), W.mxn(c.cotizado), W.mxn(c.real),
        h('span', { class: Math.abs(dif) < 0.005 ? '' : dif > 0 ? 'cg-mas' : 'cg-menos' }, Math.abs(dif) < 0.005 ? '—' : `${dif > 0 ? '+' : '−'}${W.mxn(Math.abs(dif))}`),
        h('div', { class: 'cg-avance-celda' }, barra, h('span', null, Number.isFinite(avance) ? `${W.num(avance * 100, 0)} %` : 'no cotizado')),
      ];
    });
    const tot = R.totales;
    filas.push({ clase: 'total', celdas: ['Total', W.mxn(tot.cotizado), W.mxn(tot.real), `${tot.diferencia > 0 ? '+' : tot.diferencia < 0 ? '−' : ''}${W.mxn(Math.abs(tot.diferencia))}`, `${W.num(tot.avance_pct * 100, 0)} %`] });
    const Rs = R.resultado;
    const estimados = Rs.equipo_estimado + Rs.indirectos_estimados + Rs.comision_y_otros;
    const nEst = gastos().filter((g) => g.estimado).length;
    W.reemplazar(cont,
      h('h4', { class: 'cg-sub' }, 'Real contra cotizado (sin IVA)'),
      W.tabla([{ t: 'Categoría' }, { t: 'Cotizado', num: true }, { t: 'Real', num: true }, { t: 'Diferencia', num: true }, { t: 'Gastado' }], filas),
      Rs.equipo_estimado > 0.005 ? h('p', { class: 'nota' }, W.icono('info'), `Lo cotizado no incluye ${W.mxn(Rs.equipo_estimado)} de equipo del taller (hora-máquina: depreciación, energía y mantenimiento): no llega con ticket y se descuenta abajo como estimado.`) : null,
      nEst ? h('p', { class: 'nota nota-adv' }, W.icono('aviso'), `${nEst} ${nEst === 1 ? 'renglón sigue' : 'renglones siguen'} con el precio cotizado (marcados «estimado»): cámbielos por lo que dice el ticket.`) : null,
      R.errores.length ? h('ul', { class: 'avisos' }, R.errores.slice(0, 6).map((e) => h('li', null, W.icono('aviso'), h('span', null, e)))) : null,
      h('h4', { class: 'cg-sub' }, 'Resultado del proyecto'),
      h('div', { class: 'tiles' },
        W.tile(Rs.venta_es_pactada ? 'Venta pactada' : 'Venta (precio calculado)', W.mxn(Rs.venta), Rs.venta_es_pactada && T.venta && T.venta.con_iva ? `sin IVA · ${W.mxn(T.venta.capturada)} con IVA` : 'sin IVA'),
        W.tile('Gastos reales', W.mxn(tot.real), `${tot.n_gastos} ${tot.n_gastos === 1 ? 'gasto' : 'gastos'} sin el IVA acreditable`),
        W.tile('Utilidad antes de indirectos', W.mxn(Rs.utilidad_antes_indirectos), `${W.num(Rs.margen_antes_indirectos_pct * 100, 1)} % · venta − gastos`, Rs.utilidad_antes_indirectos < 0 ? 'tile-adv' : ''),
        W.tile('Equipo, indirectos y comisión', W.mxn(estimados), 'estimados por la cotización (no se capturan)'),
        W.tile('Utilidad después de indirectos', W.mxn(Rs.utilidad_despues_indirectos), `${W.num(Rs.margen_despues_indirectos_pct * 100, 1)} % de la venta`, Rs.utilidad_despues_indirectos < 0 ? 'tile-adv' : 'tile-principal'),
        W.tile('IVA acreditable', W.mxn(tot.iva_acreditable), 'de las compras con factura')),
      h('p', { class: 'nota' }, W.icono('info'), `Utilidad después de indirectos = venta × (1 − comisión y otros) − gastos reales − equipo (${W.mxn(Rs.equipo_estimado)}) − indirectos, imprevistos y financiamiento (${W.mxn(Rs.indirectos_estimados)}). Los indirectos son los de las tablas maestras (${W.mxn(E().res.capas.gif_por_hora_mod)} por hora de taller y ${W.pct(E().res.capas.administracion_pct_cd, 0)} de administración): si aún son ilustrativos, este renglón también lo es.${T.venta ? '' : ' Sin venta pactada se usa el precio calculado.'}`));
  }

  function actualizarGastos() {
    const R = G.resumen(E().res, gastos(), ivaCompras());
    actualizarCifras(R);
    renderComparacion(R);
  }

  function nuevoGasto(extra) {
    return {
      id: idNuevo(), fecha: hoy(), concepto: '', categoria: 'MATERIAL', cantidad: 1, precio_unitario: '', iva_incluido: true, con_factura: true, ...extra,
    };
  }

  function agregar() {
    gastos().push(nuevoGasto());
    W.persistir();
    renderCaptura();
    actualizarGastos();
    const filas = $$('#cg-captura tr[data-id]');
    const ult = filas[filas.length - 1];
    if (ult) $('.cg-in-concepto', ult).focus();
  }

  function quitar(id) {
    const gs = gastos();
    const i = gs.findIndex((g) => g.id === id);
    if (i < 0) return;
    const [g] = gs.splice(i, 1);
    W.persistir();
    renderCaptura();
    actualizarGastos();
    W.toast('Gasto quitado', {
      texto: 'Deshacer',
      fn: () => {
        gastos().splice(Math.min(i, gastos().length), 0, g);
        W.persistir();
        renderCaptura();
        actualizarGastos();
      },
    });
  }

  function alEditar(ev) {
    const el = ev.target;
    const campo = el && el.dataset ? el.dataset.campo : null;
    if (!campo || campo === 'costo') return;
    // las casillas y las listas se toman al cambiar; lo que se teclea, mientras se teclea
    if (ev.type === 'input' && (el.type === 'checkbox' || el.tagName === 'SELECT')) return;
    if (ev.type === 'change' && !(el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date')) return;
    const tr = el.closest('tr[data-id]');
    const g = tr && gastos().find((x) => x.id === tr.dataset.id);
    if (!g) return;
    if (campo === 'iva_incluido' || campo === 'con_factura') g[campo] = el.checked;
    else if (campo === 'cantidad' || campo === 'precio_unitario') {
      g[campo] = el.value === '' || (el.validity && el.validity.badInput) ? '' : Number(el.value);
      if (g.estimado) {
        delete g.estimado; // ya es lo real
        tr.classList.remove('cg-estimado');
        const chip = $('.cg-chip-est', tr);
        if (chip) chip.remove();
      }
    } else if (campo === 'categoria') {
      const antes = g.categoria;
      g.categoria = el.value;
      // la raya no lleva IVA ni factura: al pasar de una compra a mano de obra (o al revés) la casilla de factura sigue a la categoría
      const sinF = G.SIN_FACTURA_POR_DEFECTO;
      if (sinF.includes(antes) !== sinF.includes(g.categoria)) {
        g.con_factura = !sinF.includes(g.categoria);
        if (sinF.includes(g.categoria)) g.iva_incluido = false;
        const fact = $('[data-campo="con_factura"]', tr);
        if (fact) fact.checked = g.con_factura;
        const iva = $('[data-campo="iva_incluido"]', tr);
        if (iva) iva.checked = g.iva_incluido;
      }
    } else g[campo] = el.value;
    W.persistir();
    actualizarGastos();
  }

  /**
   * Los gastos que espera la cotización, para capturar encima lo real: cada compra de la lista (en piezas enteras, al precio
   * cotizado sin IVA), la soldadura, la mano de obra del taller, la cuadrilla y los viáticos de cada instalación (con IVA, como
   * se capturaron) y los subcontratos. Quedan marcados «estimado» hasta que se cambia su cantidad o su precio.
   */
  function gastosEsperados() {
    const R = E().res;
    const L = R.compras;
    const out = [];
    const est = (concepto, categoria, cantidad, precio, iva, factura) => {
      if (!(cantidad > 0 && precio > 0)) return;
      out.push(nuevoGasto({ fecha: '', concepto, categoria, cantidad: red(cantidad, 3), precio_unitario: red(precio, 2), iva_incluido: iva, con_factura: factura, estimado: true }));
    };
    L.renglones.forEach((r) => est(`${r.descripcion}${r.medida ? ` (${r.medida})` : ''}`, r.categoria, r.compra, r.unitario_sin_iva, false, true));
    L.soldadura.forEach((s) => est('Soldadura: alambre y gas', 'CONSUMIBLE', 1, s.costo, false, true));
    const ok = R.partidas.filter((f) => f.ok);
    const taller = ok.filter((f) => f.familia !== 'INSTALACION' && f.costos.h_MOD > 0);
    const h_ = taller.reduce((s, f) => s + f.costos.h_MOD, 0);
    const mo = taller.reduce((s, f) => s + f.costos.subtotales.mano_obra, 0);
    if (h_ > 0) est('Mano de obra del taller', 'MANO_OBRA', h_, mo / h_, false, false);
    ok.filter((f) => f.familia === 'INSTALACION').forEach((f) => {
      const e = f.entrada;
      const n = e.cantidad;
      const I = f.instalacion;
      est(`Mano de obra: ${f.descripcion}`, 'INSTALACION', I.horas, I.tarifa.mo_h, false, false);
      // los viáticos se capturaron con IVA (como el ticket); con factura el IVA se acredita
      est('Casetas', 'VIATICOS', n * (e.viajes || 0), e.casetas_viaje || 0, true, I.gastos_con_factura);
      est('Gasolina', 'VIATICOS', n * (e.viajes || 0), e.gasolina_viaje || 0, true, I.gastos_con_factura);
      est('Hospedaje', 'VIATICOS', n * e.personas * (e.noches || 0), e.hospedaje_noche || 0, true, I.gastos_con_factura);
      est('Comidas', 'VIATICOS', n * e.personas * e.dias, e.comida_dia || 0, true, I.comidas_con_factura);
      est('Otros gastos de obra', 'VIATICOS', n, e.otros_gastos || 0, true, I.gastos_con_factura);
    });
    ok.forEach((f) => Object.keys(f.costos.subcontratos || {}).forEach((k) => est(`Subcontrato: ${k}`, 'PROVEEDOR', 1, f.costos.subcontratos[k], false, true)));
    return out;
  }

  function desdeLista() {
    const nuevos = gastosEsperados();
    if (!nuevos.length) { W.toast('La cotización no tiene compras ni mano de obra que pasar a gastos'); return; }
    const c = E().cot;
    const antes = gastos().slice();
    c.gastos = [...antes.filter((g) => !g.estimado), ...nuevos]; // se renuevan los estimados; lo real se queda
    W.persistir();
    renderCaptura();
    actualizarGastos();
    W.toast(`${nuevos.length} renglones estimados: cambie cada precio por el del ticket`, {
      texto: 'Deshacer',
      fn: () => {
        E().cot.gastos = antes;
        W.persistir();
        renderCaptura();
        actualizarGastos();
      },
    });
  }

  function csvGastos() {
    const R = G.resumen(E().res, gastos(), ivaCompras());
    const filas = [['Fecha', 'Concepto', 'Categoría', 'Cantidad', 'Precio unitario', 'Trae IVA', 'Factura', 'Importe', 'Costo sin IVA', 'IVA acreditable']];
    R.gastos.filter((g) => !g.vacio).forEach((g) => filas.push([g.fecha, g.concepto, corta(g.categoria), g.cantidad, g.precio_unitario, g.iva_incluido ? 'Sí' : 'No', g.con_factura ? 'Sí' : 'No',
      red(g.importe), red(g.costo), red(g.iva_acreditable)]));
    filas.push(['', 'Total', '', '', '', '', '', '', red(R.totales.real), red(R.totales.iva_acreditable)]);
    return W.csv(filas);
  }

  /** Abre el proyecto de ejemplo (el de la hoja de control de gastos) en lugar de la cotización actual; se puede deshacer. */
  function verEjemplo() {
    W.abrirCotizacion(C.ejemplos.casoControlGastos(), 'Ejemplo abierto: un proyecto vendido en $45,710 con IVA y sus gastos reales');
  }

  /* ================================================================== */
  /* Entrada: venta pactada y piezas enteras                            */
  /* ================================================================== */
  function sincronizarVenta() {
    const conIva = E().cot.venta_pactada_con_iva === true;
    const chk = $('#cg_venta_con_iva');
    if (chk && document.activeElement !== chk) chk.checked = conIva;
    const suf = $('#cg_venta_sufijo');
    if (suf) suf.textContent = conIva ? 'MXN con IVA' : 'MXN sin IVA';
    const el = $('#cg_venta_pactada');
    if (!el || document.activeElement === el) return;
    const v = E().cot.venta_pactada;
    el.value = v === undefined ? '' : String(v);
    el.removeAttribute('aria-invalid');
    $('#cg-venta-campo').classList.remove('invalido');
  }

  function editarVenta() {
    const el = $('#cg_venta_pactada');
    const crudo = el.value.trim();
    const c = E().cot;
    const campo = $('#cg-venta-campo');
    if (crudo === '') delete c.venta_pactada;
    else {
      const n = Number(crudo);
      const valido = Number.isFinite(n) && n >= 0 && n <= 1e10 && !(el.validity && el.validity.badInput);
      campo.classList.toggle('invalido', !valido);
      el.setAttribute('aria-invalid', String(!valido));
      if (!valido) return;
      c.venta_pactada = n;
    }
    campo.classList.remove('invalido');
    el.removeAttribute('aria-invalid');
    W.persistir();
    W.render();
  }

  let enlazado = false;
  function enlazar() {
    if (enlazado) return;
    enlazado = true;
    $('#cg_venta_pactada').addEventListener('input', editarVenta);
    $('#cg_venta_pactada').addEventListener('blur', sincronizarVenta);
    $('#cg_venta_con_iva').addEventListener('change', (ev) => {
      if (ev.target.checked) E().cot.venta_pactada_con_iva = true; else delete E().cot.venta_pactada_con_iva;
      W.persistir();
      W.render();
    });
    $('#cg-copiar-lista').addEventListener('click', () => W.copiarTexto(csvLista(), 'Lista de compras copiada (CSV)'));
    $('#cg-a-gastos').addEventListener('click', () => desdeLista());
    $('#cg-agregar').addEventListener('click', agregar);
    $('#cg-copiar-gastos').addEventListener('click', () => W.copiarTexto(csvGastos(), 'Gastos copiados (CSV)'));
    const cap = $('#cg-captura');
    cap.addEventListener('input', alEditar);
    cap.addEventListener('change', alEditar);
    cap.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-quitar]');
      if (b) quitar(b.dataset.quitar);
    });
  }

  /** Se llama en cada recálculo de la cotización (W.render): la captura sólo se redibuja si cambió la lista de gastos. */
  function render() {
    if (!$('#panel-compras')) return;
    enlazar();
    sincronizarVenta();
    renderVenta();
    renderLista();
    const firma = gastos().map((g) => g.id).join('|');
    if (firma !== firmaCaptura) renderCaptura();
    actualizarGastos();
  }

  W.comprasUI = { render, gastosEsperados, csvLista, csvGastos };
}(typeof self !== 'undefined' ? self : this));
