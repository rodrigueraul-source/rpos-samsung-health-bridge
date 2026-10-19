# Política de release, procedencia y recuperación

Política documental propuesta para integración; no cambia producción.
Alcance: F06.08. No crea un release.
Responsable de aceptación: propietario de R-POS. Program Registry e Implementation Log
conservan el estado maestro. El repositorio conserva fuentes y evidencia técnica.

## Contrato de procedencia

Antes de una entrega futura, registrar un manifiesto seguro con:

- commit exacto y árbol de fuentes, versión de aplicación y versionCode;
- sabor y paquete real del APK, SHA256 del artefacto y certificado público;
- versión/hash del SDK autorizado, compilador y comandos de compilación;
- resultados CI vinculados a su commit exacto y distinción mock/Samsung;
- hashes de módulos y bundles GAS, y comprobación independiente de la versión
  publicada en la implementación existente;
- compatibilidad de esquemas, almacenamiento cifrado, cola y journals;
- alcance autorizado, responsable, evidencia y resultado de la comprobación.

Un campo desconocido queda null/pending. No completar hashes a partir del
número de versión o una captura. El manifiesto ejemplo no acredita instalación
ni despliegue. Endpoint, tokens, IDs de configuración privada y registros de
salud no forman parte del manifiesto público.

## Revisión e integración

El cambio debe indicar problema, comportamiento, riesgo, validación y ruta de
recuperación. CI mock valida contratos/compilación simulada; SamsungRelease
requiere evidencia del build real. La aceptación física tiene sus propios
criterios y no se deduce de ninguno de los dos.

Usar revisión del propietario y controles de rama disponibles antes de integrar
un cambio futuro. Hoy las ramas consultadas reportan protected=false y no hay
rulesets visibles; la consulta administrativa detallada no está disponible.
Esta política no afirma que esas protecciones ya estén configuradas.

## Publicación

Preservar aplicación, certificado, datos cifrados, UID, recibos y configuración.
Actualizar en sitio; no desinstalar ni limpiar datos. En GAS conservar el mismo
destino, identidad, permisos y temporizadores salvo cambio explícito del alcance.
Separar guardar código, publicar versión y activar un modo; ninguno implica
los otros. Registrar readback y comparar las huellas antes de afirmar coincidencia.

## Rollback y recuperación

Antes de una entrega futura, identificar la última fuente/bundle compatible y
la configuración necesaria para recuperarla, con respaldo en el destino privado.
No volcar Script Properties o claves a Git ni guardar snapshots de datos clínicos.

- GAS: si corresponde revertir código, usar una versión compatible de la misma
  implementación y verificarla. No restaurar un snapshot completo de propiedades
  sobre journals actuales ni retroceder estados confirmados.
- Android: conservar la firma/paquete y el almacenamiento. No asumir que un APK
  con versionCode menor podrá instalarse como actualización. Preferir una
  corrección compatible hacia adelante; evaluar una reversión con evidencia
  del mecanismo soportado antes de ejecutarla.
- Transporte: recuperar el mismo recibo por lectura/verificación. Una respuesta
  perdida no autoriza volver a crear ni reenviar indiscriminadamente.
- Correcciones de configuración: cambiar únicamente la propiedad prevista y
  comprobar readback. La promoción controlada existente conserva corte y demás
  propiedades, y revierte sólo su modo si el readback falla.
- Ante incertidumbre: mantener evidencia, detener el avance del caso afectado
  y registrar la causa. No resetear la cola ni purgar originales para obtener PASS.

## Corte vigente y aceptación

El corte aceptado del 18-Oct es 0.8.3/SDK 1.1.0, piloto 3/3, continuous ON
y migración OFF. BUILD sigue 83.33%, cinco hitos de seis. El hito 6 conserva
dispensa sólo para aceptación limitada, sin cierre técnico.

La evidencia de aceptación limitada se obtuvo el 19-Oct mediante captura automática nueva y natural
posterior a continuous: recibo/UID nuevos, journal confirmado, una sola fila
Notion íntegra y acuse Android concordante. No generar datos ni repetir pruebas
físicas ya aceptadas para completar el documento.

Esta política preparada no cierra F06.08 operativo: faltan adopción/integración
del documento y procedencia comprobada del APK 0.8.3 y del GAS publicado.

Referencias: [corte](operations-checkpoint-2026-10-18.md),
[manifiesto ejemplo](release-provenance.v1.example.json),
[historial de recuperación](android-recovery.md).
