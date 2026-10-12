/**
 * COTIZAP · ventiladores.js — Elegir el ventilador de un colector por su curva (docs/trazado-isometrico.md §5.13).
 *
 * El cálculo de la red (perdidas.js) da el punto de diseño de cada ventilador: el caudal y la presión estática en aire
 * estándar (1.2 kg/m³), la de las curvas de los fabricantes. Este módulo lo cruza con el catálogo de las tablas maestras
 * (grupo ventiladores): cada modelo con su curva a las rpm del catálogo, en aire estándar, como renglones
 * [caudal m³/h, presión estática Pa, potencia al freno kW] con el caudal creciente (potencia 0 = sin dato).
 *
 *   sistema       la red pide SP = k·Q² (k = SP de diseño / Q² de diseño): la parábola por el punto de diseño
 *   a sus rpm     el punto de operación es donde la curva corta la parábola (el corte de mayor caudal)
 *   leyes         a otras rpm la curva se mueve sobre esas mismas parábolas: Q ∝ n, SP ∝ n², P ∝ n³. Las rpm que llevan
 *                 el corte al punto de diseño son n·Q_diseño/Q_corte; el modelo sirve si caben entre su mínimo y su máximo
 *   potencia      la de la curva en el corte, por (rpm/rpm del catálogo)³, por ρ/1.2 (el aire real); el motor comercial
 *                 sale de ella entre la eficiencia de las bandas
 *   estable       el corte cae donde la curva baja (a la derecha del pico): ahí el punto no oscila
 *
 * Los modelos de arranque son ILUSTRATIVOS (curvas inventadas, no de un fabricante): vienen marcados y la salida lo dice.
 * Puro: no muta lo que recibe.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./perdidas'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.ventiladores = factory(root.COTIZAP.perdidas);
  }
}(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  const RHO_ESTANDAR = 1.2;
  const KW_POR_HP = 0.7457;
  const MAX_MODELOS = 60;
  const MAX_PUNTOS = 30;
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const redondo = (x, d) => (finito(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

  /* ------------------------------------------------------------------ revisar */

  /** Lo que no está bien en un modelo del catálogo, en frases (vacío si está bien). */
  function revisarModelo(m) {
    const e = [];
    if (m === null || typeof m !== 'object' || Array.isArray(m)) return ['No es un modelo de ventilador.'];
    const nombre = typeof m.nombre === 'string' && m.nombre.trim() ? m.nombre.trim() : String(m.id);
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(m.id)) e.push(`${nombre}: la clave va con letras, números, guion o guion bajo (hasta 40).`);
    if (typeof m.nombre !== 'string' || !m.nombre.trim() || m.nombre.length > 120) e.push(`${nombre}: le falta el nombre (hasta 120 letras).`);
    if (!(finito(m.rpm) && m.rpm > 0 && m.rpm <= 20000)) e.push(`${nombre}: las rpm de su curva van de más de 0 a 20 000.`);
    if (!(finito(m.rpm_min) && finito(m.rpm_max) && m.rpm_min > 0 && m.rpm_min <= m.rpm_max && m.rpm_max <= 20000)) e.push(`${nombre}: las rpm mínima y máxima van de más de 0 a 20 000, la mínima no mayor que la máxima.`);
    else if (finito(m.rpm) && (m.rpm < m.rpm_min || m.rpm > m.rpm_max)) e.push(`${nombre}: las rpm de su curva (${m.rpm}) quedan fuera de su mínimo y su máximo.`);
    const c = m.curva;
    if (!Array.isArray(c) || c.length < 3 || c.length > MAX_PUNTOS) {
      e.push(`${nombre}: su curva lleva de 3 a ${MAX_PUNTOS} puntos.`);
      return e;
    }
    c.forEach((p, i) => {
      if (!Array.isArray(p) || p.length !== 3 || !p.every(finito)) { e.push(`${nombre}: el punto ${i + 1} de la curva lleva caudal, presión y potencia.`); return; }
      if (p[0] < 0 || p[0] > 1e6) e.push(`${nombre}: el caudal del punto ${i + 1} va de 0 a 1 000 000 m³/h.`);
      if (p[1] < 0 || p[1] > 50000) e.push(`${nombre}: la presión del punto ${i + 1} va de 0 a 50 000 Pa.`);
      if (p[2] < 0 || p[2] > 5000) e.push(`${nombre}: la potencia del punto ${i + 1} va de 0 (sin dato) a 5 000 kW.`);
      if (i && Array.isArray(c[i - 1]) && finito(c[i - 1][0]) && finito(p[0]) && p[0] <= c[i - 1][0]) e.push(`${nombre}: el caudal crece de un punto al siguiente (punto ${i + 1}).`);
    });
    return e;
  }

  /** El catálogo completo: cada modelo y que no se repita una clave. { ok, errores }. */
  function revisarCatalogo(lista) {
    if (!Array.isArray(lista)) return { ok: false, errores: ['El catálogo de ventiladores es una lista.'] };
    const errores = [];
    if (lista.length > MAX_MODELOS) errores.push(`Hasta ${MAX_MODELOS} modelos.`);
    const vistos = new Set();
    lista.forEach((m) => {
      errores.push(...revisarModelo(m));
      if (m && typeof m.id === 'string') {
        if (vistos.has(m.id)) errores.push(`La clave ${m.id} se repite.`);
        vistos.add(m.id);
      }
    });
    return { ok: !errores.length, errores };
  }

  /* ------------------------------------------------------------------ la curva */

  /** El segmento de la curva que contiene a Q (índice del punto de la izquierda), o -1 fuera de ella. */
  function segmento(curva, Q) {
    if (!(Q >= curva[0][0] - 1e-9 && Q <= curva[curva.length - 1][0] + 1e-9)) return -1;
    for (let i = 0; i < curva.length - 1; i += 1) if (Q <= curva[i + 1][0] + 1e-9) return i;
    return curva.length - 2;
  }
  const entre = (a, b, t) => a + (b - a) * t;
  /** La presión estática de la curva a ese caudal (interpolación lineal), o null fuera de la curva. */
  function presionEn(curva, Q) {
    const i = segmento(curva, Q);
    if (i < 0) return null;
    const [q0, s0] = curva[i];
    const [q1, s1] = curva[i + 1];
    return entre(s0, s1, (Q - q0) / (q1 - q0));
  }
  /** La potencia al freno de la curva a ese caudal, o null fuera de la curva o si alguno de sus dos puntos no la trae. */
  function potenciaEn(curva, Q) {
    const i = segmento(curva, Q);
    if (i < 0) return null;
    const [q0, , p0] = curva[i];
    const [q1, , p1] = curva[i + 1];
    if (!(p0 > 0 && p1 > 0)) return null;
    return entre(p0, p1, (Q - q0) / (q1 - q0));
  }
  /**
   * Donde la curva corta la parábola del sistema SP = k·Q²: el corte de mayor caudal, con la pendiente de la curva ahí
   * (negativa = estable). { Q, SP, pendiente, i } o null si no la corta dentro de sus puntos.
   */
  function corte(curva, k) {
    let mejor = null;
    for (let i = 0; i < curva.length - 1; i += 1) {
      const [q0, s0] = curva[i];
      const [q1, s1] = curva[i + 1];
      const b = (s1 - s0) / (q1 - q0);
      const a = s0 - b * q0;
      // k·Q² − b·Q − a = 0
      const disc = b * b + 4 * k * a;
      if (disc < 0) continue;
      [(b + Math.sqrt(disc)) / (2 * k), (b - Math.sqrt(disc)) / (2 * k)].forEach((Q) => {
        if (Q >= q0 - 1e-9 && Q <= q1 + 1e-9 && Q > 0 && (!mejor || Q > mejor.Q)) mejor = { Q, SP: k * Q * Q, pendiente: b, i };
      });
    }
    return mejor;
  }
  /** La curva a otras rpm (leyes del ventilador): Q·r, SP·r², P·r³ con r = rpm / rpm del catálogo. */
  const curvaA = (m, rpm) => { const r = rpm / m.rpm; return m.curva.map(([q, s, p]) => [q * r, s * r * r, p * r * r * r]); };

  /* ------------------------------------------------------------------ elegir */

  /**
   * Los modelos del catálogo para un punto de diseño { caudal_m3_h, presion_estatica_estandar_Pa } con el aire real
   * (densidad_kg_m3) y las bandas (eficiencia_transmision). Devuelve { k, candidatos, descartados }: los candidatos en
   * orden (los que llegan al punto dentro de sus rpm y estables primero; luego por menos potencia), cada uno con las rpm
   * que pide, la potencia al freno con el aire real, el motor, la eficiencia, dónde cae en su curva y qué daría a las rpm
   * de su catálogo; los descartados (con datos que no sirven, o cuya curva no corta la del sistema) con el porqué.
   */
  function elegir(punto, modelos, opciones) {
    const op = opciones || {};
    const Q = punto.caudal_m3_h;
    const SP = punto.presion_estatica_estandar_Pa;
    const rho = finito(op.densidad_kg_m3) && op.densidad_kg_m3 > 0 ? op.densidad_kg_m3 : RHO_ESTANDAR;
    const eta = finito(op.eficiencia_transmision) && op.eficiencia_transmision > 0 && op.eficiencia_transmision <= 1 ? op.eficiencia_transmision : 1;
    if (!(finito(Q) && Q > 0 && finito(SP) && SP > 0)) return { k: null, candidatos: [], descartados: [], error: 'El ventilador no tiene un punto de diseño (caudal y presión mayores que 0).' };
    const k = SP / (Q * Q);
    const candidatos = [];
    const descartados = [];
    (Array.isArray(modelos) ? modelos : []).forEach((m) => {
      const malos = revisarModelo(m);
      const nombre = m && typeof m.nombre === 'string' ? m.nombre : String(m && m.id);
      if (malos.length) { descartados.push({ id: m && m.id, nombre, ilustrativo: !!(m && m.ilustrativo), motivo: malos[0] }); return; }
      const c = corte(m.curva, k);
      if (!c) {
        const fuera = presionEn(m.curva, Q);
        descartados.push({ id: m.id, nombre, ilustrativo: !!m.ilustrativo, motivo: `Su curva no cruza la del sistema: ${fuera === null ? 'el caudal de diseño queda fuera de sus puntos' : 'a ninguna velocidad llega a ese punto dentro de sus puntos'}.` });
        return;
      }
      const r = Q / c.Q;
      const rpm = m.rpm * r;
      const dentro = rpm >= m.rpm_min - 1e-6 && rpm <= m.rpm_max + 1e-6;
      const pCat = potenciaEn(m.curva, c.Q);
      const frenoStd = pCat === null ? null : pCat * r * r * r;
      const freno = frenoStd === null ? null : (frenoStd * rho) / RHO_ESTANDAR;
      const aireStd = (Q / 3600) * SP / 1000;
      const motorHp = freno === null ? null : P.MOTORES_HP.find((x) => x >= freno / eta / KW_POR_HP - 1e-9) || null;
      const q0 = m.curva[0][0];
      const q1 = m.curva[m.curva.length - 1][0];
      const enCurva = (c.Q - q0) / (q1 - q0); // 0 = el cierre, 1 = el último punto (descarga libre)
      const estable = c.pendiente < 0;
      // a las rpm más cercanas que puede dar: lo que entrega sobre la curva del sistema
      const rpmPosible = Math.min(m.rpm_max, Math.max(m.rpm_min, rpm));
      const rp = rpmPosible / m.rpm;
      const notas = [];
      if (!dentro) notas.push(`Pide ${Math.round(rpm)} rpm y da de ${Math.round(m.rpm_min)} a ${Math.round(m.rpm_max)}: con ${Math.round(rpmPosible)} rpm daría ${Math.round(c.Q * rp)} m³/h.`);
      if (!estable) notas.push('El punto cae donde la curva todavía sube (a la izquierda del pico): puede oscilar.');
      else if (enCurva > 0.9) notas.push('El punto cae cerca del final de su curva: poca reserva de presión.');
      if (freno === null) notas.push('Su curva no trae la potencia en ese tramo.');
      if (m.ilustrativo) notas.push('Curva ilustrativa: no es de un fabricante.');
      candidatos.push({
        id: m.id, nombre, ilustrativo: !!m.ilustrativo, rpm: redondo(rpm, 0), rpm_catalogo: m.rpm, rpm_min: m.rpm_min, rpm_max: m.rpm_max, dentro, estable,
        corte_catalogo: { caudal_m3_h: redondo(c.Q, 1), presion_estatica_Pa: redondo(c.SP, 1) }, en_curva: redondo(enCurva, 3),
        potencia_freno_kW: redondo(freno, 3), eficiencia: frenoStd ? redondo(aireStd / frenoStd, 3) : null, motor_hp: motorHp, notas,
        viable: dentro && estable,
      });
    });
    candidatos.sort((a, b) => (b.viable - a.viable) || ((a.potencia_freno_kW === null) - (b.potencia_freno_kW === null)) || ((a.potencia_freno_kW || 0) - (b.potencia_freno_kW || 0)) || (a.id < b.id ? -1 : 1));
    return { k, candidatos, descartados };
  }

  return { RHO_ESTANDAR, KW_POR_HP, MAX_MODELOS, MAX_PUNTOS, revisarModelo, revisarCatalogo, presionEn, potenciaEn, corte, curvaA, elegir };
}));
