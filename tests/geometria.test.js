'use strict';
/**
 * Verificación de la geometría contra oráculos independientes:
 *  - mallas 3D de triángulos (sin usar las fórmulas cerradas del motor),
 *  - promedios numéricos por fuerza bruta,
 *  - identidades exactas (Pappus, desarrollo del cono).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/motor/util');
const G = require('../src/motor/geometria');
const { crearMaestros } = require('../src/datos/maestros');

const M = crearMaestros();
const PI = Math.PI;
const E_16 = 0.0598 * 25.4; // espesor calibre 16 MSG, mm

function casi(real, esperado, tolRel, msg) {
  const tol = tolRel * Math.max(Math.abs(esperado), 1e-12);
  assert.ok(Math.abs(real - esperado) <= tol, `${msg || ''} esperado ${esperado}, obtenido ${real} (Δrel ${(Math.abs(real - esperado) / Math.abs(esperado)).toExponential(2)})`);
}

/* ---------- utilidades vectoriales para las mallas ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.sqrt(dot(a, a));
const unit = (a) => mul(a, 1 / norma(a));
const triArea = (p, q, r) => 0.5 * norma(cross(sub(q, p), sub(r, p)));

/** Área lateral del codo segmentado construido como polígono circunscrito al arco de eje (malla 3D). */
function mallaCodo(r, R, thetaDeg, nG, N = 900) {
  const theta = (thetaDeg * PI) / 180;
  const j = nG - 1;
  const alfa = theta / j;
  const pt = (a, rad) => [rad * Math.cos(a), rad * Math.sin(a), 0];
  const pts = [pt(0, R)];
  for (let i = 1; i <= j; i += 1) pts.push(pt(alfa * (i - 0.5), R / Math.cos(alfa / 2)));
  pts.push(pt(theta, R));
  const nseg = pts.length - 1;
  const dirs = [];
  for (let i = 0; i < nseg; i += 1) dirs.push(unit(sub(pts[i + 1], pts[i])));
  let area = 0;
  for (let i = 0; i < nseg; i += 1) {
    const A = pts[i];
    const B = pts[i + 1];
    const d = dirs[i];
    const nA = i === 0 ? d : unit(add(dirs[i - 1], d));
    const nB = i === nseg - 1 ? d : unit(add(d, dirs[i + 1]));
    const u = unit(cross(d, [0, 0, 1]));
    const v = cross(d, u);
    let prev = null;
    for (let k = 0; k <= N; k += 1) {
      const phi = (2 * PI * k) / N;
      const w = add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi)));
      const sA = (-r * dot(w, nA)) / dot(d, nA);
      const sB = (-r * dot(w, nB)) / dot(d, nB);
      const p0 = add(add(A, mul(d, sA)), mul(w, r));
      const p1 = add(add(B, mul(d, sB)), mul(w, r));
      if (prev) area += triArea(prev[0], prev[1], p0) + triArea(prev[1], p1, p0);
      prev = [p0, p1];
    }
  }
  return area;
}

/** Malla explícita de la transición redondo → rectángulo: 4 triángulos planos + 4 abanicos cónicos. */
function mallaTransicionRR(a, b, r, H, N = 600) {
  let area = 0;
  const lados = [
    [[a / 2, -b / 2, 0], [a / 2, b / 2, 0], [r, 0, H]],
    [[-a / 2, -b / 2, 0], [-a / 2, b / 2, 0], [-r, 0, H]],
    [[-a / 2, b / 2, 0], [a / 2, b / 2, 0], [0, r, H]],
    [[-a / 2, -b / 2, 0], [a / 2, -b / 2, 0], [0, -r, H]],
  ];
  lados.forEach(([p, q, ap]) => { area += triArea(p, q, ap); });
  [[[a / 2, b / 2, 0], 0], [[-a / 2, b / 2, 0], PI / 2], [[-a / 2, -b / 2, 0], PI], [[a / 2, -b / 2, 0], (3 * PI) / 2]].forEach(([C, f0]) => {
    for (let i = 0; i < N; i += 1) {
      const fa = f0 + ((PI / 2) * i) / N;
      const fb = f0 + ((PI / 2) * (i + 1)) / N;
      area += triArea(C, [r * Math.cos(fa), r * Math.sin(fa), H], [r * Math.cos(fb), r * Math.sin(fb), H]);
    }
  });
  return area;
}

/* ====================================================================== */

test('Tramo recto redondo: A = (π·D_med + holgura de costura)·L', () => {
  const PF = G.perfilFabricacion({ familia: 'RECTO', D_mm: 304.8, L_mm: 3000 }, E_16, M);
  const Dmed = 304.8 + E_16;
  casi(PF.A_neta_m2, ((PI * Dmed + 1.0) * 3000) / 1e6, 1e-12);
  assert.equal(PF.n_piezas, 1);
  assert.equal(PF.extremos.length, 2);
});

test('Tramo recto: se divide en piezas por longitud máxima y cada pieza tiene 2 extremos', () => {
  const PF = G.perfilFabricacion({ familia: 'RECTO', D_mm: 600, L_mm: 7000 }, E_16, M);
  assert.equal(PF.n_piezas, 3);
  assert.equal(PF.extremos.length, 6);
  casi(PF.detalle.L_pieza_mm, 7000 / 3, 1e-12);
});

test('Tramo recto: referencia EXTERIOR desplaza D_med hacia adentro', () => {
  const int = G.perfilFabricacion({ familia: 'RECTO', D_mm: 300, L_mm: 1000 }, E_16, M);
  const ext = G.perfilFabricacion({ familia: 'RECTO', D_mm: 300, L_mm: 1000, ref_diametro: 'EXTERIOR' }, E_16, M);
  casi(int.detalle.D_med_mm, 300 + E_16, 1e-12);
  casi(ext.detalle.D_med_mm, 300 - E_16, 1e-12);
});

test('Tramo recto rectangular: perímetro medio 2(a+b+2e)', () => {
  const PF = G.perfilFabricacion({ familia: 'RECTO', forma: 'RECTANGULAR', a_mm: 500, b_mm: 300, L_mm: 2000, tipo_costura: 'PITTSBURGH' }, 1.0, M);
  const P = 2 * (500 + 1 + 300 + 1);
  casi(PF.A_neta_m2, ((P + 32) * 2000) / 1e6, 1e-12);
  assert.equal(PF.sold.tope_m + PF.sold.filete_m, 0, 'Pittsburgh es costura mecánica, no se suelda');
  casi(PF.engargolado_m, 2, 1e-12);
});

test('Codo segmentado 90°, 5 gajos, R/D=1.5: λ = 2.38695 y F = tan(α/2)/(α/2)', () => {
  const PF = G.perfilFabricacion({ familia: 'CODO', D_mm: 304.8, theta_deg: 90, n_gajos: 5 }, E_16, M);
  casi(PF.detalle.lambda_L_eje_sobre_D, 8 * 1.5 * Math.tan(PI / 16), 1e-12);
  casi(PF.detalle.lambda_L_eje_sobre_D, 2.38695, 2e-5);
  const alfa = PI / 2 / 4;
  casi(PF.detalle.F_arco, Math.tan(alfa / 2) / (alfa / 2), 1e-12);
  casi(PF.detalle.F_arco, 1.013053, 2e-6);
  assert.equal(PF.detalle.n_gajos, 5);
  assert.equal(PF.n_juntas_internas, 4);
});

test('Codo segmentado: gajos por defecto con α_max = 22.5°', () => {
  const g = (th) => G.perfilFabricacion({ familia: 'CODO', D_mm: 300, theta_deg: th }, E_16, M).detalle.n_gajos;
  assert.deepEqual([g(90), g(60), g(45), g(30), g(15)], [5, 4, 3, 3, 2]);
});

test('Codo segmentado: el área coincide con la malla 3D del polígono circunscrito', () => {
  [[90, 5, 1.5], [90, 3, 1.5], [60, 4, 2.0], [45, 3, 1.5], [90, 7, 2.0]].forEach(([th, ng, kR]) => {
    const D = 300;
    const PF = G.perfilFabricacion({ familia: 'CODO', D_mm: D, theta_deg: th, n_gajos: ng, k_R: kR, ref_diametro: 'INTERIOR' }, E_16, M);
    const Dmed = D + E_16;
    const malla = mallaCodo(Dmed / 2, kR * D, th, ng) / 1e6;
    casi(PF.A_neta_m2, malla, 5e-5, `θ=${th} n=${ng} R/D=${kR}`);
  });
});

test('Codo segmentado: junta elíptica κ = √(1 + tan²(α/2)/2) ≈ perímetro de la elipse', () => {
  [11.25, 15, 22.5, 30].forEach((gamma) => {
    const g = (gamma * PI) / 180;
    const a = 1 / Math.cos(g);
    let per = 0;
    let prev = [a, 0];
    const N = 40000;
    for (let k = 1; k <= N; k += 1) {
      const t = (2 * PI * k) / N;
      const cur = [a * Math.cos(t), Math.sin(t)];
      per += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      prev = cur;
    }
    casi(Math.sqrt(1 + Math.tan(g) ** 2 / 2), per / (2 * PI), 2e-3, `γ=${gamma}°`);
  });
});

test('Codo rectangular de radio: A = P_med · θ · R (teorema de Pappus)', () => {
  const PF = G.perfilFabricacion({ familia: 'CODO', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, theta_deg: 90, k_R: 1.5 }, 1.2, M);
  const P = 2 * (401.2 + 301.2);
  casi(PF.A_neta_m2, (P * (PI / 2) * 600) / 1e6, 1e-12);
});

test('Reducción concéntrica: A = π/2 (D1+D2) s y patrón plano consistente', () => {
  const PF = G.perfilFabricacion({ familia: 'REDUCCION', D1_mm: 400, D2_mm: 200, L_mm: 500 }, E_16, M);
  const D1 = 400 + E_16;
  const D2 = 200 + E_16;
  const s = Math.sqrt(500 ** 2 + ((D1 - D2) / 2) ** 2);
  casi(PF.A_neta_m2, ((PI / 2) * (D1 + D2) * s) / 1e6, 1e-9);
  const { R1_mm, R2_mm, sector_deg } = PF.detalle.patron;
  const area_sector = 0.5 * ((sector_deg * PI) / 180) * (R1_mm ** 2 - R2_mm ** 2);
  casi(area_sector / 1e6, PF.A_neta_m2, 1e-9);
  casi(R1_mm - R2_mm, s, 1e-9, 'R1 − R2 = generatriz');
});

test('Reducción excéntrica (cara plana): coincide con la malla reglada y excede ligeramente a la concéntrica', () => {
  const conc = G.perfilFabricacion({ familia: 'REDUCCION', D1_mm: 400, D2_mm: 200, L_mm: 500 }, E_16, M);
  const exc = G.perfilFabricacion({ familia: 'REDUCCION', D1_mm: 400, D2_mm: 200, L_mm: 500, excentrica: 'CARA_PLANA' }, E_16, M);
  assert.ok(exc.A_neta_m2 > conc.A_neta_m2);
  assert.ok(exc.A_neta_m2 / conc.A_neta_m2 < 1.03);
  // malla reglada independiente: círculo base r1 en z=0, tapa r2 desplazada c = r1 − r2 en z = L
  const r1 = (400 + E_16) / 2;
  const r2 = (200 + E_16) / 2;
  const c = r1 - r2;
  const P = (phi, t) => [(1 - t) * r1 * Math.cos(phi) + t * (c + r2 * Math.cos(phi)), (1 - t) * r1 * Math.sin(phi) + t * r2 * Math.sin(phi), t * 500];
  let area = 0;
  const N = 720;
  const Mt = 24;
  for (let i = 0; i < N; i += 1) {
    const f0 = (2 * PI * i) / N;
    const f1 = (2 * PI * (i + 1)) / N;
    for (let m = 0; m < Mt; m += 1) {
      const a = P(f0, m / Mt);
      const b = P(f1, m / Mt);
      const cc = P(f1, (m + 1) / Mt);
      const d = P(f0, (m + 1) / Mt);
      area += triArea(a, b, cc) + triArea(a, cc, d);
    }
  }
  casi(exc.A_neta_m2, area / 1e6, 2e-5);
});

test('Reducción: advierte si el semiángulo excede el máximo recomendado', () => {
  const PF = G.perfilFabricacion({ familia: 'REDUCCION', D1_mm: 600, D2_mm: 200, L_mm: 300 }, E_16, M);
  assert.ok(PF.advertencias.some((x) => /Semiángulo/.test(x)));
});

test('Transición redondo → rectángulo: área = malla 3D de triángulos + conos', () => {
  [[400, 400, 300, 400], [600, 400, 300, 500], [500, 300, 400, 350]].forEach(([a, b, D, H]) => {
    const e = 1.2;
    const PF = G.perfilFabricacion({ familia: 'TRANSICION', D_mm: D, a_mm: a, b_mm: b, H_mm: H }, e, M);
    const malla = mallaTransicionRR(a + e, b + e, (D + e) / 2, H) / 1e6;
    casi(PF.A_neta_m2, malla, 2e-5, `a=${a} b=${b} D=${D} H=${H}`);
    casi(PF.detalle.A_aprox_semisuma_m2, PF.A_neta_m2, 0.03, 'aprox. ½(P1+P2)s dentro de ±3 %');
  });
});

test('Ramal: t medio exacto = promedio por fuerza bruta de la distancia de silleta', () => {
  const Rm = 200;
  [[75, 90], [100, 45], [100, 30], [150, 60]].forEach(([rb, betaDeg]) => {
    const beta = (betaDeg * PI) / 180;
    const k = rb / Rm;
    const N = 200000;
    let s = 0;
    for (let i = 0; i < N; i += 1) {
      const phi = (2 * PI * (i + 0.5)) / N;
      s += (Math.sqrt(Rm * Rm - (rb * Math.sin(phi)) ** 2) - rb * Math.cos(phi) * Math.cos(beta)) / Math.sin(beta);
    }
    casi((Rm / Math.sin(beta)) * G.razonElipticaE(k), s / N, 1e-6, `rb=${rb} β=${betaDeg}`);
  });
});

test('Ramal: factor de orificio K(k) = 1 + k²/8 + 3k⁴/64 + … ; K(0)=1', () => {
  casi(G.factorOrificio(0), 1, 1e-12);
  [0.2, 0.375, 0.5].forEach((k) => {
    const serie = 1 + k ** 2 / 8 + (3 * k ** 4) / 64 + (25 * k ** 6) / 1024;
    casi(G.factorOrificio(k), serie, 2e-4, `k=${k}`);
  });
});

test('Ramal en ángulo: área neta = cuerpo − orificio + ramal; requiere L_ramal suficiente', () => {
  const p = { familia: 'RAMAL', D_mm: 400, d_mm: 200, L_cuerpo_mm: 800, L_ramal_mm: 500, beta_deg: 45 };
  const PF = G.perfilFabricacion(p, E_16, M);
  casi(PF.A_neta_m2, PF.detalle.A_cuerpo_m2 - PF.A_orificio_m2 + PF.detalle.A_ramal_m2, 1e-12);
  assert.equal(PF.extremos.length, 3);
  assert.throws(() => G.perfilFabricacion({ ...p, L_ramal_mm: 100 }, E_16, M), U.ErrorValidacion);
  assert.throws(() => G.perfilFabricacion({ ...p, d_mm: 500 }, E_16, M), U.ErrorValidacion);
});

test('Pantalón: advierte cuando los ramales no conservan la sección del tronco', () => {
  const ok = G.perfilFabricacion({ familia: 'PANTALON', D_mm: 500, d1_mm: 354, d2_mm: 354, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500 }, E_16, M);
  assert.ok(!ok.advertencias.some((x) => /conserva sección/.test(x)));
  const mal = G.perfilFabricacion({ familia: 'PANTALON', D_mm: 500, d1_mm: 500, d2_mm: 500, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500 }, E_16, M);
  assert.ok(mal.advertencias.some((x) => /conserva sección/.test(x)));
});

test('Simpson e interpolación', () => {
  casi(U.simpson(Math.sin, 0, PI, 100), 2, 1e-8);
  assert.equal(U.interpolar([[1, 10], [2, 20]], 1.5), 15);
  assert.equal(U.interpolar([[1, 10], [2, 20]], 0), 10);
  assert.equal(U.interpolar([[1, 10], [2, 20]], 9), 20);
  assert.equal(U.techoMultiplo(7.4, 4), 8);
  assert.equal(U.techoMultiplo(8, 4), 8);
});
