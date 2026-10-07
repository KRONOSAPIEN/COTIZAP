/**
 * COTIZAP · proveedor.js — Lista de precios del proveedor de acero.
 *
 * El proveedor cotiza por PIEZA (hoja, barra) y con el IVA incluido. Aquí cada renglón se convierte a lo que usa el
 * motor, que cuesta el acero por kg y SIN IVA (el IVA de compra se acredita; el IVA de venta se suma al final):
 *
 *   precio_sin_IVA = precio / (1 + iva_incluido_pct)
 *   precio_kg      = precio_sin_IVA / kg de la pieza
 *   kg de una hoja  = ancho · largo · espesor · densidad     (espesor por calibre del material, o esp_mm en placa)
 *   kg de una barra = peso lineal · largo                    (peso lineal del perfil, de sus medidas, o kg_m)
 *
 * Los renglones con calibre (hojas) o perfil (barras) conocidos alimentan el cálculo; los demás son referencia.
 * Sólo se leen precios de `M.proveedor`; ninguna fórmula contiene un precio.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./material'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.proveedor = factory(root.COTIZAP.util, root.COTIZAP.material);
  }
}(typeof self !== 'undefined' ? self : this, function (U, MAT) {
  'use strict';

  const DENSIDAD_PERFIL_KG_M3 = 7850;
  const positivo = (x) => Number.isFinite(Number(x)) && Number(x) > 0;

  /** Fracción de IVA que ya traen los precios capturados (0 si se capturaron antes de IVA). */
  function ivaIncluido(M) {
    const v = Number(M.proveedor && M.proveedor.iva_incluido_pct);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  const sinIva = (M, precio) => precio / (1 + ivaIncluido(M));

  /** Espesor (mm) de una hoja: `esp_mm` si es placa; si no, el del calibre en la tabla del material. */
  function espesorHoja(M, h) {
    if (positivo(h.esp_mm)) return Number(h.esp_mm);
    const mat = M.materiales[h.material];
    const tabla = mat && M.calibres[mat.tabla_calibre];
    const pulg = tabla && tabla[h.calibre];
    return positivo(pulg) ? pulg * U.MM_POR_PULGADA : null;
  }

  /** kg de una hoja (null si falta algún dato). */
  function kgHoja(M, h) {
    const mat = M.materiales[h.material];
    const e = espesorHoja(M, h);
    if (!mat || !positivo(e) || !positivo(h.ancho_mm) || !positivo(h.largo_mm)) return null;
    return (h.ancho_mm / 1000) * (h.largo_mm / 1000) * (e / 1000) * mat.densidad_kg_m3;
  }

  /** Peso lineal (kg/m) de una barra: del perfil de brida enlazado, de sus medidas (solera o ángulo) o de `kg_m`. */
  function pesoLinealBarra(M, b) {
    if (b.perfil && M.herrajes.perfiles[b.perfil]) return MAT.perfilDerivado(M, b.perfil).peso_kg_m;
    if (positivo(b.ancho_mm) && positivo(b.esp_mm) && (b.tipo === 'SOLERA' || b.tipo === 'ANGULO')) {
      const area = b.tipo === 'SOLERA' ? b.ancho_mm * b.esp_mm : b.esp_mm * (2 * b.ancho_mm - b.esp_mm);
      return (area * DENSIDAD_PERFIL_KG_M3) / 1e6;
    }
    return positivo(b.kg_m) ? Number(b.kg_m) : null;
  }

  /** kg de una barra (null si falta algún dato). */
  function kgBarra(M, b) {
    const w = pesoLinealBarra(M, b);
    return w !== null && positivo(b.largo_mm) ? (w * b.largo_mm) / 1000 : null;
  }

  /** Convierte el precio cotizado de una pieza de `kg` kg: { precio, sin_iva, kg, precio_kg }. */
  function convertir(M, precio, kg) {
    const p = Number(precio);
    if (!positivo(p) || !positivo(kg)) return null;
    const neto = sinIva(M, p);
    return { precio: p, sin_iva: neto, kg, precio_kg: neto / kg };
  }

  /** ¿La hoja del renglón es del `ancho` dado (el de la hoja estándar si no se dice) y del largo estándar? (±2 mm: 1 219 y 1 220 son la misma hoja de 4 ft) */
  const mismaHoja = (M, h, ancho) => Math.abs(h.ancho_mm - (ancho || M.proceso.hoja.ancho_mm)) <= 2 && Math.abs(h.largo_mm - M.proceso.hoja.largo_mm) < 1;

  /**
   * Renglón de lámina con precio válido para (material, calibre). Con `ancho_mm` (la yarda del tramo recto: es el ancho de la
   * hoja) se prefiere la hoja de ese ancho; si no hay, la hoja estándar del taller, y si tampoco, el primer renglón.
   */
  function laminaDe(M, material_id, calibre, ancho_mm) {
    const hojas = (M.proveedor && M.proveedor.hojas) || {};
    const cal = Number(calibre);
    if (!positivo(cal)) return null;
    const candidatos = Object.keys(hojas)
      .filter((id) => hojas[id].material === material_id && Number(hojas[id].calibre) === cal && convertir(M, hojas[id].precio, kgHoja(M, hojas[id])));
    if (!candidatos.length) return null;
    const id = (ancho_mm && candidatos.find((i) => mismaHoja(M, hojas[i], ancho_mm))) || candidatos.find((i) => mismaHoja(M, hojas[i])) || candidatos[0];
    return { fuente: 'PROVEEDOR', id, descripcion: hojas[id].descripcion || id, ...convertir(M, hojas[id].precio, kgHoja(M, hojas[id])) };
  }

  /** Renglón de barra con precio válido para un perfil de brida (el primero que lo enlaza). */
  function perfilDe(M, perfil_id) {
    const barras = (M.proveedor && M.proveedor.barras) || {};
    const id = Object.keys(barras).find((i) => barras[i].perfil === perfil_id && convertir(M, barras[i].precio, kgBarra(M, barras[i])));
    if (!id) return null;
    return { fuente: 'PROVEEDOR', id, descripcion: barras[id].descripcion || id, ...convertir(M, barras[id].precio, kgBarra(M, barras[id])) };
  }

  /**
   * Los renglones de la lista con todo lo derivado, para mostrarlos y documentarlos:
   * { hojas: [...], barras: [...] }, cada renglón { id, ...datos, kg, sin_iva, precio_kg, uso: 'CALCULO' | 'REFERENCIA' }.
   */
  function tablas(M) {
    const P = M.proveedor || {};
    const derivado = (r, kg) => {
      const c = convertir(M, r.precio, kg);
      return { kg: kg === null ? null : kg, sin_iva: c ? c.sin_iva : null, precio_kg: c ? c.precio_kg : null };
    };
    // Un renglón de lámina se usa si es la hoja que se elige para algún ancho de yarda (o la estándar)
    const anchos = [undefined, ...(M.proceso && M.proceso.armado_yardas && Array.isArray(M.proceso.armado_yardas.yardas_mm) ? M.proceso.armado_yardas.yardas_mm : [])];
    const hojas = Object.keys(P.hojas || {}).map((id) => {
      const h = P.hojas[id];
      const usada = anchos.some((a) => { const uso = laminaDe(M, h.material, h.calibre, a); return uso && uso.id === id; });
      return { id, ...h, ...derivado(h, kgHoja(M, h)), uso: usada ? 'CALCULO' : 'REFERENCIA' };
    });
    const barras = Object.keys(P.barras || {}).map((id) => {
      const b = P.barras[id];
      const uso = b.perfil ? perfilDe(M, b.perfil) : null;
      return { id, ...b, ...derivado(b, kgBarra(M, b)), uso: uso && uso.id === id ? 'CALCULO' : 'REFERENCIA' };
    });
    return { hojas, barras };
  }

  /**
   * Una barra de la lista por su id, con lo que hace falta para costear piezas cortadas de ella (soportería):
   * { id, descripcion, largo_mm, kg_m, kg, precio, sin_iva, precio_kg, precio_m } — precio_m = precio sin IVA por metro.
   * null si no existe o no tiene precio o largo válidos (un precio en 0 no se usa).
   */
  function barra(M, id) {
    const b = M.proveedor && M.proveedor.barras && M.proveedor.barras[id];
    if (!b || !positivo(b.precio) || !positivo(b.largo_mm)) return null;
    const kg_m = pesoLinealBarra(M, b);
    const neto = sinIva(M, Number(b.precio));
    return {
      id, descripcion: b.descripcion || id, largo_mm: Number(b.largo_mm), kg_m, kg: kg_m === null ? null : (kg_m * b.largo_mm) / 1000,
      precio: Number(b.precio), sin_iva: neto, precio_kg: kg_m === null ? null : neto / ((kg_m * b.largo_mm) / 1000), precio_m: neto / (b.largo_mm / 1000),
    };
  }

  return {
    ivaIncluido, sinIva, espesorHoja, kgHoja, pesoLinealBarra, kgBarra, convertir, laminaDe, perfilDe, tablas, barra,
  };
}));
