# R-POS Samsung Health Bridge

Base técnica para integrar datos de salud y actividad con **R-POS Core Fitness**.

## Estado actual

**Corte operativo 18-Oct-2026: BUILD · 83.33% · 5/6 hitos verificados · APK 0.8.3 · SDK 1.1.0.**

La operación continua está activa conforme al checkpoint aceptado en Notion.
El hito 6 tiene dispensa del propietario sólo para aceptación operativa limitada;
no está técnicamente cerrado. Falta comprobar una captura automática nueva y
natural posterior a la activación. Ver [corte vigente](docs/operations-checkpoint-2026-10-18.md).

**Fuente de control:** R-POS Program Registry e Implementation Log en Notion;
detalle de trazabilidad en [docs/progress-evidence.md](docs/progress-evidence.md).
Este porcentaje corresponde a cinco hitos aceptados de seis, no a horas o
puntos de esfuerzo; **no es Bridge PASS**.

- **Hito 5 aceptado el 08-Oct:** entrega Core con respuesta perdida recuperada
  y replay sin nuevas escrituras remotas; reinicio del teléfono reportado por
  el propietario y corroboración posterior mediante READ/CHECK, registro
  canónico único, UID/alias/métricas conservados. No se reclama telemetría
  de boot ni recuperación ante cualquier fallo arbitrario.
- **v0.7, operación acotada confirmada el 08-Oct:** natación reconciliada en
  destino existente, acuse Android `confirmed: 4 · staged: 1`, sin duplicados.
  La captura del 11-Oct muestra `READ PASS · 75 records` y estado local
  `confirmed: 4 · staged: 3 · recovery: confirmed`: prueba lectura actual,
  **no** confirmación remota de las tres entradas staged.
- **Checkpoint histórico del 08-Oct · hito 6 diferido:** otros errores físicos Samsung y checklist de release
  repetible. No pedir pruebas adicionales, reinstalaciones, finalizadores
  ni CHECK para cerrar este gate salvo regresión crítica o nueva instrucción.
- **Checkpoint vigente del 18-Oct:** intake, binding revisado, delivery y
  adquisición automática ON; modo continuous; migración OFF. Conservar corte,
  cola, journals, firma, permisos, temporizador y visibilidad existentes.
- **Piloto:** 3/3 entregas aceptadas. Esto no sustituye la captura natural
  posterior a la transición continua ni el cierre técnico del hito 6.
- **Código:** main 0067ac5f incorpora los cambios hasta PR #11. Un merge no
  acredita por sí mismo el hash del APK instalado ni del GAS publicado.

### Historial del release 0.7.1 · no representa el estado vigente

Se recuperaron el APK firmado0.7.0 y el AAR1.1.0 originales. El commit2cdc7f0 y su texto Kotlin no están disponibles; el hardening propio R-POS se restableció desde el bytecode del APK con procedencia explícita. La corrección de recibos conserva consultas HMAC, backoff persistente y polling visible. Mismo paquete/firma/campos persistidos; sin activación de entrega continua o migración. Instalación y lectura real confirmadas. Tres ciclos consecutivos acotados de recibo/acuse/UID único aceptados; no sustituyen la adquisición y entrega automáticas pendientes. La primera ejecución carece de JSON final: no se atribuyen sus contadores de recovery/replay. Dos ejecuciones posteriores sí acreditan recuperación y replay sin nuevas escrituras. Ver [revisión del release](docs/release-v0.7.1.md).

### Contexto histórico · 06-Oct

Los checkpoints anteriores validaron entrega canónica acotada, scheduler,
replay sin duplicados y versión v0.5. La preparación de recuperación v0.6
se describe en los documentos técnicos como antecedente, no como estado actual.

La rama histórica `bridge/android-acquisition-v0.2` fue integrada mediante PR #1.
El código vigente se consulta en main; se conserva el MVP Python validado.

### Componentes implementados y evidencia histórica

Las referencias v0.5–v0.7 siguientes son antecedentes. La configuración vigente
es la del corte 18-Oct; no se deduce una versión publicada a partir del editor.

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
- Apps Script operativo: recepción HMAC privada, journal/readback, consulta
  de recibos y reutilización del scheduler. Continuous ON y migración OFF según
  el checkpoint vigente. La consulta de recibo sigue siendo de sólo lectura.
  No se propone republicar ni modificar flags por esta corrección documental.
- Android v0.5 instalado/configurado: cola cifrada, export original, firma/envío/check en primer plano, backoff y un recibo físicamente confirmado. Android v0.6 agrega recuperación separada por consulta sin reenviar el entrenamiento. Ver `docs/android-delivery.md` y `docs/android-recovery.md`.
- Migración histórica y aliases revisados aplicados en el flujo acotado: los journals/evidencias aceptados se conservan. No volver a migrarlos para probar recuperación.

La actualización v0.6 pasó 41 pruebas Android y 169 Apps Script locales;
APK release firmado y certificado anterior comparados. Build y hashes:
`docs/android-delivery-build-evidence.md`. La prueba física de v0.6 estaba pendiente en ese checkpoint histórico; la evidencia operativa posterior corresponde a v0.7.

### Gate pendiente

Se conservan los cinco hitos aceptados y el piloto 3/3. El hito 6 mantiene
dispensa sólo para aceptación limitada, sin PASS técnico. No repetir pruebas
aceptadas, reinstalaciones, finalizadores ni replays para elevar progreso.

El siguiente cierre operativo requiere una captura nueva y natural después
de continuous: UID/recibo nuevos, journal confirmado, una sola fila Notion
con evidencia original y acuse Android concordante. Los datos se retienen en
los destinos privados autorizados; los ejemplos públicos siguen siendo sintéticos.

El cierre se registra en Program Registry e Implementation Log. BUILD sigue
83.33% (5/6); documentación, CI mock y políticas propuestas no suman hitos.

Políticas propuestas: [seguridad](SECURITY.md),
[release y rollback](docs/release-policy.md) y
[procedencia](docs/release-provenance.v1.example.json).

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
