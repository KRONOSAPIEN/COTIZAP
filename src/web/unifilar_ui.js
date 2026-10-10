/**
 * COTIZAP · web/unifilar_ui.js — «Importar unifilar» en la cotización detallada (docs/vision-unifilares.md §10).
 *
 * Recibe la lectura de un croquis unifilar: la FOTO, que lee Claude desde la página publicada (capacidad `sample`, con la
 * cuenta de quien la usa; motor/unifilar_vision.js arma las imágenes y las instrucciones y vuelve a leer en recortes
 * ampliados lo dudoso), o el JSON de la lectura (o de un despiece completo). Corre las reglas del taller (motor/unifilar.js)
 * y muestra el resumen, las preguntas, el dibujo de la lectura sobre la foto y las piezas. Las partidas se agregan a la
 * cotización con el identificador de su pieza (`unifilar_id`); cada respuesta del ingeniero vuelve a correr las reglas y, si
 * las partidas ya están en la cotización, las reemplaza.
 *
 * La lectura también puede salir del DIBUJO (web/unifilar_cad_ui.js): la ductería armada con trazos en el tablero, que al dar
 * «Listo» pasa por las mismas reglas y preguntas; o del TRAZADO ISOMÉTRICO (motor/trazado_lectura.js), con «Pasar a la
 * cotización» en su salida.
 *
 * Lo importado vive en la cotización: estado.cot.unifilar = { lectura, respuestas, importado }; el dibujo, en
 * estado.cot.dibujo_unifilar. La foto no se guarda: sólo dura mientras la página está abierta.
 * Depende de app.js (W.estadoApp, W.recalcular, W.toast, W.tituloPartida, W.idNuevo, W.copiarTexto).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const $ = (s, r) => (r || document).querySelector(s);

  const E = () => W.estadoApp;
  const UF = () => C.unifilar;
  const V = () => C.unifilarVision;
  const IMG = () => C.imagen;
  const CAD = () => C.unifilarCad;
  const TL = () => C.trazadoLectura;
  const deTrazado = (lect) => !!(TL() && TL().esDeTrazado(lect));
  /** De dónde salió la lectura, para decirlo: del trazado, del dibujo o de un croquis. */
  const origen = (lect) => (deTrazado(lect) ? 'del trazado isométrico' : CAD().esDeDibujo(lect) ? 'del dibujo unifilar' : 'de un croquis unifilar');
  const MAX_TRABAJO = 3000; // lado mayor con que se prepara la foto (los recortes que se mandan no piden más)
  const MAX_TEXTO = 5e6; // caracteres: una lectura real pesa decenas de kB
  const NS = 'http://www.w3.org/2000/svg';
  /** Un elemento SVG con sus atributos e hijos. */
  const svg = (tag, attrs, ...hijos) => {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    hijos.forEach((c) => el.append(c && c.nodeType ? c : document.createTextNode(String(c))));
    return el;
  };


  const SEVERIDAD = { BLOQUEANTE: 'Bloquea', CONFIRMAR: 'Por confirmar', ADVERTENCIA: 'Aviso', INFO: 'Nota' };
  const CODIGO = {
    COTA_ILEGIBLE: 'Cota ilegible', COTA_FALTANTE: 'Cota faltante', DIAMETRO_FALTANTE: 'Diámetro faltante', DIAMETRO_INFERIDO: 'Diámetro heredado',
    DIAMETRO_INCONSISTENTE: 'Diámetro dudoso', ANGULO_INFERIDO: 'Ángulo del codo', ANGULO_NO_PERMITIDO: 'Ángulo del codo', ANGULO_DERIVACION_NO_PERMITIDO: 'Ángulo del injerto',
    DERIVACION_CONTRA_FLUJO: 'Contra el flujo', ORIENTACION_AMBIGUA: 'Orientación', TRANSICION_INSERTADA: 'Reducción insertada', ACCESORIOS_ENCIMADOS: 'Accesorios encimados', VERIFICACION_VISUAL: 'Revisión visual',
    CONEXION_EQUIPO: 'Boca del equipo', MANGUERA_SIN_LARGO: 'Manguera', CALIBRE_BAJO_TABLA: 'Calibre', CALIBRE_FALTANTE: 'Calibre', MATERIAL_FALTANTE: 'Material',
    TEXTO_SIN_ASOCIAR: 'Texto suelto', ASOCIACION_AMBIGUA: 'Texto ambiguo', TRAZO_SIN_CONECTAR: 'Trazo suelto', CRUCE_SIN_NODO: 'Cruce', CICLO_EN_RED: 'Ciclo en la red',
    PANTALON_RETIRADO: 'Pantalón', SIN_COLECTOR: 'Colector', LECTURA_DUDOSA: 'Lectura dudosa', COTAS_NO_CUADRAN: 'Cotas que no cuadran', REDUCCION_GRANDE: 'Reducción grande',
  };
  const ESTADO = {
    DEFINITIVA: ['Definitiva', 'Todo está leído o respondido: el despiece sirve para el pedido.'],
    PRELIMINAR: ['Preliminar', 'Se cotiza con las decisiones propuestas: sirve como precio estimado. Responda las preguntas para que sea definitiva.'],
    NO_COTIZABLE: ['No cotizable', 'Falta un dato sin el cual alguna pieza no existe: responda las preguntas que bloquean para poder agregar las partidas.'],
  };
  const SUFIJO = { m: 'm', in: '″', deg: '°', tramos: 'tramos' };

  /** Una lectura nueva que reemplazaría a la ya importada: vive sólo en el diálogo hasta que se aplica. */
  let borrador = null;
  let vista = 'revision';
  let errores = [];
  let nota = '';
  let textoCarga = ''; // lo pegado en «pegar o cargar»: se conserva al volver a pintar
  /** Pedirle a Claude que lea la foto: sólo en la página publicada en claude.ai, si la vista puede mandar imágenes. */
  let sample = null;
  let limites = null;
  let lectura = { activa: false };
  /** La última foto leída (sólo en memoria): para dibujar la lectura encima. */
  let foto = null;
  let notaLectura = '';
  /** La foto escogida, antes de leerla: enderezar (cuatro esquinas) y limpiar. */
  let prep = null;
  let verif = { activa: false };
  let avisosAbiertos = false; // tras una verificación visual con hallazgos, «Avisos» se muestra abierto
  let vistaPrevia = 'carga'; // a dónde regresa «Volver» desde el dibujo

  const guardada = () => E().cot.unifilar || null;
  const fuente = () => borrador || guardada();

  let memo = { clave: null, bom: null };
  /** El despiece de la lectura con sus respuestas (memorizado: la lista se pinta a cada tecla del encabezado). */
  function despiece(f) {
    const x = f || fuente();
    if (!x) return null;
    const clave = JSON.stringify(x.respuestas);
    if (memo.lectura === x.lectura && memo.M === E().M && memo.clave === clave) return memo.bom;
    let bom;
    try { bom = UF().despiezar(x.lectura, E().M, x.respuestas); } catch (err) { bom = null; }
    memo = { lectura: x.lectura, M: E().M, clave, bom };
    return bom;
  }

  const importadas = () => E().cot.partidas.filter((p) => p.unifilar_id);
  const editadas = () => importadas().filter((p) => p.unifilar_editada);

  /** Las partidas del despiece; la que ya estaba (misma pieza) conserva su id para seguir seleccionada. */
  function partidasDe(bom) {
    const previas = new Map(importadas().map((p) => [p.unifilar_id, p.id]));
    return UF().aPartidas(bom).map((p) => ({ id: previas.get(p.unifilar_id) || W.idNuevo(), ...p }));
  }

  /** Pone las partidas del despiece donde estaban las importadas (o al final) y quita las anteriores. */
  function aplicar(bom) {
    const cot = E().cot;
    const nuevas = partidasDe(bom);
    const i0 = cot.partidas.findIndex((p) => p.unifilar_id);
    const resto = cot.partidas.filter((p) => !p.unifilar_id);
    const pos = i0 < 0 ? resto.length : cot.partidas.slice(0, i0).filter((p) => !p.unifilar_id).length;
    cot.partidas = [...resto.slice(0, pos), ...nuevas, ...resto.slice(pos)];
    cot.ejemplo = false;
    return nuevas.length;
  }

  /* ------------------------------------------------------------------ aviso en la cotización */

  function render() {
    const el = $('#aviso-unifilar');
    if (!el) return;
    const u = guardada();
    const bom = u ? despiece(u) : null;
    el.hidden = !u;
    if (!u) return;
    const pend = bom ? UF().pendientes(bom).length : 0;
    const estado = bom ? bom.resumen.estado : 'NO_COTIZABLE';
    el.className = `aviso ${estado === 'DEFINITIVA' && u.importado ? 'aviso-info' : 'aviso-ejemplo'}`;
    $('.aviso-icono', el).textContent = pend || !u.importado ? '?' : 'i';
    const n = importadas().length;
    $('.aviso-txt', el).replaceChildren(...(u.importado
      ? [h('strong', null, `${n} ${n === 1 ? 'partida' : 'partidas'} ${origen(u.lectura)} · ${ESTADO[estado][0].toLowerCase()}.`), ' ',
        pend ? `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} por responder.` : 'Todas las preguntas están respondidas.']
      : [h('strong', null, 'Hay una lectura de unifilar sin agregar a la cotización.'), ' ', pend ? `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} por responder.` : '']));
  }

  /* ------------------------------------------------------------------ diálogo */

  function abrir(modo) {
    borrador = null;
    errores = [];
    nota = '';
    if (guardada() && deTrazado(guardada().lectura)) notaLectura = ''; // los avisos del paso del trazo los dice su salida
    vista = guardada() ? 'revision' : 'carga';
    if (modo === 'dibujo') abrirDibujo();
    else pintar();
    const d = $('#dlg-unifilar');
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    const foco = vista === 'cad' ? $('#cad-tablero') : vista === 'carga' ? $('#uf-texto') : $('.uf-preguntas [data-clave]') || $('#uf-cerrar');
    if (foco) foco.focus();
  }

  /**
   * El dibujo: abre el tablero con el dibujo guardado en la cotización (o uno nuevo). Si la lectura actual salió del dibujo,
   * lo que se respondió al revisarla (material, bocas, mangueras…) pasa al dibujo.
   */
  function abrirDibujo() {
    const f = fuente();
    const respuestas = f && CAD().esDeDibujo(f.lectura) ? f.respuestas : null;
    vistaPrevia = vista === 'cad' ? vistaPrevia : vista;
    W.unifilarCadUI.abrir({
      listo: (lect, resp) => aceptarLectura(lect, resp, true),
      volver: () => { vista = vistaPrevia === 'revision' && fuente() ? 'revision' : 'carga'; pintar(); },
    }, respuestas);
    vista = 'cad';
    errores = [];
    pintar();
    const t = $('#cad-tablero');
    if (t) t.focus({ preventScroll: true });
  }
  function cerrar() {
    const d = $('#dlg-unifilar');
    borrador = null;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function pintar(enfocar) {
    const cuerpo = $('#uf-cuerpo');
    const pie = $('#uf-pie');
    const enDibujo = vista === 'cad';
    $('#dlg-unifilar').classList.toggle('uf-dlg-cad', enDibujo);
    cuerpo.classList.toggle('uf-cuerpo-cad', enDibujo);
    const f = fuente();
    $('#uf-titulo').textContent = enDibujo ? 'Dibujar el unifilar' : vista === 'revision' && f && CAD().esDeDibujo(f.lectura) ? 'Despiece del dibujo'
      : vista === 'revision' && f && deTrazado(f.lectura) ? 'Despiece del trazado' : 'Importar unifilar';
    if (enDibujo) { W.unifilarCadUI.pintar(cuerpo, pie); return; }
    if (vista === 'carga') pintarCarga(cuerpo, pie);
    else if (vista === 'foto' && prep) pintarFoto(cuerpo, pie);
    else pintarRevision(cuerpo, pie);
    if (enfocar !== undefined) {
      // la misma pregunta si sigue a la vista (una ya respondida pasa al grupo cerrado), si no la primera pendiente
      const visible = (el) => el && !el.closest('details:not([open])');
      const misma = Array.from(cuerpo.querySelectorAll('[data-clave]')).find((el) => el.dataset.clave === enfocar && visible(el));
      const el = misma || $('.uf-preguntas [data-clave]', cuerpo) || $('#uf-agregar, #uf-listo', pie);
      if (el) el.focus();
    }
  }

  function bloqueFoto() {
    if (!sample) {
      return h('p', { class: 'uf-ayuda uf-sin-foto' }, 'Para que Claude lea la foto del croquis, abra COTIZAP publicada en claude.ai: ahí la lee con su cuenta. Aquí puede pegar la lectura en JSON.');
    }
    const entrada = h('input', { id: 'uf-foto', type: 'file', accept: limites.images.mediaTypes.join(',') });
    entrada.addEventListener('change', (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) elegirFoto(f); });
    return h('section', { class: 'uf-foto', 'aria-labelledby': 'uf-tit-foto' },
      h('h3', { id: 'uf-tit-foto' }, 'Leer la foto del croquis'),
      h('p', { class: 'uf-ayuda' }, 'Primero puede enderezar la hoja y limpiarla de sombras y cuadrícula. Claude la lee con su cuenta de claude.ai (la primera vez pide permiso) y tarda de 1 a 3 minutos; ',
        'luego vuelve a leer en recortes ampliados lo que quedó dudoso. Lo que lea pasa por las mismas reglas y preguntas.'),
      lectura.activa
        ? h('div', { class: 'uf-progreso', role: 'status' },
          h('span', { class: 'uf-girando', 'aria-hidden': 'true' }),
          h('span', { id: 'uf-progreso-txt' }, lectura.fase),
          h('span', { class: 'uf-progreso-det', id: 'uf-progreso-det' }, lectura.detalle || ''),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-detener', onclick: () => { if (lectura.ctl) lectura.ctl.abort(); } }, 'Detener'))
        : h('label', { class: 'btn btn-primario archivo' }, 'Escoger la foto', entrada));
  }

  function pintarCarga(cuerpo, pie) {
    const area = h('textarea', { id: 'uf-texto', rows: '12', spellcheck: 'false', 'aria-label': 'Lectura del unifilar en JSON', placeholder: '{ "version": "1.0", "metadatos": { … }, "red": { "nodos": […], "aristas": […], "textos": […] }, "equipos": […] }' });
    area.value = textoCarga;
    area.addEventListener('input', () => { textoCarga = area.value; });
    const archivo = h('input', { id: 'uf-archivo', type: 'file', accept: '.json,application/json' });
    archivo.addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      if (f.size > MAX_TEXTO) { errores = ['El archivo es demasiado grande para ser una lectura de unifilar.']; pintar(); return; }
      const lector = new FileReader();
      lector.onload = () => { $('#uf-texto').value = String(lector.result); leerTexto(String(lector.result)); };
      lector.readAsText(f);
    });
    const dib = W.unifilarCadUI && W.unifilarCadUI.hayDibujo() ? CAD().validar(E().cot.dibujo_unifilar, E().M).modelo : null;
    W.reemplazar(cuerpo,
      errores.length ? h('div', { class: 'uf-errores', role: 'alert' }, h('strong', null, 'No se pudo leer:'), h('ul', null, errores.map((e) => h('li', null, e)))) : null,
      h('section', { class: 'uf-dibujar', 'aria-labelledby': 'uf-tit-dibujar' },
        h('h3', { id: 'uf-tit-dibujar' }, 'Dibujar el unifilar'),
        h('p', { class: 'uf-ayuda' }, 'Arme la ductería con trazos desde el colector: tramos rectos, codos, subidas y bajadas, injertos, reducciones y los equipos del final de cada ramal. ',
          'El tablero sólo deja hacer lo que fabrica el taller y cuenta las piezas mientras dibuja; al dar «Listo» pasan por las mismas reglas y preguntas.'),
        h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-dibujar', disabled: lectura.activa, onclick: abrirDibujo },
          dib && dib.tramos.length ? `Seguir el dibujo (${dib.tramos.length} ${dib.tramos.length === 1 ? 'tramo' : 'tramos'})` : 'Dibujar el unifilar')),
      bloqueFoto(),
      h('section', { class: 'uf-json', 'aria-labelledby': 'uf-tit-json' },
        h('h3', { id: 'uf-tit-json' }, 'O pegar la lectura en JSON'),
        h('p', { class: 'uf-ayuda' }, 'La que entrega la etapa de visión (docs/vision-unifilares.md) o un despiece completo, pegada o de un archivo. ',
          'Las reglas del taller sacan los tramos, los accesorios, las uniones y los soportes; lo que el croquis no dice, lo pregunta.'),
        area,
        h('div', { class: 'io-acc' },
          h('button', { type: 'button', class: lectura.activa || sample ? 'btn btn-sec' : 'btn btn-primario', id: 'uf-leer', disabled: lectura.activa, onclick: () => leerTexto($('#uf-texto').value) }, 'Leer el unifilar'),
          h('label', { class: 'btn btn-sec archivo' }, 'Cargar archivo', archivo),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-ejemplo', disabled: lectura.activa, onclick: probarEjemplo }, 'Probar con el ejemplo'))));
    W.reemplazar(pie,
      guardada() ? h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-volver', onclick: () => { vista = 'revision'; errores = []; pintar(); } }, 'Volver a la lectura actual') : null,
      h('button', { type: 'button', class: 'btn btn-sec', onclick: cerrar }, 'Cancelar'));
  }

  function probarEjemplo() {
    const texto = JSON.stringify(C.unifilarEjemplo, null, 2);
    $('#uf-texto').value = texto;
    leerTexto(texto);
  }

  function leerTexto(texto) {
    textoCarga = typeof texto === 'string' ? texto : '';
    notaLectura = '';
    errores = [];
    if (!texto || !texto.trim()) errores = ['Pegue el JSON de la lectura o cargue un archivo.'];
    else if (texto.length > MAX_TEXTO) errores = ['El texto es demasiado grande para ser una lectura de unifilar.'];
    let r = null;
    if (!errores.length) {
      r = UF().leer(texto);
      errores = r.errores;
    }
    if (errores.length) { pintar(); return; }
    aceptarLectura(r.lectura);
  }

  /**
   * Una lectura ya revisada pasa a la revisión (y a la cotización si no hay partidas importadas que reemplazar). respuestas:
   * las que ya trae (las del dibujo). agregarYa: las partidas se agregan de una vez si se puede (el «Listo» del dibujo); si ya
   * hay partidas importadas, se muestran para reemplazarlas.
   */
  function aceptarLectura(lect, respuestas0, agregarYa) {
    avisosAbiertos = false;
    const respuestas = UF().respuestasValidas(respuestas0 || {});
    if (!despiece({ lectura: lect, respuestas })) { errores = ['Las reglas no pudieron despiezar esta lectura. Revise que la red esté completa.']; vista = 'carga'; pintar(); return; }
    const nueva = { lectura: lect, respuestas, importado: false };
    const g = guardada();
    nota = '';
    if (g && g.importado) {
      borrador = nueva; // no toca las partidas importadas hasta que se reemplacen
      if (agregarYa) nota = `Ya hay ${importadas().length} partidas ${origen(g.lectura)} en la cotización: revise el despiece nuevo y use «Reemplazar» para cambiarlas.`;
    } else {
      borrador = null;
      E().cot.unifilar = nueva;
      const bom = agregarYa ? despiece(nueva) : null;
      if (bom && bom.resumen.estado !== 'NO_COTIZABLE') {
        nueva.importado = true;
        const n = aplicar(bom);
        const primera = E().cot.partidas.find((p) => p.unifilar_id);
        if (primera) E().sel = primera.id;
        const pend = UF().pendientes(bom).length;
        nota = `Se agregaron ${n} partidas a la cotización.${pend ? ` Responda ${pend === 1 ? 'la pregunta' : `las ${pend} preguntas`} para afinarlas: al contestar, las partidas se actualizan solas.` : ''}`;
        W.toast(`${n} ${n === 1 ? 'partida agregada' : 'partidas agregadas'} desde ${deTrazado(lect) ? 'el trazado' : 'el dibujo'}`);
      } else if (agregarYa) nota = 'Responda lo que bloquea para poder agregar las partidas.';
      W.recalcular();
    }
    vista = 'revision';
    pintar('');
  }

  /* ------------------------------------------------------------------ la foto: Claude lee, las reglas cuentan */

  /** La foto como imagen dibujable (con su orientación) y su tamaño. */
  async function cargarImagen(file) {
    if (typeof root.createImageBitmap === 'function') {
      try {
        const b = await root.createImageBitmap(file, { imageOrientation: 'from-image' });
        return { fuente: b, w: b.width, h: b.height };
      } catch (e) { /* algunos navegadores no aceptan la opción: se usa <img> */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { fuente: img, w: img.naturalWidth, h: img.naturalHeight };
    } finally { URL.revokeObjectURL(url); }
  }

  /** Un recuadro de la foto (en sus píxeles) dibujado a w × h y convertido en JPEG. */
  function aJpeg(img, r, w, h, encima) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img.fuente, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (encima) encima(g, c.width, c.height);
    return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no({ code: 'imagen' })), 'image/jpeg', 0.9));
  }

  /** Lo que se le dice al ingeniero según cómo falló la llamada (sample rechaza con { code }). */
  function mensajeDe(e) {
    const code = e && e.code;
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'].includes(code)) {
      sample = null;
      return ['Esta vista no puede pedirle a Claude que lea la foto. Pegue la lectura en JSON.'];
    }
    return [({
      rate_limited: 'Se alcanzó el límite de uso de Claude por ahora: intente más tarde.',
      session_expired: 'Su sesión de claude.ai venció: vuelva a entrar y lea la foto otra vez.',
      image_rejected: 'Claude no aceptó la imagen (formato o tamaño): pruebe con otra foto en JPG o PNG.',
      refused: 'Claude no pudo leer este croquis. Pruebe con una foto más nítida, de frente y con buena luz.',
      empty_completion: 'Claude no pudo leer este croquis. Pruebe con una foto más nítida, de frente y con buena luz.',
      invalid_json: 'La lectura no salió en el formato esperado (quedó abajo, por si sirve). Intente de nuevo; si se repite, recorte la foto al croquis.',
      prompt_too_large: 'La lectura es demasiado grande para hacerla de una vez: recorte la foto a una parte del croquis.',
      imagen: 'No se pudo preparar la foto en este navegador.',
    })[code] || 'Se interrumpió la lectura. Intente de nuevo.'];
  }

  function avance(fase, detalle) {
    lectura.fase = fase;
    lectura.detalle = detalle || '';
    const f = $('#uf-progreso-txt');
    const d = $('#uf-progreso-det');
    if (f) f.textContent = lectura.fase;
    if (d) d.textContent = lectura.detalle;
  }

  /**
   * Claude lee la foto (la hoja completa y recortes a más resolución) y devuelve la lectura en JSON; las reglas la revisan.
   * Luego relee en recortes ampliados los textos dudosos (§7.4) y aplica lo que salga más seguro. La foto queda en memoria
   * para dibujar la lectura encima.
   */
  /** Un lienzo con la imagen a lo más de `max` px de lado mayor. */
  function lienzoDe(img, max) {
    const k = Math.min(1, max / Math.max(img.w, img.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.w * k));
    c.height = Math.max(1, Math.round(img.h * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img.fuente, 0, 0, img.w, img.h, 0, 0, c.width, c.height);
    return { fuente: c, w: c.width, h: c.height, k };
  }
  /** Una imagen { width, height, data } (motor/imagen.js) en un lienzo. */
  function aLienzo(im) {
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    c.getContext('2d').putImageData(new ImageData(im.data, im.width, im.height), 0, 0);
    return { fuente: c, w: c.width, h: c.height };
  }
  /** Endereza (si se pidió) y limpia (si se pidió) una imagen; `esc` lleva las esquinas de la foto de trabajo a ésta. */
  function procesar(img, esc) {
    if (!prep.enderezar && !prep.limpiar) return img;
    let im = img.fuente.getContext('2d').getImageData(0, 0, img.w, img.h);
    if (prep.enderezar) im = IMG().enderezar(im, prep.esquinas.map((p) => ({ x: p.x * esc, y: p.y * esc })));
    if (prep.limpiar) im = IMG().limpiar(im);
    return aLienzo(im);
  }

  /** La foto escogida: se abre a tamaño de trabajo y pasa a «Preparar la foto» (nada se manda todavía). */
  async function elegirFoto(file) {
    if (!sample || lectura.activa) return;
    errores = [];
    notaLectura = '';
    if (limites.images.mediaTypes.length && !limites.images.mediaTypes.includes(file.type)) {
      errores = [`La foto debe ser ${limites.images.mediaTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ')}.`];
      pintar();
      return;
    }
    if (file.size > limites.images.maxInputBytes) { errores = ['La foto es demasiado grande: mande una de menos resolución.']; pintar(); return; }
    lectura = { activa: true, fase: 'Abriendo la foto…', detalle: '' };
    pintar();
    try {
      const img = lienzoDe(await cargarImagen(file), MAX_TRABAJO);
      prep = { img, archivo: file.name, esquinas: IMG().esquinasIniciales(img.w, img.h), enderezar: false, limpiar: true, previa: null };
      lectura = { activa: false };
      vista = 'foto';
      pintar();
    } catch (e) {
      lectura = { activa: false };
      errores = ['No se pudo abrir la foto en este navegador.'];
      pintar();
    }
  }

  const NOMBRE_ESQ = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];

  /** «Preparar la foto»: la foto con las cuatro esquinas de la hoja (para enderezarla), limpiar, vista previa y leer. */
  function pintarFoto(cuerpo, pie) {
    const { img } = prep;
    const mostrar = prep.previa || img;
    const ancho = Math.min(mostrar.w, 1100);
    const alto = Math.round((mostrar.h * ancho) / mostrar.w);
    const lienzo = h('canvas', { width: String(ancho), height: String(alto), 'aria-hidden': 'true' });
    lienzo.getContext('2d').drawImage(mostrar.fuente, 0, 0, mostrar.w, mostrar.h, 0, 0, ancho, alto);
    const marco = h('div', { class: 'uf-prep' }, lienzo);
    if (prep.enderezar && !prep.previa) {
      const r = Math.max(img.w, img.h) / 70;
      const capa = svg('svg', { viewBox: `0 0 ${img.w} ${img.h}`, class: 'uf-prep-esq' });
      const poligono = svg('polygon', { class: 'uf-prep-hoja', points: prep.esquinas.map((p) => `${p.x},${p.y}`).join(' '), 'stroke-width': (r / 4).toFixed(1) });
      capa.append(poligono);
      const mover = (i, x, y, el) => {
        prep.esquinas[i] = { x: Math.max(0, Math.min(img.w, x)), y: Math.max(0, Math.min(img.h, y)) };
        el.setAttribute('cx', prep.esquinas[i].x);
        el.setAttribute('cy', prep.esquinas[i].y);
        poligono.setAttribute('points', prep.esquinas.map((p) => `${p.x},${p.y}`).join(' '));
      };
      prep.esquinas.forEach((p, i) => {
        const c = svg('circle', { cx: p.x, cy: p.y, r: r.toFixed(1), class: 'uf-prep-punto', tabindex: '0', role: 'slider', 'aria-label': `Esquina ${NOMBRE_ESQ[i]} de la hoja (flechas para moverla)`, 'aria-valuetext': `x ${Math.round(p.x)}, y ${Math.round(p.y)}` });
        c.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          c.setPointerCapture(ev.pointerId);
          const arrastrar = (e) => {
            const b = capa.getBoundingClientRect();
            mover(i, ((e.clientX - b.left) / b.width) * img.w, ((e.clientY - b.top) / b.height) * img.h, c);
          };
          c.addEventListener('pointermove', arrastrar);
          c.addEventListener('pointerup', () => c.removeEventListener('pointermove', arrastrar), { once: true });
        });
        c.addEventListener('keydown', (ev) => {
          const paso = (ev.shiftKey ? 0.02 : 0.005) * Math.max(img.w, img.h);
          const d = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[ev.key];
          if (!d) return;
          ev.preventDefault();
          mover(i, prep.esquinas[i].x + d[0], prep.esquinas[i].y + d[1], c);
          c.setAttribute('aria-valuetext', `x ${Math.round(prep.esquinas[i].x)}, y ${Math.round(prep.esquinas[i].y)}`);
        });
        capa.append(c);
      });
      marco.append(capa);
    }
    const casilla = (id, texto, valor, alCambiar) => {
      const el = h('input', { type: 'checkbox', id, checked: valor });
      el.addEventListener('change', () => { alCambiar(el.checked); prep.previa = null; pintar(); });
      return h('label', { class: 'check', for: id }, el, texto);
    };
    const archivo = h('input', { type: 'file', accept: limites.images.mediaTypes.join(',') });
    archivo.addEventListener('change', (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) elegirFoto(f); });
    W.reemplazar(cuerpo,
      h('section', { class: 'uf-foto uf-foto-prep', 'aria-labelledby': 'uf-tit-prep' },
        h('h3', { id: 'uf-tit-prep' }, 'Preparar la foto'),
        h('p', { class: 'uf-ayuda' }, prep.enderezar ? 'Arrastre los cuatro puntos a las esquinas de la hoja (o use las flechas del teclado): la hoja se endereza como si se hubiera fotografiado de frente.'
          : 'Si la hoja salió chueca o de lado, marque «Enderezar la hoja». «Limpiar» quita sombras y la cuadrícula clara de la libreta; el trazo queda oscuro.'),
        h('div', { class: 'uf-prep-op' },
          casilla('uf-enderezar', 'Enderezar la hoja', prep.enderezar, (v) => { prep.enderezar = v; }),
          casilla('uf-limpiar', 'Limpiar sombras y cuadrícula', prep.limpiar, (v) => { prep.limpiar = v; }),
          prep.enderezar || prep.limpiar
            ? h('button', { type: 'button', class: 'btn-texto', id: 'uf-previa', onclick: () => {
              if (prep.previa) prep.previa = null;
              else { const chica = lienzoDe(prep.img, 1100); prep.previa = procesar(chica, chica.k); }
              pintar();
            } }, prep.previa ? 'Ver la foto original' : 'Ver cómo queda')
            : null),
        marco,
        h('p', { class: 'uf-ayuda' }, `${prep.archivo} · ${img.w} × ${img.h} px de trabajo.`)));
    W.reemplazar(pie,
      h('label', { class: 'btn btn-sec archivo' }, 'Otra foto', archivo),
      h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-prep-cancelar', onclick: () => { prep = null; vista = 'carga'; pintar(); } }, 'Cancelar'),
      h('span', { class: 'uf-pie-esp' }),
      h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-leer-foto', onclick: leerPreparada }, 'Leer con Claude'));
  }

  /** Prepara la foto a tamaño de trabajo (enderezar, limpiar) y la manda a leer. */
  async function leerPreparada() {
    if (!sample || lectura.activa || !prep) return;
    const ctl = new AbortController();
    lectura = { activa: true, fase: 'Preparando la foto…', detalle: '', ctl };
    vista = 'carga';
    pintar();
    await new Promise((ok) => setTimeout(ok, 30)); // que se vea el aviso antes del cálculo
    let img;
    try { img = procesar(prep.img, 1); } catch (e) {
      lectura = { activa: false };
      errores = [String((e && e.message) || 'No se pudo preparar la foto.')];
      vista = 'foto';
      pintar();
      return;
    }
    await leerImagen(img, prep.archivo, ctl);
  }

  /** Un recorte ampliado; en una asociación dudosa lleva marcadas las dos líneas («1» magenta, «2» verde) y el texto. */
  function recorteMarcado(img, it, plan) {
    const o = { x: it.recorte.x / plan.escala, y: it.recorte.y / plan.escala, w: it.recorte.w / plan.escala, h: it.recorte.h / plan.escala };
    const k = Math.min(3, 768 / Math.max(o.w, o.h));
    if (it.clase !== 'ASOCIACION') return aJpeg(img, o, o.w * k, o.h * k);
    const f = k / plan.escala; // de la hoja enviada al recorte
    const P = (p) => ({ x: (p.x - it.recorte.x) * f, y: (p.y - it.recorte.y) * f });
    return aJpeg(img, o, o.w * k, o.h * k, (g, W2, H2) => {
      const colores = ['#d6249f', '#12a150'];
      it.trazos.forEach((t, i) => {
        const a = P(t.de);
        const b = P(t.a);
        g.strokeStyle = colores[i];
        g.globalAlpha = 0.55;
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.globalAlpha = 1;
        // la etiqueta, en el punto de la línea más cercano al centro del recorte
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const u = Math.max(0.05, Math.min(0.95, ((W2 / 2 - a.x) * dx + (H2 / 2 - a.y) * dy) / ((dx * dx + dy * dy) || 1)));
        const x = Math.max(14, Math.min(W2 - 14, a.x + u * dx + 16));
        const y = Math.max(20, Math.min(H2 - 6, a.y + u * dy - 10));
        g.font = 'bold 26px sans-serif';
        g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.strokeText(t.etiqueta, x, y);
        g.fillStyle = colores[i]; g.fillText(t.etiqueta, x, y);
      });
      const c = P(it.caja);
      g.strokeStyle = '#1f6feb';
      g.lineWidth = 3;
      g.strokeRect(c.x - 6, c.y - 6, it.caja.w * f + 12, it.caja.h * f + 12);
    });
  }

  /**
   * Claude lee la foto (la hoja completa y recortes a más resolución) y devuelve la lectura en JSON; las reglas la revisan.
   * Luego relee en recortes ampliados los textos dudosos, los textos que pueden ser de dos líneas y los cruces (§7.4), y
   * aplica lo que salga más seguro. La foto queda en memoria para dibujar la lectura encima.
   */
  async function leerImagen(img, archivo, ctl) {
    try {
      const plan = V().planDeImagen(img.w, img.h, limites.images.maxCount);
      const hoja = await aJpeg(img, { x: 0, y: 0, w: img.w, h: img.h }, plan.enviado.w, plan.enviado.h);
      const recortes = await Promise.all(plan.recortes.map((r) => aJpeg(img, r.origen, r.salida.w, r.salida.h)));
      avance('Claude está leyendo el croquis (de 1 a 3 minutos)…');
      const json = await sample.json(V().promptLectura(plan), {
        images: [hoja, ...recortes], modelTier: 'complex', signal: ctl.signal,
        onText: ({ text }) => avance(lectura.fase, `${text.length.toLocaleString('es-MX')} caracteres escritos`),
      });
      const completa = V().completarLectura(json, { archivo, ancho: img.w, alto: img.h, plan });
      let r = UF().leer(completa);
      if (r.errores.length) {
        textoCarga = JSON.stringify(completa, null, 2);
        throw { code: 'lectura_invalida', errores: r.errores };
      }
      // re-lectura dirigida: asociaciones dudosas, cruces y textos dudosos, en recortes ampliados (una sola llamada)
      const max = Math.min(8, limites.images.maxCount);
      const amb = V().ambiguas(r.lectura, max, plan.enviado);
      const items = [...amb, ...V().dudosos(r.lectura, max - amb.length, plan.enviado)];
      let cambios = [];
      if (items.length) {
        avance(`Releyendo ${items.length} ${items.length === 1 ? 'duda' : 'dudas'} de la lectura en recortes ampliados…`);
        try {
          const ampliados = await Promise.all(items.map((it) => recorteMarcado(img, it, plan)));
          const releido = await sample.json(V().promptRelectura(items), { images: ampliados, modelTier: 'default', signal: ctl.signal });
          const ap = V().aplicarRelectura(r.lectura, releido, items);
          const r2 = UF().leer(ap.lectura);
          if (!r2.errores.length) { r = r2; cambios = ap.cambios; }
        } catch (e) {
          if (e && e.code === 'cancelled') throw e;
          cambios = null; // la primera lectura se queda tal cual
        }
      }
      foto = { fuente: img.fuente, ancho: img.w, alto: img.h, w: plan.enviado.w, h: plan.enviado.h, lectura: r.lectura };
      prep = null;
      notaLectura = cambios === null ? 'No se pudieron releer las dudas: se usa la primera lectura (las reglas preguntan lo dudoso).'
        : cambios.length ? `Se releyeron en recortes ampliados: ${cambios.join(' · ')}.` : '';
      lectura = { activa: false };
      textoCarga = JSON.stringify(r.lectura, null, 2);
      aceptarLectura(r.lectura);
    } catch (e) {
      lectura = { activa: false };
      if (e && e.code === 'invalid_json' && typeof e.text === 'string') textoCarga = e.text;
      errores = e && e.code === 'cancelled' ? [] : e && e.code === 'lectura_invalida'
        ? ['La lectura de Claude no está completa; quedó abajo para corregirla a mano:', ...e.errores] : mensajeDe(e);
      vista = 'carga';
      pintar();
    }
  }

  /* ------------------------------------------------------------------ dibujo de la lectura */

  /** La red leída (aristas con su Ø y su cota, nodos y equipos) sobre la foto, o sola si no hay foto; lo que se pregunta, resaltado. */
  function dibujo(bom, preguntas) {
    const red = bom.red;
    if (!red.nodos.length) return null;
    const N = new Map(red.nodos.map((n) => [n.id, n]));
    const conFoto = foto && foto.lectura === fuente().lectura;
    let vb;
    if (conFoto) vb = [0, 0, foto.w, foto.h];
    else {
      const xs = red.nodos.map((n) => n.pos_px.x);
      const ys = red.nodos.map((n) => n.pos_px.y);
      const ancho = Math.max(1, Math.max(...xs) - Math.min(...xs));
      const alto = Math.max(1, Math.max(...ys) - Math.min(...ys));
      const m = 0.12 * Math.max(ancho, alto);
      vb = [Math.min(...xs) - m, Math.min(...ys) - m, ancho + 2 * m, alto + 2 * m];
    }
    const k = Math.max(vb[2], vb[3]) / 75;
    const duda = new Set(preguntas.flatMap((a) => a.referencias));
    const lienzo = svg('svg', { viewBox: vb.map((x) => Math.round(x)).join(' '), role: 'img', 'aria-label': 'La red leída: aristas con su diámetro y su cota, nodos y equipos' });
    red.aristas.forEach((a) => {
      const p = N.get(a.nodo_a).pos_px;
      const q = N.get(a.nodo_b).pos_px;
      lienzo.append(svg('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: `uf-d-arista${duda.has(a.id) ? ' uf-d-duda' : ''}`, 'stroke-width': (k * 0.35).toFixed(1) }));
    });
    red.aristas.forEach((a) => {
      const p = N.get(a.nodo_a).pos_px;
      const q = N.get(a.nodo_b).pos_px;
      const d = a.diametro.valor ? `${a.diametro.valor}″` : 'Ø?';
      const l = a.longitud_cota.valor ? `${Number(a.longitud_cota.valor.toFixed(3))} m` : '¿m?';
      lienzo.append(svg('text', { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - k * 0.5, 'font-size': k.toFixed(1), 'text-anchor': 'middle', class: `uf-d-txt${duda.has(a.id) ? ' uf-d-txt-duda' : ''}` }, `${a.id} · ${d} · ${l}`));
    });
    red.nodos.forEach((n) => {
      lienzo.append(svg('circle', { cx: n.pos_px.x, cy: n.pos_px.y, r: (k * 0.45).toFixed(1), class: `uf-d-nodo${duda.has(n.id) ? ' uf-d-duda' : ''}` }));
      const eq = n.equipo_id ? bom.equipos.find((e) => e.id === n.equipo_id) : null;
      lienzo.append(svg('text', { x: n.pos_px.x + k * 0.7, y: n.pos_px.y + k * 1.4, 'font-size': (k * 0.85).toFixed(1), class: 'uf-d-txt uf-d-nodo-txt' }, eq ? `${n.id} · ${eq.nombre}` : n.id));
    });
    const marco = h('div', { class: `uf-dibujo${conFoto ? ' uf-dibujo-foto' : ''}` });
    if (conFoto) {
      const c = h('canvas', { width: String(foto.w), height: String(foto.h), 'aria-hidden': 'true' });
      try { c.getContext('2d').drawImage(foto.fuente, 0, 0, foto.ancho, foto.alto, 0, 0, foto.w, foto.h); } catch (e) { /* sin foto, sólo la red */ }
      marco.append(c);
    }
    marco.append(lienzo);
    const revisar = conFoto && sample
      ? h('div', { class: 'uf-progreso' }, verif.activa
        ? [h('span', { class: 'uf-girando', 'aria-hidden': 'true' }), h('span', { role: 'status' }, 'Claude está comparando la lectura con la foto…'),
          h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-verificar-detener', onclick: () => verif.ctl && verif.ctl.abort() }, 'Detener')]
        : [h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-verificar', onclick: verificar }, 'Pedir a Claude que compare la lectura con la foto')])
      : null;
    return h('details', { class: 'uf-grupo uf-g-dibujo', open: conFoto },
      h('summary', null, conFoto ? 'La lectura sobre la foto' : 'Dibujo de la lectura'),
      h('p', { class: 'uf-ayuda' }, conFoto ? 'Revise que cada línea, diámetro y cota coincidan con el croquis; en color de aviso, lo que se pregunta.'
        : deTrazado(bom) ? 'La red del trazo en isométrico (cotas a ejes); en color de aviso, lo que se pregunta.' : 'La red tal como se leyó (sin la foto); en color de aviso, lo que se pregunta.'),
      revisar,
      marco);
  }

  /** Cambia la lectura (con sus respuestas) por otra: la de la verificación visual, que sólo agrega avisos. */
  function reemplazarLectura(nueva) {
    const f = fuente();
    f.lectura = nueva;
    if (foto) foto.lectura = nueva;
    if (f === guardada()) W.recalcular();
  }

  /** La foto con la lectura dibujada encima (para la verificación visual), en JPEG. */
  function fotoConLectura(lect) {
    const N = new Map(lect.red.nodos.map((n) => [n.id, n.pos_px]));
    return aJpeg({ fuente: foto.fuente, w: foto.ancho, h: foto.alto }, { x: 0, y: 0, w: foto.ancho, h: foto.alto }, foto.w, foto.h, (g, w2) => {
      const k = w2 / 75;
      g.strokeStyle = 'rgba(36, 86, 181, 0.85)';
      g.lineWidth = Math.max(2, k * 0.3);
      lect.red.aristas.forEach((a) => { const p = N.get(a.nodo_a); const q = N.get(a.nodo_b); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); });
      g.fillStyle = 'rgba(36, 86, 181, 0.95)';
      N.forEach((p) => { g.beginPath(); g.arc(p.x, p.y, Math.max(3, k * 0.35), 0, 2 * Math.PI); g.fill(); });
      g.font = `bold ${Math.max(11, Math.round(k * 0.9))}px sans-serif`;
      g.textAlign = 'center';
      lect.red.aristas.forEach((a) => {
        const p = N.get(a.nodo_a);
        const q = N.get(a.nodo_b);
        const t = `${a.id} · ${a.diametro.valor ? `${a.diametro.valor}″` : 'Ø?'} · ${a.longitud_cota.valor ? `${Number(a.longitud_cota.valor.toFixed(3))} m` : '¿m?'}`;
        g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.strokeText(t, (p.x + q.x) / 2, (p.y + q.y) / 2 - k * 0.5);
        g.fillStyle = '#1b4596'; g.fillText(t, (p.x + q.x) / 2, (p.y + q.y) / 2 - k * 0.5);
      });
    });
  }

  /** Verificación visual (§9): Claude compara la foto con la lectura dibujada encima; lo que encuentre queda como avisos. */
  async function verificar() {
    if (!sample || verif.activa || !foto) return;
    const ctl = new AbortController();
    verif = { activa: true, ctl };
    pintar();
    try {
      const lect = fuente().lectura;
      const [limpia, marcada] = await Promise.all([
        aJpeg({ fuente: foto.fuente, w: foto.ancho, h: foto.alto }, { x: 0, y: 0, w: foto.ancho, h: foto.alto }, foto.w, foto.h), fotoConLectura(lect)]);
      const difs = await sample.json(V().promptVerificacion(lect), { images: [limpia, marcada], modelTier: 'default', signal: ctl.signal });
      const { lectura: nueva, n } = V().agregarVerificacion(lect, difs);
      reemplazarLectura(nueva);
      avisosAbiertos = n > 0;
      notaLectura = n ? `La revisión visual de Claude encontró ${n} ${n === 1 ? 'diferencia' : 'diferencias'} entre la lectura y la foto: están en «Avisos».` : 'La revisión visual de Claude no encontró diferencias entre la lectura y la foto.';
    } catch (e) {
      if (!(e && e.code === 'cancelled')) notaLectura = `La revisión visual no se pudo hacer: ${mensajeDe(e)[0]}`;
    }
    verif = { activa: false };
    pintar();
  }

  /**
   * El trazo del trazado isométrico, ya leído (motor/trazado_lectura.js): abre el diálogo en su despiece y lo agrega a la
   * cotización si se puede (si ya hay partidas importadas, se revisa para reemplazarlas). Lo que se contestó aquí a un trazo
   * anterior y el trazo no dice (el ángulo de un injerto, un tramo corto sin decidir) se conserva en los elementos que siguen;
   * lo que dice el trazo manda. avisos: lo que hay que saber del paso (se muestra arriba del despiece).
   */
  function desdeTrazado(lect, respuestas, avisos) {
    const g = guardada();
    const previas = g && deTrazado(g.lectura) ? g.respuestas : {};
    const ids = new Set([...lect.red.nodos.map((n) => n.id), ...lect.red.aristas.map((a) => a.id)]);
    const conservadas = {};
    Object.keys(previas).filter((id) => ids.has(id)).forEach((id) => {
      const r = {};
      ['angulo_deg', 'encimado', 'aceptado'].forEach((k) => { if (previas[id][k] !== undefined) r[k] = previas[id][k]; });
      if (Object.keys(r).length) conservadas[id] = r;
    });
    const todas = { ...conservadas };
    Object.keys(respuestas || {}).forEach((id) => { todas[id] = { ...(todas[id] || {}), ...respuestas[id] }; });
    errores = [];
    vista = 'revision';
    notaLectura = avisos && avisos.length ? `Del trazo: ${avisos.join(' ')}` : '';
    const d = $('#dlg-unifilar');
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    aceptarLectura(lect, todas, true);
    W.recalcular();
    const foco = $('.uf-preguntas [data-clave]') || $('#uf-agregar, #uf-ver-cotizacion, #uf-listo');
    if (foco) foco.focus();
  }

  /** Guarda una respuesta (o la quita con valor undefined), vuelve a correr las reglas y, si ya están en la cotización, actualiza las partidas. */
  function responder(elemento, campo, valor) {
    const f = fuente();
    const r = { ...(f.respuestas[elemento] || {}) };
    if (valor === undefined) delete r[campo]; else r[campo] = valor;
    f.respuestas = { ...f.respuestas };
    if (Object.keys(r).length) f.respuestas[elemento] = r; else delete f.respuestas[elemento];
    nota = '';
    if (f === guardada()) {
      const bom = despiece(f);
      if (f.importado) {
        if (!bom || bom.resumen.estado === 'NO_COTIZABLE') nota = 'Con esta respuesta el despiece no se puede cotizar: las partidas de la cotización se quedan como estaban hasta resolverlo.';
        else if (editadas().length) nota = 'Hay partidas importadas editadas a mano: la cotización no se actualizó sola. Use «Actualizar partidas» para reemplazarlas con el despiece.';
        else { aplicar(bom); W.toast('Partidas del unifilar actualizadas'); }
      }
      W.recalcular();
    }
    pintar(`${elemento}|${campo}`);
  }

  function agregar() {
    const bom = despiece();
    if (!bom || bom.resumen.estado === 'NO_COTIZABLE') return;
    const habia = importadas().length;
    E().cot.unifilar = { ...fuente(), importado: true };
    borrador = null;
    const n = aplicar(bom);
    const primera = E().cot.partidas.find((p) => p.unifilar_id);
    if (primera) E().sel = primera.id;
    W.recalcular();
    cerrar();
    const pend = UF().pendientes(bom).length;
    W.toast(`${habia ? `Se reemplazaron las partidas del unifilar: ${n}` : `${n} ${n === 1 ? 'partida agregada' : 'partidas agregadas'}`}${pend ? ` · ${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} por responder` : ''}`);
  }

  /** Quita la lectura y sus partidas de la cotización (con «Deshacer»). */
  function descartar() {
    const cot = E().cot;
    const previa = { unifilar: cot.unifilar, partidas: cot.partidas, sel: E().sel };
    const n = importadas().length;
    cot.partidas = cot.partidas.filter((p) => !p.unifilar_id);
    delete cot.unifilar;
    borrador = null;
    W.recalcular();
    cerrar();
    W.toast(n ? `Se quitaron ${n} ${n === 1 ? 'partida' : 'partidas'} del unifilar` : 'Lectura de unifilar descartada', {
      texto: 'Deshacer',
      fn: () => { cot.unifilar = previa.unifilar; cot.partidas = previa.partidas; E().sel = previa.sel; W.recalcular(); },
    });
  }

  /* ------------------------------------------------------------------ revisión */

  const sufijo = (u) => SUFIJO[u] || u || '';
  const etiquetaValor = (resp, v) => {
    const o = resp.opciones.find((x) => x.valor === v);
    if (o) return o.texto;
    return `${v}${resp.unidad === 'in' || resp.unidad === 'deg' ? '' : ' '}${sufijo(resp.unidad)}`.trim();
  };

  /** El control para contestar una alerta: número, opciones o aceptar; en una ya respondida, cambiarla o quitarla. */
  function controlRespuesta(a) {
    const r = a.respuesta;
    const clave = `${r.elemento}|${r.campo}`;
    const id = `uf-r-${a.id}`;
    const actual = (fuente().respuestas[r.elemento] || {})[r.campo];
    let leerValor;
    let control;
    if (r.tipo === 'NUMERO') {
      const entrada = h('input', {
        id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: r.propuesta === null ? '' : String(r.propuesta), dataset: { clave },
        onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); } },
      });
      control = h('div', { class: 'ctl' }, entrada, h('span', { class: 'sufijo' }, sufijo(r.unidad)));
      leerValor = () => {
        const v = W.leerNumero(entrada.value);
        const entero = r.campo === 'manguera_tramos';
        if (!Number.isFinite(v) || v <= 0 || (entero && !Number.isInteger(v))) return { error: entero ? 'Escriba un número entero de tramos (1 o más).' : 'Escriba una medida mayor que cero (12, 1.6 o 1 1/2).' };
        if (r.campo === 'longitud_m' && v > 200) return { error: 'Escriba la cota en metros (200 m como máximo por tramo).' };
        if ((r.campo === 'diametro_in' || r.campo === 'boca_in') && v > 120) return { error: 'Escriba el diámetro en pulgadas.' };
        return { valor: v };
      };
    } else if (r.tipo === 'OPCIONES') {
      const sel = h('select', { id, dataset: { clave } }, r.opciones.map((o, i) => h('option', { value: String(i), selected: o.valor === r.propuesta }, o.texto)));
      control = sel;
      leerValor = () => ({ valor: r.opciones[Number(sel.value)].valor });
    }
    const err = h('p', { class: 'uf-err', role: 'alert', hidden: true });
    function confirmar() {
      const x = leerValor ? leerValor() : { valor: true };
      if (x.error) { err.textContent = x.error; err.hidden = false; return; }
      responder(r.elemento, r.campo, x.valor);
    }
    const textoBoton = a.resuelta ? 'Cambiar' : r.tipo === 'ACEPTAR' ? 'Aceptar' : 'Confirmar';
    const boton = h('button', { type: 'button', class: `btn ${a.resuelta ? 'btn-sec' : 'btn-primario'}`, onclick: confirmar, dataset: r.tipo === 'ACEPTAR' ? { clave } : undefined }, textoBoton);
    return h('div', { class: 'uf-resp' },
      a.pregunta || r.tipo !== 'ACEPTAR' ? h('label', { class: 'uf-preg', for: r.tipo === 'ACEPTAR' ? null : id }, a.pregunta || (a.resuelta ? 'Su respuesta' : 'Si no es así, corríjalo')) : null,
      h('div', { class: 'uf-resp-fila' }, r.tipo === 'ACEPTAR' && a.resuelta ? null : control, a.resuelta && r.tipo === 'ACEPTAR' ? null : boton,
        actual !== undefined ? h('button', { type: 'button', class: 'btn-texto', onclick: () => responder(r.elemento, r.campo, undefined) }, 'Quitar la respuesta') : null),
      err,
      a.resuelta && actual !== undefined ? h('p', { class: 'uf-actual' }, `Respondido: ${etiquetaValor(r, actual)}`) : null);
  }

  function tarjeta(a) {
    const sev = a.resuelta ? 'RESUELTA' : a.severidad;
    return h('article', { class: `uf-alerta uf-${sev.toLowerCase()}`, dataset: { alerta: a.id, codigo: a.codigo } },
      h('div', { class: 'uf-alerta-cab' },
        h('span', { class: `chip uf-chip-${sev.toLowerCase()}` }, a.resuelta ? 'Respondida' : SEVERIDAD[a.severidad]),
        h('span', { class: 'uf-cod' }, CODIGO[a.codigo] || a.codigo),
        h('span', { class: 'uf-refs' }, a.referencias.join(' · '))),
      h('p', { class: 'uf-msg' }, a.mensaje),
      a.decision_tomada && !a.resuelta ? h('p', { class: 'uf-dec' }, a.decision_tomada) : null,
      a.respuesta ? controlRespuesta(a) : null);
  }

  function grupo(titulo, alertas, abierto, clase) {
    if (!alertas.length) return null;
    return h('details', { class: `uf-grupo ${clase || ''}`, open: abierto },
      h('summary', null, `${titulo} (${alertas.length})`),
      h('div', { class: 'uf-lista' }, alertas.map(tarjeta)));
  }

  function pintarRevision(cuerpo, pie) {
    const bom = despiece();
    const f = fuente();
    if (!bom) {
      errores = ['Las reglas no pudieron despiezar esta lectura.'];
      vista = 'carga';
      pintarCarga(cuerpo, pie);
      return;
    }
    const R = bom.resumen;
    const al = bom.alertas_ambiguedad;
    const preguntas = UF().pendientes(bom);
    const opcionales = al.filter((a) => !a.resuelta && a.severidad === 'ADVERTENCIA');
    const notas = al.filter((a) => !a.resuelta && a.severidad === 'INFO');
    const respondidas = al.filter((a) => a.resuelta);
    const partidas = UF().aPartidas(bom);
    const u = { diam: E().cot.unidad_diam, long: E().cot.unidad_long };
    const reemplaza = !!borrador || (f.importado && importadas().length);
    const ed = editadas();
    const estadoNota = ESTADO[R.estado][1];
    const deDibujo = CAD().esDeDibujo(f.lectura);
    const delTrazado = deTrazado(f.lectura);
    W.reemplazar(cuerpo,
      h('div', { class: `uf-estado uf-estado-${R.estado.toLowerCase()}` },
        h('strong', null, `Despiece ${{ DEFINITIVA: 'definitivo', PRELIMINAR: 'preliminar', NO_COTIZABLE: 'no cotizable' }[R.estado]}`), h('span', null, estadoNota)),
      h('div', { class: 'tiles uf-tiles' },
        W.tile('Tramos rectos', String(R.conteo.ductos_rectos), `${W.num(R.longitud_total_neta_m, 2)} m netos`),
        W.tile('Accesorios', String(R.conteo.accesorios), 'codos, injertos y reducciones'),
        W.tile('Aros', String(R.conteo.aros), `${R.conteo.aros_sueltos} sueltos · ${R.conteo.tornillos_juegos} tornillos`),
        W.tile('Ménsulas', String(R.conteo.menulas), 'regla del taller'),
        W.tile('Al punto más lejano', `${W.num(R.longitud_al_punto_mas_alejado_m, 1)} m`, `Ø mayor ${W.num(R.diametro_max_in, 0)}″`)),
      borrador ? h('p', { class: 'uf-nota' }, `Es una lectura nueva: al aplicarla reemplaza las ${importadas().length} partidas ${origen(guardada().lectura)} que ya están en la cotización.`) : null,
      notaLectura ? h('p', { class: 'uf-nota uf-nota-lectura' }, notaLectura) : null,
      nota ? h('p', { class: 'uf-nota', role: 'status' }, nota) : null,
      preguntas.length
        ? h('section', { class: 'uf-preguntas', 'aria-labelledby': 'uf-tit-preg' },
          h('h3', { id: 'uf-tit-preg' }, `Preguntas (${preguntas.length})`),
          h('div', { class: 'uf-lista' }, preguntas.map(tarjeta)))
        : h('p', { class: 'uf-sin' }, W.icono('check'), 'No hay preguntas pendientes.'),
      grupo('Avisos', opcionales, !preguntas.length || avisosAbiertos, 'uf-g-avisos'),
      grupo('Decisiones de las reglas', notas, false, 'uf-g-notas'),
      grupo('Respondidas', respondidas, false, 'uf-g-resp'),
      dibujo(bom, preguntas),
      h('details', { class: 'uf-grupo uf-g-piezas' },
        h('summary', null, `Piezas del despiece (${partidas.length} partidas)`),
        W.tabla([{ t: 'Pieza' }, { t: 'Partida' }, { t: 'Medidas' }, { t: 'Cant.', num: true }],
          partidas.map((p) => [h('code', null, p.unifilar_id), W.tituloPartida(p), W.resumenDims(p, u, E().M), String(p.cantidad)]))),
      ed.length ? h('p', { class: 'uf-nota' }, `Editó a mano ${ed.length === 1 ? 'la partida' : 'las partidas'} ${ed.map((p) => p.unifilar_id).join(', ')}: al actualizar se reemplazan con las del despiece.`) : null,
      h('p', { class: 'uf-pie-txt' },
        h('button', { type: 'button', class: 'btn-texto', id: 'uf-copiar', onclick: () => W.copiarTexto(JSON.stringify(bom, null, 2), 'Despiece copiado en JSON') }, 'Copiar el despiece en JSON'),
        ' · ',
        h('button', { type: 'button', class: 'btn-texto', id: 'uf-copiar-lectura', onclick: () => W.copiarTexto(JSON.stringify(f.lectura, null, 2), 'Lectura copiada en JSON') }, deDibujo ? 'Copiar la lectura del dibujo' : delTrazado ? 'Copiar la lectura del trazado' : 'Copiar la lectura de Claude'),
        ' · el esquema está en docs/unifilar-bom.schema.json; para medir la lectura, docs/evaluacion'));
    const bloqueado = R.estado === 'NO_COTIZABLE';
    const pendienteAplicar = reemplaza && (borrador || ed.length);
    const primario = !f.importado || borrador
      ? h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-agregar', disabled: bloqueado, onclick: agregar },
        reemplaza ? `Reemplazar con ${partidas.length} partidas` : `Agregar ${partidas.length} partidas`)
      : pendienteAplicar
        ? h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-agregar', disabled: bloqueado, onclick: agregar }, 'Actualizar partidas')
        : h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-listo', onclick: cerrar }, 'Listo');
    const primeraImportada = f.importado && !borrador ? importadas()[0] : null;
    W.reemplazar(pie,
      deDibujo && W.unifilarCadUI.hayDibujo() ? h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-editar-dibujo', onclick: abrirDibujo }, 'Editar el dibujo') : null,
      delTrazado && primeraImportada ? h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-ver-cotizacion', onclick: () => { cerrar(); W.verPartida(primeraImportada.id); } }, 'Ver en la cotización') : null,
      h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-otra', onclick: () => { vista = 'carga'; errores = []; pintar(); $('#uf-texto').focus(); } }, 'Otra lectura'),
      guardada() && !borrador ? h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-descartar', onclick: descartar }, guardada().importado ? 'Quitar de la cotización' : 'Descartar la lectura') : null,
      h('span', { class: 'uf-pie-esp' }),
      bloqueado ? h('span', { class: 'uf-pie-nota' }, 'Responda lo que bloquea para poder agregar.') : null,
      primario);
  }

  function iniciar() {
    const d = $('#dlg-unifilar');
    if (!d) return;
    $('#btn-unifilar').addEventListener('click', () => abrir());
    $('#btn-dibujar').addEventListener('click', () => abrir('dibujo'));
    $('#aviso-unifilar-abrir').addEventListener('click', () => abrir());
    $('#uf-cerrar').addEventListener('click', cerrar);
    d.addEventListener('close', () => { borrador = null; if (lectura.ctl) lectura.ctl.abort(); if (verif.ctl) verif.ctl.abort(); });
    d.addEventListener('click', (e) => { if (e.target === d) cerrar(); });
    // en la página publicada, Claude puede leer la foto (si esta vista manda imágenes); en otra copia no hay window.claude
    if (root.claude && typeof root.claude.use === 'function') {
      root.claude.use('sample').then(async (s) => {
        if (!s) return;
        const lim = await s.limits().catch(() => null);
        if (!lim || !lim.images) return;
        sample = s;
        limites = lim;
        if (d.open && vista === 'carga' && !lectura.activa) pintar();
      }).catch(() => {});
    }
  }

  W.unifilarUI = { render, abrir, desdeTrazado, despiece: () => despiece() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
