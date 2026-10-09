/**
 * COTIZAP · unifilar_cad.js — El dibujo del unifilar: un CAD sencillo para armar la ductería con trazos (docs/dibujo-unifilar.md).
 *
 * El dibujo es un árbol que crece desde el colector, como se arma la red: cada tramo sale de un punto que ya existe (el
 * colector, el final de otro tramo o un punto a la mitad de un tramo) y se aleja del colector. Cada tramo guarda su diámetro,
 * su largo a ejes y su dirección: horizontal, con un rumbo en planta múltiplo de 15°, o vertical (sube o baja). Las posiciones
 * salen de los tramos: cambiar un largo o un ángulo mueve todo lo que está más allá.
 *
 * Las reglas del taller se cumplen al dibujar: codos sólo a proceso.angulos_codo_deg; injertos sólo a
 * proceso.angulos_injerto_deg, a favor del flujo y sobre un tronco recto horizontal; el diámetro no crece alejándose del
 * colector y un injerto no es mayor que su tronco; el colector tiene una boca y un equipo es el final de su ramal. Lo que no se
 * puede hacer se rechaza con el porqué (CadError); `revisar` encuentra lo que queda por resolver.
 *
 * `aLectura` lo convierte en una lectura del esquema de docs/unifilar-bom.schema.json con todo de origen USUARIO (diámetros,
 * cotas a ejes y ángulos), y motor/unifilar.js saca las piezas con las mismas reglas que a un croquis leído.
 * Puro: cada operación devuelve un modelo nuevo y no muta el recibido.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util'), require('./unifilar'));
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.unifilarCad = factory(root.COTIZAP.util, root.COTIZAP.unifilar);
  }
}(typeof self !== 'undefined' ? self : this, function (U, UF) {
  'use strict';

  const VERSION = 1;
  const IN = 25.4;
  const LARGO_MIN_MM = 100; // el tramo más corto que se dibuja (y lo mínimo de cada lado de un injerto o una reducción)
  const LARGO_MAX_MM = 100000; // el más largo que el motor cotiza en una partida
  const PASO_RUMBO = 15;
  const MAX_TRAMOS = 500;
  const MAX_EQUIPOS = 300;
  const MAX_COORD_MM = 1e7;
  const MANGUERA_MAX = 50;
  /** Lo que se puede poner en un extremo, y cómo lo entiende la lectura (tipo y conexión del equipo). */
  const CLASES = {
    COLECTOR: { tipo: 'COLECTOR', conexion: 'BRIDA_EQUIPO', nombre: 'Colector', texto: 'Colector (brida del equipo)' },
    MAQUINA_MANGUERA: { tipo: 'MAQUINA', conexion: 'MANGUERA', nombre: 'Máquina', texto: 'Máquina con manguera' },
    MAQUINA_BRIDA: { tipo: 'MAQUINA', conexion: 'BRIDA_EQUIPO', nombre: 'Máquina', texto: 'Máquina con brida' },
    CAMPANA: { tipo: 'CAMPANA', conexion: 'BRIDA_TALLER', nombre: 'Campana', texto: 'Campana (brida del taller)' },
    ABIERTO: { tipo: 'OTRO', conexion: 'LISO', nombre: 'Extremo abierto', texto: 'Extremo abierto (sin brida)' },
  };
  const CON_BOCA = ['COLECTOR', 'MAQUINA_BRIDA'];
  const DIRS = ['H', 'SUBE', 'BAJA'];
  const COS30 = Math.cos(Math.PI / 6);
  const PX_POR_MM = 0.1; // la lectura que sale del dibujo: 1 px = 1 cm

  class CadError extends Error {
    constructor(mensaje, refs) {
      super(mensaje);
      this.name = 'CadError';
      this.refs = refs || [];
    }
  }
  const falla = (mensaje, refs) => { throw new CadError(mensaje, refs); };

  const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const r1 = (x) => Math.round(x * 10) / 10;
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const id3 = (pref, n) => `${pref}-${String(n).padStart(3, '0')}`;
  const idEq = (n) => `EQ-${String(n).padStart(2, '0')}`;
  const norm360 = (a) => ((Math.round(a) % 360) + 360) % 360;
  /** El giro de un rumbo a otro, de -180 a 180: positivo a la izquierda (contra las manecillas, visto desde arriba). */
  const giroFirmado = (de, a) => ((a - de + 540) % 360) - 180;
  const pulgadas = (x) => `${r1(x)}″`.replace('.0″', '″');
  const metros = (mm) => `${(Math.round(mm) / 1000).toLocaleString('es-MX', { maximumFractionDigits: 3 })} m`;
  const lista = (xs, y) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${y || 'o'} ${xs[xs.length - 1]}` : String(xs[0]));
  const RUMBOS = Array.from({ length: 360 / PASO_RUMBO }, (_, i) => i * PASO_RUMBO);

  /** cos y sen de un rumbo en grados, exactos en los múltiplos de 90°. */
  function cosSen(az) {
    const a = norm360(az);
    const exactos = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
    if (exactos[a]) return exactos[a];
    const r = (a * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r)];
  }
  /** La dirección de un tramo como vector unitario (x al este, y al norte, z hacia arriba). */
  function vector(t) {
    if (t.dir === 'SUBE') return { x: 0, y: 0, z: 1 };
    if (t.dir === 'BAJA') return { x: 0, y: 0, z: -1 };
    const [c, s] = cosSen(t.az_deg);
    return { x: c, y: s, z: 0 };
  }

  /** El giro del ducto en un nodo, del tramo que llega al que sale: { grados, lado ('IZQ'/'DER'/null), plano ('H'/'V') }. */
  function giro(ti, to) {
    if (ti.dir === 'H' && to.dir === 'H') {
      const g = giroFirmado(ti.az_deg, to.az_deg);
      return { grados: Math.abs(g), lado: g > 0 ? 'IZQ' : g < 0 ? 'DER' : null, plano: 'H' };
    }
    if (ti.dir === 'H' || to.dir === 'H') return { grados: 90, lado: null, plano: 'V' };
    return { grados: ti.dir === to.dir ? 0 : 180, lado: null, plano: 'V' };
  }

  const colectorDe = (m) => m.equipos.find((e) => e.clase === 'COLECTOR');

  /**
   * El árbol del dibujo: el tramo que llega a cada nodo, los que salen, el equipo, el orden desde el colector y la posición de
   * cada nodo en mm.
   */
  function geometria(m) {
    const raiz = colectorDe(m).nodo;
    const entra = new Map();
    const salen0 = new Map();
    m.tramos.forEach((t) => {
      entra.set(t.a, t);
      if (!salen0.has(t.de)) salen0.set(t.de, []);
      salen0.get(t.de).push(t);
    });
    const salen = (nid) => salen0.get(nid) || [];
    const equipo = new Map(m.equipos.map((e) => [e.nodo, e]));
    const pos = new Map([[raiz, { x: m.colector.x, y: m.colector.y, z: m.colector.z }]]);
    const orden = [raiz];
    for (let i = 0; i < orden.length; i += 1) {
      salen(orden[i]).forEach((t) => {
        if (pos.has(t.a)) return;
        const p = pos.get(t.de);
        const v = vector(t);
        pos.set(t.a, { x: r6(p.x + v.x * t.largo_mm), y: r6(p.y + v.y * t.largo_mm), z: r6(p.z + v.z * t.largo_mm) });
        orden.push(t.a);
      });
    }
    // el tronco de cada derivación: el que sigue recto; los demás son ramales
    const tronco = (nid) => {
      const ti = entra.get(nid);
      return ti ? salen(nid).find((s) => giro(ti, s).grados === 0) || null : null;
    };
    return { raiz, entra, salen, equipo, pos, orden, tronco };
  }

  /** Lo más que puede medir el diámetro de un tramo: el del que llega a su nodo y, si es un ramal, el de su tronco. */
  function limiteDe(g, t) {
    const ti = g.entra.get(t.de);
    if (!ti) return { D: Infinity, por: null };
    const tr = g.tronco(t.de);
    // un ramal: no más que su tronco (que a su vez no pasa del que llega)
    if (tr && tr !== t && g.salen(t.de).length > 1 && tr.D_in <= ti.D_in) return { D: tr.D_in, por: tr, ramal: true };
    return { D: ti.D_in, por: ti, ramal: false };
  }

  /* ------------------------------------------------------------------ crear y revisar lo guardado */

  /** Un dibujo nuevo: sólo el colector, con su boca en el origen. */
  function nuevo(M, opciones) {
    const o = esObjeto(opciones) ? opciones : {};
    const material = M.materiales[o.material] ? o.material : 'GALVANIZADO';
    const tabla = M.calibres[M.materiales[material].tabla_calibre] || {};
    const calibre = tabla[String(o.calibre)] !== undefined ? Number(o.calibre) : 22;
    return {
      version: VERSION, colector: { x: 0, y: 0, z: 0 }, tramos: [],
      equipos: [{ id: 'EQ-01', clase: 'COLECTOR', nombre: 'Colector', nodo: 'N-001', boca_in: null, manguera_tramos: null }],
      material, calibre, cuenta: { N: 1, A: 0, EQ: 1 },
    };
  }

  const numeroDe = (id) => Number(String(id).replace(/^\D+-/, '')) || 0;

  /**
   * Un dibujo que viene de fuera (la cotización guardada o un archivo): sólo con la forma esperada y una red que sea un árbol
   * desde el colector. Devuelve { modelo, errores }; modelo null si no sirve.
   */
  function validar(x, M) {
    const errores = [];
    if (!esObjeto(x) || x.version !== VERSION || !Array.isArray(x.tramos) || !Array.isArray(x.equipos)) return { modelo: null, errores: ['No es un dibujo de unifilar de esta versión.'] };
    if (x.tramos.length > MAX_TRAMOS || x.equipos.length > MAX_EQUIPOS) return { modelo: null, errores: ['El dibujo es demasiado grande.'] };
    const c = esObjeto(x.colector) ? x.colector : {};
    const coord = (v) => (finito(v) && Math.abs(v) <= MAX_COORD_MM ? v : 0);
    const reNodo = /^N-\d{3,4}$/;
    const tramos = x.tramos.filter(esObjeto).map((t) => ({
      id: t.id, de: t.de, a: t.a, D_in: Number(t.D_in), largo_mm: Math.round(Number(t.largo_mm)),
      dir: DIRS.includes(t.dir) ? t.dir : null, az_deg: t.dir === 'H' && finito(t.az_deg) ? norm360(t.az_deg) : 0,
      encimado: t.encimado === 'UNION' || t.encimado === 'TRAMO' ? t.encimado : null, corto: t.corto === true,
    }));
    const ids = new Set();
    tramos.forEach((t) => {
      if (typeof t.id !== 'string' || !/^A-\d{3,4}$/.test(t.id) || ids.has(t.id)) errores.push(`Un tramo no tiene un identificador válido (${String(t.id)}).`);
      ids.add(t.id);
      if (typeof t.de !== 'string' || !reNodo.test(t.de) || typeof t.a !== 'string' || !reNodo.test(t.a) || t.de === t.a) errores.push(`El tramo ${t.id} no une dos nodos válidos.`);
      if (!UF.COMERCIALES_IN.includes(t.D_in)) errores.push(`El tramo ${t.id} no trae un diámetro comercial.`);
      if (!(t.largo_mm >= LARGO_MIN_MM && t.largo_mm <= LARGO_MAX_MM)) errores.push(`El tramo ${t.id} no trae un largo válido.`);
      if (!t.dir) errores.push(`El tramo ${t.id} no trae su dirección.`);
      if (t.dir === 'H' && t.az_deg % PASO_RUMBO !== 0) errores.push(`El rumbo del tramo ${t.id} no es múltiplo de ${PASO_RUMBO}°.`);
    });
    const equipos = x.equipos.filter(esObjeto).map((e) => ({
      id: e.id, clase: Object.prototype.hasOwnProperty.call(CLASES, e.clase) ? e.clase : null,
      nombre: typeof e.nombre === 'string' && e.nombre.trim() ? e.nombre.trim().slice(0, 60) : (CLASES[e.clase] || {}).nombre || 'Equipo', nodo: e.nodo,
      boca_in: CON_BOCA.includes(e.clase) && finito(e.boca_in) && e.boca_in > 0 && e.boca_in <= 120 ? e.boca_in : null,
      manguera_tramos: e.clase === 'MAQUINA_MANGUERA' && Number.isInteger(e.manguera_tramos) && e.manguera_tramos >= 1 && e.manguera_tramos <= MANGUERA_MAX ? e.manguera_tramos : null,
    }));
    const idsEq = new Set();
    const nodosEq = new Set();
    equipos.forEach((e) => {
      if (typeof e.id !== 'string' || !/^EQ-\d{2,3}$/.test(e.id) || idsEq.has(e.id)) errores.push(`Un equipo no tiene un identificador válido (${String(e.id)}).`);
      idsEq.add(e.id);
      if (!e.clase) errores.push(`El equipo ${e.id} no es de una clase conocida.`);
      if (typeof e.nodo !== 'string' || !reNodo.test(e.nodo) || nodosEq.has(e.nodo)) errores.push(`El equipo ${e.id} no está en un nodo válido.`);
      nodosEq.add(e.nodo);
    });
    const colectores = equipos.filter((e) => e.clase === 'COLECTOR');
    if (colectores.length !== 1) errores.push('El dibujo debe tener un colector.');
    if (errores.length) return { modelo: null, errores: errores.slice(0, 12) };
    // un árbol desde el colector: a cada nodo llega a lo más un tramo y todos se alcanzan desde el colector
    const raiz = colectores[0].nodo;
    const llega = new Map();
    tramos.forEach((t) => { if (llega.has(t.a) || t.a === raiz) errores.push(`Al nodo ${t.a} llega más de un tramo.`); llega.set(t.a, t); });
    const alcanzados = new Set([raiz]);
    const cola = [raiz];
    while (cola.length) {
      const n = cola.shift();
      tramos.filter((t) => t.de === n).forEach((t) => { if (!alcanzados.has(t.a)) { alcanzados.add(t.a); cola.push(t.a); } });
    }
    tramos.forEach((t) => { if (!alcanzados.has(t.a)) errores.push(`El tramo ${t.id} no se conecta con el colector.`); });
    equipos.forEach((e) => {
      if (e.clase === 'COLECTOR') return;
      if (!llega.has(e.nodo)) errores.push(`El equipo ${e.id} no está al final de un tramo.`);
      else if (tramos.some((t) => t.de === e.nodo)) errores.push(`El equipo ${e.id} no está en un extremo.`);
    });
    if (errores.length) return { modelo: null, errores: [...new Set(errores)].slice(0, 12) };
    const material = M.materiales[x.material] ? x.material : 'GALVANIZADO';
    const tabla = M.calibres[M.materiales[material].tabla_calibre] || {};
    const calibre = tabla[String(x.calibre)] !== undefined ? Number(x.calibre) : 22;
    // los contadores: nunca por debajo de los identificadores que hay (para no repetir ninguno)
    const nodos = [raiz, ...tramos.flatMap((t) => [t.de, t.a])];
    const k0 = esObjeto(x.cuenta) ? x.cuenta : {};
    const contador = (v, minimo) => (Number.isInteger(v) && v >= minimo && v < 1e4 ? v : minimo);
    const cuenta = {
      N: contador(k0.N, Math.max(...nodos.map(numeroDe))), A: contador(k0.A, Math.max(0, ...tramos.map((t) => numeroDe(t.id)))), EQ: contador(k0.EQ, Math.max(...equipos.map((e) => numeroDe(e.id)))),
    };
    return { modelo: { version: VERSION, colector: { x: coord(c.x), y: coord(c.y), z: coord(c.z) }, tramos, equipos, material, calibre, cuenta }, errores: [] };
  }

  /* ------------------------------------------------------------------ hacia dónde puede salir un tramo */

  const opcion = (dir, az, pieza, grados, lado) => ({ dir, az_deg: dir === 'H' ? norm360(az) : 0, pieza, giro_deg: grados, lado: lado || null });
  const verticales = (pieza) => [opcion('SUBE', 0, pieza, 90), opcion('BAJA', 0, pieza, 90)];

  /**
   * Las direcciones en que puede salir un tramo nuevo desde un nodo, cada una con la pieza que se forma en el nodo
   * (INICIO, RECTO, CODO, INJERTO o TRONCO: seguir recto y que lo que ya salía quede como injerto). { opciones, motivo }:
   * sin opciones, el motivo dice por qué.
   */
  function salidas(m, M, nodoId) {
    const g = geometria(m);
    if (!g.pos.has(nodoId)) return { opciones: [], motivo: `No existe el punto ${nodoId}.` };
    const ANG_CODO = M.proceso.angulos_codo_deg;
    const ANG_INJ = M.proceso.angulos_injerto_deg;
    const ti = g.entra.get(nodoId);
    const sal = g.salen(nodoId);
    const eq = g.equipo.get(nodoId);
    if (!ti) {
      if (sal.length) return { opciones: [], motivo: 'El colector tiene una sola boca: para otra derivación, injerte en un tramo.' };
      return { opciones: [...RUMBOS.map((az) => opcion('H', az, 'INICIO', null)), ...verticales('INICIO')] };
    }
    if (eq) return { opciones: [], motivo: `«${eq.nombre}» es el final de su ramal: quite el equipo para seguir el ducto.` };
    if (!sal.length) {
      if (ti.dir === 'H') {
        const codos = ANG_CODO.flatMap((a) => [opcion('H', ti.az_deg + a, 'CODO', a, 'IZQ'), opcion('H', ti.az_deg - a, 'CODO', a, 'DER')]);
        return { opciones: [opcion('H', ti.az_deg, 'RECTO', 0), ...codos, ...verticales('CODO')] };
      }
      return { opciones: [...RUMBOS.map((az) => opcion('H', az, 'CODO', 90)), opcion(ti.dir, 0, 'RECTO', 0)] };
    }
    if (sal.length === 1) {
      const to = sal[0];
      if (ti.dir !== 'H' || to.dir !== 'H') return { opciones: [], motivo: `En ${nodoId} el ducto cambia entre horizontal y vertical: sólo se injerta en tramos horizontales.` };
      const gi = giro(ti, to);
      if (gi.grados === 0) {
        return { opciones: ANG_INJ.flatMap((b) => [opcion('H', to.az_deg + b, 'INJERTO', b, 'IZQ'), opcion('H', to.az_deg - b, 'INJERTO', b, 'DER')]) };
      }
      // seguir recto desde un codo de 30° o 45°: el codo queda como injerto
      if (ANG_INJ.includes(gi.grados)) return { opciones: [opcion('H', ti.az_deg, 'TRONCO', 0)], nota: `En ${nodoId} hay un codo de ${gi.grados}°: sólo se puede seguir recto, y lo que sale a ${gi.grados}° queda como injerto.` };
      return { opciones: [], motivo: `En ${nodoId} hay un codo de ${gi.grados}°: no se injerta en un codo. Injerte en un tramo recto.` };
    }
    return { opciones: [], motivo: `En ${nodoId} ya hay un injerto: cada injerto va en su propio punto del tronco.` };
  }

  /** Los rumbos de un injerto a la mitad de un tramo (sólo en horizontales, a los ángulos del taller y a favor del flujo). */
  function salidasEnTramo(m, M, tramoId) {
    const t = m.tramos.find((x) => x.id === tramoId);
    if (!t) return { opciones: [], motivo: `No existe el tramo ${tramoId}.` };
    if (t.dir !== 'H') return { opciones: [], motivo: `El tramo ${tramoId} es vertical: sólo se injerta en tramos horizontales.` };
    return { opciones: M.proceso.angulos_injerto_deg.flatMap((b) => [opcion('H', t.az_deg + b, 'INJERTO', b, 'IZQ'), opcion('H', t.az_deg - b, 'INJERTO', b, 'DER')]) };
  }

  /* ------------------------------------------------------------------ operaciones */

  function largoValido(v) {
    const mm = Math.round(Number(v));
    if (!(mm >= LARGO_MIN_MM && mm <= LARGO_MAX_MM)) falla(`El largo de un tramo va de ${metros(LARGO_MIN_MM)} a ${metros(LARGO_MAX_MM)}.`);
    return mm;
  }
  function diametroValido(v) {
    const d = Number(v);
    if (!UF.COMERCIALES_IN.includes(d)) falla(`El diámetro debe ser comercial: ${lista(UF.COMERCIALES_IN.map(pulgadas))}.`);
    return d;
  }
  // los identificadores no se repiten (las respuestas de la revisión van por identificador) y caben en el esquema:
  // N-### y A-### hasta 4 cifras, EQ-## hasta 3
  const nuevoNodo = (m) => { if (m.cuenta.N >= 9999) falla('El dibujo ya usó 9 999 puntos: empiece uno nuevo.'); m.cuenta.N += 1; return id3('N', m.cuenta.N); };
  const nuevoTramo = (m) => { if (m.cuenta.A >= 9999) falla('El dibujo ya usó 9 999 tramos: empiece uno nuevo.'); m.cuenta.A += 1; return id3('A', m.cuenta.A); };
  const tramoDe = (m, id) => m.tramos.find((t) => t.id === id) || falla(`No existe el tramo ${id}.`, [id]);

  /**
   * Dos tramos seguidos en línea recta y del mismo diámetro son un solo tramo (si no pasan del largo máximo): el de antes se
   * alarga y el punto de en medio desaparece.
   */
  function fusionar(m) {
    for (let cambio = true; cambio;) {
      cambio = false;
      const g = geometria(m);
      const t = m.tramos.find((x) => {
        const sal = g.salen(x.a);
        return sal.length === 1 && !g.equipo.has(x.a) && sal[0].D_in === x.D_in && giro(x, sal[0]).grados === 0 && x.largo_mm + sal[0].largo_mm <= LARGO_MAX_MM;
      });
      if (t) {
        const s = g.salen(t.a)[0];
        t.largo_mm += s.largo_mm;
        t.a = s.a;
        t.encimado = null;
        t.corto = false;
        m.tramos = m.tramos.filter((x) => x !== s);
        cambio = true;
      }
    }
    return m;
  }

  /** Reduce los diámetros que quedaron mayores que su límite (alejándose del colector no crecen); devuelve los que cambió. */
  function limitar(m) {
    const g = geometria(m);
    const cambiados = [];
    g.orden.forEach((nid) => {
      const tr = g.tronco(nid);
      const sal = [...g.salen(nid)].sort((a, b) => (a === tr ? -1 : b === tr ? 1 : 0));
      sal.forEach((t) => {
        const lim = limiteDe(g, t).D;
        if (t.D_in > lim) { t.D_in = lim; cambiados.push(t.id); }
      });
    });
    return cambiados;
  }

  /** Parte un tramo a s mm de su inicio: el de antes conserva su identificador y el resto es un tramo nuevo. */
  function partir(m, t, s) {
    const nodo = nuevoNodo(m);
    const resto = { ...t, id: nuevoTramo(m), de: nodo, a: t.a, largo_mm: t.largo_mm - s, encimado: null, corto: false };
    t.a = nodo;
    t.largo_mm = s;
    t.encimado = null;
    t.corto = false;
    m.tramos.splice(m.tramos.indexOf(t) + 1, 0, resto);
    return { nodo, resto };
  }
  function posicionValida(t, s0) {
    const s = Math.round(Number(s0));
    if (!(s >= LARGO_MIN_MM && s <= t.largo_mm - LARGO_MIN_MM)) {
      falla(t.largo_mm < 2 * LARGO_MIN_MM ? `El tramo ${t.id} es demasiado corto para partirlo.` : `El punto debe quedar a ${metros(LARGO_MIN_MM)} o más de los extremos del tramo ${t.id}: de ${metros(LARGO_MIN_MM)} a ${metros(t.largo_mm - LARGO_MIN_MM)} desde su inicio.`, [t.id]);
    }
    return s;
  }
  /** Lo que se puede hacer desde un punto, dicho en corto: «seguir recto, dar vuelta a 30°, 45°, 60° o 90°, subir o bajar». */
  const textoOpciones = (ops) => {
    const angulos = (pieza) => [...new Set(ops.filter((o) => o.dir === 'H' && o.pieza === pieza).map((o) => o.giro_deg))].sort((a, b) => a - b).map((a) => `${a}°`);
    const partes = [];
    if (ops.some((o) => o.pieza === 'INICIO' && o.dir === 'H')) partes.push('salir a cualquier rumbo');
    if (ops.some((o) => o.dir === 'H' && (o.pieza === 'RECTO' || o.pieza === 'TRONCO'))) partes.push('seguir recto');
    const codos = angulos('CODO');
    if (codos.length === 1 && codos[0] === '90°' && ops.filter((o) => o.pieza === 'CODO' && o.dir === 'H').length > 2) partes.push('salir en horizontal a cualquier rumbo (codo de 90°)');
    else if (codos.length) partes.push(`dar vuelta a ${lista(codos)}`);
    const inj = angulos('INJERTO');
    if (inj.length) partes.push(`injertar a ${lista(inj)}, a favor del flujo`);
    if (ops.some((o) => o.dir === 'SUBE')) partes.push('subir');
    if (ops.some((o) => o.dir === 'BAJA')) partes.push('bajar');
    return lista(partes);
  };

  /**
   * Un tramo nuevo desde un nodo. x = { dir: 'H'|'SUBE'|'BAJA', az_deg, largo_mm, D_in }. Devuelve { modelo, tramo, nodo,
   * pieza } (el tramo que llega al punto nuevo: si sigue recto con el mismo diámetro, es el de antes alargado).
   */
  function agregarTramo(m0, M, desde, x) {
    const m = U.clonar(m0);
    const { opciones, motivo, nota } = salidas(m, M, desde);
    if (!opciones.length) falla(motivo, [desde]);
    const dir = esObjeto(x) && DIRS.includes(x.dir) ? x.dir : falla('Falta la dirección del tramo.');
    const az = dir === 'H' ? norm360(Number(x.az_deg)) : 0;
    const op = opciones.find((o) => o.dir === dir && (dir !== 'H' || o.az_deg === az));
    if (!op) falla(nota || `Desde ${desde} el ducto puede ${textoOpciones(opciones)}.`, [desde]);
    const largo = largoValido(x.largo_mm);
    const D = diametroValido(x.D_in);
    const g = geometria(m);
    const ti = g.entra.get(desde);
    if (op.pieza === 'INJERTO') {
      const tr = g.salen(desde)[0];
      if (D > tr.D_in) falla(`Un injerto no puede ser mayor que su tronco: el tronco ${tr.id} es de ${pulgadas(tr.D_in)}.`, [tr.id]);
    } else if (ti && D > ti.D_in) falla(`Alejándose del colector el diámetro no crece: el tramo ${ti.id} es de ${pulgadas(ti.D_in)}.`, [ti.id]);
    if (op.pieza === 'TRONCO') {
      const ramal = g.salen(desde)[0];
      if (ramal.D_in > D) falla(`El tramo ${ramal.id} (${pulgadas(ramal.D_in)}) quedaría como injerto de un tronco de ${pulgadas(D)}: un injerto no puede ser mayor que su tronco.`, [ramal.id]);
    }
    if (m.tramos.length >= MAX_TRAMOS) falla(`El dibujo llegó a ${MAX_TRAMOS} tramos.`);
    const nodo = nuevoNodo(m);
    m.tramos.push({ id: nuevoTramo(m), de: desde, a: nodo, D_in: D, largo_mm: largo, dir, az_deg: az, encimado: null, corto: false });
    fusionar(m);
    return { modelo: m, tramo: m.tramos.find((t) => t.a === nodo).id, nodo, pieza: op.pieza };
  }

  /**
   * Un injerto a la mitad de un tramo, a s_mm de su inicio. x = { az_deg, largo_mm, D_in }. Devuelve { modelo, nodo (el del
   * injerto), tramo (el ramal), extremo (el punto final del ramal) }.
   */
  function injertar(m0, M, tramoId, s_mm, x) {
    const m = U.clonar(m0);
    const t = tramoDe(m, tramoId);
    const { opciones, motivo } = salidasEnTramo(m, M, tramoId);
    if (!opciones.length) falla(motivo, [tramoId]);
    const az = norm360(Number(esObjeto(x) ? x.az_deg : NaN));
    if (!opciones.some((o) => o.az_deg === az)) falla(`El injerto va a ${lista(M.proceso.angulos_injerto_deg.map((b) => `${b}°`))} del tronco, a favor del flujo (alejándose del colector).`, [tramoId]);
    const s = posicionValida(t, s_mm);
    const largo = largoValido(x.largo_mm);
    const D = diametroValido(x.D_in);
    if (D > t.D_in) falla(`Un injerto no puede ser mayor que su tronco: el tramo ${t.id} es de ${pulgadas(t.D_in)}.`, [t.id]);
    if (m.tramos.length + 2 > MAX_TRAMOS) falla(`El dibujo llegó a ${MAX_TRAMOS} tramos.`);
    const { nodo } = partir(m, t, s);
    const extremo = nuevoNodo(m);
    const ramal = { id: nuevoTramo(m), de: nodo, a: extremo, D_in: D, largo_mm: largo, dir: 'H', az_deg: az, encimado: null, corto: false };
    m.tramos.push(ramal);
    return { modelo: m, nodo, tramo: ramal.id, extremo };
  }

  /**
   * Una reducción a la mitad de un tramo, a s_mm de su inicio: de ahí en adelante el tramo es de D_in (menor). Lo que sigue
   * más allá y quedaría mayor se reduce también. Devuelve { modelo, nodo, tramo (el de después), cambiados }.
   */
  function reducir(m0, M, tramoId, s_mm, D_in) {
    const m = U.clonar(m0);
    const t = tramoDe(m, tramoId);
    const D = diametroValido(D_in);
    if (D >= t.D_in) falla(`Una reducción pasa a un diámetro menor que el del tramo (${pulgadas(t.D_in)}).`, [t.id]);
    const s = posicionValida(t, s_mm);
    if (m.tramos.length + 1 > MAX_TRAMOS) falla(`El dibujo llegó a ${MAX_TRAMOS} tramos.`);
    const { nodo, resto } = partir(m, t, s);
    resto.D_in = D;
    const cambiados = limitar(m);
    return { modelo: m, nodo, tramo: resto.id, cambiados };
  }

  /**
   * Cambia el diámetro de un tramo. No puede pasar del límite (el del que llega a su nodo o, si es un ramal, el de su tronco);
   * lo que sigue más allá y quedaría mayor se reduce también. Devuelve { modelo, cambiados }.
   */
  function cambiarDiametro(m0, M, tramoId, D_in) {
    const m = U.clonar(m0);
    const t = tramoDe(m, tramoId);
    const D = diametroValido(D_in);
    const lim = limiteDe(geometria(m), t);
    if (D > lim.D) {
      falla(lim.ramal ? `Un injerto no puede ser mayor que su tronco: el tronco ${lim.por.id} es de ${pulgadas(lim.D)}.` : `Alejándose del colector el diámetro no crece: el tramo ${lim.por.id} es de ${pulgadas(lim.D)}.`, [lim.por.id]);
    }
    t.D_in = D;
    const cambiados = limitar(m).filter((id) => id !== tramoId);
    fusionar(m);
    return { modelo: m, cambiados: cambiados.filter((id) => m.tramos.some((x) => x.id === id)) };
  }

  /** Cambia el largo (a ejes) de un tramo: lo que está más allá se mueve. */
  function cambiarLargo(m0, tramoId, largo_mm) {
    const m = U.clonar(m0);
    const t = tramoDe(m, tramoId);
    t.largo_mm = largoValido(largo_mm);
    return m;
  }

  /** Lo que sale de un tramo, con él: los tramos de su rama. */
  function rama(m, t) {
    const g = geometria(m);
    const out = [t];
    for (let i = 0; i < out.length; i += 1) g.salen(out[i].a).forEach((s) => out.push(s));
    return out;
  }
  const rotar = (m, t, delta) => rama(m, t).forEach((x) => { if (x.dir === 'H') x.az_deg = norm360(x.az_deg + delta); });

  /**
   * Cambia el ángulo de un codo (0 = recto, o uno de proceso.angulos_codo_deg) o de un injerto (proceso.angulos_injerto_deg)
   * en un nodo; lado 'IZQ' o 'DER' (por omisión, el que tenía). Gira todo lo que está más allá.
   */
  function cambiarAngulo(m0, M, nodoId, grados0, lado0) {
    const m = U.clonar(m0);
    const g = geometria(m);
    const ti = g.entra.get(nodoId);
    const sal = g.salen(nodoId);
    const grados = Number(grados0);
    const lado = lado0 === 'IZQ' || lado0 === 'DER' ? lado0 : null;
    if (!ti || !sal.length) falla(`En ${nodoId} no hay codo ni injerto.`, [nodoId]);
    if (sal.length === 1) {
      const to = sal[0];
      if (ti.dir !== 'H' || to.dir !== 'H') falla(`En ${nodoId} el ducto pasa de horizontal a vertical: ese codo siempre es de 90°.`, [nodoId]);
      const ANG = M.proceso.angulos_codo_deg;
      if (!(grados === 0 || ANG.includes(grados))) falla(`El taller hace codos a ${lista(ANG.map((a) => `${a}°`))}.`, [nodoId]);
      const ld = lado || giro(ti, to).lado || 'IZQ';
      rotar(m, to, norm360(ti.az_deg + (ld === 'IZQ' ? grados : -grados)) - to.az_deg);
    } else if (sal.length === 2) {
      const tr = g.tronco(nodoId);
      const ramal = sal.find((s) => s !== tr);
      if (!tr || ti.dir !== 'H' || ramal.dir !== 'H') falla(`En ${nodoId} no hay un injerto que se pueda girar.`, [nodoId]);
      const ANG = M.proceso.angulos_injerto_deg;
      if (!ANG.includes(grados)) falla(`El taller sólo hace injertos a ${lista(ANG.map((a) => `${a}°`))}.`, [nodoId]);
      const ld = lado || giro(tr, ramal).lado || 'IZQ';
      rotar(m, ramal, norm360(tr.az_deg + (ld === 'IZQ' ? grados : -grados)) - ramal.az_deg);
    } else falla(`En ${nodoId} se juntan demasiados tramos.`, [nodoId]);
    fusionar(m);
    return m;
  }

  /** Quita un tramo con todo lo que está más allá (tramos y equipos). Devuelve { modelo, tramos, equipos } (cuántos se quitaron). */
  function borrarTramo(m0, tramoId) {
    const m = U.clonar(m0);
    const t = tramoDe(m, tramoId);
    const fuera = rama(m, t);
    const nodos = new Set(fuera.map((x) => x.a));
    const nEq = m.equipos.filter((e) => nodos.has(e.nodo)).length;
    m.tramos = m.tramos.filter((x) => !fuera.includes(x));
    m.equipos = m.equipos.filter((e) => !nodos.has(e.nodo));
    fusionar(m);
    return { modelo: m, tramos: fuera.length, equipos: nEq };
  }

  /** Pone un equipo (o un extremo abierto) en un extremo; si ya había otro, lo reemplaza. Devuelve { modelo, equipo }. */
  function ponerEquipo(m0, nodoId, clase) {
    const m = U.clonar(m0);
    if (!Object.prototype.hasOwnProperty.call(CLASES, clase) || clase === 'COLECTOR') falla('Ese equipo no se puede poner: el colector es uno y ya está.');
    const g = geometria(m);
    if (!g.entra.has(nodoId)) falla(nodoId === g.raiz ? 'Ahí está el colector.' : `No existe el punto ${nodoId}.`, [nodoId]);
    if (g.salen(nodoId).length) falla(`${nodoId} no es un extremo: los equipos van al final de un ramal.`, [nodoId]);
    const previo = g.equipo.get(nodoId);
    if (previo && previo.clase === clase) return { modelo: m, equipo: previo.id };
    if (!previo && m.equipos.length >= MAX_EQUIPOS) falla(`El dibujo llegó a ${MAX_EQUIPOS} equipos.`);
    m.equipos = m.equipos.filter((e) => e !== previo);
    const base = CLASES[clase].nombre;
    const re = new RegExp(`^${base} (\\d+)$`);
    const n = 1 + Math.max(0, ...m.equipos.map((e) => { const r = re.exec(e.nombre); return r ? Number(r[1]) : 0; }));
    if (m.cuenta.EQ >= 999) falla('El dibujo ya usó 999 equipos: empiece uno nuevo.');
    m.cuenta.EQ += 1;
    const id = idEq(m.cuenta.EQ);
    m.equipos.push({ id, clase, nombre: `${base} ${n}`, nodo: nodoId, boca_in: null, manguera_tramos: clase === 'MAQUINA_MANGUERA' ? 1 : null });
    return { modelo: m, equipo: id };
  }

  function quitarEquipo(m0, nodoId) {
    const m = U.clonar(m0);
    const e = m.equipos.find((x) => x.nodo === nodoId);
    if (!e) falla(`En ${nodoId} no hay equipo.`, [nodoId]);
    if (e.clase === 'COLECTOR') falla('El colector no se quita: el dibujo crece desde él.');
    m.equipos = m.equipos.filter((x) => x !== e);
    return m;
  }

  /** Cambia el nombre, la boca (colector y máquinas con brida; null = se pregunta) o los tramos de manguera de un equipo. */
  function editarEquipo(m0, equipoId, cambios) {
    const m = U.clonar(m0);
    const e = m.equipos.find((x) => x.id === equipoId) || falla(`No existe el equipo ${equipoId}.`);
    const c = esObjeto(cambios) ? cambios : {};
    if (c.nombre !== undefined) {
      const n = String(c.nombre).trim();
      if (!n || n.length > 60) falla('El nombre del equipo lleva de 1 a 60 letras.');
      e.nombre = n;
    }
    if (c.boca_in !== undefined) {
      if (!CON_BOCA.includes(e.clase)) falla('Sólo el colector y las máquinas con brida llevan boca.');
      const b = c.boca_in === null || c.boca_in === '' ? null : Number(c.boca_in);
      if (b !== null && !(finito(b) && b > 0 && b <= 120)) falla('La boca va en pulgadas, mayor que cero.');
      e.boca_in = b;
    }
    if (c.manguera_tramos !== undefined) {
      if (e.clase !== 'MAQUINA_MANGUERA') falla('Sólo las máquinas con manguera llevan tramos de manguera.');
      const k = c.manguera_tramos === null || c.manguera_tramos === '' ? null : Number(c.manguera_tramos);
      if (k !== null && !(Number.isInteger(k) && k >= 1 && k <= MANGUERA_MAX)) falla(`Los tramos de manguera son de 1 a ${MANGUERA_MAX}.`);
      e.manguera_tramos = k;
    }
    return m;
  }

  function cambiarMaterial(m0, M, material, calibre) {
    const m = U.clonar(m0);
    if (!M.materiales[material]) falla('Ese material no está en las tablas maestras.');
    const tabla = M.calibres[M.materiales[material].tabla_calibre] || {};
    const cal = calibre === undefined ? m.calibre : Number(calibre);
    if (tabla[String(cal)] === undefined) falla(`El calibre ${cal} no está en la tabla de ${M.materiales[material].nombre}.`);
    m.material = material;
    m.calibre = cal;
    return m;
  }

  /**
   * Las respuestas que se dieron al revisar el despiece, pasadas al dibujo (al volver a editarlo): material y calibre, la
   * boca y las mangueras de los equipos, el extremo que se deja abierto, los accesorios encimados y el tramo corto aceptado;
   * también un diámetro o una cota corregidos. Los ángulos y la posición los decide el dibujo. Devuelve el modelo.
   */
  function aplicarRespuestas(m0, M, respuestas) {
    let m = U.clonar(m0);
    const R = UF.respuestasValidas(respuestas);
    const intenta = (fn) => { try { m = fn(m); } catch (e) { if (!(e instanceof CadError)) throw e; } };
    const md = R.metadatos || {};
    if (md.material !== undefined || md.calibre !== undefined) intenta((x) => cambiarMaterial(x, M, md.material || x.material, md.calibre === undefined ? x.calibre : md.calibre));
    Object.keys(R).forEach((id) => {
      const r = R[id];
      const t = m.tramos.find((x) => x.id === id);
      if (t) {
        if (r.diametro_in !== undefined) intenta((x) => cambiarDiametro(x, M, id, r.diametro_in).modelo);
        if (r.longitud_m !== undefined) intenta((x) => cambiarLargo(x, id, Number(r.longitud_m) * 1000));
        const t2 = m.tramos.find((x) => x.id === id);
        if (t2 && (r.encimado === 'UNION' || r.encimado === 'TRAMO')) t2.encimado = r.encimado;
        if (t2 && r.aceptado === true) t2.corto = true;
      }
      const e = m.equipos.find((x) => x.id === id);
      if (e) {
        if (r.boca_in !== undefined && CON_BOCA.includes(e.clase)) intenta((x) => editarEquipo(x, id, { boca_in: r.boca_in }));
        if (r.manguera_tramos !== undefined && e.clase === 'MAQUINA_MANGUERA') intenta((x) => editarEquipo(x, id, { manguera_tramos: r.manguera_tramos }));
      }
      // un extremo sin equipo que se aceptó abierto
      if (/^N-/.test(id) && r.aceptado === true) {
        const g = geometria(m);
        if (g.entra.has(id) && !g.salen(id).length && !g.equipo.has(id)) intenta((x) => ponerEquipo(x, id, 'ABIERTO').modelo);
      }
    });
    return m;
  }

  /* ------------------------------------------------------------------ revisar */

  /** La distancia más corta entre dos segmentos en el espacio. */
  function distanciaSegmentos(p1, q1, p2, q2) {
    const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
    const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
    const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const pp = (u, v) => u.x * v.x + u.y * v.y + u.z * v.z;
    const a = pp(d1, d1);
    const e = pp(d2, d2);
    const f = pp(d2, r);
    const c = pp(d1, r);
    const b = pp(d1, d2);
    const den = a * e - b * b;
    const lim = (v) => Math.max(0, Math.min(1, v));
    let s = den > 1e-9 ? lim((b * f - c * e) / den) : 0;
    let t = (b * s + f) / e;
    if (t < 0) { t = 0; s = lim(-c / a); } else if (t > 1) { t = 1; s = lim((b - c) / a); }
    const x = { x: p1.x + d1.x * s - p2.x - d2.x * t, y: p1.y + d1.y * s - p2.y - d2.y * t, z: p1.z + d1.z * s - p2.z - d2.z * t };
    return Math.sqrt(pp(x, x));
  }

  /**
   * Lo que el dibujo tiene que resolver antes de convertirlo en piezas (errores) y lo que conviene ver (avisos). Cada uno:
   * { codigo, mensaje, refs }. Un dibujo hecho con estas operaciones no tiene errores de giro ni de injerto; un dibujo que
   * viene de fuera sí puede tenerlos.
   */
  function revisar(m, M) {
    const errores = [];
    const avisos = [];
    const g = geometria(m);
    const ANG_CODO = M.proceso.angulos_codo_deg;
    const ANG_INJ = M.proceso.angulos_injerto_deg;
    if (!m.tramos.length) {
      errores.push({ codigo: 'SIN_TRAMOS', mensaje: 'Todavía no hay ductos: arrastre desde el colector para trazar el primer tramo.', refs: [g.raiz] });
      return { errores, avisos };
    }
    if (g.salen(g.raiz).length > 1) errores.push({ codigo: 'COLECTOR_UNA_BOCA', mensaje: 'Del colector sale más de un tramo: tiene una sola boca.', refs: [g.raiz] });
    g.orden.forEach((nid) => {
      const ti = g.entra.get(nid);
      const sal = g.salen(nid);
      if (!ti || !sal.length) return;
      if (sal.length === 1) {
        const gi = giro(ti, sal[0]);
        const ok = gi.grados === 0 || (gi.plano === 'V' ? gi.grados === 90 : ANG_CODO.includes(gi.grados));
        if (!ok) {
          errores.push({ codigo: 'GIRO_NO_PERMITIDO', refs: [nid, ti.id, sal[0].id],
            mensaje: gi.grados === 180 ? `En ${nid} el ducto da media vuelta (sube y baja, o regresa por donde vino).` : `En ${nid} el ducto da vuelta a ${gi.grados}°: el taller hace codos a ${lista(ANG_CODO.map((a) => `${a}°`))}.` });
        }
      } else if (sal.length === 2) {
        const tr = g.tronco(nid);
        const ramal = sal.find((s) => s !== tr);
        const gr = tr ? giro(tr, ramal) : null;
        if (!tr || ti.dir !== 'H' || ramal.dir !== 'H' || !ANG_INJ.includes(gr.grados)) {
          errores.push({ codigo: 'INJERTO_NO_PERMITIDO', refs: [nid, ...sal.map((s) => s.id)],
            mensaje: !tr ? `En ${nid} ningún tramo sigue recto: un injerto necesita un tronco recto.` : ti.dir !== 'H' || ramal.dir !== 'H' ? `En ${nid} hay un injerto en vertical: sólo se injerta en tramos horizontales.`
              : `En ${nid} el injerto va a ${gr.grados}°: el taller sólo hace injertos a ${lista(ANG_INJ.map((a) => `${a}°`))}.` });
        }
      } else {
        errores.push({ codigo: 'CRUCE', mensaje: `En ${nid} se juntan ${sal.length + 1} tramos: cada injerto va en su propio punto del tronco.`, refs: [nid, ...sal.map((s) => s.id)] });
      }
      sal.forEach((t) => {
        const lim = limiteDe(g, t);
        if (t.D_in > lim.D) {
          errores.push({ codigo: lim.ramal ? 'INJERTO_MAYOR' : 'DIAMETRO_CRECE', refs: [t.id, lim.por.id],
            mensaje: lim.ramal ? `El injerto ${t.id} (${pulgadas(t.D_in)}) es mayor que su tronco ${lim.por.id} (${pulgadas(lim.D)}).` : `El tramo ${t.id} (${pulgadas(t.D_in)}) es mayor que el anterior ${lim.por.id} (${pulgadas(lim.D)}): alejándose del colector el diámetro no crece.` });
        }
      });
    });
    g.orden.forEach((nid) => {
      if (g.entra.has(nid) && !g.salen(nid).length && !g.equipo.has(nid)) {
        avisos.push({ codigo: 'EXTREMO_SIN_EQUIPO', mensaje: `El extremo ${nid} no llega a ningún equipo: ponga una máquina, una campana o un extremo abierto (si no, al revisar se pregunta).`, refs: [nid, g.entra.get(nid).id] });
      }
    });
    // ductos que se cruzan: los ejes de dos tramos que no se tocan pasan más cerca que la suma de sus radios
    const seg = m.tramos.map((t) => ({ t, p: g.pos.get(t.de), q: g.pos.get(t.a) }));
    for (let i = 0; i < seg.length; i += 1) {
      for (let j = i + 1; j < seg.length; j += 1) {
        const A = seg[i];
        const B = seg[j];
        if ([A.t.de, A.t.a].some((n) => n === B.t.de || n === B.t.a)) continue;
        const d = distanciaSegmentos(A.p, A.q, B.p, B.q);
        const necesita = ((A.t.D_in + B.t.D_in) * IN) / 2;
        if (d < necesita) {
          avisos.push({ codigo: 'CHOQUE', refs: [A.t.id, B.t.id], mensaje: `Los tramos ${A.t.id} y ${B.t.id} se cruzan: sus ejes pasan a ${Math.round(d)} mm y necesitan ${Math.round(necesita)} mm. Cambie un largo, un ángulo o la altura.` });
        }
      }
    }
    return { errores, avisos };
  }

  /* ------------------------------------------------------------------ a la lectura */

  /** La posición en la hoja: 'ISO' (isométrico: x a 30° hacia arriba a la derecha, y a 150°, z vertical) o 'PLANTA'. */
  function proyectar(p, vista) {
    if (vista === 'PLANTA') return { x: p.x, y: -p.y };
    return { x: (p.x - p.y) * COS30, y: -(p.x + p.y) * 0.5 - p.z };
  }
  /** El eje del isométrico de un tramo: X o Y si va a lo largo de uno, Z si es vertical; si no, NINGUNO. */
  const ejeIso = (t) => (t.dir !== 'H' ? 'Z' : t.az_deg % 180 === 0 ? 'X' : t.az_deg % 180 === 90 ? 'Y' : 'NINGUNO');

  /** El ángulo de la pieza en cada nodo: el del codo o el del injerto (los que se anotan en la lectura). */
  function angulos(m) {
    const g = geometria(m);
    const out = new Map();
    g.orden.forEach((nid) => {
      const ti = g.entra.get(nid);
      const sal = g.salen(nid);
      if (!ti || !sal.length || g.equipo.has(nid)) return;
      if (sal.length === 1) {
        const gi = giro(ti, sal[0]);
        if (gi.grados > 0) out.set(nid, gi.grados);
      } else {
        const tr = g.tronco(nid);
        const ramal = sal.find((s) => s !== tr);
        if (tr && ramal) out.set(nid, giro(tr, ramal).grados);
      }
    });
    return out;
  }

  /**
   * La lectura (docs/unifilar-bom.schema.json) del dibujo, con todo de origen USUARIO, y las respuestas que el dibujo ya trae
   * (tramos de manguera, accesorios encimados, tramo corto aceptado). opciones: { yarda_mm, fecha }. Devuelve
   * { lectura, respuestas }; la lectura ya pasó por UF.leer.
   */
  function aLectura(m, M, opciones) {
    const o = esObjeto(opciones) ? opciones : {};
    const g = geometria(m);
    const col = colectorDe(m);
    const pantalla = new Map([...g.pos].map(([nid, p]) => [nid, proyectar(p, 'ISO')]));
    const xs = [...pantalla.values()].map((p) => p.x * PX_POR_MM);
    const ys = [...pantalla.values()].map((p) => p.y * PX_POR_MM);
    const margen = 80;
    const x0 = Math.min(...xs) - margen;
    const y0 = Math.min(...ys) - margen;
    const ancho = Math.max(400, Math.ceil(Math.max(...xs) - x0 + margen));
    const alto = Math.max(300, Math.ceil(Math.max(...ys) - y0 + margen));
    const px = (nid) => { const p = pantalla.get(nid); return { x: r1(p.x * PX_POR_MM - x0), y: r1(p.y * PX_POR_MM - y0) }; };
    const usuario = (valor, unidad) => ({ valor, unidad, origen: 'USUARIO', confianza: 1, texto_id: null });
    const aristas = m.tramos.map((t) => {
      const p = px(t.de);
      const q = px(t.a);
      const ang = norm360((Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI);
      const cerca = (a) => Math.min(Math.abs(ang - a), 360 - Math.abs(ang - a)) <= 10;
      return {
        id: t.id, nodo_a: t.de, nodo_b: t.a, orientacion_pantalla: cerca(0) || cerca(180) ? 'HORIZONTAL' : cerca(90) || cerca(270) ? 'VERTICAL' : 'INCLINADA',
        eje_iso: ejeIso(t), angulo_pantalla_deg: ang, diametro: usuario(t.D_in, 'in'), longitud_cota: usuario(t.largo_mm / 1000, 'm'), ducto_id: null,
      };
    });
    const textos = [];
    angulos(m).forEach((grados, nid) => {
      const p = px(nid);
      textos.push({ id: id3('T', textos.length + 1), contenido_crudo: `${grados}°`, contenido_normalizado: String(grados), tipo: 'ANGULO', bbox_px: { x: r1(p.x + 8), y: r1(p.y - 30), w: 40, h: 22 }, confianza_ocr: 1, asociado_a: nid, origen: 'USUARIO' });
    });
    const nodos = g.orden.map((nid) => {
      const ar = m.tramos.filter((t) => t.de === nid || t.a === nid).map((t) => t.id);
      const eq = g.equipo.get(nid);
      const ti = g.entra.get(nid);
      const sal = g.salen(nid);
      const tipo = ar.length <= 1 ? 'EXTREMO' : ar.length === 2 ? (giro(ti, sal[0]).grados === 0 ? 'UNION_COLINEAL' : 'VERTICE') : 'DERIVACION';
      return { id: nid, tipo, grado: ar.length, pos_px: px(nid), aristas: ar, equipo_id: eq ? eq.id : null, accesorio_id: null, confianza: 1 };
    });
    const equipos = m.equipos.map((e) => ({
      id: e.id, tipo: CLASES[e.clase].tipo, nombre: e.nombre, nodo_id: e.nodo, conexion: CLASES[e.clase].conexion, texto_id: null, confianza: 1,
      boca_diametro: CON_BOCA.includes(e.clase) && finito(e.boca_in) ? usuario(e.boca_in, 'in') : null,
    }));
    const crudo = {
      version: '1.0',
      metadatos: {
        fuente: { archivo: 'dibujo', ancho_px: ancho, alto_px: alto, ancho_enviado_px: ancho, alto_enviado_px: alto, recortes: [] },
        vista: 'ISOMETRICO', unidades_diametro: 'IN', unidades_longitud: 'M', convencion_cotas: 'EJES', flujo_hacia: col.id,
        material: usuario(m.material, null), calibre: usuario(m.calibre, null), yarda_mm: o.yarda_mm === 1220 ? 1220 : 914.4,
        modelo: '', fecha: typeof o.fecha === 'string' ? o.fecha : new Date().toISOString(),
      },
      red: { nodos, aristas, textos, cotas_totales: [] },
      equipos,
      alertas_ambiguedad: [],
    };
    const { lectura, errores } = UF.leer(crudo);
    if (errores.length) throw new Error(`El dibujo no dio una lectura válida: ${errores.join(' ')}`);
    const respuestas = {};
    const poner = (id, campo, v) => { respuestas[id] = { ...(respuestas[id] || {}), [campo]: v }; };
    m.equipos.forEach((e) => { if (e.clase === 'MAQUINA_MANGUERA' && Number.isInteger(e.manguera_tramos)) poner(e.id, 'manguera_tramos', e.manguera_tramos); });
    m.tramos.forEach((t) => {
      if (t.encimado) poner(t.id, 'encimado', t.encimado);
      if (t.corto) poner(t.id, 'aceptado', true);
    });
    return { lectura, respuestas };
  }

  /** ¿La lectura salió de un dibujo? */
  const esDeDibujo = (lectura) => !!(lectura && lectura.metadatos && lectura.metadatos.fuente && lectura.metadatos.fuente.archivo === 'dibujo');

  /** Lo que mide el dibujo: tramos, metros, equipos por clase. */
  function resumen(m) {
    const porClase = {};
    m.equipos.forEach((e) => { porClase[e.clase] = (porClase[e.clase] || 0) + 1; });
    return { tramos: m.tramos.length, metros: m.tramos.reduce((s, t) => s + t.largo_mm, 0) / 1000, equipos: porClase };
  }

  /**
   * El dibujo del croquis de ejemplo (datos/unifilar_ejemplo.js, docs/vision-unifilares.md §11), hecho con las operaciones:
   * subida de 12″, tronco de 12″ con reducción con injerto de 6″ a 45° a la máquina A, injerto de 5″ a 45° a la máquina B,
   * reducción de 10″ a 8″ y codo de 45° a la campana.
   */
  function dibujoEjemplo(M) {
    let m = editarEquipo(nuevo(M, { material: 'GALVANIZADO', calibre: 22 }), 'EQ-01', { boca_in: 12 });
    const paso = (r) => { m = r.modelo; return r; };
    const sube = paso(agregarTramo(m, M, 'N-001', { dir: 'SUBE', largo_mm: 3000, D_in: 12 }));
    const tronco12 = paso(agregarTramo(m, M, sube.nodo, { dir: 'H', az_deg: 0, largo_mm: 4500, D_in: 12 }));
    const tronco10 = paso(agregarTramo(m, M, tronco12.nodo, { dir: 'H', az_deg: 0, largo_mm: 5600, D_in: 10 }));
    const maqA = paso(agregarTramo(m, M, tronco12.nodo, { dir: 'H', az_deg: 315, largo_mm: 1800, D_in: 6 }));
    const tronco8 = paso(agregarTramo(m, M, tronco10.nodo, { dir: 'H', az_deg: 0, largo_mm: 2500, D_in: 8 }));
    const campana = paso(agregarTramo(m, M, tronco8.nodo, { dir: 'H', az_deg: 45, largo_mm: 1500, D_in: 8 }));
    const maqB = paso(injertar(m, M, tronco10.tramo, 3600, { az_deg: 45, largo_mm: 1200, D_in: 5 }));
    m = ponerEquipo(m, maqA.nodo, 'MAQUINA_MANGUERA').modelo;
    m = ponerEquipo(m, maqB.extremo, 'MAQUINA_MANGUERA').modelo;
    m = ponerEquipo(m, campana.nodo, 'CAMPANA').modelo;
    return m;
  }

  return {
    VERSION, CLASES, LARGO_MIN_MM, LARGO_MAX_MM, PASO_RUMBO, CadError,
    nuevo, validar, geometria, giro, vector, salidas, salidasEnTramo,
    textoOpciones, agregarTramo, injertar, reducir, cambiarDiametro, cambiarLargo, cambiarAngulo, borrarTramo, ponerEquipo, quitarEquipo, editarEquipo, cambiarMaterial, aplicarRespuestas,
    revisar, angulos, aLectura, esDeDibujo, proyectar, resumen, dibujoEjemplo, distanciaSegmentos,
  };
}));
