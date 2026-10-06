/**
 * COTIZAP · validacion.js — Compuerta de entrada del motor.
 *
 * Todo dato que entra a un cálculo pasa primero por aquí. Llega de la interfaz, de un archivo importado o de una
 * cotización guardada hace meses (la partida), o lo edita el usuario en las tablas (los maestros). Se revisa:
 *   · el tipo        — un número es un número finito (se acepta «12.5» como 12.5; nunca [5], true, NaN ni Infinity);
 *   · el rango       — tamaños, longitudes, espesores y cantidades dentro de los límites del taller (maestros:
 *                      proceso.limites), sin negativos ni «casi cero»;
 *   · la pertenencia — familia, material, servicio… deben existir en las tablas; omitir_operaciones y subcontratos
 *                      son listas de lo esperado;
 *   · los maestros   — divisores en cero, valores negativos o tablas de velocidad sin sentido se señalan por su ruta
 *                      antes de que den un NaN o un precio infinito.
 * Nada de esto cambia un cálculo válido: convierte lo absurdo en un mensaje claro en lugar de un NaN, un precio de
 * miles de millones o un cierre del programa. La política del taller (ángulos permitidos) vive en cotizador.js; la
 * geometría (lo físicamente posible) en geometria.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./mano_obra'), require('./precios'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.validacion = factory(root.COTIZAP.util, root.COTIZAP.manoObra, root.COTIZAP.precios);
  }
}(typeof self !== 'undefined' ? self : this, function (U, MO, PRE) {
  'use strict';

  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const claves = (o) => (esObjeto(o) ? Object.keys(o) : []);
  const tiene = (o, k) => esObjeto(o) && Object.prototype.hasOwnProperty.call(o, k);
  const RE_NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  /** Número finito a partir de un número o de un texto numérico («12.5»); NaN para todo lo demás (booleanos, listas, NaN, Infinity…). */
  function aNumero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && RE_NUMERO.test(v.trim())) {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  /** Cómo se muestra un valor ofensor dentro de un mensaje: corto y sin romper nada. */
  function texto(v) {
    let s;
    if (typeof v === 'string') s = v.trim();
    else if (v === undefined) s = 'sin valor';
    else if (typeof v === 'number') s = String(v); // NaN e Infinity, no «null»
    else {
      try { s = JSON.stringify(v); } catch (e) { s = undefined; }
      if (s === undefined) s = String(v);
    }
    return s.length > 24 ? `${s.slice(0, 23)}…` : s;
  }

  /* ------------------------------------------------------------------ */
  /* Partida                                                            */
  /* ------------------------------------------------------------------ */

  /** Límites de captura de las tablas maestras (`proceso.limites`); un nombre que falte no limita. */
  const limitesDe = (M) => (M && M.proceso && esObjeto(M.proceso.limites) ? M.proceso.limites : {});
  const resolver = (L, x) => (typeof x === 'string' ? L[x] : x);

  // Un campo: { tipo: 'num' | 'int', etiqueta, min, max, u (unidad), pct, cero }. `min` y `max` son números o el nombre de un
  // límite de maestros. `cero`: el campo es opcional y vacío significa «automático» o «ninguno» (el motor trata el 0 igual).
  const campo = (tipo, etiqueta, min, max, extra) => ({ tipo, etiqueta, min, max, ...extra });
  const dim = (e, extra) => campo('num', e, 'seccion_min_mm', 'seccion_max_mm', { u: 'mm', ...extra });
  const largo = (e, extra) => campo('num', e, 'largo_min_mm', 'largo_max_mm', { u: 'mm', ...extra });
  const real = (e, min, max, u, extra) => campo('num', e, min, max, { u, ...extra });
  const entero = (e, min, max, extra) => campo('int', e, min, max, extra);

  const TOPE_LARGO_M = 10000; // m (cordura): ninguna longitud de proceso de una pieza llega a tanto
  const medidas = (p) => (p.forma === 'RECTANGULAR' ? { a_mm: dim('Ancho a'), b_mm: dim('Alto b') } : { D_mm: dim('Diámetro') });

  /** Campos numéricos propios de cada familia (los demás campos de la partida no se revisan ni se tocan). */
  const CAMPOS_FAMILIA = {
    RECTO: (p) => ({
      ...medidas(p),
      L_mm: largo('Longitud total'),
      yarda_mm: campo('num', 'Ancho de la yarda', 'yarda_min_mm', 'yarda_max_mm', { u: 'mm', cero: true }),
      ...(p.forma === 'RECTANGULAR' ? { n_costuras_long: entero('Costuras longitudinales', 1, 8) } : {}),
    }),
    CODO: (p) => ({
      ...medidas(p),
      theta_deg: real('Ángulo del codo', 0, 360, '°'),
      k_R: real('Relación R/D', 0.5, 20, ''),
      ...(p.forma === 'RECTANGULAR' ? {} : { n_gajos: entero('Gajos', 2, 60, { cero: true }), L_tangente_mm: largo('Tangente en cada extremo', { cero: true }) }),
    }),
    REDUCCION: () => ({ D1_mm: dim('Diámetro mayor D1'), D2_mm: dim('Diámetro menor D2'), L_mm: largo('Longitud axial', { cero: true }) }),
    TRANSICION: () => ({
      D_mm: dim('Diámetro (extremo redondo)'), a_mm: dim('Ancho a'), b_mm: dim('Alto b'), H_mm: largo('Longitud axial', { cero: true }), n_costuras_long: entero('Costuras longitudinales', 1, 8),
    }),
    RAMAL: () => ({
      D_mm: dim('Diámetro del tronco'), d_mm: dim('Diámetro del injerto'), L_cuerpo_mm: largo('Longitud del tronco'), L_ramal_mm: largo('Longitud del injerto'), beta_deg: real('Ángulo del injerto', 0, 180, '°'),
    }),
    REDUCCION_INJERTO: () => ({
      D1_mm: dim('Diámetro mayor D1'), D2_mm: dim('Diámetro menor D2'), d_mm: dim('Diámetro del injerto'), beta_deg: real('Ángulo del injerto', 0, 180, '°'),
      L_reduccion_mm: largo('Longitud de la reducción', { cero: true }), L_ramal_mm: largo('Longitud del injerto', { cero: true }),
    }),
    PANTALON: () => ({
      D_mm: dim('Diámetro del tronco'), d1_mm: dim('Diámetro del ramal 1'), d2_mm: dim('Diámetro del ramal 2'),
      L_tronco_mm: largo('Longitud del tronco'), L1_mm: largo('Longitud del ramal 1'), L2_mm: largo('Longitud del ramal 2'), k_entrepierna: real('Factor de entrepierna', 0, 1, ''),
    }),
    PERSONALIZADO: () => ({
      A_neta_m2: real('Área neta desarrollada', 0.001, 10000, 'm²'),
      L_corte_m: real('Longitud de corte', 0, TOPE_LARGO_M, 'm'),
      L_sold_tope_m: real('Soldadura a tope', 0, TOPE_LARGO_M, 'm'),
      L_sold_filete_m: real('Soldadura de filete', 0, TOPE_LARGO_M, 'm'),
      L_virola_m: real('Longitud de virola', 0, TOPE_LARGO_M, 'm'),
      n_piezas: entero('Piezas a armar', 1, 'piezas_max'),
      n_virolas: entero('Virolas a rolar', 0, 'piezas_max'),
      n_extremos: entero('Extremos a unir', 0, 1000),
      D_ref_mm: dim('Diámetro de los extremos', { cero: true }),
    }),
    COMPRADO: () => ({
      precio_compra_unitario: real('Costo de compra unitario', 0, 1e8, 'MXN'),
      peso_kg: real('Peso unitario', 0, 1e6, 'kg'),
    }),
  };

  /** Campos sí/no de una partida que se fabrica. */
  const BOOLEANOS = { usa_empaque: 'Empaque', ajuste_sin_brida: 'Tramo de ajuste sin brida' };

  /** Campos que valen para toda partida que se fabrica (todas menos COMPRADO). */
  const CAMPOS_FABRICADA = {
    espesor_mm: campo('num', 'Espesor', 'espesor_min_mm', 'espesor_max_mm', { u: 'mm' }),
    merma_pct: real('Merma', 0, 0.9, '', { pct: true }),
    n_espigas: entero('Extremos con espiga', 0, 1000),
    L_penetraciones_m: real('Penetraciones a sellar', 0, TOPE_LARGO_M, 'm'),
  };

  /** Convierte y revisa un valor numérico de la partida. Devuelve el número, `undefined` (vacío) o `null` (inválido: ya se agregó el error). */
  function revisarNumero(v, c, L, errores) {
    if (vacio(v)) return undefined;
    const n = aNumero(v);
    if (Number.isNaN(n)) {
      errores.push(`${c.etiqueta}: «${texto(v)}» no es ${c.tipo === 'int' ? 'un número entero' : 'un número'}.`);
      return null;
    }
    if (c.tipo === 'int' && !Number.isInteger(n)) {
      errores.push(`${c.etiqueta}: debe ser un número entero (trae ${n}).`);
      return null;
    }
    const lo = resolver(L, c.min);
    const hi = resolver(L, c.max);
    const hayLo = Number.isFinite(lo);
    const hayHi = Number.isFinite(hi);
    if (((hayLo && n < lo) || (hayHi && n > hi)) && !(c.cero && n === 0)) {
      const f = (x) => (c.pct ? `${U.redondear(x * 100, 2)} %` : `${x}${c.u ? ` ${c.u}` : ''}`);
      const rango = hayLo && hayHi ? `estar entre ${f(lo)} y ${f(hi)}` : hayHi ? `ser como máximo ${f(hi)}` : `ser como mínimo ${f(lo)}`;
      errores.push(`${c.etiqueta}: debe ${rango}${c.cero ? ' (o quedar vacío)' : ''}; trae ${f(n)}.`);
      return null;
    }
    return n;
  }

  /** Campos de la partida que sólo admiten ciertos valores: [campo, valores permitidos, nombre para el mensaje]. */
  function enumeraciones(p, M) {
    const sub = (o, k) => (esObjeto(o) ? o[k] : undefined);
    const fam = p.familia;
    const lista = [];
    if (fam !== 'COMPRADO') {
      lista.push(['ref_diametro', ['INTERIOR', 'EXTERIOR'], 'Dimensión nominal'],
        ['tipo_union', claves(sub(M.herrajes, 'uniones')), 'Tipo de unión'],
        ['clase_sellado', ['NINGUNA', 'A', 'B', 'C'], 'Clase de sellado'],
        ['pintura', claves(sub(sub(M.proceso, 'pintura'), 'sistemas')), 'Sistema de pintura'],
        ['servicio', claves(M.servicios), 'Servicio'],
        ['proceso_corte', claves(sub(sub(M.proceso, 'corte'), 'v_m_min')), 'Proceso de corte'],
        ['perfil_id', claves(sub(M.herrajes, 'perfiles')), 'Perfil de aros']);
      if (fam === 'RECTO' || fam === 'CODO') lista.push(['forma', ['REDONDA', 'RECTANGULAR'], 'Sección']);
      if (fam === 'RECTO') lista.push(['tipo_costura', claves(sub(M.proceso, 'costuras')), 'Tipo de costura']);
      if (fam === 'REDUCCION') lista.push(['excentrica', ['NO', 'CARA_PLANA'], 'Tipo de reducción']);
    }
    lista.push(['riesgo', claves(sub(M.capas, 'imprevistos_pct')), 'Clase de riesgo']);
    return lista;
  }

  /** omitir_operaciones y subcontratos: listas de lo esperado, copiadas. */
  function revisarListas(p, errores) {
    if (vacio(p.omitir_operaciones)) delete p.omitir_operaciones;
    else if (!Array.isArray(p.omitir_operaciones)) errores.push('Operaciones omitidas: debe ser una lista de operaciones.');
    else if (p.omitir_operaciones.length > 50) errores.push('Operaciones omitidas: demasiados elementos.');
    else {
      p.omitir_operaciones.forEach((op) => {
        if (typeof op !== 'string' || !MO.OPERACIONES.includes(op)) errores.push(`Operación desconocida en omitir_operaciones: ${texto(op)}`);
      });
      p.omitir_operaciones = p.omitir_operaciones.slice();
    }

    if (vacio(p.subcontratos)) delete p.subcontratos;
    else if (!Array.isArray(p.subcontratos)) errores.push('Subcontratos: debe ser una lista.');
    else if (p.subcontratos.length > 50) errores.push('Subcontratos: demasiados elementos.');
    else {
      p.subcontratos = p.subcontratos.map((sc, i) => {
        if (!esObjeto(sc)) { errores.push(`Subcontrato ${i + 1}: no es válido.`); return sc; }
        const c = { ...sc };
        if (typeof c.driver !== 'string' || !PRE.DRIVERS_SUBCONTRATO.includes(c.driver)) errores.push(`Subcontrato ${i + 1}: driver desconocido «${texto(c.driver)}».`);
        const precio = aNumero(c.precio);
        if (precio >= 0 && precio <= 1e8) c.precio = precio;
        else errores.push(`Subcontrato ${i + 1}: precio inválido.`);
        if (typeof c.concepto !== 'string') c.concepto = typeof c.concepto === 'number' ? String(c.concepto) : 'Subcontrato';
        return c;
      });
    }
  }

  /**
   * Revisa una partida contra las tablas y la devuelve normalizada: { p, errores }. `p` es una copia: los números que
   * venían como texto numérico pasan a número, los vacíos opcionales («», null) se quitan y las listas se copian.
   */
  function normalizarPartida(entrada, M) {
    const errores = [];
    if (!esObjeto(entrada)) return { p: {}, errores: ['La partida no es válida (se esperaba un objeto con sus datos).'] };
    const p = { ...entrada };
    const fam = p.familia;
    if (typeof fam !== 'string' || !tiene(CAMPOS_FAMILIA, fam)) {
      errores.push(`Familia desconocida: ${texto(fam)}`);
      return { p, errores };
    }

    // Valores que sólo admiten una lista (un vacío opcional significa «según la cotización» o «automático»)
    try {
      enumeraciones(p, M).forEach(([k, permitidos, nombre]) => {
        if (vacio(p[k])) delete p[k];
        else if (typeof p[k] !== 'string' || !permitidos.includes(p[k])) errores.push(`${nombre}: «${texto(p[k])}» no existe${permitidos.length ? ` (use ${permitidos.join(', ')})` : ''}.`);
      });
    } catch (e) {
      errores.push('Las tablas maestras no tienen la forma esperada: restablézcalas.');
    }
    if (fam !== 'COMPRADO' && !(typeof p.material_id === 'string' && tiene(M && M.materiales, p.material_id))) errores.push(`Material desconocido: ${texto(p.material_id)}`);

    // Números
    const L = limitesDe(M);
    const campos = { cantidad: entero('Cantidad', 1, 'cantidad_max'), ...CAMPOS_FAMILIA[fam](p), ...(fam === 'COMPRADO' ? {} : CAMPOS_FABRICADA) };
    Object.keys(campos).forEach((k) => {
      if (k === 'cantidad' && vacio(p.cantidad)) { errores.push('La cantidad debe ser un entero mayor que 0.'); return; }
      const n = revisarNumero(p[k], campos[k], L, errores);
      if (n === undefined) delete p[k];
      else if (n !== null) p[k] = n;
    });

    if (fam !== 'COMPRADO') {
      // Calibre: sólo cuenta si no hay espesor propio (placa)
      if (!(p.espesor_mm > 0)) {
        if (vacio(p.calibre)) delete p.calibre;
        else if (Number.isNaN(aNumero(p.calibre))) errores.push(`Calibre: «${texto(p.calibre)}» no es un número (o capture el espesor propio).`);
        else p.calibre = aNumero(p.calibre);
      }
      // Caras pintadas: 1 (sólo exterior) o 2 (exterior e interior)
      if (vacio(p.caras_pintadas)) delete p.caras_pintadas;
      else if (aNumero(p.caras_pintadas) === 1 || aNumero(p.caras_pintadas) === 2) p.caras_pintadas = aNumero(p.caras_pintadas);
      else errores.push(`Caras pintadas: debe ser 1 o 2 (trae «${texto(p.caras_pintadas)}»).`);
      Object.keys(BOOLEANOS).forEach((k) => {
        if (vacio(p[k])) delete p[k];
        else if (typeof p[k] !== 'boolean') errores.push(`${BOOLEANOS[k]}: «${texto(p[k])}» no es sí/no.`);
      });
      revisarListas(p, errores);
    }

    if (vacio(p.descripcion)) delete p.descripcion;
    else if (typeof p.descripcion !== 'string') p.descripcion = typeof p.descripcion === 'number' ? String(p.descripcion) : '';
    return { p, errores };
  }

  /* ------------------------------------------------------------------ */
  /* Tablas maestras                                                    */
  /* ------------------------------------------------------------------ */

  const SECCIONES = ['precios', 'proveedor', 'mano_obra', 'merma', 'capas', 'proceso', 'herrajes', 'materiales', 'calibres', 'servicios'];

  // Números que deben ser MAYORES que 0: entran como divisor (velocidad, eficiencia, rendimiento…) o dan forma a algo (paso
  // de tornillos, tamaño de hoja, densidad). Un cero aquí produce NaN o un precio infinito. `*` = cualquier clave.
  const POSITIVOS = [
    'proceso.eficiencia_taller', 'proceso.hoja.ancho_mm', 'proceso.hoja.largo_mm',
    'proceso.armado_yardas.yarda_defecto_mm', 'proceso.armado_yardas.yardas_por_pieza_max', 'proceso.armado_yardas.yardas_mm.*',
    'proceso.semiangulo_max_deg', 'proceso.alfa_max_junta_deg', 'proceso.k_R_defecto',
    'proceso.rolado.n_pasadas', 'proceso.rolado.n_pasadas_plegado', 'proceso.rolado.k_conico',
    'proceso.soldadura.procesos.*.v_mult', 'proceso.soldadura.procesos.*.FO', 'proceso.soldadura.procesos.*.eta_dep', 'proceso.soldadura.rho_dep_g_cm3',
    'proceso.pintura.capas.*.sv_pct', 'proceso.pintura.capas.*.dft_um', 'proceso.pintura.capas.*.eta_transf',
    'proceso.limites.*',
    'herrajes.uniones.BRIDADO.paso_tornillo_mm', 'herrajes.uniones.BRIDADO.multiplo_tornillos', 'herrajes.uniones.ESPIGA.paso_fijacion_mm',
    'herrajes.sellador.cartucho_ml', 'herrajes.perfiles.*.ancho_mm', 'herrajes.perfiles.*.esp_mm',
    'materiales.*.densidad_kg_m3', 'mano_obra.FSR',
  ];
  // Tablas espesor → velocidad ([[espesor, m/min], …]) y espesores por calibre: cada celda > 0 (se revisan con su propio mensaje).
  const TABLAS_VELOCIDAD = ['proceso.corte.v_m_min.*', 'proceso.rolado.v_m_min', 'proceso.engargolado.v_m_min', 'proceso.soldadura.v_m_min'];
  const CELDAS_POSITIVAS = ['calibres.*.*', 'proceso.corte.v_m_min.*.*.*', 'proceso.rolado.v_m_min.*.*', 'proceso.engargolado.v_m_min.*.*', 'proceso.soldadura.v_m_min.*.*'];
  const aRegExp = (patron) => new RegExp(`^${patron.replace(/\./g, '\\.').replace(/\*/g, '[^.]+')}$`);
  const RE_POSITIVOS = [...POSITIVOS, ...CELDAS_POSITIVAS].map(aRegExp);
  const LIMITES_REQUERIDOS = ['cantidad_max', 'seccion_min_mm', 'seccion_max_mm', 'largo_min_mm', 'largo_max_mm', 'espesor_min_mm', 'espesor_max_mm', 'piezas_max', 'yarda_min_mm', 'yarda_max_mm'];

  /** ¿La celda de las tablas en esa ruta debe ser mayor que 0? (el editor de la interfaz lo usa para rechazar un cero al teclear) */
  const exigePositivo = (ruta) => {
    const s = ruta.join('.');
    return RE_POSITIVOS.some((re) => re.test(s));
  };

  /** Lo que hay en esa ruta con comodines: [{ ruta, valor }] (`valor` es undefined si el camino se corta). */
  function expandir(raiz, patron) {
    let nivel = [{ ruta: [], valor: raiz }];
    patron.split('.').forEach((parte) => {
      const sig = [];
      nivel.forEach(({ ruta, valor }) => {
        if (!esObjeto(valor) && !Array.isArray(valor)) {
          if (parte !== '*') sig.push({ ruta: [...ruta, parte], valor: undefined });
          return;
        }
        (parte === '*' ? Object.keys(valor) : [parte]).forEach((k) => sig.push({ ruta: [...ruta, k], valor: valor[k] }));
      });
      nivel = sig;
    });
    return nivel;
  }

  function recorrerNumeros(valor, ruta, visitar) {
    if (typeof valor === 'number') visitar(ruta, valor);
    else if (Array.isArray(valor)) valor.forEach((x, i) => recorrerNumeros(x, [...ruta, i], visitar));
    else if (esObjeto(valor)) Object.keys(valor).forEach((k) => recorrerNumeros(valor[k], [...ruta, k], visitar));
  }

  /**
   * Lo que está mal en las tablas maestras y haría imposible un cálculo confiable: [{ ruta, mensaje }]; vacío = sanas.
   * `solo` limita la revisión a ciertas secciones (una partida comprada sólo depende de `capas`).
   * No exige que cada precio exista: eso lo dice el cálculo al usarlo, con el nombre de la variable.
   */
  function problemasMaestros(M, opciones) {
    const solo = opciones && opciones.solo;
    const quiere = (seccion) => !solo || solo.includes(seccion);
    const salida = [];
    const marcados = new Set();
    const agregar = (ruta, mensaje) => {
      const clave = ruta.join('.');
      if (marcados.has(clave)) return;
      marcados.add(clave);
      salida.push({ ruta, mensaje });
    };
    if (!esObjeto(M)) return [{ ruta: [], mensaje: 'las tablas maestras no existen' }];
    SECCIONES.filter(quiere).forEach((s) => { if (!esObjeto(M[s])) agregar([s], 'falta o no es una tabla'); });
    if (salida.length) return salida;

    const noPositivo = (v) => typeof v !== 'number' || !Number.isFinite(v) || !(v > 0);
    POSITIVOS.filter((patron) => quiere(patron.split('.')[0])).forEach((patron) => expandir(M, patron).forEach(({ ruta, valor }) => {
      if (noPositivo(valor)) agregar(ruta, `debe ser un número mayor que 0 (vale ${texto(valor)})`);
    }));

    if (quiere('calibres')) {
      Object.keys(M.calibres).forEach((tabla) => {
        const t = M.calibres[tabla];
        if (!esObjeto(t)) { agregar(['calibres', tabla], 'no es una tabla de calibres'); return; }
        Object.keys(t).forEach((cal) => { if (noPositivo(t[cal])) agregar(['calibres', tabla, cal], `debe ser un número mayor que 0 (vale ${texto(t[cal])})`); });
      });
    }

    if (quiere('proceso')) {
      TABLAS_VELOCIDAD.forEach((patron) => expandir(M, patron).forEach(({ ruta, valor }) => {
        const par = (r) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x));
        if (!Array.isArray(valor) || !valor.length || !valor.every(par)) { agregar(ruta, 'debe ser una tabla de pares [espesor, velocidad]'); return; }
        valor.forEach((r, i) => {
          if (!(r[0] > 0)) agregar([...ruta, i, 0], `el espesor debe ser mayor que 0 (vale ${texto(r[0])})`);
          if (!(r[1] > 0)) agregar([...ruta, i, 1], `la velocidad debe ser mayor que 0 (vale ${texto(r[1])})`);
          if (i > 0 && !(r[0] > valor[i - 1][0])) agregar([...ruta, i, 0], 'los espesores deben ir de menor a mayor');
        });
      }));
      ['angulos_injerto_deg', 'angulos_codo_deg'].forEach((k) => {
        const v = M.proceso[k];
        if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'number' && x > 0 && x <= 180)) agregar(['proceso', k], 'debe ser una lista de ángulos en grados, mayores que 0 y hasta 180');
      });
      const Lm = M.proceso.limites;
      if (!esObjeto(Lm)) agregar(['proceso', 'limites'], 'falta la tabla de límites de captura');
      else {
        LIMITES_REQUERIDOS.forEach((k) => { if (typeof Lm[k] !== 'number') agregar(['proceso', 'limites', k], 'falta el límite'); });
        [['seccion_min_mm', 'seccion_max_mm'], ['largo_min_mm', 'largo_max_mm'], ['espesor_min_mm', 'espesor_max_mm'], ['yarda_min_mm', 'yarda_max_mm']].forEach(([a, b]) => {
          if (typeof Lm[a] === 'number' && typeof Lm[b] === 'number' && Lm[a] >= Lm[b]) agregar(['proceso', 'limites', a], `debe ser menor que «${b.replace(/_/g, ' ')}»`);
        });
      }
      // Armado por yardas: la lista de anchos, el entero de yardas por pieza y la junta (una costura que exista)
      const AY = M.proceso.armado_yardas;
      if (!esObjeto(AY)) agregar(['proceso', 'armado_yardas'], 'falta la tabla del armado por yardas');
      else {
        if (!Array.isArray(AY.yardas_mm) || !AY.yardas_mm.length) agregar(['proceso', 'armado_yardas', 'yardas_mm'], 'debe ser una lista con al menos un ancho de yarda');
        if (typeof AY.yardas_por_pieza_max === 'number' && !Number.isInteger(AY.yardas_por_pieza_max)) agregar(['proceso', 'armado_yardas', 'yardas_por_pieza_max'], `debe ser un número entero (vale ${texto(AY.yardas_por_pieza_max)})`);
        if (typeof AY.junta_entre_yardas !== 'string' || !tiene(M.proceso.costuras, AY.junta_entre_yardas)) agregar(['proceso', 'armado_yardas', 'junta_entre_yardas'], `debe ser un tipo de costura de «proceso › costuras» (${claves(M.proceso.costuras).join(', ')}); vale ${texto(AY.junta_entre_yardas)}`);
        if (esObjeto(Lm) && typeof Lm.yarda_min_mm === 'number' && typeof Lm.yarda_max_mm === 'number') {
          const anchos = [...(Array.isArray(AY.yardas_mm) ? AY.yardas_mm : []).map((v, i) => [v, ['yardas_mm', i]]), [AY.yarda_defecto_mm, ['yarda_defecto_mm']]];
          anchos.forEach(([v, ruta]) => {
            if (typeof v === 'number' && (v < Lm.yarda_min_mm || v > Lm.yarda_max_mm)) agregar(['proceso', 'armado_yardas', ...ruta], `debe estar entre ${Lm.yarda_min_mm} y ${Lm.yarda_max_mm} mm, los límites de la yarda (vale ${v})`);
          });
        }
      }
    }

    if (quiere('merma')) {
      Object.keys(M.merma).forEach((k) => {
        const v = M.merma[k];
        if (typeof v !== 'number' || !(v >= 0 && v < 1)) agregar(['merma', k], `debe ser de 0 % a menos de 100 % (vale ${texto(v)})`);
      });
    }

    SECCIONES.filter(quiere).forEach((s) => recorrerNumeros(M[s], [s], (ruta, v) => {
      if (!Number.isFinite(v)) agregar(ruta, `no es un número válido (vale ${texto(v)})`);
      else if (v < 0) agregar(ruta, `no puede ser negativo (vale ${v})`);
    }));
    return salida;
  }

  /** «proceso › eficiencia taller: debe ser un número mayor que 0 (vale 0)» */
  const textoProblema = (x) => `${x.ruta.length ? `${x.ruta.map((k) => String(k).replace(/_/g, ' ')).join(' › ')}: ` : ''}${x.mensaje}`;

  /* ------------------------------------------------------------------ */
  /* Resultados                                                         */
  /* ------------------------------------------------------------------ */

  /** Rutas de los números no finitos (NaN, ±Infinity) de un resultado; a lo más `max`. */
  function noFinitos(obj, max) {
    const tope = max || 5;
    const rutas = [];
    const ir = (v, ruta) => {
      if (rutas.length >= tope) return;
      if (typeof v === 'number') { if (!Number.isFinite(v)) rutas.push(ruta); } else if (Array.isArray(v)) v.forEach((x, i) => ir(x, `${ruta}[${i}]`));
      else if (esObjeto(v)) Object.keys(v).forEach((k) => ir(v[k], ruta ? `${ruta}.${k}` : k));
    };
    ir(obj, '');
    return rutas;
  }

  return {
    aNumero, normalizarPartida, problemasMaestros, textoProblema, exigePositivo, noFinitos, limitesDe,
  };
}));
