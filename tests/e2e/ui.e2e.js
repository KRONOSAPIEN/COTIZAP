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
  ok(await page.locator('#lista-partidas .partida').count() === 9, 'la cotización de ejemplo trae 9 partidas (con soportería e instalación)');
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
  for (const fam of ['Tramo recto', 'Codo', 'Reducción', 'Transición', 'Injerto simple', 'Reducción con injerto', 'Armado de piezas', 'Personalizada', 'Comprado']) {
    await page.click('#btn-agregar');
    await page.waitForSelector('#dlg-partida[open]');
    await page.click(`.fam:has(span:text-is("${fam}"))`);
    await page.waitForTimeout(80);
    ok(await page.locator('#dlg-prev .errores').count() === 0, `${fam}: la vista previa calcula sin errores`);
    await page.click('#dlg-guardar');
    await page.waitForTimeout(80);
  }
  ok(await page.locator('#lista-partidas .partida').count() === 9, 'las 9 familias quedaron en la lista');

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
  ok(await page.locator('#lista-partidas .partida').count() === 10, 'duplicar suma una partida');
  await page.locator('#lista-partidas .partida').nth(2).locator('button[aria-label="Eliminar"]').click();
  ok(await page.locator('#lista-partidas .partida').count() === 9, 'eliminar resta una partida');
  await page.click('.toast button:has-text("Deshacer")');
  ok(await page.locator('#lista-partidas .partida').count() === 10, 'deshacer la recupera');

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
    const hacia = p.locator('select#m_proceso__injerto_inclinado_hacia');
    ok(await hacia.inputValue() === 'MENOR', 'en Tablas maestras: "injerto inclinado hacia" = MENOR (de extremo mayor a menor), y se elige de una lista');
    await hacia.selectOption('MAYOR');
    const invertido = await resRI();
    ok(invertido.ok && invertido.precio > basePrecio, 'si el taller lo cambiara a MAYOR, la reducción con injerto cuesta más y se recalcula al instante');
    await estadoApp(p, () => { window.COTIZAP.web.estadoApp.M.proceso.injerto_inclinado_hacia = 'ARRIBA'; window.COTIZAP.web.recalcular(); }); // un valor que la lista no ofrece (archivo dañado, almacén compartido)
    const malo = await resRI();
    ok(!malo.ok && /injerto inclinado hacia/.test(malo.errores.join(' ')), 'un valor inválido se avisa con el nombre del dato de maestros');
    await hacia.selectOption('MENOR');
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

    // mano de obra: $500 por día; como lo calcula el taller, la hora es el salario del día ÷ 8 h = $62.50
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'salario_diario');
    ok(await p.locator('input#m_mano_obra__operaciones__corte__salario_diario').inputValue() === '500', 'los trabajadores ganan $500 por día');
    ok((await p.locator('.m-fila:has(input#m_mano_obra__operaciones__corte__salario_diario) .sufijo').innerText()) === 'MXN/día', 'con la unidad MXN/día');
    ok(await p.locator('input#m_mano_obra__operaciones__instalacion__salario_diario').count() === 1, 'también la cuadrilla de instalación');
    ok(await p.locator('[id*="salario_hora"], [id*="jornada_h"]').count() === 0, 'ya no hay salario por hora ni la jornada de antes');
    await p.fill('#maestros-buscar', 'jornada');
    ok(await p.locator('input#m_mano_obra__jornada__horas_dia').inputValue() === '8' && await p.locator('[id*="dias_pagados"], [id*="dias_trabajados"]').count() === 0, 'la jornada: 8 h por día (sin días pagados ni trabajados)');
    ok(await estadoApp(p, () => window.COTIZAP.manoObra.tarifa(window.COTIZAP.web.estadoApp.M, 'corte').mo_h) === 62.5, 'la hora cuesta $62.50 ($500 ÷ 8 h)');
    await p.fill('#maestros-buscar', 'FSR');
    ok(await p.locator('input#m_mano_obra__FSR').inputValue() === '1', 'el FSR arranca en 1.00 (la hora sin los días de descanso ni las prestaciones)');
    await p.context().close();

    // un parche guardado con la jornada de antes pasa a la jornada nueva; el salario por hora de la versión anterior se descarta
    const pv = await nuevaPagina({}, async (ctx) => {
      await ctx.addInitScript(() => {
        if (!window.localStorage.getItem('__sembrado_mo')) {
          window.localStorage.setItem('cotizap.maestros.v2', JSON.stringify({ mano_obra: { FSR: 1.6, jornada_h: 9, jornada: { dias_pagados_semana: 7, dias_trabajados_semana: 5 }, operaciones: { corte: { salario_diario: 700, salario_hora: 550 } } } }));
          window.localStorage.setItem('cotizap.maestros.migrado_v1', 'true');
          window.localStorage.setItem('__sembrado_mo', '1');
        }
      });
    });
    const mo = await estadoApp(pv, () => {
      const M = window.COTIZAP.web.estadoApp.M;
      return { vieja: M.mano_obra.jornada_h, horas: M.mano_obra.jornada.horas_dia, dias: Object.keys(M.mano_obra.jornada).join(','), diario: M.mano_obra.operaciones.corte.salario_diario, hora: M.mano_obra.operaciones.corte.salario_hora, fsr: M.mano_obra.FSR, mo_h: window.COTIZAP.manoObra.tarifa(M, 'corte').mo_h };
    });
    ok(mo.vieja === undefined && mo.horas === 9 && mo.dias === 'horas_dia' && mo.diario === 700 && mo.hora === undefined && mo.fsr === 1.6 && Math.abs(mo.mo_h - (700 / 9) * 1.6) < 1e-9,
      'un parche anterior: la jornada de 9 h pasa a «horas por día», se descartan los días de la semana y el salario por hora, y se respetan el salario diario y el FSR editados');
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
    ok(await cero.locator('#lista-partidas .partida.err').count() === 7 && /Tablas maestras/.test(await cero.locator('.partida.err .chip-err').first().getAttribute('title')),
      'las 6 partidas de lámina y la soportería (usan la eficiencia del taller) se marcan con error; la comprada y la instalación siguen calculándose');
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
    ok(JSON.stringify(await ed.evaluate(() => [...document.querySelectorAll('.m-sub')].filter((e) => e.offsetParent !== null).map((e) => e.querySelector('summary').textContent.trim()))) === '["Límites de captura"]',
      'al buscar, los subgrupos sin ningún renglón que coincida no quedan como encabezados vacíos');
    const lim = ed.locator('input#m_proceso__limites__largo_max_mm');
    await lim.fill('2000'); await lim.dispatchEvent('change');
    await ed.click('#tab-cotizacion');
    ok(await ed.locator('#lista-partidas .partida.err').count() > 0 && /Longitud total: debe estar entre 10 mm y 2000 mm/.test(await ed.locator('.partida.err .chip-err').first().getAttribute('title')), 'bajar el límite de longitud a 2 000 mm marca las partidas que lo pasan (3 000 mm) con el mensaje del límite');
    await ed.context().close();

    // f) sin almacenamiento del navegador la app trabaja igual
    const bloq = await nuevaPagina({}, (ctx) => ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } }); }));
    await bloq.click('#btn-agregar'); await bloq.waitForSelector('#dlg-partida[open]'); await bloq.click('#dlg-guardar'); await bloq.waitForTimeout(80);
    ok(await bloq.locator('#lista-partidas .partida').count() === 10, 'con el almacenamiento bloqueado se puede seguir trabajando');
    await bloq.context().close();
    const lleno = await nuevaPagina({}, (ctx) => ctx.addInitScript(() => { Storage.prototype.setItem = function setItem() { throw new DOMException('lleno', 'QuotaExceededError'); }; }));
    await lleno.click('#btn-agregar'); await lleno.waitForSelector('#dlg-partida[open]'); await lleno.click('#dlg-guardar'); await lleno.waitForTimeout(80);
    ok(await lleno.locator('#lista-partidas .partida').count() === 10, 'con el almacenamiento lleno también');
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
    ok(/no suelda la brida al ducto, manda suelto el aro terminado \(rolado, con el cierre soldado, barrenado y pintado\) con sus tornillos y el material de su junta, para soldarlo en obra/.test(fig), 'explica que el aro sale terminado (rolado, cierre soldado, barrenado y pintado) con sus tornillos y el material de su junta, y se suelda en obra');
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
    ok((await p.locator('#f_extremo_ajuste option').allInnerTexts()).join('|') === 'Predeterminado · con ajuste, brida suelta; sin ajuste, bridas en ambos extremos|Brida suelta (aro terminado, tornillos y junta)|Sin brida (brida en un solo extremo)|Brida de taller (bridas en ambos extremos)', 'y el extremo final: lo predeterminado (con ajuste, brida suelta; sin ajuste, de taller), brida suelta, sin brida o brida de taller');
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
    ok((await p.locator('#f_extremo_ajuste option:checked').innerText()).trim() === 'Brida de taller (bridas en ambos extremos)', 'el formulario lo muestra así');
    ok(await p.locator('#f_L_max_pieza_mm').count() === 0, 'y la «longitud máxima por pieza» de una cotización anterior se ignora (ya no existe)');
    await p.click('#dlg-cancelar');
    await cargar((b) => { b.cotizacion.yarda_mm = 5000; b.cotizacion.partidas[0] = { ...b.cotizacion.partidas[0], extremo_ajuste: undefined, ajuste_sin_brida: true }; });
    ok(await p.locator('#c_yarda_mm').inputValue() === '' && await estadoApp(p, () => window.COTIZAP.web.estadoApp.cot.yarda_mm) === undefined, 'un ancho fuera de los límites (5 000 mm) se descarta: manda el de las tablas');
    ok((await cotP()).extremo_ajuste === 'SIN_BRIDA', 'y el «sí» de la versión anterior pasa a «Sin brida»');
    await cargar((b) => { b.cotizacion.yarda_mm = 'abc'; delete b.cotizacion.partidas[0].ajuste_sin_brida; b.cotizacion.partidas[0].extremo_ajuste = 'NINGUNO'; });
    ok(await p.locator('#c_yarda_mm').inputValue() === '', 'un ancho que no es número se descarta');
    ok(/Extremo final del tramo: «NINGUNO» no existe/.test((await det()).errores.join(' ')), 'y un extremo de ajuste que no existe se señala en la partida');
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
    ok(await ea.inputValue() === 'SUELTA' && (await ea.locator('option').allInnerTexts()).join('|') === 'Brida suelta (aro terminado, tornillos y junta)|Sin brida (brida en un solo extremo)|Brida de taller (bridas en ambos extremos)', 'el extremo del ajuste por omisión se elige de una lista: brida suelta (la de arranque), sin brida o brida de taller');
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

  console.log('23) Tablas maestras más intuitivas: ayuda emergente (ⓘ), «¿y si…?», datos de lista, último cambio con deshacer, guía y ranking');
  {
    const p = await nuevaPagina();
    const W = (fn, arg) => estadoApp(p, fn, arg);
    const subtotal = () => W(() => window.COTIZAP.web.estadoApp.res.totales.subtotal_neto);
    const mxn = (x) => W((v) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v), x);
    const pop = p.locator('#m-pop');
    const fila = (id) => p.locator(`.m-fila:has(#${id})`);
    await p.click('#tab-maestros');

    // a) todo tiene su ⓘ: una por cada dato, sección, tabla y grupo que el editor dibuja
    const nUnidades = await W(() => window.COTIZAP.ayudaMaestros.recorrer(window.COTIZAP.web.estadoApp.M).length);
    ok(await p.locator('.m-ayuda').count() === nUnidades && nUnidades > 400, `cada dato, sección, tabla y grupo trae su ⓘ (${nUnidades})`);
    ok(await p.locator('.m-ayuda').evaluateAll((bs) => bs.every((b) => /^Ayuda: .{3,}/.test(b.getAttribute('aria-label')) && b.getAttribute('aria-haspopup') === 'dialog' && b.getAttribute('aria-expanded') === 'false')), 'todos tienen nombre accesible, avisan que abren una ventana y arrancan cerrados');
    ok(await p.locator('.m-grupo > summary .m-ayuda').first().getAttribute('tabindex') === null && await p.locator('.m-fila .m-ayuda').first().getAttribute('tabindex') === '-1', 'los de grupo y sección se alcanzan con Tab; los de cada renglón se abren con F1 (no estorban al recorrer 450 campos)');
    ok(await p.locator('.m-grupo[data-grupo="proveedor"] .m-chip-real').count() === 1 && await p.locator('.m-grupo[data-grupo="proceso"] .m-chip-ilustrativo').count() === 1, 'cada grupo dice si sus valores son reales o ilustrativos');

    // b) ventana: qué es, cómo se llena, qué esperar
    await p.locator('.m-grupo[data-grupo="precios"] > summary').click();
    const GAS = 'm_precios__precio_m3_gas_mezcla_ar_co2';
    ok((await fila(GAS).locator('.m-et').innerText()) === 'Gas mezcla Ar/CO₂' && (await fila(GAS).locator('.m-clave').innerText()) === 'precio_m3_gas_mezcla_ar_co2', 'cada renglón dice qué es en palabras y conserva debajo el nombre de la variable');
    await fila(GAS).locator('.m-ayuda').click();
    ok(await pop.isVisible() && await pop.getAttribute('role') === 'dialog' && /Gas mezcla Ar\/CO₂/.test(await pop.locator('h3').innerText()), 'el ⓘ abre una ventana con el título del dato');
    const hs = await pop.locator('h4').allInnerTexts();
    ok(['¿QUÉ ES?', '¿CÓMO SE LLENA?', '¿QUÉ ESPERAR AL CAMBIARLO?'].every((t) => hs.some((h4) => h4.toUpperCase() === t)), 'explica qué es, cómo se llena y qué esperar al cambiarlo');
    ok(/precios › precio m3 gas mezcla ar co2/.test(await pop.locator('.m-pop-ruta').innerText()) && /MXN\/m³/.test(await pop.locator('.m-pop-meta').innerText()), 'dice dónde vive el dato y en qué unidad se captura');
    ok(await pop.locator('.m-rango').count() === 1 && /Rango usual: 80 – 300 MXN\/m³/.test(await pop.locator('.m-rango-txt').innerText()), 'trae el rango usual con una barra que marca dónde está el valor');
    ok(await fila(GAS).locator('.m-ayuda').getAttribute('aria-expanded') === 'true', 'el botón avisa que su ventana está abierta');
    await p.keyboard.press('Escape');
    ok(await pop.isHidden() && await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('m-ayuda')), 'Esc la cierra y devuelve el foco al botón');
    await fila(GAS).locator('.m-ayuda').click();
    await fila(GAS).locator('.m-ayuda').click();
    ok(await pop.isHidden(), 'pulsar otra vez el mismo ⓘ la cierra');
    await fila(GAS).locator('.m-ayuda').click();
    await p.mouse.click(700, 120);
    ok(await pop.isHidden(), 'un clic fuera la cierra');
    await fila('m_precios__precio_kg_solera').locator('.m-ayuda').click();
    await fila(GAS).locator('.m-ayuda').click();
    ok(await p.locator('#m-pop:not([hidden])').count() === 1 && /Gas mezcla/.test(await pop.locator('h3').innerText()), 'abrir otro ⓘ cambia de ventana (nunca hay dos)');
    await p.keyboard.press('Escape');

    // c) con su cotización: cuánto movería el precio, calculado de verdad
    await fila(GAS).locator('input').focus();
    await p.keyboard.press('F1');
    ok(await pop.isVisible() && /Gas mezcla/.test(await pop.locator('h3').innerText()), 'F1 con el cursor en un campo abre su ayuda');
    const base = await subtotal();
    const sube = await W(() => { const Wa = window.COTIZAP.web; const M = window.COTIZAP.util.clonar(Wa.estadoApp.M); M.precios.precio_m3_gas_mezcla_ar_co2 *= 1.1; return Wa.cotizarCon(M).totales.subtotal_neto - Wa.estadoApp.res.totales.subtotal_neto; });
    const sens = await pop.locator('.m-sens').innerText();
    ok(sens.includes(`+${await mxn(sube)}`) && /Si sube 10 %/.test(sens) && /Si baja 10 %/.test(sens), `«si sube 10 %» dice cuánto sube de verdad la cotización (+${sube.toFixed(2)})`);
    ok(sube > 0 && /▲/.test(sens) && /▼/.test(sens), 'con la flecha de cada sentido');
    await pop.locator('.m-sim-rap button:has-text("+10 %")').click();
    await p.waitForTimeout(200);
    ok((await pop.locator('.m-sim-in').inputValue()) === '159.5' && /▲/.test(await pop.locator('.m-sim-res').innerText()), 'probar +10 % pone 159.5 y muestra el efecto sin guardar');
    ok(await subtotal() === base && await p.locator(`#${GAS}`).inputValue() === '145', 'probar no cambia nada guardado');
    await pop.locator('.m-sim-in').fill('-5');
    await p.waitForTimeout(150);
    ok(/Use un número, 0 o mayor/.test(await pop.locator('.m-sim-res').innerText()) && await pop.locator('button:has-text("Aplicar este valor")').isDisabled(), 'un valor no válido se avisa y no se puede aplicar');
    await pop.locator('.m-sim-in').fill('159.5');
    await p.waitForTimeout(150);
    await pop.locator('button:has-text("Aplicar este valor")').click();
    await p.waitForTimeout(150);
    ok(await p.locator(`#${GAS}`).inputValue() === '159.5' && Math.abs((await subtotal()) - base - sube) < 0.006, 'aplicar escribe el valor en la tabla y recalcula la cotización (igual a lo que se vio)');
    ok(await fila(GAS).getAttribute('data-mod') === '1' && /Modificado/.test(await pop.locator('.m-pop-meta').innerText()) && /Valor de arranque: 145/.test(await pop.locator('.m-pop-pie').innerText()), 'el dato queda marcado como modificado y la ventana dice cuál era el valor de arranque');
    // la barra de último cambio
    const ultimo = p.locator('#maestros-ultimo');
    ok(await ultimo.isVisible() && /Gas mezcla Ar\/CO₂: 145 MXN\/m³ → 159.5 MXN\/m³/.test(await ultimo.innerText()) && /▲/.test(await ultimo.locator('.m-ultimo-efecto').innerText()), 'la barra «Último cambio» dice qué se cambió y cuánto subió la cotización');
    ok(/Sólo modificados \(1\)/.test(await p.locator('#maestros-solo-mod').innerText()) && /1 modificado/.test(await p.locator('.m-grupo[data-grupo="precios"] .m-grupo-mod').innerText()), 'y el encabezado y el grupo cuentan lo modificado');
    await p.keyboard.press('Escape');
    await p.click('#maestros-deshacer');
    await p.waitForTimeout(150);
    ok(await p.locator(`#${GAS}`).inputValue() === '145' && Math.abs((await subtotal()) - base) < 0.006 && await fila(GAS).getAttribute('data-mod') === '' && await ultimo.isHidden(), 'Deshacer devuelve el valor y el precio, y quita la marca');
    ok(/Sólo modificados \(0\)/.test(await p.locator('#maestros-solo-mod').innerText()), 'el contador vuelve a 0');

    // d) escribir en el campo también deja su efecto y se puede deshacer
    await p.fill(`#${GAS}`, '170');
    await p.locator(`#${GAS}`).dispatchEvent('change');
    ok(await ultimo.isVisible() && /145 MXN\/m³ → 170 MXN\/m³/.test(await ultimo.innerText()), 'al teclear en el campo también aparece «Último cambio»');
    await p.fill(`#${GAS}`, '165');
    await p.locator(`#${GAS}`).dispatchEvent('change');
    await p.click('#maestros-deshacer');
    ok(await p.locator(`#${GAS}`).inputValue() === '170', 'los cambios se deshacen de uno en uno, del último al primero');
    await p.click('#maestros-deshacer');
    ok(await p.locator(`#${GAS}`).inputValue() === '145', 'hasta el valor de arranque');
    // «sólo modificados»
    await p.fill(`#${GAS}`, '150');
    await p.locator(`#${GAS}`).dispatchEvent('change');
    await p.click('#maestros-solo-mod');
    ok(await p.locator('.m-fila:not([hidden])').count() === 1 && await p.locator(`#${GAS}`).isVisible() && await p.locator('#maestros-solo-mod').getAttribute('aria-pressed') === 'true', '«Sólo modificados» deja a la vista únicamente lo que se ha cambiado');
    await p.click('#maestros-solo-mod');
    await p.click('#maestros-deshacer');
    ok(await p.locator('.m-fila:not([hidden])').count() > 100, 'al apagarlo vuelve todo');

    // e) un dato que la cotización no usa lo dice
    await fila('m_precios__precio_kg_chatarra_acero').locator('.m-ayuda').click();
    ok(/no usa este dato/.test(await pop.locator('.m-pop-cuerpo').innerText()), 'si la cotización no usa el dato (chatarra, con recuperación en 0 %) lo dice en vez de mostrar ceros');
    await p.keyboard.press('Escape');

    // f) fuera del rango usual
    await p.locator('.m-grupo[data-grupo="capas"] > summary').click();
    await p.fill('#m_capas__utilidad_pct_precio', '70');
    await p.locator('#m_capas__utilidad_pct_precio').dispatchEvent('change');
    ok(await fila('m_capas__utilidad_pct_precio').getAttribute('data-rango') === 'alto' && /Fuera del rango usual/.test(await p.locator('#m_capas__utilidad_pct_precio').getAttribute('title')), 'un valor fuera del rango usual (utilidad de 70 %) se marca, sin impedirlo');
    await fila('m_capas__utilidad_pct_precio').locator('.m-ayuda').click();
    ok(/por encima/.test(await pop.locator('.m-rango-txt').innerText()) && await pop.locator('.m-rango-marca.fuera').count() === 1, 'y la ventana lo explica');
    await p.keyboard.press('Escape');
    await p.click('#maestros-deshacer');
    ok(await fila('m_capas__utilidad_pct_precio').getAttribute('data-rango') === '', 'al volver al valor usual la marca desaparece');

    // g) datos de lista: opciones comparadas con la cotización
    await p.fill('#maestros-buscar', 'extremo_ajuste');
    const EXT = 'm_proceso__armado_yardas__extremo_ajuste_defecto';
    const baseExt = await subtotal();
    await fila(EXT).locator('.m-ayuda').click();
    const ops = pop.locator('.m-comp-op');
    ok(await ops.count() === 3 && await pop.locator('.m-comp-op.actual').count() === 1 && /Ahora/.test(await pop.locator('.m-comp-op.actual').innerText()), 'una lista muestra cada opción, cuál es la de ahora, y qué significa cada una');
    ok(await pop.locator('.m-comp-op:not(.actual) .m-efecto').count() === 2 && (await pop.locator('.m-comp-op:not(.actual) .m-efecto').allInnerTexts()).every((t) => /\$/.test(t)), 'y cuánto cambiaría la cotización con cada una de las otras');
    await pop.locator('.m-comp-op:has-text("Sin brida") button:has-text("Usar")').click();
    await p.waitForTimeout(150);
    ok(await p.locator(`#${EXT}`).inputValue() === 'SIN_BRIDA' && (await subtotal()) < baseExt, '«Usar» aplica la opción y recalcula (sin brida cuesta menos)');
    await p.keyboard.press('Escape');
    await p.click('#maestros-deshacer');
    ok(await p.locator(`#${EXT}`).inputValue() === 'SUELTA' && Math.abs((await subtotal()) - baseExt) < 0.006, 'Deshacer regresa la opción');

    // h) lo que antes se tecleaba ahora se elige: precios, calibres, procesos, cordón, Sí/No
    await p.fill('#maestros-buscar', 'gas_ref');
    const gasRef = p.locator('select#m_materiales__ACERO_CARBON__gas_ref');
    const opsGas = await gasRef.locator('option').allInnerTexts();
    ok(/^precio_m3_gas_mezcla_ar_co2 · 145 MXN\/m³$/.test(opsGas[0]) && opsGas[1].startsWith('precio_m3_gas_argon') && opsGas[2] === '— otros precios —', 'los precios a los que apunta un material se eligen de una lista, con su precio actual, y primero los del tipo que corresponde');
    ok(await gasRef.locator('option:checked').innerText() !== '' && await gasRef.inputValue() === 'precio_m3_gas_mezcla_ar_co2', 'el valor guardado queda elegido');
    await fila('m_materiales__ACERO_CARBON__gas_ref').locator('.m-ayuda').click();
    ok(/145 MXN\/m³/.test(await pop.locator('.m-pop-cuerpo').innerText()) && await pop.locator('button:has-text("Ir a ese precio")').count() === 1, 'su ayuda dice cuánto vale ese precio y lleva a él');
    await pop.locator('button:has-text("Ir a ese precio")').click();
    await p.waitForTimeout(300);
    ok(await pop.isHidden() && await p.locator('#maestros-buscar').inputValue() === '' && await p.locator('#m_precios__precio_m3_gas_mezcla_ar_co2').isVisible() && await p.evaluate(() => document.activeElement.id) === 'm_precios__precio_m3_gas_mezcla_ar_co2', '«Ir a ese precio» limpia el filtro, abre el grupo y deja el cursor en el campo');
    await p.fill('#maestros-buscar', 'tabla_calibre');
    ok(await p.locator('select#m_materiales__GALVANIZADO__tabla_calibre').inputValue() === 'GSG' && (await p.locator('select#m_materiales__GALVANIZADO__tabla_calibre option').allInnerTexts()).join('|') === 'MSG|GSG|USSG', 'la tabla de calibres de un material se elige entre las que existen');
    await p.fill('#maestros-buscar', 'proceso_sold');
    ok((await p.locator('select#m_materiales__INOX_304__proceso_sold option').allInnerTexts()).join('|') === 'GMAW|GTAW', 'el proceso de soldadura se elige entre los definidos');
    await p.fill('#maestros-buscar', 'proceso_recto');
    ok((await p.locator('select#m_proceso__corte__proceso_recto option').allInnerTexts()).join('|') === 'GUILLOTINA|PLASMA|LASER', 'la máquina de corte se elige entre las que tienen tabla de velocidades');

    // i) booleanos y vacíos: antes se guardaban como texto «false» (verdadero para JavaScript) y el guardado los descartaba
    await p.fill('#maestros-buscar', 'soldada');
    const sold = p.locator('select#m_proceso__costuras__A_TOPE__soldada');
    ok((await sold.locator('option').allInnerTexts()).join('|') === 'Sí|No' && await sold.inputValue() === 'true', '«la costura se suelda» es Sí/No');
    await sold.selectOption('false');
    ok(await W(() => window.COTIZAP.web.estadoApp.M.proceso.costuras.A_TOPE.soldada) === false && await W(() => window.COTIZAP.web.estadoApp.M.proceso.costuras.A_TOPE.cordon) === 'TOPE', 'se guarda como verdadero booleano (no como el texto «false»)');
    await p.waitForTimeout(150);
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'soldada');
    ok(await p.locator('select#m_proceso__costuras__A_TOPE__soldada').inputValue() === 'false', 'y sobrevive a recargar la página');
    await p.locator('select#m_proceso__costuras__A_TOPE__soldada').selectOption('true');
    await p.fill('#maestros-buscar', 'cordon');
    const cord = p.locator('select#m_proceso__costuras__PITTSBURGH__cordon');
    ok(await cord.inputValue() === '' && await W(() => window.COTIZAP.web.estadoApp.M.proceso.costuras.PITTSBURGH.cordon) === null, 'una costura sin cordón (null) se ve como «Sin cordón», no como el texto «null»');
    await cord.selectOption('FILETE');
    ok(await W(() => window.COTIZAP.web.estadoApp.M.proceso.costuras.PITTSBURGH.cordon) === 'FILETE', 'se puede elegir un cordón');
    await cord.selectOption('');
    ok(await W(() => window.COTIZAP.web.estadoApp.M.proceso.costuras.PITTSBURGH.cordon) === null, 'y volver a «sin cordón» lo deja en null');
    await p.fill('#maestros-buscar', 'sistemas');
    ok(await p.locator('select#m_proceso__pintura__sistemas__PRIMARIO_ESMALTE__1').inputValue() === 'esmalte', 'las manos de cada sistema de pintura se eligen entre las pinturas definidas');
    // un cero en el ancho de un perfil con punto en su clave se rechaza
    await p.fill('#maestros-buscar', 'SOL38x4.8');
    const ancho = p.locator('[id="m_herrajes__perfiles__SOL38x4.8__ancho_mm"]');
    await ancho.fill('0');
    await ancho.dispatchEvent('change');
    ok(await ancho.inputValue() === '38.1' && /mayor que 0/.test(await p.locator('#toasts').innerText()), 'un cero en el ancho del perfil SOL38x4.8 se rechaza y se conserva 38.1');

    // j) buscar por lo que es, no sólo por su nombre técnico
    await p.fill('#maestros-buscar', 'factor de operación');
    ok(await p.locator('.m-fila:not([hidden])').count() === 2 && await p.locator('#m_proceso__soldadura__procesos__GMAW__FO').isVisible(), 'se busca por el nombre en palabras («factor de operación» encuentra FO)');
    await p.fill('#maestros-buscar', 'zzzz');
    ok(await p.locator('#maestros-sin-resultados').isVisible(), 'sin coincidencias lo dice');
    await p.fill('#maestros-buscar', '');

    // k) grupos y secciones: qué mueve más el precio ahí
    await p.locator('.m-grupo[data-grupo="mano_obra"] > summary .m-ayuda').click();
    ok(/Ajustar todos de golpe/i.test(await pop.innerText()) && /¿QUÉ MUEVE MÁS EL PRECIO AQUÍ\?/i.test(await pop.innerText()), 'el grupo de mano de obra ofrece ajustar todos los salarios y ver qué pesa más');
    await pop.locator('.m-pop-cuerpo .m-sim-in').first().fill('10');
    await p.waitForTimeout(150);
    ok(/11 salarios por día cambiarían/.test(await pop.locator('.m-sim-res').first().innerText()), 'dice cuántos valores cambiarían (las 10 operaciones del taller y la instalación)');
    const baseMO = await subtotal();
    await pop.locator('button:has-text("Aplicar a todos")').click();
    await p.waitForTimeout(200);
    ok(await W(() => Object.values(window.COTIZAP.web.estadoApp.M.mano_obra.operaciones).every((o) => o.salario_diario === 550)) && (await subtotal()) > baseMO, 'un solo clic sube 10 % todos los salarios por día ($500 → $550) y recalcula');
    ok(/10 % a todos los salarios por día/.test(await ultimo.innerText()), 'y la barra lo cuenta como un solo cambio');
    await p.click('#maestros-deshacer');
    ok(await W(() => Object.values(window.COTIZAP.web.estadoApp.M.mano_obra.operaciones).every((o) => o.salario_diario === 500)) && Math.abs((await subtotal()) - baseMO) < 0.006, 'y un solo Deshacer los regresa todos');
    await p.locator('.m-grupo[data-grupo="mano_obra"] > summary .m-ayuda').click(); // un clic en «Deshacer» cerró la ventana: se vuelve a abrir
    await p.locator('.m-pop button:has-text("Calcular qué mueve")').click();
    await p.waitForSelector('.m-pop .m-rank-fila');
    const filasRank = await p.locator('.m-pop .m-rank-fila').count();
    ok(filasRank >= 3 && filasRank <= 8 && /Factor de Salario Real|Salario por día|Días pagados|Días trabajados|Horas por día/.test(await p.locator('.m-pop .m-rank-fila').first().innerText()), 'ordena los datos del grupo por cuánto mueven el precio de la cotización');
    await p.locator('.m-pop .m-rank-btn').first().click();
    await p.waitForTimeout(400);
    ok(await pop.isHidden() && await p.evaluate(() => /^m_mano_obra__/.test(document.activeElement.id)), 'pulsar uno lleva a ese dato');
    // tablas: el proveedor se ajusta de golpe
    await p.fill('#maestros-buscar', '');
    await p.locator('.m-grupo[data-grupo="proveedor"] > summary').click();
    await p.locator('.m-prov').first().locator('.m-tabla-tit .m-ayuda').click();
    ok(/Concepto/.test(await pop.locator('.m-cols').innerText()) && /ES LO ÚNICO QUE SE CAPTURA AQUÍ/.test(await pop.locator('.m-cols').innerText()), 'la tabla del proveedor explica cada columna y cuál es la única que se captura');
    await pop.locator('.m-pop-cuerpo .m-sim-in').first().fill('6');
    await pop.locator('button:has-text("Aplicar a todos")').click();
    await p.waitForTimeout(200);
    ok(await W(() => window.COTIZAP.web.estadoApp.M.proveedor.hojas.NEGRA_C12_4X10.precio) === 2141.2 && /6 % a todos los precios de las hojas/.test(await ultimo.innerText()), 'el proveedor subió 6 %: un clic ajusta los precios de todas las hojas (2 020 → 2 141.2)');
    await p.click('#maestros-deshacer');
    ok(await W(() => window.COTIZAP.web.estadoApp.M.proveedor.hojas.NEGRA_C12_4X10.precio) === 2020, 'y se deshace');
    await p.keyboard.press('Escape');

    // l) ranking y guía
    await p.click('#maestros-ranking');
    await p.waitForSelector('#dlg-ranking .m-rank-fila', { timeout: 20000 });
    const nr = await p.locator('#dlg-ranking .m-rank-fila').count();
    const vals = await p.locator('#dlg-ranking .m-rank-val').allInnerTexts();
    const abs = vals.map((t) => Number(t.split('·')[0].replace(/[^0-9.]/g, '')));
    ok(nr === 15 && abs.every((v, i) => i === 0 || abs[i - 1] >= v - 0.005), 'el ranking muestra los 15 datos que más mueven el precio, de mayor a menor');
    ok(/Eficiencia del taller|Factor de Salario Real|Utilidad/.test(await p.locator('#dlg-ranking').innerText()), 'con datos que de verdad pesan (eficiencia, salario, utilidad…)');
    await p.locator('#dlg-ranking .m-rank-btn').first().click();
    await p.waitForTimeout(500);
    ok(await p.locator('#dlg-ranking').count() === 0 && await p.evaluate(() => /^m_/.test(document.activeElement.id)), 'pulsar uno cierra el ranking y lleva al dato');
    await p.click('#maestros-guia');
    ok(/Así se arma un precio/.test(await p.locator('#dlg-guia').innerText()) && await p.locator('#dlg-guia .guia-flujo li').count() === 8 && await p.locator('#dlg-guia .guia-pasos li').count() === 6, 'la guía rápida explica cómo se arma un precio (8 pasos) y en qué orden llenar (6)');
    await p.locator('#dlg-guia .guia-pasos li').nth(5).locator('button').click();
    await p.waitForTimeout(400);
    ok(await p.locator('#dlg-guia').count() === 0 && await p.locator('.m-grupo[data-grupo="capas"]').evaluate((g) => g.open), '«Ir» cierra la guía y abre el grupo');
    await p.keyboard.press('Escape');
    await p.context().close();

    // m) en el celular la ayuda es una hoja desde abajo y nada se sale de la pantalla
    const m = await nuevaPagina({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.click('#tab-maestros');
    await m.locator('.m-grupo[data-grupo="capas"] > summary').click();
    await m.locator('.m-fila:has(#m_capas__utilidad_pct_precio) .m-ayuda').tap();
    const hoja = m.locator('#m-pop');
    const caja = await hoja.boundingBox();
    ok(await hoja.evaluate((e) => e.classList.contains('m-pop-hoja')) && caja.x === 0 && Math.abs(caja.width - 390) < 1 && Math.abs(caja.y + caja.height - 844) < 2, 'la ayuda sale como hoja pegada al borde inferior, a lo ancho de la pantalla');
    ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sin desplazamiento horizontal');
    await m.locator('#m-pop .m-pop-x').tap();
    ok(await hoja.isHidden(), 'se cierra con la ✕');
    await m.locator('#maestros-ranking').scrollIntoViewIfNeeded();
    await m.context().close();

    // n) sólo lectura: la ayuda se lee, pero «aplicar» no escribe nada
    const bdL = nuevoAlmacen();
    bdL.puedeEditar = false;
    const pl = await nuevaPagina({}, instalarClaude(bdL));
    await pl.click('#tab-maestros');
    await pl.waitForTimeout(400);
    await pl.locator('.m-grupo[data-grupo="precios"] > summary').click();
    await pl.locator('.m-fila:has(#m_precios__precio_m3_gas_mezcla_ar_co2) .m-ayuda').click();
    ok(await pl.locator('#m-pop').isVisible(), 'en sólo lectura la ayuda se puede leer');
    await pl.locator('#m-pop .m-sim-in').fill('200');
    await pl.waitForTimeout(150);
    await pl.locator('#m-pop button:has-text("Aplicar este valor")').click();
    ok(await pl.evaluate(() => window.COTIZAP.web.estadoApp.M.precios.precio_m3_gas_mezcla_ar_co2) === 145 && /Sólo lectura/.test(await pl.locator('#toasts').innerText()), 'pero aplicar un valor avisa «Sólo lectura» y no cambia nada');
    await pl.context().close();
  }

  console.log('24) Hoja de control de gastos: familias nuevas, compras en piezas enteras, venta pactada y control de gastos');
  {
    const p = await nuevaPagina();
    const R = (fn, arg) => estadoApp(p, fn, arg);
    const esperar = async (fn, ms = 4000) => {
      const fin = Date.now() + ms;
      while (Date.now() < fin) { if (await R(fn)) return true; await p.waitForTimeout(60); }
      return false;
    };
    const HORA = 500 / 8; // $62.50: el salario del día ÷ 8 h

    // a) el selector ofrece las familias nuevas y cada una calcula con sus valores de arranque
    await p.click('#btn-nueva');
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    const nombres = await p.locator('#dlg-familias .fam span').allInnerTexts();
    ok(['Bridas sueltas', 'Soportería', 'Comprado', 'Instalación'].every((n) => nombres.includes(n)), 'el selector ofrece bridas sueltas, soportería, comprado e instalación');
    await p.click('.fam:has(span:text-is("Bridas sueltas"))');
    ok(await p.locator('#f_tipo_union').count() === 0 && await p.locator('#f_material_id').count() === 1 && /material del ducto/i.test(await p.locator('#dlg-campos').innerText()),
      'las bridas sueltas no preguntan la unión (siempre bridadas) y su material es el del ducto');
    ok(/Solera por aro/.test(await p.locator('#dlg-prev').innerText()) && await p.locator('#dlg-prev .errores').count() === 0, 'la vista previa dice cuánta solera lleva cada aro');
    await p.fill('#f_cantidad', '30');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);

    // b) artículo comprado del catálogo: toma su precio, su descripción y si trae IVA
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Comprado"))');
    await p.selectOption('#f_articulo_id', 'BRIDA_PLACA_5');
    await p.waitForTimeout(80);
    ok(await p.getAttribute('#f_precio_compra_unitario', 'placeholder') === '110' && await p.getAttribute('#f_tornillos_pieza', 'placeholder') === '3' && await p.getAttribute('#f_circulo_barrenos_mm', 'placeholder') === '170',
      'una brida de placa del catálogo sugiere su precio ($110), sus juegos de tornillo (3: 6 barrenos) y su círculo de barrenos (170 mm)');
    await p.selectOption('#f_articulo_id', 'ABRAZADERA_MANGUERA');
    await p.waitForTimeout(80);
    ok(await p.inputValue('#f_precio_compra_unitario') === '' && await p.getAttribute('#f_precio_compra_unitario', 'placeholder') === '55', 'al elegir un artículo el precio queda vacío y se sugiere el del catálogo ($55)');
    ok(await p.getAttribute('#f_tornillos_pieza', 'placeholder') === '0' && await p.getAttribute('#f_circulo_barrenos_mm', 'placeholder') === '0', 'y lo que no se atornilla no sugiere tornillos ni junta');
    await p.fill('#f_cantidad', '18');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const abr = await R(() => { const f = window.COTIZAP.web.estadoApp.res.partidas[1]; return { CD: f.costos.CD, cat: f.compra.categoria }; });
    ok(Math.abs(abr.CD - (18 * 55) / 1.16) < 1e-6 && abr.cat === 'PROVEEDOR', 'el catálogo dice que $55 trae IVA: se cuesta sin IVA');
    ok(/Abrazadera ajustable para manguera/.test(await p.locator('#lista-partidas .partida').nth(1).innerText()), 'sin descripción propia, la partida se llama como el artículo');
    await p.locator('#lista-partidas .partida').nth(1).click();
    ok(/Del catálogo de compras/.test(await p.locator('#detalle').innerText()) && /Compras y trabajos de terceros/.test(await p.locator('#detalle').innerText()), 'el desglose dice de dónde sale el precio y su renglón del control de gastos');

    // c) instalación con viáticos: horas reales a $62.50, casetas y gasolina sin el IVA que se acredita
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Instalación"))');
    ok(/Veces/.test(await p.locator('label[for="f_cantidad"]').innerText()) && /con IVA, como en el ticket/i.test(await p.locator('#dlg-campos').innerText()), 'la cantidad son visitas y los viáticos se capturan con IVA');
    await p.fill('#f_dias', '5');
    await p.fill('#f_casetas_viaje', '806');
    await p.fill('#f_gasolina_viaje', '1500');
    ok(await p.locator('.campo[data-campo="hospedaje_noche"]').isHidden(), 'el hospedaje por noche sólo se pide si hay noches');
    await p.fill('#f_noches', '4');
    ok(await p.locator('.campo[data-campo="hospedaje_noche"]').isVisible(), 'con noches aparece el hospedaje');
    await p.fill('#f_noches', '0');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const ins = await R(() => window.COTIZAP.web.estadoApp.res.partidas[2].costos);
    ok(Math.abs(ins.h_MOD - 80) < 1e-9 && Math.abs(ins.CD - (80 * HORA * 1.03 + (806 + 1500) / 1.16)) < 1e-6, 'instalación: 2 personas × 5 días × 8 h a $62.50 + casetas y gasolina sin IVA');
    await p.locator('#lista-partidas .partida').nth(2).click();
    ok(/Cuadrilla y viáticos/.test(await p.locator('#detalle').innerText()) && /sin IVA \(con factura\)/.test(await p.locator('#detalle').innerText()), 'el desglose muestra la cuadrilla y la base de cada viático');
    ok(/\$62\.50\s*salario por día ÷ 8 h/.test(await p.locator('#detalle').innerText()), 'y el costo por hora: el salario por día ÷ 8 h = $62.50');

    // d) soportería: piezas de una barra de la lista, anclajes del catálogo
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    ok(await p.locator('.campo[data-campo="articulo_anclaje"]').isHidden(), 'sin anclajes no se pregunta cuál');
    await p.fill('#f_anclajes_pieza', '4');
    ok(await p.locator('.campo[data-campo="articulo_anclaje"]').isVisible(), 'con anclajes se elige el del catálogo');
    await p.fill('#f_cantidad', '7');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    await p.locator('#lista-partidas .partida').nth(3).click();
    ok(/Pieza, barra y anclajes/.test(await p.locator('#detalle').innerText()) && /28 × Taquete/.test(await p.locator('#detalle').innerText()), 'el desglose de la soportería dice barra, metros y anclajes');
    ok(/min reales por pieza/.test(await p.locator('#detalle').innerText()), 'y que los minutos de taller son reales (sin eficiencia)');
    // una abrazadera se pide por el diámetro del ducto: su largo sale solo
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    await p.selectOption('#f_barra_id', 'SOL_1_1_4X1_8');
    await p.fill('#f_largo_pieza_mm', '');
    await p.fill('#f_abrazadera_D_mm', '11');
    await p.fill('#f_cantidad', '7');
    ok(/3\.81 m de Solera 1¼/.test(await p.locator('#dlg-prev').innerText()) && await p.locator('#dlg-prev .errores').count() === 0, 'sin largo, la vista previa ya calcula la solera de las 7 abrazaderas (3.81 m) sin errores');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const abz = await R(() => window.COTIZAP.web.estadoApp.res.partidas[4].soporte);
    ok(Math.abs(abz.largo_pieza_mm - ((Math.PI * (279.4 + 3.175)) / 2 + 100)) < 1e-9 && abz.largo_calculado === true, `el largo de cada abrazadera sale de π × (D + t) ÷ 2 + 2 orejas: ${abz.largo_pieza_mm.toFixed(1)} mm`);
    ok(/abrazadera para ducto Ø11/.test(await p.locator('#lista-partidas .partida').nth(4).innerText()), 'la lista de partidas dice «abrazadera para ducto Ø11″»');
    await p.locator('#lista-partidas .partida').nth(4).click();
    ok(/abrazadera de media vuelta/.test(await p.locator('#detalle').innerText()), 'el desglose lo explica');

    // e) lista de compras en piezas enteras y el sobrante como partida automática
    await p.click('#tab-compras');
    ok(await p.locator('#panel-compras').isVisible() && await p.locator('#tab-compras').getAttribute('aria-selected') === 'true', 'la pestaña Compras y gastos se abre');
    const lista = await p.locator('#cg-lista').innerText();
    const sol = await R(() => window.COTIZAP.web.estadoApp.res.compras.barras.find((b) => b.clave === 'SOL_1_1_2X3_16'));
    ok(sol.piezas === 30 && sol.compra >= Math.ceil(sol.necesario) && new RegExp(`Solera 1½" × 3/16"[\\s\\S]*?${sol.compra} barras`).test(lista), `los 30 aros se acomodan en ${sol.compra} barras de solera de 6 m`);
    ok(/Ángulo 1¼" × 1\/8"/.test(lista) && /28 pzas/.test(lista), 'y la lista trae el ángulo de las ménsulas y los 28 taquetes');
    const subSin = await R(() => window.COTIZAP.web.estadoApp.res.totales.subtotal);
    await p.check('#cg_piezas_enteras');
    ok(await esperar(() => window.COTIZAP.web.estadoApp.res.automaticas.length === 1), 'cobrar el sobrante agrega una partida automática');
    const auto = await R(() => { const r = window.COTIZAP.web.estadoApp.res; return { imp: r.automaticas[0].precio.importe, sub: r.totales.subtotal, n: r.totales.n_partidas_ok }; });
    ok(Math.abs(auto.sub - subSin - auto.imp) < 0.011 && auto.n === 5, 'el subtotal sube lo de esa partida y no cuenta como partida del usuario');
    await p.click('#tab-cotizacion');
    ok(await p.locator('#lista-partidas .partida-auto').count() === 1 && /Automática/.test(await p.locator('#lista-partidas .partida-auto').innerText()), 'en la cotización se ve la partida automática');
    ok(/material sobrante/i.test(await p.locator('#totales').innerText()), 'y los totales dicen que incluyen el sobrante');
    await p.click('#lista-partidas .partida-auto button');
    ok(await p.locator('#panel-compras').isVisible(), '«Ver la lista de compras» lleva a la pestaña');
    await p.uncheck('#cg_piezas_enteras');
    ok(await esperar(() => window.COTIZAP.web.estadoApp.res.automaticas.length === 0), 'y se quita');

    // f) venta pactada: el resultado contra el costo y el precio mínimo
    await p.fill('#cg_venta_pactada', '-5');
    await p.waitForTimeout(80);
    ok(await p.locator('#cg-venta-campo').evaluate((e) => e.classList.contains('invalido')) && await R(() => window.COTIZAP.web.estadoApp.cot.venta_pactada === undefined), 'una venta negativa se marca y no se usa');
    const T0 = await R(() => window.COTIZAP.web.estadoApp.res.totales);
    const venta = Math.round(T0.costo_directo * 1.1);
    await p.fill('#cg_venta_pactada', String(venta));
    ok(await esperar(() => !!window.COTIZAP.web.estadoApp.res.totales.venta), 'una venta válida se toma');
    const V = await R(() => window.COTIZAP.web.estadoApp.res.totales.venta);
    ok(V.pactada === venta && V.cubre_costo_directo === true && V.cubre_precio_minimo === false && V.utilidad < 0, 'vender 10 % arriba del costo directo cubre el costo pero no el precio mínimo');
    ok(/le faltan/.test(await p.locator('#cg-resultado').innerText()) && await p.locator('#cg-resultado .cg-marca-venta').count() === 1, 'la regla marca la venta y dice cuánto falta para el precio mínimo');
    await p.click('#tab-cotizacion');
    ok(await p.locator('#totales .venta-res.venta-adv').count() === 1, 'los totales de la cotización muestran la venta pactada en amarillo (cubre el costo directo, no los indirectos)');
    await p.click('#tab-compras');
    // la misma cifra, pero con IVA: el margen se mide con la venta sin IVA
    ok(await p.locator('#cg_venta_sufijo').innerText() === 'MXN sin IVA' && !(await p.locator('#cg_venta_con_iva').isChecked()), 'por omisión la venta se captura sin IVA');
    await p.check('#cg_venta_con_iva');
    ok(await esperar(() => window.COTIZAP.web.estadoApp.res.totales.venta.con_iva === true), 'marcar «ya incluye IVA» recalcula');
    const Vi = await R(() => window.COTIZAP.web.estadoApp.res.totales.venta);
    ok(Math.abs(Vi.pactada - venta / 1.16) < 1e-6 && Vi.capturada === venta && Math.abs(Vi.total - venta) < 0.006, 'con IVA: la venta antes de IVA es lo capturado ÷ 1.16 y el total con IVA es lo capturado');
    ok(await p.locator('#cg_venta_sufijo').innerText() === 'MXN con IVA' && /Se capturó con IVA/.test(await p.locator('#cg-resultado').innerText()), 'la captura y el resultado dicen que la venta trae IVA');
    await p.click('#tab-cotizacion');
    ok(/con IVA/.test(await p.locator('#totales .venta-res').innerText()) && /Antes de IVA son/.test(await p.locator('#totales .venta-res').innerText()), 'los totales muestran la venta con IVA y la cifra antes de IVA');
    await p.click('#tab-compras');
    await p.uncheck('#cg_venta_con_iva');
    ok(await esperar(() => window.COTIZAP.web.estadoApp.res.totales.venta.con_iva === false && window.COTIZAP.web.estadoApp.cot.venta_pactada_con_iva === undefined), 'y desmarcarlo la regresa a sin IVA');

    // g) captura de gastos: agregar, categoría, costo sin IVA, quitar y deshacer
    ok(/Todavía no hay gastos/.test(await p.locator('#cg-captura').innerText()), 'sin gastos, la captura lo dice');
    await p.click('#cg-agregar');
    const fila = p.locator('#cg-captura tr[data-id]').first();
    ok(await p.evaluate(() => document.activeElement.classList.contains('cg-in-concepto')), 'el renglón nuevo queda listo para escribir el concepto');
    await fila.locator('[data-campo="concepto"]').fill('6 soleras 1½″ × 3/16″');
    await fila.locator('[data-campo="cantidad"]').fill('6');
    await fila.locator('[data-campo="precio_unitario"]').fill('250.0032');
    await p.waitForTimeout(80);
    ok(/\$1,293\.12/.test(await fila.locator('[data-campo="costo"]').innerText()), 'con IVA y factura el costo es sin IVA: 6 × $250.00 ÷ 1.16 = $1,293.12');
    await fila.locator('[data-campo="con_factura"]').uncheck();
    await p.waitForTimeout(80);
    ok(/\$1,500\.02/.test(await fila.locator('[data-campo="costo"]').innerText()), 'sin factura el IVA es costo');
    await fila.locator('[data-campo="categoria"]').selectOption('MANO_OBRA');
    await p.waitForTimeout(80);
    ok(!(await fila.locator('[data-campo="iva_incluido"]').isChecked()) && !(await fila.locator('[data-campo="con_factura"]').isChecked()), 'al pasar a mano de obra se quitan IVA y factura (la raya no lleva IVA)');
    await fila.locator('[data-campo="categoria"]').selectOption('MATERIAL');
    await fila.locator('[data-campo="iva_incluido"]').check();
    await p.waitForTimeout(80);
    ok(await fila.locator('[data-campo="con_factura"]').isChecked(), 'y al volver a material, la factura vuelve');
    await fila.locator('[data-campo="cantidad"]').fill('-1');
    await p.waitForTimeout(80);
    ok(await fila.evaluate((e) => e.classList.contains('cg-mal')) && /Renglón 1/.test(await p.locator('#cg-comparacion').innerText()), 'una cantidad negativa marca el renglón y se avisa');
    await fila.locator('[data-campo="cantidad"]').fill('6');
    await p.waitForTimeout(80);
    const cmp = await p.locator('#cg-comparacion').innerText();
    ok(/Real contra cotizado/i.test(cmp) && /\$1,293\.12/.test(cmp) && /Utilidad antes de indirectos/.test(cmp), 'la comparación por categoría y el resultado del proyecto se actualizan al teclear');
    await fila.locator('[data-quitar]').click();
    ok(await p.locator('#cg-captura tr[data-id]').count() === 0, 'quitar un gasto lo quita');
    await p.click('.toast button:has-text("Deshacer")');
    ok(await p.locator('#cg-captura tr[data-id]').count() === 1, 'y deshacer lo regresa');

    // h) la lista de compras como base de los gastos: renglones «estimado» que se vuelven reales al editarlos
    await p.click('#cg-a-gastos');
    await p.waitForTimeout(120);
    const nEst = await p.locator('#cg-captura tr.cg-estimado').count();
    const conteo = await R(() => window.COTIZAP.web.comprasUI.gastosEsperados().length);
    ok(nEst === conteo && nEst >= 8 && await p.locator('#cg-captura tr[data-id]').count() === nEst + 1, 'cada compra, la soldadura, la mano de obra y los viáticos llegan como «estimado», y el gasto real se queda');
    const cats = await R(() => window.COTIZAP.web.estadoApp.cot.gastos.filter((g) => g.estimado).map((g) => g.categoria));
    ok(['MATERIAL', 'SOPORTERIA', 'PROVEEDOR', 'MANO_OBRA', 'INSTALACION', 'VIATICOS'].every((c) => cats.includes(c)), 'cada renglón cae en su categoría (material, soportería, compras, mano de obra, instalación y viáticos)');
    const casi = await R(() => { const G = window.COTIZAP.gastos; const r = G.resumen(window.COTIZAP.web.estadoApp.res, window.COTIZAP.web.estadoApp.cot.gastos.filter((g) => g.estimado), 0.16); return Math.abs(r.totales.real - r.totales.cotizado) / r.totales.cotizado; });
    ok(casi < 0.06, `sin cambiar nada, lo estimado casi iguala lo cotizado (${(casi * 100).toFixed(1)} %: la diferencia es lo que se compra entero)`);
    const est = p.locator('#cg-captura tr.cg-estimado').first();
    await est.locator('[data-campo="precio_unitario"]').fill('300');
    await p.waitForTimeout(80);
    ok(await p.locator('#cg-captura tr.cg-estimado').count() === nEst - 1, 'al poner el precio del ticket el renglón deja de ser estimado');
    await p.click('#cg-a-gastos');
    await p.waitForTimeout(120);
    ok(await p.locator('#cg-captura tr.cg-estimado').count() === nEst && await p.locator('#cg-captura tr[data-id]').count() === nEst + 2, 'repetirlo renueva los estimados sin tocar lo ya capturado (los dos renglones reales se quedan)');

    // i) CSV y persistencia
    await p.click('#cg-copiar-lista');
    await p.waitForTimeout(150);
    const csvVisto = (await p.locator('#dlg-io[open]').count()) ? await p.inputValue('#io-texto') : await R(() => window.COTIZAP.web.comprasUI.csvLista());
    ok(/^"Grupo","Concepto"/.test(csvVisto) && /Solera 1½/.test(csvVisto), 'la lista de compras se copia como CSV');
    if (await p.locator('#dlg-io[open]').count()) await p.click('#io-cerrar');
    const antes = await R(() => ({ g: window.COTIZAP.web.estadoApp.cot.gastos.length, v: window.COTIZAP.web.estadoApp.cot.venta_pactada }));
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    const despues = await R(() => ({ g: window.COTIZAP.web.estadoApp.cot.gastos.length, v: window.COTIZAP.web.estadoApp.cot.venta_pactada }));
    ok(despues.g === antes.g && despues.v === antes.v, 'los gastos y la venta pactada se conservan al recargar');

    // j) el ejemplo de la hoja: se abre desde la captura vacía y se puede deshacer
    await p.click('#tab-compras');
    await R(() => { window.COTIZAP.web.estadoApp.cot.gastos = []; window.COTIZAP.web.render(); });
    const previa = await R(() => window.COTIZAP.web.estadoApp.cot.partidas.length);
    await p.click('#cg-ejemplo');
    await p.waitForTimeout(200);
    const ej = await R(() => { const E = window.COTIZAP.web.estadoApp; const V = E.res.totales.venta; return { n: E.cot.partidas.length, g: E.cot.gastos.length, v: V.capturada, iva: V.con_iva, err: E.res.totales.n_partidas_error }; });
    ok(ej.n === 13 && ej.g === 20 && ej.v === 45710 && ej.iva === true && ej.err === 0, 'el ejemplo trae las 13 partidas y los 20 gastos, vendido en $45,710 con IVA');
    ok(await p.locator('#cg_venta_con_iva').isChecked() && await p.locator('#cg_venta_sufijo').innerText() === 'MXN con IVA', 'la casilla «ya incluye IVA» viene marcada');
    const cmpEj = await p.locator('#cg-comparacion').innerText();
    ok(/\$39,405\.17/.test(cmpEj) && /\$43,277\.47/.test(cmpEj) && /\$3,872\.30/.test(cmpEj) && /9\.8 %/.test(cmpEj), 'venta sin IVA $39,405.17, gastos reales $43,277.47 y pérdida antes de indirectos de $3,872.30 (−9.8 %), con la raya a $62.50');
    const listaEj = await R(() => { const L = window.COTIZAP.web.estadoApp.res.compras; return { t: L.tornillos[0].compra, s: L.sellador[0].compra, e: L.empaque.length }; });
    ok(listaEj.t === 220 && listaEj.s === 2 && listaEj.e === 0, 'su lista de compras pide los 220 juegos de tornillos y los 2 Sikaflex que se compraron, sin empaque');
    await p.click('.toast:has-text("Ejemplo abierto") button:has-text("Deshacer")');
    await p.waitForTimeout(150);
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.partidas.length) === previa, 'Deshacer regresa la cotización anterior');
    await p.context().close();

    // k) tablas maestras: el catálogo de compras, con su IVA y su categoría de gasto como listas
    const q = await nuevaPagina();
    await q.click('#tab-maestros');
    ok(await q.locator('.m-grupo[data-grupo="compras"]').count() === 1, 'las tablas maestras traen el catálogo de compras');
    await q.fill('#maestros-buscar', 'sikaflex');
    const iva = q.locator('#m_compras__articulos__SIKAFLEX_BLANCO_600__iva_incluido');
    const cat = q.locator('#m_compras__articulos__SIKAFLEX_BLANCO_600__categoria');
    ok(await iva.evaluate((e) => e.tagName) === 'SELECT' && await iva.inputValue() === 'true' && await cat.evaluate((e) => e.tagName) === 'SELECT' && await cat.inputValue() === 'MATERIAL',
      'si el precio trae IVA y la categoría de gasto se eligen de una lista');
    await q.click('#tab-cotizacion');
    await q.evaluate(() => {
      const E = window.COTIZAP.web.estadoApp;
      E.cot.partidas.push({ id: 'pSika', familia: 'COMPRADO', cantidad: 2, articulo_id: 'SIKAFLEX_BLANCO_600' });
      window.COTIZAP.web.recalcular();
    });
    const sikaAntes = await q.evaluate(() => window.COTIZAP.web.estadoApp.res.partidas.find((f) => f.entrada.articulo_id === 'SIKAFLEX_BLANCO_600').costos.CD);
    await q.click('#tab-maestros');
    await q.fill('#maestros-buscar', 'sikaflex');
    await q.locator('#m_compras__articulos__SIKAFLEX_BLANCO_600__precio').fill('580');
    await q.locator('#m_compras__articulos__SIKAFLEX_BLANCO_600__precio').dispatchEvent('change');
    await q.waitForTimeout(120);
    const sikaDespues = await q.evaluate(() => window.COTIZAP.web.estadoApp.res.partidas.find((f) => f.entrada.articulo_id === 'SIKAFLEX_BLANCO_600').costos.CD);
    ok(Math.abs(sikaAntes - (2 * 459) / 1.16) < 1e-6 && Math.abs(sikaDespues - (2 * 580) / 1.16) < 1e-6, 'cambiar el precio del catálogo recalcula la partida que usa el artículo');
    await q.context().close();

    // l) en el celular nada se sale de la pantalla, ni con el ejemplo abierto
    const m = await nuevaPagina({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.evaluate(() => window.COTIZAP.web.abrirCotizacion(window.COTIZAP.ejemplos.casoControlGastos()));
    await m.click('#tab-compras');
    await m.waitForTimeout(150);
    ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Compras y gastos en el celular: sin desplazamiento horizontal');
    await m.context().close();
  }

  console.log('25) Dibujos acotados como en los planos de pedido: vista previa viva, miniaturas, desglose y pestaña «Planos»');
  {
    const p = await nuevaPagina();
    const R = (fn, arg) => estadoApp(p, fn, arg);
    const texto = (sel) => p.locator(sel).evaluateAll((els) => els.map((e) => e.textContent.trim()));

    // a) la lista: cada pieza que se dibuja lleva su miniatura; lo que no (compra, instalación), el ícono de su familia
    const nDib = await R(() => { const E = window.COTIZAP.web.estadoApp; return E.res.partidas.filter((f) => window.COTIZAP.planos.plano(f, E.res.maestros)).length; });
    ok(nDib === 7 && await p.locator('#lista-partidas .mini-plano svg.plano-mini').count() === nDib && await p.locator('#lista-partidas .mini-plano svg.plano-mini text').count() === 0,
      'las 7 piezas de la muestra que se dibujan llevan su miniatura en la lista (sin cotas ni textos)');

    // b) el diálogo dibuja la pieza mientras se captura, resalta la cota del campo y una cota lleva a su campo
    await p.click('#btn-agregar');
    await p.waitForSelector('#dlg-partida[open]');
    await p.click('.fam:has(span:text-is("Reducción con injerto"))');
    await p.fill('#f_D1_mm', '11');
    await p.fill('#f_D2_mm', '10');
    await p.fill('#f_d_mm', '5');
    await p.selectOption('#f_beta_deg', '30');
    await p.fill('#f_L_reduccion_mm', '500');
    await p.fill('#f_L_ramal_mm', '450');
    await p.focus('#f_d_mm');
    await p.waitForTimeout(150);
    const prev = await p.locator('#dlg-prev svg.plano').evaluateAll((els) => els.map((e) => e.textContent));
    ok(prev.length === 1 && /Ø5″/.test(prev[0]) && /500/.test(prev[0]) && /450/.test(prev[0]) && /30°/.test(prev[0]), 'la vista previa dibuja la reducción con sus cotas: Ø5″, 500, 450 y 30°');
    ok(await p.locator('#dlg-prev .pl-cotas.activa').count() === 1 && await p.locator('#dlg-prev .pl-cotas.activa').getAttribute('data-campo') === 'd_mm', 'con el cursor en «Diámetro del injerto» se resalta su cota');
    await p.locator('#dlg-prev .pl-cotas[data-campo="L_ramal_mm"]').dispatchEvent('click');
    ok(await p.evaluate(() => document.activeElement.id) === 'f_L_ramal_mm' && await p.locator('#dlg-prev .pl-cotas.activa').getAttribute('data-campo') === 'L_ramal_mm', 'pulsar una cota del dibujo lleva el cursor a su campo');
    ok(await p.getAttribute('#f_descripcion', 'placeholder') === 'Reducción de 11″ a 10″ con injerto de 5″ a 30°', 'sin descripción, la partida se llama como en los planos: «Reducción de 11″ a 10″ con injerto de 5″ a 30°»');
    await p.fill('#f_D2_mm', '11');
    await p.waitForTimeout(120);
    ok(/es un Injerto simple/.test(await p.locator('#dlg-prev').innerText()), '«de 11″ a 11″ con injerto» avisa que es un Injerto simple');
    await p.click('#dlg-cancelar');

    // c) el desglose de la partida trae su plano
    await p.locator('#lista-partidas .partida').nth(4).click();
    await p.waitForTimeout(100);
    ok(await p.locator('#detalle .det-plano svg.plano').count() === 1 && /Plano de la pieza/.test(await p.locator('#detalle').innerText()), 'el desglose trae «Plano de la pieza»');

    // d) la pestaña «Planos»: una hoja por tipo de pieza y material
    await p.click('#tab-planos');
    await p.waitForTimeout(100);
    ok(!(await p.locator('#panel-planos').isHidden()) && await p.locator('.hoja').count() === 6 && /7 partidas dibujadas/.test(await p.locator('#planos-resumen').innerText()) && /2 partidas no llevan plano/.test(await p.locator('#planos-resumen').innerText()),
      'la muestra se dibuja en 6 hojas y dice qué partidas no llevan plano');

    // e) el pedido del 30-sep-2026: bridas, codos y reducciones con injerto, como las hojas del taller
    await p.click('#planos-ejemplo');
    await p.waitForTimeout(200);
    const tarjeta = (m) => p.locator(`.pieza-plano:has(.pieza-marca:text-is("${m}"))`).evaluate((e) => e.textContent);
    const ped = await R(() => { const E = window.COTIZAP.web.estadoApp; return { n: E.cot.partidas.length, err: E.res.totales.n_partidas_error }; });
    ok(ped.n === 36 && ped.err === 0, 'el pedido de ejemplo trae sus 36 partidas (bridas, codos, reducciones con injerto, yardas y armados) y todas se calculan');
    const cabs = await texto('.hoja-cab h3');
    ok(cabs.length === 8 && cabs[0] === 'Bridas' && /^Codos.*Acero galvanizado · cal\. 22$/.test(cabs[1]) && /^Reducciones con injerto e injertos.*cal\. 22$/.test(cabs[2])
      && ['11″', '10″', '6″', '5″'].every((x, i) => cabs[3 + i].startsWith(`Ductos de ${x}`)) && cabs[7] === 'Armado de piezas',
    'ocho hojas, como los planos: bridas, codos, reducciones con injerto, ductos de 11″, 10″, 6″ y 5″ y el armado de piezas');
    const marcas = await texto('.pieza-marca');
    const serie = (l, n) => Array.from({ length: n }, (_, i) => `${l}${i + 1}`).join(' ');
    ok(marcas.join(' ') === [serie('B', 6), serie('C', 5), serie('I', 8), serie('D', 11), serie('A', 6)].join(' '), 'cada pieza lleva su marca (B1…B6, C1…C5, I1…I8, D1…D11, A1…A6)');
    ok(/18 yardas y 1 tramo de ajuste/.test(await p.locator('.hoja[data-grupo="RECTOS"]').first().innerText()), 'la hoja de ductos de 11″ cuenta sus 18 yardas y el tramo de ajuste');
    const d1 = await tarjeta('D1');
    const d3 = await tarjeta('D3');
    ok(/4 piezas/.test(d1) && /3 yardas unidas/.test(d1) && /Bridas en ambos extremos/.test(d1) && (d1.match(/914/g) || []).length >= 3 && /2,742/.test(d1) && /Brida en un extremo/.test(d3) && /1,828/.test(d3),
      'los ductos dicen sus yardas y sus bridas como los planos (3 yardas unidas, bridas en ambos extremos; 2 yardas unidas, brida en un extremo), con cada yarda acotada');
    ok(await p.locator('.pieza-plano:has(.pieza-marca:text-is("D1")) svg .pl-brida').count() === 2 && await p.locator('.pieza-plano:has(.pieza-marca:text-is("D3")) svg .pl-brida').count() === 1
      && await p.locator('.pieza-plano:has(.pieza-marca:text-is("D2")) svg .pl-brida-suelta').count() === 1, 'las bridas se dibujan donde van (la suelta del ajuste, punteada)');
    ok(await p.locator('.pieza-plano:has(.pieza-marca:text-is("A1")) .pieza-tit').evaluate((e) => e.textContent) === 'Unir injerto de 11″ con codo de 60° para obtener 90°', 'el armado de piezas se llama como en el plano de armado');
    ok(!/Bridas de otra partida/.test(await p.locator('#planos-hojas .hoja').allInnerTexts().then((x) => x.join(' '))), 'en las hojas no va el dato interno de las bridas de otra partida');
    // el cuadre de bridas: 11″, 10″, 9″ y 7″ cuadran con la hoja de bridas; falta 1 de 6″ y sobran 3 de 5″
    const cuadre = await p.locator('.cuadre').innerText();
    const filasCuadre = await p.locator('.cuadre tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim()).join('|')));
    ok(filasCuadre.join(' / ') === 'Ø11″|22|22|Cuadran / Ø10″|6|6|Cuadran / Ø9″|2|2|Cuadran / Ø7″|4|4|Cuadran / Ø6″|3|2|Faltan 1 / Ø5″|21|24|Sobran 3' && /Faltan 1 de Ø6″ y sobran 3 de Ø5″/.test(cuadre),
      'el cuadre de bridas: cuadran 11″, 10″, 9″ y 7″; falta 1 de 6″ y sobran 3 de 5″');
    const tits = await texto('.pieza-tit');
    ok(['Brida de 11″', 'Brida de 9″', 'Codo 60° Ø11″ · 3 gajos', 'Ducto de 11″ con injerto de 11″ a 30°', 'Reducción de 11″ a 10″ con injerto de 5″ a 30°', 'Reducción de 10″ a 6″ con injerto de 7″ a 30°'].every((t) => tits.includes(t)),
      'los títulos son los de los planos («Reducción de 11″ a 10″ con injerto de 5″ a 30°», «Codo 60° Ø11″ · 3 gajos»…)');
    const b1 = await tarjeta('B1');
    const b3 = await tarjeta('B3');
    const b6 = await tarjeta('B6');
    ok(/22 piezas/.test(b1) && /Dint = 281 mm/.test(b1) && /8 barrenos de 9\.5 mm/.test(b1) && /6 barrenos de 9\.5 mm/.test(b3) && /24 piezas/.test(b6) && /Dperf = 170 mm/.test(b6) && /6 barrenos/.test(b6),
      'las bridas dicen cuántas son, sus diámetros y sus barrenos (8 en la de 11″, 6 en la de 9″ y en las de placa)');
    const c1 = await tarjeta('C1');
    ok(/2 piezas/.test(c1) && /191/.test(c1) && /254/.test(c1) && /5 gajos/.test(c1), 'el codo de 5″ trae las cotas del plano (R = 191 y 254 mm, 5 gajos)');
    ok(await p.locator('.hoja-num').first().innerText() === 'Hoja 1 de 8', 'cada hoja lleva su número en el cajetín');
    await p.click('.toast:has-text("pedido de ductería") button:has-text("Deshacer")');
    await p.waitForTimeout(150);
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.partidas.length) === 9 && await p.locator('.hoja').count() === 6, 'Deshacer regresa la cotización anterior y sus hojas');

    // f) «Ver en la cotización» lleva a la partida y a su desglose
    await R(() => window.COTIZAP.web.planosUI.verEjemplo());
    await p.waitForTimeout(150);
    const idI2 = await p.locator('.pieza-plano:has(.pieza-marca:text-is("I2"))').getAttribute('data-id');
    await p.locator('.pieza-plano:has(.pieza-marca:text-is("I2")) .pieza-ir').click();
    await p.waitForTimeout(150);
    ok(await p.getAttribute('#tab-cotizacion', 'aria-selected') === 'true' && await R(() => window.COTIZAP.web.estadoApp.sel) === idI2 && /Reducción de 11″ a 10″ con injerto de 5″ a 30°/.test(await p.locator('#detalle').innerText()),
      '«Ver en la cotización» abre la partida en la cotización');

    // g) «Imprimir planos» imprime sólo las hojas (y el botón de la propuesta, sólo la propuesta)
    await p.click('#tab-planos');
    await p.evaluate(() => { window.__impresiones = []; window.print = () => window.__impresiones.push(document.body.classList.contains('imprimir-planos')); });
    await p.click('#btn-imprimir-planos');
    await p.waitForTimeout(50);
    ok(JSON.stringify(await p.evaluate(() => window.__impresiones)) === '[true]' && !(await p.evaluate(() => document.body.classList.contains('imprimir-planos'))), '«Imprimir planos» imprime con las hojas a la vista y luego regresa la pantalla');
    await p.emulateMedia({ media: 'print' });
    const vis = (sel) => p.evaluate((s) => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
    await p.evaluate(() => document.body.classList.add('imprimir-planos'));
    ok(await vis('#panel-planos') && await vis('.hoja') && !(await vis('#propuesta')) && !(await vis('.barra')) && !(await vis('.planos-cab')) && !(await vis('.pieza-ir')) && !(await vis('.cuadre')), 'al imprimir los planos sólo salen las hojas (sin la propuesta, la barra, los botones ni el cuadre de bridas)');
    await p.evaluate(() => document.body.classList.remove('imprimir-planos'));
    ok(await vis('#propuesta') && !(await vis('main')), 'al imprimir la propuesta sólo sale la propuesta');
    await p.emulateMedia({ media: 'screen' });

    // h) sin piezas: la pestaña lo dice y ofrece el ejemplo; la lista vacía también
    await p.click('#btn-nueva');
    await p.waitForTimeout(100);
    ok(/Todavía no hay piezas que dibujar/.test(await p.locator('#planos-hojas').innerText()) && await p.locator('#btn-imprimir-planos').isDisabled(), 'sin piezas, la pestaña lo dice y no deja imprimir');
    await p.click('#tab-cotizacion');
    await p.click('#lista-partidas button:has-text("Ver un pedido de ejemplo")');
    await p.waitForTimeout(150);
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.partidas.length) === 36, 'la lista vacía ofrece abrir el pedido de ejemplo');
    // el codo de 5″ del pedido: su otro extremo se une al tramo (sin brida) y sus bridas son de otra partida
    await editar(p, 0);
    ok(await p.locator('#f_extremos_sin_brida input[value="B"]').isChecked() && !(await p.locator('#f_extremos_sin_brida input[value="A"]').isChecked()) && await p.inputValue('#f_bridas_aparte') === 'true',
      'el formulario muestra el extremo sin brida (casilla) y las bridas de otra partida');
    const conUno = await R(() => window.COTIZAP.web.estadoApp.res.partidas[0].precio.unitario);
    await p.locator('#f_extremos_sin_brida input[value="B"]').uncheck();
    await p.click('#dlg-guardar');
    await p.waitForTimeout(120);
    const sinMarca = await R(() => ({ p: window.COTIZAP.web.estadoApp.cot.partidas[0], u: window.COTIZAP.web.estadoApp.res.partidas[0].precio.unitario, b: window.COTIZAP.web.estadoApp.res.bridas.filas.find((x) => Math.round(x.D_nom_mm) === 127) }));
    ok(sinMarca.p.extremos_sin_brida === undefined && sinMarca.u > conUno && sinMarca.b.piden === 23, 'quitar la casilla le devuelve su brida: cuesta unirla y el cuadre pide 2 bridas de 5″ más');
    await p.context().close();

    // i) en el celular las hojas caben sin desplazamiento horizontal
    const m = await nuevaPagina({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
    await m.evaluate(() => window.COTIZAP.web.abrirCotizacion(window.COTIZAP.ejemplos.pedidoDucteria()));
    await m.click('#tab-planos');
    await m.waitForTimeout(150);
    ok(await m.locator('.pieza-plano').count() === 36 && await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Planos en el celular: las 36 piezas y el cuadre sin desplazamiento horizontal');
    await m.context().close();
  }

  console.log('26) Cotización rápida: diámetro mayor y metros → hojas enteras × 3 + bridas por metros + utilidad + IVA');
  {
    const p = await nuevaPagina();
    const total = () => p.locator('#rapida-total-val').innerText();
    const desglose = () => p.locator('#rapida-desglose').innerText();
    await p.click('#tab-rapida');
    ok(await p.locator('#panel-rapida').isVisible() && await p.getByRole('tab', { name: 'Cotización rápida' }).count() === 1, 'la pestaña «Cotización rápida» abre su panel (nombre accesible completo aunque diga «Rápida»)');
    ok(/Capture el diámetro máximo y los metros/.test(await p.locator('#rapida-resultado').innerText()) && await p.locator('#r_diam_unidad').innerText() === 'pulgadas', 'vacía, explica qué capturar; el diámetro va en la unidad de la cotización (pulgadas)');

    // a) el caso del taller: 11″ y 40 m en galvanizada cal. 22 de 4 × 10 ft
    await p.fill('#r_diam', '11');
    await p.fill('#r_metros', '40');
    ok(await total() === '$43,392.00', '11″ y 40 m: $43,392.00 con IVA');
    const d = await desglose();
    ok(/Lámina: 11 hojas × \$793\.10/.test(d) && /\$8,724\.14/.test(d) && /Lámina × 3\s+Cubre/.test(d) && /\$26,172\.41/.test(d) && /Por 40 m: hasta 40 m\.\s+\$5,000\.00/.test(d)
      && /Utilidad 20 %[\s\S]*\$6,234\.48/.test(d) && /IVA 16 %\s+\$5,985\.10/.test(d), 'el desglose: 11 hojas × $793.10, × 3, bridas $5,000 (hasta 40 m), utilidad 20 % sobre el costo e IVA');
    ok(/33 yardas de 1\.22 m/.test(d) && /3 yardas de 11″/.test(d), 'dice cómo salen las hojas: 33 yardas de 1.22 m, 3 por hoja');

    // b) los rangos de bridas y el tope de la tabla
    await p.fill('#r_metros', '41');
    ok(/de 40 a 80 m\.\s+\$12,000\.00/.test(await desglose()), 'de 40 a 80 m las bridas son $12,000');
    await p.fill('#r_metros', '120');
    ok(/de 80 a 120 m\.\s+\$18,000\.00/.test(await desglose()), 'hasta 120 m, $18,000');
    await p.fill('#r_metros', '150');
    ok(await p.locator('.rapida-error[role="alert"]').isVisible() && /llegan a 120 m/.test(await p.locator('.rapida-error').innerText()) && await p.locator('#rapida-total-val').count() === 0, 'más de 120 m: lo dice y no da un precio');
    await p.fill('#r_metros', '11 1/2');
    ok(/Por 11\.5 m/.test(await desglose()), 'acepta fracciones como en el resto de la app (11 1/2)');

    // c) la utilidad de esta cotización, otra lámina y el factor de las tablas
    await p.fill('#r_metros', '40');
    await p.fill('#r_utilidad', '30');
    const esperado = ((11 * 920 / 1.16) * 3 + 5000) * 1.3 * 1.16;
    ok(await total() === `$${esperado.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'la utilidad capturada (30 %) se suma sobre el costo');
    await p.fill('#r_utilidad', '');
    await p.selectOption('#r_hoja', 'GALV_C24_4X10');
    ok(/Lámina: 11 hojas × \$603\.45/.test(await desglose()), 'otra lámina de la lista del proveedor (cal. 24: $700 con IVA → $603.45)');
    await p.selectOption('#r_hoja', '');
    await p.click('#tab-maestros');
    await p.fill('#maestros-buscar', 'factor');
    const fac = p.locator('input#m_rapida__factor_lamina');
    ok(await fac.inputValue() === '3' && await p.locator('.m-grupo[data-grupo="rapida"]').count() === 1, 'en Tablas maestras está su grupo, con el factor de 3');
    await fac.fill('2.5');
    await fac.dispatchEvent('change');
    await p.click('#tab-rapida');
    ok(/Lámina × 2\.5/.test(await desglose()), 'el factor cambiado en las tablas se usa en la cotización rápida');

    // d) en milímetros, y lo capturado se recuerda
    await p.click('#tab-cotizacion');
    await p.selectOption('#c_unidad_diam', 'mm');
    await p.click('#tab-rapida');
    await p.fill('#r_diam', '279.4');
    ok(await p.locator('#r_diam_unidad').innerText() === 'mm' && /3 yardas de 279\.4 mm/.test(await desglose()), 'con la cotización en mm, el diámetro se captura en mm');
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    await p.click('#tab-rapida');
    ok(await p.inputValue('#r_diam') === '279.4' && await p.inputValue('#r_metros') === '40', 'lo capturado se recuerda al volver a abrir');
    await p.click('#rapida-limpiar');
    ok(await p.inputValue('#r_diam') === '' && /Capture el diámetro/.test(await p.locator('#rapida-resultado').innerText()), '«Limpiar» deja la cotización rápida en blanco');
    await p.context().close();

    // e) en el celular: cinco pestañas en dos renglones y sin desplazamiento horizontal
    const m = await nuevaPagina({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
    await m.click('#tab-rapida');
    await m.fill('#r_diam', '11');
    await m.fill('#r_metros', '40');
    const cajas = await m.locator('.tabs [role="tab"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: Math.round(r.top), w: r.width, cabe: e.scrollWidth <= e.clientWidth + 1 }; }));
    ok(cajas.length === 5 && new Set(cajas.map((c) => c.y)).size === 2 && cajas.every((c) => c.cabe) && await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'en 320 px: las cinco pestañas en dos renglones, cada texto cabe, y nada se sale de la pantalla');
    await m.context().close();
  }

  ok(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await browser.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron');
  process.exit(fallos ? 1 : 0);
})();
