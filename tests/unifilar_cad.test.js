/**
 * El dibujo del unifilar (src/motor/unifilar_cad.js): el árbol desde el colector, las reglas del taller al trazar (codos,
 * injertos, diámetros, equipos), la edición (largos, ángulos, reducciones, borrar), la revisión, lo guardado y la lectura que
 * pasa a las reglas del unifilar. La prueba central: dibujar el croquis de ejemplo da las mismas partidas que leerlo.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const UF = require('../src/motor/unifilar');
const CAD = require('../src/motor/unifilar_cad');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');

const M = crearMaestros();
const clonar = (x) => JSON.parse(JSON.stringify(x));
const congelar = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') congelar(v); }); return Object.freeze(o); };
const falla = (fn, re) => assert.throws(fn, (e) => e instanceof CAD.CadError && re.test(e.message), `debía fallar con ${re}`);
const H = (az, largo_mm, D_in) => ({ dir: 'H', az_deg: az, largo_mm, D_in });
const V = (dir, largo_mm, D_in) => ({ dir, largo_mm, D_in });
/** Un dibujo hecho con una lista de pasos: [desde (nodo o '<' = el último punto), tramo]. Devuelve el modelo y los puntos. */
function dibujar(pasos, m0) {
  let m = m0 || CAD.nuevo(M);
  let ultimo = 'N-001';
  const puntos = ['N-001'];
  pasos.forEach(([desde, x]) => {
    const r = CAD.agregarTramo(m, M, desde === '<' ? ultimo : desde, x);
    m = r.modelo;
    ultimo = r.nodo;
    puntos.push(r.nodo);
  });
  return { m, puntos, ultimo };
}
const despiece = (m, extra) => {
  const { lectura, respuestas } = CAD.aLectura(m, M, { fecha: '2026-10-09T00:00:00Z' });
  return UF.despiezar(lectura, M, { ...respuestas, ...(extra || {}) });
};
const pendientes = (bom) => bom.alertas_ambiguedad.filter((a) => !a.resuelta && a.severidad !== 'INFO').map((a) => a.codigo);
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), `${a} ≈ ${b}`);

test('nuevo: sólo el colector, con una boca y en el origen; la revisión pide el primer tramo', () => {
  const m = CAD.nuevo(M);
  assert.deepEqual(m.tramos, []);
  assert.deepEqual(m.equipos, [{ id: 'EQ-01', clase: 'COLECTOR', nombre: 'Colector', nodo: 'N-001', boca_in: null, manguera_tramos: null }]);
  assert.equal(m.material, 'GALVANIZADO');
  assert.equal(m.calibre, 22);
  assert.deepEqual(CAD.revisar(m, M).errores.map((e) => e.codigo), ['SIN_TRAMOS']);
  const { opciones } = CAD.salidas(m, M, 'N-001');
  assert.equal(opciones.filter((o) => o.dir === 'H').length, 360 / CAD.PASO_RUMBO);
  assert.ok(opciones.every((o) => o.pieza === 'INICIO'));
  assert.deepEqual(opciones.filter((o) => o.dir !== 'H').map((o) => o.dir), ['SUBE', 'BAJA']);
  assert.equal(CAD.nuevo(M, { material: 'INOX_304', calibre: 18 }).material, 'INOX_304');
  assert.equal(CAD.nuevo(M, { material: 'NO_EXISTE', calibre: 99 }).calibre, 22);
});

test('agregarTramo: posiciones exactas desde el colector, identificadores consecutivos y la pieza que se forma', () => {
  const { m, puntos } = dibujar([['N-001', V('SUBE', 3000, 12)], ['<', H(0, 4500, 12)], ['<', H(90, 2000, 12)], ['<', H(135, 1000, 10)]]);
  const g = CAD.geometria(m);
  assert.deepEqual(puntos, ['N-001', 'N-002', 'N-003', 'N-004', 'N-005']);
  assert.deepEqual(g.pos.get('N-002'), { x: 0, y: 0, z: 3000 });
  assert.deepEqual(g.pos.get('N-003'), { x: 4500, y: 0, z: 3000 });
  assert.deepEqual(g.pos.get('N-004'), { x: 4500, y: 2000, z: 3000 });
  cerca(g.pos.get('N-005').x, 4500 - 1000 / Math.SQRT2, 1e-5);
  cerca(g.pos.get('N-005').y, 2000 + 1000 / Math.SQRT2, 1e-5);
  assert.deepEqual(m.tramos.map((t) => t.id), ['A-001', 'A-002', 'A-003', 'A-004']);
  assert.deepEqual(g.orden, ['N-001', 'N-002', 'N-003', 'N-004', 'N-005']);
  const r = CAD.agregarTramo(m, M, 'N-005', H(135, 1000, 10));
  assert.equal(r.pieza, 'RECTO');
  assert.equal(CAD.agregarTramo(m, M, 'N-005', H(165, 1000, 10)).pieza, 'CODO');
});

test('codos: sólo los ángulos del taller (proceso.angulos_codo_deg), a los dos lados; lo demás se rechaza diciendo qué se puede', () => {
  const { m, ultimo } = dibujar([['N-001', H(0, 3000, 10)]]);
  M.proceso.angulos_codo_deg.forEach((a) => ['IZQ', 'DER'].forEach((lado) => {
    const r = CAD.agregarTramo(m, M, ultimo, H(lado === 'IZQ' ? a : 360 - a, 2000, 10));
    assert.equal(r.pieza, 'CODO');
    const g = CAD.geometria(r.modelo);
    assert.deepEqual(CAD.giro(g.entra.get(ultimo), r.modelo.tramos.find((t) => t.id === r.tramo)), { grados: a, lado, plano: 'H' });
  }));
  [15, 75, 105, 120, 135, 150, 180, 345].forEach((az) => falla(() => CAD.agregarTramo(m, M, ultimo, H(az, 2000, 10)), /seguir recto, dar vuelta a 30°, 45°, 60° o 90°, subir o bajar/));
  // la política sale de las tablas maestras: con codos sólo a 45° y 90°, el de 30° ya no se puede
  const M2 = clonar(M);
  M2.proceso.angulos_codo_deg = [45, 90];
  falla(() => CAD.agregarTramo(m, M2, ultimo, H(30, 2000, 10)), /dar vuelta a 45° o 90°/);
  assert.equal(CAD.agregarTramo(m, M2, ultimo, H(45, 2000, 10)).pieza, 'CODO');
});

test('verticales: sube o baja con codo de 90°; vertical sobre vertical sigue o reduce; no da media vuelta; de una vertical sale a cualquier rumbo', () => {
  const { m, ultimo } = dibujar([['N-001', H(0, 3000, 12)], ['<', V('SUBE', 2000, 12)]]);
  const g = CAD.geometria(m);
  assert.deepEqual(CAD.giro(g.entra.get('N-002'), m.tramos[1]), { grados: 90, lado: null, plano: 'V' });
  falla(() => CAD.agregarTramo(m, M, ultimo, V('BAJA', 1000, 12)), /salir en horizontal a cualquier rumbo \(codo de 90°\) o subir/);
  const sigue = CAD.agregarTramo(m, M, ultimo, V('SUBE', 1000, 12));
  assert.equal(sigue.modelo.tramos.length, 2, 'vertical recta del mismo Ø: un solo tramo');
  assert.equal(sigue.modelo.tramos[1].largo_mm, 3000);
  const reduce = CAD.agregarTramo(m, M, ultimo, V('SUBE', 1000, 10));
  assert.equal(reduce.modelo.tramos.length, 3);
  const opciones = CAD.salidas(m, M, ultimo).opciones.filter((o) => o.dir === 'H');
  assert.equal(opciones.length, 24);
  assert.ok(opciones.every((o) => o.pieza === 'CODO' && o.giro_deg === 90));
  // en la lectura: la vertical es el eje Z y su tramo recto va vertical
  const bom = despiece(reduce.modelo);
  assert.equal(bom.red.aristas.find((a) => a.id === 'A-002').eje_iso, 'Z');
  assert.equal(bom.ductos_rectos.find((d) => d.arista_id === 'A-002').posicion, 'VERTICAL');
  assert.equal(bom.ductos_rectos.find((d) => d.arista_id === 'A-001').posicion, 'HORIZONTAL');
});

test('fusionar: recto y del mismo Ø se alarga el tramo (sin nodo intermedio); con otro Ø queda la reducción; nunca pasa de 100 m', () => {
  const a = dibujar([['N-001', H(30, 3000, 12)], ['<', H(30, 2000, 12)]]);
  assert.equal(a.m.tramos.length, 1);
  assert.equal(a.m.tramos[0].id, 'A-001');
  assert.equal(a.m.tramos[0].largo_mm, 5000);
  assert.equal(a.m.tramos[0].a, a.ultimo);
  assert.equal(CAD.geometria(a.m).pos.has('N-002'), false);
  const b = dibujar([['N-001', H(30, 3000, 12)], ['<', H(30, 2000, 10)]]);
  assert.equal(b.m.tramos.length, 2);
  const c = dibujar([['N-001', H(0, 60000, 12)], ['<', H(0, 60000, 12)]]);
  assert.equal(c.m.tramos.length, 2, 'dos de 60 m no se juntan: el motor cotiza hasta 100 m por partida');
  assert.equal(pendientes(despiece(c.m)).includes('ACCESORIOS_ENCIMADOS'), false);
});

test('el colector tiene una boca; un equipo es el final de su ramal; los equipos van en los extremos, se numeran y se reemplazan', () => {
  const { m, ultimo } = dibujar([['N-001', H(0, 3000, 10)]]);
  assert.match(CAD.salidas(m, M, 'N-001').motivo, /una sola boca/);
  falla(() => CAD.agregarTramo(m, M, 'N-001', H(90, 1000, 10)), /una sola boca/);
  falla(() => CAD.ponerEquipo(m, 'N-001', 'CAMPANA'), /colector/);
  falla(() => CAD.ponerEquipo(m, ultimo, 'COLECTOR'), /colector es uno/);
  falla(() => CAD.ponerEquipo(m, ultimo, 'TURBINA'), /no se puede poner/);
  let r = CAD.ponerEquipo(m, ultimo, 'MAQUINA_MANGUERA');
  assert.deepEqual(r.modelo.equipos[1], { id: 'EQ-02', clase: 'MAQUINA_MANGUERA', nombre: 'Máquina 1', nodo: ultimo, boca_in: null, manguera_tramos: 1 });
  falla(() => CAD.agregarTramo(r.modelo, M, ultimo, H(0, 1000, 10)), /«Máquina 1» es el final de su ramal/);
  assert.equal(CAD.ponerEquipo(r.modelo, ultimo, 'MAQUINA_MANGUERA').modelo.equipos.length, 2, 'el mismo equipo: no cambia');
  r = CAD.ponerEquipo(r.modelo, ultimo, 'CAMPANA');
  assert.deepEqual(r.modelo.equipos.map((e) => [e.id, e.clase, e.nombre]), [['EQ-01', 'COLECTOR', 'Colector'], ['EQ-03', 'CAMPANA', 'Campana 1']]);
  const conRamal = CAD.injertar(r.modelo, M, 'A-001', 1500, { az_deg: 45, largo_mm: 1000, D_in: 6 });
  falla(() => CAD.ponerEquipo(conRamal.modelo, conRamal.nodo, 'CAMPANA'), /no es un extremo/);
  const dos = CAD.ponerEquipo(conRamal.modelo, conRamal.extremo, 'CAMPANA');
  assert.equal(dos.modelo.equipos.find((e) => e.id === dos.equipo).nombre, 'Campana 2');
  falla(() => CAD.quitarEquipo(dos.modelo, 'N-001'), /colector no se quita/);
  falla(() => CAD.quitarEquipo(dos.modelo, conRamal.nodo), /no hay equipo/);
  assert.equal(CAD.quitarEquipo(dos.modelo, conRamal.extremo).equipos.length, 2);
});

test('editarEquipo: nombre, boca (sólo colector y máquina con brida) y tramos de manguera (sólo con manguera), con sus límites', () => {
  const { m, ultimo } = dibujar([['N-001', H(0, 3000, 10)]]);
  const conMaq = CAD.ponerEquipo(m, ultimo, 'MAQUINA_MANGUERA').modelo;
  assert.equal(CAD.editarEquipo(conMaq, 'EQ-02', { nombre: '  Sierra  ' }).equipos[1].nombre, 'Sierra');
  falla(() => CAD.editarEquipo(conMaq, 'EQ-02', { nombre: '   ' }), /de 1 a 60 letras/);
  falla(() => CAD.editarEquipo(conMaq, 'EQ-02', { nombre: 'x'.repeat(61) }), /de 1 a 60 letras/);
  assert.equal(CAD.editarEquipo(conMaq, 'EQ-02', { manguera_tramos: 3 }).equipos[1].manguera_tramos, 3);
  assert.equal(CAD.editarEquipo(conMaq, 'EQ-02', { manguera_tramos: null }).equipos[1].manguera_tramos, null);
  [0, 1.5, 51, 'dos'].forEach((k) => falla(() => CAD.editarEquipo(conMaq, 'EQ-02', { manguera_tramos: k }), /de 1 a 50/));
  falla(() => CAD.editarEquipo(conMaq, 'EQ-02', { boca_in: 10 }), /Sólo el colector y las máquinas con brida/);
  assert.equal(CAD.editarEquipo(conMaq, 'EQ-01', { boca_in: 12 }).equipos[0].boca_in, 12);
  falla(() => CAD.editarEquipo(conMaq, 'EQ-01', { boca_in: -1 }), /mayor que cero/);
  falla(() => CAD.editarEquipo(conMaq, 'EQ-01', { manguera_tramos: 1 }), /Sólo las máquinas con manguera/);
  falla(() => CAD.editarEquipo(conMaq, 'EQ-99', { nombre: 'x' }), /No existe el equipo/);
});

test('injertos: a la mitad de un tramo horizontal, a proceso.angulos_injerto_deg a los dos lados, nunca mayores que su tronco', () => {
  const { m } = dibujar([['N-001', H(0, 6000, 12)]]);
  M.proceso.angulos_injerto_deg.forEach((b) => [b, 360 - b].forEach((az) => {
    const r = CAD.injertar(m, M, 'A-001', 2500, { az_deg: az, largo_mm: 1500, D_in: 6 });
    const g = CAD.geometria(r.modelo);
    assert.deepEqual(g.pos.get(r.nodo), { x: 2500, y: 0, z: 0 });
    assert.equal(g.tronco(r.nodo).largo_mm, 3500);
    assert.equal(CAD.angulos(r.modelo).get(r.nodo), b);
  }));
  [60, 90, 300, 0, 180].forEach((az) => falla(() => CAD.injertar(m, M, 'A-001', 2500, { az_deg: az, largo_mm: 1500, D_in: 6 }), /30° o 45° del tronco, a favor del flujo/));
  falla(() => CAD.injertar(m, M, 'A-001', 2500, { az_deg: 45, largo_mm: 1500, D_in: 14 }), /no puede ser mayor que su tronco/);
  falla(() => CAD.injertar(m, M, 'A-001', 50, { az_deg: 45, largo_mm: 1500, D_in: 6 }), /0\.1 m o más de los extremos/);
  falla(() => CAD.injertar(m, M, 'A-001', 5950, { az_deg: 45, largo_mm: 1500, D_in: 6 }), /de 0\.1 m a 5\.9 m desde su inicio/);
  falla(() => CAD.injertar(m, M, 'A-099', 2500, { az_deg: 45, largo_mm: 1500, D_in: 6 }), /No existe el tramo/);
  const sube = dibujar([['N-001', V('SUBE', 3000, 12)]]).m;
  falla(() => CAD.injertar(sube, M, 'A-001', 1500, { az_deg: 45, largo_mm: 1500, D_in: 6 }), /es vertical: sólo se injerta en tramos horizontales/);
});

test('derivar desde un punto: donde el tronco sigue recto sale un injerto; un codo de 30° o 45° puede quedar como injerto; en otros codos no', () => {
  const recto = dibujar([['N-001', H(0, 3000, 12)], ['<', H(0, 3000, 10)]]);
  const ops = CAD.salidas(recto.m, M, 'N-002').opciones;
  assert.deepEqual(ops.map((o) => [o.az_deg, o.pieza, o.giro_deg, o.lado]), [[30, 'INJERTO', 30, 'IZQ'], [330, 'INJERTO', 30, 'DER'], [45, 'INJERTO', 45, 'IZQ'], [315, 'INJERTO', 45, 'DER']]);
  falla(() => CAD.agregarTramo(recto.m, M, 'N-002', H(45, 1000, 12)), /no puede ser mayor que su tronco: el tronco A-002 es de 10″/);
  const rinj = CAD.agregarTramo(recto.m, M, 'N-002', H(45, 1000, 8));
  const bom = despiece(rinj.modelo);
  assert.deepEqual(bom.accesorios.map((a) => [a.tipo, a.nodo_id, a.diametro_entrada_in, a.diametro_salida_in, a.d_ramal_in, a.angulo.valor]), [['REDUCCION_INJERTO', 'N-002', 12, 10, 8, 45]]);
  const codo45 = dibujar([['N-001', H(0, 3000, 12)], ['<', H(45, 3000, 8)]]);
  assert.deepEqual(CAD.salidas(codo45.m, M, 'N-002').opciones.map((o) => o.pieza), ['TRONCO']);
  falla(() => CAD.agregarTramo(codo45.m, M, 'N-002', H(30, 1000, 6)), /hay un codo de 45°: sólo se puede seguir recto, y lo que sale a 45° queda como injerto/);
  falla(() => CAD.agregarTramo(codo45.m, M, 'N-002', H(0, 1000, 6)), /quedaría como injerto de un tronco de 6″/);
  const tronco = CAD.agregarTramo(codo45.m, M, 'N-002', H(0, 3000, 10));
  assert.equal(tronco.pieza, 'TRONCO');
  assert.deepEqual(despiece(tronco.modelo).accesorios.map((a) => [a.tipo, a.d_ramal_in, a.angulo.valor]), [['REDUCCION_INJERTO', 8, 45]]);
  const codo90 = dibujar([['N-001', H(0, 3000, 12)], ['<', H(90, 3000, 8)]]);
  assert.match(CAD.salidas(codo90.m, M, 'N-002').motivo, /codo de 90°: no se injerta en un codo/);
  const vert = dibujar([['N-001', H(0, 3000, 12)], ['<', V('BAJA', 3000, 8)]]);
  assert.match(CAD.salidas(vert.m, M, 'N-002').motivo, /sólo se injerta en tramos horizontales/);
  const dos = CAD.injertar(recto.m, M, 'A-001', 1500, { az_deg: 45, largo_mm: 1000, D_in: 6 });
  assert.match(CAD.salidas(dos.modelo, M, dos.nodo).motivo, /ya hay un injerto/);
});

test('diámetros: alejándose del colector no crecen; reducir uno reduce lo que sigue y el ramal que quedaría mayor que su tronco', () => {
  let { m } = dibujar([['N-001', H(0, 8000, 12)]]);
  falla(() => CAD.agregarTramo(m, M, 'N-002', H(0, 1000, 14)), /el diámetro no crece: el tramo A-001 es de 12″/);
  m = CAD.injertar(m, M, 'A-001', 3000, { az_deg: 45, largo_mm: 2000, D_in: 10 }).modelo; // A-001 (3 m) · A-002 (5 m) · ramal A-003
  m = CAD.agregarTramo(m, M, 'N-004', H(90, 1500, 10)).modelo; // codo en el ramal: A-004
  falla(() => CAD.cambiarDiametro(m, M, 'A-003', 14), /no puede ser mayor que su tronco: el tronco A-002 es de 12″/);
  falla(() => CAD.cambiarDiametro(m, M, 'A-004', 12), /no crece: el tramo A-003 es de 10″/);
  falla(() => CAD.cambiarDiametro(m, M, 'A-001', 13), /debe ser comercial/);
  const r = CAD.cambiarDiametro(m, M, 'A-002', 8);
  assert.deepEqual(r.cambiados.sort(), ['A-003', 'A-004']);
  assert.deepEqual(r.modelo.tramos.map((t) => [t.id, t.D_in]), [['A-001', 12], ['A-002', 8], ['A-003', 8], ['A-004', 8]]);
  assert.deepEqual(CAD.revisar(r.modelo, M).errores, []);
  // un ramal puede ser del tamaño de su tronco (silleta), y al quedar igual que el anterior el tronco se vuelve a juntar
  const igual = CAD.cambiarDiametro(r.modelo, M, 'A-002', 12);
  assert.deepEqual(igual.modelo.tramos.map((t) => [t.id, t.D_in]), [['A-001', 12], ['A-002', 12], ['A-003', 8], ['A-004', 8]]);
  const borrado = CAD.borrarTramo(igual.modelo, 'A-003');
  assert.deepEqual(borrado.modelo.tramos.map((t) => [t.id, t.largo_mm]), [['A-001', 8000]], 'sin el ramal, el tronco vuelve a ser uno');
});

test('reducir a la mitad de un tramo: parte el tramo y reduce de ahí en adelante; sólo a un Ø menor y lejos de los extremos', () => {
  const { m } = dibujar([['N-001', H(0, 6000, 12)], ['<', H(90, 2000, 12)]]);
  const r = CAD.reducir(m, M, 'A-001', 4000, 10);
  assert.deepEqual(r.modelo.tramos.map((t) => [t.id, t.D_in, t.largo_mm]), [['A-001', 12, 4000], ['A-003', 10, 2000], ['A-002', 10, 2000]]);
  assert.deepEqual(r.cambiados, ['A-002']);
  assert.equal(r.nodo, 'N-004');
  const bom = despiece(r.modelo);
  assert.deepEqual(bom.accesorios.map((a) => [a.tipo, a.nodo_id]), [['REDUCCION', 'N-004'], ['CODO', 'N-002']]);
  assert.match(bom.alertas_ambiguedad.find((a) => a.codigo === 'TRANSICION_INSERTADA').mensaje, /El diámetro cambia de 12″ a 10″ en N-004/);
  falla(() => CAD.reducir(m, M, 'A-001', 4000, 12), /menor que el del tramo/);
  falla(() => CAD.reducir(m, M, 'A-001', 4000, 14), /menor que el del tramo/);
  falla(() => CAD.reducir(m, M, 'A-001', 5950, 10), /0\.1 m o más de los extremos/);
});

test('cambiarLargo mueve lo que está más allá; cambiarAngulo gira la rama y respeta los ángulos del taller', () => {
  const { m, puntos } = dibujar([['N-001', H(0, 3000, 12)], ['<', H(45, 2000, 12)], ['<', H(45, 1000, 12)]]);
  assert.deepEqual(m.tramos.map((t) => [t.id, t.largo_mm, t.a]), [['A-001', 3000, 'N-002'], ['A-002', 3000, 'N-004']], 'el tercer trazo alargó el segundo');
  assert.equal(puntos[3], 'N-004');
  const largo = CAD.cambiarLargo(m, 'A-001', 5000);
  const g = CAD.geometria(largo);
  cerca(g.pos.get('N-004').x, 5000 + 3000 / Math.SQRT2, 1e-5);
  cerca(g.pos.get('N-004').y, 3000 / Math.SQRT2, 1e-5);
  falla(() => CAD.cambiarLargo(m, 'A-001', 50), /de 0\.1 m a 100 m/);
  falla(() => CAD.cambiarLargo(m, 'A-001', 100001), /de 0\.1 m a 100 m/);
  const a90 = CAD.cambiarAngulo(m, M, 'N-002', 90);
  assert.deepEqual(a90.tramos.map((t) => t.az_deg), [0, 90], 'la rama entera giró con el codo');
  assert.deepEqual(CAD.cambiarAngulo(m, M, 'N-002', 60, 'DER').tramos.map((t) => t.az_deg), [0, 300]);
  const recto = CAD.cambiarAngulo(m, M, 'N-002', 0);
  assert.deepEqual(recto.tramos.map((t) => [t.id, t.largo_mm, t.az_deg]), [['A-001', 6000, 0]], 'recto y del mismo Ø: un solo tramo');
  falla(() => CAD.cambiarAngulo(m, M, 'N-002', 75), /codos a 30°, 45°, 60° o 90°/);
  falla(() => CAD.cambiarAngulo(m, M, 'N-001', 45), /no hay codo ni injerto/);
  const vert = dibujar([['N-001', H(0, 3000, 12)], ['<', V('SUBE', 2000, 12)]]).m;
  falla(() => CAD.cambiarAngulo(vert, M, 'N-002', 45), /siempre es de 90°/);
  const inj = CAD.injertar(m, M, 'A-001', 1500, { az_deg: 45, largo_mm: 2000, D_in: 6 });
  const inj2 = CAD.agregarTramo(inj.modelo, M, inj.extremo, H(0, 1000, 6)).modelo;
  const a30 = CAD.cambiarAngulo(inj2, M, inj.nodo, 30, 'DER');
  assert.deepEqual(a30.tramos.filter((t) => t.D_in === 6).map((t) => t.az_deg), [330, 285], 'el ramal y lo que sigue giraron 75°');
  falla(() => CAD.cambiarAngulo(inj2, M, inj.nodo, 60), /sólo hace injertos a 30° o 45°/);
});

test('borrarTramo quita la rama con sus equipos; las operaciones no cambian el modelo que reciben', () => {
  const base = congelar(CAD.dibujoEjemplo(M));
  const antes = JSON.stringify(base);
  const r = CAD.borrarTramo(base, 'A-003');
  assert.equal(r.tramos, 5, 'A-003 y lo que sigue: A-007, A-008, A-005 y A-006');
  assert.equal(r.equipos, 2);
  assert.deepEqual(r.modelo.tramos.map((t) => t.id), ['A-001', 'A-002', 'A-004']);
  assert.deepEqual(r.modelo.equipos.map((e) => e.nombre), ['Colector', 'Máquina 1']);
  // todas las operaciones son puras
  CAD.agregarTramo(base, M, 'N-004', H(45, 1000, 8));
  CAD.injertar(base, M, 'A-003', 1000, { az_deg: 45, largo_mm: 1000, D_in: 5 });
  CAD.reducir(base, M, 'A-002', 1000, 10);
  CAD.cambiarDiametro(base, M, 'A-003', 8);
  CAD.cambiarLargo(base, 'A-001', 2000);
  CAD.cambiarAngulo(base, M, 'N-006', 90);
  CAD.ponerEquipo(CAD.quitarEquipo(base, 'N-007'), 'N-007', 'ABIERTO');
  CAD.editarEquipo(base, 'EQ-01', { boca_in: 10 });
  CAD.cambiarMaterial(base, M, 'INOX_304', 18);
  CAD.aplicarRespuestas(base, M, { metadatos: { calibre: 20 } });
  CAD.aLectura(base, M, {});
  CAD.revisar(base, M);
  assert.equal(JSON.stringify(base), antes);
  falla(() => CAD.borrarTramo(base, 'A-099'), /No existe el tramo/);
});

test('revisar: extremos sin equipo, ductos que se cruzan y, en un dibujo de fuera, giros, injertos y diámetros fuera de las reglas', () => {
  let { m } = dibujar([['N-001', H(0, 10000, 12)]]);
  const inj = CAD.injertar(m, M, 'A-001', 2000, { az_deg: 45, largo_mm: 3000, D_in: 8 });
  m = CAD.agregarTramo(inj.modelo, M, inj.extremo, H(315, 6000, 8)).modelo; // vuelve y atraviesa el tronco
  const rev = CAD.revisar(m, M);
  assert.deepEqual(rev.errores, []);
  const choque = rev.avisos.find((x) => x.codigo === 'CHOQUE');
  assert.ok(choque, 'el ramal cruza el tronco');
  assert.deepEqual(choque.refs.sort(), ['A-002', 'A-004']);
  assert.match(choque.mensaje, /se cruzan: sus ejes pasan a 0 mm y necesitan 254 mm/);
  assert.equal(rev.avisos.filter((x) => x.codigo === 'EXTREMO_SIN_EQUIPO').length, 2);
  // el cruce a otra altura no choca: bajar el ramal 1 m antes de volver
  let n = CAD.agregarTramo(inj.modelo, M, inj.extremo, V('BAJA', 1000, 8));
  n = CAD.agregarTramo(n.modelo, M, n.nodo, H(315, 6000, 8));
  assert.equal(CAD.revisar(n.modelo, M).avisos.some((x) => x.codigo === 'CHOQUE'), false);
  // un dibujo de fuera (estructura válida) con las reglas rotas
  const crudo = clonar(CAD.dibujoEjemplo(M));
  crudo.tramos.find((t) => t.id === 'A-006').az_deg = 75; // codo de 75°
  crudo.tramos.find((t) => t.id === 'A-008').az_deg = 90; // injerto a 90°
  crudo.tramos.find((t) => t.id === 'A-005').D_in = 10; crudo.tramos.find((t) => t.id === 'A-006').D_in = 12; // crece
  const v = CAD.validar(crudo, M);
  assert.deepEqual(v.errores, []);
  const codigos = CAD.revisar(v.modelo, M).errores.map((e) => e.codigo);
  assert.deepEqual(codigos.sort(), ['DIAMETRO_CRECE', 'GIRO_NO_PERMITIDO', 'INJERTO_NO_PERMITIDO']);
  const cruce = clonar(CAD.dibujoEjemplo(M));
  cruce.tramos.push({ id: 'A-020', de: 'N-008', a: 'N-020', D_in: 5, largo_mm: 1000, dir: 'H', az_deg: 315, encimado: null, corto: false });
  cruce.tramos.push({ id: 'A-021', de: 'N-001', a: 'N-021', D_in: 5, largo_mm: 1000, dir: 'BAJA', az_deg: 0, encimado: null, corto: false });
  const rc = CAD.revisar(CAD.validar(cruce, M).modelo, M).errores.map((e) => e.codigo);
  assert.ok(rc.includes('CRUCE') && rc.includes('COLECTOR_UNA_BOCA'));
  const mayor = clonar(CAD.dibujoEjemplo(M));
  mayor.tramos.find((t) => t.id === 'A-008').D_in = 12;
  assert.ok(CAD.revisar(CAD.validar(mayor, M).modelo, M).errores.some((e) => e.codigo === 'INJERTO_MAYOR'));
});

test('validar: lo guardado vuelve igual; se rechaza lo que no es un árbol desde el colector y se sanea lo demás', () => {
  const m = CAD.dibujoEjemplo(M);
  assert.deepEqual(CAD.validar(clonar(m), M), { modelo: m, errores: [] });
  const malo = (cambio, re) => {
    const x = clonar(m);
    cambio(x);
    const v = CAD.validar(x, M);
    assert.equal(v.modelo, null);
    assert.ok(v.errores.some((e) => re.test(e)), `${v.errores.join(' | ')} debía decir ${re}`);
  };
  assert.deepEqual(CAD.validar(null, M).modelo, null);
  malo((x) => { x.version = 2; }, /no es un dibujo de unifilar de esta versión/i);
  malo((x) => { x.tramos[0].id = 'X1'; }, /identificador válido/);
  malo((x) => { x.tramos[1].id = x.tramos[0].id; }, /identificador válido/);
  malo((x) => { x.tramos[0].D_in = 13; }, /diámetro comercial/);
  malo((x) => { x.tramos[0].largo_mm = 0; }, /largo válido/);
  malo((x) => { x.tramos[0].dir = 'DIAGONAL'; }, /dirección/);
  malo((x) => { x.tramos[1].az_deg = 10; }, /múltiplo de 15°/);
  malo((x) => { x.tramos[1].de = 'N-099'; }, /no se conecta con el colector/);
  malo((x) => { x.tramos[3].a = x.tramos[1].a; }, /llega más de un tramo/);
  malo((x) => { x.tramos[0].a = 'N-001'; }, /no une dos nodos válidos/);
  malo((x) => { x.equipos = x.equipos.filter((e) => e.clase !== 'COLECTOR'); }, /debe tener un colector/);
  malo((x) => { x.equipos.push({ ...x.equipos[0], id: 'EQ-09', nodo: 'N-002' }); }, /debe tener un colector/);
  malo((x) => { x.equipos[1].nodo = 'N-003'; }, /no está en un extremo/);
  malo((x) => { x.equipos[1].nodo = x.equipos[2].nodo; }, /no está en un nodo válido/);
  malo((x) => { x.equipos[1].clase = 'TURBINA'; }, /clase conocida/);
  malo((x) => { x.tramos = Array.from({ length: 501 }, () => x.tramos[0]); }, /demasiado grande/);
  // lo que se sanea: nombre, boca y mangueras fuera de su clase, material y calibre, contadores
  const x = clonar(m);
  x.equipos[1].nombre = '';
  x.equipos[1].boca_in = 10;
  x.equipos[3].manguera_tramos = 4;
  x.equipos[2].manguera_tramos = 0;
  x.material = 'PLASTICO';
  x.calibre = 7;
  x.cuenta = { N: 1, A: 1, EQ: 1 };
  x.colector = { x: 'a', y: 1e9, z: 5 };
  const v = CAD.validar(x, M).modelo;
  assert.equal(v.equipos[1].nombre, 'Máquina');
  assert.equal(v.equipos[1].boca_in, null);
  assert.equal(v.equipos[3].manguera_tramos, null);
  assert.equal(v.equipos[2].manguera_tramos, null);
  assert.equal(v.material, 'GALVANIZADO');
  assert.equal(v.calibre, 22);
  assert.deepEqual(v.cuenta, { N: 9, A: 8, EQ: 4 }, 'nunca por debajo de los identificadores que hay');
  assert.deepEqual(v.colector, { x: 0, y: 0, z: 5 });
  const r = CAD.agregarTramo(v, M, 'N-004', H(45, 1000, 8));
  assert.equal(r.nodo, 'N-010', 'no repite identificadores');
});

test('aLectura: una lectura válida con todo de origen USUARIO, ejes del isométrico, ángulos anotados y las respuestas del dibujo', () => {
  let m = CAD.dibujoEjemplo(M);
  m = CAD.editarEquipo(m, 'EQ-02', { manguera_tramos: 2 });
  const { lectura, respuestas } = CAD.aLectura(m, M, { yarda_mm: 1220, fecha: '2026-10-09T00:00:00Z' });
  assert.deepEqual(UF.leer(lectura).errores, []);
  assert.ok(CAD.esDeDibujo(lectura));
  assert.equal(CAD.esDeDibujo(UF.leer(EJEMPLO).lectura), false);
  const md = lectura.metadatos;
  assert.equal(md.vista, 'ISOMETRICO');
  assert.equal(md.convencion_cotas, 'EJES');
  assert.equal(md.flujo_hacia, 'EQ-01');
  assert.equal(md.yarda_mm, 1220);
  assert.equal(CAD.aLectura(m, M, { yarda_mm: 914 }).lectura.metadatos.yarda_mm, 914.4);
  assert.deepEqual([md.material.valor, md.material.origen, md.calibre.valor, md.calibre.origen], ['GALVANIZADO', 'USUARIO', 22, 'USUARIO']);
  assert.equal(md.fecha, '2026-10-09T00:00:00Z');
  assert.deepEqual(lectura.red.aristas.map((a) => a.id), m.tramos.map((t) => t.id), 'los identificadores del dibujo');
  lectura.red.aristas.forEach((a) => {
    const t = m.tramos.find((x) => x.id === a.id);
    assert.deepEqual([a.nodo_a, a.nodo_b], [t.de, t.a]);
    assert.deepEqual([a.diametro.valor, a.diametro.origen, a.diametro.confianza], [t.D_in, 'USUARIO', 1]);
    assert.deepEqual([a.longitud_cota.valor, a.longitud_cota.origen, a.longitud_cota.confianza], [t.largo_mm / 1000, 'USUARIO', 1]);
    assert.equal(a.eje_iso, t.dir !== 'H' ? 'Z' : { 0: 'X', 180: 'X', 90: 'Y', 270: 'Y' }[t.az_deg] || 'NINGUNO');
  });
  const angulos = lectura.red.textos.map((t) => [t.asociado_a, t.contenido_normalizado, t.tipo, t.confianza_ocr, t.origen]);
  assert.deepEqual(angulos.sort(), [['N-002', '90', 'ANGULO', 1, 'USUARIO'], ['N-003', '45', 'ANGULO', 1, 'USUARIO'], ['N-006', '45', 'ANGULO', 1, 'USUARIO'], ['N-008', '45', 'ANGULO', 1, 'USUARIO']]);
  assert.deepEqual(lectura.equipos.map((e) => [e.id, e.tipo, e.conexion, e.boca_diametro && e.boca_diametro.valor]),
    [['EQ-01', 'COLECTOR', 'BRIDA_EQUIPO', 12], ['EQ-02', 'MAQUINA', 'MANGUERA', null], ['EQ-03', 'MAQUINA', 'MANGUERA', null], ['EQ-04', 'CAMPANA', 'BRIDA_TALLER', null]]);
  assert.deepEqual(respuestas, { 'EQ-02': { manguera_tramos: 2 }, 'EQ-03': { manguera_tramos: 1 } });
  const abierto = CAD.ponerEquipo(CAD.quitarEquipo(m, 'N-007'), 'N-007', 'ABIERTO').modelo;
  assert.deepEqual(CAD.aLectura(abierto, M, {}).lectura.equipos.find((e) => e.nodo_id === 'N-007').conexion, 'LISO');
  assert.throws(() => CAD.aLectura(CAD.nuevo(M), M, {}), /no dio una lectura válida/);
});

test('el dibujo del croquis de ejemplo da las mismas partidas y el mismo costo que leer el croquis, y sale definitivo', () => {
  const m = CAD.dibujoEjemplo(M);
  assert.deepEqual(CAD.revisar(m, M), { errores: [], avisos: [] });
  const bom = despiece(m);
  assert.equal(bom.resumen.estado, 'DEFINITIVA');
  assert.deepEqual(pendientes(bom), ['CONEXION_EQUIPO'], 'sólo el aviso de los barrenos de la boca del colector');
  assert.deepEqual(bom.accesorios.map((a) => [a.tipo, a.nodo_id, a.angulo && a.angulo.valor, a.angulo && a.angulo.origen]),
    [['CODO', 'N-002', 90, 'USUARIO'], ['REDUCCION_INJERTO', 'N-003', 45, 'USUARIO'], ['INJERTO', 'N-008', 45, 'USUARIO'], ['REDUCCION', 'N-004', null, null], ['CODO', 'N-006', 45, 'USUARIO']]);
  // el croquis: la cota ilegible de 1.2 m y lo demás como lo propone la regla
  const croquis = UF.despiezar(UF.leer(EJEMPLO).lectura, M, { 'A-005': { longitud_m: 1.2 } });
  const clave = (p) => { const q = { ...p }; delete q.unifilar_id; return JSON.stringify(Object.keys(q).sort().map((k) => [k, q[k]])); };
  const dib = UF.aPartidas(bom).map(clave).sort();
  const lei = UF.aPartidas(croquis).map(clave).sort();
  assert.equal(dib.length, 22);
  assert.deepEqual(dib, lei);
  const costo = (partidas) => C.cotizar({ yarda_mm: 914.4, partidas }, M).totales.costo_directo;
  cerca(costo(UF.aPartidas(bom)), costo(UF.aPartidas(croquis)), 1e-6);
  assert.deepEqual(bom.resumen.conteo, croquis.resumen.conteo);
});

test('aplicarRespuestas: lo contestado al revisar pasa al dibujo; los ángulos y la posición los decide el dibujo', () => {
  let m = CAD.dibujoEjemplo(M);
  m = CAD.borrarTramo(m, 'A-006').modelo; // queda un extremo sin equipo (N-006)
  const r = CAD.aplicarRespuestas(m, M, {
    metadatos: { material: 'INOX_304', calibre: 18 }, 'EQ-01': { boca_in: 14 }, 'EQ-02': { manguera_tramos: 3 }, 'N-006': { aceptado: true },
    'A-002': { encimado: 'UNION', angulo_deg: 30 }, 'A-004': { aceptado: true, diametro_in: 5, longitud_m: 2.2 }, 'N-003': { angulo_deg: 30 }, 'A-001': { posicion: 'HORIZONTAL' },
    'EQ-03': { boca_in: 9 }, 'A-099': { diametro_in: 4 }, '<script>': { calibre: 1 },
  });
  assert.equal(r.material, 'INOX_304');
  assert.equal(r.calibre, 18);
  assert.equal(r.equipos.find((e) => e.id === 'EQ-01').boca_in, 14);
  assert.equal(r.equipos.find((e) => e.id === 'EQ-02').manguera_tramos, 3);
  assert.equal(r.equipos.find((e) => e.id === 'EQ-03').boca_in, null, 'una máquina con manguera no lleva boca');
  assert.equal(r.equipos.find((e) => e.nodo === 'N-006').clase, 'ABIERTO');
  const t = (id) => r.tramos.find((x) => x.id === id);
  assert.equal(t('A-002').encimado, 'UNION');
  assert.deepEqual([t('A-004').corto, t('A-004').D_in, t('A-004').largo_mm], [true, 5, 2200]);
  assert.equal(t('A-001').dir, 'SUBE');
  assert.deepEqual(CAD.angulos(r), CAD.angulos(m));
  const { respuestas } = CAD.aLectura(r, M, {});
  assert.deepEqual(respuestas['A-002'], { encimado: 'UNION' });
  assert.deepEqual(respuestas['A-004'], { aceptado: true });
  // un Ø que no se puede (mayor que el anterior) no se aplica
  assert.equal(CAD.aplicarRespuestas(m, M, { 'A-007': { diametro_in: 14 } }).tramos.find((x) => x.id === 'A-007').D_in, 10);
});

test('accesorios encimados: un tramo corto entre dos piezas se pregunta y, si se pegan, sale el armado de piezas', () => {
  let { m } = dibujar([['N-001', H(0, 6000, 12)]]);
  m = CAD.injertar(m, M, 'A-001', 3000, { az_deg: 45, largo_mm: 650, D_in: 8 }).modelo; // el injerto ocupa 450 mm y el codo 126 mm
  m = CAD.agregarTramo(m, M, 'N-004', H(90, 2000, 8)).modelo;
  const bom = despiece(m);
  const al = bom.alertas_ambiguedad.find((a) => a.codigo === 'ACCESORIOS_ENCIMADOS' && !a.resuelta);
  assert.ok(al, 'el ramal de 0.65 m entre el injerto y el codo: quedan 74 mm');
  assert.deepEqual(al.respuesta && [al.respuesta.elemento, al.respuesta.campo], ['A-003', 'encimado']);
  const pegados = CAD.aplicarRespuestas(m, M, { 'A-003': { encimado: 'UNION' } });
  const bom2 = despiece(pegados);
  assert.ok(UF.aPartidas(bom2).some((p) => p.familia === 'UNION'));
  assert.equal(bom2.alertas_ambiguedad.find((a) => a.codigo === 'ACCESORIOS_ENCIMADOS').resuelta, true);
});

test('dibujos al azar con las operaciones: las reglas del unifilar ven exactamente las piezas del dibujo, sin preguntas de lectura', () => {
  let semilla = 20261009;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  const elige = (xs) => xs[Math.floor(azar() * xs.length)];
  const DE_LECTURA = ['DIAMETRO_FALTANTE', 'DIAMETRO_INCONSISTENTE', 'COTA_ILEGIBLE', 'COTA_FALTANTE', 'ANGULO_INFERIDO', 'ANGULO_NO_PERMITIDO', 'ANGULO_DERIVACION_NO_PERMITIDO',
    'ORIENTACION_AMBIGUA', 'PANTALON_RETIRADO', 'CICLO_EN_RED', 'CRUCE_SIN_NODO', 'SIN_COLECTOR', 'LECTURA_DUDOSA', 'DERIVACION_CONTRA_FLUJO', 'TEXTO_SIN_ASOCIAR', 'REDUCCION_GRANDE', 'MATERIAL_FALTANTE', 'CALIBRE_FALTANTE'];
  for (let k = 0; k < 40; k += 1) {
    let m = CAD.nuevo(M);
    const D0 = elige([10, 12, 14, 16, 18]);
    m = CAD.agregarTramo(m, M, 'N-001', azar() < 0.4 ? V('SUBE', 3000, D0) : H(elige([0, 45, 90, 30]), 4000, D0)).modelo;
    for (let i = 0; i < 14; i += 1) {
      try {
        const g = CAD.geometria(m);
        if (azar() < 0.35) {
          const t = elige(m.tramos.filter((x) => x.dir === 'H' && x.largo_mm >= 6000));
          if (!t) continue;
          const ops = CAD.salidasEnTramo(m, M, t.id).opciones;
          m = CAD.injertar(m, M, t.id, 3000, { az_deg: elige(ops).az_deg, largo_mm: elige([3000, 4500, 6000]), D_in: elige(UF.COMERCIALES_IN.filter((d) => d <= t.D_in && d >= 4)) }).modelo;
        } else {
          const nid = elige(g.orden.filter((n) => g.entra.has(n) && !g.salen(n).length && !g.equipo.has(n)));
          if (!nid) continue;
          const ops = CAD.salidas(m, M, nid).opciones;
          const o = elige(ops);
          const lim = g.entra.get(nid).D_in;
          m = CAD.agregarTramo(m, M, nid, { dir: o.dir, az_deg: o.az_deg, largo_mm: elige([3000, 4500, 6500]), D_in: elige(UF.COMERCIALES_IN.filter((d) => d <= lim && d >= 4)) }).modelo;
        }
      } catch (e) { if (!(e instanceof CAD.CadError)) throw e; }
    }
    const g = CAD.geometria(m);
    g.orden.filter((n) => g.entra.has(n) && !g.salen(n).length).forEach((n) => { m = CAD.ponerEquipo(m, n, elige(['MAQUINA_MANGUERA', 'MAQUINA_BRIDA', 'CAMPANA', 'ABIERTO'])).modelo; });
    m = CAD.editarEquipo(m, 'EQ-01', { boca_in: m.tramos[0].D_in });
    assert.deepEqual(CAD.revisar(m, M).errores, [], `dibujo ${k}`);
    const bom = despiece(m);
    const malas = bom.alertas_ambiguedad.filter((a) => !a.resuelta && DE_LECTURA.includes(a.codigo)).map((a) => a.codigo);
    assert.deepEqual(malas, [], `dibujo ${k}: ${malas.join(', ')}`);
    assert.notEqual(bom.resumen.estado, 'NO_COTIZABLE', `dibujo ${k}: ${pendientes(bom).join(', ')}`);
    // cada nodo: la pieza del dibujo, con su ángulo
    const ang = CAD.angulos(m);
    const g2 = CAD.geometria(m);
    g2.orden.forEach((nid) => {
      const ti = g2.entra.get(nid);
      const sal = g2.salen(nid);
      const tipos = bom.accesorios.filter((a) => a.nodo_id === nid && !(a.tipo === 'REDUCCION' && g2.equipo.has(nid))).map((a) => a.tipo);
      if (!ti || !sal.length) return;
      if (sal.length === 2) {
        const tr = g2.tronco(nid);
        assert.deepEqual(tipos, [tr.D_in === ti.D_in ? 'INJERTO' : 'REDUCCION_INJERTO'], `dibujo ${k} ${nid}`);
      } else if (ang.has(nid)) assert.deepEqual(tipos, ti.D_in === sal[0].D_in ? ['CODO'] : ['CODO', 'REDUCCION'], `dibujo ${k} ${nid}`);
      else assert.deepEqual(tipos, ti.D_in === sal[0].D_in ? [] : ['REDUCCION'], `dibujo ${k} ${nid}`);
      bom.accesorios.filter((a) => a.nodo_id === nid && a.angulo).forEach((a) => {
        assert.equal(a.angulo.valor, ang.get(nid), `dibujo ${k} ${nid}`);
        assert.ok((a.tipo === 'CODO' ? M.proceso.angulos_codo_deg : M.proceso.angulos_injerto_deg).includes(a.angulo.valor));
      });
    });
    // un tramo recto por tramo dibujado, con su cota a ejes y su Ø
    assert.equal(bom.ductos_rectos.length, m.tramos.length, `dibujo ${k}`);
    bom.ductos_rectos.forEach((d) => {
      const t = m.tramos.find((x) => x.id === d.arista_id);
      assert.deepEqual([d.diametro_in, d.longitud_cota_mm, d.posicion], [t.D_in, t.largo_mm, t.dir === 'H' ? 'HORIZONTAL' : 'VERTICAL']);
    });
    // y lo guardado vuelve igual
    assert.deepEqual(CAD.validar(clonar(m), M).modelo, m);
  }
});

test('topes: no más de 500 tramos en un dibujo', () => {
  const tramos = Array.from({ length: 500 }, (_, i) => ({ id: `A-${String(i + 1).padStart(3, '0')}`, de: `N-${String(i + 1).padStart(3, '0')}`, a: `N-${String(i + 2).padStart(3, '0')}`, D_in: 6, largo_mm: 1000, dir: 'H', az_deg: i % 2 ? 0 : 30, encimado: null, corto: false }));
  const m = CAD.validar({ version: 1, colector: { x: 0, y: 0, z: 0 }, tramos, equipos: [{ id: 'EQ-01', clase: 'COLECTOR', nombre: 'Colector', nodo: 'N-001' }], material: 'GALVANIZADO', calibre: 22 }, M).modelo;
  assert.equal(m.tramos.length, 500);
  falla(() => CAD.agregarTramo(m, M, 'N-501', H(0, 1000, 6)), /llegó a 500 tramos/);
});
