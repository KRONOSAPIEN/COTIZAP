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
      version: '1.7.0',
      moneda: 'MXN',
      aviso: 'Mano de obra, lámina y perfiles del proveedor y catálogo de compras son reales; el resto son valores ilustrativos. Revisar antes de cotizar.',
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
      precio_kg_perfil_angulo: 25.25,
      precio_kg_solera: 25.21,
      precio_kg_alambre_er70s6: 62.0,
      precio_kg_varilla_er308l: 420.0,
      precio_kg_varilla_er316l: 520.0,
      precio_m3_gas_mezcla_ar_co2: 145.0,
      precio_m3_gas_argon: 190.0,
      precio_m_corte_guillotina: 0.3,
      precio_m_corte_plasma: 3.5,
      precio_m_corte_laser: 2.0,
      precio_m_empaque_neopreno: 28.0, // cinta de neopreno 1½" × 1/8" (38 × 3 mm) para la cara de la brida
      precio_cartucho_sellador: 395.69, // Sikaflex blanco de 600 mL: $459 con IVA (hoja de control de gastos del 6-oct-2026)
      precio_pza_autotaladrante: 0.85,
      precio_juego_tornillo_5_16_x_1_1_4: 3.67, // juego completo: tornillo hex. galv. 5/16" × 1¼" $1.72 + tuerca $0.75 + rondana plana $0.60 + rondana de presión $0.60 (sin IVA)
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
        PLACA_3_16_3X8: { descripcion: 'Placa lisa 3 × 8 ft · 3/16" (prorrateada de la 4 × 8)', material: 'ACERO_CARBON', calibre: 0, esp_mm: 4.7625, ancho_mm: 914, largo_mm: 2438, precio: 2114.42 },
      },
      barras: {
        SOL_1_1_2X3_16: { descripcion: 'Solera 1½" × 3/16" (brida estándar)', perfil: 'SOL38x4.8', largo_mm: 6000, precio: 250 },
        ANG_1_1_2X3_16: { descripcion: 'Ángulo 1½" × 3/16"', perfil: 'L38x4.8', largo_mm: 6000, precio: 470 },
        ANG_2X3_16: { descripcion: 'Ángulo 2" × 3/16"', perfil: 'L51x4.8', largo_mm: 6000, precio: 616 },
        ANG_1_1_4X1_8: { descripcion: 'Ángulo 1¼" × 1/8"', tipo: 'ANGULO', ancho_mm: 31.75, esp_mm: 3.175, largo_mm: 6000, precio: 260 },
        ANG_3_4X1_8: { descripcion: 'Ángulo ¾" × 1/8"', tipo: 'ANGULO', ancho_mm: 19.05, esp_mm: 3.175, largo_mm: 6000, precio: 160 },
        SOL_1_1_4X1_8: { descripcion: 'Solera 1¼" × 1/8"', tipo: 'SOLERA', ancho_mm: 31.75, esp_mm: 3.175, largo_mm: 6000, precio: 150 },
        CANAL_U_6: { descripcion: 'Canal U 6" × 6 m (12.2 kg/m)', kg_m: 12.2, largo_mm: 6000, precio: 2177.18 },
        PTR_2X2_C14: { descripcion: 'PTR 2" × 2" cal. 14 (6 m)', kg_m: 2.91, largo_mm: 6000, precio: 490 }, // kg/m calculado de la sección (4 × (50.8 − 1.9) × 1.9 mm²); el proveedor no lo da
      },
    },

    /* ------------------------------------------------------------------ */
    /* MATERIALES DE LÁMINA                                               */
    /* Pintura (regla del taller): lo que se pinta depende del material y el sistema, de dónde va instalado el ducto.   */
    /*   pintura_cuerpo : sistema del ducto, por ubicación (INTERIOR / EXTERIOR)                                         */
    /*   pintura_bridas : sistema de los aros de brida, por ubicación                                                    */
    /* Acero al carbón: se pinta; en interior sólo pintura (ESMALTE), en exterior primario + pintura (PRIMARIO_ESMALTE). */
    /* Galvanizado: no se pinta más que las bridas. Inoxidable: no se pinta. Los sistemas son los de proceso.pintura.sistemas. */
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
        pintura_cuerpo: { INTERIOR: 'ESMALTE', EXTERIOR: 'PRIMARIO_ESMALTE' },
        pintura_bridas: { INTERIOR: 'ESMALTE', EXTERIOR: 'PRIMARIO_ESMALTE' },
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
        pintura_cuerpo: { INTERIOR: 'NINGUNA', EXTERIOR: 'NINGUNA' }, // la lámina galvanizada no se pinta…
        pintura_bridas: { INTERIOR: 'ESMALTE', EXTERIOR: 'PRIMARIO_ESMALTE' }, // …más que las bridas (aros de solera negra)
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
        pintura_cuerpo: { INTERIOR: 'NINGUNA', EXTERIOR: 'NINGUNA' },
        pintura_bridas: { INTERIOR: 'NINGUNA', EXTERIOR: 'NINGUNA' },
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
        pintura_cuerpo: { INTERIOR: 'NINGUNA', EXTERIOR: 'NINGUNA' },
        pintura_bridas: { INTERIOR: 'NINGUNA', EXTERIOR: 'NINGUNA' },
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

      // Armado del tramo recto por «yardas». Una yarda es un anillo rolado del ANCHO de la lámina (914 mm = 3 ft ó 1 220 mm = 4 ft),
      // para aprovechar toda la hoja; el ingeniero que diseña elige el ancho al cotizar (o por partida). Las yardas se engargolan
      // entre sí en piezas de hasta `yardas_por_pieza_max`, con brida en ambos extremos; lo que falta se arma con las yardas
      // completas que sobren y un tramo de ajuste (menos de una yarda) cuyo extremo libre NO lleva brida de taller, para cortarlo
      // y ponerlo en campo. Qué se cotiza en ese extremo (`extremo_ajuste_defecto`; la partida puede pedir otro):
      //   SUELTA    — el taller manda el aro terminado (rolado, con el cierre soldado, barrenado y pintado), los tornillos y el
      //               empaque, sin soldarlo al ducto: se suelda en obra donde se corta el tramo;
      //   SIN_BRIDA — nada: la brida de ese extremo no está en este precio;
      //   CON_BRIDA — brida fabricada y soldada en taller, como en los demás extremos.
      armado_yardas: {
        yardas_mm: [914, 1220], // anchos de lámina que se eligen al capturar (cotización o partida)
        yarda_defecto_mm: 1220, // la que se usa si no se elige
        yardas_por_pieza_max: 3, // yardas engargoladas en una pieza con bridas en ambos extremos
        ajuste_tolerancia_mm: 25, // un sobrante menor que esto no es un tramo de ajuste (2 735 mm son 3 yardas de 914, no 2 y un ajuste)
        junta_entre_yardas: 'PITTSBURGH', // cómo se unen las yardas de una pieza: clave de proceso.costuras (engargolado; una soldada las soldaría)
        extremo_ajuste_defecto: 'SUELTA', // SUELTA | SIN_BRIDA | CON_BRIDA: qué lleva el extremo libre del tramo de ajuste
      },
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

      // Límites de captura: lo que el cotizador acepta como dato de una partida. Protegen de un cero de más al teclear
      // y de archivos dañados (una pieza de 1 000 000 m no es un tramo de ducto). Se pueden ampliar si el taller lo requiere.
      limites: {
        cantidad_max: 100000, // piezas por partida
        seccion_min_mm: 25, // diámetro o lado más chico (nominal)
        seccion_max_mm: 6000, // diámetro o lado más grande (nominal)
        largo_min_mm: 10, // longitud más corta que se captura (tramo, injerto, tangente…)
        largo_max_mm: 100000, // longitud más larga (100 m)
        espesor_min_mm: 0.2, // espesor propio (placa) mínimo
        espesor_max_mm: 50, // espesor propio (placa) máximo
        piezas_max: 1000, // anillos (yardas) y piezas de un tramo recto, o piezas a armar de una pieza personalizada
        yarda_min_mm: 300, // ancho de yarda (de lámina) más angosto
        yarda_max_mm: 2000, // y más ancho
      },

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

      // puntas_rolado_mm: tramo recto que la roladora no curva en las dos puntas de la solera y se corta; con la holgura de corte
      // reproduce la regla del taller para cortar la solera de un aro redondo, π × (D + 81 mm) (no aplica a marcos rectangulares).
      // Tiempos calibrados con el taller (7-oct-2026): 30 bridas de solera (22 de 11″, 6 de 10″ y 2 de 9″) llevan 4 días (32 h), sobre
      // todo por el rolado de canto y el barrenado; el reparto entre los dos es un supuesto
      aros: { t_fijo_aro_min: 10.0, t_roll_aro_min_m: 19.0, holgura_corte_mm: 3.0, puntas_rolado_mm: 126 },
      barrenado: { t_barreno_min: 2.0 },
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

      // Pintura. Un «sistema» es la lista de manos que lleva una superficie: ESMALTE = sólo pintura (interior), PRIMARIO_ESMALTE =
      // primario y pintura (exterior). Qué sistema lleva cada material, el ducto y las bridas, está en `materiales` (pintura_cuerpo,
      // pintura_bridas) según la ubicación; `ubicacion_defecto` es la de una cotización o partida que no la dice.
      pintura: {
        t_prep_min_m2: 4.0,
        t_aplic_min_m2: 3.0,
        ubicacion_defecto: 'INTERIOR', // INTERIOR (bajo techo) | EXTERIOR (a la intemperie)
        sistemas: { NINGUNA: [], ESMALTE: ['esmalte'], PRIMARIO: ['primario'], PRIMARIO_ESMALTE: ['primario', 'esmalte'] },
        capas: {
          primario: { sv_pct: 55, dft_um: 50, eta_transf: 0.65, precio_ref: 'precio_L_primario' },
          esmalte: { sv_pct: 45, dft_um: 40, eta_transf: 0.65, precio_ref: 'precio_L_esmalte' },
        },
        f_diluyente: 0.1,
        diluyente_precio_ref: 'precio_L_diluyente',
      },

      qc: { t_fijo_min: 3.0, k_manejo_min_kg: 0.05 },

      // Soportería (ménsulas, abrazaderas, postes): minutos REALES de taller por pieza (corte, doblez, barreno y punteo) si la partida
      // no los dice; anclaje_defecto: artículo del catálogo de compras que fija cada pieza; tornillo: el juego que la une (de
      // herrajes.tornillo_precio_ref); oreja_abrazadera_mm: cada una de las dos orejas con que una abrazadera de media vuelta se atornilla
      soportes: { t_fab_pieza_min: 15.0, anclaje_defecto: 'TAQUETE_3_8', tornillo: '5/16x1-1/4', oreja_abrazadera_mm: 50 },
    },

    /* ------------------------------------------------------------------ */
    /* HERRAJES DE UNIÓN                                                  */
    /* ------------------------------------------------------------------ */
    herrajes: {
      /* Perfiles para aros de brida (el aro se rola "de canto": el ancho queda en el plano radial).
         ESTÁNDAR DEL TALLER: solera de 1½" × 3/16", barreno de 3/8", tornillo de 5/16" × 1¼", para todos los diámetros.
         tipo SOLERA = barra plana (gramil: distancia del borde interior al barreno); tipo ANGULO = ala radial de un ángulo.
         Peso lineal, área y centroide se derivan de (tipo, ancho, espesor); no se capturan.
         `tornillo` apunta a `tornillo_precio_ref`; `precio_ref` al precio por kg del perfil. */
      perfiles: {
        'SOL38x4.8': {
          // gramil 24 mm: los planos de pedido del 30-sep-2026 ponen los barrenos a 24 mm del borde interior del aro (Dperf = Dint + 48)
          tipo: 'SOLERA', descripcion: 'Solera 1½" × 3/16"', ancho_mm: 38.1, esp_mm: 4.763, gramil_mm: 24,
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
        // junta: con qué se sella la cara de la brida. SELLADOR (el taller usa Sikaflex en lugar del empaque de neopreno): un cordón
        // de ml_sellador_junta_m mL por metro sobre el círculo de barrenos, que también es el sello de la junta transversal (clase C);
        // EMPAQUE: cinta de neopreno (herrajes.empaque) y, aparte, el cordón de sellador de la clase de sellado
        BRIDADO: {
          nombre: 'Bridado (aro de solera + tornillería + sellador en la junta)',
          // barrenos como en los planos de pedido del 30-sep-2026: 8 en las de 10″ y 11″, 6 en las de 9″ y menores (mínimo 6, número par)
          paso_tornillo_mm: 150, n_min_tornillos: 6, multiplo_tornillos: 2,
          f_reserva_tornilleria: 0.05, f_traslape_empaque: 0.05, f_cont_soldadura_aro: 1.0,
          junta: 'SELLADOR', ml_sellador_junta_m: 40,
        },
        ESPIGA: {
          nombre: 'Espiga (macho-hembra con fijación y sellador)',
          prof_espiga_mm: 60, paso_fijacion_mm: 150, n_min_fijaciones: 4, f_reserva_fijaciones: 0.05,
        },
        LISO: { nombre: 'Extremo liso (sin herraje)' },
      },
      empaque: { precio_ref: 'precio_m_empaque_neopreno' },
      sellador: { ml_por_m: 20, f_merma: 0.15, cartucho_ml: 600, precio_cartucho_ref: 'precio_cartucho_sellador' },
      precio_fijacion_ref: 'precio_pza_autotaladrante',
    },

    /* ------------------------------------------------------------------ */
    /* TARIFAS DE OPERACIÓN                                               */
    /* El taller paga por DÍA: $500 ($3,500 a la semana ÷ 7 días; dato   */
    /* del taller, sin utilidades ni prestaciones) y cuesta la hora así:  */
    /*   salario_hora = salario_diario ÷ horas por día = 500 ÷ 8 = $62.50 */
    /*   mo_h         = salario_hora × FSR                                */
    /* FSR = 1.00 porque así lo calcula el taller. Para cobrar en cada    */
    /* hora lo que se paga y no se trabaja (7 días por 5) y las           */
    /* prestaciones de ley, el FSR sube (7/5 = 1.40 sólo por los días).   */
    /* `instalacion` es la cuadrilla que monta en obra (familia INSTALACION). */
    /* ------------------------------------------------------------------ */
    mano_obra: {
      FSR: 1.0,
      jornada: { horas_dia: 8 },
      operaciones: {
        corte: { salario_diario: 500, equipo_h: 45 },
        rolado: { salario_diario: 500, equipo_h: 55 },
        armado: { salario_diario: 500, equipo_h: 25 },
        aros: { salario_diario: 500, equipo_h: 40 },
        soldadura: { salario_diario: 500, equipo_h: 45 },
        engargolado: { salario_diario: 500, equipo_h: 35 },
        barrenado: { salario_diario: 500, equipo_h: 25 },
        acabado: { salario_diario: 500, equipo_h: 20 },
        pintura: { salario_diario: 500, equipo_h: 40 },
        qc_embalaje: { salario_diario: 500, equipo_h: 0 },
        instalacion: { salario_diario: 500, equipo_h: 0 },
      },
    },

    /* ------------------------------------------------------------------ */
    /* CATÁLOGO DE COMPRAS — artículos que se compran hechos (mangueras,  */
    /* abrazaderas, anclajes, accesorios de soportería). Hoja de control  */
    /* de gastos del 6-oct-2026. `iva_incluido`: el precio ya trae IVA    */
    /* (se le quita con `iva_pct`); sin él, el precio es antes de IVA.    */
    /* `categoria`: en qué renglón del control de gastos cae su costo.    */
    /* ------------------------------------------------------------------ */
    compras: {
      iva_pct: 0.16, // IVA de las compras: lo que se le quita a un precio con IVA (es acreditable)
      articulos: {
        MANGUERA_6: { descripcion: 'Manguera azul de 6″ (tramo de 5 m)', unidad: 'tramo', precio: 1807.49, iva_incluido: false, categoria: 'PROVEEDOR' },
        MANGUERA_5: { descripcion: 'Manguera azul de 5″ (tramo)', unidad: 'tramo', precio: 1427.03, iva_incluido: false, categoria: 'PROVEEDOR' },
        MANGUERA_3: { descripcion: 'Manguera azul de 3″ (tramo)', unidad: 'tramo', precio: 1176.94, iva_incluido: false, categoria: 'PROVEEDOR' },
        ABRAZADERA_MANGUERA: { descripcion: 'Abrazadera ajustable para manguera', unidad: 'pza', precio: 55, iva_incluido: true, categoria: 'PROVEEDOR' },
        TAQUETE_3_8: { descripcion: 'Taquete de 3/8″', unidad: 'pza', precio: 16, iva_incluido: true, categoria: 'SOPORTERIA' },
        RIEL_1500_C14: { descripcion: 'Riel 1500 cal. 14', unidad: 'pza', precio: 560.34, iva_incluido: false, categoria: 'SOPORTERIA' },
        TEJUELO_2: { descripcion: 'Tejuelo de 2″', unidad: 'pza', precio: 103.48, iva_incluido: false, categoria: 'SOPORTERIA' },
        CARRETILLA_EMBALADA: { descripcion: 'Carretilla embalada', unidad: 'pza', precio: 172.41, iva_incluido: false, categoria: 'SOPORTERIA' },
        SIKAFLEX_BLANCO_600: { descripcion: 'Sellador Sikaflex blanco 600 mL', unidad: 'pza', precio: 459, iva_incluido: true, categoria: 'MATERIAL' },
        SIKAFLEX_GRIS_600: { descripcion: 'Sellador Sikaflex gris 600 mL', unidad: 'pza', precio: 359, iva_incluido: true, categoria: 'MATERIAL' },
        // Bridas de placa de 3/16″ cortadas con plasma por el proveedor de corte (cotización del 2-oct-2026, antes de IVA; barrenos de
        // 9.5 mm = 3/8″, para el tornillo de 5/16″). tornillos_pieza: juegos de tornillería que lleva cada una (media junta: los planos
        // de pedido del 30-sep-2026 les ponen 6 barrenos). circulo_barrenos_mm: con él se calcula el cordón de Sikaflex de su media
        // junta, igual que en las bridas de solera. diam_ext_mm y diam_int_mm: sus diámetros exterior e interior, para dibujarla en el
        // plano de pedido (no cambian el costo)
        BRIDA_PLACA_5: { descripcion: 'Brida de placa 3/16″ para ducto de 5″ (Ø 194/130 mm, barrenos en Ø 170 mm)', unidad: 'pza', precio: 110, iva_incluido: false, categoria: 'PROVEEDOR', tornillos_pieza: 3, circulo_barrenos_mm: 170, diam_ext_mm: 194, diam_int_mm: 130 },
        BRIDA_PLACA_6: { descripcion: 'Brida de placa 3/16″ para ducto de 6″ (Ø 221/157 mm, barrenos en Ø 193 mm)', unidad: 'pza', precio: 120, iva_incluido: false, categoria: 'PROVEEDOR', tornillos_pieza: 3, circulo_barrenos_mm: 193, diam_ext_mm: 221, diam_int_mm: 157 },
        BRIDA_PLACA_7: { descripcion: 'Brida de placa 3/16″ para ducto de 7″ (Ø 258/182 mm, barrenos en Ø 230 mm)', unidad: 'pza', precio: 140, iva_incluido: false, categoria: 'PROVEEDOR', tornillos_pieza: 3, circulo_barrenos_mm: 230, diam_ext_mm: 258, diam_int_mm: 182 },
      },
      // Al comprar piezas enteras (lista de compras): la tornillería se compra en múltiplos de esto, la pintura en envases de
      // este tamaño; las hojas y las barras completas
      tornillos_multiplo: 10,
      pintura_envase_L: 1,
    },

    /* ------------------------------------------------------------------ */
    /* PILA DE PRECIO                                                     */
    /* ------------------------------------------------------------------ */
    capas: {
      herramienta_menor_pct_mo: 0.03,
      flete_material_pct: 0.02,
      recuperacion_chatarra_pct: 0.0,
      gif_por_hora_mod: 85.0,
      gif_por_hora_instalacion: 0.0, // indirectos por hora de la cuadrilla en obra (la nave no se usa); 0 = sólo administración, imprevistos y utilidad
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

  /**
   * Un parche de maestros viene de fuera (navegador, almacén compartido, archivo importado): sólo se conserva lo que
   * tiene la forma de las tablas de arranque. Un número debe ser un número finito, un texto un texto, una lista una
   * lista no vacía de elementos de la misma forma, una tabla una tabla. Lo que no cumple se descarta (queda el valor de
   * arranque) y se anota su ruta. Los renglones que no existen en el arranque (otra hoja del proveedor, otro material)
   * se respetan si son datos simples. No muta lo recibido.
   * Devuelve { parche, descartados: ['proceso.hoja.ancho_mm', …] }.
   */
  function sanearParche(parche) {
    const descartados = [];
    const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const hay = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const simple = (v) => {
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v === 'string' || typeof v === 'boolean') return true;
      if (Array.isArray(v)) return v.every(simple);
      return esObj(v) && Object.keys(v).every((k) => simple(v[k]));
    };
    // ¿v tiene la forma de la referencia?
    const forma = (v, ref) => {
      if (typeof ref === 'number') return typeof v === 'number' && Number.isFinite(v);
      if (typeof ref === 'string') return typeof v === 'string';
      if (typeof ref === 'boolean') return typeof v === 'boolean';
      if (Array.isArray(ref)) return Array.isArray(v) && v.length > 0 && (!ref.length || v.every((x) => forma(x, ref[0])));
      if (esObj(ref)) return esObj(v) && Object.keys(ref).every((k) => hay(v, k) && forma(v[k], ref[k]));
      return true;
    };
    const limpiar = (p, ref, ruta) => {
      const salida = {};
      Object.keys(p).forEach((k) => {
        if (k === '__proto__') return; // nunca toca prototipos
        const v = p[k];
        const r = hay(ref, k) ? ref[k] : undefined;
        const aqui = [...ruta, k].join('.');
        if (r === undefined) {
          if (simple(v)) salida[k] = v; else descartados.push(aqui);
        } else if (esObj(r)) {
          if (esObj(v)) {
            const sub = limpiar(v, r, [...ruta, k]);
            if (Object.keys(sub).length) salida[k] = sub;
          } else descartados.push(aqui);
        } else if (forma(v, r)) salida[k] = v;
        else descartados.push(aqui);
      });
      return salida;
    };
    if (!esObj(parche)) return { parche: {}, descartados: parche === undefined || parche === null ? [] : ['(todo el parche)'] };
    return { parche: limpiar(parche, base, []), descartados };
  }

  /** Un parche guardado o importado, listo para mezclar: sin lo obsoleto de versiones anteriores y sin lo que no tiene la forma de las tablas. */
  const leerParche = (parche) => sanearParche(migrarParche(parche));

  /** Devuelve una copia independiente de los maestros de arranque, con el parche encima (ya migrado y saneado). */
  function crearMaestros(parche) {
    return U.mezclar(base, leerParche(parche).parche);
  }

  /**
   * Pone al día un parche guardado por una versión anterior, para que nada quede como un campo suelto y sin efecto:
   *   · mano de obra: el salario es por DÍA (salario_diario) y la hora es el día entre las horas por día (jornada.horas_dia).
   *     El «salario por hora» de la versión 1.5 se capturó con el valor del día ($500 por hora): se descarta y rige el
   *     salario diario. El salario diario y las horas por día de las versiones anteriores a la 1.5 se conservan; los días
   *     pagados y trabajados por semana de la 1.6 se descartan (el taller cuesta la hora como el día entre 8 h);
   *   · la longitud máxima por pieza (ahora el tramo recto se arma por yardas);
   *   · la pintura por defecto de cada material (ahora un sistema para el ducto y otro para las bridas, según la ubicación);
   *   · el cartucho de sellador de 300 mL (ahora el de 600 mL, con otro nombre de precio).
   * No muta el parche recibido.
   */
  function migrarParche(parche) {
    if (parche === null || typeof parche !== 'object' || Array.isArray(parche)) return parche;
    const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const vaciar = (o, k) => { if (esObj(o[k]) && !Object.keys(o[k]).length) delete o[k]; };
    const p = U.clonar(parche);
    // La longitud máxima por pieza (3 000 mm) la sustituyó el armado por yardas (proceso.armado_yardas)
    if (esObj(p.proceso)) {
      delete p.proceso.L_max_pieza_mm;
      vaciar(p, 'proceso');
    }
    // La pintura por defecto de cada material la sustituyeron pintura_cuerpo y pintura_bridas (por ubicación)
    const mats = p.materiales;
    if (esObj(mats)) {
      Object.keys(mats).forEach((k) => {
        if (esObj(mats[k])) {
          delete mats[k].pintura_defecto;
          vaciar(mats, k);
        }
      });
      vaciar(p, 'materiales');
    }
    const mo = p.mano_obra;
    if (esObj(mo)) {
      if (typeof mo.jornada_h === 'number' && !(esObj(mo.jornada) && 'horas_dia' in mo.jornada)) mo.jornada = { ...(esObj(mo.jornada) ? mo.jornada : {}), horas_dia: mo.jornada_h };
      delete mo.jornada_h;
      if (esObj(mo.jornada)) {
        delete mo.jornada.dias_pagados_semana;
        delete mo.jornada.dias_trabajados_semana;
        vaciar(mo, 'jornada');
      }
      const ops = mo.operaciones;
      if (esObj(ops)) {
        Object.keys(ops).forEach((k) => {
          if (esObj(ops[k])) {
            delete ops[k].salario_hora;
            vaciar(ops, k);
          }
        });
        vaciar(mo, 'operaciones');
      }
      vaciar(p, 'mano_obra');
    }
    // El cartucho de sellador de 300 mL a $120 lo sustituyó el de 600 mL (precio_cartucho_sellador)
    if (esObj(p.precios)) {
      delete p.precios.precio_cartucho_sellador_300ml;
      vaciar(p, 'precios');
    }
    if (esObj(p.herrajes) && esObj(p.herrajes.sellador) && p.herrajes.sellador.precio_cartucho_ref === 'precio_cartucho_sellador_300ml') {
      delete p.herrajes.sellador.precio_cartucho_ref;
      vaciar(p.herrajes, 'sellador');
      vaciar(p, 'herrajes');
    }
    return p;
  }

  return {
    crearMaestros, migrarParche, sanearParche, leerParche, base,
  };
}));
