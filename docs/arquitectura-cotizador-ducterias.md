# Arquitectura del Cotizador Maestro de Ducterías

**COTIZAP · Especificación lógica, matemática y estructural · v1.0**

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
| **Brida / aro** | Anillo de ángulo soldado al extremo del ducto para unir con tornillos. |
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
| `familia` | enum | `RECTO` `CODO` `REDUCCION` `TRANSICION` `RAMAL` `PANTALON` `PERSONALIZADO` `COMPRADO` | — | Define la función geométrica. |
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
| `perfil_id` | texto | ver §2.2 (T4) | automático | Perfil de aro; por defecto se elige por diámetro. |

**Entradas geométricas por familia** (todas las dimensiones en mm; la interfaz convierte pulgadas)

| Familia | Entradas | Notas |
| --- | --- | --- |
| `RECTO` | redondo: `D_mm` · rectangular: `a_mm`, `b_mm` · `L_mm`, `tipo_costura` (`A_TOPE` `TRASLAPE` `PITTSBURGH`), `L_max_pieza_mm`, `n_costuras_long` | Se divide en `⌈L/L_max⌉` piezas iguales. |
| `CODO` | redondo: `D_mm`, `theta_deg` (90), `n_gajos` (auto), `k_R` (1.5), `L_tangente_mm` (0) · rectangular: `a_mm`, `b_mm`, `theta_deg`, `k_R` | `n_gajos` automático con α ≤ 22.5° por junta. |
| `REDUCCION` | `D1_mm`, `D2_mm`, `L_mm` (auto con semiángulo 15°), `excentrica` (`NO` `CARA_PLANA`) | |
| `TRANSICION` | `D_mm` (extremo redondo), `a_mm`, `b_mm` (extremo rectangular), `H_mm` (auto) | Centrada. |
| `RAMAL` | `D_mm`, `d_mm`, `L_cuerpo_mm`, `L_ramal_mm`, `beta_deg` (45) | `L_ramal` se mide sobre el eje del ramal desde el eje del cuerpo. |
| `PANTALON` | `D_mm`, `d1_mm`, `d2_mm`, `L_tronco_mm`, `L1_mm`, `L2_mm`, `k_entrepierna` | Y simétrica; aproximada (§3.4.5). |
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
| `precio_kg_alambre_er70s6` | MXN/kg | 62.00 |
| `precio_kg_varilla_er308l` | MXN/kg | 420.00 |
| `precio_kg_varilla_er316l` | MXN/kg | 520.00 |
| `precio_m3_gas_mezcla_ar_co2` | MXN/m³ | 145.00 |
| `precio_m3_gas_argon` | MXN/m³ | 190.00 |
| `precio_m_corte_guillotina` | MXN/m de corte | 0.30 |
| `precio_m_corte_plasma` | MXN/m de corte | 3.50 |
| `precio_m_corte_laser` | MXN/m de corte | 2.00 |
| `precio_m_empaque_neopreno` | MXN/m | 18.00 |
| `precio_cartucho_sellador_300ml` | MXN/cartucho 300 mL | 120.00 |
| `precio_pza_autotaladrante` | MXN/pza | 0.85 |
| `precio_juego_tornillo_m8` | MXN/juego (tornillo+tuerca+2 arandelas) | 5.00 |
| `precio_juego_tornillo_m10` | MXN/juego (tornillo+tuerca+2 arandelas) | 6.50 |
| `precio_juego_tornillo_m12` | MXN/juego (tornillo+tuerca+2 arandelas) | 9.50 |
| `precio_L_primario` | MXN/L | 220.00 |
| `precio_L_esmalte` | MXN/L | 260.00 |
| `precio_L_diluyente` | MXN/L | 70.00 |

**T4 · Perfiles de aros de brida** (el área, el peso lineal y el centroide se **derivan** de `ala` y `espesor`; no se capturan)

| `perfil_id` | Descripción | Área (mm²) | Peso (kg/m) | c centroide (mm) | Gramil g (mm) | Tornillo | Rango de D_ext (dimensión mayor) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `L25x3.2` | Ángulo 1" × 1" × 1/8" | 151.2 | 1.187 | 7.51 | 14.0 | M8 | 0–150 mm |
| `L38x3.2` | Ángulo 1½" × 1½" × 1/8" | 231.9 | 1.820 | 10.70 | 22.0 | M10 | 150–450 mm |
| `L38x4.8` | Ángulo 1½" × 1½" × 3/16" | 340.3 | 2.671 | 11.27 | 22.0 | M10 | 450–900 mm |
| `L51x4.8` | Ángulo 2" × 2" × 3/16" | 461.2 | 3.621 | 14.46 | 29.0 | M10 | 900–1500 mm |
| `L64x6.4` | Ángulo 2½" × 2½" × 1/4" | 766.1 | 6.014 | 18.21 | 35.0 | M12 | > 1500 mm |

**T5 · Uniones**

| Parámetro | `BRIDADO` | `ESPIGA` | `LISO` |
| --- | --- | --- | --- |
| Elemento principal | aro de ángulo por extremo | prolongación macho `prof_espiga_mm` = 60 | — |
| Fijación | tornillo + tuerca + 2 arandelas; paso máx. 150 mm; mín. 4; múltiplo de 4 | autotaladrante; paso máx. 150 mm; mín. 4 | — |
| Reserva de herraje | 5 % | 5 % | — |
| Empaque | sí (traslape 5 %) | no | no |
| Soldadura de aro | filete continuo (`f_cont` = 1.0) | — | — |

**T6 · Merma y dificultad por familia** (φ = fracción del material comprado que no queda en la pieza)

| Familia | φ por defecto | Rango típico de taller | `k_dif` (armado) |
| --- | --- | --- | --- |
| `RECTO` | 8 % | 5–10 % | 1.00 |
| `CODO` | 20 % | 15–25 % | 1.35 |
| `REDUCCION` | 18 % | 15–20 % | 1.20 |
| `TRANSICION` | 22 % | 20–25 % | 1.50 |
| `RAMAL` | 25 % | 20–30 % | 1.60 |
| `PANTALON` | 28 % | 25–30 % | 1.90 |
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
| V5 | Ramal: `d < D`; 20° ≤ β ≤ 90°; `L_ramal > t_max`; cuerpo suficiente para el orificio | Error / advertencia |
| V6 | Pantalón: `d1² + d2²` dentro de ±15 % de `D²` (conservación de sección) | Advertencia |
| V7 | Codo: `n_gajos ≥ 2`, `R/D ≥ 1.0` | Error |
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

La merma φ absorbe **todo** lo que se compra y no queda en la pieza: retazos de la hoja, recortes de ingletes, la caída del orificio de un ramal y el *kerf*. Defaults en T6; el rango típico de taller para accesorios es 15–25 %.

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

| θ | Gajos | α por junta | **F_arco** | λ (R/D=1.5) | A/D² (R/D=1.5) | λ (R/D=2.0) | A/D² (R/D=2.0) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 90° | 3 | 45.00° | 1.05479 | 2.48528 | 7.8077 | 3.31371 | 10.4103 |
| 90° | 4 | 30.00° | 1.02349 | 2.41154 | 7.5761 | 3.21539 | 10.1014 |
| 90° | 5 | 22.50° | 1.01305 | 2.38695 | 7.4988 | 3.18260 | 9.9984 |
| 90° | 7 | 15.00° | 1.00575 | 2.36974 | 7.4448 | 3.15966 | 9.9264 |
| 60° | 4 | 20.00° | 1.01028 | 1.58694 | 4.9855 | 2.11592 | 6.6474 |
| 45° | 3 | 22.50° | 1.01305 | 1.19347 | 3.7494 | 1.59130 | 4.9992 |
| 30° | 3 | 15.00° | 1.00575 | 0.78991 | 2.4816 | 1.05322 | 3.3088 |

> **Respuesta al campo `[COMPLETAR: Factor sugerido]`:** codo de 90° de 5 gajos, R/D = 1.5 → **`Área codo = Área tramo recto(L = π/2·R) × 1.0131`**, equivalente a `A = 7.4988·D²`. El codo liso de radio (prensado) vale exactamente `F = 1.0000` por el teorema de Pappus: `A = π·D_med·θ·R`.

> **No confundir el factor geométrico con el factor de costo.** Un codo de 5 gajos sólo tiene ~1.3 % más lámina que su tramo recto equivalente, pero cuesta ≈ 2.6× más **por kg**. Ese sobrecosto sale de la merma (20 % vs 8 %), del corte perfilado, del armado (`k_dif`) y de la soldadura de `j` juntas elípticas, y se modela allí (§4), no inflando el área. El Ejemplo B lo cuantifica.

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

#### 3.4.4 Ramal en ángulo (lateral / te)

Ramal de diámetro `d` que entra a un cuerpo de diámetro `D` con ángulo β entre ejes (90° = te; 30°–45° = lateral típico en colección de polvo; confirmar contra la norma que aplique).

```text
k      = d_med / D_med   (< 1)
t_med  = (D_med / (2·sinβ)) · (2/π)·E(k)          # distancia media, sobre el eje del ramal, del eje del cuerpo a la silleta
       ≈ (D_med / (2·sinβ)) · (1 − k²/4 − 3k⁴/64) # error < 0.04 % si k ≤ 0.5 ; < 0.7 % si k ≤ 0.75
t_max  = (D_med/2 + (d_med/2)·cosβ) / sinβ        # el ramal debe medir más que t_max
A_ramal    = π·d_med·(L_ramal − t_med)
A_orificio = (π·(d_med/2)² / sinβ) · K(k) ,   K(k) = 1 + k²/8 + 3k⁴/64 + …    # 1.02 – 1.09 para k = 0.4 – 0.75
A_neta     = π·D_med·L_cuerpo − A_orificio + A_ramal
```

`E(k)` es la integral elíptica completa de 2.ª especie: `(2/π)·E(k)` = promedio angular de `√(1 − k²·sin²φ)`. La caída del orificio es chatarra y la cubre la merma de la familia (25 %): `A_neta` ya la descuenta (así el peso neto es el de la pieza terminada) y `m_bruta = m_neta/(1 − φ)` la repone como merma.

#### 3.4.5 Pantalón (Y simétrica)

La intersección de dos ramales con el tronco no tiene forma cerrada manejable; se modela como composición de primitivas con un factor de entrepierna a **calibrar**:

```text
A_neta = π·D_med·L_tronco + (1 + k_ent)·π·( d1_med·L1 + d2_med·L2 )          # k_ent = 0.08 (inicial)
Control: d1² + d2² ≈ D²  (±15 %)  →  conserva la sección del tronco
```

Precisión esperada ±10 %: calibrar `k_ent` desarrollando 5–10 pantalones reales en el CAD del taller (§10). El motor lo marca con advertencia permanente.

#### 3.4.6 Resumen de multiplicadores por familia

| Familia | Área neta | Multiplicador vs. recto equivalente | φ merma | `k_dif` |
| --- | --- | --- | --- | --- |
| Recto | `B·L` | 1.0000 | 8 % | 1.00 |
| Codo 90°, 5 gajos, R/D 1.5 | `π·D_med·L_eje` = 7.4988·D² | **F_arco = 1.0131** | 20 % | 1.35 |
| Codo liso (radio) | `π·D_med·θ·R` | 1.0000 (Pappus) | — | — |
| Reducción concéntrica (15°) | `π/2·(D1+D2)·s` | sec 15° = 1.0353 | 18 % | 1.20 |
| Reducción excéntrica (cara plana) | integral §3.4.2 | +0.2 % … +4 % sobre concéntrica | 18 % | 1.20 |
| Transición redondo→rect. | triangulación §3.4.3 | ≈ ½(P₁+P₂)·s (±3 %) | 22 % | 1.50 |
| Ramal 45° | cuerpo − orificio + ramal | `A_ramal = π·d·(L − t_med)` | 25 % | 1.60 |
| Pantalón | compuesto + `k_ent` | ±10 % (calibrar) | 28 % | 1.90 |

### 3.5 Herrajes de unión: bridas, tornillería, empaque, sellador y espiga

#### 3.5.1 Aros de brida (perfil de ángulo rolado "por el canto")

```text
c     = (ala·esp + ala² − esp²) / ( 2·(2·ala − esp) )      # centroide medido desde el dorso del ángulo, mm
w_p   = esp·(2·ala − esp)·7.85 / 1000                       # peso lineal, kg/m
L_aro = π·(D_ext + 2c) + holgura_corte                      # longitud de barra por aro, mm (fibra neutra ≈ centroide)
m_aros_neta  = Σ_aros (L_aro/1000)·w_p
m_aros_bruta = m_aros_neta / (1 − φ_perfil)                 # φ_perfil = 5 % (retazos de barra de 6 m)

Marco rectangular:  L_marco = 2·(a_ext + b_ext) + 8c + 4·holgura_corte
```

Despreciar `c` acortaría cada aro ≈ 6.5 % (≈ 67 mm en un Ø12"): el aro no cerraría sobre el ducto.

#### 3.5.2 Tornillería

```text
D_bc        = D_ext + 2·g                                   # círculo de tornillos; g = gramil del perfil (T4)
n_tornillos = múltiplo_de_4_hacia_arriba( máx( n_mín , ⌈ π·D_bc / paso_máx ⌉ ) )     # por junta
n_juntas_asignadas = 0.5 · n_extremos_bridados              # cada junta se comparte entre dos piezas
juegos      = Σ_extremos 0.5·n_tornillos · (1 + f_reserva)  # juego = tornillo + tuerca + 2 arandelas
n_barrenos  = Σ_extremos n_tornillos                        # cada brida lleva sus barrenos
Marco rectangular:  P_perno = 2·(a_ext + b_ext) + 8·g
```

#### 3.5.3 Soldadura de aros

```text
L_filete_aro = Σ_extremos f_cont · P_ext            # P_ext = π·D_ext ; f_cont = 1.0 (continuo, hermético)
L_cierre_aro = Σ_extremos 2·ala                     # costura de cierre del aro (rect.: 4 esquinas × 2·ala)
```

#### 3.5.4 Empaque

```text
L_empaque = Σ_extremos 0.5 · P_perno · (1 + f_traslape)          # m, una sola cinta por junta
```

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
Soldadura    t_arco = L_sold / ( v_sold(e) · v_mult(proceso) )                  # min con arco encendido
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
| Ramal | 2 | `2·(B_c + L_c) + P_h + 2·(π·d_med + L_r)` | `L_c + (L_r − t_med)` | `P_h` | 1 |
| Pantalón | 3 | `2·(π·D_med + L_t) + 2·(π·d1_med + L1) + 2·(π·d2_med + L2) + π·(d1_med + d2_med)` | `L_t + L1 + L2` | `π·(d1_med + d2_med)` | 2 |

`P_h = π·d_med·√((1 + csc²β)/2)` es el perímetro del orificio elíptico del ramal.

### 4.3 Consumibles

```text
A_cordón     = máx( A_mín , k_cordón · e² )                  # mm²   k_tope = 1.75 ; k_filete = 1.00 ; A_mín = 2.0
m_depositado = Σ_j L_j[m] · A_cordón_j[mm²] · ρ_dep[g/cm³]   # g   (1 m · 1 mm² = 1 cm³)
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

Materiales  = m_bruta·precio_kg_<material> − crédito_chatarra + m_aros_bruta·precio_kg_perfil
              + juegos·precio_juego_tornillo + L_empaque·precio_m_empaque + V_sellador·precio_mL_sellador
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

Los CI de fábrica se absorben **por hora de mano de obra**, no como % plano del CD: así una pieza con mucha mano de obra (pantalón) carga más indirecto que una de mucho material (tramo recto). El imprevisto se calcula sobre CD + CI (lo que está en riesgo), y el financiamiento sobre el costo total (lo que se adelanta).

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

**Paso 5 · Aros de brida** (perfil `L38x3.2`: D_ext = 307.8 mm ≤ 450 mm)

```text
c (centroide del ángulo) = (ala·esp + ala² − esp²) / (2·(2·ala − esp)) = 10.698 mm
w_p (peso lineal)        = esp·(2·ala − esp)·7.85 / 1000 = 1.8201 kg/m
L_aro                    = π·(D_ext + 2c) + 3.0 = π·(307.8378 + 21.397) + 3.0 = 1037.32 mm
m_aros_neta              = 2 · 1.0373 m · 1.8201 kg/m = 3.776 kg
m_aros_bruta             = m_aros_neta / (1 − 0.05) = 3.975 kg
Costo de perfil          = 3.975 · 21.50 = 85.46 MXN
```

**Paso 6 · Tornillería, empaque y sellador**

```text
D_bc (círculo de tornillos) = D_ext + 2g = 307.8378 + 2·22 = 351.838 mm  →  π·D_bc = 1105.33 mm
n_tornillos por junta       = ⌈1105.33 / 150⌉ = 8  →  múltiplo de 4 ≥ máx(4, 8) = 8
n_juntas_asignadas          = 2 extremos · 0.5 = 1.0
Juegos de tornillería       = 8 · 1.05 (reserva) = 8.4  →  · 6.50 = 54.60 MXN
n_barrenos                  = 2 aros · 8 = 16
L_empaque                   = 1 junta · 1105.33 mm · 1.05 / 1000 = 1.1606 m  →  · 18.00 = 20.89 MXN
L_sellado (clase C)         = 1 junta · π·D_ext / 1000 = 0.9671 m
V_sellador                  = 0.9671 m · 20 mL/m · 1.15 = 22.24 mL  →  · (120.00 / 300) = 8.90 MXN
```

**Paso 7 · Longitudes de proceso**

```text
L_corte              = 2·(B + L) / 1000 = 2·(963.329 + 3 000) / 1000 = 7.9267 m
L_soldadura (tope)   = costura longitudinal 3.0000 + cierre de aros 2·(2·ala)/1000 = 0.1524  →  3.1524 m
L_soldadura (filete) = aro-ducto 2·π·D_ext / 1000 = 1.9342 m
L_soldadura total    = 5.0866 m
A_pintura            = π·D_ext·L + 2 aros·(caras + canto) = 3.0746 m²
```

**Paso 8 · Tiempos estándar por operación** (η_taller = 0.8)

| Operación | Cálculo | t estándar (min) |
| --- | --- | --- |
| Corte (guillotina) | 0.8455 hojas · 4.0 min + 7.927 m / 7.975 m/min | 4.38 |
| Rolado | 1 virola · (3.0 + 3 pasadas · 3.0 m / 5.962 m/min) | 4.51 |
| Armado y punteo | 1 pieza · 6.0 + 2 aros · 4.0 | 14.00 |
| Aros de brida | 2 · (4.0 + 2.5 min/m · 1.0373 m) | 13.19 |
| Soldadura | t_arco = 5.087 m / 0.497 m/min = 10.24 min;  ÷ FO (0.4) | 25.59 |
| Barrenado | 16 barrenos · 0.35 min | 5.60 |
| Acabado | 0.25 · t_soldadura | 6.40 |
| Pintura | 3.0746 m² · (4.0 preparación + 1 mano · 3.0) | 21.52 |
| Inspección y embalaje | 3.0 + 0.05 min/kg · 38.235 kg | 4.91 |
| **Total estándar** |  | **100.09** |

`t_real = t_estándar / η = 100.09 / 0.8 = 125.11 min = 2.0852 h`

**Paso 9 · Consumibles**

```text
A_cordón tope        = máx(2.0, 1.75·e²) = máx(2.0, 4.037) = 4.037 mm²
A_cordón filete      = máx(2.0, 1.00·e²) = máx(2.0, 2.307) = 2.307 mm²
m_depositado         = (3.1524 · 4.037 + 1.9342 · 2.307) · 7.85 = 134.94 g
Microalambre         = 134.94 / (1000 · 0.93) = 0.1451 kg  →  · 62.00 = 9.00 MXN
Gas de protección    = 10.24 min · 15 L/min · 1.10 / 1000 = 0.1689 m³  →  · 145.00 = 24.49 MXN
Consumibles de corte = 7.9267 m · 0.30 = 2.38 MXN
Cobertura de pintura = 10·55 / 50 = 11.0 m²/L teórica;  · 0.65 = 7.15 m²/L práctica
Pintura              = 3.0746 / 7.15 = 0.4300 L;  diluyente 10 % = 0.0430 L
Costo de pintura     = 0.4300 · 220 + 0.0430 · 70 = 97.61 MXN
```

**Paso 10 · Costo directo (CD)**

| Operación | t real (min) | MO (MXN/h) | Equipo (MXN/h) | Costo (MXN) |
| --- | --- | --- | --- | --- |
| Corte | 5.47 | 93.00 | 45 | 12.58 |
| Rolado | 5.64 | 96.88 | 55 | 14.27 |
| Armado y punteo | 17.50 | 100.75 | 25 | 36.68 |
| Aros de brida | 16.48 | 100.75 | 40 | 38.67 |
| Soldadura | 31.98 | 116.25 | 45 | 85.96 |
| Barrenado | 7.00 | 87.19 | 25 | 13.09 |
| Acabado | 8.00 | 87.19 | 20 | 14.28 |
| Pintura | 26.90 | 93.00 | 40 | 59.63 |
| Inspección y embalaje | 6.14 | 87.19 | 0 | 8.92 |

| Concepto | MXN |
| --- | --- |
| Lámina (37.455 kg brutos) | 824.02 |
| Perfil de aros | 85.46 |
| Tornillería | 54.60 |
| Empaque | 20.89 |
| Sellador | 8.90 |
| Flete de entrada (2 % de lámina + perfil) | 18.19 |
| **Subtotal materiales** | **1,012.05** |
| Alambre + gas + consumibles de corte + pintura | 133.47 |
| Mano de obra directa | 209.03 |
| Equipo (hora-máquina) | 75.06 |
| Herramienta menor (3 % de MO) | 6.27 |
| **COSTO DIRECTO (CD)** | **1,435.88** |

**Paso 11 · Pila de precio**

| Capa | Fórmula | MXN |
| --- | --- | --- |
| CD |  | 1,435.88 |
| CI de fábrica | GIF · h_MOD = 85.00 · 2.0852 | 177.24 |
| CI de administración | 8 % · CD | 114.87 |
| Imprevistos (riesgo MEDIO) | 4 % · (CD + CI) | 69.12 |
| **Costo total C_T** | CD + CI + imprevistos | **1,797.11** |
| Financiamiento | C_T · 14 % · 45/365 = C_T · 1.726 % | 31.02 |
| **Costo base** | C_T + financiamiento | **1,828.13** |
| **PRECIO antes de IVA** | C_base / (1 − 0.20 − 0.02) = 1,828.13 / 0.78 | **2,343.75** |
|   ↳ utilidad (20 % del precio) |  | 468.75 |
|   ↳ comisión de ventas (2 % del precio) |  | 46.88 |
| IVA 16 % |  | 375.00 |
| **Total con IVA** |  | **2,718.75** |

**Resultado e indicadores de control**

| Indicador | Valor |
| --- | --- |
| Precio unitario antes de IVA | **2,343.75 MXN** |
| Peso neto terminado (lámina + aros) | 38.235 kg |
| Precio por kg neto | 61.30 MXN/kg |
| Precio por metro lineal | 781.25 MXN/m |
| Horas de mano de obra directa (reales) | 2.085 h |
| Margen de contribución (P − CD)/P | 38.7 % |
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
| Peso neto terminado, con aros (kg) | 38.235 | 12.124 |
| Longitud de soldadura total (m) | 5.09 | 6.70 |
| Horas de MOD reales (h) | 2.09 | 3.60 |
| Costo directo CD (MXN) | 1,435.88 | 1,014.17 |
| Precio antes de IVA (MXN) | 2,343.75 | 1,900.87 |
| Precio por kg neto (MXN/kg) | 61.30 | 156.79 |
| Horas MOD por kg neto (h/kg) | 0.055 | 0.297 |

**Lectura:** el área del codo es sólo 1.3 % mayor que la de un tramo recto de igual longitud de eje (F_arco = 1.0131), pero su **precio por kg neto es 2.56×** el del tramo recto y su **costo directo por m² de lámina es 2.92×**. El sobrecosto no está en el área: está en la merma (20 % vs 8 %), en el corte perfilado, en el armado (k_dif = 1.35) y en la soldadura de 4 juntas elípticas.

---

## 8. Arquitectura de datos, módulos y plataformas

### 8.1 Modelo de datos

Modelo lógico recomendado. La aplicación de referencia (`src/web/`) guarda las cotizaciones y los maestros editados en el navegador (`localStorage`) y exporta/importa JSON; un despliegue multiusuario debe llevar este modelo a una base de datos.

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
| Utilidades numéricas (Simpson, interpolación) | `src/motor/util.js` |
| §3.1–3.4 Geometría por familia | `src/motor/geometria.js` |
| §3.3 y §3.5 Lámina, merma y herrajes | `src/motor/material.js` |
| §4.1 Tiempos y tarifas | `src/motor/mano_obra.js` |
| §4.3 Consumibles | `src/motor/consumibles.js` |
| §5 Valorización y pila de precio | `src/motor/precios.js` |
| §6 Orquestación y validación | `src/motor/cotizador.js` |
| Interfaz web (captura, desglose, editor de maestros, propuesta imprimible) | `src/web/` (`index.html`, `app.js`, `maestros_ui.js`, `esquemas.js`, `dom.js`, `estilos.css`) |
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
- **Oráculos geométricos independientes:** codo, reducción excéntrica, transición y ramal se comparan contra mallas 3D y promedios numéricos de fuerza bruta (`tests/geometria.test.js`). **Toda familia nueva debe traer su oráculo independiente.**
- **Pruebas de política:** separación cantidades/precios, identidades de la pila (`P·(1 − u − c − o) = C_base`), cargo mínimo, subcontratos, validaciones, uniones, materiales (`tests/motor.test.js`).
- **Interfaz de extremo a extremo (opcional, Playwright):** `tests/e2e/ui.e2e.js` da de alta cada familia, edita y guarda cada partida **sin cambios** en tres combinaciones de unidades y exige que el precio no se mueva (el formulario no pierde datos), y recorre validaciones, subcontratos, tablas maestras, persistencia, guardar/cargar y pantalla móvil.

---

## 9. Verificación contra los criterios de calidad

| Criterio | Cumplimiento | Dónde |
| --- | --- | --- |
| ¿Están claramente definidas las fórmulas para convertir diámetros y longitudes en peso (kg) de lámina? | Sí: `D_med = D_int + e` → `B = π·D_med + a_costura` → `A_neta = B·L` → `m_neta = A_neta·ρ·e/1000` → `m_bruta = m_neta/(1 − φ)`; por familia para accesorios. | §3.1–3.4 · Pasos 1–4 del Ejemplo A |
| ¿Se incluyó la lógica para calcular bridas, tornillería y selladores? | Sí: longitud de aro por centroide, perfil por diámetro, nº de tornillos por paso con redondeo a múltiplos de 4, empaque, sellador por clase SMACNA A/B/C, espiga y sus fijaciones. | §3.5 · Pasos 5–6 del Ejemplo A |
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
| `k_dif`, `k_entrepierna` | Horas reales por familia vs. horas estimadas | Por familia |
| Salarios, FSR, `GIF_por_hora_MOD` | Nómina real y contabilidad de costos | Anual / trimestral |
| Tabla `servicios` (calibre mínimo) | Norma interna / SMACNA / ACGIH aplicable | Al adoptar la norma |
| Selección de perfil y gramiles | Estándar de bridas del taller | Al adoptar el estándar |

**Lazo de retroalimentación:** al cerrar cada orden se registran horas y kg reales (`Calibracion`); la desviación sistemática por operación o familia ajusta velocidades, φ y `k_dif`. Meta operativa: desviación de horas ≤ ±15 % y de peso bruto ≤ ±5 % por familia.

### 10.2 Límites conocidos (declarados, no ocultos)

- **Pantalón:** geometría aproximada (±10 %) hasta calibrar `k_ent` con desarrollos reales.
- **Transiciones:** sólo centradas; las excéntricas o en desfase se resuelven con `PERSONALIZADO` (área desarrollada desde CAD) o extendiendo la triangulación §3.4.3.
- **Ducto espiral, collarines, campanas, difusores:** no modelados; usar `PERSONALIZADO` o `COMPRADO`.
- **Anidado de hojas (modo B):** descrito en §3.3, no implementado; el motor usa φ de tabla.
- **Fuera de alcance:** instalación, soportería, flete a obra, andamios, ingeniería. Se cotizan como partidas `COMPRADO`/`PERSONALIZADO` o módulos aparte.
- **Valores ilustrativos:** ver §10.1. Hasta calibrarlos, el motor sirve para comparar alternativas y validar la lógica, no para fijar precios de venta.

### 10.3 Siguientes pasos recomendados

1. Capturar precios, tarifas y velocidades reales (tabla §10.1) y regenerar el vector de referencia.
2. Calibrar `k_dif` y `k_entrepierna` con 10 órdenes reales.
3. Importar áreas desarrolladas desde DXF/CAD hacia `PERSONALIZADO`.
4. Implementar el modo de anidado de hoja (§3.3) cuando exista el layout real.
5. Conectar `Calibracion` al cierre de órdenes de producción.
