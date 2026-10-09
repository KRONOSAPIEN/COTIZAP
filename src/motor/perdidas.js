/**
 * COTIZAP · perdidas.js — El cálculo de la red trazada en isométrico (docs/trazado-isometrico.md §3.4; etapa 4 de §5).
 *
 * Lee el JSON del sistema (§3, el que exporta trazado_iso.aSistema) y llena lo que el trazo deja en null: la K de cada
 * accesorio y `resultados`. Sigue el método de presión dinámica con balanceo por diseño del manual Industrial Ventilation
 * de la ACGIH, como una hoja de cálculo con un renglón por tramo, de las tomas al colector:
 *
 *   aire          ρ y μ del proyecto (o de la altitud y la temperatura: atmósfera estándar y Sutherland)
 *   tramo         v = Q/A; pv = ρ·v²/2; Re = ρ·v·D/μ; f de Swamee-Jain; fricción = f·(L neta/D)·pv
 *   toma          succión en la campana = (1 + K)·pv de la toma
 *   locales       el codo al que entra el tramo (K·pv), su entrada de ramal (K_ramal·pv), las curvas de la manguera,
 *                 la expansión o contracción hacia el tramo siguiente, y la aceleración en la confluencia
 *   confluencia   la corriente de menor succión se corrige: Q′ = Q·√(SP mayor / SP menor); el tronco que sigue lleva la
 *                 suma corregida. Relación ≤ 1.05: nada; ≤ 1.20: se acepta el caudal mayor; más: redimensionar o compuerta
 *   ventilador    por colector: el caudal que llega, la succión de la boca más la pérdida del colector, la misma succión
 *                 en aire estándar (1.2 kg/m³, para leer la curva del fabricante), la potencia y el motor comercial
 *
 * Las presiones estáticas se dan como succión (valor absoluto, en Pa). Los coeficientes están juntos en TABLA, con su
 * referencia; el cálculo acepta otra tabla con `opciones.tabla`. Puro: no muta lo que recibe.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.perdidas = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IN = 25.4;
  const RHO_ESTANDAR = 1.2;
  const KW_POR_HP = 0.7457;
  const MOTORES_HP = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500];
  /** Balanceo por diseño (ACGIH): hasta 5 % no se corrige; hasta 20 % se acepta el caudal mayor; más, se rediseña. */
  const UMBRAL_NINGUNA = 1.05;
  const UMBRAL_AJUSTE = 1.2;
  const ACCIONES = ['NINGUNA', 'AJUSTAR_CAUDAL', 'REDIMENSIONAR', 'COMPUERTA'];
  const DEFECTOS = { eficiencia_ventilador: 0.65, eficiencia_transmision: 0.95 };

  /**
   * La tabla de coeficientes. Son los valores de referencia de las tablas del manual Industrial Ventilation de la ACGIH
   * (los codos son los mismos de ASHRAE y SMACNA); antes de usarlos en un proyecto conviene cotejarlos con la edición
   * que se tenga a la mano.
   */
  const TABLA = {
    codo: {
      referencia: 'ACGIH, Industrial Ventilation: codos redondos de 3, 4 y 5 gajos y estampados por R/D; otro ángulo, K·θ/90',
      r_d: [0.5, 0.75, 1, 1.5, 2, 2.5],
      liso: [0.71, 0.33, 0.22, 0.15, 0.13, 0.12],
      gajos: { 3: [0.98, 0.54, 0.42, 0.34, 0.33, 0.33], 4: [null, 0.5, 0.37, 0.27, 0.24, 0.23], 5: [null, 0.46, 0.33, 0.24, 0.19, 0.17] },
      inglete_90: 1.2,
    },
    entrada_ramal: {
      referencia: 'ACGIH, Industrial Ventilation: pérdida de entrada del ramal por su ángulo, sobre la pv del ramal; el paso del tronco va en su fricción',
      angulo_deg: [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 90],
      K: [0.06, 0.09, 0.12, 0.15, 0.18, 0.21, 0.25, 0.28, 0.32, 0.44, 1.0],
    },
    expansion: {
      referencia: 'ACGIH, Industrial Ventilation: recuperación R de la expansión por semiángulo y D₂/D₁; pérdida (1 − R)·(pv₁ − pv₂)',
      semiangulo_deg: [3.5, 5, 10, 15, 20, 25, 30, 90],
      relacion_D: [1.25, 1.5, 1.75, 2, 2.5],
      R: [
        [0.92, 0.88, 0.84, 0.81, 0.75],
        [0.88, 0.84, 0.8, 0.76, 0.68],
        [0.85, 0.76, 0.7, 0.63, 0.53],
        [0.83, 0.7, 0.62, 0.55, 0.43],
        [0.81, 0.67, 0.57, 0.48, 0.36],
        [0.8, 0.65, 0.53, 0.44, 0.28],
        [0.79, 0.63, 0.51, 0.41, 0.25],
        [0.77, 0.62, 0.48, 0.37, 0.22],
      ],
    },
    contraccion: {
      referencia: 'ACGIH, Industrial Ventilation: pérdida de la contracción por semiángulo, L·(pv₂ − pv₁)',
      semiangulo_deg: [5, 10, 15, 20, 25, 30, 45, 60, 90],
      L: [0.05, 0.06, 0.08, 0.1, 0.11, 0.13, 0.2, 0.3, 0.35],
    },
    compuerta: { referencia: 'Compuerta abierta: sin pérdida en el diseño; se usa para ajustar en la obra', K: 0 },
  };

  class CalculoError extends Error {
    constructor(codigo, mensaje, elementos) {
      super(mensaje);
      this.name = 'CalculoError';
      this.codigo = codigo;
      this.elementos = elementos || [];
    }
  }
  const falla = (codigo, mensaje, elementos) => { throw new CalculoError(codigo, mensaje, elementos); };
  const dato = (ok, mensaje, elementos) => { if (!ok) falla('SIN_DATOS', mensaje, elementos); };

  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clonar = (x) => JSON.parse(JSON.stringify(x));
  const redondo = (x, d) => { const k = 10 ** d; const r = Math.round(x * k) / k; return Object.is(r, -0) ? 0 : r; };
  /** Como en los mensajes del trazo: sin separador de miles y sin ceros de más. */
  const num = (x, d) => String(redondo(x, d));

  /* ------------------------------------------------------------------ interpolación */

  /** Interpolación lineal en una tabla (xs crecientes), sin salirse de los extremos; los null no cuentan. */
  function lineal(xs, ys, x) {
    const p = xs.map((v, i) => [v, ys[i]]).filter((q) => q[1] !== null);
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[p.length - 1][0]) return p[p.length - 1][1];
    for (let i = 1; i < p.length; i += 1) {
      if (x <= p[i][0]) {
        const [x0, y0] = p[i - 1];
        const [x1, y1] = p[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return p[p.length - 1][1];
  }

  /** K de un codo de θ grados, radio de eje R/D y n gajos (null: liso o estampado, como las curvas de una manguera). */
  function kCodo(theta, rD, gajos, tabla) {
    const c = (tabla || TABLA).codo;
    if (!(theta > 0)) return 0;
    let k90;
    if (gajos === null || gajos === undefined) k90 = lineal(c.r_d, c.liso, rD);
    else {
      // Los gajos equivalentes a 90°: los mismos grados por junta que este codo (45° de 3 gajos = 90° de 5).
      const n90 = 1 + ((gajos - 1) * 90) / theta;
      const col = (n) => lineal(c.r_d, c.gajos[n], rD);
      if (n90 >= 5) k90 = col(5);
      else if (n90 >= 4) k90 = col(4) + (col(5) - col(4)) * (n90 - 4);
      else if (n90 >= 3) k90 = col(3) + (col(4) - col(3)) * (n90 - 3);
      else k90 = c.inglete_90 + (col(3) - c.inglete_90) * Math.max(0, n90 - 2);
    }
    return (k90 * theta) / 90;
  }

  /** K de la entrada de un ramal a β grados, sobre la pv del ramal. */
  const kRamal = (beta, tabla) => lineal((tabla || TABLA).entrada_ramal.angulo_deg, (tabla || TABLA).entrada_ramal.K, beta);

  /** La recuperación R de una expansión de semiángulo α y relación de diámetros D₂/D₁. */
  function recuperacion(alfa, relD, tabla) {
    const e = (tabla || TABLA).expansion;
    const fila = (i) => lineal(e.relacion_D, e.R[i], relD);
    const a = e.semiangulo_deg;
    if (alfa <= a[0]) return fila(0);
    if (alfa >= a[a.length - 1]) return fila(a.length - 1);
    let i = 1;
    while (alfa > a[i]) i += 1;
    return fila(i - 1) + ((fila(i) - fila(i - 1)) * (alfa - a[i - 1])) / (a[i] - a[i - 1]);
  }

  /** El factor L de una contracción de semiángulo α. */
  const factorContraccion = (alfa, tabla) => lineal((tabla || TABLA).contraccion.semiangulo_deg, (tabla || TABLA).contraccion.L, alfa);

  /**
   * Un cambio de sección en el sentido del aire (de D₁ a D₂, mm) con el semiángulo α: la pérdida en Pa, el cambio de la
   * succión y la K sobre la pv de la sección menor (§3.4).
   */
  function transicion(d1, d2, alfa, pv1, pv2, tabla) {
    if (Math.abs(d1 - d2) < 1e-9) return { modelo: null, perdida: 0, dSP: pv2 - pv1, K: 0 };
    if (d2 > d1) {
      const R = recuperacion(alfa, d2 / d1, tabla);
      const a = (d1 / d2) ** 2;
      return { modelo: 'EXPANSION', perdida: (1 - R) * (pv1 - pv2), dSP: -R * (pv1 - pv2), K: (1 - R) * (1 - a * a), R };
    }
    const L = factorContraccion(alfa, tabla);
    const a = (d2 / d1) ** 2;
    return { modelo: 'CONTRACCION', perdida: L * (pv2 - pv1), dSP: (1 + L) * (pv2 - pv1), K: L * (1 - a * a), L };
  }

  /* ------------------------------------------------------------------ aire y fricción */

  /** ρ y μ del proyecto; lo que falte sale de la altitud y la temperatura (atmósfera estándar, Sutherland). */
  function aireDe(a) {
    dato(esObjeto(a) && finito(a.temperatura_C) && finito(a.altitud_m), 'El proyecto no trae la temperatura y la altitud del aire.');
    const T = a.temperatura_C + 273.15;
    const p = finito(a.presion_Pa) && a.presion_Pa > 0 ? a.presion_Pa : 101325 * (1 - 2.25577e-5 * a.altitud_m) ** 5.25588;
    const rho = finito(a.densidad_kg_m3) && a.densidad_kg_m3 > 0 ? a.densidad_kg_m3 : p / (287.05 * T);
    const mu = finito(a.viscosidad_Pa_s) && a.viscosidad_Pa_s > 0 ? a.viscosidad_Pa_s : (1.458e-6 * T ** 1.5) / (T + 110.4);
    return { presion_Pa: p, densidad_kg_m3: rho, viscosidad_Pa_s: mu };
  }

  const area = (dmm) => (Math.PI * (dmm / 1000) ** 2) / 4;
  const velocidad = (Q, dmm) => Q / 3600 / area(dmm);
  const pvDe = (Q, dmm, rho) => (rho * velocidad(Q, dmm) ** 2) / 2;

  /** Factor de fricción de Darcy: Swamee-Jain en turbulento, 64/Re en laminar. */
  function friccion(Re, eps_mm, dmm) {
    if (Re < 2300) return 64 / Re;
    return 0.25 / Math.log10(eps_mm / (3.7 * dmm) + 5.74 / Re ** 0.9) ** 2;
  }

  /* ------------------------------------------------------------------ la red */

  /** Índices de la red y comprobación de lo que el cálculo necesita. */
  function red(s) {
    dato(esObjeto(s) && esObjeto(s.proyecto) && esObjeto(s.politicas) && Array.isArray(s.equipos) && Array.isArray(s.nodos) && Array.isArray(s.tramos) && Array.isArray(s.accesorios), 'No es un sistema de trazado isométrico.');
    dato(s.tramos.length > 0, 'El sistema no tiene tramos.');
    const T = new Map(s.tramos.map((t) => [t.id, t]));
    const N = new Set(s.nodos.map((n) => n.id));
    const puertos = new Map();
    const puertoEn = new Map();
    s.equipos.forEach((e) => (e.puertos || []).forEach((p) => {
      puertos.set(p.id, { ...p, equipo: e });
      if (p.nodo) puertoEn.set(p.nodo, puertos.get(p.id));
    }));
    const entran = new Map();
    const sale = new Map();
    s.tramos.forEach((t) => {
      dato(N.has(t.nodo_aguas_arriba) && N.has(t.nodo_aguas_abajo), `El tramo ${t.id} va a un nodo que no existe.`, [t.id]);
      dato(finito(t.diametro_interior_mm) && t.diametro_interior_mm > 0 && finito(t.longitud_neta_mm) && t.longitud_neta_mm >= 0 && finito(t.rugosidad_mm) && t.rugosidad_mm >= 0, `Al tramo ${t.id} le faltan su diámetro, su largo neto o su rugosidad.`, [t.id]);
      if (!entran.has(t.nodo_aguas_abajo)) entran.set(t.nodo_aguas_abajo, []);
      entran.get(t.nodo_aguas_abajo).push(t);
      if (sale.has(t.nodo_aguas_arriba)) falla('NO_ES_ARBOL', `Del nodo ${t.nodo_aguas_arriba} salen dos tramos: el aire tiene un solo camino al colector.`, [t.nodo_aguas_arriba]);
      sale.set(t.nodo_aguas_arriba, t);
    });
    const piezasEn = new Map();
    s.accesorios.forEach((a) => {
      if (!piezasEn.has(a.nodo)) piezasEn.set(a.nodo, []);
      piezasEn.get(a.nodo).push(a);
    });
    // Arranques: las tomas con caudal; llegadas: la boca de un colector o de un ventilador.
    s.tramos.forEach((t) => {
      const up = t.nodo_aguas_arriba;
      if (!entran.has(up)) {
        const p = puertoEn.get(up);
        dato(p && p.rol === 'TOMA', `El tramo ${t.id} empieza en ${up}, que no es una toma: la red está abierta.`, [t.id, up]);
        dato(finito(p.caudal_m3_h) && p.caudal_m3_h > 0, `La toma ${p.id} (${p.equipo.nombre}) no tiene caudal.`, [p.id]);
        dato(finito(p.diametro_in) && p.diametro_in > 0, `La toma ${p.id} no tiene diámetro.`, [p.id]);
      }
      const dn = t.nodo_aguas_abajo;
      if (!sale.has(dn)) {
        const p = puertoEn.get(dn);
        dato(p && p.rol === 'ENTRADA' && ['COLECTOR', 'VENTILADOR'].includes(p.equipo.tipo), `El tramo ${t.id} termina en ${dn}, que no es la boca de un colector: la red no llega.`, [t.id, dn]);
      }
    });
    // Orden de las tomas al colector (cada tramo después de los que le llegan).
    const orden = [];
    const listo = new Set();
    let pend = [...s.tramos];
    while (pend.length) {
      const resto = pend.filter((t) => !(entran.get(t.nodo_aguas_arriba) || []).every((x) => listo.has(x.id)));
      if (resto.length === pend.length) falla('NO_ES_ARBOL', 'La red tiene un ciclo: el aire no tiene un sentido.', resto.map((t) => t.id));
      pend.filter((t) => !resto.includes(t)).sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((t) => { orden.push(t); listo.add(t.id); });
      pend = resto;
    }
    return { T, puertos, puertoEn, entran, sale, piezasEn, orden };
  }

  /** El camino de una toma a la boca: los tramos en el sentido del aire. */
  function camino(R, nodo) {
    const c = [];
    for (let t = R.sale.get(nodo); t; t = R.sale.get(t.nodo_aguas_abajo)) c.push(t.id);
    return c;
  }

  /** El rol de un tramo en el accesorio de un nodo. */
  const rolEn = (a, tid) => { const c = a.conexiones.find((x) => x.tramo === tid); return c ? c.rol : null; };
  const esConfluencia = (a) => ['INJERTO', 'REDUCCION_INJERTO', 'T_90', 'PANTALON'].includes(a.tipo);
  const esTransicion = (a) => a.tipo === 'REDUCCION' || a.tipo === 'ADAPTADOR';

  /* ------------------------------------------------------------------ la hoja de cálculo */

  /**
   * La hoja de cálculo de la red con los diámetros del sistema (o los de `diam`, { tramo: pulgadas }, para probar un
   * redimensionamiento). Devuelve los renglones por tramo, las confluencias, las tomas y las bocas.
   */
  function hojaDe(s, R, air, op, diam) {
    const tabla = op.tabla;
    const rho = air.densidad_kg_m3;
    const pol = s.politicas;
    const alfaDe = (a) => (a && finito(a.geometria && a.geometria.semiangulo_deg) ? a.geometria.semiangulo_deg : pol.semiangulo_reduccion_deg || 15);
    const D = (t) => (diam && diam[t.id] ? diam[t.id] * IN : t.diametro_interior_mm);
    const fila = new Map();
    const conf = [];
    const factor = new Map(); // corrección de caudal acumulada de cada toma
    R.puertos.forEach((p) => { if (p.rol === 'TOMA') factor.set(p.id, 1); });
    const tomasDe = new Map();

    R.orden.forEach((t) => {
      const up = t.nodo_aguas_arriba;
      const dn = t.nodo_aguas_abajo;
      const inc = R.entran.get(up) || [];
      const f = { tramo: t.id, tipo: t.tipo, D_mm: D(t), Q: 0, locales: [], sp_inicio: 0, sp_final: 0 };
      // Cada pérdida local va a la hoja; las que pasan en la sección del tramo suben su succión (enSP), las de un cambio
      // de sección la suben junto con el cambio de presión dinámica (dSP).
      let enSP = 0;
      let dSP = 0;
      const pone = (que, id, K, Pa, suma, extra) => { f.locales.push({ que, id, K, Pa, ...(extra || {}) }); if (suma) enSP += Pa; };
      if (!inc.length) {
        // Arranque en la toma: succión de la campana y, si la toma y el tramo no son del mismo Ø, el adaptador.
        const p = R.puertoEn.get(up);
        f.Q = p.caudal_m3_h;
        tomasDe.set(t.id, [p.id]);
        const dP = p.diametro_in * IN;
        const pvP = pvDe(f.Q, dP, rho);
        const K = finito(p.coef_entrada_K) ? p.coef_entrada_K : 0;
        f.toma = { puerto: p.id, pv: pvP, K, sp: (1 + K) * pvP };
        const ad = (R.piezasEn.get(up) || []).find(esTransicion);
        const tr = transicion(dP, f.D_mm, alfaDe(ad), pvP, pvDe(f.Q, f.D_mm, rho), tabla);
        if (tr.modelo) pone(tr.modelo, ad ? ad.id : null, tr.K, tr.perdida, false, { d1: p.diametro_in, d2: dP === f.D_mm ? p.diametro_in : redondo(f.D_mm / IN, 3), alfa: alfaDe(ad) });
        f.sp_inicio = f.toma.sp + tr.dSP;
      } else if (inc.length === 1) {
        const a = fila.get(inc[0].id);
        f.Q = a.Q;
        f.sp_inicio = a.sp_final;
        tomasDe.set(t.id, tomasDe.get(inc[0].id));
      } else {
        // Confluencia: manda la corriente de más succión; las otras se corrigen (Q′ = Q·√relación) si pasan del 5 %.
        const pieza = (R.piezasEn.get(up) || []).find(esConfluencia) || null;
        const cor = inc.map((x) => ({ t: x, f: fila.get(x.id), rol: pieza ? rolEn(pieza, x.id) : null }));
        const gob = cor.reduce((m, c) => (c.f.sp_final > m.f.sp_final ? c : m), cor[0]);
        let Qout = 0;
        let pvw = 0;
        cor.forEach((c) => {
          const rel = gob.f.sp_final / c.f.sp_final;
          c.k = c === gob || rel <= UMBRAL_NINGUNA ? 1 : Math.sqrt(rel);
          Qout += c.f.Q * c.k;
          pvw += c.f.Q * c.k * c.f.pv * c.k * c.k;
          if (c.k !== 1) tomasDe.get(c.t.id).forEach((pid) => factor.set(pid, factor.get(pid) * c.k));
        });
        pvw /= Qout;
        f.Q = Qout;
        f.sp_inicio = gob.f.sp_final;
        tomasDe.set(t.id, cor.flatMap((c) => tomasDe.get(c.t.id)));
        // Si la mezcla va más rápido que el promedio de lo que llega, acelerarla cuesta la diferencia (la recuperación no se cuenta).
        const pvr = pvDe(Qout, f.D_mm, rho);
        if (pvr > pvw) pone('ACELERACION', pieza ? pieza.id : null, null, pvr - pvw, true);
        conf.push({ nodo: up, pieza, corrientes: cor, gob, salida: t.id });
      }
      // El tramo: velocidad, presión dinámica, Reynolds y fricción sobre la longitud neta.
      const dm = f.D_mm / 1000;
      f.v = velocidad(f.Q, f.D_mm);
      f.pv = (rho * f.v * f.v) / 2;
      f.Re = (rho * f.v * dm) / air.viscosidad_Pa_s;
      f.f = friccion(f.Re, t.rugosidad_mm, f.D_mm);
      f.friccion = ((f.f * t.longitud_neta_mm) / 1000 / dm) * f.pv;
      if (t.tipo === 'FLEXIBLE' && t.flexible && finito(t.flexible.angulo_curva_deg) && t.flexible.curvas > 0 && finito(t.flexible.radio_mm)) {
        const K = kCodo(t.flexible.angulo_curva_deg, t.flexible.radio_mm / f.D_mm, null, tabla) * t.flexible.curvas;
        pone('CURVAS', null, K, K * f.pv, true);
      }
      // Lo que está en el nodo de llegada: el codo, la entrada a la confluencia, la expansión o el adaptador de la boca.
      (R.piezasEn.get(dn) || []).forEach((a) => {
        if (a.tipo === 'CODO') {
          const dNom = a.conexiones[0] && finito(a.conexiones[0].diametro_in) ? a.conexiones[0].diametro_in * IN : f.D_mm;
          const K = kCodo(a.geometria.angulo_deg, a.geometria.radio_eje_mm / dNom, a.geometria.gajos, tabla);
          pone('CODO', a.id, K, K * f.pv, true);
        } else if (a.tipo === 'COMPUERTA') {
          pone('COMPUERTA', a.id, tabla.compuerta.K, tabla.compuerta.K * f.pv, true);
        } else if (esConfluencia(a)) {
          const rol = rolEn(a, t.id);
          if (rol === 'RAMAL' || rol === 'RAMAL_2') {
            const K = kRamal(a.tipo === 'T_90' ? 90 : a.geometria.angulo_deg, tabla);
            pone('RAMAL', a.id, K, K * f.pv, true);
          }
        } else if (esTransicion(a) && (R.entran.get(dn) || []).length === 1) {
          const sig = R.sale.get(dn);
          const boca = R.puertoEn.get(dn);
          const d2 = sig ? D(sig) : boca && boca.rol === 'ENTRADA' ? boca.diametro_in * IN : f.D_mm;
          const tr = transicion(f.D_mm, d2, alfaDe(a), f.pv, pvDe(f.Q, d2, rho), tabla);
          if (tr.modelo) pone(tr.modelo, a.id, tr.K, tr.perdida, false, { d1: redondo(f.D_mm / IN, 3), d2: redondo(d2 / IN, 3), alfa: alfaDe(a) });
          dSP += tr.dSP;
        }
      });
      f.local = f.locales.reduce((x, l) => x + l.Pa, 0);
      f.sp_final = f.sp_inicio + f.friccion + enSP + dSP;
      fila.set(t.id, f);
    });
    return { fila, conf, factor };
  }

  /* ------------------------------------------------------------------ el cálculo */

  /**
   * Calcula la red. Devuelve { sistema, hoja }: el sistema con la K de cada accesorio y `resultados` llenos, y la hoja de
   * cálculo para mostrarla. Falla con CalculoError si al sistema le falta algo (una toma sin caudal, una red abierta…).
   * opciones: { eficiencia_ventilador (0.65), eficiencia_transmision (0.95), tabla (TABLA) }.
   */
  function calcular(sistema, opciones) {
    const op = { ...DEFECTOS, tabla: TABLA, ...(opciones || {}) };
    dato(op.eficiencia_ventilador > 0 && op.eficiencia_ventilador <= 1 && op.eficiencia_transmision > 0 && op.eficiencia_transmision <= 1, 'Las eficiencias van de 0 a 1.');
    const s = clonar(sistema);
    const R = red(s);
    const air = aireDe(s.proyecto.aire);
    const h = hojaDe(s, R, air, op, null);
    const pol = s.politicas;
    const comerciales = Array.isArray(pol.diametros_comerciales_in) ? [...pol.diametros_comerciales_in].sort((a, b) => a - b) : [];

    // K de cada accesorio.
    s.accesorios.forEach((a) => {
      const P = a.perdida || {};
      const g = a.geometria || {};
      if (a.tipo === 'CODO') {
        const d = a.conexiones[0] ? a.conexiones[0].diametro_in * IN : null;
        const rD = d ? g.radio_eje_mm / d : null;
        const K = d ? kCodo(g.angulo_deg, rD, g.gajos, op.tabla) : null;
        a.perdida = { modelo: 'CODO_GAJOS', K_paso: K === null ? null : redondo(K, 4), K_ramal: null, referencia: `ACGIH: codo de ${g.gajos} gajos a ${g.angulo_deg}°, R/D ${redondo(rD, 2)}${g.angulo_deg === 90 ? '' : ' (K de 90° por θ/90)'}` };
      } else if (esConfluencia(a)) {
        const K = a.tipo === 'T_90' ? kRamal(90, op.tabla) : kRamal(g.angulo_deg, op.tabla);
        a.perdida = { modelo: P.modelo || 'CONFLUENCIA_RAMAL', K_paso: a.tipo === 'PANTALON' ? null : 0, K_ramal: redondo(K, 4), referencia: `ACGIH: entrada de ramal a ${a.tipo === 'T_90' ? 90 : g.angulo_deg}°, sobre la pv del ramal; el paso del tronco va en su fricción` };
      } else if (esTransicion(a)) {
        const l = [...h.fila.values()].flatMap((f) => f.locales).find((x) => x.id === a.id);
        if (l) a.perdida = { modelo: l.que, K_paso: redondo(l.K, 4), K_ramal: null, referencia: `ACGIH: ${l.que === 'EXPANSION' ? 'expansión' : 'contracción'} de ${l.d1}″ a ${l.d2}″ con semiángulo de ${redondo(l.alfa, 2)}°, sobre la pv de la sección menor` };
        else a.perdida = { modelo: P.modelo || 'EXPANSION', K_paso: 0, K_ramal: null, referencia: 'Sin cambio de sección: sin pérdida' };
      } else if (a.tipo === 'COMPUERTA') {
        a.perdida = { modelo: 'COMPUERTA', K_paso: op.tabla.compuerta.K, K_ramal: null, referencia: op.tabla.compuerta.referencia };
      }
    });

    // Balanceo en cada confluencia (ACGIH): la corriente de menor succión se corrige o se redimensiona.
    const balance = [];
    h.conf.forEach((c) => {
      c.corrientes.filter((x) => x !== c.gob).forEach((menor) => {
        // En el par, el tronco es la ENTRADA; en un pantalón, el RAMAL frente al RAMAL_2.
        const par = [c.gob, menor];
        const tronco = par.find((x) => x.rol === 'ENTRADA') || par.find((x) => x.rol === 'RAMAL' && par.some((y) => y.rol === 'RAMAL_2')) || c.gob;
        const ramal = par.find((x) => x !== tronco);
        const rel = c.gob.f.sp_final / menor.f.sp_final;
        let accion = rel <= UMBRAL_NINGUNA ? 'NINGUNA' : rel <= UMBRAL_AJUSTE ? 'AJUSTAR_CAUDAL' : 'REDIMENSIONAR';
        let sugerencia = null;
        const qa = menor.f.Q;
        const qb = menor.f.Q * menor.k;
        if (accion !== 'NINGUNA') sugerencia = `${menor.t.id} pasa de ${num(qa, 0)} a ${num(qb, 0)} m³/h (+${num((menor.k - 1) * 100, 1)} %) para igualar la succión de ${c.gob.t.id}`;
        if (accion === 'AJUSTAR_CAUDAL') sugerencia += ': se acepta así.';
        if (accion === 'REDIMENSIONAR') {
          const r = redimensionar(s, R, air, op, c, menor, comerciales);
          if (!r.ok) accion = 'COMPUERTA';
          sugerencia += `. ${r.texto}`;
        }
        balance.push({
          nodo: c.nodo, tramo_ramal: ramal.t.id, tramo_tronco: tronco.t.id, sp_ramal_Pa: redondo(ramal.f.sp_final, 2), sp_tronco_Pa: redondo(tronco.f.sp_final, 2),
          relacion: redondo(rel, 3), accion, corriente_menor: menor.t.id, caudal_m3_h: redondo(qa, 1), caudal_corregido_m3_h: redondo(qb, 1), sugerencia,
        });
      });
    });

    // Por toma: su camino, la succión de su campana, su fricción y su pérdida total, y el caudal que va a jalar.
    const porToma = [];
    R.puertos.forEach((p) => {
      if (p.rol !== 'TOMA' || !p.nodo || !R.sale.has(p.nodo)) return;
      const cam = camino(R, p.nodo);
      const filas = cam.map((id) => h.fila.get(id));
      const ini = filas[0].toma;
      const fr = filas.reduce((x, f) => x + f.friccion, 0);
      const tot = ini.K * ini.pv + filas.reduce((x, f) => x + f.friccion + f.local, 0);
      porToma.push({ puerto: p.id, camino: cam, perdida_friccion_Pa: redondo(fr, 2), perdida_total_Pa: redondo(tot, 2), presion_estatica_campana_Pa: redondo(ini.sp, 2), caudal_m3_h: p.caudal_m3_h, caudal_corregido_m3_h: redondo(p.caudal_m3_h * h.factor.get(p.id), 1), _tot: tot });
    });
    porToma.sort((a, b) => (a.puerto < b.puerto ? -1 : 1));
    const critica = porToma.reduce((m, x) => (!m || x._tot > m._tot ? x : m), null);

    // Ventiladores: uno por colector (o por ventilador de la red).
    const ventiladores = [];
    s.equipos.forEach((e) => {
      const bocas = (e.puertos || []).filter((p) => p.rol === 'ENTRADA' && p.nodo && R.entran.has(p.nodo));
      if (!bocas.length || !['COLECTOR', 'VENTILADOR'].includes(e.tipo)) return;
      const llegan = bocas.map((p) => ({ p, f: R.entran.get(p.nodo).map((t) => h.fila.get(t.id)) }));
      const Q = llegan.reduce((x, b) => x + b.f.reduce((y, f) => y + f.Q, 0), 0);
      const spBoca = Math.max(...llegan.flatMap((b) => b.f.map((f) => f.sp_final)));
      const sp = spBoca + (finito(e.perdida_Pa) ? e.perdida_Pa : 0);
      const aire = (Q / 3600) * sp / 1000;
      const freno = aire / op.eficiencia_ventilador;
      const motorHp = freno / op.eficiencia_transmision / KW_POR_HP;
      ventiladores.push({
        equipo: e.id, bocas: bocas.map((p) => p.id), caudal_m3_h: redondo(Q, 1), presion_estatica_boca_Pa: redondo(spBoca, 2), perdida_equipo_Pa: finito(e.perdida_Pa) ? e.perdida_Pa : 0,
        presion_estatica_Pa: redondo(sp, 2), presion_estatica_estandar_Pa: redondo((sp * RHO_ESTANDAR) / air.densidad_kg_m3, 2),
        potencia_aire_kW: redondo(aire, 3), potencia_freno_kW: redondo(freno, 3), eficiencia_ventilador: op.eficiencia_ventilador, eficiencia_transmision: op.eficiencia_transmision,
        motor_hp: MOTORES_HP.find((m) => m >= motorHp - 1e-9) || null,
      });
    });

    s.resultados = {
      metodo: 'ACGIH, Industrial Ventilation: método de presión dinámica con balanceo por diseño. Fricción de Darcy-Weisbach (Swamee-Jain) sobre la longitud neta; codos, entradas de ramal, curvas de manguera, expansiones y contracciones con la tabla de coeficientes; succión de la campana (1 + K)·pv. Presiones estáticas como succión, en valor absoluto.',
      por_tramo: [...h.fila.values()].sort((a, b) => (a.tramo < b.tramo ? -1 : 1)).map((f) => ({
        tramo: f.tramo, caudal_m3_h: redondo(f.Q, 1), velocidad_m_s: redondo(f.v, 3), presion_dinamica_Pa: redondo(f.pv, 2), reynolds: Math.round(f.Re), factor_friccion: redondo(f.f, 4),
        perdida_friccion_Pa: redondo(f.friccion, 2), perdida_local_Pa: redondo(f.local, 2), presion_estatica_Pa: redondo(f.sp_final, 2),
      })),
      por_toma: porToma.map(({ _tot, ...x }) => x),
      balance,
      ventiladores,
    };
    return { sistema: s, hoja: { filas: h.fila, confluencias: h.conf, critica: critica ? critica.puerto : null, aire: air } };
  }

  /**
   * Para una corriente con poca succión (relación > 1.20): el Ø comercial menor de su tramo propio (de la confluencia hacia
   * arriba, hasta la toma o la confluencia anterior) que la equilibra sin pasar de la velocidad máxima. { ok, texto }.
   */
  function redimensionar(s, R, air, op, c, menor, comerciales) {
    const propios = [];
    for (let t = menor.t; t && t.tipo === 'RIGIDO'; ) {
      propios.push(t);
      const inc = R.entran.get(t.nodo_aguas_arriba) || [];
      t = inc.length === 1 ? inc[0] : null;
    }
    const vmax = s.politicas.velocidad_max_m_s;
    let mejor = null;
    for (let paso = 1; paso <= 3 && propios.length; paso += 1) {
      const diam = {};
      let ok = true;
      propios.forEach((t) => {
        const i = comerciales.indexOf(t.diametro_in);
        if (i - paso < 0) ok = false;
        else diam[t.id] = comerciales[i - paso];
      });
      if (!ok) break;
      const h2 = hojaDe(s, R, air, op, diam);
      const c2 = h2.conf.find((x) => x.nodo === c.nodo);
      const a = c2.corrientes.find((x) => x.t.id === menor.t.id).f.sp_final;
      const b = c2.corrientes.filter((x) => x.t.id !== menor.t.id).reduce((m, x) => Math.max(m, x.f.sp_final), 0);
      const rel = Math.max(a, b) / Math.min(a, b);
      const v = Math.max(...propios.map((t) => h2.fila.get(t.id).v));
      const cand = { diam, rel, v };
      if (rel <= UMBRAL_AJUSTE && (!finito(vmax) || v <= vmax + 1e-9)) { mejor = cand; break; }
      if (!mejor || rel < mejor.rel) mejor = { ...cand, fuera: true };
    }
    const lista = (d) => Object.keys(d).map((id) => `${id} a ${d[id]}″`).join(', ');
    if (mejor && !mejor.fuera) return { ok: true, texto: `Bajar ${lista(mejor.diam)} deja la relación en ${num(mejor.rel, 2)} (${num(mejor.v, 1)} m/s).` };
    const serv = s.proyecto.servicio;
    const polvo = serv === 'POLVO' || serv === 'ABRASIVO';
    const intento = mejor ? ` (con ${lista(mejor.diam)}: relación ${num(mejor.rel, 2)} a ${num(mejor.v, 1)} m/s)` : '';
    return { ok: false, texto: `Ningún Ø comercial menor lo equilibra dentro de ${num(vmax, 1)} m/s${intento}. Compuerta en ${menor.t.id}${polvo ? ', poco recomendable con polvo abrasivo: mejor acerque la derivación o quite codos del camino de más succión' : ''}.` };
  }

  /** Lo que el cálculo pide al sistema, en una frase, o null si se puede calcular. */
  function faltante(sistema) {
    try { red(sistema); aireDe(sistema.proyecto.aire); return null; } catch (e) { if (e instanceof CalculoError) return e.message; throw e; }
  }

  return { IN, RHO_ESTANDAR, MOTORES_HP, UMBRAL_NINGUNA, UMBRAL_AJUSTE, ACCIONES, DEFECTOS, TABLA, CalculoError, lineal, kCodo, kRamal, recuperacion, factorContraccion, transicion, aireDe, friccion, calcular, faltante };
}));
