/**
 * El modelo del trazado isométrico (src/motor/trazado_iso.js; etapa 1 de docs/trazado-isometrico.md §5): la proyección y su
 * inversa, la rejilla, la manguera, el recorrido del ejemplo clic por clic (que da exactamente el JSON resuelto), el sentido
 * del aire sin importar por dónde se trazó, el imán, las reglas que rechazan lo que el taller no fabrica, los puntos fijos y
 * su compensación, la revisión, la exportación y la lectura de regreso, la pureza y una caminata aleatoria de operaciones.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const T = require('../src/motor/trazado_iso');
const EJ = require('../docs/ejemplos/trazado-isometrico-ejemplo.json');
const ESQUEMA = require('../docs/trazado-isometrico.schema.json');
const { validarEsquema } = require('./esquema_json');

const M = crearMaestros();
const rad = (g) => (g * Math.PI) / 180;
const dir = (az, el) => ({ azimut_deg: az, elevacion_deg: el || 0 });
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const congelar = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') congelar(v); }); return Object.freeze(o); };
const falla = (fn, codigo, re) => assert.throws(fn, (e) => {
  assert.ok(e instanceof T.TrazadoError, `no es TrazadoError: ${e && e.stack}`);
  assert.equal(e.codigo, codigo, e.message);
  if (re) assert.match(e.message, re);
  return true;
});
const PROYECTO = { id: 'EJ-TRAZADO-01', nombre: 'Ejemplo: sierra y cepillo a un colector', servicio: 'POLVO', material_transportado: 'Aserrín y viruta de madera', aire: { temperatura_C: 20, altitud_m: 2240 }, origen: 'Centro de la base del colector, sobre el piso terminado' };
const nodoEn = (t, x, y, z) => { const n = t.nodos.find((q) => Math.abs(q.posicion_mm.x - x) < 0.01 && Math.abs(q.posicion_mm.y - y) < 0.01 && Math.abs(q.posicion_mm.z - z) < 0.01); assert.ok(n, `no hay nodo en ${x}, ${y}, ${z}`); return n.id; };
const entre = (t, a, b) => { const x = t.tramos.find((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a)); assert.ok(x, `no hay tramo de ${a} a ${b}`); return x.id; };
const puerto = (t, eq) => t.equipos.find((e) => e.id === eq).puertos[0];

/** Fase 0 y 1 del ejemplo (§1.6, pasos 1 a 4): colector, sierra con brida y cepillo con manguera. */
function equiposDelEjemplo() {
  let t = T.nuevo(M, { proyecto: PROYECTO });
  t = T.ponerEquipo(t, M, { tipo: 'COLECTOR', nombre: 'Colector de polvo', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1500, ancho: 1500, alto: 4000 }, perdida_Pa: 1250 });
  t = T.agregarPuerto(t, M, 'EQ-01', { rol: 'ENTRADA', nombre: 'Boca del colector', posicion_local_mm: { x: 750, y: 0, z: 3000 }, diametro_in: 8 });
  t = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Sierra de banco', posicion_mm: { x: 10750, y: 0, z: 0 }, caja_mm: { largo: 1200, ancho: 800, alto: 1200 } });
  t = T.agregarPuerto(t, M, 'EQ-02', { nombre: 'Toma superior', posicion_local_mm: { x: 0, y: 0, z: 1200 }, diametro_in: 6, caudal_m3_h: 1300, coef_entrada_K: 0.5 });
  t = T.acoplarBrida(t, M, 'PU-02', { barrenos: { numero: 6, circulo_mm: 190, diametro_mm: 9.5 } });
  t = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Cepillo', posicion_mm: { x: 7000, y: -3000, z: 0 }, caja_mm: { largo: 1000, ancho: 600, alto: 1000 } });
  t = T.agregarPuerto(t, M, 'EQ-03', { nombre: 'Toma superior', posicion_local_mm: { x: 0, y: 0, z: 1000 }, diametro_in: 5, caudal_m3_h: 900, coef_entrada_K: 0.5 });
  t = T.acoplarManguera(t, M, 'PU-03', { altura_mm: 900, desvio_mm: 250, desvio_azimut_deg: 90 });
  return t;
}
/** Fase 3 como en §1.6: el tronco desde la sierra hasta la boca y el ramal desde el PT del cepillo con el imán. */
function ejemploDesdeLasTomas() {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-02').nodo, { direccion: dir(0, 90), largo_mm: 1800 });
  const r1 = T.rutas(t, M, t.ultimo.nodo, { nodo: puerto(t, 'EQ-01').nodo });
  t = T.conectar(t, M, t.ultimo.nodo, r1[0]);
  t = T.trazar(t, M, puerto(t, 'EQ-03').acople.nodo_transicion, { direccion: dir(0, 90), largo_mm: 1100 });
  const cola = t.ultimo.nodo;
  const tronco = entre(t, nodoEn(t, 10750, 0, 3000), puerto(t, 'EQ-01').nodo);
  const r2 = T.rutas(t, M, cola, { tramo: tronco });
  t = T.conectar(t, M, cola, r2[0]);
  return t;
}
/** El mismo sistema trazado al revés: desde la boca del colector hacia las máquinas, el ramal hacia fuera del tronco. */
function ejemploDesdeElColector() {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 10000 });
  const fin = t.ultimo.nodo;
  const tronco = t.ultimo.tramos[0];
  t = T.conectar(t, M, fin, T.rutas(t, M, fin, { nodo: puerto(t, 'EQ-02').nodo })[0]);
  t = T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(315), largo_mm: 2750 * Math.SQRT2, diametro_in: 5 });
  const cola = t.ultimo.nodo;
  t = T.conectar(t, M, cola, T.rutas(t, M, cola, { nodo: puerto(t, 'EQ-03').acople.nodo_transicion })[0]);
  return t;
}
const terminado = (t) => T.renumerar(T.aplicarDimensiones(t, M), M);
const g0neta = (t, id) => T.calcular(t, M).neta.get(id);
const P = require('../src/motor/perdidas');
/** El sistema exportado con el cálculo de pérdidas (etapa 4): el JSON completo del ejemplo. */
const calculado = (s) => P.calcular(s).sistema;

/* ------------------------------------------------------------------ geometría */

test('Proyección isométrica: ejes a 30°, 90° y 150°, escala 1, (1, 1, −1) se ve como un punto', () => {
  const ang = (v) => { const p = T.proyectar(v, 'NE'); return ((Math.atan2(p.v, p.u) * 180) / Math.PI + 360) % 360; };
  cerca(ang({ x: 1, y: 0, z: 0 }), 30, 1e-9, '+X');
  cerca(ang({ x: 0, y: 1, z: 0 }), 150, 1e-9, '+Y');
  cerca(ang({ x: 0, y: 0, z: 1 }), 90, 1e-9, '+Z');
  [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }].forEach((v) => { const p = T.proyectar(v, 'NE'); cerca(Math.hypot(p.u, p.v), 1, 1e-12, 'escala 1'); });
  const k = T.proyectar({ x: 1, y: 1, z: -1 }, 'NE');
  cerca(Math.hypot(k.u, k.v), 0, 1e-12, 'el rayo de la vista');
  const h45 = T.proyectar(T.vectorDe(dir(45)), 'NE');
  cerca(h45.u, 0, 1e-12, 'una horizontal a 45° se ve vertical');
  cerca(h45.v, Math.SQRT1_2, 1e-12, 'y acortada a 0.707');
  ['NE', 'NO', 'SO', 'SE'].forEach((v) => {
    const r = T.rayoDeVista(v);
    const p = T.proyectar(r, v);
    cerca(Math.hypot(p.u, p.v), 0, 1e-9, `rayo de ${v}`);
  });
});

test('Del puntero al espacio: el cruce con el plano de trabajo devuelve el punto, y el plano de canto se avisa', () => {
  const P = { x: 4321.5, y: -1234.25, z: 2750 };
  ['NE', 'NO', 'SO', 'SE', 'PLANTA', 'ELEV_XZ', 'ELEV_YZ'].forEach((v) => {
    const uv = T.proyectar(P, v);
    const planos = [T.planoHorizontal(P.z), T.planoVertical(P, 0), T.planoVertical(P, 90)];
    planos.forEach((pl, i) => {
      const r = T.alPlano(uv, pl, v);
      if (r.punto === null) return;
      if (!r.degenerado) ['x', 'y', 'z'].forEach((c) => cerca(r.punto[c], P[c], 1e-6, `${v} plano ${i} ${c}`));
    });
  });
  // en NE un plano vertical a rumbo 45° o 225° se ve de canto (|cos a − sen a| < 0.25); a 0° no
  assert.equal(T.alPlano({ u: 0, v: 0 }, T.planoVertical(P, 45), 'NE').degenerado, true);
  assert.equal(T.alPlano({ u: 0, v: 0 }, T.planoVertical(P, 225), 'NE').degenerado, true);
  assert.equal(T.alPlano({ u: 0, v: 0 }, T.planoVertical(P, 0), 'NE').degenerado, false);
  assert.equal(T.alPlano({ u: 0, v: 0 }, T.planoVertical(P, 30), 'NE').degenerado, false, '|cos 30° − sen 30°| = 0.366 ≥ 0.25');
});

test('La rejilla: 170 direcciones finas, 26 con 45° y 6 de ejes; lo que no está en ella no es una dirección', () => {
  const pol = T.politicasDe(M, 'POLVO');
  assert.equal(T.rejilla(pol).length, 170);
  assert.equal(T.rejilla({ ...pol, rejilla: T.REJILLAS.EJES_45 }).length, 26);
  assert.equal(T.rejilla({ ...pol, rejilla: T.REJILLAS.EJES }).length, 6);
  T.rejilla(pol).forEach((d) => {
    const v = T.vectorDe(d);
    cerca(Math.hypot(v.x, v.y, v.z), 1, 1e-12);
    assert.deepEqual(T.direccionDeVector({ x: v.x * 3456.7, y: v.y * 3456.7, z: v.z * 3456.7 }, pol), d);
  });
  const u10 = { x: Math.cos(rad(10)) * 1000, y: Math.sin(rad(10)) * 1000, z: 0 };
  assert.equal(T.direccionDeVector(u10, pol), null, 'rumbo 10°');
  assert.equal(T.direccionDeVector({ x: 1000, y: 0.02, z: 0 }, pol), null, 'se desvía 0.02 mm');
  assert.deepEqual(T.direccionDeVector({ x: 1000, y: 0.005, z: 0 }, pol), dir(0), 'a 0.005 mm sí');
  assert.equal(T.direccionDeVector({ x: 1000, y: 1000, z: 0 }, { ...pol, rejilla: T.REJILLAS.EJES }), null, 'la rejilla de ejes no tiene 45°');
  assert.equal(T.textoDireccion(dir(0, 90)), '+Z');
  assert.equal(T.textoDireccion(dir(180)), '−X');
  assert.equal(T.textoDireccion(dir(135, -45)), 'rumbo 135°, baja 45°');
});

test('El aire a 2 240 m y 20 °C y las políticas del taller son las del ejemplo', () => {
  assert.deepEqual(T.aire(20, 2240), { presion_Pa: EJ.proyecto.aire.presion_Pa, densidad_kg_m3: EJ.proyecto.aire.densidad_kg_m3, viscosidad_Pa_s: EJ.proyecto.aire.viscosidad_Pa_s });
  assert.deepEqual(T.politicasDe(M, 'POLVO'), EJ.politicas);
  assert.deepEqual(T.validarPoliticas(EJ.politicas), EJ.politicas);
  const ven = T.politicasDe(M, 'VENTILACION');
  assert.equal(ven.permite_t_90, true);
  assert.equal(ven.reduccion_horizontal, 'CONCENTRICA');
  assert.throws(() => T.validarPoliticas({ ...EJ.politicas, rejilla: { paso_azimut_deg: 20, elevaciones_deg: [0] } }), T.TrazadoError);
  assert.throws(() => T.validarPoliticas({ ...EJ.politicas, velocidad_min_m_s: 30 }), /máxima no puede ser menor/);
  assert.throws(() => T.validarPoliticas({ ...EJ.politicas, angulos_codo_deg: [] }), T.TrazadoError);
});

/* ------------------------------------------------------------------ manguera */

test('Manguera en S: R = (e² + h′²)/4e, α = 2·atan(e/h′), L = 2Rα + 2·puño; los dos arcos cubren e y h′', () => {
  const mg = EJ.politicas.manguera;
  const x = { P_t: { x: 7000, y: -3000, z: 1000 }, u_t: { x: 0, y: 0, z: 1 }, P_r: { x: 7000, y: -2750, z: 1900 }, u_r: { x: 0, y: 0, z: 1 }, diametro_in: 5, manguera: mg };
  const r = T.resolverManguera(x);
  assert.equal(r.forma, 'S');
  cerca(r.radio_mm, 552.5, 1e-9, 'R');
  cerca(r.angulo_curva_deg, (2 * Math.atan(250 / 700) * 180) / Math.PI, 1e-9, 'α');
  cerca(r.angulo_curva_deg, EJ.tramos.find((q) => q.tipo === 'FLEXIBLE').flexible.angulo_curva_deg, 5e-4, 'α del ejemplo');
  cerca(r.largo_mm, 958.0829, 1e-3, 'L');
  const a = rad(r.angulo_curva_deg);
  cerca(2 * r.radio_mm * (1 - Math.cos(a)), 250, 1e-9, 'desvío');
  cerca(2 * r.radio_mm * Math.sin(a), 700, 1e-9, 'altura entre puños');
  assert.deepEqual(r.normal_plano, { x: -1, y: 0, z: 0 });
  assert.equal(r.posible, true);
  const pts = T.puntosManguera(x, r);
  assert.deepEqual(pts[pts.length - 1], x.P_r);
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i].z >= pts[i - 1].z - 1e-9, 'la S sube siempre');
  // el caso rojo del documento (§1.2): 400 mm de desvío en 500 mm de altura
  const rojo = T.resolverManguera({ ...x, P_r: { x: 7000, y: -2600, z: 1500 } });
  cerca(rojo.radio_mm, 156.25, 1e-9, 'R del caso rojo');
  assert.equal(rojo.posible, false);
  assert.match(rojo.motivo, /pide un radio de 156 mm; la manguera de 5″ necesita 190.5 mm/);
  // sin desvío: recta; sin espacio para los puños: no se puede
  const recta = T.resolverManguera({ ...x, P_r: { x: 7000, y: -3000, z: 1600 } });
  assert.equal(recta.forma, 'RECTA');
  assert.equal(recta.largo_mm, 600);
  assert.equal(T.resolverManguera({ ...x, P_r: { x: 7000, y: -2900, z: 1150 } }).posible, false);
  assert.equal(T.resolverManguera({ ...x, P_r: { x: 7000, y: -3000, z: 900 } }).posible, false, 'el PT detrás de la toma');
  // larga: pasa del largo máximo (se puede, con aviso)
  assert.equal(T.resolverManguera({ ...x, P_r: { x: 7000, y: -2750, z: 5000 } }).larga, true);
});

test('Manguera en curva (ejes que se cruzan) y libre (Bézier): radios y largos', () => {
  const mg = EJ.politicas.manguera;
  const x = { P_t: { x: 0, y: 0, z: 1000 }, u_t: { x: 0, y: 0, z: 1 }, P_r: { x: 600, y: 0, z: 1500 }, u_r: { x: 1, y: 0, z: 0 }, diametro_in: 5, manguera: mg };
  const r = T.resolverManguera(x);
  assert.equal(r.forma, 'CODO');
  cerca(r.angulo_curva_deg, 90, 1e-9);
  cerca(r.radio_mm, 400, 1e-9, 'R = min(a, b) − puño');
  cerca(r.largo_mm, 100 + 200 + (Math.PI * 400) / 2, 1e-9, 'L = (a − R) + (b − R) + πR/2');
  cerca(r.tramo_recto_mm, 100, 1e-9, '|a − b|');
  // a 45°: el arco tangente a los dos ejes, T = R·tan(γ/2)
  const u45 = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
  const r45 = T.resolverManguera({ ...x, P_r: { x: 1000 * Math.SQRT1_2, y: 0, z: 1000 + 800 + 1000 * Math.SQRT1_2 }, u_r: u45 });
  assert.equal(r45.forma, 'CODO');
  const tg = Math.tan(rad(22.5));
  cerca(r45.radio_mm, (800 - 100) / tg, 1e-6, 'R a 45°');
  cerca(r45.largo_mm, 800 - 700 + (1000 - 700) + ((800 - 100) / tg) * rad(45), 1e-6, 'L a 45°');
  // ejes que no se cruzan: LIBRE, y torcida si no está en un plano
  const libre = T.resolverManguera({ ...x, P_r: { x: 1500, y: 0, z: 2500 }, u_r: { x: -1, y: 0, z: 0 } });
  assert.equal(libre.forma, 'LIBRE');
  assert.equal(libre.torcida, false);
  assert.ok(libre.radio_mm > 0 && libre.largo_mm > Math.hypot(1500, 1500));
  const torcida = T.resolverManguera({ ...x, P_r: { x: 1500, y: 700, z: 2500 }, u_r: { x: 0, y: 1, z: 0 } });
  assert.equal(torcida.forma, 'LIBRE');
  assert.equal(torcida.torcida, true);
  const pts = T.puntosManguera({ ...x, P_r: { x: 1500, y: 0, z: 2500 }, u_r: { x: -1, y: 0, z: 0 } }, libre);
  assert.deepEqual(pts[pts.length - 1], { x: 1500, y: 0, z: 2500 });
});

/* ------------------------------------------------------------------ el ejemplo, clic por clic */

test('El recorrido de §1.6 da exactamente el JSON del ejemplo (los resultados, con el cálculo de pérdidas)', () => {
  let t = equiposDelEjemplo();
  assert.equal(t.ultimo.info[0].mensaje, 'Manguera en S de dos curvas de 39.31°: radio 552.5 mm (mínimo 190.5 mm), 958 mm de largo.');
  t = T.trazar(t, M, puerto(t, 'EQ-02').nodo, { direccion: dir(0, 90), largo_mm: 1800 });
  const r1 = T.rutas(t, M, t.ultimo.nodo, { nodo: puerto(t, 'EQ-01').nodo });
  assert.equal(r1.length, 1);
  assert.deepEqual(r1[0].segmentos, [{ direccion: dir(180), largo_mm: 10000 }], 'el imán toma la boca a los 10 m');
  t = T.conectar(t, M, t.ultimo.nodo, r1[0]);
  assert.ok(t.ultimo.info.some((i) => i.codigo === 'CODO_INSERTADO'), 'el codo de 90° sale solo');
  assert.ok(t.ultimo.info.some((i) => i.codigo === 'ADAPTADOR_INSERTADO'), 'el tronco de 6″ llega a la boca de 8″ con adaptador');
  t = T.trazar(t, M, puerto(t, 'EQ-03').acople.nodo_transicion, { direccion: dir(0, 90), largo_mm: 1100 });
  const cola = t.ultimo.nodo;
  const r2 = T.rutas(t, M, cola, { tramo: entre(t, nodoEn(t, 10750, 0, 3000), puerto(t, 'EQ-01').nodo) });
  assert.equal(r2.length, 3);
  assert.equal(r2[0].beta_deg, 45);
  assert.equal(r2[0].entrada, 'LATERAL');
  assert.equal(r2[0].giro_entrada_deg, 270);
  assert.deepEqual(r2[0].punto, { x: 4250, y: 0, z: 3000 });
  cerca(r2[0].segmentos[0].largo_mm, 3889.087, 1e-3, 'tramo a 45°');
  assert.equal(r2[1].beta_deg, 30, 'Tab: la de 30°');
  cerca(r2[1].punto.x, 2236.86, 0.01, 'entra en X = 2 237');
  cerca(r2[1].segmentos[0].largo_mm, 5500, 1e-6, 'con 5.5 m');
  assert.equal(r2[0].codos, 1);
  assert.equal(r2[1].codos, 1);
  assert.equal(r2[2].codos, 2, 'la tercera lleva un codo más');
  assert.ok(r2.every((r) => r.estado === 'OK'), JSON.stringify(r2.map((r) => r.avisos)));
  t = T.conectar(t, M, cola, r2[0]);
  // fase 4: dimensionar por caudal propone sólo el tronco al colector: 6″ → 8″, de 33.5 a 18.8 m/s
  const antes = T.revisar(t, M);
  assert.ok(antes.some((v) => v.codigo === 'VELOCIDAD_ALTA' && /33\.5 m\/s \(máximo 23\): con 8″, 18\.8 m\/s/.test(v.mensaje)), antes.map((v) => v.mensaje).join(' | '));
  const dim = T.dimensionar(t, M);
  assert.equal(dim.cambios.length, 1);
  assert.equal(dim.cambios[0].de_in, 6);
  assert.equal(dim.cambios[0].a_in, 8);
  cerca(dim.cambios[0].v_de_m_s, 33.501, 1e-3);
  cerca(dim.cambios[0].v_a_m_s, 18.844, 1e-3);
  t = T.aplicarDimensiones(t, M);
  assert.ok(t.ultimo.info.some((i) => i.codigo === 'DIAMETRO_AUTOMATICO'));
  const despues = T.revisar(t, M);
  assert.deepEqual(despues.map((v) => v.codigo), ['MANGUERA_RESUELTA'], 'sin problemas (§1.6 paso 13)');
  t = T.renumerar(t, M);
  const s = T.aSistema(t, M);
  assert.deepEqual(validarEsquema(s, ESQUEMA), []);
  assert.equal(s.resultados, null, 'el trazo deja los resultados al cálculo');
  assert.deepStrictEqual(calculado(s), EJ);
});

test('El sentido del aire no depende de por dónde se trazó: desde el colector sale el mismo sistema', () => {
  const s = T.aSistema(terminado(ejemploDesdeElColector()), M);
  assert.equal(s.resultados, null, 'el trazo deja los resultados al cálculo');
  assert.deepStrictEqual(calculado(s), EJ);
});

test('El JSON del ejemplo se lee de regreso, se vuelve a escribir igual y renumerar no cambia nada', () => {
  const r = T.desdeSistema(EJ, M);
  assert.deepEqual(r.errores, []);
  assert.deepStrictEqual(calculado(T.aSistema(r.modelo, M)), EJ);
  assert.deepStrictEqual(calculado(T.aSistema(T.renumerar(r.modelo, M), M)), EJ);
  // lo guardado (el modelo como JSON) también vuelve
  const v = T.validar(JSON.parse(JSON.stringify(r.modelo)), M);
  assert.deepEqual(v.errores, []);
  assert.deepStrictEqual(calculado(T.aSistema(v.modelo, M)), EJ);
});

/* ------------------------------------------------------------------ trazar */

test('Desde un extremo horizontal hay 33 direcciones: recta y codos a 30°, 45°, 60° y 90° en el espacio (§2.3)', () => {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 2000 });
  const ops = T.candidatas(t, M, t.ultimo.nodo);
  const pol = t.politicas;
  const esperadas = T.rejilla(pol).filter((d) => {
    const v = T.vectorDe(d);
    const th = (Math.acos(Math.max(-1, Math.min(1, v.x))) * 180) / Math.PI;
    return th < 1e-6 || pol.angulos_codo_deg.some((a) => Math.abs(a - th) < 1e-6);
  });
  assert.equal(ops.length, 33);
  assert.equal(esperadas.length, 33);
  assert.equal(ops.filter((o) => o.pieza === 'RECTO').length, 1);
  assert.ok(!ops.some((o) => o.direccion.azimut_deg === 15 && o.direccion.elevacion_deg === 30), 'a rumbo 15° y 30° de elevación son 33.2°: no hay codo');
  assert.ok(ops.some((o) => o.direccion.azimut_deg === 45 && o.direccion.elevacion_deg === 45 && o.giro_deg === 60), 'a rumbo 45° con 45° de elevación son 60°');
  assert.equal(T.textoCandidatas('N-008', ops), 'Desde N-008 el ducto puede seguir recto, dar vuelta a 30°, 45°, 60° o 90°, subir o bajar.');
  assert.deepEqual(T.candidatas(t, M, puerto(t, 'EQ-02').nodo).map((o) => o.direccion), [dir(0, 90)], 'desde la toma con brida, sólo su cuello');
  assert.deepEqual(T.candidatas(t, M, puerto(t, 'EQ-03').nodo), [], 'la toma con manguera no se traza: el PT sí');
  assert.deepEqual(T.candidatas(t, M, puerto(t, 'EQ-03').acople.nodo_transicion).map((o) => o.direccion), [dir(0, 90)]);
  // elegir con histéresis de 3°: la previa se queda si otra no es mejor por 3° o más
  const v = T.vectorDe(dir(14));
  assert.deepEqual(T.elegirDireccion(ops, v).direccion, dir(0));
  assert.deepEqual(T.elegirDireccion(ops, T.vectorDe(dir(20)), dir(0)).direccion, dir(30), '20° está más cerca de 30° por más de 3°');
  assert.deepEqual(T.elegirDireccion(ops, { x: Math.cos(rad(16)), y: Math.sin(rad(16)), z: 0 }, dir(0)).direccion, dir(0), 'a 16°, 30° sólo gana por 2°');
  assert.equal(T.ajustarLargo(3249, pol), 3200);
  assert.equal(T.ajustarLargo(20, pol), 100);
  assert.equal(T.ajustarLargo(3249, pol, 10), 3250);
});

test('Lo que el taller no fabrica se rechaza con su código del catálogo y el porqué', () => {
  let t = equiposDelEjemplo();
  const boca = puerto(t, 'EQ-01').nodo;
  t = T.trazar(t, M, boca, { direccion: dir(0), largo_mm: 3000 });
  const e = t.ultimo.nodo;
  falla(() => T.trazar(t, M, e, { direccion: dir(75), largo_mm: 1000 }), 'GIRO_NO_FABRICABLE', /da vuelta 75°: el taller hace codos a 30°, 45°, 60° o 90°/);
  assert.throws(() => T.trazar(t, M, e, { direccion: dir(135), largo_mm: 1000 }), (x) => x.codigo === 'GIRO_NO_FABRICABLE' && /dos codos/.test(x.sugerencia));
  falla(() => T.trazar(t, M, e, { direccion: dir(15, 30), largo_mm: 1000 }), 'GIRO_NO_FABRICABLE', /33\.2°/);
  const t60 = T.trazar(t, M, e, { direccion: dir(45, 45), largo_mm: 1000 });
  assert.ok(t60.ultimo.info.some((i) => /Codo de 60°/.test(i.mensaje)));
  falla(() => T.trazar(t, M, puerto(t, 'EQ-02').nodo, { direccion: dir(0), largo_mm: 1000 }), 'BRIDA_DESALINEADA', /cuello de la toma PU-02 de Sierra de banco \(\+Z\)/);
  falla(() => T.trazar(t, M, puerto(t, 'EQ-03').acople.nodo_transicion, { direccion: dir(90), largo_mm: 1000 }), 'PT_DESALINEADO', /\+Z/);
  falla(() => T.trazar(t, M, puerto(t, 'EQ-03').nodo, { direccion: dir(0, 90), largo_mm: 1000 }), 'PUERTO_OCUPADO', /tiene manguera/);
  falla(() => T.trazar(t, M, boca, { direccion: dir(0), largo_mm: 1000 }), 'PUERTO_OCUPADO', /ya está conectada/);
  falla(() => T.trazar(t, M, e, { direccion: dir(0, -90), largo_mm: 3000 }), 'BAJO_PISO', /bajo el piso/);
  falla(() => T.trazar(t, M, e, { direccion: dir(0), largo_mm: 50 }), 'DATO_INVALIDO', /de 0.1 m a 100 m/);
  falla(() => T.trazar(t, M, e, { direccion: dir(10), largo_mm: 500 }), 'DATO_INVALIDO', /cada 15°/);
  falla(() => T.trazar(t, M, e, { direccion: dir(0), largo_mm: 500, diametro_in: 6.5 }), 'DATO_INVALIDO', /comerciales/);
  let t2 = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: { x: 3000, y: 4000, z: 0 }, caja_mm: { largo: 800, ancho: 800, alto: 900 } });
  t2 = T.agregarPuerto(t2, M, 'EQ-04', { posicion_local_mm: { x: 0, y: 0, z: 900 }, diametro_in: 4, caudal_m3_h: 500 });
  falla(() => T.trazar(t2, M, puerto(t2, 'EQ-04').nodo, { direccion: dir(0, 90), largo_mm: 1000 }), 'TOMA_SIN_CONEXION', /Elija primero el acople/);
  falla(() => T.acoplarManguera(t2, M, 'PU-04', { altura_mm: 400, desvio_mm: 450, desvio_azimut_deg: 0 }), 'MANGUERA_IMPOSIBLE', /El desvío de 450 mm en 400 mm de altura pide un radio de 135 mm; la manguera de 4″ necesita 152.4 mm/);
});

test('Derivaciones: a favor del flujo, a 30° o 45°, por arriba o de lado; nunca por abajo ni contra el aire', () => {
  let t = equiposDelEjemplo();
  const boca = puerto(t, 'EQ-01').nodo;
  t = T.trazar(t, M, boca, { direccion: dir(0), largo_mm: 10000, diametro_in: 6 });
  const fin = t.ultimo.nodo;
  const tronco = t.ultimo.tramos[0];
  t = T.conectar(t, M, fin, T.rutas(t, M, fin, { nodo: puerto(t, 'EQ-02').nodo })[0]);
  // el aire del tronco va hacia −X (al colector): un ramal dibujado hacia fuera a rumbo 315° entra a 45° de lado
  const ok = T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(315), largo_mm: 2000, diametro_in: 5 });
  const der = T.calcular(ok, M).derivaciones[0];
  assert.equal(der.beta, 45);
  assert.equal(der.entrada, 'LATERAL');
  falla(() => T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(135), largo_mm: 2000, diametro_in: 5 }), 'CONTRA_FLUJO', /contra el aire/);
  falla(() => T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(0, -45), largo_mm: 1000, diametro_in: 5 }), 'ENTRADA_INFERIOR', /por abajo/);
  falla(() => T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(90), largo_mm: 2000, diametro_in: 5 }), 'DERIVACION_NO_PERMITIDA', /T a 90° en polvo/);
  falla(() => T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(300), largo_mm: 2000, diametro_in: 5 }), 'DERIVACION_NO_PERMITIDA', /entra a 60°/);
  falla(() => T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(315), largo_mm: 2000, diametro_in: 8 }), 'RAMAL_MAYOR', /mayor que su tronco \(6″\)/);
  const arriba = T.trazar(t, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(0, 45), largo_mm: 1500, diametro_in: 5 });
  assert.equal(T.calcular(arriba, M).derivaciones[0].entrada, 'SUPERIOR');
  // en ventilación la T a 90° sí se puede, con aviso de pérdida alta
  const tv = T.cambiarProyecto(t, M, { servicio: 'VENTILACION' });
  const conT = T.trazar(tv, M, { tramo: tronco, s_mm: 3500 }, { direccion: dir(90), largo_mm: 2000, diametro_in: 5 });
  assert.ok(T.calcular(conT, M).piezas.some((p) => p.tipo === 'T_90'));
  assert.ok(T.revisar(conT, M).some((v) => v.codigo === 'T_90_ALTA_PERDIDA'));
  falla(() => T.cambiarProyecto(conT, M, { servicio: 'POLVO' }), 'DERIVACION_NO_PERMITIDA', /T a 90° en polvo/);
  // sin sentido conocido no hay derivación
  let s = T.trazar(T.nuevo(M), M, { posicion_mm: { x: 0, y: 0, z: 3000 } }, { direccion: dir(0), largo_mm: 4000 });
  falla(() => T.trazar(s, M, { tramo: s.ultimo.tramos[0], s_mm: 2000 }, { direccion: dir(45), largo_mm: 1000 }), 'FLUJO_DESCONOCIDO', /Conecte primero/);
  s = T.cambiarDiametro(s, M, s.ultimo.tramos[0], 8);
  assert.equal(T.calcular(s, M).comps[0].flujo, null);
  assert.ok(!T.revisar(s, M).some((v) => v.codigo === 'VELOCIDAD_BAJA'), 'sin tomas no hay aire que avisar');
  assert.deepEqual(T.dimensionar(s, M).cambios, []);
});

test('Desde un codo de 45° se puede seguir recto el tronco: el codo queda como injerto (§2.5.2)', () => {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000, diametro_in: 6 });
  const V = t.ultimo.nodo;
  t = T.trazar(t, M, V, { direccion: dir(45), largo_mm: 1500, diametro_in: 5 });
  assert.equal(T.calcular(t, M).piezasDe.get(V)[0].tipo, 'CODO');
  const ops = T.candidatas(t, M, V);
  assert.deepEqual(ops.map((o) => [o.direccion, o.pieza]), [[dir(0), 'INJERTO']]);
  assert.equal(ops[0].giro_deg, 45);
  assert.equal(T.textoCandidatas(V, ops), `Desde ${V} el ducto puede seguir el tronco en +X, con el codo como injerto a 45°.`);
  const t2 = T.trazar(t, M, V, { direccion: ops[0].direccion, largo_mm: 2000, diametro_in: 6 });
  const pz = T.calcular(t2, M).piezasDe.get(V);
  assert.equal(pz.length, 1);
  assert.equal(pz[0].tipo, 'INJERTO');
  assert.equal(pz[0].geometria.angulo_deg, 45);
  assert.deepEqual(T.candidatas(t2, M, V), [], 'ya es una derivación: no sale otro ducto de ahí');
});

test('El imán ofrece la entrada por arriba cuando el ducto llega desde arriba, y nunca por abajo', () => {
  let t = ejemploDesdeLasTomas();
  t = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Trompo', posicion_mm: { x: 8000, y: 2000, z: 0 }, caja_mm: { largo: 800, ancho: 800, alto: 1000 } });
  t = T.agregarPuerto(t, M, 'EQ-04', { posicion_local_mm: { x: 0, y: 0, z: 1000 }, diametro_in: 4, caudal_m3_h: 600 });
  t = T.acoplarManguera(t, M, 'PU-04', { altura_mm: 900 });
  t = T.trazar(t, M, puerto(t, 'EQ-04').acople.nodo_transicion, { direccion: dir(0, 90), largo_mm: 2100 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(270), largo_mm: 2000 });
  const cola = t.ultimo.nodo;
  const tronco = entre(t, nodoEn(t, 10750, 0, 3000), nodoEn(t, 4250, 0, 3000));
  const rs = T.rutas(t, M, cola, { tramo: tronco }, { max: 6 });
  assert.ok(rs.length >= 2);
  assert.ok(rs.every((r) => r.entrada !== 'INFERIOR'));
  assert.equal(rs[0].entrada, 'SUPERIOR');
  assert.equal(rs[0].beta_deg, 45);
  assert.deepEqual(rs[0].segmentos[0].direccion, dir(180, -45));
  cerca(rs[0].segmentos[0].largo_mm, 1000 * Math.SQRT2, 1e-6);
  assert.deepEqual(rs[0].punto, { x: 7000, y: 0, z: 3000 });
  const t2 = T.conectar(t, M, cola, rs[0]);
  const d = T.calcular(t2, M).derivaciones.find((x) => x.entrada === 'SUPERIOR');
  assert.ok(d);
  assert.deepEqual(T.revisar(t2, M).filter((v) => v.severidad !== 'INFO' && v.codigo !== 'VELOCIDAD_ALTA').map((v) => v.codigo), [], 'sin problemas nuevos (la velocidad alta es del tronco antes de dimensionar)');
});

test('Circuitos y dos colectores en una red se rechazan', () => {
  let t = T.nuevo(M);
  t = T.ponerEquipo(t, M, { tipo: 'COLECTOR', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1500, ancho: 1500, alto: 4000 } });
  t = T.agregarPuerto(t, M, 'EQ-01', { posicion_local_mm: { x: 750, y: 0, z: 3000 }, diametro_in: 8 });
  t = T.trazar(t, M, 'N-001', { direccion: dir(0), largo_mm: 4000 });
  const tronco = t.ultimo.tramos[0];
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(90), largo_mm: 2000 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(180), largo_mm: 2000 });
  const cola = t.ultimo.nodo;
  // regresar al tronco cerraría un circuito
  falla(() => T.conectar(t, M, cola, { segmentos: [{ direccion: dir(270), largo_mm: 2000 }], objetivo: { tramo: tronco, s_mm: 2000 } }), 'CIRCUITO', /circuito/);
  let d = T.ponerEquipo(t, M, { tipo: 'COLECTOR', nombre: 'Otro colector', posicion_mm: { x: -2000, y: 2000, z: 0 }, caja_mm: { largo: 1000, ancho: 1000, alto: 4000 } });
  d = T.agregarPuerto(d, M, 'EQ-02', { posicion_local_mm: { x: 500, y: 0, z: 3000 }, diametro_in: 8 });
  const rs = T.rutas(d, M, cola, { nodo: puerto(d, 'EQ-02').nodo });
  assert.equal(rs.length, 0, 'no hay ruta que junte dos colectores');
  falla(() => T.conectar(d, M, cola, { segmentos: [{ direccion: dir(180), largo_mm: 4250 }], objetivo: { nodo: puerto(d, 'EQ-02').nodo } }), 'DOS_COLECTORES');
});

test('Diámetros: no bajan hacia el colector, el ramal no es mayor que su tronco, y las reducciones y adaptadores salen solos', () => {
  const t = terminado(ejemploDesdeLasTomas());
  falla(() => T.cambiarDiametro(t, M, 'TR-003', 5), 'DIAMETRO_DECRECE', /el tronco llega de 6″ y sale de 5″/);
  falla(() => T.cambiarDiametro(t, M, 'TR-006', 8), 'RAMAL_MAYOR', /6″/);
  // subir el tramo de la sierra a 8″: adaptador en la toma (6″) y la derivación pasa a injerto simple de 8″
  const t2 = T.cambiarDiametro(T.cambiarDiametro(t, M, 'TR-002', 8), M, 'TR-001', 8);
  const g = T.calcular(t2, M);
  assert.ok(g.piezas.some((p) => p.tipo === 'ADAPTADOR' && p.nodo === 'N-004' && p.D1 === 8 && p.D2 === 6));
  assert.ok(g.piezas.some((p) => p.tipo === 'INJERTO' && p.nodo === 'N-002'));
  assert.ok(T.revisar(t2, M).some((v) => v.codigo === 'ADAPTADOR_INSERTADO'));
  const s = T.aSistema(t2, M, { borrador: true });
  assert.deepEqual(validarEsquema(s, ESQUEMA), []);
  assert.equal(s.equipos[1].puertos[0].conexion.adaptador, g.piezas.find((p) => p.tipo === 'ADAPTADOR').id);
  // una reducción en un tramo recto: concéntrica en vertical, excéntrica de cara plana abajo en horizontal (polvo)
  let r = equiposDelEjemplo();
  r = T.trazar(r, M, puerto(r, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  r = T.trazar(r, M, r.ultimo.nodo, { direccion: dir(0), largo_mm: 2000, diametro_in: 6 });
  const red = T.calcular(r, M).piezas.find((p) => p.tipo === 'REDUCCION');
  assert.equal(red.geometria.forma, 'EXCENTRICA_PLANA_ABAJO');
  assert.equal(red.perdida.modelo, 'EXPANSION', 'el aire va de 6″ a 8″');
  assert.ok(T.calcular(r, M).ocupa.get(r.ultimo.tramos[0]).length === 1);
});

/* ------------------------------------------------------------------ puntos fijos */

test('Cambiar un largo entre puntos fijos se compensa en un tramo paralelo; si no hay con qué, FIJO_SE_MUEVE', () => {
  const t = terminado(ejemploDesdeLasTomas());
  const g0 = T.calcular(t, M);
  const t2 = T.cambiarLargo(t, M, 'TR-002', 7000);
  const g = T.calcular(t2, M);
  cerca(g.seg.get('TR-002').L, 7000, 1e-6);
  cerca(g.seg.get('TR-003').L, 3000, 1e-6, 'el tronco al colector absorbe los 500 mm');
  assert.deepEqual(t2.ultimo.compensacion, [{ tramo: 'TR-003', delta_mm: -500 }]);
  ['N-001', 'N-004'].forEach((nd) => assert.deepEqual(g.pos.get(nd), g0.pos.get(nd), `${nd} no se mueve`));
  assert.deepEqual(g.pos.get('N-002'), { x: 3750, y: 0, z: 3000 }, 'la derivación se corre y el ramal con ella');
  const mg = g.mang.get('TR-004');
  cerca(mg.desvio_mm, Math.hypot(500, 250), 1e-6, 'la manguera se vuelve a resolver');
  falla(() => T.cambiarLargo(t, M, 'TR-001', 2000), 'FIJO_SE_MUEVE', /punto fijo/);
  // lado libre: un tramo que termina en un extremo sólo se alarga
  let l = equiposDelEjemplo();
  l = T.trazar(l, M, puerto(l, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  l = T.trazar(l, M, l.ultimo.nodo, { direccion: dir(90), largo_mm: 2000 });
  const extremo = l.ultimo.nodo;
  const l2 = T.cambiarLargo(l, M, l.ultimo.tramos[0], 2500);
  assert.deepEqual(l2.nodos.find((x) => x.id === extremo).posicion_mm, { x: 3750, y: 2500, z: 3000 });
});

test('La compensación usa dos direcciones cuando el camino no tiene un tramo paralelo', () => {
  let t = equiposDelEjemplo();
  t = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Tupí', posicion_mm: { x: 6164.214, y: 3414.214, z: 0 }, caja_mm: { largo: 800, ancho: 800, alto: 1000 } });
  t = T.agregarPuerto(t, M, 'EQ-04', { posicion_local_mm: { x: 0, y: 0, z: 1000 }, diametro_in: 5, caudal_m3_h: 800 });
  t = T.acoplarBrida(t, M, 'PU-04');
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 2000 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(90), largo_mm: 2000 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(45), largo_mm: 2000 });
  const diagonal = t.ultimo.tramos[0];
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(0), largo_mm: 2000 });
  t = T.conectar(t, M, t.ultimo.nodo, T.rutas(t, M, t.ultimo.nodo, { nodo: puerto(t, 'EQ-04').nodo })[0]);
  const g0 = T.calcular(t, M);
  const t2 = T.cambiarLargo(t, M, diagonal, 2500);
  assert.equal(t2.ultimo.compensacion.length, 2, JSON.stringify(t2.ultimo.compensacion));
  const g = T.calcular(t2, M);
  [puerto(t, 'EQ-01').nodo, puerto(t, 'EQ-04').nodo].forEach((nd) => assert.deepEqual(g.pos.get(nd), g0.pos.get(nd)));
  cerca(g.seg.get(diagonal).L, 2500, 1e-3);
  t2.ultimo.compensacion.forEach((c) => cerca(Math.abs(c.delta_mm), 500 * Math.SQRT1_2, 1e-3, c.tramo));
});

test('Mover un equipo: con brida arrastra su ducto y se compensa; con manguera se vuelve a resolver o se rechaza', () => {
  const t = terminado(ejemploDesdeLasTomas());
  const t2 = T.moverEquipo(t, M, 'EQ-02', { posicion_mm: { x: 11250, y: 0, z: 0 } });
  const g = T.calcular(t2, M);
  assert.deepEqual(g.pos.get('N-004'), { x: 11250, y: 0, z: 1200 });
  cerca(g.seg.get('TR-002').L, 7000, 1e-6, 'el tronco de la sierra se alarga');
  assert.deepEqual(g.pos.get('N-002'), { x: 4250, y: 0, z: 3000 }, 'la derivación y el colector se quedan');
  const t3 = T.moverEquipo(t, M, 'EQ-03', { posicion_mm: { x: 7000, y: -2800, z: 0 } });
  cerca(T.calcular(t3, M).mang.get('TR-004').desvio_mm, 50, 1e-6);
  falla(() => T.moverEquipo(t, M, 'EQ-03', { posicion_mm: { x: 7000, y: -3000, z: 700 } }), 'MANGUERA_IMPOSIBLE');
  falla(() => T.moverEquipo(t, M, 'EQ-02', { posicion_mm: { x: 10750, y: 500, z: 0 } }), 'FIJO_SE_MUEVE', /Sierra de banco/);
  // mover el PT de una manguera con ducto: la bajante se acorta y lo demás se queda
  const t4 = T.moverTransicion(t, M, 'PU-03', { altura_mm: 1000, desvio_mm: 250, desvio_azimut_deg: 90 });
  const g4 = T.calcular(t4, M);
  cerca(g4.seg.get('TR-005').L, 1000, 1e-6);
  assert.deepEqual(g4.pos.get('N-005'), { x: 7000, y: -2750, z: 3000 });
  assert.ok(t4.ultimo.info.some((i) => i.codigo === 'MANGUERA_RESUELTA'));
});

test('Una máquina con dos tomas con brida en la misma red se mueve entera; la otra toma no cuenta como punto fijo', () => {
  let t = T.nuevo(M);
  t = T.ponerEquipo(t, M, { tipo: 'COLECTOR', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1500, ancho: 1500, alto: 4000 } });
  t = T.agregarPuerto(t, M, 'EQ-01', { posicion_local_mm: { x: 750, y: 0, z: 3000 }, diametro_in: 6 });
  t = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Escuadradora', posicion_mm: { x: 8000, y: 0, z: 0 }, caja_mm: { largo: 1200, ancho: 800, alto: 1000 } });
  t = T.agregarPuerto(t, M, 'EQ-02', { posicion_local_mm: { x: -300, y: 0, z: 1000 }, diametro_in: 5, caudal_m3_h: 900 });
  t = T.agregarPuerto(t, M, 'EQ-02', { posicion_local_mm: { x: 300, y: 0, z: 1000 }, diametro_in: 4, caudal_m3_h: 500 });
  t = T.acoplarBrida(T.acoplarBrida(t, M, 'PU-02'), M, 'PU-03');
  const [A, B] = t.equipos[1].puertos.map((p) => p.nodo);
  t = T.trazar(t, M, A, { direccion: dir(0, 90), largo_mm: 2000 });
  const riser = t.ultimo.tramos[0];
  t = T.conectar(t, M, t.ultimo.nodo, T.rutas(t, M, t.ultimo.nodo, { nodo: 'N-001' })[0]);
  t = T.trazar(t, M, B, { direccion: dir(0, 90), largo_mm: 1000 });
  const rs = T.rutas(t, M, t.ultimo.nodo, { tramo: riser });
  assert.equal(rs[0].beta_deg, 45);
  assert.equal(rs[0].entrada, null, 'en un tronco vertical no hay arriba ni abajo');
  t = T.conectar(t, M, t.ultimo.nodo, rs[0]);
  assert.deepEqual(T.revisar(t, M).filter((v) => v.severidad === 'ERROR'), []);
  const t2 = T.moverEquipo(t, M, 'EQ-02', { posicion_mm: { x: 8500, y: 0, z: 0 } });
  const g = T.calcular(t2, M);
  assert.deepEqual(g.pos.get(A), { x: 8200, y: 0, z: 1000 });
  assert.deepEqual(g.pos.get(B), { x: 8800, y: 0, z: 1000 });
  assert.deepEqual(g.pos.get('N-001'), { x: 750, y: 0, z: 3000 });
  const alColector = t.tramos.find((q) => q.a === 'N-001' || q.b === 'N-001').id;
  cerca(g.seg.get(alColector).L, T.calcular(t, M).seg.get(alColector).L + 500, 1e-6, 'el tronco al colector absorbe los 500 mm');
  // girarla 180° cambiaría de lugar sus dos tomas: no hay con qué compensarlo
  falla(() => T.moverEquipo(t, M, 'EQ-02', { rotacion_z_deg: 180 }), 'FIJO_SE_MUEVE');
});

test('Mover un segmento estira sus vecinos paralelos; girar un codo mueve el lado libre sin salir de la rejilla', () => {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(0, 90), largo_mm: 1000 });
  const sube = t.ultimo.tramos[0];
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(0), largo_mm: 2000 });
  const medio = t.ultimo.tramos[0];
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(0, -90), largo_mm: 1000 });
  const baja = t.ultimo.tramos[0];
  const t2 = T.moverSegmento(t, M, medio, { x: 0, y: 0, z: 500 });
  const g = T.calcular(t2, M);
  cerca(g.seg.get(sube).L, 1500, 1e-6);
  cerca(g.seg.get(baja).L, 1500, 1e-6);
  falla(() => T.moverSegmento(t, M, medio, { x: 0, y: 500, z: 0 }), 'MOVER_NO_POSIBLE', /no es paralelo/);
  falla(() => T.moverSegmento(t, M, medio, { x: 0, y: 0, z: -950 }), 'MOVER_NO_POSIBLE', /mínimo/);
  // un codo horizontal de 90° a 45°: el lado libre gira sobre Z
  let h = equiposDelEjemplo();
  h = T.trazar(h, M, puerto(h, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  const codo = h.ultimo.nodo;
  h = T.trazar(h, M, codo, { direccion: dir(90), largo_mm: 2000 });
  const h2 = T.cambiarAngulo(h, M, codo, 45);
  const g2 = T.calcular(h2, M);
  assert.deepEqual(g2.seg.get(h.ultimo.tramos[0]).dir, dir(45));
  assert.equal(g2.piezasDe.get(codo)[0].geometria.angulo_deg, 45);
  // en un plano vertical, girar un lado que tiene un tramo a rumbo 45° lo sacaría de la rejilla
  let v = equiposDelEjemplo();
  v = T.trazar(v, M, puerto(v, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  const c1 = v.ultimo.nodo;
  v = T.trazar(v, M, c1, { direccion: dir(0, 90), largo_mm: 1000 });
  v = T.trazar(v, M, v.ultimo.nodo, { direccion: dir(45), largo_mm: 1000 });
  falla(() => T.cambiarAngulo(v, M, c1, 60), 'GIRO_NO_FABRICABLE', /rejilla/);
  const t3 = equiposDelEjemplo();
  const t3b = T.trazar(t3, M, puerto(t3, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 3000 });
  const t3c = T.trazar(t3b, M, t3b.ultimo.nodo, { direccion: dir(0, 90), largo_mm: 1000 });
  const t3d = T.trazar(t3c, M, t3c.ultimo.nodo, { direccion: dir(90), largo_mm: 1000 });
  const g3 = T.calcular(T.cambiarAngulo(t3d, M, t3b.ultimo.nodo, 60), M);
  assert.deepEqual(g3.seg.get(t3c.ultimo.tramos[0]).dir, dir(0, 60), 'la vertical queda a 60°');
});

/* ------------------------------------------------------------------ borrar, dimensionar, revisar, exportar */

test('Borrar el ramal deja la subred sin colector; con ramal: true se va hasta la toma', () => {
  const t = terminado(ejemploDesdeLasTomas());
  const t2 = T.borrarTramo(t, M, 'TR-006');
  const v = T.revisar(t2, M);
  assert.ok(v.some((x) => x.codigo === 'SUBRED_SIN_COLECTOR'));
  assert.ok(v.some((x) => x.codigo === 'EXTREMO_ABIERTO'));
  assert.ok(T.calcular(t2, M).piezas.some((p) => p.tipo === 'REDUCCION' && p.nodo === 'N-002'), 'la derivación queda como reducción de 6″ a 8″');
  falla(() => T.aSistema(t2, M), 'NO_EXPORTABLE');
  assert.deepEqual(validarEsquema(T.aSistema(t2, M, { borrador: true }), ESQUEMA), []);
  const t3 = T.borrarTramo(t, M, 'TR-006', { ramal: true });
  assert.ok(!t3.tramos.some((x) => ['TR-004', 'TR-005', 'TR-006'].includes(x.id)));
  assert.equal(puerto(t3, 'EQ-03').acople, null);
  assert.ok(T.revisar(t3, M).some((x) => x.codigo === 'TOMA_SIN_CONEXION'));
  const s = T.aSistema(t3, M, { borrador: true });
  assert.equal(s.equipos[2].puertos[0].conexion, null);
  assert.deepEqual(validarEsquema(s, ESQUEMA), []);
  // los identificadores no se reusan
  const t4 = T.trazar(t3, M, 'N-002', { direccion: dir(315), largo_mm: 500 });
  assert.ok(!['TR-004', 'TR-005', 'TR-006'].includes(t4.ultimo.tramos[0]));
});

test('Dimensionar respeta el candado y no hace al ramal mayor que su tronco', () => {
  let t = ejemploDesdeLasTomas();
  const tronco = entre(t, nodoEn(t, 4250, 0, 3000), puerto(t, 'EQ-01').nodo);
  t = T.cambiarDiametro(t, M, tronco, 6, { bloquear: true });
  const d = T.dimensionar(t, M);
  assert.deepEqual(d.cambios, []);
  assert.ok(d.avisos.some((a) => a.codigo === 'DIAMETRO_BLOQUEADO'));
  // un ramal con más caudal que el tronco
  let r = terminado(ejemploDesdeLasTomas());
  r = T.editarPuerto(r, M, 'PU-03', { caudal_m3_h: 3000 });
  const dr = T.dimensionar(r, M);
  assert.ok(dr.avisos.some((a) => a.codigo === 'TRONCO_MENOR_QUE_RAMAL'));
  const r2 = T.aplicarDimensiones(r, M);
  const g = T.calcular(r2, M);
  const der = g.derivaciones[0];
  assert.ok(g.tramos.get(der.ramal).diametro_in <= g.tramos.get(der.tIn).diametro_in);
});

test('La revisión encuentra choques, equipos encimados, altura libre, tramos cortos y accesorios que no caben', () => {
  let t = equiposDelEjemplo();
  t = T.trazar(t, M, puerto(t, 'EQ-01').nodo, { direccion: dir(0), largo_mm: 6000 });
  const t1 = t.ultimo.tramos[0];
  // un ducto paralelo a 150 mm del primero
  let c = T.trazar(t, M, { posicion_mm: { x: 1000, y: 150, z: 3000 } }, { direccion: dir(0), largo_mm: 3000 });
  assert.ok(T.revisar(c, M).some((v) => v.codigo === 'CHOQUE_DUCTOS' && v.elementos.includes(t1)));
  // un ducto que atraviesa la sierra
  c = T.trazar(t, M, { posicion_mm: { x: 9000, y: 0, z: 600 } }, { direccion: dir(0), largo_mm: 3000 });
  assert.ok(T.revisar(c, M).some((v) => v.codigo === 'CHOQUE_EQUIPO' && v.elementos.includes('EQ-02')));
  assert.ok(T.revisar(c, M).some((v) => v.codigo === 'ALTURA_LIBRE'));
  // equipos encimados
  const e = T.ponerEquipo(t, M, { tipo: 'MAQUINA', posicion_mm: { x: 10750, y: 500, z: 0 }, caja_mm: { largo: 500, ancho: 500, alto: 500 } });
  assert.ok(T.revisar(e, M).some((v) => v.codigo === 'EQUIPOS_ENCIMADOS'));
  // dos codos con 100 mm a ejes entre ellos: los accesorios no caben
  let k = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(90), largo_mm: 300 });
  k = T.trazar(k, M, k.ultimo.nodo, { direccion: dir(0), largo_mm: 1000 });
  const vk = T.revisar(k, M);
  assert.ok(vk.some((v) => v.codigo === 'ACCESORIOS_NO_CABEN'), vk.map((v) => v.codigo).join());
  let k2 = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(90), largo_mm: 750 });
  k2 = T.trazar(k2, M, k2.ultimo.nodo, { direccion: dir(0), largo_mm: 1000 });
  assert.ok(T.revisar(k2, M).some((v) => v.codigo === 'TRAMO_CORTO' && /mínimo 150/.test(v.mensaje)));
  // tomas sin acople, sin caudal; manguera larga
  let s = T.ponerEquipo(t, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: { x: 3000, y: 4000, z: 0 }, caja_mm: { largo: 800, ancho: 800, alto: 900 } });
  s = T.agregarPuerto(s, M, 'EQ-04', { posicion_local_mm: { x: 0, y: 0, z: 900 }, diametro_in: 4 });
  const vs = T.revisar(s, M);
  assert.ok(vs.some((v) => v.codigo === 'TOMA_SIN_CONEXION' && /no tiene acople/.test(v.mensaje)));
  assert.ok(vs.some((v) => v.codigo === 'TOMA_SIN_DATOS'));
  s = T.acoplarManguera(s, M, 'PU-04', { altura_mm: 3500 });
  assert.ok(T.revisar(s, M).some((v) => v.codigo === 'MANGUERA_LARGA'));
  // reducción brusca: de 8″ a 3″
  const b = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(0), largo_mm: 1000, diametro_in: 3 });
  assert.ok(T.revisar(b, M).some((v) => v.codigo === 'REDUCCION_BRUSCA'));
});

test('Proyecto, políticas y material: cambiar una política que el trazo ya no cumple se rechaza', () => {
  const t = terminado(ejemploDesdeLasTomas());
  falla(() => T.cambiarPoliticas(t, M, { angulos_injerto_deg: [30] }), 'DERIVACION_NO_PERMITIDA', /injertos a 30°/);
  falla(() => T.cambiarPoliticas(t, M, { rejilla: T.REJILLAS.EJES }), 'DIRECCION_FUERA_DE_REJILLA');
  const t2 = T.cambiarPoliticas(t, M, { velocidad_min_m_s: 20 });
  assert.ok(T.revisar(t2, M).some((v) => v.codigo === 'VELOCIDAD_BAJA'));
  const t3 = T.cambiarMaterial(t, M, 'ACERO_CARBON', 16, { todos: true });
  const s = T.aSistema(t3, M);
  assert.ok(s.tramos.filter((x) => x.tipo === 'RIGIDO').every((x) => x.material === 'ACERO_CARBON' && x.calibre === 16 && x.rugosidad_mm === 0.045));
  const t4 = T.cambiarProyecto(t, M, { aire: { temperatura_C: 40, altitud_m: 0 } });
  assert.equal(T.aSistema(t4, M).proyecto.aire.presion_Pa, 101325);
  falla(() => T.cambiarProyecto(t, M, { servicio: 'AGUA' }), 'DATO_INVALIDO');
});

/* ------------------------------------------------------------------ pureza y robustez */

test('Las operaciones no tocan el trazo que reciben', () => {
  const t = congelar(terminado(ejemploDesdeLasTomas()));
  const antes = JSON.stringify(t);
  T.cambiarLargo(t, M, 'TR-002', 7000);
  T.moverEquipo(t, M, 'EQ-02', { posicion_mm: { x: 11000, y: 0, z: 0 } });
  T.borrarTramo(t, M, 'TR-006', { ramal: true });
  T.cambiarDiametro(t, M, 'TR-003', 10);
  T.rutas(t, M, 'N-003', { nodo: 'N-001' });
  T.aSistema(t, M);
  T.renumerar(t, M);
  assert.equal(JSON.stringify(t), antes);
});

test('Lo que viene de fuera se valida: formas raras, referencias rotas y trazos que el taller no fabrica', () => {
  const base = terminado(ejemploDesdeLasTomas());
  const malos = [
    null, 7, 'x', [], {}, { version: 2 },
    { ...base, tramos: 'no' },
    { ...base, tramos: base.tramos.map((x, i) => (i ? x : { ...x, b: 'N-999' })) },
    { ...base, tramos: base.tramos.map((x, i) => (i ? x : { ...x, diametro_in: 6.5 })) },
    { ...base, nodos: base.nodos.map((x, i) => (i ? x : { ...x, posicion_mm: { x: NaN, y: 0, z: 0 } })) },
    { ...base, nodos: base.nodos.map((x) => (x.id === 'N-003' ? { ...x, posicion_mm: { x: 10750, y: 0, z: 3100 } } : x)) },
    { ...base, nodos: base.nodos.map((x) => (x.id === 'N-005' ? { ...x, posicion_mm: { x: 7000, y: -2700, z: 3000 } } : x)) },
    { ...base, equipos: base.equipos.map((e, i) => (i ? e : { ...e, puertos: [{ ...e.puertos[0], posicion_local_mm: { x: 0, y: 0, z: 1 } }] })) },
    { ...base, tramos: [...base.tramos, { ...base.tramos[0], id: 'TR-099', a: 'N-001', b: 'N-005' }] },
    { ...base, politicas: { ...base.politicas, angulos_codo_deg: [45] } },
  ];
  malos.forEach((x, i) => {
    const r = T.validar(x, M);
    assert.equal(r.modelo, null, `caso ${i}`);
    assert.ok(r.errores.length > 0 && r.errores.every((e) => typeof e === 'string'), `caso ${i}`);
  });
  assert.deepEqual(T.validar(base, M).errores, []);
  const malEJ = [null, {}, { ...EJ, version: '2.0' }, { ...EJ, tramos: EJ.tramos.slice(1) }, { ...EJ, accesorios: [{ ...EJ.accesorios[0], id: 'XX-001' }] }];
  malEJ.forEach((x, i) => { const r = T.desdeSistema(x, M); assert.equal(r.modelo, null, `sistema ${i}`); });
  // datos absurdos en las operaciones: siempre TrazadoError
  [
    () => T.ponerEquipo(base, M, { tipo: 'NAVE', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1, ancho: 1, alto: 1 } }),
    () => T.ponerEquipo(base, M, { tipo: 'MAQUINA', posicion_mm: { x: 1e9, y: 0, z: 0 }, caja_mm: { largo: 1, ancho: 1, alto: 1 } }),
    () => T.ponerEquipo(base, M, { tipo: 'MAQUINA', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: -1, ancho: 1, alto: 1 } }),
    () => T.agregarPuerto(base, M, 'EQ-02', { posicion_local_mm: { x: 0, y: 0, z: 500 }, diametro_in: 6 }),
    () => T.agregarPuerto(base, M, 'EQ-99', { posicion_local_mm: { x: 0, y: 0, z: 1200 }, diametro_in: 6 }),
    () => T.editarPuerto(base, M, 'PU-02', { caudal_m3_h: -5 }),
    () => T.trazar(base, M, 'N-999', { direccion: dir(0), largo_mm: 1000 }),
    () => T.trazar(base, M, 'N-003', { direccion: { azimut_deg: 'x' }, largo_mm: 1000 }),
    () => T.cambiarLargo(base, M, 'TR-002', Infinity),
    () => T.cambiarDiametro(base, M, 'TR-004', 6),
    () => T.moverSegmento(base, M, 'TR-002', { x: 0, y: 0, z: NaN }),
    () => T.conectar(base, M, 'N-003', { segmentos: [], objetivo: { nodo: 'N-001' } }),
    () => T.acoplarManguera(base, M, 'PU-01', { altura_mm: 500 }),
    () => T.cambiarAngulo(base, M, 'N-002', 45),
  ].forEach((f, i) => assert.throws(f, T.TrazadoError, `caso ${i}`));
});

test('Reducir desde un punto o desde un codo: el Ø baja de ahí hacia las tomas, sin pasar derivaciones ni candados', () => {
  const t0 = terminado(ejemploDesdeLasTomas());
  const sierra = entre(t0, nodoEn(t0, 10750, 0, 3000), nodoEn(t0, 4250, 0, 3000));
  // a 2 m del codo de la sierra: la horizontal se parte, y la parte de aguas arriba y la subida quedan de 5″
  const g0 = T.calcular(t0, M);
  const s = g0.tramos.get(sierra).a === nodoEn(t0, 10750, 0, 3000) ? 2000 : g0.seg.get(sierra).L - 2000;
  const t = T.reducir(t0, M, { tramo: sierra, s_mm: s }, 5);
  assert.equal(t.ultimo.operacion, 'reducir');
  assert.equal(t.ultimo.tramos.length, 2, 'la parte de aguas arriba y la subida');
  const g = T.calcular(t, M);
  const J = t.ultimo.nodo;
  assert.deepEqual(g.pos.get(J), { x: 8750, y: 0, z: 3000 });
  assert.ok(g.piezasDe.get(J).some((p) => p.tipo === 'REDUCCION' && p.D1 === 6 && p.D2 === 5));
  assert.ok(g.piezas.some((p) => p.tipo === 'ADAPTADOR' && p.D_puerto === 6), 'la toma de 6″ lleva su adaptador a 5″');
  assert.equal(g.tramos.get(entre(t, nodoEn(t, 4250, 0, 3000), J)).diametro_in, 6, 'aguas abajo sigue de 6″');
  // pegado a un extremo: el tramo entero
  const te = T.reducir(t0, M, { tramo: sierra, s_mm: 50 }, 5);
  assert.equal(te.tramos.length, t0.tramos.length, 'no se parte');
  // desde el codo de la sierra: el tramo que le llega (la subida)
  const tc = T.reducir(t0, M, nodoEn(t0, 10750, 0, 3000), 5);
  assert.deepEqual(tc.ultimo.tramos, [entre(t0, nodoEn(t0, 10750, 0, 1200), nodoEn(t0, 10750, 0, 3000))]);
  // desde la derivación: el tronco que llega, sin pasar al ramal; el candado detiene la cadena
  const td = T.reducir(t0, M, nodoEn(t0, 4250, 0, 3000), 5);
  assert.equal(td.ultimo.tramos[0], sierra);
  // la subida con candado no baja; entonces su 6″ llegaría a un 5″ hacia el colector, y se rechaza con el porqué
  const conCandado = T.cambiarDiametro(t0, M, entre(t0, nodoEn(t0, 10750, 0, 1200), nodoEn(t0, 10750, 0, 3000)), 6, { bloquear: true });
  falla(() => T.reducir(conCandado, M, { tramo: sierra, s_mm: s }, 5), 'DIAMETRO_DECRECE', /el tramo anterior \(TR-\d+\) es de 6″ y el siguiente \(TR-\d+\) de 5″/);
  // lo que no se puede
  falla(() => T.reducir(t0, M, { tramo: sierra, s_mm: s }, 8), 'DATO_INVALIDO', /debe ser menor/);
  falla(() => T.reducir(t0, M, { tramo: sierra, s_mm: s }, 7.5), 'DATO_INVALIDO', /comerciales/);
  falla(() => T.reducir(t0, M, puerto(t0, 'EQ-02').nodo, 5), 'DATO_INVALIDO', /no le llega ducto de aguas arriba/);
  falla(() => T.reducir(t0, M, nodoEn(t0, 750, 0, 3000), 5), 'DIAMETRO_DECRECE', /Hacia el colector el diámetro no baja/);
  const suelto = T.trazar(T.nuevo(M), M, { posicion_mm: { x: 0, y: 0, z: 3000 } }, { direccion: dir(0), largo_mm: 3000 });
  falla(() => T.reducir(suelto, M, { tramo: 'TR-001', s_mm: 1500 }, 4), 'FLUJO_DESCONOCIDO');
  falla(() => T.reducir(t0, M, { tramo: entre(t0, puerto(t0, 'EQ-03').nodo, puerto(t0, 'EQ-03').acople.nodo_transicion), s_mm: 100 }, 4), 'DATO_INVALIDO', /manguera/);
});

/** Un tramo corto entre dos codos: horizontal, 0.5 m (o el largo dado) y de regreso, a 2.5 m de altura. */
function tramoCorto(largo) {
  let t = T.nuevo(M);
  t = T.trazar(t, M, { posicion_mm: { x: 0, y: 0, z: 2500 } }, { direccion: dir(0), largo_mm: 2000 });
  t = T.trazar(t, M, t.ultimo.nodo, { direccion: dir(90), largo_mm: largo || 500 });
  return T.trazar(t, M, t.ultimo.nodo, { direccion: dir(180), largo_mm: 2000 });
}
const codigos = (t, sev) => T.revisar(t, M).filter((v) => !sev || sev.includes(v.severidad)).map((v) => v.codigo);
const problema = (t, codigo) => T.revisar(t, M).find((v) => v.codigo === codigo);

test('Tramo corto: pegar las piezas o aceptarlo; la decisión viaja en el JSON y se quita sola si deja de ser corto', () => {
  const t0 = tramoCorto();
  assert.ok(codigos(t0).includes('TRAMO_CORTO'));
  const p = T.decidirCorto(t0, M, 'TR-002', 'PEGAR');
  assert.equal(p.tramos.find((x) => x.id === 'TR-002').corto, 'PEGAR');
  assert.ok(!codigos(p).includes('TRAMO_CORTO'));
  const info = problema(p, 'PIEZAS_PEGADAS');
  assert.equal(info.severidad, 'INFO');
  assert.match(info.mensaje, /CO-001 y CO-002 se arman pegadas \(unión engargolada, sin bridas en esas caras\) con 43 mm de recto en TR-002/);
  const s = T.aSistema(p, M, { borrador: true });
  assert.deepEqual(s.tramos.find((x) => x.id === 'TR-002').uniones, { aguas_arriba: 'ENGARGOLADA', aguas_abajo: 'ENGARGOLADA' }, 'en galvanizado la unión es engargolada');
  assert.deepEqual(validarEsquema(s, ESQUEMA), []);
  // de regreso desde el JSON (las uniones dicen que se pegó)
  const r = T.desdeSistema(s, M);
  assert.deepEqual(r.errores, []);
  assert.equal(r.modelo.tramos.find((x) => x.id === 'TR-002').corto, 'PEGAR');
  // en acero al carbón, soldada
  const ac = T.decidirCorto(T.cambiarMaterial(t0, M, 'ACERO_CARBON', 16, { todos: true }), M, 'TR-002', 'PEGAR');
  assert.equal(T.aSistema(ac, M, { borrador: true }).tramos.find((x) => x.id === 'TR-002').uniones.aguas_abajo, 'SOLDADA');
  // aceptar: nota en el JSON, y también regresa
  const a = T.decidirCorto(t0, M, 'TR-002', 'ACEPTAR');
  assert.ok(codigos(a).includes('TRAMO_CORTO_ACEPTADO') && !codigos(a).includes('TRAMO_CORTO'));
  const sa = T.aSistema(a, M, { borrador: true });
  assert.equal(T.desdeSistema(sa, M).modelo.tramos.find((x) => x.id === 'TR-002').corto, 'ACEPTAR');
  assert.equal(T.validar(JSON.parse(JSON.stringify(a)), M).modelo.tramos.find((x) => x.id === 'TR-002').corto, 'ACEPTAR', 'y se guarda con el trazo');
  // quitar la decisión; deja de ser corto al alargarlo
  assert.ok(codigos(T.decidirCorto(p, M, 'TR-002', null)).includes('TRAMO_CORTO'));
  const largo = T.cambiarLargo(p, M, 'TR-002', 1000);
  assert.equal(largo.tramos.find((x) => x.id === 'TR-002').corto, undefined, 'al alargarlo ya no es corto: la decisión se va');
  // lo que no se puede
  falla(() => T.decidirCorto(t0, M, 'TR-001', 'PEGAR'), 'DATO_INVALIDO', /no es un tramo corto/);
  falla(() => T.decidirCorto(t0, M, 'TR-002', 'SOLDAR'), 'DATO_INVALIDO');
  // un tramo corto con pieza en un solo extremo se acepta pero no se pega
  let u = T.trazar(T.nuevo(M), M, { posicion_mm: { x: 0, y: 0, z: 2500 } }, { direccion: dir(0), largo_mm: 2000 });
  u = T.trazar(u, M, u.ultimo.nodo, { direccion: dir(90), largo_mm: 300 });
  const cu = problema(u, 'TRAMO_CORTO');
  assert.ok(cu, 'el último tramo, con el codo en un solo extremo, es corto');
  falla(() => T.decidirCorto(u, M, cu.elementos[0], 'PEGAR'), 'DATO_INVALIDO', /una pieza en cada extremo/);
  assert.ok(T.decidirCorto(u, M, cu.elementos[0], 'ACEPTAR'));
});

test('Cambiar el Ø en cadena: hacia el colector no baja, un ramal no pasa de su tronco, y el candado lo detiene', () => {
  const t0 = terminado(ejemploDesdeLasTomas());
  const sube = entre(t0, puerto(t0, 'EQ-02').nodo, nodoEn(t0, 10750, 0, 3000));
  const sierra = entre(t0, nodoEn(t0, 10750, 0, 3000), nodoEn(t0, 4250, 0, 3000));
  falla(() => T.cambiarDiametro(t0, M, sube, 8), 'DIAMETRO_DECRECE', /el tramo anterior/);
  const c = T.cambiarDiametro(t0, M, sube, 8, { cadena: true });
  assert.deepEqual(c.ultimo.tramos, [sube, sierra], 'la subida y la horizontal hasta el injerto (el tronco ya es de 8″)');
  // bajar el tronco del colector a 5″: bajan también el tronco de la sierra (y su subida) y el ramal sigue de 5″
  const colector = entre(t0, nodoEn(t0, 4250, 0, 3000), puerto(t0, 'EQ-01').nodo);
  const b = T.cambiarDiametro(t0, M, colector, 5, { cadena: true });
  assert.deepEqual([...b.ultimo.tramos].sort(), [colector, sierra, sube].sort());
  // subir el ramal a 8″: el tronco que entra (6″) sube con él
  const ramal = entre(t0, nodoEn(t0, 7000, -2750, 3000), nodoEn(t0, 4250, 0, 3000));
  const ramal2 = T.cambiarDiametro(t0, M, ramal, 8, { cadena: true });
  assert.ok(ramal2.ultimo.tramos.includes(sierra), 'el tronco que entra sube con el ramal');
  // el candado detiene la cadena con su porqué
  const conCandado = T.cambiarDiametro(t0, M, sierra, 6, { bloquear: true });
  falla(() => T.cambiarDiametro(conCandado, M, sube, 8, { cadena: true }), 'DIAMETRO_BLOQUEADO', /tiene candado en 6″: quítelo/);
});

test('Corregir: cada arreglo se prueba en el modelo, quita su problema y no deja errores nuevos', () => {
  const aplica = (t, codigo, re) => {
    const p = problema(t, codigo);
    assert.ok(p, `hay ${codigo}`);
    const cs = T.correcciones(t, M, p);
    assert.ok(cs.length, `${codigo} tiene arreglo`);
    if (re) assert.match(cs[0].texto, re);
    cs.forEach((c) => {
      const m = T.corregir(t, M, c);
      assert.equal(m.ultimo.operacion, 'corregir');
      assert.ok(!T.revisar(m, M).some((v) => v.codigo === p.codigo && JSON.stringify([...v.elementos].sort()) === JSON.stringify([...p.elementos].sort())), `${c.texto} quita el problema`);
      assert.ok(T.revisar(m, M).filter((v) => v.severidad === 'ERROR').length <= T.revisar(t, M).filter((v) => v.severidad === 'ERROR').length + (p.codigo === 'TOMA_SIN_CONEXION' || p.codigo === 'EQUIPO_SIN_PUERTOS' ? 2 : 0), `${c.texto} no deja más errores`);
      assert.deepEqual(T.validar(JSON.parse(JSON.stringify(m)), M).errores, []);
    });
    return cs;
  };
  // velocidad alta en el tronco del ejemplo a 6″: «Cambiar a 8″» o dimensionar
  const ej = terminado(ejemploDesdeLasTomas());
  const colector = entre(ej, nodoEn(ej, 4250, 0, 3000), puerto(ej, 'EQ-01').nodo);
  const cs = aplica(T.cambiarDiametro(ej, M, colector, 6), 'VELOCIDAD_ALTA', new RegExp(`^Cambiar ${colector} a 8″ \\(18\\.8 m/s\\)\\.$`));
  assert.equal(JSON.stringify(calculado(T.aSistema(T.renumerar(T.corregir(T.cambiarDiametro(ej, M, colector, 6), M, cs[0]), M), M))), JSON.stringify(EJ), 'corregido y renumerado, es el ejemplo');
  assert.ok(cs.some((c) => c.op === 'aplicarDimensiones'));
  // tramo corto: pegar, alargar o aceptar; accesorios que no caben: alargar
  const corto = aplica(tramoCorto(), 'TRAMO_CORTO', /^Pegar CO-001 y CO-002 \(unión engargolada/);
  assert.deepEqual(corto.map((c) => c.op), ['decidirCorto', 'cambiarLargo', 'decidirCorto']);
  aplica(tramoCorto(300), 'ACCESORIOS_NO_CABEN', /^Alargar TR-002 a 0\.7 m\.$/);
  // choque: mover un segmento lo justo
  let c = T.trazar(T.nuevo(M), M, { posicion_mm: { x: -3000, y: 0, z: 3000 } }, { direccion: dir(0), largo_mm: 6000 });
  c = T.trazar(c, M, { posicion_mm: { x: 0, y: -3000, z: 2000 } }, { direccion: dir(0, 90), largo_mm: 1000 });
  c = T.trazar(c, M, c.ultimo.nodo, { direccion: dir(90), largo_mm: 6000 });
  c = T.trazar(c, M, c.ultimo.nodo, { direccion: dir(0, -90), largo_mm: 1000 });
  aplica(c, 'CHOQUE_DUCTOS', /^Mover TR-003 300 mm hacia abajo\.$/);
  // equipos encimados y sin puertos
  let e = T.ponerEquipo(T.nuevo(M), M, { tipo: 'MAQUINA', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1200, ancho: 800, alto: 1200 } });
  e = T.ponerEquipo(e, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: { x: 800, y: 0, z: 0 }, caja_mm: { largo: 1200, ancho: 800, alto: 1200 } });
  aplica(e, 'EQUIPOS_ENCIMADOS', /^Mover Lijadora 500 mm hacia \+X\.$/);
  aplica(e, 'EQUIPO_SIN_PUERTOS', /^Agregar una toma de 6″ arriba de Máquina\.$/);
  // altura libre: subir el segmento
  let a = T.trazar(T.nuevo(M), M, { posicion_mm: { x: 0, y: 0, z: 3000 } }, { direccion: dir(0, -90), largo_mm: 1500 });
  a = T.trazar(a, M, a.ultimo.nodo, { direccion: dir(0), largo_mm: 3000 });
  a = T.trazar(a, M, a.ultimo.nodo, { direccion: dir(0, 90), largo_mm: 1500 });
  aplica(a, 'ALTURA_LIBRE', /^Subir TR-002 700 mm \(queda a 2124 mm del piso\)\.$/);
  // subred sin colector y toma sin ducto: conectar con el imán
  aplica(T.borrarTramo(ej, M, entre(ej, nodoEn(ej, 7000, -2750, 3000), nodoEn(ej, 4250, 0, 3000))), 'SUBRED_SIN_COLECTOR', /^Conectar N-\d+ al tramo TR-\d+: injerto a (45|30)°/);
  // toma sin acople: brida o manguera; extremo abierto que llega a una toma libre
  let x = T.ponerEquipo(T.nuevo(M), M, { tipo: 'COLECTOR', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: { largo: 1500, ancho: 1500, alto: 4000 } });
  x = T.agregarPuerto(x, M, 'EQ-01', { posicion_local_mm: { x: 750, y: 0, z: 3000 }, diametro_in: 6 });
  x = T.trazar(x, M, 'N-001', { direccion: dir(0), largo_mm: 5000 });
  x = T.ponerEquipo(x, M, { tipo: 'MAQUINA', posicion_mm: { x: 9000, y: 0, z: 0 }, caja_mm: { largo: 1200, ancho: 800, alto: 1200 } });
  x = T.agregarPuerto(x, M, 'EQ-02', { posicion_local_mm: { x: 0, y: 0, z: 1200 }, diametro_in: 6, caudal_m3_h: 1300 });
  assert.deepEqual(aplica(x, 'TOMA_SIN_CONEXION').map((q) => q.op), ['acoplarBrida', 'acoplarManguera']);
  const xb = T.acoplarBrida(x, M, 'PU-02');
  const fin = aplica(xb, 'EXTREMO_ABIERTO', /^Conectar N-002 con la toma PU-02 \(Máquina\): llegada: \+X 3\.25 m y −Z 1\.8 m, 1 codo\.$/);
  assert.deepEqual(T.revisar(T.corregir(xb, M, fin[0]), M).filter((v) => v.severidad !== 'INFO'), [], 'conectado, sin problemas');
  // lo que no tiene arreglo automático, o no es un problema del trazo
  assert.deepEqual(T.correcciones(ej, M, { codigo: 'REDUCCION_BRUSCA', severidad: 'AVISO', elementos: ['RE-001'] }), []);
  assert.deepEqual(T.correcciones(ej, M, { codigo: 'TRAMO_CORTO', severidad: 'AVISO', elementos: ['TR-001'] }), [], 'un problema que no está en la revisión no tiene arreglo');
  falla(() => T.corregir(ej, M, { op: 'borrarTodo', args: [] }), 'DATO_INVALIDO');
});

test('Compuerta: se pone en un tramo recto (lo parte), ocupa su largo, no se funde, va y vuelve por el JSON y se quita', () => {
  const ej = terminado(ejemploDesdeLasTomas());
  const t = T.ponerCompuerta(ej, M, { tramo: 'TR-002', s_mm: 3000 });
  const nodo = t.ultimo.nodo;
  assert.equal(t.ultimo.operacion, 'ponerCompuerta');
  assert.equal(t.nodos.find((n) => n.id === nodo).compuerta, true);
  assert.deepEqual(t.ultimo.info, [], 'la compuerta la pone quien traza: no es una pieza insertada sola');
  const g = T.calcular(t, M);
  const cp = g.piezas.find((p) => p.tipo === 'COMPUERTA');
  assert.equal(cp.nodo, nodo);
  assert.equal(cp.id, 'CP-001');
  assert.equal(cp.geometria.largo_mm, T.LARGO_COMPUERTA_MM);
  assert.deepEqual(cp.conexiones.map((c) => c.rol), ['ENTRADA', 'SALIDA']);
  assert.deepEqual(cp.ocupa.map((o) => o.mm), [T.LARGO_COMPUERTA_MM / 2, T.LARGO_COMPUERTA_MM / 2], 'la mitad de cada lado');
  const lados = cp.conexiones.map((c) => c.tramo);
  cerca(lados.reduce((x, id) => x + g.neta.get(id), 0), g0neta(ej, 'TR-002') - T.LARGO_COMPUERTA_MM, 1e-6, 'lo neto baja lo que mide la compuerta');
  assert.equal(T.revisar(t, M).filter((v) => ['ERROR', 'BLOQUEANTE'].includes(v.severidad)).length, 0);
  // en el JSON: un nodo UNION con su accesorio COMPUERTA, y de regreso igual
  const s = T.aSistema(t, M);
  assert.deepEqual(validarEsquema(s, ESQUEMA), []);
  assert.deepEqual(s.nodos.find((n) => n.id === nodo).accesorios, ['CP-001']);
  assert.equal(s.nodos.find((n) => n.id === nodo).tipo, 'UNION');
  const r = T.desdeSistema(s, M);
  assert.deepEqual(r.errores, []);
  assert.deepStrictEqual(T.aSistema(r.modelo, M), s);
  // sigue ahí aunque se mueva otra cosa (no se funde como una unión sin pieza)
  const t2 = T.anclar(t, M, nodoEn(t, 10750, 0, 3000), true);
  assert.ok(T.calcular(t2, M).piezas.some((p) => p.tipo === 'COMPUERTA' && p.nodo === nodo));
  // quitarla funde los tramos otra vez: renumerado, el ejemplo
  const q = T.quitarCompuerta(t, M, nodo);
  assert.equal(q.tramos.length, ej.tramos.length);
  assert.deepStrictEqual(calculado(T.aSistema(T.renumerar(q, M), M)), EJ);
  // lo que no se puede
  falla(() => T.ponerCompuerta(ej, M, nodoEn(ej, 10750, 0, 3000)), 'COMPUERTA_NO_VA', /ahí el ducto da vuelta/);
  falla(() => T.ponerCompuerta(ej, M, { tramo: entre(ej, puerto(ej, 'EQ-03').nodo, puerto(ej, 'EQ-03').acople.nodo_transicion), s_mm: 300 }), 'DATO_INVALIDO', /manguera/);
  falla(() => T.ponerCompuerta(ej, M, { tramo: 'TR-002', s_mm: 20 }), 'DATO_INVALIDO', /a menos de/);
  falla(() => T.ponerCompuerta(ej, M, puerto(ej, 'EQ-02').nodo), 'COMPUERTA_NO_VA', /brida del equipo/);
  falla(() => T.ponerCompuerta(t, M, nodo), 'DATO_INVALIDO', /ya hay una compuerta/);
  falla(() => T.quitarCompuerta(ej, M, 'N-003'), 'DATO_INVALIDO', /no hay compuerta/);
  // un cambio que dejaría la compuerta entre dos diámetros se rechaza con el porqué
  const abajo = cp.conexiones[1].tramo;
  falla(() => T.cambiarDiametro(t, M, abajo, 8), 'COMPUERTA_NO_VA', /cambia de 6″ a 8″/);
});

test('Una caminata de operaciones al azar nunca deja el trazo inválido ni lanza otra cosa que TrazadoError (ni el cálculo, otra cosa que CalculoError)', () => {
  let semilla = 20261009;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  const uno = (xs) => xs[Math.floor(azar() * xs.length)];
  let t = terminado(ejemploDesdeLasTomas());
  let hechas = 0;
  let calculados = 0;
  const ops = [
    () => T.ponerEquipo(t, M, { tipo: 'MAQUINA', posicion_mm: { x: Math.round(azar() * 20) * 500, y: Math.round(azar() * 16 - 8) * 500, z: 0 }, caja_mm: { largo: 600, ancho: 600, alto: 800 } }),
    () => { const e = uno(t.equipos.filter((x) => x.tipo === 'MAQUINA')); if (!e) return t; return T.agregarPuerto(t, M, e.id, { posicion_local_mm: { x: 0, y: 0, z: e.caja_mm.alto }, diametro_in: uno([4, 5, 6]), caudal_m3_h: uno([null, 500, 900]) }); },
    () => { const p = uno(t.equipos.flatMap((e) => e.puertos).filter((x) => x.rol === 'TOMA')); if (!p) return t; return azar() < 0.5 ? T.acoplarBrida(t, M, p.id) : T.acoplarManguera(t, M, p.id, { altura_mm: uno([600, 900, 1200]), desvio_mm: uno([0, 150, 300]), desvio_azimut_deg: uno([0, 90, 180]) }); },
    () => { if (!t.nodos.length) return t; const n = uno(t.nodos).id; const c = T.candidatas(t, M, n); if (!c.length) return t; return T.trazar(t, M, n, { direccion: uno(c).direccion, largo_mm: uno([300, 800, 1500, 2600]) }); },
    () => { const ext = t.nodos.filter((n) => t.tramos.filter((x) => x.a === n.id || x.b === n.id).length === 1 && !n.puerto); if (!ext.length) return t; const e = uno(ext).id; const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); if (!tr) return t; const r = T.rutas(t, M, e, azar() < 0.7 ? { tramo: tr.id } : { nodo: uno(t.nodos).id }); return r.length ? T.conectar(t, M, e, r[0]) : t; },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return tr ? T.cambiarLargo(t, M, tr.id, uno([200, 1000, 2500, 4000])) : t; },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); if (!tr) return t; return T.moverSegmento(t, M, tr.id, uno([{ x: 0, y: 0, z: 300 }, { x: 0, y: 300, z: 0 }, { x: 300, y: 0, z: 0 }])); },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return tr ? T.cambiarDiametro(t, M, tr.id, uno([4, 5, 6, 8, 10])) : t; },
    () => (t.tramos.length ? T.borrarTramo(t, M, uno(t.tramos).id, { ramal: azar() < 0.3 }) : t),
    () => { const e = uno(t.equipos); if (!e) return t; return T.moverEquipo(t, M, e.id, { posicion_mm: { ...e.posicion_mm, x: Math.round(azar() * 20) * 500 } }); },
    () => T.aplicarDimensiones(t, M),
    () => { const n = uno(t.nodos); if (!n) return t; const c = T.calcular(t, M).piezasDe.get(n.id); return c && c[0].tipo === 'CODO' ? T.cambiarAngulo(t, M, n.id, uno([30, 45, 60, 90])) : t; },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return tr ? T.reducir(t, M, azar() < 0.5 ? tr.a : { tramo: tr.id, s_mm: uno([50, 300, 1000]) }, uno([3, 4, 5])) : t; },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return tr ? T.decidirCorto(t, M, tr.id, uno(['PEGAR', 'ACEPTAR', null])) : t; },
    () => { const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO')); return tr ? T.ponerCompuerta(t, M, { tramo: tr.id, s_mm: uno([150, 500, 1200]) }) : t; },
    () => { const n = uno(t.nodos.filter((x) => x.compuerta)); return n ? T.quitarCompuerta(t, M, n.id) : t; },
    () => { const p = uno(T.revisar(t, M).filter((v) => T.CORREGIBLES.includes(v.codigo))); if (!p) return t; const c = uno(T.correcciones(t, M, p, { max: 2 })); return c ? T.corregir(t, M, c) : t; },
  ];
  for (let i = 0; i < 160; i += 1) {
    try {
      t = uno(ops)();
      hechas += 1;
    } catch (e) {
      if (!(e instanceof T.TrazadoError)) throw e;
    }
    const v = T.validar(JSON.parse(JSON.stringify(t)), M);
    assert.deepEqual(v.errores, [], `paso ${i}`);
    const s = T.aSistema(t, M, { borrador: true });
    assert.deepEqual(validarEsquema(s, ESQUEMA), [], `paso ${i}`);
    // y el cálculo de pérdidas lo calcula, o dice qué le falta (una toma sin caudal, una red abierta…)
    try {
      const r = P.calcular(s);
      assert.deepEqual(validarEsquema(r.sistema, ESQUEMA), [], `paso ${i}, calculado`);
      calculados += 1;
    } catch (e) {
      if (!(e instanceof P.CalculoError)) throw e;
    }
  }
  assert.ok(hechas > 40, `se hicieron ${hechas} operaciones`);
  assert.ok(calculados > 0, 'alguno se pudo calcular');
});
