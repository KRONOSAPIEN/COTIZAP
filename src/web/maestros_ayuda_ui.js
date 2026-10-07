/**
 * COTIZAP · web/maestros_ayuda_ui.js — Ayuda de las tablas maestras: ventana emergente (ⓘ), «¿Y si…?», guía rápida y
 * ranking de lo que más mueve el precio.
 *
 * Los textos salen de datos/ayuda_maestros.js. Lo que depende de la cotización abierta se calcula cotizándola de nuevo con
 * una COPIA de las tablas (W.cotizarCon): probar un valor nunca toca lo que el usuario tiene guardado. Para aplicar un valor
 * se usa el editor (W.maestrosUI.aplicarLote), que valida igual que al teclear, recalcula y deja «Deshacer».
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

  const TIPOS = { fila: 'Dato', sub: 'Sección', tabla: 'Tabla', grupo: 'Grupo' };
  const FACTOR_PRUEBA = 0.1; // «¿y si sube 10 %?»

  /* ---------------- Acceso a las tablas ---------------- */
  const leer = (M, ruta) => ruta.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), M);
  const escribir = (M, ruta, v) => { leer(M, ruta.slice(0, -1))[ruta[ruta.length - 1]] = v; };
  const reducida = (x) => Number(Number(x).toFixed(4));
  const fmt = (x) => Number(x).toLocaleString('es-MX', { maximumFractionDigits: 4 });
  const nombreRuta = (ruta) => ruta.map((k) => (typeof k === 'number' ? `#${k + 1}` : String(k).replace(/_/g, ' '))).join(' › ');

  /* ---------------- ¿Y si…? Cotizar con una copia modificada de las tablas ---------------- */
  const resumen = (r) => ({ ok: r.totales.n_partidas_ok > 0, sub: r.totales.subtotal_neto, total: r.totales.total, err: r.totales.n_partidas_error });
  const ahora = () => resumen(W.estadoApp.res);
  function conCambio(cambiar) {
    const M = U.clonar(W.estadoApp.M);
    try {
      cambiar(M);
      return resumen(W.cotizarCon(M));
    } catch (err) {
      return null; // un valor que el motor no acepta
    }
  }
  const signo = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');

  /** Texto y clase del efecto de pasar de la cotización actual `a` a `b`. */
  function describir(a, b) {
    if (!a.ok) return { txt: 'Agregue partidas a la cotización para ver aquí cuánto mueve este dato.', clase: 'neutro' };
    if (!b) return { txt: 'Con ese valor la cotización no se puede calcular.', clase: 'mal' };
    if (b.err > a.err) return { txt: 'Con ese valor alguna partida ya no se podría calcular.', clase: 'mal' };
    const d = b.sub - a.sub;
    if (Math.abs(d) < 0.005) return { txt: 'Sin cambio en esta cotización: ninguna de sus partidas usa este dato (o su efecto es menor a un centavo).', clase: 'igual', d: 0, pct: 0 };
    const pct = a.sub ? d / a.sub : 0;
    return { txt: `${W.mxn(a.sub)} → ${W.mxn(b.sub)}  (${signo(d)}${W.mxn(Math.abs(d))} · ${signo(d)}${W.pct(Math.abs(pct), 2)})`, clase: d > 0 ? 'sube' : 'baja', d, pct };
  }
  const lineaEfecto = (e) => h('div', { class: `m-efecto m-efecto-${e.clase}` }, e.clase === 'sube' ? '▲ ' : e.clase === 'baja' ? '▼ ' : e.clase === 'mal' ? '⚠ ' : '', e.txt);

  /* ---------------- Ventana emergente ---------------- */
  let pop = null;
  let abierta = null; // { ruta, tipo, ancla }

  const chip = (txt, clase, titulo) => h('span', { class: `m-chip ${clase || ''}`, title: titulo || null }, txt);
  const seccion = (titulo, ...hijos) => h('section', { class: 'm-pop-sec' }, h('h4', null, titulo), ...hijos);
  const parrafo = (txt, clase) => h('p', { class: clase || null }, txt);

  function barraRango(ay, vis, un) {
    const [a, b] = ay.tip;
    const fuera = A.fueraDeRango(ay, vis);
    const hueco = (b - a) * 0.25 || 1;
    const lo = Math.min(a - hueco, typeof vis === 'number' ? vis : a);
    const hi = Math.max(b + hueco, typeof vis === 'number' ? vis : b);
    const pos = (x) => `${(((x - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    return h('div', { class: 'm-rango' },
      h('div', { class: 'm-rango-barra', role: 'img', 'aria-label': `Rango usual de ${fmt(a)} a ${fmt(b)}${un ? ` ${un}` : ''}; su valor ${fmt(vis)}` },
        h('span', { class: 'm-rango-zona', style: `left:${pos(a)};width:calc(${pos(b)} - ${pos(a)})` }),
        typeof vis === 'number' ? h('span', { class: `m-rango-marca ${fuera ? 'fuera' : ''}`, style: `left:${pos(vis)}` }) : null),
      h('div', { class: 'm-rango-txt' }, `Rango usual: ${fmt(a)} – ${fmt(b)}${un ? ` ${un}` : ''}`,
        fuera ? h('strong', { class: 'm-rango-aviso' }, fuera > 0 ? ' · su valor está por encima: revíselo (puede ser correcto, pero es poco común)' : ' · su valor está por debajo: revíselo (puede ser correcto, pero es poco común)') : null));
  }

  /** Efecto compacto de un resultado de `describir` («▲ +$65.56 · +0.17 %»). */
  function efectoCompacto(e) {
    if (e.clase === 'mal' || e.clase === 'neutro') return h('span', { class: `m-efecto m-efecto-${e.clase}` }, e.txt);
    if (e.clase === 'igual') return h('span', { class: 'm-efecto m-efecto-igual' }, 'sin cambio');
    return h('span', { class: `m-efecto m-efecto-${e.clase}` }, `${e.clase === 'sube' ? '▲' : '▼'} ${signo(e.d)}${W.mxn(Math.abs(e.d))} · ${signo(e.d)}${W.pct(Math.abs(e.pct), 2)}`);
  }

  /** Lo primero que se ve al abrir la ayuda de un número: cuánto movería la cotización abierta si bajara o subiera 10 %. */
  function sensibilidad(ruta, actual) {
    const base = ahora();
    if (!base.ok) return parrafo('Agregue partidas a la cotización para ver aquí cuánto mueve este dato.', 'm-ayuda-suave');
    if (!(actual > 0)) return null;
    const un = A.unidadDe(ruta);
    const linea = (f, rotulo) => {
      const v = reducida(actual * f);
      const e = describir(base, conCambio((Mc) => escribir(Mc, ruta, v)));
      return { e, fila: h('li', null, h('span', { class: 'm-sens-et' }, `${rotulo} (${fmt(A.mostrado(ruta, v))}${un ? ` ${un}` : ''})`), efectoCompacto(e)) };
    };
    const baja = linea(0.9, 'Si baja 10 %');
    const sube = linea(1.1, 'Si sube 10 %');
    if (Math.abs(baja.e.d || 0) < 0.005 && Math.abs(sube.e.d || 0) < 0.005 && baja.e.clase !== 'mal' && sube.e.clase !== 'mal') {
      return parrafo('Esta cotización no usa este dato (o su efecto es menor a un centavo), así que cambiarlo no la mueve.', 'm-ayuda-suave');
    }
    return h('ul', { class: 'm-sens', 'aria-label': 'Efecto en la cotización abierta' }, baja.fila, sube.fila);
  }

  /* — «¿Y si…?» para un número — */
  function simuladorNumero(ruta) {
    const M = W.estadoApp.M;
    const actual = leer(M, ruta);
    const un = A.unidadDe(ruta);
    const pct = A.esPct(ruta);
    const aAlm = (v) => (pct ? v / 100 : v);
    const entrada = h('input', { type: 'number', step: 'any', value: String(A.mostrado(ruta, actual)), 'aria-label': 'Valor a probar', class: 'm-sim-in' });
    const efecto = h('div', { class: 'm-sim-res', 'aria-live': 'polite' });
    const btnAplicar = h('button', { type: 'button', class: 'btn btn-primario btn-chico' }, 'Aplicar este valor');
    let temporizador = null;
    const valido = () => {
      const n = Number(entrada.value);
      if (entrada.value === '' || !Number.isFinite(n) || n < 0) return 'Use un número, 0 o mayor.';
      if (ruta[0] === 'merma' && n >= 100) return 'La merma debe ser menor que 100 %.';
      if (C.validacion.exigePositivo(ruta) && n <= 0) return 'Este dato debe ser mayor que 0.';
      return null;
    };
    const actualizar = () => {
      const mal = valido();
      const igualAlActual = Number(entrada.value) === A.mostrado(ruta, leer(W.estadoApp.M, ruta));
      btnAplicar.disabled = !!mal || igualAlActual;
      if (mal) { efecto.replaceChildren(h('div', { class: 'm-efecto m-efecto-mal' }, `⚠ ${mal}`)); return; }
      if (igualAlActual) { efecto.replaceChildren(h('div', { class: 'm-ayuda-suave' }, 'Escriba otro valor, o use −10 % / +10 %, para ver cuánto cambiaría su cotización.')); return; }
      const v = aAlm(Number(entrada.value));
      efecto.replaceChildren(lineaEfecto(describir(ahora(), conCambio((Mc) => escribir(Mc, ruta, v)))));
    };
    entrada.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(actualizar, 60); });
    const factor = (f) => () => { entrada.value = String(reducida(A.mostrado(ruta, actual) * f)); actualizar(); };
    btnAplicar.addEventListener('click', () => {
      const mal = valido();
      if (mal) return;
      W.maestrosUI.aplicarLote([[ruta, aAlm(Number(entrada.value))]]);
      refrescar();
    });
    setTimeout(actualizar, 0);
    return seccion('Con su cotización',
      sensibilidad(ruta, actual),
      h('div', { class: 'm-sim' },
        h('div', { class: 'm-sim-fila' },
          h('label', null, 'Probar otro valor ', entrada, un ? h('span', { class: 'm-sim-un' }, un) : null),
          h('div', { class: 'm-sim-rap' },
            h('button', { type: 'button', class: 'btn-texto', onclick: factor(0.9) }, '−10 %'),
            h('button', { type: 'button', class: 'btn-texto', onclick: factor(1.1) }, '+10 %'),
            h('button', { type: 'button', class: 'btn-texto', onclick: factor(1) }, 'Valor actual'))),
        efecto,
        h('div', { class: 'm-sim-acc' }, btnAplicar)));
  }

  /* — Comparar las opciones de una lista — */
  function comparadorOpciones(ruta, ay) {
    const M = W.estadoApp.M;
    const actual = leer(M, ruta);
    const ops = W.maestrosUI.opcionesDe(ruta, actual);
    if (!ops) return null;
    const lista = ops.filter(([v]) => v !== null && v !== undefined);
    const clave = (v) => (v === null ? '' : String(v));
    const clavActual = clave(actual);
    const valorDe = (v) => (typeof actual === 'boolean' ? v === 'true' : v === '' ? null : v);
    const base = ahora();
    // Un enlace al precio al que apunta la variable (las referencias a «Precios»)
    if (typeof actual === 'string' && lista.length > 8 && M.precios && Object.prototype.hasOwnProperty.call(M.precios, actual)) {
      const un = A.unidadDe(['precios', actual]);
      return seccion('A qué precio apunta',
        h('p', null, `Ahora apunta a «${actual}»: `, h('strong', null, `${fmt(M.precios[actual])}${un ? ` ${un}` : ''}`), '.'),
        h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => { cerrar(); W.maestrosUI.irA(['precios', actual]); } }, 'Ir a ese precio'));
    }
    if (lista.length < 2 || lista.length > 6) return null;
    if (!base.ok) return seccion('Compare las opciones', parrafo('Agregue partidas a la cotización para ver aquí cuánto cambia el precio con cada opción.', 'm-ayuda-suave'));
    const filas = lista.map(([v, txt]) => {
      const e = describir(base, conCambio((Mc) => escribir(Mc, ruta, valorDe(String(v)))));
      const esActual = clave(v) === clavActual;
      const desc = ay.opc && Object.prototype.hasOwnProperty.call(ay.opc, clave(v)) ? ay.opc[clave(v)] : null;
      return h('li', { class: `m-comp-op ${esActual ? 'actual' : ''}` },
        h('div', { class: 'm-comp-cab' }, h('strong', null, txt), esActual ? chip('Ahora', 'm-chip-ok') : null),
        desc ? h('div', { class: 'm-ayuda-suave' }, desc) : null,
        esActual ? null : h('div', { class: 'm-comp-pie' }, lineaEfecto(e),
          h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => { W.maestrosUI.aplicarLote([[ruta, valorDe(String(v))]]); refrescar(); } }, 'Usar')));
    });
    return seccion('Compare las opciones con su cotización', h('ul', { class: 'm-comp' }, filas));
  }

  /* — Ajuste porcentual de varios valores a la vez — */
  function masivosDe(ruta, M) {
    const k = ruta.join('.');
    const hojas = (tabla) => Object.keys(leer(M, tabla) || {}).map((id) => [...tabla, id, 'precio']);
    if (k === 'proveedor.hojas') return { rutas: hojas(ruta), que: 'precios de las hojas', todos: 'todos los precios de las hojas', ejemplo: 'El proveedor subió 6 % la lámina → escriba 6.' };
    if (k === 'proveedor.barras') return { rutas: hojas(ruta), que: 'precios de las barras', todos: 'todos los precios de las barras', ejemplo: 'El proveedor subió 6 % los perfiles → escriba 6.' };
    if (k === 'precios') return { rutas: Object.keys(M.precios).map((c) => ['precios', c]), que: 'precios', todos: 'todos los precios de esta lista', ejemplo: 'Todo subió 5 % → escriba 5.' };
    if (k === 'mano_obra') return { rutas: Object.keys(M.mano_obra.operaciones).map((o) => ['mano_obra', 'operaciones', o, 'salario_hora']), que: 'salarios por hora', todos: 'todos los salarios por hora', ejemplo: 'Aumento de salario de 4 % → escriba 4.' };
    const t = leer(M, ruta);
    if (Array.isArray(t) && t.length && t.every((p) => Array.isArray(p) && p.length === 2) && /v_m_min/.test(k)) {
      return { rutas: t.map((_, i) => [...ruta, i, 1]), que: 'velocidades', todos: 'todas las velocidades de esta tabla', ejemplo: 'La máquina rinde 10 % más → escriba 10.' };
    }
    return null;
  }

  function ajusteMasivo(ruta) {
    const M = W.estadoApp.M;
    const m = masivosDe(ruta, M);
    if (!m) return null;
    const entrada = h('input', { type: 'number', step: 'any', value: '5', 'aria-label': 'Ajuste porcentual', class: 'm-sim-in' });
    const efecto = h('div', { class: 'm-sim-res', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn btn-primario btn-chico' }, 'Aplicar a todos');
    const cambios = () => {
      const p = Number(entrada.value);
      if (entrada.value === '' || !Number.isFinite(p) || p <= -100) return null;
      return m.rutas.map((r) => [r, reducida(leer(W.estadoApp.M, r) * (1 + p / 100))]).filter(([r, v]) => Number.isFinite(v) && v >= 0 && v !== leer(W.estadoApp.M, r));
    };
    const actualizar = () => {
      const c = cambios();
      btn.disabled = !c || !c.length;
      if (!c) { efecto.replaceChildren(h('div', { class: 'm-efecto m-efecto-mal' }, '⚠ Escriba un porcentaje (por ejemplo 5 o −3).')); return; }
      efecto.replaceChildren(h('div', { class: 'm-ayuda-suave' }, `${c.length} ${m.que} cambiarían.`),
        lineaEfecto(describir(ahora(), conCambio((Mc) => c.forEach(([r, v]) => escribir(Mc, r, v))))));
    };
    let t = null;
    entrada.addEventListener('input', () => { clearTimeout(t); t = setTimeout(actualizar, 60); });
    btn.addEventListener('click', () => {
      const c = cambios();
      if (!c || !c.length) return;
      W.maestrosUI.aplicarLote(c, `Ajuste de ${entrada.value} % a ${m.todos}`);
      refrescar();
    });
    setTimeout(actualizar, 0);
    return seccion('Ajustar todos de golpe',
      h('p', { class: 'm-ayuda-suave' }, `Cambia ${m.todos} en un porcentaje. ${m.ejemplo} Se puede deshacer.`),
      h('div', { class: 'm-sim' }, h('div', { class: 'm-sim-fila' }, h('label', null, 'Ajustar en ', entrada, h('span', { class: 'm-sim-un' }, '%'))), efecto, h('div', { class: 'm-sim-acc' }, btn)));
  }

  /* ---------------- Ranking: qué datos mueven más el precio ---------------- */
  function candidatos(prefijo) {
    const M = W.estadoApp.M;
    const salida = [];
    A.recorrer(M).forEach((u) => {
      if (prefijo && !prefijo.every((k, i) => String(u.ruta[i]) === String(k))) return;
      const v = leer(M, u.ruta);
      if (u.tipo === 'fila' && typeof v === 'number' && v !== 0) salida.push({ ruta: u.ruta, tipo: 'fila' });
      else if (u.tipo === 'tabla') {
        const k = u.ruta.join('.');
        if (k === 'proveedor.hojas' || k === 'proveedor.barras') salida.push({ ruta: u.ruta, tipo: 'tabla', prov: true });
        else if (Array.isArray(v) && v.length && v.every((p) => Array.isArray(p) && p.length === 2) && /v_m_min/.test(k)) salida.push({ ruta: u.ruta, tipo: 'tabla', pares: true });
      }
    });
    return salida;
  }
  function perturbar(M, c, f) {
    if (c.tipo === 'fila') escribir(M, c.ruta, leer(M, c.ruta) * f);
    else if (c.pares) leer(M, c.ruta).forEach((par) => { par[1] *= f; });
    else if (c.prov) { const t = leer(M, c.ruta); Object.keys(t).forEach((id) => { t[id].precio *= f; }); }
  }
  const tituloDe = (c) => {
    const ay = A.buscar(c.ruta);
    const t = ay ? ay.t : nombreRuta(c.ruta);
    return c.tipo === 'tabla' ? `Toda la tabla: ${t}` : t;
  };

  let vuelo = 0; // cancela un cálculo en curso si se abre otro
  /** Calcula cuánto cambia el precio si cada dato sube 10 %. Devuelve una promesa con la lista ordenada (o null si no hay partidas). */
  function ranking(prefijo, progreso) {
    const id = (vuelo += 1);
    const base = ahora();
    if (!base.ok) return Promise.resolve(null);
    const lista = candidatos(prefijo);
    const salida = [];
    return new Promise((resolver) => {
      let i = 0;
      const paso = () => {
        if (id !== vuelo) { resolver(undefined); return; }
        const fin = Math.min(lista.length, i + 12);
        for (; i < fin; i += 1) {
          const c = lista[i];
          const b = conCambio((M) => perturbar(M, c, 1 + FACTOR_PRUEBA));
          if (b && b.err <= base.err) {
            const d = b.sub - base.sub;
            if (Math.abs(d) >= 0.005) salida.push({ c, d, pct: base.sub ? d / base.sub : 0 });
          }
        }
        if (progreso) progreso(i, lista.length);
        if (i < lista.length) setTimeout(paso, 0);
        else resolver(salida.sort((x, y) => Math.abs(y.d) - Math.abs(x.d)));
      };
      paso();
    });
  }

  function filaRanking(r, maxD, alIr) {
    const ay = A.buscar(r.c.ruta);
    const ancho = Math.max(2, Math.round((Math.abs(r.d) / maxD) * 100));
    const v = r.c.tipo === 'fila' ? leer(W.estadoApp.M, r.c.ruta) : null;
    const un = r.c.tipo === 'fila' ? A.unidadDe(r.c.ruta) : '';
    return h('li', { class: 'm-rank-fila' },
      h('button', { type: 'button', class: 'm-rank-btn', onclick: () => alIr(r.c.ruta) },
        h('span', { class: 'm-rank-tit' }, tituloDe(r.c)),
        h('span', { class: 'm-rank-sub' }, ay && ay.ruta ? nombreRuta(r.c.ruta) : '', v !== null ? ` · ahora ${fmt(A.mostrado(r.c.ruta, v))}${un ? ` ${un}` : ''}` : ''),
        h('span', { class: 'm-rank-barra' }, h('span', { class: `m-rank-rel ${r.d > 0 ? 'sube' : 'baja'}`, style: `width:${ancho}%` })),
        h('span', { class: `m-rank-val ${r.d > 0 ? 'sube' : 'baja'}` }, `${signo(r.d)}${W.mxn(Math.abs(r.d))} · ${signo(r.d)}${W.pct(Math.abs(r.pct), 2)}`)));
  }

  /** Sección de la ventana: los datos de esta sección que más mueven el precio. */
  function masMueve(ruta) {
    const cuerpo = h('div', { class: 'm-rank-cuerpo' });
    const btn = h('button', { type: 'button', class: 'btn btn-sec btn-chico' }, 'Calcular qué mueve más el precio aquí');
    btn.addEventListener('click', () => {
      btn.disabled = true;
      cuerpo.replaceChildren(h('div', { class: 'm-ayuda-suave' }, 'Calculando…'));
      ranking(ruta, null).then((r) => {
        if (r === undefined || !abierta) return;
        if (r === null) { cuerpo.replaceChildren(parrafo('Agregue partidas a la cotización para ver esto.', 'm-ayuda-suave')); return; }
        if (!r.length) { cuerpo.replaceChildren(parrafo('Ningún dato de aquí cambia el precio de esta cotización.', 'm-ayuda-suave')); return; }
        const maxD = Math.abs(r[0].d);
        cuerpo.replaceChildren(h('p', { class: 'm-ayuda-suave' }, 'Cuánto cambia el precio si cada dato sube 10 %:'),
          h('ul', { class: 'm-rank' }, r.slice(0, 8).map((x) => filaRanking(x, maxD, (rt) => { cerrar(); W.maestrosUI.irA(rt); }))));
        colocar();
      });
    });
    return seccion('¿Qué mueve más el precio aquí?', btn, cuerpo);
  }

  /* ---------------- Contenido de la ventana ---------------- */
  function contenido(ruta, tipo) {
    const M = W.estadoApp.M;
    const ay = A.buscar(ruta) || { t: nombreRuta(ruta), que: 'Este dato no tiene explicación todavía.', como: '', efecto: '', afecta: [], tip: null, opc: null, cols: null };
    const v = tipo === 'fila' ? leer(M, ruta) : undefined;
    const vis = typeof v === 'number' ? A.mostrado(ruta, v) : null;
    const un = tipo === 'fila' ? A.unidadDe(ruta) : '';
    const modificado = W.maestrosUI.esModificado(ruta);
    const nodos = [];
    nodos.push(h('header', { class: 'm-pop-cab' },
      h('div', { class: 'm-pop-cab-tx' },
        h('h3', { id: 'm-pop-tit' }, ay.t),
        h('div', { class: 'm-pop-meta' },
          chip(TIPOS[tipo] || 'Dato', 'm-chip-tipo'),
          un ? chip(un, 'm-chip-un', 'Unidad en que se captura') : null,
          ay.origen ? chip(A.ORIGENES[ay.origen], `m-chip-${ay.origen}`, ay.origenTxt) : null,
          modificado ? chip('Modificado', 'm-chip-mod', 'Es distinto del valor de arranque') : null),
        h('code', { class: 'm-pop-ruta' }, nombreRuta(ruta))),
      h('button', { type: 'button', class: 'btn-icono m-pop-x', 'aria-label': 'Cerrar la ayuda', onclick: () => cerrar(true) }, W.icono('cerrar'))));
    const cuerpo = [];
    if (ay.origenTxt) cuerpo.push(parrafo(ay.origenTxt, `m-origen-txt m-origen-${ay.origen}`));
    cuerpo.push(seccion('¿Qué es?', parrafo(ay.que)));
    if (ay.como || ay.tip) {
      cuerpo.push(seccion('¿Cómo se llena?', ay.como ? parrafo(ay.como) : null,
        ay.esp ? parrafo(ay.esp, 'm-esp') : null,
        ay.tip && vis !== null ? barraRango(ay, vis, un) : null,
        ay.tip && vis === null ? parrafo(`Rango usual: ${fmt(ay.tip[0])} – ${fmt(ay.tip[1])}${un ? ` ${un}` : ''}`, 'm-ayuda-suave') : null));
    } else if (ay.esp) cuerpo.push(seccion('En este renglón', parrafo(ay.esp)));
    if (ay.efecto) cuerpo.push(seccion('¿Qué esperar al cambiarlo?', parrafo(ay.efecto)));
    if (ay.ej) cuerpo.push(seccion('Ejemplo', parrafo(ay.ej, 'm-ejemplo')));
    if (ay.ojo) cuerpo.push(h('div', { class: 'm-ojo', role: 'note' }, h('strong', null, 'Ojo: '), ay.ojo));
    if (ay.cols) {
      cuerpo.push(seccion('Qué significa cada columna', h('dl', { class: 'm-cols' }, Object.keys(ay.cols).flatMap((c) => [h('dt', null, c), h('dd', null, ay.cols[c])]))));
    }
    if (ay.afecta && ay.afecta.length) {
      cuerpo.push(h('div', { class: 'm-afecta' }, h('span', { class: 'm-afecta-et' }, 'Mueve:'), ay.afecta.map((k) => chip(A.AFECTA[k] || k, `m-chip-af m-af-${k}`))));
    }
    // Lo que sí depende de su cotización
    if (tipo === 'fila') {
      if (typeof v === 'number') cuerpo.push(simuladorNumero(ruta));
      else {
        const comp = comparadorOpciones(ruta, ay);
        if (comp) cuerpo.push(comp);
        else if (ay.opc) {
          cuerpo.push(seccion('Opciones', h('dl', { class: 'm-cols' }, Object.keys(ay.opc).flatMap((o) => [h('dt', null, o === '' ? '(vacío)' : o), h('dd', null, ay.opc[o])]))));
        }
      }
    } else {
      const masivo = ajusteMasivo(ruta);
      if (masivo) cuerpo.push(masivo);
      if (tipo === 'grupo' || tipo === 'sub') cuerpo.push(masMueve(ruta));
      else if (tipo === 'tabla' && masivo === null) { /* tablas de texto: sin simulación */ }
    }
    // Volver al valor de arranque
    const pie = [];
    if (tipo === 'fila' && modificado) {
      const baseV = W.maestrosUI.valorBase(ruta);
      pie.push(h('div', { class: 'm-pop-pie' },
        h('span', null, `Valor de arranque: `, h('strong', null, typeof baseV === 'number' ? `${fmt(A.mostrado(ruta, baseV))}${un ? ` ${un}` : ''}` : String(baseV === null ? '(vacío)' : baseV))),
        h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => { W.maestrosUI.aplicarLote([[ruta, baseV]], 'Valor de arranque'); refrescar(); } }, 'Volver al valor de arranque')));
    }
    nodos.push(h('div', { class: 'm-pop-cuerpo' }, cuerpo), ...pie);
    return nodos;
  }

  function colocar(traerAncla) {
    if (!pop || !abierta) return;
    const movil = root.matchMedia('(max-width: 640px)').matches;
    pop.classList.toggle('m-pop-hoja', movil);
    if (movil) { pop.style.cssText = ''; return; }
    const ancla = abierta.ancla;
    const vista = document.documentElement;
    const ancho = Math.min(420, vista.clientWidth - 24);
    pop.style.width = `${ancho}px`;
    pop.style.maxHeight = '640px';
    let r = ancla.getBoundingClientRect();
    const natural = pop.scrollHeight;
    // Si el contenido no cabe ni arriba ni abajo del ícono, se sube la página para dejarlo cerca del borde superior
    if (traerAncla && natural + 24 > root.innerHeight - r.bottom && natural + 24 > r.top && r.top > 110) {
      root.scrollBy(0, r.top - 100);
      r = ancla.getBoundingClientRect();
    }
    const abajo = root.innerHeight - r.bottom - 16;
    const arriba = r.top - 16;
    const haciaAbajo = abajo >= Math.min(natural, 360) || abajo >= arriba;
    pop.style.maxHeight = `${Math.max(200, Math.min(640, haciaAbajo ? abajo : arriba))}px`;
    let izq = r.left + root.scrollX - 8;
    izq = Math.max(root.scrollX + 12, Math.min(izq, root.scrollX + vista.clientWidth - ancho - 12));
    pop.style.left = `${izq}px`;
    const alto = pop.offsetHeight;
    pop.style.top = `${haciaAbajo ? r.bottom + root.scrollY + 8 : Math.max(root.scrollY + 8, r.top + root.scrollY - alto - 8)}px`;
  }

  function asegurarVentana() {
    if (pop) return;
    pop = h('div', { id: 'm-pop', class: 'm-pop', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'm-pop-tit', tabindex: '-1', hidden: true });
    document.body.append(pop);
    document.addEventListener('pointerdown', (ev) => {
      if (!abierta) return;
      if (pop.contains(ev.target) || abierta.ancla.contains(ev.target)) return;
      cerrar(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (!abierta) return;
      if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(true); return; }
      if (ev.key === 'Tab' && pop.contains(document.activeElement)) {
        const f = $$('button:not([disabled]), input:not([disabled]), [href]', pop);
        if (!f.length) return;
        const primero = f[0];
        const ultimo = f[f.length - 1];
        if (ev.shiftKey && (document.activeElement === primero || document.activeElement === pop)) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
      }
    }, true);
    root.addEventListener('resize', () => colocar(false));
  }

  /** Vuelve a dibujar la ventana abierta (el valor cambió) sin moverla. */
  function refrescar() {
    if (!abierta) return;
    const foco = document.activeElement;
    const dentro = pop.contains(foco);
    pop.replaceChildren(...contenido(abierta.ruta, abierta.tipo));
    colocar();
    if (dentro) pop.focus({ preventScroll: true });
  }

  function abrir(ruta, tipo, ancla) {
    asegurarVentana();
    if (abierta && abierta.ancla === ancla) { cerrar(true); return; }
    cerrar(false);
    abierta = { ruta, tipo, ancla };
    ancla.setAttribute('aria-expanded', 'true');
    pop.replaceChildren(...contenido(ruta, tipo));
    pop.hidden = false;
    colocar(true);
    pop.focus({ preventScroll: true });
  }

  function cerrar(devolverFoco) {
    if (!abierta) return;
    const { ancla } = abierta;
    ancla.setAttribute('aria-expanded', 'false');
    abierta = null;
    vuelo += 1;
    pop.hidden = true;
    pop.replaceChildren();
    if (devolverFoco && document.contains(ancla)) ancla.focus({ preventScroll: true });
  }

  /** Un botón ⓘ para un dato, sección, tabla o grupo. */
  function boton(ruta, tipo, opciones) {
    const ay = A.buscar(ruta);
    const rotulo = ay ? ay.t : nombreRuta(ruta);
    return h('button', {
      type: 'button', class: `m-ayuda m-ayuda-${tipo}`, 'aria-label': `Ayuda: ${rotulo}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Qué es, cómo se llena y qué pasa al cambiarlo',
      tabindex: opciones && opciones.fueraDelTab ? '-1' : null, dataset: { ayuda: JSON.stringify(ruta), tipo },
    }, W.icono('info'));
  }

  /** Un clic en cualquier ⓘ del contenedor abre su ventana; F1 con el cursor en un campo abre la de ese campo. */
  function enlazar(contenedor) {
    contenedor.addEventListener('click', (ev) => {
      const b = ev.target.closest('.m-ayuda');
      if (!b || !contenedor.contains(b)) return;
      ev.preventDefault();
      ev.stopPropagation(); // dentro de un <summary> no debe plegar la sección
      abrir(JSON.parse(b.dataset.ayuda), b.dataset.tipo, b);
    });
    contenedor.addEventListener('keydown', (ev) => {
      if (ev.key !== 'F1') return;
      const campo = ev.target.closest && ev.target.closest('[data-ruta]');
      const fila = campo && campo.closest('.m-fila, .m-tabla');
      const b = fila && $('.m-ayuda', fila);
      if (!b) return;
      ev.preventDefault();
      abrir(JSON.parse(b.dataset.ayuda), b.dataset.tipo, b);
    });
  }

  /* ---------------- Diálogos: ranking y guía ---------------- */
  function dialogo(id, titulo, cuerpo) {
    let d = document.getElementById(id);
    if (d) d.remove();
    d = h('dialog', { id, class: 'dlg-estrecho', 'aria-labelledby': `${id}-tit` },
      h('div', { class: 'io' },
        h('header', { class: 'dlg-cab' }, h('h2', { id: `${id}-tit` }, titulo),
          h('button', { type: 'button', class: 'btn-icono', 'aria-label': 'Cerrar', onclick: () => d.close() }, W.icono('cerrar'))),
        h('div', { class: 'dlg-guia' }, cuerpo)));
    d.addEventListener('close', () => { vuelo += 1; d.remove(); });
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // clic en el fondo
    document.body.append(d);
    d.showModal();
    return d;
  }

  function abrirRanking() {
    cerrar(false);
    const lista = h('div', { class: 'm-rank-cuerpo' });
    const avance = h('progress', { max: '1', value: '0', 'aria-label': 'Avance del cálculo' });
    const nota = h('p', { class: 'm-ayuda-suave' }, 'Calculando… ');
    lista.append(nota, avance);
    const d = dialogo('dlg-ranking', '¿Qué mueve más mi precio?', [
      h('p', null, 'Cada dato de las tablas maestras sube 10 %, uno por uno, y se vuelve a cotizar la cotización abierta. Así se ve cuáles pesan de verdad (y cuáles no) antes de gastar tiempo afinándolos.'),
      lista]);
    ranking(null, (i, n) => { avance.value = n ? i / n : 1; }).then((r) => {
      if (r === undefined) return;
      if (r === null) { lista.replaceChildren(parrafo('Agregue partidas a la cotización: sin ellas no hay precio que mover.', 'm-ayuda-suave')); return; }
      if (!r.length) { lista.replaceChildren(parrafo('Ningún dato mueve el precio de esta cotización.', 'm-ayuda-suave')); return; }
      const maxD = Math.abs(r[0].d);
      const base = ahora();
      const total = r.reduce((s, x) => s + Math.abs(x.d), 0);
      const top = r.slice(0, 15);
      const parte = top.reduce((s, x) => s + Math.abs(x.d), 0) / (total || 1);
      lista.replaceChildren(
        h('p', { class: 'm-ayuda-suave' }, `Precio actual de la cotización: ${W.mxn(base.sub)} (antes de IVA). Los 15 datos de abajo concentran ${W.pct(parte, 0)} del movimiento total; los otros ${r.length - top.length} mueven poco. Pulse uno para ir a él.`),
        h('ul', { class: 'm-rank' }, top.map((x) => filaRanking(x, maxD, (rt) => { d.close(); W.maestrosUI.irA(rt); }))));
    });
  }

  const PASOS_GUIA = [
    ['proveedor', 'Lista de precios del proveedor', 'Lo primero, porque pesa más: el precio de cada hoja y barra, y cuánto IVA traen.'],
    ['mano_obra', 'Mano de obra y equipo', 'Salario por hora (ya con prestaciones: FSR 1.00) y costo por hora de cada máquina.'],
    ['precios', 'Precios', 'Gas, alambre, pintura, tornillería: los consumibles que se gastan al fabricar.'],
    ['proceso', 'Proceso de fabricación', 'Tiempos y velocidades del taller. Lo ideal es cronometrarlos; son ilustrativos hasta entonces.'],
    ['capas', 'Pila de precio', 'Indirectos, financiamiento, utilidad y comisión: lo que convierte el costo en precio.'],
  ];
  const FLUJO = [
    ['Material', 'Lámina y aros: precio del proveedor ÷ kg × kg con merma', ['proveedor', 'precios', 'merma', 'calibres', 'materiales']],
    ['Mano de obra y equipo', 'Horas por operación ÷ eficiencia × tarifa', ['proceso', 'mano_obra', 'herrajes']],
    ['Consumibles', 'Soldadura, gas, corte y pintura', ['precios', 'proceso']],
    ['Costo directo', 'Se suma todo lo anterior', []],
    ['Indirectos e imprevistos', 'Indirectos por hora, administración, imprevistos, financiamiento', ['capas']],
    ['Precio', 'Costo ÷ (1 − utilidad − comisión − otros)', ['capas']],
    ['Total', 'Precio + IVA', ['capas']],
  ];

  function abrirGuia() {
    cerrar(false);
    let d = null;
    const ir = (g) => { d.close(); W.maestrosUI.irA([g]); };
    const flujo = h('ol', { class: 'guia-flujo' }, FLUJO.map(([t, sub, grupos]) => h('li', null,
      h('strong', null, t), h('span', null, sub),
      grupos.length ? h('span', { class: 'guia-enlaces' }, grupos.map((g) => h('button', { type: 'button', class: 'btn-texto', onclick: () => ir(g) }, A.etiqueta(g)))) : null)));
    const pasos = h('ol', { class: 'guia-pasos' }, PASOS_GUIA.map(([g, t, sub]) => h('li', null,
      h('div', null, h('strong', null, t), h('span', null, sub)),
      h('button', { type: 'button', class: 'btn btn-sec btn-chico', onclick: () => ir(g) }, 'Ir'))));
    const leyenda = h('ul', { class: 'guia-ley' },
      h('li', null, h('span', { class: 'guia-glifo' }, W.icono('info')), h('span', null, h('strong', null, 'ⓘ'), ' abre la ayuda del dato: qué es, cómo se llena y qué esperar. Con el cursor en un campo, ', h('kbd', null, 'F1'), ' hace lo mismo; ', h('kbd', null, 'Esc'), ' la cierra.')),
      h('li', null, h('span', { class: 'guia-glifo guia-punto' }, '●'), h('span', null, h('strong', null, 'Punto azul:'), ' el dato es distinto del valor de arranque. Con «Sólo modificados» ve todo lo que ha cambiado.')),
      h('li', null, h('span', { class: 'guia-glifo guia-ambar' }, '▭'), h('span', null, h('strong', null, 'Borde ámbar:'), ' el valor está fuera del rango usual. No es un error: pida que alguien lo confirme.')),
      h('li', null, h('span', { class: 'guia-glifo' }, '↶'), h('span', null, h('strong', null, 'Barra «Último cambio»:'), ' dice cuánto movió el precio de su cotización y permite deshacer.')),
      h('li', null, h('span', { class: 'guia-glifo' }, '≈'), h('span', null, h('strong', null, '«¿Y si…?»:'), ' en la ayuda de cada número puede probar otro valor y ver el precio resultante sin guardarlo.')));
    const reglas = h('ul', { class: 'guia-reglas' },
      h('li', null, h('strong', null, 'Unidades:'), ' las que ve a la derecha del campo. Si dice %, escriba el número en % (20 = 20 %). Si no tiene unidad, es un factor o una fracción (1.2; 0.65).'),
      h('li', null, h('strong', null, 'Todo se guarda solo'), ' y recalcula la cotización al instante. «Restablecer valores ilustrativos» regresa todo a como llegó.'),
      h('li', null, h('strong', null, 'Algunos datos no admiten 0'), ' (divisores y tamaños): el editor lo avisa y conserva el valor anterior.'),
      h('li', null, h('strong', null, 'Datos reales e ilustrativos:'), ' son reales la mano de obra y la lista del proveedor; todo lo demás es ilustrativo hasta que lo sustituya (cada grupo lo indica).'),
      h('li', null, h('strong', null, 'Las fórmulas nunca llevan precios:'), ' sólo leen estas tablas. Por eso un cambio aquí se ve en todas las partidas.'));
    d = dialogo('dlg-guia', 'Guía rápida de las tablas maestras', [
      h('p', { class: 'guia-intro' }, 'Aquí vive todo número que un taller puede querer cambiar. Esta guía dice cómo se arma el precio, en qué orden conviene llenarlo y cómo leer cada renglón.'),
      h('h3', null, 'Así se arma un precio'), flujo,
      h('h3', null, 'En qué orden llenarlo'), pasos,
      h('p', { class: 'm-ayuda-suave' }, 'Al terminar, pulse «¿Qué mueve más mi precio?» y afine primero lo que más pesa.'),
      h('h3', null, 'Cómo leer cada renglón'), leyenda,
      h('h3', null, 'Reglas para no equivocarse'), reglas]);
  }

  W.ayudaUI = { boton, enlazar, abrir, cerrar, refrescar, abrirGuia, abrirRanking, ranking, describir, nombreRuta };
}(typeof self !== 'undefined' ? self : this));
