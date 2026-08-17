<div align="center">

# ⏪ dsh-checkpoint-rewind

**Checkpoints unificados de DeepSeek Harness: instantáneas de tres estados — sesión + workspace + configuración — con reversión de un solo paso.**

*El equivalente a los Checkpoints de Claude Code, construido como plugin de costura de capacidad (capability-seam): captura antes de cada mutación y restaura cualquiera de los tres estados con un único comando aprobado.*

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
| Plataformas | Todas (comandos + listeners de host; línea de tiempo de Ajustes opcional mediante la capacidad settings) |
| Modelo | Cualquiera (sin llamadas al modelo — las instantáneas y restauraciones son deterministas) |

## Qué obtienes

`dsh-checkpoint-rewind` captura un **checkpoint unificado de tres estados** — workspace, cursor de sesión y configuración del plugin — y restaura uno o los tres con un único comando aprobado:

1. **Registro de tres estados** — cada checkpoint guarda el estado del workspace (SHA del árbol git, o un manifiesto de copia), el cursor de eventos de la sesión (`seq` + límite de turno) y una instantánea de configuración, etiquetado por origen (`manual` / `auto` / `guard` / `mutation`).
2. **Cuatro disparadores de captura** — antes de cada herramienta de mutación (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), en el intervalo automático (`autoCheckpoint`, por defecto cada paso), manualmente (`/checkpoint` y la herramienta `checkpoint`), y como guardia antes de cada reversión.
3. **Proveedor git primero** — `git stash create` / `commit-tree` producen objetos de instantánea no referenciados que nunca tocan tu worktree, índice o historial; la restauración es solo-worktree y por rutas explícitas. Los directorios no git (y los repos con HEAD no nacido) degradan a un proveedor `copy` incremental con reutilización de hardlinks.
4. **Reversión de un solo paso** — `/rewind workspace|session|config|all <target>` restaura los estados seleccionados; `preview` es un informe de impacto de solo lectura, `diff <a> <b>` compara dos checkpoints, `clear` los elimina.
5. **Reversión de sesión por reproducción de semilla** — la reversión de sesión reproduce eventos hasta el límite del checkpoint mediante la API oficial `sessions.create` con semilla, creando una nueva sesión hija; la sesión original conserva su historial completo.
6. **Línea de tiempo en Ajustes** — la pestaña `Plugins → Checkpoints` muestra los checkpoints de la sesión con diffs línea a línea entre pares.

## ¿Por qué otro plugin de rewind?

| Plugin | Qué vende | ¿Restaura archivos? | ¿Rebobina la sesión? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (este) | instantáneas de objetos git + reversión de tres estados + restauración de un solo paso | ✅ estado completo del workspace | ✅ sesión hija por reproducción de semilla |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | Change Ledger persistente de deltas por mutación | ✅ reproduciendo deltas inversos | ✅ su propio modelo de ledger |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | reversión pura de contexto al último paso completado | ❌ | ✅ solo contexto |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | recall de mensajes (elimina un turno y todo lo posterior) | ❌ (explícitamente) | ✅ eliminación de turno |

La diferencia en una frase: **dsh-checkpoint-rewind captura el *estado del workspace* con primitivas git sin efectos secundarios antes de cada mutación, y convierte “volver al paso N” en un único comando aprobado — primero el checkpoint de guardia, segundo los archivos restaurados, tercero la configuración restaurada, cuarto la sesión reproducida, cada fase registrada.** Sin contabilidad de deltas que pueda derivar, sin edición a nivel de mensaje (eso pertenece a otro plugin), sin sincronización entre dispositivos.

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

El paquete es ESM puro sin paso de build — `index.mjs` y `lib/` son los artefactos enviados. Las mutaciones del workspace ahora crean checkpoints automáticamente; ejecuta `/rewind` para listarlos:

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

Dirígete a un checkpoint por su prefijo de id único, por número de paso o por `latest`:

```text
/rewind b2c3d4e5
/rewind step 2
/rewind latest
/rewind preview b2c3d4e5   # solo lectura: muestra qué archivos cambiarían, no toca nada
/rewind clear              # eliminación confirmada de los checkpoints de esta sesión (archivos intactos)
```

`preview` se resuelve con el mismo direccionamiento e imprime el impacto sin pedir confirmación ni escribir nada.

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

```yaml
- insert:
    - id: checkpoint-rewind
      name: dsh-checkpoint-rewind
      config:
        provider: auto
        maxSnapshots: 50
        maxSnapshotBytes: 536870912
        pruneOnTurnEnd: true
        confirmVia: auto
        preRewindCheckpoint: warn
```

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

## Modelo de seguridad

- **El historial de git es intocable.** El proveedor git solo ejecuta primitivas sin efectos secundarios de la lista blanca — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse` — impuestas por una aserción en tiempo de ejecución, y las referencias de objetos se validan como ids hexadecimales antes de pasarlas a git (un registro manipulado no puede inyectar opciones de git). **Nunca `reset --hard` por defecto, nunca `clean`, nunca mutación de índice/historial** (ver `workspaceRestore` abajo).
- **Reversión por sobrescritura, nunca borrado.** La restauración solo sobrescribe archivos capturados, y el proveedor git restaura **rutas explícitas** (`git restore … -- .` borraría archivos añadidos con `git add` después del checkpoint). Los archivos creados después del checkpoint (no rastreados **o** staged) se *informan* y se dejan en su sitio.
- **Sin escrituras a través de enlaces, sin path traversal.** El proveedor copy valida las referencias de checkpoint antes de unirlas a las rutas del directorio de instantáneas, y se niega a restaurar a través de un destino (o ancestro) que se haya convertido en un enlace simbólico — así una restauración nunca puede seguir un enlace fuera del workspace.
- **La restauración requiere aprobación.** Sobrescribir archivos del usuario siempre pasa por la costura de confirmación con semántica `ask`; un answerer ausente, que lanza error o que responde “no” **cierra en fallo**. `/rewind preview` es la forma de solo lectura de inspeccionar el impacto primero.
- **La reversión es reversible.** Antes de restaurar, un checkpoint de guardia captura el estado actual; restaurar la guardia deshace la reversión. `preRewindCheckpoint: require` aborta la reversión cuando la guardia no puede capturarse.
- **Transacción de orden fijo.** Primero la guardia, segundo el workspace, tercero la configuración, cuarto la reproducción de la sesión; cada fase se registra; una restauración fallida deja archivos, checkpoints y sesión intactos.
- **`workspaceRestore: 'reset-hard'` equivale a CC y es opt-in.** Ejecuta `git reset --hard <snapshot commit>` (la cabeza de la rama se mueve al commit de la instantánea; el historial previo a la instantánea sigue siendo recuperable vía reflog; los archivos no rastreados no se tocan). Está desactivado por defecto.
- **Visible para el modelo ⟺ registrado.** Todo lo que un usuario o modelo ve se reconstruye a partir de `command/run` + `command/done` (y, una vez que el host los conoce, los eventos `checkpoint/*`) más el dominio durable `checkpoints`.

## Cómo funciona

```text
capture ── fs/write-intent · fs/edit-intent · tools/pre-execute (prepend, pass-through)
        ── step/start auto interval ── /checkpoint · checkpoint tool ── pre-rewind guard
             │
             ▼  ProviderRegistry.resolve(auto)  →  git: stash create / commit-tree
             │                                     copy: incremental dir + hardlinks
             ▼
        checkpoints storage domain (SQLite rows / JSON file)  +  checkpoint/* event (adaptive gate)

/rewind <target> ── confirm (userQuestions / approval, fail-closed) ──▶ guard checkpoint
             ├─ workspace: provider.restore(ref)  (restore | reset-hard)
             ├─ config:   settings namespace write-back (persisted)
             └─ session:  sessions.create(seed replay) → new child session (original untouched)
```

Registro de decisiones completo, vocabulario de eventos y contrato de la costura de proveedores: [ARCHITECTURE.md](ARCHITECTURE.md).

## Eventos de sesión (nota rc.6)

El plugin declara `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` y `checkpoint/rewind` como miembros `SessionEventMap` solo de log. El harness rc.6 **no tiene superficie de registro de eventos para plugins** y `Session.append` descarta silenciosamente las claves de opciones desconocidas, por lo que añadir tipos desconocidos haría la sesión ilegible al recargarla. Por eso el plugin añade a través de una **puerta adaptativa**: una sonda en tiempo de ejecución (sobre un almacén de sesión separado, nunca persistido) detecta si el `append` del host sella el sobre `ignorable` — en rc.6 la puerta permanece cerrada; en hosts que lo soportan, los eventos `checkpoint/*` se añaden automáticamente con `ignorable: true`. Hasta entonces, la cadena de auditoría autoritativa es `command/run` + `command/done` (conocidos por el harness) más el dominio de almacenamiento durable `checkpoints`.

## Ancla de Web UI

El plugin devuelve el id de la nueva sesión en el resultado del comando (`session: <id>`) y el shell web puede navegar allí. **La unidad de proyección de sesión `checkpoints` viene incluida**: siempre que `ctx.sessionProjections` exista, el plugin registra la unidad vía `ctx.inject` (pliega `checkpoint/snapshot|bound|prune|rewind` en una lista de valor completo) — permanece como lista vacía en hosts rc.6 hasta que una build del harness incluya el vocabulario `checkpoint/*` o el sobre `ignorable`, y entonces se llena sin cambios en el plugin.

## FAQ

**¿Esto reemplaza a git?** No — lo *usa* donde está disponible. En un repo git obtienes objetos de instantánea exactos al byte, deduplicados, sin tocar el historial; en cualquier otro directorio, el proveedor copy hace lo mismo con archivos normales. Los commits regulares siguen siendo tu historial a largo plazo.

**¿Por qué no `git reset --hard` por defecto?** Porque destruir estado no es el trabajo de una red de seguridad. El plugin solo crea objetos no referenciados y realiza restauraciones solo-worktree y por rutas explícitas por defecto, de modo que una reversión incorrecta nunca puede perder historial, el índice ni archivos creados después del checkpoint. `reset-hard` está disponible detrás de `workspaceRestore: 'reset-hard'` para usuarios que quieran explícitamente paridad con CC.

**¿Puedo rebobinar a un paso en medio de un turno?** La restauración de archivos es precisa a nivel de paso (`/rewind step <N>` = la instantánea más cercana ≤ N). Sin embargo, la reproducción de la sesión respeta la granularidad de reproducción del harness: la sesión hija se siembra hasta el límite de turno del checkpoint.

**¿Qué pasa si nadie puede responder a la confirmación?** No se toca nada — el plugin cierra en fallo (`unavailable`/`rejected`), conserva el checkpoint y devuelve un error explicativo. Con `confirmVia: approval` en rc.6 el mensaje dice que montes userQuestions, porque approval requiere un turno abierto y los comandos se ejecutan entre turnos.

**¿Puedo deshacer una reversión?** Sí — cada reversión aprobada captura primero un checkpoint de guardia del estado previo a la reversión; el resultado imprime `rewind guard: <id>`, y `/rewind <guard-id>` restaura ese estado.

**¿Cómo me dirijo a los checkpoints?** Prefijo de id único (sirve el id corto de 8 caracteres de la lista), `/rewind step <N>`, `/rewind latest`, o `/rewind clear` para eliminar los checkpoints de esta sesión (archivos intactos). `/rewind preview <target>` usa el mismo direccionamiento para mostrar el impacto sin cambiar nada.

**¿Qué hace `preview` — y qué no hace?** Resuelve el checkpoint y ejecuta una comparación de solo lectura: qué archivos se sobrescribirían (o recrearían), cuáles ya coinciden y qué archivos creados después del checkpoint se dejarían en su sitio. Nunca pregunta, nunca escribe, nunca bifurca y no registra ningún evento `checkpoint/rewind` — la puerta de aprobación solo se ejecuta en un `/rewind <id>` real.

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` y `network:none`.
- **Datos**: los registros de checkpoint viven en el dominio de almacenamiento `checkpoints` (filas SQLite o un archivo JSON); las instantáneas de copia viven bajo `snapshotDir`. Totalmente local — sin red, sin credenciales.
- **Registro de sesión**: los eventos `checkpoint/*` se añaden mediante la puerta adaptativa; la cadena de auditoría autoritativa es `command/run` + `command/done` más el dominio durable.

## Límites de seguridad

- **El historial de git es intocable.** Primitivas sin efectos secundarios de la lista blanca; `reset --hard` solo detrás del modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversión por sobrescritura, nunca borrado.** La restauración sobrescribe solo archivos capturados; los archivos creados después del checkpoint se informan y se dejan en su sitio.
- **Sin escrituras a través de enlaces, sin path traversal.** Los `ref` de copy se validan como ids de instantánea; la restauración se niega a seguir enlaces simbólicos fuera del workspace.
- **La restauración requiere aprobación.** Un answerer ausente o que niega cierra en fallo.
- **La reversión es reversible.** Primero se captura un checkpoint de guardia del estado previo a la reversión.

## Limitaciones conocidas

- En rc.6, los eventos de sesión `checkpoint/*` son suprimidos por la puerta adaptativa; la cadena de auditoría usa `command/run` + `command/done` más el dominio de almacenamiento hasta que un host incluya el vocabulario o el sobre `ignorable`.
- `confirmVia: approval` necesita un turno abierto, y los comandos se ejecutan entre turnos — monta userQuestions (o define `confirmVia: userQuestions`) en rc.6.
- La reversión de sesión crea una **nueva sesión hija** sembrada desde el límite del checkpoint; nunca reescribe ni trunca la sesión original.
- `workspaceRestore: 'reset-hard'` mueve la cabeza de la rama al commit de la instantánea; está desactivado por defecto.
- Un checkpoint capturado antes de cualquier turno cerrado no tiene límite de reproducción — la reversión de sesión crea entonces una sesión hija nueva con contexto vacío.

## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `/rewind <id>` dice `rewind cancelled: no confirmation answerer` | No hay ningún canal userQuestions/approval montado — el plugin cierra en fallo. Ejecútalo en la Web UI (o monta un proveedor de preguntas); `confirmVia` selecciona el canal. |
| `/rewind <id>` dice `approval requires an open turn …` | Los comandos se ejecutan entre turnos y approval necesita un turno — monta userQuestions o define `confirmVia: userQuestions`. |
| `rewind: checkpoint registry unavailable` | El dominio de almacenamiento `checkpoints` no pudo abrirse (backend de almacenamiento ausente/con errores). Revisa los logs del harness y la configuración del backend del dominio. |
| Un checkpoint aparece como `fork: pending (turn not closed)` | Su turno aún no tiene `turn/end`; los archivos aún pueden restaurarse, pero la reproducción de la sesión espera a que el turno se cierre. |
| `files restored … but the session was NOT replayed` | La fase de sesión de la transacción falló (sin límite cerrado, o reproducción rechazada). Los archivos siguen restaurados; usa el `rewind guard: <id>` impreso para deshacer. |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` rechazó la reversión porque falló la captura de la guardia; arregla el almacenamiento (o define `warn`/`off`). |
| Un checkpoint aparece como `(copy)` aunque el directorio es un repo | HEAD no nacido (sin commit inicial): las primitivas de instantánea git requieren HEAD, así que el plugin degrada a `copy` hasta el primer commit. |
| `MISSING_CREDENTIAL` en ejecuciones headless | No relacionado con este plugin: no hay `DEEPSEEK_API_KEY` configurada para el proveedor del modelo. |
| El almacenamiento de instantáneas crece | La poda corre después de cada instantánea y en `turn/end` (`pruneOnTurnEnd`); baja `maxSnapshots` / `maxSnapshotBytes`, ejecuta `/rewind clear`, o borra `$DSH_HOME/dsh-checkpoint-rewind` después de desinstalar. |

## Desarrollo

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de proveedores)
npm run test:integration  # verificación headless ensamblada (test/integration/)
```

Sin paso de build: ESM puro — `index.mjs`/`lib/` son los artefactos publicados.

## Temas

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el modelo de checkpoint de tres estados, la costura de proveedores git/copy, la transacción de reversión en tres fases, la línea de tiempo de Ajustes, la documentación, CI/CD y releases.

## Familia de plugins DSH de PerryLink

Este proyecto es uno de los plugins de DeepSeek Harness mantenidos por [PerryLink](https://github.com/PerryLink). Si este te ayuda, es probable que los demás también lo hagan:

| Plugin | Una línea |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Panel de runtime MCP de solo lectura: comando /mcp + pestaña de Ajustes con estado, herramientas y errores |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Guardia de disciplina de ingeniería: interrogatorio de requisitos, puertas de prueba, revisión adversarial |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Agentes hijo en segundo plano persistentes con barra lateral en la Web UI, mensajería e interrupción |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | Diagnósticos LSP, formateo, completado, acciones de código y renombrado mediante servidores de lenguaje |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Cambio de estilo en tiempo de ejecución equivalente a outputStyles de Claude Code |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Equivalente a /rewind de Claude Code: instantáneas, bifurcaciones de sesión, restauración de un solo paso |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Reglas de permisos declarativas allow/deny/ask estilo Claude Code con auditoría |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Revisión automática de un segundo modelo en la cadena de aprobación, cierre en fallo por defecto |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Memoria entre sesiones con puerta de aprobación: costura ctx.memory + SQLite + herramienta memory |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Paquete de skills de auditoría de seguridad: escaneo de secretos, revisión de dependencias y cadena de suministro |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Fija sesiones en la barra lateral web con ordenación durable |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Historial de entrada estilo terminal para el compositor web: flechas, búsqueda Ctrl+R |
| [dsh-github](https://github.com/PerryLink/dsh-github) | Integración de PR/issues de GitHub para DSH, cada escritura con puerta de aprobación |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Base de conocimiento de desarrollo de plugins como skill de agente bajo demanda |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migra sesiones, memoria, skills y CLAUDE.md de Claude Code a DSH |

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
