# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Estado actual

**UNPARKED · BUILD · 66.67% · 4/6 hitos verificados**

Entrega canónica acotada y continuidad scheduler confirmadas el 06-Oct-2026:
registro SDK/aliases/métricas conservados, replay sin escrituras y cero
sesiones duplicadas. Intake y binding ON; entrega continua/migración OFF.
La captura del teléfono del 06-Oct 21:31 muestra `confirmed: 1` en v0.5.0-delivery.
El propietario reportó reinicio a las 21:38; la imagen repetida era idéntica,
por lo que no acredita una lectura independiente después del reinicio.
La recuperación v0.6 prepara una consulta firmada del recibo existente y un
checkpoint separado para una prueba física controlada. Recuperación real
ante escritura incierta y cierre Samsung siguen pendientes; ver
`docs/progress-evidence.md`. No es Bridge PASS ni una estimación de esfuerzo.

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
- Coordinador Python v0.4 con consulta previa, bloqueo entre procesos y recuperación de respuestas perdidas; el flujo operativo elegido usa Apps Script.
- Pruebas Kotlin del formato JSON y pruebas Python del staging/replay persistente.
- Adaptador REST de Notion y CLI alternativo: consulta paginada, revisión privada por hash, conservación/búsqueda de alias y verificación de evidencia. Preparado con servicios sintéticos; no confundir con el flujo Apps Script operativo. Ver `docs/notion-transport.md`.
- Apps Script operativo: recepción HMAC privada, entrega canónica acotada con journal/readback y reutilización del scheduler verificadas. Entrega continua/migración OFF. La nueva consulta HMAC de recibo es de sólo lectura incluso con delivery ON; su publicación en Google requiere actualizar la implementación existente. Ver `apps-script/README.md`.
- Android v0.5 instalado/configurado: cola cifrada, export original, firma/envío/check en primer plano, backoff y un recibo físicamente confirmado. Android v0.6 agrega recuperación separada por consulta sin reenviar el entrenamiento. Ver `docs/android-delivery.md` y `docs/android-recovery.md`.
- Migración histórica y aliases revisados aplicados en el flujo acotado: los journals/evidencias aceptados se conservan. No volver a migrarlos para probar recuperación.

La actualización v0.6 pasó 41 pruebas Android y 169 Apps Script locales;
APK release firmado y certificado anterior comparados. Build y hashes:
`docs/android-delivery-build-evidence.md`. La prueba física sigue pendiente.

### Gate pendiente

La lectura inicial, el mapeo asistido de UID y el replay controlado ya tienen
evidencia privada. Dos UID reales y la denegación/restauración de permisos ya
tienen checkpoints aceptados. El runtime, entrega acotada y alias del scheduler
ya están verificados. Quedan recuperación real ante resultado incierto,
otros errores físicos Samsung y cierre operacional repetible.
Entrega automática continua sigue fuera de la activación autorizada. La WBS
no define pesos; el conteo actual usa seis hitos explícitos. Ver
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
