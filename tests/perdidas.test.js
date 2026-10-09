/**
 * El cálculo de la red trazada (src/motor/perdidas.js; etapa 4 de docs/trazado-isometrico.md §5): la tabla de coeficientes
 * y su interpolación (y la expansión brusca contra Borda-Carnot), el aire, la hoja del ejemplo, los tres umbrales del
 * balanceo, el pantalón, el adaptador y la reducción, la T a 90° con su aceleración, el ventilador y su motor, los datos
 * que faltan, la pureza, y los sistemas que salen del modelo al trazar.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const P = require('../src/motor/perdidas');
const TZ = require('../src/motor/trazado_iso');
const TB = require('../src/web/trazado_tablero');
const EJ = require('../docs/ejemplos/trazado-isometrico-ejemplo.json');
const ESQUEMA = require('../docs/trazado-isometrico.schema.json');
const { validarEsquema } = require('./esquema_json');

const M = crearMaestros();
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const clonar = (x) => JSON.parse(JSON.stringify(x));
const congelar = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') congelar(v); }); return Object.freeze(o); };
const falla = (fn, codigo, re) => assert.throws(fn, (e) => {
  assert.ok(e instanceof P.CalculoError, `no es CalculoError: ${e && e.stack}`);
  assert.equal(e.codigo, codigo, e.message);
  if (re) assert.match(e.message, re);
  return true;
});
const crudo = () => ({ ...clonar(EJ), resultados: null });
/** El ejemplo con un cambio en sus datos (el JSON es dato: se puede editar y volver a calcular). */
const conCambio = (fn) => { const s = crudo(); fn(s); return P.calcular(s); };
const puerto = (s, id) => s.equipos.flatMap((e) => e.puertos).find((p) => p.id === id);
const fila = (r, id) => r.sistema.resultados.por_tramo.find((x) => x.tramo === id);

test('Tabla de coeficientes: codos por gajos y R/D, entrada de ramal por ángulo, expansión y contracción', () => {
  cerca(P.kCodo(90, 1.5, 5), 0.24, 1e-12, '5 gajos, R/D 1.5');
  cerca(P.kCodo(90, 1.5, 4), 0.27, 1e-12, '4 gajos');
  cerca(P.kCodo(90, 1.5, 3), 0.34, 1e-12, '3 gajos');
  cerca(P.kCodo(90, 1.25, 5), (0.33 + 0.24) / 2, 1e-12, 'R/D interpolado');
  cerca(P.kCodo(90, 3, 5), 0.17, 1e-12, 'R/D fuera de la tabla: el extremo');
  cerca(P.kCodo(90, 0.5, 5), 0.46, 1e-12, 'el 5 gajos no tiene R/D 0.5: el primero que hay');
  cerca(P.kCodo(90, 0.5, null), 0.71, 1e-12, 'estampado o liso');
  cerca(P.kCodo(90, 1.5, 2), 1.2, 1e-12, 'dos gajos: inglete');
  // otro ángulo: los gajos equivalentes a 90° (los mismos grados por junta) y K·θ/90
  cerca(P.kCodo(45, 1.5, 3), 0.24 / 2, 1e-12, '45° de 3 gajos = 90° de 5, por la mitad');
  cerca(P.kCodo(60, 1.5, 4), (0.24 * 60) / 90, 1e-12, '60° de 4 gajos (20° por junta)');
  cerca(P.kCodo(30, 1.5, 3), (0.24 * 30) / 90, 1e-12, '30° de 3 gajos (15° por junta)');
  cerca(P.kCodo(90, 1.5, 4.5), (0.27 + 0.24) / 2, 1e-12, 'entre columnas');
  assert.equal(P.kCodo(0, 1.5, 5), 0);
  cerca(P.kRamal(30), 0.18, 1e-12);
  cerca(P.kRamal(45), 0.28, 1e-12);
  cerca(P.kRamal(90), 1, 1e-12);
  cerca(P.kRamal(37.5), (0.21 + 0.25) / 2, 1e-12);
  cerca(P.recuperacion(15, 1.5), 0.7, 1e-12);
  cerca(P.recuperacion(12.5, 1.5), (0.76 + 0.7) / 2, 1e-12);
  cerca(P.recuperacion(15, 1.1), 0.83, 1e-12, 'D₂/D₁ menor que 1.25: el primero');
  cerca(P.factorContraccion(15), 0.08, 1e-12);
  // La fila brusca de la tabla es Borda-Carnot: (1 − R)(1 − a²) ≈ (1 − a)², con a = A₁/A₂.
  [1.25, 1.5, 1.75, 2].forEach((r) => {
    const a = 1 / (r * r);
    cerca((1 - P.recuperacion(90, r)) * (1 - a * a), (1 - a) ** 2, 0.03, `brusca ${r}`);
  });
  // la transición: sin cambio no pierde; la expansión recupera parte de la presión dinámica; la contracción la gasta
  assert.deepEqual(P.transicion(152.4, 152.4, 15, 100, 100), { modelo: null, perdida: 0, dSP: 0, K: 0 });
  const ex = P.transicion(152.4, 203.2, 15, 180, 180 * (152.4 / 203.2) ** 4);
  assert.equal(ex.modelo, 'EXPANSION');
  cerca(ex.perdida, (1 - ex.R) * (180 - 180 * (152.4 / 203.2) ** 4), 1e-9);
  assert.ok(ex.dSP < 0 && ex.perdida > 0, 'la succión baja (se recupera) y algo se pierde');
  cerca(ex.K * 180, ex.perdida, 1e-9, 'K sobre la pv de la sección menor (la de entrada)');
  const co = P.transicion(152.4, 127, 15, 100, 100 * (152.4 / 127) ** 4);
  assert.equal(co.modelo, 'CONTRACCION');
  cerca(co.K * 100 * (152.4 / 127) ** 4, co.perdida, 1e-9, 'K sobre la pv de la sección menor (la de salida)');
  assert.ok(co.dSP > co.perdida, 'la succión sube con la aceleración y la pérdida');
});

test('El aire del proyecto, o el de su altitud y temperatura', () => {
  const a = P.aireDe(EJ.proyecto.aire);
  assert.equal(a.densidad_kg_m3, 0.9169);
  const b = P.aireDe({ temperatura_C: 20, altitud_m: 2240, presion_Pa: null, densidad_kg_m3: null, viscosidad_Pa_s: null });
  cerca(b.densidad_kg_m3, 0.9169, 1e-4);
  cerca(b.viscosidad_Pa_s, 1.813e-5, 1e-8);
  const mar = P.aireDe({ temperatura_C: 20, altitud_m: 0 });
  cerca(mar.densidad_kg_m3, 1.204, 1e-3, 'aire estándar a nivel del mar');
  assert.throws(() => P.aireDe({ altitud_m: 0 }), P.CalculoError);
  cerca(P.friccion(1000, 0.09, 152.4), 0.064, 1e-12, 'laminar: 64/Re');
});

test('El ejemplo: la hoja tramo por tramo, la toma crítica, el balanceo en N-002 y el ventilador del colector', () => {
  const r = P.calcular(crudo());
  assert.deepEqual(r.sistema, EJ, 'el cálculo llena exactamente el ejemplo resuelto');
  assert.deepEqual(validarEsquema(r.sistema, ESQUEMA), []);
  const h = r.hoja;
  assert.equal(h.critica, 'PU-03', 'el cepillo: manguera, dos codos y la entrada del ramal');
  // la succión se encadena: campana, fricción y locales, tramo por tramo
  const f = (id) => h.filas.get(id);
  cerca(f('TR-001').sp_inicio, 1.5 * f('TR-001').pv, 1e-9, 'la sierra: (1 + 0.5)·pv');
  cerca(f('TR-002').sp_inicio, f('TR-001').sp_final, 1e-9);
  cerca(f('TR-003').sp_inicio, f('TR-006').sp_final, 1e-9, 'después de la confluencia manda la mayor');
  assert.deepEqual(f('TR-001').locales.map((l) => [l.que, l.id]), [['CODO', 'CO-001']]);
  assert.deepEqual(f('TR-004').locales.map((l) => l.que), ['CURVAS'], 'las dos curvas de la manguera');
  assert.deepEqual(f('TR-006').locales.map((l) => [l.que, l.id, l.K]), [['RAMAL', 'RI-001', 0.28]]);
  const R = r.sistema.resultados;
  assert.equal(R.balance[0].sugerencia, 'TR-002 pasa de 1300 a 1383 m³/h (+6.4 %) para igualar la succión de TR-006: se acepta así.');
  assert.deepEqual(R.ventiladores.map((v) => [v.caudal_m3_h, v.presion_estatica_Pa, v.presion_estatica_estandar_Pa, v.motor_hp]), [[2283.4, 1863.78, 2439.23, 3]]);
  assert.equal(P.faltante(EJ), null);
  // calcular otra vez lo ya calculado da lo mismo
  assert.deepEqual(P.calcular(r.sistema).sistema, EJ);
});

test('Balanceo por diseño: hasta 5 % no se toca; hasta 20 % se acepta el caudal mayor; más, redimensionar o compuerta', () => {
  // Con K = 0.75 en la sierra su succión casi alcanza la del ramal: 1.04, nada que hacer.
  const nada = conCambio((s) => { puerto(s, 'PU-02').coef_entrada_K = 0.75; });
  const b0 = nada.sistema.resultados.balance[0];
  assert.equal(b0.accion, 'NINGUNA');
  assert.ok(b0.relacion <= 1.05);
  assert.equal(b0.sugerencia, null);
  assert.equal(b0.caudal_corregido_m3_h, b0.caudal_m3_h);
  assert.equal(fila(nada, 'TR-003').caudal_m3_h, 2200, 'el tronco lleva la suma de diseño');
  // Con K = 1.2 la sierra pasa a mandar: se corrige el ramal del cepillo.
  const ramal = conCambio((s) => { puerto(s, 'PU-02').coef_entrada_K = 1.2; });
  const b1 = ramal.sistema.resultados.balance[0];
  assert.deepEqual([b1.accion, b1.corriente_menor], ['AJUSTAR_CAUDAL', 'TR-006']);
  cerca(b1.caudal_corregido_m3_h, 900 * Math.sqrt(b1.relacion), 0.1);
  assert.equal(ramal.sistema.resultados.por_toma.find((x) => x.puerto === 'PU-03').caudal_corregido_m3_h, b1.caudal_corregido_m3_h);
  // Sin pérdida de entrada en la sierra la diferencia pasa del 20 %: bajar la sierra a 5″ la iguala, pero a 28.5 m/s.
  const lejos = conCambio((s) => { puerto(s, 'PU-02').coef_entrada_K = 0; });
  const b2 = lejos.sistema.resultados.balance[0];
  assert.ok(b2.relacion > 1.2);
  assert.equal(b2.accion, 'COMPUERTA');
  assert.match(b2.sugerencia, /^TR-002 pasa de 1300 a 1\d{3} m³\/h .*Ningún Ø comercial menor lo equilibra dentro de 23 m\/s \(con TR-002 a 5″, TR-001 a 5″: relación 1\.\d\d a 28\.5 m\/s\)\. Compuerta en TR-002, poco recomendable con polvo abrasivo/);
  // En ventilación no se advierte del polvo.
  const venti = conCambio((s) => { puerto(s, 'PU-02').coef_entrada_K = 0; s.proyecto.servicio = 'VENTILACION'; });
  assert.doesNotMatch(venti.sistema.resultados.balance[0].sugerencia, /polvo/);
  // La sierra a 8″ (con su adaptador en la toma) va lenta y casi sin succión: bajarla a 6″ la equilibra (el ejemplo).
  const ej = TB.ejemplo(M);
  const sierra8 = TZ.aSistema(TZ.cambiarDiametro(TZ.cambiarDiametro(ej, M, 'TR-002', 8), M, 'TR-001', 8), M);
  const b3 = P.calcular(sierra8).sistema.resultados.balance[0];
  assert.equal(b3.accion, 'REDIMENSIONAR');
  assert.match(b3.sugerencia, /Bajar TR-002 a 6″, TR-001 a 6″ deja la relación en 1\.1\d \(19\.8 m\/s\)\.$/);
});

test('Pantalón: las dos corrientes entran como ramales; el balance las compara igual', () => {
  const r = conCambio((s) => {
    const a = s.accesorios.find((x) => x.id === 'RI-001');
    a.tipo = 'PANTALON';
    a.perdida.modelo = 'CONFLUENCIA_PANTALON';
    a.geometria.angulo_deg = 30;
    a.conexiones.find((c) => c.tramo === 'TR-002').rol = 'RAMAL';
    a.conexiones.find((c) => c.tramo === 'TR-006').rol = 'RAMAL_2';
  });
  const h = r.hoja;
  assert.deepEqual(h.filas.get('TR-002').locales.map((l) => [l.que, l.K]), [['RAMAL', 0.18]]);
  assert.deepEqual(h.filas.get('TR-006').locales.map((l) => [l.que, l.K]), [['RAMAL', 0.18]]);
  const a = r.sistema.accesorios.find((x) => x.id === 'RI-001');
  assert.deepEqual([a.perdida.K_paso, a.perdida.K_ramal], [null, 0.18]);
  const b = r.sistema.resultados.balance[0];
  assert.deepEqual([b.tramo_tronco, b.tramo_ramal], ['TR-002', 'TR-006'], 'el RAMAL frente al RAMAL_2');
});

test('Adaptadores, reducciones y la T a 90°: la expansión recupera, la contracción gasta y la mezcla rápida acelera', () => {
  const ej = TB.ejemplo(M);
  // la sierra a 8″: adaptador de expansión en la toma (6″ → 8″), con su K sobre la pv de la toma
  const s8 = P.calcular(TZ.aSistema(TZ.cambiarDiametro(TZ.cambiarDiametro(ej, M, 'TR-002', 8), M, 'TR-001', 8), M));
  const ad = s8.sistema.accesorios.find((x) => x.tipo === 'ADAPTADOR');
  const a = (6 / 8) ** 2;
  assert.equal(ad.perdida.modelo, 'EXPANSION');
  cerca(ad.perdida.K_paso, (1 - P.recuperacion(15, 8 / 6)) * (1 - a * a), 1e-4);
  assert.match(ad.perdida.referencia, /expansión de 6″ a 8″ con semiángulo de 15°/);
  const t1 = s8.hoja.filas.get('TR-001');
  cerca(t1.sp_inicio, t1.toma.sp - P.recuperacion(15, 8 / 6) * (t1.toma.pv - t1.pv), 1e-9, 'la succión baja con la recuperación');
  // con el injerto simple de 8″ la mezcla va más rápido que lo que llega: acelerarla es una pérdida del tronco que sigue
  const t3 = s8.hoja.filas.get('TR-003');
  const acel = t3.locales.find((l) => l.que === 'ACELERACION');
  assert.ok(acel && acel.Pa > 0);
  // una reducción en el tramo de la sierra: contracción en la toma (6″ → 5″) y expansión de 5″ a 6″ en el tronco
  const red = P.calcular(TZ.aSistema(TZ.reducir(ej, M, { tramo: 'TR-002', s_mm: 2000 }, 5), M));
  const mod = (tipo) => red.sistema.accesorios.filter((x) => x.tipo === tipo).map((x) => x.perdida.modelo);
  assert.deepEqual(mod('ADAPTADOR'), ['CONTRACCION']);
  assert.deepEqual(mod('REDUCCION'), ['EXPANSION']);
  // en ventilación, un tercer equipo con T a 90°: K del ramal 1.0
  let tv = TZ.cambiarProyecto(ej, M, { servicio: 'VENTILACION' });
  tv = TZ.ponerEquipo(tv, M, { tipo: 'MAQUINA', nombre: 'Lijadora', posicion_mm: { x: 6000, y: 4000, z: 0 }, caja_mm: { largo: 800, ancho: 800, alto: 1000 } });
  const eq = tv.equipos[tv.equipos.length - 1].id;
  tv = TZ.agregarPuerto(tv, M, eq, { posicion_local_mm: { x: 0, y: 0, z: 1000 }, diametro_in: 4, caudal_m3_h: 700, coef_entrada_K: 0.5 });
  const pu = tv.equipos[tv.equipos.length - 1].puertos[0];
  tv = TZ.acoplarBrida(tv, M, pu.id);
  tv = TZ.trazar(tv, M, tv.equipos[tv.equipos.length - 1].puertos[0].nodo, { direccion: { azimut_deg: 0, elevacion_deg: 90 }, largo_mm: 2000 });
  const cola = tv.ultimo.nodo;
  tv = TZ.conectar(tv, M, cola, TZ.rutas(tv, M, cola, { tramo: 'TR-002' })[0]);
  const rt = P.calcular(TZ.aSistema(tv, M));
  const te = rt.sistema.accesorios.find((x) => x.tipo === 'T_90');
  assert.deepEqual([te.perdida.modelo, te.perdida.K_paso, te.perdida.K_ramal], ['CONFLUENCIA_T', 0, 1]);
  assert.equal(rt.sistema.resultados.balance.length, 2, 'dos confluencias, dos balances');
  assert.deepEqual(validarEsquema(rt.sistema, ESQUEMA), []);
  // los caudales corregidos se acumulan hasta el colector
  const R = rt.sistema.resultados;
  cerca(R.ventiladores[0].caudal_m3_h, R.por_toma.reduce((x, p) => x + p.caudal_corregido_m3_h, 0), 0.2);
});

test('Ventilador: la eficiencia y la transmisión cambian la potencia y el motor; las tablas se pueden reemplazar', () => {
  const base = P.calcular(crudo()).sistema.resultados.ventiladores[0];
  const peor = P.calcular(crudo(), { eficiencia_ventilador: 0.5, eficiencia_transmision: 0.9 }).sistema.resultados.ventiladores[0];
  cerca(peor.potencia_freno_kW, base.potencia_aire_kW / 0.5, 0.002);
  assert.equal(peor.motor_hp, 5, `${(peor.potencia_freno_kW / 0.9 / 0.7457).toFixed(2)} HP piden 5 HP`);
  falla(() => P.calcular(crudo(), { eficiencia_ventilador: 0 }), 'SIN_DATOS', /eficiencias/);
  // sin colector con pérdida (un ventilador al final de la red) sólo cuenta la boca
  const sinFiltro = conCambio((s) => { s.equipos[0].perdida_Pa = null; s.equipos[0].tipo = 'VENTILADOR'; }).sistema.resultados.ventiladores[0];
  assert.equal(sinFiltro.presion_estatica_Pa, sinFiltro.presion_estatica_boca_Pa);
  // otra tabla: los codos de 5 gajos a 0.30
  const tabla = clonar(P.TABLA);
  tabla.codo.gajos[5] = tabla.codo.gajos[5].map((k) => (k === null ? null : 0.3));
  const otra = P.calcular(crudo(), { tabla });
  assert.equal(otra.sistema.accesorios.find((x) => x.id === 'CO-001').perdida.K_paso, 0.3);
  cerca(fila(otra, 'TR-001').perdida_local_Pa, 0.3 * fila(otra, 'TR-001').presion_dinamica_Pa, 0.01);
});

test('Lo que falta se dice con el porqué, y el cálculo no toca lo que recibe', () => {
  falla(() => P.calcular(null), 'SIN_DATOS', /No es un sistema/);
  falla(() => P.calcular({ ...crudo(), tramos: [] }), 'SIN_DATOS', /no tiene tramos/);
  falla(() => conCambio((s) => { puerto(s, 'PU-02').caudal_m3_h = null; }), 'SIN_DATOS', /La toma PU-02 \(Sierra de banco\) no tiene caudal/);
  falla(() => conCambio((s) => { s.tramos = s.tramos.filter((t) => t.id !== 'TR-003'); }), 'SIN_DATOS', /termina en N-002, que no es la boca de un colector/);
  falla(() => conCambio((s) => { s.tramos = s.tramos.filter((t) => t.id !== 'TR-001'); }), 'SIN_DATOS', /empieza en N-003, que no es una toma/);
  falla(() => conCambio((s) => { s.tramos.push({ ...clonar(s.tramos[0]), id: 'TR-009', nodo_aguas_abajo: 'N-005' }); }), 'NO_ES_ARBOL', /salen dos tramos/);
  falla(() => conCambio((s) => { s.tramos[1].nodo_aguas_abajo = 'N-099'; }), 'SIN_DATOS', /no existe/);
  falla(() => conCambio((s) => { s.tramos[1].longitud_neta_mm = null; }), 'SIN_DATOS', /largo neto/);
  assert.match(P.faltante({ ...crudo(), tramos: [] }), /no tiene tramos/);
  // puro: lo congelado sale igual y no se muta
  const fijo = congelar(crudo());
  const r = P.calcular(fijo);
  assert.equal(fijo.resultados, null);
  assert.deepEqual(r.sistema, EJ);
});

test('Los sistemas que exporta el modelo al trazar se calculan, o dicen qué les falta', () => {
  let semilla = 4242;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  const uno = (xs) => xs[Math.floor(azar() * xs.length)];
  let t = TB.ejemplo(M);
  let calculados = 0;
  for (let i = 0; i < 60; i += 1) {
    try {
      const tr = uno(t.tramos.filter((x) => x.tipo === 'RIGIDO'));
      const op = uno(['largo', 'diam', 'k', 'q']);
      if (op === 'largo') t = TZ.cambiarLargo(t, M, tr.id, uno([1500, 2500, 4000, 7000]));
      else if (op === 'diam') t = TZ.cambiarDiametro(t, M, tr.id, uno([5, 6, 7, 8]), { cadena: true });
      else {
        const p = uno(t.equipos.flatMap((e) => e.puertos).filter((x) => x.rol === 'TOMA'));
        t = TZ.editarPuerto(t, M, p.id, op === 'k' ? { coef_entrada_K: uno([0, 0.25, 0.5, 1, 2]) } : { caudal_m3_h: uno([400, 900, 1300, 2500]) });
      }
    } catch (e) {
      if (!(e instanceof TZ.TrazadoError)) throw e;
    }
    let s;
    try { s = TZ.aSistema(t, M); } catch (e) { if (e instanceof TZ.TrazadoError) continue; throw e; }
    const r = P.calcular(s);
    calculados += 1;
    assert.deepEqual(validarEsquema(r.sistema, ESQUEMA), [], `paso ${i}`);
    const R = r.sistema.resultados;
    R.por_tramo.forEach((x) => Object.entries(x).forEach(([k, v]) => assert.ok(k === 'tramo' || (Number.isFinite(v) && v >= 0), `${x.tramo} ${k} = ${v}`)));
    R.balance.forEach((b) => { assert.ok(b.relacion >= 1); assert.ok(P.ACCIONES.includes(b.accion)); });
    assert.ok(R.ventiladores[0].presion_estatica_Pa > 1250 && R.ventiladores[0].motor_hp > 0);
  }
  assert.ok(calculados > 20, `se calcularon ${calculados}`);
});
