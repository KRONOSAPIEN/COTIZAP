/**
 * COTIZAP · rapida.js — Cotización rápida: un precio en minutos con el diámetro mayor y los metros hasta el punto más alejado.
 *
 * La regla del taller (7-oct-2026), con sus valores en las tablas maestras (`M.rapida`):
 *
 *   láminas  = hojas enteras de la lista del proveedor para hacer esos metros de ducto a ese diámetro
 *   lámina   = láminas × precio de la hoja sin IVA
 *   costo    = lámina × factor_lamina (3: cubre mano de obra, accesorios y lo demás) + bridas por metros
 *              + días de fabricación de bridas × personas × pago por día (1 × $500)
 *              + días de instalación × personas × pago por día (2 × $500)
 *              + lo que el factor no cubre: las ménsulas con su abrazadera (por piezas), las mangueras (por tramos y abrazaderas,
 *                del catálogo de compras) y los viáticos (importe sin IVA)
 *   precio   = costo × (1 + utilidad)            (la utilidad se SUMA sobre el costo)
 *   total    = precio × (1 + IVA)
 *
 * Bridas por metros: el primer renglón de `bridas_por_metros` cuyo «hasta m» alcanza los metros (hasta 40 m, $5,000; de 40 a
 * 80 m, $12,000; de 80 a 120 m, $18,000). Más metros que el último renglón no tienen precio de bridas: es error.
 *
 * Cómo se cuentan las hojas. El ducto se arma de yardas de 3 o 4 ft (la yarda es el largo de cada anillo); la plantilla de una
 * yarda es un rectángulo de yarda × B, con B el DESARROLLO (el perímetro medio, no el diámetro) más la holgura de la costura:
 *   B = π · (D + e) + holgura        (el diámetro es el interior, como en las partidas; 11″ galvanizado cal. 22: 912 mm)
 * Sin elegir lámina, de las hojas del ancho de la yarda (mismo material y calibre que la de las tablas) se usa la más barata
 * para ese diámetro: la que menos desperdicia.
 *   yardas = ⌈ metros ÷ yarda ⌉,   hojas = ⌈ yardas ÷ yardas por hoja ⌉
 * Las yardas por hoja salen de acomodar las plantillas en la hoja con cortes de guillotina (`acomodo`): todas derechas (la
 * yarda a lo ancho de la hoja, como en el tramo recto), todas giradas, o una franja de cada una. El acomodo trae el
 * rectángulo de cada plantilla para dibujar la hoja. Si la plantilla no cabe en la hoja de ninguna forma, cada yarda lleva
 * hojas completas y un retazo, y los retazos se acomodan juntos.
 * Los días de fabricación (de las bridas) y de instalación dan el plazo y suman su mano de obra al costo, antes de la utilidad.
 * Lo que el factor de la lámina no cubre (en el proyecto de referencia, cerca de $10,650) entra al costo, antes de la utilidad,
 * por piezas y con los precios de las tablas (el taller, 8-oct-2026):
 *   · ménsulas: las que estime el ingeniero (`menulas`; 'AUTO' = las sugeridas, ⌈metros ÷ 2.5 m⌉ con la separación horizontal
 *     de proceso.soportes.espaciado), cada una con su abrazadera, del ángulo y la solera que se elijan (de la lista del
 *     proveedor; sin elegir, las de `rapida.soporteria`). Su costo directo (material, anclajes y taller) sale de cotizarlas
 *     como partidas de soportería;
 *   · mangueras: tramos del artículo del catálogo de compras que se elija y sus abrazaderas de manguera (sin decir cuántas,
 *     `abrazaderas_por_tramo` por tramo), a su precio sin IVA;
 *   · viáticos: un importe sin IVA.
 * Pura: no muta nada; lanza ErrorValidacion con mensajes legibles.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./geometria'), require('./proveedor'), require('./validacion'), require('./cotizador'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.rapida = factory(root.COTIZAP.util, root.COTIZAP.geometria, root.COTIZAP.proveedor, root.COTIZAP.validacion, root.COTIZAP.cotizador);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, PROV, VAL, COT) {
  'use strict';

  const EPS = 1e-6;
  const HOLGURA_MM = 3; // una yarda de 1 220 mm cabe en la hoja de 4 ft (1 219 mm): son la misma medida
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const cuantas = (disponible, medida) => (medida > 0 ? Math.max(0, Math.floor((disponible + HOLGURA_MM) / medida + EPS)) : 0);

  /** Las hojas de la lista del proveedor con que se puede cotizar (con precio y kg calculables): [{ id, descripcion, … }]. */
  function hojas(M) {
    const H = (M.proveedor && M.proveedor.hojas) || {};
    return Object.keys(H)
      .filter((id) => H[id] && Number(H[id].calibre) > 0 && M.materiales[H[id].material] && PROV.convertir(M, H[id].precio, PROV.kgHoja(M, H[id]))) // lámina, no placa
      .map((id) => ({ id, descripcion: H[id].descripcion || id, material: H[id].material, calibre: H[id].calibre, ancho_mm: H[id].ancho_mm, largo_mm: H[id].largo_mm }));
  }

  /** Los largos de yarda que se ofrecen: los de las tablas (3 ft = 914 mm y 4 ft = 1 220 mm). */
  function yardas(M) {
    const AY = M.proceso && M.proceso.armado_yardas;
    return (AY && Array.isArray(AY.yardas_mm) ? AY.yardas_mm : [914, 1220]).filter((y) => finito(y) && y > 0);
  }

  /** El renglón de bridas por metros que toca a `L_m` (o null si los metros pasan del último). */
  function bridasPara(M, L_m) {
    const filas = M.rapida.bridas_por_metros; // van de menor a mayor (lo revisa la validación de las tablas)
    const i = filas.findIndex((r) => L_m <= r.hasta_m + EPS);
    if (i < 0) return null;
    return { desde_m: i > 0 ? filas[i - 1].hasta_m : 0, hasta_m: filas[i].hasta_m, importe: filas[i].importe };
  }

  /**
   * La plantilla de una yarda en la hoja `H` para un ducto de `D` mm (interior): el DESARROLLO —el perímetro medio, π × (D + e),
   * no el diámetro— más la holgura de la costura del material (el galvanizado se engargola: Pittsburgh).
   */
  function plantillaDe(M, H, D) {
    const mat = M.materiales[H.material];
    const e = PROV.espesorHoja(M, H);
    const d = GEO.dimensionesRedondas(D, e, 'INTERIOR');
    const costura = M.proceso.costuras[mat.costura] || M.proceso.costuras.A_TOPE || { allowance_mm: 0 };
    const holgura = costura.allowance_mm || 0;
    return { e, d, holgura, costura: mat.costura, B: Math.PI * d.D_med + holgura };
  }

  /**
   * Las hojas que pueden servir sin elegir lámina: las del mismo material y calibre que la de las tablas cuyo ancho es la yarda
   * (la yarda es el ancho de la lámina: para yardas de 3 ft, las de 3 × 10 y 3 × 8 ft); si no hay ninguna, la de las tablas.
   */
  function hojasDeLaYarda(M, yarda) {
    const H = (M.proveedor && M.proveedor.hojas) || {};
    const base = H[M.rapida.hoja_defecto];
    if (!base || !finito(yarda)) return [M.rapida.hoja_defecto];
    const delAncho = hojas(M).filter((x) => x.material === base.material && Number(x.calibre) === Number(base.calibre) && Math.abs(x.ancho_mm - yarda) <= HOLGURA_MM)
      .map((x) => x.id).sort((a, b) => (a === M.rapida.hoja_defecto ? -1 : b === M.rapida.hoja_defecto ? 1 : 0));
    return delAncho.length ? delAncho : [M.rapida.hoja_defecto];
  }

  /** Cuánto cuesta la lámina de `L_m` metros a `D` mm en la hoja `id` con yardas de `yarda` mm (Infinity si no se acomoda). */
  function costoLamina(M, id, yarda, D, L_m) {
    const H = M.proveedor.hojas[id];
    const p = H ? PROV.convertir(M, H.precio, PROV.kgHoja(M, H)) : null;
    if (!p) return Infinity;
    const n = acomodo(H.ancho_mm, H.largo_mm, yarda, plantillaDe(M, H, D).B).n;
    return n > 0 ? Math.ceil(Math.ceil((L_m * 1000) / yarda - EPS) / n - EPS) * p.sin_iva : Infinity;
  }

  /**
   * La hoja con que se cotiza: la elegida; si no, de las hojas del ancho de la yarda (`hojasDeLaYarda`), la que sale más barata
   * para ese diámetro y esos metros —la que menos lámina desperdicia—; a igualdad, la de las tablas y luego el orden de la lista.
   */
  function hojaPara(M, hoja_id, yarda, D, L_m) {
    if (hoja_id) return hoja_id;
    const ids = hojasDeLaYarda(M, yarda);
    if (ids.length < 2 || !(D > 0) || !(L_m > 0)) return ids[0];
    const costos = ids.map((id) => { try { return costoLamina(M, id, yarda, D, L_m); } catch (err) { return Infinity; } });
    return ids.reduce((mejor, id, i) => (costos[i] < costos[ids.indexOf(mejor)] - 0.005 ? id : mejor), ids[0]);
  }

  /**
   * Acomodo de plantillas de yarda × B en una hoja de ancho × largo, con cortes de guillotina. Coordenadas de la hoja: x a lo
   * largo (0 … largo), y a lo ancho (0 … ancho). Una plantilla DERECHA lleva la yarda a lo ancho de la hoja (w = B en x,
   * h = yarda en y), como en el tramo recto; GIRADA, al revés. Se prueban: todas derechas, todas giradas, y una franja de
   * columnas o de renglones de una orientación con el resto de la hoja de la otra (o de la misma). Gana la que da más
   * plantillas; a igualdad, la más simple (todas derechas, luego todas giradas).
   * Devuelve { n, piezas: [{ x, y, w, h, girada }], forma: 'DERECHAS' | 'GIRADAS' | 'MIXTO' }.
   */
  function acomodo(ancho, largo, yarda, B) {
    const ori = [{ w: B, h: yarda, girada: false }, { w: yarda, h: B, girada: true }];
    const rejilla = (x0, y0, L, A, o) => {
      const nx = cuantas(L, o.w);
      const ny = cuantas(A, o.h);
      const piezas = [];
      for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) piezas.push({ x: x0 + i * o.w, y: y0 + j * o.h, w: o.w, h: o.h, girada: o.girada });
      return piezas;
    };
    const mejorRejilla = (x0, y0, L, A) => {
      const a = rejilla(x0, y0, L, A, ori[0]);
      const b = rejilla(x0, y0, L, A, ori[1]);
      return b.length > a.length ? b : a;
    };
    const candidatos = [
      { forma: 'DERECHAS', piezas: rejilla(0, 0, largo, ancho, ori[0]) },
      { forma: 'GIRADAS', piezas: rejilla(0, 0, largo, ancho, ori[1]) },
    ];
    ori.forEach((o) => {
      // m columnas de esta orientación a lo largo y el resto del largo con la mejor rejilla
      const ny = cuantas(ancho, o.h);
      if (ny > 0) {
        for (let m = 1; m <= cuantas(largo, o.w); m += 1) {
          const usado = m * o.w;
          candidatos.push({ forma: 'MIXTO', piezas: [...rejilla(0, 0, usado, ancho, o), ...mejorRejilla(usado, 0, Math.max(0, largo - usado), ancho)] });
        }
      }
      // k renglones de esta orientación a lo ancho y el resto del ancho con la mejor rejilla
      const nx = cuantas(largo, o.w);
      if (nx > 0) {
        for (let k = 1; k <= cuantas(ancho, o.h); k += 1) {
          const usado = k * o.h;
          candidatos.push({ forma: 'MIXTO', piezas: [...rejilla(0, 0, largo, usado, o), ...mejorRejilla(0, usado, largo, Math.max(0, ancho - usado))] });
        }
      }
    });
    const mejor = candidatos.reduce((a, c) => (c.piezas.length > a.piezas.length ? c : a), candidatos[0]);
    const todas = mejor.piezas.every((p) => p.girada) ? 'GIRADAS' : mejor.piezas.every((p) => !p.girada) ? 'DERECHAS' : 'MIXTO';
    return { n: mejor.piezas.length, piezas: mejor.piezas, forma: mejor.piezas.length ? todas : 'NINGUNA' };
  }

  const leerDias = (v, nombre, errores) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!finito(n) || n < 0 || n > 365) { errores.push(`Los días de ${nombre} deben ser de 0 a 365.`); return null; }
    return n;
  };

  const leerImporte = (v, nombre, errores) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!finito(n) || n < 0 || n > 100000000) { errores.push(`El importe de ${nombre} debe ser de $0 a $100,000,000 (sin IVA).`); return null; }
    return n;
  };
  const leerPiezas = (v, nombre, errores) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) { errores.push(`${nombre} debe ser un número entero de piezas, de 0 a 100 000.`); return null; }
    return n;
  };

  /** SOLERA o ANGULO: el tipo de una barra de la lista del proveedor (el suyo o el de su perfil). */
  function tipoBarra(M, id) {
    const b = M.proveedor && M.proveedor.barras && M.proveedor.barras[id];
    if (!b) return null;
    if (b.tipo) return b.tipo;
    const pf = b.perfil && M.herrajes && M.herrajes.perfiles && M.herrajes.perfiles[b.perfil];
    return pf ? pf.tipo : null;
  }
  /** Las barras con precio de la lista del proveedor de un tipo: [{ id, descripcion }] (para elegir la ménsula y la abrazadera). */
  function barrasDeTipo(M, tipo) {
    return Object.keys((M.proveedor && M.proveedor.barras) || {}).filter((id) => tipoBarra(M, id) === tipo && PROV.barra(M, id)).map((id) => ({ id, descripcion: M.proveedor.barras[id].descripcion || id }));
  }
  /** Los artículos del catálogo de compras que son mangueras (para elegir cuál): [{ id, descripcion, unidad }]. */
  function manguerasDelCatalogo(M) {
    const A = (M.compras && M.compras.articulos) || {};
    return Object.keys(A).filter((id) => /^MANGUERA/.test(id) || /^manguera/i.test(A[id].descripcion || '')).map((id) => ({ id, descripcion: A[id].descripcion || id, unidad: A[id].unidad || 'pza' }));
  }
  /** Las ménsulas que se sugieren para L_m metros: una cada «horizontal_m» (2.5 m), al menos una; null sin la regla. */
  function menulasSugeridas(M, L_m) {
    const E = M.proceso && M.proceso.soportes && M.proceso.soportes.espaciado;
    if (!E || !(E.horizontal_m > 0) || !(L_m > 0)) return null;
    return Math.max(1, Math.ceil(L_m / E.horizontal_m - EPS));
  }

  /**
   * n ménsulas, cada una con su abrazadera para el ducto de diámetro D: su costo directo (material, anclajes y minutos de taller),
   * cotizadas como partidas de soportería con los datos de `rapida.soporteria` y el ángulo y la solera elegidos.
   */
  function costoSoporteria(M, D, n, barras) {
    const S = M.rapida.soporteria;
    const partida = (p) => {
      try {
        return COT.cotizarPartida({ familia: 'SOPORTE', cantidad: n, cantidad_modo: 'MANUAL', ...p }, M);
      } catch (err) {
        if (err instanceof U.ErrorValidacion) throw new U.ErrorValidacion(err.errores.map((m) => `Ménsulas: ${m}`));
        throw err;
      }
    };
    const men = partida({ descripcion: 'Ménsulas', barra_id: barras.menula, largo_pieza_mm: S.menula_largo_mm, anclajes_pieza: S.menula_anclajes, min_pieza: S.menula_min > 0 ? S.menula_min : undefined });
    const abz = partida({ descripcion: 'Abrazaderas', barra_id: barras.abrazadera, abrazadera_D_mm: D, abrazadera_vuelta: S.abrazadera_vuelta, min_pieza: S.abrazadera_min > 0 ? S.abrazadera_min : undefined });
    const pieza = (f) => ({ barra_id: f.soporte.barra.id, barra: f.soporte.barra.descripcion, largo_mm: f.soporte.largo_pieza_mm, anclajes: f.soporte.anclajes / n, minutos: f.soporte.minutos_pieza, costo: f.costos.CD, unitario: f.costos.CD / n });
    const menula = pieza(men);
    const abrazadera = { ...pieza(abz), vuelta: abz.soporte.vuelta };
    return { menula, abrazadera, unitario: menula.unitario + abrazadera.unitario, importe: menula.costo + abrazadera.costo };
  }

  /** Un artículo del catálogo de compras a su precio sin IVA: { id, descripcion, unidad, unitario }. */
  function articulo(M, id) {
    const a = M.compras && M.compras.articulos && M.compras.articulos[id];
    if (!a || !finito(a.precio) || !finito(M.compras.iva_pct)) return null;
    return { id, descripcion: a.descripcion || id, unidad: a.unidad || 'pza', unitario: a.iva_incluido === true ? a.precio / (1 + M.compras.iva_pct) : a.precio };
  }

  /**
   * entrada: { D_mm, L_m, yarda_mm?, hoja_id?, utilidad_pct?, dias_fabricacion?, dias_instalacion?,
   *            menulas? (piezas, o 'AUTO' = las sugeridas; vacío = no lleva), menula_barra?, abrazadera_barra?,
   *            mangueras_tramos?, manguera_id?, abrazaderas_manguera? (vacío = abrazaderas_por_tramo por tramo), viaticos? (MXN sin IVA) }
   * (utilidad en fracción: 0.20)
   * Devuelve el desglose: hoja, plantilla, acomodo, yardas, hojas, lámina, factor, bridas, mano de obra por días, costo, utilidad,
   * precio, IVA, total y plazo.
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
    const AY = M.proceso.armado_yardas || {};
    const Y = e0.yarda_mm === undefined || e0.yarda_mm === null || e0.yarda_mm === '' ? AY.yarda_defecto_mm : Number(e0.yarda_mm);
    if (!finito(Y) || !(Y > 0)) errores.push('El largo de la yarda debe ser mayor que 0.');
    else if ((finito(lim.yarda_min_mm) && Y < lim.yarda_min_mm) || (finito(lim.yarda_max_mm) && Y > lim.yarda_max_mm)) errores.push(`La yarda debe ser de ${lim.yarda_min_mm} a ${lim.yarda_max_mm} mm.`);
    const candidatas = e0.hoja_id ? [] : hojasDeLaYarda(M, Y);
    const hoja_id = hojaPara(M, e0.hoja_id, Y, finito(D) && D > 0 ? D : undefined, finito(L_m) && L_m > 0 && L_m <= 100000 ? L_m : undefined);
    const H = M.proveedor && M.proveedor.hojas && M.proveedor.hojas[hoja_id];
    const precio = H ? PROV.convertir(M, H.precio, PROV.kgHoja(M, H)) : null;
    if (!H) errores.push(`La lámina «${hoja_id}» no está en la lista del proveedor.`);
    else if (!precio) errores.push(`La lámina «${H.descripcion || hoja_id}» no tiene precio o medidas válidas en la lista del proveedor.`);
    else if (finito(Y) && Y > Math.max(H.ancho_mm, H.largo_mm) + HOLGURA_MM) errores.push(`Una yarda de ${Math.round(Y)} mm no cabe en la lámina de ${Math.round(H.ancho_mm)} × ${Math.round(H.largo_mm)} mm.`);
    const u = e0.utilidad_pct === undefined || e0.utilidad_pct === null || e0.utilidad_pct === '' ? R.utilidad_pct : Number(e0.utilidad_pct);
    if (!finito(u) || u < 0 || u > 10) errores.push('La utilidad debe ser de 0 % a 1 000 %.');
    const diasFab = leerDias(e0.dias_fabricacion, 'fabricación', errores);
    const diasIns = leerDias(e0.dias_instalacion, 'instalación', errores);
    // Lo que el factor no cubre: ménsulas (por piezas, del ángulo y la solera elegidos), mangueras (por tramos) y viáticos
    const viaticos = leerImporte(e0.viaticos, 'viáticos', errores);
    const sugeridas = finito(L_m) && L_m > 0 && L_m <= 100000 ? menulasSugeridas(M, L_m) : null;
    const auto = e0.menulas === 'AUTO';
    const nMen = auto ? sugeridas : leerPiezas(e0.menulas, 'Las ménsulas', errores);
    if (auto && sugeridas === null && finito(L_m) && L_m > 0) errores.push('Para sugerir las ménsulas faltan las reglas de espaciamiento de soportes en las tablas maestras (Proceso › Soportería).');
    const S = R.soporteria;
    const barras = { menula: e0.menula_barra || S.menula_barra, abrazadera: e0.abrazadera_barra || S.abrazadera_barra };
    if (nMen > 0) {
      if (!PROV.barra(M, barras.menula)) errores.push(`El ángulo de la ménsula «${String(barras.menula)}» no está (con precio) en la lista del proveedor.`);
      if (!PROV.barra(M, barras.abrazadera)) errores.push(`La solera de la abrazadera «${String(barras.abrazadera)}» no está (con precio) en la lista del proveedor.`);
    }
    const tramos = leerPiezas(e0.mangueras_tramos, 'Los tramos de manguera', errores);
    const MG = R.mangueras;
    const abzPedidas = leerPiezas(e0.abrazaderas_manguera, 'Las abrazaderas de manguera', errores);
    const mangueraId = e0.manguera_id || MG.articulo;
    const manguera = tramos > 0 ? articulo(M, mangueraId) : null;
    const abzManguera = (tramos > 0 || abzPedidas > 0) ? articulo(M, MG.abrazadera) : null;
    if (tramos > 0 && !manguera) errores.push(`La manguera «${String(mangueraId)}» no está (con precio) en el catálogo de compras.`);
    if ((tramos > 0 || abzPedidas > 0) && !abzManguera) errores.push(`La abrazadera de manguera «${String(MG.abrazadera)}» no está (con precio) en el catálogo de compras.`);
    const factor = R.factor_lamina;
    const iva = M.capas.iva_pct;
    const bridas = finito(L_m) && L_m > 0 ? bridasPara(M, L_m) : null;
    if (finito(L_m) && L_m > 0 && !bridas) {
      const max = Math.max(...R.bridas_por_metros.map((r) => r.hasta_m));
      errores.push(`Las bridas por metros llegan a ${max} m: para ${Number(L_m.toFixed(2))} m agregue un renglón en Tablas maestras › Cotización rápida o haga la cotización detallada.`);
    }
    if (errores.length) throw new U.ErrorValidacion(errores);

    // La plantilla de una yarda: el desarrollo (perímetro medio) + la holgura de la costura del material
    const { e, d, holgura, costura, B } = plantillaDe(M, H, D);
    const W = Number(H.ancho_mm);
    const Lh = Number(H.largo_mm);
    const n_yardas = Math.ceil((L_m * 1000) / Y - EPS);
    const aco = acomodo(W, Lh, Y, B);
    const advertencias = [];
    let n_hojas;
    if (aco.n > 0) n_hojas = Math.ceil(n_yardas / aco.n - EPS);
    else {
      // la plantilla no cabe en la hoja: cada yarda lleva hojas completas a lo largo y un retazo; los retazos se acomodan juntos
      const completas = Math.floor(B / Lh + EPS);
      const retazo = B - completas * Lh;
      n_hojas = n_yardas * completas + (retazo > 1 ? Math.ceil(n_yardas / Math.max(1, cuantas(Lh, retazo)) - EPS) : 0);
      advertencias.push(`La plantilla de cada yarda (${Math.round(B)} mm) es más larga que la lámina (${Math.round(Lh)} mm): cada yarda sale de varias piezas.`);
    }
    const ultima = aco.n > 0 ? n_yardas - (n_hojas - 1) * aco.n : 0; // yardas que lleva la última hoja
    const lamina = n_hojas * precio.sin_iva;
    const lamina_factor = lamina * factor;
    // la mano de obra de los días: días × personas × pago por día (sin días, nada)
    const cuadrilla = (dias, personas, pago) => ({ dias: dias || 0, personas, pago_dia: pago, importe: (dias || 0) * personas * pago });
    const mano_obra = {
      fabricacion: cuadrilla(diasFab, R.personas_fabricacion, R.pago_dia_fabricacion),
      instalacion: cuadrilla(diasIns, R.personas_instalacion, R.pago_dia_instalacion),
    };
    // las ménsulas con su abrazadera, costeadas como partidas de soportería
    const E = M.proceso.soportes && M.proceso.soportes.espaciado;
    const soporteria = {
      menulas: nMen || 0, sugeridas, sugeridas_usadas: auto, separacion_m: E ? E.horizontal_m : null,
      ...(nMen > 0 ? costoSoporteria(M, D, nMen, barras) : { menula: null, abrazadera: null, unitario: 0, importe: 0 }),
    };
    // las mangueras: tramos del catálogo y sus abrazaderas (sin decir cuántas, las de cada tramo)
    const n_abz = abzPedidas !== null ? abzPedidas : (tramos || 0) * MG.abrazaderas_por_tramo;
    const mangueras = {
      tramos: tramos || 0, manguera, abrazaderas: n_abz, abrazaderas_sugeridas: abzPedidas === null, abrazaderas_por_tramo: MG.abrazaderas_por_tramo, abrazadera: n_abz > 0 ? abzManguera : null,
      importe: (tramos || 0) * (manguera ? manguera.unitario : 0) + (n_abz > 0 && abzManguera ? n_abz * abzManguera.unitario : 0),
    };
    const extras = { mangueras: mangueras.importe, soporteria: soporteria.importe, viaticos: viaticos || 0 };
    extras.importe = extras.mangueras + extras.soporteria + extras.viaticos;
    const costo = lamina_factor + bridas.importe + mano_obra.fabricacion.importe + mano_obra.instalacion.importe + extras.importe;
    const utilidad = costo * u;
    const precio_neto = costo + utilidad;
    const iva_monto = precio_neto * iva;
    const aprovechado = Math.min(1, (B * Y * n_yardas) / (n_hojas * W * Lh));
    return {
      entrada: { D_mm: D, L_m, yarda_mm: Y, hoja_id, utilidad_pct: u, dias_fabricacion: diasFab, dias_instalacion: diasIns,
        menulas: auto ? 'AUTO' : nMen, menula_barra: barras.menula, abrazadera_barra: barras.abrazadera, mangueras_tramos: tramos, manguera_id: mangueraId, abrazaderas_manguera: abzPedidas, viaticos,
      },
      hoja: {
        id: hoja_id, descripcion: H.descripcion || hoja_id, material: H.material, calibre: H.calibre, ancho_mm: W, largo_mm: Lh,
        espesor_mm: e, precio: precio.precio, sin_iva: precio.sin_iva, kg: precio.kg,
      },
      plantilla_mm: B, desarrollo_mm: B - holgura, holgura_mm: holgura, costura, D_med_mm: d.D_med, yarda_mm: Y,
      hoja_auto: !e0.hoja_id, hojas_comparadas: candidatas.length, // sin elegir lámina: de cuántas hojas del ancho de la yarda se tomó la más barata
      acomodo: aco, yardas: n_yardas, yardas_por_hoja: aco.n, yardas_ultima_hoja: ultima, hojas: n_hojas, aprovechamiento: aprovechado, kg: n_hojas * precio.kg,
      lamina, factor, lamina_factor,
      bridas, mano_obra, extras, soporteria, mangueras,
      costo, utilidad_pct: u, utilidad, precio: precio_neto, iva_pct: iva, iva: iva_monto, total: precio_neto + iva_monto,
      plazo: diasFab === null && diasIns === null ? null : { fabricacion: diasFab || 0, instalacion: diasIns || 0, total: (diasFab || 0) + (diasIns || 0) },
      advertencias,
    };
  }

  return { cotizar, menulasSugeridas, barrasDeTipo, tipoBarra, manguerasDelCatalogo, hojas, yardas, bridasPara, acomodo, hojaPara, hojasDeLaYarda, plantillaDe };
}));
