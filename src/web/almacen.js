/**
 * COTIZAP · web/almacen.js — Guardado automático de las tablas maestras (precios, tarifas, velocidades…).
 *
 * Se guarda sólo el PARCHE: lo que el usuario cambió respecto de los valores de arranque.
 *
 *   1. En el artefacto, con la capacidad `db`: documento `config/maestros`. Sobrevive a cerrar el navegador,
 *      a cambiar de equipo y a publicar versiones nuevas de la página.
 *   2. Además, siempre en localStorage (lo hace app.js): arranque instantáneo y respaldo si no hay conexión.
 *
 * Al abrir manda lo guardado en el artefacto, salvo que haya cambios locales que no llegaron a subirse
 * (bandera `pendiente` en localStorage): esos se suben. Cada cambio se guarda solo, tras una pausa corta,
 * y de a una escritura por vez. Fuera de un artefacto (archivo suelto) sólo hay localStorage.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../motor/util'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.almacen = factory(root.COTIZAP.util);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const RUTA = 'config/maestros';
  const VERSION_DOC = 2;
  const SIN_PERMISO = ['invalid_argument', 'revoked', 'not_granted'];
  const SIN_DB = ['capability_disabled', 'capability_removed'];
  const SIN_REINTENTO = ['quota_exceeded', 'transform_error'];
  const MAX_REINTENTOS = 6;

  const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

  /**
   * La versión 1 de la app guardaba los maestros COMPLETOS. Se convierten en parche contra los valores de arranque
   * actuales, sin lo que no era una edición del usuario: los herrajes (entonces ángulos por diámetro; ahora manda la
   * brida estándar del taller), `meta` (salvo sus banderas) y el precio de empaque de entonces (18.00).
   */
  function parcheDesdeV1(base, v1) {
    if (!esObjeto(v1)) return {};
    const { meta, herrajes, ...resto } = v1;
    void herrajes;
    const parche = U.diferencia(base, resto);
    if (parche.precios && parche.precios.precio_m_empaque_neopreno === 18) {
      delete parche.precios.precio_m_empaque_neopreno;
      if (!Object.keys(parche.precios).length) delete parche.precios;
    }
    const banderas = {};
    if (meta && meta.revisado) banderas.revisado = true;
    if (meta && meta.editado) banderas.editado = true;
    if (Object.keys(banderas).length) parche.meta = banderas;
    return parche;
  }

  /**
   * opc.claude          () => window.claude (o undefined fuera de un artefacto)
   * opc.ls              { leer(k), guardar(k, v), borrar(k) } sobre localStorage, sin lanzar errores
   * opc.llavePendiente  llave de la bandera «hay cambios locales sin subir»
   * opc.alEstado        (estado, info) => void
   * opc.tiempos         sólo para pruebas: { debounce_ms, reintento_ms, ahora, esperar, aleatorio }
   *
   * Estados: cargando · guardado · guardando · error · lectura (sin permiso para cambiar) · local (sólo este navegador).
   */
  function crear(opc) {
    const ls = opc.ls;
    const llavePend = opc.llavePendiente || 'cotizap.maestros.pendiente';
    const alEstado = opc.alEstado || (() => {});
    const T = {
      debounce_ms: 700,
      reintento_ms: [2000, 8000, 30000],
      ahora: () => Date.now(),
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      aleatorio: Math.random,
      ...opc.tiempos,
    };

    let claude = null;
    let ref = null;
    let listo = false;
    let soloLectura = false;
    let ultimoVisto = {};
    let pendiente = null;
    let enVuelo = null;
    let temporizador = null;
    let temporizadorReintento = null;
    let intentos = 0;
    let estado = 'inicio';

    const emitir = (e, info) => { estado = e; alEstado(e, { ...info, soloLectura }); };

    function quitarTemporizadores() {
      if (temporizador) { clearTimeout(temporizador); temporizador = null; }
      if (temporizadorReintento) { clearTimeout(temporizadorReintento); temporizadorReintento = null; }
    }

    async function leer() {
      for (let intento = 0; ; intento += 1) {
        try { return await ref.get(); } catch (e) {
          if (intento === 0 && e && e.code === 'unavailable') { await T.esperar(300 + T.aleatorio() * 700); continue; }
          throw e;
        }
      }
    }

    /** Abre el almacén y decide qué parche manda. Resuelve { origen: 'remoto' | 'local', parche }; nunca rechaza. */
    async function iniciar(parcheLocal) {
      const local = esObjeto(parcheLocal) ? parcheLocal : {};
      try {
        return await abrir(local);
      } catch (e) {
        // Algo inesperado: se sigue en este navegador (los cambios quedan marcados para subirse después).
        ref = null;
        listo = true;
        emitir('local', { motivo: 'sin-lectura' });
        return { origen: 'local', parche: local };
      }
    }

    async function abrir(local) {
      ultimoVisto = local;
      claude = typeof opc.claude === 'function' ? opc.claude() : opc.claude;
      if (!claude || typeof claude.use !== 'function') {
        listo = true;
        emitir('local', { motivo: 'sin-artefacto' });
        return { origen: 'local', parche: local };
      }
      emitir('cargando');
      let db = null;
      try { db = await claude.use('db'); } catch (e) { db = null; }
      if (!db) {
        listo = true;
        emitir('local', { motivo: 'sin-db' });
        return { origen: 'local', parche: local };
      }
      try {
        // Los precios son de todos los que abren el artefacto: sólo el propietario y los editores los cambian.
        const usuario = await claude.use('user');
        if (usuario && (await usuario.canEdit()) === false) soloLectura = true;
      } catch (e) { /* sin dato: se intenta escribir y manda el rechazo */ }
      let instantanea;
      try {
        ref = db.doc(RUTA);
        instantanea = await leer();
      } catch (e) {
        ref = null;
        listo = true;
        emitir('local', { motivo: 'sin-lectura', codigo: e && e.code });
        return { origen: 'local', parche: local };
      }
      const datos = instantanea && instantanea.exists ? instantanea.data() : undefined;
      const remoto = datos && esObjeto(datos.parche) ? datos.parche : null;
      const hayPendiente = !!ls.leer(llavePend);
      listo = true;
      ultimoVisto = remoto || {};
      if (remoto && (!hayPendiente || soloLectura)) {
        if (hayPendiente) ls.borrar(llavePend);
        emitir(soloLectura ? 'lectura' : 'guardado');
        return { origen: 'remoto', parche: remoto };
      }
      // Lo local manda: hay cambios que no llegaron a subirse (o todavía no existe nada guardado). La app los vuelve a
      // programar con `programar`, que los compara contra lo que hay en el almacén.
      if (remoto && hayPendiente && U.igual(local, remoto)) ls.borrar(llavePend);
      emitir(soloLectura ? 'lectura' : 'guardado');
      return { origen: 'local', parche: local };
    }

    /** Avisa que el parche cambió. Guarda tras una pausa; no hace nada si no difiere de lo ya guardado. */
    function programar(parche) {
      if (!listo || !claude || soloLectura) return;
      if (U.igual(parche, ultimoVisto)) return;
      ls.guardar(llavePend, true);
      if (!ref) return; // sin conexión con el artefacto: queda marcado y se sube en la próxima apertura
      pendiente = U.clonar(parche);
      emitir('guardando');
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(() => { temporizador = null; vaciar(); }, T.debounce_ms);
    }

    async function escribir(parche) {
      const cuerpo = { v: VERSION_DOC, parche: U.clonar(parche), actualizado: new Date(T.ahora()).toISOString() };
      for (let intento = 0; intento < 2; intento += 1) {
        try { await ref.set(cuerpo); return { ok: true }; } catch (e) {
          const codigo = e && e.code;
          if (codigo === 'unavailable' && intento === 0) { await T.esperar(300 + T.aleatorio() * 700); continue; }
          return { ok: false, codigo };
        }
      }
      return { ok: false, codigo: 'unavailable' };
    }

    function programarReintento() {
      if (temporizadorReintento || intentos >= MAX_REINTENTOS) return;
      const espera = T.reintento_ms[Math.min(intentos, T.reintento_ms.length - 1)];
      intentos += 1;
      temporizadorReintento = setTimeout(() => { temporizadorReintento = null; vaciar(); }, espera);
    }

    function cerrar(r) {
      if (r.ok) {
        ls.borrar(llavePend);
        emitir('guardado', { hora: T.ahora() });
        return;
      }
      if (SIN_PERMISO.includes(r.codigo)) {
        soloLectura = true;
        pendiente = null;
        ls.borrar(llavePend);
        emitir('lectura', { codigo: r.codigo });
        return;
      }
      if (SIN_DB.includes(r.codigo)) {
        ref = null;
        emitir('local', { motivo: 'sin-db', codigo: r.codigo });
        return;
      }
      emitir('error', { codigo: r.codigo });
      if (!SIN_REINTENTO.includes(r.codigo)) programarReintento();
    }

    /** Escribe ya lo pendiente (si hay). Resuelve cuando termina la escritura en curso y las que se acumularon. */
    function vaciar() {
      if (temporizador) { clearTimeout(temporizador); temporizador = null; }
      if (enVuelo) return enVuelo;
      if (pendiente === null || !ref) return Promise.resolve();
      enVuelo = (async () => {
        let resultado = { ok: true };
        try {
          // Una escritura a la vez por documento: lo que llegue mientras se escribe se manda en la vuelta siguiente.
          while (pendiente !== null) {
            const parche = pendiente;
            pendiente = null;
            resultado = await escribir(parche);
            if (!resultado.ok) { if (pendiente === null) pendiente = parche; break; }
            ultimoVisto = parche;
            intentos = 0;
          }
        } finally { enVuelo = null; }
        cerrar(resultado);
      })();
      return enVuelo;
    }

    /** Reintento manual (botón): vuelve a intentar lo pendiente sin esperar. */
    function reintentar() {
      intentos = 0;
      if (temporizadorReintento) { clearTimeout(temporizadorReintento); temporizadorReintento = null; }
      return vaciar();
    }

    return {
      iniciar, programar, vaciar, reintentar,
      estado: () => estado,
      soloLectura: () => soloLectura,
      detener: quitarTemporizadores,
    };
  }

  return { RUTA, VERSION_DOC, crear, parcheDesdeV1 };
}));
