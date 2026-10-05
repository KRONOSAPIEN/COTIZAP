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

/* ---------- oráculos por fuerza bruta del injerto sobre un cono (sin la cuadrática ni la integral de línea del motor) ---------- */

/** Distancia axial t, desde el cruce de los ejes, a la que la generatriz φ del injerto toca el cono: bisección sobre la ecuación del cono. */
function tBiseccion(R1, m, xj, rb, betaDeg, sentido, phi) {
  const beta = (betaDeg * PI) / 180;
  const ux = sentido * Math.cos(beta);
  const uy = Math.sin(beta);
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const fuera = (t) => {
    const x = xj + t * ux - rb * sp * uy;
    const y = t * uy + rb * sp * ux;
    return Math.hypot(y, rb * cp) - (R1 - m * x) > 0;
  };
  let lo = 0;
  let hi = 5000;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (fuera(mid)) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** t medio, t máximo y perímetro de la silleta a partir de la bisección (N generatrices). */
function silletaBruta(R1, m, xj, rb, betaDeg, sentido, N = 20000) {
  const beta = (betaDeg * PI) / 180;
  const ux = sentido * Math.cos(beta);
  const uy = Math.sin(beta);
  let suma = 0;
  let tMax = 0;
  let per = 0;
  let previo = null;
  let primero = null;
  for (let i = 0; i <= N; i += 1) {
    const phi = (2 * PI * (i % N)) / N;
    const t = tBiseccion(R1, m, xj, rb, betaDeg, sentido, phi);
    const q = [xj + t * ux - rb * Math.sin(phi) * uy, t * uy + rb * Math.sin(phi) * ux, rb * Math.cos(phi)];
    if (i < N) { suma += t; tMax = Math.max(tMax, t); }
    if (previo) per += norma(sub(q, previo));
    previo = q;
    if (!primero) primero = q;
  }
  return { t_med: suma / N, t_max: tMax, P_h: per };
}

/** Área del orificio en el cono: rejilla fina sobre su superficie (x, θ); dentro = a menos de rb del eje del injerto. */
function orificioConoRejilla(R1, m, xj, rb, betaDeg, sentido, xmin, xmax, N = 2400) {
  const beta = (betaDeg * PI) / 180;
  const ux = sentido * Math.cos(beta);
  const uy = Math.sin(beta);
  const k = Math.sqrt(1 + m * m);
  const x0 = xmin - 10;
  const x1 = xmax + 10;
  const thm = Math.asin(Math.min(1, (1.1 * rb) / (R1 - m * x1)));
  const dx = (x1 - x0) / N;
  const dth = (2 * thm) / N;
  let area = 0;
  for (let i = 0; i < N; i += 1) {
    const x = x0 + (i + 0.5) * dx;
    const r = R1 - m * x;
    const X = x - xj;
    for (let j = 0; j < N; j += 1) {
      const th = -thm + (j + 0.5) * dth;
      const py = r * Math.cos(th);
      const pz = r * Math.sin(th);
      const proy = X * ux + py * uy;
      if (X * X + py * py + pz * pz - proy * proy < rb * rb) area += r * k * dx * dth;
    }
  }
  return area;
}

const CASOS_CONO = [ // R1, R2, L, rb, β°, sentido (−1 = hacia el extremo mayor, +1 = hacia el menor)
  [153.16, 127.76, 300, 76.96, 45, -1], [153.16, 127.76, 300, 76.96, 45, 1], [153.16, 127.76, 400, 76.96, 30, -1],
  [153.16, 127.76, 400, 76.96, 30, 1], [200, 120, 500, 80, 30, -1], [200, 120, 400, 60, 45, 1],
];

test('Silleta del injerto sobre el cono: t medio, t máximo, perímetro y orificio coinciden con la fuerza bruta (30° y 45°, hacia ambos extremos)', () => {
  CASOS_CONO.forEach(([R1, R2, L, rb, b, sentido]) => {
    const m = (R1 - R2) / L;
    const beta = (b * PI) / 180;
    const xj = G.cruceInjertoCono({ R1, m, beta, sentido, xc: L / 2 });
    const g = G.silletaInjertoCono({ R1, m, xj, rb, beta, sentido });
    assert.ok(g.ok);
    const bruto = silletaBruta(R1, m, xj, rb, b, sentido);
    const etiqueta = `R1=${R1} R2=${R2} L=${L} rb=${rb} β=${b} sentido=${sentido}`;
    casi(g.t_med, bruto.t_med, 1e-9, `t medio · ${etiqueta}`);
    casi(g.t_max, bruto.t_max, 1e-5, `t máximo · ${etiqueta}`);
    casi(g.P_h, bruto.P_h, 1e-5, `perímetro de la silleta · ${etiqueta}`);
    casi(g.A_orificio, orificioConoRejilla(R1, m, xj, rb, b, sentido, g.x_min, g.x_max), 1e-4, `orificio · ${etiqueta}`);
    // la silleta queda centrada en el largo del cono
    casi((g.x_min + g.x_max) / 2, L / 2, 5e-3, `centrada · ${etiqueta}`);
  });
});

test('Silleta del injerto sobre el cono: si el cono casi es un cilindro coincide con el injerto simple (m → 0)', () => {
  const D = 400;
  const d = 200;
  [30, 45, 60].forEach((b) => {
    const Rm = (D + E_16) / 2;
    const rb = (d + E_16) / 2;
    const m = 1e-7;
    const beta = (b * PI) / 180;
    const xj = G.cruceInjertoCono({ R1: Rm, m, beta, sentido: -1, xc: 1000 });
    const g = G.silletaInjertoCono({ R1: Rm, m, xj, rb, beta, sentido: -1 });
    const cilindro = G.perfilFabricacion({ familia: 'RAMAL', D_mm: D, d_mm: d, L_cuerpo_mm: 2000, L_ramal_mm: 2000, beta_deg: b }, E_16, M);
    casi(g.A_orificio, cilindro.A_orificio_m2 * 1e6, 1e-4, `orificio β=${b}`);
    casi(g.t_med, cilindro.detalle.t_medio_mm, 1e-6, `t medio β=${b}`);
    casi(g.t_max, cilindro.detalle.t_max_mm, 1e-3, `t máximo β=${b}`); // el máximo del cilindro es el extremo teórico; el discreto lo roza
  });
});

test('Silleta del injerto sobre el cono: un injerto demasiado tendido o demasiado grande no tiene geometría', () => {
  const R1 = 150;
  const R2 = 100;
  const m = (R1 - R2) / 100; // cono muy abierto: semiángulo 26.6°
  const beta = (20 * PI) / 180; // más tendido que la generatriz del cono
  const xj = G.cruceInjertoCono({ R1, m, beta, sentido: -1, xc: 50 });
  const tendido = G.silletaInjertoCono({ R1, m, xj, rb: 20, beta, sentido: -1 });
  assert.equal(tendido.ok, false);
  assert.equal(tendido.motivo, 'tendido');
  const beta45 = (45 * PI) / 180;
  const grande = G.silletaInjertoCono({ R1, m: 0.05, xj: 0, rb: 400, beta: beta45, sentido: -1 });
  assert.equal(grande.ok, false);
});

/* ---------- reducción con injerto (el injerto va SOBRE EL CONO) ---------- */

const BASE_RI = { familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 };
/** La inclinación del injerto la fija el taller en maestros (proceso.injerto_inclinado_hacia): 'MENOR' = de extremo mayor a menor. */
const maestrosHacia = (hacia) => crearMaestros({ proceso: { injerto_inclinado_hacia: hacia } });

test('Reducción con injerto: área, corte, soldadura y piezas recalculados de forma independiente (cono + pared del injerto − orificio)', () => {
  [['MAYOR', 45, 400], ['MENOR', 45, 400], ['MAYOR', 30, 550], ['MENOR', 30, 550]].forEach(([inclinacion, b, L]) => {
    const D1 = 400;
    const D2 = 300;
    const d = 150;
    const sentido = inclinacion === 'MENOR' ? 1 : -1;
    const PF = G.perfilFabricacion({ familia: 'REDUCCION_INJERTO', D1_mm: D1, D2_mm: D2, d_mm: d, beta_deg: b, L_reduccion_mm: L }, E_16, maestrosHacia(inclinacion));

    const R1 = (D1 + E_16) / 2;
    const R2 = (D2 + E_16) / 2;
    const rb = (d + E_16) / 2;
    const m = (R1 - R2) / L;
    const beta = (b * PI) / 180;
    const xj = G.cruceInjertoCono({ R1, m, beta, sentido, xc: L / 2 });
    const motor = G.silletaInjertoCono({ R1, m, xj, rb, beta, sentido });
    const bruto = silletaBruta(R1, m, xj, rb, b, sentido, 8000);
    const Ao = orificioConoRejilla(R1, m, xj, rb, b, sentido, motor.x_min, motor.x_max);
    const s = Math.hypot(L, R1 - R2);
    const A_cono = PI * (R1 + R2) * s;
    const L_r = PF.detalle.L_ramal_mm;
    assert.ok(Math.abs(L_r - (bruto.t_max + 150)) < 1e-2, 'largo automático del injerto = generatriz más larga + 150 mm');
    const A_injerto = 2 * PI * rb * (L_r - bruto.t_med);
    const et = `${inclinacion} ${b}°`;
    casi(PF.A_neta_m2 * 1e6, A_cono - Ao + A_injerto, 2e-4, `área neta · ${et}`);
    casi(PF.detalle.A_cono_m2 * 1e6, A_cono, 1e-9, `cono · ${et}`);
    casi(PF.A_orificio_m2 * 1e6, Ao, 1e-4, `orificio · ${et}`);

    const corte = (PI * (R1 + R2) * 2 + 2 * s + bruto.P_h + 2 * (2 * PI * rb + L_r)) / 1000;
    casi(PF.L_corte_m, corte, 2e-5, `corte · ${et}`);
    casi(PF.sold.tope_m, (s + (L_r - bruto.t_med)) / 1000, 1e-6, `soldadura a tope · ${et}`);
    casi(PF.sold.filete_m, bruto.P_h / 1000, 1e-5, `soldadura de silleta · ${et}`);
    assert.equal(PF.n_piezas, 2);
    assert.equal(PF.n_virolas, 2);
    assert.equal(PF.n_juntas_internas, 1);
    assert.equal(PF.extremos.length, 3);
    assert.deepEqual(PF.extremos.map((x) => Number(x.D_ext_mm.toFixed(3))), [D1, D2, d].map((x) => Number((x + 2 * E_16).toFixed(3))));
    casi(PF.n_virolas * PF.k_rolado * PF.L_virola_m, (M.proceso.rolado.k_conico * s + L_r) / 1000, 1e-9, `trabajo de rolado · ${et}`);
  });
});

test('Reducción con injerto: el largo automático es el menor que aloja la silleta con la holgura de maestros', () => {
  const margen = M.proceso.injerto_margen_cono_mm;
  assert.equal(margen, 25);
  [['MAYOR', 45], ['MENOR', 45], ['MAYOR', 30], ['MENOR', 30]].forEach(([inclinacion, b]) => {
    const PF = G.perfilFabricacion({ ...BASE_RI, beta_deg: b }, E_16, maestrosHacia(inclinacion));
    const d = PF.detalle;
    assert.ok(d.x_silleta_min_mm >= margen - 1e-6, `holgura al extremo mayor · ${inclinacion} ${b}°`);
    assert.ok(d.L_reduccion_mm - d.x_silleta_max_mm >= margen - 1e-6, `holgura al extremo menor · ${inclinacion} ${b}°`);
    casi(d.L_reduccion_mm, d.L_reduccion_auto_mm, 1e-12);
    // mínimo: con 2 mm menos de cono ya no cabe con holgura
    assert.throws(() => G.perfilFabricacion({ ...BASE_RI, beta_deg: b, L_reduccion_mm: d.L_reduccion_mm - 2 }, E_16, maestrosHacia(inclinacion)), /La reducción es corta para alojar el injerto/, `${inclinacion} ${b}°`);
    assert.doesNotThrow(() => G.perfilFabricacion({ ...BASE_RI, beta_deg: b, L_reduccion_mm: d.L_reduccion_mm + 50 }, E_16, maestrosHacia(inclinacion)));
  });
  // cuando el injerto es chico, manda el semiángulo de 15° (largo mínimo de una reducción) y no la silleta
  const chico = G.perfilFabricacion({ familia: 'REDUCCION_INJERTO', D1_mm: 600, D2_mm: 200, d_mm: 80, beta_deg: 45 }, E_16, M);
  casi(chico.detalle.semiangulo_deg, 15, 1e-9);
  assert.ok(chico.detalle.holgura_mm > margen);
});

test('Reducción con injerto: un cono más largo se ve en la lámina y la silleta sigue en el centro', () => {
  const corto = G.perfilFabricacion(BASE_RI, E_16, M);
  const largo = G.perfilFabricacion({ ...BASE_RI, L_reduccion_mm: corto.detalle.L_reduccion_mm + 300 }, E_16, M);
  assert.ok(largo.A_neta_m2 > corto.A_neta_m2);
  casi((largo.detalle.x_silleta_min_mm + largo.detalle.x_silleta_max_mm) / 2, largo.detalle.L_reduccion_mm / 2, 5e-3);
});

test('Reducción con injerto: el taller lo lleva de extremo mayor a menor (hacia D2); hacia D1 cambiaría el desarrollo (más orificio)', () => {
  [30, 45].forEach((b) => {
    const mayor = G.perfilFabricacion({ ...BASE_RI, beta_deg: b, L_reduccion_mm: 500 }, E_16, maestrosHacia('MAYOR'));
    const menor = G.perfilFabricacion({ ...BASE_RI, beta_deg: b, L_reduccion_mm: 500 }, E_16, maestrosHacia('MENOR'));
    assert.ok(mayor.A_orificio_m2 > menor.A_orificio_m2 * 1.05, `β=${b}`);
    assert.ok(mayor.sold.filete_m > menor.sold.filete_m, `β=${b}`);
    assert.ok(mayor.detalle.t_max_mm > menor.detalle.t_max_mm, `β=${b}`);
  });
  assert.equal(M.proceso.injerto_inclinado_hacia, 'MENOR', 'dato de maestros: de extremo mayor a menor');
  const omitido = G.perfilFabricacion({ ...BASE_RI }, E_16, M);
  assert.equal(omitido.detalle.sentido, 'MENOR', 'por omisión: hacia el extremo menor (D2)');
  assert.equal(JSON.stringify(omitido), JSON.stringify(G.perfilFabricacion({ ...BASE_RI }, E_16, maestrosHacia(' menor '))), 'el valor se lee sin importar mayúsculas ni espacios');
});

test('Reducción con injerto: ya no hay "lado" (der/izq) ni "sentido" por partida; una cotización anterior que los traía calcula exactamente igual', () => {
  const sin = G.perfilFabricacion({ ...BASE_RI }, E_16, M);
  [{ lado: 'DER' }, { lado: 'IZQ' }, { lado: 'CENTRO' }, { sentido: 'MAYOR' }, { sentido: 'MENOR' }, { sentido: 'ARRIBA' }].forEach((extra) => {
    const con = G.perfilFabricacion({ ...BASE_RI, ...extra }, E_16, M);
    assert.equal(JSON.stringify(con), JSON.stringify(sin), `el dato sobrante ${JSON.stringify(extra)} se ignora`);
  });
  assert.equal('lado' in sin.detalle, false, 'el detalle ya no trae lado');
});

test('Reducción con injerto: validaciones físicas (D2 < D1, injerto menor que el cono, largos suficientes) y la inclinación de maestros', () => {
  const ok = (extra) => G.perfilFabricacion({ ...BASE_RI, ...extra }, E_16, M);
  assert.doesNotThrow(() => ok({}));
  assert.throws(() => ok({ D2_mm: 304.8 }), /D2 debe ser menor que D1/);
  assert.throws(() => ok({ D2_mm: 400 }), /D2 debe ser menor que D1/);
  assert.throws(() => ok({ d_mm: 300 }), /injerto debe ser de menor diámetro que la reducción/);
  assert.throws(() => ok({ D1_mm: 0 }), U.ErrorValidacion);
  assert.throws(() => ok({ beta_deg: 10 }), /entre 20° y 90°/);
  assert.throws(() => G.perfilFabricacion({ ...BASE_RI }, E_16, maestrosHacia('ARRIBA')), /injerto inclinado hacia.*MENOR.*MAYOR/);
  assert.throws(() => ok({ L_ramal_mm: 100 }), /longitud del injerto debe exceder/);
  assert.throws(() => ok({ L_reduccion_mm: 120 }), /La reducción es corta para alojar el injerto: necesita al menos \d+ mm/);
  // el ángulo llega como texto desde la lista de la interfaz
  assert.doesNotThrow(() => ok({ beta_deg: '30' }));
  assert.doesNotThrow(() => ok({ beta_deg: undefined }), 'sin ángulo: el de maestros (45°)');
});

test('Reducción con injerto: sin largo del injerto se usa su generatriz más larga + el tramo recto de maestros; una reducción más corta que 15° de semiángulo advierte', () => {
  [30, 45].forEach((b) => {
    const PF = G.perfilFabricacion({ ...BASE_RI, beta_deg: b }, E_16, M);
    casi(PF.detalle.L_ramal_mm, PF.detalle.t_max_mm + 150, 1e-12, `β=${b}`);
    assert.equal(PF.advertencias.length, 0);
  });
  // cono muy abierto: se captura un largo corto que sí aloja un injerto chico, pero pasa de 15° de semiángulo
  const abierto = G.perfilFabricacion({ familia: 'REDUCCION_INJERTO', D1_mm: 600, D2_mm: 200, d_mm: 60, beta_deg: 45, L_reduccion_mm: 330 }, E_16, M);
  assert.ok(abierto.advertencias.some((x) => /Semiángulo/.test(x)));
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
