/**
 * COTIZAP · rapida.js — Cotización rápida: un precio en minutos con el diámetro mayor y los metros hasta el punto más alejado.
 *
 * La regla del taller (7-oct-2026), con sus valores en las tablas maestras (`M.rapida`):
 *
 *   láminas  = hojas enteras de la lista del proveedor para hacer esos metros de ducto a ese diámetro
 *   lámina   = láminas × precio de la hoja sin IVA
 *   costo    = lámina × factor_lamina (3: cubre mano de obra, accesorios y lo demás) + bridas por metros
 *   precio   = costo × (1 + utilidad)            (la utilidad se SUMA sobre el costo)
 *   total    = precio × (1 + IVA)
 *
 * Bridas por metros: el primer renglón de `bridas_por_metros` cuyo «hasta m» alcanza los metros (hasta 40 m, $5,000; de 40 a
 * 80 m, $12,000; de 80 a 120 m, $18,000). Más metros que el último renglón no tienen precio de bridas: es error.
 *
 * Cómo se cuentan las hojas. Cada yarda del ducto es un anillo que se corta a lo ancho de la hoja (la yarda es el ancho de la
 * hoja, como en el tramo recto) y su plantilla mide el perímetro medio más la holgura de la costura del material:
 *   B = π · (D + e) + holgura        (el diámetro es el interior, como en las partidas)
 *   yardas = ⌈ metros ÷ ancho de la hoja ⌉,   yardas por hoja = ⌊ largo de la hoja ÷ B ⌋,   hojas = ⌈ yardas ÷ yardas por hoja ⌉
 * Si la plantilla es más larga que la hoja, cada yarda lleva hojas completas y un retazo; los retazos se acomodan juntos.
 * Pura: no muta nada; lanza ErrorValidacion con mensajes legibles.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./geometria'), require('./proveedor'), require('./validacion'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.rapida = factory(root.COTIZAP.util, root.COTIZAP.geometria, root.COTIZAP.proveedor, root.COTIZAP.validacion);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, PROV, VAL) {
  'use strict';

  const EPS = 1e-6;
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);

  /** Las hojas de la lista del proveedor con que se puede cotizar (con precio y kg calculables): [{ id, descripcion, … }]. */
  function hojas(M) {
    const H = (M.proveedor && M.proveedor.hojas) || {};
    return Object.keys(H)
      .filter((id) => H[id] && Number(H[id].calibre) > 0 && M.materiales[H[id].material] && PROV.convertir(M, H[id].precio, PROV.kgHoja(M, H[id]))) // lámina, no placa
      .map((id) => ({ id, descripcion: H[id].descripcion || id, material: H[id].material, calibre: H[id].calibre, ancho_mm: H[id].ancho_mm, largo_mm: H[id].largo_mm }));
  }

  /** El renglón de bridas por metros que toca a `L_m` (o null si los metros pasan del último). */
  function bridasPara(M, L_m) {
    const filas = M.rapida.bridas_por_metros; // van de menor a mayor (lo revisa la validación de las tablas)
    const i = filas.findIndex((r) => L_m <= r.hasta_m + EPS);
    if (i < 0) return null;
    return { desde_m: i > 0 ? filas[i - 1].hasta_m : 0, hasta_m: filas[i].hasta_m, importe: filas[i].importe };
  }

  /**
   * entrada: { D_mm, L_m, hoja_id?, utilidad_pct? }  (utilidad en fracción: 0.20)
   * Devuelve el desglose: hoja, plantilla, yardas, hojas, lámina, factor, bridas, costo, utilidad, precio, IVA y total.
   */
  function cotizar(entrada, M) {
    // las tablas de las que depende: su propia tabla, la lista del proveedor, los materiales y calibres, la costura y el IVA
    const malos = VAL.problemasMaestros(M, { solo: ['rapida', 'proveedor', 'materiales', 'calibres', 'capas'] });
    if (malos.length) throw new U.ErrorValidacion(malos.slice(0, 6).map((x) => `Tablas maestras · ${VAL.textoProblema(x)}`));
    const R = M.rapida;
    const e0 = entrada || {};
    const errores = [];
    const D = Number(e0.D_mm);
    const L_m = Number(e0.L_m);
    const lim = (M.proceso && M.proceso.limites) || {};
    if (!finito(D) || !(D > 0)) errores.push('Capture el diámetro máximo.');
    else if (finito(lim.seccion_min_mm) && D < lim.seccion_min_mm) errores.push(`El diámetro debe ser de al menos ${lim.seccion_min_mm} mm.`);
    else if (finito(lim.seccion_max_mm) && D > lim.seccion_max_mm) errores.push(`El diámetro no puede pasar de ${lim.seccion_max_mm} mm.`);
    if (!finito(L_m) || !(L_m > 0)) errores.push('Capture los metros hasta el punto más alejado.');
    else if (L_m > 100000) errores.push('Los metros no pueden pasar de 100 000.');
    const hoja_id = e0.hoja_id || R.hoja_defecto;
    const H = M.proveedor && M.proveedor.hojas && M.proveedor.hojas[hoja_id];
    const precio = H ? PROV.convertir(M, H.precio, PROV.kgHoja(M, H)) : null;
    if (!H) errores.push(`La lámina «${hoja_id}» no está en la lista del proveedor.`);
    else if (!precio) errores.push(`La lámina «${H.descripcion || hoja_id}» no tiene precio o medidas válidas en la lista del proveedor.`);
    const u = e0.utilidad_pct === undefined || e0.utilidad_pct === null || e0.utilidad_pct === '' ? R.utilidad_pct : Number(e0.utilidad_pct);
    if (!finito(u) || u < 0 || u > 10) errores.push('La utilidad debe ser de 0 % a 1 000 %.');
    const factor = R.factor_lamina;
    const iva = M.capas.iva_pct;
    const bridas = finito(L_m) && L_m > 0 ? bridasPara(M, L_m) : null;
    if (finito(L_m) && L_m > 0 && !bridas) {
      const max = Math.max(...R.bridas_por_metros.map((r) => r.hasta_m));
      errores.push(`Las bridas por metros llegan a ${max} m: para ${Number(L_m.toFixed(2))} m agregue un renglón en Tablas maestras › Cotización rápida o haga la cotización detallada.`);
    }
    if (errores.length) throw new U.ErrorValidacion(errores);

    // La plantilla de una yarda: perímetro medio + holgura de la costura del material (el galvanizado se engargola)
    const mat = M.materiales[H.material];
    const e = PROV.espesorHoja(M, H);
    const d = GEO.dimensionesRedondas(D, e, 'INTERIOR');
    const costura = M.proceso.costuras[mat.costura] || M.proceso.costuras.A_TOPE || { allowance_mm: 0 };
    const holgura = costura.allowance_mm || 0;
    const B = Math.PI * d.D_med + holgura;
    const Y = Number(H.ancho_mm);
    const Lh = Number(H.largo_mm);
    const yardas = Math.ceil(L_m * 1000 / Y - EPS);
    let n_hojas;
    let por_hoja;
    if (B <= Lh + EPS) {
      por_hoja = Math.floor(Lh / B + EPS);
      n_hojas = Math.ceil(yardas / por_hoja - EPS);
    } else {
      // cada yarda lleva hojas completas y un retazo; los retazos se acomodan juntos
      const completas = Math.floor(B / Lh + EPS);
      const retazo = B - completas * Lh;
      por_hoja = 0;
      n_hojas = yardas * completas + (retazo > 1 ? Math.ceil(yardas / Math.floor(Lh / retazo + EPS) - EPS) : 0);
    }
    const lamina = n_hojas * precio.sin_iva;
    const lamina_factor = lamina * factor;
    const costo = lamina_factor + bridas.importe;
    const utilidad = costo * u;
    const precio_neto = costo + utilidad;
    const iva_monto = precio_neto * iva;
    const advertencias = [];
    if (B > Lh + EPS) advertencias.push(`La plantilla de cada yarda (${Math.round(B)} mm) es más larga que la hoja (${Math.round(Lh)} mm): cada yarda sale de varias piezas.`);
    const aprovechado = (B * yardas * Y) / (n_hojas * Y * Lh);
    return {
      entrada: { D_mm: D, L_m, hoja_id, utilidad_pct: u },
      hoja: {
        id: hoja_id, descripcion: H.descripcion || hoja_id, material: H.material, calibre: H.calibre, ancho_mm: Y, largo_mm: Lh,
        espesor_mm: e, precio: precio.precio, sin_iva: precio.sin_iva, kg: precio.kg,
      },
      plantilla_mm: B, holgura_mm: holgura, costura: mat.costura, D_med_mm: d.D_med,
      yardas, yardas_por_hoja: por_hoja, hojas: n_hojas, aprovechamiento: aprovechado, kg: n_hojas * precio.kg,
      lamina, factor, lamina_factor,
      bridas,
      costo, utilidad_pct: u, utilidad, precio: precio_neto, iva_pct: iva, iva: iva_monto, total: precio_neto + iva_monto,
      advertencias,
    };
  }

  return { cotizar, hojas, bridasPara };
}));
