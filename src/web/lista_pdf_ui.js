/**
 * COTIZAP · web/lista_pdf_ui.js — El botón «Lista de fabricación (PDF)» (en Planos y en la cotización detallada): arma la lista de
 * piezas para fabricar con todas sus especificaciones y la entrega como PDF.
 *
 * En el navegador (cotizap.html) el archivo se baja con un enlace de descarga. En el artefacto publicado (COTIZAP_ENTORNO_ARTIFACT)
 * no se puede imprimir ni bajar enlaces: se usa la capacidad `downloads` (`window.claude.use('downloads')`), que pide confirmación
 * al usuario; si la rechaza («declined») sólo se avisa, sin error. Depende de app.js (W.estadoApp, W.toast, W.resumenMaterial).
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const $ = (s, r) => (r || document).querySelector(s);
  const ARTEFACTO = !!root.COTIZAP_ENTORNO_ARTIFACT;

  const MENSAJES = {
    vacio: 'No hay piezas que fabricar: agregue codos, reducciones, ductos, bridas o soportería para armar la lista.',
    guardado: (nombre, hojas) => `Lista de fabricación guardada: ${nombre} (${hojas} ${hojas === 1 ? 'hoja' : 'hojas'}).`,
    cancelado: 'Descarga cancelada: no se guardó la lista de fabricación.',
    noDisponible: 'En este visor no se puede descargar la lista. Abra COTIZAP en su navegador (el archivo cotizap.html) y descárguela desde ahí.',
    muchas: 'Demasiadas descargas seguidas: espere unos segundos y vuelva a intentarlo.',
    fallo: 'No se pudo guardar la lista de fabricación. Vuelva a intentarlo.',
    armado: 'No se pudo armar la lista de fabricación: revise las partidas con errores.',
  };

  /** La capacidad `downloads` del artefacto (se pide al pulsar, no al abrir); null si no existe o no se concede. */
  async function capacidadDescargas() {
    try {
      if (!root.claude || typeof root.claude.use !== 'function') return null;
      return (await root.claude.use('downloads')) || null;
    } catch (e) { return null; }
  }

  let ocupado = false;
  async function generar() {
    if (ocupado) return;
    const est = W.estadoApp;
    if (!est || !est.res) return;
    ocupado = true;
    try {
      const lista = C.listaFabricacion.listaFabricacion(est.cot, est.res, est.res.maestros, { materialDe: W.resumenMaterial });
      if (!lista.piezas.length) { W.toast(MENSAJES.vacio); return; }
      let pdf;
      try { pdf = C.listaPDF.generar(lista); } catch (e) { W.toast(MENSAJES.armado); return; }
      const nombre = C.listaPDF.nombreArchivo(lista);
      if (!ARTEFACTO) {
        W.bajarArchivo(pdf.bytes, nombre, 'application/pdf');
        W.toast(MENSAJES.guardado(nombre, pdf.paginas));
        return;
      }
      const d = await capacidadDescargas();
      if (!d || typeof d.save !== 'function') { W.toast(MENSAJES.noDisponible); return; }
      try {
        await d.save({ filename: nombre, data: pdf.bytes });
        W.toast(MENSAJES.guardado(nombre, pdf.paginas));
      } catch (err) {
        const codigo = err && err.code;
        if (codigo === 'declined') W.toast(MENSAJES.cancelado); // lo rechazó el usuario: no se reintenta
        else if (codigo === 'rate_limited') W.toast(MENSAJES.muchas);
        else if (codigo === 'unavailable' || codigo === 'not_granted') W.toast(MENSAJES.noDisponible);
        else W.toast(MENSAJES.fallo);
      }
    } finally { ocupado = false; }
  }

  function iniciar() {
    ['#btn-lista-pdf-planos', '#btn-lista-pdf-cot'].forEach((s) => { const b = $(s); if (b) b.addEventListener('click', generar); });
  }

  W.listaPDFUI = { generar, MENSAJES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}(typeof self !== 'undefined' ? self : this));
