/**
 * COTIZAP · trazado_lectura.js — Del trazado isométrico a las partidas de la cotización (docs/trazado-isometrico.md §1.5,
 * §5.6).
 *
 * El trazo pasa por las mismas reglas que una foto leída o un dibujo unifilar (motor/unifilar.js), como una lectura de origen
 * USUARIO: así el despiece, las uniones, las ménsulas y las compras salen con la misma lógica que el resto de COTIZAP.
 *
 *   nodos y aristas   los tramos rígidos con su Ø y su largo a ejes; la manguera no es una arista (se compra): su equipo va en
 *                     el punto de transición, con conexión MANGUERA
 *   ángulos           cada codo y cada derivación llevan su ángulo anotado (el del trazo, no el de la hoja)
 *   notas             «COMPUERTA» en el nodo de cada compuerta, «EXC» en el de cada reducción excéntrica
 *   equipos           el colector y cada toma con la boca del Ø de su puerto (respondida): con brida, en su nodo; con
 *                     manguera, en el punto de transición, con un tramo del catálogo (respondido) y su adaptador si la
 *                     manguera no es del Ø del ducto
 *   respuestas        las decisiones del trazo: tramos cortos pegados o aceptados
 *   proyección        la de la vista en que ninguna pareja de tramos de un nodo se ve alineada sin estarlo (las reglas
 *                     buscan el tronco de una derivación por la hoja)
 *
 * `verificar` compara el despiece con el trazo: el largo neto de cada tramo y la pieza de cada nodo. Pura.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./trazado_iso'), require('./unifilar'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.trazadoLectura = factory(root.COTIZAP.trazadoIso, root.COTIZAP.unifilar);
  }
}(typeof self !== 'undefined' ? self : this, function (TZ, UF) {
  'use strict';

  const DEG = Math.PI / 180;
  const PX_POR_MM = 0.05; // la hoja: 1 px cada 20 mm (las cotas mandan, no la escala)
  const TOL_NETA_MM = 1;
  /** Los problemas del trazo que no cambian el despiece: una toma sin caudal (la necesita el cálculo) o sin ducto (no entra). */
  const SIN_GEOMETRIA = { TOMA_SIN_DATOS: 'No cambia el despiece; el cálculo de pérdidas sí lo necesita.', TOMA_SIN_CONEXION: 'Esa toma no entra al despiece.' };
  const r1 = (x) => Math.round(x * 10) / 10;
  const id3 = (pref, n) => `${pref}-${String(n).padStart(3, '0')}`;
  const pulg = (d) => `${Number(Number(d).toFixed(2))}″`;
  const usuario = (valor, unidad) => ({ valor, unidad, origen: 'USUARIO', confianza: 1, texto_id: null });
  const unit = (d) => ({ x: Math.cos(d.elevacion_deg * DEG) * Math.cos(d.azimut_deg * DEG), y: Math.cos(d.elevacion_deg * DEG) * Math.sin(d.azimut_deg * DEG), z: Math.sin(d.elevacion_deg * DEG) });
  const punto = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norma = (a) => Math.sqrt(punto(a, a));
  const cruz = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const unitario = (a) => { const n = norma(a); return { x: a.x / n, y: a.y / n, z: a.z / n }; };
  const angulo2 = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1)))) / DEG;
  const angulo3 = (u, v) => Math.acos(Math.max(-1, Math.min(1, punto(u, v) / (norma(u) * norma(v) || 1)))) / DEG;

  /** El eje del isométrico de una dirección de la rejilla: X, Y, Z o ninguno. */
  function ejeDe(d) {
    if (Math.abs(Math.abs(d.elevacion_deg) - 90) < 1e-9) return 'Z';
    if (d.elevacion_deg !== 0) return 'NINGUNO';
    const a = ((d.azimut_deg % 360) + 360) % 360;
    return a % 180 === 0 ? 'X' : a % 180 === 90 ? 'Y' : 'NINGUNO';
  }

  /**
   * La proyección de la hoja: la dirección de vista en que la pareja de tramos de un nodo que peor se ve está más lejos de
   * verse alineada (o encimada) sin estarlo en el espacio. Empieza por el isométrico NE; si se ve bien (20° o más), se queda.
   */
  function proyeccion(nodos, ady) {
    const vista = (az, el) => {
      const w = { x: Math.cos(el * DEG) * Math.cos(az * DEG), y: Math.cos(el * DEG) * Math.sin(az * DEG), z: Math.sin(el * DEG) };
      const e1 = unitario(cruz({ x: 0, y: 0, z: 1 }, w));
      const e2 = cruz(w, e1);
      return { az, el, f: (p) => ({ x: punto(p, e1), y: -punto(p, e2) }) };
    };
    const calidad = (v) => {
      let peor = 90;
      ady.forEach((dirs) => {
        for (let i = 0; i < dirs.length; i += 1) {
          for (let j = i + 1; j < dirs.length; j += 1) {
            const a3 = angulo3(dirs[i], dirs[j]);
            if (a3 > 179.5) continue; // alineados de verdad: también en la hoja
            const a2 = angulo2(v.f(dirs[i]), v.f(dirs[j]));
            peor = Math.min(peor, 180 - a2, a2);
          }
        }
        dirs.forEach((d) => { const q = v.f(d); peor = Math.min(peor, Math.hypot(q.x, q.y) * 90); }); // un tramo que se ve de punta
      });
      return peor;
    };
    const ne = vista(45, Math.atan(1 / Math.SQRT2) / DEG);
    if (calidad(ne) >= 20) return { ...ne, calidad: calidad(ne) };
    let mejor = { ...ne, calidad: calidad(ne) };
    for (let az = 0; az < 360; az += 15) {
      [20, 30, 45, 55].forEach((el) => { const v = vista(az, el); const c = calidad(v); if (c > mejor.calidad + 1e-9) mejor = { ...v, calidad: c }; });
    }
    return mejor;
  }

  /**
   * La lectura del trazo para las reglas del unifilar. { lectura, respuestas, avisos, vista } o { error } si el trazo todavía
   * no se puede pasar (con problemas que cambian el despiece, sin colector o con más de una boca). opciones: { yarda_mm, fecha }.
   */
  function aLectura(t, M, opciones) {
    const o = opciones || {};
    const revision = TZ.revisar(t, M);
    const malos = revision.filter((v) => v.severidad === 'BLOQUEANTE' || v.severidad === 'ERROR');
    const bloquean = malos.filter((v) => !SIN_GEOMETRIA[v.codigo]);
    if (bloquean.length) return { error: `Para pasarlo a partidas, primero corrija ${bloquean.length === 1 ? 'el problema' : `los ${bloquean.length} problemas`} del trazo: ${bloquean[0].mensaje}` };
    const s = TZ.aSistema(t, M, { borrador: true });
    const avisos = malos.map((v) => `${v.mensaje} ${SIN_GEOMETRIA[v.codigo]}`);
    const N = new Map(s.nodos.map((x) => [x.id, x]));
    const rigidos = s.tramos.filter((x) => x.tipo === 'RIGIDO');
    const puertos = s.equipos.flatMap((e) => e.puertos.map((p) => ({ ...p, equipo: e })));
    const conDucto = (nid) => rigidos.some((x) => x.nodo_aguas_arriba === nid || x.nodo_aguas_abajo === nid);
    const bocas = puertos.filter((p) => p.rol === 'ENTRADA' && p.nodo && conDucto(p.nodo));
    if (!bocas.length) return { error: 'El trazo todavía no llega a la boca de un colector.' };
    if (bocas.length > 1) return { error: `El trazo llega a ${bocas.length} bocas (${bocas.map((p) => p.id).join(', ')}): las reglas del despiece esperan un colector con una sola boca.` };
    if (!rigidos.length) return { error: 'El trazo no tiene ducto rígido que cotizar.' };
    // material y calibre: los del ducto (las reglas usan uno para todo el sistema)
    const cuenta = new Map();
    rigidos.forEach((x) => { const k = `${x.material}|${x.calibre}`; cuenta.set(k, (cuenta.get(k) || 0) + 1); });
    const [matCal] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
    const [material, calibre] = matCal.split('|');
    if (cuenta.size > 1) avisos.push(`Los tramos tienen ${cuenta.size} combinaciones de material y calibre: el despiece usa ${M.materiales[material] ? M.materiales[material].nombre || material : material} cal. ${calibre} para todo el sistema.`);
    // los nodos de la lectura: los del ducto rígido (la manguera se compra: su toma no entra)
    const nodosIds = [...new Set(rigidos.flatMap((x) => [x.nodo_aguas_arriba, x.nodo_aguas_abajo]))].sort();
    const ady = new Map(nodosIds.map((nid) => [nid, rigidos.filter((x) => x.nodo_aguas_arriba === nid || x.nodo_aguas_abajo === nid)
      .map((x) => { const u = unit(x.direccion); return x.nodo_aguas_arriba === nid ? u : { x: -u.x, y: -u.y, z: -u.z }; })]));
    const v = proyeccion(nodosIds, ady);
    if (v.calidad < 3) avisos.push('Dos tramos de un nodo se ven alineados en cualquier vista: revise en el despiece que el tronco de cada derivación sea el correcto.');
    const pant = new Map(nodosIds.map((nid) => [nid, v.f(N.get(nid).posicion_mm)]));
    const xs = [...pant.values()].map((p) => p.x * PX_POR_MM);
    const ys = [...pant.values()].map((p) => p.y * PX_POR_MM);
    const margen = 80;
    const x0 = Math.min(...xs) - margen;
    const y0 = Math.min(...ys) - margen;
    const px = (nid) => { const p = pant.get(nid); return { x: r1(p.x * PX_POR_MM - x0), y: r1(p.y * PX_POR_MM - y0) }; };
    const aristas = rigidos.map((x) => {
      const p = px(x.nodo_aguas_abajo);
      const q = px(x.nodo_aguas_arriba);
      const ang = (((Math.atan2(-(q.y - p.y), q.x - p.x) / DEG) % 360) + 360) % 360;
      const cerca = (a) => Math.min(Math.abs(ang - a), 360 - Math.abs(ang - a)) <= 10;
      return {
        id: x.id, nodo_a: x.nodo_aguas_abajo, nodo_b: x.nodo_aguas_arriba, orientacion_pantalla: cerca(0) || cerca(180) ? 'HORIZONTAL' : cerca(90) || cerca(270) ? 'VERTICAL' : 'INCLINADA',
        eje_iso: ejeDe(x.direccion), angulo_pantalla_deg: r1(ang), diametro: usuario(x.diametro_in, 'in'), longitud_cota: usuario(x.longitud_ejes_mm / 1000, 'm'), ducto_id: null,
      };
    });
    // los textos: el ángulo de cada codo y de cada derivación; las notas de compuerta y de reducción excéntrica
    const textos = [];
    const texto = (nid, contenido, tipo) => {
      const p = px(nid);
      textos.push({ id: id3('T', textos.length + 1), contenido_crudo: contenido, contenido_normalizado: tipo === 'ANGULO' ? String(parseFloat(contenido)) : contenido, tipo,
        bbox_px: { x: r1(p.x + 8), y: r1(p.y - 30 - 24 * textos.filter((y) => y.asociado_a === nid).length), w: 60, h: 22 }, confianza_ocr: 1, asociado_a: nid, origen: 'USUARIO' });
    };
    s.accesorios.forEach((a) => {
      if (!pant.has(a.nodo)) return;
      if (a.tipo === 'CODO' || ['INJERTO', 'REDUCCION_INJERTO', 'T_90', 'PANTALON'].includes(a.tipo)) texto(a.nodo, `${a.tipo === 'T_90' ? 90 : a.geometria.angulo_deg}°`, 'ANGULO');
      if (a.tipo === 'COMPUERTA') texto(a.nodo, 'COMPUERTA', 'NOTA');
      if ((a.tipo === 'REDUCCION' || a.tipo === 'ADAPTADOR') && /^EXCENTRICA/.test(a.geometria.forma || '')) texto(a.nodo, 'EXC', 'NOTA');
      if (a.tipo === 'T_90') avisos.push(`La T a 90° de ${a.nodo} no la fabrica el taller: el despiece propone en su lugar un injerto a 45° con los largos del trazo y lo pregunta. Para que cuadre, trace ese ramal con un injerto.`);
    });
    // los tramos cortos que el trazo no ha decidido: el despiece los pregunta
    revision.filter((a) => a.codigo === 'TRAMO_CORTO').forEach((a) => avisos.push(`${a.mensaje} El trazo no dice si se pegan las piezas o se fabrica el tramo corto: el despiece lo pregunta (decídalo en el trazo para que no).`));
    // los equipos: el colector y cada toma con su ducto (con brida, en su nodo; con manguera, en el punto de transición)
    const respuestas = {};
    const poner = (id, campo, valor) => { respuestas[id] = { ...(respuestas[id] || {}), [campo]: valor }; };
    const tipoLectura = { COLECTOR: 'COLECTOR', MAQUINA: 'MAQUINA', CAMPANA: 'CAMPANA', VENTILADOR: 'VENTILADOR' };
    const equipos = [];
    const varias = (e) => e.puertos.filter((p) => p.nodo && (conDucto(p.nodo) || (p.conexion && p.conexion.nodo_transicion && conDucto(p.conexion.nodo_transicion)))).length > 1;
    puertos.forEach((p) => {
      const manguera = p.conexion && p.conexion.tipo === 'MANGUERA';
      const nodo = manguera ? p.conexion.nodo_transicion : p.nodo;
      if (!nodo || !pant.has(nodo)) return;
      const id = `${p.equipo.id}-${p.id}`;
      const nombre = varias(p.equipo) ? `${p.equipo.nombre} · ${p.nombre}` : p.equipo.nombre;
      const colector = p.rol === 'ENTRADA';
      equipos.push({
        id, tipo: colector ? 'COLECTOR' : tipoLectura[p.equipo.tipo] || 'OTRO', nombre, nodo_id: nodo, conexion: manguera ? 'MANGUERA' : 'BRIDA_EQUIPO', texto_id: null, confianza: 1,
        boca_diametro: usuario(p.diametro_in, 'in'),
      });
      // la boca: la del puerto (con manguera, el Ø de la manguera: si no es el del ducto, el despiece pone el adaptador)
      poner(id, 'boca_in', p.diametro_in);
      if (manguera) poner(id, 'manguera_tramos', 1);
    });
    // las decisiones del trazo sobre los tramos cortos
    rigidos.forEach((x) => {
      const tr = t.tramos.find((y) => y.id === x.id);
      if (!tr || !tr.corto) return;
      if (tr.corto === 'PEGAR') poner(x.id, 'encimado', 'UNION');
      else { poner(x.id, 'encimado', 'TRAMO'); poner(x.id, 'aceptado', true); }
    });
    const nodos = nodosIds.map((nid) => {
      const ar = aristas.filter((a) => a.nodo_a === nid || a.nodo_b === nid).map((a) => a.id);
      const tipo = { PUERTO: 'EXTREMO', TRANSICION: 'EXTREMO', EXTREMO: 'EXTREMO', UNION: 'UNION_COLINEAL', VERTICE: 'VERTICE', DERIVACION: 'DERIVACION' }[N.get(nid).tipo] || 'VERTICE';
      return { id: nid, tipo, grado: ar.length, pos_px: px(nid), aristas: ar, equipo_id: null, accesorio_id: null, confianza: 1 };
    });
    const ancho = Math.max(400, Math.ceil(Math.max(...xs) - x0 + margen));
    const alto = Math.max(300, Math.ceil(Math.max(...ys) - y0 + margen));
    const crudo = {
      version: '1.0',
      metadatos: {
        fuente: { archivo: 'trazado', ancho_px: ancho, alto_px: alto, ancho_enviado_px: ancho, alto_enviado_px: alto, recortes: [] },
        vista: 'ISOMETRICO', unidades_diametro: 'IN', unidades_longitud: 'M', convencion_cotas: 'EJES', flujo_hacia: equipos.find((e) => e.tipo === 'COLECTOR').id,
        material: usuario(material, null), calibre: usuario(Number(calibre), null), yarda_mm: o.yarda_mm === 1220 ? 1220 : 914.4,
        modelo: '', fecha: typeof o.fecha === 'string' ? o.fecha : new Date().toISOString(),
      },
      red: { nodos, aristas, textos, cotas_totales: [] },
      equipos,
      alertas_ambiguedad: [],
    };
    const { lectura, errores } = UF.leer(crudo);
    if (errores.length) return { error: `El trazo no dio una lectura válida: ${errores.join(' ')}` };
    return { lectura, respuestas: UF.respuestasValidas(respuestas), avisos, vista: { azimut_deg: v.az, elevacion_deg: r1(v.el), calidad_deg: r1(v.calidad) } };
  }

  /** ¿La lectura salió de un trazo isométrico? */
  const esDeTrazado = (lectura) => !!(lectura && lectura.metadatos && lectura.metadatos.fuente && lectura.metadatos.fuente.archivo === 'trazado');

  /**
   * El despiece contra el trazo: el largo neto de cada tramo y la pieza de cada nodo. Devuelve las diferencias en palabras
   * (vacío si cuadra). Un tramo pegado no tiene ducto (y uno corto sin decidir lo pregunta el despiece); un adaptador es una
   * reducción en el nodo de su equipo (o en el punto de transición de su manguera); la T a 90° sale como injerto.
   */
  function verificar(t, M, bom) {
    const s = TZ.aSistema(t, M, { borrador: true });
    const dif = [];
    const ducto = new Map(bom.ductos_rectos.map((d) => [d.arista_id, d]));
    const tramos = new Map(t.tramos.map((x) => [x.id, x]));
    // un tramo corto que el trazo no ha decidido: el despiece lo pregunta (y propone pegar)
    const pendiente = (id) => bom.alertas_ambiguedad.some((a) => a.codigo === 'ACCESORIOS_ENCIMADOS' && a.severidad === 'CONFIRMAR' && (a.referencias || []).includes(id));
    // los tramos de una T a 90°: el despiece pone otra pieza (un injerto), con otros largos (lo dice el aviso de la T)
    const deT = new Set(s.accesorios.filter((a) => a.tipo === 'T_90').map((a) => a.nodo));
    s.tramos.filter((x) => x.tipo === 'RIGIDO').forEach((x) => {
      const d = ducto.get(x.id);
      const corto = tramos.get(x.id) && tramos.get(x.id).corto;
      if (corto === 'PEGAR') { if (d) dif.push(`${x.id} está pegado en el trazo y el despiece lo fabrica.`); return; }
      if (!d && !corto && pendiente(x.id)) return;
      if (!d) { dif.push(`${x.id} no salió en el despiece.`); return; }
      if (Math.abs(d.longitud_neta_mm - x.longitud_neta_mm) > TOL_NETA_MM && !deT.has(x.nodo_aguas_arriba) && !deT.has(x.nodo_aguas_abajo)) dif.push(`${x.id}: ${r1(x.longitud_neta_mm)} mm netos en el trazo y ${r1(d.longitud_neta_mm)} mm en el despiece.`);
      if (d.diametro_in !== x.diametro_in) dif.push(`${x.id}: ${pulg(x.diametro_in)} en el trazo y ${pulg(d.diametro_in)} en el despiece.`);
    });
    const equipoEn = new Map(bom.equipos.map((e) => [e.nodo_id, e]));
    // la T a 90° no se fabrica: las reglas proponen en su lugar un injerto (o una reducción con injerto) a 45° y lo preguntan
    const piezaPara = { CODO: ['CODO'], REDUCCION: ['REDUCCION'], ADAPTADOR: ['REDUCCION'], INJERTO: ['INJERTO'], REDUCCION_INJERTO: ['REDUCCION_INJERTO'], T_90: ['INJERTO', 'REDUCCION_INJERTO'], COMPUERTA: ['COMPUERTA'] };
    const usadas = new Set();
    s.accesorios.forEach((a) => {
      const tipos = piezaPara[a.tipo];
      if (!tipos) { dif.push(`${a.id} (${a.tipo.toLowerCase()}) no tiene pieza en el despiece.`); return; }
      const b = bom.accesorios.find((x) => !usadas.has(x.id) && x.nodo_id === a.nodo && tipos.includes(x.tipo));
      if (!b) { dif.push(`${a.id} (${a.tipo.toLowerCase().replace('_', ' ')} en ${a.nodo}) no salió en el despiece${equipoEn.has(a.nodo) ? ' de su equipo' : ''}.`); return; }
      usadas.add(b.id);
      if (a.tipo === 'CODO' && b.partida_cotizap.theta_deg !== a.geometria.angulo_deg) dif.push(`${a.id}: codo de ${a.geometria.angulo_deg}° en el trazo y de ${b.partida_cotizap.theta_deg}° en el despiece.`);
      if ((a.tipo === 'INJERTO' || a.tipo === 'REDUCCION_INJERTO') && b.partida_cotizap.beta_deg !== a.geometria.angulo_deg) dif.push(`${a.id}: injerto a ${a.geometria.angulo_deg}° en el trazo y a ${b.partida_cotizap.beta_deg}° en el despiece.`);
      if ((a.tipo === 'REDUCCION' || a.tipo === 'ADAPTADOR') && /^EXCENTRICA/.test(a.geometria.forma || '') !== (b.excentrica === true)) dif.push(`${a.id}: reducción ${b.excentrica ? 'excéntrica' : 'concéntrica'} en el despiece y no en el trazo.`);
    });
    bom.accesorios.filter((x) => !usadas.has(x.id)).forEach((x) => dif.push(`El despiece agregó ${x.id} (${x.tipo.toLowerCase()}) en ${x.nodo_id}, que el trazo no tiene.`));
    return dif;
  }

  /** La lectura, su despiece y lo que hay que saber: { lectura, respuestas, bom, avisos } o { error }. */
  function despiece(t, M, opciones) {
    const r = aLectura(t, M, opciones);
    if (r.error) return r;
    const bom = UF.despiezar(r.lectura, M, r.respuestas);
    const dif = bom.resumen.estado === 'NO_COTIZABLE' ? [] : verificar(t, M, bom);
    return { ...r, bom, diferencias: dif, avisos: [...r.avisos, ...dif.map((d) => `El despiece no cuadra con el trazo: ${d}`)] };
  }

  return { aLectura, esDeTrazado, verificar, despiece, ejeDe, proyeccion, TOL_NETA_MM };
}));
