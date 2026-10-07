'use strict';
/**
 * Ayuda de las tablas maestras (datos/ayuda_maestros.js).
 * Lo que importa: NINGÚN dato que el editor dibuja se queda sin explicación, los textos son breves y completos, los rangos usuales
 * contienen a los valores de arranque, y las listas de opciones que la ayuda describe son las que el motor realmente acepta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/datos/ayuda_maestros');
const { crearMaestros } = require('../src/datos/maestros');
const GEO = require('../src/motor/geometria');
const MAT = require('../src/motor/material');
const V = require('../src/motor/validacion');

const M = crearMaestros();
const unidades = A.recorrer(M);
const leer = (ruta) => ruta.reduce((o, k) => o[k], M);
const clave = (ruta) => ruta.join('.');

test('recorrer: ve los mismos datos que dibuja el editor (grupos, secciones, datos y tablas)', () => {
  const porTipo = (t) => unidades.filter((u) => u.tipo === t).length;
  assert.equal(porTipo('grupo'), 12);
  assert.equal(porTipo('tabla'), 13, 'tablas: servicios 3, proveedor 2, velocidades de corte 3, rolado, engargolado, soldadura, selección de perfil y bridas por metros');
  assert.ok(unidades.some((u) => u.tipo === 'sub' && clave(u.ruta) === 'proceso.soldadura.procesos.GMAW'));
  assert.ok(unidades.some((u) => u.tipo === 'fila' && clave(u.ruta) === 'herrajes.perfiles.SOL38x4.8.ancho_mm'), 'las claves con punto (SOL38x4.8) son una sola clave');
  assert.ok(unidades.some((u) => u.tipo === 'fila' && clave(u.ruta) === 'proceso.costuras.PITTSBURGH.cordon'), 'un valor null se dibuja como dato');
  assert.ok(!unidades.some((u) => u.ruta[0] === 'meta'), 'meta no se muestra');
  assert.ok(!unidades.some((u) => u.ruta[0] === 'proveedor' && u.ruta.length > 2), 'de cada renglón del proveedor sólo se captura el precio: el editor muestra tablas, no sus campos');
  const unicas = new Set(unidades.map((u) => JSON.stringify(u.ruta)));
  assert.equal(unicas.size, unidades.length, 'sin rutas repetidas');
});

test('cobertura: todo dato, sección, tabla y grupo del editor tiene su explicación', () => {
  const sin = unidades.filter((u) => !A.buscar(u.ruta)).map((u) => `${u.tipo} ${clave(u.ruta)}`);
  assert.deepEqual(sin, [], `sin ayuda: ${sin.join(', ')}`);
});

test('cobertura: ninguna entrada del catálogo quedó sin uso (patrón que ya no coincide con ningún dato)', () => {
  const muertas = A.CATALOGO.filter((e) => !unidades.some((u) => A.coincide(e.patron.split('.'), u.ruta))).map((e) => e.patron);
  assert.deepEqual(muertas, []);
  const patrones = A.CATALOGO.map((e) => e.patron);
  assert.equal(new Set(patrones).size, patrones.length, 'sin patrones repetidos');
});

test('cobertura: cada patrón se usa de verdad (la primera entrada que coincide es la suya, nadie la tapa)', () => {
  const tapadas = A.CATALOGO.filter((e) => {
    const usadas = unidades.filter((u) => A.coincide(e.patron.split('.'), u.ruta));
    return usadas.length && usadas.every((u) => A.buscar(u.ruta).patron !== e.patron);
  }).map((e) => e.patron);
  assert.deepEqual(tapadas, [], 'una entrada anterior, más general, tapa a estas');
});

test('textos: completos, breves, sin marcas sin resolver ni nombres técnicos a la vista', () => {
  const LIM = { t: 70, que: 260, como: 300, efecto: 300, ej: 170, ojo: 230, esp: 130, origenTxt: 130 };
  const fallas = [];
  unidades.forEach((u) => {
    const a = A.buscar(u.ruta);
    ['t', 'que', 'como', 'efecto'].forEach((c) => {
      if (typeof a[c] !== 'string' || a[c].trim() === '') fallas.push(`${clave(u.ruta)}: falta ${c}`);
    });
    ['t', 'que', 'como', 'efecto', 'ej', 'ojo', 'esp', 'origenTxt'].forEach((c) => {
      const x = a[c];
      if (x === null || x === undefined) return;
      if (x.length > LIM[c]) fallas.push(`${clave(u.ruta)}.${c}: ${x.length} caracteres (máx. ${LIM[c]})`);
      if (/\{\d+\}/.test(x)) fallas.push(`${clave(u.ruta)}.${c}: marca sin resolver`);
      if (/ {2}|\bTODO\b|\bundefined\b|\bnull\b/.test(x)) fallas.push(`${clave(u.ruta)}.${c}: texto sospechoso`);
      if (/[A-Z]{2,}_[A-Z]{2,}/.test(x) && c === 't') fallas.push(`${clave(u.ruta)}.t: nombre técnico sin traducir («${x}»)`);
      if (c !== 't' && !/[.?!)″»:%]$/.test(x)) fallas.push(`${clave(u.ruta)}.${c}: no termina en puntuación («…${x.slice(-12)}»)`);
    });
    if (!a.afecta.length) fallas.push(`${clave(u.ruta)}: no dice qué mueve`);
    a.afecta.forEach((k) => { if (!A.AFECTA[k]) fallas.push(`${clave(u.ruta)}: afecta «${k}» no existe`); });
  });
  assert.deepEqual(fallas, []);
});

test('títulos: distintos entre sí dentro de un grupo (si no, el usuario no distingue un renglón de otro)', () => {
  const vistos = new Map();
  const choques = [];
  unidades.filter((u) => u.tipo === 'fila' || u.tipo === 'tabla').forEach((u) => {
    const t = `${u.ruta[0]}|${A.buscar(u.ruta).t}`;
    if (vistos.has(t)) choques.push(`${clave(u.ruta)} ≡ ${clave(vistos.get(t))}: «${A.buscar(u.ruta).t}»`);
    else vistos.set(t, u.ruta);
  });
  assert.deepEqual(choques, []);
});

test('rangos usuales: el valor de arranque de cada número cae dentro de su rango, y cada número lo tiene', () => {
  const fallas = [];
  unidades.filter((u) => u.tipo === 'fila' && typeof leer(u.ruta) === 'number').forEach((u) => {
    const a = A.buscar(u.ruta);
    if (!a.tip) { fallas.push(`${clave(u.ruta)}: sin rango usual`); return; }
    if (!(a.tip[0] < a.tip[1])) fallas.push(`${clave(u.ruta)}: rango invertido`);
    const v = A.mostrado(u.ruta, leer(u.ruta));
    if (A.fueraDeRango(a, v) !== 0) fallas.push(`${clave(u.ruta)}: ${v} fuera de ${a.tip}`);
  });
  assert.deepEqual(fallas, []);
});

test('fueraDeRango: marca por debajo, por encima y sin rango', () => {
  const a = { tip: [10, 20] };
  assert.equal(A.fueraDeRango(a, 5), -1);
  assert.equal(A.fueraDeRango(a, 25), 1);
  assert.equal(A.fueraDeRango(a, 10), 0);
  assert.equal(A.fueraDeRango(a, 20), 0);
  assert.equal(A.fueraDeRango({ tip: null }, 5), 0);
  assert.equal(A.fueraDeRango(a, 'texto'), 0);
  assert.equal(A.fueraDeRango(null, 5), 0);
});

test('tablas: la ayuda explica exactamente las columnas que el editor dibuja', () => {
  const ESPERADAS = (u) => {
    const k = clave(u.ruta);
    if (k === 'proveedor.hojas') return ['Concepto', 'Hoja', 'Precio cotizado (con IVA)', 'Sin IVA', 'kg por hoja', '$/kg sin IVA', 'Uso'];
    if (k === 'proveedor.barras') return ['Concepto', 'Barra', 'Precio cotizado (con IVA)', 'Sin IVA', 'kg por barra', '$/kg sin IVA', 'Uso'];
    const t = leer(u.ruta);
    if (Array.isArray(t[0]) && t[0].length === 2) return ['Espesor (mm)', 'Velocidad (m/min)'];
    return Object.keys(t[0]).map((c) => A.etiqueta(c));
  };
  const fallas = [];
  unidades.filter((u) => u.tipo === 'tabla').forEach((u) => {
    const a = A.buscar(u.ruta);
    const esperadas = ESPERADAS(u);
    if (!a.cols) { fallas.push(`${clave(u.ruta)}: sin columnas explicadas`); return; }
    assert.deepEqual(Object.keys(a.cols), esperadas, clave(u.ruta));
  });
  assert.deepEqual(fallas, []);
});

test('renglón específico: las familias, operaciones y límites traen su propia línea', () => {
  assert.deepEqual(Object.keys(M.merma).filter((k) => !A.buscar(['merma', k]).esp), [], 'merma por familia');
  assert.deepEqual(Object.keys(M.proceso.armado.k_dif).filter((k) => !A.buscar(['proceso', 'armado', 'k_dif', k]).esp), [], 'dificultad de armado por familia');
  assert.deepEqual(Object.keys(M.proceso.limites).filter((k) => !A.buscar(['proceso', 'limites', k]).esp), [], 'límites de captura');
  assert.equal(A.buscar(['mano_obra', 'operaciones', 'corte', 'salario_diario']).esp, null, 'las operaciones usan el nombre en el título, no una línea aparte');
  assert.equal(A.buscar(['merma', 'CODO']).t, 'Merma · Codo');
  assert.equal(A.buscar(['mano_obra', 'operaciones', 'qc_embalaje', 'equipo_h']).t, 'Costo del equipo por hora · Inspección y embalaje');
  assert.equal(A.buscar(['materiales', 'GALVANIZADO', 'pintura_bridas', 'EXTERIOR']).t, 'Pintura de las bridas · galvanizado · en exterior');
  assert.equal(A.buscar(['herrajes', 'perfiles', 'SOL38x4.8', 'ancho_mm']).t, 'Ancho del perfil · SOL38x4.8');
});

test('opciones: lo que la ayuda describe son los valores que el motor acepta', () => {
  const claves = (o) => Object.keys(o).sort();
  assert.deepEqual(claves(A.buscar(['proceso', 'armado_yardas', 'extremo_ajuste_defecto']).opc), [...GEO.EXTREMOS_AJUSTE].sort());
  assert.deepEqual(claves(A.buscar(['proceso', 'pintura', 'ubicacion_defecto']).opc), [...MAT.UBICACIONES].sort());
  assert.deepEqual(claves(A.buscar(['proceso', 'corte', 'proceso_recto']).opc), claves(M.proceso.corte.v_m_min));
  assert.deepEqual(claves(A.buscar(['proceso', 'corte', 'proceso_perfilado']).opc), claves(M.proceso.corte.v_m_min));
  assert.deepEqual(claves(A.buscar(['proceso', 'injerto_inclinado_hacia']).opc), ['MAYOR', 'MENOR']);
  assert.deepEqual(claves(A.buscar(['herrajes', 'perfiles', 'SOL38x4.8', 'tipo']).opc), ['ANGULO', 'SOLERA']);
  assert.deepEqual(claves(A.buscar(['proceso', 'costuras', 'A_TOPE', 'soldada']).opc), ['false', 'true']);
  assert.deepEqual(claves(A.buscar(['proceso', 'costuras', 'A_TOPE', 'cordon']).opc), ['', 'FILETE', 'TOPE']);
  ['pintura_cuerpo', 'pintura_bridas'].forEach((p) => assert.deepEqual(claves(A.buscar(['materiales', 'ACERO_CARBON', p, 'INTERIOR']).opc), claves(M.proceso.pintura.sistemas), p));
  // y los datos de arranque de esas listas están entre sus opciones
  assert.ok(Object.keys(A.buscar(['proceso', 'costuras', 'PITTSBURGH', 'cordon']).opc).includes(''), 'un cordón vacío (null) se explica como «sin cordón»');
});

test('grupos: dicen qué tan confiables son sus valores de arranque', () => {
  A.GRUPOS.forEach((g) => {
    const a = A.buscar([g]);
    assert.ok(a.origen && A.ORIGENES[a.origen], `${g}: origen`);
    assert.ok(a.origenTxt, `${g}: explicación del origen`);
  });
  assert.equal(A.buscar(['proveedor']).origen, 'real');
  assert.equal(A.buscar(['mano_obra']).origen, 'mixto');
  assert.equal(A.buscar(['calibres']).origen, 'norma');
  assert.equal(A.buscar(['capas']).origen, 'ilustrativo');
  assert.equal(A.buscar(['merma', 'RECTO']).origen, null, 'sólo los grupos lo traen');
});

test('presentación: % se escriben en %, los factores sin unidad, y las claves con punto no se rompen', () => {
  assert.equal(A.esPct(['capas', 'utilidad_pct_precio']), true);
  assert.equal(A.esPct(['merma', 'RECTO']), true);
  assert.equal(A.esPct(['capas', 'financiamiento', 'tasa_anual']), true);
  assert.equal(A.esPct(['proceso', 'pintura', 'capas', 'primario', 'sv_pct']), false, 'sólidos por volumen ya se guarda en %');
  assert.equal(A.esPct(['proceso', 'eficiencia_taller']), false);
  assert.equal(A.mostrado(['capas', 'utilidad_pct_precio'], 0.2), 20);
  assert.equal(A.mostrado(['merma', 'CODO'], 0.2), 20);
  assert.equal(A.mostrado(['proceso', 'eficiencia_taller'], 0.8), 0.8);
  assert.equal(A.mostrado(['capas', 'iva_pct'], 0.16), 16);
  assert.equal(A.unidadDe(['proceso', 'pintura', 'capas', 'primario', 'sv_pct']), '%');
  assert.equal(A.unidadDe(['proceso', 'pintura', 'capas', 'primario', 'dft_um']), 'µm');
  assert.equal(A.unidadDe(['precios', 'precio_m3_gas_argon']), 'MXN/m³');
  assert.equal(A.unidadDe(['capas', 'financiamiento', 'dias_cobro']), 'días');
  assert.equal(A.unidadDe(['calibres', 'MSG', '16']), 'in');
  assert.equal(A.unidadDe(['proceso', 'armado', 'k_dif', 'CODO']), '');
  assert.equal(A.buscar(['herrajes', 'perfiles', 'L25x3.2', 'esp_mm']).t, 'Espesor del perfil · L25x3.2');
});

test('buscar: una ruta desconocida no inventa ayuda; los índices numéricos y de texto valen igual', () => {
  assert.equal(A.buscar(['precios', 'precio_que_no_existe']), null);
  assert.equal(A.buscar(['no', 'existe']), null);
  assert.equal(A.buscar(['proceso', 'angulos_codo_deg', 2]).t, 'Ángulo de codo #2');
  assert.equal(A.buscar(['proceso', 'angulos_codo_deg', '2']).t, A.buscar(['proceso', 'angulos_codo_deg', 2]).t);
  assert.equal(A.buscar(['proceso', 'pintura', 'sistemas', 'PRIMARIO_ESMALTE', 1]).t, 'Mano #1 · primario + esmalte');
});

test('validación del editor: un cero en el ancho de un perfil con punto en su clave también se rechaza', () => {
  assert.equal(V.exigePositivo(['herrajes', 'perfiles', 'SOL38x4.8', 'ancho_mm']), true);
  assert.equal(V.exigePositivo(['herrajes', 'perfiles', 'L25x3.2', 'esp_mm']), true);
  assert.equal(V.exigePositivo(['herrajes', 'perfiles', 'L25x3.2', 'gramil_mm']), false);
  assert.equal(V.exigePositivo(['calibres', 'MSG', 16]), true);
  assert.equal(V.exigePositivo(['proceso', 'corte', 'v_m_min', 'PLASMA', 0, 1]), true);
  assert.equal(V.exigePositivo(['precios', 'precio_kg_solera']), false);
});
