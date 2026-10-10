/**
 * COTIZAP · web/trazado_iso_ui.js — La pestaña «Trazado isométrico»: el tablero jugable de docs/trazado-isometrico.md
 * (§1 flujo, §4 wireframe; etapa 2 de §5).
 *
 * Es otro apartado de COTIZAP: no reemplaza la cotización rápida ni la detallada, ni «Dibujar unifilar». Aquí se colocan los
 * equipos sobre el piso, se ponen sus tomas en las caras de su caja, se acoplan con manguera (con sus tiradores) o con brida,
 * y se arma la red con trazos que se ajustan solos a lo que el taller fabrica: codos, injertos y reducciones salen solos, el
 * imán propone cómo llegar al tronco o al colector, y lo que no se puede se dice con su porqué. La barra de fases cuenta lo
 * pendiente; el panel de problemas, la revisión de §2.11; la salida, el cálculo de pérdidas (balanceo y ventilador) y el JSON
 * del sistema (§3).
 *
 * Todo lo que el tablero decide está en web/trazado_tablero.js (probado en Node); aquí sólo se dibuja en SVG y se traducen
 * los gestos y las teclas. El trazo se guarda con la cotización (estado.cot.trazado_iso). Depende de app.js (W.estadoApp,
 * W.persistir, W.toast, W.copiarTexto) y de dom.js.
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);
  const TZ = () => C.trazadoIso;
  const TB = () => C.trazadoTablero;
  const UF = () => C.unifilar;
  const E = () => W.estadoApp;
  const M = () => E().M;
  const NS = 'http://www.w3.org/2000/svg';
  const IN = 25.4;
  const svg = (tag, attrs, ...hijos) => {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) el.setAttribute(k, attrs[k]); });
    hijos.forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  };
  const f1 = (x) => Number(x).toFixed(1);
  const n0 = (x) => W.num(Math.round(x) + 0, 0); // + 0: sin «-0»
  const pulg = (d) => `${Number(Number(d).toFixed(2))}″`;
  const metros = (mm) => `${W.num(mm / 1000, mm % 1000 === 0 ? 1 : mm % 100 === 0 ? 1 : 3)} m`;
  const ico = (cuerpo) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;
  const ICONOS = {
    COLECTOR: '<rect x="6" y="3" width="12" height="15" rx="1.5"/><path d="M9 18l-2 3M15 18l2 3M18 8h3"/>',
    MAQUINA: '<rect x="3" y="10" width="13" height="10" rx="1.5"/><path d="M9 10V5h3v5M16 15h3"/>',
    CAMPANA: '<path d="M4 18h16l-5-7H9z"/><path d="M12 11V4"/>',
    VENTILADOR: '<circle cx="12" cy="12" r="8"/><path d="M12 12c0-4 3-5 4-3M12 12c-3 2-6 0-4-2M12 12c2 3 0 6-2 4"/>',
    TOMA: '<rect x="3" y="12" width="12" height="9" rx="1"/><path d="M9 12V5M6 8l3-3 3 3"/>',
    MANGUERA: '<path d="M6 21c0-6 6-6 6-9s-6-3-6-9"/><path d="M14 21c0-6 6-6 6-9s-6-3-6-9" opacity=".5"/>',
    BRIDA: '<path d="M4 9h16M4 15h16M7 9v6M17 9v6M12 3v6M12 15v6"/>',
    TRAMO: '<path d="M4 18L20 6"/><path d="M4 21l3-6M17 9l3-6" opacity=".5"/>',
    VERTICAL: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    REDUCCION: '<path d="M3 7h6l8 3v4l-8 3H3z"/><path d="M17 12h4"/>',
    INJERTO: '<path d="M3 15h18M3 20h18M9 15l7-10M14 15l6-8"/>',
    RINJ: '<path d="M3 14h9l9 2v3l-9 2H3z"/><path d="M6 14l7-10M10 14l6-8"/>',
    T90: '<path d="M3 16h18M3 21h18M9 16V4M15 16V4"/>',
    PANTALON: '<path d="M10 21v-6M14 21v-6M10 15L5 4M14 15l5-11"/>',
    COMPUERTA: '<path d="M3 9h18M3 15h18M12 6v12M8 8l8 8"/>',
    TAPA: '<path d="M3 9h12M3 15h12M15 6v12"/>',
    MEDIR: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    SELECCIONAR: '<path d="M6 3l12 9-5.5 1.2L15 20l-2.4 1-2.6-6.6L6 18z"/>',
    MOVER: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    BORRAR: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    deshacer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    rehacer: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    ajustar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    girarIzq: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/>',
    girarDer: '<path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4"/>',
    candado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  };
  const icono = (k) => h('span', { class: 'icono', html: ico(ICONOS[k] || '') });

  /** La paleta de bloques (§4.3). */
  const PALETA = [
    { grupo: 'Equipos', bloques: [
      { id: 'COLECTOR', nombre: 'Colector', herr: 'EQUIPO', tipo: 'COLECTOR' }, { id: 'MAQUINA', nombre: 'Máquina', herr: 'EQUIPO', tipo: 'MAQUINA' },
      { id: 'CAMPANA', nombre: 'Campana', herr: 'EQUIPO', tipo: 'CAMPANA' }, { id: 'VENTILADOR', nombre: 'Ventilador', herr: 'EQUIPO', tipo: 'VENTILADOR' }] },
    { grupo: 'Tomas y acople', bloques: [
      { id: 'TOMA', nombre: 'Toma', herr: 'TOMA', tecla: 'P' }, { id: 'MANGUERA', nombre: 'Manguera', herr: 'MANGUERA', tecla: 'F' }, { id: 'BRIDA', nombre: 'Brida', herr: 'BRIDA', tecla: 'B' }] },
    { grupo: 'Ductos', bloques: [
      { id: 'TRAMO', nombre: 'Tramo recto', herr: 'TRAMO', tecla: 'T' }, { id: 'VERTICAL', nombre: 'Sube o baja', herr: 'VERTICAL', tecla: 'V' },
      { id: 'REDUCCION', nombre: 'Reducción', herr: 'REDUCCION', tecla: 'R' }] },
    { grupo: 'Derivaciones', bloques: [
      { id: 'INJERTO', nombre: 'Injerto', herr: 'INJERTO', tecla: 'I' }, { id: 'RINJ', nombre: 'Red. c/ injerto', herr: 'RINJ', tecla: 'J' },
      { id: 'T90', nombre: 'T a 90°', apagado: 't90' }, { id: 'PANTALON', nombre: 'Pantalón', apagado: 'pantalon' }] },
    { grupo: 'Utilidades', bloques: [
      { id: 'SELECCIONAR', nombre: 'Seleccionar', herr: 'SELECCIONAR', tecla: 'S' }, { id: 'MOVER', nombre: 'Mover segmento', herr: 'MOVER', tecla: 'M' },
      { id: 'MEDIR', nombre: 'Medir', herr: 'MEDIR', tecla: 'D' }, { id: 'BORRAR', nombre: 'Borrar', herr: 'BORRAR', tecla: 'Supr' },
      { id: 'COMPUERTA', nombre: 'Compuerta', herr: 'COMPUERTA', tecla: 'G' }, { id: 'TAPA', nombre: 'Extremo o tapa', apagado: 'tapa' }] },
  ];
  const TECLA_HERR = { s: 'SELECCIONAR', t: 'TRAMO', c: 'TRAMO', v: 'VERTICAL', r: 'REDUCCION', i: 'INJERTO', j: 'RINJ', m: 'MOVER', d: 'MEDIR', p: 'TOMA', g: 'COMPUERTA' };
  const VISTAS_BTN = [['NE', 'Iso', '1'], ['PLANTA', 'Planta', '2'], ['ELEV_XZ', 'Elev. X-Z', '3'], ['ELEV_YZ', 'Elev. Y-Z', '4']];

  const ui = { s: null, montado: false, puntero: null, gesto: null, punteros: new Map(), hover: null, cuadro: 0, espacio: false, abierto: false, dim: null, paleta: null };

  /* ------------------------------------------------------------------ el tablero y la cotización */

  /** El tablero sobre el trazo de la cotización (si la cotización cambió, se abre el suyo). */
  function tablero() {
    const cot = E().cot;
    const guardado = cot.trazado_iso || null;
    const s0 = ui.s;
    const vacio = (t) => !t.equipos.length && !t.nodos.length;
    const mismo = s0 && s0.cot === cot && (guardado ? s0.t === guardado : vacio(s0.t));
    if (!mismo) {
      const m = guardado || TZ().nuevo(M());
      ui.s = TB().crear(M(), m, s0 ? { ancho: s0.ancho, alto: s0.alto } : undefined);
      ui.s.cot = cot;
      if (s0) ui.s.fase = s0.fase;
      TB().decir(ui.s, m.equipos.length ? 'Siga el trazado: arrastre desde una toma, un extremo o un tramo.' : 'Empiece por el colector: elíjalo en la paleta y toque el piso.', false);
    }
    return ui.s;
  }
  /** Guarda el trazo con la cotización (cada cambio es una operación del usuario, no un movimiento del puntero). */
  function guardar() {
    const s = ui.s;
    const cot = E().cot;
    if (s.t.equipos.length || s.t.nodos.length) cot.trazado_iso = s.t; else delete cot.trazado_iso;
    W.persistir();
  }
  /** Después de cada cambio del tablero: guardar y volver a pintar todo. */
  function cambio() {
    guardar();
    pintar();
  }

  /* ------------------------------------------------------------------ lienzo */

  const P = (p) => TB().pantalla(ui.s, p);
  const marcas = () => {
    const err = new Set();
    const aviso = new Set();
    ui.s.problemas.forEach((p) => p.elementos.forEach((e) => { if (p.severidad === 'ERROR' || p.severidad === 'BLOQUEANTE') err.add(e); else if (p.severidad === 'AVISO') aviso.add(e); }));
    return { err, aviso };
  };
  /** Acomoda las etiquetas sin encimarlas ni sacarlas del lienzo: cada una toma el primer lugar libre de sus candidatos. */
  /**
   * Dónde va cada etiqueta: el primer lugar libre de sus candidatos. Si ninguno está libre, la obligada va donde menos tape
   * (encimarse en un ducto pesa poco; en otra etiqueta, más; en la barra de vistas, el cubo o los ejes, mucho), y la que no
   * es obligada sólo si tapa poco. Peso por caja: 0.3 ducto, 1 etiqueta o marca, 8 controles del lienzo.
   */
  function colocador() {
    const cajas = [];
    const { ancho, alto } = ui.s;
    const fuera = (r) => r.x < 2 || r.y < 2 || r.x + r.w > ancho - 2 || r.y + r.h > alto - 2;
    const cruce = (r, c) => Math.max(0, Math.min(r.x + r.w, c.x + c.w) - Math.max(r.x, c.x)) * Math.max(0, Math.min(r.y + r.h, c.y + c.h) - Math.max(r.y, c.y));
    const tapa = (r) => cajas.reduce((a, c) => a + cruce(r, c) * c.peso, 0);
    const dentro = (r) => ({ ...r, x: Math.max(2, Math.min(r.x, ancho - r.w - 2)), y: Math.max(2, Math.min(r.y, alto - r.h - 2)) });
    return {
      ocupar: (r, peso) => cajas.push({ ...r, peso: peso === undefined ? 1 : peso }),
      elegir: (cands, obligado) => {
        const libre = cands.find((c) => !fuera(c) && tapa(c) === 0);
        let r = libre;
        if (!r) {
          const opciones = cands.map(dentro).map((c) => ({ c, t: tapa(c) }));
          const mejor = opciones.reduce((m, o) => (o.t < m.t ? o : m), opciones[0]);
          if (!obligado && mejor.t > mejor.c.w * mejor.c.h * 0.15) return null;
          r = mejor.c;
        }
        cajas.push({ ...r, peso: 1 });
        return r;
      },
    };
  }
  const anchoTexto = (t, px) => t.length * px * 0.56 + 4;

  /** La rejilla del piso (o del plano de la elevación): puntos cada 0.5, 1, 2 o 5 m según el acercamiento, y los ejes del origen. */
  function rejilla() {
    const s = ui.s;
    const g = svg('g', { class: 'ti-rejilla' });
    const plano = s.vista === 'ELEV_XZ' ? { punto: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, ejes: ['x', 'z'] }
      : s.vista === 'ELEV_YZ' ? { punto: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, ejes: ['y', 'z'] }
        : { punto: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, ejes: ['x', 'y'] };
    const esq = [[0, 0], [s.ancho, 0], [0, s.alto], [s.ancho, s.alto]].map(([x, y]) => TB().enPlano(s, x, y, plano)).filter((r) => r.punto && !r.degenerado).map((r) => r.punto);
    const paso = [500, 1000, 2000, 5000, 10000, 20000].find((p) => p * s.cam.k >= 26) || 50000;
    if (esq.length === 4) {
      const [a, b] = plano.ejes;
      const lo = { [a]: Math.min(...esq.map((p) => p[a])), [b]: Math.min(...esq.map((p) => p[b])) };
      const hi = { [a]: Math.max(...esq.map((p) => p[a])), [b]: Math.max(...esq.map((p) => p[b])) };
      let n = 0;
      const lineas = [];
      for (let u = Math.ceil(lo[a] / paso) * paso; u <= hi[a] && n < 300; u += paso, n += 1) {
        const p0 = { x: 0, y: 0, z: 0, [a]: u, [b]: lo[b] };
        const p1 = { x: 0, y: 0, z: 0, [a]: u, [b]: hi[b] };
        const q0 = P(p0); const q1 = P(p1);
        lineas.push(`M${f1(q0.x)} ${f1(q0.y)}L${f1(q1.x)} ${f1(q1.y)}`);
      }
      for (let v = Math.ceil(lo[b] / paso) * paso; v <= hi[b] && n < 600; v += paso, n += 1) {
        const p0 = { x: 0, y: 0, z: 0, [a]: lo[a], [b]: v };
        const p1 = { x: 0, y: 0, z: 0, [a]: hi[a], [b]: v };
        const q0 = P(p0); const q1 = P(p1);
        lineas.push(`M${f1(q0.x)} ${f1(q0.y)}L${f1(q1.x)} ${f1(q1.y)}`);
      }
      g.append(svg('path', { d: lineas.join(''), class: 'ti-rejilla-linea' }));
    }
    // los ejes del origen, con su letra
    const o = P({ x: 0, y: 0, z: 0 });
    [['x', 'X'], ['y', 'Y'], ['z', 'Z']].forEach(([k, L]) => {
      const q = P({ x: 0, y: 0, z: 0, [k]: Math.max(1000, 40 / s.cam.k) });
      if (Math.hypot(q.x - o.x, q.y - o.y) < 4) return;
      g.append(svg('line', { x1: f1(o.x), y1: f1(o.y), x2: f1(q.x), y2: f1(q.y), class: `ti-eje ti-eje-${k}` }));
      g.append(svg('text', { x: f1(q.x + 4), y: f1(q.y - 4), class: `ti-eje-txt ti-eje-${k}-txt` }, L));
    });
    return { g, paso };
  }

  /** El plano de trabajo (un rectángulo translucido con su z) alrededor de un punto. */
  function planoTrabajo(P0, nombre, normal) {
    const s = ui.s;
    const r = 2000;
    let u;
    let v;
    if (Math.abs(normal.z) > 0.9) { u = { x: 1, y: 0, z: 0 }; v = { x: 0, y: 1, z: 0 }; } else { u = { x: -normal.y, y: normal.x, z: 0 }; v = { x: 0, y: 0, z: 1 }; }
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => P({ x: P0.x + r * (a * u.x + b * v.x), y: P0.y + r * (a * u.y + b * v.y), z: P0.z + r * (a * u.z + b * v.z) }));
    const g = svg('g', { class: 'ti-plano' });
    g.append(svg('polygon', { points: pts.map((q) => `${f1(q.x)},${f1(q.y)}`).join(' '), class: 'ti-plano-rect' }));
    const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
    g.append(svg('text', { x: f1(Math.max(4, Math.min(top.x + 6, s.ancho - anchoTexto(nombre, 11) - 4))), y: f1(Math.max(14, top.y - 6)), class: 'ti-plano-txt' }, nombre));
    return g;
  }

  /** Dibuja la escena: rejilla, equipos y ductos de lo más lejano a lo más cercano, puertos, piezas y etiquetas sin encimar. */
  function dibujarLienzo() {
    const el = $('#ti-lienzo');
    if (!el) return;
    const s = ui.s;
    const g = s.g;
    el.setAttribute('viewBox', `0 0 ${s.ancho} ${s.alto}`);
    const { err, aviso } = marcas();
    const { g: grid, paso } = rejilla();
    const escena = svg('g', { class: 'ti-escena' });
    const sobre = svg('g', { class: 'ti-sobre' });
    const etiquetas = svg('g', { class: 'ti-etiquetas' });
    const sel = s.sel;
    const lugar = colocador();
    const barra = $('.ti-vistas');
    lugar.ocupar({ x: 0, y: 0, w: barra ? barra.offsetWidth + 12 : 520, h: barra ? barra.offsetHeight + 12 : 48 }, 8);
    lugar.ocupar({ x: s.ancho - 104, y: 0, w: 104, h: 104 }, 8);
    lugar.ocupar({ x: 0, y: s.alto - 88, w: 88, h: 88 }, 8);
    lugar.ocupar({ x: s.ancho - 300, y: s.alto - 26, w: 300, h: 26 }, 8); // la escala de la rejilla
    const items = [];
    const prof = (p) => TB().profundidad(s, p);
    const clase = (id, base) => [base, err.has(id) ? 'ti-err' : aviso.has(id) ? 'ti-aviso' : '', sel && sel.id === id ? 'ti-sel' : '', ui.hover === id ? 'ti-hover' : ''].filter(Boolean).join(' ');
    // equipos: sus caras visibles
    s.t.equipos.forEach((e) => {
      const caras = TB().carasVisibles(s, e);
      const centro = { x: e.posicion_mm.x, y: e.posicion_mm.y, z: e.posicion_mm.z + e.caja_mm.alto / 2 };
      items.push({
        prof: prof(centro) + Math.max(e.caja_mm.largo, e.caja_mm.ancho) / 2,
        pintar: (dest) => {
          const gg = svg('g', { class: clase(e.id, `ti-equipo ti-equipo-${e.tipo.toLowerCase()}`), 'data-equipo': e.id });
          caras.forEach((c) => gg.append(svg('polygon', { points: c.puntos.map((q) => `${f1(q.x)},${f1(q.y)}`).join(' '), class: `ti-cara ti-cara-${c.cara.n.z > 0.5 ? 'arriba' : Math.abs(c.cara.n.x) > 0.5 ? 'x' : 'y'}` })));
          dest.append(gg);
        },
      });
      const arriba = P({ ...e.posicion_mm, z: e.posicion_mm.z + e.caja_mm.alto });
      const w = anchoTexto(e.nombre, 12);
      items.push({ prof: -Infinity, etiqueta: { texto: e.nombre, clase: 'ti-txt ti-txt-eq', cand: [[arriba.x - w / 2, arriba.y - 22], [arriba.x + 8, arriba.y - 10], [arriba.x - w - 8, arriba.y - 10]], w } });
    });
    // ductos rígidos y mangueras
    const cotas = [];
    s.t.tramos.forEach((t) => {
      if (t.tipo === 'FLEXIBLE') {
        const rm = g.mang.get(t.id);
        if (!rm) return;
        const pts = TZ().puntosManguera(rm.entrada, rm);
        const qs = pts.map(P);
        const mid = pts[Math.floor(pts.length / 2)];
        items.push({
          prof: prof(mid),
          pintar: (dest) => {
            const d = `M${qs.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L')}`;
            dest.append(svg('path', { d, class: clase(t.id, 'ti-manguera'), 'stroke-width': f1(Math.max(4, t.diametro_in * IN * s.cam.k)), 'data-tramo': t.id }));
            dest.append(svg('path', { d, class: 'ti-manguera-eje' }));
          },
        });
        return;
      }
      const A = g.pos.get(t.a);
      const B = g.pos.get(t.b);
      const a = P(A);
      const b = P(B);
      const ancho = Math.max(4, t.diametro_in * IN * s.cam.k);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 };
      items.push({
        prof: prof(mid),
        pintar: (dest) => {
          if (L < 1.5) {
            dest.append(svg('circle', { cx: f1(a.x), cy: f1(a.y), r: f1(ancho / 2 + 2), class: clase(t.id, 'ti-tramo ti-tramo-punta'), 'data-tramo': t.id }));
            return;
          }
          dest.append(svg('line', { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), 'stroke-width': f1(ancho), class: clase(t.id, 'ti-tramo'), 'data-tramo': t.id }));
          dest.append(svg('line', { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), class: 'ti-tramo-eje' }));
          // la flecha del aire
          if (g.arriba.has(t.id) && L > 26) {
            const de = g.arriba.get(t.id) === t.a ? a : b;
            const al = de === a ? b : a;
            const ux = (al.x - de.x) / L;
            const uy = (al.y - de.y) / L;
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            const k = 6;
            dest.append(svg('path', { d: `M${f1(cx + ux * k)} ${f1(cy + uy * k)}L${f1(cx - ux * k - uy * k * 0.8)} ${f1(cy - uy * k + ux * k * 0.8)}L${f1(cx - ux * k + uy * k * 0.8)} ${f1(cy - uy * k - ux * k * 0.8)}Z`, class: 'ti-flecha' }));
          }
        },
      });
      if (L >= 2) for (let f = 0, pasoF = Math.max(10, ancho) / L; f <= 1; f += pasoF) lugar.ocupar({ x: a.x + (b.x - a.x) * f - ancho / 2, y: a.y + (b.y - a.y) * f - ancho / 2, w: ancho, h: ancho }, 0.3);
      if (L < 40) return;
      let nx = -(b.y - a.y) / L;
      let ny = (b.x - a.x) / L;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
      const validar = s.fase === 4;
      const fc = s.fase === 5 ? TB().filaCalculo(s, t.id) : null;
      const Q = g.Q.get(t.id);
      const v = g.v.get(t.id);
      const sem = Q ? TB().velocidadSemaforo(s, v) : null;
      const txt = fc ? `${pulg(t.diametro_in)} · ${n0(fc.caudal_m3_h)} m³/h · ${n0(fc.presion_estatica_Pa)} Pa`
        : validar ? `${pulg(t.diametro_in)} · ${Q === null ? 'sin caudal' : `${n0(Q)} m³/h · ${W.num(v, 1)} m/s`}` : `${pulg(t.diametro_in)} · ${metros(g.seg.get(t.id).L)}`;
      const w = anchoTexto(txt, 12);
      const off = ancho / 2 + 10;
      const cand = [];
      [0.5, 0.35, 0.65, 0.22, 0.78].forEach((f) => [1, -1].forEach((ld) => cand.push([a.x + (b.x - a.x) * f + nx * off * ld - w / 2, a.y + (b.y - a.y) * f + ny * off * ld - 8])));
      cotas.push({ t, txt, err: err.has(t.id), cand, corto: L < 80, w, sem: validar ? sem : null });
    });
    items.filter((x) => x.pintar).sort((p, q) => q.prof - p.prof).forEach((x) => x.pintar(escena));
    // puertos y puntos de transición
    s.t.equipos.forEach((e) => e.puertos.forEach((p) => {
      const pu = g.puertos.get(p.id);
      if (!pu) return;
      const q = P(pu.posicion_mm);
      const u = TZ().vectorDe(pu.direccion);
      const largo = Math.max(250, 26 / s.cam.k);
      const q2 = P({ x: pu.posicion_mm.x + u.x * largo, y: pu.posicion_mm.y + u.y * largo, z: pu.posicion_mm.z + u.z * largo });
      const cl = clase(p.id, `ti-puerto ti-puerto-${p.rol.toLowerCase()}${p.acople ? '' : ' ti-puerto-libre'}`);
      const gg = svg('g', { class: cl, 'data-puerto': p.id });
      if (Math.hypot(q2.x - q.x, q2.y - q.y) > 3 && !(p.acople && g.ady.get(p.nodo).length)) gg.append(svg('line', { x1: f1(q.x), y1: f1(q.y), x2: f1(q2.x), y2: f1(q2.y), class: 'ti-puerto-flecha', 'marker-end': 'url(#ti-punta)' }));
      gg.append(svg('path', { d: `M${f1(q.x)} ${f1(q.y - 7)}L${f1(q.x + 7)} ${f1(q.y)}L${f1(q.x)} ${f1(q.y + 7)}L${f1(q.x - 7)} ${f1(q.y)}Z`, class: 'ti-puerto-marca' }));
      sobre.append(gg);
      lugar.ocupar({ x: q.x - 8, y: q.y - 8, w: 16, h: 16 });
      if (p.acople && p.acople.tipo === 'MANGUERA') {
        const r = P(g.pos.get(p.acople.nodo_transicion));
        sobre.append(svg('path', { d: `M${f1(r.x)} ${f1(r.y - 6)}L${f1(r.x + 6)} ${f1(r.y)}L${f1(r.x)} ${f1(r.y + 6)}L${f1(r.x - 6)} ${f1(r.y)}Z`, class: clase(p.id, 'ti-pt'), 'data-pt': p.id }));
        lugar.ocupar({ x: r.x - 7, y: r.y - 7, w: 14, h: 14 });
      }
    }));
    // nodos: extremos libres y piezas
    s.t.nodos.forEach((nd) => {
      const ad = g.ady.get(nd.id) || [];
      if (g.puertoDeNodo.has(nd.id) || g.pt.has(nd.id) || !ad.length) return;
      const q = P(nd.posicion_mm);
      const libre = ad.length === 1;
      sobre.append(svg('circle', { cx: f1(q.x), cy: f1(q.y), r: libre ? 5.5 : 3.5, class: clase(nd.id, `ti-nodo${libre ? ' ti-nodo-libre' : ''}${nd.ancla ? ' ti-nodo-ancla' : ''}`), 'data-nodo': nd.id }));
      lugar.ocupar({ x: q.x - 7, y: q.y - 7, w: 14, h: 14 });
    });
    // etiquetas: piezas de los nodos, nombres de equipos, cotas
    s.t.nodos.forEach((nd) => {
      const pz = TB().piezasDe(s, nd.id);
      if (!pz.length) return;
      const q = P(nd.posicion_mm);
      const t = pz.map((x) => x.corto).join(' + ');
      const w = anchoTexto(t, 11) + 10;
      const r = lugar.elegir([[q.x + 9, q.y - 27], [q.x - 9 - w, q.y - 27], [q.x + 9, q.y + 9], [q.x - 9 - w, q.y + 9], [q.x - w / 2, q.y - 34], [q.x - w / 2, q.y + 14]].map(([x, y]) => ({ x, y, w, h: 18 })), true);
      etiquetas.append(svg('rect', { x: f1(r.x), y: f1(r.y), width: f1(w), height: 18, rx: 9, class: `ti-pieza${err.has(nd.id) ? ' ti-pieza-err' : ''}` }));
      etiquetas.append(svg('text', { x: f1(r.x + w / 2), y: f1(r.y + 13), 'text-anchor': 'middle', class: 'ti-pieza-txt' }, t));
    });
    items.filter((x) => x.etiqueta).forEach((x) => {
      const r = lugar.elegir(x.etiqueta.cand.map(([a, b]) => ({ x: a, y: b, w: x.etiqueta.w, h: 16 })), true);
      etiquetas.append(svg('text', { x: f1(r.x), y: f1(r.y + 12), class: x.etiqueta.clase }, x.etiqueta.texto));
    });
    cotas.forEach((c) => {
      const r = lugar.elegir(c.cand.map(([x, y]) => ({ x, y, w: c.w, h: 16 })), !c.corto);
      if (r) etiquetas.append(svg('text', { x: f1(r.x), y: f1(r.y + 12), class: `ti-txt${c.err ? ' ti-txt-err' : c.sem === 'AMBAR' ? ' ti-txt-ambar' : c.sem === 'VERDE' ? ' ti-txt-ok' : ''}`, 'data-cota': c.t.id }, c.txt));
    });
    const defs = svg('defs', null, svg('marker', { id: 'ti-punta', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10z', class: 'ti-punta' })));
    el.replaceChildren(defs, grid, escena, sobre, etiquetas, gizmo(), svg('g', { id: 'ti-capa' }));
    const esc = $('#ti-escala');
    if (esc) esc.textContent = `Rejilla de ${W.num(paso / 1000, paso < 1000 ? 1 : 0)} m · ${TB().NOMBRE_VISTA[s.vista]} · nivel z = ${n0(s.nivel)} mm`;
    dibujarCapa();
    dibujarCubo();
  }

  /** El gizmo de ejes (abajo a la izquierda): X rojo, Y verde, Z azul, cada uno con su letra. */
  function gizmo() {
    const s = ui.s;
    const o = { x: 44, y: s.alto - 44 };
    const g = svg('g', { class: 'ti-gizmo', 'aria-hidden': 'true' });
    g.append(svg('circle', { cx: o.x, cy: o.y, r: 34, class: 'ti-gizmo-fondo' }));
    [['x', 'X'], ['y', 'Y'], ['z', 'Z']].forEach(([k, L]) => {
      const q = TZ().proyectar({ x: 0, y: 0, z: 0, [k]: 1 }, s.vista);
      const len = Math.hypot(q.u, q.v);
      if (len < 0.05) { g.append(svg('text', { x: o.x + 2, y: o.y + 4, 'text-anchor': 'middle', class: `ti-gizmo-txt ti-eje-${k}-txt` }, `${L}·`)); return; }
      const x2 = o.x + q.u * 24;
      const y2 = o.y - q.v * 24;
      g.append(svg('line', { x1: o.x, y1: o.y, x2: f1(x2), y2: f1(y2), class: `ti-gizmo-eje ti-eje-${k}` }));
      g.append(svg('text', { x: f1(o.x + q.u * 32 / len * Math.min(1, len)), y: f1(o.y - q.v * 32 / len * Math.min(1, len) + 4), 'text-anchor': 'middle', class: `ti-gizmo-txt ti-eje-${k}-txt` }, L));
    });
    return g;
  }

  /** El cubo de vista (arriba a la derecha): la cara de arriba da la planta; las de lado, las elevaciones. */
  function dibujarCubo() {
    const el = $('#ti-cubo');
    if (!el) return;
    const s = ui.s;
    const caja = { id: 'cubo', posicion_mm: { x: 0, y: 0, z: -0.5 }, rotacion_z_deg: 0, caja_mm: { largo: 1, ancho: 1, alto: 1 } };
    const tmp = { ...s, cam: { k: 1, ox: 0, oy: 0 } };
    const caras = TB().carasVisibles(tmp, caja);
    const pts = caras.flatMap((c) => c.puntos);
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    const k = 70 / Math.max(x1 - x0, y1 - y0, 0.5); // caras grandes: «Oeste» y «Norte» caben en la suya
    const cx = 41 - ((x0 + x1) / 2) * k;
    const cy = 41 - ((y0 + y1) / 2) * k;
    const hijos = caras.map((c) => {
      const nn = c.cara.n;
      const vista = nn.z > 0.5 ? 'PLANTA' : Math.abs(nn.y) > 0.5 ? 'ELEV_XZ' : 'ELEV_YZ';
      const nombre = nn.z > 0.5 ? 'Arriba' : nn.x > 0.5 ? 'Este' : nn.x < -0.5 ? 'Oeste' : nn.y > 0.5 ? 'Norte' : 'Sur';
      const poly = c.puntos.map((p) => `${f1(cx + p.x * k)},${f1(cy + p.y * k)}`).join(' ');
      const m = c.puntos.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
      const g = svg('g', { class: 'ti-cubo-cara', role: 'button', tabindex: '-1', 'data-vista': vista, 'aria-label': `${nombre}: ${TB().NOMBRE_VISTA[vista]}` });
      g.append(svg('polygon', { points: poly }));
      g.append(svg('text', { x: f1(cx + m.x * k), y: f1(cy + m.y * k + 3.5), 'text-anchor': 'middle' }, nombre));
      return g;
    });
    el.replaceChildren(...hijos);
  }

  /** La capa de lo que se mueve con el puntero: fantasma, imán, guías, tiradores, equipo arrastrado, medir. */
  function dibujarCapa() {
    const capa = $('#ti-capa');
    if (!capa) return;
    const s = ui.s;
    const hijos = [];
    const pt = ui.puntero;
    // los tiradores de la manguera de la toma seleccionada (§1.2)
    const tir = tiradores();
    if (tir) {
      const gs = ui.gesto;
      let h0 = tir.mg.h;
      let ev = tir.mg.ev;
      if (gs && (gs.modo === 'ROMBO' || gs.modo === 'CIRCULO') && gs.previa) { h0 = gs.h; ev = gs.ev; }
      const pre = TB().previaManguera(s, tir.pid, h0, ev);
      const qs = pre.puntos.map(P);
      const color = { VERDE: 'ti-ok', AMBAR: 'ti-ambar', ROJO: 'ti-rojo' }[pre.semaforo.color];
      if (gs && gs.previa) hijos.push(svg('path', { d: `M${qs.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L')}`, class: `ti-manguera-previa ${color}`, 'stroke-width': f1(Math.max(3, tir.mg.pu.puerto.diametro_in * IN * s.cam.k)) }));
      const eje = P({ x: tir.mg.Pt.x + tir.mg.ut.x * h0, y: tir.mg.Pt.y + tir.mg.ut.y * h0, z: tir.mg.Pt.z + tir.mg.ut.z * h0 });
      const ptq = P(pre.PT);
      const base = P(tir.mg.Pt);
      hijos.push(svg('line', { x1: f1(base.x), y1: f1(base.y), x2: f1(eje.x), y2: f1(eje.y), class: 'ti-tirador-eje' }));
      if (Math.hypot(ptq.x - eje.x, ptq.y - eje.y) > 1) hijos.push(svg('line', { x1: f1(eje.x), y1: f1(eje.y), x2: f1(ptq.x), y2: f1(ptq.y), class: 'ti-tirador-eje' }));
      hijos.push(svg('path', { d: `M${f1(eje.x)} ${f1(eje.y - 9)}L${f1(eje.x + 9)} ${f1(eje.y)}L${f1(eje.x)} ${f1(eje.y + 9)}L${f1(eje.x - 9)} ${f1(eje.y)}Z`, class: `ti-rombo ${color}`, 'data-tirador': 'ROMBO' }));
      hijos.push(svg('circle', { cx: f1(ptq.x), cy: f1(ptq.y), r: 8, class: `ti-circulo ${color}`, 'data-tirador': 'CIRCULO' }));
      if (gs && gs.previa) hijos.push(etiqueta(ptq.x + 14, ptq.y - 14, pre.semaforo.texto, color));
    }
    // el fantasma del trazo
    if (s.traza && pt) {
      const f = TB().fantasma(s, pt.x, pt.y, pt.tactil);
      ui.ultimoFantasma = f;
      const a = P(s.traza.P0);
      hijos.push(svg('circle', { cx: f1(a.x), cy: f1(a.y), r: 7, class: 'ti-fantasma-ini' }));
      const pl = TB().planoDeTrabajo(s, pt.x, pt.y);
      if (pl.tipo === 'PLANO' && !f.ruta) hijos.unshift(planoTrabajo(s.traza.P0, pl.plano.nombre, pl.plano.normal));
      if (f && f.ruta) {
        // propuestas del imán: punteadas, con sus números; la elegida, más marcada
        f.rutas.forEach((r, i) => {
          const ps = [s.traza.P0];
          r.segmentos.forEach((sg) => { const u = TZ().vectorDe(sg.direccion); const q = ps[ps.length - 1]; ps.push({ x: q.x + u.x * sg.largo_mm, y: q.y + u.y * sg.largo_mm, z: q.z + u.z * sg.largo_mm }); });
          const qs = ps.map(P);
          hijos.push(svg('path', { d: `M${qs.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L')}`, class: `ti-iman${i === f.i ? ' ti-iman-elegida' : ''}`, 'stroke-width': f1(Math.max(3, f.D * IN * s.cam.k)) }));
          if (i === f.i) {
            r.segmentos.forEach((sg, j) => {
              const m = { x: (qs[j].x + qs[j + 1].x) / 2, y: (qs[j].y + qs[j + 1].y) / 2 };
              hijos.push(etiqueta(m.x + 8, m.y - 8, metros(sg.largo_mm), 'ti-iman-num'));
            });
          }
        });
        const fin = P(f.P1);
        hijos.push(svg('circle', { cx: f1(fin.x), cy: f1(fin.y), r: 9, class: 'ti-iman-punto' }));
      } else if (f && f.P1) {
        const b = P(f.P1);
        const cls = f.ok ? (f.estado === 'OK' ? 'ti-ok' : 'ti-ambar') : 'ti-rojo';
        hijos.push(svg('line', { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), 'stroke-width': f1(Math.max(4, f.D * IN * s.cam.k)), class: `ti-fantasma ${cls}` }));
        if (f.ok && f.estado !== 'OK') hijos.push(svg('path', { d: `M${f1(b.x)} ${f1(b.y - 10)}L${f1(b.x + 9)} ${f1(b.y + 6)}L${f1(b.x - 9)} ${f1(b.y + 6)}Z`, class: 'ti-triangulo' }));
        hijos.push(svg('circle', { cx: f1(b.x), cy: f1(b.y), r: 5, class: `ti-fantasma-fin ${cls}` }));
        if (f.guia) {
          const g0 = P(f.guia.de);
          const g1 = P(f.guia.a);
          hijos.push(svg('line', { x1: f1(g0.x), y1: f1(g0.y), x2: f1(g1.x), y2: f1(g1.y), class: `ti-guia ti-eje-${f.guia.eje.toLowerCase()}` }));
        }
      }
      if (f && f.texto) hijos.push(etiqueta(pt.x + 16, pt.y + 22, f.texto, f.ok ? (f.estado === 'OK' ? 'ti-ok' : 'ti-ambar') : 'ti-rojo'));
    }
    // el equipo que se arrastra
    const gs = ui.gesto;
    if (gs && gs.modo === 'EQUIPO' && gs.destino) {
      const e = s.t.equipos.find((q) => q.id === gs.id);
      if (e) {
        const fant = { ...e, posicion_mm: gs.destino };
        TB().carasVisibles(s, fant).forEach((c) => hijos.push(svg('polygon', { points: c.puntos.map((q) => `${f1(q.x)},${f1(q.y)}`).join(' '), class: 'ti-equipo-fantasma' })));
        const q = P(gs.destino);
        hijos.push(etiqueta(q.x + 12, q.y + 18, `X ${n0(gs.destino.x)} · Y ${n0(gs.destino.y)}`, 'ti-ok'));
      }
    }
    // un equipo de la paleta sobre el lienzo, o la herramienta Equipo
    if ((s.herr === 'EQUIPO' || (ui.paleta && ui.paleta.sobre)) && pt && !gs) {
      const tipo = ui.paleta ? ui.paleta.tipo : s.tipoEquipo;
      const Pp = TB().puntoDelPiso(s, pt.x, pt.y);
      if (Pp) {
        const fant = { posicion_mm: Pp, rotacion_z_deg: 0, caja_mm: TB().CAJAS[tipo] };
        TB().carasVisibles(s, fant).forEach((c) => hijos.push(svg('polygon', { points: c.puntos.map((q) => `${f1(q.x)},${f1(q.y)}`).join(' '), class: 'ti-equipo-fantasma' })));
      }
    }
    if (gs && gs.modo === 'MOVER' && gs.w) {
      const t = s.g.tramos.get(gs.id);
      if (t) {
        const A = s.g.pos.get(t.a);
        const B = s.g.pos.get(t.b);
        const a = P({ x: A.x + gs.w.x, y: A.y + gs.w.y, z: A.z + gs.w.z });
        const b = P({ x: B.x + gs.w.x, y: B.y + gs.w.y, z: B.z + gs.w.z });
        hijos.push(svg('line', { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), 'stroke-width': f1(Math.max(4, t.diametro_in * IN * s.cam.k)), class: 'ti-fantasma ti-ambar' }));
        hijos.push(etiqueta(b.x + 12, b.y - 12, `${n0(Math.abs(gs.mm))} mm`, 'ti-ambar'));
      }
    }
    if (s.medir && s.medir.A) {
      const a = P(s.medir.A);
      const B = s.medir.B || (pt && TB().enNivel(s, pt.x, pt.y));
      hijos.push(svg('circle', { cx: f1(a.x), cy: f1(a.y), r: 5, class: 'ti-medir-punto' }));
      if (B) { const b = P(B); hijos.push(svg('line', { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), class: 'ti-medir' })); hijos.push(svg('circle', { cx: f1(b.x), cy: f1(b.y), r: 5, class: 'ti-medir-punto' })); }
    }
    capa.replaceChildren(...hijos);
    pintarEstado();
  }
  function etiqueta(x, y, texto, cls) {
    const s = ui.s;
    const w = Math.min(anchoTexto(texto, 12.5) + 12, s.ancho - 12);
    const xx = Math.max(6, Math.min(x, s.ancho - w - 6));
    const yy = Math.max(6, Math.min(y, s.alto - 30));
    const g = svg('g', { class: `ti-globo ${cls || ''}` });
    g.append(svg('rect', { x: f1(xx), y: f1(yy), width: f1(w), height: 22, rx: 6 }));
    g.append(svg('text', { x: f1(xx + 6), y: f1(yy + 15) }, texto.length > 160 ? `${texto.slice(0, 157)}…` : texto));
    return g;
  }
  /** La manguera cuyos tiradores se ven: la de la toma seleccionada. */
  function tiradores() {
    const s = ui.s;
    if (!s.sel || s.sel.tipo !== 'PUERTO') return null;
    const mg = TB().mangueraDe(s, s.sel.id);
    return mg ? { pid: s.sel.id, mg } : null;
  }
  function tiradorBajo(x, y) {
    const tir = tiradores();
    if (!tir) return null;
    const eje = P({ x: tir.mg.Pt.x + tir.mg.ut.x * tir.mg.h, y: tir.mg.Pt.y + tir.mg.ut.y * tir.mg.h, z: tir.mg.Pt.z + tir.mg.ut.z * tir.mg.h });
    const pt = P(tir.mg.PT);
    const dc = Math.hypot(pt.x - x, pt.y - y);
    const dr = Math.hypot(eje.x - x, eje.y - y);
    const r = 12;
    // sin desvío el rombo y el círculo coinciden: decide el primer arrastre (a lo largo del eje, el rombo; de lado, el círculo)
    if (dc <= r && dr <= r && Math.hypot(pt.x - eje.x, pt.y - eje.y) < 4) return { tipo: 'AMBOS', ...tir };
    if (dc <= r && dc <= dr) return { tipo: 'CIRCULO', ...tir };
    if (dr <= r) return { tipo: 'ROMBO', ...tir };
    return null;
  }
  /** Con el rombo y el círculo juntos, el arrastre a lo largo del eje de la toma (en la pantalla) mueve el rombo. */
  function tiradorPorArrastre(gs, x, y) {
    const mg = TB().mangueraDe(ui.s, gs.pid);
    const a = P(mg.Pt);
    const b = P({ x: mg.Pt.x + mg.ut.x * 1000, y: mg.Pt.y + mg.ut.y * 1000, z: mg.Pt.z + mg.ut.z * 1000 });
    const ax = { x: b.x - a.x, y: b.y - a.y };
    const d = { x: x - gs.x0, y: y - gs.y0 };
    const la = Math.hypot(ax.x, ax.y);
    const ld = Math.hypot(d.x, d.y);
    if (la < 1e-6) return 'ROMBO';
    return Math.abs((ax.x * d.x + ax.y * d.y) / (la * ld || 1)) > 0.8 ? 'ROMBO' : 'CIRCULO';
  }
  const norma3 = (v) => Math.hypot(v.x, v.y, v.z);

  /* ------------------------------------------------------------------ gestos */

  function local(ev) {
    const el = $('#ti-lienzo');
    const r = el.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / Math.max(1, r.width)) * ui.s.ancho, y: ((ev.clientY - r.top) / Math.max(1, r.height)) * ui.s.alto, tactil: ev.pointerType === 'touch' || ev.pointerType === 'pen' };
  }
  const DE_TRAZO = ['TRAMO', 'VERTICAL', 'INJERTO', 'RINJ'];
  function programarCapa() {
    if (ui.cuadro) return;
    ui.cuadro = root.requestAnimationFrame(() => { ui.cuadro = 0; dibujarCapa(); });
  }
  function alBajar(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
    const s = ui.s;
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    el.focus({ preventScroll: true });
    const p = local(ev);
    ui.puntero = p;
    ui.punteros.set(ev.pointerId, p);
    ev.preventDefault();
    if (ui.punteros.size === 2) {
      const [a, b] = [...ui.punteros.values()];
      ui.gesto = { modo: 'PELLIZCO', d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...s.cam } };
      return;
    }
    if (ui.punteros.size > 2) return;
    const base = { x0: p.x, y0: p.y, cam0: { ...s.cam }, movio: false, tactil: p.tactil };
    if (ev.button === 1 || ui.espacio) { ui.gesto = { ...base, modo: 'VISTA' }; return; }
    const tir = tiradorBajo(p.x, p.y);
    if (tir) { ui.gesto = { ...base, modo: tir.tipo, pid: tir.pid, h0: tir.mg.h, h: tir.mg.h, ev: tir.mg.ev, previa: false }; return; }
    const hit = TB().tocar(s, p.x, p.y, p.tactil);
    if (s.traza) { ui.gesto = { ...base, modo: 'TRAZO', hit }; return; }
    if (DE_TRAZO.includes(s.herr) && (hit || (s.herr === 'TRAMO' && !p.tactil))) {
      if (TB().empezar(s, hit, p.x, p.y)) { ui.gesto = { ...base, modo: 'TRAZO', nuevo: true }; pintarEstado(); programarCapa(); return; }
      pintarEstado();
      ui.gesto = { ...base, modo: 'VISTA', soloToque: true };
      return;
    }
    if (s.herr === 'SELECCIONAR' && hit && hit.tipo === 'EQUIPO') { ui.gesto = { ...base, modo: 'EQUIPO', id: hit.id, hit }; return; }
    if (s.herr === 'MOVER' && hit && hit.tipo === 'TRAMO') { ui.gesto = { ...base, modo: 'MOVER', id: hit.id, hit }; return; }
    ui.gesto = { ...base, modo: hit ? 'TOQUE' : 'VISTA', hit };
  }
  function alMover(ev) {
    const s = ui.s;
    const p = local(ev);
    if (ui.punteros.has(ev.pointerId)) ui.punteros.set(ev.pointerId, p);
    ui.puntero = p;
    const gs = ui.gesto;
    if (!gs) {
      if (ev.pointerType === 'mouse') {
        const hit = TB().tocar(s, p.x, p.y, false);
        const id = hit ? hit.id : null;
        if (id !== ui.hover) { ui.hover = id; dibujarLienzo(); return; }
      }
      programarCapa();
      return;
    }
    if (gs.modo === 'PELLIZCO') {
      const [a, b] = [...ui.punteros.values()];
      if (!a || !b) return;
      s.cam = { ...gs.cam0 };
      TB().zoom(s, Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gs.d0), gs.m0.x, gs.m0.y);
      TB().desplazar(s, (a.x + b.x) / 2 - gs.m0.x, (a.y + b.y) / 2 - gs.m0.y);
      dibujarLienzo();
      return;
    }
    if (Math.hypot(p.x - gs.x0, p.y - gs.y0) > (gs.tactil ? 10 : 5)) gs.movio = true;
    if (!gs.movio) return;
    if (gs.modo === 'VISTA' || gs.modo === 'TOQUE') {
      gs.modo = 'VISTA';
      s.cam = { ...gs.cam0 };
      TB().desplazar(s, p.x - gs.x0, p.y - gs.y0);
      dibujarLienzo();
      return;
    }
    if (gs.modo === 'AMBOS') gs.modo = tiradorPorArrastre(gs, p.x, p.y);
    if (gs.modo === 'ROMBO') { gs.h = TB().alturaPorArrastre(s, gs.pid, gs.h0, gs.x0, gs.y0, p.x, p.y); gs.previa = true; programarCapa(); return; }
    if (gs.modo === 'CIRCULO') {
      const ev2 = TB().desvioPorArrastre(s, gs.pid, gs.h, p.x, p.y);
      if (ev2) { gs.ev = ev2; gs.previa = true; } else TB().decir(s, 'En esta vista no se ve el plano del desvío: gire la vista (Q o E).', true);
      programarCapa();
      return;
    }
    if (gs.modo === 'EQUIPO') {
      const e = s.t.equipos.find((q) => q.id === gs.id);
      const a = TB().enNivel(s, gs.x0, gs.y0, e.posicion_mm.z);
      const b = TB().enNivel(s, p.x, p.y, e.posicion_mm.z);
      if (a && b) {
        const paso = ev.shiftKey ? 10 : 100;
        gs.destino = { x: e.posicion_mm.x + Math.round((b.x - a.x) / paso) * paso, y: e.posicion_mm.y + Math.round((b.y - a.y) / paso) * paso, z: e.posicion_mm.z };
      }
      programarCapa();
      return;
    }
    if (gs.modo === 'MOVER') {
      const r = TB().desplazamientoSegmento(s, gs.id, gs.x0, gs.y0, p.x, p.y);
      if (r.error) { TB().decir(s, r.error, true); gs.w = null; } else { gs.w = r.w; gs.mm = r.mm; }
      programarCapa();
      return;
    }
    if (gs.modo === 'TRAZO') programarCapa();
  }
  function alSubir(ev) {
    const s = ui.s;
    ui.punteros.delete(ev.pointerId);
    const gs = ui.gesto;
    if (!gs) return;
    if (gs.modo === 'PELLIZCO') { if (!ui.punteros.size) ui.gesto = null; return; }
    ui.gesto = null;
    const p = local(ev);
    if (gs.modo === 'TRAZO') {
      if (gs.nuevo && !gs.movio) { TB().decir(s, `${s.msg} Mueva el puntero y haga clic, o teclee el largo y Entrar. Esc termina.`, false); pintarEstado(); programarCapa(); return; }
      if (TB().confirmar(s, p.x, p.y, p.tactil)) cambio(); else { pintarEstado(); programarCapa(); }
      return;
    }
    if (gs.modo === 'ROMBO' || gs.modo === 'CIRCULO' || gs.modo === 'AMBOS') {
      if (gs.previa && TB().moverManguera(s, gs.pid, gs.h, gs.ev)) cambio(); else { pintarEstado(); programarCapa(); }
      return;
    }
    if (gs.modo === 'EQUIPO') {
      if (gs.movio && gs.destino) { if (TB().moverEquipo(s, gs.id, { posicion_mm: gs.destino })) cambio(); else { pintarEstado(); dibujarLienzo(); } return; }
      seleccionar(gs.hit);
      return;
    }
    if (gs.modo === 'MOVER') {
      if (gs.movio && gs.w && TB().moverSegmento(s, gs.id, gs.w)) cambio(); else { if (!gs.movio) seleccionar(gs.hit); pintarEstado(); dibujarLienzo(); }
      return;
    }
    if (gs.movio || gs.soloToque) { pintarEstado(); return; }
    tocarCon(gs.hit, p);
  }
  function alCancelar(ev) {
    ui.punteros.delete(ev.pointerId);
    ui.gesto = null;
    programarCapa();
  }
  function alSalir() {
    if (!ui.gesto && ui.hover) { ui.hover = null; dibujarLienzo(); }
    if (!ui.gesto && !ui.s.traza) { ui.puntero = null; programarCapa(); }
  }
  function alRueda(ev) {
    ev.preventDefault();
    const p = local(ev);
    TB().zoom(ui.s, Math.pow(1.0015, -Math.max(-400, Math.min(400, ev.deltaY))), p.x, p.y);
    dibujarLienzo();
  }
  /** Un toque sin arrastre, según la herramienta. */
  function tocarCon(hit, p) {
    const s = ui.s;
    const T = TB();
    let ok = null;
    switch (s.herr) {
      case 'EQUIPO': ok = T.colocarEquipo(s, s.tipoEquipo, p.x, p.y); break;
      case 'TOMA': ok = T.ponerToma(s, p.x, p.y, p.tactil); break;
      case 'MANGUERA':
      case 'BRIDA':
        if (hit && (hit.tipo === 'PUERTO' || hit.tipo === 'PT')) ok = T.acoplar(s, hit.id, s.herr);
        else ok = T.decir(s, 'Toque una toma.', true);
        break;
      case 'REDUCCION': ok = T.reducirEn(s, hit); break;
      case 'COMPUERTA': ok = T.compuertaEn(s, hit); break;
      case 'MEDIR': T.medir(s, hit, p.x, p.y); pintarEstado(); programarCapa(); return;
      case 'BORRAR': ok = T.borrar(s, hit && { tipo: hit.tipo, id: hit.id }, ui.mayus); break;
      default: seleccionar(hit); return;
    }
    if (ok) cambio(); else { pintarEstado(); dibujarLienzo(); }
  }
  function seleccionar(hit) {
    const s = ui.s;
    s.sel = !hit ? null : hit.tipo === 'PT' ? { tipo: 'PUERTO', id: hit.id } : { tipo: hit.tipo, id: hit.id };
    TB().decir(s, '', false);
    pintar();
  }

  /* ------------------------------------------------------------------ teclado (§4.4) */

  const escribiendo = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  function alTecla(ev) {
    if (!ui.abierto) return;
    const s = ui.s;
    const T = TB();
    const k = ev.key;
    if (k === 'Shift' || k === 'Alt') { ui.mayus = ev.shiftKey; T.teclasSostenidas(s, ev.shiftKey, ev.altKey); programarCapa(); return; }
    if (escribiendo(ev.target)) return;
    const enBoton = ev.target && /^(BUTTON|A|SUMMARY)$/.test(ev.target.tagName);
    if ((k === ' ' || k === 'Enter') && enBoton) return;
    if (k === ' ' && !s.caja) { ui.espacio = true; ev.preventDefault(); return; }
    const hecho = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.ctrlKey || ev.metaKey) {
      const kk = k.toLowerCase();
      if (kk === 'z' && !ev.shiftKey) { hecho(); T.deshacer(s); cambio(); } else if (kk === 'y' || (kk === 'z' && ev.shiftKey)) { hecho(); T.rehacer(s); cambio(); }
      return;
    }
    if (k === 'Escape') { if (T.cancelar(s)) { hecho(); pintar(); } return; }
    if (s.traza) {
      const fija = { ArrowUp: 'Z', ArrowRight: 'X', ArrowLeft: 'Y', h: 'H', H: 'H', v: 'V', V: 'V' }[k];
      if (fija) { hecho(); T.fijar(s, fija); pintarEstado(); programarCapa(); return; }
      if (k === 'Tab') { hecho(); T.siguienteOpcion(s); programarCapa(); return; }
      if (k === 'Enter') {
        hecho();
        const p = ui.puntero || P(s.traza.P0);
        if (T.confirmar(s, p.x, p.y, p.tactil)) cambio(); else { pintarEstado(); programarCapa(); }
        return;
      }
      if (T.teclear(s, k)) { hecho(); pintarEstado(); programarCapa(); return; }
    }
    if (k === '[' || k === ']') { hecho(); T.cambiarDiametroActivo(s, k === ']' ? 1 : -1); pintarEstado(); pintarBarraD(); programarCapa(); return; }
    const sel = s.sel;
    const eq = sel && sel.tipo === 'EQUIPO' ? s.t.equipos.find((e) => e.id === sel.id) : null;
    if (eq) {
      const paso = ev.altKey ? 1 : ev.shiftKey ? 10 : 100;
      const mov = { ArrowRight: { dx: paso }, ArrowLeft: { dx: -paso }, ArrowUp: { dy: paso }, ArrowDown: { dy: -paso }, PageUp: { dz: 100 }, PageDown: { dz: -100 } }[k];
      if (mov) { hecho(); if (T.moverEquipo(s, eq.id, mov)) cambio(); else pintarEstado(); return; }
      if (k === 'r' || k === 'R') { hecho(); if (T.moverEquipo(s, eq.id, { giro: ev.shiftKey ? 90 : 15 })) cambio(); else pintarEstado(); return; }
    }
    if (k === 'PageUp' || k === 'PageDown') { hecho(); T.cambiarNivel(s, k === 'PageUp' ? 1 : -1); dibujarLienzo(); return; }
    if (k === 'Delete' || k === 'Backspace') { hecho(); if (T.borrar(s, sel, ev.shiftKey)) cambio(); else pintarEstado(); return; }
    if (k === 'Enter' && sel) { const campo = $('#ti-inspector input, #ti-inspector select'); if (campo) { hecho(); campo.focus(); } return; }
    const mover = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[k];
    if (mover) { hecho(); T.desplazar(s, mover[0], mover[1]); dibujarLienzo(); return; }
    if (k === '+' || k === '=') { hecho(); T.zoom(s, 1.25); dibujarLienzo(); return; }
    if (k === '-' || k === '_') { hecho(); T.zoom(s, 0.8); dibujarLienzo(); return; }
    if (k === 'q' || k === 'Q' || k === 'e' || k === 'E') { hecho(); T.girarVista(s, k.toLowerCase() === 'e' ? 1 : -1); pintar(); return; }
    if (['1', '2', '3', '4'].includes(k)) { hecho(); T.ponerVista(s, VISTAS_BTN[Number(k) - 1][0] === 'NE' ? (/^(NE|SE|SO|NO)$/.test(s.vista) ? s.vista : 'NE') : VISTAS_BTN[Number(k) - 1][0]); pintar(); return; }
    // F: con una toma seleccionada, manguera; si no, encuadrar. B: brida a la toma seleccionada
    const toma = sel && sel.tipo === 'PUERTO' && s.g.puertos.has(sel.id) && s.g.puertos.get(sel.id).puerto.rol === 'TOMA';
    if ((k === 'f' || k === 'F') && toma) { hecho(); if (T.acoplar(s, sel.id, 'MANGUERA')) cambio(); else pintarEstado(); return; }
    if ((k === 'b' || k === 'B') && toma) { hecho(); if (T.acoplar(s, sel.id, 'BRIDA')) cambio(); else pintarEstado(); return; }
    if (k === 'f' || k === 'F' || k === '0') { hecho(); T.encuadrar(s); dibujarLienzo(); return; }
    const herr = TECLA_HERR[k.toLowerCase()];
    if (herr) { hecho(); T.elegir(s, herr); pintar(); }
  }
  function alSoltarTecla(ev) {
    if (!ui.abierto) return;
    if (ev.key === ' ') ui.espacio = false;
    if (ev.key === 'Shift' || ev.key === 'Alt') { ui.mayus = ev.shiftKey; TB().teclasSostenidas(ui.s, ev.shiftKey, ev.altKey); programarCapa(); }
  }

  /* ------------------------------------------------------------------ paleta */

  const MOTIVO_APAGADO = {
    t90: (s) => (s.t.politicas.permite_t_90 ? 'La T a 90° sale sola al trazar un ramal a 90° (esta política la permite); COTIZAP todavía no la cotiza.' : 'El taller no hace T a 90° en este servicio: use un injerto a 30° o 45°.'),
    pantalon: () => 'El taller retiró el pantalón: use un injerto.',
    tapa: () => 'Un extremo libre queda abierto (aviso EXTREMO_ABIERTO) hasta llevarlo a un equipo o a la boca. La tapa, para dejar una preparación cerrada, llega después.',
  };
  function contar(id) {
    const s = ui.s;
    const pz = s.g.piezas;
    return {
      COLECTOR: s.t.equipos.filter((e) => e.tipo === 'COLECTOR').length, MAQUINA: s.t.equipos.filter((e) => e.tipo === 'MAQUINA').length, CAMPANA: s.t.equipos.filter((e) => e.tipo === 'CAMPANA').length,
      VENTILADOR: s.t.equipos.filter((e) => e.tipo === 'VENTILADOR').length, TOMA: [...s.g.puertos.values()].filter((p) => p.puerto.rol === 'TOMA').length,
      MANGUERA: s.t.tramos.filter((t) => t.tipo === 'FLEXIBLE').length, BRIDA: [...s.g.puertos.values()].filter((p) => p.puerto.rol === 'TOMA' && p.puerto.acople && p.puerto.acople.tipo === 'BRIDA').length,
      TRAMO: s.t.tramos.filter((t) => t.tipo === 'RIGIDO').length, VERTICAL: s.t.tramos.filter((t) => t.tipo === 'RIGIDO' && s.g.seg.get(t.id).dir && Math.abs(s.g.seg.get(t.id).dir.elevacion_deg) === 90).length,
      REDUCCION: pz.filter((p) => p.tipo === 'REDUCCION' || p.tipo === 'ADAPTADOR').length, INJERTO: pz.filter((p) => p.tipo === 'INJERTO').length, RINJ: pz.filter((p) => p.tipo === 'REDUCCION_INJERTO').length,
      T90: pz.filter((p) => p.tipo === 'T_90').length,
      COMPUERTA: pz.filter((p) => p.tipo === 'COMPUERTA').length,
    }[id] || 0;
  }
  function pintarPaleta() {
    const el = $('#ti-paleta');
    if (!el) return;
    const s = ui.s;
    const activo = (b) => (b.herr === 'EQUIPO' ? s.herr === 'EQUIPO' && s.tipoEquipo === b.tipo : s.herr === b.herr);
    W.reemplazar(el, ...PALETA.map((gr) => h('div', { class: 'ti-grupo', role: 'group', 'aria-label': gr.grupo },
      h('div', { class: 'ti-grupo-tit' }, gr.grupo),
      gr.bloques.map((b) => {
        const n = contar(b.id);
        const apagado = b.apagado ? MOTIVO_APAGADO[b.apagado](s) : null;
        return h('button', {
          type: 'button', class: `ti-bloque${activo(b) ? ' ti-bloque-activo' : ''}${apagado ? ' ti-bloque-apagado' : ''}`, id: `ti-b-${b.id.toLowerCase()}`, 'aria-pressed': activo(b) ? 'true' : 'false',
          'aria-disabled': apagado ? 'true' : null, title: apagado || `${b.nombre}${b.tecla ? ` (${b.tecla})` : ''}: ${TB().AYUDA[b.herr] || ''}`, 'data-bloque': b.id,
          onclick: () => {
            if (apagado) { TB().decir(s, apagado, false); pintarEstado(); return; }
            if (b.herr === 'EQUIPO') s.tipoEquipo = b.tipo;
            TB().elegir(s, b.herr);
            if (b.herr === 'EQUIPO') TB().decir(s, `${b.nombre}: toque el piso donde va (o arrástrelo desde aquí al lienzo).`, false);
            pintar();
          },
          onpointerdown: (ev) => { if (b.herr === 'EQUIPO' && !apagado && ev.button === 0) empezarArrastrePaleta(ev, b.tipo); },
        }, icono(b.id), h('span', { class: 'ti-bloque-txt' }, b.nombre), b.tecla ? h('kbd', { class: 'ti-tecla', 'aria-hidden': 'true' }, b.tecla) : null,
        apagado ? h('span', { class: 'ti-candado', 'aria-hidden': 'true', html: ico(ICONOS.candado) }) : h('span', { class: `ti-n${n ? '' : ' ti-n-0'}`, 'aria-hidden': 'true' }, String(n)));
      }))));
  }
  /** Arrastrar un equipo de la paleta al lienzo (§1.1 paso 1). */
  function empezarArrastrePaleta(ev, tipo) {
    ui.paleta = { tipo, sobre: false, x0: ev.clientX, y0: ev.clientY, movio: false };
    const mover = (e) => {
      if (!ui.paleta) return;
      if (Math.hypot(e.clientX - ui.paleta.x0, e.clientY - ui.paleta.y0) > 6) ui.paleta.movio = true;
      const el = $('#ti-lienzo');
      const r = el.getBoundingClientRect();
      ui.paleta.sobre = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (ui.paleta.sobre) { ui.puntero = local(e); programarCapa(); }
    };
    const soltar = (e) => {
      document.removeEventListener('pointermove', mover);
      document.removeEventListener('pointerup', soltar);
      const pal = ui.paleta;
      ui.paleta = null;
      if (pal && pal.movio && pal.sobre) {
        const p = local(e);
        if (TB().colocarEquipo(ui.s, tipo, p.x, p.y)) cambio(); else pintarEstado();
      } else programarCapa();
    };
    document.addEventListener('pointermove', mover);
    document.addEventListener('pointerup', soltar);
  }

  /* ------------------------------------------------------------------ fases */

  function pintarFases() {
    const el = $('#ti-fases');
    if (!el) return;
    const s = ui.s;
    const fs = TB().fases(s);
    W.reemplazar(el,
      h('ol', { class: 'ti-fases-lista' }, fs.map((f) => h('li', null, h('button', {
        type: 'button', class: `ti-fase${s.fase === f.indice ? ' ti-fase-activa' : ''}`, id: `ti-fase-${f.indice}`, 'aria-current': s.fase === f.indice ? 'step' : null,
        title: f.notas.length ? f.notas.slice(0, 4).join(' · ') : 'Sin pendientes',
        onclick: () => { TB().irFase(s, f.indice); s.sel = null; pintar(); },
      }, h('span', { class: 'ti-fase-num', 'aria-hidden': 'true' }, String(f.indice + 1)), h('span', { class: 'ti-fase-txt' }, f.nombre),
      f.pendientes ? h('span', { class: 'ti-fase-n', 'aria-label': `${f.pendientes} pendiente${f.pendientes > 1 ? 's' : ''}` }, String(f.pendientes)) : null)))),
      h('button', { type: 'button', class: 'btn btn-sec ti-siguiente', id: 'ti-siguiente', title: 'Ir a la siguiente fase con algo pendiente', onclick: () => { TB().irFase(s, s.fase, true); s.sel = null; pintar(); } }, 'Siguiente ▶'));
  }

  /* ------------------------------------------------------------------ inspector */

  const campo = (etq, control, nota) => h('div', { class: 'campo ti-campo' }, h('label', { for: control.id }, etq), control, nota ? h('span', { class: 'nota' }, nota) : null);
  /** Un campo que ocupa todo el renglón (textos largos y selectores con nombres largos). */
  const campoAncho = (etq, control, nota) => { const c = campo(etq, control, nota); c.classList.add('ti-campo-ancho'); return c; };
  /** 0.00001813 → 1.813×10⁻⁵ */
  const cientifico = (x) => {
    const e = Math.floor(Math.log10(Math.abs(x)));
    const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    return `${W.num(x / 10 ** e, 3)}×10${sup}`;
  };
  function entrada(id, valor, alCambiar, attrs) {
    const el = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: valor === null || valor === undefined ? '' : String(valor), ...attrs });
    // se aplica una vez: al volver a pintar el inspector, el campo se va y su «change» al perder el foco ya no cuenta
    const aplicar = () => { if (el.value === el.defaultValue) return; el.defaultValue = el.value; alCambiar(el.value); };
    el.addEventListener('change', aplicar);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); aplicar(); } });
    return el;
  }
  function selector(id, opciones, valor, alCambiar, etiqueta) {
    const el = h('select', { id, 'aria-label': etiqueta }, opciones.map(([v, t]) => h('option', { value: String(v), selected: String(v) === String(valor) }, t)));
    el.addEventListener('change', () => alCambiar(el.value));
    return el;
  }
  const num = (txt) => W.leerNumero(txt);
  /** Aplica un cambio del modelo desde el inspector: con deshacer y su mensaje; si se rechaza, lo dice. */
  function aplicar(fn, msg) {
    if (TB().hacer(ui.s, fn, msg)) cambio(); else { pintarEstado(); pintarInspector(); }
  }
  const diametros = () => ui.s.t.politicas.diametros_comerciales_in.map((d) => [d, `${pulg(d)} · ${n0(d * IN)} mm`]);
  const velocidad = (Q, D) => (Q === null || Q === undefined ? null : Q / 3600 / ((Math.PI * Math.pow((D * IN) / 1000, 2)) / 4));
  function semaforoV(Q, D) {
    const s = ui.s;
    const v = velocidad(Q, D);
    if (v === null) return null;
    const pol = s.t.politicas;
    const ok = v >= pol.velocidad_min_m_s - 1e-9 && v <= pol.velocidad_max_m_s + 1e-9;
    const com = pol.diametros_comerciales_in.filter((d) => velocidad(Q, d) >= pol.velocidad_min_m_s - 1e-9);
    const mejor = com.length ? com[com.length - 1] : pol.diametros_comerciales_in[0];
    return h('p', { class: `ti-semaforo ${ok ? 'ti-sem-verde' : 'ti-sem-ambar'}` }, `${W.num(v, 1)} m/s ${ok ? '✓' : `(de ${pol.velocidad_min_m_s} a ${pol.velocidad_max_m_s})`}${!ok && mejor !== D ? ` · Con ${pulg(mejor)}: ${W.num(velocidad(Q, mejor), 1)} m/s` : ''}`);
  }
  const titulo = (t, sub) => h('div', { class: 'ti-ins-tit' }, h('h3', null, t), sub ? h('p', { class: 'ti-ins-sub' }, sub) : null);

  function inspectorEquipo(e) {
    const s = ui.s;
    const T = TZ();
    const mov = (c) => { if (TB().moverEquipo(s, e.id, c)) cambio(); else pintarEstado(); };
    const caja = (k) => entrada(`ti-e-${k}`, e.caja_mm[k], (v) => aplicar((t) => T.editarEquipo(t, M(), e.id, { caja_mm: { ...e.caja_mm, [k]: num(v) } }), `Caja de ${e.nombre}: ${k} ${v} mm.`));
    const cara = h('select', { id: 'ti-nt-cara', 'aria-label': 'Cara de la caja' }, [['SUP', 'Cara superior'], ['PX', 'Cara +X'], ['NX', 'Cara −X'], ['PY', 'Cara +Y'], ['NY', 'Cara −Y']].map(([v, t]) => h('option', { value: v }, t)));
    const ca = h('input', { id: 'ti-nt-a', type: 'text', inputmode: 'decimal', value: '0', 'aria-label': 'Primera coordenada sobre la cara (mm desde el centro)' });
    const cb = h('input', { id: 'ti-nt-b', type: 'text', inputmode: 'decimal', value: '0', 'aria-label': 'Segunda coordenada sobre la cara (mm desde el centro)' });
    const nuevaToma = () => {
      const a = num(ca.value) || 0;
      const b = num(cb.value) || 0;
      const L = e.caja_mm.largo / 2;
      const A = e.caja_mm.ancho / 2;
      const H = e.caja_mm.alto;
      const q = { SUP: { x: a, y: b, z: H }, PX: { x: L, y: a, z: H / 2 + b }, NX: { x: -L, y: a, z: H / 2 + b }, PY: { x: a, y: A, z: H / 2 + b }, NY: { x: a, y: -A, z: H / 2 + b } }[cara.value];
      const rol = e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? 'ENTRADA' : 'TOMA';
      const m = TB().hacer(s, (t) => T.agregarPuerto(t, M(), e.id, { rol, posicion_local_mm: q, diametro_in: s.D }), `Se agregó ${rol === 'ENTRADA' ? 'la boca' : 'la toma'} a ${e.nombre}.`);
      if (m) { s.sel = { tipo: 'PUERTO', id: m.equipos.find((x) => x.id === e.id).puertos.slice(-1)[0].id }; cambio(); } else pintarEstado();
    };
    return h('section', { class: 'ti-ins' },
      titulo(e.nombre, `${{ COLECTOR: 'Colector', MAQUINA: 'Máquina', CAMPANA: 'Campana', VENTILADOR: 'Ventilador' }[e.tipo]} ${e.id}`),
      h('div', { class: 'ti-rejilla-campos' },
        campo('Nombre', entrada('ti-e-nombre', e.nombre, (v) => aplicar((t) => T.editarEquipo(t, M(), e.id, { nombre: v }), `Nombre: ${v}.`), { inputmode: 'text' })),
        campo('X (mm)', entrada('ti-e-x', e.posicion_mm.x, (v) => mov({ posicion_mm: { ...e.posicion_mm, x: num(v) } }))),
        campo('Y (mm)', entrada('ti-e-y', e.posicion_mm.y, (v) => mov({ posicion_mm: { ...e.posicion_mm, y: num(v) } }))),
        campo('Z de la base (mm)', entrada('ti-e-z', e.posicion_mm.z, (v) => mov({ posicion_mm: { ...e.posicion_mm, z: num(v) } }))),
        campo('Giro (°, cada 15)', entrada('ti-e-giro', e.rotacion_z_deg, (v) => mov({ giro: num(v) - e.rotacion_z_deg }))),
        campo('Largo (mm)', caja('largo')), campo('Ancho (mm)', caja('ancho')), campo('Alto (mm)', caja('alto')),
        e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? campo('Pérdida propia (Pa)', entrada('ti-e-perdida', e.perdida_Pa, (v) => aplicar((t) => T.editarEquipo(t, M(), e.id, { perdida_Pa: v === '' ? null : num(v) }), 'Pérdida del equipo.'))) : null),
      h('p', { class: 'ti-nota' }, 'Flechas: 100 mm (Mayús 10, Alt 1) · RePág/AvPág sube o baja · R gira 15° (Mayús+R 90°). Arrástrelo con «Seleccionar».'),
      h('h4', null, e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? 'Bocas' : 'Tomas'),
      e.puertos.length ? h('ul', { class: 'ti-lista' }, e.puertos.map((p) => h('li', null, h('button', { type: 'button', class: 'enlace', onclick: () => { s.sel = { tipo: 'PUERTO', id: p.id }; pintar(); } },
        `${p.id} · ${p.nombre} · ${pulg(p.diametro_in)}${p.caudal_m3_h ? ` · ${n0(p.caudal_m3_h)} m³/h` : ''}${p.acople ? ` · ${p.acople.tipo === 'BRIDA' ? 'brida' : 'manguera'}` : ' · sin acople'}`)))) : h('p', { class: 'ti-nota' }, 'Sin tomas: use «Toma» (P) y toque una cara de la caja, o agréguela aquí.'),
      h('div', { class: 'ti-nueva-toma' }, cara, h('label', { class: 'ti-mini' }, 'a ', ca), h('label', { class: 'ti-mini' }, 'b ', cb),
        h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-agregar-toma', onclick: nuevaToma }, `+ ${e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? 'Boca' : 'Toma'} de ${pulg(s.D)}`)),
      h('p', { class: 'ti-nota' }, 'a y b en mm desde el centro de la cara (en la cara superior, X e Y locales; en una lateral, a lo largo y en altura).'),
      h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => { if (TB().borrar(s, { tipo: 'EQUIPO', id: e.id })) cambio(); else pintarEstado(); } }, 'Quitar el equipo')));
  }

  function inspectorPuerto(pid) {
    const s = ui.s;
    const T = TZ();
    const pu = s.g.puertos.get(pid);
    const p = pu.puerto;
    const ac = p.acople;
    const toma = p.rol === 'TOMA';
    const mg = TB().mangueraDe(s, pid);
    const hijos = [
      titulo(`${toma ? 'Toma' : p.rol === 'ENTRADA' ? 'Boca' : 'Descarga'} ${pid}`, `${pu.equipo.nombre} · ${TZ().textoDireccion(pu.direccion)} · X ${n0(pu.posicion_mm.x)}, Y ${n0(pu.posicion_mm.y)}, Z ${n0(pu.posicion_mm.z)}`),
      h('div', { class: 'ti-rejilla-campos' },
        campo('Nombre', entrada('ti-p-nombre', p.nombre, (v) => aplicar((t) => T.editarPuerto(t, M(), pid, { nombre: v }), `Nombre: ${v}.`), { inputmode: 'text' })),
        campo('Ø', selector('ti-p-d', diametros(), p.diametro_in, (v) => aplicar((t) => T.editarPuerto(t, M(), pid, { diametro_in: Number(v) }), `Ø de ${pid}: ${pulg(Number(v))}.`), 'Diámetro del puerto')),
        toma ? campo('Caudal de diseño (m³/h)', entrada('ti-p-q', p.caudal_m3_h, (v) => aplicar((t) => T.editarPuerto(t, M(), pid, { caudal_m3_h: v === '' ? null : num(v) }), `Caudal de ${pid}: ${v} m³/h.`))) : null,
        toma ? campo('Coeficiente de entrada K', entrada('ti-p-k', p.coef_entrada_K, (v) => aplicar((t) => T.editarPuerto(t, M(), pid, { coef_entrada_K: num(v) }), `K de ${pid}: ${v}.`))) : null),
      toma && p.caudal_m3_h ? semaforoV(p.caudal_m3_h, p.diametro_in) : toma ? h('p', { class: 'ti-semaforo ti-sem-ambar' }, 'Escriba el caudal de diseño: sin él no se puede dimensionar.') : null,
    ];
    if (toma) {
      hijos.push(h('h4', null, 'Acople'), h('div', { class: 'ti-seg', role: 'group', 'aria-label': 'Acople de la toma' },
        h('button', { type: 'button', class: `ti-seg-btn${ac && ac.tipo === 'MANGUERA' ? ' ti-seg-activo' : ''}`, id: 'ti-acople-manguera', 'aria-pressed': ac && ac.tipo === 'MANGUERA' ? 'true' : 'false', onclick: () => { if (TB().acoplar(s, pid, 'MANGUERA')) cambio(); else pintarEstado(); } }, 'Manguera (F)'),
        h('button', { type: 'button', class: `ti-seg-btn${ac && ac.tipo === 'BRIDA' ? ' ti-seg-activo' : ''}`, id: 'ti-acople-brida', 'aria-pressed': ac && ac.tipo === 'BRIDA' ? 'true' : 'false', onclick: () => { if (TB().acoplar(s, pid, 'BRIDA')) cambio(); else pintarEstado(); } }, 'Brida (B)')));
    }
    if (mg) {
      const sem = TB().semaforoManguera(mg.r, s.t.politicas);
      const evN = norma3(mg.ev);
      const az = evN > 0.5 ? Math.round((Math.atan2(mg.ev.y, mg.ev.x) * 180) / Math.PI / 15) * 15 : 0;
      const mover = (hh, ev2) => { if (TB().moverManguera(s, pid, hh, ev2)) cambio(); else pintarEstado(); };
      const desvioVector = (e2, a2) => {
        const ut = mg.ut;
        const lat = { x: Math.cos((a2 * Math.PI) / 180), y: Math.sin((a2 * Math.PI) / 180), z: 0 };
        const d = lat.x * ut.x + lat.y * ut.y;
        const perp = { x: lat.x - ut.x * d, y: lat.y - ut.y * d, z: -ut.z * d };
        const nn = norma3(perp);
        return nn < 0.5 ? null : { x: Math.round((perp.x / nn) * e2 * 1000) / 1000, y: Math.round((perp.y / nn) * e2 * 1000) / 1000, z: Math.round((perp.z / nn) * e2 * 1000) / 1000 };
      };
      hijos.push(
        h('p', { class: `ti-semaforo ${{ VERDE: 'ti-sem-verde', AMBAR: 'ti-sem-ambar', ROJO: 'ti-sem-rojo' }[sem.color]}`, id: 'ti-manguera-sem' }, sem.texto),
        h('div', { class: 'ti-rejilla-campos' },
          campo('Altura del PT (mm)', entrada('ti-m-h', Math.round(mg.h * 1000) / 1000, (v) => mover(num(v), mg.ev))),
          campo('Desvío (mm)', entrada('ti-m-e', Math.round(evN * 1000) / 1000, (v) => { const w = desvioVector(num(v), az); if (w) mover(mg.h, w); else { TB().decir(s, 'Ese rumbo va en la dirección de la toma: arrastre el círculo.', true); pintarEstado(); } })),
          campo('Rumbo del desvío (°)', entrada('ti-m-az', az, (v) => { const w = desvioVector(evN, num(v)); if (w) mover(mg.h, w); else { TB().decir(s, 'Ese rumbo va en la dirección de la toma.', true); pintarEstado(); } }))),
        h('p', { class: 'ti-nota' }, 'Arrastre el rombo (altura sobre la toma) y el círculo (desvío): van de 50 en 50 mm. El ducto rígido empieza en el punto de transición, con extremo liso para la abrazadera.'),
        h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-trazar-desde', onclick: () => trazarDesde({ tipo: 'PT', id: pid }) }, 'Trazar desde el punto de transición')));
    } else if (ac && ac.tipo === 'BRIDA') {
      const b = ac.barrenos || {};
      const bar = (k, etq) => campo(etq, entrada(`ti-b-${k}`, b[k] === undefined ? '' : b[k], (v) => {
        const nb = { numero: b.numero || 0, circulo_mm: b.circulo_mm || 0, diametro_mm: b.diametro_mm || 0, [k]: k === 'numero' ? Math.round(num(v)) : num(v) };
        aplicar((t) => T.editarPuerto(t, M(), pid, { barrenos: nb }), 'Barrenos de la brida.');
      }));
      hijos.push(h('p', { class: 'ti-nota' }, toma ? 'El ducto sale alineado con el cuello de la toma: es un punto fijo. Si su Ø no es el de la toma, sale un adaptador.' : 'La boca del colector va con brida y es un punto fijo.'),
        h('div', { class: 'ti-rejilla-campos' }, bar('numero', 'Barrenos'), bar('circulo_mm', 'Círculo (mm)'), bar('diametro_mm', 'Ø barreno (mm)')),
        h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-trazar-desde', onclick: () => trazarDesde({ tipo: 'PUERTO', id: pid }) }, toma ? 'Trazar desde la toma' : 'Trazar desde la boca')));
    } else if (toma) hijos.push(h('p', { class: 'ti-semaforo ti-sem-ambar' }, 'Sin acople: elija manguera o brida para poder trazar desde aquí.'));
    hijos.push(h('div', { class: 'ti-acciones' },
      h('button', { type: 'button', class: 'btn btn-sec', onclick: () => { s.sel = { tipo: 'EQUIPO', id: pu.equipo.id }; pintar(); } }, `Ver ${pu.equipo.nombre}`),
      mg && !mg.conDucto ? h('button', { type: 'button', class: 'btn btn-sec', onclick: () => aplicar((t) => T.desacoplar(t, M(), pid), `Se quitó la manguera de ${pid}.`) }, 'Quitar la manguera') : null,
      h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => { if (TB().borrar(s, { tipo: 'PUERTO', id: pid }, true)) cambio(); else pintarEstado(); } }, toma ? 'Quitar la toma' : 'Quitar la boca')));
    return h('section', { class: 'ti-ins' }, ...hijos);
  }
  /** «Trazar desde aquí» sin arrastrar (teclado): empieza el trazo; luego ↑ → ← H V, el largo y Entrar. */
  function trazarDesde(hit) {
    const s = ui.s;
    if (!['TRAMO', 'VERTICAL'].includes(s.herr)) s.herr = 'TRAMO';
    if (TB().empezar(s, hit)) {
      ui.puntero = null;
      TB().decir(s, `${s.msg} Teclee la dirección (↑ → ← o @rumbo) y el largo, y Entrar.`, false);
      pintar();
      const l = $('#ti-lienzo');
      if (l) l.focus({ preventScroll: true });
    } else pintarEstado();
  }

  /** El renglón de la hoja de cálculo de un tramo (en la salida). */
  function bloqueCalculo(id) {
    const fc = TB().filaCalculo(ui.s, id);
    if (!fc) return null;
    return h('dl', { class: 'ti-datos ti-calc-tramo', id: 'ti-calc-tramo' },
      h('dt', null, 'Cálculo'), h('dd', null, `${n0(fc.caudal_m3_h)} m³/h · ${W.num(fc.velocidad_m_s, 1)} m/s · pv ${n0(fc.presion_dinamica_Pa)} Pa`),
      h('dt', null, 'Fricción'), h('dd', null, `${W.num(fc.perdida_friccion_Pa, 1)} Pa (f ${W.num(fc.factor_friccion, 4)}, Re ${n0(fc.reynolds)})`),
      h('dt', null, 'Locales'), h('dd', null, fc.locales.length ? fc.locales.map((l) => `${l.texto}: ${W.num(l.Pa, 1)} Pa`).join('; ') : '—'),
      h('dt', null, 'Succión al final'), h('dd', null, `${n0(fc.presion_estatica_Pa)} Pa`));
  }

  function inspectorTramo(id) {
    const s = ui.s;
    const T = TZ();
    const info = TB().infoTramo(s, id);
    const t = s.g.tramos.get(id);
    const calc = s.fase === 5 ? bloqueCalculo(id) : null;
    if (info.tipo === 'FLEXIBLE') {
      const pid = s.g.puertoDeNodo.get(t.a);
      return h('section', { class: 'ti-ins' }, titulo(`Manguera ${id}`, `de la toma ${pid}`), h('p', { class: `ti-semaforo ${{ VERDE: 'ti-sem-verde', AMBAR: 'ti-sem-ambar', ROJO: 'ti-sem-rojo' }[info.manguera.color]}` }, info.manguera.texto),
        calc,
        h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', onclick: () => { s.sel = { tipo: 'PUERTO', id: pid }; pintar(); } }, 'Mover sus tiradores')));
    }
    const candado = h('input', { type: 'checkbox', id: 'ti-t-candado', checked: info.bloqueado });
    candado.addEventListener('change', () => aplicar((m) => T.cambiarDiametro(m, M(), id, info.diametro_in, { bloquear: candado.checked }), candado.checked ? `${id}: Ø con candado.` : `${id}: Ø sin candado.`));
    return h('section', { class: 'ti-ins' },
      titulo(`Tramo ${id}`, `${info.direccion}${info.sentido ? ` · aire ${info.sentido}` : ' · sin sentido todavía'}`),
      h('div', { class: 'ti-rejilla-campos' },
        campo('Ø', selector('ti-t-d', diametros(), info.diametro_in, (v) => {
          const r = TB().cambiarDiametroTramo(s, id, Number(v));
          if (r.ok) { cambio(); return; }
          ui.alternativa = r.alternativa ? { texto: r.alternativa.texto, hacer: () => TB().cambiarDiametroEnCadena(s, id, Number(v)) } : null;
          pintarEstado();
          pintarInspector();
        }, 'Diámetro del tramo')),
        h('label', { class: 'ti-check', for: 'ti-t-candado', title: 'El dimensionamiento por caudal no cambia un Ø con candado' }, candado, h('span', { html: ico(ICONOS.candado) }), 'Candado'),
        campo('Largo a ejes (m)', entrada('ti-t-largo', Math.round(info.largo_mm) / 1000, (v) => {
          const L = TB().leerCaja(v).largo;
          if (L === undefined) { TB().decir(s, 'Escriba el largo en m (3.25) o en mm (3250mm).', true); pintarEstado(); return; }
          aplicar((m) => T.cambiarLargo(m, M(), id, L), (m) => `${id}: ${metros(L)}${m.ultimo.compensacion && m.ultimo.compensacion.length ? `; se compensó en ${m.ultimo.compensacion.map((c) => `${c.tramo} (${c.delta_mm > 0 ? '+' : ''}${n0(c.delta_mm)} mm)`).join(', ')}` : ''}.`);
        }))),
      info.corto ? h('div', { class: 'ti-corto' },
        h('p', { class: `ti-semaforo ${info.corto.decision ? 'ti-sem-verde' : 'ti-sem-ambar'}` }, `Tramo corto: ${W.num(Math.max(0, info.corto.neta), 0)} mm de recto ${info.corto.piezas.length > 1 ? `entre ${info.corto.piezas.join(' y ')}` : `después de ${info.corto.piezas[0]}`} (mínimo ${s.t.politicas.recto_min_entre_accesorios_mm} mm).`),
        h('div', { class: 'ti-seg', role: 'group', 'aria-label': 'Qué se hace con el tramo corto' },
          info.corto.dosLados ? h('button', { type: 'button', class: `ti-seg-btn${info.corto.decision === 'PEGAR' ? ' ti-seg-activo' : ''}`, id: 'ti-corto-pegar', 'aria-pressed': info.corto.decision === 'PEGAR' ? 'true' : 'false', onclick: () => { if (TB().decidirCorto(s, id, 'PEGAR')) cambio(); else pintarEstado(); } }, 'Pegar las piezas') : null,
          h('button', { type: 'button', class: `ti-seg-btn${info.corto.decision === 'ACEPTAR' ? ' ti-seg-activo' : ''}`, id: 'ti-corto-aceptar', 'aria-pressed': info.corto.decision === 'ACEPTAR' ? 'true' : 'false', onclick: () => { if (TB().decidirCorto(s, id, 'ACEPTAR')) cambio(); else pintarEstado(); } }, 'Tramo corto con bridas'),
          info.corto.decision ? h('button', { type: 'button', class: 'ti-seg-btn', id: 'ti-corto-quitar', onclick: () => { if (TB().decidirCorto(s, id, null)) cambio(); else pintarEstado(); } }, 'Sin decidir') : null),
        h('p', { class: 'ti-nota' }, 'Pegar: las piezas se arman unidas con el recto que queda (soldadas, o engargoladas en galvanizado), sin bridas en esas caras.')) : null,
      h('dl', { class: 'ti-datos' },
        h('dt', null, 'Neta'), h('dd', null, `${metros(Math.round(info.neta_mm))}${info.descuentos.length ? ` = ${metros(Math.round(info.largo_mm))} − ${info.descuentos.map((d) => `${W.num(d.mm / 1000, 3)} ${d.pieza}`).join(' − ')}` : ''}`),
        h('dt', null, 'Caudal'), h('dd', null, info.caudal === null ? '—' : `${n0(info.caudal)} m³/h`),
        h('dt', null, 'Velocidad'), h('dd', { class: info.caudal ? (info.semaforo === 'AMBAR' ? 'ti-sem-ambar' : info.semaforo === 'VERDE' ? 'ti-sem-verde' : '') : '' },
          info.velocidad === null ? '—' : !info.caudal ? '— (no le llega aire de ninguna toma)' : `${W.num(info.velocidad, 1)} m/s ${info.semaforo === 'VERDE' ? '✓' : `(de ${s.t.politicas.velocidad_min_m_s} a ${s.t.politicas.velocidad_max_m_s})`}`),
        h('dt', null, 'Material'), h('dd', null, `${info.material} cal. ${info.calibre}`)),
      calc,
      h('div', { class: 'ti-acciones' },
        h('button', { type: 'button', class: 'btn btn-sec', onclick: () => { TB().elegir(s, 'MOVER'); TB().decir(s, `Arrastre ${id} de lado para moverlo.`, false); pintar(); } }, 'Mover segmento (M)'),
        h('button', { type: 'button', class: 'btn btn-peligro', id: 'ti-borrar-tramo', onclick: () => { if (TB().borrar(s, { tipo: 'TRAMO', id })) cambio(); else pintarEstado(); } }, 'Borrar (Supr)'),
        h('button', { type: 'button', class: 'btn btn-peligro', onclick: () => { if (TB().borrar(s, { tipo: 'TRAMO', id }, true)) cambio(); else pintarEstado(); } }, 'Borrar el ramal (Mayús+Supr)')));
  }

  function inspectorNodo(nid) {
    const s = ui.s;
    const T = TZ();
    const nd = s.t.nodos.find((x) => x.id === nid);
    const pz = TB().piezasDe(s, nid);
    const codo = pz.find((p) => p.tipo === 'CODO');
    const compuerta = pz.find((p) => p.tipo === 'COMPUERTA');
    const inf = compuerta ? TB().informeCalculo(s) : null;
    const cierre = inf && !inf.error ? (inf.balance.map((b) => b.cierre).find((c) => c && c.pieza === compuerta.id) || null) : null;
    const ancla = h('input', { type: 'checkbox', id: 'ti-n-ancla', checked: nd.ancla });
    ancla.addEventListener('change', () => aplicar((m) => T.anclar(m, M(), nid, ancla.checked), ancla.checked ? `${nid} anclado: es un punto fijo.` : `${nid} suelto.`));
    const libre = (s.g.ady.get(nid) || []).length === 1;
    let agregar = null;
    if (libre) {
      const ops = TZ().candidatas(s.t, M(), nid);
      const dir = h('select', { id: 'ti-n-dir', 'aria-label': 'Dirección del tramo nuevo' }, ops.map((o, i) => h('option', { value: String(i) }, `${TZ().textoDireccion(o.direccion)}${o.pieza === 'CODO' ? ` · codo de ${o.giro_deg}°` : ''}`)));
      const largo = h('input', { id: 'ti-n-largo', type: 'text', inputmode: 'decimal', value: '1', 'aria-label': 'Largo del tramo nuevo (m)' });
      const ok = () => {
        const L = TB().leerCaja(largo.value).largo;
        const o = ops[Number(dir.value)];
        if (L === undefined || !o) { TB().decir(s, 'Elija la dirección y escriba el largo.', true); pintarEstado(); return; }
        const m = TB().hacer(s, (t) => T.trazar(t, M(), nid, { direccion: o.direccion, largo_mm: L, diametro_in: s.D }), (mm) => `Tramo ${mm.ultimo.tramos[0]}: ${metros(L)} en ${TZ().textoDireccion(o.direccion)}.`);
        if (m) { s.sel = { tipo: 'NODO', id: m.ultimo.nodo }; cambio(); } else pintarEstado();
      };
      largo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } });
      agregar = h('div', { class: 'ti-agregar' }, h('h4', null, 'Agregar un tramo desde aquí'), ops.length ? h('div', { class: 'ti-rejilla-campos' }, campo('Dirección', dir), campo('Largo (m)', largo), h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-n-agregar', onclick: ok }, `Agregar de ${pulg(s.D)}`)) : h('p', { class: 'ti-nota' }, TZ().textoCandidatas(nid, ops)));
    }
    return h('section', { class: 'ti-ins' },
      titulo(`Nodo ${nid}`, `X ${n0(nd.posicion_mm.x)}, Y ${n0(nd.posicion_mm.y)}, Z ${n0(nd.posicion_mm.z)}`),
      pz.length ? h('ul', { class: 'ti-lista' }, pz.map((p) => h('li', null, `${p.id} · ${p.nombre}`))) : h('p', { class: 'ti-nota' }, libre ? 'Extremo libre: siga el trazo desde aquí o llévelo a un equipo.' : 'Sin pieza: los tramos siguen rectos.'),
      codo ? campo('Ángulo del codo', selector('ti-n-angulo', s.t.politicas.angulos_codo_deg.map((a) => [a, `${a}°`]), codo.angulo, (v) => aplicar((m) => T.cambiarAngulo(m, M(), nid, Number(v)), `Codo de ${nid} a ${v}°.`), 'Ángulo del codo')) : null,
      compuerta ? h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-peligro', id: 'ti-n-quitar-compuerta', onclick: () => { if (TB().quitarCompuerta(s, nid)) cambio(); else pintarEstado(); } }, 'Quitar la compuerta')) : null,
      compuerta ? h('p', { class: 'ti-nota' }, cierre ? `En el balanceo se cierra hasta K ${W.num(cierre.K, 2)}: pierde ${n0(cierre.Pa)} Pa para que su ramal no jale de más.` : 'Abierta: el balanceo de la salida dice si hay que cerrarla y cuánto.') : null,
      h('label', { class: 'ti-check', for: 'ti-n-ancla' }, ancla, 'Anclar (punto fijo: no se mueve al editar)'),
      agregar);
  }

  function inspectorProyecto() {
    const s = ui.s;
    const T = TZ();
    const pr = s.t.proyecto;
    const pol = s.t.politicas;
    const a = T.aire(pr.aire.temperatura_C, pr.aire.altitud_m);
    const cal = Object.keys(M().calibres[M().materiales[s.t.material.material].tabla_calibre] || {}).map(Number).sort((x, y) => x - y);
    const rejillaModo = pol.rejilla.paso_azimut_deg === 90 ? 'EJES' : pol.rejilla.paso_azimut_deg === 45 ? 'EJES_45' : 'FINA';
    const pp = (k, etq) => campo(etq, entrada(`ti-pol-${k}`, pol[k], (v) => aplicar((t) => T.cambiarPoliticas(t, M(), { [k]: num(v) }), `Política ${etq}: ${v}.`)));
    const t90 = h('input', { type: 'checkbox', id: 'ti-pol-t90', checked: pol.permite_t_90 });
    t90.addEventListener('change', () => aplicar((t) => T.cambiarPoliticas(t, M(), { permite_t_90: t90.checked }), t90.checked ? 'T a 90° permitida en este proyecto.' : 'Sin T a 90°.'));
    return h('section', { class: 'ti-ins' },
      titulo('Proyecto', 'Fase 1: se llena una vez'),
      h('div', { class: 'ti-rejilla-campos' },
        campo('Nombre', entrada('ti-pr-nombre', pr.nombre, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { nombre: v }), 'Nombre del proyecto.'), { inputmode: 'text' })),
        campo('Clave', entrada('ti-pr-id', pr.id, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { id: v }), 'Clave del proyecto.'), { inputmode: 'text' })),
        campoAncho('Servicio', selector('ti-pr-servicio', [['POLVO', 'Polvo'], ['ABRASIVO', 'Material abrasivo'], ['VENTILACION', 'Ventilación'], ['HUMOS', 'Humos']], pr.servicio, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { servicio: v }), (m) => `Servicio: velocidades de ${m.politicas.velocidad_min_m_s} a ${m.politicas.velocidad_max_m_s} m/s.`), 'Servicio')),
        campoAncho('Material transportado', entrada('ti-pr-mat', pr.material_transportado || '', (v) => aplicar((t) => T.cambiarProyecto(t, M(), { material_transportado: v || null }), 'Material transportado.'), { inputmode: 'text' })),
        campo('Temperatura (°C)', entrada('ti-pr-temp', pr.aire.temperatura_C, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { aire: { temperatura_C: num(v) } }), 'Temperatura del aire.'))),
        campo('Altitud (m)', entrada('ti-pr-alt', pr.aire.altitud_m, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { aire: { altitud_m: num(v) } }), 'Altitud.'))),
        campoAncho('Origen', entrada('ti-pr-origen', pr.origen, (v) => aplicar((t) => T.cambiarProyecto(t, M(), { origen: v }), 'Origen.'), { inputmode: 'text' }))),
      h('p', { class: 'ti-nota', id: 'ti-pr-aire' }, `Aire: ${W.num(a.presion_Pa / 1000, 2)} kPa, ρ = ${W.num(a.densidad_kg_m3, 4)} kg/m³, μ = ${cientifico(a.viscosidad_Pa_s)} Pa·s.`),
      h('h4', null, 'Ducto nuevo'),
      h('div', { class: 'ti-rejilla-campos' },
        campoAncho('Material', selector('ti-pr-material', Object.keys(M().materiales).filter((k) => ['GALVANIZADO', 'ACERO_CARBON', 'INOX_304', 'INOX_316'].includes(k)).map((k) => [k, M().materiales[k].nombre || k]), s.t.material.material, (v) => {
          const c2 = Object.keys(M().calibres[M().materiales[v].tabla_calibre] || {}).map(Number);
          aplicar((t) => T.cambiarMaterial(t, M(), v, c2.includes(s.t.material.calibre) ? s.t.material.calibre : c2[0]), 'Material del ducto nuevo.');
        }, 'Material')),
        campo('Calibre', selector('ti-pr-calibre', cal.map((c) => [c, String(c)]), s.t.material.calibre, (v) => aplicar((t) => T.cambiarMaterial(t, M(), s.t.material.material, Number(v)), `Calibre ${v}.`), 'Calibre'))),
      h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', onclick: () => aplicar((t) => T.cambiarMaterial(t, M(), s.t.material.material, s.t.material.calibre, { todos: true }), 'Todos los tramos con este material y calibre.') }, 'Aplicar a todos los tramos')),
      h('details', { class: 'ti-politicas' }, h('summary', null, 'Políticas de este proyecto'),
        h('p', { class: 'ti-nota' }, `Codos a ${pol.angulos_codo_deg.join('°, ')}° (R = ${pol.radio_codo_D}·D); injertos a ${pol.angulos_injerto_deg.join('° y ')}°; entradas ${pol.entradas_permitidas.map((e) => e.toLowerCase()).join(' y ')}; largo al paso de ${pol.paso_largo_mm} mm (mínimo ${pol.largo_min_tramo_mm} mm). Vienen de las tablas del taller; los cambios valen sólo para este trazo.`),
        h('div', { class: 'ti-rejilla-campos' },
          pp('velocidad_min_m_s', 'Velocidad mínima (m/s)'), pp('velocidad_max_m_s', 'Velocidad máxima (m/s)'), pp('holgura_min_mm', 'Holgura (mm)'), pp('altura_libre_min_mm', 'Altura libre (mm)'),
          campo('Direcciones', selector('ti-pol-rejilla', [['FINA', 'Finas: 170'], ['EJES_45', 'Ejes y 45°: 26'], ['EJES', 'Sólo ejes: 6']], rejillaModo, (v) => aplicar((t) => T.cambiarPoliticas(t, M(), { rejilla: T.REJILLAS[v] }), 'Rejilla de direcciones.'), 'Rejilla de direcciones')),
          h('label', { class: 'ti-check', for: 'ti-pol-t90' }, t90, 'Permitir T a 90°'))));
  }

  function inspectorValidar() {
    const s = ui.s;
    const T = TZ();
    let d;
    try { d = T.dimensionar(s.t, M()); } catch (e) { d = { cambios: [], avisos: [] }; }
    const r = T.resumen(s.t, M());
    const marcados = new Set(d.cambios.map((c) => c.tramo));
    return h('section', { class: 'ti-ins' },
      titulo('Validar y dimensionar', `${r.tramos} tramos (${W.num(r.metros_rigidos, 2)} m a ejes, ${W.num(r.metros_netos, 2)} m netos) · ${r.mangueras} mangueras · ${r.redes} red${r.redes === 1 ? '' : 'es'}`),
      h('h4', null, 'Dimensionar por caudal'),
      d.cambios.length ? h('ul', { class: 'ti-lista ti-dim' }, d.cambios.map((c) => {
        const chk = h('input', { type: 'checkbox', checked: true, 'data-tramo': c.tramo, 'aria-label': `Aplicar a ${c.tramo}` });
        chk.addEventListener('change', () => { if (chk.checked) marcados.add(c.tramo); else marcados.delete(c.tramo); });
        return h('li', null, h('label', { class: 'ti-check' }, chk, `${c.tramo}: ${pulg(c.de_in)} → ${pulg(c.a_in)}${c.v_de_m_s === null ? '' : `, ${W.num(c.v_de_m_s, 1)} → ${W.num(c.v_a_m_s, 1)} m/s`}`));
      })) : h('p', { class: 'ti-nota' }, 'Ningún tramo necesita otro Ø (o no hay caudales todavía).'),
      d.avisos.length ? h('ul', { class: 'ti-lista ti-avisos' }, d.avisos.map((a) => h('li', null, a.mensaje))) : null,
      d.cambios.length ? h('div', { class: 'ti-acciones' },
        h('button', { type: 'button', class: 'btn btn-primario', id: 'ti-dim-todo', onclick: () => aplicar((t) => T.aplicarDimensiones(t, M()), 'Dimensionado por caudal.') }, 'Aplicar todo'),
        h('button', { type: 'button', class: 'btn btn-sec', onclick: () => aplicar((t) => T.aplicarDimensiones(t, M(), [...marcados]), 'Dimensionado por caudal (los marcados).') }, 'Aplicar los marcados')) : null,
      h('p', { class: 'ti-nota' }, 'En esta fase las cotas del lienzo dicen Ø, caudal y velocidad (verde dentro del rango, ámbar fuera).'),
      h('p', { class: 'ti-nota' }, 'Abajo, en «Problemas», la revisión completa: clic en uno lo selecciona y lo centra; «Corregir» aplica el arreglo (se puede deshacer).'));
  }

  /** El cálculo de pérdidas (etapa 4): el ventilador de cada colector, las tomas, el balanceo y la hoja por tramo. */
  function seccionCalculo() {
    const s = ui.s;
    const inf = TB().informeCalculo(s);
    if (inf.error) return [h('h4', null, 'Cálculo de pérdidas'), h('p', { class: 'ti-semaforo ti-sem-ambar', id: 'ti-calc-estado' }, inf.error)];
    const ir = (id) => () => irA(id);
    const pct = (x) => `${Math.round(x * 100)} %`;
    const tabla = (id, cabeza, filas) => h('div', { class: 'ti-tabla-env' }, h('table', { class: 'ti-calc-tabla', id },
      h('thead', null, h('tr', null, cabeza.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', null, filas)));
    return [
      h('h4', null, 'Cálculo de pérdidas'),
      inf.ventiladores.map((v) => h('div', { class: 'ti-calc-vent', 'data-equipo': v.equipo },
        h('p', { class: 'ti-calc-vent-tit' }, `Ventilador de ${v.nombre}`),
        h('p', { class: 'ti-calc-vent-punto' }, `${n0(v.caudal_m3_h)} m³/h a ${n0(v.presion_estatica_Pa)} Pa`),
        h('p', { class: 'ti-nota' }, `Succión en la boca ${n0(v.presion_estatica_boca_Pa)} Pa más ${n0(v.perdida_equipo_Pa)} Pa del equipo. En aire estándar (1.2 kg/m³), para la curva del fabricante: ${n0(v.presion_estatica_estandar_Pa)} Pa. ${W.num(v.potencia_freno_kW, 2)} kW al freno (ventilador al ${pct(v.eficiencia_ventilador)}, bandas al ${pct(v.eficiencia_transmision)}): motor de ${v.motor_hp === null ? 'más de 500' : String(v.motor_hp)} HP.`))),
      h('p', { class: 'ti-nota' }, 'Por toma: el caudal que va a jalar con el balanceo, la succión de su campana y la pérdida de su camino hasta el colector.'),
      tabla('ti-calc-tomas', ['Toma', 'm³/h', 'Campana', 'Camino'], inf.tomas.map((x) => h('tr', { 'data-puerto': x.puerto, class: x.critica ? 'ti-critica' : null },
        h('td', null, h('button', { type: 'button', class: 'enlace', title: x.puerto, onclick: ir(x.puerto) }, x.nombre), x.critica ? h('span', { class: 'ti-chip', title: 'El camino de más pérdida' }, 'crítica') : null),
        h('td', null, n0(x.caudal_corregido_m3_h), x.caudal_corregido_m3_h === x.caudal_m3_h ? null : h('span', { class: 'ti-sub' }, `de ${n0(x.caudal_m3_h)}`)),
        h('td', null, `${n0(x.presion_estatica_campana_Pa)} Pa`), h('td', null, x.perdida_total_Pa === null ? '—' : `${n0(x.perdida_total_Pa)} Pa`)))),
      inf.balance.length ? h('ul', { class: 'ti-lista ti-calc-balance', id: 'ti-calc-balance' }, inf.balance.map((b) => h('li', { 'data-nodo': b.nodo, 'data-accion': b.accion },
        h('button', { type: 'button', class: 'enlace', onclick: ir(b.nodo) }, b.nodo), ` ${b.tramo_ramal} ${n0(b.sp_ramal_Pa)} Pa y ${b.tramo_tronco} ${n0(b.sp_tronco_Pa)} Pa, relación ${W.num(b.relacion, 2)}: `,
        h('strong', null, b.nombre_accion), b.sugerencia ? `. ${b.sugerencia}` : '.',
        b.accion === 'COMPUERTA' && !b.cierre ? h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec ti-calc-compuerta', 'data-tramo': b.corriente_menor, onclick: () => { if (TB().compuertaSugerida(s, b.corriente_menor)) cambio(); else pintarEstado(); } }, `Poner compuerta en ${b.corriente_menor}`)) : null)))
        : h('p', { class: 'ti-nota', id: 'ti-calc-balance' }, 'Sin confluencias: no hay nada que balancear.'),
      h('details', { class: 'ti-politicas', id: 'ti-calc-hoja' }, h('summary', null, `Hoja de cálculo (${inf.tramos.length} tramos)`),
        tabla(null, ['Tramo', 'Ø', 'm³/h', 'm/s', 'Fricción', 'Locales', 'Succión'], inf.tramos.map((x) => h('tr', { 'data-tramo': x.tramo },
          h('td', null, h('button', { type: 'button', class: 'enlace', onclick: ir(x.tramo) }, x.tramo)), h('td', null, pulg(x.diametro_in)), h('td', null, n0(x.caudal_m3_h)), h('td', null, W.num(x.velocidad_m_s, 1)),
          h('td', null, W.num(x.perdida_friccion_Pa, 1)), h('td', { title: x.locales.join(', ') }, W.num(x.perdida_local_Pa, 1)), h('td', null, n0(x.presion_estatica_Pa))))),
        h('p', { class: 'ti-nota' }, 'En pascales; la succión es al final de cada tramo. Clic en un tramo: su renglón completo (presión dinámica, Reynolds, f y cada pérdida local).')),
      h('p', { class: 'ti-nota' }, `Método de la ACGIH (Industrial Ventilation) con balanceo por diseño; aire a ${W.num(inf.aire.densidad_kg_m3, 4)} kg/m³. Las presiones son succión (Pa). Los coeficientes son los de referencia del manual: cotéjelos con su edición. En esta fase las cotas dicen Ø, caudal y succión al final de cada tramo.`),
    ];
  }

  /** La yarda de la cotización (como en el dibujo unifilar): la del encabezado o la de las tablas. */
  function yarda() {
    const y = C.cotizador.yardaDeCotizacion(E().cot, M()).yarda_mm;
    return Math.round(y === undefined ? M().proceso.armado_yardas.yarda_defecto_mm : y) === 1220 ? 1220 : 914.4;
  }

  /**
   * El trazo a partidas (§5.6): el despiece con las mismas reglas del taller que la foto y el dibujo unifilar, lo que hay que
   * saber, y el botón que lo lleva al diálogo del despiece y a la cotización.
   */
  function seccionPartidas() {
    const s = ui.s;
    const r = TB().despiece(s, yarda());
    const tit = h('h4', null, 'Pasar a la cotización');
    if (r.error) return [tit, h('p', { class: 'ti-semaforo ti-sem-ambar', id: 'ti-part-estado' }, r.error)];
    const R = r.bom.resumen;
    const pend = UF().pendientes(r.bom).length;
    const n = R.estado === 'NO_COTIZABLE' ? 0 : UF().aPartidas(r.bom).length;
    const preguntas = `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'}`;
    const estado = {
      DEFINITIVA: ['verde', `Despiece definitivo: ${n} partidas (${R.conteo.ductos_rectos} tramos rectos, ${R.conteo.accesorios} accesorios, ${R.conteo.menulas} ménsulas y las compras).`],
      PRELIMINAR: ['ambar', `Despiece preliminar: ${n} partidas con lo que proponen las reglas; ${preguntas} por responder en el despiece.`],
      NO_COTIZABLE: ['rojo', `El despiece todavía no se puede cotizar: ${preguntas} por responder, alguna bloquea.`],
    }[R.estado];
    const ya = E().cot.partidas.filter((p) => p.unifilar_id).length;
    return [
      tit,
      h('p', { class: `ti-semaforo ti-sem-${estado[0]}`, id: 'ti-part-estado' }, estado[1]),
      r.avisos.length ? h('ul', { class: 'ti-lista ti-avisos', id: 'ti-part-avisos' }, r.avisos.map((a) => h('li', null, a))) : null,
      ya ? h('p', { class: 'ti-nota', id: 'ti-part-ya' }, `La cotización ya tiene ${ya} ${ya === 1 ? 'partida importada' : 'partidas importadas'}: al pasar el trazo se muestra el despiece nuevo para reemplazarlas.`) : null,
      h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-primario', id: 'ti-pasar', onclick: () => W.unifilarUI.desdeTrazado(r.lectura, r.respuestas, r.avisos) }, 'Pasar a la cotización')),
      h('p', { class: 'ti-nota' }, `Con las reglas del taller (las de la foto y del dibujo unifilar): los tramos por yardas de ${r.lectura.metadatos.yarda_mm === 1220 ? '4 ft' : '3 ft'}, los codos, los injertos, las reducciones, las bridas, las ménsulas y las compras. En el despiece se contestan las preguntas que queden.`),
    ];
  }

  function inspectorSalida() {
    const s = ui.s;
    const ex = TB().exportar(s);
    const area = h('textarea', { id: 'ti-json', rows: '6', spellcheck: 'false', 'aria-label': 'JSON del sistema para abrir' });
    const artefacto = !!root.COTIZAP_ENTORNO_ARTIFACT;
    const copiar = (borrador) => { const r = TB().exportar(s, borrador); if (r.texto) W.copiarTexto(r.texto, borrador ? 'Borrador del sistema copiado' : 'JSON del sistema copiado'); };
    const descargar = () => {
      const r = TB().exportar(s);
      if (!r.texto) return;
      const a = h('a', { href: URL.createObjectURL(new Blob([r.texto], { type: 'application/json' })), download: `${(s.t.proyecto.id || 'trazado').replace(/[^A-Za-z0-9_-]+/g, '-')}.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    };
    return h('section', { class: 'ti-ins' },
      titulo('Salida', 'Las partidas de la cotización, el cálculo de pérdidas con el balanceo y el ventilador, y el JSON del sistema (§3 de la especificación)'),
      seccionPartidas(),
      seccionCalculo(),
      h('h4', null, 'El JSON del sistema'),
      ex.error ? h('p', { class: 'ti-semaforo ti-sem-ambar', id: 'ti-salida-estado' }, ex.error)
        : h('p', { class: 'ti-semaforo ti-sem-verde', id: 'ti-salida-estado' }, `Listo para exportar${ex.calculado ? ', con el cálculo' : ', sin el cálculo'} (${(ex.texto.length / 1024).toFixed(1)} KB).`),
      h('div', { class: 'ti-acciones' },
        h('button', { type: 'button', class: 'btn btn-primario', id: 'ti-copiar', disabled: !!ex.error, onclick: () => copiar(false) }, 'Copiar el JSON'),
        artefacto ? null : h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-descargar', disabled: !!ex.error, onclick: descargar }, 'Descargar'),
        ex.error ? h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-copiar-borrador', onclick: () => copiar(true) }, 'Copiar como borrador') : null,
        h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-renumerar', onclick: () => aplicar((t) => TZ().renumerar(t, M()), 'Identificadores renumerados en el orden de la red.') }, 'Renumerar')),
      h('h4', null, 'Abrir un sistema'),
      area,
      h('div', { class: 'ti-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', id: 'ti-abrir-json', onclick: () => { if (TB().importar(s, area.value)) cambio(); else pintarEstado(); } }, 'Abrir este JSON')));
  }

  function inspectorAyuda() {
    const s = ui.s;
    return h('section', { class: 'ti-ins' },
      titulo(TB().FASES[s.fase].nombre, TB().AYUDA[s.herr]),
      h('details', { class: 'ti-politicas', open: !s.t.equipos.length }, h('summary', null, 'Cómo se juega'),
        h('ol', { class: 'ti-pasos' },
          h('li', null, 'Proyecto: servicio, aire y material (fase 1).'),
          h('li', null, 'Equipos: elija Colector, Máquina, Campana o Ventilador y toque el piso (o arrástrelo). Con «Toma» (P) toque una cara de su caja.'),
          h('li', null, 'Acoples: con la toma seleccionada, F manguera o B brida. Arrastre el rombo (altura) y el círculo (desvío).'),
          h('li', null, 'Trazado: presione en una toma con brida, un punto de transición, la boca o un extremo y arrastre; el trazo sigue en cadena. ↑ fija Z, → X, ← Y, H horizontal, V vertical; teclee 3.25, <45, @135 o ^45 y Entrar; Tab cambia de opción; Mayús conserva la dirección; Esc termina.'),
          h('li', null, 'Cerca del tronco o de la boca, el imán propone la llegada: Tab alterna, clic acepta.'),
          h('li', null, 'Validar: dimensionar por caudal y revisar los problemas. Salida: pasar el trazo a la cotización, el cálculo de pérdidas, el balanceo, el ventilador y el JSON.'))),
      h('p', { class: 'ti-nota' }, 'Vista: Q y E giran el isométrico; 1 iso, 2 planta, 3 y 4 elevaciones; F o 0 encuadra; rueda o + y − acercan; Espacio y arrastrar mueve. Ctrl+Z y Ctrl+Y deshacen y rehacen.'));
  }

  function pintarInspector() {
    const el = $('#ti-inspector');
    if (!el) return;
    const s = ui.s;
    const sel = s.sel;
    let cont;
    if (sel && sel.tipo === 'EQUIPO' && s.t.equipos.some((e) => e.id === sel.id)) cont = inspectorEquipo(s.t.equipos.find((e) => e.id === sel.id));
    else if (sel && sel.tipo === 'PUERTO' && s.g.puertos.has(sel.id)) cont = inspectorPuerto(sel.id);
    else if (sel && sel.tipo === 'TRAMO' && s.g.tramos.has(sel.id)) cont = inspectorTramo(sel.id);
    else if (sel && sel.tipo === 'NODO' && s.g.pos.has(sel.id)) cont = inspectorNodo(sel.id);
    else if (s.fase === 0) cont = inspectorProyecto();
    else if (s.fase === 4) cont = inspectorValidar();
    else if (s.fase === 5) cont = inspectorSalida();
    else cont = inspectorAyuda();
    const activo = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
    W.reemplazar(el, cont);
    if (activo) { const f = document.getElementById(activo); if (f) f.focus({ preventScroll: true }); }
  }

  /* ------------------------------------------------------------------ barra de estado y problemas */

  function pintarBarraD() {
    const el = $('#ti-d');
    if (!el) return;
    const s = ui.s;
    const ops = s.t.politicas.diametros_comerciales_in.map((d) => [d, pulg(d)]);
    const d1 = selector('ti-d-activo', ops, s.D, (v) => { s.D = Number(v); if (s.traza) s.traza.tab = 0; pintarEstado(); programarCapa(); }, 'Ø activo');
    const d2 = selector('ti-d2', ops, s.D2, (v) => { s.D2 = Number(v); programarCapa(); }, 'Ø del tronco después (reducción con injerto)');
    W.reemplazar(el, h('label', { for: 'ti-d-activo' }, 'Ø'), d1, s.herr === 'RINJ' ? h('label', { for: 'ti-d2' }, 'Tronco después') : null, s.herr === 'RINJ' ? d2 : null);
  }
  function pintarEstado() {
    const s = ui.s;
    if (!s) return;
    const coords = $('#ti-coords');
    const p = ui.puntero;
    if (coords) {
      let txt = '—';
      if (p) {
        let Q = null;
        if (s.traza) {
          const pl = TB().planoDeTrabajo(s, p.x, p.y);
          if (pl.tipo === 'PLANO') { const r = TB().enPlano(s, p.x, p.y, pl.plano); if (r.punto && !r.degenerado) Q = r.punto; }
        }
        Q = Q || TB().enNivel(s, p.x, p.y);
        if (Q) txt = `X ${n0(Q.x)}  Y ${n0(Q.y)}  Z ${n0(Q.z)}`;
      }
      coords.textContent = txt;
    }
    const aj = $('#ti-ajuste');
    if (aj) {
      const f = s.traza ? ui.ultimoFantasma : null;
      aj.textContent = !s.traza ? TB().FASES[s.fase].nombre : f && f.ruta ? `Imán: ${f.iman.nombre}` : f && f.guia ? `Alineado en ${f.guia.eje} con ${f.guia.nodo}` : f && f.tecleado ? 'Largo tecleado' : 'Dirección y largo';
    }
    const pl = $('#ti-plano');
    if (pl) {
      let t = '';
      if (s.traza && p) { const x = TB().planoDeTrabajo(s, p.x, p.y); t = x.tipo === 'EJE' ? x.nombre : x.plano.nombre; } else t = `nivel z = ${n0(s.nivel)}`;
      pl.textContent = `${s.fijar ? '⊠ ' : ''}${t}`;
    }
    const caja = $('#ti-caja');
    if (caja) caja.textContent = `▸ ${s.caja}${s.traza ? '_' : ''}`;
    const msg = $('#ti-msg');
    if (msg) { msg.textContent = s.msg; msg.classList.toggle('ti-msg-error', !!s.error); }
    const alt = $('#ti-alternativa');
    if (alt) {
      if (ui.alternativa && s.error) {
        const a = ui.alternativa;
        W.reemplazar(alt, h('button', { type: 'button', class: 'btn btn-primario ti-corregir', id: 'ti-alternativa-btn', onclick: () => { ui.alternativa = null; if (a.hacer()) cambio(); else pintarEstado(); } }, `Corregir: ${a.texto}`));
        alt.hidden = false;
      } else { ui.alternativa = null; alt.replaceChildren(); alt.hidden = true; }
    }
    const dsh = $('#ti-deshacer');
    if (dsh) dsh.disabled = !s.hist.length;
    const rhc = $('#ti-rehacer');
    if (rhc) rhc.disabled = !s.fut.length;
  }
  /** Selecciona un tramo, un nodo, un puerto o un equipo y lo lleva al centro del lienzo. */
  function irA(id) {
    const s = ui.s;
    s.sel = s.g.tramos.has(id) ? { tipo: 'TRAMO', id } : s.g.puertos.has(id) ? { tipo: 'PUERTO', id } : s.t.equipos.some((q) => q.id === id) ? { tipo: 'EQUIPO', id } : { tipo: 'NODO', id };
    const pos = s.g.tramos.has(id) ? (() => { const t = s.g.tramos.get(id); const a = s.g.pos.get(t.a); const b = s.g.pos.get(t.b); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; })()
      : s.g.puertos.has(id) ? s.g.puertos.get(id).posicion_mm : s.g.pos.has(id) ? s.g.pos.get(id) : s.t.equipos.find((q) => q.id === id).posicion_mm;
    const q = P(pos);
    TB().desplazar(s, s.ancho / 2 - q.x, s.alto / 2 - q.y);
    pintar();
  }

  function pintarProblemas() {
    const el = $('#ti-problemas');
    if (!el) return;
    const s = ui.s;
    const ps = s.problemas.filter((p) => p.severidad !== 'INFO');
    const info = s.problemas.filter((p) => p.severidad === 'INFO');
    const abierto = el.querySelector('details') ? el.querySelector('details').open : ps.some((p) => p.severidad !== 'AVISO');
    const ir = (p) => {
      const id = p.elementos.find((e) => s.g.tramos.has(e) || s.g.pos.has(e) || s.g.puertos.has(e) || s.t.equipos.some((q) => q.id === e));
      if (id) irA(id);
    };
    // los arreglos se buscan en el modelo (se prueban antes de ofrecerlos); con poco tiempo por pintada, el resto con un botón
    const inicio = Date.now();
    const arreglos = (p) => {
      if (!TZ().CORREGIBLES.includes(p.codigo)) return null;
      if (!TB().correccionesListas(s, p) && Date.now() - inicio > 150) return 'BUSCAR';
      return TB().correccionesDe(s, p);
    };
    const botones = (p) => {
      const cs = arreglos(p);
      if (cs === null) return null;
      if (cs === 'BUSCAR') return h('div', { class: 'ti-prob-arreglos' }, h('button', { type: 'button', class: 'btn btn-sec ti-corregir', onclick: () => { TB().correccionesDe(s, p); pintarProblemas(); } }, 'Buscar arreglo'));
      if (!cs.length) return h('div', { class: 'ti-prob-arreglos' }, h('span', { class: 'ti-nota' }, 'Sin arreglo automático: corríjalo a mano.'));
      return h('div', { class: 'ti-prob-arreglos', role: 'group', 'aria-label': `Arreglos de ${p.codigo}` }, cs.map((c, i) => h('button', {
        type: 'button', class: `btn ${i === 0 ? 'btn-primario' : 'btn-sec'} ti-corregir`, 'data-op': c.op,
        onclick: () => { if (TB().corregir(s, c)) cambio(); else { pintarEstado(); pintarProblemas(); } },
      }, i === 0 ? `Corregir: ${c.texto}` : c.texto)));
    };
    W.reemplazar(el, h('details', { open: abierto },
      h('summary', null, `Problemas (${ps.length})`, info.length ? h('span', { class: 'ti-info-n' }, ` · ${info.length} nota${info.length > 1 ? 's' : ''}`) : null),
      ps.length || info.length ? h('ul', { class: 'ti-prob-lista' }, [...ps, ...info].slice(0, 80).map((p) => h('li', { class: `ti-prob ti-prob-${p.severidad.toLowerCase()}`, 'data-codigo': p.codigo },
        h('button', { type: 'button', class: 'ti-prob-btn', onclick: () => ir(p) },
          h('span', { class: 'ti-prob-sev' }, { BLOQUEANTE: '■ BLOQUEANTE', ERROR: '● ERROR', AVISO: '▲ AVISO', INFO: 'i INFO' }[p.severidad]),
          h('code', null, p.codigo), h('span', { class: 'ti-prob-msg' }, `${p.mensaje}${p.sugerencia ? ` ${p.sugerencia}` : ''}`)),
        p.severidad === 'INFO' ? null : botones(p)))) : h('p', { class: 'ti-nota' }, 'Sin problemas.')));
  }

  /* ------------------------------------------------------------------ pintar todo */

  function medir() {
    const el = $('#ti-lienzo');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;
    const w = Math.round(r.width);
    const hh = Math.round(r.height);
    if (w === ui.s.ancho && hh === ui.s.alto) return false;
    const primera = !ui.medido;
    TB().medidas(ui.s, w, hh);
    if (primera) { TB().encuadrar(ui.s); ui.medido = true; }
    return true;
  }
  function pintar() {
    if (!ui.montado || !ui.abierto) return;
    tablero();
    const cuerpo = $('.ti-cuerpo');
    const antes = ui.s.ancho;
    // la salida trae tablas: inspector más ancho; el lienzo se angosta y la vista se aleja lo mismo, para que no se salga nada
    const cambia = cuerpo && cuerpo.classList.contains('ti-cuerpo-calculo') !== (ui.s.fase === 5);
    if (cuerpo) cuerpo.classList.toggle('ti-cuerpo-calculo', ui.s.fase === 5);
    if (medir() && cambia && ui.medido && antes > 0 && ui.s.ancho !== antes) TB().zoom(ui.s, ui.s.ancho / antes);
    pintarFases();
    pintarPaleta();
    pintarBarraD();
    dibujarLienzo();
    pintarInspector();
    pintarProblemas();
    pintarEstado();
    document.querySelectorAll('.ti-vista-btn').forEach((b) => {
      const v = b.dataset.vista;
      const activo = v === 'NE' ? /^(NE|SE|SO|NO)$/.test(ui.s.vista) : ui.s.vista === v;
      b.classList.toggle('ti-vista-activa', activo);
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
      if (v === 'NE') b.textContent = /^(NE|SE|SO|NO)$/.test(ui.s.vista) ? `Iso ${ui.s.vista}` : 'Iso';
    });
  }

  /** Arma la pestaña (una vez). */
  function montar() {
    const raiz = $('#ti-raiz');
    if (!raiz || ui.montado) return;
    const lienzo = svg('svg', {
      id: 'ti-lienzo', class: 'ti-lienzo', tabindex: '0', role: 'application', 'aria-roledescription': 'tablero de trazado isométrico',
      'aria-label': 'Tablero del trazado isométrico. Arrastre desde una toma, la boca o un extremo para trazar; todo se puede hacer también con el inspector.', 'aria-describedby': 'ti-msg',
    });
    lienzo.addEventListener('pointerdown', alBajar);
    lienzo.addEventListener('pointermove', alMover);
    lienzo.addEventListener('pointerup', alSubir);
    lienzo.addEventListener('pointercancel', alCancelar);
    lienzo.addEventListener('pointerleave', alSalir);
    lienzo.addEventListener('wheel', alRueda, { passive: false });
    lienzo.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const cubo = svg('svg', { id: 'ti-cubo', class: 'ti-cubo', viewBox: '0 0 82 82', role: 'group', 'aria-label': 'Cubo de vista' });
    cubo.addEventListener('click', (ev) => { const c = ev.target.closest('[data-vista]'); if (c) { TB().ponerVista(ui.s, c.dataset.vista); pintar(); } });
    const vistas = h('div', { class: 'ti-vistas', role: 'group', 'aria-label': 'Vista' },
      VISTAS_BTN.map(([v, t, k]) => h('button', { type: 'button', class: 'ti-vista-btn', 'data-vista': v, id: `ti-vista-${v.toLowerCase()}`, title: `${t} (${k})`, onclick: () => { TB().ponerVista(ui.s, v === 'NE' && /^(NE|SE|SO|NO)$/.test(ui.s.vista) ? ui.s.vista : v); pintar(); } }, t)),
      h('button', { type: 'button', class: 'btn-icono', id: 'ti-girar-q', 'aria-label': 'Girar el isométrico a la izquierda (Q)', title: 'Girar (Q)', onclick: () => { TB().girarVista(ui.s, -1); pintar(); } }, icono('girarIzq')),
      h('button', { type: 'button', class: 'btn-icono', id: 'ti-girar-e', 'aria-label': 'Girar el isométrico a la derecha (E)', title: 'Girar (E)', onclick: () => { TB().girarVista(ui.s, 1); pintar(); } }, icono('girarDer')),
      h('button', { type: 'button', class: 'btn-icono', id: 'ti-alejar', 'aria-label': 'Alejar', title: 'Alejar (−)', onclick: () => { TB().zoom(ui.s, 0.8); dibujarLienzo(); } }, icono('menos')),
      h('button', { type: 'button', class: 'btn-icono', id: 'ti-acercar', 'aria-label': 'Acercar', title: 'Acercar (+)', onclick: () => { TB().zoom(ui.s, 1.25); dibujarLienzo(); } }, icono('mas')),
      h('button', { type: 'button', class: 'btn-icono', id: 'ti-encuadrar', 'aria-label': 'Encuadrar todo', title: 'Encuadrar (F)', onclick: () => { TB().encuadrar(ui.s); dibujarLienzo(); } }, icono('ajustar')));
    W.reemplazar(raiz,
      h('nav', { class: 'ti-fases', id: 'ti-fases', 'aria-label': 'Fases del trazado' }),
      h('div', { class: 'ti-cuerpo' },
        h('aside', { class: 'ti-paleta', id: 'ti-paleta', 'aria-label': 'Bloques de construcción' }),
        h('div', { class: 'ti-centro' },
          h('div', { class: 'ti-lienzo-marco' }, lienzo, vistas, cubo, h('span', { class: 'ti-escala', id: 'ti-escala', 'aria-hidden': 'true' })),
          h('div', { class: 'ti-estado' },
            h('span', { class: 'ti-coords', id: 'ti-coords' }, '—'), h('span', { class: 'ti-sep', id: 'ti-ajuste' }), h('span', { class: 'ti-sep', id: 'ti-plano' }),
            h('span', { class: 'ti-sep ti-d', id: 'ti-d' }), h('span', { class: 'ti-sep ti-caja', id: 'ti-caja', title: 'Caja de valores: 3.25, 3250mm, <45, @135, ^45 y Entrar' }, '▸')),
          h('p', { class: 'ti-msg', id: 'ti-msg', role: 'status', 'aria-live': 'polite' }),
          h('div', { class: 'ti-alternativa', id: 'ti-alternativa', hidden: true })),
        h('aside', { class: 'ti-inspector', id: 'ti-inspector', 'aria-label': 'Inspector' })),
      h('section', { class: 'ti-problemas', id: 'ti-problemas', 'aria-label': 'Problemas' }));
    $('#ti-nuevo').addEventListener('click', () => {
      const s = ui.s;
      if (!s.t.equipos.length && !s.t.nodos.length) return;
      TB().reemplazar(s, TZ().nuevo(M()), 'Trazado nuevo. El anterior se recupera con Deshacer (Ctrl+Z).');
      s.fase = 0;
      cambio();
    });
    $('#ti-ejemplo').addEventListener('click', () => {
      TB().reemplazar(ui.s, TB().ejemplo(M()), 'El ejemplo de la especificación: sierra con brida y cepillo con manguera a un colector. Deshacer (Ctrl+Z) vuelve a lo anterior.');
      cambio();
    });
    $('#ti-deshacer').addEventListener('click', () => { TB().deshacer(ui.s); cambio(); });
    $('#ti-rehacer').addEventListener('click', () => { TB().rehacer(ui.s); cambio(); });
    document.addEventListener('keydown', alTecla);
    document.addEventListener('keyup', alSoltarTecla);
    root.addEventListener('blur', () => { ui.espacio = false; if (ui.s) TB().teclasSostenidas(ui.s, false, false); });
    if (typeof root.ResizeObserver === 'function') new root.ResizeObserver(() => { if (ui.abierto && medir()) dibujarLienzo(); }).observe(lienzo);
    else root.addEventListener('resize', () => { if (ui.abierto && medir()) dibujarLienzo(); });
    ui.montado = true;
  }

  /** La pestaña se ve (o cambió la cotización): pinta el tablero. */
  function render() {
    montar();
    ui.abierto = !!$('#panel-trazado') && !$('#panel-trazado').hidden;
    if (!ui.abierto) return;
    tablero();
    pintar();
  }

  W.trazadoUI = { render, estado: () => ui.s };
}(typeof self !== 'undefined' ? self : this));
