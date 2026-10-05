'use strict';
/**
 * Prueba de extremo a extremo de la interfaz (OPCIONAL: requiere Playwright y un Chromium instalado).
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/e2e/ui.e2e.js
 *
 * Abre src/web/index.html por file:// y recorre: carga, alta de cada familia, edición sin pérdida
 * (ida y vuelta en tres combinaciones de unidades), validación, subcontratos, tablas maestras,
 * persistencia, guardar/cargar y estado vacío. Termina con código 1 si algo falla.
 */
const path = require('path');
const { pathToFileURL } = require('url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('Playwright no está instalado. Ejecute: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const URL = pathToFileURL(path.resolve(__dirname, '../../src/web/index.html')).href;
let fallos = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { fallos += 1; console.log('  ✗ FALLA:', msg); }
};

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  const nuevaPagina = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-MX', ...opts });
    const page = await ctx.newPage();
    // Google Fonts puede estar bloqueado en entornos sin red: no es un error de la app.
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|ERR_INTERNET|fonts\./.test(m.text())) errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
    await page.goto(URL);
    await page.waitForSelector('#lista-partidas .partida');
    return page;
  };
  const estadoApp = (page, fn, arg) => page.evaluate(fn, arg);
  const editar = async (page, i) => {
    await page.locator('#lista-partidas .partida').nth(i).locator('button[aria-label^="Editar"]').click();
    await page.waitForSelector('#dlg-partida[open]');
  };

  console.log('1) Carga inicial');
  let page = await nuevaPagina();
  ok(await page.locator('#lista-partidas .partida').count() === 6, 'la cotización de ejemplo trae 6 partidas');
  ok((await page.locator('.hero-val').innerText()).startsWith('$'), 'el total se muestra en pesos');
  ok(await page.locator('#aviso-ilustrativo').isVisible(), 'el aviso de valores ilustrativos está visible');

  console.log('2) Ida y vuelta del formulario (editar y guardar sin cambios) en 3 combinaciones de unidades');
  for (const [diam, long] of [['in', 'mm'], ['mm', 'm'], ['in', 'in']]) {
    await page.selectOption('#c_unidad_diam', diam);
    await page.selectOption('#c_unidad_long', long);
    let iguales = true;
    const n = await page.locator('#lista-partidas .partida').count();
    for (let i = 0; i < n; i += 1) {
      const antes = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.res.partidas[k].precio.unitario, i);
      await editar(page, i);
      await page.click('#dlg-guardar');
      await page.waitForTimeout(80);
      const despues = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.res.partidas[k].precio.unitario, i);
      if (Math.abs(antes - despues) > 0.006) iguales = false;
    }
    ok(iguales, `unidades ${diam}/${long}: ninguna partida cambia de precio`);
  }
  await page.selectOption('#c_unidad_diam', 'in');
  await page.selectOption('#c_unidad_long', 'mm');

  console.log('3) Alta de cada familia con sus valores por defecto');
  await page.click('#btn-nueva');
  for (const fam of ['Tramo recto', 'Codo', 'Reducción', 'Transición', 'Ramal en ángulo', 'Pantalón', 'Personalizada', 'Comprado']) {
    await page.click('#btn-agregar');
    await page.waitForSelector('#dlg-partida[open]');
    await page.click(`.fam:has-text("${fam}")`);
    await page.waitForTimeout(80);
    ok(await page.locator('#dlg-prev .errores').count() === 0, `${fam}: la vista previa calcula sin errores`);
    await page.click('#dlg-guardar');
    await page.waitForTimeout(80);
  }
  ok(await page.locator('#lista-partidas .partida').count() === 8, 'las 8 familias quedaron en la lista');

  console.log('4) Validación: un ramal demasiado corto no se puede guardar');
  await page.click('#btn-agregar');
  await page.click('.fam:has-text("Ramal")');
  await page.fill('#f_L_ramal_mm', '100');
  await page.waitForTimeout(80);
  ok(await page.locator('#dlg-prev .errores').count() === 1, 'se muestra el error');
  await page.click('#dlg-guardar');
  ok(await page.locator('#dlg-partida[open]').count() === 1, 'el diálogo permanece abierto');
  await page.click('#dlg-cancelar');

  console.log('5) Duplicar, eliminar y deshacer');
  await page.locator('#lista-partidas .partida').first().locator('button[aria-label="Duplicar"]').click();
  ok(await page.locator('#lista-partidas .partida').count() === 9, 'duplicar suma una partida');
  await page.locator('#lista-partidas .partida').nth(2).locator('button[aria-label="Eliminar"]').click();
  ok(await page.locator('#lista-partidas .partida').count() === 8, 'eliminar resta una partida');
  await page.click('.toast button:has-text("Deshacer")');
  ok(await page.locator('#lista-partidas .partida').count() === 9, 'deshacer la recupera');

  console.log('6) Subcontratos y operaciones omitidas');
  const antes = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.partidas[0].precio.unitario);
  await editar(page, 0);
  await page.click('.avanzado > summary');
  await page.check('.omitir input[value="pintura"]');
  await page.click('button:has-text("Agregar subcontrato")');
  await page.fill('.sc-concepto', 'Pintura electrostática');
  await page.selectOption('.sc-driver', 'M2_NETO');
  await page.fill('.sc-precio', '90');
  await page.click('#dlg-guardar');
  await page.waitForTimeout(100);
  const sub = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.partidas[0]);
  ok(sub.costos.consumibles.pintura === 0 && Object.keys(sub.costos.subcontratos).length === 1, 'la pintura se omite y el subcontrato se aplica');
  ok(sub.precio.unitario !== antes, 'el precio unitario cambia');

  console.log('7) Tablas maestras: el precio del acero mueve el total y persiste');
  const t1 = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.totales.subtotal);
  await page.click('#tab-maestros');
  await page.fill('#maestros-buscar', 'precio_kg_acero_carbon');
  const input = page.locator('input#m_precios__precio_kg_acero_carbon');
  await input.fill('40');
  await input.dispatchEvent('change');
  const t2 = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.totales.subtotal);
  ok(t2 > t1, `subir el acero sube el subtotal (${t1.toFixed(2)} → ${t2.toFixed(2)})`);
  await input.fill('-5');
  await input.dispatchEvent('change');
  ok(Number(await input.inputValue()) === 40, 'un valor negativo se rechaza y se restaura');
  await page.reload();
  await page.waitForSelector('#lista-partidas .partida');
  const t3 = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.totales.subtotal);
  ok(Math.abs(t3 - t2) < 0.01, 'los cambios persisten tras recargar');
  await page.click('#tab-maestros');
  await page.click('#maestros-reset');
  await page.click('#maestros-reset');
  const t4 = await estadoApp(page, () => window.COTIZAP.web.estadoApp.res.totales.subtotal);
  ok(t4 < t3, 'restablecer devuelve los valores ilustrativos');
  await page.click('#tab-cotizacion');

  console.log('8) Guardar y cargar');
  await page.click('#btn-io');
  const json = await page.inputValue('#io-texto');
  ok(json.includes('"app": "COTIZAP"'), 'se genera el JSON de intercambio');
  await page.click('#io-cargar');
  await page.waitForTimeout(100);
  ok(await page.locator('#dlg-io[open]').count() === 0, 'cargar el mismo JSON funciona');
  await page.click('#btn-io');
  await page.fill('#io-texto', '{ esto no es una cotización');
  await page.click('#io-cargar');
  ok(await page.locator('.toast:has-text("no es un JSON válido")').count() >= 1, 'un JSON inválido avisa sin romper');
  await page.click('#io-cerrar');

  console.log('9) Cotización nueva y estado vacío');
  await page.click('#btn-nueva');
  ok(await page.locator('#lista-partidas .vacio').count() === 1, 'se muestra el estado vacío');

  console.log('10) Móvil: sin desbordamiento horizontal');
  await page.context().close();
  page = await nuevaPagina({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(dims.sw <= dims.cw, `scrollWidth ${dims.sw} ≤ clientWidth ${dims.cw}`);

  ok(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await browser.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron');
  process.exit(fallos ? 1 : 0);
})();
