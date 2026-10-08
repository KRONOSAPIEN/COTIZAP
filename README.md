# COTIZAP · Cotizador maestro de ducterías

Cotizador para ducterías de lámina (colección de polvo y control ambiental). Calcula el desarrollo geométrico de cada pieza, el peso con merma, los herrajes de unión, las horas de taller, los consumibles y la pila de precio completa: costo directo → indirectos → imprevistos → financiamiento → utilidad.

> ⚠ **Sólo son reales la mano de obra ($500 por día: $62.50 la hora, el salario del día ÷ 8 h), la lámina y los perfiles de la lista del proveedor (cotizaciones y factura del 30-sep-2026), los artículos del catálogo de compras (hoja de control de gastos del 6-oct-2026 y cotización del proveedor de corte del 2-oct-2026) y los tiempos de rolado y barrenado de las bridas (30 bridas en 4 días).** Los demás precios, tarifas, velocidades y tiempos (consumibles, equipo, indirectos, utilidad) son ILUSTRATIVOS: sirven para que todo funcione desde el primer minuto y como vector de prueba. Antes de cotizar a un cliente hay que sustituirlos por los reales (ver [Calibración](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos)). Ninguna fórmula contiene un precio: todas leen variables como `precio_m3_gas_argon` o la lista del proveedor, editables en la app.

## Qué incluye

| Pieza | Dónde | Qué es |
| --- | --- | --- |
| **Documento de arquitectura** | [`docs/arquitectura-cotizador-ducterias.md`](docs/arquitectura-cotizador-ducterias.md) | Insumos, fórmulas geométricas, mano de obra y consumibles, estructura de precios, lista de compras, venta pactada y control de gastos, pseudocódigo, ejemplos resueltos paso a paso y un proyecto real. Es la especificación. |
| **Motor de cálculo** | `src/motor/` | Funciones puras, sin dependencias. Separa *cantidades* de *precios*. |
| **Tablas maestras** | `src/datos/maestros.js` · `src/datos/ayuda_maestros.js` | Lista de precios del proveedor, catálogo de compras, materiales, calibres, perfiles, uniones, velocidades, tarifas, merma y capas de precio; y la ayuda de cada dato (qué es, cómo se llena, qué esperar). |
| **Aplicación web** | `src/web/` | Cotización rápida con el diámetro mayor y los metros, captura de partidas con su dibujo acotado en vivo, desglose paso a paso, planos de pedido imprimibles, compras y gastos del proyecto, editor de tablas maestras con ayuda integrada, propuesta imprimible. |
| **Pruebas** | `tests/` | Geometría contra mallas 3D independientes, ejemplo recalculado línea por línea, política de precios, robustez ante datos absurdos o dañados, dibujos acotados, interfaz de extremo a extremo. |

## Empezar

**Usar la app.** Abra `src/web/index.html` en el navegador (doble clic). No necesita servidor ni instalación; la cotización se guarda en el propio navegador y las tablas maestras se guardan solas cada vez que las cambia (ver [Dónde se guardan los precios](#dónde-se-guardan-los-precios)). Arranca con una cotización de ejemplo para explorar el cálculo. Las tipografías (Barlow, IBM Plex Mono) se piden a Google Fonts; sin conexión se usan las del sistema.

Las cinco pestañas van en el orden en que se trabaja:

| Pestaña | Para qué | Qué hace |
| --- | --- | --- |
| **Cotización rápida** | Dar un precio en minutos | Con el diámetro mayor y los metros hasta el punto más alejado: láminas enteras × 3, bridas por metros, mano de obra de los días, utilidad e IVA. Dibuja cómo salen las yardas de cada lámina y prepara el **texto para el cliente** (*Copiar texto* para WhatsApp o correo, *Imprimir*). [Ver abajo](#cotización-rápida). |
| **Cotización detallada** | El precio pieza por pieza | Arriba, los datos de la cotización: cliente, unidades, **ancho de la yarda**, **instalación** (decide la pintura) y, sólo para esta cotización, **margen, comisión, descuento y días de cobro** (más en *Más parámetros de precio*). Luego *Agregar partida*, elegir la familia y capturar medidas: el precio se recalcula mientras escribe. Al seleccionar una partida se ve su dibujo y su desglose. Aquí están *Nueva*, *Guardar y cargar* (JSON y CSV para Excel) e *Imprimir propuesta* (la hoja para el cliente, sin costos internos). |
| **Planos** | Mandar a fabricar | Cada pieza dibujada y acotada en hojas por tipo de pieza, con marcas y el cuadre de bridas. [Ver abajo](#planos-de-las-piezas). |
| **Compras y gastos** | Comprar y controlar | Lo que hay que comprar en piezas enteras, la venta pactada contra el precio mínimo y lo gastado contra lo cotizado. [Ver abajo](#compras-y-gastos-del-proyecto). |
| **Tablas maestras** | Poner los precios del taller | La lista del proveedor, precios, tarifas, tiempos y las reglas de la cotización rápida; cada dato con su ayuda (ⓘ). Se guardan solas. |

Los avisos de arriba (valores ilustrativos, cotización de ejemplo) sólo aparecen en las pestañas a las que aplican.

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

console.log(r.precio.unitario);            // 2725.29 MXN (hora a $62.50; una brida de taller, el aro suelto del extremo del ajuste, Sikaflex en la junta y pintura de interior)
console.log(r.peso.neto_total_kg);         // 37.923 kg (lámina + aro de brida + aro suelto)
console.log(r.pila);                       // CD, CI, imprevistos, financiamiento, utilidad…
console.log(r.qto);                        // cantidades físicas, sin precios
```

`cotizar({ riesgo, servicio, partidas, venta_pactada, venta_pactada_con_iva }, M)` cotiza varias partidas y suma IVA; su resultado trae también la lista de compras (`compras`), el precio mínimo y, si hay venta pactada, lo que deja (`totales.venta`). `require('./src/motor/gastos').resumen(resultado, gastos)` compara los gastos reales con lo cotizado. Una partida con datos inválidos devuelve sus errores (`{ ok: false, errores }`) sin tumbar a las demás, y `cotizar` no lanza aunque la cotización o sus partidas vengan mal formadas. `cotizarPartida` lanza `ErrorValidacion` con la lista de mensajes.

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

- **Mano de obra:** los trabajadores ganan **$500 por día** ($3,500 a la semana ÷ 7), **sin utilidades ni prestaciones**, y el taller cuesta la hora como **el salario del día ÷ 8 h = $62.50** (FSR = 1.00): salario por día ÷ horas por día × FSR. El salario de cada operación, la jornada (8 h) y el FSR están en *Tablas maestras → Mano de obra y equipo*. **Ojo:** la semana paga 7 días por 5 trabajados, así que cada hora trabajada cuesta $3,500 ÷ 40 h = $87.50 sin prestaciones; para cobrarlo, FSR = 7/5 = 1.40 ([§4.1](docs/arquitectura-cotizador-ducterias.md#41-tiempos-estándar-por-operación)).
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

## Cotización rápida

Para dar un precio en minutos, la pestaña **Cotización rápida** (*Rápida* en pantallas angostas) pide sólo el **diámetro máximo** y los **metros hasta el punto más alejado**, y aplica la regla del taller:

1. Cuenta las **hojas enteras** de lámina para esos metros a ese diámetro, con **yardas de 3 o 4 ft** (se elige). La plantilla de cada yarda es su largo por el perímetro más la holgura del engargolado; se acomodan en la hoja a lo ancho, a lo largo o mezcladas, lo que dé más. Con la galvanizada cal. 22 de 4 × 10 ft, cada hoja da 3 yardas de 11″.
2. Multiplica el costo de esas hojas (sin IVA, de la lista del proveedor) **por 3**.
3. Suma las **bridas según los metros**: hasta 40 m, $5,000; de 40 a 80 m, $12,000; de 80 a 120 m, $18,000.
4. Suma la **mano de obra de los días**: la fabricación de bridas, 1 persona a $500 por día; la instalación, 2 personas a $500 por día.
5. Suma, si los hay, los **otros costos** que el factor no cubre: **mangueras, soportería y viáticos**, que se capturan en pesos sin IVA.
6. Suma la **utilidad** sobre ese costo (20 % de arranque; se cambia en la pestaña) y luego el **IVA**.

Ejemplo: 11″ y 40 m con yardas de 4 ft son 33 yardas, 11 hojas ($8,724.14), × 3 = $26,172.41, más $5,000 de bridas, más 20 % y el IVA: **$43,392.00**. Con yardas de 3 ft son 44 yardas en 15 hojas galvanizadas de 3 × 10 ft: **$44,220.00**. Las galvanizadas de 3 × 10 ft y 3 × 8 ft traen un precio **aproximado** (prorrateado por área de la de 4 × 10: cal. 22 $690 y $552 con IVA): cámbielo por el real en la lista del proveedor. Sin elegir lámina, la app toma las del ancho de la yarda y usa **la que menos desperdicia** con ese diámetro.

**El desarrollo es el perímetro, no el diámetro.** La pestaña escribe el desarrollo de cada yarda (11″: π × 280.3 = 880 mm + 32 mm del engargolado = 912 mm). La nota del arreglo unifilar del 22-sep-2026 tomó 279 × 914 (el diámetro) y contó 8 yardas por lámina de 3 × 8 ft, 5 láminas para 31 m; en realidad salen 2 por lámina: 17 láminas de 3 × 8 ft o 12 de 3 × 10 ft. Con las láminas bien contadas, la lámina × 3 ($21,413.79) queda cerca de lo que cobró el proveedor por la ductería hecha ($18,965.52); la regla no cubre mangueras, soportería ni viáticos: para eso están los renglones opcionales *Otros costos*. El botón *Probar con el arreglo unifilar* carga esa obra; la comparación completa está en el [documento, §5.8.1](docs/arquitectura-cotizador-ducterias.md#581-revisión-con-el-arreglo-unifilar-del-22-sep-2026).

La pestaña **dibuja una lámina** a escala con sus yardas numeradas y el sobrante rayado, y una tira con todas las láminas y cuántas yardas lleva cada una; dice qué tanto se aprovecha la hoja. El recuadro **Para el cliente** arma el texto que se le manda (cliente u obra, ducto, qué incluye, precio con IVA, plazo y vigencia; sin el factor ni la utilidad): *Copiar texto* lo deja listo para WhatsApp o un correo, e *Imprimir* saca una hoja carta con eso (en el archivo `cotizap.html`; el visor de la app no imprime). Tiene además un apartado de **plazo y mano de obra**: los días de fabricación de bridas y de instalación se muestran junto al total y suman su mano de obra; los **otros costos** opcionales (mangueras, soportería y viáticos) suman al costo y se nombran en el texto del cliente. Con 11″ y 40 m, 5 días de bridas ($2,500) y 3 de instalación ($3,000): **$51,048.00**. La lámina se elige de la lista del proveedor. El factor, los rangos de bridas, la utilidad, las personas y el pago por día, y la lámina de arranque están en *Tablas maestras › Cotización rápida*. Más de 120 m no tiene precio de bridas: agregue un renglón. La regla y sus supuestos están en el [documento, §5.8](docs/arquitectura-cotizador-ducterias.md#58-cotización-rápida) y [§10.14](docs/arquitectura-cotizador-ducterias.md#1014-supuestos-de-la-cotización-rápida-por-confirmar).

## Compras y gastos del proyecto

La pestaña **Compras y gastos** nació de una hoja de control de gastos real: un proyecto que otro ingeniero vendió en **$45,710 con IVA** y que terminó con pérdidas. La app lo trae como ejemplo (*Ver el ejemplo*) y el [documento lo resuelve en §7.4](docs/arquitectura-cotizador-ducterias.md#74-caso-real--la-hoja-de-control-de-gastos-del-6-oct-2026-vendido-en-45710-con-iva).

- **Venta y precio mínimo.** Capture la **venta pactada** (sin IVA o, marcando *El importe ya incluye IVA*, con IVA: el margen se mide sin él) y una regla de tres zonas dice si **pierde** (no cubre el costo directo), si **cubre el costo directo pero no los indirectos**, o si **gana** (arriba del precio mínimo, que cubre indirectos, financiamiento y comisión con utilidad cero). Los totales de la cotización repiten el resultado.
- **Lista de compras en piezas enteras.** Junta lo que piden todas las partidas y lo redondea a lo que se compra: hojas y barras completas (los aros y las piezas de soportería se acomodan en barras de 6 m), tornillos por decena, cartuchos y envases enteros. Cada renglón dice cuánto se necesita, cuánto se compra, lo que ya cobran las partidas y el **sobrante**, que **siempre se cobra**: va en la cotización como una partida automática. Se copia como CSV.
- **Control de gastos.** Capture cada ticket o factura como viene: si el precio **trae IVA** y si hay **factura** (con factura el IVA se acredita y no es costo; sin factura sí lo es; la raya no lleva IVA). La lista de compras se puede usar como base: cada compra, la mano de obra y los viáticos llegan como renglones *estimado* para cambiar su precio por el real. La comparación por categoría (material, consumibles, mano de obra, compras a terceros, soportería, instalación, viáticos) dice en qué se gastó de más, y el resultado del proyecto da la utilidad **antes** y **después** de indirectos y el IVA acreditable.
- **Lo que había que corregir en la hoja.** Restó de la venta con IVA sus compras con IVA y la raya, que no lleva IVA: no descontó los **$713.23 de IVA neto** que se le pagan al SAT. Además pagó 2 días de bridas en vez de 4 y no traía los 2 días de las ménsulas ni el esmalte. Corregida: la venta es **$39,405.17** sin IVA, se gastaron **$43,277.47** y el proyecto **perdió $3,872.30 antes de indirectos** (−9.8 %), contra los −$829.06 de la hoja. La app compra lo mismo que el taller (6 soleras, 2 ángulos, 1 solera chica, 1 PTR, 28 taquetes, 220 juegos de tornillos y 2 Sikaflex) y lo cotizado queda 1 % arriba de lo gastado, porque cobra el sobrante de las piezas enteras.

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
| **Brida suelta** (predeterminada) | El taller manda el **aro terminado** (rolado, con el cierre soldado, barrenado y pintado), con sus **tornillos y el material de su junta**, **sin soldarlo al ducto**: se suelda en obra. Se cobra su material y esas operaciones; no el armado al ducto ni el filete aro–ducto | $2,703.81 |
| Sin brida | Nada: la brida de ese extremo no está en el precio | $2,308.94 |
| Brida de taller | Se fabrica y se suelda en taller, como en los demás extremos | $2,766.83 |

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

Todos los ductos se unen con **bridas de solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼"**, sin importar el diámetro. Así viene precargado (perfil `SOL38x4.8` en `src/datos/maestros.js`): la solera se rola de canto, el barreno va a 24 mm del borde interior del aro y cada brida lleva un número par de barrenos, al menos 6, a no más de 150 mm (8 en las de 11″ y 10″, 6 en las de 9″ y menores), como en los planos de pedido del taller. Los ángulos siguen disponibles como opción por partida (*Perfil de aros*).

En **galvanizado** nada se suelda, como lo hace el taller: las costuras, las juntas y el armado de piezas **se engargolan** (como las yardas entre sí) y las bridas **se meten y se le hace una ceja al ducto** para que no se salgan; luego se sellan con su otra pieza. Lo dicen dos datos de cada material en *Tablas maestras* (*Costura de la lámina* y *Cómo se fija la brida al ducto*), así que se puede cambiar sin tocar el código.

Cada aro se corta con las **puntas que la roladora no curva** (126 mm por aro, `proceso.aros.puntas_rolado_mm`): así el cálculo da la regla con que el taller corta la solera, π·(D + 81 mm), a menos de 1 mm.

La **junta** se sella con un **cordón de Sikaflex** sobre el círculo de barrenos (40 mL por metro), en lugar del empaque de neopreno; ese cordón también es el sello de la junta transversal. El empaque sigue disponible en las tablas (*junta* = `EMPAQUE`). Los tiempos de rolado y barrenado se calibraron con el taller: 30 bridas en 4 días.

Cuatro detalles se **supusieron** y conviene confirmarlos con el taller (se editan en las tablas maestras): paso máximo entre barrenos (150 mm), posición del barreno (al centro de la solera), soldadura continua aro–ducto y juego de tornillería (tornillo + tuerca + 2 rondanas). Ver [§10.4 del documento](docs/arquitectura-cotizador-ducterias.md#104-supuestos-del-estándar-de-bridas-por-confirmar-con-el-taller).

## Familias de pieza

| Familia | Geometría | Precisión |
| --- | --- | --- |
| Tramo recto (redondo y rectangular) | desarrollo con fibra neutra; **armado por yardas** (anillos del ancho de la lámina, 3 por pieza, con tramo de ajuste); «bridas en ambos extremos» o «brida en un extremo», como en los planos de yardas | exacta |
| Codo de 30°, 45°, 60° o 90° (segmentado y de radio) | longitud de eje exacta; factor `tan(α/2)/(α/2)` | exacta (verificada con malla 3D) |
| Reducción (concéntrica y excéntrica) | tronco de cono, integral numérica | exacta (verificada con malla 3D) |
| Transición redondo → rectángulo | triangulación estándar | exacta (verificada con malla 3D) |
| Injerto simple, a 30° o 45° (antes ramal en ángulo), también del mismo diámetro que el tronco («de 11″ a 11″ con injerto de 11″») | promedio elíptico de la silleta; su perímetro, sobre la curva real | exacta (verificada) |
| Reducción con injerto, a 30° o 45° | el injerto va **sobre el cono** y siempre de extremo mayor a menor (inclinado hacia D2): la intersección cilindro–cono se resuelve numéricamente (silleta, orificio y soldadura); el largo de la reducción sale solo (el mínimo que aloja la silleta con 25 mm de holgura) o se captura | exacta (verificada contra cálculo independiente por fuerza bruta); merma y dificultad por calibrar |
| Personalizada | área desarrollada desde CAD | la que traiga el CAD |
| Bridas sueltas | sólo aros terminados (rolados, cerrados, barrenados y pintados) para el ducto de otro, sin lámina | la del aro de taller |
| Armado de piezas | la unión entre dos piezas de otras partidas («unir injerto de 11″ con codo de 60° para obtener 90°»): una junta de armado por unión y, al perímetro exterior, un engargolado en galvanizado o un filete en los demás materiales | exacta (recalculada a mano) |
| Soportería | piezas cortadas de una barra de la lista (ménsulas, abrazaderas —por el diámetro del ducto—, postes), con anclajes del catálogo, tornillos y minutos reales de taller; la **cantidad sale sola del ducto** (uno cada 2.5 m o uno por junta en lo horizontal, cada 3.0 m en lo vertical y uno junto a cada codo e injerto) o se captura a mano; abrazaderas tipo cuna de media vuelta o de vuelta completa (360°) | — |
| Comprado | precio de compra o artículo del catálogo; un precio con IVA se cuesta sin IVA; lo que se atornilla como brida (las bridas de placa del proveedor de corte) lleva su tornillería y su Sikaflex | — |
| Instalación | cuadrilla en obra (personas × días × horas a $62.50) y viáticos (casetas, gasolina, hospedaje, comidas, otros; con o sin factura) | — |

**Ángulos del taller.** Todo injerto (simple o en la reducción) es de **30° o 45°** y los codos son de **30°, 45°, 60° o 90°**. En la captura son listas desplegables; el motor además rechaza cualquier otro ángulo con un mensaje claro (una cotización anterior con un ángulo distinto se abre mostrándolo como *no permitido* hasta corregirlo). Las listas están en las tablas maestras (`proceso.angulos_injerto_deg`, `proceso.angulos_codo_deg`), no en el código.

## Planos de las piezas

Cada partida se dibuja **acotada, como en los planos de pedido del taller** (los de AutoCAD con que se mandan a fabricar bridas, codos, reducciones, yardas y el armado de piezas):

- **Al capturar**, el dibujo se rehace con cada dato; la cota del campo en que está el cursor se resalta, y pulsar una cota lleva a su campo. Cada pieza dice qué extremos van **sin brida** (casillas: se unen a otra pieza o a una manguera) y si sus bridas son **de otra partida** (aquí sólo se arman y se sueldan al ducto). Sin descripción, la partida se llama como en los planos: «Reducción de 11″ a 10″ con injerto de 5″ a 30°», «Codo 90° Ø5″ · 5 gajos», «Brida de 9″».
- **En la lista**, cada pieza trae su miniatura; **en el desglose**, su plano grande con sus datos (D, R, gajos, Dint/Dperf/Dext, barrenos…).
- **La pestaña Planos** arma las hojas de pedido: una por tipo de pieza y, en las de lámina, por material y calibre («CODOS / ACERO GALVANIZADO · CAL. 24»), cada pieza con su marca (B1, C1, I1…), cuántas piezas son, su dibujo y sus datos, y un cajetín con proyecto, fecha y número de hoja. **Imprimir planos** las imprime solas, una por página carta horizontal.
- **Los ductos rectos** van en una hoja por diámetro, como los planos de yardas («DUCTOS DE 11″ · 18 yardas»): cada pieza con sus yardas acotadas («3 yardas unidas», «2 yardas unidas + 600 mm de ajuste») y sus bridas dibujadas donde van («bridas en ambos extremos», «brida en un extremo»). Al final, la hoja de **armado de piezas**.
- **Cuadre de bridas.** Si las bridas de las piezas son «de otra partida» (las hace el taller en una partida de Bridas sueltas o son de placa compradas), la pestaña cuenta, por diámetro, cuántas piden las piezas —sin los extremos que se unen a otra pieza o a una manguera— contra las que hay en las partidas de bridas, y dice cuántas faltan o sobran.
- **Ver el ejemplo: pedido del 30-sep-2026** abre el pedido completo de los planos del taller (7 codos, 9 reducciones con injerto e injertos, 20 ductos rectos en yardas, 6 armados y 60 bridas: 36 partidas) para verlo dibujado, cuadrado y costeado; el documento compara hacerlo en el taller contra lo que cobró el proveedor —$22,000 con IVA, en cal. 22— ([§7.5](docs/arquitectura-cotizador-ducterias.md#75-caso-real--el-pedido-de-ductería-completo-fabricar-o-comprar)).

Los dibujos salen de `src/web/planos.js` (funciones puras, probadas en `tests/planos.test.js`); lo que difiere de los planos del taller está en [§10.13](docs/arquitectura-cotizador-ducterias.md#1013-diferencias-con-los-planos-de-pedido-por-confirmar) y el detalle en [§8.5](docs/arquitectura-cotizador-ducterias.md#85-dibujos-acotados-y-planos-de-pedido).

## Estructura

```text
docs/arquitectura-cotizador-ducterias.md   especificación
src/
  datos/maestros.js                        tablas maestras (valores ilustrativos)
  datos/ayuda_maestros.js                  ayuda de cada dato de las tablas (qué es · cómo se llena · qué esperar)
  datos/ejemplos.js                        el proyecto real de la hoja de control de gastos y el pedido de ductería del 30-sep-2026
  motor/                                   util · gastos · geometria · material · proveedor · mano_obra · consumibles · precios · validacion · compras · cotizador · rapida
  web/                                     index.html · app.js · almacen.js · maestros_ui.js · maestros_ayuda_ui.js · compras_ui.js · planos.js · planos_ui.js · rapida_ui.js · esquemas.js · dom.js · estilos.css
tests/                                     *.test.js (node:test) · e2e/ui.e2e.js (Playwright, opcional)
scripts/construir.js                       empaquetado a un solo HTML
```

## Límites conocidos

- Injertos y codos: seis detalles se **supusieron** y hay que confirmarlos con el taller (cómo se entiende «de extremo mayor a menor», que aquí es el injerto inclinado hacia D2; silleta centrada, holgura de 25 mm, largo del injerto, merma y dificultad, gajos del codo de 30°); están en [§10.5](docs/arquitectura-cotizador-ducterias.md#105-supuestos-de-injertos-y-codos-por-confirmar-con-el-taller) y cada uno se cambia en las tablas maestras o en la partida. El pantalón se retiró de la interfaz; el motor lo conserva sólo para abrir cotizaciones anteriores.
- Transiciones sólo centradas; ducto espiral, collarines y campanas se capturan como pieza *personalizada* o *comprada*.
- El anidado de hojas está descrito en el documento pero no implementado: la merma es un porcentaje por familia (editable por partida).
- Fuera de alcance: flete a obra, renta de andamios y grúas (se capturan como *otros gastos de obra* de la instalación o como comprado).
- La hoja de control de gastos deja supuestos por confirmar (la hora sin días de descanso ni prestaciones, los barrenos de las bridas de placa, el largo de la ménsula, la abrazadera, el cordón de Sikaflex, el viaje a México, los indirectos reales…): [§10.12](docs/arquitectura-cotizador-ducterias.md#1012-supuestos-de-la-hoja-de-control-de-gastos-por-confirmar).

La lista completa y el plan de calibración están en el [documento de arquitectura, §10](docs/arquitectura-cotizador-ducterias.md#10-calibración-límites-conocidos-y-siguientes-pasos).
