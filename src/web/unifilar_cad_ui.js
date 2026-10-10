/**
 * COTIZAP · web/unifilar_cad_ui.js — «Dibujar el unifilar»: el tablero del CAD sencillo dentro del diálogo del unifilar
 * (docs/dibujo-unifilar.md).
 *
 * La ductería se arma con trazos desde el colector, con las familias del cotizador como herramientas: tramo recto, codo,
 * subida o bajada, injerto simple, reducción, reducción con injerto y los equipos del final de cada ramal. El trazo se ajusta
 * solo a lo que el taller fabrica (codos a 30°, 45°, 60° o 90°; injertos a 30° o 45°, a favor del flujo) y a pasos de 0.1 m;
 * las medidas exactas se escriben en el panel. Mientras se dibuja, las reglas del unifilar (motor/unifilar.js) cuentan las
 * piezas, y al dar «Listo» el dibujo pasa como lectura a la revisión y a las partidas.
 *
 * El modelo (motor/unifilar_cad.js) se guarda con la cotización (estado.cot.dibujo_unifilar). Se dibuja en isométrico o en
 * planta, con ratón, pluma o dedo (pointer events), y todo se puede hacer también con el teclado desde el panel.
 * Depende de app.js (W.estadoApp, W.persistir, W.toast) y de unifilar_ui.js, que lo abre y recibe la lectura.
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);

  const E = () => W.estadoApp;
  const CAD = () => C.unifilarCad;
  const UF = () => C.unifilar;
  const NS = 'http://www.w3.org/2000/svg';
  const IN = 25.4;
  const PASO_MM = 100; // los trazos se ajustan a 0.1 m
  const PASO_PUNTO_MM = 50; // y el punto de un injerto o una reducción, a 5 cm
  const MAX_HIST = 100;
  const svg = (tag, attrs, ...hijos) => {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]); });
    hijos.forEach((c) => { if (c !== null && c !== undefined) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  };
  const ico = (cuerpo) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;
  const ICONOS = {
    vertical: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
    maquina: '<rect x="3" y="10" width="11" height="10" rx="1.5"/><path d="M14 14c3 0 3-6 6-6M19 5v6"/>',
    brida: '<rect x="3" y="10" width="11" height="10" rx="1.5"/><path d="M14 15h4M18 11v8M21 15h-3"/>',
    campana: '<path d="M4 19h16l-5-8H9z"/><path d="M12 11V4"/>',
    abierto: '<path d="M3 12h11"/><path d="M14 7v10M18 8l3 4-3 4"/>',
    mano: '<path d="M6 3l12 9-5.5 1.2L15 20l-2.4 1-2.6-6.6L6 18z"/>',
    borrar: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    deshacer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    rehacer: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    ajustar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
  };
  const icono = (n) => h('span', { class: 'icono', html: ico(ICONOS[n] || '') });

  /** Las herramientas: las familias del cotizador y los equipos del final de cada ramal. */
  const HERRAMIENTAS = [
    { id: 'TRAMO', nombre: 'Tramo recto', corto: 'Tramo', fam: 'RECTO', tecla: 't', grupo: 'Trazar',
      ayuda: 'Arrastre desde el colector, desde el final de un tramo o desde la mitad de uno. Si da vuelta sale un codo (30°, 45°, 60° o 90°); desde la mitad de un tramo, un injerto (30° o 45°).' },
    { id: 'CODO', nombre: 'Codo', fam: 'CODO', tecla: 'c', grupo: 'Trazar',
      ayuda: 'Arrastre desde el final de un tramo hacia donde da vuelta: el codo sale a 30°, 45°, 60° o 90°. Toque un codo para cambiar su ángulo en el panel.' },
    { id: 'VERTICAL', nombre: 'Sube o baja', corto: 'Sube/baja', icono: 'vertical', tecla: 'v', grupo: 'Trazar',
      ayuda: 'Arrastre hacia arriba o hacia abajo desde un punto: el ducto sube o baja (con codo de 90° si venía horizontal).' },
    { id: 'INJERTO', nombre: 'Injerto simple', corto: 'Injerto', fam: 'RAMAL', tecla: 'i', grupo: 'Trazar',
      ayuda: 'Arrastre desde la mitad de un tramo horizontal (o desde un punto donde el tronco sigue recto): el injerto sale a 30° o 45°, a favor del flujo.' },
    { id: 'REDUCCION', nombre: 'Reducción', fam: 'REDUCCION', tecla: 'r', grupo: 'Trazar',
      ayuda: 'Toque un tramo donde cambia de diámetro: de ahí en adelante queda del Ø del trazo (menor). Tocado cerca de su inicio, cambia todo el tramo.' },
    { id: 'RINJ', nombre: 'Reducción con injerto', corto: 'Red. c/ injerto', fam: 'REDUCCION_INJERTO', tecla: 'j', grupo: 'Trazar',
      ayuda: 'Arrastre desde la mitad de un tramo: sale un injerto del Ø del trazo y el tronco sigue reducido al Ø de «tronco después».' },
    { id: 'EQUIPO', nombre: 'Equipo', icono: 'maquina', tecla: 'e', grupo: 'Equipos',
      ayuda: 'Toque el final de un ramal para poner ahí el equipo elegido: máquina con manguera o con brida, campana o extremo abierto.' },
    { id: 'SELECCIONAR', nombre: 'Seleccionar', icono: 'mano', tecla: 's', grupo: 'Editar', soloIcono: true,
      ayuda: 'Toque un tramo o un punto para ver y cambiar sus medidas. Arrastre el fondo para mover el dibujo; la rueda o dos dedos acercan y alejan.' },
    { id: 'BORRAR', nombre: 'Borrar', icono: 'borrar', tecla: 'b', grupo: 'Editar', soloIcono: true, ayuda: 'Toque un tramo para quitarlo con todo lo que sigue después, o un equipo para quitarlo. Se puede deshacer.' },
  ];
  const HERR = Object.fromEntries(HERRAMIENTAS.map((x) => [x.id, x]));
  const EQUIPOS = ['MAQUINA_MANGUERA', 'MAQUINA_BRIDA', 'CAMPANA', 'ABIERTO'];
  const AYUDA_EQUIPO = {
    MAQUINA_MANGUERA: 'una máquina con manguera', MAQUINA_BRIDA: 'una máquina con brida (la otra media junta la pone el equipo)', CAMPANA: 'una campana (con brida del taller)', ABIERTO: 'un extremo abierto (sin brida)',
  };

  const cad = {
    api: null, modelo: null, hist: [], fut: [], herr: 'TRAMO', D: 12, D2: 10, vista: 'ISO', claseEquipo: 'MAQUINA_MANGUERA',
    cam: { k: 0.05, ox: 0, oy: 0 }, ancho: 800, alto: 500, borde: null, ajustar: true, sel: null, gesto: null, punteros: new Map(), hover: null,
    g: null, revision: { errores: [], avisos: [] }, bom: null, costo: null, partidas: [], msg: '', msgError: false,
  };

  const M = () => E().M;
  const yarda = () => {
    const y = C.cotizador.yardaDeCotizacion(E().cot, M()).yarda_mm;
    return Math.round(y === undefined ? M().proceso.armado_yardas.yarda_defecto_mm : y) === 1220 ? 1220 : 914.4;
  };
  const pulg = (x) => `${Math.round(x * 10) / 10}″`.replace('.0″', '″');
  const metros = (mm) => `${W.num(mm / 1000, 2)} m`;
  const tramo = (id) => cad.modelo.tramos.find((t) => t.id === id) || null;
  const equipoEn = (nid) => cad.modelo.equipos.find((e) => e.nodo === nid) || null;
  const lado = (l) => (l === 'IZQ' ? 'a la izquierda' : 'a la derecha');

  /* ------------------------------------------------------------------ el modelo y lo que sale de él */

  /** Las reglas del unifilar sobre el dibujo: revisión, despiece, partidas y costo directo. */
  function recalcular() {
    const m = cad.modelo;
    cad.g = CAD().geometria(m);
    cad.revision = CAD().revisar(m, M());
    cad.bom = null;
    cad.partidas = [];
    cad.costo = null;
    if (!m.tramos.length) return;
    try {
      const { lectura, respuestas } = CAD().aLectura(m, M(), { yarda_mm: yarda() });
      cad.bom = UF().despiezar(lectura, M(), respuestas);
      cad.partidas = UF().aPartidas(cad.bom);
      if (cad.bom.resumen.estado !== 'NO_COTIZABLE' && cad.partidas.length) cad.costo = C.cotizador.cotizar({ yarda_mm: lectura.metadatos.yarda_mm, partidas: cad.partidas }, M()).totales.costo_directo;
    } catch (e) { cad.bom = null; }
  }

  let temporizador = null;
  function guardar() {
    E().cot.dibujo_unifilar = cad.modelo;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => W.persistir(), 250);
  }

  /** Aplica un cambio (con deshacer): el modelo nuevo, lo que se selecciona y el mensaje. */
  function hacer(nuevo, sel, msg) {
    cad.hist.push(cad.modelo);
    if (cad.hist.length > MAX_HIST) cad.hist.shift();
    cad.fut = [];
    cad.modelo = nuevo;
    if (sel !== undefined) cad.sel = sel;
    recalcular();
    validarSeleccion();
    if (!cad.ajustar) aLaVista();
    guardar();
    avisar(msg || '', false);
    repintar();
  }
  function deshacer() {
    if (!cad.hist.length) { avisar('No hay nada que deshacer.', false); return; }
    cad.fut.push(cad.modelo);
    cad.modelo = cad.hist.pop();
    recalcular();
    validarSeleccion();
    guardar();
    avisar('Se deshizo el último cambio.', false);
    repintar();
  }
  function rehacer() {
    if (!cad.fut.length) { avisar('No hay nada que rehacer.', false); return; }
    cad.hist.push(cad.modelo);
    cad.modelo = cad.fut.pop();
    recalcular();
    validarSeleccion();
    guardar();
    avisar('Se rehizo el cambio.', false);
    repintar();
  }
  /** Una operación del modelo que puede rechazarse: el porqué se muestra en el tablero. */
  function intentar(fn) {
    try { return fn(); } catch (e) {
      if (e instanceof CAD().CadError) { avisar(e.message, true); repintarEstado(); return null; }
      throw e;
    }
  }
  function validarSeleccion() {
    const s = cad.sel;
    if (!s) return;
    if (s.tipo === 'TRAMO' && !tramo(s.id)) cad.sel = null;
    if (s.tipo === 'NODO' && !cad.g.pos.has(s.id)) cad.sel = null;
  }
  function avisar(msg, error) {
    cad.msg = msg;
    cad.msgError = !!error;
  }

  /* ------------------------------------------------------------------ cámara: del espacio (mm) a la pantalla (px) */

  const proy = (p) => CAD().proyectar(p, cad.vista);
  const aPantalla = (p) => { const q = proy(p); return { x: q.x * cad.cam.k + cad.cam.ox, y: q.y * cad.cam.k + cad.cam.oy }; };
  /** El punto del plano horizontal z que se ve en (sx, sy). */
  function enPlano(sx, sy, z) {
    const px = (sx - cad.cam.ox) / cad.cam.k;
    const py = (sy - cad.cam.oy) / cad.cam.k;
    if (cad.vista === 'PLANTA') return { x: px, y: -py, z };
    const a = px / Math.cos(Math.PI / 6);
    const b = -2 * (py + z);
    return { x: (a + b) / 2, y: (b - a) / 2, z };
  }
  /** Encuadra el dibujo en el tablero (con un mínimo de 10 m × 6 m). */
  function encuadrar() {
    const pts = [...cad.g.pos.values()];
    const qs = pts.map(proy);
    const caja = { x0: Math.min(...qs.map((q) => q.x)), x1: Math.max(...qs.map((q) => q.x)), y0: Math.min(...qs.map((q) => q.y)), y1: Math.max(...qs.map((q) => q.y)) };
    const cx = (caja.x0 + caja.x1) / 2;
    const cy = (caja.y0 + caja.y1) / 2;
    const w = Math.max(caja.x1 - caja.x0, 10000);
    const hh = Math.max(caja.y1 - caja.y0, 6000);
    const k = Math.min(Math.max(60, cad.ancho - 180) / w, Math.max(60, cad.alto - 130) / hh); // margen para las etiquetas
    cad.cam.k = Math.max(0.004, Math.min(2, k));
    cad.cam.ox = cad.ancho / 2 - cx * cad.cam.k;
    cad.cam.oy = cad.alto / 2 - cy * cad.cam.k;
  }
  /** Si lo seleccionado quedó fuera del tablero, mueve la vista para que se vea (con margen). */
  function aLaVista() {
    const s = cad.sel;
    if (!s) return;
    const p = s.tipo === 'NODO' ? cad.g.pos.get(s.id) : (() => { const t = tramo(s.id); const a = cad.g.pos.get(t.de); const b = cad.g.pos.get(t.a); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; })();
    if (!p) return;
    const q = aPantalla(p);
    const m = 70;
    if (q.x < m) cad.cam.ox += m - q.x;
    if (q.x > cad.ancho - m) cad.cam.ox -= q.x - (cad.ancho - m);
    if (q.y < m) cad.cam.oy += m - q.y;
    if (q.y > cad.alto - m) cad.cam.oy -= q.y - (cad.alto - m);
  }
  function zoom(f, sx, sy) {
    const k = Math.max(0.004, Math.min(2, cad.cam.k * f));
    const x = sx === undefined ? cad.ancho / 2 : sx;
    const y = sy === undefined ? cad.alto / 2 : sy;
    cad.cam.ox = x - ((x - cad.cam.ox) * k) / cad.cam.k;
    cad.cam.oy = y - ((y - cad.cam.oy) * k) / cad.cam.k;
    cad.cam.k = k;
  }

  /* ------------------------------------------------------------------ lo que hay bajo el puntero */

  function distSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
  }
  /** El punto (nodo) o el tramo bajo (sx, sy): { tipo: 'NODO', id } o { tipo: 'TRAMO', id, s (mm desde su inicio) }. */
  function tocado(sx, sy, tactil) {
    const p = { x: sx, y: sy };
    const rN = tactil ? 20 : 12;
    let mejor = null;
    cad.g.orden.forEach((nid) => {
      const q = aPantalla(cad.g.pos.get(nid));
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      // en planta, la boca y el final de una vertical caen en el mismo lugar: gana el que está más allá (el que sigue)
      if (d <= rN && (!mejor || d < mejor.d - 0.5 || (Math.abs(d - mejor.d) <= 0.5 && cad.g.orden.indexOf(nid) > cad.g.orden.indexOf(mejor.id)))) mejor = { tipo: 'NODO', id: nid, d };
    });
    if (mejor) return mejor;
    cad.modelo.tramos.forEach((t) => {
      const a = aPantalla(cad.g.pos.get(t.de));
      const b = aPantalla(cad.g.pos.get(t.a));
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
      const { d, t: f } = distSeg(p, a, b);
      const ancho = Math.max(3, t.D_in * IN * cad.cam.k) / 2 + (tactil ? 12 : 6);
      if (d <= ancho && (!mejor || d < mejor.d)) mejor = { tipo: 'TRAMO', id: t.id, s: f * t.largo_mm, d };
    });
    return mejor;
  }

  /* ------------------------------------------------------------------ el trazo: hacia dónde y cuánto */

  const ajustar = (mm, paso) => Math.round(mm / paso) * paso;
  /** Lo más grande que puede ser el tramo que sale de un nodo (o de la mitad de un tramo) con una pieza. */
  function limiteSalida(desde, pieza) {
    if (desde.tipo === 'TRAMO') return tramo(desde.id).D_in;
    const ti = cad.g.entra.get(desde.id);
    if (pieza === 'INJERTO') return cad.g.salen(desde.id)[0].D_in;
    return ti ? ti.D_in : Infinity;
  }
  const filtro = {
    TRAMO: (o) => o.dir === 'H',
    CODO: (o) => o.dir === 'H' && o.pieza === 'CODO',
    VERTICAL: (o) => o.dir !== 'H',
    INJERTO: (o) => o.pieza === 'INJERTO',
    RINJ: (o) => o.pieza === 'INJERTO',
  };
  /** Las opciones de salida para la herramienta, desde un nodo o desde la mitad de un tramo. */
  function opcionesDesde(desde) {
    const r = desde.tipo === 'NODO' ? CAD().salidas(cad.modelo, M(), desde.id) : CAD().salidasEnTramo(cad.modelo, M(), desde.id);
    const ops = r.opciones.filter(filtro[cad.herr] || (() => true));
    let motivo = r.motivo || r.nota || '';
    if (!ops.length && r.opciones.length) {
      motivo = {
        CODO: 'Un codo sale del final de un tramo horizontal; aquí no.', VERTICAL: 'Desde aquí el ducto no puede subir ni bajar.',
        INJERTO: 'Un injerto sale de la mitad de un tramo horizontal o de un punto donde el tronco sigue recto.', RINJ: 'Una reducción con injerto sale de la mitad de un tramo horizontal o de un punto donde el tronco sigue recto.',
      }[cad.herr] || motivo;
    }
    return { ops, motivo };
  }

  /** Lo que haría el trazo si se suelta aquí: { ok, op, texto, fin (mm), inicio (mm) } o { ok: false, texto }. */
  function propuesta(gs, sx, sy) {
    const desde = gs.desde;
    let inicio;
    let s = null;
    if (desde.tipo === 'NODO') inicio = cad.g.pos.get(desde.id);
    else {
      const t = tramo(desde.id);
      if (t.largo_mm < 2 * CAD().LARGO_MIN_MM) return { ok: false, texto: `El tramo ${t.id} es demasiado corto para injertar.` };
      s = Math.max(CAD().LARGO_MIN_MM, Math.min(t.largo_mm - CAD().LARGO_MIN_MM, ajustar(desde.s, PASO_PUNTO_MM)));
      const p = cad.g.pos.get(t.de);
      const v = CAD().vector(t);
      inicio = { x: p.x + v.x * s, y: p.y + v.y * s, z: p.z };
    }
    const { ops, motivo } = opcionesDesde(desde);
    if (!ops.length) return { ok: false, texto: motivo || 'Desde aquí no sale ese trazo.', inicio };
    let op;
    let largo;
    if (cad.herr === 'VERTICAL') {
      const dz = -(sy - gs.sy0) / cad.cam.k;
      op = ops.find((o) => o.dir === (dz >= 0 ? 'SUBE' : 'BAJA'));
      if (!op) return { ok: false, texto: dz >= 0 ? 'Desde aquí el ducto no puede subir.' : 'Desde aquí el ducto no puede bajar.', inicio };
      largo = ajustar(Math.abs(dz), PASO_MM);
    } else {
      const q = enPlano(sx, sy, inicio.z);
      const vx = q.x - inicio.x;
      const vy = q.y - inicio.y;
      if (Math.hypot(vx, vy) < 1e-6) return { ok: false, texto: '', inicio };
      const az = (Math.atan2(vy, vx) * 180) / Math.PI;
      const dif = (o) => Math.abs(((o.az_deg - az + 540) % 360) - 180);
      op = ops.reduce((a, b) => (dif(b) < dif(a) ? b : a));
      const u = CAD().vector({ dir: 'H', az_deg: op.az_deg });
      largo = ajustar(vx * u.x + vy * u.y, PASO_MM);
    }
    if (largo < CAD().LARGO_MIN_MM) return { ok: false, texto: 'Arrastre más lejos: el tramo más corto es de 0.1 m.', inicio, op };
    largo = Math.min(largo, CAD().LARGO_MAX_MM);
    const pieza = desde.tipo === 'TRAMO' ? 'INJERTO' : op.pieza;
    const lim = limiteSalida(desde, pieza);
    const D = Math.min(cad.D, lim);
    const u = CAD().vector(op);
    const fin = { x: inicio.x + u.x * largo, y: inicio.y + u.y * largo, z: inicio.z + u.z * largo };
    const nombre = {
      INICIO: op.dir === 'H' ? 'sale del colector' : `${op.dir === 'SUBE' ? 'sube' : 'baja'} desde el colector`, RECTO: 'recto', TRONCO: 'recto (lo que salía queda como injerto)',
      CODO: op.dir === 'H' ? `codo de ${op.giro_deg}° ${op.lado ? lado(op.lado) : ''}`.trim() : `${op.dir === 'SUBE' ? 'sube' : 'baja'} · codo de 90°`, INJERTO: `injerto a ${op.giro_deg}° ${lado(op.lado)}`,
    }[pieza];
    let texto = `${metros(largo)} · ${pulg(D)} · ${nombre}`;
    if (D < cad.D) texto += ` (no puede ser mayor que ${pulg(lim)})`;
    if (cad.herr === 'RINJ') {
      const trD = desde.tipo === 'TRAMO' ? tramo(desde.id).D_in : cad.g.salen(desde.id)[0].D_in;
      if (!(cad.D2 < trD)) return { ok: false, texto: `El tronco después debe ser menor que el de ahora (${pulg(trD)}): elija «tronco después».`, inicio, fin };
      if (D > cad.D2) return { ok: false, texto: `El injerto (${pulg(D)}) no puede ser mayor que el tronco después (${pulg(cad.D2)}).`, inicio, fin };
      texto += ` · el tronco sigue de ${pulg(cad.D2)}`;
    }
    return { ok: true, op, largo, D, s, pieza, inicio, fin, texto };
  }

  /** Aplica el trazo: el tramo nuevo (o el injerto) y, con reducción con injerto, el tronco reducido. */
  function trazar(gs, pr) {
    const desde = gs.desde;
    const r = intentar(() => {
      const M0 = M();
      let res;
      let nodoInj;
      if (desde.tipo === 'TRAMO') {
        res = CAD().injertar(cad.modelo, M0, desde.id, pr.s, { az_deg: pr.op.az_deg, largo_mm: pr.largo, D_in: pr.D });
        nodoInj = res.nodo;
        res = { ...res, nodo: res.extremo };
      } else {
        res = CAD().agregarTramo(cad.modelo, M0, desde.id, { dir: pr.op.dir, az_deg: pr.op.az_deg, largo_mm: pr.largo, D_in: pr.D });
        nodoInj = desde.id;
      }
      let m = res.modelo;
      if (cad.herr === 'RINJ') {
        const g = CAD().geometria(m);
        const tr = g.tronco(nodoInj);
        if (tr) m = CAD().cambiarDiametro(m, M0, tr.id, cad.D2).modelo;
      }
      return { m, res };
    });
    if (!r) return;
    const t = r.m.tramos.find((x) => x.a === r.res.nodo);
    hacer(r.m, { tipo: 'NODO', id: r.res.nodo }, `${t ? `Tramo ${t.id}` : 'Tramo'}: ${pr.texto}.`);
  }

  /** Un toque (sin arrastrar) con la herramienta: seleccionar, reducir, poner un equipo o borrar. */
  function tocar(hit) {
    const h0 = cad.herr;
    if (h0 === 'EQUIPO') {
      if (!hit || hit.tipo !== 'NODO') { avisar('Toque el final de un ramal (un punto sin nada después).', true); repintarEstado(); return; }
      const clase = cad.claseEquipo;
      const r = intentar(() => CAD().ponerEquipo(cad.modelo, hit.id, clase));
      if (r) hacer(r.modelo, { tipo: 'NODO', id: hit.id }, `${CAD().CLASES[clase].texto} en ${hit.id}: «${r.modelo.equipos.find((e) => e.id === r.equipo).nombre}».`);
      return;
    }
    if (h0 === 'BORRAR') {
      if (!hit) return;
      if (hit.tipo === 'NODO') {
        const e = equipoEn(hit.id);
        if (e && e.clase !== 'COLECTOR') { const m = intentar(() => CAD().quitarEquipo(cad.modelo, hit.id)); if (m) hacer(m, null, `Se quitó «${e.nombre}».`); return; }
        const ti = cad.g.entra.get(hit.id);
        if (!ti) { avisar('El colector no se borra: para empezar otra vez use «Nuevo dibujo».', true); repintarEstado(); return; }
        borrar(ti.id);
        return;
      }
      borrar(hit.id);
      return;
    }
    if (h0 === 'REDUCCION' && hit && hit.tipo === 'TRAMO') {
      const t = tramo(hit.id);
      if (!(cad.D < t.D_in)) { avisar(`Elija un Ø del trazo menor que el del tramo ${t.id} (${pulg(t.D_in)}) para reducir.`, true); repintarEstado(); return; }
      const s = ajustar(hit.s, PASO_PUNTO_MM);
      const r = s < 150
        ? intentar(() => ({ ...CAD().cambiarDiametro(cad.modelo, M(), t.id, cad.D), nodo: t.de, tramo: t.id }))
        : intentar(() => CAD().reducir(cad.modelo, M(), t.id, Math.min(s, t.largo_mm - CAD().LARGO_MIN_MM), cad.D));
      if (r) {
        const mas = r.cambiados && r.cambiados.length ? ` También quedaron de ${pulg(cad.D)}: ${r.cambiados.join(', ')} (no pueden ser mayores).` : '';
        hacer(r.modelo, { tipo: 'TRAMO', id: r.tramo }, `Reducción a ${pulg(cad.D)} en ${r.nodo}.${mas}`);
      }
      return;
    }
    cad.sel = hit ? { tipo: hit.tipo, id: hit.id } : null;
    avisar(hit ? '' : cad.msg, cad.msgError && !hit ? cad.msgError : false);
    repintar();
  }

  function borrar(tramoId) {
    const r = intentar(() => CAD().borrarTramo(cad.modelo, tramoId));
    if (!r) return;
    hacer(r.modelo, null, `Se quitaron ${r.tramos} ${r.tramos === 1 ? 'tramo' : 'tramos'}${r.equipos ? ` y ${r.equipos} ${r.equipos === 1 ? 'equipo' : 'equipos'}` : ''}. Deshacer con Ctrl+Z.`);
  }

  /* ------------------------------------------------------------------ gestos */

  function local(ev) {
    const r = $('#cad-tablero').getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / Math.max(1, r.width)) * cad.ancho, y: ((ev.clientY - r.top) / Math.max(1, r.height)) * cad.alto };
  }
  const DE_TRAZO = ['TRAMO', 'CODO', 'VERTICAL', 'INJERTO', 'RINJ'];
  function alBajar(ev) {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse' && ev.button !== 1) return;
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const p = local(ev);
    cad.punteros.set(ev.pointerId, p);
    if (cad.punteros.size === 2) {
      // dos dedos: acercar y mover (se cancela el trazo)
      const [a, b] = [...cad.punteros.values()];
      cad.gesto = { modo: 'PELLIZCO', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: cad.cam.k, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cad.cam } };
      pintarFantasma();
      return;
    }
    if (cad.punteros.size > 2) return;
    const tactil = ev.pointerType === 'touch' || ev.pointerType === 'pen';
    const hit = tocado(p.x, p.y, tactil);
    const traza = DE_TRAZO.includes(cad.herr) && hit && ev.button !== 1;
    cad.gesto = {
      modo: traza ? 'TRAZO' : hit && ev.button !== 1 ? 'TOQUE' : 'MOVER', desde: hit, hit, sx0: p.x, sy0: p.y, x: p.x, y: p.y, cam0: { ...cad.cam }, movio: false, tactil,
    };
    el.focus({ preventScroll: true });
    ev.preventDefault();
  }
  function alMover(ev) {
    const p = local(ev);
    const gs = cad.gesto;
    if (cad.punteros.has(ev.pointerId)) cad.punteros.set(ev.pointerId, p);
    if (!gs) {
      if (ev.pointerType === 'mouse') {
        const hit = tocado(p.x, p.y, false);
        const clave = hit ? `${hit.tipo}|${hit.id}` : null;
        if (clave !== cad.hover) { cad.hover = clave; dibujarTablero(); }
      }
      return;
    }
    if (gs.modo === 'PELLIZCO') {
      const [a, b] = [...cad.punteros.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      cad.cam = { ...gs.cam0 };
      zoom(d / Math.max(1, gs.d0), gs.m0.x, gs.m0.y);
      cad.cam.ox += mid.x - gs.m0.x;
      cad.cam.oy += mid.y - gs.m0.y;
      dibujarTablero();
      return;
    }
    gs.x = p.x;
    gs.y = p.y;
    if (Math.hypot(p.x - gs.sx0, p.y - gs.sy0) > (gs.tactil ? 10 : 5)) gs.movio = true;
    // un toque que se arrastra (con cualquier herramienta que no traza) mueve el dibujo
    if (gs.modo === 'MOVER' || (gs.modo === 'TOQUE' && gs.movio)) {
      gs.modo = 'MOVER';
      cad.cam.ox = gs.cam0.ox + (p.x - gs.sx0);
      cad.cam.oy = gs.cam0.oy + (p.y - gs.sy0);
      dibujarTablero();
    } else if (gs.modo === 'TRAZO' && gs.movio) {
      gs.pr = propuesta(gs, p.x, p.y);
      pintarFantasma();
      const linea = $('#cad-estado');
      if (linea) { linea.textContent = gs.pr.texto || ''; linea.classList.toggle('cad-estado-error', !gs.pr.ok && !!gs.pr.texto); }
    }
  }
  function alSubir(ev) {
    cad.punteros.delete(ev.pointerId);
    const gs = cad.gesto;
    if (!gs) return;
    if (gs.modo === 'PELLIZCO') { if (!cad.punteros.size) cad.gesto = null; return; }
    cad.gesto = null;
    if (gs.modo === 'TRAZO' && gs.movio) {
      const pr = gs.pr || propuesta(gs, gs.x, gs.y);
      pintarFantasma();
      if (pr.ok) trazar(gs, pr);
      else { avisar(pr.texto || 'Arrastre para trazar.', !!pr.texto); repintarEstado(); }
      return;
    }
    if (!gs.movio && gs.modo !== 'MOVER') tocar(gs.hit);
    else if (!gs.movio && gs.modo === 'MOVER') tocar(null);
  }
  function alCancelar(ev) {
    cad.punteros.delete(ev.pointerId);
    cad.gesto = null;
    pintarFantasma();
  }
  function alRueda(ev) {
    ev.preventDefault();
    const p = local(ev);
    zoom(Math.pow(1.0015, -Math.max(-400, Math.min(400, ev.deltaY))), p.x, p.y);
    dibujarTablero();
  }
  function alTecla(ev) {
    const k = ev.key;
    if (k === 'Escape') {
      if (cad.gesto) { cad.gesto = null; pintarFantasma(); ev.preventDefault(); ev.stopPropagation(); return; }
      if (cad.sel) { cad.sel = null; repintar(); ev.preventDefault(); ev.stopPropagation(); }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const paso = 60;
    const mover = { ArrowLeft: [paso, 0], ArrowRight: [-paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] }[k];
    if (mover) { cad.cam.ox += mover[0]; cad.cam.oy += mover[1]; dibujarTablero(); ev.preventDefault(); return; }
    if (k === '+' || k === '=') { zoom(1.25); dibujarTablero(); ev.preventDefault(); return; }
    if (k === '-' || k === '_') { zoom(0.8); dibujarTablero(); ev.preventDefault(); return; }
    if (k === '0') { encuadrar(); dibujarTablero(); ev.preventDefault(); return; }
    if ((k === 'Delete' || k === 'Backspace') && cad.sel) {
      ev.preventDefault();
      if (cad.sel.tipo === 'TRAMO') borrar(cad.sel.id);
      else {
        const e = equipoEn(cad.sel.id);
        if (e && e.clase !== 'COLECTOR') { const m = intentar(() => CAD().quitarEquipo(cad.modelo, cad.sel.id)); if (m) hacer(m, cad.sel, `Se quitó «${e.nombre}».`); } else if (cad.g.entra.get(cad.sel.id)) borrar(cad.g.entra.get(cad.sel.id).id);
      }
      return;
    }
    const herr = HERRAMIENTAS.find((x) => x.tecla === k.toLowerCase());
    if (herr) { elegir(herr.id); ev.preventDefault(); }
  }
  /** Ctrl+Z y Ctrl+Y en todo el diálogo (menos al escribir). */
  function alTeclaDialogo(ev) {
    if (!$('#cad-tablero')) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); deshacer(); } else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); rehacer(); }
  }

  function elegir(id) {
    cad.herr = id;
    cad.gesto = null;
    avisar(id === 'EQUIPO' ? `Toque el final de un ramal para poner ahí ${AYUDA_EQUIPO[cad.claseEquipo]}.` : HERR[id].ayuda, false);
    repintar();
  }

  /* ------------------------------------------------------------------ dibujo del tablero */

  /** La etiqueta corta de una pieza del despiece en su nodo. */
  function etiquetaPieza(a) {
    const ang = a.angulo && a.angulo.valor;
    if (a.tipo === 'CODO') return `Codo ${ang}°`;
    if (a.tipo === 'INJERTO') return `Injerto ${ang}°`;
    if (a.tipo === 'REDUCCION_INJERTO') return `Red. c/ injerto ${ang}°`;
    if (a.tipo === 'REDUCCION') return `Red. ${pulg(a.diametro_entrada_in)}→${pulg(a.diametro_salida_in)}`;
    return a.tipo;
  }
  /** El nombre largo de una pieza (para el panel). */
  function nombrePieza(a) {
    const ang = a.angulo && a.angulo.valor;
    if (a.tipo === 'CODO') return `Codo de ${ang}° de ${pulg(a.diametro_entrada_in)}${a.gajos ? ` (${a.gajos} gajos)` : ''}`;
    if (a.tipo === 'INJERTO') return `Injerto simple de ${pulg(a.diametro_entrada_in)} con injerto de ${pulg(a.d_ramal_in)} a ${ang}°`;
    if (a.tipo === 'REDUCCION_INJERTO') return `Reducción con injerto de ${pulg(a.diametro_entrada_in)} a ${pulg(a.diametro_salida_in)}, injerto de ${pulg(a.d_ramal_in)} a ${ang}°`;
    if (a.tipo === 'REDUCCION') return `Reducción de ${pulg(a.diametro_entrada_in)} a ${pulg(a.diametro_salida_in)}`;
    return a.tipo;
  }
  const LETRA = { COLECTOR: 'COL', MAQUINA_MANGUERA: 'M', MAQUINA_BRIDA: 'MB', CAMPANA: 'CA', ABIERTO: '◌' };

  /** Los elementos con problema: errores del dibujo, preguntas y avisos de las reglas. */
  function marcas() {
    const err = new Set();
    const aviso = new Set();
    cad.revision.errores.forEach((x) => x.refs.forEach((r) => err.add(r)));
    cad.revision.avisos.forEach((x) => x.refs.forEach((r) => aviso.add(r)));
    if (cad.bom) {
      cad.bom.alertas_ambiguedad.filter((a) => !a.resuelta && a.severidad === 'BLOQUEANTE').forEach((a) => a.referencias.forEach((r) => err.add(r)));
      cad.bom.alertas_ambiguedad.filter((a) => !a.resuelta && (a.severidad === 'CONFIRMAR' || a.severidad === 'ADVERTENCIA')).forEach((a) => a.referencias.forEach((r) => aviso.add(r)));
    }
    return { err, aviso };
  }

  function rejilla() {
    const g = svg('g', { class: 'cad-rejilla' });
    const z = cad.modelo.colector.z;
    const esquinas = [[0, 0], [cad.ancho, 0], [0, cad.alto], [cad.ancho, cad.alto]].map(([x, y]) => enPlano(x, y, z));
    const x0 = Math.min(...esquinas.map((p) => p.x));
    const x1 = Math.max(...esquinas.map((p) => p.x));
    const y0 = Math.min(...esquinas.map((p) => p.y));
    const y1 = Math.max(...esquinas.map((p) => p.y));
    const paso = [500, 1000, 2000, 5000, 10000, 20000, 50000].find((s) => s * cad.cam.k >= 22) || 100000;
    const linea = (a, b, eje) => {
      const p = aPantalla(a);
      const q = aPantalla(b);
      g.append(svg('line', { x1: p.x.toFixed(1), y1: p.y.toFixed(1), x2: q.x.toFixed(1), y2: q.y.toFixed(1), class: eje ? 'cad-rejilla-eje' : null }));
    };
    let n = 0;
    for (let x = Math.ceil(x0 / paso) * paso; x <= x1 && n < 400; x += paso, n += 1) linea({ x, y: y0, z }, { x, y: y1, z }, x === cad.modelo.colector.x);
    for (let y = Math.ceil(y0 / paso) * paso; y <= y1 && n < 800; y += paso, n += 1) linea({ x: x0, y, z }, { x: x1, y, z }, y === cad.modelo.colector.y);
    g.dataset.paso = String(paso);
    return { g, paso };
  }

  /** Acomoda las etiquetas sin encimarlas: cada una toma el primer lugar libre de sus candidatos (o el primero). */
  function colocador() {
    const cajas = [];
    const choca = (r) => cajas.some((c) => r.x < c.x + c.w && r.x + r.w > c.x && r.y < c.y + c.h && r.y + r.h > c.y);
    return {
      ocupar: (r) => cajas.push(r),
      elegir: (candidatos, obligado) => {
        const r = candidatos.find((c) => !choca(c));
        if (r) { cajas.push(r); return r; }
        if (!obligado) return null;
        cajas.push(candidatos[0]);
        return candidatos[0];
      },
    };
  }
  const anchoTexto = (t, px) => t.length * px * 0.56 + 4;

  function dibujarTablero() {
    const el = $('#cad-tablero');
    if (!el) return;
    el.setAttribute('viewBox', `0 0 ${cad.ancho} ${cad.alto}`);
    const { err, aviso } = marcas();
    const { g: grid, paso } = rejilla();
    const ductos = svg('g', { class: 'cad-ductos' });
    const textos = svg('g', { class: 'cad-textos' });
    const nodos = svg('g', { class: 'cad-nodos' });
    const equipos = svg('g', { class: 'cad-equipos' });
    const etiquetas = svg('g', { class: 'cad-etiquetas' });
    const sel = cad.sel;
    const hover = cad.hover;
    const lugar = colocador();
    const pant = new Map(cad.g.orden.map((nid) => [nid, aPantalla(cad.g.pos.get(nid))]));
    // los ductos, con su ancho real a la escala del tablero
    const cotas = [];
    cad.modelo.tramos.forEach((t) => {
      const a = pant.get(t.de);
      const b = pant.get(t.a);
      const ancho = Math.max(4, t.D_in * IN * cad.cam.k);
      const clases = ['cad-tramo', t.dir !== 'H' ? 'cad-tramo-v' : '', err.has(t.id) ? 'cad-tramo-err' : aviso.has(t.id) ? 'cad-tramo-aviso' : '',
        sel && sel.tipo === 'TRAMO' && sel.id === t.id ? 'cad-tramo-sel' : '', hover === `TRAMO|${t.id}` ? 'cad-tramo-hover' : ''].filter(Boolean).join(' ');
      const txt = `${t.dir === 'SUBE' ? '↑ ' : t.dir === 'BAJA' ? '↓ ' : ''}${pulg(t.D_in)} · ${metros(t.largo_mm)}`;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) {
        // una vertical en planta: un círculo; la cota va a un lado
        const r = ancho / 2 + 3;
        ductos.append(svg('circle', { cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: r.toFixed(1), class: `${clases} cad-vertical-planta`, 'data-tramo': t.id }));
        cotas.push({ t, txt, err: err.has(t.id), cand: [[a.x + r + 6, a.y - r - 16], [a.x - r - 6 - anchoTexto(txt, 12), a.y - r - 16], [a.x + r + 6, a.y + r + 2], [a.x - r - 6 - anchoTexto(txt, 12), a.y + r + 2]] });
        return;
      }
      ductos.append(svg('line', { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), 'stroke-width': ancho.toFixed(1), class: clases, 'data-tramo': t.id }));
      ductos.append(svg('line', { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), class: 'cad-eje' }));
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      // el ducto en pantalla también ocupa lugar: las etiquetas no se le ponen encima
      for (let f = 0, paso = Math.max(10, ancho) / Math.max(L, 1); f <= 1; f += paso) {
        const cx = a.x + (b.x - a.x) * f;
        const cy = a.y + (b.y - a.y) * f;
        lugar.ocupar({ x: cx - ancho / 2, y: cy - ancho / 2, w: ancho, h: ancho });
      }
      if (L < 30) return;
      let nx = -(b.y - a.y) / L;
      let ny = (b.x - a.x) / L;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
      const w = anchoTexto(txt, 12);
      const off = ancho / 2 + 10;
      const cand = [];
      [0.5, 0.33, 0.67, 0.2, 0.8].forEach((f) => [1, -1].forEach((lado0) => {
        const cx = a.x + (b.x - a.x) * f + nx * off * lado0;
        const cy = a.y + (b.y - a.y) * f + ny * off * lado0;
        cand.push([cx - w / 2, cy - 8]);
      }));
      cotas.push({ t, txt, err: err.has(t.id), cand, corto: L < 70 });
    });
    // los puntos y los equipos ocupan su lugar primero
    const piezasPorNodo = new Map();
    (cad.bom ? cad.bom.accesorios : []).forEach((x) => { if (!piezasPorNodo.has(x.nodo_id)) piezasPorNodo.set(x.nodo_id, []); piezasPorNodo.get(x.nodo_id).push(x); });
    const nombres = [];
    cad.g.orden.forEach((nid) => {
      const p = pant.get(nid);
      const e = equipoEn(nid);
      const libre = !e && cad.g.entra.has(nid) && !cad.g.salen(nid).length;
      const clase = ['cad-nodo', libre ? 'cad-nodo-libre' : '', err.has(nid) ? 'cad-nodo-err' : aviso.has(nid) ? 'cad-nodo-aviso' : '',
        sel && sel.tipo === 'NODO' && sel.id === nid ? 'cad-nodo-sel' : '', hover === `NODO|${nid}` ? 'cad-nodo-hover' : ''].filter(Boolean).join(' ');
      if (e) {
        const letra = LETRA[e.clase];
        const w = Math.max(28, letra.length * 9 + 12);
        lugar.ocupar({ x: p.x - w / 2, y: p.y - 12, w, h: 24 });
        equipos.append(svg('rect', { x: (p.x - w / 2).toFixed(1), y: (p.y - 12).toFixed(1), width: w, height: 24, rx: 6, class: `${clase} cad-equipo cad-equipo-${e.clase.toLowerCase()}`, 'data-nodo': nid }));
        equipos.append(svg('text', { x: p.x.toFixed(1), y: (p.y + 4).toFixed(1), 'text-anchor': 'middle', class: 'cad-equipo-txt' }, letra));
        const wn = anchoTexto(e.nombre, 11.5);
        nombres.push({ texto: e.nombre, cand: [[p.x - wn / 2, p.y + 15], [p.x - wn / 2, p.y - 31], [p.x + w / 2 + 4, p.y - 8], [p.x - w / 2 - 4 - wn, p.y - 8]], w: wn });
      } else {
        lugar.ocupar({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 });
        nodos.append(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: libre ? 6 : 4.5, class: clase, 'data-nodo': nid }));
      }
    });
    // las piezas de cada nodo (lo más importante), luego los nombres de los equipos y al final las cotas
    cad.g.orden.forEach((nid) => {
      const piezas = piezasPorNodo.get(nid);
      if (!piezas) return;
      const p = pant.get(nid);
      const t = piezas.map(etiquetaPieza).join(' + ');
      const w = anchoTexto(t, 11) + 10;
      const r = lugar.elegir([[p.x + 9, p.y - 27], [p.x - 9 - w, p.y - 27], [p.x + 9, p.y + 9], [p.x - 9 - w, p.y + 9], [p.x - w / 2, p.y - 34], [p.x - w / 2, p.y + 14]].map(([x, y]) => ({ x, y, w, h: 18 })), true);
      etiquetas.append(svg('rect', { x: r.x.toFixed(1), y: r.y.toFixed(1), width: w.toFixed(1), height: 18, rx: 9, class: `cad-pieza${err.has(nid) ? ' cad-pieza-err' : ''}` }));
      etiquetas.append(svg('text', { x: (r.x + w / 2).toFixed(1), y: (r.y + 13).toFixed(1), 'text-anchor': 'middle', class: 'cad-pieza-txt' }, t));
    });
    nombres.forEach((n) => {
      const r = lugar.elegir(n.cand.map(([x, y]) => ({ x, y, w: n.w, h: 16 })), true);
      etiquetas.append(svg('text', { x: r.x.toFixed(1), y: (r.y + 12).toFixed(1), class: 'cad-txt cad-txt-eq' }, n.texto));
    });
    cotas.forEach((c) => {
      const w = anchoTexto(c.txt, 12);
      const r = lugar.elegir(c.cand.map(([x, y]) => ({ x, y, w, h: 16 })), !c.corto);
      if (r) textos.append(svg('text', { x: r.x.toFixed(1), y: (r.y + 12).toFixed(1), class: `cad-txt${c.err ? ' cad-txt-err' : ''}`, 'data-cota': c.t.id }, c.txt));
    });
    el.replaceChildren(grid, ductos, textos, nodos, equipos, etiquetas, svg('g', { id: 'cad-fantasma' }));
    const esc = $('#cad-escala');
    if (esc) esc.textContent = `Cuadrícula de ${W.num(paso / 1000, paso < 1000 ? 1 : 0)} m · ${cad.vista === 'ISO' ? 'isométrico' : 'planta'}`;
    pintarFantasma();
  }

  function pintarFantasma() {
    const capa = $('#cad-fantasma');
    if (!capa) return;
    const gs = cad.gesto;
    if (!gs || gs.modo !== 'TRAZO' || !gs.movio || !gs.pr || !gs.pr.inicio) { capa.replaceChildren(); return; }
    const pr = gs.pr;
    const a = aPantalla(pr.inicio);
    const hijos = [svg('circle', { cx: a.x.toFixed(1), cy: a.y.toFixed(1), r: 6, class: 'cad-fantasma-ini' })];
    if (pr.fin) {
      const b = aPantalla(pr.fin);
      const D = pr.D || cad.D;
      hijos.push(svg('line', { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), 'stroke-width': Math.max(4, D * IN * cad.cam.k).toFixed(1), class: `cad-fantasma${pr.ok ? '' : ' cad-fantasma-mal'}` }));
      hijos.push(svg('circle', { cx: b.x.toFixed(1), cy: b.y.toFixed(1), r: 5, class: 'cad-fantasma-fin' }));
      if (pr.texto) hijos.push(svg('text', { x: (b.x + 12).toFixed(1), y: (b.y - 10).toFixed(1), class: `cad-txt cad-fantasma-txt${pr.ok ? '' : ' cad-txt-err'}` }, pr.texto));
    } else if (pr.texto) hijos.push(svg('text', { x: (a.x + 12).toFixed(1), y: (a.y - 12).toFixed(1), class: 'cad-txt cad-txt-err' }, pr.texto));
    capa.replaceChildren(...hijos);
  }

  /* ------------------------------------------------------------------ panel */

  const opcionesD = (max) => UF().COMERCIALES_IN.filter((d) => d <= max);
  function selectD(id, valor, max, alCambiar, etiqueta) {
    const s = h('select', { id, 'aria-label': etiqueta }, opcionesD(max === undefined ? Infinity : max).map((d) => h('option', { value: String(d), selected: d === valor }, pulg(d))));
    s.addEventListener('change', () => alCambiar(Number(s.value)));
    return s;
  }
  /** Un número en metros escrito por el ingeniero (1.5, 1,5 o 1 1/2). */
  function leerMetros(txt) {
    const v = W.leerNumero(txt);
    return Number.isFinite(v) ? Math.round(v * 1000) : NaN;
  }
  const campo = (etiqueta, control, nota) => h('div', { class: 'cad-campo' }, h('label', { for: control.id }, etiqueta), control, nota ? h('span', { class: 'cad-campo-nota' }, nota) : null);
  const textoOpcion = (o) => {
    if (o.dir === 'SUBE' || o.dir === 'BAJA') return `${o.dir === 'SUBE' ? 'Sube' : 'Baja'}${o.pieza === 'CODO' ? ' (codo de 90°)' : o.pieza === 'RECTO' ? ' (sigue)' : ''}`;
    const rumbo = `rumbo ${o.az_deg}°${o.az_deg % 90 === 0 ? ` (eje ${{ 0: 'X', 90: 'Y', 180: '−X', 270: '−Y' }[o.az_deg]})` : ''}`;
    if (o.pieza === 'INICIO') return `Horizontal, ${rumbo}`;
    if (o.pieza === 'RECTO') return 'Recto (sigue igual)';
    if (o.pieza === 'TRONCO') return 'Recto (lo que salía queda como injerto)';
    if (o.pieza === 'INJERTO') return `Injerto a ${o.giro_deg}° ${lado(o.lado)}`;
    if (o.giro_deg === 90 && !o.lado) return `Horizontal, ${rumbo} (codo de 90°)`;
    return `Codo de ${o.giro_deg}° ${lado(o.lado)}`;
  };

  /** Agregar un tramo desde un nodo, con el teclado. */
  function formaAgregar(nid) {
    const { opciones, motivo } = CAD().salidas(cad.modelo, M(), nid);
    if (!opciones.length) return h('p', { class: 'cad-nota' }, motivo);
    const dir = h('select', { id: 'cad-f-dir' }, opciones.map((o, i) => h('option', { value: String(i) }, textoOpcion(o))));
    const largo = h('input', { id: 'cad-f-largo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: '2' });
    const ti = cad.g.entra.get(nid);
    const limite = () => { const o = opciones[Number(dir.value)]; return o.pieza === 'INJERTO' ? cad.g.salen(nid)[0].D_in : ti ? ti.D_in : Infinity; };
    let D = Math.min(cad.D, limite());
    const marco = h('span');
    const ponerD = () => { const lim = limite(); D = Math.min(D, lim); marco.replaceChildren(selectD('cad-f-d', D, lim, (v) => { D = v; }, 'Ø del tramo nuevo')); };
    dir.addEventListener('change', ponerD);
    ponerD();
    const agregar = () => {
      const o = opciones[Number(dir.value)];
      const mm = leerMetros(largo.value);
      const r = intentar(() => CAD().agregarTramo(cad.modelo, M(), nid, { dir: o.dir, az_deg: o.az_deg, largo_mm: mm, D_in: D }));
      if (r) hacer(r.modelo, { tipo: 'NODO', id: r.nodo }, `Tramo ${r.tramo}: ${textoOpcion(o).toLowerCase()}, ${pulg(D)}, ${metros(mm)}.`);
    };
    largo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); agregar(); } });
    return h('div', { class: 'cad-forma' },
      h('h4', null, 'Agregar un tramo desde aquí'),
      campo('Hacia', dir), h('div', { class: 'cad-fila' }, campo('Largo (m, a ejes)', largo), h('div', { class: 'cad-campo' }, h('label', { for: 'cad-f-d' }, 'Ø'), marco)),
      h('button', { type: 'button', class: 'btn btn-primario', id: 'cad-f-agregar', onclick: agregar }, 'Agregar tramo'));
  }

  /** Injertar o reducir a la mitad de un tramo, con el teclado. */
  function formasTramo(t) {
    const out = [];
    if (t.largo_mm >= 2 * CAD().LARGO_MIN_MM) {
      const mitad = Math.round(t.largo_mm / 2 / 100) / 10;
      if (t.dir === 'H') {
        const s = h('input', { id: 'cad-i-s', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: String(mitad) });
        const ang = h('select', { id: 'cad-i-ang' }, M().proceso.angulos_injerto_deg.map((b) => h('option', { value: String(b), selected: b === 45 }, `${b}°`)));
        const ld = h('select', { id: 'cad-i-lado' }, h('option', { value: 'IZQ' }, 'Izquierda'), h('option', { value: 'DER' }, 'Derecha'));
        const largo = h('input', { id: 'cad-i-largo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: '1.5' });
        let D = Math.min(cad.D, t.D_in);
        const dSel = selectD('cad-i-d', D, t.D_in, (v) => { D = v; }, 'Ø del injerto');
        const tras = h('select', { id: 'cad-i-tronco' }, h('option', { value: '' }, `Igual (${pulg(t.D_in)}): injerto simple`), opcionesD(t.D_in).filter((d) => d < t.D_in).reverse().map((d) => h('option', { value: String(d) }, `${pulg(d)}: reducción con injerto`)));
        const injertar = () => {
          const sMm = leerMetros(s.value);
          const b = Number(ang.value);
          const az = t.az_deg + (ld.value === 'IZQ' ? b : -b);
          const D2 = tras.value ? Number(tras.value) : null;
          if (D2 !== null && D > D2) { avisar(`El injerto (${pulg(D)}) no puede ser mayor que el tronco después (${pulg(D2)}).`, true); repintarEstado(); return; }
          const r = intentar(() => {
            const a = CAD().injertar(cad.modelo, M(), t.id, sMm, { az_deg: az, largo_mm: leerMetros(largo.value), D_in: D });
            let m = a.modelo;
            if (D2 !== null) { const tr = CAD().geometria(m).tronco(a.nodo); m = CAD().cambiarDiametro(m, M(), tr.id, D2).modelo; }
            return { ...a, m };
          });
          if (r) hacer(r.m, { tipo: 'NODO', id: r.extremo }, `${D2 !== null ? 'Reducción con injerto' : 'Injerto'} en ${r.nodo}: ramal ${r.tramo} de ${pulg(D)} a ${b}° ${lado(ld.value)}.`);
        };
        out.push(h('div', { class: 'cad-forma' },
          h('h4', null, 'Injertar en este tramo'),
          h('div', { class: 'cad-fila' }, campo('A (m del inicio)', s), campo('Ángulo', ang), campo('Lado', ld)),
          h('div', { class: 'cad-fila' }, campo('Largo del injerto (m)', largo), h('div', { class: 'cad-campo' }, h('label', { for: 'cad-i-d' }, 'Ø del injerto'), dSel)),
          campo('El tronco después', tras),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'cad-i-agregar', onclick: injertar }, 'Injertar')));
      }
      const menores = opcionesD(t.D_in).filter((d) => d < t.D_in);
      if (menores.length) {
        const s = h('input', { id: 'cad-r-s', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: String(mitad) });
        let D = menores[menores.length - 1];
        const dSel = selectD('cad-r-d', D, menores[menores.length - 1], (v) => { D = v; }, 'Ø después de la reducción');
        const reducirAqui = () => {
          const r = intentar(() => CAD().reducir(cad.modelo, M(), t.id, leerMetros(s.value), D));
          if (r) hacer(r.modelo, { tipo: 'TRAMO', id: r.tramo }, `Reducción a ${pulg(D)} en ${r.nodo}.${r.cambiados.length ? ` También quedaron de ${pulg(D)}: ${r.cambiados.join(', ')}.` : ''}`);
        };
        out.push(h('div', { class: 'cad-forma' },
          h('h4', null, 'Reducir en este tramo'),
          h('div', { class: 'cad-fila' }, campo('A (m del inicio)', s), h('div', { class: 'cad-campo' }, h('label', { for: 'cad-r-d' }, 'Ø después'), dSel)),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'cad-r-agregar', onclick: reducirAqui }, 'Reducir')));
      }
    }
    return out;
  }

  /** Tras fusionar, el tramo que quedó con ese id (o el que lo absorbió: el que ahora llega a su final). */
  const tramoVivo = (m, t) => (m.tramos.find((x) => x.id === t.id) || m.tramos.find((x) => x.a === t.a) || { id: null }).id;

  function panelTramo(t) {
    const g = cad.g;
    const lim = (() => { const ti = g.entra.get(t.de); if (!ti) return Infinity; const tr = g.tronco(t.de); return tr && tr !== t && g.salen(t.de).length > 1 && tr.D_in < ti.D_in ? tr.D_in : ti.D_in; })();
    const dSel = selectD('cad-t-d', t.D_in, lim, (v) => {
      const r = intentar(() => CAD().cambiarDiametro(cad.modelo, M(), t.id, v));
      if (r) hacer(r.modelo, { tipo: 'TRAMO', id: tramoVivo(r.modelo, t) }, `${t.id}: ${pulg(v)}.${r.cambiados.length ? ` También quedaron de ${pulg(v)} o menos: ${r.cambiados.join(', ')} (no pueden ser mayores).` : ''}`);
    }, 'Diámetro del tramo');
    const largo = h('input', { id: 'cad-t-largo', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: String(t.largo_mm / 1000) });
    const aplicarLargo = () => {
      const mm = leerMetros(largo.value);
      if (mm === t.largo_mm) return;
      const m = intentar(() => CAD().cambiarLargo(cad.modelo, t.id, mm));
      if (m) hacer(m, { tipo: 'TRAMO', id: t.id }, `${t.id}: ${metros(mm)} a ejes; lo que sigue se movió.`);
    };
    largo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); aplicarLargo(); } });
    const ducto = cad.bom ? cad.bom.ductos_rectos.find((d) => d.arista_id === t.id) : null;
    const union = cad.bom ? cad.bom.elementos_union.find((j) => j.tipo === 'UNION_ENGARGOLADA' && cad.bom.accesorios.filter((a) => j.piezas.includes(a.id)).every((a) => a.aristas.includes(t.id))) : null;
    const dirTxt = t.dir === 'H' ? `Horizontal, rumbo ${t.az_deg}°${t.az_deg % 90 === 0 ? ` (eje ${{ 0: 'X', 90: 'Y', 180: '−X', 270: '−Y' }[t.az_deg]})` : ''}` : t.dir === 'SUBE' ? 'Vertical: sube' : 'Vertical: baja';
    const alertas = alertasDe(t.id);
    return h('section', { class: 'cad-sel', 'aria-labelledby': 'cad-sel-tit' },
      h('h3', { id: 'cad-sel-tit' }, `Tramo ${t.id}`),
      h('p', { class: 'cad-nota' }, `${dirTxt}. De ${t.de} a ${t.a}.`),
      h('div', { class: 'cad-fila' }, h('div', { class: 'cad-campo' }, h('label', { for: 'cad-t-d' }, 'Ø'), dSel),
        h('div', { class: 'cad-campo' }, h('label', { for: 'cad-t-largo' }, 'Largo a ejes (m)'), h('div', { class: 'cad-en-linea' }, largo, h('button', { type: 'button', class: 'btn btn-sec', id: 'cad-t-largo-aplicar', onclick: aplicarLargo }, 'Aplicar')))),
      ducto
        ? h('p', { class: 'cad-pieza-info' }, h('strong', null, `Tramo recto ${ducto.id}: `),
          `${metros(ducto.longitud_cota_mm)} a ejes${ducto.descuentos.map((x) => ` − ${metros(x.mm)} (${x.accesorio_id})`).join('')} = ${metros(ducto.longitud_neta_mm)} netos; `,
          `${ducto.armado.piezas} ${ducto.armado.piezas === 1 ? 'pieza' : 'piezas'} de hasta 3 yardas${ducto.armado.ajuste_mm > 0 ? ` con ajuste de ${W.num(ducto.armado.ajuste_mm, 0)} mm` : ''}; ${ducto.posicion === 'VERTICAL' ? 'vertical' : 'horizontal'}${ducto.extremo_fin !== 'BRIDA' ? `; termina ${ducto.extremo_fin === 'LISO_MANGUERA' ? 'liso a la manguera' : ducto.extremo_fin === 'BRIDA_EQUIPO' ? 'en la brida del equipo' : 'abierto'}` : ''}.`)
        : h('p', { class: 'cad-pieza-info' }, union ? `Sin tramo recto: ${union.piezas.join(' y ')} se pegan (armado de piezas).` : 'Sin tramo recto: revise los avisos.'),
      alertas,
      ...formasTramo(t),
      h('button', { type: 'button', class: 'btn btn-peligro', id: 'cad-t-borrar', onclick: () => borrar(t.id) }, 'Borrar este tramo y lo que sigue'));
  }

  function alertasDe(id) {
    const items = [
      ...cad.revision.errores.filter((x) => x.refs.includes(id)).map((x) => ['err', x.mensaje]),
      ...cad.revision.avisos.filter((x) => x.refs.includes(id)).map((x) => ['aviso', x.mensaje]),
      ...(cad.bom ? cad.bom.alertas_ambiguedad.filter((a) => !a.resuelta && a.severidad !== 'INFO' && a.referencias.includes(id)).map((a) => [a.severidad === 'BLOQUEANTE' ? 'err' : 'aviso', `${a.mensaje}${a.decision_tomada ? ` ${a.decision_tomada}` : ''}`]) : []),
    ];
    if (!items.length) return null;
    return h('ul', { class: 'cad-alertas' }, items.map(([c, m]) => h('li', { class: `cad-al-${c}` }, m)));
  }

  function panelNodo(nid) {
    const g = cad.g;
    const ti = g.entra.get(nid);
    const sal = g.salen(nid);
    const e = equipoEn(nid);
    const piezas = cad.bom ? cad.bom.accesorios.filter((a) => a.nodo_id === nid) : [];
    const partes = [h('h3', { id: 'cad-sel-tit' }, e ? `${e.nombre} (${nid})` : `Punto ${nid}`)];
    const pos = g.pos.get(nid);
    partes.push(h('p', { class: 'cad-nota' }, `A ${metros(Math.hypot(pos.x - cad.modelo.colector.x, pos.y - cad.modelo.colector.y))} del colector en planta, ${pos.z === cad.modelo.colector.z ? 'a la altura de su boca' : `${metros(Math.abs(pos.z - cad.modelo.colector.z))} ${pos.z > cad.modelo.colector.z ? 'arriba' : 'abajo'} de su boca`}.`));
    if (piezas.length) partes.push(h('ul', { class: 'cad-piezas' }, piezas.map((a) => h('li', null, h('strong', null, nombrePieza(a)), ` · ${a.id}`))));
    // el ángulo del codo o del injerto
    if (ti && ti.dir === 'H' && sal.length === 1 && sal[0].dir === 'H' && !e) {
      const gi = CAD().giro(ti, sal[0]);
      const ang = h('select', { id: 'cad-n-ang' }, [0, ...M().proceso.angulos_codo_deg].map((a) => h('option', { value: String(a), selected: a === gi.grados }, a ? `Codo de ${a}°` : 'Recto (sin codo)')));
      const ld = h('select', { id: 'cad-n-lado', disabled: gi.grados === 0 && false }, h('option', { value: 'IZQ', selected: gi.lado !== 'DER' }, 'Izquierda'), h('option', { value: 'DER', selected: gi.lado === 'DER' }, 'Derecha'));
      const aplicar = () => {
        const m = intentar(() => CAD().cambiarAngulo(cad.modelo, M(), nid, Number(ang.value), ld.value));
        if (m) hacer(m, { tipo: 'NODO', id: m.tramos.some((t) => t.a === nid) ? nid : null }, Number(ang.value) ? `Codo de ${ang.value}° ${lado(ld.value)} en ${nid}; lo que sigue giró.` : `En ${nid} el ducto sigue recto.`);
      };
      ang.addEventListener('change', aplicar);
      ld.addEventListener('change', aplicar);
      partes.push(h('div', { class: 'cad-fila' }, campo('Ángulo', ang), campo('Hacia', ld)));
    } else if (ti && sal.length === 2) {
      const tr = g.tronco(nid);
      const ramal = sal.find((s) => s !== tr);
      if (tr && ramal && ti.dir === 'H' && ramal.dir === 'H') {
        const gi = CAD().giro(tr, ramal);
        const ang = h('select', { id: 'cad-n-ang' }, M().proceso.angulos_injerto_deg.map((a) => h('option', { value: String(a), selected: a === gi.grados }, `Injerto a ${a}°`)));
        const ld = h('select', { id: 'cad-n-lado' }, h('option', { value: 'IZQ', selected: gi.lado !== 'DER' }, 'Izquierda'), h('option', { value: 'DER', selected: gi.lado === 'DER' }, 'Derecha'));
        const aplicar = () => {
          const m = intentar(() => CAD().cambiarAngulo(cad.modelo, M(), nid, Number(ang.value), ld.value));
          if (m) hacer(m, { tipo: 'NODO', id: nid }, `Injerto a ${ang.value}° ${lado(ld.value)} en ${nid}; el ramal giró.`);
        };
        ang.addEventListener('change', aplicar);
        ld.addEventListener('change', aplicar);
        partes.push(h('div', { class: 'cad-fila' }, campo('Ángulo', ang), campo('Hacia', ld)));
      }
    } else if (ti && sal.length === 1 && !e) partes.push(h('p', { class: 'cad-nota' }, 'Entre un tramo vertical y uno horizontal el codo siempre es de 90°.'));
    // el equipo del extremo
    if (ti && !sal.length) {
      const sel = h('select', { id: 'cad-n-equipo' }, h('option', { value: '' }, 'Ninguno (se pregunta al revisar)'), EQUIPOS.map((c) => h('option', { value: c, selected: e && e.clase === c }, CAD().CLASES[c].texto)));
      sel.addEventListener('change', () => {
        if (!sel.value) { if (e) { const m = intentar(() => CAD().quitarEquipo(cad.modelo, nid)); if (m) hacer(m, { tipo: 'NODO', id: nid }, `Se quitó «${e.nombre}».`); } return; }
        const r = intentar(() => CAD().ponerEquipo(cad.modelo, nid, sel.value));
        if (r) hacer(r.modelo, { tipo: 'NODO', id: nid }, `${CAD().CLASES[sel.value].texto} en ${nid}.`);
      });
      partes.push(campo('En este extremo', sel));
    }
    if (e) partes.push(...camposEquipo(e));
    partes.push(alertasDe(nid));
    if (e) {
      const eqAl = alertasDe(e.id);
      if (eqAl) partes.push(eqAl);
    }
    if (!e || e.clase === 'COLECTOR') partes.push(formaAgregar(nid));
    if (ti) partes.push(h('button', { type: 'button', class: 'btn btn-peligro', id: 'cad-n-borrar', onclick: () => borrar(ti.id) }, `Borrar ${ti.id} y lo que sigue`));
    return h('section', { class: 'cad-sel', 'aria-labelledby': 'cad-sel-tit' }, partes);
  }

  function camposEquipo(e) {
    const out = [];
    const nombre = h('input', { id: 'cad-e-nombre', type: 'text', autocomplete: 'off', maxlength: '60', value: e.nombre });
    const aplicarNombre = () => {
      if (nombre.value.trim() === e.nombre) return;
      const m = intentar(() => CAD().editarEquipo(cad.modelo, e.id, { nombre: nombre.value }));
      if (m) hacer(m, cad.sel, `Nombre: «${nombre.value.trim()}».`);
    };
    nombre.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); aplicarNombre(); } });
    nombre.addEventListener('change', aplicarNombre);
    out.push(campo('Nombre', nombre));
    if (e.clase === 'COLECTOR' || e.clase === 'MAQUINA_BRIDA') {
      const boca = h('select', { id: 'cad-e-boca' }, h('option', { value: '' }, 'Sin confirmar (se pregunta)'), UF().COMERCIALES_IN.map((d) => h('option', { value: String(d), selected: e.boca_in === d }, pulg(d))));
      boca.addEventListener('change', () => {
        const m = intentar(() => CAD().editarEquipo(cad.modelo, e.id, { boca_in: boca.value === '' ? null : Number(boca.value) }));
        if (m) hacer(m, cad.sel, boca.value ? `Boca de «${e.nombre}»: ${pulg(Number(boca.value))}.` : `La boca de «${e.nombre}» se pregunta al revisar.`);
      });
      out.push(campo('Boca del equipo', boca, 'Si no es del Ø del tramo se agrega una reducción. Confirme con el equipo su patrón de barrenos.'));
    }
    if (e.clase === 'MAQUINA_MANGUERA') {
      const k = h('input', { id: 'cad-e-manguera', type: 'number', min: '1', max: '50', step: '1', inputmode: 'numeric', value: e.manguera_tramos === null ? '' : String(e.manguera_tramos) });
      const aplicar = () => {
        const v = k.value === '' ? null : Number(k.value);
        if (v === e.manguera_tramos) return;
        const m = intentar(() => CAD().editarEquipo(cad.modelo, e.id, { manguera_tramos: v }));
        if (m) hacer(m, cad.sel, v ? `«${e.nombre}»: ${v} ${v === 1 ? 'tramo' : 'tramos'} de manguera.` : `Los tramos de manguera de «${e.nombre}» se preguntan al revisar.`);
      };
      k.addEventListener('change', aplicar);
      out.push(campo('Tramos de manguera', k, 'Del catálogo de compras, con una abrazadera en cada punta.'));
    }
    return out;
  }

  function panelGeneral() {
    const M0 = M();
    const mat = h('select', { id: 'cad-material' }, Object.keys(M0.materiales).map((k) => h('option', { value: k, selected: k === cad.modelo.material }, M0.materiales[k].nombre)));
    const tabla = M0.calibres[M0.materiales[cad.modelo.material].tabla_calibre] || {};
    const cal = h('select', { id: 'cad-calibre' }, Object.keys(tabla).map((k) => h('option', { value: k, selected: Number(k) === cad.modelo.calibre }, `Calibre ${k}`)));
    mat.addEventListener('change', () => {
      const tb = M0.calibres[M0.materiales[mat.value].tabla_calibre] || {};
      const c = tb[String(cad.modelo.calibre)] !== undefined ? cad.modelo.calibre : Number(Object.keys(tb)[0]);
      const m = intentar(() => CAD().cambiarMaterial(cad.modelo, M0, mat.value, c));
      if (m) hacer(m, cad.sel, `Material: ${M0.materiales[mat.value].nombre}.`);
    });
    cal.addEventListener('change', () => {
      const m = intentar(() => CAD().cambiarMaterial(cad.modelo, M0, cad.modelo.material, Number(cal.value)));
      if (m) hacer(m, cad.sel, `Calibre ${cal.value}.`);
    });
    const elementos = h('select', { id: 'cad-elemento', 'aria-label': 'Ir a un punto o tramo del dibujo' },
      h('option', { value: '' }, 'Ir a un punto o tramo…'),
      cad.g.orden.map((nid) => { const e = equipoEn(nid); return h('option', { value: `NODO|${nid}`, selected: cad.sel && cad.sel.tipo === 'NODO' && cad.sel.id === nid }, `${nid}${e ? ` · ${e.nombre}` : ''}`); }),
      cad.modelo.tramos.map((t) => h('option', { value: `TRAMO|${t.id}`, selected: cad.sel && cad.sel.tipo === 'TRAMO' && cad.sel.id === t.id }, `${t.id} · ${pulg(t.D_in)} · ${metros(t.largo_mm)}`)));
    elementos.addEventListener('change', () => {
      if (!elementos.value) { cad.sel = null; repintar(); return; }
      const [tipo, id] = elementos.value.split('|');
      cad.sel = { tipo, id };
      aLaVista();
      repintar('cad-elemento');
    });
    const nuevo = () => {
      if (!cad.modelo.tramos.length) { avisar('El dibujo ya está vacío: sólo el colector.', false); repintarEstado(); return; }
      cad.ajustar = true;
      hacer(CAD().nuevo(M0, { material: cad.modelo.material, calibre: cad.modelo.calibre }), null, 'Dibujo nuevo: sólo el colector. Deshacer con Ctrl+Z.');
    };
    const ejemplo = () => {
      cad.ajustar = true;
      hacer(CAD().dibujoEjemplo(M0), null, 'El dibujo del croquis de ejemplo: subida de 12″, reducción con injerto, injerto, reducción y codo a la campana. Deshacer con Ctrl+Z.');
    };
    return h('section', { class: 'cad-general', 'aria-label': 'Material y selección' },
      h('div', { class: 'cad-fila' }, campo('Material', mat), campo('Calibre', cal)),
      campo('Seleccionar', elementos),
      h('p', { class: 'cad-acc' },
        h('button', { type: 'button', class: 'btn-texto', id: 'cad-nuevo', onclick: nuevo }, 'Nuevo dibujo'), ' · ',
        h('button', { type: 'button', class: 'btn-texto', id: 'cad-ejemplo', onclick: ejemplo }, 'Probar con el ejemplo')));
  }

  function panelResumen() {
    const bom = cad.bom;
    if (!cad.modelo.tramos.length) return h('section', { class: 'cad-resumen' }, h('p', { class: 'cad-nota' }, 'Empiece arrastrando desde el colector (el recuadro COL). Cada trazo es un tramo recto; las piezas salen solas.'));
    if (!bom) return h('section', { class: 'cad-resumen' }, h('p', { class: 'cad-nota' }, 'Las reglas no pudieron despiezar el dibujo: revise los errores.'));
    const cuenta = (t) => bom.accesorios.filter((a) => a.tipo === t).length;
    const R = bom.resumen;
    const uniones = bom.elementos_union.filter((j) => j.tipo === 'UNION_ENGARGOLADA').length;
    const mangueras = bom.partidas_compradas.filter((c) => /^MANGUERA/.test(c.articulo_id)).reduce((s, c) => s + c.cantidad, 0);
    const abraz = bom.soportes.filter((s) => s.tipo === 'ABRAZADERA').reduce((s, x) => s + x.cantidad, 0);
    const estado = { DEFINITIVA: 'definitivo', PRELIMINAR: 'preliminar', NO_COTIZABLE: 'no cotizable' }[R.estado];
    const pend = UF().pendientes(bom).length;
    return h('section', { class: 'cad-resumen', 'aria-labelledby': 'cad-res-tit' },
      h('h3', { id: 'cad-res-tit' }, 'Lo que sale del dibujo'),
      h('div', { class: `cad-estado-chip uf-estado uf-estado-${R.estado.toLowerCase()}` }, h('strong', null, `Despiece ${estado}`),
        h('span', null, pend ? `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} al revisar` : 'sin preguntas pendientes')),
      h('dl', { class: 'cad-cuenta', id: 'cad-cuenta' },
        ...[
          ['Tramos rectos', `${R.conteo.ductos_rectos} · ${W.num(R.longitud_total_neta_m, 2)} m netos`, 'RECTO'],
          ['Codos', cuenta('CODO'), 'CODO'], ['Reducciones', cuenta('REDUCCION'), 'REDUCCION'], ['Injertos simples', cuenta('INJERTO'), 'RAMAL'],
          ['Reducciones con injerto', cuenta('REDUCCION_INJERTO'), 'REDUCCION_INJERTO'], ['Armados de piezas', uniones, 'UNION'],
          ['Ménsulas', R.conteo.menulas, 'SOPORTE'], ['Abrazaderas de ménsula', abraz, 'SOPORTE'], ['Mangueras', `${mangueras} ${mangueras === 1 ? 'tramo' : 'tramos'}`, 'COMPRADO'],
          ['Juntas bridadas', `${R.conteo.juntas_bridadas} · ${R.conteo.aros} aros · ${R.conteo.tornillos_juegos} tornillos`, null],
        ].map(([et, v, fam]) => h('div', { class: 'cad-cuenta-fila', dataset: { fam: fam || '' } }, h('dt', null, fam ? W.iconoFamilia(fam) : null, et), h('dd', null, String(v))))),
      h('p', { class: 'cad-costo' }, h('span', null, `${cad.partidas.length} partidas · costo directo `), h('strong', { id: 'cad-costo' }, cad.costo === null ? '—' : W.mxn(cad.costo)), h('span', { class: 'cad-campo-nota' }, ' (sin margen, comisión ni IVA)')));
  }

  function panelProblemas() {
    const errores = cad.revision.errores.filter((x) => x.codigo !== 'SIN_TRAMOS'); // el dibujo vacío se explica en el resumen
    const avisos = cad.revision.avisos;
    const reglas = cad.bom ? cad.bom.alertas_ambiguedad.filter((a) => !a.resuelta && (a.severidad === 'BLOQUEANTE' || a.severidad === 'CONFIRMAR' || a.severidad === 'ADVERTENCIA')) : [];
    if (!errores.length && !avisos.length && !reglas.length) return null;
    const ir = (refs) => {
      const r = refs.find((x) => tramo(x) || cad.g.pos.has(x)) || null;
      if (!r) return;
      cad.sel = tramo(r) ? { tipo: 'TRAMO', id: r } : { tipo: 'NODO', id: r };
      repintar();
    };
    const fila = (clase, texto, refs, etiqueta) => h('li', { class: `cad-al-${clase}` },
      h('button', { type: 'button', class: 'cad-al-btn', onclick: () => ir(refs) }, h('span', { class: 'cad-al-et' }, etiqueta), ` ${texto}`));
    return h('section', { class: 'cad-problemas', 'aria-labelledby': 'cad-prob-tit' },
      h('h3', { id: 'cad-prob-tit' }, `Por resolver (${errores.length + avisos.length + reglas.length})`),
      h('ul', { class: 'cad-alertas' },
        errores.map((x) => fila('err', x.mensaje, x.refs, 'Error')),
        reglas.filter((a) => a.severidad === 'BLOQUEANTE').map((a) => fila('err', a.mensaje, a.referencias, 'Bloquea')),
        avisos.map((x) => fila('aviso', x.mensaje, x.refs, 'Aviso')),
        reglas.filter((a) => a.severidad !== 'BLOQUEANTE').map((a) => fila('aviso', `${a.mensaje}${a.pregunta ? ` ${a.pregunta}` : ''}`, a.referencias, a.severidad === 'CONFIRMAR' ? 'Se pregunta' : 'Aviso'))));
  }

  function pintarPanel() {
    const panel = $('#cad-panel');
    if (!panel) return;
    const s = cad.sel;
    const seleccion = s && s.tipo === 'TRAMO' && tramo(s.id) ? panelTramo(tramo(s.id)) : s && s.tipo === 'NODO' && cad.g.pos.has(s.id) ? panelNodo(s.id) : null;
    W.reemplazar(panel,
      panelGeneral(),
      seleccion || h('section', { class: 'cad-sel cad-sel-vacia' }, h('p', { class: 'cad-nota' }, 'Toque un tramo o un punto para ver sus piezas y cambiar sus medidas; o elíjalo en «Seleccionar» para hacerlo con el teclado.')),
      panelProblemas(),
      panelResumen(),
      h('details', { class: 'cad-ayuda' }, h('summary', null, 'Cómo se dibuja'),
        h('ul', null,
          h('li', null, 'El dibujo crece desde el colector hacia las máquinas: cada trazo sale de un punto que ya existe.'),
          h('li', null, 'Los trazos se ajustan a lo que fabrica el taller: codos de 30°, 45°, 60° o 90°; injertos de 30° o 45° a favor del flujo; largos de 0.1 en 0.1 m (a ejes).'),
          h('li', null, 'Alejándose del colector el diámetro no crece y un injerto no es mayor que su tronco.'),
          h('li', null, 'Teclas en el tablero: T tramo, C codo, V sube o baja, I injerto, R reducción, J reducción con injerto, S seleccionar, B borrar; flechas mueven, + y − acercan, 0 encuadra, Supr borra lo seleccionado, Esc cancela; Ctrl+Z y Ctrl+Y deshacen y rehacen.'),
          h('li', null, 'Al dar «Listo» las reglas del unifilar sacan las piezas, las uniones, los soportes y las compras, y preguntan lo que falte.'))));
  }

  /* ------------------------------------------------------------------ barra y pie */

  function barra() {
    const conteo = (id) => {
      const bom = cad.bom;
      if (!bom) return null;
      const n = {
        TRAMO: bom.ductos_rectos.length, CODO: bom.accesorios.filter((a) => a.tipo === 'CODO').length, VERTICAL: cad.modelo.tramos.filter((t) => t.dir !== 'H').length,
        INJERTO: bom.accesorios.filter((a) => a.tipo === 'INJERTO').length, REDUCCION: bom.accesorios.filter((a) => a.tipo === 'REDUCCION').length, RINJ: bom.accesorios.filter((a) => a.tipo === 'REDUCCION_INJERTO').length,
      }[id];
      return n === undefined ? cad.modelo.equipos.filter((e) => e.clase !== 'COLECTOR').length : n;
    };
    const grupos = ['Trazar', 'Equipos', 'Editar'].map((gr) => h('div', { class: 'cad-grupo', role: 'group', 'aria-label': gr },
      HERRAMIENTAS.filter((x) => x.grupo === gr).map((x) => {
        const n = conteo(x.id);
        return h('button', {
          type: 'button', class: `cad-herr${cad.herr === x.id ? ' cad-herr-activa' : ''}`, id: `cad-h-${x.id.toLowerCase()}`, 'aria-pressed': cad.herr === x.id ? 'true' : 'false',
          'aria-label': `${x.nombre}${n ? `: ${n} en el dibujo` : ''}`, title: `${x.nombre}${x.tecla ? ` (${x.tecla.toUpperCase()})` : ''}: ${x.ayuda}`, onclick: () => elegir(x.id),
        }, x.fam ? W.iconoFamilia(x.fam) : icono(x.icono), x.soloIcono ? null : h('span', { class: 'cad-herr-txt', 'aria-hidden': 'true' }, x.corto || x.nombre),
        // el contador siempre ocupa su lugar: la barra no cambia de ancho al dibujar
        x.soloIcono ? null : h('span', { class: `cad-herr-n${n ? '' : ' cad-herr-n-0'}`, 'aria-hidden': 'true' }, String(n || 0)));
      }),
      gr === 'Equipos' ? (() => {
        const sel = h('select', { id: 'cad-clase', 'aria-label': 'Qué equipo se pone' }, EQUIPOS.map((c) => {
          const k = cad.modelo.equipos.filter((e) => e.clase === c).length;
          return h('option', { value: c, selected: c === cad.claseEquipo }, `${CAD().CLASES[c].texto}${k ? ` (${k})` : ''}`);
        }));
        sel.addEventListener('change', () => { cad.claseEquipo = sel.value; elegir('EQUIPO'); });
        return sel;
      })() : null));
    const dSel = selectD('cad-d', cad.D, undefined, (v) => { cad.D = v; if (cad.D2 >= v && cad.herr === 'RINJ') cad.D2 = UF().COMERCIALES_IN.filter((d) => d < v).pop() || cad.D2; repintar('cad-d'); }, 'Ø del trazo');
    // el Ø del tronco después sólo vale para la reducción con injerto, pero siempre ocupa su lugar
    const d2 = h('div', { class: `cad-d${cad.herr === 'RINJ' ? '' : ' cad-d-oculto'}`, 'aria-hidden': cad.herr === 'RINJ' ? null : 'true' }, h('label', { for: 'cad-d2' }, 'Tronco después'),
      selectD('cad-d2', cad.D2, undefined, (v) => { cad.D2 = v; repintar('cad-d2'); }, 'Ø del tronco después de la reducción con injerto'));
    if (cad.herr !== 'RINJ') d2.querySelector('select').tabIndex = -1;
    const vista = h('div', { class: 'cad-vista', role: 'group', 'aria-label': 'Vista' },
      ['ISO', 'PLANTA'].map((v) => h('button', { type: 'button', class: `cad-vista-btn${cad.vista === v ? ' cad-herr-activa' : ''}`, id: `cad-vista-${v.toLowerCase()}`, 'aria-pressed': cad.vista === v ? 'true' : 'false',
        onclick: () => { cad.vista = v; encuadrar(); repintar(`cad-vista-${v.toLowerCase()}`); } }, v === 'ISO' ? 'Isométrico' : 'Planta')),
      h('button', { type: 'button', class: 'btn-icono', id: 'cad-alejar', 'aria-label': 'Alejar', title: 'Alejar (−)', onclick: () => { zoom(0.8); dibujarTablero(); } }, icono('menos')),
      h('button', { type: 'button', class: 'btn-icono', id: 'cad-acercar', 'aria-label': 'Acercar', title: 'Acercar (+)', onclick: () => { zoom(1.25); dibujarTablero(); } }, icono('mas')),
      h('button', { type: 'button', class: 'btn-icono', id: 'cad-encuadrar', 'aria-label': 'Encuadrar el dibujo', title: 'Encuadrar (0)', onclick: () => { encuadrar(); dibujarTablero(); } }, icono('ajustar')));
    return [h('div', { class: 'cad-barra' }, ...grupos, h('div', { class: 'cad-d' }, h('label', { for: 'cad-d' }, 'Ø del trazo'), dSel), d2), vista];
  }

  function pie() {
    return [
      h('button', { type: 'button', class: 'btn btn-sec', id: 'cad-volver', onclick: () => cad.api.volver() }, 'Volver'),
      h('button', { type: 'button', class: 'btn btn-sec cad-btn-ico', id: 'cad-deshacer', disabled: !cad.hist.length, 'aria-label': 'Deshacer', title: 'Deshacer (Ctrl+Z)', onclick: deshacer }, icono('deshacer'), h('span', { class: 'cad-btn-txt', 'aria-hidden': 'true' }, 'Deshacer')),
      h('button', { type: 'button', class: 'btn btn-sec cad-btn-ico', id: 'cad-rehacer', disabled: !cad.fut.length, 'aria-label': 'Rehacer', title: 'Rehacer (Ctrl+Y)', onclick: rehacer }, icono('rehacer'), h('span', { class: 'cad-btn-txt', 'aria-hidden': 'true' }, 'Rehacer')),
      h('span', { class: 'uf-pie-esp' }),
      h('button', { type: 'button', class: 'btn btn-primario', id: 'cad-listo', onclick: listo }, 'Listo: convertir en piezas'),
    ];
  }

  function listo() {
    const { errores } = cad.revision;
    if (errores.length) {
      avisar(`Antes de convertir: ${errores[0].mensaje}${errores.length > 1 ? ` (y ${errores.length - 1} más en «Por resolver»)` : ''}`, true);
      const r = errores[0].refs.find((x) => tramo(x) || cad.g.pos.has(x));
      if (r) cad.sel = tramo(r) ? { tipo: 'TRAMO', id: r } : { tipo: 'NODO', id: r };
      repintar();
      return;
    }
    let salida;
    try { salida = CAD().aLectura(cad.modelo, M(), { yarda_mm: yarda() }); } catch (e) { avisar('El dibujo no se pudo convertir: revise los errores.', true); repintarEstado(); return; }
    guardar();
    W.persistir();
    cad.api.listo(salida.lectura, salida.respuestas);
  }

  /* ------------------------------------------------------------------ pintar */

  function repintarEstado() {
    const linea = $('#cad-estado');
    if (linea) { linea.textContent = cad.msg; linea.classList.toggle('cad-estado-error', cad.msgError); }
  }
  /** Vuelve a pintar barra, tablero, panel y pie, conservando el foco (por id). */
  function repintar(foco) {
    const activo = foco || (document.activeElement && document.activeElement.id) || null;
    const marcoBarra = $('#cad-barra');
    if (!marcoBarra) return;
    const [b0, vista] = barra();
    W.reemplazar(marcoBarra, b0);
    W.reemplazar($('#cad-controles'), vista);
    medir();
    dibujarTablero();
    pintarPanel();
    W.reemplazar($('#uf-pie'), ...pie());
    repintarEstado();
    if (activo) { const el = document.getElementById(activo); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  }

  let observador = null;
  /**
   * Toma el tamaño del tablero (sólo si ya está a la vista: el diálogo puede no haberse abierto). Si el tablero se recorre en
   * la página (la barra cambió de alto), el dibujo se queda donde estaba en la pantalla. ¿Cambió?
   */
  function medir() {
    const el = $('#cad-tablero');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;
    // la posición dentro de su columna (no en la página: al desplazar el panel en el teléfono se mueven juntos)
    const c = el.closest('.cad-izq').getBoundingClientRect();
    const borde = { x: r.left - c.left, y: r.top - c.top };
    const w = Math.round(r.width);
    const hh = Math.round(r.height);
    const cambio = w !== cad.ancho || hh !== cad.alto || (cad.borde && (borde.x !== cad.borde.x || borde.y !== cad.borde.y));
    if (cambio && cad.borde) {
      cad.cam.ox -= borde.x - cad.borde.x;
      cad.cam.oy -= borde.y - cad.borde.y;
    }
    cad.borde = borde;
    cad.ancho = w;
    cad.alto = hh;
    if (cad.ajustar) { encuadrar(); cad.ajustar = false; return true; }
    return cambio;
  }

  /** Pinta el diálogo en la vista del dibujo. */
  function pintar(cuerpo, pieEl) {
    const tablero = svg('svg', {
      id: 'cad-tablero', class: 'cad-tablero', tabindex: '0', role: 'application', 'aria-roledescription': 'tablero de dibujo',
      'aria-label': 'Tablero del dibujo del unifilar. Arrastre desde un punto para trazar; el panel permite hacer todo con el teclado.', 'aria-describedby': 'cad-estado',
    });
    tablero.addEventListener('pointerdown', alBajar);
    tablero.addEventListener('pointermove', alMover);
    tablero.addEventListener('pointerup', alSubir);
    tablero.addEventListener('pointercancel', alCancelar);
    tablero.addEventListener('pointerleave', () => { if (!cad.gesto && cad.hover) { cad.hover = null; dibujarTablero(); } });
    tablero.addEventListener('wheel', alRueda, { passive: false });
    tablero.addEventListener('keydown', alTecla);
    tablero.addEventListener('contextmenu', (ev) => ev.preventDefault()); // dejar el dedo quieto no abre el menú del navegador
    cuerpo.classList.add('uf-cuerpo-cad');
    W.reemplazar(cuerpo,
      h('div', { class: 'cad-izq' },
        h('div', { class: 'cad-barra-marco', id: 'cad-barra' }),
        h('div', { class: 'cad-tablero-marco' }, tablero, h('div', { class: 'cad-controles', id: 'cad-controles' }), h('span', { class: 'cad-escala', id: 'cad-escala', 'aria-hidden': 'true' })),
        h('p', { class: 'cad-estado', id: 'cad-estado', role: 'status', 'aria-live': 'polite' })),
      h('div', { class: 'cad-panel', id: 'cad-panel' }));
    W.reemplazar(pieEl, ...pie());
    cad.borde = null;
    medir();
    repintar();
    if (observador) observador.disconnect();
    if (typeof root.ResizeObserver === 'function') {
      observador = new root.ResizeObserver(() => { if (!$('#cad-tablero')) { observador.disconnect(); return; } if (medir()) dibujarTablero(); });
      observador.observe(tablero);
    } else root.requestAnimationFrame(() => { if (medir()) dibujarTablero(); });
  }

  /**
   * Abre el dibujo: el guardado en la cotización (o uno nuevo). api = { listo(lectura, respuestas), volver() }. respuestas:
   * las de la revisión del despiece que salió del dibujo, que pasan al dibujo (material, bocas, mangueras…).
   */
  function abrir(api, respuestas) {
    cad.api = api;
    const guardado = E().cot.dibujo_unifilar ? CAD().validar(E().cot.dibujo_unifilar, M()).modelo : null;
    let m = guardado || CAD().nuevo(M());
    if (respuestas) m = CAD().aplicarRespuestas(m, M(), respuestas);
    // el mismo dibujo que se dejó (se cerró el diálogo y se volvió a abrir): conserva el deshacer
    if (!cad.modelo || JSON.stringify(cad.modelo) !== JSON.stringify(m)) { cad.hist = []; cad.fut = []; cad.modelo = m; }
    cad.sel = null;
    cad.gesto = null;
    cad.punteros.clear();
    cad.ajustar = true;
    recalcular();
    if (guardado) guardar(); // las respuestas de la revisión pasaron al dibujo; uno nuevo se guarda hasta el primer trazo
    avisar(m.tramos.length ? 'Siga el dibujo: arrastre desde un punto o toque un tramo para cambiarlo.' : HERR.TRAMO.ayuda, false);
  }

  const hayDibujo = () => !!(E().cot.dibujo_unifilar && CAD().validar(E().cot.dibujo_unifilar, M()).modelo);

  document.addEventListener('keydown', (ev) => { const d = $('#dlg-unifilar'); if (d && d.open) alTeclaDialogo(ev); });

  W.unifilarCadUI = { abrir, pintar, hayDibujo, estado: () => cad };
}(typeof self !== 'undefined' ? self : this));
