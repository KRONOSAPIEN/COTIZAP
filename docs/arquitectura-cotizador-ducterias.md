# Arquitectura del Cotizador Maestro de Ducterías

**COTIZAP · Especificación lógica, matemática y estructural · v1.2**

> Documento de arquitectura para analistas de datos y programadores. Define **qué se calcula, con qué fórmulas y con qué datos**, sin depender de una plataforma. La implementación de referencia (JavaScript sin dependencias) vive en `src/`, sus pruebas en `tests/`, y **todas las cifras de los ejemplos de este documento son la salida literal del motor**.
>
> ⚠ **Sólo cuatro grupos de valores son reales: la mano de obra ($500 por día, dato del taller: $62.50 la hora, el salario del día ÷ 8 h), la lámina y los perfiles de la lista del proveedor (cotizaciones y factura del 30-sep-2026), los artículos del catálogo de compras (hoja de control de gastos del 6-oct-2026 y cotización del proveedor de corte del 2-oct-2026) y los tiempos de rolado y barrenado de las bridas (calibrados con el taller: 30 bridas en 4 días). Todo lo demás —consumibles, equipo, los demás tiempos, indirectos, utilidad— es ILUSTRATIVO** en este documento y en `src/datos/maestros.js`: existe para que el motor funcione y para servir de vector de prueba, y debe sustituirse por precios, tarifas y estudios de tiempos del taller antes de cotizar a un cliente (§10). El proyecto real de la hoja de control de gastos se reproduce completo en §7.4.

## Contenido

0. [Decisiones, supuestos y convenciones](#0-decisiones-supuestos-y-convenciones)
1. [Arquitectura general](#1-arquitectura-general)
2. [Módulo 1 — Insumos y bases de datos](#2-módulo-1--insumos-y-bases-de-datos)
3. [Módulo 2 — Motor geométrico y de material (Core Engine)](#3-módulo-2--motor-geométrico-y-de-material-core-engine)
4. [Módulo 3 — Mano de obra y consumibles](#4-módulo-3--mano-de-obra-y-consumibles)
5. [Módulo 4 — Estructura de precios](#5-módulo-4--estructura-de-precios)
6. [Pseudocódigo maestro](#6-pseudocódigo-maestro)
7. [Ejemplos resueltos paso a paso](#7-ejemplos-resueltos-paso-a-paso)
8. [Arquitectura de datos, módulos y plataformas](#8-arquitectura-de-datos-módulos-y-plataformas)
9. [Verificación contra los criterios de calidad](#9-verificación-contra-los-criterios-de-calidad)
10. [Calibración, límites conocidos y siguientes pasos](#10-calibración-límites-conocidos-y-siguientes-pasos)

---

## 0. Decisiones, supuestos y convenciones

### 0.1 Campos `[COMPLETAR]` del prompt original y cómo se resolvieron

| Campo pendiente | Decisión tomada | Dónde se cambia |
| --- | --- | --- |
| Plataforma de implementación | **Núcleo agnóstico**: tablas maestras + funciones puras + pseudocódigo (§6). Implementación de referencia en JavaScript sin dependencias: motor (Node y navegador) y aplicación web que se abre con doble clic. El mapeo a Excel, React y Python está en §8.3. | §8.3 |
| Factor de área del codo de 90° de 5 gajos | **No es un número fijo: se deriva exactamente.** Respecto a un tramo recto cuya longitud es el arco de eje (π/2·R): **F_arco = 1.0131**. En forma absoluta: **A = 7.4988·D²** con R/D = 1.5. El sobrecosto real de un codo no viene del área sino de la merma y la mano de obra (§3.4.1 y Ejemplo B). | §3.4.1 |
| Diámetro y calibre del ejemplo | Ø12" (interior), calibre 16, acero al carbón, 3 m, bridado (los valores sugeridos en el prompt). | §7 |
| Injerto simple, reducción con injerto y ángulos del taller | El «ramal en ángulo» pasó a llamarse **injerto simple** (misma geometría, id `RAMAL`). El «pantalón» se sustituyó por la **reducción con injerto** (id `REDUCCION_INJERTO`): una reducción D1 → D2 con el injerto **sobre el cono**. **Todo injerto es a 30° o 45°** y **los codos son de 30°, 45°, 60° o 90°**: son listas de maestros y el cotizador rechaza cualquier otro ángulo. El pantalón se retiró de la interfaz; el motor lo sigue calculando sólo para abrir cotizaciones anteriores. Seis supuestos de detalle están por confirmar con el taller (§10.5). | §3.4.1 · §3.4.4 · §3.4.5 · §7.3 · §10.5 |
| Parámetros de precio de la cotización | El encabezado de la cotización lleva los parámetros comerciales que se ajustan al cotizar —**margen de utilidad, comisión de ventas, descuento al cliente y días de cobro** y, en «Más parámetros de precio», **administración, financiamiento anual e IVA**— para no ir a las tablas maestras. Valen sólo para esa cotización: el motor los toma de `cotizacion.parametros` y los pone encima de las capas de T9 (§5.4); lo que no se cambia sale de los maestros. Cuatro supuestos de detalle están por confirmar (§10.7). | §5.2 · §5.4 · §6 · §10.7 |
| Mano de obra por día y lista de precios del proveedor | Los trabajadores ganan **$500 por día** ($3,500 a la semana ÷ 7), **sin utilidades ni prestaciones**, y el taller cuesta la hora como **el salario del día ÷ 8 h = $62.50** (FSR = 1.00): `salario_hora = salario_diario / horas_día` y `mo_h = salario_hora · FSR` (T8). Así no se recuperan los 2 días de descanso que se pagan ni las prestaciones: con FSR = 7/5 = 1.40 la hora costaría $87.50 (§4.1, §7.4.1). El proveedor de acero cotiza **por pieza y con IVA incluido** (hojas y barras): la lista (T3b) conserva el precio como se cotiza y el motor lo convierte a **$/kg sin IVA** con los kg de la pieza (§5.1.1); lo que no está cotizado usa un precio por kg de respaldo. Cuatro supuestos de detalle están por confirmar (§10.6). | T3 · T3b · T8 · §4.1 · §5.1.1 · §10.6 |
| Hoja de control de gastos (proyecto vendido por otro ingeniero) | Se analizó la hoja del 6-oct-2026 de un proyecto que se vendió en **$45,710 con IVA** y acabó con pérdidas, y se agregó lo que le faltaba a la app: **bridas sueltas** (sólo aros, con las puntas de la solera que la roladora no curva: la regla del taller π·(D + 81 mm)), **soportería** cortada de barras de la lista, **artículos del catálogo de compras con o sin IVA** (un precio con IVA se cuesta sin él), **instalación en obra con viáticos**, la **lista de compras en piezas enteras** (con la opción de cobrar el sobrante), la **venta pactada** contra el precio mínimo y el **control de gastos** real contra cotizado. Convención de IVA: la venta pactada se captura **con o sin IVA** (la de este proyecto venía con IVA: el margen se mide sin él) y los precios del proveedor **traen IVA**. Con las respuestas del taller del 7-oct-2026 el caso quedó así: la hora a $62.50, las bridas de solera en **4 días**, **Sikaflex en lugar del empaque**, esmalte en las bridas, ménsulas de 650 mm en 2 días, abrazaderas para el ducto de 11″, instalación local (sin hospedaje ni comidas) y las 30 bridas de placa del proveedor de corte con su tornillería y su Sikaflex. El proyecto completo es el caso de referencia de §7.4; los supuestos que quedan están en §10.12. | T3c · T7e · §3.5.1 · §3.5.4 · §3.6 · §4.5 · §5.5–5.7 · §7.4 · §10.12 |
| Junta de las bridas con Sikaflex | El taller **sella la cara de la brida con un cordón de Sikaflex** sobre el círculo de barrenos, en lugar del empaque de neopreno (`uniones.BRIDADO.junta = SELLADOR`; 40 mL por metro + 15 % de merma; media junta por brida, de taller, suelta o de placa comprada). Ese cordón es también el sello de la junta transversal: no se le suma el de la clase C. El empaque sigue disponible (`EMPAQUE`). | T5 · §3.5.4 · §3.5.5 |
| Brida estándar del taller | **Una sola brida para todos los diámetros: aro de solera 1½" × 3/16", barreno Ø3/8", tornillo 5/16" × 1¼".** Se modela como el perfil `SOL38x4.8` (tipo solera, rolada "de canto"), que lleva en sus propias columnas el barreno y el tornillo; los ángulos quedan como opción por partida (`perfil_id`). Los supuestos de detalle están por confirmar con el taller (§10.4); la junta con Sikaflex ya la confirmó. | T4 · T5 · §3.5 · §10.4 |
| Armado del tramo recto por yardas | El taller no rola tramos de 3 m: rola **yardas** —anillos del ancho de la lámina (914 mm = 3 ft ó 1 220 mm = 4 ft)—, las **engargola** hasta de 3 en una pieza con brida en ambos extremos, y lo que falta lo arma con las yardas completas que sobren y un **tramo de ajuste** (menos de una yarda) cuyo extremo libre **no lleva brida de taller**, para ponerlo en campo ajustando la distancia. **Quien diseña elige el ancho de la yarda** (3 ft ó 4 ft) en el encabezado de la cotización, o por partida. En ese extremo libre se cotiza, por omisión, la **brida suelta** —el taller manda el aro ya terminado (rolado, con el cierre soldado, barrenado y pintado), con sus tornillos y el material de su junta, sin soldarlo al ducto: se suelda en obra—; la partida puede pedir también «sin brida» (la brida no está en el precio) o «brida de taller». El motor reparte el largo así (§3.2): anillos que se rolan por separado, juntas engargoladas entre yardas, bridas sólo donde corresponde, corte con un tajo a lo ancho de la hoja. Los supuestos de detalle están por confirmar (§10.9). | T7c · §3.2 · §3.5.7 · §4.1 · §10.9 |
| Pintura según el material y la instalación | **Lo que se pinta depende del material y el sistema, de dónde va instalado el ducto.** Acero al carbón: se pinta —en **interior**, sólo pintura (esmalte); en **exterior**, primario y pintura—. Lámina galvanizada: **no se pinta más que las bridas** (con el mismo criterio: interior, sólo pintura; exterior, primario y pintura). Inoxidable: no se pinta. La instalación se elige una vez en el encabezado de la cotización y cada partida puede traer la suya; si una partida elige un sistema de pintura, vale para todo lo que se pinta. El ducto y las bridas se calculan por separado (superficie, manos, tiempo y litros). Los supuestos de detalle están por confirmar (§10.10). | T7d · §4.1 · §4.3 · §10.10 |
| Público objetivo | Ingenieros de ventas técnicas en México y desarrolladores internos. Moneda **MXN**, **IVA 16 %** aparte, **Factor de Salario Real (FSR)** para mano de obra. | `capas.iva_pct`, `mano_obra.FSR` |

### 0.2 Convenciones obligatorias (evitan los errores más caros)

1. **Unidades internas:** mm (longitudes), m² (áreas), kg, min, MXN. Las entradas en pulgadas se convierten con 1 in = 25.4 mm exactos.
2. **Diámetro nominal = interior** (`ref_diametro = INTERIOR`, configurable). Lo que se desarrolla es el **diámetro medio de la fibra neutra** `D_med = D_int + e`. Ignorar `e` en un Ø12" cal. 16 acorta la plantilla 4.8 mm (0.5 %).
3. **Merma como rendimiento:** `m_bruta = m_neta / (1 − φ)`, **no** `m_neta · (1 + φ)`. Con φ = 20 % el factor correcto es 1.25, no 1.20 (4 % de subestimación del material).
4. **Utilidad como margen sobre precio:** `P = C / (1 − m)`. Un margen del 20 % equivale a un *markup* del 25 % sobre costo (`k = m / (1 − m)`). Confundirlos regala utilidad.
5. **Los precios nunca viven en las fórmulas.** Se leen por variable referencial (`precio_kg_acero_carbon`, `precio_m3_gas_argon`, …) o de la lista de precios del proveedor (`proveedor.hojas`, `proveedor.barras`, por pieza y con IVA incluido, §5.1.1) desde tablas versionadas.
6. **Cantidades antes que precios.** El motor primero produce un levantamiento de cantidades físicas (QTO) y después lo valoriza. Cambiar el precio del acero no recalcula geometría.
7. **Tabla de calibre por material:** MSG (negro), GSG (galvanizado), USSG (inoxidable). Usar la tabla equivocada en calibre 16 produce ~6 % de error de peso (1.519 mm vs 1.613 mm).
8. **Redondeo sólo en presentación.** El motor opera en doble precisión; el precio unitario se redondea a centavos y `importe = precio_unitario · cantidad`.

### 0.3 Glosario

| Término | Significado |
| --- | --- |
| **Gajo** | Segmento de un codo fabricado en piezas; los extremos son medios gajos. |
| **Virola** | Cilindro (o cono) formado al rolar una plantilla de lámina. |
| **Desarrollo / plantilla** | Forma plana de la lámina que, al rolarla o plegarla, produce la pieza. |
| **Brida / aro** | Anillo de solera (barra plana de 1½" × 3/16", rolada "de canto") soldado al extremo del ducto; dos bridas se unen con tornillos de 5/16" × 1¼" en barrenos de Ø3/8". |
| **Tronco** | Ducto principal (de diámetro `D`, o `D1` que se reduce a `D2`) al que se suelda el injerto. En el motor se llama *cuerpo*. |
| **Injerto** | Tubo más chico que se suelda al tronco a un ángulo β (30°, 45° o 90°) para derivar el flujo. En el motor se llama *ramal*. |
| **Silleta** | Curva de intersección del injerto con el tronco: por ahí se corta el orificio y se suelda. |
| **Solera** | Barra plana de acero. La del taller mide 1½" × 3/16" = 38.1 × 4.763 mm; al rolarla de canto el ancho `b` queda en el plano radial. |
| **Gramil (g)** | Distancia radial entre la pared exterior del ducto (el borde interior del aro) y el centro del barreno. En la solera del taller, g = 24 mm: los planos de pedido del 30-sep-2026 dan Dperf = Dint + 48 mm. |
| **Espiga** | Extremo macho que entra en el siguiente tramo (unión macho–hembra). |
| **Merma (φ)** | Fracción del material comprado que no queda en la pieza. |
| **QTO** | *Quantity take-off*: levantamiento de cantidades físicas, sin precios. |
| **CD / CI / GIF** | Costo directo / costo indirecto / gastos indirectos de fábrica. |
| **MOD / FSR** | Mano de obra directa / Factor de Salario Real (convierte el salario en lo que cuesta cada hora trabajada: días de descanso pagados y prestaciones; vale 1.00 porque el taller cuesta la hora como $500 ÷ 8 h; 7/5 = 1.40 recupera los días de descanso). |
| **FO** | Factor de operación: arco encendido ÷ tiempo total de soldadura. |
| **GMAW / GTAW** | Soldadura MIG-MAG (microalambre) / TIG (varilla). |
| **MSG / GSG / USSG** | Tablas de calibre: acero al carbón / galvanizado / inoxidable. |
| **Clase de sellado A, B, C** | Niveles de sellado de juntas y costuras (SMACNA). |

---

## 1. Arquitectura general

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ MAESTROS (datos versionados)                                                                 │
│ materiales · calibres · perfiles · uniones · procesos y velocidades ·                        │
│ merma · k_dif · tarifas de mano de obra y equipo · lista del proveedor · catálogo de compras │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ MOTOR (funciones puras: mismas entradas → mismas salidas)                                    │
│ 1 Validar → 2 Geometría por familia (PF) → 3 Herrajes → 4 Lámina (m_neta → m_bruta)          │
│ → 5 Tiempos por operación → 6 Consumibles                                                    │
│ ══ resultado: QTO = cantidades físicas, SIN precios ══                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ PRECIOS (variables precio_*) + CAPAS (CI, imprevistos, financiamiento, margen, IVA)          │
│ 7 Valorizar → 8 Pila de precio (CD → CI → imprevistos → financiamiento → margen) → 9 KPIs    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ COMPRAS Y GASTOS (sobre el QTO y los costos de todas las partidas)                           │
│ 10 Lista de compras en piezas enteras (y el sobrante) → 11 Venta pactada contra el precio    │
│ mínimo → 12 Control de gastos: lo real (sin el IVA acreditable) contra lo cotizado           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Principios de diseño**

| # | Principio | Consecuencia práctica |
| --- | --- | --- |
| P1 | Cantidades ≠ precios | Re-cotizar con otro precio de acero no repite la geometría; el QTO sirve para compras. |
| P2 | Datos, no código | Todo número que un taller pueda querer cambiar es una fila de una tabla maestra. |
| P3 | Funciones puras + *snapshot* | Cada cotización guarda la versión de maestros con la que se calculó → reproducible. |
| P4 | Trazabilidad | Cada partida devuelve su desglose completo (geometría, kg, minutos, $ por capa). |
| P5 | Validar antes de calcular | Los **errores** bloquean la partida; las **advertencias** se reportan sin bloquear. |
| P6 | Exactitud declarada | Forma cerrada donde existe; donde se aproxima, el error está documentado y probado. |

---

## 2. Módulo 1 — Insumos y bases de datos

### 2.1 Entradas por partida

**Comunes a toda partida fabricada**

| Variable | Tipo / unidad | Valores | Defecto | Descripción |
| --- | --- | --- | --- | --- |
| `familia` | enum | `RECTO` `CODO` `REDUCCION` `TRANSICION` `RAMAL` `REDUCCION_INJERTO` `BRIDA` `UNION` `PERSONALIZADO` · sin lámina: `SOPORTE` `COMPRADO` `INSTALACION` | — | Define la función geométrica. `RAMAL` es el *injerto simple*; `BRIDA`, las *bridas sueltas* (sólo aros, §3.6.1); `UNION`, el *armado de piezas* (la unión entre dos piezas, engargolada en galvanizado, §3.6.4). Las familias sin lámina no llevan material, calibre, unión ni pintura (§3.6 y §4.5). `PANTALON` (retirada) se acepta sólo para abrir cotizaciones anteriores. |
| `cantidad` | entero ≥ 1 | pzas | 1 | Los *setups* se cargan una vez por partida. |
| `material_id` | enum | `ACERO_CARBON` `GALVANIZADO` `INOX_304` `INOX_316` | — | Determina tabla de calibre, densidad, proceso de soldadura y consumibles. |
| `calibre` | entero | 10 – 28 | — | Se resuelve en la tabla del material. |
| `espesor_mm` | mm | > 0 | — | Opcional: sustituye al calibre (placa, espesores especiales). |
| `ref_diametro` | enum | `INTERIOR` `EXTERIOR` | `INTERIOR` | A qué superficie se refiere la dimensión nominal. |
| `tipo_union` | enum | `BRIDADO` `ESPIGA` `LISO` | `BRIDADO` | Define herrajes y mano de obra de unión. |
| `bridas_aparte` | sí/no | — | no | Sólo con `BRIDADO`: los aros —con su tornillería y su junta— son de **otra partida** (Bridas sueltas o bridas de placa compradas); aquí sólo se arman y se sueldan al ducto (§3.5.8). Sin efecto en `BRIDA`. |
| `extremos_sin_brida` | lista | por familia (§3.5.8) | vacía | Los extremos que van **sin brida** porque se unen a otra pieza (armado de piezas) o a una manguera: `A` y `B` en el codo; `D1` y `D2` en la reducción; `redondo` y `rectangular` en la transición; `tronco_1`, `tronco_2` e `injerto` en el injerto simple; `D1`, `D2` e `injerto` en la reducción con injerto. El tramo recto lo dice con su extremo final. |
| `clase_sellado` | enum | `NINGUNA` `C` `B` `A` | `C` | Clases de sellado SMACNA (ver §3.5.5). |
| `ubicacion` | enum | `INTERIOR` `EXTERIOR` | la de la cotización | Dónde va instalado el ducto (bajo techo o a la intemperie): decide el sistema de pintura (T7d). |
| `pintura` | enum | `NINGUNA` `ESMALTE` `PRIMARIO` `PRIMARIO_ESMALTE` | la regla del taller | Vacío: la regla de T7d según el material y la `ubicacion` (acero al carbón: interior `ESMALTE`, exterior `PRIMARIO_ESMALTE`; galvanizado: sólo las bridas; inoxidable: ninguna). Un sistema elegido vale para el ducto **y** las bridas. |
| `caras_pintadas` | 1 ó 2 | — | 1 | Caras **del ducto** que se pintan: 1 = la exterior, 2 = exterior e interior (no confundir con la instalación). Las bridas llevan sus dos caras y el canto. |
| `servicio` | enum | `VENTILACION` `POLVO` `ABRASIVO` | `POLVO` | Valida el calibre mínimo por diámetro (advertencia). |
| `riesgo` | enum | `BAJO` `MEDIO` `ALTO` | `MEDIO` | Selecciona el % de imprevistos. |
| `proceso_corte` | enum | `GUILLOTINA` `PLASMA` `LASER` | por familia | Recto: guillotina; accesorios: plasma. |
| `merma_pct` | fracción [0, 1) | — | por familia | Sustituye la merma de tabla para esa partida. |
| `omitir_operaciones` | lista de operaciones | ver §4.4 | vacía | Operaciones subcontratadas (se anulan sus horas y consumibles). |
| `subcontratos` | lista `{concepto, driver, precio}` | ver §4.4 | vacía | Costos de terceros por driver (kg, m², m de corte, pieza). |
| `perfil_id` | texto | ver §2.2 (T4) | `SOL38x4.8` | Perfil del aro. Por defecto, el estándar del taller (solera 1½" × 3/16", barreno Ø3/8", tornillo 5/16" × 1¼"). |

**Entradas geométricas por familia** (todas las dimensiones en mm; la interfaz convierte pulgadas)

| Familia | Entradas | Notas |
| --- | --- | --- |
| `RECTO` | redondo: `D_mm` · rectangular: `a_mm`, `b_mm` · `L_mm`, `tipo_costura` (`A_TOPE` `TRASLAPE` `PITTSBURGH`; vacía = la del material: Pittsburgh en galvanizado, a tope en los demás), `yarda_mm` (914 ó 1 220; por omisión la de la cotización y, si no, la de T7c), `extremo_ajuste` —el **extremo final** del tramo— (`SUELTA` `SIN_BRIDA` `CON_BRIDA`; sin elegirlo, con tramo de ajuste el de T7c, `SUELTA`, y sin ajuste brida de taller), `n_costuras_long` | Se arma por **yardas** (§3.2): piezas de hasta 3 yardas engargoladas y un tramo de ajuste cuyo extremo libre no lleva brida de taller (§3.5.7). «Brida en un extremo» de los planos de yardas = `SIN_BRIDA`; «bridas en ambos extremos» = sin elegir (o `CON_BRIDA`). |
| `CODO` | redondo: `D_mm`, `theta_deg` (**30, 45, 60 ó 90**; 90), `n_gajos` (auto), `k_R` (1.5), `L_tangente_mm` (0) · rectangular: `a_mm`, `b_mm`, `theta_deg`, `k_R` | `n_gajos` automático con α ≤ 22.5° por junta: 3, 3, 4 y 5 gajos para 30°, 45°, 60° y 90°. |
| `REDUCCION` | `D1_mm`, `D2_mm`, `L_mm` (auto con semiángulo 15°), `excentrica` (`NO` `CARA_PLANA`) | |
| `TRANSICION` | `D_mm` (extremo redondo), `a_mm`, `b_mm` (extremo rectangular), `H_mm` (auto) | Centrada. |
| `RAMAL` (injerto simple) | `D_mm` (tronco), `d_mm` (injerto), `L_cuerpo_mm`, `L_ramal_mm`, `beta_deg` (**30 ó 45**; 45) | `L_ramal` se mide sobre el eje del injerto desde el eje del tronco. |
| `REDUCCION_INJERTO` | `D1_mm`, `D2_mm` (< D1), `d_mm`, `beta_deg` (**30** ó **45**; 45), `L_reduccion_mm`, `L_ramal_mm` | El injerto va **sobre el cono** y siempre de extremo mayor a menor (inclinado hacia D2): es un dato de maestros (`proceso.injerto_inclinado_hacia`), no se captura por partida. Los dos largos son opcionales: vacíos → automáticos (§3.4.5). |
| `BRIDA` (bridas sueltas) | redondo: `D_mm` · rectangular: `a_mm`, `b_mm` (la medida **del ducto** en que van) | Sólo aros terminados, sin lámina; siempre bridada. Material y calibre son los del ducto (§3.6.1). |
| `UNION` (armado de piezas) | `D_mm` (el de las bocas que se unen), `n_uniones` (1) | La unión entre dos piezas de otras partidas, sin lámina: engargolada en galvanizado, soldada en los demás (§3.6.4). Las piezas que se unen van sin brida en esos extremos. |
| `PERSONALIZADO` | `A_neta_m2`, `L_corte_m`, `L_sold_tope_m`, `L_sold_filete_m`, `n_piezas`, `n_extremos`, `D_ref_mm` | Para campanas y piezas con desarrollo CAD. |
| `SOPORTE` (soportería) | `barra_id` (de T3b), `largo_pieza_mm` o, en una abrazadera, `abrazadera_D_mm` (el diámetro del ducto que abraza), `anclajes_pieza` (0), `articulo_anclaje` (el de T7e), `tornillos_pieza` (0), `min_pieza` (minutos reales; el de T7e) | Ménsulas, abrazaderas y postes cortados de una barra de la lista (§3.6.2). |
| `COMPRADO` | `articulo_id` (de T3c, opcional), `precio_compra_unitario` (vacío = el del catálogo), `iva_incluido` (sí/no; vacío = el del catálogo, y un precio capturado es antes de IVA), `peso_kg`, `tornillos_pieza` y `circulo_barrenos_mm` (si se atornilla como brida; vacío = los del artículo) | Compuertas, mangueras, el ducto de un proveedor…: pasa por la pila sin mano de obra; un precio con IVA se cuesta sin IVA (§3.6.3). |
| `INSTALACION` | `personas`, `dias`, `horas_dia` (la jornada de T8), `viajes`, `casetas_viaje`, `gasolina_viaje`, `noches`, `hospedaje_noche`, `comida_dia`, `otros_gastos`, `gastos_con_factura` (sí), `comidas_con_factura` (no) | La cuadrilla en obra y sus viáticos, capturados con IVA como en el ticket (§4.5). La `cantidad` son visitas iguales. |

**Entradas por cotización** (`cotizacion`): `cliente`, `proyecto`, `fecha`, `vigencia_dias`, unidades de captura de diámetros y longitudes, `servicio` y `riesgo` por omisión de las partidas (cada partida puede traer los suyos), la **instalación** (`ubicacion`: interior o exterior, que decide la pintura), el **ancho de la yarda** (`yarda_mm`) de los tramos rectos —lo elige quien diseña: 914 ó 1 220 mm; cada tramo puede traer el suyo— los **parámetros de precio propios** de la cotización (`parametros`, §5.4): margen de utilidad, comisión, descuento, días de cobro, administración, financiamiento anual e IVA; la **venta pactada** con el cliente (`venta_pactada`, MXN; con IVA si `venta_pactada_con_iva`, §5.6); si se **cobra el sobrante de comprar piezas enteras** (`piezas_enteras`, sí/no, §5.5); y los **gastos reales** del proyecto (`gastos`: fecha, concepto, categoría, cantidad, precio unitario, si trae IVA y si tiene factura, §5.7).

### 2.2 Tablas maestras

**T1 · Materiales**

| `material_id` | Tabla calibre | ρ (kg/m³) | Variable de precio | Soldadura | Aporte | Gas | f_sold | f_acabado | Costura (`costura`) | Brida al ducto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ACERO_CARBON` | MSG | 7,850 | `precio_kg_acero_carbon` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.00 | 0.25 | `A_TOPE` | `SOLDADA` |
| `GALVANIZADO` | GSG | 7,850 | `precio_kg_acero_galvanizado` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.20 | 0.35 | `PITTSBURGH` | `CEJA` |
| `INOX_304` | USSG | 7,930 | `precio_kg_inox_304` | GTAW | `precio_kg_varilla_er308l` | `precio_m3_gas_argon` | 1.00 | 0.60 | `A_TOPE` | `SOLDADA` |
| `INOX_316` | USSG | 7,980 | `precio_kg_inox_316` | GTAW | `precio_kg_varilla_er316l` | `precio_m3_gas_argon` | 1.00 | 0.60 | `A_TOPE` | `SOLDADA` |

`f_sold` = multiplicador de mano de obra de soldadura por material (p. ej. retiro de zinc en galvanizado). `f_acabado` = fracción del tiempo de soldadura que se dedica a esmerilado, limpieza o decapado. `costura` = la de T7 (`proceso.costuras`) con que se cierran las costuras y se unen las piezas de lámina del material: el galvanizado **se engargola siempre** (`PITTSBURGH`, §3.4.7). `brida_al_ducto` = cómo se fija la brida: `SOLDADA` (filete aro–ducto) o `CEJA` (se mete y al ducto se le hace una ceja, §3.5.9); el galvanizado, con ceja (el taller, 7-oct-2026).

**T2 · Espesor por calibre** (tabla propia por familia de calibre; valores nominales — validar contra el certificado del proveedor)

| Calibre | MSG · acero al carbón (mm) | GSG · galvanizado (mm) | USSG · inoxidable (mm) |
| --- | --- | --- | --- |
| 10 | 3.416 | 3.510 | 3.571 |
| 12 | 2.657 | 2.753 | 2.779 |
| 14 | 1.897 | 1.994 | 1.984 |
| 16 | 1.519 | 1.613 | 1.587 |
| 18 | 1.214 | 1.311 | 1.270 |
| 20 | 0.912 | 1.006 | 0.952 |
| 22 | 0.759 | 0.853 | 0.795 |
| 24 | 0.607 | 0.701 | 0.635 |
| 26 | 0.455 | 0.551 | 0.478 |
| 28 | 0.378 | 0.475 | 0.396 |

**T3 · Precios — variables referenciales** (MXN **sin IVA**; los de lámina y perfil por kg son el *respaldo* para un calibre o un perfil que la lista del proveedor T3b no cotiza; los demás son *ilustrativos*; en producción provienen de una tabla versionada con proveedor, vigencia y moneda)

| Variable referencial | Unidad (sin IVA) | Valor | Origen |
| --- | --- | --- | --- |
| `precio_kg_acero_carbon` | MXN/kg | 22.47 | Respaldo, tomado de la lista del proveedor (T3b) |
| `precio_kg_acero_galvanizado` | MXN/kg | 30.69 | Respaldo, tomado de la lista del proveedor (T3b) |
| `precio_kg_inox_304` | MXN/kg | 98.00 | Ilustrativo |
| `precio_kg_inox_316` | MXN/kg | 135.00 | Ilustrativo |
| `precio_kg_chatarra_acero` | MXN/kg | 7.00 | Ilustrativo |
| `precio_kg_chatarra_inox` | MXN/kg | 45.00 | Ilustrativo |
| `precio_kg_perfil_angulo` | MXN/kg | 25.25 | Respaldo, tomado de la lista del proveedor (T3b) |
| `precio_kg_solera` | MXN/kg | 25.21 | Respaldo, tomado de la lista del proveedor (T3b) |
| `precio_kg_alambre_er70s6` | MXN/kg | 62.00 | Ilustrativo |
| `precio_kg_varilla_er308l` | MXN/kg | 420.00 | Ilustrativo |
| `precio_kg_varilla_er316l` | MXN/kg | 520.00 | Ilustrativo |
| `precio_m3_gas_mezcla_ar_co2` | MXN/m³ | 145.00 | Ilustrativo |
| `precio_m3_gas_argon` | MXN/m³ | 190.00 | Ilustrativo |
| `precio_m_corte_guillotina` | MXN/m de corte | 0.30 | Ilustrativo |
| `precio_m_corte_plasma` | MXN/m de corte | 3.50 | Ilustrativo |
| `precio_m_corte_laser` | MXN/m de corte | 2.00 | Ilustrativo |
| `precio_m_empaque_neopreno` | MXN/m | 28.00 | Ilustrativo |
| `precio_cartucho_sellador` | MXN/cartucho de 600 mL | 395.69 | Ilustrativo |
| `precio_pza_autotaladrante` | MXN/pza | 0.85 | Ilustrativo |
| `precio_juego_tornillo_5_16_x_1_1_4` | MXN/juego (tornillo+tuerca+2 rondanas) | 3.67 | Ilustrativo |
| `precio_juego_tornillo_m8` | MXN/juego (tornillo+tuerca+2 rondanas) | 5.00 | Ilustrativo |
| `precio_juego_tornillo_m10` | MXN/juego (tornillo+tuerca+2 rondanas) | 6.50 | Ilustrativo |
| `precio_juego_tornillo_m12` | MXN/juego (tornillo+tuerca+2 rondanas) | 9.50 | Ilustrativo |
| `precio_L_primario` | MXN/L | 220.00 | Ilustrativo |
| `precio_L_esmalte` | MXN/L | 260.00 | Ilustrativo |
| `precio_L_diluyente` | MXN/L | 70.00 | Ilustrativo |

**T3b · Lista de precios del proveedor de acero** (cotizaciones y factura del 30-sep-2026). El proveedor cotiza **por pieza y con IVA incluido**; aquí se conserva el precio *como se cotiza* y se muestran los valores que el motor deriva de él (§5.1.1). `iva_incluido_pct` = 16 % (0 % si se capturan antes de IVA). «Cálculo» = el cotizador usa ese renglón; «Referencia» = se guarda para comparar, ninguna pieza lo usa todavía. La lámina de la factura está en cal. 12 (negra); las galvanizadas cal. 22 y 24 vienen de las cotizaciones.

*Lámina en hoja*

| Renglón | Concepto | Hoja (mm) | Precio cotizado (con IVA) | Sin IVA | kg por hoja | $/kg sin IVA | Uso |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GALV_C22_4X10` | Lámina galvanizada 4 × 10 ft · cal. 22 | 1219 × 3048 | 920.00 | 793.10 | 24.89 | 31.86 | **Cálculo** |
| `GALV_C24_4X10` | Lámina galvanizada 4 × 10 ft · cal. 24 | 1219 × 3048 | 700.00 | 603.45 | 20.45 | 29.51 | **Cálculo** |
| `NEGRA_C12_4X10` | Lámina negra 4 × 10 ft · cal. 12 | 1219 × 3048 | 2,020.00 | 1,741.38 | 77.49 | 22.47 | **Cálculo** |
| `NEGRA_C12_4X8` | Lámina negra 4 × 8 ft · cal. 12 | 1219 × 2438 | 1,620.00 | 1,396.55 | 61.98 | 22.53 | Referencia |
| `NEGRA_C12_3X10` | Lámina negra 3 × 10 ft · cal. 12 | 914 × 3048 | 1,515.00 | 1,306.03 | 58.10 | 22.48 | **Cálculo** |
| `NEGRA_C12_3X8` | Lámina negra 3 × 8 ft · cal. 12 | 914 × 2438 | 1,210.00 | 1,043.10 | 46.47 | 22.44 | Referencia |
| `PLACA_3_16_4X8` | Placa lisa 4 × 8 ft · 3/16" | 1219 × 2438 | 2,820.00 | 2,431.03 | 111.11 | 21.88 | Referencia |
| `PLACA_3_16_3X8` | Placa lisa 3 × 8 ft · 3/16" (prorrateada de la 4 × 8) | 914 × 2438 | 2,114.42 | 1,822.78 | 83.31 | 21.88 | Referencia |

*Perfiles y otros en barra* (las barras de ángulo y solera se consideran de 6 m, dato del taller)

| Renglón | Concepto | Barra (m) | `perfil` | Precio cotizado (con IVA) | Sin IVA | kg por barra | $/kg sin IVA | Uso |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SOL_1_1_2X3_16` | Solera 1½" × 3/16" (brida estándar) | 6.00 | `SOL38x4.8` | 250.00 | 215.52 | 8.55 | 25.21 | **Cálculo** |
| `ANG_1_1_2X3_16` | Ángulo 1½" × 3/16" | 6.00 | `L38x4.8` | 470.00 | 405.17 | 16.03 | 25.28 | **Cálculo** |
| `ANG_2X3_16` | Ángulo 2" × 3/16" | 6.00 | `L51x4.8` | 616.00 | 531.03 | 21.72 | 24.44 | **Cálculo** |
| `ANG_1_1_4X1_8` | Ángulo 1¼" × 1/8" | 6.00 | — | 260.00 | 224.14 | 9.02 | 24.85 | Referencia |
| `ANG_3_4X1_8` | Ángulo ¾" × 1/8" | 6.00 | — | 160.00 | 137.93 | 5.22 | 26.41 | Referencia |
| `SOL_1_1_4X1_8` | Solera 1¼" × 1/8" | 6.00 | — | 150.00 | 129.31 | 4.75 | 27.23 | Referencia |
| `CANAL_U_6` | Canal U 6" × 6 m (12.2 kg/m) | 6.00 | — | 2,177.18 | 1,876.88 | 73.20 | 25.64 | Referencia |
| `PTR_2X2_C14` | PTR 2" × 2" cal. 14 (6 m) | 6.00 | — | 490.00 | 422.41 | 17.46 | 24.19 | Referencia |

**T3c · Catálogo de compras** (`compras`; hoja de control de gastos del 6-oct-2026). Lo que se compra hecho, con su precio **como lo da la tienda o el proveedor** y si ese precio trae IVA (`iva_incluido`); el costo es sin IVA, con `compras.iva_pct` = 16 %. `categoria` dice en qué renglón del control de gastos cae (§5.7). Lo usan las partidas `COMPRADO` que eligen un artículo y los anclajes de la soportería. Además: la tornillería de la lista de compras se compra de 10 en 10 (`tornillos_multiplo`) y la pintura en envases de 1 L (`pintura_envase_L`).

| Artículo (`compras.articulos.*`) | Descripción | Unidad | Precio capturado | ¿Trae IVA? | Costo sin IVA | Renglón del control de gastos |
| --- | --- | --- | --- | --- | --- | --- |
| `MANGUERA_6` | Manguera azul de 6″ (tramo de 5 m) | tramo | 1,807.49 | No | 1,807.49 | Compras y trabajos de terceros |
| `MANGUERA_5` | Manguera azul de 5″ (tramo) | tramo | 1,427.03 | No | 1,427.03 | Compras y trabajos de terceros |
| `MANGUERA_3` | Manguera azul de 3″ (tramo) | tramo | 1,176.94 | No | 1,176.94 | Compras y trabajos de terceros |
| `ABRAZADERA_MANGUERA` | Abrazadera ajustable para manguera | pza | 55.00 | Sí | 47.41 | Compras y trabajos de terceros |
| `TAQUETE_3_8` | Taquete de 3/8″ | pza | 16.00 | Sí | 13.79 | Soportería y anclajes |
| `RIEL_1500_C14` | Riel 1500 cal. 14 | pza | 560.34 | No | 560.34 | Soportería y anclajes |
| `TEJUELO_2` | Tejuelo de 2″ | pza | 103.48 | No | 103.48 | Soportería y anclajes |
| `CARRETILLA_EMBALADA` | Carretilla embalada | pza | 172.41 | No | 172.41 | Soportería y anclajes |
| `SIKAFLEX_BLANCO_600` | Sellador Sikaflex blanco 600 mL | pza | 459.00 | Sí | 395.69 | Material |
| `SIKAFLEX_GRIS_600` | Sellador Sikaflex gris 600 mL | pza | 359.00 | Sí | 309.48 | Material |
| `BRIDA_PLACA_5` | Brida de placa 3/16″ para ducto de 5″ (Ø 194/130 mm, barrenos en Ø 170 mm) | pza | 110.00 | No | 110.00 | Compras y trabajos de terceros |
| `BRIDA_PLACA_6` | Brida de placa 3/16″ para ducto de 6″ (Ø 221/157 mm, barrenos en Ø 193 mm) | pza | 120.00 | No | 120.00 | Compras y trabajos de terceros |
| `BRIDA_PLACA_7` | Brida de placa 3/16″ para ducto de 7″ (Ø 258/182 mm, barrenos en Ø 230 mm) | pza | 140.00 | No | 140.00 | Compras y trabajos de terceros |

**T4 · Perfiles de aros de brida.** La primera fila es el **estándar del taller** y se usa en todos los diámetros; las demás (ángulos) son opcionales por partida con `perfil_id`. El área, el peso lineal y el centroide se **derivan** de (tipo, ancho, espesor) y no se capturan; el gramil, el barreno, el tornillo y la variable de precio son datos del perfil. Fórmulas en §3.5.1.

| `perfil_id` | Descripción | Tipo | Ancho b (mm) | Espesor t (mm) | Área (mm²) | Peso (kg/m) | c centroide (mm) | Gramil g (mm) | Barreno | Tornillo | Barra cotizada (T3b) | Precio por kg de respaldo | Uso |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SOL38x4.8` | Solera 1½" × 3/16" | Solera | 38.10 | 4.763 | 181.5 | 1.4245 | 19.05 | 24.00 | Ø3/8" = 9.525 mm | 5/16" × 1¼" | `SOL_1_1_2X3_16` | `precio_kg_solera` | **Estándar del taller**: todos los diámetros |
| `L25x3.2` | Ángulo 1" × 1" × 1/8" | Ángulo | 25.40 | 3.175 | 151.2 | 1.1870 | 7.51 | 14.00 | Ø9.000 mm | M8 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x3.2` | Ángulo 1½" × 1½" × 1/8" | Ángulo | 38.10 | 3.175 | 231.9 | 1.8201 | 10.70 | 22.00 | Ø11.000 mm | M10 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x4.8` | Ángulo 1½" × 1½" × 3/16" | Ángulo | 38.10 | 4.763 | 340.3 | 2.6710 | 11.27 | 22.00 | Ø11.000 mm | M10 | `ANG_1_1_2X3_16` | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L51x4.8` | Ángulo 2" × 2" × 3/16" | Ángulo | 50.80 | 4.763 | 461.2 | 3.6207 | 14.46 | 29.00 | Ø11.000 mm | M10 | `ANG_2X3_16` | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L64x6.4` | Ángulo 2½" × 2½" × 1/4" | Ángulo | 63.50 | 6.350 | 766.1 | 6.0141 | 18.21 | 35.00 | Ø14.000 mm | M12 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |

**T5 · Uniones**

| Parámetro | `BRIDADO` | `ESPIGA` | `LISO` |
| --- | --- | --- | --- |
| Elemento principal | aro de solera 1½" × 3/16" por extremo (estándar del taller) | prolongación macho `prof_espiga_mm` = 60 | — |
| Fijación | barreno Ø3/8" + tornillo 5/16" × 1¼" + tuerca + 2 rondanas; paso máx. 150 mm; mín. 6; número par (como en los planos de pedido) | autotaladrante; paso máx. 150 mm; mín. 4 | — |
| Reserva de herraje | 5 % | 5 % | — |
| Junta (`junta`) | **`SELLADOR`**: cordón de Sikaflex sobre el círculo de barrenos, `ml_sellador_junta_m` 40 mL/m (+15 % de merma); o `EMPAQUE`: cinta de neopreno 1½" × 1/8" (traslape 5 %) más el cordón de la clase | no | no |
| Soldadura de aro | filete continuo aro–ducto (`f_cont` = 1.0) + cierre a tope del aro | — | — |

**T6 · Merma y dificultad por familia** (φ = fracción del material comprado que no queda en la pieza)

| Familia | φ por defecto | Rango típico de taller | `k_dif` (armado) |
| --- | --- | --- | --- |
| `RECTO` | 8 % | 5–10 % | 1.00 |
| `CODO` | 20 % | 15–25 % | 1.35 |
| `REDUCCION` | 18 % | 15–20 % | 1.20 |
| `TRANSICION` | 22 % | 20–25 % | 1.50 |
| `RAMAL` (injerto simple) | 25 % | 20–30 % | 1.60 |
| `REDUCCION_INJERTO` | 28 % | 25–30 % | 1.90 |
| `PANTALON` (retirado) | 28 % | 25–30 % | 1.90 |
| `PERSONALIZADO` | 15 % | 10–25 % | 1.00 |
| `PERFIL` | 5 % | 3–6 % | — |

**T7 · Velocidades de proceso** (interpolación lineal por espesor; fuera de rango se mantiene el valor del extremo)

| e (mm) | Guillotina (m/min) | Plasma (m/min) | Láser (m/min) | Rolado (m/min por pasada) | Soldadura GMAW (m/min de arco) |
| --- | --- | --- | --- | --- | --- |
| 0.6 | 8.90 | 6.00 | 14.00 | 8.00 | 0.90 |
| 1.0 | 8.50 | 5.57 | 12.71 | 7.00 | 0.70 |
| 1.5 | 8.00 | 4.50 | 9.50 | 6.00 | 0.50 |
| 2.0 | 7.33 | 4.00 | 8.00 | 5.00 | 0.42 |
| 3.0 | 6.00 | 3.00 | 5.00 | 3.50 | 0.32 |
| 4.5 | 4.75 | 2.40 | 3.70 | 2.50 | 0.24 |

**T7b · Tiempos fijos y unitarios** (minutos estándar; ilustrativos salvo los de las bridas, calibrados con el taller)

| Operación | Parámetros |
| --- | --- |
| Corte | `t_manejo_hoja` 4.0 por hoja-equivalente · `t_prog_cnc` 6.0 por **partida** (sólo plasma/láser) |
| Rolado | `t_fijo` 3.0 por virola · 3 pasadas (4 en plegado rectangular) · `k_rolado` 1.6 para conos |
| Armado | `t_fijo_pieza` 6.0 · `t_junta` = 3.0 + 6.0·D_ref[m] · `t_ajuste_aro` 4.0 · `t_fijación` 0.4 · `t_formado_espiga` 3.0 |
| Aros de brida | `t_fijo_aro` 10.0 · `t_roll_aro` 19.0 por metro de barra · holgura de corte 3 mm · **puntas que no se rolan 126 mm** por aro (`proceso.aros`, §3.5.1) |
| Barrenado | 2.0 por barreno |

Los tiempos de las bridas se calibraron con el taller (7-oct-2026): las 30 bridas de solera del caso de §7.4 (22 de 11″, 6 de 10″ y 2 de 9″) llevan **4 días** (32 h) —«se tarda mucho en el rolado y barrenado»—, y con estos tiempos la app da 31.88 h reales. El reparto entre rolado y barrenado es un supuesto (§10.12).
| Engargolado | `t_fijo_pieza` 2.0 · velocidad 3.0 / 2.5 / 1.8 / 1.2 m/min a 0.5 / 1.0 / 1.5 / 2.0 mm |
| Pintura | `t_prep` 4.0 min/m² · `t_aplicación` 3.0 min/m² por mano |
| Inspección y embalaje | `t_fijo_qc` 3.0 · `k_manejo` 0.05 min/kg |

**Otros parámetros de proceso:** `eficiencia_taller` η = 0.80 · hoja estándar 1 219 × 3 048 mm · semiángulo máx. de reducciones 15° · α máx. por junta de codo 22.5° · holguras de costura (mm): `A_TOPE` 1.0, `TRASLAPE` 25, `PITTSBURGH` 32 · soldadura GMAW (`FO` 0.40, 15 L/min, η_dep 0.93, pre/post-flujo 10 %) y GTAW (velocidad ×0.5, `FO` 0.35, 9 L/min, η_dep 0.98, pre/post-flujo 15 %) · `k_cordón` tope 1.75 y filete 1.00, `A_cordón_min` 2.0 mm² · pintura: primario SV 55 %, DFT 50 µm, η_transf. 0.65; esmalte SV 45 %, DFT 40 µm, η_transf. 0.65; diluyente 10 %.

**T7e · Soportería** (`proceso.soportes`): `t_fab_pieza_min` 15 **minutos reales** de taller por pieza (corte, doblez, barreno y punteo, a la tarifa de armado; lo que tarda el taller, sin la eficiencia) · `anclaje_defecto` `TAQUETE_3_8` (un artículo de T3c) · `tornillo` `5/16x1-1/4` (un tornillo de `herrajes.tornillo_precio_ref`) · `oreja_abrazadera_mm` 50 (cada oreja de una abrazadera de media vuelta, §3.6.2). Valores supuestos (§10.12); la partida trae sus propios minutos (las ménsulas del caso: 2 días para las 7).

**T7c · Armado del tramo recto por yardas** (`proceso.armado_yardas`; reglas en §3.2)

| Parámetro (`proceso.armado_yardas.*`) | Valor | Qué es |
| --- | --- | --- |
| `yardas_mm` | 914 · 1,220 | anchos de lámina (yarda) entre los que se elige al cotizar (encabezado de la cotización) o al capturar la partida: 3 ft y 4 ft |
| `yarda_defecto_mm` | 1,220 | la que se usa si ni la cotización ni la partida eligen |
| `yardas_por_pieza_max` | 3 | yardas engargoladas en una pieza con bridas en ambos extremos (el tramo de ajuste cuenta como una) |
| `ajuste_tolerancia_mm` | 25 | un sobrante menor que esto no es tramo de ajuste: a ±25 mm de un múltiplo de la yarda se cuentan yardas completas |
| `junta_entre_yardas` | `PITTSBURGH` | cómo se unen las yardas de una pieza: clave de `proceso.costuras` (engargolado Pittsburgh) |
| `extremo_ajuste_defecto` | `SUELTA` | qué lleva el extremo libre del tramo de ajuste cuando la partida no pide otra cosa: `SUELTA` (aro, tornillos y material de la junta, sueltos), `SIN_BRIDA` (nada) o `CON_BRIDA` (brida de taller) |

**T7d · Pintura** (`proceso.pintura` y `materiales.*.pintura_cuerpo` / `pintura_bridas`; reglas en §4.1 y §4.3). Cada material lleva dos reglas, **una para el ducto y otra para las bridas**, y cada una dice qué sistema se aplica según la instalación:

| `material_id` | Ducto · interior | Ducto · exterior | Bridas · interior | Bridas · exterior |
| --- | --- | --- | --- | --- |
| `ACERO_CARBON` | `ESMALTE` · sólo pintura (esmalte) | `PRIMARIO_ESMALTE` · primario + pintura (esmalte) | `ESMALTE` · sólo pintura (esmalte) | `PRIMARIO_ESMALTE` · primario + pintura (esmalte) |
| `GALVANIZADO` | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura | `ESMALTE` · sólo pintura (esmalte) | `PRIMARIO_ESMALTE` · primario + pintura (esmalte) |
| `INOX_304` | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura |
| `INOX_316` | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura | `NINGUNA` · sin pintura |

Un **sistema** es la lista de manos que recibe una superficie; la instalación por omisión (`ubicacion_defecto`) es `INTERIOR`:

| Sistema (`proceso.pintura.sistemas`) | Manos | Para qué se usa |
| --- | --- | --- |
| `NINGUNA` | — | lo que no se pinta |
| `ESMALTE` | `esmalte` | interior: una mano de pintura (esmalte), sin primario |
| `PRIMARIO` | `primario` | sólo si la partida lo pide |
| `PRIMARIO_ESMALTE` | `primario` + `esmalte` | exterior: primario y pintura |

Las **manos** (valores ilustrativos: confirmar con la ficha técnica de la pintura):

| Mano (`proceso.pintura.capas`) | Sólidos por volumen | Espesor seco | η transferencia | Cobertura teórica | Cobertura práctica | Variable de precio |
| --- | --- | --- | --- | --- | --- | --- |
| `primario` | 55 % | 50 µm | 0.65 | 11.00 m²/L | 7.15 m²/L | `precio_L_primario` |
| `esmalte` | 45 % | 40 µm | 0.65 | 11.25 m²/L | 7.31 m²/L | `precio_L_esmalte` |

**T8 · Tarifas de operación** (`mano_obra`). Los trabajadores ganan **$500 por día** ($3,500 a la semana ÷ 7 días), **sin utilidades ni prestaciones**, y el taller cuesta la hora como el salario del día entre las horas de la jornada (`mano_obra.jornada.horas_dia` = 8): **$62.50 la hora**, más el equipo de la operación. `instalacion` es la tarifa de la cuadrilla en obra (§4.5).

```text
salario_hora = salario_diario / horas_día          # 500 / 8 = 62.50
mo_h         = salario_hora · FSR                   # FSR = 1.00
```

Con FSR = 1.00 la hora **no recupera** lo que se paga y no se trabaja —la semana paga 7 días por 5 trabajados: $1,000 de cada $3,500— ni las prestaciones (IMSS, aguinaldo, vacaciones). Para recuperarlo, `FSR` = 7/5 = **1.40** da $87.50 la hora; con prestaciones, más (§4.1, §7.4.1).

| Operación | Salario por día (MXN) | Salario por hora = día ÷ 8 h | `mo_h` = salario por hora · FSR (1.00) (MXN/h) | Equipo (MXN/h) | Tarifa total (MXN/h) |
| --- | --- | --- | --- | --- | --- |
| `corte` | 500 | 62.50 | 62.50 | 45 | 107.50 |
| `rolado` | 500 | 62.50 | 62.50 | 55 | 117.50 |
| `armado` | 500 | 62.50 | 62.50 | 25 | 87.50 |
| `aros` | 500 | 62.50 | 62.50 | 40 | 102.50 |
| `soldadura` | 500 | 62.50 | 62.50 | 45 | 107.50 |
| `engargolado` | 500 | 62.50 | 62.50 | 35 | 97.50 |
| `barrenado` | 500 | 62.50 | 62.50 | 25 | 87.50 |
| `acabado` | 500 | 62.50 | 62.50 | 20 | 82.50 |
| `pintura` | 500 | 62.50 | 62.50 | 40 | 102.50 |
| `qc_embalaje` | 500 | 62.50 | 62.50 | 0 | 62.50 |
| `instalacion` | 500 | 62.50 | 62.50 | 0 | 62.50 |

**T9 · Capas de precio** (valores ilustrativos; ver §5)

| Parámetro | Valor | Parámetro | Valor |
| --- | --- | --- | --- |
| `herramienta_menor_pct_mo` | 3 % | `administracion_pct_cd` | 8 % |
| `flete_material_pct` | 2 % | `imprevistos_pct` BAJO / MEDIO / ALTO | 2 % / 4 % / 8 % |
| `recuperacion_chatarra_pct` | 0 % | `financiamiento` | 14 % anual, 45 días |
| `gif_por_hora_mod` | 85.00 MXN/h | `utilidad_pct_precio` | 20 % |
| `gif_por_hora_instalacion` | 0.00 MXN/h (la cuadrilla en obra no usa la nave) | | |
| `comision_ventas_pct_precio` | 2 % | `otros_pct_precio` | 0 % |
| `iva_pct` | 16 % | `cargo_minimo_partida` | 250.00 MXN |

**T10 · Límites de captura** (`proceso.limites`; son **política del taller**, no física: protegen de un cero de más al teclear y de archivos dañados. Una partida fuera de ellos se rechaza con un mensaje que dice el límite; se pueden ampliar en las tablas maestras)

| Límite (`proceso.limites.*`) | Valor | Qué limita |
| --- | --- | --- |
| `cantidad_max` | 100,000 | piezas por partida |
| `seccion_min_mm` | 25 | diámetro o lado más chico (nominal) |
| `seccion_max_mm` | 6,000 | diámetro o lado más grande (nominal) |
| `largo_min_mm` | 10 | longitud más corta que se captura (tramo, injerto, tangente…) |
| `largo_max_mm` | 100,000 | longitud más larga (100 m) |
| `espesor_min_mm` | 0.2 | espesor propio (placa) mínimo |
| `espesor_max_mm` | 50 | espesor propio (placa) máximo |
| `piezas_max` | 1,000 | anillos (yardas) de un tramo recto, o piezas a armar de una pieza personalizada |
| `yarda_min_mm` | 300 | ancho de yarda (de lámina) más angosto |
| `yarda_max_mm` | 2,000 | ancho de yarda (de lámina) más ancho |

**T11 · Cotización rápida** (`rapida`; regla del taller, 7-oct-2026; reglas en §5.8). La hoja de la lista del proveedor con que se cuentan las hojas (`hoja_defecto`: galvanizada cal. 22 de 4 × 10 ft), el **factor de la lámina** (`factor_lamina` = 3), la **utilidad** que se suma sobre el costo (`utilidad_pct` = 20 %, ilustrativa) y las **bridas por metros**:

| Metros hasta el punto más alejado | Bridas (MXN sin IVA) |
| --- | --- |
| hasta 40 m | 5,000.00 |
| más de 40 y hasta 80 m | 12,000.00 |
| más de 80 y hasta 120 m | 18,000.00 |

Ninguna partida de la cotización detallada usa esta tabla: un valor inválido aquí sólo detiene la cotización rápida.

#### 2.2.1 Ayuda integrada en el editor de tablas maestras

Las tablas maestras son el lugar donde el taller mete sus números, y un número sin explicación se llena mal. Por eso **cada dato, sección, tabla y grupo del editor trae un botón ⓘ** que abre una ventana emergente (con el cursor en un campo, `F1` hace lo mismo; `Esc` la cierra). Los textos viven en un catálogo propio, `src/datos/ayuda_maestros.js` —no en la interfaz—, y no contienen cifras de cálculo: sólo explicaciones, rangos usuales de referencia y ejemplos.

El catálogo tiene **250 entradas** (cada una con un patrón de ruta, donde `*` cubre una clave) que explican los **577 elementos** que dibuja el editor: 12 grupos, 93 secciones, 459 datos y 13 tablas.

Cada entrada responde tres preguntas y dice qué parte del precio mueve:

| Pregunta | Qué dice |
| --- | --- |
| **¿Qué es?** | El dato en palabras del taller, no en nombres técnicos. |
| **¿Cómo se llena?** | Unidad, de dónde sale el valor, y su **rango usual** (una barra marca dónde está el valor actual; un valor fuera de rango se señala, sin impedirlo). |
| **¿Qué esperar al cambiarlo?** | Hacia dónde mueve el precio y cuánto, con una cifra de ejemplo. Más, según el dato: un *ejemplo* con números, un *Ojo* (por ejemplo «si el encabezado trae su propio margen, el de aquí no se usa»), las *opciones* de una lista o las *columnas* de una tabla. |

Un ejemplo de lo que ve quien pulsa ⓘ junto a la utilidad (el último renglón lo calcula el cotizador con la cotización abierta, no está escrito):

> **Utilidad** · `capas › utilidad_pct_precio`
>
> **¿Qué es?** La ganancia que busca en la venta, como % DEL PRECIO (margen), no del costo.
>
> **¿Cómo se llena?** En %. Margen de 20 % significa que de cada $100 de venta, $20 son utilidad.
>
> *Rango usual: 0 – 50 %*
>
> **¿Qué esperar al cambiarlo?** Precio = costo ÷ (1 − utilidad − comisión − otros). De 20 % a 25 % el precio sube ≈ 6.8 % (no 5 %).
>
> **Ejemplo.** Costo $800 con utilidad 20 % y comisión 2 %: precio = 800 ÷ 0.78 = $1 025.64.
>
> **Ojo.** Si el encabezado de la cotización trae su propio margen, se usa ése en ella.
>
> **Con su cotización** (Ejemplo A, $2,705.19 antes de IVA): si baja 10 % (18 %): ▼ −$67.63 · −2.50 % · si sube 10 % (22 %): ▲ +$71.19 · +2.63 %.

Lo que **sí depende de la cotización abierta** se calcula, no se escribe: cotizar de nuevo con **una copia** de las tablas (`cotizarCon(M)`, que no toca lo guardado). Así la ventana de un número muestra *si baja o sube 10 %* cuánto cambia el precio y permite **probar otro valor sin guardar**; la de una lista **compara cada opción** con la cotización; la de una tabla del proveedor o un grupo de salarios **ajusta todos los valores de golpe** («el proveedor subió 6 %»); y la de un grupo o sección calcula **qué datos de ahí mueven más el precio**. Si la cotización no usa el dato (por ejemplo, la chatarra con recuperación en 0 %), lo dice en vez de mostrar ceros.

Alrededor de la ayuda, el editor se volvió más claro de usar:

| Mejora | Qué hace |
| --- | --- |
| **Nombre en palabras** | Cada renglón dice qué es («Gas mezcla Ar/CO₂») y conserva debajo el nombre de la variable (`precio_m3_gas_mezcla_ar_co2`); se busca por cualquiera de los dos. |
| **Datos que se eligen** | Lo que antes se tecleaba como texto (a qué precio apunta un material o un perfil, la tabla de calibres, el proceso de soldadura, la máquina de corte, el tipo de perfil, las manos de cada sistema de pintura, el cordón) es ahora una **lista**; las de precios traen el valor de cada uno y primero los del tipo que corresponde. Las costuras «se suelda» (Sí/No) y «cordón» (con «Sin cordón») también: antes se editaban como texto libre, y «false» se guardaba como la palabra «false» —que el guardado automático descartaba por no ser un Sí/No— y «null» como la palabra «null». |
| **Lo modificado se ve** | Un renglón distinto del valor de arranque lleva una marca; cada grupo cuenta cuántos tiene; «Sólo modificados (N)» deja a la vista únicamente eso. |
| **Último cambio, con Deshacer** | Cada cambio —tecleado, aplicado desde la ayuda o un ajuste de golpe— deja una barra con lo que se cambió y cuánto movió el precio de la cotización; **Deshacer** regresa uno por uno (hasta 50), un ajuste de golpe cuenta como uno. |
| **Guía rápida** | Cómo se arma un precio (siete pasos, cada uno con enlaces a sus grupos), en qué orden llenar las tablas, cómo leer cada marca y reglas para no equivocarse (unidades, %, ceros). |
| **¿Qué mueve más mi precio?** | Sube cada dato 10 %, uno por uno, vuelve a cotizar la cotización abierta (≈ 330 cálculos, 1–2 s) y ordena: así se ve en qué datos vale la pena invertir tiempo (la eficiencia del taller, el salario, la utilidad…) y cuáles no pesan. |
| **Origen de los datos** | Cada grupo dice si sus valores son *reales* (la lista del proveedor), *parcialmente reales* (mano de obra: salario real, equipo ilustrativo), *de norma* (calibres) o *ilustrativos*. |

La prueba `tests/ayuda_maestros.test.js` hace cumplir las reglas del catálogo: **todo lo que dibuja el editor tiene explicación** (si se agrega un dato a las tablas y no a la ayuda, la prueba falla); ninguna entrada queda sin uso ni tapada por otra; los textos son completos y breves (con tope de caracteres); el valor de arranque de cada número cae dentro de su rango usual; las columnas explicadas son exactamente las que dibuja la tabla; y las opciones que describe son las que el motor acepta.

### 2.3 Reglas de validación

| # | Regla | Efecto |
| --- | --- | --- |
| V1 | `cantidad` entero ≥ 1; familia y material existentes | Error |
| V2 | El calibre existe en la tabla del material (o se captura `espesor_mm`) | Error |
| V3 | Calibre más delgado que el mínimo para (diámetro, `servicio`) — tabla parametrizable `servicios`, **no normativa** hasta que se pueble con la norma interna | Advertencia |
| V4 | Reducción: semiángulo `atan(δ/L)` ≤ 15° | Advertencia |
| V5 | Injerto simple: β en la lista de maestros (`proceso.angulos_injerto_deg` = 30°, 45°); `d ≤ D` (del mismo diámetro es una «Y» lateral; con d/D > 0.8, aviso); `L_ramal > t_max`; tramo de tronco suficiente para el orificio | Error / advertencia |
| V6 | Reducción con injerto: β en la misma lista; `D2 < D1` (con los dos extremos iguales es un Injerto simple, y el error lo dice); `d` menor que el diámetro del cono en su punto medio; `proceso.injerto_inclinado_hacia` ∈ {`MAYOR`, `MENOR`}; la silleta cabe en el cono con la holgura de maestros (si se captura el largo); `L_ramal > t_max`; semiángulo del cono ≤ 15° | Error / advertencia |
| V7 | Codo: θ en la lista de maestros (`proceso.angulos_codo_deg` = 30°, 45°, 60°, 90°); `n_gajos ≥ 2`; `R/D ≥ 1.0` | Error |
| V8 | Merma en [0, 1) | Error |
| V9 | `utilidad + comisión + otros < 100 %` del precio | Error |
| V10 | Toda variable `precio_*` referenciada existe en la tabla de precios | Error |
| V11 | Lista del proveedor: un renglón con precio ≤ 0 o sin medidas válidas no se usa (el cálculo cae al precio por kg de T3) | Silencioso; el renglón se ve como sin $/kg |
| V12 | `salario_diario ≥ 0` en cada operación; horas por día de la jornada de más de 0 a 24 | Error (con el nombre de la operación o de la jornada) |
| V13 | `cotizacion.parametros`: un valor fuera de sus límites (§5.4), no numérico o —en días— no entero se **ignora** y rige el de las tablas maestras; vacío = sin parámetro | Aviso con el nombre del parámetro |
| V14 | **Tipo:** todo campo numérico de la partida es un número finito. Un texto numérico («12.5», «1e3») se acepta y se convierte; `NaN`, `±Infinity`, texto no numérico, listas, objetos y booleanos se rechazan. Un vacío opcional («», `null`) significa «automático» | Error: «Diámetro: «abc» no es un número» |
| V15 | **Rango:** cada medida, longitud, espesor, cantidad y conteo está dentro de T10 o de su rango propio (por ejemplo costuras longitudinales 1–8, gajos 2–60, merma 0–90 %); cero, negativos y «casi cero» (1 mm, 10⁻⁹) se rechazan; en un campo opcional el 0 equivale a vacío | Error con el rango y lo que trae la partida |
| V16 | **Pertenencia:** `familia`, `material_id`, `forma`, `ref_diametro`, `tipo_union`, `clase_sellado`, `pintura`, `ubicacion`, `servicio`, `riesgo`, `proceso_corte`, `perfil_id`, `tipo_costura` y `excentrica` deben existir (ni `constructor` ni `__proto__`); `omitir_operaciones` y `subcontratos` son listas de lo esperado; `caras_pintadas` ∈ {1, 2}; `usa_empaque` es sí/no | Error con las opciones válidas |
| V17 | **Geometría física:** una dimensión **exterior** debe ser mayor que el doble del espesor (si no, no existe el interior); un tramo recto no tiene más anillos (yardas) que `piezas_max` | Error |
| V18 | **Tablas maestras sanas:** divisores y rendimientos (`eficiencia_taller`, velocidades, `paso_tornillo_mm`, `cartucho_ml`, densidad, `FSR`, `sv_pct`, `eta_*`, `FO`…) **> 0**; todo número de las tablas finito y **≥ 0**; merma en [0, 1); tablas espesor → velocidad con espesores crecientes y velocidades > 0; las listas de ángulos y los límites de T10 presentes; en la pintura (T7d), la ubicación por omisión es interior o exterior, cada mano de cada sistema existe y cada material trae un sistema que existe para el ducto y para las bridas, en interior y en exterior. Una partida comprada sólo depende de `capas` | Error «Tablas maestras · ruta: …» en cada partida afectada, y aviso general; nunca un NaN ni un precio infinito |
| V19 | **Resultado numérico:** nada de lo que sale del cálculo de una partida puede ser `NaN` ni infinito | Error que dice dónde |
| V20 | **Datos que vienen de fuera** (navegador, almacén compartido, archivo importado): un parche de maestros conserva sólo lo que tiene la forma de las tablas (un número donde va un número…; lo demás se descarta y se cuenta); una cotización importada conserva lo sano: las partidas que no son objetos se descartan, los `id` se reponen únicos, y los textos, unidades, riesgo y servicio inválidos vuelven a su valor por defecto. `__proto__` nunca entra | Se avisa cuántos valores se ignoraron; un archivo sin lista de partidas se rechaza sin tocar nada |
| V21 | **Armado por yardas:** `yarda_mm` de la partida entre `yarda_min_mm` y `yarda_max_mm` (T10; vacío o 0 = el de la cotización y, si no, el de T7c); `extremo_ajuste` es `SUELTA`, `SIN_BRIDA` o `CON_BRIDA` (el `ajuste_sin_brida` sí/no de una versión anterior se convierte: sí = `SIN_BRIDA`, no = `CON_BRIDA`); en las tablas, `yardas_mm` es una lista de anchos dentro de esos límites, `yardas_por_pieza_max` un entero ≥ 1, `junta_entre_yardas` un tipo de costura que existe y `extremo_ajuste_defecto` uno de los tres extremos | Error con la ruta |
| V22 | `cotizacion.yarda_mm`: un ancho fuera de los límites de la yarda o no numérico se **ignora** y rige el de las tablas (como en V13); vacío = el de las tablas. Sólo lo heredan los tramos rectos | Aviso con el valor |
| V23 | **Familias sin lámina:** `COMPRADO` trae precio o artículo del catálogo; `iva_incluido` es sí/no; `tornillos_pieza` entero 0–1 000 y `circulo_barrenos_mm` una medida (0 = sin junta); `INSTALACION` trae personas (entero 1–100) y días (0.1–1 000); horas por día 0.5–24 (vacío = la jornada); los sí/no de factura son sí/no; `SOPORTE` trae una barra de T3b con precio y largo válidos y un largo por pieza o, en una abrazadera, el diámetro del ducto (`abrazadera_D_mm`), y la pieza cabe en la barra; el anclaje existe en T3c; minutos por pieza 0.1–10 000 (vacío = T7e). `BRIDA` sólo lleva unión `BRIDADO` | Error con el dato |
| V24 | **Catálogo y soportería en las tablas:** IVA de las compras en [0, 100 %); cada artículo trae precio numérico, `iva_incluido` sí/no y, si los trae, `tornillos_pieza` entero de 0 a 1 000, `circulo_barrenos_mm` de 0 a 5 000 mm y una `categoria` del control de gastos; `tornillos_multiplo` entero; el anclaje y el tornillo de T7e existen; la junta de la unión bridada es `SELLADOR` o `EMPAQUE`; la jornada no pasa de 24 h | Error «Tablas maestras · ruta: …» |
| V25 | `cotizacion.venta_pactada`: un importe no numérico o negativo se **ignora** y se avisa (vacío = no hay venta pactada); `venta_pactada_con_iva` y `piezas_enteras` sólo cuentan si son sí | Aviso con el valor |
| V27 | **Extremos y armado:** `extremos_sin_brida` es una lista de los extremos de la familia (sin repetidos; en otra familia, error); `bridas_aparte` es sí/no; `UNION` trae `D_mm` (una medida de sección) y `n_uniones` entero de 1 a 50 | Error con las opciones válidas |
| V26 | **Gastos reales:** cantidad y precio numéricos de 0 en adelante (un renglón inválido se marca y no suma); un renglón vacío no cuenta ni es error; una categoría que no existe pasa a «Otros»; sin decir si hay factura, sí, salvo en mano de obra e instalación (la raya no lleva IVA) | Error por renglón |

La validación vive en `src/motor/validacion.js` (V14–V16, V18, V19), `src/motor/geometria.js` (V17) y `sanearParche` en `src/datos/maestros.js` (V20). Una partida que no se puede calcular **no detiene la cotización**: queda como `{ ok: false, errores }` y las demás se calculan; una falla inesperada del cálculo se atrapa por partida (`interno: true`) en vez de romper la pantalla.

---

## 3. Módulo 2 — Motor geométrico y de material (Core Engine)

### 3.1 Dimensiones derivadas

```text
D_int = D_nom                       si ref_diametro = INTERIOR  (defecto)
      = D_nom − 2·e                 si ref_diametro = EXTERIOR
D_med = D_int + e                   # fibra neutra: es el diámetro que se desarrolla
D_ext = D_int + 2·e                 # para aros, pintura y sellado
```

### 3.2 Tramo recto: armado por yardas

El tramo recto no se fabrica de una pieza: se arma con **yardas**. Una yarda es un **anillo rolado del ancho de la lámina** —914 mm (3 ft) ó 1 220 mm (4 ft)— para aprovechar toda la hoja. Cada yarda se rola por separado; las yardas se **engargolan** entre sí formando piezas, y las piezas se unen en obra con bridas. La regla del taller (los supuestos están en §10.9):

1. **Primero se arman piezas de hasta 3 yardas** (`yardas_por_pieza_max`) engargoladas entre sí, con **brida en ambos extremos**.
2. **Lo que falta** se arma en una última pieza con las yardas completas que sobren (0, 1 ó 2) y un **tramo de ajuste** (menos de una yarda) engargolado a ellas. Esa pieza lleva brida de taller en su extremo normal; el **extremo del ajuste no lleva brida de taller**, para cortarla y ponerla en campo ajustando la distancia. Si lo que sobra es sólo el ajuste, es una pieza aparte con una brida. Qué se cotiza en ese extremo libre lo dice `extremo_ajuste` (más abajo): por omisión, la **brida suelta**.
3. Un sobrante menor que `ajuste_tolerancia_mm` (25 mm) no es ajuste: a ±25 mm de un múltiplo de la yarda se cuentan yardas completas.

**Quién elige el ancho de la yarda.** Lo decide quien diseña: 3 ft (914 mm) ó 4 ft (1 220 mm). Se elige **una vez en el encabezado de la cotización** (`cotizacion.yarda_mm`; lo heredan todos los tramos rectos) y cada partida puede traer **el suyo** (`yarda_mm` de la partida, que manda sobre el de la cotización). Si ninguno elige, rige el de las tablas (`yarda_defecto_mm` = 1 220 mm). El motor acepta cualquier ancho dentro de `yarda_min_mm`–`yarda_max_mm` (T10); la interfaz ofrece los de `yardas_mm`.

```text
Y            = ancho de la yarda (914 ó 1 220 mm) = ancho de la hoja
n_completas  = ⌊(L + tol) / Y⌋ ;   ajuste = L − n_completas·Y        (0 si ≤ tol ; todo L si n_completas = 0)
piezas       = ⌊n_completas / 3⌋ de 3 yardas  +  una última de (n_completas mod 3) yardas + el ajuste, si algo sobra
n_anillos    = n_completas + [ajuste > 0]                           # cada anillo se rola por separado: n_virolas
n_bridas     = 2·n_piezas − [hay ajuste y extremo_ajuste ≠ CON_BRIDA]   # bridas de taller: PF.extremos
n_sueltas    = [hay ajuste y extremo_ajuste = SUELTA]               # aros sueltos, terminados y sin unir al ducto: PF.extremos_sueltos
n_juntas     = Σ_piezas (anillos de la pieza − 1)                   # juntas entre yardas de una misma pieza

B            = π·D_med + n_costuras·a_costura                       # plantilla de un anillo, mm
L_capa       = Σ largo de los anillos                               # = L ± tol
A_neta       = B · L_capa / 10⁶                                     # m²  (+ prolongación de espiga si aplica, §3.5.6)
A_ext        = π·D_ext·L_capa / 10⁶                                 # superficie a pintar
L_corte      = [ n_completas·n_costuras·Y + (ajuste > 0 ? B + n_costuras·ajuste : 0) ] / 1000    # m
L_costura    = n_costuras · L_capa / 1000                           # costura longitudinal de cada anillo
L_juntas     = n_juntas · P_med / 1000                              # engargolado entre yardas

Rectangular:  P_med = 2·(a + b + 2e) ;  B = P_med + n_costuras·a_costura
```

**Cómo queda el armado de algunos largos** (calculado por el motor, `distribuirYardas`, con el extremo del ajuste por omisión, `SUELTA`; «ajuste» = tramo de ajuste, sin brida de taller en su extremo libre; «+» une lo que se engargola en una pieza y «y» separa piezas):

| Largo L (mm) | Yarda (mm) | Armado | Piezas | Anillos (rolados) | Juntas engargoladas | Bridas de taller | Aros sueltos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3,660 | 1,220 | 3 yardas | 1 | 3 | 2 | 2 | 0 |
| 3,000 | 1,220 | 2 yardas + ajuste de 560 mm | 1 | 3 | 2 | 1 | 1 |
| 3,000 | 914 | 3 yardas y ajuste de 258 mm | 2 | 4 | 2 | 3 | 1 |
| 2,735 | 914 | 3 yardas | 1 | 3 | 2 | 2 | 0 |
| 8,000 | 1,220 | 2 × 3 yardas y ajuste de 680 mm | 3 | 7 | 4 | 5 | 1 |
| 10,000 | 1,220 | 2 × 3 yardas y 2 yardas + ajuste de 240 mm | 3 | 9 | 6 | 5 | 1 |
| 10,000 | 914 | 3 × 3 yardas y 1 yarda + ajuste de 860 mm | 4 | 11 | 7 | 7 | 1 |
| 500 | 914 | ajuste de 500 mm | 1 | 1 | 0 | 1 | 1 |

- **Corte.** La yarda *es* el ancho de la hoja, así que cada plantilla de una yarda completa sale con **un solo tajo a lo ancho**; el tramo de ajuste, más angosto que la hoja, necesita además el corte a lo largo (`B`) y su tajo. A lo largo de una hoja de 3 048 mm caben `⌊3 048 / B⌋` plantillas (3 para Ø12″). Si `B` es más largo que la hoja, el motor avisa: cada anillo saldría de varias plantillas, con más costuras longitudinales de las cotizadas.
- **Rolado.** Cada anillo se rola por separado: `n_virolas = n_anillos`, con su tiempo fijo; `L_virola` es el promedio, de modo que `n·L` conserva los metros rolados.
- **Engargolado.** Las juntas entre yardas son engargolado (`proceso.armado_yardas.junta_entre_yardas` = `PITTSBURGH`; si se cambiara a una costura soldada, serían soldadura a tope y juntas de armado). Cada junta y cada costura longitudinal engargolada es una operación (§4.1). Las juntas engargoladas son transversales: llevan sellador en toda clase de sellado menos NINGUNA (§3.5.5).
- **Hoja.** La hoja de la que sale el tramo es del ancho de la yarda: el manejo de hojas (`n_hojas_eq`) usa `Y × 3 048` y el precio de la lámina se busca en la lista del proveedor con ese ancho (§5.1.1).
- **Extremo libre del tramo de ajuste** (`extremo_ajuste`; por omisión el de T7c, `extremo_ajuste_defecto` = `SUELTA`; la partida puede pedir otro). La brida de ese extremo se instala en obra, ajustada a la distancia que se necesite; lo que se cotiza del extremo es:
  - `SUELTA` — el taller manda **suelto** el aro de esa brida **ya terminado** —se rola la solera, se suelda el cierre del aro, se barrena y se pinta— con sus tornillos y el material de su junta (medio cordón de Sikaflex), **sin soldarlo al ducto**: se suelda en obra donde se corta el tramo (§3.5.7). Se cobra el material y esas operaciones; no se cobra el armado del aro al ducto ni el filete aro–ducto.
  - `SIN_BRIDA` — **nada**: la brida y su junta no están en el precio de la partida.
  - `CON_BRIDA` — brida de taller en ambos extremos, como en cualquier otra pieza: se fabrica y se suelda (no queda un extremo libre para ajustar en campo).

  **El extremo final, también sin ajuste** («brida en un extremo»). Los planos de yardas del 30-sep-2026 piden piezas de yardas completas con «bridas en ambos extremos» o con «brida en un extremo» (el otro va liso: se une a otra pieza o a una manguera). Por eso `extremo_ajuste` es el **extremo final del tramo**: si la partida lo elige, vale aunque no haya tramo de ajuste y se aplica al extremo final de la última pieza (`SIN_BRIDA` = brida en un extremo; `SUELTA` = una brida de taller y la otra suelta; `CON_BRIDA` = ambos extremos). Sin elegirlo todo queda como antes: el tramo de ajuste toma el de T7c y un tramo sin ajuste lleva brida en ambos extremos. El sí/no `ajuste_sin_brida` de una versión anterior era sólo del ajuste y así se conserva (`extremo_solo_ajuste`).

  Lo que cambia en el Ejemplo A (3 000 mm; el costo directo CD y el precio salen del motor), con yardas de 4 ft y de 3 ft:

| Yarda (mm) | `extremo_ajuste` | Qué cotiza el extremo libre | Armado | Bridas de taller | Aros sueltos | CD (MXN) | Precio antes de IVA (MXN) | Más que «sin brida» |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,220 | `SIN_BRIDA` | Nada: la brida de ese extremo no está en el precio | 2 yardas + ajuste de 560 mm | 1 | 0 | 1,363.95 | 2,309.63 | — |
| 1,220 | `SUELTA` | El aro terminado (rolado, cierre soldado, barrenado y pintado), los tornillos y el material de su junta; no se suelda al ducto | 2 yardas + ajuste de 560 mm | 1 | 1 | 1,551.51 | 2,705.19 | +395.56 |
| 1,220 | `CON_BRIDA` | Brida fabricada y soldada en taller, como en los demás extremos | 2 yardas + ajuste de 560 mm | 2 | 0 | 1,578.00 | 2,768.21 | +458.58 |
| 914 | `SIN_BRIDA` | Nada: la brida de ese extremo no está en el precio | 3 yardas y ajuste de 258 mm | 3 | 0 | 1,813.26 | 3,282.20 | — |
| 914 | `SUELTA` | El aro terminado (rolado, cierre soldado, barrenado y pintado), los tornillos y el material de su junta; no se suelda al ducto | 3 yardas y ajuste de 258 mm | 3 | 1 | 2,000.81 | 3,677.76 | +395.56 |
| 914 | `CON_BRIDA` | Brida fabricada y soldada en taller, como en los demás extremos | 3 yardas y ajuste de 258 mm | 4 | 0 | 2,027.31 | 3,740.78 | +458.58 |

  La brida suelta cuesta menos que la de taller: es el mismo aro, con el mismo material y las mismas operaciones (rolado, cierre soldado, barrenado y pintura), pero no se arma ni se suelda al ducto y su junta no se sella en taller.

Holguras de costura `a_costura` (mm): soldada a tope 1.0 (holgura de raíz) · soldada a traslape 25 · engargolado Pittsburgh 32 *(valores iniciales: calibrar con la plantilla real del taller)*. Las costuras soldadas generan metros de soldadura; el engargolado genera metros de engargolado y habilita sellado clase B. El pliegue de las juntas entre yardas no suma área: se absorbe en la merma de tabla (§10.9).

### 3.3 Peso de lámina y merma

```text
w_a      = ρ · e / 1000                  # kg/m²   (ρ en kg/m³, e en mm)
m_neta   = A_neta · w_a                  # kg  de la pieza terminada
m_bruta  = m_neta / (1 − φ)              # kg  que hay que COMPRAR (φ = merma, tabla T6)
m_merma  = m_bruta − m_neta
A_bruta  = m_bruta / w_a                 # m²  de lámina que hay que cortar (base del tiempo de manejo de hojas)
crédito_chatarra = rec% · m_merma · precio_kg_chatarra      # opcional; rec% = 0 por defecto
```

La merma φ absorbe **todo** lo que se compra y no queda en la pieza: retazos de la hoja, recortes de ingletes, la caída del orificio de un injerto y el *kerf*. Defaults en T6; el rango típico de taller para accesorios es 15–25 %.

**Modo B opcional (por anidado de hoja)** — para sustituir el porcentaje fijo cuando se tenga el layout real:

```text
η_hoja = (piezas_por_hoja · A_pieza) / A_hoja ;     φ_B = (1 − η_hoja) · (1 − r_retazo)
```

*Verificación de coherencia del default:* la plantilla del Ejemplo A (963.3 × 3 000 mm) en una hoja 1 219 × 3 048 mm rinde η = 77.8 % (22.2 % de retazo geométrico). El default φ = 8 % equivale a reaprovechar ≈ 64 % de ese retazo (franja de ≈ 256 mm × 3 048 mm utilizable en piezas pequeñas).

### 3.4 Accesorios: área neta y multiplicadores

#### 3.4.1 Codo segmentado (gajos)

Un codo de `n_g` gajos se compone de **2 medios gajos en los extremos y `n_g − 2` gajos completos**: equivale a `n_g − 1` gajos completos y tiene `j = n_g − 1` juntas elípticas.

```text
j      = n_g − 1                          # nº de juntas
α      = θ / j                            # desviación por junta
R      = k_R · D_nom                      # radio de eje (k_R = R/D; defecto 1.5)
l_g    = 2·R·tan(α/2)                     # longitud de eje de un gajo completo
L_eje  = j·l_g = 2·j·R·tan(θ/(2j))        # longitud total de eje
A_neta = π·D_med·(L_eje + 2·L_tan) / 10⁶  # m²      (L_tan = tangentes opcionales en cada extremo)
```

**Esta fórmula es exacta, no una aproximación:** el área lateral de un cilindro recortado por planos es *perímetro × longitud medida sobre el eje* (el promedio de la altura alrededor de la circunferencia es la altura en el eje). Se verificó contra una malla 3D del polígono circunscrito con diferencia < 0.005 %.

**Factor de área sugerido.** Contra un tramo recto de longitud igual al arco de eje (`θ·R`):

```text
F_arco = L_eje / (θ·R) = tan(α/2) / (α/2)         # sólo depende de la desviación por junta α
λ      = L_eje / D_nom = 2·j·k_R·tan(α/2)         # longitud de eje en diámetros
A      = π·λ·D_med² ≈ π·λ·D²
```

**Ángulos del taller.** Los codos son de **30°, 45°, 60° y 90°** (lista de maestros `proceso.angulos_codo_deg`; el cotizador rechaza otros). Con α ≤ 22.5° por junta salen 3, 3, 4 y 5 gajos (primeras cuatro filas, R/D = 1.5); si el taller usa otro número de gajos se captura `n_gajos`. Las demás filas muestran cómo cambia el factor con más o menos gajos.

| θ | Gajos | α por junta | **F_arco** | λ (R/D=1.5) | A/D² (R/D=1.5) | λ (R/D=2.0) | A/D² (R/D=2.0) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90° | 5 | 22.50° | 1.01305 | 2.38695 | 7.4988 | 3.18260 | 9.9984 |
| 60° | 4 | 20.00° | 1.01028 | 1.58694 | 4.9855 | 2.11592 | 6.6474 |
| 45° | 3 | 22.50° | 1.01305 | 1.19347 | 3.7494 | 1.59130 | 4.9992 |
| 30° | 3 | 15.00° | 1.00575 | 0.78991 | 2.4816 | 1.05322 | 3.3088 |
| 90° | 3 | 45.00° | 1.05479 | 2.48528 | 7.8077 | 3.31371 | 10.4103 |
| 90° | 4 | 30.00° | 1.02349 | 2.41154 | 7.5761 | 3.21539 | 10.1014 |
| 90° | 7 | 15.00° | 1.00575 | 2.36974 | 7.4448 | 3.15966 | 9.9264 |

> **Respuesta al campo `[COMPLETAR: Factor sugerido]`:** codo de 90° de 5 gajos, R/D = 1.5 → **`Área codo = Área tramo recto(L = π/2·R) × 1.0131`**, equivalente a `A = 7.4988·D²`. El codo liso de radio (prensado) vale exactamente `F = 1.0000` por el teorema de Pappus: `A = π·D_med·θ·R`.

> **No confundir el factor geométrico con el factor de costo.** Un codo de 5 gajos sólo tiene ~1.3 % más lámina que su tramo recto equivalente, pero cuesta varias veces más **por kg**. Ese sobrecosto sale de la merma (20 % vs 8 %), del corte perfilado, del armado (`k_dif`) y de la soldadura de `j` juntas elípticas, y se modela allí (§4), no inflando el área. El Ejemplo B lo cuantifica.

Perímetro de cada junta (elipse de semiejes `r/cos(α/2)` y `r`): `P_junta ≈ π·D_med·κ`, `κ = √(1 + tan²(α/2)/2)` (error < 0.04 % hasta α/2 = 22.5°).

**Codo rectangular de radio** (talón, garganta y 2 carrillos): `A_neta = P_med·θ·R`, con `P_med = 2·(W_med + H_med)` y `R = k_R·a` (Pappus, exacto).

#### 3.4.2 Reducción (tronco de cono)

```text
r1 = D1_med/2 ;  r2 = D2_med/2 ;  δ = r1 − r2
L  = dato, o  L = δ / tan(semiángulo_máx)              # semiángulo_máx = 15° (política)
s  = √(L² + δ²)                                         # generatriz
A_conc = π·(r1 + r2)·s = (π/2)·(D1_med + D2_med)·s
F_long = s / L = sec(semiángulo)                        # vs recto de igual L y diámetro medio (15° → 1.0353)

Patrón plano (sector anular):  φ = π·(D1_med − D2_med)/s ;  R1 = s·D1_med/(D1_med − D2_med) ;  R2 = R1 − s

Excéntrica (desfase c entre centros; cara plana: c = δ):
A = ((r1 + r2)/2) · ∫₀^{2π} √( L² + ((r2 − r1) + c·cosφ)² ) dφ          # Simpson, 360 subintervalos
```

El área excéntrica supera a la concéntrica apenas **+0.2 % (δ/L = 0.1), +0.9 % (0.2), +4.0 % (0.5)**: el sobrecosto de una reducción excéntrica está en la mano de obra (trazo y armado), no en la lámina.

#### 3.4.3 Transición redondo → rectángulo (centrada)

Desarrollo estándar por triangulación: 4 triángulos planos sobre los lados del rectángulo + 4 conos oblicuos con vértice en las esquinas. Con `a, b` = dimensiones **medias** del rectángulo, `r = D_med/2` y `H` = longitud axial:

```text
A = b·√(H² + (a/2 − r)²) + a·√(H² + (b/2 − r)²)
    + 2r · ∫₀^{π/2} √( H² + (r − (a/2)·cosφ − (b/2)·sinφ)² ) dφ

Revisión rápida (Excel):  A ≈ ½·(P_rect + π·D_med)·s ,  s = √(H² + ((P_rect/π − D_med)/2)²)      # ±3 % en las geometrías probadas
s_ref = 2A / (P_rect + π·D_med)                                                                   # generatriz de referencia para costuras
```

Verificada contra malla 3D explícita (diferencia < 0.002 %).

#### 3.4.4 Injerto simple (lateral / te)

Injerto de diámetro `d` que entra a un tronco de diámetro `D` con ángulo β entre ejes (90° = te; 30°–45° = lateral típico en colección de polvo; confirmar contra la norma que aplique). Los injertos del taller son **a 30° o 45°** (lista de maestros `proceso.angulos_injerto_deg`): la geometría vale de 20° a 90°, pero el cotizador sólo acepta los ángulos de la lista. En el motor el tronco es el *cuerpo* y el injerto es el *ramal* (de ahí `L_cuerpo`, `L_ramal`, `A_ramal` y el id `RAMAL`).

```text
k      = d_med / D_med   (≤ 1)
t_med  = (D_med / (2·sinβ)) · (2/π)·E(k)          # distancia media, sobre el eje del injerto, del eje del tronco a la silleta
       ≈ (D_med / (2·sinβ)) · (1 − k²/4 − 3k⁴/64) # error < 0.04 % si k ≤ 0.5 ; < 0.7 % si k ≤ 0.75
t_max  = (D_med/2 + (d_med/2)·cosβ) / sinβ        # el injerto debe medir más que t_max
A_ramal    = π·d_med·(L_ramal − t_med)
A_orificio = (π·(d_med/2)² / sinβ) · K(k) ,   K(k) = 1 + k²/8 + 3k⁴/64 + …    # 1.02 – 1.09 para k = 0.4 – 0.75 ; K(1) = 4/π
A_neta     = π·D_med·L_cuerpo − A_orificio + A_ramal
```

`E(k)` es la integral elíptica completa de 2.ª especie: `(2/π)·E(k)` = promedio angular de `√(1 − k²·sin²φ)`. La caída del orificio es chatarra y la cubre la merma de la familia (25 %): `A_neta` ya la descuenta (así el peso neto es el de la pieza terminada) y `m_bruta = m_neta/(1 − φ)` la repone como merma.

**Del mismo diámetro (d = D).** Los planos de pedido del 30-sep-2026 piden «de 11″ a 11″ con injerto de 11″»: una «Y» lateral. Con k = 1 las fórmulas siguen valiendo: `(2/π)·E(1) = 2/π`, así que `t_med = D_med/(π·sinβ)`, y `K(1) = 4/π`, así que el orificio mide `D_med²/sinβ` (el injerto corta medio tronco). El motor lo acepta y avisa cuando d/D > 0.8: la silleta abraza (casi) medio tronco y la soldadura pide revisión.

**Perímetro de la silleta.** `P_h` (el filete de la silleta y su corte) se integra sobre la curva en que se cortan los dos cilindros (2 880 puntos). La elipse `π·d_med·√((1 + csc²β)/2)` con que se aproximaba se quedaba corta: 5 % con d/D = 0.8 y 14 a 18 % con d = D, porque la silleta no es plana.

Verificación independiente: `t_med` contra el promedio por fuerza bruta de la distancia de silleta, `A_orificio` contra una malla fina sobre la pared del tronco (30°, 45°, 60° y 90°; diferencia < 0.005 %) y `P_h` contra la polilínea de la silleta calculada aparte, para todo k hasta 1.

#### 3.4.5 Reducción con injerto (30° o 45°): el injerto va sobre el cono

La pieza es una reducción (cono de `D1` a `D2`) con el injerto de diámetro `d` soldado **sobre el cono**, a β = 30° o 45° respecto al eje. Es el cono con el orificio de la silleta más la pared del injerto: **2 piezas, 1 junta interna y 3 bridas** (D1, D2 y el injerto).

**Intersección injerto–cono.** Con el eje del cono sobre `x` (radio `r(x) = R1 − m·x`, `m = (R1 − R2)/L`) y el eje del injerto cruzándolo en `(x_j, 0, 0)` a β, cada generatriz `φ` del injerto toca el cono a la distancia axial `t(φ)` de ese cruce. Es la raíz positiva de una cuadrática (cilindro ∩ cono es una cuádrica por recta):

```text
u = (s·cosβ, sinβ, 0)            s = +1: el injerto se inclina hacia el extremo MENOR (de mayor a menor, como lo maneja el taller) ; −1: hacia el MAYOR
A0 = R1 − m·x_j                  # radio del cono en el cruce
c  = r_b·sinφ·u_x ,   d0 = A0 + m·u_y·r_b·sinφ
a  = u_y² − m²·u_x²   (> 0 ⇔ tan β > m: el injerto sale más inclinado que la generatriz del cono)
b  = 2·(u_y·c + m·u_x·d0) ,   g = c² + r_b²·cos²φ − d0²
t(φ) = ( −b + √(b² − 4·a·g) ) / (2·a)                 # punto de la silleta: x_j + t·u_x − r_b·sinφ·u_y , …

t_med = promedio de t(φ) ;  t_max = máx t(φ) ;  P_h = longitud de la polilínea de la silleta (2 880 puntos)
A_orificio = | ∮ G(x) dθ | ,   G(x) = √(1 + m²)·(R1·x − m·x²/2)                # Green sobre (x, θ): dA = r·√(1 + m²) dx dθ
```

Por cada punto de la silleta no se usan mallas: el orificio sale de una integral de línea de una función suave y periódica. Con `m → 0` el cono es un cilindro y los tres resultados coinciden con el injerto simple (§3.4.4).

**Hacia qué extremo se inclina.** El taller siempre lo lleva **de extremo mayor a menor**: el injerto se inclina hacia el extremo menor D2 (`proceso.injerto_inclinado_hacia = MENOR`, `s = +1`) y no se captura por partida; una cotización anterior que traía `sentido` lo ignora. Con el injerto hacia el extremo menor el ángulo efectivo con la pared es β + σ; hacia el mayor sería β − σ (σ = semiángulo del cono). Esa diferencia mueve el orificio (≈ 20 % más hacia el mayor a 45° y ≈ 37 % a 30°, para un cono de 5°), la silleta, el largo del cono y el precio (≈ 3 % a 45°, ≈ 5 % a 30°): por eso se deja como dato de maestros y se confirma con el taller (§10.5).

**Largos (se pueden capturar; si se omiten son automáticos)**

```text
Silleta centrada en L/2:   x_j = ( x_c·(u_y + m·u_x) − u_x·R1 ) / u_y ,   x_c = L/2
L_reducción = menor L tal que  x_min ≥ holgura  y  x_max ≤ L − holgura        # holgura = 25 mm ; piso: el largo de 15° de semiángulo
              (punto fijo L = máx( L_15° , 2·(holgura + semialcance de la silleta(L)) ) ; converge en pocas vueltas)
L_ramal     = t_max + 150 mm                                                   # generatriz más larga + tramo recto de maestros
```

**Cantidades**

```text
s        = √(L² + (R1 − R2)²)                                                    # generatriz del cono
A_neta   = π·(R1 + R2)·s − A_orificio + π·d_med·(L_ramal − t_med)               # cono − orificio + pared del injerto
L_corte  = [ π·(D1_med + D2_med) + 2·s ] + P_h + 2·(π·d_med + L_ramal)
Tope     = s + (L_ramal − t_med)                                                 # costura del cono + costura del injerto
Filete   = P_h                                                                   # silleta
Piezas   = 2 ; juntas internas = 1 ; extremos bridados = 3
Rolado   : n·k·L = k_cónico·s + L_ramal                                          # cono k = 1.6 ; injerto k = 1
```

- **Ángulo:** sólo 30° o 45° (lista de maestros `proceso.angulos_injerto_deg`, la misma de todo injerto). A 30° la silleta es más larga: más orificio, más soldadura de filete, un injerto más largo y un cono más largo.
- `merma` (28 %) y `k_dif` (1.9) son valores ilustrativos heredados del pantalón; calibrar con órdenes reales.

Verificación independiente (`tests/geometria.test.js`): `t(φ)` por bisección sobre la ecuación del cono (sin la cuadrática), el perímetro por una polilínea de 20 000 puntos, y el área del orificio por una rejilla fina sobre la superficie del cono (diferencias < 0.001 %); además, el límite `m → 0` contra el injerto simple y el ensamble completo (área, corte, soldadura, piezas y rolado) recalculado línea por línea. El Ejemplo C (§7.3) lo resuelve completo.

**Familia retirada — pantalón (Y simétrica).** Se retiró de la interfaz. El motor la conserva (id `PANTALON`; tronco más dos ramales con un factor de entrepierna `k_ent` = 0.08, ±10 %) únicamente para que una cotización anterior que la traiga siga calculando; cada vez avisa «Familia retirada».

#### 3.4.6 Resumen de multiplicadores por familia

| Familia | Área neta | Multiplicador vs. recto equivalente | φ merma | `k_dif` |
| --- | --- | --- | --- | --- |
| Recto | `B·L` | 1.0000 | 8 % | 1.00 |
| Codo 90°, 5 gajos, R/D 1.5 | `π·D_med·L_eje` = 7.4988·D² | **F_arco = 1.0131** | 20 % | 1.35 |
| Codo liso (radio) | `π·D_med·θ·R` | 1.0000 (Pappus) | — | — |
| Reducción concéntrica (15°) | `π/2·(D1+D2)·s` | sec 15° = 1.0353 | 18 % | 1.20 |
| Reducción excéntrica (cara plana) | integral §3.4.2 | +0.2 % … +4 % sobre concéntrica | 18 % | 1.20 |
| Transición redondo→rect. | triangulación §3.4.3 | ≈ ½(P₁+P₂)·s (±3 %) | 22 % | 1.50 |
| Injerto simple 45° | tronco − orificio + injerto | `A_inj = π·d·(L − t_med)` | 25 % | 1.60 |
| Reducción con injerto 30°/45° | cono − orificio + injerto (§3.4.5) | numérica; verificada por fuerza bruta | 28 % | 1.90 |

#### 3.4.7 Costuras y juntas del galvanizado: engargoladas

El taller **engargola siempre el galvanizado** (7-oct-2026): las yardas entre sí, las costuras y las uniones entre piezas; nada se suelda. La costura del material (`materiales.*.costura`, T1) lo dice: si es una costura no soldada de T7 (Pittsburgh), lo que la familia soldaría se engargola:

```text
transversal  = juntas entre gajos (codo) · silleta (injertos) · unión entre piezas (armado)      # PF.sold_transversal_m
longitudinal = el resto de la soldadura de la familia (costura de cada gajo, del cono, del tronco y del injerto)
engargolado_circ += transversal        # se pliega como la junta entre yardas: el pliegue va en la merma; con clase C se sella
engargolado_long += longitudinal       # con clase B se sella
A_neta          += longitudinal · holgura_Pittsburgh (32 mm)          # la lámina del engargolado
n_engargolados   = costuras (una por virola) + juntas internas       # una operación de engargolado por costura y por junta
soldadura de la lámina = 0              # sólo quedan los cierres de los aros, que son de solera
```

El tramo recto ya lo traía: su costura longitudinal es la de la partida (vacía = la del material) y la junta entre yardas, la de T7c (Pittsburgh). La pieza personalizada conserva lo capturado. Lo que cambia en el pedido completo de §7.5 está en esa sección.

### 3.5 Herrajes de unión: bridas, tornillería, junta (Sikaflex o empaque), sellador y espiga

#### 3.5.1 Aros de brida (solera de 1½" × 3/16" rolada "de canto")

El aro se forma rolando la solera de canto: el ancho `b` queda en el plano radial (el aro "se para" sobre el ducto) y el espesor `t` en el eje.

```text
SOLERA (estándar del taller)   b = 38.1 mm (ancho) ,  t = 4.763 mm (espesor)
c     = b / 2                                               # centroide radial, mm  (19.05)
A_p   = b · t                                               # área de la sección, mm²  (181.5)
w_p   = b · t · 7.85 / 1000                                 # peso lineal, kg/m  (1.4245)
L_aro = π·(D_ext + 2c) + holgura_corte + puntas_rolado      # longitud de barra por aro, mm (fibra neutra ≈ centroide); puntas = 126 mm
m_aros_neta  = Σ_aros (L_aro/1000)·w_p
m_aros_bruta = m_aros_neta / (1 − φ_perfil)                 # φ_perfil = 5 % (retazos de barra de 6 m)

Marco rectangular:  L_marco = 2·(a_ext + b_ext) + 8c + 4·holgura_corte

Perfil de ángulo (opcional, `tipo = ANGULO`; rola el ala de ancho b):
  c   = (b·t + b² − t²) / ( 2·(2b − t) )                    # centroide medido desde el dorso del ángulo
  w_p = t·(2b − t)·7.85 / 1000
```

Despreciar `c` acortaría cada aro ≈ 11 % (≈ 120 mm en un Ø12"): el aro no cerraría sobre el ducto.

**Puntas que no se rolan.** La roladora no puede curvar los extremos de la solera: cada aro se corta más largo y, ya rolado, se le quitan las dos puntas rectas antes de cerrarlo. Esa solera se compra y se paga aunque no quede en la brida, y la regla con que el taller corta la solera la incluye: en la hoja de control de gastos cada aro mide **π·(D + 81 mm)**. El motor la reproduce con `puntas_rolado_mm` = 126 mm (`proceso.aros`): en el aro de 11″ de lámina galvanizada cal. 22, `π·(279.4 + 2·0.853 + 38.1) + 3 + 126 = 1 131.8 mm` contra `π·(279.4 + 81) = 1 132.2 mm` de la hoja (§7.4). Las puntas sólo se agregan a los aros redondos: el marco rectangular no se rola.

#### 3.5.2 Barrenos y tornillería

El barreno (Ø3/8" = 9.525 mm, holgura diametral de 1/16" sobre el tornillo de 5/16") y el tornillo (5/16" × 1¼") son datos del perfil (T4). El barreno va a **24 mm del borde interior** del aro: es el gramil de los planos de pedido del 30-sep-2026 (Dperf = Dint + 48 mm), 5 mm afuera del centro de la solera de 1½″. Cada brida lleva un **número par de barrenos, al menos 6**, a no más de 150 mm de paso: los planos traen 8 en las bridas de 11″ y 10″ y 6 en las de 9″, 7″, 6″ y 5″, y eso da la regla.

```text
D_bc        = D_ext + 2·g                                   # círculo de barrenos; g = gramil del perfil (T4) = 24 mm
n_tornillos = par_hacia_arriba( máx( n_mín , ⌈ π·D_bc / paso_máx ⌉ ) )     # por junta = barrenos por brida; n_mín = 6
n_juntas_asignadas = 0.5 · (n_extremos_bridados + n_aros_sueltos)   # cada junta se comparte entre dos piezas
juegos      = Σ_extremos 0.5·n_tornillos · (1 + f_reserva)  # juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas; extremos de taller y sueltos
n_barrenos  = Σ_aros n_tornillos                            # cada aro lleva sus barrenos: el de taller y el suelto (§3.5.7)
Marco rectangular:  P_perno = 2·(a_ext + b_ext) + 8·g
```

Los juegos se agrupan por tipo de tornillo del perfil y cada tipo se valoriza con su propia variable (`precio_juego_tornillo_5_16_x_1_1_4` para el estándar del taller).

#### 3.5.3 Soldadura de aros

```text
L_filete_aro = Σ_extremos_de_taller f_cont · P_ext  # aro–ducto, al espesor de la LÁMINA ; P_ext = π·D_ext ; f_cont = 1.0 (continuo, hermético); no los aros sueltos (§3.5.7) ni las bridas con ceja (§3.5.9)
L_cierre_aro = Σ_aros b                             # costura a tope que cierra el aro: una sección de ancho b (rect.: 4 esquinas × b ; ángulo: 2b por cierre); todos los aros, también los sueltos
A_cordón_cierre = máx( A_mín , k_tope · t² )        # con el espesor t de la SOLERA, no el de la lámina (4.763 mm → 39.7 mm²)
```

El cierre del aro se suelda en un espesor mayor que el de la lámina, así que su cordón es más grande y su velocidad de avance menor (§4.1 y §4.3).

#### 3.5.4 Junta de la brida: Sikaflex (o empaque)

El taller sella la cara de la brida con un **cordón de Sikaflex sobre el círculo de barrenos**, en lugar del empaque de neopreno (respuesta del taller del 7-oct-2026). Es la opción de arranque, `uniones.BRIDADO.junta = SELLADOR`; `EMPAQUE` vuelve a la cinta de neopreno. Cada brida lleva media junta —la otra mitad es de la brida con que se une—, sea de taller, suelta (§3.5.7) o una brida de placa comprada con su círculo de barrenos (§3.6.3):

```text
SELLADOR:  L_junta   = Σ_extremos 0.5 · P_perno / 1000                       # m de cordón sobre el círculo de barrenos
           V_junta   = L_junta · ml_sellador_junta_m · (1 + f_merma)          # 40 mL/m · 1.15 ; se suma al sellador (§3.5.5)
EMPAQUE:   L_empaque = Σ_extremos 0.5 · P_perno · (1 + f_traslape) / 1000     # m de cinta de neopreno 1½" × 1/8", traslape 5 %
```

Con `usa_empaque = false` la partida no lleva material de junta (ni cordón ni cinta). El cordón de 40 mL por metro (≈ un cordón de 7 mm) es un supuesto (§10.12).

#### 3.5.5 Sellador por clase (SMACNA)

```text
Clase C : juntas transversales                      L = Σ_extremos_de_taller 0.5·P_ext  (bridado con EMPAQUE)  |  Σ_espigas P_ext
                                                        + L_juntas engargoladas entre yardas
Clase B : C + costuras longitudinales NO soldadas   L = C + L_engargolado_longitudinal
Clase A : B + penetraciones                         L = B + L_penetraciones
V_sellador = L · ml_por_m · (1 + f_merma) + V_junta  # ml_por_m = 20 mL/m (cordón ≈ 5 mm) ; f_merma = 15 % ; V_junta de §3.5.4
Costo      = V_sellador · precio_cartucho / mL_cartucho
```

Las costuras **soldadas** son herméticas y no consumen sellador. Con la junta de **Sikaflex** (`SELLADOR`), el cordón de la junta ya sella la junta transversal de bridas: la clase C no le suma el suyo (sólo las juntas engargoladas, las espigas y lo de las clases B y A).

#### 3.5.6 Espiga (macho–hembra)

```text
A_espiga      = Σ_extremos_macho P_med_ext · prof_espiga / 10⁶       # lámina extra del macho (se suma a A_neta)
L_corte_extra = 2·prof_espiga / 1000                                  # por macho
n_fijaciones  = máx( n_mín , ⌈ P_ext / paso_fijación ⌉ )              # por junta (autotaladrante o remache)
n_juntas      = nº de machos                                          # sellador clase C: 1 cordón por junta
```

Tramo recto: 1 macho por pieza. Accesorios: un macho por extremo (configurable con `n_espigas`).

#### 3.5.7 Brida suelta (extremo libre del tramo de ajuste)

Cuando el extremo del ajuste se cotiza como `SUELTA` (§3.2), el taller fabrica el aro **completo**, pero **no lo une al ducto**: ese extremo se corta y se ajusta en campo, así que el aro sale suelto —con sus tornillos y el material de su junta— y se suelda en obra. El motor lo trata como un aro de brida al que se le hace todo menos unirlo:

```text
extremos_sueltos      = PF.extremos_sueltos                  # un extremo por tramo de ajuste con brida suelta (sólo unión BRIDADO)
aro suelto            = el aro de §3.5.1, del mismo perfil y diámetro:  L_aro , m_aro , m_aro_bruta = m_aro / (1 − φ_perfil)

Material (como cualquier brida):
  costo del perfil     += m_aro_bruta · precio_kg_perfil      # y el flete de entrada (2 %) también cubre el perfil del aro suelto
  juegos de tornillería += 0.5 · n_tornillos · (1 + f_reserva)  # media junta (§3.5.2)
  junta                += 0.5 · P_perno                         # medio cordón de Sikaflex (o medio empaque) (§3.5.4)

Se le hace en taller (igual que a un aro de taller):
  Aros          t += t_fijo_aro + t_roll_aro · L_aro / 1000    # se rola la solera
  Barrenado     n_barrenos += n_tornillos                       # se barrena
  Soldadura     L_cierre += b ; el cordón es el del espesor de la solera   # se suelda el cierre del aro (§3.5.3)
  Pintura       A_pint += A_pintura_aro                         # se pinta (si la partida lleva pintura)
  Inspección    m_neta_total += m_aro                           # se inspecciona y se embala

NO se le hace (se hace en obra):
  Armado        no suma t_ajuste_aro                            # no se arma al ducto: n_aros cuenta sólo los aros de taller
  Soldadura     no suma el filete aro–ducto                     # no se suelda al ducto
  Sellador      no suma el cordón de la clase de su media junta # con EMPAQUE la junta se sella en obra; con Sikaflex, su cordón es el sello
```

El acabado (`f_acabado · t_soldadura`) y los consumibles de soldadura y de pintura siguen a esos metros y esa superficie. El peso que se manda incluye el aro (`peso.aros_sueltos_neto_kg`) y los drivers de subcontrato por kilogramo (`KG_NETO`, `KG_BRUTO`) y por metro de soldadura (`M_SOLDADURA`) lo cuentan, porque es acero fabricado que va en la partida. Con unión `ESPIGA` o `LISO` no hay aros: `SUELTA` y `SIN_BRIDA` cuestan lo mismo.

#### 3.5.8 Extremos sin brida, bridas de otra partida y cuadre de bridas

Los planos de pedido dicen en qué extremos va brida y cuáles **se unen a otra pieza** (el armado de piezas del 2-oct-2026: «unir injerto de 11″ con codo de 60° para obtener 90°») o a una manguera. Y en el proyecto real las bridas no las hace quien hace el ducto: las de solera salen del taller y las de placa las corta un proveedor. El motor lo modela así:

```text
Cada extremo tiene nombre:   CODO A, B · REDUCCION D1, D2 · TRANSICION redondo, rectangular · RAMAL tronco_1, tronco_2, injerto
                             REDUCCION_INJERTO D1, D2, injerto · RECTO: el extremo final (§3.2) · BRIDA: brida
extremos_sin_brida = [ids]   → PF.extremos sin esos (ni aro, ni tornillería, ni junta, ni filete aro–ducto, ni sellador de su junta)

bridas_aparte (BRIDADO): por cada brida de taller de la pieza sólo
  Armado      t += t_ajuste_aro                                # se arma el aro al ducto (n_aros_aparte)
  Fijación    L_filete += f_cont · P_ext   (o la ceja, §3.5.9) # se suelda al ducto o se le hace la ceja
  Sellador    la media junta de la clase, como una brida de taller (con Sikaflex en la junta, nada)
y nada del aro: ni perfil, ni rolado, ni cierre, ni barrenos, ni pintura, ni tornillería, ni el cordón de la junta (son de la partida de bridas)
La suelta de otra partida no cuesta nada aquí (se arma en obra).
```

Cada brida que lleva una pieza queda anotada con su medida nominal (`qto.her.bridas`: extremo, forma, `D_nom_mm`, suelta, de otra partida). Con eso la cotización arma el **cuadre de bridas** (`res.bridas`): por diámetro, las que piden las piezas con `bridas_aparte` (de taller y sueltas) contra las que hay en las partidas de Bridas sueltas y en las bridas compradas cuyo artículo dice para qué ducto son (`ducto_D_mm` de T3c: 127, 152.4 y 177.8 mm en las de placa de 5″, 6″ y 7″). `diferencia = hay − piden`: negativa, faltan; positiva, sobran. La pestaña Planos lo muestra arriba de las hojas (§8.5); en el pedido completo dice qué falta y qué sobra (§7.5).

#### 3.5.9 Brida con ceja (galvanizado)

En galvanizado las bridas —las de solera y las de placa— **no se sueldan**: «primero se meten y después se les hace una ceja para evitar que salgan, y ya se sella con su otra pieza» (el taller, 7-oct-2026). Con `brida_al_ducto = CEJA` (T1), cada brida de taller de la pieza (propia o de otra partida) lleva:

```text
Armado     t += t_ajuste_aro                                        # meter y alinear el aro (con la dificultad de la familia)
           t += t_ceja_aro_min + t_ceja_aro_min_m · P_ext / 1000      # la ceja: una operación en la boca, sin la dificultad de la familia
Lámina     A += P_ext · ceja_mm / 10⁶                                 # la franja que se dobla sobre la brida (ceja_mm = 10)
Soldadura  nada: ni filete aro–ducto, ni su alambre, gas y acabado
Junta      la de siempre: el cordón de Sikaflex sobre los barrenos sella contra la otra pieza
```

Los tres valores (`t_ceja_aro_min` 2 min, `t_ceja_aro_min_m` 3 min/m y `ceja_mm` 10 mm) son supuestos por confirmar (§10.13). La brida suelta del tramo de ajuste se mete y se le hace la ceja en obra: aquí no cuesta.

### 3.6 Bridas sueltas, soportería y artículos comprados

#### 3.6.1 Bridas sueltas (`BRIDA`: sólo aros)

Una partida de **bridas sueltas** cotiza aros terminados que se mandan sin unir a un ducto: los del ducto que fabricó un proveedor, refacciones o bridas que se sueldan en obra. Su medida es **la del ducto en que van** (redondo `D_mm` o rectangular `a_mm × b_mm`) y su material y calibre son los del ducto: dan `D_ext` y la regla de pintura de las bridas (el galvanizado pinta sus bridas, T7d). No hay lámina que cortar, rolar ni armar; cada unidad es el aro suelto de §3.5.7 —rolado, con el cierre soldado, barrenado y pintado— con su media junta de tornillos y de Sikaflex (o empaque). Sólo lleva unión bridada (V23).

```text
PF.familia = BRIDA ;  A_neta = 0 ;  n_piezas = 0 ;  n_virolas = 0 ;  extremos_sueltos = [ el del ducto ]
por unidad:  1 aro suelto (L_aro de §3.5.1, con las puntas) + 0.5·n_tornillos juegos + 0.5·P_perno de cordón de Sikaflex (o de empaque)
horas:       aros + soldadura (cierre) + barrenado + acabado + pintura (bridas) + inspección          # sin corte, rolado ni armado
```

#### 3.6.2 Soportería (`SOPORTE`)

Ménsulas, abrazaderas y postes que se cortan de una **barra de la lista del proveedor** (T3b): cada pieza usa `largo_pieza_mm` de barra, puede llevar anclajes del catálogo de compras (T3c) y tornillos, y cuesta **minutos reales** de taller (corte, doblez, barreno y punteo: lo que dice el taller que tarda, sin la eficiencia) a la tarifa de armado. Una **abrazadera** de media vuelta se puede pedir por el diámetro del ducto que abraza (`abrazadera_D_mm`): su largo sale solo.

```text
largo     = largo_pieza  |  π·(abrazadera_D + t)/2 + 2·oreja           # abrazadera: media vuelta en la fibra neutra de la solera (t = su espesor) y dos orejas de 50 mm (T7e)
L_total   = cantidad · largo / 1000                                    # m de barra
perfil    = L_total · precio_m_sin_IVA / (1 − φ_perfil)                # la fracción de barra que se usa, con la merma de perfil (T6)
anclajes  = cantidad · anclajes_pieza · precio_sin_IVA(articulo_anclaje) # por omisión el de T7e (taquete de 3/8″)
tornillos = cantidad · tornillos_pieza · precio_juego(T7e.tornillo)
h_taller  = cantidad · min_pieza / 60                                 # min_pieza: el de la partida o T7e (15 min); minutos reales, sin η
CD        = perfil + anclajes + tornillos + h_taller · (mo_h + equipo_h)(armado) + herramienta_menor
peso      = cantidad · kg_m · largo / 1000
```

Para la abrazadera del ducto de 11″ del caso de §7.4, con solera de 1¼″ × 1/8″: π·(279.4 + 3.175)/2 + 2·50 = **543.87 mm**; las 7 salen de una solera de 6 m.

Una pieza más larga que la barra se rechaza (no sale de una sola barra). Cuántas barras completas hay que comprar lo dice la lista de compras (§5.5), que acomoda las piezas en las barras.

#### 3.6.3 Artículos comprados (`COMPRADO`) y el catálogo de compras (T3c)

Lo que se compra hecho —el ducto que fabrica un proveedor, mangueras, abrazaderas, selladores— pasa por la pila de precio sin mano de obra. El precio es el capturado en la partida o, si se elige un artículo del catálogo (`articulo_id`), el del catálogo; **un precio con IVA se cuesta sin IVA**, porque el IVA de compra se acredita:

```text
precio    = precio_compra_unitario (si se captura)  |  T3c[articulo_id].precio
iva       = iva_incluido de la partida  |  (si no se capturó precio) el del artículo  |  no
compra    = cantidad · precio / (1 + compras.iva_pct)   si iva ;   cantidad · precio   si no
categoría = T3c[articulo_id].categoria  |  PROVEEDOR                    # el renglón del control de gastos donde cae la compra (§5.7)

Si se atornilla como brida (una brida de placa que corta un proveedor):
tornillería = cantidad · tornillos_pieza · (1 + f_reserva) · precio_juego(tornillo de la brida estándar)    # tornillos_pieza: la mitad de sus barrenos
junta       = cantidad · 0.5 · π · circulo_barrenos / 1000 · 40 mL/m · 1.15 de Sikaflex (o medio empaque)    # §3.5.4
CD          = compra + tornillería + junta                                # la tornillería y la junta caen en «Material» del control de gastos
```

`tornillos_pieza` y `circulo_barrenos_mm` son del artículo (T3c) o de la partida. Las bridas de placa de 5″, 6″ y 7″ del caso de §7.4 (cotización del proveedor de corte del 2-oct-2026) están en el catálogo con su precio antes de IVA, su círculo de barrenos (170, 193 y 230 mm) y los juegos de su media junta: **3 por brida** (los 6 barrenos de los planos de pedido del 30-sep-2026). También traen sus diámetros exterior e interior (194/130, 221/157 y 258/182 mm), con los que se dibujan (§8.5), y el ducto para el que son (`ducto_D_mm`), con el que entran en el cuadre de bridas (§3.5.8).

#### 3.6.4 Armado de piezas (`UNION`)

La unión entre dos piezas de otras partidas, como las pide el plano de armado del 2-oct-2026 («unir codo de 90° de 5″ con tramo de ducto»). No lleva lámina: sólo el ajuste de las dos bocas y la junta. En galvanizado se **engargola**, como las yardas entre sí (el taller, 7-oct-2026; §3.4.7); en acero al carbón e inoxidable, un cordón de filete.

```text
n            = n_uniones (1)                    # un codo, un injerto y una yarda armados en una pieza son 2 uniones
D_ext        = D + 2e (o D, si la medida es exterior)
Armado       t = k_dif · n · t_junta(D_med)      # una junta de armado por unión (T7; k_dif de T6, 1 si no lo trae)
Junta        L = n · π · D_ext                   # galvanizado: engargolado transversal (una operación por unión, sellado de clase C); otros: filete continuo
Acabado, consumibles de soldadura, inspección: como cualquier pieza; sin corte, rolado, aros ni pintura (no hay superficie)
```

Las piezas que se unen van en sus partidas **sin brida** en esos extremos (`extremos_sin_brida`, o «brida en un extremo» en el tramo recto): así la unión no se cobra dos veces y el cuadre de bridas no las pide. Como toda partida, una unión cobra al menos el cargo mínimo de partida (`cargo_minimo_partida`, T9).

---

## 4. Módulo 3 — Mano de obra y consumibles

### 4.1 Tiempos estándar por operación

Cada tiempo se calcula con **drivers geométricos** (metros de corte, metros de soldadura, número de piezas…) y se expresa en **minutos estándar por unidad**. La eficiencia del taller `η` se aplica al valorizar: `t_real = t_estándar / η`.

```text
Corte        t = n_hojas_eq·t_manejo_hoja + L_corte / v_corte(proceso, e)       n_hojas_eq = A_bruta / A_hoja   (A_hoja = yarda × 3 048 en el tramo recto)
             + t_prog_cnc (una vez por PARTIDA; sólo plasma/láser)
Rolado       t = n_virolas · [ t_fijo_rolado + n_pasadas · k_rolado · L_virola / v_rolado(e) ]      k_rolado = 1 cilindro ; 1.6 cono ; n_virolas = anillos (yardas)
Armado       t = k_dif[familia] · [ n_piezas·t_fijo_pieza + n_juntas_int·(t_junta_base + t_junta_por_m·D_ref)
                                    + n_aros·t_ajuste_aro + n_fijaciones·t_fijación + n_espigas·t_formado_espiga ]      n_aros = aros de taller (no los sueltos, §3.5.7)
Aros         t = Σ_aros [ t_fijo_aro + t_roll_aro · L_aro/1000 ]                  # aros de taller y sueltos (§3.5.7)
Soldadura    t_arco = (L_tope + L_filete) / ( v_sold(e)·v_mult(proceso) )                # min con arco encendido, al espesor de la lámina
                    + Σ_aros L_cierre / ( v_sold(t_perfil)·v_mult(proceso) )              # cierres de aro, al espesor de la solera
             t      = ( t_arco / FO ) · f_sold(material)                        # FO = factor de operación (arco encendido / tiempo total)
Engargolado  t = n_engargolados·t_fijo + L_engargolado / v_engargolado(e)       # una operación por junta entre yardas y por costura longitudinal Pittsburgh
Barrenado    t = n_barrenos · t_barreno                                         # barrenos de todos los aros, también los sueltos
Acabado      t = f_acabado(material) · t_soldadura
Pintura      t = Σ_partes A_parte · ( t_prep + n_manos_parte · t_aplicación )      # partes: el ducto y las bridas, cada una con su sistema (T7d); una parte sin pintura no suma
Inspección   t = t_fijo_qc + k_manejo · m_neta_total                            # lámina + aros de taller + aros sueltos
t_real(op)   = t_estándar(op) / η_taller
Costo(op)    = (t_real / 60) · ( mo_h(op) + equipo_h(op) )        mo_h = salario_diario / horas_día · FSR
```

`FSR` (Factor de Salario Real) convierte el salario en lo que de verdad cuesta cada hora trabajada: lo que se paga y no se trabaja (los días de descanso, vacaciones, festivos) y las prestaciones y cargas (IMSS, INFONAVIT, aguinaldo, prima vacacional). El taller cuesta la hora como **el salario del día ÷ 8 h = $62.50**, sin utilidades ni prestaciones, por eso FSR = 1.00 (T8). **Ojo:** la semana paga 7 días por 5 trabajados, así que cada hora trabajada le cuesta al taller $3,500 ÷ 40 h = **$87.50**: con FSR = 1.00 se deja de cobrar $25 por hora (en el caso de §7.4, $3,200 en 128 h). Para recuperarlo, `FSR` = 7/5 = **1.40**; con prestaciones, más (§7.4.1).

### 4.2 Drivers por familia

Longitudes en m salvo indicación; `κ = √(1 + tan²(α/2)/2)`.

| Familia | `n_piezas` = `n_virolas` (recto: piezas ≠ anillos) | `L_corte` | Soldadura tope | Soldadura filete | Juntas internas |
| --- | --- | --- | --- | --- | --- |
| Recto | piezas por yardas · `n_virolas` = anillos (§3.2) | `n_compl·n_cost·Y + (B + n_cost·ajuste)` | `n_cost·L_capa` (costura a tope) | `n_cost·L_capa` (si traslape) | 0 (las juntas entre yardas se engargolan) |
| Codo redondo | `n_g` | `π·D_med·(2jκ + 2) + 2·L_tot` | `j·π·D_med·κ + L_tot` | — | `j` |
| Codo rectangular | 4 | `8θR + 4·(H + W)` | `4θR` | — | 4 |
| Reducción | 1 | `π·(D1_med + D2_med) + 2·s_máx` | `s_máx` | — | 0 |
| Transición | 2 | `P_rect + π·D_med + 4·s_ref` | `2·s_ref` | — | 0 |
| Injerto simple | 2 | `2·(B_c + L_c) + P_h + 2·(π·d_med + L_r)` | `L_c + (L_r − t_med)` | `P_h` | 1 |
| Reducción con injerto | 2 | `π·(D1_med + D2_med) + 2·s + P_h + 2·(π·d_med + L_r)` | `s + (L_r − t_med)` | `P_h` | 1 |

`P_h` es el perímetro de la silleta: la curva en que el injerto corta al tronco (§3.4.4) o al cono (§3.4.5), integrada numéricamente.

### 4.3 Consumibles

```text
A_cordón     = máx( A_mín , k_cordón · e² )                  # mm²   k_tope = 1.75 ; k_filete = 1.00 ; A_mín = 2.0
m_depositado = Σ_j L_j[m] · A_cordón_j[mm²] · ρ_dep[g/cm³]   # g   (1 m · 1 mm² = 1 cm³) ; los cierres de aro usan A_cordón del espesor de la solera
kg_alambre   = m_depositado / ( 1000 · η_dep )               # microalambre (GMAW) o varilla (GTAW); η_dep = 0.93 | 0.98
V_gas        = t_arco · Q_gas · (1 + f_pre/post) / 1000      # m³ de gas de protección

Pintura (por mano):
  cobertura_teórica = 10 · SV% / DFT_µm                      # m²/L   (55 % SV, 50 µm → 11.0 m²/L)
  L_mano            = A_mano / ( cobertura_teórica · η_transf )
  A_mano            = Σ A_parte de las partes que llevan esa mano     # el ducto y las bridas pueden llevar manos distintas
  L_diluyente       = f_dil · Σ L_mano
  A_ducto           = A_ext · n_caras  (0 si el sistema del ducto es NINGUNA)
  A_bridas          = Σ_aros A_pintura_aro (aros de taller y sueltos; 0 si el sistema de las bridas es NINGUNA)
  sistema           = el de la partida (`pintura`) para todo ; si no, el del material según la instalación (T7d)

Corte:  costo = L_corte · precio_m_corte[proceso]            # electrodos, boquillas, gas de asistencia, cuchillas
```

**La regla de pintura en el tramo del Ejemplo A** (Ø12″, 3 m, calibre 16, sin elegir sistema en la partida; el costo y el precio salen del motor). El acero al carbón lleva la misma superficie en interior y en exterior, pero en exterior recibe además la mano de primario; el galvanizado sólo pinta sus dos aros de brida:

| Material | Instalación | Ducto | Bridas | Superficie pintada (m²) | Pintura + diluyente (L) | Costo de la pintura (MXN) | Pintura (min reales) | Precio antes de IVA (MXN) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ACERO_CARBON` | Interior | sólo pintura | sólo pintura | 3.078 | 0.463 | 112.40 | 26.9 | 2,726.68 |
| `ACERO_CARBON` | Exterior | primario + pintura | primario + pintura | 3.078 | 0.937 | 210.14 | 38.5 | 2,921.44 |
| `GALVANIZADO` | Interior | sin pintura | sólo pintura | 0.177 | 0.027 | 6.47 | 1.6 | 3,052.92 |
| `GALVANIZADO` | Exterior | sin pintura | primario + pintura | 0.177 | 0.054 | 12.10 | 2.2 | 3,064.14 |
| `INOX_304` | Interior | sin pintura | sin pintura | 0.000 | 0.000 | 0.00 | 0.0 | 7,353.60 |
| `INOX_304` | Exterior | sin pintura | sin pintura | 0.000 | 0.000 | 0.00 | 0.0 | 7,353.60 |

### 4.4 Costos de operación y subcontratos

Una operación puede ejecutarse en el taller (tarifas de T8) o **subcontratarse**. Se modela con dos entradas de la partida:

| Entrada | Efecto |
| --- | --- |
| `omitir_operaciones` = lista de operaciones (`corte`, `rolado`, `armado`, `aros`, `soldadura`, `engargolado`, `barrenado`, `acabado`, `pintura`, `qc_embalaje`) | Se anulan sus horas, mano de obra, equipo y consumibles (corte → consumibles de corte; soldadura → alambre y gas; pintura → pintura y diluyente). |
| `subcontratos` = lista de `{concepto, driver, precio}` | Suma `cantidad · driver · precio` al costo directo, sin horas de MOD. Drivers: `PIEZA`, `KG_NETO`, `KG_BRUTO`, `M2_NETO`, `M_CORTE`, `M_SOLDADURA`. |

Ejemplos: pintura electrostática maquilada (`omitir: pintura`, driver `M2_NETO`), galvanizado en caliente post-fabricación (`KG_NETO`), corte láser maquilado (`omitir: corte`, driver `M_CORTE`).

### 4.5 Instalación en obra y viáticos (`INSTALACION`)

La cuadrilla que instala en obra cobra **horas reales** (en obra no se aplica la eficiencia del taller) a la tarifa `instalacion` de T8, y sus **viáticos** se capturan **con IVA, como en el ticket**: lo que se paga con factura se cuesta sin IVA (el IVA se acredita) y lo que no, completo.

```text
horas     = cantidad · personas · días · horas_día                     # horas_día: la de la partida o la jornada de T8 (8 h)
MO        = horas · mo_h(instalación)                                  # $62.50 la hora ($500 ÷ 8 h) ; equipo_h = 0
casetas   = cantidad · viajes · casetas_viaje
gasolina  = cantidad · viajes · gasolina_viaje
hospedaje = cantidad · personas · noches · hospedaje_noche
comidas   = cantidad · personas · días · comida_día
otros     = cantidad · otros_gastos
viático   ÷ (1 + IVA)  si tiene factura                                # gastos_con_factura: sí por omisión ; comidas_con_factura: no por omisión
CD        = MO + herramienta_menor + Σ viáticos
CI_fábrica = gif_por_hora_instalacion · horas                           # 0 por omisión (T9): la cuadrilla no usa la nave; administración e imprevistos sí
```

La `cantidad` son visitas iguales: dos visitas cuestan exactamente el doble (sin cargo mínimo de por medio). El caso de §7.4 lo resuelve paso a paso.

---

## 5. Módulo 4 — Estructura de precios

### 5.1 Costo directo

```text
CD = Materiales + Consumibles + Mano de obra + Equipo + Herramienta menor + Subcontratos + Viáticos (§4.5)

Materiales  = m_bruta·precio_kg(material, calibre) − crédito_chatarra + Σ_aros m_aro_bruta·precio_kg(perfil)     # §5.1.1: lista del proveedor o, si no hay, precio_kg_<material> / precio_kg_<perfil>
              + Σ_tipos juegos·precio_juego_<tornillo> + L_empaque·precio_m_empaque + V_sellador·precio_mL_sellador      # V_sellador incluye el cordón de la junta (§3.5.4)
              + fijaciones·precio_pza + flete_material% · (lámina + perfil)
Herramienta menor = herramienta_menor_pct · Mano de obra
```

#### 5.1.1 Precio del acero: la lista del proveedor

El proveedor cotiza por **pieza** (una hoja, una barra) y con el **IVA incluido**: su factura del 30-sep-2026 desglosa el IVA de precios redondos (la solera 1½" × 3/16" a $250.00 con IVA aparece como $215.52 + $34.48). La lista T3b conserva el precio **como se cotiza** y el motor lo convierte a lo que usa: acero costeado **por kg y sin IVA** (el IVA de compra se acredita; el de venta se suma al final, §5.2).

```text
precio_sin_IVA = precio_cotizado / (1 + iva_incluido_pct)              # 16 %; 0 % si el precio se capturó antes de IVA
kg_hoja        = ancho · largo · espesor · ρ                           # espesor del calibre en la tabla del material (T2), o esp_mm en placa
kg_barra       = peso_lineal · largo                                   # solera: b·t · 7.85/1000 ; ángulo: t·(2b − t) · 7.85/1000 ; o kg/m capturado (canal)
precio_kg      = precio_sin_IVA / kg_pieza                             # lo que valoriza m_bruta y m_aro_bruta
```

*Lámina galvanizada 4 × 10 ft, calibre 22 (cotización del proveedor)*

```text
precio_cotizado = 920.00 MXN (con IVA)
precio_sin_IVA  = 920.00 / 1.16 = 793.10 MXN
espesor         = 0.0336 in × 25.4 = 0.8534 mm   (tabla GSG, calibre 22)
kg_hoja         = 1.219 m · 3.048 m · 0.8534 mm · 7 850 / 1000 = 24.892 kg
precio_kg       = 793.10 / 24.892 = 31.862 MXN/kg
```

*Solera 1½" × 3/16", barra de 6.00 m (factura): la brida estándar del taller*

```text
precio_cotizado = 250.00 MXN (con IVA)
precio_sin_IVA  = 250.00 / 1.16 = 215.52 MXN   (en la factura: 215.52 + 34.48 de IVA)
peso_lineal     = 38.100 · 4.763 · 7.85 / 1000 = 1.4245 kg/m
kg_barra        = 1.4245 · 6.00 = 8.547 kg
precio_kg       = 215.52 / 8.547 = 25.215 MXN/kg
```

**Qué renglón usa el cálculo.**

- **Lámina:** el renglón de `hojas` con el **mismo material y calibre** que la partida; si hay varios tamaños, el de la hoja del ancho de la yarda de la partida (o de la cotización; 3 ft ó 4 ft; la hoja de 3 ft sólo se usa con yardas de 914 mm) y el largo estándar (`proceso.hoja`, 10 ft), y si no hay, el de la hoja estándar del taller (4 × 10 ft). Si no hay renglón (otro calibre, placa con `espesor_mm` capturado, inoxidable) se usa `precio_kg_<material>` de T3.
- **Aros:** el renglón de `barras` enlazado al perfil (`perfil`); si no hay, `precio_kg_<perfil>` de T3.
- Un renglón con precio ≤ 0 o sin medidas se ignora (V11).
- Cada resultado lleva `precios_usados` (fuente `PROVEEDOR` o `TABLA`, renglón y $/kg) y el desglose de la app muestra la base: «20.999 kg × $31.86/kg (Lámina galvanizada 4 × 10 ft · cal. 22 · $920.00 con IVA)».
- Se costea la **fracción de hoja que consume la pieza** (`m_bruta`, con la merma de T6), no hojas completas: el retazo que no se reaprovecha ya está en φ.

Evidencia de la convención de IVA: los precios sin IVA de la factura (1 741.38; 1 396.55; 1 306.03; 1 043.10; 215.52; 405.17; 531.03; …) son exactamente el precio redondo ÷ 1.16, y el precio por kg que sale es parejo entre tamaños (lámina negra cal. 12 ≈ $22.5/kg) y entre perfiles ($24–27/kg). `tests/proveedor.test.js` lo comprueba renglón por renglón.

### 5.2 Pila de capas

```text
CI_fábrica = GIF_por_hora_MOD · h_MOD_real                   # gastos indirectos de fábrica absorbidos por hora de MOD
CI_admin   = administración% · CD
CI         = CI_fábrica + CI_admin
IMP        = imprevistos%(riesgo) · (CD + CI)                # BAJO / MEDIO / ALTO
C_T        = CD + CI + IMP                                   # costo total
FIN        = C_T · tasa_anual · días_cobro / 365             # costo del dinero (plazo de cobro)
C_base     = C_T + FIN
P          = C_base / ( 1 − u − c_ventas − otros )           # u, c_ventas, otros = % del PRECIO
IVA        = P · iva%                                        # se muestra aparte; no entra a la base
P_final    = máx( P , cargo_mínimo_partida )
```

| Orden | Capa | Base | Fórmula | Ilustrativo |
| --- | --- | --- | --- | --- |
| 1–5 | CD (materiales, consumibles, MO, equipo, herramienta menor) | QTO · precios · tarifas | §5.1 | — |
| 6 | CI de fábrica | horas MOD reales | `GIF · h_MOD` | 85 MXN/h |
| 7 | CI de administración | CD | `% · CD` | 8 % |
| 8 | Imprevistos | CD + CI | `%(riesgo)` | 2 / 4 / 8 % |
| 9 | Financiamiento | C_T | `tasa · días/365` | 14 %, 45 d → 1.726 % |
| 10 | Utilidad + comisión + otros | **Precio** | divisor `1 − Σ%` | 20 % + 2 % + 0 |
| 11 | IVA | P | `16 %` | 16 % |

Los CI de fábrica se absorben **por hora de mano de obra**, no como % plano del CD: así una pieza con mucha mano de obra (reducción con injerto) carga más indirecto que una de mucho material (tramo recto). El imprevisto se calcula sobre CD + CI (lo que está en riesgo), y el financiamiento sobre el costo total (lo que se adelanta).

**Margen ↔ markup:** `markup = m/(1 − m)` → 15 % ↔ 17.6 % · 20 % ↔ 25.0 % · 25 % ↔ 33.3 % · 30 % ↔ 42.9 %.

### 5.3 Indicadores de control (se calculan por partida y por cotización)

| Indicador | Fórmula | Uso |
| --- | --- | --- |
| Precio por kg neto | `P / m_neta_total` | Comparar contra el histórico por familia; alertar fuera de rango |
| Precio por m lineal | `P / L` (recto) | Comparar contra cotizaciones previas |
| Horas MOD por kg | `h_MOD / m_neta_total` | Detectar partidas complejas mal valuadas |
| Margen de contribución | `(P − CD)/P` | Piso de negociación |
| Markup sobre costo total | `P/C_T − 1` | Verificación de política |
| Precio piso | `C_base / (1 − c_ventas − otros)` | Precio mínimo con utilidad 0 (piso de negociación) |
| Utilidad real de la cotización | `Σ [P_i·(1 − d)·(1 − c_ventas − otros) − C_base_i]` y su margen sobre el subtotal neto | Ver qué queda después del descuento (§5.4) |
| Descuento máximo sin perder utilidad | `1 − Σ precio_piso_i / subtotal` | Tope de negociación del descuento (§5.4) |

### 5.4 Parámetros de precio propios de la cotización

Las capas de §5.2 salen de las tablas maestras (T9), pero **cada cotización puede traer sus propios valores** de siete parámetros comerciales —los que un vendedor ajusta al cotizar— sin ir a los maestros. Valen sólo para esa cotización: lo que no se cambia sale de T9 y sigue las ediciones posteriores de los maestros. Se guardan como fracción (0.25 = 25 %; los días como entero) en `cotizacion.parametros`.

| Parámetro (`cotizacion.parametros`) | En la pantalla | Anula a | Valor de las tablas | Límites | Qué cambia |
| --- | --- | --- | --- | --- | --- |
| `utilidad_pct_precio` | Margen de utilidad | `capas.utilidad_pct_precio` | 20.0 % | 0 – 80 % | Margen de utilidad sobre el **precio**: `P = C_base / (1 − u − c − o)` |
| `comision_ventas_pct_precio` | Comisión de ventas | `capas.comision_ventas_pct_precio` | 2.0 % | 0 – 20 % | Comisión de ventas sobre el precio |
| `descuento_pct` | Descuento | — (no existe en maestros) | 0.0 % | 0 – 50 % | Descuento al cliente sobre el subtotal de la cotización (§5.4); las partidas no cambian |
| `dias_cobro` | Días de cobro | `capas.financiamiento.dias_cobro` | 45 días | 0 – 365 | Plazo de cobro: costo del dinero `C_T · tasa · días / 365`; también sale en la propuesta («crédito a N días») |
| `administracion_pct_cd` | Administración | `capas.administracion_pct_cd` | 8.0 % | 0 – 50 % | Indirectos de administración sobre el costo directo |
| `tasa_anual` | Financiamiento anual | `capas.financiamiento.tasa_anual` | 14.0 % | 0 – 100 % | Tasa anual del costo del dinero |
| `iva_pct` | IVA | `capas.iva_pct` | 16.0 % | 0 – 30 % | IVA de los totales de la cotización |

El motor construye **unas capas efectivas** (T9 con los parámetros encima; no muta los maestros), con ellas calcula todas las partidas y las devuelve en el resultado (`capas`, `maestros`, `parametros`, `avisos`). La vista previa de una partida usa las mismas capas, así su precio coincide con el de la lista.

El **descuento** no está en los maestros y no cambia el precio de las partidas: es un renglón de los totales de la cotización.

```text
subtotal       = Σ importe_i                                    # precio de lista, antes del descuento
descuento      = subtotal · descuento_pct
subtotal_neto  = subtotal − descuento
IVA            = subtotal_neto · iva%                           # el IVA va sobre el precio ya descontado
total          = subtotal_neto + IVA

utilidad_real  = Σ_i [ importe_i · (1 − d) · (1 − c_ventas − otros) − C_base_i ]     # comisión sobre el precio ya descontado
margen_real    = utilidad_real / subtotal_neto                  # = u (a los centavos del redondeo) si d = 0
descuento_máx  = 1 − Σ precio_piso_i / subtotal                 # con ese descuento la utilidad real llega a 0
```

La pantalla muestra el descuento en el total, la **utilidad** (en pesos y como % del precio) y el **costo total** en las tarjetas, y avisa en rojo cuando el descuento deja el precio por debajo del piso (utilidad negativa). Un parámetro inválido en un archivo importado se ignora y se avisa (V13).

### 5.5 Lista de compras en piezas enteras

Cada partida cuesta la **fracción** de material que consume (kg de lámina con su merma, metros de solera, juegos de tornillos con reserva). Pero se compran **piezas enteras**: hojas, barras de 6 m, tornillos por decena, cartuchos y envases completos. La lista de compras (`src/motor/compras.js`) junta lo que piden todas las partidas y lo redondea; es la pestaña **Compras y gastos** de la app:

```text
hojas     = ⌈ Σ kg brutos ÷ kg de la hoja ⌉                               # por material, espesor y tamaño de hoja (T3b o la hoja estándar)
barras    = acomodo de las piezas en barras                               # aros de brida y piezas de soportería, por barra de T3b (o de 6 m)
tornillos = ⌈ Σ juegos con reserva ÷ múltiplo ⌉ · múltiplo                # compras.tornillos_multiplo = 10 ; bridas de solera y de placa, y soportería
sellador  = ⌈ Σ mL ÷ mL del cartucho ⌉ ;  pintura = ⌈ Σ L ÷ envase ⌉ · envase   # cartucho de 600 mL (con la junta de toda brida, también las de placa) ; envase de 1 L
empaque, anclajes y artículos comprados: lo que piden (ya se compran así)
sobrante(renglón) = máx( 0 , importe de la compra entera − lo que ya cobran las partidas )
```

**Acomodo en barras.** Las piezas se ordenan de la más larga a la más corta y cada una va en la primera barra donde cabe (*first-fit decreasing*); una pieza más larga que la barra se arma de tramos (ocupa barras completas y su resto se acomoda como otra pieza). Nunca usa menos barras de las posibles (`⌈Σ largo / largo de barra⌉`), y contra el óptimo por fuerza bruta usa a lo más una barra de más (`tests/compras_gastos.test.js`, 300 casos; igual al óptimo en ≥ 95 %). Las 30 bridas de la hoja de control de gastos (22 de 11″, 6 de 10″ y 2 de 9″) son **6 barras** de solera: la misma compra que hizo el taller (§7.4).

**Cobrar el sobrante.** Si la cotización lo pide (`piezas_enteras`), el sobrante total entra como una **partida automática** (`AJUSTE_COMPRA`: costo = sobrante, sin horas, con su pila de precio y sin cargo mínimo); no cuenta como partida del usuario ni se edita: se ve en la lista, en la propuesta y en el CSV. Sin pedirlo, el sobrante sale de la utilidad o queda como retazo en el taller.

Cada renglón dice en qué categoría del control de gastos cae (la barra que sólo lleva soportería es soportería; la de los aros, material; los artículos, la de su catálogo) y la lista se puede **usar como base de los gastos**: cada compra, la soldadura, la mano de obra del taller y la cuadrilla y los viáticos de cada instalación llegan como renglones **«estimado»** con el precio cotizado, para cambiarlo por el del ticket.

### 5.6 Venta pactada y precio mínimo

Con la **venta pactada** (lo que se acordó con el cliente) el motor mide lo que de verdad deja el proyecto y la compara con tres referencias. Se captura como se pactó: **antes de IVA** o, con `venta_pactada_con_iva = true` (la casilla «El importe ya incluye IVA»), **con IVA**; entonces se le quita el IVA de la cotización y todo se mide sin él:

```text
venta          = venta_pactada / (1 + iva%)   si venta_pactada_con_iva ;   venta_pactada   si no
CD_total       = Σ CD_i                                                   # material, mano de obra, compras y viáticos
precio_mínimo  = Σ C_base_i / (1 − c_ventas − otros)                      # utilidad cero: cubre CD, indirectos, imprevistos, financiamiento y comisión
precio_calc    = subtotal_neto                                            # el de la pila de precio, con la utilidad de la cotización
utilidad_venta = venta · (1 − c_ventas − otros) − Σ C_base_i
margen_venta   = utilidad_venta / venta
cubre_CD       = venta ≥ CD_total ;  cubre_mínimo = venta ≥ precio_mínimo
IVA            = venta · iva%  ;  total = venta + IVA                     # con IVA capturado, el total es lo capturado
```

El IVA de la venta no es ingreso: es del SAT, menos el que se acreditó en las compras (§7.4.1).

La app lo dibuja como una **regla de tres zonas**: de 0 al costo directo *pierde* (rojo), del costo directo al precio mínimo *cubre el costo directo pero no los indirectos* (amarillo) y arriba del precio mínimo *gana* (verde), con las marcas del precio calculado y de la venta pactada. Los totales de la cotización repiten el resultado. Un importe inválido se ignora y se avisa (V25).

### 5.7 Control de gastos: lo real contra lo cotizado

Cada gasto real se captura como viene en el ticket o la factura: `{ fecha, concepto, categoría, cantidad, precio_unitario, iva_incluido, con_factura }`. Su **costo** es sin el IVA que se acredita (`src/motor/gastos.js`):

```text
importe = cantidad · precio_unitario
con IVA  y con factura  → costo = importe / (1 + IVA)     # el IVA se acredita
con IVA  y sin factura  → costo = importe                 # el IVA no se recupera: es costo
sin IVA                 → costo = importe                 # con factura, el IVA que se paga encima se acredita
sin decir si hay factura: sí, salvo en mano de obra e instalación (la raya no lleva IVA)
```

Lo cotizado se reparte en las **mismas categorías**, desde el costo directo de cada partida, como se capturan los tickets:

| Categoría | Lo cotizado que cae ahí |
| --- | --- |
| Material | lámina, perfiles de los aros, tornillería, empaque, sellador y flete; artículos del catálogo de material; la tornillería y la junta de lo comprado que se atornilla (bridas de placa); el sobrante cobrado |
| Consumibles | soldadura, gas, corte, pintura y la herramienta menor de toda partida |
| Mano de obra del taller | la mano de obra de las partidas de lámina y de la soportería |
| Compras y trabajos de terceros | artículos comprados sin catálogo o del catálogo de compras a terceros; subcontratos |
| Soportería y anclajes | el material de la soportería (barra, anclajes y tornillos); anclajes del catálogo |
| Mano de obra de instalación | la cuadrilla en obra |
| Viáticos y traslados | casetas, gasolina, hospedaje, comidas y otros gastos de obra |
| Otros | lo que no cae en otra |

El **equipo** (hora-máquina: depreciación, energía y mantenimiento de las máquinas propias) es parte del costo directo pero no llega con un ticket: queda aparte, como estimado. El resultado del proyecto:

```text
utilidad antes de indirectos  = venta − Σ costo real                                  # lo que una hoja de gastos llama «ganancia»
utilidad después de indirectos = venta · (1 − c_ventas − otros) − Σ costo real − equipo − (Σ C_base − CD)
                                 # equipo e indirectos (CI, imprevistos y financiamiento) los estima la cotización
IVA acreditable = Σ IVA de los gastos con factura                                    # para la declaración; no es costo
```

La venta es la pactada; sin ella, el precio calculado. La comparación por categoría dice en qué renglón se gastó de más (o de menos) contra lo cotizado y cuánto se ha gastado de cada uno.

### 5.8 Cotización rápida

Para dar un precio en minutos, sin capturar pieza por pieza, el taller usa una regla (7-oct-2026): con el **diámetro mayor** del sistema y los **metros hasta el punto más alejado**, se cuentan las láminas que hacen falta para esos metros de ducto a ese diámetro, su costo se multiplica por 3, se suman las bridas según los metros y, sobre eso, la utilidad y el IVA. La app la tiene en su propia pestaña (**Cotización rápida**; `src/motor/rapida.js` y `src/web/rapida_ui.js`) con sus valores en T11:

```text
B          = π · (D + e) + holgura de la costura del material       # plantilla de una yarda (D interior; galvanizado: Pittsburgh, 32 mm)
yardas     = ⌈ metros ÷ yarda ⌉                                     # yarda de 3 ft (914 mm) o 4 ft (1 220 mm), a elegir
por_hoja   = acomodo de plantillas yarda × B en la hoja (abajo) ;  hojas = ⌈ yardas ÷ por_hoja ⌉
             (si la plantilla no cabe de ninguna forma: cada yarda lleva hojas completas y un retazo; los retazos se acomodan juntos)
lámina     = hojas × precio de la hoja sin IVA                       # lista del proveedor (T3b)
costo      = lámina × factor_lamina + bridas(metros)                 # el primer renglón de «bridas por metros» que alcanza
precio     = costo × (1 + utilidad)                                  # la utilidad se SUMA sobre el costo (no es % del precio)
total      = precio × (1 + IVA)                                      # el IVA de la pila de precio (T9)
```

**La yarda: 3 o 4 ft.** Se elige en la pestaña (los largos son los de T7c, `proceso.armado_yardas.yardas_mm`; sin elegir, `yarda_defecto_mm`, 4 ft). Sin elegir lámina, se usa la de T11 o, si el proveedor tiene una del mismo material y calibre **cuyo ancho es la yarda** (la de 3 × 10 ft para yardas de 3 ft), ésa. Una yarda de 1,220 mm cabe en la hoja de 4 ft (1,219 mm): se acepta una diferencia de 3 mm.

**El acomodo.** Las plantillas (yarda × B) se acomodan en la hoja con cortes de guillotina, y se queda el que da más: todas **a lo ancho** (la yarda a lo ancho de la hoja, como en el tramo recto), todas **a lo largo**, o una franja de un tipo y el resto del otro. Así, con yardas de 3 ft en la hoja de 4 × 10 ft, en la franja de 1 ft que sobra caben plantillas giradas si el ducto es chico (3″: 11 + 3 = 14 por hoja). La pestaña lo dibuja: una lámina a escala con sus yardas numeradas y el sobrante rayado, y una tira con todas las láminas y cuántas yardas lleva cada una (la última, las que falten). También dice qué fracción de la lámina se aprovecha.

Con la lámina galvanizada cal. 22 de 4 × 10 ft ($920 con IVA = $793.10 sin IVA) y la utilidad de arranque:

| Diámetro | Metros | Yarda | Yardas | Por lámina | Láminas | Aprovechamiento | Lámina sin IVA | Lámina × 3 | Bridas | Costo | Utilidad 20 % | Total con IVA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11″ | 40 | 4 ft | 33 | 3 | 11 | 90 % | 8,724.14 | 26,172.41 | 5,000.00 | 31,172.41 | 6,234.48 | **43,392.00** |
| 11″ | 40 | 3 ft | 44 | 3 | 15 | 66 % | 11,896.55 | 35,689.66 | 5,000.00 | 40,689.66 | 8,137.93 | **56,640.00** |
| 11″ | 41 | 4 ft | 34 | 3 | 12 | 85 % | 9,517.24 | 28,551.72 | 12,000.00 | 40,551.72 | 8,110.34 | **56,448.00** |
| 6″ | 60 | 4 ft | 50 | 5 | 10 | 84 % | 7,931.03 | 23,793.10 | 12,000.00 | 35,793.10 | 7,158.62 | **49,824.00** |
| 3″ | 40 | 3 ft | 44 | 14 (mixto) | 4 | 74 % | 3,172.41 | 9,517.24 | 5,000.00 | 14,517.24 | 2,903.45 | **20,208.00** |
| 11″ | 100 | 4 ft | 82 | 3 | 28 | 88 % | 22,206.90 | 66,620.69 | 18,000.00 | 84,620.69 | 16,924.14 | **117,792.00** |
| 18″ | 80 | 4 ft | 66 | 2 | 33 | 97 % | 26,172.41 | 78,517.24 | 12,000.00 | 90,517.24 | 18,103.45 | **126,000.00** |

Para 11″ y 40 m con yardas de 4 ft: la plantilla de una yarda mide π × (279.4 + 0.85) + 32 = 912 mm, así que cada hoja de 3,048 mm da 3 yardas; 40 m son 33 yardas, es decir, 11 hojas. Con yardas de 3 ft son 44 yardas: la hoja de 4 ft también da 3 (una franja de 305 mm se desperdicia), así que salen 15 hojas.

**El plazo.** La pestaña tiene un apartado para los **días de fabricación** y los **días de instalación** (de 0 a 365, admite medios días); se muestran junto al total («5 días de fabricación + 3 días de instalación = 8 días») y **no cambian el precio**: la fabricación ya la cubre el factor. La utilidad capturada en la pestaña vale sólo para esa cotización rápida; vacía, se usa la de T11. El diámetro se captura en la unidad de la cotización (pulgadas o mm) y lo capturado se recuerda en el navegador. Más metros que el último renglón de las bridas no tienen precio: la app lo dice y no da un total.

Es una **estimación**: todo el sistema al diámetro mayor, en ductos rectos, sin aprovechar retazos entre yardas, y lo demás (codos, reducciones, mano de obra, soportería, instalación) cubierto por el factor. Para un precio fino se capturan las partidas.

---

## 6. Pseudocódigo maestro

```text
FUNCIÓN cotizar(cotización, M):                          # M = snapshot de maestros (versión congelada)
    Mq ← maestros_efectivos(cotización.parametros, M)    # capas de T9 con los parámetros de la cotización encima (§5.4); no muta M
    problemas ← problemas_maestros(Mq)                   # tablas sanas (V18): una sola vez para todas las partidas
    PARA CADA partida p EN cotización.partidas:
        resultado[p] ← cotizar_partida(p, Mq)            # un error —de datos o inesperado— en una partida no tumba las demás
    compras ← lista_compras(resultado, Mq)               # piezas enteras: hojas, barras (acomodo), tornillos por decena, cartuchos, envases (§5.5)
    SI cotización.piezas_enteras: agregar partida automática AJUSTE_COMPRA con CD = compras.sobrante
    subtotal ← Σ resultado.importe (con la automática) ;  descuento ← subtotal · Mq.descuento ;  neto ← subtotal − descuento
    IVA ← neto · Mq.iva ;  total ← neto + IVA
    precio_mínimo ← Σ C_base / (1 − comisión − otros) ;  SI hay venta_pactada: utilidad y margen con ella (§5.6)

FUNCIÓN cotizar_partida(p, M):
    exigir_maestros_sanos(M)                             # V18: un divisor en cero daría NaN o un precio infinito
    p ← normalizar_y_validar(p, M)                       # tipo, rango y pertenencia (V14–V16) y política del taller · errores bloquean · advertencias se reportan
    SI p.familia ∈ { COMPRADO, SOPORTE, INSTALACION }:    # sin lámina: catálogo e IVA, barra y anclajes, cuadrilla y viáticos (§3.6, §4.5)
        RETORNAR pila_de_precio(costos_sin_lámina(p, M))
    mat ← M.materiales[p.material_id]
    e   ← M.calibres[mat.tabla_calibre][p.calibre] · 25.4          # o p.espesor_mm (placa)

    # ── QTO: sólo cantidades físicas, ningún precio ─────────────────────────────────────
    PF  ← GEOMETRÍA[p.familia](p, e, M)                  # A_neta, L_corte, L_sold, n_piezas, extremos…
    her ← herrajes(PF, p, M)                             # aros, tornillos, junta (Sikaflex o empaque), sellador, espigas
    lam ← lámina(PF.A_neta + her.A_espiga, mat, e, φ[p.familia])   # m_neta ; m_bruta = m_neta / (1 − φ)
    pin ← pintura(PF, her, p)                            # superficie y manos
    t   ← tiempos(PF, her, lam, pin, mat, e, M)          # minutos estándar por operación
    con ← consumibles(PF, her, t, pin, mat, e, M)        # alambre, gas, corte, pintura

    # ── Valorización: aquí, y sólo aquí, entran los precios ──────────────────────────────
    CD  ← valorizar(p.cantidad, lam, her, t, con, M.precios, M.proveedor, M.tarifas, M.η)
    PR  ← pila(CD, CD.h_MOD, p.riesgo, M.capas)          # CI → imprevistos → financiamiento → margen
    exigir_resultado_numérico(...)                       # V19: ningún NaN ni infinito sale del cálculo
    RETORNAR { QTO, desglose: CD, pila: PR, precio_unitario, indicadores, advertencias }
```

---

## 7. Ejemplos resueltos paso a paso

> Los valores intermedios se muestran redondeados; el motor opera en doble precisión. Al recalcular con calculadora a partir de los valores mostrados pueden aparecer diferencias de ±0.01. **Criterio de aceptación de un port:** reproducir el Ejemplo A con diferencia ≤ 0.1 % en cada línea (`tests/ejemplo_recto.test.js`).

### 7.1 Ejemplo A — Tramo recto de 3 m, Ø12", calibre 16, acero al carbón

**Datos de entrada**

| Variable | Valor |
| --- | --- |
| `familia` | RECTO |
| `material_id` | ACERO_CARBON (lámina negra) |
| `calibre` | 16 (tabla MSG) |
| `D_nom_mm` | 12 in × 25.4 = **304.8 mm** (`ref_diametro` = INTERIOR) |
| `L_mm` | **3 000 mm** |
| `yarda_mm` | **1 220 mm** (4 ft: la de las tablas, T7c, porque ni la cotización ni la partida eligen otra; el ancho de la hoja) |
| `tipo_costura` | A_TOPE (soldada; holgura de raíz 1.0 mm) |
| `tipo_union` | BRIDADO |
| `extremo_ajuste` | **SUELTA** (por omisión de T7c): el extremo del tramo de ajuste no lleva brida de taller —se corta en campo—, así que la pieza lleva **una** brida fabricada; del otro extremo el taller manda **suelto** el aro **terminado** (rolado, con el cierre soldado, barrenado y pintado) con sus tornillos y el material de su junta (medio cordón de Sikaflex), sin soldarlo al ducto |
| `clase_sellado` | C (juntas transversales) |
| `pintura` | PRIMARIO, elegido en la partida: 1 mano de primario en el ducto y en las bridas (sólo la cara exterior del ducto) |
| `servicio` / `riesgo` | POLVO / MEDIO |
| `cantidad` | 1 |

**Paso 1 · Espesor y diámetros**

```text
e     = 0.0598 in × 25.4 = 1.5189 mm    (tabla MSG, calibre 16)
D_int = 12 in × 25.4 = 304.800 mm
D_med = D_int + e = 304.800 + 1.5189 = 306.3189 mm    (fibra neutra: es el diámetro que se desarrolla)
D_ext = D_int + 2e = 307.8378 mm
```

**Paso 2 · Armado por yardas** (§3.2) — la yarda es el ancho de la hoja: 1,220 mm

```text
Yardas completas    = ⌊(L + tol) / Y⌋ = ⌊(3 000 + 25) / 1220⌋ = 2
Tramo de ajuste     = L − 2·Y = 3 000 − 2440 = 560 mm   (menos de una yarda)
Piezas              = ⌊2 / 3⌋ = 0 de 3 yardas;  lo que falta, 2 yardas + el ajuste, en 1 pieza de 3 anillos (3,000 mm)
Bridas de taller    = 2·1 − 1 (el extremo del ajuste no lleva brida de taller) = 1
Aros sueltos        = 1   (el del extremo del ajuste: sale terminado de taller y se manda suelto, para soldarlo en obra; §3.5.7)
Juntas engargoladas = 3 anillos − 1 = 2   (entre yardas, de un perímetro medio cada una)
```

**Paso 3 · Desarrollo (plantilla de un anillo) y área neta**

```text
B (ancho de plantilla)   = π · D_med + a_costura = π · 306.3189 + 1.0 = 963.329 mm
L_capa (lo que se corta) = Σ anillos = 1,220 + 1,220 + 560 = 3,000 mm
A_neta                   = B · L_capa / 10⁶ = 963.329 · 3,000 / 10⁶ = 2.88999 m²
```

**Paso 4 · Peso neto**

```text
w_a (kg/m²) = ρ · e / 1000 = 7 850 · 1.5189 / 1000 = 11.9235
m_neta      = A_neta · w_a = 2.88999 · 11.9235 = 34.459 kg
```

**Paso 5 · Merma (φ = 8 %) y peso bruto — el factor de merma NO se omite**

```text
m_bruta         = m_neta / (1 − φ) = 34.459 / 0.92 = 37.455 kg
m_merma         = m_bruta − m_neta = 2.996 kg
Costo de lámina = m_bruta · precio_kg_acero_carbon = 37.455 · 22.47 = 841.62 MXN   (no hay hoja cotizada de lámina negra cal. 16: precio por kg de la tabla T3)
```

**Paso 6 · Aro de brida** — estándar del taller, perfil `SOL38x4.8` = Solera 1½" × 3/16" (el mismo para cualquier diámetro); 1 aro de taller y 1 suelto

```text
b × t (solera)       = 1½" × 3/16" = 38.100 × 4.763 mm   (el ancho b queda en el plano radial: la solera se rola "de canto")
c (centroide radial) = b / 2 = 19.050 mm
w_p (peso lineal)    = b · t · 7.85 / 1000 = 38.100 · 4.763 · 7.85 / 1000 = 1.4245 kg/m
L_aro                = π·(D_ext + 2c) + holgura + puntas = π·(307.8378 + 38.100) + 3.0 + 126 = 1215.80 mm   (las puntas que la roladora no curva se cortan: §3.5.1)
m_aros_neta          = 1 · 1.2158 m · 1.4245 kg/m = 1.732 kg
m_aros_bruta         = m_aros_neta / (1 − 0.05) = 1.823 kg
m_sueltos_neta       = 1 · 1.2158 m · 1.4245 kg/m = 1.732 kg   (el mismo aro: se rola, se barrena y se pinta como el de taller, pero no se une al ducto)
m_sueltos_bruta      = m_sueltos_neta / (1 − 0.05) = 1.823 kg
Precio del perfil    = barra `SOL_1_1_2X3_16`: 250.00 con IVA → 25.215 MXN/kg sin IVA   (§5.1.1)
Costo de perfil      = (1.823 + 1.823) · 25.215 = 91.94 MXN
```

**Paso 7 · Barrenos, tornillería, junta de Sikaflex y sellador** (barreno Ø3/8" = 9.525 mm · tornillo 5/16" × 1¼")

```text
D_bc (círculo de barrenos)   = D_ext + 2g = 307.8378 + 2·24.00 = 355.838 mm  →  π·D_bc = 1117.90 mm   (g = 24 mm del borde interior del aro, como en los planos de pedido: Dperf = Dint + 48)
n_barrenos por brida         = ⌈1117.90 / 150⌉ = 8  →  número par ≥ máx(6, 8) = 8
n_juntas_asignadas           = (1 + 1) extremos · 0.5 = 1.0   (cada junta se reparte entre las dos bridas que la forman —de taller o suelta—; la otra mitad es de la brida del tramo vecino)
Juegos de tornillería        = 8 · 1.05 (reserva) = 8.4  →  · 3.67 = 30.83 MXN   (juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas)
n_barrenos (total)           = (1 + 1) aros · 8 = 16   (también se barrena el aro suelto)
Junta de la brida (Sikaflex) = 1.0 junta · π·D_bc / 1000 = 1.0 · 1.1179 = 1.1179 m · 40 mL/m · 1.15 = 51.42 mL   (el taller sella la cara de la brida con un cordón de Sikaflex sobre los barrenos, en lugar del empaque de neopreno: L_empaque = 0)
L_sellado (clase C)          = 2 juntas engargoladas · π·D_med / 1000 = 1.9247 m   (la junta de bridas ya la sella su cordón de Sikaflex: no se le suma el de la clase)
V_sellador                   = 1.9247 m · 20 mL/m · 1.15 + 51.42 mL = 95.69 mL  →  · (395.69 / 600) = 63.11 MXN   (cartucho Sikaflex de 600 mL: $459 con IVA)
```

**Paso 8 · Longitudes de proceso**

```text
L_corte                      = 2·Y + (B + ajuste) = 2·1220 + (963.329 + 560) = 3963.3 mm = 3.9633 m   (un tajo a lo ancho por yarda completa; el ajuste, más angosto que la hoja, también a lo largo)
L_soldadura (tope, lámina)   = costura longitudinal de cada anillo = n_costuras · L_capa / 1000 = 3.0000 m
L_soldadura (filete)         = aro–ducto 1·π·D_ext / 1000 = 0.9671 m   (sólo el aro que se une al ducto)
L_soldadura (cierres de aro) = (1 + 1) aros · b / 1000 = 0.0762 m   (a tope, al espesor de la solera: 4.763 mm; también el cierre del aro suelto)
L_soldadura total            = 4.0433 m
L_engargolado (entre yardas) = 2 juntas · π·D_med / 1000 = 1.9247 m   (la costura longitudinal es a tope: no se engargola)
A_pintura                    = π·D_ext·L_capa + (1 + 1) aros·(caras + canto) = 3.0784 m²   (se pinta también el aro suelto)
```

**Paso 9 · Tiempos estándar por operación** (η_taller = 0.8)

| Operación | Cálculo | t estándar (min) |
| --- | --- | --- |
| Corte (guillotina) | 0.8448 hojas de 1,220 × 3 048 · 4.0 min + 3.963 m / 7.975 m/min | 3.88 |
| Rolado | 3 anillos · 3.0 min + 3 pasadas · 3.0 m / 5.962 m/min   (cada yarda se rola aparte) | 10.51 |
| Armado y punteo | 1 pieza · 6.0 + 1 aro · 4.0   (el aro suelto no se arma al ducto) | 10.00 |
| Aros de brida | (1 + 1) · (10.0 + 19.0 min/m · 1.2158 m)   (se rolan el de taller y el suelto; tiempos calibrados con el taller, T7b) | 66.20 |
| Soldadura | t_arco = (3.967 m / 0.497 m/min) + (0.0762 m / 0.240 m/min en 4.763 mm) = 7.98 + 0.32 = 8.30 min;  ÷ FO (0.4) | 20.75 |
| Engargolado | 2 juntas · 2.0 min + 1.9247 m / 1.777 m/min | 5.08 |
| Barrenado | 16 barrenos Ø3/8" · 2.0 min   (los dos aros) | 32.00 |
| Acabado | 0.25 · t_soldadura | 5.19 |
| Pintura | 3.0784 m² · (4.0 preparación + 1 mano · 3.0) | 21.55 |
| Inspección y embalaje | 3.0 + 0.05 min/kg · 37.923 kg | 4.90 |
| **Total estándar** |  | **180.05** |

`t_real = t_estándar / η = 180.05 / 0.8 = 225.06 min = 3.7511 h`

**Paso 10 · Consumibles**

```text
A_cordón tope          = máx(2.0, 1.75·e²) = máx(2.0, 4.037) = 4.037 mm²
A_cordón filete        = máx(2.0, 1.00·e²) = máx(2.0, 2.307) = 2.307 mm²
A_cordón cierre de aro = máx(2.0, 1.75·t²) = máx(2.0, 39.701) = 39.701 mm²   (con el espesor t de la solera)
m_depositado           = (3.0000·4.037 + 0.9671·2.307) · 7.85 + 0.0762·39.701 · 7.85 = 112.60 + 23.75 = 136.34 g
Microalambre           = 136.34 / (1000 · 0.93) = 0.1466 kg  →  · 62.00 = 9.09 MXN
Gas de protección      = 8.30 min · 15 L/min · 1.10 / 1000 = 0.1370 m³  →  · 145.00 = 19.86 MXN
Consumibles de corte   = 3.9633 m · 0.30 = 1.19 MXN
Cobertura de pintura   = 10·55 / 50 = 11.0 m²/L teórica;  · 0.65 = 7.15 m²/L práctica
Pintura                = 3.0784 / 7.15 = 0.4305 L;  diluyente 10 % = 0.0431 L
Costo de pintura       = 0.4305 · 220 + 0.0431 · 70 = 97.73 MXN
```

**Paso 11 · Costo directo (CD)**

| Operación | t real (min) | MO (MXN/h) | Equipo (MXN/h) | Costo (MXN) |
| --- | --- | --- | --- | --- |
| Corte | 4.85 | 62.50 | 45 | 8.68 |
| Rolado | 13.14 | 62.50 | 55 | 25.73 |
| Armado y punteo | 12.50 | 62.50 | 25 | 18.23 |
| Aros de brida | 82.75 | 62.50 | 40 | 141.37 |
| Soldadura | 25.94 | 62.50 | 45 | 46.47 |
| Engargolado | 6.35 | 62.50 | 35 | 10.32 |
| Barrenado | 40.00 | 62.50 | 25 | 58.33 |
| Acabado | 6.48 | 62.50 | 20 | 8.92 |
| Pintura | 26.94 | 62.50 | 40 | 46.02 |
| Inspección y embalaje | 6.12 | 62.50 | 0 | 6.38 |

| Concepto | MXN |
| --- | --- |
| Lámina (37.455 kg brutos) | 841.62 |
| Perfil de aros (de taller y suelto) | 91.94 |
| Tornillería | 30.83 |
| Sellador (Sikaflex: la junta de las bridas y las juntas engargoladas) | 63.11 |
| Flete de entrada (2 % de lámina + perfil) | 18.67 |
| **Subtotal materiales** | **1,046.16** |
| Alambre + gas + consumibles de corte + pintura | 127.87 |
| Mano de obra directa | 234.44 |
| Equipo (hora-máquina) | 136.00 |
| Herramienta menor (3 % de MO) | 7.03 |
| **COSTO DIRECTO (CD)** | **1,551.51** |

**Paso 12 · Pila de precio**

| Capa | Fórmula | MXN |
| --- | --- | --- |
| CD |  | 1,551.51 |
| CI de fábrica | GIF · h_MOD = 85.00 · 3.7511 | 318.84 |
| CI de administración | 8 % · CD | 124.12 |
| Imprevistos (riesgo MEDIO) | 4 % · (CD + CI) | 79.78 |
| **Costo total C_T** | CD + CI + imprevistos | **2,074.25** |
| Financiamiento | C_T · 14 % · 45/365 = C_T · 1.726 % | 35.80 |
| **Costo base** | C_T + financiamiento | **2,110.05** |
| **PRECIO antes de IVA** | C_base / (1 − 0.20 − 0.02) = 2,110.05 / 0.78 | **2,705.19** |
|   ↳ utilidad (20 % del precio) |  | 541.04 |
|   ↳ comisión de ventas (2 % del precio) |  | 54.10 |
| IVA 16 % |  | 432.83 |
| **Total con IVA** |  | **3,138.02** |

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Precio unitario antes de IVA | **2,705.19 MXN** |
| Peso neto que se manda (lámina + aros, incluido el suelto) | 37.923 kg |
| Precio por kg neto | 71.33 MXN/kg |
| Precio por metro lineal | 901.73 MXN/m |
| Horas de mano de obra directa (reales) | 3.751 h |
| Margen de contribución (P − CD)/P | 42.6 % |
| Markup sobre costo total | 30.4 % |
| Costo de la merma en lámina | 2.996 kg · 22.47 = 67.33 MXN |

### 7.2 Ejemplo B — Codo de 90°, 5 gajos, Ø12", calibre 16 (el "factor" en acción)

Mismos maestros, mismo calibre, mismas bridas y primario que el Ejemplo A (la pintura se elige en la partida: primario).

**Geometría** (D_nom = 304.8 mm, R = 1.5·D = 457.2 mm, θ = 90°, 5 gajos → j = 4 juntas, α = 22.50°)

```text
l_g     = 2·R·tan(α/2) = 2 · 457.2 · tan(11.250°) = 181.885 mm
L_eje   = j · l_g = 4 · 181.885                  = 727.542 mm   (λ = L_eje/D = 2.38695)
A_neta  = π · D_med · L_eje = π · 306.3189 · 727.542 / 10⁶ = 0.70013 m²   (= 7.4988·D²)
Tramo recto de igual longitud de arco (π/2·R = 718.17 mm): A = π·D_med·arco = 0.69111 m²
F_arco  = 0.70013 / 0.69111 = 1.01305  =  tan(α/2)/(α/2)
κ_junta = √(1 + tan²(α/2)/2) = 1.00984 ;  P_junta = π·D_med·κ = 971.80 mm
L_corte = π·D_med·(2·j·κ + 2) + 2·L_eje = 11.154 m ;  L_soldadura (chapa) = j·P_junta + L_eje = 4.615 m
```

**Comparación contra el tramo recto del Ejemplo A con brida en ambos extremos** (mismos maestros; ambos con 2 bridas, primario, calibre 16)

| Concepto | Tramo recto 3 m | Codo 90° · 5 gajos |
| --- | --- | --- |
| Área neta de lámina (m²) | 2.8900 | 0.7001 |
| Merma φ | 8 % | 20 % |
| Lámina bruta (kg) | 37.455 | 10.435 |
| Peso neto terminado, con aros (kg) | 37.923 | 11.812 |
| Longitud de soldadura total (m) | 5.01 | 6.63 |
| Horas de MOD reales (h) | 3.96 | 5.26 |
| Costo directo CD (MXN) | 1,578.00 | 1,027.97 |
| Precio antes de IVA (MXN) | 2,768.21 | 2,111.94 |
| Precio por kg neto (MXN/kg) | 73.00 | 178.80 |
| Horas MOD por kg neto (h/kg) | 0.104 | 0.445 |

**Lectura:** el área del codo es sólo 1.3 % mayor que la de un tramo recto de igual longitud de eje (F_arco = 1.0131), pero su **precio por kg neto es 2.45×** el del tramo recto y su **costo directo por m² de lámina es 2.69×**. El sobrecosto no está en el área: está en la merma (20 % vs 8 %), en el corte perfilado, en el armado (k_dif = 1.35) y en la soldadura de 4 juntas elípticas.

### 7.3 Ejemplo C — Reducción con injerto 45° sobre el cono, Ø12" → Ø10" con injerto Ø6", calibre 16

La pieza nueva del taller resuelta de punta a punta, con los largos en automático. Mismos maestros y mismas bridas que los ejemplos A y B.

**Datos de entrada** (los dos largos se dejan en automático)

| Variable | Valor |
| --- | --- |
| `familia` | REDUCCION_INJERTO (reducción con injerto: el injerto va **sobre el cono**) |
| `material_id` · `calibre` | ACERO_CARBON · 16 (tabla MSG) |
| `D1_mm` · `D2_mm` | 12 in = **304.8 mm** → 10 in = **254.0 mm** |
| `d_mm` | 6 in = **152.4 mm** (injerto) |
| `beta_deg` | **45°** (el taller maneja 30° o 45°) |
| Inclinación (maestros) | `proceso.injerto_inclinado_hacia = MENOR`: el injerto va de extremo mayor a menor, hacia D2 |
| `L_reduccion_mm` · `L_ramal_mm` | vacíos → automáticos (paso 2) |
| `tipo_union` | BRIDADO en los tres extremos (D1, D2 y el injerto) |
| `pintura` · `riesgo` | PRIMARIO · MEDIO |

**Paso 1 · Diámetros medios** (e = 1.5189 mm)

```text
D1_med · D2_med · d_med           = 306.3189 · 255.5189 · 153.9189 mm   →   R1 = 153.159 · R2 = 127.759 · r_b = 76.959 mm
r_med (radio del cono a la mitad) = (R1 + R2) / 2 = 140.459 mm      k = r_b / r_med = 0.5479   (< 1: el injerto es más chico que el cono)
```

**Paso 2 · Silleta sobre el cono y largo automático de la reducción**

```text
Largo mínimo de la reducción                = el menor L que aloja la silleta con 25 mm de holgura a cada extremo  →  L = 247.41 mm  (piso de 15°: 94.79 mm)
Cono: pendiente y semiángulo                = m = (R1 − R2) / L = 0.10266 ;  semiángulo = 5.86° ;  generatriz s = 248.71 mm
Cruce de ejes (silleta centrada en L/2)     = x_j = -16.76 mm   (el eje del injerto cruza el eje del cono; puede caer fuera del cono)
Silleta sobre el cono                       = x ∈ [25.00, 222.41] mm  →  holgura 25.00 mm a cada extremo
t(φ): generatriz φ del injerto toca el cono = raíz positiva de  a·t² + b·t + g = 0 ,  a = sin²β − m²·cos²β = 0.49473
t_med · t_max                               = 184.41 mm · 261.27 mm
L_ramal (injerto)                           = t_max + 150 = 411.27 mm   (generatriz más larga + tramo recto de maestros)
```

**Paso 3 · Área por pieza y área neta**

```text
A_cono     = π · (R1 + R2) · s = π · (153.159 + 127.759) · 248.71 = 0.21949 m²
A_orificio = ∮ G(x) dθ sobre la silleta (G' = r·√(1 + m²)) = 0.02489 m²
A_injerto  = π · d_med · (L_ramal − t_med) = π · 153.9189 · (411.27 − 184.41) = 0.10970 m²
A_neta     = A_cono − A_orificio + A_injerto = 0.30430 m²
```

**Paso 4 · Peso y merma (φ = 28 %)**

```text
m_neta          = A_neta · w_a = 0.30430 · 11.9235 = 3.628 kg
m_bruta         = m_neta / (1 − φ) = 3.628 / 0.72 = 5.039 kg
Costo de lámina = 5.039 · 22.47 = 113.23 MXN
```

**Paso 5 · Corte, soldadura y armado**

```text
P_h (perímetro de la silleta) = 566.09 mm   (suma de la polilínea de la silleta)
L_corte                       = [π·(D1_med + D2_med) + 2·s] + P_h + 2·(π·d_med + L_ramal) = 4.6182 m
Soldadura a tope              = s + (L_ramal − t_med) = 0.4756 m   (costura del cono + costura del injerto)
Soldadura de filete           = P_h = 0.5661 m   (silleta del injerto)
Piezas · juntas internas      = 2 (cono e injerto) · 1 (silleta)
Rolado equivalente            = n·k·L = 0.8092 m   (cono k = 1.6; injerto k = 1)
Bridas                        = 3 aros (D1, D2 y d): 1215.8 mm · 1056.2 mm · 737.0 mm
```

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Costo directo (CD) | 838.48 MXN |
| Precio unitario antes de IVA | **1,777.96 MXN** |
| Peso neto terminado (lámina + 3 aros) | 7.915 kg |
| Precio por kg neto | 224.64 MXN/kg |
| Horas de mano de obra directa (reales) | 4.768 h  (k_dif armado = 1.9) |

**Sensibilidad** (misma pieza, un solo cambio)

| Variante | L reducción (mm) | Orificio (m²) | Precio (MXN) | vs. base |
| --- | --- | --- | --- | --- |
| Base: 45°, de extremo mayor a menor (hacia D2) | 247.4 | 0.0249 | 1,777.96 | — |
| 30°, hacia D2 | 320.7 | 0.0340 | 1,846.77 | +3.9 % |
| 45°, si se inclinara hacia D1 (`MAYOR`) | 288.7 | 0.0304 | 1,816.63 | +2.2 % |

**Lectura:** el precio por kg neto es **3.15×** el del tramo recto del Ejemplo A, por lo mismo que el codo: merma de 28 % contra 8 %, dificultad de armado 1.9 contra 1.0 y tres bridas en una pieza chica. A 30° la silleta es más larga y el cono también; hacia el extremo menor el cono "se cierra" y la silleta resulta más corta que si el injerto mirara hacia el mayor.

### 7.4 Caso real — la hoja de control de gastos del 6-oct-2026 (vendido en $45,710 con IVA)

**El proyecto.** Ductería cal. 22 que fabricó un proveedor ($22,000 con IVA); **30 bridas de placa de 3/16″** de 5″, 6″ y 7″ (24 + 2 + 4) que cortó con plasma el proveedor de corte (cotización del 2-oct-2026: $3,440 más IVA = $3,990.40); **30 bridas de solera hechas en el taller** (22 para ducto de 11″, 6 de 10″ y 2 de 9″) en **4 días**, pintadas con esmalte y selladas con Sikaflex (sin empaque); soportería (7 ménsulas de 650 mm hechas en 2 días, 7 abrazaderas para el ducto de 11″ y un poste); mangueras con sus abrazaderas, y la **instalación local, en Querétaro, con dos personas durante 5 días** (sin hospedaje ni comidas) más un viaje Querétaro–México (casetas $806 y gasolina $1,500). Otro ingeniero lo vendió en **$45,710 con IVA** ($39,405.17 antes de IVA); la hoja calculó un costo total de $46,539.06 y una «ganancia» de −$829.06. El proyecto completo —partidas y gastos, con las respuestas del taller del 7-oct-2026— viene en la app como ejemplo (Compras y gastos → «Ver el ejemplo»; `src/datos/ejemplos.js`) y es el caso de referencia de `tests/caso_real.test.js`.

**Lo que corrige la app** (§7.4.1). La hoja restó de la venta con IVA sus compras con IVA y la raya, que no lleva IVA: no descontó el **IVA neto que se le paga al SAT** ($713.23). Además pagó 2 días de bridas en lugar de 4 y no traía los 2 días de las ménsulas ni el esmalte. Con todo, lo gastado sin IVA es **$43,277.47** contra una venta de **$39,405.17** sin IVA: el proyecto **pierde $3,872.30 antes de indirectos (−9.8 %)** y, con los indirectos que estima la cotización (ilustrativos), **$17,023.24**.

**Las partidas en la app** (con las tablas de arranque):

| # | Partida | Familia | Cant. | Horas | Costo directo (MXN) | Precio antes de IVA (MXN) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Ductería cal. 22 fabricada por proveedor | Comprado | 1 | 0.00 | 18,965.52 | 27,781.73 |
| 2 | Brida de placa 3/16″ para ducto de 5″ (Ø 194/130 mm, barrenos en Ø 170 mm) | Comprado | 24 | 0.00 | 3,111.87 | 4,558.56 |
| 3 | Brida de placa 3/16″ para ducto de 6″ (Ø 221/157 mm, barrenos en Ø 193 mm) | Comprado | 2 | 0.00 | 281.51 | 412.38 |
| 4 | Brida de placa 3/16″ para ducto de 7″ (Ø 258/182 mm, barrenos en Ø 230 mm) | Comprado | 4 | 0.00 | 650.08 | 952.28 |
| 5 | Bridas de solera para ducto Ø11″ | Bridas sueltas | 22 | 23.74 | 4,047.02 | 8,665.58 |
| 6 | Bridas de solera para ducto Ø10″ | Bridas sueltas | 6 | 6.28 | 1,056.17 | 2,271.06 |
| 7 | Bridas de solera para ducto Ø9″ | Bridas sueltas | 2 | 1.86 | 313.60 | 673.94 |
| 8 | Ménsulas para soportar ductos (650 mm) | Soportería | 7 | 16.00 | 2,174.01 | 5,029.22 |
| 9 | Abrazaderas para fijar los ductos a las ménsulas | Soportería | 7 | 1.75 | 242.77 | 557.41 |
| 10 | Poste | Soportería | 1 | 0.25 | 466.99 | 712.89 |
| 11 | Abrazadera ajustable para manguera | Comprado | 18 | 0.00 | 853.45 | 1,250.10 |
| 12 | Manguera azul de 6″ (tramo de 5 m) | Comprado | 3 | 0.00 | 5,422.47 | 7,943.13 |
| 13 | Instalación local en Querétaro (2 personas, 5 días) y un viaje a México | Instalación | 1 | 80.00 | 7,137.93 | 10,456.03 |
|  | **Total** |  |  | **129.88** | **44,723.40** | **71,264.31** |

**Las bridas de solera: la regla del taller y el cálculo.** La hoja corta cada aro de π·(D + 81 mm). El cálculo da lo mismo con la fibra neutra del aro y las puntas que la roladora no curva (§3.5.1):

| Bridas | Ø ducto | Regla de la hoja π·(D + 81) (mm) | Cálculo: π·(D_ext + 2c) + 3 + 126 (mm) | Diferencia (mm) | Horas de taller | Precio (MXN) |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | 11″ = 279.4 mm | 1132.2 | 1131.8 | -0.4 | 23.74 | 8,665.58 |
| 6 | 10″ = 254.0 mm | 1052.4 | 1052.0 | -0.4 | 6.28 | 2,271.06 |
| 2 | 9″ = 228.6 mm | 972.6 | 972.2 | -0.4 | 1.86 | 673.94 |
| **30** |  | **33169** | **33157** |  | **31.88** | **11,610.58** |

Las **31.88 h** de taller de las 30 bridas son los **4 días** que dijo el taller: con ellos se calibraron los tiempos de rolado y barrenado de T7b (el reparto entre los dos es un supuesto, §10.12).

**Las bridas de placa del proveedor de corte** (§3.6.3): el precio de la cotización (antes de IVA), la tornillería de su media junta (los 6 barrenos de los planos de pedido: 3 juegos por brida) y el Sikaflex sobre su círculo de barrenos:

| Brida de placa 3/16″ (proveedor de corte) | Cant. | Precio sin IVA | Círculo de barrenos | Juegos de tornillo | Sikaflex (mL) | Costo directo (MXN) |
| --- | --- | --- | --- | --- | --- | --- |
| Brida de placa 3/16″ para ducto de 5″ (Ø 194/130 mm, barrenos en Ø 170 mm) | 24 | 110.00 | Ø170 mm | 72 (3 por brida) | 294.8 | 3,111.87 |
| Brida de placa 3/16″ para ducto de 6″ (Ø 221/157 mm, barrenos en Ø 193 mm) | 2 | 120.00 | Ø193 mm | 6 (3 por brida) | 27.9 | 281.51 |
| Brida de placa 3/16″ para ducto de 7″ (Ø 258/182 mm, barrenos en Ø 230 mm) | 4 | 140.00 | Ø230 mm | 12 (3 por brida) | 66.5 | 650.08 |
| **Total** | **30** | **3,440.00** |  | **90** | **389.2** | **4,043.47** |

**La instalación, paso a paso** (§4.5):

```text
Horas en obra       = 1 vez · 2 personas · 5 días · 8 h = 80 h   (horas reales: en obra no se aplica la eficiencia del taller)
Mano de obra        = 80 h · 62.50 = 5,000.00 MXN   (500 por día ÷ 8 h)
Herramienta menor   = 3 % · MO = 150.00 MXN
Casetas             = 1 viaje · 806.00 con IVA / 1.16 = 694.83 MXN   (con factura: el IVA se acredita)
Gasolina            = 1 viaje · 1,500.00 / 1.16 = 1,293.10 MXN
Hospedaje y comidas = 0: la instalación es local, en Querétaro
Costo directo       = 7,137.93 MXN
Indirectos por hora = 0.00 / h (la cuadrilla no usa la nave: `capas.gif_por_hora_instalacion`) + 8 % de administración
Precio antes de IVA = 10,456.03 MXN
```

**La soportería** (§3.6.2; el largo de la ménsula —brazo y pierna de 650 mm— es un supuesto que reproduce la compra; las abrazaderas no llevan tornillería propia: los juegos de la hoja son los de las bridas):

```text
Ménsulas: barra               = Ángulo 1¼" × 1/8": 260.00 con IVA → 224.14 sin IVA → 37.36/m
Ménsulas: perfil              = 7 piezas · 1.30 m (brazo y pierna de 650 mm) = 9.10 m · 37.36 / (1 − 0.05) = 357.83 MXN
Ménsulas: anclajes            = 7 · 4 = 28 × Taquete de 3/8″ (16.00 con IVA → 13.79) = 386.21 MXN
Ménsulas: tiempo de taller    = 7 · 137.14 min reales / 60 = 16.00 h (los 2 días del taller) · (62.50 de mano de obra + 25.00 de equipo)/h = 1,399.97 MXN
Abrazaderas: largo            = π·(D + t)/2 + 2·oreja = π·(279.4 + 3.175)/2 + 2·50 = 543.9 mm   (media vuelta al ducto de 11″ y dos orejas)
Abrazaderas: perfil           = 7 · 0.5439 m = 3.81 m de Solera 1¼" × 1/8" = 86.37 MXN (sin tornillería propia)
Abrazaderas: tiempo de taller = 7 · 15 min (tabla) / 60 = 1.75 h
Compra                        = 2 ángulos (4 ménsulas por barra), 1 solera (11 abrazaderas por barra) y el poste
```

**Lo que hay que comprar** (§5.5). La app compra lo mismo que compró el taller: **6 soleras** de 1½″ × 3/16″ (la hoja: 33.17 m ÷ 6 m = 5.53), 2 ángulos de 1¼″ × 1/8″, una solera de 1¼″ × 1/8″, un PTR, 28 taquetes, **220 juegos de tornillos** (208 exactos, los mismos de la hoja: 118 de las bridas de solera y 90 de las de placa, con los barrenos de los planos) y **2 Sikaflex** (1 084 mL: la junta de las 60 bridas). Lo único que la hoja no traía es el esmalte (1 L) y su diluyente:

| Grupo | Concepto | Se necesita | Se compra | Precio sin IVA | Importe (MXN) | Cotizado (MXN) | Sobrante (MXN) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Barra | Solera 1½" × 3/16" (brida estándar) | 5.53 | 6 barras | 215.52 | 1,293.10 | 1,253.65 | 39.45 |
| Barra | Ángulo 1¼" × 1/8" | 1.52 | 2 barras | 224.14 | 448.28 | 357.83 | 90.44 |
| Barra | Solera 1¼" × 1/8" | 0.63 | 1 barra | 129.31 | 129.31 | 86.37 | 42.94 |
| Barra | PTR 2" × 2" cal. 14 (6 m) | 1.00 | 1 barra | 422.41 | 422.41 | 444.65 | — |
| Tornillería | Juego de tornillo 5/16x1-1/4 | 208 | 220 juegos | 3.67 | 807.40 | 801.53 | 5.87 |
| Sellador | Sellador (cartucho de 600 mL) | 1.81 | 2 cartuchos | 395.69 | 791.38 | 715.03 | 76.35 |
| Pintura | Pintura: esmalte | 0.33 | 1 L | 260.00 | 260.00 | 84.91 | 175.09 |
| Pintura | Diluyente | 0.03 | 1 L | 70.00 | 70.00 | 2.29 | 67.71 |
| Anclaje | Taquete de 3/8″ | 28 | 28 pzas | 13.79 | 386.21 | 386.21 | — |
| Comprado | Ductería cal. 22 fabricada por proveedor | 1 | 1 pza | 18,965.52 | 18,965.52 | 18,965.52 | — |
| Comprado | Brida de placa 3/16″ para ducto de 5″ (Ø 194/130 mm, barrenos en Ø 170 mm) | 24 | 24 pzas | 110.00 | 2,640.00 | 2,640.00 | — |
| Comprado | Brida de placa 3/16″ para ducto de 6″ (Ø 221/157 mm, barrenos en Ø 193 mm) | 2 | 2 pzas | 120.00 | 240.00 | 240.00 | — |
| Comprado | Brida de placa 3/16″ para ducto de 7″ (Ø 258/182 mm, barrenos en Ø 230 mm) | 4 | 4 pzas | 140.00 | 560.00 | 560.00 | — |
| Comprado | Abrazadera ajustable para manguera | 18 | 18 pzas | 47.41 | 853.45 | 853.45 | — |
| Comprado | Manguera azul de 6″ (tramo de 5 m) | 3 | 3 tramos | 1,807.49 | 5,422.47 | 5,422.47 | — |
|  | **Total** |  |  |  | **33,289.53** | **32,813.90** | **497.86** |

**Real contra cotizado** (§5.7, con los 20 renglones capturados como gastos: los de la hoja, las bridas de placa como las cotizó el proveedor, la raya a $62.50 y el esmalte estimado):

| Renglón del control de gastos | Cotizado (MXN) | Real (MXN) | Diferencia (MXN) | Real / cotizado |
| --- | --- | --- | --- | --- |
| Material | 2,795.28 | 2,891.90 | +96.62 | 103 % |
| Consumibles | 365.87 | 330.00 | −35.87 | 90 % |
| Mano de obra del taller | 3,117.61 | 3,000.00 | −117.61 | 96 % |
| Compras y trabajos de terceros | 28,681.44 | 28,681.44 | — | 100 % |
| Soportería y anclajes | 1,275.05 | 1,386.20 | +111.15 | 109 % |
| Mano de obra de instalación | 5,000.00 | 5,000.00 | — | 100 % |
| Viáticos y traslados | 1,987.93 | 1,987.93 | — | 100 % |
| **Total** | **43,223.19** | **43,277.47** | **+54.28** | **100 %** |

Lo cotizado queda a $54.28 (0.1 %) de lo gastado. El costo directo de la cotización suma además $1,500.21 de equipo del taller, que no llega con ticket.

**El resultado del proyecto:**

| Concepto | MXN | Qué es |
| --- | --- | --- |
| Venta pactada (sin IVA) | 39,405.17 | Se pactó con IVA: 45,710.00 ÷ 1.16; el IVA (6,304.83) es del SAT |
| Gastos reales sin IVA | 43,277.47 | 20 renglones: los de la hoja, la raya a 62.50 por hora y el esmalte estimado; el IVA acreditable (5,644.40) no es costo |
| **Utilidad antes de indirectos** | **−$3,872.30** | −9.8 % de la venta: lo que la hoja llama «ganancia», corregido (§7.4.1) |
| Comisión de ventas y otros | −$788.10 | 2 % de la venta |
| Equipo del taller (hora-máquina) | −$1,500.21 | Estimado de la cotización: no llega con ticket |
| Indirectos, imprevistos y financiamiento | −$10,862.62 | Estimados con las tablas maestras (GIF $85.00/h de taller, 8 % de administración, 4 % de imprevistos): ilustrativos |
| **Utilidad después de indirectos** | **−$17,023.24** | −43.2 % de la venta |

#### 7.4.1 Por qué la hoja daba −$829 y la app da −$3,872

| Paso | MXN | Por qué |
| --- | --- | --- |
| Resultado de la hoja | −$829.06 | 45,710.00 de venta (con IVA) − 46,539.06 (compras con IVA y 6,000.00 de raya) |
| − IVA neto que se le paga al SAT | −$713.23 | De los 6,304.83 de IVA de la venta sólo se acreditan los 5,591.60 de las compras: la raya no trae IVA |
| = La hoja, con su IVA | −$1,542.30 | Es lo mismo que la venta sin IVA (39,405.17) menos los gastos de la hoja sin IVA |
| − 2 días más de bridas y 2 de ménsulas | −$2,000.00 | 32 h × 62.50: las bridas llevaron 4 días (la hoja pagó 2) y las ménsulas 2 (no venían) |
| − Esmalte y diluyente | −$330.00 | No venían en la hoja; estimado: 1 L de cada uno, lo que pide la lista de compras |
| **= Utilidad antes de indirectos** | **−$3,872.30** | La misma que da el control de gastos de la app |

**La hora de $62.50.** El taller cuesta la hora como el salario del día ÷ 8 h. Pero la semana paga 7 días por 5 trabajados: cada hora trabajada cuesta $3,500 ÷ 40 h = $87.50, y eso sin prestaciones (IMSS, aguinaldo, vacaciones). En este proyecto (128 h de raya) son $3,200 más de pérdida que la hoja no ve:

| Cómo se cuesta la hora | MXN por hora | Raya del proyecto (128 h) | Utilidad antes de indirectos |
| --- | --- | --- | --- |
| Como la calcula el taller: $500 ÷ 8 h (FSR 1.00) | 62.50 | 8,000.00 | −$3,872.30 |
| Con los días de descanso pagados: $3,500 ÷ 40 h trabajadas (FSR 7/5 = 1.40) | 87.50 | 11,200.00 | −$7,072.30 |

Para que la app lo cobre basta poner `FSR` = 1.40 en las tablas maestras (T8); con prestaciones, más.

**¿En cuánto se debió vender?**

| Precio | MXN sin IVA | Con IVA | Contra la venta (39,405.17 sin IVA) |
| --- | --- | --- | --- |
| Costo directo de la cotización | 44,723.40 | 51,879.14 | faltaron 5,318.23 (13.5 % de la venta) |
| Precio mínimo (utilidad cero: cubre indirectos, financiamiento y comisión) | 56,720.43 | 65,795.70 | faltaron 17,315.26 (43.9 % de la venta) |
| Precio calculado (20 % de utilidad sobre el precio) | 71,264.31 | 82,666.60 | faltaron 31,859.14 (80.9 % de la venta) |

La venta no pagó ni el costo directo: le faltaron $5,318.23. Para el precio mínimo, con los indirectos ilustrativos de las tablas, faltaron **$17,315.26 (44 % de la venta)**, y con 20 % de utilidad sobre el precio la app calcula **$71,264.31 más IVA ($82,666.60)**. La hoja proponía $58,173.83 antes de impuestos (25 % sobre su costo con IVA) y $67,481.64 con IVA. Cuánto de esa diferencia es real depende de los indirectos del taller, que hoy son ilustrativos (§10.1).

### 7.5 Caso real — el pedido de ductería completo: ¿fabricar o comprar?

**El pedido.** Los planos con que el taller pidió la ductería: la hoja de bridas (60), la de codos (7), tres de reducciones con injerto (9) y tres de yardas (ductos de 11″, 10″, 6″ y 5″ en yardas de 914 mm) del 30-sep-2026, y dos de armado de piezas (6 uniones) del 2-oct-2026. El proveedor lo cobró en **$22,000 con IVA, y fue en lámina galvanizada cal. 22** (el taller, 7-oct-2026; los planos dicen cal. 24). Como todo el galvanizado, **se engargola**: costuras, juntas y el armado de piezas, igual que las yardas entre sí (§3.4.7); y las bridas **no se sueldan**: se meten y se le hace una ceja al ducto (§3.5.9). Cada pieza lleva sus bridas «de otra partida» —las hacen el taller y el proveedor de corte (§3.5.8)— en los extremos que dicen los planos, y van sin brida los que se unen a otra pieza o a una manguera. Viene en la app como ejemplo (pestaña Planos → «Ver el ejemplo: pedido del 30-sep-2026»; `src/datos/ejemplos.js`) y es el caso de referencia de `tests/planos.test.js` y de la sección 25 de `tests/e2e/ui.e2e.js`.

**Las yardas, como en los planos:**

| Ducto | Piezas | Cada pieza | Largo (mm) | Bridas (de otra partida) |
| --- | --- | --- | --- | --- |
| 11″ | 4 | 3 yardas unidas | 2,742 | en ambos extremos |
| 11″ | 1 | 2 yardas unidas + 600 mm de ajuste | 2,428 | en un extremo + una suelta (el ajuste) |
| 11″ | 1 | 2 yardas unidas | 1,828 | en un extremo |
| 11″ | 2 | 1 yarda | 914 | en un extremo |
| 10″ | 1 | 3 yardas unidas | 2,742 | en ambos extremos |
| 6″ | 1 | 1 yarda | 914 | en un extremo |
| 5″ | 1 | 1 yarda | 914 | en un extremo |
| 5″ | 1 | 3 yardas unidas | 2,742 | en ambos extremos |
| 5″ | 1 | 2 yardas unidas + 500 mm de ajuste | 2,328 | en un extremo + una suelta (el ajuste) |
| 5″ | 3 | 2 yardas unidas | 1,828 | en un extremo |
| 5″ | 4 | 1 yarda + 700 mm de ajuste | 1,614 | en un extremo |

Los planos cuentan «18 yardas» de 11″ (el ajuste de 600 mm aparte) y «20 yardas» de 5″; la app cuenta 16 yardas completas de 5″ y 5 tramos de ajuste: el de 500 mm y los cuatro de 700 mm, que el plano llama «2 yardas unidas».

**Las bridas cuadran con la hoja de bridas en cuatro diámetros.** Con los extremos que van sin brida, las piezas piden:

| Ducto | Piden las piezas | Hoja de bridas (partidas) | Resultado |
| --- | --- | --- | --- |
| 11″ | 22 | 22 | cuadran |
| 10″ | 6 | 6 | cuadran |
| 9″ | 2 | 2 | cuadran |
| 7″ | 4 | 4 | cuadran |
| 6″ | 3 | 2 | **faltan 1** |
| 5″ | 21 | 24 | **sobran 3** |

La de 6″ que falta «va en otra unión» (el taller, 7-oct-2026): mandará el diagrama. Las 3 de 5″ que sobran pueden ser reserva, o la boca del codo de 60° de 5″ que pide el armado de la reducción de 11″ a 10″ y que no viene en la hoja de codos (§10.13).

**Engargolado y con ceja contra todo soldado.** Lo que cambia en el pedido que el galvanizado se engargole y que las bridas lleven ceja:

| El pedido (cal. 22) | Todo soldado | Engargolado y con ceja (el taller) |
| --- | --- | --- |
| Soldadura (m) | 112.0 | 0.0 |
| Engargolado (m) | 15.7 | 91.1 |
| Bridas con ceja | 0 | 56 |
| Lámina neta (kg) | 209.6 | 222.3 |
| Mano de obra (h) | 49.4 | 48.2 |
| Consumibles (MXN) | 799.37 | 335.75 |
| Costo directo (MXN) | 13,555.06 | 13,758.64 |

No se suelda un solo metro de lámina: la soldadura de las costuras y las juntas pasa a engargolado (sumada al de las juntas entre yardas que ya había) y la de las bridas al ducto, a 56 cejas; la lámina sube por la holgura del Pittsburgh y por las cejas, y los consumibles bajan a menos de la mitad porque ya no hay alambre ni gas. Con los tiempos de arranque, el costo directo queda muy parecido.

**¿Fabricar o comprar?** El proveedor cobró **$18,965.52 antes de IVA**. La app costea la misma ductería —las 24 partidas de lámina y las 6 uniones, sin las bridas, que en los dos casos son del taller—:

| Escenario (30 partidas de ductería) | Costo directo | Material | Mano de obra | kg | Precio mínimo | Precio calculado | Costo directo / proveedor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Cal. 22, con las bridas metidas y su ceja (el pedido)** | 13,758.64 | 8,861.51 | 48.2 h · 3,010.32 | 222 | 20,460.94 | 26,821.53 | 73 % |
| Cal. 22, sin meter las bridas | 12,670.03 | 8,764.18 | 37.1 h · 2,317.23 | 220 | 18,174.14 | 23,983.17 | 67 % |
| Cal. 24 (lo que dicen los planos), con las bridas y su ceja | 11,776.76 | 6,890.40 | 48.0 h · 3,003.06 | 183 | 18,139.60 | 23,935.43 | 62 % |

Hecha en el taller, la ductería costaría en directo $13,758.64: el **73 %** de lo que cobró el proveedor. Pero con los indirectos ilustrativos de las tablas el **precio mínimo** sería de $20,460.94, **más que el precio del proveedor**: comprarla convino, salvo que el taller tenga tiempo libre (sus indirectos ya pagados), en cuyo caso hacerla ahorraría hasta unos $5,200. Dos salvedades: los tiempos de taller de la ductería no están calibrados (sólo los de las bridas, §7.4), y el precio calculado incluye el cargo mínimo de las 6 uniones ($250 cada una). Para decidir conviene capturar las horas reales de una yarda, de un codo y de una ceja (§10.1).

---

## 8. Arquitectura de datos, módulos y plataformas

### 8.1 Modelo de datos

Modelo lógico recomendado. La aplicación de referencia (`src/web/`) guarda la cotización en el navegador (`localStorage`) y exporta/importa JSON; un despliegue multiusuario debe llevar este modelo a una base de datos. Las **tablas maestras se guardan solas** cada vez que se editan: en el almacén del artefacto (documento `config/maestros` de la capacidad `db`, que sobrevive a cerrar el navegador, a cambiar de equipo y a publicar versiones nuevas de la página) y, siempre, en `localStorage` como respaldo. Se guardan como **parche** respecto a los valores de arranque (`diferencia` / `mezclar` en `src/motor/util.js`) y no como copia completa: si los valores de arranque cambian (p. ej. al adoptar un estándar nuevo de bridas), quien no editó esa celda recibe el valor nuevo en lugar de quedarse con el viejo.

Reglas del guardado automático (`src/web/almacen.js`): la escritura se hace tras una pausa de 0.7 s para juntar una ráfaga de cambios y de a una por vez; mientras no se confirma, el cambio queda marcado como *pendiente* en el navegador, y si falla se reintenta (y se sube al volver a abrir); al abrir manda lo guardado en el artefacto, salvo que haya cambios pendientes, y lo que se edite mientras se consulta el almacén se conserva encima. Los precios son de todos los que abren el artefacto: sólo el propietario y los editores los cambian; quien sólo puede ver los ve bloqueados. Fuera de un artefacto (archivo suelto) sólo existe el respaldo en `localStorage`.

```text
 Maestros ──1:N──▶ Cotización ──1:N──▶ Partida ──1:1──▶ ResultadoPartida
 (versionado)      (guarda el          (parámetros      (QTO · costos por capa ·
                    maestros_version_id) de §2.1)        precio · KPIs · advertencias)
     ▲
     └── Calibración: horas y kg reales por partida fabricada → ajusta φ, velocidades y k_dif
```

| Entidad | Campos clave | Notas |
| --- | --- | --- |
| `Maestros` | `version_id`, `vigente_desde`, tablas T1–T9, lista de precios del proveedor (T3b, con fecha) y `precios` con vigencia/moneda | Inmutable una vez usada en una cotización. |
| `Cotizacion` | `id`, cliente, proyecto, fecha, `vigencia_dias`, moneda, `riesgo_default`, `servicio_default`, `parametros` (§5.4), `venta_pactada` y `venta_pactada_con_iva` (§5.6), `piezas_enteras` (§5.5), `maestros_version_id`, estado | La vigencia protege contra la volatilidad del acero. |
| `Partida` | `cotizacion_id`, `n`, `familia`, parámetros (JSON de §2.1), `cantidad` | |
| `ResultadoPartida` | QTO, costos por capa, precio unitario e importe, indicadores, advertencias | Se puede recalcular con otra versión de precios sin tocar el QTO. |
| `Gasto` | `cotizacion_id`, fecha, concepto, categoría (§5.7), cantidad, precio unitario, `iva_incluido`, `con_factura` | Lo real del proyecto: su costo sin el IVA acreditable se compara con lo cotizado. |
| `Calibracion` | `partida_id`, horas reales por operación, kg bruto real, costo real, fecha | Alimenta el ajuste de φ, velocidades y `k_dif` (§10). Los gastos reales por categoría (§5.7) son su primera fuente. |

### 8.2 Mapa de implementación de referencia

| Sección del documento | Archivo |
| --- | --- |
| Tablas maestras (T1–T9) | `src/datos/maestros.js` |
| §2.2.1 Ayuda de cada dato de las tablas (qué es, cómo se llena, qué esperar; rangos usuales; origen) | `src/datos/ayuda_maestros.js` |
| Utilidades numéricas (Simpson, interpolación, parche de maestros) | `src/motor/util.js` |
| §3.1–3.4 Geometría por familia | `src/motor/geometria.js` |
| §3.3, §3.5 y T7d Lámina, merma, herrajes y pintura (qué se pinta y con qué sistema) | `src/motor/material.js` |
| §4.1 Tiempos y tarifas | `src/motor/mano_obra.js` |
| §5.1.1 Lista de precios del proveedor (kg por pieza, $/kg sin IVA, qué renglón usa el cálculo) | `src/motor/proveedor.js` |
| §4.3 Consumibles | `src/motor/consumibles.js` |
| §5 Valorización y pila de precio | `src/motor/precios.js` |
| §2.3 Validación de entrada: tipos, rangos, pertenencia, tablas maestras sanas, resultados finitos (V14–V19) | `src/motor/validacion.js` |
| §5.4, §5.6 y §6 Parámetros de la cotización, venta pactada, familias sin lámina (§3.6, §4.5), orquestación y validación | `src/motor/cotizador.js` |
| §5.5 Lista de compras en piezas enteras (acomodo en barras, redondeos, sobrante) | `src/motor/compras.js` |
| §5.7 Control de gastos (costo sin IVA acreditable, reparto de lo cotizado, resultado del proyecto) | `src/motor/gastos.js` |
| §7.4 El proyecto de la hoja de control de gastos (partidas y gastos) y §8.5 el pedido de ductería del 30-sep-2026, que la app abre como ejemplos | `src/datos/ejemplos.js` |
| §8.5 Dibujos acotados de cada pieza (trazos y cotas en mm, cotas ligadas a sus campos, títulos como en los planos, árbol SVG a escala) | `src/web/planos.js` |
| §8.5 Pestaña Planos (hojas de pedido por tipo de pieza y material, marcas, impresión) | `src/web/planos_ui.js` |
| §5.8 Cotización rápida (hojas enteras, factor, bridas por metros, utilidad e IVA) y su pestaña | `src/motor/rapida.js`, `src/web/rapida_ui.js` |
| Interfaz web (captura, desglose, editor de maestros, propuesta imprimible) | `src/web/` (`index.html`, `app.js`, `maestros_ui.js`, `maestros_ayuda_ui.js`, `esquemas.js`, `dom.js`, `estilos.css`) |
| Pestaña Compras y gastos (venta y precio mínimo, lista de compras, captura de gastos y comparación) | `src/web/compras_ui.js` |
| Guardado automático de las tablas maestras (artefacto y navegador) | `src/web/almacen.js` |
| Empaquetado a un solo HTML | `scripts/construir.js` |
| Pruebas y vector de referencia | `tests/` |

### 8.3 Mapeo a otras plataformas

| Elemento | Excel / Google Sheets | Web (React / TypeScript) | Python |
| --- | --- | --- | --- |
| Maestros | Una hoja por tabla; rangos con nombre; `XLOOKUP`/`INDEX-MATCH`; una celda por variable `precio_*` | JSON versionado o tabla SQL cargada en estado | `dict` / `pydantic`; CSV o SQL |
| Partida | Una fila por partida, una columna por entrada | Formulario + objeto tipado | `dataclass` |
| Geometría | Columnas intermedias; integrales con Simpson en una columna auxiliar de 32–64 filas, o `LAMBDA` | Funciones puras | Funciones puras |
| QTO vs precios | Hoja "Cantidades" (sin $) y hoja "Valorización" | Dos módulos | Dos módulos |
| Pruebas | Hoja "Vectores" con el Ejemplo A y la diferencia | `node --test` / Vitest | `pytest` |

### 8.4 Pruebas y vectores de referencia

- **Vector de referencia (*golden test*):** el Ejemplo A de §7.1. `tests/ejemplo_recto.test.js` lo recalcula **de forma independiente** con aritmética directa, línea por línea, y lo compara contra el motor.
- **Oráculos geométricos independientes:** codo, reducción excéntrica, transición, injerto simple (distancia media de silleta, área del orificio y perímetro de la silleta por fuerza bruta, también del mismo diámetro: `K(1) = 4/π` y `t_med` en forma cerrada) y reducción con injerto (silleta sobre el cono por bisección, polilínea y rejilla; ensamble recalculado línea por línea) se comparan contra mallas 3D y promedios numéricos de fuerza bruta (`tests/geometria.test.js`). **Toda familia nueva debe traer su oráculo independiente.**
- **Lista del proveedor y mano de obra** (`tests/proveedor.test.js`): la lista reproduce al centavo los precios sin IVA de la factura; kg por hoja y por barra y $/kg recalculados desde las medidas; qué renglón usa el cálculo (hoja estándar, calibre sin cotizar, placa, inoxidable); IVA incluido o no; un precio inválido cae a la tabla; el salario es por día y la hora cuesta salario ÷ horas por día × FSR ($62.50; con FSR 1.40, $87.50); un parche guardado con la jornada de antes pasa a horas por día, y los días de la semana y el salario por hora de versiones anteriores se descartan.
- **Parámetros de la cotización** (`tests/parametros.test.js`): cada parámetro recalculado desde `C_base` (margen, comisión, administración, días y tasa de cobro, IVA); descuento con IVA sobre el neto; utilidad real y su forma cerrada; valores inválidos que se ignoran con aviso; las tablas maestras no se mutan; la vista previa de una partida coincide con la lista; y los campos del encabezado en las pruebas de interfaz (sección 19).
- **Armado por yardas** (`tests/geometria.test.js`, `tests/motor.test.js`, `tests/ejemplo_recto.test.js`): los casos del taller (3 yardas por pieza, el extremo del ajuste sin brida de taller, a ±25 mm, ajuste solo, otro máximo de yardas por pieza); la distribución se contrasta contra un **oráculo que arma el tramo pieza por pieza con un lazo** en 4 000 largos y anchos al azar, en los tres modos del extremo libre (más invariantes: sólo la última pieza trae el ajuste, ninguna pasa de 3 yardas, lo que se corta es el largo pedido ±tolerancia); cantidades físicas (anillos, corte a lo ancho, juntas, extremos con brida, junta soldada si las tablas lo piden); **la brida suelta** (qué se le hace al aro en taller —se rola, se barrena, se le suelda el cierre y se pinta, con las mismas horas y la misma pintura que a uno de taller— y qué no —no se arma, no lleva filete al ducto ni sellador—; el material completo; el peso y los drivers por kilo y por metro de soldadura; las operaciones omitidas; con `ESPIGA` o `LISO` no hay aros; sigue a las tablas y a la partida); el **ancho de yarda de la cotización** (lo heredan sólo los tramos rectos; la partida manda; vacío, 0 o inválido se ignoran); la conversión del `ajuste_sin_brida` sí/no de la versión anterior; y el Ejemplo A recalculado de forma independiente —con su aro suelto— en los tres modos.
- **Pintura** (`tests/motor.test.js`, `tests/robustez.test.js`): la matriz material × instalación × partida (acero al carbón interior/exterior, galvanizado sólo en las bridas, inoxidable sin pintura, sistema elegido en la partida, dos caras del ducto, unión de espiga sin aros, aro suelto) con **superficie, litros de cada mano, minutos y costo recalculados a mano** desde las tablas; la instalación heredada de la cotización y la de la partida; los valores que no existen; las tablas de pintura (ubicación por omisión, manos y sistemas de cada material); y la migración de la pintura por defecto de una versión anterior.
- **Robustez** (`tests/robustez.test.js`): 640 partidas válidas al azar con semilla fija de todas las familias (sin excepciones ni `NaN`, pila de precio cerrada, cantidades independientes de los precios, ida y vuelta por JSON); cada campo numérico de cada familia corrompido con `NaN`, `±Infinity`, texto, listas, objetos y booleanos (siempre se rechaza); medidas en cero, negativas, «casi cero» y de `1e12` (se rechazan sin agotar memoria); vacíos opcionales; enumeraciones y listas; maestros con ceros, negativos, tablas de velocidad rotas o secciones ausentes (error que nombra la ruta); `cotizar()` con cotizaciones y partidas mal formadas (nunca lanza); y `sanearParche` contra parches dañados y `__proto__`. Las secciones 20 de `tests/e2e/ui.e2e.js` repiten lo visible: almacenamiento dañado, números ilegibles en el formulario, importaciones hostiles, tablas con ceros, almacenamiento bloqueado o lleno, fecha local y pantalla de 320 px.
- **Hoja de control de gastos** (`tests/compras_gastos.test.js`, `tests/caso_real.test.js`, sección 24 de `tests/e2e/ui.e2e.js`): el acomodo en barras contra la cota inferior en 2 000 casos al azar y contra el óptimo por fuerza bruta en 300; bridas sueltas, instalación con viáticos (con y sin factura, indirectos propios), soportería y artículos del catálogo con y sin IVA, **recalculados a mano** desde las tablas; la lista de compras (hojas, barras, tornillos por decena, cartuchos y litros enteros; el sobrante nunca negativo); la partida automática del sobrante; la venta pactada; el costo de cada gasto según IVA y factura; el reparto de lo cotizado por categoría (que, con el equipo, suma el costo directo); y **el proyecto real**: la app compra las mismas 6 soleras, 2 ángulos, la solera chica, el PTR y los 28 taquetes de la hoja, los 220 juegos de tornillos y los 2 Sikaflex de la hoja; lo cotizado queda a menos de 1 % de lo gastado sin IVA; las bridas de solera suman los 4 días del taller y las ménsulas sus 2, y el resultado con la venta con IVA se concilia, paso a paso, con el −$829.06 de la hoja. En el navegador: las familias nuevas, el catálogo en las tablas maestras, la lista y el sobrante, la venta pactada, la captura de gastos (IVA, factura, renglones inválidos, deshacer, «estimado»), el ejemplo con Deshacer, la persistencia y el celular.
- **Pruebas de política:** separación cantidades/precios, identidades de la pila (`P·(1 − u − c − o) = C_base`), cargo mínimo, subcontratos, validaciones, uniones, materiales (`tests/motor.test.js`).
- **Estándar de bridas del taller** (`tests/motor.test.js`): la solera de 1½" × 3/16" pesa `b·t·ρ`; el taller usa la misma brida (barreno Ø3/8", tornillo 5/16" × 1¼") en todos los diámetros; `L_aro = π·(D_ext + b) + holgura + puntas`, a menos de 1 mm de la regla del taller π·(D + 81 mm); nº de barrenos par, mínimo 6, por paso, con el gramil de 24 mm (8 / 8 / 6 / 6 en las de 11″, 10″, 9″ y 7″, como en los planos de pedido); cada aro se valoriza con el precio de su propio perfil y el tornillo con el suyo; el cierre del aro se suelda a tope al espesor de la solera; marco rectangular; y `ESPIGA` no genera aros ni barrenos.
- **Persistencia de maestros** (`tests/util.test.js`): `mezclar(base, diferencia(base, actual))` reconstruye lo editado y los valores de arranque nuevos no quedan enmascarados.
- **Guardado automático** (`tests/almacen.test.js` con un almacén de mentira, y las secciones 11–14 de `tests/e2e/ui.e2e.js` con un `window.claude` simulado cuyo almacén vive fuera del navegador): qué manda al abrir, una ráfaga de cambios = una escritura, una escritura a la vez, pendientes y reintentos, sólo lectura, cambios hechos durante la carga, y recuperación única de los precios de la versión 1.
- **Ayuda de las tablas maestras** (`tests/ayuda_maestros.test.js`, sección 23 de `tests/e2e/ui.e2e.js`): cobertura exhaustiva del catálogo contra lo que dibuja el editor (grupos, secciones, datos y tablas, incluidas las claves con punto como el perfil `SOL38x4.8`), sin entradas muertas ni tapadas; calidad de los textos (completos, con tope de longitud, sin marcas ni nombres técnicos); rangos usuales que contienen a los valores de arranque; columnas de tabla y opciones que coinciden con las reales. En el navegador: un ⓘ por cada elemento; la ventana (qué es, cómo se llena, qué esperar; Esc, clic fuera y F1); la sensibilidad «si sube 10 %» comparada con una cotización independiente; probar, aplicar y deshacer (el precio vuelve al centavo); marcas de modificado y de fuera de rango; la comparación de opciones; las listas de precios, calibres y procesos; los booleanos y el cordón vacío que sobreviven a recargar; el ajuste de golpe de salarios y precios del proveedor como un solo cambio; el ranking ordenado; la guía; la hoja del celular sin desbordamiento; y sólo lectura.
- **Extremos, bridas de otra partida, armado de piezas y cuadre de bridas** (`tests/armado_piezas.test.js`): el extremo final del tramo con y sin ajuste en sus tres modos (y el sí/no de la versión anterior, que sigue siendo sólo del ajuste); los extremos con nombre de cada familia y lo que se quita con cada uno (aro, media junta, barrenos, filete aro–ducto); las bridas de otra partida, que sólo se arman y se sueldan al ducto (el mismo filete y el mismo ajuste que con aros propios, ningún aro, tornillo, barreno, cierre ni pintura); la unión recalculada a mano (π · D_ext por unión y una junta de armado: engargolada en galvanizado, soldada en acero al carbón); el galvanizado engargolado contra el mismo codo y la misma reducción con injerto soldados (los mismos metros, transversales y longitudinales, la holgura del Pittsburgh y el sellador); la brida con ceja (sin filete, el tiempo y la lámina de la ceja exactos); y el cuadre por diámetro, con bridas de solera, de placa y piezas con bridas propias que no cuentan. `tests/robustez.test.js` los lleva también al azar y con valores hostiles.
- **Dibujos acotados** (`tests/planos.test.js`, sección 25 de `tests/e2e/ui.e2e.js`): cada familia se dibuja sin valores inválidos y su marco contiene todo; las cotas son las de los planos de pedido (codo de 5″: 191 y 254 mm; Dint/Dperf/Dext y barrenos de las bridas; los de las bridas de placa, del catálogo) y llevan el campo que miden; los títulos («Reducción de 11″ a 10″ con injerto de 5″ a 30°»); las miniaturas sin cotas; los tramos rectos como en los planos de yardas (cada yarda acotada, «3 yardas unidas», «brida en un extremo y una suelta», las bridas dibujadas donde van); y el pedido completo (36 partidas, todas con plano: sus yardas por diámetro, los barrenos de los planos y el cuadre de bridas contra la hoja de bridas). En el navegador: el dibujo vivo del diálogo, la cota resaltada con el cursor en su campo y el clic en una cota que lleva al campo, el nombre automático, las miniaturas de la lista, el plano del desglose, la pestaña Planos (las ocho hojas del pedido, marcas, títulos, datos, cajetín, el cuadre de bridas, «Ver en la cotización», Deshacer), las casillas de extremos sin brida y el selector de bridas de otra partida (quitar una casilla devuelve la brida y el cuadre la pide), la impresión de sólo las hojas, el estado vacío y el celular.
- **Cotización rápida** (`tests/rapida.test.js`, sección 26 de `tests/e2e/ui.e2e.js`): el caso de 11″ y 40 m recalculado a mano (plantilla, 33 yardas, 11 hojas, $43,392.00 con IVA); los rangos de bridas en sus bordes (40 m todavía son $5,000; 40.01 m, $12,000) y el error de más de 120 m; utilidad, factor y otra lámina; las hojas nunca bajan con más metros o más diámetro y siempre alcanzan para el área pedida; la plantilla más larga que la hoja; errores legibles y que una tabla rápida rota no detenga la cotización detallada. En la interfaz: el desglose, los rangos, fracciones, mm, lo recordado, «Limpiar» y las cinco pestañas en 320 px.
- **Interfaz de extremo a extremo (opcional, Playwright):** `tests/e2e/ui.e2e.js` da de alta cada familia, edita y guarda cada partida **sin cambios** en tres combinaciones de unidades y exige que el precio no se mueva (el formulario no pierde datos), y recorre validaciones, subcontratos, tablas maestras, persistencia, guardar/cargar y pantalla móvil.

### 8.5 Dibujos acotados y planos de pedido

El taller manda a fabricar con planos de AutoCAD: una hoja por tipo de pieza (bridas, codos, reducciones con injerto), cada pieza con su dibujo acotado, su nombre («DE 11″ A 10″ CON INJERTO DE 5″ A 30°»), su material y calibre y cuántas piezas son (planos de pedido del 30-sep-2026). La app dibuja igual cada partida, con las medidas que ya calculó el motor:

| Dónde | Qué se ve |
| --- | --- |
| Diálogo de la partida | El dibujo se rehace mientras se captura. La cota del campo donde está el cursor se resalta; pulsar una cota lleva al campo que la mide. Sin descripción, la partida toma el nombre de los planos. |
| Lista de partidas | Una miniatura de la pieza (sin cotas) en lugar del ícono de la familia. |
| Desglose | «Plano de la pieza»: el dibujo grande y sus datos (D, R, gajos, Dint/Dperf/Dext, barrenos…). |
| Pestaña **Planos** | Las hojas de pedido: una por tipo de pieza y, en las de lámina, por material y calibre; los ductos rectos, además, por diámetro («Ductos de 11″», con sus yardas), y al final el armado de piezas. Cada pieza con su marca (B1, C1, I1, D1, A1…), su número de piezas, su dibujo y sus datos, y un cajetín con proyecto, fecha y número de hoja. Arriba, el **cuadre de bridas** (§3.5.8). «Ver en la cotización» lleva a la partida. «Imprimir planos» imprime sólo las hojas (sin el cuadre), una por página carta horizontal, en negro sobre blanco. |

Qué se dibuja de cada familia:

| Familia | Vista | Cotas |
| --- | --- | --- |
| Codo | Lateral, con los gajos y sus juntas | R al eje, R + D/2, D y el ángulo; nota con los gajos |
| Reducción | Lateral del cono (la excéntrica, con la cara plana arriba) | D1, D2, L |
| Reducción con injerto e Injerto simple | Lateral, con el injerto sobre el cono o el tronco, centrado en su largo | D1 y D2 (o D), L, d, largo del injerto sobre su eje, β |
| Tramo recto | Lateral (cortado si pasa de 24 diámetros), con las juntas de las yardas y sus bridas (la suelta, punteada y separada) | Cada yarda arriba, el largo total abajo y D, como en los planos de yardas; «3 yardas unidas», «bridas en ambos extremos» o «brida en un extremo» en los datos |
| Transición | Lateral | D, a × b, L |
| Brida de solera y brida de placa comprada | De frente: el aro, el círculo de barrenos y los barrenos | Dext, Dint; nota con Dperf y los barrenos |
| Soportería | La abrazadera de media vuelta con sus orejas, o la pieza de barra | D del ducto y oreja, o el largo |
| Armado de piezas | Las dos bocas que se unen (cortadas: las piezas siguen en sus partidas) y el cordón | D; nota con las uniones; en la hoja se llama como lo escribió quien lo pide («Unir injerto de 11″ con codo de 60° para obtener 90°») |

En las piezas bridadas se dibuja la brida en cada boca que la lleva (vista de lado, saliendo del ducto el ancho de la solera) y los datos dicen qué extremos van sin brida. Lo que sólo importa al cotizar —«bridas de otra partida»— aparece en el desglose pero no en las hojas para el proveedor.

El dibujo es una función pura (`src/web/planos.js`): de la partida calculada sale una lista de trazos y cotas en milímetros y de ahí un árbol SVG a escala, que la interfaz arma elemento por elemento (sin `innerHTML`). Las cotas que miden un dato de la partida llevan su nombre (`data-campo`). Un diámetro se escribe en pulgadas si es un cuarto de pulgada exacto (Ø11″) y si no en mm (Ø300).

**El pedido como ejemplo.** La pestaña Planos (y la lista vacía) abren el pedido completo de §7.5 (36 partidas): 7 codos de galvanizado cal. 22 con R = 1.5D (5″, 6″ y 11″ a 90°; 7″ y 11″ a 60°), 9 reducciones con injerto e injertos a 30° con los largos de los planos («de 11″ a 11″» y «de 6″ a 6″» son Injertos simples), 20 ductos rectos en yardas de 914 mm, 6 armados y las 60 bridas (22, 6, 2 y 4 de solera de 11″, 10″, 9″ y 7″; 2 y 24 de placa de 6″ y 5″). Salen las ocho hojas: bridas, codos, reducciones con injerto, ductos de 11″, 10″, 6″ y 5″ y armado de piezas. Las cotas de la app son las de los planos (codo de 5″: 191 y 254 mm; yardas de 914) y los barrenos también; lo que difiere se lista en §10.13.

---

## 9. Verificación contra los criterios de calidad

| Criterio | Cumplimiento | Dónde |
| --- | --- | --- |
| ¿Están claramente definidas las fórmulas para convertir diámetros y longitudes en peso (kg) de lámina? | Sí: `D_med = D_int + e` → `B = π·D_med + a_costura` → `A_neta = B·L` → `m_neta = A_neta·ρ·e/1000` → `m_bruta = m_neta/(1 − φ)`; por familia para accesorios. | §3.1–3.4 · Pasos 1–4 del Ejemplo A |
| ¿Se incluyó la lógica para calcular bridas, tornillería y selladores? | Sí: aro de solera 1½" × 3/16" (estándar del taller) con longitud por centroide, barreno Ø3/8" y tornillo 5/16" × 1¼" como datos del perfil, nº de barrenos por paso con redondeo a múltiplos de 4, cierre del aro al espesor de la solera, junta con cordón de Sikaflex (o empaque), sellador por clase SMACNA A/B/C, espiga y sus fijaciones. | §3.5 · Pasos 5–7 del Ejemplo A |
| ¿El ejemplo práctico se resuelve paso a paso sin saltarse factores de merma? | Sí: Paso 5 aplica φ = 8 % a la lámina y 5 % al perfil; sellador 15 % (también el cordón de la junta), tornillería 5 %, pintura por eficiencia de transferencia y gas por pre/post-flujo. | §7.1 |
| No asumir precios estáticos | Todos los precios son variables `precio_*` (T3) o renglones de la lista del proveedor (T3b); ninguna fórmula contiene un precio. | §2.2 · §5 |
| Factor de merma obligatorio | `φ` por familia + override por partida + modo de anidado opcional. | §3.3 · T6 |
| Sin código extenso | Fórmulas y pseudocódigo; el código vive aparte en `src/`. | §6 |

---

## 10. Calibración, límites conocidos y siguientes pasos

### 10.1 Qué debe aportar la empresa para pasar de "ilustrativo" a "cotizable"

| Parámetro | Cómo obtenerlo | Frecuencia sugerida |
| --- | --- | --- |
| Lista del proveedor (T3b) | Cotización o factura vigente: un renglón por hoja o barra, con su precio tal como se cotiza (con IVA) | Semanal / por lote |
| Precios `precio_*` de lo que no cotiza el proveedor | Cotización vigente de gas, alambre, pintura y tornillería | Semanal / por lote |
| Merma φ por familia | Pesar lámina comprada vs. pieza terminada en ≥ 10 lotes por familia | Trimestral |
| Velocidades de corte, rolado y soldadura | Cronometrar ≥ 5 piezas por calibre y proceso | Semestral |
| `FO`, `η_taller` | Muestreo de trabajo (tiempo de arco encendido vs. tiempo total) | Semestral |
| `k_dif` y merma por familia (en especial la reducción con injerto) | Horas reales y kg comprados por familia vs. estimados | Por familia |
| Salario por día (hoy $500, dato del taller), jornada, FSR, `GIF_por_hora_MOD` | Nómina real y contabilidad de costos | Anual / trimestral |
| Catálogo de compras (T3c) y viáticos | Tickets y facturas de cada proyecto (el control de gastos los junta) | Por proyecto |
| Tabla `servicios` (calibre mínimo) | Norma interna / SMACNA / ACGIH aplicable | Al adoptar la norma |
| Datos de detalle del estándar de bridas (paso entre barrenos, soldadura del aro, cordón de la junta, posición del barreno) | Confirmar con el taller los supuestos de §10.4 | Una vez, y al cambiar el estándar |

**Lazo de retroalimentación:** al cerrar cada orden se registran horas y kg reales (`Calibracion`); la desviación sistemática por operación o familia ajusta velocidades, φ y `k_dif`. Meta operativa: desviación de horas ≤ ±15 % y de peso bruto ≤ ±5 % por familia.

### 10.2 Límites conocidos (declarados, no ocultos)

- **Reducción con injerto:** la silleta se centra en el largo del cono y el cono es concéntrico; `merma` y `k_dif` son los del pantalón, ilustrativos, hasta calibrarlos (§10.5).
- **Transiciones:** sólo centradas; las excéntricas o en desfase se resuelven con `PERSONALIZADO` (área desarrollada desde CAD) o extendiendo la triangulación §3.4.3.
- **Ducto espiral, collarines, campanas, difusores:** no modelados; usar `PERSONALIZADO` o `COMPRADO`.
- **Anidado de hojas (modo B):** descrito en §3.3, no implementado; el motor usa φ de tabla.
- **Fuera de alcance:** flete a obra, renta de andamios y grúas, ingeniería. Se cotizan como `otros_gastos` de la instalación, como partidas `COMPRADO` o como módulos aparte. La instalación y la soportería ya se cotizan (§3.6.2, §4.5).
- **Valores ilustrativos:** ver §10.1. Son reales la mano de obra ($500 por día), la lámina y los perfiles de la lista del proveedor (30-sep-2026) y el catálogo de compras (6-oct-2026); lo demás (consumibles, equipo, tiempos, indirectos, utilidad) sigue siendo ilustrativo y hasta calibrarlo el motor sirve para comparar alternativas y validar la lógica, no para fijar precios de venta.
- **Lista de compras:** el acomodo en barras es *first-fit decreasing* (a lo más una barra de más que el óptimo); las hojas se cuentan por kilos, no por un anidado real de las plantillas (§3.3).

### 10.3 Siguientes pasos recomendados

1. Capturar precios, tarifas y velocidades reales (tabla §10.1) y regenerar el vector de referencia.
2. Calibrar `k_dif` y la merma de la reducción con injerto y del injerto simple con 10 órdenes reales.
3. Importar áreas desarrolladas desde DXF/CAD hacia `PERSONALIZADO`.
4. Implementar el modo de anidado de hoja (§3.3) cuando exista el layout real.
5. Conectar `Calibracion` al cierre de órdenes de producción.

### 10.4 Supuestos del estándar de bridas por confirmar con el taller

El taller definió tres datos: **solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼", en todos los ductos.** El resto del modelo de la brida se **supuso** y se edita en los maestros (T4 y T5); conviene confirmarlo, porque mueve tornillería, junta y soldadura:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Paso máximo entre barrenos | **Confirmado con los planos de pedido (30-sep-2026):** 150 mm (≈ 6"), número par, mínimo 6 (8 en las de 11″ y 10″; 6 en las de 9″ y menores) | `uniones.BRIDADO.paso_tornillo_mm` · `n_min_tornillos` · `multiplo_tornillos` | Más barrenos: más tornillería y barrenado. |
| Posición del barreno | **Confirmado con los planos de pedido:** a 24 mm del borde interior del aro (Dperf = Dint + 48 mm) | `perfiles.SOL38x4.8.gramil_mm` | Cambia el círculo de barrenos, el cordón de la junta y el nº de barrenos. |
| Soldadura del aro | Filete continuo exterior aro–ducto (`f_cont` = 1.0) y cierre a tope de una sección (b) | `uniones.BRIDADO.f_cont_soldadura_aro` | Un cordón intermitente (p. ej. 0.5) baja soldadura y consumibles, pero la junta deja de ser hermética sin sellador. |
| Junta de la brida | **Confirmado (7-oct-2026): Sikaflex en lugar del empaque**, un cordón de 40 mL por metro de círculo de barrenos (el grosor del cordón es supuesto) | `uniones.BRIDADO.junta` · `ml_sellador_junta_m` (y, con `EMPAQUE`, `precio_m_empaque_neopreno` · `f_traslape_empaque`) | Con empaque de neopreno, elegir `EMPAQUE`: la junta lleva la cinta y el cordón de la clase. |
| Juego de tornillería | Tornillo 5/16" × 1¼" + tuerca + 2 rondanas, con 5 % de reserva | `precio_juego_tornillo_5_16_x_1_1_4` · `f_reserva_tornilleria` | Si la tornillería se compra por piezas, sumar el precio de cada pieza al juego. |

### 10.5 Supuestos de injertos y codos por confirmar con el taller

El taller definió: *injerto simple* (antes ramal en ángulo); *reducción con injerto, con el injerto sobre el cono, a 30° o 45°*; **todo injerto a 30° o 45°**; **codos de 30°, 45°, 60° y 90°**. Lo demás se **supuso** y se edita en los maestros o se captura en la partida:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Cómo se lee «el injerto va de extremo mayor a menor» | El eje del injerto se inclina **hacia el extremo menor** D2, siguiendo el sentido mayor → menor | `proceso.injerto_inclinado_hacia` (`MENOR`; `MAYOR` lo invierte) | Si el taller lo inclina hacia el extremo mayor, poner `MAYOR`: el orificio crece ≈ 20 % (a 45°), el cono se alarga y el precio sube ≈ 3 %. |
| Posición del injerto en el cono | Silleta centrada en el largo del cono | Geometría (§3.4.5) | Si el taller lo asienta más cerca de un extremo, cambia poco el área pero sí el largo mínimo. |
| Largo de la reducción | El menor que aloja la silleta con **25 mm** de holgura a cada extremo (piso: 15° de semiángulo) | `proceso.injerto_margen_cono_mm`, o capturar `L_reduccion_mm` | Un cono más largo suma lámina; uno más corto de lo necesario se rechaza. |
| Largo del injerto | Generatriz más larga + **150 mm** de tramo recto | `proceso.injerto_largo_extra_mm`, o capturar `L_ramal_mm` | Cambian lámina, corte y soldadura. |
| Merma y dificultad | 28 % y `k_dif` 1.9, heredados del pantalón | `merma.REDUCCION_INJERTO`, `proceso.armado.k_dif.REDUCCION_INJERTO` | Calibrar con 10 órdenes reales. |
| Gajos de los codos | Automáticos con α ≤ 22.5° por junta: 30° → 3, 45° → 3, 60° → 4, 90° → 5 | `proceso.alfa_max_junta_deg`, o capturar `n_gajos` | Si el codo de 30° lleva 2 gajos en el taller, capturar `n_gajos = 2`. |

### 10.6 Supuestos de la lista del proveedor por confirmar

Datos que dio el taller: los trabajadores ganan **$500 por día, sin utilidades ni prestaciones**, y la hora se cuesta como $500 ÷ 8 h = $62.50 (FSR = 1.00; ver §10.12); las barras de ángulo y solera se consideran de **6 m**; el proveedor de acero cotiza hojas y barras por pieza (cotizaciones y factura del 30-sep-2026). Lo demás se **supuso** y se edita en las tablas maestras:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Los precios cotizados incluyen IVA | Sí, 16 %: la factura desglosa el IVA de precios redondos y los $/kg salen parejos; las cotizaciones por mensaje se leyeron igual | `proveedor.iva_incluido_pct` (0 % si fueran antes de IVA) | Si fueran antes de IVA, lámina y perfiles cotizados cuestan 16 % más. |
| Calibres y perfiles que no se cotizaron | Precio por kg de respaldo (T3): negra $22.47 (lámina cal. 12 de la factura), galvanizada $30.69 (promedio de cal. 22 y 24), solera $25.21, ángulo $25.25 | `precios.precio_kg_*` | Un calibre más delgado suele costar más por kg y uno más grueso menos: conviene cotizar los calibres que se usan. |
| Cuánta lámina se cobra a la pieza | La fracción de hoja que consume (`m_bruta`, con la merma de T6), no hojas completas | `merma.*` | Si compras obliga a comprar hoja completa y el retazo se pierde, subir φ de la familia. |
| Placa lisa 3 × 8 ft de 3/16" | Viene en la factura al mismo precio que la de 4 × 8 ($2 431.03 sin IVA); se dejó tal cual y es sólo referencia | `proveedor.hojas.PLACA_3_16_3X8` | Confirmar con el proveedor; no entra al cálculo. |

### 10.7 Supuestos de los parámetros de la cotización por confirmar

Lo que pidió el taller: ajustar el margen de utilidad y los demás parámetros importantes desde el encabezado de la cotización, sin ir a las tablas maestras. La selección y el comportamiento de los parámetros se **supusieron** y se editan en `PARAMETROS_COTIZACION` (`src/motor/cotizador.js`) o en los maestros:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Qué parámetros se ajustan por cotización | Margen, comisión, descuento, días de cobro y —en «Más parámetros»— administración, financiamiento anual e IVA | `PARAMETROS_COTIZACION` | Agregar otros (merma, eficiencia del taller…) exige decidir si son de la cotización o del taller. |
| El descuento reduce también la comisión | La comisión de ventas se paga sobre el precio ya descontado | `capas.comision_ventas_pct_precio` | Si la comisión se calcula sobre el precio de lista, la utilidad real baja `c · d` puntos más. |
| Dónde se aplica el descuento | Una sola cifra sobre el subtotal de toda la cotización, antes de IVA; las partidas conservan su precio | — | Un descuento por partida necesita un campo en cada partida. |
| Límites de los parámetros | Margen 0–80 %, comisión 0–20 %, descuento 0–50 %, administración 0–50 %, financiamiento 0–100 %, IVA 0–30 %, cobro 0–365 días | `PARAMETROS_COTIZACION` | Ampliarlos si la política del taller lo requiere; la pantalla toma los mismos límites. |

### 10.8 Supuestos de los límites de captura por confirmar

Los límites de T10 se **supusieron**: son los de un taller de ducto de colección de polvo y se cambian en las tablas maestras (`proceso › limites`), no en el código.

| Supuesto | Valor usado | Efecto si es distinto |
| --- | --- | --- |
| Sección (diámetro o lado) | 25 mm a 6 000 mm | Un ducto de silo o chimenea de más de 6 m exige subir `seccion_max_mm`; uno de menos de 1″, bajar `seccion_min_mm`. |
| Longitud de un tramo, injerto o tangente | 10 mm a 100 000 mm | Una pieza de menos de 1 cm no es ducto: se rechaza para no confundirla con un cero mal tecleado. |
| Espesor propio (placa) | 0.2 mm a 50 mm | Una placa mayor a 2″ se cotiza como pieza personalizada o comprada. |
| Cantidad por partida | 1 a 100 000 | Una corrida mayor se parte en varias partidas. |
| Anillos (yardas) de un tramo recto | Hasta 1 000 | Con yardas de 1 220 mm un tramo de 100 m son 82 anillos: el tope sólo se alcanza con yardas absurdamente angostas (el mínimo es 300 mm). |
| Tope de cordura de otros valores | Merma ≤ 90 %, costuras longitudinales 1–8, gajos 2–60, R/D 0.5–20, longitudes de proceso de una pieza personalizada ≤ 10 000 m, precios de compra y de subcontrato ≤ 100 millones | Son del código (`validacion.js`), no de las tablas: sólo detienen lo absurdo. |

### 10.9 Supuestos del armado por yardas por confirmar

Lo que describió el taller: se rolan yardas de 914 ó 1 220 mm (el ancho de la lámina; **lo elige el ingeniero que diseña**); se engargolan hasta 3 en una pieza con bridas en ambos extremos; lo que falta son 2 yardas y un tramo de ajuste, y la pieza que trae menos de una yarda en un lado va sin brida en ese extremo para ponerla en campo ajustando la distancia; y, **de la brida de ese extremo, el taller manda suelto el aro con sus tornillos y el material de su junta** para instalarlos en obra. Lo demás se **supuso** y se cambia en las tablas (`proceso.armado_yardas`), en el encabezado de la cotización o en la partida:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Qué cuenta en «hasta 3 yardas» | El tramo de ajuste cuenta como una: la última pieza es a lo más «2 yardas + ajuste» | `yardas_por_pieza_max` | Si el ajuste no contara, una pieza podría ser «3 yardas + ajuste» y 3 m en yardas de 914 serían una pieza con una brida (no 2 piezas y 3 bridas). |
| Cómo se reparte lo que falta | Greedy: primero piezas de 3 yardas; lo que sobra va en una última pieza (yardas completas + ajuste engargolados). Si sobra sólo el ajuste, es una pieza aparte con una brida | — (`distribuirYardas`) | Otro reparto (por ejemplo piezas más parejas) cambia el número de piezas, no el de anillos ni de bridas. |
| Brida del extremo del ajuste | **Brida suelta** por omisión: el taller manda el aro **terminado** —rolado, con el cierre soldado, barrenado y pintado— con sus tornillos y el material de su junta, **sin soldarlo al ducto** (se suelda en obra donde se corta el tramo). Se cobra su material (solera con la merma de barra, tornillería, medio cordón de Sikaflex y flete) y esas operaciones; **no** se cobra el armado del aro al ducto ni el filete aro–ducto | `extremo_ajuste_defecto` (tablas) y `extremo_ajuste` (partida): `SUELTA`, `SIN_BRIDA` o `CON_BRIDA` | `SIN_BRIDA`: la brida no está en el precio. `CON_BRIDA`: se arma y se suelda al ducto en taller (cuánto cambia el precio, en la tabla de §3.2). |
| Quién elige el ancho de la yarda | El ingeniero que diseña, una vez para toda la cotización (encabezado) o partida por partida; si nadie elige, 1 220 mm | `cotizacion.yarda_mm`, `yarda_mm` de la partida, `yarda_defecto_mm` | Todas las partidas de la cotización cambian de armado a la vez; la que trae su propio ancho no cambia. |
| Anchos de yarda | 914 y 1 220 mm | `yardas_mm` | Con 914 mm hay más anillos y más piezas por metro: sube el rolado, el engargolado y las bridas. |
| Tolerancia del ajuste | 25 mm | `ajuste_tolerancia_mm` | Un sobrante menor se toma por yardas completas. |
| Junta entre yardas | Engargolado Pittsburgh de un perímetro medio por junta; sellador en toda clase de sellado menos NINGUNA; el pliegue no suma área (se absorbe en la merma de tabla) | `junta_entre_yardas` (una costura de `proceso.costuras`) | Si se soldaran, serían soldadura a tope y juntas de armado; si el pliegue consumiera lámina, subiría φ del tramo recto. |
| Corte | Un tajo a lo ancho de la hoja por yarda completa; el ajuste, además el corte a lo largo | — | Con otra forma de cortar cambian los metros de corte (poco costo: guillotina). |
| Tramo rectangular | Mismo armado por yardas (plegado en lugar de rolado) | — | Si el rectangular se fabrica de otra forma, se captura aparte. |

### 10.10 Supuestos de la pintura por confirmar

Lo que describió el taller: la lámina galvanizada no se pinta más que las bridas; el acero al carbón sí va pintado, con sólo pintura si va en interior y con primario y pintura si va en exterior. Lo demás se **supuso** y se cambia en las tablas (`proceso.pintura`, `materiales.*.pintura_cuerpo` / `pintura_bridas`), en el encabezado de la cotización o en la partida:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| «Interior» y «exterior» | La **instalación** del ducto: interior = bajo techo, exterior = a la intemperie. No son las caras del ducto (eso es `caras_pintadas`) | `ubicacion` (cotización y partida) | Si el taller se refería a otra cosa, la regla se reescribe en T7d. |
| Instalación por omisión | **Interior** (la cotización o la partida que no la dicen) | `proceso.pintura.ubicacion_defecto` | Con exterior por omisión, todo el acero al carbón sin instalación elegida llevaría primario y pintura (más caro). |
| Sistema de las bridas del galvanizado | El mismo criterio que el acero al carbón: interior, sólo pintura; exterior, primario y pintura | `materiales.GALVANIZADO.pintura_bridas` | Si las bridas llevan siempre lo mismo (por ejemplo sólo primario), se cambia en esa tabla. |
| Pintura de las bridas del acero al carbón | El mismo sistema que el ducto | `materiales.ACERO_CARBON.pintura_bridas` | Si las bridas llevan otro, se cambia en esa tabla. |
| Inoxidable | No se pinta (ni las bridas) | `materiales.INOX_*` | Si sus bridas de solera negra se pintan, se pone el sistema en `pintura_bridas`. |
| «Sólo pintura» | Una mano de **esmalte** (la mano `esmalte` de T7d), sin primario | `proceso.pintura.sistemas.ESMALTE`, `capas.esmalte` | Si la pintura es otra (otro rendimiento o precio), se cambian sus datos; valores ilustrativos hoy. |
| Superficie del ducto que se pinta | La cara exterior (`caras_pintadas` = 1); las dos caras sólo si la partida lo pide | `caras_pintadas` | El interior pintado duplica la superficie del ducto. |
| Preparación | Una vez por parte (ducto, bridas), con `t_prep` por m², aunque lleve dos manos; cada mano suma `t_aplicación` | `proceso.pintura.t_prep_min_m2`, `t_aplic_min_m2` | Si la preparación se repite por mano, sube el tiempo de pintura del exterior. |
| Aros sueltos | Se pintan con el sistema de las bridas, como los de taller | — | — |
| Sistema elegido en la partida | Vale para todo lo que se pinta (ducto y bridas), también en galvanizado | `pintura` (partida) | Para pintar sólo el ducto o sólo las bridas habría que separar el dato. |

### 10.11 Supuestos de la ayuda de las tablas maestras por confirmar

La ayuda explica **cómo calcula este cotizador**; no sustituye al criterio del taller. Lo que se **supuso** y conviene revisar:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Rangos usuales | Intervalos **de referencia** de la industria (por ejemplo, utilidad 0–50 %, factor de operación 0.15–0.8). No son normas ni límites | `tip` de cada entrada de `ayuda_maestros.js` | Un valor fuera de rango sólo se marca y se avisa en la ayuda; nunca se impide. Si el taller opera legítimamente fuera de ellos, se amplía el rango. |
| Textos de «qué esperar» | Describen el efecto con los valores de arranque (por ejemplo «de 20 % a 25 % el precio sube ≈ 6.8 %») | `efecto` y `ej` de cada entrada | Si se cambia una fórmula del motor, hay que cambiar el texto que la explica: la prueba verifica que el texto exista y su forma, no que siga siendo cierto. |
| Sensibilidad ±10 % y ranking | Es relativa al valor actual (×0.9 y ×1.1) y a la cotización abierta; un dato con valor 0 no se prueba | `FACTOR_PRUEBA` y `masMueve` en `maestros_ayuda_ui.js` | Con otra cotización el ranking cambia: es una fotografía de *esa* cotización, no una propiedad de las tablas. |
| Origen de los datos | Reales: lista del proveedor, catálogo de compras y salario por día. De norma: calibres. Ilustrativos: el resto | `origen` y `origenTxt` de cada grupo | Al sustituir valores ilustrativos por reales, se actualiza la etiqueta del grupo. |
| Listas cerradas | Un dato que sólo admite ciertos valores se elige de una lista (precios con prefijo afín primero, luego «otros precios») | `OPCIONES_TEXTO` en `maestros_ui.js` | Un valor guardado que no está en la lista se muestra marcado «(no válido)» y el cálculo lo avisa, como antes. |
| Deshacer | Hasta 50 cambios, sólo en esta sesión de la pantalla (no sobrevive a recargar la página; lo guardado sí) | `historial` en `maestros_ui.js` | — |

### 10.12 Supuestos de la hoja de control de gastos por confirmar

Lo que dijo el taller (6 y 7 de octubre de 2026): el trabajador gana **$500 por día** ($3,500 a la semana ÷ 7) **sin utilidades ni prestaciones**, y la hora se cuesta como **$500 ÷ 8 h = $62.50**; la venta fue **con IVA** y los precios del proveedor **traían IVA**; las puntas de la solera **no se rolan** (por eso π·(D + 81 mm)); las 30 bridas de solera llevan **4 días** (sobre todo por el rolado y el barrenado); el empaque se sustituyó por **Sikaflex** y las bridas **sí llevan esmalte**; las ménsulas llevan **2 días** y son de **máximo 650 mm**; las abrazaderas son para el ducto de mayor diámetro (**11″**); la instalación es **local, en Querétaro** (sin hospedaje ni comidas), y las bridas chicas son **30 bridas de placa** de 3/16″ (24 de 5″, 2 de 6″ y 4 de 7″) de la cotización del proveedor de corte. Lo demás se **supuso** al reproducir la hoja (§7.4) y se cambia en las tablas o en las partidas:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| La hora, sin días de descanso ni prestaciones | FSR = 1.00: $62.50 la hora, como la calcula el taller | `mano_obra.FSR` | La semana paga 7 días por 5 trabajados: con FSR = 1.40 la hora es $87.50 (en este proyecto, $3,200 más de raya); con prestaciones, más (§7.4.1). |
| Reparto de los 4 días de las bridas | Rolado: 10 min por aro + 19 min por metro de solera; barrenado: 2 min por barreno. Dan 31.88 h para las 30 | `proceso.aros`, `proceso.barrenado` | El total ya es el del taller; el reparto mueve el precio de bridas de otro diámetro o con otro número de barrenos. |
| Barrenos de las bridas de placa | **Confirmado con los planos de pedido:** 6 en cada una (3 juegos por brida: 90) | `tornillos_pieza` de los artículos `BRIDA_PLACA_*` (T3c) | Con ellos la app da los 208 juegos exactos de la hoja y compra 220, como se compró. |
| Tornillos de las abrazaderas | Ninguno propio: los 208 juegos de la hoja son los de las bridas | `tornillos_pieza` de la partida | Si llevan 2 por abrazadera (sus orejas a la ménsula), son 14 juegos más: 222 exactos y se comprarían 240. |
| Largo de la ménsula | 1 300 mm de ángulo por ménsula (brazo y pierna de 650 mm): de dos ángulos salen las 7, como se compró | `largo_pieza_mm` de la partida | Si la ménsula es una sola pieza de 650 mm, las 7 salen de un ángulo. |
| Abrazadera | De media vuelta para el ducto de 11″, con dos orejas de 50 mm: 543.9 mm de solera 1¼″ × 1/8″ | `abrazadera_D_mm` de la partida y `proceso.soportes.oreja_abrazadera_mm` | Otra forma cambia el largo; las 7 salen de una solera mientras cada una mida hasta 857 mm. |
| Tiempo de las abrazaderas y el poste | El de la tabla (15 min por pieza: 2 h), aparte de los 2 días de las ménsulas | `min_pieza` de cada partida | Si se hicieron dentro de esos 2 días, repartir las 16 h entre ménsulas y abrazaderas. |
| Cordón de Sikaflex de la junta | 40 mL por metro de círculo de barrenos (+15 % de merma): 1 084 mL para las 60 bridas, 2 cartuchos | `herrajes.uniones.BRIDADO.ml_sellador_junta_m` | Un cordón más grueso pide más cartuchos. |
| Esmalte de las bridas de placa | No se pintan (se compran cortadas); las de solera, sí | Una partida aparte | Si también se pintaron, sumar su esmalte. |
| Esmalte en los gastos | Estimado: 1 L de esmalte ($260) y 1 L de diluyente ($70) antes de IVA, lo que pide la lista de compras; la hoja no lo traía | El renglón del control de gastos | Capturar lo que de verdad se compró. |
| Viaje Querétaro–México | Casetas $806 y gasolina $1,500, como viático de la instalación | `viajes`, `casetas_viaje`, `gasolina_viaje` | Si fue para recoger el ducto o las bridas, es flete: el total no cambia, sólo su renglón. |
| Indirectos, equipo y financiamiento | Ilustrativos (GIF $85/h de taller, 8 % de administración, 4 % de imprevistos, equipo por hora): con ellos el proyecto pierde $17,023.24 | `capas.*`, `mano_obra.operaciones.*.equipo_h` | Con los indirectos reales del taller el resultado puede ser otro: es el dato que más mueve el «después de indirectos». |
| Peso del PTR 2″ × 2″ cal. 14 | 2.91 kg/m, calculado de la sección (el proveedor no lo da) | `proveedor.barras.PTR_2X2_C14.kg_m` | Sólo cambia el peso que se manda, no el costo. |
| Categorías del control de gastos | Los renglones se capturaron en la categoría que les corresponde (tornillería, soleras y Sikaflex: material; ángulos, PTR y taquetes: soportería; ducto, bridas de placa, mangueras y abrazaderas: compras a terceros; esmalte: consumibles) | `categoria` de cada gasto y de cada artículo de T3c | Sólo cambia en qué renglón se compara; el total no cambia. |


### 10.13 Diferencias con los planos de pedido por confirmar

Los planos de pedido del 30-sep-2026 confirmaron el gramil (24 mm), los barrenos (par, mínimo 6; 6 en las bridas de placa), el R = 1.5D de los codos, los largos de los injertos, las yardas de 914 mm y en qué extremos va brida; el plano de armado del 2-oct-2026, qué piezas se unen. Al capturarlos y dibujarlos con la app quedan estas diferencias y supuestos:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Diámetro interior de la brida | El exterior del ducto: Dint = D + 2e (281 mm en el de 11″ cal. 22) | Geometría (§3.5.1) | Los planos dan un Dint 3 a 6 mm mayor que el diámetro del ducto (284, 260, 234 y 182 mm en las de solera): cada aro saldría 9 a 16 mm más largo y el círculo de barrenos crecería igual; no cambia la compra de soleras. |
| Solera de las bridas de 9″ y 7″ | 1½″ × 3/16″ en todas, como dijo el taller y como se compró | Perfil de los aros (T4) y «Perfil de aros» en la partida | El plano pide 1¼″ en la de 9″ (y sus medidas son de 1¼″: Dext − Dint = 64 mm, barrenos a 18 mm); en la de 7″ dice 1¼″ pero sus medidas son de 1½″ (76 mm). Para usar 1¼″ × 3/16″ hay que darla de alta en T4 con su gramil. |
| Bridas de 7″ | De solera, como el plano | Las partidas | La cotización del proveedor de corte (§7.4) las trae de placa. |
| Calibre de la ductería | **Confirmado (7-oct-2026): cal. 22**, lo que se compró (los planos dicen cal. 24) | La partida | La tabla de calibres por servicio (ilustrativa) avisa que el cal. 22 es delgado para polvo en todos los diámetros del pedido (pide cal. 20 hasta 200 mm y cal. 18 hasta 400 mm): poblarla con el servicio real (polvo de madera). |
| Redondeo de las cotas | Al milímetro más cercano (R + D/2 del codo de 11″: 559 mm) | `src/web/planos.js` | Los planos truncan (558): 1 mm de diferencia en las cotas que suman medidas. |
| Qué es «unir» | **Confirmado (7-oct-2026):** las piezas se unen entre sí como las yardas y, al ser galvanizado, se engargolan; sin bridas en los extremos que se unen | Familia Armado de piezas (§3.6.4) y la costura del material (T1) | Con eso cuadran 11″, 10″, 9″ y 7″. |
| Engargolado de los accesorios | Las juntas entre gajos y la silleta de los injertos se engargolan como la junta entre yardas (su pliegue en la merma); las costuras longitudinales, con la holgura del Pittsburgh (32 mm) | `materiales.*.costura` (T1) y `proceso.costuras` (T7) | Si la silleta lleva otra unión (collarín con remaches, por ejemplo), cambian su tiempo y su lámina. |
| La ceja de las bridas | 10 mm de lámina por brida; 2 min + 3 min por metro de perímetro, aparte del ajuste del aro | `herrajes.uniones.BRIDADO.ceja_mm`, `proceso.armado.t_ceja_aro_min` y `t_ceja_aro_min_m` | Medirlo en una pieza: mueve las horas de armado del pedido (56 cejas). |
| Bridas de 6″ y 5″ | Las piezas piden 3 de 6″ y 21 de 5″; la hoja de bridas trae 2 y 24 | Las partidas, o los extremos sin brida | La de 6″ que falta «va en otra unión»: el taller mandará el diagrama. Sobran 3 de 5″ (reserva, o el codo de 60° de 5″ que falta en la hoja de codos). |
| Codo de 60° de 5″ | No se agregó: lo pide el armado de la reducción de 11″ a 10″ con injerto de 5″, pero no viene en la hoja de codos | Una partida de codo | Si se hizo, suma un codo y una brida de 5″ (sobrarían 2). |
| «Una yarda de 3″» del armado del codo de 6″ | Es la yarda de 6″ (no hay ducto de 3″ en las hojas de yardas); el injerto de 3″ va a una manguera, sin brida | La partida del injerto y la yarda | Si hay un tramo de 3″, falta en las yardas y lleva una brida de 3″ que no viene en la hoja de bridas. |
| Ajuste de las yardas con «brida en un extremo» | Los de 2 yardas + 600 y + 500 mm llevan brida de taller en las yardas y la suelta en el ajuste (lo de las tablas); los de 914 + 700 mm, sin brida en el extremo de 700 (se unen a un codo o a una manguera) | El extremo final de cada partida | Con la suelta de los dos ajustes cuadra la hoja de 11″; si no se mandan sueltas, sobra 1 de 11″ y 1 más de 5″. |
| Cómo y quién fija las bridas al ducto | **Confirmado (7-oct-2026): no se sueldan;** se meten y se le hace una ceja al ducto (§3.5.9). Se supone que la ceja la hizo quien hizo la ductería | `materiales.*.brida_al_ducto` (T1) | Si las puso el taller en obra, la ductería del proveedor vale la fila «sin meter las bridas» de §7.5. |
| El pedido de $22,000 | **Confirmado (7-oct-2026):** es toda esta ductería, en cal. 22 | §7.5 | — |

### 10.14 Supuestos de la cotización rápida por confirmar

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| El costo de la lámina que se multiplica por 3 | El precio de la hoja **sin IVA** (el IVA se suma al final) | §5.8 | Con el precio con IVA, el total sube 16 % en la parte de la lámina (y el IVA se cobraría dos veces). |
| Utilidad | 20 %, **sumada sobre el costo** (costo × 1.20); ilustrativa | T11 (`utilidad_pct`) o la pestaña | Si es un % del precio (como en la pila, §5.2), con 20 % el precio sería costo ÷ 0.80: 4 % más. |
| Importes de las bridas por metros | Antes de IVA | T11 (`bridas_por_metros`) | Si ya traen IVA, el total baja 16 % de ese importe. |
| Más de 120 m | Sin precio: la app pide agregar un renglón | T11 | — |
| La hoja y la yarda | Galvanizada cal. 22 de 4 × 10 ft; la yarda es su ancho (1.22 m), como en el tramo recto | T11 (`hoja_defecto`) o la pestaña | Con yardas de 3 ft (hoja de 3 × 10 ft) salen otras hojas: elegirla en la pestaña si está en la lista del proveedor. |
| Retazos | No se aprovechan entre láminas; en una lámina, el acomodo de guillotina mete las que quepan (incluso giradas) | §5.8 | Si el taller usa los retazos para codos o reducciones, cuenta menos hojas: el factor ya lo cubre. |
| Yarda de 3 ft en galvanizado | La lista del proveedor sólo trae la galvanizada de 4 × 10 ft: se corta la yarda de 3 ft de ella y se desperdicia una franja de 1 ft | Lista del proveedor (T3b): agregar la de 3 × 10 ft | Con la hoja de 3 × 10 ft (si se compra), la yarda de 3 ft la toma sola y salen menos hojas. |
| Días de fabricación e instalación | Sólo informan el plazo; no suman costo | §5.8 | Si la instalación debe cobrarse (cuadrilla × días), hay que agregarla: hoy no está en la regla. |
