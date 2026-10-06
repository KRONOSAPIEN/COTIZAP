'use strict';
/**
 * Prueba de extremo a extremo de la interfaz (OPCIONAL: requiere Playwright y un Chromium instalado).
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/e2e/ui.e2e.js
 *
 * Abre src/web/index.html por file:// y recorre: carga, alta de cada familia, edición sin pérdida
 * (ida y vuelta en tres combinaciones de unidades), validación, subcontratos, tablas maestras,
 * persistencia, guardar/cargar, estado vacío y el guardado automático en el artefacto (con un window.claude
 * simulado cuyo almacén vive en Node, así sobrevive a recargas y a navegadores nuevos).
 * Termina con código 1 si algo falla.
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

const { crearMaestros } = require('../../src/datos/maestros');

const URL_APP = pathToFileURL(path.resolve(__dirname, '../../src/web/index.html')).href;
let fallos = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓', msg);
  else { fallos += 1; console.log('  ✗ FALLA:', msg); }
};

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  const nuevaPagina = async (opts, preparar) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-MX', ...opts });
    if (preparar) await preparar(ctx);
    const page = await ctx.newPage();
    // Google Fonts puede estar bloqueado en entornos sin red: no es un error de la app.
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|ERR_INTERNET|fonts\./.test(m.text())) errores.push(m.text()); });
    page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
    await page.goto(URL_APP);
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
  ok(await page.locator('#lista-partidas .partida').count() === 7, 'la cotización de ejemplo trae 7 partidas');
  ok((await page.locator('.hero-val').innerText()).startsWith('$'), 'el total se muestra en pesos');
  ok(await page.locator('#aviso-ilustrativo').isVisible(), 'el aviso de valores ilustrativos está visible');

  console.log('2) Ida y vuelta del formulario (editar y guardar sin cambios) en 3 combinaciones de unidades');
  for (const [diam, long] of [['in', 'mm'], ['mm', 'm'], ['in', 'in']]) {
    await page.selectOption('#c_unidad_diam', diam);
    await page.selectOption('#c_unidad_long', long);
    let iguales = true;
    let exactos = true;
    const n = await page.locator('#lista-partidas .partida').count();
    for (let i = 0; i < n; i += 1) {
      const antes = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.res.partidas[k].precio.unitario, i);
      const pAntes = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.cot.partidas[k], i);
      await editar(page, i);
      await page.click('#dlg-guardar');
      await page.waitForTimeout(80);
      const despues = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.res.partidas[k].precio.unitario, i);
      const pDespues = await estadoApp(page, (k) => window.COTIZAP.web.estadoApp.cot.partidas[k], i);
      if (Math.abs(antes - despues) > 0.006) iguales = false;
      // Un campo que el usuario no toca conserva su valor exacto en mm, aunque la unidad mostrada lo redondee.
      if (Object.keys(pAntes).some((k) => typeof pAntes[k] === 'number' && pAntes[k] !== pDespues[k])) exactos = false;
    }
    ok(iguales, `unidades ${diam}/${long}: ninguna partida cambia de precio`);
    ok(exactos, `unidades ${diam}/${long}: los valores numéricos no tocados se conservan exactos`);
  }
  await page.selectOption('#c_unidad_diam', 'in');
  await page.selectOption('#c_unidad_long', 'mm');

  console.log('3) Alta de cada familia con sus valores por defecto');
  await page.click('#btn-nueva');
  for (const fam of ['Tramo recto', 'Codo', 'Reducción', 'Transición', 'Injerto simple', 'Reducción con injerto', 'Personalizada', 'Comprado']) {
    await page.click('#btn-agregar');
    await page.waitForSelector('#dlg-partida[open]');
    await page.click(`.fam:has(span:text-is("${fam}"))`);
    await page.waitForTimeout(80);
    ok(await page.locator('#dlg-prev .errores').count() === 0, `${fam}: la vista previa calcula sin errores`);
    await page.click('#dlg-guardar');
    await page.waitForTimeout(80);
  }
  ok(await page.locator('#lista-partidas .partida').count() === 8, 'las 8 familias quedaron en la lista');

  console.log('4) Validación: un injerto demasiado corto no se puede guardar');
  await page.click('#btn-agregar');
  await page.click('.fam:has(span:text-is("Injerto simple"))');
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
  const intercambio = JSON.parse(json);
  ok(intercambio.version === 2 && Object.keys(intercambio.maestros).length === 0, 'sin ediciones, los maestros se exportan como parche vacío');
  await page.click('#io-cargar');
  await page.waitForTimeout(100);
  ok(await page.locator('#dlg-io[open]').count() === 0, 'cargar el mismo JSON funciona');
  // Un archivo de la versión 1 trae los herrajes de arranque viejos (ángulos por diámetro): debe mandar el estándar del taller.
  const v1 = {
    ...intercambio,
    version: 1,
    maestros: { precios: { precio_kg_acero_carbon: 25 }, herrajes: { seleccion_perfil: [{ hasta_mm: 150, perfil: 'L25x3.2' }, { hasta_mm: 99999, perfil: 'L38x3.2' }] } },
  };
  await page.click('#btn-io');
  await page.fill('#io-texto', JSON.stringify(v1));
  await page.click('#io-cargar');
  await page.waitForTimeout(100);
  const tras = await estadoApp(page, () => {
    const a = window.COTIZAP.web.estadoApp;
    return { acero: a.M.precios.precio_kg_acero_carbon, sel: a.M.herrajes.seleccion_perfil.map((f) => f.perfil) };
  });
  ok(tras.acero === 25, 'archivo v1: se conservan los precios editados');
  ok(tras.sel.length === 1 && tras.sel[0] === 'SOL38x4.8', 'archivo v1: manda la brida estándar del taller, no los ángulos viejos');
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

  /* ---------------------------------------------------------------------------------------------- */
  /* Guardado automático en el artefacto: un window.claude de mentira con un almacén que vive en Node */
  /* ---------------------------------------------------------------------------------------------- */
  const nuevoAlmacen = () => ({ docs: new Map(), puedeEditar: true, fallaEscritura: null, retardoLectura: 0 });
  /** Instala window.claude (capacidades db y user) en un contexto; `opciones.sinDb` simula un visor sin la capacidad. */
  const instalarClaude = (almacen, opciones = {}) => async (ctx) => {
    await ctx.exposeFunction('__bdGet', async (ruta) => {
      if (almacen.retardoLectura) await new Promise((r) => setTimeout(r, almacen.retardoLectura));
      return almacen.docs.has(ruta) ? { existe: true, datos: JSON.parse(JSON.stringify(almacen.docs.get(ruta))) } : { existe: false };
    });
    await ctx.exposeFunction('__bdSet', async (ruta, datos) => {
      if (almacen.fallaEscritura) return { codigo: almacen.fallaEscritura };
      almacen.docs.set(ruta, JSON.parse(JSON.stringify(datos)));
      return {};
    });
    await ctx.exposeFunction('__puedeEditar', async () => almacen.puedeEditar);
    await ctx.addInitScript((sinDb) => {
      const error = (codigo) => Object.assign(new Error(codigo), { code: codigo });
      window.claude = {
        use: async (nombre) => {
          if (nombre === 'db') {
            if (sinDb) return null;
            return {
              doc: (ruta) => ({
                path: ruta,
                get: async () => { const r = await window.__bdGet(ruta); return { exists: r.existe, data: () => r.datos }; },
                set: async (datos) => { const r = await window.__bdSet(ruta, datos); if (r.codigo) throw error(r.codigo); },
              }),
            };
          }
          if (nombre === 'user') return { canEdit: () => window.__puedeEditar() };
          return null;
        },
      };
    }, !!opciones.sinDb);
  };
  const esperarHasta = async (cond, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await cond()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const textoEstado = (p) => p.locator('#maestros-guardado .guardado-txt').innerText();
  const ACERO = 'input#m_precios__precio_kg_acero_carbon';
  const abrirMaestros = async (p, buscar = 'precio_kg_acero_carbon') => {
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', buscar);
  };
  const editarAcero = async (p, valor) => {
    await abrirMaestros(p);
    const inp = p.locator(ACERO);
    await inp.fill(String(valor));
    await inp.dispatchEvent('change');
  };
  const aceroGuardado = (p) => estadoApp(p, () => window.COTIZAP.web.estadoApp.M.precios.precio_kg_acero_carbon);

  console.log('11) Guardado automático: los precios se mantienen al volver a abrir (artefacto)');
  {
    const bd = nuevoAlmacen();

    // a) primer equipo: sin nada guardado; al editar un precio se guarda solo
    const p1 = await nuevaPagina({}, instalarClaude(bd));
    await p1.click('#tab-maestros');
    ok(await esperarHasta(async () => (await p1.locator('#maestros-guardado').getAttribute('data-estado')) === 'guardado'), 'al abrir, la cabecera de las tablas queda en "se guardan automáticamente"');
    await new Promise((r) => setTimeout(r, 1200)); // más que la pausa de guardado: si algo fuera a escribirse, ya lo habría hecho
    ok(!bd.docs.has('config/maestros'), 'abrir sin editar no escribe nada en el almacén');
    await editarAcero(p1, 33.5);
    ok(await esperarHasta(() => bd.docs.has('config/maestros')), 'al editar un precio se escribe solo en el almacén del artefacto');
    const doc = bd.docs.get('config/maestros');
    ok(doc && doc.v === 2 && doc.parche.precios.precio_kg_acero_carbon === 33.5, 'el documento trae el parche con el precio nuevo');
    ok(await esperarHasta(async () => /Guardado automáticamente a las/.test(await textoEstado(p1))), 'la línea de estado confirma el guardado con la hora');
    await p1.context().close();

    // b) otro navegador (sin localStorage): al abrir, el precio guardado ya está
    const p2 = await nuevaPagina({}, instalarClaude(bd));
    ok(await esperarHasta(async () => (await aceroGuardado(p2)) === 33.5), 'un navegador sin datos locales abre con el precio guardado');
    await abrirMaestros(p2);
    ok(Number(await p2.locator(ACERO).inputValue()) === 33.5, 'el editor de tablas muestra el precio guardado');
    ok(bd.docs.size === 1 && bd.docs.get('config/maestros').parche.precios.precio_kg_acero_carbon === 33.5, 'abrir de nuevo no reescribe lo guardado');

    // c) si la escritura falla: se avisa, queda pendiente y se sube al reintentar (incluso después de recargar)
    bd.fallaEscritura = 'resource_exhausted';
    await editarAcero(p2, 36);
    ok(await esperarHasta(async () => /No se pudo guardar/.test(await textoEstado(p2))), 'si no se puede guardar, la línea de estado lo dice');
    ok(await p2.locator('#maestros-reintentar').isVisible(), 'aparece el botón para reintentar');
    ok(bd.docs.get('config/maestros').parche.precios.precio_kg_acero_carbon === 33.5, 'lo guardado antes sigue intacto');
    ok(await estadoApp(p2, () => window.localStorage.getItem('cotizap.maestros.pendiente')) === 'true', 'el cambio queda marcado como pendiente en este navegador');
    await p2.reload();
    await p2.waitForSelector('#lista-partidas .partida');
    ok(await esperarHasta(async () => (await aceroGuardado(p2)) === 36), 'tras recargar, lo pendiente manda sobre lo guardado (no se pierde el cambio)');
    await p2.click('#tab-maestros');
    ok(await esperarHasta(async () => /No se pudo guardar/.test(await textoEstado(p2))), 'tras recargar, el aviso sigue: el cambio pendiente aún no llega al almacén');
    bd.fallaEscritura = null; // se resuelve la falla
    await p2.click('#maestros-reintentar');
    ok(await esperarHasta(() => bd.docs.get('config/maestros').parche.precios.precio_kg_acero_carbon === 36), 'al reintentar, el cambio pendiente llega al almacén');
    ok(await esperarHasta(async () => (await estadoApp(p2, () => window.localStorage.getItem('cotizap.maestros.pendiente'))) === null), 'y la bandera de pendiente se limpia');
    await p2.context().close();

    // d) quien sólo puede ver: ve los precios compartidos, no los puede cambiar y no escribe
    bd.puedeEditar = false;
    const antesDeLectura = JSON.stringify([...bd.docs]);
    const p3 = await nuevaPagina({}, instalarClaude(bd));
    ok(await esperarHasta(async () => (await aceroGuardado(p3)) === 36), 'un lector ve los precios guardados');
    await abrirMaestros(p3);
    ok(/Sólo lectura/.test(await textoEstado(p3)), 'la línea de estado dice que es sólo lectura');
    ok(await p3.locator(ACERO).isDisabled(), 'los campos de precios están bloqueados');
    ok(await p3.locator('#maestros-reset').isDisabled(), 'el botón de restablecer también');
    ok(JSON.stringify([...bd.docs]) === antesDeLectura, 'un lector no escribe nada');
    await p3.context().close();
    bd.puedeEditar = true;

    // e) restablecer también se guarda: al volver a abrir siguen los valores ilustrativos
    const p4 = await nuevaPagina({}, instalarClaude(bd));
    ok(await esperarHasta(async () => (await aceroGuardado(p4)) === 36), 'el editor vuelve a abrir con lo guardado');
    await p4.click('#tab-maestros');
    await p4.click('#maestros-reset');
    await p4.click('#maestros-reset');
    ok(await esperarHasta(() => Object.keys(bd.docs.get('config/maestros').parche).length === 0), 'restablecer guarda un parche vacío');
    await p4.context().close();
    const p5 = await nuevaPagina({}, instalarClaude(bd));
    ok(await esperarHasta(async () => (await aceroGuardado(p5)) === crearMaestros().precios.precio_kg_acero_carbon), 'al abrir de nuevo siguen los valores de arranque');
    await p5.context().close();
  }

  console.log('12) Guardado automático: cambios hechos mientras se consulta el almacén no se pierden');
  {
    const bd = nuevoAlmacen();
    bd.docs.set('config/maestros', { v: 2, parche: { precios: { precio_kg_acero_carbon: 40 }, mano_obra: { FSR: 1.7 } }, actualizado: '2026-10-05T18:00:00.000Z' });
    bd.retardoLectura = 1500;
    const p = await nuevaPagina({}, instalarClaude(bd));
    ok(/Buscando/.test(await textoEstado(p)), 'mientras consulta el almacén lo dice');
    await editarAcero(p, 50); // el almacén todavía no contestó: se puede seguir trabajando
    ok(await esperarHasta(async () => (await estadoApp(p, () => window.COTIZAP.web.estadoApp.M.mano_obra.FSR)) === 1.7, 8000), 'llega lo guardado (FSR 1.7)');
    ok((await aceroGuardado(p)) === 50, 'y lo que se editó durante la carga se conserva encima (acero 50)');
    ok(await esperarHasta(() => {
      const g = bd.docs.get('config/maestros');
      return g.parche.precios.precio_kg_acero_carbon === 50 && g.parche.mano_obra.FSR === 1.7;
    }), 'el almacén queda con las dos cosas');
    await p.context().close();
  }

  console.log('13) Guardado automático: sin la capacidad db sólo se guarda en este navegador');
  {
    const bd = nuevoAlmacen();
    const p = await nuevaPagina({}, instalarClaude(bd, { sinDb: true }));
    await p.click('#tab-maestros');
    ok(await esperarHasta(async () => /sólo en este navegador/i.test(await textoEstado(p))), 'avisa que sólo se guarda en este navegador');
    await editarAcero(p, 37);
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok((await aceroGuardado(p)) === 37, 'aun así el precio se mantiene al volver a abrir (localStorage)');
    ok(bd.docs.size === 0, 'y no se escribió en el almacén');
    await p.context().close();
  }

  console.log('14) Precios capturados con la versión 1: se recuperan una sola vez y se suben al artefacto');
  {
    const v1 = crearMaestros();
    v1.precios.precio_kg_acero_carbon = 26.5;
    v1.precios.precio_m_empaque_neopreno = 18; // valor de arranque de la versión 1
    v1.herrajes.seleccion_perfil = [{ hasta_mm: 150, perfil: 'L25x3.2' }, { hasta_mm: 99999, perfil: 'L64x6.4' }];
    const bd = nuevoAlmacen();
    const sembrar = async (ctx) => {
      await ctx.addInitScript((m) => {
        if (!window.localStorage.getItem('__sembrado')) {
          window.localStorage.setItem('cotizap.maestros.v1', JSON.stringify(m));
          window.localStorage.setItem('__sembrado', '1');
        }
      }, v1);
      await instalarClaude(bd)(ctx);
    };
    const p = await nuevaPagina({}, sembrar);
    const M = await estadoApp(p, () => {
      const a = window.COTIZAP.web.estadoApp.M;
      return { acero: a.precios.precio_kg_acero_carbon, empaque: a.precios.precio_m_empaque_neopreno, perfiles: a.herrajes.seleccion_perfil.map((f) => f.perfil) };
    });
    ok(M.acero === 26.5, 'se recupera el precio que se había capturado con la versión 1');
    ok(M.empaque === 28 && M.perfiles.length === 1 && M.perfiles[0] === 'SOL38x4.8', 'sin heredar los valores de arranque viejos (empaque, ángulos por diámetro)');
    ok(await esperarHasta(() => bd.docs.has('config/maestros') && bd.docs.get('config/maestros').parche.precios.precio_kg_acero_carbon === 26.5), 'y se sube al artefacto');
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok((await aceroGuardado(p)) === 26.5, 'la recuperación no se repite ni se pierde al recargar');
    await p.context().close();
  }

  console.log('15) Injerto simple y Reducción con injerto (30° o 45°)');
  {
    const p = await nuevaPagina();
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    const nombres = await p.locator('#dlg-familias .fam span').allInnerTexts();
    ok(nombres.includes('Injerto simple') && nombres.includes('Reducción con injerto'), 'el selector ofrece Injerto simple y Reducción con injerto');
    ok(!nombres.some((n) => /Pantal|Ramal/.test(n)), 'ya no ofrece Ramal en ángulo ni Pantalón');
    await p.click('.fam:has(span:text-is("Reducción con injerto"))');
    ok(JSON.stringify(await p.locator('#f_beta_deg option').allInnerTexts()) === JSON.stringify(['30°', '45°']), 'el ángulo del injerto es 30° o 45°');
    ok(await p.locator('#f_lado').count() === 0 && !/Lado del injerto/.test(await p.locator('#dlg-partida').innerText()), 'no hay campo "Lado del injerto"');
    ok(await p.locator('#f_beta_deg').inputValue() === '45', 'por omisión: 45°');
    ok(await p.locator('#dlg-prev .errores').count() === 0, 'con los valores por defecto calcula sin errores');
    ok((await p.locator('#f_L_ramal_mm').getAttribute('placeholder')) === 'auto' && (await p.locator('#f_L_reduccion_mm').getAttribute('placeholder')) === 'auto', 'los largos del injerto y de la reducción son automáticos por omisión');
    ok(await p.locator('#f_L_cuerpo_mm').count() === 0, 'ya no hay "tramo recto": el injerto va sobre el cono');
    ok(await p.locator('#f_sentido').count() === 0 && !/se inclina hacia/.test(await p.locator('#dlg-partida').innerText()), 'no se elige hacia qué extremo se inclina: el injerto siempre va de extremo mayor a menor');
    const precio45 = await p.locator('#dlg-prev .prev-val').innerText();
    await p.selectOption('#f_beta_deg', '30');
    await p.waitForTimeout(100);
    ok(await p.locator('#dlg-prev .errores').count() === 0, 'a 30° también calcula sin errores (el largo automático se ajusta)');
    ok(precio45 !== '' && (await p.locator('#dlg-prev .prev-val').innerText()) !== '', 'la vista previa muestra el precio');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const guardada = await estadoApp(p, () => {
      const q = window.COTIZAP.web.estadoApp.cot.partidas.find((x) => x.familia === 'REDUCCION_INJERTO' && x.beta_deg === 30);
      return q ? { beta: q.beta_deg, tipo: typeof q.beta_deg, lado: q.lado, id: q.id } : null;
    });
    ok(guardada && guardada.beta === 30 && guardada.tipo === 'number' && guardada.lado === undefined, 'se guarda el ángulo como número y ya no se guarda un lado');
    ok(await p.locator('#lista-partidas .partida-meta:has-text("a 30°")').count() === 1, 'la lista lo resume con el vocabulario del taller ("… injerto Ø6″ a 30°")');
    ok(await p.locator('#lista-partidas .partida-meta:has-text("Injerto")').count() >= 2, 'el injerto simple y la reducción con injerto se rotulan como injertos');
    // editar y guardar sin tocar nada deja la partida igual (el ángulo se conserva)
    await p.locator(`#lista-partidas .partida:has(.partida-meta:has-text("a 30°"))`).locator('button[aria-label^="Editar"]').click();
    await p.waitForSelector('#dlg-partida[open]');
    ok(await p.locator('#f_beta_deg').inputValue() === '30', 'al editar, el ángulo vuelve como se guardó');
    // un injerto demasiado corto se rechaza con el nombre de taller
    await p.fill('#f_L_ramal_mm', '100');
    await p.waitForTimeout(100);
    ok(/longitud del injerto debe exceder/.test(await p.locator('#dlg-prev .errores').innerText()), 'un injerto demasiado corto se rechaza: "La longitud del injerto debe exceder …"');
    await p.fill('#f_L_ramal_mm', '');
    await p.fill('#f_L_reduccion_mm', '120');
    await p.waitForTimeout(100);
    ok(/La reducción es corta para alojar el injerto: necesita al menos \d+ mm/.test(await p.locator('#dlg-prev .errores').innerText()), 'una reducción demasiado corta se rechaza y dice cuánto necesita');
    await p.click('#dlg-cancelar');
    // el desglose habla de tronco e injerto
    await p.locator('#lista-partidas .partida:has(.partida-meta:has-text("a 30°"))').click();
    await p.waitForTimeout(100);
    const detalle = await p.locator('#detalle').innerText();
    ok(/Longitud de la reducción/.test(detalle) && /Área del injerto/.test(detalle) && /El injerto se inclina hacia\s*El extremo menor \(D2\)/.test(detalle) && !/Lado del injerto/.test(detalle), 'el desglose dice que el injerto va hacia el extremo menor, y muestra reducción e injerto, sin lado');

    // el injerto va de extremo mayor a menor por política del taller: es un dato de Tablas maestras, no una captura por partida
    const idxRI = await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.partidas.findIndex((x) => x.familia === 'REDUCCION_INJERTO'));
    const resRI = () => estadoApp(p, (k) => { const r = window.COTIZAP.web.estadoApp.res.partidas[k]; return { ok: r.ok, precio: r.ok ? r.precio.unitario : null, errores: r.errores || [] }; }, idxRI);
    const basePrecio = (await resRI()).precio;
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'injerto_inclinado_hacia');
    const hacia = p.locator('input#m_proceso__injerto_inclinado_hacia');
    ok(await hacia.inputValue() === 'MENOR', 'en Tablas maestras: "injerto inclinado hacia" = MENOR (de extremo mayor a menor)');
    await hacia.fill('MAYOR');
    await hacia.dispatchEvent('change');
    const invertido = await resRI();
    ok(invertido.ok && invertido.precio > basePrecio, 'si el taller lo cambiara a MAYOR, la reducción con injerto cuesta más y se recalcula al instante');
    await hacia.fill('ARRIBA');
    await hacia.dispatchEvent('change');
    const malo = await resRI();
    ok(!malo.ok && /injerto inclinado hacia/.test(malo.errores.join(' ')), 'un valor inválido se avisa con el nombre del dato de maestros');
    await hacia.fill('MENOR');
    await hacia.dispatchEvent('change');
    ok((await resRI()).precio === basePrecio, 'al volver a MENOR el precio vuelve al de antes');
    await p.click('#tab-cotizacion');

    // una cotización anterior con pantalón sigue calculando, rotulado como retirado
    const vieja = {
      app: 'COTIZAP', version: 2,
      cotizacion: { cliente: 'Anterior', proyecto: '', fecha: '2026-01-01', vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm', riesgo: 'MEDIO', servicio: 'POLVO',
        partidas: [{ id: 'pv1', familia: 'PANTALON', D_mm: 500, d1_mm: 354, d2_mm: 354, L_tronco_mm: 300, L1_mm: 500, L2_mm: 500, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 }] },
      maestros: {},
    };
    await p.click('#btn-io');
    await p.fill('#io-texto', JSON.stringify(vieja));
    await p.click('#io-cargar');
    await p.waitForTimeout(150);
    ok(await p.locator('#lista-partidas .partida-titulo:has-text("Pantalón (retirado)")').count() === 1, 'el pantalón de una cotización anterior se sigue mostrando, como retirado');
    ok((await p.locator('#lista-partidas .partida-importe').innerText()).includes('$'), 'y sigue calculando su precio');
    await p.locator('#lista-partidas .partida').first().locator('button[aria-label^="Editar"]').click();
    await p.waitForSelector('#dlg-partida[open]');
    ok((await p.locator('#dlg-familias .fam span').allInnerTexts()).includes('Pantalón (retirado)'), 'al editarlo aparece su familia retirada');
    await p.click('#dlg-cancelar');
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    ok(!(await p.locator('#dlg-familias .fam span').allInnerTexts()).some((n) => /Pantal/.test(n)), 'pero no se ofrece para partidas nuevas');
    await p.click('#dlg-cancelar');

    // una cotización anterior que traía el lado (der/izq) y el sentido del injerto: abre, calcula igual y ya no los muestra
    const conLado = {
      app: 'COTIZAP', version: 2,
      cotizacion: { cliente: 'Anterior', proyecto: '', fecha: '2026-01-01', vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm', riesgo: 'MEDIO', servicio: 'POLVO',
        partidas: [
          { id: 'rl1', familia: 'REDUCCION_INJERTO', descripcion: 'Con lado y sentido', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 30, lado: 'IZQ', sentido: 'MAYOR', material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 },
          { id: 'rl2', familia: 'REDUCCION_INJERTO', descripcion: 'Sin lado ni sentido', D1_mm: 304.8, D2_mm: 254, d_mm: 152.4, beta_deg: 30, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 },
        ] },
      maestros: {},
    };
    await p.click('#btn-io');
    await p.fill('#io-texto', JSON.stringify(conLado));
    await p.click('#io-cargar');
    await p.waitForTimeout(150);
    const importes = await p.locator('#lista-partidas .partida-importe').allInnerTexts();
    ok(importes.length === 2 && importes.every((x) => x.includes('$')) && importes[0] === importes[1], 'una cotización anterior con lado (der/izq) y sentido sigue calculando, y los ignora: cuesta lo mismo que la partida sin ellos');
    await p.locator('#lista-partidas .partida').first().locator('button[aria-label^="Editar"]').click();
    await p.waitForSelector('#dlg-partida[open]');
    ok(await p.locator('#f_lado').count() === 0 && await p.locator('#f_sentido').count() === 0 && !/Lado del injerto|se inclina hacia/.test(await p.locator('#dlg-partida').innerText()), 'y al editarla ya no hay campo de lado ni de inclinación');
    await p.click('#dlg-cancelar');
    await p.context().close();
  }

  console.log('16) La muestra sin tocar se renueva; una cotización propia no se toca');
  {
    const partidaVieja = { id: 'r1', familia: 'RAMAL', descripcion: 'Ramal a 45° Ø8″ sobre Ø12″', D_mm: 304.8, d_mm: 203.2, L_cuerpo_mm: 700, L_ramal_mm: 450, beta_deg: 45, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 2 };
    const guardada = (ejemplo) => ({ cliente: ejemplo ? 'Cliente de ejemplo' : 'Mi cliente', proyecto: '', fecha: '2026-03-02', vigencia_dias: 30, unidad_diam: 'mm', unidad_long: 'm', riesgo: 'ALTO', servicio: 'POLVO', ejemplo, partidas: [partidaVieja] });
    const sembrar = (cot) => async (ctx) => {
      await ctx.addInitScript((c) => { if (!window.localStorage.getItem('__sembrado')) { window.localStorage.setItem('cotizap.cotizacion.v1', JSON.stringify(c)); window.localStorage.setItem('__sembrado', '1'); } }, cot);
    };
    const pm = await nuevaPagina({}, sembrar(guardada(true)));
    const titulos = await pm.locator('#lista-partidas .partida-titulo').allInnerTexts();
    ok(titulos.some((t) => /^Injerto simple a 45°/.test(t)) && titulos.some((t) => /^Reducción con injerto 45°/.test(t)), 'la muestra de una versión anterior se renueva con los nombres y las partidas actuales');
    ok(!titulos.some((t) => /^Ramal/.test(t)), 'ya no aparece "Ramal"');
    ok(await pm.locator('#c_unidad_diam').inputValue() === 'mm' && await pm.locator('#c_unidad_long').inputValue() === 'm' && await pm.locator('#c_riesgo').inputValue() === 'ALTO' && await pm.locator('#c_vigencia_dias').inputValue() === '30', 'conserva los ajustes generales que ya había cambiado');
    await pm.context().close();
    const pp = await nuevaPagina({}, sembrar(guardada(false)));
    const propios = await pp.locator('#lista-partidas .partida-titulo').allInnerTexts();
    ok(propios.length === 1 && /^Ramal a 45°/.test(propios[0]), 'una cotización propia se deja tal cual');
    await pp.context().close();
  }

  console.log('17) Ángulos del taller: injertos 30° o 45°, codos 30°, 45°, 60° o 90°');
  {
    const p = await nuevaPagina();
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    await p.click('.fam:has(span:text-is("Codo"))');
    ok(JSON.stringify(await p.locator('#f_theta_deg option').allInnerTexts()) === JSON.stringify(['30°', '45°', '60°', '90°']), 'el codo se elige entre 30°, 45°, 60° y 90°');
    ok(await p.locator('#f_theta_deg').inputValue() === '90', 'por omisión: 90°');
    for (const th of ['30', '45', '60', '90']) {
      await p.selectOption('#f_theta_deg', th);
      await p.waitForTimeout(60);
      ok(await p.locator('#dlg-prev .errores').count() === 0, `codo de ${th}° calcula sin errores`);
    }
    await p.click('.fam:has(span:text-is("Injerto simple"))');
    ok(JSON.stringify(await p.locator('#f_beta_deg option').allInnerTexts()) === JSON.stringify(['30°', '45°']), 'el injerto simple es a 30° o 45°');
    await p.selectOption('#f_beta_deg', '30');
    await p.fill('#f_L_ramal_mm', '700');
    await p.waitForTimeout(100);
    ok(await p.locator('#dlg-prev .errores').count() === 0, 'injerto simple a 30° calcula sin errores');
    await p.click('#dlg-cancelar');

    // una cotización anterior con ángulos que el taller no maneja: se marcan, se corrigen y vuelven a calcular
    const vieja = {
      app: 'COTIZAP', version: 2,
      cotizacion: { cliente: 'Anterior', proyecto: '', fecha: '2026-01-01', vigencia_dias: 15, unidad_diam: 'in', unidad_long: 'mm', riesgo: 'MEDIO', servicio: 'POLVO',
        partidas: [
          { id: 'a1', familia: 'RAMAL', descripcion: 'Injerto a 60°', D_mm: 304.8, d_mm: 203.2, L_cuerpo_mm: 700, L_ramal_mm: 450, beta_deg: 60, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 },
          { id: 'a2', familia: 'CODO', descripcion: 'Codo a 75°', D_mm: 304.8, theta_deg: 75, k_R: 1.5, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 },
          { id: 'a3', familia: 'CODO', descripcion: 'Codo a 45°', D_mm: 304.8, theta_deg: 45, k_R: 1.5, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 1 },
        ] },
      maestros: {},
    };
    await p.click('#btn-io');
    await p.fill('#io-texto', JSON.stringify(vieja));
    await p.click('#io-cargar');
    await p.waitForTimeout(150);
    ok(/2 partidas no se pueden calcular/.test(await p.locator('#aviso-error').innerText()), 'los ángulos que el taller no maneja se avisan: 2 partidas no se pueden calcular');
    await p.locator('#lista-partidas .partida:has(.partida-titulo:has-text("Injerto a 60°"))').locator('button[aria-label^="Editar"]').click();
    await p.waitForSelector('#dlg-partida[open]');
    ok((await p.locator('#f_beta_deg option:checked').innerText()) === '60° (no permitido)', 'el ángulo guardado se muestra como "60° (no permitido)"');
    ok(/Todo injerto debe ser a 30° o 45° \(la partida trae 60°\)/.test(await p.locator('#dlg-prev .errores').innerText()), 'y la vista previa dice qué corregir');
    await p.selectOption('#f_beta_deg', '45');
    await p.waitForTimeout(100);
    ok(await p.locator('#dlg-prev .errores').count() === 0, 'al elegir 45° vuelve a calcular');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(150);
    ok(/1 partida no se puede calcular/.test(await p.locator('#aviso-error').innerText()), 'queda sólo el codo de 75° por corregir');
    await p.context().close();
  }

  console.log('18) Lista de precios del proveedor y mano de obra por hora');
  {
    const p = await nuevaPagina();
    const abrirCostos = async (titulo) => {
      await p.locator(`#lista-partidas .partida:has(.partida-titulo:has-text("${titulo}"))`).click();
      await p.waitForTimeout(120);
      await p.click('summary:has-text("Costo directo por concepto")');
    };
    // una partida galvanizada cal. 22: su lámina se cuesta con la hoja cotizada ($920 con IVA)
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    await p.selectOption('#f_material_id', 'GALVANIZADO');
    await p.selectOption('#f_calibre', '22');
    await p.fill('#f_descripcion', 'Tramo galvanizado cal. 22');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(150);
    await abrirCostos('Tramo galvanizado cal. 22');
    const costos1 = await p.locator('#detalle').innerText();
    ok(/Lámina galvanizada 4 × 10 ft · cal\. 22 · \$920\.00 con IVA/.test(costos1), 'el desglose dice que la lámina sale de la hoja cotizada: $920.00 con IVA');
    ok(/\$31\.86\/kg/.test(costos1), 'y a cuánto queda por kg sin IVA: $31.86/kg');
    ok(/Solera 1½" × 3\/16" \(brida estándar\) · \$250\.00 con IVA/.test(costos1), 'los aros se cuestan con la barra de solera: $250.00 con IVA');
    ok(/\d+\.\d{3} h reales/.test(costos1), 'la mano de obra muestra las horas reales');
    // una partida de la muestra (acero al carbón cal. 16) no tiene hoja cotizada: usa el precio por kg de la tabla
    await abrirCostos('Tramo recto Ø12″ × 3 m');
    ok(/precio por kg de la tabla/.test(await p.locator('#detalle').innerText()), 'sin hoja cotizada para ese calibre, el desglose dice que usa el precio por kg de la tabla');

    // Tablas maestras: la lista del proveedor
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'galvanizada');
    const grupo = p.locator('.m-grupo[data-grupo="proveedor"]');
    ok(await grupo.isVisible() && await grupo.evaluate((e) => e.open), 'la búsqueda abre la lista de precios del proveedor');
    ok(await p.locator('.m-grupo').first().getAttribute('data-grupo') === 'proveedor', 'es el primer grupo de las tablas maestras');
    const fila22 = p.locator('tr[data-prov="hojas"][data-id="GALV_C22_4X10"]');
    ok((await fila22.locator('input').inputValue()) === '920', 'la hoja galvanizada cal. 22 trae el precio cotizado de $920');
    const txt22 = await fila22.innerText();
    ok(/793\.10/.test(txt22) && /24\.89/.test(txt22) && /31\.86/.test(txt22) && /Cálculo/.test(txt22), 'y se ven el precio sin IVA ($793.10), los kg de la hoja (24.89) y el $/kg (31.86)');
    await fila22.locator('input').fill('1000');
    await fila22.locator('input').dispatchEvent('change');
    const txt22b = await fila22.innerText();
    ok(/862\.07/.test(txt22b) && /34\.63/.test(txt22b), 'al cambiar el precio a $1,000 se recalculan el precio sin IVA ($862.07) y el $/kg ($34.63)');
    await fila22.locator('input').fill('-5');
    await fila22.locator('input').dispatchEvent('change');
    ok((await fila22.locator('input').inputValue()) === '1000', 'un precio negativo se rechaza y se restaura');
    await p.fill('#maestros-buscar', 'canal');
    ok(/Referencia/.test(await p.locator('tr[data-prov="barras"][data-id="CANAL_U_6"]').innerText()), 'lo que el cotizador no usa (canal U) se marca como referencia');
    await p.fill('#maestros-buscar', 'iva incluido');
    ok(await p.locator('input#m_proveedor__iva_incluido_pct').inputValue() === '16', 'el IVA incluido en los precios es 16 %');
    await p.click('#tab-cotizacion');
    await abrirCostos('Tramo galvanizado cal. 22');
    ok(/\$1,000\.00 con IVA/.test(await p.locator('#detalle').innerText()), 'el desglose de la partida refleja el precio nuevo al instante');

    // mano de obra: $500 por hora, sin salario diario ni jornada
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'salario_hora');
    ok(await p.locator('input#m_mano_obra__operaciones__corte__salario_hora').inputValue() === '500', 'los trabajadores ganan $500 por hora');
    ok((await p.locator('.m-fila:has(input#m_mano_obra__operaciones__corte__salario_hora) .sufijo').innerText()) === 'MXN/h', 'con la unidad MXN/h');
    ok(await p.locator('[id*="salario_diario"], [id*="jornada_h"]').count() === 0, 'ya no hay salario diario ni jornada en las tablas');
    await p.context().close();

    // un parche guardado con el salario diario de antes se limpia al abrir y la app calcula con el salario por hora
    const pv = await nuevaPagina({}, async (ctx) => {
      await ctx.addInitScript(() => {
        if (!window.localStorage.getItem('__sembrado_mo')) {
          window.localStorage.setItem('cotizap.maestros.v2', JSON.stringify({ mano_obra: { FSR: 1.6, jornada_h: 9, operaciones: { corte: { salario_diario: 700 } } } }));
          window.localStorage.setItem('cotizap.maestros.migrado_v1', 'true');
          window.localStorage.setItem('__sembrado_mo', '1');
        }
      });
    });
    const mo = await estadoApp(pv, () => { const M = window.COTIZAP.web.estadoApp.M; return { jornada: M.mano_obra.jornada_h, diario: M.mano_obra.operaciones.corte.salario_diario, hora: M.mano_obra.operaciones.corte.salario_hora, fsr: M.mano_obra.FSR }; });
    ok(mo.jornada === undefined && mo.diario === undefined && mo.hora === 500 && mo.fsr === 1.6, 'un parche anterior con salario diario y jornada se limpia: queda el salario por hora ($500) y se respeta el FSR editado');
    await pv.context().close();
  }

  console.log('19) Parámetros de precio en el encabezado de la cotización (sin ir a las tablas maestras)');
  {
    const p = await nuevaPagina();
    const T = () => estadoApp(p, () => window.COTIZAP.web.estadoApp.res.totales);
    const par = () => estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.parametros);
    const campo = (id) => p.locator(`#c_${id}`);
    const marcado = (id, clase) => p.locator(`.campo-param[data-param="${id}"]`).evaluate((e, c) => e.classList.contains(c), clase);
    ok(await campo('utilidad').inputValue() === '20' && await campo('comision').inputValue() === '2' && await campo('descuento').inputValue() === '0' && await campo('dias_cobro').inputValue() === '45',
      'arrancan con lo de las tablas maestras: margen 20 %, comisión 2 %, descuento 0 % y 45 días de cobro');
    ok(await p.locator('#c_parametros_mas').evaluate((e) => !e.open) && await campo('administracion').inputValue() === '8' && await campo('tasa').inputValue() === '14' && await campo('iva').inputValue() === '16',
      'los demás (administración 8 %, financiamiento 14 %, IVA 16 %) están en «Más parámetros de precio»');
    ok(await p.locator('.campo-param.modificado').count() === 0 && (await par()) === undefined, 'ninguno aparece como modificado');
    const t0 = await T();

    // margen de utilidad: sube el precio, se marca como modificado y dice cuál es el de las tablas
    await campo('utilidad').fill('25');
    const t25 = await T();
    ok(t25.subtotal > t0.subtotal && Math.abs(t25.margen_real_pct - 0.25) < 2e-3, `con margen de 25 % el subtotal sube (${t0.subtotal.toFixed(2)} → ${t25.subtotal.toFixed(2)}) y la utilidad real es 25 %`);
    ok(await marcado('utilidad', 'modificado') && (await par()).utilidad_pct_precio === 0.25, 'el campo se marca como modificado y se guarda como fracción en la cotización');
    const notaU = await p.locator('#c_utilidad_nota').innerText();
    ok(/equivale a 33\.3\s% sobre el costo/.test(notaU) && /maestros: 20\s%/.test(notaU), 'la nota dice a cuánto equivale sobre el costo (33.3 %) y cuál es el de las tablas (20 %)');
    ok(await p.locator('.campo-param[data-param="utilidad"] .param-reset').isVisible(), 'aparece «Restablecer»');
    await p.locator('.campo-param[data-param="utilidad"] .param-reset').click();
    ok(await campo('utilidad').inputValue() === '20' && (await par()) === undefined && (await T()).subtotal === t0.subtotal, 'restablecer vuelve al valor de las tablas y quita el parámetro de la cotización');

    // descuento: el total y el resumen lo muestran; el IVA va sobre el precio ya descontado
    await campo('descuento').fill('10');
    const td = await T();
    ok(td.descuento > 0 && Math.abs(td.descuento - Math.round(td.subtotal * 0.1 * 100) / 100) < 0.011 && Math.abs(td.iva - Math.round(td.subtotal_neto * 0.16 * 100) / 100) < 0.011, 'el descuento de 10 % se resta del subtotal y el IVA se calcula sobre el neto');
    ok(/Descuento 10 %/.test(await p.locator('#totales .hero-sub').innerText()), 'el total muestra «Descuento 10 %»');
    ok(/hasta \d+\.\d\s% sin perder utilidad/.test(await p.locator('#c_descuento_nota').innerText()), 'la nota del descuento dice hasta dónde se puede bajar sin perder utilidad');
    const utilTile = await p.locator('#totales .tile:has(.tile-et:text-is("Utilidad"))').innerText();
    ok(/con el descuento/.test(utilTile), 'la tarjeta «Utilidad» aclara que es con el descuento');
    await campo('descuento').fill('45');
    ok(await p.locator('#totales .tile.tile-adv').count() >= 1 && /por debajo del piso/.test(await p.locator('#totales').innerText()), 'un descuento que pasa del piso se avisa en rojo en «Piso de negociación»');
    await campo('descuento').fill('10');

    // fuera de rango: se rechaza sin tocar la cotización
    await campo('utilidad').fill('150');
    ok(await marcado('utilidad', 'invalido') && /de 0 a 80/.test(await p.locator('#c_utilidad_nota').innerText()) && (await T()).subtotal === t0.subtotal, 'un margen de 150 % se rechaza (de 0 a 80 %) y la cotización no cambia');
    await campo('utilidad').fill('');
    await campo('utilidad').blur();
    ok(await campo('utilidad').inputValue() === '20' && !(await marcado('utilidad', 'invalido')), 'vaciar el campo vuelve al valor de las tablas');

    // más parámetros: IVA propio
    await p.click('#c_parametros_mas > summary');
    await campo('iva').fill('8');
    ok(/IVA 8 %/.test(await p.locator('#totales .hero-sub').innerText()) && /1 modificado/.test(await p.locator('#c_parametros_mas > summary').innerText()), 'IVA al 8 % se refleja en el total y el resumen de «Más parámetros» cuenta 1 modificado');
    await campo('dias_cobro').fill('60');
    ok((await par()).dias_cobro === 60, 'los días de cobro son un entero');
    await campo('dias_cobro').fill('30.5');
    ok(await marcado('dias_cobro', 'invalido'), 'unos días de cobro con decimales se rechazan');
    await campo('dias_cobro').fill('60');

    // la vista previa de una partida usa las mismas capas que la lista
    await editar(p, 0);
    const previa = await p.locator('#dlg-prev .prev-val').innerText();
    const lista = await estadoApp(p, () => window.COTIZAP.web.mxn(window.COTIZAP.web.estadoApp.res.partidas[0].precio.unitario));
    ok(previa === lista, `la vista previa de la partida (${previa}) coincide con la lista`);
    await p.click('#dlg-cancelar');

    // la propuesta lleva el descuento y las condiciones de pago
    const prop = await p.locator('#propuesta').evaluate((e) => e.textContent);
    ok(/Descuento 10 %/.test(prop) && /IVA 8 %/.test(prop) && /crédito a 60 días/.test(prop), 'la propuesta imprimible lleva el descuento, el IVA propio y «crédito a 60 días»');
    await campo('dias_cobro').fill('0');
    ok(/de contado/.test(await p.locator('#propuesta').evaluate((e) => e.textContent)), 'con 0 días la propuesta dice «de contado»');
    await campo('dias_cobro').fill('60');

    // persiste al recargar y abre solo «Más parámetros» si algo ahí está modificado
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await campo('descuento').inputValue() === '10' && await campo('iva').inputValue() === '8' && await campo('dias_cobro').inputValue() === '60', 'los parámetros de la cotización se conservan al recargar');
    ok(await p.locator('#c_parametros_mas').evaluate((e) => e.open), '«Más parámetros de precio» abre solo porque hay uno modificado');

    // exportar e importar: los parámetros viajan con la cotización
    await p.click('#btn-io');
    const json = JSON.parse(await p.inputValue('#io-texto'));
    ok(json.cotizacion.parametros && json.cotizacion.parametros.descuento_pct === 0.1 && json.cotizacion.parametros.iva_pct === 0.08 && json.cotizacion.parametros.dias_cobro === 60, 'el JSON exportado lleva los parámetros');
    await p.click('#io-cerrar').catch(() => {});
    // un parámetro inválido en un archivo se ignora y se avisa
    const raro = { ...json, cotizacion: { ...json.cotizacion, parametros: { utilidad_pct_precio: 5, descuento_pct: 0.2 } } };
    await p.click('#btn-io');
    await p.fill('#io-texto', JSON.stringify(raro));
    await p.click('#io-cargar');
    await p.waitForTimeout(150);
    ok(/Margen de utilidad: «5» no es válido/.test(await p.locator('#aviso-error').innerText()) && await campo('descuento').inputValue() === '20', 'un parámetro inválido de un archivo se ignora y se avisa; el válido (descuento 20 %) sí se aplica');
    // cotización nueva: todo vuelve a las tablas
    await p.click('#btn-nueva');
    await p.waitForTimeout(100);
    ok(await campo('utilidad').inputValue() === '20' && await campo('descuento').inputValue() === '0' && await campo('iva').inputValue() === '16' && (await par()) === undefined, 'una cotización nueva arranca otra vez con lo de las tablas maestras');

    // lo que cambia en las tablas maestras se refleja en los campos que no se tocaron
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'utilidad_pct_precio');
    const inp = p.locator('input#m_capas__utilidad_pct_precio');
    ok(await inp.inputValue() === '20' && (await p.locator('.m-fila:has(input#m_capas__utilidad_pct_precio) .sufijo').innerText()) === '%', 'en las tablas maestras el margen también se ve en % (20 %), igual que en la cotización');
    await inp.fill('22');
    await inp.dispatchEvent('change');
    await p.click('#tab-cotizacion');
    ok(await campo('utilidad').inputValue() === '22' && (await marcado('utilidad', 'modificado')) === false, 'si se cambia el margen en las tablas maestras, el campo (sin tocar) lo sigue');
    await p.context().close();
  }

  console.log('20) Robustez: datos guardados dañados, números ilegibles, importaciones hostiles y tablas con ceros');
  {
    const LLAVE_COT = 'cotizap.cotizacion.v1';
    const LLAVE_MAE = 'cotizap.maestros.v2';
    const RECTO = { id: 'pA', familia: 'RECTO', forma: 'REDONDA', D_mm: 304.8, L_mm: 3000, material_id: 'ACERO_CARBON', calibre: 16, cantidad: 2, tipo_union: 'BRIDADO', clase_sellado: 'C', ref_diametro: 'INTERIOR', descripcion: 'Tramo sano' };
    const conAlmacen = (almacen) => (ctx) => ctx.addInitScript((a) => { Object.keys(a).forEach((k) => localStorage.setItem(k, a[k])); localStorage.setItem('cotizap.migrado.v2', '1'); }, almacen);

    // a) lo guardado en el navegador está dañado: la app abre igual y rescata lo sano
    const sucia = await nuevaPagina({}, conAlmacen({
      [LLAVE_COT]: JSON.stringify({ cliente: { a: 1 }, vigencia_dias: 'mucho', unidad_diam: 'parsecs', riesgo: {}, parametros: 'x', partidas: [null, 5, 'x', [], RECTO, { ...RECTO, id: 'pA' }, { ...RECTO, id: 7, familia: '__proto__' }] }),
      [LLAVE_MAE]: JSON.stringify({ proceso: null, capas: 5, precios: { precio_kg_acero_carbon: 'veinte' }, herrajes: [] }),
    }));
    ok(await sucia.locator('#lista-partidas .partida').count() === 3, 'datos guardados dañados: abre y conserva las 3 partidas que sí son objetos (no las 4 basuras)');
    const ids = await estadoApp(sucia, () => window.COTIZAP.web.estadoApp.cot.partidas.map((x) => x.id));
    ok(new Set(ids).size === 3 && ids.every((i) => typeof i === 'string'), 'los id repetidos o que no son texto se reponen únicos');
    ok(await estadoApp(sucia, () => window.COTIZAP.web.estadoApp.M.proceso.eficiencia_taller === 0.8 && window.COTIZAP.web.estadoApp.M.precios.precio_kg_acero_carbon === 22.47), 'las tablas dañadas se reponen con las de arranque (no se hereda un null ni un texto)');
    ok(await sucia.locator('#c_cliente').inputValue() === '' && await sucia.locator('#c_unidad_diam').inputValue() === 'in', 'la cabecera con tipos raros vuelve a valores sanos');
    ok(await sucia.locator('#lista-partidas .partida.err').count() === 1, 'la partida de familia desconocida queda marcada «Revisar datos»');
    await sucia.locator('#lista-partidas .partida.err button[aria-label^="Editar"]').click();
    ok(/familia que no existe/.test(await sucia.locator('.toast').last().innerText()) && await sucia.locator('#dlg-partida[open]').count() === 0, 'y al querer editarla se explica en vez de romperse');
    await sucia.context().close();

    // b) una tabla guardada con un cero: se avisa con la ruta y al corregirla todo vuelve
    const cero = await nuevaPagina({}, conAlmacen({ [LLAVE_MAE]: JSON.stringify({ proceso: { eficiencia_taller: 0 } }) }));
    const aviso = await cero.locator('#aviso-error').innerText();
    ok(/proceso › eficiencia taller: debe ser un número mayor que 0 \(vale 0\)/.test(aviso), `el aviso nombra la tabla y el valor: «${aviso.slice(0, 120)}»`);
    ok(await cero.locator('#lista-partidas .partida.err').count() === 6 && /Tablas maestras/.test(await cero.locator('.partida.err .chip-err').first().getAttribute('title')), 'las 6 partidas de taller se marcan con error; la comprada sigue calculándose');
    ok((await cero.locator('.hero-val').innerText()).startsWith('$'), 'la pantalla sigue viva: el total se muestra');
    await cero.click('#tab-maestros');
    await cero.fill('#maestros-buscar', 'eficiencia_taller');
    const ef = cero.locator('input#m_proceso__eficiencia_taller');
    ok(await ef.inputValue() === '0', 'el editor muestra el 0 que hay que corregir');
    await ef.fill('0.8'); await ef.dispatchEvent('change');
    ok(await cero.locator('#aviso-error').isHidden() && await cero.locator('#lista-partidas .partida.err').count() === 0, 'al capturar 0.8 desaparecen el aviso y los errores');
    await cero.context().close();

    // c) formulario de partida: lo escrito que no es un número no pasa como «automático»
    const f = await nuevaPagina();
    await f.click('#btn-nueva');
    await f.click('#btn-agregar');
    await f.waitForSelector('#dlg-partida[open]');
    const msg = async () => (await f.locator('#dlg-prev .errores').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const escribir = async (sel, v) => { await f.fill(sel, v); await f.waitForTimeout(40); return msg(); };
    ok(/«3O00» no es una medida válida/.test(await escribir('#f_L_mm', '3O00')), 'una longitud con la letra O no se toma por un campo vacío');
    await f.fill('#f_L_mm', '3000');
    await f.click('.fam:has(span:text-is("Reducción"))'); // su longitud axial es opcional (vacío = automática)
    ok(/Longitud axial: «xx» no es una medida válida/.test(await escribir('#f_L_mm', 'xx')), 'tampoco en un campo opcional');
    await f.click('.fam:has(span:text-is("Tramo recto"))');
    ok(/Diámetro: debe estar entre 25 mm y 6000 mm/.test(await escribir('#f_D_mm', '9999')), 'un diámetro de 9 999″ se rechaza con el límite del taller');
    ok(/Diámetro: debe estar entre 25 mm y 6000 mm/.test(await escribir('#f_D_mm', '-5')), 'uno negativo también');
    await f.fill('#f_D_mm', '12');
    ok(/Cantidad: debe estar entre 1 y 100000/.test(await escribir('#f_cantidad', '1000000')), 'una cantidad de un millón se rechaza');
    ok(/Cantidad: debe ser un número entero/.test(await escribir('#f_cantidad', '2.5')), 'una cantidad fraccionaria también');
    await f.fill('#f_cantidad', '2');
    ok(await f.locator('#dlg-prev .errores').count() === 0, 'con datos sanos vuelve a calcular');
    await f.click('.fam:has(span:text-is("Codo"))');
    const kr = f.locator('#f_k_R');
    await kr.click(); await kr.press('Control+A'); await kr.press('Backspace'); await kr.press('1'); await kr.press('e');
    await f.waitForTimeout(60);
    ok(/Relación R\/D: lo escrito no es un número/.test(await msg()), 'un número a medias («1e») en un campo numérico se avisa');
    await f.click('#dlg-guardar');
    ok(await f.locator('#dlg-partida[open]').count() === 1, 'y no se puede guardar');
    await kr.fill('1.5');
    await f.click('.avanzado > summary');
    await f.click('button:has-text("Agregar subcontrato")');
    const sp = f.locator('.sc-precio').first();
    await sp.click(); await sp.press('1'); await sp.press('e');
    await f.waitForTimeout(60);
    ok(/Subcontrato 1: el precio debe ser un número/.test(await msg()), 'un precio de subcontrato ilegible no se descarta en silencio');
    await f.click('#dlg-cancelar');
    await f.context().close();

    // d) importaciones hostiles: se rechazan sin dejar el estado a medias
    const im = await nuevaPagina();
    const importar = async (txt) => {
      await im.click('#btn-io');
      await im.waitForSelector('#dlg-io[open]');
      await im.fill('#io-texto', txt);
      await im.click('#io-cargar');
      await im.waitForTimeout(150);
      const abierto = await im.locator('#dlg-io[open]').count();
      if (abierto) await im.click('#io-cerrar');
      return { cargo: !abierto, toast: await im.locator('.toast').last().innerText().catch(() => '') };
    };
    const antes = await estadoApp(im, () => JSON.stringify([window.COTIZAP.web.estadoApp.cot.partidas.map((x) => x.id), window.COTIZAP.web.estadoApp.M.precios.precio_kg_acero_carbon]));
    const rechazados = ['{{{', '{}', '[]', '{"cotizacion":null}', '{"cotizacion":{"partidas":"x"},"maestros":{"precios":{"precio_kg_acero_carbon":99}}}'];
    let todosRechazados = true;
    for (const txt of rechazados) todosRechazados = todosRechazados && !(await importar(txt)).cargo;
    ok(todosRechazados, 'un texto que no es JSON, un objeto vacío, un arreglo y una cotización sin lista de partidas se rechazan');
    ok(await estadoApp(im, (a) => JSON.stringify([window.COTIZAP.web.estadoApp.cot.partidas.map((x) => x.id), window.COTIZAP.web.estadoApp.M.precios.precio_kg_acero_carbon]) === a, antes), 'y no cambian la cotización ni los precios (tampoco el «99» del archivo rechazado)');
    const r = await importar(JSON.stringify({ version: 2, cotizacion: { partidas: [null, 5, RECTO] }, maestros: { proceso: null, capas: 5, precios: { precio_kg_acero_carbon: 'x' } } }));
    ok(r.cargo && /3 valores de las tablas no tenían la forma esperada y se ignoraron/.test(r.toast), `un archivo con tablas dañadas se carga rescatando lo sano y avisa cuántos valores ignoró («${r.toast.slice(0, 80)}»)`);
    ok(await im.locator('#lista-partidas .partida').count() === 1, 'las partidas que no eran objetos se descartan');
    await importar('{"cotizacion":{"partidas":[]},"maestros":{"__proto__":{"polluted":1},"proceso":{"__proto__":{"polluted":2}}}}');
    ok(await im.evaluate(() => ({}).polluted === undefined), 'una llave __proto__ no contamina los objetos');
    await im.context().close();

    // e) editor de tablas maestras: lo que rompería el cálculo no entra
    const ed = await nuevaPagina();
    await ed.click('#tab-maestros');
    const probar = async (buscar, id, valor) => {
      await ed.fill('#maestros-buscar', buscar);
      const inp = ed.locator(`input#${id}`);
      const antes1 = await inp.inputValue();
      await inp.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, valor);
      await ed.waitForTimeout(50);
      return { igual: (await inp.inputValue()) === antes1, toast: await ed.locator('.toast').last().innerText().catch(() => '') };
    };
    let t = await probar('eficiencia_taller', 'm_proceso__eficiencia_taller', '0');
    ok(t.igual && /mayor que 0/.test(t.toast), 'la eficiencia del taller en 0 se rechaza');
    t = await probar('eficiencia_taller', 'm_proceso__eficiencia_taller', '1e999');
    ok(t.igual, 'un número infinito se rechaza');
    t = await probar('paso_tornillo_mm', 'm_herrajes__uniones__BRIDADO__paso_tornillo_mm', '0');
    ok(t.igual, 'el paso de los tornillos en 0 se rechaza');
    t = await probar('merma RECTO', 'm_merma__RECTO', '100');
    ok(t.igual && /menor que 100/.test(t.toast), 'una merma de 100 % se rechaza');
    t = await probar('FSR', 'm_mano_obra__FSR', '0');
    ok(t.igual, 'el FSR en 0 se rechaza');
    await ed.fill('#maestros-buscar', 'v_m_min');
    const celda = ed.locator('.m-tabla input[data-ruta*="GUILLOTINA"]').nth(1);
    const velAntes = await celda.inputValue();
    await celda.evaluate((e) => { e.value = '0'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    ok(await celda.inputValue() === velAntes, 'una velocidad de corte en 0 dentro de la tabla se rechaza');
    await ed.fill('#maestros-buscar', 'limites');
    ok(await ed.locator('input#m_proceso__limites__seccion_max_mm').inputValue() === '6000' && await ed.locator('input#m_proceso__limites__largo_max_mm').inputValue() === '100000' && await ed.locator('input#m_proceso__limites__piezas_max').inputValue() === '1000',
      'los límites de captura (sección máx. 6 000 mm, longitud máx. 100 000 mm, 1 000 piezas) están en «Proceso de fabricación»');
    await ed.fill('#maestros-buscar', 'limites');
    ok(JSON.stringify(await ed.evaluate(() => [...document.querySelectorAll('.m-sub')].filter((e) => e.offsetParent !== null).map((e) => e.querySelector('summary').textContent.trim()))) === '["limites"]',
      'al buscar, los subgrupos sin ningún renglón que coincida no quedan como encabezados vacíos');
    const lim = ed.locator('input#m_proceso__limites__largo_max_mm');
    await lim.fill('2000'); await lim.dispatchEvent('change');
    await ed.click('#tab-cotizacion');
    ok(await ed.locator('#lista-partidas .partida.err').count() > 0 && /Longitud total: debe estar entre 10 mm y 2000 mm/.test(await ed.locator('.partida.err .chip-err').first().getAttribute('title')), 'bajar el límite de longitud a 2 000 mm marca las partidas que lo pasan (3 000 mm) con el mensaje del límite');
    await ed.context().close();

    // f) sin almacenamiento del navegador la app trabaja igual
    const bloq = await nuevaPagina({}, (ctx) => ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } }); }));
    await bloq.click('#btn-agregar'); await bloq.waitForSelector('#dlg-partida[open]'); await bloq.click('#dlg-guardar'); await bloq.waitForTimeout(80);
    ok(await bloq.locator('#lista-partidas .partida').count() === 8, 'con el almacenamiento bloqueado se puede seguir trabajando');
    await bloq.context().close();
    const lleno = await nuevaPagina({}, (ctx) => ctx.addInitScript(() => { Storage.prototype.setItem = function setItem() { throw new DOMException('lleno', 'QuotaExceededError'); }; }));
    await lleno.click('#btn-agregar'); await lleno.waitForSelector('#dlg-partida[open]'); await lleno.click('#dlg-guardar'); await lleno.waitForTimeout(80);
    ok(await lleno.locator('#lista-partidas .partida').count() === 8, 'con el almacenamiento lleno también');
    await lleno.context().close();

    // g) pantalla de 320 px: los avisos no aplastan su texto y la página no se desplaza de lado
    const m = await nuevaPagina({ viewport: { width: 320, height: 800 } });
    const med = await m.evaluate(() => ({ txt: document.querySelector('#aviso-ilustrativo .aviso-txt').getBoundingClientRect().width, scroll: document.documentElement.scrollWidth, ancho: document.documentElement.clientWidth }));
    ok(med.txt >= 200 && med.scroll <= med.ancho, `a 320 px el texto del aviso mide ${Math.round(med.txt)} px (≥ 200) y no hay desplazamiento horizontal`);
    await m.context().close();

    // g2) lo guardado en el artefacto (compartido) también puede venir dañado: se queda lo que tiene la forma de las tablas
    const bdSucia = nuevoAlmacen();
    bdSucia.docs.set('config/maestros', { v: 2, parche: { proceso: null, precios: { precio_kg_acero_carbon: 'veinte' }, capas: { iva_pct: 0.1 }, mano_obra: 7 }, actualizado: '2026-10-05T18:00:00.000Z' });
    const compartida = await nuevaPagina({}, instalarClaude(bdSucia));
    ok(await esperarHasta(async () => (await estadoApp(compartida, () => window.COTIZAP.web.estadoApp.M.capas.iva_pct)) === 0.1), 'el almacén compartido con tablas dañadas: se aplica lo sano (IVA 10 %)');
    ok(await estadoApp(compartida, () => { const M = window.COTIZAP.web.estadoApp.M; return M.proceso.eficiencia_taller === 0.8 && M.precios.precio_kg_acero_carbon === 22.47 && M.mano_obra.FSR === 1; }), 'y lo dañado se repone con los valores de arranque (no un null ni un texto)');
    ok(await compartida.locator('#aviso-error').isHidden() && await compartida.locator('#lista-partidas .partida.err').count() === 0, 'la cotización se calcula sin errores');
    await compartida.context().close();

    // h) la fecha de una cotización nueva es la del día LOCAL: a las 9:30 pm en la Ciudad de México sigue siendo hoy (en UTC ya sería mañana)
    const noche = await nuevaPagina({ timezoneId: 'America/Mexico_City' }, (ctx) => ctx.addInitScript(() => {
      const fijo = Date.parse('2026-10-06T03:30:00Z'); // 21:30 del 5 de octubre en México
      const Real = Date;
      window.Date = class Falsa extends Real { constructor(...a) { if (a.length) super(...a); else super(fijo); } static now() { return fijo; } };
    }));
    await noche.click('#btn-nueva');
    ok(await noche.locator('#c_fecha').inputValue() === '2026-10-05', `a las 9:30 pm del 5 de octubre en México la cotización nueva lleva la fecha 2026-10-05 («${await noche.locator('#c_fecha').inputValue()}»)`);
    await noche.context().close();

    // i) un texto que Excel tomaría por fórmula se exporta como texto
    const csv = await nuevaPagina();
    await csv.click('#btn-nueva');
    await csv.click('#btn-agregar'); await csv.waitForSelector('#dlg-partida[open]');
    await csv.fill('#f_descripcion', '=HYPERLINK("http://x","clic")');
    await csv.click('#dlg-guardar');
    await csv.click('#btn-io');
    await csv.click('#io-csv');
    const lineas = (await csv.inputValue('#io-texto')).split('\n');
    ok(lineas[1].startsWith('"\'=HYPERLINK(') && !/undefined/.test(lineas.join('\n')), 'en el CSV una descripción que empieza con «=» lleva una comilla delante y no se ejecuta como fórmula');
    await csv.context().close();
  }

  console.log('21) Armado del tramo recto por yardas: 3 yardas por pieza, brida suelta en el ajuste y ancho de yarda por cotización');
  {
    const p = await nuevaPagina();
    const det = () => estadoApp(p, () => window.COTIZAP.web.estadoApp.res.partidas[0]);
    const cotP = () => estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.partidas[0]);
    const textosSvg = () => p.locator('.arm-fig svg.arm text').evaluateAll((es) => es.map((e) => e.textContent));
    const abrirTodo = async () => {
      const secs = p.locator('#detalle details.sec');
      for (let i = 0; i < await secs.count(); i += 1) if (!(await secs.nth(i).evaluate((e) => e.open))) await secs.nth(i).locator('summary').click();
    };
    // a) el tramo de 3 m de la muestra: 2 yardas de 1 220 mm y un ajuste de 560 mm, en una pieza con una brida de taller y el aro suelto del extremo libre
    await p.locator('#lista-partidas .partida').first().click();
    await abrirTodo();
    ok((await p.locator('.arm-resumen').first().innerText()) === '2 yardas + ajuste de 560 mm', 'el desglose dice el armado: «2 yardas + ajuste de 560 mm»');
    ok(await p.locator('.arm-fig svg.arm rect.arm-anillo').count() === 2 && await p.locator('.arm-fig svg.arm rect.arm-ajuste').count() === 1, 'el diagrama dibuja 2 anillos y el tramo de ajuste');
    ok(await p.locator('.arm-fig svg.arm rect.arm-brida').count() === 1 && await p.locator('.arm-fig svg.arm line.arm-libre').count() === 1 && await p.locator('.arm-fig svg.arm rect.arm-suelta').count() === 1, 'una brida de taller, el extremo libre del ajuste y, aparte, su aro suelto');
    ok((await textosSvg()).includes('brida suelta'), 'el diagrama rotula «brida suelta»');
    const fig = await p.locator('.arm-fig').innerText();
    ok(/no suelda la brida al ducto, manda suelto el aro terminado \(rolado, con el cierre soldado, barrenado y pintado\) con sus tornillos y su empaque, para soldarlo en obra/.test(fig), 'explica que el aro sale terminado (rolado, cierre soldado, barrenado y pintado) con sus tornillos y su empaque, y se suelda en obra');
    ok(/1 \+ 1 suelta/.test(fig), 'la tabla de piezas cuenta «1 + 1 suelta»');
    ok(/Caben 3 plantillas por hoja \(una por yarda/.test(await p.locator('.hoja-fig').innerText()), 'la hoja es del ancho de la yarda: caben 3 plantillas de Ø12″ a lo largo');
    ok(await p.locator('.hoja-fig svg rect.hoja-pieza').count() === 3, 'y se dibujan las 3');
    const f0 = await det();
    ok(f0.geometria.n_virolas === 3 && f0.geometria.n_piezas === 1 && f0.qto.her.n_aros === 1 && f0.qto.her.aros_sueltos.length === 1, 'el motor: 3 anillos rolados, 1 pieza, 1 aro de taller y 1 aro suelto');
    const textoDet = await p.locator('#detalle').innerText();
    ok(/Yardas \(anillos rolados\)/.test(textoDet) && /Juntas engargoladas entre yardas/.test(textoDet), 'la geometría lista los anillos y las juntas engargoladas');
    ok(/Aros sueltos \(terminados, sin unir al ducto\)/.test(textoDet) && /Suelto #1/.test(textoDet) && !/\(en obra\)/.test(textoDet), 'los herrajes listan el aro suelto terminado, con sus barrenos hechos en taller');

    // b) el ancho de la yarda se elige en la cotización (3 ó 4 pies, como decida quien diseña)
    ok((await p.locator('#c_yarda_mm option').allInnerTexts()).join('|') === 'Predeterminada · 1,220 mm · 4 ft|914 mm · 3 ft|1,220 mm · 4 ft', 'el encabezado ofrece el ancho de la yarda: predeterminada, 914 mm (3 ft) o 1 220 mm (4 ft)');
    ok(await p.locator('#c_yarda_mm').inputValue() === '', 'por omisión manda la de las tablas maestras');
    await p.selectOption('#c_yarda_mm', '914');
    await p.waitForTimeout(120);
    const f1 = await det();
    ok(f1.entrada.yarda_mm === 914 && f1.geometria.n_piezas === 2 && f1.geometria.n_virolas === 4 && f1.qto.her.n_aros === 3 && f1.qto.her.aros_sueltos.length === 1, 'con yardas de 914 en la cotización: 2 piezas, 4 anillos, 3 bridas de taller y 1 aro suelto');
    ok(f1.precio.unitario > f0.precio.unitario, `y cuesta más (${f0.precio.unitario} → ${f1.precio.unitario}): más anillos, más piezas y una brida más`);
    ok((await cotP()).yarda_mm === undefined && await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.yarda_mm) === 914, 'la cotización guarda el ancho; la partida no lo copia');
    ok(await estadoApp(p, () => window.COTIZAP.web.estadoApp.res.partidas[1].entrada.yarda_mm) === undefined, 'el codo no recibe un ancho de yarda: sólo el tramo recto se arma por yardas');
    await abrirTodo();
    ok((await p.locator('.arm-resumen').first().innerText()) === '3 yardas y ajuste de 258 mm', 'el desglose se actualiza: «3 yardas y ajuste de 258 mm»');
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await p.locator('#c_yarda_mm').inputValue() === '914', 'al recargar, la cotización recuerda el ancho elegido');

    // la partida: «Según la cotización», o su propio ancho
    await editar(p, 0);
    ok((await p.locator('#f_yarda_mm option').allInnerTexts()).join('|') === 'Según la cotización · 914 mm · 3 ft|914 mm · 3 ft|1,220 mm · 4 ft', 'la partida ofrece «Según la cotización · 914 mm · 3 ft» y los dos anchos');
    ok((await p.locator('#f_extremo_ajuste option').allInnerTexts()).join('|') === 'Predeterminado · Brida suelta (aro terminado, tornillos y empaque)|Brida suelta (aro terminado, tornillos y empaque)|Sin brida (fuera de este precio)|Brida de taller en ambos extremos', 'y el extremo del ajuste: lo predeterminado (brida suelta), brida suelta, sin brida o brida de taller');
    ok(await p.locator('#f_ajuste_sin_brida').count() === 0 && await p.locator('#f_L_max_pieza_mm').count() === 0, 'ya no están «Tramo de ajuste» (sí/no) ni «Longitud máx. por pieza»');
    ok(/3 yardas y ajuste de 258 mm/.test(await p.locator('#dlg-prev').innerText()), 'la vista previa usa el ancho de la cotización: «3 yardas y ajuste de 258 mm»');
    await p.selectOption('#f_yarda_mm', '1220');
    await p.waitForTimeout(120);
    ok(/2 yardas \+ ajuste de 560 mm/.test(await p.locator('#dlg-prev').innerText()), 'y con su propio ancho (1 220 mm): «2 yardas + ajuste de 560 mm»');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(120);
    const f2 = await det();
    ok(f2.entrada.yarda_mm === 1220 && f2.geometria.n_piezas === 1, 'la partida con su propio ancho lo conserva aunque la cotización sea de 914');
    await p.selectOption('#c_yarda_mm', '');
    await p.waitForTimeout(100);
    ok((await det()).entrada.yarda_mm === 1220 && await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.yarda_mm) === undefined, 'y quitar el ancho de la cotización no la cambia (la cotización queda sin ancho propio)');
    await editar(p, 0);
    await p.selectOption('#f_yarda_mm', '');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    ok((await cotP()).yarda_mm === undefined, 'elegir «Según la cotización» deja la partida sin ancho propio');
    await p.selectOption('#c_yarda_mm', '914');
    await p.waitForTimeout(100);

    // c) el extremo del tramo de ajuste: brida suelta (por omisión), sin brida o brida de taller
    await editar(p, 0);
    await p.selectOption('#f_extremo_ajuste', 'CON_BRIDA');
    await p.waitForTimeout(100);
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const f3 = await det();
    ok(f3.entrada.extremo_ajuste === 'CON_BRIDA' && f3.qto.her.n_aros === 4 && f3.qto.her.aros_sueltos.length === 0, 'con «Brida de taller en ambos extremos» el ajuste también lleva brida de taller: 4 bridas y ningún aro suelto');
    ok(f3.precio.unitario > f1.precio.unitario, `y cuesta más que con la brida suelta (${f1.precio.unitario} → ${f3.precio.unitario})`);
    await abrirTodo();
    ok(/Se pidió brida de taller en ambos extremos del tramo de ajuste/.test(await p.locator('.arm-fig').innerText()), 'el desglose avisa que no queda un extremo libre para ajustar en campo');
    await editar(p, 0);
    await p.selectOption('#f_extremo_ajuste', 'SIN_BRIDA');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const f4 = await det();
    ok(f4.entrada.extremo_ajuste === 'SIN_BRIDA' && f4.qto.her.n_aros === 3 && f4.qto.her.aros_sueltos.length === 0, 'con «Sin brida» quedan 3 bridas de taller y ningún aro suelto');
    ok(f4.precio.unitario < f1.precio.unitario, `y cuesta menos que con la brida suelta (${f1.precio.unitario} → ${f4.precio.unitario})`);
    await abrirTodo();
    ok((await textosSvg()).includes('sin brida') && await p.locator('.arm-fig svg.arm rect.arm-suelta').count() === 0, 'el diagrama rotula «sin brida» y ya no dibuja el aro suelto');
    ok(/va sin brida en su extremo libre/.test(await p.locator('.arm-fig').innerText()) && /no están en este precio/.test(await p.locator('.arm-fig').innerText()), 'y avisa que esa brida y su junta no están en el precio');
    // volver a lo predeterminado (vacío) quita el campo de la partida
    await editar(p, 0);
    await p.selectOption('#f_extremo_ajuste', '');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    ok((await cotP()).extremo_ajuste === undefined && (await det()).qto.her.aros_sueltos.length === 1, 'elegir «Predeterminado» deja la partida sin ese campo y manda lo de las tablas: brida suelta');

    // d) archivos de otras versiones y valores fuera de lo normal
    const cargar = async (cambiar) => {
      await p.click('#btn-io');
      const base = JSON.parse(await p.inputValue('#io-texto'));
      cambiar(base);
      await p.fill('#io-texto', JSON.stringify(base));
      await p.click('#io-cargar');
      await p.waitForTimeout(150);
    };
    // 3 400 mm en yardas de 1 000 mm = 3 yardas y un ajuste de 400 mm
    await cargar((b) => { b.cotizacion.yarda_mm = 1000; b.cotizacion.partidas[0] = { ...b.cotizacion.partidas[0], L_mm: 3400, extremo_ajuste: undefined, ajuste_sin_brida: false, L_max_pieza_mm: 2000 }; });
    ok((await det()).geometria.detalle.yarda_mm === 1000, 'un ancho de 1 000 mm guardado en el archivo (cotización) se calcula');
    ok(await p.locator('#c_yarda_mm').inputValue() === '1000' && (await p.locator('#c_yarda_mm option:checked').innerText()).trim() === '1000 mm', 'el encabezado lo muestra como «1000 mm»');
    const guardada = await cotP();
    ok(guardada.extremo_ajuste === 'CON_BRIDA' && guardada.ajuste_sin_brida === undefined, 'el «no» de la versión anterior (ajuste_sin_brida: false) pasa a «Brida de taller en ambos extremos»');
    ok((await det()).geometria.n_piezas === 2 && (await det()).qto.her.n_aros === 4 && (await det()).qto.her.aros_sueltos.length === 0, 'y se calcula con brida de taller en ambos extremos: 2 piezas (3 yardas y el ajuste), 4 bridas y ningún aro suelto');
    await editar(p, 0);
    ok((await p.locator('#f_extremo_ajuste option:checked').innerText()).trim() === 'Brida de taller en ambos extremos', 'el formulario lo muestra así');
    ok(await p.locator('#f_L_max_pieza_mm').count() === 0, 'y la «longitud máxima por pieza» de una cotización anterior se ignora (ya no existe)');
    await p.click('#dlg-cancelar');
    await cargar((b) => { b.cotizacion.yarda_mm = 5000; b.cotizacion.partidas[0] = { ...b.cotizacion.partidas[0], extremo_ajuste: undefined, ajuste_sin_brida: true }; });
    ok(await p.locator('#c_yarda_mm').inputValue() === '' && await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.yarda_mm) === undefined, 'un ancho fuera de los límites (5 000 mm) se descarta: manda el de las tablas');
    ok((await cotP()).extremo_ajuste === 'SIN_BRIDA', 'y el «sí» de la versión anterior pasa a «Sin brida»');
    await cargar((b) => { b.cotizacion.yarda_mm = 'abc'; delete b.cotizacion.partidas[0].ajuste_sin_brida; b.cotizacion.partidas[0].extremo_ajuste = 'NINGUNO'; });
    ok(await p.locator('#c_yarda_mm').inputValue() === '', 'un ancho que no es número se descarta');
    ok(/Extremo del tramo de ajuste: «NINGUNO» no existe/.test((await det()).errores.join(' ')), 'y un extremo de ajuste que no existe se señala en la partida');
    await cargar((b) => { delete b.cotizacion.partidas[0].extremo_ajuste; b.cotizacion.partidas[0].yarda_mm = 1000; b.cotizacion.partidas[0].L_mm = 3000; b.cotizacion.yarda_mm = 914; });
    ok((await det()).geometria.detalle.yarda_mm === 1000, 'la yarda de 1 000 mm de la partida manda sobre la de 914 mm de la cotización');
    await editar(p, 0);
    ok(await p.locator('#f_yarda_mm').inputValue() === '1000' && /^1000 mm$/.test((await p.locator('#f_yarda_mm option:checked').innerText()).trim()), 'el formulario la muestra como «1000 mm» (no como no permitida)');
    await p.click('#dlg-cancelar');

    // e) las tablas maestras: el armado por yardas y sus límites
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'armado_yardas');
    ok(await p.locator('input#m_proceso__armado_yardas__yarda_defecto_mm').inputValue() === '1220' && await p.locator('input#m_proceso__armado_yardas__yardas_por_pieza_max').inputValue() === '3'
      && await p.locator('input#m_proceso__armado_yardas__ajuste_tolerancia_mm').inputValue() === '25', 'las tablas traen el armado: yarda 1 220 mm, 3 yardas por pieza y tolerancia 25 mm');
    const ea = p.locator('select#m_proceso__armado_yardas__extremo_ajuste_defecto');
    ok(await ea.inputValue() === 'SUELTA' && (await ea.locator('option').allInnerTexts()).join('|') === 'Brida suelta (aro terminado, tornillos y empaque)|Sin brida (fuera de este precio)|Brida de taller en ambos extremos', 'el extremo del ajuste por omisión se elige de una lista: brida suelta (la de arranque), sin brida o brida de taller');
    const jy = p.locator('select#m_proceso__armado_yardas__junta_entre_yardas');
    ok(await jy.inputValue() === 'PITTSBURGH' && (await jy.locator('option').allInnerTexts()).join('|') === 'Soldada a tope|Soldada a traslape|Engargolado Pittsburgh', 'y la junta entre yardas, de la lista de costuras: engargolado Pittsburgh');
    const lista = await p.locator('input[id^="m_proceso__armado_yardas__yardas_mm"]').evaluateAll((es) => es.map((e) => e.value));
    ok(lista.join(',') === '914,1220', 'y la lista de anchos de yarda: 914 y 1 220 mm');
    await ea.selectOption('SIN_BRIDA');
    await p.click('#tab-cotizacion');
    ok((await det()).qto.her.aros_sueltos.length === 0, 'cambiar el extremo del ajuste en las tablas cambia lo que cotiza la partida que no elige el suyo (sin brida: ningún aro suelto)');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'armado_yardas');
    await p.locator('select#m_proceso__armado_yardas__extremo_ajuste_defecto').selectOption('SUELTA');
    // un valor guardado que no existe se muestra marcado y el cálculo lo señala con su ruta
    await estadoApp(p, () => { const W = window.COTIZAP.web; W.estadoApp.M.proceso.armado_yardas.extremo_ajuste_defecto = 'suelta'; W.recalcular(); });
    await p.click('#tab-cotizacion');
    ok(/extremo ajuste defecto: debe ser SUELTA, SIN_BRIDA, CON_BRIDA/.test(await p.locator('#aviso-error').innerText()), 'un extremo de ajuste inexistente en las tablas se avisa con su ruta');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'extremo_ajuste_defecto');
    ok((await p.locator('select#m_proceso__armado_yardas__extremo_ajuste_defecto option:checked').innerText()).trim() === 'suelta (no válido)', 'y la tabla lo muestra como «suelta (no válido)»');
    await p.locator('select#m_proceso__armado_yardas__extremo_ajuste_defecto').selectOption('SUELTA');
    await p.click('#tab-cotizacion');
    ok(await p.locator('#aviso-error').isHidden() || !/extremo ajuste defecto/.test(await p.locator('#aviso-error').innerText()), 'al elegir uno válido el aviso desaparece');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'armado_yardas');
    const maxY = p.locator('input#m_proceso__armado_yardas__yardas_por_pieza_max');
    await maxY.fill('0'); await maxY.dispatchEvent('change');
    ok(await maxY.inputValue() === '3' && /mayor que 0/.test(await p.locator('.toast').last().innerText()), 'un máximo de 0 yardas por pieza se rechaza');
    await maxY.fill('2'); await maxY.dispatchEvent('change');
    await p.click('#tab-cotizacion');
    await p.locator('#lista-partidas .partida').first().click();
    await abrirTodo();
    ok((await p.locator('.arm-resumen').first().innerText()) === '2 yardas y 1 yarda', `con 2 yardas por pieza, 3 yardas de 1 000 mm se arman en una pieza de 2 y otra de 1 («${await p.locator('.arm-resumen').first().innerText()}»)`);
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'junta_entre_yardas');
    await p.locator('select#m_proceso__armado_yardas__junta_entre_yardas').selectOption('A_TOPE');
    await p.click('#tab-cotizacion');
    ok((await det()).qto.PF.n_juntas_internas === 1 && (await det()).qto.PF.engargolado_circ_m === 0, 'si las juntas entre yardas son a tope (soldadas), ya no se engargolan: son juntas de armado');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'junta_entre_yardas');
    await p.locator('select#m_proceso__armado_yardas__junta_entre_yardas').selectOption('PITTSBURGH');
    await p.fill('#maestros-buscar', 'NEGRA_C12_3X10');
    ok(await p.locator('tr[data-id="NEGRA_C12_3X10"] .m-uso-calculo').count() === 1, 'en la lista del proveedor la hoja de 3 ft (914 mm) se marca «Cálculo»: es la de las yardas de 3 ft');
    await p.context().close();
  }

  console.log('22) Pintura: depende del material y de dónde va instalado el ducto (interior o exterior)');
  {
    const p = await nuevaPagina();
    const det = (k = 0) => estadoApp(p, (i) => window.COTIZAP.web.estadoApp.res.partidas[i], k);
    const cotP = () => estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.partidas[0]);
    const textoDet = async () => (await p.locator('#detalle').innerText()).replace(/\s+/g, ' ');
    const abrirTodo = async () => {
      const secs = p.locator('#detalle details.sec');
      for (let i = 0; i < await secs.count(); i += 1) if (!(await secs.nth(i).evaluate((e) => e.open))) await secs.nth(i).locator('summary').click();
    };
    // a) la muestra: acero al carbón y, por omisión de las tablas, instalación interior: sólo pintura
    ok((await p.locator('#c_ubicacion option').allInnerTexts()).join('|') === 'Interior · bajo techo|Exterior · a la intemperie', 'el encabezado ofrece la instalación: interior o exterior');
    ok(await p.locator('#c_ubicacion').inputValue() === 'INTERIOR', 'la cotización va con instalación interior (la de las tablas)');
    await p.locator('#lista-partidas .partida').first().click();
    await abrirTodo();
    ok(/Pintura Interior · ducto: sólo pintura \(esmalte\) · bridas: sólo pintura \(esmalte\)/.test(await textoDet()), 'el desglose dice qué se pinta: en interior, el ducto y las bridas con sólo pintura');
    const f0 = await det();
    ok(f0.qto.pint.sistema === 'ESMALTE' && f0.qto.pint.capas.join() === 'esmalte' && f0.qto.pint.A_pint_m2 > 2.9, 'acero al carbón en interior: una mano de pintura (esmalte) en todo el ducto');

    // b) exterior: primario y pintura
    await p.selectOption('#c_ubicacion', 'EXTERIOR');
    await p.waitForTimeout(120);
    const f1 = await det();
    ok(f1.qto.pint.sistema === 'PRIMARIO_ESMALTE' && f1.qto.pint.capas.join() === 'primario,esmalte' && f1.qto.pint.ubicacion === 'EXTERIOR', 'en exterior: primario y pintura');
    ok(f1.precio.unitario > f0.precio.unitario && f1.qto.pint.A_pint_m2 === f0.qto.pint.A_pint_m2, `y cuesta más (${f0.precio.unitario} → ${f1.precio.unitario}) por la mano de primario: es la misma superficie`);
    ok(await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.ubicacion) === 'EXTERIOR' && (await cotP()).ubicacion === undefined, 'la cotización guarda la instalación; la partida no la copia');
    await abrirTodo();
    ok(/Pintura Exterior · ducto: primario \+ pintura \(esmalte\) · bridas: primario \+ pintura \(esmalte\)/.test(await textoDet()), 'el desglose dice «Exterior · … primario + pintura»');
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await p.locator('#c_ubicacion').inputValue() === 'EXTERIOR', 'al recargar, la cotización recuerda la instalación');

    // c) lámina galvanizada: no se pinta más que las bridas
    await editar(p, 0);
    await p.selectOption('#f_material_id', 'GALVANIZADO');
    await p.waitForTimeout(100);
    ok(await p.locator('#dlg-prev .errores').count() === 0, 'la vista previa del galvanizado calcula sin errores');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(150);
    const f2 = await det();
    ok(f2.qto.pint.sistema === 'NINGUNA' && f2.qto.pint.sistema_bridas === 'PRIMARIO_ESMALTE', 'galvanizado en exterior: el ducto sin pintura y las bridas con primario y pintura');
    ok(f2.qto.pint.A_pint_m2 === f2.qto.her.A_pintura_aros_m2 && f2.qto.pint.A_pint_m2 < 0.5, `sólo se pintan los aros (${f2.qto.pint.A_pint_m2.toFixed(3)} m²), no los ~3 m² del ducto`);
    ok(f2.costos.consumibles.pintura < 0.1 * f1.costos.consumibles.pintura, 'y la pintura cuesta una fracción de la del acero al carbón');
    await p.locator('#lista-partidas .partida').first().click();
    await abrirTodo();
    ok(/Pintura Exterior · ducto: sin pintura · bridas: primario \+ pintura \(esmalte\)/.test(await textoDet()), 'el desglose dice «ducto: sin pintura · bridas: primario + pintura»');
    await p.selectOption('#c_ubicacion', 'INTERIOR');
    await p.waitForTimeout(100);
    ok((await det()).qto.pint.sistema_bridas === 'ESMALTE' && (await det()).qto.pint.sistema === 'NINGUNA', 'galvanizado en interior: las bridas con sólo pintura');

    // d) la partida puede traer su propia instalación y elegir el sistema de pintura
    await editar(p, 0);
    ok((await p.locator('#f_ubicacion option').allInnerTexts()).join('|') === 'Según la cotización|Interior (bajo techo)|Exterior (a la intemperie)', 'la partida ofrece «Según la cotización», interior y exterior');
    ok((await p.locator('#f_pintura option').allInnerTexts()).join('|') === 'Según material e instalación|Sin pintura|Sólo pintura (esmalte)|Sólo primario|Primario + pintura (esmalte)', 'y el sistema de pintura: según la regla del taller, ninguna, sólo pintura, sólo primario o primario y pintura');
    await p.selectOption('#f_ubicacion', 'EXTERIOR');
    await p.waitForTimeout(100);
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const f3 = await det();
    ok(f3.entrada.ubicacion === 'EXTERIOR' && f3.qto.pint.sistema_bridas === 'PRIMARIO_ESMALTE', 'la partida en exterior manda sobre la cotización en interior');
    await editar(p, 0);
    await p.selectOption('#f_pintura', 'ESMALTE');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const f4 = await det();
    ok(f4.entrada.pintura === 'ESMALTE' && f4.qto.pint.sistema === 'ESMALTE' && f4.qto.pint.A_pint_m2 > 2.9, 'un sistema elegido en la partida pinta todo (también el ducto galvanizado)');
    await p.locator('#lista-partidas .partida').first().click();
    await abrirTodo();
    ok(/Pintura Elegida en la partida · ducto: sólo pintura \(esmalte\) · bridas: sólo pintura \(esmalte\)/.test(await textoDet()), 'y el desglose dice que lo eligió la partida');
    await editar(p, 0);
    await p.selectOption('#f_pintura', '');
    await p.selectOption('#f_ubicacion', '');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const g = await cotP();
    ok(g.pintura === undefined && g.ubicacion === undefined, 'volver a «según la cotización» y «según material e instalación» deja la partida sin esos campos');

    // e) archivos de otras versiones
    const cargar = async (cambiar) => {
      await p.click('#btn-io');
      const base = JSON.parse(await p.inputValue('#io-texto'));
      cambiar(base);
      await p.fill('#io-texto', JSON.stringify(base));
      await p.click('#io-cargar');
      await p.waitForTimeout(150);
    };
    await cargar((b) => { delete b.cotizacion.ubicacion; b.maestros = { materiales: { ACERO_CARBON: { pintura_defecto: 'NINGUNA' } } }; });
    ok(await p.locator('#c_ubicacion').inputValue() === 'INTERIOR', 'una cotización guardada sin instalación (versión anterior) abre en interior');
    ok(!/ignoraron/.test(await p.locator('.toast').last().innerText()), 'y la pintura por defecto del material de una versión anterior se migra sin avisar de valores ignorados');
    ok(await estadoApp(p, () => 'pintura_defecto' in window.COTIZAP.web.estadoApp.M.materiales.ACERO_CARBON) === false, 'ya no queda como campo suelto en las tablas');
    await cargar((b) => { b.cotizacion.ubicacion = 'PATIO'; });
    ok(await p.locator('#c_ubicacion').inputValue() === 'INTERIOR' && await p.locator('#aviso-error').isHidden(), 'una instalación que no existe en el archivo se repone con la de las tablas, sin errores');
    await cargar((b) => { b.cotizacion.partidas[0].ubicacion = 'PATIO'; });
    ok(/Ubicación de la instalación: «PATIO» no existe/.test((await det()).errores.join(' ')), 'pero una partida con una instalación que no existe se señala (no se calcula con un valor inventado)');
    await cargar((b) => { delete b.cotizacion.partidas[0].ubicacion; });

    // f) tablas maestras: qué sistema lleva cada material y la instalación por omisión
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'pintura_cuerpo');
    const ext = p.locator('select#m_materiales__ACERO_CARBON__pintura_cuerpo__EXTERIOR');
    ok(await ext.inputValue() === 'PRIMARIO_ESMALTE' && (await ext.locator('option').allInnerTexts()).join('|') === 'Sin pintura|Sólo pintura (esmalte)|Sólo primario|Primario + pintura (esmalte)', 'las tablas traen el sistema de cada material, por ubicación, como lista: acero al carbón en exterior = primario + pintura');
    ok(await p.locator('select#m_materiales__GALVANIZADO__pintura_cuerpo__INTERIOR').inputValue() === 'NINGUNA' && await p.locator('select#m_materiales__GALVANIZADO__pintura_cuerpo__EXTERIOR').inputValue() === 'NINGUNA', 'el galvanizado no lleva pintura en el ducto, ni en interior ni en exterior');
    await p.fill('#maestros-buscar', 'pintura_bridas');
    ok(await p.locator('select#m_materiales__GALVANIZADO__pintura_bridas__INTERIOR').inputValue() === 'ESMALTE' && await p.locator('select#m_materiales__GALVANIZADO__pintura_bridas__EXTERIOR').inputValue() === 'PRIMARIO_ESMALTE', 'pero sí en las bridas: interior, sólo pintura; exterior, primario y pintura');
    await p.fill('#maestros-buscar', 'pintura_cuerpo');
    await p.selectOption('select#m_materiales__ACERO_CARBON__pintura_cuerpo__EXTERIOR', 'ESMALTE');
    await p.click('#tab-cotizacion');
    await p.selectOption('#c_ubicacion', 'EXTERIOR');
    await p.waitForTimeout(100);
    ok((await det(1)).familia === 'CODO' && (await det(1)).qto.pint.sistema === 'ESMALTE', 'cambiar el sistema de un material en las tablas recalcula la cotización (el codo de acero al carbón, en exterior, con sólo pintura)');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'pintura_cuerpo');
    await p.selectOption('select#m_materiales__ACERO_CARBON__pintura_cuerpo__EXTERIOR', 'PRIMARIO_ESMALTE');
    await p.fill('#maestros-buscar', 'ubicacion_defecto');
    const ub = p.locator('select#m_proceso__pintura__ubicacion_defecto');
    ok(await ub.inputValue() === 'INTERIOR' && (await ub.locator('option').allInnerTexts()).join('|') === 'Interior (bajo techo)|Exterior (a la intemperie)', 'la instalación por omisión es una lista: interior (la de arranque) o exterior');
    await ub.selectOption('EXTERIOR');
    await p.click('#tab-cotizacion');
    await p.click('#btn-nueva');
    ok(await p.locator('#c_ubicacion').inputValue() === 'EXTERIOR', 'una cotización nueva abre con la instalación por omisión de las tablas');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'ubicacion_defecto');
    await p.locator('select#m_proceso__pintura__ubicacion_defecto').selectOption('INTERIOR');
    // un sistema que no existe en las tablas se muestra marcado y se avisa con su ruta
    await estadoApp(p, () => { const W = window.COTIZAP.web; W.estadoApp.M.materiales.ACERO_CARBON.pintura_cuerpo.INTERIOR = 'ORO'; W.recalcular(); });
    await p.click('#tab-cotizacion');
    ok(/pintura cuerpo › INTERIOR: debe ser un sistema de pintura/.test(await p.locator('#aviso-error').innerText()), 'un sistema de pintura inexistente en las tablas se avisa con su ruta');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'pintura_cuerpo');
    ok((await p.locator('select#m_materiales__ACERO_CARBON__pintura_cuerpo__INTERIOR option:checked').innerText()).trim() === 'ORO (no válido)', 'y la tabla lo muestra como «ORO (no válido)»');
    await p.locator('select#m_materiales__ACERO_CARBON__pintura_cuerpo__INTERIOR').selectOption('ESMALTE');
    await p.click('#tab-cotizacion');
    ok(await p.locator('#aviso-error').isHidden() || !/pintura cuerpo/.test(await p.locator('#aviso-error').innerText()), 'al elegir uno válido el aviso desaparece');
    await p.context().close();
  }

  ok(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await browser.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron');
  process.exit(fallos ? 1 : 0);
})();
