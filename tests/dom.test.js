'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'dom.js'), 'utf8'), { self: raiz });
const W = raiz.COTIZAP.web;

test('leerNumero: signo y fracciones', () => {
  assert.equal(W.leerNumero('-0 1/2'), -0.5);
  assert.equal(W.leerNumero('-1 1/2'), -1.5);
  assert.equal(W.leerNumero('1 1/2'), 1.5);
  assert.equal(W.leerNumero('3/8'), 0.375);
  assert.equal(W.leerNumero('22,5'), 22.5);
  assert.equal(W.leerNumero('1,500'), 1500);
  assert.equal(W.leerNumero('-12,500.5'), -12500.5);
  assert.ok(Number.isNaN(W.leerNumero('abc')));
  assert.ok(Number.isNaN(W.leerNumero('')));
});

test('pctExacto: hasta 2 decimales sin ceros de sobra', () => {
  assert.equal(W.pctExacto(0.0225), '2.25 %');
  assert.equal(W.pctExacto(0.025), '2.5 %');
  assert.equal(W.pctExacto(0.2), '20 %');
  assert.equal(W.pctExacto(0.16), '16 %');
  assert.equal(W.pctExacto(0.085), '8.5 %');
});
