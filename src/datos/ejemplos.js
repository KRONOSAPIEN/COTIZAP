/**
 * COTIZAP · datos/ejemplos.js — Proyectos de ejemplo para explorar la app (y para las pruebas, que usan los mismos datos).
 *
 * casoControlGastos(): la hoja «CONTROL DE GASTOS» del 6-oct-2026, con las respuestas del taller del 7-oct-2026. Un proyecto de
 * ductería cal. 22 que se vendió en $45,710 CON IVA ($39,405.17 antes de IVA). El ducto lo fabricó un proveedor ($22,000 con IVA)
 * y las 30 bridas de placa de 5″, 6″ y 7″ las cortó con plasma el proveedor de corte (cotización del 2-oct-2026: 24 + 2 + 4
 * piezas, $3,440 más IVA). En el taller se hicieron en 4 días 30 bridas de solera (22 de 11″, 6 de 10″ y 2 de 9″), pintadas con
 * esmalte y selladas con Sikaflex en lugar del empaque, y en 2 días las 7 ménsulas. Se instaló en Querétaro (local: sin hospedaje
 * ni comidas) con dos personas durante 5 días, y hubo un viaje Querétaro–México (casetas $806 y gasolina $1,500).
 * Los gastos son los de la hoja, renglón por renglón (precios con IVA como los trae la hoja; las bridas de placa como las cotizó
 * el proveedor, antes de IVA; todo con factura salvo la raya, que no lleva IVA), con la mano de obra a $62.50 por hora ($500 por
 * día ÷ 8 h, como la calcula el taller). El esmalte no venía en la hoja: va como gasto estimado (lo que pide la lista de compras).
 * Supuestos por confirmar: cada ménsula lleva 1 300 mm de ángulo (brazo y pierna de 650 mm: de dos ángulos salen las 7, como se
 * compró); cada abrazadera es de media vuelta para el ducto de 11″, con dos orejas atornilladas a la ménsula (con esos 2 juegos
 * por abrazadera la tornillería da los 220 juegos que se compraron), y las bridas de placa llevan los barrenos de la regla del
 * taller (4 la de 5″, 8 las de 6″ y 7″).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.ejemplos = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FECHA = '2026-10-06';
  const HORA = 500 / 8; // $62.50: el salario del día ÷ 8 h

  function casoControlGastos() {
    const brida = (pulg, n) => ({
      familia: 'BRIDA', descripcion: `Bridas de solera para ducto Ø${pulg}″`, cantidad: n, material_id: 'GALVANIZADO', calibre: 22, D_mm: pulg * 25.4,
    });
    // los precios de la hoja a 4 decimales (así se ven en la captura; los importes son los de la hoja)
    const gasto = (concepto, categoria, cantidad, precio, iva_incluido, con_factura) => ({
      fecha: FECHA, concepto, categoria, cantidad, precio_unitario: Number(precio.toFixed(4)), iva_incluido, con_factura,
    });
    const juego = 0.6 + 0.6 + 0.75 + 1.72; // rondana plana + rondana de presión + tuerca + tornillo, antes de IVA
    return {
      cliente: '',
      proyecto: 'Ejemplo: ductería cal. 22 vendida en $45,710 con IVA (hoja de control de gastos)',
      fecha: FECHA, riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', venta_pactada: 45710, venta_pactada_con_iva: true,
      partidas: [
        { familia: 'COMPRADO', descripcion: 'Ductería cal. 22 fabricada por proveedor', cantidad: 1, precio_compra_unitario: 22000, iva_incluido: true },
        { familia: 'COMPRADO', cantidad: 24, articulo_id: 'BRIDA_PLACA_5' },
        { familia: 'COMPRADO', cantidad: 2, articulo_id: 'BRIDA_PLACA_6' },
        { familia: 'COMPRADO', cantidad: 4, articulo_id: 'BRIDA_PLACA_7' },
        brida(11, 22), brida(10, 6), brida(9, 2),
        // 2 días para las 7: 16 h = 960 min ÷ 7 = 137.14 min por pieza
        { familia: 'SOPORTE', descripcion: 'Ménsulas para soportar ductos (650 mm)', cantidad: 7, barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, anclajes_pieza: 4, min_pieza: 137.14 },
        { familia: 'SOPORTE', descripcion: 'Abrazaderas para fijar los ductos a las ménsulas', cantidad: 7, barra_id: 'SOL_1_1_4X1_8', abrazadera_D_mm: 11 * 25.4, tornillos_pieza: 2 },
        { familia: 'SOPORTE', descripcion: 'Poste', cantidad: 1, barra_id: 'PTR_2X2_C14', largo_pieza_mm: 6000 },
        { familia: 'COMPRADO', cantidad: 18, articulo_id: 'ABRAZADERA_MANGUERA' },
        { familia: 'COMPRADO', cantidad: 3, articulo_id: 'MANGUERA_6' },
        { familia: 'INSTALACION', descripcion: 'Instalación local en Querétaro (2 personas, 5 días) y un viaje a México', cantidad: 1, personas: 2, dias: 5, viajes: 1, casetas_viaje: 806, gasolina_viaje: 1500 },
      ],
      gastos: [
        gasto('Ductería cal. 22 (proveedor)', 'PROVEEDOR', 1, 22000, true, true),
        gasto('24 bridas de placa de 5″ cortadas con plasma', 'PROVEEDOR', 24, 110, false, true),
        gasto('2 bridas de placa de 6″ cortadas con plasma', 'PROVEEDOR', 2, 120, false, true),
        gasto('4 bridas de placa de 7″ cortadas con plasma', 'PROVEEDOR', 4, 140, false, true),
        gasto('Tornillería: 220 juegos 5/16″ × 1¼″', 'MATERIAL', 220, juego * 1.16, true, true),
        gasto('28 taquetes de 3/8″', 'SOPORTERIA', 28, 16, true, true),
        gasto('Poste PTR 2″ × 2″ cal. 14', 'SOPORTERIA', 1, 422.41 * 1.16, true, true),
        gasto('6 soleras 1½″ × 3/16″', 'MATERIAL', 6, 215.52 * 1.16, true, true),
        gasto('2 Sikaflex blanco 600 mL (junta de las bridas)', 'MATERIAL', 2, 459, true, true),
        gasto('Ménsulas: 2 ángulos 1¼″ × 1/8″', 'SOPORTERIA', 2, 260, true, true),
        gasto('Abrazaderas: 1 solera 1¼″ × 1/8″', 'SOPORTERIA', 1, 150, true, true),
        gasto('Casetas Querétaro–México (ida y vuelta)', 'VIATICOS', 1, 806, true, true),
        gasto('Gasolina', 'VIATICOS', 1, 1500, true, true),
        gasto('18 abrazaderas de manguera', 'PROVEEDOR', 18, 55, true, true),
        gasto('3 mangueras de 6″ (tramos de 5 m)', 'PROVEEDOR', 3, 1807.49 * 1.16, true, true),
        gasto('1 L de esmalte para las bridas (estimado: no venía en la hoja)', 'CONSUMIBLE', 1, 260, false, true),
        gasto('1 L de diluyente (estimado: no venía en la hoja)', 'CONSUMIBLE', 1, 70, false, true),
        gasto('Mano de obra: bridas (4 días, 32 h)', 'MANO_OBRA', 32, HORA, false, false),
        gasto('Mano de obra: ménsulas (2 días, 16 h)', 'MANO_OBRA', 16, HORA, false, false),
        gasto('Mano de obra: instalación (2 personas × 5 días, 80 h)', 'INSTALACION', 80, HORA, false, false),
      ],
    };
  }

  return { casoControlGastos };
}));
