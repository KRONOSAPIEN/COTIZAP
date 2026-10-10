/**
 * COTIZAP · trazado_iso.js — El modelo del trazado unifilar isométrico (docs/trazado-isometrico.md; etapa 1 de §5).
 *
 * La red es un grafo de nodos con posición absoluta (mm; X al este, Y al norte, Z hacia arriba, Z = 0 el piso) unidos por
 * tramos rígidos y por mangueras. Un tramo rígido va en una dirección de la rejilla de las políticas (rumbo cada 15° y
 * elevación 0, ±30, ±45, ±60 o ±90°); su largo y su dirección salen de las posiciones de sus nodos. Los equipos tienen
 * posición, giro y caja; sus puertos (tomas y bocas de colector) son nodos que se mueven con ellos. Una toma se acopla con
 * brida (el ducto sale alineado con su cuello) o con manguera hasta un punto de transición (PT), donde empieza el rígido.
 *
 * El sentido del aire no depende de por dónde se trazó: cada red se orienta hacia la boca de colector a la que llega o,
 * mientras no llega, hacia su único extremo libre (flujo provisional). Con el sentido salen los caudales y la pieza de cada
 * nodo (codo, reducción, adaptador, injerto, reducción con injerto o T) con sus medidas del motor de COTIZAP, lo que ocupa
 * de cada tramo y la longitud neta.
 *
 * Las operaciones son puras: devuelven un modelo nuevo y no tocan el recibido. Lo que dejaría el trazo en un estado que el
 * taller no fabrica se rechaza con TrazadoError, con el código del catálogo de §2.11 y el porqué. Las tomas con brida, las
 * bocas del colector y los nodos anclados son puntos fijos: un cambio de largo o un movimiento que los movería se compensa
 * en los tramos del camino (§2.2) o se rechaza (FIJO_SE_MUEVE); las mangueras se vuelven a resolver.
 *
 * `rutas` es el imán de derivación y de llegada (§2.5.4), `resolverManguera` la manguera de §2.8.2, `revisar` el catálogo de
 * validaciones y `aSistema` el JSON de docs/trazado-isometrico.schema.json (`desdeSistema` lo lee de regreso).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cotizador'), require('./unifilar'), require('./unifilar_cad'));
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.trazadoIso = factory(root.COTIZAP.cotizador, root.COTIZAP.unifilar, root.COTIZAP.unifilarCad);
  }
}(typeof self !== 'undefined' ? self : this, function (COT, UF, CAD) {
  'use strict';

  const VERSION = 1;
  const IN = 25.4;
  const DEG = Math.PI / 180;
  const TOL_MM = 0.5; // coincidencia geométrica (§2.1.7)
  const TOL_DIR_MM = 0.01; // un tramo va en su dirección de la rejilla a 0.01 mm (§3.3)
  const TOL_ANG = 1e-4; // grados
  const LARGO_MAX_MM = 100000;
  const MAX_COORD_MM = 1e7;
  const MAX_TRAMOS = 500;
  const MAX_EQUIPOS = 300;
  const MAX_PUERTOS = 24;
  const MAX_NODOS = 2000;
  const ELEVACIONES = [-90, -60, -45, -30, 0, 30, 45, 60, 90];
  const REJILLAS = {
    EJES: { paso_azimut_deg: 90, elevaciones_deg: [-90, 0, 90] },
    EJES_45: { paso_azimut_deg: 45, elevaciones_deg: [-90, -45, 0, 45, 90] },
    FINA: { paso_azimut_deg: 15, elevaciones_deg: ELEVACIONES },
  };
  const SERVICIOS = ['POLVO', 'ABRASIVO', 'VENTILACION', 'HUMOS'];
  const NOMBRE_SERVICIO = { POLVO: 'polvo', ABRASIVO: 'material abrasivo', VENTILACION: 'ventilación', HUMOS: 'humos' };
  /** Lo que depende del servicio: velocidades de transporte (referencia por confirmar con el taller), reducción horizontal y T. */
  const POR_SERVICIO = {
    POLVO: { velocidad_min_m_s: 18, velocidad_max_m_s: 23, reduccion_horizontal: 'EXCENTRICA_PLANA_ABAJO', permite_t_90: false },
    ABRASIVO: { velocidad_min_m_s: 20, velocidad_max_m_s: 25, reduccion_horizontal: 'EXCENTRICA_PLANA_ABAJO', permite_t_90: false },
    VENTILACION: { velocidad_min_m_s: 5, velocidad_max_m_s: 12, reduccion_horizontal: 'CONCENTRICA', permite_t_90: true },
    HUMOS: { velocidad_min_m_s: 10, velocidad_max_m_s: 15, reduccion_horizontal: 'CONCENTRICA', permite_t_90: true },
  };
  const TIPOS_EQUIPO = ['COLECTOR', 'MAQUINA', 'CAMPANA', 'VENTILADOR'];
  const NOMBRE_EQUIPO = { COLECTOR: 'Colector', MAQUINA: 'Máquina', CAMPANA: 'Campana', VENTILADOR: 'Ventilador' };
  const MATERIALES = ['GALVANIZADO', 'ACERO_CARBON', 'INOX_304', 'INOX_316'];
  const VISTAS = { NE: 0, NO: 90, SO: 180, SE: 270 };
  const PREFIJO = { CODO: 'CO', REDUCCION: 'RE', ADAPTADOR: 'AD', INJERTO: 'IN', REDUCCION_INJERTO: 'RI', PANTALON: 'PA', T_90: 'TE', COMPUERTA: 'CP' };
  const ORDEN_PIEZA = ['CODO', 'REDUCCION', 'ADAPTADOR', 'INJERTO', 'REDUCCION_INJERTO', 'T_90', 'PANTALON', 'COMPUERTA'];
  const SEVERIDADES = ['BLOQUEANTE', 'ERROR', 'AVISO', 'INFO'];
  const PASO_EQUIPO_MM = 100;
  /** La compuerta de guillotina con sus dos cuellos: lo que ocupa del tramo (la mitad de cada lado). */
  const LARGO_COMPUERTA_MM = 150; // los equipos se separan en la rejilla del piso

  class TrazadoError extends Error {
    constructor(codigo, mensaje, elementos, sugerencia) {
      super(mensaje);
      this.name = 'TrazadoError';
      this.codigo = codigo;
      this.elementos = elementos || [];
      this.sugerencia = sugerencia || null;
    }
  }
  const falla = (codigo, mensaje, elementos, sugerencia) => { throw new TrazadoError(codigo, mensaje, elementos, sugerencia); };
  const dato = (cond, mensaje, elementos) => { if (!cond) falla('DATO_INVALIDO', mensaje, elementos); };

  /* ------------------------------------------------------------------ números y vectores */

  const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const redondeo = (k) => (x) => Math.round(x * k) / k + 0; // + 0: sin -0
  const r1 = redondeo(10);
  const r3 = redondeo(1000);
  const r4 = redondeo(10000);
  const n = (x, dec) => String(Number(Number(x).toFixed(dec || 0)));
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const V3 = (x, y, z) => ({ x, y, z });
  const suma = (a, b) => V3(a.x + b.x, a.y + b.y, a.z + b.z);
  const resta = (a, b) => V3(a.x - b.x, a.y - b.y, a.z - b.z);
  const por = (a, k) => V3(a.x * k, a.y * k, a.z * k);
  const punto = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cruz = (a, b) => V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const norma = (a) => Math.sqrt(punto(a, a));
  const unitario = (a) => { const l = norma(a); return l > 1e-12 ? por(a, 1 / l) : V3(0, 0, 0); };
  const r3v = (p) => V3(r3(p.x), r3(p.y), r3(p.z));
  const r4v = (p) => V3(r4(p.x), r4(p.y), r4(p.z));
  const Z = V3(0, 0, 1);
  const anguloEntre = (a, b) => Math.acos(clamp(punto(unitario(a), unitario(b)), -1, 1)) / DEG;
  const clonar = (x) => JSON.parse(JSON.stringify(x));
  const lista = (xs, y) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${y || 'o'} ${xs[xs.length - 1]}` : String(xs[0]));
  const pulgadas = (d) => `${n(d, 2)}″`;
  const metros = (mm) => `${n(mm / 1000, 3)} m`;

  /** Gira un punto o un vector g grados contra las manecillas sobre Z. */
  function girarZ(p, g) {
    if (!g) return V3(p.x, p.y, p.z);
    const c = Math.cos(g * DEG);
    const s = Math.sin(g * DEG);
    return V3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }
  /** Rodrigues: gira v un ángulo d (grados) sobre el eje unitario k. */
  function girarEje(v, k, d) {
    const c = Math.cos(d * DEG);
    const s = Math.sin(d * DEG);
    return suma(suma(por(v, c), por(cruz(k, v), s)), por(k, punto(k, v) * (1 - c)));
  }

  /* ------------------------------------------------------------------ direcciones y rejilla (§2.1) */

  /** u(a, e) = (cos e·cos a, cos e·sen a, sen e). */
  function vectorDe(d) {
    const a = d.azimut_deg * DEG;
    const e = d.elevacion_deg * DEG;
    if (d.elevacion_deg === 90) return V3(0, 0, 1);
    if (d.elevacion_deg === -90) return V3(0, 0, -1);
    return V3(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e));
  }
  const igualDir = (a, b) => a.azimut_deg === b.azimut_deg && a.elevacion_deg === b.elevacion_deg;
  const opuesta = (d) => (Math.abs(d.elevacion_deg) === 90 ? { azimut_deg: 0, elevacion_deg: 0 - d.elevacion_deg } : { azimut_deg: norm360(d.azimut_deg + 180), elevacion_deg: 0 - d.elevacion_deg });
  const enRejilla = (d, pol) => pol.rejilla.elevaciones_deg.includes(d.elevacion_deg) && (Math.abs(d.elevacion_deg) === 90 ? d.azimut_deg === 0 : d.azimut_deg % pol.rejilla.paso_azimut_deg === 0);

  /** Las direcciones de la rejilla de las políticas: cada rumbo con cada elevación, más ±Z. FINA da 170, EJES_45 26 y EJES 6. */
  function rejilla(pol) {
    const out = [];
    pol.rejilla.elevaciones_deg.forEach((e) => {
      if (Math.abs(e) === 90) out.push({ azimut_deg: 0, elevacion_deg: e });
      else for (let a = 0; a < 360; a += pol.rejilla.paso_azimut_deg) out.push({ azimut_deg: a, elevacion_deg: e });
    });
    return out;
  }

  /** La dirección de la rejilla en la que va el vector v (mm), o null si se desvía más de 0.01 mm o no está en la rejilla. */
  function direccionDeVector(v, pol) {
    const L = norma(v);
    if (L < 1e-9) return null;
    const el = Math.asin(clamp(v.z / L, -1, 1)) / DEG;
    const e = ELEVACIONES.reduce((b, x) => (Math.abs(x - el) < Math.abs(b - el) ? x : b), 0);
    const az = Math.abs(e) === 90 ? 0 : norm360(Math.round(norm360(Math.atan2(v.y, v.x) / DEG) / 15) * 15);
    const d = { azimut_deg: az, elevacion_deg: e };
    const u = vectorDe(d);
    const largo = punto(v, u);
    if (largo <= 0 || norma(resta(v, por(u, largo))) > TOL_DIR_MM) return null;
    return pol && !enRejilla(d, pol) ? null : d;
  }

  /** Cómo se dice una dirección: «+Z», «−Z», «rumbo 135°» o «rumbo 135°, sube 45°». */
  function textoDireccion(d) {
    if (d.elevacion_deg === 90) return '+Z';
    if (d.elevacion_deg === -90) return '−Z';
    const ejes = { 0: '+X', 90: '+Y', 180: '−X', 270: '−Y' };
    const rumbo = d.elevacion_deg === 0 && ejes[d.azimut_deg] ? ejes[d.azimut_deg] : `rumbo ${d.azimut_deg}°`;
    return d.elevacion_deg === 0 ? rumbo : `${rumbo}, ${d.elevacion_deg > 0 ? 'sube' : 'baja'} ${Math.abs(d.elevacion_deg)}°`;
  }

  /* ------------------------------------------------------------------ proyección (§0.4) */

  const C30 = Math.cos(30 * DEG);
  /** El dibujo de un punto, en mm de pantalla (u a la derecha, v hacia arriba): isométrico NE, NO, SO o SE, o vista auxiliar. */
  function proyectar(p, vista) {
    const w = vista || 'NE';
    if (w === 'PLANTA') return { u: p.x, v: p.y };
    if (w === 'ELEV_XZ') return { u: p.x, v: p.z };
    if (w === 'ELEV_YZ') return { u: p.y, v: p.z };
    dato(Object.prototype.hasOwnProperty.call(VISTAS, w), `No hay vista ${w}.`);
    const q = girarZ(p, VISTAS[w]);
    return { u: (q.x - q.y) * C30, v: (q.x + q.y) * 0.5 + q.z };
  }
  /** Lo que la vista no distingue: la dirección del rayo de cada punto de pantalla. En el isométrico NE es (1, 1, −1). */
  function rayoDeVista(vista) {
    const w = vista || 'NE';
    if (w === 'PLANTA') return V3(0, 0, 1);
    if (w === 'ELEV_XZ') return V3(0, 1, 0);
    if (w === 'ELEV_YZ') return V3(1, 0, 0);
    return girarZ(V3(1, 1, -1), -VISTAS[w]);
  }
  /**
   * Del puntero al espacio (§0.4): el cruce del rayo del punto de pantalla (u, v) con el plano de trabajo { punto, normal }.
   * degenerado: el plano se ve de canto (en NE, un plano vertical con |cos a − sen a| < 0.25); hay que girar la vista.
   */
  function alPlano(uv, plano, vista) {
    const w = vista || 'NE';
    let P;
    if (w === 'PLANTA') P = V3(uv.u, uv.v, 0);
    else if (w === 'ELEV_XZ') P = V3(uv.u, 0, uv.v);
    else if (w === 'ELEV_YZ') P = V3(0, uv.u, uv.v);
    else P = girarZ(V3((uv.u / C30 + 2 * uv.v) / 2, (2 * uv.v - uv.u / C30) / 2, 0), -VISTAS[w]);
    const k = rayoDeVista(w);
    const nn = unitario(plano.normal);
    const den = punto(nn, k);
    const degenerado = Math.abs(den) / norma(k) < 0.25 / Math.sqrt(3);
    if (Math.abs(den) < 1e-12) return { punto: null, degenerado: true };
    return { punto: suma(P, por(k, punto(nn, resta(plano.punto, P)) / den)), degenerado };
  }
  const planoHorizontal = (z) => ({ punto: V3(0, 0, z), normal: Z });
  /** El plano vertical por p que contiene la horizontal de rumbo a. */
  const planoVertical = (p, a) => ({ punto: p, normal: V3(-Math.sin(a * DEG), Math.cos(a * DEG), 0) });

  /* ------------------------------------------------------------------ aire y políticas */

  /** Atmósfera estándar a la altitud h y temperatura T: presión, densidad y viscosidad de Sutherland (§3.4). */
  function aire(temperatura_C, altitud_m) {
    const T = temperatura_C + 273.15;
    const p = 101325 * Math.pow(1 - 2.25577e-5 * altitud_m, 5.25588);
    const mu = (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);
    return { presion_Pa: Math.round(p), densidad_kg_m3: r4(p / (287.05 * T)), viscosidad_Pa_s: Number(mu.toPrecision(4)) };
  }

  /** Las políticas por omisión (§0.5): las del taller salen de las tablas maestras; las de diseño, de la tabla del documento. */
  function politicasDe(M, servicio) {
    const pr = M.proceso;
    const s = POR_SERVICIO[servicio] || POR_SERVICIO.POLVO;
    return {
      angulos_codo_deg: [...pr.angulos_codo_deg], radio_codo_D: pr.k_R_defecto, angulos_injerto_deg: [...pr.angulos_injerto_deg],
      permite_t_90: s.permite_t_90, permite_pantalon: false, angulos_pantalon_deg: [30], entradas_permitidas: ['SUPERIOR', 'LATERAL'],
      rejilla: { paso_azimut_deg: 15, elevaciones_deg: [...ELEVACIONES] },
      paso_largo_mm: 100, largo_min_tramo_mm: 100, recto_min_entre_accesorios_mm: 150, recto_antes_de_derivacion_D: 2, distancia_min_entre_derivaciones_D: 1,
      holgura_min_mm: 50, altura_libre_min_mm: 2100, velocidad_min_m_s: s.velocidad_min_m_s, velocidad_max_m_s: s.velocidad_max_m_s,
      semiangulo_reduccion_deg: pr.semiangulo_max_deg, reduccion_horizontal: s.reduccion_horizontal, relacion_reduccion_min: 0.5,
      manguera: { radio_min_D: 1.5, largo_max_mm: 3000, puno_mm: 100, rugosidad_mm: 1.5 },
      rugosidad_mm: { GALVANIZADO: 0.09, ACERO_CARBON: 0.045, INOX_304: 0.015, INOX_316: 0.015 },
      diametros_comerciales_in: [...UF.COMERCIALES_IN],
    };
  }

  /** Revisa unas políticas completas (las del proyecto o las que llegan en un JSON) y devuelve una copia limpia. */
  function validarPoliticas(p) {
    dato(esObjeto(p), 'Faltan las políticas.');
    const nums = (k, a, b) => { dato(finito(p[k]) && p[k] >= a && p[k] <= b, `La política ${k} debe ir de ${a} a ${b}.`); return p[k]; };
    const angulos = (k, a, b, vacio) => {
      dato(Array.isArray(p[k]) && (vacio || p[k].length > 0) && p[k].length <= 12 && p[k].every((x) => finito(x) && x >= a && x <= b), `La política ${k} debe ser una lista de ángulos de ${a}° a ${b}°.`);
      return [...new Set(p[k])].sort((x, y) => x - y);
    };
    const bool = (k) => { dato(typeof p[k] === 'boolean', `La política ${k} debe ser sí o no.`); return p[k]; };
    const r = p.rejilla;
    dato(esObjeto(r) && [15, 45, 90].includes(r.paso_azimut_deg) && Array.isArray(r.elevaciones_deg) && r.elevaciones_deg.length > 0 && r.elevaciones_deg.every((e) => ELEVACIONES.includes(e)),
      'La rejilla lleva un paso de rumbo de 15°, 45° o 90° y elevaciones de -90, -60, -45, -30, 0, 30, 45, 60 o 90°.');
    dato(r.elevaciones_deg.includes(0), 'La rejilla debe permitir tramos horizontales.');
    dato(Array.isArray(p.entradas_permitidas) && p.entradas_permitidas.every((e) => ['SUPERIOR', 'LATERAL', 'INFERIOR'].includes(e)), 'Las entradas permitidas son SUPERIOR, LATERAL o INFERIOR.');
    dato(['CONCENTRICA', 'EXCENTRICA_PLANA_ABAJO'].includes(p.reduccion_horizontal), 'La reducción horizontal es CONCENTRICA o EXCENTRICA_PLANA_ABAJO.');
    const mg = p.manguera;
    dato(esObjeto(mg) && [mg.radio_min_D, mg.largo_max_mm, mg.puno_mm, mg.rugosidad_mm].every((x) => finito(x) && x >= 0) && mg.largo_max_mm > 0 && mg.puno_mm <= 1000 && mg.radio_min_D <= 20,
      'La manguera lleva radio mínimo (× D), largo máximo, puño y rugosidad.');
    const ru = p.rugosidad_mm;
    dato(esObjeto(ru) && MATERIALES.every((k) => finito(ru[k]) && ru[k] >= 0 && ru[k] <= 10), 'La rugosidad va por material (mm).');
    dato(Array.isArray(p.diametros_comerciales_in) && p.diametros_comerciales_in.length > 0 && p.diametros_comerciales_in.length <= 60 && p.diametros_comerciales_in.every((d) => finito(d) && d >= 1 && d <= 120),
      'Los diámetros comerciales van de 1″ a 120″.');
    const v = {
      angulos_codo_deg: angulos('angulos_codo_deg', 1, 90), radio_codo_D: nums('radio_codo_D', 0.5, 10), angulos_injerto_deg: angulos('angulos_injerto_deg', 1, 89),
      permite_t_90: bool('permite_t_90'), permite_pantalon: bool('permite_pantalon'), angulos_pantalon_deg: angulos('angulos_pantalon_deg', 1, 90, true),
      entradas_permitidas: ['SUPERIOR', 'LATERAL', 'INFERIOR'].filter((e) => p.entradas_permitidas.includes(e)),
      rejilla: { paso_azimut_deg: r.paso_azimut_deg, elevaciones_deg: ELEVACIONES.filter((e) => r.elevaciones_deg.includes(e)) },
      paso_largo_mm: nums('paso_largo_mm', 1, 10000), largo_min_tramo_mm: nums('largo_min_tramo_mm', 0, 10000), recto_min_entre_accesorios_mm: nums('recto_min_entre_accesorios_mm', 0, 10000),
      recto_antes_de_derivacion_D: nums('recto_antes_de_derivacion_D', 0, 20), distancia_min_entre_derivaciones_D: nums('distancia_min_entre_derivaciones_D', 0, 20),
      holgura_min_mm: nums('holgura_min_mm', 0, 5000), altura_libre_min_mm: nums('altura_libre_min_mm', 0, 50000),
      velocidad_min_m_s: nums('velocidad_min_m_s', 0, 100), velocidad_max_m_s: nums('velocidad_max_m_s', 0, 100), semiangulo_reduccion_deg: nums('semiangulo_reduccion_deg', 1, 45),
      reduccion_horizontal: p.reduccion_horizontal, relacion_reduccion_min: nums('relacion_reduccion_min', 0, 1),
      manguera: { radio_min_D: mg.radio_min_D, largo_max_mm: mg.largo_max_mm, puno_mm: mg.puno_mm, rugosidad_mm: mg.rugosidad_mm },
      rugosidad_mm: { GALVANIZADO: ru.GALVANIZADO, ACERO_CARBON: ru.ACERO_CARBON, INOX_304: ru.INOX_304, INOX_316: ru.INOX_316 },
      diametros_comerciales_in: [...new Set(p.diametros_comerciales_in)].sort((x, y) => x - y),
    };
    dato(v.velocidad_max_m_s >= v.velocidad_min_m_s, 'La velocidad máxima no puede ser menor que la mínima.');
    // conserva el orden de las listas como vienen si ya estaban ordenadas (las del taller lo están)
    ['angulos_codo_deg', 'angulos_injerto_deg', 'angulos_pantalon_deg', 'diametros_comerciales_in'].forEach((k) => { if (JSON.stringify([...p[k]]) === JSON.stringify(v[k])) v[k] = [...p[k]]; });
    return v;
  }

  /* ------------------------------------------------------------------ la manguera (§2.8.2) */

  /**
   * La manguera de la toma (P_t, saliendo en u_t) al punto de transición (P_r, donde el rígido sigue en u_r), de Ø diametro_in.
   * Puertos paralelos: RECTA o S de dos arcos iguales y contrarios, R = (e² + h′²)/(4e), α = 2·atan(e/h′), L = 2Rα + 2·puño.
   * Ejes que se cruzan en K a un ángulo γ: un arco (CODO) tangente a los dos, R = (min(a, b) − puño)/tan(γ/2).
   * Lo demás: LIBRE, una Bézier cúbica tangente a los dos con manijas de ⅓, muestreada en 64 puntos.
   * Devuelve la geometría, largo_mm, posible (radio y espacio), larga (pasa del largo máximo), torcida (no está en un plano) y
   * motivo cuando no se puede.
   */
  function resolverManguera(x) {
    const p = x.manguera.puno_mm;
    const Rmin = x.manguera.radio_min_D * x.diametro_in * IN;
    const ut = unitario(x.u_t);
    const ur = unitario(x.u_r);
    const d = resta(x.P_r, x.P_t);
    const h = punto(d, ut);
    const ev = resta(d, por(ut, h));
    const e = norma(ev);
    // altura_min_mm: con puertos paralelos, la altura del PT a partir de la cual la manguera ya cabe con su radio mínimo
    const base = { radio_min_mm: Rmin, desvio_mm: e, altura_mm: h, puno_mm: p, torcida: false, motivo: null, altura_min_mm: null };
    const fin = (r) => ({ ...base, ...r, larga: !!r.posible && r.largo_mm > x.manguera.largo_max_mm + 1e-9 });
    const cosg = punto(ut, ur);
    if (cosg > 1 - 1e-9) {
      base.altura_min_mm = 2 * p + (e < TOL_MM ? 0 : Math.sqrt(Math.max(0, 4 * e * Rmin - e * e)));
      if (h <= 0) return fin({ forma: 'RECTA', radio_mm: null, angulo_curva_deg: null, curvas: 0, tramo_recto_mm: 0, normal_plano: null, largo_mm: Math.abs(h), posible: false, motivo: 'El punto de transición tiene que quedar adelante de la toma, en la dirección de su cuello.' });
      const hp = h - 2 * p;
      if (e < TOL_MM) {
        return fin({ forma: 'RECTA', radio_mm: null, angulo_curva_deg: null, curvas: 0, desvio_mm: 0, tramo_recto_mm: Math.max(0, hp), normal_plano: null, largo_mm: h, posible: hp >= -1e-9,
          motivo: hp >= -1e-9 ? null : `La manguera recta necesita al menos ${n(2 * p)} mm para sus dos puños: suba el punto de transición.` });
      }
      if (hp <= 0) return fin({ forma: 'S', radio_mm: null, angulo_curva_deg: null, curvas: 2, tramo_recto_mm: 0, normal_plano: unitario(cruz(ut, ev)), largo_mm: h, posible: false, motivo: `Con puños de ${n(p)} mm la altura del punto de transición debe pasar de ${n(2 * p)} mm.` });
      const R = (e * e + hp * hp) / (4 * e);
      const al = 2 * Math.atan(e / hp);
      const ok = R >= Rmin - 1e-9;
      return fin({ forma: 'S', radio_mm: R, angulo_curva_deg: al / DEG, curvas: 2, tramo_recto_mm: 0, normal_plano: unitario(cruz(ut, ev)), largo_mm: 2 * R * al + 2 * p, posible: ok,
        motivo: ok ? null : `El desvío de ${n(e)} mm en ${n(h)} mm de altura pide un radio de ${n(R)} mm; la manguera de ${pulgadas(x.diametro_in)} necesita ${n(Rmin, 1)} mm.` });
    }
    // ejes que se cruzan: P_t + a·u_t = P_r − b·u_r
    const gam = Math.acos(clamp(cosg, -1, 1));
    if (gam < Math.PI - 1e-6) {
      const w0 = d;
      const A11 = 1;
      const A12 = cosg;
      const b1 = punto(w0, ut);
      const b2 = punto(w0, ur);
      const det = A11 * 1 - A12 * A12;
      const a = (b1 - A12 * b2) / det;
      const b = (A11 * b2 - A12 * b1) / det;
      const K1 = suma(x.P_t, por(ut, a));
      const K2 = resta(x.P_r, por(ur, b));
      if (norma(resta(K1, K2)) <= TOL_MM && a > 0 && b > 0) {
        const tg = Math.tan(gam / 2);
        const R = (Math.min(a, b) - p) / tg;
        const T = R * tg;
        const ok = Math.min(a, b) - p > 0 && R >= Rmin - 1e-9;
        return fin({ forma: 'CODO', radio_mm: R > 0 ? R : null, angulo_curva_deg: gam / DEG, curvas: 1, tramo_recto_mm: Math.max(0, a + b - 2 * T - 2 * p), normal_plano: unitario(cruz(ut, ur)),
          largo_mm: R > 0 ? a - T + (b - T) + R * gam : a + b, posible: ok,
          motivo: ok ? null : `La curva de ${n(gam / DEG)}° de la manguera pide un radio de ${n(Math.max(0, R))} mm; la de ${pulgadas(x.diametro_in)} necesita ${n(Rmin, 1)} mm: aleje el punto de transición.` });
      }
    }
    // LIBRE: Bézier cúbica entre los puños
    const P0 = suma(x.P_t, por(ut, p));
    const P3 = resta(x.P_r, por(ur, p));
    const dist = norma(resta(P3, P0));
    if (dist < 1e-6) return fin({ forma: 'LIBRE', radio_mm: null, angulo_curva_deg: gam / DEG, curvas: 1, tramo_recto_mm: 0, normal_plano: null, largo_mm: 2 * p, posible: false, motivo: 'La toma y el punto de transición están demasiado cerca.' });
    const P1 = suma(P0, por(ut, dist / 3));
    const P2 = resta(P3, por(ur, dist / 3));
    const B = (s) => { const q = 1 - s; return suma(suma(por(P0, q * q * q), por(P1, 3 * q * q * s)), suma(por(P2, 3 * q * s * s), por(P3, s * s * s))); };
    const B1 = (s) => { const q = 1 - s; return suma(suma(por(resta(P1, P0), 3 * q * q), por(resta(P2, P1), 6 * q * s)), por(resta(P3, P2), 3 * s * s)); };
    const B2 = (s) => suma(por(suma(resta(P2, por(P1, 2)), P0), 6 * (1 - s)), por(suma(resta(P3, por(P2, 2)), P1), 6 * s));
    let L = 0;
    let Rk = Infinity;
    let prev = B(0);
    for (let i = 0; i <= 64; i += 1) {
      const s = i / 64;
      const q = B(s);
      if (i) L += norma(resta(q, prev));
      prev = q;
      const v1 = B1(s);
      const k = norma(cruz(v1, B2(s)));
      if (k > 1e-12) Rk = Math.min(Rk, Math.pow(norma(v1), 3) / k);
    }
    const torcida = Math.abs(punto(resta(P1, P0), cruz(resta(P2, P0), resta(P3, P0)))) / Math.pow(dist, 3) > 1e-6;
    const nrm = unitario(cruz(resta(P1, P0), resta(P3, P0)));
    const ok = Rk >= Rmin - 1e-9;
    return fin({ forma: 'LIBRE', radio_mm: Number.isFinite(Rk) ? Rk : null, angulo_curva_deg: gam / DEG, curvas: 1, tramo_recto_mm: 0, normal_plano: torcida || norma(nrm) < 0.5 ? null : nrm,
      largo_mm: L + 2 * p, posible: ok, torcida, motivo: ok ? null : `La manguera tendría que doblarse a un radio de ${n(Rk)} mm; la de ${pulgadas(x.diametro_in)} necesita ${n(Rmin, 1)} mm.` });
  }

  /** Puntos a lo largo de una manguera resuelta (para el dibujo y los choques). */
  function puntosManguera(x, r) {
    const ut = unitario(x.u_t);
    const ur = unitario(x.u_r);
    const p = r.puno_mm;
    if (r.forma === 'RECTA' || !r.posible) return [x.P_t, x.P_r];
    if (r.forma === 'S') {
      const ev = resta(resta(x.P_r, x.P_t), por(ut, r.altura_mm));
      const lat = unitario(ev);
      const R = r.radio_mm;
      const al = r.angulo_curva_deg * DEG;
      const S1 = suma(x.P_t, por(ut, p));
      const C1 = suma(S1, por(lat, R));
      const pts = [x.P_t, S1];
      for (let i = 1; i <= 16; i += 1) { const f = (al * i) / 16; pts.push(suma(C1, suma(por(lat, -R * Math.cos(f)), por(ut, R * Math.sin(f))))); }
      const E1 = pts[pts.length - 1];
      const C2 = suma(E1, resta(E1, C1));
      for (let i = 15; i >= 0; i -= 1) { const f = (al * i) / 16; pts.push(suma(C2, suma(por(lat, R * Math.cos(f)), por(ut, -R * Math.sin(f))))); }
      pts.push(x.P_r);
      return pts;
    }
    const P0 = suma(x.P_t, por(ut, p));
    const P3 = resta(x.P_r, por(ur, p));
    const dist = norma(resta(P3, P0));
    const P1 = suma(P0, por(ut, dist / 3));
    const P2 = resta(P3, por(ur, dist / 3));
    const pts = [x.P_t];
    for (let i = 0; i <= 32; i += 1) {
      const s = i / 32;
      const q = 1 - s;
      pts.push(suma(suma(por(P0, q * q * q), por(P1, 3 * q * q * s)), suma(por(P2, 3 * q * s * s), por(P3, s * s * s))));
    }
    pts.push(x.P_r);
    return pts;
  }

  /* ------------------------------------------------------------------ el modelo */

  const id2 = (pref, k) => `${pref}-${String(k).padStart(2, '0')}`;
  const id3 = (pref, k) => `${pref}-${String(k).padStart(3, '0')}`;
  const numeroDe = (id) => Number(String(id).replace(/^\D+-/, '')) || 0;
  function nuevoId(m, pref) {
    const corto = pref === 'EQ' || pref === 'PU';
    dato(m.cuenta[pref] < (corto ? 999 : 9999), `El trazo ya usó todos los identificadores ${pref}: empiece uno nuevo o renumere.`);
    m.cuenta[pref] += 1;
    return (corto ? id2 : id3)(pref, m.cuenta[pref]);
  }
  const cuentaVacia = () => ({ EQ: 0, PU: 0, N: 0, TR: 0, CO: 0, RE: 0, AD: 0, IN: 0, RI: 0, PA: 0, TE: 0, CP: 0 });

  const texto = (v, porOmision, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : porOmision);
  function coordenada(p, que) {
    dato(esObjeto(p) && [p.x, p.y, p.z].every((c) => finito(c) && Math.abs(c) <= MAX_COORD_MM), `${que}: X, Y y Z en mm (hasta 10 km).`);
    return r3v(p);
  }
  function direccionValida(d, pol, que) {
    dato(esObjeto(d) && finito(d.azimut_deg) && finito(d.elevacion_deg), `${que}: falta la dirección (rumbo y elevación).`);
    const x = { azimut_deg: Math.abs(d.elevacion_deg) === 90 ? 0 : norm360(d.azimut_deg), elevacion_deg: d.elevacion_deg };
    dato(ELEVACIONES.includes(x.elevacion_deg) && x.azimut_deg % 15 === 0, `${que}: el rumbo va cada 15° y la elevación es -90, -60, -45, -30, 0, 30, 45, 60 o 90°.`);
    if (pol) dato(enRejilla(x, pol), `${que}: ${textoDireccion(x)} no está en la rejilla de este proyecto.`);
    return x;
  }
  function diametroValido(m, D, que) {
    dato(m.politicas.diametros_comerciales_in.includes(D), `${que}: el diámetro debe ser uno de los comerciales (${m.politicas.diametros_comerciales_in.join(', ')}″).`);
    return D;
  }
  function largoValido(m, L, que) {
    dato(finito(L) && L >= m.politicas.largo_min_tramo_mm - 1e-9 && L <= LARGO_MAX_MM, `${que}: el largo de un tramo va de ${metros(m.politicas.largo_min_tramo_mm)} a 100 m.`);
    return L;
  }
  const rigido = (t) => t.tipo === 'RIGIDO';
  const flexible = (t) => t.tipo === 'FLEXIBLE';

  /** Un trazo vacío con el proyecto y las políticas del taller (§1.0). */
  function nuevo(M, opciones) {
    const o = esObjeto(opciones) ? opciones : {};
    const m = {
      version: VERSION,
      proyecto: { id: 'TRAZADO-01', nombre: 'Trazado', servicio: 'POLVO', material_transportado: null, aire: { temperatura_C: 20, altitud_m: 0, presion_Pa: null, densidad_kg_m3: null, viscosidad_Pa_s: null },
        diametro_unidad: 'in', origen: 'Origen del proyecto', vista_iso: 'NE' },
      politicas: politicasDe(M, 'POLVO'),
      material: { material: 'GALVANIZADO', calibre: 22 },
      equipos: [], nodos: [], tramos: [], piezas: {}, cuenta: cuentaVacia(), ultimo: null,
    };
    aplicarProyecto(m, M, esObjeto(o.proyecto) ? o.proyecto : {});
    if (o.material !== undefined || o.calibre !== undefined) aplicarMaterial(m, M, o.material || m.material.material, o.calibre === undefined ? m.material.calibre : o.calibre);
    if (o.politicas !== undefined) m.politicas = validarPoliticas({ ...m.politicas, ...o.politicas });
    return m;
  }

  function aplicarProyecto(m, M, c) {
    const pr = m.proyecto;
    if (c.id !== undefined) pr.id = texto(c.id, pr.id, 40);
    if (c.nombre !== undefined) pr.nombre = texto(c.nombre, pr.nombre, 120);
    if (c.servicio !== undefined) {
      dato(SERVICIOS.includes(c.servicio), 'El servicio es POLVO, ABRASIVO, VENTILACION o HUMOS.');
      if (c.servicio !== pr.servicio) Object.assign(m.politicas, POR_SERVICIO[c.servicio]);
      pr.servicio = c.servicio;
    }
    if (c.material_transportado !== undefined) pr.material_transportado = c.material_transportado === null ? null : texto(c.material_transportado, null, 120);
    if (c.aire !== undefined) {
      dato(esObjeto(c.aire), 'El aire lleva temperatura y altitud.');
      const a = { ...pr.aire, ...c.aire };
      dato(finito(a.temperatura_C) && a.temperatura_C >= -40 && a.temperatura_C <= 400, 'La temperatura del aire va de -40 °C a 400 °C.');
      dato(finito(a.altitud_m) && a.altitud_m >= -500 && a.altitud_m <= 6000, 'La altitud va de -500 m a 6 000 m.');
      ['presion_Pa', 'densidad_kg_m3', 'viscosidad_Pa_s'].forEach((k) => dato(a[k] === null || (finito(a[k]) && a[k] > 0), `${k}: un número positivo, o vacío para calcularlo.`));
      pr.aire = { temperatura_C: a.temperatura_C, altitud_m: a.altitud_m, presion_Pa: a.presion_Pa, densidad_kg_m3: a.densidad_kg_m3, viscosidad_Pa_s: a.viscosidad_Pa_s };
    }
    if (c.diametro_unidad !== undefined) { dato(['in', 'mm'].includes(c.diametro_unidad), 'El diámetro se muestra en in o en mm.'); pr.diametro_unidad = c.diametro_unidad; }
    if (c.origen !== undefined) pr.origen = texto(c.origen, pr.origen, 200);
    if (c.vista_iso !== undefined) { dato(Object.prototype.hasOwnProperty.call(VISTAS, c.vista_iso), 'La vista es NE, NO, SE o SO.'); pr.vista_iso = c.vista_iso; }
  }
  function aplicarMaterial(m, M, material, calibre) {
    dato(MATERIALES.includes(material) && M.materiales[material], `El material es ${MATERIALES.join(', ')}.`);
    const tabla = M.calibres[M.materiales[material].tabla_calibre] || {};
    dato(Number.isInteger(calibre) && tabla[String(calibre)] !== undefined, `El calibre ${calibre} no está en la tabla del material.`);
    m.material = { material, calibre };
  }

  const inicio = (t0) => {
    dato(esObjeto(t0) && t0.version === VERSION && Array.isArray(t0.tramos) && Array.isArray(t0.nodos) && Array.isArray(t0.equipos), 'No es un trazo isométrico de esta versión.');
    const m = clonar(t0);
    m.ultimo = null;
    return m;
  };
  const nodoDe = (m, id) => m.nodos.find((x) => x.id === id) || falla('DATO_INVALIDO', `No existe el nodo ${id}.`, [id]);
  const tramoDe = (m, id) => m.tramos.find((x) => x.id === id) || falla('DATO_INVALIDO', `No existe el tramo ${id}.`, [id]);
  const equipoDe = (m, id) => m.equipos.find((x) => x.id === id) || falla('DATO_INVALIDO', `No existe el equipo ${id}.`, [id]);
  function puertoDe(m, id) {
    for (const e of m.equipos) { const p = e.puertos.find((x) => x.id === id); if (p) return { equipo: e, puerto: p }; }
    return falla('DATO_INVALIDO', `No existe el puerto ${id}.`, [id]);
  }
  function crearNodo(m, P) {
    dato(m.nodos.length < MAX_NODOS, `El trazo ya tiene ${MAX_NODOS} nodos.`);
    const nd = { id: nuevoId(m, 'N'), posicion_mm: r3v(P), puerto: null, ancla: false };
    m.nodos.push(nd);
    return nd.id;
  }
  /** Un nodo que ya está en P (a 0.5 mm), si lo hay. */
  const nodoEn = (m, P, excepto) => m.nodos.find((x) => x.id !== excepto && norma(resta(x.posicion_mm, P)) <= TOL_MM) || null;

  /** Posición y dirección absolutas de un puerto: la del equipo más la local girada rotacion_z_deg. */
  function ubicarPuerto(e, p) {
    const d = p.direccion_local;
    return {
      posicion_mm: r3v(suma(e.posicion_mm, girarZ(p.posicion_local_mm, e.rotacion_z_deg))),
      direccion: { azimut_deg: Math.abs(d.elevacion_deg) === 90 ? 0 : norm360(d.azimut_deg + e.rotacion_z_deg), elevacion_deg: d.elevacion_deg },
    };
  }
  /** Las caras de la caja sobre las que está un punto local (sus normales hacia fuera). */
  function carasEn(caja, q) {
    const L = caja.largo / 2;
    const W = caja.ancho / 2;
    const H = caja.alto;
    const t = TOL_MM;
    if (Math.abs(q.x) > L + t || Math.abs(q.y) > W + t || q.z < -t || q.z > H + t) return [];
    return [[q.x - L, V3(1, 0, 0)], [-L - q.x, V3(-1, 0, 0)], [q.y - W, V3(0, 1, 0)], [-W - q.y, V3(0, -1, 0)], [q.z - H, Z], [-q.z, V3(0, 0, -1)]]
      .filter(([dd]) => Math.abs(dd) <= t).map(([, nn]) => nn);
  }

  /* ------------------------------------------------------------------ cálculo: posiciones, sentido, piezas, caudales */

  const cacheMotor = typeof WeakMap === 'function' ? new WeakMap() : null;
  function motor(M, base, p) {
    let c = cacheMotor && cacheMotor.get(M);
    if (cacheMotor && !c) { c = new Map(); cacheMotor.set(M, c); }
    const k = JSON.stringify([base.material_id, base.calibre, p]);
    if (c && c.has(k)) return c.get(k);
    let r;
    try { r = { ok: true, d: COT.cotizarPartida({ ...base, ...p }, M).geometria.detalle }; } catch (e) { r = { ok: false, error: (e.errores || [String(e.message || e)]).join(' ') }; }
    if (c) { if (c.size > 4000) c.clear(); c.set(k, r); }
    return r;
  }
  const baseMotor = (t) => ({ material_id: t.material, calibre: String(t.calibre), ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', cantidad: 1 });
  const geomVacia = () => ({ angulo_deg: null, radio_eje_mm: null, tangente_mm: null, gajos: null, normal_plano: null, giro_entrada_deg: null, entrada: null, forma: null, semiangulo_deg: null, largo_mm: null, largo_ramal_mm: null });
  const perdidaReduccion = (crece) => (crece ? { modelo: 'EXPANSION', K_paso: null, K_ramal: null, referencia: 'Expansión gradual: K(α, A₁/A₂)' } : { modelo: 'CONTRACCION', K_paso: null, K_ramal: null, referencia: 'Contracción gradual: K(α, A₂/A₁)' });
  const area = (D_in) => (Math.PI * Math.pow((D_in * IN) / 1000, 2)) / 4;
  const velocidad = (Q, D_in) => (Q === null ? null : Q / 3600 / area(D_in));

  /**
   * Todo lo que sale del trazo: posiciones, direcciones y largos, redes y su sentido, mangueras resueltas, la pieza de cada
   * nodo con lo que ocupa, longitudes netas, caudales y velocidades, y los problemas BLOQUEANTES que encuentra en el camino.
   */
  function calcular(m, M) {
    const pol = m.politicas;
    const g = {
      pos: new Map(), ady: new Map(), seg: new Map(), mang: new Map(), puertos: new Map(), puertoDeNodo: new Map(), pt: new Map(), fijos: new Set(),
      comps: [], compDe: new Map(), arriba: new Map(), abajo: new Map(), sale: new Map(), Q: new Map(), v: new Map(), tipo: new Map(),
      piezas: [], piezasDe: new Map(), ocupa: new Map(), neta: new Map(), problemas: [],
    };
    const prob = (codigo, mensaje, elementos, sugerencia) => g.problemas.push({ codigo, severidad: 'BLOQUEANTE', elementos: elementos || [], mensaje, sugerencia: sugerencia || null });
    const tramos = new Map(m.tramos.map((t) => [t.id, t]));
    g.tramos = tramos;
    m.nodos.forEach((x) => { g.pos.set(x.id, x.posicion_mm); g.ady.set(x.id, []); if (x.puerto) g.puertoDeNodo.set(x.id, x.puerto); });
    m.equipos.forEach((e) => e.puertos.forEach((p) => {
      g.puertos.set(p.id, { equipo: e, puerto: p, ...ubicarPuerto(e, p) });
      if (p.acople && p.acople.tipo === 'MANGUERA') g.pt.set(p.acople.nodo_transicion, p.id);
    }));
    m.tramos.forEach((t) => { g.ady.get(t.a).push({ tramo: t, otro: t.b }); g.ady.get(t.b).push({ tramo: t, otro: t.a }); });

    // tramos rígidos: largo y dirección de la rejilla (de a hacia b)
    m.tramos.filter(rigido).forEach((t) => {
      const w = resta(g.pos.get(t.b), g.pos.get(t.a));
      const L = norma(w);
      const dir = direccionDeVector(w, pol);
      g.seg.set(t.id, { L, dir, u: dir ? vectorDe(dir) : unitario(w) });
      if (!dir) prob('DIRECCION_FUERA_DE_REJILLA', `El tramo ${t.id} no va en una dirección de la rejilla.`, [t.id]);
      if (L < pol.largo_min_tramo_mm - 1e-6 || L > LARGO_MAX_MM + 1e-6) prob('LARGO_FUERA_DE_RANGO', `El largo de un tramo va de ${metros(pol.largo_min_tramo_mm)} a 100 m (${t.id} mide ${metros(L)}).`, [t.id]);
    });
    /** Del nodo hacia el otro extremo del tramo (vector exacto de la rejilla). */
    const fuera = (t, nid) => { const s = g.seg.get(t.id); return t.a === nid ? s.u : por(s.u, -1); };
    g.fuera = fuera;

    // puertos: posición, ocupación, alineación; los puntos fijos
    g.puertos.forEach((pu, pid) => {
      const p = pu.puerto;
      const nd = p.nodo;
      if (!g.pos.has(nd)) { prob('DATO_INVALIDO', `El puerto ${pid} no tiene su nodo.`, [pid]); return; }
      if (norma(resta(g.pos.get(nd), pu.posicion_mm)) > TOL_DIR_MM) prob('DATO_INVALIDO', `El nodo ${nd} no está en el puerto ${pid}.`, [nd, pid]);
      const ad = g.ady.get(nd);
      const rig = ad.filter((x) => rigido(x.tramo));
      const flex = ad.filter((x) => flexible(x.tramo));
      const nombre = `${p.rol === 'ENTRADA' ? 'La boca' : 'La toma'} ${pid} (${pu.equipo.nombre})`;
      if (p.rol === 'SALIDA' && ad.length) prob('PUERTO_OCUPADO', `La descarga ${pid} todavía no se traza: conecte el ducto a una toma o a una boca de colector.`, [pid]);
      if (ad.length > 1) prob('PUERTO_OCUPADO', `${nombre} ya está conectada.`, [pid, nd]);
      const ac = p.acople;
      if (rig.length && !(ac && ac.tipo === 'BRIDA')) prob('PUERTO_OCUPADO', `${nombre} ${ac ? 'tiene manguera: el ducto empieza en su punto de transición' : 'no tiene acople: elija manguera o brida'}.`, [pid, nd]);
      if (flex.length && !(ac && ac.tipo === 'MANGUERA' && ac.tramo_flexible === flex[0].tramo.id)) prob('PUERTO_OCUPADO', `${nombre} no está acoplada con esa manguera.`, [pid, nd]);
      if (rig.length && ac && ac.tipo === 'BRIDA') {
        g.fijos.add(nd);
        const t = rig[0].tramo;
        if (g.seg.get(t.id).dir && anguloEntre(fuera(t, nd), vectorDe(pu.direccion)) > TOL_ANG) {
          prob('BRIDA_DESALINEADA', `La brida va alineada con el cuello ${p.rol === 'ENTRADA' ? 'de la boca' : 'de la toma'} ${pid} de ${pu.equipo.nombre} (${textoDireccion(pu.direccion)}).`, [pid, t.id], `El primer tramo sale en ${textoDireccion(pu.direccion)}.`);
        }
      }
    });
    m.nodos.forEach((x) => { if (x.ancla) g.fijos.add(x.id); });

    // redes: componentes, circuitos, colectores y sentido del aire
    const visto = new Set();
    m.nodos.forEach((n0) => {
      if (visto.has(n0.id)) return;
      const comp = { indice: g.comps.length, nodos: [], tramos: [], sumideros: [], extremos: [], tomas: [], flujo: null, sumidero: null, ciclo: false };
      const cola = [n0.id];
      visto.add(n0.id);
      const ts = new Set();
      while (cola.length) {
        const u = cola.shift();
        comp.nodos.push(u);
        g.compDe.set(u, comp.indice);
        g.ady.get(u).forEach(({ tramo, otro }) => { ts.add(tramo.id); if (!visto.has(otro)) { visto.add(otro); cola.push(otro); } });
      }
      comp.tramos = [...ts];
      comp.ciclo = comp.tramos.length > comp.nodos.length - 1;
      comp.nodos.forEach((u) => {
        const pid = g.puertoDeNodo.get(u);
        const pu = pid && g.puertos.get(pid);
        if (pu && pu.puerto.rol === 'ENTRADA') comp.sumideros.push(u);
        else if (pu && pu.puerto.rol === 'TOMA') comp.tomas.push(u);
        else if (!pu && !g.pt.has(u) && g.ady.get(u).length === 1) comp.extremos.push(u);
      });
      if (comp.ciclo) prob('CIRCUITO', 'Esta unión cerraría un circuito: una red de extracción es un árbol.', comp.tramos.slice(0, 6));
      if (comp.sumideros.length > 1 && comp.tramos.length) prob('DOS_COLECTORES', 'Esta red llegaría a dos bocas de colector: cada red llega a una sola boca.', comp.sumideros.map((u) => g.puertoDeNodo.get(u)));
      if (comp.sumideros.length === 1) { comp.flujo = 'COLECTOR'; comp.sumidero = comp.sumideros[0]; } else if (!comp.sumideros.length && comp.extremos.length === 1 && comp.tomas.length) { comp.flujo = 'PROVISIONAL'; comp.sumidero = comp.extremos[0]; }
      if (comp.sumidero && !comp.ciclo) {
        const cola2 = [comp.sumidero];
        const v2 = new Set(cola2);
        comp.orden = [];
        while (cola2.length) {
          const u = cola2.shift();
          comp.orden.push(u);
          g.ady.get(u).forEach(({ tramo, otro }) => {
            if (v2.has(otro)) return;
            v2.add(otro);
            g.abajo.set(tramo.id, u);
            g.arriba.set(tramo.id, otro);
            g.sale.set(otro, tramo.id);
            cola2.push(otro);
          });
        }
      } else comp.flujo = null;
      g.comps.push(comp);
    });
    g.conocido = (tid) => g.abajo.has(tid);
    /** El aire de un tramo rígido: de aguas arriba hacia aguas abajo (o de a hacia b si no se sabe). */
    g.aire = (t) => (g.arriba.has(t.id) ? fuera(t, g.arriba.get(t.id)) : g.seg.get(t.id).u);
    g.entran = (nid) => g.ady.get(nid).filter(({ tramo }) => g.abajo.get(tramo.id) === nid).map(({ tramo }) => tramo);

    // mangueras
    m.tramos.filter(flexible).forEach((t) => {
      const pid = g.puertoDeNodo.get(t.a);
      const pu = pid && g.puertos.get(pid);
      const ac = pu && pu.puerto.acople;
      if (!pu || !ac || ac.tipo !== 'MANGUERA' || ac.nodo_transicion !== t.b || ac.tramo_flexible !== t.id) { prob('DATO_INVALIDO', `La manguera ${t.id} no va de una toma a su punto de transición.`, [t.id]); return; }
      const x = { P_t: g.pos.get(t.a), u_t: vectorDe(pu.direccion), P_r: g.pos.get(t.b), u_r: vectorDe(ac.direccion_pt), diametro_in: t.diametro_in, manguera: pol.manguera };
      const r = resolverManguera(x);
      r.entrada = x;
      g.mang.set(t.id, r);
      if (!r.posible) prob('MANGUERA_IMPOSIBLE', r.motivo, [t.id, pid], 'Suba el punto de transición o reduzca el desvío.');
      const muestras = puntosManguera(x, r);
      if (muestras.some((q) => q.z - (t.diametro_in * IN) / 2 < -TOL_MM)) prob('BAJO_PISO', `La manguera ${t.id} quedaría bajo el piso.`, [t.id]);
    });

    // la pieza de cada nodo
    const angCodo = pol.angulos_codo_deg;
    const angInj = pol.angulos_injerto_deg;
    const cerca = (x, xs) => xs.find((a) => Math.abs(a - x) < TOL_ANG);
    const forma = (t) => (Math.abs(g.seg.get(t.id).u.z) < 1e-9 ? pol.reduccion_horizontal : 'CONCENTRICA');
    const ocupar = (pz, t, mm, nid) => { pz.ocupa.push({ tramo: t.id, mm, nodo: nid }); };
    const pieza = (tipo, nid, x) => {
      const pz = { id: (m.piezas[nid] && m.piezas[nid][tipo]) || null, tipo, nodo: nid, conexiones: [], geometria: geomVacia(), perdida: null, familia_cotizap: null, ocupa: [], ...x };
      g.piezas.push(pz);
      if (!g.piezasDe.has(nid)) g.piezasDe.set(nid, []);
      g.piezasDe.get(nid).push(pz);
      return pz;
    };
    function reduccion(nid, tipo, tMayor, tMenor, D1, D2, todoEnMenor, roles, t0) {
      const tRef = t0 || tMenor || tMayor;
      const fm = forma(tRef);
      const r = motor(M, baseMotor(tRef), { familia: 'REDUCCION', D1_mm: r1(D1 * IN), D2_mm: r1(D2 * IN), excentrica: fm === 'CONCENTRICA' ? 'NO' : 'CARA_PLANA' });
      if (!r.ok) { prob('PIEZA_NO_FABRICABLE', `El motor no puede fabricar la reducción de ${nid}: ${r.error}`, [nid]); return null; }
      const L = r.d.L_mm;
      const dd = (D1 - D2) * IN;
      const pz = pieza(tipo, nid, {
        conexiones: roles,
        geometria: { ...geomVacia(), forma: fm, semiangulo_deg: Math.atan(fm === 'CONCENTRICA' ? dd / (2 * L) : dd / L) / DEG, largo_mm: L },
        familia_cotizap: 'REDUCCION', D1, D2,
      });
      if (todoEnMenor) ocupar(pz, tMenor, L, nid); else { ocupar(pz, tMayor, L / 2, nid); ocupar(pz, tMenor, L / 2, nid); }
      return pz;
    }
    const tablaCal = (t) => M.calibres[M.materiales[t.material].tabla_calibre] || {};

    m.nodos.forEach((nd) => {
      const nid = nd.id;
      const ad = g.ady.get(nid);
      const rig = ad.filter((x) => rigido(x.tramo)).map((x) => x.tramo);
      const pid = g.puertoDeNodo.get(nid);
      const sinCompuerta = (porque) => { if (nd.compuerta) prob('COMPUERTA_NO_VA', `La compuerta de ${nid} va en un tramo recto del mismo Ø: ${porque}.`, [nid], 'Quítela de ahí y póngala en un tramo recto.'); };
      if (pid || g.pt.has(nid)) sinCompuerta(pid ? 'ahí está la brida del equipo' : 'ahí empieza la manguera');
      else if (rig.length !== 2 || rig.length !== ad.length) sinCompuerta(rig.length > 2 ? 'ahí hay una derivación' : 'ahí termina el ducto');
      if (pid || g.pt.has(nid)) {
        g.tipo.set(nid, pid ? 'PUERTO' : 'TRANSICION');
        if (!pid) {
          const pu = g.puertos.get(g.pt.get(nid));
          if (rig.length > 1 || ad.filter((x) => flexible(x.tramo)).length !== 1) prob('PUERTO_OCUPADO', `El punto de transición ${nid} ya tiene su ducto.`, [nid]);
          if (rig.length && g.seg.get(rig[0].id).dir && anguloEntre(fuera(rig[0], nid), vectorDe(pu.puerto.acople.direccion_pt)) > TOL_ANG) {
            prob('PT_DESALINEADO', `El ducto sale del punto de transición ${nid} en la dirección de la manguera (${textoDireccion(pu.puerto.acople.direccion_pt)}).`, [nid, rig[0].id]);
          }
        }
        // adaptador: el Ø del ducto no es el del puerto o de la manguera
        const Dp = pid ? g.puertos.get(pid).puerto.diametro_in : (ad.find((x) => flexible(x.tramo)) || { tramo: { diametro_in: null } }).tramo.diametro_in;
        if (rig.length === 1 && Dp && rig[0].diametro_in !== Dp && g.seg.get(rig[0].id).dir) {
          const t = rig[0];
          const entraAire = pid && g.puertos.get(pid).puerto.rol === 'ENTRADA';
          const pz = reduccion(nid, 'ADAPTADOR', t, t, Math.max(Dp, t.diametro_in), Math.min(Dp, t.diametro_in), true, [{ rol: entraAire ? 'ENTRADA' : 'SALIDA', tramo: t.id, diametro_in: t.diametro_in }], t);
          if (pz) {
            pz.todoEn = t.id;
            pz.D_puerto = Dp;
            const crece = entraAire ? Dp > t.diametro_in : t.diametro_in > Dp;
            pz.perdida = perdidaReduccion(crece);
          }
        }
        return;
      }
      if (!ad.length) { g.tipo.set(nid, 'EXTREMO'); return; }
      if (rig.length !== ad.length) { prob('DATO_INVALIDO', `En ${nid} hay una manguera que no sale de una toma.`, [nid]); return; }
      if (rig.length === 1) { g.tipo.set(nid, 'EXTREMO'); return; }
      if (rig.some((t) => !g.seg.get(t.id).dir)) { g.tipo.set(nid, rig.length === 2 ? 'VERTICE' : 'DERIVACION'); return; }
      if (rig.length === 2) {
        let [ti, to] = rig;
        if (g.abajo.get(ti.id) !== nid && g.abajo.get(to.id) === nid) [ti, to] = [to, ti];
        const conocido = g.abajo.get(ti.id) === nid && g.arriba.get(to.id) === nid;
        const dIn = conocido ? g.aire(ti) : por(fuera(ti, nid), -1);
        const dOut = conocido ? g.aire(to) : fuera(to, nid);
        const th = anguloEntre(dIn, dOut);
        const Din = ti.diametro_in;
        const Dout = to.diametro_in;
        if (conocido && Dout < Din) prob('DIAMETRO_DECRECE', `Hacia el colector el diámetro no baja: en ${nid} el tramo anterior (${ti.id}) es de ${pulgadas(Din)} y el siguiente (${to.id}) de ${pulgadas(Dout)}.`, [nid, ti.id, to.id], `Suba ${to.id} a ${pulgadas(Din)} o más.`);
        if (th < TOL_ANG) {
          g.tipo.set(nid, 'UNION');
          if (nd.compuerta && Din !== Dout) sinCompuerta(`ahí cambia de ${pulgadas(Din)} a ${pulgadas(Dout)}`);
          else if (nd.compuerta) {
            const pz = pieza('COMPUERTA', nid, {
              conexiones: [{ rol: 'ENTRADA', tramo: ti.id, diametro_in: Din }, { rol: 'SALIDA', tramo: to.id, diametro_in: Dout }],
              geometria: { ...geomVacia(), largo_mm: LARGO_COMPUERTA_MM },
              perdida: { modelo: 'COMPUERTA', K_paso: null, K_ramal: null, referencia: 'Compuerta de regulación: abierta no pierde; el balanceo dice cuánto cerrarla' }, familia_cotizap: null,
            });
            ocupar(pz, ti, LARGO_COMPUERTA_MM / 2, nid);
            ocupar(pz, to, LARGO_COMPUERTA_MM / 2, nid);
          }
          if (Din !== Dout) {
            const mayor = Din > Dout ? ti : to;
            const menor = mayor === ti ? to : ti;
            const pz = reduccion(nid, 'REDUCCION', mayor, menor, Math.max(Din, Dout), Math.min(Din, Dout), false, [{ rol: 'ENTRADA', tramo: ti.id, diametro_in: Din }, { rol: 'SALIDA', tramo: to.id, diametro_in: Dout }], menor);
            if (pz) pz.perdida = perdidaReduccion(Dout > Din);
          }
          return;
        }
        g.tipo.set(nid, 'VERTICE');
        sinCompuerta('ahí el ducto da vuelta');
        const c = cerca(th, angCodo);
        if (c === undefined) {
          prob('GIRO_NO_FABRICABLE', th > 179.9 ? `En ${nid} el ducto regresa sobre sí mismo.` : `En ${nid} el ducto da vuelta ${n(th, 1)}°: el taller hace codos a ${lista(angCodo.map((a) => `${a}°`))}.`, [nid, ti.id, to.id],
            th > 90 ? 'Use dos codos con un tramo recto entre ellos.' : `El codo más cercano es de ${angCodo.reduce((b, a) => (Math.abs(a - th) < Math.abs(b - th) ? a : b))}°.`);
          return;
        }
        const Dc = Math.max(Din, Dout);
        const tc = Dc === Dout ? to : ti;
        const r = motor(M, baseMotor(tc), { familia: 'CODO', D_mm: r1(Dc * IN), theta_deg: c, k_R: pol.radio_codo_D });
        if (!r.ok) { prob('PIEZA_NO_FABRICABLE', `El motor no puede fabricar el codo de ${nid}: ${r.error}`, [nid]); return; }
        const T = r.d.R_mm * Math.tan((c * DEG) / 2) + (r.d.L_tangentes_mm || 0) / 2;
        const pz = pieza('CODO', nid, {
          conexiones: [{ rol: 'ENTRADA', tramo: ti.id, diametro_in: Dc }, { rol: 'SALIDA', tramo: to.id, diametro_in: Dc }],
          geometria: { ...geomVacia(), angulo_deg: c, radio_eje_mm: r.d.R_mm, tangente_mm: T, gajos: r.d.n_gajos, normal_plano: unitario(cruz(dIn, dOut)) },
          perdida: { modelo: 'CODO_GAJOS', K_paso: null, K_ramal: null, referencia: 'Codo de gajos: K(θ, R/D, gajos)' }, familia_cotizap: 'CODO',
        });
        ocupar(pz, ti, T, nid);
        ocupar(pz, to, T, nid);
        if (Din !== Dout) {
          const menor = Din < Dout ? ti : to;
          const pr = reduccion(nid, 'REDUCCION', null, menor, Dc, Math.min(Din, Dout), true, [{ rol: 'ENTRADA', tramo: ti.id, diametro_in: Din }, { rol: 'SALIDA', tramo: to.id, diametro_in: Dout }], menor);
          if (pr) pr.perdida = perdidaReduccion(Dout > Din);
        }
        return;
      }
      g.tipo.set(nid, 'DERIVACION');
      if (rig.length > 3) { prob('DERIVACION_NO_PERMITIDA', `En ${nid} se juntan ${rig.length} tramos: dos ramales en un punto se hacen con injertos separados.`, [nid], 'Separe las derivaciones al menos un diámetro.'); return; }
      // el tronco: el par de tramos en línea recta
      const par = [[0, 1, 2], [0, 2, 1], [1, 2, 0]].find(([i, j]) => anguloEntre(fuera(rig[i], nid), fuera(rig[j], nid)) > 180 - TOL_ANG);
      if (!par) {
        prob('DERIVACION_NO_PERMITIDA', pol.permite_pantalon ? `En ${nid} se juntan tres tramos sin tronco recto: el modelo todavía no arma pantalones; use un injerto.` : `En ${nid} se juntan tres tramos sin un tronco recto: el taller hace los injertos sobre un tronco recto (el pantalón se retiró).`, [nid]);
        return;
      }
      const tk = rig[par[2]];
      let tOut;
      let tIn;
      const sale = g.sale.get(nid);
      if (sale !== undefined) {
        if (sale === tk.id) { prob('DERIVACION_NO_PERMITIDA', `En ${nid} las dos corrientes del tronco chocan de frente: el aire tiene que pasar por el tronco hacia el colector.`, [nid]); return; }
        tOut = tramos.get(sale);
        tIn = rig[par[0]] === tOut ? rig[par[1]] : rig[par[0]];
      } else {
        // sin sentido conocido: el único que lo haría válido (el ramal a favor del flujo)
        const [ta, tb] = [rig[par[0]], rig[par[1]]];
        tOut = anguloEntre(por(fuera(tk, nid), -1), fuera(ta, nid)) <= 90 ? ta : tb;
        tIn = tOut === ta ? tb : ta;
      }
      const mh = fuera(tOut, nid);
      const bh = por(fuera(tk, nid), -1);
      const beta = anguloEntre(bh, mh);
      const conocido = sale !== undefined;
      if (conocido && beta > 90 + TOL_ANG) { prob('CONTRA_FLUJO', `En ${nid} el ramal ${tk.id} entraría contra el aire del tronco.`, [nid, tk.id], 'Que el ramal entre a favor del aire, hacia el colector.'); return; }
      const T90 = Math.abs(beta - 90) < TOL_ANG;
      const b = T90 ? 90 : cerca(beta, angInj);
      if (T90 && !pol.permite_t_90) { prob('DERIVACION_NO_PERMITIDA', `El taller no hace T a 90° en ${NOMBRE_SERVICIO[m.proyecto.servicio]}: el ramal entra a ${lista(angInj.map((a) => `${a}°`))}.`, [nid, tk.id], 'Proponer un injerto.'); return; }
      if (b === undefined) { prob('DERIVACION_NO_PERMITIDA', `En ${nid} el ramal entra a ${n(beta, 1)}°: el taller hace injertos a ${lista(angInj.map((a) => `${a}°`))}.`, [nid, tk.id], 'Proponer un injerto.'); return; }
      // por dónde entra, mirando aguas abajo (§2.5.3)
      let giro = null;
      let entrada = null;
      if (Math.abs(punto(mh, Z)) < 0.999) {
        const zp = unitario(resta(Z, por(mh, punto(Z, mh))));
        const w = resta(por(bh, -1), por(mh, punto(por(bh, -1), mh)));
        giro = norm360(Math.atan2(punto(w, cruz(mh, zp)), punto(w, zp)) / DEG);
        if (Math.abs(giro - 360) < 1e-6) giro = 0;
        entrada = giro <= 45 + 1e-6 || giro >= 315 - 1e-6 ? 'SUPERIOR' : (giro > 135 + 1e-6 && giro < 225 - 1e-6 ? 'INFERIOR' : 'LATERAL');
        if (conocido && !pol.entradas_permitidas.includes(entrada)) {
          if (entrada === 'INFERIOR') { prob('ENTRADA_INFERIOR', `En ${nid} el ramal entraría por abajo: el material lo taparía.`, [nid, tk.id], 'Que entre por arriba o de lado.'); return; }
          prob('DERIVACION_NO_PERMITIDA', `En ${nid} el ramal entraría ${entrada === 'SUPERIOR' ? 'por arriba' : 'de lado'}, y este proyecto no lo permite.`, [nid, tk.id]);
          return;
        }
      }
      const Din = tIn.diametro_in;
      const Dout = tOut.diametro_in;
      const d = tk.diametro_in;
      if (conocido && d > Din) { prob('RAMAL_MAYOR', `Un injerto no puede ser mayor que su tronco (${pulgadas(Din)}): el ramal ${tk.id} es de ${pulgadas(d)}.`, [nid, tk.id, tIn.id], `Baje el ramal a ${pulgadas(Din)} o suba el tronco.`); return; }
      if (conocido && Dout < Din) { prob('DIAMETRO_DECRECE', `Hacia el colector el diámetro no baja: en ${nid} el tronco llega de ${pulgadas(Din)} y sale de ${pulgadas(Dout)}.`, [nid, tIn.id, tOut.id], `Suba ${tOut.id} a ${pulgadas(Din)} o más.`); return; }
      const nrm = unitario(cruz(bh, mh));
      const conx = [{ rol: 'ENTRADA', tramo: tIn.id, diametro_in: Din }, { rol: 'SALIDA', tramo: tOut.id, diametro_in: Dout }, { rol: 'RAMAL', tramo: tk.id, diametro_in: d }];
      const geo = { ...geomVacia(), angulo_deg: b, normal_plano: nrm, giro_entrada_deg: giro, entrada };
      if (Dout === Din || T90) {
        if (T90 && Dout !== Din) { prob('DERIVACION_NO_PERMITIDA', `Una T a 90° no cambia el diámetro del tronco (${nid}): ponga la reducción aparte.`, [nid]); return; }
        const e = tablaCal(tOut)[String(tOut.calibre)] * IN;
        const sen = Math.sin(b * DEG);
        const Rm = (Din * IN + e) / 2;
        const rb = (d * IN + e) / 2;
        const tMax = (Rm + rb * Math.cos(b * DEG)) / sen;
        const Lr = Math.ceil((tMax + 100) / 50) * 50;
        const Lc = Math.ceil(((d * IN) / sen + 150) / 50) * 50;
        // la T a 90° no es una familia del taller (sus injertos van a 30° o 45°): sus medidas salen de las mismas fórmulas
        const r = T90 ? { ok: true } : motor(M, baseMotor(tOut), { familia: 'RAMAL', D_mm: r1(Din * IN), d_mm: r1(d * IN), beta_deg: b, L_cuerpo_mm: Lc, L_ramal_mm: Lr });
        if (!r.ok) { prob('PIEZA_NO_FABRICABLE', `El motor no puede fabricar el injerto de ${nid}: ${r.error}`, [nid]); return; }
        const pz = pieza(T90 ? 'T_90' : 'INJERTO', nid, {
          conexiones: conx, geometria: { ...geo, largo_mm: Lc, largo_ramal_mm: Lr },
          perdida: T90 ? { modelo: 'CONFLUENCIA_T', K_paso: null, K_ramal: null, referencia: 'T a 90°: K(Q_ramal/Q_salida, A_ramal/A_salida)' }
            : { modelo: 'CONFLUENCIA_RAMAL', K_paso: null, K_ramal: null, referencia: `Confluencia a ${b}°: K(β, Q_ramal/Q_salida, A_ramal/A_salida)` },
          familia_cotizap: T90 ? null : 'RAMAL',
        });
        ocupar(pz, tIn, Lc / 2, nid); ocupar(pz, tOut, Lc / 2, nid); ocupar(pz, tk, Lr, nid);
      } else {
        const r = motor(M, baseMotor(tOut), { familia: 'REDUCCION_INJERTO', D1_mm: r1(Math.max(Din, Dout) * IN), D2_mm: r1(Math.min(Din, Dout) * IN), d_mm: r1(d * IN), beta_deg: b });
        if (!r.ok) { prob('PIEZA_NO_FABRICABLE', `El motor no puede fabricar la reducción con injerto de ${nid}: ${r.error}`, [nid]); return; }
        const pz = pieza('REDUCCION_INJERTO', nid, {
          conexiones: conx, geometria: { ...geo, forma: 'CONCENTRICA', semiangulo_deg: r.d.semiangulo_deg, largo_mm: r.d.L_reduccion_mm, largo_ramal_mm: r.d.L_ramal_mm },
          perdida: { modelo: 'CONFLUENCIA_RAMAL', K_paso: null, K_ramal: null, referencia: `Confluencia a ${b}° con cono: K(β, Q_ramal/Q_salida, A_ramal/A_salida, A_entrada/A_salida)` },
          familia_cotizap: 'REDUCCION_INJERTO',
        });
        ocupar(pz, tIn, r.d.L_reduccion_mm / 2, nid); ocupar(pz, tOut, r.d.L_reduccion_mm / 2, nid); ocupar(pz, tk, r.d.L_ramal_mm, nid);
      }
      g.derivaciones = g.derivaciones || [];
      g.derivaciones.push({ nodo: nid, tIn: tIn.id, tOut: tOut.id, ramal: tk.id, beta: b, entrada, conocido });
    });
    g.derivaciones = g.derivaciones || [];
    g.piezas.sort((a, b) => (a.nodo < b.nodo ? -1 : a.nodo > b.nodo ? 1 : ORDEN_PIEZA.indexOf(a.tipo) - ORDEN_PIEZA.indexOf(b.tipo)));

    // lo que ocupa cada pieza de cada tramo, y la longitud neta
    m.tramos.forEach((t) => g.ocupa.set(t.id, []));
    g.piezas.forEach((pz) => pz.ocupa.forEach((o) => g.ocupa.get(o.tramo).push({ pieza: pz, mm: o.mm, nodo: o.nodo })));
    m.tramos.forEach((t) => {
      const primero = g.arriba.get(t.id) || t.a;
      g.ocupa.get(t.id).sort((a, b) => (a.nodo === b.nodo ? ORDEN_PIEZA.indexOf(a.pieza.tipo) - ORDEN_PIEZA.indexOf(b.pieza.tipo) : a.nodo === primero ? -1 : 1));
      const L = rigido(t) ? g.seg.get(t.id).L : (g.mang.get(t.id) || { largo_mm: 0 }).largo_mm;
      g.neta.set(t.id, rigido(t) ? L - g.ocupa.get(t.id).reduce((s, o) => s + o.mm, 0) : L);
    });

    // caudal: la suma de las tomas aguas arriba; velocidad
    g.comps.forEach((c) => {
      if (!c.orden) return;
      for (let i = c.orden.length - 1; i >= 0; i -= 1) {
        const u = c.orden[i];
        const tid = g.sale.get(u);
        if (tid === undefined) continue;
        const pid = g.puertoDeNodo.get(u);
        const pu = pid && g.puertos.get(pid);
        let Q = pu && pu.puerto.rol === 'TOMA' ? pu.puerto.caudal_m3_h : 0;
        g.entran(u).forEach((t) => { Q = Q === null || g.Q.get(t.id) === null ? null : Q + g.Q.get(t.id); });
        g.Q.set(tid, Q);
      }
    });
    m.tramos.forEach((t) => { if (!g.Q.has(t.id)) g.Q.set(t.id, null); g.v.set(t.id, velocidad(g.Q.get(t.id), t.diametro_in)); });

    // bajo el piso
    m.tramos.filter(rigido).forEach((t) => {
      if (Math.min(g.pos.get(t.a).z, g.pos.get(t.b).z) - (t.diametro_in * IN) / 2 < -TOL_MM) prob('BAJO_PISO', `El ducto ${t.id} quedaría bajo el piso.`, [t.id], 'Súbalo: todo el ducto va sobre el piso (Z ≥ D/2).');
    });
    return g;
  }

  /* ------------------------------------------------------------------ normalizar y terminar una operación */

  /** Quita los nodos sueltos y funde dos tramos seguidos, rectos, del mismo Ø y material, en un nodo que no está anclado (§2.9). */
  function normalizar(m) {
    const fusion = new Map();
    const pts = new Set();
    m.equipos.forEach((e) => e.puertos.forEach((p) => { if (p.acople && p.acople.tipo === 'MANGUERA') pts.add(p.acople.nodo_transicion); }));
    let cambio = true;
    while (cambio) {
      cambio = false;
      const grado = new Map(m.nodos.map((x) => [x.id, []]));
      const posDe = new Map(m.nodos.map((x) => [x.id, x.posicion_mm]));
      m.tramos.forEach((t) => { grado.get(t.a).push(t); grado.get(t.b).push(t); });
      const sueltos = m.nodos.filter((x) => !x.puerto && !pts.has(x.id) && !grado.get(x.id).length);
      if (sueltos.length) { const s = new Set(sueltos.map((x) => x.id)); m.nodos = m.nodos.filter((x) => !s.has(x.id)); }
      for (const x of m.nodos) {
        const ts = grado.get(x.id);
        if (x.puerto || x.ancla || x.compuerta || pts.has(x.id) || ts.length !== 2 || !ts.every(rigido)) continue;
        const [t1, t2] = ts[0].id < ts[1].id ? ts : [ts[1], ts[0]];
        if (t1.diametro_in !== t2.diametro_in || t1.material !== t2.material || t1.calibre !== t2.calibre || t1.diametro_bloqueado !== t2.diametro_bloqueado) continue;
        const o1 = t1.a === x.id ? t1.b : t1.a;
        const o2 = t2.a === x.id ? t2.b : t2.a;
        const u1 = unitario(resta(posDe.get(x.id), posDe.get(o1)));
        const u2 = unitario(resta(posDe.get(o2), posDe.get(x.id)));
        if (anguloEntre(u1, u2) > TOL_ANG) continue;
        delete t1.corto; // fundido es más largo: ya no es corto
        if (t1.a === x.id) t1.a = o2; else t1.b = o2;
        m.tramos = m.tramos.filter((t) => t !== t2);
        m.nodos = m.nodos.filter((y) => y !== x);
        delete m.piezas[x.id];
        fusion.set(t2.id, t1.id);
        fusion.forEach((v, k) => { if (v === t2.id) fusion.set(k, t1.id); });
        cambio = true;
        break;
      }
    }
    const quedan = new Set(m.nodos.map((x) => x.id));
    Object.keys(m.piezas).forEach((k) => { if (!quedan.has(k)) delete m.piezas[k]; });
    return fusion;
  }

  /** Los identificadores de las piezas: el que ya tenían en su nodo, o uno nuevo (con el aviso de lo que la herramienta puso sola). */
  function asignarPiezas(m, g) {
    const nuevo = {};
    const info = [];
    g.piezas.forEach((pz) => {
      const previo = m.piezas[pz.nodo] && m.piezas[pz.nodo][pz.tipo];
      pz.id = previo || nuevoId(m, PREFIJO[pz.tipo]);
      (nuevo[pz.nodo] = nuevo[pz.nodo] || {})[pz.tipo] = pz.id;
      if (!previo && pz.tipo !== 'COMPUERTA') { // la compuerta la pone quien traza: no es una pieza que salió sola
        const que = { CODO: `Codo de ${pz.geometria.angulo_deg}°`, REDUCCION: `Reducción de ${pulgadas(pz.D1)} a ${pulgadas(pz.D2)}`, ADAPTADOR: `Adaptador de ${pulgadas(pz.D_puerto)} a ${pulgadas(pz.conexiones[0].diametro_in)}`,
          INJERTO: `Injerto a ${pz.geometria.angulo_deg}°`, REDUCCION_INJERTO: `Reducción con injerto a ${pz.geometria.angulo_deg}°`, T_90: 'T a 90°' }[pz.tipo] || pz.tipo;
        const codigo = { CODO: 'CODO_INSERTADO', REDUCCION: 'REDUCCION_INSERTADA', ADAPTADOR: 'ADAPTADOR_INSERTADO' }[pz.tipo] || 'DERIVACION_INSERTADA';
        info.push({ codigo, severidad: 'INFO', elementos: [pz.id, pz.nodo], mensaje: `${que} en ${pz.nodo} (${pz.id}).`, sugerencia: null });
      }
    });
    m.piezas = nuevo;
    return info;
  }

  /** Cierra una operación: normaliza, calcula, rechaza lo BLOQUEANTE y asigna las piezas. */
  function terminar(m, M) {
    const fusion = normalizar(m);
    dato(m.tramos.length <= MAX_TRAMOS, `El trazo ya tiene ${MAX_TRAMOS} tramos.`);
    const g = calcular(m, M);
    if (g.problemas.length) {
      const fuera = new Set([...(m.ultimo && m.ultimo.tramos) || [], ...(m.ultimo && m.ultimo.nodo ? [m.ultimo.nodo] : [])]);
      const b = g.problemas.find((x) => x.elementos.some((e) => fuera.has(e))) || g.problemas[0];
      falla(b.codigo, b.mensaje, b.elementos, b.sugerencia);
    }
    limpiarDecisiones(m, g);
    const info = asignarPiezas(m, g);
    if (m.ultimo) {
      m.ultimo.tramos = [...new Set((m.ultimo.tramos || []).map((id) => fusion.get(id) || id))].filter((id) => m.tramos.some((t) => t.id === id));
      m.ultimo.info = [...(m.ultimo.info || []), ...info];
    }
    return m;
  }
  const marcar = (m, operacion, x) => { m.ultimo = { operacion, nodo: null, tramos: [], info: [], ...x }; };

  /** Si un tramo es corto (0 ≤ neta < el recto mínimo) y tiene piezas: las piezas de sus extremos (sin repetir) y sus nodos. */
  function cortoDe(m, g, t) {
    if (!rigido(t)) return null;
    const neta = g.neta.get(t.id);
    const oc = g.ocupa.get(t.id) || [];
    if (!(neta >= -1e-3 && neta < m.politicas.recto_min_entre_accesorios_mm - 1e-6 && oc.length)) return null;
    return { neta, piezas: [...new Map(oc.map((o) => [o.pieza.id || o.pieza.tipo, o.pieza])).values()], nodos: new Set(oc.map((o) => o.nodo)) };
  }
  /** Las decisiones de tramo corto que ya no aplican (el tramo dejó de ser corto, o ya no tiene piezas en los dos extremos) se quitan. */
  function limpiarDecisiones(m, g) {
    m.tramos.forEach((t) => {
      if (t.corto === undefined) return;
      const c = cortoDe(m, g, t);
      if (!c || !['PEGAR', 'ACEPTAR'].includes(t.corto) || (t.corto === 'PEGAR' && c.nodos.size < 2)) delete t.corto;
    });
  }
  /** Cómo se unen las piezas pegadas: soldadas, o engargoladas si el material lleva costura engargolada. */
  const unionPegada = (M, material) => (((M.proceso.costuras || {})[(M.materiales[material] || {}).costura] || {}).soldada === false ? 'ENGARGOLADA' : 'SOLDADA');

  /* ------------------------------------------------------------------ proyecto, políticas y material */

  /** Cambia los datos del proyecto (§1.0). Cambiar el servicio trae sus velocidades, su reducción horizontal y su regla de T. */
  function cambiarProyecto(t0, M, cambios) {
    const m = inicio(t0);
    dato(esObjeto(cambios), 'Faltan los cambios del proyecto.');
    aplicarProyecto(m, M, cambios);
    marcar(m, 'cambiarProyecto');
    return terminar(m, M);
  }
  /** Cambia políticas de este proyecto; se rechaza si lo que ya está trazado deja de cumplirlas. */
  function cambiarPoliticas(t0, M, cambios) {
    const m = inicio(t0);
    dato(esObjeto(cambios), 'Faltan los cambios de las políticas.');
    m.politicas = validarPoliticas({ ...m.politicas, ...cambios, manguera: { ...m.politicas.manguera, ...(cambios.manguera || {}) }, rugosidad_mm: { ...m.politicas.rugosidad_mm, ...(cambios.rugosidad_mm || {}) } });
    m.tramos.filter(rigido).forEach((t) => dato(m.politicas.diametros_comerciales_in.includes(t.diametro_in), `El tramo ${t.id} es de ${pulgadas(t.diametro_in)}, que deja de ser comercial.`, [t.id]));
    marcar(m, 'cambiarPoliticas');
    return terminar(m, M);
  }
  /** El material y calibre de los tramos nuevos; con todos: true, también de los que ya están. */
  function cambiarMaterial(t0, M, material, calibre, opciones) {
    const m = inicio(t0);
    aplicarMaterial(m, M, material, calibre);
    if (opciones && opciones.todos) m.tramos.filter(rigido).forEach((t) => { t.material = material; t.calibre = calibre; });
    marcar(m, 'cambiarMaterial');
    return terminar(m, M);
  }

  /* ------------------------------------------------------------------ equipos y puertos (Fase 1) */

  function cajaValida(c) {
    dato(esObjeto(c) && [c.largo, c.ancho, c.alto].every((x) => finito(x) && x > 0 && x <= 100000), 'La caja del equipo lleva largo, ancho y alto en mm (hasta 100 m).');
    return { largo: r3(c.largo), ancho: r3(c.ancho), alto: r3(c.alto) };
  }
  function giroValido(g) {
    dato(finito(g) && g % 15 === 0, 'El giro del equipo va cada 15°.');
    return norm360(g);
  }
  /** Coloca un equipo (§1.1): tipo, nombre, posición del centro de su base, giro sobre Z, caja y su pérdida propia. */
  function ponerEquipo(t0, M, x) {
    const m = inicio(t0);
    dato(esObjeto(x), 'Faltan los datos del equipo.');
    dato(m.equipos.length < MAX_EQUIPOS, `El trazo ya tiene ${MAX_EQUIPOS} equipos.`);
    dato(TIPOS_EQUIPO.includes(x.tipo), `El equipo es ${TIPOS_EQUIPO.join(', ')}.`);
    const e = {
      id: nuevoId(m, 'EQ'), tipo: x.tipo, nombre: texto(x.nombre, NOMBRE_EQUIPO[x.tipo], 60), posicion_mm: coordenada(x.posicion_mm, 'La posición del equipo'),
      rotacion_z_deg: giroValido(x.rotacion_z_deg === undefined ? 0 : x.rotacion_z_deg), caja_mm: cajaValida(x.caja_mm), perdida_Pa: null, puertos: [],
    };
    dato(e.posicion_mm.z >= 0, 'El equipo se apoya en el piso o en un nivel: Z ≥ 0.');
    if (x.perdida_Pa !== undefined && x.perdida_Pa !== null) { dato(finito(x.perdida_Pa) && x.perdida_Pa >= 0 && x.perdida_Pa <= 100000, 'La pérdida propia va de 0 a 100 000 Pa.'); e.perdida_Pa = x.perdida_Pa; }
    m.equipos.push(e);
    marcar(m, 'ponerEquipo', { equipo: e.id });
    return terminar(m, M);
  }
  /** Cambia nombre, caja o pérdida de un equipo; sus puertos deben seguir sobre la caja. */
  function editarEquipo(t0, M, equipoId, c) {
    const m = inicio(t0);
    const e = equipoDe(m, equipoId);
    dato(esObjeto(c), 'Faltan los cambios del equipo.');
    if (c.nombre !== undefined) e.nombre = texto(c.nombre, e.nombre, 60);
    if (c.caja_mm !== undefined) {
      e.caja_mm = cajaValida(c.caja_mm);
      e.puertos.forEach((p) => dato(carasEn(e.caja_mm, p.posicion_local_mm).length > 0, `El puerto ${p.id} quedaría fuera de la caja.`, [p.id]));
    }
    if (c.perdida_Pa !== undefined) { dato(c.perdida_Pa === null || (finito(c.perdida_Pa) && c.perdida_Pa >= 0 && c.perdida_Pa <= 100000), 'La pérdida propia va de 0 a 100 000 Pa.'); e.perdida_Pa = c.perdida_Pa; }
    marcar(m, 'editarEquipo', { equipo: e.id });
    return terminar(m, M);
  }

  /**
   * Agrega un puerto a un equipo (§1.1 paso 3): TOMA en una máquina o campana, ENTRADA (boca) en un colector o ventilador, o
   * SALIDA. Va sobre una cara de la caja; su dirección por omisión es la normal de esa cara hacia fuera. La boca de colector
   * queda con brida; la toma, sin acople hasta la Fase 2.
   */
  function agregarPuerto(t0, M, equipoId, x) {
    const m = inicio(t0);
    const e = equipoDe(m, equipoId);
    dato(esObjeto(x), 'Faltan los datos del puerto.');
    dato(e.puertos.length < MAX_PUERTOS, `El equipo ya tiene ${MAX_PUERTOS} puertos.`);
    const rol = x.rol || (e.tipo === 'COLECTOR' ? 'ENTRADA' : 'TOMA');
    dato(['TOMA', 'ENTRADA', 'SALIDA'].includes(rol), 'El puerto es TOMA, ENTRADA o SALIDA.');
    dato(rol !== 'TOMA' || e.tipo === 'MAQUINA' || e.tipo === 'CAMPANA', 'Las tomas van en máquinas y campanas.');
    dato(rol !== 'ENTRADA' || e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR', 'Las bocas (ENTRADA) van en colectores y ventiladores.');
    dato(rol !== 'SALIDA' || e.tipo === 'VENTILADOR' || e.tipo === 'COLECTOR', 'La descarga (SALIDA) va en un ventilador o colector.');
    const local = coordenada(x.posicion_local_mm, 'La posición del puerto en el equipo');
    const caras = carasEn(e.caja_mm, local);
    dato(caras.length > 0, 'El puerto va sobre una cara de la caja del equipo.');
    const dl = x.direccion_local === undefined ? direccionDeVector(caras[0]) : direccionValida(x.direccion_local, null, 'La dirección del puerto');
    dato(caras.some((c) => punto(vectorDe(dl), c) > 1e-9), 'El puerto apunta hacia fuera de la caja.');
    const D = diametroValido(m, x.diametro_in, 'El puerto');
    let Q = null;
    let K = null;
    if (rol === 'TOMA') {
      if (x.caudal_m3_h !== undefined && x.caudal_m3_h !== null) { dato(finito(x.caudal_m3_h) && x.caudal_m3_h > 0 && x.caudal_m3_h <= 1e6, 'El caudal de diseño va de 0 a 1 000 000 m³/h.'); Q = x.caudal_m3_h; }
      K = x.coef_entrada_K === undefined ? 0.5 : x.coef_entrada_K;
      dato(finito(K) && K >= 0 && K <= 10, 'El coeficiente de entrada K va de 0 a 10.');
    }
    const p = {
      id: nuevoId(m, 'PU'), rol, nombre: texto(x.nombre, rol === 'TOMA' ? 'Toma' : rol === 'ENTRADA' ? 'Boca' : 'Descarga', 60), posicion_local_mm: local, direccion_local: dl,
      diametro_in: D, caudal_m3_h: Q, coef_entrada_K: K, nodo: null, acople: rol === 'ENTRADA' ? { tipo: 'BRIDA', barrenos: null } : null,
    };
    e.puertos.push(p);
    const nd = crearNodo(m, ubicarPuerto(e, p).posicion_mm);
    m.nodos.find((y) => y.id === nd).puerto = p.id;
    p.nodo = nd;
    marcar(m, 'agregarPuerto', { puerto: p.id, nodo: nd });
    return terminar(m, M);
  }
  /** Cambia nombre, Ø, caudal, K o barrenos de un puerto; su posición y dirección sólo mientras no tenga ducto. */
  function editarPuerto(t0, M, puertoId, c) {
    const m = inicio(t0);
    const { equipo, puerto: p } = puertoDe(m, puertoId);
    dato(esObjeto(c), 'Faltan los cambios del puerto.');
    if (c.nombre !== undefined) p.nombre = texto(c.nombre, p.nombre, 60);
    if (c.diametro_in !== undefined) {
      p.diametro_in = diametroValido(m, c.diametro_in, 'El puerto');
      if (p.acople && p.acople.tipo === 'MANGUERA') tramoDe(m, p.acople.tramo_flexible).diametro_in = p.diametro_in;
    }
    if (c.caudal_m3_h !== undefined) {
      dato(p.rol === 'TOMA', 'Sólo las tomas llevan caudal.');
      dato(c.caudal_m3_h === null || (finito(c.caudal_m3_h) && c.caudal_m3_h > 0 && c.caudal_m3_h <= 1e6), 'El caudal de diseño va de 0 a 1 000 000 m³/h.');
      p.caudal_m3_h = c.caudal_m3_h;
    }
    if (c.coef_entrada_K !== undefined) { dato(p.rol === 'TOMA' && finito(c.coef_entrada_K) && c.coef_entrada_K >= 0 && c.coef_entrada_K <= 10, 'El coeficiente de entrada K va de 0 a 10 (sólo en tomas).'); p.coef_entrada_K = c.coef_entrada_K; }
    if (c.barrenos !== undefined) { dato(p.acople && p.acople.tipo === 'BRIDA', 'Los barrenos son de una brida.'); p.acople.barrenos = barrenosValidos(c.barrenos); }
    if (c.posicion_local_mm !== undefined || c.direccion_local !== undefined) {
      const conectado = m.tramos.some((t) => t.a === p.nodo || t.b === p.nodo);
      dato(!conectado, `El puerto ${p.id} ya tiene ducto: bórrelo para mover el puerto en el equipo.`, [p.id]);
      const local = c.posicion_local_mm === undefined ? p.posicion_local_mm : coordenada(c.posicion_local_mm, 'La posición del puerto en el equipo');
      const caras = carasEn(equipo.caja_mm, local);
      dato(caras.length > 0, 'El puerto va sobre una cara de la caja del equipo.');
      const dl = c.direccion_local === undefined ? (c.posicion_local_mm === undefined ? p.direccion_local : direccionDeVector(caras[0])) : direccionValida(c.direccion_local, null, 'La dirección del puerto');
      dato(caras.some((cc) => punto(vectorDe(dl), cc) > 1e-9), 'El puerto apunta hacia fuera de la caja.');
      p.posicion_local_mm = local;
      p.direccion_local = dl;
      nodoDe(m, p.nodo).posicion_mm = ubicarPuerto(equipo, p).posicion_mm;
      if (p.acople && p.acople.tipo === 'MANGUERA') p.acople.direccion_pt = ubicarPuerto(equipo, p).direccion;
    }
    marcar(m, 'editarPuerto', { puerto: p.id });
    return terminar(m, M);
  }
  function barrenosValidos(b) {
    if (b === null) return null;
    dato(esObjeto(b) && Number.isInteger(b.numero) && b.numero >= 0 && b.numero <= 200 && finito(b.circulo_mm) && b.circulo_mm >= 0 && b.circulo_mm <= 10000 && finito(b.diametro_mm) && b.diametro_mm >= 0 && b.diametro_mm <= 200,
      'Los barrenos llevan número, círculo y diámetro (mm).');
    return { numero: b.numero, circulo_mm: b.circulo_mm, diametro_mm: b.diametro_mm };
  }
  /** Quita un puerto: su manguera se va con él y el ducto que tuviera queda con un extremo libre. */
  function quitarPuerto(t0, M, puertoId) {
    const m = inicio(t0);
    quitarPuertoEn(m, puertoId);
    marcar(m, 'quitarPuerto');
    return terminar(m, M);
  }
  function quitarPuertoEn(m, puertoId) {
    const { equipo, puerto: p } = puertoDe(m, puertoId);
    if (p.acople && p.acople.tipo === 'MANGUERA') quitarManguera(m, p);
    const nd = nodoDe(m, p.nodo);
    nd.puerto = null;
    equipo.puertos = equipo.puertos.filter((x) => x !== p);
  }
  function quitarManguera(m, p) {
    const ac = p.acople;
    m.tramos = m.tramos.filter((t) => t.id !== ac.tramo_flexible);
    p.acople = null;
  }
  /** Quita un equipo con sus puertos. */
  function quitarEquipo(t0, M, equipoId) {
    const m = inicio(t0);
    const e = equipoDe(m, equipoId);
    [...e.puertos].forEach((p) => quitarPuertoEn(m, p.id));
    m.equipos = m.equipos.filter((x) => x !== e);
    marcar(m, 'quitarEquipo');
    return terminar(m, M);
  }

  /**
   * Mueve o gira un equipo (§1.3 paso 10): sus tomas con manguera se vuelven a resolver; una toma con brida arrastra su ducto
   * y el movimiento se compensa en el camino hacia los otros puntos fijos, o se rechaza (FIJO_SE_MUEVE).
   */
  function moverEquipo(t0, M, equipoId, x) {
    const m = inicio(t0);
    const e = equipoDe(m, equipoId);
    dato(esObjeto(x), 'Falta a dónde se mueve el equipo.');
    const pos = x.posicion_mm === undefined ? e.posicion_mm : coordenada(x.posicion_mm, 'La posición del equipo');
    dato(pos.z >= 0, 'El equipo se apoya en el piso o en un nivel: Z ≥ 0.');
    const rot = x.rotacion_z_deg === undefined ? e.rotacion_z_deg : giroValido(x.rotacion_z_deg);
    const antes = e.puertos.map((p) => ({ p, ...ubicarPuerto(e, p) }));
    const dRot = rot - e.rotacion_z_deg;
    e.posicion_mm = pos;
    e.rotacion_z_deg = rot;
    // las tomas de este equipo que faltan por mover no cuentan como puntos fijos
    const pendientes = new Set(antes.map(({ p }) => p.nodo));
    antes.forEach(({ p }) => {
      pendientes.delete(p.nodo);
      const nuevoPos = ubicarPuerto(e, p).posicion_mm;
      const nd = nodoDe(m, p.nodo);
      const w = resta(nuevoPos, nd.posicion_mm);
      if (p.acople && p.acople.tipo === 'MANGUERA') {
        const pt = m.tramos.some((t) => rigido(t) && (t.a === p.acople.nodo_transicion || t.b === p.acople.nodo_transicion));
        if (!pt) p.acople.direccion_pt = { ...p.acople.direccion_pt, azimut_deg: Math.abs(p.acople.direccion_pt.elevacion_deg) === 90 ? 0 : norm360(p.acople.direccion_pt.azimut_deg + dRot) };
      }
      const conRigido = m.tramos.some((t) => rigido(t) && (t.a === p.nodo || t.b === p.nodo));
      if (!conRigido || norma(w) < 1e-9) { nd.posicion_mm = nuevoPos; return; }
      const g = calcular(m, M);
      const mov = moverLado(m, g, p.nodo, null, w, false, pendientes);
      if (!mov) falla('FIJO_SE_MUEVE', `${e.nombre} (brida) quedaría a ${n(norma(w))} mm de su ducto: ningún tramo del camino a los otros puntos fijos puede compensarlo.`, [e.id, p.id], 'Mueva un segmento del ducto o use una manguera.');
      aplicarMovimiento(m, mov);
      nd.posicion_mm = nuevoPos;
    });
    marcar(m, 'moverEquipo', { equipo: e.id });
    return terminar(m, M);
  }

  /* ------------------------------------------------------------------ acoples (Fase 2) */

  /** Acopla una toma con brida (§1.2): el ducto sale de la toma alineado con su cuello; los barrenos, si se conocen. */
  function acoplarBrida(t0, M, puertoId, x) {
    const m = inicio(t0);
    const { puerto: p } = puertoDe(m, puertoId);
    dato(p.rol === 'TOMA', 'Sólo las tomas cambian de acople (la boca del colector va con brida).');
    if (p.acople && p.acople.tipo === 'MANGUERA') {
      const pt = p.acople.nodo_transicion;
      dato(!m.tramos.some((t) => rigido(t) && (t.a === pt || t.b === pt)), `El punto de transición ${pt} tiene ducto: bórrelo antes de cambiar la manguera por brida.`, [pt]);
      quitarManguera(m, p);
    }
    p.acople = { tipo: 'BRIDA', barrenos: x && x.barrenos !== undefined ? barrenosValidos(x.barrenos) : (p.acople && p.acople.barrenos) || null };
    marcar(m, 'acoplarBrida', { puerto: p.id, nodo: p.nodo });
    return terminar(m, M);
  }
  /** El punto de transición de una manguera: la toma más altura·u_t más el desvío (perpendicular a la toma). */
  function puntoDeTransicion(e, p, x) {
    dato(esObjeto(x), 'Faltan la altura y el desvío del punto de transición.');
    const ub = ubicarPuerto(e, p);
    const ut = vectorDe(ub.direccion);
    dato(finito(x.altura_mm) && x.altura_mm > 0 && x.altura_mm <= 20000, 'La altura del punto de transición va de 0 a 20 m.');
    let ev = V3(0, 0, 0);
    if (x.desvio_vector_mm !== undefined) {
      ev = coordenada(x.desvio_vector_mm, 'El desvío');
      dato(Math.abs(punto(ev, ut)) <= TOL_MM, 'El desvío va perpendicular a la toma.');
    } else if (x.desvio_mm) {
      dato(finito(x.desvio_mm) && x.desvio_mm >= 0 && x.desvio_mm <= 20000 && finito(x.desvio_azimut_deg), 'El desvío lleva mm y un rumbo.');
      const lat = V3(Math.cos(x.desvio_azimut_deg * DEG), Math.sin(x.desvio_azimut_deg * DEG), 0);
      const perp = resta(lat, por(ut, punto(lat, ut)));
      dato(norma(perp) > 0.5, 'Ese rumbo de desvío va casi en la dirección de la toma: use desvio_vector_mm.');
      ev = por(unitario(perp), x.desvio_mm);
    }
    const dpt = x.direccion_pt === undefined ? ub.direccion : direccionValida(x.direccion_pt, null, 'La dirección del ducto en el punto de transición');
    return { P: r3v(suma(suma(ub.posicion_mm, por(ut, x.altura_mm)), ev)), direccion_pt: dpt };
  }
  /**
   * Acopla una toma con manguera (§1.2): el punto de transición (PT) a altura_mm sobre la toma y desviado desvio_mm hacia el
   * rumbo desvio_azimut_deg (o desvio_vector_mm). El ducto rígido arranca del PT en direccion_pt (por omisión, la de la toma).
   */
  function acoplarManguera(t0, M, puertoId, x) {
    const m = inicio(t0);
    const { equipo, puerto: p } = puertoDe(m, puertoId);
    dato(p.rol === 'TOMA', 'Sólo las tomas llevan manguera.');
    if (p.acople && p.acople.tipo === 'MANGUERA') return moverTransicion(t0, M, puertoId, x);
    dato(!m.tramos.some((t) => t.a === p.nodo || t.b === p.nodo), `La toma ${p.id} tiene ducto con brida: bórrelo para cambiar a manguera.`, [p.id]);
    const { P, direccion_pt } = puntoDeTransicion(equipo, p, x);
    dato(!nodoEn(m, P), 'El punto de transición cae sobre otro nodo.');
    const pt = crearNodo(m, P);
    const tid = nuevoId(m, 'TR');
    m.tramos.push({ id: tid, tipo: 'FLEXIBLE', a: p.nodo, b: pt, diametro_in: p.diametro_in, diametro_bloqueado: false, material: 'MANGUERA', calibre: null });
    p.acople = { tipo: 'MANGUERA', nodo_transicion: pt, tramo_flexible: tid, direccion_pt };
    marcar(m, 'acoplarManguera', { puerto: p.id, nodo: pt, tramos: [tid] });
    terminar(m, M);
    const r = calcular(m, M).mang.get(tid);
    m.ultimo.info.push(infoManguera(r, tid, p.id));
    return m;
  }
  /** Mueve el punto de transición de una manguera; si ya tiene ducto, lo arrastra y compensa en el camino a los puntos fijos. */
  function moverTransicion(t0, M, puertoId, x) {
    const m = inicio(t0);
    const { equipo, puerto: p } = puertoDe(m, puertoId);
    dato(p.acople && p.acople.tipo === 'MANGUERA', `La toma ${p.id} no tiene manguera.`, [p.id]);
    const pt = p.acople.nodo_transicion;
    const nd = nodoDe(m, pt);
    const { P, direccion_pt } = puntoDeTransicion(equipo, p, x);
    const conRigido = m.tramos.some((t) => rigido(t) && (t.a === pt || t.b === pt));
    if (conRigido) {
      dato(igualDir(direccion_pt, p.acople.direccion_pt), 'El punto de transición ya tiene ducto: su dirección no cambia.');
      const w = resta(P, nd.posicion_mm);
      if (norma(w) > 1e-9) {
        const mov = moverLado(m, calcular(m, M), pt, null, w);
        if (!mov) falla('FIJO_SE_MUEVE', `Mover el punto de transición ${n(norma(w))} mm movería un punto fijo y ningún tramo del camino puede compensarlo.`, [pt, p.id]);
        aplicarMovimiento(m, mov);
      }
    } else {
      dato(!nodoEn(m, P, pt), 'El punto de transición cae sobre otro nodo.');
      nd.posicion_mm = P;
      p.acople.direccion_pt = direccion_pt;
    }
    marcar(m, 'moverTransicion', { puerto: p.id, nodo: pt, tramos: [p.acople.tramo_flexible] });
    terminar(m, M);
    m.ultimo.info.push(infoManguera(calcular(m, M).mang.get(p.acople.tramo_flexible), p.acople.tramo_flexible, p.id));
    return m;
  }
  /** Quita el acople de una toma (la manguera con su PT); una brida con ducto no se desacopla: se borra el ducto. */
  function desacoplar(t0, M, puertoId) {
    const m = inicio(t0);
    const { puerto: p } = puertoDe(m, puertoId);
    dato(p.rol === 'TOMA', 'La boca del colector siempre va con brida.');
    if (p.acople && p.acople.tipo === 'MANGUERA') {
      const pt = p.acople.nodo_transicion;
      dato(!m.tramos.some((t) => rigido(t) && (t.a === pt || t.b === pt)), `El punto de transición ${pt} tiene ducto: bórrelo primero.`, [pt]);
      quitarManguera(m, p);
    } else if (p.acople) {
      dato(!m.tramos.some((t) => t.a === p.nodo || t.b === p.nodo), `La toma ${p.id} tiene ducto: bórrelo primero.`, [p.id]);
      p.acople = null;
    }
    marcar(m, 'desacoplar', { puerto: p.id });
    return terminar(m, M);
  }
  function infoManguera(r, tid, pid) {
    const fm = { RECTA: `Manguera recta de ${n(r.largo_mm)} mm.`, S: `Manguera en S de dos curvas de ${n(r.angulo_curva_deg, 2)}°: radio ${n(r.radio_mm, 2)} mm (mínimo ${n(r.radio_min_mm, 2)} mm), ${n(r.largo_mm)} mm de largo.`,
      CODO: `Manguera en curva de ${n(r.angulo_curva_deg, 2)}°: radio ${n(r.radio_mm, 2)} mm (mínimo ${n(r.radio_min_mm, 2)} mm), ${n(r.largo_mm)} mm de largo.`,
      LIBRE: `Manguera libre: radio de curvatura mínimo ${n(r.radio_mm || 0, 2)} mm (mínimo ${n(r.radio_min_mm, 2)} mm), ${n(r.largo_mm)} mm de largo.` };
    return { codigo: 'MANGUERA_RESUELTA', severidad: 'INFO', elementos: [tid, pid], mensaje: fm[r.forma], sugerencia: null };
  }

  /* ------------------------------------------------------------------ trazar (Fase 3) */

  /** Hacia dónde puede seguir el ducto desde un nodo, un punto de un tramo o un arranque suelto (§2.1.3). */
  function candidatas(t, M, desde) {
    const g = calcular(t, M);
    return candidatasEn(t, g, desde);
  }
  function candidatasEn(t, g, desde) {
    const pol = t.politicas;
    const D = rejilla(pol);
    const op = (d, giro, pieza) => ({ direccion: d, giro_deg: giro, pieza });
    if (esObjeto(desde) && desde.tramo) return candidatasDerivacion(t, g, g.tramos.get(desde.tramo));
    if (esObjeto(desde)) return D.map((d) => op(d, 0, 'RECTO'));
    const nid = desde;
    if (!g.pos.has(nid)) return [];
    const ad = g.ady.get(nid);
    const rig = ad.filter((x) => rigido(x.tramo));
    const pid = g.puertoDeNodo.get(nid);
    if (pid) {
      const pu = g.puertos.get(pid);
      return pu.puerto.acople && pu.puerto.acople.tipo === 'BRIDA' && pu.puerto.rol !== 'SALIDA' && !ad.length ? [op(pu.direccion, 0, 'RECTO')] : [];
    }
    if (g.pt.has(nid)) return rig.length ? [] : [op(g.puertos.get(g.pt.get(nid)).puerto.acople.direccion_pt, 0, 'RECTO')];
    if (!rig.length) return D.map((d) => op(d, 0, 'RECTO'));
    if (rig.length === 1) {
      const dIn = por(g.fuera(rig[0].tramo, nid), -1);
      return D.map((d) => {
        const th = anguloEntre(dIn, vectorDe(d));
        if (th < TOL_ANG) return op(d, 0, 'RECTO');
        const c = pol.angulos_codo_deg.find((a) => Math.abs(a - th) < TOL_ANG);
        return c === undefined ? null : op(d, c, 'CODO');
      }).filter(Boolean);
    }
    if (rig.length === 2 && rig.every((x) => g.conocido(x.tramo.id))) {
      // desde un codo de 30° o 45° se puede seguir recto el tronco: el codo queda como injerto (§2.5.2)
      const tOut = rig.find((x) => g.arriba.get(x.tramo.id) === nid);
      const tIn = rig.find((x) => g.abajo.get(x.tramo.id) === nid);
      if (!tOut || !tIn) return [];
      const th = anguloEntre(g.aire(tIn.tramo), g.aire(tOut.tramo));
      if (th < TOL_ANG) return candidatasDerivacionEn(t, g, tOut.tramo);
      const b = pol.angulos_injerto_deg.find((a) => Math.abs(a - th) < TOL_ANG);
      if (b !== undefined) {
        const d = direccionDeVector(por(g.aire(tOut.tramo), -1), pol);
        return d ? [op(d, b, 'INJERTO')] : [];
      }
    }
    return [];
  }
  /** Las direcciones con las que se dibuja un ramal desde el tronco t (hacia fuera): −b̂ para cada β y entrada permitidos. */
  function candidatasDerivacion(t, g, tr) {
    if (!tr || !rigido(tr) || !g.conocido(tr.id)) return [];
    return candidatasDerivacionEn(t, g, tr);
  }
  function candidatasDerivacionEn(t, g, tr) {
    const pol = t.politicas;
    return direccionesDeRamal(pol, g.aire(tr)).map((x) => ({ direccion: opuesta(x.direccion), giro_deg: x.beta, pieza: x.beta === 90 ? 'T_90' : 'INJERTO', entrada: x.entrada, giro_entrada_deg: x.giro }));
  }
  /** Las direcciones b̂ del aire de un ramal que entra al tronco de aire m̂ a un β y por una entrada permitidos. */
  function direccionesDeRamal(pol, mh) {
    const betas = [...pol.angulos_injerto_deg, ...(pol.permite_t_90 ? [90] : [])];
    const out = [];
    rejilla(pol).forEach((d) => {
      const bh = vectorDe(d);
      const beta = anguloEntre(bh, mh);
      const b = betas.find((x) => Math.abs(x - beta) < TOL_ANG);
      if (b === undefined) return;
      let giro = null;
      let entrada = null;
      if (Math.abs(punto(mh, Z)) < 0.999) {
        const zp = unitario(resta(Z, por(mh, punto(Z, mh))));
        const w = resta(por(bh, -1), por(mh, punto(por(bh, -1), mh)));
        giro = norm360(Math.atan2(punto(w, cruz(mh, zp)), punto(w, zp)) / DEG);
        if (Math.abs(giro - 360) < 1e-6) giro = 0;
        entrada = giro <= 45 + 1e-6 || giro >= 315 - 1e-6 ? 'SUPERIOR' : (giro > 135 + 1e-6 && giro < 225 - 1e-6 ? 'INFERIOR' : 'LATERAL');
        if (!pol.entradas_permitidas.includes(entrada)) return;
      }
      out.push({ direccion: d, beta: b, entrada, giro });
    });
    return out;
  }
  /** Cómo se dice lo que se puede desde un punto: «puede seguir recto, dar vuelta a 30°, 45°, 60° o 90°, subir o bajar». */
  function textoCandidatas(desde, ops) {
    if (!ops.length) return `Desde ${desde} ya no puede salir otro ducto.`;
    const giros = [...new Set(ops.filter((o) => o.pieza === 'CODO').map((o) => o.giro_deg))].sort((a, b) => a - b);
    const partes = [];
    if (ops.some((o) => o.pieza === 'RECTO')) partes.push(ops.length === 1 ? `salir en ${textoDireccion(ops[0].direccion)}` : 'seguir recto');
    if (giros.length) partes.push(`dar vuelta a ${lista(giros.map((a) => `${a}°`))}`);
    if (ops.some((o) => o.pieza === 'CODO' && o.direccion.elevacion_deg > 0)) partes.push('subir');
    if (ops.some((o) => o.pieza === 'CODO' && o.direccion.elevacion_deg < 0)) partes.push('bajar');
    const inj = ops.filter((o) => o.pieza === 'INJERTO' || o.pieza === 'T_90');
    if (inj.length === 1 && ops.length === 1 && !('entrada' in inj[0])) partes.push(`seguir el tronco en ${textoDireccion(inj[0].direccion)}, con el codo como injerto a ${inj[0].giro_deg}°`);
    else if (inj.length) partes.push(`salir en injerto a ${lista([...new Set(inj.map((o) => o.giro_deg))].map((a) => `${a}°`))}`);
    return `Desde ${desde} el ducto puede ${lista(partes, 'o')}.`;
  }
  /** La dirección de las candidatas más cercana a v (§2.1.4), con histéresis: la previa sólo cambia si otra es mejor por 3° o más. */
  function elegirDireccion(ops, v, previa, histeresis_deg) {
    if (!ops.length || norma(v) < 1e-9) return null;
    const ang = (o) => anguloEntre(vectorDe(o.direccion), v);
    const mejor = ops.reduce((b, o) => (ang(o) < ang(b) ? o : b));
    const prev = previa && ops.find((o) => igualDir(o.direccion, previa));
    return prev && ang(prev) - ang(mejor) < (histeresis_deg === undefined ? 3 : histeresis_deg) ? prev : mejor;
  }
  /** El largo al paso de las políticas (§2.1.5), nunca menos del mínimo. */
  function ajustarLargo(L, pol, paso) {
    const p = paso || pol.paso_largo_mm;
    return Math.max(pol.largo_min_tramo_mm, Math.round(L / p) * p);
  }

  /** Parte un tramo rígido a s_mm de su nodo a: devuelve el nodo nuevo (el tramo conserva su id de a hacia el nodo). */
  function partir(m, g, tramoId, s) {
    const t = tramoDe(m, tramoId);
    dato(rigido(t), 'Una manguera no se parte: el ducto empieza en el punto de transición.', [t.id]);
    const sg = g.seg.get(t.id);
    const lim = m.politicas.largo_min_tramo_mm;
    dato(finito(s) && s >= lim - 1e-9 && s <= sg.L - lim + 1e-9, `El punto queda a menos de ${metros(lim)} de un extremo del tramo ${t.id}.`, [t.id]);
    const P = r3v(suma(g.pos.get(t.a), por(sg.u, s)));
    const existe = nodoEn(m, P);
    if (existe) return existe.id;
    const J = crearNodo(m, P);
    const b = t.b;
    t.b = J;
    m.tramos.push({ ...t, id: nuevoId(m, 'TR'), a: J, b });
    return J;
  }
  function arranque(m, M, g, desde) {
    if (typeof desde === 'string') {
      const nd = nodoDe(m, desde);
      const pid = g.puertoDeNodo.get(nd.id);
      if (pid) {
        const p = g.puertos.get(pid).puerto;
        dato(p.rol !== 'SALIDA', 'La descarga todavía no se traza.', [pid]);
        if (p.rol === 'TOMA' && !p.acople) falla('TOMA_SIN_CONEXION', `Elija primero el acople de la toma ${pid}: manguera o brida.`, [pid]);
        if (p.acople.tipo === 'MANGUERA') falla('PUERTO_OCUPADO', `La toma ${pid} tiene manguera: el ducto empieza en su punto de transición (${p.acople.nodo_transicion}).`, [pid]);
      }
      return nd.id;
    }
    dato(esObjeto(desde), 'Falta desde dónde se traza.');
    if (desde.tramo !== undefined) {
      const tr = tramoDe(m, desde.tramo);
      if (!g.conocido(tr.id)) falla('FLUJO_DESCONOCIDO', `Conecte primero el tramo ${tr.id} al colector para saber hacia dónde va el aire.`, [tr.id]);
      return partir(m, g, tr.id, desde.s_mm);
    }
    const P = coordenada(desde.posicion_mm, 'El arranque');
    const e = nodoEn(m, P);
    return e ? e.id : crearNodo(m, P);
  }
  function diametroPorOmision(m, g, nid) {
    const pid = g.puertoDeNodo.get(nid);
    if (pid) return g.puertos.get(pid).puerto.diametro_in;
    const ad = g.ady.get(nid) || [];
    if (g.pt.has(nid)) return (ad.find((x) => flexible(x.tramo)) || ad[0]).tramo.diametro_in;
    if (ad.length) return Math.min(...ad.map((x) => x.tramo.diametro_in));
    return m.politicas.diametros_comerciales_in.includes(6) ? 6 : m.politicas.diametros_comerciales_in[0];
  }

  /**
   * Traza un tramo recto (§1.3 pasos 1–4) desde un nodo (puerto con brida, PT, extremo libre, codo de 30° o 45°), desde un
   * punto de un tramo ({ tramo, s_mm }: un ramal hacia fuera) o desde un punto suelto ({ posicion_mm }), en una dirección de
   * la rejilla y con un largo. El codo o la derivación que haga falta salen solos; un giro que el taller no hace se rechaza.
   * Si el final cae exacto sobre un nodo, se une a él. m.ultimo.nodo es el extremo nuevo (para seguir en cadena).
   */
  function trazar(t0, M, desde, x) {
    const m = inicio(t0);
    dato(esObjeto(x), 'Faltan la dirección y el largo del tramo.');
    const g = calcular(m, M);
    const dir = direccionValida(x.direccion, m.politicas, 'El tramo');
    const L = largoValido(m, x.largo_mm, 'El tramo');
    const a = arranque(m, M, g, desde);
    const g2 = calcular(m, M);
    const D = diametroValido(m, x.diametro_in === undefined ? diametroPorOmision(m, g2, a) : x.diametro_in, 'El tramo');
    const P0 = nodoDe(m, a).posicion_mm;
    const P = r3v(suma(P0, por(vectorDe(dir), L)));
    let b = nodoEn(m, P, a);
    if (b) {
      const w = resta(b.posicion_mm, P0);
      dato(norma(resta(w, por(vectorDe(dir), punto(w, vectorDe(dir))))) <= TOL_DIR_MM, `El final del tramo queda a ${n(norma(resta(b.posicion_mm, P)), 1)} mm de ${b.id} sin llegar exacto: use el imán (conectar).`, [b.id]);
      b = b.id;
    } else b = crearNodo(m, P);
    const tid = nuevoId(m, 'TR');
    m.tramos.push({ id: tid, tipo: 'RIGIDO', a, b, diametro_in: D, diametro_bloqueado: !!x.bloquear, material: m.material.material, calibre: m.material.calibre });
    marcar(m, 'trazar', { nodo: b, tramos: [tid] });
    return terminar(m, M);
  }

  /**
   * Une un trazo con un objetivo por una ruta de segmentos (la de `rutas` o una propia): el último llega exacto a
   * objetivo.nodo (un puerto con brida, un PT o un extremo libre) o a objetivo.tramo en s_mm (la derivación).
   */
  function conectar(t0, M, desde, propuesta) {
    const m = inicio(t0);
    dato(esObjeto(propuesta) && Array.isArray(propuesta.segmentos) && propuesta.segmentos.length >= 1 && propuesta.segmentos.length <= 4 && esObjeto(propuesta.objetivo), 'La ruta lleva de 1 a 4 segmentos y un objetivo.');
    const g = calcular(m, M);
    const a = arranque(m, M, g, desde);
    const segs = propuesta.segmentos.map((s, i) => ({ dir: direccionValida(s.direccion, m.politicas, `El segmento ${i + 1}`), L: largoValido(m, s.largo_mm, `El segmento ${i + 1}`) }));
    const ob = propuesta.objetivo;
    let destino;
    if (ob.tramo !== undefined) {
      const tr = tramoDe(m, ob.tramo);
      if (!g.conocido(tr.id)) falla('FLUJO_DESCONOCIDO', `Conecte primero el tramo ${tr.id} al colector para saber hacia dónde va el aire.`, [tr.id]);
      destino = partir(m, calcular(m, M), tr.id, ob.s_mm);
    } else destino = nodoDe(m, ob.nodo).id;
    dato(destino !== a, 'La ruta no puede terminar donde empieza.');
    const g2 = calcular(m, M);
    const D = diametroValido(m, propuesta.diametro_in === undefined ? diametroPorOmision(m, g2, a) : propuesta.diametro_in, 'La ruta');
    let prev = a;
    const nuevos = [];
    const Q = nodoDe(m, destino).posicion_mm;
    segs.forEach((s, i) => {
      const P0 = nodoDe(m, prev).posicion_mm;
      const u = vectorDe(s.dir);
      let b;
      if (i === segs.length - 1) {
        const w = resta(Q, P0);
        const dev = norma(resta(w, por(u, punto(w, u))));
        dato(punto(w, u) > 0 && dev <= TOL_DIR_MM, `La ruta no llega a ${destino}: se desvía ${n(dev, 2)} mm.`, [destino]);
        b = destino;
      } else {
        const P = r3v(suma(P0, por(u, s.L)));
        dato(!nodoEn(m, P), 'Un codo de la ruta cae sobre otro nodo.');
        b = crearNodo(m, P);
      }
      const tid = nuevoId(m, 'TR');
      m.tramos.push({ id: tid, tipo: 'RIGIDO', a: prev, b, diametro_in: D, diametro_bloqueado: false, material: m.material.material, calibre: m.material.calibre });
      nuevos.push(tid);
      prev = b;
    });
    marcar(m, 'conectar', { nodo: destino, tramos: nuevos });
    return terminar(m, M);
  }

  /* ------------------------------------------------------------------ el imán (§2.5.4) */

  /**
   * Las rutas para llegar desde un nodo a un objetivo: { tramo, puntero? } (derivación) o { nodo } (puerto con brida, PT o
   * extremo). Directa (un tramo, con codo en el arranque si gira) o con un codo intermedio K. Ordenadas por menos codos,
   * ruta más corta y β menor; sólo las que se pueden trazar (se prueban con conectar). Hasta opciones.max (3).
   */
  function rutas(t, M, desde, objetivo, opciones) {
    const o = esObjeto(opciones) ? opciones : {};
    const max = Number.isInteger(o.max) && o.max > 0 ? Math.min(o.max, 12) : 3;
    const g = calcular(t, M);
    const pol = t.politicas;
    dato(typeof desde === 'string' && g.pos.has(desde), 'Las rutas salen de un nodo.');
    const P0 = g.pos.get(desde);
    const C = candidatasEn(t, g, desde).filter((c) => c.pieza === 'RECTO' || c.pieza === 'CODO');
    const dentro = (c) => C.find((x) => igualDir(x.direccion, c));
    const conCodo = (c) => (dentro(c) && dentro(c).pieza === 'CODO' ? 1 : 0);
    const codos = pol.angulos_codo_deg;
    const giraBien = (d0, d1) => codos.some((a) => Math.abs(a - anguloEntre(vectorDe(d0), vectorDe(d1))) < TOL_ANG);
    const props = [];
    const lmin = pol.largo_min_tramo_mm;
    if (esObjeto(objetivo) && objetivo.tramo !== undefined) {
      const tr = g.tramos.get(objetivo.tramo);
      dato(tr && rigido(tr), 'El objetivo es un tramo rígido.');
      if (!g.conocido(tr.id)) return [];
      const mh = g.aire(tr);
      const A = g.pos.get(g.arriba.get(tr.id));
      const LT = g.seg.get(tr.id).L;
      const sDe = (s) => (tr.a === g.arriba.get(tr.id) ? s : LT - s);
      const sPuntero = o.puntero ? clamp(punto(resta(coordenada(o.puntero, 'El puntero'), A), mh), lmin, LT - lmin) : clamp(punto(resta(P0, A), mh), lmin, LT - lmin);
      direccionesDeRamal(pol, mh).forEach((rb) => {
        const bh = vectorDe(rb.direccion);
        const extra = { beta_deg: rb.beta, entrada: rb.entrada, giro_entrada_deg: rb.giro };
        // (a) directa
        if (dentro(rb.direccion)) {
          const sol = cruceRectas(P0, bh, A, mh);
          if (sol && sol.dist <= TOL_MM && sol.t >= lmin && sol.s >= lmin && sol.s <= LT - lmin) {
            props.push({ segmentos: [{ direccion: rb.direccion, largo_mm: sol.t }], objetivo: { tramo: tr.id, s_mm: sDe(sol.s) }, codos: conCodo(rb.direccion), largo_mm: sol.t, ...extra, punto: suma(A, por(mh, sol.s)) });
          }
        }
        // (b) con un codo K
        C.forEach((c0) => {
          if (igualDir(c0.direccion, rb.direccion) || !giraBien(c0.direccion, rb.direccion)) return;
          const d0 = vectorDe(c0.direccion);
          const sol = rutaConCodo(P0, d0, bh, A, mh, sPuntero);
          if (!sol || sol.t0 < lmin || sol.t1 < lmin || sol.s < lmin || sol.s > LT - lmin) return;
          props.push({ segmentos: [{ direccion: c0.direccion, largo_mm: sol.t0 }, { direccion: rb.direccion, largo_mm: sol.t1 }], objetivo: { tramo: tr.id, s_mm: sDe(sol.s) }, codos: conCodo(c0.direccion) + 1, largo_mm: sol.t0 + sol.t1, ...extra, punto: suma(A, por(mh, sol.s)) });
        });
      });
    } else {
      dato(esObjeto(objetivo) && g.pos.has(objetivo.nodo), 'El objetivo es un tramo o un nodo.');
      const Q = g.pos.get(objetivo.nodo);
      candidatasEn(t, g, objetivo.nodo).filter((c) => c.pieza === 'RECTO' || c.pieza === 'CODO').forEach((cf) => {
        const f = opuesta(cf.direccion); // la dirección con la que se llega
        const fv = vectorDe(f);
        const extra = { beta_deg: null, entrada: null, giro_entrada_deg: null, llegada: cf.pieza };
        const w = resta(Q, P0);
        if (dentro(f) && punto(w, fv) >= lmin && norma(resta(w, por(fv, punto(w, fv)))) <= TOL_MM) {
          props.push({ segmentos: [{ direccion: f, largo_mm: punto(w, fv) }], objetivo: { nodo: objetivo.nodo }, codos: conCodo(f) + (cf.pieza === 'CODO' ? 1 : 0), largo_mm: punto(w, fv), ...extra, punto: Q });
        }
        C.forEach((c0) => {
          if (igualDir(c0.direccion, f) || !giraBien(c0.direccion, f)) return;
          const d0 = vectorDe(c0.direccion);
          const sol = dosRectas(w, d0, fv);
          if (!sol || sol.res > TOL_MM || sol.t0 < lmin || sol.t1 < lmin) return;
          props.push({ segmentos: [{ direccion: c0.direccion, largo_mm: sol.t0 }, { direccion: f, largo_mm: sol.t1 }], objetivo: { nodo: objetivo.nodo }, codos: conCodo(c0.direccion) + 1 + (cf.pieza === 'CODO' ? 1 : 0), largo_mm: sol.t0 + sol.t1, ...extra, punto: Q });
        });
      });
    }
    props.sort((a, b) => a.codos - b.codos || a.largo_mm - b.largo_mm || (a.beta_deg || 0) - (b.beta_deg || 0));
    const out = [];
    const vistas = new Set();
    for (const p of props) {
      if (out.length >= max) break;
      const clave = JSON.stringify(p.segmentos.map((s) => [s.direccion, r1(s.largo_mm)]));
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      let m2;
      try { m2 = conectar(t, M, desde, { ...p, diametro_in: o.diametro_in }); } catch (e) { if (e instanceof TrazadoError) continue; throw e; }
      const nuevos = new Set(m2.ultimo.tramos);
      const avisos = revisar(m2, M).filter((v) => (v.severidad === 'ERROR' || v.severidad === 'AVISO') && v.elementos.some((e) => nuevos.has(e)));
      out.push({ ...p, punto: r3v(p.punto), estado: avisos.some((v) => v.severidad === 'ERROR') ? 'ERROR' : avisos.length ? 'AVISO' : 'OK', avisos, texto: textoRuta(p) });
    }
    return out;
  }
  function textoRuta(p) {
    const lado = p.giro_entrada_deg === null || p.giro_entrada_deg === undefined ? '' : p.entrada === 'LATERAL' ? (p.giro_entrada_deg > 180 ? ' (izquierda)' : ' (derecha)') : '';
    const ent = p.entrada ? `, ${p.entrada === 'SUPERIOR' ? 'por arriba' : `de lado${lado}`}` : '';
    const tramos = p.segmentos.map((s) => `${textoDireccion(s.direccion)} ${metros(s.largo_mm)}`).join(' y ');
    return `${p.beta_deg ? `Injerto a ${p.beta_deg}°${ent}` : 'Llegada'}: ${tramos}${p.codos ? `, ${p.codos} codo${p.codos > 1 ? 's' : ''}` : ''}.`;
  }
  /** El cruce del rayo P0 + t·b con la recta A + s·m: t, s y la distancia entre las dos rectas en ese punto. */
  function cruceRectas(P0, b, A, mm) {
    const r = resta(P0, A);
    const bb = punto(b, b);
    const bm = punto(b, mm);
    const mmm = punto(mm, mm);
    const den = bb * mmm - bm * bm;
    if (Math.abs(den) < 1e-12) return null;
    const t = (bm * punto(r, mm) - mmm * punto(r, b)) / den;
    const s = (bb * punto(r, mm) - bm * punto(r, b)) / den;
    return { t, s, dist: norma(resta(suma(P0, por(b, t)), suma(A, por(mm, s)))) };
  }
  /** P0 + t0·d0 + t1·b = A + s·m. Independientes: 3×3 exacto; en un plano: s es la del puntero y se resuelven t0 y t1. */
  function rutaConCodo(P0, d0, b, A, mm, sPuntero) {
    const r = resta(A, P0);
    const det = punto(d0, cruz(b, mm));
    if (Math.abs(det) > 1e-9) {
      // t0·d0 + t1·b − s·m = r (Cramer)
      const mneg = por(mm, -1);
      const t0 = punto(r, cruz(b, mneg)) / punto(d0, cruz(b, mneg));
      const t1 = punto(d0, cruz(r, mneg)) / punto(d0, cruz(b, mneg));
      const s = punto(d0, cruz(b, r)) / punto(d0, cruz(b, mneg));
      return t0 > 0 && t1 > 0 ? { t0, t1, s } : null;
    }
    const sol = dosRectas(suma(r, por(mm, sPuntero)), d0, b);
    return sol && sol.res <= TOL_MM ? { t0: sol.t0, t1: sol.t1, s: sPuntero } : null;
  }
  /** w = t0·d0 + t1·d1 por mínimos cuadrados (con el residuo). */
  function dosRectas(w, d0, d1) {
    const a = punto(d0, d0);
    const b = punto(d0, d1);
    const c = punto(d1, d1);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-12) return null;
    const t0 = (c * punto(w, d0) - b * punto(w, d1)) / den;
    const t1 = (a * punto(w, d1) - b * punto(w, d0)) / den;
    return { t0, t1, res: norma(resta(w, suma(por(d0, t0), por(d1, t1)))) };
  }

  /* ------------------------------------------------------------------ puntos fijos y compensación (§2.2) */

  /**
   * Mueve w el lado de la red rígida que se alcanza desde `inicio` sin pasar por el tramo `excluido` (las mangueras se estiran,
   * no arrastran). Si ese lado tiene puntos fijos, el movimiento se compensa en los tramos del camino común hacia todos ellos:
   * w = −Σ λᵢ·dᵢ con hasta tres direcciones independientes (los tramos más largos primero), cada tramo con su mínimo. Devuelve
   * el desplazamiento de cada nodo y los cambios de largo, o null si no se puede. Con inicioFijo, el propio inicio cuenta como
   * punto fijo (cambiar un largo no puede mover una toma con brida); al mover un equipo o un PT, el inicio es lo que se mueve.
   */
  /** Los nodos de la red rígida que se alcanzan desde `inicio` sin pasar por el tramo `excluido`. */
  function lado(g, inicio0, excluido) {
    const vistos = new Set([inicio0]);
    const cola = [inicio0];
    while (cola.length) {
      const u = cola.shift();
      g.ady.get(u).forEach(({ tramo, otro }) => { if (rigido(tramo) && tramo.id !== excluido && !vistos.has(otro)) { vistos.add(otro); cola.push(otro); } });
    }
    return vistos;
  }
  const conFijos = (g, inicio0, excluido) => [...lado(g, inicio0, excluido)].some((k) => g.fijos.has(k));
  function moverLado(m, g, inicio0, excluido, w, inicioFijo, moviles) {
    if (inicioFijo && g.fijos.has(inicio0) && norma(w) > 1e-9) return null;
    const padre = new Map([[inicio0, null]]);
    const cola = [inicio0];
    const orden = [];
    while (cola.length) {
      const u = cola.shift();
      orden.push(u);
      g.ady.get(u).forEach(({ tramo, otro }) => {
        if (!rigido(tramo) || tramo.id === excluido || padre.has(otro)) return;
        padre.set(otro, { tramo, de: u });
        cola.push(otro);
      });
    }
    const fijos = orden.filter((u) => u !== inicio0 && g.fijos.has(u) && !(moviles && moviles.has(u)));
    const camino = (f) => { const c = []; let u = f; while (padre.get(u)) { c.unshift(padre.get(u)); u = padre.get(u).de; } return c; };
    const disp = new Map();
    const lam = new Map();
    if (fijos.length) {
      const caminos = fijos.map(camino);
      const comun = [];
      for (let i = 0; i < caminos[0].length; i += 1) {
        const x = caminos[0][i];
        if (caminos.every((c) => c[i] && c[i].tramo.id === x.tramo.id)) comun.push(x); else break;
      }
      const cand = comun.map((x) => {
        const s = g.seg.get(x.tramo.id);
        const d = x.tramo.a === x.de ? s.u : por(s.u, -1);
        const ocupa = g.ocupa.get(x.tramo.id).reduce((acc, o) => acc + o.mm, 0);
        return { id: x.tramo.id, d, L: s.L, min: Math.max(m.politicas.largo_min_tramo_mm, ocupa) };
      }).sort((a, b) => b.L - a.L);
      const meta = por(w, -1);
      const sirve = (sel, ls) => sel.every((c, i) => c.L + ls[i] >= c.min - 1e-6 && c.L + ls[i] <= LARGO_MAX_MM);
      let sol = null;
      for (const c of cand) {
        const l = punto(meta, c.d);
        if (norma(resta(meta, por(c.d, l))) <= 1e-3 && sirve([c], [l])) { sol = [[c, l]]; break; }
      }
      for (let i = 0; !sol && i < cand.length; i += 1) {
        for (let j = i + 1; !sol && j < cand.length; j += 1) {
          const r = dosRectas(meta, cand[i].d, cand[j].d);
          if (r && r.res <= 1e-3 && sirve([cand[i], cand[j]], [r.t0, r.t1])) sol = [[cand[i], r.t0], [cand[j], r.t1]];
        }
      }
      for (let i = 0; !sol && i < cand.length; i += 1) {
        for (let j = i + 1; !sol && j < cand.length; j += 1) {
          for (let k = j + 1; !sol && k < cand.length; k += 1) {
            const [a, b, c] = [cand[i].d, cand[j].d, cand[k].d];
            const det = punto(a, cruz(b, c));
            if (Math.abs(det) < 1e-9) continue;
            const ls = [punto(meta, cruz(b, c)) / det, punto(a, cruz(meta, c)) / det, punto(a, cruz(b, meta)) / det];
            if (sirve([cand[i], cand[j], cand[k]], ls)) sol = [[cand[i], ls[0]], [cand[j], ls[1]], [cand[k], ls[2]]];
          }
        }
      }
      if (!sol) return null;
      sol.forEach(([c, l]) => { if (Math.abs(l) > 1e-9) lam.set(c.id, { d: c.d, l }); });
    }
    orden.forEach((u) => {
      const p = padre.get(u);
      if (!p) { disp.set(u, w); return; }
      const x = lam.get(p.tramo.id);
      disp.set(u, x ? suma(disp.get(p.de), por(x.d, x.l)) : disp.get(p.de));
    });
    return { disp, cambios: [...lam.entries()].map(([id, x]) => ({ tramo: id, delta_mm: x.l })) };
  }
  function aplicarMovimiento(m, mov) {
    m.nodos.forEach((x) => { const d = mov.disp.get(x.id); if (d && norma(d) > 0) x.posicion_mm = r3v(suma(x.posicion_mm, d)); });
  }

  /**
   * Cambia el largo a ejes de un tramo (§1.3 paso 10): se traslada el lado libre; si los dos lados llegan a puntos fijos, el
   * cambio se compensa en el camino (tramos paralelos primero) o se rechaza con FIJO_SE_MUEVE.
   */
  function cambiarLargo(t0, M, tramoId, largo) {
    const m = inicio(t0);
    const t = tramoDe(m, tramoId);
    dato(rigido(t), 'El largo de una manguera sale de la posición de su punto de transición.', [t.id]);
    largoValido(m, largo, `El tramo ${t.id}`);
    const g = calcular(m, M);
    const s = g.seg.get(t.id);
    const delta = largo - s.L;
    if (Math.abs(delta) > 1e-9) {
      const ladoB = { inicio: t.b, w: por(s.u, delta) };
      const ladoA = { inicio: t.a, w: por(s.u, -delta) };
      const libreB = !conFijos(g, t.b, t.id);
      const libreA = !conFijos(g, t.a, t.id);
      // el lado libre; si los dos lo son, el de aguas arriba (o el del final del trazo); si ninguno, se compensa
      let orden;
      if (libreB && !libreA) orden = [ladoB];
      else if (libreA && !libreB) orden = [ladoA];
      else if (libreA && libreB) orden = g.arriba.get(t.id) === t.a ? [ladoA] : [ladoB];
      else orden = g.arriba.get(t.id) === t.a ? [ladoA, ladoB] : [ladoB, ladoA];
      let mov = null;
      for (const o of orden) { mov = moverLado(m, g, o.inicio, t.id, o.w, true); if (mov) break; }
      if (!mov) falla('FIJO_SE_MUEVE', `Cambiar ${t.id} a ${metros(largo)} movería un punto fijo y ningún tramo del camino puede compensarlo.`, [t.id], 'Mueva un segmento, o compense con un tramo paralelo.');
      aplicarMovimiento(m, mov);
      marcar(m, 'cambiarLargo', { tramos: [t.id], compensacion: mov.cambios.map((c) => ({ tramo: c.tramo, delta_mm: r3(c.delta_mm) })) });
    } else marcar(m, 'cambiarLargo', { tramos: [t.id], compensacion: [] });
    return terminar(m, M);
  }

  /** Desplaza un tramo en paralelo w (mm, perpendicular a él): sus vecinos, que deben ser paralelos a w, se alargan o acortan. */
  function moverSegmento(t0, M, tramoId, w0) {
    const m = inicio(t0);
    const t = tramoDe(m, tramoId);
    dato(rigido(t), 'Una manguera se mueve con su punto de transición.', [t.id]);
    const w = coordenada(w0, 'El desplazamiento');
    const g = calcular(m, M);
    const u = g.seg.get(t.id).u;
    dato(norma(w) > 1e-9 && Math.abs(punto(w, u)) <= TOL_DIR_MM, 'El segmento se mueve perpendicular a sí mismo (para alargarlo, cambie su largo).', [t.id]);
    const wh = unitario(w);
    [t.a, t.b].forEach((nid) => {
      if (g.fijos.has(nid)) falla('FIJO_SE_MUEVE', `${nid} es un punto fijo: el segmento ${t.id} no se puede mover.`, [nid, t.id]);
      g.ady.get(nid).filter((x) => x.tramo.id !== t.id).forEach(({ tramo, otro }) => {
        if (flexible(tramo)) return;
        const d = g.fuera(tramo, nid);
        if (norma(cruz(d, wh)) > 1e-9) falla('MOVER_NO_POSIBLE', `El tramo ${tramo.id} no es paralelo al movimiento: no puede alargarse ni acortarse para seguir a ${t.id}.`, [tramo.id, t.id]);
        const Lnuevo = punto(resta(g.pos.get(otro), suma(g.pos.get(nid), w)), d);
        if (Lnuevo < m.politicas.largo_min_tramo_mm - 1e-6) falla('MOVER_NO_POSIBLE', `El tramo ${tramo.id} quedaría de ${metros(Math.max(0, Lnuevo))}: el mínimo es ${metros(m.politicas.largo_min_tramo_mm)}.`, [tramo.id]);
      });
    });
    [t.a, t.b].forEach((nid) => { const x = nodoDe(m, nid); x.posicion_mm = r3v(suma(x.posicion_mm, w)); });
    marcar(m, 'moverSegmento', { tramos: [t.id] });
    return terminar(m, M);
  }

  /** Cambia el ángulo de un codo (§1.3 paso 10): gira el lado libre sobre el nodo, en el plano del codo. */
  function cambiarAngulo(t0, M, nodoId, grados) {
    const m = inicio(t0);
    const g = calcular(m, M);
    const pzs = g.piezasDe.get(nodoId) || [];
    const codo = pzs.find((p) => p.tipo === 'CODO');
    dato(!!codo, `En ${nodoId} no hay un codo.`, [nodoId]);
    dato(m.politicas.angulos_codo_deg.includes(grados), `El taller hace codos a ${lista(m.politicas.angulos_codo_deg.map((a) => `${a}°`))}.`);
    const [c1, c2] = codo.conexiones.map((c) => g.tramos.get(c.tramo));
    const ladoDe = (tr) => lado(g, tr.a === nodoId ? tr.b : tr.a, tr.id);
    const libre = (tr) => !conFijos(g, tr.a === nodoId ? tr.b : tr.a, tr.id);
    const gira = libre(c1) && (!libre(c2) || g.arriba.get(c1.id) !== nodoId) ? c1 : libre(c2) ? c2 : null;
    if (!gira) falla('FIJO_SE_MUEVE', `Los dos lados del codo de ${nodoId} llegan a puntos fijos: no se puede girar.`, [nodoId]);
    const quieto = gira === c1 ? c2 : c1;
    const dq = por(g.fuera(quieto, nodoId), -1);
    const dg = g.fuera(gira, nodoId);
    const k = unitario(cruz(dq, dg));
    const delta = grados - codo.geometria.angulo_deg;
    const P = g.pos.get(nodoId);
    const nodos = ladoDe(gira);
    m.nodos.forEach((x) => { if (nodos.has(x.id)) x.posicion_mm = r3v(suma(P, girarEje(resta(x.posicion_mm, P), k, delta))); });
    // las direcciones de los puertos de los PT que giran
    const gg = calcular(m, M);
    m.tramos.filter(rigido).forEach((tr) => {
      if ((nodos.has(tr.a) || nodos.has(tr.b)) && !gg.seg.get(tr.id).dir) falla('GIRO_NO_FABRICABLE', `Girar ese lado a ${grados}° saca el tramo ${tr.id} de la rejilla.`, [nodoId, tr.id]);
    });
    marcar(m, 'cambiarAngulo', { nodo: nodoId, tramos: [gira.id] });
    return terminar(m, M);
  }

  /** Cambia el Ø de un tramo rígido (con candado o sin él): una reducción o un adaptador salen solos (§2.4). */
  function cambiarDiametro(t0, M, tramoId, D, opciones) {
    const m = inicio(t0);
    const t = tramoDe(m, tramoId);
    dato(rigido(t), 'El Ø de la manguera es el de su toma.', [t.id]);
    const D0 = t.diametro_in;
    // la red de antes del cambio: con el Ø nuevo una derivación podría quedar inválida y no saldría en el cálculo
    const g = opciones && opciones.cadena ? calcular(m, M) : null;
    t.diametro_in = diametroValido(m, D, `El tramo ${t.id}`);
    if (opciones && opciones.bloquear !== undefined) t.diametro_bloqueado = !!opciones.bloquear;
    const cambios = [t.id];
    if (g && D !== D0) {
      // §2.6: hacia el colector el Ø no baja y un ramal no pasa de su tronco; lo que lo impida cambia con él (sin pasar candados)
      if (!g.conocido(t.id)) falla('FLUJO_DESCONOCIDO', `Conecte primero ${t.id} al colector para saber qué tramos siguen.`, [t.id]);
      const fijar = (tr) => {
        if (tr.diametro_in === D) return;
        if (tr.diametro_bloqueado) falla('DIAMETRO_BLOQUEADO', `${tr.id} tiene candado en ${pulgadas(tr.diametro_in)}: quítelo para cambiar la cadena a ${pulgadas(D)}.`, [tr.id, t.id]);
        tr.diametro_in = D;
        cambios.push(tr.id);
      };
      if (D > D0) {
        const der = g.derivaciones.find((x) => x.ramal === t.id);
        if (der && g.tramos.get(der.tIn).diametro_in < D) fijar(g.tramos.get(der.tIn));
        for (let u = g.abajo.get(t.id); u !== undefined && g.sale.has(u);) {
          const tr = g.tramos.get(g.sale.get(u));
          if (!rigido(tr) || tr.diametro_in >= D) break;
          fijar(tr);
          u = g.abajo.get(tr.id);
        }
      } else {
        const bajar = (u) => g.entran(u).forEach((tr) => { if (rigido(tr) && tr.diametro_in > D) { fijar(tr); bajar(g.arriba.get(tr.id)); } });
        bajar(g.arriba.get(t.id));
      }
    }
    marcar(m, 'cambiarDiametro', { tramos: cambios });
    return terminar(m, M);
  }
  /**
   * Tramo corto entre piezas (§2.2, aviso TRAMO_CORTO): PEGAR arma las piezas de sus dos extremos con el recto que queda,
   * soldadas o engargoladas según el material y sin bridas en esas caras; ACEPTAR fabrica el tramo corto con bridas; null
   * quita la decisión. Si el tramo deja de ser corto, la decisión se quita sola.
   */
  function decidirCorto(t0, M, tramoId, decision) {
    const m = inicio(t0);
    const t = tramoDe(m, tramoId);
    dato(decision === null || decision === 'PEGAR' || decision === 'ACEPTAR', 'La decisión del tramo corto es PEGAR, ACEPTAR o null.');
    const c = cortoDe(m, calcular(m, M), t);
    if (decision === null) delete t.corto;
    else {
      dato(!!c, `${t.id} no es un tramo corto entre piezas.`, [t.id]);
      dato(decision !== 'PEGAR' || c.nodos.size === 2, `Para pegar, ${t.id} necesita una pieza en cada extremo.`, [t.id]);
      t.corto = decision;
    }
    marcar(m, 'decidirCorto', { tramos: [t.id] });
    return terminar(m, M);
  }
  /**
   * Reduce el ducto desde un punto hacia las tomas (§4.3, bloque Reducción): desde { tramo, s_mm } parte el tramo ahí (pegado
   * a un extremo, a menos del largo mínimo, toma el tramo entero); desde un nodo (un codo o una derivación) toma el tramo que
   * le llega por el tronco. Ese tramo y los que le siguen aguas arriba por codos y uniones, hasta una toma, un punto de
   * transición, un extremo, una derivación o un Ø con candado, quedan del Ø D, menor: la reducción sale sola en el punto.
   * Hace falta el sentido del aire. m.ultimo.tramos son los que cambiaron (el primero, el del punto).
   */
  function reducir(t0, M, desde, D) {
    const m = inicio(t0);
    diametroValido(m, D, 'La reducción');
    let g = calcular(m, M);
    let primero;
    let nodo;
    if (esObjeto(desde) && desde.tramo !== undefined) {
      const t = tramoDe(m, desde.tramo);
      dato(rigido(t), 'Una manguera no se reduce: su Ø es el de su toma.', [t.id]);
      if (!g.conocido(t.id)) falla('FLUJO_DESCONOCIDO', `Conecte primero el tramo ${t.id} al colector para saber hacia dónde reducir.`, [t.id]);
      dato(finito(desde.s_mm), 'Falta en qué punto del tramo va la reducción.');
      const L = g.seg.get(t.id).L;
      const lim = m.politicas.largo_min_tramo_mm;
      const arriba = g.arriba.get(t.id);
      if (desde.s_mm < lim - 1e-9 || desde.s_mm > L - lim + 1e-9) {
        primero = t;
        nodo = g.abajo.get(t.id);
      } else {
        nodo = partir(m, g, t.id, desde.s_mm);
        primero = t.a === arriba ? t : m.tramos.find((x) => x.a === nodo && x.id !== t.id);
        g = calcular(m, M);
      }
    } else {
      dato(typeof desde === 'string', 'La reducción va en un punto de un tramo o en un nodo.');
      nodoDe(m, desde);
      nodo = desde;
      const der = g.derivaciones.find((x) => x.nodo === nodo);
      const entran = g.entran(nodo).filter(rigido);
      if (!g.ady.get(nodo).length) falla('DATO_INVALIDO', `En ${nodo} no hay ducto.`, [nodo]);
      if (!g.ady.get(nodo).every((x) => g.conocido(x.tramo.id))) falla('FLUJO_DESCONOCIDO', `Conecte primero el ducto de ${nodo} al colector para saber hacia dónde reducir.`, [nodo]);
      if (!entran.length) falla('DATO_INVALIDO', `A ${nodo} no le llega ducto de aguas arriba: la reducción va en un tramo, o en el codo o la derivación donde cambia el Ø.`, [nodo]);
      primero = der ? g.tramos.get(der.tIn) : entran[0];
    }
    const actual = primero.diametro_in;
    dato(D < actual, `Para reducir, el Ø nuevo debe ser menor que el del tramo ${primero.id} (${pulgadas(actual)}).`, [primero.id]);
    const cambian = [primero];
    let u = g.arriba.get(primero.id);
    for (;;) {
      if (g.puertoDeNodo.has(u) || g.pt.has(u)) break;
      const entran = g.entran(u);
      if (entran.length !== 1 || g.ady.get(u).length !== 2 || !rigido(entran[0]) || entran[0].diametro_bloqueado || entran[0].diametro_in !== actual) break;
      cambian.push(entran[0]);
      u = g.arriba.get(entran[0].id);
    }
    cambian.forEach((x) => { tramoDe(m, x.id).diametro_in = D; });
    marcar(m, 'reducir', { nodo, tramos: cambian.map((x) => x.id) });
    return terminar(m, M);
  }

  /**
   * Pone una compuerta de regulación (§4.3, bloque Compuerta) en un punto de un tramo recto ({ tramo, s_mm }: lo parte ahí) o
   * en un nodo que ya une dos tramos rectos del mismo Ø. Ocupa LARGO_COMPUERTA_MM del tramo, la mitad de cada lado, y el
   * cálculo de pérdidas dice cuánto cerrarla para balancear.
   */
  function ponerCompuerta(t0, M, desde) {
    const m = inicio(t0);
    let nodo;
    if (esObjeto(desde) && desde.tramo !== undefined) {
      const t = tramoDe(m, desde.tramo);
      dato(rigido(t), 'La compuerta va en el ducto rígido, no en la manguera.', [t.id]);
      dato(finito(desde.s_mm), 'Falta en qué punto del tramo va la compuerta.');
      nodo = partir(m, calcular(m, M), t.id, desde.s_mm);
    } else {
      dato(typeof desde === 'string', 'La compuerta va en un punto de un tramo o en un nodo.');
      nodo = desde;
    }
    const nd = nodoDe(m, nodo);
    dato(!nd.compuerta, `En ${nodo} ya hay una compuerta.`, [nodo]);
    nd.compuerta = true;
    marcar(m, 'ponerCompuerta', { nodo });
    return terminar(m, M);
  }
  /** Quita la compuerta de un nodo; si los dos tramos siguen en línea, se funden otra vez en uno. */
  function quitarCompuerta(t0, M, nodoId) {
    const m = inicio(t0);
    const nd = nodoDe(m, nodoId);
    dato(nd.compuerta, `En ${nodoId} no hay compuerta.`, [nodoId]);
    delete nd.compuerta;
    marcar(m, 'quitarCompuerta', { nodo: nodoId });
    return terminar(m, M);
  }

  /** Ancla un nodo (punto fijo; no se funde) o lo suelta. */
  function anclar(t0, M, nodoId, si) {
    const m = inicio(t0);
    const x = nodoDe(m, nodoId);
    dato(!x.puerto, 'Un puerto ya es fijo por su brida.');
    x.ancla = !!si;
    marcar(m, 'anclar', { nodo: x.id });
    return terminar(m, M);
  }

  /** Borra un tramo (§1.3 paso 11); con ramal: true, el ramal completo hasta sus tomas (las máquinas se quedan). */
  function borrarTramo(t0, M, tramoId, opciones) {
    const m = inicio(t0);
    const t = tramoDe(m, tramoId);
    const g = calcular(m, M);
    let borrar = new Set([t.id]);
    if (opciones && opciones.ramal) {
      if (!g.conocido(t.id)) falla('FLUJO_DESCONOCIDO', `No se sabe hacia dónde va el aire en ${t.id}: borre los tramos uno por uno.`, [t.id]);
      const cola = [g.arriba.get(t.id)];
      while (cola.length) {
        const u = cola.shift();
        g.entran(u).forEach((x) => { borrar.add(x.id); cola.push(g.arriba.get(x.id)); });
      }
    }
    if (flexible(t)) borrar = new Set([...borrar].filter((id) => id !== t.id));
    m.equipos.forEach((e) => e.puertos.forEach((p) => { if (p.acople && p.acople.tipo === 'MANGUERA' && (borrar.has(p.acople.tramo_flexible) || p.acople.tramo_flexible === t.id)) quitarManguera(m, p); }));
    m.tramos = m.tramos.filter((x) => !borrar.has(x.id));
    marcar(m, 'borrarTramo');
    return terminar(m, M);
  }

  /* ------------------------------------------------------------------ dimensionar por caudal (§2.6) */

  /**
   * El Ø que pide el caudal de cada tramo rígido sin candado: el mayor comercial con v ≥ v mín (el de menor pérdida que
   * todavía transporta), sin bajar hacia el colector y sin que un ramal sea mayor que su tronco. No cambia el trazo: devuelve
   * { cambios: [{ tramo, de_in, a_in, v_de_m_s, v_a_m_s }], avisos }.
   */
  function dimensionar(t, M) {
    const g = calcular(t, M);
    const pol = t.politicas;
    const com = pol.diametros_comerciales_in;
    const D = new Map(t.tramos.map((x) => [x.id, x.diametro_in]));
    const avisos = [];
    const pide = (Q) => {
      const ok = com.filter((d) => velocidad(Q, d) >= pol.velocidad_min_m_s - 1e-9);
      return ok.length ? ok[ok.length - 1] : com[0];
    };
    g.comps.forEach((c) => {
      if (c.flujo !== 'COLECTOR' || !c.orden) return;
      for (let i = c.orden.length - 1; i >= 0; i -= 1) {
        const u = c.orden[i];
        const tid = g.sale.get(u);
        if (tid === undefined) continue;
        const tr = g.tramos.get(tid);
        if (!rigido(tr)) continue;
        const Q = g.Q.get(tid);
        const actual = D.get(tid);
        const pedido = Q === null || Q === 0 ? actual : pide(Q);
        let necesita = 0;
        const der = g.derivaciones.find((x) => x.nodo === u);
        if (der) {
          if (D.get(der.ramal) > D.get(der.tIn)) {
            const tin = g.tramos.get(der.tIn);
            if (!tin.diametro_bloqueado) D.set(der.tIn, D.get(der.ramal));
            avisos.push({ codigo: 'TRONCO_MENOR_QUE_RAMAL', severidad: 'AVISO', elementos: [der.ramal, der.tIn], mensaje: `El ramal ${der.ramal} pide ${pulgadas(D.get(der.ramal))}, más que el tronco ${der.tIn}: conviene que el ramal sea el tronco.`, sugerencia: null });
          }
          necesita = D.get(der.tIn);
        } else g.entran(u).filter(rigido).forEach((x) => { necesita = Math.max(necesita, D.get(x.id)); });
        let d = Math.max(pedido, necesita);
        if (tr.diametro_bloqueado) {
          if (d !== actual) avisos.push({ codigo: 'DIAMETRO_BLOQUEADO', severidad: 'AVISO', elementos: [tid], mensaje: `${tid} tiene candado en ${pulgadas(actual)} y ${necesita > actual ? 'el tramo anterior' : 'el caudal'} pediría ${pulgadas(d)}.`, sugerencia: null });
          d = actual;
        }
        D.set(tid, d);
        if (Q && (velocidad(Q, d) < pol.velocidad_min_m_s - 1e-9 || velocidad(Q, d) > pol.velocidad_max_m_s + 1e-9)) {
          avisos.push({ codigo: velocidad(Q, d) < pol.velocidad_min_m_s ? 'VELOCIDAD_BAJA' : 'VELOCIDAD_ALTA', severidad: 'AVISO', elementos: [tid], mensaje: `Ningún Ø comercial deja ${tid} entre ${pol.velocidad_min_m_s} y ${pol.velocidad_max_m_s} m/s: con ${pulgadas(d)} va a ${n(velocidad(Q, d), 1)} m/s.`, sugerencia: null });
        }
      }
    });
    const cambios = t.tramos.filter((x) => rigido(x) && D.get(x.id) !== x.diametro_in).map((x) => ({
      tramo: x.id, de_in: x.diametro_in, a_in: D.get(x.id), v_de_m_s: g.v.get(x.id) === null ? null : r3(g.v.get(x.id)), v_a_m_s: g.Q.get(x.id) === null ? null : r3(velocidad(g.Q.get(x.id), D.get(x.id))),
    }));
    return { cambios, avisos };
  }
  /** Aplica el dimensionamiento (todos los cambios, o sólo los tramos de la lista). */
  function aplicarDimensiones(t0, M, tramos) {
    const { cambios } = dimensionar(t0, M);
    const m = inicio(t0);
    const sel = Array.isArray(tramos) ? cambios.filter((c) => tramos.includes(c.tramo)) : cambios;
    sel.forEach((c) => { tramoDe(m, c.tramo).diametro_in = c.a_in; });
    marcar(m, 'aplicarDimensiones', {
      tramos: sel.map((c) => c.tramo),
      info: sel.map((c) => ({ codigo: 'DIAMETRO_AUTOMATICO', severidad: 'INFO', elementos: [c.tramo], mensaje: `${c.tramo}: ${pulgadas(c.de_in)} → ${pulgadas(c.a_in)}${c.v_de_m_s === null ? '' : `, ${n(c.v_de_m_s, 1)} → ${n(c.v_a_m_s, 1)} m/s`}.`, sugerencia: null })),
    });
    return terminar(m, M);
  }

  /* ------------------------------------------------------------------ revisar (§2.10 y §2.11) */

  /** La distancia más corta de un segmento a la caja (girada) de un equipo, por búsqueda ternaria (la función es convexa). */
  function distanciaCaja(p, q, e) {
    const loc = (x) => { const r = girarZ(resta(x, e.posicion_mm), -e.rotacion_z_deg); return r; };
    const a = loc(p);
    const b = loc(q);
    const c = e.caja_mm;
    const dist = (s) => {
      const x = suma(a, por(resta(b, a), s));
      const dx = Math.max(Math.abs(x.x) - c.largo / 2, 0);
      const dy = Math.max(Math.abs(x.y) - c.ancho / 2, 0);
      const dz = Math.max(-x.z, x.z - c.alto, 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i += 1) { const m1 = lo + (hi - lo) / 3; const m2 = hi - (hi - lo) / 3; if (dist(m1) <= dist(m2)) hi = m2; else lo = m1; }
    return Math.min(dist((lo + hi) / 2), dist(0), dist(1));
  }
  /** Dos cajas de equipos que se enciman (con la holgura), por ejes separadores en planta y en altura. */
  function cajasSeEnciman(e1, e2, holgura) {
    if (e1.posicion_mm.z + e1.caja_mm.alto + holgura <= e2.posicion_mm.z || e2.posicion_mm.z + e2.caja_mm.alto + holgura <= e1.posicion_mm.z) return false;
    const esquinas = (e) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => suma(e.posicion_mm, girarZ(V3((sx * (e.caja_mm.largo + holgura)) / 2, (sy * (e.caja_mm.ancho + holgura)) / 2, 0), e.rotacion_z_deg)));
    const A = esquinas(e1);
    const B = esquinas(e2);
    const ejes = [e1, e2].flatMap((e) => [girarZ(V3(1, 0, 0), e.rotacion_z_deg), girarZ(V3(0, 1, 0), e.rotacion_z_deg)]);
    return ejes.every((ax) => {
      const pa = A.map((p) => punto(p, ax));
      const pb = B.map((p) => punto(p, ax));
      return Math.max(...pa) > Math.min(...pb) + 1e-9 && Math.max(...pb) > Math.min(...pa) + 1e-9;
    });
  }

  /**
   * El catálogo de §2.11 sobre el trazo: BLOQUEANTE (no debería haber: las operaciones no los dejan), ERROR (impide exportar),
   * AVISO e INFO. Cada uno { codigo, severidad, elementos, mensaje, sugerencia }, ordenados por severidad.
   */
  function revisar(t, M, g0) {
    const g = g0 || calcular(t, M);
    const pol = t.politicas;
    const out = [...g.problemas];
    const add = (codigo, severidad, elementos, mensaje, sugerencia) => out.push({ codigo, severidad, elementos, mensaje, sugerencia: sugerencia || null });
    const rig = t.tramos.filter(rigido);
    const D = (x) => x.diametro_in * IN;
    const idPieza = (pz) => pz.id || pz.tipo;
    // ERROR
    rig.forEach((x) => {
      const neta = g.neta.get(x.id);
      if (neta < -1e-3) add('ACCESORIOS_NO_CABEN', 'ERROR', [x.id, ...g.ocupa.get(x.id).map((o) => idPieza(o.pieza))], `Los accesorios del tramo ${x.id} ocupan ${n(-neta)} mm más que su largo.`, 'Alárguelo o pegue las piezas.');
    });
    const caja = rig.map((x) => {
      const A = g.pos.get(x.a);
      const B = g.pos.get(x.b);
      const r = D(x) / 2 + pol.holgura_min_mm;
      return { x, A, B, lo: V3(Math.min(A.x, B.x) - r, Math.min(A.y, B.y) - r, Math.min(A.z, B.z) - r), hi: V3(Math.max(A.x, B.x) + r, Math.max(A.y, B.y) + r, Math.max(A.z, B.z) + r) };
    });
    for (let i = 0; i < caja.length; i += 1) {
      for (let j = i + 1; j < caja.length; j += 1) {
        const p = caja[i];
        const q = caja[j];
        if (p.x.a === q.x.a || p.x.a === q.x.b || p.x.b === q.x.a || p.x.b === q.x.b) continue;
        if (p.hi.x < q.lo.x || q.hi.x < p.lo.x || p.hi.y < q.lo.y || q.hi.y < p.lo.y || p.hi.z < q.lo.z || q.hi.z < p.lo.z) continue;
        const dd = CAD.distanciaSegmentos(p.A, p.B, q.A, q.B);
        const nec = (D(p.x) + D(q.x)) / 2 + pol.holgura_min_mm;
        if (dd < nec - 1e-6) add('CHOQUE_DUCTOS', 'ERROR', [p.x.id, q.x.id], `${p.x.id} y ${q.x.id} se cruzan: sus ejes pasan a ${n(dd)} mm y necesitan ${n(nec)} mm.`, 'Mueva un segmento o cambie el nivel.');
      }
    }
    const equipoDeNodo = new Map();
    g.puertos.forEach((pu) => equipoDeNodo.set(pu.puerto.nodo, pu.equipo.id));
    t.equipos.forEach((e) => {
      caja.forEach((c) => {
        if (equipoDeNodo.get(c.x.a) === e.id || equipoDeNodo.get(c.x.b) === e.id) return;
        const dd = distanciaCaja(c.A, c.B, e);
        if (dd < D(c.x) / 2 + pol.holgura_min_mm - 1e-6) add('CHOQUE_EQUIPO', 'ERROR', [c.x.id, e.id], `${c.x.id} pasa a ${n(dd)} mm de ${e.nombre}: necesita ${n(D(c.x) / 2 + pol.holgura_min_mm)} mm.`, 'Mueva el segmento o el equipo.');
      });
    });
    for (let i = 0; i < t.equipos.length; i += 1) {
      for (let j = i + 1; j < t.equipos.length; j += 1) {
        if (cajasSeEnciman(t.equipos[i], t.equipos[j], pol.holgura_min_mm)) add('EQUIPOS_ENCIMADOS', 'ERROR', [t.equipos[i].id, t.equipos[j].id], `${t.equipos[i].nombre} y ${t.equipos[j].nombre} se enciman (con ${n(pol.holgura_min_mm)} mm de holgura).`, 'Separe los equipos.');
      }
    }
    g.comps.forEach((c) => {
      if (!c.tramos.length || c.flujo === 'COLECTOR' || c.ciclo || c.sumideros.length > 1) return;
      add('SUBRED_SIN_COLECTOR', 'ERROR', c.tramos.slice(0, 8), `Una parte de la red (${c.tramos.slice(0, 4).join(', ')}${c.tramos.length > 4 ? '…' : ''}) no llega a un colector.`, 'Conéctela a la boca de un colector o al tronco.');
    });
    g.puertos.forEach((pu, pid) => {
      const p = pu.puerto;
      if (p.rol !== 'TOMA') return;
      const nombre = `La toma ${pid} (${pu.equipo.nombre})`;
      const ac = p.acople;
      if (!ac) add('TOMA_SIN_CONEXION', 'ERROR', [pid], `${nombre} no tiene acople: elija manguera o brida.`);
      else {
        const nd = ac.tipo === 'MANGUERA' ? ac.nodo_transicion : p.nodo;
        if (!g.ady.get(nd).some((x) => rigido(x.tramo))) add('TOMA_SIN_CONEXION', 'ERROR', [pid, nd], `${nombre} no tiene ducto.`, 'Trace desde la toma o desde su punto de transición.');
      }
      if (p.caudal_m3_h === null) add('TOMA_SIN_DATOS', 'ERROR', [pid], `${nombre} no tiene caudal de diseño.`, 'Escriba su caudal en m³/h.');
    });
    // AVISO
    t.tramos.forEach((x) => {
      const v = g.v.get(x.id);
      if (v === null || g.Q.get(x.id) === 0) return; // sin tomas aguas arriba no hay aire: lo dice EXTREMO_ABIERTO
      if (v < pol.velocidad_min_m_s - 1e-9 || v > pol.velocidad_max_m_s + 1e-9) {
        const baja = v < pol.velocidad_min_m_s;
        const com = pol.diametros_comerciales_in.filter((d) => velocidad(g.Q.get(x.id), d) >= pol.velocidad_min_m_s - 1e-9);
        const mejor = com.length ? com[com.length - 1] : pol.diametros_comerciales_in[0];
        add(baja ? 'VELOCIDAD_BAJA' : 'VELOCIDAD_ALTA', 'AVISO', [x.id], `${x.id} va a ${n(v, 1)} m/s (${baja ? 'mínimo' : 'máximo'} ${n(baja ? pol.velocidad_min_m_s : pol.velocidad_max_m_s, 1)})${mejor !== x.diametro_in && rigido(x) ? `: con ${pulgadas(mejor)}, ${n(velocidad(g.Q.get(x.id), mejor), 1)} m/s` : ''}.`,
          rigido(x) ? 'Dimensionar por caudal.' : 'Cambie el Ø de la toma.');
      }
    });
    rig.forEach((x) => {
      const neta = g.neta.get(x.id);
      const oc = g.ocupa.get(x.id);
      if (neta >= -1e-3 && neta < pol.recto_min_entre_accesorios_mm - 1e-6 && oc.length) {
        const piezas = [...new Set(oc.map((o) => idPieza(o.pieza)))];
        const donde = `${piezas.length > 1 ? `Entre ${lista(piezas, 'y')}` : `Después de ${piezas[0]}`} quedan ${n(Math.max(0, neta))} mm de recto en ${x.id}`;
        if (x.corto === 'PEGAR') add('PIEZAS_PEGADAS', 'INFO', [x.id, ...piezas], `${lista(piezas, 'y')} se arman pegadas (unión ${unionPegada(M, x.material) === 'SOLDADA' ? 'soldada' : 'engargolada'}, sin bridas en esas caras) con ${n(Math.max(0, neta))} mm de recto en ${x.id}.`);
        else if (x.corto === 'ACEPTAR') add('TRAMO_CORTO_ACEPTADO', 'INFO', [x.id, ...piezas], `Tramo corto aceptado: ${donde.charAt(0).toLowerCase()}${donde.slice(1)}, con bridas.`);
        else add('TRAMO_CORTO', 'AVISO', [x.id, ...piezas], `${donde} (mínimo ${n(pol.recto_min_entre_accesorios_mm)}).`, 'Pegue las piezas (armado de piezas) o fabrique el tramo corto.');
      }
      const u = g.seg.get(x.id).u;
      if (Math.abs(u.z) < 0.999) {
        const fondo = Math.min(g.pos.get(x.a).z, g.pos.get(x.b).z) - D(x) / 2;
        if (fondo < pol.altura_libre_min_mm - 1e-6) add('ALTURA_LIBRE', 'AVISO', [x.id], `Bajo ${x.id} quedan ${n(Math.max(0, fondo))} mm libres (mínimo ${n(pol.altura_libre_min_mm)}).`, 'Súbalo si pasa por donde se circula.');
      }
    });
    g.derivaciones.forEach((dv) => {
      const tin = g.tramos.get(dv.tIn);
      const otro = g.arriba.get(dv.tIn) || (tin.a === dv.nodo ? tin.b : tin.a);
      if (g.tipo.get(otro) === 'VERTICE' && g.neta.get(dv.tIn) < pol.recto_antes_de_derivacion_D * D(tin) - 1e-6) {
        add('DERIVACION_CERCA_DE_CODO', 'AVISO', [dv.tIn, dv.nodo], `Entre el codo de ${otro} y la derivación de ${dv.nodo} quedan ${n(g.neta.get(dv.tIn))} mm de recto; conviene ${n(pol.recto_antes_de_derivacion_D * D(tin))} mm.`);
      }
      const qr = g.Q.get(dv.ramal);
      const qi = g.Q.get(dv.tIn);
      if (qr !== null && qi !== null && qr > qi) add('TRONCO_MENOR_QUE_RAMAL', 'AVISO', [dv.ramal, dv.tIn], `El ramal ${dv.ramal} lleva más aire (${n(qr)} m³/h) que el tronco ${dv.tIn} (${n(qi)} m³/h): conviene que el ramal sea el tronco.`);
    });
    rig.forEach((x) => {
      if (g.tipo.get(x.a) === 'DERIVACION' && g.tipo.get(x.b) === 'DERIVACION' && g.neta.get(x.id) >= -1e-3 && g.neta.get(x.id) < pol.distancia_min_entre_derivaciones_D * D(x) - 1e-6) {
        add('DERIVACIONES_CERCANAS', 'AVISO', [x.id, x.a, x.b], `Entre las derivaciones de ${x.a} y ${x.b} quedan ${n(g.neta.get(x.id))} mm; conviene ${n(pol.distancia_min_entre_derivaciones_D * D(x))} mm.`);
      }
    });
    g.piezas.forEach((pz) => {
      const rel = pz.tipo === 'REDUCCION' || pz.tipo === 'ADAPTADOR' ? pz.D2 / pz.D1 : pz.tipo === 'REDUCCION_INJERTO' ? Math.min(...pz.conexiones.slice(0, 2).map((c) => c.diametro_in)) / Math.max(...pz.conexiones.slice(0, 2).map((c) => c.diametro_in)) : null;
      if (rel !== null && rel < pol.relacion_reduccion_min - 1e-9) add('REDUCCION_BRUSCA', 'AVISO', [idPieza(pz), pz.nodo], `La reducción de ${pz.nodo} pasa de ${pulgadas(pz.D1 || Math.max(...pz.conexiones.map((c) => c.diametro_in)))} a menos de la mitad.`);
      if (pz.tipo === 'T_90') add('T_90_ALTA_PERDIDA', 'AVISO', [idPieza(pz), pz.nodo], `La T a 90° de ${pz.nodo} pierde más que un injerto, y COTIZAP todavía no la cotiza (sus injertos van a ${lista(pol.angulos_injerto_deg.map((a) => `${a}°`))}).`);
    });
    t.tramos.filter(flexible).forEach((x) => {
      const r = g.mang.get(x.id);
      if (!r) return;
      const pid = g.puertoDeNodo.get(x.a);
      if (r.larga) add('MANGUERA_LARGA', 'AVISO', [x.id, pid], `La manguera ${x.id} mide ${n(r.largo_mm)} mm (máximo ${n(pol.manguera.largo_max_mm)}).`, 'Acerque el ducto rígido a la toma.');
      if (r.torcida) add('MANGUERA_TORCIDA', 'AVISO', [x.id, pid], `La manguera ${x.id} no queda en un plano.`);
      const pts = puntosManguera(r.entrada, r);
      const propio = equipoDeNodo.get(x.a);
      t.equipos.forEach((e) => {
        if (e.id === propio) return;
        let dmin = Infinity;
        for (let i = 1; i < pts.length; i += 1) dmin = Math.min(dmin, distanciaCaja(pts[i - 1], pts[i], e));
        if (dmin < D(x) / 2 + pol.holgura_min_mm - 1e-6) add('CHOQUE_MANGUERA', 'AVISO', [x.id, e.id], `La manguera ${x.id} pasa a ${n(dmin)} mm de ${e.nombre}.`);
      });
    });
    t.nodos.forEach((x) => {
      if (g.tipo.get(x.id) === 'EXTREMO' && g.ady.get(x.id).length === 1) add('EXTREMO_ABIERTO', 'AVISO', [x.id], `El extremo ${x.id} queda abierto.`, 'Llévelo a un equipo o tápelo.');
    });
    t.equipos.forEach((e) => { if (!e.puertos.length) add('EQUIPO_SIN_PUERTOS', 'AVISO', [e.id], `${e.nombre} (${e.id}) no tiene tomas ni bocas.`, 'Agregue sus tomas o quítelo.'); });
    // INFO
    g.piezas.filter((pz) => pz.tipo === 'ADAPTADOR').forEach((pz) => add('ADAPTADOR_INSERTADO', 'INFO', [idPieza(pz), pz.nodo], `Adaptador de ${pulgadas(pz.D_puerto)} a ${pulgadas(pz.conexiones[0].diametro_in)} en ${pz.nodo}.`));
    t.tramos.filter(flexible).forEach((x) => { const r = g.mang.get(x.id); if (r && r.posible) out.push(infoManguera(r, x.id, g.puertoDeNodo.get(x.a))); });
    return out.map((v, i) => ({ v, i })).sort((a, b) => SEVERIDADES.indexOf(a.v.severidad) - SEVERIDADES.indexOf(b.v.severidad) || a.i - b.i).map(({ v }) => v);
  }

  /* ------------------------------------------------------------------ correcciones (§1.4 paso 3, §2.11 «Corrección») */

  /** Las operaciones con las que se arregla un problema: las mismas del trazo, por nombre y sin (t0, M). */
  const OPERACIONES = {
    cambiarDiametro, cambiarLargo, moverSegmento, moverEquipo, conectar, acoplarBrida, acoplarManguera, decidirCorto, agregarPuerto, quitarEquipo,
    aplicarDimensiones, editarPuerto,
  };
  const claveProblema = (p) => `${p.codigo}|${[...p.elementos].sort().join(',')}`;
  const esMalo = (v) => v.severidad === 'ERROR' || v.severidad === 'BLOQUEANTE';
  const CORREGIBLES = ['VELOCIDAD_BAJA', 'VELOCIDAD_ALTA', 'ACCESORIOS_NO_CABEN', 'TRAMO_CORTO', 'DERIVACION_CERCA_DE_CODO', 'DERIVACIONES_CERCANAS', 'ALTURA_LIBRE',
    'CHOQUE_DUCTOS', 'CHOQUE_EQUIPO', 'EQUIPOS_ENCIMADOS', 'SUBRED_SIN_COLECTOR', 'TOMA_SIN_CONEXION', 'EXTREMO_ABIERTO', 'EQUIPO_SIN_PUERTOS'];

  /**
   * Los arreglos automáticos de un problema de `revisar` (la columna «Corrección» de §2.11), ya probados: cada uno se aplica
   * a una copia del trazo y sólo se ofrece si el modelo lo acepta, si el problema desaparece y si no deja más errores de los
   * que había. Devuelve hasta opciones.max (3) arreglos { codigo, texto, op, args }; `corregir` aplica uno.
   *
   * VELOCIDAD_*: el Ø que pide el caudal (en cadena, §2.6) o dimensionar todo. ACCESORIOS_NO_CABEN y las distancias de las
   * derivaciones: alargar el tramo. TRAMO_CORTO: pegar las piezas, alargar o aceptarlo. ALTURA_LIBRE: subir el segmento.
   * CHOQUE_*: mover un segmento lo justo. EQUIPOS_ENCIMADOS: separar un equipo. SUBRED_SIN_COLECTOR, TOMA_SIN_CONEXION y
   * EXTREMO_ABIERTO: conectar con el imán (a la boca o al tronco, o del extremo a una toma libre) o acoplar la toma.
   * EQUIPO_SIN_PUERTOS: agregar su toma o quitarlo.
   */
  function correcciones(t, M, problema, opciones) {
    const o = esObjeto(opciones) ? opciones : {};
    const max = Number.isInteger(o.max) && o.max > 0 ? Math.min(o.max, 6) : 3;
    dato(esObjeto(problema) && typeof problema.codigo === 'string' && Array.isArray(problema.elementos), 'Falta el problema.');
    if (!CORREGIBLES.includes(problema.codigo)) return [];
    const g = calcular(t, M);
    const pol = t.politicas;
    const k = claveProblema(problema);
    const antes = revisar(t, M, g);
    if (!antes.some((v) => claveProblema(v) === k)) return [];
    const malosAntes = antes.filter(esMalo).length - (esMalo(problema) ? 1 : 0);
    const out = [];
    const vistos = new Set();
    const probar = (texto, op, args, permitir) => {
      if (out.length >= max) return false;
      const clave = JSON.stringify([op, args]);
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      let m;
      try { m = OPERACIONES[op](t, M, ...clonar(args)); } catch (e) { if (e instanceof TrazadoError) return false; throw e; }
      const vals = revisar(m, M);
      if (vals.some((v) => claveProblema(v) === k)) return false;
      if (vals.filter((v) => esMalo(v) && !(permitir && permitir(v, m))).length > malosAntes) return false;
      out.push({ codigo: problema.codigo, texto: typeof texto === 'function' ? texto(m) : texto, op, args: clonar(args) });
      return true;
    };
    const [e0] = problema.elementos;
    const tr = g.tramos.get(e0) || null;
    const Lde = (id) => g.seg.get(id).L;
    // el largo a ejes con el que el tramo queda con `recto` mm de neto, al paso
    const largoPara = (id, recto) => Math.ceil((Lde(id) - g.neta.get(id) + recto - 1e-6) / pol.paso_largo_mm) * pol.paso_largo_mm;
    const alargar = (id, recto) => {
      const Ln = largoPara(id, recto);
      if (Ln > Lde(id) + 1e-6) probar(`Alargar ${id} a ${metros(Ln)}.`, 'cambiarLargo', [id, Ln]);
    };
    // las direcciones en que se puede mover un segmento: las de sus vecinos perpendiculares a él, en los dos sentidos
    const direccionesDeMover = (id) => {
      const x = g.tramos.get(id);
      const u = g.seg.get(id).u;
      const ds = [];
      [x.a, x.b].forEach((nid) => g.ady.get(nid).forEach(({ tramo }) => {
        if (tramo.id === id || !rigido(tramo)) return;
        const d = g.fuera(tramo, nid);
        if (Math.abs(punto(d, u)) > 1e-9) return;
        [d, por(d, -1)].forEach((w) => { if (!ds.some((q) => norma(resta(q, w)) < 1e-9)) ds.push(w); });
      }));
      return ds;
    };
    const textoMover = (w) => { const d = direccionDeVector(w); return d ? (d.elevacion_deg === 90 ? 'hacia arriba' : d.elevacion_deg === -90 ? 'hacia abajo' : `hacia ${textoDireccion(d)}`) : ''; };
    // conectar con el imán: de cada arranque a los objetivos más cercanos (bocas libres, tronco que llega a un colector o tomas libres)
    const conectarCon = (arranques, objetivos) => {
      const lista0 = [];
      arranques.forEach((a) => objetivos.forEach((ob) => {
        const P0 = g.pos.get(a);
        const d = ob.nodo !== undefined ? norma(resta(g.pos.get(ob.nodo), P0)) : CAD.distanciaSegmentos(P0, P0, g.pos.get(g.tramos.get(ob.tramo).a), g.pos.get(g.tramos.get(ob.tramo).b));
        lista0.push({ a, ob, d });
      }));
      lista0.sort((p, q) => p.d - q.d).slice(0, 6).forEach(({ a, ob }) => {
        if (out.length >= Math.min(max, 2)) return;
        let rs = [];
        try { rs = rutas(t, M, a, ob.objetivo, { max: 2 }); } catch (e) { if (!(e instanceof TrazadoError)) throw e; }
        rs.forEach((r) => probar(`Conectar ${ob.nombre(a)}: ${r.texto.charAt(0).toLowerCase()}${r.texto.slice(1)}`, 'conectar', [a, { segmentos: r.segmentos, objetivo: r.objetivo }]));
      });
    };
    const compDe = (nid) => g.comps[g.compDe.get(nid)];
    const haciaColector = (excluir) => {
      const obs = [];
      g.puertos.forEach((pu) => {
        const p = pu.puerto;
        if (p.rol === 'ENTRADA' && p.acople && p.acople.tipo === 'BRIDA' && !g.ady.get(p.nodo).length) obs.push({ nodo: p.nodo, objetivo: { nodo: p.nodo }, nombre: (a) => `${a} a la boca ${p.id}` });
      });
      t.tramos.forEach((x) => {
        if (!rigido(x) || !g.conocido(x.id) || excluir.has(x.id)) return;
        const c = compDe(x.a);
        if (c && c.flujo === 'COLECTOR') obs.push({ tramo: x.id, objetivo: { tramo: x.id }, nombre: (a) => `${a} al tramo ${x.id}` });
      });
      return obs;
    };
    const tomasLibres = () => {
      const obs = [];
      g.puertos.forEach((pu) => {
        const p = pu.puerto;
        if (p.rol !== 'TOMA' || !p.acople) return;
        const nd = p.acople.tipo === 'MANGUERA' ? p.acople.nodo_transicion : p.nodo;
        if (!g.ady.get(nd).some((x) => rigido(x.tramo))) obs.push({ nodo: nd, objetivo: { nodo: nd }, nombre: (a) => `${a} con la toma ${p.id} (${pu.equipo.nombre})` });
      });
      return obs;
    };
    switch (problema.codigo) {
      case 'VELOCIDAD_BAJA':
      case 'VELOCIDAD_ALTA': {
        if (!tr) break;
        const Q = g.Q.get(e0);
        const com = pol.diametros_comerciales_in;
        const ok = com.filter((d) => velocidad(Q, d) >= pol.velocidad_min_m_s - 1e-9);
        const mejor = ok.length ? ok[ok.length - 1] : com[0];
        if (mejor !== tr.diametro_in && rigido(tr)) {
          probar((m) => `Cambiar ${e0} a ${pulgadas(mejor)} (${n(velocidad(Q, mejor), 1)} m/s)${m.ultimo.tramos.length > 1 ? ` y con él ${lista(m.ultimo.tramos.slice(1), 'y')}` : ''}.`, 'cambiarDiametro', [e0, mejor, { cadena: true }]);
        }
        if (mejor !== tr.diametro_in && flexible(tr)) {
          const pid = g.puertoDeNodo.get(tr.a);
          probar(`Cambiar la toma ${pid} y su manguera a ${pulgadas(mejor)} (${n(velocidad(Q, mejor), 1)} m/s).`, 'editarPuerto', [pid, { diametro_in: mejor }]);
        }
        const d = dimensionar(t, M);
        if (d.cambios.length) probar(`Dimensionar todo por caudal (${d.cambios.length} tramo${d.cambios.length > 1 ? 's' : ''}).`, 'aplicarDimensiones', [null]);
        break;
      }
      case 'ACCESORIOS_NO_CABEN':
        if (tr) { alargar(e0, pol.recto_min_entre_accesorios_mm); alargar(e0, 0); }
        break;
      case 'TRAMO_CORTO': {
        const c = tr && cortoDe(t, g, tr);
        if (!c) break;
        if (c.nodos.size === 2) probar(`Pegar ${lista(c.piezas.map((p) => p.id || p.tipo), 'y')} (unión ${unionPegada(M, tr.material) === 'SOLDADA' ? 'soldada' : 'engargolada'}, sin bridas en esas caras).`, 'decidirCorto', [e0, 'PEGAR']);
        alargar(e0, pol.recto_min_entre_accesorios_mm);
        probar(`Aceptar el tramo corto de ${n(Math.max(0, c.neta))} mm, con bridas.`, 'decidirCorto', [e0, 'ACEPTAR']);
        break;
      }
      case 'DERIVACION_CERCA_DE_CODO':
        if (tr) alargar(e0, pol.recto_antes_de_derivacion_D * tr.diametro_in * IN);
        break;
      case 'DERIVACIONES_CERCANAS':
        if (tr) alargar(e0, pol.distancia_min_entre_derivaciones_D * tr.diametro_in * IN);
        break;
      case 'ALTURA_LIBRE': {
        if (!tr) break;
        const fondo = Math.min(g.pos.get(tr.a).z, g.pos.get(tr.b).z) - (tr.diametro_in * IN) / 2;
        const dz = Math.ceil((pol.altura_libre_min_mm - fondo - 1e-6) / pol.paso_largo_mm) * pol.paso_largo_mm;
        if (dz > 0) probar(`Subir ${e0} ${n(dz)} mm (queda a ${n(fondo + dz)} mm del piso).`, 'moverSegmento', [e0, V3(0, 0, dz)]);
        break;
      }
      case 'CHOQUE_DUCTOS':
      case 'CHOQUE_EQUIPO': {
        const tramos = problema.elementos.filter((id) => g.tramos.has(id) && rigido(g.tramos.get(id)));
        const otro = problema.codigo === 'CHOQUE_EQUIPO' ? t.equipos.find((e) => problema.elementos.includes(e.id)) : null;
        tramos.forEach((id) => {
          const x = g.tramos.get(id);
          let falta;
          if (otro) falta = (x.diametro_in * IN) / 2 + pol.holgura_min_mm - distanciaCaja(g.pos.get(x.a), g.pos.get(x.b), otro);
          else {
            const y = g.tramos.get(tramos.find((q) => q !== id) || problema.elementos.find((q) => q !== id));
            falta = y ? ((x.diametro_in + y.diametro_in) * IN) / 2 + pol.holgura_min_mm - CAD.distanciaSegmentos(g.pos.get(x.a), g.pos.get(x.b), g.pos.get(y.a), g.pos.get(y.b)) : pol.paso_largo_mm;
          }
          const k0 = Math.max(1, Math.ceil((falta - 1e-6) / pol.paso_largo_mm));
          const dirs = direccionesDeMover(id);
          const antesDe = out.length;
          for (let kk = k0; kk <= k0 + 10 && out.length === antesDe; kk += 1) {
            for (const w of dirs) {
              const v = r3v(por(w, kk * pol.paso_largo_mm));
              if (probar(`Mover ${id} ${n(kk * pol.paso_largo_mm)} mm ${textoMover(w)}.`, 'moverSegmento', [id, v])) break;
            }
          }
        });
        break;
      }
      case 'EQUIPOS_ENCIMADOS': {
        const es = problema.elementos.map((id) => t.equipos.find((e) => e.id === id)).filter(Boolean);
        if (es.length !== 2) break;
        const opciones0 = [];
        [[es[1], es[0]], [es[0], es[1]]].forEach(([e, fijo]) => [V3(1, 0, 0), V3(-1, 0, 0), V3(0, 1, 0), V3(0, -1, 0)].forEach((d) => {
          for (let kk = 1; kk <= 200; kk += 1) {
            const pos = suma(e.posicion_mm, por(d, kk * PASO_EQUIPO_MM));
            if (!cajasSeEnciman({ ...e, posicion_mm: pos }, fijo, pol.holgura_min_mm)) { opciones0.push({ e, d, kk, pos }); break; }
          }
        }));
        opciones0.sort((a, b) => a.kk - b.kk).forEach(({ e, d, kk, pos }) => probar(`Mover ${e.nombre} ${n(kk * PASO_EQUIPO_MM)} mm hacia ${textoDireccion(direccionDeVector(d))}.`, 'moverEquipo', [e.id, { posicion_mm: r3v(pos) }]));
        break;
      }
      case 'SUBRED_SIN_COLECTOR': {
        if (!tr) break;
        const c = compDe(tr.a);
        const extremos = c.nodos.filter((u) => !g.puertoDeNodo.has(u) && !g.pt.has(u) && g.ady.get(u).length === 1);
        conectarCon(extremos, haciaColector(new Set(c.tramos)));
        break;
      }
      case 'TOMA_SIN_CONEXION': {
        const pu = g.puertos.get(e0);
        if (!pu) break;
        // el paso siguiente de la misma toma (ya acoplada, sin ducto; su manguera sola) no cuenta como error nuevo
        const mismo = (v, m) => (v.codigo === 'TOMA_SIN_CONEXION' && v.elementos[0] === e0)
          || (v.codigo === 'SUBRED_SIN_COLECTOR' && v.elementos.every((id) => m.tramos.some((x) => x.id === id && flexible(x) && x.a === pu.puerto.nodo)));
        if (!pu.puerto.acople) {
          probar(`Acoplar ${e0} con brida (el ducto sale alineado con su cuello).`, 'acoplarBrida', [e0], mismo);
          probar(`Acoplar ${e0} con manguera.`, 'acoplarManguera', [e0, { altura_mm: 500 }], mismo);
          break;
        }
        const nd = problema.elementos[1];
        if (nd && g.pos.has(nd)) conectarCon([nd], haciaColector(new Set()));
        break;
      }
      case 'EXTREMO_ABIERTO': {
        if (!g.pos.has(e0)) break;
        const c = compDe(e0);
        if (c && c.flujo === 'COLECTOR') conectarCon([e0], tomasLibres());
        else conectarCon([e0], haciaColector(new Set(c ? c.tramos : [])));
        break;
      }
      case 'EQUIPO_SIN_PUERTOS': {
        const e = t.equipos.find((x) => x.id === e0);
        if (!e) break;
        const rol = e.tipo === 'COLECTOR' || e.tipo === 'VENTILADOR' ? 'ENTRADA' : 'TOMA';
        const D = pol.diametros_comerciales_in.includes(6) ? 6 : pol.diametros_comerciales_in[0];
        const nuevos = (v) => v.codigo === 'TOMA_SIN_CONEXION' || v.codigo === 'TOMA_SIN_DATOS';
        probar(`Agregar ${rol === 'ENTRADA' ? 'una boca' : 'una toma'} de ${pulgadas(D)} arriba de ${e.nombre}.`, 'agregarPuerto', [e.id, { rol, posicion_local_mm: V3(0, 0, e.caja_mm.alto), diametro_in: D }], nuevos);
        probar(`Quitar ${e.nombre}.`, 'quitarEquipo', [e.id]);
        break;
      }
      default:
    }
    return out;
  }
  /** Aplica un arreglo de `correcciones`. */
  function corregir(t0, M, c) {
    dato(esObjeto(c) && typeof c.op === 'string' && Object.prototype.hasOwnProperty.call(OPERACIONES, c.op) && Array.isArray(c.args), 'La corrección no es válida.');
    const m = OPERACIONES[c.op](t0, M, ...clonar(c.args));
    m.ultimo = { ...m.ultimo, operacion: 'corregir', correccion: c.op };
    return m;
  }

  /* ------------------------------------------------------------------ exportar e importar (§3) */

  /**
   * El JSON del sistema (docs/trazado-isometrico.schema.json). No se exporta con algo BLOQUEANTE o un ERROR (§1.4) salvo
   * con borrador: true (las tomas sin acople salen sin conexión y una red sin colector, en el sentido provisional o el del trazo).
   */
  function aSistema(t, M, opciones) {
    const g = calcular(t, M);
    const vals = revisar(t, M, g);
    const malos = vals.filter((v) => v.severidad === 'BLOQUEANTE' || v.severidad === 'ERROR');
    if (malos.length && !(opciones && opciones.borrador)) falla('NO_EXPORTABLE', `No se puede exportar mientras haya ${malos.length} problema${malos.length > 1 ? 's' : ''}: ${malos[0].mensaje}`, malos[0].elementos);
    const pr = t.proyecto;
    const calc = aire(pr.aire.temperatura_C, pr.aire.altitud_m);
    const pz = new Map(g.piezas.map((x) => [x, x.id]));
    const tramosOrd = [...t.tramos].sort((a, b) => (a.id < b.id ? -1 : 1));
    const sistema = {
      version: '1.0',
      proyecto: {
        id: pr.id, nombre: pr.nombre, servicio: pr.servicio, material_transportado: pr.material_transportado,
        aire: { temperatura_C: pr.aire.temperatura_C, altitud_m: pr.aire.altitud_m, presion_Pa: pr.aire.presion_Pa === null ? calc.presion_Pa : pr.aire.presion_Pa,
          densidad_kg_m3: pr.aire.densidad_kg_m3 === null ? calc.densidad_kg_m3 : pr.aire.densidad_kg_m3, viscosidad_Pa_s: pr.aire.viscosidad_Pa_s === null ? calc.viscosidad_Pa_s : pr.aire.viscosidad_Pa_s },
        unidades: { longitud: 'mm', diametro: pr.diametro_unidad, caudal: 'm3/h', presion: 'Pa', velocidad: 'm/s' }, ejes: 'X_ESTE_Y_NORTE_Z_ARRIBA', origen: pr.origen, vista_iso: pr.vista_iso,
      },
      politicas: clonar(t.politicas),
      equipos: t.equipos.map((e) => ({
        id: e.id, tipo: e.tipo, nombre: e.nombre, posicion_mm: r3v(e.posicion_mm), rotacion_z_deg: e.rotacion_z_deg, caja_mm: { ...e.caja_mm }, perdida_Pa: e.perdida_Pa,
        puertos: e.puertos.map((p) => {
          const ub = ubicarPuerto(e, p);
          const ac = p.acople;
          const adap = g.piezas.find((x) => x.tipo === 'ADAPTADOR' && x.nodo === (ac && ac.tipo === 'MANGUERA' ? ac.nodo_transicion : p.nodo));
          return {
            id: p.id, rol: p.rol, nombre: p.nombre, posicion_local_mm: r3v(p.posicion_local_mm), direccion_local: { ...p.direccion_local }, posicion_mm: ub.posicion_mm, direccion: ub.direccion,
            diametro_in: p.diametro_in, caudal_m3_h: p.caudal_m3_h, coef_entrada_K: p.coef_entrada_K, nodo: p.nodo,
            conexion: !ac ? null : ac.tipo === 'BRIDA' ? { tipo: 'BRIDA', nodo_transicion: null, tramo_flexible: null, adaptador: adap ? adap.id : null, barrenos: ac.barrenos ? { ...ac.barrenos } : null }
              : { tipo: 'MANGUERA', nodo_transicion: ac.nodo_transicion, tramo_flexible: ac.tramo_flexible, adaptador: adap ? adap.id : null, barrenos: null },
          };
        }),
      })),
      nodos: [...t.nodos].sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => ({
        id: x.id, tipo: g.tipo.get(x.id) || 'EXTREMO', posicion_mm: r3v(x.posicion_mm), puerto: x.puerto || null,
        accesorios: (g.piezasDe.get(x.id) || []).map((p) => pz.get(p)).filter(Boolean).sort(), tramos: g.ady.get(x.id).map((a) => a.tramo.id).sort(),
      })),
      tramos: tramosOrd.map((x) => {
        const arriba = g.arriba.get(x.id) || x.a;
        const abajo = g.abajo.get(x.id) || x.b;
        const L = rigido(x) ? g.seg.get(x.id).L : (g.mang.get(x.id) || { largo_mm: 0 }).largo_mm;
        const r = g.mang.get(x.id);
        const pegada = rigido(x) && x.corto === 'PEGAR' ? unionPegada(M, x.material) : null;
        const uniones = pegada ? { aguas_arriba: pegada, aguas_abajo: pegada } : rigido(x) ? { aguas_arriba: union(g, arriba), aguas_abajo: union(g, abajo) } : { aguas_arriba: 'ABRAZADERA', aguas_abajo: 'ABRAZADERA' };
        return {
          id: x.id, tipo: x.tipo, nodo_aguas_arriba: arriba, nodo_aguas_abajo: abajo, direccion: rigido(x) ? direccionDeVector(resta(g.pos.get(abajo), g.pos.get(arriba))) : null,
          longitud_ejes_mm: r3(L), descuentos: g.ocupa.get(x.id).map((o) => ({ accesorio: pz.get(o.pieza), mm: r3(o.mm) })), longitud_neta_mm: r3(g.neta.get(x.id)),
          diametro_in: x.diametro_in, diametro_interior_mm: r3(x.diametro_in * IN), diametro_bloqueado: x.diametro_bloqueado, material: x.material, calibre: x.calibre,
          rugosidad_mm: rigido(x) ? t.politicas.rugosidad_mm[x.material] : t.politicas.manguera.rugosidad_mm, uniones,
          flexible: r ? { forma: r.forma, radio_mm: r.radio_mm === null ? null : r3(r.radio_mm), angulo_curva_deg: r.angulo_curva_deg === null ? null : r3(r.angulo_curva_deg), curvas: r.curvas, desvio_mm: r3(r.desvio_mm),
            altura_mm: r3(r.altura_mm), tramo_recto_mm: r3(r.tramo_recto_mm), puno_mm: r.puno_mm, normal_plano: r.normal_plano ? r4v(r.normal_plano) : null } : null,
          caudal_m3_h: g.Q.get(x.id), velocidad_m_s: g.v.get(x.id) === null ? null : r3(g.v.get(x.id)),
        };
      }),
      accesorios: g.piezas.filter((p) => p.id).sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => ({
        id: p.id, tipo: p.tipo, nodo: p.nodo, conexiones: p.conexiones.map((c) => ({ ...c })),
        geometria: { ...p.geometria, radio_eje_mm: p.geometria.radio_eje_mm === null ? null : r3(p.geometria.radio_eje_mm), tangente_mm: p.geometria.tangente_mm === null ? null : r3(p.geometria.tangente_mm),
          normal_plano: p.geometria.normal_plano ? r4v(p.geometria.normal_plano) : null, giro_entrada_deg: p.geometria.giro_entrada_deg === null ? null : r3(p.geometria.giro_entrada_deg),
          semiangulo_deg: p.geometria.semiangulo_deg === null ? null : r3(p.geometria.semiangulo_deg), largo_mm: p.geometria.largo_mm === null ? null : r3(p.geometria.largo_mm),
          largo_ramal_mm: p.geometria.largo_ramal_mm === null ? null : r3(p.geometria.largo_ramal_mm) },
        perdida: { ...(p.perdida || perdidaReduccion(true)) }, familia_cotizap: p.familia_cotizap,
      })),
      validaciones: vals.map((v) => ({ codigo: v.codigo, severidad: v.severidad, elementos: v.elementos.filter((e) => /^(EQ|PU|N|TR|CO|RE|AD|IN|RI|PA|TE|CP)-[0-9]{2,4}$/.test(e)), mensaje: v.mensaje, sugerencia: v.sugerencia })),
      resultados: null,
    };
    return sistema;
  }
  /** Cómo termina un tramo rígido en un nodo: contra la brida de un equipo, liso para la manguera, abierto o con brida. */
  function union(g, nid) {
    const pid = g.puertoDeNodo.get(nid);
    if (pid) return 'BRIDA_EQUIPO';
    if (g.pt.has(nid)) return 'LISA';
    if (g.ady.get(nid).length === 1) return 'ABIERTA';
    return 'BRIDA';
  }

  /** Lee el JSON de un sistema (el de aSistema o uno equivalente) y lo convierte en un trazo editable. Devuelve { modelo, errores }. */
  function desdeSistema(s, M) {
    try {
      dato(esObjeto(s) && s.version === '1.0' && esObjeto(s.proyecto) && esObjeto(s.politicas) && Array.isArray(s.equipos) && Array.isArray(s.nodos) && Array.isArray(s.tramos) && Array.isArray(s.accesorios), 'No es un sistema de trazado isométrico 1.0.');
      dato(s.tramos.length <= MAX_TRAMOS && s.nodos.length <= MAX_NODOS && s.equipos.length <= MAX_EQUIPOS, 'El sistema es demasiado grande.');
      const pr = s.proyecto;
      const m = nuevo(M, { proyecto: { id: pr.id, nombre: pr.nombre, servicio: pr.servicio, material_transportado: pr.material_transportado, aire: { temperatura_C: pr.aire && pr.aire.temperatura_C, altitud_m: pr.aire && pr.aire.altitud_m }, origen: pr.origen, vista_iso: pr.vista_iso, diametro_unidad: pr.unidades && pr.unidades.diametro } });
      const calc = aire(m.proyecto.aire.temperatura_C, m.proyecto.aire.altitud_m);
      ['presion_Pa', 'densidad_kg_m3', 'viscosidad_Pa_s'].forEach((k) => {
        const v = pr.aire[k];
        dato(finito(v) && v > 0, `El aire no trae ${k}.`);
        if (Math.abs(v - calc[k]) > Math.abs(calc[k]) * 1e-9) m.proyecto.aire[k] = v;
      });
      m.politicas = validarPoliticas(s.politicas);
      const reId = { EQ: /^EQ-\d{2,3}$/, PU: /^PU-\d{2,3}$/, N: /^N-\d{3,4}$/, TR: /^TR-\d{3,4}$/, AC: /^(CO|RE|AD|IN|RI|PA|TE|CP)-\d{3,4}$/ };
      const vistos = new Set();
      const unico = (id, re, que) => { dato(typeof id === 'string' && re.test(id) && !vistos.has(id), `${que} sin identificador válido (${String(id)}).`); vistos.add(id); return id; };
      const conCompuerta = new Set(s.accesorios.filter((a) => esObjeto(a) && a.tipo === 'COMPUERTA').map((a) => a.nodo));
      s.nodos.forEach((x) => {
        unico(x.id, reId.N, 'Un nodo');
        m.nodos.push({ id: x.id, posicion_mm: coordenada(x.posicion_mm, `El nodo ${x.id}`), puerto: null, ancla: x.tipo === 'UNION' && Array.isArray(x.accesorios) && !x.accesorios.length, ...(conCompuerta.has(x.id) ? { compuerta: true } : {}) });
      });
      const nodos = new Set(m.nodos.map((x) => x.id));
      const materiales = new Map();
      s.tramos.forEach((x) => {
        unico(x.id, reId.TR, 'Un tramo');
        dato(nodos.has(x.nodo_aguas_arriba) && nodos.has(x.nodo_aguas_abajo) && x.nodo_aguas_arriba !== x.nodo_aguas_abajo, `El tramo ${x.id} no une dos nodos del sistema.`);
        dato(x.tipo === 'RIGIDO' || x.tipo === 'FLEXIBLE', `El tramo ${x.id} es RIGIDO o FLEXIBLE.`);
        diametroValido(m, x.diametro_in, `El tramo ${x.id}`);
        if (x.tipo === 'RIGIDO') {
          dato(MATERIALES.includes(x.material) && Number.isInteger(x.calibre) && (M.calibres[M.materiales[x.material].tabla_calibre] || {})[String(x.calibre)] !== undefined, `El tramo ${x.id} no trae material y calibre válidos.`);
          const k = `${x.material}|${x.calibre}`;
          materiales.set(k, (materiales.get(k) || 0) + 1);
        }
        const un = esObjeto(x.uniones) ? x.uniones : {};
        const pegado = x.tipo === 'RIGIDO' && ['SOLDADA', 'ENGARGOLADA'].includes(un.aguas_arriba) && un.aguas_arriba === un.aguas_abajo;
        const aceptado = x.tipo === 'RIGIDO' && Array.isArray(s.validaciones) && s.validaciones.some((v) => esObjeto(v) && v.codigo === 'TRAMO_CORTO_ACEPTADO' && Array.isArray(v.elementos) && v.elementos[0] === x.id);
        m.tramos.push({ id: x.id, tipo: x.tipo, a: x.nodo_aguas_arriba, b: x.nodo_aguas_abajo, diametro_in: x.diametro_in, diametro_bloqueado: x.diametro_bloqueado === true, material: x.tipo === 'RIGIDO' ? x.material : 'MANGUERA', calibre: x.tipo === 'RIGIDO' ? x.calibre : null,
          ...(pegado ? { corto: 'PEGAR' } : aceptado ? { corto: 'ACEPTAR' } : {}) });
      });
      if (materiales.size) { const [k] = [...materiales.entries()].sort((a, b) => b[1] - a[1])[0]; const [mat, cal] = k.split('|'); m.material = { material: mat, calibre: Number(cal) }; }
      s.equipos.forEach((e) => {
        unico(e.id, reId.EQ, 'Un equipo');
        dato(TIPOS_EQUIPO.includes(e.tipo) && Array.isArray(e.puertos) && e.puertos.length <= MAX_PUERTOS, `El equipo ${e.id} no es válido.`);
        const eq = { id: e.id, tipo: e.tipo, nombre: texto(e.nombre, NOMBRE_EQUIPO[e.tipo], 60), posicion_mm: coordenada(e.posicion_mm, `El equipo ${e.id}`), rotacion_z_deg: giroValido(e.rotacion_z_deg), caja_mm: cajaValida(e.caja_mm),
          perdida_Pa: finito(e.perdida_Pa) && e.perdida_Pa >= 0 ? e.perdida_Pa : null, puertos: [] };
        e.puertos.forEach((p) => {
          unico(p.id, reId.PU, 'Un puerto');
          dato(['TOMA', 'ENTRADA', 'SALIDA'].includes(p.rol) && nodos.has(p.nodo), `El puerto ${p.id} no es válido.`);
          const local = coordenada(p.posicion_local_mm, `El puerto ${p.id}`);
          dato(carasEn(eq.caja_mm, local).length > 0, `El puerto ${p.id} no está sobre la caja de ${e.id}.`);
          const c = p.conexion;
          let acople = null;
          if (c && c.tipo === 'BRIDA') acople = { tipo: 'BRIDA', barrenos: barrenosValidos(c.barrenos === undefined ? null : c.barrenos) };
          else if (c && c.tipo === 'MANGUERA') {
            dato(nodos.has(c.nodo_transicion) && s.tramos.some((x) => x.id === c.tramo_flexible && x.tipo === 'FLEXIBLE'), `La manguera del puerto ${p.id} no es válida.`);
            const sale = s.tramos.find((x) => x.tipo === 'RIGIDO' && (x.nodo_aguas_arriba === c.nodo_transicion || x.nodo_aguas_abajo === c.nodo_transicion));
            const P = (id) => m.nodos.find((y) => y.id === id).posicion_mm;
            const dpt = sale ? direccionDeVector(sale.nodo_aguas_arriba === c.nodo_transicion ? resta(P(sale.nodo_aguas_abajo), P(c.nodo_transicion)) : resta(P(sale.nodo_aguas_arriba), P(c.nodo_transicion))) : null;
            acople = { tipo: 'MANGUERA', nodo_transicion: c.nodo_transicion, tramo_flexible: c.tramo_flexible, direccion_pt: dpt || direccionValida(p.direccion_local, null, `El puerto ${p.id}`) };
          }
          if (p.rol === 'ENTRADA') dato(acople && acople.tipo === 'BRIDA', `La boca ${p.id} va con brida.`);
          const pp = { id: p.id, rol: p.rol, nombre: texto(p.nombre, 'Puerto', 60), posicion_local_mm: local, direccion_local: direccionValida(p.direccion_local, null, `El puerto ${p.id}`), diametro_in: diametroValido(m, p.diametro_in, `El puerto ${p.id}`),
            caudal_m3_h: p.rol === 'TOMA' && finito(p.caudal_m3_h) && p.caudal_m3_h > 0 ? p.caudal_m3_h : null, coef_entrada_K: p.rol === 'TOMA' && finito(p.coef_entrada_K) && p.coef_entrada_K >= 0 ? p.coef_entrada_K : null, nodo: p.nodo, acople };
          eq.puertos.push(pp);
          const nd = m.nodos.find((y) => y.id === p.nodo);
          dato(!nd.puerto, `El nodo ${p.nodo} es de dos puertos.`);
          nd.puerto = p.id;
          if (acople && acople.tipo === 'MANGUERA') {
            const ub = ubicarPuerto(eq, pp);
            if (!m.tramos.some((x) => rigido(x) && (x.a === acople.nodo_transicion || x.b === acople.nodo_transicion))) acople.direccion_pt = ub.direccion;
          }
        });
        m.equipos.push(eq);
      });
      s.accesorios.forEach((a) => {
        unico(a.id, reId.AC, 'Un accesorio');
        dato(nodos.has(a.nodo) && Object.prototype.hasOwnProperty.call(PREFIJO, a.tipo) && a.id.startsWith(`${PREFIJO[a.tipo]}-`), `El accesorio ${a.id} no es válido.`);
        (m.piezas[a.nodo] = m.piezas[a.nodo] || {})[a.tipo] = a.id;
      });
      const max = (re) => Math.max(0, ...[...vistos].filter((id) => re.test(id)).map(numeroDe));
      m.cuenta = { EQ: max(reId.EQ), PU: max(reId.PU), N: max(reId.N), TR: max(reId.TR) };
      Object.values(PREFIJO).forEach((pf) => { m.cuenta[pf] = max(new RegExp(`^${pf}-`)); });
      // lo que el archivo dice de cada nodo y tramo debe salir de su geometría
      s.nodos.forEach((x) => {
        const propios = m.tramos.filter((tr) => tr.a === x.id || tr.b === x.id).map((tr) => tr.id).sort();
        dato(Array.isArray(x.tramos) && JSON.stringify([...x.tramos].sort()) === JSON.stringify(propios), `El nodo ${x.id} no lista los tramos que llegan a él.`);
      });
      const r = validar(m, M);
      if (!r.modelo) return r;
      const g = calcular(r.modelo, M);
      const piezas = new Map(g.piezas.map((pz) => [pz.id, pz]));
      dato(s.accesorios.length === g.piezas.length && s.accesorios.every((a) => piezas.has(a.id) && piezas.get(a.id).tipo === a.tipo && piezas.get(a.id).nodo === a.nodo), 'Los accesorios del sistema no corresponden con su geometría.');
      s.tramos.forEach((x) => {
        if (g.conocido(x.id)) dato(g.arriba.get(x.id) === x.nodo_aguas_arriba, `El tramo ${x.id} no va en el sentido del aire.`);
        if (x.tipo === 'RIGIDO') {
          dato(esObjeto(x.direccion) && JSON.stringify(direccionDeVector(resta(g.pos.get(x.nodo_aguas_abajo), g.pos.get(x.nodo_aguas_arriba)))) === JSON.stringify({ azimut_deg: x.direccion.azimut_deg, elevacion_deg: x.direccion.elevacion_deg }), `La dirección del tramo ${x.id} no es la de sus nodos.`);
          dato(finito(x.longitud_ejes_mm) && Math.abs(x.longitud_ejes_mm - g.seg.get(x.id).L) <= TOL_DIR_MM, `El largo del tramo ${x.id} no es la distancia entre sus nodos.`);
        }
      });
      return r;
    } catch (e) {
      if (e instanceof TrazadoError) return { modelo: null, errores: [e.message] };
      throw e;
    }
  }

  /**
   * Un trazo que viene de fuera (la cotización guardada o desdeSistema): la forma, las referencias, los límites y que no
   * tenga nada BLOQUEANTE. Devuelve { modelo, errores }; modelo null si no sirve.
   */
  function validar(x, M) {
    try {
      dato(esObjeto(x) && x.version === VERSION && Array.isArray(x.nodos) && Array.isArray(x.tramos) && Array.isArray(x.equipos) && esObjeto(x.cuenta) && esObjeto(x.proyecto), 'No es un trazo isométrico de esta versión.');
      dato(x.tramos.length <= MAX_TRAMOS && x.nodos.length <= MAX_NODOS && x.equipos.length <= MAX_EQUIPOS, 'El trazo es demasiado grande.');
      const m = nuevo(M, { proyecto: { id: x.proyecto.id, nombre: x.proyecto.nombre, servicio: x.proyecto.servicio, material_transportado: x.proyecto.material_transportado === undefined ? null : x.proyecto.material_transportado,
        aire: x.proyecto.aire, diametro_unidad: x.proyecto.diametro_unidad, origen: x.proyecto.origen, vista_iso: x.proyecto.vista_iso } });
      m.politicas = validarPoliticas(x.politicas);
      aplicarMaterial(m, M, x.material && x.material.material, x.material && x.material.calibre);
      const ids = new Set();
      const unico = (id, re, que) => { dato(typeof id === 'string' && re.test(id) && !ids.has(id), `${que} sin identificador válido (${String(id)}).`); ids.add(id); };
      x.nodos.forEach((nd) => {
        dato(esObjeto(nd), 'Un nodo no es válido.');
        unico(nd.id, /^N-\d{3,4}$/, 'Un nodo');
        m.nodos.push({ id: nd.id, posicion_mm: coordenada(nd.posicion_mm, `El nodo ${nd.id}`), puerto: typeof nd.puerto === 'string' ? nd.puerto : null, ancla: nd.ancla === true, ...(nd.compuerta === true ? { compuerta: true } : {}) });
      });
      const nodos = new Set(m.nodos.map((y) => y.id));
      x.tramos.forEach((tr) => {
        dato(esObjeto(tr), 'Un tramo no es válido.');
        unico(tr.id, /^TR-\d{3,4}$/, 'Un tramo');
        dato((tr.tipo === 'RIGIDO' || tr.tipo === 'FLEXIBLE') && nodos.has(tr.a) && nodos.has(tr.b) && tr.a !== tr.b, `El tramo ${tr.id} no une dos nodos del trazo.`);
        diametroValido(m, tr.diametro_in, `El tramo ${tr.id}`);
        if (tr.tipo === 'RIGIDO') dato(MATERIALES.includes(tr.material) && Number.isInteger(tr.calibre) && (M.calibres[M.materiales[tr.material].tabla_calibre] || {})[String(tr.calibre)] !== undefined, `El tramo ${tr.id} no trae material y calibre válidos.`);
        m.tramos.push({ id: tr.id, tipo: tr.tipo, a: tr.a, b: tr.b, diametro_in: tr.diametro_in, diametro_bloqueado: tr.diametro_bloqueado === true, material: tr.tipo === 'RIGIDO' ? tr.material : 'MANGUERA', calibre: tr.tipo === 'RIGIDO' ? tr.calibre : null,
          ...(tr.tipo === 'RIGIDO' && (tr.corto === 'PEGAR' || tr.corto === 'ACEPTAR') ? { corto: tr.corto } : {}) });
      });
      const tramos = new Set(m.tramos.map((y) => y.id));
      const puertosDe = new Map();
      x.equipos.forEach((e) => {
        dato(esObjeto(e) && TIPOS_EQUIPO.includes(e.tipo) && Array.isArray(e.puertos) && e.puertos.length <= MAX_PUERTOS, 'Un equipo no es válido.');
        unico(e.id, /^EQ-\d{2,3}$/, 'Un equipo');
        const eq = { id: e.id, tipo: e.tipo, nombre: texto(e.nombre, NOMBRE_EQUIPO[e.tipo], 60), posicion_mm: coordenada(e.posicion_mm, `El equipo ${e.id}`), rotacion_z_deg: giroValido(e.rotacion_z_deg), caja_mm: cajaValida(e.caja_mm),
          perdida_Pa: finito(e.perdida_Pa) && e.perdida_Pa >= 0 && e.perdida_Pa <= 100000 ? e.perdida_Pa : null, puertos: [] };
        dato(eq.posicion_mm.z >= 0, `El equipo ${e.id} está bajo el piso.`);
        e.puertos.forEach((p) => {
          dato(esObjeto(p) && ['TOMA', 'ENTRADA', 'SALIDA'].includes(p.rol) && nodos.has(p.nodo), 'Un puerto no es válido.');
          unico(p.id, /^PU-\d{2,3}$/, 'Un puerto');
          const local = coordenada(p.posicion_local_mm, `El puerto ${p.id}`);
          const caras = carasEn(eq.caja_mm, local);
          const dl = direccionValida(p.direccion_local, null, `El puerto ${p.id}`);
          dato(caras.some((c) => punto(vectorDe(dl), c) > 1e-9), `El puerto ${p.id} no está sobre la caja apuntando hacia fuera.`);
          let ac = null;
          if (esObjeto(p.acople) && p.acople.tipo === 'BRIDA') ac = { tipo: 'BRIDA', barrenos: barrenosValidos(p.acople.barrenos === undefined ? null : p.acople.barrenos) };
          else if (esObjeto(p.acople) && p.acople.tipo === 'MANGUERA') {
            dato(nodos.has(p.acople.nodo_transicion) && tramos.has(p.acople.tramo_flexible), `La manguera del puerto ${p.id} no es válida.`);
            ac = { tipo: 'MANGUERA', nodo_transicion: p.acople.nodo_transicion, tramo_flexible: p.acople.tramo_flexible, direccion_pt: direccionValida(p.acople.direccion_pt, null, `El punto de transición de ${p.id}`) };
          } else dato(p.acople === null || p.acople === undefined, `El acople del puerto ${p.id} no es válido.`);
          if (p.rol === 'ENTRADA') dato(ac && ac.tipo === 'BRIDA', `La boca ${p.id} va con brida.`);
          const Q = p.caudal_m3_h;
          const K = p.coef_entrada_K;
          eq.puertos.push({ id: p.id, rol: p.rol, nombre: texto(p.nombre, 'Puerto', 60), posicion_local_mm: local, direccion_local: dl, diametro_in: diametroValido(m, p.diametro_in, `El puerto ${p.id}`),
            caudal_m3_h: p.rol === 'TOMA' && finito(Q) && Q > 0 && Q <= 1e6 ? Q : null, coef_entrada_K: p.rol === 'TOMA' ? (finito(K) && K >= 0 && K <= 10 ? K : 0.5) : null, nodo: p.nodo, acople: ac });
          puertosDe.set(p.id, p.nodo);
        });
        m.equipos.push(eq);
      });
      m.nodos.forEach((nd) => { if (nd.puerto) dato(puertosDe.get(nd.puerto) === nd.id, `El nodo ${nd.id} dice ser del puerto ${nd.puerto}, que no está ahí.`); });
      puertosDe.forEach((nid, pid) => dato(m.nodos.find((y) => y.id === nid).puerto === pid, `El nodo ${nid} del puerto ${pid} no lo lleva.`));
      if (esObjeto(x.piezas)) {
        Object.keys(x.piezas).forEach((nid) => {
          if (!nodos.has(nid) || !esObjeto(x.piezas[nid])) return;
          Object.keys(x.piezas[nid]).forEach((tipo) => {
            const id = x.piezas[nid][tipo];
            if (Object.prototype.hasOwnProperty.call(PREFIJO, tipo) && typeof id === 'string' && new RegExp(`^${PREFIJO[tipo]}-\\d{3,4}$`).test(id) && !ids.has(id)) { ids.add(id); (m.piezas[nid] = m.piezas[nid] || {})[tipo] = id; }
          });
        });
      }
      const k0 = x.cuenta;
      const usado = (re) => Math.max(0, ...[...ids].filter((id) => re.test(id)).map(numeroDe));
      Object.keys(cuentaVacia()).forEach((pf) => {
        const min = usado(new RegExp(`^${pf}-\\d`));
        m.cuenta[pf] = Number.isInteger(k0[pf]) && k0[pf] >= min && k0[pf] < 1e4 ? k0[pf] : min;
      });
      normalizar(m);
      const g = calcular(m, M);
      if (g.problemas.length) return { modelo: null, errores: [...new Set(g.problemas.map((p) => p.mensaje))].slice(0, 12) };
      limpiarDecisiones(m, g);
      asignarPiezas(m, g);
      m.ultimo = null;
      return { modelo: m, errores: [] };
    } catch (e) {
      if (e instanceof TrazadoError) return { modelo: null, errores: [e.message] };
      throw e;
    }
  }

  /**
   * Identificadores limpios, en el orden de la red: los nodos desde cada boca de colector hacia las tomas (el tronco antes
   * que el ramal), los tramos de cada toma hacia el colector y las piezas en el orden de sus nodos. Para entregar el sistema;
   * las respuestas y partidas que usaban los identificadores anteriores dejan de servir.
   */
  function renumerar(t0, M) {
    const m = inicio(t0);
    const g = calcular(m, M);
    const mapaN = new Map();
    const mapaT = new Map();
    const ordenN = [];
    const visitar = (u) => {
      if (mapaN.has(u)) return;
      mapaN.set(u, id3('N', mapaN.size + 1));
      ordenN.push(u);
      const der = g.derivaciones.find((x) => x.nodo === u);
      const entran = g.entran(u).sort((a, b) => (der ? (a.id === der.tIn ? -1 : b.id === der.tIn ? 1 : 0) : 0) || (a.id < b.id ? -1 : 1));
      entran.forEach((x) => visitar(g.arriba.get(x.id)));
    };
    const comps = g.comps.filter((c) => c.sumidero).sort((a, b) => (c0(a) < c0(b) ? -1 : 1));
    function c0(c) { const pid = g.puertoDeNodo.get(c.sumidero); return pid || c.sumidero; }
    comps.forEach((c) => visitar(c.sumidero));
    [...m.nodos].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((x) => { if (!mapaN.has(x.id)) { mapaN.set(x.id, id3('N', mapaN.size + 1)); ordenN.push(x.id); } });
    ordenN.forEach((u) => {
      const pid = g.puertoDeNodo.get(u);
      if (!pid || g.puertos.get(pid).puerto.rol !== 'TOMA') return;
      let v = u;
      while (g.sale.has(v)) { const tid = g.sale.get(v); if (!mapaT.has(tid)) mapaT.set(tid, id3('TR', mapaT.size + 1)); v = g.abajo.get(tid); }
    });
    ordenN.forEach((u) => g.ady.get(u).forEach(({ tramo }) => { if (!mapaT.has(tramo.id)) mapaT.set(tramo.id, id3('TR', mapaT.size + 1)); }));
    const mapaE = new Map(m.equipos.map((e, i) => [e.id, id2('EQ', i + 1)]));
    const mapaP = new Map();
    m.equipos.forEach((e) => e.puertos.forEach((p) => mapaP.set(p.id, id2('PU', mapaP.size + 1))));
    m.equipos.forEach((e) => {
      e.id = mapaE.get(e.id);
      e.puertos.forEach((p) => {
        p.id = mapaP.get(p.id);
        p.nodo = mapaN.get(p.nodo);
        if (p.acople && p.acople.tipo === 'MANGUERA') { p.acople.nodo_transicion = mapaN.get(p.acople.nodo_transicion); p.acople.tramo_flexible = mapaT.get(p.acople.tramo_flexible); }
      });
    });
    m.nodos.forEach((x) => { x.id = mapaN.get(x.id); if (x.puerto) x.puerto = mapaP.get(x.puerto); });
    m.tramos.forEach((x) => { x.id = mapaT.get(x.id); x.a = mapaN.get(x.a); x.b = mapaN.get(x.b); });
    m.nodos.sort((a, b) => (a.id < b.id ? -1 : 1));
    m.tramos.sort((a, b) => (a.id < b.id ? -1 : 1));
    const cuentaP = {};
    const piezas = {};
    const porNodo = new Map();
    g.piezas.forEach((pz) => { const k = mapaN.get(pz.nodo); if (!porNodo.has(k)) porNodo.set(k, []); porNodo.get(k).push(pz.tipo); });
    [...porNodo.keys()].sort().forEach((k) => porNodo.get(k).forEach((tipo) => {
      const pf = PREFIJO[tipo];
      cuentaP[pf] = (cuentaP[pf] || 0) + 1;
      (piezas[k] = piezas[k] || {})[tipo] = id3(pf, cuentaP[pf]);
    }));
    m.piezas = piezas;
    m.cuenta = { ...cuentaVacia(), ...cuentaP, EQ: m.equipos.length, PU: mapaP.size, N: m.nodos.length, TR: m.tramos.length };
    marcar(m, 'renumerar');
    return terminar(m, M);
  }

  /** Lo que el trazo tiene, en números: para un resumen en pantalla. */
  function resumen(t, M) {
    const g = calcular(t, M);
    const cuenta = {};
    g.piezas.forEach((p) => { cuenta[p.tipo] = (cuenta[p.tipo] || 0) + 1; });
    const rig = t.tramos.filter(rigido);
    return {
      equipos: t.equipos.length, tomas: [...g.puertos.values()].filter((p) => p.puerto.rol === 'TOMA').length, tramos: rig.length, mangueras: t.tramos.length - rig.length,
      metros_rigidos: r3(rig.reduce((s, x) => s + g.seg.get(x.id).L, 0) / 1000), metros_netos: r3(rig.reduce((s, x) => s + Math.max(0, g.neta.get(x.id)), 0) / 1000), piezas: cuenta,
      redes: g.comps.filter((c) => c.tramos.length).length,
    };
  }

  return {
    VERSION, IN, LARGO_COMPUERTA_MM, REJILLAS, SERVICIOS, TIPOS_EQUIPO, TrazadoError,
    // geometría
    vectorDe, direccionDeVector, rejilla, textoDireccion, proyectar, rayoDeVista, alPlano, planoHorizontal, planoVertical, aire, politicasDe, validarPoliticas,
    resolverManguera, puntosManguera,
    // modelo
    nuevo, validar, calcular, revisar, resumen, aSistema, desdeSistema, renumerar,
    cambiarProyecto, cambiarPoliticas, cambiarMaterial,
    ponerEquipo, editarEquipo, moverEquipo, quitarEquipo, agregarPuerto, editarPuerto, quitarPuerto,
    acoplarBrida, acoplarManguera, moverTransicion, desacoplar,
    candidatas, textoCandidatas, elegirDireccion, ajustarLargo, trazar, conectar, rutas,
    cambiarLargo, moverSegmento, cambiarAngulo, cambiarDiametro, reducir, decidirCorto, ponerCompuerta, quitarCompuerta, anclar, borrarTramo, dimensionar, aplicarDimensiones,
    CORREGIBLES, correcciones, corregir,
  };
}));
