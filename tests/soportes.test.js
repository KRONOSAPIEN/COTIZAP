/**
 * Soportes automáticos: cuántas ménsulas pide el ducto de la cotización (src/motor/soportes.js y la partida de soportería
 * con `cantidad_modo: 'AUTO'`). Espaciamiento del taller (8-oct-2026): horizontal cada 2.5 m (máximo 3.0), vertical máximo
 * cada 3.0 m con un soporte fuerte en la base, y uno junto a cada codo e injerto.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const S = require('../src/motor/soportes');
const V = require('../src/motor/validacion');

const base = { material_id: 'GALVANIZADO', calibre: '22', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C' };
const recto = (L_mm, extra) => ({ ...base, familia: 'RECTO', D_mm: 279.4, L_mm, cantidad: 1, ...extra });
const codo = (cantidad) => ({ ...base, familia: 'CODO', D_mm: 279.4, theta_deg: 90, cantidad });
const ménsulas = (extra) => ({ familia: 'SOPORTE', descripcion: 'Ménsulas', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, anclajes_pieza: 4, cantidad: 1, ...extra });
const cantidades = (res) => res.partidas.map((f) => (f.ok ? f.entrada.cantidad : null));

test('Las tablas de arranque traen el espaciamiento del taller y están sanas', () => {
  const M = crearMaestros();
  assert.deepEqual(M.proceso.soportes.espaciado, { horizontal_m: 2.5, horizontal_max_m: 3.0, vertical_m: 3.0, base_vertical: 1, por_accesorio: 1 });
  assert.deepEqual(V.problemasMaestros(M), []);
});

test('Tramo horizontal: un soporte cada 2.5 m (⌈largo ÷ 2.5⌉), mínimo 1; el mínimo exigible usa 3.0 m', () => {
  const M = crearMaestros();
  const n = (L) => S.contar(C.cotizar({ partidas: [recto(L)] }, M).partidas, M);
  assert.equal(n(500).n, 1);
  assert.equal(n(2500).n, 1, 'justo 2.5 m: uno');
  assert.equal(n(2501).n, 2);
  assert.equal(n(10000).n, 4);
  assert.equal(n(10000).minimo, 4, '10 m ÷ 3.0 = 3.33 → 4');
  assert.equal(n(8000).n, 4);
  assert.equal(n(8000).minimo, 3, '8 m ÷ 3.0 = 2.67 → 3');
  assert.equal(n(10000).tramos[0].posicion, 'HORIZONTAL');
});

test('Tramo vertical: máximo cada 3.0 m y siempre el soporte fuerte de la base', () => {
  const M = crearMaestros();
  const n = (L, cant) => S.contar(C.cotizar({ partidas: [recto(L, { posicion: 'VERTICAL', cantidad: cant || 1 })] }, M).partidas, M).n;
  assert.equal(n(1000), 1, 'una subida corta lleva el de la base');
  assert.equal(n(3000), 1);
  assert.equal(n(3001), 2);
  assert.equal(n(7000), 3);
  assert.equal(n(2000, 3), 3, 'tres subidas iguales: una en cada base');
});

test('Un soporte junto a cada codo e injerto; la reducción simple y la transición no piden', () => {
  const M = crearMaestros();
  const res = C.cotizar({
    partidas: [codo(3), { ...base, familia: 'RAMAL', D_mm: 279.4, d_mm: 127, L_cuerpo_mm: 700, L_ramal_mm: 450, beta_deg: 45, cantidad: 2 },
      { ...base, familia: 'REDUCCION', D1_mm: 279.4, D2_mm: 203.2, cantidad: 4 }],
  }, M);
  assert.ok(res.partidas.every((f) => f.ok), JSON.stringify(res.partidas.map((f) => f.errores)));
  const c = S.contar(res.partidas, M);
  assert.equal(c.n, 5, '3 codos + 2 injertos');
  assert.equal(c.accesorios.length, 2);
  assert.equal(c.tramos.length, 0);
  assert.match(S.resumen(c), /5 junto a codos e injertos/);
});

test('Partida automática: toma la cantidad del ducto, se recalcula con el ducto y no usa la que trae', () => {
  const M = crearMaestros();
  const cot = (...partidas) => C.cotizar({ partidas }, M);
  // 8 m horizontales (4) + 4 m verticales (2) + 3 codos (3)
  const r = cot(recto(8000), recto(4000, { posicion: 'VERTICAL' }), codo(3), ménsulas({ cantidad_modo: 'AUTO', cantidad: 99 }));
  const f = r.partidas[3];
  assert.ok(f.ok);
  assert.equal(f.entrada.cantidad, 9);
  assert.equal(f.soporte.conteo.modo, 'AUTO');
  assert.equal(f.soporte.conteo.n, 9);
  assert.equal(f.soporte.conteo.minimo, 8);
  // el precio es el de 9 piezas: igual que la misma partida capturada a mano con 9
  const mano = cot(ménsulas({ cantidad_modo: 'MANUAL', cantidad: 9 })).partidas[0];
  assert.equal(f.precio.importe, mano.precio.importe);
  // más ducto, más ménsulas
  assert.equal(cantidades(cot(recto(8000), recto(4000, { posicion: 'VERTICAL' }), codo(3), recto(5000), ménsulas({ cantidad_modo: 'AUTO' })))[4], 9 + 2);
  // el orden no importa: la soportería puede ir antes que el ducto
  assert.equal(cot(ménsulas({ cantidad_modo: 'AUTO' }), recto(8000), recto(4000, { posicion: 'VERTICAL' }), codo(3)).partidas[0].entrada.cantidad, 9);
  // dos partidas automáticas (ménsulas y abrazaderas) llevan la misma cantidad
  const dos = cot(recto(8000), ménsulas({ cantidad_modo: 'AUTO' }), ménsulas({ descripcion: 'Abrazaderas', cantidad_modo: 'AUTO', largo_pieza_mm: undefined, abrazadera_D_mm: 279.4, barra_id: 'SOL_1_1_4X1_8' }));
  assert.deepEqual([dos.partidas[1].entrada.cantidad, dos.partidas[2].entrada.cantidad], [4, 4]);
});

test('Separación propia de la partida: 2.4 m pone una por junta; más de 3.0 m es error', () => {
  const M = crearMaestros();
  const r = (sep) => C.cotizar({ partidas: [recto(10000), ménsulas({ cantidad_modo: 'AUTO', separacion_m: sep })] }, M).partidas[1];
  assert.equal(r(undefined).entrada.cantidad, 4);
  assert.equal(r(2.4).entrada.cantidad, 5, '10 m ÷ 2.4 = 4.17 → 5');
  assert.equal(r(2.4).soporte.conteo.separacion_m, 2.4);
  assert.equal(r('2.4').entrada.cantidad, 5, 'un texto numérico también vale');
  assert.match(r(3.5).errores.join(' '), /no puede pasar de 3 m/);
});

test('Sin ducto en la cotización, la automática dice qué falta (no calcula 0 piezas)', () => {
  const M = crearMaestros();
  const f = C.cotizar({ partidas: [ménsulas({ cantidad_modo: 'AUTO' })] }, M).partidas[0];
  assert.equal(f.ok, false);
  assert.match(f.errores.join(' '), /No hay tramos rectos, codos ni injertos/);
  // las partidas con error no cuentan
  const roto = C.cotizar({ partidas: [recto(-5), ménsulas({ cantidad_modo: 'AUTO' })] }, M);
  assert.equal(roto.partidas[1].ok, false);
});

test('Captura manual: avisa si quedan menos soportes que los de la separación máxima; sin modo (versiones anteriores) no cambia nada', () => {
  const M = crearMaestros();
  const r = C.cotizar({ partidas: [recto(10000), ménsulas({ cantidad_modo: 'MANUAL', cantidad: 3 }), ménsulas({ cantidad_modo: 'MANUAL', cantidad: 4 }), ménsulas({ cantidad: 1 })] }, M);
  assert.match(r.partidas[1].advertencias.join(' '), /menos soportes de los que pide la separación máxima de 3 m \(mínimo 4; lo recomendado son 4\)/);
  assert.deepEqual(r.partidas[2].advertencias, []);
  assert.deepEqual(r.partidas[3].advertencias, [], 'una partida de antes (sin modo) se queda como está');
  assert.equal(r.partidas[3].entrada.cantidad, 1);
  assert.equal(r.partidas[2].soporte.conteo.modo, 'MANUAL');
});

test('Datos inválidos: modo, posición y separación se validan; unas tablas rotas no tumban la cotización', () => {
  const M = crearMaestros();
  assert.match(C.cotizar({ partidas: [ménsulas({ cantidad_modo: 'TAL VEZ' })] }, M).partidas[0].errores.join(' '), /Cantidad de piezas/);
  assert.match(C.cotizar({ partidas: [recto(3000, { posicion: 'DIAGONAL' })] }, M).partidas[0].errores.join(' '), /Posición del tramo/);
  assert.match(C.cotizar({ partidas: [recto(3000), ménsulas({ cantidad_modo: 'AUTO', separacion_m: 'x' })] }, M).partidas[1].errores.join(' '), /Separación entre soportes/);
  const rota = crearMaestros();
  rota.proceso.soportes.espaciado.horizontal_m = 4;
  assert.match(V.problemasMaestros(rota).map(V.textoProblema).join(' '), /no puede pasar del máximo/);
  rota.proceso.soportes.espaciado = undefined;
  const r = C.cotizar({ partidas: [recto(3000), ménsulas({ cantidad_modo: 'AUTO' })] }, rota);
  assert.equal(r.partidas[1].ok, false);
  assert.doesNotThrow(() => C.cotizar({ partidas: [recto(3000), ménsulas({ cantidad_modo: 'MANUAL' })] }, rota));
});

test('Uno por junta: un soporte después de cada unión (por pieza armada) y otro dentro de la pieza que pase de 3.0 m', () => {
  const M = crearMaestros();
  const r = (yarda, criterio) => C.cotizar({ yarda_mm: yarda, partidas: [recto(8000), ménsulas({ cantidad_modo: 'AUTO', criterio_horizontal: criterio })] }, M).partidas;
  // yardas de 3 ft: piezas de 3 yardas (2.74 m) → 3 piezas, una ménsula en cada junta (cada 2.74 m, menos que el máximo)
  const tres = r(914.4, 'JUNTA');
  assert.deepEqual(tres[0].geometria.detalle.armado.piezas.map((p) => Math.round(p.largo_mm)), [2743, 2743, 2514]);
  assert.equal(tres[1].entrada.cantidad, 3);
  assert.equal(tres[1].soporte.conteo.tramos[0].criterio, 'JUNTA');
  assert.equal(tres[1].soporte.conteo.tramos[0].piezas_armadas, 3);
  // yardas de 4 ft: piezas de 3.66 m pasan del máximo de 3.0 m → 2 en cada una, más 1 en el ajuste de 0.68 m
  assert.equal(r(1220, 'JUNTA')[1].entrada.cantidad, 5);
  // por separación (el de arranque) siguen siendo 4
  assert.equal(r(914.4, 'SEPARACION')[1].entrada.cantidad, 4);
  assert.equal(r(914.4, undefined)[1].entrada.cantidad, 4);
  // nunca queda por debajo del mínimo de la separación máxima
  [914.4, 1220].forEach((y) => { const f = r(y, 'JUNTA')[1]; assert.ok(f.entrada.cantidad >= f.soporte.conteo.minimo); });
  // las subidas verticales no cambian: siguen cada 3.0 m
  const v = C.cotizar({ partidas: [recto(7000, { posicion: 'VERTICAL' }), ménsulas({ cantidad_modo: 'AUTO', criterio_horizontal: 'JUNTA' })] }, M).partidas[1];
  assert.equal(v.entrada.cantidad, 3);
  assert.match(C.cotizar({ partidas: [recto(3000), ménsulas({ cantidad_modo: 'AUTO', criterio_horizontal: 'CADA_RATO' })] }, M).partidas[1].errores.join(' '), /Soportes de los tramos horizontales/);
});

test('Abrazadera tipo cuna: media vuelta (180°) o vuelta completa (360°, dos mitades con sus orejas), de solera de 1″ × 1/8″', () => {
  const M = crearMaestros();
  const b = M.proveedor.barras.SOL_1X1_8;
  assert.equal(b.ancho_mm, 25.4);
  assert.equal(b.esp_mm, 3.175);
  assert.equal(b.precio, 120, 'aproximada: la de 1¼″ × 1/8″ ($150) × 25.4 / 31.75');
  const abz = (vuelta) => C.cotizar({ partidas: [{ familia: 'SOPORTE', barra_id: 'SOL_1X1_8', abrazadera_D_mm: 279.4, abrazadera_vuelta: vuelta, cantidad: 7 }] }, M).partidas[0];
  const media = abz('MEDIA');
  const completa = abz('COMPLETA');
  const mitad = (Math.PI * (279.4 + 3.175)) / 2 + 2 * 50;
  assert.ok(Math.abs(media.soporte.largo_pieza_mm - mitad) < 1e-9, 'media vuelta: π·(D + t)/2 + 2 orejas = 543.9 mm');
  assert.ok(Math.abs(completa.soporte.largo_pieza_mm - 2 * mitad) < 1e-9, 'vuelta completa: dos mitades = 1 087.7 mm');
  assert.equal(abz(undefined).soporte.largo_pieza_mm, media.soporte.largo_pieza_mm, 'sin decir, media vuelta (como antes)');
  assert.equal(completa.soporte.vuelta, 'COMPLETA');
  assert.ok(completa.costos.CD > media.costos.CD);
  assert.match(C.cotizar({ partidas: [{ familia: 'SOPORTE', barra_id: 'SOL_1X1_8', abrazadera_D_mm: 279.4, abrazadera_vuelta: 'TRES_CUARTOS', cantidad: 1 }] }, M).partidas[0].errores.join(' '), /Vuelta de la abrazadera/);
});
