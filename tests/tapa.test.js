/**
 * La tapa (familia TAPA): cierra el extremo de un ducto. Es un disco con un cuello corto que lleva su brida (de las tablas,
 * proceso.tapa_cuello_mm; 0 = disco plano con la brida a su orilla). El disco se suelda al cuello, o se engargola en
 * galvanizado. Se cotiza como las demás piezas de lámina y tiene su plano.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const G = require('../src/motor/geometria');
const PL = require('../src/web/planos');

const M = crearMaestros();
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const negro16 = { material_id: 'ACERO_CARBON', calibre: 16, ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', cantidad: 1 };
const galv22 = { ...negro16, material_id: 'GALVANIZADO', calibre: 22 };
const calc = (p, base, M2) => C.cotizarPartida({ ...(base || negro16), familia: 'TAPA', ...p }, M2 || M);

test('Tapa con cuello: el disco más el cuello, una virola, la costura del cuello, el disco soldado y una brida', () => {
  const f = calc({ D_mm: 203.2 });
  assert.equal(f.ok, true);
  const PF = f.geometria;
  const e = f.espesor_mm;
  const Dm = G.dimensionesRedondas(203.2, e, 'INTERIOR').D_med;
  const L = M.proceso.tapa_cuello_mm;
  assert.equal(L, 50, 'el cuello de arranque');
  casi(PF.A_neta_m2, (Math.PI * Dm * Dm / 4 + Math.PI * Dm * L) / 1e6, 1e-12, 'disco + cuello');
  casi(PF.L_corte_m, (Math.PI * Dm + 2 * (Math.PI * Dm + L)) / 1000, 1e-12, 'el disco y el rectángulo del cuello');
  assert.deepEqual([PF.n_piezas, PF.n_virolas, PF.n_juntas_internas], [2, 1, 1]);
  casi(PF.L_virola_m, L / 1000, 1e-12);
  casi(PF.sold.tope_m, L / 1000, 1e-12, 'la costura del cuello');
  casi(PF.sold.filete_m, (Math.PI * Dm) / 1000, 1e-12, 'el disco al cuello');
  assert.equal(PF.costura, 'SOLDADA');
  assert.deepEqual(PF.extremos.map((x) => x.id), ['tapa']);
  assert.equal(f.qto.her.n_aros, 1, 'una brida, para atornillarla a la del ducto');
  assert.equal(f.qto.her.bridas[0].extremo, 'tapa');
  assert.equal(f.qto.lam.phi, M.merma.TAPA, 'su merma');
  assert.ok(f.costos.CD > 0 && f.precio.unitario > 0);
  // el cuello de la partida manda sobre el de las tablas; el de las tablas, cuando la partida no lo dice
  const largo = calc({ D_mm: 203.2, L_cuello_mm: 100 }).geometria;
  casi(largo.A_neta_m2 - PF.A_neta_m2, (Math.PI * Dm * 50) / 1e6, 1e-12, '50 mm más de cuello');
  const M2 = JSON.parse(JSON.stringify(M));
  M2.proceso.tapa_cuello_mm = 80;
  assert.equal(calc({ D_mm: 203.2 }, null, M2).geometria.detalle.L_cuello_mm, 80);
  assert.equal(calc({ D_mm: 203.2, L_cuello_mm: 50 }, null, M2).geometria.detalle.L_cuello_mm, 50);
});

test('Tapa plana (cuello 0): sólo el disco, sin rolar ni soldar; la brida va a su orilla', () => {
  const f = calc({ D_mm: 203.2, L_cuello_mm: 0 });
  assert.equal(f.ok, true);
  const PF = f.geometria;
  const Dm = G.dimensionesRedondas(203.2, f.espesor_mm, 'INTERIOR').D_med;
  casi(PF.A_neta_m2, (Math.PI * Dm * Dm) / 4 / 1e6, 1e-12);
  casi(PF.L_corte_m, (Math.PI * Dm) / 1000, 1e-12);
  assert.deepEqual([PF.n_piezas, PF.n_virolas, PF.sold.tope_m, PF.sold.filete_m], [1, 0, 0, 0]);
  assert.equal(f.qto.her.n_aros, 1);
  assert.ok(f.precio.unitario < calc({ D_mm: 203.2 }).precio.unitario, 'la plana cuesta menos que la de cuello');
});

test('Tapa en galvanizado: el cuello y el disco se engargolan; sin brida se puede pedir', () => {
  const f = calc({ D_mm: 203.2 }, galv22);
  const PF = f.geometria;
  const Dm = G.dimensionesRedondas(203.2, f.espesor_mm, 'INTERIOR').D_med;
  assert.equal(PF.costura, 'ENGARGOLADA');
  assert.deepEqual([PF.sold.tope_m, PF.sold.filete_m], [0, 0]);
  casi(PF.engargolado_long_m, 0.05, 1e-12, 'la costura del cuello');
  casi(PF.engargolado_circ_m, (Math.PI * Dm) / 1000, 1e-12, 'el disco al cuello');
  assert.equal(PF.n_engargolados, 2);
  const sin = calc({ D_mm: 203.2, extremos_sin_brida: ['tapa'] }, galv22);
  assert.equal(sin.qto.her.n_aros, 0, 'sin brida: se mete o se remacha en el ducto');
  assert.throws(() => calc({ D_mm: 203.2, extremos_sin_brida: ['D1'] }), /«D1» no es un extremo de la pieza \(use tapa\)/);
});

test('Tapa: lo que no se cotiza se rechaza con su motivo', () => {
  assert.throws(() => calc({}), /diámetro de la tapa debe ser mayor que 0/);
  assert.throws(() => calc({ D_mm: 203.2, L_cuello_mm: -5 }), /Cuello de la tapa/);
  assert.throws(() => calc({ D_mm: 'ocho' }), /Diámetro de la tapa/i);
  // en una cotización, junto a las demás piezas
  const r = C.cotizar({ partidas: [{ ...negro16, familia: 'TAPA', D_mm: 152.4, cantidad: 3 }, { ...negro16, familia: 'RECTO', D_mm: 152.4, L_mm: 2000 }] }, M);
  assert.ok(r.partidas.every((x) => x.ok));
  assert.equal(r.partidas[0].precio.importe, Math.round(3 * r.partidas[0].precio.unitario * 100) / 100);
});

test('El plano de la tapa: el cuello con su largo, el disco y la brida en la boca; la plana con su disco', () => {
  const d = PL.plano(calc({ D_mm: 203.2 }), M);
  assert.equal(d.titulo, 'Tapa Ø8″ con cuello de 50 mm');
  assert.deepEqual(d.datos, ['D = 8″', 'Cuello 50 mm', 'Disco soldado al cuello']);
  assert.deepEqual(d.cotas.map((c) => [c.texto, c.campo]), [['50', 'L_cuello_mm'], ['Ø8″', 'D_mm']]);
  assert.ok(d.trazos.some((t) => t.clase === 'brida'), 'la brida en la boca');
  assert.ok(d.trazos.some((t) => t.clase === 'soldadura'), 'el cordón del disco');
  const g = PL.plano(calc({ D_mm: 203.2 }, galv22), M);
  assert.ok(g.trazos.some((t) => t.clase === 'engargolado') && g.datos.includes('Disco engargolado al cuello'));
  const plana = PL.plano(calc({ D_mm: 203.2, L_cuello_mm: 0 }), M);
  assert.equal(plana.titulo, 'Tapa Ø8″ plana');
  assert.deepEqual(plana.cotas.map((c) => c.texto), ['Ø8″']);
  assert.equal(PL.titulo({ familia: 'TAPA', D_mm: 152.4 }), 'Tapa Ø6″');
  assert.equal(PL.titulo({ familia: 'TAPA', D_mm: 152.4, L_cuello_mm: 0 }), 'Tapa Ø6″ plana');
  assert.equal(PL.titulo({ familia: 'TAPA' }), '');
  const svg = JSON.stringify(PL.arbol(d, { px: 300 }));
  assert.match(svg, /"aria-label":"Tapa Ø8″ con cuello de 50 mm"/);
});
