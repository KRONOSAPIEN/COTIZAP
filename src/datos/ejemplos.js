/**
 * COTIZAP · datos/ejemplos.js — Proyectos de ejemplo para explorar la app (y para las pruebas, que usan los mismos datos).
 *
 * casoControlGastos(): la hoja «CONTROL DE GASTOS» del 6-oct-2026. Un proyecto de ductería cal. 22 que se vendió en $45,710
 * más IVA. El ducto lo fabricó un proveedor ($22,000 con IVA) y las bridas chicas (5″–7″) se mandaron cortar con plasma
 * ($3,990.40 con IVA); en el taller se hicieron 30 bridas de solera (22 de 11″, 6 de 10″ y 2 de 9″) y la soportería, y se
 * instaló con dos personas durante 5 días, con un viaje Querétaro–México (casetas $806 y gasolina $1,500).
 * Los gastos son los de la hoja, renglón por renglón (precios con IVA como los trae la hoja; todo con factura salvo la raya,
 * que no lleva IVA), con la mano de obra a $87.50 por hora trabajada ($3,500 a la semana ÷ 40 h).
 * Las piezas cuyo largo no traía la hoja (ménsula 1 500 mm, abrazadera 850 mm) son supuestos: de dos ángulos salen las 7
 * ménsulas y de una solera las 7 abrazaderas, como se compró.
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

  function casoControlGastos() {
    const brida = (pulg, n) => ({
      familia: 'BRIDA', descripcion: `Bridas de solera para ducto Ø${pulg}″`, cantidad: n, material_id: 'GALVANIZADO', calibre: 22, D_mm: pulg * 25.4,
    });
    // los precios con IVA de la hoja, a 4 decimales (así se ven en la captura; los importes son los de la hoja)
    const gasto = (concepto, categoria, cantidad, precio, iva_incluido, con_factura) => ({
      fecha: FECHA, concepto, categoria, cantidad, precio_unitario: Number(precio.toFixed(4)), iva_incluido, con_factura,
    });
    const juego = 0.6 + 0.6 + 0.75 + 1.72; // rondana plana + rondana de presión + tuerca + tornillo, antes de IVA
    return {
      cliente: '',
      proyecto: 'Ejemplo: ductería cal. 22 vendida en $45,710 + IVA (hoja de control de gastos)',
      fecha: FECHA, riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', venta_pactada: 45710,
      partidas: [
        { familia: 'COMPRADO', descripcion: 'Ductería cal. 22 fabricada por proveedor', cantidad: 1, precio_compra_unitario: 22000, iva_incluido: true },
        { familia: 'COMPRADO', descripcion: 'Bridas de 5″, 6″ y 7″ cortadas con plasma (proveedor)', cantidad: 1, precio_compra_unitario: 3990.40, iva_incluido: true },
        brida(11, 22), brida(10, 6), brida(9, 2),
        { familia: 'SOPORTE', descripcion: 'Ménsulas para soportar ductos', cantidad: 7, barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1500, anclajes_pieza: 4 },
        { familia: 'SOPORTE', descripcion: 'Abrazaderas para fijar ductos a ménsulas', cantidad: 7, barra_id: 'SOL_1_1_4X1_8', largo_pieza_mm: 850 },
        { familia: 'SOPORTE', descripcion: 'Poste', cantidad: 1, barra_id: 'PTR_2X2_C14', largo_pieza_mm: 6000 },
        { familia: 'COMPRADO', cantidad: 2, articulo_id: 'SIKAFLEX_BLANCO_600' },
        { familia: 'COMPRADO', cantidad: 18, articulo_id: 'ABRAZADERA_MANGUERA' },
        { familia: 'COMPRADO', cantidad: 3, articulo_id: 'MANGUERA_6' },
        { familia: 'INSTALACION', descripcion: 'Instalación (2 personas, 5 días)', cantidad: 1, personas: 2, dias: 5, viajes: 1, casetas_viaje: 806, gasolina_viaje: 1500 },
      ],
      gastos: [
        gasto('Ductería cal. 22 (proveedor)', 'PROVEEDOR', 1, 22000, true, true),
        gasto('Bridas de 5″, 6″ y 7″ con plasma', 'PROVEEDOR', 1, 3990.4, true, true),
        gasto('Tornillería: 220 juegos 5/16″ × 1¼″', 'MATERIAL', 220, juego * 1.16, true, true),
        gasto('28 taquetes de 3/8″', 'SOPORTERIA', 28, 16, true, true),
        gasto('Poste PTR 2″ × 2″ cal. 14', 'SOPORTERIA', 1, 422.41 * 1.16, true, true),
        gasto('6 soleras 1½″ × 3/16″', 'MATERIAL', 6, 215.52 * 1.16, true, true),
        gasto('2 Sikaflex blanco 600 mL', 'MATERIAL', 2, 459, true, true),
        gasto('Ménsulas: 2 ángulos 1¼″ × 1/8″', 'SOPORTERIA', 2, 260, true, true),
        gasto('Abrazaderas: 1 solera 1¼″ × 1/8″', 'SOPORTERIA', 1, 150, true, true),
        gasto('Casetas Querétaro–México (ida y vuelta)', 'VIATICOS', 1, 806, true, true),
        gasto('Gasolina', 'VIATICOS', 1, 1500, true, true),
        gasto('18 abrazaderas de manguera', 'PROVEEDOR', 18, 55, true, true),
        gasto('3 mangueras de 6″ (tramos de 5 m)', 'PROVEEDOR', 3, 1807.49 * 1.16, true, true),
        gasto('Mano de obra: bridas (2 días, 16 h)', 'MANO_OBRA', 16, 87.5, false, false),
        gasto('Mano de obra: instalación (2 personas × 5 días, 80 h)', 'INSTALACION', 80, 87.5, false, false),
      ],
    };
  }

  return { casoControlGastos };
}));
