'use strict';
/**
 * CASO REAL — hoja «CONTROL DE GASTOS» del 6-oct-2026: un proyecto de ductería cal. 22 que se vendió en $45,710 más IVA.
 * El ducto lo fabricó un proveedor ($22,000 con IVA) y las bridas chicas (5″–7″) se mandaron cortar con plasma ($3,990.40
 * con IVA); en el taller se hicieron 30 bridas de solera (22 de 11″, 6 de 10″ y 2 de 9″), la soportería, y se instaló con
 * dos personas durante 5 días, con un viaje Querétaro–México (casetas $806 y gasolina $1,500).
 *
 * Lo que se verifica: que la cotización de la app reproduce la compra real de la hoja (las 6 barras de solera, los 28
 * taquetes, el costo directo dentro del 2 % de lo gastado sin IVA) y el resultado del proyecto con la venta pactada.
 * Los gastos reales se capturan como en la hoja, con la mano de obra corregida a $87.50 por hora trabajada
 * ($3,500 a la semana ÷ 40 h; la hoja dividió entre 56 h y la puso en $62.50). Los datos viven en src/datos/ejemplos.js.
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

test('Caso real: todas las partidas se calculan', () => {
  assert.equal(res.totales.n_partidas_error, 0, JSON.stringify(res.partidas.filter((f) => !f.ok).map((f) => f.errores)));
});

test('Caso real: la lista de compras de la app es la compra de la hoja (6 soleras, 2 ángulos, 1 solera chica, 1 PTR, 28 taquetes)', () => {
  const barra = (id) => res.compras.barras.find((x) => x.clave === id);
  assert.equal(barra('SOL_1_1_2X3_16').compra, 6, 'soleras de 1½″ × 3/16″ para las 30 bridas');
  casi(barra('SOL_1_1_2X3_16').necesario, 5.528, 0.01, 'la hoja: 33.17 m ÷ 6 m = 5.53 barras');
  assert.equal(barra('ANG_1_1_4X1_8').compra, 2, 'ángulos de las ménsulas');
  assert.equal(barra('SOL_1_1_4X1_8').compra, 1, 'solera de las abrazaderas');
  assert.equal(barra('PTR_2X2_C14').compra, 1, 'el poste');
  assert.equal(res.compras.anclajes.find((x) => x.clave === 'TAQUETE_3_8').compra, 28);
  // cada compra dice en qué renglón del control de gastos cae
  assert.equal(barra('SOL_1_1_2X3_16').categoria, 'MATERIAL', 'la solera de las bridas');
  assert.equal(barra('ANG_1_1_4X1_8').categoria, 'SOPORTERIA', 'el ángulo de las ménsulas');
  assert.deepEqual(res.compras.comprados.map((x) => x.categoria), ['PROVEEDOR', 'PROVEEDOR', 'MATERIAL', 'PROVEEDOR', 'PROVEEDOR']);
  // la media junta de cada brida de solera: 30 bridas × 8 ÷ 2 = 120 juegos (la hoja compró 220 porque también contó las bridas chicas)
  assert.equal(res.compras.tornillos[0].necesario, 120);
  assert.equal(res.compras.tornillos[0].compra, 130, '120 con 5 % de reserva = 126 → de 10 en 10, 130');
});

test('Caso real: el costo directo de la app queda a menos de 2 % de lo que se gastó (sin IVA)', () => {
  const R = G.resumen(res, GASTOS, 0.16);
  casi(R.totales.real, 43347.47, 0.01, 'gasto real sin IVA');
  const dif = Math.abs(res.totales.costo_directo - R.totales.real) / R.totales.real;
  assert.ok(dif < 0.02, `la app ${res.totales.costo_directo.toFixed(2)} contra lo real ${R.totales.real.toFixed(2)}: ${(dif * 100).toFixed(2)} %`);
  // los rubros que fija la hoja coinciden al centavo
  const cat = Object.fromEntries(R.categorias.map((x) => [x.clave, x]));
  casi(cat.VIATICOS.cotizado, cat.VIATICOS.real, 0.005, 'viáticos');
  casi(cat.PROVEEDOR.cotizado, cat.PROVEEDOR.real, 0.005, 'ducto, bridas chicas, mangueras y abrazaderas (el sellador va a material)');
  casi(cat.INSTALACION.real, 7000, 0.005, 'instalación: 80 h × $87.50');
  casi(cat.INSTALACION.cotizado, cat.INSTALACION.real, 0.005, 'la cuadrilla cotizada es la que se pagó');
  casi(R.totales.iva_acreditable, 46539.064 - 6000 - (43347.47 - 8400), 0.02, 'el IVA de las compras se acredita');
});

test('Caso real: el resultado del proyecto con la venta de $45,710 más IVA', () => {
  const R = G.resumen(res, GASTOS, 0.16);
  casi(R.resultado.utilidad_antes_indirectos, 45710 - 43347.47, 0.01, 'utilidad antes de indirectos');
  casi(R.resultado.margen_antes_indirectos_pct, (45710 - 43347.47) / 45710, 1e-6, '≈ 5.2 %');
  assert.ok(R.resultado.utilidad_despues_indirectos < 0, 'con los indirectos que estima la app (ilustrativos), el proyecto pierde');
  const V = res.totales.venta;
  assert.equal(V.cubre_costo_directo, true);
  assert.equal(V.cubre_precio_minimo, false, 'se vendió por debajo del precio mínimo');
  assert.ok(res.totales.subtotal_neto > 45710 * 1.3, 'con indirectos y 20 % de utilidad el precio habría sido más de 30 % mayor');
});
