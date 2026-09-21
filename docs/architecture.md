# Arquitectura MVP v0.1

## Flujo

1. **Ingesta:** recibe una exportación local o un archivo de prueba.
2. **Validación:** revisa estructura, tipos y valores mínimos.
3. **Normalización:** convierte los datos al contrato canónico R-POS.
4. **Persistencia:** conserva únicamente el resultado autorizado.
5. **Publicación:** prepara métricas para Notion o Control Tower.

## Capas previstas

- `samsung-health/`: adaptador de origen Android/exportación.
- `app/`: orquestación y reglas de normalización.
- `rpos/`: contratos de salida para R-POS.
- `scripts/`: validación y tareas operativas.

## Decisiones de diseño

- El modelo canónico no depende del formato de un proveedor.
- Cada registro incluye `source` y `recorded_at`.
- Los datos crudos no deben versionarse en Git.
- La salida hacia Notion se mantiene desacoplada del proceso de ingesta.

## Fases siguientes

1. Confirmar el método autorizado de extracción en el dispositivo Samsung.
2. Crear el adaptador Android/Health Connect o de exportación seleccionado.
3. Definir mapeo con las bases R-POS en Notion.
4. Añadir sincronización incremental, bitácora y manejo de errores.
