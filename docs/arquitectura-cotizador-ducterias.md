# Arquitectura del Cotizador Maestro de Ducterías

**COTIZAP · Especificación lógica, matemática y estructural · v1.1**

> Documento de arquitectura para analistas de datos y programadores. Define **qué se calcula, con qué fórmulas y con qué datos**, sin depender de una plataforma. La implementación de referencia (JavaScript sin dependencias) vive en `src/`, sus pruebas en `tests/`, y **todas las cifras de los ejemplos de este documento son la salida literal del motor**.
>
> ⚠ **Todos los valores monetarios, tarifas, velocidades y tiempos de este documento y de `src/datos/maestros.js` son ILUSTRATIVOS.** Existen para que el motor funcione y para servir de vector de prueba. Deben sustituirse por precios de proveedor, tarifas reales y estudios de tiempos del taller antes de cotizar a un cliente (§10).

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
| Injerto simple, reducción con injerto y ángulos del taller | El «ramal en ángulo» pasó a llamarse **injerto simple** (misma geometría, id `RAMAL`). El «pantalón» se sustituyó por la **reducción con injerto** (id `REDUCCION_INJERTO`): una reducción D1 → D2 con el injerto **sobre el cono**, derecho o izquierdo. **Todo injerto es a 30° o 45°** y **los codos son de 30°, 45°, 60° o 90°**: son listas de maestros y el cotizador rechaza cualquier otro ángulo. El pantalón se retiró de la interfaz; el motor lo sigue calculando sólo para abrir cotizaciones anteriores. Siete supuestos de detalle están por confirmar con el taller (§10.5). | §3.4.1 · §3.4.4 · §3.4.5 · §7.3 · §10.5 |
| Brida estándar del taller | **Una sola brida para todos los diámetros: aro de solera 1½" × 3/16", barreno Ø3/8", tornillo 5/16" × 1¼".** Se modela como el perfil `SOL38x4.8` (tipo solera, rolada "de canto"), que lleva en sus propias columnas el barreno y el tornillo; los ángulos quedan como opción por partida (`perfil_id`). Cinco supuestos de detalle están por confirmar con el taller (§10.4). | T4 · T5 · §3.5 · §10.4 |
| Público objetivo | Ingenieros de ventas técnicas en México y desarrolladores internos. Moneda **MXN**, **IVA 16 %** aparte, **Factor de Salario Real (FSR)** para mano de obra. | `capas.iva_pct`, `mano_obra.FSR` |

### 0.2 Convenciones obligatorias (evitan los errores más caros)

1. **Unidades internas:** mm (longitudes), m² (áreas), kg, min, MXN. Las entradas en pulgadas se convierten con 1 in = 25.4 mm exactos.
2. **Diámetro nominal = interior** (`ref_diametro = INTERIOR`, configurable). Lo que se desarrolla es el **diámetro medio de la fibra neutra** `D_med = D_int + e`. Ignorar `e` en un Ø12" cal. 16 acorta la plantilla 4.8 mm (0.5 %).
3. **Merma como rendimiento:** `m_bruta = m_neta / (1 − φ)`, **no** `m_neta · (1 + φ)`. Con φ = 20 % el factor correcto es 1.25, no 1.20 (4 % de subestimación del material).
4. **Utilidad como margen sobre precio:** `P = C / (1 − m)`. Un margen del 20 % equivale a un *markup* del 25 % sobre costo (`k = m / (1 − m)`). Confundirlos regala utilidad.
5. **Los precios nunca viven en las fórmulas.** Se leen por variable referencial (`precio_kg_acero_carbon`, `precio_m3_gas_argon`, …) desde una tabla de precios versionada.
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
| **MOD / FSR** | Mano de obra directa / Factor de Salario Real (convierte salario base en costo real). |
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
| `pintura` | enum | `NINGUNA` `PRIMARIO` `PRIMARIO_ESMALTE` | por material | Acero al carbón: primario; galvanizado/inoxidable: ninguna. |
| `caras_pintadas` | 1 ó 2 | — | 1 | 2 = exterior + interior. |
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
| `RECTO` | redondo: `D_mm` · rectangular: `a_mm`, `b_mm` · `L_mm`, `tipo_costura` (`A_TOPE` `TRASLAPE` `PITTSBURGH`), `L_max_pieza_mm`, `n_costuras_long` | Se divide en `⌈L/L_max⌉` piezas iguales. |
| `CODO` | redondo: `D_mm`, `theta_deg` (**30, 45, 60 ó 90**; 90), `n_gajos` (auto), `k_R` (1.5), `L_tangente_mm` (0) · rectangular: `a_mm`, `b_mm`, `theta_deg`, `k_R` | `n_gajos` automático con α ≤ 22.5° por junta: 3, 3, 4 y 5 gajos para 30°, 45°, 60° y 90°. |
| `REDUCCION` | `D1_mm`, `D2_mm`, `L_mm` (auto con semiángulo 15°), `excentrica` (`NO` `CARA_PLANA`) | |
| `TRANSICION` | `D_mm` (extremo redondo), `a_mm`, `b_mm` (extremo rectangular), `H_mm` (auto) | Centrada. |
| `RAMAL` (injerto simple) | `D_mm` (tronco), `d_mm` (injerto), `L_cuerpo_mm`, `L_ramal_mm`, `beta_deg` (**30 ó 45**; 45) | `L_ramal` se mide sobre el eje del injerto desde el eje del tronco. |
| `REDUCCION_INJERTO` | `D1_mm`, `D2_mm` (< D1), `d_mm`, `beta_deg` (**30** ó **45**; 45), `sentido` (`MAYOR` `MENOR`; `MAYOR`), `lado` (`DER` `IZQ`; `DER`), `L_reduccion_mm`, `L_ramal_mm` | El injerto va **sobre el cono**. Los dos largos son opcionales: vacíos → automáticos (§3.4.5). El lado sólo identifica la pieza; el sentido sí cambia el desarrollo. |
| `PERSONALIZADO` | `A_neta_m2`, `L_corte_m`, `L_sold_tope_m`, `L_sold_filete_m`, `n_piezas`, `n_extremos`, `D_ref_mm` | Para campanas y piezas con desarrollo CAD. |
| `COMPRADO` | `precio_compra_unitario`, `peso_kg` | Compuertas, flexibles, etc.: pasa por la pila sin mano de obra. |

### 2.2 Tablas maestras

**T1 · Materiales**

| `material_id` | Tabla calibre | ρ (kg/m³) | Variable de precio | Soldadura | Aporte | Gas | f_sold | f_acabado | Pintura defecto |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ACERO_CARBON` | MSG | 7,850 | `precio_kg_acero_carbon` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.00 | 0.25 | PRIMARIO |
| `GALVANIZADO` | GSG | 7,850 | `precio_kg_acero_galvanizado` | GMAW | `precio_kg_alambre_er70s6` | `precio_m3_gas_mezcla_ar_co2` | 1.20 | 0.35 | NINGUNA |
| `INOX_304` | USSG | 7,930 | `precio_kg_inox_304` | GTAW | `precio_kg_varilla_er308l` | `precio_m3_gas_argon` | 1.00 | 0.60 | NINGUNA |
| `INOX_316` | USSG | 7,980 | `precio_kg_inox_316` | GTAW | `precio_kg_varilla_er316l` | `precio_m3_gas_argon` | 1.00 | 0.60 | NINGUNA |

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

**T3 · Precios — variables referenciales** (todos *ilustrativos*; en producción provienen de una tabla versionada con proveedor, vigencia y moneda)

| Variable referencial | Unidad | Valor ilustrativo |
| --- | --- | --- |
| `precio_kg_acero_carbon` | MXN/kg | 22.00 |
| `precio_kg_acero_galvanizado` | MXN/kg | 27.50 |
| `precio_kg_inox_304` | MXN/kg | 98.00 |
| `precio_kg_inox_316` | MXN/kg | 135.00 |
| `precio_kg_chatarra_acero` | MXN/kg | 7.00 |
| `precio_kg_chatarra_inox` | MXN/kg | 45.00 |
| `precio_kg_perfil_angulo` | MXN/kg | 21.50 |
| `precio_kg_solera` | MXN/kg | 21.00 |
| `precio_kg_alambre_er70s6` | MXN/kg | 62.00 |
| `precio_kg_varilla_er308l` | MXN/kg | 420.00 |
| `precio_kg_varilla_er316l` | MXN/kg | 520.00 |
| `precio_m3_gas_mezcla_ar_co2` | MXN/m³ | 145.00 |
| `precio_m3_gas_argon` | MXN/m³ | 190.00 |
| `precio_m_corte_guillotina` | MXN/m de corte | 0.30 |
| `precio_m_corte_plasma` | MXN/m de corte | 3.50 |
| `precio_m_corte_laser` | MXN/m de corte | 2.00 |
| `precio_m_empaque_neopreno` | MXN/m | 28.00 |
| `precio_cartucho_sellador_300ml` | MXN/cartucho 300 mL | 120.00 |
| `precio_pza_autotaladrante` | MXN/pza | 0.85 |
| `precio_juego_tornillo_5_16_x_1_1_4` | MXN/juego (tornillo+tuerca+2 rondanas) | 4.50 |
| `precio_juego_tornillo_m8` | MXN/juego (tornillo+tuerca+2 rondanas) | 5.00 |
| `precio_juego_tornillo_m10` | MXN/juego (tornillo+tuerca+2 rondanas) | 6.50 |
| `precio_juego_tornillo_m12` | MXN/juego (tornillo+tuerca+2 rondanas) | 9.50 |
| `precio_L_primario` | MXN/L | 220.00 |
| `precio_L_esmalte` | MXN/L | 260.00 |
| `precio_L_diluyente` | MXN/L | 70.00 |

**T4 · Perfiles de aros de brida.** La primera fila es el **estándar del taller** y se usa en todos los diámetros; las demás (ángulos) son opcionales por partida con `perfil_id`. El área, el peso lineal y el centroide se **derivan** de (tipo, ancho, espesor) y no se capturan; el gramil, el barreno, el tornillo y la variable de precio son datos del perfil. Fórmulas en §3.5.1.

| `perfil_id` | Descripción | Tipo | Ancho b (mm) | Espesor t (mm) | Área (mm²) | Peso (kg/m) | c centroide (mm) | Gramil g (mm) | Barreno | Tornillo | Precio del perfil | Uso |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SOL38x4.8` | Solera 1½" × 3/16" | Solera | 38.10 | 4.763 | 181.5 | 1.4245 | 19.05 | 19.05 | Ø3/8" = 9.525 mm | 5/16" × 1¼" | `precio_kg_solera` | **Estándar del taller**: todos los diámetros |
| `L25x3.2` | Ángulo 1" × 1" × 1/8" | Ángulo | 25.40 | 3.175 | 151.2 | 1.1870 | 7.51 | 14.00 | Ø9.000 mm | M8 | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x3.2` | Ángulo 1½" × 1½" × 1/8" | Ángulo | 38.10 | 3.175 | 231.9 | 1.8201 | 10.70 | 22.00 | Ø11.000 mm | M10 | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L38x4.8` | Ángulo 1½" × 1½" × 3/16" | Ángulo | 38.10 | 4.763 | 340.3 | 2.6710 | 11.27 | 22.00 | Ø11.000 mm | M10 | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L51x4.8` | Ángulo 2" × 2" × 3/16" | Ángulo | 50.80 | 4.763 | 461.2 | 3.6207 | 14.46 | 29.00 | Ø11.000 mm | M10 | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |
| `L64x6.4` | Ángulo 2½" × 2½" × 1/4" | Ángulo | 63.50 | 6.350 | 766.1 | 6.0141 | 18.21 | 35.00 | Ø14.000 mm | M12 | `precio_kg_perfil_angulo` | Alterno: se elige con `perfil_id` en la partida |

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

**Otros parámetros de proceso:** `eficiencia_taller` η = 0.80 · hoja estándar 1 219 × 3 048 mm · `L_max_pieza` = 3 000 mm · semiángulo máx. de reducciones 15° · α máx. por junta de codo 22.5° · holguras de costura (mm): `A_TOPE` 1.0, `TRASLAPE` 25, `PITTSBURGH` 32 · soldadura GMAW (`FO` 0.40, 15 L/min, η_dep 0.93, pre/post-flujo 10 %) y GTAW (velocidad ×0.5, `FO` 0.35, 9 L/min, η_dep 0.98, pre/post-flujo 15 %) · `k_cordón` tope 1.75 y filete 1.00, `A_cordón_min` 2.0 mm² · pintura: primario SV 55 %, DFT 50 µm, η_transf. 0.65; esmalte SV 45 %, DFT 40 µm, η_transf. 0.65; diluyente 10 %.

**T8 · Tarifas de operación** (`mo_h = salario_diario · FSR / jornada_h`, FSR = 1.55, jornada = 8 h)

| Operación | Salario diario (MXN) | `mo_h` = sal · FSR / 8 (MXN/h) | Equipo (MXN/h) | Tarifa total (MXN/h) |
| --- | --- | --- | --- | --- |
| `corte` | 480 | 93.00 | 45 | 138.00 |
| `rolado` | 500 | 96.88 | 55 | 151.88 |
| `armado` | 520 | 100.75 | 25 | 125.75 |
| `aros` | 520 | 100.75 | 40 | 140.75 |
| `soldadura` | 600 | 116.25 | 45 | 161.25 |
| `engargolado` | 480 | 93.00 | 35 | 128.00 |
| `barrenado` | 450 | 87.19 | 25 | 112.19 |
| `acabado` | 450 | 87.19 | 20 | 107.19 |
| `pintura` | 480 | 93.00 | 40 | 133.00 |
| `qc_embalaje` | 450 | 87.19 | 0 | 87.19 |

**T9 · Capas de precio** (valores ilustrativos; ver §5)

| Parámetro | Valor | Parámetro | Valor |
| --- | --- | --- | --- |
| `herramienta_menor_pct_mo` | 3 % | `administracion_pct_cd` | 8 % |
| `flete_material_pct` | 2 % | `imprevistos_pct` BAJO / MEDIO / ALTO | 2 % / 4 % / 8 % |
| `recuperacion_chatarra_pct` | 0 % | `financiamiento` | 14 % anual, 45 días |
| `gif_por_hora_mod` | 85.00 MXN/h | `utilidad_pct_precio` | 20 % |
| `comision_ventas_pct_precio` | 2 % | `otros_pct_precio` | 0 % |
| `iva_pct` | 16 % | `cargo_minimo_partida` | 250.00 MXN |

### 2.3 Reglas de validación

| # | Regla | Efecto |
| --- | --- | --- |
| V1 | `cantidad` entero ≥ 1; familia y material existentes | Error |
| V2 | El calibre existe en la tabla del material (o se captura `espesor_mm`) | Error |
| V3 | Calibre más delgado que el mínimo para (diámetro, `servicio`) — tabla parametrizable `servicios`, **no normativa** hasta que se pueble con la norma interna | Advertencia |
| V4 | Reducción: semiángulo `atan(δ/L)` ≤ 15° | Advertencia |
| V5 | Injerto simple: β en la lista de maestros (`proceso.angulos_injerto_deg` = 30°, 45°); `d < D`; `L_ramal > t_max`; tramo de tronco suficiente para el orificio | Error / advertencia |
| V6 | Reducción con injerto: β en la misma lista; `D2 < D1`; `d` menor que el diámetro del cono en su punto medio; `lado` ∈ {`DER`, `IZQ`}; `sentido` ∈ {`MAYOR`, `MENOR`}; la silleta cabe en el cono con la holgura de maestros (si se captura el largo); `L_ramal > t_max`; semiángulo del cono ≤ 15° | Error / advertencia |
| V7 | Codo: θ en la lista de maestros (`proceso.angulos_codo_deg` = 30°, 45°, 60°, 90°); `n_gajos ≥ 2`; `R/D ≥ 1.0` | Error |
| V8 | Merma en [0, 1) | Error |
| V9 | `utilidad + comisión + otros < 100 %` del precio | Error |
| V10 | Toda variable `precio_*` referenciada existe en la tabla de precios | Error |

---

## 3. Módulo 2 — Motor geométrico y de material (Core Engine)

### 3.1 Dimensiones derivadas

```text
D_int = D_nom                       si ref_diametro = INTERIOR  (defecto)
      = D_nom − 2·e                 si ref_diametro = EXTERIOR
D_med = D_int + e                   # fibra neutra: es el diámetro que se desarrolla
D_ext = D_int + 2·e                 # para aros, pintura y sellado
```

### 3.2 Tramo recto

```text
B        = π·D_med + n_costuras·a_costura               # ancho de plantilla, mm
n_piezas = ⌈L_total / L_max_pieza⌉                      # piezas iguales: L_pieza = L_total / n_piezas
A_neta   = B · L_total / 10⁶                            # m²  (+ prolongación de espiga si aplica, §3.5.6)
A_ext    = π·D_ext·L_total / 10⁶                        # superficie a pintar

Rectangular:  P_med = 2·(a + b + 2e) ;  B = P_med + n_costuras·a_costura
```

Holguras de costura `a_costura` (mm): soldada a tope 1.0 (holgura de raíz) · soldada a traslape 25 · engargolado Pittsburgh 32 *(valores iniciales: calibrar con la plantilla real del taller)*. Las costuras soldadas generan metros de soldadura; el engargolado genera metros de engargolado y habilita sellado clase B.

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

> **No confundir el factor geométrico con el factor de costo.** Un codo de 5 gajos sólo tiene ~1.3 % más lámina que su tramo recto equivalente, pero cuesta ≈ 2.65× más **por kg**. Ese sobrecosto sale de la merma (20 % vs 8 %), del corte perfilado, del armado (`k_dif`) y de la soldadura de `j` juntas elípticas, y se modela allí (§4), no inflando el área. El Ejemplo B lo cuantifica.

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

#### 3.4.5 Reducción con injerto (30° o 45°, derecho o izquierdo): el injerto va sobre el cono

La pieza es una reducción (cono de `D1` a `D2`) con el injerto de diámetro `d` soldado **sobre el cono**, a β = 30° o 45° respecto al eje. Es el cono con el orificio de la silleta más la pared del injerto: **2 piezas, 1 junta interna y 3 bridas** (D1, D2 y el injerto).

**Intersección injerto–cono.** Con el eje del cono sobre `x` (radio `r(x) = R1 − m·x`, `m = (R1 − R2)/L`) y el eje del injerto cruzándolo en `(x_j, 0, 0)` a β, cada generatriz `φ` del injerto toca el cono a la distancia axial `t(φ)` de ese cruce. Es la raíz positiva de una cuadrática (cilindro ∩ cono es una cuádrica por recta):

```text
u = (s·cosβ, sinβ, 0)            s = −1 si el injerto se inclina hacia el extremo MAYOR ; +1 hacia el MENOR
A0 = R1 − m·x_j                  # radio del cono en el cruce
c  = r_b·sinφ·u_x ,   d0 = A0 + m·u_y·r_b·sinφ
a  = u_y² − m²·u_x²   (> 0: el injerto es más tendido que... más abierto que el cono)
b  = 2·(u_y·c + m·u_x·d0) ,   g = c² + r_b²·cos²φ − d0²
t(φ) = ( −b + √(b² − 4·a·g) ) / (2·a)                 # punto de la silleta: x_j + t·u_x − r_b·sinφ·u_y , …

t_med = promedio de t(φ) ;  t_max = máx t(φ) ;  P_h = longitud de la polilínea de la silleta (2 880 puntos)
A_orificio = | ∮ G(x) dθ | ,   G(x) = √(1 + m²)·(R1·x − m·x²/2)                # Green sobre (x, θ): dA = r·√(1 + m²) dx dθ
```

Por cada punto de la silleta no se usan mallas: el orificio sale de una integral de línea de una función suave y periódica. Con `m → 0` el cono es un cilindro y los tres resultados coinciden con el injerto simple (§3.4.4).

**Hacia qué extremo se inclina.** Con el injerto inclinado hacia el extremo mayor el ángulo efectivo con la pared es β − σ; hacia el menor, β + σ (σ = semiángulo del cono). Cambia el orificio (≈ 20 % a 45° y ≈ 35 % a 30°, para un cono de 5°), la silleta y el largo del cono, y el precio ≈ 3 %. Por omisión `sentido = MAYOR`: en colección de polvo el flujo sale por el extremo mayor y el injerto apunta hacia allá.

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
- **Lado (der/izq):** identifica la pieza para el taller y para la propuesta; **no cambia ninguna cantidad**: en una reducción concéntrica la pieza izquierda es la derecha instalada girada sobre su eje.
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
n_juntas_asignadas = 0.5 · n_extremos_bridados              # cada junta se comparte entre dos piezas
juegos      = Σ_extremos 0.5·n_tornillos · (1 + f_reserva)  # juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas
n_barrenos  = Σ_extremos n_tornillos                        # cada brida lleva sus barrenos
Marco rectangular:  P_perno = 2·(a_ext + b_ext) + 8·g
```

Los juegos se agrupan por tipo de tornillo del perfil y cada tipo se valoriza con su propia variable (`precio_juego_tornillo_5_16_x_1_1_4` para el estándar del taller).

#### 3.5.3 Soldadura de aros

```text
L_filete_aro = Σ_extremos f_cont · P_ext            # aro–ducto, al espesor de la LÁMINA ; P_ext = π·D_ext ; f_cont = 1.0 (continuo, hermético)
L_cierre_aro = Σ_extremos b                         # costura a tope que cierra el aro: una sección de ancho b (rect.: 4 esquinas × b ; ángulo: 2b por cierre)
A_cordón_cierre = máx( A_mín , k_tope · t² )        # con el espesor t de la SOLERA, no el de la lámina (4.763 mm → 39.7 mm²)
```

El cierre del aro se suelda en un espesor mayor que el de la lámina, así que su cordón es más grande y su velocidad de avance menor (§4.1 y §4.3).

#### 3.5.4 Empaque

```text
L_empaque = Σ_extremos 0.5 · P_perno · (1 + f_traslape)          # m, una sola cinta por junta, sobre el círculo de barrenos
```

Se asume cinta de neopreno de 1½" × 1/8" (el ancho de la solera) y traslape de 5 % en el empalme (§10.4).

#### 3.5.5 Sellador por clase (SMACNA)

```text
Clase C : juntas transversales                      L = Σ_extremos 0.5·P_ext          (bridado)  |  Σ_espigas P_ext
Clase B : C + costuras longitudinales NO soldadas   L = C + L_engargolado
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

---

## 4. Módulo 3 — Mano de obra y consumibles

### 4.1 Tiempos estándar por operación

Cada tiempo se calcula con **drivers geométricos** (metros de corte, metros de soldadura, número de piezas…) y se expresa en **minutos estándar por unidad**. La eficiencia del taller `η` se aplica al valorizar: `t_real = t_estándar / η`.

```text
Corte        t = n_hojas_eq·t_manejo_hoja + L_corte / v_corte(proceso, e)       n_hojas_eq = A_bruta / A_hoja
             + t_prog_cnc (una vez por PARTIDA; sólo plasma/láser)
Rolado       t = n_virolas · [ t_fijo_rolado + n_pasadas · k_rolado · L_virola / v_rolado(e) ]      k_rolado = 1 cilindro ; 1.6 cono
Armado       t = k_dif[familia] · [ n_piezas·t_fijo_pieza + n_juntas_int·(t_junta_base + t_junta_por_m·D_ref)
                                    + n_aros·t_ajuste_aro + n_fijaciones·t_fijación + n_espigas·t_formado_espiga ]
Aros         t = Σ_aros [ t_fijo_aro + t_roll_aro · L_aro/1000 ]
Soldadura    t_arco = (L_tope + L_filete) / ( v_sold(e)·v_mult(proceso) )                # min con arco encendido, al espesor de la lámina
                    + Σ_aros L_cierre / ( v_sold(t_perfil)·v_mult(proceso) )              # cierres de aro, al espesor de la solera
             t      = ( t_arco / FO ) · f_sold(material)                        # FO = factor de operación (arco encendido / tiempo total)
Engargolado  t = n_piezas·t_fijo + L_engargolado / v_engargolado(e)             # costuras Pittsburgh
Barrenado    t = n_barrenos · t_barreno
Acabado      t = f_acabado(material) · t_soldadura
Pintura      t = A_pint · ( t_prep + n_manos · t_aplicación )
Inspección   t = t_fijo_qc + k_manejo · m_neta_total
t_real(op)   = t_estándar(op) / η_taller
Costo(op)    = (t_real / 60) · ( mo_h(op) + equipo_h(op) )        mo_h = salario_diario · FSR / jornada_h
```

`FSR` (Factor de Salario Real) convierte el salario diario base en costo real por hora (prestaciones, aguinaldo, vacaciones, cargas sociales).

### 4.2 Drivers por familia

Longitudes en m salvo indicación; `κ = √(1 + tan²(α/2)/2)`.

| Familia | `n_piezas` = `n_virolas` | `L_corte` | Soldadura tope | Soldadura filete | Juntas internas |
| --- | --- | --- | --- | --- | --- |
| Recto | `⌈L/L_max⌉` | `Σ 2·(B + L_pieza)` | `n_cost·L` (costura a tope) | `n_cost·L` (si traslape) | 0 |
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
  L_mano            = A_pint / ( cobertura_teórica · η_transf )
  L_diluyente       = f_dil · Σ L_mano
  A_pint            = A_ext · n_caras + A_aros_expuestos

Corte:  costo = L_corte · precio_m_corte[proceso]            # electrodos, boquillas, gas de asistencia, cuchillas
```

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

Materiales  = m_bruta·precio_kg_<material> − crédito_chatarra + Σ_aros m_aro_bruta·precio_kg_<perfil>     # solera: precio_kg_solera
              + Σ_tipos juegos·precio_juego_<tornillo> + L_empaque·precio_m_empaque + V_sellador·precio_mL_sellador
              + fijaciones·precio_pza + flete_material% · (lámina + perfil)
Herramienta menor = herramienta_menor_pct · Mano de obra
```

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

---

## 6. Pseudocódigo maestro

```text
FUNCIÓN cotizar(cotización, M):                          # M = snapshot de maestros (versión congelada)
    PARA CADA partida p EN cotización.partidas:
        resultado[p] ← cotizar_partida(p, M)             # un error en una partida no tumba las demás
    subtotal ← Σ resultado.importe ;  IVA ← subtotal · M.iva ;  total ← subtotal + IVA

FUNCIÓN cotizar_partida(p, M):
    validar(p, M)                                        # errores bloquean · advertencias se reportan
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
    CD  ← valorizar(p.cantidad, lam, her, t, con, M.precios, M.tarifas, M.η)
    PR  ← pila(CD, CD.h_MOD, p.riesgo, M.capas)          # CI → imprevistos → financiamiento → margen
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
| `L_mm` | **3 000 mm**, 1 pieza |
| `tipo_costura` | A_TOPE (soldada; holgura de raíz 1.0 mm) |
| `tipo_union` | BRIDADO en ambos extremos |
| `clase_sellado` | C (juntas transversales) |
| `pintura` | PRIMARIO (1 mano, sólo exterior) |
| `servicio` / `riesgo` | POLVO / MEDIO |
| `cantidad` | 1 |

**Paso 1 · Espesor y diámetros**

```text
e     = 0.0598 in × 25.4 = 1.5189 mm    (tabla MSG, calibre 16)
D_int = 12 in × 25.4 = 304.800 mm
D_med = D_int + e = 304.800 + 1.5189 = 306.3189 mm    (fibra neutra: es el diámetro que se desarrolla)
D_ext = D_int + 2e = 307.8378 mm
```

**Paso 2 · Desarrollo y área neta**

```text
B (ancho de plantilla) = π · D_med + a_costura = π · 306.3189 + 1.0 = 963.329 mm
n_piezas               = ⌈3 000 / 3 000⌉ = 1
A_neta                 = B · L / 10⁶ = 963.329 · 3 000 / 10⁶ = 2.88999 m²
```

**Paso 3 · Peso neto**

```text
w_a (kg/m²) = ρ · e / 1000 = 7 850 · 1.5189 / 1000 = 11.9235
m_neta      = A_neta · w_a = 2.88999 · 11.9235 = 34.459 kg
```

**Paso 4 · Merma (φ = 8 %) y peso bruto — el factor de merma NO se omite**

```text
m_bruta         = m_neta / (1 − φ) = 34.459 / 0.92 = 37.455 kg
m_merma         = m_bruta − m_neta = 2.996 kg
Costo de lámina = m_bruta · precio_kg_acero_carbon = 37.455 · 22.00 = 824.02 MXN
```

**Paso 5 · Aros de brida** — estándar del taller, perfil `SOL38x4.8` = Solera 1½" × 3/16" (el mismo para cualquier diámetro)

```text
b × t (solera)       = 1½" × 3/16" = 38.100 × 4.763 mm   (el ancho b queda en el plano radial: la solera se rola "de canto")
c (centroide radial) = b / 2 = 19.050 mm
w_p (peso lineal)    = b · t · 7.85 / 1000 = 38.100 · 4.763 · 7.85 / 1000 = 1.4245 kg/m
L_aro                = π·(D_ext + 2c) + 3.0 = π·(307.8378 + 38.100) + 3.0 = 1089.80 mm
m_aros_neta          = 2 · 1.0898 m · 1.4245 kg/m = 3.105 kg
m_aros_bruta         = m_aros_neta / (1 − 0.05) = 3.268 kg
Costo de perfil      = 3.268 · precio_kg_solera 21.00 = 68.64 MXN
```

**Paso 6 · Barrenos, tornillería, empaque y sellador** (barreno Ø3/8" = 9.525 mm · tornillo 5/16" × 1¼")

```text
D_bc (círculo de barrenos) = D_ext + 2g = 307.8378 + 2·19.05 = 345.938 mm  →  π·D_bc = 1086.80 mm   (barreno al centro de la solera: g = b/2)
n_barrenos por brida       = ⌈1086.80 / 150⌉ = 8  →  múltiplo de 4 ≥ máx(4, 8) = 8
n_juntas_asignadas         = 2 extremos · 0.5 = 1.0
Juegos de tornillería      = 8 · 1.05 (reserva) = 8.4  →  · 4.50 = 37.80 MXN   (juego = tornillo 5/16" × 1¼" + tuerca + 2 rondanas)
n_barrenos (total)         = 2 aros · 8 = 16
L_empaque                  = 1 junta · 1086.80 mm · 1.05 / 1000 = 1.1411 m  →  · 28.00 = 31.95 MXN
L_sellado (clase C)        = 1 junta · π·D_ext / 1000 = 0.9671 m
V_sellador                 = 0.9671 m · 20 mL/m · 1.15 = 22.24 mL  →  · (120.00 / 300) = 8.90 MXN
```

**Paso 7 · Longitudes de proceso**

```text
L_corte                      = 2·(B + L) / 1000 = 2·(963.329 + 3 000) / 1000 = 7.9267 m
L_soldadura (tope, lámina)   = costura longitudinal de la virola = 3.0000 m
L_soldadura (filete)         = aro–ducto 2·π·D_ext / 1000 = 1.9342 m
L_soldadura (cierres de aro) = 2 aros · b / 1000 = 0.0762 m   (a tope, al espesor de la solera: 4.763 mm)
L_soldadura total            = 5.0104 m
A_pintura                    = π·D_ext·L + 2 aros·(caras + canto) = 3.0784 m²
```

**Paso 8 · Tiempos estándar por operación** (η_taller = 0.8)

| Operación | Cálculo | t estándar (min) |
| --- | --- | --- |
| Corte (guillotina) | 0.8455 hojas · 4.0 min + 7.927 m / 7.975 m/min | 4.38 |
| Rolado | 1 virola · (3.0 + 3 pasadas · 3.0 m / 5.962 m/min) | 4.51 |
| Armado y punteo | 1 pieza · 6.0 + 2 aros · 4.0 | 14.00 |
| Aros de brida | 2 · (4.0 + 2.5 min/m · 1.0898 m) | 13.45 |
| Soldadura | t_arco = (4.934 m / 0.497 m/min) + (0.0762 m / 0.240 m/min en 4.763 mm) = 9.93 + 0.32 = 10.25 min;  ÷ FO (0.4) | 25.62 |
| Barrenado | 16 barrenos Ø3/8" · 0.35 min | 5.60 |
| Acabado | 0.25 · t_soldadura | 6.40 |
| Pintura | 3.0784 m² · (4.0 preparación + 1 mano · 3.0) | 21.55 |
| Inspección y embalaje | 3.0 + 0.05 min/kg · 37.564 kg | 4.88 |
| **Total estándar** |  | **100.38** |

`t_real = t_estándar / η = 100.38 / 0.8 = 125.48 min = 2.0913 h`

**Paso 9 · Consumibles**

```text
A_cordón tope          = máx(2.0, 1.75·e²) = máx(2.0, 4.037) = 4.037 mm²
A_cordón filete        = máx(2.0, 1.00·e²) = máx(2.0, 2.307) = 2.307 mm²
A_cordón cierre de aro = máx(2.0, 1.75·t²) = máx(2.0, 39.701) = 39.701 mm²   (con el espesor t de la solera)
m_depositado           = (3.0000·4.037 + 1.9342·2.307) · 7.85 + 0.0762·39.701 · 7.85 = 130.11 + 23.75 = 153.86 g
Microalambre           = 153.86 / (1000 · 0.93) = 0.1654 kg  →  · 62.00 = 10.26 MXN
Gas de protección      = 10.25 min · 15 L/min · 1.10 / 1000 = 0.1691 m³  →  · 145.00 = 24.51 MXN
Consumibles de corte   = 7.9267 m · 0.30 = 2.38 MXN
Cobertura de pintura   = 10·55 / 50 = 11.0 m²/L teórica;  · 0.65 = 7.15 m²/L práctica
Pintura                = 3.0784 / 7.15 = 0.4305 L;  diluyente 10 % = 0.0431 L
Costo de pintura       = 0.4305 · 220 + 0.0431 · 70 = 97.73 MXN
```

**Paso 10 · Costo directo (CD)**

| Operación | t real (min) | MO (MXN/h) | Equipo (MXN/h) | Costo (MXN) |
| --- | --- | --- | --- | --- |
| Corte | 5.47 | 93.00 | 45 | 12.58 |
| Rolado | 5.64 | 96.88 | 55 | 14.27 |
| Armado y punteo | 17.50 | 100.75 | 25 | 36.68 |
| Aros de brida | 16.81 | 100.75 | 40 | 39.44 |
| Soldadura | 32.02 | 116.25 | 45 | 86.05 |
| Barrenado | 7.00 | 87.19 | 25 | 13.09 |
| Acabado | 8.00 | 87.19 | 20 | 14.30 |
| Pintura | 26.94 | 93.00 | 40 | 59.71 |
| Inspección y embalaje | 6.10 | 87.19 | 0 | 8.86 |

| Concepto | MXN |
| --- | --- |
| Lámina (37.455 kg brutos) | 824.02 |
| Perfil de aros | 68.64 |
| Tornillería | 37.80 |
| Empaque | 31.95 |
| Sellador | 8.90 |
| Flete de entrada (2 % de lámina + perfil) | 17.85 |
| **Subtotal materiales** | **989.15** |
| Alambre + gas + consumibles de corte + pintura | 134.88 |
| Mano de obra directa | 209.65 |
| Equipo (hora-máquina) | 75.33 |
| Herramienta menor (3 % de MO) | 6.29 |
| **COSTO DIRECTO (CD)** | **1,415.30** |

**Paso 11 · Pila de precio**

| Capa | Fórmula | MXN |
| --- | --- | --- |
| CD |  | 1,415.30 |
| CI de fábrica | GIF · h_MOD = 85.00 · 2.0913 | 177.76 |
| CI de administración | 8 % · CD | 113.22 |
| Imprevistos (riesgo MEDIO) | 4 % · (CD + CI) | 68.25 |
| **Costo total C_T** | CD + CI + imprevistos | **1,774.53** |
| Financiamiento | C_T · 14 % · 45/365 = C_T · 1.726 % | 30.63 |
| **Costo base** | C_T + financiamiento | **1,805.16** |
| **PRECIO antes de IVA** | C_base / (1 − 0.20 − 0.02) = 1,805.16 / 0.78 | **2,314.30** |
|   ↳ utilidad (20 % del precio) |  | 462.86 |
|   ↳ comisión de ventas (2 % del precio) |  | 46.29 |
| IVA 16 % |  | 370.29 |
| **Total con IVA** |  | **2,684.59** |

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Precio unitario antes de IVA | **2,314.30 MXN** |
| Peso neto terminado (lámina + aros) | 37.564 kg |
| Precio por kg neto | 61.61 MXN/kg |
| Precio por metro lineal | 771.43 MXN/m |
| Horas de mano de obra directa (reales) | 2.091 h |
| Margen de contribución (P − CD)/P | 38.8 % |
| Markup sobre costo total | 30.4 % |
| Costo de la merma en lámina | 2.996 kg · 22.00 = 65.92 MXN |

### 7.2 Ejemplo B — Codo de 90°, 5 gajos, Ø12", calibre 16 (el "factor" en acción)

Mismos maestros, mismo calibre, mismas bridas y primario que el Ejemplo A.

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

**Comparación contra el tramo recto del Ejemplo A** (mismos maestros; ambos con 2 bridas, primario, calibre 16)

| Concepto | Tramo recto 3 m | Codo 90° · 5 gajos |
| --- | --- | --- |
| Área neta de lámina (m²) | 2.8900 | 0.7001 |
| Merma φ | 8 % | 20 % |
| Lámina bruta (kg) | 37.455 | 10.435 |
| Peso neto terminado, con aros (kg) | 37.564 | 11.453 |
| Longitud de soldadura total (m) | 5.01 | 6.63 |
| Horas de MOD reales (h) | 2.09 | 3.61 |
| Costo directo CD (MXN) | 1,415.30 | 993.59 |
| Precio antes de IVA (MXN) | 2,314.30 | 1,871.42 |
| Precio por kg neto (MXN/kg) | 61.61 | 163.40 |
| Horas MOD por kg neto (h/kg) | 0.056 | 0.315 |

**Lectura:** el área del codo es sólo 1.3 % mayor que la de un tramo recto de igual longitud de eje (F_arco = 1.0131), pero su **precio por kg neto es 2.65×** el del tramo recto y su **costo directo por m² de lámina es 2.90×**. El sobrecosto no está en el área: está en la merma (20 % vs 8 %), en el corte perfilado, en el armado (k_dif = 1.35) y en la soldadura de 4 juntas elípticas.

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
| `sentido` | `MAYOR`: el injerto se inclina hacia el extremo mayor D1 (por omisión) |
| `lado` | `DER` (identifica la pieza; no cambia el costo) |
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
Largo mínimo de la reducción                = el menor L que aloja la silleta con 25 mm de holgura a cada extremo  →  L = 288.67 mm  (piso de 15°: 94.79 mm)
Cono: pendiente y semiángulo                = m = (R1 − R2) / L = 0.08799 ;  semiángulo = 5.03° ;  generatriz s = 289.79 mm
Cruce de ejes (silleta centrada en L/2)     = x_j = 284.80 mm   (el eje del injerto cruza el eje del cono; puede caer fuera del cono)
Silleta sobre el cono                       = x ∈ [25.00, 263.67] mm  →  holgura 25.00 mm a cada extremo
t(φ): generatriz φ del injerto toca el cono = raíz positiva de  a·t² + b·t + g = 0 ,  a = sin²β − m²·cos²β = 0.49613
t_med · t_max                               = 180.96 mm · 290.45 mm
L_ramal (injerto)                           = t_max + 150 = 440.45 mm   (generatriz más larga + tramo recto de maestros)
```

**Paso 3 · Área por pieza y área neta**

```text
A_cono     = π · (R1 + R2) · s = π · (153.159 + 127.759) · 289.79 = 0.25575 m²
A_orificio = ∮ G(x) dθ sobre la silleta (G' = r·√(1 + m²)) = 0.03036 m²
A_injerto  = π · d_med · (L_ramal − t_med) = π · 153.9189 · (440.45 − 180.96) = 0.12548 m²
A_neta     = A_cono − A_orificio + A_injerto = 0.35087 m²
```

**Paso 4 · Peso y merma (φ = 28 %)**

```text
m_neta          = A_neta · w_a = 0.35087 · 11.9235 = 4.184 kg
m_bruta         = m_neta / (1 − φ) = 4.184 / 0.72 = 5.811 kg
Costo de lámina = 5.811 · 22.00 = 127.83 MXN
```

**Paso 5 · Corte, soldadura y armado**

```text
P_h (perímetro de la silleta) = 639.91 mm   (suma de la polilínea de la silleta)
L_corte                       = [π·(D1_med + D2_med) + 2·s] + P_h + 2·(π·d_med + L_ramal) = 4.8326 m
Soldadura a tope              = s + (L_ramal − t_med) = 0.5493 m   (costura del cono + costura del injerto)
Soldadura de filete           = P_h = 0.6399 m   (silleta del injerto)
Piezas · juntas internas      = 2 (cono e injerto) · 1 (silleta)
Rolado equivalente            = n·k·L = 0.9041 m   (cono k = 1.6; injerto k = 1)
Bridas                        = 3 aros (D1, D2 y d): 1089.8 mm · 930.2 mm · 611.0 mm
```

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Costo directo (CD) | 737.20 MXN |
| Precio unitario antes de IVA | **1,382.76 MXN** |
| Peso neto terminado (lámina + 3 aros) | 7.932 kg |
| Precio por kg neto | 174.34 MXN/kg |
| Horas de mano de obra directa (reales) | 2.627 h  (k_dif armado = 1.9) |

**Sensibilidad** (misma pieza, un solo cambio)

| Variante | L reducción (mm) | Orificio (m²) | Precio (MXN) | vs. base |
| --- | --- | --- | --- | --- |
| Base: 45°, hacia el extremo mayor | 288.7 | 0.0304 | 1,382.76 | — |
| 30°, hacia el extremo mayor | 396.3 | 0.0440 | 1,483.87 | +7.3 % |
| 45°, hacia el extremo menor | 247.4 | 0.0249 | 1,342.74 | −2.9 % |

**Lectura:** el precio por kg neto es **2.83×** el del tramo recto del Ejemplo A, por lo mismo que el codo: merma de 28 % contra 8 %, dificultad de armado 1.9 contra 1.0 y tres bridas en una pieza chica. A 30° la silleta es más larga y el cono también; hacia el extremo menor el cono "se cierra" y la silleta resulta más corta. El lado (der/izq) no mueve ninguna cifra.

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
| `Maestros` | `version_id`, `vigente_desde`, tablas T1–T9, `precios` con proveedor/vigencia/moneda | Inmutable una vez usada en una cotización. |
| `Cotizacion` | `id`, cliente, proyecto, fecha, `vigencia_dias`, moneda, `riesgo_default`, `servicio_default`, `maestros_version_id`, estado | La vigencia protege contra la volatilidad del acero. |
| `Partida` | `cotizacion_id`, `n`, `familia`, parámetros (JSON de §2.1), `cantidad` | |
| `ResultadoPartida` | QTO, costos por capa, precio unitario e importe, indicadores, advertencias | Se puede recalcular con otra versión de precios sin tocar el QTO. |
| `Calibracion` | `partida_id`, horas reales por operación, kg bruto real, costo real, fecha | Alimenta el ajuste de φ, velocidades y `k_dif` (§10). |

### 8.2 Mapa de implementación de referencia

| Sección del documento | Archivo |
| --- | --- |
| Tablas maestras (T1–T9) | `src/datos/maestros.js` |
| Utilidades numéricas (Simpson, interpolación, parche de maestros) | `src/motor/util.js` |
| §3.1–3.4 Geometría por familia | `src/motor/geometria.js` |
| §3.3 y §3.5 Lámina, merma y herrajes | `src/motor/material.js` |
| §4.1 Tiempos y tarifas | `src/motor/mano_obra.js` |
| §4.3 Consumibles | `src/motor/consumibles.js` |
| §5 Valorización y pila de precio | `src/motor/precios.js` |
| §6 Orquestación y validación | `src/motor/cotizador.js` |
| Interfaz web (captura, desglose, editor de maestros, propuesta imprimible) | `src/web/` (`index.html`, `app.js`, `maestros_ui.js`, `esquemas.js`, `dom.js`, `estilos.css`) |
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
- **Pruebas de política:** separación cantidades/precios, identidades de la pila (`P·(1 − u − c − o) = C_base`), cargo mínimo, subcontratos, validaciones, uniones, materiales (`tests/motor.test.js`).
- **Estándar de bridas del taller** (`tests/motor.test.js`): la solera de 1½" × 3/16" pesa `b·t·ρ`; el taller usa la misma brida (barreno Ø3/8", tornillo 5/16" × 1¼") en todos los diámetros; `L_aro = π·(D_ext + b) + holgura`; nº de barrenos múltiplo de 4 por paso; cada aro se valoriza con el precio de su propio perfil y el tornillo con el suyo; el cierre del aro se suelda a tope al espesor de la solera; marco rectangular; y `ESPIGA` no genera aros ni barrenos.
- **Persistencia de maestros** (`tests/util.test.js`): `mezclar(base, diferencia(base, actual))` reconstruye lo editado y los valores de arranque nuevos no quedan enmascarados.
- **Guardado automático** (`tests/almacen.test.js` con un almacén de mentira, y las secciones 11–14 de `tests/e2e/ui.e2e.js` con un `window.claude` simulado cuyo almacén vive fuera del navegador): qué manda al abrir, una ráfaga de cambios = una escritura, una escritura a la vez, pendientes y reintentos, sólo lectura, cambios hechos durante la carga, y recuperación única de los precios de la versión 1.
- **Interfaz de extremo a extremo (opcional, Playwright):** `tests/e2e/ui.e2e.js` da de alta cada familia, edita y guarda cada partida **sin cambios** en tres combinaciones de unidades y exige que el precio no se mueva (el formulario no pierde datos), y recorre validaciones, subcontratos, tablas maestras, persistencia, guardar/cargar y pantalla móvil.

---

## 9. Verificación contra los criterios de calidad

| Criterio | Cumplimiento | Dónde |
| --- | --- | --- |
| ¿Están claramente definidas las fórmulas para convertir diámetros y longitudes en peso (kg) de lámina? | Sí: `D_med = D_int + e` → `B = π·D_med + a_costura` → `A_neta = B·L` → `m_neta = A_neta·ρ·e/1000` → `m_bruta = m_neta/(1 − φ)`; por familia para accesorios. | §3.1–3.4 · Pasos 1–4 del Ejemplo A |
| ¿Se incluyó la lógica para calcular bridas, tornillería y selladores? | Sí: aro de solera 1½" × 3/16" (estándar del taller) con longitud por centroide, barreno Ø3/8" y tornillo 5/16" × 1¼" como datos del perfil, nº de barrenos por paso con redondeo a múltiplos de 4, cierre del aro al espesor de la solera, empaque, sellador por clase SMACNA A/B/C, espiga y sus fijaciones. | §3.5 · Pasos 5–7 del Ejemplo A |
| ¿El ejemplo práctico se resuelve paso a paso sin saltarse factores de merma? | Sí: Paso 4 aplica φ = 8 % a la lámina y 5 % al perfil; sellador 15 %, tornillería 5 %, empaque 5 %, pintura por eficiencia de transferencia y gas por pre/post-flujo. | §7.1 |
| No asumir precios estáticos | Todos los precios son variables `precio_*` leídas de la tabla T3; ninguna fórmula contiene un precio. | §2.2 · §5 |
| Factor de merma obligatorio | `φ` por familia + override por partida + modo de anidado opcional. | §3.3 · T6 |
| Sin código extenso | Fórmulas y pseudocódigo; el código vive aparte en `src/`. | §6 |

---

## 10. Calibración, límites conocidos y siguientes pasos

### 10.1 Qué debe aportar la empresa para pasar de "ilustrativo" a "cotizable"

| Parámetro | Cómo obtenerlo | Frecuencia sugerida |
| --- | --- | --- |
| Precios `precio_*` | Cotización vigente de proveedor (lámina, perfil, gas, alambre, pintura, tornillería) | Semanal / por lote |
| Merma φ por familia | Pesar lámina comprada vs. pieza terminada en ≥ 10 lotes por familia | Trimestral |
| Velocidades de corte, rolado y soldadura | Cronometrar ≥ 5 piezas por calibre y proceso | Semestral |
| `FO`, `η_taller` | Muestreo de trabajo (tiempo de arco encendido vs. tiempo total) | Semestral |
| `k_dif` y merma por familia (en especial la reducción con injerto) | Horas reales y kg comprados por familia vs. estimados | Por familia |
| Salarios, FSR, `GIF_por_hora_MOD` | Nómina real y contabilidad de costos | Anual / trimestral |
| Tabla `servicios` (calibre mínimo) | Norma interna / SMACNA / ACGIH aplicable | Al adoptar la norma |
| Datos de detalle del estándar de bridas (paso entre barrenos, soldadura del aro, empaque, posición del barreno) | Confirmar con el taller los supuestos de §10.4 | Una vez, y al cambiar el estándar |

**Lazo de retroalimentación:** al cerrar cada orden se registran horas y kg reales (`Calibracion`); la desviación sistemática por operación o familia ajusta velocidades, φ y `k_dif`. Meta operativa: desviación de horas ≤ ±15 % y de peso bruto ≤ ±5 % por familia.

### 10.2 Límites conocidos (declarados, no ocultos)

- **Reducción con injerto:** la silleta se centra en el largo del cono y el cono es concéntrico; `merma` y `k_dif` son los del pantalón, ilustrativos, hasta calibrarlos (§10.5).
- **Transiciones:** sólo centradas; las excéntricas o en desfase se resuelven con `PERSONALIZADO` (área desarrollada desde CAD) o extendiendo la triangulación §3.4.3.
- **Ducto espiral, collarines, campanas, difusores:** no modelados; usar `PERSONALIZADO` o `COMPRADO`.
- **Anidado de hojas (modo B):** descrito en §3.3, no implementado; el motor usa φ de tabla.
- **Fuera de alcance:** instalación, soportería, flete a obra, andamios, ingeniería. Se cotizan como partidas `COMPRADO`/`PERSONALIZADO` o módulos aparte.
- **Valores ilustrativos:** ver §10.1. Hasta calibrarlos, el motor sirve para comparar alternativas y validar la lógica, no para fijar precios de venta.

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

El taller definió: *injerto simple* (antes ramal en ángulo); *reducción con injerto con el injerto sobre el cono, der. a 30° o 45°*; **todo injerto a 30° o 45°**; **codos de 30°, 45°, 60° y 90°**. Lo demás se **supuso** y se edita en los maestros o se captura en la partida:

| Supuesto | Valor usado | Dónde se cambia | Efecto si es distinto |
| --- | --- | --- | --- |
| Significado de «der» | Lado **derecho** del injerto; sólo identifica la pieza (no cambia el costo) | Campo `lado` de la partida | Si «der» quiere decir otra cosa (p. ej. *derivación*), indicar cuál: el campo se renombra sin tocar el cálculo. |
| Hacia dónde se inclina el injerto | Hacia el extremo **mayor** D1 (en colección de polvo el flujo sale por ahí) | Campo `sentido` de la partida | Hacia el menor: cono más corto y orificio ≈ 20 % menor (a 45°); el precio cambia ≈ 3 %. |
| Posición del injerto en el cono | Silleta centrada en el largo del cono | Geometría (§3.4.5) | Si el taller lo asienta más cerca de un extremo, cambia poco el área pero sí el largo mínimo. |
| Largo de la reducción | El menor que aloja la silleta con **25 mm** de holgura a cada extremo (piso: 15° de semiángulo) | `proceso.injerto_margen_cono_mm`, o capturar `L_reduccion_mm` | Un cono más largo suma lámina; uno más corto de lo necesario se rechaza. |
| Largo del injerto | Generatriz más larga + **150 mm** de tramo recto | `proceso.injerto_largo_extra_mm`, o capturar `L_ramal_mm` | Cambian lámina, corte y soldadura. |
| Merma y dificultad | 28 % y `k_dif` 1.9, heredados del pantalón | `merma.REDUCCION_INJERTO`, `proceso.armado.k_dif.REDUCCION_INJERTO` | Calibrar con 10 órdenes reales. |
| Gajos de los codos | Automáticos con α ≤ 22.5° por junta: 30° → 3, 45° → 3, 60° → 4, 90° → 5 | `proceso.alfa_max_junta_deg`, o capturar `n_gajos` | Si el codo de 30° lleva 2 gajos en el taller, capturar `n_gajos = 2`. |
