/**
 * COTIZAP · unifilar.js — Del croquis unifilar leído al despiece cotizable (docs/vision-unifilares.md).
 *
 * La etapa de visión entrega la LECTURA: metadatos, la red (nodos, aristas y textos con su confianza) y los equipos. Este
 * módulo aplica las reglas deterministas (la IA lee; las reglas cuentan):
 *
 *   1. árbol dirigido hacia el colector (un solo colector, conexo, sin ciclos);
 *   2. diámetros: el leído (confianza ≥ 0.5), llevado a la medida comercial; el que falta se hereda por continuidad (unión
 *      colineal, codo, tronco de un injerto simple); el de un ramal no se hereda;
 *   3. cotas: la leída; la ilegible se estima con la mediana de px/m de las aristas acotadas paralelas a los ejes (en
 *      isométrico los tres ejes tienen la misma escala) y siempre se pregunta;
 *   4. cada nodo, su pieza: codo (ángulo anotado, o por los ejes del isométrico, o medido en planta), reducción (cambio de Ø
 *      sin accesorio dibujado), injerto simple o reducción con injerto (el taller sólo hace injertos a 30° o 45°);
 *   5. longitud neta de cada tramo = cota a ejes − lo que ocupan los accesorios de sus extremos;
 *   6. uniones (juntas bridadas, a equipo, a manguera, internas del armado por yardas), soportes y compras;
 *   7. alertas con su pregunta y la forma de responderla; las respuestas del ingeniero (origen USUARIO) se aplican al
 *      volver a calcular.
 *
 * Pura: no muta lo recibido. `leer` revisa la estructura; `despiezar` da el despiece completo (el esquema de
 * docs/unifilar-bom.schema.json); `aPartidas` lo convierte en partidas de la cotización.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./cotizador'), require('./soportes'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.unifilar = factory(root.COTIZAP.util, root.COTIZAP.cotizador, root.COTIZAP.soportes);
  }
}(typeof self !== 'undefined' ? self : this, function (U, COT, SOP) {
  'use strict';

  const IN = 25.4;
  const COMERCIALES_IN = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24];
  const SEVERIDADES = ['BLOQUEANTE', 'CONFIRMAR', 'ADVERTENCIA', 'INFO'];
  const CONF_MIN = 0.5; // por debajo, el dato leído no se usa
  const CONF_DUDA = 0.7; // entre CONF_MIN y esto, se usa y se pregunta (CONFIRMAR)
  const CONF_SEGURA = 0.9; // entre CONF_DUDA y esto, se usa y se avisa (ADVERTENCIA)
  const COLINEAL_DEG = 10;
  const SNAP_DEG = 7.5;
  const NETA_MIN_MM = 150;
  // Alertas que sólo puede ver la etapa de visión: si la lectura las trae, se conservan
  const ALERTAS_DE_LECTURA = ['ASOCIACION_AMBIGUA', 'TRAZO_SIN_CONECTAR', 'CRUCE_SIN_NODO', 'VERIFICACION_VISUAL'];
  // Lo que una regla puso en un despiece anterior: al volver a leerlo se descarta y se vuelve a calcular
  const ORIGENES_DE_REGLA = ['INFERIDO', 'ESCALA', 'DEFECTO_TALLER'];
  /** Lo que el ingeniero puede contestar: respuestas[elemento][campo]. */
  const CAMPOS = ['longitud_m', 'diametro_in', 'angulo_deg', 'posicion', 'boca_in', 'manguera_tramos', 'calibre', 'material', 'aceptado', 'encimado'];
  // Una nota junto a un tramo que dice que es vertical
  const NOTA_VERTICAL = /\b(SUBE|BAJA|BAJADA|SUBIDA)\b/i;

  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const id3 = (pref, n) => `${pref}-${String(n).padStart(3, '0')}`;
  const pulgadas = (x) => `${r1(x)}″`.replace('.0″', '″');

  /* ------------------------------------------------------------------ lectura */

  /**
   * Revisa la estructura de una lectura (o de un despiece completo, del que sólo se toma la lectura). Acepta el objeto o su
   * texto JSON. Devuelve { lectura, errores } (errores = lo que impide calcular).
   */
  function leer(entrada) {
    let j = entrada;
    if (typeof j === 'string') {
      try { j = JSON.parse(j); } catch (e) { return { lectura: null, errores: ['El texto no es un JSON válido.'] }; }
    }
    const errores = [];
    if (!esObjeto(j)) return { lectura: null, errores: ['Se esperaba un objeto JSON con la lectura del unifilar.'] };
    if (!esObjeto(j.metadatos)) errores.push('Falta «metadatos».');
    if (!esObjeto(j.red)) errores.push('Falta «red» (nodos, aristas y textos).');
    if (errores.length) return { lectura: null, errores };
    const nodos = Array.isArray(j.red.nodos) ? j.red.nodos.filter(esObjeto) : [];
    const aristas = Array.isArray(j.red.aristas) ? j.red.aristas.filter(esObjeto) : [];
    const textos = Array.isArray(j.red.textos) ? j.red.textos.filter(esObjeto) : [];
    const equipos = Array.isArray(j.equipos) ? j.equipos.filter(esObjeto) : [];
    if (!nodos.length || !aristas.length) errores.push('La red no trae nodos o aristas.');
    if (nodos.length > 2000 || aristas.length > 2000 || textos.length > 5000) errores.push('La red es demasiado grande (más de 2 000 nodos o aristas).');
    const cadenas = Array.isArray(j.red.cotas_totales) ? j.red.cotas_totales.filter(esObjeto) : [];
    const ids = new Set();
    const repetido = (id, que) => {
      if (typeof id !== 'string' || !id) { errores.push(`Falta el identificador de ${que}.`); return; }
      if (ids.has(id)) errores.push(`El identificador «${id}» está repetido.`);
      ids.add(id);
    };
    nodos.forEach((n) => {
      repetido(n.id, 'un nodo');
      if (!esObjeto(n.pos_px) || !finito(n.pos_px.x) || !finito(n.pos_px.y)) errores.push(`El nodo ${n.id} no trae su posición (pos_px).`);
    });
    aristas.forEach((a) => repetido(a.id, 'una arista'));
    equipos.forEach((e) => repetido(e.id, 'un equipo'));
    textos.forEach((t) => repetido(t.id, 'un texto'));
    cadenas.forEach((c) => repetido(c.id, 'una cota total'));
    const aristaIds = new Set(aristas.map((a) => a.id));
    cadenas.forEach((c) => {
      if (!Array.isArray(c.aristas) || c.aristas.length < 2 || new Set(c.aristas).size !== c.aristas.length || c.aristas.some((x) => !aristaIds.has(x))) {
        errores.push(`La cota total ${c.id} debe abarcar dos o más aristas distintas que existan.`);
      }
    });
    const nodoIds = new Set(nodos.map((n) => n.id));
    aristas.forEach((a) => {
      if (!nodoIds.has(a.nodo_a) || !nodoIds.has(a.nodo_b)) errores.push(`La arista ${a.id} une nodos que no existen (${a.nodo_a}, ${a.nodo_b}).`);
      if (a.nodo_a === a.nodo_b) errores.push(`La arista ${a.id} empieza y termina en el mismo nodo.`);
    });
    equipos.forEach((e) => { if (!nodoIds.has(e.nodo_id)) errores.push(`El equipo ${e.id} está en un nodo que no existe (${e.nodo_id}).`); });
    if (errores.length) return { lectura: null, errores: errores.slice(0, 12) };
    const medida = (m, unidad) => {
      if (!esObjeto(m)) return { valor: null, unidad, origen: 'OCR', confianza: 0, texto_id: null };
      const deRegla = ORIGENES_DE_REGLA.includes(m.origen);
      return {
        valor: !deRegla && (finito(m.valor) || typeof m.valor === 'string') ? m.valor : null,
        unidad: typeof m.unidad === 'string' ? m.unidad : unidad,
        origen: !deRegla && typeof m.origen === 'string' ? m.origen : 'OCR',
        confianza: !deRegla && finito(m.confianza) ? Math.max(0, Math.min(1, m.confianza)) : 0,
        texto_id: typeof m.texto_id === 'string' ? m.texto_id : null,
      };
    };
    const M0 = j.metadatos;
    const lectura = {
      version: '1.0',
      metadatos: {
        fuente: esObjeto(M0.fuente) ? U.clonar(M0.fuente) : { archivo: '', ancho_px: 1, alto_px: 1, ancho_enviado_px: 1, alto_enviado_px: 1, recortes: [] },
        vista: ['PLANTA', 'ISOMETRICO', 'ELEVACION', 'MIXTA'].includes(M0.vista) ? M0.vista : 'PLANTA',
        unidades_diametro: M0.unidades_diametro === 'MM' ? 'MM' : 'IN',
        unidades_longitud: ['M', 'MM', 'FT'].includes(M0.unidades_longitud) ? M0.unidades_longitud : 'M',
        convencion_cotas: M0.convencion_cotas === 'NETAS' ? 'NETAS' : 'EJES',
        flujo_hacia: typeof M0.flujo_hacia === 'string' ? M0.flujo_hacia : null,
        material: medida(M0.material, null),
        calibre: medida(M0.calibre, null),
        yarda_mm: M0.yarda_mm === 1220 ? 1220 : 914.4,
        modelo: typeof M0.modelo === 'string' ? M0.modelo : '',
        fecha: typeof M0.fecha === 'string' ? M0.fecha : '',
      },
      red: {
        nodos: nodos.map((n) => ({
          id: n.id, tipo: typeof n.tipo === 'string' ? n.tipo : 'VERTICE', grado: 0, pos_px: { x: n.pos_px.x, y: n.pos_px.y },
          aristas: [], equipo_id: typeof n.equipo_id === 'string' ? n.equipo_id : null, accesorio_id: null, confianza: finito(n.confianza) ? n.confianza : 1,
        })),
        aristas: aristas.map((a) => ({
          id: a.id, nodo_a: a.nodo_a, nodo_b: a.nodo_b,
          orientacion_pantalla: ['HORIZONTAL', 'VERTICAL', 'INCLINADA'].includes(a.orientacion_pantalla) ? a.orientacion_pantalla : 'INCLINADA',
          eje_iso: ['X', 'Y', 'Z', 'NINGUNO'].includes(a.eje_iso) ? a.eje_iso : 'NINGUNO',
          angulo_pantalla_deg: finito(a.angulo_pantalla_deg) ? a.angulo_pantalla_deg : 0,
          diametro: medida(a.diametro, 'in'), longitud_cota: medida(a.longitud_cota, 'm'), ducto_id: null,
        })),
        // una cota que abarca varios tramos seguidos: la parcial que falta sale por diferencia
        cotas_totales: cadenas.map((c) => ({ id: c.id, aristas: [...c.aristas], longitud: medida(c.longitud, 'm') })),
        textos: textos.map((t) => ({
          id: t.id, contenido_crudo: typeof t.contenido_crudo === 'string' ? t.contenido_crudo : '',
          contenido_normalizado: typeof t.contenido_normalizado === 'string' ? t.contenido_normalizado : null,
          tipo: typeof t.tipo === 'string' ? t.tipo : 'NOTA',
          bbox_px: esObjeto(t.bbox_px) ? { x: +t.bbox_px.x || 0, y: +t.bbox_px.y || 0, w: +t.bbox_px.w || 0, h: +t.bbox_px.h || 0 } : { x: 0, y: 0, w: 0, h: 0 },
          confianza_ocr: finito(t.confianza_ocr) ? Math.max(0, Math.min(1, t.confianza_ocr)) : 0, asociado_a: typeof t.asociado_a === 'string' ? t.asociado_a : null,
          // USUARIO: lo puso el ingeniero (el dibujo del unifilar), no se leyó
          origen: t.origen === 'USUARIO' ? 'USUARIO' : 'OCR',
        })),
      },
      equipos: equipos.map((e) => ({
        id: e.id, tipo: ['COLECTOR', 'MAQUINA', 'CAMPANA', 'COMPUERTA', 'VENTILADOR', 'OTRO'].includes(e.tipo) ? e.tipo : 'OTRO',
        nombre: typeof e.nombre === 'string' ? e.nombre : e.id, nodo_id: e.nodo_id,
        conexion: ['BRIDA_EQUIPO', 'BRIDA_TALLER', 'MANGUERA', 'LISO'].includes(e.conexion) ? e.conexion : 'BRIDA_EQUIPO',
        texto_id: typeof e.texto_id === 'string' ? e.texto_id : null, confianza: finito(e.confianza) ? e.confianza : 1,
        boca_diametro: esObjeto(e.boca_diametro) ? medida(e.boca_diametro, 'in') : null,
      })),
      alertas_ambiguedad: (Array.isArray(j.alertas_ambiguedad) ? j.alertas_ambiguedad : []).filter((a) => esObjeto(a) && ALERTAS_DE_LECTURA.includes(a.codigo)),
    };
    // las aristas de cada nodo y su grado salen de las aristas (no se confía en la lista del nodo)
    const porNodo = new Map(lectura.red.nodos.map((n) => [n.id, n]));
    lectura.red.aristas.forEach((a) => { porNodo.get(a.nodo_a).aristas.push(a.id); porNodo.get(a.nodo_b).aristas.push(a.id); });
    lectura.red.nodos.forEach((n) => { n.grado = n.aristas.length; });
    // el equipo de cada nodo, desde la lista de equipos
    lectura.equipos.forEach((e) => { porNodo.get(e.nodo_id).equipo_id = e.id; });
    return { lectura, errores: [] };
  }

  /* ------------------------------------------------------------------ geometría de la hoja */

  const vector = (de, a) => ({ x: a.pos_px.x - de.pos_px.x, y: a.pos_px.y - de.pos_px.y });
  const largoPx = (u) => Math.hypot(u.x, u.y);
  function anguloEntre(u, v) {
    const c = (u.x * v.x + u.y * v.y) / ((largoPx(u) * largoPx(v)) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  }
  const masCercano = (v, lista) => lista.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), lista[0]);
  const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

  function materialDe(v, M) {
    if (typeof v !== 'string') return null;
    if (M.materiales[v]) return v;
    const t = v.toUpperCase();
    if (/GALV/.test(t)) return 'GALVANIZADO';
    if (/INOX.*316/.test(t)) return 'INOX_316';
    if (/INOX/.test(t)) return 'INOX_304';
    if (/NEGRO|ACERO|CARB/.test(t)) return 'ACERO_CARBON';
    return null;
  }

  /* ------------------------------------------------------------------ despiece */

  /**
   * lectura: la de `leer` (o un objeto con la misma forma). M: tablas maestras. respuestas: { [elemento]: { campo: valor } }
   * con lo que contestó el ingeniero (longitud_m, diametro_in, angulo_deg, posicion, boca_in, manguera_tramos, calibre,
   * material, aceptado). Devuelve el despiece completo (docs/unifilar-bom.schema.json).
   */
  function despiezar(lectura0, M, respuestas0) {
    const L = U.clonar(lectura0);
    const R = esObjeto(respuestas0) ? respuestas0 : {};
    const resp = (id, campo) => (esObjeto(R[id]) && R[id][campo] !== undefined && R[id][campo] !== null && R[id][campo] !== '' ? R[id][campo] : undefined);
    const md = L.metadatos;
    const iso = md.vista === 'ISOMETRICO' || md.vista === 'MIXTA';
    const nodos = L.red.nodos;
    const aristas = L.red.aristas;
    const textos = L.red.textos;
    const N = new Map(nodos.map((n) => [n.id, n]));
    const A = new Map(aristas.map((a) => [a.id, a]));
    const EQ = new Map(L.equipos.map((e) => [e.id, e]));
    const alertas = [];
    const alerta = (severidad, codigo, referencias, mensaje, decision, pregunta, respuesta) => {
      alertas.push({ severidad, codigo, referencias, mensaje, decision_tomada: decision || null, pregunta: pregunta || null, respuesta: respuesta || null, resuelta: false });
    };
    // una pregunta ya contestada: queda como INFO con su respuesta, para cambiarla o quitarla
    const resuelta = (codigo, referencias, mensaje, respuesta) => alertas.push({ severidad: 'INFO', codigo, referencias, mensaje, decision_tomada: 'Respondido por el ingeniero.', pregunta: null, respuesta, resuelta: true });
    const pregunta = (tipo, elemento, campo, unidad, opciones, propuesta) => ({ tipo, elemento, campo, unidad: unidad || null, opciones: opciones || [], propuesta: propuesta === undefined ? null : propuesta });
    const opcionesAngulo = (lista) => lista.map((v) => ({ valor: v, texto: `${v}°` }));
    const crudo = (m) => { const t = m && m.texto_id ? textos.find((x) => x.id === m.texto_id) : null; return t ? `«${t.contenido_crudo}» ` : ''; };
    /** Un dato leído con confianza de 0.5 a 0.9 se usa y se pregunta: CONFIRMAR por debajo de 0.7, ADVERTENCIA arriba. */
    const dudosa = (m, referencias, que, decision, preguntaTxt, respuesta) => {
      if (m.origen === 'USUARIO' || m.confianza >= CONF_SEGURA) return;
      alerta(m.confianza < CONF_DUDA ? 'CONFIRMAR' : 'ADVERTENCIA', 'LECTURA_DUDOSA', [...referencias, m.texto_id].filter(Boolean),
        `${que} se leyó ${crudo(m)}con confianza ${m.confianza}.`, decision, preguntaTxt, respuesta);
    };

    const salida = (estadoForzado) => armarSalida(L, M, { alertas, estadoForzado, piezas: null });

    // --- 1. árbol dirigido hacia el colector
    const colectores = L.equipos.filter((e) => e.tipo === 'COLECTOR');
    if (colectores.length !== 1) {
      alerta('BLOQUEANTE', 'SIN_COLECTOR', colectores.map((e) => e.id), colectores.length ? 'Hay más de un colector en el croquis.' : 'No se identificó el colector.', 'Sin colector no se sabe qué lado de cada pieza es el mayor.', '¿Cuál es el colector?');
      return salida('NO_COTIZABLE');
    }
    const colector = colectores[0];
    md.flujo_hacia = colector.id;
    const padre = new Map(); // nodo → arista hacia el colector
    const orden = [colector.nodo_id];
    const visto = new Set(orden);
    let ciclo = null;
    for (let i = 0; i < orden.length; i += 1) {
      const n = N.get(orden[i]);
      n.aristas.forEach((aid) => {
        if (padre.get(n.id) === aid) return;
        const a = A.get(aid);
        const otro = a.nodo_a === n.id ? a.nodo_b : a.nodo_a;
        if (visto.has(otro)) { ciclo = aid; return; }
        visto.add(otro);
        padre.set(otro, aid);
        orden.push(otro);
        // nodo_a = el lado del colector
        if (a.nodo_a !== n.id) { a.nodo_b = a.nodo_a; a.nodo_a = n.id; }
      });
    }
    if (ciclo) {
      alerta('BLOQUEANTE', 'CICLO_EN_RED', [ciclo], 'La red tiene un ciclo: una red de colección es un árbol.', 'Suele ser un cruce leído como unión.', '¿Qué línea pasa por encima de la otra sin unirse?');
      return salida('NO_COTIZABLE');
    }
    if (visto.size < nodos.length) {
      const sueltos = nodos.filter((n) => !visto.has(n.id)).map((n) => n.id);
      alerta('BLOQUEANTE', 'TRAZO_SIN_CONECTAR', sueltos.slice(0, 10), 'Hay partes del dibujo que no llegan al colector.', null, '¿Cómo se conectan con el resto del sistema?');
      return salida('NO_COTIZABLE');
    }
    const hijos = (nid) => N.get(nid).aristas.filter((aid) => aid !== padre.get(nid));
    const otroExtremo = (a, nid) => N.get(a.nodo_a === nid ? a.nodo_b : a.nodo_a);
    const dir = (nid, aid) => vector(N.get(nid), otroExtremo(A.get(aid), nid));
    const enEje = (a) => ['X', 'Y', 'Z'].includes(a.eje_iso);
    const anotado = (nid) => {
      const t = textos.find((x) => x.tipo === 'ANGULO' && x.asociado_a === nid && x.confianza_ocr >= CONF_MIN && finito(parseFloat(x.contenido_normalizado)));
      return t ? { valor: parseFloat(t.contenido_normalizado), texto: t } : null;
    };
    const notaVertical = (aid) => textos.find((t) => t.asociado_a === aid && t.confianza_ocr >= CONF_MIN && NOTA_VERTICAL.test(`${t.contenido_normalizado || ''} ${t.contenido_crudo || ''}`));
    // la confianza de un ángulo anotado, como medida (para avisar si es dudoso)
    const comoMedida = (t) => ({ valor: parseFloat(t.contenido_normalizado), origen: t.origen === 'USUARIO' ? 'USUARIO' : 'OCR', confianza: t.confianza_ocr, texto_id: t.id });

    // --- 2. material y calibre
    const matR = resp('metadatos', 'material');
    let material = matR ? materialDe(matR, M) : (md.material.confianza >= CONF_MIN ? materialDe(md.material.valor, M) : null);
    const opcionesMaterial = () => Object.keys(M.materiales).map((k) => ({ valor: k, texto: M.materiales[k].nombre || k }));
    if (matR && material) {
      md.material = { valor: material, unidad: null, origen: 'USUARIO', confianza: 1, texto_id: null };
      resuelta('MATERIAL_FALTANTE', ['metadatos'], `Material: ${M.materiales[material].nombre || material}.`, pregunta('OPCIONES', 'metadatos', 'material', null, opcionesMaterial(), material));
    }
    if (!material) {
      material = 'GALVANIZADO';
      md.material = { valor: material, unidad: null, origen: 'DEFECTO_TALLER', confianza: 0.5, texto_id: null };
      alerta('CONFIRMAR', 'MATERIAL_FALTANTE', ['metadatos'], 'El croquis no dice el material.', 'Se usa el del taller: lámina galvanizada.', '¿De qué material es la ductería?',
        pregunta('OPCIONES', 'metadatos', 'material', null, opcionesMaterial(), material));
    } else if (!matR) md.material = { ...md.material, valor: material };
    const tablaCal = M.calibres[M.materiales[material].tabla_calibre] || {};
    const calR = resp('metadatos', 'calibre');
    const opcionesCalibre = () => Object.keys(tablaCal).map((k) => ({ valor: Number(k), texto: `Calibre ${k}` }));
    const calLeido = md.calibre.confianza >= CONF_MIN && tablaCal[String(parseInt(md.calibre.valor, 10))] !== undefined ? parseInt(md.calibre.valor, 10) : null;
    let calibre = calR !== undefined && tablaCal[String(calR)] !== undefined ? Number(calR) : calLeido;
    if (calR !== undefined && calibre !== null && calibre !== calLeido) {
      md.calibre = { valor: calibre, unidad: null, origen: 'USUARIO', confianza: 1, texto_id: null };
      if (calLeido === null) resuelta('CALIBRE_FALTANTE', ['metadatos'], `Calibre ${calibre}.`, pregunta('OPCIONES', 'metadatos', 'calibre', null, opcionesCalibre(), calibre));
    } else if (calR !== undefined && calibre !== null) md.calibre = { ...md.calibre, origen: 'USUARIO', confianza: 1 };
    if (calibre === null) {
      calibre = 22;
      md.calibre = { valor: calibre, unidad: null, origen: 'DEFECTO_TALLER', confianza: 0.5, texto_id: null };
      alerta('CONFIRMAR', 'CALIBRE_FALTANTE', ['metadatos'], 'El croquis no dice el calibre.', 'Se usa el del taller: calibre 22.', '¿De qué calibre es la lámina?',
        pregunta('OPCIONES', 'metadatos', 'calibre', null, opcionesCalibre(), calibre));
    } else md.calibre = { ...md.calibre, valor: calibre };
    const yarda = md.yarda_mm;
    const base = { material_id: material, calibre: String(calibre), ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', cantidad: 1 };
    const espesor = tablaCal[String(calibre)] * IN;

    // --- 3. diámetros: leído, respondido o heredado por continuidad
    const D = new Map();
    // cómo se nombra un tramo en los mensajes: por su diámetro y el equipo al que llega, con su identificador del croquis
    const T = (aid, conDiametro) => {
      const nb = N.get(A.get(aid).nodo_b);
      const e = nb.equipo_id ? EQ.get(nb.equipo_id) : null;
      return `tramo${conDiametro !== false && D.has(aid) ? ` de ${pulgadas(D.get(aid))}` : ''}${e ? ` a «${e.nombre}»` : ''} (${aid})`;
    };
    const comercial = (x) => { const c = masCercano(x, COMERCIALES_IN); return Math.abs(c - x) / c <= 0.03 ? c : r1(x); };
    aristas.forEach((a) => {
      const r = resp(a.id, 'diametro_in');
      const m = a.diametro;
      if (finito(Number(r)) && Number(r) > 0) {
        D.set(a.id, Number(r));
        a.diametro = { valor: Number(r), unidad: 'in', origen: 'USUARIO', confianza: 1, texto_id: null };
        resuelta('DIAMETRO_INFERIDO', [a.id], `Diámetro del ${T(a.id, false)}: ${pulgadas(Number(r))}.`, pregunta('NUMERO', a.id, 'diametro_in', 'in', [], Number(r)));
      } else if (finito(m.valor) && m.valor > 0 && m.confianza >= CONF_MIN) {
        const enMm = m.unidad === 'mm' || (m.unidad !== 'in' && md.unidades_diametro === 'MM');
        const d = comercial(enMm ? m.valor / IN : m.valor);
        D.set(a.id, d);
        a.diametro = { ...m, valor: d, unidad: 'in' };
        dudosa(m, [a.id], `El diámetro del ${T(a.id, false)}`, `Se usa ${pulgadas(d)}.`, `¿Cuál es el diámetro del ${T(a.id, false)}?`, pregunta('NUMERO', a.id, 'diametro_in', 'in', [], d));
      }
    });
    // el tronco de cada derivación: el hijo colineal con la arista hacia el colector
    const tronco = new Map();
    orden.forEach((nid) => {
      const h = hijos(nid);
      const p = padre.get(nid);
      if (!p || h.length !== 2) return;
      const ap = A.get(p);
      const colin = h.map((aid) => {
        const ah = A.get(aid);
        const mismoEje = iso && enEje(ap) && enEje(ah) && ap.eje_iso === ah.eje_iso;
        return { aid, desvio: mismoEje ? 0 : Math.abs(180 - anguloEntre(dir(nid, p), dir(nid, aid))) };
      }).sort((x, y) => x.desvio - y.desvio);
      tronco.set(nid, { troncoHijo: colin[0].desvio <= 25 ? colin[0].aid : null, ramal: colin[0].desvio <= 25 ? colin[1].aid : null, opciones: h });
    });
    for (let cambio = true; cambio;) {
      cambio = false;
      orden.forEach((nid) => {
        const p = padre.get(nid);
        if (!p) return;
        const h = hijos(nid);
        const pareja = h.length === 1 ? h[0] : (tronco.get(nid) || {}).troncoHijo;
        if (!pareja || N.get(nid).equipo_id) return;
        [[p, pareja], [pareja, p]].forEach(([de, a]) => {
          if (D.has(de) && !D.has(a)) {
            D.set(a, D.get(de));
            A.get(a).diametro = { valor: D.get(de), unidad: 'in', origen: 'INFERIDO', confianza: 0.8, texto_id: null };
            cambio = true;
          }
        });
      });
    }
    aristas.forEach((a) => {
      if (!D.has(a.id)) {
        alerta('BLOQUEANTE', 'DIAMETRO_FALTANTE', [a.id], `El ${T(a.id, false)} no trae diámetro y no se puede heredar (es un ramal o no tiene vecinos con diámetro).`, null, `¿Cuál es el diámetro del ${T(a.id, false)}?`, pregunta('NUMERO', a.id, 'diametro_in', 'in', [], null));
      } else if (a.diametro.origen === 'INFERIDO') {
        alerta('INFO', 'DIAMETRO_INFERIDO', [a.id], `El ${T(a.id, false)} no trae diámetro.`, `Se hereda ${pulgadas(D.get(a.id))} del tramo vecino (un codo, una unión o el tronco de un injerto simple no cambian el diámetro).`, null,
          pregunta('NUMERO', a.id, 'diametro_in', 'in', [], D.get(a.id)));
      }
    });
    // monotonía: alejándose del colector el diámetro no crece
    aristas.forEach((a) => {
      const pa = padre.get(a.nodo_a);
      if (pa && D.has(a.id) && D.has(pa) && D.get(a.id) > D.get(pa) && a.diametro.origen !== 'USUARIO') {
        alerta('CONFIRMAR', 'DIAMETRO_INCONSISTENTE', [a.id, pa], `El ${T(a.id)} es mayor que el tramo anterior hacia el colector (${pulgadas(D.get(pa))}).`, 'Suele ser una mala lectura (1↔7, 0↔8, ″ leído como 11). Se cotiza como está.', `¿Cuál es el diámetro del ${T(a.id, false)}?`,
          pregunta('NUMERO', a.id, 'diametro_in', 'in', [], D.get(pa)));
      }
    });

    // --- 4. cotas: leída, respondida o estimada por escala
    const Lmm = new Map();
    const aMm = (m) => {
      const u = m.unidad || { M: 'm', MM: 'mm', FT: 'ft' }[md.unidades_longitud];
      return u === 'mm' ? m.valor : u === 'ft' ? m.valor * 304.8 : m.valor * 1000;
    };
    aristas.forEach((a) => {
      const r = Number(resp(a.id, 'longitud_m'));
      const m = a.longitud_cota;
      if (finito(r) && r > 0) {
        Lmm.set(a.id, r * 1000);
        a.longitud_cota = { valor: r, unidad: 'm', origen: 'USUARIO', confianza: 1, texto_id: m.texto_id };
        resuelta('COTA_ILEGIBLE', [a.id], `Cota del ${T(a.id)}: ${r} m.`, pregunta('NUMERO', a.id, 'longitud_m', 'm', [], r));
      } else if (finito(m.valor) && m.valor > 0 && m.confianza >= CONF_MIN) {
        Lmm.set(a.id, aMm(m));
        dudosa(m, [a.id], `La cota del ${T(a.id)}`, `Se usa ${r2(aMm(m) / 1000)} m.`, `¿Cuánto mide el ${T(a.id)}?`, pregunta('NUMERO', a.id, 'longitud_m', 'm', [], r2(aMm(m) / 1000)));
      }
    });
    // lo que se dice de una cota que falta: ilegible (hay un texto que no se lee) o faltante
    const sinCota = (a) => {
      const ilegible = textos.find((t) => t.asociado_a === a.id && t.tipo === 'ILEGIBLE');
      return {
        codigo: ilegible || a.longitud_cota.texto_id ? 'COTA_ILEGIBLE' : 'COTA_FALTANTE',
        refs: [a.id, ilegible ? ilegible.id : a.longitud_cota.texto_id].filter(Boolean),
        que: ilegible ? `La cota del ${T(a.id)} dice «${ilegible.contenido_crudo}» (lectura ${ilegible.confianza_ocr}).` : `El ${T(a.id)} no trae cota.`,
      };
    };
    // cadenas de cotas: una cota total que abarca varios tramos; la única parcial que falta sale por diferencia
    (L.red.cotas_totales || []).forEach((c) => {
      const tot = c.longitud;
      if (!(finito(tot.valor) && tot.valor > 0 && tot.confianza >= CONF_MIN)) return;
      const totMm = aMm(tot);
      const faltan = c.aristas.filter((aid) => !Lmm.has(aid));
      const suma = c.aristas.filter((aid) => Lmm.has(aid)).reduce((x, aid) => x + Lmm.get(aid), 0);
      const refsC = [c.id, ...c.aristas, tot.texto_id].filter(Boolean);
      if (faltan.length === 1) {
        const a = A.get(faltan[0]);
        const dif = Math.round(totMm - suma);
        const sc = sinCota(a);
        if (dif >= 100) {
          Lmm.set(a.id, dif);
          a.longitud_cota = { valor: dif / 1000, unidad: 'm', origen: 'INFERIDO', confianza: 0.8, texto_id: a.longitud_cota.texto_id };
          alerta('INFO', sc.codigo, [...sc.refs, c.id], sc.que, `Sale de la cota total ${c.id} (${r2(totMm / 1000)} m) menos las demás parciales (${r2(suma / 1000)} m): ${dif / 1000} m.`, null,
            pregunta('NUMERO', a.id, 'longitud_m', 'm', [], dif / 1000));
        } else {
          alerta('ADVERTENCIA', 'COTAS_NO_CUADRAN', refsC, `Las parciales de la cota total ${c.id} ya suman ${r2(suma / 1000)} m de ${r2(totMm / 1000)} m: no queda para el ${T(a.id)}.`, 'No se usa la total: se estima por escala si se puede.', null);
        }
      } else if (!faltan.length && Math.abs(suma - totMm) > Math.max(50, 0.02 * totMm)) {
        alerta('ADVERTENCIA', 'COTAS_NO_CUADRAN', refsC, `Las parciales de la cota total ${c.id} suman ${r2(suma / 1000)} m y la total dice ${r2(totMm / 1000)} m.`, 'Se cotizan las parciales.', null);
      }
    });
    const refs = aristas.filter((a) => Lmm.has(a.id) && (a.longitud_cota.confianza >= CONF_DUDA) && (!iso || enEje(a)))
      .map((a) => largoPx(vector(N.get(a.nodo_a), N.get(a.nodo_b))) / Lmm.get(a.id));
    const escala = refs.length >= 2 ? mediana(refs) : null;
    const dispersion = escala ? Math.sqrt(refs.reduce((s, x) => s + (x - escala) ** 2, 0) / refs.length) / escala : Infinity;
    aristas.forEach((a) => {
      if (Lmm.has(a.id)) return;
      const { codigo, refs: refsTxt, que } = sinCota(a);
      if (escala && dispersion <= 0.25 && (!iso || enEje(a))) {
        const est = Math.max(100, Math.round(largoPx(vector(N.get(a.nodo_a), N.get(a.nodo_b))) / escala / 100) * 100);
        Lmm.set(a.id, est);
        a.longitud_cota = { valor: est / 1000, unidad: 'm', origen: 'ESCALA', confianza: 0.35, texto_id: a.longitud_cota.texto_id };
        alerta('CONFIRMAR', codigo, refsTxt, que, `Se estimó ${est / 1000} m por escala, con la mediana de px/m de las aristas acotadas paralelas a los ejes; el croquis no es a escala.`, `¿Cuánto mide el ${T(a.id)}?`,
          pregunta('NUMERO', a.id, 'longitud_m', 'm', [], est / 1000));
      } else {
        alerta('BLOQUEANTE', codigo, refsTxt, que, 'No se puede estimar: no hay suficientes cotas paralelas a los ejes o no coinciden entre sí.', `¿Cuánto mide el ${T(a.id)}?`, pregunta('NUMERO', a.id, 'longitud_m', 'm', [], null));
      }
    });

    // --- 5. la pieza de cada nodo
    const piezas = { acc: [], ocupa: new Map(), posicion: new Map(), abiertos: [] };
    const ocupar = (aid, accId, mm) => { if (!piezas.ocupa.has(aid)) piezas.ocupa.set(aid, []); piezas.ocupa.get(aid).push({ accesorio_id: accId, mm: r1(mm) }); };
    const cuenta = {};
    const nuevoId = (pref) => { cuenta[pref] = (cuenta[pref] || 0) + 1; return id3(pref, cuenta[pref]); };
    const conAngulo = (valor, origen, confianza, t) => ({ valor, unidad: 'deg', origen, confianza, texto_id: t ? t.id : null });
    const errorMotor = (refs0, err) => alerta('BLOQUEANTE', 'ACCESORIOS_ENCIMADOS', refs0, `El motor no puede fabricar la pieza: ${(err.errores || [String(err.message || err)]).join(' ')}`, null, 'Revise las medidas de esa zona del croquis.');
    const cotizarAcc = (p) => COT.cotizarPartida({ ...base, ...p }, M);
    aristas.forEach((a) => {
      const r = resp(a.id, 'posicion');
      piezas.posicion.set(a.id, r === 'VERTICAL' || r === 'HORIZONTAL' ? r : (a.eje_iso === 'Z' || notaVertical(a.id) || (md.vista === 'ELEVACION' && a.orientacion_pantalla === 'VERTICAL') ? 'VERTICAL' : 'HORIZONTAL'));
    });

    function agregarReduccion(nid, aMayor, aMenor, D1, D2, todoEnMenor) {
      const id = nuevoId('RED');
      try {
        const f = cotizarAcc({ familia: 'REDUCCION', D1_mm: r1(D1 * IN), D2_mm: r1(D2 * IN), excentrica: 'NO' });
        const Lr = f.geometria.detalle.L_mm;
        if (todoEnMenor) ocupar(aMenor, id, Lr); else { if (aMayor) ocupar(aMayor, id, Lr / 2); ocupar(aMenor, id, Lr / 2); }
        piezas.acc.push({
          id, tipo: 'REDUCCION', nodo_id: nid, aristas: [aMayor, aMenor].filter(Boolean), diametro_entrada_in: D1, diametro_salida_in: D2, d_ramal_in: null, angulo: null, k_R: null, gajos: null, excentrica: false,
          partida_cotizap: { ...base, familia: 'REDUCCION', D1_mm: r1(D1 * IN), D2_mm: r1(D2 * IN), excentrica: 'NO' },
        });
        if (D2 / D1 < 0.5 && A.get(aMenor).diametro.origen !== 'USUARIO') {
          alerta('ADVERTENCIA', 'REDUCCION_GRANDE', [nid, id, aMenor], `La reducción de ${pulgadas(D1)} a ${pulgadas(D2)} en ${nid} es de más de la mitad.`, 'Suele ser una derivación o un diámetro mal leído; se cotiza como está.',
            `¿El ${T(aMenor, false)} es de ${pulgadas(D2)}?`, pregunta('NUMERO', aMenor, 'diametro_in', 'in', [], D2));
        }
        return { id, L: Lr };
      } catch (err) { errorMotor([nid], err); return null; }
    }

    function agregarCodo(nid, ap, ah, theta, angulo) {
      const id = nuevoId('CODO');
      const Dc = D.get(ap);
      try {
        const f = cotizarAcc({ familia: 'CODO', D_mm: r1(Dc * IN), theta_deg: theta, k_R: 1.5 });
        const g = f.geometria.detalle;
        const o = g.R_mm * Math.tan((theta * Math.PI) / 360) + (g.L_tangentes_mm || 0) / 2;
        ocupar(ap, id, o);
        ocupar(ah, id, o);
        piezas.acc.push({
          id, tipo: 'CODO', nodo_id: nid, aristas: [ap, ah], diametro_entrada_in: Dc, diametro_salida_in: Dc, d_ramal_in: null, angulo, k_R: 1.5, gajos: g.n_gajos, excentrica: null,
          partida_cotizap: { ...base, familia: 'CODO', D_mm: r1(Dc * IN), theta_deg: theta, k_R: 1.5 },
        });
        return id;
      } catch (err) { errorMotor([nid], err); return null; }
    }

    const ANG_CODO = M.proceso.angulos_codo_deg;
    const ANG_INJ = M.proceso.angulos_injerto_deg;
    orden.forEach((nid) => {
      const n = N.get(nid);
      const p = padre.get(nid);
      const h = hijos(nid);
      if (!D.size || [p, ...h].some((aid) => aid && !D.has(aid))) { n.tipo = n.equipo_id ? 'EXTREMO' : n.tipo; return; }
      if (n.equipo_id || !p) { n.tipo = 'EXTREMO'; return; }
      if (h.length === 0) {
        n.tipo = 'EXTREMO';
        piezas.abiertos.push(nid);
        if (resp(nid, 'aceptado')) resuelta('TRAZO_SIN_CONECTAR', [nid], `El extremo ${nid} queda abierto (sin brida).`, pregunta('ACEPTAR', nid, 'aceptado', null, [], true));
        else alerta('CONFIRMAR', 'TRAZO_SIN_CONECTAR', [nid], `El extremo ${nid} no llega a ningún equipo.`, 'Se deja abierto (sin brida).', '¿Se deja abierto?', pregunta('ACEPTAR', nid, 'aceptado', null, [], true));
        return;
      }
      const ann = anotado(nid);
      const ap = A.get(p);
      if (h.length === 1) {
        const ah = A.get(h[0]);
        const ejes = iso && enEje(ap) && enEje(ah);
        const phi = anguloEntre(dir(nid, p), dir(nid, h[0]));
        const colineal = ejes ? ap.eje_iso === ah.eje_iso : Math.abs(180 - phi) <= COLINEAL_DEG;
        const thetaGeo = ejes ? (colineal ? 0 : 90) : (iso ? null : 180 - phi);
        const rAng = Number(resp(nid, 'angulo_deg'));
        const Dp = D.get(p);
        const Dh = D.get(h[0]);
        if (colineal && !ann && !finito(rAng)) {
          if (Dp === Dh) { n.tipo = 'UNION_COLINEAL'; return; }
          n.tipo = 'CAMBIO_DIAMETRO';
          const red = agregarReduccion(nid, p, h[0], Math.max(Dp, Dh), Math.min(Dp, Dh), false);
          if (red) {
            n.accesorio_id = red.id;
            const dibujados = ap.diametro.origen === 'USUARIO' && A.get(h[0]).diametro.origen === 'USUARIO';
            alerta('INFO', 'TRANSICION_INSERTADA', [nid, red.id], dibujados ? `El diámetro cambia de ${pulgadas(Dp)} a ${pulgadas(Dh)} en ${nid}.` : `La etiqueta cambia de ${pulgadas(Dp)} a ${pulgadas(Dh)} sin accesorio dibujado.`, `Se insertó una reducción concéntrica de ${pulgadas(Math.max(Dp, Dh))} a ${pulgadas(Math.min(Dp, Dh))} (semiángulo de 15°, ${r1(red.L)} mm).`);
          }
          return;
        }
        // un codo: el ángulo respondido, el anotado, el de los ejes del isométrico o el medido en planta
        n.tipo = 'VERTICE';
        let theta;
        let ang;
        const posR = resp(h[0], 'posicion');
        if (finito(rAng) && ANG_CODO.includes(rAng)) {
          theta = rAng; ang = conAngulo(theta, 'USUARIO', 1, null);
          resuelta('ANGULO_INFERIDO', [nid], `Codo en ${nid}: ${theta}°.`, pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), theta));
        } else if (ann) {
          theta = ANG_CODO.includes(ann.valor) ? ann.valor : masCercano(ann.valor, ANG_CODO);
          ang = conAngulo(theta, ann.texto.origen === 'USUARIO' ? 'USUARIO' : 'OCR', ann.texto.confianza_ocr, ann.texto);
          if (!ANG_CODO.includes(ann.valor)) {
            alerta('CONFIRMAR', 'ANGULO_NO_PERMITIDO', [nid, ann.texto.id], `El codo en ${nid} está anotado a ${ann.valor}°.`, `El taller hace codos a ${ANG_CODO.join('°, ')}°: se usa ${theta}°.`, `¿De cuántos grados es el codo en ${nid}?`,
              pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), theta));
          } else dudosa(comoMedida(ann.texto), [nid], `El ángulo del codo en ${nid}`, `Se usa ${theta}°.`, `¿De cuántos grados es el codo en ${nid}?`, pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), theta));
          // la cota contradice los ejes: una de las aristas «verticales» es en realidad una diagonal en planta
          const vertical = [ap, ah].find((x) => x.eje_iso === 'Z' || x.orientacion_pantalla === 'VERTICAL');
          if (ejes && !colineal && theta !== 90 && vertical) {
            const opcionesPos = (t) => pregunta('OPCIONES', vertical.id, 'posicion', null, [{ valor: 'HORIZONTAL', texto: `Horizontal: codo de ${theta}°` }, { valor: 'VERTICAL', texto: 'Baja: codo de 90°' }], t);
            if (posR === 'VERTICAL' || resp(vertical.id, 'posicion') === 'VERTICAL') {
              resuelta('ORIENTACION_AMBIGUA', [vertical.id, nid], `El ${T(vertical.id)} baja: codo de 90°.`, opcionesPos('VERTICAL'));
              theta = 90; ang = conAngulo(90, 'USUARIO', 1, null);
            } else if (resp(vertical.id, 'posicion') === 'HORIZONTAL') {
              piezas.posicion.set(vertical.id, 'HORIZONTAL');
              resuelta('ORIENTACION_AMBIGUA', [vertical.id, nid], `El ${T(vertical.id)} es horizontal: codo de ${theta}°.`, opcionesPos('HORIZONTAL'));
            } else if (notaVertical(vertical.id)) {
              // la nota «SUBE/BAJA» contradice la cota del codo: manda la nota (bajada a 90°) y se pregunta
              const nv = notaVertical(vertical.id);
              piezas.posicion.set(vertical.id, 'VERTICAL');
              alerta('CONFIRMAR', 'ORIENTACION_AMBIGUA', [vertical.id, nid, nv.id], `El ${T(vertical.id)} lleva la nota «${nv.contenido_crudo}», pero el codo está anotado a ${ann.valor}°.`,
                'Manda la nota: es una bajada y el codo se cotiza a 90°.', `¿El ${T(vertical.id)} es horizontal (codo de ${theta}°) o baja (codo de 90°)?`, opcionesPos('VERTICAL'));
              theta = 90; ang = conAngulo(90, 'INFERIDO', 0.6, nv);
            } else {
              piezas.posicion.set(vertical.id, 'HORIZONTAL');
              alerta('CONFIRMAR', 'ORIENTACION_AMBIGUA', [vertical.id, nid], `El ${T(vertical.id)} se dibujó vertical en la hoja.`,
                `En isométrico una diagonal de ${theta}° en planta también se ve vertical; la cota «${ann.valor}°» del codo la hace horizontal. Si fuera una bajada, el codo sería de 90°.`,
                `¿El ${T(vertical.id)} es horizontal (codo de ${theta}°) o baja (codo de 90°)?`,
                opcionesPos('HORIZONTAL'));
            }
          }
        } else if (thetaGeo !== null) {
          const snap = masCercano(thetaGeo, ANG_CODO);
          theta = snap;
          if (Math.abs(snap - thetaGeo) <= SNAP_DEG) {
            ang = conAngulo(theta, 'INFERIDO', 0.85, null);
            alerta('INFO', 'ANGULO_INFERIDO', [nid], `El codo en ${nid} no trae ángulo.`, ejes ? `Cambio del eje ${ap.eje_iso} al eje ${ah.eje_iso} del isométrico: ${theta}°.` : `Medido en planta: ${r1(thetaGeo)}° → ${theta}°.`, null,
              pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), theta));
          } else {
            ang = conAngulo(theta, 'INFERIDO', 0.5, null);
            alerta('CONFIRMAR', 'ANGULO_NO_PERMITIDO', [nid], `El codo en ${nid} mide unos ${r1(thetaGeo)}° en el dibujo.`, `Se usa el permitido más cercano: ${theta}°.`, `¿De cuántos grados es el codo en ${nid}?`,
              pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), theta));
          }
        } else {
          theta = 45; ang = conAngulo(45, 'DEFECTO_TALLER', 0.4, null);
          alerta('CONFIRMAR', 'ANGULO_INFERIDO', [nid], `El codo en ${nid} une una diagonal y no trae ángulo.`, 'En isométrico una diagonal no se puede medir: se usa 45°.', `¿De cuántos grados es el codo en ${nid}?`,
            pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_CODO), 45));
        }
        const codo = agregarCodo(nid, p, h[0], theta, ang);
        n.accesorio_id = codo;
        if (Dp !== Dh) {
          const red = agregarReduccion(nid, null, h[0], Math.max(Dp, Dh), Math.min(Dp, Dh), true);
          if (red) alerta('INFO', 'TRANSICION_INSERTADA', [nid, red.id], `El diámetro cambia de ${pulgadas(Dp)} a ${pulgadas(Dh)} en el codo ${nid}.`, `Se agregó una reducción después del codo (${r1(red.L)} mm).`);
        }
        return;
      }
      if (h.length === 2) {
        n.tipo = 'DERIVACION';
        let { troncoHijo, ramal } = tronco.get(nid);
        if (!troncoHijo) {
          // Y simétrica: el pantalón ya no se fabrica; se propone un injerto sobre el hijo de mayor diámetro
          [troncoHijo, ramal] = [...h].sort((x, y) => D.get(y) - D.get(x));
          if (resp(nid, 'aceptado')) resuelta('PANTALON_RETIRADO', [nid], `Derivación en ${nid} como injerto.`, pregunta('ACEPTAR', nid, 'aceptado', null, [], true));
          else {
            alerta('CONFIRMAR', 'PANTALON_RETIRADO', [nid], `La derivación en ${nid} es una Y simétrica (pantalón).`, `El taller ya no hace pantalones: se propone un injerto con ${troncoHijo} como tronco.`, '¿Se acepta el injerto en lugar del pantalón?',
              pregunta('ACEPTAR', nid, 'aceptado', null, [], true));
          }
        }
        const at = A.get(troncoHijo);
        const ar = A.get(ramal);
        const rAng = Number(resp(nid, 'angulo_deg'));
        let beta;
        let ang;
        if (finito(rAng) && ANG_INJ.includes(rAng)) {
          beta = rAng; ang = conAngulo(beta, 'USUARIO', 1, null);
          resuelta('ANGULO_DERIVACION_NO_PERMITIDO', [nid], `Injerto en ${nid} a ${beta}°.`, pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_INJ), beta));
        } else if (ann) {
          beta = ANG_INJ.includes(ann.valor) ? ann.valor : masCercano(ann.valor, ANG_INJ);
          ang = conAngulo(beta, ann.texto.origen === 'USUARIO' ? 'USUARIO' : 'OCR', ann.texto.confianza_ocr, ann.texto);
          if (!ANG_INJ.includes(ann.valor)) {
            alerta('CONFIRMAR', 'ANGULO_DERIVACION_NO_PERMITIDO', [nid, ann.texto.id], `La derivación en ${nid} está anotada a ${ann.valor}°.`, `El taller sólo hace injertos a ${ANG_INJ.join('° o ')}°: se usa ${beta}°.`, `¿A cuántos grados va el injerto en ${nid}?`,
              pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_INJ), beta));
          } else dudosa(comoMedida(ann.texto), [nid], `El ángulo del injerto en ${nid}`, `Se usa ${beta}°.`, `¿A cuántos grados va el injerto en ${nid}?`, pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_INJ), beta));
        } else {
          const ejes = iso && enEje(at) && enEje(ar);
          const phi = iso ? null : anguloEntre(dir(nid, troncoHijo), dir(nid, ramal));
          const enT = ejes ? at.eje_iso !== ar.eje_iso : (phi !== null && Math.abs(phi - 90) <= COLINEAL_DEG);
          if (enT || phi === null) {
            beta = 45; ang = conAngulo(45, 'DEFECTO_TALLER', 0.5, null);
            alerta('CONFIRMAR', 'ANGULO_DERIVACION_NO_PERMITIDO', [nid], enT ? `La derivación en ${nid} hacia el ${T(ramal)} se dibujó como T a 90°.` : `La derivación en ${nid} hacia el ${T(ramal)} no trae ángulo.`,
              `El taller sólo hace injertos a ${ANG_INJ.join('° o ')}° y una T a 90° en colección de polvo pierde carga: se propone injerto a 45° a favor del flujo.`, '¿Se acepta el injerto a 45°?',
              pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo([...ANG_INJ].reverse()), 45));
          } else {
            const contra = phi > 90;
            beta = masCercano(contra ? 180 - phi : phi, ANG_INJ);
            ang = conAngulo(beta, 'INFERIDO', 0.8, null);
            if (contra) {
              alerta('CONFIRMAR', 'DERIVACION_CONTRA_FLUJO', [nid, ramal], `El ${T(ramal)} entra contra el flujo.`, `Se voltea: injerto a ${beta}° a favor del flujo.`, '¿Se acepta el injerto a favor del flujo?', pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_INJ), beta));
            } else {
              alerta('INFO', 'ANGULO_INFERIDO', [nid], `La derivación en ${nid} no trae ángulo.`, `Medido en planta: ${r1(phi)}° → ${beta}°.`, null, pregunta('OPCIONES', nid, 'angulo_deg', 'deg', opcionesAngulo(ANG_INJ), beta));
            }
          }
        }
        const D1 = D.get(p);
        const D2 = D.get(troncoHijo);
        const d = D.get(ramal);
        if (d > D2) {
          alerta('BLOQUEANTE', 'DIAMETRO_INCONSISTENTE', [ramal, troncoHijo], `El ramal (${T(ramal)}) es mayor que el tronco (${pulgadas(D2)}).`, 'Un injerto no puede ser mayor que su tronco: no se fabrica la pieza hasta corregir el diámetro.', `¿Cuál es el diámetro del ${T(ramal, false)}?`, pregunta('NUMERO', ramal, 'diametro_in', 'in', [], D2));
          return;
        }
        if (D1 === D2) {
          const id = nuevoId('INJ');
          const sen = Math.sin((beta * Math.PI) / 180);
          const Rm = (D2 * IN + espesor) / 2;
          const rb = (d * IN + espesor) / 2;
          const tMax = (Rm + rb * Math.cos((beta * Math.PI) / 180)) / sen; // el mínimo del motor (geometria.ramal)
          const L_ramal = Math.ceil((tMax + 100) / 50) * 50;
          const L_cuerpo = Math.ceil(((d * IN) / sen + 150) / 50) * 50;
          const partida = { ...base, familia: 'RAMAL', D_mm: r1(D2 * IN), d_mm: r1(d * IN), beta_deg: beta, L_cuerpo_mm: L_cuerpo, L_ramal_mm: L_ramal };
          try { cotizarAcc(partida); } catch (err) { errorMotor([nid], err); return; }
          ocupar(p, id, L_cuerpo / 2); ocupar(troncoHijo, id, L_cuerpo / 2); ocupar(ramal, id, L_ramal);
          piezas.acc.push({ id, tipo: 'INJERTO', nodo_id: nid, aristas: [p, troncoHijo, ramal], diametro_entrada_in: D2, diametro_salida_in: D2, d_ramal_in: d, angulo: ang, k_R: null, gajos: null, excentrica: null, partida_cotizap: partida });
          n.accesorio_id = id;
        } else {
          const id = nuevoId('RINJ');
          const partida = { ...base, familia: 'REDUCCION_INJERTO', D1_mm: r1(Math.max(D1, D2) * IN), D2_mm: r1(Math.min(D1, D2) * IN), d_mm: r1(d * IN), beta_deg: beta };
          try {
            const g = cotizarAcc(partida).geometria.detalle;
            ocupar(p, id, g.L_reduccion_mm / 2); ocupar(troncoHijo, id, g.L_reduccion_mm / 2); ocupar(ramal, id, g.L_ramal_mm);
          } catch (err) { errorMotor([nid], err); return; }
          piezas.acc.push({ id, tipo: 'REDUCCION_INJERTO', nodo_id: nid, aristas: [p, troncoHijo, ramal], diametro_entrada_in: Math.max(D1, D2), diametro_salida_in: Math.min(D1, D2), d_ramal_in: d, angulo: ang, k_R: null, gajos: null, excentrica: false, partida_cotizap: partida });
          n.accesorio_id = id;
        }
        return;
      }
      n.tipo = 'CRUCE';
      alerta('BLOQUEANTE', 'CRUCE_SIN_NODO', [nid], `En ${nid} se juntan ${h.length + 1} tramos.`, 'Una derivación múltiple se hace con injertos separados al menos un diámetro.', '¿Cómo se separan las derivaciones?');
    });

    // --- 6. equipos: conexión con brida del equipo y mangueras
    const extremoDe = new Map(piezas.abiertos.map((nid) => [nid, 'ABIERTO'])); // nodo → tipo de extremo del tramo que llega
    const compras = [];
    L.equipos.forEach((e) => {
      const n = N.get(e.nodo_id);
      const aid = n.aristas[0];
      if (!aid || !D.has(aid)) return;
      const Dd = D.get(aid);
      if (e.conexion === 'MANGUERA') {
        extremoDe.set(n.id, 'LISO_MANGUERA');
        const art = `MANGUERA_${Math.round(Dd)}`;
        if (!M.compras.articulos[art]) {
          alerta('ADVERTENCIA', 'MANGUERA_SIN_LARGO', [e.id], `No hay manguera de ${pulgadas(Dd)} en el catálogo de compras para «${e.nombre}».`, 'No se cotiza la manguera: agréguela al catálogo o como partida comprada.', null);
          return;
        }
        const tr = Number(resp(e.id, 'manguera_tramos'));
        const tramos = finito(tr) && tr >= 1 ? Math.round(tr) : 1;
        if (finito(tr) && tr >= 1) resuelta('MANGUERA_SIN_LARGO', [e.id], `«${e.nombre}»: ${tramos} ${tramos === 1 ? 'tramo' : 'tramos'} de manguera.`, pregunta('NUMERO', e.id, 'manguera_tramos', 'tramos', [], tramos));
        else {
          alerta('ADVERTENCIA', 'MANGUERA_SIN_LARGO', [e.id], `La manguera a «${e.nombre}» no trae largo.`, `Se cuenta un tramo del catálogo («${M.compras.articulos[art].descripcion}») y una abrazadera en cada punta.`, `¿Cuántos tramos de manguera lleva «${e.nombre}»?`,
            pregunta('NUMERO', e.id, 'manguera_tramos', 'tramos', [], 1));
        }
        compras.push({ equipo: e, nodo: n.id, arista: aid, D: Dd, articulo: art, tramos });
      } else if (e.conexion === 'LISO') extremoDe.set(n.id, 'ABIERTO');
      else {
        extremoDe.set(n.id, 'BRIDA_EQUIPO');
        if (e.conexion === 'BRIDA_EQUIPO') {
          const bocaR = Number(resp(e.id, 'boca_in'));
          const bm = e.boca_diametro;
          const bocaLeida = bm && finito(bm.valor) && bm.valor > 0 && bm.confianza >= CONF_MIN ? comercial(bm.unidad === 'mm' ? bm.valor / IN : bm.valor) : null;
          const boca = finito(bocaR) && bocaR > 0 ? bocaR : bocaLeida;
          if (finito(bocaR) && bocaR > 0) resuelta('CONEXION_EQUIPO', [e.id], `«${e.nombre}»: boca de ${pulgadas(bocaR)}.`, pregunta('NUMERO', e.id, 'boca_in', 'in', [], bocaR));
          else if (bocaLeida) {
            // anotada en el croquis: el diámetro se usa; el patrón de barrenos lo dice el equipo
            alerta('ADVERTENCIA', 'CONEXION_EQUIPO', [e.id, n.id, bm.texto_id].filter(Boolean), bm.origen === 'USUARIO' ? `La boca de «${e.nombre}» es de ${pulgadas(bocaLeida)}.` : `La boca de «${e.nombre}» está anotada de ${pulgadas(bocaLeida)}.`, 'Se usa; confirme con el equipo su patrón de barrenos (la otra media junta la pone el equipo).',
              `¿Se confirma la boca de ${pulgadas(bocaLeida)} de «${e.nombre}»?`, pregunta('NUMERO', e.id, 'boca_in', 'in', [], bocaLeida));
          } else {
            alerta('CONFIRMAR', 'CONEXION_EQUIPO', [e.id, n.id], `La boca de «${e.nombre}» no trae medida ni barrenos.`, `Se supone boca de ${pulgadas(Dd)} con brida compatible; la otra media junta la pone el equipo.`, `¿De qué diámetro es la boca de «${e.nombre}»? (confirme también su patrón de barrenos)`,
              pregunta('NUMERO', e.id, 'boca_in', 'in', [], Dd));
          }
          if (boca && Math.abs(boca - Dd) > 1e-9) {
            const red = agregarReduccion(n.id, null, aid, Math.max(boca, Dd), Math.min(boca, Dd), true);
            if (red) alerta('INFO', 'TRANSICION_INSERTADA', [e.id, red.id], `La boca de «${e.nombre}» (${pulgadas(boca)}) no es del diámetro del ducto (${pulgadas(Dd)}).`, `Se agregó una reducción de ${r1(red.L)} mm en la conexión.`);
          }
        }
      }
    });

    // --- 7. tramos rectos: longitud neta y armado por yardas
    const ductos = [];
    const uniones = []; // accesorios pegados sin tramo entre ellos
    const engargolado = !((M.proceso.costuras || {})[M.materiales[material].costura] || {}).soldada;
    const comoUnion = engargolado ? 'unión engargolada' : 'unión soldada';
    aristas.forEach((a, i) => {
      const id = id3('DUCT', i + 1); // por el orden de las aristas: no cambia al responder
      if (!D.has(a.id) || !Lmm.has(a.id)) return;
      const desc = piezas.ocupa.get(a.id) || [];
      const cota = r1(Lmm.get(a.id));
      const neta = r1(cota - (md.convencion_cotas === 'NETAS' ? 0 : desc.reduce((s, x) => s + x.mm, 0)));
      if (neta <= 0) {
        alerta('BLOQUEANTE', 'ACCESORIOS_ENCIMADOS', [a.id, ...desc.map((x) => x.accesorio_id)], `Los accesorios del ${T(a.id)} ocupan más que su cota (${r2(cota / 1000)} m).`, 'No queda tramo recto: la cota o los accesorios están mal.', `¿Cuánto mide el ${T(a.id)}?`, pregunta('NUMERO', a.id, 'longitud_m', 'm', [], null));
        return;
      }
      // dos accesorios con menos de 150 mm entre ellos: se pegan (sin bridas en esa cara) o se fabrica el tramo corto
      const entre = [...new Set(desc.map((x) => x.accesorio_id))].map((idAcc) => piezas.acc.find((x) => x.id === idAcc)).filter(Boolean);
      if (neta < NETA_MIN_MM && entre.length === 2) {
        const r = resp(a.id, 'encimado');
        const opciones = [{ valor: 'UNION', texto: `Pegar los accesorios (${comoUnion})` }, { valor: 'TRAMO', texto: `Tramo corto de ${neta} mm con bridas` }];
        const pegar = r !== 'TRAMO';
        if (r === 'UNION' || r === 'TRAMO') {
          resuelta('ACCESORIOS_ENCIMADOS', [a.id], pegar ? `${entre[0].id} y ${entre[1].id} se pegan (${comoUnion}).` : `Tramo corto de ${neta} mm entre ${entre[0].id} y ${entre[1].id}.`, pregunta('OPCIONES', a.id, 'encimado', null, opciones, r));
        } else {
          alerta('CONFIRMAR', 'ACCESORIOS_ENCIMADOS', [a.id, entre[0].id, entre[1].id], `Entre ${entre[0].id} y ${entre[1].id} sólo quedan ${neta} mm de tramo recto en el ${T(a.id)}.`,
            `Se pegan con una ${comoUnion}, sin bridas en esas caras; el recorrido queda ${neta} mm más corto que la cota.`, '¿Se pegan los accesorios o se fabrica el tramo corto?', pregunta('OPCIONES', a.id, 'encimado', null, opciones, 'UNION'));
        }
        if (pegar) {
          uniones.push({ arista: a.id, D: D.get(a.id), accesorios: entre, neta });
          return;
        }
      } else if (neta < NETA_MIN_MM) {
        if (resp(a.id, 'aceptado')) resuelta('ACCESORIOS_ENCIMADOS', [a.id], `Tramo corto aceptado: ${T(a.id)}.`, pregunta('ACEPTAR', a.id, 'aceptado', null, [], true));
        else alerta('CONFIRMAR', 'ACCESORIOS_ENCIMADOS', [a.id], `Al ${T(a.id)} sólo le quedan ${neta} mm de tramo recto.`, 'Se fabrica el tramo corto entre los accesorios.', '¿Se acepta el tramo corto?', pregunta('ACEPTAR', a.id, 'aceptado', null, [], true));
      }
      const extremoFin = extremoDe.get(a.nodo_b) || 'BRIDA';
      const extremoIni = extremoDe.get(a.nodo_a) || 'BRIDA';
      const partida = { ...base, familia: 'RECTO', D_mm: r1(D.get(a.id) * IN), L_mm: neta, yarda_mm: yarda, posicion: piezas.posicion.get(a.id) };
      if (extremoFin === 'LISO_MANGUERA' || extremoFin === 'ABIERTO') partida.extremo_ajuste = 'SIN_BRIDA';
      let arm;
      try { arm = COT.cotizarPartida(partida, M).geometria.detalle.armado; } catch (err) { errorMotor([a.id], err); return; }
      a.ducto_id = id;
      ductos.push({
        id, arista_id: a.id, nodo_inicio: a.nodo_a, nodo_fin: a.nodo_b, diametro_in: D.get(a.id), diametro_mm: r1(D.get(a.id) * IN), longitud_cota_mm: cota,
        convencion_cota: md.convencion_cotas === 'NETAS' ? 'NETAS' : 'EJES', descuentos: md.convencion_cotas === 'NETAS' ? [] : desc, longitud_neta_mm: neta,
        posicion: partida.posicion, material, calibre, tipo_union: 'BRIDADO', extremo_inicio: extremoIni, extremo_fin: extremoFin,
        armado: { yarda_mm: yarda, piezas: arm.piezas.length, juntas_internas: arm.piezas.length - 1, ajuste_mm: r1(arm.ajuste_mm || 0) },
        confianza: Math.min(a.diametro.confianza, a.longitud_cota.confianza), partida_cotizap: partida,
      });
    });

    // los accesorios pegados pierden la brida de la cara que se une, y la unión es una partida «armado de piezas»
    const extremoDeAcc = (x, aid) => {
      const i = x.aristas.indexOf(aid);
      if (x.tipo === 'CODO') return i === 0 ? 'A' : 'B';
      if (x.tipo === 'INJERTO') return ['tronco_1', 'tronco_2', 'injerto'][i];
      if (x.tipo === 'REDUCCION_INJERTO') return i === 2 ? 'injerto' : (D.get(aid) >= x.diametro_entrada_in - 1e-9 ? 'D1' : 'D2');
      if (x.tipo === 'REDUCCION') return D.get(aid) >= x.diametro_entrada_in - 1e-9 ? 'D1' : 'D2';
      return null;
    };
    uniones.forEach((u) => {
      u.accesorios.forEach((x) => {
        const ext = extremoDeAcc(x, u.arista);
        if (!ext) return;
        const lista = new Set([...(x.partida_cotizap.extremos_sin_brida || []), ext]);
        x.partida_cotizap.extremos_sin_brida = [...lista];
      });
      u.partida = { ...base, familia: 'UNION', D_mm: r1(u.D * IN), n_uniones: 1, tipo_union: 'LISO' };
    });

    return armarSalida(L, M, { alertas, piezas, ductos, compras, uniones, D, extremoDe, base });
  }

  /* ------------------------------------------------------------------ uniones, soportes, resumen */

  function armarSalida(L, M, ctx) {
    const { alertas } = ctx;
    const ductos = ctx.ductos || [];
    const acc = ctx.piezas ? ctx.piezas.acc : [];
    const elementos = [];
    const soportes = [];
    const compradas = [];
    if (ctx.piezas) {
      const aros = new Map();
      const aroDe = (Din) => {
        if (!aros.has(Din)) aros.set(Din, COT.cotizarPartida({ ...ctx.base, familia: 'CODO', D_mm: r1(Din * IN), theta_deg: 90 }, M).qto.her.aros[0]);
        return aros.get(Din);
      };
      const mlJunta = M.herrajes.uniones.BRIDADO.ml_sellador_junta_m;
      const junta = (tipo, nodo_id, piezas, Din, nAros, sueltos, origen) => {
        const a = aroDe(Din);
        elementos.push({
          id: id3('JNT', elementos.length + 1), tipo, nodo_id, piezas, diametro_in: Din, aros: nAros, aros_sueltos: sueltos, perfil: 'SOL_1_1_2X3_16',
          solera_por_aro_mm: r1(a.L_aro_mm), barrenos_por_aro: a.n_tornillos, tornillos_juegos: a.n_tornillos, tornillo: a.tornillo_desc,
          sellador_ml: r1((a.P_perno_mm / 1000) * mlJunta), abrazaderas_manguera: 0, incluido_en_partidas: tipo === 'JUNTA_BRIDADA' ? 'COMPLETO' : 'MEDIA_JUNTA', origen, articulo_manguera: null, partida_cotizap: null,
        });
      };
      const ductoDe = (aid) => ductos.find((d) => d.arista_id === aid);
      const sueltoEn = (d, nodoId) => (d && d.nodo_fin === nodoId && d.armado.ajuste_mm > 0 && d.extremo_fin !== 'LISO_MANGUERA' && d.extremo_fin !== 'ABIERTO' ? 1 : 0);
      // en los nodos: pieza contra pieza (una reducción pegada a un codo o a un equipo se une a la pieza vecina)
      acc.forEach((x) => x.aristas.forEach((aid) => {
        const d = ductoDe(aid);
        if (!d) return;
        const Din = x.tipo === 'REDUCCION' && x.aristas.length === 1 ? x.diametro_salida_in : d.diametro_in;
        junta('JUNTA_BRIDADA', x.nodo_id, [d.id, x.id], Din, 2, sueltoEn(d, x.nodo_id), 'NODO');
      }));
      // reducciones pegadas a un codo o a un equipo: su lado mayor se une al codo o a la boca
      acc.filter((x) => x.tipo === 'REDUCCION' && x.aristas.length === 1).forEach((x) => {
        const vecino = acc.find((y) => y.nodo_id === x.nodo_id && y.id !== x.id);
        if (vecino) junta('JUNTA_BRIDADA', x.nodo_id, [vecino.id, x.id], x.diametro_entrada_in, 2, 0, 'NODO');
        else {
          const eq = L.equipos.find((e) => e.nodo_id === x.nodo_id);
          if (eq) junta('JUNTA_EQUIPO', x.nodo_id, [x.id, eq.id], x.diametro_entrada_in, 1, 0, 'NODO');
        }
      });
      // a los equipos con brida (si no hay una reducción en medio)
      L.equipos.forEach((e) => {
        if (ctx.extremoDe.get(e.nodo_id) !== 'BRIDA_EQUIPO') return;
        if (acc.some((x) => x.tipo === 'REDUCCION' && x.nodo_id === e.nodo_id && x.aristas.length === 1)) return;
        const d = ductoDe(L.red.nodos.find((n) => n.id === e.nodo_id).aristas[0]);
        if (d) junta('JUNTA_EQUIPO', e.nodo_id, [d.id, e.id], d.diametro_in, 1, sueltoEn(d, e.nodo_id), 'NODO');
      });
      // accesorios pegados: la unión entre ellos (sin aros: la cobra su partida de armado de piezas)
      (ctx.uniones || []).forEach((u) => elementos.push({
        id: id3('JNT', elementos.length + 1), tipo: 'UNION_ENGARGOLADA', nodo_id: null, piezas: u.accesorios.map((x) => x.id), diametro_in: u.D, aros: 0, aros_sueltos: 0, perfil: null,
        solera_por_aro_mm: null, barrenos_por_aro: null, tornillos_juegos: 0, tornillo: null, sellador_ml: 0, abrazaderas_manguera: 0, incluido_en_partidas: 'COMPLETO', origen: 'NODO', articulo_manguera: null,
        partida_cotizap: u.partida,
      }));
      // dentro de los tramos: entre sus piezas de hasta 3 yardas
      ductos.forEach((d) => { for (let k = 0; k < d.armado.juntas_internas; k += 1) junta('JUNTA_BRIDADA', null, [d.id, d.id], d.diametro_in, 2, 0, 'ARMADO_YARDAS'); });
      // mangueras: extremo liso, el tramo del catálogo y una abrazadera en cada punta
      (ctx.compras || []).forEach((c) => {
        const d = ductoDe(c.arista);
        elementos.push({
          id: id3('JNT', elementos.length + 1), tipo: 'JUNTA_MANGUERA', nodo_id: c.nodo, piezas: [d ? d.id : c.arista, c.equipo.id], diametro_in: c.D, aros: 0, aros_sueltos: 0, perfil: null,
          solera_por_aro_mm: null, barrenos_por_aro: null, tornillos_juegos: 0, tornillo: null, sellador_ml: 0, abrazaderas_manguera: 2, incluido_en_partidas: 'NO', origen: 'NODO', articulo_manguera: c.articulo,
          partida_cotizap: null,
        });
      });
      // soportes: la regla del taller sobre las partidas del ducto, y una abrazadera por ménsula del diámetro que sostiene
      const partidas = [...ductos.map((d) => d.partida_cotizap), ...acc.map((x) => x.partida_cotizap), ...(ctx.uniones || []).map((u) => u.partida)];
      if (partidas.length) {
        const res = COT.cotizar({ yarda_mm: L.metadatos.yarda_mm, partidas }, M);
        const conteo = SOP.contar(res.partidas, M);
        const porD = new Map();
        const sumar = (Dmm, n) => { const Din = Math.round((Dmm / IN) * 10) / 10; porD.set(Din, (porD.get(Din) || 0) + n); };
        conteo.tramos.forEach((t) => sumar(res.partidas[t.indice].entrada.D_mm, t.soportes));
        conteo.accesorios.forEach((x) => { const e = res.partidas[x.indice].entrada; sumar(e.D_mm || e.D1_mm, x.soportes); });
        if (conteo.n > 0) {
          soportes.push({
            id: 'SOP-001', tipo: 'MENSULA', cantidad: conteo.n, regla: 'proceso.soportes.espaciado (2.5 m horizontal, 3.0 m vertical, 1 por accesorio)', diametro_in: null,
            partida_cotizap: { familia: 'SOPORTE', descripcion: 'Ménsulas del ducto', cantidad: conteo.n, cantidad_modo: 'AUTO', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, anclajes_pieza: 4, min_pieza: 137.14 },
          });
          [...porD.keys()].sort((a, b) => b - a).forEach((Din, i) => soportes.push({
            id: id3('SOP', i + 2), tipo: 'ABRAZADERA', cantidad: porD.get(Din), regla: 'una por ménsula, del diámetro del ducto que sostiene', diametro_in: Din,
            partida_cotizap: { familia: 'SOPORTE', descripcion: `Abrazaderas tipo cuna Ø${pulgadas(Din)}`, cantidad: porD.get(Din), cantidad_modo: 'MANUAL', barra_id: 'SOL_1_1_4X1_8', abrazadera_D_mm: r1(Din * IN), abrazadera_vuelta: 'MEDIA' },
          }));
        }
        // el calibre contra la tabla de servicio (lo avisa el motor partida por partida)
        if (res.partidas.some((f) => f.ok && f.advertencias.some((w) => /más delgado que el mínimo recomendado/.test(w)))) {
          const cal = L.metadatos.calibre;
          const respuesta = {
            tipo: 'OPCIONES', elemento: 'metadatos', campo: 'calibre', unidad: null, propuesta: cal.valor,
            opciones: Object.keys(M.calibres[M.materiales[ctx.base.material_id].tabla_calibre]).map((k) => ({ valor: Number(k), texto: `Calibre ${k}` })),
          };
          if (cal.origen === 'USUARIO') alertas.push({ severidad: 'INFO', codigo: 'CALIBRE_BAJO_TABLA', referencias: ['metadatos'], mensaje: `Calibre ${cal.valor} confirmado.`, decision_tomada: 'Respondido por el ingeniero.', pregunta: null, respuesta, resuelta: true });
          else {
            alertas.push({
              severidad: 'ADVERTENCIA', codigo: 'CALIBRE_BAJO_TABLA', referencias: ['metadatos', cal.texto_id].filter(Boolean), mensaje: `Calibre ${cal.valor} en todo el sistema.`,
              decision_tomada: 'La tabla de servicio (ilustrativa) pide calibre más grueso para estos diámetros; se cotiza el del croquis.', pregunta: '¿Se confirma el calibre?', respuesta, resuelta: false,
            });
          }
        }
      }
      // compras: mangueras y sus abrazaderas
      const porArt = new Map();
      (ctx.compras || []).forEach((c) => { porArt.set(c.articulo, (porArt.get(c.articulo) || 0) + c.tramos); });
      [...porArt.keys()].sort((a, b) => b.localeCompare(a)).forEach((art) => compradas.push({ familia: 'COMPRADO', descripcion: M.compras.articulos[art].descripcion, articulo_id: art, cantidad: porArt.get(art) }));
      const abz = (ctx.compras || []).length * 2;
      if (abz > 0 && M.compras.articulos.ABRAZADERA_MANGUERA) compradas.push({ familia: 'COMPRADO', descripcion: 'Abrazaderas de manguera', articulo_id: 'ABRAZADERA_MANGUERA', cantidad: abz });
    }
    // textos que no se asociaron a nada (los globales de material y calibre sí se usan)
    L.red.textos.filter((t) => !t.asociado_a && !['CALIBRE', 'MATERIAL'].includes(t.tipo)).forEach((t) => {
      alertas.push({ severidad: 'INFO', codigo: 'TEXTO_SIN_ASOCIAR', referencias: [t.id], mensaje: `«${t.contenido_crudo}» sin significado claro (lectura ${t.confianza_ocr}).`, decision_tomada: 'No está junto a ninguna arista ni nodo: se descarta.', pregunta: null, respuesta: null, resuelta: false });
    });
    // las alertas que sólo puede ver la etapa de visión
    (L.alertas_ambiguedad || []).forEach((a) => alertas.push({
      severidad: SEVERIDADES.includes(a.severidad) ? a.severidad : 'CONFIRMAR', codigo: a.codigo, referencias: Array.isArray(a.referencias) ? a.referencias.filter((r) => typeof r === 'string') : [],
      mensaje: typeof a.mensaje === 'string' ? a.mensaje : '', decision_tomada: typeof a.decision_tomada === 'string' ? a.decision_tomada : null, pregunta: typeof a.pregunta === 'string' ? a.pregunta : null, respuesta: null, resuelta: false,
    }));
    // cada referencia del croquis lleva también la pieza que le tocó, para ubicarla en el despiece
    const accDeNodo = new Map(L.red.nodos.filter((n) => n.accesorio_id).map((n) => [n.id, n.accesorio_id]));
    const ductoDeArista = new Map(ductos.map((d) => [d.arista_id, d.id]));
    alertas.forEach((a) => {
      const mas = [];
      a.referencias.forEach((r) => {
        if (accDeNodo.has(r)) mas.push(accDeNodo.get(r));
        if (ductoDeArista.has(r)) mas.push(ductoDeArista.get(r));
        elementos.filter((j) => j.tipo !== 'JUNTA_BRIDADA' && j.piezas.includes(r)).forEach((j) => mas.push(j.id));
      });
      a.referencias = [...new Set([...a.referencias, ...mas])];
    });
    // orden: por severidad y, dentro de cada una, en el orden en que se encontraron; las resueltas al final
    const ordenadas = alertas.map((a, i) => ({ a, i })).sort((x, y) => (x.a.resuelta - y.a.resuelta) || (SEVERIDADES.indexOf(x.a.severidad) - SEVERIDADES.indexOf(y.a.severidad)) || (x.i - y.i))
      .map(({ a }, k) => ({ id: id3('ALR', k + 1), ...a }));
    const pend = (s) => ordenadas.filter((a) => a.severidad === s && !a.resuelta).length;
    const estado = ctx.estadoForzado || (pend('BLOQUEANTE') ? 'NO_COTIZABLE' : pend('CONFIRMAR') ? 'PRELIMINAR' : 'DEFINITIVA');
    // resumen
    const A = new Map(L.red.aristas.map((a) => [a.id, a]));
    const col = L.equipos.find((e) => e.tipo === 'COLECTOR');
    const largo = (aid) => (finito(A.get(aid).longitud_cota.valor) && A.get(aid).longitud_cota.valor > 0 ? A.get(aid).longitud_cota.valor : 0);
    const masLejos = (nid, desde) => {
      const sig = L.red.aristas.filter((a) => a.nodo_a === nid && a.id !== desde);
      if (!sig.length) return { nodo: nid, m: 0 };
      return sig.map((a) => { const r = masLejos(a.nodo_b, a.id); return { nodo: r.nodo, m: r.m + largo(a.id) }; }).reduce((x, y) => (y.m > x.m ? y : x));
    };
    const lejos = col ? masLejos(col.nodo_id, null) : { nodo: L.red.nodos[0].id, m: 0 };
    const Dmax = Math.max(0, ...L.red.aristas.map((a) => (finito(a.diametro.valor) ? a.diametro.valor : 0)));
    const tramosManguera = compradas.filter((c) => /^MANGUERA/.test(c.articulo_id)).reduce((s, c) => s + c.cantidad, 0);
    const menulas = soportes.length ? soportes[0].cantidad : 0;
    const resumen = {
      estado,
      diametro_max_in: Dmax,
      longitud_total_cotas_m: r2(L.red.aristas.reduce((s, a) => s + largo(a.id), 0)),
      longitud_total_neta_m: r2(ductos.reduce((s, d) => s + d.longitud_neta_mm, 0) / 1000),
      punto_mas_alejado: lejos.nodo,
      longitud_al_punto_mas_alejado_m: r2(lejos.m),
      conteo: {
        ductos_rectos: ductos.length, accesorios: acc.length,
        juntas_bridadas: elementos.filter((j) => j.tipo === 'JUNTA_BRIDADA').length, juntas_equipo: elementos.filter((j) => j.tipo === 'JUNTA_EQUIPO').length,
        juntas_manguera: elementos.filter((j) => j.tipo === 'JUNTA_MANGUERA').length,
        aros: elementos.reduce((s, j) => s + j.aros, 0), aros_sueltos: elementos.reduce((s, j) => s + j.aros_sueltos, 0),
        tornillos_juegos: elementos.reduce((s, j) => s + j.tornillos_juegos, 0), sellador_ml: r1(elementos.reduce((s, j) => s + j.sellador_ml, 0)), menulas,
      },
      alertas: { BLOQUEANTE: pend('BLOQUEANTE'), CONFIRMAR: pend('CONFIRMAR'), ADVERTENCIA: pend('ADVERTENCIA'), INFO: ordenadas.filter((a) => a.severidad === 'INFO').length },
      cotizacion_rapida: { D_mm: r1(Dmax * IN), L_m: r2(lejos.m), yarda_mm: L.metadatos.yarda_mm, menulas, mangueras_tramos: tramosManguera },
    };
    return {
      version: '1.0', metadatos: L.metadatos, red: L.red, equipos: L.equipos,
      ductos_rectos: ductos, accesorios: acc, elementos_union: elementos, soportes, partidas_compradas: compradas, alertas_ambiguedad: ordenadas, resumen,
    };
  }

  /**
   * Las partidas de la cotización que salen de un despiece: tramos, accesorios, soportes y compras, cada una con el
   * identificador de su pieza (`unifilar_id`) para ubicarla en el croquis y para reemplazarla si se vuelve a calcular.
   */
  function aPartidas(bom) {
    const marca = (p, id) => ({ ...U.clonar(p), unifilar_id: id });
    return [
      ...bom.ductos_rectos.map((d) => marca(d.partida_cotizap, d.id)),
      ...bom.accesorios.map((a) => marca(a.partida_cotizap, a.id)),
      ...bom.elementos_union.filter((j) => j.partida_cotizap).map((j) => marca(j.partida_cotizap, `UNION-${j.piezas.join('-')}`)),
      ...bom.soportes.map((s) => marca(s.partida_cotizap, s.id)),
      ...bom.partidas_compradas.map((c) => marca(c, `COMPRA-${c.articulo_id}`)),
    ];
  }

  /** Las alertas que esperan una respuesta (CONFIRMAR y BLOQUEANTE sin resolver). */
  const pendientes = (bom) => bom.alertas_ambiguedad.filter((a) => !a.resuelta && (a.severidad === 'CONFIRMAR' || a.severidad === 'BLOQUEANTE'));

  /**
   * Las respuestas guardadas (en el navegador o en un archivo), sólo con la forma que se usa: { elemento: { campo: valor } },
   * con los campos de CAMPOS y valores número, texto corto o sí/no. Lo demás se descarta.
   */
  function respuestasValidas(R) {
    const out = {};
    if (!esObjeto(R)) return out;
    Object.keys(R).slice(0, 2000).forEach((id) => {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !esObjeto(R[id])) return;
      const r = {};
      CAMPOS.forEach((c) => {
        const v = R[id][c];
        if (finito(v) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 40)) r[c] = v;
      });
      if (Object.keys(r).length) out[id] = r;
    });
    return out;
  }

  return { leer, despiezar, aPartidas, pendientes, respuestasValidas, CAMPOS, COMERCIALES_IN, SEVERIDADES };
}));
