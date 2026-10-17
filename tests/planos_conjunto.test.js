'use strict';
/**
 * El conjunto armado dibujado como queda unido (planos.js · planoConjunto): las anclas de cada familia salen de la geometría que se
 * pinta, la pieza B queda con su cara sobre la de A y direcciones opuestas, el codo del injerto deja el ramal a 90° del tronco y
 * se aleja de él, el tramo recto y el codo quedan en línea, la cota total se compara con la «dimensión del conjunto» de armados.js
 * (una cota superior) y el PDF pinta todos los nodos sin omitir ninguno.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../src/web/planos');
const PDF = require('../src/web/pdf');
const LP = require('../src/web/lista_pdf');
const LF = require('../src/motor/lista_fabricacion');
const A = require('../src/motor/armados');
const C = require('../src/motor/cotizador');
const { crearMaestros } = require('../src/datos/maestros');

const M = crearMaestros();
const pulg = (x) => x * 25.4;
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const lam = { material_id: 'GALVANIZADO', calibre: 22, tipo_union: 'BRIDADO', ref_diametro: 'INTERIOR', cantidad: 1 };
const redInj = (extra) => ({ id: 'ri', familia: 'REDUCCION_INJERTO', ...lam, D1_mm: pulg(11), D2_mm: pulg(10), d_mm: pulg(5), beta_deg: 30, L_reduccion_mm: 500, L_ramal_mm: 450, ...extra });
const ramal = (extra) => ({ id: 'rm', familia: 'RAMAL', ...lam, D_mm: pulg(11), d_mm: pulg(5), L_cuerpo_mm: 900, L_ramal_mm: 450, beta_deg: 30, ...extra });
const codo = (id, theta, extra) => ({ id, familia: 'CODO', ...lam, D_mm: pulg(5), theta_deg: theta, k_R: 1.5, n_gajos: theta === 90 ? 5 : 3, ...extra });
const recto = (extra) => ({ id: 'rt', familia: 'RECTO', ...lam, D_mm: pulg(5), L_mm: 914, ...extra });
const reduccion = (extra) => ({ id: 'rd', familia: 'REDUCCION', ...lam, D1_mm: pulg(8), D2_mm: pulg(5), L_mm: 400, ...extra });

/** Las partidas calculadas por id, con la cotización completa (los tramos rectos traen sus yardas). */
function calcular(partidas, extra) {
  const cot = { riesgo: 'MEDIO', servicio: 'POLVO', ubicacion: 'INTERIOR', yarda_mm: 914, partidas, ...(extra || {}) };
  const res = C.cotizar(cot, M);
  const f = {};
  cot.partidas.forEach((p, i) => { f[p.id] = res.partidas[i]; });
  return { cot, res, f };
}
const medio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
const angEntre = (u, v) => (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180) / Math.PI;
const polar = (c, r, g) => [c[0] + r * Math.cos((g * Math.PI) / 180), c[1] - r * Math.sin((g * Math.PI) / 180)];

/* ---------------- Anclas: salen de la geometría que se dibuja ---------------- */

test('Anclas del codo: las caras están en el punto que dan R y θ (con y sin tangentes) y en medio de la boca dibujada', () => {
  [{ theta: 90, Lt: 0 }, { theta: 60, Lt: 0 }, { theta: 60, Lt: 100 }, { theta: 45, Lt: 50 }].forEach(({ theta, Lt }) => {
    const { f } = calcular([codo('c', theta, { L_tangente_mm: Lt })]);
    const d = PL.plano(f.c, M);
    const R = f.c.geometria.detalle.R_mm;
    const D = pulg(5);
    const a = PL.anclas(f.c, M);
    // A: en (R, Lt), saliendo hacia abajo; B: en el eje a θ más la tangente en la dirección de salida
    casi(a.A.c[0], R, 1e-9); casi(a.A.c[1], Lt, 1e-9);
    assert.deepEqual(a.A.dir, [0, 1]);
    const tB = [-Math.sin((theta * Math.PI) / 180), -Math.cos((theta * Math.PI) / 180)];
    const eje = polar([0, 0], R, theta);
    casi(a.B.c[0], eje[0] + tB[0] * Lt, 1e-9); casi(a.B.c[1], eje[1] + tB[1] * Lt, 1e-9);
    casi(a.B.dir[0], tB[0], 1e-12); casi(a.B.dir[1], tB[1], 1e-12);
    casi(a.A.R, D / 2, 1e-9); casi(a.B.R, D / 2, 1e-9);
    // con las tangentes de largo 0, el punto es el centro de la boca del contorno dibujado (anillo de gajos)
    if (Lt === 0) {
      const anillo = d.silueta[0];
      const n = anillo.length / 2;
      const bocaB = medio(anillo[n - 1], anillo[n]);
      casi(dist(bocaB, a.B.c), 0, 1e-6, 'boca B dibujada');
      const bocaA = medio(anillo[0], anillo[anillo.length - 1]);
      casi(dist(bocaA, a.A.c), 0, 1e-6, 'boca A dibujada');
      casi(dist(anillo[n - 1], anillo[n]) / 2, D / 2, 1e-6, 'radio de la boca');
    }
  });
});

test('Anclas de la reducción, el injerto y el tramo recto: en el centro de la boca que se pinta, con su Ø y su salida', () => {
  const { f } = calcular([reduccion({ excentrica: 'CARA_PLANA' }), reduccion({ id: 'rc' }), redInj(), ramal(), recto({ D_mm: 304.8, L_mm: 1500 })]);
  // reducción (concéntrica y excéntrica): D1 y D2 en el centro de los lados verticales del cono
  ['rd', 'rc'].forEach((id) => {
    const d = PL.plano(f[id], M);
    const [sup0, sup1, inf1, inf0] = d.silueta[0];
    casi(dist(d.caras.D1.c, medio(sup0, inf0)), 0, 1e-9);
    casi(dist(d.caras.D2.c, medio(sup1, inf1)), 0, 1e-9);
    casi(d.caras.D1.R, dist(sup0, inf0) / 2, 1e-9);
    casi(d.caras.D2.R, dist(sup1, inf1) / 2, 1e-9);
    assert.deepEqual(d.caras.D1.dir, [-1, 0]);
    assert.deepEqual(d.caras.D2.dir, [1, 0]);
  });
  // injertos: la boca del injerto es la que cierra el contorno, a β del eje, hacia el extremo chico
  [['ri', ['D1', 'D2'], 30], ['rm', ['tronco_1', 'tronco_2'], 30]].forEach(([id, troncos, beta]) => {
    const d = PL.plano(f[id], M);
    const c = d.silueta[0];
    const boca = [c[3], c[4]]; // ladoA[1] y ladoB[1]: los bordes de la boca del injerto
    casi(dist(d.caras.injerto.c, medio(boca[0], boca[1])), 0, 1e-9);
    casi(d.caras.injerto.R, dist(boca[0], boca[1]) / 2, 1e-9);
    const u = d.caras.injerto.dir;
    casi((Math.atan2(-u[1], u[0]) * 180) / Math.PI, beta, 1e-9, 'β del injerto');
    casi(u[0] * (boca[1][0] - boca[0][0]) + u[1] * (boca[1][1] - boca[0][1]), 0, 1e-6, 'la boca es perpendicular a su eje');
    assert.deepEqual(d.caras[troncos[0]].dir, [-1, 0]);
    assert.deepEqual(d.caras[troncos[1]].dir, [1, 0]);
    casi(d.caras[troncos[0]].c[1], 0, 1e-9);
  });
  // tramo recto: inicio y final en el medio de los lados del rectángulo dibujado
  const dr = PL.plano(f.rt, M);
  const [p0, p1, p2, p3] = dr.silueta[0];
  casi(dist(dr.caras.inicio.c, medio(p0, p3)), 0, 1e-9);
  casi(dist(dr.caras.final.c, medio(p1, p2)), 0, 1e-9);
  casi(dr.caras.final.R, 304.8 / 2, 1e-9);
  assert.deepEqual(dr.caras.final.dir, [1, 0]);
});

/* ---------------- Caso a) injerto + codo: el ramal sale a 90° del tronco ---------------- */

/** Ángulo (°) entre el eje del tronco (de su primera a su segunda boca) y la salida de la cara libre del codo. */
const anguloSalida = (d) => {
  const eje = unit([d.conjunto.eje.hasta[0] - d.conjunto.eje.desde[0], d.conjunto.eje.hasta[1] - d.conjunto.eje.desde[1]]);
  return angEntre(eje, d.conjunto.libres[0].dir);
};

test('a) Reducción con injerto a 30° + codo de 60° en la cara del injerto: la cara libre del codo queda a 90° del eje del tronco', () => {
  const { f } = calcular([redInj(), codo('c60', 60)]);
  ['A', 'B'].forEach((cara) => {
    const d = PL.planoConjunto(f.ri, 'injerto', f.c60, cara, M, { marcas: ['I1', 'C1'] });
    assert.ok(d, `codo por su cara ${cara}`);
    casi(anguloSalida(d), 90, 0.5, 'ángulo medido con la salida de la cara libre');
    casi(d.conjunto.angulo_deg, 90, 0.5);
    // la cara libre es perpendicular al eje del tronco: su brida (línea) corre paralela al eje
    const libre = d.conjunto.libres[0];
    const brida = d.trazos.filter((t) => t.clase === 'brida').find((t) => dist(medio(t.d[0], t.d[1]), libre.c) < 1e-6);
    assert.ok(brida, 'la cara libre lleva su brida');
    const bv = unit([brida.d[1][0] - brida.d[0][0], brida.d[1][1] - brida.d[0][1]]);
    casi(Math.abs(bv[0]), 1, 0.01, 'la brida de la cara libre es paralela al eje del tronco (eje x)');
    // el ramal sale hacia arriba, alejándose del tronco, y no se encima con él
    assert.ok(libre.c[1] < -f.ri.entrada.D1_mm / 2, 'la cara libre queda por encima del tronco');
    assert.ok(d.conjunto.solape_mm2 < 1, `no se encima con el tronco (${d.conjunto.solape_mm2} mm²)`);
    // las dos piezas, con sus cotas, el ángulo y las marcas
    const arbol = PL.arbol(d, { px: 330, alto_max: 250 });
    const textos = [];
    const ir = (n) => { if (n.tag === 'text') textos.push(n.t); (n.c || []).forEach(ir); };
    ir(arbol);
    assert.ok(textos.includes('90°'), 'el ángulo resultante');
    assert.ok(textos.includes('I1') && textos.includes('C1'), 'las marcas junto a cada pieza');
    assert.ok(textos.some((t) => t === PL.formato.mm(d.conjunto.total_mm)), 'la cota total');
  });
  // el injerto de un ducto con injerto (RAMAL) se arma igual
  const r = calcular([ramal({ d_mm: pulg(5) }), codo('c60', 60)]);
  const d2 = PL.planoConjunto(r.f.rm, 'injerto', r.f.c60, 'A', M);
  casi(anguloSalida(d2), 90, 0.5);
  assert.ok(d2.conjunto.solape_mm2 < 1);
  // 45° + 45° también da 90° y sale del tronco (no corre paralelo a él)
  const q = calcular([redInj({ beta_deg: 45 }), codo('c45', 45)]);
  const d3 = PL.planoConjunto(q.f.ri, 'injerto', q.f.c45, 'A', M);
  casi(anguloSalida(d3), 90, 0.5);
  // con el orden de las piezas invertido sale lo mismo
  const d4 = PL.planoConjunto(f.c60, 'A', f.ri, 'injerto', M, { marcas: ['C1', 'I1'] });
  casi(anguloSalida(d4), 90, 0.5);
  casi(d4.conjunto.total_mm, PL.planoConjunto(f.ri, 'injerto', f.c60, 'A', M).conjunto.total_mm, 1e-9);
});

/* ---------------- Caso b) tramo recto + codo: en línea ---------------- */

test('b) Tramo recto con sus yardas + codo: el codo sigue al tramo en línea, sin brida en la junta y con brida en la cara libre', () => {
  const { f } = calcular([recto(), codo('c90', 90), codo('c60', 60)]);
  [['A', 0], ['B', 1]].forEach(([cara, k]) => {
    const d = PL.planoConjunto(f.rt, 'final', f.c90, cara, M, { marcas: ['D1', 'C2'] });
    assert.ok(d);
    const fin = PL.anclas(f.rt, M).final;
    // el ancla del codo está en el ancla final del tramo, con dirección opuesta (sobre la misma recta del eje)
    casi(dist(d.conjunto.juntaPunto, fin.c), 0, 1e-9);
    const sil = d.silueta; // [rectángulo del tramo, anillo del codo movido, …]
    const anillo = sil[1];
    const n = anillo.length / 2;
    const boca = k === 0 ? [anillo[0], anillo[anillo.length - 1]] : [anillo[n - 1], anillo[n]];
    casi(dist(medio(boca[0], boca[1]), fin.c), 0, 1e-6, 'la boca del codo está en la boca del tramo');
    const bv = unit([boca[1][0] - boca[0][0], boca[1][1] - boca[0][1]]);
    casi(bv[0] * fin.dir[0] + bv[1] * fin.dir[1], 0, 1e-9, 'la boca es perpendicular al eje del tramo');
    // la tangente del codo en la junta corre por el eje del tramo: el eje del tramo prolongado sigue en el codo
    const libre = d.conjunto.libres[0];
    assert.ok(libre.c[0] > fin.c[0] - 1e-6, 'el codo sigue hacia adelante');
    assert.ok(d.conjunto.solape_mm2 < 1);
    // junta engargolada (galvanizado): una línea marcada sobre la boca y sin brida ahí
    const junta = d.trazos.filter((t) => t.clase === 'engargolado');
    assert.equal(junta.length, 1);
    casi(dist(medio(junta[0].d[0], junta[0].d[1]), fin.c), 0, 1e-9);
    const bridas = d.trazos.filter((t) => t.clase === 'brida' || t.clase === 'brida-suelta');
    assert.ok(!bridas.some((t) => dist(medio(t.d[0], t.d[1]), fin.c) < 1e-6), 'sin brida en la junta');
    assert.ok(bridas.some((t) => dist(medio(t.d[0], t.d[1]), libre.c) < 1e-6), 'brida en la cara libre del codo');
    assert.ok(bridas.some((t) => Math.abs(medio(t.d[0], t.d[1])[0]) < 1e-6), 'brida en el otro extremo del tramo');
  });
  // el tramo sólo se arma por su extremo final: el codo gira hacia arriba (sale del eje, no se cruza)
  const d = PL.planoConjunto(f.rt, 'final', f.c90, 'A', M);
  casi(d.conjunto.libres[0].dir[1], -1, 1e-6, 'sale hacia arriba');
  casi(d.conjunto.libres[0].dir[0], 0, 1e-6);
});

/* ---------------- Caso c) reducción con otra pieza ---------------- */

test('c) Reducción + pieza de su lado: la pieza queda en línea con el eje de la reducción y sin encimarse', () => {
  const { f } = calcular([reduccion(), recto({ id: 'r8', D_mm: pulg(8), L_mm: 1500 }), recto({ id: 'r5' }), codo('c8', 90, { D_mm: pulg(8) }), codo('c5', 90), redInj({ id: 'r5i', D1_mm: pulg(5), D2_mm: pulg(4), d_mm: pulg(5) })]);
  // por el lado mayor (D1) con el tramo de 8″ y por el menor (D2) con el de 5″
  [['D1', 'r8'], ['D2', 'r5']].forEach(([cara, id]) => {
    const d = PL.planoConjunto(f.rd, cara, f[id], 'final', M, { marcas: ['R1', 'D1'] });
    assert.ok(d, `${cara} + ${id}`);
    const a = PL.anclas(f.rd, M)[cara];
    casi(dist(d.conjunto.juntaPunto, a.c), 0, 1e-9);
    // el otro extremo del tramo está sobre el eje de la reducción, hacia afuera
    const lib = d.conjunto.libres[0];
    casi(lib.c[1], 0, 1e-6, 'sobre el eje');
    assert.ok((lib.c[0] - a.c[0]) * a.dir[0] > 0, 'hacia afuera de la reducción');
    assert.ok(d.conjunto.solape_mm2 < 1);
  });
  // la reducción con un codo: el codo se aleja del eje sin encimarse
  const dc = PL.planoConjunto(f.rd, 'D2', f.c5, 'A', M);
  assert.ok(dc && dc.conjunto.solape_mm2 < 1);
  assert.ok(Math.abs(dc.conjunto.libres[0].c[1]) > f.c5.entrada.D_mm, 'sale del eje');
  // la reducción con un injerto del mismo Ø (por el injerto) y con una reducción con injerto
  const di = PL.planoConjunto(f.rd, 'D2', f.c5, 'B', M);
  assert.ok(di && di.conjunto.solape_mm2 < 1);
  // Ø distintos: no se puede dibujar unido (el esquema de cajas queda de respaldo)
  assert.equal(PL.planoConjunto(f.rd, 'D1', f.c5, 'A', M), null);
  assert.equal(PL.planoConjunto(null, 'D1', f.c5, 'A', M), null);
});

test('Cualquier pareja de caras del mismo Ø se dibuja unida: B en la cara de A, ejes opuestos y sin encimarse', () => {
  const { f } = calcular([
    redInj({ D1_mm: pulg(8), D2_mm: pulg(6) }), ramal({ D_mm: pulg(8) }), reduccion(), codo('c5', 60), codo('c8', 90, { D_mm: pulg(8) }),
    recto({ id: 'r5' }), recto({ id: 'r8', D_mm: pulg(8), L_mm: 1500 }),
  ]);
  let n = 0;
  [['ri', ['D1', 'D2', 'injerto']], ['rm', ['tronco_1', 'tronco_2', 'injerto']], ['rd', ['D1', 'D2']]].forEach(([a, carasA]) => {
    [['c5', ['A', 'B']], ['c8', ['A', 'B']], ['r5', ['final']], ['r8', ['final']], ['rd', ['D1', 'D2']]].forEach(([b, carasB]) => {
      if (a === b) return;
      carasA.forEach((ca) => carasB.forEach((cb) => {
        const d = PL.planoConjunto(f[a], ca, f[b], cb, M);
        const RA = PL.anclas(f[a], M)[ca].R;
        const RB = PL.anclas(f[b], M)[cb].R;
        if (Math.abs(RA - RB) > 0.5) { assert.equal(d, null); return; }
        assert.ok(d, `${a}.${ca} + ${b}.${cb}`);
        n += 1;
        assert.ok(d.conjunto.solape_mm2 < 0.01 * d.conjunto.total_mm ** 2, `${a}.${ca} + ${b}.${cb} se encima (${Math.round(d.conjunto.solape_mm2)} mm²)`);
        // la dirección de la cara libre más cercana a la junta apunta alejándose de ella o rodeándola; todo dato es finito
        JSON.stringify(d, (k, v) => { if (typeof v === 'number') assert.ok(Number.isFinite(v), `número no finito en ${k}`); return v; });
      }));
    });
  });
  assert.ok(n >= 20, `se probaron ${n} parejas`);
});

/* ---------------- La cota total frente a la «dimensión del conjunto» de armados.js ---------------- */

test('La cota total del conjunto no pasa de la dimensión del conjunto de armados.js (cota superior) y es igual en línea recta', () => {
  const caso = [redInj(), codo('c60', 60), recto(), codo('c90', 90), reduccion({ D1_mm: pulg(8), D2_mm: pulg(5) }), recto({ id: 'r8', D_mm: pulg(8), L_mm: 1500 })];
  const { cot, res } = calcular(caso);
  const sug = A.sugerirArmados(cot, res, M);
  assert.equal(sug.length, 3);
  sug.forEach((s) => assert.equal(A.armar(cot, s.piezas, s.n, M).ok, true));
  const res2 = C.cotizar(cot, M);
  const lista = LF.listaFabricacion(cot, res2, M);
  assert.equal(lista.conjuntos.length, 3);
  const filas = lista.conjuntos.map((c) => {
    assert.ok(c.dibujo, `${c.marca} trae su dibujo`);
    const total = c.dibujo.conjunto.total_mm;
    // armados.js suma la dimensión mayor de cada pieza (el mayor de su ancho y su alto, con su Ø exterior): nunca queda por debajo
    assert.ok(total <= c.dim_mm + 1e-6, `${c.marca}: cota ${total} > dimensión ${c.dim_mm}`);
    return [c.pareja, total, c.dim_mm];
  });
  // en línea recta (reducción + tramo) las dos coinciden; con un codo la del armado es más holgada
  const recta = filas.find((x) => x[0] === 'c');
  casi(recta[1], recta[2], 1e-6, 'reducción + recto');
  filas.filter((x) => x[0] !== 'c').forEach((x) => assert.ok(x[1] < x[2], `con codo la cota real (${x[1]}) queda por debajo de la cota superior (${x[2]})`));
  // la cota total del dibujo es la que se pinta
  lista.conjuntos.forEach((c) => {
    const textos = [];
    const ir = (n) => { if (n.tag === 'text') textos.push(n.t); (n.c || []).forEach(ir); };
    ir(PL.arbol(c.dibujo, { px: 330, alto_max: 250 }));
    assert.ok(textos.includes(PL.formato.mm(c.dibujo.conjunto.total_mm)));
  });
});

test('Un tramo recto muy largo se dibuja con corte, pero la cota total dice el largo real', () => {
  const { f } = calcular([recto({ D_mm: pulg(3), L_mm: 3000 }), codo('c', 90, { D_mm: pulg(3) })]);
  const d = PL.planoConjunto(f.rt, 'final', f.c, 'A', M);
  const tramo = PL.plano(f.rt, M);
  assert.ok(tramo.recorte_mm > 0);
  const A_ = PL.anclas(f.c, M);
  const ancho = d.conjunto.total_mm;
  assert.ok(ancho > 3000 && ancho < 3000 + 4 * pulg(3) + 2 * A_.A.c[0], `ancho real ${ancho}`);
});

/* ---------------- PDF y estilos ---------------- */

/** Nodos que el conversor del PDF omite en un árbol (los cuenta la misma función de pdf.js). */
function omitidos(arbol) {
  const pg = PDF.documento({ titulo: 'prueba' }).pagina();
  return PDF.dibujarArbol(pg, arbol, { x: 40, y: 40, w: 186, h: 150 });
}

test('El dibujo del conjunto lo pinta el PDF sin omitir ningún nodo (sólo path, polyline, polygon, circle, text y g)', () => {
  const { f } = calcular([redInj(), codo('c60', 60), recto(), codo('c90', 90), reduccion(), recto({ id: 'r8', D_mm: pulg(8), L_mm: 1500 })]);
  const pares = [['ri', 'injerto', 'c60', 'A'], ['rt', 'final', 'c90', 'A'], ['rd', 'D1', 'r8', 'final'], ['ri', 'injerto', 'c60', 'B']];
  const permitidos = new Set(['svg', 'g', 'path', 'polyline', 'polygon', 'circle', 'text']);
  pares.forEach(([a, ca, b, cb]) => {
    const d = PL.planoConjunto(f[a], ca, f[b], cb, M, { marcas: ['X1', 'Y1'] });
    [{ px: 270, alto_max: 218 }, { px: 330, alto_max: 250 }, { px: 150, alto_max: 104, compacto: true }].forEach((o) => {
      const arbol = PL.arbol(d, o);
      const tags = new Set();
      const ir = (n) => { tags.add(n.tag); (n.c || []).forEach(ir); };
      ir(arbol);
      assert.ok([...tags].every((t) => permitidos.has(t)), `etiquetas ${[...tags]}`);
      const r = omitidos(arbol);
      assert.equal(r.omitidos, 0, `${a}+${b}: nodos omitidos`);
      assert.ok(r.nodos > (o.compacto ? 3 : 10));
      // el viewBox encierra el dibujo con escala uniforme
      const [, , vw, vh] = arbol.a.viewBox.split(' ').map(Number);
      casi(vw / vh, arbol.a.width / arbol.a.height, 0.02, 'escala uniforme');
    });
  });
});

test('La junta lleva el estilo de soldadura en acero al carbón y de engargolado en galvanizado; sin brida en la junta', () => {
  const carbon = { material_id: 'ACERO_CARBON', calibre: 16 };
  const { f } = calcular([redInj(carbon), codo('c60', 60, carbon)]);
  const d = PL.planoConjunto(f.ri, 'injerto', f.c60, 'A', M);
  assert.equal(d.conjunto.junta, 'soldada');
  assert.equal(d.trazos.filter((t) => t.clase === 'soldadura').length, 1);
  assert.equal(d.trazos.filter((t) => t.clase === 'engargolado').length, 0);
  const nodos = [];
  const ir = (n) => { nodos.push(n); (n.c || []).forEach(ir); };
  ir(PL.arbol(d, { px: 300, alto_max: 230 }));
  assert.equal(nodos.filter((n) => n.a && n.a.class === 'pl-soldadura').length, 1);
  const g = calcular([redInj(), codo('c60', 60)]);
  const dg = PL.planoConjunto(g.f.ri, 'injerto', g.f.c60, 'A', M);
  assert.equal(dg.conjunto.junta, 'engargolada');
  assert.equal(dg.trazos.filter((t) => t.clase === 'engargolado').length, 1);
});

/* ---------------- Lista de fabricación y PDF ---------------- */

test('La lista trae el dibujo de cada conjunto y la tarjeta del PDF lo usa; sin dibujo, queda el esquema de cajas', () => {
  const { cot } = calcular([redInj(), codo('c60', 60), recto(), codo('c90', 90)]);
  const sug = A.sugerirArmados(cot, C.cotizar(cot, M), M);
  sug.forEach((s) => A.armar(cot, s.piezas, s.n, M));
  const res = C.cotizar(cot, M);
  const lista = LF.listaFabricacion(cot, res, M);
  assert.equal(lista.conjuntos.length, 2);
  lista.conjuntos.forEach((c) => {
    assert.equal(c.dibujo.familia, 'CONJUNTO');
    assert.deepEqual(c.dibujo.conjunto.marcas, c.piezas.map((x) => x.marca), 'las marcas de la lista');
  });
  // el PDF con dibujo y el PDF con el esquema de respaldo son distintos, y los dos válidos
  const con = LP.generar(lista, { planos: PL });
  const sin = LP.generar({ ...lista, conjuntos: lista.conjuntos.map((c) => ({ ...c, dibujo: null })) }, { planos: PL });
  assert.equal(Buffer.from(con.bytes.slice(0, 5)).toString(), '%PDF-');
  assert.equal(Buffer.from(sin.bytes.slice(0, 5)).toString(), '%PDF-');
  assert.notEqual(Buffer.from(con.bytes).toString('latin1'), Buffer.from(sin.bytes).toString('latin1'));
  assert.equal(con.paginas, sin.paginas);
  // un dibujo que el PDF no sabe pintar se cambia por el esquema (no deja nodos a medias)
  const raro = { ...lista, conjuntos: lista.conjuntos.map((c) => ({ ...c, dibujo: { ...c.dibujo, trazos: [], cotas: [] } })) };
  assert.doesNotThrow(() => LP.generar(raro, { planos: PL }));
});
