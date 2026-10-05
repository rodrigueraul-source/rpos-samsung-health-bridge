# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Estado actual

**UNPARKED · BUILD · 35%**

La rama de desarrollo `bridge/android-acquisition-v0.2` reconstruye la capa Android faltante sin reemplazar el MVP Python ya validado.

### Evidencia disponible

- Python normalization MVP + schema/tests.
- Proyecto Android mínimo con sabores `mock` y `samsung`.
- Contrato `ExerciseReader`.
- UI **READ EXERCISE** + selector por fecha/título/UID + **COPY SELECTED JSON** para el handoff privado de un registro.
- Adaptador Samsung orientado a **Exercise READ** y preservación del `uid` original.
- CI independiente del SDK propietario mediante `mockDebug`.
- Device UAT documentado.
- Exportación v0.3 de UID, tiempos, origen/dispositivo y detalles objetivos por sesión.
- Staging SQLite privado por `(source, uid)` con intentos de escritura persistentes y confirmación protegida por hash.
- Coordinador v0.4 con consulta previa, bloqueo entre procesos y recuperación de respuestas perdidas. La interfaz de transporte debe conectarse al runner de evidencia existente; no está desplegada.
- Pruebas Kotlin del formato JSON y pruebas Python del staging/replay persistente.
- Adaptador REST de Notion y CLI para el host aprobado: consulta paginada, revisión privada por hash, conservación/búsqueda de alias y verificación de evidencia. Preparado y probado con servicio sintético; no desplegado. Ver `docs/notion-transport.md`.
- Apps Script preparado: receptor HMAC y staging; entrega a páginas existentes con revisión ligada al hash, intención duradera y lectura posterior; wrapper de alias del scheduler. 66 pruebas JavaScript sintéticas; sin instalación, despliegue ni nuevas escrituras reales. Ver `apps-script/README.md`.

### Gate pendiente

La lectura inicial, el mapeo asistido de UID y el replay controlado ya tienen
evidencia privada. Dos UID reales y la denegación/restauración de permisos ya
tienen checkpoints aceptados. Quedan runtime/entrega automática, alias del
scheduler vigente, otros errores Samsung y recuperación remota real.
La WBS no define pesos para calcular un nuevo porcentaje; ver
`docs/progress-evidence.md`. Bridge no alcanza PASS hasta demostrar el flujo completo:

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

## Validación Apps Script

Requiere Node.js 24; no dependencias npm ni acceso a cuentas:

```bash
node --test tests/apps_script_*.test.cjs
```

## Gobernanza

- No guardar credenciales ni datos reales de salud en Git.
- No versionar el AAR propietario.
- Preservar `source`, `recorded_at` y el identificador de origen.
- No sustituir Samsung `uid` por un ID sintético cuando se cierre el gate real.
- No aumentar progreso por documentación o código no probado en dispositivo.

## Aviso

Este proyecto organiza datos personales de bienestar. No sustituye evaluación, diagnóstico ni tratamiento médico.
