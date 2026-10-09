# Dibujar el unifilar: un CAD sencillo para armar la ductería con trazos

> **Documento de diseño y de uso · COTIZAP · 9-oct-2026.** Para quien cotiza en el taller y para quien mantenga el código.
> El modelo y sus reglas están en [`src/motor/unifilar_cad.js`](../src/motor/unifilar_cad.js); el tablero, en [`src/web/unifilar_cad_ui.js`](../src/web/unifilar_cad_ui.js). Lo prueban [`tests/unifilar_cad.test.js`](../tests/unifilar_cad.test.js), [`tests/unifilar_contrato.test.js`](../tests/unifilar_contrato.test.js) (el despiece del dibujo cumple el [esquema](unifilar-bom.schema.json)) y la sección 34 de [`tests/e2e/ui.e2e.js`](../tests/e2e/ui.e2e.js).

## Índice

1. [Para qué](#1-para-qué)
2. [Cómo se usa](#2-cómo-se-usa)
3. [El modelo del dibujo](#3-el-modelo-del-dibujo)
4. [Las reglas del taller al trazar](#4-las-reglas-del-taller-al-trazar)
5. [Revisar antes de convertir](#5-revisar-antes-de-convertir)
6. [Del dibujo a la lectura](#6-del-dibujo-a-la-lectura)
7. [Lo que hacen después las reglas del unifilar](#7-lo-que-hacen-después-las-reglas-del-unifilar)
8. [Guardado, edición y reemplazo](#8-guardado-edición-y-reemplazo)
9. [Qué se prueba](#9-qué-se-prueba)
10. [Límites](#10-límites)

---

## 1. Para qué

Leer un croquis a mano (la foto o su lectura en JSON, [docs/vision-unifilares.md](vision-unifilares.md)) deja dudas: una cota ilegible, una T dibujada a 90°, un trazo vertical que puede ser una bajada o una diagonal. El **dibujo** es el otro camino: el ingeniero arma la red en el tablero con trazos sencillos, como en un juego, y el tablero sólo deja hacer lo que el taller fabrica. Como cada dato lo puso él, la lectura que sale del dibujo no tiene nada leído con duda.

Al dar **«Listo»** el dibujo pasa por **las mismas reglas** que un croquis leído ([`src/motor/unifilar.js`](../src/motor/unifilar.js)): tramos rectos netos, codos, reducciones, injertos simples, reducciones con injerto, uniones, juntas, ménsulas con sus abrazaderas y mangueras, y esas piezas se agregan a la cotización como partidas. No hay un segundo motor de despiece: el dibujo es una lectura con certeza.

## 2. Cómo se usa

**Cotización detallada → Dibujar unifilar** (o dentro de **Importar unifilar**, la sección «Dibujar el unifilar»). El tablero empieza con el colector (`COL`) en el centro.

### 2.1 Herramientas: las familias del cotizador

| Herramienta | Tecla | Familia | Gesto | Qué hace |
| --- | --- | --- | --- | --- |
| **Tramo recto** | T | Tramo recto | Arrastrar desde un punto o desde la mitad de un tramo | Un tramo del Ø del trazo. Si da vuelta, sale un codo (30°, 45°, 60° o 90°); desde la mitad de un tramo, un injerto (30° o 45°). Recto y del mismo Ø, alarga el tramo. |
| **Codo** | C | Codo | Arrastrar desde el final de un tramo; tocar un codo | Sólo da vuelta (no sigue recto). Tocado un codo, el panel deja cambiar su ángulo y su lado. |
| **Sube o baja** | V | Tramo recto vertical | Arrastrar hacia arriba o hacia abajo desde un punto | Un tramo vertical; si venía horizontal, con codo de 90°. |
| **Injerto simple** | I | Injerto simple | Arrastrar desde la mitad de un tramo horizontal (o desde un punto donde el tronco sigue recto) | Un ramal a 30° o 45°, a favor del flujo, del Ø del trazo (no mayor que el tronco). |
| **Reducción** | R | Reducción | Tocar un tramo | De ese punto en adelante el tramo queda del Ø del trazo (menor). Tocado cerca de su inicio (a menos de 15 cm), cambia todo el tramo. |
| **Reducción con injerto** | J | Reducción con injerto | Arrastrar desde la mitad de un tramo | El injerto del Ø del trazo y el tronco sigue reducido al Ø de «tronco después». |
| **Equipo** | E | — | Tocar el final de un ramal | Pone el equipo elegido en la lista de al lado: máquina con manguera, máquina con brida, campana o extremo abierto. |
| **Seleccionar** | S | — | Tocar un tramo o un punto; arrastrar el fondo | Muestra y deja cambiar sus medidas en el panel; arrastrar el fondo mueve el dibujo. |
| **Borrar** | B | — | Tocar un tramo o un equipo | Quita el tramo con todo lo que sigue después (tramos y equipos), o sólo el equipo. |

Cada herramienta muestra cuántas piezas de su familia hay en el dibujo (las cuentan las reglas del unifilar, no el tablero). Los equipos llevan su nombre automático («Máquina 1», «Campana 1») que se cambia en el panel.

### 2.2 El trazo se ajusta solo

Mientras se arrastra, una línea punteada muestra el tramo con su ancho real y un letrero dice qué saldría: **«2.50 m · 10″ · codo de 45° a la izquierda»**. El trazo toma la dirección permitida más cercana al puntero y el largo en pasos de **0.1 m** (a ejes); el punto de un injerto o una reducción, en pasos de 5 cm. Si desde ahí no se puede, el letrero lo dice en rojo y al soltar no pasa nada. Las medidas exactas se escriben en el panel.

Si el Ø del trazo es mayor que lo que permite ese punto (el tramo anterior o el tronco), se usa el mayor permitido y el letrero lo avisa: «(no puede ser mayor que 10″)».

### 2.3 Moverse por el tablero

- **Vista:** **Isométrico** (x a 30° a la derecha, y a 150°, la vertical hacia arriba, como los croquis del taller) o **Planta** (desde arriba; una vertical se ve como un círculo con «↑ 3 m»). La cuadrícula del piso se ajusta al acercamiento (0.5 m, 1 m, 2 m…).
- **Mover:** arrastrar el fondo (o con el botón de en medio del ratón); flechas del teclado.
- **Acercar:** rueda del ratón, dos dedos, los botones − y +, o las teclas + y −; **0** encuadra todo el dibujo.
- **Deshacer y rehacer:** Ctrl+Z y Ctrl+Y (o Ctrl+Mayús+Z), o los botones del pie (hasta 100 pasos; se conservan si se cierra y se vuelve a abrir el diálogo sin cambiar el dibujo).
- **Esc** cancela un trazo a medias o quita la selección; **Supr** borra lo seleccionado.

### 2.4 El panel

- **Material y calibre** de todo el dibujo (de las tablas maestras). **Seleccionar** lista todos los puntos y tramos: con eso todo se puede hacer con el teclado.
- **Un tramo seleccionado:** su dirección (horizontal con su rumbo o vertical), su **Ø** (sólo hasta lo permitido), su **largo a ejes** y lo que dicen las reglas: «Tramo recto DUCT-002: 6.25 m a ejes − 0.46 m (CODO-001) − 0.40 m (INJ-001) = 5.39 m netos; 2 piezas de hasta 3 yardas con ajuste de 513 mm; horizontal». Formularios para **injertar** (a cuántos m del inicio, ángulo, lado, Ø, largo y si el tronco sigue igual o reducido) y para **reducir** en ese tramo, y el botón para borrarlo con lo que sigue.
- **Un punto seleccionado:** dónde está (distancia en planta al colector y altura respecto de su boca), las piezas que le tocaron («Reducción con injerto de 12″ a 10″, injerto de 6″ a 45° · RINJ-001»), el **ángulo** del codo o del injerto (cambiarlo gira todo lo que sigue), el equipo del extremo con sus datos (nombre, **boca** del colector o de la máquina con brida, **tramos de manguera**) y el formulario **«Agregar un tramo desde aquí»** con las direcciones permitidas en ese punto, el largo y el Ø.
- **Por resolver:** los errores del dibujo, los avisos y lo que las reglas del unifilar van a preguntar. Tocar uno selecciona el elemento.
- **Lo que sale del dibujo:** el estado del despiece (definitivo, preliminar o no cotizable) y cuántas preguntas tendrá, los tramos rectos con sus metros netos, codos, reducciones, injertos, reducciones con injerto, armados de piezas, ménsulas, abrazaderas, mangueras, juntas con sus aros y tornillos, el número de partidas y el **costo directo** (sin margen, comisión ni IVA). Todo se recalcula a cada cambio con las reglas del unifilar.
- **Nuevo dibujo** (sólo el colector, con deshacer) y **Probar con el ejemplo** (el croquis de ejemplo de [docs/vision-unifilares.md](vision-unifilares.md) §11, dibujado).

### 2.5 «Listo: convertir en piezas»

Si el dibujo tiene un error (§5), lo dice y selecciona dónde está. Si no, lo convierte en lectura (§6), corre las reglas y:

- sin partidas del unifilar en la cotización, **las agrega de una vez** y muestra la revisión con las preguntas que queden («Se agregaron 18 partidas a la cotización. Responda la pregunta para afinarlas: al contestar, las partidas se actualizan solas»);
- si ya hay partidas del unifilar (de antes), muestra el despiece nuevo con **«Reemplazar con N partidas»**: no toca las de la cotización hasta que se pide;
- si algo bloquea (por ejemplo, accesorios que no caben en un tramo), muestra la pregunta que lo resuelve y no agrega nada.

En la revisión, **«Editar el dibujo»** regresa al tablero.

## 3. El modelo del dibujo

Un árbol que crece desde el colector. Los nodos no se guardan con posición: la posición de cada uno sale de los tramos que llevan a él, así que **cambiar un largo o un ángulo mueve todo lo que está más allá** y nunca se acumulan errores de redondeo.

```json
{
  "version": 1,
  "colector": { "x": 0, "y": 0, "z": 0 },
  "tramos": [
    { "id": "A-001", "de": "N-001", "a": "N-002", "D_in": 12, "largo_mm": 3000, "dir": "SUBE", "az_deg": 0, "encimado": null, "corto": false },
    { "id": "A-002", "de": "N-002", "a": "N-003", "D_in": 12, "largo_mm": 4500, "dir": "H", "az_deg": 0, "encimado": null, "corto": false }
  ],
  "equipos": [
    { "id": "EQ-01", "clase": "COLECTOR", "nombre": "Colector", "nodo": "N-001", "boca_in": 12, "manguera_tramos": null },
    { "id": "EQ-02", "clase": "MAQUINA_MANGUERA", "nombre": "Máquina 1", "nodo": "N-005", "boca_in": null, "manguera_tramos": 1 }
  ],
  "material": "GALVANIZADO", "calibre": 22,
  "cuenta": { "N": 9, "A": 8, "EQ": 4 }
}
```

| Campo | Qué es |
| --- | --- |
| `colector` | Dónde está la boca del colector, en mm (x al este, y al norte, z hacia arriba). Es la raíz del árbol. |
| `tramos[].de`, `.a` | El punto del lado del colector y el del otro lado: **el flujo de aire va de `a` a `de`**. |
| `tramos[].D_in` | Diámetro en pulgadas, de la lista comercial (3″ a 24″). |
| `tramos[].largo_mm` | Largo **a ejes** (de centro de pieza a centro de pieza), entero, de 100 mm a 100 m. |
| `tramos[].dir`, `.az_deg` | `H` horizontal con su **rumbo** en planta (múltiplo de 15°, contra las manecillas desde el eje x), o `SUBE` / `BAJA`. |
| `tramos[].encimado`, `.corto` | Decisiones de la revisión (§7): pegar dos accesorios sin tramo entre ellos (`UNION`) o fabricar el tramo corto (`TRAMO`); tramo corto aceptado. |
| `equipos[].clase` | `COLECTOR` (uno, en la raíz), `MAQUINA_MANGUERA`, `MAQUINA_BRIDA`, `CAMPANA` o `ABIERTO`. |
| `equipos[].boca_in` | La boca del colector o de la máquina con brida; `null` = se pregunta al revisar. |
| `equipos[].manguera_tramos` | Tramos de manguera de una máquina con manguera (1 por omisión). |
| `cuenta` | El último número usado de cada identificador: **nunca se repite** uno (las respuestas de la revisión van por identificador). |

Los identificadores son los de la lectura: `N-###` y `A-###` (hasta 4 cifras), `EQ-##` (hasta 3). Al alargar un tramo, partirlo o volver a juntarlo, **el tramo del lado del colector conserva su identificador**.

## 4. Las reglas del taller al trazar

Toda operación es pura (devuelve un modelo nuevo) y, si no se puede, rechaza con el porqué (`CadError`) y no cambia nada.

| Regla | De dónde sale | Si no se cumple, dice |
| --- | --- | --- |
| Del colector sale **un** tramo: tiene una sola boca. | Diseño | «El colector tiene una sola boca: para otra derivación, injerte en un tramo.» |
| Un **equipo es el final de su ramal**; los equipos van en extremos. | Diseño | ««Máquina 1» es el final de su ramal: quite el equipo para seguir el ducto.» · «N-005 no es un extremo…» |
| Rumbos en planta, múltiplos de **15°**. | `PASO_RUMBO` | — (el trazo se ajusta) |
| Al final de un tramo horizontal: **recto**, **codo** a `proceso.angulos_codo_deg` (hoy 30°, 45°, 60°, 90°) a cualquier lado, o **sube/baja** (codo de 90°). | Tablas maestras | «Desde N-004 el ducto puede seguir recto, dar vuelta a 30°, 45°, 60° o 90°, subir o bajar.» |
| Al final de un tramo vertical: sigue igual, o **sale en horizontal a cualquier rumbo** (codo de 90°). Nunca media vuelta. | Geometría | «… salir en horizontal a cualquier rumbo (codo de 90°) o bajar.» |
| **Injerto:** sólo sobre un **tronco recto horizontal**, a `proceso.angulos_injerto_deg` (hoy 30° o 45°) del tronco, **a favor del flujo**. | Tablas maestras | «El injerto va a 30° o 45° del tronco, a favor del flujo (alejándose del colector).» |
| En un punto donde el tronco sigue recto se injerta; en un **codo de 30° o 45°** sólo se puede seguir recto (lo que salía queda como injerto); en otro codo o donde ya hay un injerto, no. | Taller | «En N-002 hay un codo de 60°: no se injerta en un codo…» · «En N-005 ya hay un injerto: cada injerto va en su propio punto del tronco.» |
| Diámetros **comerciales**. | `COMERCIALES_IN` | «El diámetro debe ser comercial: 3″, 4″, … o 24″.» |
| Alejándose del colector **el diámetro no crece**; **un injerto no es mayor que su tronco** (sí puede ser igual: silleta). | Colección de polvo | «Alejándose del colector el diámetro no crece: el tramo A-002 es de 12″.» · «Un injerto no puede ser mayor que su tronco…» |
| Reducir un tramo **reduce lo que sigue** y los ramales que quedarían mayores que su tronco; el mensaje dice cuáles. | Colección de polvo | «También quedaron de 8″: A-003, A-004.» |
| Largos de **0.1 m a 100 m** (lo más largo que el motor cotiza en una partida); un injerto o una reducción a **0.1 m o más** de los extremos del tramo. | `LARGO_MIN_MM`, motor | «El largo de un tramo va de 0.1 m a 100 m.» |
| Dos tramos seguidos, **rectos y del mismo Ø, son uno** (si no pasan de 100 m): el de antes se alarga y el punto de en medio desaparece. | Diseño | — |
| Topes: 500 tramos, 300 equipos. | Diseño | «El dibujo llegó a 500 tramos.» |

**A favor del flujo.** En un injerto el aire del ramal entra al tronco y sigue hacia el colector. Con las direcciones medidas desde el punto del injerto alejándose del colector, el ramal forma con la continuación del tronco el ángulo β del injerto (30° o 45°); un ramal a más de 90° de esa continuación entraría contra el flujo, y el tablero no lo ofrece.

## 5. Revisar antes de convertir

`revisar(modelo, M)` da **errores** (no se convierte hasta resolverlos) y **avisos**. Un dibujo hecho en el tablero no puede tener errores de giro ni de injerto; un dibujo que llega de fuera (otra versión, un archivo editado) sí.

| Código | Tipo | Cuándo |
| --- | --- | --- |
| `SIN_TRAMOS` | Error | No hay ductos. |
| `COLECTOR_UNA_BOCA` | Error | Del colector sale más de un tramo. |
| `GIRO_NO_PERMITIDO` | Error | Un codo a un ángulo que el taller no hace, o media vuelta. |
| `INJERTO_NO_PERMITIDO` | Error | Una derivación sin tronco recto, en vertical o a un ángulo que no es de injerto. |
| `CRUCE` | Error | Tres o más tramos salen del mismo punto. |
| `DIAMETRO_CRECE` · `INJERTO_MAYOR` | Error | El diámetro crece alejándose del colector, o un injerto es mayor que su tronco. |
| `EXTREMO_SIN_EQUIPO` | Aviso | Un extremo sin máquina, campana ni «extremo abierto»: al revisar se pregunta si se deja abierto. |
| `CHOQUE` | Aviso | Los ejes de dos tramos que no se tocan pasan más cerca que la suma de sus radios (con su distancia y la necesaria): «Los tramos A-002 y A-004 se cruzan: sus ejes pasan a 0 mm y necesitan 254 mm». A otra altura no chocan. |

Además el panel muestra, mientras se dibuja, lo que las reglas del unifilar dirán en la revisión (§7).

## 6. Del dibujo a la lectura

`aLectura(modelo, M, { yarda_mm, fecha })` da `{ lectura, respuestas }`; la lectura cumple [docs/unifilar-bom.schema.json](unifilar-bom.schema.json) y ya pasó por `leer`.

| Del dibujo | En la lectura |
| --- | --- |
| Cada punto | Un nodo con su posición en la hoja: la proyección **isométrica** del punto a 1 px por cm (con margen), su tipo (extremo, vértice, unión colineal o derivación) y confianza 1. |
| Cada tramo | Una arista con el mismo identificador, `nodo_a` del lado del colector, **`eje_iso`** `X` (rumbo 0° o 180°), `Y` (90° o 270°), `Z` (vertical) o `NINGUNO` (diagonal), su orientación en la hoja, y **diámetro y cota de origen `USUARIO` con confianza 1**. |
| Cada codo y cada injerto | Un texto `ANGULO` asociado a su nodo, con el ángulo exacto del dibujo, confianza 1 y **`origen: USUARIO`**: las reglas usan ese ángulo y el accesorio sale con `angulo.origen = USUARIO`. |
| Cada equipo | Un equipo con su tipo y su conexión: colector y máquina con brida → `BRIDA_EQUIPO` (con su boca, `USUARIO`, si se dio); máquina con manguera → `MANGUERA`; campana → `BRIDA_TALLER`; extremo abierto → `OTRO` con `LISO`. |
| Material y calibre | `metadatos.material` y `metadatos.calibre` de origen `USUARIO`. |
| — | `vista: ISOMETRICO`, `convencion_cotas: EJES`, `fuente.archivo: "dibujo"` (así la revisión sabe que salió del dibujo y ofrece «Editar el dibujo»), `flujo_hacia` = el colector, sin cotas totales ni alertas de lectura. |
| La yarda | La de la cotización (o la de las tablas si la cotización no elige): 1 220 mm o 914.4 mm. |
| Tramos de manguera, encimados, tramo corto | Van como **respuestas** (`manguera_tramos`, `encimado`, `aceptado`), que la revisión muestra como respondidas. |

**Por qué isométrico y con los ángulos anotados.** Las reglas del unifilar, para un croquis, deducen el ángulo de un codo de los ejes del isométrico o lo miden en planta, y un trazo vertical en la hoja puede ser una bajada o una diagonal. Con el ángulo anotado (seguro, del ingeniero) y el eje Z sólo en las verticales de verdad, **las reglas nunca adivinan**: el tronco de cada injerto es el tramo que sigue recto (exactamente colineal también en la proyección), y entre dos tramos sobre los ejes el ángulo siempre es 90°, así que la ambigüedad de orientación del croquis no aparece.

## 7. Lo que hacen después las reglas del unifilar

Las de siempre ([docs/vision-unifilares.md](vision-unifilares.md) §5 a §7): la pieza de cada nodo (codo, reducción insertada donde cambia el Ø, injerto simple si el tronco sigue del mismo Ø o reducción con injerto si se reduce), la reducción a la boca de un equipo que no es del Ø del ducto, lo que ocupa cada accesorio en sus tramos, el armado por yardas, las juntas, las ménsulas con sus abrazaderas y las compras. Con un dibujo **nunca** preguntan por lo leído (Ø, cotas, ángulos, orientación, pantalones, contra flujo, reducciones grandes, material o calibre faltantes). Lo que sí pueden preguntar o avisar:

| Alerta | Cuándo | Su respuesta pasa al dibujo como |
| --- | --- | --- |
| `CONEXION_EQUIPO` | La boca del colector o de una máquina con brida no se dio (se pregunta); si se dio, se avisa que se confirme el patrón de barrenos. | `boca_in` del equipo |
| `MANGUERA_SIN_LARGO` | Una máquina con manguera sin tramos (se cuenta uno), o una manguera de un Ø que no está en el catálogo de compras (no se cotiza). | `manguera_tramos` |
| `TRAZO_SIN_CONECTAR` | Un extremo sin equipo: «¿Se deja abierto?». | un «extremo abierto» en ese punto |
| `ACCESORIOS_ENCIMADOS` | Entre dos accesorios quedan menos de 150 mm de tramo recto: pegarlos (armado de piezas) o fabricar el tramo corto; o los accesorios no caben en la cota (bloquea). | `encimado` o `corto` del tramo; una cota corregida, `largo_mm` |
| `CALIBRE_BAJO_TABLA` | El calibre es más delgado que el que pide la tabla de servicio para esos diámetros. | `calibre` del dibujo |

Al volver a **«Editar el dibujo»**, `aplicarRespuestas` pasa esas respuestas al modelo (también un Ø o una cota corregidos, si se permiten); los ángulos y la posición los decide siempre el dibujo. Así, al dar «Listo» otra vez, nada de lo respondido se pierde.

**El ejemplo dibujado.** El croquis de ejemplo de [docs/vision-unifilares.md](vision-unifilares.md) §11, dibujado con «Probar con el ejemplo» (subida de 12″ de 3 m, tronco de 12″ de 4.5 m, reducción con injerto a 10″ con ramal de 6″ a 45° a la máquina A, injerto de 5″ a 45° a la máquina B 3.6 m más adelante, reducción a 8″ 2 m después, tronco de 8″ de 2.5 m y codo de 45° con 1.5 m a la campana), da **las mismas 22 partidas** que leer el croquis con la cota ilegible respondida a 1.2 m, y el mismo costo directo con la misma yarda ($20,350.61 a 914.4 mm). Sale **definitivo**: sólo queda el aviso de los barrenos de la boca del colector.

## 8. Guardado, edición y reemplazo

- El dibujo se guarda **con la cotización** (`estado.cot.dibujo_unifilar`) a cada cambio, en el navegador y en «Guardar y cargar». Al abrir la página o cargar un archivo pasa por `validar`: tiene que ser de la versión 1, un árbol desde un solo colector (a cada punto llega a lo más un tramo, todos se alcanzan desde el colector, los equipos en extremos, uno por punto), con identificadores válidos y únicos, diámetros comerciales, largos de 0.1 a 100 m y rumbos múltiplos de 15°. Si no, **se descarta** sin romper la página. Se sanea lo demás: nombres, una boca o mangueras en una clase que no las lleva, material y calibre que no existen, y los contadores nunca quedan por debajo de los identificadores que hay.
- La lectura que sale del dibujo y sus respuestas se guardan como cualquier lectura (`estado.cot.unifilar`), y las partidas llevan la etiqueta de su pieza (`DUCT-002`, `RINJ-001`, `SOP-001`, `COMPRA-MANGUERA_6`…). Cada respuesta en la revisión vuelve a correr las reglas y actualiza las partidas.
- «Editar el dibujo» → cambiar → «Listo» propone **reemplazar** las partidas del unifilar; las editadas a mano se avisan antes, como con un croquis.
- «Nuevo dibujo» deja sólo el colector (con deshacer). «Descartar la lectura» quita la lectura y sus partidas; el dibujo se queda para volver a convertirlo.

## 9. Qué se prueba

- **El dibujo del ejemplo = el croquis leído:** mismas 22 partidas campo por campo, mismo costo y mismos conteos (aros, tornillos, ménsulas).
- **40 dibujos al azar** hechos con las operaciones (subidas, codos, injertos, reducciones, equipos): ningún error de revisión, ninguna pregunta de lectura, nunca no cotizable; **en cada nodo las reglas ponen exactamente la pieza del dibujo** (codo con o sin reducción, reducción, injerto simple o reducción con injerto) **con su ángulo**, todos dentro de los del taller; un tramo recto por tramo dibujado con su Ø, su cota a ejes y su posición; y lo guardado vuelve igual.
- Cada regla del §4 con su mensaje, a los dos lados y con las políticas de las tablas maestras cambiadas (codos sólo a 45° y 90°); las verticales; fusionar; la cascada de diámetros; partir; girar ramas; borrar; equipos y sus límites; que las operaciones no cambian el modelo que reciben; los errores y avisos de §5 (con el cruce que deja de chocar a otra altura); `validar` contra 17 formas de dato dañado; la lectura (orígenes, ejes, ángulos, equipos, respuestas); los accesorios encimados; los topes.
- El despiece de dos dibujos (el ejemplo y uno con bajada, máquina con brida y boca de 6″, extremo abierto y accesorios pegados) **cumple el esquema JSON**.
- En el navegador (sección 34): trazos con el ratón (subida, tronco, injerto), el formulario del teclado, la reducción con un toque, los equipos, el error de un equipo a la mitad, deshacer y rehacer, los conteos y el costo, cambiar un largo, la vista en planta, las teclas, «Listo» agregando las partidas, responder en la revisión y que pase al dibujo, borrar y reemplazar, recargar la página, el ejemplo dibujado, un dibujo guardado roto y el teléfono sin desplazamiento horizontal.

## 10. Límites

- Sólo **tramos horizontales y verticales**: no hay tramos inclinados (una subida a 45°); se dibujan como horizontal más vertical.
- Sólo ducto **redondo**: no hay transiciones a rectangular ni ductos rectangulares.
- El colector tiene **una boca**; no hay compuertas ni ventiladores como equipos del dibujo.
- No hay pantalones ni derivaciones múltiples en un punto: el taller hace injertos separados.
- Los puntos no se arrastran para moverlos: se cambian los largos y los ángulos (todo lo que sigue se mueve con ellos).
- Los choques se revisan sólo entre ductos, no contra la estructura de la nave.
- En dibujos muy densos las etiquetas pueden encimarse (se acomodan para no taparse, y si no hay lugar se omiten las cotas de los tramos cortos); el panel siempre da las medidas.
- Con unos 120 tramos cada cambio tarda alrededor de 0.2 s (las reglas del unifilar y el costo se recalculan completos).
