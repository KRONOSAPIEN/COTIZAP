'use strict';
/**
 * Guardado automático de las tablas maestras (src/web/almacen.js) con un almacén y un localStorage de mentira.
 * Lo que se verifica es la política: qué se guarda, cuándo, de a cuántas escrituras, y qué manda al abrir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../src/web/almacen');
const U = require('../src/motor/util');
const { crearMaestros } = require('../src/datos/maestros');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const RUTA = 'config/maestros';
const LLAVE = 'cotizap.maestros.pendiente';
const copia = (o) => JSON.parse(JSON.stringify(o));

/** Documentos en memoria con la misma forma que la capacidad `db`. */
function crearBD(docs = {}) {
  const mapa = new Map(Object.entries(docs).map(([k, v]) => [k, copia(v)]));
  let enVuelo = 0;
  const bd = {
    mapa, escrituras: [], maxEnVuelo: 0, retardoSet: 0, fallos: [], siempreFalla: null, lecturaFalla: null,
    doc(ruta) {
      return {
        path: ruta,
        get: async () => {
          if (bd.lecturaFalla) throw bd.lecturaFalla;
          const d = mapa.get(ruta);
          return { exists: d !== undefined, data: () => (d === undefined ? undefined : copia(d)) };
        },
        set: async (datos) => {
          enVuelo += 1;
          bd.maxEnVuelo = Math.max(bd.maxEnVuelo, enVuelo);
          try {
            await dormir(bd.retardoSet);
            const f = bd.siempreFalla || bd.fallos.shift();
            if (f) throw Object.assign(new Error(f.code), { code: f.code });
            mapa.set(ruta, copia(datos));
            bd.escrituras.push(copia(datos));
          } finally { enVuelo -= 1; }
        },
      };
    },
  };
  return bd;
}

const crearClaude = (bd, { db = true, usuario = true, puedeEditar = true } = {}) => ({
  use: async (nombre) => {
    if (nombre === 'db') return db ? bd : null;
    if (nombre === 'user') return usuario ? { canEdit: async () => puedeEditar } : null;
    return null;
  },
});

function crearLS(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, copia(v)]));
  return { m, leer: (k) => (m.has(k) ? copia(m.get(k)) : null), guardar: (k, v) => { m.set(k, copia(v)); }, borrar: (k) => { m.delete(k); } };
}

/** Un almacén con tiempos cortos; devuelve también los estados que fue anunciando. */
function armar({ bd = crearBD(), claude, ls = crearLS(), conClaude = true } = {}) {
  const estados = [];
  const almacen = A.crear({
    claude: () => (conClaude ? (claude || crearClaude(bd)) : undefined),
    ls,
    llavePendiente: LLAVE,
    alEstado: (e, info) => estados.push([e, info]),
    tiempos: { debounce_ms: 5, reintento_ms: [5, 5, 5], esperar: () => Promise.resolve(), aleatorio: () => 0, ahora: () => Date.UTC(2026, 9, 5, 18, 30) },
  });
  return { almacen, bd, ls, estados, ultimo: () => estados[estados.length - 1] };
}

const doc = (parche) => ({ v: 2, parche, actualizado: '2026-10-05T18:30:00.000Z' });

/* ====================================================================== */
/* Apertura: de dónde sale el parche                                      */
/* ====================================================================== */

test('Fuera de un artefacto (sin claude): sólo este navegador, sin escribir nada', async () => {
  const t = armar({ conClaude: false });
  const r = await t.almacen.iniciar({ precios: { precio_kg_acero_carbon: 25 } });
  assert.equal(r.origen, 'local');
  assert.deepEqual(r.parche, { precios: { precio_kg_acero_carbon: 25 } });
  assert.equal(t.ultimo()[0], 'local');
  assert.equal(t.ultimo()[1].motivo, 'sin-artefacto');
  t.almacen.programar({ precios: { precio_kg_acero_carbon: 30 } });
  await t.almacen.vaciar();
  assert.equal(t.ls.leer(LLAVE), null, 'sin artefacto no hay nada que subir');
  assert.equal(t.bd.escrituras.length, 0);
});

test('Sin la capacidad db: se avisa "sólo este navegador" y el cambio queda marcado para subirse después', async () => {
  const bd = crearBD();
  const t = armar({ bd, claude: crearClaude(bd, { db: false }) });
  const r = await t.almacen.iniciar({});
  assert.equal(r.origen, 'local');
  assert.deepEqual(t.ultimo().slice(0, 1), ['local']);
  assert.equal(t.ultimo()[1].motivo, 'sin-db');
  t.almacen.programar({ precios: { precio_kg_acero_carbon: 31 } });
  assert.equal(t.ls.leer(LLAVE), true, 'queda pendiente: se sube cuando haya conexión');
  assert.equal(bd.escrituras.length, 0);
});

test('Primera vez (nada guardado) y sin ediciones: no se escribe ni se crea el documento', async () => {
  const t = armar();
  const r = await t.almacen.iniciar({});
  assert.equal(r.origen, 'local');
  t.almacen.programar({});
  await t.almacen.vaciar();
  assert.equal(t.bd.escrituras.length, 0);
  assert.equal(t.bd.mapa.has(RUTA), false);
  assert.equal(t.ultimo()[0], 'guardado');
});

test('Primera vez con precios ya capturados en este navegador: se suben al artefacto', async () => {
  const t = armar();
  const local = { precios: { precio_kg_acero_carbon: 25 } };
  const r = await t.almacen.iniciar(local);
  assert.equal(r.origen, 'local');
  t.almacen.programar(local);
  await t.almacen.vaciar();
  assert.equal(t.bd.escrituras.length, 1);
  assert.deepEqual(t.bd.mapa.get(RUTA).parche, local);
  assert.equal(t.bd.mapa.get(RUTA).v, 2);
  assert.equal(t.bd.mapa.get(RUTA).actualizado, '2026-10-05T18:30:00.000Z');
  assert.equal(t.ls.leer(LLAVE), null, 'una vez confirmada la escritura ya no hay pendiente');
  assert.equal(t.ultimo()[0], 'guardado');
  assert.equal(t.ultimo()[1].hora, Date.UTC(2026, 9, 5, 18, 30));
});

test('Lo guardado en el artefacto manda al abrir (aunque este navegador esté vacío o tenga otra cosa)', async () => {
  const guardado = { precios: { precio_kg_acero_carbon: 27 }, mano_obra: { FSR: 1.6 } };
  const t = armar({ bd: crearBD({ [RUTA]: doc(guardado) }) });
  const r = await t.almacen.iniciar({ precios: { precio_kg_acero_carbon: 99 } });
  assert.equal(r.origen, 'remoto');
  assert.deepEqual(r.parche, guardado);
  // y como la app vuelve a llamar a programar con el parche vigente, no se reescribe lo que ya está
  t.almacen.programar(guardado);
  await t.almacen.vaciar();
  assert.equal(t.bd.escrituras.length, 0);
});

test('Cambios locales que no llegaron a subirse (pendiente) ganan y se suben', async () => {
  const guardado = { precios: { precio_kg_acero_carbon: 27 } };
  const local = { precios: { precio_kg_acero_carbon: 29 } };
  const t = armar({ bd: crearBD({ [RUTA]: doc(guardado) }), ls: crearLS({ [LLAVE]: true }) });
  const r = await t.almacen.iniciar(local);
  assert.equal(r.origen, 'local');
  assert.deepEqual(r.parche, local);
  t.almacen.programar(local);
  await t.almacen.vaciar();
  assert.deepEqual(t.bd.mapa.get(RUTA).parche, local);
  assert.equal(t.ls.leer(LLAVE), null);
});

test('Pendiente que ya coincide con lo guardado (la escritura sí llegó): se limpia la bandera', async () => {
  const mismo = { precios: { precio_kg_acero_carbon: 27 } };
  const t = armar({ bd: crearBD({ [RUTA]: doc(mismo) }), ls: crearLS({ [LLAVE]: true }) });
  await t.almacen.iniciar(mismo);
  assert.equal(t.ls.leer(LLAVE), null);
  assert.equal(t.bd.escrituras.length, 0);
});

test('Si no se puede leer el artefacto: se sigue en este navegador y no se pisa lo guardado', async () => {
  const bd = crearBD({ [RUTA]: doc({ precios: { precio_kg_acero_carbon: 27 } }) });
  bd.lecturaFalla = Object.assign(new Error('x'), { code: 'resource_exhausted' });
  const t = armar({ bd });
  const r = await t.almacen.iniciar({});
  assert.equal(r.origen, 'local');
  assert.equal(t.ultimo()[1].motivo, 'sin-lectura');
  t.almacen.programar({ precios: { precio_kg_acero_carbon: 40 } });
  await t.almacen.vaciar();
  assert.equal(bd.escrituras.length, 0, 'sin haber leído no se sobrescribe lo que haya guardado');
  assert.equal(t.ls.leer(LLAVE), true, 'pero queda pendiente para subirlo en la próxima apertura');
});

test('Si algo inesperado falla al abrir (p. ej. no se puede leer la bandera local): se sigue en este navegador sin romper', async () => {
  const bd = crearBD({ [RUTA]: doc({ precios: { a: 1 } }) });
  const ls = crearLS();
  ls.leer = () => { throw new Error('almacenamiento roto'); };
  const t = armar({ bd, ls });
  const r = await t.almacen.iniciar({ precios: { a: 5 } });
  assert.equal(r.origen, 'local');
  assert.deepEqual(r.parche, { precios: { a: 5 } });
  assert.equal(t.ultimo()[0], 'local');
  assert.equal(t.almacen.estado(), 'local');
});

test('Una lectura que falla una vez por "unavailable" se reintenta', async () => {
  const bd = crearBD({ [RUTA]: doc({ precios: { precio_kg_acero_carbon: 27 } }) });
  const get = bd.doc.bind(bd);
  let intentos = 0;
  bd.doc = (ruta) => {
    const d = get(ruta);
    const original = d.get;
    d.get = async () => { intentos += 1; if (intentos === 1) throw Object.assign(new Error('u'), { code: 'unavailable' }); return original(); };
    return d;
  };
  const t = armar({ bd });
  const r = await t.almacen.iniciar({});
  assert.equal(intentos, 2);
  assert.equal(r.origen, 'remoto');
});

/* ====================================================================== */
/* Guardado: cuándo y de a cuántas                                        */
/* ====================================================================== */

test('Una ráfaga de cambios se junta en una sola escritura con el último valor', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  [26, 27, 28, 29].forEach((v) => t.almacen.programar({ precios: { precio_kg_acero_carbon: v } }));
  assert.equal(t.ultimo()[0], 'guardando');
  await dormir(40);
  assert.equal(t.bd.escrituras.length, 1);
  assert.deepEqual(t.bd.escrituras[0].parche, { precios: { precio_kg_acero_carbon: 29 } });
  assert.equal(t.ultimo()[0], 'guardado');
});

test('Sin cambios reales no se escribe: programar con el mismo parche no hace nada', async () => {
  const guardado = { precios: { precio_kg_acero_carbon: 27 } };
  const t = armar({ bd: crearBD({ [RUTA]: doc(guardado) }) });
  await t.almacen.iniciar(guardado);
  t.almacen.programar(copia(guardado));
  await dormir(20);
  assert.equal(t.bd.escrituras.length, 0);
  assert.equal(t.ls.leer(LLAVE), null);
});

test('Una escritura a la vez por documento: lo que llega durante una escritura va en la vuelta siguiente', async () => {
  const bd = crearBD();
  bd.retardoSet = 25;
  const t = armar({ bd });
  await t.almacen.iniciar({});
  t.almacen.programar({ precios: { a: 1 } });
  const primera = t.almacen.vaciar();
  t.almacen.programar({ precios: { a: 2 } });
  t.almacen.programar({ precios: { a: 3 } });
  await primera;
  await dormir(40);
  assert.equal(bd.maxEnVuelo, 1, 'nunca dos escrituras simultáneas');
  assert.deepEqual(bd.escrituras.map((e) => e.parche), [{ precios: { a: 1 } }, { precios: { a: 3 } }]);
  assert.equal(t.ls.leer(LLAVE), null);
});

test('El cambio queda marcado como pendiente desde que se programa y hasta que se confirma', async () => {
  const bd = crearBD();
  bd.retardoSet = 20;
  const t = armar({ bd });
  await t.almacen.iniciar({});
  t.almacen.programar({ precios: { a: 1 } });
  assert.equal(t.ls.leer(LLAVE), true, 'si se cierra la página ahora, la próxima apertura lo sube');
  await t.almacen.vaciar();
  assert.equal(t.ls.leer(LLAVE), null);
});

test('vaciar() escribe de inmediato (al ocultar o cerrar la página) sin esperar la pausa', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.almacen.programar({ precios: { a: 1 } });
  await t.almacen.vaciar();
  assert.equal(t.bd.escrituras.length, 1);
});

test('Un cambio hecho mientras se consulta el almacén no se escribe hasta decidir qué manda', async () => {
  const t = armar({ bd: crearBD({ [RUTA]: doc({ precios: { a: 1 } }) }) });
  const abierto = t.almacen.iniciar({});
  t.almacen.programar({ precios: { a: 9 } }); // aún cargando
  await abierto;
  await dormir(20);
  assert.equal(t.bd.escrituras.length, 0);
});

/* ====================================================================== */
/* Fallos                                                                 */
/* ====================================================================== */

test('"unavailable" en una escritura se reintenta una vez enseguida', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.bd.fallos = [{ code: 'unavailable' }];
  t.almacen.programar({ precios: { a: 1 } });
  await t.almacen.vaciar();
  assert.equal(t.bd.escrituras.length, 1);
  assert.equal(t.ultimo()[0], 'guardado');
});

test('Un fallo que no es de permisos: se avisa, el cambio sigue pendiente y se reintenta solo', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.bd.fallos = [{ code: 'resource_exhausted' }];
  t.almacen.programar({ precios: { a: 1 } });
  await t.almacen.vaciar();
  assert.equal(t.ultimo()[0], 'error');
  assert.equal(t.ls.leer(LLAVE), true);
  await dormir(60); // reintento automático
  assert.equal(t.bd.escrituras.length, 1);
  assert.equal(t.ultimo()[0], 'guardado');
  assert.equal(t.ls.leer(LLAVE), null);
});

test('Si el fallo no cede, los reintentos automáticos se acaban y el botón "Reintentar" lo retoma', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.bd.siempreFalla = { code: 'resource_exhausted' };
  t.almacen.programar({ precios: { a: 1 } });
  await dormir(120);
  assert.equal(t.ultimo()[0], 'error');
  const intentosFallidos = t.estados.filter(([e]) => e === 'error').length;
  assert.ok(intentosFallidos >= 2 && intentosFallidos <= 7, `reintentos acotados (${intentosFallidos})`);
  await dormir(40);
  assert.equal(t.estados.filter(([e]) => e === 'error').length, intentosFallidos, 'ya no sigue intentando solo');
  t.bd.siempreFalla = null;
  await t.almacen.reintentar();
  assert.equal(t.ultimo()[0], 'guardado');
  assert.deepEqual(t.bd.mapa.get(RUTA).parche, { precios: { a: 1 } });
});

test('Sin espacio (quota_exceeded): se avisa y no se reintenta a ciegas', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.bd.siempreFalla = { code: 'quota_exceeded' };
  t.almacen.programar({ precios: { a: 1 } });
  await dormir(60);
  const n = t.estados.filter(([e]) => e === 'error').length;
  assert.equal(n, 1);
  assert.equal(t.ultimo()[1].codigo, 'quota_exceeded');
});

test('Si la escritura es rechazada por permisos: pasa a sólo lectura y no deja pendiente', async () => {
  const t = armar();
  await t.almacen.iniciar({});
  t.bd.fallos = [{ code: 'invalid_argument' }];
  t.almacen.programar({ precios: { a: 1 } });
  await t.almacen.vaciar();
  assert.equal(t.ultimo()[0], 'lectura');
  assert.equal(t.almacen.soloLectura(), true);
  assert.equal(t.ls.leer(LLAVE), null);
  t.almacen.programar({ precios: { a: 2 } });
  await dormir(20);
  assert.equal(t.bd.escrituras.length, 0, 'ya no intenta escribir');
});

/* ====================================================================== */
/* Permisos                                                               */
/* ====================================================================== */

test('Quien no puede editar (canEdit = false) ve los precios guardados y no escribe nada', async () => {
  const guardado = { precios: { precio_kg_acero_carbon: 27 } };
  const bd = crearBD({ [RUTA]: doc(guardado) });
  const t = armar({ bd, claude: crearClaude(bd, { puedeEditar: false }), ls: crearLS({ [LLAVE]: true }) });
  const r = await t.almacen.iniciar({ precios: { precio_kg_acero_carbon: 99 } });
  assert.equal(r.origen, 'remoto', 'manda lo compartido aunque su navegador tenga otra cosa');
  assert.deepEqual(r.parche, guardado);
  assert.equal(t.ultimo()[0], 'lectura');
  assert.equal(t.ultimo()[1].soloLectura, true);
  assert.equal(t.ls.leer(LLAVE), null, 'una bandera vieja no se arrastra');
  t.almacen.programar({ precios: { precio_kg_acero_carbon: 1 } });
  await dormir(20);
  assert.equal(bd.escrituras.length, 0);
});

test('Si la capacidad user no responde, se intenta escribir y manda el rechazo', async () => {
  const bd = crearBD();
  const t = armar({ bd, claude: crearClaude(bd, { usuario: false }) });
  await t.almacen.iniciar({});
  t.almacen.programar({ precios: { a: 1 } });
  await t.almacen.vaciar();
  assert.equal(bd.escrituras.length, 1);
});

/* ====================================================================== */
/* Datos que vienen de fuera                                              */
/* ====================================================================== */

test('Un documento mal formado en el almacén se trata como vacío', async () => {
  const t = armar({ bd: crearBD({ [RUTA]: { v: 2, parche: 'no soy un objeto' } }) });
  const r = await t.almacen.iniciar({ precios: { a: 5 } });
  assert.equal(r.origen, 'local');
  assert.deepEqual(r.parche, { precios: { a: 5 } });
});

/* ====================================================================== */
/* Migración de la versión 1                                              */
/* ====================================================================== */

test('parcheDesdeV1: conserva lo editado y descarta herrajes viejos, meta y el empaque de entonces', () => {
  const base = crearMaestros();
  const v1 = copia(base);
  v1.meta = { ...v1.meta, version: '1.0.0-ilustrativo', revisado: true, editado: true };
  v1.precios.precio_kg_acero_carbon = 25;
  v1.precios.precio_m_empaque_neopreno = 18; // valor de arranque de la versión 1: no es una edición
  v1.mano_obra.FSR = 1.6;
  v1.herrajes = { seleccion_perfil: [{ hasta_mm: 150, perfil: 'L25x3.2' }, { hasta_mm: 99999, perfil: 'L64x6.4' }] };
  const p = A.parcheDesdeV1(base, v1);
  assert.deepEqual(p, { precios: { precio_kg_acero_carbon: 25 }, mano_obra: { FSR: 1.6 }, meta: { revisado: true, editado: true } });
  const M = U.mezclar(base, p);
  assert.equal(M.herrajes.seleccion_perfil.length, 1, 'manda la brida estándar del taller');
  assert.equal(M.precios.precio_m_empaque_neopreno, 28, 'el valor de arranque nuevo no queda tapado');
});

test('parcheDesdeV1: un empaque que el usuario sí cambió se respeta; sin ediciones el parche es vacío', () => {
  const base = crearMaestros();
  const v1 = copia(base);
  v1.precios.precio_m_empaque_neopreno = 20;
  assert.deepEqual(A.parcheDesdeV1(base, v1), { precios: { precio_m_empaque_neopreno: 20 } });
  assert.deepEqual(A.parcheDesdeV1(base, copia(base)), {});
  assert.deepEqual(A.parcheDesdeV1(base, null), {});
  assert.deepEqual(A.parcheDesdeV1(base, [1, 2]), {});
});
