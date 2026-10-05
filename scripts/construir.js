#!/usr/bin/env node
/**
 * COTIZAP · scripts/construir.js
 *
 * Empaqueta la app (src/web + motor + maestros) en un solo archivo HTML sin dependencias:
 *
 *   node scripts/construir.js            → dist/cotizap.html          (documento completo; abre con doble clic)
 *   node scripts/construir.js --fragmento → dist/cotizap.fragmento.html (sin <html>/<head>/<body>; para
 *                                           incrustar en un visor restringido: sin descargas ni impresión)
 *
 * Los scripts se concatenan en el orden de index.html; el CSS se incrusta en <style>.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const WEB = path.join(RAIZ, 'src', 'web');
const fragmento = process.argv.includes('--fragmento');

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

const titulo = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'COTIZAP';
const fuentes = (html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [''])[0];
const cuerpo = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const sinScripts = cuerpo.replace(/<script src="[^"]+"><\/script>\s*/g, '');

const rutasJs = [...cuerpo.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => path.resolve(WEB, m[1]));
// En el navegador cada archivo es un script clásico; en Node usan require, por eso se cargan con un envoltorio UMD.
const js = rutasJs.map((r) => `/* ${path.relative(RAIZ, r).replace(/\\/g, '/')} */\n${fs.readFileSync(r, 'utf8')}`).join('\n');
const css = fs.readFileSync(path.join(WEB, 'estilos.css'), 'utf8');

const marca = fragmento ? '<script>window.COTIZAP_ENTORNO_ARTIFACT = true;</script>\n' : '';
const cuerpoFinal = `${sinScripts}\n${marca}<script>\n${js}\n</script>`;

let salida;
if (fragmento) {
  salida = `<title>COTIZAP</title>\n${fuentes}\n<style>\n${css}\n</style>\n${cuerpoFinal}\n`;
} else {
  salida = `<!doctype html>\n<html lang="es-MX">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${titulo}</title>\n${fuentes}\n<style>\n${css}\n</style>\n</head>\n<body>\n${cuerpoFinal}\n</body>\n</html>\n`;
}

const destino = path.join(RAIZ, 'dist', fragmento ? 'cotizap.fragmento.html' : 'cotizap.html');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, salida, 'utf8');
console.log(`${path.relative(RAIZ, destino)} · ${(Buffer.byteLength(salida) / 1024).toFixed(1)} KB · ${rutasJs.length} scripts`);
