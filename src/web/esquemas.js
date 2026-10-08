/**
 * COTIZAP · web/esquemas.js — Definición declarativa de los formularios de partida.
 * Cada campo: { id, etiqueta, tipo, ... }.  tipos: dim (mm ⇄ in) · num · int · pct · select · text · calibre
 * `opcional` = vacío significa "automático" (el motor usa su valor por defecto).
 * `grupo` = el campo va en su propio cuadro (W.GRUPOS_CAMPOS: «Armado por yardas», «Viáticos»), no con las dimensiones.
 * `booleano` (en un select) = sus opciones son 'true' / 'false' y la partida guarda sí/no.
 * `eje` (en un dim) = 'long' o 'diam'; sin él se deduce del nombre (L…, H… son longitudes).
 */
(function (root) {
  'use strict';

  const W = root.COTIZAP.web;
  const VAL = root.COTIZAP.validacion;
  const redonda = (v) => (v.forma || 'REDONDA') === 'REDONDA';
  const rect = (v) => v.forma === 'RECTANGULAR';

  W.FAMILIAS = [
    ['RECTO', 'Tramo recto'],
    ['CODO', 'Codo'],
    ['REDUCCION', 'Reducción'],
    ['TRANSICION', 'Transición'],
    ['RAMAL', 'Injerto simple'],
    ['REDUCCION_INJERTO', 'Reducción con injerto'],
    ['BRIDA', 'Bridas sueltas'],
    ['UNION', 'Armado de piezas'],
    ['PERSONALIZADO', 'Personalizada'],
    ['SOPORTE', 'Soportería'],
    ['COMPRADO', 'Comprado'],
    ['INSTALACION', 'Instalación'],
  ];
  /** Familias que se fabrican de lámina (llevan material, calibre, unión, pintura…); las demás no. */
  W.esDeLamina = (fam) => VAL.esDeLamina(fam);
  /** Cuadros propios del formulario (los campos con `grupo`) y su título. */
  W.GRUPOS_CAMPOS = {
    armado: 'Armado por yardas',
    viaticos: 'Viáticos (capture los montos con IVA, como en el ticket)',
  };
  /** Título del cuadro principal de cada familia. */
  W.TITULO_CAMPOS = {
    COMPRADO: 'Artículo comprado', BRIDA: 'Ducto en que van las bridas', UNION: 'Unión entre dos piezas', SOPORTE: 'Pieza de soportería', INSTALACION: 'Cuadrilla en obra',
  };
  /** Cómo se llama la cantidad de cada familia. */
  W.ETIQUETA_CANTIDAD = { BRIDA: 'Bridas (aros)', UNION: 'Piezas armadas', SOPORTE: 'Piezas', INSTALACION: 'Veces (visitas iguales)' };
  /** Los extremos de cada pieza que pueden ir sin brida, como se le dicen en el taller (los nombres son los del motor). */
  W.EXTREMOS = {
    CODO: [['A', 'Un extremo'], ['B', 'El otro extremo']],
    REDUCCION: [['D1', 'El extremo mayor (D1)'], ['D2', 'El extremo menor (D2)']],
    TRANSICION: [['redondo', 'El extremo redondo'], ['rectangular', 'El extremo rectangular']],
    RAMAL: [['tronco_1', 'Un extremo del tronco'], ['tronco_2', 'El otro extremo del tronco'], ['injerto', 'El injerto']],
    REDUCCION_INJERTO: [['D1', 'El extremo mayor (D1)'], ['D2', 'El extremo menor (D2)'], ['injerto', 'El injerto']],
  };
  /** Familias que ya no se ofrecen para partidas nuevas, pero que se siguen calculando para abrir cotizaciones anteriores. */
  W.FAMILIAS_RETIRADAS = [['PANTALON', 'Pantalón (retirado)']];

  W.OPC = {
    forma: [['REDONDA', 'Redondo'], ['RECTANGULAR', 'Rectangular']],
    ref_diametro: [['INTERIOR', 'Interior (nominal)'], ['EXTERIOR', 'Exterior']],
    tipo_union: [['BRIDADO', 'Bridado · aros, tornillos y junta'], ['ESPIGA', 'Espiga · macho–hembra'], ['LISO', 'Extremos lisos']],
    clase_sellado: [['C', 'Clase C · juntas transversales'], ['B', 'Clase B · + costuras longitudinales'], ['A', 'Clase A · + penetraciones'], ['NINGUNA', 'Sin sellador']],
    // Pintura: en blanco manda la regla del taller (según el material y dónde va instalado el ducto); un sistema elegido vale para todo lo que se pinta
    pintura: [['', 'Según material e instalación'], ['NINGUNA', 'Sin pintura'], ['ESMALTE', 'Sólo pintura (esmalte)'], ['PRIMARIO', 'Sólo primario'], ['PRIMARIO_ESMALTE', 'Primario + pintura (esmalte)']],
    ubicacion: [['', 'Según la cotización'], ['INTERIOR', 'Interior (bajo techo)'], ['EXTERIOR', 'Exterior (a la intemperie)']],
    caras_pintadas: [['1', 'Sólo la cara exterior del ducto'], ['2', 'Caras exterior e interior del ducto']],
    servicio: [['', 'Según la cotización'], ['VENTILACION', 'Ventilación'], ['POLVO', 'Colección de polvo'], ['ABRASIVO', 'Material abrasivo']],
    riesgo: [['', 'Según la cotización'], ['BAJO', 'Bajo'], ['MEDIO', 'Medio'], ['ALTO', 'Alto']],
    proceso_corte: [['', 'Automático'], ['GUILLOTINA', 'Guillotina'], ['PLASMA', 'Plasma CNC'], ['LASER', 'Láser']],
    tipo_costura: [['', 'Según el material (galvanizado: engargolado)'], ['A_TOPE', 'Soldada a tope'], ['TRASLAPE', 'Soldada a traslape'], ['PITTSBURGH', 'Engargolado Pittsburgh']],
    excentrica: [['NO', 'Concéntrica'], ['CARA_PLANA', 'Excéntrica · cara plana']],
    // Extremo libre del tramo de ajuste (el de las tablas maestras se ofrece aparte, como «Predeterminado»)
    posicion: [['HORIZONTAL', 'Horizontal'], ['VERTICAL', 'Vertical (subida o bajada)']],
    cantidad_modo: [['AUTO', 'Automática: según el ducto de la cotización'], ['MANUAL', 'Manual: la que yo capture']],
    ajuste: [['SUELTA', 'Brida suelta (aro terminado, tornillos y junta)'], ['SIN_BRIDA', 'Sin brida (brida en un solo extremo)'], ['CON_BRIDA', 'Brida de taller (bridas en ambos extremos)']],
    bridas_aparte: [['', 'Se hacen en esta partida (aros, tornillos y junta)'], ['true', 'Son de otra partida (Bridas sueltas o compradas): aquí sólo se unen al ducto']],
    driver: [['PIEZA', 'Por pieza'], ['KG_NETO', 'Por kg neto'], ['KG_BRUTO', 'Por kg bruto'], ['M2_NETO', 'Por m² de lámina'], ['M_CORTE', 'Por m de corte'], ['M_SOLDADURA', 'Por m de soldadura']],
    iva_compra: [['', 'Automático: el del catálogo (un precio capturado, antes de IVA)'], ['true', 'Sí: el precio trae IVA (se le quita)'], ['false', 'No: el precio es antes de IVA']],
    factura: [['true', 'Con factura'], ['false', 'Sin factura']],
  };

  W.OPERACIONES = [
    ['corte', 'Corte'], ['rolado', 'Rolado'], ['armado', 'Armado'], ['aros', 'Aros de brida'], ['soldadura', 'Soldadura'],
    ['engargolado', 'Engargolado'], ['barrenado', 'Barrenado'], ['acabado', 'Acabado'], ['pintura', 'Pintura'], ['qc_embalaje', 'Inspección y embalaje'],
  ];
  /** Operaciones que no son del taller (no se pueden omitir ni subcontratar desde la partida), con su nombre. */
  W.OPERACIONES_EXTRA = [['instalacion', 'Instalación en obra']];

  /** Campos geométricos por familia. */
  W.CAMPOS = {
    RECTO: [
      { id: 'forma', etiqueta: 'Sección', tipo: 'select', opciones: 'forma', defecto: 'REDONDA' },
      { id: 'D_mm', etiqueta: 'Diámetro', tipo: 'dim', visible: redonda, defecto: 304.8 },
      { id: 'a_mm', etiqueta: 'Ancho a', tipo: 'dim', visible: rect, defecto: 500 },
      { id: 'b_mm', etiqueta: 'Alto b', tipo: 'dim', visible: rect, defecto: 300 },
      { id: 'L_mm', etiqueta: 'Longitud total', tipo: 'dim', defecto: 3000 },
      {
        id: 'posicion', etiqueta: 'Posición del tramo', tipo: 'select', opciones: 'posicion', defecto: 'HORIZONTAL',
        ayuda: 'Decide cada cuántos metros lleva un soporte (ménsulas automáticas): horizontal cada 2.5 m; vertical máximo cada 3.0 m y un soporte fuerte en la base',
      },
      { id: 'tipo_costura', etiqueta: 'Costura longitudinal', tipo: 'select', opciones: 'tipo_costura', defecto: '' },
      {
        id: 'yarda_mm', grupo: 'armado', etiqueta: 'Ancho de la yarda', tipo: 'select', opciones: 'yardas', numerico: true, sufijoFuera: ' mm',
        ayuda: 'La yarda es un anillo rolado del ancho de la lámina; se engargolan hasta 3 por pieza',
      },
      {
        id: 'extremo_ajuste', grupo: 'armado', etiqueta: 'Extremo final del tramo', tipo: 'select', opciones: 'ajuste',
        ayuda: 'Con tramo de ajuste (lo que sobra de yardas completas) es su extremo libre, para cortarlo y ponerlo en campo; sin ajuste lleva brida de taller salvo que pida otra cosa. «Sin brida» es la «brida en un extremo» de los planos: el otro va liso, para unirlo a otra pieza o a una manguera',
      },
    ],
    CODO: [
      { id: 'forma', etiqueta: 'Sección', tipo: 'select', opciones: 'forma', defecto: 'REDONDA' },
      { id: 'D_mm', etiqueta: 'Diámetro', tipo: 'dim', visible: redonda, defecto: 304.8 },
      { id: 'a_mm', etiqueta: 'Ancho a (en el plano del giro)', tipo: 'dim', visible: rect, defecto: 400 },
      { id: 'b_mm', etiqueta: 'Alto b', tipo: 'dim', visible: rect, defecto: 300 },
      { id: 'theta_deg', etiqueta: 'Ángulo del codo', tipo: 'select', opciones: 'angulos_codo', numerico: true, sufijoFuera: '° (no permitido)', defecto: 90 },
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
      { id: 'beta_deg', etiqueta: 'Ángulo del injerto', tipo: 'select', opciones: 'angulos_injerto', numerico: true, sufijoFuera: '° (no permitido)', defecto: 45 },
    ],
    REDUCCION_INJERTO: [ // el injerto va SOBRE EL CONO de la reducción
      { id: 'D1_mm', etiqueta: 'Diámetro mayor D1', tipo: 'dim', defecto: 304.8 },
      { id: 'D2_mm', etiqueta: 'Diámetro menor D2', tipo: 'dim', defecto: 254 },
      { id: 'd_mm', etiqueta: 'Diámetro del injerto', tipo: 'dim', defecto: 152.4 },
      { id: 'beta_deg', etiqueta: 'Ángulo del injerto', tipo: 'select', opciones: 'angulos_injerto', numerico: true, sufijoFuera: '° (no permitido)', defecto: 45 },
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
      { id: 'articulo_id', etiqueta: 'Artículo del catálogo', tipo: 'select', opciones: 'articulos', defecto: '' },
      {
        id: 'precio_compra_unitario', etiqueta: 'Costo de compra unitario', tipo: 'num', unidad: 'MXN', defecto: 1000, min: 0, paso: 1, opcional: true,
        ayuda: 'Con un artículo del catálogo, vacío = su precio',
      },
      { id: 'iva_incluido', etiqueta: 'El precio trae IVA', tipo: 'select', opciones: 'iva_compra', booleano: true, defecto: '' },
      { id: 'peso_kg', etiqueta: 'Peso unitario', tipo: 'num', unidad: 'kg', defecto: 0, min: 0, opcional: true },
      {
        id: 'tornillos_pieza', etiqueta: 'Juegos de tornillo por pieza', tipo: 'int', min: 0, paso: 1, opcional: true,
        ayuda: 'Si se atornilla como brida: la mitad de sus barrenos. Vacío = los del artículo',
      },
      {
        id: 'circulo_barrenos_mm', etiqueta: 'Círculo de barrenos', tipo: 'num', unidad: 'mm', min: 0, paso: 1, opcional: true,
        ayuda: 'Si se atornilla como brida: con él se calcula el Sikaflex de su junta. Vacío = el del artículo',
      },
    ],
    BRIDA: [ // aros terminados (rolados, cerrados, barrenados y pintados) que se mandan sueltos: la medida es la del ducto en que van
      { id: 'forma', etiqueta: 'Sección del ducto', tipo: 'select', opciones: 'forma', defecto: 'REDONDA' },
      { id: 'D_mm', etiqueta: 'Diámetro del ducto', tipo: 'dim', visible: redonda, defecto: 304.8, ayuda: 'La solera se corta de π × (D + 2 × su ancho) más las puntas que no se rolan' },
      { id: 'a_mm', etiqueta: 'Ancho a del ducto', tipo: 'dim', visible: rect, defecto: 500 },
      { id: 'b_mm', etiqueta: 'Alto b del ducto', tipo: 'dim', visible: rect, defecto: 300 },
    ],
    UNION: [ // la unión entre dos piezas de otras partidas (engargolada en galvanizado): «unir injerto de 11″ con codo de 60° para obtener 90°»
      { id: 'D_mm', etiqueta: 'Diámetro de la unión', tipo: 'dim', defecto: 279.4, ayuda: 'El de las bocas que se unen. Las piezas van en sus partidas, sin brida en esos extremos' },
      { id: 'n_uniones', etiqueta: 'Uniones por pieza', tipo: 'int', opcional: true, min: 1, paso: 1, ayuda: 'Vacío = 1. Un codo, un injerto y una yarda armados en una pieza son 2 uniones' },
    ],
    SOPORTE: [ // ménsulas, abrazaderas y postes cortados de una barra de la lista del proveedor
      {
        id: 'cantidad_modo', juntoCantidad: true, etiqueta: 'Cuántas piezas', tipo: 'select', opciones: 'cantidad_modo', defecto: 'AUTO',
        ayuda: 'Automática: una ménsula por tramo recto cada 2.5 m (vertical, cada 3.0 m) y una junto a cada codo e injerto; se recalcula al cambiar el ducto. Manual: la cantidad que usted capture (avisa si queda corta)',
      },
      {
        id: 'separacion_m', juntoCantidad: true, etiqueta: 'Separación entre soportes', tipo: 'num', unidad: 'm', opcional: true, min: 0.3, max: 3, paso: 0.1, visible: (v) => v.cantidad_modo !== 'MANUAL',
        ayuda: 'Sólo para los tramos horizontales. Vacío = la de las tablas maestras (2.5 m); 2.4 m pone una por junta de yarda. Máximo 3.0 m',
      },
      { id: 'barra_id', etiqueta: 'Barra de la que se cortan', tipo: 'select', opciones: 'barras', defecto: 'ANG_1_1_4X1_8' },
      {
        id: 'largo_pieza_mm', etiqueta: 'Largo de barra por pieza', tipo: 'dim', eje: 'long', defecto: 1300, opcional: true,
        ayuda: 'Lo que se corta de la barra para una pieza (una ménsula, una abrazadera, un poste). Vacío en una abrazadera = sale del diámetro',
      },
      {
        id: 'abrazadera_D_mm', etiqueta: 'Abrazadera: diámetro del ducto', tipo: 'dim', opcional: true,
        ayuda: 'Si la pieza es una abrazadera de media vuelta: su largo sale de π × (D + espesor) ÷ 2 más las dos orejas',
      },
      { id: 'anclajes_pieza', etiqueta: 'Anclajes por pieza', tipo: 'int', defecto: 0, min: 0, paso: 1 },
      { id: 'articulo_anclaje', etiqueta: 'Anclaje', tipo: 'select', opciones: 'anclajes', defecto: '', visible: (v) => Number(v.anclajes_pieza) > 0 },
      { id: 'tornillos_pieza', etiqueta: 'Tornillos por pieza', tipo: 'int', defecto: 0, min: 0, paso: 1 },
      {
        id: 'min_pieza', etiqueta: 'Minutos reales de taller por pieza', tipo: 'num', unidad: 'min', opcional: true, min: 0.1, paso: 'any',
        ayuda: 'Lo que de verdad tarda (corte, doblez, barreno y punteo), sin eficiencia. Vacío = el de las tablas maestras',
      },
    ],
    INSTALACION: [ // la cuadrilla en obra (horas reales a la tarifa de «instalación») y sus viáticos
      { id: 'personas', etiqueta: 'Personas en la cuadrilla', tipo: 'int', defecto: 2, min: 1, paso: 1 },
      { id: 'dias', etiqueta: 'Días en obra', tipo: 'num', unidad: 'días', defecto: 1, min: 0.1, paso: 0.5 },
      { id: 'horas_dia', etiqueta: 'Horas por día', tipo: 'num', unidad: 'h', opcional: true, min: 0.5, max: 24, paso: 0.5, ayuda: 'Vacío = la jornada de las tablas maestras' },
      { id: 'viajes', grupo: 'viaticos', etiqueta: 'Viajes redondos', tipo: 'int', defecto: 1, min: 0, paso: 1 },
      { id: 'casetas_viaje', grupo: 'viaticos', etiqueta: 'Casetas por viaje', tipo: 'num', unidad: 'MXN', defecto: 0, min: 0, paso: 1 },
      { id: 'gasolina_viaje', grupo: 'viaticos', etiqueta: 'Gasolina por viaje', tipo: 'num', unidad: 'MXN', defecto: 0, min: 0, paso: 1 },
      { id: 'noches', grupo: 'viaticos', etiqueta: 'Noches de hospedaje', tipo: 'int', defecto: 0, min: 0, paso: 1 },
      { id: 'hospedaje_noche', grupo: 'viaticos', etiqueta: 'Hospedaje por persona y noche', tipo: 'num', unidad: 'MXN', defecto: 0, min: 0, paso: 1, visible: (v) => Number(v.noches) > 0 },
      { id: 'comida_dia', grupo: 'viaticos', etiqueta: 'Comidas por persona y día', tipo: 'num', unidad: 'MXN', defecto: 0, min: 0, paso: 1 },
      { id: 'otros_gastos', grupo: 'viaticos', etiqueta: 'Otros gastos de obra', tipo: 'num', unidad: 'MXN', defecto: 0, min: 0, paso: 1, ayuda: 'Renta de andamio, maniobras, permisos…' },
      {
        id: 'gastos_con_factura', grupo: 'viaticos', etiqueta: 'Casetas, gasolina, hospedaje y otros', tipo: 'select', opciones: 'factura', booleano: true, defecto: true,
        ayuda: 'Con factura el IVA se acredita: se cuesta sin IVA',
      },
      { id: 'comidas_con_factura', grupo: 'viaticos', etiqueta: 'Comidas', tipo: 'select', opciones: 'factura', booleano: true, defecto: false, ayuda: 'Sin factura el IVA es costo' },
    ],
  };

  // Familias de lámina que forman un ducto (la de bridas sueltas sólo hace los aros: siempre bridada, sin lámina que cortar)
  const DUCTOS = ['RECTO', 'CODO', 'REDUCCION', 'TRANSICION', 'RAMAL', 'REDUCCION_INJERTO', 'PANTALON', 'PERSONALIZADO'];
  const CON_EXTREMOS = ['CODO', 'REDUCCION', 'TRANSICION', 'RAMAL', 'REDUCCION_INJERTO'];

  /** Campos de material y proceso (sólo las familias de lámina; `familias` = las únicas en que aparece el campo). */
  W.CAMPOS_MATERIAL = [
    { id: 'material_id', etiqueta: 'Material', tipo: 'select', opciones: 'materiales' },
    { id: 'calibre', etiqueta: 'Calibre', tipo: 'calibre' },
    { id: 'espesor_mm', etiqueta: 'Espesor', tipo: 'num', unidad: 'mm', min: 0.2, paso: 0.01, visible: (v) => v.calibre === 'PROPIO' },
    { id: 'ref_diametro', etiqueta: 'Dimensión nominal', tipo: 'select', opciones: 'ref_diametro', defecto: 'INTERIOR', familias: [...DUCTOS, 'BRIDA'] },
    { id: 'tipo_union', etiqueta: 'Unión', tipo: 'select', opciones: 'tipo_union', defecto: 'BRIDADO', familias: DUCTOS },
    {
      id: 'bridas_aparte', etiqueta: 'Las bridas', tipo: 'select', opciones: 'bridas_aparte', booleano: true, defecto: '', familias: DUCTOS, visible: (v) => (v.tipo_union || 'BRIDADO') === 'BRIDADO',
      ayuda: 'Si los aros los hace el taller en una partida de Bridas sueltas (o son bridas de placa compradas), aquí sólo se cotiza armarlos y soldarlos al ducto; la pestaña Planos cuadra cuántas se necesitan',
    },
    {
      id: 'extremos_sin_brida', etiqueta: 'Extremos sin brida', tipo: 'marcas', opciones: 'extremos', familias: CON_EXTREMOS, visible: (v) => v.tipo_union !== 'LISO',
      ayuda: 'Los que se unen a otra pieza (armado de piezas) o a una manguera: no llevan brida',
    },
    { id: 'clase_sellado', etiqueta: 'Sellado', tipo: 'select', opciones: 'clase_sellado', defecto: 'C', familias: [...DUCTOS, 'BRIDA'] },
    { id: 'ubicacion', etiqueta: 'Instalación', tipo: 'select', opciones: 'ubicacion', defecto: '' },
    {
      id: 'pintura', etiqueta: 'Pintura', tipo: 'select', opciones: 'pintura', defecto: '',
      ayuda: 'En blanco manda la regla del taller: acero al carbón, interior sólo pintura y exterior primario y pintura; galvanizado, sólo las bridas',
    },
    { id: 'servicio', etiqueta: 'Servicio', tipo: 'select', opciones: 'servicio', defecto: '' },
    { id: 'riesgo', etiqueta: 'Riesgo (imprevistos)', tipo: 'select', opciones: 'riesgo', defecto: '' },
  ];

  /** Campos avanzados (de las familias de lámina). */
  W.CAMPOS_AVANZADOS = [
    { id: 'caras_pintadas', etiqueta: 'Caras pintadas', tipo: 'select', opciones: 'caras_pintadas', defecto: '1', familias: DUCTOS },
    { id: 'proceso_corte', etiqueta: 'Proceso de corte', tipo: 'select', opciones: 'proceso_corte', defecto: '', familias: DUCTOS },
    { id: 'perfil_id', etiqueta: 'Perfil de aros', tipo: 'select', opciones: 'perfiles', defecto: '', familias: [...DUCTOS, 'BRIDA'] },
    { id: 'merma_pct', etiqueta: 'Merma (sustituye a la de maestros)', tipo: 'pct', opcional: true, unidad: '%', min: 0, max: 60, paso: 0.5, familias: DUCTOS },
    { id: 'n_espigas', etiqueta: 'Extremos con espiga', tipo: 'int', opcional: true, min: 0, ayuda: 'Vacío = por familia', visible: (v) => v.tipo_union === 'ESPIGA' },
    { id: 'L_penetraciones_m', etiqueta: 'Penetraciones a sellar', tipo: 'num', unidad: 'm', opcional: true, min: 0, paso: 0.1, visible: (v) => v.clase_sellado === 'A' },
  ];

  /** Valores por defecto de una partida nueva. */
  W.partidaNueva = function partidaNueva(familia) {
    const p = { familia, cantidad: 1, descripcion: '' };
    if (W.esDeLamina(familia)) {
      Object.assign(p, { material_id: 'ACERO_CARBON', calibre: '16', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C' });
    }
    if (familia === 'UNION') p.tipo_union = 'LISO'; // la unión no lleva bridas: las piezas que une están en sus partidas
    W.CAMPOS[familia].forEach((c) => { if (c.defecto !== undefined) p[c.id] = c.defecto; });
    return p;
  };

  /**
   * Parámetros de precio del encabezado de la cotización: cada uno anula el valor de las tablas maestras sólo para esa
   * cotización (así no hay que ir a los maestros para ajustar el margen o los días de cobro). Los límites salen del
   * motor (PARAMETROS_COTIZACION) para que interfaz y motor coincidan; en pantalla los porcentajes van en %.
   * grupo: 'principal' (siempre visible) o 'mas' (dentro de «Más parámetros de precio»).
   */
  (function definirParametros() {
    const LIM = root.COTIZAP.cotizador.PARAMETROS_COTIZACION;
    const par = (clave, extra) => {
      const l = LIM[clave];
      const pct = !l.entero;
      const aPantalla = (x) => (pct ? Number((x * 100).toFixed(6)) : x);
      return { clave, pct, entero: !!l.entero, min: aPantalla(l.min), max: aPantalla(l.max), sufijo: pct ? '%' : 'días', ...extra };
    };
    W.PARAMETROS_COT = [
      par('utilidad_pct_precio', { id: 'utilidad', etiqueta: 'Margen de utilidad', base: 'Del precio', paso: 0.5, grupo: 'principal' }),
      par('comision_ventas_pct_precio', { id: 'comision', etiqueta: 'Comisión de ventas', base: 'Del precio', paso: 0.5, grupo: 'principal' }),
      par('descuento_pct', { id: 'descuento', etiqueta: 'Descuento al cliente', base: 'Del subtotal', paso: 0.5, grupo: 'principal' }),
      par('dias_cobro', { id: 'dias_cobro', etiqueta: 'Días de cobro', base: 'Crédito al cliente', paso: 1, grupo: 'principal' }),
      par('administracion_pct_cd', { id: 'administracion', etiqueta: 'Administración', base: 'Del costo directo', paso: 0.5, grupo: 'mas' }),
      par('tasa_anual', { id: 'tasa', etiqueta: 'Financiamiento anual', base: 'Costo del dinero', paso: 0.5, grupo: 'mas' }),
      par('iva_pct', { id: 'iva', etiqueta: 'IVA', base: 'Sobre el precio neto', paso: 1, grupo: 'mas' }),
    ];
  }());

  /* ---------------- Unidades por eje: diámetros/secciones y longitudes ---------------- */
  Object.keys(W.CAMPOS).forEach((fam) => W.CAMPOS[fam].forEach((c) => {
    if (c.tipo === 'dim' && !c.eje) c.eje = /^(L|H)/.test(c.id) ? 'long' : 'diam';
  }));

  const sinCeros = (x, d) => W.num(x, d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  /** Factor mm por unidad, según eje y unidad elegida. */
  W.factorUnidad = (u) => ({ in: W.MM_IN, mm: 1, m: 1000 }[u] || 1);
  W.sufijoUnidad = (u) => ({ in: '″', mm: 'mm', m: 'm' }[u] || 'mm');
  const fDiam = (mm, u) => (u === 'in' ? `${sinCeros(mm / W.MM_IN, 3)}″` : `${sinCeros(mm, 1)} mm`);
  const fLong = (mm, u) => (u === 'm' ? `${sinCeros(mm / 1000, 3)} m` : u === 'in' ? `${sinCeros(mm / W.MM_IN, 2)}″` : `${sinCeros(mm, 1)} mm`);
  W.fmtDiam = fDiam;
  W.fmtLong = fLong;

  const plural = (n, uno, varios) => `${W.num(n, Number.isInteger(Number(n)) ? 0 : 1)} ${Number(n) === 1 ? uno : varios}`;

  /**
   * Resumen legible de las dimensiones; u = { diam: 'in'|'mm', long: 'mm'|'m'|'in' }. `M` (las tablas maestras) da el nombre
   * de la barra de la soportería y del artículo del catálogo; sin él se muestra su clave.
   */
  W.resumenDims = function resumenDims(p, u, M) {
    const d = (x) => `Ø${fDiam(x, u.diam)}`;
    const s = (x) => fDiam(x, u.diam);
    const l = (x) => fLong(x, u.long);
    const de = (tabla, id) => (M && tabla(M) && tabla(M)[id] && tabla(M)[id].descripcion) || id;
    return `${dimensiones()}${uniones()}`;
    // lo que dicen los planos de las bridas: extremos sin brida y bridas de otra partida
    function uniones() {
      if (!W.esDeLamina(p.familia) || p.tipo_union === 'LISO' || p.familia === 'BRIDA' || p.familia === 'UNION') return '';
      const sin = Array.isArray(p.extremos_sin_brida) ? p.extremos_sin_brida.length : 0;
      const ext = p.familia === 'RECTO' && p.extremo_ajuste === 'SIN_BRIDA' ? ' · brida en un extremo' : sin ? ` · ${plural(sin, 'extremo', 'extremos')} sin brida` : '';
      return `${ext}${p.bridas_aparte === true && (p.tipo_union || 'BRIDADO') === 'BRIDADO' ? ' · bridas de otra partida' : ''}`;
    }
    function dimensiones() {
    switch (p.familia) {
      case 'RECTO':
        return `${p.forma === 'RECTANGULAR' ? `${s(p.a_mm)} × ${s(p.b_mm)}` : d(p.D_mm)} × ${l(p.L_mm)}${p.posicion === 'VERTICAL' ? ' · vertical' : ''}`;
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
      case 'COMPRADO': {
        const art = p.articulo_id && M && M.compras.articulos[p.articulo_id];
        const precio = p.precio_compra_unitario !== undefined && p.precio_compra_unitario !== '' ? Number(p.precio_compra_unitario) : (art ? art.precio : 0);
        const iva = p.iva_incluido !== undefined && p.iva_incluido !== '' ? p.iva_incluido === true || p.iva_incluido === 'true' : !!(art && p.precio_compra_unitario === undefined && art.iva_incluido);
        const juegos = p.tornillos_pieza !== undefined && p.tornillos_pieza !== '' ? Number(p.tornillos_pieza) : (art && art.tornillos_pieza) || 0;
        return `${W.mxn(precio || 0)} de compra${iva ? ' con IVA' : ''}${art ? ` por ${art.unidad}` : ''}${juegos > 0 ? ` · ${plural(juegos, 'juego', 'juegos')} de tornillo` : ''}`;
      }
      case 'BRIDA':
        return p.forma === 'RECTANGULAR' ? `marco para ducto ${s(p.a_mm)} × ${s(p.b_mm)}` : `aro para ducto ${d(p.D_mm)}`;
      case 'UNION': { // engargolada si la costura del material no se suelda (galvanizado), soldada en los demás
        const mat = M && M.materiales && M.materiales[p.material_id];
        const costura = mat && M.proceso && M.proceso.costuras ? M.proceso.costuras[mat.costura] : null;
        return `unión ${costura && costura.soldada === false ? 'engargolada' : 'soldada'} ${d(p.D_mm)}${Number(p.n_uniones) > 1 ? ` · ${plural(p.n_uniones, 'unión', 'uniones')} por pieza` : ''}`;
      }
      case 'SOPORTE': {
        const largo = p.largo_pieza_mm !== undefined && p.largo_pieza_mm !== '' ? `${l(p.largo_pieza_mm)} por pieza`
          : Number(p.abrazadera_D_mm) > 0 ? `abrazadera para ducto ${d(p.abrazadera_D_mm)}` : 'sin largo';
        return `${de((m) => m.proveedor.barras, p.barra_id)} · ${largo}${Number(p.anclajes_pieza) > 0 ? ` · ${plural(p.anclajes_pieza, 'anclaje', 'anclajes')}` : ''}${p.cantidad_modo === 'AUTO' ? ' · cantidad automática' : ''}`;
      }
      case 'INSTALACION':
        return `${plural(p.personas, 'persona', 'personas')} × ${plural(p.dias, 'día', 'días')}${Number(p.viajes) > 0 ? ` · ${plural(p.viajes, 'viaje', 'viajes')}` : ''}`;
      default:
        return '';
    }
    }
  };
}(typeof self !== 'undefined' ? self : this));
