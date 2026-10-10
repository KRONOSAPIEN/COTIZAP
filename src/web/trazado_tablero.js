/**
 * COTIZAP · web/trazado_tablero.js — El juego del trazado isométrico, sin pantalla (docs/trazado-isometrico.md §1 y §4;
 * etapa 2 de §5).
 *
 * Aquí vive todo lo que el tablero decide, y no lo que dibuja: la cámara (de mm a px y de regreso, en isométrico NE, NO, SO
 * o SE, en planta y en las dos elevaciones), qué hay bajo el puntero, el plano de trabajo y sus teclas (↑ → ← H V, Tab y
 * Mayús), la caja de valores (3.25, 3250mm, <45, @135, ^45), el fantasma del trazo con su color, el imán de derivación y de
 * llegada, el modo cadena, la colocación de equipos sobre el nivel, las tomas sobre las caras de su caja, los tiradores de
 * la manguera, mover segmento, medir, deshacer y rehacer (100 pasos) y el contador de pendientes de cada fase. En la salida,
 * el cálculo de pérdidas (motor/perdidas.js, etapa 4) sobre el JSON del sistema, y el despiece del trazo con las reglas del
 * unifilar (motor/trazado_lectura.js), guardados mientras el trazo no cambie.
 *
 * Cada cambio pasa por el modelo puro (motor/trazado_iso.js): si el taller no lo fabrica, el modelo lo rechaza con su código
 * y su porqué, y el tablero lo dice sin cambiar nada. Funciona en Node (sus pruebas recorren el ejemplo de §1.6 con
 * coordenadas de pantalla) y en el navegador, donde web/trazado_iso_ui.js lo dibuja y le pasa los gestos y las teclas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../motor/trazado_iso'), require('../motor/perdidas'), require('../motor/trazado_lectura'));
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.trazadoTablero = factory(root.COTIZAP.trazadoIso, root.COTIZAP.perdidas, root.COTIZAP.trazadoLectura);
  }
}(typeof self !== 'undefined' ? self : this, function (TZ, PD, TL) {
  'use strict';

  const IN = 25.4;
  const DEG = Math.PI / 180;
  const MAX_HIST = 100;
  const CAPTURA_PX = { raton: 12, dedo: 20 }; // §2.1.6
  const IMAN_PX = 16; // §1.3 paso 6
  const ALINEAR_PX = 8;
  const PASO_PISO_MM = 100; // los equipos se apoyan en la rejilla del piso (§1.1)
  const PASO_CARA_MM = 50; // las tomas, en una rejilla de 50 mm sobre la cara
  const PASO_MANGUERA_MM = 50; // los tiradores de la manguera (§1.2)
  const PASO_NIVEL_MM = 100;
  const VISTAS_ISO = ['NE', 'SE', 'SO', 'NO']; // E avanza, Q regresa (NO ← NE → SE)
  const VISTAS = ['NE', 'SE', 'SO', 'NO', 'PLANTA', 'ELEV_XZ', 'ELEV_YZ'];
  const NOMBRE_VISTA = { NE: 'isométrico NE', SE: 'isométrico SE', SO: 'isométrico SO', NO: 'isométrico NO', PLANTA: 'planta', ELEV_XZ: 'elevación X-Z', ELEV_YZ: 'elevación Y-Z' };
  const CAJAS = {
    COLECTOR: { largo: 1500, ancho: 1500, alto: 4000 },
    MAQUINA: { largo: 1200, ancho: 800, alto: 1200 },
    CAMPANA: { largo: 1200, ancho: 1200, alto: 600 },
    VENTILADOR: { largo: 900, ancho: 700, alto: 900 },
  };
  const NOMBRE_EQUIPO = { COLECTOR: 'Colector', MAQUINA: 'Máquina', CAMPANA: 'Campana', VENTILADOR: 'Ventilador' };
  const FASES = [
    { id: 'PROYECTO', nombre: 'Proyecto', herr: 'SELECCIONAR' },
    { id: 'EQUIPOS', nombre: 'Equipos y tomas', herr: 'EQUIPO' },
    { id: 'ACOPLES', nombre: 'Acoples', herr: 'MANGUERA' },
    { id: 'TRAZADO', nombre: 'Trazado', herr: 'TRAMO' },
    { id: 'VALIDAR', nombre: 'Validar y dimensionar', herr: 'SELECCIONAR' },
    { id: 'SALIDA', nombre: 'Salida', herr: 'SELECCIONAR' },
  ];
  /** En qué fase se resuelve cada problema del catálogo (§2.11) para el contador de la barra de fases. */
  const FASE_DE = {
    EQUIPO_SIN_PUERTOS: 1, TOMA_SIN_DATOS: 1, EQUIPOS_ENCIMADOS: 1,
    MANGUERA_IMPOSIBLE: 2, MANGUERA_LARGA: 2, MANGUERA_TORCIDA: 2, CHOQUE_MANGUERA: 2,
    SUBRED_SIN_COLECTOR: 3, EXTREMO_ABIERTO: 3, CHOQUE_DUCTOS: 3, CHOQUE_EQUIPO: 3, ACCESORIOS_NO_CABEN: 3, TRAMO_CORTO: 3, ALTURA_LIBRE: 3,
    DERIVACION_CERCA_DE_CODO: 3, DERIVACIONES_CERCANAS: 3,
    VELOCIDAD_BAJA: 4, VELOCIDAD_ALTA: 4, REDUCCION_BRUSCA: 4, TRONCO_MENOR_QUE_RAMAL: 4, T_90_ALTA_PERDIDA: 4,
  };

  /* ------------------------------------------------------------------ vectores */

  const V3 = (x, y, z) => ({ x, y, z });
  const suma = (a, b) => V3(a.x + b.x, a.y + b.y, a.z + b.z);
  const resta = (a, b) => V3(a.x - b.x, a.y - b.y, a.z - b.z);
  const por = (a, k) => V3(a.x * k, a.y * k, a.z * k);
  const punto = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cruz = (a, b) => V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const norma = (a) => Math.sqrt(punto(a, a));
  const unitario = (a) => { const l = norma(a); return l > 1e-12 ? por(a, 1 / l) : V3(0, 0, 0); };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ajustar = (x, paso) => Math.round(x / paso) * paso + 0;
  const r3 = (x) => Math.round(x * 1000) / 1000 + 0;
  const girarZ = (p, g) => { const c = Math.cos(g * DEG); const s = Math.sin(g * DEG); return V3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); };
  const n = (x, dec) => String(Number(Number(x).toFixed(dec || 0)));
  const metros = (mm) => `${n(mm / 1000, 3)} m`;
  const pulg = (d) => `${n(d, 2)}″`;
  const EJES = { X: V3(1, 0, 0), Y: V3(0, 1, 0), Z: V3(0, 0, 1) };
  const igualDir = (a, b) => !!a && !!b && a.azimut_deg === b.azimut_deg && a.elevacion_deg === b.elevacion_deg;
  const anguloEntre = (a, b) => Math.acos(clamp(punto(unitario(a), unitario(b)), -1, 1)) / DEG;

  /* ------------------------------------------------------------------ el estado */

  /**
   * Un tablero nuevo sobre un trazo (o uno vacío). opciones: ancho y alto del lienzo en px.
   * herr: SELECCIONAR, EQUIPO, TOMA, MANGUERA, BRIDA, TRAMO, VERTICAL, REDUCCION, INJERTO, RINJ, MOVER, MEDIR, BORRAR.
   */
  function crear(M, modelo, opciones) {
    const o = opciones || {};
    const s = {
      M, t: modelo || TZ.nuevo(M), hist: [], fut: [], g: null, problemas: [],
      vista: 'NE', cam: { k: 0.05, ox: 0, oy: 0 }, ancho: o.ancho || 960, alto: o.alto || 600,
      herr: 'SELECCIONAR', tipoEquipo: 'MAQUINA', D: 6, D2: 5, nivel: 0, fase: 0,
      fijar: null, caja: '', mayus: false, alt: false, traza: null, sel: null, medir: null, msg: '', error: false,
    };
    s.vista = s.t.proyecto.vista_iso || 'NE';
    recalcular(s);
    encuadrar(s);
    return s;
  }
  function recalcular(s) {
    s.g = TZ.calcular(s.t, s.M);
    s.problemas = TZ.revisar(s.t, s.M, s.g);
  }
  function decir(s, msg, error) {
    s.msg = msg || '';
    s.error = !!error;
    return !error;
  }
  const textoError = (e) => `${e.message}${e.sugerencia ? ` ${e.sugerencia}` : ''}`;
  /** Intenta una operación del modelo; si el modelo la rechaza, lo dice y devuelve null. */
  function intentar(s, fn) {
    try { return fn(); } catch (e) {
      if (e instanceof TZ.TrazadoError) { decir(s, textoError(e), true); return null; }
      throw e;
    }
  }
  /** Aplica un cambio con deshacer: fn(trazo) devuelve el trazo nuevo. El mensaje lleva lo que la herramienta puso sola. */
  function hacer(s, fn, mensaje) {
    const m = intentar(s, () => fn(s.t));
    if (!m) return null;
    s.hist.push(s.t);
    if (s.hist.length > MAX_HIST) s.hist.shift();
    s.fut = [];
    s.t = m;
    recalcular(s);
    validarSeleccion(s);
    const info = ((m.ultimo && m.ultimo.info) || []).map((x) => x.mensaje);
    decir(s, [typeof mensaje === 'function' ? mensaje(m) : mensaje, ...info].filter(Boolean).join(' '), false);
    return m;
  }
  /** Cambia el trazo entero (abrir el ejemplo, importar, empezar de nuevo), con deshacer. */
  function reemplazar(s, m, mensaje) {
    s.hist.push(s.t);
    if (s.hist.length > MAX_HIST) s.hist.shift();
    s.fut = [];
    s.t = m;
    s.traza = null;
    s.sel = null;
    s.vista = m.proyecto.vista_iso || s.vista;
    recalcular(s);
    encuadrar(s);
    decir(s, mensaje, false);
  }
  function deshacer(s) {
    s.traza = null;
    if (!s.hist.length) return decir(s, 'No hay nada que deshacer.', false);
    s.fut.push(s.t);
    s.t = s.hist.pop();
    recalcular(s);
    validarSeleccion(s);
    return decir(s, 'Se deshizo el último cambio.', false);
  }
  function rehacer(s) {
    s.traza = null;
    if (!s.fut.length) return decir(s, 'No hay nada que rehacer.', false);
    s.hist.push(s.t);
    s.t = s.fut.pop();
    recalcular(s);
    validarSeleccion(s);
    return decir(s, 'Se rehízo el cambio.', false);
  }
  function validarSeleccion(s) {
    const x = s.sel;
    if (!x) return;
    const existe = {
      EQUIPO: () => s.t.equipos.some((e) => e.id === x.id),
      PUERTO: () => s.g.puertos.has(x.id),
      NODO: () => s.g.pos.has(x.id),
      TRAMO: () => s.g.tramos.has(x.id),
    }[x.tipo];
    if (!existe || !existe()) s.sel = null;
  }

  /* ------------------------------------------------------------------ cámara (§0.4) */

  /** Hacia dónde mira la vista (de quien mira hacia la escena): lo más lejano tiene mayor profundidad. */
  function adelante(vista) {
    if (vista === 'PLANTA') return V3(0, 0, -1);
    if (vista === 'ELEV_XZ') return V3(0, 1, 0);
    if (vista === 'ELEV_YZ') return V3(-1, 0, 0);
    return unitario(TZ.rayoDeVista(vista));
  }
  const profundidad = (s, p) => punto(p, adelante(s.vista));
  /** De mm a px. */
  function pantalla(s, p) {
    const q = TZ.proyectar(p, s.vista);
    return { x: s.cam.ox + s.cam.k * q.u, y: s.cam.oy - s.cam.k * q.v };
  }
  const uvDe = (s, x, y) => ({ u: (x - s.cam.ox) / s.cam.k, v: (s.cam.oy - y) / s.cam.k });
  /** Del puntero al plano { punto, normal }: { punto, degenerado } (el plano visto de canto no sirve). */
  const enPlano = (s, x, y, plano) => TZ.alPlano(uvDe(s, x, y), plano, s.vista);
  /** El punto del nivel de trabajo bajo el puntero, o null si en esta vista el nivel se ve de canto. */
  function enNivel(s, x, y, z) {
    const r = enPlano(s, x, y, TZ.planoHorizontal(z === undefined ? s.nivel : z));
    return r.punto && !r.degenerado ? r.punto : null;
  }

  /** Las 8 esquinas de la caja de un equipo: el bit 0 es +X local, el 1 +Y local y el 2 arriba. */
  function esquinas(e) {
    const c = e.caja_mm;
    const out = [];
    for (let i = 0; i < 8; i += 1) {
      const q = V3((i & 1 ? 1 : -1) * c.largo / 2, (i & 2 ? 1 : -1) * c.ancho / 2, i & 4 ? c.alto : 0);
      out.push(suma(e.posicion_mm, girarZ(q, e.rotacion_z_deg)));
    }
    return out;
  }
  const CARAS = [
    { nombre: 'cara +X', n: V3(1, 0, 0), idx: [1, 3, 7, 5] }, { nombre: 'cara −X', n: V3(-1, 0, 0), idx: [0, 4, 6, 2] },
    { nombre: 'cara +Y', n: V3(0, 1, 0), idx: [2, 6, 7, 3] }, { nombre: 'cara −Y', n: V3(0, -1, 0), idx: [0, 1, 5, 4] },
    { nombre: 'cara superior', n: V3(0, 0, 1), idx: [4, 5, 7, 6] }, { nombre: 'cara inferior', n: V3(0, 0, -1), idx: [0, 2, 3, 1] },
  ];
  /** Las caras que se ven de un equipo, de la más lejana a la más cercana: { cara, normal (mundo), puntos (px) }. */
  function carasVisibles(s, e) {
    const es = esquinas(e);
    const f = adelante(s.vista);
    return CARAS.map((c) => ({ cara: c, normal: girarZ(c.n, e.rotacion_z_deg), esq: c.idx.map((i) => es[i]) }))
      .filter((c) => punto(c.normal, f) < -1e-9)
      .map((c) => ({ ...c, puntos: c.esq.map((p) => pantalla(s, p)), prof: profundidad(s, por(suma(suma(c.esq[0], c.esq[1]), suma(c.esq[2], c.esq[3])), 0.25)) }))
      .sort((a, b) => b.prof - a.prof);
  }

  /** Lo que el dibujo ocupa: el origen, los nodos y las cajas de los equipos. */
  function puntosDelDibujo(s) {
    const pts = [V3(0, 0, 0)];
    s.t.nodos.forEach((x) => pts.push(x.posicion_mm));
    s.t.equipos.forEach((e) => esquinas(e).forEach((p) => pts.push(p)));
    return pts;
  }
  /** Encuadra todo el dibujo en el lienzo (F), con un mínimo de 8 m × 5 m. */
  function encuadrar(s) {
    const qs = puntosDelDibujo(s).map((p) => TZ.proyectar(p, s.vista));
    const u0 = Math.min(...qs.map((q) => q.u));
    const u1 = Math.max(...qs.map((q) => q.u));
    const v0 = Math.min(...qs.map((q) => q.v));
    const v1 = Math.max(...qs.map((q) => q.v));
    const w = Math.max(u1 - u0, 8000);
    const hh = Math.max(v1 - v0, 5000);
    // márgenes: arriba la barra de vistas, abajo la escala; a los lados, el cubo y los ejes
    const m = { arriba: 64, abajo: 40, lados: 70 };
    const k = clamp(Math.min(Math.max(80, s.ancho - 2 * m.lados) / w, Math.max(80, s.alto - m.arriba - m.abajo) / hh), 0.003, 2);
    s.cam.k = k;
    s.cam.ox = s.ancho / 2 - ((u0 + u1) / 2) * k;
    s.cam.oy = (m.arriba + s.alto - m.abajo) / 2 + ((v0 + v1) / 2) * k;
  }
  function zoom(s, f, x, y) {
    const k = clamp(s.cam.k * f, 0.003, 2);
    const cx = x === undefined ? s.ancho / 2 : x;
    const cy = y === undefined ? s.alto / 2 : y;
    s.cam.ox = cx - ((cx - s.cam.ox) * k) / s.cam.k;
    s.cam.oy = cy - ((cy - s.cam.oy) * k) / s.cam.k;
    s.cam.k = k;
  }
  function desplazar(s, dx, dy) {
    s.cam.ox += dx;
    s.cam.oy += dy;
  }
  /** Cambia el tamaño del lienzo conservando lo que se ve en el centro. */
  function medidas(s, ancho, alto) {
    s.cam.ox += (ancho - s.ancho) / 2;
    s.cam.oy += (alto - s.alto) / 2;
    s.ancho = ancho;
    s.alto = alto;
  }
  /** 1 · 2 · 3 · 4 y el cubo de vista: isométrico, planta y elevaciones. */
  function ponerVista(s, v) {
    if (!VISTAS.includes(v)) return false;
    s.vista = v;
    encuadrar(s);
    return decir(s, `Vista: ${NOMBRE_VISTA[v]}.`, false);
  }
  /** Q (−1) y E (+1): gira el isométrico 90° (NO ← NE → SE). */
  function girarVista(s, paso) {
    const i = VISTAS_ISO.indexOf(s.vista);
    return ponerVista(s, i < 0 ? 'NE' : VISTAS_ISO[(i + paso + 4) % 4]);
  }

  /* ------------------------------------------------------------------ lo que hay bajo el puntero */

  function distSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const f = L2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1) : 0;
    return { d: Math.hypot(p.x - (a.x + f * dx), p.y - (a.y + f * dy)), f };
  }
  function dentro(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  const tipoNodo = (s, nid) => {
    const ad = s.g.ady.get(nid) || [];
    if (s.g.puertoDeNodo.has(nid)) return 'PUERTO';
    if (s.g.pt.has(nid)) return 'PT';
    if (ad.length === 1) return 'EXTREMO';
    return ad.length ? 'NODO' : 'SUELTO';
  };
  /**
   * Lo que hay bajo (x, y), por prioridad (§2.1.6): un puerto, un punto de transición, un extremo libre, otro nodo, un tramo
   * (con su punto: s_mm desde su nodo a), una manguera o un equipo. { tipo: PUERTO|PT|NODO|TRAMO|EQUIPO, id, nodo?, s_mm?, punto? }
   */
  function tocar(s, x, y, tactil, excluir) {
    const p = { x, y };
    const r = tactil ? CAPTURA_PX.dedo : CAPTURA_PX.raton;
    const ex = excluir || new Set();
    const g = s.g;
    let mejor = null;
    const orden = { PUERTO: 0, PT: 1, EXTREMO: 2, NODO: 3 };
    s.t.nodos.forEach((nd) => {
      if (ex.has(nd.id)) return;
      const q = pantalla(s, nd.posicion_mm);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > r) return;
      const tipo = tipoNodo(s, nd.id);
      if (tipo === 'SUELTO') return;
      const pri = orden[tipo];
      if (!mejor || pri < mejor.pri || (pri === mejor.pri && d < mejor.d)) mejor = { pri, d, nodo: nd.id, tipo };
    });
    if (mejor) {
      if (mejor.tipo === 'PUERTO') return { tipo: 'PUERTO', id: g.puertoDeNodo.get(mejor.nodo), nodo: mejor.nodo };
      if (mejor.tipo === 'PT') return { tipo: 'PT', id: g.pt.get(mejor.nodo), nodo: mejor.nodo };
      return { tipo: 'NODO', id: mejor.nodo, nodo: mejor.nodo, extremo: mejor.tipo === 'EXTREMO' };
    }
    let tr = null;
    s.t.tramos.forEach((t) => {
      if (ex.has(t.id)) return;
      if (t.tipo === 'RIGIDO') {
        const A = g.pos.get(t.a);
        const B = g.pos.get(t.b);
        const a = pantalla(s, A);
        const b = pantalla(s, B);
        const { d, f } = distSeg(p, a, b);
        const ancho = Math.max(4, t.diametro_in * IN * s.cam.k) / 2 + (tactil ? 12 : 6);
        if (d <= ancho && (!tr || d < tr.d)) tr = { d, t, f, punto: suma(A, por(resta(B, A), f)), s_mm: f * g.seg.get(t.id).L };
      } else {
        const rm = g.mang.get(t.id);
        if (!rm) return;
        const pts = TZ.puntosManguera(rm.entrada, rm).map((q) => pantalla(s, q));
        for (let i = 1; i < pts.length; i += 1) {
          const { d } = distSeg(p, pts[i - 1], pts[i]);
          if (d <= Math.max(4, t.diametro_in * IN * s.cam.k) / 2 + (tactil ? 12 : 6) && (!tr || d < tr.d)) tr = { d, t, f: null, punto: null, s_mm: null };
        }
      }
    });
    if (tr) return { tipo: 'TRAMO', id: tr.t.id, s_mm: tr.s_mm, punto: tr.punto, rigido: tr.t.tipo === 'RIGIDO' };
    let eq = null;
    s.t.equipos.forEach((e) => {
      if (ex.has(e.id)) return;
      const hit = carasVisibles(s, e).some((c) => dentro(p, c.puntos));
      const prof = profundidad(s, suma(e.posicion_mm, V3(0, 0, e.caja_mm.alto / 2)));
      if (hit && (!eq || prof < eq.prof)) eq = { e, prof };
    });
    return eq ? { tipo: 'EQUIPO', id: eq.e.id } : null;
  }

  /** La cara de la caja de un equipo bajo el puntero, con el punto ajustado (centro, medio de arista o rejilla de 50 mm). */
  function caraBajo(s, e, x, y, tactil) {
    const r = tactil ? CAPTURA_PX.dedo : CAPTURA_PX.raton;
    let mejor = null;
    carasVisibles(s, e).forEach((c) => {
      const C = por(suma(suma(c.esq[0], c.esq[1]), suma(c.esq[2], c.esq[3])), 0.25);
      const hit = enPlano(s, x, y, { punto: C, normal: c.normal });
      if (!hit.punto) return;
      const q = girarZ(resta(hit.punto, e.posicion_mm), -e.rotacion_z_deg);
      const cj = e.caja_mm;
      const t = 0.5;
      if (Math.abs(q.x) > cj.largo / 2 + t || Math.abs(q.y) > cj.ancho / 2 + t || q.z < -t || q.z > cj.alto + t) return;
      const prof = profundidad(s, hit.punto);
      if (!mejor || prof < mejor.prof) mejor = { c, q, prof };
    });
    if (!mejor) return null;
    const cj = e.caja_mm;
    const nl = mejor.c.cara.n;
    // ejes de la cara (locales): los dos que no son la normal
    const ejes = ['x', 'y', 'z'].filter((k) => Math.abs(nl[k]) < 0.5);
    const lim = { x: [-cj.largo / 2, cj.largo / 2], y: [-cj.ancho / 2, cj.ancho / 2], z: [0, cj.alto] };
    const fijo = ['x', 'y', 'z'].find((k) => Math.abs(nl[k]) > 0.5);
    const base = { x: 0, y: 0, z: 0 };
    base[fijo] = nl[fijo] > 0 ? lim[fijo][1] : lim[fijo][0];
    const centro = { ...base };
    ejes.forEach((k) => { centro[k] = (lim[k][0] + lim[k][1]) / 2; });
    const especiales = [centro];
    ejes.forEach((k) => [0, 1].forEach((i) => { const m = { ...centro }; m[k] = lim[k][i]; especiales.push(m); }));
    const aMundo = (q) => suma(e.posicion_mm, girarZ(V3(q.x, q.y, q.z), e.rotacion_z_deg));
    let q = especiales.map((m) => ({ m, d: Math.hypot(pantalla(s, aMundo(m)).x - x, pantalla(s, aMundo(m)).y - y) })).filter((o) => o.d <= r).sort((a, b) => a.d - b.d)[0];
    if (q) q = q.m;
    else {
      q = { ...base };
      ejes.forEach((k) => { q[k] = clamp(ajustar(mejor.q[k], PASO_CARA_MM), lim[k][0], lim[k][1]); });
    }
    const local = V3(r3(q.x), r3(q.y), r3(q.z));
    return { local, normal: nl, nombre: mejor.c.cara.nombre, mundo: aMundo(local) };
  }

  /* ------------------------------------------------------------------ fases (§4.2) */

  /** Las seis fases con sus pendientes: los problemas del catálogo que se resuelven en cada una. */
  function fases(s) {
    const cuenta = [0, 0, 0, 0, 0, 0];
    const notas = [[], [], [], [], [], []];
    if (!s.t.equipos.some((e) => e.tipo === 'COLECTOR')) { cuenta[1] += 1; notas[1].push('falta el colector'); }
    s.problemas.forEach((p) => {
      if (p.severidad === 'INFO') return;
      let f = FASE_DE[p.codigo];
      if (p.codigo === 'TOMA_SIN_CONEXION') f = p.elementos.length > 1 ? 3 : 2;
      if (f === undefined) f = 4;
      cuenta[f] += 1;
      notas[f].push(p.mensaje);
    });
    const malos = s.problemas.filter((p) => p.severidad === 'BLOQUEANTE' || p.severidad === 'ERROR').length;
    if (malos || !s.t.tramos.length) { cuenta[5] += 1; notas[5].push(malos ? `${malos} error${malos > 1 ? 'es' : ''} impide${malos > 1 ? 'n' : ''} exportar` : 'todavía no hay ductos'); }
    return FASES.map((f, i) => ({ ...f, indice: i, pendientes: cuenta[i], notas: notas[i] }));
  }
  /** Cambia de fase (la herramienta de la fase queda activa); siguiente: true va a la próxima con algo pendiente. */
  function irFase(s, i, siguiente) {
    let k = i;
    if (siguiente) {
      const fs = fases(s);
      const despues = [...fs.slice(s.fase + 1), ...fs.slice(0, s.fase + 1)].find((f) => f.pendientes > 0);
      k = despues ? despues.indice : (s.fase + 1) % FASES.length;
    }
    s.fase = clamp(k, 0, FASES.length - 1);
    elegir(s, FASES[s.fase].herr);
    return s.fase;
  }

  /* ------------------------------------------------------------------ herramientas */

  const AYUDA = {
    SELECCIONAR: 'Toque un equipo, una toma, un tramo o un nodo para ver y cambiar sus datos. Arrastre un equipo para moverlo; arrastre el fondo para mover la vista.',
    EQUIPO: 'Toque el piso donde va el equipo (se ajusta a la rejilla de 100 mm), o arrástrelo desde la paleta.',
    TOMA: 'Toque una cara de la caja de un equipo: la toma va al centro, al medio de una arista o en la rejilla de 50 mm, y apunta hacia fuera.',
    MANGUERA: 'Toque una toma para acoplarla con manguera; luego arrastre el rombo (altura) y el círculo (desvío) del punto de transición.',
    BRIDA: 'Toque una toma para acoplarla con brida: el ducto sale alineado con su cuello.',
    TRAMO: 'Arrastre (o haga clic) desde una toma con brida, un punto de transición, la boca del colector, un extremo libre o un tramo. ↑ → ← fijan un eje, H y V el plano; teclee el largo y Entrar.',
    VERTICAL: 'Arrastre hacia arriba o hacia abajo desde un punto: el ducto sube o baja.',
    REDUCCION: 'Toque un tramo (o el codo) donde baja el Ø: de ahí hacia las tomas queda del Ø activo.',
    INJERTO: 'Arrastre desde un tramo que ya llega al colector: el injerto sale a 30° o 45°, a favor del aire, por arriba o de lado.',
    RINJ: 'Arrastre desde un tramo: sale un injerto del Ø activo y el tronco de aguas arriba queda del Ø de «tronco después».',
    MOVER: 'Arrastre un tramo de lado: sus vecinos se alargan o se acortan (M).',
    MEDIR: 'Toque dos puntos: la distancia real y por eje (D).',
    BORRAR: 'Toque un tramo, un equipo, una toma o una manguera para quitarlo (Mayús: el ramal completo hasta sus tomas); en una compuerta, la quita.',
    COMPUERTA: 'Toque un tramo recto donde va la compuerta de regulación (se ajusta a 50 mm). En la salida, el balanceo dice cuánto cerrarla (G).',
  };
  /** La fase a la que pertenece cada herramienta (la barra de fases la sigue al elegirla). */
  const FASE_DE_HERR = { EQUIPO: 1, TOMA: 1, MANGUERA: 2, BRIDA: 2, TRAMO: 3, VERTICAL: 3, REDUCCION: 3, INJERTO: 3, RINJ: 3, MOVER: 3 };
  function elegir(s, herr) {
    s.herr = AYUDA[herr] ? herr : 'SELECCIONAR';
    if (FASE_DE_HERR[s.herr] !== undefined) s.fase = FASE_DE_HERR[s.herr];
    s.traza = null;
    s.medir = null;
    s.caja = '';
    s.fijar = null;
    return decir(s, AYUDA[s.herr], false);
  }

  /* ------------------------------------------------------------------ equipos y tomas (Fase 1) */

  function nombreNuevo(s, tipo) {
    const base = NOMBRE_EQUIPO[tipo];
    const usados = new Set(s.t.equipos.map((e) => e.nombre));
    if (!usados.has(base)) return base;
    let i = 2;
    while (usados.has(`${base} ${i}`)) i += 1;
    return `${base} ${i}`;
  }
  /** El punto del nivel de trabajo bajo el puntero, ajustado a la rejilla del piso. */
  function puntoDelPiso(s, x, y) {
    const P = enNivel(s, x, y);
    if (!P) return null;
    return V3(ajustar(P.x, PASO_PISO_MM), ajustar(P.y, PASO_PISO_MM), s.nivel);
  }
  /** Coloca un equipo (§1.1 paso 1) donde está el puntero, apoyado en el nivel y en la rejilla de 100 mm. */
  function colocarEquipo(s, tipo, x, y) {
    const P = puntoDelPiso(s, x, y);
    if (!P) return decir(s, 'En esta vista el piso se ve de canto: use el isométrico o la planta para colocar equipos.', true);
    const nombre = nombreNuevo(s, tipo);
    const m = hacer(s, (t) => TZ.ponerEquipo(t, s.M, { tipo, nombre, posicion_mm: P, caja_mm: CAJAS[tipo] }),
      `${nombre} en X ${n(P.x)}, Y ${n(P.y)}${P.z ? `, Z ${n(P.z)}` : ''}. Ahora toque una cara de su caja para poner ${tipo === 'COLECTOR' || tipo === 'VENTILADOR' ? 'la boca' : 'la toma'}.`);
    if (!m) return false;
    const e = m.equipos[m.equipos.length - 1];
    s.sel = { tipo: 'EQUIPO', id: e.id };
    s.herr = 'TOMA';
    return true;
  }
  /** Mueve o gira el equipo seleccionado (flechas, RePág, AvPág, R): dx, dy, dz en mm y giro en grados. */
  function moverEquipo(s, id, cambio) {
    const e = s.t.equipos.find((q) => q.id === id);
    if (!e) return false;
    const pos = cambio.posicion_mm || suma(e.posicion_mm, V3(cambio.dx || 0, cambio.dy || 0, cambio.dz || 0));
    const rot = cambio.giro === undefined ? e.rotacion_z_deg : e.rotacion_z_deg + cambio.giro;
    return !!hacer(s, (t) => TZ.moverEquipo(t, s.M, id, { posicion_mm: pos, rotacion_z_deg: rot }),
      `${e.nombre} en X ${n(pos.x)}, Y ${n(pos.y)}, Z ${n(pos.z)}${rot % 360 ? `, girado ${n(((rot % 360) + 360) % 360)}°` : ''}.`);
  }
  /** Pone una toma (o la boca de un colector o ventilador) en la cara bajo el puntero (§1.1 paso 3). */
  function ponerToma(s, x, y, tactil) {
    const hit = tocar(s, x, y, tactil);
    const eid = hit && hit.tipo === 'EQUIPO' ? hit.id : (s.sel && s.sel.tipo === 'EQUIPO' ? s.sel.id : null);
    const e = eid && s.t.equipos.find((q) => q.id === eid);
    if (!e) return decir(s, 'Toque una cara de la caja de un equipo.', true);
    const cara = caraBajo(s, e, x, y, tactil);
    if (!cara) return decir(s, `Toque una cara de ${e.nombre} que se vea.`, true);
    const rol = e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? 'ENTRADA' : 'TOMA';
    const m = hacer(s, (t) => TZ.agregarPuerto(t, s.M, e.id, { rol, posicion_local_mm: cara.local, diametro_in: s.D }),
      (mm) => {
        const p = mm.equipos.find((q) => q.id === e.id).puertos.slice(-1)[0];
        return rol === 'ENTRADA' ? `Boca ${p.id} de ${e.nombre} en su ${cara.nombre}, Ø ${pulg(s.D)}, con brida.` : `Toma ${p.id} de ${e.nombre} en su ${cara.nombre}, Ø ${pulg(s.D)}. Escriba su caudal y elija el acople: manguera (F) o brida.`;
      });
    if (!m) return false;
    const p = m.equipos.find((q) => q.id === e.id).puertos.slice(-1)[0];
    s.sel = { tipo: 'PUERTO', id: p.id };
    return true;
  }

  /* ------------------------------------------------------------------ acoples (Fase 2) */

  const puertoDe = (s, pid) => s.g.puertos.get(pid) || null;
  /** La manguera de una toma: toma, eje, altura y desvío del PT, su dirección y la manguera resuelta. */
  function mangueraDe(s, pid) {
    const pu = puertoDe(s, pid);
    if (!pu || !pu.puerto.acople || pu.puerto.acople.tipo !== 'MANGUERA') return null;
    const ac = pu.puerto.acople;
    const Pt = pu.posicion_mm;
    const ut = TZ.vectorDe(pu.direccion);
    const PT = s.g.pos.get(ac.nodo_transicion);
    const h = punto(resta(PT, Pt), ut);
    const ev = resta(resta(PT, Pt), por(ut, h));
    return { pu, ac, Pt, ut, PT, h, ev, eje: suma(Pt, por(ut, h)), r: s.g.mang.get(ac.tramo_flexible), conDucto: s.g.ady.get(ac.nodo_transicion).some((x) => x.tramo.tipo === 'RIGIDO') };
  }
  function acoplar(s, pid, tipo) {
    const pu = puertoDe(s, pid);
    if (!pu) return decir(s, 'Toque una toma.', true);
    if (pu.puerto.rol !== 'TOMA') return decir(s, 'La boca del colector siempre va con brida.', true);
    s.sel = { tipo: 'PUERTO', id: pid };
    if (tipo === 'BRIDA') return !!hacer(s, (t) => TZ.acoplarBrida(t, s.M, pid), `La toma ${pid} va con brida: el ducto sale alineado con su cuello.`);
    if (pu.puerto.acople && pu.puerto.acople.tipo === 'MANGUERA') return decir(s, `La toma ${pid} ya tiene manguera: arrastre el rombo (altura) o el círculo (desvío).`, false);
    return !!hacer(s, (t) => TZ.acoplarManguera(t, s.M, pid, { altura_mm: 500 }), `La toma ${pid} va con manguera hasta su punto de transición.`);
  }
  /** Los semáforos de la manguera (§1.2 paso 3): verde, ámbar (larga) o rojo con el porqué. */
  function semaforoManguera(r, pol) {
    if (!r) return { color: 'ROJO', texto: 'Sin manguera.' };
    const forma = { RECTA: 'recta', S: 'en S', CODO: 'en curva', LIBRE: 'libre' }[r.forma];
    const datos = `${forma}${r.radio_mm ? ` · R ${n(r.radio_mm)} mm (mín. ${n(r.radio_min_mm, 1)})` : ''}${r.angulo_curva_deg ? ` · ${n(r.angulo_curva_deg, 2)}°` : ''} · ${n(r.largo_mm)} mm`;
    if (!r.posible) {
      const hmin = r.altura_min_mm && Number.isFinite(r.altura_min_mm) && r.altura_min_mm > r.altura_mm + 1e-6 ? Math.ceil(r.altura_min_mm / PASO_MANGUERA_MM) * PASO_MANGUERA_MM : null;
      return { color: 'ROJO', texto: `${r.motivo}${hmin ? ` Con este desvío, suba el punto de transición a ${n(hmin)} mm o más.` : ''}`, altura_min_mm: hmin };
    }
    if (r.larga) return { color: 'AMBAR', texto: `Manguera ${datos}: pasa del largo máximo (${n(pol.manguera.largo_max_mm)} mm).` };
    return { color: 'VERDE', texto: `Manguera ${datos}.` };
  }
  /** La altura del PT al arrastrar el rombo: a lo largo del eje de la toma, en pasos de 50 mm. */
  function alturaPorArrastre(s, pid, h0, x0, y0, x, y) {
    const mg = mangueraDe(s, pid);
    const a = pantalla(s, mg.Pt);
    const b = pantalla(s, suma(mg.Pt, mg.ut));
    const ax = V3(b.x - a.x, b.y - a.y, 0);
    const d = V3(x - x0, y - y0, 0);
    const L2 = punto(ax, ax);
    const dh = L2 > 1e-4 * s.cam.k * s.cam.k ? punto(d, ax) / L2 : -(y - y0) / s.cam.k;
    return Math.max(PASO_MANGUERA_MM, ajustar(h0 + dh, PASO_MANGUERA_MM));
  }
  /** El desvío del PT al arrastrar el círculo: en el plano perpendicular a la toma, 50 mm y rumbo cada 15°. */
  function desvioPorArrastre(s, pid, h, x, y) {
    const mg = mangueraDe(s, pid);
    const A = suma(mg.Pt, por(mg.ut, h));
    const r = enPlano(s, x, y, { punto: A, normal: mg.ut });
    if (!r.punto || r.degenerado) return null;
    let ev = resta(r.punto, A);
    ev = resta(ev, por(mg.ut, punto(ev, mg.ut)));
    const e1 = Math.abs(mg.ut.z) > 0.9 ? V3(1, 0, 0) : unitario(cruz(V3(0, 0, 1), mg.ut));
    const e2 = cruz(mg.ut, e1);
    const mag = ajustar(norma(ev), PASO_MANGUERA_MM);
    if (mag < 1e-9) return V3(0, 0, 0);
    const fi = ajustar(Math.atan2(punto(ev, e2), punto(ev, e1)) / DEG, 15) * DEG;
    const w = suma(por(e1, Math.cos(fi) * mag), por(e2, Math.sin(fi) * mag));
    return V3(r3(w.x), r3(w.y), r3(w.z));
  }
  /** Cómo quedaría la manguera con otra altura o desvío (sin cambiar nada): { r, puntos, semaforo, PT }. */
  function previaManguera(s, pid, h, ev) {
    const mg = mangueraDe(s, pid);
    const PT = suma(suma(mg.Pt, por(mg.ut, h)), ev);
    const x = { P_t: mg.Pt, u_t: mg.ut, P_r: PT, u_r: TZ.vectorDe(mg.ac.direccion_pt), diametro_in: mg.pu.puerto.diametro_in, manguera: s.t.politicas.manguera };
    const r = TZ.resolverManguera(x);
    return { r, PT, puntos: TZ.puntosManguera(x, r), semaforo: semaforoManguera(r, s.t.politicas) };
  }
  /** Fija la altura y el desvío del PT (al soltar un tirador o desde el inspector). */
  function moverManguera(s, pid, h, ev) {
    return !!hacer(s, (t) => TZ.moverTransicion(t, s.M, pid, { altura_mm: h, desvio_vector_mm: ev }), `Punto de transición de ${pid} a ${n(h)} mm sobre la toma${norma(ev) > 0.5 ? `, desviado ${n(norma(ev))} mm` : ''}.`);
  }

  /* ------------------------------------------------------------------ trazar (Fase 3) */

  /** El Ø con el que empieza un trazo: el del puerto, de la manguera o el menor de los tramos del nodo. */
  function diametroDeArranque(s, nid) {
    const pid = s.g.puertoDeNodo.get(nid);
    if (pid) return s.g.puertos.get(pid).puerto.diametro_in;
    const ad = s.g.ady.get(nid) || [];
    if (s.g.pt.has(nid)) return (ad.find((x) => x.tramo.tipo === 'FLEXIBLE') || ad[0]).tramo.diametro_in;
    if (ad.length) return Math.min(...ad.map((x) => x.tramo.diametro_in));
    return s.D;
  }
  /** Desde dónde empieza un trazo con lo que hay bajo el puntero: { desde, P0, D } o { error }. */
  function arranqueDe(s, hit, x, y) {
    const g = s.g;
    if (!hit) {
      const P = puntoDelPiso(s, x, y);
      if (!P) return { error: 'En esta vista el plano de trabajo se ve de canto: gire la vista (Q o E) o use la planta (2).' };
      return { desde: { posicion_mm: P }, P0: P, D: s.D, nombre: `X ${n(P.x)}, Y ${n(P.y)}, Z ${n(P.z)}` };
    }
    if (hit.tipo === 'EQUIPO') return { error: 'Trace desde una toma, un punto de transición, la boca del colector, un extremo libre o un tramo.' };
    if (hit.tipo === 'PUERTO' || hit.tipo === 'PT') {
      const pu = g.puertos.get(hit.id);
      const p = pu.puerto;
      if (p.rol === 'SALIDA') return { error: 'La descarga todavía no se traza.' };
      if (!p.acople) return { error: `Elija primero el acople de la toma ${p.id}: manguera (F) o brida.` };
      const nid = p.acople.tipo === 'MANGUERA' ? p.acople.nodo_transicion : p.nodo;
      return { desde: nid, P0: g.pos.get(nid), D: diametroDeArranque(s, nid), nombre: p.acople.tipo === 'MANGUERA' ? `el punto de transición de ${p.id}` : `${p.rol === 'ENTRADA' ? 'la boca' : 'la toma'} ${p.id}` };
    }
    if (hit.tipo === 'NODO') return { desde: hit.id, P0: g.pos.get(hit.id), D: diametroDeArranque(s, hit.id), nombre: hit.id };
    const t = g.tramos.get(hit.id);
    if (t.tipo !== 'RIGIDO') return { error: 'Una manguera no se parte: el ducto empieza en su punto de transición.' };
    if (!g.conocido(t.id)) return { error: `Conecte primero ${t.id} al colector: sin saber hacia dónde va el aire no se le puede injertar nada.` };
    const L = g.seg.get(t.id).L;
    const lim = s.t.politicas.largo_min_tramo_mm;
    if (L < 2 * lim) return { error: `${t.id} es demasiado corto para injertarle un ramal.` };
    const sm = clamp(ajustar(hit.s_mm, 50), lim, L - lim);
    const P0 = suma(g.pos.get(t.a), por(g.seg.get(t.id).u, sm));
    return { desde: { tramo: t.id, s_mm: sm }, P0, D: Math.min(s.D, t.diametro_in), nombre: `${t.id} a ${metros(sm)} de ${t.a}`, tronco: t };
  }
  /** Empieza un trazo (§1.3 paso 1) desde lo que hay bajo el puntero; el Ø activo pasa a ser el del arranque. */
  function empezar(s, hit, x, y) {
    if (s.herr === 'RINJ' || s.herr === 'INJERTO') {
      if (!hit || hit.tipo !== 'TRAMO') return decir(s, s.herr === 'RINJ' ? 'Una reducción con injerto sale de un tramo: arrastre desde él.' : 'Un injerto sale de un tramo que ya llega al colector: arrastre desde él.', true);
    }
    const a = arranqueDe(s, hit, x, y);
    if (a.error) return decir(s, a.error, true);
    let ops;
    try { ops = TZ.candidatas(s.t, s.M, a.desde); } catch (e) { if (e instanceof TZ.TrazadoError) return decir(s, textoError(e), true); throw e; }
    if (!ops.length) return decir(s, TZ.textoCandidatas(a.nombre, ops), true);
    if (s.herr === 'RINJ' && !(s.D2 < a.tronco.diametro_in)) return decir(s, `El tronco después debe ser menor que ${a.tronco.id} (${pulg(a.tronco.diametro_in)}): elija «tronco después».`, true);
    s.D = s.herr === 'RINJ' ? Math.min(s.D, s.D2) : a.D;
    s.traza = { desde: a.desde, P0: a.P0, nombre: a.nombre, ops, previa: null, fija: null, tab: 0, iman: null, cache: new Map(), rinj: s.herr === 'RINJ' };
    s.caja = '';
    s.fijar = null;
    return decir(s, TZ.textoCandidatas(a.nombre, ops), false);
  }
  /** Mayús sostenida (§1.3 paso 5): conserva la dirección del fantasma y el largo va de 10 en 10 mm; Alt, de 1 en 1. */
  function teclasSostenidas(s, mayus, alt) {
    s.mayus = !!mayus;
    s.alt = !!alt;
    if (s.traza) s.traza.fija = s.mayus ? s.traza.fija || s.traza.previa : null;
  }

  /** El tramo que llega al arranque (para el plano de trabajo): su dirección hacia el arranque, o null. */
  function llegaA(s, desde) {
    if (typeof desde !== 'string') return null;
    const ad = (s.g.ady.get(desde) || []).filter((x) => x.tramo.tipo === 'RIGIDO');
    if (ad.length !== 1) return null;
    return por(s.g.fuera(ad[0].tramo, desde), -1);
  }
  /** El plano vertical que más se ve de frente en esta vista (X–Z o Y–Z). */
  function verticalDeFrente(s, P0) {
    const f = adelante(s.vista);
    return Math.abs(f.y) >= Math.abs(f.x) ? { punto: P0, normal: V3(0, 1, 0), nombre: 'plano vertical X–Z' } : { punto: P0, normal: V3(1, 0, 0), nombre: 'plano vertical Y–Z' };
  }
  /**
   * El plano de trabajo (§2.1.2): la tecla de fijar, si hay; horizontal si el tramo que llega es vertical; vertical si el
   * arrastre va a menos de 12° de la vertical de la pantalla y se puede subir o bajar; si no, horizontal.
   */
  function planoDeTrabajo(s, x, y) {
    const tr = s.traza;
    const P0 = tr.P0;
    const llega = llegaA(s, tr.desde);
    const vertical = () => {
      const hzt = llega ? V3(llega.x, llega.y, 0) : null;
      if (hzt && norma(hzt) > 1e-6) { const u = unitario(hzt); return { punto: P0, normal: V3(-u.y, u.x, 0), nombre: 'plano vertical del último tramo' }; }
      return verticalDeFrente(s, P0);
    };
    const horizontal = () => ({ tipo: 'PLANO', plano: { ...TZ.planoHorizontal(P0.z), nombre: `plano horizontal z = ${n(P0.z)}` } });
    const fijo = s.fijar || (s.herr === 'VERTICAL' ? 'Z' : null);
    if (fijo === 'X' || fijo === 'Y' || fijo === 'Z') return { tipo: 'EJE', eje: EJES[fijo], nombre: `eje ${fijo}` };
    if (fijo === 'H') return horizontal();
    if (fijo === 'V') return { tipo: 'PLANO', plano: vertical() };
    if (llega && Math.abs(llega.z) > 0.999) return horizontal();
    const q = pantalla(s, P0);
    const dx = x - q.x;
    const dy = y - q.y;
    const desvio = Math.abs(Math.atan2(dx, dy) / DEG); // 0° hacia abajo, 180° hacia arriba
    if (Math.hypot(dx, dy) > 4 && Math.min(desvio, 180 - desvio) < 12 && tr.ops.some((o) => o.direccion.elevacion_deg !== 0)) return { tipo: 'PLANO', plano: vertical() };
    return horizontal();
  }

  /** La caja de valores (§1.3 paso 4): «3.25» o «3250mm» (un número sin unidad hasta 100 es en m), «<45», «@135», «^45». */
  function leerCaja(txt) {
    const r = {};
    String(txt || '').trim().split(/\s+/).filter(Boolean).forEach((tok) => {
      const num = (x) => Number(x.replace(',', '.'));
      let m = /^<(\d+(?:[.,]\d+)?)°?$/.exec(tok);
      if (m) { r.codo = num(m[1]); return; }
      m = /^@(-?\d+(?:[.,]\d+)?)°?$/.exec(tok);
      if (m) { r.azimut = ((num(m[1]) % 360) + 360) % 360; return; }
      m = /^\^(-?\d+(?:[.,]\d+)?)°?$/.exec(tok);
      if (m) { r.elevacion = num(m[1]); return; }
      m = /^(\d+(?:[.,]\d+)?)(mm|cm|m)?$/i.exec(tok);
      if (m) {
        const v = num(m[1]);
        const u = (m[2] || '').toLowerCase();
        r.largo = u === 'mm' ? v : u === 'cm' ? v * 10 : u === 'm' ? v * 1000 : v <= 100 ? v * 1000 : v;
        return;
      }
      r.error = tok;
    });
    return r;
  }
  const PERMITIDO_CAJA = /^[0-9.,<@^\-mMcC°]$/;
  /** Una tecla para la caja de valores: dígitos y < @ ^ . , m c; Retroceso borra. Devuelve si la tomó. */
  function teclear(s, k) {
    if (k === 'Backspace') { if (!s.caja) return false; s.caja = s.caja.slice(0, -1); return true; }
    if (k === ' ' && s.caja) { s.caja += ' '; return true; }
    if (k.length !== 1 || !PERMITIDO_CAJA.test(k)) return false;
    if (/^[mMcC]$/.test(k) && !/\d$/.test(s.caja) && !/[mc]$/i.test(s.caja)) return false;
    s.caja = (s.caja + k).slice(0, 24);
    return true;
  }

  /** Lo que es normal mientras se traza (una red que todavía no llega al colector, el extremo de la cadena): no pinta el fantasma. */
  const DE_TRAZO_EN_CURSO = new Set(['EXTREMO_ABIERTO', 'SUBRED_SIN_COLECTOR', 'TOMA_SIN_CONEXION']);
  const nombrePieza = (o) => ({ RECTO: 'recto', CODO: `codo de ${o.giro_deg}°`, INJERTO: `injerto a ${o.giro_deg}°`, T_90: 'T a 90°' }[o.pieza] || o.pieza);
  const entradaTexto = (o) => (o.entrada ? `, ${o.entrada === 'SUPERIOR' ? 'por arriba' : `de lado${o.giro_entrada_deg === null || o.giro_entrada_deg === undefined ? '' : o.giro_entrada_deg > 180 ? ' (izquierda)' : ' (derecha)'}`}` : '');

  /** Las candidatas por cercanía al vector v (en mm) o, sin plano, por su ángulo en la pantalla. */
  function ordenar(s, cands, P0, v, x, y) {
    if (v) return cands.map((o) => ({ o, a: anguloEntre(TZ.vectorDe(o.direccion), v) })).sort((a, b) => a.a - b.a);
    const q = pantalla(s, P0);
    const d = V3(x - q.x, y - q.y, 0);
    // sin arrastre (clic y una medida tecleada): primero las que van hacia +X, +Y o +Z
    if (norma(d) < 1e-6) return cands.map((o) => { const u = TZ.vectorDe(o.direccion); return { o, a: -(u.x + u.y + u.z) }; }).sort((a, b) => a.a - b.a);
    return cands.map((o) => {
      const b = pantalla(s, suma(P0, por(TZ.vectorDe(o.direccion), 1000)));
      const pr = V3(b.x - q.x, b.y - q.y, 0);
      return { o, a: norma(pr) < 1e-6 || norma(d) < 1e-6 ? 180 : anguloEntre(pr, d), pr };
    }).sort((a, b) => a.a - b.a);
  }
  /** El largo que da el puntero en la dirección d (por el plano o, si no hay, por la pantalla). */
  function largoPorPuntero(s, P0, d, v, x, y) {
    const u = TZ.vectorDe(d);
    if (v) return punto(v, u);
    const q = pantalla(s, P0);
    const b = pantalla(s, suma(P0, por(u, 1000)));
    const pr = V3(b.x - q.x, b.y - q.y, 0);
    const L2 = punto(pr, pr);
    return L2 > 1e-6 ? (punto(V3(x - q.x, y - q.y, 0), pr) / L2) * 1000 : 0;
  }

  /** Lo que hay que buscar para el imán: un puerto, PT o extremo libre bajo el puntero, o un tramo con sentido a 16 px. */
  function objetivoIman(s, x, y, tactil) {
    const tr = s.traza;
    if (typeof tr.desde !== 'string') return null;
    const ex = new Set([tr.desde, ...(s.g.ady.get(tr.desde) || []).map((a) => a.tramo.id)]);
    const r = tactil ? CAPTURA_PX.dedo : CAPTURA_PX.raton;
    let mejor = null;
    s.t.nodos.forEach((nd) => {
      if (ex.has(nd.id)) return;
      const tipo = tipoNodo(s, nd.id);
      if (tipo !== 'PUERTO' && tipo !== 'PT' && tipo !== 'EXTREMO') return;
      const q = pantalla(s, nd.posicion_mm);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d <= Math.max(r, IMAN_PX) && (!mejor || d < mejor.d)) mejor = { d, objetivo: { nodo: nd.id }, nombre: tipo === 'PUERTO' ? `${s.g.puertos.get(s.g.puertoDeNodo.get(nd.id)).puerto.rol === 'ENTRADA' ? 'la boca' : 'la toma'} ${s.g.puertoDeNodo.get(nd.id)}` : tipo === 'PT' ? `el punto de transición de ${s.g.pt.get(nd.id)}` : `el extremo ${nd.id}` };
    });
    if (mejor) return mejor;
    s.t.tramos.forEach((t) => {
      if (ex.has(t.id) || t.tipo !== 'RIGIDO' || !s.g.conocido(t.id)) return;
      const A = s.g.pos.get(t.a);
      const B = s.g.pos.get(t.b);
      const { d, f } = distSeg({ x, y }, pantalla(s, A), pantalla(s, B));
      if (d <= IMAN_PX + Math.max(4, t.diametro_in * IN * s.cam.k) / 2 && (!mejor || d < mejor.d)) {
        const L = s.g.seg.get(t.id).L;
        const P = suma(A, por(resta(B, A), Math.round((f * L) / 100) * 100 / Math.max(L, 1e-9)));
        mejor = { d, objetivo: { tramo: t.id, puntero: P }, nombre: `el tramo ${t.id}` };
      }
    });
    return mejor;
  }

  /**
   * El fantasma del trazo bajo el puntero (§1.3 pasos 2, 4 a 8; §2.1): la dirección permitida más cercana en el plano de
   * trabajo, el largo al paso (o el tecleado), el Ø activo, la pieza, su color (OK, AVISO o ERROR) y su etiqueta; con el
   * imán, las rutas propuestas. { ok, estado, P0, P1, op, largo, D, texto, plano, ruta?, rutas?, i? }.
   */
  function fantasma(s, x, y, tactil) {
    const tr = s.traza;
    if (!tr) return null;
    const P0 = tr.P0;
    const pol = s.t.politicas;
    const caja = leerCaja(s.caja);
    if (caja.error) return { ok: false, estado: 'ERROR', P0, texto: `No entiendo «${caja.error}»: escriba un largo (3.25 o 3250mm), <45, @135 o ^45.` };
    // el imán manda si el puntero está sobre algo a donde llegar (y no hay un largo o un rumbo tecleado)
    if (!s.fijar && caja.largo === undefined && caja.azimut === undefined && caja.elevacion === undefined && caja.codo === undefined && !s.mayus) {
      const ob = objetivoIman(s, x, y, tactil);
      if (ob) {
        const clave = JSON.stringify([ob.objetivo, s.D]);
        if (!tr.cache.has(clave)) {
          let rs = [];
          try { rs = TZ.rutas(s.t, s.M, tr.desde, ob.objetivo, { diametro_in: s.D }); } catch (e) { if (!(e instanceof TZ.TrazadoError)) throw e; }
          tr.cache.set(clave, rs);
          if (tr.cache.size > 64) tr.cache.delete(tr.cache.keys().next().value);
        }
        const rs = tr.cache.get(clave);
        if (rs.length) {
          const i = tr.tab % rs.length;
          const ruta = rs[i];
          const pts = [P0];
          ruta.segmentos.forEach((sg) => pts.push(suma(pts[pts.length - 1], por(TZ.vectorDe(sg.direccion), sg.largo_mm))));
          const otras = rs.length > 1 ? ` (Tab: ${i + 1} de ${rs.length})` : '';
          const avisos = ruta.avisos.filter((p) => !DE_TRAZO_EN_CURSO.has(p.codigo));
          return {
            ok: true, estado: avisos.length ? 'AVISO' : 'OK', P0, P1: pts[pts.length - 1], puntos: pts, D: s.D, ruta, rutas: rs, i, iman: ob,
            texto: `Imán (${ob.nombre}): ${ruta.texto}${otras}${avisos.length ? ` ${avisos[0].mensaje}` : ''}`,
          };
        }
        tr.sinIman = `El imán no encuentra cómo llegar a ${ob.nombre} desde aquí.`;
      } else tr.sinIman = null;
    }
    const pl = planoDeTrabajo(s, x, y);
    let cands = tr.ops;
    if (pl.tipo === 'EJE') cands = cands.filter((o) => norma(cruz(TZ.vectorDe(o.direccion), pl.eje)) < 1e-9);
    else cands = cands.filter((o) => Math.abs(punto(TZ.vectorDe(o.direccion), unitario(pl.plano.normal))) < 1e-9);
    const nombrePlano = pl.tipo === 'EJE' ? pl.nombre : pl.plano.nombre;
    let v = null;
    if (pl.tipo === 'PLANO') {
      const r = enPlano(s, x, y, pl.plano);
      if (r.punto && !r.degenerado) v = resta(r.punto, P0);
    }
    // lo tecleado: rumbo, elevación o codo
    let op = null;
    if (caja.azimut !== undefined || caja.elevacion !== undefined || caja.codo !== undefined) {
      const base = tr.previa || (tr.ops[0] && tr.ops[0].direccion);
      if (caja.codo !== undefined) {
        const conCodo = tr.ops.filter((o) => o.pieza === 'CODO' && o.giro_deg === caja.codo);
        const enPlanoCodo = conCodo.filter((o) => cands.includes(o));
        const lista = enPlanoCodo.length ? enPlanoCodo : conCodo;
        if (!lista.length) return { ok: false, estado: 'ERROR', P0, texto: `Desde aquí no sale un codo de ${n(caja.codo)}°. ${TZ.textoCandidatas(tr.nombre, tr.ops)}` };
        op = ordenar(s, lista, P0, v, x, y)[0].o;
      } else {
        const el = caja.elevacion !== undefined ? caja.elevacion : base.elevacion_deg;
        const az = Math.abs(el) === 90 ? 0 : caja.azimut !== undefined ? caja.azimut : base.azimut_deg;
        op = tr.ops.find((o) => igualDir(o.direccion, { azimut_deg: az, elevacion_deg: el }));
        if (!op) return { ok: false, estado: 'ERROR', P0, texto: `Desde aquí el ducto no puede ir en ${TZ.textoDireccion({ azimut_deg: az, elevacion_deg: el })}. ${TZ.textoCandidatas(tr.nombre, tr.ops)}` };
      }
    } else if (s.mayus && tr.fija && tr.ops.some((o) => igualDir(o.direccion, tr.fija))) {
      op = tr.ops.find((o) => igualDir(o.direccion, tr.fija));
    } else {
      if (!cands.length) {
        return { ok: false, estado: 'ERROR', P0, texto: `Con el ${nombrePlano} no se puede salir de aquí. ${TZ.textoCandidatas(tr.nombre, tr.ops)}`, plano: nombrePlano };
      }
      const orden = ordenar(s, cands, P0, v, x, y);
      if (tr.tab && orden.length > 1) op = orden[tr.tab % Math.min(3, orden.length)].o;
      else if (v) op = TZ.elegirDireccion(cands, v, tr.previa, 3) || orden[0].o;
      else {
        const prev = tr.previa && orden.find((q) => igualDir(q.o.direccion, tr.previa));
        op = prev && prev.a - orden[0].a < 3 ? prev.o : orden[0].o;
      }
    }
    tr.previa = op.direccion;
    const paso = s.alt ? 1 : s.mayus ? 10 : pol.paso_largo_mm;
    let largo = caja.largo !== undefined ? caja.largo : TZ.ajustarLargo(largoPorPuntero(s, P0, op.direccion, pl.tipo === 'PLANO' && v ? v : null, x, y), pol, paso);
    largo = Math.min(largo, 100000);
    let guia = null;
    if (caja.largo === undefined && !s.alt) {
      const al = alinear(s, P0, op.direccion, largo, tr.desde);
      if (al) { largo = al.largo; guia = al.guia; }
    }
    const D = s.D;
    const P1 = suma(P0, por(TZ.vectorDe(op.direccion), largo));
    let texto = `${metros(largo)} · ${pulg(D)} · ${nombrePieza(op)}${entradaTexto(op)} · ${TZ.textoDireccion(op.direccion)}`;
    if (tr.rinj) texto += ` · el tronco de aguas arriba queda de ${pulg(s.D2)}`;
    // ¿se puede? se prueba en el modelo (sin cambiar nada) y se miran los avisos de lo nuevo
    const clave = JSON.stringify([op.direccion, largo, D, tr.rinj ? s.D2 : 0]);
    if (!tr.cache.has(clave)) {
      let res;
      try {
        let m = TZ.trazar(s.t, s.M, tr.desde, { direccion: op.direccion, largo_mm: largo, diametro_in: D });
        if (tr.rinj) m = TZ.reducir(m, s.M, derivacionDe(m, tr.desde), s.D2);
        const nuevos = new Set(m.ultimo.tramos);
        const avisos = TZ.revisar(m, s.M).filter((p) => (p.severidad === 'ERROR' || p.severidad === 'AVISO') && p.elementos.some((e) => nuevos.has(e)) && !DE_TRAZO_EN_CURSO.has(p.codigo));
        res = { ok: true, estado: avisos.length ? 'AVISO' : 'OK', avisos };
      } catch (e) {
        if (!(e instanceof TZ.TrazadoError)) throw e;
        res = { ok: false, estado: 'ERROR', motivo: textoError(e) };
      }
      tr.cache.set(clave, res);
      if (tr.cache.size > 64) tr.cache.delete(tr.cache.keys().next().value);
    }
    const res = tr.cache.get(clave);
    if (!res.ok) texto += ` — ${res.motivo}`;
    else if (res.avisos.length) texto += ` — ${res.avisos[0].mensaje}`;
    if (tr.sinIman) texto += ` (${tr.sinIman})`;
    return { ok: res.ok, estado: res.estado, P0, P1, op, largo, D, texto, plano: nombrePlano, tecleado: caja.largo !== undefined, guia };
  }
  /**
   * Alineación (§2.1.6 punto 4): si el final del fantasma queda a menos de 8 px de tener la misma X, Y o Z que un nodo, el
   * largo se ajusta a esa coordenada (exacto) y se dibuja la guía hasta el nodo.
   */
  function alinear(s, P0, d, L, desde) {
    const u = TZ.vectorDe(d);
    const q1 = pantalla(s, suma(P0, por(u, L)));
    const min = s.t.politicas.largo_min_tramo_mm;
    let mejor = null;
    s.t.nodos.forEach((nd) => {
      if (nd.id === desde) return;
      ['x', 'y', 'z'].forEach((k) => {
        if (Math.abs(u[k]) < 1e-9) return;
        const L2 = (nd.posicion_mm[k] - P0[k]) / u[k];
        if (L2 < min - 1e-9 || L2 > 100000) return;
        const P2 = suma(P0, por(u, L2));
        const q2 = pantalla(s, P2);
        const dd = Math.hypot(q2.x - q1.x, q2.y - q1.y);
        if (dd <= ALINEAR_PX && norma(resta(P2, nd.posicion_mm)) > 1 && (!mejor || dd < mejor.dd)) mejor = { dd, largo: r3(L2), guia: { de: P2, a: nd.posicion_mm, eje: k.toUpperCase(), nodo: nd.id } };
      });
    });
    return mejor;
  }
  /** El nodo de la derivación que acaba de salir de un trazo desde { tramo } (el arranque del ramal). */
  function derivacionDe(m, desde) {
    const tid = m.ultimo.tramos[0];
    const t = m.tramos.find((q) => q.id === tid);
    return typeof desde === 'string' ? desde : t.a;
  }

  /**
   * Confirma el fantasma (soltar, clic o Entrar): traza el tramo (y su codo o injerto) o conecta la ruta del imán. En modo
   * cadena el trazo sigue desde el extremo nuevo; al llegar a algo (con el imán, o a un nodo que ya existía) termina.
   */
  function confirmar(s, x, y, tactil) {
    const tr = s.traza;
    if (!tr) return false;
    const f = fantasma(s, x, y, tactil);
    if (!f.ok) return decir(s, f.texto, true);
    const desde = tr.desde;
    let m;
    if (f.ruta) {
      m = hacer(s, (t) => TZ.conectar(t, s.M, desde, { ...f.ruta, diametro_in: f.D }), `${f.ruta.texto}`);
      if (!m) return false;
      s.traza = null;
      s.sel = { tipo: 'TRAMO', id: m.ultimo.tramos[m.ultimo.tramos.length - 1] };
      s.caja = '';
      s.fijar = null;
      return true;
    }
    const antes = new Set(s.t.nodos.map((q) => q.id));
    m = hacer(s, (t) => {
      let m1 = TZ.trazar(t, s.M, desde, { direccion: f.op.direccion, largo_mm: f.largo, diametro_in: f.D });
      if (tr.rinj) {
        const nodo = derivacionDe(m1, desde);
        const tramos = m1.ultimo.tramos;
        const fin = m1.ultimo.nodo;
        m1 = TZ.reducir(m1, s.M, nodo, s.D2);
        m1.ultimo = { ...m1.ultimo, nodo: fin, tramos: [...tramos, ...m1.ultimo.tramos] };
      }
      return m1;
    }, (mm) => `Tramo ${mm.ultimo.tramos[0]}: ${metros(f.largo)} · ${pulg(f.D)} · ${nombrePieza(f.op)}${entradaTexto(f.op)}.`);
    if (!m) return false;
    s.caja = '';
    s.fijar = null;
    const fin = m.ultimo.nodo;
    s.sel = { tipo: 'TRAMO', id: m.ultimo.tramos[0] };
    const libre = !antes.has(fin) && tipoNodo(s, fin) === 'EXTREMO';
    const ops = libre ? TZ.candidatas(s.t, s.M, fin) : [];
    if (!ops.length) { s.traza = null; return true; }
    s.traza = { desde: fin, P0: s.g.pos.get(fin), nombre: fin, ops, previa: f.op.direccion, fija: f.op.direccion, tab: 0, iman: null, cache: new Map(), rinj: false };
    if (tr.rinj) s.D = Math.min(s.D, s.D2);
    return true;
  }
  /** Esc: borra lo tecleado; si no hay, termina la cadena. */
  function cancelar(s) {
    if (s.caja) { s.caja = ''; return decir(s, 'Se borró lo tecleado.', false); }
    if (s.fijar) { s.fijar = null; return decir(s, 'El plano de trabajo vuelve a ser automático.', false); }
    if (s.traza) { s.traza = null; return decir(s, 'Terminó el trazo.', false); }
    if (s.medir) { s.medir = null; return decir(s, '', false); }
    if (s.sel) { s.sel = null; return decir(s, '', false); }
    return false;
  }
  /** ↑ → ← H V (§1.3 paso 5): fija el eje o el plano; la misma tecla otra vez lo suelta. */
  function fijar(s, modo) {
    s.fijar = s.fijar === modo ? null : modo;
    if (s.traza) s.traza.tab = 0;
    const que = { X: 'el eje X', Y: 'el eje Y', Z: 'el eje Z (sube o baja)', H: 'el plano horizontal', V: 'el plano vertical del último tramo' }[modo];
    return decir(s, s.fijar ? `Fijo ${que}. Teclee el largo y Entrar, o arrastre.` : 'El plano de trabajo vuelve a ser automático.', false);
  }
  /** Tab: la siguiente de las tres mejores direcciones (o la siguiente propuesta del imán). */
  function siguienteOpcion(s) {
    if (!s.traza) return false;
    s.traza.tab += 1;
    return true;
  }
  /** [ y ]: baja o sube el Ø activo un tamaño comercial. */
  function cambiarDiametroActivo(s, paso, cual) {
    const com = s.t.politicas.diametros_comerciales_in;
    const k = cual === 'D2' ? 'D2' : 'D';
    const i = com.indexOf(s[k]);
    const j = clamp((i < 0 ? com.findIndex((d) => d >= s[k]) : i) + paso, 0, com.length - 1);
    s[k] = com[j];
    if (s.traza) s.traza.tab = 0;
    return decir(s, `${k === 'D2' ? 'Tronco después' : 'Ø activo'}: ${pulg(s[k])}.`, false);
  }
  /** RePág y AvPág: sube o baja el nivel de trabajo (donde se colocan los equipos y empiezan los trazos sueltos). */
  function cambiarNivel(s, paso) {
    s.nivel = Math.max(0, s.nivel + paso * PASO_NIVEL_MM);
    return decir(s, `Nivel de trabajo: z = ${n(s.nivel)} mm.`, false);
  }

  /* ------------------------------------------------------------------ editar (§1.3 pasos 9 a 11) */

  /** Reducción (R): en un tramo baja el Ø desde ese punto hacia las tomas; en un codo o derivación, el tramo que le llega. */
  function reducirEn(s, hit) {
    if (!hit || (hit.tipo !== 'TRAMO' && hit.tipo !== 'NODO')) return decir(s, 'Toque un tramo, o el codo, donde baja el Ø.', true);
    const desde = hit.tipo === 'TRAMO' ? { tramo: hit.id, s_mm: ajustar(hit.s_mm || 0, 50) } : hit.id;
    return !!hacer(s, (t) => TZ.reducir(t, s.M, desde, s.D), (m) => `Desde ${m.ultimo.nodo} hacia las tomas el ducto queda de ${pulg(s.D)}: ${m.ultimo.tramos.join(', ')}.`);
  }
  /** Compuerta (G): en el punto tocado de un tramo recto (a 50 mm) o en un nodo que une dos tramos rectos del mismo Ø. */
  function compuertaEn(s, hit) {
    if (!hit || (hit.tipo !== 'TRAMO' && hit.tipo !== 'NODO')) return decir(s, 'Toque un tramo recto donde va la compuerta.', true);
    const desde = hit.tipo === 'TRAMO' ? { tramo: hit.id, s_mm: ajustar(hit.s_mm || 0, 50) } : hit.id;
    return !!hacer(s, (t) => TZ.ponerCompuerta(t, s.M, desde), (m) => `Compuerta ${(m.piezas[m.ultimo.nodo] || {}).COMPUERTA} en ${m.ultimo.nodo}: abierta. En la salida, el balanceo dice cuánto cerrarla.`);
  }
  /**
   * La compuerta que pide el balanceo para la corriente que llega por un tramo: a la mitad del primer tramo recto de su tramo
   * propio (del que llega a la confluencia hacia las tomas) en que cabe.
   */
  function compuertaSugerida(s, tramoId) {
    const cand = [];
    for (let t = s.g.tramos.get(tramoId); t && t.tipo === 'RIGIDO' && !cand.includes(t); ) {
      cand.push(t);
      const arriba = s.g.arriba.get(t.id);
      const entran = arriba ? s.g.entran(arriba) : [];
      t = entran.length === 1 ? entran[0] : null;
    }
    for (const t of cand) {
      const L = s.g.seg.get(t.id).L;
      const desde = { tramo: t.id, s_mm: ajustar(L / 2, 50) };
      try { TZ.ponerCompuerta(s.t, s.M, desde); } catch (e) { if (e instanceof TZ.TrazadoError) continue; throw e; }
      return !!hacer(s, (m) => TZ.ponerCompuerta(m, s.M, desde), (m) => `Compuerta ${(m.piezas[m.ultimo.nodo] || {}).COMPUERTA} a la mitad de ${t.id}: el balanceo dice cuánto cerrarla.`);
    }
    return decir(s, `No cabe una compuerta en el tramo propio de ${tramoId}: alárguelo o póngala a mano.`, true);
  }
  /** Quita la compuerta de un nodo (los dos tramos se vuelven a fundir si siguen en línea). */
  function quitarCompuerta(s, nodo) {
    const r = hacer(s, (m) => TZ.quitarCompuerta(m, s.M, nodo), `Se quitó la compuerta de ${nodo}.`);
    if (r && s.sel && s.sel.id === nodo) s.sel = null;
    return !!r;
  }
  /** Mover segmento (M): el desplazamiento w (perpendicular al tramo, paralelo a sus vecinos) por el arrastre. */
  function desplazamientoSegmento(s, tid, x0, y0, x, y) {
    const t = s.g.tramos.get(tid);
    if (!t || t.tipo !== 'RIGIDO') return { error: 'Arrastre un tramo rígido.' };
    const u = s.g.seg.get(tid).u;
    const dirs = [];
    [t.a, t.b].forEach((nid) => (s.g.ady.get(nid) || []).forEach(({ tramo }) => {
      if (tramo.id === tid || tramo.tipo !== 'RIGIDO') return;
      const d = s.g.fuera(tramo, nid);
      if (Math.abs(punto(d, u)) < 1e-9 && !dirs.some((q) => norma(cruz(q, d)) < 1e-9)) dirs.push(d);
    }));
    if (!dirs.length) return { error: `${tid} no tiene vecinos que puedan alargarse o acortarse para seguirlo.` };
    const d = V3(x - x0, y - y0, 0);
    let mejor = null;
    dirs.forEach((w) => {
      const a = pantalla(s, V3(0, 0, 0));
      const b = pantalla(s, w);
      const pr = V3(b.x - a.x, b.y - a.y, 0);
      const L2 = punto(pr, pr);
      if (L2 < 1e-9) return;
      const mm = punto(d, pr) / L2;
      const err = norma(resta(d, por(pr, mm)));
      if (!mejor || err < mejor.err) mejor = { w, mm, err };
    });
    if (!mejor) return { error: 'En esta vista no se ve hacia dónde se mueve: gire la vista.' };
    const paso = s.alt ? 1 : s.mayus ? 10 : s.t.politicas.paso_largo_mm;
    const mm = ajustar(mejor.mm, paso);
    const w = por(mejor.w, mm);
    return { w: V3(r3(w.x), r3(w.y), r3(w.z)), mm };
  }
  function moverSegmento(s, tid, w) {
    if (norma(w) < 1e-9) return false;
    return !!hacer(s, (t) => TZ.moverSegmento(t, s.M, tid, w), `${tid} se movió ${n(norma(w))} mm.`);
  }
  /** Borrar (Supr; Mayús+Supr el ramal completo). */
  function borrar(s, x, ramal) {
    if (!x) return decir(s, 'Seleccione lo que quiere borrar.', true);
    if (x.tipo === 'TRAMO') {
      const t = s.g.tramos.get(x.id);
      if (t && t.tipo === 'FLEXIBLE') { const pid = s.g.puertoDeNodo.get(t.a); return !!hacer(s, (m) => TZ.desacoplar(m, s.M, pid), `Se quitó la manguera de ${pid}.`); }
      const r = hacer(s, (m) => TZ.borrarTramo(m, s.M, x.id, { ramal: !!ramal }), ramal ? `Se borró el ramal de ${x.id} hasta sus tomas.` : `Se borró ${x.id}.`);
      if (r) s.sel = null;
      return !!r;
    }
    if (x.tipo === 'EQUIPO') {
      const e = s.t.equipos.find((q) => q.id === x.id);
      const r = hacer(s, (m) => TZ.quitarEquipo(m, s.M, x.id), `Se quitó ${e ? e.nombre : x.id}.`);
      if (r) s.sel = null;
      return !!r;
    }
    if (x.tipo === 'PUERTO' || x.tipo === 'PT') {
      const pu = s.g.puertos.get(x.id);
      if (x.tipo === 'PT' || (pu && pu.puerto.acople && pu.puerto.acople.tipo === 'MANGUERA' && !ramal)) return !!hacer(s, (m) => TZ.desacoplar(m, s.M, x.id), `Se quitó la manguera de ${x.id}.`);
      const r = hacer(s, (m) => TZ.quitarPuerto(m, s.M, x.id), `Se quitó ${x.id}.`);
      if (r) s.sel = null;
      return !!r;
    }
    if (x.tipo === 'NODO') {
      if ((s.g.piezasDe.get(x.id) || []).some((p) => p.tipo === 'COMPUERTA')) return quitarCompuerta(s, x.id);
      const ad = s.g.ady.get(x.id) || [];
      if (ad.length === 1) return borrar(s, { tipo: 'TRAMO', id: ad[0].tramo.id }, ramal);
      return decir(s, 'Seleccione un tramo para borrarlo.', true);
    }
    return false;
  }
  /** Medir (D): el punto de lo que hay bajo el puntero, o del nivel de trabajo. */
  function puntoMedible(s, hit, x, y) {
    if (hit && (hit.tipo === 'PUERTO' || hit.tipo === 'PT' || hit.tipo === 'NODO')) return s.g.pos.get(hit.nodo);
    if (hit && hit.tipo === 'TRAMO' && hit.punto) return hit.punto;
    return enNivel(s, x, y);
  }
  function medir(s, hit, x, y) {
    const P = puntoMedible(s, hit, x, y);
    if (!P) return decir(s, 'Toque un punto del dibujo.', true);
    if (!s.medir || s.medir.B) { s.medir = { A: P, B: null }; return decir(s, 'Toque el segundo punto.', false); }
    s.medir.B = P;
    const d = resta(P, s.medir.A);
    return decir(s, `Distancia ${metros(norma(d))}: ΔX ${n(d.x)} mm, ΔY ${n(d.y)} mm, ΔZ ${n(d.z)} mm.`, false);
  }

  /* ------------------------------------------------------------------ corregir (etapa 3: §1.4 paso 3, §2.11) */

  const claveDe = (p) => `${p.codigo}|${[...p.elementos].sort().join(',')}`;
  /** Los arreglos automáticos de un problema (del modelo, ya probados), guardados mientras el trazo no cambie. */
  function correccionesDe(s, problema) {
    if (!TZ.CORREGIBLES.includes(problema.codigo)) return [];
    if (!s.correc || s.correc.t !== s.t) s.correc = { t: s.t, mapa: new Map() };
    const k = claveDe(problema);
    if (!s.correc.mapa.has(k)) s.correc.mapa.set(k, TZ.correcciones(s.t, s.M, problema));
    return s.correc.mapa.get(k);
  }
  /** ¿Ya se buscaron los arreglos de este problema con el trazo de hoy? */
  const correccionesListas = (s, problema) => !!(s.correc && s.correc.t === s.t && s.correc.mapa.has(claveDe(problema)));
  /** Aplica un arreglo (con deshacer); selecciona lo que tocó. */
  function corregir(s, c) {
    const m = hacer(s, (t) => TZ.corregir(t, s.M, c), `${c.texto.replace(/\.$/, '')}: hecho.`);
    if (!m) return false;
    const tr = (m.ultimo.tramos || []).find((id) => s.g.tramos.has(id));
    if (tr) s.sel = { tipo: 'TRAMO', id: tr };
    return true;
  }
  /**
   * Cambiar el Ø de un tramo desde el inspector. Si el modelo lo rechaza porque hacia el colector el Ø bajaría o un ramal
   * pasaría de su tronco, devuelve la alternativa en cadena (§2.6) ya probada: { alternativa: { texto, tramos } }.
   */
  function cambiarDiametroTramo(s, tramoId, D) {
    if (hacer(s, (t) => TZ.cambiarDiametro(t, s.M, tramoId, D), `${tramoId}: ${pulg(D)}.`)) return { ok: true };
    const msg = s.msg;
    let m;
    try { m = TZ.cambiarDiametro(s.t, s.M, tramoId, D, { cadena: true }); } catch (e) { if (e instanceof TZ.TrazadoError) return { ok: false }; throw e; }
    const otros = m.ultimo.tramos.slice(1);
    if (!otros.length) return { ok: false };
    decir(s, msg, true);
    return { ok: false, alternativa: { texto: `Cambiar en cadena: ${tramoId} y ${otros.join(', ')} a ${pulg(D)}`, tramos: m.ultimo.tramos } };
  }
  function cambiarDiametroEnCadena(s, tramoId, D) {
    return !!hacer(s, (t) => TZ.cambiarDiametro(t, s.M, tramoId, D, { cadena: true }), (m) => `${m.ultimo.tramos.join(', ')}: ${pulg(D)}.`);
  }
  /** La decisión de un tramo corto: PEGAR, ACEPTAR o null. */
  function decidirCorto(s, tramoId, decision) {
    const que = { PEGAR: 'se arman pegadas, sin bridas en esas caras', ACEPTAR: 'tramo corto aceptado, con bridas' }[decision];
    return !!hacer(s, (t) => TZ.decidirCorto(t, s.M, tramoId, decision), `${tramoId}: ${que || 'sin decidir'}.`);
  }

  /* ------------------------------------------------------------------ lo que se muestra en el inspector */

  const velocidadSemaforo = (s, v) => (v === null ? null : v < s.t.politicas.velocidad_min_m_s - 1e-9 || v > s.t.politicas.velocidad_max_m_s + 1e-9 ? 'AMBAR' : 'VERDE');
  /** Un tramo: Ø, largo a ejes y neto con lo que ocupa cada pieza, dirección, caudal, velocidad y uniones. */
  function infoTramo(s, id) {
    const g = s.g;
    const t = g.tramos.get(id);
    if (!t) return null;
    const rig = t.tipo === 'RIGIDO';
    const L = rig ? g.seg.get(id).L : (g.mang.get(id) || { largo_mm: 0 }).largo_mm;
    const arriba = g.arriba.get(id) || null;
    const dir = rig ? (arriba ? TZ.direccionDeVector(g.aire(t)) : g.seg.get(id).dir) : null;
    const Q = g.Q.get(id);
    const v = g.v.get(id);
    const oc = g.ocupa.get(id) || [];
    const neta = g.neta.get(id);
    const corto = rig && oc.length && neta >= -1e-3 && neta < s.t.politicas.recto_min_entre_accesorios_mm - 1e-6
      ? { neta, piezas: [...new Set(oc.map((o) => o.pieza.id || o.pieza.tipo))], dosLados: new Set(oc.map((o) => o.nodo)).size === 2, decision: t.corto || null }
      : null;
    return {
      corto,
      id, tipo: t.tipo, diametro_in: t.diametro_in, bloqueado: t.diametro_bloqueado, material: t.material, calibre: t.calibre, largo_mm: L, neta_mm: g.neta.get(id),
      descuentos: g.ocupa.get(id).map((o) => ({ pieza: o.pieza.id || o.pieza.tipo, tipo: o.pieza.tipo, mm: o.mm })),
      direccion: dir ? TZ.textoDireccion(dir) : null, sentido: arriba ? `de ${arriba} a ${g.abajo.get(id)}` : null, caudal: Q, velocidad: v, semaforo: velocidadSemaforo(s, v),
      manguera: rig ? null : semaforoManguera(g.mang.get(id), s.t.politicas),
    };
  }
  /** Las piezas de un nodo con su nombre largo. */
  function piezasDe(s, nid) {
    return (s.g.piezasDe.get(nid) || []).map((p) => {
      const ga = p.geometria;
      const c = p.conexiones;
      const entrada = ga.entrada ? `, ${ga.entrada === 'SUPERIOR' ? 'por arriba' : 'de lado'}` : '';
      let nombre;
      let corto;
      switch (p.tipo) {
        case 'CODO':
          nombre = `Codo de ${ga.angulo_deg}° de ${pulg(c[0].diametro_in)}${ga.gajos ? ` (${ga.gajos} gajos, R ${n(ga.radio_eje_mm)} mm)` : ''}`;
          corto = `Codo ${ga.angulo_deg}°`;
          break;
        case 'REDUCCION':
          nombre = `Reducción ${ga.forma === 'CONCENTRICA' ? 'concéntrica' : 'excéntrica, cara plana abajo'} de ${pulg(p.D1)} a ${pulg(p.D2)}`;
          corto = `Red. ${pulg(p.D1)}→${pulg(p.D2)}`;
          break;
        case 'ADAPTADOR':
          nombre = `Adaptador de ${pulg(p.D_puerto)} a ${pulg(c[0].diametro_in)}`;
          corto = `Adapt. ${pulg(p.D_puerto)}→${pulg(c[0].diametro_in)}`;
          break;
        case 'INJERTO':
          nombre = `Injerto simple a ${ga.angulo_deg}° de ${pulg(c[0].diametro_in)} con ramal de ${pulg(c[2].diametro_in)}${entrada}`;
          corto = `Injerto ${ga.angulo_deg}°`;
          break;
        case 'REDUCCION_INJERTO':
          nombre = `Reducción con injerto a ${ga.angulo_deg}° de ${pulg(Math.max(c[0].diametro_in, c[1].diametro_in))} a ${pulg(Math.min(c[0].diametro_in, c[1].diametro_in))}, ramal de ${pulg(c[2].diametro_in)}${entrada}`;
          corto = `Red. c/ injerto ${ga.angulo_deg}°`;
          break;
        case 'T_90':
          nombre = `T a 90° con ramal de ${pulg(c[2].diametro_in)} (COTIZAP todavía no la cotiza)`;
          corto = 'T 90°';
          break;
        case 'COMPUERTA':
          nombre = `Compuerta de regulación de ${pulg(c[0].diametro_in)} (${n(ga.largo_mm)} mm con sus cuellos)`;
          corto = 'Compuerta';
          break;
        default:
          nombre = p.tipo;
          corto = p.tipo;
      }
      return { id: p.id, tipo: p.tipo, nombre, corto, angulo: ga.angulo_deg };
    });
  }

  /* ------------------------------------------------------------------ salida y cálculo (Fase 5) */

  /**
   * El cálculo de la red (src/motor/perdidas.js, etapa 4) sobre el JSON del sistema: { sistema, hoja } o { error } con el
   * porqué. Se guarda mientras el trazo no cambie.
   */
  function calculo(s) {
    if (s.calc && s.calc.t === s.t) return s.calc.r;
    let r;
    try {
      r = PD.calcular(TZ.aSistema(s.t, s.M));
    } catch (e) {
      if (e instanceof TZ.TrazadoError) r = { error: `Para calcular, primero corrija los problemas: ${textoError(e).replace(/^No se puede exportar mientras haya /, 'hay ')}` };
      else if (e instanceof PD.CalculoError) r = { error: e.message };
      else throw e;
    }
    s.calc = { t: s.t, r };
    return r;
  }
  /**
   * El trazo a partidas (motor/trazado_lectura.js, §5.6): la lectura para las reglas del unifilar, su despiece y los avisos,
   * guardado mientras el trazo, las tablas y la yarda no cambien. { error } si todavía no se puede pasar.
   */
  function despiece(s, yarda_mm) {
    const y = yarda_mm === 1220 ? 1220 : 914.4;
    if (s.desp && s.desp.t === s.t && s.desp.M === s.M && s.desp.y === y) return s.desp.r;
    const r = TL.despiece(s.t, s.M, { yarda_mm: y });
    s.desp = { t: s.t, M: s.M, y, r };
    return r;
  }
  const NOMBRE_ACCION = { NINGUNA: 'Balanceada', AJUSTAR_CAUDAL: 'Ajustar caudal', REDIMENSIONAR: 'Redimensionar', COMPUERTA: 'Compuerta' };
  /**
   * El cálculo para mostrarlo: ventiladores, tomas (con su equipo y la crítica), balance y la hoja por tramo con su Ø.
   * { error } si no se puede calcular.
   */
  function informeCalculo(s) {
    const c = calculo(s);
    if (c.error) return { error: c.error };
    const R = c.sistema.resultados;
    const equipo = (id) => s.t.equipos.find((e) => e.id === id);
    const dePuerto = (pid) => s.t.equipos.find((e) => e.puertos.some((p) => p.id === pid));
    return {
      ventiladores: R.ventiladores.map((v) => ({ ...v, nombre: equipo(v.equipo) ? equipo(v.equipo).nombre : v.equipo })),
      tomas: R.por_toma.map((x) => ({ ...x, nombre: dePuerto(x.puerto) ? dePuerto(x.puerto).nombre : x.puerto, critica: x.puerto === c.hoja.critica })),
      balance: R.balance.map((b) => {
        const cf = c.hoja.confluencias.find((x) => x.nodo === b.nodo);
        const co = cf && cf.corrientes.find((x) => x.t.id === b.corriente_menor);
        return { ...b, nombre_accion: NOMBRE_ACCION[b.accion], cierre: co && co.cierre ? { ...co.cierre } : null };
      }),
      tramos: R.por_tramo.map((x) => ({ ...x, diametro_in: c.sistema.tramos.find((t) => t.id === x.tramo).diametro_in, locales: c.hoja.filas.get(x.tramo).locales.map((l) => l.que) })),
      aire: c.hoja.aire,
    };
  }
  const NOMBRE_LOCAL = { CODO: 'codo', RAMAL: 'entrada del ramal', CURVAS: 'curvas de la manguera', EXPANSION: 'expansión', CONTRACCION: 'contracción', ACELERACION: 'aceleración en la confluencia', COMPUERTA: 'compuerta' };
  /** El renglón del cálculo de un tramo (caudal, velocidad, succión al final…) con sus pérdidas locales en palabras, o null. */
  function filaCalculo(s, id) {
    const c = calculo(s);
    const r = c.error ? null : c.sistema.resultados.por_tramo.find((x) => x.tramo === id);
    if (!r) return null;
    const locales = c.hoja.filas.get(id).locales.map((l) => ({ que: l.que, id: l.id, K: l.K, Pa: l.Pa, texto: `${NOMBRE_LOCAL[l.que] || l.que}${l.id ? ` ${l.id}` : ''}${l.K === null ? '' : ` (K ${Number(l.K.toFixed(4))})`}` }));
    return { ...r, locales };
  }

  /**
   * El JSON del sistema (§3), con el cálculo de pérdidas si se puede; con errores, sólo como borrador (sin cálculo).
   * { texto, borrador, calculado, aviso } o { error }.
   */
  function exportar(s, borrador) {
    try {
      const sis = TZ.aSistema(s.t, s.M, { borrador: !!borrador });
      if (borrador) return { texto: JSON.stringify(sis, null, 2), borrador: true, calculado: false, aviso: null };
      const c = calculo(s);
      return { texto: JSON.stringify(c.sistema || sis, null, 2), borrador: false, calculado: !c.error, aviso: c.error || null };
    } catch (e) {
      if (e instanceof TZ.TrazadoError) return { error: textoError(e) };
      throw e;
    }
  }
  /** Lee un JSON del sistema y lo abre (con deshacer). */
  function importar(s, texto) {
    let x;
    try { x = JSON.parse(texto); } catch (e) { return decir(s, 'El texto no es un JSON válido.', true); }
    const r = TZ.desdeSistema(x, s.M);
    if (!r.modelo) return decir(s, `No se pudo abrir el sistema: ${r.errores.join(' ')}`, true);
    reemplazar(s, r.modelo, `Se abrió el sistema ${r.modelo.proyecto.nombre}.`);
    return true;
  }

  /**
   * El ejemplo resuelto (§1.6) armado con las operaciones del modelo: colector, sierra con brida, cepillo con manguera,
   * el tronco hasta la boca, el ramal con el imán, dimensionado y renumerado. Es el JSON de docs/ejemplos.
   */
  function ejemplo(M) {
    const dir = (az, el) => ({ azimut_deg: az, elevacion_deg: el || 0 });
    let t = TZ.nuevo(M, { proyecto: { id: 'EJ-TRAZADO-01', nombre: 'Ejemplo: sierra y cepillo a un colector', servicio: 'POLVO', material_transportado: 'Aserrín y viruta de madera', aire: { temperatura_C: 20, altitud_m: 2240 }, origen: 'Centro de la base del colector, sobre el piso terminado' } });
    t = TZ.ponerEquipo(t, M, { tipo: 'COLECTOR', nombre: 'Colector de polvo', posicion_mm: V3(0, 0, 0), caja_mm: { largo: 1500, ancho: 1500, alto: 4000 }, perdida_Pa: 1250 });
    t = TZ.agregarPuerto(t, M, 'EQ-01', { rol: 'ENTRADA', nombre: 'Boca del colector', posicion_local_mm: V3(750, 0, 3000), diametro_in: 8 });
    t = TZ.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Sierra de banco', posicion_mm: V3(10750, 0, 0), caja_mm: { largo: 1200, ancho: 800, alto: 1200 } });
    t = TZ.agregarPuerto(t, M, 'EQ-02', { nombre: 'Toma superior', posicion_local_mm: V3(0, 0, 1200), diametro_in: 6, caudal_m3_h: 1300, coef_entrada_K: 0.5 });
    t = TZ.acoplarBrida(t, M, 'PU-02', { barrenos: { numero: 6, circulo_mm: 190, diametro_mm: 9.5 } });
    t = TZ.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Cepillo', posicion_mm: V3(7000, -3000, 0), caja_mm: { largo: 1000, ancho: 600, alto: 1000 } });
    t = TZ.agregarPuerto(t, M, 'EQ-03', { nombre: 'Toma superior', posicion_local_mm: V3(0, 0, 1000), diametro_in: 5, caudal_m3_h: 900, coef_entrada_K: 0.5 });
    t = TZ.acoplarManguera(t, M, 'PU-03', { altura_mm: 900, desvio_mm: 250, desvio_azimut_deg: 90 });
    const toma = (eq) => t.equipos.find((e) => e.id === eq).puertos[0];
    t = TZ.trazar(t, M, toma('EQ-02').nodo, { direccion: dir(0, 90), largo_mm: 1800 });
    t = TZ.conectar(t, M, t.ultimo.nodo, TZ.rutas(t, M, t.ultimo.nodo, { nodo: toma('EQ-01').nodo })[0]);
    const tronco = t.ultimo.tramos[0];
    t = TZ.trazar(t, M, toma('EQ-03').acople.nodo_transicion, { direccion: dir(0, 90), largo_mm: 1100 });
    const cola = t.ultimo.nodo;
    t = TZ.conectar(t, M, cola, TZ.rutas(t, M, cola, { tramo: tronco })[0]);
    return TZ.renumerar(TZ.aplicarDimensiones(t, M), M);
  }

  return {
    CAJAS, FASES, VISTAS, NOMBRE_VISTA, AYUDA, CAPTURA_PX, IMAN_PX, ALINEAR_PX,
    crear, recalcular, hacer, reemplazar, deshacer, rehacer, decir,
    adelante, profundidad, pantalla, enPlano, enNivel, esquinas, carasVisibles, encuadrar, zoom, desplazar, medidas, ponerVista, girarVista,
    tocar, caraBajo, fases, irFase, elegir,
    colocarEquipo, moverEquipo, ponerToma, puntoDelPiso,
    mangueraDe, acoplar, semaforoManguera, alturaPorArrastre, desvioPorArrastre, previaManguera, moverManguera,
    arranqueDe, empezar, teclasSostenidas, planoDeTrabajo, leerCaja, teclear, fantasma, alinear, confirmar, cancelar, fijar, siguienteOpcion, cambiarDiametroActivo, cambiarNivel,
    reducirEn, compuertaEn, compuertaSugerida, quitarCompuerta, desplazamientoSegmento, moverSegmento, borrar, medir,
    correccionesDe, correccionesListas, corregir, cambiarDiametroTramo, cambiarDiametroEnCadena, decidirCorto,
    infoTramo, piezasDe, velocidadSemaforo, calculo, informeCalculo, filaCalculo, NOMBRE_ACCION, despiece, exportar, importar, ejemplo,
  };
}));
