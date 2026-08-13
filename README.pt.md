# dsh-checkpoint-rewind

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · **Português** · [हिन्दी](README.hi.md)

**O `/rewind` do Claude Code, feito direito para o DeepSeek Harness.**

Um plugin de capability-seam que adiciona **snapshots de arquivos do workspace + retrocesso por limite de sessão** ao [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): antes de cada ferramenta mutadora o plugin captura o workspace (git primeiro, cópia como fallback) e um único comando `/rewind` restaura os arquivos **e** bifurca (fork) a sessão até o limite de turno do checkpoint — o contexto do modelo e os arquivos em disco sempre concordam.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](#)
[![Harness](https://img.shields.io/badge/dsh-0.1.0--rc.6-8a2be2.svg)](#)

> **Topics**: `dsh` · `dsh-plugin` · `deepseek-harness` · `rewind` · `checkpoint` · `session-fork` · `workspace-safety` · `undo` · `cordis-plugin`

---

## Por que outro plugin de rewind?

| Plugin | O que vende | Restaura arquivos? | Retrocede a sessão? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (este) | snapshots com objetos git + fork por turno + restauração em um passo | ✅ estado completo do workspace | ✅ sessão filha via fork |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | Change Ledger persistente de deltas por mutação | ✅ repetindo deltas inversos | ✅ modelo próprio de ledger |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | retrocesso só de contexto até o último passo concluído | ❌ | ✅ só contexto |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | retirada de mensagens (remove o turno e tudo depois) | ❌ (explicitamente) | ✅ remoção de turno |

A diferença em uma frase: **o dsh-checkpoint-rewind captura o *estado do workspace* com primitivas git sem efeitos colaterais antes de cada mutação e transforma «voltar ao passo N» em um comando aprovado — arquivos restaurados primeiro, sessão bifurcada depois, cada fase registrada.** Sem livro de deltas que dessincroniza, sem edição de mensagens (isso é outro plugin), sem sincronização entre dispositivos.

## Funcionalidades

- **Snapshots antes de cada mutação** — listener pass-through com `prepend` em `fs/write-intent` / `fs/edit-intent` mais `tools/pre-execute` para mutadores não-fs (`bash`, …), cobrindo *todos* os caminhos de mudança sem roubar o slot de decisão da política.
- **Provider seam** — `git` primeiro: `git stash create` / `git commit-tree` produzem objetos de snapshot sem referência que **nunca tocam worktree, índice ou histórico**; a restauração é `git restore` somente-worktree. Diretórios sem git degradam para `copy` (snapshots incrementais com hardlinks), claramente rotulados na lista.
- **Mapeamento por passo, forks por turno** — cada checkpoint registra seu turno/passo; `step/end` preenche o mapeamento de passos («voltar ao passo N» = snapshot mais próximo ≤ N) e `turn/end` preenche o limite do fork, usando o primitivo real `ctx.sessions.fork` do harness.
- **Transação de rewind em duas fases** — `/rewind <id>` pede confirmação (seam userQuestions / approval, **fail-closed sem respondedor**), restaura arquivos primeiro e então bifurca; falha de restauração nunca bifurca, falha de fork relata «arquivos restaurados, sessão não bifurcada» e mantém o checkpoint.
- **Registro durável + cotas** — os registros vivem em `ctx.storageDomain` (domínio `checkpoints`; backend SQLite = linhas, backend JSON = arquivo legível); `maxSnapshots` (por sessão, 50 por padrão), `maxSnapshotBytes` (global, 512 MiB por padrão), `pruneOnTurnEnd`, mais-antigo-primeiro.
- **Reconstruível por design** — a saída do `/rewind` trafega nos eventos próprios do harness `command/run` + `command/done`; os eventos `checkpoint/snapshot|bound|prune|rewind` estão declarados e são anexados automaticamente quando um build do host os conhecer (porta adaptativa rc.6).

## Início rápido

`dsh-checkpoint-rewind` é distribuído como **bundle plugin** (sem etapa de build, ESM puro):

```sh
dsh plugin add dsh-checkpoint-rewind    # entra na pilha de bundles do perfil
# reinicie o dsh — o /rewind já está ativo na Web UI.
```

Ou monte diretamente para experimentar:

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

As mutações do workspace agora criam checkpoints automaticamente:

```text
/rewind
```

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4-e5f6-… · (git) · turn 2 step 1 · 2026-08-14 12:00:01 · trigger: bash · 4 files · 1.2 MiB · fork: ready
#b2c3d4e5-f6a7-… · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB · fork: ready
#c3d4e5f6-a7b8-… · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB · fork: pending (turn not closed)
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

```text
/rewind b2c3d4e5-f6a7-…
```

O plugin pergunta **«Restore the workspace files to this checkpoint and fork the session?»** → ao aprovar, restaura os arquivos, bifurca a sessão no limite de turno do checkpoint e devolve o id da nova sessão:

```text
rewind: restored 2 file(s) from checkpoint b2c3d4e5-f6a7-… (provider git)
and forked a new session at seq 87 (end of turn 2).
session: session-123
Open the new session to continue from before that turn; this session keeps its later history.
```

Execuções headless imprimem o mesmo resultado com orientação de retomada; o shell Web pode navegar usando o `session:` devolvido (veja [âncora Web UI](#âncora-web-ui)).

## Configuração

Tudo é um campo de `Config` (alterável via cordis.yml; nada é hardcoded):

| Chave | Padrão | Significado |
|---|---:|---|
| `enabled` | `true` | Chave mestra; `false` remove comando, listeners e providers. |
| `provider` | `auto` | Provider de snapshot: `auto` (git se disponível, senão copy) · `git` (falha alto em diretórios sem git) · `copy`. |
| `gitBin` | `git` | Caminho do executável git. |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | Raiz dos snapshots do provider copy. |
| `maxSnapshots` | `50` | Checkpoints mantidos **por sessão** (mais antigo podado primeiro). |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Cota global de conteúdo entre sessões (mais antigo primeiro). |
| `pruneOnTurnEnd` | `true` | Executa a poda de cota ao fim de um turno. |
| `mutationTools` | `['bash','write','edit','str_replace_editor']` | Ferramentas tratadas como mutadoras em `tools/pre-execute` (as fs já são cobertas por `fs/*-intent`). |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | Diretórios/arquivos pulados pelo provider copy (`.git` e o diretório de snapshots são sempre excluídos). |
| `confirmVia` | `auto` | Canal de confirmação: `auto` (userQuestions primeiro, depois approval) · `userQuestions` · `approval`. |
| `listLimit` | `10` | Checkpoints mostrados pelo `/rewind` sem argumentos. |

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
```

## Modelo de segurança

- **O histórico do git é intocável.** O provider git só executa primitivas sem efeitos colaterais de uma whitelist — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse` — aplicada por asserção em runtime. **Nada de `reset --hard`, nada de `clean`, jamais mutar índice ou histórico.**
- **Restaurar exige aprovação.** Sobrescrever arquivos do usuário sempre passa pelo seam de confirmação com semântica `ask`; um respondedor ausente, que lança erro ou que nega **fecha em falso**.
- **Rollback por sobrescrita, nunca exclusão.** Ambos os providers restauram arquivos capturados e *relatam* arquivos criados depois do checkpoint (git: sem rastreamento; copy: extras do manifest) em vez de apagá-los.
- **Transação de duas fases, ordem fixa.** Arquivos primeiro, fork depois; cada fase é registrada; uma restauração falha deixa arquivos, checkpoints e sessão intactos.
- **Visível para o modelo ⟺ registrado.** Tudo o que usuários ou modelos veem é reconstruível a partir do log da sessão (`command/run` + `command/done` e, quando o host os conhecer, os eventos `checkpoint/*`) mais o domínio durável `checkpoints`.

## Como funciona

`checkpoint/snapshot` (criação) → `checkpoint/bound` (preenchimento de step/end e turn/end) → `/rewind` (listar / confirmar / restaurar em duas fases). Registro completo de decisões, vocabulário de eventos e contrato do provider seam: [ARCHITECTURE.md](ARCHITECTURE.md).

## Eventos de sessão (nota rc.6)

O plugin declara `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` e `checkpoint/rewind` como membros log-only de `SessionEventMap`. O harness rc.6 **não tem superfície de registro de eventos para plugins** e `Session.append` não consegue marcar tipos desconhecidos como `ignorable`, então anexá-los tornaria a sessão ilegível ao recarregar. O plugin anexa eventos por uma **porta adaptativa** (`KNOWN_SESSION_EVENT_TYPES`): hoje são pulados e passam a funcionar automaticamente quando um build do host incluir os tipos. Até lá, a cadeia de auditoria autoritativa é `command/run` + `command/done` (conhecidos do harness) mais o domínio durável `checkpoints`.

## Âncora Web UI

O plugin já devolve o id da nova sessão no resultado do comando (`session: <id>`) e o shell Web pode navegar até lá. A faixa de checkpoints está planejada como unidade de projeção de sessão `checkpoints` (dobra `checkpoint/snapshot|bound|prune|rewind` num valor de lista completa, `stateVersion` 0) mais um painel somente-leitura no shell — um acompanhamento pendente de um build do harness com o vocabulário `checkpoint/*`; veja [ARCHITECTURE.md](ARCHITECTURE.md#todo-web-ui-checkpoint-strip).

## Testes

```sh
npm install
npm test                 # 53 testes unitários: criação/dedup/concorrência de snapshots, caminhos git e não-git,
                         # mapeamento de limite ≤N, cotas de poda, matriz de falhas de duas fases, rejeição de
                         # aprovação, porta adaptativa de eventos (Cordis real + SessionStore/CommandRuntime reais)
npm run test:integration # verificação headless montada: o agente modifica 2 arquivos em 2 turnos,
                         # /rewind lista → restaura → conteúdos e contexto do fork assegurados
```

## Licença

Apache License 2.0 — veja [LICENSE](LICENSE) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Plugins relacionados

- [dsh-memento](https://github.com/…/dsh-memento) — memória entre sessões limitada e com porta de aprovação (mesmas convenções de plugin).
- [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) · [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) — as alternativas das quais este plugin se diferencia (tabela acima).
