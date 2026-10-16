/**
 * COTIZAP · web/lista_pdf.js — La lista de fabricación como documento PDF (hoja carta), sin DOM.
 *
 * Toma la lista de motor/lista_fabricacion.js y arma el PDF con web/pdf.js: encabezado con proyecto, cliente y fecha en cada
 * hoja («Hoja n de N»); una tarjeta por pieza (marca, cantidad, título, dibujo acotado a la izquierda y especificaciones a la
 * derecha en dos columnas etiqueta/valor), dos o tres por hoja según quepan y nunca partidas entre hojas; al final, el
 * resumen (marca, pieza, cantidad, kg por pieza y kg total) y «No se fabrican aquí», con el motivo. Es una hoja de taller:
 * no lleva precios.
 *
 * `generar(lista, opciones)` → { bytes: Uint8Array, paginas } y `nombreArchivo(lista)` →
 * «lista-fabricacion-<proyecto-o-folio>-<fecha>.pdf» (minúsculas, sin acentos).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pdf'), () => require('./planos'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.listaPDF = factory(root.COTIZAP.pdf, () => root.COTIZAP.planos);
  }
}(typeof self !== 'undefined' ? self : this, function (PDF, obtenerPlanos) {
  'use strict';

  const num = (x, d) => Number(x).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
  const kg = (x) => `${num(x, 2)} kg`;

  /** Minúsculas, sin acentos y con guiones: «Colector de polvo · línea 2» → «colector-de-polvo-linea-2». */
  function limpio(t, max) {
    const s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (max ? s.slice(0, max) : s).replace(/-+$/g, '');
  }
  function nombreArchivo(lista) {
    const e = (lista && lista.encabezado) || {};
    const clave = limpio(e.proyecto, 40) || limpio(e.folio, 40) || 'sin-proyecto';
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(e.fecha || '') ? e.fecha : '';
    return `lista-fabricacion-${clave}${fecha ? `-${fecha}` : ''}.pdf`;
  }

  function fechaLarga(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ---------------- Medidas de la hoja ---------------- */
  const W = 612;
  const H = 792;
  const MARGEN = 36;
  const ANCHO = W - 2 * MARGEN; // 540
  const PIE = 40;
  const COL_DIBUJO = 190;
  const GRIS_ET = 0.38;

  /** Las especificaciones de una pieza como filas para las columnas: { sec } (subtítulo) o { et, val, negrita }. */
  function filasDe(q) {
    const f = [];
    const sec = (t) => f.push({ sec: t });
    const fila = (et, val, negrita) => { if (val !== '' && val !== null && val !== undefined) f.push({ et, val: String(val), negrita: !!negrita }); };
    sec('Material');
    fila('Material', q.material || '—');
    fila('Calibre', q.calibre ? `Cal. ${q.calibre}` : (q.espesor_mm ? 'Por espesor' : 'No aplica'));
    fila('Espesor', q.espesor_mm ? `${num(q.espesor_mm, 3)} mm` : 'No aplica');
    fila('Costura', q.costura);
    sec('Medidas');
    q.medidas.forEach((m) => fila(m.etiqueta, m.valor));
    if (q.extremos.length) { sec('Extremos'); q.extremos.forEach((m) => fila(m.etiqueta, m.valor)); }
    if (q.bridas.length) {
      sec('Bridas');
      // los aros iguales se juntan: «2 de taller» o «1 suelta»
      const grupos = [];
      q.bridas.forEach((a) => {
        const k = [a.perfil, a.ancho_mm, a.gramil_mm, a.diam_barreno_mm, a.n_tornillos].join('|');
        let g = grupos.find((x) => x.k === k);
        if (!g) { g = { k, a, taller: 0, sueltas: 0 }; grupos.push(g); }
        if (a.suelta) g.sueltas += 1; else g.taller += 1;
      });
      const nT = q.bridas.filter((a) => !a.suelta).length;
      const nS = q.bridas.length - nT;
      fila('Número de aros', `${q.bridas.length}${nS ? ` (${[nT ? `${nT} de taller` : '', `${nS} ${nS === 1 ? 'suelta' : 'sueltas'}`].filter(Boolean).join(' y ')})` : ''}`);
      const mm = (x) => `${num(Math.round(x * 10) / 10, Number.isInteger(Math.round(x * 10) / 10) ? 0 : 1)} mm`;
      grupos.forEach((g, i) => {
        const p = grupos.length > 1 ? `Aro ${i + 1}: ` : '';
        const may = (t) => t.charAt(0).toUpperCase() + t.slice(1);
        if (grupos.length > 1) fila(`${p}cantidad`.replace(/^./, (c) => c.toUpperCase()), [g.taller ? `${g.taller} de taller` : '', g.sueltas ? `${g.sueltas} suelta${g.sueltas === 1 ? '' : 's'}` : ''].filter(Boolean).join(' y '));
        fila(may(`${p}perfil`), g.a.perfil);
        fila(may(`${p}ancho`), mm(g.a.ancho_mm));
        fila(may(`${p}gramil`), mm(g.a.gramil_mm));
        fila(may(`${p}Ø barreno`), mm(g.a.diam_barreno_mm));
        fila(may(`${p}tornillos`), `${g.a.n_tornillos} barrenos`);
        fila(may(`${p}paso`), g.a.paso_mm ? mm(g.a.paso_mm) : '');
      });
    }
    sec('Peso');
    fila('Peso por pieza', q.peso_unitario_kg > 0 ? kg(q.peso_unitario_kg) : '—');
    fila('Peso total', q.peso_total_kg > 0 ? kg(q.peso_total_kg) : '—', true);
    return f;
  }

  /** Mide y reparte las filas en dos columnas con el tamaño `t` (puntos del valor). Devuelve { col1, col2, alto }. */
  function repartir(filas, anchoCol, t) {
    const wEt = Math.round(anchoCol * 0.42);
    const wVal = anchoCol - wEt - 4;
    const medidas = filas.map((r) => {
      if (r.sec) return { ...r, h: t + 6, lineas: [] };
      const le = PDF.ajustar(r.et, wEt, t - 1, true);
      const lv = PDF.ajustar(r.val, wVal, t, r.negrita);
      return { ...r, le, lv, h: Math.max(le.length, lv.length) * (t + 1.3) + 1.8 };
    });
    const suma = (xs) => xs.reduce((acc, r) => acc + r.h, 0);
    // dónde se corta: lo mejor es entre secciones (que una no se parta); si eso desbalancea mucho, en cualquier fila
    const alto = (i) => Math.max(suma(medidas.slice(0, i)), suma(medidas.slice(i)));
    let mejorSec = 0;
    let mejorFila = 0;
    medidas.forEach((r, i) => {
      if (i === 0) return;
      if (r.sec && alto(i) < alto(mejorSec || 1)) mejorSec = i;
      if (!medidas[i - 1].sec && alto(i) < alto(mejorFila || 1)) mejorFila = i;
    });
    const corte = mejorSec && alto(mejorSec) <= alto(mejorFila || 1) * 1.25 ? mejorSec : (mejorFila || mejorSec || 1);
    const c1 = medidas.slice(0, corte);
    const c2 = medidas.slice(corte);
    const h1 = suma(c1);
    const h2 = suma(c2);
    return { col1: c1, col2: c2, alto: Math.max(h1, h2), wEt, wVal };
  }

  /** La tarjeta de una pieza con el tamaño de letra `t`: calcula sus alturas; `pintar(pagina, y)` la dibuja. */
  function tarjeta(q, t, planos) {
    const wTit = ANCHO - 54 - 70;
    const titulo = PDF.ajustar(q.titulo, wTit, 10.5, true).slice(0, 2);
    const sub = [q.tipo, q.material, q.calibre ? `Cal. ${q.calibre}` : '', q.espesor_mm ? `${num(q.espesor_mm, 3)} mm` : ''].filter(Boolean).join(' · ');
    const desc = q.descripcion ? PDF.ajustar(q.descripcion, wTit, t, false).slice(0, 2) : [];
    const altoCab = Math.max(30, 8 + titulo.length * 12.5 + desc.length * (t + 2) + (t + 3));
    const xEsp = COL_DIBUJO + 10;
    const anchoCol = (ANCHO - xEsp - 6 - 6) / 2;
    const rep = repartir(filasDe(q), anchoCol, t);
    const avisos = [...q.advertencias.map((a) => `Atención: ${a}`), ...q.notas];
    const lAv = avisos.flatMap((a) => PDF.ajustar(a, ANCHO - 12, t - 0.5, false));
    const altoCuerpo = Math.max(150, rep.alto + 8);
    const altoAv = lAv.length ? lAv.length * (t + 0.8) + 6 : 0;
    const alto = altoCab + altoCuerpo + altoAv + 6;

    function pintar(pg, y) {
      const x = MARGEN;
      pg.rect(x, y, ANCHO, alto, { grosor: 0.7, gris: 0.45 });
      // cabecera: marca, título, cantidad
      pg.rect(x, y, ANCHO, altoCab, { grosor: 0, relleno: 0.94, sinTrazo: true });
      pg.rect(x + 6, y + 5, 42, altoCab - 10, { sinTrazo: true, relleno: 0.15 });
      pg.texto(x + 27, y + altoCab / 2 + 6, q.marca, { tam: 17, negrita: true, align: 'center', gris: 1 });
      let yy = y + 15;
      titulo.forEach((l) => { pg.texto(x + 54, yy, l, { tam: 10.5, negrita: true }); yy += 12.5; });
      desc.forEach((l) => { pg.texto(x + 54, yy - 1, l, { tam: t, gris: 0.3 }); yy += t + 2; });
      pg.texto(x + 54, yy, sub, { tam: t, negrita: true, gris: 0.2 });
      pg.texto(x + ANCHO - 6, y + 11, 'CANTIDAD', { tam: 6, negrita: true, align: 'right', gris: GRIS_ET });
      pg.texto(x + ANCHO - 6, y + 28, `${num(q.cantidad, 0)} ${q.cantidad === 1 ? 'pza' : 'pzas'}`, { tam: 14, negrita: true, align: 'right' });
      pg.linea(x, y + altoCab, x + ANCHO, y + altoCab, { grosor: 0.5, gris: 0.45 });
      // dibujo
      const caja = { x: x + 4, y: y + altoCab + 3, w: COL_DIBUJO - 4, h: altoCuerpo - 6 };
      try {
        const arbol = planos().arbol(q.dibujo, { px: caja.w * 1.45, alto_max: caja.h * 1.45 });
        PDF.dibujarArbol(pg, arbol, caja);
      } catch (e) { /* sin dibujo: la tarjeta conserva sus especificaciones */ }
      pg.linea(x + COL_DIBUJO + 4, y + altoCab + 4, x + COL_DIBUJO + 4, y + altoCab + altoCuerpo - 4, { grosor: 0.4, gris: 0.75 });
      // especificaciones
      [rep.col1, rep.col2].forEach((col, k) => {
        const cx = x + xEsp + k * (anchoCol + 6);
        let cy = y + altoCab + 6;
        col.forEach((r) => {
          if (r.sec) {
            pg.texto(cx, cy + t + 1, r.sec.toUpperCase(), { tam: t - 1, negrita: true, gris: 0.15 });
            pg.linea(cx, cy + t + 3, cx + anchoCol, cy + t + 3, { grosor: 0.4, gris: 0.7 });
          } else {
            r.le.forEach((l, i) => pg.texto(cx, cy + t + i * (t + 1.3), l, { tam: t - 1, negrita: true, gris: GRIS_ET }));
            r.lv.forEach((l, i) => pg.texto(cx + rep.wEt + 4, cy + t + i * (t + 1.3), l, { tam: t, negrita: r.negrita }));
          }
          cy += r.h;
        });
      });
      // advertencias y notas
      if (lAv.length) {
        const ya = y + altoCab + altoCuerpo;
        pg.linea(x, ya, x + ANCHO, ya, { grosor: 0.4, gris: 0.75 });
        lAv.forEach((l, i) => pg.texto(x + 6, ya + t + 2 + i * (t + 0.8), l, { tam: t - 0.5, gris: 0.2 }));
      }
    }
    return { alto, pintar };
  }

  /**
   * La tarjeta de un conjunto armado en taller (E1, E2…): una figura simple con las dos piezas y su junta, sus marcas con la cara
   * que se une, el ángulo resultante, el tamaño y la nota del taller. Misma forma que `tarjeta`: { alto, pintar(pagina, y) }.
   */
  function tarjetaConjunto(c, t) {
    const wTit = ANCHO - 54 - 90;
    const titulo = PDF.ajustar(c.titulo, wTit, 10.5, true).slice(0, 2);
    const altoCab = Math.max(30, 8 + titulo.length * 12.5 + 6);
    const xEsp = COL_DIBUJO + 10;
    const anchoEsp = ANCHO - xEsp - 8;
    const wEt = Math.round(anchoEsp * 0.38);
    const filas = [];
    c.piezas.forEach((x, i) => filas.push([`Pieza ${i + 1}`, `${x.marca} · ${x.titulo}`, `Cara que se une: ${x.cara_texto} (sin brida)`]));
    filas.push(['Junta de armado', c.junta === 'engargolada' ? 'Engargolada (galvanizado)' : 'Soldada (filete continuo)']);
    if (c.angulo_deg !== undefined && c.angulo_deg !== null) filas.push(c.pareja === 'a' ? ['Ángulo resultante', `${num(c.angulo_deg, 0)}°${c.es_90 ? ' (el ramal sale a 90°)' : ''}`] : ['Giro del codo', `${num(c.angulo_deg, 0)}°`]);
    filas.push(['Ø de la unión', `${num(c.D_mm, 1)} mm`]);
    filas.push(['Dimensión del conjunto', `hasta ${num(c.dim_mm, 0)} mm${c.limite_mm ? ` (máximo ${num(c.limite_mm, 0)} mm por manejo y transporte)` : ''}`]);
    const medidas = filas.map(([et, ...vals]) => {
      const lv = vals.flatMap((v) => PDF.ajustar(v, anchoEsp - wEt - 4, t, false));
      const le = PDF.ajustar(et, wEt, t - 1, true);
      return { le, lv, h: Math.max(le.length, lv.length) * (t + 1.3) + 2.5 };
    });
    const lNota = PDF.ajustar(c.nota, ANCHO - 12, t, true);
    const altoCuerpo = Math.max(112, medidas.reduce((a, r) => a + r.h, 0) + 10);
    const altoNota = lNota.length * (t + 1) + 8;
    const alto = altoCab + altoCuerpo + altoNota + 4;

    function pintar(pg, y) {
      const x = MARGEN;
      pg.rect(x, y, ANCHO, alto, { grosor: 0.7, gris: 0.45 });
      pg.rect(x, y, ANCHO, altoCab, { grosor: 0, relleno: 0.94, sinTrazo: true });
      pg.rect(x + 6, y + 5, 42, altoCab - 10, { sinTrazo: true, relleno: 0.15 });
      pg.texto(x + 27, y + altoCab / 2 + 6, c.marca, { tam: 17, negrita: true, align: 'center', gris: 1 });
      let yy = y + 15;
      titulo.forEach((l) => { pg.texto(x + 54, yy, l, { tam: 10.5, negrita: true }); yy += 12.5; });
      pg.texto(x + ANCHO - 6, y + 11, 'CONJUNTOS', { tam: 6, negrita: true, align: 'right', gris: GRIS_ET });
      pg.texto(x + ANCHO - 6, y + 28, `${num(c.cantidad, 0)} ${c.cantidad === 1 ? 'conjunto' : 'conjuntos'}`, { tam: 14, negrita: true, align: 'right' });
      pg.linea(x, y + altoCab, x + ANCHO, y + altoCab, { grosor: 0.5, gris: 0.45 });
      // figura: las dos piezas lado a lado, con su marca, y la junta entre ellas
      const fy = y + altoCab + 26;
      const wCaja = 66;
      const hCaja = 44;
      const x0 = x + (COL_DIBUJO - 2 * wCaja) / 2;
      c.piezas.forEach((q, i) => {
        const bx = x0 + i * wCaja;
        pg.rect(bx, fy, wCaja, hCaja, { grosor: 1, gris: 0.2, relleno: 0.93 });
        pg.texto(bx + wCaja / 2, fy + 21, q.marca, { tam: 14, negrita: true, align: 'center' });
        pg.texto(bx + wCaja / 2, fy + 35, q.cara_texto, { tam: 6.5, align: 'center', gris: 0.3 });
      });
      pg.linea(x0 + wCaja, fy - 8, x0 + wCaja, fy + hCaja + 8, { grosor: 1.6, gris: 0.1, guion: [3, 2] });
      pg.texto(x0 + wCaja, fy - 12, `junta ${c.junta}`, { tam: 7, negrita: true, align: 'center' });
      pg.texto(x0 + wCaja, fy + hCaja + 20, 'sin brida en la cara que se une', { tam: 6.5, align: 'center', gris: 0.35 });
      pg.linea(x + COL_DIBUJO + 4, y + altoCab + 4, x + COL_DIBUJO + 4, y + altoCab + altoCuerpo - 4, { grosor: 0.4, gris: 0.75 });
      let cy = y + altoCab + 6;
      medidas.forEach((r) => {
        r.le.forEach((l, i) => pg.texto(x + xEsp, cy + t + i * (t + 1.3), l, { tam: t - 1, negrita: true, gris: GRIS_ET }));
        r.lv.forEach((l, i) => pg.texto(x + xEsp + wEt + 4, cy + t + i * (t + 1.3), l, { tam: t }));
        cy += r.h;
      });
      const ya = y + altoCab + altoCuerpo;
      pg.linea(x, ya, x + ANCHO, ya, { grosor: 0.4, gris: 0.75 });
      lNota.forEach((l, i) => pg.texto(x + 6, ya + t + 3 + i * (t + 1), l, { tam: t, negrita: true, gris: 0.15 }));
    }
    return { alto, pintar };
  }

  /* ---------------- Resumen y partidas que no se fabrican ---------------- */

  /** Tabla con columnas [{ t, w, num }] y filas [[celdas]] que pasa de hoja con su encabezado repetido. `fin` = fila de totales. */
  function tabla(cursor, titulo, cols, filas, fin) {
    const t = 8;
    const fila = (celdas, negrita) => {
      const lin = celdas.map((c, i) => PDF.ajustar(c, cols[i].w - 8, t, negrita));
      return { lin, h: Math.max(...lin.map((l) => l.length)) * (t + 1.6) + 5 };
    };
    const cab = () => {
      const pg = cursor.pagina();
      pg.texto(MARGEN, cursor.y + 10, titulo, { tam: 11, negrita: true });
      cursor.y += 16;
      let x = MARGEN;
      pg.rect(MARGEN, cursor.y, ANCHO, 14, { sinTrazo: true, relleno: 0.88 });
      cols.forEach((c) => {
        pg.texto(c.num ? x + c.w - 4 : x + 4, cursor.y + 10, c.t, { tam: 7.5, negrita: true, align: c.num ? 'right' : 'left' });
        x += c.w;
      });
      cursor.y += 14;
    };
    const pintar = (f, negrita) => {
      const pg = cursor.pagina();
      let x = MARGEN;
      f.lin.forEach((lineas, i) => {
        lineas.forEach((l, j) => pg.texto(cols[i].num ? x + cols[i].w - 4 : x + 4, cursor.y + 3 + t + j * (t + 1.6), l, { tam: t, negrita, align: cols[i].num ? 'right' : 'left' }));
        x += cols[i].w;
      });
      cursor.y += f.h;
      pg.linea(MARGEN, cursor.y, MARGEN + ANCHO, cursor.y, { grosor: 0.3, gris: 0.8 });
    };
    const medidas = filas.map((c) => fila(c, false));
    if (cursor.y + 16 + 14 + (medidas[0] ? medidas[0].h : 14) > cursor.fondo) cursor.salto();
    cab();
    medidas.forEach((f) => {
      if (cursor.y + f.h > cursor.fondo) { cursor.salto(); cab(); }
      pintar(f, false);
    });
    if (fin) {
      const f = fila(fin, true);
      if (cursor.y + f.h > cursor.fondo) { cursor.salto(); cab(); }
      cursor.pagina().rect(MARGEN, cursor.y, ANCHO, f.h, { sinTrazo: true, relleno: 0.94 });
      pintar(f, true);
    }
  }

  /* ---------------- Documento ---------------- */

  /**
   * El PDF de la lista. opciones: planos (módulo de planos.js; por omisión el del entorno), tamLetra (8 por omisión).
   * Devuelve { bytes: Uint8Array, paginas, tarjetas: [{ marca, pagina, y, alto, letra }], tope, fondo }.
   */
  function generar(lista, opciones) {
    const o = opciones || {};
    const planos = o.planos ? () => o.planos : obtenerPlanos;
    const e = lista.encabezado;
    const doc = PDF.documento({ titulo: `Lista de fabricación${e.proyecto ? ` · ${e.proyecto}` : ''}`, asunto: 'Lista de piezas para fabricar', fecha: /^\d{4}-\d{2}-\d{2}$/.test(e.fecha || '') ? e.fecha : undefined });

    // encabezado de cada hoja: se mide una vez para reservar su altura
    const izq = [
      ...PDF.ajustar(`Proyecto: ${e.proyecto || '—'}`, 380, 8.5, false).slice(0, 2),
      ...(e.material ? PDF.ajustar(`Material: ${e.material}`, 380, 8.5, false).slice(0, 2) : []),
    ];
    const derecha = [e.cliente ? `Cliente: ${e.cliente}` : '', e.folio ? `Folio: ${e.folio}` : '', e.fecha ? `Fecha: ${fechaLarga(e.fecha)}` : '']
      .filter(Boolean).flatMap((l) => PDF.ajustar(l, 150, 8.5, false).slice(0, 1));
    const altoEnc = 30 + Math.max(izq.length, derecha.length) * 10.5 + 6;
    const encabezado = (pg, n, total) => {
      pg.texto(MARGEN, MARGEN + 14, 'Lista de fabricación', { tam: 15, negrita: true });
      pg.texto(MARGEN + ANCHO, MARGEN + 12, `Hoja ${n} de ${total}`, { tam: 9, negrita: true, align: 'right' });
      izq.forEach((l, i) => pg.texto(MARGEN, MARGEN + 29 + i * 10.5, l, { tam: 8.5 }));
      derecha.forEach((l, i) => pg.texto(MARGEN + ANCHO, MARGEN + 29 + i * 10.5, l, { tam: 8.5, align: 'right' }));
      pg.linea(MARGEN, MARGEN + altoEnc - 2, MARGEN + ANCHO, MARGEN + altoEnc - 2, { grosor: 0.9, gris: 0.2 });
      pg.linea(MARGEN, H - PIE + 8, MARGEN + ANCHO, H - PIE + 8, { grosor: 0.4, gris: 0.6 });
      pg.texto(MARGEN, H - PIE + 19, 'Medidas en mm · Hoja de taller: no lleva precios', { tam: 7, gris: 0.4 });
      pg.texto(MARGEN + ANCHO, H - PIE + 19, 'COTIZAP', { tam: 7, negrita: true, align: 'right', gris: 0.4 });
    };

    const hojas = [];
    const cursor = {
      y: 0, fondo: H - PIE, actual: null,
      salto() { cursor.actual = doc.pagina(); hojas.push(cursor.actual); cursor.y = MARGEN + altoEnc + 4; },
      pagina() { if (!cursor.actual) cursor.salto(); return cursor.actual; },
    };
    cursor.salto();

    // las tarjetas, sin partirlas entre hojas; si una no cabe en una hoja se achica la letra
    const posiciones = [];
    const libre = cursor.fondo - (MARGEN + altoEnc + 4);
    lista.piezas.forEach((q) => {
      let t = o.tamLetra || 8;
      let tj = tarjeta(q, t, planos);
      while (tj.alto > libre && t > 5.5) { t -= 0.5; tj = tarjeta(q, t, planos); }
      if (cursor.y + tj.alto > cursor.fondo) cursor.salto();
      tj.pintar(cursor.pagina(), cursor.y);
      posiciones.push({ marca: q.marca, pagina: hojas.indexOf(cursor.actual) + 1, y: cursor.y, alto: tj.alto, letra: t });
      cursor.y += tj.alto + 8;
    });

    // los conjuntos armados en taller (E1, E2…), después de las piezas
    const conjuntos = lista.conjuntos || [];
    if (conjuntos.length) {
      if (cursor.y + 22 + 140 > cursor.fondo) cursor.salto();
      cursor.pagina().texto(MARGEN, cursor.y + 12, 'Conjuntos armados en taller', { tam: 11, negrita: true });
      cursor.y += 20;
      conjuntos.forEach((c) => {
        const tj = tarjetaConjunto(c, o.tamLetra || 8);
        if (cursor.y + tj.alto > cursor.fondo) cursor.salto();
        tj.pintar(cursor.pagina(), cursor.y);
        posiciones.push({ marca: c.marca, pagina: hojas.indexOf(cursor.actual) + 1, y: cursor.y, alto: tj.alto, letra: o.tamLetra || 8, conjunto: true });
        cursor.y += tj.alto + 8;
      });
    }

    // resumen
    if (lista.piezas.length) {
      cursor.y += 6;
      tabla(cursor, 'Resumen', [
        { t: 'Marca', w: 48 }, { t: 'Pieza', w: 282 }, { t: 'Cantidad', w: 50, num: true }, { t: 'kg por pieza', w: 76, num: true }, { t: 'kg total', w: 84, num: true },
      ], [...lista.piezas.map((q) => [q.marca, q.titulo, num(q.cantidad, 0), q.peso_unitario_kg > 0 ? num(q.peso_unitario_kg, 2) : '—', q.peso_total_kg > 0 ? num(q.peso_total_kg, 2) : '—']),
        ...conjuntos.map((c) => [c.marca, `Conjunto armado en taller: ${c.piezas.map((x) => x.marca).join(' + ')} (junta ${c.junta})`, num(c.cantidad, 0), '—', '—'])],
      ['Total', `${num(lista.totales.partidas, 0)} ${lista.totales.partidas === 1 ? 'partida' : 'partidas'}${conjuntos.length ? ` · ${num(conjuntos.length, 0)} ${conjuntos.length === 1 ? 'armado en taller' : 'armados en taller'} (${num(lista.totales.conjuntos, 0)} ${lista.totales.conjuntos === 1 ? 'conjunto' : 'conjuntos'})` : ''}`, num(lista.totales.piezas, 0), '', num(lista.totales.kg, 2)]);
    }
    // lo que no se fabrica aquí
    cursor.y += 10;
    if (lista.aparte.length) {
      tabla(cursor, 'No se fabrican aquí', [{ t: 'Partida', w: 220 }, { t: 'Cantidad', w: 50, num: true }, { t: 'Motivo', w: 270 }],
        lista.aparte.map((a) => [a.titulo, num(a.cantidad, 0), a.motivo]));
    } else {
      const pg = cursor.pagina();
      if (cursor.y + 30 > cursor.fondo) cursor.salto();
      cursor.pagina().texto(MARGEN, cursor.y + 10, 'No se fabrican aquí', { tam: 11, negrita: true });
      pg.texto(MARGEN, cursor.y + 25, 'Ninguna: todas las partidas de la cotización están en esta lista.', { tam: 8 });
    }

    // el número de hoja se estampa al final, cuando ya se sabe cuántas son
    hojas.forEach((pg, i) => encabezado(pg, i + 1, hojas.length));
    return { bytes: doc.generar(), paginas: hojas.length, tarjetas: posiciones, fondo: cursor.fondo, tope: MARGEN + altoEnc + 4 };
  }

  return { generar, nombreArchivo, limpio };
}));
