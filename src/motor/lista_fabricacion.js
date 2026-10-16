/**
 * COTIZAP · lista_fabricacion.js — La lista de piezas para fabricar: cada pieza con su marca, cuántas son, todas sus medidas,
 * material, calibre, extremos, costura, bridas y peso. Es una hoja de taller: no lleva precios.
 *
 * Es pura y no toca el DOM. Todo sale del resultado del motor (cotizar → res.partidas[i]); aquí no se recalcula nada, sólo se
 * ordena y se escribe como lo lee el taller. Las marcas (B1, C1, I1, R1, T1, D1, S1, A1, P1) son las de la pestaña Planos: las
 * dos salen de `agrupar`, que reparte las partidas en hojas por tipo de pieza (y por material y calibre en las de lámina).
 *
 * `listaFabricacion(cot, res, M, opciones)` → { encabezado, piezas, aparte, totales }. `aparte` trae lo que no se fabrica aquí
 * (instalación, compras sin barrenos, piezas personalizadas, partidas con error), con el motivo, para no ocultar nada.
 * Depende de web/planos.js (`plano`, `titulo`, `formato`), que decide qué se dibuja.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(() => require('../web/planos'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.listaFabricacion = factory(() => root.COTIZAP.planos);
  }
}(typeof self !== 'undefined' ? self : this, function (obtenerPlanos) {
  'use strict';

  const PL = () => obtenerPlanos(); // planos.js se carga después de los módulos del motor: se pide hasta que se usa
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);

  /** Misma convención que W.num: es-MX con `d` decimales fijos. */
  const num = (x, d) => Number(x).toLocaleString('es-MX', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
  /** Milímetros con un decimal si hace falta: 279.4 → «279.4 mm», 1300 → «1,300 mm». */
  const mmt = (x) => { const r = Math.round(x * 10) / 10; return `${num(r, Number.isInteger(r) ? 0 : 1)} mm`; };
  const grados = (g) => { const r = Math.round(g * 100) / 100; return `${num(r, Number.isInteger(r) ? 0 : Math.round(r * 10) === r * 10 ? 1 : 2)}°`; };
  /** Diámetro: «11″ (279.4 mm)» si es medida en pulgadas, «300 mm» si no. */
  const dn = (x) => { const p = PL().formato.pulg(x); return p ? `${p} (${mmt(x)})` : mmt(x); };
  const sinParentesis = (t) => String(t || '').split(' (')[0];

  /* ---------------- Las hojas de Planos: grupos y marcas ---------------- */

  /** «11″» o «500 × 300 mm»: la medida de un ducto recto (las hojas de yardas van por diámetro). */
  function medida(p) {
    const f = PL().formato;
    return p.forma === 'RECTANGULAR' ? `${f.mm(p.a_mm)} × ${f.mm(p.b_mm)} mm` : f.nominal(Number(p.D_mm));
  }

  /** Las hojas, en el orden de los planos de pedido (bridas, codos, reducciones con injerto) y luego lo demás. */
  const GRUPOS = [
    { id: 'BRIDAS', fams: ['BRIDA', 'COMPRADO'], marca: 'B', nombre: () => 'Bridas' },
    { id: 'CODOS', fams: ['CODO'], marca: 'C', lamina: true, nombre: () => 'Codos' },
    {
      id: 'INJERTOS', fams: ['REDUCCION_INJERTO', 'RAMAL'], marca: 'I', lamina: true,
      nombre: (ps) => (ps.some((x) => x.p.familia === 'REDUCCION_INJERTO') ? (ps.some((x) => x.p.familia === 'RAMAL') ? 'Reducciones con injerto e injertos' : 'Reducciones con injerto') : 'Injertos'),
    },
    { id: 'REDUCCIONES', fams: ['REDUCCION'], marca: 'R', lamina: true, nombre: () => 'Reducciones' },
    { id: 'TRANSICIONES', fams: ['TRANSICION'], marca: 'T', lamina: true, nombre: () => 'Transiciones' },
    { id: 'TAPAS', fams: ['TAPA'], marca: 'P', lamina: true, nombre: () => 'Tapas' },
    { id: 'RECTOS', fams: ['RECTO'], marca: 'D', lamina: true, porMedida: true, nombre: (ps) => `Ductos de ${medida(ps[0].p)}` },
    { id: 'SOPORTERIA', fams: ['SOPORTE'], marca: 'S', nombre: () => 'Soportería' },
    { id: 'ARMADO', fams: ['UNION'], marca: 'A', nombre: () => 'Armado de piezas' },
  ];

  /**
   * Las partidas que se dibujan, repartidas en hojas con su marca; y cuántas no tienen plano (instalación, compras sin barrenos,
   * piezas personalizadas) o tienen errores. `materialDe(p)` es el texto de material y calibre que parte las hojas de lámina
   * (la interfaz pasa W.resumenMaterial); sin él se usa el del resultado del motor.
   * Devuelve { hojas: [{ g, material, items: [{ p, f, d, marca, i }] }], sinPlano, conError, n, noDibujadas: [{ p, f, i, motivo }] }.
   */
  function agrupar(cot, res, M, materialDe) {
    const material = materialDe || ((p, f) => (f && f.material ? `${sinParentesis(f.material)} · ${p.espesor_mm > 0 ? `${p.espesor_mm} mm` : `cal. ${p.calibre}`}` : ''));
    const dibujables = [];
    const noDibujadas = [];
    let sinPlano = 0;
    let conError = 0;
    cot.partidas.forEach((p, i) => {
      const f = res.partidas[i];
      if (!f || !f.ok) { conError += 1; noDibujadas.push({ p, f, i, error: true }); return; }
      const d = PL().plano(f, M);
      // una familia con dibujo pero sin hoja en los planos tampoco se oculta: queda en `noDibujadas`
      if (!d || !GRUPOS.some((g) => g.fams.includes(p.familia))) { sinPlano += 1; noDibujadas.push({ p, f, i, error: false }); return; }
      dibujables.push({ p, f, d, i });
    });
    const out = [];
    GRUPOS.forEach((g) => {
      const del = dibujables.filter((x) => g.fams.includes(x.p.familia));
      if (!del.length) return;
      // las de lámina, una hoja por material y calibre (como «CODOS / ACERO GALVANIZADO CAL. 24»)
      const llaves = [];
      const por = new Map();
      // los ductos rectos, además, por medida (de la mayor a la menor), como los planos de yardas
      const orden = g.porMedida ? del.slice().sort((a, b) => (Number(b.p.D_mm) || Number(b.p.a_mm) || 0) - (Number(a.p.D_mm) || Number(a.p.a_mm) || 0)) : del;
      orden.forEach((x) => {
        const mat = g.lamina ? (material(x.p, x.f) || '') : '';
        const k = g.porMedida ? `${medida(x.p)}|${mat}` : mat;
        if (!por.has(k)) { por.set(k, []); llaves.push(k); }
        por.get(k).push(x);
      });
      llaves.forEach((k) => out.push({ g, material: g.porMedida ? k.split('|')[1] : k, items: por.get(k) }));
    });
    // marcas por tipo de pieza (B1, B2… C1, C2…), seguidas aunque el material parta la hoja
    const cuenta = {};
    out.forEach((hj) => hj.items.forEach((x) => { cuenta[hj.g.marca] = (cuenta[hj.g.marca] || 0) + 1; x.marca = `${hj.g.marca}${cuenta[hj.g.marca]}`; }));
    return { hojas: out, sinPlano, conError, n: dibujables.length, noDibujadas };
  }

  /* ---------------- Las medidas de cada pieza ---------------- */

  const NOMBRE_EXT = {
    A: 'Extremo A', B: 'Extremo B', D1: 'Extremo mayor', D2: 'Extremo menor', injerto: 'Injerto', tronco_1: 'Tronco, extremo 1', tronco_2: 'Tronco, extremo 2',
    redondo: 'Extremo redondo', rectangular: 'Extremo rectangular', tapa: 'Boca', tramo: 'Tramo', brida: 'Brida',
  };
  const TIPO_FAMILIA = { RECTO: 'Tramo recto', CODO: 'Codo', REDUCCION: 'Reducción', REDUCCION_INJERTO: 'Reducción con injerto', RAMAL: 'Ducto con injerto', TRANSICION: 'Transición', BRIDA: 'Brida', COMPRADO: 'Brida de placa comprada', SOPORTE: 'Soportería', UNION: 'Armado de piezas', TAPA: 'Tapa' };

  /** Pares etiqueta/valor; lo que no tiene valor no se escribe. */
  function lista() {
    const filas = [];
    const f = (etiqueta, valor) => { if (valor !== null && valor !== undefined && valor !== '') filas.push({ etiqueta, valor: String(valor) }); return filas; };
    f.filas = filas;
    return f;
  }

  /** Las composiciones de un tramo recto: «2 yardas + 560 mm de ajuste». */
  function composicion(q) {
    const y = q.yardas === 1 ? '1 yarda' : q.yardas > 1 ? `${q.yardas} yardas` : '';
    const a = q.ajuste_mm > 0 ? `${mmt(q.ajuste_mm)} de ajuste` : '';
    return [y, a].filter(Boolean).join(' + ') || mmt(q.largo_mm);
  }

  function medidasDe(f, p, M) {
    const m = lista();
    const det = (f.geometria && f.geometria.detalle) || {};
    const rect = p.forma === 'RECTANGULAR';
    const seccion = () => (rect ? m('Sección a × b', `${mmt(p.a_mm)} × ${mmt(p.b_mm)}`) : m('Ø', dn(p.D_mm)));
    const referido = () => { if (!rect && p.ref_diametro) m('Ø referido al', p.ref_diametro === 'EXTERIOR' ? 'exterior' : 'interior'); };
    switch (f.familia) {
      case 'RECTO': {
        const arm = det.armado;
        seccion(); referido();
        m('Largo L', mmt(p.L_mm));
        if (p.posicion === 'VERTICAL') m('Posición', 'Vertical');
        if (arm) {
          m('Yarda (ancho de lámina)', mmt(arm.yarda_mm));
          m('Yardas completas', `${arm.n_completas}`);
          if (arm.ajuste_mm > 0) m('Tramo de ajuste', mmt(arm.ajuste_mm));
          m('Piezas por tramo', `${arm.n_piezas}`);
          arm.piezas.forEach((q, k) => m(arm.piezas.length > 1 ? `Pieza ${k + 1}` : 'Armado', `${composicion(q)}${arm.piezas.length > 1 ? ` = ${mmt(q.largo_mm)}` : ''}`));
          if (arm.n_juntas > 0) m('Juntas entre yardas', `${arm.n_juntas}`);
        }
        break;
      }
      case 'CODO': {
        seccion(); referido();
        m('Ángulo', grados(p.theta_deg));
        if (det.n_gajos) m('Gajos', `${det.n_gajos}`);
        if (fin(det.alfa_deg)) m('Ángulo por gajo', grados(det.alfa_deg));
        if (fin(det.R_mm)) {
          m('Radio R', mmt(det.R_mm));
          const D = rect ? p.a_mm : p.D_mm;
          m('R/D', num(det.R_mm / D, 2));
        } else if (p.k_R) m('R/D', num(p.k_R, 2));
        if (fin(det.l_gajo_mm)) m('Largo de gajo', mmt(det.l_gajo_mm));
        if (fin(det.L_eje_mm)) m('Largo sobre el eje', mmt(det.L_eje_mm));
        m('Tangentes', fin(det.L_tangentes_mm) && det.L_tangentes_mm > 0 ? `${mmt(p.L_tangente_mm)} por extremo (${mmt(det.L_tangentes_mm)} en total)` : 'Sin tangentes');
        break;
      }
      case 'REDUCCION':
        referido();
        m('Ø mayor', dn(p.D1_mm));
        m('Ø menor', dn(p.D2_mm));
        m('Largo L', mmt(det.L_mm || p.L_mm));
        m('Tipo', p.excentrica === 'CARA_PLANA' ? 'Excéntrica, cara plana arriba' : 'Concéntrica');
        if (fin(det.semiangulo_deg)) m('Semiángulo del cono', grados(det.semiangulo_deg));
        break;
      case 'REDUCCION_INJERTO':
        referido();
        m('Ø mayor', dn(p.D1_mm));
        m('Ø menor', dn(p.D2_mm));
        m('Largo de la reducción', mmt(det.L_reduccion_mm || p.L_reduccion_mm));
        m('Ø del injerto', dn(p.d_mm));
        m('Ángulo del injerto β', grados(det.beta_deg || p.beta_deg));
        m('Largo del injerto', `${mmt(det.L_ramal_mm || p.L_ramal_mm)} sobre su eje`);
        if (fin(det.semiangulo_deg)) m('Semiángulo del cono', grados(det.semiangulo_deg));
        break;
      case 'RAMAL':
        referido();
        m('Ø del tronco', dn(p.D_mm));
        m('Largo del tronco', mmt(p.L_cuerpo_mm));
        m('Ø del injerto', dn(p.d_mm));
        m('Ángulo del injerto β', grados(det.beta_deg || p.beta_deg));
        m('Largo del injerto', `${mmt(p.L_ramal_mm)} sobre su eje`);
        break;
      case 'TRANSICION':
        referido();
        m('Ø redondo', dn(p.D_mm));
        m('Rectángulo a × b', `${mmt(p.a_mm)} × ${mmt(p.b_mm)}`);
        m('Largo L', mmt(det.H_mm || p.H_mm));
        break;
      case 'BRIDA': {
        const a = f.qto.her.aros_sueltos[0] || f.qto.her.aros[0];
        const ext = (f.geometria.extremos_sueltos && f.geometria.extremos_sueltos[0]) || (f.geometria.extremos && f.geometria.extremos[0]);
        if (!a || !ext) break;
        if (ext.forma !== 'REDONDA') {
          m('Marco para ducto', `${mmt(p.a_mm)} × ${mmt(p.b_mm)}`);
          m('Interior', `${mmt(ext.a_ext_mm)} × ${mmt(ext.b_ext_mm)}`);
          m('Exterior', `${mmt(ext.a_ext_mm + 2 * a.ancho_mm)} × ${mmt(ext.b_ext_mm + 2 * a.ancho_mm)}`);
        } else {
          m('Brida para ducto', dn(p.D_mm));
          m('Ø interior (Dint)', mmt(ext.D_ext_mm));
          m('Ø de barrenos (Dperf)', mmt(a.P_perno_mm / Math.PI));
          m('Ø exterior (Dext)', mmt(ext.D_ext_mm + 2 * a.ancho_mm));
        }
        m('Barrenos', `${a.n_tornillos} de Ø${mmt(a.diam_barreno_mm)}`);
        break;
      }
      case 'COMPRADO': {
        const k = f.compra || {};
        const art = M && k.articulo_id && M.compras.articulos[k.articulo_id];
        const Dperf = k.circulo_barrenos_mm;
        const Dext = art && art.diam_ext_mm > Dperf ? art.diam_ext_mm : Dperf + 26;
        const Dint = art && art.diam_int_mm > 0 && art.diam_int_mm < Dperf ? art.diam_int_mm : Dperf - 40;
        m('Ø interior (Dint)', mmt(Dint));
        m('Ø de barrenos (Dperf)', mmt(Dperf));
        m('Ø exterior (Dext)', mmt(Dext));
        m('Barrenos', `${Math.max(2, 2 * (k.tornillos_pieza || 0))}`);
        m('Origen', 'Comprada: se manda cortar');
        break;
      }
      case 'SOPORTE': {
        const s = f.soporte || {};
        const b = s.barra || {};
        m('Barra', b.descripcion);
        if (s.largo_calculado && p.abrazadera_D_mm > 0) {
          m('Abrazadera para ducto', dn(p.abrazadera_D_mm));
          m('Vuelta', s.vuelta === 'COMPLETA' ? 'Completa (dos mitades)' : 'Media vuelta');
          m('Largo de barra por pieza', mmt(s.largo_pieza_mm));
          if (M && M.proceso && M.proceso.soportes) m('Orejas', mmt(M.proceso.soportes.oreja_abrazadera_mm));
        } else {
          m('Largo por pieza', mmt(s.largo_pieza_mm));
          if (p.anclajes_pieza > 0) m('Anclajes por pieza', `${p.anclajes_pieza}`);
        }
        break;
      }
      case 'UNION':
        m('Ø', dn(p.D_mm));
        m('Uniones por pieza', `${det.n_uniones || 1}`);
        m('Tipo de unión', f.geometria.costura === 'ENGARGOLADA' ? 'Engargolada' : 'Soldada (filete continuo)');
        break;
      case 'TAPA':
        m('Ø', dn(p.D_mm));
        m('Cuello', det.L_cuello_mm > 0 ? mmt(det.L_cuello_mm) : 'Disco plano');
        break;
      default: break;
    }
    return m.filas;
  }

  /** Cómo queda cada extremo de la pieza: con brida de taller, suelta, de otra partida, sin brida o liso. */
  function extremosDe(f) {
    const m = lista();
    const her = f.qto && f.qto.her;
    const g = f.geometria || {};
    if (!her || f.familia === 'BRIDA' || f.familia === 'COMPRADO' || f.familia === 'SOPORTE') return m.filas;
    const det = g.detalle || {};
    if (f.familia === 'UNION') { m('Extremos', 'Van sin brida: se unen a otras piezas'); return m.filas; }
    if (her.tipo_union !== 'BRIDADO') { m('Extremos', 'Lisos, sin brida'); return m.filas; }
    if (f.familia === 'RECTO' && det.armado) {
      const arm = det.armado;
      arm.piezas.forEach((q, k) => {
        const txt = q.bridas >= 2 ? 'Bridas de taller en ambos extremos' : q.sueltas ? 'Brida de taller en un extremo y una brida suelta en el otro' : 'Brida de taller en un extremo; el otro, sin brida';
        m(arm.piezas.length > 1 ? `Pieza ${k + 1}` : 'Extremos', txt);
      });
      return m.filas;
    }
    const sin = g.extremos_sin_brida || [];
    (her.bridas || []).concat(sin.filter((id) => !(her.bridas || []).some((b) => b.extremo === id)).map((id) => ({ extremo: id, sin: true }))).forEach((b) => {
      const que = sin.includes(b.extremo) || b.sin ? 'Sin brida (se une a otra pieza)'
        : b.aparte ? 'Brida de otra partida (aquí sólo se fija al ducto)'
          : b.suelta ? 'Brida suelta' : 'Con brida de taller';
      m(NOMBRE_EXT[b.extremo] || b.extremo, que);
    });
    return m.filas;
  }

  /** Los aros de brida de la pieza (de taller y sueltos): perfil, ancho, gramil, Ø de barreno, tornillos y paso. */
  function bridasDe(f) {
    const her = f.qto && f.qto.her;
    if (!her) return [];
    const aro = (a, suelta) => ({
      perfil: a.descripcion, ancho_mm: a.ancho_mm, gramil_mm: a.gramil_mm, diam_barreno_mm: a.diam_barreno_mm, n_tornillos: a.n_tornillos,
      paso_mm: a.n_tornillos > 0 ? a.P_perno_mm / a.n_tornillos : null, P_perno_mm: a.P_perno_mm, tornillo: a.tornillo_desc || a.tornillo, suelta,
    });
    return [...(her.aros || []).map((a) => aro(a, false)), ...(her.aros_sueltos || []).map((a) => aro(a, true))];
  }
  const textoAro = (a) => `${a.perfil || 'Solera'}; ancho ${mmt(a.ancho_mm)}; gramil ${mmt(a.gramil_mm)}; ${a.n_tornillos} barrenos de Ø${mmt(a.diam_barreno_mm)}${a.paso_mm ? `; paso ${mmt(a.paso_mm)}` : ''}${a.tornillo ? `; tornillo ${a.tornillo}` : ''}`;

  /* ---------------- La lista ---------------- */

  function piezaDe(x, M) {
    const { p, f, d, marca } = x;
    // el ducto recto va con su medida («Tramo recto Ø11″ × 2428 mm»): en la lista no hay hoja por diámetro que la diga
    const titulo = (p.familia === 'UNION' && p.descripcion) || (p.familia === 'RECTO' && sinParentesis(d.titulo)) || d.titulo_corto || PL().titulo(p) || sinParentesis(d.titulo);
    const lamina = !!f.material;
    const kgU = f.peso ? f.peso.neto_unitario_kg : 0;
    const kgT = f.peso ? f.peso.neto_total_kg : 0;
    const aros = bridasDe(f);
    const her = f.qto && f.qto.her;
    // El calibre «más delgado que el mínimo recomendado» (cotizador.js) es una recomendación de la cotización,
    // no una instrucción de taller: no trae código, se reconoce por su texto y no entra a la lista de fabricación.
    const avisos = (f.advertencias || []).filter((w) => !/más delgado que el mínimo recomendado/.test(w));
    const notas = [...(d.notas || [])];
    let material = lamina ? sinParentesis(f.material) : '';
    if (f.familia === 'SOPORTE' && f.soporte && f.soporte.barra) material = f.soporte.barra.descripcion || '';
    if (f.familia === 'COMPRADO') material = 'Placa (comprada)';
    return {
      marca, grupo: marca.replace(/\d+$/, ''), indice: x.i, id: p.id, familia: f.familia, tipo: TIPO_FAMILIA[f.familia] || f.familia,
      cantidad: p.cantidad, titulo, descripcion: p.descripcion && p.descripcion !== titulo ? p.descripcion : (p.familia === 'RECTO' && d.titulo_corto) || '',
      material, calibre: lamina && !(p.espesor_mm > 0) ? p.calibre : null, espesor_mm: lamina ? f.espesor_mm : null,
      medidas: medidasDe(f, p, M),
      costura: f.geometria && f.geometria.costura ? (f.geometria.costura === 'ENGARGOLADA' ? 'Engargolada' : 'Soldada') : '',
      extremos: extremosDe(f),
      bridas: aros,
      bridas_texto: aros.map((a, i) => ({ etiqueta: `Brida ${i + 1}${a.suelta ? ' (suelta)' : ''}`, valor: textoAro(a) })),
      bridas_aparte: !!(her && her.bridas_aparte),
      peso_unitario_kg: kgU, peso_total_kg: kgT,
      advertencias: avisos, notas,
      dibujo: d,
    };
  }

  /** Por qué una partida no está en la lista de fabricación. */
  function motivoAparte(p, f, error) {
    if (error) {
      const e = f && Array.isArray(f.errores) && f.errores.length ? ` (${f.errores.join('; ')})` : '';
      return `Tiene errores y no se calculó: corríjala en la cotización${e}`;
    }
    switch (p.familia) {
      case 'INSTALACION': return 'Servicio de instalación en obra: no se fabrica';
      case 'COMPRADO': return 'Artículo comprado: se pide al proveedor, no se fabrica';
      case 'PERSONALIZADO': return 'Pieza personalizada sin dibujo: sus medidas no están en la cotización, pídalas aparte';
      default: return 'No tiene dibujo acotado en esta versión: pida sus medidas aparte';
    }
  }

  function listaFabricacion(cot, res, M, opciones) {
    const o = opciones || {};
    const A = agrupar(cot, res, M, o.materialDe);
    const piezas = [];
    A.hojas.forEach((hj) => hj.items.forEach((x) => piezas.push(piezaDe(x, M))));
    const aparte = A.noDibujadas.map(({ p, f, i, error }) => ({
      indice: i, id: p.id, familia: p.familia, cantidad: p.cantidad,
      titulo: (f && f.ok && f.descripcion) || p.descripcion || PL().titulo(p) || TIPO_FAMILIA[p.familia] || p.familia,
      motivo: motivoAparte(p, f, error),
    })).sort((a, b) => a.indice - b.indice);
    const materiales = [];
    piezas.forEach((q) => {
      const t = q.material && q.espesor_mm !== null ? `${q.material} · ${q.calibre ? `cal. ${q.calibre}` : `${num(q.espesor_mm, 3)} mm`}` : '';
      if (t && !materiales.includes(t)) materiales.push(t);
    });
    return {
      encabezado: {
        proyecto: cot.proyecto || '', cliente: cot.cliente || '', folio: cot.folio || '', fecha: cot.fecha || '',
        material: materiales.join(' / '),
      },
      piezas,
      aparte,
      totales: {
        partidas: piezas.length,
        piezas: piezas.reduce((s, q) => s + (Number(q.cantidad) || 0), 0),
        kg: piezas.reduce((s, q) => s + q.peso_total_kg, 0),
      },
    };
  }

  return { listaFabricacion, agrupar, GRUPOS, medida, formato: { num, mmt, grados, dn } };
}));
