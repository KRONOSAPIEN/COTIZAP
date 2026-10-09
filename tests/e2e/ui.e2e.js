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
    await page.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
    return page;
  };
  const estadoApp = (page, fn, arg) => page.evaluate(fn, arg);
  const editar = async (page, i) => {
    await page.locator('#lista-partidas .partida:not(.partida-auto)').nth(i).locator('button[aria-label^="Editar"]').click();
    await page.waitForSelector('#dlg-partida[open]');
  };

  console.log('1) Carga inicial');
  let page = await nuevaPagina();
  ok(await page.locator('#lista-partidas .partida:not(.partida-auto)').count() === 9, 'la cotización de ejemplo trae 9 partidas (con soportería e instalación)');
  ok((await page.locator('.hero-val').innerText()).startsWith('$'), 'el total se muestra en pesos');
  ok(await page.locator('#aviso-ilustrativo').isVisible(), 'el aviso de valores ilustrativos está visible');

  console.log('2) Ida y vuelta del formulario (editar y guardar sin cambios) en 3 combinaciones de unidades');
  for (const [diam, long] of [['in', 'mm'], ['mm', 'm'], ['in', 'in']]) {
    await page.selectOption('#c_unidad_diam', diam);
    await page.selectOption('#c_unidad_long', long);
    let iguales = true;
    let exactos = true;
    const n = await page.locator('#lista-partidas .partida:not(.partida-auto)').count();
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
  ok(await page.locator('#lista-partidas .partida:not(.partida-auto)').count() === 9, 'las 9 familias quedaron en la lista');

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
  await page.locator('#lista-partidas .partida:not(.partida-auto)').first().locator('button[aria-label="Duplicar"]').click();
  ok(await page.locator('#lista-partidas .partida:not(.partida-auto)').count() === 10, 'duplicar suma una partida');
  await page.locator('#lista-partidas .partida:not(.partida-auto)').nth(2).locator('button[aria-label="Eliminar"]').click();
  ok(await page.locator('#lista-partidas .partida:not(.partida-auto)').count() === 9, 'eliminar resta una partida');
  await page.click('.toast button:has-text("Deshacer")');
  ok(await page.locator('#lista-partidas .partida:not(.partida-auto)').count() === 10, 'deshacer la recupera');

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
  await page.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p2.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    ok((await p.locator('#lista-partidas .partida:not(.partida-auto) .partida-importe').innerText()).includes('$'), 'y sigue calculando su precio');
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().locator('button[aria-label^="Editar"]').click();
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
    const importes = await p.locator('#lista-partidas .partida:not(.partida-auto) .partida-importe').allInnerTexts();
    ok(importes.length === 2 && importes.every((x) => x.includes('$')) && importes[0] === importes[1], 'una cotización anterior con lado (der/izq) y sentido sigue calculando, y los ignora: cuesta lo mismo que la partida sin ellos');
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().locator('button[aria-label^="Editar"]').click();
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
    const titulos = await pm.locator('#lista-partidas .partida:not(.partida-auto) .partida-titulo').allInnerTexts();
    ok(titulos.some((t) => /^Injerto simple a 45°/.test(t)) && titulos.some((t) => /^Reducción con injerto 45°/.test(t)), 'la muestra de una versión anterior se renueva con los nombres y las partidas actuales');
    ok(!titulos.some((t) => /^Ramal/.test(t)), 'ya no aparece "Ramal"');
    ok(await pm.locator('#c_unidad_diam').inputValue() === 'mm' && await pm.locator('#c_unidad_long').inputValue() === 'm' && await pm.locator('#c_riesgo').inputValue() === 'ALTO' && await pm.locator('#c_vigencia_dias').inputValue() === '30', 'conserva los ajustes generales que ya había cambiado');
    await pm.context().close();
    const pp = await nuevaPagina({}, sembrar(guardada(false)));
    const propios = await pp.locator('#lista-partidas .partida:not(.partida-auto) .partida-titulo').allInnerTexts();
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    ok(await sucia.locator('#lista-partidas .partida:not(.partida-auto)').count() === 3, 'datos guardados dañados: abre y conserva las 3 partidas que sí son objetos (no las 4 basuras)');
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
    ok(await im.locator('#lista-partidas .partida:not(.partida-auto)').count() === 1, 'las partidas que no eran objetos se descartan');
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
    ok(await bloq.locator('#lista-partidas .partida:not(.partida-auto)').count() === 10, 'con el almacenamiento bloqueado se puede seguir trabajando');
    await bloq.context().close();
    const lleno = await nuevaPagina({}, (ctx) => ctx.addInitScript(() => { Storage.prototype.setItem = function setItem() { throw new DOMException('lleno', 'QuotaExceededError'); }; }));
    await lleno.click('#btn-agregar'); await lleno.waitForSelector('#dlg-partida[open]'); await lleno.click('#dlg-guardar'); await lleno.waitForTimeout(80);
    ok(await lleno.locator('#lista-partidas .partida:not(.partida-auto)').count() === 10, 'con el almacenamiento lleno también');
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().click();
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().click();
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().click();
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().click();
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().click();
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
    await p.mouse.click(10, 10); // el encabezado: fuera de la ventana (que ahora queda más arriba)
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    ok(/Abrazadera ajustable para manguera/.test(await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(1).innerText()), 'sin descripción propia, la partida se llama como el artículo');
    await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(1).click();
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(2).click();
    ok(/Cuadrilla y viáticos/.test(await p.locator('#detalle').innerText()) && /sin IVA \(con factura\)/.test(await p.locator('#detalle').innerText()), 'el desglose muestra la cuadrilla y la base de cada viático');
    ok(/\$62\.50\s*salario por día ÷ 8 h/.test(await p.locator('#detalle').innerText()), 'y el costo por hora: el salario por día ÷ 8 h = $62.50');

    // d) soportería: piezas de una barra de la lista, anclajes del catálogo
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    await p.selectOption('#f_cantidad_modo', 'MANUAL'); // estas ménsulas son las 7 del taller, a mano
    ok(await p.locator('.campo[data-campo="articulo_anclaje"]').isHidden(), 'sin anclajes no se pregunta cuál');
    await p.fill('#f_anclajes_pieza', '4');
    ok(await p.locator('.campo[data-campo="articulo_anclaje"]').isVisible(), 'con anclajes se elige el del catálogo');
    await p.fill('#f_cantidad', '7');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(3).click();
    ok(/Pieza, barra y anclajes/.test(await p.locator('#detalle').innerText()) && /28 × Taquete/.test(await p.locator('#detalle').innerText()), 'el desglose de la soportería dice barra, metros y anclajes');
    ok(/min reales por pieza/.test(await p.locator('#detalle').innerText()), 'y que los minutos de taller son reales (sin eficiencia)');
    // una abrazadera se pide por el diámetro del ducto: su largo sale solo
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    await p.selectOption('#f_cantidad_modo', 'MANUAL');
    await p.selectOption('#f_barra_id', 'SOL_1_1_4X1_8');
    await p.fill('#f_largo_pieza_mm', '');
    await p.fill('#f_abrazadera_D_mm', '11');
    await p.fill('#f_cantidad', '7');
    ok(/3\.81 m de Solera 1¼/.test(await p.locator('#dlg-prev').innerText()) && await p.locator('#dlg-prev .errores').count() === 0, 'sin largo, la vista previa ya calcula la solera de las 7 abrazaderas (3.81 m) sin errores');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    const abz = await R(() => window.COTIZAP.web.estadoApp.res.partidas[4].soporte);
    ok(Math.abs(abz.largo_pieza_mm - ((Math.PI * (279.4 + 3.175)) / 2 + 100)) < 1e-9 && abz.largo_calculado === true, `el largo de cada abrazadera sale de π × (D + t) ÷ 2 + 2 orejas: ${abz.largo_pieza_mm.toFixed(1)} mm`);
    ok(/abrazadera para ducto Ø11/.test(await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(4).innerText()), 'la lista de partidas dice «abrazadera para ducto Ø11″»');
    await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(4).click();
    ok(/abrazadera de media vuelta/.test(await p.locator('#detalle').innerText()), 'el desglose lo explica');

    // e) lista de compras en piezas enteras y el sobrante como partida automática
    await p.click('#tab-compras');
    ok(await p.locator('#panel-compras').isVisible() && await p.locator('#tab-compras').getAttribute('aria-selected') === 'true', 'la pestaña Compras y gastos se abre');
    const lista = await p.locator('#cg-lista').innerText();
    const sol = await R(() => window.COTIZAP.web.estadoApp.res.compras.barras.find((b) => b.clave === 'SOL_1_1_2X3_16'));
    ok(sol.piezas === 30 && sol.compra >= Math.ceil(sol.necesario) && new RegExp(`Solera 1½" × 3/16"[\\s\\S]*?${sol.compra} barras`).test(lista), `los 30 aros se acomodan en ${sol.compra} barras de solera de 6 m`);
    ok(/Ángulo 1¼" × 1\/8"/.test(lista) && /28 pzas/.test(lista), 'y la lista trae el ángulo de las ménsulas y los 28 taquetes');
    ok(await p.locator('#cg_piezas_enteras').count() === 0 && /siempre se cobra/.test(await p.locator('#cg_sobrante_nota').innerText()), 'ya no hay casilla: el sobrante siempre se cobra (y la pestaña lo dice)');
    const auto = await R(() => { const r = window.COTIZAP.web.estadoApp.res; return { n_auto: r.automaticas.length, imp: r.automaticas[0].precio.importe, sub: r.totales.subtotal, suma: r.partidas.filter((f) => f.ok).reduce((s, f) => s + f.precio.importe, 0), n: r.totales.n_partidas_ok, n_usuario: r.partidas.filter((f) => f.ok).length, sobrante: r.compras.sobrante, cd: r.automaticas[0].costos.CD }; });
    ok(auto.n_auto === 1 && Math.abs(auto.cd - auto.sobrante) < 0.01 && Math.abs(auto.sub - auto.suma - auto.imp) < 0.011 && auto.n === auto.n_usuario, 'el sobrante va como partida automática: el subtotal la suma y no cuenta como partida del usuario');
    await p.click('#tab-cotizacion');
    ok(await p.locator('#lista-partidas .partida-auto').count() === 1 && /Automática/.test(await p.locator('#lista-partidas .partida-auto').innerText()) && /siempre se cobra/.test(await p.locator('#lista-partidas .partida-auto').innerText()), 'en la cotización se ve la partida automática');
    ok(/material sobrante/i.test(await p.locator('#totales').innerText()), 'y los totales dicen que incluyen el sobrante');
    await p.click('#lista-partidas .partida-auto button');
    ok(await p.locator('#panel-compras').isVisible(), '«Ver la lista de compras» lleva a la pestaña');

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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
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
    await p.locator('#lista-partidas .partida:not(.partida-auto)').nth(4).click();
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
    await p.click('#tab-cotizacion'); // «Nueva» está en la cotización detallada
    await p.click('#btn-nueva');
    await p.click('#tab-planos');
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
    await p.fill('#r_menulas', '0'); // la regla del taller sin ménsulas (las ménsulas y mangueras se prueban en 29 y 31)
    ok(await p.locator('#panel-rapida').isVisible() && await p.getByRole('tab', { name: 'Cotización rápida' }).count() === 1, 'la pestaña «Cotización rápida» abre su panel (nombre accesible completo aunque diga «Rápida»)');
    ok(/Capture el diámetro máximo y los metros/.test(await p.locator('#rapida-resultado').innerText()) && await p.locator('#r_diam_unidad').innerText() === 'pulgadas', 'vacía, explica qué capturar; el diámetro va en la unidad de la cotización (pulgadas)');

    // a) el caso del taller: 11″ y 40 m en galvanizada cal. 22 de 4 × 10 ft
    await p.fill('#r_diam', '11');
    await p.fill('#r_metros', '40');
    ok(await total() === '$43,392.00', '11″ y 40 m: $43,392.00 con IVA');
    const d = await desglose();
    ok(/Lámina: 11 hojas × \$793\.10/.test(d) && /\$8,724\.14/.test(d) && /Lámina × 3\s+Cubre/.test(d) && /\$26,172\.41/.test(d) && /Por 40 m: hasta 40 m\.\s+\$5,000\.00/.test(d)
      && /Utilidad 20 %[\s\S]*\$6,234\.48/.test(d) && /IVA 16 %\s+\$5,985\.10/.test(d), 'el desglose: 11 hojas × $793.10, × 3, bridas $5,000 (hasta 40 m), utilidad 20 % sobre el costo e IVA');
    ok(/33 yardas de 4 ft/.test(d) && /3 yardas de 11″/.test(d), 'dice cómo salen las hojas: 33 yardas de 4 ft, 3 por lámina');

    // la lámina dibujada: sus 3 yardas numeradas, el sobrante y la tira con las 11 láminas
    ok(await p.locator('#r_yarda input[value="1220"]').isChecked() && !(await p.locator('#r_yarda input[value="914"]').isChecked()), 'la yarda arranca en 4 ft (la de las tablas)');
    ok(await p.locator('.lam-svg .lam-yarda').count() === 3 && (await p.locator('.lam-svg .lam-num').allTextContents()).join(',') === '1,2,3' && await p.locator('.lam-svg').getAttribute('role') === 'img',
      'el dibujo de una lámina muestra sus 3 yardas numeradas (y es una imagen con su descripción)');
    ok(await p.locator('.lam-tira li').count() === 11 && await p.locator('.lam-tira li.lam-parcial').count() === 0 && /Se aprovecha el 90 %/.test(await p.locator('#rapida-acomodo').innerText()), 'la tira trae las 11 láminas, todas con 3 yardas; se aprovecha el 90 %');
    await p.locator('#r_yarda input[value="914"]').check();
    const de3 = await p.locator('#rapida-acomodo').innerText();
    ok(/44 yardas ÷ 3 = 15 láminas; la última lleva 2 yardas/.test(de3) && await p.locator('.lam-tira li').count() === 15 && await p.locator('.lam-tira li.lam-parcial').count() === 1 && await total() !== '$43,392.00',
      'con yardas de 3 ft: 44 yardas, 15 láminas (la última con 2) y otro precio');
    ok(/Lámina galvanizada 3 × 10 ft/.test(await desglose()) && await p.locator('.lam-svg .lam-yarda').count() === 3, 'con yardas de 3 ft toma sola la lámina galvanizada de 3 × 10 ft (aproximada)');
    await p.selectOption('#r_hoja', 'GALV_C22_4X10');
    await p.fill('#r_diam', '3');
    ok(/14 yardas \(11 a lo ancho y 3 a lo largo de la lámina\)/.test(await p.locator('#rapida-acomodo').innerText()) && await p.locator('.lam-svg .lam-girada').count() === 3 && /a lo largo de la lámina/.test(await p.locator('.lam-leyenda').innerText()),
      'de 3″ con yardas de 3 ft: 14 por lámina, con una franja girada en el sobrante (y su leyenda)');
    await p.selectOption('#r_hoja', '');
    await p.fill('#r_diam', '11');
    await p.locator('#r_yarda input[value="1220"]').check();

    // el plazo y la mano de obra: días de fabricación de bridas (1 persona × $500) e instalación (2 personas × $500)
    ok(await p.locator('#r_fab_nota').innerText() === '1 persona × $500.00 por día' && await p.locator('#r_ins_nota').innerText() === '2 personas × $500.00 por día', 'bajo cada campo de días, la cuadrilla y su pago (de las tablas)');
    await p.fill('#r_dias_fab', '5');
    await p.fill('#r_dias_ins', '3');
    const dd = await desglose();
    ok(await p.locator('#rapida-plazo').innerText() === 'Plazo: 5 días de fabricación de bridas + 3 días de instalación = 8 días' && /Fabricación de bridas: 5 días\s+5 días × 1 persona × \$500\.00 por día\.\s+\$2,500\.00/.test(dd)
      && /Instalación: 3 días\s+3 días × 2 personas × \$500\.00 por día\.\s+\$3,000\.00/.test(dd) && await total() === '$51,048.00',
      'el plazo (8 días) y su mano de obra: bridas $2,500 + instalación $3,000, con utilidad e IVA: $51,048.00');
    await p.fill('#r_dias_ins', '-2');
    ok(/días de instalación deben ser de 0 a 365/.test(await p.locator('#rapida-resultado').innerText()), 'días inválidos: lo dice');
    await p.fill('#r_dias_ins', '3');

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
    const esperado = ((11 * 920 / 1.16) * 3 + 5000 + 2500 + 3000) * 1.3 * 1.16; // con los días de bridas e instalación capturados arriba
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
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
    await p.click('#tab-rapida');
    ok(await p.inputValue('#r_diam') === '279.4' && await p.inputValue('#r_metros') === '40' && await p.inputValue('#r_dias_fab') === '5' && await p.locator('#r_yarda input[value="1220"]').isChecked(), 'lo capturado (también la yarda y los días) se recuerda al volver a abrir');
    await p.click('#rapida-limpiar');
    ok(await p.inputValue('#r_diam') === '' && await p.inputValue('#r_dias_fab') === '' && /Capture el diámetro/.test(await p.locator('#rapida-resultado').innerText()), '«Limpiar» deja la cotización rápida en blanco');
    await p.context().close();

    // e) en el celular: seis pestañas en dos renglones y sin desplazamiento horizontal
    const m = await nuevaPagina({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
    await m.click('#tab-rapida');
    await m.fill('#r_diam', '11');
    await m.fill('#r_metros', '40');
    const cajas = await m.locator('.tabs [role="tab"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: Math.round(r.top), w: r.width, cabe: e.scrollWidth <= e.clientWidth + 1 }; }));
    ok(cajas.length === 6 && new Set(cajas.map((c) => c.y)).size === 2 && cajas.every((c) => c.cabe) && await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'en 320 px: las seis pestañas en dos renglones de tres, cada texto cabe, y nada se sale de la pantalla');
    const lam = await m.locator('.lam-svg').boundingBox();
    ok(lam && lam.width > 200 && lam.x >= 0 && lam.x + lam.width <= 321, 'en 320 px la lámina dibujada cabe a lo ancho');
    await m.context().close();
  }

  console.log('27) Reorganización: encabezado de un renglón, pestañas en orden de trabajo, avisos donde aplican y texto para el cliente');
  {
    const p = await nuevaPagina({ viewport: { width: 1366, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const caja = (sel) => p.locator(sel).boundingBox();
    const marca = await caja('.marca');
    const tabs = await caja('.tabs');
    ok(Math.abs(marca.y - tabs.y) < 20 && (await caja('.barra')).height < 80, 'en 1366 px el encabezado es un solo renglón: la marca y las pestañas');
    ok((await p.locator('.tabs [role="tab"]').evaluateAll((els) => els.map((e) => e.id))).join(',') === 'tab-rapida,tab-cotizacion,tab-trazado,tab-planos,tab-compras,tab-maestros'
      && await p.getByRole('tab', { name: 'Cotización detallada' }).count() === 1, 'pestañas en el orden de trabajo: rápida, detallada, trazado isométrico, planos, compras y gastos, tablas maestras');
    ok(await p.locator('#panel-cotizacion #btn-nueva').isVisible() && await p.locator('#panel-cotizacion #btn-io').isVisible() && await p.locator('.barra #btn-nueva').count() === 0,
      'Nueva, Guardar y cargar e Imprimir propuesta están en la cotización detallada (no en el encabezado)');
    ok(await p.locator('#aviso-ilustrativo').isVisible() && await p.locator('#aviso-ejemplo').isVisible(), 'en la cotización detallada se ven los avisos de valores ilustrativos y de ejemplo');
    await p.click('#tab-rapida');
    ok(await p.locator('#aviso-ilustrativo').isHidden() && await p.locator('#aviso-ejemplo').isHidden(), 'en la cotización rápida no estorban los avisos de la detallada');
    await p.click('#tab-maestros');
    ok(await p.locator('#aviso-ilustrativo').isHidden() && await p.locator('#aviso-ejemplo').isHidden(), 'en tablas maestras tampoco (es ahí donde se cambian los valores)');
    await p.click('#tab-planos');
    ok(await p.locator('#aviso-ejemplo').isVisible(), 'en planos sí: dibujan la cotización de ejemplo');

    // el texto para el cliente: sin el desglose interno, se copia y se imprime solo
    await p.click('#tab-rapida');
    await p.fill('#r_menulas', '0');
    await p.fill('#r_cliente', 'Nave 3');
    await p.fill('#r_diam', '11');
    await p.fill('#r_metros', '40');
    await p.fill('#r_dias_fab', '5');
    await p.fill('#r_dias_ins', '3');
    const txt = await p.inputValue('#rapida-texto');
    ok(/^Cotización de ductería · Nave 3/.test(txt) && /Ø11″, 40 m/.test(txt) && /Incluye suministro, fabricación e instalación\./.test(txt) && /\$44,006\.90 \+ IVA 16 % = \$51,048\.00/.test(txt)
      && /Plazo: 5 días de fabricación \+ 3 días de instalación = 8 días/.test(txt) && /Vigencia: 15 días/.test(txt) && !/tilidad|factor|× 3/.test(txt),
      'el texto para el cliente: cliente, ducto, qué incluye, precio con IVA, plazo y vigencia; sin factor ni utilidad');
    await p.click('#rapida-copiar');
    await p.waitForTimeout(150);
    ok(await p.evaluate(() => navigator.clipboard.readText()) === txt, '«Copiar texto» lo deja en el portapapeles');
    await p.fill('#r_dias_ins', '');
    ok(/Incluye suministro y fabricación\./.test(await p.inputValue('#rapida-texto')), 'sin días de instalación, no dice que la incluye');
    await p.fill('#r_dias_ins', '3');
    await p.evaluate(() => { window.print = () => {}; });
    await p.click('#rapida-imprimir');
    await p.waitForTimeout(60); // la app quita la clase al terminar de imprimir (aquí, de inmediato): se vuelve a poner para revisar la hoja
    await p.evaluate(() => document.body.classList.add('imprimir-rapida'));
    await p.emulateMedia({ media: 'print' });
    const imp = await p.locator('#rapida-impresion').innerText();
    ok(await p.locator('#rapida-impresion').isVisible() && await p.locator('.barra').isHidden() && await p.locator('main').isHidden() && /Total\s*\$51,048\.00/.test(imp) && /Cliente: Nave 3/.test(imp) && !/tilidad/.test(imp),
      'al imprimir la cotización rápida sale sólo la hoja del cliente (subtotal, IVA, total, plazo y vigencia)');
    await p.emulateMedia({ media: 'screen' });
    await p.evaluate(() => document.body.classList.remove('imprimir-rapida'));
    ok(await p.locator('#rapida-impresion').isHidden(), 'en pantalla la hoja de impresión no se ve');
    await p.context().close();
  }

  console.log('28) El arreglo unifilar del 22-sep-2026 en la cotización rápida: el desarrollo y la lámina que menos desperdicia');
  {
    const p = await nuevaPagina();
    await p.click('#tab-rapida');
    await p.fill('#r_menulas', '0');
    await p.click('#rapida-ejemplo');
    await p.waitForTimeout(100);
    ok(await p.inputValue('#r_diam') === '11' && await p.inputValue('#r_metros') === '31' && await p.locator('#r_yarda input[value="914"]').isChecked()
      && await p.inputValue('#r_dias_fab') === '4' && await p.inputValue('#r_dias_ins') === '5', 'el ejemplo carga el sistema del unifilar: 11″, 31 m, yardas de 3 ft, 4 días de bridas y 5 de instalación');
    ok(await p.locator('#rapida-total-val').innerText() === '$46,512.00' && /34 yardas ÷ 3 = 12 láminas/.test(await p.locator('#rapida-acomodo').innerText()), '31 m son 34 yardas: 12 láminas de 3 × 10 ft (no 5), $46,512.00');
    ok(/Desarrollo de cada yarda: π × 280\.3 mm = 880 mm \+ 32 mm de la costura = 912 mm: el perímetro, no el diámetro/.test(await p.locator('#rapida-desarrollo').innerText()),
      'dice el desarrollo de la yarda: el perímetro (π × D), no el diámetro');
    ok(/de las 2 del ancho de la yarda, la que menos desperdicia/.test(await p.locator('#r_hoja_nota').innerText()) && /3 × 10 ft/.test(await p.locator('#r_hoja option[value=""]').innerText()),
      'sin elegir lámina: de las dos de 3 ft (3 × 10 y 3 × 8), la que menos desperdicia');
    await p.selectOption('#r_hoja', 'GALV_C22_3X8');
    ok(/34 yardas ÷ 2 = 17 láminas/.test(await p.locator('#rapida-acomodo').innerText()) && await p.locator('#r_hoja_nota').innerText() === 'La que eligió.', 'con la de 3 × 8 ft salen 2 yardas por lámina: 17 láminas');
    await p.context().close();
  }

  console.log('29) Cotización rápida: ménsulas y mangueras por piezas, a los precios de las tablas, y viáticos por importe');
  {
    const p = await nuevaPagina();
    await p.click('#tab-rapida');
    await p.fill('#r_menulas', '0');
    await p.click('#rapida-ejemplo');
    await p.waitForTimeout(100);
    ok(await p.locator('#rapida-total-val').innerText() === '$46,512.00' && !/Ménsulas|Mangueras|Viáticos/.test(await p.locator('#rapida-desglose').innerText()), 'sin ménsulas, mangueras ni viáticos no hay renglones extra: $46,512.00');
    ok(await p.locator('#r_menulas').getAttribute('placeholder') === '13 sugeridas', 'la caja de ménsulas sugiere 13 (una cada 2.5 m)');
    await p.fill('#r_menulas', '7');
    await p.waitForTimeout(100);
    ok(/7 piezas × \$345\.25 con abrazadera = \$2,416\.78/.test(await p.locator('#r_menulas_nota').innerText()), 'las 7 que estima el ingeniero: ángulo 1¼″ × 1/8″ y solera 1¼″ × 1/8″, $345.25 cada una = $2,416.78');
    ok(await p.inputValue('#r_menula_barra') === 'ANG_1_1_4X1_8' && await p.inputValue('#r_abrazadera_barra') === 'SOL_1_1_4X1_8', 'de arranque, ángulo y solera de 1¼″ × 1/8″');
    await p.selectOption('#r_menula_barra', 'ANG_1_1_2X3_16');
    await p.selectOption('#r_abrazadera_barra', 'SOL_1_1_2X3_16');
    await p.waitForTimeout(100);
    let des = await p.locator('#rapida-desglose').innerText();
    ok(/Ménsulas: 7 piezas con abrazadera/.test(des) && /Ángulo 1½" × 3\/16"[\s\S]*\$351\.86/.test(des) && /Solera 1½" × 3\/16": \$43\.00/.test(des) && /\$2,764\.04/.test(des),
      'de ángulo 1½″ × 3/16″ ($351.86) y solera 1½″ × 3/16″ ($43.00): 7 × $394.86 = $2,764.04');
    ok(await p.locator('#r_menula_barra option').count() === 4 && await p.locator('#r_abrazadera_barra option').count() === 3, 'se elige entre los ángulos y las soleras de la lista del proveedor');
    await p.fill('#r_mangueras_tramos', '3');
    await p.waitForTimeout(100);
    ok(await p.locator('#r_abrazaderas_manguera').getAttribute('placeholder') === '18 (6 por tramo)', 'con 3 tramos se cuentan 18 abrazaderas de manguera (6 por tramo)');
    des = await p.locator('#rapida-desglose').innerText();
    ok(/Mangueras: 3 tramos y 18 abrazaderas/.test(des) && /3 tramos × \$1,807\.49 \(Manguera azul de 6″/.test(des) && /\$6,275\.92/.test(des), 'mangueras de 6″ del catálogo: 3 × $1,807.49 + 18 × $47.41 = $6,275.92 (lo del caso real)');
    await p.fill('#r_viaticos', '1987.93');
    await p.waitForTimeout(100);
    ok(await p.locator('#rapida-total-val').innerText() === '$61,862.83', 'con ménsulas, mangueras y viáticos el total es $61,862.83');
    ok(/Incluye suministro, fabricación, instalación, mangueras, soportería y viáticos\./.test(await p.inputValue('#rapida-texto')), 'el texto del cliente dice lo que incluye');
    await p.selectOption('#r_manguera_id', 'MANGUERA_5');
    await p.fill('#r_abrazaderas_manguera', '4');
    await p.waitForTimeout(100);
    ok(/Mangueras: 3 tramos y 4 abrazaderas/.test(await p.locator('#rapida-desglose').innerText()) && /Manguera azul de 5″/.test(await p.locator('#rapida-desglose').innerText()), 'otra manguera y otras abrazaderas');
    await p.fill('#r_menulas', 'abc');
    await p.waitForTimeout(100);
    ok(/Las ménsulas debe ser un número entero/.test(await p.locator('.rapida-error').innerText()), 'una cantidad ilegible se señala');
    await p.click('#rapida-limpiar');
    ok(await p.inputValue('#r_menulas') === '' && await p.inputValue('#r_mangueras_tramos') === '' && await p.inputValue('#r_viaticos') === '' && await p.inputValue('#r_menula_barra') === 'ANG_1_1_4X1_8', 'Limpiar vacía todo y regresa el ángulo de las tablas');
    await p.context().close();
  }

  console.log('30) Ménsulas automáticas: la cantidad sale del ducto (espaciamiento recomendado) y se puede capturar a mano');
  {
    const p = await nuevaPagina();
    // un ducto conocido: 8 m horizontales + 4 m verticales + 3 codos de 11″ = 4 + 2 + 3 = 9 soportes
    await p.evaluate(() => {
      const W = window.COTIZAP.web;
      const base = { material_id: 'GALVANIZADO', calibre: '22', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', D_mm: 279.4, cantidad: 1 };
      W.estadoApp.cot.partidas = [
        { ...base, id: 'r1', familia: 'RECTO', L_mm: 8000 },
        { ...base, id: 'r2', familia: 'RECTO', L_mm: 4000, posicion: 'VERTICAL' },
        { ...base, id: 'c1', familia: 'CODO', theta_deg: 90, cantidad: 3 },
      ];
      W.recalcular();
    });
    await p.waitForTimeout(100);
    const n0 = await p.locator('#lista-partidas .partida:not(.partida-auto)').count();
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    ok(await p.inputValue('#f_cantidad_modo') === 'AUTO' && await p.locator('#f_cantidad').evaluate((e) => e.readOnly), 'una soportería nueva nace en automático y la cantidad no se captura');
    ok(await p.inputValue('#f_cantidad') === '9', 'la cantidad es 9: 4 (8 m ÷ 2.5) + 2 (subida de 4 m ÷ 3.0) + 3 codos');
    ok(/Cantidad automática[\s\S]*9 piezas/.test(await p.locator('#dlg-prev').innerText()) && /junto a codos e injertos/.test(await p.locator('#dlg-prev').innerText()), 'la vista previa dice de dónde sale');
    await p.fill('#f_separacion_m', '1.5');
    ok(await p.inputValue('#f_cantidad') === '11', 'con una separación propia de 1.5 m son 11: 8 m ÷ 1.5 = 5.33 → 6, más 2 y 3');
    await p.fill('#f_separacion_m', '3.5');
    ok(/no puede pasar de 3 m/.test(await p.locator('#dlg-prev').innerText()), 'más de 3.0 m se rechaza');
    await p.fill('#f_separacion_m', '');
    await p.selectOption('#f_criterio_horizontal', 'JUNTA');
    ok(await p.inputValue('#f_cantidad') === '10' && await p.locator('.campo[data-campo="separacion_m"]').isHidden(),
      'uno por junta: el tramo de 8 m en yardas de 4 ft son piezas de 3.66 m (2 cada una) y el ajuste (1): 5 + 2 + 3 = 10, sin separación que capturar');
    await p.selectOption('#f_criterio_horizontal', 'SEPARACION');
    ok(await p.inputValue('#f_cantidad') === '9', 'por separación vuelven a ser 9');
    await p.selectOption('#f_cantidad_modo', 'MANUAL');
    ok(!(await p.locator('#f_cantidad').evaluate((e) => e.readOnly)) && await p.locator('.campo[data-campo="separacion_m"]').isHidden() && await p.inputValue('#f_cantidad') === '9', 'en manual la cantidad se captura (empieza en la calculada) y no hay separación');
    await p.fill('#f_cantidad', '3');
    ok(/menos soportes de los que pide la separación máxima/.test(await p.locator('#dlg-prev').innerText()), 'con 3 piezas avisa que el ducto queda sin apoyo suficiente');
    await p.selectOption('#f_cantidad_modo', 'AUTO');
    ok(await p.inputValue('#f_cantidad') === '9', 'al volver a automático se recalcula');
    await p.fill('#f_descripcion', 'Ménsulas del ducto');
    await p.click('#dlg-guardar');
    await p.waitForTimeout(100);
    ok(await p.locator('#lista-partidas .partida:not(.partida-auto)').count() === n0 + 1, 'se agrega la partida');
    const fila = p.locator('#lista-partidas .partida:not(.partida-auto)').nth(n0);
    ok(/9 ×/.test(await fila.locator('.partida-cant').innerText()) && /cantidad automática/.test(await fila.innerText()), 'la lista muestra 9 piezas y que es automática');
    await fila.click();
    ok(/Cantidad automática de soportes/i.test(await p.locator('#detalle').innerText()) && /vertical/i.test(await p.locator('#detalle').innerText()) && /codo/i.test(await p.locator('#detalle').innerText()), 'el desglose lista tramos y codos con su cuenta');
    const R = (fn, arg) => p.evaluate(fn, arg);
    // se recalcula sola al cambiar el ducto: otro tramo horizontal de 5 m = 2 soportes más
    await p.evaluate(() => {
      const W = window.COTIZAP.web;
      W.estadoApp.cot.partidas.splice(0, 0, { material_id: 'GALVANIZADO', calibre: '22', ref_diametro: 'INTERIOR', tipo_union: 'BRIDADO', clase_sellado: 'C', D_mm: 279.4, cantidad: 1, id: 'r3', familia: 'RECTO', L_mm: 5000 });
      W.recalcular();
    });
    await p.waitForTimeout(100);
    const cant = await R(() => window.COTIZAP.web.estadoApp.res.partidas.filter((f) => f.ok && f.familia === 'SOPORTE').map((f) => f.entrada.cantidad));
    ok(cant.length === 1 && cant[0] === 11, `con otro tramo de 5 m las ménsulas pasan solas de 9 a ${cant[0]}`);
    // una partida de versiones anteriores (sin modo) se abre en manual: no cambia sola
    await p.evaluate(() => {
      const W = window.COTIZAP.web;
      W.estadoApp.cot.partidas.push({ id: 'viejo', familia: 'SOPORTE', barra_id: 'ANG_1_1_4X1_8', largo_pieza_mm: 1300, cantidad: 7 });
      W.recalcular();
    });
    await p.waitForTimeout(100);
    await p.locator('#lista-partidas .partida:not(.partida-auto)').last().locator('button[aria-label^="Editar"]').click();
    ok(await p.inputValue('#f_cantidad_modo') === 'MANUAL' && await p.inputValue('#f_cantidad') === '7', 'una soportería de antes se abre en manual con sus 7 piezas');
    await p.click('#dlg-cancelar');
    // abrazadera tipo cuna de solera de 1″ × 1/8″: media vuelta o vuelta completa (dos mitades)
    await p.click('#btn-agregar');
    await p.click('.fam:has(span:text-is("Soportería"))');
    await p.selectOption('#f_cantidad_modo', 'MANUAL');
    await p.fill('#f_cantidad', '1');
    await p.selectOption('#f_barra_id', 'SOL_1X1_8');
    await p.fill('#f_largo_pieza_mm', '');
    ok(await p.locator('.campo[data-campo="abrazadera_vuelta"]').isHidden(), 'la vuelta sólo se pregunta en una abrazadera');
    await p.fill('#f_abrazadera_D_mm', '11');
    ok(await p.locator('.campo[data-campo="abrazadera_vuelta"]').isVisible() && await p.inputValue('#f_abrazadera_vuelta') === 'MEDIA', 'con el diámetro aparece, en media vuelta (cuna de 180°)');
    ok(/0\.54 m de Solera 1" × 1\/8"/.test(await p.locator('#dlg-prev').innerText()), 'media vuelta: 0.54 m de solera de 1″ × 1/8″');
    await p.selectOption('#f_abrazadera_vuelta', 'COMPLETA');
    await p.waitForTimeout(50);
    ok(/1\.09 m de Solera 1" × 1\/8"/.test(await p.locator('#dlg-prev').innerText()) && await p.locator('#dlg-prev .prev-plano .pl-barra').count() >= 2,
      'vuelta completa: dos mitades, 1.09 m de solera, y el dibujo trae las dos');
    await p.click('#dlg-cancelar');
    await p.context().close();
  }

  console.log('31) Cotización rápida: sin capturar ménsulas van las sugeridas (una cada 2.5 m); 0 = no lleva; lo elegido se recuerda');
  {
    const p = await nuevaPagina();
    await p.click('#tab-rapida');
    await p.click('#rapida-ejemplo');
    await p.waitForTimeout(100);
    const des = await p.locator('#rapida-desglose').innerText();
    ok(/Ménsulas: 13 piezas con abrazadera/.test(des) && /Las sugeridas: una cada 2\.5 m en 31 m/.test(des) && /\$4,488\.31/.test(des), 'vacía, van las 13 sugeridas: $4,488.31 de costo directo');
    ok(/1,300 mm de Ángulo 1¼" × 1\/8" con 4 anclajes y 137\.14 min de taller: \$310\.57/.test(des) && /abrazadera de media vuelta de Solera 1¼" × 1\/8": \$34\.68/.test(des), 'dice con qué se costea: la ménsula ($310.57) y la abrazadera ($34.68)');
    ok(await p.locator('#rapida-total-val').innerText() === '$52,759.73', 'el unifilar con sus ménsulas sugeridas: $52,759.73');
    ok(/13 sugeridas \(una cada 2\.5 m\) × \$345\.25 con abrazadera = \$4,488\.31/.test(await p.locator('#r_menulas_nota').innerText()), 'junto a la caja se ve cuántas y cuánto');
    await p.fill('#r_metros', '40');
    await p.waitForTimeout(100);
    ok(/Ménsulas: 16 piezas/.test(await p.locator('#rapida-desglose').innerText()), 'con 40 m se sugieren 16');
    await p.fill('#r_metros', '31');
    await p.fill('#r_menulas', '0');
    await p.waitForTimeout(100);
    ok(await p.locator('#rapida-total-val').innerText() === '$46,512.00' && !/Ménsulas/.test(await p.locator('#rapida-desglose').innerText()), '0 = no lleva: vuelve a $46,512.00');
    await p.fill('#r_menulas', '9');
    await p.selectOption('#r_menula_barra', 'ANG_1_1_2X3_16');
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida:not(.partida-auto)');
    await p.click('#tab-rapida');
    ok(await p.inputValue('#r_menulas') === '9' && await p.inputValue('#r_menula_barra') === 'ANG_1_1_2X3_16', 'lo capturado y elegido se recuerda');
    await p.context().close();
  }

  console.log('32) Importar unifilar: la lectura del croquis → preguntas → partidas; cada respuesta actualiza las partidas');
  {
    const p = await nuevaPagina();
    const R = (fn, arg) => p.evaluate(fn, arg);
    const preguntas = () => p.locator('.uf-preguntas .uf-alerta').count();
    const imp = () => R(() => window.COTIZAP.web.estadoApp.cot.partidas.filter((x) => x.unifilar_id).map((x) => ({ id: x.id, u: x.unifilar_id, ed: !!x.unifilar_editada, L: x.L_mm, theta: x.theta_deg, beta: x.beta_deg })));
    const dePieza = async (u) => (await imp()).find((x) => x.u === u);
    await p.click('#btn-nueva');
    await p.click('#btn-unifilar');
    ok(await p.locator('#dlg-unifilar[open] #uf-texto').isVisible(), 'sin lectura, el diálogo abre en «pegar o cargar»');
    await p.click('#uf-leer');
    ok(/Pegue el JSON/.test(await p.locator('.uf-errores').innerText()), 'vacío: pide el JSON');
    await p.fill('#uf-texto', '{ "red": ');
    await p.click('#uf-leer');
    ok(/no es un JSON válido/.test(await p.locator('.uf-errores').innerText()), 'texto roto: lo dice sin romper la página');
    await p.click('#uf-ejemplo');
    await p.waitForSelector('.uf-preguntas');
    ok(await preguntas() === 4 && /Despiece preliminar/.test(await p.locator('.uf-estado').innerText()), 'el ejemplo: despiece preliminar con 4 preguntas');
    ok(await p.locator('#uf-agregar').innerText() === 'Agregar 22 partidas', 'propone agregar 22 partidas');
    ok(await R(() => document.activeElement && document.activeElement.dataset.clave) === 'A-005|longitud_m', 'el cursor queda en la primera pregunta (la cota ilegible)');
    ok(/30\s+6 sueltos · 116 tornillos/.test(await p.locator('.uf-tiles').innerText()) && /14\s+regla del taller/.test(await p.locator('.uf-tiles').innerText()), 'resumen: 30 aros (6 sueltos) y 14 ménsulas');
    await p.fill('[data-clave="A-005|longitud_m"]', 'abc');
    await p.click('.uf-preguntas [data-codigo="COTA_ILEGIBLE"] button');
    ok(/mayor que cero/.test(await p.locator('.uf-preguntas [data-codigo="COTA_ILEGIBLE"] .uf-err').innerText()), 'una cota que no es número no se acepta');
    await p.fill('[data-clave="A-005|longitud_m"]', '1.6');
    await p.press('[data-clave="A-005|longitud_m"]', 'Enter');
    ok(await preguntas() === 3, 'respondida la cota quedan 3 preguntas');
    ok(await R(() => document.activeElement && document.activeElement.dataset.clave) === 'N-005|angulo_deg', 'el cursor pasa a la siguiente pregunta');
    ok(await p.locator('#aviso-unifilar').isVisible() && /sin agregar/.test(await p.locator('#aviso-unifilar').innerText()), 'antes de agregar, el aviso dice que hay una lectura sin agregar');
    await p.click('#uf-agregar');
    ok(!(await p.locator('#dlg-unifilar').evaluate((d) => d.open)), 'al agregar se cierra el diálogo');
    ok(await p.locator('#lista-partidas .partida:not(.partida-auto)').count() === 22 && await p.locator('#lista-partidas .chip-unifilar').count() === 22, '22 partidas, cada una con la etiqueta de su pieza');
    ok(/22 partidas agregadas · 3 preguntas por responder/.test(await p.locator('#toasts').innerText()), 'el aviso flotante lo resume');
    ok((await dePieza('DUCT-005')).L === 1250, 'el tramo de 5″ con la cota respondida: 1.6 m − 350 mm del injerto = 1 250 mm');
    ok(/22 partidas de un croquis unifilar · preliminar\. 3 preguntas por responder/.test(await p.locator('#aviso-unifilar').innerText()), 'el aviso de la cotización cuenta las preguntas');
    const id1 = (await dePieza('DUCT-001')).id;

    await p.click('#aviso-unifilar-abrir');
    await p.selectOption('[data-clave="A-008|posicion"]', { label: 'Baja: codo de 90°' });
    await p.click('.uf-preguntas [data-codigo="ORIENTACION_AMBIGUA"] button');
    ok((await dePieza('CODO-002')).theta === 90 && (await dePieza('DUCT-001')).id === id1, 'responder actualiza las partidas al momento (codo de 90°) y conservan su id');
    ok(/Partidas del unifilar actualizadas/.test(await p.locator('#toasts').innerText()), 'y lo avisa');
    await p.click('#uf-listo');

    // una partida importada editada a mano: la siguiente respuesta ya no la pisa sin avisar
    const iDuct1 = (await R(() => window.COTIZAP.web.estadoApp.cot.partidas.findIndex((x) => x.unifilar_id === 'DUCT-001')));
    await editar(p, iDuct1);
    await p.fill('#f_descripcion', 'Subida al colector');
    await p.click('#dlg-guardar');
    ok((await dePieza('DUCT-001')).ed && /DUCT-001 · editada/.test(await p.locator('#lista-partidas .chip-unifilar').first().innerText()), 'la partida editada sigue siendo la pieza DUCT-001, marcada «editada»');
    await p.click('#aviso-unifilar-abrir');
    await p.selectOption('[data-clave="N-005|angulo_deg"]', { label: '30°' });
    await p.click('.uf-preguntas [data-codigo="ANGULO_DERIVACION_NO_PERMITIDO"] button');
    ok((await dePieza('INJ-001')).beta === 45 && /editadas a mano/.test(await p.locator('#uf-cuerpo').innerText()), 'con una editada no se actualiza sola: lo explica');
    ok(await p.locator('#uf-agregar').innerText() === 'Actualizar partidas', 'y ofrece «Actualizar partidas»');
    await p.click('#uf-agregar');
    ok((await dePieza('INJ-001')).beta === 30 && !(await dePieza('DUCT-001')).ed, 'al actualizar: injerto a 30° y la editada se reemplaza');

    // persiste con la cotización
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await p.locator('#lista-partidas .chip-unifilar').count() === 22 && /1 pregunta por responder/.test(await p.locator('#aviso-unifilar').innerText()), 'al recargar siguen las 22 partidas y la pregunta pendiente');
    await p.click('#aviso-unifilar-abrir');
    ok(/Respondidas \(3\)/i.test(await p.locator('.uf-g-resp summary').innerText()), 'y las 3 respuestas');
    await p.locator('.uf-g-resp summary').click();
    await p.locator('.uf-g-resp [data-codigo="COTA_ILEGIBLE"] .btn-texto').click();
    ok(await preguntas() === 2 && (await dePieza('DUCT-005')).L === 800, '«Quitar la respuesta» vuelve a la cota estimada y a preguntarla: 1.3 m − 500 mm del injerto a 30° = 800 mm');

    // otra lectura con partidas ya importadas: no toca la cotización hasta reemplazar
    await p.click('#uf-otra');
    await p.click('#uf-ejemplo');
    ok(/Reemplazar con 22 partidas/.test(await p.locator('#uf-agregar').innerText()) && /reemplaza las 22 partidas/.test(await p.locator('#uf-cuerpo').innerText()), 'otra lectura: ofrece reemplazar las 22 importadas');
    await p.click('#uf-cerrar');
    ok((await dePieza('INJ-001')).beta === 30, 'al cerrar sin reemplazar, nada cambia');

    // quitar de la cotización, con deshacer
    await p.click('#aviso-unifilar-abrir');
    await p.click('#uf-descartar');
    ok(await p.locator('#lista-partidas .chip-unifilar').count() === 0 && await p.locator('#aviso-unifilar').isHidden(), '«Quitar de la cotización» quita las partidas y el aviso');
    await p.locator('#toasts .btn-texto').first().click();
    ok(await p.locator('#lista-partidas .chip-unifilar').count() === 22 && await p.locator('#aviso-unifilar').isVisible(), '«Deshacer» las devuelve');

    // la copia de una partida importada ya no es la pieza del croquis
    await p.locator('#lista-partidas .partida:not(.partida-auto)').first().locator('button[aria-label="Duplicar"]').click();
    ok(await p.locator('#lista-partidas .partida:not(.partida-auto)').count() === 23 && await p.locator('#lista-partidas .chip-unifilar').count() === 22, 'la copia no lleva la etiqueta de la pieza');

    // datos guardados dañados: una lectura que no es lectura se descarta, y con ella la marca de las partidas
    await R(() => {
      const k = 'cotizap.cotizacion.v1';
      const c = JSON.parse(localStorage.getItem(k));
      c.unifilar = { lectura: { red: 1 }, respuestas: { x: { longitud_m: 1 } }, importado: true };
      localStorage.setItem(k, JSON.stringify(c));
    });
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await p.locator('#aviso-unifilar').isHidden() && await p.locator('#lista-partidas .chip-unifilar').count() === 0 && await p.locator('#lista-partidas .partida:not(.partida-auto)').count() === 23, 'una lectura dañada se descarta sin perder las partidas');
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('#btn-unifilar');
    await p.click('#uf-ejemplo');
    ok(await R(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'en el celular el diálogo no se sale de la pantalla');
    await p.context().close();
  }

  console.log('33) Leer la foto del croquis con Claude (capacidad sample simulada): preparar la foto, leerla, releer las dudas, dibujarla y revisarla');
  {
    // un window.claude de mentira con `sample`: devuelve la lectura del ejemplo llevada al tamaño de la hoja enviada, con
    // «3.6 m» puesto en la línea equivocada y la duda anotada; relee y verifica según lo que se le pide
    const conSample = (ctx) => ctx.addInitScript(() => {
      window.__llamadas = [];
      window.__modoSample = 'normal';
      const json = async (input, opts) => {
        const imgs = [].concat(opts.images || []);
        const dims = await Promise.all(imgs.map(async (b) => { const x = await createImageBitmap(b); return [x.width, x.height]; }));
        const tipo = /Compara con cuidado/.test(input) ? 'verifica' : /recortes ampliados/.test(input) ? 'relee' : 'lee';
        window.__llamadas.push({ tipo, imagenes: imgs.length, dims, tier: opts.modelTier });
        const modo = window.__modoSample;
        if (modo === 'lento') {
          await new Promise((ok, no) => {
            const t = setTimeout(ok, 8000);
            opts.signal.addEventListener('abort', () => { clearTimeout(t); no({ code: 'cancelled', message: '' }); });
          });
        }
        if (modo === 'not_granted') throw { code: 'not_granted', message: 'no' };
        if (modo === 'invalid_json') throw { code: 'invalid_json', message: 'no', text: 'Aquí va la lectura: {"red": ' };
        if (tipo === 'verifica') return [{ referencias: ['A-007'], problema: 'La cota de A-007 dice 2.6 m, no 2.5 m.', sugerencia: '2.6 m' }];
        if (tipo === 'relee') {
          return [...input.matchAll(/^(\d+)\) (.+)$/gm)].map(([, n, linea]) => {
            if (/pertenece a la línea/.test(linea)) return { n: Number(n), pertenece_a: 2, confianza: 0.9 };
            if (/T-011/.test(linea)) return { n: Number(n), texto_id: 'T-011', contenido_crudo: '1.6 m', contenido_normalizado: '1.6', tipo: 'LONGITUD', confianza_ocr: 0.86 };
            return { n: Number(n), texto_id: 'T-010', contenido_crudo: '5"', contenido_normalizado: '5', tipo: 'DIAMETRO', confianza_ocr: 0.8 };
          });
        }
        if (opts.onText) opts.onText({ text: '{"version":"1.0"', delta: '{"version":"1.0"' });
        const W = Number(/la hoja completa, (\d+) ×/.exec(input)[1]);
        const k = W / 2576;
        const L = JSON.parse(JSON.stringify(window.COTIZAP.unifilarEjemplo));
        L.red.nodos.forEach((n) => { n.pos_px = { x: n.pos_px.x * k, y: n.pos_px.y * k }; });
        L.red.textos.forEach((t) => { t.bbox_px = { x: t.bbox_px.x * k, y: t.bbox_px.y * k, w: t.bbox_px.w * k, h: t.bbox_px.h * k }; });
        const a4 = L.red.aristas.find((a) => a.id === 'A-004');
        const a5 = L.red.aristas.find((a) => a.id === 'A-005');
        a5.longitud_cota = { ...a4.longitud_cota };
        a4.longitud_cota = { valor: null, unidad: 'm', origen: 'OCR', confianza: 0, texto_id: null };
        L.red.textos.find((t) => t.id === 'T-009').asociado_a = 'A-005';
        L.alertas_ambiguedad = [{ codigo: 'ASOCIACION_AMBIGUA', severidad: 'CONFIRMAR', referencias: ['T-009', 'A-005', 'A-004'], mensaje: '«3.6 m» queda entre dos líneas.' }];
        delete L.metadatos.fuente;
        return L;
      };
      const sample = Object.assign(async () => ({ text: '', truncated: false }), {
        json,
        limits: async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20000000, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }),
      });
      window.claude = { use: async (n) => (n === 'sample' ? sample : null) };
    });
    // sin la capacidad (el archivo suelto): no hay botón de foto, sólo la indicación
    const sola = await nuevaPagina();
    await sola.click('#btn-unifilar');
    ok(await sola.locator('#uf-foto').count() === 0 && /abra COTIZAP publicada en claude\.ai/.test(await sola.locator('.uf-sin-foto').innerText()), 'sin la capacidad no se ofrece leer la foto: se explica dónde sí');
    await sola.context().close();

    const p = await nuevaPagina({}, conSample);
    const R = (fn, arg) => p.evaluate(fn, arg);
    // una «foto» de 4032 × 3024 hecha en la página
    const png = Buffer.from(await R(() => {
      const c = document.createElement('canvas');
      c.width = 4032; c.height = 3024;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#123'; g.lineWidth = 12; g.beginPath(); g.moveTo(650, 2880); g.lineTo(650, 2200); g.lineTo(3500, 550); g.stroke();
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const subir = () => p.setInputFiles('#uf-foto', { name: 'croquis.png', mimeType: 'image/png', buffer: png });
    const leerFoto = async () => { await subir(); await p.waitForSelector('#uf-leer-foto'); await p.click('#uf-leer-foto'); };
    await p.click('#btn-nueva');
    await p.click('#btn-unifilar');
    await p.waitForSelector('#uf-foto', { state: 'attached' });
    ok(/Leer la foto del croquis/i.test(await p.locator('.uf-foto').innerText()), 'en la página publicada se ofrece leer la foto');
    await subir();
    await p.waitForSelector('#uf-leer-foto');
    ok(await R(() => window.__llamadas.length) === 0, 'escoger la foto no gasta nada: primero se prepara');
    ok(await p.isChecked('#uf-limpiar') && !(await p.isChecked('#uf-enderezar')) && /3000 × 2250 px de trabajo/.test(await p.locator('.uf-foto-prep').innerText()), '«Limpiar» viene marcado; la foto se trabaja a 3000 × 2250 px');
    await p.check('#uf-enderezar');
    ok(await p.locator('.uf-prep-punto').count() === 4, 'al enderezar aparecen las cuatro esquinas de la hoja');
    const antes = await p.locator('.uf-prep-punto').first().getAttribute('cx');
    await p.locator('.uf-prep-punto').first().focus();
    await p.keyboard.press('ArrowRight');
    ok(Number(await p.locator('.uf-prep-punto').first().getAttribute('cx')) > Number(antes), 'una esquina se mueve con las flechas (o arrastrándola)');
    await p.click('#uf-previa');
    ok(await p.locator('#uf-previa').innerText() === 'Ver la foto original' && await p.locator('.uf-prep-punto').count() === 0, '«Ver cómo queda» muestra la hoja enderezada y limpia');
    await p.click('#uf-previa');
    await p.uncheck('#uf-enderezar');
    await p.click('#uf-leer-foto');
    await p.waitForSelector('.uf-preguntas', { timeout: 20000 });
    const ll = await R(() => window.__llamadas);
    ok(ll.length === 2 && ll[0].tipo === 'lee' && ll[0].imagenes === 5 && ll[0].tier === 'complex', 'una llamada con la hoja y 4 recortes (modelo más capaz)');
    ok(JSON.stringify(ll[0].dims[0]) === '[1238,928]' && ll[0].dims.every(([w, h]) => w * h <= 1150000), 'la hoja va a 1238 × 928 px y ninguna imagen pasa de 1.15 MP');
    ok(ll[1].tipo === 'relee' && ll[1].imagenes === 3, 'y otra que relee 3 dudas en recortes ampliados: la cota entre dos líneas y 2 textos');
    const nota = await p.locator('.uf-nota-lectura').innerText();
    ok(/T-009 «3\.6 m» va con A-004, no con A-005/.test(nota) && /T-011: «1\.\? m» \(0\.41\) → «1\.6 m» \(0\.86\)/.test(nota), 'dice qué se releyó: «3.6 m» era de A-004 y «1.? m» es 1.6 m');
    ok(await p.locator('[data-codigo="ASOCIACION_AMBIGUA"]').count() === 0 && await p.locator('.uf-preguntas .uf-alerta').count() === 3, 'la duda ya no se pregunta: quedan 3 preguntas');
    ok(await p.locator('.uf-g-dibujo[open] .uf-dibujo-foto canvas').count() === 1 && await p.locator('.uf-dibujo svg line').count() === 8, 'la lectura se dibuja sobre la foto: 8 aristas');
    ok(/A-005 · 5″ · 1\.6 m/.test(await p.locator('.uf-dibujo svg').textContent()) && /A-004 · 10″ · 3\.6 m/.test(await p.locator('.uf-dibujo svg').textContent()), 'cada arista con su diámetro y su cota');
    // la revisión visual: Claude compara la foto con la lectura dibujada; lo que encuentra queda en «Avisos»
    await p.click('#uf-verificar');
    await p.waitForSelector('[data-codigo="VERIFICACION_VISUAL"]', { state: 'attached' });
    const lv = (await R(() => window.__llamadas)).slice(-1)[0];
    ok(lv.tipo === 'verifica' && lv.imagenes === 2, 'manda la foto limpia y la foto con la lectura encima');
    ok(/encontró 1 diferencia/.test(await p.locator('.uf-nota-lectura').innerText()) && /La cota de A-007 dice 2\.6 m/.test(await p.locator('[data-codigo="VERIFICACION_VISUAL"]').innerText()), 'la diferencia queda como aviso, con lo que sugiere');
    await p.click('#uf-agregar');
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.partidas.find((x) => x.unifilar_id === 'DUCT-005').L_mm) === 1250, 'las partidas salen de lo leído: el tramo de 5″ con 1.6 m queda en 1 250 mm');

    // errores: JSON que no sirve, detener a medias y permiso negado
    await p.click('#aviso-unifilar-abrir');
    await p.click('#uf-otra');
    await R(() => { window.__modoSample = 'invalid_json'; });
    await leerFoto();
    await p.waitForSelector('.uf-errores');
    ok(/no salió en el formato esperado/.test(await p.locator('.uf-errores').innerText()) && /Aquí va la lectura/.test(await p.inputValue('#uf-texto')), 'si no sale JSON, lo dice y deja el texto para revisarlo');
    await R(() => { window.__modoSample = 'lento'; });
    await leerFoto();
    await p.waitForSelector('#uf-detener');
    const leyendo = await p.waitForFunction(() => /Claude está leyendo el croquis/.test((document.querySelector('.uf-progreso') || {}).innerText || ''), null, { timeout: 5000 }).then(() => true, () => false);
    ok(leyendo, 'mientras lee, dice qué está haciendo');
    await p.click('#uf-detener');
    await p.waitForSelector('#uf-foto', { state: 'attached' });
    ok(await p.locator('.uf-errores').count() === 0, '«Detener» vuelve al inicio sin error');
    await R(() => { window.__modoSample = 'not_granted'; });
    await leerFoto();
    await p.waitForSelector('.uf-errores');
    ok(/no puede pedirle a Claude/.test(await p.locator('.uf-errores').innerText()) && await p.locator('#uf-foto').count() === 0, 'sin permiso, se deja de ofrecer leer la foto');
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.partidas.filter((x) => x.unifilar_id).length) === 22, 'nada de eso tocó las partidas ya importadas');
    await p.context().close();
  }

  console.log('34) Dibujar el unifilar: trazos con las familias del taller, piezas que salen solas, «Listo» → partidas; el dibujo se guarda y se vuelve a editar');
  {
    const p = await nuevaPagina();
    const R = (fn, arg) => p.evaluate(fn, arg);
    const dib = () => R(() => window.COTIZAP.web.estadoApp.cot.dibujo_unifilar);
    const estado = () => p.locator('#cad-estado').innerText();
    const centro = (sel) => R((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    // un punto a lo largo de un tramo dibujado (f de 0 a 1), en coordenadas de la página
    const enTramo = (id, f) => R(([t, k]) => {
      const l = document.querySelector(`#cad-tablero line.cad-tramo[data-tramo="${t}"]`);
      const r = l.ownerSVGElement.getBoundingClientRect();
      const vb = l.ownerSVGElement.viewBox.baseVal;
      const x = +l.getAttribute('x1') + k * (l.getAttribute('x2') - l.getAttribute('x1'));
      const y = +l.getAttribute('y1') + k * (l.getAttribute('y2') - l.getAttribute('y1'));
      return { x: r.x + (x * r.width) / vb.width, y: r.y + (y * r.height) / vb.height };
    }, [id, f]);
    const arrastrar = async (de, dx, dy) => {
      await p.mouse.move(de.x, de.y);
      await p.mouse.down();
      for (let i = 1; i <= 10; i += 1) await p.mouse.move(de.x + (dx * i) / 10, de.y + (dy * i) / 10);
      const durante = await estado();
      await p.mouse.up();
      return durante;
    };
    const tocar = async (sel) => { const c = await centro(sel); await p.mouse.click(c.x, c.y); };
    await p.click('#btn-nueva');
    await p.click('#btn-dibujar');
    ok(await p.locator('#dlg-unifilar[open].uf-dlg-cad #cad-tablero').isVisible() && await p.locator('#uf-titulo').innerText() === 'Dibujar el unifilar', '«Dibujar unifilar» abre el tablero en el diálogo del unifilar');
    ok(await p.locator('#cad-tablero [data-nodo="N-001"].cad-equipo-colector').count() === 1 && /Arrastre desde el colector/.test(await estado()), 'empieza con el colector y dice cómo trazar');
    const herramientas = await p.locator('.cad-herr').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    ok(JSON.stringify(herramientas) === JSON.stringify(['Tramo recto', 'Codo', 'Sube o baja', 'Injerto simple', 'Reducción', 'Reducción con injerto', 'Equipo', 'Seleccionar', 'Borrar']), 'las herramientas son las familias del taller, los equipos y editar');
    // la subida: herramienta «Sube o baja», arrastrando hacia arriba desde el colector
    await p.click('#cad-h-vertical');
    const d1 = await arrastrar(await centro('#cad-tablero [data-nodo="N-001"]'), 0, -150);
    ok(/ m · 12″ · sube desde el colector/.test(d1), 'mientras arrastra dice el largo, el Ø y la pieza');
    let m = await dib();
    ok(m.tramos.length === 1 && m.tramos[0].dir === 'SUBE' && m.tramos[0].largo_mm % 100 === 0 && m.tramos[0].largo_mm >= 1000, `la subida queda en pasos de 0.1 m (${m.tramos[0].largo_mm} mm)`);
    // el tronco: «Tramo recto» hacia el eje X del isométrico
    await p.click('#cad-h-tramo');
    await arrastrar(await centro('#cad-tablero [data-nodo="N-002"]'), 260, -150);
    m = await dib();
    ok(m.tramos.length === 2 && m.tramos[1].dir === 'H' && m.tramos[1].az_deg === 0 && /codo de 90°/.test(await estado()), 'el tramo horizontal sale con codo de 90° (eje X)');
    // con el teclado: desde el final, codo de 45° a la izquierda, 3 m y 10″
    await p.selectOption('#cad-elemento', `NODO|${m.tramos[1].a}`);
    ok(await p.locator('#cad-f-dir option').count() === 11, 'desde el final de un tramo: recto, 8 codos, subir y bajar');
    ok(await p.locator('#cad-f-d option[value="14"]').count() === 0 && await p.locator('#cad-f-d option[value="12"]').count() === 1, 'el Ø del tramo nuevo no puede pasar del anterior');
    await p.selectOption('#cad-f-dir', { label: 'Codo de 45° a la izquierda' });
    await p.fill('#cad-f-largo', '3');
    await p.selectOption('#cad-f-d', '10');
    await p.click('#cad-f-agregar');
    m = await dib();
    ok(m.tramos.length === 3 && m.tramos[2].az_deg === 45 && m.tramos[2].largo_mm === 3000 && m.tramos[2].D_in === 10, 'el tramo nuevo: codo de 45°, 3 m y 10″');
    const piezas = await p.locator('#cad-tablero .cad-pieza-txt').allTextContents();
    ok(piezas.includes('Codo 90°') && piezas.includes('Codo 45° + Red. 12″→10″'), `las piezas salen solas en cada punto (${piezas.join(' · ')})`);
    // un injerto a la mitad del tronco de 12″: herramienta «Injerto simple», Ø 6″
    await p.click('#cad-h-injerto');
    await p.selectOption('#cad-d', '6');
    const d4 = await arrastrar(await enTramo(m.tramos[1].id, 0.5), 150, 0);
    m = await dib();
    const ramal = m.tramos.find((t) => t.D_in === 6);
    ok(/injerto a 45° a la derecha/.test(d4) && ramal && ramal.az_deg === 315 && m.tramos.length === 5, 'el injerto parte el tronco y sale a 45° a favor del flujo');
    ok(await p.locator('#cad-h-injerto .cad-herr-n').innerText() === '1' && await p.locator('#cad-h-injerto').getAttribute('aria-label') === 'Injerto simple: 1 en el dibujo', 'la herramienta cuenta lo que hay en el dibujo');
    // la reducción: Ø 8″ y tocar el tramo de 10″
    await p.click('#cad-h-reduccion');
    await p.selectOption('#cad-d', '8');
    const q = await enTramo(m.tramos.find((t) => t.D_in === 10).id, 0.6);
    await p.mouse.click(q.x, q.y);
    m = await dib();
    ok(m.tramos.filter((t) => t.D_in === 8).length === 1 && /Reducción a 8″/.test(await estado()), 'tocar un tramo con «Reducción» lo parte y lo reduce de ahí en adelante');
    // los equipos al final de cada ramal
    ok(await p.locator('#cad-tablero circle.cad-nodo-libre').count() === 2, 'dos extremos libres');
    await p.selectOption('#cad-clase', 'MAQUINA_MANGUERA');
    ok(await p.locator('#cad-h-equipo[aria-pressed="true"]').count() === 1, 'escoger el equipo elige la herramienta');
    await tocar(`#cad-tablero [data-nodo="${ramal.a}"]`);
    await p.selectOption('#cad-clase', 'CAMPANA');
    await tocar(`#cad-tablero [data-nodo="${m.tramos.find((t) => t.D_in === 8).a}"]`);
    m = await dib();
    ok(m.equipos.map((e) => `${e.clase}:${e.nombre}`).join() === 'COLECTOR:Colector,MAQUINA_MANGUERA:Máquina 1,CAMPANA:Campana 1', 'una máquina con manguera y una campana, con su nombre');
    await tocar(`#cad-tablero [data-nodo="${ramal.de}"]`);
    ok(/no es un extremo: los equipos van al final de un ramal/.test(await estado()) && await p.locator('#cad-estado.cad-estado-error').count() === 1, 'un equipo a la mitad del ducto no se puede: dice por qué');
    // deshacer y rehacer
    await p.locator('#cad-tablero').focus();
    await p.keyboard.press('Control+z');
    ok((await dib()).equipos.length === 2, 'Ctrl+Z deshace la campana');
    await p.click('#cad-rehacer');
    ok((await dib()).equipos.length === 3, '«Rehacer» la vuelve a poner');
    // lo que sale del dibujo, mientras se dibuja
    const cuenta = await p.locator('#cad-cuenta').innerText();
    ok(/Codos\s+2/.test(cuenta) && /Reducciones\s+2/.test(cuenta) && /Injertos simples\s+1/.test(cuenta) && /Mangueras\s+1 tramo/.test(cuenta), `cuenta las piezas con las reglas del unifilar (${cuenta.replace(/\s+/g, ' ').slice(0, 160)}…)`);
    ok(/^\$[\d,]+\.\d\d$/.test(await p.locator('#cad-costo').innerText()), 'y da el costo directo');
    ok(/Despiece preliminar/.test(await p.locator('.cad-resumen').innerText()) && /La boca de «Colector» no trae medida/.test(await p.locator('.cad-problemas').innerText()), 'lo que se preguntará (la boca del colector) ya se ve en «Por resolver»');
    // un largo cambiado en el panel mueve lo que sigue
    await p.selectOption('#cad-elemento', 'TRAMO|A-001');
    await p.fill('#cad-t-largo', '4.5');
    await p.press('#cad-t-largo', 'Enter');
    ok(await R((n) => window.COTIZAP.unifilarCad.geometria(window.COTIZAP.web.estadoApp.cot.dibujo_unifilar).pos.get(n).z, ramal.a) === 4500, 'la subida a 4.5 m sube todo lo que sigue');
    ok(/DUCT-001: 4\.50 m a ejes − 0\.\d\d m \(CODO-001\) = 4\.\d\d m netos/.test(await p.locator('.cad-pieza-info').innerText()), 'el panel del tramo da su cota a ejes, lo que ocupan los accesorios y lo neto');
    // planta y teclas
    await p.click('#cad-vista-planta');
    ok(/planta/.test(await p.locator('#cad-escala').innerText()) && await p.locator('#cad-tablero circle.cad-vertical-planta').count() === 1, 'en planta la subida se ve como un círculo');
    await p.locator('#cad-tablero').focus();
    await p.keyboard.press('b');
    ok(await p.locator('#cad-h-borrar[aria-pressed="true"]').count() === 1, 'la tecla B elige «Borrar»');
    await p.click('#cad-vista-iso');
    // «Listo»: las piezas pasan a la cotización de una vez
    const nCad = await R(() => window.COTIZAP.web.unifilarCadUI.estado().partidas.length);
    await p.click('#cad-listo');
    await p.waitForSelector('.uf-estado');
    ok(/Despiece preliminar/.test(await p.locator('.uf-estado').innerText()) && new RegExp(`Se agregaron ${nCad} partidas a la cotización`).test(await p.locator('#uf-cuerpo').innerText()), `«Listo» convierte el dibujo en ${nCad} partidas y las agrega`);
    const fams = await R(() => [...new Set(window.COTIZAP.web.estadoApp.cot.partidas.filter((x) => x.unifilar_id).map((x) => x.familia))].sort().join());
    ok(fams === 'CODO,COMPRADO,RAMAL,RECTO,REDUCCION,SOPORTE' && await p.locator('#uf-listo').count() === 1, `las familias del cotizador (${fams}); el botón ya es «Listo»`);
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.unifilar.lectura.metadatos.fuente.archivo) === 'dibujo' && /Copiar la lectura del dibujo/.test(await p.locator('#uf-copiar-lectura').innerText()), 'la lectura dice que salió del dibujo');
    // responder la boca en la revisión y volver al dibujo: la respuesta pasa al dibujo
    await p.fill('.uf-preguntas [data-codigo="CONEXION_EQUIPO"] input', '12');
    await p.click('.uf-preguntas [data-codigo="CONEXION_EQUIPO"] button');
    ok(await p.locator('.uf-preguntas .uf-alerta').count() === 0, 'respondida la boca, no quedan preguntas');
    await p.click('#uf-editar-dibujo');
    ok((await dib()).equipos[0].boca_in === 12 && await p.locator('#cad-tablero').isVisible(), '«Editar el dibujo» vuelve al tablero con la boca respondida');
    // quitar el injerto (y su máquina) y dar «Listo»: se proponen las partidas para reemplazar
    await p.click('#cad-h-borrar');
    const r1 = await enTramo(ramal.id, 0.5);
    await p.mouse.click(r1.x, r1.y);
    m = await dib();
    ok(!m.tramos.some((t) => t.D_in === 6) && m.equipos.length === 2 && /Se quitaron 1 tramo y 1 equipo/.test(await estado()), '«Borrar» quita el injerto con su máquina');
    const antes = await R(() => window.COTIZAP.web.estadoApp.cot.partidas.filter((x) => x.unifilar_id).length);
    await p.click('#cad-listo');
    await p.waitForSelector('#uf-agregar');
    ok(/^Reemplazar con \d+ partidas$/.test(await p.locator('#uf-agregar').innerText()) && new RegExp(`Ya hay ${antes} partidas del unifilar`).test(await p.locator('#uf-cuerpo').innerText()), 'con partidas ya importadas, «Listo» propone reemplazarlas');
    await p.click('#uf-agregar');
    const despues = await R(() => window.COTIZAP.web.estadoApp.cot.partidas.filter((x) => x.unifilar_id).map((x) => x.familia));
    ok(despues.length < antes && !despues.includes('RAMAL') && !despues.includes('COMPRADO'), 'se reemplazaron: sin el injerto ni la manguera');
    // el dibujo se guarda con la cotización
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(JSON.stringify(await dib()) === JSON.stringify(m), 'al recargar la página sigue el dibujo');
    await p.click('#btn-unifilar');
    ok(await p.locator('#uf-editar-dibujo').count() === 1, 'y la revisión ofrece «Editar el dibujo»');
    await p.click('#uf-editar-dibujo');
    await p.click('#cad-ejemplo');
    ok(await p.locator('#cad-tablero .cad-equipo').count() === 4 && /croquis de ejemplo/.test(await estado()), '«Probar con el ejemplo» dibuja el croquis de ejemplo');
    await p.click('#cad-listo');
    ok(await p.locator('#uf-agregar').innerText() === 'Reemplazar con 22 partidas' && /Despiece definitiva/.test(await p.locator('.uf-estado').innerText()), 'el ejemplo dibujado: las 22 partidas del croquis, sin preguntas');
    await p.click('#uf-agregar');
    // un dibujo guardado que no sirve se descarta (no rompe la página)
    await R(() => { const c = JSON.parse(localStorage.getItem('cotizap.cotizacion.v1')); c.dibujo_unifilar = { version: 1, tramos: [{ id: 'A-001', de: 'N-001', a: 'N-001' }], equipos: [] }; localStorage.setItem('cotizap.cotizacion.v1', JSON.stringify(c)); });
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await dib() === undefined && await p.locator('#lista-partidas .chip-unifilar').count() === 22, 'un dibujo guardado roto se descarta; las partidas siguen');
    // en el teléfono: el tablero arriba, el panel abajo, sin desplazamiento horizontal
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('#btn-dibujar');
    const anchos = await R(() => [document.documentElement.scrollWidth, document.querySelector('#uf-cuerpo').scrollWidth, document.querySelector('#uf-cuerpo').clientWidth]);
    ok(anchos[0] <= 390 && anchos[1] <= anchos[2], `sin desplazamiento horizontal en el teléfono (${anchos.join(' / ')})`);
    ok(await p.locator('#cad-tablero').isVisible() && (await p.locator('#cad-tablero').boundingBox()).height >= 300, 'el tablero mide al menos 300 px de alto');
    await p.context().close();
  }

  console.log('35) Trazado isométrico jugable: el recorrido de §1.6 con ratón y teclado da el JSON del ejemplo; fases, problemas, imán, tiradores y guardado');
  {
    const EJ = require('../../docs/ejemplos/trazado-isometrico-ejemplo.json');
    const esperado = JSON.stringify({ ...EJ, resultados: null });
    const p = await nuevaPagina();
    const R = (fn, a) => p.evaluate(fn, a);
    await p.click('#tab-trazado');
    ok(await p.locator('#panel-trazado').isVisible() && await p.locator('#ti-lienzo').isVisible(), 'la pestaña «Trazado isométrico» es otro apartado, con su lienzo');
    ok(await p.locator('#aviso-ilustrativo').isHidden() && await p.locator('#aviso-error').isHidden(), 'en el trazado no salen los avisos de precios ni de partidas');
    const pant = (x, y, z) => R(([x0, y0, z0]) => {
      const s = window.COTIZAP.web.trazadoUI.estado();
      const q = window.COTIZAP.trazadoTablero.pantalla(s, { x: x0, y: y0, z: z0 });
      const r = document.querySelector('#ti-lienzo').getBoundingClientRect();
      return { x: r.left + (q.x * r.width) / s.ancho, y: r.top + (q.y * r.height) / s.alto };
    }, [x, y, z]);
    const dentro = async (x, y, z) => { const q = await pant(x, y, z); const r = await p.locator('#ti-lienzo').boundingBox(); return q.x > r.x + 120 && q.x < r.x + r.width - 120 && q.y > r.y + 110 && q.y < r.y + r.height - 60; };
    const lienzo = () => p.focus('#ti-lienzo');
    const aLaVista = async (x, y, z) => { for (let i = 0; i < 6 && !(await dentro(x, y, z)); i += 1) { await lienzo(); await p.keyboard.press('-'); } };
    const clic = async (x, y, z) => { await aLaVista(x, y, z); const q = await pant(x, y, z); await p.mouse.click(q.x, q.y); };
    const arrastrar = async (a, b) => { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2); await p.mouse.move(b.x, b.y); await p.mouse.up(); };
    const msg = () => p.locator('#ti-msg').innerText();
    const campo = async (sel, v) => { await p.fill(sel, String(v)); await p.press(sel, 'Enter'); };
    const trazo = () => R(() => window.COTIZAP.web.trazadoUI.estado().t);
    // Fase 1: proyecto
    ok(await p.locator('#ti-fase-1 .ti-fase-n').innerText() === '1', 'sin colector, «Equipos y tomas» cuenta 1 pendiente');
    await campo('#ti-pr-nombre', 'Ejemplo: sierra y cepillo a un colector');
    await campo('#ti-pr-id', 'EJ-TRAZADO-01');
    await campo('#ti-pr-mat', 'Aserrín y viruta de madera');
    await campo('#ti-pr-alt', '2240');
    await campo('#ti-pr-origen', 'Centro de la base del colector, sobre el piso terminado');
    ok(/ρ = 0[.,]9169 kg\/m³/.test(await p.locator('#ti-pr-aire').innerText()), 'a 2 240 m y 20 °C el aire tiene ρ = 0.9169 kg/m³');
    // Fase 2: el colector y su boca en la cara +X (se ve en SE: E gira la vista)
    await p.click('#ti-b-colector');
    await clic(0, 0, 0);
    ok(/^Colector en X 0, Y 0\./.test(await msg()) && await p.locator('#ti-fase-1').getAttribute('aria-current') === 'step', 'el colector se apoya en la rejilla del piso; la barra de fases va en «Equipos y tomas»');
    await campo('#ti-e-nombre', 'Colector de polvo');
    await campo('#ti-e-perdida', '1250');
    await lienzo();
    await p.keyboard.press('e');
    ok(await R(() => window.COTIZAP.web.trazadoUI.estado().vista) === 'SE', 'E gira el isométrico (NE → SE)');
    await p.selectOption('#ti-d-activo', '8');
    await lienzo();
    await p.keyboard.press('p');
    await clic(750, 0, 3000);
    ok(await msg() === 'Boca PU-01 de Colector de polvo en su cara +X, Ø 8″, con brida.', 'la boca va en la cara que se tocó, con brida');
    await campo('#ti-p-nombre', 'Boca del colector');
    await lienzo();
    await p.keyboard.press('q');
    // la sierra: cae en la rejilla de 100 mm y se lleva a X = 10 750 con Mayús+←
    await p.click('#ti-b-maquina');
    await clic(10750, 0, 0);
    await lienzo();
    for (let i = 0; i < 5; i += 1) await p.keyboard.press('Shift+ArrowLeft');
    ok((await trazo()).equipos[1].posicion_mm.x === 10750, 'Mayús+← mueve el equipo 10 mm');
    await campo('#ti-e-nombre', 'Sierra de banco');
    await p.selectOption('#ti-d-activo', '6');
    await lienzo();
    await p.keyboard.press('p');
    await clic(10750, 0, 1200);
    await campo('#ti-p-nombre', 'Toma superior');
    await campo('#ti-p-q', '1300');
    ok(/19[.,]8 m\/s ✓/.test(await p.locator('#ti-inspector').innerText()), 'la toma de 6″ con 1 300 m³/h: 19.8 m/s, en verde');
    await lienzo();
    await p.keyboard.press('b');
    await campo('#ti-b-numero', '6');
    await campo('#ti-b-circulo_mm', '190');
    await campo('#ti-b-diametro_mm', '9.5');
    // el cepillo, con manguera; los tiradores la dejan en S
    await p.click('#ti-b-maquina');
    await clic(7000, -3000, 0);
    await campo('#ti-e-nombre', 'Cepillo');
    await campo('#ti-e-largo', '1000');
    await campo('#ti-e-ancho', '600');
    await campo('#ti-e-alto', '1000');
    await p.selectOption('#ti-d-activo', '5');
    await lienzo();
    await p.keyboard.press('p');
    await clic(7000, -3000, 1000);
    await campo('#ti-p-nombre', 'Toma superior');
    await campo('#ti-p-q', '900');
    await lienzo();
    await p.keyboard.press('f');
    ok(await p.locator('#ti-acople-manguera').getAttribute('aria-pressed') === 'true' && await p.locator('.ti-rombo').count() === 1 && await p.locator('.ti-circulo').count() === 1, 'F acopla con manguera: aparecen el rombo y el círculo');
    const h0 = await R(() => window.COTIZAP.trazadoTablero.mangueraDe(window.COTIZAP.web.trazadoUI.estado(), 'PU-03').h);
    await arrastrar(await pant(7000, -3000, 1000 + h0), await pant(7000, -3000, 1900));
    ok(/a 900 mm sobre la toma/.test(await msg()), 'arrastrar el rombo sube el punto de transición a 900 mm');
    await arrastrar(await pant(7000, -3000, 1900), await pant(7000, -2750, 1900));
    ok(/S de dos curvas de 39[.,]31°: radio 552[.,]5 mm \(mínimo 190[.,]5 mm\), 958 mm/.test(await msg()) && /Manguera en S/.test(await p.locator('#ti-manguera-sem').innerText()), 'el círculo lo desvía 250 mm: la S de 39.31° y 552.5 mm, en verde');
    // Fase 3: el tronco (↑, 1.8, Entrar) y el imán a la boca
    await lienzo();
    await p.keyboard.press('t');
    await clic(10750, 0, 1200);
    const m0 = await msg();
    ok(m0 === 'Desde la toma PU-02 el ducto puede salir en +Z. Mueva el puntero y haga clic, o teclee el largo y Entrar. Esc termina.', `presionar en la toma con brida empieza el trazo (y dice qué se puede): ${m0}`);
    await p.keyboard.press('ArrowUp');
    await p.keyboard.type('1.8');
    ok(await p.locator('#ti-caja').innerText() === '▸ 1.8_' && /eje Z/.test(await p.locator('#ti-plano').innerText()), 'la caja de valores muestra lo tecleado; ↑ fija el eje Z');
    await p.keyboard.press('Enter');
    ok(await msg() === 'Tramo TR-002: 1.8 m · 6″ · recto.', 'Entrar: la subida de 1.8 m');
    let b = await pant(750, 0, 3000);
    await p.mouse.move(b.x - 60, b.y - 20);
    await p.mouse.move(b.x, b.y);
    await p.waitForFunction(() => document.querySelectorAll('.ti-iman-elegida').length === 1, null, { timeout: 2000 }).catch(() => {});
    ok(await p.locator('.ti-iman-elegida').count() === 1 && /Imán: la boca PU-01/.test(await p.locator('#ti-ajuste').innerText()), 'cerca de la boca, el imán propone la llegada (punteada)');
    await p.mouse.click(b.x, b.y);
    ok(/^Llegada: −X 10 m, 1 codo\. Adaptador de 8″ a 6″ en N-001 \(AD-001\)\. Codo de 90° en N-005 \(CO-001\)\.$/.test(await msg()), 'clic: llega alineado con el cuello; el codo y el adaptador salen solos');
    // el ramal: desde el PT, ↑ 1.1 y el imán al tronco (Tab alterna las propuestas)
    await clic(7000, -2750, 1900);
    await p.keyboard.press('ArrowUp');
    await p.keyboard.type('1.1');
    await p.keyboard.press('Enter');
    b = await pant(4300, 0, 3000);
    await p.mouse.move(b.x + 40, b.y + 30);
    await p.mouse.move(b.x, b.y);
    // la capa se vuelve a pintar en el siguiente cuadro: se espera a que el globo diga lo esperado (hasta 2 s)
    const globo = async (re) => { for (let i = 0; i < 40; i += 1) { const t = await p.locator('#ti-capa .ti-globo').last().textContent(); if (re.test(t)) return true; await p.waitForTimeout(50); } return false; };
    ok(await globo(/Injerto a 45°, de lado \(izquierda\): rumbo 135° 3[.,]889 m, 1 codo\. \(Tab: 1 de 3\)/), 'cerca del tronco: injerto a 45° de lado, 3.889 m (1 de 3)');
    await p.keyboard.press('Tab');
    ok(await globo(/Injerto a 30°.*rumbo 150° 5[.,]5 m/), 'Tab: la alternativa a 30° con 5.5 m');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Tab');
    await p.mouse.click(b.x, b.y);
    ok(/Injerto a 45° en N-007 \(IN-001\)/.test(await msg()), 'clic acepta: sale el injerto a 45°');
    // Fase 4 y 5: dimensionar, renumerar, el JSON
    await p.click('#ti-fase-4');
    await p.click('#ti-dim-todo');
    ok(/TR-005: 6″ → 8″, 33[.,]5 → 18[.,]8 m\/s\. Reducción con injerto a 45° en N-007 \(RI-001\)/.test(await msg()), 'dimensionar por caudal: el tronco a 8″ y la reducción con injerto');
    await p.click('#ti-fase-5');
    await p.click('#ti-renumerar');
    const sis = () => R(() => JSON.stringify(window.COTIZAP.trazadoIso.aSistema(window.COTIZAP.web.trazadoUI.estado().t, window.COTIZAP.web.estadoApp.M)));
    ok(await sis() === esperado, 'el JSON del sistema es exactamente el del ejemplo resuelto (§1.6)');
    ok(await p.locator('.ti-fase-n').count() === 0 && /Listo para exportar/.test(await p.locator('#ti-salida-estado').innerText()), 'ninguna fase con pendientes; listo para exportar');
    await p.click('#ti-copiar');
    await p.waitForTimeout(150);
    const copiado = await R(async () => { const d = document.querySelector('#dlg-io'); if (d && d.open) return document.querySelector('#io-texto').value; try { return await navigator.clipboard.readText(); } catch (e) { return null; } });
    ok(copiado && JSON.stringify(JSON.parse(copiado)) === esperado, '«Copiar el JSON» copia el sistema');
    await p.keyboard.press('Escape');
    // se guarda con la cotización
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    await p.click('#tab-trazado');
    ok(await sis() === esperado, 'al recargar la página sigue el trazado');
    // lo que no se puede, con su porqué; deshacer
    await lienzo();
    await p.keyboard.press('t');
    await clic(750, 0, 3000);
    ok(/Desde la boca PU-01 ya no puede salir otro ducto/.test(await msg()) && await p.locator('#ti-msg.ti-msg-error').count() === 1, 'desde la boca ocupada no se traza, y se dice por qué');
    await lienzo();
    await p.keyboard.press('Escape');
    const nAntes = (await trazo()).tramos.length;
    await p.click('#ti-nuevo');
    ok((await trazo()).equipos.length === 0 && await p.locator('#ti-fase-1 .ti-fase-n').innerText() === '1', '«Nuevo trazado» empieza vacío');
    await lienzo();
    await p.keyboard.press('Control+z');
    ok((await trazo()).tramos.length === nAntes, 'Ctrl+Z recupera el trazado anterior');
    await p.click('#ti-nuevo');
    // arrastrar un equipo de la paleta al lienzo; el panel de problemas lleva al equipo
    const bloque = await p.locator('#ti-b-maquina').boundingBox();
    const centro = await p.locator('#ti-lienzo').boundingBox();
    await p.mouse.move(bloque.x + 20, bloque.y + 10);
    await p.mouse.down();
    await p.mouse.move(centro.x + centro.width / 2, centro.y + centro.height / 2, { steps: 6 });
    await p.mouse.up();
    ok((await trazo()).equipos.length === 1 && /^Máquina en X/.test(await msg()), 'arrastrar «Máquina» de la paleta al lienzo la coloca');
    await p.click('#ti-fase-0');
    await p.locator('#ti-problemas summary').click();
    await p.locator('.ti-prob-btn', { hasText: 'EQUIPO_SIN_PUERTOS' }).click();
    ok(await p.locator('#ti-e-nombre').inputValue() === 'Máquina', 'un clic en el problema selecciona el equipo');
    // el cubo de vista: la cara de arriba da la planta
    await p.locator('#ti-cubo [data-vista="PLANTA"]').click();
    ok(await R(() => window.COTIZAP.web.trazadoUI.estado().vista) === 'PLANTA' && await p.locator('#ti-vista-planta').getAttribute('aria-pressed') === 'true', 'el cubo de vista: arriba = planta');
    // un trazado guardado que el modelo no acepta se descarta sin romper la página
    await R(() => { const c = JSON.parse(localStorage.getItem('cotizap.cotizacion.v1')); c.trazado_iso = { version: 1, nodos: [{ id: 'N-001' }], tramos: [], equipos: [] }; localStorage.setItem('cotizap.cotizacion.v1', JSON.stringify(c)); });
    await p.reload();
    await p.waitForSelector('#lista-partidas .partida');
    ok(await R(() => window.COTIZAP.web.estadoApp.cot.trazado_iso) === undefined, 'un trazado guardado roto se descarta');
    // en el teléfono: lienzo arriba, paleta deslizable, sin desplazamiento horizontal
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('#tab-trazado');
    await p.click('#ti-ejemplo');
    const anchos = await R(() => [document.documentElement.scrollWidth, document.querySelector('#panel-trazado').scrollWidth]);
    ok(anchos[0] <= 390 && anchos[1] <= 390, `sin desplazamiento horizontal en el teléfono (${anchos.join(' / ')})`);
    ok((await p.locator('#ti-lienzo').boundingBox()).height >= 300, 'el lienzo mide al menos 300 px de alto');
    await p.context().close();
  }

  ok(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`);
  await browser.close();
  console.log(fallos ? `\n${fallos} verificación(es) fallaron` : '\nTodas las verificaciones pasaron');
  process.exit(fallos ? 1 : 0);
})();
