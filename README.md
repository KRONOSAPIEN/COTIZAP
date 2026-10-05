# COTIZAP · Cotizador maestro de ducterías

Cotizador para ducterías de lámina (colección de polvo y control ambiental). Calcula el desarrollo geométrico de cada pieza, el peso con merma, los herrajes de unión, las horas de taller, los consumibles y la pila de precio completa: costo directo → indirectos → imprevistos → financiamiento → utilidad.

> ⚠ **Los precios, tarifas, velocidades y tiempos incluidos son ILUSTRATIVOS.** Sirven para que todo funcione desde el primer minuto y como vector de prueba. Antes de cotizar a un cliente hay que sustituirlos por los reales (ver [Calibración](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos)). Ninguna fórmula contiene un precio: todas leen variables como `precio_kg_acero_carbon`, editables en la app.

## Qué incluye

| Pieza | Dónde | Qué es |
| --- | --- | --- |
| **Documento de arquitectura** | [`docs/arquitectura-cotizador-ducterias.md`](docs/arquitectura-cotizador-ducterias.md) | Insumos, fórmulas geométricas, mano de obra y consumibles, estructura de precios, pseudocódigo y un ejemplo resuelto paso a paso. Es la especificación. |
| **Motor de cálculo** | `src/motor/` | Funciones puras, sin dependencias. Separa *cantidades* de *precios*. |
| **Tablas maestras** | `src/datos/maestros.js` | Materiales, calibres, perfiles, uniones, velocidades, tarifas, merma y capas de precio. |
| **Aplicación web** | `src/web/` | Captura de partidas, desglose paso a paso, editor de tablas maestras, propuesta imprimible. |
| **Pruebas** | `tests/` | Geometría contra mallas 3D independientes, ejemplo recalculado línea por línea, política de precios, interfaz de extremo a extremo. |

## Empezar

**Usar la app.** Abra `src/web/index.html` en el navegador (doble clic). No necesita servidor ni instalación; las cotizaciones y las tablas maestras editadas se guardan en el propio navegador (de las tablas sólo se guarda lo que usted cambió, así que los valores de arranque nuevos le llegan solos). Arranca con una cotización de ejemplo para explorar el cálculo. Las tipografías (Barlow, IBM Plex Mono) se piden a Google Fonts; sin conexión se usan las del sistema.

1. **Tablas maestras** → capture precios, tarifas y velocidades reales.
2. **Cotización** → *Agregar partida*, elija la familia y capture dimensiones; el precio se recalcula mientras escribe.
3. Seleccione una partida para ver el desglose: geometría, merma, tiempos, consumibles y cada capa del precio.
4. *Imprimir propuesta* genera la hoja para el cliente (sin costos internos). *Guardar y cargar* exporta/importa JSON y copia un CSV de partidas para Excel.

**Un solo archivo.** `npm run construir` genera `dist/cotizap.html` (app completa en un archivo, se abre con doble clic).

**Pruebas.** Requiere Node 22 o superior.

```bash
npm test                 # motor: geometría, ejemplo, precios, validaciones
npm run test:e2e         # interfaz (opcional): npm i -D playwright && npx playwright install chromium
```

## Usar el motor desde código

```js
const { crearMaestros } = require('./src/datos/maestros');
const { cotizarPartida } = require('./src/motor/cotizador');

const M = crearMaestros();                 // tablas maestras: edite precios y tarifas aquí
const r = cotizarPartida({
  familia: 'RECTO', material_id: 'ACERO_CARBON', calibre: 16,
  D_mm: 304.8, L_mm: 3000, tipo_union: 'BRIDADO', cantidad: 1,
}, M);

console.log(r.precio.unitario);            // 2314.3 MXN
console.log(r.peso.neto_total_kg);         // 37.564 kg (lámina + aros de brida)
console.log(r.pila);                       // CD, CI, imprevistos, financiamiento, utilidad…
console.log(r.qto);                        // cantidades físicas, sin precios
```

`cotizar({ riesgo, servicio, partidas }, M)` cotiza varias partidas y suma IVA. Una partida con datos inválidos devuelve sus errores sin tumbar a las demás.

## Brida estándar del taller

Todos los ductos se unen con **bridas de solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼"**, sin importar el diámetro. Así viene precargado (perfil `SOL38x4.8` en `src/datos/maestros.js`): la solera se rola de canto, el barreno va al centro de su ancho y cada junta lleva múltiplo de 4 tornillos. Los ángulos siguen disponibles como opción por partida (*Perfil de aros*).

Cinco detalles se **supusieron** y conviene confirmarlos con el taller (se editan en las tablas maestras): paso máximo entre barrenos (150 mm), posición del barreno (al centro de la solera), soldadura continua aro–ducto, empaque de neopreno 1½" × 1/8" y juego de tornillería (tornillo + tuerca + 2 rondanas). Ver [§10.4 del documento](docs/arquitectura-cotizador-ducterias.md#104-supuestos-del-estándar-de-bridas-por-confirmar-con-el-taller).

## Familias de pieza

| Familia | Geometría | Precisión |
| --- | --- | --- |
| Tramo recto (redondo y rectangular) | desarrollo con fibra neutra | exacta |
| Codo (segmentado y de radio) | longitud de eje exacta; factor `tan(α/2)/(α/2)` | exacta (verificada con malla 3D) |
| Reducción (concéntrica y excéntrica) | tronco de cono, integral numérica | exacta (verificada con malla 3D) |
| Transición redondo → rectángulo | triangulación estándar | exacta (verificada con malla 3D) |
| Ramal en ángulo | promedio elíptico de la silleta | exacta (verificada) |
| Pantalón (Y simétrica) | primitivas + factor de entrepierna | ±10 %, **requiere calibrar** |
| Personalizada | área desarrollada desde CAD | la que traiga el CAD |
| Comprado | precio de compra | — |

## Estructura

```text
docs/arquitectura-cotizador-ducterias.md   especificación
src/
  datos/maestros.js                        tablas maestras (valores ilustrativos)
  motor/                                   util · geometria · material · mano_obra · consumibles · precios · cotizador
  web/                                     index.html · app.js · maestros_ui.js · esquemas.js · dom.js · estilos.css
tests/                                     *.test.js (node:test) · e2e/ui.e2e.js (Playwright, opcional)
scripts/construir.js                       empaquetado a un solo HTML
```

## Límites conocidos

- Pantalón con geometría aproximada hasta calibrar `k_entrepierna` con desarrollos reales.
- Transiciones sólo centradas; ducto espiral, collarines y campanas se capturan como pieza *personalizada* o *comprada*.
- El anidado de hojas está descrito en el documento pero no implementado: la merma es un porcentaje por familia (editable por partida).
- Fuera de alcance: instalación, soportería, flete a obra.

La lista completa y el plan de calibración están en el [documento de arquitectura, §10](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos).
