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

test('Injerto simple: área neta = tronco − orificio + injerto; requiere L_ramal suficiente', () => {
  const p = { familia: 'RAMAL', D_mm: 400, d_mm: 200, L_cuerpo_mm: 800, L_ramal_mm: 500, beta_deg: 45 };
  const PF = G.perfilFabricacion(p, E_16, M);
  casi(PF.A_neta_m2, PF.detalle.A_cuerpo_m2 - PF.A_orificio_m2 + PF.detalle.A_ramal_m2, 1e-12);
  assert.equal(PF.extremos.length, 3);
  assert.throws(() => G.perfilFabricacion({ ...p, L_ramal_mm: 100 }, E_16, M), U.ErrorValidacion);
  assert.throws(() => G.perfilFabricacion({ ...p, d_mm: 500 }, E_16, M), U.ErrorValidacion);
});

/* ---------- oráculos por fuerza bruta del injerto (sin las fórmulas cerradas del motor) ---------- */

/** Distancia media, sobre el eje del injerto, del eje del tronco a la silleta: promedio sobre el ángulo del injerto. */
function tMedioBruto(Rm, rb, betaDeg, N = 200000) {
  const beta = (betaDeg * PI) / 180;
  let s = 0;
  for (let i = 0; i < N; i += 1) {
    const phi = (2 * PI * (i + 0.5)) / N;
    s += (Math.sqrt(Rm * Rm - (rb * Math.sin(phi)) ** 2) - rb * Math.cos(phi) * Math.cos(beta)) / Math.sin(beta);
  }
  return s / N;
}

/**
 * Área del orificio que el injerto abre en el tronco: malla fina sobre la superficie del cilindro principal
 * (eje x, y² + z² = Rm²); el eje del injerto pasa por el origen con dirección (cosβ, sinβ, 0).
 * Un punto de la pared está dentro del injerto si su distancia al eje del injerto es menor que rb.
 */
function orificioBruto(Rm, rb, betaDeg, N = 2400) {
  const beta = (betaDeg * PI) / 180;
  const ux = Math.cos(beta);
  const uy = Math.sin(beta);
  const x0 = (Rm * ux) / uy; // donde el eje del injerto toca la pared
  const hx = (1.4 * rb) / uy;
  const th = Math.asin(Math.min(1, (1.05 * rb) / Rm));
  const dx = (2 * hx) / N;
  const dth = (2 * th) / N;
  let dentro = 0;
  for (let i = 0; i < N; i += 1) {
    const x = x0 - hx + (i + 0.5) * dx;
    for (let j = 0; j < N; j += 1) {
      const t = -th + (j + 0.5) * dth;
      const y = Rm * Math.cos(t);
      const proy = x * ux + y * uy;
      if (x * x + y * y + (Rm * Math.sin(t)) ** 2 - proy * proy < rb * rb) dentro += 1;
    }
  }
  return dentro * Rm * dx * dth;
}

test('Injerto: el orificio de la silleta coincide con la malla de fuerza bruta (30°, 45°, 60°, 90°)', () => {
  [[400, 200, 90], [400, 200, 45], [400, 200, 30], [306.3, 153.9, 45], [306.3, 153.9, 30], [400, 300, 60]].forEach(([D, d, betaDeg]) => {
    const PF = G.perfilFabricacion({ familia: 'RAMAL', D_mm: D, d_mm: d, L_cuerpo_mm: 900, L_ramal_mm: 900, beta_deg: betaDeg }, E_16, M);
    const bruto = orificioBruto((D + E_16) / 2, (d + E_16) / 2, betaDeg);
    casi(PF.A_orificio_m2 * 1e6, bruto, 5e-5, `D=${D} d=${d} β=${betaDeg}`);
  });
});

test('Reducción con injerto: área, corte, soldadura y piezas recalculados de forma independiente', () => {
  const D1 = 400;
  const D2 = 300;
  const d = 200;
  const betaDeg = 30;
  const Lc = 600;
  const Lr = 700;
  const PF = G.perfilFabricacion({ familia: 'REDUCCION_INJERTO', D1_mm: D1, D2_mm: D2, d_mm: d, beta_deg: betaDeg, lado: 'DER', L_cuerpo_mm: Lc, L_ramal_mm: Lr }, E_16, M);

  const beta = (betaDeg * PI) / 180;
  const R1 = (D1 + E_16) / 2; // radios de la fibra neutra
  const R2 = (D2 + E_16) / 2;
  const rb = (d + E_16) / 2;
  const tMed = tMedioBruto(R1, rb, betaDeg);
  const Ah = orificioBruto(R1, rb, betaDeg);
  const delta = R1 - R2;
  const Lcono = delta / Math.tan((15 * PI) / 180); // semiángulo de 15°
  const s = Math.hypot(Lcono, delta);

  const A_tronco = 2 * PI * R1 * Lc;
  const A_injerto = 2 * PI * rb * (Lr - tMed);
  const A_cono = PI * (R1 + R2) * s;
  casi(PF.A_neta_m2 * 1e6, A_tronco - Ah + A_injerto + A_cono, 3e-5, 'área neta = tronco − orificio + injerto + cono');
  casi(PF.detalle.A_cono_m2 * 1e6, A_cono, 1e-9, 'cono');
  casi(PF.detalle.L_reduccion_mm, Lcono, 1e-9, 'largo automático del cono');

  const Ph = 2 * PI * rb * Math.sqrt((1 + 1 / Math.sin(beta) ** 2) / 2); // perímetro de la silleta
  const Bc = 2 * PI * R1 + 1.0; // plantilla del tronco (costura a tope, holgura 1 mm)
  const corte = (2 * (Bc + Lc) + Ph + 2 * (2 * PI * rb + Lr) + 2 * PI * (R1 + R2) + 2 * s) / 1000;
  casi(PF.L_corte_m, corte, 1e-4, 'longitud de corte');
  casi(PF.sold.tope_m, (Lc + (Lr - tMed) + s + 2 * PI * R1) / 1000, 1e-4, 'soldadura a tope: costuras del tronco, injerto y cono + costura tronco–cono');
  casi(PF.sold.filete_m, Ph / 1000, 1e-4, 'soldadura de la silleta');

  assert.equal(PF.n_piezas, 3);
  assert.equal(PF.n_virolas, 3);
  assert.equal(PF.n_juntas_internas, 2);
  assert.equal(PF.extremos.length, 3);
  assert.deepEqual(PF.extremos.map((x) => Number(x.D_ext_mm.toFixed(3))), [Number((D1 + 2 * E_16).toFixed(3)), Number((D2 + 2 * E_16).toFixed(3)), Number((d + 2 * E_16).toFixed(3))]);
  // el rolado conserva el trabajo de cada pieza: cilindros (k = 1) y cono (k = k_conico)
  casi(PF.n_virolas * PF.k_rolado * PF.L_virola_m, Lc / 1000 + Lr / 1000 + (M.proceso.rolado.k_conico * s) / 1000, 1e-9, 'trabajo de rolado');
});

test('Reducción con injerto: el lado (der/izq) sólo identifica la pieza y no cambia ninguna cantidad', () => {
  const base = { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 };
  const der = G.perfilFabricacion({ ...base, lado: 'DER' }, E_16, M);
  const izq = G.perfilFabricacion({ ...base, lado: 'IZQ' }, E_16, M);
  const sinLado = (PF) => JSON.stringify({ ...PF, detalle: { ...PF.detalle, lado: undefined } });
  assert.equal(sinLado(der), sinLado(izq));
  assert.equal(der.detalle.lado, 'DER');
  assert.equal(izq.detalle.lado, 'IZQ');
  assert.equal(G.perfilFabricacion({ ...base }, E_16, M).detalle.lado, 'DER', 'por omisión: derecho');
});

test('Reducción con injerto: sólo 30° o 45° (lista de maestros), D2 < D1, d < D1 y L_ramal suficiente', () => {
  const base = { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45, L_ramal_mm: 600 };
  const ok = (extra) => G.perfilFabricacion({ ...base, ...extra }, E_16, M);
  assert.doesNotThrow(() => ok({ beta_deg: 30 }));
  assert.doesNotThrow(() => ok({ beta_deg: '30' }), 'el ángulo llega como texto desde una lista de la interfaz');
  assert.doesNotThrow(() => ok({ beta_deg: undefined }), 'sin ángulo: el de maestros (45°)');
  [60, 90, 20, 0].forEach((b) => assert.throws(() => ok({ beta_deg: b }), /30° o 45°/, `β = ${b}`));
  assert.throws(() => ok({ D2_mm: 304.8 }), /D2 debe ser menor que D1/);
  assert.throws(() => ok({ D2_mm: 400 }), /D2 debe ser menor que D1/);
  assert.throws(() => ok({ d_mm: 304.8 }), /injerto debe ser de menor diámetro/);
  assert.throws(() => ok({ L_ramal_mm: 100 }), /longitud del injerto debe exceder/);
  assert.throws(() => ok({ lado: 'CENTRO' }), /derecho \(DER\) o izquierdo \(IZQ\)/);
  assert.throws(() => ok({ D1_mm: 0 }), U.ErrorValidacion);
  // la lista de ángulos es un dato de maestros: con otra lista cambia lo permitido
  const M60 = crearMaestros({ proceso: { angulos_injerto_reduccion_deg: [30, 45, 60] } });
  assert.doesNotThrow(() => G.perfilFabricacion({ ...base, beta_deg: 60 }, E_16, M60));
});

test('Reducción con injerto: sin L_cuerpo ni L_ramal se usan los automáticos; un tramo corto advierte', () => {
  const base = { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 };
  const auto = G.perfilFabricacion(base, E_16, M);
  // largo automático del injerto: generatriz más larga + tramo recto extra de maestros (150 mm), a cualquiera de los dos ángulos
  [30, 45].forEach((b) => {
    const PF = G.perfilFabricacion({ ...base, beta_deg: b }, E_16, M);
    const beta = (b * PI) / 180;
    const tMax = ((304.8 + E_16) / 2 + ((152.4 + E_16) / 2) * Math.cos(beta)) / Math.sin(beta);
    casi(PF.detalle.L_ramal_mm, tMax + 150, 1e-12, `β=${b}`);
    assert.equal(PF.advertencias.length, 0);
  });
  const d_med = 152.4 + E_16;
  casi(auto.detalle.L_cuerpo_mm, (1.25 * d_med) / Math.sin((45 * PI) / 180), 1e-12);
  assert.equal(auto.advertencias.length, 0);
  const corto = G.perfilFabricacion({ ...base, L_cuerpo_mm: 150 }, E_16, M);
  assert.ok(corto.advertencias.some((x) => /tramo recto del tronco es corto/.test(x)));
  const largo = G.perfilFabricacion({ ...base, L_cuerpo_mm: 800 }, E_16, M);
  assert.ok(largo.A_neta_m2 > auto.A_neta_m2, 'más tronco, más lámina');
});

test('Reducción con injerto: el cono con semiángulo excesivo advierte (L_reduccion demasiado corta)', () => {
  const base = { familia: 'REDUCCION_INJERTO', D1_mm: 400, D2_mm: 200, d_mm: 150, beta_deg: 45 };
  assert.equal(G.perfilFabricacion(base, E_16, M).advertencias.length, 0);
  assert.ok(G.perfilFabricacion({ ...base, L_reduccion_mm: 120 }, E_16, M).advertencias.some((x) => /Semiángulo/.test(x)));
});

test('Reducción con injerto: a 30° la silleta es más larga y abre más orificio que a 45°', () => {
  const base = { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, L_cuerpo_mm: 600, L_ramal_mm: 600 };
  const a30 = G.perfilFabricacion({ ...base, beta_deg: 30 }, E_16, M);
  const a45 = G.perfilFabricacion({ ...base, beta_deg: 45 }, E_16, M);
  assert.ok(a30.sold.filete_m > a45.sold.filete_m, 'más soldadura de silleta');
  assert.ok(a30.A_orificio_m2 > a45.A_orificio_m2, 'más orificio');
  assert.ok(a30.detalle.t_max_mm > a45.detalle.t_max_mm, 'el injerto necesita más largo');
});

test('Pantalón (retirado): sigue calculando para abrir cotizaciones anteriores y avisa que es una familia retirada', () => {
  const PF = G.perfilFabricacion({ familia: 'PANTALON', D_mm: 500, d1_mm: 354, d2_mm: 354, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500 }, E_16, M);
  assert.ok(PF.A_neta_m2 > 0);
  assert.ok(PF.advertencias.some((x) => /Familia retirada/.test(x)));
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
