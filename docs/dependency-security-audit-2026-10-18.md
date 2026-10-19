# Revisión de dependencias y permisos — 18-Oct-2026

Alcance: árbol completo de 119 archivos del main inspeccionado
0067ac5f15e151c13239dcdbafb95d5ea9f3750e y lectura de documentación oficial.
No se instalaron herramientas, se cambiaron ajustes o se activaron automatismos.

| Revisión | Resultado |
| --- | --- |
| .github/dependabot.yml o .yaml | No presente en el árbol |
| SECURITY.md | No presente en el remoto inspeccionado; política propuesta incluida en esta revisión |
| Workflows actuales | validate.yml y android-mock.yml |
| Permisos declarados | contents: read en ambos |
| Referencias de Actions | Etiquetas mayores; no SHA completo |
| Secrets de producción en workflows | No referenciados en los dos YAML revisados |
| Dependabot alerts/security updates | No verificable desde estos archivos |
| Administración/protección | protected=false; rulesets vacíos; detalle administrativo 403 |

GitHub distingue las actualizaciones de versión configuradas en dependabot.yml
de las alertas y actualizaciones de seguridad activadas en Settings. No tener
el archivo no demuestra que estas últimas estén desactivadas.

Para trabajo futuro: verificar ajustes administrativos, decidir si se habilitan
actualizaciones de versión y, si se adopta, revisar cada PR antes de integrar.
Fijar Actions por SHA oficial verificado ofrece referencias inmutables.
No se ha creado una configuración Dependabot ni cambiado permisos por esta propuesta.

Fuentes oficiales consultadas:

- https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file
- https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
