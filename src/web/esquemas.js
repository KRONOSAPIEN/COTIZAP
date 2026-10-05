/**
 * COTIZAP · web/esquemas.js — Definición declarativa de los formularios de partida.
 * Cada campo: { id, etiqueta, tipo, ... }.  tipos: dim (mm ⇄ in) · num · int · pct · select · text · calibre
 * `opcional` = vacío significa "automático" (el motor usa su valor por defecto).
 */
(function (root) {
  'use strict';

  const W = root.COTIZAP.web;
  const redonda = (v) => (v.forma || 'REDONDA') === 'REDONDA';
  const rect = (v) => v.forma === 'RECTANGULAR';

  W.FAMILIAS = [
    ['RECTO', 'Tramo recto'],
    ['CODO', 'Codo'],
    ['REDUCCION', 'Reducción'],
    ['TRANSICION', 'Transición'],
    ['RAMAL', 'Injerto simple'],
    ['REDUCCION_INJERTO', 'Reducción con injerto'],
    ['PERSONALIZADO', 'Personalizada'],
    ['COMPRADO', 'Comprado'],
  ];
  /** Familias que ya no se ofrecen para partidas nuevas, pero que se siguen calculando para abrir cotizaciones anteriores. */
  W.FAMILIAS_RETIRADAS = [['PANTALON', 'Pantalón (retirado)']];

  W.OPC = {
    forma: [['REDONDA', 'Redondo'], ['RECTANGULAR', 'Rectangular']],
    ref_diametro: [['INTERIOR', 'Interior (nominal)'], ['EXTERIOR', 'Exterior']],
    tipo_union: [['BRIDADO', 'Bridado · aros, tornillos y empaque'], ['ESPIGA', 'Espiga · macho–hembra'], ['LISO', 'Extremos lisos']],
    clase_sellado: [['C', 'Clase C · juntas transversales'], ['B', 'Clase B · + costuras longitudinales'], ['A', 'Clase A · + penetraciones'], ['NINGUNA', 'Sin sellador']],
    pintura: [['', 'Según el material'], ['NINGUNA', 'Sin pintura'], ['PRIMARIO', 'Primario'], ['PRIMARIO_ESMALTE', 'Primario + esmalte']],
    caras_pintadas: [['1', 'Sólo exterior'], ['2', 'Exterior e interior']],
    servicio: [['', 'Según la cotización'], ['VENTILACION', 'Ventilación'], ['POLVO', 'Colección de polvo'], ['ABRASIVO', 'Material abrasivo']],
    riesgo: [['', 'Según la cotización'], ['BAJO', 'Bajo'], ['MEDIO', 'Medio'], ['ALTO', 'Alto']],
    proceso_corte: [['', 'Automático'], ['GUILLOTINA', 'Guillotina'], ['PLASMA', 'Plasma CNC'], ['LASER', 'Láser']],
    tipo_costura: [['A_TOPE', 'Soldada a tope'], ['TRASLAPE', 'Soldada a traslape'], ['PITTSBURGH', 'Engargolado Pittsburgh']],
    excentrica: [['NO', 'Concéntrica'], ['CARA_PLANA', 'Excéntrica · cara plana']],
    driver: [['PIEZA', 'Por pieza'], ['KG_NETO', 'Por kg neto'], ['KG_BRUTO', 'Por kg bruto'], ['M2_NETO', 'Por m² de lámina'], ['M_CORTE', 'Por m de corte'], ['M_SOLDADURA', 'Por m de soldadura']],
  };

  W.OPERACIONES = [
    ['corte', 'Corte'], ['rolado', 'Rolado'], ['armado', 'Armado'], ['aros', 'Aros de brida'], ['soldadura', 'Soldadura'],
    ['engargolado', 'Engargolado'], ['barrenado', 'Barrenado'], ['acabado', 'Acabado'], ['pintura', 'Pintura'], ['qc_embalaje', 'Inspección y embalaje'],
  ];

  /** Campos geométricos por familia. */
  W.CAMPOS = {
    RECTO: [
      { id: 'forma', etiqueta: 'Sección', tipo: 'select', opciones: 'forma', defecto: 'REDONDA' },
      { id: 'D_mm', etiqueta: 'Diámetro', tipo: 'dim', visible: redonda, defecto: 304.8 },
      { id: 'a_mm', etiqueta: 'Ancho a', tipo: 'dim', visible: rect, defecto: 500 },
      { id: 'b_mm', etiqueta: 'Alto b', tipo: 'dim', visible: rect, defecto: 300 },
      { id: 'L_mm', etiqueta: 'Longitud total', tipo: 'dim', defecto: 3000 },
      { id: 'tipo_costura', etiqueta: 'Costura longitudinal', tipo: 'select', opciones: 'tipo_costura', defecto: 'A_TOPE' },
      { id: 'L_max_pieza_mm', etiqueta: 'Longitud máx. por pieza', tipo: 'dim', opcional: true, ayuda: 'Vacío = valor de maestros (3 000 mm)' },
    ],
    CODO: [
      { id: 'forma', etiqueta: 'Sección', tipo: 'select', opciones: 'forma', defecto: 'REDONDA' },
      { id: 'D_mm', etiqueta: 'Diámetro', tipo: 'dim', visible: redonda, defecto: 304.8 },
      { id: 'a_mm', etiqueta: 'Ancho a (en el plano del giro)', tipo: 'dim', visible: rect, defecto: 400 },
      { id: 'b_mm', etiqueta: 'Alto b', tipo: 'dim', visible: rect, defecto: 300 },
      { id: 'theta_deg', etiqueta: 'Ángulo del codo', tipo: 'select', opciones: 'angulos_codo', numerico: true, defecto: 90 },
      { id: 'k_R', etiqueta: 'Relación R/D', tipo: 'num', defecto: 1.5, min: 1, paso: 0.25, ayuda: 'Radio de eje ÷ diámetro (en rectangular: ÷ a)' },
      { id: 'n_gajos', etiqueta: 'Gajos', tipo: 'int', opcional: true, visible: redonda, min: 2, ayuda: 'Vacío = automático (α ≤ 22.5° por junta)' },
      { id: 'L_tangente_mm', etiqueta: 'Tangente en cada extremo', tipo: 'dim', opcional: true, visible: redonda },
    ],
    REDUCCION: [
      { id: 'D1_mm', etiqueta: 'Diámetro mayor D1', tipo: 'dim', defecto: 304.8 },
      { id: 'D2_mm', etiqueta: 'Diámetro menor D2', tipo: 'dim', defecto: 203.2 },
      { id: 'L_mm', etiqueta: 'Longitud axial', tipo: 'dim', opcional: true, ayuda: 'Vacío = automático con semiángulo de 15°' },
      { id: 'excentrica', etiqueta: 'Tipo', tipo: 'select', opciones: 'excentrica', defecto: 'NO' },
    ],
    TRANSICION: [
      { id: 'D_mm', etiqueta: 'Diámetro (extremo redondo)', tipo: 'dim', defecto: 304.8 },
      { id: 'a_mm', etiqueta: 'Ancho a (extremo rectangular)', tipo: 'dim', defecto: 400 },
      { id: 'b_mm', etiqueta: 'Alto b (extremo rectangular)', tipo: 'dim', defecto: 300 },
      { id: 'H_mm', etiqueta: 'Longitud axial', tipo: 'dim', opcional: true, ayuda: 'Vacío = automático con semiángulo de 15°' },
    ],
    RAMAL: [ // injerto simple (en el motor: cuerpo = tronco, ramal = injerto)
      { id: 'D_mm', etiqueta: 'Diámetro del tronco', tipo: 'dim', defecto: 304.8 },
      { id: 'd_mm', etiqueta: 'Diámetro del injerto', tipo: 'dim', defecto: 203.2 },
      { id: 'L_cuerpo_mm', etiqueta: 'Longitud del tronco', tipo: 'dim', defecto: 700 },
      { id: 'L_ramal_mm', etiqueta: 'Longitud del injerto', tipo: 'dim', defecto: 450, ayuda: 'Sobre su eje, desde el eje del tronco' },
      { id: 'beta_deg', etiqueta: 'Ángulo del injerto', tipo: 'select', opciones: 'angulos_injerto', numerico: true, defecto: 45 },
    ],
    REDUCCION_INJERTO: [ // el injerto va SOBRE EL CONO de la reducción
      { id: 'D1_mm', etiqueta: 'Diámetro mayor D1', tipo: 'dim', defecto: 304.8 },
      { id: 'D2_mm', etiqueta: 'Diámetro menor D2', tipo: 'dim', defecto: 254 },
      { id: 'd_mm', etiqueta: 'Diámetro del injerto', tipo: 'dim', defecto: 152.4 },
      { id: 'beta_deg', etiqueta: 'Ángulo del injerto', tipo: 'select', opciones: 'angulos_injerto', numerico: true, defecto: 45 },
      { id: 'L_reduccion_mm', etiqueta: 'Longitud de la reducción', tipo: 'dim', opcional: true, ayuda: 'Vacío = automático (la menor que aloja el injerto sobre el cono, con holgura)' },
      { id: 'L_ramal_mm', etiqueta: 'Longitud del injerto', tipo: 'dim', opcional: true, ayuda: 'Sobre su eje, desde el eje de la reducción. Vacío = automático' },
    ],
    PANTALON: [ // retirado: sólo para editar cotizaciones anteriores
      { id: 'D_mm', etiqueta: 'Diámetro del tronco', tipo: 'dim', defecto: 500 },
      { id: 'd1_mm', etiqueta: 'Diámetro del ramal 1', tipo: 'dim', defecto: 354 },
      { id: 'd2_mm', etiqueta: 'Diámetro del ramal 2', tipo: 'dim', defecto: 354 },
      { id: 'L_tronco_mm', etiqueta: 'Longitud del tronco', tipo: 'dim', defecto: 300 },
      { id: 'L1_mm', etiqueta: 'Longitud ramal 1', tipo: 'dim', defecto: 500 },
      { id: 'L2_mm', etiqueta: 'Longitud ramal 2', tipo: 'dim', defecto: 500 },
      { id: 'k_entrepierna', etiqueta: 'Factor de entrepierna', tipo: 'num', opcional: true, paso: 0.01, ayuda: 'Vacío = valor de maestros (0.08); calibrar con desarrollos reales' },
    ],
    PERSONALIZADO: [
      { id: 'A_neta_m2', etiqueta: 'Área neta desarrollada', tipo: 'num', unidad: 'm²', defecto: 1, min: 0.001, paso: 0.01 },
      { id: 'L_corte_m', etiqueta: 'Longitud de corte', tipo: 'num', unidad: 'm', defecto: 6, min: 0, paso: 0.1 },
      { id: 'L_sold_tope_m', etiqueta: 'Soldadura a tope', tipo: 'num', unidad: 'm', defecto: 3, min: 0, paso: 0.1 },
      { id: 'L_sold_filete_m', etiqueta: 'Soldadura de filete', tipo: 'num', unidad: 'm', defecto: 0, min: 0, paso: 0.1 },
      { id: 'n_piezas', etiqueta: 'Piezas a armar', tipo: 'int', defecto: 1, min: 1 },
      { id: 'n_extremos', etiqueta: 'Extremos a unir', tipo: 'int', defecto: 2, min: 0 },
      { id: 'D_ref_mm', etiqueta: 'Diámetro de los extremos', tipo: 'dim', defecto: 300 },
    ],
    COMPRADO: [
      { id: 'precio_compra_unitario', etiqueta: 'Costo de compra unitario', tipo: 'num', unidad: 'MXN', defecto: 1000, min: 0, paso: 1 },
      { id: 'peso_kg', etiqueta: 'Peso unitario', tipo: 'num', unidad: 'kg', defecto: 0, min: 0, opcional: true },
    ],
  };

  /** Campos de material y proceso (no aplican a COMPRADO). */
  W.CAMPOS_MATERIAL = [
    { id: 'material_id', etiqueta: 'Material', tipo: 'select', opciones: 'materiales' },
    { id: 'calibre', etiqueta: 'Calibre', tipo: 'calibre' },
    { id: 'espesor_mm', etiqueta: 'Espesor', tipo: 'num', unidad: 'mm', min: 0.2, paso: 0.01, visible: (v) => v.calibre === 'PROPIO' },
    { id: 'ref_diametro', etiqueta: 'Dimensión nominal', tipo: 'select', opciones: 'ref_diametro', defecto: 'INTERIOR', familias: ['RECTO', 'CODO', 'REDUCCION', 'TRANSICION', 'RAMAL', 'REDUCCION_INJERTO', 'PANTALON', 'PERSONALIZADO'] },
    { id: 'tipo_union', etiqueta: 'Unión', tipo: 'select', opciones: 'tipo_union', defecto: 'BRIDADO' },
    { id: 'clase_sellado', etiqueta: 'Sellado', tipo: 'select', opciones: 'clase_sellado', defecto: 'C' },
    { id: 'pintura', etiqueta: 'Pintura', tipo: 'select', opciones: 'pintura', defecto: '' },
    { id: 'servicio', etiqueta: 'Servicio', tipo: 'select', opciones: 'servicio', defecto: '' },
    { id: 'riesgo', etiqueta: 'Riesgo (imprevistos)', tipo: 'select', opciones: 'riesgo', defecto: '' },
  ];

  /** Campos avanzados. */
  W.CAMPOS_AVANZADOS = [
    { id: 'caras_pintadas', etiqueta: 'Caras pintadas', tipo: 'select', opciones: 'caras_pintadas', defecto: '1' },
    { id: 'proceso_corte', etiqueta: 'Proceso de corte', tipo: 'select', opciones: 'proceso_corte', defecto: '' },
    { id: 'perfil_id', etiqueta: 'Perfil de aros', tipo: 'select', opciones: 'perfiles', defecto: '' },
    { id: 'merma_pct', etiqueta: 'Merma (sustituye a la de maestros)', tipo: 'pct', opcional: true, unidad: '%', min: 0, max: 60, paso: 0.5 },
    { id: 'n_espigas', etiqueta: 'Extremos con espiga', tipo: 'int', opcional: true, min: 0, ayuda: 'Vacío = por familia', visible: (v) => v.tipo_union === 'ESPIGA' },
    { id: 'L_penetraciones_m', etiqueta: 'Penetraciones a sellar', tipo: 'num', unidad: 'm', opcional: true, min: 0, paso: 0.1, visible: (v) => v.clase_sellado === 'A' },
  ];

  /** Valores por defecto de una partida nueva. */
  W.partidaNueva = function partidaNueva(familia) {
    const p = { familia, cantidad: 1, descripcion: '' };
    if (familia !== 'COMPRADO') {
      Object.assign(p, { material_id: 'ACERO_CARBON', calibre: '16', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C' });
    }
    W.CAMPOS[familia].forEach((c) => { if (c.defecto !== undefined) p[c.id] = c.defecto; });
    return p;
  };

  /* ---------------- Unidades por eje: diámetros/secciones y longitudes ---------------- */
  Object.keys(W.CAMPOS).forEach((fam) => W.CAMPOS[fam].forEach((c) => {
    if (c.tipo === 'dim') c.eje = /^(L|H)/.test(c.id) ? 'long' : 'diam';
  }));

  const sinCeros = (x, d) => W.num(x, d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  /** Factor mm por unidad, según eje y unidad elegida. */
  W.factorUnidad = (u) => ({ in: W.MM_IN, mm: 1, m: 1000 }[u] || 1);
  W.sufijoUnidad = (u) => ({ in: '″', mm: 'mm', m: 'm' }[u] || 'mm');
  const fDiam = (mm, u) => (u === 'in' ? `${sinCeros(mm / W.MM_IN, 3)}″` : `${sinCeros(mm, 1)} mm`);
  const fLong = (mm, u) => (u === 'm' ? `${sinCeros(mm / 1000, 3)} m` : u === 'in' ? `${sinCeros(mm / W.MM_IN, 2)}″` : `${sinCeros(mm, 1)} mm`);
  W.fmtDiam = fDiam;
  W.fmtLong = fLong;

  /** Resumen legible de las dimensiones; u = { diam: 'in'|'mm', long: 'mm'|'m'|'in' }. */
  W.resumenDims = function resumenDims(p, u) {
    const d = (x) => `Ø${fDiam(x, u.diam)}`;
    const s = (x) => fDiam(x, u.diam);
    const l = (x) => fLong(x, u.long);
    switch (p.familia) {
      case 'RECTO':
        return `${p.forma === 'RECTANGULAR' ? `${s(p.a_mm)} × ${s(p.b_mm)}` : d(p.D_mm)} × ${l(p.L_mm)}`;
      case 'CODO':
        return `${p.theta_deg}° · ${p.n_gajos ? `${p.n_gajos} gajos` : 'gajos auto'} · ${p.forma === 'RECTANGULAR' ? `${s(p.a_mm)} × ${s(p.b_mm)}` : d(p.D_mm)} · R/D ${p.k_R}`;
      case 'REDUCCION':
        return `${d(p.D1_mm)} → ${d(p.D2_mm)}${p.excentrica === 'CARA_PLANA' ? ' · excéntrica' : ''}`;
      case 'TRANSICION':
        return `${d(p.D_mm)} → ${s(p.a_mm)} × ${s(p.b_mm)}`;
      case 'RAMAL':
        return `${d(p.D_mm)} + injerto ${d(p.d_mm)} a ${p.beta_deg}°`;
      case 'REDUCCION_INJERTO':
        return `${d(p.D1_mm)} → ${d(p.D2_mm)} + injerto ${d(p.d_mm)} a ${p.beta_deg}°`;
      case 'PANTALON':
        return `${d(p.D_mm)} → ${d(p.d1_mm)} + ${d(p.d2_mm)}`;
      case 'PERSONALIZADO':
        return `A = ${W.num(p.A_neta_m2, 2)} m²`;
      case 'COMPRADO':
        return `${W.mxn(p.precio_compra_unitario || 0)} de compra`;
      default:
        return '';
    }
  };
}(typeof self !== 'undefined' ? self : this));
