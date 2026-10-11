/**
 * Los coeficientes y las eficiencias del cálculo de la red en las tablas maestras (grupo calculo; docs/trazado-isometrico.md
 * §5.8): son los mismos de la tabla de referencia, se revisan con su porqué, el cálculo los toma de las tablas y lo dice
 * (en la referencia de cada pieza y en el método), el parche conserva el largo de sus listas, y el tablero se entera
 * cuando las tablas cambian y dice cuánto mueve un cambio al ventilador del trazo.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../src/datos/maestros');
const P = require('../src/motor/perdidas');
const TZ = require('../src/motor/trazado_iso');
const TB = require('../src/web/trazado_tablero');
const EJ = require('../docs/ejemplos/trazado-isometrico-ejemplo.json');

const M = MA.crearMaestros();
const clonar = (x) => JSON.parse(JSON.stringify(x));
const congelar = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') congelar(v); }); return Object.freeze(o); };
const crudo = () => ({ ...clonar(EJ), resultados: null });
/** Las tablas maestras con un cambio en el grupo calculo. */
const conCalculo = (fn) => { const M2 = clonar(M); fn(M2.calculo); return M2; };
const calcularCon = (M2) => P.calcular(crudo(), P.opcionesDe(M2));
const falla = (fn, codigo, re) => assert.throws(fn, (e) => {
  assert.ok(e instanceof P.CalculoError, `no es CalculoError: ${e && e.stack}`);
  assert.equal(e.codigo, codigo, e.message);
  if (re) assert.match(e.message, re);
  return true;
});

test('Las tablas maestras traen la tabla de referencia y las eficiencias de arranque: el ejemplo sale igual', () => {
  assert.deepEqual(M.calculo.coeficientes, P.coeficientes(P.TABLA), 'los valores de las tablas maestras son los de la tabla de referencia');
  assert.equal(M.calculo.eficiencia_ventilador, P.DEFECTOS.eficiencia_ventilador);
  assert.equal(M.calculo.eficiencia_transmision, P.DEFECTOS.eficiencia_transmision);
  assert.deepEqual(P.tablaDe(M.calculo.coeficientes), P.TABLA, 'de los valores a la tabla y de regreso, sin perder nada');
  assert.deepEqual(P.cambiadas(P.tablaDe(M.calculo.coeficientes)), []);
  assert.deepEqual(calcularCon(M).sistema, EJ, 'con las tablas de arranque, el ejemplo exacto');
  assert.deepEqual(P.opcionesDe({}), { ...P.DEFECTOS, tabla: P.TABLA }, 'unas tablas sin el grupo: los de referencia');
  // los ejes: los de la tabla, y los codos de 4 y 5 gajos empiezan en R/D 0.75
  assert.deepEqual(P.EJES.codo_r_d.gajos_5, [0.75, 1, 1.5, 2, 2.5]);
  assert.deepEqual(P.EJES.codo_r_d.liso, P.TABLA.codo.r_d);
  ['liso', 'gajos_5', 'gajos_4', 'gajos_3'].forEach((k) => assert.equal(M.calculo.coeficientes.codo[k].length, P.EJES.codo_r_d[k].length, k));
  assert.equal(M.calculo.coeficientes.expansion.length, P.EJES.expansion_semiangulo_deg.length);
  M.calculo.coeficientes.expansion.forEach((f) => assert.equal(f.length, P.EJES.expansion_relacion_D.length));
});

test('Un codo cambiado: sube la pérdida de esos codos, cambia la succión y cada pieza dice que su K es del taller', () => {
  const M2 = conCalculo((c) => { c.coeficientes.codo.gajos_5 = [0.92, 0.66, 0.48, 0.38, 0.34]; }); // el doble de la referencia
  const op = P.opcionesDe(M2);
  assert.equal(op.tabla.codo.taller, true);
  assert.equal(op.tabla.entrada_ramal.taller, undefined, 'lo demás sigue siendo de referencia');
  assert.deepEqual(op.tabla.codo.gajos[5], [null, 0.92, 0.66, 0.48, 0.38, 0.34], 'R/D 0.5 sigue sin hacerse');
  assert.ok(Math.abs(P.kCodo(90, 1.5, 5, op.tabla) - 0.48) < 1e-12, 'el K del taller');
  const r = P.calcular(crudo(), op);
  const ref = P.calcular(crudo());
  const codos = r.sistema.accesorios.filter((a) => a.tipo === 'CODO');
  assert.ok(codos.length && codos.every((a) => /^Tablas del taller: codo de 5 gajos/.test(a.perdida.referencia)), 'cada codo dice de dónde sale su K');
  codos.forEach((a) => {
    const b = ref.sistema.accesorios.find((x) => x.id === a.id);
    assert.ok(Math.abs(a.perdida.K_paso - 2 * b.perdida.K_paso) < 1e-3, `${a.id}: K doble`);
  });
  assert.ok(r.sistema.accesorios.filter((a) => a.tipo === 'INJERTO' || a.tipo === 'REDUCCION_INJERTO').every((a) => /^ACGIH: entrada de ramal/.test(a.perdida.referencia)), 'los ramales siguen con la referencia');
  assert.match(r.sistema.resultados.metodo, /con la tabla de coeficientes del taller \(cambiada en codos\); succión/);
  assert.ok(r.sistema.resultados.ventiladores[0].presion_estatica_Pa > ref.sistema.resultados.ventiladores[0].presion_estatica_Pa, 'más succión en el ventilador');
  // varias secciones: el método las nombra en orden
  const M3 = conCalculo((c) => { c.coeficientes.contraccion[0] = 0.07; c.coeficientes.entrada_ramal[7] = 0.3; c.coeficientes.codo.inglete_90 = 1.3; });
  assert.match(calcularCon(M3).sistema.resultados.metodo, /del taller \(cambiada en codos, entradas de ramal, contracciones\)/);
});

test('Las eficiencias de las tablas: el ventilador y el motor las usan, y el JSON las dice', () => {
  const M2 = conCalculo((c) => { c.eficiencia_ventilador = 0.55; c.eficiencia_transmision = 1; });
  const v = calcularCon(M2).sistema.resultados.ventiladores[0];
  const v0 = calcularCon(M).sistema.resultados.ventiladores[0];
  assert.equal(v.eficiencia_ventilador, 0.55);
  assert.equal(v.eficiencia_transmision, 1);
  assert.ok(Math.abs(v.potencia_freno_kW - v0.potencia_aire_kW / 0.55) < 1e-3);
  assert.equal(v.presion_estatica_Pa, v0.presion_estatica_Pa, 'la red no cambia: sólo la potencia');
  assert.equal(v.motor_hp, P.MOTORES_HP.find((hp) => hp >= v.potencia_freno_kW / 0.7457 - 1e-9));
});

test('Lo que no sirve se rechaza con su porqué: intervalo, largo y forma', () => {
  const c0 = P.coeficientes();
  const mal = clonar(c0);
  mal.codo.gajos_5[2] = 6;
  mal.codo.inglete_90 = -1;
  mal.entrada_ramal[7] = NaN;
  mal.expansion[1][1] = 1.4;
  mal.expansion[7][0] = -0.1;
  mal.contraccion[2] = 'x';
  assert.deepEqual(P.revisarCoeficientes(mal), [
    'Codo de 5 gajos a R/D 1.5: un coeficiente K va de 0 a 5.',
    'Codo de inglete: un coeficiente K va de 0 a 5.',
    'Entrada de ramal a 45°: un coeficiente K va de 0 a 5.',
    'Expansión a 5° con D₂/D₁ 1.5: la recuperación R va de 0 (se pierde toda la presión dinámica que sobra) a 1 (se recupera toda).',
    'Expansión brusca con D₂/D₁ 1.25: la recuperación R va de 0 (se pierde toda la presión dinámica que sobra) a 1 (se recupera toda).',
    'Contracción a 15°: el factor L de la contracción va de 0 a 1.',
  ]);
  falla(() => P.tablaDe(mal), 'TABLA', /^La tabla de coeficientes de las tablas maestras \(Cálculo de la red\) no sirve: Codo de 5 gajos a R\/D 1\.5: un coeficiente K va de 0 a 5\. Y 5 datos más\.$/);
  const corto = clonar(c0);
  corto.codo.liso = [0.7];
  corto.expansion = corto.expansion.slice(1);
  assert.deepEqual(P.revisarCoeficientes(corto), ['Codo liso o estampado: deben ser 6 valores.', 'Expansiones: deben ser 8 renglones.']);
  assert.deepEqual(P.revisarCoeficientes({}), ['Faltan los coeficientes de los codos.', 'Entrada de ramal: deben ser 11 valores.', 'Expansiones: deben ser 8 renglones.', 'Contracción: deben ser 9 valores.']);
  assert.deepEqual(P.revisarCoeficientes(null), ['Faltan los coeficientes.']);
  // los extremos del intervalo sí sirven
  const borde = clonar(c0);
  borde.codo.liso[0] = 0;
  borde.codo.inglete_90 = 5;
  borde.expansion[0][0] = 1;
  borde.contraccion[8] = 1;
  assert.deepEqual(P.revisarCoeficientes(borde), []);
  // las eficiencias: de más de 0 a 1, con su porqué
  falla(() => P.opcionesDe(conCalculo((c) => { c.eficiencia_ventilador = 0; })), 'TABLA', /^La eficiencia del ventilador de las tablas maestras \(Cálculo de la red\) va de más de 0 a 1: hoy dice 0\.$/);
  falla(() => P.opcionesDe(conCalculo((c) => { c.eficiencia_transmision = 1.2; })), 'TABLA', /eficiencia de las bandas .* hoy dice 1\.2/);
  assert.equal(P.opcionesDe(conCalculo((c) => { c.eficiencia_ventilador = 1; })).eficiencia_ventilador, 1, '1 sirve');
  // el límite de cada dato, por su ruta en las tablas maestras (lo usa el editor al teclear)
  assert.equal(P.fueraDeLimite(['calculo', 'coeficientes', 'expansion', 3, 1], 0.7), null);
  assert.match(P.fueraDeLimite(['calculo', 'coeficientes', 'expansion', 3, 1], 1.01), /recuperación R/);
  assert.match(P.fueraDeLimite(['calculo', 'eficiencia_ventilador'], 0), /más de 0 a 1/);
  assert.equal(P.fueraDeLimite(['capas', 'iva_pct'], 7), null, 'fuera del grupo calculo no dice nada');
  assert.equal(P.limiteDe(['calculo', 'otro']), null);
});

test('El cálculo con las tablas del taller es puro: no muta ni las tablas ni el sistema', () => {
  const M2 = congelar(conCalculo((c) => { c.coeficientes.codo.liso[3] = 0.2; c.eficiencia_ventilador = 0.6; }));
  const s = congelar(crudo());
  const op = P.opcionesDe(M2);
  const a = P.calcular(s, op);
  const b = P.calcular(s, P.opcionesDe(M2));
  assert.deepEqual(a.sistema, b.sistema);
  assert.deepEqual(P.TABLA, P.tablaDe(P.coeficientes()), 'la tabla de referencia queda como estaba');
});

test('El parche de las tablas: los coeficientes se guardan y regresan, y una lista de otro largo se descarta', () => {
  const editado = conCalculo((c) => { c.eficiencia_ventilador = 0.6; c.coeficientes.expansion[2][3] = 0.6; });
  const { diferencia } = require('../src/motor/util');
  const parche = diferencia(MA.crearMaestros(), editado);
  assert.deepEqual(parche, { calculo: { eficiencia_ventilador: 0.6, coeficientes: { expansion: editado.calculo.coeficientes.expansion } } });
  assert.deepEqual(MA.crearMaestros(parche).calculo, editado.calculo, 'regresa igual');
  const r = MA.sanearParche({ calculo: { eficiencia_ventilador: 0.7, coeficientes: { codo: { liso: [1, 2], gajos_3: [1, 1, 1, 1, 1, 1] }, expansion: [[1]], entrada_ramal: Array(11).fill(0.2), contraccion: 'x' } } });
  assert.deepEqual(r.descartados.sort(), ['calculo.coeficientes.codo.liso', 'calculo.coeficientes.contraccion', 'calculo.coeficientes.expansion']);
  assert.deepEqual(r.parche.calculo.coeficientes.codo, { gajos_3: [1, 1, 1, 1, 1, 1] });
  assert.equal(r.parche.calculo.coeficientes.entrada_ramal.length, 11);
  const M3 = MA.crearMaestros(r.parche);
  assert.deepEqual(P.revisarCoeficientes(M3.calculo.coeficientes), [], 'lo que entra siempre se puede revisar sin romperse');
  assert.equal(M3.calculo.coeficientes.codo.liso.length, 6, 'la lista corta se quedó con la de arranque');
  // en otras tablas (las de longitud libre) el largo puede cambiar, como antes
  assert.equal(MA.sanearParche({ rapida: { bridas_por_metros: [{ hasta_m: 30, importe: 1 }] } }).parche.rapida.bridas_por_metros.length, 1);
});

test('El tablero: toma las tablas nuevas, olvida el cálculo guardado y dice cuánto se movió el ventilador', () => {
  const t = TB.ejemplo(M);
  const s = TB.crear(M, t);
  const i0 = TB.informeCalculo(s);
  assert.deepEqual(i0.cambiadas, []);
  assert.equal(TB.usarMaestros(s, M), false, 'las mismas tablas: nada que hacer');
  const M2 = conCalculo((c) => { c.coeficientes.codo.gajos_5 = c.coeficientes.codo.gajos_5.map((k) => k * 2); });
  assert.equal(TB.usarMaestros(s, M2), true);
  const i1 = TB.informeCalculo(s);
  assert.deepEqual(i1.cambiadas, ['codos']);
  assert.ok(i1.ventiladores[0].presion_estatica_Pa > i0.ventiladores[0].presion_estatica_Pa);
  // un cambio en el mismo objeto también se nota (el editor de tablas cambia el dato en su lugar)
  M2.calculo.eficiencia_ventilador = 0.5;
  assert.equal(TB.usarMaestros(s, M2), true);
  assert.equal(TB.informeCalculo(s).ventiladores[0].eficiencia_ventilador, 0.5);
  // una tabla imposible: el cálculo dice qué está mal, sin romper el tablero
  M2.calculo.coeficientes.contraccion[2] = 3;
  TB.usarMaestros(s, M2);
  assert.match(TB.informeCalculo(s).error, /Contracción a 15°: el factor L de la contracción va de 0 a 1/);
  // el efecto de un cambio en el ventilador del trazo
  const Me = conCalculo((c) => { c.eficiencia_ventilador = 0.55; });
  assert.deepEqual(TB.efectoEnTrazo(t, M, Me), { txt: 'Ventilador de Colector de polvo: 2283 m³/h a 1864 Pa, 1.82 → 2.15 kW al freno, motor de 3 → 5 HP.', clase: 'sube' });
  assert.equal(TB.efectoEnTrazo(t, Me, M).clase, 'baja');
  assert.deepEqual(TB.efectoEnTrazo(t, M, conCalculo((c) => { c.coeficientes.codo.liso[0] = 0.9; })), { txt: 'Sin cambio en el ventilador del trazado: ninguna de sus piezas usa este dato (o su efecto es mínimo).', clase: 'igual' });
  assert.equal(TB.efectoEnTrazo(t, M, conCalculo((c) => { c.eficiencia_ventilador = 0; })).clase, 'mal');
  assert.equal(TB.efectoEnTrazo(null, M, Me).clase, 'neutro');
  assert.equal(TB.efectoEnTrazo(TZ.nuevo(M), M, Me).clase, 'neutro', 'un trazo vacío');
  const abierto = TZ.nuevo(M);
  const conColector = TZ.ponerEquipo(abierto, M, { tipo: 'COLECTOR', nombre: 'Colector', posicion_mm: { x: 0, y: 0, z: 0 }, caja_mm: TB.CAJAS.COLECTOR });
  assert.match(TB.efectoEnTrazo(conColector, M, Me).txt, /^El trazado de esta cotización todavía no se puede calcular: /);
});
