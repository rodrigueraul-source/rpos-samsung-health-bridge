# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Estado actual

**UNPARKED · BUILD · 35%**

La rama de desarrollo `bridge/android-acquisition-v0.2` reconstruye la capa Android faltante sin reemplazar el MVP Python ya validado.

### Evidencia disponible

- Python normalization MVP + schema/tests.
- Proyecto Android mínimo con sabores `mock` y `samsung`.
- Contrato `ExerciseReader`.
- UI **READ EXERCISE** + **COPY FIRST JSON** para el handoff privado de un registro.
- Adaptador Samsung orientado a **Exercise READ** y preservación del `uid` original.
- CI independiente del SDK propietario mediante `mockDebug`.
- Device UAT documentado.
- Exportación v0.3 de UID, tiempos, origen/dispositivo y detalles objetivos por sesión.
- Staging SQLite privado por `(source, uid)` con reintento tras reinicio y confirmación protegida por hash. No realiza escrituras de red.
- Pruebas Kotlin del formato JSON y pruebas Python del staging/replay persistente.

### Gate pendiente

Bridge no alcanza PASS hasta demostrar en un dispositivo físico:

`Samsung Health -> own app -> Exercise READ -> original Samsung uid -> R-POS Source Record ID -> replay/dedup proof`

## Arquitectura

```text
Samsung Health
     |
     v
Android acquisition adapter
     |
     v
Samsung UID + objective fields
     |
     v
existing R-POS normalization/evidence path
     |
     v
Fitness Tracker / Decision Engine / Coach
```

El adaptador Android no crea un segundo Fitness database ni modifica Gym V4.

## Build

### Mock / CI

No requiere Samsung SDK:

```bash
gradle :app:assembleMockDebug :app:testMockDebugUnitTest
```

### Samsung real

Requiere el AAR oficial Samsung Health Data SDK en `app/libs/`. Ver:

- `docs/android-build.md`
- `docs/device-uat.md`

## Validación Python

Requiere Python 3.11+:

```bash
python scripts/validate_sample.py
python scripts/validate_android_contract.py
python -m unittest discover -s tests
```

## Gobernanza

- No guardar credenciales ni datos reales de salud en Git.
- No versionar el AAR propietario.
- Preservar `source`, `recorded_at` y el identificador de origen.
- No sustituir Samsung `uid` por un ID sintético cuando se cierre el gate real.
- No aumentar progreso por documentación o código no probado en dispositivo.

## Aviso

Este proyecto organiza datos personales de bienestar. No sustituye evaluación, diagnóstico ni tratamiento médico.
