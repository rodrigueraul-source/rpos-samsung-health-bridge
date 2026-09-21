# Modelo canónico R-POS Health Record

Cada registro representa una observación o agregado de bienestar.

| Campo | Tipo | Uso |
|---|---|---|
| `schema_version` | texto | Versión del contrato |
| `record_id` | texto | Identificador único no sensible |
| `metric_type` | texto | `steps`, `sleep`, `exercise`, `heart_rate` o `weight` |
| `value` | número | Valor principal |
| `unit` | texto | Unidad del valor |
| `recorded_at` | fecha/hora | Momento de la medición en ISO 8601 |
| `source` | texto | Sistema que originó el registro |
| `quality` | texto | `measured`, `estimated` o `manual` |
| `metadata` | objeto | Contexto adicional no sensible |

## Reglas

- No incluir nombre, correo, teléfono o ubicación precisa.
- Usar fechas con zona horaria.
- No mezclar unidades para una misma métrica sin conversión explícita.
- Mantener `schema_version` para cambios controlados.
