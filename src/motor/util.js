/**
 * COTIZAP · util.js
 * Utilidades numéricas puras. Sin dependencias; funciona en navegador (script clásico)
 * y en Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.util = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PI = Math.PI;
  const MM_POR_PULGADA = 25.4;

  const enMm = (pulgadas) => pulgadas * MM_POR_PULGADA;
  const enPulgadas = (mm) => mm / MM_POR_PULGADA;
  const rad = (grados) => (grados * PI) / 180;
  const grados = (radianes) => (radianes * 180) / PI;

  /** Error de validación con lista de mensajes legibles. */
  class ErrorValidacion extends Error {
    constructor(errores) {
      super(errores.join(' | '));
      this.name = 'ErrorValidacion';
      this.errores = errores;
    }
  }

  /** Integración de Simpson compuesta (n se fuerza a par). */
  function simpson(f, a, b, n) {
    let N = n || 240;
    if (N % 2) N += 1;
    const h = (b - a) / N;
    let s = f(a) + f(b);
    for (let i = 1; i < N; i += 1) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  }

  /**
   * Interpolación lineal en una tabla [[x, y], ...] ordenada por x.
   * Fuera de rango se mantiene el valor del extremo (extrapolación plana).
   */
  function interpolar(tabla, x) {
    if (!tabla || !tabla.length) throw new Error('Tabla de interpolación vacía');
    if (x <= tabla[0][0]) return tabla[0][1];
    const ult = tabla[tabla.length - 1];
    if (x >= ult[0]) return ult[1];
    for (let i = 1; i < tabla.length; i += 1) {
      if (x <= tabla[i][0]) {
        const [x0, y0] = tabla[i - 1];
        const [x1, y1] = tabla[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return ult[1];
  }

  /** Redondea hacia arriba al múltiplo m (tolerante a ruido de coma flotante). */
  const techoMultiplo = (n, m) => Math.ceil(n / m - 1e-9) * m;

  const redondear = (x, d) => {
    const f = 10 ** (d === undefined ? 2 : d);
    return Math.round((x + Number.EPSILON) * f) / f;
  };

  const suma = (obj) => Object.values(obj).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);

  const clonar = (o) => JSON.parse(JSON.stringify(o));

  /** Igualdad profunda para datos JSON (objetos, arreglos y primitivos). */
  function igual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => igual(x, b[i]));
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && igual(a[k], b[k]));
  }

  /**
   * Parche mínimo que lleva de `base` a `actual` ({} si son iguales). Los arreglos se reemplazan completos.
   * Guardar sólo el parche permite que los valores de arranque nuevos lleguen a quien no los editó:
   *   mezclar(base, diferencia(base, actual)) ≡ actual
   */
  function diferencia(base, actual) {
    const parche = {};
    Object.keys(actual).forEach((k) => {
      const a = actual[k];
      const b = base ? base[k] : undefined;
      const objeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
      if (objeto(a) && objeto(b)) {
        const sub = diferencia(b, a);
        if (Object.keys(sub).length) parche[k] = sub;
      } else if (!igual(a, b)) {
        parche[k] = clonar(a);
      }
    });
    return parche;
  }

  /** Mezcla profunda: valores de `parche` sobreescriben a `base` (no muta). */
  function mezclar(base, parche) {
    if (parche === undefined || parche === null) return clonar(base);
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return clonar(parche);
    const salida = clonar(base);
    Object.keys(parche).forEach((k) => {
      const pv = parche[k];
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && typeof salida[k] === 'object' && !Array.isArray(salida[k])) {
        salida[k] = mezclar(salida[k], pv);
      } else {
        salida[k] = clonar(pv);
      }
    });
    return salida;
  }

  return {
    PI, MM_POR_PULGADA, enMm, enPulgadas, rad, grados, ErrorValidacion,
    simpson, interpolar, techoMultiplo, redondear, suma, clonar, mezclar, igual, diferencia,
  };
}));
