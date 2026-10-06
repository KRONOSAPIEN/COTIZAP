/**
 * COTIZAP · web/maestros_ui.js — Editor genérico de tablas maestras.
 * Recorre el objeto de maestros de forma recursiva y genera un campo por cada número,
 * con unidades inferidas del nombre. Los cambios recalculan la cotización al instante
 * y se guardan solos (almacén del artefacto y navegador; ver almacen.js); la línea de estado
 * de la cabecera dice dónde quedaron.
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const U = C.util;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const GRUPOS = [
    ['proveedor', 'Lista de precios del proveedor', 'Lo que cotiza el proveedor de acero, por pieza (hoja o barra) y con IVA incluido. El cálculo lo convierte a precio por kg sin IVA.'],
    ['precios', 'Precios', 'Variables referenciales en MXN, sin IVA. Los precios por kg de lámina y perfil sólo se usan para lo que no esté en la lista del proveedor.'],
    ['mano_obra', 'Mano de obra y equipo', 'Costo por hora = salario por hora × FSR. FSR = Factor de Salario Real (suma las prestaciones al salario).'],
    ['merma', 'Merma por familia', 'Fracción del material comprado que no queda en la pieza (se captura en %).'],
    ['capas', 'Pila de precio', 'Indirectos, imprevistos, financiamiento, utilidad, comisión e IVA.'],
    ['proceso', 'Proceso de fabricación', 'Velocidades, tiempos fijos, soldadura, pintura y eficiencia del taller.'],
    ['herrajes', 'Herrajes de unión', 'Perfiles de aros, tipos de unión, empaque y sellador.'],
    ['materiales', 'Materiales', 'Densidad, tabla de calibre, variables de precio y consumibles por material.'],
    ['calibres', 'Espesor por calibre', 'En pulgadas. Cada familia de calibre (MSG, GSG, USSG) tiene su propia tabla.'],
    ['servicios', 'Calibre mínimo por servicio', 'No normativo: poblar con la norma interna. Mayor número de calibre = lámina más delgada.'],
  ];

  const UNIDADES = [
    [/^precio_kg_/, 'MXN/kg'], [/^precio_m3_/, 'MXN/m³'], [/^precio_m_/, 'MXN/m'], [/^precio_cartucho/, 'MXN/cartucho'], [/^precio_pza/, 'MXN/pza'],
    [/^precio_juego/, 'MXN/juego'], [/^precio_L_/, 'MXN/L'], [/salario_hora/, 'MXN/h'], [/equipo_h$/, 'MXN/h'], [/gif_por_hora/, 'MXN/h'], [/cargo_minimo/, 'MXN'],
    [/_mm$/, 'mm'], [/_mm2$/, 'mm²'], [/_m_min$/, 'm/min'], [/_min_m2$/, 'min/m²'], [/_min_m$/, 'min/m'], [/_min_kg$/, 'min/kg'], [/_min$/, 'min'], [/_deg$/, '°'],
    [/_kg_m3$/, 'kg/m³'], [/_g_cm3$/, 'g/cm³'], [/_L_min$/, 'L/min'], [/_um$/, 'µm'], [/^dias_cobro$/, 'días'], [/ml_por_m/, 'mL/m'], [/^cartucho_ml$/, 'mL'],
  ];
  const POSITIVOS = ['eficiencia_taller', 'FO', 'eta_dep', 'eta_transf', 'v_mult', 'FSR', 'cartucho_ml', 'paso_tornillo_mm', 'paso_fijacion_mm', 'densidad_kg_m3', 'dft_um', 'sv_pct', 'L_max_pieza_mm'];

  const esPct = (ruta) => ruta[0] === 'merma' || ruta.some((k) => typeof k === 'string' && /pct$|^tasa_/.test(k) && k !== 'sv_pct');
  const etiqueta = (k) => String(k).replace(/_/g, ' ');
  function unidadDe(ruta) {
    if (esPct(ruta)) return '%';
    const k = [...ruta].reverse().find((x) => typeof x === 'string');
    const par = UNIDADES.find(([re]) => re.test(k));
    if (par) return par[1];
    if (ruta[0] === 'calibres') return 'in';
    return '';
  }

  function aplicar(ruta, valor) {
    let o = W.estadoApp.M;
    for (let i = 0; i < ruta.length - 1; i += 1) o = o[ruta[i]];
    o[ruta[ruta.length - 1]] = valor;
  }

  function fila(ruta, valor, etiquetaPropia) {
    const k = ruta[ruta.length - 1];
    const pct = esPct(ruta) && typeof valor === 'number';
    const un = unidadDe(ruta);
    const mostrado = pct ? Number((valor * 100).toFixed(6)) : valor;
    const id = `m_${ruta.join('__')}`;
    const buscar = `${ruta.join(' ')} ${etiqueta(ruta.join(' '))} ${etiquetaPropia || ''}`.toLowerCase();
    const ctl = typeof valor === 'number'
      ? h('input', { id, type: 'number', step: 'any', value: String(mostrado), dataset: { ruta: JSON.stringify(ruta), tipo: pct ? 'pct' : 'num' } })
      : h('input', { id, type: 'text', value: String(valor), dataset: { ruta: JSON.stringify(ruta), tipo: 'txt' } });
    return h('div', { class: 'm-fila', dataset: { buscar } },
      h('label', { for: id }, h('span', { class: etiquetaPropia ? 'm-et m-et-txt' : 'm-et' }, etiquetaPropia || (typeof k === 'number' ? `#${k + 1}` : String(k)))),
      h('div', { class: 'm-ctl' }, ctl, un ? h('span', { class: 'sufijo' }, un) : h('span', { class: 'sufijo' })));
  }

  function tablaPares(ruta, pares) {
    const k = ruta[ruta.length - 1];
    const unY = /v_m_min/.test(String(ruta[ruta.length - 2])) || /v_m_min/.test(String(k)) ? 'Velocidad (m/min)' : 'Valor';
    const buscar = ruta.join(' ').toLowerCase();
    return h('div', { class: 'm-tabla', dataset: { buscar } },
      h('div', { class: 'm-tabla-tit' }, etiqueta(k)),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, h('th', null, 'Espesor (mm)'), h('th', null, unY))),
        h('tbody', null, pares.map((par, i) => h('tr', null,
          h('td', null, h('input', { type: 'number', step: 'any', value: String(par[0]), 'aria-label': `Espesor fila ${i + 1}`, dataset: { ruta: JSON.stringify([...ruta, i, 0]), tipo: 'num' } })),
          h('td', null, h('input', { type: 'number', step: 'any', value: String(par[1]), 'aria-label': `Valor fila ${i + 1}`, dataset: { ruta: JSON.stringify([...ruta, i, 1]), tipo: 'num' } }))))))));
  }

  function tablaObjetos(ruta, filas) {
    const cols = Object.keys(filas[0]);
    const buscar = ruta.join(' ').toLowerCase();
    return h('div', { class: 'm-tabla', dataset: { buscar } },
      h('div', { class: 'm-tabla-tit' }, etiqueta(ruta[ruta.length - 1])),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, cols.map((c) => h('th', null, etiqueta(c))))),
        h('tbody', null, filas.map((f, i) => h('tr', null, cols.map((c) => {
          const v = f[c];
          const r = [...ruta, i, c];
          return h('td', null, h('input', { type: typeof v === 'number' ? 'number' : 'text', step: 'any', value: String(v), 'aria-label': `${etiqueta(c)} fila ${i + 1}`, dataset: { ruta: JSON.stringify(r), tipo: typeof v === 'number' ? 'num' : 'txt' } }));
        })))))));
  }

  function nodo(valor, ruta) {
    if (Array.isArray(valor)) {
      if (valor.length && valor.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'number'))) return tablaPares(ruta, valor);
      if (valor.length && valor.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return tablaObjetos(ruta, valor);
      return h('div', null, valor.map((x, i) => nodo(x, [...ruta, i])));
    }
    if (valor && typeof valor === 'object') {
      const prim = Object.keys(valor).filter((k) => typeof valor[k] !== 'object');
      const comp = Object.keys(valor).filter((k) => typeof valor[k] === 'object');
      return h('div', { class: 'm-obj' },
        prim.length ? h('div', { class: 'm-filas' }, prim.map((k) => fila([...ruta, k], valor[k]))) : null,
        comp.map((k) => h('details', { class: 'm-sub', dataset: { buscar: [...ruta, k].join(' ').toLowerCase() }, open: ruta.length < 2 && comp.length < 3 },
          h('summary', null, etiqueta(k)), nodo(valor[k], [...ruta, k]))));
    }
    return fila(ruta, valor);
  }

  /* ---- Lista de precios del proveedor: un renglón por pieza, con lo que el cálculo deriva de él ---- */
  const dosDec = (x) => (x === null || x === undefined ? '—' : W.num(x, 2));
  const medidaRenglon = (tipo, r) => (tipo === 'hojas' ? `${Math.round(r.ancho_mm)} × ${Math.round(r.largo_mm)} mm` : `${W.num(r.largo_mm / 1000, 2)} m`);

  function chipUso(uso) {
    return uso === 'CALCULO'
      ? h('span', { class: 'm-uso m-uso-calculo', title: 'El cotizador usa este precio' }, 'Cálculo')
      : h('span', { class: 'm-uso', title: 'Sólo referencia: ninguna pieza del cotizador lo usa todavía' }, 'Referencia');
  }

  function renglonProveedor(tipo, r) {
    const ruta = ['proveedor', tipo, r.id, 'precio'];
    return h('tr', { dataset: { prov: tipo, id: r.id } },
      h('td', { class: 'm-prov-desc' }, r.descripcion || r.id),
      h('td', { class: 'num' }, medidaRenglon(tipo, r)),
      h('td', null, h('input', {
        id: `m_${ruta.join('__')}`, type: 'number', step: 'any', value: String(r.precio), 'aria-label': `Precio cotizado: ${r.descripcion || r.id}`, dataset: { ruta: JSON.stringify(ruta), tipo: 'num' },
      })),
      h('td', { class: 'num', dataset: { campo: 'sin_iva' } }, dosDec(r.sin_iva)),
      h('td', { class: 'num', dataset: { campo: 'kg' } }, dosDec(r.kg)),
      h('td', { class: 'num', dataset: { campo: 'precio_kg' } }, dosDec(r.precio_kg)),
      h('td', { dataset: { campo: 'uso' } }, chipUso(r.uso)));
  }

  function tablaProveedor(titulo, tipo, filas, cabMedida, cabKg) {
    const buscar = `proveedor ${tipo} ${titulo} ${filas.map((r) => `${r.id} ${r.descripcion || ''}`).join(' ')} precio cotizado iva lámina perfil barra hoja`.toLowerCase();
    return h('div', { class: 'm-tabla m-prov', dataset: { buscar } },
      h('div', { class: 'm-tabla-tit' }, titulo),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null,
          h('th', null, 'Concepto'), h('th', { class: 'num' }, cabMedida), h('th', { class: 'num' }, 'Precio cotizado (con IVA)'),
          h('th', { class: 'num' }, 'Sin IVA'), h('th', { class: 'num' }, cabKg), h('th', { class: 'num' }, '$/kg sin IVA'), h('th', null, 'Uso'))),
        h('tbody', null, filas.map((r) => renglonProveedor(tipo, r))))));
  }

  function nodoProveedor(M) {
    const t = C.proveedor.tablas(M);
    return h('div', { class: 'm-obj' },
      h('div', { class: 'm-filas m-filas-ancho' },
        fila(['proveedor', 'fecha'], M.proveedor.fecha, 'Fecha de la cotización'),
        fila(['proveedor', 'iva_incluido_pct'], M.proveedor.iva_incluido_pct, 'IVA incluido en los precios')),
      tablaProveedor('Lámina en hoja', 'hojas', t.hojas, 'Hoja', 'kg por hoja'),
      tablaProveedor('Perfiles y otros en barra', 'barras', t.barras, 'Barra', 'kg por barra'),
      h('p', { class: 'nota' }, '«Cálculo» = el cotizador toma ese precio: la lámina de ese material y calibre (si hay varios tamaños, el de la hoja estándar del taller) y los aros de ese perfil. Lo demás es referencia. '
        + 'Precio por kg = precio sin IVA ÷ kg de la pieza. Un precio en 0 no se usa. Si los precios se capturan antes de IVA, ponga 0 % en «IVA incluido en los precios».'));
  }

  /** Recalcula las columnas derivadas del proveedor (sin IVA, kg, $/kg, uso) tras cualquier cambio de las tablas. */
  function refrescarProveedor() {
    if (!$('#maestros-cuerpo .m-prov')) return;
    const t = C.proveedor.tablas(W.estadoApp.M);
    ['hojas', 'barras'].forEach((tipo) => t[tipo].forEach((r) => {
      const tr = $(`#maestros-cuerpo tr[data-prov="${tipo}"][data-id="${r.id}"]`);
      if (!tr) return;
      $('[data-campo="sin_iva"]', tr).textContent = dosDec(r.sin_iva);
      $('[data-campo="kg"]', tr).textContent = dosDec(r.kg);
      $('[data-campo="precio_kg"]', tr).textContent = dosDec(r.precio_kg);
      $('[data-campo="uso"]', tr).replaceChildren(chipUso(r.uso));
    }));
  }

  /* ---- Línea de estado del guardado automático ---- */
  const hora = (t) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const MENSAJES = {
    inicio: () => 'Los cambios se guardan automáticamente.',
    cargando: () => 'Buscando sus precios guardados…',
    guardando: () => 'Guardando…',
    guardado: (i) => (i.hora ? `Guardado automáticamente a las ${hora(i.hora)}.` : 'Los cambios se guardan automáticamente.'),
    lectura: () => 'Sólo lectura: los precios los cambia el propietario o un editor del artefacto.',
    error: (i) => (i.codigo === 'quota_exceeded'
      ? 'No hay espacio para guardar en el artefacto. Sus cambios siguen en este navegador.'
      : 'No se pudo guardar. Sus cambios siguen en este navegador y se reintentará.'),
    local: (i) => (i.motivo === 'sin-artefacto'
      ? 'Los cambios se guardan automáticamente en este navegador.'
      : 'Guardado sólo en este navegador: no hay conexión con el almacenamiento del artefacto.'),
  };
  let ultimoEstado = { estado: 'inicio', info: {} };

  /** En sólo lectura (o sin poder guardar) los campos se muestran pero no se editan. */
  function aplicarBloqueo() {
    const bloquear = !!(ultimoEstado.info && ultimoEstado.info.soloLectura);
    $$('#maestros-cuerpo input').forEach((i) => { i.disabled = bloquear; });
    const reset = $('#maestros-reset');
    if (reset) reset.disabled = bloquear;
  }

  function mostrarGuardado(estado, info) {
    ultimoEstado = { estado, info: info || {} };
    const el = $('#maestros-guardado');
    if (!el) return;
    el.dataset.estado = estado;
    $('.guardado-txt', el).textContent = (MENSAJES[estado] || MENSAJES.inicio)(ultimoEstado.info);
    $('#maestros-reintentar').hidden = estado !== 'error';
    aplicarBloqueo();
  }

  function render() {
    const M = W.estadoApp.M;
    const cont = $('#maestros-cuerpo');
    cont.replaceChildren(...GRUPOS.map(([clave, titulo, nota]) => h('details', { class: 'm-grupo', dataset: { grupo: clave } },
      h('summary', null, h('span', { class: 'm-grupo-tit' }, titulo), h('span', { class: 'm-grupo-nota' }, nota)),
      h('div', { class: 'm-grupo-cuerpo' }, clave === 'proveedor' ? nodoProveedor(M) : nodo(M[clave], [clave])))));
    filtrar();
    aplicarBloqueo();
  }

  function filtrar() {
    const q = ($('#maestros-buscar').value || '').trim().toLowerCase();
    $$('#maestros-cuerpo .m-grupo').forEach((g) => {
      let visibles = 0;
      $$('.m-fila, .m-tabla', g).forEach((f) => {
        const ok = !q || f.dataset.buscar.includes(q) || (g.dataset.grupo || '').includes(q);
        f.hidden = !ok;
        if (ok) visibles += 1;
      });
      g.hidden = q !== '' && visibles === 0;
      if (q) g.open = visibles > 0;
      if (q) $$('.m-sub', g).forEach((s) => { s.open = true; });
    });
  }

  function alCambiar(ev) {
    const el = ev.target;
    if (!el.dataset || !el.dataset.ruta) return;
    const ruta = JSON.parse(el.dataset.ruta);
    const tipo = el.dataset.tipo;
    const estado = W.estadoApp;
    if (tipo === 'txt') {
      aplicar(ruta, el.value);
    } else {
      const n = Number(el.value);
      const k = ruta[ruta.length - 1];
      if (el.value === '' || Number.isNaN(n) || n < 0 || (POSITIVOS.includes(k) && n <= 0)) {
        let o = estado.M;
        ruta.forEach((x) => { o = o[x]; });
        el.value = String(tipo === 'pct' ? Number((o * 100).toFixed(6)) : o);
        W.toast('Valor no válido: use un número positivo');
        return;
      }
      aplicar(ruta, tipo === 'pct' ? n / 100 : n);
    }
    estado.M.meta.editado = true;
    refrescarProveedor();
    W.recalcular();
  }

  let enlazado = false;
  W.maestrosUI = {
    mostrarGuardado,
    render() {
      if (!enlazado) {
        enlazado = true;
        $('#maestros-cuerpo').addEventListener('change', alCambiar);
        $('#maestros-buscar').addEventListener('input', filtrar);
        const btn = $('#maestros-reset');
        let armado = null;
        btn.addEventListener('click', () => {
          if (!armado) {
            btn.textContent = '¿Seguro? Pulse otra vez para restablecer';
            btn.classList.add('btn-peligro');
            armado = setTimeout(() => { armado = null; btn.textContent = 'Restablecer valores ilustrativos'; btn.classList.remove('btn-peligro'); }, 4000);
            return;
          }
          clearTimeout(armado);
          armado = null;
          btn.textContent = 'Restablecer valores ilustrativos';
          btn.classList.remove('btn-peligro');
          W.estadoApp.M = C.maestros.crearMaestros();
          W.recalcular();
          render();
          W.toast('Tablas maestras restablecidas');
        });
      }
      render();
    },
  };
  void U;
}(typeof self !== 'undefined' ? self : this));
