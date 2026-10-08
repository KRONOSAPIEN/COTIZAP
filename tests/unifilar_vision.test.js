/**
 * La etapa de visión sin el navegador (src/motor/unifilar_vision.js): cómo se reparte la foto en imágenes, qué se le pide al
 * modelo, qué textos se releen en recortes ampliados y cómo entra lo releído a la lectura que despiezan las reglas.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMaestros } = require('../src/datos/maestros');
const UF = require('../src/motor/unifilar');
const V = require('../src/motor/unifilar_vision');
const EJEMPLO = require('../src/datos/unifilar_ejemplo');

const lecturaEjemplo = () => UF.leer(EJEMPLO).lectura;

test('planDeImagen: la hoja completa a 1.15 MP como mucho y, si la foto es mucho mayor, recortes que se traslapan', () => {
  const p = V.planDeImagen(4032, 3024, 5);
  assert.ok(p.enviado.w * p.enviado.h <= V.MAX_PX);
  assert.deepEqual(p.enviado, { w: 1238, h: 928 });
  assert.equal(p.recortes.length, 4);
  // los recortes cubren toda la foto, se traslapan y se mandan a más resolución que la hoja completa
  const r = p.recortes;
  assert.deepEqual([r[0].origen.x, r[0].origen.y, r[3].origen.x + r[3].origen.w, r[3].origen.y + r[3].origen.h], [0, 0, 4032, 3024]);
  assert.ok(r[1].origen.x < r[0].origen.w, 'se traslapan');
  r.forEach((x) => {
    assert.ok(x.salida.w * x.salida.h <= V.MAX_PX);
    assert.ok(x.salida.w / x.origen.w > p.escala * 1.5, 'más resolución que la hoja');
  });
  assert.deepEqual([r[3].x, r[3].y, r[3].w, r[3].h], [545, 408, 693, 520], 'en coordenadas de la hoja enviada');
  // con menos imágenes por llamada: dos mitades; con una sola o una foto chica: ninguna
  assert.equal(V.planDeImagen(4032, 3024, 3).recortes.length, 2);
  assert.equal(V.planDeImagen(4032, 3024, 1).recortes.length, 0);
  const chica = V.planDeImagen(1000, 800, 5);
  assert.deepEqual([chica.escala, chica.enviado.w, chica.recortes.length], [1, 1000, 0]);
  assert.throws(() => V.planDeImagen(0, 10, 5));
});

test('promptLectura: dice el tamaño de la hoja, dónde cae cada recorte, las reglas de lectura y el formato', () => {
  const p = V.planDeImagen(4032, 3024, 5);
  const t = V.promptLectura(p);
  assert.match(t, /Imagen 1: la hoja completa, 1238 × 928 px/);
  assert.match(t, /Imagen 5 \(R-04\): la zona x 545–1238, y 408–928 de la imagen 1/);
  assert.match(t, /No inventes/);
  assert.match(t, /cotas_totales/);
  assert.match(t, /boca_diametro/);
  assert.ok(Buffer.byteLength(t, 'utf8') < 262144, 'cabe en una llamada');
  // el ejemplo de la forma es una lectura válida para las reglas
  const ej = JSON.parse(t.slice(t.indexOf('{"version"'), t.indexOf('\n\nResponde sólo')));
  assert.deepEqual(UF.leer(ej).errores, []);
  assert.doesNotMatch(V.promptLectura(V.planDeImagen(800, 600, 5)), /Imagen 2/);
});

test('completarLectura: la fuente, la fecha y lo que el modelo no manda', () => {
  const plan = V.planDeImagen(4032, 3024, 5);
  const L = V.completarLectura({ metadatos: { vista: 'PLANTA' }, red: { nodos: [], aristas: [], textos: [] } }, { archivo: 'foto.jpg', ancho: 4032, alto: 3024, plan, fecha: '2026-10-08T12:00:00Z' });
  assert.deepEqual([L.version, L.metadatos.fuente.archivo, L.metadatos.fuente.ancho_enviado_px, L.metadatos.fuente.recortes.length, L.metadatos.fecha], ['1.0', 'foto.jpg', 1238, 4, '2026-10-08T12:00:00Z']);
  assert.deepEqual([L.red.cotas_totales, L.equipos, L.alertas_ambiguedad, L.metadatos.yarda_mm], [[], [], [], 914.4]);
});

test('dudosos: cotas, diámetros y ángulos con confianza < 0.9 (los ilegibles sólo si están junto a algo), con su recorte', () => {
  const d = V.dudosos(lecturaEjemplo(), 8, { w: 2576, h: 1932 });
  assert.deepEqual(d.map((x) => x.texto_id), ['T-011', 'T-010'], 'la «x» suelta no se relee; 0.90 ya es seguro');
  const r = d[0].recorte;
  assert.ok(r.w >= 120 && r.x <= 1470 && r.x + r.w >= 1470 + 86, 'el recorte contiene el texto con margen');
  assert.equal(V.dudosos(lecturaEjemplo(), 1, { w: 2576, h: 1932 }).length, 1);
  assert.match(V.promptRelectura(d), /1\) T-011: se leyó «1\.\? m» como ILEGIBLE con confianza 0\.41, junto a A-005/);
});

test('aplicarRelectura: sólo lo más seguro entra, y con ello la cota que faltaba; las reglas dejan de estimarla', () => {
  const L = lecturaEjemplo();
  const { lectura, cambios } = V.aplicarRelectura(L, [
    { texto_id: 'T-011', contenido_crudo: '1.6 m', contenido_normalizado: '1.6', tipo: 'LONGITUD', confianza_ocr: 0.86 },
    { texto_id: 'T-010', contenido_crudo: '6"', contenido_normalizado: '6', tipo: 'DIAMETRO', confianza_ocr: 0.6 }, // menos seguro: no entra
    { texto_id: 'T-999', contenido_crudo: '9', tipo: 'LONGITUD', confianza_ocr: 1 }, // no existe
    'basura',
  ]);
  assert.deepEqual(cambios, ['T-011: «1.? m» (0.41) → «1.6 m» (0.86)']);
  assert.deepEqual(lectura.red.aristas.find((a) => a.id === 'A-005').longitud_cota, { valor: 1.6, unidad: 'm', origen: 'OCR', confianza: 0.86, texto_id: 'T-011' });
  assert.equal(lectura.red.aristas.find((a) => a.id === 'A-005').diametro.valor, 5);
  assert.equal(L.red.aristas.find((a) => a.id === 'A-005').longitud_cota.valor, null, 'no muta lo recibido');
  const bom = UF.despiezar(UF.leer(lectura).lectura, crearMaestros(), {});
  const a5 = bom.alertas_ambiguedad.filter((a) => a.referencias.includes('A-005')).map((a) => `${a.severidad} ${a.codigo}`);
  assert.ok(a5.includes('ADVERTENCIA LECTURA_DUDOSA') && !a5.some((x) => /COTA_ILEGIBLE/.test(x)));
  assert.equal(bom.ductos_rectos.find((d) => d.arista_id === 'A-005').longitud_neta_mm, 1250);
  // sigue sin leerse: el texto mejora un poco, la medida queda vacía
  const sigue = V.aplicarRelectura(L, [{ texto_id: 'T-011', contenido_crudo: '1.? m', contenido_normalizado: null, tipo: 'ILEGIBLE', confianza_ocr: 0.45 }]).lectura;
  assert.equal(sigue.red.aristas.find((a) => a.id === 'A-005').longitud_cota.valor, null);
  // el calibre del cuadro de datos
  const cal = V.aplicarRelectura(lecturaEjemplo(), [{ texto_id: 'T-023', contenido_crudo: 'GALV CAL 20', contenido_normalizado: 'GALVANIZADO 20', tipo: 'CALIBRE', confianza_ocr: 0.97 }]).lectura;
  assert.equal(cal.metadatos.calibre.valor, 20);
  assert.deepEqual(V.aplicarRelectura(L, null).cambios, []);
});
