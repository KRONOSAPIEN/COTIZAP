/**
 * COTIZAP · web/pdf.js — Escritor de PDF mínimo (PDF 1.4), sin dependencias y sin DOM.
 *
 * Páginas tamaño carta, fuentes estándar Helvetica y Helvetica-Bold con WinAnsiEncoding (no se incrustan), texto, líneas,
 * rectángulos, trayectorias (con curvas), círculos y recortes, en vectores. Las coordenadas de la API son en puntos (1/72″) con
 * el origen arriba a la izquierda y la y hacia abajo —como el SVG—; aquí se voltean al sistema del PDF. La salida es un
 * Uint8Array con su tabla de referencias (xref) de offsets exactos.
 *
 * Mide el ancho del texto con las métricas AFM de Helvetica y Helvetica-Bold para ajustar renglones (`ancho`, `ajustar`), y
 * `dibujarArbol` pinta en una caja de la página el árbol SVG que arma planos.js ({ tag, a, c, t }): svg, g (con transform),
 * line, polyline, polygon, rect, circle, ellipse, path (M L H V C A Z, absolutos y relativos) y text (con su giro).
 * Un nodo que no se puede pintar se omite sin romper el dibujo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.pdf = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- Codificación: Unicode → WinAnsi (Windows-1252) ---------------- */

  /** Los caracteres de 0x80 a 0x9F de WinAnsi, por su punto Unicode. */
  const WIN_ALTO = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89,
    0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
    0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
  };
  /** Lo que no existe en WinAnsi se escribe con lo más parecido que sí existe. */
  const SUSTITUTOS = {
    '″': '"', '′': "'", '‵': "'", 'ʼ': "'", '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', '→': '->', '←': '<-', '↔': '<->', '−': '-', '‐': '-', '‑': '-', '‒': '-', '⁄': '/', '∕': '/',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅓': '1/3', '⅔': '2/3', '∅': 'Ø', '∞': 'inf.', '√': 'raiz',
    α: 'alfa', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'delta', θ: 'theta', λ: 'lambda', μ: 'µ', π: 'pi', Ω: 'ohm', σ: 'sigma',
    '✓': '+', '✔': '+', '★': '*', '☆': '*', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '', '\t': ' ', '\n': ' ', '\r': ' ',
  };

  /** Bytes WinAnsi de un texto (los caracteres sin equivalente salen como «?»). */
  function winAnsi(texto) {
    const out = [];
    const t = String(texto === undefined || texto === null ? '' : texto).normalize('NFC');
    for (const ch of t) {
      const c = ch.codePointAt(0);
      if ((c >= 32 && c <= 126) || (c >= 0xA0 && c <= 0xFF)) { out.push(c); continue; }
      if (WIN_ALTO[c] !== undefined) { out.push(WIN_ALTO[c]); continue; }
      if (Object.prototype.hasOwnProperty.call(SUSTITUTOS, ch)) { out.push(...winAnsi(SUSTITUTOS[ch])); continue; }
      out.push(c < 32 || (c >= 0x7F && c < 0xA0) ? 32 : 63);
    }
    return out;
  }

  /* ---------------- Métricas AFM de Helvetica y Helvetica-Bold (anchos por 1000 unidades) ---------------- */

  // ASCII 32..126
  const ASCII_R = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    278, 278, 278, 469, 556, 333,
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    334, 260, 334, 584,
  ];
  const ASCII_B = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    333, 278, 333, 584, 556, 333,
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
    389, 280, 389, 584,
  ];
  // 128..191: [regular, negrita]
  const ALTO = [
    [556, 556], [350, 350], [222, 278], [556, 556], [333, 500], [1000, 1000], [556, 556], [556, 556], [333, 333], [1000, 1000], [667, 667], [333, 333], [1000, 1000], [350, 350], [611, 611], [350, 350],
    [350, 350], [222, 278], [222, 278], [333, 500], [333, 500], [350, 350], [556, 556], [1000, 1000], [333, 333], [1000, 1000], [500, 556], [333, 333], [944, 944], [350, 350], [500, 500], [667, 667],
    [278, 278], [333, 333], [556, 556], [556, 556], [556, 556], [556, 556], [260, 280], [556, 556], [333, 333], [737, 737], [370, 370], [556, 556], [584, 584], [333, 333], [737, 737], [333, 333],
    [400, 400], [584, 584], [333, 333], [333, 333], [333, 333], [556, 611], [537, 556], [278, 278], [333, 333], [333, 333], [365, 365], [556, 556], [834, 834], [834, 834], [834, 834], [611, 611],
  ];
  // 192..255: letra base de las acentuadas y sus excepciones
  const BASE = 'AAAAAA.CEEEEIIIIDNOOOOO.OUUUUY..aaaaaa.ceeeeiiiidnooooo.ouuuuy.y';
  const EXC = { 198: [1000, 1000], 208: [722, 722], 215: [584, 584], 222: [667, 667], 223: [611, 611], 230: [889, 889], 240: [556, 611], 247: [584, 584], 248: [611, 611], 254: [556, 611] };
  function tablaAnchos(negrita) {
    const k = negrita ? 1 : 0;
    const A = negrita ? ASCII_B : ASCII_R;
    const w = new Array(256).fill(0);
    for (let c = 32; c <= 126; c += 1) w[c] = A[c - 32];
    for (let c = 128; c <= 191; c += 1) w[c] = ALTO[c - 128][k];
    for (let c = 192; c <= 255; c += 1) {
      if (EXC[c]) w[c] = EXC[c][k];
      else w[c] = A[BASE.charCodeAt(c - 192) - 32] || 556;
    }
    // la ç lleva el ancho de la c (en negrita 556); la ï/ì/í/î el de la i
    return w;
  }
  const ANCHOS = [tablaAnchos(false), tablaAnchos(true)];

  /** Ancho de un texto en puntos. */
  function ancho(texto, tam, negrita) {
    const w = ANCHOS[negrita ? 1 : 0];
    let s = 0;
    winAnsi(texto).forEach((c) => { s += w[c]; });
    return (s * (tam || 10)) / 1000;
  }

  /** Parte un texto en renglones que caben en `maximo` puntos (respeta los saltos de línea y parte las palabras muy largas). */
  function ajustar(texto, maximo, tam, negrita) {
    const out = [];
    String(texto === undefined || texto === null ? '' : texto).split('\n').forEach((parrafo) => {
      let linea = '';
      parrafo.split(/ +/).forEach((pal) => {
        let palabra = pal;
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (ancho(prueba, tam, negrita) <= maximo) { linea = prueba; return; }
        if (linea) { out.push(linea); linea = ''; }
        // una palabra más ancha que el renglón se parte por letras
        while (ancho(palabra, tam, negrita) > maximo && palabra.length > 1) {
          let n = palabra.length - 1;
          while (n > 1 && ancho(palabra.slice(0, n), tam, negrita) > maximo) n -= 1;
          out.push(palabra.slice(0, n));
          palabra = palabra.slice(n);
        }
        linea = palabra;
      });
      out.push(linea);
    });
    return out;
  }

  /* ---------------- Páginas ---------------- */

  const r2 = (x) => {
    const v = Math.round(x * 100) / 100;
    return String(Object.is(v, -0) ? 0 : v);
  };
  const r4 = (x) => String(Math.round(x * 10000) / 10000 || 0);
  const colorOps = (c, trazo) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return `${c.map(r2).join(' ')} ${trazo ? 'RG' : 'rg'} `;
    return `${r2(c)} ${trazo ? 'G' : 'g'} `;
  };
  /** Cadena PDF: bytes WinAnsi, con los de fuera de ASCII imprimible en octal para que el archivo quede en ASCII. */
  function cadena(texto) {
    let s = '(';
    winAnsi(texto).forEach((c) => {
      if (c === 40 || c === 41 || c === 92) s += `\\${String.fromCharCode(c)}`;
      else if (c < 32 || c > 126) s += `\\${c.toString(8).padStart(3, '0')}`;
      else s += String.fromCharCode(c);
    });
    return `${s})`;
  }

  function crearPagina(W, H) {
    const ops = [];
    let nivel = 0;
    const Y = (y) => H - y;
    const pagina = {
      ancho: W, alto: H,
      get operaciones() { return ops; },
      guardar() { ops.push('q'); nivel += 1; return pagina; },
      restaurar() { if (nivel > 0) { ops.push('Q'); nivel -= 1; } return pagina; },
      /** Recorta lo que se pinte después a un rectángulo (dentro de guardar/restaurar). */
      recortar(x, y, w, h) { ops.push(`${r2(x)} ${r2(Y(y + h))} ${r2(w)} ${r2(h)} re W n`); return pagina; },
      /**
       * Texto con la base en (x, y). op: tam (10), negrita, align ('left' | 'center' | 'right'), gris o color [r,g,b], ang (grados,
       * en el sentido del reloj a la vista).
       */
      texto(x, y, txt, op) {
        const o = op || {};
        const tam = o.tam || 10;
        const w = ancho(txt, tam, o.negrita);
        const dx = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
        const a = ((o.ang || 0) * Math.PI) / 180;
        const px = x + dx * Math.cos(a);
        const py = y + dx * Math.sin(a);
        const c = Math.cos(a);
        const s = Math.sin(a);
        ops.push(`BT /${o.negrita ? 'F2' : 'F1'} ${r2(tam)} Tf ${colorOps(o.color !== undefined ? o.color : (o.gris !== undefined ? o.gris : 0), false)}${r4(c)} ${r4(-s)} ${r4(s)} ${r4(c)} ${r2(px)} ${r2(Y(py))} Tm ${cadena(txt)} Tj ET`);
        return pagina;
      },
      /**
       * Trayectoria con órdenes absolutas [['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Z']]. op: grosor (0.5), gris o color
       * del trazo, relleno (gris o [r,g,b]), sinTrazo, evenodd, guion [on, off…], terminal ('butt' | 'round'), union ('round').
       */
      trazado(cmds, op) {
        const o = op || {};
        if (!cmds.length) return pagina;
        let s = 'q ';
        const trazo = !o.sinTrazo && o.grosor !== 0;
        const relleno = o.relleno !== undefined && o.relleno !== null;
        if (trazo) {
          s += `${r2(o.grosor === undefined ? 0.5 : o.grosor)} w ${colorOps(o.color !== undefined ? o.color : (o.gris !== undefined ? o.gris : 0), true)}`;
          if (o.guion && o.guion.length) s += `[${o.guion.map(r2).join(' ')}] 0 d `;
          s += `${o.terminal === 'butt' ? 0 : 1} J ${o.union === 'miter' ? 0 : 1} j `;
        }
        if (relleno) s += colorOps(o.relleno, false);
        cmds.forEach((k) => {
          if (k[0] === 'M') s += `${r2(k[1])} ${r2(Y(k[2]))} m `;
          else if (k[0] === 'L') s += `${r2(k[1])} ${r2(Y(k[2]))} l `;
          else if (k[0] === 'C') s += `${r2(k[1])} ${r2(Y(k[2]))} ${r2(k[3])} ${r2(Y(k[4]))} ${r2(k[5])} ${r2(Y(k[6]))} c `;
          else if (k[0] === 'Z') s += 'h ';
        });
        const eo = o.evenodd ? '*' : '';
        s += relleno && trazo ? `B${eo}` : relleno ? `f${eo}` : trazo ? 'S' : 'n';
        ops.push(`${s} Q`);
        return pagina;
      },
      /** Polilínea (o polígono con cerrada: true) por una lista de puntos [x, y]. */
      ruta(puntos, op) {
        if (!puntos || puntos.length < 2) return pagina;
        const cmds = puntos.map((q, i) => [i ? 'L' : 'M', q[0], q[1]]);
        if (op && op.cerrada) cmds.push(['Z']);
        return pagina.trazado(cmds, op);
      },
      linea(x1, y1, x2, y2, op) { return pagina.ruta([[x1, y1], [x2, y2]], op); },
      rect(x, y, w, h, op) { return pagina.ruta([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { ...(op || {}), cerrada: true }); },
      circulo(cx, cy, r, op) { return pagina.trazado(elipse(cx, cy, r, r), op); },
      cerrar() { while (nivel > 0) pagina.restaurar(); return ops.join('\n'); },
    };
    return pagina;
  }

  const KAPPA = 0.5522847498307936;
  /** Elipse de centro (cx, cy) y radios rx, ry en cuatro curvas de Bézier. */
  function elipse(cx, cy, rx, ry) {
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    return [
      ['M', cx + rx, cy],
      ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
      ['Z'],
    ];
  }

  /* ---------------- Documento ---------------- */

  const latin1 = (s) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  };
  /** Hash simple (FNV-1a) para el /ID del archivo: el mismo contenido da el mismo identificador. */
  function huella(s) {
    let h1 = 0x811C9DC5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i += 1) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i), 0x85EBCA6B) >>> 0;
    }
    const hex = (n) => n.toString(16).padStart(8, '0');
    return hex(h1) + hex(h2) + hex((h1 ^ h2) >>> 0) + hex((h1 + h2) >>> 0);
  }

  /**
   * Documento nuevo. opciones: ancho y alto en puntos (carta 612 × 792), titulo, autor, asunto, fecha (AAAA-MM-DD).
   * `pagina()` agrega una hoja; `generar()` devuelve el PDF como Uint8Array.
   */
  function documento(opciones) {
    const o = opciones || {};
    const W = o.ancho || 612;
    const H = o.alto || 792;
    const paginas = [];
    return {
      ancho: W, alto: H,
      pagina() { const p = crearPagina(W, H); paginas.push(p); return p; },
      get numPaginas() { return paginas.length; },
      generar() {
        if (!paginas.length) paginas.push(crearPagina(W, H));
        const n = paginas.length;
        const objs = []; // cuerpo de cada objeto, numerados desde 1
        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objs[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${6 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`;
        objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.fecha || '');
        objs[5] = `<< /Producer ${cadena('COTIZAP')}${o.titulo ? ` /Title ${cadena(o.titulo)}` : ''}${o.autor ? ` /Author ${cadena(o.autor)}` : ''}${o.asunto ? ` /Subject ${cadena(o.asunto)}` : ''}${f ? ` /CreationDate (D:${f[1]}${f[2]}${f[3]}120000Z)` : ''} >>`;
        paginas.forEach((p, i) => {
          const contenido = p.cerrar();
          objs[6 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${r2(W)} ${r2(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ProcSet [/PDF /Text] >> /Contents ${7 + 2 * i} 0 R >>`;
          objs[7 + 2 * i] = `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`;
        });
        let cuerpo = '%PDF-1.4\n%âãÏÓ\n';
        const offsets = [];
        for (let i = 1; i < objs.length; i += 1) {
          offsets[i] = cuerpo.length;
          cuerpo += `${i} 0 obj\n${objs[i]}\nendobj\n`;
        }
        const inicioXref = cuerpo.length;
        const total = objs.length; // objetos 1..N más el 0 de la lista libre
        let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
        for (let i = 1; i < total; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        const id = huella(cuerpo);
        const trailer = `trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${inicioXref}\n%%EOF`;
        return latin1(cuerpo + xref + trailer);
      },
    };
  }

  /* ---------------- Árbol SVG de planos.js → página ---------------- */

  const NEGRO = 0;
  const AZUL = [0.05, 0.25, 0.6];
  const OCRE = [0.72, 0.3, 0.02];
  /** Estilo en puntos de cada clase del dibujo (las de estilos.css, con trazos de papel). */
  const ESTILOS = {
    'pl-pieza': { grosor: 0.9, gris: NEGRO },
    'pl-junta': { grosor: 0.5, gris: NEGRO },
    'pl-corte': { grosor: 0.5, gris: NEGRO },
    'pl-barra': { grosor: 2.2, gris: NEGRO },
    'pl-anillo': { grosor: 0.9, gris: NEGRO, relleno: 0.9 },
    'pl-relleno': { sinTrazo: true, relleno: 0.9 },
    'pl-barreno': { grosor: 0.5, gris: NEGRO, relleno: 1 },
    'pl-brida': { grosor: 1.8, gris: NEGRO, terminal: 'butt' },
    'pl-brida-suelta': { grosor: 1.2, gris: NEGRO, terminal: 'butt', guion: [2.5, 2] },
    'pl-soldadura': { grosor: 1.8, color: OCRE },
    'pl-engargolado': { grosor: 1.3, color: OCRE, guion: [3, 1.5] },
    'pl-eje': { grosor: 0.4, gris: 0.45, guion: [5, 1.5, 1, 1.5] },
    'pl-eje-fino': { grosor: 0.4, gris: 0.45, guion: [5, 1.5, 1, 1.5] },
    'pl-oculta': { grosor: 0.4, gris: 0.45, guion: [2.5, 2] },
    'pl-cota': { grosor: 0.5, color: AZUL },
    'pl-ext': { grosor: 0.35, color: AZUL },
    'pl-flecha': { sinTrazo: true, relleno: AZUL },
  };
  const estiloDe = (clase) => {
    const k = String(clase || '').split(/\s+/).find((c) => ESTILOS[c]);
    return k ? ESTILOS[k] : { grosor: 0.6, gris: NEGRO };
  };

  /* Matrices afines [a, b, c, d, e, f] como en SVG */
  const IDENT = [1, 0, 0, 1, 0, 0];
  const mul = (A, B) => [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
  const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const numeros = (s) => (String(s).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
  /** Matriz de un atributo transform («rotate(30 5 5) translate(2,3)»); null si trae algo que no se entiende. */
  function leerTransform(t) {
    if (!t) return IDENT;
    let m = IDENT;
    const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
    let hallado = false;
    let r = re.exec(t);
    while (r) {
      hallado = true;
      const v = numeros(r[2]);
      let k = IDENT;
      if (r[1] === 'matrix' && v.length === 6) k = v;
      else if (r[1] === 'translate') k = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
      else if (r[1] === 'scale') k = [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0];
      else if (r[1] === 'rotate') {
        const a = ((v[0] || 0) * Math.PI) / 180;
        const g = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        k = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], g), [1, 0, 0, 1, -v[1], -v[2]]) : g;
      } else return null;
      m = mul(m, k);
      r = re.exec(t);
    }
    return hallado ? m : null;
  }

  /** Arco SVG (parámetros de extremos) → curvas de Bézier cúbicas [[x1, y1, x2, y2, x, y]…] en el sistema local. */
  function arcoABeziers(x0, y0, rx0, ry0, fi, grande, barrido, x, y) {
    let rx = Math.abs(rx0);
    let ry = Math.abs(ry0);
    if (!rx || !ry || (x0 === x && y0 === y)) return [[x0, y0, x, y, x, y]];
    const f = (fi * Math.PI) / 180;
    const c = Math.cos(f);
    const s = Math.sin(f);
    const dx = (x0 - x) / 2;
    const dy = (y0 - y) / 2;
    const x1 = c * dx + s * dy;
    const y1 = -s * dx + c * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const sg = (grande ? 1 : 0) === (barrido ? 1 : 0) ? -1 : 1;
    const co = sg * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * rx * y1) / ry;
    const cyp = (-co * ry * x1) / rx;
    const cx = c * cxp - s * cyp + (x0 + x) / 2;
    const cy = s * cxp + c * cyp + (y0 + y) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!barrido && dt > 0) dt -= 2 * Math.PI;
    else if (barrido && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
    const paso = dt / n;
    const k = (4 / 3) * Math.tan(paso / 4);
    const pt = (t) => [cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c];
    const dv = (t) => [-rx * Math.sin(t) * c - ry * Math.cos(t) * s, -rx * Math.sin(t) * s + ry * Math.cos(t) * c];
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const a = t1 + i * paso;
      const b = a + paso;
      const p0 = pt(a); const p1 = pt(b); const d0 = dv(a); const d1 = dv(b);
      out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], i === n - 1 ? x : p1[0], i === n - 1 ? y : p1[1]]);
    }
    return out;
  }

  /** Atributo `d` de un path → órdenes absolutas en el sistema local ([['M', x, y], ['L', …], ['C', …], ['Z']]); null si no se entiende. */
  function leerPath(d) {
    const tokens = String(d).match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const out = [];
    let i = 0;
    let cmd = '';
    let cx = 0; let cy = 0; let ix = 0; let iy = 0;
    const lee = (n) => {
      const v = [];
      for (let k = 0; k < n; k += 1) {
        const t = tokens[i];
        if (t === undefined || /^[A-Za-z]$/.test(t)) return null;
        v.push(Number(t)); i += 1;
      }
      return v;
    };
    while (i < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i]; i += 1; if (cmd === 'Z' || cmd === 'z') { out.push(['Z']); cx = ix; cy = iy; continue; } }
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'M' || C === 'L') {
        const v = lee(2); if (!v) return null;
        const x = rel ? cx + v[0] : v[0]; const y = rel ? cy + v[1] : v[1];
        out.push([C === 'M' ? 'M' : 'L', x, y]);
        cx = x; cy = y;
        if (C === 'M') { ix = x; iy = y; cmd = rel ? 'l' : 'L'; }
      } else if (C === 'H') {
        const v = lee(1); if (!v) return null;
        cx = rel ? cx + v[0] : v[0]; out.push(['L', cx, cy]);
      } else if (C === 'V') {
        const v = lee(1); if (!v) return null;
        cy = rel ? cy + v[0] : v[0]; out.push(['L', cx, cy]);
      } else if (C === 'C') {
        const v = lee(6); if (!v) return null;
        const q = rel ? [cx + v[0], cy + v[1], cx + v[2], cy + v[3], cx + v[4], cy + v[5]] : v;
        out.push(['C', ...q]); cx = q[4]; cy = q[5];
      } else if (C === 'A') {
        const v = lee(7); if (!v) return null;
        const x = rel ? cx + v[5] : v[5]; const y = rel ? cy + v[6] : v[6];
        arcoABeziers(cx, cy, v[0], v[1], v[2], v[3], v[4], x, y).forEach((b) => out.push(['C', ...b]));
        cx = x; cy = y;
      } else return null;
    }
    return out;
  }

  /**
   * Pinta un árbol SVG de planos.arbol(...) en la caja { x, y, w, h } de la página, escalado para que quepa entero y centrado.
   * El dibujo ya viene con el eje y hacia abajo, igual que la página de esta API. opciones: tamMin (puntos, 5) para los textos.
   * Devuelve { escala, omitidos, nodos }: cuántos nodos se omitieron por no poderse pintar.
   */
  function dibujarArbol(pagina, arbol, caja, opciones) {
    const o = opciones || {};
    const tamMin = o.tamMin || 5;
    const vb = numeros((arbol && arbol.a && arbol.a.viewBox) || '');
    if (!arbol || vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return { escala: 0, omitidos: 0, nodos: 0 };
    const k = Math.min(caja.w / vb[2], caja.h / vb[3]);
    const raiz = [k, 0, 0, k, caja.x + (caja.w - vb[2] * k) / 2 - vb[0] * k, caja.y + (caja.h - vb[3] * k) / 2 - vb[1] * k];
    let omitidos = 0;
    let nodos = 0;

    const pintar = (cmds, m, est, extra) => {
      const mapa = cmds.map((c) => {
        const r = [c[0]];
        for (let j = 1; j + 1 < c.length; j += 2) r.push(...aplicar(m, c[j], c[j + 1]));
        return r;
      });
      pagina.trazado(mapa, { ...est, ...(extra || {}) });
    };

    function nodo(n, m) {
      if (!n || typeof n !== 'object') return;
      nodos += 1;
      const T = leerTransform(n.a && n.a.transform);
      if (T === null) { omitidos += 1; return; }
      const mm = mul(m, T);
      const a = n.a || {};
      const est = estiloDe(a.class);
      const extra = a['fill-rule'] === 'evenodd' ? { evenodd: true } : {};
      try {
        switch (n.tag) {
          case 'svg': case 'g': case 'a': (n.c || []).forEach((h) => nodo(h, mm)); return;
          case 'line':
            pintar([['M', +a.x1, +a.y1], ['L', +a.x2, +a.y2]], mm, { ...est, relleno: undefined }); return;
          case 'polyline': case 'polygon': {
            const v = numeros(a.points || '');
            if (v.length < 4) return;
            const cmds = [];
            for (let j = 0; j + 1 < v.length; j += 2) cmds.push([j ? 'L' : 'M', v[j], v[j + 1]]);
            if (n.tag === 'polygon') cmds.push(['Z']);
            pintar(cmds, mm, n.tag === 'polyline' ? { ...est, relleno: undefined } : est, extra); return;
          }
          case 'rect': {
            const x = +a.x || 0; const y = +a.y || 0; const w = +a.width; const h = +a.height;
            if (!(w > 0 && h > 0)) return;
            pintar([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], mm, est); return;
          }
          case 'circle': case 'ellipse': {
            const rx = n.tag === 'circle' ? +a.r : +a.rx; const ry = n.tag === 'circle' ? +a.r : +a.ry;
            if (!(rx > 0 && ry > 0)) return;
            pintar(elipse(+a.cx || 0, +a.cy || 0, rx, ry), mm, est); return;
          }
          case 'path': {
            const cmds = leerPath(a.d || '');
            if (!cmds || !cmds.length) { omitidos += 1; return; }
            pintar(cmds, mm, est, extra); return;
          }
          case 'text': {
            const txt = n.t === undefined || n.t === null ? '' : String(n.t);
            if (!txt) return;
            const sc = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
            const tam = Math.max(tamMin, (+a['font-size'] || 10) * sc);
            const ang = (Math.atan2(mm[1], mm[0]) * 180) / Math.PI;
            const rad = (ang * Math.PI) / 180;
            let [px, py] = aplicar(mm, +a.x || 0, +a.y || 0);
            if (a['dominant-baseline'] === 'middle') { px += -Math.sin(rad) * 0.35 * tam; py += Math.cos(rad) * 0.35 * tam; }
            const ancla = a['text-anchor'] === 'end' ? 'right' : a['text-anchor'] === 'middle' ? 'center' : 'left';
            pagina.texto(px, py, txt, { tam, negrita: true, align: ancla, ang, color: NEGRO });
            return;
          }
          default: omitidos += 1;
        }
      } catch (e) { omitidos += 1; }
    }

    pagina.guardar().recortar(caja.x, caja.y, caja.w, caja.h);
    nodo(arbol, raiz);
    pagina.restaurar();
    return { escala: k, omitidos, nodos };
  }

  return { documento, ancho, ajustar, winAnsi, cadena, dibujarArbol, leerPath, leerTransform, ESTILOS, CARTA: { ancho: 612, alto: 792 } };
}));
