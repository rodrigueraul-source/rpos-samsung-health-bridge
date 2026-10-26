# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Estado actual · verificado 26-Oct-2026

**PASS OPERATIVO LIMITADO · 5/6 hitos técnicos (83.33%).**
El hito 6 está dispensado por decisión del propietario para este alcance;
no está acreditado y no se declara 6/6 ni 100%.

Notion R-POS Program Registry es el System of Record. El piloto automático
3/3 y la conciliación del recibo revisado se cerraron el 18-Oct; continuous
se promovió ese día y una captura real posterior completó la aceptación
limitada el 19-Oct. La auditoría del 26-Oct conserva esa aceptación.

| Control | Evidencia observada el 26-Oct |
| --- | --- |
| Modo | `continuous_active`; consulta sin escrituras ni cambios de propiedades/activadores |
| Servidor | 13 journals de creación automática confirmados; 0 attempting; 0 recibos posteriores al cutoff sin confirmar |
| Configuración | Intake/binding/delivery/automatic ON; migration OFF; cutoff original conservado |
| Activador Bridge | Uno, cada 5 minutos; ejecución autónoma reciente y 0% de errores visible en su tabla |
| Android | 0.8.3-delivery, última captura del propietario verificada del 23-Oct; 32 confirmed globales, recovery confirmed y automatic ON |
| Apps Script | Implementación web activa versión 9; fuente instalada de conciliación y control continuo cotejada por SHA-256 |
| Integridad | Cinco recibos reales cotejados con export v1/v2 de Notion y hashes recalculados; consulta independiente sin UID repetido |

Los contadores de Android, de journals automáticos y de archivos intake tienen
denominadores distintos. No son intercambiables. La captura Android no es
telemetría en vivo del 26-Oct; el fingerprint binario instalado y la fuente
completa de la implementación web no se certificaron en esta auditoría.

El `staged` del archivo intake se conserva como original. La confirmación de
entrega procede del journal canónico y su readback. Un marcador histórico retry
`blocked` con journal `confirmed` queda excluido por el worker antes de evaluar
retry; no es un bloqueo activo y no se borra para mejorar un contador.

Ver [auditoría y recuperación](docs/operations-audit-2026-10-26.md) y
[historial de hitos](docs/progress-evidence.md). Los documentos de release
anteriores describen sus checkpoints históricos. La propuesta de política
de release del PR #12 sigue separada de esta aceptación operativa.

### Función y límites

Samsung Health → Android Exercise READ → recepción HMAC → Drive privado →
único escritor Apps Script → Notion canónico → consulta firmada de ACK Android.
Notion conserva los registros oficiales; el Bridge no crea otro tracker.

El JobScheduler Android persistente solicita ciclos cada 15 minutos; el sistema
puede diferirlos por batería, cuotas o force-stop. El timer de Apps Script
atiende pendientes sin depender de ChatGPT Work. No se promete latencia fija
ni estabilidad prolongada que la evidencia no cubra.

Conservar UID, export original, recibos, journals, aliases, cutoff, cola cifrada
y migración OFF. No reinstalar, reenviar, repetir conciliaciones cerradas,
reinicializar colas ni inducir sesiones artificiales para probar el cierre.

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
- Separar datos crudos y normalizados.
- Aplicar revisión humana antes de usar recomendaciones de salud.


## Aviso

Este proyecto organiza datos personales de bienestar. No sustituye evaluación, diagnóstico ni tratamiento médico.
