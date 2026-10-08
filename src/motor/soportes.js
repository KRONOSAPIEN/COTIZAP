/**
 * COTIZAP · soportes.js — Cuántos soportes (ménsulas) pide el ducto de una cotización.
 *
 * El espaciamiento recomendado (tablas maestras, `proceso.soportes.espaciado`):
 *   · tramo horizontal: un soporte cada 2.5 m (la práctica ideal de montaje es cada 2.40 m, una por junta); nunca más de 3.0 m;
 *   · tramo vertical: nunca más de 3.0 m entre soportes, y siempre un soporte fuerte en la base de la subida;
 *   · accesorios: un soporte a no más de 30–50 cm de cada codo y de cada derivación (injerto, «Y»), que sufren el impacto de la
 *     partícula y la turbulencia.
 *
 *   soportes de un tramo   = máx( mínimo, ⌈ largo ÷ separación ⌉ )      (mínimo 1; en la subida, el de la base)
 *   soportes de accesorios = soportes por accesorio × piezas
 *   total                  = Σ tramos rectos × piezas  +  Σ accesorios
 *   mínimo                 = lo mismo con la separación MÁXIMA (3.0 m): por debajo de eso el ducto queda sin apoyo suficiente
 *
 * Lee las partidas ya calculadas de la cotización (sólo las que salieron bien): un tramo recto aporta su longitud y su
 * `posicion` (HORIZONTAL por omisión o VERTICAL); un codo, un injerto simple y una reducción con injerto aportan sus soportes.
 * Pura: no muta nada.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.soportes = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;
  const POSICIONES = ['HORIZONTAL', 'VERTICAL'];
  /** Las piezas que piden un soporte junto a ellas (codos y derivaciones). */
  const ACCESORIOS = ['CODO', 'RAMAL', 'REDUCCION_INJERTO', 'PANTALON'];
  const NOMBRE_ACCESORIO = { CODO: 'codo', RAMAL: 'injerto', REDUCCION_INJERTO: 'reducción con injerto', PANTALON: 'pantalón' };

  const piezas = (x) => Math.max(1, Math.round(Number(x) || 1));

  /**
   * filas: las partidas calculadas de la cotización (`cotizarPartida`); M: las tablas; opciones.separacion_m: la separación
   * horizontal propia de la partida de soportes (vacía = la de las tablas).
   * Devuelve { n, minimo, separacion_m, separacion_max_m, tramos, accesorios, L_horizontal_m, L_vertical_m }.
   */
  function contar(filas, M, opciones) {
    const E = M && M.proceso && M.proceso.soportes && M.proceso.soportes.espaciado;
    const op = opciones || {};
    if (!E || typeof E !== 'object') return { n: 0, minimo: 0, separacion_m: 0, separacion_max_m: 0, tramos: [], accesorios: [], L_horizontal_m: 0, L_vertical_m: 0, sin_tabla: true };
    const sepH = Number.isFinite(op.separacion_m) && op.separacion_m > 0 ? op.separacion_m : E.horizontal_m;
    const tramos = [];
    const accesorios = [];
    let n = 0;
    let minimo = 0;
    let L_h = 0;
    let L_v = 0;
    (filas || []).forEach((f) => {
      if (!f || !f.ok || !f.entrada) return;
      const e = f.entrada;
      const cant = piezas(e.cantidad);
      if (f.familia === 'RECTO') {
        const L_m = Number(e.L_mm) / 1000;
        if (!(L_m > 0)) return;
        const vertical = e.posicion === 'VERTICAL';
        const por = Math.max(vertical ? E.base_vertical : 1, Math.ceil(L_m / (vertical ? E.vertical_m : sepH) - EPS));
        const por_min = Math.max(vertical ? E.base_vertical : 1, Math.ceil(L_m / (vertical ? E.vertical_m : E.horizontal_max_m) - EPS));
        tramos.push({ indice: f.indice, descripcion: f.descripcion, posicion: vertical ? 'VERTICAL' : 'HORIZONTAL', L_m, piezas: cant, por_pieza: por, soportes: por * cant });
        n += por * cant;
        minimo += por_min * cant;
        if (vertical) L_v += L_m * cant; else L_h += L_m * cant;
      } else if (ACCESORIOS.includes(f.familia) && E.por_accesorio > 0) {
        accesorios.push({ indice: f.indice, descripcion: f.descripcion, familia: f.familia, piezas: cant, soportes: E.por_accesorio * cant });
        n += E.por_accesorio * cant;
        minimo += E.por_accesorio * cant;
      }
    });
    return { n, minimo, separacion_m: sepH, separacion_max_m: E.horizontal_max_m, tramos, accesorios, L_horizontal_m: L_h, L_vertical_m: L_v };
  }

  /** El aviso de una captura manual que deja el ducto con menos soportes que los de la separación máxima ('' si alcanza). */
  function avisoManual(cantidad, c) {
    if (!(c.minimo > 0) || !(cantidad < c.minimo)) return '';
    return `Con ${cantidad} ${cantidad === 1 ? 'pieza' : 'piezas'} el ducto queda con menos soportes de los que pide la separación máxima de ${c.separacion_max_m} m (mínimo ${c.minimo}; lo recomendado son ${c.n}).`;
  }

  /** «6 en 2 tramos rectos (14.5 m) + 5 junto a codos e injertos» */
  function resumen(c) {
    const rectos = c.tramos.reduce((s, t) => s + t.soportes, 0);
    const acc = c.accesorios.reduce((s, a) => s + a.soportes, 0);
    const partes = [];
    if (rectos > 0) partes.push(`${rectos} en los tramos rectos`);
    if (acc > 0) partes.push(`${acc} junto a codos e injertos`);
    return partes.join(' + ');
  }

  return { contar, resumen, avisoManual, POSICIONES, ACCESORIOS, NOMBRE_ACCESORIO };
}));
