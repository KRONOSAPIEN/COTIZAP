/**
 * COTIZAP · maestros.js — Bases de datos maestras (valores de arranque).
 *
 * ⚠ SON REALES la mano de obra ($500 por hora) y la lámina y los perfiles de la lista del proveedor
 *   (cotizaciones y factura del 30-sep-2026). TODO LO DEMÁS (consumibles, equipo, tiempos, indirectos,
 *   utilidad) es ILUSTRATIVO: existe para que el motor funcione de inmediato y para servir de vector
 *   de prueba. Antes de cotizar a un cliente debe sustituirse por:
 *     · precios vigentes de gas, alambre, pintura y tornillería,
 *     · tarifas reales de hora-máquina,
 *     · estudios de tiempos del taller (velocidades de corte, rolado, soldadura).
 *   Las fórmulas del motor NUNCA contienen precios: sólo leen `precios[<variable>]` y `proveedor`.
 *
 * Unidades internas: mm, m², kg, min, MXN. Los calibres se guardan en pulgadas
 * (como los publican las normas) y el motor los convierte a mm.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../motor/util'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.maestros = factory(root.COTIZAP.util);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const base = {
    meta: {
      version: '1.2.0',
      moneda: 'MXN',
      aviso: 'Mano de obra y lámina/perfiles del proveedor son reales; el resto son valores ilustrativos. Revisar antes de cotizar.',
    },

    /* ------------------------------------------------------------------ */
    /* PRECIOS — variables referenciales (MXN por unidad, SIN IVA)        */
    /* Los precios por kg de lámina y de perfil sólo se usan para lo que  */
    /* no esté en la lista del proveedor (calibre o perfil sin cotizar);  */
    /* salen de esa lista: lámina negra cal. 12, promedio de galvanizado  */
    /* cal. 22 y 24, promedio de ángulos y solera 1½" × 3/16".            */
    /* ------------------------------------------------------------------ */
    precios: {
      precio_kg_acero_carbon: 22.47,
      precio_kg_acero_galvanizado: 30.69,
      precio_kg_inox_304: 98.0,
      precio_kg_inox_316: 135.0,
      precio_kg_chatarra_acero: 7.0,
      precio_kg_chatarra_inox: 45.0,
      precio_kg_perfil_angulo: 24.83,
      precio_kg_solera: 24.8,
      precio_kg_alambre_er70s6: 62.0,
      precio_kg_varilla_er308l: 420.0,
      precio_kg_varilla_er316l: 520.0,
      precio_m3_gas_mezcla_ar_co2: 145.0,
      precio_m3_gas_argon: 190.0,
      precio_m_corte_guillotina: 0.3,
      precio_m_corte_plasma: 3.5,
      precio_m_corte_laser: 2.0,
      precio_m_empaque_neopreno: 28.0, // cinta de neopreno 1½" × 1/8" (38 × 3 mm) para la cara de la brida
      precio_cartucho_sellador_300ml: 120.0,
      precio_pza_autotaladrante: 0.85,
      precio_juego_tornillo_5_16_x_1_1_4: 4.5, // tornillo 5/16" × 1¼" + tuerca + 2 rondanas planas
      precio_juego_tornillo_m8: 5.0,
      precio_juego_tornillo_m10: 6.5,
      precio_juego_tornillo_m12: 9.5,
      precio_L_primario: 220.0,
      precio_L_esmalte: 260.0,
      precio_L_diluyente: 70.0,
    },

    /* ------------------------------------------------------------------ */
    /* LISTA DE PRECIOS DEL PROVEEDOR DE ACERO (30-sep-2026)              */
    /* Cotizaciones y factura: el proveedor cotiza por PIEZA y con IVA    */
    /* incluido (su factura desglosa el IVA de precios redondos). El      */
    /* motor los convierte a $/kg sin IVA (motor/proveedor.js). Las hojas */
    /* con calibre y las barras con perfil alimentan el cálculo; el resto */
    /* es referencia. Un renglón nuevo es un id nuevo con los mismos      */
    /* campos.                                                            */
    /* ------------------------------------------------------------------ */
    proveedor: {
      fecha: '2026-09-30',
      iva_incluido_pct: 0.16, // IVA que ya traen los precios capturados (0 si se capturan antes de IVA)
      hojas: {
        GALV_C22_4X10: { descripcion: 'Lámina galvanizada 4 × 10 ft · cal. 22', material: 'GALVANIZADO', calibre: 22, esp_mm: 0, ancho_mm: 1219, largo_mm: 3048, precio: 920 },
        GALV_C24_4X10: { descripcion: 'Lámina galvanizada 4 × 10 ft · cal. 24', material: 'GALVANIZADO', calibre: 24, esp_mm: 0, ancho_mm: 1219, largo_mm: 3048, precio: 700 },
        NEGRA_C12_4X10: { descripcion: 'Lámina negra 4 × 10 ft · cal. 12', material: 'ACERO_CARBON', calibre: 12, esp_mm: 0, ancho_mm: 1219, largo_mm: 3048, precio: 2020 },
        NEGRA_C12_4X8: { descripcion: 'Lámina negra 4 × 8 ft · cal. 12', material: 'ACERO_CARBON', calibre: 12, esp_mm: 0, ancho_mm: 1219, largo_mm: 2438, precio: 1620 },
        NEGRA_C12_3X10: { descripcion: 'Lámina negra 3 × 10 ft · cal. 12', material: 'ACERO_CARBON', calibre: 12, esp_mm: 0, ancho_mm: 914, largo_mm: 3048, precio: 1515 },
        NEGRA_C12_3X8: { descripcion: 'Lámina negra 3 × 8 ft · cal. 12', material: 'ACERO_CARBON', calibre: 12, esp_mm: 0, ancho_mm: 914, largo_mm: 2438, precio: 1210 },
        PLACA_3_16_4X8: { descripcion: 'Placa lisa 4 × 8 ft · 3/16"', material: 'ACERO_CARBON', calibre: 0, esp_mm: 4.7625, ancho_mm: 1219, largo_mm: 2438, precio: 2820 },
        PLACA_3_16_3X8: { descripcion: 'Placa lisa 3 × 8 ft · 3/16" (precio como viene en la factura)', material: 'ACERO_CARBON', calibre: 0, esp_mm: 4.7625, ancho_mm: 914, largo_mm: 2438, precio: 2820 },
      },
      barras: {
        SOL_1_1_2X3_16: { descripcion: 'Solera 1½" × 3/16" (brida estándar)', perfil: 'SOL38x4.8', largo_mm: 6100, precio: 250 },
        ANG_1_1_2X3_16: { descripcion: 'Ángulo 1½" × 3/16"', perfil: 'L38x4.8', largo_mm: 6100, precio: 470 },
        ANG_2X3_16: { descripcion: 'Ángulo 2" × 3/16"', perfil: 'L51x4.8', largo_mm: 6100, precio: 616 },
        ANG_1_1_4X1_8: { descripcion: 'Ángulo 1¼" × 1/8"', tipo: 'ANGULO', ancho_mm: 31.75, esp_mm: 3.175, largo_mm: 6100, precio: 260 },
        ANG_3_4X1_8: { descripcion: 'Ángulo ¾" × 1/8"', tipo: 'ANGULO', ancho_mm: 19.05, esp_mm: 3.175, largo_mm: 6100, precio: 160 },
        SOL_1_1_4X1_8: { descripcion: 'Solera 1¼" × 1/8"', tipo: 'SOLERA', ancho_mm: 31.75, esp_mm: 3.175, largo_mm: 6100, precio: 150 },
        CANAL_U_6: { descripcion: 'Canal U 6" × 6 m (12.2 kg/m)', kg_m: 12.2, largo_mm: 6000, precio: 2177.18 },
      },
    },

    /* ------------------------------------------------------------------ */
    /* MATERIALES DE LÁMINA                                               */
    /* ------------------------------------------------------------------ */
    materiales: {
      ACERO_CARBON: {
        nombre: 'Acero al carbón (lámina negra)',
        norma: 'ASTM A1011 / A1008 (referencial)',
        tabla_calibre: 'MSG',
        densidad_kg_m3: 7850,
        precio_ref: 'precio_kg_acero_carbon',
        chatarra_ref: 'precio_kg_chatarra_acero',
        proceso_sold: 'GMAW',
        alambre_ref: 'precio_kg_alambre_er70s6',
        gas_ref: 'precio_m3_gas_mezcla_ar_co2',
        f_sold: 1.0,
        f_acabado: 0.25,
        pintura_defecto: 'PRIMARIO',
      },
      GALVANIZADO: {
        nombre: 'Acero galvanizado (G90)',
        norma: 'ASTM A653 (referencial)',
        tabla_calibre: 'GSG',
        densidad_kg_m3: 7850,
        precio_ref: 'precio_kg_acero_galvanizado',
        chatarra_ref: 'precio_kg_chatarra_acero',
        proceso_sold: 'GMAW',
        alambre_ref: 'precio_kg_alambre_er70s6',
        gas_ref: 'precio_m3_gas_mezcla_ar_co2',
        f_sold: 1.2,
        f_acabado: 0.35,
        pintura_defecto: 'NINGUNA',
      },
      INOX_304: {
        nombre: 'Acero inoxidable 304/304L',
        norma: 'ASTM A240 (referencial)',
        tabla_calibre: 'USSG',
        densidad_kg_m3: 7930,
        precio_ref: 'precio_kg_inox_304',
        chatarra_ref: 'precio_kg_chatarra_inox',
        proceso_sold: 'GTAW',
        alambre_ref: 'precio_kg_varilla_er308l',
        gas_ref: 'precio_m3_gas_argon',
        f_sold: 1.0,
        f_acabado: 0.6,
        pintura_defecto: 'NINGUNA',
      },
      INOX_316: {
        nombre: 'Acero inoxidable 316/316L',
        norma: 'ASTM A240 (referencial)',
        tabla_calibre: 'USSG',
        densidad_kg_m3: 7980,
        precio_ref: 'precio_kg_inox_316',
        chatarra_ref: 'precio_kg_chatarra_inox',
        proceso_sold: 'GTAW',
        alambre_ref: 'precio_kg_varilla_er316l',
        gas_ref: 'precio_m3_gas_argon',
        f_sold: 1.0,
        f_acabado: 0.6,
        pintura_defecto: 'NINGUNA',
      },
    },

    /* Espesor nominal por calibre, en PULGADAS. Cada familia de calibre tiene su tabla:
       MSG = Manufacturers' Standard Gauge (acero al carbón/negro),
       GSG = Galvanized Sheet Gauge, USSG = US Standard Gauge (inoxidable, referencial).
       Verificar contra el certificado del proveedor: usar la tabla equivocada en 16 ga
       produce ~6 % de error de peso (0.0598 in vs 0.0635 in). */
    calibres: {
      MSG: { 10: 0.1345, 12: 0.1046, 14: 0.0747, 16: 0.0598, 18: 0.0478, 20: 0.0359, 22: 0.0299, 24: 0.0239, 26: 0.0179, 28: 0.0149 },
      GSG: { 10: 0.1382, 12: 0.1084, 14: 0.0785, 16: 0.0635, 18: 0.0516, 20: 0.0396, 22: 0.0336, 24: 0.0276, 26: 0.0217, 28: 0.0187 },
      USSG: { 10: 0.1406, 12: 0.1094, 14: 0.0781, 16: 0.0625, 18: 0.05, 20: 0.0375, 22: 0.0313, 24: 0.025, 26: 0.0188, 28: 0.0156 },
    },

    /* Calibre más delgado permitido (mayor número de calibre) por diámetro y servicio.
       ILUSTRATIVO — NO NORMATIVO: poblar con la norma interna / SMACNA / ACGIH aplicable. */
    servicios: {
      VENTILACION: [
        { hasta_mm: 300, calibre_max: 24 }, { hasta_mm: 600, calibre_max: 22 }, { hasta_mm: 900, calibre_max: 20 },
        { hasta_mm: 1200, calibre_max: 18 }, { hasta_mm: 99999, calibre_max: 16 },
      ],
      POLVO: [
        { hasta_mm: 200, calibre_max: 20 }, { hasta_mm: 400, calibre_max: 18 }, { hasta_mm: 600, calibre_max: 16 },
        { hasta_mm: 900, calibre_max: 14 }, { hasta_mm: 99999, calibre_max: 12 },
      ],
      ABRASIVO: [
        { hasta_mm: 200, calibre_max: 16 }, { hasta_mm: 400, calibre_max: 14 }, { hasta_mm: 600, calibre_max: 12 },
        { hasta_mm: 900, calibre_max: 10 }, { hasta_mm: 99999, calibre_max: 10 },
      ],
    },

    /* Merma (scrap) = fracción del material COMPRADO que no queda en la pieza.
       m_bruta = m_neta / (1 − φ). Incluye retazos, recortes de ingletes, caídas de orificios y kerf. */
    merma: {
      RECTO: 0.08,
      CODO: 0.2,
      REDUCCION: 0.18,
      TRANSICION: 0.22,
      RAMAL: 0.25, // injerto simple
      REDUCCION_INJERTO: 0.28,
      PANTALON: 0.28, // familia retirada: sólo para abrir cotizaciones anteriores
      PERSONALIZADO: 0.15,
      PERFIL: 0.05,
    },

    /* ------------------------------------------------------------------ */
    /* PROCESO DE FABRICACIÓN                                             */
    /* ------------------------------------------------------------------ */
    proceso: {
      eficiencia_taller: 0.8,
      hoja: { ancho_mm: 1219, largo_mm: 3048 },
      L_max_pieza_mm: 3000,
      semiangulo_max_deg: 15,
      alfa_max_junta_deg: 22.5,
      k_R_defecto: 1.5,
      beta_ramal_defecto_deg: 45,
      // Ángulos que maneja el taller (el cotizador rechaza cualquier otro):
      angulos_injerto_deg: [30, 45], // TODO injerto, simple o en la reducción
      angulos_codo_deg: [30, 45, 60, 90],
      injerto_largo_extra_mm: 150, // tramo recto del injerto más allá de su generatriz más larga, si no se captura su largo
      injerto_margen_cono_mm: 25, // holgura entre la silleta del injerto y cada extremo del cono (reducción con injerto)
      injerto_inclinado_hacia: 'MENOR', // el injerto de la reducción siempre va de extremo mayor a menor: se inclina hacia D2 ('MAYOR' lo inclinaría hacia D1)
      k_entrepierna: 0.08, // pantalón (retirado)
      tolerancia_area_pantalon: 0.15, // pantalón (retirado)

      costuras: {
        A_TOPE: { nombre: 'Soldada a tope', allowance_mm: 1.0, soldada: true, cordon: 'TOPE' },
        TRASLAPE: { nombre: 'Soldada a traslape', allowance_mm: 25.0, soldada: true, cordon: 'FILETE' },
        PITTSBURGH: { nombre: 'Engargolado Pittsburgh', allowance_mm: 32.0, soldada: false, cordon: null },
      },

      corte: {
        t_manejo_hoja_min: 4.0,
        t_prog_cnc_min: 6.0,
        proceso_recto: 'GUILLOTINA',
        proceso_perfilado: 'PLASMA',
        v_m_min: {
          GUILLOTINA: [[0.5, 9], [1.5, 8], [3.0, 6], [6.0, 3.5]],
          PLASMA: [[0.8, 6.0], [1.5, 4.5], [3.0, 3.0], [6.0, 1.8]],
          LASER: [[0.8, 14.0], [1.5, 9.5], [3.0, 5.0], [6.0, 2.4]],
        },
        consumible_ref: {
          GUILLOTINA: 'precio_m_corte_guillotina',
          PLASMA: 'precio_m_corte_plasma',
          LASER: 'precio_m_corte_laser',
        },
      },

      rolado: {
        t_fijo_min: 3.0,
        n_pasadas: 3,
        n_pasadas_plegado: 4,
        k_conico: 1.6,
        v_m_min: [[0.6, 8], [1.0, 7], [1.5, 6], [2.0, 5], [3.0, 3.5], [4.5, 2.5]],
      },

      armado: {
        t_fijo_pieza_min: 6.0,
        t_junta_base_min: 3.0,
        t_junta_por_m_min: 6.0,
        t_ajuste_aro_min: 4.0,
        t_fijacion_min: 0.4,
        t_formado_espiga_min: 3.0,
        k_dif: { RECTO: 1.0, CODO: 1.35, REDUCCION: 1.2, TRANSICION: 1.5, RAMAL: 1.6, REDUCCION_INJERTO: 1.9, PANTALON: 1.9, PERSONALIZADO: 1.0 },
      },

      aros: { t_fijo_aro_min: 4.0, t_roll_aro_min_m: 2.5, holgura_corte_mm: 3.0 },
      barrenado: { t_barreno_min: 0.35 },
      engargolado: { t_fijo_pieza_min: 2.0, v_m_min: [[0.5, 3.0], [1.0, 2.5], [1.5, 1.8], [2.0, 1.2]] },

      soldadura: {
        procesos: {
          GMAW: { v_mult: 1.0, FO: 0.4, Q_gas_L_min: 15, eta_dep: 0.93, f_pre_post: 0.1 },
          GTAW: { v_mult: 0.5, FO: 0.35, Q_gas_L_min: 9, eta_dep: 0.98, f_pre_post: 0.15 },
        },
        v_m_min: [[0.6, 0.9], [1.0, 0.7], [1.5, 0.5], [2.0, 0.42], [3.0, 0.32], [4.5, 0.24]],
        k_cordon: { TOPE: 1.75, FILETE: 1.0 },
        A_cordon_min_mm2: 2.0,
        rho_dep_g_cm3: 7.85,
      },

      pintura: {
        t_prep_min_m2: 4.0,
        t_aplic_min_m2: 3.0,
        sistemas: { NINGUNA: [], PRIMARIO: ['primario'], PRIMARIO_ESMALTE: ['primario', 'esmalte'] },
        capas: {
          primario: { sv_pct: 55, dft_um: 50, eta_transf: 0.65, precio_ref: 'precio_L_primario' },
          esmalte: { sv_pct: 45, dft_um: 40, eta_transf: 0.65, precio_ref: 'precio_L_esmalte' },
        },
        f_diluyente: 0.1,
        diluyente_precio_ref: 'precio_L_diluyente',
      },

      qc: { t_fijo_min: 3.0, k_manejo_min_kg: 0.05 },
    },

    /* ------------------------------------------------------------------ */
    /* HERRAJES DE UNIÓN                                                  */
    /* ------------------------------------------------------------------ */
    herrajes: {
      /* Perfiles para aros de brida (el aro se rola "de canto": el ancho queda en el plano radial).
         ESTÁNDAR DEL TALLER: solera de 1½" × 3/16", barreno de 3/8", tornillo de 5/16" × 1¼", para todos los diámetros.
         tipo SOLERA = barra plana (barreno al centro: gramil = ancho/2); tipo ANGULO = ala radial de un ángulo.
         Peso lineal, área y centroide se derivan de (tipo, ancho, espesor); no se capturan.
         `tornillo` apunta a `tornillo_precio_ref`; `precio_ref` al precio por kg del perfil. */
      perfiles: {
        'SOL38x4.8': {
          tipo: 'SOLERA', descripcion: 'Solera 1½" × 3/16"', ancho_mm: 38.1, esp_mm: 4.763, gramil_mm: 19.05,
          tornillo: '5/16x1-1/4', tornillo_desc: '5/16" × 1¼"', diam_barreno_mm: 9.525, barreno_desc: '3/8"', precio_ref: 'precio_kg_solera',
        },
        'L25x3.2': {
          tipo: 'ANGULO', descripcion: 'Ángulo 1" × 1" × 1/8"', ancho_mm: 25.4, esp_mm: 3.175, gramil_mm: 14.0,
          tornillo: 'M8', tornillo_desc: 'M8', diam_barreno_mm: 9.0, precio_ref: 'precio_kg_perfil_angulo',
        },
        'L38x3.2': {
          tipo: 'ANGULO', descripcion: 'Ángulo 1½" × 1½" × 1/8"', ancho_mm: 38.1, esp_mm: 3.175, gramil_mm: 22.0,
          tornillo: 'M10', tornillo_desc: 'M10', diam_barreno_mm: 11.0, precio_ref: 'precio_kg_perfil_angulo',
        },
        'L38x4.8': {
          tipo: 'ANGULO', descripcion: 'Ángulo 1½" × 1½" × 3/16"', ancho_mm: 38.1, esp_mm: 4.763, gramil_mm: 22.0,
          tornillo: 'M10', tornillo_desc: 'M10', diam_barreno_mm: 11.0, precio_ref: 'precio_kg_perfil_angulo',
        },
        'L51x4.8': {
          tipo: 'ANGULO', descripcion: 'Ángulo 2" × 2" × 3/16"', ancho_mm: 50.8, esp_mm: 4.763, gramil_mm: 29.0,
          tornillo: 'M10', tornillo_desc: 'M10', diam_barreno_mm: 11.0, precio_ref: 'precio_kg_perfil_angulo',
        },
        'L64x6.4': {
          tipo: 'ANGULO', descripcion: 'Ángulo 2½" × 2½" × 1/4"', ancho_mm: 63.5, esp_mm: 6.35, gramil_mm: 35.0,
          tornillo: 'M12', tornillo_desc: 'M12', diam_barreno_mm: 14.0, precio_ref: 'precio_kg_perfil_angulo',
        },
      },
      /* Selección automática por dimensión mayor exterior del extremo: el taller usa una sola brida para todo.
         Para un caso especial se elige otro perfil en la partida (perfil_id). */
      seleccion_perfil: [
        { hasta_mm: 99999, perfil: 'SOL38x4.8' },
      ],
      tornillo_precio_ref: {
        '5/16x1-1/4': 'precio_juego_tornillo_5_16_x_1_1_4', M8: 'precio_juego_tornillo_m8', M10: 'precio_juego_tornillo_m10', M12: 'precio_juego_tornillo_m12',
      },
      uniones: {
        BRIDADO: {
          nombre: 'Bridado (aro de solera + tornillería + empaque)',
          paso_tornillo_mm: 150, n_min_tornillos: 4, multiplo_tornillos: 4,
          f_reserva_tornilleria: 0.05, f_traslape_empaque: 0.05, f_cont_soldadura_aro: 1.0,
        },
        ESPIGA: {
          nombre: 'Espiga (macho-hembra con fijación y sellador)',
          prof_espiga_mm: 60, paso_fijacion_mm: 150, n_min_fijaciones: 4, f_reserva_fijaciones: 0.05,
        },
        LISO: { nombre: 'Extremo liso (sin herraje)' },
      },
      empaque: { precio_ref: 'precio_m_empaque_neopreno' },
      sellador: { ml_por_m: 20, f_merma: 0.15, cartucho_ml: 300, precio_cartucho_ref: 'precio_cartucho_sellador_300ml' },
      precio_fijacion_ref: 'precio_pza_autotaladrante',
    },

    /* ------------------------------------------------------------------ */
    /* TARIFAS DE OPERACIÓN                                               */
    /* mo_h = salario_hora × FSR   (FSR = Factor de Salario Real)         */
    /* Los trabajadores ganan $500 por hora (dato del taller).            */
    /* ------------------------------------------------------------------ */
    mano_obra: {
      FSR: 1.55,
      operaciones: {
        corte: { salario_hora: 500, equipo_h: 45 },
        rolado: { salario_hora: 500, equipo_h: 55 },
        armado: { salario_hora: 500, equipo_h: 25 },
        aros: { salario_hora: 500, equipo_h: 40 },
        soldadura: { salario_hora: 500, equipo_h: 45 },
        engargolado: { salario_hora: 500, equipo_h: 35 },
        barrenado: { salario_hora: 500, equipo_h: 25 },
        acabado: { salario_hora: 500, equipo_h: 20 },
        pintura: { salario_hora: 500, equipo_h: 40 },
        qc_embalaje: { salario_hora: 500, equipo_h: 0 },
      },
    },

    /* ------------------------------------------------------------------ */
    /* PILA DE PRECIO                                                     */
    /* ------------------------------------------------------------------ */
    capas: {
      herramienta_menor_pct_mo: 0.03,
      flete_material_pct: 0.02,
      recuperacion_chatarra_pct: 0.0,
      gif_por_hora_mod: 85.0,
      administracion_pct_cd: 0.08,
      imprevistos_pct: { BAJO: 0.02, MEDIO: 0.04, ALTO: 0.08 },
      financiamiento: { tasa_anual: 0.14, dias_cobro: 45 },
      utilidad_pct_precio: 0.2,
      comision_ventas_pct_precio: 0.02,
      otros_pct_precio: 0.0,
      iva_pct: 0.16,
      cargo_minimo_partida: 250.0,
    },
  };

  /** Devuelve una copia independiente de los maestros de arranque. */
  function crearMaestros(parche) {
    return U.mezclar(base, parche || {});
  }

  /**
   * Quita de un parche guardado lo que ya no existe en las tablas, para que no quede como un campo suelto y sin efecto:
   * el salario diario y la jornada (ahora el salario se captura por hora). No muta el parche recibido.
   */
  function migrarParche(parche) {
    if (parche === null || typeof parche !== 'object' || Array.isArray(parche)) return parche;
    const p = U.clonar(parche);
    const mo = p.mano_obra;
    if (mo && typeof mo === 'object' && !Array.isArray(mo)) {
      delete mo.jornada_h;
      const ops = mo.operaciones;
      if (ops && typeof ops === 'object' && !Array.isArray(ops)) {
        Object.keys(ops).forEach((k) => {
          if (ops[k] && typeof ops[k] === 'object' && !Array.isArray(ops[k])) {
            delete ops[k].salario_diario;
            if (!Object.keys(ops[k]).length) delete ops[k];
          }
        });
        if (!Object.keys(ops).length) delete mo.operaciones;
      }
      if (!Object.keys(mo).length) delete p.mano_obra;
    }
    return p;
  }

  return { crearMaestros, migrarParche, base };
}));
