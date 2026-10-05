# Samsung Health Bridge — avance y evidencia

El Registry conserva BUILD 35% como la línea base vigente. La Master WBS V2.0
aprobada registra ese porcentaje, pero no define pesos ni una fórmula para
convertir pruebas en puntos porcentuales. Por tanto, 35% no es una medición
calculada del trabajo técnico actual. No aumentar el número por documentación,
por contar casillas de criterios distintos ni por preparar código sin operación.

## Hitos comprobados al 05-Oct-2026

| Hito | Evidencia aceptada |
| --- | --- |
| Adquisición propia | APK Samsung compilado; lectura real; UID, tiempos y detalle por segmento preservados |
| Relectura | Reapertura de la actividad seguida de lectura; mismos UID/datos, sin afirmar reinicio del sistema |
| Integración asistida | Dos UID reales reconciliados en páginas existentes de Fitness, lectura posterior y replay sin duplicados |
| Permisos | Denegación READ FAIL con selector/COPY bloqueados; restauración aceptada por seguimiento del usuario |
| Persistencia/coordinación | Recibos SQLite, intención anterior a escritura, migración y pruebas de bloqueo/fallos sintéticos |

El nuevo adaptador REST/CLI y la búsqueda de alias tienen pruebas sintéticas.
Su preparación no equivale a despliegue o entrega automática.

El 05-Oct-2026 Raul eligió el proyecto Apps Script existente, entregó su enlace
y confirmó que el TXT del scheduler es el código guardado vigente. La captura
de implementaciones no muestra versiones activas ni archivadas. El nuevo
receptor JavaScript autentica y persiste un export con pruebas sintéticas;
`staged` no confirma entrega en Notion. No está instalado ni desplegado.

## Evidencia faltante para avanzar operativamente

| Pendiente | Criterio verificable | Responsable |
| --- | --- | --- |
| Runtime/handoff | Ruta vigente identificada; autenticación en el host; recibo duradero; Android entrega a esa ruta sin pegar JSON en el chat | AI implementa; Raul facilita acceso/configuración del entorno |
| Alias del scheduler | Código ejecutable actual revisado; mismo alias resuelve la página canónica sin crear otra captura | AI prepara/integración; acceso al proyecto actual |
| Recuperación real | Fallo controlado en el transporte real; reinicio/reanudación conserva UID/página y no duplica ni pierde evidencia | AI; ventana de prueba en entorno real |
| Errores Samsung restantes | Casos de Samsung ausente/deshabilitado/no compatible tratados y validados; exportación bloqueada ante fallo | AI prepara; pruebas físicas cuando corresponda |
| Cierre | Evidencias anteriores registradas; revisión de los criterios Bridge y porcentaje con regla acordada | AI y Raul |

## Información mínima para el siguiente despliegue

1. Proyecto y código vigente: recibidos y confirmados por Raul. No volver a
   pedir TXT, enlace ni un número de versión de web app que aún no existe.
2. Runtime elegido: Apps Script. Receptor, coordinador de entrega JavaScript
   y wrapper de alias preparados en `apps-script/`; no ejecutan el CLI Python.
   66 pruebas JS sintéticas + 46 Python/validadores PASS local. Faltan envío
   Android, vínculo/migración revisados en vivo y despliegue/UAT real.
3. Configurar autenticación, almacenamiento privado y acceso del endpoint en
   el entorno al revisar el despliegue concreto. Reutilizar la conexión Notion
   aprobada; nunca enviar tokens por chat. El SDK no vuelve a pedirse.

Antes de cambiar el porcentaje, acordar una regla de hitos ponderados o un
criterio explícito de avance parcial. Esto corrige la medición administrativa;
los hitos técnicos ya aceptados siguen válidos y no deben repetirse. Bridge
PASS y el gate vertical de tres ciclos son criterios distintos; no mezclarlos.


## Preparación de entrega y alias · 05-Oct-2026

El coordinador Apps Script conserva una intención persistente antes de escribir
Notion. La pérdida de la respuesta de evidencia puede confirmarse por lectura
posterior; una escritura parcial sin evidencia queda sin resolver y no se
repite. Consulta completa, revisión ligada a hash/UID/fecha de edición, esquema,
página activa y bloqueo protegen la reutilización de páginas existentes.
Alias archivados exactos permiten al scheduler encontrar la página canónica
tras reemplazar su ID por el UID Samsung. Intención previa de creación evita
recrear una captura tras respuesta perdida. No se crean sesiones en el worker.

Contrato de evidencia v2 explícito: no se confunde el hash JS del registro con
el hash Python del evento. Recibos v1 y alias históricos sólo en prosa esperan
migración revisada. La entrega exige revisión del vínculo scheduler/alias y
la fuente Fitness exacta. Notion no ofrece transacción entre estas escrituras;
editores externos no participan en Script Lock. Código y pruebas sintéticas
no cierran BR01/02/03 ni recuperación real. BUILD 35% permanece vigente.
