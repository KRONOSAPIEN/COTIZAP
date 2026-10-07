'use strict';
/**
 * CASO REAL — hoja «CONTROL DE GASTOS» del 6-oct-2026, con las respuestas del taller del 7-oct-2026: un proyecto de ductería
 * cal. 22 que se vendió en $45,710 CON IVA. El ducto lo fabricó un proveedor ($22,000 con IVA) y las 30 bridas de placa de 5″,
 * 6″ y 7″ las cortó con plasma el proveedor de corte (24 + 2 + 4, $3,440 más IVA); en el taller se hicieron en 4 días 30 bridas
 * de solera (22 de 11″, 6 de 10″ y 2 de 9″) con esmalte y Sikaflex en la junta, y en 2 días las 7 ménsulas; se instaló en
 * Querétaro (local) con dos personas durante 5 días, con un viaje Querétaro–México (casetas $806 y gasolina $1,500).
 *
 * Lo que se verifica: que la cotización de la app reproduce la compra real de la hoja (las barras, los 28 taquetes, los 220
 * juegos de tornillos y los 2 Sikaflex), que lo cotizado queda a menos de 1 % de lo gastado sin IVA, y el resultado del proyecto
 * con la venta pactada con IVA, conciliado con el −$829 de la hoja. La mano de obra es la del taller: $500 por día ÷ 8 h =
 * $62.50 la hora. Los datos viven en src/datos/ejemplos.js; aquí todo se recalcula con aritmética directa.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const G = require('../src/motor/gastos');
const { casoControlGastos } = require('../src/datos/ejemplos');

const M = crearMaestros();
// El proyecto y sus gastos son los del ejemplo que trae la app (Compras y gastos → «Ver el ejemplo»): una sola fuente
const COTIZACION = casoControlGastos();
const GASTOS = COTIZACION.gastos;

const res = C.cotizar(COTIZACION, M);
const casi = (real, esperado, tol, msg) => assert.ok(Math.abs(real - esperado) <= tol, `${msg}: esperado ${esperado} ± ${tol}, obtenido ${real}`);
const HORA = 500 / 8;
const sinIva = (x) => x / 1.16;
const VENTA = 45710 / 1.16; // la venta se pactó con IVA

test('Caso real: todas las partidas se calculan', () => {
  assert.equal(res.totales.n_partidas_error, 0, JSON.stringify(res.partidas.filter((f) => !f.ok).map((f) => f.errores)));
});

test('Caso real: la lista de compras de la app es la compra de la hoja (6 soleras, 2 ángulos, 1 solera chica, 1 PTR, 28 taquetes, 220 juegos y 2 Sikaflex)', () => {
  const barra = (id) => res.compras.barras.find((x) => x.clave === id);
  assert.equal(barra('SOL_1_1_2X3_16').compra, 6, 'soleras de 1½″ × 3/16″ para las 30 bridas');
  casi(barra('SOL_1_1_2X3_16').necesario, 5.528, 0.01, 'la hoja: 33.17 m ÷ 6 m = 5.53 barras');
  assert.equal(barra('ANG_1_1_4X1_8').compra, 2, 'ángulos de las ménsulas');
  casi(barra('ANG_1_1_4X1_8').necesario, (7 * 1300) / 6000, 1e-9, '7 ménsulas con brazo y pierna de 650 mm');
  assert.equal(barra('SOL_1_1_4X1_8').compra, 1, 'solera de las abrazaderas');
  const abrazadera = (Math.PI * (11 * 25.4 + 3.175)) / 2 + 2 * 50; // media vuelta al ducto de 11″ y dos orejas
  casi(abrazadera, 543.87, 0.005, 'cada abrazadera');
  casi(barra('SOL_1_1_4X1_8').necesario, (7 * abrazadera) / 6000, 1e-9);
  assert.equal(barra('PTR_2X2_C14').compra, 1, 'el poste');
  assert.equal(res.compras.anclajes.find((x) => x.clave === 'TAQUETE_3_8').compra, 28);
  // cada compra dice en qué renglón del control de gastos cae
  assert.equal(barra('SOL_1_1_2X3_16').categoria, 'MATERIAL', 'la solera de las bridas');
  assert.equal(barra('ANG_1_1_4X1_8').categoria, 'SOPORTERIA', 'el ángulo de las ménsulas');
  assert.deepEqual(res.compras.comprados.map((x) => x.categoria), Array(6).fill('PROVEEDOR'), 'ducto, 3 tamaños de brida de placa, abrazaderas de manguera y mangueras');
  // tornillería: la media junta de cada brida con los barrenos de los planos de pedido del 30-sep-2026 (8 en las de 11″ y 10″,
  // 6 en las de 9″ y en las 30 de placa), con 5 % de reserva
  const t = res.compras.tornillos[0];
  const juegos = (22 * 8 + 6 * 8 + 2 * 6 + 30 * 6) / 2;
  assert.equal(juegos, 208, 'los 208 exactos de la hoja');
  assert.equal(t.necesario, juegos);
  casi(t.con_reserva, juegos * 1.05, 1e-9);
  assert.equal(t.compra, 220, 'los 220 juegos que se compraron');
  // Sikaflex: medio cordón de 40 mL/m (+15 % de merma) sobre el círculo de barrenos de cada una de las 60 bridas
  const e = 0.0336 * 25.4; // galvanizado cal. 22
  const solera = [[11, 22], [10, 6], [9, 2]].reduce((s, [pulg, n]) => s + n * Math.PI * (pulg * 25.4 + 2 * e + 2 * 24), 0); // barrenos a 24 mm del borde interior
  const placa = Math.PI * (24 * 170 + 2 * 193 + 4 * 230);
  const ml = ((0.5 * (solera + placa)) / 1000) * 40 * 1.15;
  casi(res.compras.sellador[0].ml, ml, 1e-6, 'mL de Sikaflex');
  casi(ml, 1084.23, 0.01);
  assert.equal(res.compras.sellador[0].compra, 2, 'los 2 cartuchos que se compraron');
  assert.equal(res.compras.empaque.length, 0, 'sin empaque de neopreno');
  // el esmalte de las bridas de solera: 1 L y 1 L de diluyente, lo que va como gasto estimado
  const esmalte = res.compras.pintura.find((x) => x.clave === 'esmalte');
  const diluyente = res.compras.pintura.find((x) => x.clave === 'diluyente');
  assert.deepEqual([esmalte.compra, diluyente.compra], [1, 1]);
  const estimados = GASTOS.filter((g) => /estimado/.test(g.concepto));
  assert.deepEqual(estimados.map((g) => g.cantidad * g.precio_unitario), [esmalte.importe_compra, diluyente.importe_compra]);
});

test('Caso real: el tiempo de taller es el que dijo el taller (bridas 4 días, ménsulas 2) y la cuadrilla 80 h', () => {
  const h = (fam, re) => res.partidas.filter((f) => f.familia === fam && re.test(f.descripcion)).reduce((s, f) => s + f.costos.h_MOD, 0);
  casi(h('BRIDA', /./), 32, 0.15, 'las 30 bridas de solera (rolado, cierre, barrenado, esmalte e inspección)');
  casi(h('SOPORTE', /Ménsulas/), 16, 0.01, 'las 7 ménsulas');
  casi(h('SOPORTE', /Abrazaderas/), (7 * 15) / 60, 1e-12, 'las abrazaderas, con el tiempo de tabla');
  // los barrenos de las bridas de solera, como en los planos: 8 en las de 11″ y 10″, 6 en las de 9″
  assert.deepEqual(res.partidas.filter((f) => f.familia === 'BRIDA').map((f) => f.qto.her.n_barrenos), [8, 8, 6]);
  casi(h('INSTALACION', /./), 80, 1e-12);
});

test('Caso real: lo que cotiza la app queda a menos de 1 % de lo que se gastó (sin IVA; el equipo no llega con ticket)', () => {
  const R = G.resumen(res, GASTOS, 0.16);
  // lo gastado sin IVA, renglón por renglón: con factura se acredita el IVA; las bridas de placa, el esmalte y el diluyente ya
  // vienen antes de IVA; la raya no lleva IVA
  const compras = sinIva(22000) + (24 * 110 + 2 * 120 + 4 * 140) + 220 * 3.67 + sinIva(28 * 16) + 422.41 + 6 * 215.52 + sinIva(2 * 459)
    + sinIva(2 * 260) + sinIva(150) + sinIva(806) + sinIva(1500) + sinIva(18 * 55) + 3 * 1807.49;
  const real = compras + 260 + 70 + (32 + 16 + 80) * HORA;
  casi(compras, 34947.47, 0.005, 'las compras de la hoja, sin IVA');
  casi(R.totales.real, real, 0.005, 'gasto real sin IVA');
  casi(R.totales.real, 43277.47, 0.005);
  const dif = Math.abs(R.totales.cotizado - R.totales.real) / R.totales.real;
  assert.ok(dif < 0.01, `la app ${R.totales.cotizado.toFixed(2)} contra lo real ${R.totales.real.toFixed(2)}: ${(dif * 100).toFixed(2)} %`);
  casi(R.totales.cotizado + R.resultado.equipo_estimado, res.totales.costo_directo, 1e-6, 'el costo directo suma además el equipo');
  // los rubros que fija la hoja coinciden al centavo
  const cat = Object.fromEntries(R.categorias.map((x) => [x.clave, x]));
  casi(cat.VIATICOS.cotizado, cat.VIATICOS.real, 0.005, 'viáticos: sólo el viaje (instalación local)');
  casi(cat.PROVEEDOR.cotizado, cat.PROVEEDOR.real, 0.005, 'ducto, bridas de placa, mangueras y abrazaderas (su tornillería y su Sikaflex van a material)');
  casi(cat.INSTALACION.real, 5000, 0.005, 'instalación: 80 h × $62.50');
  casi(cat.INSTALACION.cotizado, cat.INSTALACION.real, 0.005, 'la cuadrilla cotizada es la que se pagó');
  casi(cat.MANO_OBRA.real, 3000, 0.005, 'taller: 48 h × $62.50');
  // el IVA de las compras de la hoja (todas con IVA salvo la raya) y el del esmalte y el diluyente se acreditan
  const ivaHoja = (46539.064 - 6000) - sinIva(46539.064 - 6000);
  casi(ivaHoja, 5591.60, 0.005);
  casi(R.totales.iva_acreditable, ivaHoja + 0.16 * 330, 0.01);
});

test('Caso real: el resultado con la venta de $45,710 con IVA ($39,405.17 antes de IVA), conciliado con el −$829 de la hoja', () => {
  const R = G.resumen(res, GASTOS, 0.16);
  casi(VENTA, 39405.17, 0.005);
  casi(R.resultado.venta, VENTA, 1e-6);
  casi(R.resultado.utilidad_antes_indirectos, VENTA - R.totales.real, 1e-6);
  casi(R.resultado.utilidad_antes_indirectos, -3872.30, 0.005, 'pierde antes de indirectos');
  casi(R.resultado.margen_antes_indirectos_pct, -3872.30 / 39405.17, 1e-6, '≈ −9.8 %');
  // La hoja restaba sus costos (con IVA, y la raya, que no lo lleva) de la venta con IVA: −$829.06. Pero del IVA de la venta
  // ($6,304.83) sólo se acredita el de las compras ($5,591.60): los $713.23 que faltan se le pagan al SAT.
  const hoja = 45710 - 46539.064;
  casi(hoja, -829.06, 0.005);
  const ivaNeto = (45710 - VENTA) - ((46539.064 - 6000) - sinIva(46539.064 - 6000));
  casi(ivaNeto, 713.23, 0.005);
  casi(hoja - ivaNeto, -1542.29, 0.01, 'la hoja con el IVA que se paga');
  // y faltaban 2 días de bridas y 2 de ménsulas (32 h a $62.50) y el esmalte ($330)
  casi(hoja - ivaNeto - 32 * HORA - 330, R.resultado.utilidad_antes_indirectos, 0.01);
  assert.ok(R.resultado.utilidad_despues_indirectos < R.resultado.utilidad_antes_indirectos, 'con equipo, indirectos y comisión pierde más');
  const V = res.totales.venta;
  assert.equal(V.con_iva, true);
  assert.equal(V.capturada, 45710);
  casi(V.pactada, VENTA, 1e-9);
  casi(V.total, 45710, 0.005);
  assert.equal(V.cubre_costo_directo, false, 'ni siquiera cubre el costo directo');
  assert.equal(V.cubre_precio_minimo, false, 'se vendió por debajo del precio mínimo');
  assert.ok(res.totales.precio_minimo > VENTA * 1.3, 'el precio mínimo pasa 30 % de la venta');
});
