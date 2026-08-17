<div align="center">

# ⏪ dsh-checkpoint-rewind

**Checkpoints unificados do DeepSeek Harness — instantâneos de três estados (sessão + workspace + configuração) com reversão de um só passo.**

*O equivalente aos Checkpoints do Claude Code, construído como plugin de costura de capacidade (capability-seam): capture antes de cada mutação, restaure qualquer um dos três estados com um único comando aprovado.*

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

## Por que outro plugin de rewind?

| Plugin | O que vende | Restaura arquivos? | Rebobina a sessão? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (este) | instantâneos de objetos git + reversão de três estados + restauração de um só passo | ✅ estado completo do workspace | ✅ sessão filha por reprodução de semente |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | Change Ledger persistente de deltas por mutação | ✅ reproduzindo deltas inversos | ✅ seu próprio modelo de ledger |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | reversão pura de contexto para o último passo concluído | ❌ | ✅ somente contexto |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | recall de mensagens (remove um turno e tudo depois) | ❌ (explicitamente) | ✅ remoção de turno |

A diferença em uma frase: **o dsh-checkpoint-rewind captura o *estado do workspace* com primitivas git sem efeitos colaterais antes de cada mutação e torna “voltar ao passo N” um único comando aprovado — primeiro o checkpoint de guarda, depois os arquivos restaurados, depois a configuração restaurada, depois a sessão reproduzida, cada fase registrada.** Sem contabilidade de deltas para derivar, sem edição em nível de mensagem (isso pertence a outro plugin), sem sincronização entre dispositivos.

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

Os checkpoints persistem pelo serviço `storageDomain`. O plugin monta sem ele e nunca bloqueia a inicialização do perfil — os comandos checkpoint/rewind devolvem então um erro estruturado indicando as linhas exatas a adicionar. Componha a pilha de armazenamento uma vez para habilitá-los:

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

O pacote é ESM puro sem etapa de build — `index.mjs` e `lib/` são os artefatos enviados. As mutações do workspace agora criam checkpoints automaticamente; execute `/rewind` para listá-los:

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

Enderece um checkpoint pelo prefixo de id único, pelo número do passo ou por `latest`:

```text
/rewind b2c3d4e5
/rewind step 2
/rewind latest
/rewind preview b2c3d4e5   # somente leitura: mostra quais arquivos mudariam, não toca nada
/rewind clear              # exclusão confirmada dos checkpoints desta sessão (arquivos intactos)
```

`preview` resolve pelo mesmo endereçamento e imprime o impacto sem pedir confirmação nem escrever nada.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — ESM puro, sem etapa de `prepare` nem `allowBuilds`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **Canal tarball**: `npm pack` neste repo e depois `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **Pilha de armazenamento** (necessária para checkpoints, opcional para montar): `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` (config `root`) + `@deepseek-ai/dsh-storage-domain` (config `backend: json`) — veja Início rápido; o plugin monta mesmo sem ela e cada comando explica a correção.
- **Desinstalar**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — os arquivos de instantâneo permanecem até você excluir `$DSH_HOME/dsh-checkpoint-rewind`; os objetos git são coletados pelo garbage collector.

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Nada é hardcoded.

| Chave | Padrão | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; em `false`, remove comandos, listeners e provedores por completo |
| `provider` | `auto` | Provedor de instantâneo: `auto` (git se disponível, senão copy) · `git` · `copy` |
| `gitBin` | `git` | Caminho do executável git |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` (recurso `~/.dsh/dsh-checkpoint-rewind` quando `$DSH_HOME` não está definido) | Raiz dos instantâneos do provedor copy |
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

## Modelo de segurança

- **O histórico git é intocável.** O provedor git só executa primitivas sem efeitos colaterais da lista branca — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse` — impostas por uma asserção em tempo de execução, e as referências de objetos são validadas como ids hexadecimais antes de serem passadas ao git (um registro adulterado não pode injetar opções do git). **Nunca `reset --hard` por padrão, nunca `clean`, nunca mutação de índice/histórico** (ver `workspaceRestore` abaixo).
- **Reversão por sobrescrita, nunca exclusão.** A restauração sobrescreve apenas arquivos capturados, e o provedor git restaura **caminhos explícitos** (`git restore … -- .` excluiria arquivos adicionados com `git add` após o checkpoint). Arquivos criados após o checkpoint (não rastreados **ou** staged) são *informados* e deixados no lugar.
- **Sem escritas através de links, sem path traversal.** O provedor copy valida as referências de checkpoint antes de juntá-las aos caminhos do diretório de instantâneos, e se recusa a restaurar através de um destino (ou ancestral) que tenha se tornado um link simbólico — assim uma restauração nunca pode seguir um link para fora do workspace.
- **A restauração exige aprovação.** Sobrescrever arquivos do usuário sempre passa pela costura de confirmação com semântica `ask`; um answerer ausente, que lança erro ou que responde “não” **fecha em falha**. `/rewind preview` é a forma somente leitura de inspecionar o impacto primeiro.
- **A reversão é reversível.** Antes de restaurar, um checkpoint de guarda captura o estado atual; restaurar a guarda desfaz a reversão. `preRewindCheckpoint: require` aborta a reversão quando a guarda não pode ser capturada.
- **Transação de ordem fixa.** Primeiro a guarda, depois o workspace, depois a configuração, depois a reprodução da sessão; cada fase é registrada; uma restauração com falha deixa arquivos, checkpoints e sessão intactos.
- **`workspaceRestore: 'reset-hard'` é equivalente ao CC e opt-in.** Ele executa `git reset --hard <snapshot commit>` (a cabeça da ramificação se move para o commit do instantâneo; o histórico anterior ao instantâneo permanece recuperável via reflog; arquivos não rastreados não são tocados). Está desativado por padrão.
- **Visível ao modelo ⟺ registrado.** Tudo o que um usuário ou modelo vê se reconstrói a partir de `command/run` + `command/done` (e, quando o host os conhecer, dos eventos `checkpoint/*`) mais o domínio durável `checkpoints`.

## Como funciona

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

Registro de decisões completo, vocabulário de eventos e contrato da costura de provedores: [ARCHITECTURE.md](ARCHITECTURE.md).

## Eventos de sessão (nota rc.6)

O plugin declara `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` e `checkpoint/rewind` como membros `SessionEventMap` apenas de log. O harness rc.6 **não tem superfície de registro de eventos para plugins** e `Session.append` descarta silenciosamente chaves de opções desconhecidas, então anexar tipos desconhecidos tornaria a sessão ilegível ao recarregar. Por isso o plugin anexa através de uma **porta adaptativa**: uma sonda em tempo de execução (em um armazenamento de sessão separado, nunca persistido) detecta se o `append` do host sela o envelope `ignorable` — no rc.6 a porta permanece fechada; em hosts que o suportam, os eventos `checkpoint/*` são anexados automaticamente com `ignorable: true`. Até lá, a cadeia de auditoria autoritativa é `command/run` + `command/done` (conhecidos pelo harness) mais o domínio de armazenamento durável `checkpoints`.

## Âncora da Web UI

O plugin retorna o id da nova sessão no resultado do comando (`session: <id>`) e o shell web pode navegar até lá. **A unidade de projeção de sessão `checkpoints` é enviada**: sempre que `ctx.sessionProjections` existir, o plugin registra a unidade via `ctx.inject` (dobra `checkpoint/snapshot|bound|prune|rewind` em uma lista de valor completo) — ela permanece uma lista vazia em hosts rc.6 até que uma build do harness envie o vocabulário `checkpoint/*` ou o envelope `ignorable`, e então se preenche sem mudanças no plugin.

## FAQ

**Isso substitui o git?** Não — ele *usa* o git onde disponível. Em um repositório git você obtém objetos de instantâneo exatos ao byte, deduplicados, sem tocar o histórico; em qualquer outro diretório, o provedor copy faz o mesmo com arquivos normais. Commits regulares continuam sendo seu histórico de longo prazo.

**Por que não `git reset --hard` por padrão?** Porque destruir estado não é o trabalho de uma rede de segurança. Por padrão, o plugin só cria objetos não referenciados e realiza restaurações somente-worktree e por caminhos explícitos, então uma reversão ruim nunca pode perder histórico, o índice nem arquivos criados após o checkpoint. `reset-hard` está disponível atrás de `workspaceRestore: 'reset-hard'` para usuários que queiram explicitamente paridade com o CC.

**Posso rebobinar para um passo no meio de um turno?** A restauração de arquivos é precisa a nível de passo (`/rewind step <N>` = instantâneo mais próximo ≤ N). No entanto, a reprodução da sessão respeita a granularidade de reprodução do harness: a sessão filha é semeada até o limite de turno do checkpoint.

**O que acontece se ninguém puder responder à confirmação?** Nada é tocado — o plugin fecha em falha (`unavailable`/`rejected`), mantém o checkpoint e retorna um erro explicativo. Com `confirmVia: approval` no rc.6, a mensagem diz para montar userQuestions, porque approval exige um turno aberto e os comandos rodam entre turnos.

**Posso desfazer uma reversão?** Sim — toda reversão aprovada captura primeiro um checkpoint de guarda do estado pré-reversão; o resultado imprime `rewind guard: <id>`, e `/rewind <guard-id>` restaura esse estado.

**Como endereço os checkpoints?** Prefixo de id único (serve o id curto de 8 caracteres da lista), `/rewind step <N>`, `/rewind latest`, ou `/rewind clear` para excluir os checkpoints desta sessão (arquivos intactos). `/rewind preview <target>` usa o mesmo endereçamento para mostrar o impacto sem mudar nada.

**O que o `preview` faz — e o que não faz?** Ele resolve o checkpoint e executa uma comparação somente leitura: quais arquivos seriam sobrescritos (ou recriados), quais já coincidem e quais arquivos criados após o checkpoint seriam deixados no lugar. Ele nunca pergunta, nunca escreve, nunca bifurca e não registra nenhum evento `checkpoint/rewind` — a porta de aprovação só roda em um `/rewind <id>` real.

## Demonstração

Uma execução real de integração headless montada (`npm run test:integration`) percorre o fluxo completo: o agente modifica arquivos ao longo de dois turnos, então `/rewind preview` inspeciona o impacto em modo somente leitura (sem porta de confirmação, sem escritas) e `/rewind <id>` restaura os arquivos e reproduz a sessão em uma nova sessão filha. A execução verifica o conteúdo dos arquivos, o contexto do filho reproduzido, o checkpoint de guarda e a sobrevivência dos arquivos criados após o checkpoint — para os fluxos dos provedores copy e git (o fluxo git também verifica que `HEAD` e o reflog permanecem intactos). O driver vive em `test/integration/rewind-headless.mjs`.

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` e `network:none`.
- **Dados**: os registros de checkpoint vivem no domínio de armazenamento `checkpoints` (linhas SQLite ou um arquivo JSON); os instantâneos de cópia vivem sob `snapshotDir`. Totalmente local — sem rede, sem credenciais.
- **Log de sessão**: os eventos `checkpoint/*` são anexados pela porta adaptativa; a cadeia de auditoria autoritativa é `command/run` + `command/done` mais o domínio durável.

## Limites de segurança

- **O histórico git é intocável.** Primitivas sem efeitos colaterais da lista branca; `reset --hard` só atrás do modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversão por sobrescrita, nunca exclusão.** A restauração sobrescreve apenas arquivos capturados; arquivos criados após o checkpoint são informados e deixados no lugar.
- **Sem escritas através de links, sem path traversal.** Os `ref` de copy são validados como ids de instantâneo; a restauração se recusa a seguir links simbólicos para fora do workspace.
- **A restauração exige aprovação.** Um answerer ausente ou que nega fecha em falha.
- **A reversão é reversível.** Um checkpoint de guarda do estado pré-reversão é capturado primeiro.

## Limitações conhecidas

- No rc.6, os eventos de sessão `checkpoint/*` são suprimidos pela porta adaptativa; a cadeia de auditoria usa `command/run` + `command/done` mais o domínio de armazenamento até que um host envie o vocabulário ou o envelope `ignorable`.
- `confirmVia: approval` precisa de um turno aberto, e os comandos rodam entre turnos — monte userQuestions (ou defina `confirmVia: userQuestions`) no rc.6.
- A reversão de sessão cria uma **nova sessão filha** semeada a partir do limite do checkpoint; ela nunca reescreve nem trunca a sessão original.
- `workspaceRestore: 'reset-hard'` move a cabeça da ramificação para o commit do instantâneo; está desativado por padrão.
- Um checkpoint capturado antes de qualquer turno fechado não tem limite de reprodução — a reversão de sessão cria então uma nova sessão filha com contexto vazio.

## Solução de problemas

| Sintoma | Causa / correção |
|---|---|
| `/rewind <id>` diz `rewind cancelled: no confirmation answerer` | Nenhum canal userQuestions/approval está montado — o plugin fecha em falha. Rode na Web UI (ou monte um provedor de perguntas); `confirmVia` seleciona o canal. |
| `/rewind <id>` diz `approval requires an open turn …` | Os comandos rodam entre turnos e approval precisa de um turno — monte userQuestions ou defina `confirmVia: userQuestions`. |
| `rewind: checkpoint registry unavailable` | O domínio de armazenamento `checkpoints` não pôde abrir. Ou o serviço `storageDomain` não está composto (adicione as linhas da pilha de armazenamento do Início rápido: `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` com config `root` + `@deepseek-ai/dsh-storage-domain` com config `backend: json`) ou o backend está com erro; verifique os logs do harness. |
| Um checkpoint aparece como `fork: pending (turn not closed)` | Seu turno ainda não tem `turn/end`; os arquivos ainda podem ser restaurados, mas a reprodução da sessão espera o turno fechar. |
| `files restored … but the session was NOT replayed` | A fase de sessão da transação falhou (sem limite fechado, ou reprodução rejeitada). Os arquivos permanecem restaurados; use o `rewind guard: <id>` impresso para desfazer. |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` recusou a reversão porque a captura da guarda falhou; corrija o armazenamento (ou defina `warn`/`off`). |
| Um checkpoint aparece como `(copy)` embora o diretório seja um repo | HEAD não nascido (sem commit inicial): as primitivas de instantâneo git exigem HEAD, então o plugin degrada para `copy` até o primeiro commit. |
| `MISSING_CREDENTIAL` em execuções headless | Não relacionado a este plugin: não há `DEEPSEEK_API_KEY` configurada para o provedor do modelo. |
| O armazenamento de instantâneos cresce | A poda roda após cada instantâneo e em `turn/end` (`pruneOnTurnEnd`); reduza `maxSnapshots` / `maxSnapshotBytes`, rode `/rewind clear`, ou exclua `$DSH_HOME/dsh-checkpoint-rewind` após desinstalar. |

## Desenvolvimento

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de provedores)
npm run test:integration  # verificação headless montada (test/integration/)
```

Sem etapa de build: ESM puro — `index.mjs`/`lib/` são os artefatos publicados.

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o modelo de checkpoint de três estados, a costura de provedores git/copy, a transação de reversão em três fases, a linha do tempo de Configurações, a documentação, CI/CD e releases.

## Família de Plugins DSH PerryLink

Este projeto é um dos plugins do DeepSeek Harness mantidos por [PerryLink](https://github.com/PerryLink). Se este te ajuda, é provável que os outros também ajudem:

| Plugin | Uma linha |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Painel de runtime MCP somente leitura: comando /mcp + aba de Configurações com status, ferramentas e erros |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Guarda de disciplina de engenharia: interrogatório de requisitos, portões de teste, revisão adversarial |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Agentes filhos em segundo plano duráveis com barra lateral na Web UI, mensagens e interrupção |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | Diagnósticos LSP, formatação, conclusão, ações de código e renomeação via servidores de linguagem |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Troca de estilo em tempo de execução equivalente a outputStyles do Claude Code |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de um só passo |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Regras de permissão declarativas allow/deny/ask estilo Claude Code com auditoria |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Revisão automática de um segundo modelo na cadeia de aprovação, fechamento em falha por padrão |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Memória entre sessões com porta de aprovação: costura ctx.memory + SQLite + ferramenta memory |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Pacote de skills de auditoria de segurança: escaneamento de segredos, revisão de dependências e cadeia de suprimentos |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Fixa sessões na barra lateral web com ordenação durável |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R |
| [dsh-github](https://github.com/PerryLink/dsh-github) | Integração de PR/issues do GitHub para DSH, cada escrita com porta de aprovação |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Base de conhecimento de desenvolvimento de plugins como skill de agente sob demanda |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migra sessões, memória, skills e CLAUDE.md do Claude Code para o DSH |

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
