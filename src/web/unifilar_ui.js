/**
 * COTIZAP · web/unifilar_ui.js — «Importar unifilar» en la cotización detallada (docs/vision-unifilares.md §10).
 *
 * Recibe la lectura de un croquis unifilar en JSON (la que entrega la etapa de visión, o un despiece completo), corre las
 * reglas del taller (motor/unifilar.js) y muestra el resumen, las preguntas y las piezas. Las partidas se agregan a la
 * cotización con el identificador de su pieza (`unifilar_id`); cada respuesta del ingeniero vuelve a correr las reglas y, si
 * las partidas ya están en la cotización, las reemplaza.
 *
 * Lo importado vive en la cotización: estado.cot.unifilar = { lectura, respuestas, importado }.
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
  const MAX_TEXTO = 5e6; // caracteres: una lectura real pesa decenas de kB

  const SEVERIDAD = { BLOQUEANTE: 'Bloquea', CONFIRMAR: 'Por confirmar', ADVERTENCIA: 'Aviso', INFO: 'Nota' };
  const CODIGO = {
    COTA_ILEGIBLE: 'Cota ilegible', COTA_FALTANTE: 'Cota faltante', DIAMETRO_FALTANTE: 'Diámetro faltante', DIAMETRO_INFERIDO: 'Diámetro heredado',
    DIAMETRO_INCONSISTENTE: 'Diámetro dudoso', ANGULO_INFERIDO: 'Ángulo del codo', ANGULO_NO_PERMITIDO: 'Ángulo del codo', ANGULO_DERIVACION_NO_PERMITIDO: 'Ángulo del injerto',
    DERIVACION_CONTRA_FLUJO: 'Contra el flujo', ORIENTACION_AMBIGUA: 'Orientación', TRANSICION_INSERTADA: 'Reducción insertada', ACCESORIOS_ENCIMADOS: 'Tramo corto',
    CONEXION_EQUIPO: 'Boca del equipo', MANGUERA_SIN_LARGO: 'Manguera', CALIBRE_BAJO_TABLA: 'Calibre', CALIBRE_FALTANTE: 'Calibre', MATERIAL_FALTANTE: 'Material',
    TEXTO_SIN_ASOCIAR: 'Texto suelto', ASOCIACION_AMBIGUA: 'Texto ambiguo', TRAZO_SIN_CONECTAR: 'Trazo suelto', CRUCE_SIN_NODO: 'Cruce', CICLO_EN_RED: 'Ciclo en la red',
    PANTALON_RETIRADO: 'Pantalón', SIN_COLECTOR: 'Colector',
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
      ? [h('strong', null, `${n} ${n === 1 ? 'partida' : 'partidas'} de un croquis unifilar · ${ESTADO[estado][0].toLowerCase()}.`), ' ',
        pend ? `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} por responder.` : 'Todas las preguntas están respondidas.']
      : [h('strong', null, 'Hay una lectura de unifilar sin agregar a la cotización.'), ' ', pend ? `${pend} ${pend === 1 ? 'pregunta' : 'preguntas'} por responder.` : '']));
  }

  /* ------------------------------------------------------------------ diálogo */

  function abrir() {
    borrador = null;
    errores = [];
    nota = '';
    vista = guardada() ? 'revision' : 'carga';
    pintar();
    const d = $('#dlg-unifilar');
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    const foco = vista === 'carga' ? $('#uf-texto') : $('.uf-preguntas [data-clave]') || $('#uf-cerrar');
    if (foco) foco.focus();
  }
  function cerrar() {
    const d = $('#dlg-unifilar');
    borrador = null;
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }

  function pintar(enfocar) {
    const cuerpo = $('#uf-cuerpo');
    const pie = $('#uf-pie');
    if (vista === 'carga') pintarCarga(cuerpo, pie); else pintarRevision(cuerpo, pie);
    if (enfocar !== undefined) {
      // la misma pregunta si sigue a la vista (una ya respondida pasa al grupo cerrado), si no la primera pendiente
      const visible = (el) => el && !el.closest('details:not([open])');
      const misma = Array.from(cuerpo.querySelectorAll('[data-clave]')).find((el) => el.dataset.clave === enfocar && visible(el));
      const el = misma || $('.uf-preguntas [data-clave]', cuerpo) || $('#uf-agregar, #uf-listo', pie);
      if (el) el.focus();
    }
  }

  function pintarCarga(cuerpo, pie) {
    const area = h('textarea', { id: 'uf-texto', rows: '12', spellcheck: 'false', 'aria-label': 'Lectura del unifilar en JSON', placeholder: '{ "version": "1.0", "metadatos": { … }, "red": { "nodos": […], "aristas": […], "textos": […] }, "equipos": […] }' });
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
    W.reemplazar(cuerpo,
      h('p', { class: 'uf-ayuda' }, 'Pegue la lectura del croquis en JSON —la que entrega la etapa de visión (docs/vision-unifilares.md) o un despiece completo— o cárguela de un archivo. ',
        'Las reglas del taller sacan los tramos, los accesorios, las uniones y los soportes; lo que el croquis no dice, lo pregunta.'),
      area,
      errores.length ? h('div', { class: 'uf-errores', role: 'alert' }, h('strong', null, 'No se pudo leer:'), h('ul', null, errores.map((e) => h('li', null, e)))) : null,
      h('div', { class: 'io-acc' },
        h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-leer', onclick: () => leerTexto($('#uf-texto').value) }, 'Leer el unifilar'),
        h('label', { class: 'btn btn-sec archivo' }, 'Cargar archivo', archivo),
        h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-ejemplo', onclick: probarEjemplo }, 'Probar con el ejemplo')));
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
    errores = [];
    if (!texto || !texto.trim()) errores = ['Pegue el JSON de la lectura o cargue un archivo.'];
    else if (texto.length > MAX_TEXTO) errores = ['El texto es demasiado grande para ser una lectura de unifilar.'];
    let r = null;
    if (!errores.length) {
      r = UF().leer(texto);
      errores = r.errores;
    }
    if (!errores.length && !despiece({ lectura: r.lectura, respuestas: {} })) errores = ['Las reglas no pudieron despiezar esta lectura. Revise que la red esté completa.'];
    if (errores.length) { pintar(); return; }
    const nueva = { lectura: r.lectura, respuestas: {}, importado: false };
    const g = guardada();
    if (g && g.importado) borrador = nueva; // no toca las partidas importadas hasta que se reemplacen
    else {
      borrador = null;
      E().cot.unifilar = nueva;
      W.recalcular();
    }
    vista = 'revision';
    nota = '';
    pintar('');
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
    const [estadoTxt, estadoNota] = ESTADO[R.estado];
    W.reemplazar(cuerpo,
      h('div', { class: `uf-estado uf-estado-${R.estado.toLowerCase()}` },
        h('strong', null, `Despiece ${estadoTxt.toLowerCase()}`), h('span', null, estadoNota)),
      h('div', { class: 'tiles uf-tiles' },
        W.tile('Tramos rectos', String(R.conteo.ductos_rectos), `${W.num(R.longitud_total_neta_m, 2)} m netos`),
        W.tile('Accesorios', String(R.conteo.accesorios), 'codos, injertos y reducciones'),
        W.tile('Aros', String(R.conteo.aros), `${R.conteo.aros_sueltos} sueltos · ${R.conteo.tornillos_juegos} tornillos`),
        W.tile('Ménsulas', String(R.conteo.menulas), 'regla del taller'),
        W.tile('Al punto más lejano', `${W.num(R.longitud_al_punto_mas_alejado_m, 1)} m`, `Ø mayor ${W.num(R.diametro_max_in, 0)}″`)),
      borrador ? h('p', { class: 'uf-nota' }, `Es una lectura nueva: al aplicarla reemplaza las ${importadas().length} partidas del unifilar que ya están en la cotización.`) : null,
      nota ? h('p', { class: 'uf-nota', role: 'status' }, nota) : null,
      preguntas.length
        ? h('section', { class: 'uf-preguntas', 'aria-labelledby': 'uf-tit-preg' },
          h('h3', { id: 'uf-tit-preg' }, `Preguntas (${preguntas.length})`),
          h('div', { class: 'uf-lista' }, preguntas.map(tarjeta)))
        : h('p', { class: 'uf-sin' }, W.icono('check'), 'No hay preguntas pendientes.'),
      grupo('Avisos', opcionales, !preguntas.length, 'uf-g-avisos'),
      grupo('Decisiones de las reglas', notas, false, 'uf-g-notas'),
      grupo('Respondidas', respondidas, false, 'uf-g-resp'),
      h('details', { class: 'uf-grupo uf-g-piezas' },
        h('summary', null, `Piezas del despiece (${partidas.length} partidas)`),
        W.tabla([{ t: 'Pieza' }, { t: 'Partida' }, { t: 'Medidas' }, { t: 'Cant.', num: true }],
          partidas.map((p) => [h('code', null, p.unifilar_id), W.tituloPartida(p), W.resumenDims(p, u, E().M), String(p.cantidad)]))),
      ed.length ? h('p', { class: 'uf-nota' }, `Editó a mano ${ed.length === 1 ? 'la partida' : 'las partidas'} ${ed.map((p) => p.unifilar_id).join(', ')}: al actualizar se reemplazan con las del despiece.`) : null,
      h('p', { class: 'uf-pie-txt' },
        h('button', { type: 'button', class: 'btn-texto', id: 'uf-copiar', onclick: () => W.copiarTexto(JSON.stringify(bom, null, 2), 'Despiece copiado en JSON') }, 'Copiar el despiece en JSON'),
        ' · el esquema está en docs/unifilar-bom.schema.json'));
    const bloqueado = R.estado === 'NO_COTIZABLE';
    const pendienteAplicar = reemplaza && (borrador || ed.length);
    const primario = !f.importado || borrador
      ? h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-agregar', disabled: bloqueado, onclick: agregar },
        reemplaza ? `Reemplazar con ${partidas.length} partidas` : `Agregar ${partidas.length} partidas`)
      : pendienteAplicar
        ? h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-agregar', disabled: bloqueado, onclick: agregar }, 'Actualizar partidas')
        : h('button', { type: 'button', class: 'btn btn-primario', id: 'uf-listo', onclick: cerrar }, 'Listo');
    W.reemplazar(pie,
      h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-otra', onclick: () => { vista = 'carga'; errores = []; pintar(); $('#uf-texto').focus(); } }, 'Otra lectura'),
      guardada() && !borrador ? h('button', { type: 'button', class: 'btn btn-sec', id: 'uf-descartar', onclick: descartar }, guardada().importado ? 'Quitar de la cotización' : 'Descartar la lectura') : null,
      h('span', { class: 'uf-pie-esp' }),
      bloqueado ? h('span', { class: 'uf-pie-nota' }, 'Responda lo que bloquea para poder agregar.') : null,
      primario);
  }

  function iniciar() {
    const d = $('#dlg-unifilar');
    if (!d) return;
    $('#btn-unifilar').addEventListener('click', abrir);
    $('#aviso-unifilar-abrir').addEventListener('click', abrir);
    $('#uf-cerrar').addEventListener('click', cerrar);
    d.addEventListener('close', () => { borrador = null; });
    d.addEventListener('click', (e) => { if (e.target === d) cerrar(); });
  }

  W.unifilarUI = { render, abrir, despiece: () => despiece() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
