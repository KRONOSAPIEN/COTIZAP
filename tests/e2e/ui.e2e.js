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

const URL = pathToFileURL(path.resolve(__dirname, '../../src/web/index.html')).href;
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

  ok(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await browser.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron');
  process.exit(fallos ? 1 : 0);
})();
