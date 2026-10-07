# Arquitectura del Cotizador Maestro de Ducterías

**COTIZAP · Especificación lógica, matemática y estructural · v1.1**

> Documento de arquitectura para analistas de datos y programadores. Define **qué se calcula, con qué fórmulas y con qué datos**, sin depender de una plataforma. La implementación de referencia (JavaScript sin dependencias) vive en `src/`, sus pruebas en `tests/`, y **todas las cifras de los ejemplos de este documento son la salida literal del motor**.
>
> ⚠ **Sólo dos grupos de valores son reales: la mano de obra ($500 por hora, dato del taller) y la lámina y los perfiles de la lista del proveedor (cotizaciones y factura del 30-sep-2026). Todo lo demás —consumibles, equipo, tiempos, indirectos, utilidad— es ILUSTRATIVO** en este documento y en `src/datos/maestros.js`: existe para que el motor funcione y para servir de vector de prueba, y debe sustituirse por precios, tarifas y estudios de tiempos del taller antes de cotizar a un cliente (§10).

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
| Mano de obra por hora y lista de precios del proveedor | Los trabajadores ganan **$500 por hora, cifra que ya incluye prestaciones** (FSR = 1.00): el salario se captura por hora (antes por día y jornada) y el costo de la hora es `salario_hora · FSR`. El proveedor de acero cotiza **por pieza y con IVA incluido** (hojas y barras): la lista (T3b) conserva el precio como se cotiza y el motor lo convierte a **$/kg sin IVA** con los kg de la pieza (§5.1.1); lo que no está cotizado usa un precio por kg de respaldo. Cuatro supuestos de detalle están por confirmar (§10.6). | T3 · T3b · T8 · §4.1 · §5.1.1 · §10.6 |
| Brida estándar del taller | **Una sola brida para todos los diámetros: aro de solera 1½" × 3/16", barreno Ø3/8", tornillo 5/16" × 1¼".** Se modela como el perfil `SOL38x4.8` (tipo solera, rolada "de canto"), que lleva en sus propias columnas el barreno y el tornillo; los ángulos quedan como opción por partida (`perfil_id`). Cinco supuestos de detalle están por confirmar con el taller (§10.4). | T4 · T5 · §3.5 · §10.4 |
| Armado del tramo recto por yardas | El taller no rola tramos de 3 m: rola **yardas** —anillos del ancho de la lámina (914 mm = 3 ft ó 1 220 mm = 4 ft)—, las **engargola** hasta de 3 en una pieza con brida en ambos extremos, y lo que falta lo arma con las yardas completas que sobren y un **tramo de ajuste** (menos de una yarda) cuyo extremo libre **no lleva brida de taller**, para ponerlo en campo ajustando la distancia. **Quien diseña elige el ancho de la yarda** (3 ft ó 4 ft) en el encabezado de la cotización, o por partida. En ese extremo libre se cotiza, por omisión, la **brida suelta** —el taller manda el aro ya terminado (rolado, con el cierre soldado, barrenado y pintado), con sus tornillos y su empaque, sin soldarlo al ducto: se suelda en obra—; la partida puede pedir también «sin brida» (la brida no está en el precio) o «brida de taller». El motor reparte el largo así (§3.2): anillos que se rolan por separado, juntas engargoladas entre yardas, bridas sólo donde corresponde, corte con un tajo a lo ancho de la hoja. Los supuestos de detalle están por confirmar (§10.9). | T7c · §3.2 · §3.5.7 · §4.1 · §10.9 |
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
| **Gramil (g)** | Distancia radial entre la pared exterior del ducto y el centro del barreno. En la solera del taller el barreno va al centro del ancho: g = b/2 = 19.05 mm. |
| **Espiga** | Extremo macho que entra en el siguiente tramo (unión macho–hembra). |
| **Merma (φ)** | Fracción del material comprado que no queda en la pieza. |
| **QTO** | *Quantity take-off*: levantamiento de cantidades físicas, sin precios. |
| **CD / CI / GIF** | Costo directo / costo indirecto / gastos indirectos de fábrica. |
| **MOD / FSR** | Mano de obra directa / Factor de Salario Real (convierte el salario base en costo real; vale 1.00 porque los $500 por hora del taller ya incluyen las prestaciones). |
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
│ merma · k_dif · tarifas de mano de obra y equipo                                             │
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
| `familia` | enum | `RECTO` `CODO` `REDUCCION` `TRANSICION` `RAMAL` `REDUCCION_INJERTO` `PERSONALIZADO` `COMPRADO` | — | Define la función geométrica. `RAMAL` es el *injerto simple*. `PANTALON` (retirada) se acepta sólo para abrir cotizaciones anteriores. |
| `cantidad` | entero ≥ 1 | pzas | 1 | Los *setups* se cargan una vez por partida. |
| `material_id` | enum | `ACERO_CARBON` `GALVANIZADO` `INOX_304` `INOX_316` | — | Determina tabla de calibre, densidad, proceso de soldadura y consumibles. |
| `calibre` | entero | 10 – 28 | — | Se resuelve en la tabla del material. |
| `espesor_mm` | mm | > 0 | — | Opcional: sustituye al calibre (placa, espesores especiales). |
| `ref_diametro` | enum | `INTERIOR` `EXTERIOR` | `INTERIOR` | A qué superficie se refiere la dimensión nominal. |
| `tipo_union` | enum | `BRIDADO` `ESPIGA` `LISO` | `BRIDADO` | Define herrajes y mano de obra de unión. |
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
| `RECTO` | redondo: `D_mm` · rectangular: `a_mm`, `b_mm` · `L_mm`, `tipo_costura` (`A_TOPE` `TRASLAPE` `PITTSBURGH`), `yarda_mm` (914 ó 1 220; por omisión la de la cotización y, si no, la de T7c), `extremo_ajuste` (`SUELTA` `SIN_BRIDA` `CON_BRIDA`; por omisión el de T7c: `SUELTA`), `n_costuras_long` | Se arma por **yardas** (§3.2): piezas de hasta 3 yardas engargoladas y un tramo de ajuste cuyo extremo libre no lleva brida de taller (§3.5.7). |
| `CODO` | redondo: `D_mm`, `theta_deg` (**30, 45, 60 ó 90**; 90), `n_gajos` (auto), `k_R` (1.5), `L_tangente_mm` (0) · rectangular: `a_mm`, `b_mm`, `theta_deg`, `k_R` | `n_gajos` automático con α ≤ 22.5° por junta: 3, 3, 4 y 5 gajos para 30°, 45°, 60° y 90°. |
| `REDUCCION` | `D1_mm`, `D2_mm`, `L_mm` (auto con semiángulo 15°), `excentrica` (`NO` `CARA_PLANA`) | |
| `TRANSICION` | `D_mm` (extremo redondo), `a_mm`, `b_mm` (extremo rectangular), `H_mm` (auto) | Centrada. |
| `RAMAL` (injerto simple) | `D_mm` (tronco), `d_mm` (injerto), `L_cuerpo_mm`, `L_ramal_mm`, `beta_deg` (**30 ó 45**; 45) | `L_ramal` se mide sobre el eje del injerto desde el eje del tronco. |
| `REDUCCION_INJERTO` | `D1_mm`, `D2_mm` (< D1), `d_mm`, `beta_deg` (**30** ó **45**; 45), `L_reduccion_mm`, `L_ramal_mm` | El injerto va **sobre el cono** y siempre de extremo mayor a menor (inclinado hacia D2): es un dato de maestros (`proceso.injerto_inclinado_hacia`), no se captura por partida. Los dos largos son opcionales: vacíos → automáticos (§3.4.5). |
| `PERSONALIZADO` | `A_neta_m2`, `L_corte_m`, `L_sold_tope_m`, `L_sold_filete_m`, `n_piezas`, `n_extremos`, `D_ref_mm` | Para campanas y piezas con desarrollo CAD. |
| `COMPRADO` | `precio_compra_unitario`, `peso_kg` | Compuertas, flexibles, etc.: pasa por la pila sin mano de obra. |

**Entradas por cotización** (`cotizacion`): `cliente`, `proyecto`, `fecha`, `vigencia_dias`, unidades de captura de diámetros y longitudes, `servicio` y `riesgo` por omisión de las partidas (cada partida puede traer los suyos), la **instalación** (`ubicacion`: interior o exterior, que decide la pintura), el **ancho de la yarda** (`yarda_mm`) de los tramos rectos —lo elige quien diseña: 914 ó 1 220 mm; cada tramo puede traer el suyo— y los **parámetros de precio propios** de la cotización (`parametros`, §5.4): margen de utilidad, comisión, descuento, días de cobro, administración, financiamiento anual e IVA.

### 2.2 Tablas maestras

**T1 · Materiales**

| `material_id` | Tabla calibre | ρ (kg/m³) | Variable de precio | Soldadura | Aporte | Gas | f_sold | f_acabado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ACERO_CARBON` | MSG | 7,850 | `precio_kg_acero_carbon` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.00 | 0.25 |
| `GALVANIZADO` | GSG | 7,850 | `precio_kg_acero_galvanizado` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.20 | 0.35 |
| `INOX_304` | USSG | 7,930 | `precio_kg_inox_304` | GTAW | `precio_kg_varilla_er308l` | `precio_m3_gas_argon` | 1.00 | 0.60 |
| `INOX_316` | USSG | 7,980 | `precio_kg_inox_316` | GTAW | `precio_kg_varilla_er316l` | `precio_m3_gas_argon` | 1.00 | 0.60 |

`f_sold` = multiplicador de mano de obra de soldadura por material (p. ej. retiro de zinc en galvanizado). `f_acabado` = fracción del tiempo de soldadura que se dedica a esmerilado, limpieza o decapado.

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
| `precio_cartucho_sellador_300ml` | MXN/cartucho 300 mL | 120.00 | Ilustrativo |
| `precio_pza_autotaladrante` | MXN/pza | 0.85 | Ilustrativo |
| `precio_juego_tornillo_5_16_x_1_1_4` | MXN/juego (tornillo+tuerca+2 rondanas) | 4.50 | Ilustrativo |
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
| `PLACA_3_16_3X8` | Placa lisa 3 × 8 ft · 3/16" (precio como viene en la factura) | 914 × 2438 | 2,820.00 | 2,431.03 | 83.31 | 29.18 | Referencia |

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

**T4 · Perfiles de aros de brida.** La primera fila es el **estándar del taller** y se usa en todos los diámetros; las demás (ángulos) son opcionales por partida con `perfil_id`. El área, el peso lineal y el centroide se **derivan** de (tipo, ancho, espesor) y no se capturan; el gramil, el barreno, el tornillo y la variable de precio son datos del perfil. Fórmulas en §3.5.1.

| `perfil_id` | Descripción | Tipo | Ancho b (mm) | Espesor t (mm) | Área (mm²) | Peso (kg/m) | c centroide (mm) | Gramil g (mm) | Barreno | Tornillo | Barra cotizada (T3b) | Precio por kg de respaldo | Uso |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SOL38x4.8` | Solera 1½" × 3/16" | Solera | 38.10 | 4.763 | 181.5 | 1.4245 | 19.05 | 19.05 | Ø3/8" = 9.525 mm | 5/16" × 1¼" | `SOL_1_1_2X3_16` | `precio_kg_solera` | **Estándar del taller**: todos los diámetros |
| `L25x3.2` | Ángulo 1" × 1" × 1/8" | Ángulo | 25.40 | 3.175 | 151.2 | 1.1870 | 7.51 | 14.00 | Ø9.000 mm | M8 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x3.2` | Ángulo 1½" × 1½" × 1/8" | Ángulo | 38.10 | 3.175 | 231.9 | 1.8201 | 10.70 | 22.00 | Ø11.000 mm | M10 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x4.8` | Ángulo 1½" × 1½" × 3/16" | Ángulo | 38.10 | 4.763 | 340.3 | 2.6710 | 11.27 | 22.00 | Ø11.000 mm | M10 | `ANG_1_1_2X3_16` | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L51x4.8` | Ángulo 2" × 2" × 3/16" | Ángulo | 50.80 | 4.763 | 461.2 | 3.6207 | 14.46 | 29.00 | Ø11.000 mm | M10 | `ANG_2X3_16` | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L64x6.4` | Ángulo 2½" × 2½" × 1/4" | Ángulo | 63.50 | 6.350 | 766.1 | 6.0141 | 18.21 | 35.00 | Ø14.000 mm | M12 | — | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |

**T5 · Uniones**

| Parámetro | `BRIDADO` | `ESPIGA` | `LISO` |
| --- | --- | --- | --- |
| Elemento principal | aro de solera 1½" × 3/16" por extremo (estándar del taller) | prolongación macho `prof_espiga_mm` = 60 | — |
| Fijación | barreno Ø3/8" + tornillo 5/16" × 1¼" + tuerca + 2 rondanas; paso máx. 150 mm; mín. 4; múltiplo de 4 | autotaladrante; paso máx. 150 mm; mín. 4 | — |
| Reserva de herraje | 5 % | 5 % | — |
| Empaque | sí: cinta de neopreno 1½" × 1/8" sobre el círculo de barrenos (traslape 5 %) | no | no |
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

**T7b · Tiempos fijos y unitarios** (minutos estándar; ilustrativos)

| Operación | Parámetros |
| --- | --- |
| Corte | `t_manejo_hoja` 4.0 por hoja-equivalente · `t_prog_cnc` 6.0 por **partida** (sólo plasma/láser) |
| Rolado | `t_fijo` 3.0 por virola · 3 pasadas (4 en plegado rectangular) · `k_rolado` 1.6 para conos |
| Armado | `t_fijo_pieza` 6.0 · `t_junta` = 3.0 + 6.0·D_ref[m] · `t_ajuste_aro` 4.0 · `t_fijación` 0.4 · `t_formado_espiga` 3.0 |
| Aros de brida | `t_fijo_aro` 4.0 · `t_roll_aro` 2.5 por metro de barra · holgura de corte 3 mm |
| Barrenado | 0.35 por barreno |
| Engargolado | `t_fijo_pieza` 2.0 · velocidad 3.0 / 2.5 / 1.8 / 1.2 m/min a 0.5 / 1.0 / 1.5 / 2.0 mm |
| Pintura | `t_prep` 4.0 min/m² · `t_aplicación` 3.0 min/m² por mano |
| Inspección y embalaje | `t_fijo_qc` 3.0 · `k_manejo` 0.05 min/kg |

**Otros parámetros de proceso:** `eficiencia_taller` η = 0.80 · hoja estándar 1 219 × 3 048 mm · semiángulo máx. de reducciones 15° · α máx. por junta de codo 22.5° · holguras de costura (mm): `A_TOPE` 1.0, `TRASLAPE` 25, `PITTSBURGH` 32 · soldadura GMAW (`FO` 0.40, 15 L/min, η_dep 0.93, pre/post-flujo 10 %) y GTAW (velocidad ×0.5, `FO` 0.35, 9 L/min, η_dep 0.98, pre/post-flujo 15 %) · `k_cordón` tope 1.75 y filete 1.00, `A_cordón_min` 2.0 mm² · pintura: primario SV 55 %, DFT 50 µm, η_transf. 0.65; esmalte SV 45 %, DFT 40 µm, η_transf. 0.65; diluyente 10 %.

**T7c · Armado del tramo recto por yardas** (`proceso.armado_yardas`; reglas en §3.2)

| Parámetro (`proceso.armado_yardas.*`) | Valor | Qué es |
| --- | --- | --- |
| `yardas_mm` | 914 · 1,220 | anchos de lámina (yarda) entre los que se elige al cotizar (encabezado de la cotización) o al capturar la partida: 3 ft y 4 ft |
| `yarda_defecto_mm` | 1,220 | la que se usa si ni la cotización ni la partida eligen |
| `yardas_por_pieza_max` | 3 | yardas engargoladas en una pieza con bridas en ambos extremos (el tramo de ajuste cuenta como una) |
| `ajuste_tolerancia_mm` | 25 | un sobrante menor que esto no es tramo de ajuste: a ±25 mm de un múltiplo de la yarda se cuentan yardas completas |
| `junta_entre_yardas` | `PITTSBURGH` | cómo se unen las yardas de una pieza: clave de `proceso.costuras` (engargolado Pittsburgh) |
| `extremo_ajuste_defecto` | `SUELTA` | qué lleva el extremo libre del tramo de ajuste cuando la partida no pide otra cosa: `SUELTA` (aro, tornillos y empaque sueltos), `SIN_BRIDA` (nada) o `CON_BRIDA` (brida de taller) |

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

**T8 · Tarifas de operación** (`mo_h = salario_hora · FSR`: los trabajadores ganan **$500 por hora**, cifra que **ya incluye prestaciones**, así que FSR = 1.00 y la hora de mano de obra cuesta **$500**, más el equipo de la operación)

| Operación | Salario por hora (MXN) | `mo_h` = salario · FSR (MXN/h) | Equipo (MXN/h) | Tarifa total (MXN/h) |
| --- | --- | --- | --- | --- |
| `corte` | 500 | 500.00 | 45 | 545.00 |
| `rolado` | 500 | 500.00 | 55 | 555.00 |
| `armado` | 500 | 500.00 | 25 | 525.00 |
| `aros` | 500 | 500.00 | 40 | 540.00 |
| `soldadura` | 500 | 500.00 | 45 | 545.00 |
| `engargolado` | 500 | 500.00 | 35 | 535.00 |
| `barrenado` | 500 | 500.00 | 25 | 525.00 |
| `acabado` | 500 | 500.00 | 20 | 520.00 |
| `pintura` | 500 | 500.00 | 40 | 540.00 |
| `qc_embalaje` | 500 | 500.00 | 0 | 500.00 |

**T9 · Capas de precio** (valores ilustrativos; ver §5)

| Parámetro | Valor | Parámetro | Valor |
| --- | --- | --- | --- |
| `herramienta_menor_pct_mo` | 3 % | `administracion_pct_cd` | 8 % |
| `flete_material_pct` | 2 % | `imprevistos_pct` BAJO / MEDIO / ALTO | 2 % / 4 % / 8 % |
| `recuperacion_chatarra_pct` | 0 % | `financiamiento` | 14 % anual, 45 días |
| `gif_por_hora_mod` | 85.00 MXN/h | `utilidad_pct_precio` | 20 % |
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

#### 2.2.1 Ayuda integrada en el editor de tablas maestras

Las tablas maestras son el lugar donde el taller mete sus números, y un número sin explicación se llena mal. Por eso **cada dato, sección, tabla y grupo del editor trae un botón ⓘ** que abre una ventana emergente (con el cursor en un campo, `F1` hace lo mismo; `Esc` la cierra). Los textos viven en un catálogo propio, `src/datos/ayuda_maestros.js` —no en la interfaz—, y no contienen cifras de cálculo: sólo explicaciones, rangos usuales de referencia y ejemplos.

El catálogo tiene **213 entradas** (cada una con un patrón de ruta, donde `*` cubre una clave) que explican los **449 elementos** que dibuja el editor: 10 grupos, 76 secciones, 351 datos y 12 tablas.

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
> **Con su cotización** (Ejemplo A, $3,645.10 antes de IVA): si baja 10 % (18 %): ▼ −$91.13 · −2.50 % · si sube 10 % (22 %): ▲ +$95.92 · +2.63 %.

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
| V5 | Injerto simple: β en la lista de maestros (`proceso.angulos_injerto_deg` = 30°, 45°); `d < D`; `L_ramal > t_max`; tramo de tronco suficiente para el orificio | Error / advertencia |
| V6 | Reducción con injerto: β en la misma lista; `D2 < D1`; `d` menor que el diámetro del cono en su punto medio; `proceso.injerto_inclinado_hacia` ∈ {`MAYOR`, `MENOR`}; la silleta cabe en el cono con la holgura de maestros (si se captura el largo); `L_ramal > t_max`; semiángulo del cono ≤ 15° | Error / advertencia |
| V7 | Codo: θ en la lista de maestros (`proceso.angulos_codo_deg` = 30°, 45°, 60°, 90°); `n_gajos ≥ 2`; `R/D ≥ 1.0` | Error |
| V8 | Merma en [0, 1) | Error |
| V9 | `utilidad + comisión + otros < 100 %` del precio | Error |
| V10 | Toda variable `precio_*` referenciada existe en la tabla de precios | Error |
| V11 | Lista del proveedor: un renglón con precio ≤ 0 o sin medidas válidas no se usa (el cálculo cae al precio por kg de T3) | Silencioso; el renglón se ve como sin $/kg |
| V12 | `salario_hora ≥ 0` en cada operación | Error (con el nombre de la operación) |
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
  - `SUELTA` — el taller manda **suelto** el aro de esa brida **ya terminado** —se rola la solera, se suelda el cierre del aro, se barrena y se pinta— con sus tornillos y su empaque, **sin soldarlo al ducto**: se suelda en obra donde se corta el tramo (§3.5.7). Se cobra el material y esas operaciones; no se cobra el armado del aro al ducto, el filete aro–ducto ni el sellador de su junta.
  - `SIN_BRIDA` — **nada**: la brida y su junta no están en el precio de la partida.
  - `CON_BRIDA` — brida de taller en ambos extremos, como en cualquier otra pieza: se fabrica y se suelda (no queda un extremo libre para ajustar en campo).

  Lo que cambia en el Ejemplo A (3 000 mm; el costo directo CD y el precio salen del motor), con yardas de 4 ft y de 3 ft:

| Yarda (mm) | `extremo_ajuste` | Qué cotiza el extremo libre | Armado | Bridas de taller | Aros sueltos | CD (MXN) | Precio antes de IVA (MXN) | Más que «sin brida» |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,220 | `SIN_BRIDA` | Nada: la brida de ese extremo no está en el precio | 2 yardas + ajuste de 560 mm | 1 | 0 | 2,119.08 | 3,320.71 | — |
| 1,220 | `SUELTA` | El aro terminado (rolado, cierre soldado, barrenado y pintado), los tornillos y el empaque; no se suelda al ducto | 2 yardas + ajuste de 560 mm | 1 | 1 | 2,322.96 | 3,645.10 | +324.39 |
| 1,220 | `CON_BRIDA` | Brida fabricada y soldada en taller, como en los demás extremos | 2 yardas + ajuste de 560 mm | 2 | 0 | 2,448.54 | 3,853.28 | +532.57 |
| 914 | `SIN_BRIDA` | Nada: la brida de ese extremo no está en el precio | 3 yardas y ajuste de 258 mm | 3 | 0 | 2,894.33 | 4,580.58 | — |
| 914 | `SUELTA` | El aro terminado (rolado, cierre soldado, barrenado y pintado), los tornillos y el empaque; no se suelda al ducto | 3 yardas y ajuste de 258 mm | 3 | 1 | 3,098.21 | 4,904.98 | +324.40 |
| 914 | `CON_BRIDA` | Brida fabricada y soldada en taller, como en los demás extremos | 3 yardas y ajuste de 258 mm | 4 | 0 | 3,223.79 | 5,113.16 | +532.58 |

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
k      = d_med / D_med   (< 1)
t_med  = (D_med / (2·sinβ)) · (2/π)·E(k)          # distancia media, sobre el eje del injerto, del eje del tronco a la silleta
       ≈ (D_med / (2·sinβ)) · (1 − k²/4 − 3k⁴/64) # error < 0.04 % si k ≤ 0.5 ; < 0.7 % si k ≤ 0.75
t_max  = (D_med/2 + (d_med/2)·cosβ) / sinβ        # el injerto debe medir más que t_max
A_ramal    = π·d_med·(L_ramal − t_med)
A_orificio = (π·(d_med/2)² / sinβ) · K(k) ,   K(k) = 1 + k²/8 + 3k⁴/64 + …    # 1.02 – 1.09 para k = 0.4 – 0.75
A_neta     = π·D_med·L_cuerpo − A_orificio + A_ramal
```

`E(k)` es la integral elíptica completa de 2.ª especie: `(2/π)·E(k)` = promedio angular de `√(1 − k²·sin²φ)`. La caída del orificio es chatarra y la cubre la merma de la familia (25 %): `A_neta` ya la descuenta (así el peso neto es el de la pieza terminada) y `m_bruta = m_neta/(1 − φ)` la repone como merma.

Verificación independiente: `t_med` contra el promedio por fuerza bruta de la distancia de silleta, y `A_orificio` contra una malla fina sobre la pared del tronco (30°, 45°, 60° y 90°; diferencia < 0.005 %).

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

### 3.5 Herrajes de unión: bridas, tornillería, empaque, sellador y espiga

#### 3.5.1 Aros de brida (solera de 1½" × 3/16" rolada "de canto")

El aro se forma rolando la solera de canto: el ancho `b` queda en el plano radial (el aro "se para" sobre el ducto) y el espesor `t` en el eje.

```text
SOLERA (estándar del taller)   b = 38.1 mm (ancho) ,  t = 4.763 mm (espesor)
c     = b / 2                                               # centroide radial, mm  (19.05)
A_p   = b · t                                               # área de la sección, mm²  (181.5)
w_p   = b · t · 7.85 / 1000                                 # peso lineal, kg/m  (1.4245)
L_aro = π·(D_ext + 2c) + holgura_corte                      # longitud de barra por aro, mm (fibra neutra ≈ centroide)
m_aros_neta  = Σ_aros (L_aro/1000)·w_p
m_aros_bruta = m_aros_neta / (1 − φ_perfil)                 # φ_perfil = 5 % (retazos de barra de 6 m)

Marco rectangular:  L_marco = 2·(a_ext + b_ext) + 8c + 4·holgura_corte

Perfil de ángulo (opcional, `tipo = ANGULO`; rola el ala de ancho b):
  c   = (b·t + b² − t²) / ( 2·(2b − t) )                    # centroide medido desde el dorso del ángulo
  w_p = t·(2b − t)·7.85 / 1000
```

Despreciar `c` acortaría cada aro ≈ 11 % (≈ 120 mm en un Ø12"): el aro no cerraría sobre el ducto.

#### 3.5.2 Barrenos y tornillería

El barreno (Ø3/8" = 9.525 mm, holgura diametral de 1/16" sobre el tornillo de 5/16") y el tornillo (5/16" × 1¼") son datos del perfil (T4). El barreno va al **centro del ancho** de la solera, de modo que el círculo de barrenos coincide con la fibra neutra del aro.

```text
D_bc        = D_ext + 2·g                                   # círculo de barrenos; g = gramil del perfil (T4) = b/2
n_tornillos = múltiplo_de_4_hacia_arriba( máx( n_mín , ⌈ π·D_bc / paso_máx ⌉ ) )     # por junta = barrenos por brida
n_juntas_asignadas = 0.5 · (n_extremos_bridados + n_aros_sueltos)   # cada junta se comparte entre dos piezas
juegos      = Σ_extremos 0.5·n_tornillos · (1 + f_reserva)  # juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas; extremos de taller y sueltos
n_barrenos  = Σ_aros n_tornillos                            # cada aro lleva sus barrenos: el de taller y el suelto (§3.5.7)
Marco rectangular:  P_perno = 2·(a_ext + b_ext) + 8·g
```

Los juegos se agrupan por tipo de tornillo del perfil y cada tipo se valoriza con su propia variable (`precio_juego_tornillo_5_16_x_1_1_4` para el estándar del taller).

#### 3.5.3 Soldadura de aros

```text
L_filete_aro = Σ_extremos_de_taller f_cont · P_ext  # aro–ducto, al espesor de la LÁMINA ; P_ext = π·D_ext ; f_cont = 1.0 (continuo, hermético); no los aros sueltos (§3.5.7)
L_cierre_aro = Σ_aros b                             # costura a tope que cierra el aro: una sección de ancho b (rect.: 4 esquinas × b ; ángulo: 2b por cierre); todos los aros, también los sueltos
A_cordón_cierre = máx( A_mín , k_tope · t² )        # con el espesor t de la SOLERA, no el de la lámina (4.763 mm → 39.7 mm²)
```

El cierre del aro se suelda en un espesor mayor que el de la lámina, así que su cordón es más grande y su velocidad de avance menor (§4.1 y §4.3).

#### 3.5.4 Empaque

```text
L_empaque = Σ_extremos 0.5 · P_perno · (1 + f_traslape)          # m, una sola cinta por junta, sobre el círculo de barrenos (extremos de taller y sueltos)
```

Se asume cinta de neopreno de 1½" × 1/8" (el ancho de la solera) y traslape de 5 % en el empalme (§10.4).

#### 3.5.5 Sellador por clase (SMACNA)

```text
Clase C : juntas transversales                      L = Σ_extremos_de_taller 0.5·P_ext  (bridado)  |  Σ_espigas P_ext
                                                        + L_juntas engargoladas entre yardas
Clase B : C + costuras longitudinales NO soldadas   L = C + L_engargolado_longitudinal
Clase A : B + penetraciones                         L = B + L_penetraciones
V_sellador = L · ml_por_m · (1 + f_merma)           # ml_por_m = 20 mL/m (cordón ≈ 5 mm) ; f_merma = 15 %
Costo      = V_sellador · precio_cartucho / mL_cartucho
```

Las costuras **soldadas** son herméticas y no consumen sellador.

#### 3.5.6 Espiga (macho–hembra)

```text
A_espiga      = Σ_extremos_macho P_med_ext · prof_espiga / 10⁶       # lámina extra del macho (se suma a A_neta)
L_corte_extra = 2·prof_espiga / 1000                                  # por macho
n_fijaciones  = máx( n_mín , ⌈ P_ext / paso_fijación ⌉ )              # por junta (autotaladrante o remache)
n_juntas      = nº de machos                                          # sellador clase C: 1 cordón por junta
```

Tramo recto: 1 macho por pieza. Accesorios: un macho por extremo (configurable con `n_espigas`).

#### 3.5.7 Brida suelta (extremo libre del tramo de ajuste)

Cuando el extremo del ajuste se cotiza como `SUELTA` (§3.2), el taller fabrica el aro **completo**, pero **no lo une al ducto**: ese extremo se corta y se ajusta en campo, así que el aro sale suelto —con sus tornillos y su empaque— y se suelda en obra. El motor lo trata como un aro de brida al que se le hace todo menos unirlo:

```text
extremos_sueltos      = PF.extremos_sueltos                  # un extremo por tramo de ajuste con brida suelta (sólo unión BRIDADO)
aro suelto            = el aro de §3.5.1, del mismo perfil y diámetro:  L_aro , m_aro , m_aro_bruta = m_aro / (1 − φ_perfil)

Material (como cualquier brida):
  costo del perfil     += m_aro_bruta · precio_kg_perfil      # y el flete de entrada (2 %) también cubre el perfil del aro suelto
  juegos de tornillería += 0.5 · n_tornillos · (1 + f_reserva)  # media junta (§3.5.2)
  L_empaque            += 0.5 · P_perno · (1 + f_traslape)      # medio empaque (§3.5.4)

Se le hace en taller (igual que a un aro de taller):
  Aros          t += t_fijo_aro + t_roll_aro · L_aro / 1000    # se rola la solera
  Barrenado     n_barrenos += n_tornillos                       # se barrena
  Soldadura     L_cierre += b ; el cordón es el del espesor de la solera   # se suelda el cierre del aro (§3.5.3)
  Pintura       A_pint += A_pintura_aro                         # se pinta (si la partida lleva pintura)
  Inspección    m_neta_total += m_aro                           # se inspecciona y se embala

NO se le hace (se hace en obra):
  Armado        no suma t_ajuste_aro                            # no se arma al ducto: n_aros cuenta sólo los aros de taller
  Soldadura     no suma el filete aro–ducto                     # no se suelda al ducto
  Sellador      no suma media junta                             # la junta se sella en obra
```

El acabado (`f_acabado · t_soldadura`) y los consumibles de soldadura y de pintura siguen a esos metros y esa superficie. El peso que se manda incluye el aro (`peso.aros_sueltos_neto_kg`) y los drivers de subcontrato por kilogramo (`KG_NETO`, `KG_BRUTO`) y por metro de soldadura (`M_SOLDADURA`) lo cuentan, porque es acero fabricado que va en la partida. Con unión `ESPIGA` o `LISO` no hay aros: `SUELTA` y `SIN_BRIDA` cuestan lo mismo.

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
Costo(op)    = (t_real / 60) · ( mo_h(op) + equipo_h(op) )        mo_h = salario_hora · FSR
```

`FSR` (Factor de Salario Real) convierte un salario base en costo real (prestaciones, aguinaldo, vacaciones, cargas sociales). Los trabajadores ganan **$500 por hora y esa cifra ya incluye las prestaciones**, por eso FSR = 1.00 y la hora cuesta **$500**. El factor se conserva por si el salario se captura algún día sin prestaciones (con FSR = 1.55 la hora costaría $775).

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

`P_h = π·d_med·√((1 + csc²β)/2)` es el perímetro del orificio elíptico del injerto (la silleta).

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
| `ACERO_CARBON` | Interior | sólo pintura | sólo pintura | 3.078 | 0.463 | 112.40 | 26.9 | 3,666.59 |
| `ACERO_CARBON` | Exterior | primario + pintura | primario + pintura | 3.078 | 0.937 | 210.14 | 38.5 | 3,988.36 |
| `GALVANIZADO` | Interior | sin pintura | sólo pintura | 0.177 | 0.027 | 6.47 | 1.6 | 3,858.98 |
| `GALVANIZADO` | Exterior | sin pintura | primario + pintura | 0.177 | 0.054 | 12.10 | 2.2 | 3,877.50 |
| `INOX_304` | Interior | sin pintura | sin pintura | 0.000 | 0.000 | 0.00 | 0.0 | 8,709.42 |
| `INOX_304` | Exterior | sin pintura | sin pintura | 0.000 | 0.000 | 0.00 | 0.0 | 8,709.42 |

### 4.4 Costos de operación y subcontratos

Una operación puede ejecutarse en el taller (tarifas de T8) o **subcontratarse**. Se modela con dos entradas de la partida:

| Entrada | Efecto |
| --- | --- |
| `omitir_operaciones` = lista de operaciones (`corte`, `rolado`, `armado`, `aros`, `soldadura`, `engargolado`, `barrenado`, `acabado`, `pintura`, `qc_embalaje`) | Se anulan sus horas, mano de obra, equipo y consumibles (corte → consumibles de corte; soldadura → alambre y gas; pintura → pintura y diluyente). |
| `subcontratos` = lista de `{concepto, driver, precio}` | Suma `cantidad · driver · precio` al costo directo, sin horas de MOD. Drivers: `PIEZA`, `KG_NETO`, `KG_BRUTO`, `M2_NETO`, `M_CORTE`, `M_SOLDADURA`. |

Ejemplos: pintura electrostática maquilada (`omitir: pintura`, driver `M2_NETO`), galvanizado en caliente post-fabricación (`KG_NETO`), corte láser maquilado (`omitir: corte`, driver `M_CORTE`).

---

## 5. Módulo 4 — Estructura de precios

### 5.1 Costo directo

```text
CD = Materiales + Consumibles + Mano de obra + Equipo + Herramienta menor + Subcontratos

Materiales  = m_bruta·precio_kg(material, calibre) − crédito_chatarra + Σ_aros m_aro_bruta·precio_kg(perfil)     # §5.1.1: lista del proveedor o, si no hay, precio_kg_<material> / precio_kg_<perfil>
              + Σ_tipos juegos·precio_juego_<tornillo> + L_empaque·precio_m_empaque + V_sellador·precio_mL_sellador
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

---

## 6. Pseudocódigo maestro

```text
FUNCIÓN cotizar(cotización, M):                          # M = snapshot de maestros (versión congelada)
    Mq ← maestros_efectivos(cotización.parametros, M)    # capas de T9 con los parámetros de la cotización encima (§5.4); no muta M
    problemas ← problemas_maestros(Mq)                   # tablas sanas (V18): una sola vez para todas las partidas
    PARA CADA partida p EN cotización.partidas:
        resultado[p] ← cotizar_partida(p, Mq)            # un error —de datos o inesperado— en una partida no tumba las demás
    subtotal ← Σ resultado.importe ;  descuento ← subtotal · Mq.descuento ;  neto ← subtotal − descuento
    IVA ← neto · Mq.iva ;  total ← neto + IVA

FUNCIÓN cotizar_partida(p, M):
    exigir_maestros_sanos(M)                             # V18: un divisor en cero daría NaN o un precio infinito
    p ← normalizar_y_validar(p, M)                       # tipo, rango y pertenencia (V14–V16) y política del taller · errores bloquean · advertencias se reportan
    mat ← M.materiales[p.material_id]
    e   ← M.calibres[mat.tabla_calibre][p.calibre] · 25.4          # o p.espesor_mm (placa)

    # ── QTO: sólo cantidades físicas, ningún precio ─────────────────────────────────────
    PF  ← GEOMETRÍA[p.familia](p, e, M)                  # A_neta, L_corte, L_sold, n_piezas, extremos…
    her ← herrajes(PF, p, M)                             # aros, tornillos, empaque, sellador, espigas
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
| `extremo_ajuste` | **SUELTA** (por omisión de T7c): el extremo del tramo de ajuste no lleva brida de taller —se corta en campo—, así que la pieza lleva **una** brida fabricada; del otro extremo el taller manda **suelto** el aro **terminado** (rolado, con el cierre soldado, barrenado y pintado) con sus tornillos y su empaque, sin soldarlo al ducto |
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
L_aro                = π·(D_ext + 2c) + 3.0 = π·(307.8378 + 38.100) + 3.0 = 1089.80 mm
m_aros_neta          = 1 · 1.0898 m · 1.4245 kg/m = 1.552 kg
m_aros_bruta         = m_aros_neta / (1 − 0.05) = 1.634 kg
m_sueltos_neta       = 1 · 1.0898 m · 1.4245 kg/m = 1.552 kg   (el mismo aro: se rola, se barrena y se pinta como el de taller, pero no se une al ducto)
m_sueltos_bruta      = m_sueltos_neta / (1 − 0.05) = 1.634 kg
Precio del perfil    = barra `SOL_1_1_2X3_16`: 250.00 con IVA → 25.215 MXN/kg sin IVA   (§5.1.1)
Costo de perfil      = (1.634 + 1.634) · 25.215 = 82.41 MXN
```

**Paso 7 · Barrenos, tornillería, empaque y sellador** (barreno Ø3/8" = 9.525 mm · tornillo 5/16" × 1¼")

```text
D_bc (círculo de barrenos) = D_ext + 2g = 307.8378 + 2·19.05 = 345.938 mm  →  π·D_bc = 1086.80 mm   (barreno al centro de la solera: g = b/2)
n_barrenos por brida       = ⌈1086.80 / 150⌉ = 8  →  múltiplo de 4 ≥ máx(4, 8) = 8
n_juntas_asignadas         = (1 + 1) extremos · 0.5 = 1.0   (cada junta se reparte entre las dos bridas que la forman —de taller o suelta—; la otra mitad es de la brida del tramo vecino)
Juegos de tornillería      = 8 · 1.05 (reserva) = 8.4  →  · 4.50 = 37.80 MXN   (juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas)
n_barrenos (total)         = (1 + 1) aros · 8 = 16   (también se barrena el aro suelto)
L_empaque                  = 1.0 junta · 1086.80 mm · 1.05 / 1000 = 1.1411 m  →  · 28.00 = 31.95 MXN
L_sellado (clase C)        = 0.5 junta · π·D_ext / 1000 + 2 juntas engargoladas · π·D_med / 1000 = 0.4836 + 1.9247 = 2.4082 m   (la junta del aro suelto se sella en obra)
V_sellador                 = 2.4082 m · 20 mL/m · 1.15 = 55.39 mL  →  · (120.00 / 300) = 22.16 MXN
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
| Aros de brida | (1 + 1) · (4.0 + 2.5 min/m · 1.0898 m)   (se rolan el de taller y el suelto) | 13.45 |
| Soldadura | t_arco = (3.967 m / 0.497 m/min) + (0.0762 m / 0.240 m/min en 4.763 mm) = 7.98 + 0.32 = 8.30 min;  ÷ FO (0.4) | 20.75 |
| Engargolado | 2 juntas · 2.0 min + 1.9247 m / 1.777 m/min | 5.08 |
| Barrenado | 16 barrenos Ø3/8" · 0.35 min   (los dos aros) | 5.60 |
| Acabado | 0.25 · t_soldadura | 5.19 |
| Pintura | 3.0784 m² · (4.0 preparación + 1 mano · 3.0) | 21.55 |
| Inspección y embalaje | 3.0 + 0.05 min/kg · 37.564 kg | 4.88 |
| **Total estándar** |  | **100.88** |

`t_real = t_estándar / η = 100.88 / 0.8 = 126.10 min = 2.1017 h`

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
| Corte | 4.85 | 500.00 | 45 | 44.01 |
| Rolado | 13.14 | 500.00 | 55 | 121.52 |
| Armado y punteo | 12.50 | 500.00 | 25 | 109.38 |
| Aros de brida | 16.81 | 500.00 | 40 | 151.30 |
| Soldadura | 25.94 | 500.00 | 45 | 235.60 |
| Engargolado | 6.35 | 500.00 | 35 | 56.65 |
| Barrenado | 7.00 | 500.00 | 25 | 61.25 |
| Acabado | 6.48 | 500.00 | 20 | 56.20 |
| Pintura | 26.94 | 500.00 | 40 | 242.43 |
| Inspección y embalaje | 6.10 | 500.00 | 0 | 50.81 |

| Concepto | MXN |
| --- | --- |
| Lámina (37.455 kg brutos) | 841.62 |
| Perfil de aros (de taller y suelto) | 82.41 |
| Tornillería | 37.80 |
| Empaque | 31.95 |
| Sellador | 22.16 |
| Flete de entrada (2 % de lámina + perfil) | 18.48 |
| **Subtotal materiales** | **1,034.42** |
| Alambre + gas + consumibles de corte + pintura | 127.87 |
| Mano de obra directa | 1,050.86 |
| Equipo (hora-máquina) | 78.29 |
| Herramienta menor (3 % de MO) | 31.53 |
| **COSTO DIRECTO (CD)** | **2,322.96** |

**Paso 12 · Pila de precio**

| Capa | Fórmula | MXN |
| --- | --- | --- |
| CD |  | 2,322.96 |
| CI de fábrica | GIF · h_MOD = 85.00 · 2.1017 | 178.65 |
| CI de administración | 8 % · CD | 185.84 |
| Imprevistos (riesgo MEDIO) | 4 % · (CD + CI) | 107.50 |
| **Costo total C_T** | CD + CI + imprevistos | **2,794.94** |
| Financiamiento | C_T · 14 % · 45/365 = C_T · 1.726 % | 48.24 |
| **Costo base** | C_T + financiamiento | **2,843.18** |
| **PRECIO antes de IVA** | C_base / (1 − 0.20 − 0.02) = 2,843.18 / 0.78 | **3,645.10** |
|   ↳ utilidad (20 % del precio) |  | 729.02 |
|   ↳ comisión de ventas (2 % del precio) |  | 72.90 |
| IVA 16 % |  | 583.22 |
| **Total con IVA** |  | **4,228.32** |

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Precio unitario antes de IVA | **3,645.10 MXN** |
| Peso neto que se manda (lámina + aros, incluido el suelto) | 37.564 kg |
| Precio por kg neto | 97.04 MXN/kg |
| Precio por metro lineal | 1215.03 MXN/m |
| Horas de mano de obra directa (reales) | 2.102 h |
| Margen de contribución (P − CD)/P | 36.3 % |
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
| Peso neto terminado, con aros (kg) | 37.564 | 11.453 |
| Longitud de soldadura total (m) | 5.01 | 6.63 |
| Horas de MOD reales (h) | 2.31 | 3.61 |
| Costo directo CD (MXN) | 2,448.54 | 2,494.10 |
| Precio antes de IVA (MXN) | 3,853.28 | 4,069.46 |
| Precio por kg neto (MXN/kg) | 102.58 | 355.32 |
| Horas MOD por kg neto (h/kg) | 0.062 | 0.315 |

**Lectura:** el área del codo es sólo 1.3 % mayor que la de un tramo recto de igual longitud de eje (F_arco = 1.0131), pero su **precio por kg neto es 3.46×** el del tramo recto y su **costo directo por m² de lámina es 4.20×**. El sobrecosto no está en el área: está en la merma (20 % vs 8 %), en el corte perfilado, en el armado (k_dif = 1.35) y en la soldadura de 4 juntas elípticas.

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
Bridas                        = 3 aros (D1, D2 y d): 1089.8 mm · 930.2 mm · 611.0 mm
```

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Costo directo (CD) | 1,800.71 MXN |
| Precio unitario antes de IVA | **2,937.16 MXN** |
| Peso neto terminado (lámina + 3 aros) | 7.376 kg |
| Precio por kg neto | 398.19 MXN/kg |
| Horas de mano de obra directa (reales) | 2.597 h  (k_dif armado = 1.9) |

**Sensibilidad** (misma pieza, un solo cambio)

| Variante | L reducción (mm) | Orificio (m²) | Precio (MXN) | vs. base |
| --- | --- | --- | --- | --- |
| Base: 45°, de extremo mayor a menor (hacia D2) | 247.4 | 0.0249 | 2,937.16 | — |
| 30°, hacia D2 | 320.7 | 0.0340 | 3,041.50 | +3.6 % |
| 45°, si se inclinara hacia D1 (`MAYOR`) | 288.7 | 0.0304 | 2,995.75 | +2.0 % |

**Lectura:** el precio por kg neto es **4.10×** el del tramo recto del Ejemplo A, por lo mismo que el codo: merma de 28 % contra 8 %, dificultad de armado 1.9 contra 1.0 y tres bridas en una pieza chica. A 30° la silleta es más larga y el cono también; hacia el extremo menor el cono "se cierra" y la silleta resulta más corta que si el injerto mirara hacia el mayor.

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
| `Cotizacion` | `id`, cliente, proyecto, fecha, `vigencia_dias`, moneda, `riesgo_default`, `servicio_default`, `parametros` (§5.4), `maestros_version_id`, estado | La vigencia protege contra la volatilidad del acero. |
| `Partida` | `cotizacion_id`, `n`, `familia`, parámetros (JSON de §2.1), `cantidad` | |
| `ResultadoPartida` | QTO, costos por capa, precio unitario e importe, indicadores, advertencias | Se puede recalcular con otra versión de precios sin tocar el QTO. |
| `Calibracion` | `partida_id`, horas reales por operación, kg bruto real, costo real, fecha | Alimenta el ajuste de φ, velocidades y `k_dif` (§10). |

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
| §5.4 y §6 Parámetros de la cotización, orquestación y validación | `src/motor/cotizador.js` |
| Interfaz web (captura, desglose, editor de maestros, propuesta imprimible) | `src/web/` (`index.html`, `app.js`, `maestros_ui.js`, `maestros_ayuda_ui.js`, `esquemas.js`, `dom.js`, `estilos.css`) |
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
- **Oráculos geométricos independientes:** codo, reducción excéntrica, transición, injerto simple (distancia media de silleta y área del orificio por fuerza bruta) y reducción con injerto (silleta sobre el cono por bisección, polilínea y rejilla; ensamble recalculado línea por línea) se comparan contra mallas 3D y promedios numéricos de fuerza bruta (`tests/geometria.test.js`). **Toda familia nueva debe traer su oráculo independiente.**
- **Lista del proveedor y mano de obra** (`tests/proveedor.test.js`): la lista reproduce al centavo los precios sin IVA de la factura; kg por hoja y por barra y $/kg recalculados desde las medidas; qué renglón usa el cálculo (hoja estándar, calibre sin cotizar, placa, inoxidable); IVA incluido o no; un precio inválido cae a la tabla; el salario es por hora y el costo de la hora es salario × FSR; un parche guardado con el salario diario de antes se limpia.
- **Parámetros de la cotización** (`tests/parametros.test.js`): cada parámetro recalculado desde `C_base` (margen, comisión, administración, días y tasa de cobro, IVA); descuento con IVA sobre el neto; utilidad real y su forma cerrada; valores inválidos que se ignoran con aviso; las tablas maestras no se mutan; la vista previa de una partida coincide con la lista; y los campos del encabezado en las pruebas de interfaz (sección 19).
- **Armado por yardas** (`tests/geometria.test.js`, `tests/motor.test.js`, `tests/ejemplo_recto.test.js`): los casos del taller (3 yardas por pieza, el extremo del ajuste sin brida de taller, a ±25 mm, ajuste solo, otro máximo de yardas por pieza); la distribución se contrasta contra un **oráculo que arma el tramo pieza por pieza con un lazo** en 4 000 largos y anchos al azar, en los tres modos del extremo libre (más invariantes: sólo la última pieza trae el ajuste, ninguna pasa de 3 yardas, lo que se corta es el largo pedido ±tolerancia); cantidades físicas (anillos, corte a lo ancho, juntas, extremos con brida, junta soldada si las tablas lo piden); **la brida suelta** (qué se le hace al aro en taller —se rola, se barrena, se le suelda el cierre y se pinta, con las mismas horas y la misma pintura que a uno de taller— y qué no —no se arma, no lleva filete al ducto ni sellador—; el material completo; el peso y los drivers por kilo y por metro de soldadura; las operaciones omitidas; con `ESPIGA` o `LISO` no hay aros; sigue a las tablas y a la partida); el **ancho de yarda de la cotización** (lo heredan sólo los tramos rectos; la partida manda; vacío, 0 o inválido se ignoran); la conversión del `ajuste_sin_brida` sí/no de la versión anterior; y el Ejemplo A recalculado de forma independiente —con su aro suelto— en los tres modos.
- **Pintura** (`tests/motor.test.js`, `tests/robustez.test.js`): la matriz material × instalación × partida (acero al carbón interior/exterior, galvanizado sólo en las bridas, inoxidable sin pintura, sistema elegido en la partida, dos caras del ducto, unión de espiga sin aros, aro suelto) con **superficie, litros de cada mano, minutos y costo recalculados a mano** desde las tablas; la instalación heredada de la cotización y la de la partida; los valores que no existen; las tablas de pintura (ubicación por omisión, manos y sistemas de cada material); y la migración de la pintura por defecto de una versión anterior.
- **Robustez** (`tests/robustez.test.js`): 640 partidas válidas al azar con semilla fija de todas las familias (sin excepciones ni `NaN`, pila de precio cerrada, cantidades independientes de los precios, ida y vuelta por JSON); cada campo numérico de cada familia corrompido con `NaN`, `±Infinity`, texto, listas, objetos y booleanos (siempre se rechaza); medidas en cero, negativas, «casi cero» y de `1e12` (se rechazan sin agotar memoria); vacíos opcionales; enumeraciones y listas; maestros con ceros, negativos, tablas de velocidad rotas o secciones ausentes (error que nombra la ruta); `cotizar()` con cotizaciones y partidas mal formadas (nunca lanza); y `sanearParche` contra parches dañados y `__proto__`. Las secciones 20 de `tests/e2e/ui.e2e.js` repiten lo visible: almacenamiento dañado, números ilegibles en el formulario, importaciones hostiles, tablas con ceros, almacenamiento bloqueado o lleno, fecha local y pantalla de 320 px.
- **Pruebas de política:** separación cantidades/precios, identidades de la pila (`P·(1 − u − c − o) = C_base`), cargo mínimo, subcontratos, validaciones, uniones, materiales (`tests/motor.test.js`).
- **Estándar de bridas del taller** (`tests/motor.test.js`): la solera de 1½" × 3/16" pesa `b·t·ρ`; el taller usa la misma brida (barreno Ø3/8", tornillo 5/16" × 1¼") en todos los diámetros; `L_aro = π·(D_ext + b) + holgura`; nº de barrenos múltiplo de 4 por paso; cada aro se valoriza con el precio de su propio perfil y el tornillo con el suyo; el cierre del aro se suelda a tope al espesor de la solera; marco rectangular; y `ESPIGA` no genera aros ni barrenos.
- **Persistencia de maestros** (`tests/util.test.js`): `mezclar(base, diferencia(base, actual))` reconstruye lo editado y los valores de arranque nuevos no quedan enmascarados.
- **Guardado automático** (`tests/almacen.test.js` con un almacén de mentira, y las secciones 11–14 de `tests/e2e/ui.e2e.js` con un `window.claude` simulado cuyo almacén vive fuera del navegador): qué manda al abrir, una ráfaga de cambios = una escritura, una escritura a la vez, pendientes y reintentos, sólo lectura, cambios hechos durante la carga, y recuperación única de los precios de la versión 1.
- **Ayuda de las tablas maestras** (`tests/ayuda_maestros.test.js`, sección 23 de `tests/e2e/ui.e2e.js`): cobertura exhaustiva del catálogo contra lo que dibuja el editor (grupos, secciones, datos y tablas, incluidas las claves con punto como el perfil `SOL38x4.8`), sin entradas muertas ni tapadas; calidad de los textos (completos, con tope de longitud, sin marcas ni nombres técnicos); rangos usuales que contienen a los valores de arranque; columnas de tabla y opciones que coinciden con las reales. En el navegador: un ⓘ por cada elemento; la ventana (qué es, cómo se llena, qué esperar; Esc, clic fuera y F1); la sensibilidad «si sube 10 %» comparada con una cotización independiente; probar, aplicar y deshacer (el precio vuelve al centavo); marcas de modificado y de fuera de rango; la comparación de opciones; las listas de precios, calibres y procesos; los booleanos y el cordón vacío que sobreviven a recargar; el ajuste de golpe de salarios y precios del proveedor como un solo cambio; el ranking ordenado; la guía; la hoja del celular sin desbordamiento; y sólo lectura.
- **Interfaz de extremo a extremo (opcional, Playwright):** `tests/e2e/ui.e2e.js` da de alta cada familia, edita y guarda cada partida **sin cambios** en tres combinaciones de unidades y exige que el precio no se mueva (el formulario no pierde datos), y recorre validaciones, subcontratos, tablas maestras, persistencia, guardar/cargar y pantalla móvil.

---

## 9. Verificación contra los criterios de calidad

| Criterio | Cumplimiento | Dónde |
| --- | --- | --- |
| ¿Están claramente definidas las fórmulas para convertir diámetros y longitudes en peso (kg) de lámina? | Sí: `D_med = D_int + e` → `B = π·D_med + a_costura` → `A_neta = B·L` → `m_neta = A_neta·ρ·e/1000` → `m_bruta = m_neta/(1 − φ)`; por familia para accesorios. | §3.1–3.4 · Pasos 1–4 del Ejemplo A |
| ¿Se incluyó la lógica para calcular bridas, tornillería y selladores? | Sí: aro de solera 1½" × 3/16" (estándar del taller) con longitud por centroide, barreno Ø3/8" y tornillo 5/16" × 1¼" como datos del perfil, nº de barrenos por paso con redondeo a múltiplos de 4, cierre del aro al espesor de la solera, empaque, sellador por clase SMACNA A/B/C, espiga y sus fijaciones. | §3.5 · Pasos 5–7 del Ejemplo A |
| ¿El ejemplo práctico se resuelve paso a paso sin saltarse factores de merma? | Sí: Paso 5 aplica φ = 8 % a la lámina y 5 % al perfil; sellador 15 %, tornillería 5 %, empaque 5 %, pintura por eficiencia de transferencia y gas por pre/post-flujo. | §7.1 |
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
| Salario por hora (hoy $500, dato del taller), FSR, `GIF_por_hora_MOD` | Nómina real y contabilidad de costos | Anual / trimestral |
| Tabla `servicios` (calibre mínimo) | Norma interna / SMACNA / ACGIH aplicable | Al adoptar la norma |
| Datos de detalle del estándar de bridas (paso entre barrenos, soldadura del aro, empaque, posición del barreno) | Confirmar con el taller los supuestos de §10.4 | Una vez, y al cambiar el estándar |

**Lazo de retroalimentación:** al cerrar cada orden se registran horas y kg reales (`Calibracion`); la desviación sistemática por operación o familia ajusta velocidades, φ y `k_dif`. Meta operativa: desviación de horas ≤ ±15 % y de peso bruto ≤ ±5 % por familia.

### 10.2 Límites conocidos (declarados, no ocultos)

- **Reducción con injerto:** la silleta se centra en el largo del cono y el cono es concéntrico; `merma` y `k_dif` son los del pantalón, ilustrativos, hasta calibrarlos (§10.5).
- **Transiciones:** sólo centradas; las excéntricas o en desfase se resuelven con `PERSONALIZADO` (área desarrollada desde CAD) o extendiendo la triangulación §3.4.3.
- **Ducto espiral, collarines, campanas, difusores:** no modelados; usar `PERSONALIZADO` o `COMPRADO`.
- **Anidado de hojas (modo B):** descrito en §3.3, no implementado; el motor usa φ de tabla.
- **Fuera de alcance:** instalación, soportería, flete a obra, andamios, ingeniería. Se cotizan como partidas `COMPRADO`/`PERSONALIZADO` o módulos aparte.
- **Valores ilustrativos:** ver §10.1. Son reales la mano de obra ($500 por hora) y la lámina y los perfiles de la lista del proveedor (30-sep-2026); lo demás (consumibles, equipo, tiempos, indirectos, utilidad) sigue siendo ilustrativo y hasta calibrarlo el motor sirve para comparar alternativas y validar la lógica, no para fijar precios de venta.

### 10.3 Siguientes pasos recomendados

1. Capturar precios, tarifas y velocidades reales (tabla §10.1) y regenerar el vector de referencia.
2. Calibrar `k_dif` y la merma de la reducción con injerto y del injerto simple con 10 órdenes reales.
3. Importar áreas desarrolladas desde DXF/CAD hacia `PERSONALIZADO`.
4. Implementar el modo de anidado de hoja (§3.3) cuando exista el layout real.
5. Conectar `Calibracion` al cierre de órdenes de producción.

### 10.4 Supuestos del estándar de bridas por confirmar con el taller

El taller definió tres datos: **solera 1½" × 3/16", barreno Ø3/8" y tornillo 5/16" × 1¼", en todos los ductos.** El resto del modelo de la brida se **supuso** y se edita en los maestros (T4 y T5); conviene confirmarlo, porque mueve tornillería, empaque y soldadura:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Paso máximo entre barrenos | 150 mm (≈ 6"); barrenos por brida = múltiplo de 4, mínimo 4 | `uniones.BRIDADO.paso_tornillo_mm` | Más barrenos: más tornillería, barrenado y empaque. |
| Posición del barreno | Al centro del ancho de la solera (g = 19.05 mm) | `perfiles.SOL38x4.8.gramil_mm` | Cambia el círculo de barrenos, el empaque y el nº de barrenos. |
| Soldadura del aro | Filete continuo exterior aro–ducto (`f_cont` = 1.0) y cierre a tope de una sección (b) | `uniones.BRIDADO.f_cont_soldadura_aro` | Un cordón intermitente (p. ej. 0.5) baja soldadura y consumibles, pero la junta deja de ser hermética sin sellador. |
| Empaque | Cinta de neopreno 1½" × 1/8" sobre el círculo de barrenos, traslape 5 % | `precio_m_empaque_neopreno` · `f_traslape_empaque` | Si el taller sella sólo con sellador, poner el precio del empaque en 0. |
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

Datos que dio el taller: los trabajadores ganan **$500 por hora y esa cifra ya incluye prestaciones** (FSR = 1.00); las barras de ángulo y solera se consideran de **6 m**; el proveedor de acero cotiza hojas y barras por pieza (cotizaciones y factura del 30-sep-2026). Lo demás se **supuso** y se edita en las tablas maestras:

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

Lo que describió el taller: se rolan yardas de 914 ó 1 220 mm (el ancho de la lámina; **lo elige el ingeniero que diseña**); se engargolan hasta 3 en una pieza con bridas en ambos extremos; lo que falta son 2 yardas y un tramo de ajuste, y la pieza que trae menos de una yarda en un lado va sin brida en ese extremo para ponerla en campo ajustando la distancia; y, **de la brida de ese extremo, el taller manda suelto el aro con sus tornillos y su empaque** para instalarlos en obra. Lo demás se **supuso** y se cambia en las tablas (`proceso.armado_yardas`), en el encabezado de la cotización o en la partida:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Qué cuenta en «hasta 3 yardas» | El tramo de ajuste cuenta como una: la última pieza es a lo más «2 yardas + ajuste» | `yardas_por_pieza_max` | Si el ajuste no contara, una pieza podría ser «3 yardas + ajuste» y 3 m en yardas de 914 serían una pieza con una brida (no 2 piezas y 3 bridas). |
| Cómo se reparte lo que falta | Greedy: primero piezas de 3 yardas; lo que sobra va en una última pieza (yardas completas + ajuste engargolados). Si sobra sólo el ajuste, es una pieza aparte con una brida | — (`distribuirYardas`) | Otro reparto (por ejemplo piezas más parejas) cambia el número de piezas, no el de anillos ni de bridas. |
| Brida del extremo del ajuste | **Brida suelta** por omisión: el taller manda el aro **terminado** —rolado, con el cierre soldado, barrenado y pintado— con sus tornillos y su empaque, **sin soldarlo al ducto** (se suelda en obra donde se corta el tramo). Se cobra su material (solera con la merma de barra, tornillería, empaque y flete) y esas operaciones; **no** se cobra el armado del aro al ducto ni el filete aro–ducto, ni el sellador de su junta (se sella en obra) | `extremo_ajuste_defecto` (tablas) y `extremo_ajuste` (partida): `SUELTA`, `SIN_BRIDA` o `CON_BRIDA` | `SIN_BRIDA`: la brida no está en el precio. `CON_BRIDA`: se arma y se suelda al ducto en taller y se sella su junta (cuánto cambia el precio, en la tabla de §3.2). **Por confirmar:** si el taller también manda el sellador de esa junta, hay que sumarlo (unos pesos por brida). |
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
| Origen de los datos | Reales: lista del proveedor y salario por hora. De norma: calibres. Ilustrativos: el resto | `origen` y `origenTxt` de cada grupo | Al sustituir valores ilustrativos por reales, se actualiza la etiqueta del grupo. |
| Listas cerradas | Un dato que sólo admite ciertos valores se elige de una lista (precios con prefijo afín primero, luego «otros precios») | `OPCIONES_TEXTO` en `maestros_ui.js` | Un valor guardado que no está en la lista se muestra marcado «(no válido)» y el cálculo lo avisa, como antes. |
| Deshacer | Hasta 50 cambios, sólo en esta sesión de la pantalla (no sobrevive a recargar la página; lo guardado sí) | `historial` en `maestros_ui.js` | — |
