<div align="center">

# ⏪ dsh-checkpoint-rewind

**Checkpoints unificados de DeepSeek Harness: instantáneas de tres estados — sesión + workspace + configuración — con reversión de un solo paso.**

*El equivalente a los Checkpoints de Claude Code, construido como plugin de costura de capacidad: captura antes de cada mutación, restaura cualquiera de los tres estados con un solo comando aprobado.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-checkpoint-rewind/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-checkpoint-rewind/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-checkpoint-rewind?label=version)](https://github.com/PerryLink/dsh-checkpoint-rewind/releases)
[![npm version](https://img.shields.io/npm/v/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![npm downloads](https://img.shields.io/npm/dm/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibilidad

| Superficie | Estado |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fijados a `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (comandos + listeners de host; línea de tiempo de Ajustes opcional vía la capacidad settings) |
| Modelo | Cualquiera (sin llamadas al modelo — las instantáneas y restauraciones son deterministas) |

## Qué obtienes

`dsh-checkpoint-rewind` captura un **checkpoint unificado de tres estados** — workspace, cursor de sesión y configuración del plugin — y restaura uno o los tres con un solo comando aprobado:

1. **Registro de tres estados** — cada checkpoint guarda el estado del workspace (SHA del árbol git, o un manifiesto de copia), el cursor de eventos de sesión (`seq` + límite de turno) y una instantánea de configuración, etiquetado por origen (`manual` / `auto` / `guard` / `mutation`).
2. **Cuatro disparadores de captura** — antes de cada herramienta de mutación (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), en el intervalo automático (`autoCheckpoint`, por defecto cada paso), manualmente (`/checkpoint` y la herramienta `checkpoint`), y como guardia antes de cada reversión.
3. **Proveedor git primero** — `git stash create` / `commit-tree` producen objetos de instantánea no referenciados que nunca tocan tu worktree, índice o historial; la restauración es solo-worktree y por rutas explícitas. Los directorios no git (y repos con HEAD no nacido) degradan a un proveedor `copy` incremental con reutilización de hardlinks.
4. **Reversión de un solo paso** — `/rewind workspace|session|config|all <target>` restaura los estados seleccionados; `preview` es un informe de impacto de solo lectura, `diff <a> <b>` compara dos checkpoints, `clear` los elimina.
5. **Reversión de sesión por reproducción de semilla** — la reversión de sesión reproduce eventos hasta el límite del checkpoint mediante la API oficial `sessions.create` con semilla, creando una sesión hija nueva; la sesión original conserva su historial completo.
6. **Línea de tiempo en Ajustes** — la pestaña `Plugins → Checkpoints` muestra los checkpoints de la sesión con diffs línea a línea entre pares.

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

El paquete es ESM puro sin paso de build — `index.mjs` y `lib/` son los artefactos enviados. Las mutaciones del workspace ahora crean checkpoints automáticamente; ejecuta `/rewind` para listarlos.

## Instalación y desinstalación

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — ESM puro, sin paso de `prepare` ni `allowBuilds`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **Canal tarball**: `npm pack` en este repo y luego `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **Desinstalación**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — los archivos de instantánea permanecen hasta que borres `$DSH_HOME/dsh-checkpoint-rewind`; los objetos git se recogen con el recolector de basura.

## Configuración

Todas las opciones son campos Schemastery `Config` (modificables desde cordis.yml). Nada está hardcodeado.

| Clave | Por defecto | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor maestro; en `false`, elimina comandos, listeners y proveedores por completo |
| `provider` | `auto` | Proveedor de instantáneas: `auto` (git si está disponible, si no copy) · `git` · `copy` |
| `gitBin` | `git` | Ruta del ejecutable de git |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | Raíz de las instantáneas del proveedor copy |
| `maxSnapshots` | `50` | Checkpoints conservados por sesión (los más antiguos se podan primero) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Cuota blanda global de bytes incrementales (siempre se conserva el más nuevo por sesión) |
| `pruneOnTurnEnd` | `true` | Ejecuta la poda de cuota al terminar un turno |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | Herramientas tratadas como mutantes en `tools/pre-execute` |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | Patrones glob omitidos por el proveedor copy |
| `confirmVia` | `auto` | Canal de confirmación: `auto` (userQuestions primero) · `userQuestions` · `approval` |
| `listLimit` | `10` | Checkpoints mostrados por `/rewind` sin argumentos |
| `preRewindCheckpoint` | `warn` | Checkpoint de guardia antes de restaurar: `warn` · `require` · `off` |
| `verifyByHash` | `false` | Comparación por hash de contenido y verificación de restauración del proveedor copy |
| `autoCheckpoint.enabled` | `true` | Instantáneas automáticas por intervalo en `step/start` |
| `autoCheckpoint.intervalMinutes` | `0` | Intervalo; `0` = cada paso |
| `workspaceRestore` | `restore` | Reversión del workspace: `restore` (sobrescritura segura) · `reset-hard` (estilo CC, opt-in) |
| `promptSection` | `true` | Inyecta una sección breve de rol en el prompt |
| `checkpointTool` | `true` | Registra la herramienta de modelo `checkpoint` |

## Herramientas y superficies

| Superficie | Tipo | Notas |
|---|---|---|
| `/rewind` | comando | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear` |
| `/checkpoint` | comando | `[note <text>\|list\|diff <a> <b>]` — captura un checkpoint manual |
| `checkpoint` | herramienta | Captura un checkpoint manual con nota opcional |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Captura pre-mutación (prepend pass-through; nunca roba el hueco de política) |
| `session/event` | listener | Seguimiento de turno/paso, intervalo automático, relleno de límites, poda al fin de turno |
| Proyección `checkpoints` | proyección de sesión | Franja de línea de tiempo plegada desde el log de sesión |
| Línea de tiempo de Ajustes | cliente | Pestaña `Plugins → Checkpoints` con diffs entre pares |

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` y `network:none`.
- **Datos**: los registros de checkpoint viven en el dominio de almacenamiento `checkpoints` (filas SQLite o un archivo JSON); las instantáneas de copia viven bajo `snapshotDir`. Totalmente local — sin red, sin credenciales.
- **Registro de sesión**: los eventos `checkpoint/*` se añaden mediante una puerta adaptativa (solo cuando el host conoce los tipos o admite el sobre `ignorable`); la cadena de auditoría autoritativa es `command/run` + `command/done` más el dominio durable.

## Límites de seguridad

- **El historial de git es intocable.** El proveedor git solo ejecuta primitivas sin efectos secundarios de la lista blanca (`stash create`, `commit-tree`, `restore --worktree`, …); `reset --hard` solo existe detrás del modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversión por sobrescritura, nunca borrado.** La restauración solo sobrescribe archivos capturados; los archivos creados después del checkpoint se informan y se dejan en su sitio.
- **Sin escrituras a través de enlaces, sin path traversal.** Los `ref` de copy se validan como ids de instantánea; la restauración se niega a seguir enlaces simbólicos fuera del workspace.
- **La restauración requiere aprobación.** Sobrescribir archivos del usuario siempre pasa por la costura de confirmación; un answerer ausente o que niega cierra en fallo.
- **La reversión es reversible.** Primero se captura un checkpoint de guardia del estado pre-reversión; `/rewind <guard-id>` deshace la reversión.
- **Visible para el modelo ⟺ registrado.** Todo lo que un usuario o modelo ve se reconstruye desde `command/run` + `command/done` y el dominio durable `checkpoints`.

## Limitaciones conocidas

- En rc.6, los eventos de sesión `checkpoint/*` se suprimen por la puerta adaptativa (el host no conoce los tipos); la cadena de auditoría usa `command/run` + `command/done` más el dominio de almacenamiento hasta que un host envíe el vocabulario o el sobre `ignorable`.
- `confirmVia: approval` necesita un turno abierto, y los comandos corren entre turnos — monta userQuestions (o define `confirmVia: userQuestions`) en rc.6.
- La reversión de sesión crea una **sesión hija nueva** sembrada desde el límite del checkpoint; nunca reescribe ni trunca la sesión original.
- `workspaceRestore: 'reset-hard'` es equivalente a CC y mueve la cabeza de la rama al commit de la instantánea; está desactivado por defecto.

## Desarrollo

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de proveedores)
npm run test:integration  # verificación headless ensamblada (test/integration/)
```

## Temas

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el modelo de checkpoint de tres estados, la costura de proveedores git/copy, la transacción de reversión en tres fases, la línea de tiempo de Ajustes, la documentación, CI/CD y releases.

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
