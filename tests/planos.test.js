'use strict';
/**
 * Dibujos acotados de las piezas (src/web/planos.js): cada familia se dibuja sin valores inválidos, con las cotas que mide la
 * pieza (las mismas que los planos de pedido del taller del 30-sep-2026), con el título como lo escribe el taller y con las
 * cotas ligadas al dato de la partida que miden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../src/web/planos');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');

const M = crearMaestros();
const galv24 = { material_id: 'GALVANIZADO', calibre: 24, tipo_union: 'LISO', cantidad: 1 };
const calcular = (p) => C.cotizarPartida({ ...galv24, ...p }, M);
const dibujo = (p) => PL.plano(calcular(p), M);

/** Todos los nodos del árbol, en orden. */
function nodos(a) {
  const lista = [];
  const ir = (n) => { lista.push(n); (n.c || []).forEach(ir); };
  ir(a);
  return lista;
}
const textos = (a) => nodos(a).filter((n) => n.tag === 'text').map((n) => n.t);

const PIEZAS = {
  codo5: { familia: 'CODO', D_mm: 127, theta_deg: 90, k_R: 1.5, n_gajos: 5 },
  codo11_60: { familia: 'CODO', D_mm: 279.4, theta_deg: 60, k_R: 1.5, n_gajos: 3 },
  codoRect: { familia: 'CODO', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, theta_deg: 90, k_R: 1 },
  redInj: { familia: 'REDUCCION_INJERTO', D1_mm: 279.4, D2_mm: 254, d_mm: 127, beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450 },
  injerto11: { familia: 'RAMAL', D_mm: 279.4, d_mm: 279.4, L_cuerpo_mm: 900, L_ramal_mm: 726, beta_deg: 30 },
  reduccion: { familia: 'REDUCCION', D1_mm: 304.8, D2_mm: 203.2, excentrica: 'CARA_PLANA' },
  recto: { familia: 'RECTO', D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO' },
  rectoLargo: { familia: 'RECTO', D_mm: 304.8, L_mm: 10000 },
  rectoRect: { familia: 'RECTO', forma: 'RECTANGULAR', a_mm: 500, b_mm: 300, L_mm: 1200 },
  transicion: { familia: 'TRANSICION', D_mm: 304.8, a_mm: 400, b_mm: 300 },
  brida11: { familia: 'BRIDA', D_mm: 279.4, tipo_union: 'BRIDADO' },
  bridaRect: { familia: 'BRIDA', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, tipo_union: 'BRIDADO' },
  placa5: { familia: 'COMPRADO', articulo_id: 'BRIDA_PLACA_5' },
  abrazadera: { familia: 'SOPORTE', barra_id: 'SOL_1_1_4X1_8', abrazadera_D_mm: 279.4 },
  mensula: { familia: 'SOPORTE', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300 },
};

test('Planos: toda familia con forma se dibuja sin NaN ni infinitos, con un marco que encierra pieza, cotas y textos', () => {
  Object.entries(PIEZAS).forEach(([nombre, p]) => {
    const d = dibujo(p);
    assert.ok(d, nombre);
    assert.ok(d.titulo && d.datos.length > 0, `${nombre}: título y datos`);
    const a = PL.arbol(d, { px: 380 });
    assert.equal(a.tag, 'svg');
    assert.doesNotMatch(JSON.stringify(a), /NaN|Infinity|undefined|null/, nombre);
    const vb = a.a.viewBox.split(' ').map(Number);
    assert.equal(vb.length, 4);
    assert.ok(vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0, `${nombre}: viewBox`);
    assert.ok(Number.isInteger(a.a.width) && a.a.width > 50 && Number.isInteger(a.a.height) && a.a.height > 20, `${nombre}: tamaño en px`);
    assert.ok(textos(a).length >= 1, `${nombre}: cotas con texto`);
    // la caja de la pieza cabe en el marco
    const cj = PL.caja(d);
    assert.ok(cj.x0 >= vb[0] - 1e-6 && cj.y0 >= vb[1] - 1e-6 && cj.x1 <= vb[0] + vb[2] + 1e-6 && cj.y1 <= vb[1] + vb[3] + 1e-6, `${nombre}: la pieza cabe`);
    // y cada texto también (con su ancho aproximado)
    nodos(a).filter((n) => n.tag === 'text' && !n.a.transform).forEach((n) => {
      assert.ok(n.a.x >= vb[0] && n.a.x <= vb[0] + vb[2] && n.a.y >= vb[1] && n.a.y <= vb[1] + vb[3], `${nombre}: el texto «${n.t}» queda dentro`);
    });
  });
});

test('Planos: la miniatura sólo lleva la pieza (sin cotas, textos ni líneas de construcción) en una caja fija', () => {
  Object.entries(PIEZAS).forEach(([nombre, p]) => {
    const a = PL.arbol(dibujo(p), { px: 64, alto_max: 44, compacto: true });
    assert.equal(textos(a).length, 0, nombre);
    assert.ok(!nodos(a).some((n) => /pl-eje|pl-cota/.test(n.a.class || '')), nombre);
    assert.equal(a.a.width, 64);
    assert.equal(a.a.height, 44);
    assert.match(a.a.class, /plano-mini/);
  });
});

test('Planos: el codo lleva sus cotas como en los planos del taller (R, R + D/2, D, ángulo y gajos)', () => {
  const t5 = textos(PL.arbol(dibujo(PIEZAS.codo5), { px: 380 }));
  ['191', '254', 'Ø5″', '90°', '5 gajos'].forEach((x) => assert.ok(t5.includes(x), `codo de 5″: ${x} (tiene ${t5.join(' | ')})`));
  const t11 = textos(PL.arbol(dibujo({ familia: 'CODO', D_mm: 279.4, theta_deg: 90, k_R: 1.5, n_gajos: 5 }), { px: 380 }));
  ['419', '559', 'Ø11″'].forEach((x) => assert.ok(t11.includes(x), `codo de 11″: ${x}`)); // 1.5 × 279.4 = 419.1 y + 139.7 = 558.8
  const d = dibujo(PIEZAS.codo11_60);
  assert.ok(d.datos.includes('3 gajos') && d.datos.includes('60°'));
  // n gajos: el contorno tiene 2 caras + 2·(n − 1) vértices de junta; y n − 1 líneas de junta
  const contorno = d.trazos.find((t) => t.t === 'ruta' && t.cerrada);
  assert.equal(contorno.d.length, 2 * (3 + 1));
  assert.equal(d.trazos.filter((t) => t.clase === 'junta').length, 2);
  // el codo rectangular, sin gajos, es un sector
  assert.ok(dibujo(PIEZAS.codoRect).trazos.some((t) => t.t === 'sector'));
});

test('Planos: la reducción con injerto y el injerto simple acotan diámetros, largos, injerto y ángulo; el injerto toca el cuerpo', () => {
  const d = dibujo(PIEZAS.redInj);
  assert.equal(d.titulo, 'Reducción de 11″ a 10″ con injerto de 5″ a 30°');
  const t = textos(PL.arbol(d, { px: 380 }));
  ['Ø11″', 'Ø10″', 'Ø5″', '500', '450', '30°'].forEach((x) => assert.ok(t.includes(x), `${x} (tiene ${t.join(' | ')})`));
  const campos = d.cotas.map((k) => k.campo).filter(Boolean).sort();
  assert.deepEqual(campos, ['D1_mm', 'D2_mm', 'L_ramal_mm', 'L_reduccion_mm', 'beta_deg', 'd_mm']);
  // los dos lados del injerto arrancan sobre el borde superior del cono (y = −(R1 − m·x)) y son paralelos a su eje (30°)
  const R1 = 279.4 / 2; const m = (279.4 - 254) / 2 / 500;
  const enBorde = (q) => Math.abs(q[1] + (R1 - m * q[0])) < 1e-6;
  const a30 = (l) => Math.abs((Math.atan2(l.d[0][1] - l.d[1][1], l.d[1][0] - l.d[0][0]) * 180) / Math.PI - 30) < 1e-6;
  const lados = d.trazos.filter((x) => x.t === 'ruta' && x.d.length === 2 && x.clase === 'pieza' && a30(x));
  assert.equal(lados.length, 2, 'los dos lados del injerto, a 30°');
  lados.forEach((l) => assert.ok(enBorde(l.d[0]), 'cada lado arranca en el borde del cono'));
  const y = dibujo(PIEZAS.injerto11);
  assert.equal(y.titulo, 'Ducto de 11″ con injerto de 11″ a 30°');
  assert.deepEqual(y.cotas.map((k) => k.campo).filter(Boolean).sort(), ['D_mm', 'D_mm', 'L_cuerpo_mm', 'L_ramal_mm', 'beta_deg', 'd_mm']);
});

test('Planos: la brida de solera se dibuja de frente con Dint, Dperf, Dext y sus barrenos (los del motor)', () => {
  const f = calcular(PIEZAS.brida11);
  const d = PL.plano(f, M);
  const a = f.qto.her.aros_sueltos[0];
  const Dint = f.geometria.extremos_sueltos[0].D_ext_mm;
  assert.equal(d.titulo, 'Brida de 11″');
  assert.ok(d.datos.includes(`Dint = ${Math.round(Dint)} mm`));
  assert.ok(d.datos.includes(`Dext = ${Math.round(Dint + 2 * 38.1)} mm`));
  assert.ok(d.datos.includes(`Dperf = ${Math.round(a.P_perno_mm / Math.PI)} mm`));
  assert.equal(d.trazos.filter((t) => t.clase === 'barreno').length, a.n_tornillos);
  assert.equal(a.n_tornillos, 8);
  // brida de placa del catálogo: sus diámetros del plano (194 / 170 / 130) y 6 barrenos
  const placa = dibujo(PIEZAS.placa5);
  assert.deepEqual(placa.datos, ['Dint = 130 mm', 'Dperf = 170 mm', 'Dext = 194 mm', '6 barrenos']);
  assert.equal(placa.trazos.filter((t) => t.clase === 'barreno').length, 6);
});

test('Planos: soportería (abrazadera de media vuelta con orejas, pieza recta), tramo recto con sus yardas o con corte', () => {
  const ab = dibujo(PIEZAS.abrazadera);
  assert.equal(ab.titulo, 'Abrazadera para ducto de 11″');
  assert.ok(ab.datos.includes('544 mm de barra por pieza'));
  assert.ok(dibujo(PIEZAS.mensula).datos.includes('1,300 mm por pieza'));
  const r = dibujo(PIEZAS.recto);
  assert.equal(r.trazos.filter((t) => t.clase === 'junta').length, 2, '2 juntas entre las 3 yardas (2 + ajuste)');
  assert.ok(r.datos.includes('2 yardas unidas + 560 mm de ajuste'), 'como en los planos de yardas');
  assert.ok(r.datos.includes('Brida en un extremo y una suelta'), 'el ajuste lleva la brida suelta de las tablas');
  assert.equal(r.titulo_corto, '2 yardas unidas + 560 mm de ajuste');
  assert.deepEqual(r.cotas.filter((k) => k.campo === null && k.t === 'cota').map((k) => k.texto), ['1,220', '1,220', '560'], 'cada yarda acotada arriba');
  assert.deepEqual(r.trazos.filter((t) => /^brida/.test(t.clase)).map((t) => t.clase), ['brida', 'brida-suelta'], 'la brida de taller y la suelta, en sus extremos');
  const largo = dibujo(PIEZAS.rectoLargo);
  assert.equal(largo.trazos.filter((t) => t.clase === 'corte').length, 2, 'un tramo de 10 m se dibuja con un corte');
  assert.ok(textos(PL.arbol(largo, { px: 380 })).includes('10,000'), 'la cota dice el largo real');
});

test('Planos: lo que no tiene forma no se dibuja; una partida con error tampoco', () => {
  assert.equal(PL.plano(calcular({ familia: 'INSTALACION', personas: 2, dias: 1 }), M), null);
  assert.equal(PL.plano(calcular({ familia: 'COMPRADO', articulo_id: 'MANGUERA_6' }), M), null);
  assert.equal(PL.plano(calcular({ familia: 'PERSONALIZADO', A_neta_m2: 2, L_corte_m: 6, L_sold_tope_m: 3, n_piezas: 1, n_extremos: 2, D_ref_mm: 300 }), M), null);
  assert.equal(PL.plano({ ok: false }, M), null);
  assert.equal(PL.plano(null, M), null);
});

test('Planos: el título como en los planos de pedido, sólo con lo capturado', () => {
  assert.equal(PL.titulo({ familia: 'CODO', D_mm: 127, theta_deg: 90, n_gajos: 5 }), 'Codo 90° Ø5″ · 5 gajos');
  assert.equal(PL.titulo({ familia: 'REDUCCION_INJERTO', D1_mm: 254, D2_mm: 228.6, d_mm: 127, beta_deg: 30 }), 'Reducción de 10″ a 9″ con injerto de 5″ a 30°');
  assert.equal(PL.titulo({ familia: 'RAMAL', D_mm: 152.4, d_mm: 76.2, beta_deg: 30 }), 'Ducto de 6″ con injerto de 3″ a 30°');
  assert.equal(PL.titulo({ familia: 'REDUCCION', D1_mm: '304.8', D2_mm: 200, excentrica: 'CARA_PLANA' }), 'Reducción excéntrica de 12″ a 200 mm', '200 mm no se lee como 7⅞″');
  assert.equal(PL.titulo({ familia: 'REDUCCION', D1_mm: 139.7, D2_mm: 127 }), 'Reducción de 5½″ a 5″');
  assert.equal(PL.titulo({ familia: 'BRIDA', D_mm: 228.6 }), 'Brida de 9″');
  assert.equal(PL.titulo({ familia: 'RECTO', D_mm: 304.8, L_mm: 3000 }), 'Tramo recto Ø12″ × 3,000 mm');
  assert.equal(PL.titulo({ familia: 'SOPORTE', abrazadera_D_mm: 279.4 }), 'Abrazadera para ducto de 11″');
  // incompleto o raro: vacío (la interfaz usa el nombre de la familia)
  assert.equal(PL.titulo({ familia: 'CODO', D_mm: 127 }), '');
  assert.equal(PL.titulo({ familia: 'INSTALACION' }), '');
  assert.equal(PL.titulo(null), '');
});

test('Planos: formato de taller — pulgadas en octavos, si no milímetros', () => {
  const F = PL.formato;
  assert.equal(F.pulg(279.4), '11″');
  assert.equal(F.pulg(31.75), '1¼″');
  assert.equal(F.pulg(38.1), '1½″');
  assert.equal(F.pulg(300), null);
  assert.equal(F.pulg(1), null, 'menos de 1/8″ no es una medida en pulgadas');
  assert.equal(F.diam(300), 'Ø300');
  assert.equal(F.diam(127), 'Ø5″');
  assert.equal(F.mm(1300.4), '1,300');
  assert.equal(F.nominal(203.2), '8″');
  assert.equal(F.nominal(250), '250 mm');
});

test('el pedido del 30-sep-2026 (ejemplo): sus 36 partidas se calculan, se dibujan, se llaman como en los planos y sus bridas cuadran como en la hoja de bridas', () => {
  const E = require('../src/datos/ejemplos');
  const cot = E.pedidoDucteria();
  const r = C.cotizar(cot, M);
  assert.equal(r.partidas.length, 36);
  assert.equal(r.totales.n_partidas_error, 0);
  const dibujos = r.partidas.map((f) => PL.plano(f, M));
  assert.ok(dibujos.every(Boolean), 'todas las piezas del pedido tienen plano');
  const titulos = cot.partidas.map((p) => PL.titulo(p));
  ['Codo 90° Ø5″ · 5 gajos', 'Codo 60° Ø11″ · 3 gajos', 'Ducto de 11″ con injerto de 11″ a 30°', 'Reducción de 11″ a 10″ con injerto de 5″ a 30°',
    'Reducción de 10″ a 6″ con injerto de 7″ a 30°', 'Ducto de 6″ con injerto de 3″ a 30°', 'Reducción de 9″ a 7″ con injerto de 5″ a 30°', 'Unión de piezas Ø11″', '2 uniones de piezas Ø6″']
    .forEach((t) => assert.ok(titulos.includes(t), t));
  // las piezas que pide cada hoja: 60 bridas, 7 codos, 9 reducciones con injerto e injertos, 20 ductos rectos y 6 armados
  const piezas = (fams) => cot.partidas.filter((p) => fams.includes(p.familia)).reduce((s, p) => s + p.cantidad, 0);
  assert.deepEqual([piezas(['BRIDA', 'COMPRADO']), piezas(['CODO']), piezas(['REDUCCION_INJERTO', 'RAMAL']), piezas(['RECTO']), piezas(['UNION'])], [60, 7, 9, 20, 6]);
  // las yardas de cada diámetro: 18 de 11″ (con 1 ajuste de 600), 3 de 10″, 1 de 6″ y 16 de 5″ con 5 ajustes (500 y 4 de 700: la hoja las cuenta como 20 yardas)
  const yardas = {};
  r.partidas.filter((f) => f.familia === 'RECTO').forEach((f) => {
    const a = f.geometria.detalle.armado;
    const k = Math.round(f.entrada.D_mm / 25.4);
    yardas[k] = yardas[k] || [0, 0];
    yardas[k][0] += a.n_completas * f.entrada.cantidad;
    yardas[k][1] += (a.ajuste_mm > 0 ? 1 : 0) * f.entrada.cantidad;
  });
  assert.deepEqual(yardas, { 11: [18, 1], 10: [3, 0], 6: [1, 0], 5: [16, 5] });
  // «bridas en ambos extremos» / «brida en un extremo», como dicen los planos de yardas
  const ductos = dibujos.filter((d) => d.familia === 'RECTO');
  ['3 yardas unidas', '2 yardas unidas + 600 mm de ajuste', '2 yardas unidas', '1 yarda', '1 yarda + 700 mm de ajuste'].forEach((t) => assert.ok(ductos.some((d) => d.titulo_corto === t), t));
  assert.ok(ductos.every((d) => d.datos.some((x) => /^Bridas? en (ambos|un) extremos?/.test(x))));
  // barrenos como en el plano de bridas: 8 en las de 11″ y 10″, 6 en las de 9″, 7″ y en las de placa
  assert.deepEqual(r.partidas.filter((f) => f.familia === 'BRIDA').map((f) => f.qto.her.aros_sueltos[0].n_tornillos), [8, 8, 6, 6]);
  // el cuadre: 11″, 10″, 9″ y 7″ cuadran con la hoja de bridas; con estos planos falta 1 de 6″ y sobran 3 de 5″
  assert.deepEqual(r.bridas.filas.map((x) => [Math.round(x.D_nom_mm * 10) / 10, x.piden, x.hay]), [[279.4, 22, 22], [254, 6, 6], [228.6, 2, 2], [177.8, 4, 4], [152.4, 3, 2], [127, 21, 24]]);
  // las piezas de lámina: galvanizado cal. 24 con sus bridas de otra partida; los armados, sin bridas
  cot.partidas.filter((p) => ['CODO', 'REDUCCION_INJERTO', 'RAMAL', 'RECTO'].includes(p.familia)).forEach((p) => {
    assert.deepEqual([p.material_id, p.calibre, p.tipo_union, p.bridas_aparte], ['GALVANIZADO', 24, 'BRIDADO', true]);
  });
  assert.equal(cot.yarda_mm, 914, 'yardas de 3 ft, como en los planos');
});
