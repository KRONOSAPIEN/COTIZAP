/**
 * COTIZAP · datos/unifilar_ejemplo.js — La lectura de un croquis unifilar hipotético (docs/vision-unifilares.md §11): lo que
 * entregaría la etapa de visión, SIN nada de lo que deciden las reglas (piezas, diámetros heredados, cotas estimadas). Las
 * reglas (motor/unifilar.js) la convierten en el despiece del caso de prueba (docs/ejemplos/unifilar-caso-prueba.json).
 *
 * Un isométrico a mano alzada: colector, subida de 12″, derivación de 6″ a 45° a la máquina A, tronco de 10″, una T a 90° con
 * un ramal de 5″ cuya cota no se lee a la máquina B, un cambio de 10″ a 8″ sin accesorio dibujado, un codo de 45° a una
 * campana y una cota total del tronco que cuadra con sus parciales. Sin datos de ningún cliente.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.unifilarEjemplo = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const med = (valor, unidad, origen, confianza, texto_id) => ({ valor, unidad, origen, confianza, texto_id: texto_id || null });
  const texto = (id, crudo, normal, tipo, bb, conf, asoc) => ({
    id, contenido_crudo: crudo, contenido_normalizado: normal, tipo, bbox_px: { x: bb[0], y: bb[1], w: bb[2], h: bb[3] }, confianza_ocr: conf, asociado_a: asoc,
  });
  const nodo = (id, tipo, x, y, aristas, equipo_id, conf) => ({ id, tipo, grado: aristas.length, pos_px: { x, y }, aristas, equipo_id, accesorio_id: null, confianza: conf });
  const arista = (id, a, b, orientacion, eje, ang, diametro, longitud) => ({
    id, nodo_a: a, nodo_b: b, orientacion_pantalla: orientacion, eje_iso: eje, angulo_pantalla_deg: ang, diametro, longitud_cota: longitud, ducto_id: null,
  });

  return {
    version: '1.0',
    metadatos: {
      fuente: {
        archivo: 'croquis-unifilar.jpg', ancho_px: 4032, alto_px: 3024, ancho_enviado_px: 2576, alto_enviado_px: 1932,
        recortes: [
          { id: 'R-01', x: 0, y: 0, w: 1400, h: 1932, motivo: 'subida y derivación de 6″' },
          { id: 'R-02', x: 1176, y: 0, w: 1400, h: 1932, motivo: 'derivación de 5″, reducción y campana' },
        ],
      },
      vista: 'ISOMETRICO', unidades_diametro: 'IN', unidades_longitud: 'M', convencion_cotas: 'EJES', flujo_hacia: 'EQ-01',
      material: med('GALVANIZADO', null, 'OCR', 0.93, 'T-023'), calibre: med(22, null, 'OCR', 0.93, 'T-023'), yarda_mm: 914.4,
      modelo: 'claude-opus-5-5', fecha: '2026-10-08T12:00:00Z',
    },
    red: {
      nodos: [
        nodo('N-001', 'EXTREMO', 420, 1850, ['A-001'], 'EQ-01', 0.97),
        nodo('N-002', 'VERTICE', 420, 1420, ['A-001', 'A-002'], null, 0.95),
        nodo('N-003', 'DERIVACION', 1080, 1040, ['A-002', 'A-003', 'A-004'], null, 0.93),
        nodo('N-004', 'EXTREMO', 1000, 1250, ['A-003'], 'EQ-02', 0.92),
        nodo('N-005', 'DERIVACION', 1610, 735, ['A-004', 'A-005', 'A-006'], null, 0.90),
        nodo('N-006', 'EXTREMO', 1420, 845, ['A-005'], 'EQ-03', 0.90),
        nodo('N-007', 'UNION_COLINEAL', 1905, 565, ['A-006', 'A-007'], null, 0.88),
        nodo('N-008', 'VERTICE', 2270, 355, ['A-007', 'A-008'], null, 0.91),
        nodo('N-009', 'EXTREMO', 2270, 655, ['A-008'], 'EQ-04', 0.94),
      ],
      aristas: [
        arista('A-001', 'N-001', 'N-002', 'VERTICAL', 'Z', 90, med(12, 'in', 'OCR', 0.96, 'T-001'), med(3.0, 'm', 'OCR', 0.94, 'T-002')),
        arista('A-002', 'N-002', 'N-003', 'INCLINADA', 'X', 30, med(12, 'in', 'OCR', 0.91, 'T-003'), med(4.5, 'm', 'OCR', 0.95, 'T-004')),
        arista('A-003', 'N-003', 'N-004', 'INCLINADA', 'NINGUNO', 249, med(6, 'in', 'OCR', 0.97, 'T-005'), med(1.8, 'm', 'OCR', 0.90, 'T-006')),
        arista('A-004', 'N-003', 'N-005', 'INCLINADA', 'X', 30, med(10, 'in', 'OCR', 0.95, 'T-008'), med(3.6, 'm', 'OCR', 0.92, 'T-009')),
        // la cota dice «1.? m»: se transcribe tal cual y la longitud queda sin valor
        arista('A-005', 'N-005', 'N-006', 'INCLINADA', 'Y', 150, med(5, 'in', 'OCR', 0.88, 'T-010'), med(null, 'm', 'OCR', 0.41, 'T-011')),
        arista('A-006', 'N-005', 'N-007', 'INCLINADA', 'X', 30, med(null, 'in', 'OCR', 0, null), med(2.0, 'm', 'OCR', 0.90, 'T-012')),
        arista('A-007', 'N-007', 'N-008', 'INCLINADA', 'X', 30, med(8, 'in', 'OCR', 0.94, 'T-013'), med(2.5, 'm', 'OCR', 0.93, 'T-014')),
        // vertical en la hoja: en isométrico es el eje Z… o una diagonal de 45° en planta (lo decide la cota del codo)
        arista('A-008', 'N-008', 'N-009', 'VERTICAL', 'Z', 270, med(null, 'in', 'OCR', 0, null), med(1.5, 'm', 'OCR', 0.92, 'T-015')),
      ],
      textos: [
        texto('T-001', 'Ø12"', '12', 'DIAMETRO', [380, 1560, 92, 40], 0.96, 'A-001'),
        texto('T-002', 'L=3.0m', '3.0', 'LONGITUD', [300, 1630, 120, 38], 0.94, 'A-001'),
        texto('T-003', '12"', '12', 'DIAMETRO', [700, 1180, 70, 36], 0.91, 'A-002'),
        texto('T-004', '4.5 m', '4.5', 'LONGITUD', [760, 1300, 96, 36], 0.95, 'A-002'),
        texto('T-005', 'Ø6', '6', 'DIAMETRO', [960, 1150, 60, 34], 0.97, 'A-003'),
        texto('T-006', '1.8m', '1.8', 'LONGITUD', [890, 1230, 80, 34], 0.90, 'A-003'),
        texto('T-007', '45°', '45', 'ANGULO', [1110, 1090, 58, 32], 0.93, 'N-003'),
        texto('T-008', 'Ø10"', '10', 'DIAMETRO', [1300, 830, 88, 38], 0.95, 'A-004'),
        texto('T-009', '3.6 m', '3.6', 'LONGITUD', [1350, 950, 96, 36], 0.92, 'A-004'),
        texto('T-010', '5"', '5', 'DIAMETRO', [1500, 760, 46, 34], 0.88, 'A-005'),
        texto('T-011', '1.? m', null, 'ILEGIBLE', [1470, 830, 86, 36], 0.41, 'A-005'),
        texto('T-012', '2.0 m', '2.0', 'LONGITUD', [1740, 700, 96, 36], 0.90, 'A-006'),
        texto('T-013', 'Ø8"', '8', 'DIAMETRO', [2050, 420, 80, 38], 0.94, 'A-007'),
        texto('T-014', '2.5m', '2.5', 'LONGITUD', [2100, 520, 86, 36], 0.93, 'A-007'),
        texto('T-015', '1.5 m', '1.5', 'LONGITUD', [2300, 500, 96, 36], 0.92, 'A-008'),
        texto('T-016', '45°', '45', 'ANGULO', [2310, 330, 58, 32], 0.90, 'N-008'),
        texto('T-017', 'COLECTOR', 'COLECTOR', 'EQUIPO', [330, 1900, 170, 40], 0.97, 'EQ-01'),
        texto('T-018', 'MAQ. A', 'MAQUINA', 'EQUIPO', [930, 1300, 120, 38], 0.92, 'EQ-02'),
        texto('T-019', 'MANG 6"', 'MANGUERA 6', 'NOTA', [930, 1345, 130, 36], 0.89, 'EQ-02'),
        texto('T-020', 'MAQ. B', 'MAQUINA', 'EQUIPO', [1300, 880, 120, 38], 0.91, 'EQ-03'),
        texto('T-021', 'MANG 5"', 'MANGUERA 5', 'NOTA', [1300, 925, 130, 36], 0.87, 'EQ-03'),
        texto('T-022', 'CAMPANA', 'CAMPANA', 'EQUIPO', [2220, 700, 150, 40], 0.95, 'EQ-04'),
        texto('T-023', 'GALV CAL 22', 'GALVANIZADO 22', 'CALIBRE', [120, 120, 230, 44], 0.93, null),
        texto('T-024', 'x', null, 'ILEGIBLE', [1820, 1500, 22, 22], 0.30, null),
        texto('T-025', '8.1 m', '8.1', 'LONGITUD', [1700, 470, 96, 36], 0.90, 'CT-001'),
      ],
      // una cota total sobre el tronco de 10″ y 8″ (de N-003 a N-008): cuadra con las parciales (3.6 + 2.0 + 2.5 m)
      cotas_totales: [
        { id: 'CT-001', aristas: ['A-004', 'A-006', 'A-007'], longitud: med(8.1, 'm', 'OCR', 0.90, 'T-025') },
      ],
    },
    equipos: [
      { id: 'EQ-01', tipo: 'COLECTOR', nombre: 'Colector de polvo', nodo_id: 'N-001', conexion: 'BRIDA_EQUIPO', texto_id: 'T-017', confianza: 0.97, boca_diametro: null },
      { id: 'EQ-02', tipo: 'MAQUINA', nombre: 'Máquina A', nodo_id: 'N-004', conexion: 'MANGUERA', texto_id: 'T-018', confianza: 0.92, boca_diametro: null },
      { id: 'EQ-03', tipo: 'MAQUINA', nombre: 'Máquina B', nodo_id: 'N-006', conexion: 'MANGUERA', texto_id: 'T-020', confianza: 0.91, boca_diametro: null },
      { id: 'EQ-04', tipo: 'CAMPANA', nombre: 'Campana', nodo_id: 'N-009', conexion: 'BRIDA_TALLER', texto_id: 'T-022', confianza: 0.95, boca_diametro: null },
    ],
    alertas_ambiguedad: [],
  };
}));
