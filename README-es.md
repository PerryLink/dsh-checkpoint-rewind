<div align="center">

# ⏪ dsh-checkpoint-rewind
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-checkpoint-rewind` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).

**Checkpoints unificados de DeepSeek Harness: instantáneas de tres estados — sesión + workspace + configuración — con reversión de un solo paso.**

*El equivalente a los Checkpoints de Claude Code, construido como plugin de costura de capacidad (capability-seam): captura antes de cada mutación y restaura cualquiera de los tres estados con un único comando aprobado.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-checkpoint-rewind)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-checkpoint-rewind.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-en.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-checkpoint-rewind/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-checkpoint-rewind/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-checkpoint-rewind?label=version)](https://github.com/PerryLink/dsh-checkpoint-rewind/releases)
[![npm version](https://img.shields.io/npm/v/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![npm downloads](https://img.shields.io/npm/dm/dsh-checkpoint-rewind)](https://www.npmjs.com/package/dsh-checkpoint-rewind)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-checkpoint-rewind?metric=downloads&lang=es)](https://dshfind.com/es/plugins/PerryLink/dsh-checkpoint-rewind?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-checkpoint-rewind
```


</div>

---

**📖 Base de conocimiento del ecosistema** — datos medidos, no marketing: [guía de desarrollo · datos de selección · criterios de mantenimiento](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## Instalación y desinstalación

- **Canal git** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind` — ESM puro, sin paso de `prepare` ni `allowBuilds`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **Canal tarball**: `npm pack` en este repo y luego `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **Pila de almacenamiento** (necesaria para los checkpoints, opcional para montar): `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` (config `root`) + `@deepseek-ai/dsh-storage-domain` (config `backend: json`) — ver Inicio rápido; el plugin se monta igualmente sin ella y cada comando explica la solución.
- **Desinstalación**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — los archivos de instantánea permanecen hasta que borres `$DSH_HOME/dsh-checkpoint-rewind`; los objetos git se recogen con el recolector de basura.

## ⭐ 如果它帮到了你

Este plugin forma parte de la [familia de plugins DSH](https://github.com/PerryLink) (más de 40, todos Apache-2.0). Si te resulta útil, **dale una estrella**: no desbloquea nada, pero ayuda a que la siguiente persona lo encuentre antes.

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-checkpoint-rewind?

Checkpoints unificados de DeepSeek Harness: instantáneas de tres estados — sesión + workspace + configuración — con reversión de un solo paso.

El equivalente a los Checkpoints de Claude Code, construido como plugin de costura de capacidad (capability-seam): captura antes de cada mutación y restaura cualquiera de los tres estados con un único comando aprobado.

![Demostración de terminal de dsh-checkpoint-rewind: dsh-checkpoint-rewind — /rewind lists checkpoints, then a read-only preview](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-hero.png)

![Animated terminal demo of dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-demo.gif)

*La misma ejecución, animada.*

## Comparison

![Gráfico comparativo medido de dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-evidence.png)

Capabilities out of 2 (restores files? / rewinds the session?) · counted from the README comparison table

## Compatibilidad

| Superficie | Estado |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (tag de GitHub, verificado el 2026-09-25; pin npm `0.1.7-rc.2`, peers `>=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`) (adaptado el 2026-10-04): el host eliminó `@deepseek-ai/dsh-settings-file` y sustituyó la superficie de registro de namespaces de `ctx.settings` por `SettingsForms`, que proyecta el `Config` de cada entrada del Loader en el formulario de Ajustes y persiste las ediciones en el patch del perfil — los campos de configuración del plugin ahora se declaran `volatile()` y se leen en vivo, los códecs estrictos de typert solo llevan su fábrica `create()`, y el aviso de rebobinado declara su propio `kind` de origen de mensaje. La ruta heredada `settings.register` se mantiene para los hosts `0.1.5-rc.2`/`0.1.6-alpha.2`. Verificado el 2026-09-22 contra el checkout de `dsh-v0.1.7-alpha.1` (typecheck contra la superficie de tipos de alpha.1 + suite de unidades completa + integración headless ensamblada). |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (comandos + listeners de host; línea de tiempo de Ajustes opcional mediante la capacidad settings) |
| Modelo | Cualquiera (sin llamadas al modelo — las instantáneas y restauraciones son deterministas) |

## Qué obtienes

`dsh-checkpoint-rewind` captura un **checkpoint unificado de tres estados** — workspace, cursor de sesión y configuración del plugin — y restaura uno o los tres con un único comando aprobado:

1. **Registro de tres estados** — cada checkpoint guarda el estado del workspace (SHA del árbol git, o un manifiesto de copia), el cursor de eventos de la sesión (`seq` + límite de turno) y una instantánea de configuración, etiquetado por origen (`manual` / `auto` / `guard` / `mutation`).
2. **Cuatro disparadores de captura** — antes de cada herramienta de mutación (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), en el intervalo automático (`autoCheckpoint`, por defecto cada paso), manualmente (`/checkpoint` y la herramienta `checkpoint`), y como guardia antes de cada reversión.
3. **Proveedor git primero** — `git stash create` / `commit-tree` producen objetos de instantánea no referenciados que nunca tocan tu worktree, índice o historial; la restauración es solo-worktree y por rutas explícitas. Los directorios no git (y los repos con HEAD no nacido) degradan a un proveedor `copy` incremental con reutilización de hardlinks.
4. **Reversión de un solo paso** — `/rewind workspace|session|config|all <target>` restaura los estados seleccionados; `preview` es un informe de impacto de solo lectura, `diff <a> <b>` compara dos checkpoints, `clear` los elimina (esta sesión; `clear --all` abarca todas las sesiones y workspaces).
5. **Reversión de sesión por fork** — la reversión de sesión reproduce eventos hasta el límite del checkpoint mediante la primitiva oficial `SessionStore.fork`, creando una nueva sesión hija (con respaldo a la ruta `sessions.create` con semilla cuando el host no tiene fork o el checkpoint no tiene límite); la sesión original conserva su historial completo.
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
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind
```

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

Los checkpoints persisten a través del servicio `storageDomain`. El plugin se monta sin él y nunca bloquea el arranque del perfil — los comandos checkpoint/rewind devuelven entonces un error estructurado indicando las filas exactas que hay que añadir. Compón la pila de almacenamiento una vez para habilitarlos:

```yaml
- insert:
    - id: checkpoint-rewind-storage
      name: '@deepseek-ai/dsh-storage'
    - id: checkpoint-rewind-storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js dshHomePath('checkpoint-rewind/storage')
    - id: checkpoint-rewind-storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json
```

El paquete es ESM puro sin paso de build — `index.mjs` y `lib/` son los artefactos enviados. Las mutaciones del workspace ahora crean checkpoints automáticamente; ejecuta `/rewind` para listarlos (o `/rewind list brief` para entradas de una línea con el número de sesión):

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

Dirígete a un checkpoint por su **número de sesión** (el número corto y acotado que muestra `/rewind list brief`), por prefijo de id único, por número de paso o por `latest`:

```text
/rewind list brief        # una línea por checkpoint, numerada, la más reciente primero
/rewind 3                 # el checkpoint número 3 de ESTA sesión (acierto exacto, nunca difuso)
/rewind preview 3         # solo lectura: muestra qué archivos cambiarían, no toca nada
/rewind b2c3d4e5          # el prefijo de id único (el id de 8 caracteres) sigue funcionando igual
/rewind step 2
/rewind latest
/rewind workspace 3 --files src/a.ts,src/b.ts   # restauración selectiva: solo estos archivos (con aprobación)
/rewind clear              # eliminación confirmada de los checkpoints de esta sesión (archivos intactos)
/rewind clear --all        # eliminación confirmada en TODAS las sesiones y workspaces (archivos intactos)
```

### Números de sesión (ids cortos acotados)

- **Cada checkpoint recibe un número al crearse**, empezando en `1`. `/rewind 3` resuelve ese número **exactamente**: los dígitos nunca se tratan como prefijo de id, así que `/rewind 3` no puede caer en el checkpoint cuyo UUID empieza por `3`.
- **Alcance: por sesión** (`sessionId`). Cada sesión numera sus propios checkpoints; un número es único dentro de su sesión, y `/rewind <número>` solo resuelve contra los checkpoints de la sesión (y workspace) actual.
- **Monótono y nunca reutilizado.** La poda por cuota (`maxSnapshots`) y `/rewind clear` / `/rewind clear --all` borran registros pero nunca liberan un número: tras un clear el siguiente checkpoint continúa desde la marca alta anterior (después de `#1 #2 #3` y un `clear`, el siguiente es `#4`, no `#1`). El número se guarda en el propio registro y el contador vive en el slot global del dominio, así que borrar registros no puede reiniciarlo.
- **Los checkpoints antiguos se numeran al primer contacto.** Los registros escritos antes de esta función (sin campo de número) se numeran en orden de creación la primera vez que la sesión se lista o se revierte, y esa numeración se persiste; los nuevos continúan después. Nada se salta ni se reasigna, y el direccionamiento por prefijo de id sigue funcionando para ellos.
- `/rewind list` (la lista detallada) no cambia: sigue imprimiendo el id de 8 caracteres por línea y su última línea remite a `/rewind list brief` para los números.

`preview` se resuelve con el mismo direccionamiento e imprime el impacto sin pedir confirmación ni escribir nada.

## Configuración

Todas las opciones son campos Schemastery `Config` (modificables desde cordis.yml). Nada está hardcodeado. Las opciones de proveedor (`gitBin`, `snapshotDir`, `excludeGlobs`, `verifyByHash`) se leen de la configuración viva en el momento de uso, de modo que los cambios en cordis.yml se aplican sin reiniciar.

| Clave | Por defecto | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor maestro; en `false`, elimina comandos, listeners y proveedores por completo |
| `provider` | `auto` | Proveedor de instantáneas: `auto` (git si está disponible, si no copy) · `git` · `copy` |
| `gitBin` | `git` | Ruta del ejecutable de git |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` (repliegue `~/.dsh/dsh-checkpoint-rewind` si `$DSH_HOME` no está definido) | Raíz de las instantáneas del proveedor copy |
| `maxSnapshots` | `50` | Checkpoints conservados por sesión (los más antiguos se podan primero) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Cuota blanda global de bytes incrementales (siempre se conserva el más nuevo por sesión viva) |
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
| `diffRenderer` | `pairwise` | Renderizador de diff de la página de ajustes: `pairwise` (texto línea a línea) · `side-by-side` (dos columnas por archivo) |
| `selectiveRestore` | `true` | Restauración selectiva por archivo (`/rewind … --files`) y la casilla por archivo del panel + total de tamaño |
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
| `/rewind` | comando | `[workspace\|session\|config\|all] <number\|id-prefix\|step <N>\|latest>` · `list [brief]` · `diff <a> <b>` · `preview <target>` · `clear [--all]` |
| `/checkpoint` | comando | `[note <text>\|list\|diff <a> <b>]` — captura un checkpoint manual |
| `checkpoint` | herramienta | Captura un checkpoint manual con nota opcional |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Captura pre-mutación (prepend pass-through; nunca roba el hueco de política) |
| `session/event` | listener | Seguimiento de turno/paso, intervalo automático, relleno de límites, poda al fin de turno |
| Proyección `checkpoints` | proyección de sesión | Franja de línea de tiempo plegada desde el log de sesión |
| Línea de tiempo de Ajustes | cliente | Pestaña `Plugins → Checkpoints` con diffs entre pares |

## Modelo de seguridad

- **El historial de git es intocable.** El proveedor git solo ejecuta primitivas sin efectos secundarios de la lista blanca — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`, `cat-file -e` — impuestas por una aserción en tiempo de ejecución, y las referencias de objetos se validan como ids hexadecimales antes de pasarlas a git (un registro manipulado no puede inyectar opciones de git). **Nunca `reset --hard` por defecto, nunca `clean`, nunca mutación de índice/historial** (ver `workspaceRestore` abajo).
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
             ├─ config:   settings write-back (persisted on the profile patch)
             └─ session:  SessionStore.fork(source, boundary) → new child session (original untouched)
```

Registro de decisiones completo, vocabulario de eventos y contrato de la costura de proveedores: [ARCHITECTURE.md](ARCHITECTURE.md).

## Eventos de sesión (nota rc.2)

El plugin declara `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` y `checkpoint/rewind` como miembros `SessionEventMap` solo de log. El harness rc.2 **no tiene superficie de registro de eventos para plugins** y `Session.append` descarta silenciosamente las claves de opciones desconocidas, por lo que añadir tipos desconocidos haría la sesión ilegible al recargarla. Por eso el plugin añade a través de una **puerta adaptativa**: una sonda en tiempo de ejecución (sobre un almacén de sesión separado, nunca persistido) detecta si el `append` del host sella el sobre `ignorable` — en rc.2 la puerta permanece cerrada; en hosts que lo soportan, los eventos `checkpoint/*` se añaden automáticamente con `ignorable: true`. Hasta entonces, la cadena de auditoría autoritativa es `command/run` + `command/done` (conocidos por el harness) más el dominio de almacenamiento durable `checkpoints`.

## Ancla de Web UI

El plugin devuelve el id de la nueva sesión en el resultado del comando (`session: <id>`) y el shell web puede navegar allí. **La unidad de proyección de sesión `checkpoints` viene incluida**: siempre que `ctx.sessionProjections` exista, el plugin registra la unidad vía `ctx.inject` (pliega `checkpoint/snapshot|bound|prune|rewind` en una lista de valor completo) — permanece como lista vacía en hosts rc.2 hasta que una build del harness incluya el vocabulario `checkpoint/*` o el sobre `ignorable`, y entonces se llena sin cambios en el plugin.

## FAQ

**¿Esto reemplaza a git?** No — lo *usa* donde está disponible. En un repo git obtienes objetos de instantánea exactos al byte, deduplicados, sin tocar el historial; en cualquier otro directorio, el proveedor copy hace lo mismo con archivos normales. Los commits regulares siguen siendo tu historial a largo plazo.

**¿Por qué no usar `git reset --hard` por defecto?** Porque destruir estado no es el trabajo de una red de seguridad. El plugin solo crea objetos no referenciados y realiza restauraciones exclusivas del árbol de trabajo y explícitas por ruta por defecto, de modo que un retroceso defectuoso nunca pueda perder el historial, el índice o los archivos creados después del checkpoint. `reset-hard` está disponible detrás de `workspaceRestore: 'reset-hard'` para usuarios que desean explícitamente paridad con CC.

**¿Cuánto tiempo es restaurable un checkpoint?** No se mantiene ninguna referencia para los snapshots de git-provider. Son objetos no referenciados de `stash create`/`commit-tree` por diseño, y `discard` solo elimina el registro de metadatos, dejando el objeto para `git gc`. Dos límites independientes definen la ventana de restauración real: la cuota del plugin (`maxSnapshots` por defecto 50 por sesión; `maxSnapshotBytes` 512 MiB de cuota blanda global aplicada mediante `pruneAll()` en cada captura y limpiada al final de turnos) y el git gc del repositorio host (`gc.pruneExpire` por defecto 2 semanas). Un `git gc --prune=now` manual, repack agresivo o clon fresco los elimina inmediatamente. Los objetos purgados ahora se detectan por adelantado: el proveedor git sondea el objeto de instantánea antes de restaurar (`git cat-file -e`) y falla en voz alta si falta, en lugar de no restaurar nada, y un paso doctor recorre cada registro de checkpoint para sondear la existencia del objeto y marcar los no restaurables (`[UNRESTORABLE: object missing]` en la lista). El paso doctor está implementado y probado, pero aún no está conectado a la ruta de restauración (restore aún no consulta la marca `unrestorable`; seguimiento en discussion #13).

**¿Puedo retroceder a un paso en medio de un turno?** La restauración de archivos es precisa por pasos (`/rewind step <N>` = snapshot más cercano ≤ N). La reproducción de la sesión, sin embargo, respeta la granularidad de reproducción del harness: la sesión hija se inicializa hasta el límite del turno del checkpoint.

**¿Qué pasa si nadie puede responder a la confirmación?** No se toca nada — el plugin cierra en fallo (`unavailable`/`rejected`), conserva el checkpoint y devuelve un error explicativo. Con `confirmVia: approval` en rc.2 el mensaje dice que montes userQuestions, porque approval requiere un turno abierto y los comandos se ejecutan entre turnos.

**¿Puedo deshacer una reversión?** Sí — cada reversión aprobada captura primero un checkpoint de guardia del estado previo a la reversión; el resultado imprime `rewind guard: <id>`, y `/rewind <guard-id>` restaura ese estado.

**¿Cómo direcciono los checkpoints?** Con el **número de sesión** (`/rewind 3` — ver `/rewind list brief`; por sesión, monótono, nunca reutilizado), el prefijo de id único (el id de 8 caracteres de la lista sigue funcionando), `/rewind step <N>` y `/rewind latest`. `/rewind clear` borra los checkpoints de esta sesión y `/rewind clear --all` los borra en todas las sesiones y workspaces (archivos intactos) — ninguno reinicia la numeración. `/rewind preview <target>` usa el mismo direccionamiento para mostrar el impacto sin cambiar nada.

**¿Por qué el número sigue subiendo después de un clear?** Porque un número es una dirección, no una posición: reutilizar `#1` para otro checkpoint tras un clear redirigiría en silencio todo lo que mencionara `#1`. El contador se persiste en el slot global del dominio `checkpoints` y cada registro guarda su propio número, así que podar y limpiar borran instantáneas sin reciclar ids.


**¿Qué hace `preview` — y qué no hace?** Resuelve el checkpoint y ejecuta una comparación de solo lectura: qué archivos se sobrescribirían (o recrearían), cuáles ya coinciden y qué archivos creados después del checkpoint se dejarían en su sitio. Nunca pregunta, nunca escribe, nunca bifurca y no registra ningún evento `checkpoint/rewind` — la puerta de aprobación solo se ejecuta en un `/rewind <id>` real.

## Demo

Una ejecución real de integración headless ensamblada (`npm run test:integration`) recorre el flujo completo: el agente modifica archivos a lo largo de dos turnos, luego `/rewind preview` inspecciona el impacto en modo solo lectura (sin puerta de confirmación, sin escrituras) y `/rewind <id>` restaura los archivos y reproduce la sesión en una nueva sesión hija. La ejecución verifica el contenido de los archivos, el contexto del hijo reproducido, el checkpoint de guardia y la supervivencia de los archivos creados después del checkpoint — para los flujos de proveedor copy y git (el flujo git también verifica que `HEAD` y el reflog quedan intactos). El controlador vive en `test/integration/rewind-headless.mjs`.

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` y `network:none`.
- **Datos**: los registros de checkpoint viven en el dominio de almacenamiento `checkpoints` (filas SQLite o un archivo JSON); las instantáneas de copia viven bajo `snapshotDir`. El **slot global** del dominio guarda los contadores de números cortos por sesión, por lo que borrar registros (`prune`, `clear`, `clear --all`) nunca puede reciclar un número. Totalmente local — sin red, sin credenciales. El dominio se abre en doble versión: los medios de la era 0.4.x (dominio v1) se abren en modo de compatibilidad que mantiene legibles los registros antiguos y guarda las nuevas capturas con la forma v2, de modo que actualizar el plugin nunca deja huérfano un medio existente.
- **Registro de sesión**: los eventos `checkpoint/*` se añaden mediante la puerta adaptativa; la cadena de auditoría autoritativa es `command/run` + `command/done` más el dominio durable.

## Límites de seguridad

- **El historial de git es intocable.** Primitivas sin efectos secundarios de la lista blanca; `reset --hard` solo detrás del modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversión por sobrescritura, nunca borrado.** La restauración sobrescribe solo archivos capturados; los archivos creados después del checkpoint se informan y se dejan en su sitio.
- **Sin escrituras a través de enlaces, sin path traversal.** Los `ref` de copy se validan como ids de instantánea; la restauración se niega a seguir enlaces simbólicos fuera del workspace.
- **La restauración requiere aprobación.** Un answerer ausente o que niega cierra en fallo.
- **La reversión es reversible.** Primero se captura un checkpoint de guardia del estado previo a la reversión.

## Limitaciones conocidas

- En rc.2, los eventos de sesión `checkpoint/*` son suprimidos por la puerta adaptativa; la cadena de auditoría usa `command/run` + `command/done` más el dominio de almacenamiento hasta que un host incluya el vocabulario o el sobre `ignorable`.
- `confirmVia: approval` necesita un turno abierto, y los comandos se ejecutan entre turnos — monta userQuestions (o define `confirmVia: userQuestions`) en rc.2.
- La reversión de sesión **bifurca (fork) una nueva sesión hija** en el límite del checkpoint; nunca reescribe ni trunca la sesión original.
- `workspaceRestore: 'reset-hard'` mueve la cabeza de la rama al commit de la instantánea; está desactivado por defecto.
- Un checkpoint capturado antes de cualquier turno cerrado no tiene límite de reproducción — la reversión de sesión crea entonces una sesión hija nueva con contexto vacío.

## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `/rewind <id>` dice `rewind cancelled: no confirmation answerer` | No hay ningún canal userQuestions/approval montado — el plugin cierra en fallo. Ejecútalo en la Web UI (o monta un proveedor de preguntas); `confirmVia` selecciona el canal. |
| `/rewind <id>` dice `approval requires an open turn …` | Los comandos se ejecutan entre turnos y approval necesita un turno — monta userQuestions o define `confirmVia: userQuestions`. |
| `rewind: checkpoint registry unavailable` | El dominio de almacenamiento `checkpoints` no pudo abrirse. O el servicio `storageDomain` no está compuesto (añade las filas de la pila de almacenamiento de Inicio rápido: `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` con config `root` + `@deepseek-ai/dsh-storage-domain` con config `backend: json`) o el backend tiene errores; revisa los logs del harness. |
| Un checkpoint aparece como `fork: pending (turn not closed)` | Su turno aún no tiene `turn/end`; los archivos aún pueden restaurarse, pero la reproducción de la sesión espera a que el turno se cierre. |
| `files restored … but the session was NOT replayed` | La fase de sesión de la transacción falló (sin límite cerrado, o reproducción rechazada). Los archivos siguen restaurados; usa el `rewind guard: <id>` impreso para deshacer. |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` rechazó la reversión porque falló la captura de la guardia; arregla el almacenamiento (o define `warn`/`off`). |
| Un checkpoint aparece como `(copy)` aunque el directorio es un repo | HEAD no nacido (sin commit inicial): las primitivas de instantánea git requieren HEAD, así que el plugin degrada a `copy` hasta el primer commit. |
| `MISSING_CREDENTIAL` en ejecuciones headless | No relacionado con este plugin: no hay `DEEPSEEK_API_KEY` configurada para el proveedor del modelo. |
| El almacenamiento de instantáneas crece | La poda corre después de cada instantánea y en `turn/end` (`pruneOnTurnEnd`); baja `maxSnapshots` / `maxSnapshotBytes`, ejecuta `/rewind clear`, o borra `$DSH_HOME/dsh-checkpoint-rewind` después de desinstalar. |

## Desarrollo

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.2-rc.1, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de proveedores)
npm run test:integration  # verificación headless ensamblada (test/integration/)
```

Sin paso de build: ESM puro — `index.mjs`/`lib/` son los artefactos publicados.

## Temas

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el modelo de checkpoint de tres estados, la costura de proveedores git/copy, la transacción de reversión en tres fases, la línea de tiempo de Ajustes, la documentación, CI/CD y releases.
- [@tmpdot](https://github.com/tmpdot) (rmUnlucky) — compatibilidad de doble versión para medios v1 (#8), resolución perezosa de `storageDomain` (#9), pistas de respuesta en la deduplicación de checkpoints (#10) y el informe del bug del directorio de instantáneas con `$DSH_HOME` sin definir (#4).
- [@shipinliang](https://github.com/shipinliang) — informes del contrato wire del panel de checkpoints: el `acceptsUndefined` ausente en el parámetro `limit` (#5) y el fallo de proxy por el campo privado `#deps` (#6).
- [@hwz1456](https://github.com/hwz1456) — informe de captura de checkpoints en el perfil web (#3).
- [@Andiii208](https://github.com/Andiii208) — informe de la especificación de publicación de `plugin_check` (#2).
- [@alexchenzl](https://github.com/alexchenzl) (Ashu) — invitación al listado del DSH Directory (#7).

### Instalar desde el mercado de DSH Desktop

Todos los plugins de PerryLink pueden explorarse en el mercado integrado de DSH Desktop: **Market → Sources → add source → pegar** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ seleccionarlo**. La instalación sigue pasando por la verificación de identidad npm del mercado y tu confirmación.

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors


## Interoperabilidad con otros plugins de DSH

Verificado contra **DSH `0.2.0-rc.2`** (el runtime para el que se publica este README) y el conjunto de plugins con más estrellas sondeado el 2026-10-05.

Este plugin **no interfiere** con otros plugins, incluidos los de más estrellas:

- **Sin colisión de nombres de herramienta.** Todas las herramientas llevan espacio de nombres; ninguna ocupa un nombre desnudo ya perteneciente a una herramienta incluida u otro plugin.
- **Sin colisión de clave de servicio.** No provee ninguna clave de servicio, así que no puede colisionar en una.
- **Sin colisión de slot.** No registra ninguna clave de slot de cliente, así que no disputa un asiento `shadows-shipped-ui`.
- **Sin colisión de ruta HTTP.** No registra ningún prefijo `webServer`.
- **Sin colisión en la capa de patch.** El patch del bundle solo hace `insert` de su propia fila; nunca sobrescribe el `config` de una fila incluida.
- **Sin mutación global.** No parchea prototipos, ni reescribe `process.env`, ni reemplaza el dispatcher global de fetch.

**Los listeners de eventos compartidos no interfieren por construcción.** Observa los eventos sensibles al orden `fs/edit-intent`, `fs/write-intent`, `tools/pre-execute` con `ctx.on()` — el registro de difusión de Cordis, donde cada listener se ejecuta y ninguno puede dejar sin turno a otro. **Todos los listeners aquí delegan por `next()`**, así que la cadena nunca se cortocircuita:
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Evidencia estática: `dsh-plugin-doctor` K10–K13 dan `pass` en todas las comprobaciones de este repositorio.

## Familia de plugins DSH de PerryLink

Este proyecto es uno de los **87 plugins activamente mantenidos** de DeepSeek Harness de [PerryLink](https://github.com/PerryLink). El registro familiar tiene **95** plugins — **5 congelados**, **3 retirados** — y permanece plegado abajo para que cada README conserve una primera pantalla corta. Expándelo para ver cada fila, con el motivo en la columna Estado.

<details>
<summary>Expandir los 95 plugins</summary>

| Plugin | Una línea | Estado |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** | 应急演练脚本核对（按阶段、响应分级、指挥与资源要素核对脚本齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** | 环评导则适用性核对（按要素、导则名称与执行标准核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** | 应急预案要素齐备性与条款级页码定位（依据 GB/T 29639-2020 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** | 作文量表评分核对（按评分项、原文定位与分值算术核对评分自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** | 证据清单齐备性核对（按待证事实与证据要素核对清单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** | 出口管制物项核对（按管制清单、最终用途与许可证核对台账齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** | FMEA 分析表要素齐备性与风险顺序数一致性核对（按公开的 FMEA 方法标准核对表内自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** | 预测准确率考核核对（按准确率、门槛与考核单价核对考核费用的算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** | 公文流转与办理时限核对（按公开的公文处理规范核对环节完整性与时限，仅提示差异，不作出定性结论） |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** | 公文格式要素核对（按公开的党政机关公文格式标准核对版头与主体要素，仅提示差异，不作出定性结论） |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** | 劳动保护与安全防护用品配置表核对（按公开的配备标准核对品名规格与配置数量，仅提示差异，不作出定性结论） |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** | 危险化学品临界量与重大危险源辨识核对（按储存量与临界量核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** | HAZOP 分析表要素齐备性与偏差推导一致性核对（依据公开的危险与可操作性分析标准，仅提示差异，不作出定性结论） |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** | 安全隐患台账→《工贸企业重大事故隐患判定标准》（应急管理部令第10号）条款映射提示（仅提示差异，不作出定性结论） |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** | 商品归类层级一致性核对（按章、品目、子目与商品编号的层级关系核对自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** | ICD 合并编码与星剑号配对提示（依据 GB/T 14396-2016 与公开的 ICD 使用说明，仅提示差异，不作出定性结论） |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** | 法条引用与文书要素核对（按名称、条号、原文与效力状态核对引用可核验性，仅提示差异，不作出定性结论） |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** | 信用证单据条款核对（按单据种类、份数、期限与不符点核对交单自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** | 能力差距与培养计划核对（按能力等级差、培养措施与完成期限核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** | 病案首页形式质控与逻辑矛盾提示（依据国卫办医发〔2016〕24号等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** | 国家自然科学基金申请书形式审查与匿名化提示（依据《国家自然科学基金条例》与申请人导入的当年指南，仅提示差异，不作出定性结论） |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** | 护理记录时限、签名与评估表完整性校验（依据《病历书写基本规范》等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** | 原产地区域价值成分核对（按 RVC 定义式与门槛核对原产地判定自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** | 在线点评回复台账核对（按回复时限、问题分类与整改状态核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** | 试卷解析结构核对（按题型、答案、分值与 yotta 标识核对试卷结构自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** | 行政许可办理核对（按申请材料、法定时限与决定记录核对台账闭环，仅提示差异，不作出定性结论） |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** | 项目全流程文件链条核对（按环节先后与金额口径核对链条自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** | 起诉状要素齐备性核对（按诉请、事实、证据、法条四要素核对文书齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** | 政策专报要素核对（按观点、依据、出处与建议核对专报齐备，仅提示差异，不作出定性结论） |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** | 线损电量拆分与考核表核对（依据公开的线损计算口径，仅提示差异，不作出定性结论） |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** | 电力工作票要素齐备性与签发许可顺序核对（依据现行电力安全工作规程，仅提示差异，不作出定性结论） |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** | PPAP 提交要素齐备性核对（按公开的 PPAP 手册与提交等级核对要素齐备与版本填写，仅提示差异，不作出定性结论） |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** | 质疑与投诉期限核对（按公开的政府采购质疑投诉规定核对期限与台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** | 铁路施工天窗台账核对（按时间窗、时长算术与命令号核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver el README del repositorio |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver el README del repositorio |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>