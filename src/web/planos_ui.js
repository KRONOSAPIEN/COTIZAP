/**
 * COTIZAP · web/planos_ui.js — Pestaña «Planos»: las piezas de la cotización dibujadas y acotadas como en los planos de pedido.
 *
 * Una hoja por tipo de pieza (bridas, codos, reducciones con injerto…) y, en las de lámina, por material y calibre, como las
 * hojas que el taller manda a fabricar: cada pieza con su dibujo, su nombre, sus datos, cuántas piezas son y una marca (C1, C2…)
 * para hablar de ella con el proveedor. Las hojas se imprimen solas (cada una en su página, horizontal) con «Imprimir planos».
 * Sólo se dibuja mientras la pestaña está abierta. Depende de app.js (W.estadoApp, W.tituloPartida, W.verPartida…).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);

  const E = () => W.estadoApp;
  const SOLO_COPIAR = !!root.COTIZAP_ENTORNO_ARTIFACT; // en un visor restringido no se puede imprimir

  /** Las hojas, en el orden de los planos de pedido (bridas, codos, reducciones con injerto) y luego lo demás. */
  const GRUPOS = [
    { id: 'BRIDAS', fams: ['BRIDA', 'COMPRADO'], marca: 'B', nombre: () => 'Bridas' },
    { id: 'CODOS', fams: ['CODO'], marca: 'C', lamina: true, nombre: () => 'Codos' },
    {
      id: 'INJERTOS', fams: ['REDUCCION_INJERTO', 'RAMAL'], marca: 'I', lamina: true,
      nombre: (ps) => (ps.some((x) => x.p.familia === 'REDUCCION_INJERTO') ? (ps.some((x) => x.p.familia === 'RAMAL') ? 'Reducciones con injerto e injertos' : 'Reducciones con injerto') : 'Injertos'),
    },
    { id: 'REDUCCIONES', fams: ['REDUCCION'], marca: 'R', lamina: true, nombre: () => 'Reducciones' },
    { id: 'TRANSICIONES', fams: ['TRANSICION'], marca: 'T', lamina: true, nombre: () => 'Transiciones' },
    { id: 'RECTOS', fams: ['RECTO'], marca: 'D', lamina: true, nombre: () => 'Tramos rectos' },
    { id: 'SOPORTERIA', fams: ['SOPORTE'], marca: 'S', nombre: () => 'Soportería' },
  ];

  const piezas = (n) => `${W.num(n, 0)} ${n === 1 ? 'pieza' : 'piezas'}`;
  const sinParentesis = (t) => String(t || '').split(' (')[0];

  function fechaLarga(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Las partidas que se dibujan, repartidas en hojas; y cuántas no tienen plano (instalación, compras sin barrenos, errores). */
  function hojas() {
    const { cot, res } = E();
    const M = res.maestros;
    const dibujables = [];
    let sinPlano = 0;
    let conError = 0;
    cot.partidas.forEach((p, i) => {
      const f = res.partidas[i];
      if (!f || !f.ok) { conError += 1; return; }
      const d = C.planos.plano(f, M);
      if (!d) { sinPlano += 1; return; }
      dibujables.push({ p, f, d });
    });
    const out = [];
    GRUPOS.forEach((g) => {
      const del = dibujables.filter((x) => g.fams.includes(x.p.familia));
      if (!del.length) return;
      // las de lámina, una hoja por material y calibre (como «CODOS / ACERO GALVANIZADO CAL. 24»)
      const llaves = [];
      const por = new Map();
      del.forEach((x) => {
        const k = g.lamina ? (W.resumenMaterial(x.p) || '') : '';
        if (!por.has(k)) { por.set(k, []); llaves.push(k); }
        por.get(k).push(x);
      });
      llaves.forEach((k) => out.push({ g, material: k, items: por.get(k) }));
    });
    // marcas por tipo de pieza (B1, B2… C1, C2…), seguidas aunque el material parta la hoja
    const cuenta = {};
    out.forEach((hj) => hj.items.forEach((x) => { cuenta[hj.g.marca] = (cuenta[hj.g.marca] || 0) + 1; x.marca = `${hj.g.marca}${cuenta[hj.g.marca]}`; }));
    return { hojas: out, sinPlano, conError, n: dibujables.length };
  }

  function tarjeta(x) {
    const { p, d } = x;
    const titulo = C.planos.titulo(p) || sinParentesis(d.titulo || W.tituloPartida(p));
    const propia = p.descripcion && p.descripcion !== titulo ? p.descripcion : '';
    return h('article', { class: 'pieza-plano', dataset: { id: p.id, familia: p.familia } },
      h('div', { class: 'pieza-cab' },
        h('span', { class: 'pieza-marca', title: 'Marca de la pieza' }, x.marca),
        h('span', { class: 'pieza-cant' }, piezas(p.cantidad))),
      h('figure', { class: 'pieza-fig' }, W.svgArbol(C.planos.arbol(d, { px: 300, alto_max: 230 }))),
      h('h4', { class: 'pieza-tit' }, titulo),
      propia ? h('p', { class: 'pieza-desc' }, propia) : null,
      h('ul', { class: 'plano-datos' }, d.datos.filter(Boolean).map((t) => h('li', null, t))),
      h('button', { type: 'button', class: 'btn-texto pieza-ir', onclick: () => W.verPartida(p.id) }, 'Ver en la cotización'));
  }

  function hoja(hj, i, n) {
    const cot = E().cot;
    const total = hj.items.reduce((s, x) => s + (Number(x.p.cantidad) || 0), 0);
    return h('section', { class: 'hoja', dataset: { grupo: hj.g.id }, 'aria-label': `${hj.g.nombre(hj.items)}${hj.material ? ` · ${hj.material}` : ''}` },
      h('header', { class: 'hoja-cab' },
        h('h3', null, hj.g.nombre(hj.items), hj.material ? h('span', { class: 'hoja-mat' }, hj.material) : null),
        h('span', { class: 'hoja-cuenta' }, `${piezas(total)} en ${hj.items.length} ${hj.items.length === 1 ? 'partida' : 'partidas'}`)),
      h('div', { class: 'hoja-piezas' }, hj.items.map(tarjeta)),
      h('footer', { class: 'hoja-pie' },
        h('span', null, h('span', { class: 'hoja-et' }, 'Proyecto '), cot.proyecto || '—'),
        cot.cliente ? h('span', null, h('span', { class: 'hoja-et' }, 'Cliente '), cot.cliente) : null,
        h('span', null, h('span', { class: 'hoja-et' }, 'Fecha '), fechaLarga(cot.fecha) || '—'),
        h('span', null, 'Medidas en mm'),
        h('span', { class: 'hoja-num' }, `Hoja ${i + 1} de ${n}`)));
  }

  function render() {
    const cont = $('#planos-hojas');
    if (!cont || !E() || !E().res) return;
    const R = hojas();
    $('#btn-imprimir-planos').disabled = !R.n;
    const resumen = $('#planos-resumen');
    const notas = [
      R.sinPlano ? `${R.sinPlano} ${R.sinPlano === 1 ? 'partida no lleva plano' : 'partidas no llevan plano'} (instalación, compras sin barrenos o piezas personalizadas)` : '',
      R.conError ? `${R.conError} ${R.conError === 1 ? 'partida tiene' : 'partidas tienen'} errores y no se dibuja${R.conError === 1 ? '' : 'n'}: corríjala${R.conError === 1 ? '' : 's'} en la cotización` : '',
    ].filter(Boolean);
    const totalPiezas = R.hojas.reduce((s, hj) => s + hj.items.reduce((t, x) => t + (Number(x.p.cantidad) || 0), 0), 0);
    resumen.textContent = R.n ? [`${R.n} ${R.n === 1 ? 'partida dibujada' : 'partidas dibujadas'} (${piezas(totalPiezas)}) en ${R.hojas.length} ${R.hojas.length === 1 ? 'hoja' : 'hojas'}`, ...notas].join(' · ') + '.' : notas.join(' · ');
    resumen.hidden = !resumen.textContent;
    if (!R.n) {
      W.reemplazar(cont, h('div', { class: 'vacio' },
        h('p', { class: 'vacio-tit' }, 'Todavía no hay piezas que dibujar'),
        h('p', null, 'Los codos, reducciones, injertos, tramos rectos, transiciones, bridas y soportería de la cotización aparecen aquí dibujados y acotados, listos para mandar a fabricar.'),
        h('button', { type: 'button', class: 'btn btn-primario', onclick: verEjemplo }, 'Ver el ejemplo: pedido del 30-sep-2026')));
      return;
    }
    W.reemplazar(cont, R.hojas.map((hj, i) => hoja(hj, i, R.hojas.length)));
  }

  /** Abre el pedido de ductería del 30-sep-2026 (los planos que mandó el taller) en lugar de la cotización actual; se puede deshacer. */
  function verEjemplo() {
    W.abrirCotizacion(C.ejemplos.pedidoDucteria(), 'Ejemplo abierto: el pedido de ductería del 30-sep-2026, pieza por pieza');
  }

  function imprimir() {
    document.body.classList.add('imprimir-planos');
    const quitar = () => { document.body.classList.remove('imprimir-planos'); root.removeEventListener('afterprint', quitar); };
    root.addEventListener('afterprint', quitar);
    root.print();
    setTimeout(quitar, 0); // si el navegador no avisa al terminar
  }

  function iniciar() {
    $('#btn-imprimir-planos').addEventListener('click', imprimir);
    $('#planos-ejemplo').addEventListener('click', verEjemplo);
    if (SOLO_COPIAR) {
      $('#btn-imprimir-planos').hidden = true;
      $('#planos-sin-imprimir').hidden = false;
    }
  }

  W.planosUI = { render, hojas, verEjemplo };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
