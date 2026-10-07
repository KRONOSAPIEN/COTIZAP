/**
 * Robustez del motor: lo que NO debe pasar con datos raros, absurdos o dañados.
 *
 *  · Partidas aleatorias válidas (semilla fija): nunca una excepción, nunca NaN/Infinity, invariantes de la pila de precio.
 *  · Un campo corrupto a la vez (texto, listas, NaN, negativos, 1e12…): o se rechaza con un mensaje, o el resultado es sano.
 *  · Tablas maestras con ceros, negativos o tablas de velocidad rotas: error que nombra la ruta, no un precio infinito.
 *  · cotizar() nunca lanza por una partida ni por una cotización mal formada.
 *  · Parches de maestros que vienen de fuera (navegador, archivo): sólo entra lo que tiene la forma de las tablas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../src/motor/cotizador');
const G = require('../src/motor/geometria');
const U = require('../src/motor/util');
const V = require('../src/motor/validacion');
const { crearMaestros, sanearParche, leerParche } = require('../src/datos/maestros');

const M = crearMaestros();

/* ---------- generador aleatorio con semilla ---------- */

function mulberry32(a) {
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generador(semilla) {
  const rnd = mulberry32(semilla);
  const u = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const maybe = (p, f) => (rnd() < p ? f() : undefined);
  const r1 = (x, d = 1) => Number(x.toFixed(d));
  const comunes = () => {
    const o = {
      material_id: pick(['ACERO_CARBON', 'GALVANIZADO', 'INOX_304', 'INOX_316']), calibre: pick([10, 12, 14, 16, 18, 20, 22, 24, 26, 28]),
      tipo_union: pick(['BRIDADO', 'BRIDADO', 'ESPIGA', 'LISO']), clase_sellado: pick(['C', 'B', 'A', 'NINGUNA']),
      cantidad: Math.ceil(u(0, 1) ** 2 * 40) || 1, servicio: pick(['POLVO', 'VENTILACION', 'ABRASIVO']), riesgo: pick(['BAJO', 'MEDIO', 'ALTO']),
      ref_diametro: pick(['INTERIOR', 'EXTERIOR']), pintura: pick(['', '', 'NINGUNA', 'ESMALTE', 'PRIMARIO', 'PRIMARIO_ESMALTE']), ubicacion: pick(['', 'INTERIOR', 'EXTERIOR']),
    };
    if (o.pintura === '') delete o.pintura;
    if (o.ubicacion === '') delete o.ubicacion;
    const pc = maybe(0.15, () => pick(['GUILLOTINA', 'PLASMA', 'LASER'])); if (pc) o.proceso_corte = pc;
    const mp = maybe(0.15, () => r1(u(0, 0.5), 3)); if (mp !== undefined) o.merma_pct = mp;
    const pf = maybe(0.2, () => pick(['SOL38x4.8', 'L25x3.2', 'L38x3.2', 'L38x4.8', 'L51x4.8', 'L64x6.4'])); if (pf) o.perfil_id = pf;
    if (rnd() < 0.1) o.caras_pintadas = pick([1, 2]);
    if (rnd() < 0.2) o.bridas_aparte = rnd() < 0.8;
    return o;
  };
  // extremos que se unen a otra pieza (sin brida): un subconjunto cualquiera de los de la familia
  const sinBrida = (p, ids) => { if (rnd() < 0.3) p.extremos_sin_brida = ids.filter(() => rnd() < 0.5); return p; };
  const GEN = {
    RECTO() {
      const rect = rnd() < 0.3;
      const p = { familia: 'RECTO', forma: rect ? 'RECTANGULAR' : 'REDONDA', L_mm: r1(u(100, 12000)), tipo_costura: pick(['A_TOPE', 'TRASLAPE', 'PITTSBURGH']) };
      if (rect) { p.a_mm = r1(u(100, 2500)); p.b_mm = r1(u(100, 2500)); } else p.D_mm = r1(u(50, 2000));
      const yd = maybe(0.5, () => pick([914, 1220])); if (yd) p.yarda_mm = yd;
      const ea = maybe(0.5, () => pick(['SUELTA', 'SIN_BRIDA', 'CON_BRIDA'])); if (ea) p.extremo_ajuste = ea;
      return p;
    },
    CODO() {
      const rect = rnd() < 0.25;
      const p = { familia: 'CODO', forma: rect ? 'RECTANGULAR' : 'REDONDA', theta_deg: pick([30, 45, 60, 90]), k_R: r1(u(1, 3), 2) };
      if (rect) { p.a_mm = r1(u(100, 1500)); p.b_mm = r1(u(100, 1500)); } else p.D_mm = r1(u(50, 1500));
      const g = maybe(0.3, () => Math.floor(u(2, 9))); if (g) p.n_gajos = g;
      const lt = maybe(0.3, () => r1(u(0, 400))); if (lt !== undefined) p.L_tangente_mm = lt;
      return sinBrida(p, ['A', 'B']);
    },
    REDUCCION() {
      const D1 = r1(u(100, 1500));
      const p = { familia: 'REDUCCION', D1_mm: D1, D2_mm: r1(D1 * u(0.3, 0.95)), excentrica: pick(['NO', 'CARA_PLANA']) };
      const L = maybe(0.5, () => r1(u(50, 1500))); if (L) p.L_mm = L;
      return sinBrida(p, ['D1', 'D2']);
    },
    TRANSICION() {
      const p = { familia: 'TRANSICION', D_mm: r1(u(100, 1200)), a_mm: r1(u(100, 1500)), b_mm: r1(u(100, 1500)) };
      const H = maybe(0.5, () => r1(u(50, 1500))); if (H) p.H_mm = H;
      return sinBrida(p, ['redondo', 'rectangular']);
    },
    RAMAL() {
      const D = r1(u(150, 1500));
      return sinBrida({ familia: 'RAMAL', D_mm: D, d_mm: r1(D * u(0.2, 0.9)), L_cuerpo_mm: r1(u(200, 3000)), L_ramal_mm: r1(u(100, 1500)), beta_deg: pick([30, 45]) }, ['tronco_1', 'tronco_2', 'injerto']);
    },
    REDUCCION_INJERTO() {
      const D1 = r1(u(200, 1500)); const D2 = r1(D1 * u(0.4, 0.95));
      const p = { familia: 'REDUCCION_INJERTO', D1_mm: D1, D2_mm: D2, d_mm: r1(D2 * u(0.15, 0.75)), beta_deg: pick([30, 45]) };
      const L = maybe(0.3, () => r1(u(100, 1500))); if (L) p.L_reduccion_mm = L;
      const Lr = maybe(0.3, () => r1(u(100, 1800))); if (Lr) p.L_ramal_mm = Lr;
      return sinBrida(p, ['D1', 'D2', 'injerto']);
    },
    UNION() {
      const p = { familia: 'UNION', D_mm: r1(u(50, 1500)) };
      const n = maybe(0.5, () => Math.ceil(u(0, 4))); if (n) p.n_uniones = n;
      return p;
    },
    PERSONALIZADO() {
      return {
        familia: 'PERSONALIZADO', A_neta_m2: r1(u(0.05, 20), 3), L_corte_m: r1(u(0, 60), 2), L_sold_tope_m: r1(u(0, 30), 2), L_sold_filete_m: r1(u(0, 20), 2),
        n_piezas: Math.ceil(u(0, 6)) || 1, n_extremos: Math.floor(u(0, 6)), D_ref_mm: r1(u(100, 1500)),
      };
    },
    COMPRADO() {
      if (rnd() < 0.3) return { familia: 'COMPRADO', articulo_id: pick(Object.keys(M.compras.articulos)), ...(rnd() < 0.3 ? { iva_incluido: rnd() < 0.5 } : {}) };
      return { familia: 'COMPRADO', precio_compra_unitario: r1(u(10, 20000), 2), peso_kg: r1(u(0, 200), 1), ...(rnd() < 0.4 ? { iva_incluido: rnd() < 0.5 } : {}) };
    },
    BRIDA() {
      const rect = rnd() < 0.25;
      const p = { familia: 'BRIDA', forma: rect ? 'RECTANGULAR' : 'REDONDA', tipo_union: 'BRIDADO' };
      if (rect) { p.a_mm = r1(u(100, 1500)); p.b_mm = r1(u(100, 1500)); } else p.D_mm = r1(u(80, 1500));
      return p;
    },
    INSTALACION() {
      const p = {
        familia: 'INSTALACION', personas: Math.ceil(u(0, 6)) || 1, dias: r1(u(0.5, 20), 1), viajes: Math.floor(u(0, 6)), casetas_viaje: r1(u(0, 1500), 2),
        gasolina_viaje: r1(u(0, 3000), 2), noches: Math.floor(u(0, 10)), hospedaje_noche: r1(u(0, 1200), 2), comida_dia: r1(u(0, 400), 2), otros_gastos: r1(u(0, 5000), 2),
      };
      const hd = maybe(0.3, () => r1(u(4, 12), 1)); if (hd) p.horas_dia = hd;
      if (rnd() < 0.3) p.gastos_con_factura = rnd() < 0.5;
      if (rnd() < 0.3) p.comidas_con_factura = rnd() < 0.5;
      return p;
    },
    SOPORTE() {
      const barra_id = pick(['SOL_1_1_2X3_16', 'ANG_1_1_2X3_16', 'ANG_2X3_16', 'ANG_1_1_4X1_8', 'ANG_3_4X1_8', 'SOL_1_1_4X1_8', 'CANAL_U_6', 'PTR_2X2_C14']);
      const p = { familia: 'SOPORTE', barra_id, largo_pieza_mm: r1(u(100, 6000)), anclajes_pieza: Math.floor(u(0, 6)), tornillos_pieza: Math.floor(u(0, 4)) };
      const mp = maybe(0.3, () => r1(u(1, 90), 1)); if (mp) p.min_pieza = mp;
      if (rnd() < 0.2) p.articulo_anclaje = pick(Object.keys(M.compras.articulos));
      return p;
    },
  };
  const FAMILIAS = Object.keys(GEN);
  return (i) => {
    const f = FAMILIAS[i % FAMILIAS.length];
    const base = V.NO_LAMINA.includes(f) ? { cantidad: Math.ceil(u(0, 5)) || 1, riesgo: pick(['BAJO', 'MEDIO', 'ALTO']) } : comunes();
    return { ...base, ...GEN[f]() };
  };
}

/** ¿Hay algún NaN o infinito en el objeto? */
const noFinitos = (o) => V.noFinitos(o, 3);

/* ---------- 1 · partidas válidas al azar ---------- */

test('Partidas válidas al azar (todas las familias): sin excepciones, sin NaN y con la pila de precio cerrada', () => {
  const nueva = generador(20260930);
  const M2 = crearMaestros({ precios: Object.fromEntries(Object.keys(M.precios).map((k) => [k, M.precios[k] * 2.5])) });
  let calculadas = 0;
  for (let i = 0; i < 640; i += 1) {
    const p = nueva(i);
    let r;
    try { r = C.cotizarPartida(p, M); } catch (e) {
      assert.ok(e instanceof U.ErrorValidacion, `excepción inesperada: ${e.stack}\n${JSON.stringify(p)}`);
      continue; // una combinación física imposible (injerto que no cabe…) se rechaza con mensaje: está bien
    }
    calculadas += 1;
    assert.deepEqual(noFinitos(r), [], JSON.stringify(p));
    assert.ok(r.precio.unitario > 0, JSON.stringify(p));
    const pl = r.pila;
    assert.ok(Math.abs(pl.C_base + pl.utilidad + pl.comision + pl.otros - pl.precio) <= 1e-6 * Math.max(1, pl.precio), `pila ${JSON.stringify(p)}`);
    const s = r.costos.subtotales;
    assert.ok(Math.abs(s.materiales + s.consumibles + s.mano_obra + s.equipo + s.herramienta_menor + s.subcontratos + s.viaticos - r.costos.CD) <= 1e-6 * Math.max(1, r.costos.CD), `CD ${JSON.stringify(p)}`);
    if (p.familia !== 'COMPRADO' && p.familia !== 'INSTALACION') {
      if (p.familia !== 'UNION') assert.ok(r.peso.neto_unitario_kg > 0, JSON.stringify(p)); // la unión no lleva lámina: no pesa
      // cantidades ≠ precios: con todos los precios ×2.5 el levantamiento de cantidades es idéntico
      const r2 = C.cotizarPartida(p, M2);
      assert.equal(JSON.stringify(r2.qto), JSON.stringify(r.qto), `QTO depende de precios: ${JSON.stringify(p)}`);
    }
    // el viaje por JSON (así se guarda y se importa) no cambia el resultado
    assert.equal(C.cotizarPartida(JSON.parse(JSON.stringify(p)), M).precio.unitario, r.precio.unitario);
  }
  assert.ok(calculadas > 520, `se calcularon ${calculadas} de 640`);
});

test('cotizar() da lo mismo que cotizarPartida() partida por partida y nunca lanza', () => {
  const nueva = generador(7);
  const partidas = Array.from({ length: 60 }, (_, i) => nueva(i));
  const res = C.cotizar({ riesgo: 'MEDIO', servicio: 'POLVO', partidas }, M);
  assert.equal(res.partidas.length, 60);
  res.partidas.forEach((f, i) => {
    assert.equal(f.indice, i);
    if (f.ok) assert.equal(f.precio.importe, C.cotizarPartida({ riesgo: 'MEDIO', servicio: 'POLVO', ...partidas[i] }, M).precio.importe);
    else assert.ok(f.errores.length > 0 && !f.interno, `la partida ${i} falló por una causa inesperada: ${f.errores}`);
  });
  assert.deepEqual(noFinitos(res.totales), []);
});

test('El precio crece con la longitud, el diámetro y el espesor (monotonía)', () => {
  const precio = (p) => C.cotizarPartida({ material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 1, ...p }, M).precio.importe;
  const crece = (serie) => serie.every((x, i) => i === 0 || x > serie[i - 1]);
  assert.ok(crece([1000, 2000, 3000, 6000, 9000].map((L) => precio({ familia: 'RECTO', D_mm: 300, L_mm: L }))), 'longitud');
  assert.ok(crece([100, 200, 300, 600, 1200].map((D) => precio({ familia: 'RECTO', D_mm: D, L_mm: 3000 }))), 'diámetro del recto');
  assert.ok(crece([150, 300, 600, 1200].map((D) => precio({ familia: 'CODO', D_mm: D, theta_deg: 90 }))), 'diámetro del codo');
  assert.ok(crece([28, 24, 20, 16, 12, 10].map((calibre) => precio({ familia: 'RECTO', D_mm: 300, L_mm: 3000, calibre }))), 'espesor (calibre más grueso)');
});

/* ---------- 2 · un campo corrupto a la vez ---------- */

const COMUN = { material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', clase_sellado: 'C', servicio: 'POLVO', riesgo: 'MEDIO', cantidad: 2 };
const PLANTILLAS = {
  RECTO: { ...COMUN, familia: 'RECTO', forma: 'REDONDA', D_mm: 304.8, L_mm: 3000, tipo_costura: 'A_TOPE' },
  RECTO_RECT: { ...COMUN, familia: 'RECTO', forma: 'RECTANGULAR', a_mm: 500, b_mm: 300, L_mm: 3000, tipo_costura: 'A_TOPE', n_costuras_long: 2 },
  CODO: { ...COMUN, familia: 'CODO', D_mm: 304.8, theta_deg: 90, k_R: 1.5, n_gajos: 5, L_tangente_mm: 50 },
  CODO_RECT: { ...COMUN, familia: 'CODO', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300, theta_deg: 90, k_R: 1.5 },
  REDUCCION: { ...COMUN, familia: 'REDUCCION', D1_mm: 400, D2_mm: 300, excentrica: 'NO', L_mm: 400 },
  TRANSICION: { ...COMUN, familia: 'TRANSICION', D_mm: 300, a_mm: 400, b_mm: 300, H_mm: 500, n_costuras_long: 2 },
  RAMAL: { ...COMUN, familia: 'RAMAL', D_mm: 400, d_mm: 200, L_cuerpo_mm: 800, L_ramal_mm: 500, beta_deg: 45 },
  REDUCCION_INJERTO: { ...COMUN, familia: 'REDUCCION_INJERTO', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 45 },
  PERSONALIZADO: { ...COMUN, familia: 'PERSONALIZADO', A_neta_m2: 1.2, L_corte_m: 9, L_sold_tope_m: 4, L_sold_filete_m: 1, n_piezas: 2, n_extremos: 2, D_ref_mm: 300 },
  COMPRADO: { familia: 'COMPRADO', cantidad: 2, riesgo: 'MEDIO', precio_compra_unitario: 1800, peso_kg: 9 },
  BRIDA: { ...COMUN, familia: 'BRIDA', D_mm: 279.4 },
  BRIDA_RECT: { ...COMUN, familia: 'BRIDA', forma: 'RECTANGULAR', a_mm: 400, b_mm: 300 },
  UNION: { ...COMUN, familia: 'UNION', D_mm: 279.4, n_uniones: 2 },
  INSTALACION: {
    familia: 'INSTALACION', cantidad: 1, riesgo: 'MEDIO', personas: 2, dias: 5, horas_dia: 8, viajes: 1, casetas_viaje: 806, gasolina_viaje: 1500, noches: 4, hospedaje_noche: 650, comida_dia: 250, otros_gastos: 1200,
  },
  SOPORTE: { familia: 'SOPORTE', cantidad: 7, riesgo: 'MEDIO', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1500, anclajes_pieza: 4, tornillos_pieza: 2, min_pieza: 20 },
};
const NUMERICOS = (p) => Object.keys(p).filter((k) => typeof p[k] === 'number');

test('Las plantillas válidas se calculan (punto de partida de las pruebas de corrupción)', () => {
  Object.entries(PLANTILLAS).forEach(([n, p]) => assert.doesNotThrow(() => C.cotizarPartida(p, M), n));
});

test('Un número que no es número (NaN, ±Infinity, texto, lista, objeto, booleano) se rechaza en TODO campo numérico', () => {
  const NO_NUMEROS = [NaN, Infinity, -Infinity, 'abc', '12abc', '1,5', [], [5], {}, true, false];
  Object.entries(PLANTILLAS).forEach(([nombre, plantilla]) => {
    NUMERICOS(plantilla).forEach((campo) => NO_NUMEROS.forEach((raro) => {
      assert.throws(() => C.cotizarPartida({ ...plantilla, [campo]: raro }, M), U.ErrorValidacion, `${nombre}.${campo} = ${JSON.stringify(raro)} (${String(raro)})`);
    }));
  });
});

test('Los números escritos como texto («1e3», «304.8») se aceptan y dan lo mismo que el número', () => {
  Object.entries(PLANTILLAS).forEach(([nombre, plantilla]) => {
    const base = C.cotizarPartida(plantilla, M).precio.importe;
    const comoTexto = Object.fromEntries(NUMERICOS(plantilla).map((k) => [k, String(plantilla[k])]));
    assert.equal(C.cotizarPartida({ ...plantilla, ...comoTexto }, M).precio.importe, base, nombre);
  });
  assert.equal(C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: '16' }, M).precio.importe, C.cotizarPartida(PLANTILLAS.RECTO, M).precio.importe, 'el calibre también puede venir como texto');
});

test('Medidas obligatorias: cero, negativas, «casi cero» y descomunales (1e12) se rechazan con un mensaje claro y sin agotar memoria', () => {
  const OBLIGATORIAS = {
    RECTO: ['D_mm', 'L_mm'], RECTO_RECT: ['a_mm', 'b_mm', 'L_mm'], CODO: ['D_mm', 'k_R'], CODO_RECT: ['a_mm', 'b_mm'], REDUCCION: ['D1_mm', 'D2_mm'], TRANSICION: ['D_mm', 'a_mm', 'b_mm'],
    RAMAL: ['D_mm', 'd_mm', 'L_cuerpo_mm', 'L_ramal_mm'], REDUCCION_INJERTO: ['D1_mm', 'D2_mm', 'd_mm'], PERSONALIZADO: ['A_neta_m2', 'n_piezas'], COMPRADO: ['cantidad'],
    BRIDA: ['D_mm'], BRIDA_RECT: ['a_mm', 'b_mm'], UNION: ['D_mm', 'n_uniones'], INSTALACION: ['personas', 'dias'], SOPORTE: ['largo_pieza_mm'],
  };
  Object.entries(OBLIGATORIAS).forEach(([nombre, campos]) => campos.forEach((campo) => {
    const raros = [0, -1, -304.8, 1e-9, 1e7, 1e12, 1e300, ...(campo.endsWith('_mm') ? [0.5, 5] : [])]; // en mm, menos de 10 también es «casi cero»
    raros.forEach((valor) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS[nombre], [campo]: valor }, M), U.ErrorValidacion, `${nombre}.${campo} = ${valor}`));
  }));
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, L_mm: 1e12 }, M), /Longitud total: debe estar entre 10 mm y 100000 mm; trae 1000000000000 mm/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, D_mm: 2 }, M), /Diámetro: debe estar entre 25 mm y 6000 mm/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, cantidad: 1e9 }, M), /Cantidad: debe estar entre 1 y 100000/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, cantidad: 2.5 }, M), /Cantidad: debe ser un número entero/);
});

test('Campos opcionales: vacío («», null, undefined) significa «automático»; cero y valores raros no se cuelan', () => {
  const OPCIONALES = {
    RECTO: ['yarda_mm'], CODO: ['n_gajos', 'L_tangente_mm'], REDUCCION: ['L_mm'], TRANSICION: ['H_mm', 'n_costuras_long'], COMPRADO: ['peso_kg'], INSTALACION: ['horas_dia'], SOPORTE: ['min_pieza'],
  };
  Object.entries(OPCIONALES).forEach(([nombre, campos]) => campos.forEach((campo) => {
    const base = { ...PLANTILLAS[nombre] };
    delete base[campo];
    const auto = C.cotizarPartida(base, M).precio.importe;
    ['', ' ', null, undefined].forEach((vacio) => assert.equal(C.cotizarPartida({ ...base, [campo]: vacio }, M).precio.importe, auto, `${nombre}.${campo} = ${JSON.stringify(vacio)}`));
    [-1, 1e12, ...(campo === 'peso_kg' ? [] : [1e-9])].forEach((raro) => assert.throws(() => C.cotizarPartida({ ...base, [campo]: raro }, M), U.ErrorValidacion, `${nombre}.${campo} = ${raro}`));
  }));
  // el vacío y el cero de una longitud «automática» son lo mismo
  assert.equal(C.cotizarPartida({ ...PLANTILLAS.REDUCCION, L_mm: 0 }, M).precio.importe, C.cotizarPartida({ ...PLANTILLAS.REDUCCION, L_mm: undefined }, M).precio.importe);
});

test('Cantidades de piezas y de operaciones fuera de lo razonable (negativas, enormes, fraccionarias)', () => {
  const rect = PLANTILLAS.RECTO_RECT;
  [-3, 0, 9, 1e9, 1.5].forEach((n) => assert.throws(() => C.cotizarPartida({ ...rect, n_costuras_long: n }, M), U.ErrorValidacion, `n_costuras_long ${n}`));
  [-3, 1e6, 1.5].forEach((n) => assert.throws(() => C.cotizarPartida({ ...COMUN, ...PLANTILLAS.RECTO, tipo_union: 'ESPIGA', n_espigas: n }, M), U.ErrorValidacion, `n_espigas ${n}`));
  [-5, 1e9].forEach((x) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, clase_sellado: 'A', L_penetraciones_m: x }, M), U.ErrorValidacion, `L_penetraciones_m ${x}`));
  [-0.1, 0.95, 1, 5].forEach((x) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, merma_pct: x }, M), U.ErrorValidacion, `merma_pct ${x}`));
  [0, 3, 7, 'dos', true].forEach((x) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, pintura: 'PRIMARIO', caras_pintadas: x }, M), /Caras pintadas/, `caras_pintadas ${x}`));
  ['no', 0, 1, 'false'].forEach((x) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, usa_empaque: x }, M), /Empaque/, `usa_empaque ${JSON.stringify(x)}`));
  assert.doesNotThrow(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, usa_empaque: false, caras_pintadas: '2', pintura: 'PRIMARIO' }, M));
});

test('Espesor propio: dentro de los límites del taller; un calibre que no existe o no es número se rechaza', () => {
  const placa = { ...PLANTILLAS.RECTO, calibre: 'PROPIO' };
  assert.doesNotThrow(() => C.cotizarPartida({ ...placa, espesor_mm: 4.76 }, M));
  [1000, 51, 0.1, 1e-6, -2].forEach((e) => assert.throws(() => C.cotizarPartida({ ...placa, espesor_mm: e }, M), /Espesor: debe estar entre 0\.2 mm y 50 mm/, `espesor ${e}`));
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: 99 }, M), /El calibre 99 no existe/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: 'abc' }, M), /Calibre: «abc» no es un número/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: undefined }, M), /Falta el calibre/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: 'PROPIO' }, M), /Calibre/, 'PROPIO sin espesor');
});

test('Valores que sólo admiten una lista (forma, servicio, riesgo, unión…): lo que no existe se rechaza, el vacío es «según la cotización»', () => {
  const casos = [
    ['RECTO', 'forma', 'REDONDO'], ['RECTO', 'tipo_costura', 'SOLDADA'], ['RECTO', 'ref_diametro', 'EXT'], ['RECTO', 'servicio', 'AGUA'], ['RECTO', 'riesgo', 'EXTREMO'],
    ['RECTO', 'tipo_union', 'PEGAMENTO'], ['RECTO', 'clase_sellado', 'Z'], ['RECTO', 'pintura', 'ORO'], ['RECTO', 'ubicacion', 'PATIO'], ['CODO', 'ubicacion', 'interior'], ['RECTO', 'proceso_corte', 'MACHETE'], ['RECTO', 'perfil_id', 'XYZ'],
    ['RECTO', 'material_id', 'TITANIO'], ['CODO', 'forma', 'abc'], ['REDUCCION', 'excentrica', 'LADO'], ['COMPRADO', 'riesgo', 'EXTREMO'],
  ];
  casos.forEach(([n, campo, valor]) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS[n], [campo]: valor }, M), U.ErrorValidacion, `${n}.${campo}=${valor}`));
  [{}, [], 5, true, ['POLVO']].forEach((raro) => assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, servicio: raro }, M), U.ErrorValidacion, `servicio=${JSON.stringify(raro)}`));
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, familia: 'constructor' }, M), /Familia desconocida/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, material_id: 'constructor' }, M), /Material desconocido/);
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, material_id: '__proto__' }, M), /Material desconocido/);
  const sinVacios = C.cotizarPartida({ ...PLANTILLAS.RECTO, servicio: '', riesgo: ' ', pintura: null, ubicacion: '', perfil_id: '', proceso_corte: '' }, M);
  assert.equal(sinVacios.precio.importe, C.cotizarPartida({ ...PLANTILLAS.RECTO, servicio: undefined }, M).precio.importe);
});

test('Listas: omitir_operaciones y subcontratos', () => {
  const R = PLANTILLAS.RECTO;
  ['pintura', 5, {}, true].forEach((x) => assert.throws(() => C.cotizarPartida({ ...R, omitir_operaciones: x }, M), /Operaciones omitidas: debe ser una lista/));
  assert.throws(() => C.cotizarPartida({ ...R, omitir_operaciones: [5] }, M), /Operación desconocida/);
  assert.throws(() => C.cotizarPartida({ ...R, omitir_operaciones: ['teletransporte'] }, M), /Operación desconocida/);
  ['x', 5, {}].forEach((x) => assert.throws(() => C.cotizarPartida({ ...R, subcontratos: x }, M), /Subcontratos: debe ser una lista/));
  assert.throws(() => C.cotizarPartida({ ...R, subcontratos: [null] }, M), /Subcontrato 1: no es válido/);
  assert.throws(() => C.cotizarPartida({ ...R, subcontratos: [{ driver: 'PIEZA', precio: 'abc' }] }, M), /precio inválido/);
  assert.throws(() => C.cotizarPartida({ ...R, subcontratos: [{ driver: 'PIEZA', precio: -1 }] }, M), /precio inválido/);
  assert.throws(() => C.cotizarPartida({ ...R, subcontratos: [{ driver: 'LITROS', precio: 5 }] }, M), /driver desconocido/);
  assert.throws(() => C.cotizarPartida({ ...R, subcontratos: [{ driver: 'PIEZA', precio: 1e12 }] }, M), /precio inválido/);
  const ok = C.cotizarPartida({ ...R, omitir_operaciones: ['pintura'], subcontratos: [{ concepto: 'Galvanizado', driver: 'KG_NETO', precio: '12.5' }, { driver: 'PIEZA', precio: 100, concepto: 7 }] }, M);
  assert.ok(ok.costos.subcontratos['1. Galvanizado'] > 0);
  assert.ok('2. 7' in ok.costos.subcontratos, 'un concepto numérico se vuelve texto');
});

test('La partida no se muta y los campos que no son suyos no se tocan', () => {
  const p = { ...PLANTILLAS.RECTO, cantidad: '3', L_mm: '3000', subcontratos: [{ driver: 'PIEZA', precio: '10' }], etiqueta_libre: { a: [1, 2] } };
  const copia = JSON.parse(JSON.stringify(p));
  const r = C.cotizarPartida(p, M);
  assert.deepEqual(p, copia, 'la entrada no se muta');
  assert.equal(r.entrada.cantidad, 3, 'la partida calculada ya trae números');
  assert.deepEqual(r.entrada.etiqueta_libre, { a: [1, 2] });
});

test('Ni null, ni arreglos, ni textos son una partida', () => {
  [null, undefined, 5, 'x', [], [1]].forEach((x) => assert.throws(() => C.cotizarPartida(x, M), U.ErrorValidacion, JSON.stringify(x)));
});

/* ---------- 3 · geometría ---------- */

test('Geometría: una dimensión exterior menor que el doble del espesor no tiene interior', () => {
  const e = 1.519;
  assert.throws(() => G.dimensionesRedondas(2 * e, e, 'EXTERIOR'), U.ErrorValidacion);
  assert.throws(() => G.dimensionesRedondas(e, e, 'EXTERIOR'), U.ErrorValidacion);
  assert.doesNotThrow(() => G.dimensionesRedondas(2 * e + 1, e, 'EXTERIOR'));
  assert.doesNotThrow(() => G.dimensionesRedondas(5, e, 'INTERIOR'));
  assert.throws(() => G.dimensionesRect(2, 300, e, 'EXTERIOR'), U.ErrorValidacion);
  assert.throws(() => G.dimensionesRect(300, 3, e, 'EXTERIOR'), U.ErrorValidacion);
  // por la ruta completa, con una sección permitida y un espesor de placa gigante: D_int ≤ 0
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, calibre: 'PROPIO', espesor_mm: 50, ref_diametro: 'EXTERIOR', D_mm: 60 }, M), /diámetro exterior/);
});

test('Geometría: un tramo recto no se parte en un número desorbitado de anillos', () => {
  const pocos = crearMaestros({ proceso: { limites: { piezas_max: 50 } } }); // 100 m en yardas de 1 220 mm = 82 anillos > 50
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, L_mm: 100000 }, pocos), /82 anillos \(el máximo es 50\)/);
  assert.doesNotThrow(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, L_mm: 50000 }, pocos));
  // la geometría sola (sin pasar por la validación de la partida) también se defiende, incluso sin límites en los maestros
  const sinLimites = crearMaestros();
  delete sinLimites.proceso.limites;
  assert.throws(() => G.perfilFabricacion({ ...PLANTILLAS.RECTO, L_mm: 1e12, yarda_mm: 300 }, 1.5, sinLimites), /anillos/);
  assert.throws(() => G.perfilFabricacion({ ...PLANTILLAS.PERSONALIZADO, n_extremos: 1e12 }, 1.5, M), /extremos/);
  // un tramo largo pero razonable (100 m con yardas de 1 220 mm) se calcula: 27 piezas de 3 yardas + el ajuste de 1 180 mm
  const largo = C.cotizarPartida({ ...PLANTILLAS.RECTO, L_mm: 100000 }, M);
  assert.equal(largo.geometria.n_virolas, 82);
  assert.equal(largo.geometria.n_piezas, 28);
  assert.deepEqual(noFinitos(largo), []);
});

test('Ancho de la yarda y tramo de ajuste: límites, tipo y valores de las tablas', () => {
  const R = PLANTILLAS.RECTO;
  [100, 299, 2001, 1e6, -914].forEach((y) => assert.throws(() => C.cotizarPartida({ ...R, yarda_mm: y }, M), /Ancho de la yarda: debe estar entre 300 mm y 2000 mm/, `yarda ${y}`));
  assert.doesNotThrow(() => C.cotizarPartida({ ...R, yarda_mm: 914 }, M));
  assert.doesNotThrow(() => C.cotizarPartida({ ...R, yarda_mm: '1220' }, M), 'también como texto');
  // el extremo del ajuste: sólo SUELTA, SIN_BRIDA o CON_BRIDA (vacío = lo que digan las tablas)
  ['no', 'suelta', 'SUELTO', 0, 1, true, false, [], {}, ['SUELTA']].forEach((x) => assert.throws(() => C.cotizarPartida({ ...R, extremo_ajuste: x }, M), /Extremo final del tramo: .* no existe \(use SUELTA, SIN_BRIDA, CON_BRIDA\)/, `extremo_ajuste ${JSON.stringify(x)}`));
  ['SUELTA', 'SIN_BRIDA', 'CON_BRIDA', '', null, undefined].forEach((x) => assert.doesNotThrow(() => C.cotizarPartida({ ...R, extremo_ajuste: x }, M), String(x)));
  // el sí/no de la versión anterior sólo se entiende como sí/no (un texto cualquiera no se interpreta como nada: se descarta, no se inventa)
  [true, false].forEach((x) => assert.doesNotThrow(() => C.cotizarPartida({ ...R, ajuste_sin_brida: x }, M)));
  ['no', 0, 'false', [], {}].forEach((x) => assert.equal(C.cotizarPartida({ ...R, ajuste_sin_brida: x }, M).entrada.extremo_ajuste, undefined, `ajuste_sin_brida ${JSON.stringify(x)} no se interpreta`));
  // los datos del armado de las tablas maestras
  const malo = (parche) => { const Mx = crearMaestros(); Object.keys(parche).forEach((k) => { Mx.proceso.armado_yardas[k] = parche[k]; }); return V.problemasMaestros(Mx).map(V.textoProblema).join(' | '); };
  assert.match(malo({ yardas_por_pieza_max: 0 }), /yardas por pieza max: debe ser un número mayor que 0/);
  assert.match(malo({ yardas_por_pieza_max: 2.5 }), /yardas por pieza max: debe ser un número entero/);
  assert.match(malo({ yarda_defecto_mm: 0 }), /yarda defecto mm: debe ser un número mayor que 0/);
  assert.match(malo({ yarda_defecto_mm: 5000 }), /yarda defecto mm: debe estar entre 300 y 2000 mm/);
  assert.match(malo({ yardas_mm: [] }), /yardas mm: debe ser una lista/);
  assert.match(malo({ yardas_mm: [914, 0] }), /yardas mm › 1: debe ser un número mayor que 0/);
  assert.match(malo({ junta_entre_yardas: 'PEGAMENTO' }), /junta entre yardas: debe ser un tipo de costura/);
  ['suelta', 'NINGUNA', '', 5, null].forEach((x) => assert.match(malo({ extremo_ajuste_defecto: x }), /extremo ajuste defecto: debe ser SUELTA, SIN_BRIDA, CON_BRIDA/, `defecto ${JSON.stringify(x)}`));
  ['SUELTA', 'SIN_BRIDA', 'CON_BRIDA'].forEach((x) => assert.equal(malo({ extremo_ajuste_defecto: x }), '', x));
  assert.match(malo({ ajuste_tolerancia_mm: -1 }), /ajuste tolerancia mm: no puede ser negativo/);
  assert.equal(malo({}), '');
  const Mx = crearMaestros(); Mx.proceso.armado_yardas.yardas_por_pieza_max = 0;
  assert.throws(() => C.cotizarPartida(R, Mx), /Tablas maestras · proceso › armado yardas › yardas por pieza max/);
  assert.equal(V.exigePositivo(['proceso', 'armado_yardas', 'yardas_por_pieza_max']), true);
  assert.equal(V.exigePositivo(['proceso', 'armado_yardas', 'yardas_mm', 0]), true);
  // un parche viejo con la longitud máxima por pieza (3 000 mm) la pierde: ahora manda el armado por yardas
  assert.equal('L_max_pieza_mm' in crearMaestros({ proceso: { L_max_pieza_mm: 2000 } }).proceso, false);
  // un parche con la tabla del armado rota se reemplaza por la de arranque
  assert.deepEqual(crearMaestros({ proceso: { armado_yardas: { yardas_mm: 'x', yardas_por_pieza_max: '3', junta_entre_yardas: 5, extremo_ajuste_defecto: 7 } } }).proceso.armado_yardas, M.proceso.armado_yardas);
});

/* ---------- 4 · tablas maestras ---------- */

test('Maestros de pintura: la ubicación por omisión, las manos de cada sistema y el sistema de cada material deben existir', () => {
  const malo = (arreglo) => { const Mx = crearMaestros(); arreglo(Mx); return V.problemasMaestros(Mx).map(V.textoProblema).join(' | '); };
  assert.equal(malo(() => {}), '');
  ['patio', 'EXTERIOR ', '', 5, null].forEach((x) => assert.match(malo((Mx) => { Mx.proceso.pintura.ubicacion_defecto = x; }), /pintura › ubicacion defecto: debe ser INTERIOR o EXTERIOR/, `ubicación ${JSON.stringify(x)}`));
  assert.match(malo((Mx) => { Mx.proceso.pintura.sistemas.ESMALTE = ['barniz']; }), /sistemas › ESMALTE › 0: debe ser una mano de «proceso › pintura › capas» \(primario, esmalte\); vale barniz/);
  assert.match(malo((Mx) => { Mx.proceso.pintura.sistemas.ESMALTE = 'esmalte'; }), /sistemas › ESMALTE: debe ser una lista de manos/);
  assert.match(malo((Mx) => { Mx.materiales.ACERO_CARBON.pintura_cuerpo.EXTERIOR = 'ORO'; }), /materiales › ACERO CARBON › pintura cuerpo › EXTERIOR: debe ser un sistema de pintura de «proceso › pintura › sistemas» \(NINGUNA, ESMALTE, PRIMARIO, PRIMARIO_ESMALTE\); vale ORO/);
  assert.match(malo((Mx) => { Mx.materiales.GALVANIZADO.pintura_bridas.INTERIOR = undefined; }), /GALVANIZADO › pintura bridas › INTERIOR: debe ser un sistema de pintura/);
  assert.match(malo((Mx) => { delete Mx.materiales.INOX_304.pintura_cuerpo; }), /INOX 304 › pintura cuerpo: falta el sistema de pintura por ubicación/);
  // un sistema que existe pero lo agregó el taller sí vale, y se pinta con él
  const propio = crearMaestros();
  propio.proceso.pintura.sistemas.DOBLE_ESMALTE = ['esmalte', 'esmalte'];
  propio.materiales.ACERO_CARBON.pintura_cuerpo.INTERIOR = 'DOBLE_ESMALTE';
  assert.deepEqual(V.problemasMaestros(propio), []);
  const con = C.cotizarPartida({ ...PLANTILLAS.RECTO, ubicacion: 'INTERIOR' }, propio);
  assert.deepEqual(con.qto.pint.partes[0].capas, ['esmalte', 'esmalte']);
  // y la partida con un maestro roto no se calcula con valores inventados
  const roto = crearMaestros();
  roto.materiales.ACERO_CARBON.pintura_cuerpo.INTERIOR = 'ORO';
  assert.throws(() => C.cotizarPartida(PLANTILLAS.RECTO, roto), /Tablas maestras · materiales › ACERO CARBON › pintura cuerpo › INTERIOR/);
});

test('Un parche guardado con la pintura por defecto de cada material (versión anterior) la pierde: ahora rige la regla por ubicación', () => {
  const viejo = { materiales: { ACERO_CARBON: { pintura_defecto: 'NINGUNA', f_acabado: 0.3 }, GALVANIZADO: { pintura_defecto: 'PRIMARIO' } }, precios: { precio_L_esmalte: 300 } };
  const migrado = crearMaestros(viejo);
  assert.equal('pintura_defecto' in migrado.materiales.ACERO_CARBON, false);
  assert.equal('pintura_defecto' in migrado.materiales.GALVANIZADO, false);
  assert.equal(migrado.materiales.ACERO_CARBON.f_acabado, 0.3, 'lo demás del parche se respeta');
  assert.equal(migrado.precios.precio_L_esmalte, 300);
  assert.deepEqual(migrado.materiales.ACERO_CARBON.pintura_cuerpo, M.materiales.ACERO_CARBON.pintura_cuerpo);
  assert.deepEqual(V.problemasMaestros(migrado), []);
  // no queda anotado como «valor ignorado»: se migró, no se descartó
  const leido = require('../src/datos/maestros').leerParche(viejo);
  assert.deepEqual(leido.descartados, []);
  assert.deepEqual(Object.keys(leido.parche.materiales), ['ACERO_CARBON']);
  // un parche que sólo traía la pintura por defecto no deja materiales vacíos
  assert.equal('materiales' in require('../src/datos/maestros').leerParche({ materiales: { GALVANIZADO: { pintura_defecto: 'NINGUNA' } } }).parche, false);
  // y el que cambia la regla nueva se respeta
  const nuevo = crearMaestros({ materiales: { GALVANIZADO: { pintura_cuerpo: { INTERIOR: 'ESMALTE' } } } });
  assert.equal(nuevo.materiales.GALVANIZADO.pintura_cuerpo.INTERIOR, 'ESMALTE');
  assert.equal(nuevo.materiales.GALVANIZADO.pintura_cuerpo.EXTERIOR, 'NINGUNA', 'la otra ubicación sigue como estaba');
  assert.ok(C.cotizarPartida({ ...PLANTILLAS.RECTO, material_id: 'GALVANIZADO', ubicacion: 'INTERIOR' }, nuevo).qto.pint.partes[0].A_m2 > 0);
});

test('Maestros sanos: sin problemas', () => {
  assert.deepEqual(V.problemasMaestros(M), []);
  assert.deepEqual(V.problemasMaestros(crearMaestros({ precios: { precio_kg_acero_carbon: 99 }, capas: { utilidad_pct_precio: 0.3 } })), []);
});

test('Maestros con un divisor en cero o un valor negativo: error que nombra la ruta (no un NaN ni un precio infinito)', () => {
  const rutas = [
    [['proceso', 'eficiencia_taller'], 0], [['proceso', 'hoja', 'ancho_mm'], 0], [['proceso', 'hoja', 'largo_mm'], 0], [['proceso', 'semiangulo_max_deg'], 0],
    [['proceso', 'alfa_max_junta_deg'], 0], [['proceso', 'rolado', 'k_conico'], 0], [['proceso', 'rolado', 'n_pasadas'], 0],
    [['proceso', 'soldadura', 'procesos', 'GMAW', 'FO'], 0], [['proceso', 'soldadura', 'procesos', 'GMAW', 'eta_dep'], 0], [['proceso', 'soldadura', 'procesos', 'GMAW', 'v_mult'], 0],
    [['proceso', 'pintura', 'capas', 'primario', 'sv_pct'], 0], [['proceso', 'pintura', 'capas', 'primario', 'dft_um'], 0], [['proceso', 'pintura', 'capas', 'primario', 'eta_transf'], 0],
    [['herrajes', 'uniones', 'BRIDADO', 'paso_tornillo_mm'], 0], [['herrajes', 'uniones', 'BRIDADO', 'multiplo_tornillos'], 0], [['herrajes', 'uniones', 'ESPIGA', 'paso_fijacion_mm'], 0],
    [['herrajes', 'sellador', 'cartucho_ml'], 0], [['materiales', 'ACERO_CARBON', 'densidad_kg_m3'], 0], [['mano_obra', 'FSR'], 0],
    [['proceso', 'limites', 'piezas_max'], 0], [['calibres', 'MSG', '16'], 0],
    [['precios', 'precio_kg_acero_carbon'], -1], [['capas', 'iva_pct'], -0.16], [['proceso', 'armado', 't_junta_base_min'], -3], [['mano_obra', 'operaciones', 'corte', 'salario_diario'], -500],
    [['merma', 'RECTO'], 1], [['merma', 'PERFIL'], 1.5], [['merma', 'CODO'], -0.1],
  ];
  rutas.forEach(([ruta, valor]) => {
    const Mx = crearMaestros();
    let o = Mx; ruta.slice(0, -1).forEach((k) => { o = o[k]; }); o[ruta[ruta.length - 1]] = valor; // a mano: el parche descartaría lo que no es válido
    const dicho = V.problemasMaestros(Mx).map(V.textoProblema).join(' | ');
    assert.ok(dicho.includes(ruta[ruta.length - 1].toString().replace(/_/g, ' ')) || ruta.length === 1, `${ruta.join('.')}=${valor}: ${dicho}`);
    assert.ok(V.problemasMaestros(Mx).length >= 1, `${ruta.join('.')}=${valor}`);
    assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, pintura: 'PRIMARIO' }, Mx), (e) => e instanceof U.ErrorValidacion && /Tablas maestras/.test(e.message), `${ruta.join('.')}=${valor}`);
  });
});

test('Tablas espesor → velocidad: con ceros, desordenadas o rotas se señalan; el resto del cálculo no se cuelga', () => {
  const malas = {
    'velocidad 0': [['proceso', 'corte', 'v_m_min', 'GUILLOTINA'], [[0.5, 9], [1.5, 0], [3, 6]]],
    'espesor 0': [['proceso', 'rolado', 'v_m_min'], [[0, 8], [1, 7]]],
    'desordenada': [['proceso', 'soldadura', 'v_m_min'], [[2, 0.4], [1, 0.7]]],
    'vacía': [['proceso', 'engargolado', 'v_m_min'], []],
    'no es tabla': [['proceso', 'corte', 'v_m_min', 'PLASMA'], 5],
  };
  Object.entries(malas).forEach(([nombre, [ruta, valor]]) => {
    const Mx = crearMaestros();
    let o = Mx; ruta.slice(0, -1).forEach((k) => { o = o[k]; }); o[ruta[ruta.length - 1]] = valor;
    const problemas = V.problemasMaestros(Mx);
    assert.ok(problemas.length > 0, nombre);
    assert.throws(() => C.cotizarPartida(PLANTILLAS.RECTO, Mx), U.ErrorValidacion, nombre);
  });
});

test('Una partida comprada sólo depende de la pila de precio: un error en el proceso no la bloquea', () => {
  const Mx = crearMaestros();
  Mx.proceso.eficiencia_taller = 0;
  assert.doesNotThrow(() => C.cotizarPartida(PLANTILLAS.COMPRADO, Mx));
  assert.throws(() => C.cotizarPartida(PLANTILLAS.RECTO, Mx), /eficiencia taller/);
  Mx.capas.iva_pct = -1;
  assert.throws(() => C.cotizarPartida(PLANTILLAS.COMPRADO, Mx), /iva pct/);
});

test('Secciones de maestros faltantes o con otro tipo: se dice cuáles, sin excepción', () => {
  ['proceso', 'capas', 'herrajes', 'materiales', 'calibres', 'precios'].forEach((s) => {
    [null, 5, 'x', []].forEach((malo) => {
      const Mx = { ...crearMaestros(), [s]: malo };
      const p = V.problemasMaestros(Mx);
      assert.ok(p.some((x) => x.ruta[0] === s), `${s}=${JSON.stringify(malo)}`);
      const res = C.cotizar({ partidas: [PLANTILLAS.RECTO] }, { ...Mx, capas: Mx.capas && typeof Mx.capas === 'object' && !Array.isArray(Mx.capas) ? Mx.capas : crearMaestros().capas });
      assert.equal(res.partidas.length, 1);
    });
  });
  assert.equal(V.problemasMaestros(null).length, 1);
});

test('Los problemas de maestros salen como aviso de la cotización y bloquean sus partidas, no la pantalla', () => {
  const Mx = crearMaestros();
  Mx.proceso.eficiencia_taller = 0;
  const res = C.cotizar({ partidas: [PLANTILLAS.RECTO, PLANTILLAS.COMPRADO] }, Mx);
  assert.equal(res.partidas[0].ok, false);
  assert.match(res.partidas[0].errores[0], /Tablas maestras · proceso › eficiencia taller/);
  assert.equal(res.partidas[1].ok, true);
  assert.match(res.avisos.join(' '), /Tablas maestras con un valor no válido: proceso › eficiencia taller/);
  assert.equal(res.totales.n_partidas_error, 1);
});

test('exigePositivo: lo que el editor de maestros debe rechazar al teclear un cero', () => {
  assert.equal(V.exigePositivo(['proceso', 'eficiencia_taller']), true);
  assert.equal(V.exigePositivo(['proceso', 'soldadura', 'procesos', 'GTAW', 'FO']), true);
  assert.equal(V.exigePositivo(['proceso', 'corte', 'v_m_min', 'PLASMA', 2, 1]), true);
  assert.equal(V.exigePositivo(['calibres', 'MSG', '16']), true);
  assert.equal(V.exigePositivo(['proceso', 'limites', 'largo_max_mm']), true);
  assert.equal(V.exigePositivo(['precios', 'precio_kg_acero_carbon']), false, 'un precio en 0 es válido (gratis)');
  assert.equal(V.exigePositivo(['mano_obra', 'operaciones', 'qc_embalaje', 'equipo_h']), false);
  assert.equal(V.exigePositivo(['capas', 'recuperacion_chatarra_pct']), false);
});

/* ---------- 5 · cotizar() con entradas mal formadas ---------- */

test('cotizar() no lanza con cotizaciones, partidas o parámetros mal formados', () => {
  const buenas = PLANTILLAS.RECTO;
  [null, undefined, 5, 'x', [], {}, { partidas: 'x' }, { partidas: {} }, { partidas: null }, { partidas: 5 }, { partidas: [null, 5, 'x', [], undefined, buenas] },
    { partidas: [buenas], parametros: 'x' }, { partidas: [buenas], parametros: [1] }, { partidas: [buenas], parametros: { utilidad_pct_precio: {} } },
    { partidas: [buenas], defaults: 'x' }, { partidas: [buenas], defaults: [1, 2] }, { partidas: [buenas], riesgo: {} }, { partidas: [buenas], servicio: [] },
  ].forEach((cot) => {
    let res;
    assert.doesNotThrow(() => { res = C.cotizar(cot, M); }, JSON.stringify(cot));
    assert.ok(Array.isArray(res.partidas) && res.totales && Array.isArray(res.avisos), JSON.stringify(cot));
    assert.deepEqual(noFinitos(res.totales), [], JSON.stringify(cot));
  });
  const mezcla = C.cotizar({ partidas: [null, 5, 'x', [], undefined, buenas] }, M);
  assert.deepEqual(mezcla.partidas.map((f) => f.ok), [false, false, false, false, false, true]);
  assert.match(mezcla.partidas[0].errores[0], /La partida no es válida/);
});

test('Una falla inesperada dentro del cálculo de una partida no tumba la cotización: queda como error de esa partida', () => {
  const Mx = crearMaestros();
  Mx.proceso.corte = null; // estructura rota que ninguna validación previa de valores detecta
  const res = C.cotizar({ partidas: [PLANTILLAS.RECTO, PLANTILLAS.COMPRADO] }, Mx);
  assert.equal(res.partidas[0].ok, false);
  assert.equal(res.partidas[0].interno, true);
  assert.match(res.partidas[0].errores[0], /No se pudo calcular esta partida/);
  assert.equal(res.partidas[1].ok, true, 'las demás partidas se calculan');
  assert.equal(res.totales.n_partidas_error, 1);
});

test('Las partidas heredan riesgo y servicio de la cotización; un valor vacío en la partida significa «según la cotización»', () => {
  const sin = { ...PLANTILLAS.RECTO };
  delete sin.riesgo; delete sin.servicio;
  const alto = C.cotizar({ riesgo: 'ALTO', servicio: 'ABRASIVO', partidas: [sin, { ...sin, riesgo: '', servicio: null }, { ...sin, riesgo: 'BAJO' }] }, M);
  assert.equal(alto.partidas[0].pila.riesgo, 'ALTO');
  assert.equal(alto.partidas[1].pila.riesgo, 'ALTO', 'vacío = el de la cotización');
  assert.equal(alto.partidas[2].pila.riesgo, 'BAJO', 'lo propio de la partida manda');
  assert.equal(alto.partidas[1].entrada.servicio, 'ABRASIVO');
});

/* ---------- 6 · parches de maestros que vienen de fuera ---------- */

test('sanearParche: conserva lo que tiene la forma de las tablas y descarta (anotando la ruta) lo que no', () => {
  const sucio = {
    precios: { precio_kg_acero_carbon: 'veinte', precio_kg_solera: 30, precio_nuevo_material: 5, otro: null },
    proceso: {
      hoja: null, eficiencia_taller: 0.9, angulos_codo_deg: [], angulos_injerto_deg: [30, 'x'], limites: { piezas_max: 50, largo_max_mm: [1] },
      corte: { v_m_min: { PLASMA: [[1, 2], [3, 'x']] } },
    },
    capas: { financiamiento: { tasa_anual: 0.1, dias_cobro: Infinity }, imprevistos_pct: 7 },
    mano_obra: { operaciones: { corte: { salario_diario: '500', equipo_h: 40 } } },
    herrajes: 'nada', materiales: [], desconocida: { a: 1 },
  };
  const copia = structuredClone(sucio);
  const { parche, descartados } = sanearParche(sucio);
  assert.deepEqual(sucio, copia, 'no muta lo recibido');
  assert.deepEqual(parche, {
    precios: { precio_kg_solera: 30, precio_nuevo_material: 5 },
    proceso: { eficiencia_taller: 0.9, limites: { piezas_max: 50 } },
    capas: { financiamiento: { tasa_anual: 0.1 } },
    mano_obra: { operaciones: { corte: { equipo_h: 40 } } },
    desconocida: { a: 1 },
  });
  assert.deepEqual(descartados.sort(), [
    'capas.financiamiento.dias_cobro', 'capas.imprevistos_pct', 'herrajes', 'mano_obra.operaciones.corte.salario_diario', 'materiales', 'precios.otro', 'precios.precio_kg_acero_carbon',
    'proceso.angulos_codo_deg', 'proceso.angulos_injerto_deg', 'proceso.corte.v_m_min.PLASMA', 'proceso.hoja', 'proceso.limites.largo_max_mm',
  ].sort());
});

test('sanearParche: lo que no es un objeto se descarta entero y __proto__ nunca entra', () => {
  [null, undefined].forEach((x) => assert.deepEqual(sanearParche(x), { parche: {}, descartados: [] }));
  ['x', 5, [1], true].forEach((x) => assert.deepEqual(sanearParche(x), { parche: {}, descartados: ['(todo el parche)'] }));
  const hostil = JSON.parse('{"__proto__":{"polluted":true},"proceso":{"__proto__":{"polluted":true},"eficiencia_taller":0.7}}');
  const { parche } = sanearParche(hostil);
  assert.deepEqual(parche, { proceso: { eficiencia_taller: 0.7 } });
  assert.equal(({}).polluted, undefined);
  assert.equal(crearMaestros(hostil).proceso.eficiencia_taller, 0.7);
  assert.equal(({}).polluted, undefined);
});

test('crearMaestros(parche) siempre da maestros con la forma de las tablas, aunque el parche venga dañado', () => {
  const dañado = { proceso: { hoja: 'grande', corte: null, rolado: { v_m_min: 'rápido' } }, precios: 7, capas: { imprevistos_pct: { BAJO: 'poco' } }, herrajes: { perfiles: [] } };
  const Mx = crearMaestros(dañado);
  assert.deepEqual(V.problemasMaestros(Mx), []);
  assert.deepEqual(Mx.proceso.hoja, M.proceso.hoja);
  assert.deepEqual(Mx.capas.imprevistos_pct, M.capas.imprevistos_pct);
  assert.doesNotThrow(() => C.cotizarPartida(PLANTILLAS.RECTO, Mx));
  assert.deepEqual(leerParche({ mano_obra: { jornada_h: 9, operaciones: { corte: { salario_hora: 500 } } }, precios: { precio_kg_solera: 31 } }).parche,
    { mano_obra: { jornada: { horas_dia: 9 } }, precios: { precio_kg_solera: 31 } }, 'también pone al día lo de versiones anteriores (la jornada pasa a horas por día; el salario por hora se descarta)');
});

test('Valores no válidos escritos a mano en los maestros (a diferencia de un parche) los detecta problemasMaestros', () => {
  const Mx = crearMaestros();
  Mx.precios.precio_kg_acero_carbon = NaN;
  Mx.capas.financiamiento.tasa_anual = Infinity;
  const textos = V.problemasMaestros(Mx).map(V.textoProblema);
  assert.equal(textos.length, 2, textos.join(' | '));
  assert.match(textos.join(' '), /precio kg acero carbon/);
  assert.match(textos.join(' '), /tasa anual/);
});

test('Extremos sin brida y bridas de otra partida: sólo valores de la familia y sí/no; lo válido se calcula', () => {
  const codo = PLANTILLAS.CODO;
  [['X'], 'A', [1], [null], {}, true, 5, [['A']]].forEach((x) => assert.throws(() => C.cotizarPartida({ ...codo, extremos_sin_brida: x }, M), /Extremos sin brida/, JSON.stringify(x)));
  assert.throws(() => C.cotizarPartida({ ...PLANTILLAS.RECTO, extremos_sin_brida: ['A'] }, M), /Extremos sin brida: no aplica/, 'el tramo recto lo dice con su extremo final');
  [[], null, '', undefined, ['A'], ['B', 'A', 'A']].forEach((x) => assert.doesNotThrow(() => C.cotizarPartida({ ...codo, extremos_sin_brida: x }, M), JSON.stringify(x)));
  assert.deepEqual(C.cotizarPartida({ ...codo, extremos_sin_brida: ['B', 'A', 'A'] }, M).geometria.extremos_sin_brida, ['A', 'B'], 'sin repetidos, en el orden de la pieza');
  ['si', 1, 0, [], {}].forEach((x) => assert.throws(() => C.cotizarPartida({ ...codo, bridas_aparte: x }, M), /Bridas de otra partida: .* no es sí\/no/, JSON.stringify(x)));
  [true, false, '', null].forEach((x) => assert.doesNotThrow(() => C.cotizarPartida({ ...codo, bridas_aparte: x }, M), String(x)));
  // con espiga o liso, «bridas de otra partida» no hace nada
  ['ESPIGA', 'LISO'].forEach((t) => assert.equal(C.cotizarPartida({ ...codo, tipo_union: t, bridas_aparte: true }, M).precio.importe, C.cotizarPartida({ ...codo, tipo_union: t }, M).precio.importe, t));
});
