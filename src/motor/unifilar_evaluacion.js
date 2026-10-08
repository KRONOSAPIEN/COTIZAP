/**
 * COTIZAP · unifilar_evaluacion.js — Qué tan bien se leyó un croquis (docs/vision-unifilares.md §12): compara la lectura que
 * dio Claude («obtenida») con la corregida por el ingeniero («esperada») y da las métricas del documento: F1 de nodos y de
 * aristas, exactitud de diámetros y cotas, errores silenciosos, accesorios que salen iguales y la diferencia de costo
 * directo del despiece. Las dos lecturas deben estar en el mismo marco de píxeles (la esperada se corrige sobre la obtenida).
 * scripts/evaluar-unifilares.js lo corre sobre un conjunto de croquis.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./unifilar'), require('./cotizador'));
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.unifilarEvaluacion = factory(root.COTIZAP.unifilar, root.COTIZAP.cotizador);
  }
}(typeof self !== 'undefined' ? self : this, function (UF, COT) {
  'use strict';

  /** Las metas de §12 para usar la lectura en cotizaciones preliminares. */
  const METAS = { nodos_f1: 0.95, aristas_f1: 0.95, diametros: 0.97, cotas: 0.95, accesorios: 0.95, costo_dif_max: 0.05, errores_silenciosos: 0 };
  const CONF_SEGURA = 0.9;
  const f1 = (tp, nObt, nEsp) => {
    const p = nObt ? tp / nObt : 0;
    const r = nEsp ? tp / nEsp : 0;
    return { precision: p, exhaustividad: r, f1: p + r ? (2 * p * r) / (p + r) : (nObt || nEsp ? 0 : 1) };
  };
  const proporcion = (bien, total) => (total ? bien / total : null);
  const r4 = (x) => (x === null ? null : Math.round(x * 10000) / 10000);

  function lecturaDe(x, que) {
    const { lectura, errores } = UF.leer(x);
    if (errores.length) throw new Error(`La lectura ${que} no sirve: ${errores.join(' ')}`);
    return lectura;
  }

  /** Empareja los nodos por cercanía (el más cercano primero), a menos de `tol` píxeles. Devuelve Map obtenido → esperado. */
  function emparejarNodos(obt, esp, tol) {
    const pares = [];
    obt.forEach((a) => esp.forEach((b) => {
      const d = Math.hypot(a.pos_px.x - b.pos_px.x, a.pos_px.y - b.pos_px.y);
      if (d <= tol) pares.push({ a: a.id, b: b.id, d });
    }));
    pares.sort((x, y) => x.d - y.d);
    const usadosA = new Set();
    const usadosB = new Set();
    const m = new Map();
    pares.forEach(({ a, b }) => { if (!usadosA.has(a) && !usadosB.has(b)) { m.set(a, b); usadosA.add(a); usadosB.add(b); } });
    return m;
  }

  /** El costo directo del despiece de una lectura (sin respuestas): null si no se puede cotizar. */
  function costoDirecto(lectura, M) {
    const bom = UF.despiezar(lectura, M, {});
    if (bom.resumen.estado === 'NO_COTIZABLE') return { bom, cd: null };
    const res = COT.cotizar({ yarda_mm: lectura.metadatos.yarda_mm, partidas: UF.aPartidas(bom) }, M);
    return { bom, cd: res.totales.costo_directo };
  }

  /**
   * Compara dos lecturas (objetos o texto JSON; también sirven despieces completos). M: tablas maestras. opciones.tolerancia:
   * fracción de la diagonal de la hoja para que dos nodos sean el mismo (por omisión 0.02).
   */
  function comparar(obtenida0, esperada0, M, opciones) {
    const obt = lecturaDe(obtenida0, 'obtenida');
    const esp = lecturaDe(esperada0, 'esperada');
    const fte = esp.metadatos.fuente || {};
    const xs = esp.red.nodos.map((n) => n.pos_px.x);
    const ys = esp.red.nodos.map((n) => n.pos_px.y);
    const diag = fte.ancho_enviado_px > 1 ? Math.hypot(fte.ancho_enviado_px, fte.alto_enviado_px) : Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const tol = ((opciones && opciones.tolerancia) || 0.02) * diag;
    const mN = emparejarNodos(obt.red.nodos, esp.red.nodos, tol);
    // aristas: las que unen los mismos nodos (en cualquier sentido)
    const clave = (a, b) => [a, b].sort().join('|');
    const espPorNodos = new Map(esp.red.aristas.map((a) => [clave(a.nodo_a, a.nodo_b), a]));
    const mA = new Map();
    obt.red.aristas.forEach((a) => {
      const na = mN.get(a.nodo_a);
      const nb = mN.get(a.nodo_b);
      const e = na && nb ? espPorNodos.get(clave(na, nb)) : null;
      if (e && ![...mA.values()].includes(e)) mA.set(a, e);
    });
    // diámetros y cotas de las aristas emparejadas que en la esperada traen valor
    let dTot = 0; let dBien = 0; let lTot = 0; let lBien = 0;
    const silenciosos = [];
    const diferencias = [];
    mA.forEach((e, o) => {
      if (e.diametro.valor !== null && e.diametro.valor !== undefined) {
        dTot += 1;
        const ok = o.diametro.valor !== null && Math.abs(Number(o.diametro.valor) - Number(e.diametro.valor)) < 0.01;
        if (ok) dBien += 1;
        else {
          diferencias.push(`${e.id}: Ø ${o.diametro.valor ?? '—'} en vez de ${e.diametro.valor}`);
          if (o.diametro.valor !== null && o.diametro.confianza >= CONF_SEGURA) silenciosos.push(`${e.id}: Ø ${o.diametro.valor} con confianza ${o.diametro.confianza}`);
        }
      }
      if (e.longitud_cota.valor !== null && e.longitud_cota.valor !== undefined) {
        lTot += 1;
        const ve = Number(e.longitud_cota.valor);
        const ok = o.longitud_cota.valor !== null && Math.abs(Number(o.longitud_cota.valor) - ve) <= Math.max(0.02 * ve, 0.01);
        if (ok) lBien += 1;
        else {
          diferencias.push(`${e.id}: ${o.longitud_cota.valor ?? '—'} m en vez de ${ve} m`);
          if (o.longitud_cota.valor !== null && o.longitud_cota.confianza >= CONF_SEGURA) silenciosos.push(`${e.id}: ${o.longitud_cota.valor} m con confianza ${o.longitud_cota.confianza}`);
        }
      }
    });
    // accesorios: los de la esperada, en el nodo emparejado, del mismo tipo y ángulo
    const co = costoDirecto(obt, M);
    const ce = costoDirecto(esp, M);
    const nInv = new Map([...mN].map(([a, b]) => [b, a]));
    const accObt = new Map(co.bom.accesorios.map((x) => [x.nodo_id, x]));
    let accBien = 0;
    ce.bom.accesorios.forEach((x) => {
      const y = accObt.get(nInv.get(x.nodo_id));
      const ang = (p) => p.partida_cotizap.theta_deg || p.partida_cotizap.beta_deg || null;
      if (y && y.tipo === x.tipo && ang(y) === ang(x)) accBien += 1;
      else diferencias.push(`${x.id} en ${x.nodo_id}: ${y ? `${y.tipo}${ang(y) ? ` a ${ang(y)}°` : ''}` : 'falta'} en vez de ${x.tipo}${ang(x) ? ` a ${ang(x)}°` : ''}`);
    });
    const nodos = f1(mN.size, obt.red.nodos.length, esp.red.nodos.length);
    const aristas = f1(mA.size, obt.red.aristas.length, esp.red.aristas.length);
    const costoDif = co.cd !== null && ce.cd ? (co.cd - ce.cd) / ce.cd : null;
    const m = {
      nodos_f1: r4(nodos.f1), aristas_f1: r4(aristas.f1), diametros: r4(proporcion(dBien, dTot)), cotas: r4(proporcion(lBien, lTot)),
      accesorios: r4(proporcion(accBien, ce.bom.accesorios.length)), costo_dif: r4(costoDif), errores_silenciosos: silenciosos.length,
    };
    const cumple = {
      nodos_f1: m.nodos_f1 >= METAS.nodos_f1, aristas_f1: m.aristas_f1 >= METAS.aristas_f1,
      diametros: m.diametros === null || m.diametros >= METAS.diametros, cotas: m.cotas === null || m.cotas >= METAS.cotas,
      accesorios: m.accesorios === null || m.accesorios >= METAS.accesorios, costo_dif: m.costo_dif !== null && Math.abs(m.costo_dif) <= METAS.costo_dif_max,
      errores_silenciosos: m.errores_silenciosos <= METAS.errores_silenciosos,
    };
    return {
      metricas: m, cumple, todo: Object.values(cumple).every(Boolean),
      detalle: {
        nodos: { emparejados: mN.size, obtenidos: obt.red.nodos.length, esperados: esp.red.nodos.length, ...nodos },
        aristas: { emparejadas: mA.size, obtenidas: obt.red.aristas.length, esperadas: esp.red.aristas.length, ...aristas },
        costo_directo: { obtenido: co.cd, esperado: ce.cd }, estado: { obtenido: co.bom.resumen.estado, esperado: ce.bom.resumen.estado },
        silenciosos, diferencias,
      },
    };
  }

  /** El resumen de varios croquis: cuántos cumplen cada meta y el costo dentro de ±5 % en qué fracción (la meta es el 90 %). */
  function resumir(resultados) {
    const n = resultados.length;
    const cuenta = (k) => resultados.filter((r) => r.cumple[k]).length;
    const claves = Object.keys(METAS).filter((k) => k !== 'costo_dif_max').concat(['costo_dif']);
    const porMeta = Object.fromEntries(claves.map((k) => [k, n ? cuenta(k) / n : null]));
    return { croquis: n, por_meta: porMeta, costo_en_5pct: porMeta.costo_dif, cumple_costo: n ? porMeta.costo_dif >= 0.9 : false, silenciosos: resultados.reduce((s, r) => s + r.metricas.errores_silenciosos, 0) };
  }

  return { comparar, resumir, METAS };
}));
