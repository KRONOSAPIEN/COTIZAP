/**
 * COTIZAP · gastos.js — Control de gastos de un proyecto: lo que de verdad se gastó contra lo que se cotizó.
 *
 * Cada gasto real es un renglón { fecha, concepto, categoria, cantidad, precio_unitario, iva_incluido, con_factura }.
 * Su COSTO es sin el IVA que se acredita:
 *   importe = cantidad × precio_unitario
 *   precio con IVA y con factura  → costo = importe ÷ (1 + IVA)   (el IVA se acredita)
 *   precio con IVA y sin factura  → costo = importe              (el IVA no se recupera: es costo)
 *   precio sin IVA                → costo = importe              (si hay factura, el IVA que se paga encima se acredita)
 * Sin decir si hay factura, se supone que sí, salvo en la mano de obra (la raya del taller y de la instalación no lleva IVA).
 *
 * Lo cotizado se reparte en las mismas categorías desde el costo directo de cada partida (antes de indirectos y utilidad), como
 * se capturan los tickets: material, consumibles (con la herramienta menor), mano de obra del taller (también la de la
 * soportería), compras a terceros, soportería (su material), instalación (la cuadrilla) y viáticos. Un artículo comprado cae
 * en la categoría que le da el catálogo de compras (sin ella, compras a terceros). El costo de EQUIPO (hora-máquina:
 * depreciación, energía y mantenimiento de las máquinas propias) no se paga con un ticket: queda aparte, como estimado.
 * El resultado del proyecto:
 *   utilidad antes de indirectos = venta − gastos reales
 *   utilidad después de indirectos = venta × (1 − comisión − otros) − gastos reales − equipo − indirectos, imprevistos y
 *                                    financiamiento que estimó la cotización (no son gastos que se capturen uno por uno)
 * La venta es la pactada (sin IVA) si la cotización la trae; si no, el precio calculado.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.gastos = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIAS = {
    MATERIAL: 'Material: lámina, perfiles, tornillería, empaque y sellador',
    CONSUMIBLE: 'Consumibles: soldadura, gas, corte, pintura y herramienta menor',
    MANO_OBRA: 'Mano de obra del taller',
    PROVEEDOR: 'Compras y trabajos de terceros',
    SOPORTERIA: 'Soportería y anclajes',
    INSTALACION: 'Mano de obra de instalación',
    VIATICOS: 'Viáticos y traslados',
    OTROS: 'Otros',
  };
  /** Categorías cuyo gasto, sin decir otra cosa, no trae factura con IVA: la raya se paga sin IVA. */
  const SIN_FACTURA_POR_DEFECTO = ['MANO_OBRA', 'INSTALACION'];
  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const numero = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    return NaN;
  };

  /**
   * Un gasto capturado, revisado: { g, errores }. `g` trae números de verdad; un renglón vacío (sin concepto ni importe) no
   * es error: se ignora (`vacio: true`).
   */
  function normalizarGasto(entrada) {
    const errores = [];
    if (!esObjeto(entrada)) return { g: null, errores: ['El gasto no es válido.'] };
    const categoria = Object.prototype.hasOwnProperty.call(CATEGORIAS, entrada.categoria) ? entrada.categoria : 'OTROS';
    const g = {
      fecha: typeof entrada.fecha === 'string' ? entrada.fecha.slice(0, 10) : '',
      concepto: typeof entrada.concepto === 'string' ? entrada.concepto.slice(0, 200) : '',
      categoria,
      cantidad: entrada.cantidad === undefined || entrada.cantidad === null || entrada.cantidad === '' ? 1 : numero(entrada.cantidad),
      precio_unitario: entrada.precio_unitario === undefined || entrada.precio_unitario === null || entrada.precio_unitario === '' ? 0 : numero(entrada.precio_unitario),
      iva_incluido: entrada.iva_incluido === true,
      con_factura: typeof entrada.con_factura === 'boolean' ? entrada.con_factura : !SIN_FACTURA_POR_DEFECTO.includes(categoria),
    };
    const etiqueta = g.concepto || 'Gasto';
    if (!(g.cantidad >= 0 && g.cantidad <= 1e7)) errores.push(`${etiqueta}: la cantidad debe ser un número de 0 en adelante.`);
    if (!(g.precio_unitario >= 0 && g.precio_unitario <= 1e9)) errores.push(`${etiqueta}: el precio debe ser un número de 0 en adelante.`);
    g.vacio = !g.concepto.trim() && !(g.cantidad * g.precio_unitario > 0);
    return { g, errores };
  }

  /** Costo (sin el IVA acreditable) de un gasto ya normalizado: { importe, costo, iva_acreditable }. */
  function costoGasto(g, iva_pct) {
    const importe = g.cantidad * g.precio_unitario;
    if (g.iva_incluido) {
      if (g.con_factura) {
        const costo = importe / (1 + iva_pct);
        return { importe, costo, iva_acreditable: importe - costo };
      }
      return { importe, costo: importe, iva_acreditable: 0 };
    }
    return { importe, costo: importe, iva_acreditable: g.con_factura ? importe * iva_pct : 0 };
  }

  const filasCalculadas = (res) => [...((res && res.partidas) || []), ...((res && res.automaticas) || [])].filter((f) => f && f.ok);

  /** Costo directo que la cotización estimó, repartido en las categorías del control de gastos (sin el equipo: ver equipoCotizado). */
  function cotizadoPorCategoria(res) {
    const c = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, 0]));
    filasCalculadas(res).forEach((f) => {
      const s = f.costos.subtotales;
      c.CONSUMIBLE += s.herramienta_menor || 0;
      if (f.familia === 'COMPRADO') {
        // la compra, en la categoría del artículo; la tornillería y la junta de lo que se atornilla, material (como las de las bridas)
        const compra = f.costos.materiales.compra || 0;
        c[f.compra && Object.prototype.hasOwnProperty.call(c, f.compra.categoria) ? f.compra.categoria : 'PROVEEDOR'] += compra;
        c.MATERIAL += s.materiales - compra;
      }
      else if (f.familia === 'SOPORTE') {
        c.SOPORTERIA += s.materiales;
        c.MANO_OBRA += s.mano_obra;
      } else if (f.familia === 'INSTALACION') {
        c.INSTALACION += s.mano_obra;
        c.VIATICOS += s.viaticos;
      } else if (f.familia === 'AJUSTE_COMPRA') c.MATERIAL += s.materiales;
      else {
        c.MATERIAL += s.materiales;
        c.CONSUMIBLE += s.consumibles;
        c.MANO_OBRA += s.mano_obra;
        c.PROVEEDOR += s.subcontratos;
      }
    });
    return c;
  }

  /** Costo de equipo (hora-máquina) que cotizó la cotización: es parte del costo directo, pero no llega con un ticket. */
  const equipoCotizado = (res) => filasCalculadas(res).reduce((s, f) => s + (f.costos.subtotales.equipo || 0), 0);

  /**
   * Resumen del control de gastos de una cotización calculada (`res` de cotizar) con sus gastos reales.
   * Devuelve { gastos: [...con su costo], errores, categorias: [{ clave, nombre, cotizado, real, diferencia }], totales, resultado }.
   */
  function resumen(res, gastosEntrada, iva_pct) {
    const iva = Number.isFinite(iva_pct) && iva_pct >= 0 ? iva_pct : 0.16;
    const errores = [];
    const gastos = (Array.isArray(gastosEntrada) ? gastosEntrada : []).map((x, i) => {
      const { g, errores: e } = normalizarGasto(x);
      if (!g) { errores.push(`Renglón ${i + 1}: no es válido.`); return null; }
      e.forEach((m) => errores.push(`Renglón ${i + 1}: ${m}`));
      return { ...g, indice: i, valido: !e.length, ...(e.length ? { importe: 0, costo: 0, iva_acreditable: 0 } : costoGasto(g, iva)) };
    }).filter(Boolean);
    const cot = cotizadoPorCategoria(res);
    const real = Object.fromEntries(Object.keys(CATEGORIAS).map((k) => [k, 0]));
    gastos.forEach((g) => { if (g.valido && !g.vacio) real[g.categoria] += g.costo; });
    const categorias = Object.keys(CATEGORIAS).map((k) => ({ clave: k, nombre: CATEGORIAS[k], cotizado: cot[k], real: real[k], diferencia: real[k] - cot[k] }));
    const T = (res && res.totales) || {};
    const cotizado = categorias.reduce((s, x) => s + x.cotizado, 0);
    const realTotal = categorias.reduce((s, x) => s + x.real, 0);
    const iva_acreditable = gastos.reduce((s, g) => s + (g.valido && !g.vacio ? g.iva_acreditable : 0), 0);
    const C = (res && res.capas) || {};
    const pactada = T.venta ? T.venta.pactada : null;
    const venta = pactada !== null && pactada !== undefined ? pactada : (T.subtotal_neto || 0);
    const indirectos = Math.max(0, (T.C_base_total || 0) - (T.costo_directo || 0)); // indirectos, imprevistos y financiamiento estimados
    const equipo = equipoCotizado(res);
    const neto = venta * (1 - (C.comision_ventas_pct_precio || 0) - (C.otros_pct_precio || 0));
    const antes = venta - realTotal;
    const despues = neto - realTotal - equipo - indirectos;
    return {
      gastos, errores, categorias,
      totales: { cotizado, real: realTotal, diferencia: realTotal - cotizado, avance_pct: cotizado > 0 ? realTotal / cotizado : 0, iva_acreditable, n_gastos: gastos.filter((g) => g.valido && !g.vacio).length },
      resultado: {
        venta, venta_es_pactada: pactada !== null && pactada !== undefined, indirectos_estimados: indirectos, equipo_estimado: equipo,
        comision_y_otros: venta - neto,
        utilidad_antes_indirectos: antes, margen_antes_indirectos_pct: venta > 0 ? antes / venta : 0,
        utilidad_despues_indirectos: despues, margen_despues_indirectos_pct: venta > 0 ? despues / venta : 0,
      },
    };
  }

  return { CATEGORIAS, SIN_FACTURA_POR_DEFECTO, normalizarGasto, costoGasto, cotizadoPorCategoria, equipoCotizado, resumen };
}));
