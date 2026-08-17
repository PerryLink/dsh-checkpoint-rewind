<div align="center">

# ⏪ dsh-checkpoint-rewind

**Checkpoints unificados do DeepSeek Harness — instantâneos de três estados (sessão + workspace + configuração) com reversão de um só passo.**

*O equivalente aos Checkpoints do Claude Code, construído como plugin de costura de capacidade: capture antes de cada mutação, restaure qualquer um dos três estados com um único comando aprovado.*

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

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fixados em `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (comandos + listeners de host; linha do tempo de Configurações opcional via capacidade settings) |
| Modelo | Qualquer (sem chamadas ao modelo — instantâneos e restaurações são determinísticos) |

## O que você recebe

O `dsh-checkpoint-rewind` captura um **checkpoint unificado de três estados** — workspace, cursor de sessão e configuração do plugin — e restaura um ou os três com um único comando aprovado:

1. **Registro de três estados** — cada checkpoint guarda o estado do workspace (SHA da árvore git, ou um manifesto de cópia), o cursor de eventos da sessão (`seq` + limite de turno) e uma instantânea de configuração, rotulado por origem (`manual` / `auto` / `guard` / `mutation`).
2. **Quatro disparadores de captura** — antes de cada ferramenta de mutação (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), no intervalo automático (`autoCheckpoint`, padrão a cada passo), manualmente (`/checkpoint` e a ferramenta `checkpoint`), e como guarda antes de cada reversão.
3. **Provedor git primeiro** — `git stash create` / `commit-tree` produzem objetos de instantâneo não referenciados que nunca tocam seu worktree, índice ou histórico; a restauração é somente-worktree e por caminhos explícitos. Diretórios não git (e repositórios com HEAD não nascido) degradam para um provedor `copy` incremental com reuso de hardlinks.
4. **Reversão de um só passo** — `/rewind workspace|session|config|all <target>` restaura os estados selecionados; `preview` é um relatório de impacto somente leitura, `diff <a> <b>` compara dois checkpoints, `clear` os exclui.
5. **Reversão de sessão por reprodução de semente** — a reversão de sessão reproduz eventos até o limite do checkpoint pela API oficial `sessions.create` com semente, criando uma nova sessão filha; a sessão original mantém seu histórico completo.
6. **Linha do tempo em Configurações** — a aba `Plugins → Checkpoints` renderiza os checkpoints da sessão com diffs linha a linha entre pares.

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

O pacote é ESM puro sem etapa de build — `index.mjs` e `lib/` são os artefatos enviados. As mutações do workspace agora criam checkpoints automaticamente; execute `/rewind` para listá-los.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — ESM puro, sem etapa de `prepare` nem `allowBuilds`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **Canal tarball**: `npm pack` neste repo e depois `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **Desinstalar**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — os arquivos de instantâneo permanecem até você excluir `$DSH_HOME/dsh-checkpoint-rewind`; os objetos git são coletados pelo garbage collector.

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Nada é hardcoded.

| Chave | Padrão | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; em `false`, remove comandos, listeners e provedores por completo |
| `provider` | `auto` | Provedor de instantâneo: `auto` (git se disponível, senão copy) · `git` · `copy` |
| `gitBin` | `git` | Caminho do executável git |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | Raiz dos instantâneos do provedor copy |
| `maxSnapshots` | `50` | Checkpoints mantidos por sessão (os mais antigos podados primeiro) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Cota branda global de bytes incrementais (o mais novo por sessão sempre é mantido) |
| `pruneOnTurnEnd` | `true` | Executa a poda de cota ao fim de um turno |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | Ferramentas tratadas como mutantes em `tools/pre-execute` |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | Padrões glob omitidos pelo provedor copy |
| `confirmVia` | `auto` | Canal de confirmação: `auto` (userQuestions primeiro) · `userQuestions` · `approval` |
| `listLimit` | `10` | Checkpoints mostrados pelo `/rewind` sem argumentos |
| `preRewindCheckpoint` | `warn` | Checkpoint de guarda antes de restaurar: `warn` · `require` · `off` |
| `verifyByHash` | `false` | Comparação por hash de conteúdo e verificação de restauração do provedor copy |
| `autoCheckpoint.enabled` | `true` | Instantâneos automáticos por intervalo em `step/start` |
| `autoCheckpoint.intervalMinutes` | `0` | Intervalo; `0` = a cada passo |
| `workspaceRestore` | `restore` | Reversão do workspace: `restore` (sobrescrita segura) · `reset-hard` (estilo CC, opt-in) |
| `promptSection` | `true` | Injeta uma seção breve de papel no prompt |
| `checkpointTool` | `true` | Registra a ferramenta de modelo `checkpoint` |

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `/rewind` | comando | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear` |
| `/checkpoint` | comando | `[note <text>\|list\|diff <a> <b>]` — captura um checkpoint manual |
| `checkpoint` | ferramenta | Captura um checkpoint manual com nota opcional |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Captura pré-mutação (prepend pass-through; nunca rouba a vaga de política) |
| `session/event` | listener | Rastreamento de turno/passo, intervalo automático, preenchimento de limites, poda no fim de turno |
| Projeção `checkpoints` | projeção de sessão | Faixa de linha do tempo dobrada a partir do log da sessão |
| Linha do tempo de Configurações | cliente | Aba `Plugins → Checkpoints` com diffs entre pares |

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` e `network:none`.
- **Dados**: os registros de checkpoint vivem no domínio de armazenamento `checkpoints` (linhas SQLite ou um arquivo JSON); os instantâneos de cópia vivem sob `snapshotDir`. Totalmente local — sem rede, sem credenciais.
- **Log de sessão**: os eventos `checkpoint/*` são anexados por uma porta adaptativa (somente quando o host conhece os tipos ou admite o sobre `ignorable`); a cadeia de auditoria autoritativa é `command/run` + `command/done` mais o domínio durável.

## Limites de segurança

- **O histórico git é intocável.** O provedor git só executa primitivas sem efeitos colaterais da lista branca (`stash create`, `commit-tree`, `restore --worktree`, …); `reset --hard` só existe atrás do modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversão por sobrescrita, nunca exclusão.** A restauração sobrescreve apenas arquivos capturados; arquivos criados após o checkpoint são informados e deixados no lugar.
- **Sem escritas através de links, sem path traversal.** Os `ref` de copy são validados como ids de instantâneo; a restauração se recusa a seguir links simbólicos para fora do workspace.
- **A restauração exige aprovação.** Sobrescrever arquivos do usuário sempre passa pela costura de confirmação; um answerer ausente ou que nega fecha em falha.
- **A reversão é reversível.** Um checkpoint de guarda do estado pré-reversão é capturado primeiro; `/rewind <guard-id>` desfaz a reversão.
- **Visível ao modelo ⟺ registrado.** Tudo o que um usuário ou modelo vê se reconstrói a partir de `command/run` + `command/done` e do domínio durável `checkpoints`.

## Limitações conhecidas

- No rc.6, os eventos de sessão `checkpoint/*` são suprimidos pela porta adaptativa (o host não conhece os tipos); a cadeia de auditoria usa `command/run` + `command/done` mais o domínio de armazenamento até que um host envie o vocabulário ou o sobre `ignorable`.
- `confirmVia: approval` precisa de um turno aberto, e os comandos rodam entre turnos — monte userQuestions (ou defina `confirmVia: userQuestions`) no rc.6.
- A reversão de sessão cria uma **nova sessão filha** semeada a partir do limite do checkpoint; ela nunca reescreve nem trunca a sessão original.
- `workspaceRestore: 'reset-hard'` é equivalente ao CC e move a cabeça da ramificação para o commit do instantâneo; está desativado por padrão.

## Desenvolvimento

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de provedores)
npm run test:integration  # verificação headless montada (test/integration/)
```

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o modelo de checkpoint de três estados, a costura de provedores git/copy, a transação de reversão em três fases, a linha do tempo de Configurações, a documentação, CI/CD e releases.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
