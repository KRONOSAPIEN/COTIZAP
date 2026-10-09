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
const sinResultados = JSON.stringify({ ...EJ, resultados: null });
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
  assert.equal(JSON.stringify(TZ.aSistema(TB.ejemplo(M), M)), sinResultados);
});

test('El recorrido de §1.6 jugado en el tablero (pantalla, teclas, tiradores e imán) da exactamente el ejemplo', () => {
  const s = trazarEjemplo(equiposJugados());
  assert.ok(TB.hacer(s, (t) => TZ.aplicarDimensiones(t, M), ''));
  assert.match(s.msg, /TR-005: 6″ → 8″, 33\.5 → 18\.8 m\/s\. Reducción con injerto a 45° en N-007 \(RI-001\)/);
  assert.ok(TB.hacer(s, (t) => TZ.renumerar(t, M), ''));
  assert.equal(JSON.stringify(TZ.aSistema(s.t, M)), sinResultados);
  assert.ok(TB.fases(s).every((f) => f.pendientes === 0), 'sin pendientes en ninguna fase');
  const ex = TB.exportar(s);
  assert.equal(ex.texto, JSON.stringify(TZ.aSistema(s.t, M), null, 2));
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
  assert.ok(TB.importar(s, sinResultados));
  assert.equal(JSON.stringify(TZ.aSistema(s.t, M)), sinResultados);
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
