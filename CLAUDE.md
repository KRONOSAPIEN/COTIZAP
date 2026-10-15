# Flujo de trabajo con agentes

## Modelos por etapa
- La sesión principal (Opus 5.5, con ultracode) planea, reparte el trabajo e integra los resultados.
- Escaneo de solo lectura (buscar, leer, inventariar, verificar): subagente `escaneo` (Haiku 5.5).
- Edición: subagente `edicion` (Sonnet 5.5), cada encargo en su propia copia aislada (worktree).
- En un workflow vale lo mismo: cada etapa de escaneo usa `escaneo` y cada etapa de edición usa `edicion`.

## Verificación de hallazgos
- Cada hallazgo necesita un verificador independiente antes de reportarse.
- El verificador es otra instancia de `escaneo`, que no encontró el hallazgo. Recibe sólo la afirmación y su archivo:línea, no el razonamiento de quien lo encontró, y la confirma o la rechaza con evidencia propia.
- Sólo se reporta lo confirmado. Lo que el verificador no pudo comprobar va aparte como «no verificado», nunca como confirmado ni como descartado.

## Bucles de corrección
- Un bucle de corrección (corregir y volver a revisar) se detiene después de dos rondas seguidas sin progreso.
- Hay progreso cuando bajan, respecto de la ronda anterior, las verificaciones que fallan o los hallazgos abiertos.
- Al detenerse, se reporta lo que sigue abierto y por qué no se pudo corregir.

## Decisiones deterministas con JEV
- Donde JEV esté conectado como herramienta, las bifurcaciones deterministas simples pasan por él: qué herramienta usar, qué ruta o archivo tomar y si reintentar.
- Si JEV no está conectado en la sesión, se decide como de costumbre.
