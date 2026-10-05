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

**Usar la app.** Abra `src/web/index.html` en el navegador (doble clic). No necesita servidor ni instalación; la cotización se guarda en el propio navegador y las tablas maestras se guardan solas cada vez que las cambia (ver [Dónde se guardan los precios](#dónde-se-guardan-los-precios)). Arranca con una cotización de ejemplo para explorar el cálculo. Las tipografías (Barlow, IBM Plex Mono) se piden a Google Fonts; sin conexión se usan las del sistema.

1. **Tablas maestras** → capture precios, tarifas y velocidades reales.
2. **Cotización** → *Agregar partida*, elija la familia y capture dimensiones; el precio se recalcula mientras escribe.
3. Seleccione una partida para ver el desglose: geometría, merma, tiempos, consumibles y cada capa del precio.
4. *Imprimir propuesta* genera la hoja para el cliente (sin costos internos). *Guardar y cargar* exporta/importa JSON y copia un CSV de partidas para Excel.

**Un solo archivo.** `npm run construir` genera `dist/cotizap.html` (app completa en un archivo, se abre con doble clic).

**Pruebas.** Requiere Node 22 o superior.

```bash
npm test                 # motor y guardado: geometría, ejemplo, precios, validaciones, almacén de tablas
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

## Dónde se guardan los precios

Cada cambio en **Tablas maestras** (precios, tarifas, tiempos…) se guarda automáticamente, sin botón de guardar. Una línea bajo el título de la pestaña dice cómo va: *Guardando…*, *Guardado automáticamente a las 20:41*, o el aviso si algo falla.

| Dónde se abre | Dónde se guardan las tablas | Qué se mantiene al volver a abrir |
| --- | --- | --- |
| **Artefacto de Claude** | En el artefacto (documento `config/maestros`) y, como respaldo, en el navegador | Los precios, desde cualquier navegador o equipo, y también después de publicar versiones nuevas de la página |
| **Archivo suelto** (`dist/cotizap.html`, `src/web/index.html`) | Sólo en el navegador | Los precios, en ese mismo navegador |

- De las tablas sólo se guarda **lo que usted cambió**, no una copia completa; así, si cambian los valores de arranque (como pasó con la brida estándar), quien no tocó esa celda recibe el valor nuevo.
- En el artefacto los precios son **de todos los que lo abren**: sólo el propietario y los editores los cambian; quien sólo puede ver los ve bloqueados (*Sólo lectura*).
- Si una escritura falla, el cambio queda marcado como pendiente y se reintenta solo (hay un botón *Reintentar ahora*); si se cierra la página antes, se sube en la próxima apertura.
- Los precios capturados con la primera versión de la app (que los guardaba completos en el navegador) se recuperan una sola vez al abrir.
- La **cotización** (cliente, partidas) sigue guardándose sólo en el navegador; *Guardar y cargar* exporta e importa todo en JSON.

## Brida estándar del taller

Todos los ductos se unen con **bridas de solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼"**, sin importar el diámetro. Así viene precargado (perfil `SOL38x4.8` en `src/datos/maestros.js`): la solera se rola de canto, el barreno va al centro de su ancho y cada junta lleva múltiplo de 4 tornillos. Los ángulos siguen disponibles como opción por partida (*Perfil de aros*).

Cinco detalles se **supusieron** y conviene confirmarlos con el taller (se editan en las tablas maestras): paso máximo entre barrenos (150 mm), posición del barreno (al centro de la solera), soldadura continua aro–ducto, empaque de neopreno 1½" × 1/8" y juego de tornillería (tornillo + tuerca + 2 rondanas). Ver [§10.4 del documento](docs/arquitectura-cotizador-ducterias.md#104-supuestos-del-estándar-de-bridas-por-confirmar-con-el-taller).

## Familias de pieza

| Familia | Geometría | Precisión |
| --- | --- | --- |
| Tramo recto (redondo y rectangular) | desarrollo con fibra neutra | exacta |
| Codo de 30°, 45°, 60° o 90° (segmentado y de radio) | longitud de eje exacta; factor `tan(α/2)/(α/2)` | exacta (verificada con malla 3D) |
| Reducción (concéntrica y excéntrica) | tronco de cono, integral numérica | exacta (verificada con malla 3D) |
| Transición redondo → rectángulo | triangulación estándar | exacta (verificada con malla 3D) |
| Injerto simple, a 30° o 45° (antes ramal en ángulo) | promedio elíptico de la silleta | exacta (verificada) |
| Reducción con injerto, a 30° o 45°, derecho o izquierdo | el injerto va **sobre el cono**: la intersección cilindro–cono se resuelve numéricamente (silleta, orificio y soldadura); el largo de la reducción sale solo (el mínimo que aloja la silleta con 25 mm de holgura) o se captura | exacta (verificada contra cálculo independiente por fuerza bruta); merma y dificultad por calibrar |
| Personalizada | área desarrollada desde CAD | la que traiga el CAD |
| Comprado | precio de compra | — |

**Ángulos del taller.** Todo injerto (simple o en la reducción) es de **30° o 45°** y los codos son de **30°, 45°, 60° o 90°**. En la captura son listas desplegables; el motor además rechaza cualquier otro ángulo con un mensaje claro (una cotización anterior con un ángulo distinto se abre mostrándolo como *no permitido* hasta corregirlo). Las listas están en las tablas maestras (`proceso.angulos_injerto_deg`, `proceso.angulos_codo_deg`), no en el código.

## Estructura

```text
docs/arquitectura-cotizador-ducterias.md   especificación
src/
  datos/maestros.js                        tablas maestras (valores ilustrativos)
  motor/                                   util · geometria · material · mano_obra · consumibles · precios · cotizador
  web/                                     index.html · app.js · almacen.js · maestros_ui.js · esquemas.js · dom.js · estilos.css
tests/                                     *.test.js (node:test) · e2e/ui.e2e.js (Playwright, opcional)
scripts/construir.js                       empaquetado a un solo HTML
```

## Límites conocidos

- Injertos y codos: siete detalles se **supusieron** y hay que confirmarlos con el taller (qué significa «der», hacia qué extremo se inclina el injerto sobre el cono, silleta centrada, holgura de 25 mm, largo del injerto, merma y dificultad, gajos del codo de 30°); están en [§10.5](docs/arquitectura-cotizador-ducterias.md#105-supuestos-de-injertos-y-codos-por-confirmar-con-el-taller) y cada uno se cambia en las tablas maestras o en la partida. El pantalón se retiró de la interfaz; el motor lo conserva sólo para abrir cotizaciones anteriores.
- Transiciones sólo centradas; ducto espiral, collarines y campanas se capturan como pieza *personalizada* o *comprada*.
- El anidado de hojas está descrito en el documento pero no implementado: la merma es un porcentaje por familia (editable por partida).
- Fuera de alcance: instalación, soportería, flete a obra.

La lista completa y el plan de calibración están en el [documento de arquitectura, §10](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos).
