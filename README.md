# COTIZAP · Cotizador maestro de ducterías

Cotizador para ducterías de lámina (colección de polvo y control ambiental). Calcula el desarrollo geométrico de cada pieza, el peso con merma, los herrajes de unión, las horas de taller, los consumibles y la pila de precio completa: costo directo → indirectos → imprevistos → financiamiento → utilidad.

> ⚠ **Sólo son reales la mano de obra ($500 por día: $87.50 por hora trabajada), la lámina y los perfiles de la lista del proveedor (cotizaciones y factura del 30-sep-2026) y los artículos del catálogo de compras (hoja de control de gastos del 6-oct-2026).** Los demás precios, tarifas, velocidades y tiempos (consumibles, equipo, indirectos, utilidad) son ILUSTRATIVOS: sirven para que todo funcione desde el primer minuto y como vector de prueba. Antes de cotizar a un cliente hay que sustituirlos por los reales (ver [Calibración](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos)). Ninguna fórmula contiene un precio: todas leen variables como `precio_m3_gas_argon` o la lista del proveedor, editables en la app.

## Qué incluye

| Pieza | Dónde | Qué es |
| --- | --- | --- |
| **Documento de arquitectura** | [`docs/arquitectura-cotizador-ducterias.md`](docs/arquitectura-cotizador-ducterias.md) | Insumos, fórmulas geométricas, mano de obra y consumibles, estructura de precios, lista de compras, venta pactada y control de gastos, pseudocódigo, ejemplos resueltos paso a paso y un proyecto real. Es la especificación. |
| **Motor de cálculo** | `src/motor/` | Funciones puras, sin dependencias. Separa *cantidades* de *precios*. |
| **Tablas maestras** | `src/datos/maestros.js` · `src/datos/ayuda_maestros.js` | Lista de precios del proveedor, catálogo de compras, materiales, calibres, perfiles, uniones, velocidades, tarifas, merma y capas de precio; y la ayuda de cada dato (qué es, cómo se llena, qué esperar). |
| **Aplicación web** | `src/web/` | Captura de partidas, desglose paso a paso, compras y gastos del proyecto, editor de tablas maestras con ayuda integrada, propuesta imprimible. |
| **Pruebas** | `tests/` | Geometría contra mallas 3D independientes, ejemplo recalculado línea por línea, política de precios, robustez ante datos absurdos o dañados, interfaz de extremo a extremo. |

## Empezar

**Usar la app.** Abra `src/web/index.html` en el navegador (doble clic). No necesita servidor ni instalación; la cotización se guarda en el propio navegador y las tablas maestras se guardan solas cada vez que las cambia (ver [Dónde se guardan los precios](#dónde-se-guardan-los-precios)). Arranca con una cotización de ejemplo para explorar el cálculo. Las tipografías (Barlow, IBM Plex Mono) se piden a Google Fonts; sin conexión se usan las del sistema.

1. **Tablas maestras** → capture precios, tarifas y velocidades reales.
2. **Cotización** → en el encabezado elija el **ancho de la yarda** (3 ó 4 pies) de los tramos rectos, la **instalación** (interior o exterior: decide la pintura) y ajuste, para esa cotización, el **margen de utilidad, la comisión, el descuento y los días de cobro** (y, en *Más parámetros de precio*, administración, financiamiento e IVA) sin ir a las tablas maestras; luego *Agregar partida*, elija la familia y capture dimensiones; el precio se recalcula mientras escribe.
3. Seleccione una partida para ver el desglose: geometría, merma, tiempos, consumibles y cada capa del precio.
4. **Compras y gastos** → la lista de lo que hay que comprar en piezas enteras, la venta pactada contra el precio mínimo y el control de gastos real contra cotizado ([ver abajo](#compras-y-gastos-del-proyecto)).
5. *Imprimir propuesta* genera la hoja para el cliente (sin costos internos). *Guardar y cargar* exporta/importa JSON y copia un CSV de partidas para Excel.

**Un solo archivo.** `npm run construir` genera `dist/cotizap.html` (app completa en un archivo, se abre con doble clic).

**Pruebas.** Requiere Node 22 o superior.

```bash
npm test                 # motor y guardado: geometría, ejemplo, precios, validaciones, robustez, almacén de tablas
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

console.log(r.precio.unitario);            // 2387.71 MXN (hora trabajada a $87.50; una brida de taller, el aro suelto del extremo del ajuste y pintura de interior)
console.log(r.peso.neto_total_kg);         // 37.923 kg (lámina + aro de brida + aro suelto)
console.log(r.pila);                       // CD, CI, imprevistos, financiamiento, utilidad…
console.log(r.qto);                        // cantidades físicas, sin precios
```

`cotizar({ riesgo, servicio, partidas, venta_pactada, piezas_enteras }, M)` cotiza varias partidas y suma IVA; su resultado trae también la lista de compras (`compras`), el precio mínimo y, si hay venta pactada, lo que deja (`totales.venta`). `require('./src/motor/gastos').resumen(resultado, gastos)` compara los gastos reales con lo cotizado. Una partida con datos inválidos devuelve sus errores (`{ ok: false, errores }`) sin tumbar a las demás, y `cotizar` no lanza aunque la cotización o sus partidas vengan mal formadas. `cotizarPartida` lanza `ErrorValidacion` con la lista de mensajes.

## Dónde se guardan los precios

Cada cambio en **Tablas maestras** (lista del proveedor, precios, tarifas, tiempos…) se guarda automáticamente, sin botón de guardar. Una línea bajo el título de la pestaña dice cómo va: *Guardando…*, *Guardado automáticamente a las 20:41*, o el aviso si algo falla.

| Dónde se abre | Dónde se guardan las tablas | Qué se mantiene al volver a abrir |
| --- | --- | --- |
| **Artefacto de Claude** | En el artefacto (documento `config/maestros`) y, como respaldo, en el navegador | Los precios, desde cualquier navegador o equipo, y también después de publicar versiones nuevas de la página |
| **Archivo suelto** (`dist/cotizap.html`, `src/web/index.html`) | Sólo en el navegador | Los precios, en ese mismo navegador |

- De las tablas sólo se guarda **lo que usted cambió**, no una copia completa; así, si cambian los valores de arranque (como pasó con la brida estándar), quien no tocó esa celda recibe el valor nuevo.
- En el artefacto los precios son **de todos los que lo abren**: sólo el propietario y los editores los cambian; quien sólo puede ver los ve bloqueados (*Sólo lectura*).
- Si una escritura falla, el cambio queda marcado como pendiente y se reintenta solo (hay un botón *Reintentar ahora*); si se cierra la página antes, se sube en la próxima apertura.
- Los precios capturados con la primera versión de la app (que los guardaba completos en el navegador) se recuperan una sola vez al abrir.
- La **cotización** (cliente, partidas, venta pactada y gastos reales) sigue guardándose sólo en el navegador; *Guardar y cargar* exporta e importa todo en JSON.

## Mano de obra y precios del proveedor

- **Mano de obra:** los trabajadores ganan **$500 por día, sin utilidades y ya con prestaciones** (FSR = 1.00). La semana paga 7 días por 5 de 8 h trabajadas ($3,500 por 40 h), así que **la hora trabajada cuesta $87.50**: salario por día × días pagados ÷ (días trabajados × horas por día) × FSR. El salario de cada operación y la jornada están en *Tablas maestras → Mano de obra y equipo* (el FSR queda por si algún día el salario se captura sin prestaciones).
- **Lista de precios del proveedor** (primer grupo de *Tablas maestras*): hojas y barras **por pieza y con IVA incluido**, tal como las cotiza el proveedor (lámina galvanizada 4 × 10 cal. 22 = $920, cal. 24 = $700, la factura del 30-sep-2026, etc.). El cotizador las convierte a **$/kg sin IVA** con los kg de la pieza y las usa para la lámina (mismo material y calibre) y para los aros (barra del perfil); lo que no está cotizado usa el precio por kg de respaldo. Cada renglón muestra su precio sin IVA, sus kg, su $/kg y si el cálculo lo usa; el desglose de cada partida dice de dónde salió el precio de su lámina y de sus aros.
- Quedan cuatro supuestos por confirmar con el proveedor (IVA incluido en sus precios, calibres sin cotizar, lámina por fracción de hoja, placa 3 × 8): [§10.6 del documento](docs/arquitectura-cotizador-ducterias.md#106-supuestos-de-la-lista-del-proveedor-por-confirmar). Las barras de ángulo y solera se consideran de 6 m.

## Parámetros de la cotización

El encabezado de la cotización lleva los parámetros comerciales que se ajustan al cotizar, para no ir a *Tablas maestras*:

| Parámetro | Qué cambia | De las tablas maestras |
| --- | --- | --- |
| Margen de utilidad (% del precio) | `P = costo base / (1 − margen − comisión)`; la nota dice a cuánto equivale sobre el costo | 20 % |
| Comisión de ventas (% del precio) | comisión que paga el precio | 2 % |
| Descuento al cliente (% del subtotal) | se resta del subtotal; el IVA va sobre el precio ya descontado; la nota dice hasta cuánto se puede bajar sin perder utilidad | 0 % |
| Días de cobro | costo del dinero y «crédito a N días» en la propuesta | 45 días |
| *Más parámetros:* administración (% del costo directo), financiamiento anual e IVA | indirectos, costo del dinero e IVA de los totales | 8 % · 14 % · 16 % |

- Valen **sólo para esa cotización**: un campo que se cambia queda marcado, dice cuál es el valor de las tablas y tiene *Restablecer*; un campo sin tocar sigue las ediciones de las tablas. Una cotización nueva arranca otra vez con los de las tablas.
- Los totales muestran el descuento, la **utilidad real** (en pesos y como % del precio, ya con el descuento) y el **costo total**, y avisan en rojo si el descuento deja el precio por debajo del piso (sin utilidad). La propuesta imprimible lleva el descuento y las condiciones de pago.
- Los parámetros viajan con la cotización al exportar e importar el JSON; un valor inválido de un archivo se ignora y se avisa. Cuatro supuestos quedan por confirmar: [§10.7 del documento](docs/arquitectura-cotizador-ducterias.md#107-supuestos-de-los-parámetros-de-la-cotización-por-confirmar).

## Compras y gastos del proyecto

La pestaña **Compras y gastos** nació de una hoja de control de gastos real: un proyecto que otro ingeniero vendió en **$45,710 más IVA** y que terminó con pocas pérdidas. La app lo trae como ejemplo (*Ver el ejemplo*) y el [documento lo resuelve en §7.4](docs/arquitectura-cotizador-ducterias.md#74-caso-real--la-hoja-de-control-de-gastos-del-6-oct-2026-vendido-en-45710-más-iva).

- **Venta y precio mínimo.** Capture la **venta pactada** (sin IVA) y una regla de tres zonas dice si **pierde** (no cubre el costo directo), si **cubre el costo directo pero no los indirectos**, o si **gana** (arriba del precio mínimo, que cubre indirectos, financiamiento y comisión con utilidad cero). Los totales de la cotización repiten el resultado.
- **Lista de compras en piezas enteras.** Junta lo que piden todas las partidas y lo redondea a lo que se compra: hojas y barras completas (los aros y las piezas de soportería se acomodan en barras de 6 m), tornillos por decena, cartuchos y envases enteros. Cada renglón dice cuánto se necesita, cuánto se compra, lo que ya cobran las partidas y el **sobrante**, que se puede **cobrar en la cotización** como una partida automática. Se copia como CSV.
- **Control de gastos.** Capture cada ticket o factura como viene: si el precio **trae IVA** y si hay **factura** (con factura el IVA se acredita y no es costo; sin factura sí lo es; la raya no lleva IVA). La lista de compras se puede usar como base: cada compra, la mano de obra y los viáticos llegan como renglones *estimado* para cambiar su precio por el real. La comparación por categoría (material, consumibles, mano de obra, compras a terceros, soportería, instalación, viáticos) dice en qué se gastó de más, y el resultado del proyecto da la utilidad **antes** y **después** de indirectos y el IVA acreditable.
- **Lo que había que corregir en la hoja.** Restó costos **con IVA** contra la venta **sin IVA** ($5,591.60 de IVA acreditable que no es costo) y puso la hora en $62.50 (3,500 ÷ 56 h) en vez de $87.50 (3,500 ÷ 40 h). Corregida: se gastaron **$43,347.47** sin IVA y la venta dejó **+$2,362.53 antes de indirectos** (5.2 %); con los indirectos ilustrativos de las tablas, el proyecto pierde $6,370.86 y le faltaron $6,703.08 para el precio mínimo.

## Datos que el cotizador no acepta

Todo dato pasa por una compuerta de validación (`src/motor/validacion.js`) antes de calcular; así un error de dedo o un archivo dañado produce un mensaje claro y no un precio absurdo:

- **Tipo:** los números son números (se acepta «12.5» escrito como texto); `NaN`, infinitos, listas o texto no numérico se rechazan. Un campo opcional vacío significa «automático».
- **Rango:** diámetros y lados de 25 a 6 000 mm, longitudes de 10 a 100 000 mm, espesor propio de 0.2 a 50 mm, cantidad de 1 a 100 000, hasta 1 000 anillos (yardas) por tramo. Son **política del taller** y se cambian en *Tablas maestras → Proceso de fabricación → limites* ([T10 y §10.8 del documento](docs/arquitectura-cotizador-ducterias.md#108-supuestos-de-los-límites-de-captura-por-confirmar)).
- **Pertenencia:** la familia, el material, el servicio, el tipo de unión… deben existir; no hay valores «desconocidos» que se tomen por otra cosa.
- **Tablas maestras sanas:** una eficiencia, una velocidad, un paso de tornillos o una densidad en 0, un valor negativo o una tabla de velocidades desordenada se señalan **por su ruta** («proceso › eficiencia taller: debe ser un número mayor que 0») en el aviso de la cotización y en cada partida afectada. El editor de tablas no deja teclear esos valores.
- **Datos guardados o importados:** de un archivo, del navegador o del almacén compartido sólo entra lo que tiene la forma esperada; se avisa cuántos valores se ignoraron y una importación rechazada no cambia nada.
- En el formulario de partida, un número que no se puede leer (por ejemplo «3O00» con la letra O) se marca como error en vez de tomarse por «automático».

Las reglas completas están en [§2.3 del documento](docs/arquitectura-cotizador-ducterias.md#23-reglas-de-validación) (V14–V20).

## Armado del tramo recto por yardas

El taller no rola un tramo de 3 m de una pieza: rola **yardas**, anillos del **ancho de la lámina** (914 mm = 3 ft ó 1 220 mm = 4 ft), y las **engargola** entre sí. El cotizador arma el tramo con la misma regla:

1. Primero **piezas de hasta 3 yardas** engargoladas, con **brida en ambos extremos**.
2. Con lo que falta, una última pieza: las yardas completas que sobren y un **tramo de ajuste** (menos de una yarda). Su extremo libre **no lleva brida de taller**: se corta y se pone en campo ajustando la distancia.

| Largo | Yarda | Armado | Anillos | Bridas de taller | Aros sueltos |
| --- | --- | --- | --- | --- | --- |
| 3 660 mm | 1 220 | 3 yardas (1 pieza) | 3 | 2 | 0 |
| 3 000 mm | 1 220 | 2 yardas + ajuste de 560 mm (1 pieza) | 3 | 1 | 1 |
| 10 000 mm | 1 220 | 2 × 3 yardas y 2 yardas + ajuste de 240 mm | 9 | 5 | 1 |

**Quién elige el ancho de la yarda.** Lo decide quien diseña (3 ft ó 4 ft): se elige **una vez en el encabezado de la cotización** y lo heredan todos los tramos rectos, o **por partida** (la partida manda). Si nadie elige, rige el de las tablas (1 220 mm).

**Qué se cotiza en el extremo libre del ajuste** (*Extremo del tramo de ajuste*, por partida; el predeterminado está en *Tablas maestras*):

| Opción | Qué cotiza | Ejemplo A (3 m, Ø12″) |
| --- | --- | --- |
| **Brida suelta** (predeterminada) | El taller manda el **aro terminado** (rolado, con el cierre soldado, barrenado y pintado), con sus **tornillos y empaque**, **sin soldarlo al ducto**: se suelda en obra. Se cobra su material y esas operaciones; no el armado al ducto, el filete aro–ducto ni el sellador de su junta | $2,366.22 |
| Sin brida | Nada: la brida de ese extremo no está en el precio | $2,176.74 |
| Brida de taller | Se fabrica y se suelda en taller, como en los demás extremos | $2,447.91 |

Cada yarda se **rola por separado** (tiempo fijo por anillo), las juntas entre yardas son **engargolado** (con sellador), cada plantilla de una yarda sale con un solo tajo a lo ancho de la hoja y el precio de la lámina se busca con ese ancho de hoja. El desglose muestra el armado con un diagrama (anillos, bridas de taller, el extremo libre y su aro suelto), la tabla de piezas y el aro suelto en los herrajes. Los parámetros están en *Tablas maestras → Proceso de fabricación → armado yardas*; el documento explica la regla ([§3.2](docs/arquitectura-cotizador-ducterias.md#32-tramo-recto-armado-por-yardas)), la brida suelta ([§3.5.7](docs/arquitectura-cotizador-ducterias.md#357-brida-suelta-extremo-libre-del-tramo-de-ajuste)) y sus supuestos por confirmar ([§10.9](docs/arquitectura-cotizador-ducterias.md#109-supuestos-del-armado-por-yardas-por-confirmar)). Una cotización guardada con la opción anterior (*sí/no* para la brida del ajuste) se convierte sola: *sí* = sin brida, *no* = brida de taller.

## Pintura según el material y la instalación

Lo que se pinta depende del **material**, y el sistema, de **dónde va instalado el ducto** (se elige en el encabezado de la cotización, *Instalación*, y cada partida puede traer la suya):

| Material | Ducto | Bridas |
| --- | --- | --- |
| **Acero al carbón** | Interior: **sólo pintura** (esmalte) · Exterior: **primario y pintura** | Igual que el ducto |
| **Lámina galvanizada** | **No se pinta** | Interior: sólo pintura · Exterior: primario y pintura |
| Acero inoxidable | No se pinta | No se pinta |

El ducto y las bridas se calculan por separado (superficie, manos, litros y tiempo); el aro suelto del tramo de ajuste se pinta como las demás bridas. Si una partida elige un sistema de pintura, vale para todo lo que se pinta. Qué sistema lleva cada material y la instalación por omisión (*interior*) están en *Tablas maestras*; el documento explica la regla ([§4.3](docs/arquitectura-cotizador-ducterias.md#43-consumibles)) y sus supuestos por confirmar ([§10.10](docs/arquitectura-cotizador-ducterias.md#1010-supuestos-de-la-pintura-por-confirmar)). Una cotización guardada sin instalación abre en interior.

## Tablas maestras con ayuda integrada

Cada dato, sección, tabla y grupo de *Tablas maestras* trae un botón **ⓘ** (con el cursor en un campo, `F1` hace lo mismo): una ventana que dice **qué es**, **cómo se llena** (unidad, de dónde sale, rango usual) y **qué esperar al cambiarlo**, con ejemplos y advertencias. Son 527 elementos explicados por un catálogo propio (`src/datos/ayuda_maestros.js`) y una prueba falla si se agrega un dato a las tablas sin su explicación.

Lo que depende de **su cotización** se calcula en vez de escribirse (se cotiza de nuevo con una copia de las tablas, sin tocar lo guardado):

- *Si baja o sube 10 %*: cuánto cambia el precio, con la flecha de cada sentido; o **pruebe otro valor** y vea el resultado antes de aplicarlo.
- En una lista de opciones (por ejemplo, el extremo del tramo de ajuste): **cuánto cuesta con cada una** y un botón *Usar*.
- En la lista del proveedor, los salarios o los precios: **ajustar todos de golpe** («el proveedor subió 6 %»).
- En un grupo o sección: **qué datos de ahí mueven más el precio**.

Además: cada renglón dice qué es en palabras y conserva el nombre de la variable; lo que antes se tecleaba como texto (a qué precio apunta un material, la tabla de calibres, el proceso de soldadura, el cordón, Sí/No) ahora **se elige de una lista**; lo modificado y lo que sale del rango usual se marca (*Sólo modificados* lo filtra); cada cambio deja una barra **«Último cambio»** con lo que movió el precio y un botón **Deshacer**; la **Guía rápida** explica cómo se arma un precio y en qué orden llenar las tablas; y **¿Qué mueve más mi precio?** sube cada dato 10 %, uno por uno, y ordena cuáles pesan. Cada grupo dice si sus valores son reales, de norma o ilustrativos. El documento lo describe en [§2.2.1](docs/arquitectura-cotizador-ducterias.md#221-ayuda-integrada-en-el-editor-de-tablas-maestras) y sus supuestos por confirmar en [§10.11](docs/arquitectura-cotizador-ducterias.md#1011-supuestos-de-la-ayuda-de-las-tablas-maestras-por-confirmar).

## Brida estándar del taller

Todos los ductos se unen con **bridas de solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼"**, sin importar el diámetro. Así viene precargado (perfil `SOL38x4.8` en `src/datos/maestros.js`): la solera se rola de canto, el barreno va al centro de su ancho y cada junta lleva múltiplo de 4 tornillos. Los ángulos siguen disponibles como opción por partida (*Perfil de aros*).

Cada aro se corta con las **puntas que la roladora no curva** (126 mm por aro, `proceso.aros.puntas_rolado_mm`): así el cálculo da la regla con que el taller corta la solera, π·(D + 81 mm), a menos de 1 mm.

Cinco detalles se **supusieron** y conviene confirmarlos con el taller (se editan en las tablas maestras): paso máximo entre barrenos (150 mm), posición del barreno (al centro de la solera), soldadura continua aro–ducto, empaque de neopreno 1½" × 1/8" y juego de tornillería (tornillo + tuerca + 2 rondanas). Ver [§10.4 del documento](docs/arquitectura-cotizador-ducterias.md#104-supuestos-del-estándar-de-bridas-por-confirmar-con-el-taller).

## Familias de pieza

| Familia | Geometría | Precisión |
| --- | --- | --- |
| Tramo recto (redondo y rectangular) | desarrollo con fibra neutra; **armado por yardas** (anillos del ancho de la lámina, 3 por pieza, con tramo de ajuste) | exacta |
| Codo de 30°, 45°, 60° o 90° (segmentado y de radio) | longitud de eje exacta; factor `tan(α/2)/(α/2)` | exacta (verificada con malla 3D) |
| Reducción (concéntrica y excéntrica) | tronco de cono, integral numérica | exacta (verificada con malla 3D) |
| Transición redondo → rectángulo | triangulación estándar | exacta (verificada con malla 3D) |
| Injerto simple, a 30° o 45° (antes ramal en ángulo) | promedio elíptico de la silleta | exacta (verificada) |
| Reducción con injerto, a 30° o 45° | el injerto va **sobre el cono** y siempre de extremo mayor a menor (inclinado hacia D2): la intersección cilindro–cono se resuelve numéricamente (silleta, orificio y soldadura); el largo de la reducción sale solo (el mínimo que aloja la silleta con 25 mm de holgura) o se captura | exacta (verificada contra cálculo independiente por fuerza bruta); merma y dificultad por calibrar |
| Personalizada | área desarrollada desde CAD | la que traiga el CAD |
| Bridas sueltas | sólo aros terminados (rolados, cerrados, barrenados y pintados) para el ducto de otro, sin lámina | la del aro de taller |
| Soportería | piezas cortadas de una barra de la lista (ménsulas, abrazaderas, postes), con anclajes del catálogo, tornillos y minutos de taller | — |
| Comprado | precio de compra o artículo del catálogo; un precio con IVA se cuesta sin IVA | — |
| Instalación | cuadrilla en obra (personas × días × horas a $87.50) y viáticos (casetas, gasolina, hospedaje, comidas, otros; con o sin factura) | — |

**Ángulos del taller.** Todo injerto (simple o en la reducción) es de **30° o 45°** y los codos son de **30°, 45°, 60° o 90°**. En la captura son listas desplegables; el motor además rechaza cualquier otro ángulo con un mensaje claro (una cotización anterior con un ángulo distinto se abre mostrándolo como *no permitido* hasta corregirlo). Las listas están en las tablas maestras (`proceso.angulos_injerto_deg`, `proceso.angulos_codo_deg`), no en el código.

## Estructura

```text
docs/arquitectura-cotizador-ducterias.md   especificación
src/
  datos/maestros.js                        tablas maestras (valores ilustrativos)
  datos/ayuda_maestros.js                  ayuda de cada dato de las tablas (qué es · cómo se llena · qué esperar)
  datos/ejemplos.js                        el proyecto real de la hoja de control de gastos (partidas y gastos)
  motor/                                   util · gastos · geometria · material · proveedor · mano_obra · consumibles · precios · validacion · compras · cotizador
  web/                                     index.html · app.js · almacen.js · maestros_ui.js · maestros_ayuda_ui.js · compras_ui.js · esquemas.js · dom.js · estilos.css
tests/                                     *.test.js (node:test) · e2e/ui.e2e.js (Playwright, opcional)
scripts/construir.js                       empaquetado a un solo HTML
```

## Límites conocidos

- Injertos y codos: seis detalles se **supusieron** y hay que confirmarlos con el taller (cómo se entiende «de extremo mayor a menor», que aquí es el injerto inclinado hacia D2; silleta centrada, holgura de 25 mm, largo del injerto, merma y dificultad, gajos del codo de 30°); están en [§10.5](docs/arquitectura-cotizador-ducterias.md#105-supuestos-de-injertos-y-codos-por-confirmar-con-el-taller) y cada uno se cambia en las tablas maestras o en la partida. El pantalón se retiró de la interfaz; el motor lo conserva sólo para abrir cotizaciones anteriores.
- Transiciones sólo centradas; ducto espiral, collarines y campanas se capturan como pieza *personalizada* o *comprada*.
- El anidado de hojas está descrito en el documento pero no implementado: la merma es un porcentaje por familia (editable por partida).
- Fuera de alcance: flete a obra, renta de andamios y grúas (se capturan como *otros gastos de obra* de la instalación o como comprado).
- La hoja de control de gastos dejó doce supuestos por confirmar (horas de las bridas, tornillos de las bridas chicas, empaque y pintura de las bridas, indirectos reales…): [§10.12](docs/arquitectura-cotizador-ducterias.md#1012-supuestos-de-la-hoja-de-control-de-gastos-por-confirmar).

La lista completa y el plan de calibración están en el [documento de arquitectura, §10](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos).
