/**
 * COTIZAP · web/armados_ui.js — Conjuntos armados en taller en la cotización detallada.
 *
 * El botón «Sugerir armados» abre un diálogo con las parejas que ahorran bridas (motor/armados.js), cada una con su ahorro y su
 * «Armar»; «Armar todas» las acepta de una vez. Las piezas armadas llevan un chip «Armada con …» con «Deshacer armado», la
 * junta de armado sale en la lista como partida automática y el detalle de la pieza dice qué cara va armada. Nada se arma solo:
 * cada armado lo acepta el usuario. Depende de app.js (W.estadoApp, W.recalcular, W.toast, W.tituloPartida).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);

  const E = () => W.estadoApp;
  const ARM = () => C.armados;
  const NOMBRE_CARA = () => ARM().NOMBRE_CARA;
  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const mm = (x) => `${W.num(Math.round(x), 0)} mm`;

  /** Los conjuntos calculados (res.armados) que usan la partida: [{ c, q, otra }], con la otra partida del par. */
  function conjuntosDe(id) {
    const est = E();
    if (!est || !est.res) return [];
    return (est.res.armados || []).map((c) => {
      const q = c.piezas.find((x) => x.partida === id);
      if (!q) return null;
      const o = c.piezas.find((x) => x !== q);
      return { c, q, otra: est.cot.partidas.find((p) => p.id === (o && o.partida)) || null, cara_otra: o && o.cara };
    }).filter(Boolean);
  }

  function deshacer(id) {
    const est = E();
    const r = ARM().deshacerArmado(est.cot, id);
    if (!r.ok) return;
    if (!(est.cot.armados || []).length) delete est.cot.armados;
    W.recalcular();
    W.toast(r.juntadas ? 'Armado deshecho · las partidas partidas se volvieron a juntar' : 'Armado deshecho');
  }

  /** Los chips de una partida armada: «Armada con …» y «Deshacer armado» (o el aviso de que el armado ya no es válido). */
  function chipsDe(p) {
    return conjuntosDe(p.id).flatMap(({ c, otra }) => {
      const boton = h('button', {
        type: 'button', class: 'btn-texto chip-deshacer', dataset: { deshacer: c.id },
        onclick: (e) => { e.stopPropagation(); deshacer(c.id); },
        onkeydown: (e) => e.stopPropagation(),
      }, 'Deshacer armado');
      if (!c.ok) {
        return [h('span', { class: 'chip chip-adv chip-armado', dataset: { armado: c.id }, title: c.errores.join('\n') }, W.icono('aviso'), `Armado ${c.marca} no válido`), boton];
      }
      const con = otra ? W.tituloPartida(otra) : '…';
      return [h('span', { class: 'chip chip-auto chip-armado', dataset: { armado: c.id }, title: `Conjunto ${c.marca}: ${c.descripcion}` }, W.icono('check'), `Armada con ${con}`, ` · ${c.marca}`), boton];
    });
  }

  /** La nota del detalle de una pieza armada: qué cara va armada y con qué. */
  function notasDetalle(p) {
    const lista = conjuntosDe(p.id).filter((x) => x.c.ok);
    if (!lista.length) return null;
    return h('div', { class: 'notas-armado' }, lista.map(({ c, q, otra }) => h('p', { class: 'nota nota-armado' }, W.icono('info'),
      `Esta cara va armada con ${otra ? W.tituloPartida(otra) : 'otra pieza'} (sin brida): ${NOMBRE_CARA()[q.cara]}. Conjunto ${c.marca} de ${c.n} ${c.n === 1 ? 'pieza' : 'piezas'}, con su junta de armado.`)));
  }

  /** La junta de armado derivada (partida UNION): sale en la lista como partida automática, con su costo. */
  function filaUnion(f) {
    const c = (E().res.armados || []).find((x) => x.id === f.entrada.armado_id);
    return h('li', { class: 'partida partida-auto', dataset: { auto: 'UNION', armado: f.entrada.armado_id } },
      h('div', { class: 'partida-main' },
        W.iconoFamilia('UNION'),
        h('div', { class: 'partida-txt' },
          h('div', { class: 'partida-titulo' }, f.descripcion),
          h('div', { class: 'partida-meta' }, f.ok
            ? `Costo ${W.mxn(f.costos.CD)} sin IVA · partida automática: la junta de armado (${f.geometria.costura === 'ENGARGOLADA' ? 'engargolada' : 'soldada'}) de los conjuntos aceptados; no se edita a mano`
            : `No se pudo calcular: ${(f.errores || []).join('; ')}`),
          h('div', { class: 'partida-chips' }, h('span', { class: 'chip chip-auto' }, W.icono('info'), 'Automática'), c ? h('span', { class: 'chip chip-auto chip-marca-armado' }, c.marca) : null))),
      h('div', { class: 'partida-der' },
        h('div', { class: 'partida-cifras' },
          h('div', { class: 'partida-cant' }, f.ok ? `1 × ${W.mxn(f.precio.unitario)}` : ''),
          h('div', { class: 'partida-importe' }, f.ok ? W.mxn(f.precio.importe) : '—')),
        h('div', { class: 'partida-acc' },
          h('button', { type: 'button', class: 'btn-texto', onclick: () => deshacer(f.entrada.armado_id) }, 'Deshacer armado'))));
  }

  /** Bajo los totales: cuánto ahorran los armados aceptados (con IVA, como el total). */
  function notaTotales(ahorro) {
    if (!(ahorro > 0.005)) return null;
    return h('p', { class: 'nota', dataset: { ahorroArmados: String(Math.round(ahorro * 100) / 100) } }, W.icono('info'),
      `Los armados en taller ahorran ${W.mxn(ahorro)} (con IVA) frente a cotizar todas las piezas con bridas en sus extremos.`);
  }

  /* ---------------- El diálogo de sugerencias ---------------- */

  let sugerencias = [];

  function calcularSugerencias() {
    const est = E();
    try { sugerencias = ARM().sugerirArmados(W.entradaCotizacion(), est.res, est.M); } catch (e) { sugerencias = []; }
  }

  function heredarDe() {
    const est = E();
    return C.cotizador.crearHeredar(W.entradaCotizacion(), est.res.maestros).heredar;
  }

  /** Acepta una sugerencia: parte las partidas que haga falta y agrega el armado. Devuelve el resultado de `armar`. */
  function armarUna(s) {
    const est = E();
    return ARM().armar(est.cot, s.piezas, s.n, est.res.maestros, { nuevoId: W.idNuevo, heredar: heredarDe() });
  }

  const dinero = (x) => W.mxn(x);

  /** Vista previa pequeña del conjunto ya unido (planos.js), con las partidas tal como están antes de armarlas; null si no se puede dibujar. */
  function vistaPrevia(s) {
    try {
      const est = E();
      const f = s.piezas.map((q) => est.res.partidas[est.cot.partidas.findIndex((p) => p.id === q.partida)]);
      const d = C.planos.planoConjunto(f[0], s.piezas[0].cara, f[1], s.piezas[1].cara, est.res.maestros, { junta: s.junta });
      if (!d) return null;
      return h('figure', { class: 'arm-sug-fig', title: `Así queda el conjunto: ${s.descripcion}` }, W.svgArbol(C.planos.arbol(d, { px: 150, alto_max: 104, compacto: true })));
    } catch (e) { return null; }
  }

  /** Qué bridas de otras partidas se ahorran («Se ahorran 4 bridas de 11″ de la partida de bridas…»); null si el armado no las libera. */
  function textoBridas(s) {
    const util = (s.bridas || []).filter((b) => b.consumidas > 0);
    if (!util.length) return null;
    const por = util.map((b) => `${b.consumidas} ${b.consumidas === 1 ? 'brida' : 'bridas'} de ${ARM().textoD(b.D_nom_mm)}`).join(' y ');
    return h('p', { class: 'arm-sug-bridas nota' }, `Se ahorran ${por}, que se descuentan de las partidas de bridas.`);
  }

  function tarjetaSugerencia(s, i) {
    const d = s.desglose;
    const partes = [
      s.pareja === 'a' && s.angulo_deg !== undefined ? `Ángulo resultante ${W.num(s.angulo_deg, 0)}°${s.es_90 ? ' (el ramal sale a 90°)' : ''}` : (s.angulo_deg !== undefined ? `Gira ${W.num(s.angulo_deg, 0)}°` : ''),
      `Conjunto de ${mm(s.dim_mm)} (máximo ${mm(s.limite_mm)})`,
      `Junta ${s.junta}`,
      `${s.n} ${s.n === 1 ? 'conjunto' : 'conjuntos'}`,
    ].filter(Boolean);
    return h('article', { class: 'arm-sug', dataset: { sug: String(i), pareja: s.pareja } },
      vistaPrevia(s),
      h('div', { class: 'arm-sug-txt' },
        h('h3', null, mayuscula(s.descripcion)),
        h('p', { class: 'arm-sug-meta' }, partes.join(' · ')),
        h('p', { class: 'arm-sug-desglose' }, `Del costo directo se ahorra: aros ${dinero(d.aros)} · tornillos ${dinero(d.tornillos)} · juntas ${dinero(d.juntas)} · mano de obra ${dinero(d.mano_obra)}${Math.abs(d.otros) >= 0.005 ? ` · otros ${dinero(d.otros)}` : ''}${Math.abs(d.bridas_otra_partida) >= 0.005 ? ` · bridas de otra partida ${dinero(d.bridas_otra_partida)}` : ''}.`),
        textoBridas(s)),
      h('div', { class: 'arm-sug-der' },
        h('div', { class: 'arm-sug-ahorro', dataset: { ahorro: String(s.ahorro) } }, dinero(s.ahorro)),
        h('div', { class: 'arm-sug-et' }, 'de ahorro, sin IVA'),
        h('button', { type: 'button', class: 'btn btn-primario', dataset: { armar: String(i) }, onclick: () => aceptar(s) }, 'Armar')));
  }

  function pintar() {
    const lista = $('#arm-lista');
    const est = E();
    const limite = est.res.maestros.proceso.conjuntos_armados ? est.res.maestros.proceso.conjuntos_armados.dim_max_mm : 3660;
    $('#arm-ayuda').textContent = `Dos piezas que se unen en taller no llevan brida en las caras que se juntan: llevan una junta de armado (soldada en acero al carbón, engargolada en galvanizado). Estas son las parejas que ahorran; usted acepta cada una. Un conjunto no puede medir más de ${mm(limite)} (política editable en Tablas maestras › Proceso).`;
    W.reemplazar(lista, sugerencias.length ? sugerencias.map(tarjetaSugerencia)
      : h('p', { class: 'vacio-tit' }, 'No hay armados que ahorren'),
    sugerencias.length ? null : h('p', { class: 'io-ayuda' }, 'Se arman injerto (o reducción con injerto) con un codo que lo deje a 90°, tramo recto con codo, y reducción con codo, tramo recto o injerto del mismo diámetro. Hacen falta dos piezas con bridas, del mismo diámetro, material y calibre, y que el conjunto quepa en el límite.'));
    $('#arm-todas').disabled = sugerencias.length < 1;
    $('#arm-todas').textContent = sugerencias.length > 1 ? `Armar todas (${sugerencias.length})` : 'Armar todas';
  }

  function aceptar(s) {
    const r = armarUna(s);
    if (!r.ok) { W.toast(`No se pudo armar: ${r.errores[0]}`); calcularSugerencias(); pintar(); return; }
    W.recalcular();
    const marca = `E${(E().cot.armados || []).length}`;
    calcularSugerencias();
    pintar();
    W.toast(`Armado ${marca} aceptado: ${s.descripcion}. Ahorro de ${dinero(s.ahorro)} sin IVA.`);
  }

  function aceptarTodas() {
    const lote = sugerencias.slice();
    let hechas = 0;
    let ahorro = 0;
    lote.forEach((s) => {
      const r = armarUna(s);
      if (r.ok) { hechas += 1; ahorro += s.ahorro; }
    });
    W.recalcular();
    calcularSugerencias();
    pintar();
    W.toast(hechas ? `${hechas} ${hechas === 1 ? 'armado aceptado' : 'armados aceptados'}: ahorro de ${dinero(ahorro)} sin IVA.` : 'No se pudo armar ninguna sugerencia.');
  }

  function abrir() {
    const dlg = $('#dlg-armados');
    calcularSugerencias();
    pintar();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function iniciar() {
    const dlg = $('#dlg-armados');
    if (!dlg) return;
    $('#btn-sugerir-armados').addEventListener('click', abrir);
    $('#arm-cerrar').addEventListener('click', () => dlg.close());
    $('#arm-cerrar2').addEventListener('click', () => dlg.close());
    $('#arm-todas').addEventListener('click', aceptarTodas);
  }

  W.armadosUI = {
    chipsDe, notasDetalle, filaUnion, notaTotales, abrir, deshacer, sugerencias: () => sugerencias,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
