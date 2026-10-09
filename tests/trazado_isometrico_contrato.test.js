/**
 * Contrato de la especificación del trazado isométrico (docs/trazado-isometrico.md): el ejemplo resuelto cumple el esquema
 * (docs/trazado-isometrico.schema.json), su red es un árbol orientado hacia el colector, cada posición sale de las
 * direcciones y los largos, cada accesorio cumple las políticas y cuadra con el motor de COTIZAP, los caudales, las
 * velocidades, la manguera y los choques son los que dicen las reglas, la fricción se puede calcular con lo que trae, y el
 * documento trae el esquema y el ejemplo tal como están en sus archivos.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const C = require('../src/motor/cotizador');
const CAD = require('../src/motor/unifilar_cad');

const raiz = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const ESQUEMA = JSON.parse(leer('docs/trazado-isometrico.schema.json'));
const EJ = JSON.parse(leer('docs/ejemplos/trazado-isometrico-ejemplo.json'));
const M = crearMaestros();
const IN = 25.4;
const rad = (g) => (g * Math.PI) / 180;
const grad = (r) => (r * 180) / Math.PI;
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const unit = (d) => ({ x: Math.cos(rad(d.elevacion_deg)) * Math.cos(rad(d.azimut_deg)), y: Math.cos(rad(d.elevacion_deg)) * Math.sin(rad(d.azimut_deg)), z: Math.sin(rad(d.elevacion_deg)) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const resta = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const por = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const suma = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const cruz = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norma = (a) => Math.sqrt(dot(a, a));
const unitario = (a) => por(a, 1 / norma(a));
const angulo = (a, b) => grad(Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norma(a) * norma(b))))));
const cercaV = (a, b, tol, msg) => ['x', 'y', 'z'].forEach((k) => cerca(a[k], b[k], tol, `${msg} ${k}`));

/** Validador mínimo de JSON Schema: $ref, anyOf, const, enum, type, required, properties, additionalProperties, items, minItems, minimum, maximum, multipleOf, pattern. */
function validar(v, s, ruta, errores) {
  if (s.$ref) return validar(v, s.$ref.split('/').slice(1).reduce((o, k) => o[k], ESQUEMA), ruta, errores);
  if (s.anyOf) {
    if (!s.anyOf.some((alt) => !validar(v, alt, ruta, []).length)) errores.push(`${ruta}: no cumple ninguna alternativa`);
    return errores;
  }
  if (s.const !== undefined && v !== s.const) errores.push(`${ruta}: ${JSON.stringify(v)} ≠ ${JSON.stringify(s.const)}`);
  const tipos = s.type === undefined ? null : [].concat(s.type);
  const tipoDe = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
  if (tipos && !tipos.some((t) => t === tipoDe(v) || (t === 'number' && tipoDe(v) === 'integer'))) { errores.push(`${ruta}: tipo ${tipoDe(v)}, se esperaba ${tipos}`); return errores; }
  if (s.enum && !s.enum.includes(v)) errores.push(`${ruta}: ${JSON.stringify(v)} no está en ${JSON.stringify(s.enum)}`);
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) errores.push(`${ruta}: ${v} < ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) errores.push(`${ruta}: ${v} > ${s.maximum}`);
    if (s.multipleOf !== undefined && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) errores.push(`${ruta}: ${v} no es múltiplo de ${s.multipleOf}`);
  }
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) errores.push(`${ruta}: «${v}» no cumple ${s.pattern}`);
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) errores.push(`${ruta}: menos de ${s.minItems} elementos`);
    if (s.items) v.forEach((x, i) => validar(x, s.items, `${ruta}[${i}]`, errores));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    (s.required || []).forEach((k) => { if (!(k in v)) errores.push(`${ruta}: falta ${k}`); });
    Object.keys(v).forEach((k) => {
      if (s.properties && s.properties[k]) validar(v[k], s.properties[k], `${ruta}.${k}`, errores);
      else if (s.additionalProperties === false) errores.push(`${ruta}: sobra ${k}`);
    });
  }
  return errores;
}

const POL = EJ.politicas;
const T = new Map(EJ.tramos.map((t) => [t.id, t]));
const N = new Map(EJ.nodos.map((n) => [n.id, n]));
const A = new Map(EJ.accesorios.map((a) => [a.id, a]));
const puertos = EJ.equipos.flatMap((e) => e.puertos.map((p) => ({ ...p, equipo: e })));
const P = new Map(puertos.map((p) => [p.id, p]));
const conRol = (a, rol) => T.get(a.conexiones.find((c) => c.rol === rol).tramo);

test('El ejemplo cumple el esquema, y el validador sí rechaza lo que no lo cumple', () => {
  assert.deepEqual(validar(EJ, ESQUEMA, '$', []), []);
  const malo = JSON.parse(JSON.stringify(EJ));
  malo.tramos[0].direccion.azimut_deg = 10;
  malo.accesorios[0].geometria.extra = 1;
  malo.equipos[0].puertos[0].rol = 'BOCA';
  malo.politicas.rejilla.paso_azimut_deg = 20;
  delete malo.nodos[0].tramos;
  const e = validar(malo, ESQUEMA, '$', []);
  assert.ok(e.some((x) => /tramos\[0\]\.direccion/.test(x)) && e.some((x) => /sobra extra/.test(x)) && e.some((x) => /BOCA/.test(x)) && e.some((x) => /paso_azimut_deg/.test(x)) && e.some((x) => /falta tramos/.test(x)), e.join(' | '));
});

test('El esquema sirve para salidas estructuradas: objetos cerrados, todo requerido y sin recursión', () => {
  const recorrer = (s, pila, ruta) => {
    if (s.$ref) {
      assert.ok(!pila.includes(s.$ref), `recursión en ${ruta}`);
      return recorrer(s.$ref.split('/').slice(1).reduce((o, k) => o[k], ESQUEMA), [...pila, s.$ref], ruta);
    }
    (s.anyOf || []).forEach((alt, i) => recorrer(alt, pila, `${ruta}|${i}`));
    if (s.items) recorrer(s.items, pila, `${ruta}[]`);
    if (s.properties) {
      assert.equal(s.additionalProperties, false, `${ruta}: additionalProperties debe ser false`);
      assert.deepEqual([...(s.required || [])].sort(), Object.keys(s.properties).sort(), `${ruta}: todas sus propiedades deben ser requeridas`);
      Object.keys(s.properties).forEach((k) => recorrer(s.properties[k], pila, `${ruta}.${k}`));
    }
  };
  recorrer(ESQUEMA, [], '$');
});

test('Identificadores únicos y referencias que existen', () => {
  const ids = [...EJ.equipos, ...puertos, ...EJ.nodos, ...EJ.tramos, ...EJ.accesorios].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  const existe = new Set(ids);
  EJ.tramos.forEach((t) => {
    assert.ok(N.has(t.nodo_aguas_arriba) && N.has(t.nodo_aguas_abajo), t.id);
    assert.ok(N.get(t.nodo_aguas_arriba).tramos.includes(t.id) && N.get(t.nodo_aguas_abajo).tramos.includes(t.id), `${t.id}: el nodo lo lista`);
    t.descuentos.forEach((d) => assert.ok(A.has(d.accesorio), `${t.id}: ${d.accesorio}`));
  });
  EJ.nodos.forEach((n) => {
    n.tramos.forEach((id) => assert.ok(T.has(id), `${n.id}: ${id}`));
    n.accesorios.forEach((id) => assert.equal(A.get(id).nodo, n.id));
    if (n.puerto) assert.equal(P.get(n.puerto).nodo, n.id);
    assert.equal(n.tipo === 'PUERTO', !!n.puerto, `${n.id}: un nodo PUERTO y sólo él lleva su puerto`);
  });
  EJ.accesorios.forEach((a) => a.conexiones.forEach((c) => {
    const t = T.get(c.tramo);
    assert.ok(t && (t.nodo_aguas_abajo === a.nodo || t.nodo_aguas_arriba === a.nodo), `${a.id}: ${c.tramo} llega a su nodo`);
    assert.equal(c.diametro_in, t.diametro_in, `${a.id}: Ø de ${c.tramo}`);
  }));
  puertos.forEach((p) => {
    const c = p.conexion;
    if (c.tipo === 'MANGUERA') {
      const f = T.get(c.tramo_flexible);
      assert.ok(f.tipo === 'FLEXIBLE' && f.nodo_aguas_arriba === p.nodo && f.nodo_aguas_abajo === c.nodo_transicion && N.get(c.nodo_transicion).tipo === 'TRANSICION', p.id);
    } else assert.ok(c.nodo_transicion === null && c.tramo_flexible === null, p.id);
  });
  EJ.validaciones.forEach((v) => v.elementos.forEach((id) => assert.ok(existe.has(id), id)));
});

test('La red es un árbol orientado hacia la boca del colector: una sola salida por nodo, sin ciclos', () => {
  const sale = new Map();
  EJ.tramos.forEach((t) => { assert.ok(!sale.has(t.nodo_aguas_arriba), `${t.nodo_aguas_arriba}: dos salidas`); sale.set(t.nodo_aguas_arriba, t); });
  const boca = puertos.find((p) => p.rol === 'ENTRADA' && p.equipo.tipo === 'COLECTOR').nodo;
  assert.ok(!sale.has(boca), 'de la boca del colector no sale aire hacia la red');
  EJ.nodos.forEach((n) => {
    let x = n.id;
    for (let i = 0; i <= EJ.nodos.length; i += 1) {
      if (x === boca) return;
      x = sale.get(x).nodo_aguas_abajo;
    }
    assert.fail(`${n.id} no llega al colector`);
  });
  // las tomas son hojas: nada llega a ellas
  puertos.filter((p) => p.rol === 'TOMA').forEach((p) => assert.ok(!EJ.tramos.some((t) => t.nodo_aguas_abajo === p.nodo), p.id));
});

test('Geometría: cada posición sale de su equipo o de la dirección y el largo del tramo; la brida va alineada con el cuello', () => {
  puertos.forEach((p) => {
    const e = p.equipo;
    const g = rad(e.rotacion_z_deg);
    const l = p.posicion_local_mm;
    const giro = { x: l.x * Math.cos(g) - l.y * Math.sin(g), y: l.x * Math.sin(g) + l.y * Math.cos(g), z: l.z };
    cercaV(p.posicion_mm, suma(e.posicion_mm, giro), 0.01, p.id);
    cercaV(N.get(p.nodo).posicion_mm, p.posicion_mm, 0.01, `${p.id} nodo`);
    assert.deepEqual(p.direccion, p.direccion_local.elevacion_deg === 90 || p.direccion_local.elevacion_deg === -90 ? p.direccion_local : { ...p.direccion_local, azimut_deg: (p.direccion_local.azimut_deg + e.rotacion_z_deg) % 360 });
  });
  EJ.tramos.filter((t) => t.tipo === 'RIGIDO').forEach((t) => {
    const d = t.direccion;
    if (Math.abs(d.elevacion_deg) === 90) assert.equal(d.azimut_deg, 0, `${t.id}: en una vertical el azimut es 0`);
    assert.ok(POL.rejilla.elevaciones_deg.includes(d.elevacion_deg) && d.azimut_deg % POL.rejilla.paso_azimut_deg === 0, `${t.id}: en la rejilla`);
    cercaV(N.get(t.nodo_aguas_abajo).posicion_mm, suma(N.get(t.nodo_aguas_arriba).posicion_mm, por(unit(d), t.longitud_ejes_mm)), 0.01, t.id);
  });
  puertos.filter((p) => p.conexion.tipo === 'BRIDA').forEach((p) => {
    const tr = p.rol === 'TOMA' ? EJ.tramos.find((t) => t.nodo_aguas_arriba === p.nodo) : EJ.tramos.find((t) => t.nodo_aguas_abajo === p.nodo);
    const esperada = p.rol === 'TOMA' ? unit(p.direccion) : por(unit(p.direccion), -1);
    cercaV(unit(tr.direccion), esperada, 1e-9, `${p.id}: el primer tramo sale (o el último llega) alineado con el cuello`);
    assert.equal(tr.uniones[p.rol === 'TOMA' ? 'aguas_arriba' : 'aguas_abajo'], 'BRIDA_EQUIPO');
    assert.equal(tr.diametro_in, p.diametro_in, `${p.id}: sin adaptador, el Ø del ducto es el del puerto`);
  });
});

test('Manguera: la S de dos curvas iguales, con su radio, su largo y sus límites', () => {
  puertos.filter((p) => p.conexion.tipo === 'MANGUERA').forEach((p) => {
    const f = T.get(p.conexion.tramo_flexible);
    const g = f.flexible;
    const a = N.get(f.nodo_aguas_arriba).posicion_mm;
    const b = N.get(f.nodo_aguas_abajo).posicion_mm;
    const u = unit(p.direccion);
    const v = resta(b, a);
    const h = dot(v, u);
    const e = norma(resta(v, por(u, h)));
    cerca(g.altura_mm, h, 0.01, 'h');
    cerca(g.desvio_mm, e, 0.01, 'e');
    const hp = h - 2 * g.puno_mm;
    const R = (e * e + hp * hp) / (4 * e);
    const alfa = 2 * Math.atan(e / hp);
    assert.equal(g.forma, 'S');
    cerca(g.radio_mm, R, 0.001, 'R = (e² + h′²) / 4e');
    cerca(g.angulo_curva_deg, grad(alfa), 0.001, 'α = 2·atan(e / h′)');
    cerca(f.longitud_ejes_mm, 2 * R * alfa + 2 * g.puno_mm, 0.001, 'L = 2Rα + 2·puño');
    // la S comprobada: dos arcos de radio R y ángulo α cubren exactamente e de lado y h′ de altura
    cerca(2 * R * (1 - Math.cos(alfa)), e, 1e-6, 'desvío de los dos arcos');
    cerca(2 * R * Math.sin(alfa), hp, 1e-6, 'altura de los dos arcos');
    assert.ok(R >= POL.manguera.radio_min_D * f.diametro_interior_mm, 'radio ≥ mínimo de la manguera');
    assert.ok(f.longitud_ejes_mm <= POL.manguera.largo_max_mm || EJ.validaciones.some((v) => v.codigo === 'MANGUERA_LARGA' && v.elementos.includes(f.id)),
      'no pasa del largo máximo, o lo avisa');
    cercaV(g.normal_plano, unitario(cruz(u, resta(v, por(u, h)))), 1e-9, 'el plano de la S');
    assert.equal(f.longitud_neta_mm, f.longitud_ejes_mm);
    assert.deepEqual([f.uniones.aguas_arriba, f.uniones.aguas_abajo], ['ABRAZADERA', 'ABRAZADERA']);
    const sigue = EJ.tramos.find((t) => t.nodo_aguas_arriba === f.nodo_aguas_abajo);
    assert.equal(sigue.uniones.aguas_arriba, 'LISA', 'el ducto rígido empieza liso para la abrazadera');
  });
});

test('Accesorios: ángulos de las políticas, radios, tangentes, entrada del injerto y largos del motor de COTIZAP', () => {
  const base = { material_id: 'GALVANIZADO', calibre: '22', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', cantidad: 1 };
  EJ.accesorios.forEach((a) => {
    const g = a.geometria;
    if (a.tipo === 'CODO') {
      const ti = conRol(a, 'ENTRADA');
      const to = conRol(a, 'SALIDA');
      const th = angulo(unit(ti.direccion), unit(to.direccion));
      cerca(th, g.angulo_deg, 1e-6, `${a.id} θ`);
      assert.ok(POL.angulos_codo_deg.includes(g.angulo_deg), `${a.id}: ángulo del taller`);
      const D = ti.diametro_interior_mm;
      cerca(g.radio_eje_mm, POL.radio_codo_D * D, 0.001, `${a.id} R`);
      cerca(g.tangente_mm, g.radio_eje_mm * Math.tan(rad(th) / 2), 0.001, `${a.id} T = R·tan(θ/2)`);
      cercaV(g.normal_plano, unitario(cruz(unit(ti.direccion), unit(to.direccion))), 1e-4, `${a.id} plano`);
      const motor = C.cotizarPartida({ ...base, familia: 'CODO', D_mm: ti.diametro_in * IN, theta_deg: g.angulo_deg, k_R: POL.radio_codo_D }, M).geometria.detalle;
      assert.equal(g.gajos, motor.n_gajos, `${a.id}: gajos`);
      [ti, to].forEach((t) => cerca(t.descuentos.find((d) => d.accesorio === a.id).mm, g.tangente_mm, 0.001, `${a.id} en ${t.id}`));
    }
    if (a.tipo === 'REDUCCION_INJERTO' || a.tipo === 'INJERTO') {
      const ti = conRol(a, 'ENTRADA');
      const to = conRol(a, 'SALIDA');
      const tr = conRol(a, 'RAMAL');
      const m = unit(to.direccion);
      cerca(angulo(unit(ti.direccion), m), 0, 1e-9, `${a.id}: el tronco pasa recto`);
      const b = unit(tr.direccion);
      const beta = angulo(b, m);
      cerca(beta, g.angulo_deg, 1e-6, `${a.id} β`);
      cercaV(g.normal_plano, unitario(cruz(b, m)), 1e-4, `${a.id}: el plano de la derivación (ramal × salida)`);
      assert.ok(POL.angulos_injerto_deg.includes(g.angulo_deg) && beta < 90, `${a.id}: a favor del flujo, a un ángulo del taller`);
      // dónde entra el ramal, mirando aguas abajo: 0 arriba, 90 a la derecha, 270 a la izquierda
      const arriba = { x: 0, y: 0, z: 1 };
      const derecha = cruz(m, arriba);
      const r = por(b, -1);
      const w = resta(r, por(m, dot(r, m)));
      const giro = (grad(Math.atan2(dot(w, derecha), dot(w, arriba))) + 360) % 360;
      cerca(giro, g.giro_entrada_deg, 1e-6, `${a.id} giro`);
      const entrada = giro <= 45 || giro >= 315 ? 'SUPERIOR' : giro >= 135 && giro <= 225 ? 'INFERIOR' : 'LATERAL';
      assert.equal(g.entrada, entrada);
      assert.ok(POL.entradas_permitidas.includes(entrada), `${a.id}: nunca por abajo`);
      assert.ok(to.diametro_in >= ti.diametro_in && ti.diametro_in >= tr.diametro_in, `${a.id}: Ø salida ≥ entrada ≥ ramal`);
      assert.equal(a.tipo === 'INJERTO', ti.diametro_in === to.diametro_in, `${a.id}: con cambio de Ø es reducción con injerto`);
      if (a.tipo === 'REDUCCION_INJERTO') {
        const motor = C.cotizarPartida({ ...base, familia: 'REDUCCION_INJERTO', D1_mm: to.diametro_in * IN, D2_mm: ti.diametro_in * IN, d_mm: tr.diametro_in * IN, beta_deg: g.angulo_deg }, M).geometria.detalle;
        cerca(g.largo_mm, motor.L_reduccion_mm, 0.001, `${a.id}: largo del cono`);
        cerca(g.largo_ramal_mm, motor.L_ramal_mm, 0.001, `${a.id}: largo del ramal`);
        cerca(g.semiangulo_deg, motor.semiangulo_deg, 0.001, `${a.id}: semiángulo`);
        assert.ok(g.semiangulo_deg <= POL.semiangulo_reduccion_deg);
        [ti, to].forEach((t) => cerca(t.descuentos.find((d) => d.accesorio === a.id).mm, g.largo_mm / 2, 0.001, `${a.id} en ${t.id}`));
        cerca(tr.descuentos.find((d) => d.accesorio === a.id).mm, g.largo_ramal_mm, 0.001, `${a.id} en el ramal`);
      }
    }
  });
  // lo que no está en las políticas del ejemplo no aparece
  assert.ok(!EJ.accesorios.some((a) => (a.tipo === 'T_90' && !POL.permite_t_90) || (a.tipo === 'PANTALON' && !POL.permite_pantalon)));
});

test('Longitudes netas, diámetros y caudales: lo neto es a ejes menos los accesorios; el Ø no baja hacia el colector; la velocidad está en su rango', () => {
  EJ.tramos.forEach((t) => {
    cerca(t.longitud_neta_mm, t.longitud_ejes_mm - t.descuentos.reduce((s, d) => s + d.mm, 0), 0.002, `${t.id} neta`);
    if (t.tipo === 'RIGIDO') assert.ok(t.longitud_neta_mm >= POL.recto_min_entre_accesorios_mm, `${t.id}: queda tramo recto`);
    cerca(t.diametro_interior_mm, t.diametro_in * IN, 0.001, `${t.id} Ø interior`);
    assert.ok(POL.diametros_comerciales_in.includes(t.diametro_in), `${t.id}: comercial`);
    assert.equal(t.rugosidad_mm, t.tipo === 'FLEXIBLE' ? POL.manguera.rugosidad_mm : POL.rugosidad_mm[t.material]);
  });
  // el caudal de cada tramo es la suma de las tomas que tiene aguas arriba
  const llega = (nid) => EJ.tramos.filter((t) => t.nodo_aguas_abajo === nid);
  const caudal = (t) => {
    const p = puertos.find((x) => x.nodo === t.nodo_aguas_arriba && x.rol === 'TOMA');
    return (p ? p.caudal_m3_h : 0) + llega(t.nodo_aguas_arriba).reduce((s, x) => s + caudal(x), 0);
  };
  EJ.tramos.forEach((t) => {
    assert.equal(t.caudal_m3_h, caudal(t), `${t.id}: caudal`);
    const v = t.caudal_m3_h / 3600 / ((Math.PI * (t.diametro_interior_mm / 1000) ** 2) / 4);
    cerca(t.velocidad_m_s, v, 0.001, `${t.id}: velocidad`);
    assert.ok(v >= POL.velocidad_min_m_s && v <= POL.velocidad_max_m_s, `${t.id}: ${v.toFixed(2)} m/s en ${POL.velocidad_min_m_s}–${POL.velocidad_max_m_s}`);
    // hacia el colector el Ø no baja (en un injerto, contra la entrada del tronco)
    const sig = EJ.tramos.find((x) => x.nodo_aguas_arriba === t.nodo_aguas_abajo);
    if (sig) assert.ok(sig.diametro_in >= t.diametro_in, `${t.id} → ${sig.id}`);
  });
  const total = puertos.filter((p) => p.rol === 'TOMA').reduce((s, p) => s + p.caudal_m3_h, 0);
  assert.equal(EJ.tramos.find((t) => t.nodo_aguas_abajo === puertos.find((p) => p.rol === 'ENTRADA').nodo).caudal_m3_h, total, 'al colector llega la suma de las tomas');
});

test('Choques y alturas: los ductos guardan su holgura entre sí y con los equipos, y pasan sobre la altura libre', () => {
  const rigidos = EJ.tramos.filter((t) => t.tipo === 'RIGIDO');
  const seg = (t) => [N.get(t.nodo_aguas_arriba).posicion_mm, N.get(t.nodo_aguas_abajo).posicion_mm];
  for (let i = 0; i < rigidos.length; i += 1) {
    for (let j = i + 1; j < rigidos.length; j += 1) {
      const a = rigidos[i];
      const b = rigidos[j];
      if ([a.nodo_aguas_arriba, a.nodo_aguas_abajo].some((n) => n === b.nodo_aguas_arriba || n === b.nodo_aguas_abajo)) continue;
      const d = CAD.distanciaSegmentos(...seg(a), ...seg(b));
      assert.ok(d >= ((a.diametro_interior_mm + b.diametro_interior_mm) / 2) + POL.holgura_min_mm, `${a.id} y ${b.id}: ${d.toFixed(0)} mm`);
    }
  }
  // contra la caja de cada equipo (salvo el equipo al que llega el tramo): muestreo del eje cada 10 mm
  const dentro = (p, e, margen) => Math.abs(p.x - e.posicion_mm.x) <= e.caja_mm.largo / 2 + margen && Math.abs(p.y - e.posicion_mm.y) <= e.caja_mm.ancho / 2 + margen && p.z >= e.posicion_mm.z - margen && p.z <= e.posicion_mm.z + e.caja_mm.alto + margen;
  rigidos.forEach((t) => {
    const [a, b] = seg(t);
    const propios = EJ.equipos.filter((e) => e.puertos.some((p) => p.nodo === t.nodo_aguas_arriba || p.nodo === t.nodo_aguas_abajo));
    EJ.equipos.filter((e) => !propios.includes(e)).forEach((e) => {
      for (let k = 0; k <= 1; k += 10 / t.longitud_ejes_mm) assert.ok(!dentro(suma(a, por(resta(b, a), k)), e, t.diametro_interior_mm / 2 + POL.holgura_min_mm), `${t.id} choca con ${e.id}`);
    });
    if (t.direccion.elevacion_deg === 0) assert.ok(a.z - t.diametro_interior_mm / 2 >= POL.altura_libre_min_mm, `${t.id}: altura libre`);
  });
});

test('Con lo que trae se calcula la fricción: aire a la altitud del proyecto y Darcy-Weisbach por tramo y por camino', () => {
  const air = EJ.proyecto.aire;
  const TK = air.temperatura_C + 273.15;
  cerca(air.presion_Pa, 101325 * (1 - 2.25577e-5 * air.altitud_m) ** 5.25588, 1, 'presión a la altitud');
  cerca(air.densidad_kg_m3, air.presion_Pa / (287.05 * TK), 1e-4, 'ρ = p / (R·T)');
  cerca(air.viscosidad_Pa_s, (1.458e-6 * TK ** 1.5) / (TK + 110.4), 1e-8, 'μ (Sutherland)');
  const R = EJ.resultados;
  EJ.tramos.forEach((t) => {
    const D = t.diametro_interior_mm / 1000;
    const v = t.caudal_m3_h / 3600 / ((Math.PI * D * D) / 4);
    const Re = (air.densidad_kg_m3 * v * D) / air.viscosidad_Pa_s;
    const f = 0.25 / Math.log10(t.rugosidad_mm / 1000 / (3.7 * D) + 5.74 / Re ** 0.9) ** 2;
    const pv = (air.densidad_kg_m3 * v * v) / 2;
    const r = R.por_tramo.find((x) => x.tramo === t.id);
    cerca(r.presion_dinamica_Pa, pv, 0.01, `${t.id} pv`);
    cerca(r.reynolds, Re, 2, `${t.id} Re`);
    cerca(r.factor_friccion, f, 1e-4, `${t.id} f`);
    cerca(r.perdida_friccion_Pa, (f * (t.longitud_neta_mm / 1000) / D) * pv, 0.01, `${t.id} Δp`);
  });
  R.por_toma.forEach((c) => {
    let n = P.get(c.puerto).nodo;
    const camino = [];
    for (let t = EJ.tramos.find((x) => x.nodo_aguas_arriba === n); t; t = EJ.tramos.find((x) => x.nodo_aguas_arriba === n)) { camino.push(t.id); n = t.nodo_aguas_abajo; }
    assert.deepEqual(c.camino, camino, `${c.puerto}: de la toma al colector`);
    cerca(c.perdida_friccion_Pa, camino.reduce((s, id) => s + R.por_tramo.find((x) => x.tramo === id).perdida_friccion_Pa, 0), 0.011);
  });
  // y cada accesorio trae lo que pide su modelo de pérdida
  EJ.accesorios.forEach((a) => {
    if (a.perdida.modelo === 'CODO_GAJOS') assert.ok(a.geometria.angulo_deg && a.geometria.radio_eje_mm && a.geometria.gajos);
    if (a.perdida.modelo === 'CONFLUENCIA_RAMAL') assert.ok(a.geometria.angulo_deg && ['ENTRADA', 'SALIDA', 'RAMAL'].every((rol) => a.conexiones.some((c) => c.rol === rol)));
  });
});

test('El documento trae el esquema y el ejemplo tal como están en sus archivos', () => {
  const doc = leer('docs/trazado-isometrico.md');
  const bloques = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => { try { return JSON.parse(m[1]); } catch (e) { return null; } });
  assert.ok(bloques.some((b) => b && JSON.stringify(b) === JSON.stringify(ESQUEMA)), 'el esquema completo');
  assert.ok(bloques.some((b) => b && JSON.stringify(b) === JSON.stringify(EJ)), 'el ejemplo completo');
});
