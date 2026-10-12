/**
 * COTIZAP · web/maestros_ui.js — Editor genérico de tablas maestras.
 * Recorre el objeto de maestros de forma recursiva y genera un campo por cada dato, con unidades inferidas del nombre.
 * Los cambios recalculan la cotización al instante y se guardan solos (almacén del artefacto y navegador; ver almacen.js);
 * la línea de estado de la cabecera dice dónde quedaron.
 *
 * Para que sea intuitivo cada dato, sección, tabla y grupo trae un botón ⓘ con su ayuda (maestros_ayuda_ui.js: qué es, cómo se
 * llena, qué esperar y «¿y si…?»); los datos que no son un número se eligen de una lista; lo que se aparta del valor de arranque
 * se marca; y cada cambio deja una barra «Último cambio» con lo que movió el precio de la cotización y un botón para deshacerlo.
 */
(function (root) {
  'use strict';

  const C = root.COTIZAP;
  const W = C.web;
  const { h } = W;
  const U = C.util;
  const A = C.ayudaMaestros;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const GRUPOS = [
    ['proveedor', 'Lista de precios del proveedor', 'Lo que cotiza el proveedor de acero, por pieza (hoja o barra) y con IVA incluido. El cálculo lo convierte a precio por kg sin IVA.'],
    ['precios', 'Precios', 'Variables referenciales en MXN, sin IVA. Los precios por kg de lámina y perfil sólo se usan para lo que no esté en la lista del proveedor.'],
    ['compras', 'Catálogo de compras', 'Lo que se compra hecho (mangueras, abrazaderas, taquetes, selladores…): precio, si trae IVA y en qué renglón del control de gastos cae. También cómo se redondea la lista de compras.'],
    ['mano_obra', 'Mano de obra y equipo', 'Costo por hora = salario por día ÷ horas por día × FSR: $500 ÷ 8 h = $62.50. El salario es sin utilidades ni prestaciones; para cobrarlas, suba el FSR.'],
    ['merma', 'Merma por familia', 'Fracción del material comprado que no queda en la pieza (se captura en %).'],
    ['capas', 'Pila de precio', 'Indirectos, imprevistos, financiamiento, utilidad, comisión e IVA.'],
    ['rapida', 'Cotización rápida', 'Lámina en hojas enteras × factor, más las bridas por metros, la mano de obra de los días (fabricación de bridas e instalación), la utilidad y el IVA. Sólo la usa la pestaña «Cotización rápida».'],
    ['proceso', 'Proceso de fabricación', 'Velocidades, tiempos fijos, soldadura, pintura, eficiencia del taller y límites de captura de las partidas.'],
    ['herrajes', 'Herrajes de unión', 'Perfiles de aros, tipos de unión, empaque y sellador.'],
    ['materiales', 'Materiales', 'Densidad, tabla de calibre, variables de precio y consumibles por material.'],
    ['calibres', 'Espesor por calibre', 'En pulgadas. Cada familia de calibre (MSG, GSG, USSG) tiene su propia tabla.'],
    ['servicios', 'Calibre mínimo por servicio', 'No normativo: poblar con la norma interna. Mayor número de calibre = lámina más delgada.'],
    ['calculo', 'Cálculo de la red (trazado)', 'Las eficiencias del ventilador y de las bandas y los coeficientes de pérdida (ACGIH) con que se calcula el trazado isométrico. No mueven el precio.'],
    ['ventiladores', 'Catálogo de ventiladores', 'Las curvas de los ventiladores que vende su proveedor, para elegir el del colector en la salida del trazado. Los dos de arranque son ilustrativos (curvas inventadas). No mueven el precio.'],
  ];

  const { esPct, etiqueta, unidadDe } = A;
  const idDe = (ruta) => `m_${ruta.join('__')}`;
  const llave = (ruta) => JSON.stringify(ruta);
  const leer = (M, ruta) => ruta.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), M);
  const fmt = (x) => Number(x).toLocaleString('es-MX', { maximumFractionDigits: 4 });

  function aplicar(ruta, valor) {
    let o = W.estadoApp.M;
    for (let i = 0; i < ruta.length - 1; i += 1) o = o[ruta[i]];
    o[ruta[ruta.length - 1]] = valor;
  }

  /* ---------- Valores de arranque: qué se ha cambiado ---------- */
  let valoresBase = null;
  const baseM = () => valoresBase || (valoresBase = C.maestros.crearMaestros());
  const cambiado = (ruta) => !U.igual(leer(baseM(), ruta), leer(W.estadoApp.M, ruta));
  /** Cuántos datos (hojas del árbol) de `actual` difieren de `base`. */
  function contarCambios(base, actual) {
    if (actual !== null && typeof actual === 'object' && base !== null && typeof base === 'object') {
      return Object.keys(actual).reduce((n, k) => n + contarCambios(base[k], actual[k]), 0);
    }
    return U.igual(base, actual) ? 0 : 1;
  }

  /* ---------- Datos que se eligen de una lista ----------
   Un dato de texto que sólo admite ciertos valores se elige de una lista (si se tecleara «suelta» en vez de «SUELTA», o el nombre de un
   precio que no existe, el cálculo se detendría hasta corregirlo). Cada lista se arma al dibujar el campo: puede depender de otras tablas.
   [patrón de la ruta con * por cada clave, () => [[valor, texto], …]] */
  const claves = (o) => Object.keys(o || {}).map((k) => [k, k]);
  const sistemasDePintura = () => {
    const nombres = Object.fromEntries(W.OPC.pintura.filter(([v]) => v));
    return Object.keys(W.estadoApp.M.proceso.pintura.sistemas).map((k) => [k, nombres[k] || k]);
  };
  // Precios a los que puede apuntar cada referencia: primero los del tipo que corresponde, luego «otros precios»
  const REFS_PRECIO = [
    ['materiales.*.precio_ref', /^precio_kg_(acero|inox)/], ['materiales.*.chatarra_ref', /^precio_kg_chatarra/],
    ['materiales.*.alambre_ref', /^precio_kg_(alambre|varilla)/], ['materiales.*.gas_ref', /^precio_m3_gas/],
    ['proceso.corte.consumible_ref.*', /^precio_m_corte/], ['proceso.pintura.capas.*.precio_ref', /^precio_L_/], ['proceso.pintura.diluyente_precio_ref', /^precio_L_/],
    ['herrajes.perfiles.*.precio_ref', /^precio_kg_(perfil|solera)/], ['herrajes.tornillo_precio_ref.*', /^precio_juego_tornillo/],
    ['herrajes.empaque.precio_ref', /^precio_m_empaque/], ['herrajes.sellador.precio_cartucho_ref', /^precio_cartucho/], ['herrajes.precio_fijacion_ref', /^precio_pza/],
  ];
  function opcionesDePrecio(re) {
    const P = W.estadoApp.M.precios;
    const texto = (k) => { const un = unidadDe(['precios', k]); return `${k} · ${fmt(P[k])}${un ? ` ${un}` : ''}`; };
    const propios = Object.keys(P).filter((k) => re.test(k));
    const otros = Object.keys(P).filter((k) => !re.test(k));
    return [...propios.map((k) => [k, texto(k)]), ...(propios.length && otros.length ? [[null, '— otros precios —']] : []), ...otros.map((k) => [k, texto(k)])];
  }
  const OPCIONES_TEXTO = [
    ['proceso.armado_yardas.extremo_ajuste_defecto', () => W.OPC.ajuste],
    ['proceso.armado_yardas.junta_entre_yardas', () => {
      const c = W.estadoApp.M.proceso.costuras;
      return Object.keys(c).map((k) => [k, c[k] && c[k].nombre ? c[k].nombre : k]);
    }],
    ['proceso.pintura.ubicacion_defecto', () => W.OPC.ubicacion.filter(([v]) => v)],
    ['materiales.*.pintura_cuerpo.*', sistemasDePintura],
    ['materiales.*.pintura_bridas.*', sistemasDePintura],
    ['proceso.pintura.sistemas.*.*', () => claves(W.estadoApp.M.proceso.pintura.capas)],
    ['materiales.*.tabla_calibre', () => claves(W.estadoApp.M.calibres)],
    ['materiales.*.proceso_sold', () => claves(W.estadoApp.M.proceso.soldadura.procesos)],
    ['materiales.*.costura', () => {
      const c = W.estadoApp.M.proceso.costuras;
      return Object.keys(c).map((k) => [k, c[k] && c[k].nombre ? c[k].nombre : k]);
    }],
    ['materiales.*.brida_al_ducto', () => [['SOLDADA', 'Soldada (filete aro–ducto)'], ['CEJA', 'Con ceja (se mete y se le hace una ceja al ducto)']]],
    ['proceso.corte.proceso_recto', () => claves(W.estadoApp.M.proceso.corte.v_m_min)],
    ['proceso.corte.proceso_perfilado', () => claves(W.estadoApp.M.proceso.corte.v_m_min)],
    ['proceso.injerto_inclinado_hacia', () => [['MENOR', 'MENOR (de mayor a menor)'], ['MAYOR', 'MAYOR']]],
    ['herrajes.perfiles.*.tipo', () => [['SOLERA', 'Solera (barra plana)'], ['ANGULO', 'Ángulo']]],
    ['herrajes.perfiles.*.tornillo', () => claves(W.estadoApp.M.herrajes.tornillo_precio_ref)],
    ['herrajes.uniones.BRIDADO.junta', () => [['SELLADOR', 'Sikaflex: cordón sobre los barrenos'], ['EMPAQUE', 'Empaque de neopreno (y el cordón de la clase)']]],
    ['proceso.costuras.*.soldada', () => [['true', 'Sí'], ['false', 'No']]],
    ['compras.articulos.*.iva_incluido', () => [['true', 'Sí: el precio ya trae IVA'], ['false', 'No: el precio es antes de IVA']]],
    ['compras.articulos.*.categoria', () => Object.keys(C.gastos.CATEGORIAS).map((k) => [k, C.gastos.CATEGORIAS[k]])],
    ['proceso.soportes.anclaje_defecto', () => Object.keys(W.estadoApp.M.compras.articulos).map((k) => [k, W.estadoApp.M.compras.articulos[k].descripcion || k])],
    ['proceso.soportes.tornillo', () => claves(W.estadoApp.M.herrajes.tornillo_precio_ref)],
    ['rapida.hoja_defecto', () => C.rapida.hojas(W.estadoApp.M).map((x) => [x.id, x.descripcion])],
    ['rapida.soporteria.menula_barra', () => Object.keys(W.estadoApp.M.proveedor.barras).map((k) => [k, W.estadoApp.M.proveedor.barras[k].descripcion || k])],
    ['rapida.soporteria.abrazadera_barra', () => Object.keys(W.estadoApp.M.proveedor.barras).map((k) => [k, W.estadoApp.M.proveedor.barras[k].descripcion || k])],
    ['rapida.mangueras.articulo', () => Object.keys(W.estadoApp.M.compras.articulos).map((k) => [k, W.estadoApp.M.compras.articulos[k].descripcion || k])],
    ['rapida.mangueras.abrazadera', () => Object.keys(W.estadoApp.M.compras.articulos).map((k) => [k, W.estadoApp.M.compras.articulos[k].descripcion || k])],
    ['rapida.soporteria.abrazadera_vuelta', () => [['MEDIA', 'Media vuelta · cuna de 180°'], ['COMPLETA', 'Vuelta completa · 360°, dos mitades']]],
    ['proceso.costuras.*.cordon', () => [['', 'Sin cordón (no se suelda)'], ['TOPE', 'A tope'], ['FILETE', 'De filete']]],
    ...REFS_PRECIO.map(([patron, re]) => [patron, () => opcionesDePrecio(re)]),
  ].map(([patron, lista]) => [patron.split('.'), lista]);
  const opcionesDe = (ruta, valor) => {
    if (!(typeof valor === 'string' || typeof valor === 'boolean' || valor === null)) return null;
    const par = OPCIONES_TEXTO.find(([partes]) => A.coincide(partes, ruta));
    return par ? par[1]() : null;
  };
  const textoDeOpcion = (clave) => (clave === null ? '' : String(clave));

  /* ---------- Controles y su ayuda ---------- */
  let controles = new Map(); // llave(ruta) → elemento de captura
  let ayudas = new Map(); // llave(ruta) → ayuda del dato (para marcar lo que sale del rango usual)

  function fila(ruta, valor, etiquetaPropia) {
    const k = ruta[ruta.length - 1];
    const pct = esPct(ruta) && typeof valor === 'number';
    const un = unidadDe(ruta);
    const mostrado = pct ? Number((valor * 100).toFixed(6)) : valor;
    const id = idDe(ruta);
    const ay = A.buscar(ruta);
    const titulo = etiquetaPropia || (ay ? ay.t : etiqueta(k));
    const buscar = `${ruta.join(' ')} ${etiqueta(ruta.join(' '))} ${etiquetaPropia || ''} ${ay ? ay.t : ''}`.toLowerCase();
    const lista = opcionesDe(ruta, valor);
    let ctl;
    if (lista) {
      const actual = textoDeOpcion(valor);
      const ops = lista.some(([v]) => v !== null && textoDeOpcion(v) === actual) ? lista : [[valor, `${actual} (no válido)`], ...lista]; // un valor guardado que no está en la lista se muestra, marcado
      const tipo = typeof valor === 'boolean' ? 'bool' : lista.some(([v]) => v === '') ? 'nul' : 'txt';
      ctl = h('select', { id, dataset: { ruta: llave(ruta), tipo } },
        ops.map(([v, t]) => h('option', { value: v === null ? null : textoDeOpcion(v), selected: v !== null && textoDeOpcion(v) === actual, disabled: v === null }, t)));
    } else if (typeof valor === 'number') {
      ctl = h('input', { id, type: 'number', step: 'any', value: String(mostrado), dataset: { ruta: llave(ruta), tipo: pct ? 'pct' : 'num' } });
    } else {
      ctl = h('input', { id, type: 'text', value: String(valor), dataset: { ruta: llave(ruta), tipo: 'txt' } });
    }
    controles.set(llave(ruta), ctl);
    if (ay) ayudas.set(llave(ruta), ay);
    return h('div', { class: lista ? 'm-fila m-fila-lista' : 'm-fila', dataset: { buscar } },
      h('div', { class: 'm-et-caja' },
        h('label', { for: id }, h('span', { class: etiquetaPropia || ay ? 'm-et m-et-txt' : 'm-et' }, etiquetaPropia || ay ? titulo : (typeof k === 'number' ? `#${k + 1}` : String(k))),
          !etiquetaPropia && ay && typeof k !== 'number' && String(k) !== titulo ? h('span', { class: 'm-clave' }, String(k)) : null),
        W.ayudaUI.boton(ruta, 'fila', { fueraDelTab: true })),
      h('div', { class: 'm-ctl' }, ctl, un ? h('span', { class: 'sufijo' }, un) : h('span', { class: 'sufijo' })));
  }

  function tituloTabla(ruta) {
    const ay = A.buscar(ruta);
    return ay ? ay.t : etiqueta(ruta[ruta.length - 1]);
  }
  const encabezadoTabla = (ruta) => h('div', { class: 'm-tabla-tit' }, h('span', null, tituloTabla(ruta)), W.ayudaUI.boton(ruta, 'tabla'));

  function tablaPares(ruta, pares) {
    const k = ruta[ruta.length - 1];
    const unY = /v_m_min/.test(String(ruta[ruta.length - 2])) || /v_m_min/.test(String(k)) ? 'Velocidad (m/min)' : 'Valor';
    const buscar = `${ruta.join(' ')} ${tituloTabla(ruta)}`.toLowerCase();
    const celda = (i, j, v, et) => {
      const r = [...ruta, i, j];
      const el = h('input', { type: 'number', step: 'any', value: String(v), 'aria-label': `${et} fila ${i + 1}`, dataset: { ruta: llave(r), tipo: 'num' } });
      controles.set(llave(r), el);
      return h('td', null, el);
    };
    return h('div', { class: 'm-tabla', dataset: { buscar, tabla: llave(ruta) } },
      encabezadoTabla(ruta),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, h('th', null, 'Espesor (mm)'), h('th', null, unY))),
        h('tbody', null, pares.map((par, i) => h('tr', null, celda(i, 0, par[0], 'Espesor'), celda(i, 1, par[1], 'Valor')))))));
  }

  function tablaObjetos(ruta, filas) {
    const cols = Object.keys(filas[0]);
    const buscar = `${ruta.join(' ')} ${tituloTabla(ruta)}`.toLowerCase();
    return h('div', { class: 'm-tabla', dataset: { buscar, tabla: llave(ruta) } },
      encabezadoTabla(ruta),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla' },
        h('thead', null, h('tr', null, cols.map((c) => h('th', null, etiqueta(c))))),
        h('tbody', null, filas.map((f, i) => h('tr', null, cols.map((c) => {
          const v = f[c];
          const r = [...ruta, i, c];
          const el = h('input', { type: typeof v === 'number' ? 'number' : 'text', step: 'any', value: String(v), 'aria-label': `${etiqueta(c)} fila ${i + 1}`, dataset: { ruta: llave(r), tipo: typeof v === 'number' ? 'num' : 'txt' } });
          controles.set(llave(r), el);
          return h('td', null, el);
        })))))));
  }

  const esTablaPares = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'number'));
  const esTablaObjetos = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

  function nodo(valor, ruta) {
    if (Array.isArray(valor)) {
      if (esTablaPares(valor)) return tablaPares(ruta, valor);
      if (esTablaObjetos(valor)) return tablaObjetos(ruta, valor);
      if (!valor.length) return h('p', { class: 'nota' }, 'Sin renglones: este sistema no lleva pintura.');
      return h('div', { class: 'm-filas' }, valor.map((x, i) => (x !== null && typeof x === 'object' ? nodo(x, [...ruta, i]) : fila([...ruta, i], x))));
    }
    if (valor && typeof valor === 'object') {
      const claveSimple = (k) => valor[k] === null || typeof valor[k] !== 'object';
      const prim = Object.keys(valor).filter(claveSimple);
      const comp = Object.keys(valor).filter((k) => !claveSimple(k));
      return h('div', { class: 'm-obj' },
        prim.length ? h('div', { class: 'm-filas' }, prim.map((k) => fila([...ruta, k], valor[k]))) : null,
        comp.map((k) => {
          const hijo = valor[k];
          const rutaHijo = [...ruta, k];
          const tabla = esTablaPares(hijo) || esTablaObjetos(hijo);
          return h('details', { class: 'm-sub', dataset: { buscar: `${rutaHijo.join(' ')} ${tituloTabla(rutaHijo)}`.toLowerCase() }, open: ruta.length < 2 && comp.length < 3 },
            h('summary', null, h('span', { class: 'm-sub-tit', title: String(k) }, tabla ? etiqueta(k) : tituloTabla(rutaHijo)), tabla ? null : W.ayudaUI.boton(rutaHijo, 'sub')), nodo(hijo, rutaHijo));
        }));
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
    const el = h('input', {
      id: idDe(ruta), type: 'number', step: 'any', value: String(r.precio), 'aria-label': `Precio cotizado: ${r.descripcion || r.id}`, dataset: { ruta: llave(ruta), tipo: 'num' },
    });
    controles.set(llave(ruta), el);
    return h('tr', { dataset: { prov: tipo, id: r.id } },
      h('td', { class: 'm-prov-desc' }, r.descripcion || r.id),
      h('td', { class: 'num' }, medidaRenglon(tipo, r)),
      h('td', null, el),
      h('td', { class: 'num', dataset: { campo: 'sin_iva' } }, dosDec(r.sin_iva)),
      h('td', { class: 'num', dataset: { campo: 'kg' } }, dosDec(r.kg)),
      h('td', { class: 'num', dataset: { campo: 'precio_kg' } }, dosDec(r.precio_kg)),
      h('td', { dataset: { campo: 'uso' } }, chipUso(r.uso)));
  }

  function tablaProveedor(titulo, tipo, filas, cabMedida, cabKg) {
    const ruta = ['proveedor', tipo];
    const buscar = `proveedor ${tipo} ${titulo} ${filas.map((r) => `${r.id} ${r.descripcion || ''}`).join(' ')} precio cotizado iva lámina perfil barra hoja`.toLowerCase();
    return h('div', { class: 'm-tabla m-prov', dataset: { buscar, tabla: llave(ruta) } },
      h('div', { class: 'm-tabla-tit' }, h('span', null, titulo), W.ayudaUI.boton(ruta, 'tabla')),
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

  /* ---- Cálculo de la red: las eficiencias y las tablas de coeficientes con sus ejes fijos (los del manual) ---- */
  function celdaCoef(ruta, v, nombre) {
    const el = h('input', { type: 'number', step: 'any', value: String(v), 'aria-label': nombre, title: nombre, dataset: { ruta: llave(ruta), tipo: 'num', titulo: nombre } });
    controles.set(llave(ruta), el);
    return h('td', null, el);
  }
  /** Una tabla de coeficientes: filas = [[encabezado del renglón, [celdas]]], con las columnas de la ayuda. */
  function tablaCoef(clave, filas, pie) {
    const ruta = ['calculo', 'coeficientes', clave];
    const buscar = `${ruta.join(' ')} ${tituloTabla(ruta)} coeficiente pérdida acgih`.toLowerCase();
    return h('div', { class: 'm-tabla m-coef', dataset: { buscar, tabla: llave(ruta) } },
      encabezadoTabla(ruta),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla', id: `m-coef-${clave}` },
        h('thead', null, h('tr', null, A.COLUMNAS_CALCULO[clave].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, filas.map(([cab, celdas]) => h('tr', null, h('th', { scope: 'row' }, cab), celdas))))),
      pie ? h('p', { class: 'nota' }, pie) : null);
  }
  function nodoCalculo(M) {
    const c = M.calculo.coeficientes;
    const EJ = C.perdidas.EJES;
    const r = (...k) => ['calculo', 'coeficientes', ...k];
    const NOMBRE_CODO = { liso: 'Codo liso o estampado', gajos_5: 'Codo de 5 gajos', gajos_4: 'Codo de 4 gajos', gajos_3: 'Codo de 3 gajos' };
    const codo = tablaCoef('codo', EJ.codo_r_d.liso.map((rd) => [String(rd), Object.keys(NOMBRE_CODO).map((k) => {
      const i = EJ.codo_r_d[k].indexOf(rd);
      return i < 0 ? h('td', { class: 'm-coef-no', title: 'No se hace a este R/D' }, '—') : celdaCoef(r('codo', k, i), c.codo[k][i], `${NOMBRE_CODO[k]} a R/D ${rd}`);
    })]), 'K del codo de 90°; otro ángulo, K × θ/90 con los gajos equivalentes. Las curvas de la manguera usan la columna del liso.');
    const ramal = tablaCoef('entrada_ramal', EJ.entrada_ramal_deg.map((a, i) => [`${a}°`, [celdaCoef(r('entrada_ramal', i), c.entrada_ramal[i], `Entrada de ramal a ${a}°`)]]),
      'Sobre la presión dinámica del ramal; el paso del tronco va en su fricción.');
    const semi = EJ.expansion_semiangulo_deg;
    const expansion = tablaCoef('expansion', semi.map((a, i) => {
      const fila = i === semi.length - 1 ? 'Brusca' : `${a}°`;
      return [fila, EJ.expansion_relacion_D.map((d, j) => celdaCoef(r('expansion', i, j), c.expansion[i][j], `Expansión ${i === semi.length - 1 ? 'brusca' : `a ${a}°`} con D₂/D₁ ${d}`))];
    }), 'Pérdida = (1 − R)·(pv₁ − pv₂). Valores de 0 a 1.');
    const contraccion = tablaCoef('contraccion', EJ.contraccion_semiangulo_deg.map((a, i) => [a === 90 ? '90° (brusca)' : `${a}°`, [celdaCoef(r('contraccion', i), c.contraccion[i], `Contracción a ${a}°`)]]),
      'Pérdida = L·(pv₂ − pv₁). Valores de 0 a 1.');
    return h('div', { class: 'm-obj' },
      h('div', { class: 'm-calc-trazo', id: 'm-calc-trazo', 'aria-live': 'polite' }),
      h('div', { class: 'm-filas m-filas-ancho' }, fila(['calculo', 'eficiencia_ventilador'], M.calculo.eficiencia_ventilador), fila(['calculo', 'eficiencia_transmision'], M.calculo.eficiencia_transmision)),
      codo,
      h('div', { class: 'm-filas m-filas-ancho' }, fila(r('codo', 'inglete_90'), c.codo.inglete_90)),
      ramal, expansion, contraccion,
      h('p', { class: 'nota' }, 'Los ejes (R/D, ángulos y D₂/D₁) son los del manual Industrial Ventilation de la ACGIH y no se editan; entre renglones se interpola. Los valores de arranque son los de referencia: cotéjelos con su edición.'));
  }
  /** El cuadro del cálculo: cómo queda el ventilador del trazado de esta cotización con estas tablas. */
  function refrescarCalculo() {
    const ve = $('#m-vent-trazo');
    if (ve) ve.replaceChildren(h('p', { class: 'nota' }, C.trazadoTablero.efectoCatalogo(W.estadoApp.cot && W.estadoApp.cot.trazado_iso, W.estadoApp.M).txt));
    const el = $('#m-calc-trazo');
    if (!el) return;
    const t = W.estadoApp.cot && W.estadoApp.cot.trazado_iso;
    const ir = h('button', { type: 'button', class: 'btn btn-sec btn-chico', id: 'm-calc-ir', onclick: () => { $('#tab-trazado').click(); } }, 'Ir al trazado');
    if (!t || !(t.equipos || []).length) { el.replaceChildren(h('p', { class: 'nota' }, 'Esta cotización no tiene trazado isométrico. Estos datos sólo mueven su cálculo de pérdidas, no el precio.')); return; }
    const c = C.trazadoTablero.calcularTrazo(t, W.estadoApp.M);
    if (c.error) { el.replaceChildren(h('p', { class: 'nota m-calc-error' }, `El trazado todavía no se calcula: ${c.error}`), ir); return; }
    const nombre = (id) => { const e = t.equipos.find((x) => x.id === id); return e ? e.nombre : id; };
    el.replaceChildren(h('p', { class: 'm-calc-tit' }, 'Con estas tablas, el trazado de esta cotización:'),
      h('ul', { class: 'm-calc-vent' }, c.sistema.resultados.ventiladores.map((v) => h('li', null,
        `Ventilador de ${nombre(v.equipo)}: ${W.num(v.caudal_m3_h, 0)} m³/h a ${W.num(v.presion_estatica_Pa, 0)} Pa, ${W.num(v.potencia_freno_kW, 2)} kW al freno, motor de ${v.motor_hp === null ? 'más de 500' : v.motor_hp} HP.`))),
      h('p', { class: 'nota' }, c.cambiadas.length ? `Tabla del taller: cambiada en ${c.cambiadas.join(', ')}.` : 'Tabla de referencia (ACGIH), sin cambios.'), ir);
  }

  /* ---- Catálogo de ventiladores: un modelo por tarjeta, con su curva editable (§5.13) ---- */
  const RUTA_VENT = ['ventiladores', 'modelos'];
  /** Aplica un cambio a una copia del catálogo; si queda bien, lo guarda (con deshacer) y vuelve a dibujar el panel. */
  function cambiarCatalogo(cambio, titulo) {
    const lista = U.clonar(W.estadoApp.M.ventiladores.modelos);
    cambio(lista);
    const r = C.ventiladores.revisarCatalogo(lista);
    if (!r.ok) { W.toast(`Valor no válido: ${r.errores[0]}`); refrescarVentiladores(); return false; }
    const ok = aplicarLote([[RUTA_VENT, lista]], titulo);
    if (!ok) refrescarVentiladores();
    return ok;
  }
  // al redibujar se quita el campo enfocado: su «blur» vuelve a disparar «change»; mientras se dibuja, se ignora
  let pintandoVent = false;
  function refrescarVentiladores() {
    const el = $('#m-vent');
    if (!el || pintandoVent) return;
    pintandoVent = true;
    try { el.replaceChildren(nodoVentiladores(W.estadoApp.M)); } finally { pintandoVent = false; }
    marcarCambios();
    aplicarBloqueo();
  }
  function tarjetaVentilador(m, i) {
    const nombre = m.nombre;
    const campo = (et, valor, tipo, alCambio, extra) => {
      const el = h('input', { type: tipo === 'num' ? 'number' : 'text', step: 'any', value: String(valor), 'aria-label': `${et} · ${nombre}`, class: 'm-vent-ctl', ...(extra || {}) });
      el.addEventListener('change', () => {
        if (pintandoVent) return;
        const v = tipo === 'num' ? Number(el.value) : el.value.trim();
        if (tipo === 'num' && (el.value === '' || !Number.isFinite(v))) { W.toast('Valor no válido: use un número'); el.value = String(valor); return; }
        alCambio(v);
      });
      return h('label', { class: 'm-vent-campo' }, h('span', null, et), el);
    };
    const poner = (k, et) => (v) => cambiarCatalogo((l) => { l[i][k] = v; }, `${nombre}: ${et}`);
    const ilus = h('input', { type: 'checkbox', checked: !!m.ilustrativo, 'aria-label': `Ilustrativo · ${nombre}` });
    ilus.addEventListener('change', () => !pintandoVent && cambiarCatalogo((l) => { l[i].ilustrativo = ilus.checked; }, `${nombre}: ${ilus.checked ? 'marcado' : 'ya no'} ilustrativo`));
    const celda = (j, c, et) => {
      const el = h('input', { type: 'number', step: 'any', value: String(m.curva[j][c]), 'aria-label': `${et} del punto ${j + 1} · ${nombre}`, class: 'm-vent-ctl' });
      el.addEventListener('change', () => {
        if (pintandoVent) return;
        const v = Number(el.value);
        if (el.value === '' || !Number.isFinite(v)) { W.toast('Valor no válido: use un número'); el.value = String(m.curva[j][c]); return; }
        cambiarCatalogo((l) => { l[i].curva[j][c] = v; }, `${nombre}: ${et} del punto ${j + 1}`);
      });
      return h('td', null, el);
    };
    const quitarPunto = (j) => h('td', null, h('button', { type: 'button', class: 'btn btn-sec btn-chico m-vent-quitar-punto', 'aria-label': `Quitar el punto ${j + 1} · ${nombre}`, onclick: () => cambiarCatalogo((l) => { l[i].curva.splice(j, 1); }, `${nombre}: sin el punto ${j + 1}`) }, '×'));
    const ultimo = m.curva[m.curva.length - 1];
    const buscar = `ventiladores modelos catálogo curva rpm ${m.id} ${m.nombre} ${m.notas || ''}`.toLowerCase();
    return h('div', { class: 'm-tabla m-vent-modelo', dataset: { buscar, tabla: llave(RUTA_VENT), modelo: m.id } },
      h('div', { class: 'm-tabla-tit' }, h('span', null, m.nombre), m.ilustrativo ? h('span', { class: 'm-chip m-chip-ilustrativo', title: 'Curva inventada para mostrar cómo se elige: no es de un fabricante' }, 'Ilustrativo') : null),
      h('div', { class: 'm-vent-campos' },
        campo('Nombre', m.nombre, 'txt', poner('nombre', 'nombre')),
        campo('Clave', m.id, 'txt', poner('id', 'clave')),
        campo('rpm de la curva', m.rpm, 'num', poner('rpm', 'rpm de la curva')),
        campo('rpm mínima', m.rpm_min, 'num', poner('rpm_min', 'rpm mínima')),
        campo('rpm máxima', m.rpm_max, 'num', poner('rpm_max', 'rpm máxima')),
        campo('Notas', m.notas || '', 'txt', poner('notas', 'notas')),
        h('label', { class: 'm-vent-campo m-vent-check' }, ilus, h('span', null, 'Ilustrativo (curva de ejemplo)'))),
      h('div', { class: 'tabla-env' }, h('table', { class: 'tabla m-vent-curva' },
        h('thead', null, h('tr', null, A.COLUMNAS_VENTILADORES.map((c) => h('th', { scope: 'col' }, c)), h('th', null, ''))),
        h('tbody', null, m.curva.map((p, j) => h('tr', null, celda(j, 0, 'Caudal'), celda(j, 1, 'Presión estática'), celda(j, 2, 'Potencia'), m.curva.length > 3 ? quitarPunto(j) : h('td', null)))))),
      h('div', { class: 'm-vent-acciones' },
        h('button', { type: 'button', class: 'btn btn-sec btn-chico m-vent-punto', onclick: () => cambiarCatalogo((l) => { l[i].curva.push([Math.round(ultimo[0] * 1.2 + 100), Math.round(ultimo[1] * 0.8), ultimo[2]]); }, `${nombre}: un punto más`) }, '+ Punto'),
        h('button', { type: 'button', class: 'btn btn-peligro btn-chico m-vent-quitar', onclick: () => cambiarCatalogo((l) => { l.splice(i, 1); }, `Se quitó ${nombre}`) }, 'Quitar el modelo')));
  }
  function nodoVentiladores(M) {
    const lista = M.ventiladores.modelos;
    const nuevo = () => {
      let n = lista.length + 1;
      while (lista.some((x) => x.id === `MODELO_${n}`)) n += 1;
      // una plantilla marcada como ilustrativa hasta que se capture la curva del proveedor
      cambiarCatalogo((l) => l.push({ id: `MODELO_${n}`, nombre: `Modelo ${n} (capture su curva)`, ilustrativo: true, notas: 'Plantilla: capture la curva del proveedor y quite la marca de ilustrativo.', rpm: 1750, rpm_min: 1750, rpm_max: 1750,
        curva: [[0, 1000, 0], [1000, 900, 0], [2000, 600, 0]] }), `Modelo ${n} agregado`);
    };
    return h('div', { class: 'm-obj' },
      h('div', { class: 'm-calc-trazo', id: 'm-vent-trazo', 'aria-live': 'polite' }, h('p', { class: 'nota' }, C.trazadoTablero.efectoCatalogo(W.estadoApp.cot && W.estadoApp.cot.trazado_iso, M).txt)),
      encabezadoTabla(RUTA_VENT), // una sola ⓘ para la tabla: cada tarjeta es un modelo de ella
      lista.length ? lista.map(tarjetaVentilador) : h('p', { class: 'nota', id: 'm-vent-vacio' }, 'Sin modelos: agregue los del catálogo de su proveedor.'),
      h('div', { class: 'm-vent-acciones' }, h('button', { type: 'button', class: 'btn btn-sec', id: 'm-vent-agregar', onclick: nuevo }, '+ Modelo')),
      h('p', { class: 'nota' }, 'Cada curva va como la da el fabricante a sus rpm, en aire estándar (1.2 kg/m³): caudal creciente, presión estática y potencia al freno (0 si no la trae). La salida del trazado mueve la curva a otras rpm con las leyes del ventilador y elige.'));
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
  const soloLectura = () => !!(ultimoEstado.info && ultimoEstado.info.soloLectura);

  /** En sólo lectura (o sin poder guardar) los campos se muestran pero no se editan. */
  function aplicarBloqueo() {
    const bloquear = soloLectura();
    $$('#maestros-cuerpo input, #maestros-cuerpo select').forEach((i) => { i.disabled = bloquear; });
    const reset = $('#maestros-reset');
    if (reset) reset.disabled = bloquear;
    const deshacer = $('#maestros-deshacer');
    if (deshacer) deshacer.disabled = bloquear;
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

  /* ---- Marcas: lo modificado, lo que sale del rango usual, y el resumen del encabezado ---- */
  const visto = (ruta, v) => (typeof v === 'number' ? A.mostrado(ruta, v) : v);

  function marcarCambios() {
    const M = W.estadoApp.M;
    controles.forEach((el, k) => {
      const ruta = JSON.parse(k);
      const mod = cambiado(ruta);
      el.dataset.mod = mod ? '1' : '';
      const f = el.closest('.m-fila');
      if (f) f.dataset.mod = mod ? '1' : '';
      const ay = ayudas.get(k);
      const fuera = ay ? A.fueraDeRango(ay, visto(ruta, leer(M, ruta))) : 0;
      el.dataset.rango = fuera ? (fuera > 0 ? 'alto' : 'bajo') : '';
      if (f) f.dataset.rango = el.dataset.rango;
      if (ay && ay.tip) el.title = fuera ? `Fuera del rango usual (${fmt(ay.tip[0])} a ${fmt(ay.tip[1])}). Puede ser correcto: confírmelo.` : '';
    });
    $$('#maestros-cuerpo .m-tabla').forEach((t) => { t.dataset.mod = cambiado(JSON.parse(t.dataset.tabla)) ? '1' : ''; });
    let total = 0;
    $$('#maestros-cuerpo .m-grupo').forEach((g) => {
      const n = contarCambios(baseM()[g.dataset.grupo], M[g.dataset.grupo]);
      total += n;
      g.dataset.mod = n ? '1' : '';
      const ins = $('.m-grupo-mod', g);
      if (ins) { ins.hidden = !n; ins.textContent = `${n} ${n === 1 ? 'modificado' : 'modificados'}`; }
    });
    const btn = $('#maestros-solo-mod');
    if (btn) { btn.textContent = `Sólo modificados (${total})`; btn.disabled = false; }
  }

  /* ---- Cada cambio deja su efecto en la cotización, y se puede deshacer ---- */
  const historial = []; // { titulo, hechos: [[ruta, antes, despues]], efecto }
  const textoValor = (ruta, v) => {
    if (typeof v === 'number') { const un = unidadDe(ruta); return `${fmt(A.mostrado(ruta, v))}${un ? ` ${un}` : ''}`; }
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    return v === null ? '(vacío)' : String(v);
  };
  const resumenTotal = () => { const t = W.estadoApp.res.totales; return { ok: t.n_partidas_ok > 0, sub: t.subtotal_neto, total: t.total, err: t.n_partidas_error }; };

  function pintarControl(ruta, valor) {
    const el = controles.get(llave(ruta));
    if (!el) return;
    const tipo = el.dataset.tipo;
    el.value = tipo === 'pct' ? String(Number((valor * 100).toFixed(6))) : tipo === 'nul' ? (valor === null ? '' : String(valor)) : String(valor);
  }

  function valorInvalido(ruta, v) {
    if (typeof v !== 'number') return null;
    if (!Number.isFinite(v) || v < 0) return 'Valor no válido: use un número, 0 o mayor';
    if (ruta[0] === 'merma' && v >= 1) return 'Valor no válido: la merma debe ser menor que 100 %';
    if (C.validacion.exigePositivo(ruta) && v <= 0) return 'Valor no válido: este dato debe ser mayor que 0';
    const calc = C.perdidas.fueraDeLimite(ruta, v);
    if (calc) return `Valor no válido: ${calc.charAt(0).toLowerCase()}${calc.slice(1)}`;
    return null;
  }

  function mostrarUltimo() {
    const barra = $('#maestros-ultimo');
    if (!barra) return;
    const u = historial[historial.length - 1];
    barra.hidden = !u;
    if (!u) return;
    const e = u.efecto;
    $('.m-ultimo-tit', barra).textContent = u.titulo;
    const el = $('.m-ultimo-efecto', barra);
    el.className = `m-ultimo-efecto m-efecto-${e.clase}`;
    el.textContent = e.clase === 'neutro' ? '' : `${e.clase === 'sube' ? '▲ ' : e.clase === 'baja' ? '▼ ' : e.clase === 'mal' ? '⚠ ' : ''}${e.txt}`;
    const des = $('#maestros-deshacer', barra);
    des.textContent = historial.length > 1 ? `Deshacer (${historial.length})` : 'Deshacer';
    des.disabled = soloLectura();
  }

  /**
   * Aplica varios cambios [[ruta, valor], …] como uno solo: valida, escribe en las tablas y en los campos, recalcula una vez y deja la barra
   * «Último cambio». Lo usan los campos (al teclear), la ayuda («Aplicar», «Usar», ajuste de golpe) y «Deshacer».
   */
  function aplicarLote(cambios, titulo, opciones) {
    const estado = W.estadoApp;
    if (soloLectura()) { W.toast('Sólo lectura: las tablas las cambia el propietario o un editor del artefacto'); return false; }
    const hechos = [];
    for (let i = 0; i < cambios.length; i += 1) {
      const [ruta, valor] = cambios[i];
      const mal = valorInvalido(ruta, valor);
      if (mal) { W.toast(mal); return false; }
    }
    const antes = resumenTotal();
    // Lo del cálculo de la red no mueve el precio: su efecto es el del ventilador del trazado (el catálogo, los modelos que le sirven)
    const soloCalculo = cambios.every(([ruta]) => ruta[0] === 'calculo');
    const soloCatalogo = cambios.every(([ruta]) => ruta[0] === 'ventiladores');
    const Mantes = soloCalculo ? U.clonar(estado.M) : null;
    cambios.forEach(([ruta, valor]) => {
      const previo = leer(estado.M, ruta);
      if (U.igual(previo, valor)) return;
      aplicar(ruta, valor);
      hechos.push([ruta, previo, valor]);
      pintarControl(ruta, valor);
    });
    if (!hechos.length) return true;
    estado.M.meta.editado = true;
    refrescarProveedor();
    marcarCambios();
    W.recalcular(); // guarda y recalcula la cotización
    const efecto = soloCalculo ? C.trazadoTablero.efectoEnTrazo(estado.cot && estado.cot.trazado_iso, Mantes, estado.M)
      : soloCatalogo ? C.trazadoTablero.efectoCatalogo(estado.cot && estado.cot.trazado_iso, estado.M) : W.ayudaUI.describir(antes, resumenTotal());
    refrescarCalculo();
    if (hechos.some(([r]) => r[0] === 'ventiladores')) refrescarVentiladores();
    if (opciones && opciones.deshaciendo) historial.pop();
    else {
      const unico = hechos.length === 1 ? hechos[0] : null;
      const ay = unico ? A.buscar(unico[0]) : null;
      historial.push({
        titulo: titulo || (unico ? `${ay ? ay.t : A.etiqueta(unico[0][unico[0].length - 1])}: ${textoValor(unico[0], unico[1])} → ${textoValor(unico[0], unico[2])}` : `${hechos.length} datos cambiados`),
        hechos, efecto,
      });
      if (historial.length > 50) historial.shift();
    }
    mostrarUltimo();
    if (W.ayudaUI) W.ayudaUI.refrescar();
    return true;
  }

  function deshacer() {
    const u = historial[historial.length - 1];
    if (!u) return;
    aplicarLote(u.hechos.map(([ruta, antes]) => [ruta, antes]), null, { deshaciendo: true });
    const sig = historial[historial.length - 1];
    if (!sig) $('#maestros-ultimo').hidden = true;
    W.toast('Cambio deshecho');
  }

  let filtroSoloMod = false; // «Sólo modificados» activo

  /* ---- Ir a un dato (desde el ranking, la guía o la ayuda) ---- */
  function irA(ruta) {
    if (W.estadoApp.tab !== 'maestros') $('#tab-maestros').click();
    const q = $('#maestros-buscar');
    const lleno = (q.value || '').trim() !== '' || filtroSoloMod;
    const destino = () => {
      const k = llave(ruta);
      const campo = controles.get(k);
      if (campo) return campo.closest('.m-fila') || campo.closest('.m-tabla') || campo;
      const tabla = $$('#maestros-cuerpo .m-tabla').find((t) => t.dataset.tabla === k);
      if (tabla) return tabla;
      if (ruta.length === 1) return $(`#maestros-cuerpo .m-grupo[data-grupo="${ruta[0]}"]`);
      return null;
    };
    let el = destino();
    if (el && (el.closest('[hidden]') || lleno)) {
      q.value = '';
      filtroSoloMod = false;
      sincronizarFiltro();
      filtrar();
      el = destino();
    }
    if (!el) return;
    for (let d = el.closest('details') || (el.matches && el.matches('details') ? el : null); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    const grupo = el.closest('.m-grupo') || el;
    if (grupo.matches && grupo.matches('details')) grupo.open = true;
    el.scrollIntoView({ block: 'center', behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('m-destello');
    void el.offsetWidth; // reinicia la animación si ya estaba puesta
    el.classList.add('m-destello');
    setTimeout(() => el.classList.remove('m-destello'), 2200);
    const campo = $('input, select', el);
    if (campo && !campo.disabled) campo.focus({ preventScroll: true });
  }

  /* ---- Dibujo del editor ---- */
  function render() {
    const M = W.estadoApp.M;
    const cont = $('#maestros-cuerpo');
    if (W.ayudaUI) W.ayudaUI.cerrar(false);
    controles = new Map();
    ayudas = new Map();
    cont.replaceChildren(...GRUPOS.map(([clave, titulo, nota]) => {
      const ay = A.buscar([clave]);
      return h('details', { class: 'm-grupo', dataset: { grupo: clave } },
        h('summary', null,
          h('span', { class: 'm-grupo-tit' }, titulo),
          ay && ay.origen ? h('span', { class: `m-chip m-chip-${ay.origen}`, title: ay.origenTxt }, A.ORIGENES[ay.origen]) : null,
          h('span', { class: 'm-grupo-mod', hidden: true }),
          W.ayudaUI.boton([clave], 'grupo'),
          h('span', { class: 'm-grupo-nota' }, nota)),
        h('div', { class: 'm-grupo-cuerpo' }, clave === 'proveedor' ? nodoProveedor(M) : clave === 'calculo' ? nodoCalculo(M) : clave === 'ventiladores' ? h('div', { id: 'm-vent' }, nodoVentiladores(M)) : nodo(M[clave], [clave])));
    }));
    marcarCambios();
    refrescarCalculo();
    filtrar();
    aplicarBloqueo();
  }

  function sincronizarFiltro() {
    const b = $('#maestros-solo-mod');
    if (b) b.setAttribute('aria-pressed', String(filtroSoloMod));
  }

  function filtrar() {
    const q = ($('#maestros-buscar').value || '').trim().toLowerCase();
    const activo = q !== '' || filtroSoloMod;
    $$('#maestros-cuerpo .m-grupo').forEach((g) => {
      let visibles = 0;
      $$('.m-fila, .m-tabla', g).forEach((f) => {
        const ok = (!q || f.dataset.buscar.includes(q) || (g.dataset.grupo || '').includes(q)) && (!filtroSoloMod || f.dataset.mod === '1');
        f.hidden = !ok;
        if (ok) visibles += 1;
      });
      g.hidden = activo && visibles === 0;
      if (activo) g.open = visibles > 0;
      // Un subgrupo sin ningún renglón que coincida no se deja como un encabezado vacío
      $$('.m-sub', g).forEach((s) => {
        s.hidden = activo && !$('.m-fila:not([hidden]), .m-tabla:not([hidden])', s);
        if (activo) s.open = true;
      });
    });
    const sin = $('#maestros-sin-resultados');
    if (sin) sin.hidden = !activo || $$('#maestros-cuerpo .m-grupo').some((g) => !g.hidden);
  }

  function alCambiar(ev) {
    const el = ev.target;
    if (!el.dataset || !el.dataset.ruta) return;
    const ruta = JSON.parse(el.dataset.ruta);
    const tipo = el.dataset.tipo;
    const estado = W.estadoApp;
    let valor;
    if (tipo === 'txt') valor = el.value;
    else if (tipo === 'bool') valor = el.value === 'true';
    else if (tipo === 'nul') valor = el.value === '' ? null : el.value;
    else {
      const n = Number(el.value);
      // Qué celdas no admiten cero lo dice el motor (validacion.js): la misma lista con la que calcula; una merma es menos de 100 %
      const masDelTope = ruta[0] === 'merma' && n >= 100;
      if (el.value === '' || !Number.isFinite(n) || n < 0 || masDelTope || (C.validacion.exigePositivo(ruta) && n <= 0)) {
        el.value = String(tipo === 'pct' ? Number((leer(estado.M, ruta) * 100).toFixed(6)) : leer(estado.M, ruta));
        W.toast(masDelTope ? 'Valor no válido: la merma debe ser menor que 100 %' : C.validacion.exigePositivo(ruta) ? 'Valor no válido: este dato debe ser mayor que 0' : 'Valor no válido: use un número, 0 o mayor');
        return;
      }
      valor = tipo === 'pct' ? n / 100 : n;
      const calc = C.perdidas.fueraDeLimite(ruta, valor);
      if (calc) {
        el.value = String(leer(estado.M, ruta));
        W.toast(`Valor no válido: ${calc.charAt(0).toLowerCase()}${calc.slice(1)}`);
        return;
      }
    }
    // Una celda de una tabla de ejes fijos trae su nombre («Codo de 5 gajos a R/D 1.5»): con él se titula el cambio
    const titulo = el.dataset.titulo ? `${el.dataset.titulo}: ${textoValor(ruta, leer(estado.M, ruta))} → ${textoValor(ruta, valor)}` : undefined;
    aplicarLote([[ruta, valor]], titulo);
  }

  let enlazado = false;
  W.maestrosUI = {
    mostrarGuardado,
    opcionesDe,
    aplicarLote,
    irA,
    valorBase: (ruta) => leer(baseM(), ruta),
    esModificado: (ruta) => cambiado(ruta),
    render() {
      if (!enlazado) {
        enlazado = true;
        $('#maestros-cuerpo').addEventListener('change', alCambiar);
        W.ayudaUI.enlazar($('#maestros-cuerpo'));
        $('#maestros-buscar').addEventListener('input', filtrar);
        $('#maestros-guia').addEventListener('click', () => W.ayudaUI.abrirGuia());
        $('#maestros-ranking').addEventListener('click', () => W.ayudaUI.abrirRanking());
        $('#maestros-solo-mod').addEventListener('click', () => { filtroSoloMod = !filtroSoloMod; sincronizarFiltro(); filtrar(); });
        $('#maestros-deshacer').addEventListener('click', deshacer);
        $('#maestros-ultimo-cerrar').addEventListener('click', () => { $('#maestros-ultimo').hidden = true; });
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
          historial.length = 0;
          $('#maestros-ultimo').hidden = true;
          W.recalcular();
          render();
          W.toast('Tablas maestras restablecidas');
        });
      }
      render();
    },
  };
}(typeof self !== 'undefined' ? self : this));
