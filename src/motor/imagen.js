/**
 * COTIZAP · imagen.js — La preparación de la foto de un croquis (docs/vision-unifilares.md §4.1, etapa E0), sin el navegador:
 * enderezar la hoja (de las cuatro esquinas que se ven en la foto a un rectángulo, con una homografía) y limpiarla (quitar
 * sombras y la cuadrícula clara de la libreta normalizando el fondo). Trabaja sobre imágenes { width, height, data } con
 * data RGBA (Uint8ClampedArray), la forma de ImageData; web/unifilar_ui.js las saca de un canvas y las vuelve a dibujar.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.imagen = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PIXELES = 40e6; // protección: una foto de celular trae unos 12 MP

  /** Resuelve A·x = b (8 × 8) por eliminación de Gauss con pivoteo parcial. */
  function resolver(A, b) {
    const n = b.length;
    const m = A.map((fila, i) => [...fila, b[i]]);
    for (let c = 0; c < n; c += 1) {
      let p = c;
      for (let f = c + 1; f < n; f += 1) if (Math.abs(m[f][c]) > Math.abs(m[p][c])) p = f;
      if (Math.abs(m[p][c]) < 1e-12) throw new Error('Las cuatro esquinas no forman un cuadrilátero (hay tres en línea o dos iguales).');
      [m[c], m[p]] = [m[p], m[c]];
      for (let f = 0; f < n; f += 1) {
        if (f === c) continue;
        const k = m[f][c] / m[c][c];
        for (let j = c; j <= n; j += 1) m[f][j] -= k * m[c][j];
      }
    }
    return m.map((fila, i) => fila[n] / fila[i]);
  }

  /** La homografía H (3 × 3, h33 = 1) que lleva los cuatro puntos `de` a los cuatro `a`: a ≅ H · de. */
  function homografia(de, a) {
    if (!Array.isArray(de) || !Array.isArray(a) || de.length !== 4 || a.length !== 4) throw new Error('Se necesitan cuatro puntos de cada lado.');
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i += 1) {
      const { x, y } = de[i];
      const { x: u, y: v } = a[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = resolver(A, b);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }

  const aplicarH = (H, p) => {
    const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
    return { x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w, y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w };
  };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  /** El tamaño del rectángulo enderezado: el promedio de los lados opuestos (arriba-abajo, izquierda-derecha). */
  function tamanoEnderezado(esquinas) {
    const [si, sd, id, ii] = esquinas;
    return { w: Math.max(1, Math.round((dist(si, sd) + dist(ii, id)) / 2)), h: Math.max(1, Math.round((dist(si, ii) + dist(sd, id)) / 2)) };
  }

  /**
   * Endereza la hoja: `esquinas` son las de la hoja en la foto, en orden superior izquierda, superior derecha, inferior
   * derecha e inferior izquierda. Devuelve una imagen de w × h (por omisión, tamanoEnderezado) muestreada con interpolación
   * bilineal; lo que cae fuera de la foto queda blanco.
   */
  function enderezar(src, esquinas, w0, h0) {
    const { w, h } = w0 && h0 ? { w: Math.round(w0), h: Math.round(h0) } : tamanoEnderezado(esquinas);
    if (w * h > MAX_PIXELES) throw new Error('La imagen enderezada sería demasiado grande.');
    const H = homografia([{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }], esquinas); // del destino a la foto
    const out = new Uint8ClampedArray(w * h * 4);
    const W = src.width;
    const S = src.data;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const q = aplicarH(H, { x, y });
        const o = (y * w + x) * 4;
        const x0 = Math.floor(q.x);
        const y0 = Math.floor(q.y);
        if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= src.height - 1) { out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255; continue; }
        const fx = q.x - x0;
        const fy = q.y - y0;
        const i00 = (y0 * W + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + W * 4;
        const i11 = i01 + 4;
        for (let c = 0; c < 3; c += 1) {
          out[o + c] = (S[i00 + c] * (1 - fx) + S[i10 + c] * fx) * (1 - fy) + (S[i01 + c] * (1 - fx) + S[i11 + c] * fx) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  /** Promedio de cada píxel en un cuadro de (2r+1)² con la imagen integral (bordes recortados). */
  function promedioCaja(v, w, h, r) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y += 1) {
      let fila = 0;
      for (let x = 0; x < w; x += 1) {
        fila += v[y * w + x];
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + fila;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x += 1) {
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w, x + r + 1);
        const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }

  /**
   * Limpia la hoja: divide cada píxel entre el brillo del papel a su alrededor (quita sombras y manchas de luz), lleva a
   * blanco lo que queda más claro que `umbral` (la cuadrícula de la libreta, que es clara) y estira el resto para que el
   * trazo quede oscuro. Devuelve una imagen en grises. opciones: { radio (px; por omisión, el lado menor ÷ 40),
   * umbral (0–1, por omisión 0.82) }.
   */
  function limpiar(src, opciones) {
    const o = opciones || {};
    const w = src.width;
    const h = src.height;
    if (w * h > MAX_PIXELES) throw new Error('La imagen es demasiado grande para limpiarla.');
    const r = Math.max(4, Math.round(o.radio || Math.min(w, h) / 40));
    const umbral = Number.isFinite(o.umbral) ? Math.min(0.98, Math.max(0.5, o.umbral)) : 0.82;
    const S = src.data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) lum[i] = 0.299 * S[i * 4] + 0.587 * S[i * 4 + 1] + 0.114 * S[i * 4 + 2];
    // el fondo: el promedio local, pero sin dejar que el trazo lo oscurezca (dos pasadas: la segunda ignora lo muy oscuro)
    const f1 = promedioCaja(lum, w, h, r);
    const claro = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) claro[i] = Math.max(lum[i], f1[i]);
    const fondo = promedioCaja(claro, w, h, r);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      const n = Math.min(1, lum[i] / Math.max(1, fondo[i]));
      const v = n >= umbral ? 255 : Math.round(255 * Math.pow(n / umbral, 1.6));
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }

  /** Esquinas por omisión para enderezar: un margen de `margen` (fracción) dentro de la foto. */
  const esquinasIniciales = (w, h, margen) => {
    const m = Number.isFinite(margen) ? margen : 0.04;
    return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];
  };

  return { homografia, aplicarH, tamanoEnderezado, enderezar, limpiar, esquinasIniciales };
}));
