# Conjunto de evaluación de la lectura de unifilares

Sirve para medir qué tan bien lee Claude los croquis del taller antes de confiar en sus despieces ([`docs/vision-unifilares.md`](../vision-unifilares.md) §12). Se arma con croquis **reales**: de 30 a 50, tal como llegan (a mano, con sombras, en isométrico y en planta).

## Una carpeta por croquis

```text
docs/evaluacion/<nombre>/
  foto.jpg         la foto (opcional, como referencia)
  obtenida.json    lo que leyó Claude
  esperada.json    la lectura correcta
```

1. En la versión publicada de COTIZAP, **Cotización detallada → Importar unifilar → Escoger la foto**. Cuando termine, **Copiar la lectura de Claude** y guárdela como `obtenida.json`. Ésa es la lectura cruda, sin respuestas.
2. Responda todas las preguntas y corrija lo que esté mal. Para corregir algo que no se pregunta, edite el JSON en «Otra lectura» y vuelva a leerlo. Luego **Copiar el despiece en JSON** y guárdelo como `esperada.json`. Las respuestas quedan como `origen: USUARIO` y son la verdad.
3. La corrección se hace sobre la misma lectura, así que las coordenadas de las dos están en el mismo marco y los nodos se emparejan por cercanía (a menos de 2 % de la diagonal de la hoja).

## Correrlo

```bash
npm run evaluar:unifilares            # docs/evaluacion
npm run evaluar:unifilares -- otra/carpeta
```

Por croquis da:

| Métrica | Qué mide |
| --- | --- |
| Nodos F1 · Aristas F1 | La topología leída. |
| Ø · Cotas | De las aristas emparejadas que traen valor en la esperada, cuántas se leyeron igual. Las cotas valen a ±2 %. |
| Accesorios | Cuántos accesorios del despiece esperado salen iguales (tipo y ángulo) en el obtenido. |
| Costo directo | La diferencia del costo directo de los dos despieces, sin respuestas. |
| Errores silenciosos | Un Ø o una cota mal leídos con confianza ≥ 0.9: no se avisan, así que nadie los revisa. |

También da cuántos croquis cumplen cada meta. La meta para usar la lectura en cotizaciones preliminares es tener el costo dentro de ±5 % en el 90 % de los croquis, ningún error silencioso y las demás métricas según la tabla de §12.

`ejemplo-perturbado/` es un caso **inventado** para ver cómo sale el reporte. Se armó a partir del ejemplo del documento con tres errores típicos: el Ø6 del ramal leído 8 con seguridad, que es un error silencioso; una cota de 3.8 m en vez de 3.6 m; y la campana un poco corrida. No cuenta como evaluación.
