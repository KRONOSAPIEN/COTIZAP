/**
 * El tablero del trazado isométrico sin pantalla (src/web/trazado_tablero.js; etapa 2 de docs/trazado-isometrico.md §5):
 * el recorrido del ejemplo de §1.6 jugado con coordenadas de pantalla y teclas (da exactamente el JSON resuelto), la cámara,
 * lo que hay bajo el puntero, las tomas sobre las caras, los tiradores de la manguera, el plano de trabajo y sus teclas, la
 * caja de valores, el fantasma y su color, el imán, el modo cadena, la reducción, la reducción con injerto, mover segmento,
 * medir, borrar, deshacer y las fases.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const TZ = require('../src/motor/trazado_iso');
const TB = require('../src/web/trazado_tablero');
const EJ = require('../docs/ejemplos/trazado-isometrico-ejemplo.json');

const M = crearMaestros();
const V3 = (x, y, z) => ({ x, y, z });
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const PD = require('../src/motor/perdidas');
const U = require('../src/motor/util');
const completo = JSON.stringify(EJ);
/** El sistema exportado por el modelo, con el cálculo de pérdidas (etapa 4). */
const calculado = (s) => JSON.stringify(PD.calcular(s).sistema);
const PROYECTO = { id: 'EJ-TRAZADO-01', nombre: 'Ejemplo: sierra y cepillo a un colector', servicio: 'POLVO', material_transportado: 'Aserrín y viruta de madera', aire: { temperatura_C: 20, altitud_m: 2240 }, origen: 'Centro de la base del colector, sobre el piso terminado' };
const CAMARA = { k: 0.06, ox: 600, oy: 450 };
const nuevoTablero = () => { const s = TB.crear(M, null, { ancho: 1200, alto: 700 }); s.cam = { ...CAMARA }; return s; };
const P = (s, x, y, z) => TB.pantalla(s, V3(x, y, z));
const teclas = (s, txt) => txt.split('').forEach((k) => assert.ok(TB.teclear(s, k), `la caja toma «${k}»`));
const vista = (s, paso) => { TB.girarVista(s, paso); s.cam = { ...CAMARA }; };
const sinError = (s, msg) => assert.equal(s.error, false, `${msg || ''}: ${s.msg}`);

/** Fases 0 a 2 del ejemplo jugadas en el tablero: colector, sierra con brida y cepillo con manguera. */
function equiposJugados() {
  const s = nuevoTablero();
  TB.hacer(s, (t) => TZ.cambiarProyecto(t, M, PROYECTO), '');
  let q = P(s, 0, 0, 0);
  assert.ok(TB.colocarEquipo(s, 'COLECTOR', q.x, q.y));
  assert.equal(s.herr, 'TOMA', 'después de colocar, la herramienta pasa a Toma');
  TB.hacer(s, (t) => TZ.editarEquipo(t, M, 'EQ-01', { nombre: 'Colector de polvo', perdida_Pa: 1250 }), '');
  // la cara +X del colector no se ve en NE: se gira la vista (E) para poner la boca
  vista(s, 1);
  assert.equal(s.vista, 'SE');
  s.D = 8;
  q = P(s, 750, 0, 3000);
  assert.ok(TB.ponerToma(s, q.x, q.y), s.msg);
  assert.match(s.msg, /Boca PU-01 de Colector de polvo en su cara \+X, Ø 8″, con brida/);
  vista(s, -1);
  TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-01', { nombre: 'Boca del colector' }), '');
  // la sierra cae en la rejilla de 100 mm (10 800) y se lleva a 10 750 con Mayús+← (10 mm)
  q = P(s, 10750, 0, 0);
  assert.ok(TB.colocarEquipo(s, 'MAQUINA', q.x, q.y));
  assert.deepEqual(s.t.equipos[1].posicion_mm, V3(10800, 0, 0));
  for (let i = 0; i < 5; i += 1) TB.moverEquipo(s, 'EQ-02', { dx: -10 });
  assert.deepEqual(s.t.equipos[1].posicion_mm, V3(10750, 0, 0));
  TB.hacer(s, (t) => TZ.editarEquipo(t, M, 'EQ-02', { nombre: 'Sierra de banco' }), '');
  s.D = 6;
  q = P(s, 10750, 0, 1200);
  assert.ok(TB.ponerToma(s, q.x, q.y));
  assert.match(s.msg, /cara superior/);
  TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-02', { nombre: 'Toma superior', caudal_m3_h: 1300 }), '');
  assert.ok(TB.acoplar(s, 'PU-02', 'BRIDA'));
  TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-02', { barrenos: { numero: 6, circulo_mm: 190, diametro_mm: 9.5 } }), '');
  q = P(s, 7000, -3000, 0);
  assert.ok(TB.colocarEquipo(s, 'MAQUINA', q.x, q.y));
  TB.hacer(s, (t) => TZ.editarEquipo(t, M, 'EQ-03', { nombre: 'Cepillo', caja_mm: { largo: 1000, ancho: 600, alto: 1000 } }), '');
  s.D = 5;
  q = P(s, 7000, -3000, 1000);
  assert.ok(TB.ponerToma(s, q.x, q.y));
  TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-03', { nombre: 'Toma superior', caudal_m3_h: 900 }), '');
  assert.ok(TB.acoplar(s, 'PU-03', 'MANGUERA'));
  // los tiradores: el rombo sube el PT a 900 mm; el círculo lo desvía 250 mm hacia +Y
  const mg = TB.mangueraDe(s, 'PU-03');
  const a = P(s, 7000, -3000, 1000 + mg.h);
  const b = P(s, 7000, -3000, 1900);
  const h = TB.alturaPorArrastre(s, 'PU-03', mg.h, a.x, a.y, b.x, b.y);
  assert.equal(h, 900);
  const c = P(s, 7000, -2750, 1900);
  const ev = TB.desvioPorArrastre(s, 'PU-03', h, c.x, c.y);
  assert.deepEqual(ev, V3(0, 250, 0));
  const pre = TB.previaManguera(s, 'PU-03', h, ev);
  assert.equal(pre.semaforo.color, 'VERDE');
  assert.match(pre.semaforo.texto, /en S · R 553 mm \(mín\. 190\.5\) · 39\.31° · 958 mm/);
  assert.ok(TB.moverManguera(s, 'PU-03', h, ev));
  assert.match(s.msg, /S de dos curvas de 39\.31°: radio 552\.5 mm/);
  return s;
}
/** Fase 3: presionar en la toma, ↑, «1.8», Entrar; el imán a la boca; el ramal desde el PT con el imán al tronco. */
function trazarEjemplo(s) {
  s.herr = 'TRAMO';
  let q = P(s, 10750, 0, 1200);
  const hit = TB.tocar(s, q.x, q.y);
  assert.deepEqual(hit, { tipo: 'PUERTO', id: 'PU-02', nodo: 'N-002' });
  assert.ok(TB.empezar(s, hit, q.x, q.y));
  assert.equal(s.msg, 'Desde la toma PU-02 el ducto puede salir en +Z.');
  TB.fijar(s, 'Z');
  teclas(s, '1.8');
  assert.equal(TB.fantasma(s, q.x, q.y).texto, '1.8 m · 6″ · recto · +Z');
  assert.ok(TB.confirmar(s, q.x, q.y));
  assert.ok(s.traza && s.traza.desde === s.t.ultimo.nodo, 'modo cadena: sigue desde el extremo nuevo');
  assert.equal(s.fijar, null, 'el eje fijo se suelta al confirmar');
  q = P(s, 750, 0, 3000);
  const f = TB.fantasma(s, q.x, q.y);
  assert.equal(f.texto, 'Imán (la boca PU-01): Llegada: −X 10 m, 1 codo.');
  assert.equal(f.estado, 'OK');
  assert.ok(TB.confirmar(s, q.x, q.y));
  assert.equal(s.traza, null, 'al llegar a la boca termina la cadena');
  assert.match(s.msg, /Codo de 90° en N-005 \(CO-001\)/);
  q = P(s, 7000, -2750, 1900);
  assert.ok(TB.empezar(s, TB.tocar(s, q.x, q.y), q.x, q.y));
  assert.equal(s.D, 5, 'el Ø activo es el de la manguera');
  TB.fijar(s, 'Z');
  teclas(s, '1.1');
  assert.ok(TB.confirmar(s, q.x, q.y));
  q = P(s, 4300, 0, 3000);
  const textos = [];
  for (let i = 0; i < 4; i += 1) { textos.push(TB.fantasma(s, q.x, q.y).texto); TB.siguienteOpcion(s); }
  assert.deepEqual(textos, [
    'Imán (el tramo TR-003): Injerto a 45°, de lado (izquierda): rumbo 135° 3.889 m, 1 codo. (Tab: 1 de 3)',
    'Imán (el tramo TR-003): Injerto a 30°, de lado (izquierda): rumbo 150° 5.5 m, 1 codo. (Tab: 2 de 3)',
    'Imán (el tramo TR-003): Injerto a 45°, de lado (izquierda): rumbo 75° 2.245 m y rumbo 135° 0.822 m, 2 codos. (Tab: 3 de 3)',
    'Imán (el tramo TR-003): Injerto a 45°, de lado (izquierda): rumbo 135° 3.889 m, 1 codo. (Tab: 1 de 3)',
  ]);
  s.traza.tab = 0;
  assert.ok(TB.confirmar(s, q.x, q.y));
  assert.match(s.msg, /Injerto a 45° en N-007 \(IN-001\)/);
  return s;
}

test('El ejemplo de la paleta (§1.6 con las operaciones del modelo) es el JSON resuelto', () => {
  assert.equal(calculado(TZ.aSistema(TB.ejemplo(M), M)), completo);
});

test('El recorrido de §1.6 jugado en el tablero (pantalla, teclas, tiradores e imán) da exactamente el ejemplo', () => {
  const s = trazarEjemplo(equiposJugados());
  assert.ok(TB.hacer(s, (t) => TZ.aplicarDimensiones(t, M), ''));
  assert.match(s.msg, /TR-005: 6″ → 8″, 33\.5 → 18\.8 m\/s\. Reducción con injerto a 45° en N-007 \(RI-001\)/);
  assert.ok(TB.hacer(s, (t) => TZ.renumerar(t, M), ''));
  assert.equal(calculado(TZ.aSistema(s.t, M)), completo);
  assert.ok(TB.fases(s).every((f) => f.pendientes === 0), 'sin pendientes en ninguna fase');
  const ex = TB.exportar(s);
  assert.equal(ex.texto, JSON.stringify(EJ, null, 2), 'la salida trae el cálculo de pérdidas: es el ejemplo completo');
  assert.deepEqual([ex.calculado, ex.aviso], [true, null]);
  // y se puede deshacer paso por paso hasta el principio, y rehacer
  const final = JSON.stringify(s.t);
  let n = 0;
  while (s.hist.length) { TB.deshacer(s); n += 1; }
  assert.equal(s.t.equipos.length, 0);
  for (let i = 0; i < n; i += 1) TB.rehacer(s);
  assert.equal(JSON.stringify(s.t), final);
});

test('La cámara: de mm a px y de regreso, encuadrar, acercar sobre el puntero y girar el isométrico', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1000, alto: 600 });
  ['NE', 'SE', 'SO', 'NO', 'PLANTA', 'ELEV_XZ', 'ELEV_YZ'].forEach((v) => {
    TB.ponerVista(s, v);
    const pts = s.t.nodos.map((x) => TB.pantalla(s, x.posicion_mm));
    assert.ok(pts.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 600), `${v}: todo cabe al encuadrar`);
  });
  TB.ponerVista(s, 'NE');
  const P0 = V3(4250, 0, 3000);
  const q = TB.pantalla(s, P0);
  const r = TB.enPlano(s, q.x, q.y, TZ.planoHorizontal(3000));
  ['x', 'y', 'z'].forEach((k) => cerca(r.punto[k], P0[k], 1e-6, k));
  TB.zoom(s, 2, q.x, q.y);
  const q2 = TB.pantalla(s, P0);
  cerca(q2.x, q.x, 1e-9, 'el punto bajo el puntero no se mueve al acercar');
  cerca(q2.y, q.y, 1e-9);
  const orden = [];
  for (let i = 0; i < 4; i += 1) { TB.girarVista(s, 1); orden.push(s.vista); }
  assert.deepEqual(orden, ['SE', 'SO', 'NO', 'NE'], 'E: NE → SE → SO → NO');
  TB.girarVista(s, -1);
  assert.equal(s.vista, 'NO', 'Q: NE → NO');
  // en NE se ven las caras −X, −Y y la de arriba; en planta sólo la de arriba
  TB.ponerVista(s, 'NE');
  assert.deepEqual(TB.carasVisibles(s, s.t.equipos[0]).map((c) => c.cara.nombre).sort(), ['cara superior', 'cara −X', 'cara −Y']);
  TB.ponerVista(s, 'PLANTA');
  assert.deepEqual(TB.carasVisibles(s, s.t.equipos[0]).map((c) => c.cara.nombre), ['cara superior']);
});

test('Bajo el puntero: el puerto gana al tramo, el PT, el extremo, el tramo con su punto y el equipo', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1200, alto: 700 });
  const g = s.g;
  const boca = s.t.equipos[0].puertos[0];
  let q = TB.pantalla(s, g.pos.get(boca.nodo));
  assert.deepEqual(TB.tocar(s, q.x, q.y), { tipo: 'PUERTO', id: boca.id, nodo: boca.nodo });
  const pt = s.t.equipos[2].puertos[0].acople.nodo_transicion;
  q = TB.pantalla(s, g.pos.get(pt));
  assert.deepEqual(TB.tocar(s, q.x, q.y), { tipo: 'PT', id: 'PU-03', nodo: pt });
  q = TB.pantalla(s, V3(8000, 0, 3000));
  const h = TB.tocar(s, q.x, q.y);
  assert.equal(h.tipo, 'TRAMO');
  assert.equal(h.id, 'TR-002');
  cerca(h.punto.x, 8000, 1, 'el punto sobre el tramo');
  q = TB.pantalla(s, V3(7000, -3000, 500));
  assert.deepEqual(TB.tocar(s, q.x, q.y), { tipo: 'EQUIPO', id: 'EQ-03' });
  assert.equal(TB.tocar(s, 5, 5), null);
});

test('Las tomas se ajustan sobre la cara: al centro, al medio de una arista o a la rejilla de 50 mm', () => {
  const s = nuevoTablero();
  let q = P(s, 0, 0, 0);
  TB.colocarEquipo(s, 'MAQUINA', q.x, q.y);
  const e = () => s.t.equipos[0];
  q = P(s, 37, -21, 1200);
  assert.deepEqual(TB.caraBajo(s, e(), q.x, q.y).local, V3(0, 0, 1200), 'cerca del centro de la cara de arriba');
  q = P(s, -600, 10, 610);
  const c = TB.caraBajo(s, e(), q.x, q.y);
  assert.equal(c.nombre, 'cara −X');
  assert.deepEqual(c.local, V3(-600, 0, 600), 'el centro de la cara −X');
  q = P(s, -600, 190, 330);
  assert.deepEqual(TB.caraBajo(s, e(), q.x, q.y).local, V3(-600, 200, 350), 'lejos de los puntos especiales: la rejilla de 50 mm');
  q = P(s, 30, -400, 1190);
  assert.deepEqual(TB.caraBajo(s, e(), q.x, q.y).local, V3(0, -400, 1200), 'el medio de la arista de arriba de la cara −Y');
  // una toma en la cara −X apunta hacia −X
  q = P(s, -600, 0, 600);
  assert.ok(TB.ponerToma(s, q.x, q.y));
  assert.deepEqual(s.t.equipos[0].puertos[0].direccion_local, { azimut_deg: 180, elevacion_deg: 0 });
  assert.deepEqual(s.sel, { tipo: 'PUERTO', id: 'PU-01' });
  // fuera de cualquier equipo
  assert.equal(TB.ponerToma(s, 5, 5), false);
  assert.match(s.msg, /Toque una cara/);
});

test('La caja de valores: largos en m o mm, codo, rumbo y elevación; lo que no entiende lo dice', () => {
  assert.deepEqual(TB.leerCaja('3.25'), { largo: 3250 });
  assert.deepEqual(TB.leerCaja('3,5'), { largo: 3500 });
  assert.deepEqual(TB.leerCaja('3250mm'), { largo: 3250 });
  assert.deepEqual(TB.leerCaja('325cm'), { largo: 3250 });
  assert.deepEqual(TB.leerCaja('2m'), { largo: 2000 });
  assert.deepEqual(TB.leerCaja('750'), { largo: 750 }, 'un número sin unidad mayor que 100 es en mm');
  assert.deepEqual(TB.leerCaja('<45'), { codo: 45 });
  assert.deepEqual(TB.leerCaja('@135'), { azimut: 135 });
  assert.deepEqual(TB.leerCaja('@-90'), { azimut: 270 });
  assert.deepEqual(TB.leerCaja('^45'), { elevacion: 45 });
  assert.deepEqual(TB.leerCaja('2.5 @135'), { largo: 2500, azimut: 135 });
  assert.equal(TB.leerCaja('abc').error, 'abc');
  const s = nuevoTablero();
  assert.equal(TB.teclear(s, 'x'), false);
  assert.equal(TB.teclear(s, 'm'), false, 'una unidad sólo después de un número');
  teclas(s, '12');
  assert.equal(TB.teclear(s, 'Backspace'), true);
  assert.equal(s.caja, '1');
});

test('El plano de trabajo y sus teclas: horizontal, vertical por el arrastre, ↑ → ← H V, Tab y Mayús', () => {
  const s = nuevoTablero();
  s.herr = 'TRAMO';
  // un arranque abierto en el piso a 3 m: horizontal por omisión
  s.nivel = 3000;
  const q = P(s, 0, 0, 3000);
  assert.ok(TB.empezar(s, null, q.x, q.y));
  const P0 = s.traza.P0;
  assert.deepEqual(P0, V3(0, 0, 3000));
  let r = P(s, 2340, 0, 3000);
  let f = TB.fantasma(s, r.x, r.y);
  assert.equal(f.plano, 'plano horizontal z = 3000');
  assert.deepEqual(f.op.direccion, { azimut_deg: 0, elevacion_deg: 0 });
  assert.equal(f.largo, 2300, 'el largo al paso de 100 mm');
  // un arrastre casi vertical en la pantalla: plano vertical (el que más se ve de frente) y sube
  r = { x: q.x + 3, y: q.y - 150 };
  f = TB.fantasma(s, r.x, r.y);
  assert.equal(f.plano, 'plano vertical X–Z');
  assert.deepEqual(f.op.direccion, { azimut_deg: 0, elevacion_deg: 90 });
  assert.equal(f.largo, 2500, '150 px a 0.06 px/mm');
  // H fija el horizontal: un arrastre vertical en la pantalla es una horizontal a rumbo 45°
  TB.fijar(s, 'H');
  f = TB.fantasma(s, r.x, r.y);
  assert.deepEqual(f.op.direccion, { azimut_deg: 45, elevacion_deg: 0 });
  TB.fijar(s, 'H');
  assert.equal(s.fijar, null, 'la misma tecla lo suelta');
  // → fija el eje X: el puntero de lado da +X o −X
  TB.fijar(s, 'X');
  r = P(s, -1530, 0, 3000);
  r = { x: r.x + 10, y: r.y + 17.32 }; // 20 px de lado (perpendicular al eje X en la pantalla): no cambia el largo
  f = TB.fantasma(s, r.x, r.y);
  assert.deepEqual(f.op.direccion, { azimut_deg: 180, elevacion_deg: 0 });
  assert.equal(f.largo, 1500);
  TB.fijar(s, 'X');
  // Tab: la segunda mejor dirección
  r = P(s, 2000, 100, 3000);
  const d0 = TB.fantasma(s, r.x, r.y).op.direccion;
  TB.siguienteOpcion(s);
  const d1 = TB.fantasma(s, r.x, r.y).op.direccion;
  assert.notDeepEqual(d1, d0);
  s.traza.tab = 0;
  // Mayús: conserva la dirección aunque el puntero se mueva y el largo va de 10 en 10 mm
  f = TB.fantasma(s, r.x, r.y);
  TB.teclasSostenidas(s, true, false);
  const otra = P(s, 1234, 900, 3000);
  const f2 = TB.fantasma(s, otra.x, otra.y);
  assert.deepEqual(f2.op.direccion, f.op.direccion);
  assert.equal(f2.largo % 10, 0);
  assert.notEqual(f2.largo % 100, 0);
  TB.teclasSostenidas(s, false, false);
  // tecleado: rumbo y elevación
  teclas(s, '^45');
  f = TB.fantasma(s, r.x, r.y);
  assert.deepEqual(f.op.direccion, { azimut_deg: 0, elevacion_deg: 45 });
  s.caja = '';
  teclas(s, '@20');
  f = TB.fantasma(s, r.x, r.y);
  assert.equal(f.ok, false);
  assert.match(f.texto, /no puede ir en rumbo 20°/);
  s.caja = '';
  // Esc: primero lo tecleado, luego la cadena
  teclas(s, '3');
  TB.cancelar(s);
  assert.equal(s.caja, '');
  assert.ok(s.traza);
  TB.cancelar(s);
  assert.equal(s.traza, null);
});

test('Después de una vertical el plano es horizontal; desde un codo sólo salen los giros del taller', () => {
  const s = nuevoTablero();
  s.herr = 'TRAMO';
  s.nivel = 500;
  const q = P(s, 0, 0, 500);
  TB.empezar(s, null, q.x, q.y);
  TB.fijar(s, 'Z');
  teclas(s, '1.5');
  assert.ok(TB.confirmar(s, q.x, q.y), s.msg);
  const P1 = s.traza.P0;
  assert.deepEqual(P1, V3(0, 0, 2000));
  // casi vertical en la pantalla, pero el que llega es vertical: horizontal (rumbo 45° o 225° se ve vertical en NE)
  const p1 = P(s, 0, 0, 2000);
  const f = TB.fantasma(s, p1.x + 2, p1.y - 120);
  assert.equal(f.plano, 'plano horizontal z = 2000');
  assert.deepEqual(f.op.direccion, { azimut_deg: 45, elevacion_deg: 0 });
  // <45 desde lo que sube: no hay codo de 45° que salga horizontal de una vertical... pero sí inclinado
  teclas(s, '<45');
  const f2 = TB.fantasma(s, p1.x + 100, p1.y - 40);
  assert.equal(f2.op.pieza, 'CODO');
  assert.equal(f2.op.giro_deg, 45);
  assert.equal(Math.abs(f2.op.direccion.elevacion_deg), 45);
  s.caja = '';
  teclas(s, '<20');
  const f3 = TB.fantasma(s, p1.x + 100, p1.y - 40);
  assert.equal(f3.ok, false);
  assert.match(f3.texto, /no sale un codo de 20°/);
});

test('El fantasma prueba en el modelo: rojo si el taller no lo hace, ámbar con su aviso, alineación con los nodos', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1200, alto: 700 });
  s.cam = { ...CAMARA };
  s.herr = 'TRAMO';
  // desde la boca (ocupada) no se puede
  const boca = s.t.equipos[0].puertos[0];
  let q = TB.pantalla(s, s.g.pos.get(boca.nodo));
  assert.equal(TB.empezar(s, TB.tocar(s, q.x, q.y), q.x, q.y), false);
  assert.match(s.msg, /ya no puede salir otro ducto/);
  // un arranque suelto que choca con el colector: se puede, en ámbar, con el aviso
  s.nivel = 2000;
  q = P(s, -3000, 0, 2000);
  assert.ok(TB.empezar(s, null, q.x, q.y));
  TB.fijar(s, 'X');
  teclas(s, '5');
  const r = P(s, 2000, 0, 2000);
  const f = TB.fantasma(s, r.x, r.y);
  assert.equal(f.ok, true);
  assert.equal(f.estado, 'AVISO');
  assert.match(f.texto, /pasa a 0 mm de Colector de polvo/);
  TB.cancelar(s);
  TB.cancelar(s);
  // alineación: el final queda a la misma X que un nodo
  s.traza = null;
  s.nivel = 0;
  q = P(s, 4000, 3000, 0);
  TB.empezar(s, null, q.x, q.y);
  const n = s.t.nodos.find((x) => x.posicion_mm.x === 4250);
  const objetivo = P(s, n.posicion_mm.x + 40, 3000, 0);
  const fa = TB.fantasma(s, objetivo.x, objetivo.y);
  assert.equal(fa.largo, 250, 'se ajusta a X = 4 250 (exacto)');
  assert.equal(fa.guia.eje, 'X');
});

test('El imán: Mayús lo apaga, y un ramal desde el tronco sale en injerto (también con reducción)', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1200, alto: 700 });
  s.cam = { ...CAMARA };
  s.herr = 'INJERTO';
  // un injerto desde el tronco TR-002 (8″, ya llega al colector) hacia afuera
  let q = P(s, 2000, 0, 3000);
  assert.ok(TB.empezar(s, TB.tocar(s, q.x, q.y), q.x, q.y), s.msg);
  assert.match(s.msg, /salir en injerto a (30° o 45°|45° o 30°)/);
  assert.equal(s.D, 6, 'el Ø activo no pasa del tronco');
  const r = P(s, 1000, 1500, 3000);
  let f = TB.fantasma(s, r.x, r.y);
  assert.equal(f.op.pieza, 'INJERTO');
  assert.ok(TB.confirmar(s, r.x, r.y));
  sinError(s, 'injerto');
  assert.match(s.msg, /Injerto a (30|45)° en N-\d+ \(IN-\d+\)/);
  TB.cancelar(s);
  // reducción con injerto: el tronco de aguas arriba baja a «tronco después»
  TB.deshacer(s);
  s.herr = 'RINJ';
  s.D = 4;
  s.D2 = 6;
  q = P(s, 2000, 0, 3000);
  assert.ok(TB.empezar(s, TB.tocar(s, q.x, q.y), q.x, q.y), s.msg);
  f = TB.fantasma(s, r.x, r.y);
  assert.match(f.texto, /el tronco de aguas arriba queda de 6″/);
  assert.ok(TB.confirmar(s, r.x, r.y), s.msg);
  const g = TZ.calcular(s.t, M);
  assert.ok(g.piezas.some((p) => p.tipo === 'REDUCCION_INJERTO' && p.conexiones[2].diametro_in === 4), 'sale la reducción con injerto con su ramal de 4″');
  // con «tronco después» que no es menor, se dice antes de trazar
  TB.cancelar(s);
  TB.deshacer(s);
  s.D2 = 8;
  assert.equal(TB.empezar(s, TB.tocar(s, q.x, q.y), q.x, q.y), false);
  assert.match(s.msg, /tronco después debe ser menor/);
  // Mayús apaga el imán (para trazar cerca de un tramo sin unirse)
  s.herr = 'TRAMO';
  const pt = s.t.equipos[2].puertos[0].acople.nodo_transicion;
  const s2 = TB.crear(M, TZ.borrarTramo(TZ.borrarTramo(TB.ejemplo(M), M, 'TR-006'), M, 'TR-005'), { ancho: 1200, alto: 700 });
  s2.cam = { ...CAMARA };
  s2.herr = 'TRAMO';
  const qq = TB.pantalla(s2, s2.g.pos.get(pt));
  assert.ok(TB.empezar(s2, TB.tocar(s2, qq.x, qq.y), qq.x, qq.y));
  TB.fijar(s2, 'Z');
  teclas(s2, '1.1');
  TB.confirmar(s2, qq.x, qq.y);
  const sobre = P(s2, 4300, 0, 3000);
  assert.ok(TB.fantasma(s2, sobre.x, sobre.y).ruta, 'con el puntero sobre el tronco, el imán');
  TB.teclasSostenidas(s2, true, false);
  assert.equal(TB.fantasma(s2, sobre.x, sobre.y).ruta, undefined, 'con Mayús, no');
});

test('Reducción en un tramo o en un codo, mover segmento, medir y borrar el ramal', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1200, alto: 700 });
  s.cam = { ...CAMARA };
  // reducir el tronco de la sierra (6″) a 5″ desde la mitad de la horizontal: baja también la subida
  s.D = 5;
  let q = P(s, 8000, 0, 3000);
  assert.ok(TB.reducirEn(s, TB.tocar(s, q.x, q.y)), s.msg);
  assert.match(s.msg, /hacia las tomas el ducto queda de 5″: TR-\d+, TR-\d+/);
  let g = TZ.calcular(s.t, M);
  assert.ok(g.piezas.some((p) => p.tipo === 'REDUCCION' && p.D1 === 6 && p.D2 === 5));
  assert.ok(g.piezas.some((p) => p.tipo === 'ADAPTADOR'), 'en la toma de 6″ sale el adaptador');
  TB.deshacer(s);
  // mover segmento: la horizontal del ramal no tiene vecinos paralelos al movimiento lateral
  const ramal = s.t.tramos.find((t) => t.tipo === 'RIGIDO' && s.g.seg.get(t.id).dir.azimut_deg === 135);
  const a = TB.pantalla(s, s.g.pos.get(ramal.a));
  const w = TB.desplazamientoSegmento(s, ramal.id, a.x, a.y, a.x, a.y - 60);
  assert.ok(w.w, w.error);
  assert.equal(Math.abs(w.w.z), Math.abs(w.mm), 'se mueve en la dirección de su vecino vertical');
  // medir
  TB.medir(s, null, ...Object.values(P(s, 0, 0, 0)));
  const pt = P(s, 3000, 4000, 0);
  TB.medir(s, null, pt.x, pt.y);
  assert.match(s.msg, /Distancia 5 m: ΔX 3000 mm, ΔY 4000 mm, ΔZ 0 mm/);
  // borrar con Mayús: el ramal hasta sus tomas (la manguera se queda con su toma)
  const nTramos = s.t.tramos.length;
  q = P(s, 4250 + 1000, -1000, 3000);
  const h = TB.tocar(s, q.x, q.y);
  assert.equal(h.tipo, 'TRAMO');
  assert.ok(TB.borrar(s, h, true), s.msg);
  assert.ok(s.t.tramos.length < nTramos);
  g = TZ.calcular(s.t, M);
  assert.equal(g.piezas.filter((p) => p.tipo === 'REDUCCION_INJERTO' || p.tipo === 'INJERTO').length, 0, 'sin ramal no hay injerto');
});

test('Fases: lo pendiente de cada una; ▶ lleva a la siguiente con algo pendiente', () => {
  const s = nuevoTablero();
  let f = TB.fases(s);
  assert.deepEqual(f.map((x) => x.pendientes), [0, 1, 0, 0, 0, 1]);
  assert.deepEqual(f[1].notas, ['falta el colector']);
  assert.equal(TB.irFase(s, 0, true), 1);
  assert.equal(s.herr, 'EQUIPO');
  const q = P(s, 0, 0, 0);
  TB.colocarEquipo(s, 'MAQUINA', q.x, q.y);
  TB.ponerToma(s, ...Object.values(P(s, 0, 0, 1200)));
  f = TB.fases(s);
  assert.equal(f[1].pendientes, 2, 'falta el colector y la toma no tiene caudal');
  assert.equal(f[2].pendientes, 1, 'la toma sin acople');
  TB.acoplar(s, 'PU-01', 'BRIDA');
  f = TB.fases(s);
  assert.equal(f[2].pendientes, 0);
  assert.equal(f[3].pendientes, 1, 'la toma sin ducto');
  assert.equal(TB.irFase(s, 3), 3);
  assert.equal(s.herr, 'TRAMO');
});

test('Importar y exportar: el JSON del sistema ida y vuelta; lo roto se rechaza sin cambiar nada', () => {
  const s = nuevoTablero();
  assert.ok(TB.importar(s, completo));
  assert.equal(calculado(TZ.aSistema(s.t, M)), completo);
  assert.equal(s.hist.length, 1, 'se puede deshacer');
  const antes = JSON.stringify(s.t);
  assert.equal(TB.importar(s, '{nada'), false);
  assert.match(s.msg, /no es un JSON válido/);
  assert.equal(TB.importar(s, JSON.stringify({ version: '1.0' })), false);
  assert.equal(JSON.stringify(s.t), antes);
  // con errores sólo como borrador
  const s2 = nuevoTablero();
  TB.colocarEquipo(s2, 'MAQUINA', ...Object.values(P(s2, 0, 0, 0)));
  TB.ponerToma(s2, ...Object.values(P(s2, 0, 0, 1200)));
  assert.match(TB.exportar(s2).error, /No se puede exportar/);
  assert.ok(TB.exportar(s2, true).texto.includes('"conexion": null'));
});

test('Deshacer guarda hasta 100 pasos; un cambio rechazado no se guarda', () => {
  const s = nuevoTablero();
  const q = P(s, 0, 0, 0);
  TB.colocarEquipo(s, 'MAQUINA', q.x, q.y);
  for (let i = 0; i < 120; i += 1) TB.moverEquipo(s, 'EQ-01', { dx: 10 });
  assert.equal(s.hist.length, 100);
  const n = s.hist.length;
  assert.equal(TB.moverEquipo(s, 'EQ-01', { dz: -100 }), false, 'bajo el piso');
  assert.equal(s.hist.length, n);
  assert.equal(s.error, true);
});

test('Etapa 3: «Corregir» desde el tablero (con deshacer), el Ø en cadena como alternativa y la decisión del tramo corto', () => {
  const s = TB.crear(M, TB.ejemplo(M), { ancho: 1200, alto: 700 });
  // el tronco del colector a 6″: velocidad alta, con su arreglo
  const colector = s.t.tramos.find((t) => t.diametro_in === 8).id;
  TB.hacer(s, (t) => TZ.cambiarDiametro(t, M, colector, 6), '');
  const p = s.problemas.find((v) => v.codigo === 'VELOCIDAD_ALTA');
  const cs = TB.correccionesDe(s, p);
  assert.ok(TB.correccionesListas(s, p));
  assert.equal(TB.correccionesDe(s, p), cs, 'se guardan mientras el trazo no cambie');
  assert.equal(cs[0].texto, `Cambiar ${colector} a 8″ (18.8 m/s).`);
  assert.ok(TB.corregir(s, cs[0]));
  assert.equal(s.msg, `Cambiar ${colector} a 8″ (18.8 m/s): hecho. Reducción con injerto a 45° en N-002 (RI-002).`);
  assert.ok(!s.problemas.some((v) => v.codigo === 'VELOCIDAD_ALTA'));
  assert.ok(!TB.correccionesListas(s, p), 'con el trazo nuevo se buscan de nuevo');
  TB.deshacer(s);
  assert.ok(s.problemas.some((v) => v.codigo === 'VELOCIDAD_ALTA'), 'y se deshace');
  TB.rehacer(s);
  // subir la subida de la sierra a 8″ se rechaza; la alternativa en cadena sí se puede
  const sube = s.t.tramos.find((t) => t.a === s.t.equipos[1].puertos[0].nodo || t.b === s.t.equipos[1].puertos[0].nodo).id;
  const r = TB.cambiarDiametroTramo(s, sube, 8);
  assert.equal(r.ok, false);
  assert.equal(s.error, true);
  assert.match(s.msg, /Hacia el colector el diámetro no baja/);
  assert.match(r.alternativa.texto, new RegExp(`^Cambiar en cadena: ${sube} y TR-\\d+ a 8″$`));
  assert.ok(TB.cambiarDiametroEnCadena(s, sube, 8));
  assert.ok(s.t.tramos.filter((t) => t.tipo === 'RIGIDO' && t.diametro_in === 8).length >= 3);
  // un tramo corto entre dos codos: el inspector sabe que es corto y qué se puede decidir
  const c = TB.crear(M, null, { ancho: 1200, alto: 700 });
  TB.hacer(c, (t) => TZ.trazar(t, M, { posicion_mm: { x: 0, y: 0, z: 2500 } }, { direccion: { azimut_deg: 0, elevacion_deg: 0 }, largo_mm: 2000 }), '');
  TB.hacer(c, (t) => TZ.trazar(t, M, t.ultimo.nodo, { direccion: { azimut_deg: 90, elevacion_deg: 0 }, largo_mm: 500 }), '');
  TB.hacer(c, (t) => TZ.trazar(t, M, t.ultimo.nodo, { direccion: { azimut_deg: 180, elevacion_deg: 0 }, largo_mm: 2000 }), '');
  const info = TB.infoTramo(c, 'TR-002');
  assert.deepEqual({ ...info.corto, neta: Math.round(info.corto.neta) }, { neta: 43, piezas: ['CO-001', 'CO-002'], dosLados: true, decision: null });
  assert.ok(TB.decidirCorto(c, 'TR-002', 'PEGAR'));
  assert.equal(c.msg, 'TR-002: se arman pegadas, sin bridas en esas caras.');
  assert.equal(TB.infoTramo(c, 'TR-002').corto.decision, 'PEGAR');
  assert.ok(c.problemas.some((v) => v.codigo === 'PIEZAS_PEGADAS') && !c.problemas.some((v) => v.codigo === 'TRAMO_CORTO'));
  assert.equal(TB.infoTramo(c, 'TR-001').corto, null);
});

test('La manguera imposible dice hasta dónde subir el punto de transición', () => {
  const pol = TZ.politicasDe(M, 'POLVO');
  const x = { P_t: V3(0, 0, 0), u_t: V3(0, 0, 1), P_r: V3(0, 400, 500), u_r: V3(0, 0, 1), diametro_in: 5, manguera: pol.manguera };
  const r = TZ.resolverManguera(x);
  cerca(r.altura_min_mm, 580.526, 1e-3, 'h = 2·puño + √(4·e·R mín − e²)');
  const sem = TB.semaforoManguera(r, pol);
  assert.equal(sem.color, 'ROJO');
  assert.match(sem.texto, /pide un radio de 156 mm; la manguera de 5″ necesita 190\.5 mm\. Con este desvío, suba el punto de transición a 600 mm o más\.$/);
  assert.equal(TZ.resolverManguera({ ...x, P_r: V3(0, 400, 600) }).posible, true, 'a 600 mm ya cabe');
});

test('Salida con el cálculo de pérdidas (etapa 4): ventilador, tomas, balance, renglón por tramo, caché y lo que falta', () => {
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const c = TB.calculo(s);
  assert.equal(TB.calculo(s), c, 'se guarda mientras el trazo no cambie');
  const inf = TB.informeCalculo(s);
  assert.deepEqual(inf.ventiladores.map((v) => [v.nombre, v.caudal_m3_h, v.presion_estatica_Pa, v.motor_hp]), [['Colector de polvo', 2283.4, 1863.78, 3]]);
  assert.deepEqual(inf.tomas.map((x) => [x.nombre, x.caudal_corregido_m3_h, x.critica]), [['Sierra de banco', 1383.4, false], ['Cepillo', 900, true]]);
  assert.deepEqual(inf.balance.map((b) => [b.nodo, b.nombre_accion]), [['N-002', 'Ajustar caudal']]);
  assert.deepEqual(inf.tramos.map((x) => [x.tramo, x.diametro_in]), [['TR-001', 6], ['TR-002', 6], ['TR-003', 8], ['TR-004', 5], ['TR-005', 5], ['TR-006', 5]]);
  assert.deepEqual(TB.filaCalculo(s, 'TR-006').locales.map((l) => l.texto), ['entrada del ramal RI-001 (K 0.28)']);
  assert.deepEqual(TB.filaCalculo(s, 'TR-004').locales.map((l) => l.texto), ['curvas de la manguera (K 0.1048)']);
  assert.equal(TB.filaCalculo(s, 'TR-001').presion_estatica_Pa, 349.42);
  assert.equal(TB.filaCalculo(s, 'TR-099'), null);
  // un cambio en el trazo se vuelve a calcular: sin pérdida de entrada en la sierra, compuerta
  assert.ok(TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-02', { coef_entrada_K: 0 }), ''));
  assert.notEqual(TB.calculo(s), c);
  assert.deepEqual(TB.informeCalculo(s).balance.map((b) => b.nombre_accion), ['Compuerta']);
  TB.deshacer(s);
  assert.equal(TB.exportar(s).texto, JSON.stringify(EJ, null, 2));
  // sin caudal en una toma no se exporta ni se calcula, y se dice por qué
  assert.ok(TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-03', { caudal_m3_h: null }), ''));
  assert.match(TB.informeCalculo(s).error, /^Para calcular, primero corrija los problemas: hay 1 problema: La toma PU-03 \(Cepillo\) no tiene caudal/);
  assert.equal(TB.filaCalculo(s, 'TR-001'), null);
  assert.match(TB.exportar(s).error, /No se puede exportar/);
  const b = TB.exportar(s, true);
  assert.deepEqual([b.borrador, b.calculado], [true, false], 'el borrador sale sin cálculo');
  assert.equal(JSON.parse(b.texto).resultados, null);
});

test('Compuerta en el tablero: la herramienta (G) en un tramo, la que pide el balanceo, su nombre y quitarla con Borrar', () => {
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  TB.elegir(s, 'COMPUERTA');
  assert.match(s.msg, /Toque un tramo recto donde va la compuerta/);
  assert.equal(TB.compuertaEn(s, null), false);
  assert.ok(TB.compuertaEn(s, { tipo: 'TRAMO', id: 'TR-002', s_mm: 3020 }));
  assert.match(s.msg, /^Compuerta CP-001 en N-008: abierta\. En la salida, el balanceo dice cuánto cerrarla\.$/);
  assert.deepEqual(TB.piezasDe(s, 'N-008').map((p) => [p.corto, p.nombre]), [['Compuerta', 'Compuerta de regulación de 6″ (150 mm con sus cuellos)']]);
  assert.deepEqual(s.g.pos.get('N-008'), { x: 7750, y: 0, z: 3000 }, 'a 3 m del codo, en la rejilla de 50 mm');
  // Borrar en su nodo la quita
  assert.ok(TB.borrar(s, { tipo: 'NODO', id: 'N-008' }));
  assert.equal(s.msg, 'Se quitó la compuerta de N-008.');
  assert.equal(s.t.tramos.length, 6);
  // el balanceo pide compuerta: el botón la pone a la mitad del tramo propio, y el cálculo la cierra
  assert.ok(TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-02', { coef_entrada_K: 0 }), ''));
  const b0 = TB.informeCalculo(s).balance[0];
  assert.deepEqual([b0.accion, b0.cierre], ['COMPUERTA', null]);
  assert.ok(TB.compuertaSugerida(s, b0.corriente_menor));
  assert.match(s.msg, /^Compuerta CP-\d{3} a la mitad de TR-002: el balanceo dice cuánto cerrarla\.$/);
  const b1 = TB.informeCalculo(s).balance[0];
  assert.equal(b1.accion, 'COMPUERTA');
  assert.ok(b1.cierre && b1.cierre.K > 0.5 && b1.cierre.K < 1.2, JSON.stringify(b1.cierre));
  // si no cabe en ningún tramo propio, lo dice
  assert.equal(TB.compuertaSugerida(s, 'TR-004'), false, 'en una manguera no');
  assert.match(s.msg, /No cabe una compuerta en el tramo propio de TR-004/);
});

test('Salida: el trazo a partidas con las reglas del unifilar, guardado mientras el trazo y la yarda no cambien', () => {
  const s = nuevoTablero();
  assert.match(TB.despiece(s).error, /todavía no llega a la boca de un colector/);
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const r = TB.despiece(s);
  assert.equal(TB.despiece(s), r, 'se guarda mientras el trazo no cambie');
  assert.deepEqual([r.bom.resumen.estado, r.diferencias, r.avisos, r.lectura.metadatos.yarda_mm], ['DEFINITIVA', [], [], 914.4]);
  const r4 = TB.despiece(s, 1220);
  assert.notEqual(r4, r);
  assert.equal(r4.lectura.metadatos.yarda_mm, 1220, 'la yarda de la cotización');
  // un cambio en el trazo se vuelve a despiezar: la compuerta sale como compra
  assert.ok(TB.hacer(s, (t) => TZ.ponerCompuerta(t, M, { tramo: 'TR-002', s_mm: 3000 }), ''));
  assert.ok(TB.despiece(s).bom.accesorios.some((a) => a.tipo === 'COMPUERTA'));
  // sin caudal en una toma sí se pasa (no cambia el despiece), con su aviso; un problema de geometría lo detiene
  assert.ok(TB.hacer(s, (t) => TZ.editarPuerto(t, M, 'PU-03', { caudal_m3_h: null }), ''));
  assert.deepEqual([TB.despiece(s).bom.resumen.estado, TB.despiece(s).avisos], ['DEFINITIVA', ['La toma PU-03 (Cepillo) no tiene caudal de diseño. No cambia el despiece; el cálculo de pérdidas sí lo necesita.']]);
  assert.ok(TB.hacer(s, (t) => TZ.cambiarLargo(t, M, 'TR-005', 150), ''));
  assert.equal(TB.despiece(s).error, 'Para pasarlo a partidas, primero corrija el problema del trazo: Los accesorios del tramo TR-005 ocupan 40 mm más que su largo.');
});

test('Tapa en el tablero: la herramienta (A) en un extremo libre o en su tramo, tocarla otra vez la quita, Borrar también; su nombre', () => {
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const op = TZ.candidatas(s.t, M, { tramo: 'TR-003', s_mm: 1500 }).find((o) => o.direccion.elevacion_deg === 0);
  assert.ok(TB.hacer(s, (t) => TZ.trazar(t, M, { tramo: 'TR-003', s_mm: 1500 }, { direccion: op.direccion, largo_mm: 1500, diametro_in: 5 }), ''));
  const ext = s.t.ultimo.nodo;
  const ramal = s.t.ultimo.tramos[0];
  assert.equal(TB.tapaEn(s, { tipo: 'NODO', id: 'N-002' }), false, 'en un nodo con tres tramos, no');
  assert.equal(TB.tapaEn(s, null), false);
  assert.match(s.msg, /Toque un extremo libre del ducto/);
  assert.ok(TB.tapaEn(s, { tipo: 'TRAMO', id: ramal }), 'tocar el tramo la pone en su extremo libre');
  assert.equal(s.msg, `Tapa TA-001 en ${ext}. ${ramal} queda ciego hasta la tapa de ${ext}: no lleva aire, y ahí se junta el material.`);
  assert.deepEqual(TB.piezasDe(s, ext).map((p) => [p.id, p.corto, p.nombre]), [['TA-001', 'Tapa', 'Tapa de 5″ con cuello de 50 mm (con su brida)']]);
  assert.ok(TB.tapaEn(s, { tipo: 'NODO', id: ext }), 'tocarla otra vez la quita');
  assert.equal(s.msg, `Se quitó la tapa de ${ext}: el extremo queda abierto.`);
  assert.ok(!s.t.nodos.find((n) => n.id === ext).tapa);
  TB.deshacer(s);
  assert.ok(s.t.nodos.find((n) => n.id === ext).tapa, 'deshacer la regresa');
  assert.ok(TB.borrar(s, { tipo: 'NODO', id: ext }), 'Borrar sobre su nodo la quita (no el tramo)');
  assert.ok(s.t.tramos.some((t) => t.id === ramal) && !s.t.nodos.find((n) => n.id === ext).tapa);
  // con la tapa, la salida calcula y el ramal ciego pasa a partidas con su tapa
  assert.ok(TB.tapaEn(s, { tipo: 'NODO', id: ext }));
  assert.equal(TB.informeCalculo(s).error, undefined);
  const d = TB.despiece(s);
  assert.deepEqual([d.bom.resumen.estado, d.diferencias], ['DEFINITIVA', []]);
  assert.ok(d.bom.accesorios.some((a) => a.tipo === 'TAPA' && a.nodo_id === ext));
  assert.match(TB.AYUDA.TAPA, /extremo libre/);
});

test('Menú radial (§4.5): las piezas posibles en lo tocado, probadas contra el modelo, y lo que hace cada una', () => {
  assert.equal(TB.RADIAL_MS, 400, 'el dedo quieto 400 ms');
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const op = TZ.candidatas(s.t, M, { tramo: 'TR-003', s_mm: 1500 }).find((o) => o.direccion.elevacion_deg === 0);
  assert.ok(TB.hacer(s, (t) => TZ.trazar(t, M, { tramo: 'TR-003', s_mm: 1500 }, { direccion: op.direccion, largo_mm: 1500, diametro_in: 5 }), ''));
  const ext = s.t.ultimo.nodo;
  const ramal = s.t.ultimo.tramos[0];
  const ids = (hit) => { const r = TB.radial(s, hit); return r && r.opciones.map((o) => o.id); };
  const enExt = { tipo: 'NODO', id: ext, nodo: ext, extremo: true };
  const enRamal = { tipo: 'TRAMO', id: ramal, s_mm: 700, rigido: true };
  // probar no cambia nada: ni el trazo ni deshacer
  const t0 = s.t;
  const h0 = s.hist.length;
  assert.deepEqual(ids(enExt), ['RECTO', 'CODO', 'SUBE_BAJA', 'TAPA', 'PROPIEDADES'], 'un extremo libre: seguir recto, dar vuelta, subir o bajar, o taparlo');
  assert.deepEqual(ids(enRamal), ['INJERTO', 'REDUCCION', 'COMPUERTA', 'TAPA', 'PROPIEDADES'], 'un tramo: injertarle, reducirlo, la compuerta y la tapa de su extremo libre');
  assert.deepEqual(ids({ tipo: 'TRAMO', id: 'TR-003', s_mm: 600, rigido: true }), ['INJERTO', 'REDUCCION', 'COMPUERTA', 'PROPIEDADES'], 'el tronco no tiene extremo libre');
  assert.deepEqual(ids({ tipo: 'NODO', id: 'N-003', nodo: 'N-003' }), ['REDUCCION', 'PROPIEDADES'], 'un codo: la reducción del tramo que le llega');
  assert.deepEqual(ids({ tipo: 'NODO', id: 'N-002', nodo: 'N-002' }), ['PROPIEDADES'], 'una confluencia ocupada');
  assert.deepEqual(ids({ tipo: 'PUERTO', id: 'PU-01', nodo: 'N-001' }), ['PROPIEDADES'], 'la boca, ya conectada');
  const manguera = s.t.tramos.find((t) => t.tipo === 'FLEXIBLE');
  assert.deepEqual(ids({ tipo: 'TRAMO', id: manguera.id, rigido: false }), ['PROPIEDADES'], 'una manguera no se parte ni se reduce');
  assert.equal(TB.radial(s, { tipo: 'EQUIPO', id: 'EQ-01' }), null, 'un equipo no tiene menú');
  assert.equal(TB.radial(s, null), null);
  assert.equal(TB.radial(s, enExt).titulo, ext);
  assert.deepEqual(TB.radial(s, enExt).opciones[0], { id: 'RECTO', nombre: 'Recto', icono: 'TRAMO' });
  assert.ok(s.t === t0 && s.hist.length === h0, 'el menú sólo prueba');
  // las que trazan: empiezan el trazo con sólo sus direcciones y dejan la herramienta elegida
  assert.equal(TB.radialElegir(s, enExt, 'RECTO'), 'TRAZO');
  assert.ok(s.herr === 'TRAMO' && s.traza.ops.length === 1 && s.traza.ops[0].pieza === 'RECTO', 'recto: sólo la dirección del tramo que llega');
  assert.match(s.msg, new RegExp(`^Recto desde ${ext}, en rumbo \\d+°: arrastre hasta donde llega, o teclee el largo y Entrar\\. Esc termina\\.$`));
  teclas(s, '1');
  const f = TB.fantasma(s, 0, 0, true);
  assert.ok(f.ok && f.op.pieza === 'RECTO', 'el largo tecleado sigue recto');
  TB.cancelar(s);
  TB.cancelar(s);
  assert.equal(TB.radialElegir(s, enExt, 'CODO'), 'TRAZO');
  assert.ok(s.traza.ops.length > 1 && s.traza.ops.every((o) => o.pieza === 'CODO'), 'codo: sólo las vueltas');
  assert.match(s.msg, /^Codo desde N-\d{3} \(30°, 45°, 60°, 90°\): arrastre hacia donde sigue/);
  assert.equal(TB.radialElegir(s, enExt, 'SUBE_BAJA'), 'TRAZO');
  assert.ok(s.herr === 'VERTICAL' && s.traza.ops.every((o) => o.direccion.elevacion_deg !== 0), 'sube o baja: la herramienta vertical, sólo lo que sube o baja');
  assert.equal(TB.radialElegir(s, { tipo: 'TRAMO', id: 'TR-003', s_mm: 600, rigido: true }, 'INJERTO'), 'TRAZO');
  assert.ok(s.herr === 'INJERTO' && s.traza.ops.every((o) => o.pieza === 'INJERTO'), 'injerto desde un tramo');
  assert.match(s.msg, /^Injerto desde TR-003 a 0\.6 m de N-002 \(30°, 45°\): arrastre hacia la máquina/);
  s.traza = null;
  assert.equal(TB.radialElegir(s, { tipo: 'NODO', id: 'N-003', nodo: 'N-003' }, 'RECTO'), false, 'lo que no sale de ahí se dice');
  assert.equal(s.error, true);
  assert.equal(s.traza, null);
  // las que se ponen: con deshacer
  s.D = 8;
  assert.equal(TB.radialElegir(s, enRamal, 'REDUCCION'), 'MODELO');
  assert.match(s.msg, /el ducto queda de 4″/, 'si el Ø activo no es menor, el comercial anterior');
  TB.deshacer(s);
  assert.equal(TB.radialElegir(s, enRamal, 'COMPUERTA'), 'MODELO');
  const cp = s.t.ultimo.nodo;
  assert.match(s.msg, /^Compuerta CP-001 en N-\d{3}: abierta/);
  assert.deepEqual(ids({ tipo: 'NODO', id: cp, nodo: cp }), ['INJERTO', 'QUITAR_COMPUERTA', 'PROPIEDADES'], 'en el nodo de la compuerta: un injerto o quitarla');
  assert.equal(TB.radialElegir(s, { tipo: 'NODO', id: cp, nodo: cp }, 'QUITAR_COMPUERTA'), 'MODELO');
  assert.ok(!Object.values(s.t.piezas).some((p) => p.COMPUERTA), 'se quitó');
  assert.equal(TB.radialElegir(s, enExt, 'TAPA'), 'MODELO');
  assert.ok(s.t.nodos.find((x) => x.id === ext).tapa);
  assert.deepEqual(ids(enExt), ['RECTO', 'CODO', 'SUBE_BAJA', 'QUITAR_TAPA', 'PROPIEDADES'], 'tapado: quitar la tapa');
  assert.deepEqual(ids(enRamal), ['INJERTO', 'REDUCCION', 'COMPUERTA', 'QUITAR_TAPA', 'PROPIEDADES']);
  assert.equal(TB.radialElegir(s, enRamal, 'QUITAR_TAPA'), 'MODELO', 'desde su tramo también');
  assert.ok(!s.t.nodos.find((x) => x.id === ext).tapa);
  // propiedades: el inspector de lo tocado
  assert.equal(TB.radialElegir(s, { tipo: 'PT', id: 'PU-03', nodo: 'N-007' }, 'PROPIEDADES'), 'SEL');
  assert.deepEqual(s.sel, { tipo: 'PUERTO', id: 'PU-03' });
  assert.equal(TB.radialElegir(s, enRamal, 'PROPIEDADES'), 'SEL');
  assert.deepEqual(s.sel, { tipo: 'TRAMO', id: ramal });
  assert.equal(TB.radialElegir(s, enRamal, 'NADA'), false);
  assert.equal(TB.radialElegir(s, null, 'TAPA'), false);
  // un Ø activo que el trazo no acepta ahí (el tronco de 8″ a 3″): el comercial anterior
  const tronco = nuevoTablero();
  TB.reemplazar(tronco, TB.ejemplo(M), 'ejemplo');
  tronco.D = 3;
  assert.equal(TB.radialElegir(tronco, { tipo: 'TRAMO', id: 'TR-003', s_mm: 600, rigido: true }, 'REDUCCION'), 'MODELO');
  assert.match(tronco.msg, /el ducto queda de 7″: TR-003\. Reducción de 8″ a 7″/);
  // ya en el Ø más chico, la reducción no se ofrece
  const chico = nuevoTablero();
  TB.reemplazar(chico, TB.ejemplo(M), 'ejemplo');
  const menor = Math.min(...chico.t.politicas.diametros_comerciales_in);
  const opc = TZ.candidatas(chico.t, M, { tramo: 'TR-003', s_mm: 1500 }).find((o) => o.direccion.elevacion_deg === 0);
  assert.ok(TB.hacer(chico, (t) => TZ.trazar(t, M, { tramo: 'TR-003', s_mm: 1500 }, { direccion: opc.direccion, largo_mm: 1500, diametro_in: menor }), ''));
  assert.ok(!TB.radial(chico, { tipo: 'TRAMO', id: chico.t.ultimo.tramos[0], s_mm: 700, rigido: true }).opciones.some((o) => o.id === 'REDUCCION'), `ya de ${menor}″, no hay reducción`);
});

test('Niveles con nombre en el tablero (§2.7): RePág y AvPág se detienen en ellos, Mayús salta, el trazo que sube se ajusta a su altura y la regla los muestra', () => {
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  assert.deepEqual(TB.niveles(s), [{ nombre: 'Piso', z_mm: 0, piso: true }], 'sin niveles, el piso');
  assert.ok(TB.nombrarNivel(s, 'Nivel de ductería 4 470', 4470));
  assert.match(s.msg, /^Nivel «Nivel de ductería 4 470» a z = 4470 mm\. RePág y AvPág se detienen en él/);
  assert.ok(TB.nombrarNivel(s, '', 250), 'sin nombre, «Nivel z»');
  assert.deepEqual(TB.niveles(s).map((x) => [x.nombre, x.z_mm]), [['Piso', 0], ['Nivel 250', 250], ['Nivel de ductería 4 470', 4470]]);
  assert.equal(TB.nombrarNivel(s, 'Otro', 250), false, 'dos a la misma altura, no');
  assert.match(s.msg, /a la misma altura/);
  // los pasos de 100 mm se detienen en los niveles; con Mayús se salta al siguiente
  s.nivel = 0;
  const zs = [1, 1, 1, 1].map(() => { TB.cambiarNivel(s, 1); return s.nivel; });
  assert.deepEqual(zs, [100, 200, 250, 350], 'se detiene en los 250');
  TB.cambiarNivel(s, 1, true);
  assert.equal(s.nivel, 4470);
  assert.equal(s.msg, 'Nivel de trabajo: z = 4470 mm (Nivel de ductería 4 470).');
  assert.equal(TB.cambiarNivel(s, 1, true), false, 'arriba ya no hay');
  assert.match(s.msg, /No hay otro nivel arriba/);
  TB.cambiarNivel(s, -1, true);
  TB.cambiarNivel(s, -1, true);
  assert.equal(s.nivel, 0, 'y de bajada, al piso');
  TB.cambiarNivel(s, -1);
  assert.equal(s.nivel, 0, 'no baja del piso');
  assert.ok(TB.irANivel(s, 250) && s.nivel === 250 && s.msg === 'Nivel de trabajo: z = 250 mm (Nivel 250).');
  assert.equal(TB.irANivel(s, -1), false);
  // la regla: de abajo hacia arriba, el de trabajo marcado; un nivel de trabajo sin nombre aparece suelto; en planta, no hay
  let r = TB.reglaNiveles(s);
  assert.deepEqual(r.map((x) => [x.nombre, x.trabajo]), [['Piso', false], ['Nivel 250', true], ['Nivel de ductería 4 470', false]]);
  assert.ok(r[0].y > r[1].y && r[1].y > r[2].y, 'más alto, más arriba en la pantalla');
  s.nivel = 1200;
  r = TB.reglaNiveles(s);
  assert.deepEqual(r.filter((x) => x.trabajo).map((x) => [x.nombre, x.z_mm, x.suelto]), [['Nivel de trabajo', 1200, true]]);
  TB.ponerVista(s, 'PLANTA');
  assert.equal(TB.reglaNiveles(s), null);
  TB.ponerVista(s, 'NE');
  s.cam = { ...CAMARA };
  // el trazo que sube desde un extremo libre se ajusta a la altura del nivel (no al puntero)
  const op = TZ.candidatas(s.t, M, { tramo: 'TR-003', s_mm: 1500 }).find((o) => o.direccion.elevacion_deg === 0);
  assert.ok(TB.hacer(s, (t) => TZ.trazar(t, M, { tramo: 'TR-003', s_mm: 1500 }, { direccion: op.direccion, largo_mm: 1500, diametro_in: 5 }), ''));
  const ext = s.t.ultimo.nodo;
  const Pe = s.g.pos.get(ext);
  assert.equal(TB.radialElegir(s, { tipo: 'NODO', id: ext, nodo: ext, extremo: true }, 'SUBE_BAJA'), 'TRAZO');
  const q = TB.pantalla(s, V3(Pe.x, Pe.y, 4470 + 12));
  const f = TB.fantasma(s, q.x, q.y, false);
  assert.ok(f.ok && f.largo === 1470 && f.guia && f.guia.nivel === 'Nivel de ductería 4 470', `al nivel: ${f.largo} ${JSON.stringify(f.guia)}`);
  assert.ok(TB.confirmar(s, q.x, q.y, false));
  assert.equal(s.g.pos.get(s.t.ultimo.nodo).z, 4470, 'el extremo queda en el nivel');
  // quitar un nivel no mueve nada, y se deshace
  const antes = JSON.stringify(s.t.nodos);
  assert.ok(TB.quitarNivel(s, 'Nivel 250'));
  assert.equal(s.msg, 'Se quitó el nivel «Nivel 250»; los ductos se quedan donde están.');
  assert.equal(JSON.stringify(s.t.nodos), antes);
  assert.equal(TB.quitarNivel(s, 'Nivel 250'), false);
  TB.deshacer(s);
  assert.equal(TB.niveles(s).length, 3);
});

test('Descarga del ventilador en el tablero (§5.12): se traza desde su brida, sin ramales, sin mínimo de velocidad y con su presión en la salida', () => {
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  assert.ok(TB.hacer(s, (t) => TZ.agregarPuerto(t, M, 'EQ-01', { rol: 'SALIDA', posicion_local_mm: V3(0, 0, 4000), diametro_in: 10 }), ''));
  const a = TB.arranqueDe(s, { tipo: 'PUERTO', id: 'PU-04' });
  assert.deepEqual([a.desde, a.D, a.nombre], [s.t.equipos[0].puertos.find((p) => p.id === 'PU-04').nodo, 10, 'la descarga PU-04']);
  assert.ok(TB.empezar(s, { tipo: 'PUERTO', id: 'PU-04' }), s.msg);
  assert.deepEqual(s.traza.ops.map((o) => o.direccion), [{ azimut_deg: 0, elevacion_deg: 90 }], 'sale en la dirección de su cuello');
  // con el teclado, en cadena: «^90 2» (2 m hacia arriba, de 12″); luego «@180 3»: un rumbo después de una vertical va en horizontal
  TB.cambiarDiametroActivo(s, 2);
  assert.equal(s.D, 12);
  teclas(s, '^90 2');
  assert.ok(TB.confirmar(s), s.msg);
  const [sube] = s.t.ultimo.tramos;
  teclas(s, '@180 3');
  assert.ok(TB.confirmar(s), s.msg);
  const [sigue] = s.t.ultimo.tramos;
  TB.cancelar(s);
  assert.deepEqual([s.g.seg.get(sube).L, s.g.seg.get(sigue).L, s.g.seg.get(sigue).dir], [2000, 3000, { azimut_deg: 180, elevacion_deg: 0 }]);
  assert.match(TB.arranqueDe(s, { tipo: 'TRAMO', id: sigue, s_mm: 1500 }).error, /es de la descarga del ventilador: lleva un solo ducto hasta afuera, sin ramales/);
  // a 8.4 m/s, lenta para la succión pero no para la descarga: verde
  const info = TB.infoTramo(s, sube);
  assert.ok(info.velocidad < s.t.politicas.velocidad_min_m_s);
  assert.deepEqual([info.descarga, info.semaforo, TB.velocidadSemaforo(s, info.velocidad), TB.infoTramo(s, 'TR-003').descarga], [true, 'VERDE', 'AMBAR', false]);
  // el cálculo: la presión de la descarga se suma al ventilador; sus renglones son de la descarga
  const inf = TB.informeCalculo(s);
  const v = inf.ventiladores[0];
  assert.equal(v.descarga, 'PU-04');
  cerca(v.presion_estatica_Pa, 1863.78 + v.presion_descarga_Pa, 0.011);
  assert.deepEqual(inf.tramos.filter((x) => x.lado === 'DESCARGA').map((x) => [x.tramo, x.diametro_in]), [[sube, 12], [sigue, 12]]);
  const fc = TB.filaCalculo(s, sigue);
  assert.deepEqual([fc.lado, fc.presion_estatica_Pa], ['DESCARGA', 0]);
  assert.deepEqual(TB.filaCalculo(s, sube).locales.map((l) => l.texto), ['expansión AD-001 (K 0.088)', 'codo CO-003 (K 0.24)']);
  // y pasa a partidas, definitivo y cuadrado con el trazo
  const d = TB.despiece(s);
  assert.deepEqual([d.bom.resumen.estado, d.diferencias], ['DEFINITIVA', []]);
});

test('El ventilador elegido a la cotización (§5.13): el ventilador con su punto y su motor, comprados; su precio, del catálogo de compras o por capturar', () => {
  const C = require('../src/motor/cotizador');
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  assert.match(TB.partidasVentilador(s, 'EQ-01').error, /Elija primero el ventilador de Colector de polvo/);
  assert.match(TB.partidasVentilador(s, 'EQ-02').error, /no tiene ventilador/);
  assert.ok(TB.hacer(s, (t) => TZ.elegirVentilador(t, M, 'EQ-01', 'EJEMPLO_BANDAS'), ''));
  const r = TB.partidasVentilador(s, 'EQ-01');
  assert.deepEqual(r.partidas.map((p) => [p.familia, p.trazado_ventilador, p.trazado_pieza, p.precio_compra_unitario, p.cantidad]), [['COMPRADO', 'EQ-01', 'VENTILADOR:EJEMPLO_BANDAS', 0, 1], ['COMPRADO', 'EQ-01', 'MOTOR:3', 0, 1]]);
  assert.match(r.partidas[0].descripcion, /^Ventilador Ejemplo ilustrativo B · con bandas \(curva inventada\) para Colector de polvo: 2283 m³\/h a 1864 Pa \(2439 Pa en aire estándar\), 3001 rpm \(capture su precio\)$/);
  assert.match(r.partidas[1].descripcion, /^Motor de 3 HP para el ventilador de Colector de polvo \(si el ventilador no lo trae; capture su precio\)$/);
  assert.deepEqual(r.avisos, ['Ejemplo ilustrativo B · con bandas (curva inventada) es una curva ilustrativa, no de un fabricante.']);
  const q = C.cotizar({ partidas: r.partidas.map((p, i) => ({ id: `p${i}`, ...p })) }, M);
  assert.ok(q.partidas.every((f) => f.ok), 'se cotizan (en $0 hasta capturar su precio)');
  // con el artículo del catálogo de compras ligado al modelo, y un MOTOR_3HP en el catálogo: sus precios
  const M2 = U.clonar(M);
  M2.compras.articulos.VENT_PROV_1 = { descripcion: 'Ventilador del proveedor', unidad: 'pza', precio: 1000, iva_incluido: false, categoria: 'PROVEEDOR' };
  M2.compras.articulos.MOTOR_3HP = { descripcion: 'Motor de 3 HP', unidad: 'pza', precio: 500, iva_incluido: false, categoria: 'PROVEEDOR' };
  M2.ventiladores.modelos[1].articulo = 'VENT_PROV_1';
  TB.usarMaestros(s, M2);
  const r2 = TB.partidasVentilador(s, 'EQ-01');
  assert.deepEqual(r2.partidas.map((p) => [p.articulo_id, p.precio_compra_unitario]), [['VENT_PROV_1', undefined], ['MOTOR_3HP', undefined]]);
  assert.ok(!/capture su precio/.test(r2.partidas.map((p) => p.descripcion).join(' ')));
  // una clave que no es un artículo propio del catálogo (ni de su prototipo) no le da precio
  M2.ventiladores.modelos[1].articulo = '__proto__';
  TB.usarMaestros(s, M2);
  assert.deepEqual(TB.partidasVentilador(s, 'EQ-01').partidas[0].precio_compra_unitario, 0);
  TB.usarMaestros(s, M);
  // uno que no llega: se puede, con su aviso; uno que ya no está en el catálogo: hay que elegir otro
  assert.ok(TB.hacer(s, (t) => TZ.elegirVentilador(t, M, 'EQ-01', 'EJEMPLO_DIRECTO'), ''));
  assert.match(TB.partidasVentilador(s, 'EQ-01').avisos[0], /no llega al punto de diseño: Pide \d+ rpm/);
  assert.ok(TB.hacer(s, (t) => TZ.elegirVentilador(t, M, 'EQ-01', 'YA_NO_ESTA'), ''));
  assert.match(TB.partidasVentilador(s, 'EQ-01').error, /ya no está en el catálogo/);
});

test('La ficha de cada pieza (§5.14): qué se le cambia, la regla, por qué no se puede un ángulo, cambiarla con deshacer y su dibujo', () => {
  const C = require('../src/motor/cotizador');
  const PL = require('../src/web/planos');
  const s = nuevoTablero();
  TB.reemplazar(s, TB.ejemplo(M), 'ejemplo');
  const [codo] = TB.fichasPieza(s, 'N-003');
  assert.equal(codo.id, 'CO-001');
  assert.deepEqual(codo.campos.map((c) => c.clave), ['angulo', 'radio_D', 'gajos']);
  const ang = codo.campos[0].opciones;
  assert.deepEqual(ang.map((o) => [o.texto, o.actual]), [['30°', false], ['45°', false], ['60°', false], ['90°', true]]);
  assert.ok(ang.filter((o) => !o.actual).every((o) => /llegan a puntos fijos: no se puede girar/.test(o.motivo)), 'los dos lados del codo llegan a tomas');
  const radios = codo.campos[1].opciones;
  assert.deepEqual(radios.map((o) => o.texto), ['1 D', '1.5 D', '2 D', '2.5 D', '3 D']);
  assert.deepEqual(radios.filter((o) => o.regla || o.actual).map((o) => [o.texto, o.sub]), [['1.5 D', '229 mm']], 'la de ahora es la del proyecto');
  assert.deepEqual([codo.campos[2].valor, codo.campos[2].regla, codo.ajustada], [5, 5, false]);
  assert.deepEqual(codo.lados.map((l) => [l.etiqueta, l.tramo, l.diametro_in]), [['Entra', 'TR-001', 6], ['Sale', 'TR-002', 6]]);
  // el dibujo: la partida de la pieza se cotiza y se dibuja acotada, como en los planos de pedido
  const f = C.cotizarPartida(codo.partida, M);
  assert.deepEqual([f.geometria.detalle.n_gajos, Math.round(f.geometria.detalle.R_mm * 10) / 10], [5, 228.6]);
  assert.ok(PL.plano(f, M), 'se dibuja');
  // cambiarla: con su nombre nuevo en el mensaje, ajustada, y deshacer la regresa
  assert.ok(TB.cambiarPieza(s, 'N-003', { radio_D: 2.5 }), s.msg);
  assert.equal(s.msg, 'CO-001: Codo de 90° de 6″ (5 gajos, R 381 mm).');
  assert.ok(TB.cambiarPieza(s, 'N-003', { gajos: 4 }), s.msg);
  const aj = TB.fichasPieza(s, 'N-003')[0];
  assert.deepEqual([aj.ajustada, aj.campos[1].ajustado, aj.campos[2].ajustado, aj.campos[2].valor], [true, true, true, 4]);
  assert.deepEqual([aj.partida.k_R, aj.partida.n_gajos], [2.5, 4]);
  assert.ok(TB.cambiarPieza(s, 'N-003', { radio_D: null, gajos: null }), s.msg);
  assert.match(s.msg, /R 229 mm\) \(como en el proyecto\)\.$/);
  TB.deshacer(s);
  assert.deepEqual(s.t.nodos.find((x) => x.id === 'N-003').ajustes, { radio_D: 2.5, gajos: 4 }, 'deshacer');
  // lo que el modelo rechaza: no cambia nada y dice por qué
  assert.equal(TB.cambiarPieza(s, 'N-003', { angulo: 45 }), false);
  assert.match(s.msg, /no se puede girar/);
  // la reducción con injerto de N-002: el ángulo del ramal (30° sí: lo que cuelga del ramal gira con él)
  const [ri] = TB.fichasPieza(s, 'N-002');
  assert.deepEqual(ri.campos.map((c) => [c.clave, c.opciones.map((o) => [o.texto, o.actual, o.motivo])]), [['angulo', [['30°', false, null], ['45°', true, null]]]]);
  assert.deepEqual(ri.lados.map((l) => [l.etiqueta, l.diametro_in]), [['Entra', 6], ['Sale', 8], ['Ramal', 5]]);
  assert.ok(C.cotizarPartida(ri.partida, M).ok);
  assert.ok(TB.cambiarPieza(s, 'N-002', { angulo: 30 }), s.msg);
  assert.match(s.msg, /^RI-001: Reducción con injerto a 30° de 8″ a 6″, ramal de 5″, de lado\.$/);
  // una reducción horizontal: forma (la regla con punto) y largo, con su mínimo
  s.D = 5;
  assert.ok(TB.reducirEn(s, { tipo: 'TRAMO', id: 'TR-002', s_mm: 3000 }), s.msg);
  const nr = s.t.nodos.find((x) => (s.g.piezasDe.get(x.id) || []).some((p) => p.tipo === 'REDUCCION' && p.horizontal));
  assert.ok(nr, 'hay una reducción horizontal');
  const [red] = TB.fichasPieza(s, nr.id);
  assert.deepEqual(red.campos.map((c) => c.clave), ['forma', 'largo_reduccion_mm']);
  assert.deepEqual(red.campos[0].opciones.map((o) => [o.texto, o.actual, o.regla, o.motivo]), [['Concéntrica', false, false, null], ['Excéntrica, plana abajo', true, true, null], ['Excéntrica, plana arriba', false, false, null]]);
  assert.equal(red.campos[1].valor, red.campos[1].regla);
  assert.ok(TB.cambiarPieza(s, nr.id, { largo_reduccion_mm: 250 }), s.msg);
  assert.match(s.msg, /Reducción excéntrica, plana abajo de 6″ a 5″, de 250 mm\.$/);
  assert.equal(TB.cambiarPieza(s, nr.id, { largo_reduccion_mm: 10 }), false);
  assert.match(s.msg, /mide al menos \d+ mm/);
});
