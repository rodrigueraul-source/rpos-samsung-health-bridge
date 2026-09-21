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

**MVP Bridge v0.1 — base inicial.** No incluye sincronización automática ni escritura directa en Notion.

## Aviso

Este proyecto organiza datos personales de bienestar. No sustituye evaluación, diagnóstico ni tratamiento médico.
