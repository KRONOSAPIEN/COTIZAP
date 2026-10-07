/**
 * COTIZAP · web/planos.js — El dibujo acotado de cada pieza, como en los planos de pedido del taller (codo con sus gajos y su
 * radio, reducción con su injerto y su ángulo, brida con sus diámetros y barrenos…).
 *
 * Es puro y no toca el DOM: `plano(f, M)` arma el dibujo de una partida calculada (trazos y cotas en milímetros reales) y
 * `arbol(dibujo, opciones)` lo convierte en un árbol SVG ({ tag, a, c, t }) a la escala pedida. La interfaz crea los nodos con
 * createElementNS y textContent (nunca innerHTML). Las pruebas lo cargan en Node.
 *
 * Coordenadas en mm con el eje y hacia abajo (como el SVG). Las cotas llevan `campo`: el dato de la partida que miden, para
 * resaltarlas mientras se captura.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.planos = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PI = Math.PI;
  const rad = (g) => (g * PI) / 180;
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);

  /* ---------------- Formato: milímetros enteros y pulgadas de taller ---------------- */
  const FRAC = { 1: '¼', 2: '½', 3: '¾' };
  /** Milímetros enteros con separador de miles: 279.4 → «279», 1300 → «1,300». */
  const mm = (x) => Math.round(x).toLocaleString('es-MX');
  /** 279.4 → «11″», 31.75 → «1¼″»; null si no es una medida en cuartos de pulgada (±0.2 mm): 200 mm no es «7⅞″». */
  function pulg(x) {
    if (!fin(x) || x <= 0) return null;
    const cuartos = Math.round((x / 25.4) * 4);
    if (cuartos < 1 || Math.abs(x - (cuartos * 25.4) / 4) > 0.2) return null;
    const ent = Math.floor(cuartos / 4);
    const r = cuartos % 4;
    return `${ent || ''}${r ? FRAC[r] : ''}″`;
  }
  /** Diámetro como lo escribe el taller: «Ø11″» si es medida en pulgadas, si no «Ø300». */
  const diam = (x) => `Ø${pulg(x) || mm(x)}`;
  /** «11″» o «300 mm». */
  const nominal = (x) => pulg(x) || `${mm(x)} mm`;
  const grados = (g) => `${Math.round(g * 10) / 10}°`;

  /* ---------------- Primitivas ---------------- */
  const P = (x, y) => [x, y];
  const suma = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const resta = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const por = (a, k) => [a[0] * k, a[1] * k];
  const largo = (a) => Math.hypot(a[0], a[1]);
  const unit = (a) => { const l = largo(a) || 1; return [a[0] / l, a[1] / l]; };
  /** Punto en el ángulo φ (grados, contra el reloj a la vista) a la distancia r de c; y hacia abajo. */
  const polar = (c, r, phi) => [c[0] + r * Math.cos(rad(phi)), c[1] - r * Math.sin(rad(phi))];

  function nuevo(familia) {
    // caras: los extremos de la pieza en el dibujo ({ c, dir hacia afuera, R }), por el nombre que les da el motor; ahí van las bridas
    // datos: lo que lleva el plano de pedido; notas: lo que sólo importa al cotizar (no va en la hoja para el proveedor)
    return { familia, titulo: '', titulo_corto: '', datos: [], notas: [], trazos: [], cotas: [], caras: {} };
  }
  const ruta = (d, clase, cerrada) => ({ t: 'ruta', d, clase: clase || 'pieza', cerrada: !!cerrada });
  const circulo = (c, r, clase) => ({ t: 'circulo', c, r, clase: clase || 'pieza' });
  const arco = (c, r, a0, a1, clase) => ({ t: 'arco', c, r, a0, a1, clase: clase || 'eje' });
  /**
   * Cota alineada entre p1 y p2. `lado` +1 la pone a la izquierda de quien va de p1 a p2 (en pantalla), −1 a la derecha; `nivel`
   * (1, 2…) la separa de la pieza en renglones de cota; `extra` (mm) la separa además, p. ej. para pasar por fuera de un círculo.
   */
  const cota = (p1, p2, texto, campo, nivel, lado, extra) => ({ t: 'cota', p1, p2, texto, campo: campo || null, nivel: nivel || 1, lado: lado === -1 ? -1 : 1, extra: extra || 0 });
  /** Cota de ángulo: arco de radio r alrededor de c, de a0 a a1 (grados, como `polar`). */
  const cotaAng = (c, r, a0, a1, texto, campo) => ({ t: 'angulo', c, r, a0, a1, texto, campo: campo || null });
  /** Nota con línea de llamada: del punto p al texto, hacia la dirección `hacia` (grados). */
  const nota = (p, hacia, texto, campo) => ({ t: 'nota', p, hacia, texto, campo: campo || null });

  /* ---------------- Familias ---------------- */

  /** Codo de gajos: centro O, eje de radio R de 0° a θ, gajos de α = θ/(n − 1) con los extremos de medio gajo (el eje se circunscribe al arco). */
  function codo(f, d) {
    const p = f.entrada;
    const det = f.geometria.detalle;
    const rect = p.forma === 'RECTANGULAR';
    const D = rect ? p.a_mm : p.D_mm;
    const R = fin(det.R_mm) ? det.R_mm : (p.k_R || 1.5) * D;
    const th = p.theta_deg;
    const n = det.n_gajos || 0;
    const O = P(0, 0);
    const ri = R - D / 2;
    const ro = R + D / 2;
    d.titulo = rect ? `Codo ${grados(th)} de ${mm(p.a_mm)} × ${mm(p.b_mm)}` : `Codo ${grados(th)} ${diam(D)}`;
    d.datos = [rect ? `${mm(p.a_mm)} × ${mm(p.b_mm)} mm` : `D = ${nominal(D)}`, grados(th), `R = ${Math.round((R / D) * 100) / 100}D (${mm(R)} mm)`];
    if (n >= 2) {
      d.datos.push(`${n} gajos`);
      const alfa = th / (n - 1);
      const k = 1 / Math.cos(rad(alfa / 2));
      const angs = [0, ...Array.from({ length: n - 1 }, (_, i) => alfa / 2 + i * alfa), th];
      const radio = (r, i) => (i === 0 || i === angs.length - 1 ? r : r * k);
      const ext = angs.map((a, i) => polar(O, radio(ro, i), a));
      const int = angs.map((a, i) => polar(O, radio(ri, i), a));
      d.trazos.push(ruta([...ext, ...int.slice().reverse()], 'pieza', true));
      angs.slice(1, -1).forEach((a, i) => d.trazos.push(ruta([int[i + 1], ext[i + 1]], 'junta')));
    } else {
      d.trazos.push({ t: 'sector', c: O, ri, ro, a0: 0, a1: th, clase: 'pieza' });
    }
    // construcción: el eje del codo y los radios a las caras
    d.trazos.push(arco(O, R, 0, th, 'eje'));
    d.trazos.push(ruta([O, polar(O, ri, 0)], 'eje'));
    d.trazos.push(ruta([O, polar(O, ri, th)], 'eje'));
    d.trazos.push({ t: 'centro', c: O });
    // tangentes rectas en cada extremo
    const Lt = p.L_tangente_mm > 0 ? p.L_tangente_mm : 0;
    if (Lt > 0) {
      d.trazos.push(ruta([polar(O, ri, 0), P(ri, Lt), P(ro, Lt), polar(O, ro, 0)], 'pieza'));
      const t = P(-Math.sin(rad(th)), -Math.cos(rad(th)));
      const a = polar(O, ri, th);
      const b = polar(O, ro, th);
      d.trazos.push(ruta([a, suma(a, por(t, Lt)), suma(b, por(t, Lt)), b], 'pieza'));
      d.datos.push(`Tangentes de ${mm(Lt)} mm`);
    }
    // las dos bocas: la de 0° (sale hacia abajo) y la de θ (sigue el giro), al final de su tangente
    const tB = P(-Math.sin(rad(th)), -Math.cos(rad(th)));
    d.caras.A = { c: P(R, Lt), dir: P(0, 1), R: D / 2 };
    d.caras.B = { c: suma(polar(O, R, th), por(tB, Lt)), dir: tB, R: D / 2 };
    // cotas: R y R + D/2 desde el centro (como en los planos), D en la cara de salida y el ángulo
    d.cotas.push(cota(O, P(R, 0), mm(R), 'k_R', 1, -1));
    d.cotas.push(cota(O, P(ro, 0), mm(ro), null, 2, -1));
    const a = polar(O, ri, th);
    const b = polar(O, ro, th);
    d.cotas.push(cota(a, b, rect ? `${mm(p.a_mm)}` : diam(D), rect ? 'a_mm' : 'D_mm', 1, 1));
    d.cotas.push(cotaAng(O, Math.min(ri * 0.75, R * 0.45), 0, th, grados(th), 'theta_deg'));
    if (n >= 2) d.cotas.push(nota(polar(O, ro, th / 2), th / 2, `${n} gajos`, 'n_gajos'));
  }

  /** Cono D1 → D2 de largo L (concéntrico o con la cara plana arriba). Devuelve los bordes para que el injerto los corte. */
  function cono(d, D1, D2, L, excentrica) {
    const R1 = D1 / 2;
    const R2 = D2 / 2;
    const sup = excentrica ? [P(0, -R1), P(L, -R1)] : [P(0, -R1), P(L, -R2)];
    const inf = excentrica ? [P(0, R1), P(L, -R1 + D2)] : [P(0, R1), P(L, R2)];
    return { R1, R2, sup, inf, ejeY: excentrica ? [0, -R1 + R2] : [0, 0] };
  }

  /** El injerto sobre el borde superior del cuerpo (cono o cilindro): cruza el eje en xj, a β, hacia el extremo chico; de largo Lr sobre su eje. */
  function injerto(d, R1, m, L, db, beta_deg, Lr, campoL) {
    const b = rad(beta_deg);
    const ux = Math.cos(b);
    const uy = Math.sin(b);
    const xc = L / 2; // la silleta se centra en el largo del cuerpo
    const xj = (xc * (uy + m * ux) - ux * R1) / uy;
    const rb = db / 2;
    const u = P(ux, -uy); // hacia arriba y hacia el extremo chico
    const nrm = P(uy, ux); // perpendicular (en coordenadas con y hacia abajo)
    const J = P(xj, 0);
    // cada lado del injerto corta el borde superior y = −(R1 − m·x)
    const corte = (s) => {
      const t = (R1 - m * xj - m * s * rb * uy + s * rb * ux) / (uy + m * ux);
      return suma(suma(J, por(nrm, s * rb)), por(u, t));
    };
    const E = suma(J, por(u, Lr));
    const ladoA = [corte(-1), suma(E, por(nrm, -rb))];
    const ladoB = [corte(1), suma(E, por(nrm, rb))];
    return { J, E, u, nrm, rb, ladoA, ladoB, xA: ladoA[0][0], xB: ladoB[0][0], campoL };
  }

  function cuerpoConInjerto(f, d, { D1, D2, L, db, beta, Lr, campos, ids }) {
    const c = cono(d, D1, D2, L, false);
    const m = (c.R1 - c.R2) / L;
    const inj = injerto(d, c.R1, m, L, db, beta, Lr);
    const x1 = Math.min(inj.xA, inj.xB);
    const x2 = Math.max(inj.xA, inj.xB);
    const yS = (x) => -(c.R1 - m * x);
    // el contorno: borde superior cortado donde entra el injerto, los lados del injerto y su boca
    d.trazos.push(ruta([P(0, yS(0)), P(0, c.R1), P(L, c.R2), P(L, yS(L)), P(x2, yS(x2))], 'pieza'));
    d.trazos.push(ruta([P(x1, yS(x1)), P(0, yS(0))], 'pieza'));
    d.trazos.push(ruta([...inj.ladoA], 'pieza'));
    d.trazos.push(ruta([...inj.ladoB], 'pieza'));
    d.trazos.push(ruta([inj.ladoA[1], inj.ladoB[1]], 'pieza'));
    d.trazos.push({ t: 'relleno', d: [P(0, yS(0)), P(x1, yS(x1)), inj.ladoA[0], inj.ladoA[1], inj.ladoB[1], inj.ladoB[0], P(x2, yS(x2)), P(L, yS(L)), P(L, c.R2), P(0, c.R1)] });
    // ejes del cuerpo y del injerto
    d.trazos.push(ruta([P(-L * 0.04, 0), P(L * 1.04, 0)], 'eje'));
    d.trazos.push(ruta([inj.J, suma(inj.E, por(inj.u, Lr * 0.06))], 'eje'));
    // cotas
    const yb = Math.max(c.R1, c.R2);
    d.cotas.push(cota(P(0, c.R1), P(0, -c.R1), diam(D1), campos.D1, 1, 1));
    d.cotas.push(cota(P(L, -c.R2), P(L, c.R2), diam(D2), campos.D2, 1, 1));
    d.cotas.push(cota(P(0, yb), P(L, yb), mm(L), campos.L, 1, -1));
    d.cotas.push(cota(inj.ladoA[1], inj.ladoB[1], diam(db), 'd_mm', 1, 1));
    d.cotas.push(cota(inj.J, inj.E, mm(Lr), campos.Lr, 1, 1, inj.rb));
    d.cotas.push(cotaAng(inj.J, Math.max(inj.rb * 1.6, Lr * 0.28), 0, beta, grados(beta), 'beta_deg'));
    d.caras[ids[0]] = { c: P(0, 0), dir: P(-1, 0), R: c.R1 };
    d.caras[ids[1]] = { c: P(L, 0), dir: P(1, 0), R: c.R2 };
    d.caras[ids[2]] = { c: inj.E, dir: inj.u, R: inj.rb };
  }

  function reduccionInjerto(f, d) {
    const p = f.entrada;
    const det = f.geometria.detalle;
    const L = det.L_reduccion_mm || p.L_reduccion_mm;
    const Lr = det.L_ramal_mm || p.L_ramal_mm;
    d.titulo = `Reducción de ${nominal(p.D1_mm)} a ${nominal(p.D2_mm)} con injerto de ${nominal(p.d_mm)} a ${grados(p.beta_deg)}`;
    d.datos = [`De ${diam(p.D1_mm)} a ${diam(p.D2_mm)}`, `L = ${mm(L)} mm`, `Injerto ${diam(p.d_mm)} a ${grados(p.beta_deg)}, ${mm(Lr)} mm sobre su eje`];
    cuerpoConInjerto(f, d, { D1: p.D1_mm, D2: p.D2_mm, L, db: p.d_mm, beta: p.beta_deg, Lr, campos: { D1: 'D1_mm', D2: 'D2_mm', L: 'L_reduccion_mm', Lr: 'L_ramal_mm' }, ids: ['D1', 'D2', 'injerto'] });
  }

  function ramal(f, d) {
    const p = f.entrada;
    const beta = f.geometria.detalle.beta_deg || p.beta_deg;
    d.titulo = `Ducto de ${nominal(p.D_mm)} con injerto de ${nominal(p.d_mm)} a ${grados(beta)}`;
    d.datos = [`Tronco ${diam(p.D_mm)}, L = ${mm(p.L_cuerpo_mm)} mm`, `Injerto ${diam(p.d_mm)} a ${grados(beta)}, ${mm(p.L_ramal_mm)} mm sobre su eje`];
    cuerpoConInjerto(f, d, { D1: p.D_mm, D2: p.D_mm, L: p.L_cuerpo_mm, db: p.d_mm, beta, Lr: p.L_ramal_mm, campos: { D1: 'D_mm', D2: 'D_mm', L: 'L_cuerpo_mm', Lr: 'L_ramal_mm' }, ids: ['tronco_1', 'tronco_2', 'injerto'] });
  }

  function reduccion(f, d) {
    const p = f.entrada;
    const L = f.geometria.detalle.L_mm || p.L_mm;
    const exc = p.excentrica === 'CARA_PLANA';
    const c = cono(d, p.D1_mm, p.D2_mm, L, exc);
    d.titulo = `Reducción${exc ? ' excéntrica' : ''} de ${nominal(p.D1_mm)} a ${nominal(p.D2_mm)}`;
    d.datos = [`De ${diam(p.D1_mm)} a ${diam(p.D2_mm)}`, `L = ${mm(L)} mm`, exc ? 'Cara plana arriba' : 'Concéntrica'];
    d.trazos.push(ruta([c.sup[0], c.sup[1], c.inf[1], c.inf[0]], 'pieza', true));
    d.trazos.push(ruta([P(-L * 0.04, c.ejeY[0]), P(L * 1.04, c.ejeY[1])], 'eje'));
    const yb = Math.max(c.inf[0][1], c.inf[1][1]);
    d.cotas.push(cota(c.inf[0], c.sup[0], diam(p.D1_mm), 'D1_mm', 1, 1));
    d.cotas.push(cota(c.sup[1], c.inf[1], diam(p.D2_mm), 'D2_mm', 1, 1));
    d.cotas.push(cota(P(0, yb), P(L, yb), mm(L), 'L_mm', 1, -1));
    d.caras.D1 = { c: P(0, c.ejeY[0]), dir: P(-1, 0), R: c.R1 };
    d.caras.D2 = { c: P(L, c.ejeY[1]), dir: P(1, 0), R: c.R2 };
  }

  /** «3 yardas unidas», «2 yardas unidas + 600 mm de ajuste», «1 yarda», «600 mm de ajuste»: como en los planos de yardas. */
  function composicion(q, Y) {
    const y = q.yardas === 1 ? '1 yarda' : q.yardas > 1 ? `${q.yardas} yardas unidas` : '';
    const a = q.ajuste_mm > 0 ? `${mm(q.ajuste_mm)} mm de ajuste` : '';
    return y && a ? `${y} + ${a}` : y || a || `${mm(Y)} mm`;
  }

  /** «Bridas en ambos extremos», «Brida en un extremo», «Brida en un extremo y una suelta» (la de la pieza `q` del tramo). */
  function bridasPieza(q) {
    if (q.bridas >= 2) return 'Bridas en ambos extremos';
    return q.sueltas ? 'Brida en un extremo y una suelta' : 'Brida en un extremo';
  }

  /**
   * Tramo recto como en los planos de yardas: cada yarda acotada arriba y el largo total abajo, las juntas entre yardas y las
   * bridas en los extremos que las llevan. Si es muy largo se dibuja con un corte (la cota dice el largo real).
   */
  function recto(f, d) {
    const p = f.entrada;
    const rect = p.forma === 'RECTANGULAR';
    const H = rect ? p.b_mm : p.D_mm;
    const L = p.L_mm;
    const maxL = 24 * H; // más largo que 24 diámetros se dibuja con un corte (3 yardas de 5″ caben enteras)
    const corto = L > maxL;
    const Ld = corto ? maxL : L;
    const esc = Ld / L;
    const arm = f.geometria.detalle && f.geometria.detalle.armado;
    const bridado = f.qto && f.qto.her && f.qto.her.tipo_union === 'BRIDADO';
    d.titulo = rect ? `Tramo recto ${mm(p.a_mm)} × ${mm(p.b_mm)} × ${mm(L)} mm` : `Tramo recto ${diam(H)} × ${mm(L)} mm`;
    d.datos = [rect ? `${mm(p.a_mm)} × ${mm(p.b_mm)} mm` : `D = ${nominal(H)}`, `L = ${mm(L)} mm`];
    if (arm && arm.piezas && arm.piezas.length === 1) {
      d.titulo_corto = composicion(arm.piezas[0], arm.yarda_mm);
      d.datos.push(d.titulo_corto);
      if (bridado) d.datos.push(bridasPieza(arm.piezas[0]));
    } else if (arm && arm.piezas) {
      d.datos.push(`${arm.piezas.length} piezas: ${arm.piezas.map((q) => composicion(q, arm.yarda_mm)).join(' · ')}`);
    }
    const y0 = -H / 2;
    const y1 = H / 2;
    const caraEn = (x, dir) => ({ c: P(x, 0), dir: P(dir, 0), R: H / 2 });
    if (corto) {
      const xa = Ld * 0.46;
      const xb = Ld * 0.54;
      const z = H * 0.08;
      d.trazos.push(ruta([P(xa, y0), P(0, y0), P(0, y1), P(xa, y1)], 'pieza'));
      d.trazos.push(ruta([P(xb, y0), P(Ld, y0), P(Ld, y1), P(xb, y1)], 'pieza'));
      d.trazos.push(ruta([P(xa, y0 - z), P(xa + z * 0.6, -H / 4), P(xa - z * 0.6, H / 4), P(xa, y1 + z)], 'corte'));
      d.trazos.push(ruta([P(xb, y0 - z), P(xb + z * 0.6, -H / 4), P(xb - z * 0.6, H / 4), P(xb, y1 + z)], 'corte'));
      d.trazos.push({ t: 'relleno', d: [P(0, y0), P(xa, y0), P(xa, y1), P(0, y1)] });
      d.trazos.push({ t: 'relleno', d: [P(xb, y0), P(Ld, y0), P(Ld, y1), P(xb, y1)] });
      // sólo se ven los dos extremos del tramo
      if (bridado && arm && arm.piezas.length) {
        const ult = arm.piezas[arm.piezas.length - 1];
        d.bridasLado = [{ cara: caraEn(0, -1), suelta: false }];
        if (ult.bridas >= 2) d.bridasLado.push({ cara: caraEn(Ld, 1), suelta: false });
        else if (ult.sueltas) d.bridasLado.push({ cara: caraEn(Ld, 1), suelta: true });
      }
    } else {
      d.trazos.push({ t: 'relleno', d: [P(0, y0), P(Ld, y0), P(Ld, y1), P(0, y1)] });
      d.trazos.push(ruta([P(0, y0), P(Ld, y0), P(Ld, y1), P(0, y1)], 'pieza', true));
      // juntas entre yardas, la cota de cada yarda y las bridas de cada pieza
      if (arm && arm.piezas) {
        let x = 0;
        const anillos = [];
        d.bridasLado = [];
        arm.piezas.forEach((q, k) => {
          const x0 = x;
          const lista = [...Array(q.yardas).fill(arm.yarda_mm), ...(q.ajuste_mm > 0 ? [q.ajuste_mm] : [])];
          lista.forEach((a, i) => {
            anillos.push([x, x + a]);
            x += a;
            if (i < lista.length - 1) d.trazos.push(ruta([P(x * esc, y0), P(x * esc, y1)], 'junta'));
          });
          if (k < arm.piezas.length - 1) d.trazos.push(ruta([P(x * esc, y0), P(x * esc, y1)], 'pieza')); // se separan las piezas
          if (bridado) {
            d.bridasLado.push({ cara: caraEn(x0 * esc, -1), suelta: false });
            if (q.bridas >= 2) d.bridasLado.push({ cara: caraEn(x * esc, 1), suelta: false });
            else if (q.sueltas) d.bridasLado.push({ cara: caraEn(x * esc, 1), suelta: true });
          }
        });
        if (anillos.length > 1 && anillos.length <= 8) anillos.forEach(([a, b]) => d.cotas.push(cota(P(a * esc, y0), P(b * esc, y0), mm(b - a), null, 1, 1)));
        if (arm.n_completas && arm.piezas.length > 1) d.datos.push(`${arm.n_completas} ${arm.n_completas === 1 ? 'yarda' : 'yardas'} de ${mm(arm.yarda_mm)}${arm.ajuste_mm > 0 ? ` + ajuste de ${mm(arm.ajuste_mm)}` : ''}`);
      }
    }
    d.trazos.push(ruta([P(-H * 0.15, 0), P(Ld + H * 0.15, 0)], 'eje'));
    d.cotas.push(cota(P(0, y1), P(0, y0), rect ? mm(p.b_mm) : diam(H), rect ? 'b_mm' : 'D_mm', 1, 1, bridado ? 38 : 0));
    d.cotas.push(cota(P(0, y1), P(Ld, y1), mm(L), 'L_mm', 1, -1));
  }

  function transicion(f, d) {
    const p = f.entrada;
    const H = f.geometria.detalle.H_mm || p.H_mm;
    const A = p.a_mm;
    const D = p.D_mm;
    d.titulo = `Transición de ${diam(D)} a ${mm(p.a_mm)} × ${mm(p.b_mm)}`;
    d.datos = [`Redondo ${diam(D)}`, `Rectángulo ${mm(p.a_mm)} × ${mm(p.b_mm)} mm`, `L = ${mm(H)} mm`];
    d.trazos.push({ t: 'relleno', d: [P(0, -A / 2), P(H, -D / 2), P(H, D / 2), P(0, A / 2)] });
    d.trazos.push(ruta([P(0, -A / 2), P(H, -D / 2), P(H, D / 2), P(0, A / 2)], 'pieza', true));
    d.trazos.push(ruta([P(-H * 0.05, 0), P(H * 1.05, 0)], 'eje'));
    const yb = Math.max(A, D) / 2;
    d.cotas.push(cota(P(0, A / 2), P(0, -A / 2), `${mm(p.a_mm)} × ${mm(p.b_mm)}`, 'a_mm', 1, 1));
    d.cotas.push(cota(P(H, -D / 2), P(H, D / 2), diam(D), 'D_mm', 1, 1));
    d.cotas.push(cota(P(0, yb), P(H, yb), mm(H), 'H_mm', 1, -1));
    d.caras.rectangular = { c: P(0, 0), dir: P(-1, 0), R: A / 2 };
    d.caras.redondo = { c: P(H, 0), dir: P(1, 0), R: D / 2 };
  }

  /** Vista de frente de un aro de brida: interior, exterior, círculo de barrenos y los barrenos. */
  function aroFrente(d, { Dint, Dext, Dperf, n, db, campo }) {
    const O = P(0, 0);
    d.trazos.push({ t: 'anillo', c: O, ri: Dint / 2, ro: Dext / 2 });
    d.trazos.push(circulo(O, Dperf / 2, 'eje'));
    for (let i = 0; i < n; i += 1) d.trazos.push(circulo(polar(O, Dperf / 2, 90 + (360 * i) / n), Math.max(db, 1) / 2, 'barreno'));
    d.trazos.push(ruta([P(-Dext * 0.58, 0), P(Dext * 0.58, 0)], 'eje'));
    d.trazos.push(ruta([P(0, -Dext * 0.58), P(0, Dext * 0.58)], 'eje'));
    d.cotas.push(cota(P(-Dext / 2, 0), P(Dext / 2, 0), `Ø${mm(Dext)}`, null, 1, 1, Dext / 2));
    d.cotas.push(cota(P(-Dint / 2, 0), P(Dint / 2, 0), `Ø${mm(Dint)}`, campo, 1, -1, Dext / 2));
    d.cotas.push(nota(polar(O, Dperf / 2, 45), 45, `Ø${mm(Dperf)} · ${n} × Ø${Math.round(db * 10) / 10}`, null)); // corta: el detalle va en los datos
  }

  function brida(f, d) {
    const p = f.entrada;
    const a = f.qto.her.aros_sueltos[0] || f.qto.her.aros[0];
    const ext = (f.geometria.extremos_sueltos && f.geometria.extremos_sueltos[0]) || (f.geometria.extremos && f.geometria.extremos[0]);
    if (!a || !ext) return false;
    const n = a.n_tornillos;
    if (ext.forma !== 'REDONDA') {
      const ai = ext.a_ext_mm;
      const bi = ext.b_ext_mm;
      const b = a.ancho_mm;
      const g = a.gramil_mm;
      d.titulo = `Marco de brida para ducto de ${mm(p.a_mm)} × ${mm(p.b_mm)}`;
      d.datos = [a.descripcion, `Interior ${mm(ai)} × ${mm(bi)} mm`, `${n} barrenos de ${Math.round(a.diam_barreno_mm * 10) / 10} mm`];
      d.trazos.push({ t: 'marco', w0: ai, h0: bi, w1: ai + 2 * b, h1: bi + 2 * b });
      const wp = ai + 2 * g;
      const hp = bi + 2 * g;
      d.trazos.push(ruta([P(-wp / 2, -hp / 2), P(wp / 2, -hp / 2), P(wp / 2, hp / 2), P(-wp / 2, hp / 2)], 'eje', true));
      // barrenos repartidos a paso igual sobre el perímetro de barrenos
      const per = 2 * (wp + hp);
      for (let i = 0; i < n; i += 1) {
        let s = ((i + 0.5) * per) / n;
        let q;
        if (s < wp) q = P(-wp / 2 + s, -hp / 2);
        else if ((s -= wp) < hp) q = P(wp / 2, -hp / 2 + s);
        else if ((s -= hp) < wp) q = P(wp / 2 - s, hp / 2);
        else { s -= wp; q = P(-wp / 2, hp / 2 - s); }
        d.trazos.push(circulo(q, a.diam_barreno_mm / 2, 'barreno'));
      }
      d.cotas.push(cota(P(-(ai / 2 + b), -(bi / 2 + b)), P(ai / 2 + b, -(bi / 2 + b)), mm(ai + 2 * b), null, 1, 1));
      d.cotas.push(cota(P(-ai / 2, bi / 2), P(ai / 2, bi / 2), mm(ai), 'a_mm', 1, -1, b));
      return true;
    }
    const Dint = ext.D_ext_mm;
    const Dext = Dint + 2 * a.ancho_mm;
    const Dperf = a.P_perno_mm / PI;
    d.titulo = `Brida de ${nominal(p.D_mm)}`;
    d.datos = [a.descripcion, `Dint = ${mm(Dint)} mm`, `Dperf = ${mm(Dperf)} mm`, `Dext = ${mm(Dext)} mm`, `${n} barrenos de ${Math.round(a.diam_barreno_mm * 10) / 10} mm`];
    aroFrente(d, { Dint, Dext, Dperf, n, db: a.diam_barreno_mm, campo: 'D_mm' });
    return true;
  }

  /** Brida de placa comprada: con su círculo de barrenos y, si el catálogo las trae, sus medidas exterior e interior. */
  function comprada(f, d, M) {
    const k = f.compra;
    if (!(k && k.circulo_barrenos_mm > 0)) return false;
    const art = M && k.articulo_id ? M.compras.articulos[k.articulo_id] : null;
    const Dperf = k.circulo_barrenos_mm;
    const Dext = art && art.diam_ext_mm > Dperf ? art.diam_ext_mm : Dperf + 26;
    const Dint = art && art.diam_int_mm > 0 && art.diam_int_mm < Dperf ? art.diam_int_mm : Dperf - 40;
    const n = Math.max(2, 2 * (k.tornillos_pieza || 0));
    d.titulo = f.descripcion;
    d.datos = [`Dint = ${mm(Dint)} mm`, `Dperf = ${mm(Dperf)} mm`, `Dext = ${mm(Dext)} mm`, `${n} barrenos`];
    aroFrente(d, { Dint, Dext, Dperf, n, db: 9.525, campo: 'circulo_barrenos_mm' });
    return true;
  }

  /** Soportería: la abrazadera de media vuelta con sus orejas, o la pieza recta que se corta de la barra. */
  function soporte(f, d, M) {
    const s = f.soporte;
    const p = f.entrada;
    const b = s.barra || {};
    const fila = (M && M.proveedor.barras[b.id]) || {};
    const perfil = fila.perfil && M ? M.herrajes.perfiles[fila.perfil] || {} : {};
    const ancho = fila.ancho_mm > 0 ? fila.ancho_mm : perfil.ancho_mm > 0 ? perfil.ancho_mm : 38;
    if (s.largo_calculado && p.abrazadera_D_mm > 0) {
      const t = fila.esp_mm > 0 ? fila.esp_mm : perfil.esp_mm > 0 ? perfil.esp_mm : 3;
      const Rn = (p.abrazadera_D_mm + t) / 2;
      const oreja = M ? M.proceso.soportes.oreja_abrazadera_mm : 50;
      const O = P(0, 0);
      const puntos = Array.from({ length: 49 }, (_, i) => polar(O, Rn, 180 - (180 * i) / 48));
      d.titulo = `Abrazadera para ducto de ${nominal(p.abrazadera_D_mm)}`;
      d.datos = [b.descripcion || '', `${mm(s.largo_pieza_mm)} mm de barra por pieza`, `Orejas de ${mm(oreja)} mm`];
      d.trazos.push(ruta([P(-Rn - oreja, 0), ...puntos, P(Rn + oreja, 0)], 'barra'));
      d.trazos.push(circulo(O, p.abrazadera_D_mm / 2, 'oculta'));
      d.cotas.push(cota(P(-p.abrazadera_D_mm / 2, 0), P(p.abrazadera_D_mm / 2, 0), diam(p.abrazadera_D_mm), 'abrazadera_D_mm', 1, -1));
      d.cotas.push(cota(P(Rn, 0), P(Rn + oreja, 0), mm(oreja), null, 1, 1));
      return true;
    }
    const L = s.largo_pieza_mm;
    d.titulo = `${mm(L)} mm de ${b.descripcion || 'barra'}`;
    d.datos = [b.descripcion || '', `${mm(L)} mm por pieza`];
    const h = Math.min(ancho, L / 6);
    d.trazos.push(ruta([P(0, -h / 2), P(L, -h / 2), P(L, h / 2), P(0, h / 2)], 'pieza', true));
    d.cotas.push(cota(P(0, h / 2), P(L, h / 2), mm(L), 'largo_pieza_mm', 1, -1));
    return true;
  }

  /** Armado de piezas: las dos bocas que se unen (cortadas: las piezas siguen en sus partidas) y el cordón de la unión. */
  function union(f, d) {
    const p = f.entrada;
    const D = p.D_mm;
    const n = f.geometria.detalle.n_uniones || 1;
    const R = D / 2;
    const Lb = 1.3 * D;
    const z = D * 0.08;
    d.titulo = `${n > 1 ? `${n} uniones` : 'Unión'} de piezas ${diam(D)}`;
    d.titulo_corto = d.titulo;
    d.datos = [`D = ${nominal(D)}`, n > 1 ? `${n} uniones soldadas por pieza` : 'Unión soldada (filete continuo)', 'Los extremos que se unen van sin brida'];
    [[-Lb, 0], [0, Lb]].forEach(([a, b]) => {
      d.trazos.push({ t: 'relleno', d: [P(a, -R), P(b, -R), P(b, R), P(a, R)] });
      d.trazos.push(ruta([P(a, -R), P(b, -R)], 'pieza'));
      d.trazos.push(ruta([P(a, R), P(b, R)], 'pieza'));
    });
    // las piezas siguen: corte en cada lado
    [-Lb, Lb].forEach((x) => d.trazos.push(ruta([P(x, -R - z), P(x + z * 0.6, -R / 2), P(x - z * 0.6, R / 2), P(x, R + z)], 'corte')));
    d.trazos.push(ruta([P(0, -R - z * 0.5), P(0, R + z * 0.5)], 'soldadura'));
    d.trazos.push(ruta([P(-Lb * 1.08, 0), P(Lb * 1.08, 0)], 'eje'));
    d.cotas.push(cota(P(-Lb * 0.6, R), P(-Lb * 0.6, -R), diam(D), 'D_mm', 1, 1));
    d.cotas.push(nota(P(0, -R), 60, n > 1 ? `${n} uniones soldadas` : 'Unión soldada', 'n_uniones'));
  }

  /** Brida vista de lado en la boca `cara`: sobresale del ducto el ancho de la solera; la suelta va punteada y separada. */
  function bridaLado(d, cara, ancho, suelta) {
    const n = P(-cara.dir[1], cara.dir[0]);
    const c = suelta ? suma(cara.c, por(cara.dir, Math.max(ancho * 0.7, cara.R * 0.15))) : cara.c;
    d.trazos.push(ruta([suma(c, por(n, cara.R + ancho)), suma(c, por(n, -(cara.R + ancho)))], suelta ? 'brida-suelta' : 'brida'));
  }

  /** Las bridas de la pieza en sus bocas y lo que dicen los planos: extremos sin brida y bridas de otra partida. */
  function bridasDeLaPieza(f, d) {
    const her = f.qto && f.qto.her;
    if (!her || her.tipo_union !== 'BRIDADO') return;
    const ancho = (her.bridas[0] && her.bridas[0].ancho_mm) || 38.1;
    if (d.bridasLado) d.bridasLado.forEach((b) => bridaLado(d, b.cara, ancho, b.suelta));
    else her.bridas.forEach((b) => { if (d.caras[b.extremo]) bridaLado(d, d.caras[b.extremo], ancho, b.suelta); });
    const sin = f.geometria.extremos_sin_brida || [];
    const nombres = { A: 'un extremo', B: 'el otro extremo', D1: 'el extremo mayor', D2: 'el extremo menor', injerto: 'el injerto', tronco_1: 'un extremo del tronco', tronco_2: 'el otro extremo del tronco', redondo: 'el extremo redondo', rectangular: 'el extremo rectangular' };
    if (sin.length) {
      const lista = sin.map((x) => nombres[x] || x);
      const t = sin.length === 2 && sin.includes('tronco_1') && sin.includes('tronco_2') ? ['los dos extremos del tronco'] : f.familia === 'CODO' && sin.length === 2 ? ['los dos extremos'] : lista;
      d.datos.push(`Sin brida: ${t.join(' y ')} (se une${sin.length > 1 ? 'n' : ''} a otra pieza)`);
    }
    if (her.bridas_aparte) d.notas.push('Bridas de otra partida (aquí sólo se unen al ducto)');
  }

  /**
   * El dibujo de una partida calculada (f.ok). Devuelve null si su familia no se dibuja (instalación, pieza personalizada,
   * artículo comprado sin círculo de barrenos) o si la partida no se calculó.
   */
  function plano(f, M) {
    if (!f || !f.ok) return null;
    const d = nuevo(f.familia);
    let ok = true;
    switch (f.familia) {
      case 'CODO': codo(f, d); break;
      case 'REDUCCION': reduccion(f, d); break;
      case 'REDUCCION_INJERTO': reduccionInjerto(f, d); break;
      case 'RAMAL': ramal(f, d); break;
      case 'RECTO': recto(f, d); break;
      case 'TRANSICION': transicion(f, d); break;
      case 'BRIDA': ok = brida(f, d); break;
      case 'COMPRADO': ok = comprada(f, d, M); break;
      case 'SOPORTE': ok = soporte(f, d, M); break;
      case 'UNION': union(f, d); break;
      default: ok = false;
    }
    if (ok && !['BRIDA', 'COMPRADO', 'SOPORTE', 'UNION'].includes(f.familia)) bridasDeLaPieza(f, d);
    delete d.bridasLado;
    return ok ? d : null;
  }

  /** Título de la pieza como en los planos de pedido, sólo con lo capturado (sin calcular): «Reducción de 11″ a 10″ con injerto de 5″ a 30°». */
  function titulo(p) {
    if (!p || typeof p !== 'object') return '';
    const n = (x) => (fin(Number(x)) && Number(x) > 0 ? Number(x) : null);
    const rect = p.forma === 'RECTANGULAR';
    switch (p.familia) {
      case 'RECTO':
        if (rect) return n(p.a_mm) && n(p.b_mm) && n(p.L_mm) ? `Tramo recto ${mm(p.a_mm)} × ${mm(p.b_mm)} × ${mm(p.L_mm)} mm` : '';
        return n(p.D_mm) && n(p.L_mm) ? `Tramo recto ${diam(Number(p.D_mm))} × ${mm(p.L_mm)} mm` : '';
      case 'CODO':
        if (!n(p.theta_deg)) return '';
        if (rect) return n(p.a_mm) && n(p.b_mm) ? `Codo ${grados(Number(p.theta_deg))} de ${mm(p.a_mm)} × ${mm(p.b_mm)}` : '';
        return n(p.D_mm) ? `Codo ${grados(Number(p.theta_deg))} ${diam(Number(p.D_mm))}${n(p.n_gajos) ? ` · ${p.n_gajos} gajos` : ''}` : '';
      case 'REDUCCION':
        return n(p.D1_mm) && n(p.D2_mm) ? `Reducción${p.excentrica === 'CARA_PLANA' ? ' excéntrica' : ''} de ${nominal(Number(p.D1_mm))} a ${nominal(Number(p.D2_mm))}` : '';
      case 'REDUCCION_INJERTO':
        return n(p.D1_mm) && n(p.D2_mm) && n(p.d_mm) && n(p.beta_deg) ? `Reducción de ${nominal(Number(p.D1_mm))} a ${nominal(Number(p.D2_mm))} con injerto de ${nominal(Number(p.d_mm))} a ${grados(Number(p.beta_deg))}` : '';
      case 'RAMAL':
        return n(p.D_mm) && n(p.d_mm) && n(p.beta_deg) ? `Ducto de ${nominal(Number(p.D_mm))} con injerto de ${nominal(Number(p.d_mm))} a ${grados(Number(p.beta_deg))}` : '';
      case 'TRANSICION':
        return n(p.D_mm) && n(p.a_mm) && n(p.b_mm) ? `Transición de ${diam(Number(p.D_mm))} a ${mm(p.a_mm)} × ${mm(p.b_mm)}` : '';
      case 'BRIDA':
        if (rect) return n(p.a_mm) && n(p.b_mm) ? `Marco de brida para ducto de ${mm(p.a_mm)} × ${mm(p.b_mm)}` : '';
        return n(p.D_mm) ? `Brida de ${nominal(Number(p.D_mm))}` : '';
      case 'SOPORTE':
        return n(p.abrazadera_D_mm) && !n(p.largo_pieza_mm) ? `Abrazadera para ducto de ${nominal(Number(p.abrazadera_D_mm))}` : '';
      case 'UNION':
        return n(p.D_mm) ? `${Number(p.n_uniones) > 1 ? `${Number(p.n_uniones)} uniones` : 'Unión'} de piezas ${diam(Number(p.D_mm))}` : '';
      default:
        return '';
    }
  }

  /* ---------------- Árbol SVG a escala ---------------- */

  /** Caja que encierra los trazos (sin cotas ni textos). */
  function caja(d) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    const meter = (q) => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); };
    d.trazos.forEach((t) => {
      if (t.t === 'ruta' || t.t === 'relleno') t.d.forEach(meter);
      else if (t.t === 'circulo') { meter([t.c[0] - t.r, t.c[1] - t.r]); meter([t.c[0] + t.r, t.c[1] + t.r]); }
      else if (t.t === 'anillo') { meter([t.c[0] - t.ro, t.c[1] - t.ro]); meter([t.c[0] + t.ro, t.c[1] + t.ro]); }
      else if (t.t === 'marco') { meter([-t.w1 / 2, -t.h1 / 2]); meter([t.w1 / 2, t.h1 / 2]); }
      else if (t.t === 'arco' || t.t === 'sector') {
        const r = t.t === 'sector' ? t.ro : t.r;
        for (let i = 0; i <= 24; i += 1) meter(polar(t.c, r, t.a0 + ((t.a1 - t.a0) * i) / 24));
        if (t.t === 'sector') { meter(polar(t.c, t.ri, t.a0)); meter(polar(t.c, t.ri, t.a1)); }
      } else if (t.t === 'centro') meter(t.c);
    });
    return { x0, y0, x1, y1, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) };
  }

  const r2 = (x) => Math.round(x * 100) / 100;
  const pts = (d) => d.map((q) => `${r2(q[0])},${r2(q[1])}`).join(' ');
  const nodo = (tag, a, c, t) => ({ tag, a: a || {}, c: c || [], t });
  function arcoD(c, r, a0, a1) {
    const p0 = polar(c, r, a0);
    const p1 = polar(c, r, a1);
    const grande = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const barrido = a1 > a0 ? 0 : 1; // con y hacia abajo, contra el reloj a la vista es barrido 0
    return `M${r2(p0[0])} ${r2(p0[1])} A${r2(r)} ${r2(r)} 0 ${grande} ${barrido} ${r2(p1[0])} ${r2(p1[1])}`;
  }
  /** Ángulo de lectura de un texto sobre la dirección v: siempre de izquierda a derecha (entre −90° y 90°). */
  function anguloTexto(v) {
    let a = (Math.atan2(v[1], v[0]) * 180) / PI;
    if (a > 90) a -= 180;
    if (a <= -90) a += 180;
    return a;
  }

  /**
   * Árbol SVG del dibujo: { tag: 'svg', a: { viewBox, width, height, … }, c: [...] }. opciones: px (ancho de referencia en
   * pantalla: con él se escalan textos, flechas y separaciones de las cotas), alto_max (px), compacto (sin cotas, textos ni
   * líneas de construcción: miniatura de px × alto_max), titulo (texto accesible). El marco final encierra la pieza, sus cotas
   * y sus textos: nada queda cortado.
   */
  function arbol(d, opciones) {
    const o = opciones || {};
    const compacto = !!o.compacto;
    const px = o.px || 360;
    const altoMax = o.alto_max || px * 0.75;
    const m = compacto ? 3 : 58; // margen supuesto (px) para escalar la pieza con sus cotas
    const cj = caja(d);
    const s = Math.min((px - 2 * m) / cj.w, (altoMax - 2 * m) / cj.h);
    const u = 1 / s; // un px de pantalla en mm del dibujo
    const fs = 11.5 * u;
    const flecha = 6.5 * u;
    const hijos = [];
    const cotasGrupo = [];
    // marco: la pieza más lo que se dibuje alrededor
    let X0 = cj.x0; let Y0 = cj.y0; let X1 = cj.x1; let Y1 = cj.y1;
    const meter = (q) => { X0 = Math.min(X0, q[0]); Y0 = Math.min(Y0, q[1]); X1 = Math.max(X1, q[0]); Y1 = Math.max(Y1, q[1]); };

    d.trazos.forEach((t) => {
      const cls = `pl-${t.clase || 'pieza'}`;
      if (compacto && (t.clase === 'eje' || t.t === 'centro')) return; // la miniatura sólo lleva la pieza
      if (t.t === 'ruta') hijos.push(nodo(t.cerrada ? 'polygon' : 'polyline', { points: pts(t.d), class: cls }));
      else if (t.t === 'relleno') hijos.unshift(nodo('polygon', { points: pts(t.d), class: 'pl-relleno' }));
      else if (t.t === 'circulo') hijos.push(nodo('circle', { cx: r2(t.c[0]), cy: r2(t.c[1]), r: r2(t.r), class: cls }));
      else if (t.t === 'arco') hijos.push(nodo('path', { d: arcoD(t.c, t.r, t.a0, t.a1), class: cls }));
      else if (t.t === 'anillo') {
        const dd = `M${r2(t.c[0] + t.ro)} ${r2(t.c[1])} A${r2(t.ro)} ${r2(t.ro)} 0 1 0 ${r2(t.c[0] - t.ro)} ${r2(t.c[1])} A${r2(t.ro)} ${r2(t.ro)} 0 1 0 ${r2(t.c[0] + t.ro)} ${r2(t.c[1])} Z `
          + `M${r2(t.c[0] + t.ri)} ${r2(t.c[1])} A${r2(t.ri)} ${r2(t.ri)} 0 1 1 ${r2(t.c[0] - t.ri)} ${r2(t.c[1])} A${r2(t.ri)} ${r2(t.ri)} 0 1 1 ${r2(t.c[0] + t.ri)} ${r2(t.c[1])} Z`;
        hijos.unshift(nodo('path', { d: dd, class: 'pl-anillo', 'fill-rule': 'evenodd' }));
      } else if (t.t === 'marco') {
        const rect = (w, h) => `M${r2(-w / 2)} ${r2(-h / 2)} H${r2(w / 2)} V${r2(h / 2)} H${r2(-w / 2)} Z`;
        hijos.unshift(nodo('path', { d: `${rect(t.w1, t.h1)} ${rect(t.w0, t.h0)}`, class: 'pl-anillo', 'fill-rule': 'evenodd' }));
      } else if (t.t === 'sector') {
        const a = polar(t.c, t.ro, t.a0);
        const b = polar(t.c, t.ri, t.a1);
        const q = polar(t.c, t.ri, t.a0);
        const dd = `${arcoD(t.c, t.ro, t.a0, t.a1)} L${r2(b[0])} ${r2(b[1])} A${r2(t.ri)} ${r2(t.ri)} 0 0 1 ${r2(q[0])} ${r2(q[1])} L${r2(a[0])} ${r2(a[1])} Z`;
        hijos.push(nodo('path', { d: dd, class: cls }));
      } else if (t.t === 'centro') {
        const k = 5 * u;
        hijos.push(nodo('path', { d: `M${r2(t.c[0] - k)} ${r2(t.c[1])} H${r2(t.c[0] + k)} M${r2(t.c[0])} ${r2(t.c[1] - k)} V${r2(t.c[1] + k)}`, class: 'pl-eje-fino' }));
      }
    });

    if (!compacto) {
      /** Texto con su caja aproximada (ancho ≈ 0.58 · tamaño por carácter), girada con él, para el marco. */
      const textoEn = (q, ang, txt, ancla, medio) => {
        const w = String(txt).length * 0.58 * fs;
        const x0 = ancla === 'start' ? 0 : ancla === 'end' ? -w : -w / 2;
        const ys = medio ? [-0.55 * fs, 0.55 * fs] : [-0.85 * fs, 0.25 * fs];
        const c = Math.cos(rad(ang)); const sn = Math.sin(rad(ang));
        [[x0, ys[0]], [x0 + w, ys[0]], [x0 + w, ys[1]], [x0, ys[1]]].forEach(([dx, dy]) => meter([q[0] + dx * c - dy * sn, q[1] + dx * sn + dy * c]));
        return nodo('text', {
          x: r2(q[0]), y: r2(q[1]), 'font-size': r2(fs), 'text-anchor': ancla || 'middle', class: 'pl-txt',
          ...(medio ? { 'dominant-baseline': 'middle' } : {}),
          ...(ang ? { transform: `rotate(${r2(ang)} ${r2(q[0])} ${r2(q[1])})` } : {}),
        }, [], txt);
      };
      const linea = (q0, q1, cls) => { meter(q0); meter(q1); return nodo('path', { d: `M${r2(q0[0])} ${r2(q0[1])} L${r2(q1[0])} ${r2(q1[1])}`, class: cls }); };
      const punta = (q, dir) => { // flecha con la punta en q, apuntando en la dirección dir
        const n = [-dir[1], dir[0]];
        const b = resta(q, por(dir, flecha));
        return nodo('polygon', { points: pts([q, suma(b, por(n, flecha * 0.32)), suma(b, por(n, -flecha * 0.32))]), class: 'pl-flecha' });
      };
      d.cotas.forEach((k) => {
        const g = [];
        if (k.t === 'cota') {
          if (!(largo(resta(k.p2, k.p1)) > 0)) return;
          const v = unit(resta(k.p2, k.p1));
          const n = por([v[1], -v[0]], k.lado); // perpendicular hacia el lado pedido
          const off = k.extra + (k.nivel * 20 + 6) * u;
          const a = suma(k.p1, por(n, off));
          const b = suma(k.p2, por(n, off));
          g.push(linea(suma(k.p1, por(n, 3 * u)), suma(a, por(n, 4 * u)), 'pl-ext'));
          g.push(linea(suma(k.p2, por(n, 3 * u)), suma(b, por(n, 4 * u)), 'pl-ext'));
          g.push(linea(a, b, 'pl-cota'));
          g.push(punta(a, por(v, -1)), punta(b, v));
          const ang = anguloTexto(v);
          // el texto va por fuera de la línea de cota: si su «arriba» mira hacia afuera, la línea base pega con la cota
          const arribaTexto = [Math.sin(rad(ang)), -Math.cos(rad(ang))];
          const afuera = arribaTexto[0] * n[0] + arribaTexto[1] * n[1] > 0;
          g.push(textoEn(suma(por(suma(a, b), 0.5), por(n, afuera ? 4 * u : 4 * u + fs * 0.8)), ang, k.texto));
        } else if (k.t === 'angulo') {
          for (let i = 0; i <= 12; i += 1) meter(polar(k.c, k.r, k.a0 + ((k.a1 - k.a0) * i) / 12));
          g.push(nodo('path', { d: arcoD(k.c, k.r, k.a0, k.a1), class: 'pl-cota' }));
          const t0 = [-Math.sin(rad(k.a0)), -Math.cos(rad(k.a0))]; // tangente en a0 (sentido de a0 → a1)
          const t1 = [-Math.sin(rad(k.a1)), -Math.cos(rad(k.a1))];
          g.push(punta(polar(k.c, k.r, k.a0), por(t0, -1)), punta(polar(k.c, k.r, k.a1), t1));
          g.push(textoEn(polar(k.c, k.r + fs * 0.9, (k.a0 + k.a1) / 2), 0, k.texto, 'middle', true));
        } else if (k.t === 'nota') {
          const der = Math.cos(rad(k.hacia)) >= 0;
          const lejos = polar(k.p, 22 * u, k.hacia);
          const fin_ = suma(lejos, [der ? 10 * u : -10 * u, 0]);
          g.push(linea(k.p, lejos, 'pl-cota'), linea(lejos, fin_, 'pl-cota'));
          g.push(nodo('circle', { cx: r2(k.p[0]), cy: r2(k.p[1]), r: r2(1.8 * u), class: 'pl-flecha' }));
          g.push(textoEn(suma(fin_, [der ? 3 * u : -3 * u, 0]), 0, k.texto, der ? 'start' : 'end', true));
        }
        cotasGrupo.push(nodo('g', { class: 'pl-cotas', ...(k.campo ? { 'data-campo': k.campo } : {}) }, g));
      });
    }
    // marco final: en miniatura, la caja fija; si no, lo que ocupan pieza, cotas y textos, con un respiro
    const pad = (compacto ? m : 5) * u;
    let vb;
    if (compacto) {
      const W_ = px * u; const H_ = altoMax * u;
      vb = [(cj.x0 + cj.x1) / 2 - W_ / 2, (cj.y0 + cj.y1) / 2 - H_ / 2, W_, H_];
    } else vb = [X0 - pad, Y0 - pad, X1 - X0 + 2 * pad, Y1 - Y0 + 2 * pad];
    return nodo('svg', {
      viewBox: vb.map(r2).join(' '), width: Math.round(vb[2] * s), height: Math.round(vb[3] * s),
      class: `plano${compacto ? ' plano-mini' : ''}`, ...(compacto ? { 'aria-hidden': 'true', focusable: 'false' } : { role: 'img', 'aria-label': o.titulo || d.titulo || 'Dibujo de la pieza' }),
      preserveAspectRatio: 'xMidYMid meet',
    }, [...hijos, ...cotasGrupo]);
  }

  return { plano, titulo, arbol, caja, formato: { mm, pulg, diam, nominal, grados } };
}));
