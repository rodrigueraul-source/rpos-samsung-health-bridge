# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Objetivo del MVP v0.1

Convertir exportaciones de Samsung Health en un modelo normalizado que pueda alimentar R-POS y, posteriormente, su Control Tower.

```text
Samsung Health / export -> ingest -> validate + normalize -> R-POS JSON -> Notion / Control Tower
```

## Alcance inicial

- pasos diarios;
- sueño;
- sesiones de ejercicio;
- frecuencia cardiaca;
- peso;
- trazabilidad del origen y fecha de sincronización.

El MVP usa archivos JSON de ejemplo para validar el modelo sin depender todavía de credenciales, APIs móviles o automatizaciones externas.

## Validación

Requiere Python 3.11 o superior.

```bash
python scripts/validate_sample.py
python -m unittest discover -s tests
```

## Gobernanza

- No guardar credenciales ni datos reales de salud en el repositorio.
- Separar datos crudos y normalizados.
- Mantener fuente y momento de captura.
- Aplicar revisión humana antes de usar recomendaciones de salud.

## Estado

**BUILD · 83.33% · 5 de 6 hitos verificados · hito 6 PAUSADO** (corte documental 11-Oct-2026).

La rama `main` conserva el MVP inicial Python; **no representa el código Android
operativo vigente**. La adquisición y la entrega asistida se desarrollan en
[`bridge/android-acquisition-v0.2`](../../tree/bridge/android-acquisition-v0.2),
con evidencia resumida en
[`docs/progress-evidence.md`](../../blob/bridge/android-acquisition-v0.2/docs/progress-evidence.md).

El 08-Oct, Notion (R-POS Program Registry + Implementation Log) aceptó el
**hito 5** por recuperación productiva de respuesta incierta, continuidad
tras reinicio de teléfono reportado y readback sin sesiones duplicadas.
El hito 6 (errores físicos Samsung y cierre repetible de release) se
**difirió el 08-Oct 23:21 CDMX** porque no bloquea la webapp ni la operación
asistida; el siguiente foco de desarrollo aprobado es **Coach Digital**.
No solicitar nuevas pruebas o reinstalaciones para el hito pausado salvo
regresión crítica o nueva instrucción.

El 11-Oct la pantalla Android v0.7 mostró `READ PASS · 75 records` y
`confirmed:4 · staged:3 · recovery:confirmed`; es evidencia de lectura y
estado local, **no** prueba tres nuevas entregas remotas. Intake/binding
seguían ON y entrega continua/migración OFF en el último readback remoto
aceptado del 08-Oct. Adquisición/conciliación automáticas y gate vertical
continúan abiertos. **Bridge no alcanza PASS** ni se cambia avance
por documentación.

## Aviso

Este proyecto organiza datos personales de bienestar. No sustituye evaluación, diagnóstico ni tratamiento médico.
