/**
 * COTIZAP · web/planos_ui.js — Pestaña «Planos»: las piezas de la cotización dibujadas y acotadas como en los planos de pedido.
 *
 * Una hoja por tipo de pieza (bridas, codos, reducciones con injerto…) y, en las de lámina, por material y calibre (los ductos
 * rectos, además, por diámetro, como los planos de yardas), como las hojas que el taller manda a fabricar: cada pieza con su
 * dibujo, su nombre, sus datos, cuántas piezas son y una marca (C1, C2…) para hablar de ella con el proveedor; al final, la
 * hoja de armado de piezas. Arriba, el cuadre de bridas: las que piden las piezas contra las partidas de bridas, por diámetro.
 * Las hojas se imprimen solas (cada una en su página, horizontal) con «Imprimir planos».
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

  /** Las yardas que lleva una hoja de ductos rectos: «18 yardas y 1 tramo de ajuste». */
  function yardasDe(items) {
    let y = 0;
    let a = 0;
    items.forEach((x) => {
      const arm = x.f.geometria && x.f.geometria.detalle && x.f.geometria.detalle.armado;
      if (!arm) return;
      y += arm.n_completas * x.p.cantidad;
      a += (arm.ajuste_mm > 0 ? 1 : 0) * x.p.cantidad;
    });
    return y || a ? `${W.num(y, 0)} ${y === 1 ? 'yarda' : 'yardas'}${a ? ` y ${W.num(a, 0)} ${a === 1 ? 'tramo' : 'tramos'} de ajuste` : ''}` : '';
  }

  const piezas = (n) => `${W.num(n, 0)} ${n === 1 ? 'pieza' : 'piezas'}`;
  const sinParentesis = (t) => String(t || '').split(' (')[0];

  function fechaLarga(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /**
   * Las partidas que se dibujan, repartidas en hojas con sus marcas; y cuántas no tienen plano (instalación, compras sin
   * barrenos, errores). El reparto y las marcas son los de la lista de fabricación (motor/lista_fabricacion.js).
   */
  function hojas() {
    const { cot, res } = E();
    return C.listaFabricacion.agrupar(cot, res, res.maestros, W.resumenMaterial);
  }

  function tarjeta(x) {
    const { p, d } = x;
    // el armado se llama como lo escribió quien lo pide («Unir injerto de 11″ con codo de 60° para obtener 90°»); el ducto
    // recto, por sus yardas (la hoja ya dice el diámetro)
    const titulo = (p.familia === 'UNION' && p.descripcion) || d.titulo_corto || C.planos.titulo(p) || sinParentesis(d.titulo || W.tituloPartida(p));
    const propia = p.descripcion && p.descripcion !== titulo ? p.descripcion : '';
    return h('article', { class: 'pieza-plano', dataset: { id: p.id, familia: p.familia } },
      h('div', { class: 'pieza-cab' },
        h('span', { class: 'pieza-marca', title: 'Marca de la pieza' }, x.marca),
        h('span', { class: 'pieza-cant' }, piezas(p.cantidad))),
      h('figure', { class: 'pieza-fig' }, W.svgArbol(C.planos.arbol(d, { px: 300, alto_max: 230 }))),
      h('h4', { class: 'pieza-tit' }, titulo),
      propia ? h('p', { class: 'pieza-desc' }, propia) : null,
      h('ul', { class: 'plano-datos' }, d.datos.filter((t) => t && t.toLowerCase() !== titulo.toLowerCase()).map((t) => h('li', null, t))),
      h('button', { type: 'button', class: 'btn-texto pieza-ir', onclick: () => W.verPartida(p.id) }, 'Ver en la cotización'));
  }

  function hoja(hj, i, n) {
    const cot = E().cot;
    const total = hj.items.reduce((s, x) => s + (Number(x.p.cantidad) || 0), 0);
    return h('section', { class: 'hoja', dataset: { grupo: hj.g.id }, 'aria-label': `${hj.g.nombre(hj.items)}${hj.material ? ` · ${hj.material}` : ''}` },
      h('header', { class: 'hoja-cab' },
        h('h3', null, hj.g.nombre(hj.items), hj.material ? h('span', { class: 'hoja-mat' }, hj.material) : null),
        h('span', { class: 'hoja-cuenta' }, [`${piezas(total)} en ${hj.items.length} ${hj.items.length === 1 ? 'partida' : 'partidas'}`, hj.g.porMedida ? yardasDe(hj.items) : ''].filter(Boolean).join(' · '))),
      h('div', { class: 'hoja-piezas' }, hj.items.map(tarjeta)),
      h('footer', { class: 'hoja-pie' },
        h('span', null, h('span', { class: 'hoja-et' }, 'Proyecto '), cot.proyecto || '—'),
        cot.cliente ? h('span', null, h('span', { class: 'hoja-et' }, 'Cliente '), cot.cliente) : null,
        h('span', null, h('span', { class: 'hoja-et' }, 'Fecha '), fechaLarga(cot.fecha) || '—'),
        h('span', null, 'Medidas en mm'),
        h('span', { class: 'hoja-num' }, `Hoja ${i + 1} de ${n}`)));
  }

  /** La figura simple de un conjunto: sus dos piezas lado a lado, con su marca, y la junta de armado entre ellas. */
  function figuraConjunto(c) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, at, txt) => { const e = document.createElementNS(NS, tag); Object.keys(at).forEach((k) => e.setAttribute(k, at[k])); if (txt !== undefined) e.textContent = txt; return e; };
    const svg = el('svg', { viewBox: '0 0 260 120', class: 'conj-fig', role: 'img', 'aria-label': `Conjunto ${c.marca}: ${c.piezas.map((x) => x.marca).join(' con ')}, junta ${c.junta}` });
    c.piezas.forEach((x, i) => {
      const bx = 30 + i * 100;
      svg.append(el('rect', { x: bx, y: 34, width: 100, height: 52, rx: 6 }));
      svg.append(el('text', { x: bx + 50, y: 58, 'text-anchor': 'middle' }, x.marca));
      svg.append(el('text', { x: bx + 50, y: 74, 'text-anchor': 'middle', class: 'conj-txt' }, x.cara_texto));
    });
    svg.append(el('line', { x1: 130, y1: 24, x2: 130, y2: 96 }));
    svg.append(el('text', { x: 130, y: 16, 'text-anchor': 'middle' }, `junta ${c.junta}`));
    svg.append(el('text', { x: 130, y: 112, 'text-anchor': 'middle', class: 'conj-txt' }, 'sin brida en la cara que se une'));
    return svg;
  }

  function tarjetaConjunto(c) {
    return h('article', { class: 'conjunto-armado', dataset: { marca: c.marca, armado: c.id } },
      h('div', { class: 'pieza-cab' },
        h('span', { class: 'pieza-marca', title: 'Marca del conjunto armado' }, c.marca),
        h('span', { class: 'pieza-cant' }, `${W.num(c.cantidad, 0)} ${c.cantidad === 1 ? 'conjunto' : 'conjuntos'}`)),
      h('figure', { class: 'pieza-fig' }, figuraConjunto(c)),
      h('div', null,
        h('h4', { class: 'pieza-tit' }, c.titulo),
        h('ul', { class: 'plano-datos' },
          c.piezas.map((x) => h('li', null, `${x.marca} · ${x.titulo}: ${x.cara_texto} (sin brida)`)),
          c.angulo_deg !== undefined && c.angulo_deg !== null ? h('li', null, c.pareja === 'a' ? `Ángulo resultante ${W.num(c.angulo_deg, 0)}°${c.es_90 ? ' (el ramal sale a 90°)' : ''}` : `Giro del codo ${W.num(c.angulo_deg, 0)}°`) : null,
          h('li', null, `Conjunto de hasta ${W.num(c.dim_mm, 0)} mm${c.limite_mm ? ` (máximo ${W.num(c.limite_mm, 0)} mm)` : ''}`)),
        h('p', { class: 'nota nota-armado' }, W.icono('info'), c.nota)));
  }

  /** Los conjuntos armados en taller (E1, E2…), después de las hojas; sus piezas llevan las marcas de las hojas. */
  function conjuntos(R) {
    const piezas = R.hojas.flatMap((hj) => hj.items.map((x) => ({ id: x.p.id, marca: x.marca, titulo: x.d.titulo_corto || C.planos.titulo(x.p) || sinParentesis(x.d.titulo || W.tituloPartida(x.p)) })));
    const lista = C.listaFabricacion.conjuntosDe(E().res, piezas);
    if (!lista.length) return null;
    return h('section', { class: 'conjuntos-armados', 'aria-labelledby': 'conj-tit' },
      h('h3', { id: 'conj-tit' }, 'Conjuntos armados en taller'),
      h('p', { class: 'nota' }, 'Cada conjunto se arma en taller: las dos piezas se unen con una junta de armado y no llevan brida en la cara que se junta.'),
      lista.map(tarjetaConjunto));
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
    W.reemplazar(cont, cuadre(), R.hojas.map((hj, i) => hoja(hj, i, R.hojas.length)), conjuntos(R));
  }

  /**
   * El cuadre de bridas: por diámetro, las que piden las piezas cuyas bridas son de otra partida contra las que hay en las
   * partidas de bridas (de solera y de placa). Sólo aparece si alguna pieza pide bridas de otra partida.
   */
  function cuadre() {
    const B = E().res.bridas;
    if (!B || !B.activo) return null;
    const f = C.planos.formato;
    const nombre = (x) => (x.forma === 'REDONDA' ? f.diam(x.D_nom_mm) : `${f.mm(x.a_nom_mm)} × ${f.mm(x.b_nom_mm)} mm`);
    const estado = (x) => (x.diferencia === 0 ? h('span', { class: 'cuadran' }, 'Cuadran')
      : x.diferencia < 0 ? h('span', { class: 'faltan' }, `Faltan ${-x.diferencia}`) : h('span', { class: 'sobran' }, `Sobran ${x.diferencia}`));
    const faltan = B.filas.filter((x) => x.diferencia < 0);
    const sobran = B.filas.filter((x) => x.diferencia > 0);
    const resumen = B.cuadra ? `Las ${W.num(B.piden, 0)} bridas que piden las piezas están en las partidas de bridas.`
      : [faltan.length ? `Faltan ${faltan.map((x) => `${-x.diferencia} de ${nombre(x)}`).join(', ')}` : '', sobran.length ? `sobran ${sobran.map((x) => `${x.diferencia} de ${nombre(x)}`).join(', ')}` : '']
        .filter(Boolean).join(' y ').replace(/^s/, 'S') + '. Revise las partidas de bridas (o los extremos sin brida de las piezas).';
    return h('section', { class: 'cuadre', 'aria-labelledby': 'cuadre-tit', dataset: { cuadra: B.cuadra ? 'si' : 'no' } },
      h('h3', { id: 'cuadre-tit' }, W.icono(B.cuadra ? 'check' : 'aviso'), 'Cuadre de bridas'),
      h('p', null, `Las piezas con «bridas de otra partida» piden una brida en cada extremo que la lleva (de taller o suelta); aquí se comparan, por diámetro, con las partidas de Bridas sueltas y las bridas de placa compradas. ${resumen}`),
      W.tabla([{ t: 'Ducto' }, { t: 'Piden las piezas', num: true }, { t: 'En partidas de bridas', num: true }, { t: '' }],
        B.filas.map((x) => [nombre(x), W.num(x.piden, 0), W.num(x.hay, 0), estado(x)])));
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
