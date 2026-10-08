/**
 * COTIZAP · unifilar_vision.js — La etapa de visión (docs/vision-unifilares.md §2 E0–E3 y §7.4): de la foto del croquis a la
 * LECTURA que despieza motor/unifilar.js. Aquí está lo que no depende del navegador: cómo se reparte la foto en imágenes
 * (la hoja completa y recortes a más resolución), las instrucciones para el modelo, qué textos se vuelven a leer en un
 * recorte ampliado (re-lectura dirigida) y cómo se aplica lo releído. La llamada al modelo y el dibujo de las imágenes
 * están en web/unifilar_ui.js.
 *
 * El modelo LEE (nodos, aristas, textos, equipos, con su confianza); no calcula piezas ni completa lo que falta: eso lo
 * hacen las reglas, que además preguntan lo dudoso.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.unifilarVision = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PX = 1150000; // píxeles por imagen: bajo el límite con que la plataforma reduce (≈1.2 MP), así las coordenadas no cambian
  const TIPOS_TEXTO = ['DIAMETRO', 'LONGITUD', 'ANGULO', 'CALIBRE', 'MATERIAL', 'EQUIPO', 'NOTA', 'ILEGIBLE'];
  const RELEER = ['DIAMETRO', 'LONGITUD', 'ANGULO', 'CALIBRE', 'ILEGIBLE'];
  const CONF_SEGURA = 0.9;
  const esObjeto = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  const finito = (x) => typeof x === 'number' && Number.isFinite(x);
  const redondo = (x) => Math.round(x);

  /**
   * Cómo se manda una foto de ancho × alto px: la hoja completa reducida a ≤ 1.15 MP (sus píxeles son los de todas las
   * coordenadas) y, si la foto es mucho mayor, recortes que se traslapan, cada uno a más resolución. maxImagenes: las que
   * acepta una llamada. Devuelve { escala, enviado: {w, h}, recortes: [{ id, x, y, w, h (en la imagen enviada),
   * origen: {x, y, w, h} (en la foto), salida: {w, h} (píxeles del recorte que se manda) }] }.
   */
  function planDeImagen(ancho, alto, maxImagenes) {
    if (!(ancho > 0 && alto > 0)) throw new Error('La imagen no tiene tamaño.');
    const escala = Math.min(1, Math.sqrt(MAX_PX / (ancho * alto)));
    const enviado = { w: Math.max(1, Math.floor(ancho * escala)), h: Math.max(1, Math.floor(alto * escala)) }; // hacia abajo: nunca pasa del tope
    const recortes = [];
    const max = Number.isInteger(maxImagenes) ? maxImagenes : 1;
    if (escala < 0.75 && max >= 3) {
      const traslape = 1.12;
      const [cols, filas] = max >= 5 ? [2, 2] : (ancho >= alto ? [2, 1] : [1, 2]);
      const tw = Math.min(ancho, Math.ceil((ancho / cols) * (cols > 1 ? traslape : 1)));
      const th = Math.min(alto, Math.ceil((alto / filas) * (filas > 1 ? traslape : 1)));
      for (let j = 0; j < filas; j += 1) {
        for (let i = 0; i < cols; i += 1) {
          const x = cols === 1 ? 0 : redondo((i * (ancho - tw)) / (cols - 1));
          const y = filas === 1 ? 0 : redondo((j * (alto - th)) / (filas - 1));
          const s = Math.min(1, Math.sqrt(MAX_PX / (tw * th)));
          recortes.push({
            id: `R-${String(recortes.length + 1).padStart(2, '0')}`,
            x: redondo(x * escala), y: redondo(y * escala), w: redondo(tw * escala), h: redondo(th * escala),
            origen: { x, y, w: tw, h: th }, salida: { w: Math.floor(tw * s), h: Math.floor(th * s) },
          });
        }
      }
    }
    return { escala, enviado, recortes };
  }

  /** Las instrucciones para leer la hoja (imagen 1) con sus recortes (imágenes 2…). */
  function promptLectura(plan) {
    const W = plan.enviado.w;
    const H = plan.enviado.h;
    const rec = plan.recortes.map((r, i) => `- Imagen ${i + 2} (${r.id}): la zona x ${r.x}–${r.x + r.w}, y ${r.y}–${r.y + r.h} de la imagen 1, a más resolución.`).join('\n');
    return `Eres el lector de croquis unifilares de un taller de ductería para colección de polvo. Tu trabajo es LEER el dibujo y transcribirlo a JSON con exactitud; no calculas piezas ni completas lo que falta (eso lo hacen reglas del taller, que además preguntan lo dudoso al ingeniero).

IMÁGENES
- Imagen 1: la hoja completa, ${W} × ${H} px. TODAS las coordenadas que escribas (pos_px, bbox_px) van en píxeles de la imagen 1, con el origen arriba a la izquierda.
${rec || '- No hay recortes: lee todo en la imagen 1.'}
${rec ? 'Usa los recortes para leer números pequeños, pero escribe las coordenadas en la imagen 1.' : ''}

CÓMO SE DIBUJA UN UNIFILAR
- Cada línea es un ducto redondo: una ARISTA entre dos NODOS. Un nodo es un extremo (llega a un equipo o queda suelto), un vértice (cambia de dirección: un codo), una derivación (se juntan tres líneas) o un punto donde, en línea recta, cambia la etiqueta de diámetro.
- Diámetros: «Ø12», «12"», «12 in», «Ø300» (mm). Van junto a su línea.
- Longitudes (cotas): «3.0 m», «L=3m», «3000» (mm), «10'» (pies). Van junto a su línea. Si una cota abarca varios tramos seguidos (una cota total), va en cotas_totales con las aristas que abarca.
- Ángulos: «45°» junto a un vértice o una derivación: se asocian a ese NODO.
- Equipos: el colector (colector, CP, DC, filtro, casa de bolsas), máquinas, campanas, ventiladores, compuertas. Un equipo está en el nodo extremo donde llega su línea. «MANG», «manguera», «flex» = se conecta por manguera.
- Notas «SUBE» o «BAJA» junto a una línea: el tramo es vertical.
- Vista: ISOMETRICO si las líneas van en tres direcciones a ~30°, ~150° y vertical en la hoja; PLANTA si es vista desde arriba; ELEVACION si es de frente.
- En isométrico, eje_iso de cada arista: X (sube hacia la derecha, ~30°), Y (sube hacia la izquierda, ~150°), Z (vertical en la hoja), NINGUNO (otra dirección).

REGLAS
1. No inventes. Si un número no se lee, transcribe el texto tal cual (por ejemplo «1.? m») con tipo ILEGIBLE y pon el valor de la medida en null.
2. No deduzcas diámetros por continuidad ni cotas por escala o por diferencia: deja null lo que no está escrito.
3. Confianza honesta de 0 a 1: 0.95 claro; 0.75 se lee pero con duda; menos de 0.5 casi ilegible.
4. Cada arista une dos nodos que existen. No dupliques nodos en el mismo punto. Una red de colección es un árbol con UN colector.
5. Asocia cada texto a la arista o nodo más cercano que describe (asociado_a); el cuadro de datos o el título (material, calibre) va con asociado_a null. Un texto que no sabes a qué pertenece también va con null.
6. Si dos aristas se cruzan sin unirse, no pongas nodo en el cruce. Si dudas a cuál de dos aristas va un texto, o si un trazo no llega a nada, agrega una alerta.

FORMATO: responde SÓLO con un objeto JSON con exactamente estas claves.
{
  "version": "1.0",
  "metadatos": {
    "vista": "PLANTA" | "ISOMETRICO" | "ELEVACION" | "MIXTA",
    "unidades_diametro": "IN" | "MM", "unidades_longitud": "M" | "MM" | "FT", "convencion_cotas": "EJES" | "NETAS",
    "material": MEDIDA (valor: texto como «GALVANIZADO» o «ACERO»; null si no dice), "calibre": MEDIDA (valor: número; null si no dice),
    "yarda_mm": 914.4
  },
  "red": {
    "nodos": [{ "id": "N-001", "tipo": "EXTREMO" | "VERTICE" | "DERIVACION" | "UNION_COLINEAL", "pos_px": { "x": n, "y": n }, "confianza": 0-1 }],
    "aristas": [{ "id": "A-001", "nodo_a": "N-001", "nodo_b": "N-002", "orientacion_pantalla": "HORIZONTAL" | "VERTICAL" | "INCLINADA", "eje_iso": "X" | "Y" | "Z" | "NINGUNO", "angulo_pantalla_deg": n, "diametro": MEDIDA, "longitud_cota": MEDIDA }],
    "textos": [{ "id": "T-001", "contenido_crudo": "Ø12\\"", "contenido_normalizado": "12" | null, "tipo": "DIAMETRO" | "LONGITUD" | "ANGULO" | "CALIBRE" | "MATERIAL" | "EQUIPO" | "NOTA" | "ILEGIBLE", "bbox_px": { "x": n, "y": n, "w": n, "h": n }, "confianza_ocr": 0-1, "asociado_a": "A-001" | "N-003" | "EQ-01" | "CT-001" | null }],
    "cotas_totales": [{ "id": "CT-001", "aristas": ["A-004", "A-005"], "longitud": MEDIDA }]
  },
  "equipos": [{ "id": "EQ-01", "tipo": "COLECTOR" | "MAQUINA" | "CAMPANA" | "COMPUERTA" | "VENTILADOR" | "OTRO", "nombre": "texto del dibujo", "nodo_id": "N-001", "conexion": "BRIDA_EQUIPO" | "BRIDA_TALLER" | "MANGUERA" | "LISO", "texto_id": "T-0xx" | null, "confianza": 0-1, "boca_diametro": MEDIDA | null }],
  "alertas_ambiguedad": [{ "codigo": "ASOCIACION_AMBIGUA" | "TRAZO_SIN_CONECTAR" | "CRUCE_SIN_NODO", "severidad": "CONFIRMAR", "referencias": ["T-009", "A-004"], "mensaje": "qué viste", "decision_tomada": "qué hiciste", "pregunta": "qué preguntarle al ingeniero" }]
}
MEDIDA = { "valor": número | texto | null, "unidad": "in" | "mm" | "m" | "ft" | null, "origen": "OCR", "confianza": 0-1, "texto_id": "T-0xx" | null }
- conexion: BRIDA_EQUIPO = el equipo trae su brida (el colector, casi siempre); BRIDA_TALLER = la brida la pone el taller (campanas); MANGUERA = por manguera (máquinas); LISO = extremo abierto.
- Numera nodos y aristas empezando por el colector y siguiendo el ducto.

Ejemplo de la forma (de otro croquis; no copies sus valores):
{"version":"1.0","metadatos":{"vista":"PLANTA","unidades_diametro":"IN","unidades_longitud":"M","convencion_cotas":"EJES","material":{"valor":"GALVANIZADO","unidad":null,"origen":"OCR","confianza":0.9,"texto_id":"T-004"},"calibre":{"valor":22,"unidad":null,"origen":"OCR","confianza":0.9,"texto_id":"T-004"},"yarda_mm":914.4},"red":{"nodos":[{"id":"N-001","tipo":"EXTREMO","pos_px":{"x":120,"y":600},"confianza":0.95},{"id":"N-002","tipo":"EXTREMO","pos_px":{"x":820,"y":600},"confianza":0.93}],"aristas":[{"id":"A-001","nodo_a":"N-001","nodo_b":"N-002","orientacion_pantalla":"HORIZONTAL","eje_iso":"NINGUNO","angulo_pantalla_deg":0,"diametro":{"valor":8,"unidad":"in","origen":"OCR","confianza":0.94,"texto_id":"T-001"},"longitud_cota":{"valor":null,"unidad":"m","origen":"OCR","confianza":0.3,"texto_id":"T-002"}}],"textos":[{"id":"T-001","contenido_crudo":"Ø8\\"","contenido_normalizado":"8","tipo":"DIAMETRO","bbox_px":{"x":430,"y":560,"w":60,"h":30},"confianza_ocr":0.94,"asociado_a":"A-001"},{"id":"T-002","contenido_crudo":"4.? m","contenido_normalizado":null,"tipo":"ILEGIBLE","bbox_px":{"x":430,"y":615,"w":70,"h":30},"confianza_ocr":0.3,"asociado_a":"A-001"},{"id":"T-003","contenido_crudo":"COLECTOR","contenido_normalizado":"COLECTOR","tipo":"EQUIPO","bbox_px":{"x":60,"y":640,"w":130,"h":30},"confianza_ocr":0.96,"asociado_a":"EQ-01"},{"id":"T-004","contenido_crudo":"GALV CAL 22","contenido_normalizado":"GALVANIZADO 22","tipo":"CALIBRE","bbox_px":{"x":40,"y":40,"w":200,"h":34},"confianza_ocr":0.9,"asociado_a":null}],"cotas_totales":[]},"equipos":[{"id":"EQ-01","tipo":"COLECTOR","nombre":"Colector","nodo_id":"N-001","conexion":"BRIDA_EQUIPO","texto_id":"T-003","confianza":0.96,"boca_diametro":null},{"id":"EQ-02","tipo":"MAQUINA","nombre":"Máquina","nodo_id":"N-002","conexion":"MANGUERA","texto_id":null,"confianza":0.8,"boca_diametro":null}],"alertas_ambiguedad":[]}

Responde sólo con el JSON de este croquis.`;
  }

  /** Completa lo que el modelo no sabe: de dónde salió la imagen, cuándo y con qué se leyó. */
  function completarLectura(json, meta) {
    const j = esObjeto(json) ? json : {};
    const md = esObjeto(j.metadatos) ? { ...j.metadatos } : {};
    md.fuente = {
      archivo: String(meta.archivo || 'croquis'), ancho_px: meta.ancho, alto_px: meta.alto, ancho_enviado_px: meta.plan.enviado.w, alto_enviado_px: meta.plan.enviado.h,
      recortes: meta.plan.recortes.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, motivo: 'más resolución' })),
    };
    md.modelo = meta.modelo || 'Claude (desde la página)';
    md.fecha = meta.fecha || new Date().toISOString();
    if (!finito(md.yarda_mm)) md.yarda_mm = 914.4;
    const red = esObjeto(j.red) ? { ...j.red } : j.red;
    if (esObjeto(red) && !Array.isArray(red.cotas_totales)) red.cotas_totales = [];
    return { ...j, version: '1.0', metadatos: md, red, equipos: Array.isArray(j.equipos) ? j.equipos : [], alertas_ambiguedad: Array.isArray(j.alertas_ambiguedad) ? j.alertas_ambiguedad : [] };
  }

  /**
   * Los textos que conviene volver a leer en un recorte ampliado: diámetros, cotas, ángulos y calibres con confianza menor
   * que 0.9, y los ilegibles que están junto a algo (una marca suelta no). Los más dudosos primero, a lo más `max`.
   * Cada uno con el recuadro que se recorta (en píxeles de la imagen enviada): el texto con margen, al menos 120 px.
   */
  function dudosos(lectura, max, enviado) {
    const W = enviado ? enviado.w : Infinity;
    const H = enviado ? enviado.h : Infinity;
    return lectura.red.textos
      .filter((t) => RELEER.includes(t.tipo) && t.confianza_ocr < CONF_SEGURA && t.bbox_px.w > 0 && t.bbox_px.h > 0 && (t.tipo !== 'ILEGIBLE' || t.asociado_a))
      .sort((a, b) => a.confianza_ocr - b.confianza_ocr)
      .slice(0, Math.max(0, max))
      .map((t) => {
        const b = t.bbox_px;
        const lado = Math.max(120, Math.max(b.w, b.h) * 2.5);
        const w = Math.min(W, Math.max(b.w * 1.6, lado));
        const h = Math.min(H, Math.max(b.h * 1.6, lado * 0.6));
        const x = Math.max(0, Math.min(W - w, b.x + b.w / 2 - w / 2));
        const y = Math.max(0, Math.min(H - h, b.y + b.h / 2 - h / 2));
        return { texto_id: t.id, tipo: t.tipo, contenido_crudo: t.contenido_crudo, confianza_ocr: t.confianza_ocr, asociado_a: t.asociado_a, recorte: { x: redondo(x), y: redondo(y), w: redondo(w), h: redondo(h) } };
      });
  }

  /** Las instrucciones para releer los recortes ampliados (una imagen por texto, en orden). */
  function promptRelectura(items) {
    const lista = items.map((it, i) => `${i + 1}) ${it.texto_id}: se leyó «${it.contenido_crudo}» como ${it.tipo} con confianza ${it.confianza_ocr}${it.asociado_a ? `, junto a ${it.asociado_a}` : ''}.`).join('\n');
    return `Estos son recortes ampliados de un croquis unifilar de ductería, uno por texto que se leyó con duda, en este orden:
${lista}

En cada recorte, lee el texto que está al CENTRO (cerca puede haber otros textos o líneas del dibujo). Diámetros: «Ø12», «12"»; cotas: «3.0 m», «3000»; ángulos: «45°».
No adivines: si sigue sin leerse, transcribe lo que veas (con «?» donde no se lee), contenido_normalizado null, tipo ILEGIBLE y confianza menor que 0.5.

Responde SÓLO con un arreglo JSON, un objeto por recorte y en el mismo orden:
[{ "texto_id": "${items[0] ? items[0].texto_id : 'T-001'}", "contenido_crudo": "lo que dice", "contenido_normalizado": "el número solo, como «1.3», o null", "tipo": "DIAMETRO" | "LONGITUD" | "ANGULO" | "CALIBRE" | "ILEGIBLE", "confianza_ocr": 0-1 }]`;
  }

  /**
   * Aplica lo releído: un texto sólo cambia si la nueva lectura es más segura, y con él la medida que lo cita (o, si era
   * ilegible, la cota o el diámetro vacíos de la arista a la que está asociado). No muta: devuelve { lectura, cambios }.
   */
  function aplicarRelectura(lectura0, resultados) {
    const L = JSON.parse(JSON.stringify(lectura0));
    const cambios = [];
    if (!Array.isArray(resultados)) return { lectura: L, cambios };
    const textos = new Map(L.red.textos.map((t) => [t.id, t]));
    resultados.filter(esObjeto).forEach((r) => {
      const t = textos.get(r.texto_id);
      const conf = finito(r.confianza_ocr) ? Math.max(0, Math.min(1, r.confianza_ocr)) : 0;
      if (!t || conf <= t.confianza_ocr) return;
      const antes = `«${t.contenido_crudo}» (${t.confianza_ocr})`;
      const tipo = TIPOS_TEXTO.includes(r.tipo) ? r.tipo : t.tipo;
      t.contenido_crudo = typeof r.contenido_crudo === 'string' ? r.contenido_crudo.slice(0, 200) : t.contenido_crudo;
      t.contenido_normalizado = typeof r.contenido_normalizado === 'string' || finito(r.contenido_normalizado) ? String(r.contenido_normalizado).slice(0, 200) : null;
      t.tipo = tipo;
      t.confianza_ocr = conf;
      const num = parseFloat(t.contenido_normalizado);
      const valor = finito(num) && num > 0 ? num : null;
      const nueva = (m, unidad) => ({ valor, unidad: (m && m.unidad) || unidad, origen: 'OCR', confianza: valor === null ? Math.min(conf, 0.4) : conf, texto_id: t.id });
      // la medida que cita el texto, o la vacía de la arista a la que está asociado
      L.red.aristas.forEach((a) => {
        const cita = (campo) => a[campo] && a[campo].texto_id === t.id;
        const vacia = (campo) => a.id === t.asociado_a && a[campo] && a[campo].valor === null;
        if (tipo === 'DIAMETRO' && (cita('diametro') || vacia('diametro'))) a.diametro = nueva(a.diametro, 'in');
        else if (tipo === 'LONGITUD' && (cita('longitud_cota') || vacia('longitud_cota'))) a.longitud_cota = nueva(a.longitud_cota, 'm');
        else if (tipo === 'ILEGIBLE') {
          if (cita('diametro')) a.diametro = nueva(a.diametro, 'in');
          if (cita('longitud_cota')) a.longitud_cota = nueva(a.longitud_cota, 'm');
        }
      });
      (L.red.cotas_totales || []).forEach((c) => { if (c.longitud && c.longitud.texto_id === t.id) c.longitud = nueva(c.longitud, 'm'); });
      (L.equipos || []).forEach((e) => { if (e.boca_diametro && e.boca_diametro.texto_id === t.id) e.boca_diametro = nueva(e.boca_diametro, 'in'); });
      if (L.metadatos.calibre && L.metadatos.calibre.texto_id === t.id && tipo === 'CALIBRE') {
        const cal = parseInt(String(t.contenido_normalizado || '').replace(/\D+/g, ' ').trim().split(' ').pop(), 10);
        if (finito(cal)) L.metadatos.calibre = { ...L.metadatos.calibre, valor: cal, confianza: conf };
      }
      cambios.push(`${t.id}: ${antes} → «${t.contenido_crudo}» (${conf})`);
    });
    return { lectura: L, cambios };
  }

  return { planDeImagen, promptLectura, completarLectura, dudosos, promptRelectura, aplicarRelectura, MAX_PX };
}));
