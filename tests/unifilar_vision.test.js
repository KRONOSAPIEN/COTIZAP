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

test('ambiguas y aplicarRelectura: un texto entre dos líneas se queda con la que diga la re-lectura y la otra pierde la cota', () => {
  // la lectura puso «3.6 m» (T-009) en A-005 y dudó entre A-005 y A-004
  const x = JSON.parse(JSON.stringify(EJEMPLO));
  const a4 = x.red.aristas.find((a) => a.id === 'A-004');
  const a5 = x.red.aristas.find((a) => a.id === 'A-005');
  a5.longitud_cota = { ...a4.longitud_cota };
  a4.longitud_cota = { valor: null, unidad: 'm', origen: 'OCR', confianza: 0, texto_id: null };
  x.red.textos.find((t) => t.id === 'T-009').asociado_a = 'A-005';
  x.alertas_ambiguedad = [{ codigo: 'ASOCIACION_AMBIGUA', severidad: 'CONFIRMAR', referencias: ['T-009', 'A-005', 'A-004'], mensaje: '«3.6 m» queda entre dos líneas.' }];
  const L = UF.leer(x).lectura;
  const amb = V.ambiguas(L, 8, { w: 2576, h: 1932 });
  assert.equal(amb.length, 1);
  assert.deepEqual([amb[0].clase, amb[0].texto_id, amb[0].candidatas, amb[0].trazos.map((t) => t.etiqueta)], ['ASOCIACION', 'T-009', ['A-005', 'A-004'], ['1', '2']]);
  const r = amb[0].recorte;
  assert.ok(r.x <= 1350 && r.x + r.w >= 1446 && r.w >= 260, 'el recorte contiene el texto');
  const items = [...amb, ...V.dudosos(L, 7, { w: 2576, h: 1932 })];
  assert.match(V.promptRelectura(items), /1\) El texto T-009 «3\.6 m» \(encuadrado en azul\): ¿pertenece a la línea marcada 1 \(magenta, A-005\) o a la marcada 2 \(verde, A-004\)\?/);
  // poca seguridad: no cambia nada y la alerta lo dice
  const dudoso = V.aplicarRelectura(L, [{ n: 1, pertenece_a: 2, confianza: 0.5 }], items).lectura;
  assert.equal(dudoso.alertas_ambiguedad.length, 1);
  assert.match(dudoso.alertas_ambiguedad[0].mensaje, /no lo aclara/);
  // seguro: la cota pasa a A-004, A-005 se queda sin cota (la estimarán las reglas) y la alerta se va
  const { lectura, cambios } = V.aplicarRelectura(L, [{ n: 1, pertenece_a: 2, confianza: 0.9 }], items);
  assert.deepEqual([lectura.red.aristas.find((a) => a.id === 'A-004').longitud_cota.valor, lectura.red.aristas.find((a) => a.id === 'A-005').longitud_cota.valor], [3.6, null]);
  assert.equal(lectura.red.textos.find((t) => t.id === 'T-009').asociado_a, 'A-004');
  assert.equal(lectura.alertas_ambiguedad.length, 0);
  assert.deepEqual(cambios, ['T-009 «3.6 m» va con A-004, no con A-005 (0.9)']);
  const bom = UF.despiezar(UF.leer(lectura).lectura, crearMaestros(), {});
  assert.equal(bom.ductos_rectos.find((d) => d.arista_id === 'A-004').longitud_cota_mm, 3600);
});

test('Un cruce: si la re-lectura confirma que no se unen, la alerta se va; si dice que sí, se queda y lo explica', () => {
  const med = (v, u) => ({ valor: v, unidad: u, origen: 'OCR', confianza: 0.95, texto_id: null });
  const L = UF.leer({
    metadatos: { vista: 'PLANTA' },
    red: {
      nodos: [{ id: 'N-001', pos_px: { x: 0, y: 200 } }, { id: 'N-002', pos_px: { x: 400, y: 200 } }, { id: 'N-003', pos_px: { x: 200, y: 50 } }, { id: 'N-004', pos_px: { x: 200, y: 350 } }],
      aristas: [{ id: 'A-001', nodo_a: 'N-001', nodo_b: 'N-002', diametro: med(8, 'in'), longitud_cota: med(2, 'm') }, { id: 'A-002', nodo_a: 'N-003', nodo_b: 'N-004', diametro: med(6, 'in'), longitud_cota: med(1.5, 'm') }],
      textos: [],
    },
    equipos: [],
    alertas_ambiguedad: [{ codigo: 'CRUCE_SIN_NODO', severidad: 'ADVERTENCIA', referencias: ['A-001', 'A-002'], mensaje: 'Las líneas se cruzan.' }],
  }).lectura;
  const amb = V.ambiguas(L, 8, { w: 400, h: 400 });
  assert.deepEqual([amb[0].clase, amb[0].punto], ['CRUCE', { x: 200, y: 200 }]);
  assert.match(V.promptRelectura(amb), /A-001 y A-002 se cruzan al centro del recorte/);
  assert.equal(V.aplicarRelectura(L, [{ n: 1, se_unen: false, confianza: 0.85 }], amb).lectura.alertas_ambiguedad.length, 0);
  const unen = V.aplicarRelectura(L, [{ n: 1, se_unen: true, confianza: 0.85 }], amb).lectura.alertas_ambiguedad[0];
  assert.deepEqual([unen.severidad, /faltaría un nodo/.test(unen.mensaje)], ['CONFIRMAR', true]);
});

test('Verificación visual: las diferencias que encuentra quedan como avisos en el despiece; la lectura no cambia', () => {
  const L = lecturaEjemplo();
  const p = V.promptVerificacion(L);
  assert.match(p, /A-005: 5″, cota sin leer/);
  assert.match(p, /arreglo JSON \(vacío si todo coincide\)/);
  const { lectura, n } = V.agregarVerificacion(L, [
    { referencias: ['A-007', 'X-999'], problema: 'La cota de A-007 dice 2.6 m, no 2.5 m.', sugerencia: '2.6 m' },
    { referencias: [], problema: '   ' }, // sin problema: no cuenta
    'basura',
  ]);
  assert.equal(n, 1);
  assert.deepEqual(lectura.red, L.red, 'la lectura no se toca');
  const bom = UF.despiezar(UF.leer(lectura).lectura, crearMaestros(), {});
  const av = bom.alertas_ambiguedad.find((a) => a.codigo === 'VERIFICACION_VISUAL');
  assert.deepEqual([av.severidad, av.referencias.slice(0, 2), av.mensaje, av.pregunta], ['ADVERTENCIA', ['A-007', 'DUCT-007'], 'La cota de A-007 dice 2.6 m, no 2.5 m.', '2.6 m']);
  assert.equal(bom.resumen.estado, 'PRELIMINAR', 'un aviso no cambia el estado');
  // una segunda verificación reemplaza a la primera
  assert.equal(V.agregarVerificacion(lectura, []).lectura.alertas_ambiguedad.filter((a) => a.codigo === 'VERIFICACION_VISUAL').length, 0);
});
