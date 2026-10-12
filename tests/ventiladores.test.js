/**
 * Elegir el ventilador por su curva (src/motor/ventiladores.js; docs/trazado-isometrico.md §5.13): la curva interpolada, el
 * corte con la parábola del sistema, las leyes del ventilador (la curva a las rpm que pide el punto pasa por él), las rpm
 * fuera de su rango, el lado inestable, la potencia con el aire real y el motor, el orden, lo que se descarta y por qué,
 * la revisión del catálogo, y el catálogo en las tablas maestras (ilustrativo, guardado como parche, también vacío).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/motor/ventiladores');
const P = require('../src/motor/perdidas');
const MA = require('../src/datos/maestros');
const U = require('../src/motor/util');
const TB = require('../src/web/trazado_tablero');

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const M = MA.crearMaestros();
const modelo = (extra) => ({ id: 'M1', nombre: 'Modelo 1', ilustrativo: false, notas: '', rpm: 1800, rpm_min: 1200, rpm_max: 2400,
  curva: [[0, 2000, 1], [1000, 1900, 1.5], [2000, 1600, 2], [3000, 1000, 2.2]], ...(extra || {}) });

test('La curva: presión y potencia interpoladas; fuera de sus puntos, null; potencia 0 = sin dato', () => {
  const c = modelo().curva;
  assert.equal(V.presionEn(c, 500), 1950);
  assert.equal(V.presionEn(c, 2500), 1300);
  assert.equal(V.presionEn(c, 3000), 1000);
  assert.equal(V.presionEn(c, 3001), null);
  assert.equal(V.potenciaEn(c, 1500), 1.75);
  assert.equal(V.potenciaEn([[0, 1000, 0], [1000, 800, 1], [2000, 500, 2]], 500), null, 'un extremo sin potencia');
  assert.equal(V.potenciaEn([[0, 1000, 0], [1000, 800, 1], [2000, 500, 2]], 1500), 1.5);
});

test('El corte con la parábola del sistema y las leyes del ventilador: a las rpm que pide, la curva pasa por el punto de diseño', () => {
  const m = modelo();
  // la parábola por 1 500 m³/h a 1 800 Pa
  const Q = 1500;
  const SP = 1800;
  const k = SP / (Q * Q);
  const c = V.corte(m.curva, k);
  cerca(c.SP, k * c.Q * c.Q, 1e-9, 'el corte está sobre la parábola');
  cerca(V.presionEn(m.curva, c.Q), c.SP, 1e-6, 'y sobre la curva');
  assert.ok(c.pendiente < 0);
  const r = V.elegir({ caudal_m3_h: Q, presion_estatica_estandar_Pa: SP }, [m]);
  const x = r.candidatos[0];
  cerca(x.rpm, 1800 * (Q / c.Q), 0.5, 'rpm = rpm del catálogo × Q de diseño / Q del corte');
  // la curva a esas rpm pasa por el punto de diseño (caudal ∝ rpm, presión ∝ rpm²)
  const curva = V.curvaA(m, 1800 * (Q / c.Q));
  cerca(V.presionEn(curva, Q), SP, 1e-6, 'a esas rpm, la curva pasa por el punto');
  // potencia ∝ rpm³ (aire estándar), y el motor con las bandas
  cerca(x.potencia_freno_kW, V.potenciaEn(m.curva, c.Q) * (Q / c.Q) ** 3, 0.001);
  assert.equal(x.motor_hp, P.MOTORES_HP.find((hp) => hp >= x.potencia_freno_kW / 1 / V.KW_POR_HP));
  cerca(x.eficiencia, ((Q / 3600) * SP / 1000) / (V.potenciaEn(m.curva, c.Q) * (Q / c.Q) ** 3), 0.001);
  assert.ok(x.dentro && x.estable && x.viable);
});

test('Con el aire real la potencia baja con la densidad; las bandas suben el motor', () => {
  const p = { caudal_m3_h: 1500, presion_estatica_estandar_Pa: 1800 };
  const std = V.elegir(p, [modelo()]).candidatos[0];
  const alto = V.elegir(p, [modelo()], { densidad_kg_m3: 0.96, eficiencia_transmision: 0.95 }).candidatos[0];
  cerca(alto.potencia_freno_kW, (std.potencia_freno_kW * 0.96) / 1.2, 0.002, 'P × ρ/1.2');
  assert.equal(alto.rpm, std.rpm, 'las rpm no cambian: la curva y el punto van en aire estándar');
  assert.equal(alto.motor_hp, P.MOTORES_HP.find((hp) => hp >= alto.potencia_freno_kW / 0.95 / V.KW_POR_HP - 1e-9));
});

test('Fuera de sus rpm, del lado inestable o sin cruzar la parábola: se dice por qué, y los que sirven van primero', () => {
  const p = { caudal_m3_h: 1500, presion_estatica_estandar_Pa: 1800 };
  // acople directo a 1 800: no llega (pide más rpm) y dice cuánto daría
  const directo = modelo({ id: 'DIR', nombre: 'Directo', rpm_min: 1800, rpm_max: 1800 });
  const d = V.elegir(p, [directo]).candidatos[0];
  assert.ok(!d.dentro && !d.viable);
  assert.match(d.notas[0], /^Pide \d+ rpm y gira fijo a 1800: con 1800 rpm daría \d+ m³\/h\.$/);
  // una curva con joroba: el punto cae donde todavía sube
  const joroba = modelo({ id: 'JOR', nombre: 'Joroba', curva: [[0, 800, 1], [1000, 1700, 1.5], [2000, 2000, 2], [2500, 1000, 2.1]] });
  const j = V.elegir({ caudal_m3_h: 800, presion_estatica_estandar_Pa: 2500 }, [joroba]);
  assert.ok(j.candidatos.length === 1 && !j.candidatos[0].estable && /puede oscilar/.test(j.candidatos[0].notas.join(' ')), JSON.stringify(j));
  // una curva que empieza lejos (de 2 000 a 3 000 m³/h) y baja: queda toda bajo la parábola, no la cruza dentro de sus puntos
  const corta = modelo({ id: 'COR', nombre: 'Corta', curva: [[2000, 300, 1], [2500, 280, 1.2], [3000, 250, 1.4]] });
  const r = V.elegir({ caudal_m3_h: 500, presion_estatica_estandar_Pa: 2000 }, [corta]);
  assert.deepEqual(r.candidatos, []);
  assert.match(r.descartados[0].motivo, /Su curva no cruza la del sistema/);
  // uno con datos malos se descarta con su primera falla
  const malo = modelo({ id: 'MAL', nombre: 'Malo', curva: [[0, 1000, 1], [500, 900, 1]] });
  const rm = V.elegir(p, [malo]);
  assert.match(rm.descartados[0].motivo, /su curva lleva de 3 a 30 puntos/);
  // el orden: los que sirven primero; luego por potencia
  const grande = modelo({ id: 'GRA', nombre: 'Grande', curva: [[0, 2600, 2], [1500, 2500, 3], [3000, 2100, 4], [4500, 1400, 4.5]] });
  const orden = V.elegir(p, [directo, grande, modelo()]).candidatos;
  assert.deepEqual(orden.map((x) => x.viable), [true, true, false]);
  assert.ok(orden[0].potencia_freno_kW <= orden[1].potencia_freno_kW);
  // sin punto de diseño
  assert.match(V.elegir({ caudal_m3_h: 0, presion_estatica_estandar_Pa: 100 }, [modelo()]).error, /punto de diseño/);
});

test('Revisar el catálogo: claves, nombres, rpm, puntos crecientes y rangos', () => {
  assert.deepEqual(V.revisarCatalogo([modelo()]), { ok: true, errores: [] });
  const casos = [
    [{ id: 'mal clave' }, /la clave va con letras/],
    [{ nombre: '' }, /le falta el nombre/],
    [{ rpm: 0 }, /las rpm de su curva/],
    [{ rpm_min: 2000, rpm_max: 1500 }, /la mínima no mayor que la máxima/],
    [{ rpm: 3000 }, /quedan fuera de su mínimo y su máximo/],
    [{ curva: [[0, 1, 1], [100, 1, 1], [100, 1, 1]] }, /el caudal crece/],
    [{ curva: [[0, -1, 1], [100, 1, 1], [200, 1, 1]] }, /la presión del punto 1/],
    [{ curva: [[0, 1, 1], [100, 1], [200, 1, 1]] }, /el punto 2 de la curva lleva/],
  ];
  casos.forEach(([cambio, re]) => {
    const r = V.revisarCatalogo([modelo(cambio)]);
    assert.ok(!r.ok && r.errores.some((e) => re.test(e)), `${JSON.stringify(cambio)}: ${r.errores.join(' | ')}`);
  });
  assert.match(V.revisarCatalogo([modelo(), modelo()]).errores.join(' '), /La clave M1 se repite/);
  assert.match(V.revisarCatalogo({}).errores[0], /es una lista/);
});

test('El catálogo de arranque es ILUSTRATIVO; se guarda como parche entero (también vacío) y lo que no tiene su forma se descarta', () => {
  const lista = M.ventiladores.modelos;
  assert.ok(lista.length === 2 && lista.every((m) => m.ilustrativo && /ilustrativo/i.test(m.nombre) && /inventada/.test(m.nombre)), 'marcados como ilustrativos');
  assert.deepEqual(V.revisarCatalogo(lista), { ok: true, errores: [] });
  // el taller captura uno suyo y borra los de ejemplo: el parche lleva la lista entera
  const suyo = modelo({ id: 'TALLER_1', nombre: 'Del proveedor', articulo: 'VENT_TALLER_1' });
  const Mt = U.clonar(M);
  Mt.ventiladores.modelos = [suyo];
  const parche = U.diferencia(MA.crearMaestros(), Mt);
  assert.deepEqual(MA.crearMaestros(parche).ventiladores.modelos, [suyo], 'con su artículo de compras');
  assert.match(V.revisarModelo({ ...suyo, articulo: { x: 1 } })[0], /artículo de compras es una clave/);
  // vacío también se conserva
  assert.deepEqual(MA.crearMaestros({ ventiladores: { modelos: [] } }).ventiladores.modelos, []);
  // un modelo sin su forma (sin curva) descarta la lista y quedan los de arranque, con aviso
  const { parche: limpio, descartados } = MA.sanearParche({ ventiladores: { modelos: [{ id: 'X', nombre: 'X' }] } });
  assert.deepEqual([limpio, descartados], [{}, ['ventiladores.modelos']]);
});

test('En el ejemplo del trazado: el B (con bandas) sirve a unas 3 000 rpm; el A (directo) se queda corto', () => {
  const s = TB.crear(M, null, { ancho: 1200, alto: 700 });
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const v = TB.informeCalculo(s).ventiladores[0];
  const [b, a] = v.eleccion.candidatos;
  assert.deepEqual([b.id, b.viable, a.id, a.viable], ['EJEMPLO_BANDAS', true, 'EJEMPLO_DIRECTO', false]);
  assert.ok(b.rpm > 2900 && b.rpm < 3100 && b.motor_hp === 3, JSON.stringify(b));
  assert.ok(a.notas.some((n) => /con 3450 rpm daría \d+ m³\/h/.test(n)) && a.notas.some((n) => /ilustrativa/.test(n)));
  // la gráfica: la curva a las rpm del B pasa por el punto de diseño
  const g = TB.graficaVentilador(v, 'EJEMPLO_BANDAS', M);
  cerca(V.presionEn(g.curva.map(([q, sp]) => [q, sp, 0]), v.caudal_m3_h), v.presion_estatica_estandar_Pa, 1.5, 'pasa por el punto (con las rpm redondeadas)');
  assert.ok(g.sistema.every(([q, sp]) => Math.abs(sp - v.eleccion.k * q * q) < 1e-6));
  assert.equal(TB.graficaVentilador(v, 'OTRO', M), null);
  assert.match(TB.efectoCatalogo(s.t, M).txt, /^Con este catálogo, para el ventilador de Colector de polvo sirve 1: Ejemplo ilustrativo B/);
  // con el catálogo vacío no sirve ninguno, y se dice
  const M0 = MA.crearMaestros({ ventiladores: { modelos: [] } });
  assert.match(TB.efectoCatalogo(s.t, M0).txt, /no sirve ningún modelo/);
});
