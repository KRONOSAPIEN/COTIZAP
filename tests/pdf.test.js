'use strict';
/**
 * Escritor de PDF (src/web/pdf.js) y la hoja de la lista de fabricación (src/web/lista_pdf.js): estructura (cabecera, xref con
 * offsets exactos, startxref, páginas), codificación WinAnsi, métricas de texto, dibujo del árbol de planos y, si existen en la
 * máquina, la validación con qpdf o pdftotext.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PDF = require('../src/web/pdf');
const PL = require('../src/web/planos');
const LP = require('../src/web/lista_pdf');
const LF = require('../src/motor/lista_fabricacion');
const { crearMaestros } = require('../src/datos/maestros');
const E = require('../src/datos/ejemplos');
const C = require('../src/motor/cotizador');

const M = crearMaestros();
const cot = E.pedidoDucteria();
const res = C.cotizar(cot, M);
const lista = LF.listaFabricacion(cot, res, res.maestros);
const salida = LP.generar(lista);
const texto = (b) => Buffer.from(b).toString('latin1');

/** ¿Existe el programa en el PATH? */
function hay(cmd) {
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

test('PDF: empieza con %PDF-1.4, termina con %%EOF y es un Uint8Array', () => {
  assert.ok(salida.bytes instanceof Uint8Array);
  const t = texto(salida.bytes);
  assert.ok(t.startsWith('%PDF-1.4\n'));
  assert.ok(t.endsWith('%%EOF'));
  // la segunda línea son bytes altos: avisa a los programas que el archivo es binario
  assert.ok(salida.bytes[10] > 127);
});

test('PDF: la tabla xref apunta con offsets exactos a «n 0 obj» y startxref apunta a la tabla', () => {
  const t = texto(salida.bytes);
  const sx = /startxref\n(\d+)\n%%EOF$/.exec(t);
  assert.ok(sx, 'startxref');
  const pos = Number(sx[1]);
  assert.equal(t.slice(pos, pos + 5), 'xref\n');
  const m = /^xref\n0 (\d+)\n/.exec(t.slice(pos));
  const n = Number(m[1]);
  const filas = t.slice(pos + m[0].length).split('\n').slice(0, n);
  assert.equal(filas.length, n);
  assert.ok(filas.every((f) => f.length === 19), 'cada entrada ocupa 20 bytes con su salto de línea');
  assert.equal(filas[0], '0000000000 65535 f ');
  for (let i = 1; i < n; i += 1) {
    assert.match(filas[i], /^\d{10} 00000 n $/);
    const off = Number(filas[i].slice(0, 10));
    assert.ok(t.startsWith(`${i} 0 obj\n`, off), `el objeto ${i} está en el byte ${off}`);
  }
  // no hay otro objeto sin referencia
  assert.equal((t.match(/\d+ 0 obj\n/g) || []).length, n - 1);
  assert.match(t, new RegExp(`trailer\\n<< /Size ${n} /Root 1 0 R`));
});

test('PDF: el número de páginas del árbol coincide con /Count y con las hojas de la lista', () => {
  const t = texto(salida.bytes);
  const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(t)[1]);
  const paginas = (t.match(/\/Type \/Page \/Parent/g) || []).length;
  const kids = (/\/Kids \[([^\]]*)\]/.exec(t)[1].match(/\d+ 0 R/g) || []).length;
  assert.equal(count, paginas);
  assert.equal(kids, paginas);
  assert.equal(paginas, salida.paginas);
  assert.ok(paginas >= 10);
  assert.match(t, /\/MediaBox \[0 0 612 792\]/);
  // cada hoja dice «Hoja n de N»
  assert.ok(t.includes(`(Hoja ${paginas} de ${paginas})`));
  assert.ok(t.includes('(Hoja 1 de ' + paginas + ')'));
  // las longitudes de los flujos son las reales
  const re = /<< \/Length (\d+) >>\nstream\n/g;
  let r = re.exec(t);
  let n = 0;
  while (r) {
    const ini = r.index + r[0].length;
    assert.equal(t.slice(ini + Number(r[1]), ini + Number(r[1]) + 10), '\nendstream');
    n += 1;
    r = re.exec(t);
  }
  assert.equal(n, paginas);
});

test('PDF: acentos, ñ, Ø, × y ″ se codifican en WinAnsi, sin bytes fuera de la tabla', () => {
  const b = PDF.winAnsi('Reducción de Ø11″ × 5″ · pequeña ñandú ¼ – ≈ ≤ ≥ ′ β → €');
  const permitidos = (c) => (c >= 32 && c <= 255) && ![127, 129, 141, 143, 144, 157].includes(c);
  assert.ok(b.every(permitidos), JSON.stringify(b));
  assert.deepEqual(PDF.winAnsi('ñ'), [0xF1]);
  assert.deepEqual(PDF.winAnsi('Ø×'), [0xD8, 0xD7]);
  assert.deepEqual(PDF.winAnsi('″'), [0x22]);
  assert.deepEqual(PDF.winAnsi('′'), [0x27]);
  assert.deepEqual(PDF.winAnsi('–'), [0x96]);
  assert.deepEqual(PDF.winAnsi('≈'), [0x7E]);
  assert.deepEqual(PDF.winAnsi('≤'), [0x3C, 0x3D]);
  assert.deepEqual(PDF.winAnsi('é'), [0xE9]);
  assert.deepEqual(PDF.winAnsi('é'), [0xE9], 'una letra con acento suelto se compone');
  // en el archivo, el texto va en ASCII (los bytes altos como octal), con los paréntesis escapados
  const doc = PDF.documento();
  doc.pagina().texto(40, 40, 'Ø11″ × ñ (a) \\ ≥', { tam: 10 });
  const t = texto(doc.generar());
  assert.ok(t.includes('(\\330' + '11" \\327 \\361 \\(a\\) \\\\ >=) Tj'), t.slice(t.indexOf('BT'), t.indexOf('ET') + 2));
  const cuerpo = t.slice(t.indexOf('stream\n'), t.indexOf('endstream'));
  assert.ok([...cuerpo].every((c) => c.charCodeAt(0) < 128));
  assert.match(t, /\/Encoding \/WinAnsiEncoding/);
  assert.match(t, /\/BaseFont \/Helvetica-Bold/);
});

test('PDF: el ancho del texto sale de las métricas AFM de Helvetica y Helvetica-Bold', () => {
  const casi = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  casi(PDF.ancho('Hello', 10, false), 22.78); // 722 + 556 + 222 + 222 + 556
  casi(PDF.ancho('Hello', 10, true), 24.45); // 722 + 556 + 278 + 278 + 611
  casi(PDF.ancho(' ', 1000, false), 278);
  casi(PDF.ancho('á', 1000, false), PDF.ancho('a', 1000, false));
  casi(PDF.ancho('Ø', 1000, false), 778);
  casi(PDF.ancho('×', 1000, true), 584);
  casi(PDF.ancho('W', 1000, false), 944);
  casi(PDF.ancho('1234567890', 10, false), 55.6);
  const lineas = PDF.ajustar('Unir reducción de 11″ a 10″ con injerto de 5″ con codo de 60° para obtener 90°', 110, 8, false);
  assert.ok(lineas.length >= 3);
  assert.ok(lineas.every((l) => PDF.ancho(l, 8, false) <= 110));
  assert.equal(lineas.join(' '), 'Unir reducción de 11″ a 10″ con injerto de 5″ con codo de 60° para obtener 90°');
  // una palabra más ancha que el renglón se parte; el salto de línea se respeta
  const larga = PDF.ajustar('Supercalifragilisticoespialidoso', 60, 8, false);
  assert.ok(larga.length > 1 && larga.every((l) => PDF.ancho(l, 8, false) <= 60));
  assert.deepEqual(PDF.ajustar('a\nb', 100, 8, false), ['a', 'b']);
});

test('PDF: el árbol de planos se convierte a vectores: toda pieza se dibuja sin omitir nodos ni NaN', () => {
  let con = 0;
  lista.piezas.forEach((q) => {
    const arbol = PL.arbol(q.dibujo, { px: 260, alto_max: 220 });
    const doc = PDF.documento();
    const pg = doc.pagina();
    const r = PDF.dibujarArbol(pg, arbol, { x: 40, y: 40, w: 180, h: 150 });
    assert.equal(r.omitidos, 0, `${q.marca}: nodos omitidos`);
    assert.ok(r.nodos > 5 && r.escala > 0, q.marca);
    const t = texto(doc.generar());
    assert.doesNotMatch(t, /NaN|Infinity|undefined/, q.marca);
    assert.match(t, / m [-\d. ]+ l /, `${q.marca}: lleva trazos`);
    con += 1;
  });
  assert.equal(con, 36);
  // lo que no se puede pintar se omite sin romper
  const doc = PDF.documento();
  const pg = doc.pagina();
  const r = PDF.dibujarArbol(pg, {
    tag: 'svg', a: { viewBox: '0 0 100 100' },
    c: [{ tag: 'image', a: {}, c: [] }, { tag: 'path', a: { d: 'M 0 0 Q 5 5 9 9' }, c: [] }, { tag: 'g', a: { transform: 'skewX(30)' }, c: [{ tag: 'circle', a: { cx: 5, cy: 5, r: 2 }, c: [] }] },
      { tag: 'g', a: { transform: 'translate(10 10) rotate(90)' }, c: [{ tag: 'text', a: { x: 0, y: 0, 'font-size': 8 }, c: [], t: 'ok' }, { tag: 'line', a: { x1: 0, y1: 0, x2: 20, y2: 0 }, c: [] }] }],
  }, { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(r.omitidos, 3);
  assert.ok(texto(doc.generar()).includes('(ok) Tj'));
});

test('PDF: el eje y del SVG (hacia abajo) se voltea al del PDF (hacia arriba)', () => {
  const doc = PDF.documento();
  const pg = doc.pagina();
  PDF.dibujarArbol(pg, { tag: 'svg', a: { viewBox: '0 0 100 100' }, c: [{ tag: 'polyline', a: { points: '0,0 100,0', class: 'pl-pieza' }, c: [] }] }, { x: 100, y: 100, w: 100, h: 100 });
  const t = texto(doc.generar());
  // un trazo en lo alto del dibujo (y = 100 de la caja desde arriba) queda en y = 792 − 100 = 692 del PDF
  assert.match(t, /100 692 m 200 692 l S/);
  const doc2 = PDF.documento();
  const pg2 = doc2.pagina();
  pg2.texto(72, 100, 'x', { tam: 10 });
  assert.match(texto(doc2.generar()), /1 0 0 1 72 692 Tm/);
});

test('Lista PDF: nombre del archivo en minúsculas, sin acentos y con la fecha', () => {
  assert.equal(LP.nombreArchivo({ encabezado: { proyecto: 'Colector de polvo · línea 2', fecha: '2026-10-16' } }), 'lista-fabricacion-colector-de-polvo-linea-2-2026-10-16.pdf');
  assert.equal(LP.nombreArchivo({ encabezado: { proyecto: '', folio: 'COT-Ñandú/07', fecha: '2026-10-16' } }), 'lista-fabricacion-cot-nandu-07-2026-10-16.pdf');
  assert.equal(LP.nombreArchivo({ encabezado: { proyecto: '', folio: '', fecha: '' } }), 'lista-fabricacion-sin-proyecto.pdf');
  assert.match(LP.nombreArchivo(lista), /^lista-fabricacion-[a-z0-9-]+-2026-09-30\.pdf$/);
});

test('Lista PDF: la hoja trae encabezado, una tarjeta por pieza, el resumen y lo que no se fabrica; nada de precios', () => {
  const t = texto(salida.bytes);
  assert.ok(t.includes('(Lista de fabricaci\\363n) Tj'));
  lista.piezas.forEach((q) => assert.ok(t.includes(`(${q.marca}) Tj`), q.marca));
  assert.ok(t.includes('(Resumen) Tj') && t.includes('(No se fabrican aqu\\355) Tj'));
  assert.ok(!t.includes('$'), 'sin signos de pesos');
  assert.ok(!/Hoja 0 de|undefined|NaN/.test(t));
  // una cotización con partidas aparte las nombra con su motivo
  const cot2 = { proyecto: 'P', cliente: 'C', fecha: '2026-10-16', partidas: [
    { id: 'a', familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16, tipo_union: 'BRIDADO', D_mm: 304.8, L_mm: 3000, cantidad: 1 },
    { id: 'i', familia: 'INSTALACION', descripcion: 'Instalación en obra', personas: 2, dias: 2, viajes: 0, cantidad: 1 },
  ] };
  const r2 = C.cotizar(cot2, M);
  const l2 = LF.listaFabricacion(cot2, r2, r2.maestros);
  const s2 = texto(LP.generar(l2).bytes);
  assert.ok(s2.includes('(Instalaci\\363n en obra) Tj') && s2.includes('no se fabrica'));
});

test('Lista PDF: una tarjeta nunca se parte entre hojas: cada una cabe entera entre el encabezado y el pie', () => {
  assert.equal(salida.tarjetas.length, 36);
  salida.tarjetas.forEach((t) => {
    assert.ok(t.y >= salida.tope - 1e-9 && t.y + t.alto <= salida.fondo + 1e-9, `${t.marca}: y ${t.y} + ${t.alto}`);
    assert.ok(t.pagina >= 1 && t.pagina <= salida.paginas);
  });
  // en cada hoja las tarjetas no se encimen y caben dos o tres
  const porHoja = {};
  salida.tarjetas.forEach((t) => { (porHoja[t.pagina] = porHoja[t.pagina] || []).push(t); });
  Object.values(porHoja).forEach((ts) => {
    assert.ok(ts.length >= 1 && ts.length <= 3);
    ts.slice(1).forEach((t, i) => assert.ok(t.y >= ts[i].y + ts[i].alto));
  });
  assert.ok(Object.values(porHoja).some((ts) => ts.length === 3), 'las piezas chicas caben de tres en tres');
  assert.ok(Object.values(porHoja).some((ts) => ts.length === 2), 'las grandes de dos en dos');
  // una pieza con muchísimas especificaciones achica la letra antes de partirse
  const q = { ...lista.piezas[0], medidas: Array.from({ length: 110 }, (_, i) => ({ etiqueta: `Medida ${i}`, valor: `${i} mm` })) };
  const gigante = LP.generar({ ...lista, piezas: [q], aparte: [] });
  assert.equal(gigante.tarjetas.length, 1);
  assert.ok(gigante.tarjetas[0].alto <= gigante.fondo - gigante.tope && gigante.tarjetas[0].letra < 8);
});

test('PDF del ejemplo: lo validan qpdf o pdftotext si existen', (ctx) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotizap-pdf-'));
  const archivo = path.join(dir, 'lista.pdf');
  fs.writeFileSync(archivo, salida.bytes);
  let probado = false;
  try {
    if (hay('qpdf')) {
      const o = execFileSync('qpdf', ['--check', archivo], { encoding: 'utf8' });
      assert.match(o, /No syntax or stream encoding errors found/);
      probado = true;
    }
    if (hay('pdftotext')) {
      const tx = execFileSync('pdftotext', ['-layout', archivo, '-'], { encoding: 'utf8' });
      assert.match(tx, /Lista de fabricación/);
      assert.match(tx, /C1/);
      assert.match(tx, /Hoja 1 de \d+/);
      assert.match(tx, /No se fabrican aquí/);
      assert.match(tx, /Ø11″|Ø11"|11"/);
      probado = true;
    }
    if (hay('pdfinfo')) {
      const info = execFileSync('pdfinfo', [archivo], { encoding: 'utf8' });
      assert.match(info, new RegExp(`Pages:\\s+${salida.paginas}\\b`));
      assert.match(info, /Page size:\s+612 x 792 pts \(letter\)/);
      probado = true;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!probado) ctx.skip('ni qpdf, ni pdftotext, ni pdfinfo están instalados');
});
