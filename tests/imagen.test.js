/**
 * Preparación de la foto (src/motor/imagen.js): la homografía lleva las cuatro esquinas a su lugar, enderezar recupera una
 * hoja fotografiada en perspectiva y limpiar quita sombra y cuadrícula clara sin borrar el trazo.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/motor/imagen');

const W = 400;
const H = 300;
const nueva = (w, h, v) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
const gris = (im, x, y) => im.data[(y * im.width + x) * 4];
const poner = (im, x, y, v) => { const o = (y * im.width + x) * 4; im.data[o] = v; im.data[o + 1] = v; im.data[o + 2] = v; im.data[o + 3] = 255; };

test('homografia: lleva cada esquina exactamente a la suya; tres en línea no se aceptan', () => {
  const de = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  const a = [{ x: 10, y: 20 }, { x: 120, y: 15 }, { x: 110, y: 80 }, { x: 5, y: 70 }];
  const Hm = I.homografia(de, a);
  de.forEach((p, i) => {
    const q = I.aplicarH(Hm, p);
    assert.ok(Math.abs(q.x - a[i].x) < 1e-9 && Math.abs(q.y - a[i].y) < 1e-9);
  });
  assert.throws(() => I.homografia(de, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), /cuadrilátero/);
  assert.throws(() => I.homografia(de.slice(0, 3), a), /cuatro puntos/);
});

test('enderezar: una hoja fotografiada en perspectiva vuelve a ser un rectángulo', () => {
  // la hoja: blanca con un cuadro negro de (100, 100) a (300, 200)
  const hoja = nueva(W, H, 255);
  for (let y = 100; y < 200; y += 1) for (let x = 100; x < 300; x += 1) poner(hoja, x, y, 0);
  // la foto: la hoja vista en perspectiva, con fondo gris
  const esq = [{ x: 40, y: 30 }, { x: 380, y: 10 }, { x: 360, y: 290 }, { x: 20, y: 260 }];
  const inversa = I.homografia(esq, [{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }]);
  const foto = nueva(W, H, 200);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const q = I.aplicarH(inversa, { x, y });
      const xi = Math.round(q.x);
      const yi = Math.round(q.y);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) poner(foto, x, y, gris(hoja, xi, yi));
    }
  }
  const rec = I.enderezar(foto, esq, W, H);
  assert.deepEqual([rec.width, rec.height], [W, H]);
  let distintos = 0;
  for (let y = 5; y < H - 5; y += 1) for (let x = 5; x < W - 5; x += 1) if (Math.abs(gris(rec, x, y) - gris(hoja, x, y)) > 128) distintos += 1;
  assert.ok(distintos < 0.002 * W * H, `${distintos} píxeles distintos`);
  // sin tamaño, el de los lados promedio
  assert.deepEqual(I.tamanoEnderezado(esq), { w: 341, h: 256 }); // el promedio de los lados opuestos
  // lo que cae fuera de la foto queda blanco
  const fuera = I.enderezar(foto, [{ x: -50, y: -50 }, { x: 10, y: -50 }, { x: 10, y: 10 }, { x: -50, y: 10 }], 20, 20);
  assert.equal(gris(fuera, 2, 2), 255);
});

test('limpiar: quita la sombra y la cuadrícula clara, y el trazo queda oscuro', () => {
  const im = nueva(W, H, 0);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let v = 235 - x * 0.2; // sombra que oscurece hacia la derecha
      if (x % 20 === 0 || y % 20 === 0) v -= 18; // cuadrícula clara
      if (y >= 148 && y <= 152) v = 50; // el trazo
      poner(im, x, y, v);
    }
  }
  const c = I.limpiar(im);
  assert.deepEqual([gris(c, 10, 10), gris(c, 390, 10)], [255, 255], 'papel blanco aun con sombra');
  assert.deepEqual([gris(c, 40, 30), gris(c, 380, 30)], [255, 255], 'cuadrícula clara fuera');
  assert.ok(gris(c, 200, 150) < 110 && gris(c, 390, 150) < 110, 'el trazo sigue oscuro');
  assert.deepEqual(I.esquinasIniciales(100, 50, 0.1), [{ x: 10, y: 5 }, { x: 90, y: 5 }, { x: 90, y: 45 }, { x: 10, y: 45 }]);
});
