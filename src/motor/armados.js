/**
 * COTIZAP · armados.js — Conjuntos armados en taller: ahorro de bridas.
 *
 * Dos piezas que se unen en taller no llevan brida en las caras que se juntan: llevan una junta de armado (soldada en acero al
 * carbón, engargolada en galvanizado). La cotización guarda los armados que el usuario aceptó, sin tocar sus partidas:
 *
 *   cot.armados = [{ id, piezas: [{ partida: <id de la partida>, cara }, { partida, cara }], n }]
 *
 * `n` es cuántos conjuntos son; las dos partidas del armado tienen exactamente `n` piezas (si una tenía más, `armar` la partió).
 * La cara es el nombre del extremo (`extremos_sin_brida` de la familia: A/B del codo, D1/D2 de la reducción, injerto…) o `final`
 * en el tramo recto (su extremo final). Este módulo es puro y no toca el DOM:
 *
 *   · aplicarArmados  — las partidas efectivas para cotizar: cada pieza con su cara sin brida y, al final, una partida UNION por
 *                       armado (derivada: no se edita a mano). Sin armados devuelve la misma lista, sin cambios.
 *   · validarArmado   — las reglas: mismo Ø, pareja permitida, caras libres, límite de tamaño y ángulo resultante.
 *   · sugerirArmados  — las parejas posibles con su ahorro real (cotiza con y sin armado con el mismo motor).
 *   · armar / deshacerArmado — alta y baja en la cotización (parten y juntan partidas).
 *
 * Parejas permitidas (NO codo + codo):
 *   a) injerto (RAMAL) o reducción con injerto (REDUCCION_INJERTO), por su cara «injerto», con una cara de un codo del Ø del
 *      injerto, de modo que β + θ = 90° (injerto a 30° con codo de 60°; a 45° con codo de 45°): el ramal sale a 90°;
 *   b) tramo recto (RECTO), por su extremo final, con una cara de un codo del mismo Ø;
 *   c) reducción (REDUCCION), por D1 o D2, con codo, tramo recto, injerto o reducción con injerto cuyo Ø coincida con el suyo.
 *
 * Envolvente del conjunto (conservadora): cada pieza tiene una dimensión mayor `largo_max` que cubre cualquiera de los lados de
 * su caja; como las dos piezas se tocan en la cara que se une, cualquier lado de la caja del conjunto es a lo más la suma:
 *      dim_conjunto = largo_max(A) + largo_max(B)         (debe ser ≤ proceso.conjuntos_armados.dim_max_mm)
 *   · recto:      L (el largo total de la partida) o, si es mayor, su Ø exterior;
 *   · codo:       caja del eje (tangentes y gajos: sus vértices con el ángulo y el largo de cada gajo) más el Ø exterior;
 *   · reducción:  L o, si es mayor, el Ø exterior mayor;
 *   · injerto:    el mayor entre el largo del tronco (o de la reducción), con el injerto inclinado β, y el alto del injerto:
 *                 L_ramal·sinβ + (d_ext/2)·cosβ + D_ext/2.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./geometria'), require('./material'), require('./validacion'), () => require('./cotizador'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.armados = factory(root.COTIZAP.util, root.COTIZAP.geometria, root.COTIZAP.material, root.COTIZAP.validacion, () => root.COTIZAP.cotizador);
  }
}(typeof self !== 'undefined' ? self : this, function (U, GEO, MAT, VAL, obtenerCotizador) {
  'use strict';

  const COT = () => obtenerCotizador();
  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const rad = (g) => (g * Math.PI) / 180;

  /** Las familias que se arman y las caras de cada una (el tramo recto sólo tiene su extremo final). */
  const CARAS = {
    RECTO: ['final'],
    CODO: GEO.EXTREMOS_FAMILIA.CODO,
    REDUCCION: GEO.EXTREMOS_FAMILIA.REDUCCION,
    RAMAL: GEO.EXTREMOS_FAMILIA.RAMAL,
    REDUCCION_INJERTO: GEO.EXTREMOS_FAMILIA.REDUCCION_INJERTO,
  };
  const ES_INJERTO = (fam) => fam === 'RAMAL' || fam === 'REDUCCION_INJERTO';
  const LIMITE_DEFECTO_MM = 3660; // si las tablas maestras no traen la política
  const N_MAX = 50; // uniones por partida UNION (geometria.union)

  const NOMBRE_CARA = {
    A: 'extremo A', B: 'extremo B', D1: 'extremo mayor', D2: 'extremo menor', injerto: 'cara del injerto',
    tronco_1: 'extremo 1 del tronco', tronco_2: 'extremo 2 del tronco', final: 'extremo final',
  };

  /** Ø en pulgadas si es una medida de pulgadas («5″»), en mm si no. */
  function textoD(mm) {
    const p = mm / 25.4;
    return Math.abs(p - Math.round(p * 4) / 4) < 0.005 ? `${Number.isInteger(Math.round(p * 4) / 4) ? Math.round(p) : Math.round(p * 4) / 4}″` : `${Math.round(mm * 10) / 10} mm`;
  }
  const grado = (g) => `${Math.round(g * 100) / 100}°`;

  const num = (x) => Number(x);
  const refDe = (p) => (p.ref_diametro === 'EXTERIOR' ? 'EXTERIOR' : 'INTERIOR');
  const tipoUnion = (p) => p.tipo_union || 'BRIDADO';

  /** Ángulo del injerto de una partida RAMAL / REDUCCION_INJERTO (el de maestros si no lo trae). */
  function betaDe(p, M) {
    const vacio = p.beta_deg === undefined || p.beta_deg === null || p.beta_deg === '';
    return vacio ? M.proceso.beta_ramal_defecto_deg : num(p.beta_deg);
  }

  /** Nombre corto de la pieza para describir un armado («codo de 60° de 5″»). `p` ya normalizada. */
  function nombrePieza(p, M) {
    switch (p.familia) {
      case 'CODO': return `codo de ${grado(p.theta_deg || 90)} de ${textoD(p.D_mm)}`;
      case 'RECTO': return `tramo recto de ${textoD(p.D_mm)} × ${Math.round(p.L_mm)} mm`;
      case 'REDUCCION': return `reducción de ${textoD(Math.max(p.D1_mm, p.D2_mm))} a ${textoD(Math.min(p.D1_mm, p.D2_mm))}`;
      case 'RAMAL': return `injerto de ${textoD(p.d_mm)} a ${grado(betaDe(p, M))} en tronco de ${textoD(p.D_mm)}`;
      case 'REDUCCION_INJERTO': return `reducción de ${textoD(p.D1_mm)} a ${textoD(p.D2_mm)} con injerto de ${textoD(p.d_mm)} a ${grado(betaDe(p, M))}`;
      default: return p.familia;
    }
  }

  /** Ø nominal (mm) de una cara de la pieza, según sus datos capturados. */
  function diametroCara(p, cara) {
    switch (p.familia) {
      case 'CODO': case 'RECTO': return num(p.D_mm);
      case 'REDUCCION': return cara === 'D1' ? Math.max(num(p.D1_mm), num(p.D2_mm)) : Math.min(num(p.D1_mm), num(p.D2_mm)); // D1 es el extremo mayor
      case 'RAMAL': return cara === 'injerto' ? num(p.d_mm) : num(p.D_mm);
      case 'REDUCCION_INJERTO': return cara === 'D1' ? num(p.D1_mm) : cara === 'D2' ? num(p.D2_mm) : num(p.d_mm);
      default: return NaN;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Envolvente                                                         */
  /* ------------------------------------------------------------------ */

  /** Caja (ancho, alto) del eje de un codo con sus tangentes, más el Ø exterior; sus gajos se recorren vértice por vértice. */
  function cajaCodo(p, PF) {
    const d = PF.detalle;
    const Lt = num(p.L_tangente_mm) || 0;
    const j = d.n_juntas || 1;
    const a = rad(d.alfa_deg);
    const l = d.l_gajo_mm;
    let x = 0; let y = 0; let h = 0;
    const pts = [[0, 0]];
    const avanzar = (s) => { x += s * Math.cos(h); y += s * Math.sin(h); pts.push([x, y]); };
    avanzar(Lt);
    avanzar(l / 2);
    for (let i = 0; i < j; i += 1) { h += a; avanzar(i < j - 1 ? l : l / 2); }
    avanzar(Lt);
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const De = d.D_ext_mm;
    return { ancho: Math.max(...xs) - Math.min(...xs) + De, alto: Math.max(...ys) - Math.min(...ys) + De };
  }

  /** La dimensión mayor (mm) de la pieza y la fórmula con que se obtuvo. `p` normalizada y `PF` su perfil de fabricación (sin quitar bridas). */
  function dimensionMayor(p, PF, M) {
    const ext = (id) => (PF.extremos.find((x) => x.id === id) || PF.extremos[0]);
    switch (p.familia) {
      case 'RECTO': {
        const De = ext('tramo').D_ext_mm;
        return { mm: Math.max(num(p.L_mm), De), formula: `L = ${Math.round(p.L_mm)} mm` };
      }
      case 'CODO': {
        const c = cajaCodo(p, PF);
        return { mm: Math.max(c.ancho, c.alto), formula: `caja del eje + Ø exterior (${Math.round(c.ancho)} × ${Math.round(c.alto)} mm)` };
      }
      case 'REDUCCION': {
        const L = PF.detalle.L_mm;
        return { mm: Math.max(L, ext('D1').D_ext_mm), formula: `L = ${Math.round(L)} mm` };
      }
      case 'RAMAL': case 'REDUCCION_INJERTO': {
        const ri = p.familia === 'REDUCCION_INJERTO';
        const Lc = ri ? PF.detalle.L_reduccion_mm : num(p.L_cuerpo_mm);
        const Lr = ri ? PF.detalle.L_ramal_mm : num(p.L_ramal_mm);
        const beta = rad(ri ? PF.detalle.beta_deg : betaDe(p, M));
        const Dc = ext(ri ? 'D1' : 'tronco_1').D_ext_mm;
        const dr = ext('injerto').D_ext_mm;
        const largo = Lc / 2 + Math.max(Lc / 2, Lr * Math.cos(beta) + (dr / 2) * Math.sin(beta));
        const alto = Lr * Math.sin(beta) + (dr / 2) * Math.cos(beta) + Dc / 2;
        return { mm: Math.max(largo, alto), formula: `máx(${Math.round(largo)} a lo largo, ${Math.round(alto)} de alto) mm` };
      }
      default: return { mm: 0, formula: '' };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reglas                                                             */
  /* ------------------------------------------------------------------ */

  const limiteDe = (M) => {
    const c = M && M.proceso && M.proceso.conjuntos_armados;
    return c && Number.isFinite(c.dim_max_mm) && c.dim_max_mm > 0 ? c.dim_max_mm : LIMITE_DEFECTO_MM;
  };

  /** Cada qué partida y cara están ya tomadas por otros armados: Map «id|cara» → id del armado. */
  function caraTomadas(armados, exceptoId) {
    const m = new Map();
    (Array.isArray(armados) ? armados : []).forEach((a) => {
      if (!esObjeto(a) || a.id === exceptoId || !Array.isArray(a.piezas)) return;
      a.piezas.forEach((q) => { if (esObjeto(q)) m.set(`${q.partida}|${q.cara}`, a.id); });
    });
    return m;
  }

  /** ¿La cara trae ya su brida resuelta de otro modo? (sin brida a mano, o el extremo final del recto con brida suelta o sin brida). */
  function motivoOcupada(p, cara) {
    if (p.familia === 'RECTO') {
      if (p.extremo_ajuste === 'SIN_BRIDA') return 'el extremo final del tramo ya va sin brida';
      if (p.extremo_ajuste === 'SUELTA') return 'el extremo final del tramo lleva brida suelta';
      return '';
    }
    return Array.isArray(p.extremos_sin_brida) && p.extremos_sin_brida.includes(cara) ? 'esa cara ya va sin brida' : '';
  }

  /** Qué pareja es (a, b o c) o '' si no está permitida. Las piezas llevan su `cara`. */
  function clasificar(A, B) {
    const par = [A, B];
    const tiene = (fam) => par.find((x) => x.p.familia === fam);
    const inj = par.find((x) => ES_INJERTO(x.p.familia));
    const codo = tiene('CODO');
    const recto = tiene('RECTO');
    const red = tiene('REDUCCION');
    if (inj && codo && !red && !recto) return inj.cara === 'injerto' ? 'a' : '';
    if (recto && codo) return 'b';
    if (red) {
      const otro = par.find((x) => x !== red);
      return otro && ['CODO', 'RECTO', 'RAMAL', 'REDUCCION_INJERTO'].includes(otro.p.familia) ? 'c' : '';
    }
    return '';
  }

  const hallar = (partidas, id) => partidas.findIndex((q) => esObjeto(q) && typeof q.id === 'string' && q.id === id);

  /**
   * Revisa un armado contra las partidas y las tablas. `partidas` son las de la cotización (o las efectivas, si ya traen los
   * armados anteriores); `opc.armados` son los otros armados de la cotización (sus caras están tomadas), `opc.heredar` completa la
   * partida con los valores de la cotización y `opc.antes_de_partir` omite la revisión de las cantidades (para sugerir).
   * Devuelve { ok, errores, pareja, angulo_deg, es_90, dim_mm, limite_mm, D_mm, ref_diametro, junta, piezas: [{ partida, cara,
   * indice, p, PF, dim_mm, formula, nombre }], envolvente }; los campos que no se pudieron calcular faltan.
   */
  function validarArmado(partidas, armado, M, opc) {
    const o = opc || {};
    const heredar = o.heredar || ((p) => p);
    const lista = Array.isArray(partidas) ? partidas : [];
    const errores = [];
    const salida = { ok: false, errores, limite_mm: limiteDe(M) };
    const fin = () => { salida.ok = errores.length === 0; return salida; };
    if (!esObjeto(armado) || !Array.isArray(armado.piezas) || armado.piezas.length !== 2 || !armado.piezas.every((q) => esObjeto(q) && typeof q.partida === 'string' && typeof q.cara === 'string')) {
      errores.push('El armado debe unir exactamente dos piezas, cada una con su partida y su cara.');
      return fin();
    }
    const n = armado.n === undefined ? 1 : armado.n;
    if (!Number.isInteger(n) || n < 1 || n > N_MAX) errores.push(`El número de conjuntos debe ser un entero de 1 a ${N_MAX}.`);
    const [qa, qb] = armado.piezas;
    if (qa.partida === qb.partida) { errores.push('Las dos piezas del armado deben ser partidas distintas.'); return fin(); }

    // las dos piezas: la partida existe, se normaliza y su familia se arma
    const piezas = armado.piezas.map((q) => {
      const indice = hallar(lista, q.partida);
      if (indice < 0) { errores.push(`La partida «${q.partida}» ya no existe en la cotización.`); return null; }
      const v = VAL.normalizarPartida({ cantidad: 1, ...heredar(lista[indice]) }, M);
      const crudo = lista[indice];
      if (v.errores.length) { errores.push(`La partida «${crudo.descripcion || crudo.familia}» tiene errores: ${v.errores[0]}`); return null; }
      const p = v.p;
      const nombre = CARAS[p.familia] ? nombrePieza(p, M) : (VAL && p.familia === 'UNION' ? 'La unión' : `La partida de ${String(p.familia).toLowerCase()}`);
      if (!CARAS[p.familia]) { errores.push(`${nombre} no se arma en taller (sólo codos, tramos rectos, reducciones e injertos).`); return null; }
      if (!CARAS[p.familia].includes(q.cara)) { errores.push(`La cara «${q.cara}» no existe en ${nombre} (use ${CARAS[p.familia].join(', ')}).`); return null; }
      if ((p.familia === 'RECTO' || p.familia === 'CODO') && p.forma === 'RECTANGULAR') { errores.push(`${nombre}: sólo se arman piezas redondas.`); return null; }
      if (tipoUnion(p) !== 'BRIDADO') { errores.push(`${nombre} no lleva bridas: no hay brida que ahorrar.`); return null; }
      if (!o.antes_de_partir && p.cantidad !== n) errores.push(`${nombre} tiene ${p.cantidad} ${p.cantidad === 1 ? 'pieza' : 'piezas'} y el armado es de ${n}: la partida debe tener exactamente las piezas del armado.`);
      return { partida: q.partida, cara: q.cara, indice, p, nombre };
    });
    if (piezas.some((x) => !x)) return fin();
    salida.piezas = piezas;

    // pareja permitida
    const pareja = clasificar(piezas[0], piezas[1]);
    salida.pareja = pareja;
    if (!pareja) {
      const f = piezas.map((x) => x.p.familia);
      errores.push(f[0] === 'CODO' && f[1] === 'CODO' ? 'No se arma un codo con otro codo.'
        : f.some(ES_INJERTO) && f.includes('CODO') ? 'El injerto se arma con el codo por su cara «injerto».'
          : `Pareja no permitida: ${piezas[0].nombre} con ${piezas[1].nombre}. Se arman injerto (o reducción con injerto) con codo, tramo recto con codo, y reducción con codo, tramo recto, injerto o reducción con injerto.`);
    }

    // mismo material y mismo Ø en las caras que se unen
    const [A, B] = piezas;
    const mismoMat = A.p.material_id === B.p.material_id && String(A.p.calibre) === String(B.p.calibre) && A.p.espesor_mm === B.p.espesor_mm;
    if (!mismoMat) errores.push('Las dos piezas deben ser del mismo material y calibre (la junta de armado es soldada o engargolada según el material).');
    const dA = diametroCara(A.p, A.cara);
    const dB = diametroCara(B.p, B.cara);
    salida.D_mm = dA;
    salida.ref_diametro = refDe(A.p);
    if (Math.abs(dA - dB) > 0.05 || refDe(A.p) !== refDe(B.p)) {
      errores.push(`Las caras que se unen no miden lo mismo: ${textoD(dA)} (${NOMBRE_CARA[A.cara]}) contra ${textoD(dB)} (${NOMBRE_CARA[B.cara]})${refDe(A.p) !== refDe(B.p) ? ' o están referidas a distinto diámetro (interior/exterior)' : ''}.`);
    }

    // ángulo resultante (pareja a): β + θ = 90°
    if (pareja === 'a') {
      const inj = A.p.familia === 'CODO' ? B : A;
      const cod = inj === A ? B : A;
      const theta = num(cod.p.theta_deg) || 90;
      const total = betaDe(inj.p, M) + theta;
      salida.angulo_deg = total;
      salida.es_90 = Math.abs(total - 90) < 1e-6;
      if (!salida.es_90) errores.push(`El injerto a ${grado(betaDe(inj.p, M))} con un codo de ${grado(theta)} sale a ${grado(total)}, no a 90°: use un codo de ${grado(90 - betaDe(inj.p, M))}.`);
    } else if (pareja) {
      const cod = piezas.find((x) => x.p.familia === 'CODO');
      if (cod) { salida.angulo_deg = num(cod.p.theta_deg) || 90; salida.es_90 = Math.abs(salida.angulo_deg - 90) < 1e-6; }
    }

    // caras libres: sin otra brida aparte ni otro armado
    const tomadas = o.tomadas || caraTomadas(o.armados, armado.id);
    piezas.forEach((x) => {
      const otro = tomadas.get(`${x.partida}|${x.cara}`);
      if (otro) errores.push(`La cara «${NOMBRE_CARA[x.cara]}» de ${x.nombre} ya está armada (${otro}).`);
      else {
        const m = motivoOcupada(x.p, x.cara);
        if (m) errores.push(`La cara «${NOMBRE_CARA[x.cara]}» de ${x.nombre} no está libre: ${m}.`);
      }
    });

    // envolvente: la suma de las dimensiones mayores contra el límite
    try {
      piezas.forEach((x) => {
        const sinQuitar = { ...x.p };
        delete sinQuitar.extremos_sin_brida;
        const e = MAT.espesorMm(M, M.materiales[x.p.material_id], x.p);
        x.PF = GEO.perfilFabricacion(sinQuitar, e, M);
        const d = dimensionMayor(x.p, x.PF, M);
        x.dim_mm = d.mm;
        x.formula = d.formula;
      });
      salida.dim_mm = piezas[0].dim_mm + piezas[1].dim_mm;
      salida.envolvente = { formula: 'dim = largo_max(A) + largo_max(B)', piezas: piezas.map((x) => ({ nombre: x.nombre, dim_mm: x.dim_mm, formula: x.formula })) };
      if (salida.dim_mm > salida.limite_mm) {
        errores.push(`El conjunto mediría hasta ${Math.round(salida.dim_mm).toLocaleString('es-MX')} mm y el máximo para manejarlo y transportarlo es ${salida.limite_mm.toLocaleString('es-MX')} mm.`);
      }
    } catch (e) {
      errores.push(`No se pudo calcular el tamaño del conjunto: ${(e && e.errores && e.errores[0]) || (e && e.message) || e}`);
    }
    return fin();
  }

  /* ------------------------------------------------------------------ */
  /* Aplicar                                                            */
  /* ------------------------------------------------------------------ */

  /** La partida con la cara sin brida (copia). */
  function sinBridaEn(p, cara) {
    const q = { ...p };
    if (p.familia === 'RECTO') {
      q.extremo_ajuste = 'SIN_BRIDA';
      delete q.extremo_solo_ajuste;
      delete q.ajuste_sin_brida;
    } else {
      q.extremos_sin_brida = [...(Array.isArray(p.extremos_sin_brida) ? p.extremos_sin_brida : []), cara];
    }
    return q;
  }

  /** La partida UNION de un armado (marca = «E1»…). `v` es el resultado de validarArmado. */
  function partidaUnion(armado, marca, v) {
    const A = v.piezas[0].p;
    const n = armado.n === undefined ? 1 : armado.n;
    const u = {
      familia: 'UNION', material_id: A.material_id, tipo_union: 'LISO', ref_diametro: v.ref_diametro, D_mm: v.D_mm, n_uniones: n, cantidad: 1,
      descripcion: `Armado ${marca}: ${v.piezas[0].nombre} con ${v.piezas[1].nombre} (${n} ${n === 1 ? 'conjunto' : 'conjuntos'})`,
      armado_id: armado.id, derivada: true,
    };
    if (A.espesor_mm > 0) u.espesor_mm = A.espesor_mm; else if (A.calibre !== undefined) u.calibre = A.calibre;
    if (A.clase_sellado !== undefined) u.clase_sellado = A.clase_sellado;
    return u;
  }

  /**
   * Las partidas efectivas para cotizar. Devuelve { partidas, conjuntos, avisos }: `partidas` son las de la cotización, en su
   * orden y con la cara sin brida en las piezas armadas, más al final la partida UNION de cada armado; `conjuntos` dice cómo quedó
   * cada armado (marca E1, E2… por su lugar en la lista, sus piezas, si se aplicó o por qué no). Un armado que ya no es válido
   * (se editó una partida) no se aplica y se avisa. Sin armados devuelve la misma lista.
   */
  function aplicarArmados(partidas, armados, M, opc) {
    const lista = Array.isArray(partidas) ? partidas : [];
    const arms = (Array.isArray(armados) ? armados : []).filter(esObjeto);
    if (!arms.length) return { partidas: lista, conjuntos: [], avisos: [] };
    const efectivas = lista.slice();
    const extras = [];
    const conjuntos = [];
    const avisos = [];
    const tomadas = new Map();
    arms.forEach((a, k) => {
      const marca = `E${k + 1}`;
      const v = validarArmado(lista, a, M, { ...(opc || {}), tomadas });
      const base = { id: a.id, marca, n: a.n === undefined ? 1 : a.n, ok: v.ok, errores: v.errores };
      if (!v.ok) {
        conjuntos.push({ ...base, piezas: Array.isArray(a.piezas) ? a.piezas.map((q) => ({ partida: q && q.partida, cara: q && q.cara })) : [] });
        avisos.push(`Armado ${marca}: ${v.errores[0]} Se cotiza sin armar.`);
        return;
      }
      v.piezas.forEach((x) => {
        efectivas[x.indice] = sinBridaEn(efectivas[x.indice], x.cara);
        tomadas.set(`${x.partida}|${x.cara}`, marca);
      });
      extras.push(partidaUnion(a, marca, v));
      conjuntos.push({
        ...base,
        piezas: v.piezas.map((x) => ({ partida: x.partida, cara: x.cara, indice: x.indice, nombre: x.nombre })),
        union_indice: lista.length + extras.length - 1,
        pareja: v.pareja, angulo_deg: v.angulo_deg, es_90: v.es_90, dim_mm: v.dim_mm, limite_mm: v.limite_mm, D_mm: v.D_mm,
        descripcion: extras[extras.length - 1].descripcion,
      });
    });
    return { partidas: efectivas.concat(extras), conjuntos, avisos };
  }

  /* ------------------------------------------------------------------ */
  /* Sugerencias                                                        */
  /* ------------------------------------------------------------------ */

  /** Costo directo por concepto de un resultado de cotizarPartida, en las categorías del ahorro. */
  function conceptos(f) {
    if (!f) return { aros: 0, tornillos: 0, juntas: 0, mano_obra: 0, total: 0 };
    const c = f.costos;
    const m = c.materiales || {};
    return {
      aros: (m.perfiles || 0), tornillos: (m.tornilleria || 0), juntas: (m.empaque || 0) + (m.sellador || 0),
      mano_obra: (c.subtotales.mano_obra || 0) + (c.subtotales.equipo || 0) + (c.subtotales.herramienta_menor || 0), total: c.CD,
    };
  }
  const sumar = (xs) => xs.reduce((s, x) => { const c = conceptos(x); Object.keys(c).forEach((k) => { s[k] = (s[k] || 0) + c[k]; }); return s; }, {});

  /**
   * Las parejas que se pueden armar y lo que ahorran, de mayor a menor. Cada sugerencia: { piezas: [{ partida, cara, nombre }], n,
   * pareja, descripcion, angulo_deg, es_90, dim_mm, limite_mm, D_mm, junta ('soldada' | 'engargolada'), ahorro (MXN, sin IVA:
   * precio de las partidas con y sin armado), antes, despues, ahorro_costo (costo directo) y desglose { aros, tornillos, juntas,
   * mano_obra, otros } (costo directo ahorrado; negativo = cuesta más) }. Una partida aparece en una sola sugerencia (asignación
   * voraz: primero la de mayor ahorro); al aceptarlas, las caras que quedan libres pueden dar nuevas sugerencias.
   * Sólo se sugiere lo que ahorra, cabe en el límite y es válido; las partidas sin `id` o con errores se omiten.
   */
  function sugerirArmados(cot, res, M0) {
    const c = esObjeto(cot) ? cot : {};
    const Mb = M0 || (res && res.maestros);
    if (!Mb) return [];
    const K = COT();
    const ef = K.maestrosEfectivos(c, Mb);
    const M = ef.M;
    const { heredar } = K.crearHeredar(c, M);
    const lista = Array.isArray(c.partidas) ? c.partidas : [];
    const base = aplicarArmados(lista, c.armados, M, { heredar });
    const N = lista.length;
    const eff = base.partidas.slice(0, N);

    const cache = new Map();
    const cotizarP = (p) => {
      const k = JSON.stringify(p);
      if (!cache.has(k)) {
        try { cache.set(k, K.cotizarPartida(heredar(p), M)); } catch (e) { cache.set(k, null); }
      }
      return cache.get(k);
    };

    // las piezas que se arman: con id, redondas, con bridas y sin errores
    const cand = [];
    eff.forEach((p, i) => {
      if (!esObjeto(p) || typeof p.id !== 'string' || !CARAS[p.familia]) return;
      if (hallar(lista, p.id) !== i) return;
      const f = cotizarP(p);
      if (!f) return;
      cand.push({ i, p, f });
    });

    const pares = [];
    for (let x = 0; x < cand.length; x += 1) {
      for (let y = x + 1; y < cand.length; y += 1) {
        const A = cand[x]; const B = cand[y];
        const fams = [A.p.familia, B.p.familia];
        if (fams[0] === fams[1]) continue; // ninguna pareja es de dos piezas de la misma familia
        // las caras libres de cada pieza que se pueden juntar con la otra (se prueba cada par de caras)
        CARAS[A.p.familia].forEach((caraA) => {
          CARAS[B.p.familia].forEach((caraB) => {
            const armado = { id: 'sugerido', piezas: [{ partida: A.p.id, cara: caraA }, { partida: B.p.id, cara: caraB }], n: Math.min(num(A.p.cantidad), num(B.p.cantidad)) };
            if (!(armado.n >= 1)) return;
            const v = validarArmado(eff, armado, M, { heredar, antes_de_partir: true, tomadas: new Map() });
            if (!v.ok) return;
            pares.push({ A, B, armado, v });
          });
        });
      }
    }

    // el ahorro de cada pareja con el mismo motor: las dos piezas con y sin armado, más la UNION
    const evaluados = [];
    pares.forEach(({ A, B, armado, v }) => {
      const n = armado.n;
      const trozos = (X, cara) => {
        const total = num(X.p.cantidad);
        const armada = sinBridaEn({ ...X.p, cantidad: n }, cara);
        const resto = total > n ? { ...X.p, cantidad: total - n } : null;
        return { armada, resto };
      };
      const ta = trozos(A, armado.piezas[0].cara);
      const tb = trozos(B, armado.piezas[1].cara);
      const union = partidaUnion(armado, 'E?', v);
      const fa = cotizarP(ta.armada); const fb = cotizarP(tb.armada); const fu = cotizarP(union);
      const fra = ta.resto ? cotizarP(ta.resto) : null; const frb = tb.resto ? cotizarP(tb.resto) : null;
      if (!fa || !fb || !fu || (ta.resto && !fra) || (tb.resto && !frb)) return;
      const antes = A.f.precio.importe + B.f.precio.importe;
      const despues = [fa, fb, fu, fra, frb].filter(Boolean).reduce((s, f) => s + f.precio.importe, 0);
      const ahorro = U.redondear(antes - despues, 2);
      if (!(ahorro > 0.005)) return;
      const cAntes = sumar([A.f, B.f]);
      const cDespues = sumar([fa, fb, fu, fra, frb].filter(Boolean));
      const d = (k) => cAntes[k] - cDespues[k];
      const desglose = { aros: d('aros'), tornillos: d('tornillos'), juntas: d('juntas'), mano_obra: d('mano_obra') };
      desglose.otros = d('total') - desglose.aros - desglose.tornillos - desglose.juntas - desglose.mano_obra;
      evaluados.push({
        piezas: v.piezas.map((x) => ({ partida: x.partida, cara: x.cara, nombre: x.nombre })), n, pareja: v.pareja,
        descripcion: `${v.piezas[0].nombre} con ${v.piezas[1].nombre}`, angulo_deg: v.angulo_deg, es_90: v.es_90,
        dim_mm: v.dim_mm, limite_mm: v.limite_mm, D_mm: v.D_mm, junta: fu.geometria.costura === 'ENGARGOLADA' ? 'engargolada' : 'soldada',
        ahorro, antes: U.redondear(antes, 2), despues: U.redondear(despues, 2), ahorro_costo: d('total'), desglose,
      });
    });

    // asignación voraz: de mayor a menor ahorro, sin repetir partidas
    evaluados.sort((a, b) => b.ahorro - a.ahorro);
    const usadas = new Set();
    const salida = [];
    evaluados.forEach((s) => {
      if (s.piezas.some((x) => usadas.has(x.partida))) return;
      s.piezas.forEach((x) => usadas.add(x.partida));
      salida.push(s);
    });
    return salida;
  }

  /* ------------------------------------------------------------------ */
  /* Alta y baja en la cotización                                       */
  /* ------------------------------------------------------------------ */

  const idAleatorio = (prefijo) => `${prefijo}${Math.random().toString(36).slice(2, 8)}`;
  /** Las claves que no cuentan para saber si dos partidas son la misma pieza (identidad y vínculos con otros módulos). */
  const NO_COMPARAR = ['id', 'cantidad', 'unifilar_id', 'unifilar_editada', 'trazado_ventilador', 'trazado_pieza'];
  const igualesSalvoCantidad = (a, b) => {
    const limpia = (p) => { const q = { ...p }; NO_COMPARAR.forEach((k) => delete q[k]); return JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]])); };
    return limpia(a) === limpia(b);
  };

  /**
   * Acepta un armado en la cotización (la modifica): parte las partidas que tienen más piezas que `n` (la parte armada es una
   * partida nueva, justo después de la original, con `n` piezas; el resto sigue como estaba) y agrega el armado a `cot.armados`.
   * `piezas` = [{ partida, cara }, { partida, cara }]. Devuelve { ok, errores, armado, partidas_nuevas } y no cambia nada si no es válido.
   * opciones: heredar (valores de la cotización), nuevoId (generador de ids de partida).
   */
  function armar(cot, piezas, n, M, opciones) {
    const o = opciones || {};
    const nuevoId = o.nuevoId || (() => idAleatorio('p'));
    if (!Array.isArray(cot.partidas)) cot.partidas = [];
    if (!Array.isArray(cot.armados)) cot.armados = [];
    const armado = { id: idAleatorio('a'), piezas: (piezas || []).map((q) => ({ partida: q.partida, cara: q.cara })), n };
    const heredar = o.heredar || ((p) => p);
    const v = validarArmado(cot.partidas, armado, M, { heredar, antes_de_partir: true, armados: cot.armados });
    if (!v.ok) return { ok: false, errores: v.errores };
    const nuevas = [];
    armado.piezas.forEach((q) => {
      const i = hallar(cot.partidas, q.partida);
      const p = cot.partidas[i];
      if (num(p.cantidad) === n) return;
      const copia = U.clonar(p);
      copia.id = nuevoId();
      ['unifilar_id', 'unifilar_editada', 'trazado_ventilador', 'trazado_pieza'].forEach((k) => delete copia[k]);
      copia.cantidad = n;
      p.cantidad = num(p.cantidad) - n;
      cot.partidas.splice(i + 1, 0, copia);
      q.partida = copia.id;
      nuevas.push(copia.id);
    });
    cot.armados.push(armado);
    return { ok: true, armado, partidas_nuevas: nuevas, validacion: v };
  }

  /**
   * Quita un armado de la cotización (la modifica) y vuelve a juntar las partidas que se partieron: si una pieza del armado
   * es idéntica (salvo id y cantidad) a otra partida que no está armada, se suman las cantidades en la primera de las dos.
   * Devuelve { ok, juntadas }.
   */
  function deshacerArmado(cot, id) {
    const arms = Array.isArray(cot.armados) ? cot.armados : [];
    const k = arms.findIndex((a) => a && a.id === id);
    if (k < 0) return { ok: false, juntadas: 0 };
    const [quitado] = arms.splice(k, 1);
    let juntadas = 0;
    const enArmados = () => caraTomadas(arms, null);
    (quitado.piezas || []).forEach((q) => {
      const usadas = new Set([...enArmados().keys()].map((x) => x.split('|')[0]));
      const i = hallar(cot.partidas, q.partida);
      if (i < 0 || usadas.has(q.partida)) return;
      const j = cot.partidas.findIndex((r, m) => m !== i && esObjeto(r) && !usadas.has(r.id) && igualesSalvoCantidad(r, cot.partidas[i]));
      if (j < 0) return;
      const [primera, segunda] = i < j ? [i, j] : [j, i];
      cot.partidas[primera].cantidad = num(cot.partidas[primera].cantidad) + num(cot.partidas[segunda].cantidad);
      cot.partidas.splice(segunda, 1);
      juntadas += 1;
    });
    return { ok: true, juntadas };
  }

  /** Los armados de una cotización que viene de fuera: sólo los que tienen la forma esperada (id, dos piezas, n entero). */
  function limpiarArmados(lista) {
    if (!Array.isArray(lista)) return [];
    const vistos = new Set();
    return lista.filter(esObjeto).map((a) => {
      if (!Array.isArray(a.piezas) || a.piezas.length !== 2 || !a.piezas.every((q) => esObjeto(q) && typeof q.partida === 'string' && q.partida && typeof q.cara === 'string' && q.cara)) return null;
      let id = typeof a.id === 'string' && a.id ? a.id : idAleatorio('a');
      while (vistos.has(id)) id = idAleatorio('a');
      vistos.add(id);
      const n = Number.isInteger(a.n) && a.n >= 1 && a.n <= N_MAX ? a.n : 1;
      return { id, piezas: a.piezas.map((q) => ({ partida: q.partida, cara: q.cara })), n };
    }).filter(Boolean);
  }

  return {
    aplicarArmados, validarArmado, sugerirArmados, armar, deshacerArmado, limpiarArmados, nombrePieza, textoD, NOMBRE_CARA, CARAS,
  };
}));
