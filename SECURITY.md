# Seguridad de R-POS Bridge

Política documental propuesta para integración; no cambia producción.
Alcance: F06.05. Responsable de decisiones y aceptación: propietario de R-POS. La implementación
y revisión técnica pueden ser asistidas; la documentación no cambia permisos.

## Datos y credenciales

No versionar registros reales de salud, exports, notas privadas, endpoints
operativos, tokens, claves HMAC, material de firma ni el AAR propietario.
Los fixtures públicos deben ser sintéticos y reconocibles como tales.
Conservar secretos en los mecanismos privados existentes; nunca en ejemplos,
logs, PR, manifiestos públicos ni capturas usadas como evidencia pública.
Los manifiestos públicos admiten hashes de artefactos/certificados públicos,
versiones y referencias de código. Referencias de evidencia personal permanecen
en el registro privado de Notion/Drive.

El .gitignore actual excluye data/raw, data/private, entornos, claves de firma,
build outputs y AAR. Ignorar archivos no los elimina si ya fueron versionados
ni reemplaza una revisión del historial. No se detectó una exposición confirmada
en el examen acotado de HEAD; no se afirma limpieza completa del historial.

## GitHub Actions y dependencias

Mantener los workflows de validación con contents: read y sin credenciales
de producción. No mezclar validación de PR con despliegue ni con datos privados.
Los Actions usan hoy etiquetas mayores; proponer su fijación por SHA completo
verificado del repositorio oficial antes de integrarla. Esta política no cambia
los workflows ni habilita nuevos servicios.

No hay dependabot.yml en el árbol examinado. Esto no determina si los ajustes
de alertas o actualizaciones de seguridad están activos. Su verificación
administrativa sigue pendiente. Una configuración futura de actualizaciones
requiere revisión del propietario; no habilitar auto-merge ni auto-approve.

## Exposición confirmada e incidentes

1. Registrar clasificación, ruta, commit y alcance en evidencia privada,
   sin copiar el valor expuesto ni volver a publicarlo.
2. Determinar qué credencial o dato fue afectado y qué sistemas lo utilizan.
   Definir contención compatible con el flujo autorizado; no borrar colas,
   journals, exportaciones ni evidencias originales para ocultar el incidente.
3. Si una credencial operativa está comprometida, revocarla y sustituirla
   mediante el mecanismo privado correspondiente, con prueba acotada del
   enlace afectado. La rotación se justifica por exposición, no por este borrador.
4. Tratar una clave de firma Android como caso separado: preservar el paquete,
   el certificado y el acceso a datos. Una clave distinta no sustituye una
   actualización compatible. No desinstalar, borrar datos ni cambiar identidad
   para forzar la instalación.
5. Evaluar la limpieza del historial y artefactos como operación independiente,
   conservando evidencia privada y autorización para cualquier reescritura
   o eliminación. Revocar credenciales antes de suponer que borrar basta.
6. Cerrar con alcance comprobado, readback y decisiones del propietario.
   Si no hubo exposición confirmada, no declarar una rotación como realizada.

## Fuentes oficiales

- https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file
