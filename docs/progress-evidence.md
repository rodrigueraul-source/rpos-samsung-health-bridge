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

## Evidencia faltante para avanzar operativamente

| Pendiente | Criterio verificable | Responsable |
| --- | --- | --- |
| Runtime/handoff | Ruta vigente identificada; autenticación en el host; recibo duradero; Android entrega a esa ruta sin pegar JSON en el chat | AI implementa; Raul facilita acceso/configuración del entorno |
| Alias del scheduler | Código ejecutable actual revisado; mismo alias resuelve la página canónica sin crear otra captura | AI prepara/integración; acceso al proyecto actual |
| Recuperación real | Fallo controlado en el transporte real; reinicio/reanudación conserva UID/página y no duplica ni pierde evidencia | AI; ventana de prueba en entorno real |
| Errores Samsung restantes | Casos de Samsung ausente/deshabilitado/no compatible tratados y validados; exportación bloqueada ante fallo | AI prepara; pruebas físicas cuando corresponda |
| Cierre | Evidencias anteriores registradas; revisión de los criterios Bridge y porcentaje con regla acordada | AI y Raul |

## Información mínima para el siguiente despliegue

1. Enlace al proyecto Apps Script vigente y/o su `Code.gs` actual, sin tokens,
   con las funciones que crean/buscan capturas Fitness. Drive solo aportó un PDF
   de revisión en la búsqueda realizada; no se encontró una copia ejecutable.
2. Identificar el host aprobado donde se ejecutará el coordinador Python y
   persistirá su única base de recibos. Apps Script no ejecuta este CLI Python;
   si debe ser el único runtime, hace falta adaptar el coordinador a ese entorno
   antes de desplegar. No crear otro servicio por suposición.
3. Configurar la autenticación de Notion mediante el mecanismo de secretos del
   host, reutilizando la conexión aprobada cuando corresponda. No enviar tokens
   por chat. El SDK ya disponible no vuelve a pedirse.

Antes de cambiar el porcentaje, acordar una regla de hitos ponderados o un
criterio explícito de avance parcial. Esto corrige la medición administrativa;
los hitos técnicos ya aceptados siguen válidos y no deben repetirse. Bridge
PASS y el gate vertical de tres ciclos son criterios distintos; no mezclarlos.
