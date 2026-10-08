/**
 * COTIZAP · ayuda_maestros.js — Catálogo de ayuda de las tablas maestras.
 *
 * Para cada dato de las tablas maestras dice, en pocas líneas: QUÉ ES, CÓMO SE LLENA y QUÉ ESPERAR AL CAMBIARLO.
 * La interfaz (web/maestros_ui.js) lo muestra en una ventana emergente al pulsar ⓘ; no contiene números de cálculo:
 * sólo texto y rangos de referencia. Es dato puro (UMD: navegador y Node) para que una prueba verifique que
 * NINGÚN campo de `crearMaestros()` se queda sin explicación.
 *
 * Cada entrada se identifica por un patrón de ruta con puntos; `*` es exactamente un segmento (una clave o un índice).
 * Se usa la primera entrada que coincide. Campos de una entrada:
 *   t        título legible          que / como / efecto   las tres respuestas (qué es · cómo llenarlo · qué esperar)
 *   afecta   partes del precio que mueve (claves de AFECTA)
 *   tip      [mín, máx] usuales (o `tipEsp`: uno por clave del último `*`), en las unidades que se ven en pantalla (los % se escriben en %); es referencia, no regla
 *   ej       ejemplo con números     ojo   advertencia
 *   origen   (sólo grupos) real | mixto | norma | ilustrativo, con su explicación en origenTxt
 *   opc      { valor: qué significa } para datos que se eligen de una lista
 *   cols     { columna: qué significa } para tablas
 *   nom      { clave: nombre }       sustituye {0}, {1}… (los segmentos que cubrieron cada `*`) en los textos
 *   esp      { clave: texto }        renglón extra según la clave que cubrió el último `*` (o `espEn`, el índice del `*`)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.ayudaMaestros = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Partes del precio que un dato puede mover (las etiquetas de los chips de la ventana). */
  const AFECTA = {
    mat: 'Material',
    cons: 'Consumibles',
    mo: 'Mano de obra',
    eq: 'Equipo',
    ci: 'Indirectos',
    imp: 'Imprevistos',
    fin: 'Financiamiento',
    util: 'Utilidad y comisión',
    iva: 'IVA',
    peso: 'Peso',
    geo: 'Forma de la pieza',
    lim: 'Qué se acepta capturar',
    info: 'Sólo informa',
    rapida: 'Cotización rápida',
  };

  /* ---------- Unidades y presentación de los valores (las usa también el editor) ---------- */
  const UNIDADES = [
    [/^precio_kg_/, 'MXN/kg'], [/^precio_m3_/, 'MXN/m³'], [/^precio_m_/, 'MXN/m'], [/^precio_cartucho/, 'MXN/cartucho'], [/^precio_pza/, 'MXN/pza'],
    [/^precio_juego/, 'MXN/juego'], [/^precio_L_/, 'MXN/L'], [/salario_hora/, 'MXN/h'], [/equipo_h$/, 'MXN/h'], [/gif_por_hora/, 'MXN/h'], [/cargo_minimo/, 'MXN'],
    [/_mm$/, 'mm'], [/_mm2$/, 'mm²'], [/_m_min$/, 'm/min'], [/_min_m2$/, 'min/m²'], [/_min_m$/, 'min/m'], [/_min_kg$/, 'min/kg'], [/_min$/, 'min'], [/_deg$/, '°'],
    [/^salario_diario$/, 'MXN/día'], [/^pago_dia_/, 'MXN/día'], [/^personas_/, 'personas'], [/^dias_/, 'días'], [/^horas_dia$/, 'h/día'], [/_envase_L$/, 'L'], [/^tornillos_multiplo$/, 'juegos'], [/^tornillos_pieza$/, 'juegos'],
    [/^ml_sellador_junta_m$/, 'mL/m'],
    [/^(horizontal_m|horizontal_max_m|vertical_m)$/, 'm'], [/^(base_vertical|por_accesorio)$/, 'soportes'], [/^menula_anclajes$/, 'piezas'],
    [/_kg_m3$/, 'kg/m³'], [/_g_cm3$/, 'g/cm³'], [/_L_min$/, 'L/min'], [/_um$/, 'µm'], [/^sv_pct$/, '%'], [/^dias_cobro$/, 'días'], [/ml_por_m/, 'mL/m'], [/^cartucho_ml$/, 'mL'],
  ];

  // Se guardan como fracción (0.20) y se muestran en % (20): `utilidad_pct_precio`, `administracion_pct_cd`, `iva_pct`… (`_pct` en cualquier parte del nombre)
  const esPct = (ruta) => ruta[0] === 'merma' || ruta.some((k) => typeof k === 'string' && /_pct(_|$)|^tasa_/.test(k) && k !== 'sv_pct');
  const etiqueta = (k) => String(k).replace(/_/g, ' ');
  function unidadDe(ruta) {
    if (esPct(ruta)) return '%';
    const k = [...ruta].reverse().find((x) => typeof x === 'string');
    const par = UNIDADES.find(([re]) => re.test(k));
    if (par) return par[1];
    if (ruta[0] === 'calibres') return 'in';
    if (ruta[0] === 'compras' && k === 'precio') return 'MXN';
    return '';
  }
  /** El número tal como se ve en pantalla (los % se muestran por 100). */
  const mostrado = (ruta, valor) => (esPct(ruta) && typeof valor === 'number' ? Number((valor * 100).toFixed(6)) : valor);

  /* ---------- Nombres que se repiten ---------- */
  /** Qué tan confiables son los valores de arranque de un grupo (etiqueta corta). */
  const ORIGENES = { real: 'Datos reales', mixto: 'Parcialmente reales', norma: 'De norma', ilustrativo: 'Ilustrativos' };

  const FAMILIAS = {
    RECTO: 'Tramo recto', CODO: 'Codo', REDUCCION: 'Reducción', TRANSICION: 'Transición', RAMAL: 'Injerto simple',
    REDUCCION_INJERTO: 'Reducción con injerto', PANTALON: 'Pantalón (familia retirada)', PERSONALIZADO: 'Pieza personalizada', PERFIL: 'Aros de brida (perfil)',
  };
  const OPERACIONES = {
    corte: 'Corte', rolado: 'Rolado y plegado', armado: 'Armado y punteo', aros: 'Fabricación de aros de brida', soldadura: 'Soldadura',
    engargolado: 'Engargolado', barrenado: 'Barrenado', acabado: 'Acabado (esmerilado y limpieza)', pintura: 'Pintura', qc_embalaje: 'Inspección y embalaje',
    instalacion: 'Instalación en obra',
  };
  const MATERIALES = { ACERO_CARBON: 'acero al carbón', GALVANIZADO: 'galvanizado', INOX_304: 'inox 304', INOX_316: 'inox 316' };
  const ARTICULOS = {
    MANGUERA_6: 'manguera de 6″', MANGUERA_5: 'manguera de 5″', MANGUERA_3: 'manguera de 3″', ABRAZADERA_MANGUERA: 'abrazadera de manguera',
    TAQUETE_3_8: 'taquete de 3/8″', RIEL_1500_C14: 'riel 1500', TEJUELO_2: 'tejuelo de 2″', CARRETILLA_EMBALADA: 'carretilla embalada',
    SIKAFLEX_BLANCO_600: 'Sikaflex blanco', SIKAFLEX_GRIS_600: 'Sikaflex gris',
    BRIDA_PLACA_5: 'brida de placa de 5″', BRIDA_PLACA_6: 'brida de placa de 6″', BRIDA_PLACA_7: 'brida de placa de 7″',
  };
  const SISTEMAS = { NINGUNA: 'sin pintura', ESMALTE: 'esmalte (sólo pintura)', PRIMARIO: 'primario', PRIMARIO_ESMALTE: 'primario + esmalte' };

  /* ======================================================================================================== */
  /* CATÁLOGO                                                                                                 */
  /* ======================================================================================================== */
  const CAT = [];
  /** E(patrón, título, qué es, cómo se llena, qué esperar al cambiarlo, extras) */
  const E = (patron, t, que, como, efecto, extra) => { CAT.push({ patron, t, que, como, efecto, ...(extra || {}) }); };

  /* ---------------------------------------- Grupos ---------------------------------------- */
  E('proveedor', 'Lista de precios del proveedor',
    'Lo que cotiza su proveedor de acero: lámina en hoja y perfiles en barra. Cada precio es de la pieza completa.',
    'Capture el precio como viene en la cotización o factura y diga arriba cuánto IVA trae. El cotizador muestra el precio por kg que de ahí resulta.',
    'Es la base del costo de la lámina y de los aros de brida. Los renglones «Cálculo» mueven el precio de las cotizaciones; los de «Referencia» sólo quedan guardados.',
    { origen: 'real', origenTxt: 'Datos reales de la cotización y factura del proveedor.', afecta: ['mat'], ej: 'Hoja galvanizada cal. 22 de 4 × 10 ft a $920 con IVA → $793.10 sin IVA ÷ 24.9 kg = $31.86 por kg.' });
  E('precios', 'Precios de consumibles y materiales',
    'Variables de precio unitario (sin IVA) de lo que se gasta al fabricar: acero de respaldo, chatarra, soldadura, gas, corte, empaque, tornillería y pintura.',
    'Un renglón por variable, en MXN por la unidad que se ve a la derecha. El resto de las tablas sólo apunta a estos nombres: se cambia el precio aquí y se actualiza en todos lados.',
    'Se mueve únicamente lo que usa esa variable. El kg de lámina y de perfil de este grupo sólo se usa si el calibre o perfil falta en la lista del proveedor.',
    { origen: 'mixto', origenTxt: 'Acero, solera y ángulo salen de la lista real del proveedor; los demás precios son ilustrativos.', afecta: ['mat', 'cons'] });
  E('compras', 'Catálogo de compras',
    'Los artículos que se compran hechos (mangueras, abrazaderas, taquetes, selladores, bridas de placa cortadas con plasma…): su precio, su unidad y si el precio trae IVA.',
    'Un renglón por artículo. Capture el precio como lo da la tienda y diga si trae IVA. Abajo: el IVA que se le quita y cómo se compran tornillos y pintura en la lista de compras.',
    'Las partidas de «Artículo comprado» y los anclajes de la soportería toman el precio de aquí; un precio con IVA se cuesta sin él (el IVA se acredita).',
    { origen: 'real', origenTxt: 'Precios de la hoja de control de gastos del 6 de octubre de 2026 y de la cotización del proveedor de corte del 2 de octubre.', afecta: ['mat'], ej: 'Taquete de 3/8″ a $16 con IVA → $13.79 sin IVA por pieza.' });
  E('mano_obra', 'Mano de obra y equipo',
    'Cuánto cuesta una hora de cada operación: el salario por DÍA del personal, las horas del día y el costo por hora de la máquina.',
    'Salario en MXN por día (hoy $500: $3,500 a la semana ÷ 7 días, sin utilidades ni prestaciones). En equipo: depreciación + energía + mantenimiento.',
    'La hora cuesta salario ÷ horas por día × FSR: con $500 y 8 h, $62.50. Subirla encarece las horas de taller y de instalación.',
    { origen: 'mixto', origenTxt: 'El salario de $500 por día es real ($3,500 a la semana ÷ 7 días); el costo de equipo por hora es ilustrativo.', afecta: ['mo', 'eq'], ej: '$500 por día ÷ 8 h = $62.50 por hora.' });
  E('merma', 'Merma por familia de pieza',
    'La parte de la lámina comprada que no queda en la pieza: recortes, huecos de injertos y cortes. Una merma por familia.',
    'Capture en %. Entre más curvas, cuñas e injertos tenga la familia, más recorte deja. Se obtiene pesando recortes contra lámina usada en obras reales.',
    'Material comprado = material de la pieza ÷ (1 − merma). Subir de 20 % a 25 % compra ≈ 7 % más lámina para esa familia.',
    { origen: 'ilustrativo', origenTxt: 'Valores ilustrativos: mida su merma real y sustitúyalos.', afecta: ['mat', 'peso'] });
  E('capas', 'Pila de precio (indirectos, utilidad e IVA)',
    'Lo que se suma al costo directo hasta llegar al precio: herramienta menor, flete, indirectos, imprevistos, financiamiento, utilidad, comisión e IVA.',
    'Casi todo va en % del costo o del precio. Utilidad y comisión son % del precio de venta (no del costo). Cada cotización puede traer sus propios valores en su encabezado.',
    'Mueven el precio de todas las partidas a la vez. Con la utilidad en 20 % del precio, el precio es costo ÷ (1 − 0.20 − comisión − otros).',
    { origen: 'ilustrativo', origenTxt: 'Valores ilustrativos: use los indirectos, la utilidad y el costo de financiamiento de su empresa.', afecta: ['ci', 'imp', 'fin', 'util', 'iva'], ojo: 'Si la cotización tiene su propio valor en el encabezado (margen, comisión, días de cobro, etc.), el de aquí no se usa en ella.' });
  E('proceso', 'Proceso de fabricación',
    'Cómo trabaja el taller: tamaño de hoja, tiempos y velocidades por operación, soldadura, pintura, armado por yardas, ángulos permitidos y topes de captura.',
    'Los tiempos salen de cronometrar el trabajo real (min por pieza o por metro; m/min por espesor). Los ILUSTRATIVOS deben sustituirse con estudios de tiempos del taller.',
    'Cambian horas de taller y consumibles: más minutos o menos velocidad = más horas = más mano de obra, equipo e indirectos. Los topes sólo cambian qué se acepta capturar.',
    { origen: 'ilustrativo', origenTxt: 'Tiempos y velocidades ilustrativos: sustitúyalos con estudios de tiempos del taller.', afecta: ['mo', 'eq', 'cons', 'geo', 'lim'] });
  E('herrajes', 'Herrajes de unión',
    'Los aros de brida (perfil, barreno, tornillo), cómo se calcula cada tipo de unión y la tornillería, el empaque y el sellador.',
    'El taller usa una sola brida: solera 1½″ × 3/16″, barreno 3/8″, tornillo 5/16″ × 1¼″. Para otro perfil cambie su renglón o elíjalo en la partida.',
    'Más tornillos, más empaque o un perfil más pesado suben material y horas de aros, armado y barrenado de todas las piezas con brida.',
    { origen: 'mixto', origenTxt: 'La brida estándar (solera 1½″ × 3/16″) es la del taller; los factores de cálculo son ilustrativos.', afecta: ['mat', 'mo', 'cons'] });
  E('materiales', 'Materiales de lámina',
    'La ficha de cada material: densidad, tabla de calibres, a qué precios apunta, cómo se suelda y qué pintura lleva el ducto y las bridas.',
    'Un bloque por material. Los nombres de precio se eligen de la lista de «Precios» y la pintura se elige por ubicación (interior o exterior).',
    'Cambiar a qué precio apunta un material, o su factor de soldadura, mueve todas las piezas de ese material y ninguna de los demás.',
    { origen: 'mixto', origenTxt: 'Las reglas de pintura son del taller; los factores de soldadura y acabado son ilustrativos.', afecta: ['mat', 'cons', 'mo', 'peso'] });
  E('calibres', 'Espesor por calibre',
    'Cuántas pulgadas mide cada calibre. Cada familia (MSG, GSG, USSG) tiene su propia tabla porque un mismo número es un espesor distinto.',
    'Copie los valores de la norma o del certificado del proveedor, en pulgadas con 4 decimales. Un material usa la tabla que dice su ficha.',
    'El espesor define el peso, el área soldada y las velocidades de corte, rolado y soldadura de toda pieza en ese calibre.',
    { origen: 'norma', origenTxt: 'Valores de las tablas de calibre; verifíquelos contra el certificado de su proveedor.', afecta: ['peso', 'mat', 'mo'], ojo: 'Usar la tabla equivocada en 16 ga da ≈ 6 % de error de peso (0.0598 in contra 0.0635 in).' });
  E('servicios', 'Calibre mínimo por servicio',
    'La regla interna del taller: qué tan delgada puede ser la lámina según el diámetro y el servicio (ventilación, polvo o abrasivo).',
    'Una tabla por servicio. Cada renglón dice «hasta tal diámetro, el calibre más delgado permitido es N». Mayor número de calibre = lámina más delgada.',
    'No cambia el precio. Si una partida usa un calibre más delgado que el permitido, el cotizador avisa en su detalle.',
    { origen: 'ilustrativo', origenTxt: 'Valores ilustrativos y no normativos: pueble la tabla con su norma interna.', afecta: ['info'], ojo: 'Los valores de arranque son ILUSTRATIVOS (no normativos): pueble la tabla con su norma interna, SMACNA o ACGIH.' });

  E('rapida', 'Cotización rápida',
    'La regla del taller para dar un precio en minutos con el diámetro mayor y los metros hasta el punto más alejado.',
    'Lámina en hojas enteras × su precio sin IVA × el factor, más las bridas según los metros, la mano de obra de los días, la utilidad y el IVA.',
    'Sólo mueve la pestaña «Cotización rápida»: las partidas de la cotización detallada no usan estos valores.',
    { origen: 'mixto', origenTxt: 'El factor y las bridas por metros son del taller; la utilidad de arranque es ilustrativa.', afecta: ['rapida'] });
  E('rapida.hoja_defecto', 'Lámina con que se cuenta',
    'La hoja de la lista del proveedor que se usa si en la cotización rápida no se elige otra.',
    'Se elige de la lista del proveedor (sólo las hojas con precio).',
    'Cambia cuántas hojas salen (por su tamaño) y su precio.',
    { afecta: ['rapida'], ej: 'Galvanizada cal. 22 de 4 × 10 ft: cada hoja da 3 yardas de 11″.' });
  E('rapida.factor_lamina', 'Factor de la lámina',
    'Por cuánto se multiplica el costo de la lámina para cubrir la mano de obra, los accesorios y lo demás.',
    'Un número: 3 es la regla del taller.',
    'El precio sube en proporción: con 3, cada $1,000 de lámina son $3,000 antes de bridas, utilidad e IVA.',
    { afecta: ['rapida'], tip: [1.5, 5] });
  E('rapida.utilidad_pct', 'Utilidad de la cotización rápida',
    'La utilidad que se suma sobre el costo (lámina por el factor, bridas y mano de obra por días).',
    'En %, sobre el costo. Cada cotización rápida puede cambiarla.',
    'Con 20 %, un costo de $31,172 queda en $37,407 antes de IVA.',
    { afecta: ['rapida'], tip: [0, 60], ojo: 'Se suma al costo, no es un % del precio como la utilidad de la pila de precio.' });
  E('rapida.personas_fabricacion', 'Personas en la fabricación de bridas',
    'Cuántas personas hacen las bridas en los días de fabricación de la cotización rápida.',
    'Un número entero. El taller: 1 persona.',
    'La mano de obra de la fabricación es días × personas × pago por día: con 1 persona a $500, 4 días son $2,000.',
    { afecta: ['rapida'], tip: [1, 4] });
  E('rapida.pago_dia_fabricacion', 'Pago por día en la fabricación de bridas',
    'Lo que gana por día cada persona que hace las bridas.',
    'En MXN por día. El taller: $500.',
    'Sube o baja la mano de obra de la fabricación en proporción a los días.',
    { afecta: ['rapida'], tip: [300, 1500] });
  E('rapida.personas_instalacion', 'Personas en la instalación',
    'Cuántas personas instalan en los días de instalación de la cotización rápida.',
    'Un número entero. El taller: 2 personas.',
    'La mano de obra de la instalación es días × personas × pago por día: con 2 personas a $500, 3 días son $3,000.',
    { afecta: ['rapida'], tip: [1, 6] });
  E('rapida.pago_dia_instalacion', 'Pago por día en la instalación',
    'Lo que gana por día cada persona que instala.',
    'En MXN por día. El taller: $500.',
    'Sube o baja la mano de obra de la instalación en proporción a los días y a las personas.',
    { afecta: ['rapida'], tip: [300, 1500] });
  E('rapida.bridas_por_metros', 'Bridas por metros',
    'Lo que se suma por las bridas según los metros hasta el punto más alejado.',
    'Cada renglón dice «hasta tantos metros, tanto». Se usa el primero que alcance. Importes sin IVA.',
    'Sube o baja el precio en lo que cambie el renglón. Más metros que el último renglón no tienen precio: agregue un renglón.',
    { afecta: ['rapida'],
      cols: {
        'hasta m': 'Metros hasta el punto más alejado que cubre el renglón (40 m incluye los 40 m).',
        importe: 'Lo que se suma por las bridas, en MXN sin IVA.',
      } });
  E('rapida.soporteria', 'Soportería automática',
    'Con qué se costean las ménsulas que la cotización rápida pone sola: una con su abrazadera cada 2.5 m (la separación horizontal de Proceso › Soportería › Espaciamiento) en los metros hasta el punto más alejado.',
    'La ménsula y la abrazadera se cotizan como dos partidas de soportería (material de la lista del proveedor, anclajes y minutos reales de taller), sin utilidad: la utilidad la suma la cotización rápida.',
    'Con 31 m son 13 ménsulas con su abrazadera, unos $343 cada una de costo directo: $4,456. La pestaña permite capturar otro importe o quitarla.',
    { afecta: ['rapida'] });
  E('rapida.soporteria.menula_barra', 'Barra de la ménsula',
    'La barra de la lista del proveedor de la que se corta cada ménsula.',
    'Se elige de la lista de barras. El taller: ángulo 1¼″ × 1/8″.',
    'Cambia el precio del material de las ménsulas.',
    { afecta: ['rapida'] });
  E('rapida.soporteria.menula_largo_mm', 'Largo de barra por ménsula',
    'Lo que se corta de la barra para una ménsula (brazo y pierna).',
    'En mm. El caso real: brazo y pierna de 650 mm, 1 300 mm.',
    'Más largo, más material por ménsula (y más barras en la compra).',
    { afecta: ['rapida'], tip: [400, 3000] });
  E('rapida.soporteria.menula_anclajes', 'Anclajes por ménsula',
    'Los anclajes (taquetes) con que se fija cada ménsula a la estructura; el artículo es el de Proceso › Soportería.',
    'Un número entero. El caso real: 4 taquetes de 3/8″.',
    'Cada anclaje suma su precio del catálogo de compras, sin IVA.',
    { afecta: ['rapida'], tip: [0, 8] });
  E('rapida.soporteria.menula_min', 'Minutos de taller por ménsula',
    'Lo que tarda el taller en hacer una ménsula: cortar, doblar, barrenar y puntear.',
    'En min reales (sin eficiencia). El taller: 7 ménsulas en 2 días (16 h) = 137 min cada una. 0 = el de Proceso › Soportería.',
    'Es lo que más pesa en la ménsula: 137 min a $62.50/h son unos $143 de mano de obra por pieza.',
    { afecta: ['rapida'], tip: [15, 240] });
  E('rapida.soporteria.abrazadera_barra', 'Barra de la abrazadera',
    'La barra de la que se corta cada abrazadera; su largo sale del diámetro máximo de la cotización rápida.',
    'Se elige de la lista de barras. Recomendado para cal. 22: tipo cuna de solera de 1″ × 1/8″ (su precio es aproximado).',
    'Cambia el precio del material de las abrazaderas.',
    { afecta: ['rapida'] });
  E('rapida.soporteria.abrazadera_vuelta', 'Vuelta de la abrazadera',
    'Si la abrazadera abraza media vuelta del tubo (cuna de 180°) o la vuelta completa (360°, dos mitades).',
    'MEDIA o COMPLETA. La completa lleva el doble de solera y cuatro orejas.',
    'La completa reparte mejor el peso en cal. 22, pero cuesta el doble de solera.',
    { afecta: ['rapida'] });
  E('rapida.soporteria.abrazadera_min', 'Minutos de taller por abrazadera',
    'Lo que tarda el taller en cortar, rolar, doblar las orejas y barrenar una abrazadera.',
    'En min reales. 15 min (el de Proceso › Soportería, ilustrativo). 0 = el de Proceso › Soportería.',
    'Sube la mano de obra de cada abrazadera.',
    { afecta: ['rapida'], tip: [5, 60] });

  /* ---------------------------------------- Precios ---------------------------------------- */
  const P = (clave, t, que, como, efecto, extra) => E(`precios.${clave}`, t, que, como, efecto, extra);
  P('precio_kg_acero_carbon', 'Precio del acero al carbón',
    'Precio por kg de lámina negra cuando el calibre pedido no está en la lista del proveedor.',
    'MXN por kg sin IVA. Sale de la lista: precio de la hoja ÷ 1.16 ÷ kg de la hoja (hoy ≈ $22.47).',
    'Sube o baja el costo de las piezas de acero al carbón cuyo calibre no está en la lista; las que sí están usan el precio de su hoja y no se mueven.',
    { afecta: ['mat'], tip: [12, 45] });
  P('precio_kg_acero_galvanizado', 'Precio del galvanizado',
    'Precio por kg de lámina galvanizada cuando el calibre pedido no está en la lista del proveedor.',
    'MXN por kg sin IVA. Promedio de la lista para cal. 22 y 24 (hoy ≈ $30.69).',
    'Mueve las piezas galvanizadas con calibre sin cotizar. Con cal. 22 y 24 (en la lista) no cambia nada.',
    { afecta: ['mat'], tip: [18, 60] });
  P('precio_kg_inox_304', 'Precio del inoxidable 304',
    'Precio por kg de lámina inox 304/304L. La lista del proveedor aún no trae inoxidable: todas las piezas inox lo usan.',
    'MXN por kg sin IVA, de la cotización del proveedor de inox. ILUSTRATIVO.',
    'Mueve en la misma proporción el material de toda pieza de inox 304: +10 % de precio ≈ +10 % de la lámina.',
    { afecta: ['mat'], tip: [60, 200] });
  P('precio_kg_inox_316', 'Precio del inoxidable 316',
    'Precio por kg de lámina inox 316/316L (aleación con molibdeno, más cara que la 304).',
    'MXN por kg sin IVA, de la cotización del proveedor. ILUSTRATIVO.',
    'Mueve el material de toda pieza de inox 316 en la misma proporción.',
    { afecta: ['mat'], tip: [80, 280] });
  P('precio_kg_chatarra_acero', 'Valor de la chatarra de acero',
    'Lo que se recupera por kg de recorte de acero al carbón o galvanizado.',
    'MXN por kg: lo que paga el chatarrero. Sólo cuenta si «recuperación de chatarra» (Pila de precio) es mayor que 0 %.',
    'Con recuperación en 0 % no hace nada. Con recuperación mayor, un precio más alto baja el costo del material (crédito por la merma).',
    { afecta: ['mat'], tip: [2, 15] });
  P('precio_kg_chatarra_inox', 'Valor de la chatarra de inox',
    'Lo que se recupera por kg de recorte de inoxidable (vale mucho más que el de acero al carbón).',
    'MXN por kg: lo que paga el chatarrero. Sólo cuenta si «recuperación de chatarra» es mayor que 0 %.',
    'Con recuperación en 0 % no hace nada. Con recuperación mayor, subirlo baja el costo del material de las piezas inox.',
    { afecta: ['mat'], tip: [15, 90] });
  P('precio_kg_perfil_angulo', 'Precio de los ángulos',
    'Precio por kg del ángulo para aros de brida cuando ese perfil no está en la lista del proveedor.',
    'MXN por kg sin IVA, promedio de los ángulos de la lista (hoy ≈ $25.25).',
    'Sólo mueve las bridas de ángulo sin precio en la lista. La brida estándar (solera) usa otra variable.',
    { afecta: ['mat'], tip: [15, 45] });
  P('precio_kg_solera', 'Precio de la solera',
    'Precio por kg de la solera de los aros de brida (1½″ × 3/16″ la estándar) si falta en la lista del proveedor.',
    'MXN por kg sin IVA (hoy ≈ $25.21: $250 la barra de 6 m con IVA).',
    'Mueve el costo de los aros de brida estándar sólo cuando la barra no tiene precio en la lista.',
    { afecta: ['mat'], tip: [15, 45] });
  P('precio_kg_alambre_er70s6', 'Alambre para soldar acero',
    'Alambre sólido ER70S-6 para soldar acero al carbón y galvanizado con MIG (GMAW).',
    'MXN por kg, el precio del carrete que compra el taller.',
    'Sube el costo de soldadura de las piezas de acero en proporción al cordón: kg de alambre = metal depositado ÷ eficiencia de deposición.',
    { afecta: ['cons'], tip: [40, 110] });
  P('precio_kg_varilla_er308l', 'Varilla para soldar inox 304',
    'Varilla de aporte ER308L para soldar inox 304/304L con TIG (GTAW).',
    'MXN por kg. ILUSTRATIVO: ponga el precio de su proveedor.',
    'Sube el costo de soldadura de las piezas inox 304.',
    { afecta: ['cons'], tip: [250, 800] });
  P('precio_kg_varilla_er316l', 'Varilla para soldar inox 316',
    'Varilla de aporte ER316L para soldar inox 316/316L con TIG (GTAW).',
    'MXN por kg. ILUSTRATIVO: ponga el precio de su proveedor.',
    'Sube el costo de soldadura de las piezas inox 316.',
    { afecta: ['cons'], tip: [300, 950] });
  P('precio_m3_gas_mezcla_ar_co2', 'Gas mezcla Ar/CO₂',
    'Gas de protección para soldar con MIG acero al carbón y galvanizado.',
    'MXN por m³ de gas. Divida el precio del cilindro entre sus m³ (un cilindro industrial rinde ≈ 8-9 m³). ILUSTRATIVO.',
    'Sube el costo de soldadura de acero: litros de gas = minutos de arco × flujo × (1 + pre y post-flujo).',
    { afecta: ['cons'], tip: [80, 300] });
  P('precio_m3_gas_argon', 'Argón puro',
    'Gas de protección para soldar con TIG el inoxidable.',
    'MXN por m³ de gas (precio del cilindro ÷ m³ que contiene). ILUSTRATIVO.',
    'Sube el costo de soldadura de las piezas de inox.',
    { afecta: ['cons'], tip: [100, 400] });
  P('precio_m_corte_guillotina', 'Desgaste de la guillotina',
    'Costo de consumibles (afilado y cuchillas) por cada metro de lámina cortado en guillotina.',
    'MXN por metro de corte. Cuesta centavos: ILUSTRATIVO, calcúlelo con el costo y la vida de las cuchillas.',
    'Mueve apenas el costo de corte de tramos rectos (por omisión se cortan en guillotina).',
    { afecta: ['cons'], tip: [0.05, 2] });
  P('precio_m_corte_plasma', 'Consumibles del plasma',
    'Electrodo, boquilla, gas y energía del plasma por cada metro cortado.',
    'MXN por metro de corte. ILUSTRATIVO: divida el costo del juego de consumibles entre los metros que rinde.',
    'Mueve el costo de corte de las piezas perfiladas (codos, reducciones, injertos), que por omisión se cortan con plasma.',
    { afecta: ['cons'], tip: [1, 12] });
  P('precio_m_corte_laser', 'Consumibles del láser',
    'Gas de asistencia, lentes y boquillas del láser por cada metro cortado.',
    'MXN por metro de corte. ILUSTRATIVO.',
    'Sólo cuenta si el corte perfilado o recto se cambió a LASER en el proceso.',
    { afecta: ['cons'], tip: [1, 10] });
  P('precio_m_empaque_neopreno', 'Empaque de neopreno',
    'Cinta de neopreno de 1½″ × 1/8″ que va entre las caras de cada junta bridada.',
    'MXN por metro de cinta. Cada brida lleva medio empaque (el otro medio es de la brida de enfrente).',
    'Sube el costo de todas las uniones con brida; más diámetro = más metros de empaque.',
    { afecta: ['mat'], tip: [8, 80] });
  P('precio_cartucho_sellador', 'Cartucho de sellador',
    'Cartucho de sellador para juntas (hoy Sikaflex blanco de 600 mL).',
    'MXN por cartucho, sin IVA ($459 con IVA → $395.69). El cálculo lo prorratea por mL con «tamaño del cartucho» de Herrajes.',
    'Sube el costo de las juntas que llevan sellador (espiga y clases de sellado). El gris de 600 mL cuesta $359 con IVA.',
    { afecta: ['mat'], tip: [100, 700] });
  P('precio_pza_autotaladrante', 'Tornillo autotaladrante',
    'Tornillo autotaladrante que fija las juntas de espiga.',
    'MXN por pieza.',
    'Sube el costo de las uniones de espiga; no afecta las bridadas.',
    { afecta: ['mat'], tip: [0.3, 4] });
  P('precio_juego_tornillo_5_16_x_1_1_4', 'Tornillo 5/16″ × 1¼″ (brida estándar)',
    'Un juego completo: tornillo hexagonal galvanizado 5/16″ × 1¼″, tuerca, rondana plana y rondana de presión. Es el de la brida estándar.',
    'MXN por juego, sin IVA: $1.72 + $0.75 + $0.60 + $0.60 = $3.67.',
    'Sube el costo de cada brida estándar en proporción a sus tornillos (uno cada ≈ 150 mm de perímetro, múltiplos de 4).',
    { afecta: ['mat'], tip: [1.5, 15] });
  P('precio_juego_tornillo_m8', 'Juego de tornillo M8',
    'Tornillo M8 con tuerca y rondanas, para bridas de ángulo de 1″.',
    'MXN por juego completo.',
    'Sólo mueve bridas de ángulo que usen ese tornillo.',
    { afecta: ['mat'], tip: [2, 20] });
  P('precio_juego_tornillo_m10', 'Juego de tornillo M10',
    'Tornillo M10 con tuerca y rondanas, para bridas de ángulo de 1½″ y 2″.',
    'MXN por juego completo.',
    'Sólo mueve bridas de ángulo que usen ese tornillo.',
    { afecta: ['mat'], tip: [3, 25] });
  P('precio_juego_tornillo_m12', 'Juego de tornillo M12',
    'Tornillo M12 con tuerca y rondanas, para bridas de ángulo de 2½″.',
    'MXN por juego completo.',
    'Sólo mueve bridas de ángulo que usen ese tornillo.',
    { afecta: ['mat'], tip: [4, 35] });
  P('precio_L_primario', 'Primario (litro)',
    'Pintura de fondo (anticorrosivo) para exterior.',
    'MXN por litro de pintura sin diluir.',
    'Sube el costo de pintura sólo en piezas que lleven primario (por regla, acero al carbón y bridas en exterior).',
    { afecta: ['cons'], tip: [80, 600] });
  P('precio_L_esmalte', 'Esmalte (litro)',
    'Pintura de acabado: la única mano de las piezas de interior y la segunda de las de exterior.',
    'MXN por litro de pintura sin diluir.',
    'Sube el costo de pintura de toda pieza que se pinte (acero al carbón y bridas de galvanizado).',
    { afecta: ['cons'], tip: [100, 700] });
  P('precio_L_diluyente', 'Diluyente (litro)',
    'Thinner para adelgazar la pintura al aplicarla.',
    'MXN por litro. La cantidad es un % de la pintura (campo «f diluyente» de Pintura).',
    'Cambia muy poco el precio: se usa un 10 % de la pintura.',
    { afecta: ['cons'], tip: [30, 200] });

  /* ---------------------------------------- Lista del proveedor ---------------------------------------- */
  E('proveedor.fecha', 'Fecha de la cotización',
    'El día en que el proveedor dio estos precios.',
    'Texto libre; use AAAA-MM-DD (por ejemplo 2026-09-30). Actualícela cada vez que cambie los precios de la lista.',
    'Sólo informa: no mueve ningún cálculo. Sirve para saber qué tan viejos son los precios al cotizar.',
    { afecta: ['info'] });
  E('proveedor.iva_incluido_pct', 'IVA que traen los precios',
    'Cuánto IVA ya está dentro de los precios de la lista.',
    'Escriba 16 si el proveedor cotiza con IVA incluido (así viene su factura) o 0 si capturó los precios antes de IVA.',
    'Cada precio se divide entre (1 + este %). Con 16 el acero sale ≈ 13.8 % más barato que con 0: un error aquí mueve todo el costo de lámina y de bridas.',
    { afecta: ['mat'], tip: [0, 16], ojo: 'No confunda con el IVA de la cotización (Pila de precio): ése es el que se suma al cliente al final.' });
  E('proveedor.hojas', 'Lámina en hoja',
    'Una hoja o placa por renglón, con su precio completo. El cotizador deduce el precio por kg dividiendo entre los kg de la hoja.',
    'Edite sólo el precio cotizado (con IVA). Para otro calibre o tamaño la lista es fija: se agrega desde un archivo de precios.',
    'Un precio mayor encarece las piezas de ese material y calibre (si hay varios tamaños, cuenta la hoja estándar del taller). Un precio en 0 no se usa.',
    { afecta: ['mat'],
      cols: {
        Concepto: 'Descripción de la hoja o placa tal como la cotiza el proveedor.',
        Hoja: 'Medidas de la hoja (ancho × largo).',
        'Precio cotizado (con IVA)': 'Lo que cuesta la hoja completa. ES LO ÚNICO QUE SE CAPTURA AQUÍ.',
        'Sin IVA': 'Precio ÷ (1 + IVA incluido). Se calcula solo.',
        'kg por hoja': 'Ancho × largo × espesor × densidad. Se calcula solo.',
        '$/kg sin IVA': 'Precio sin IVA ÷ kg de la hoja: el precio por kg que usa el cálculo.',
        Uso: '«Cálculo»: el cotizador toma este precio. «Referencia»: sólo se guarda (calibre o material que ninguna pieza usa todavía).',
      } });
  E('proveedor.barras', 'Perfiles y otros en barra',
    'Una barra por renglón (6 m), con su precio completo: solera y ángulo para bridas, y otros perfiles de referencia.',
    'Edite sólo el precio cotizado (con IVA). Las barras ligadas a un perfil de brida (columna Uso = «Cálculo») alimentan el costo de los aros.',
    'Un precio mayor encarece los aros de brida de ese perfil. El kg de la barra sale del peso del perfil × su largo; un precio en 0 no se usa.',
    { afecta: ['mat'],
      cols: {
        Concepto: 'Descripción del perfil tal como la cotiza el proveedor.',
        Barra: 'Largo de la barra (hoy 6 m).',
        'Precio cotizado (con IVA)': 'Lo que cuesta la barra completa. ES LO ÚNICO QUE SE CAPTURA AQUÍ.',
        'Sin IVA': 'Precio ÷ (1 + IVA incluido). Se calcula solo.',
        'kg por barra': 'Peso del perfil por metro × largo de la barra. Se calcula solo.',
        '$/kg sin IVA': 'Precio sin IVA ÷ kg de la barra: el precio por kg de los aros de ese perfil.',
        Uso: '«Cálculo»: el cotizador toma este precio para los aros de ese perfil. «Referencia»: sólo se guarda.',
      } });

  /* ---------------------------------------- Mano de obra ---------------------------------------- */
  E('mano_obra.FSR', 'Factor de Salario Real (FSR)',
    'Multiplicador del salario para cobrar en cada hora lo que se paga y no se trabaja y las prestaciones del trabajador (IMSS, INFONAVIT, aguinaldo, vacaciones…).',
    'Hoy 1.00: el taller cuesta la hora como el salario del día ÷ 8, sin prestaciones. 1.40 cobra los 7 días que se pagan por 5 trabajados; 1.6 a 1.9 suma además las prestaciones.',
    'Multiplica TODA la mano de obra. Con 1.40 cada hora cuesta 40 % más ($87.50): suben mano de obra, herramienta menor y el precio.',
    {
      afecta: ['mo'], tip: [1, 2.2], ej: 'Hora de $62.50 × FSR 1.40 = $87.50: lo que cuesta cada hora trabajada si la semana paga 7 días por 40 h.',
      ojo: 'Con 1.00, el sábado y el domingo que se pagan ($1,000 de cada $3,500) no los cobra ninguna hora: tienen que salir de los indirectos. No lo use para «meter utilidad»: la utilidad va en la Pila de precio.',
    });
  E('mano_obra.jornada', 'Jornada',
    'Cuántas horas tiene el día con que el salario por día se vuelve costo por hora.',
    'Las horas de un día de trabajo (hoy 8).',
    'Hora = salario por día ÷ horas por día × FSR. Más horas por día = hora más barata.',
    { afecta: ['mo'] });
  E('mano_obra.jornada.horas_dia', 'Horas por día',
    'Las horas que se trabajan en un día de jornada.',
    'En horas (hoy 8). También es el día de la cuadrilla de instalación si la partida no dice otro.',
    'Más horas por día = hora más barata y días de instalación más largos: con 9 h la hora baja de $62.50 a $55.56.',
    { afecta: ['mo'], tip: [6, 12] });
  E('mano_obra.operaciones', 'Tarifas por operación',
    'Una tarifa para cada operación del taller (corte, rolado, armado, aros, soldadura, engargolado, barrenado, acabado, pintura, inspección) y para la instalación en obra.',
    'Cada operación lleva salario por día y costo de equipo por hora. Hoy el salario es de $500 por día en todas.',
    'Cada hora de una operación se cobra con su tarifa; las operaciones con muchas horas (soldadura, armado) pesan más en el precio.',
    { afecta: ['mo', 'eq'] });
  E('mano_obra.operaciones.*', 'Tarifa de {0}',
    'La tarifa por hora de esta operación: salario del personal y costo de la máquina.',
    'Un renglón por operación del taller. Si dos operaciones comparten personal y equipo, repita la misma tarifa.',
    'Cambia sólo el costo de las horas de esta operación.',
    { afecta: ['mo', 'eq'], nom: OPERACIONES });
  E('mano_obra.operaciones.*.salario_diario', 'Salario por día · {0}',
    'Lo que gana por día el personal de esta operación, sin utilidades ni prestaciones.',
    'MXN por día. Hoy $500 en todas ($3,500 a la semana ÷ 7). Capture otro si esta operación la hace personal de otro nivel (un soldador, un ayudante).',
    'Sube o baja en la misma proporción el costo de mano de obra de esta operación: la hora es este salario ÷ 8 h × FSR.',
    { afecta: ['mo'], tip: [250, 2000], nom: OPERACIONES, ej: '$500 por día = $62.50 por hora; 1 h de soldadura cuesta $62.50 de mano de obra más su equipo.' });
  E('mano_obra.operaciones.*.equipo_h', 'Costo del equipo por hora · {0}',
    'Lo que cuesta cada hora de usar la máquina de esta operación: depreciación, energía y mantenimiento.',
    'MXN por hora de máquina = (inversión ÷ horas útiles al año) + energía + mantenimiento. ILUSTRATIVO. Use 0 si no hay máquina.',
    'Sube el costo de esta operación en proporción a sus horas. En inspección y en instalación está en 0 (sin máquina propia).',
    { afecta: ['eq'], tip: [0, 400], nom: OPERACIONES });

  /* ---------------------------------------- Merma ---------------------------------------- */
  E('merma.*', 'Merma · {0}',
    'La parte de la lámina (o del perfil) comprada que NO queda en esta familia de piezas.',
    'En %, menor que 100. Mídala pesando recortes contra lámina usada. Más curvas e injertos = más merma.',
    'Material comprado = material de la pieza ÷ (1 − merma). Cada punto de merma sube ≈ 1.3 % el material de la familia (a 20 %).',
    { afecta: ['mat', 'peso'], tip: [0, 45], nom: FAMILIAS,
      esp: {
        RECTO: 'El tramo recto es el que menos desperdicia: las yardas salen del ancho completo de la hoja.',
        CODO: 'Los gajos del codo se cortan en cuñas y dejan recorte entre ellos.',
        REDUCCION: 'El desarrollo del cono deja un sector curvo de recorte.',
        TRANSICION: 'Pasar de redondo a rectangular deja mucho recorte por la forma alabeada.',
        RAMAL: 'El injerto simple pierde lámina por la silleta (la boca) del cuerpo y del ramal.',
        REDUCCION_INJERTO: 'Cono con injerto: tiene recortes de cono, de silleta y de ramal juntos.',
        PANTALON: 'Familia retirada: sólo se usa para abrir cotizaciones anteriores.',
        PERSONALIZADO: 'Piezas capturadas por el usuario con su propia geometría.',
        PERFIL: 'Se aplica a los aros de brida (perfil rolado): el recorte es el corte de cada aro.',
      } });

  /* ---------------------------------------- Pila de precio ---------------------------------------- */
  const C = (clave, t, que, como, efecto, extra) => E(`capas.${clave}`, t, que, como, efecto, extra);
  C('herramienta_menor_pct_mo', 'Herramienta menor',
    'Discos, brocas, guantes y herramienta de mano que se gasta al trabajar, como % de la mano de obra.',
    'En %. Típico de 2 a 5 % de la mano de obra.',
    'Suma ese % del costo de mano de obra al costo directo. Con 3 %, cada $1 000 de mano de obra agrega $30.',
    { afecta: ['mo'], tip: [0, 10] });
  C('flete_material_pct', 'Flete de material',
    'Lo que cuesta traer el acero al taller, como % del costo de lámina y perfiles.',
    'En %. Típico de 1 a 4 % si el proveedor no entrega gratis.',
    'Suma ese % al costo de la lámina y los aros. Con 2 %, cada $1 000 de acero agrega $20.',
    { afecta: ['mat'], tip: [0, 8] });
  C('recuperacion_chatarra_pct', 'Recuperación de chatarra',
    'Qué fracción de la merma se vende como chatarra. Con 0 % la merma se tira (así se cotiza hoy).',
    'En %. Use 0 si el recorte no se vende o se usa en otra obra. Si lo vende, ponga el % que realmente recupera.',
    'Resta del material el valor de la chatarra recuperada (precio de chatarra × kg de merma × este %). Baja el precio; con 0 no hace nada.',
    { afecta: ['mat'], tip: [0, 100] });
  C('gif_por_hora_instalacion', 'Indirectos por hora de instalación',
    'Gastos indirectos que se reparten por cada hora de la cuadrilla en obra (supervisión, vehículo, herramienta mayor). La nave no se usa.',
    'MXN por hora-hombre en obra. Hoy 0: la instalación sólo carga administración, imprevistos, financiamiento y utilidad.',
    'Suma este monto por cada hora de la cuadrilla. Con $40/h, 2 personas × 5 días × 8 h suman $3,200 de indirectos.',
    { afecta: ['ci'], tip: [0, 300] });
  C('gif_por_hora_mod', 'Indirectos de fábrica por hora de taller',
    'Gastos indirectos de fabricación (renta, luz, supervisión, depreciación general) que se reparten por cada hora de mano de obra directa.',
    'MXN por hora de trabajo directo. Cálculo: indirectos mensuales de la nave ÷ horas directas trabajadas al mes. ILUSTRATIVO.',
    'Suma este monto por cada hora de taller que lleve la pieza. Pasar de $85 a $120 encarece más las piezas que más horas llevan.',
    { afecta: ['ci'], tip: [0, 300] });
  C('administracion_pct_cd', 'Administración',
    'Gastos de oficina y administración como % del costo directo.',
    'En %. Típico de 5 a 12 %: gastos generales de oficina ÷ ventas.',
    'Suma ese % del costo directo a los indirectos. Cada punto sube el costo de la pieza ≈ 1 % del directo.',
    { afecta: ['ci'], tip: [0, 25], ojo: 'Si el encabezado de la cotización trae su propia «Administración», se usa ésa.' });
  E('capas.imprevistos_pct', 'Imprevistos por nivel de riesgo',
    'Un porcentaje de imprevistos para cada nivel de riesgo de la obra (bajo, medio, alto).',
    'El riesgo se elige en el encabezado de cada cotización. Mantenga BAJO ≤ MEDIO ≤ ALTO.',
    'Sólo cambia el precio de las cotizaciones del nivel de riesgo que modifique.',
    { afecta: ['imp'] });
  E('capas.financiamiento', 'Financiamiento',
    'El costo de financiar la obra mientras el cliente no paga: tasa anual y días de cobro.',
    'Tasa anual en % y días de cobro. Cada cotización puede traer sus propios valores en el encabezado.',
    'Costo financiero = costo × tasa × días ÷ 365. Más días o más tasa = precio más alto.',
    { afecta: ['fin'] });
  C('imprevistos_pct.*', 'Imprevistos · riesgo {0}',
    'Colchón por lo que no se pudo prever (retrabajos, errores, cambios de obra), como % del costo directo más indirectos. Se elige con el riesgo de la cotización.',
    'En %. Entre más riesgosa la obra, mayor el porcentaje: BAJO ≤ MEDIO ≤ ALTO.',
    'Sólo se mueve el precio de las cotizaciones con ese nivel de riesgo. Cada punto sube el costo ≈ 1 % de (directo + indirectos).',
    { afecta: ['imp'], tip: [0, 20], nom: { BAJO: 'bajo', MEDIO: 'medio', ALTO: 'alto' } });
  C('financiamiento.tasa_anual', 'Tasa de financiamiento anual',
    'Lo que cuesta financiar la obra mientras el cliente no paga (tasa anual de su crédito o costo de oportunidad).',
    'En % anual. Se combina con los días de cobro: costo = tasa × días ÷ 365.',
    'Suma al costo la fracción tasa × días ÷ 365. Con 14 % y 45 días suma 1.73 % al costo.',
    { afecta: ['fin'], tip: [0, 45], ojo: 'Si el encabezado de la cotización trae su propia tasa o días de cobro, se usan ésos.' });
  C('financiamiento.dias_cobro', 'Días de cobro',
    'Cuántos días tarda en pagarle el cliente, en promedio.',
    'En días. Es el dato de arranque de las cotizaciones nuevas; cada una puede traer el suyo en su encabezado.',
    'Más días = más costo de financiamiento y precio más alto. 45 días con 14 % anual suman 1.73 %.',
    { afecta: ['fin'], tip: [0, 120] });
  C('utilidad_pct_precio', 'Utilidad',
    'La ganancia que busca en la venta, como % DEL PRECIO (margen), no del costo.',
    'En %. Margen de 20 % significa que de cada $100 de venta, $20 son utilidad.',
    'Precio = costo ÷ (1 − utilidad − comisión − otros). De 20 % a 25 % el precio sube ≈ 6.8 % (no 5 %).',
    { afecta: ['util'], tip: [0, 50], ej: 'Costo $800 con utilidad 20 % y comisión 2 %: precio = 800 ÷ 0.78 = $1 025.64.', ojo: 'Si el encabezado de la cotización trae su propio margen, se usa ése en ella.' });
  C('comision_ventas_pct_precio', 'Comisión de ventas',
    'La comisión del vendedor, como % del precio de venta.',
    'En %. Típico de 1 a 5 %. Use 0 si no paga comisión.',
    'Se resta del precio de venta igual que la utilidad: cada punto sube el precio ≈ 1.3 %.',
    { afecta: ['util'], tip: [0, 10] });
  C('otros_pct_precio', 'Otros cargos sobre el precio',
    'Cualquier otro cargo que sea % del precio de venta (fianza, cuota, regalía…).',
    'En %. Déjelo en 0 si no aplica.',
    'Funciona como otra comisión: se resta del precio de venta; cada punto sube el precio ≈ 1.3 %.',
    { afecta: ['util'], tip: [0, 10], ojo: 'Utilidad + comisión + otros debe ser menor que 100 %, o el cotizador no puede calcular.' });
  C('iva_pct', 'IVA',
    'El impuesto que se suma al total ya con utilidad.',
    'En %. En México 16 % (8 % en franja fronteriza si aplica).',
    'No mueve el precio antes de IVA ni la utilidad: sólo cambia el IVA y el total que paga el cliente.',
    { afecta: ['iva'], tip: [0, 16] });
  C('cargo_minimo_partida', 'Cargo mínimo por partida',
    'El precio más bajo que se cobra por una partida (compensa el trabajo fijo de preparar una pieza pequeña).',
    'MXN por partida completa (todas sus piezas), antes de IVA. Ponga 0 para no cobrar mínimo.',
    'Si el precio de una partida resulta menor, se cobra este mínimo en su lugar. No cambia las partidas más caras.',
    { afecta: ['util'], tip: [0, 2000] });

  /* ---------------------------------------- Materiales ---------------------------------------- */
  E('materiales.*', 'Ficha de {0}',
    'Todo lo que el cálculo necesita saber del material: densidad, tabla de calibres, a qué precios apunta, cómo se suelda y qué pintura lleva.',
    'Cada campo se explica con su botón ⓘ. Los nombres de precio se eligen de la lista y los sistemas de pintura también.',
    'Cambia sólo las piezas hechas de este material.',
    { afecta: ['mat', 'cons', 'mo'], nom: MATERIALES });
  E('materiales.*.nombre', 'Nombre del material · {0}',
    'El nombre con que aparece el material en las listas y en la propuesta.',
    'Texto libre.',
    'No cambia ningún cálculo.',
    { nom: MATERIALES, afecta: ['info'] });
  E('materiales.*.norma', 'Norma de referencia · {0}',
    'La norma del material (ASTM) como referencia para el cliente y la inspección.',
    'Texto libre. Ponga la norma de su certificado.',
    'No cambia ningún cálculo.',
    { nom: MATERIALES, afecta: ['info'] });
  E('materiales.*.tabla_calibre', 'Tabla de calibres · {0}',
    'Qué tabla de «Espesor por calibre» usa este material para convertir un calibre en milímetros.',
    'Se elige de la lista: MSG para acero al carbón, GSG para galvanizado, USSG para inoxidable.',
    'Cambia el espesor de cada calibre y con él el peso, la soldadura y las velocidades. El mismo calibre 16 pesa ≈ 6 % menos en MSG que en GSG.',
    { nom: MATERIALES, afecta: ['peso', 'mat', 'mo'] });
  E('materiales.*.densidad_kg_m3', 'Densidad · {0}',
    'Masa de un metro cúbico del material.',
    'kg/m³. Acero al carbón y galvanizado 7 850; inox 304 ≈ 7 930; inox 316 ≈ 7 980 (certificado del proveedor).',
    'Cambia los kilos de cada pieza (peso, embalaje, subcontratos por kg). La lámina de la lista casi no se mueve: su precio por kg se calcula con esta misma densidad.',
    { nom: MATERIALES, afecta: ['peso'], tip: [7000, 8500] });
  E('materiales.*.precio_ref', 'Precio por kg de respaldo · {0}',
    'La variable de «Precios» que da el precio por kg de este material cuando el calibre no está en la lista del proveedor.',
    'Se elige de la lista de precios. Normalmente va el de su mismo material.',
    'Cambiar la variable cambia el precio de las piezas de este material que no están en la lista del proveedor.',
    { nom: MATERIALES, afecta: ['mat'] });
  E('materiales.*.chatarra_ref', 'Precio de la chatarra · {0}',
    'La variable de «Precios» con el valor del recorte de este material.',
    'Se elige de la lista de precios (chatarra de acero o de inox).',
    'Sólo cuenta si «recuperación de chatarra» es mayor que 0 %.',
    { nom: MATERIALES, afecta: ['mat'] });
  E('materiales.*.proceso_sold', 'Proceso de soldadura · {0}',
    'Con qué proceso se suelda este material. Define velocidad, gas, eficiencia y factor de operación.',
    'Se elige de la lista de «Soldadura» en Proceso: MIG (GMAW) para acero, TIG (GTAW) para inox.',
    'TIG es más lento (≈ la mitad de velocidad) y usa varilla y argón: cambiar un material a TIG sube sus horas y su consumo de soldadura.',
    { nom: MATERIALES, afecta: ['mo', 'cons'] });
  E('materiales.*.costura', 'Costura de la lámina · {0}',
    'Cómo se cierran las costuras y se unen las piezas de lámina de este material: soldadas o engargoladas.',
    'Se elige de la lista de costuras de Proceso. El taller engargola siempre el galvanizado (Pittsburgh); el acero al carbón y el inoxidable se sueldan a tope.',
    'Engargolada: lo que en otro material se suelda (codos, reducciones, transiciones, injertos, armado de piezas) se engargola: horas de engargolado en vez de soldadura, su holgura en la lámina y sellador en las juntas. En el tramo recto es la costura por omisión.',
    { nom: MATERIALES, afecta: ['mat', 'mo', 'cons'], ej: 'Galvanizado: Engargolado Pittsburgh. Acero al carbón: Soldada a tope.' });
  E('materiales.*.brida_al_ducto', 'Cómo se fija la brida al ducto · {0}',
    'Si la brida se suelda al ducto o se le hace una ceja: el aro se mete en el ducto y al extremo del ducto se le dobla una ceja para que no se salga; luego se sella con su otra pieza.',
    'Se elige de la lista. El taller pone con ceja las bridas del galvanizado (las de solera y las de placa); el acero al carbón y el inoxidable, soldadas.',
    'Con ceja no hay filete aro–ducto (ni su alambre, gas y acabado): cada brida suma el tiempo de la ceja en el armado y la franja de lámina que se dobla («Lámina de la ceja»).',
    { nom: MATERIALES, afecta: ['mo', 'cons', 'mat'], opc: { SOLDADA: 'Soldada: un cordón de filete del aro al ducto.', CEJA: 'Con ceja: sin soldadura; el ducto se dobla sobre la brida.' } });
  E('materiales.*.alambre_ref', 'Alambre o varilla de aporte · {0}',
    'La variable de «Precios» del alambre o varilla con que se suelda este material.',
    'Se elige de la lista de precios. Debe corresponder al proceso de soldadura (alambre para MIG, varilla para TIG).',
    'Cambia el costo del metal de aporte de las piezas de este material.',
    { nom: MATERIALES, afecta: ['cons'] });
  E('materiales.*.gas_ref', 'Gas de protección · {0}',
    'La variable de «Precios» del gas con que se suelda este material.',
    'Se elige de la lista de precios (mezcla Ar/CO₂ para MIG, argón para TIG).',
    'Cambia el costo del gas de las piezas de este material.',
    { nom: MATERIALES, afecta: ['cons'] });
  E('materiales.*.f_sold', 'Factor de dificultad de soldadura · {0}',
    'Multiplicador del tiempo de soldar este material: 1.00 es lo normal; más de 1 es más difícil.',
    'Sin unidad. El galvanizado lleva 1.2 porque el zinc humea y pide más limpieza; el acero al carbón es la referencia (1.0).',
    'Multiplica las horas de soldadura de este material. De 1.0 a 1.2 sube 20 % el tiempo de soldar (y el acabado, que depende de él).',
    { nom: MATERIALES, afecta: ['mo'], tip: [0.8, 2] });
  E('materiales.*.f_acabado', 'Factor de acabado · {0}',
    'Cuánto tiempo de acabado (esmerilado, limpieza, decapado) lleva la pieza por cada minuto de soldadura.',
    'Sin unidad. 0.25 = 15 min de acabado por 1 h de soldadura. El inox pide más (0.6) porque se pule y se decapa.',
    'Multiplica las horas de acabado de este material. Cada 0.1 suma 6 min de acabado por hora de soldadura.',
    { nom: MATERIALES, afecta: ['mo'], tip: [0, 1.5] });
  E('materiales.*.pintura_cuerpo', 'Pintura del ducto · {0}',
    'Qué pintura lleva la lámina de este material, según el lugar de instalación.',
    'Elija un sistema para INTERIOR y otro para EXTERIOR. «Sin pintura» deja el ducto tal cual.',
    'Cambia la mano de obra de preparación y aplicación y el consumo de pintura de las piezas de este material.',
    { afecta: ['mo', 'cons'], nom: MATERIALES });
  E('materiales.*.pintura_bridas', 'Pintura de las bridas · {0}',
    'Qué pintura llevan los aros de brida de este material, según el lugar de instalación.',
    'Elija un sistema para INTERIOR y otro para EXTERIOR. Las bridas son de solera negra, aunque el ducto sea galvanizado.',
    'Cambia la preparación y aplicación de pintura sobre los aros y su consumo.',
    { afecta: ['mo', 'cons'], nom: MATERIALES });
  const OPC_PINTURA = {
    NINGUNA: 'No se pinta: sin mano de obra ni pintura.',
    ESMALTE: 'Una mano de esmalte (acabado). Es lo usual en interior.',
    PRIMARIO: 'Sólo primario anticorrosivo.',
    PRIMARIO_ESMALTE: 'Primario y esmalte (dos manos). Es lo usual en exterior.',
  };
  E('materiales.*.pintura_cuerpo.*', 'Pintura del ducto · {0} · en {1}',
    'El sistema de pintura que lleva el ducto de este material cuando se instala en esta ubicación.',
    'Se elige de la lista. INTERIOR = bajo techo; EXTERIOR = a la intemperie. El cotizador toma el que corresponda a la ubicación de la cotización o de la partida.',
    'Cada mano suma tiempo de aplicación por m² y litros de pintura; la preparación se hace una sola vez. Con «Sin pintura» desaparece todo ese costo.',
    { afecta: ['mo', 'cons'], nom: { ...MATERIALES, INTERIOR: 'interior', EXTERIOR: 'exterior' }, opc: OPC_PINTURA });
  E('materiales.*.pintura_bridas.*', 'Pintura de las bridas · {0} · en {1}',
    'El sistema de pintura que llevan los aros de brida de este material cuando se instalan en esta ubicación.',
    'Se elige de la lista. En el galvanizado el ducto no se pinta, pero las bridas (solera negra) sí.',
    'Cambia la preparación, aplicación y consumo de pintura sobre la superficie de los aros (incluidos los sueltos).',
    { afecta: ['mo', 'cons'], nom: { ...MATERIALES, INTERIOR: 'interior', EXTERIOR: 'exterior' }, opc: OPC_PINTURA });

  /* ---------------------------------------- Calibres y servicios ---------------------------------------- */
  E('calibres.*', 'Tabla de calibres {0}',
    'Los espesores en pulgadas de cada calibre en la familia de calibres {0}.',
    'Un renglón por calibre. Se llena con los valores de la norma o del certificado del proveedor.',
    'Los materiales que usan esta tabla cambian de peso, soldadura y tiempos si se modifica un renglón.',
    { afecta: ['peso', 'mat', 'mo'], nom: { MSG: 'MSG (acero al carbón)', GSG: 'GSG (galvanizado)', USSG: 'USSG (inoxidable)' } });
  E('calibres.*.*', 'Calibre {1} · tabla {0}',
    'Espesor nominal del calibre {1} en la tabla {0}.',
    'En pulgadas con 4 decimales; a menor número de calibre, más grueso. Tome el valor de la norma o del certificado del proveedor.',
    'Cambia el peso (+10 % de espesor = +10 % de kg de lámina), el área a soldar y las velocidades de corte, rolado y soldadura.',
    { afecta: ['peso', 'mat', 'mo'], tip: [0.005, 0.25], ej: 'Cal. 16 MSG = 0.0598 in = 1.52 mm.' });
  E('servicios.*', 'Calibre mínimo · servicio {0}',
    'Una tabla de «hasta qué diámetro, qué calibre más delgado se permite» para el servicio {0}.',
    'Ordene los renglones de menor a mayor diámetro. El último renglón (99 999 mm) es el «de ahí en adelante».',
    'No cambia precios. Cuando una partida usa un calibre más delgado que el que dice la tabla, aparece un aviso en su detalle.',
    { afecta: ['info'], nom: { VENTILACION: 'ventilación', POLVO: 'polvo', ABRASIVO: 'abrasivo' },
      cols: {
        'hasta mm': 'Diámetro (o dimensión mayor) hasta el cual aplica el renglón, en mm.',
        'calibre max': 'El calibre más delgado permitido. Mayor número de calibre = lámina más delgada.',
      } });

  /* ---------------------------------------- Proceso ---------------------------------------- */
  E('proceso.eficiencia_taller', 'Eficiencia del taller',
    'Qué parte de una hora pagada se trabaja de verdad (el resto son traslados, esperas y descansos).',
    'Fracción de 0 a 1 (0.80 = 80 %). Los tiempos de la tabla son estándar; el cotizador los divide entre este valor para obtener horas reales. 0.80 es típico.',
    'Menos eficiencia = más horas reales. Bajar de 0.80 a 0.70 sube ≈ 14 % las horas, la mano de obra, el equipo y los indirectos por hora.',
    { afecta: ['mo', 'eq', 'ci'], tip: [0.4, 1], ej: '60 min estándar ÷ 0.80 = 75 min reales pagados.' });
  E('proceso.hoja', 'Hoja estándar del taller',
    'Las medidas de la hoja de lámina con la que el taller trabaja normalmente.',
    'Ancho y largo en mm. Hoy 1 219 × 3 048 (4 × 10 ft).',
    'Define qué hoja de la lista del proveedor se toma como precio y cuántas hojas equivalen a una pieza (para el manejo de hoja en el corte).',
    { afecta: ['mat', 'mo'] });
  E('proceso.hoja.ancho_mm', 'Ancho de la hoja',
    'El ancho de la hoja estándar de lámina del taller.',
    'En mm. 1 219 mm = 4 ft. Debe coincidir con el ancho de la hoja de la lista del proveedor.',
    'Cambia cuántas hojas equivalen a una pieza y qué renglón de la lista se usa como precio.',
    { afecta: ['mat', 'mo'], tip: [900, 1600] });
  E('proceso.hoja.largo_mm', 'Largo de la hoja',
    'El largo de la hoja estándar de lámina del taller.',
    'En mm. 3 048 mm = 10 ft. Debe coincidir con la hoja de la lista del proveedor; también es el largo máximo de una plantilla.',
    'Cambia cuántas hojas equivalen a una pieza y qué renglón de la lista se toma como precio. Si una plantilla excede este largo, el cotizador avisa.',
    { afecta: ['mat', 'mo'], tip: [2000, 6100] });

  E('proceso.armado_yardas', 'Armado por yardas',
    'Cómo se arma el tramo recto: en anillos («yardas») del ancho de la lámina, hasta cierto número por pieza, y un tramo de ajuste al final.',
    'Se define qué anchos de yarda se ofrecen, cuál es la de arranque, cuántas yardas caben por pieza y qué lleva el extremo de ajuste.',
    'Cambia cuántas piezas, uniones entre yardas, bridas y soldadura lleva cada tramo recto.',
    { afecta: ['mat', 'mo', 'geo'] });
  E('proceso.armado_yardas.yardas_mm', 'Anchos de yarda disponibles',
    'Los anchos de lámina que el ingeniero puede elegir para fabricar el tramo recto (3 ft y 4 ft).',
    'Cada renglón es un ancho de yarda en mm. Debe estar entre los límites de yarda (300 a 2 000 mm).',
    'Cambia las opciones del selector «Yarda» al cotizar. Una cotización existente que usaba un ancho que ya no está se conserva tal cual.',
    { afecta: ['geo', 'lim'] });
  E('proceso.armado_yardas.yardas_mm.*', 'Ancho de yarda #{0}',
    'Uno de los anchos de yarda que se ofrecen al cotizar el tramo recto.',
    'En mm. 914 = 3 ft; 1 220 = 4 ft (la lámina estándar). Debe estar entre los límites de yarda.',
    'Cambia ese ancho en el selector de «Yarda»: más ancho = menos anillos por tramo, menos juntas y menos bridas.',
    { afecta: ['geo', 'mo'], tip: [600, 1500] });
  E('proceso.armado_yardas.yarda_defecto_mm', 'Yarda por omisión',
    'El ancho de yarda que se usa cuando la cotización no elige uno.',
    'En mm. Debe ser uno de los anchos de la lista de arriba (hoy 1 220).',
    'Cambia el ancho de yarda de toda cotización que no lo elija: más ancho = menos anillos, juntas y bridas.',
    { afecta: ['geo', 'mo'], tip: [600, 1500] });
  E('proceso.armado_yardas.yardas_por_pieza_max', 'Yardas por pieza',
    'Cuántas yardas se engargolan entre sí en una misma pieza antes de ponerle bridas.',
    'Número entero. 3 es lo que el taller maneja (3 yardas de 1 220 mm = 3.66 m por pieza).',
    'Más yardas por pieza = menos piezas y menos bridas, pero piezas más largas y más pesadas de manejar.',
    { afecta: ['mat', 'mo', 'geo'], tip: [1, 6] });
  E('proceso.armado_yardas.ajuste_tolerancia_mm', 'Tolerancia del tramo de ajuste',
    'Cuánto puede sobrar o faltar de largo antes de considerarlo un tramo de ajuste aparte.',
    'En mm. Con 25, un tramo de 2 735 mm son 3 yardas de 914 y no 2 yardas más un ajuste.',
    'Una tolerancia mayor evita tramos de ajuste muy cortos; menor los genera más seguido.',
    { afecta: ['geo'], tip: [0, 100] });
  E('proceso.armado_yardas.junta_entre_yardas', 'Junta entre yardas',
    'Cómo se unen las yardas de una misma pieza: se elige de las costuras de la tabla «Costuras».',
    'Se elige de la lista. El taller las engargola (Pittsburgh). Una costura soldada las soldaría.',
    'Cambia el tiempo de engargolado o soldadura y el material perdido en cada junta.',
    { afecta: ['mo', 'mat'] });
  E('proceso.armado_yardas.extremo_ajuste_defecto', 'Extremo del tramo de ajuste',
    'Qué se cotiza en el extremo libre del tramo de ajuste (el que se corta a la medida en obra).',
    'Se elige de la lista. La partida puede pedir otro. Hoy el taller manda la brida suelta.',
    'Cambia cuántas bridas, tornillos y soldadura incluye el precio del tramo recto con ajuste.',
    { afecta: ['mat', 'mo'],
      opc: {
        SUELTA: 'Aro de brida terminado (rolado, cierre soldado, barrenado, pintado), tornillos y empaque; sin soldarlo al ducto.',
        SIN_BRIDA: 'Nada: el extremo no lleva brida en este precio.',
        CON_BRIDA: 'Brida fabricada y soldada en el taller, como en los demás extremos.',
      } });

  E('proceso.semiangulo_max_deg', 'Semiángulo máximo del cono',
    'La inclinación máxima de la pared de una reducción o transición para que el flujo no se separe.',
    'En grados. 15° es lo usual en ductos de aire: una reducción más corta que esto se ve «brusca».',
    'No cambia el precio por sí solo: si el cono de una pieza excede este ángulo, el cotizador avisa que conviene alargarla.',
    { afecta: ['info', 'geo'], tip: [5, 30] });
  E('proceso.alfa_max_junta_deg', 'Ángulo máximo por gajo del codo',
    'El mayor giro que se permite en cada junta entre gajos de un codo.',
    'En grados. 22.5° es la regla usual: un codo de 90° lleva 5 gajos (4 juntas).',
    'Menor ángulo = más gajos = codo más liso, pero con más cortes, soldadura y merma. Con 15° un codo de 90° lleva 7 gajos.',
    { afecta: ['mat', 'mo', 'geo'], tip: [10, 30] });
  E('proceso.k_R_defecto', 'Radio del codo (R/D)',
    'La relación entre el radio de giro del codo y su diámetro, cuando no se captura.',
    'Sin unidad. 1.5 es lo usual para ductos de polvo; entre más grande, más abierta la curva y más lámina.',
    'Un codo con radio mayor es más largo y gasta más lámina, soldadura y tiempo; el radio chico pierde más presión.',
    { afecta: ['mat', 'mo', 'geo'], tip: [0.75, 3] });
  E('proceso.beta_ramal_defecto_deg', 'Ángulo del injerto por omisión',
    'El ángulo con el que entra un injerto cuando la partida no lo pide.',
    'En grados. Debe ser uno de los «ángulos de injerto» permitidos (30° o 45°).',
    'Cambia la forma del desarrollo del injerto y su soldadura de toda partida que no capture el ángulo.',
    { afecta: ['geo', 'mat', 'mo'], tip: [30, 45] });
  E('proceso.angulos_injerto_deg', 'Ángulos de injerto permitidos',
    'Los ángulos con los que el taller fabrica injertos; el cotizador rechaza cualquier otro.',
    'Cada renglón es un ángulo en grados.',
    'Cambia las opciones del selector «Ángulo» de un injerto. No altera cotizaciones ya capturadas con un ángulo que ya no esté.',
    { afecta: ['lim', 'geo'] });
  E('proceso.angulos_injerto_deg.*', 'Ángulo de injerto #{0}',
    'Uno de los ángulos de injerto que el taller sabe fabricar.',
    'En grados, de 1 a 89. El taller usa 30° y 45°.',
    'Agrega o quita esa opción en el selector de injertos al cotizar.',
    { afecta: ['lim', 'geo'], tip: [15, 60] });
  E('proceso.angulos_codo_deg', 'Ángulos de codo permitidos',
    'Los ángulos con los que el taller fabrica codos; el cotizador rechaza cualquier otro.',
    'Cada renglón es un ángulo en grados.',
    'Cambia las opciones del selector «Ángulo» de un codo.',
    { afecta: ['lim', 'geo'] });
  E('proceso.angulos_codo_deg.*', 'Ángulo de codo #{0}',
    'Uno de los ángulos de codo que el taller sabe fabricar.',
    'En grados, de 1 a 180. El taller usa 30°, 45°, 60° y 90°.',
    'Agrega o quita esa opción en el selector de codos al cotizar.',
    { afecta: ['lim', 'geo'], tip: [15, 120] });
  E('proceso.injerto_largo_extra_mm', 'Largo extra del injerto',
    'El tramo recto que se agrega al injerto, más allá de su lado más largo, cuando no se captura su largo.',
    'En mm. 150 deja un tramo para poner la brida o el siguiente ducto.',
    'Un injerto más largo gasta más lámina y tiempo; sólo afecta partidas que no capturan el largo del ramal.',
    { afecta: ['mat', 'mo', 'geo'], tip: [0, 500] });
  E('proceso.injerto_margen_cono_mm', 'Margen del injerto en el cono',
    'La holgura entre la boca del injerto y cada extremo del cono, en una reducción con injerto.',
    'En mm. 25 evita que el injerto se encime con la costura o la brida.',
    'Más margen acorta el espacio útil del cono; un injerto grande puede ya no caber y el cotizador pide alargar la reducción.',
    { afecta: ['geo'], tip: [0, 100] });
  E('proceso.injerto_inclinado_hacia', 'Hacia dónde se inclina el injerto',
    'En la reducción con injerto, hacia qué extremo se inclina el ramal.',
    'Se elige de la lista. El taller siempre inclina el injerto del extremo mayor al menor: déjelo en «MENOR».',
    'Cambia la geometría del injerto (el cotizador ya no pide este dato por partida).',
    { afecta: ['geo'], opc: { MENOR: 'Hacia el extremo menor (D2): el injerto va de mayor a menor. Así se fabrica.', MAYOR: 'Hacia el extremo mayor (D1): sólo para pruebas.' } });
  E('proceso.k_entrepierna', 'Entrepierna del pantalón',
    'Dato de la familia retirada «Pantalón»: holgura en la entrepierna.',
    'No se usa en cotizaciones nuevas. Déjelo como está.',
    'Sólo afecta cotizaciones antiguas con pantalón.',
    { afecta: ['info'], tip: [0, 0.5] });
  E('proceso.tolerancia_area_pantalon', 'Tolerancia de área del pantalón',
    'Dato de la familia retirada «Pantalón»: diferencia permitida entre el área del tronco y la de las dos ramas.',
    'No se usa en cotizaciones nuevas. Déjelo como está.',
    'Sólo afecta cotizaciones antiguas con pantalón.',
    { afecta: ['info'], tip: [0, 0.5] });

  E('proceso.limites', 'Límites de captura',
    'El rango de lo que el cotizador acepta como dato de una partida (cantidades, diámetros, largos, espesores).',
    'Cada renglón tiene un mínimo y un máximo. Los de arranque sirven para casi todo ducto; amplíelos sólo si el taller fabrica fuera de ese rango.',
    'No cambian precios: protegen de un cero de más al teclear. Si una partida cae fuera, se rechaza con un mensaje que dice qué límite excedió.',
    { afecta: ['lim'] });
  E('proceso.limites.*', 'Límite · {0}',
    'Un tope de captura que protege de errores al teclear una partida.',
    'Mínimo y máximo van en parejas (sección, largo, espesor, yarda). Debe cumplirse mínimo < máximo.',
    'No mueve precios: sólo decide si una partida se acepta. Un máximo muy alto deja pasar errores de dedo.',
    { afecta: ['lim'],
      tipEsp: {
        cantidad_max: [1, 1000000], seccion_min_mm: [1, 200], seccion_max_mm: [1000, 20000], largo_min_mm: [1, 500], largo_max_mm: [1000, 1000000],
        espesor_min_mm: [0.05, 2], espesor_max_mm: [5, 200], piezas_max: [10, 100000], yarda_min_mm: [100, 900], yarda_max_mm: [1220, 6000],
      },
      nom: {
        cantidad_max: 'cantidad máxima', seccion_min_mm: 'sección mínima', seccion_max_mm: 'sección máxima', largo_min_mm: 'largo mínimo', largo_max_mm: 'largo máximo',
        espesor_min_mm: 'espesor mínimo', espesor_max_mm: 'espesor máximo', piezas_max: 'piezas máximas', yarda_min_mm: 'yarda mínima', yarda_max_mm: 'yarda máxima',
      },
      esp: {
        cantidad_max: 'Piezas máximas por partida. Atrapa un cero de más en la cantidad.',
        seccion_min_mm: 'Diámetro o lado nominal más chico que se acepta (mm).',
        seccion_max_mm: 'Diámetro o lado nominal más grande que se acepta (mm).',
        largo_min_mm: 'Longitud más corta que se captura: tramo, injerto, tangente (mm).',
        largo_max_mm: 'Longitud más larga que se captura (mm). 100 000 mm = 100 m.',
        espesor_min_mm: 'Espesor mínimo de una placa de espesor propio (mm).',
        espesor_max_mm: 'Espesor máximo de una placa de espesor propio (mm).',
        piezas_max: 'Anillos (yardas) y piezas de un tramo recto, o piezas a armar de una pieza personalizada.',
        yarda_min_mm: 'Ancho de yarda más angosto que se acepta (mm).',
        yarda_max_mm: 'Ancho de yarda más ancho que se acepta (mm).',
      } });

  E('proceso.costuras', 'Costuras y juntas',
    'Las formas de cerrar una pieza o unir yardas: soldada a tope, soldada a traslape o engargolada (Pittsburgh).',
    'Cada costura dice cuánta lámina «gasta» (holgura), si se suelda y con qué cordón.',
    'Cambia el desarrollo de la pieza (más holgura = más lámina), la soldadura y el engargolado de las piezas que usan esa costura.',
    { afecta: ['mat', 'mo', 'geo'] });
  E('proceso.costuras.*', 'Costura {0}',
    'Una manera de cerrar el ducto: cuánta lámina consume y cómo se hace.',
    'Cada campo se explica con su botón ⓘ.',
    'Se mueve sólo lo que use esta costura (el tipo de costura se elige en cada partida; el engargolado se usa también entre yardas).',
    { afecta: ['mat', 'mo'], nom: { A_TOPE: 'a tope', TRASLAPE: 'a traslape', PITTSBURGH: 'Pittsburgh' } });
  E('proceso.costuras.*.nombre', 'Nombre de la costura · {0}',
    'Cómo se llama la costura en las listas de captura.',
    'Texto libre.',
    'No cambia ningún cálculo.',
    { nom: { A_TOPE: 'a tope', TRASLAPE: 'a traslape', PITTSBURGH: 'Pittsburgh' }, afecta: ['info'] });
  E('proceso.costuras.*.allowance_mm', 'Holgura de la costura ({0})',
    'Lámina extra que se agrega al desarrollo para poder hacer esta costura (el traslape o el pliegue del engargolado).',
    'En mm por costura. A tope ≈ 1; traslape ≈ 25; Pittsburgh ≈ 32.',
    'Aumenta el ancho de cada plantilla: +10 mm de holgura en un ducto de Ø300 agrega ≈ 1 % de lámina por anillo.',
    { afecta: ['mat', 'geo'], tip: [0, 60], nom: { A_TOPE: 'a tope', TRASLAPE: 'a traslape', PITTSBURGH: 'Pittsburgh' } });
  E('proceso.costuras.*.soldada', 'La costura se suelda ({0})',
    'Si esta costura se cierra con soldadura (Sí) o de forma mecánica (No).',
    'Se elige Sí o No. A tope y traslape se sueldan; Pittsburgh se engargola.',
    'En «Sí» suma metros de soldadura al cálculo; en «No» suma engargolado. Cambia horas, gas y alambre.',
    { afecta: ['mo', 'cons'], nom: { A_TOPE: 'a tope', TRASLAPE: 'a traslape', PITTSBURGH: 'Pittsburgh' }, opc: { true: 'Sí: se cierra con soldadura.', false: 'No: se cierra mecánicamente (engargolado).' } });
  E('proceso.costuras.*.cordon', 'Tipo de cordón ({0})',
    'Qué cordón de soldadura lleva la costura cuando se suelda: a tope o de filete.',
    'Se elige de la lista. Sin cordón si la costura no se suelda.',
    'El cordón a tope pide más metal depositado (1.75 veces) que el de filete: sube alambre, gas y tiempo de arco.',
    { afecta: ['cons', 'mo'], nom: { A_TOPE: 'a tope', TRASLAPE: 'a traslape', PITTSBURGH: 'Pittsburgh' }, opc: { TOPE: 'Cordón a tope: más metal depositado.', FILETE: 'Cordón de filete: el de referencia.', '': 'Sin cordón: la costura no se suelda.' } });

  E('proceso.corte', 'Corte',
    'Cómo se corta la lámina: manejo de la hoja, programación, máquina de corte y velocidades por espesor.',
    'Tiempos en minutos, velocidades en m/min por espesor y el consumible por metro cortado.',
    'Cambia las horas de corte y su costo de consumibles en todas las piezas.',
    { afecta: ['mo', 'eq', 'cons'] });
  E('proceso.corte.t_manejo_hoja_min', 'Manejo de la hoja',
    'Minutos para cargar, posicionar y descargar una hoja completa en la máquina de corte.',
    'En min por hoja. Cronometre mover una hoja de 4 × 10 ft con el montacargas o grúa.',
    'Se multiplica por la fracción de hoja que usa cada pieza. Más minutos = más horas de corte en todo.',
    { afecta: ['mo', 'eq'], tip: [1, 15] });
  E('proceso.corte.t_prog_cnc_min', 'Programación del corte CNC',
    'Minutos de preparación (programa, material, arranque) cada vez que se usa plasma o láser en una partida.',
    'En min por partida. No se cobra en guillotina.',
    'Suma estos minutos una vez por partida con plasma o láser (codos, reducciones, injertos): pesa más en partidas chicas.',
    { afecta: ['mo', 'eq'], tip: [0, 30] });
  E('proceso.corte.proceso_recto', 'Máquina para tramos rectos',
    'Con qué máquina se cortan las plantillas del tramo recto (rectángulos).',
    'Se elige de la lista (GUILLOTINA, PLASMA, LASER). La guillotina es la más rápida y barata para cortes rectos.',
    'Cambia velocidad de corte, consumible por metro y programación de todos los tramos rectos.',
    { afecta: ['mo', 'eq', 'cons'], opc: { GUILLOTINA: 'Rápida y barata; sólo cortes rectos.', PLASMA: 'Cortes de cualquier forma; más lenta y con consumibles.', LASER: 'Cortes de cualquier forma; muy rápida y de equipo caro.' } });
  E('proceso.corte.proceso_perfilado', 'Máquina para piezas perfiladas',
    'Con qué máquina se cortan las piezas de forma (codos, reducciones, transiciones, injertos).',
    'Se elige de la lista (PLASMA o LASER). La guillotina no corta curvas.',
    'Cambia velocidad de corte, consumible por metro y programación de todas las piezas perfiladas.',
    { afecta: ['mo', 'eq', 'cons'], opc: { GUILLOTINA: 'No sirve para perfilar curvas.', PLASMA: 'La usual para lámina de calibres medios y gruesos.', LASER: 'Más rápida y precisa; equipo y consumibles más caros.' } });
  E('proceso.corte.v_m_min', 'Velocidades de corte',
    'Una tabla de velocidad por espesor para cada máquina de corte: guillotina, plasma y láser.',
    'Cada tabla es una máquina. Sólo cuentan las que se eligen como máquina de corte arriba.',
    'Cambia las horas de corte de las piezas que se cortan con esa máquina.',
    { afecta: ['mo', 'eq'] });
  E('proceso.corte.v_m_min.*', 'Velocidad de corte · {0}',
    'Qué tan rápido corta esta máquina, según el espesor de la lámina.',
    'Cada renglón es un espesor (mm) y su velocidad (m/min). El cotizador interpola entre renglones; fuera de rango usa el extremo. Ordene por espesor creciente.',
    'Más velocidad = menos minutos de corte. Subir 20 % la velocidad baja ≈ 17 % el tiempo de corte (sin contar el manejo de hoja).',
    { afecta: ['mo', 'eq'], nom: { GUILLOTINA: 'guillotina', PLASMA: 'plasma', LASER: 'láser' },
      cols: { 'Espesor (mm)': 'Espesor de lámina de este renglón, en mm.', 'Velocidad (m/min)': 'Metros de corte por minuto con ese espesor.' } });
  E('proceso.corte.consumible_ref', 'Consumibles de corte',
    'A qué variable de «Precios» apunta el costo por metro de cada máquina de corte.',
    'Cada máquina se liga a una variable de precio.',
    'Cambia el costo de consumibles de corte de las piezas que usan esa máquina.',
    { afecta: ['cons'] });
  E('proceso.corte.consumible_ref.*', 'Consumible de corte · {0}',
    'La variable de «Precios» con el costo por metro cortado con esta máquina.',
    'Se elige de la lista de precios.',
    'Cambia qué precio de consumible se aplica a cada metro de corte de esa máquina.',
    { afecta: ['cons'], nom: { GUILLOTINA: 'guillotina', PLASMA: 'plasma', LASER: 'láser' } });

  E('proceso.rolado', 'Rolado y plegado',
    'Cómo se rola o pliega la lámina para formar el ducto: tiempo fijo, pasadas, factor para conos y velocidad.',
    'Tiempo fijo en minutos por virola, número de pasadas por la roladora y velocidad en m/min por espesor.',
    'Cambia las horas de rolado de toda pieza que se enrolle.',
    { afecta: ['mo', 'eq'] });
  E('proceso.rolado.t_fijo_min', 'Tiempo fijo de rolado',
    'Minutos de acomodo y retiro de cada virola (cada anillo o cilindro rolado), sin contar el rolado en sí.',
    'En min por virola. Cronometre meter la lámina, ajustar la roladora y sacar el cilindro.',
    'Suma estos minutos a cada anillo: pesa en piezas con muchas yardas o virolas chicas.',
    { afecta: ['mo', 'eq'], tip: [0.5, 10] });
  E('proceso.rolado.n_pasadas', 'Pasadas de rolado',
    'Cuántas veces pasa la lámina por la roladora para quedar cilíndrica.',
    'Número de pasadas (3 es lo usual).',
    'Multiplica el tiempo de rolado: de 3 a 4 pasadas sube ≈ 33 % el tiempo de rolar (sin el tiempo fijo).',
    { afecta: ['mo', 'eq'], tip: [1, 8] });
  E('proceso.rolado.n_pasadas_plegado', 'Pasadas de plegado',
    'Cuántas pasadas lleva una pieza que se pliega en lugar de rolarse (secciones rectangulares).',
    'Número de pasadas (4 es lo usual: una por cada lado).',
    'Multiplica el tiempo de formado de las secciones rectangulares y de la transición.',
    { afecta: ['mo', 'eq'], tip: [1, 10] });
  E('proceso.rolado.k_conico', 'Factor de rolado cónico',
    'Cuánto más cuesta rolar un cono que un cilindro de la misma longitud: el cono se rola de a poco.',
    'Sin unidad. 1.0 = igual que un cilindro; 1.6 es lo usual.',
    'Multiplica el tiempo de rolado de reducciones y transiciones. De 1.6 a 2.0 sube 25 % ese tiempo.',
    { afecta: ['mo', 'eq'], tip: [1, 3] });
  E('proceso.rolado.v_m_min', 'Velocidad de rolado',
    'Qué tan rápido rola la máquina, según el espesor de la lámina.',
    'Cada renglón es un espesor (mm) y su velocidad (m/min), ordenados por espesor. El cotizador interpola.',
    'Más velocidad = menos minutos de rolado: +20 % de velocidad baja ≈ 17 % el tiempo (sin el tiempo fijo).',
    { afecta: ['mo', 'eq'], cols: { 'Espesor (mm)': 'Espesor de lámina de este renglón, en mm.', 'Velocidad (m/min)': 'Metros de lámina rolados por minuto con ese espesor.' } });

  E('proceso.armado', 'Armado y punteo',
    'Cuánto tarda armar las piezas: acomodar, puntear las juntas, poner los aros, tornillos y espigas.',
    'Tiempos en minutos y un factor de dificultad por familia.',
    'Cambia las horas de armado de todo lo que se ensambla.',
    { afecta: ['mo', 'eq'] });
  E('proceso.armado.t_fijo_pieza_min', 'Tiempo fijo por pieza',
    'Minutos de preparación y acomodo de cada pieza antes de unir sus partes.',
    'En min por pieza.',
    'Se multiplica por el número de piezas y por el factor de dificultad de la familia.',
    { afecta: ['mo', 'eq'], tip: [1, 20] });
  E('proceso.armado.t_junta_base_min', 'Base por junta',
    'Minutos de puntear cada junta entre yardas o gajos, sin importar el diámetro.',
    'En min por junta.',
    'Junto con «min por metro» define el tiempo de cada junta: una base mayor pesa más en diámetros chicos.',
    { afecta: ['mo', 'eq'], tip: [0.5, 10] });
  E('proceso.armado.t_junta_por_m_min', 'Minutos por metro de junta',
    'Minutos por metro de diámetro para puntear una junta (una junta grande lleva más punteo).',
    'En min por metro de diámetro de referencia.',
    'Cada junta cuesta base + este valor × diámetro (m). Pesa más en ductos de diámetro grande.',
    { afecta: ['mo', 'eq'], tip: [1, 20] });
  E('proceso.armado.t_ajuste_aro_min', 'Ajuste de cada aro',
    'Minutos de centrar, ajustar y puntear cada aro de brida sobre el ducto.',
    'En min por aro. No aplica a los aros sueltos (no se arman al ducto).',
    'Se multiplica por el número de aros armados de la pieza: con 4 min y 2 bridas suma 8 min por pieza.',
    { afecta: ['mo', 'eq'], tip: [1, 15] });
  E('proceso.armado.t_ceja_aro_min', 'Ceja de cada brida (fijo)',
    'Minutos de hacerle la ceja al extremo del ducto con la brida ya metida, por cada brida que no se suelda (materiales con brida «con ceja», como el galvanizado).',
    'En min por brida, además del ajuste del aro. Valor supuesto: 2 min; tómelo de una pieza real.',
    'Se suma al armado por cada brida con ceja (sin el factor de dificultad de la familia: es una operación en la boca), en lugar de soldar el aro al ducto.',
    { afecta: ['mo', 'eq'], tip: [0, 30] });
  E('proceso.armado.t_ceja_aro_min_m', 'Ceja de cada brida (por metro)',
    'Minutos por metro de perímetro de la ceja: una ceja grande lleva más tiempo.',
    'En min por metro de perímetro exterior del ducto. Valor supuesto: 3 min/m.',
    'Cada ceja cuesta el fijo más este valor × perímetro (m): pesa más en diámetros grandes.',
    { afecta: ['mo', 'eq'], tip: [0, 20] });
  E('proceso.armado.t_fijacion_min', 'Poner cada fijación',
    'Minutos de poner un tornillo autotaladrante en una junta de espiga.',
    'En min por fijación.',
    'Sólo afecta uniones de espiga: se multiplica por el número de tornillos de cada junta.',
    { afecta: ['mo', 'eq'], tip: [0.1, 2] });
  E('proceso.armado.t_formado_espiga_min', 'Formar cada espiga',
    'Minutos de formar el macho de una junta de espiga.',
    'En min por espiga.',
    'Sólo afecta uniones de espiga.',
    { afecta: ['mo', 'eq'], tip: [0.5, 10] });
  E('proceso.armado.k_dif', 'Dificultad de armado por familia',
    'Un factor por familia de pieza que multiplica el tiempo de armado: el tramo recto vale 1.00 y lo más complicado, hasta 1.9.',
    'Compare con el tramo recto: si una familia tarda el doble en armarse, ponga 2.0.',
    'Cada factor mueve las horas de armado de su familia y de ninguna otra.',
    { afecta: ['mo', 'eq'] });
  E('proceso.armado.k_dif.*', 'Dificultad de armado · {0}',
    'Cuánto más difícil es armar esta familia de pieza que un tramo recto (que vale 1.00).',
    'Sin unidad: 1.00 = igual que el recto; más de 1 = más difícil.',
    'Multiplica todo el tiempo de armado de la familia: de 1.35 a 1.50 en codos sube ≈ 11 % su armado.',
    { afecta: ['mo', 'eq'], tip: [0.5, 3], nom: FAMILIAS,
      esp: {
        RECTO: 'Es la referencia (1.00): el tramo recto es lo más fácil de armar.',
        CODO: 'Los gajos del codo exigen escuadrar cada junta antes de puntear.',
        REDUCCION: 'El cono pide cuidado en el alineado de las bocas.',
        TRANSICION: 'Pasar de redondo a rectangular es de las piezas más trabajosas.',
        RAMAL: 'La silleta del injerto se ajusta a mano al cuerpo.',
        REDUCCION_INJERTO: 'Cono con injerto: la pieza más difícil de armar.',
        PANTALON: 'Familia retirada: sólo para cotizaciones anteriores.',
        PERSONALIZADO: 'Piezas propias: se toma como un recto.',
      } });

  E('proceso.aros', 'Aros de brida',
    'Los tiempos de fabricar los aros de brida: preparar, rolar y la holgura de corte.',
    'Tiempos en min por aro o por metro de aro, y holgura en mm. Calibrados con el taller: 30 bridas de 9″ a 11″ llevan 4 días.',
    'Cambia las horas de aros (y un poco el material) de todas las piezas con brida.',
    { afecta: ['mo', 'eq', 'mat'] });
  E('proceso.aros.t_fijo_aro_min', 'Tiempo fijo por aro',
    'Minutos de cada aro además del rolado: cortar la solera, quitar las puntas, ajustar el cierre y aplanar el aro.',
    'En min por aro (estándar). Calibrado con el taller junto con el rolado y el barrenado.',
    'Se multiplica por el número de aros, armados y sueltos: más aros = más horas de aros.',
    { afecta: ['mo', 'eq'], tip: [1, 30] });
  E('proceso.aros.t_roll_aro_min_m', 'Rolado del aro por metro',
    'Minutos por metro de solera para rolarla «de canto»: varias pasadas, revisar contra la plantilla y enderezar.',
    'En min por metro de aro (estándar). Calibrado con el taller: rolar de canto es lo que más tarda.',
    'Aros de mayor diámetro llevan más metros: este valor pesa más en bridas grandes.',
    { afecta: ['mo', 'eq'], tip: [0.5, 40] });
  E('proceso.aros.puntas_rolado_mm', 'Puntas que no se rolan',
    'El tramo recto que la roladora no alcanza a curvar en las dos puntas de la solera: se corta y se pierde.',
    'En mm por aro (las dos puntas juntas). Con 126 mm la solera de un aro redondo es la de la regla del taller, π × (D + 81 mm). No aplica a marcos rectangulares.',
    'Alarga la solera de cada aro redondo: con 126 mm una brida de 11″ lleva 1 132 mm en vez de 1 006 mm (+12.5 % de solera).',
    { afecta: ['mat', 'peso'], tip: [0, 250] });
  E('proceso.aros.holgura_corte_mm', 'Holgura de corte del aro',
    'Longitud extra que se corta de más en cada aro por el corte y el cierre de la soldadura.',
    'En mm por aro.',
    'Alarga la barra de cada aro: 3 mm en un aro de Ø300 agrega 0.3 % de solera.',
    { afecta: ['mat', 'peso'], tip: [0, 15] });
  E('proceso.barrenado', 'Barrenado',
    'El tiempo de barrenar los aros de brida.',
    'Un solo dato: minutos por barreno.',
    'Se multiplica por el número de barrenos de todas las bridas.',
    { afecta: ['mo', 'eq'] });
  E('proceso.barrenado.t_barreno_min', 'Tiempo por barreno',
    'Minutos de marcar, puntear, barrenar y rebabear cada agujero de tornillo en los aros.',
    'En min por barreno (estándar). Calibrado con el taller: 2 min.',
    'Se multiplica por el número de barrenos: una brida de 11″ lleva 8 (16 min).',
    { afecta: ['mo', 'eq'], tip: [0.1, 5] });
  E('proceso.engargolado', 'Engargolado',
    'El tiempo de cerrar costuras con engargolado Pittsburgh (en la costura longitudinal o entre yardas).',
    'Un tiempo fijo por operación y una velocidad por espesor.',
    'Cambia las horas de engargolado de las piezas con costura o junta engargolada.',
    { afecta: ['mo', 'eq'] });
  E('proceso.engargolado.t_fijo_pieza_min', 'Tiempo fijo de engargolado',
    'Minutos de preparar y acomodar cada pieza en la engargoladora, sin contar el engargolado en sí.',
    'En min por operación de engargolado.',
    'Suma estos minutos a cada pieza o costura engargolada (como la junta entre yardas).',
    { afecta: ['mo', 'eq'], tip: [0.5, 8] });
  E('proceso.engargolado.v_m_min', 'Velocidad de engargolado',
    'Qué tan rápido engargola la máquina, según el espesor de la lámina.',
    'Cada renglón es un espesor (mm) y su velocidad (m/min), ordenados por espesor. El cotizador interpola.',
    'Más velocidad = menos minutos de engargolado: +20 % de velocidad baja ≈ 17 % ese tiempo.',
    { afecta: ['mo', 'eq'], cols: { 'Espesor (mm)': 'Espesor de lámina de este renglón, en mm.', 'Velocidad (m/min)': 'Metros de costura engargolados por minuto con ese espesor.' } });

  E('proceso.soldadura', 'Soldadura',
    'Cómo se suelda: datos de cada proceso (MIG, TIG), velocidad por espesor, tamaño de cordón y densidad del depósito.',
    'Velocidades en m/min, factores de operación y eficiencias que salen del taller y del fabricante del equipo.',
    'Cambia horas de soldadura, alambre y gas de toda pieza soldada.',
    { afecta: ['mo', 'eq', 'cons'] });
  E('proceso.soldadura.procesos', 'Procesos de soldadura',
    'Las fichas de los procesos disponibles: MIG (GMAW) para acero y TIG (GTAW) para inoxidable.',
    'Cada material elige su proceso en su ficha de «Materiales».',
    'Cada proceso cambia velocidad, consumo de gas y rendimiento del alambre de los materiales que lo usan.',
    { afecta: ['mo', 'cons'] });
  E('proceso.soldadura.procesos.*', 'Proceso {0}',
    'Parámetros de este proceso de soldadura: velocidad relativa, tiempo de arco, gas y rendimiento.',
    'Cada campo se explica con su botón ⓘ.',
    'Cambia las piezas cuyos materiales usan este proceso.',
    { afecta: ['mo', 'cons'], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.procesos.*.v_mult', 'Velocidad relativa · {0}',
    'Qué tan rápido suelda este proceso respecto de la tabla de velocidades (que es de MIG = 1.0).',
    'Sin unidad. MIG = 1.0; TIG ≈ 0.5 (la mitad de rápido).',
    'Divide el tiempo de arco: 0.5 duplica las horas de soldar respecto de 1.0.',
    { afecta: ['mo'], tip: [0.2, 2], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.procesos.*.FO', 'Factor de operación · {0}',
    'De cada hora de soldador, qué fracción hay arco encendido (el resto es acomodar, limpiar y cambiar de posición).',
    'En fracción (no en %): 0.4 = 40 % del tiempo hay arco. MIG manual ≈ 0.3 a 0.5.',
    'El tiempo pagado = tiempo de arco ÷ FO. Bajar de 0.40 a 0.30 sube ≈ 33 % las horas de soldadura.',
    { afecta: ['mo'], tip: [0.15, 0.8], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.procesos.*.Q_gas_L_min', 'Flujo de gas · {0}',
    'Litros por minuto de gas protector mientras hay arco.',
    'En L/min. MIG ≈ 12 a 18; TIG ≈ 6 a 12.',
    'Multiplica los litros de gas: más flujo = más gas por metro de cordón.',
    { afecta: ['cons'], tip: [4, 30], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.procesos.*.eta_dep', 'Eficiencia de deposición · {0}',
    'Qué parte del alambre o varilla que se gasta queda en el cordón (el resto salpica o se pierde).',
    'En fracción de 0 a 1: MIG ≈ 0.93; TIG ≈ 0.98. Debe ser mayor que 0.',
    'kg de alambre = metal depositado ÷ eficiencia. Con 0.80 en vez de 0.93 se compra ≈ 16 % más alambre.',
    { afecta: ['cons'], tip: [0.5, 1], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.procesos.*.f_pre_post', 'Pre y post-flujo · {0}',
    'Gas extra que corre antes y después del arco para proteger el charco, como fracción del tiempo de arco.',
    'En fracción: 0.1 = 10 % más gas que el tiempo de arco.',
    'Multiplica el gas por (1 + este valor). Cambia poco el costo total.',
    { afecta: ['cons'], tip: [0, 0.5], nom: { GMAW: 'MIG (GMAW)', GTAW: 'TIG (GTAW)' } });
  E('proceso.soldadura.v_m_min', 'Velocidad de soldadura (MIG)',
    'Qué tan rápido avanza el soldador con el proceso de referencia (MIG), según el espesor de la lámina.',
    'Cada renglón es un espesor (mm) y su velocidad (m/min). Más grueso = más lento. El cotizador interpola.',
    'Más velocidad = menos tiempo de arco y menos gas: +20 % de velocidad baja ≈ 17 % el tiempo de arco.',
    { afecta: ['mo', 'cons'], cols: { 'Espesor (mm)': 'Espesor de lámina de este renglón, en mm.', 'Velocidad (m/min)': 'Metros de cordón por minuto con ese espesor (en MIG).' } });
  E('proceso.soldadura.k_cordon', 'Tamaño del cordón',
    'Cuánto metal deposita cada tipo de cordón (a tope o de filete) comparado con un cuadrado del espesor de la lámina.',
    'Un factor por tipo de cordón: el filete es 1.0 y el tope lleva más.',
    'Cambia el alambre y el gas de las costuras de ese tipo.',
    { afecta: ['cons'] });
  E('proceso.soldadura.k_cordon.*', 'Tamaño del cordón · {0}',
    'El tamaño del cordón respecto del cuadrado del espesor de la lámina: define cuánto metal se deposita por metro.',
    'Sin unidad. Filete = 1.0; a tope = 1.75 (un cordón a tope lleva más metal).',
    'Multiplica el metal depositado (y con él alambre y gas): de 1.75 a 2.0 en el tope sube ≈ 14 % el alambre de las costuras a tope.',
    { afecta: ['cons'], tip: [0.5, 3], nom: { TOPE: 'cordón a tope', FILETE: 'cordón de filete' } });
  E('proceso.soldadura.A_cordon_min_mm2', 'Sección mínima del cordón',
    'El área mínima de un cordón, aunque la lámina sea muy delgada.',
    'En mm². Evita que en calibres delgados el cálculo dé un cordón de casi cero.',
    'Sólo cuenta en láminas delgadas (≈ cal. 18 o más delgadas): sube el alambre y el gas ahí.',
    { afecta: ['cons'], tip: [0.5, 8] });
  E('proceso.soldadura.rho_dep_g_cm3', 'Densidad del depósito',
    'Masa de un cm³ de metal depositado por la soldadura (acero ≈ 7.85).',
    'En g/cm³. Casi nunca se cambia.',
    'Convierte volumen de cordón en gramos de alambre: +1 % = +1 % de alambre.',
    { afecta: ['cons'], tip: [7, 8.5] });

  E('proceso.pintura', 'Pintura',
    'Tiempos de preparar y aplicar, lugar de instalación por omisión, qué manos lleva cada sistema, y rendimiento de cada pintura.',
    'Qué lleva cada material y ubicación está en «Materiales»; aquí se definen los sistemas y las pinturas.',
    'Cambia las horas de pintura y los litros de pintura de toda superficie que se pinte.',
    { afecta: ['mo', 'cons'] });
  E('proceso.pintura.t_prep_min_m2', 'Preparación de superficie',
    'Minutos por m² de limpiar o lijar antes de pintar.',
    'En min por m². Se hace una vez por parte que se pinta (ducto o bridas), sin importar cuántas manos lleve.',
    'Multiplica el área pintada: +1 min/m² sube ≈ 14 % la mano de obra de pintura de una sola mano.',
    { afecta: ['mo'], tip: [1, 15] });
  E('proceso.pintura.t_aplic_min_m2', 'Aplicación por mano',
    'Minutos por m² de aplicar cada mano de pintura.',
    'En min por m² y por mano. El primario y el esmalte cuentan cada uno.',
    'Multiplica el área × número de manos: un sistema de dos manos tarda el doble de aplicación que uno de una.',
    { afecta: ['mo'], tip: [1, 12] });
  E('proceso.pintura.ubicacion_defecto', 'Ubicación por omisión',
    'Dónde se instala el ducto cuando la cotización o la partida no lo dice: bajo techo (interior) o a la intemperie (exterior).',
    'Se elige de la lista. Es sólo el dato de arranque de las cotizaciones nuevas.',
    'Cambia qué sistema de pintura se aplica a las cotizaciones que no elijan ubicación: en exterior lleva primario además del esmalte.',
    { afecta: ['mo', 'cons'], opc: { INTERIOR: 'Bajo techo: basta una mano de esmalte.', EXTERIOR: 'A la intemperie: primario y esmalte.' } });
  E('proceso.pintura.sistemas', 'Sistemas de pintura',
    'Las «recetas» de pintura: qué manos lleva cada sistema (sin pintura, esmalte, primario, primario + esmalte).',
    'Cada sistema es una lista de manos; cada mano es una de las pinturas definidas en «Capas».',
    'Cambiar las manos de un sistema cambia las piezas cuyo material lo use (se elige en «Materiales»).',
    { afecta: ['mo', 'cons'] });
  E('proceso.pintura.sistemas.*', 'Sistema {0}',
    'Las manos de pintura que lleva este sistema, en orden de aplicación.',
    'Cada renglón es una mano y se elige entre las pinturas definidas en «Capas». Sin renglones = sin pintura.',
    'Más manos = más litros y más minutos de aplicación por m² (la preparación se hace una sola vez).',
    { afecta: ['mo', 'cons'], nom: SISTEMAS });
  E('proceso.pintura.sistemas.*.*', 'Mano #{1} · {0}',
    'Una de las manos de este sistema de pintura.',
    'Se elige una pintura de la lista de «Capas» (primario o esmalte).',
    'Cambia el tipo de pintura de esa mano: el precio y el rendimiento de la otra pintura.',
    { afecta: ['cons'], nom: SISTEMAS });
  E('proceso.pintura.capas', 'Pinturas (capas)',
    'Los datos de cada pintura: sólidos, espesor de película seca y eficiencia de aplicación. De ahí salen los litros.',
    'Un bloque por pintura, con los datos de su ficha técnica.',
    'Cambia el rendimiento (m² por litro) y con él el consumo y el costo de pintura.',
    { afecta: ['cons'] });
  E('proceso.pintura.capas.*', 'Pintura {0}',
    'Los datos de ficha técnica de esta pintura.',
    'Sólidos por volumen y espesor seco los da el fabricante; la eficiencia de transferencia depende de cómo se aplica (brocha, pistola).',
    'Cambia el rendimiento de la pintura: litros = área × espesor ÷ (sólidos × eficiencia).',
    { afecta: ['cons'], nom: { primario: 'primario', esmalte: 'esmalte' } });
  E('proceso.pintura.capas.*.sv_pct', 'Sólidos por volumen · {0}',
    'Qué porcentaje de la pintura líquida queda como película seca (el resto se evapora).',
    'En % (NO es fracción). Está en la ficha técnica: típico de 40 a 65 %.',
    'Más sólidos rinden más: subir de 45 % a 55 % baja ≈ 18 % los litros de esta pintura.',
    { afecta: ['cons'], tip: [20, 90], nom: { primario: 'primario', esmalte: 'esmalte' } });
  E('proceso.pintura.capas.*.dft_um', 'Espesor de película seca · {0}',
    'El espesor que debe quedar seco en cada mano, en micras (µm).',
    'En µm. Lo recomienda el fabricante: primario ≈ 50, esmalte ≈ 40.',
    'Más espesor = más pintura: +10 µm en un esmalte de 40 sube ≈ 25 % sus litros.',
    { afecta: ['cons'], tip: [20, 150], nom: { primario: 'primario', esmalte: 'esmalte' } });
  E('proceso.pintura.capas.*.eta_transf', 'Eficiencia de transferencia · {0}',
    'Qué parte de la pintura aplicada se queda en la pieza (el resto se pierde en el aire o en el piso).',
    'En fracción de 0 a 1: pistola convencional ≈ 0.5 a 0.65; brocha o rodillo ≈ 0.85 a 0.95. Debe ser mayor que 0.',
    'Menos eficiencia = más pintura: bajar de 0.65 a 0.50 sube ≈ 30 % los litros.',
    { afecta: ['cons'], tip: [0.2, 1], nom: { primario: 'primario', esmalte: 'esmalte' } });
  E('proceso.pintura.capas.*.precio_ref', 'Precio de la pintura · {0}',
    'La variable de «Precios» con el costo por litro de esta pintura.',
    'Se elige de la lista de precios (primario o esmalte).',
    'Cambia el precio de esta pintura sin cambiar su rendimiento.',
    { afecta: ['cons'], nom: { primario: 'primario', esmalte: 'esmalte' } });
  E('proceso.pintura.f_diluyente', 'Diluyente',
    'Cuánto diluyente se agrega a la pintura, como fracción de los litros de pintura.',
    'En fracción: 0.10 = 10 % del volumen de pintura.',
    'Multiplica el costo del diluyente: poco peso en el precio total.',
    { afecta: ['cons'], tip: [0, 0.4] });
  E('proceso.pintura.diluyente_precio_ref', 'Precio del diluyente',
    'La variable de «Precios» con el costo por litro de diluyente.',
    'Se elige de la lista de precios.',
    'Cambia qué precio se aplica al diluyente.',
    { afecta: ['cons'] });
  E('proceso.qc', 'Inspección y embalaje',
    'Revisar y embalar lo que se manda: un tiempo fijo por partida más un tiempo según el peso.',
    'Tiempos en minutos y minutos por kg.',
    'Cambia las horas de inspección y embalaje de todas las piezas.',
    { afecta: ['mo'] });
  E('proceso.qc.t_fijo_min', 'Tiempo fijo de inspección',
    'Minutos de inspeccionar y preparar cada pieza, sin importar su peso.',
    'En min por pieza.',
    'Suma estos minutos a cada pieza: pesa en piezas livianas.',
    { afecta: ['mo'], tip: [0, 15] });
  E('proceso.soportes', 'Soportería',
    'Los datos de arranque de las piezas de soportería (ménsulas, abrazaderas, postes): minutos de taller, anclaje, tornillo y orejas de la abrazadera.',
    'Cada partida de soportería puede traer los suyos; éstos rigen si no.',
    'Cambian las horas y el material de las partidas de soportería que no dicen los suyos.',
    { afecta: ['mo', 'mat'] });
  E('proceso.soportes.t_fab_pieza_min', 'Minutos de taller por pieza',
    'Lo que tarda el taller en cortar, doblar, barrenar y puntear una pieza de soportería.',
    'En min reales por pieza (lo que tarda el trabajador; no se divide entre la eficiencia). ILUSTRATIVO: una ménsula puede llevar mucho más.',
    'Sube las horas de armado de la soportería: 15 piezas a 15 min son 3.75 h.',
    { afecta: ['mo', 'eq'], tip: [0, 240], ej: 'El taller: 7 ménsulas en 2 días = 137 min cada una (se capturan en la partida).' });
  E('proceso.soportes.anclaje_defecto', 'Anclaje por omisión',
    'El artículo del catálogo de compras con que se fija cada pieza (hoy el taquete de 3/8″).',
    'Se elige de la lista del catálogo de compras.',
    'Cambia el precio de los anclajes de las partidas que no eligen otro.',
    { afecta: ['mat'] });
  E('proceso.soportes.tornillo', 'Tornillo de la soportería',
    'El juego de tornillo con que se unen las piezas (abrazadera con ménsula).',
    'Se elige de la lista de tornillos con precio (Herrajes).',
    'Cambia el precio de los tornillos de la soportería.',
    { afecta: ['mat'] });
  E('proceso.soportes.oreja_abrazadera_mm', 'Oreja de la abrazadera',
    'Cada uno de los dos extremos planos con que una abrazadera de media vuelta se atornilla a la ménsula.',
    'En mm por oreja (hoy 50).',
    'Una abrazadera que se pide por el diámetro del ducto mide π·(D + t)/2 + 2 orejas: para 11″ con solera de 1/8″, 544 mm.',
    { afecta: ['mat', 'peso'], tip: [0, 150] });
  E('proceso.soportes.espaciado', 'Espaciamiento de los soportes',
    'Las reglas con que la partida de soportería, en modo automático, cuenta cuántas ménsulas pide el ducto de la cotización.',
    'Tramos horizontales: uno cada 2.5 m (máximo 3.0 m; lo ideal es uno por junta, cada 2.4 m). Tramos verticales: máximo cada 3.0 m y un soporte fuerte en la base de la subida. Junto a cada codo y derivación, uno a 30–50 cm.',
    'Cambian cuántas piezas calcula la soportería automática. La captura manual no las usa, pero avisa si queda por debajo del máximo.',
    { afecta: ['mo', 'mat'] });
  E('proceso.soportes.espaciado.horizontal_m', 'Separación recomendada, tramo horizontal',
    'Cada cuántos metros va un soporte en un tramo horizontal.',
    'En m. Recomendado: 2.5 m. La práctica ideal de montaje es 2.4 m (una por junta de yarda engargolada), que rigidiza el ensamble. No puede pasar del máximo.',
    'Menos metros = más ménsulas: un tramo de 10 m lleva 4 a 2.5 m y 5 a 2.4 m. Cada partida de soportería puede traer su propia separación.',
    { afecta: ['mo', 'mat'], tip: [1, 3] });
  E('proceso.soportes.espaciado.horizontal_max_m', 'Separación máxima, tramo horizontal',
    'Lo más que puede separarse un soporte de otro en un tramo horizontal.',
    'En m. Máximo: 3.0 m. Con la captura manual, si las piezas capturadas dejan el ducto más separado que esto, la partida avisa.',
    'No cambia el cálculo automático (usa la recomendada); sólo el aviso de la captura manual y el tope de la separación propia de la partida.',
    { afecta: ['mo', 'mat'], tip: [1.5, 4] });
  E('proceso.soportes.espaciado.vertical_m', 'Separación máxima, tramo vertical',
    'Cada cuántos metros va un soporte en un tramo vertical (una subida o bajada).',
    'En m. Máximo: 3.0 m.',
    'Menos metros = más ménsulas en las subidas. El tramo recto indica si es vertical en su campo «Posición».',
    { afecta: ['mo', 'mat'], tip: [1, 3] });
  E('proceso.soportes.espaciado.base_vertical', 'Soportes en la base de cada subida',
    'Los soportes que, como mínimo, lleva cada tramo vertical: el soporte fuerte de carga estructural en la base de la subida o cambio de dirección.',
    'Un número entero. Recomendado: 1.',
    'Un tramo vertical corto nunca lleva menos que esto; uno largo lleva los que pida la separación máxima.',
    { afecta: ['mo', 'mat'], tip: [0, 3] });
  E('proceso.soportes.espaciado.por_accesorio', 'Soportes junto a cada codo y derivación',
    'Cuántos soportes van junto a cada codo, injerto o reducción con injerto: a no más de 30–50 cm de la entrada o salida, porque ahí pega la partícula y se turba el aire.',
    'Un número entero. Recomendado: 1.',
    'Se suman a los de los tramos rectos: 3 codos y 2 injertos son 5 soportes más.',
    { afecta: ['mo', 'mat'], tip: [0, 3] });
  E('proceso.qc.k_manejo_min_kg', 'Manejo por kilo',
    'Minutos de cargar, envolver y embalar por cada kg de pieza.',
    'En min por kg.',
    'Multiplica el peso de la pieza (incluye aros y bridas sueltas): pesa en piezas pesadas.',
    { afecta: ['mo'], tip: [0.01, 0.3] });

  /* ---------------------------------------- Catálogo de compras ---------------------------------------- */
  E('compras.iva_pct', 'IVA de las compras',
    'El IVA que se le quita a un precio del catálogo (o a un artículo comprado, un viático o un gasto) que lo trae incluido.',
    'En %. En México 16 %.',
    'Un precio con IVA se cuesta sin él: con 16 %, $116 con IVA son $100 de costo (el IVA se acredita).',
    { afecta: ['mat'], tip: [0, 16] });
  E('compras.articulos', 'Artículos',
    'Lo que se compra hecho: un bloque por artículo con su descripción, unidad, precio, si el precio trae IVA y su categoría en el control de gastos.',
    'Cada campo se explica con su botón ⓘ.',
    'Las partidas de «Artículo comprado» que eligen un artículo y los anclajes de la soportería toman de aquí su precio.',
    { afecta: ['mat'] });
  E('compras.articulos.*', 'Artículo {0}',
    'Un artículo del catálogo de compras.',
    'Descripción, unidad (pza, tramo…), precio, si el precio trae IVA y en qué categoría del control de gastos cae.',
    'Cambia el costo de las partidas que usan este artículo.',
    { nom: ARTICULOS, afecta: ['mat'] });
  E('compras.articulos.*.descripcion', 'Descripción · {0}',
    'Cómo se llama el artículo en la cotización y en la lista de compras.',
    'Texto libre, p. ej. Manguera azul de 6″ (tramo de 5 m).',
    'Sólo cambia el texto que se muestra.',
    { nom: ARTICULOS, afecta: ['info'] });
  E('compras.articulos.*.unidad', 'Unidad · {0}',
    'En qué se compra el artículo: pieza, tramo o rollo.',
    'Texto corto, p. ej. pza o tramo.',
    'Sólo cambia el texto que se muestra.',
    { nom: ARTICULOS, afecta: ['info'] });
  E('compras.articulos.*.precio', 'Precio · {0}',
    'Lo que cuesta una unidad del artículo, como lo da la tienda o el proveedor.',
    'MXN por unidad. Diga abajo si trae IVA.',
    'Sube el costo de las partidas que usan este artículo en la misma proporción.',
    { nom: ARTICULOS, afecta: ['mat'], tip: [0.5, 50000] });
  E('compras.articulos.*.iva_incluido', 'El precio trae IVA · {0}',
    'Si el precio capturado ya incluye el IVA.',
    'Elija Sí si el precio es con IVA (como en el ticket), No si es antes de IVA.',
    'Con Sí el costo es el precio ÷ (1 + IVA de las compras): un 13.8 % menos.',
    { nom: ARTICULOS, afecta: ['mat'], opc: { true: 'Sí: el precio ya trae IVA; se le quita.', false: 'No: el precio es antes de IVA.' } });
  E('compras.articulos.*.tornillos_pieza', 'Juegos de tornillería por pieza · {0}',
    'Los juegos de tornillo que lleva cada pieza que se atornilla: una brida de placa lleva la mitad de sus barrenos (la otra mitad la pone la brida con que se une).',
    'Número entero de juegos (tornillo, tuerca y rondanas). Confírmelo con el plano de la pieza.',
    'Suma esos juegos, con la reserva de las bridas, al costo de cada partida que compra el artículo y a la tornillería de la lista de compras.',
    { nom: ARTICULOS, afecta: ['mat'], tip: [0, 16], ej: 'Brida de placa de 5″ con 6 barrenos (los de los planos de pedido): 3 juegos por brida.' });
  E('compras.articulos.*.circulo_barrenos_mm', 'Círculo de barrenos · {0}',
    'El diámetro en que van los barrenos de una pieza que se atornilla como brida (una brida de placa): sobre él va el cordón de Sikaflex de su junta.',
    'Tómelo del plano de la pieza, en mm. 0 o vacío: la pieza no lleva junta.',
    'Con él se cuesta el material de su media junta, igual que en una brida de solera: medio cordón de Sikaflex (o medio empaque, según la junta de la unión bridada) por pieza, en la partida y en los cartuchos de la lista de compras.',
    { nom: ARTICULOS, afecta: ['mat'], tip: [0, 1500], ej: 'Brida de 5″ con barrenos en Ø 170 mm: medio cordón de 0.27 m, unos 12 mL de Sikaflex con la merma.' });
  E('compras.articulos.*.diam_ext_mm', 'Diámetro exterior · {0}',
    'El diámetro exterior de una brida de placa, como viene en su plano.',
    'En mm. 0 o vacío si el artículo no es una brida.',
    'No cambia ningún costo: sólo se usa para dibujarla en el plano de pedido.',
    { nom: ARTICULOS, afecta: ['info'], tip: [0, 1600], ej: 'Brida de placa de 5″: 194 mm.' });
  E('compras.articulos.*.diam_int_mm', 'Diámetro interior · {0}',
    'El diámetro interior de una brida de placa (el hueco por donde entra el ducto), como viene en su plano.',
    'En mm. 0 o vacío si el artículo no es una brida.',
    'No cambia ningún costo: sólo se usa para dibujarla en el plano de pedido.',
    { nom: ARTICULOS, afecta: ['info'], tip: [0, 1500], ej: 'Brida de placa de 5″: 130 mm.' });
  E('compras.articulos.*.ducto_D_mm', 'Para ducto de · {0}',
    'Si el artículo es una brida: el diámetro nominal del ducto en que va.',
    'En mm, el mismo diámetro con que se capturan las piezas (5″ = 127 mm). 0 o vacío si el artículo no es una brida.',
    'No cambia ningún costo: con él la pestaña Planos cuenta estas bridas en el cuadre de bridas, contra las que piden las piezas de ese diámetro.',
    { nom: ARTICULOS, afecta: ['info'], tip: [0, 1500], ej: 'Brida de placa de 5″: 127 mm.' });
  E('compras.articulos.*.categoria', 'Categoría en el control de gastos · {0}',
    'En qué renglón del control de gastos cae lo que se cotizó de este artículo, para compararlo con lo que de verdad se gastó.',
    'Elija la misma categoría con la que va a capturar el gasto real del artículo (el ticket o la factura).',
    'No cambia ningún precio: sólo mueve el costo de compra del artículo de un renglón a otro del control de gastos (su tornillería y su junta van a material). Sin categoría, cae en compras a terceros.',
    {
      nom: ARTICULOS, afecta: ['info'],
      opc: {
        MATERIAL: 'Material: lámina, perfiles, tornillería, empaque y sellador.',
        CONSUMIBLE: 'Consumibles: soldadura, gas, corte y pintura.',
        PROVEEDOR: 'Compras y trabajos de terceros (ducto hecho por un proveedor, mangueras, abrazaderas).',
        SOPORTERIA: 'Soportería y anclajes (taquetes, riel, tejuelos).',
        MANO_OBRA: 'Mano de obra y equipo del taller.',
        INSTALACION: 'Mano de obra de instalación.',
        VIATICOS: 'Viáticos y traslados.',
        OTROS: 'Otros.',
      },
    });
  E('compras.tornillos_multiplo', 'Tornillos: se compran de a',
    'En la lista de compras, la tornillería se redondea hacia arriba a un múltiplo de esto.',
    'Número entero de juegos (hoy 10: 208 exactos con 5 % de reserva son 218.4 → se compran 220).',
    'Sólo cambia la lista de compras y el sobrante, que siempre se cobra.',
    { afecta: ['mat'], tip: [1, 100] });
  E('compras.pintura_envase_L', 'Pintura: tamaño del envase',
    'En la lista de compras, la pintura se compra en envases completos de este tamaño.',
    'En litros (1 L, un galón ≈ 4 L o una cubeta de 19 L).',
    'Un envase más grande deja más sobrante en trabajos chicos; sólo cambia la lista de compras y el sobrante.',
    { afecta: ['cons'], tip: [0.25, 20] });

  /* ---------------------------------------- Herrajes ---------------------------------------- */
  E('herrajes.perfiles', 'Perfiles para aros de brida',
    'Los perfiles de acero con que se hacen los aros: solera (barra plana) o ángulo. El taller usa la solera de 1½″ × 3/16″.',
    'Un bloque por perfil. Peso, área y centroide se calculan; sólo se capturan sus medidas, su tornillo y a qué precio apunta.',
    'Cambia el peso, el material y el barrenado de las bridas que usen ese perfil.',
    { afecta: ['mat', 'mo'] });
  E('herrajes.perfiles.*', 'Perfil {0}',
    'La ficha de un perfil para aros: medidas, barreno, tornillo y precio.',
    'El aro se rola «de canto»: el ancho del perfil queda en el plano radial de la brida.',
    'Cambia las bridas que usen este perfil (la brida estándar usa SOL38x4.8).',
    { afecta: ['mat', 'mo'] });
  E('herrajes.perfiles.*.tipo', 'Tipo de perfil · {0}',
    'Si el perfil es solera (barra plana) o ángulo.',
    'Se elige de la lista. Cambia cómo se calcula el peso lineal y el centroide.',
    'Cambia el peso y el área del aro: un ángulo pesa más que una solera de igual ancho y espesor.',
    { afecta: ['mat', 'peso'], opc: { SOLERA: 'Barra plana: el barreno va al gramil, medido desde el borde interior.', ANGULO: 'Ángulo: la brida es una de sus alas; el barreno va al gramil.' } });
  E('herrajes.perfiles.*.descripcion', 'Descripción del perfil · {0}',
    'El nombre del perfil como lo conoce el taller.',
    'Texto libre, p. ej. Solera 1½″ × 3/16″.',
    'Sólo cambia el texto que se muestra.',
    { afecta: ['info'] });
  E('herrajes.perfiles.*.ancho_mm', 'Ancho del perfil · {0}',
    'El ancho de la solera (o del ala del ángulo), que queda en el plano de la brida.',
    'En mm. Solera 1½″ = 38.1.',
    'Cambia el peso por metro del perfil: ancho +10 % = +10 % de kg de aro. El diámetro exterior de la brida crece con el ancho.',
    { afecta: ['mat', 'peso'], tip: [15, 100] });
  E('herrajes.perfiles.*.esp_mm', 'Espesor del perfil · {0}',
    'El espesor del perfil.',
    'En mm. 3/16″ = 4.763.',
    'Cambia el peso por metro (espesor +10 % = +10 % de kg) y la velocidad de soldar el cierre del aro.',
    { afecta: ['mat', 'peso', 'mo'], tip: [2, 12] });
  E('herrajes.perfiles.*.gramil_mm', 'Gramil del barreno · {0}',
    'La distancia del borde interior del aro (el que abraza el ducto) a la línea de barrenos.',
    'En mm. En la solera de 1½″ los planos del taller la ponen a 24 mm (Dperf = Dint + 48); en ángulo se mide en el catálogo del ala.',
    'Define el diámetro de la circunferencia de barrenos: cambia el largo de aro que rodea los barrenos y por ello el número de tornillos.',
    { afecta: ['mat', 'geo'], tip: [8, 50] });
  E('herrajes.perfiles.*.tornillo', 'Tornillo del perfil · {0}',
    'Qué tornillo (de la tabla «Precio del tornillo») usa este perfil.',
    'Se elige de la lista de tornillos.',
    'Cambia el precio por tornillo de las bridas de este perfil.',
    { afecta: ['mat'] });
  E('herrajes.perfiles.*.tornillo_desc', 'Descripción del tornillo · {0}',
    'El nombre del tornillo para el desglose.',
    'Texto libre, p. ej. 5/16″ × 1¼″.',
    'Sólo cambia el texto que se muestra.',
    { afecta: ['info'] });
  E('herrajes.perfiles.*.diam_barreno_mm', 'Diámetro del barreno · {0}',
    'El diámetro del agujero por donde pasa el tornillo.',
    'En mm. 3/8″ = 9.525 para el tornillo de 5/16″.',
    'Sólo informa en el detalle: el tiempo de barrenar no depende del diámetro, sólo del número de barrenos.',
    { afecta: ['info'], tip: [5, 20] });
  E('herrajes.perfiles.*.barreno_desc', 'Descripción del barreno · {0}',
    'El nombre del barreno para el desglose.',
    'Texto libre, p. ej. 3/8″.',
    'Sólo cambia el texto que se muestra.',
    { afecta: ['info'] });
  E('herrajes.perfiles.*.precio_ref', 'Precio del perfil · {0}',
    'La variable de «Precios» con el precio por kg de este perfil si no está en la lista del proveedor.',
    'Se elige de la lista de precios (solera o ángulo).',
    'Cambia el precio de los aros de este perfil sólo si la barra no tiene precio en la lista.',
    { afecta: ['mat'] });
  E('herrajes.seleccion_perfil', 'Selección automática del perfil',
    'Qué perfil de brida se pone según el tamaño del extremo del ducto.',
    'Cada renglón dice «hasta tal dimensión, este perfil». Hoy una sola brida para todo (solera de 1½″ × 3/16″).',
    'Cambia el perfil de las bridas por tamaño de ducto. Una partida puede pedir otro perfil aparte.',
    { afecta: ['mat', 'mo'],
      cols: {
        'hasta mm': 'Dimensión mayor exterior del extremo hasta la que aplica el renglón, en mm.',
        perfil: 'Nombre del perfil (de la tabla de perfiles) que se usa.',
      } });
  E('herrajes.tornillo_precio_ref', 'Precio de cada tornillo',
    'A qué variable de «Precios» apunta cada tipo de tornillo (5/16″, M8, M10, M12).',
    'Cada renglón se elige de la lista de precios.',
    'Cambia el costo de los tornillos de las bridas que usen ese tipo.',
    { afecta: ['mat'] });
  E('herrajes.tornillo_precio_ref.*', 'Precio del tornillo {0}',
    'La variable de «Precios» con el costo de un juego de este tornillo.',
    'Se elige de la lista de precios.',
    'Cambia el precio de los tornillos de las bridas de perfiles que usen este tornillo.',
    { afecta: ['mat'] });
  E('herrajes.uniones', 'Tipos de unión',
    'Las formas de unir dos ductos: bridado (aros y tornillos), espiga (macho-hembra) y extremo liso.',
    'Cada unión tiene sus propios factores de tornillos, reserva y soldadura.',
    'Cambia el material y las horas de armado de las piezas que usan esa unión.',
    { afecta: ['mat', 'mo'] });
  E('herrajes.uniones.*', 'Unión {0}',
    'Los factores con que se calcula esta forma de unir ductos.',
    'Cada campo se explica con su botón ⓘ.',
    'Cambia las piezas cuya unión sea de este tipo.',
    { afecta: ['mat', 'mo'], nom: { BRIDADO: 'bridado', ESPIGA: 'espiga', LISO: 'extremo liso' } });
  E('herrajes.uniones.*.nombre', 'Nombre de la unión · {0}',
    'Cómo se llama la unión en las listas de captura.',
    'Texto libre.',
    'Sólo cambia el texto que se muestra.',
    { nom: { BRIDADO: 'bridado', ESPIGA: 'espiga', LISO: 'extremo liso' }, afecta: ['info'] });
  E('herrajes.uniones.BRIDADO.junta', 'Junta de la cara de la brida',
    'Con qué se sella la junta entre dos bridas: con sellador (Sikaflex) en lugar del empaque, o con empaque de neopreno.',
    'Se elige de la lista. El taller usa sellador.',
    'Con sellador: un cordón sobre el círculo de barrenos, sin empaque, y ese cordón es el sello de la junta (no se suma el de la clase C). Con empaque: la cinta y aparte el cordón de la clase.',
    { afecta: ['mat'], opc: { SELLADOR: 'Sellador (Sikaflex) en lugar del empaque.', EMPAQUE: 'Empaque de neopreno, más el cordón de sellador de la clase.' } });
  E('herrajes.uniones.BRIDADO.ml_sellador_junta_m', 'Sellador por metro de junta de brida',
    'Los mL de sellador del cordón que sustituye al empaque, por metro del círculo de barrenos.',
    'En mL por metro (40 ≈ un cordón de 7 mm). Supuesto: confírmelo con los cartuchos que se gastan.',
    'Sube o baja los cartuchos de sellador: 30 bridas de 9″ a 11″ piden 1.1 cartuchos de 600 mL (se compran 2).',
    { afecta: ['mat'], tip: [10, 120] });
  E('herrajes.uniones.BRIDADO.paso_tornillo_mm', 'Separación entre tornillos',
    'La distancia máxima entre un tornillo y el siguiente sobre el aro.',
    'En mm. Con 150, una brida de Ø12″ (≈ 1 118 mm de perímetro de barrenos) lleva 8 tornillos.',
    'Menos separación = más tornillos y más barrenos (material, barrenado y armado). Con 100 mm esa brida lleva 12.',
    { afecta: ['mat', 'mo'], tip: [80, 300] });
  E('herrajes.uniones.BRIDADO.n_min_tornillos', 'Mínimo de tornillos',
    'El menor número de tornillos que lleva una brida, aunque sea muy chica.',
    'Número entero. Los planos del taller dan 6 a las bridas de 9″ y menores.',
    'Sólo cuenta en bridas chicas: sube sus tornillos y barrenos.',
    { afecta: ['mat', 'mo'], tip: [2, 12] });
  E('herrajes.uniones.BRIDADO.multiplo_tornillos', 'Múltiplo de tornillos',
    'El número de tornillos se redondea hacia arriba a un múltiplo de este valor (para que queden simétricos).',
    'Número entero. 2 (número par, como en los planos del taller) deja la brida con 6, 8, 10… tornillos.',
    'Un múltiplo mayor agrega tornillos y barrenos de más: con 8, una brida de 9 pasa a 16.',
    { afecta: ['mat', 'mo'], tip: [1, 8] });
  E('herrajes.uniones.BRIDADO.f_reserva_tornilleria', 'Reserva de tornillería',
    'Un porcentaje extra de tornillos que se compra por pérdidas y repuesto.',
    'En %. 5 % es usual.',
    'Sube el costo de los tornillos en ese %. Con 5 %, 100 tornillos cuestan como 105.',
    { afecta: ['mat'], tip: [0, 25] });
  E('herrajes.uniones.BRIDADO.f_traslape_empaque', 'Traslape del empaque',
    'Un porcentaje extra de empaque por el traslape en la junta de cada cinta.',
    'En %. 5 % es usual.',
    'Sube la longitud (y el costo) del empaque en ese %.',
    { afecta: ['mat'], tip: [0, 25] });
  E('herrajes.uniones.BRIDADO.f_cont_soldadura_aro', 'Soldadura continua del aro',
    'Cuántas vueltas de cordón de filete lleva el aro soldado al ducto: 1 = una vuelta completa por fuera.',
    'Sin unidad. 1.0 = cordón continuo; 0.5 = punteado a la mitad; 2.0 = cordón por ambos lados.',
    'Multiplica los metros de soldadura del aro al ducto: de 1.0 a 2.0 duplica esa soldadura (alambre, gas y horas).',
    { afecta: ['mo', 'cons'], tip: [0.25, 2] });
  E('herrajes.uniones.BRIDADO.ceja_mm', 'Lámina de la ceja',
    'Lo que se deja de más en el extremo del ducto para doblarlo sobre la brida (la ceja que la detiene), en los materiales cuya brida va con ceja.',
    'En mm. Valor supuesto: 10 mm; mídalo en una pieza.',
    'Suma esa franja de lámina (perímetro × ceja) por cada brida de taller con ceja: más kilos de lámina.',
    { afecta: ['mat', 'peso'], tip: [0, 30] });
  E('herrajes.uniones.ESPIGA.prof_espiga_mm', 'Profundidad de la espiga',
    'Cuánto entra el macho en la hembra en una unión de espiga.',
    'En mm. 60 es usual.',
    'Alarga cada pieza con espiga: más lámina por unión.',
    { afecta: ['mat'], tip: [30, 120] });
  E('herrajes.uniones.ESPIGA.paso_fijacion_mm', 'Separación entre fijaciones',
    'La distancia máxima entre un tornillo autotaladrante y el siguiente en una unión de espiga.',
    'En mm. 150 es usual.',
    'Menos separación = más tornillos autotaladrantes por unión: sube material y tiempo de fijación.',
    { afecta: ['mat', 'mo'], tip: [80, 300] });
  E('herrajes.uniones.ESPIGA.n_min_fijaciones', 'Mínimo de fijaciones',
    'El menor número de tornillos autotaladrantes de una unión de espiga.',
    'Número entero. 4 es usual.',
    'Sólo cuenta en ductos chicos.',
    { afecta: ['mat', 'mo'], tip: [2, 12] });
  E('herrajes.uniones.ESPIGA.f_reserva_fijaciones', 'Reserva de fijaciones',
    'Un porcentaje extra de tornillos autotaladrantes por pérdidas.',
    'En %. 5 % es usual.',
    'Sube el costo de los tornillos de las uniones de espiga en ese %.',
    { afecta: ['mat'], tip: [0, 25] });
  E('herrajes.empaque', 'Empaque',
    'La cinta de neopreno que sella las caras de cada brida, cuando la junta es de empaque (el taller usa sellador).',
    'Sólo se elige el precio al que apunta.',
    'Cambia el costo del empaque de las uniones bridadas con junta de empaque.',
    { afecta: ['mat'] });
  E('herrajes.empaque.precio_ref', 'Precio del empaque',
    'La variable de «Precios» con el costo por metro del empaque.',
    'Se elige de la lista de precios.',
    'Cambia qué precio se aplica al empaque de todas las bridas.',
    { afecta: ['mat'] });
  E('herrajes.sellador', 'Sellador',
    'El sellador de juntas: cuánto se gasta por metro de junta, cuánta pérdida y cuánto trae el cartucho.',
    'Datos de rendimiento y presentación del producto.',
    'Cambia el costo del sellador de toda junta que lo lleve.',
    { afecta: ['mat'] });
  E('herrajes.sellador.ml_por_m', 'Sellador por metro de junta',
    'Mililitros de sellador que se gastan por cada metro de junta.',
    'En mL por metro. Depende del ancho del cordón de sellador.',
    'Multiplica el consumo: el doble de mL por metro duplica el costo del sellador.',
    { afecta: ['mat'], tip: [5, 60] });
  E('herrajes.sellador.f_merma', 'Merma del sellador',
    'Una parte del sellador se pierde al aplicarlo o se queda en el cartucho.',
    'En fracción: 0.15 = 15 % más.',
    'Sube el consumo de sellador en ese factor.',
    { afecta: ['mat'], tip: [0, 0.5] });
  E('herrajes.sellador.cartucho_ml', 'Tamaño del cartucho',
    'Cuántos mililitros trae un cartucho de sellador.',
    'En mL (el Sikaflex que compra el taller es de 600 mL). Debe ser mayor que 0.',
    'Cambia el costo por mL: un cartucho más grande al mismo precio abarata el sellador.',
    { afecta: ['mat'], tip: [100, 1000] });
  E('herrajes.sellador.precio_cartucho_ref', 'Precio del cartucho',
    'La variable de «Precios» con el costo de un cartucho de sellador.',
    'Se elige de la lista de precios.',
    'Cambia qué precio se aplica al sellador.',
    { afecta: ['mat'] });
  E('herrajes.precio_fijacion_ref', 'Precio de la fijación',
    'La variable de «Precios» con el costo de un tornillo autotaladrante de espiga.',
    'Se elige de la lista de precios.',
    'Cambia qué precio se aplica a los tornillos de las uniones de espiga.',
    { afecta: ['mat'] });

  /* ======================================================================================================== */
  /* Consulta                                                                                                 */
  /* ======================================================================================================== */
  // Se compara segmento por segmento (no sobre el texto unido con puntos): hay claves con punto, como el perfil «SOL38x4.8».
  const COMPILADO = CAT.map((e) => ({ e, partes: e.patron.split('.') }));
  /** Segmentos que cubrieron cada `*` si la ruta coincide con el patrón; null si no. */
  const coincide = (partes, ruta) => {
    if (partes.length !== ruta.length) return null;
    const caps = [];
    for (let i = 0; i < partes.length; i += 1) {
      if (partes[i] === '*') caps.push(String(ruta[i]));
      else if (partes[i] !== String(ruta[i])) return null;
    }
    return caps;
  };

  const sustituir = (txt, caps, nom) => String(txt).replace(/\{(\d+)\}/g, (m, i) => {
    const c = caps[Number(i)];
    if (c === undefined) return m;
    return nom && Object.prototype.hasOwnProperty.call(nom, c) ? nom[c] : c;
  });

  /**
   * Ayuda de un dato: ruta (arreglo de claves) → { ruta, patron, t, que, como, efecto, afecta, tip, ej, ojo, opc, cols, esp } o null.
   * Los {0}, {1}… de los textos se sustituyen por los segmentos que cubrieron cada `*` (con su nombre legible si lo hay).
   */
  function buscar(ruta) {
    for (let i = 0; i < COMPILADO.length; i += 1) {
      const caps = coincide(COMPILADO[i].partes, ruta);
      if (caps) {
        const e = COMPILADO[i].e;
        const f = (x) => (x === undefined ? undefined : sustituir(x, caps, e.nom));
        const idx = e.espEn === undefined ? caps.length - 1 : e.espEn;
        return {
          ruta, patron: e.patron, t: f(e.t), que: f(e.que), como: f(e.como), efecto: f(e.efecto), afecta: e.afecta || [], tip: (e.tipEsp && caps[idx] !== undefined && e.tipEsp[caps[idx]]) || e.tip || null,
          ej: f(e.ej), ojo: f(e.ojo), opc: e.opc || null, cols: e.cols || null, origen: e.origen || null, origenTxt: e.origenTxt || null,
          esp: e.esp && caps[idx] !== undefined && e.esp[caps[idx]] ? e.esp[caps[idx]] : null,
          nombre: caps.length && e.nom && e.nom[caps[caps.length - 1]] ? e.nom[caps[caps.length - 1]] : null,
        };
      }
    }
    return null;
  }

  /* ---------- Recorrido de las tablas tal como las dibuja el editor ---------- */
  const GRUPOS = ['proveedor', 'precios', 'compras', 'mano_obra', 'merma', 'capas', 'rapida', 'proceso', 'herrajes', 'materiales', 'calibres', 'servicios'];
  const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const esTablaPares = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'number'));
  const esTablaObjetos = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => esObj(x));
  const esTabla = (v) => esTablaPares(v) || esTablaObjetos(v);

  /**
   * Todo lo que el editor de tablas maestras dibuja y que debe poder explicarse:
   * [{ ruta, tipo: 'grupo' | 'sub' | 'fila' | 'tabla' }]. Los datos que el editor no muestra (meta, y los campos de
   * cada renglón del proveedor que no sean su precio) no se incluyen.
   */
  function recorrer(M) {
    const salida = [];
    const visitar = (valor, ruta) => {
      if (Array.isArray(valor)) {
        if (esTabla(valor)) { salida.push({ ruta, tipo: 'tabla' }); return; }
        valor.forEach((x, i) => {
          if (x !== null && typeof x === 'object') { salida.push({ ruta: [...ruta, i], tipo: 'sub' }); visitar(x, [...ruta, i]); } else salida.push({ ruta: [...ruta, i], tipo: 'fila' });
        });
        return;
      }
      if (esObj(valor)) {
        Object.keys(valor).forEach((k) => {
          const v = valor[k];
          if (v === null || typeof v !== 'object') { salida.push({ ruta: [...ruta, k], tipo: 'fila' }); return; }
          if (esTabla(v)) { salida.push({ ruta: [...ruta, k], tipo: 'tabla' }); return; }
          salida.push({ ruta: [...ruta, k], tipo: 'sub' });
          visitar(v, [...ruta, k]);
        });
      }
    };
    GRUPOS.forEach((g) => {
      salida.push({ ruta: [g], tipo: 'grupo' });
      if (g === 'proveedor') {
        salida.push({ ruta: ['proveedor', 'fecha'], tipo: 'fila' }, { ruta: ['proveedor', 'iva_incluido_pct'], tipo: 'fila' },
          { ruta: ['proveedor', 'hojas'], tipo: 'tabla' }, { ruta: ['proveedor', 'barras'], tipo: 'tabla' });
      } else visitar(M[g], [g]);
    });
    return salida;
  }

  /** ¿El valor (como se ve en pantalla) está fuera del rango usual de la ayuda? −1 por debajo, 1 por encima, 0 dentro o sin rango. */
  function fueraDeRango(ayuda, visto) {
    if (!ayuda || !ayuda.tip || typeof visto !== 'number' || !Number.isFinite(visto)) return 0;
    if (visto < ayuda.tip[0]) return -1;
    if (visto > ayuda.tip[1]) return 1;
    return 0;
  }

  return {
    AFECTA, ORIGENES, UNIDADES, FAMILIAS, OPERACIONES, MATERIALES, SISTEMAS, ARTICULOS, CATALOGO: CAT, GRUPOS,
    esPct, etiqueta, unidadDe, mostrado, buscar, coincide, recorrer, fueraDeRango,
  };
}));
