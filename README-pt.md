<div align="center">

# ⏪ dsh-checkpoint-rewind
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-checkpoint-rewind` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).

**Checkpoints unificados do DeepSeek Harness — instantâneos de três estados (sessão + workspace + configuração) com reversão de um só passo.**

*O equivalente aos Checkpoints do Claude Code, construído como plugin de costura de capacidade (capability-seam): capture antes de cada mutação, restaure qualquer um dos três estados com um único comando aprovado.*

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
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-checkpoint-rewind?metric=downloads&lang=pt)](https://dshfind.com/pt/plugins/PerryLink/dsh-checkpoint-rewind?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-checkpoint-rewind
```


</div>

---

**📖 Base de conhecimento do ecossistema** — dados medidos, não marketing: [guia de desenvolvimento · dados de seleção · critérios de manutenção](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-checkpoint-rewind?

Checkpoints unificados do DeepSeek Harness — instantâneos de três estados (sessão + workspace + configuração) com reversão de um só passo.

O equivalente aos Checkpoints do Claude Code, construído como plugin de costura de capacidade (capability-seam): capture antes de cada mutação, restaure qualquer um dos três estados com um único comando aprovado.

![Demonstração de terminal do dsh-checkpoint-rewind: dsh-checkpoint-rewind — /rewind lists checkpoints, then a read-only preview](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-hero.png)

![Animated terminal demo of dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-demo.gif)

*A mesma execução, animada.*

## Comparison

![Gráfico comparativo medido do dsh-checkpoint-rewind](https://raw.githubusercontent.com/PerryLink/dsh-checkpoint-rewind/main/docs/assets/dsh-checkpoint-rewind-evidence.png)

Capabilities out of 2 (restores files? / rewinds the session?) · counted from the README comparison table

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (tag do GitHub, verificado em 2026-09-25; pin npm `0.1.7-rc.2`, peers `>=0.1.6-0 <0.2.0 || >=0.1.7-0 <0.2.0`) (adaptado em 2026-10-04): o host removeu `@deepseek-ai/dsh-settings-file` e substituiu a superfície de registro de namespaces de `ctx.settings` por `SettingsForms`, que projeta o `Config` de cada entrada do Loader no formulário de Configurações e persiste as edições no patch do perfil — os campos de configuração do plugin agora são declarados `volatile()` e lidos ao vivo, os codecs estritos do typert carregam apenas sua fábrica `create()`, e o aviso de rebobinamento declara seu próprio `kind` de origem de mensagem. O caminho legado `settings.register` é mantido para hosts `0.1.5-rc.2`/`0.1.6-alpha.2`. Verificado em 2026-09-22 contra o checkout do `dsh-v0.1.7-alpha.1` (typecheck contra a superfície de tipos do alpha.1 + suíte de unidades completa + integração headless montada). |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (comandos + listeners de host; linha do tempo de Configurações opcional via capacidade settings) |
| Modelo | Qualquer (sem chamadas ao modelo — instantâneos e restaurações são determinísticos) |

## O que você recebe

O `dsh-checkpoint-rewind` captura um **checkpoint unificado de três estados** — workspace, cursor de sessão e configuração do plugin — e restaura um ou os três com um único comando aprovado:

1. **Registro de três estados** — cada checkpoint guarda o estado do workspace (SHA da árvore git, ou um manifesto de cópia), o cursor de eventos da sessão (`seq` + limite de turno) e uma instantânea de configuração, rotulado por origem (`manual` / `auto` / `guard` / `mutation`).
2. **Quatro disparadores de captura** — antes de cada ferramenta de mutação (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), no intervalo automático (`autoCheckpoint`, padrão a cada passo), manualmente (`/checkpoint` e a ferramenta `checkpoint`), e como guarda antes de cada reversão.
3. **Provedor git primeiro** — `git stash create` / `commit-tree` produzem objetos de instantâneo não referenciados que nunca tocam seu worktree, índice ou histórico; a restauração é somente-worktree e por caminhos explícitos. Diretórios não git (e repositórios com HEAD não nascido) degradam para um provedor `copy` incremental com reuso de hardlinks.
4. **Reversão de um só passo** — `/rewind workspace|session|config|all <target>` restaura os estados selecionados; `preview` é um relatório de impacto somente leitura, `diff <a> <b>` compara dois checkpoints, `clear` os exclui (esta sessão; `clear --all` abrange todas as sessões e workspaces).
5. **Reversão de sessão por fork** — a reversão de sessão reproduz eventos até o limite do checkpoint pela primitiva oficial `SessionStore.fork`, criando uma nova sessão filha (com fallback para o caminho `sessions.create` com semente quando o host não tem fork ou o checkpoint não tem limite); a sessão original mantém seu histórico completo.
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
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind
```

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind

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

O pacote é ESM puro sem etapa de build — `index.mjs` e `lib/` são os artefatos enviados. As mutações do workspace agora criam checkpoints automaticamente; execute `/rewind` para listá-los (ou `/rewind list brief` para entradas de uma linha com o número da sessão):

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

Enderece um checkpoint pelo **número da sessão** (o número curto e limitado mostrado por `/rewind list brief`), pelo prefixo de id único, pelo número do passo ou por `latest`:

```text
/rewind list brief        # uma linha por checkpoint, numerada, mais recente primeiro
/rewind 3                 # o checkpoint número 3 DESTA sessão (acerto exato, nunca difuso)
/rewind preview 3         # somente leitura: mostra quais arquivos mudariam, não toca nada
/rewind b2c3d4e5          # o prefixo de id único (o id de 8 caracteres) continua funcionando igual
/rewind step 2
/rewind latest
/rewind workspace 3 --files src/a.ts,src/b.ts   # restauração seletiva: só estes arquivos (com aprovação)
/rewind clear              # exclusão confirmada dos checkpoints desta sessão (arquivos intactos)
/rewind clear --all        # exclusão confirmada em TODAS as sessões e workspaces (arquivos intactos)
```

### Números de sessão (ids curtos limitados)

- **Cada checkpoint recebe um número ao ser criado**, começando em `1`. `/rewind 3` resolve esse número **exatamente**: dígitos nunca são tratados como prefixo de id, então `/rewind 3` não pode cair no checkpoint cujo UUID começa com `3`.
- **Escopo: por sessão** (`sessionId`). Cada sessão numera seus próprios checkpoints; um número é único dentro da sua sessão, e `/rewind <número>` resolve apenas contra os checkpoints da sessão (e workspace) atual.
- **Monotônico e nunca reutilizado.** A poda por cota (`maxSnapshots`) e `/rewind clear` / `/rewind clear --all` apagam registros mas nunca liberam um número: após um clear o próximo checkpoint continua da marca alta anterior (depois de `#1 #2 #3` e um `clear`, o próximo é `#4`, não `#1`). O número é gravado no próprio registro e o contador vive no slot global do domínio, então apagar registros não pode reiniciá-lo.
- **Checkpoints antigos são numerados no primeiro contato.** Registros gravados antes deste recurso (sem campo de número) são numerados em ordem de criação na primeira vez que a sessão é listada ou revertida, e essa numeração é persistida; os novos continuam depois dela. Nada é pulado nem reatribuído, e o endereçamento por prefixo de id continua funcionando para eles.
- `/rewind list` (a lista detalhada) não muda: continua imprimindo o id de 8 caracteres por linha e sua última linha aponta para `/rewind list brief` para ver os números.

`preview` resolve pelo mesmo endereçamento e imprime o impacto sem pedir confirmação nem escrever nada.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-checkpoint-rewind` — ESM puro, sem etapa de `prepare` nem `allowBuilds`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-checkpoint-rewind`.
- **Canal tarball**: `npm pack` neste repo e depois `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`.
- **Pilha de armazenamento** (necessária para checkpoints, opcional para montar): `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` (config `root`) + `@deepseek-ai/dsh-storage-domain` (config `backend: json`) — veja Início rápido; o plugin monta mesmo sem ela e cada comando explica a correção.
- **Desinstalar**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — os arquivos de instantâneo permanecem até você excluir `$DSH_HOME/dsh-checkpoint-rewind`; os objetos git são coletados pelo garbage collector.

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Nada é hardcoded. As opções de provedor (`gitBin`, `snapshotDir`, `excludeGlobs`, `verifyByHash`) são lidas da configuração viva no momento do uso, então mudanças no cordis.yml valem sem reiniciar.

| Chave | Padrão | Significado |
|---|---|---|
| `enabled` | `true` | Interruptor mestre; em `false`, remove comandos, listeners e provedores por completo |
| `provider` | `auto` | Provedor de instantâneo: `auto` (git se disponível, senão copy) · `git` · `copy` |
| `gitBin` | `git` | Caminho do executável git |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` (recurso `~/.dsh/dsh-checkpoint-rewind` quando `$DSH_HOME` não está definido) | Raiz dos instantâneos do provedor copy |
| `maxSnapshots` | `50` | Checkpoints mantidos por sessão (os mais antigos podados primeiro) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | Cota branda global de bytes incrementais (o mais novo por sessão viva sempre é mantido) |
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
| `diffRenderer` | `pairwise` | Renderizador de diff da página de configurações: `pairwise` (texto linha a linha) · `side-by-side` (duas colunas por arquivo) |
| `selectiveRestore` | `true` | Restauração seletiva por arquivo (`/rewind … --files`) e a caixa de seleção por arquivo + total de tamanho do painel |
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
| `/rewind` | comando | `[workspace\|session\|config\|all] <number\|id-prefix\|step <N>\|latest>` · `list [brief]` · `diff <a> <b>` · `preview <target>` · `clear [--all]` |
| `/checkpoint` | comando | `[note <text>\|list\|diff <a> <b>]` — captura um checkpoint manual |
| `checkpoint` | ferramenta | Captura um checkpoint manual com nota opcional |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | listeners | Captura pré-mutação (prepend pass-through; nunca rouba a vaga de política) |
| `session/event` | listener | Rastreamento de turno/passo, intervalo automático, preenchimento de limites, poda no fim de turno |
| Projeção `checkpoints` | projeção de sessão | Faixa de linha do tempo dobrada a partir do log da sessão |
| Linha do tempo de Configurações | cliente | Aba `Plugins → Checkpoints` com diffs entre pares |

## Modelo de segurança

- **O histórico git é intocável.** O provedor git só executa primitivas sem efeitos colaterais da lista branca — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`, `cat-file -e` — impostas por uma asserção em tempo de execução, e as referências de objetos são validadas como ids hexadecimais antes de serem passadas ao git (um registro adulterado não pode injetar opções do git). **Nunca `reset --hard` por padrão, nunca `clean`, nunca mutação de índice/histórico** (ver `workspaceRestore` abaixo).
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
             ├─ config:   settings write-back (persisted on the profile patch)
             └─ session:  SessionStore.fork(source, boundary) → new child session (original untouched)
```

Registro de decisões completo, vocabulário de eventos e contrato da costura de provedores: [ARCHITECTURE.md](ARCHITECTURE.md).

## Eventos de sessão (nota rc.2)

O plugin declara `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` e `checkpoint/rewind` como membros `SessionEventMap` apenas de log. O harness rc.2 **não tem superfície de registro de eventos para plugins** e `Session.append` descarta silenciosamente chaves de opções desconhecidas, então anexar tipos desconhecidos tornaria a sessão ilegível ao recarregar. Por isso o plugin anexa através de uma **porta adaptativa**: uma sonda em tempo de execução (em um armazenamento de sessão separado, nunca persistido) detecta se o `append` do host sela o envelope `ignorable` — no rc.2 a porta permanece fechada; em hosts que o suportam, os eventos `checkpoint/*` são anexados automaticamente com `ignorable: true`. Até lá, a cadeia de auditoria autoritativa é `command/run` + `command/done` (conhecidos pelo harness) mais o domínio de armazenamento durável `checkpoints`.

## Âncora da Web UI

O plugin retorna o id da nova sessão no resultado do comando (`session: <id>`) e o shell web pode navegar até lá. **A unidade de projeção de sessão `checkpoints` é enviada**: sempre que `ctx.sessionProjections` existir, o plugin registra a unidade via `ctx.inject` (dobra `checkpoint/snapshot|bound|prune|rewind` em uma lista de valor completo) — ela permanece uma lista vazia em hosts rc.2 até que uma build do harness envie o vocabulário `checkpoint/*` ou o envelope `ignorable`, e então se preenche sem mudanças no plugin.

## FAQ

**Isso substitui o git?** Não — ele *usa* o git onde disponível. Em um repositório git você obtém objetos de instantâneo exatos ao byte, deduplicados, sem tocar o histórico; em qualquer outro diretório, o provedor copy faz o mesmo com arquivos normais. Commits regulares continuam sendo seu histórico de longo prazo.

**Por que não usar `git reset --hard` por padrão?** Porque destruir estado não é função de uma rede de segurança. O plugin cria apenas objetos não referenciados e executa restaurações exclusivas da árvore de trabalho e com caminhos explícitos por padrão, de modo que uma reversão incorreta nunca perde o histórico, o índice ou arquivos criados após o checkpoint. `reset-hard` está disponível em `workspaceRestore: 'reset-hard'` para usuários que desejam paridade com o CC.

**Por quanto tempo um checkpoint é restaurável?** Nenhuma ref é mantida para snapshots de git-provider. São objetos não referenciados de `stash create`/`commit-tree` por design, e `discard` apaga apenas o registro de metadados, deixando o objeto subjacente para o `git gc`. Dois limites independentes definem a janela de restauração real: a cota do plugin (`maxSnapshots` padrão 50 por sessão; `maxSnapshotBytes` 512 MiB de cota flexível global aplicada via `pruneAll()` em cada captura e limpa no fim de turnos) e o git gc do repositório host (`gc.pruneExpire` padrão 2 semanas). Um `git gc --prune=now` manual, repack agressivo ou clone novo os remove imediatamente. Objetos podados agora são detectados antecipadamente: o provedor git sonda o objeto de instantâneo antes de restaurar (`git cat-file -e`) e falha em voz alta se ele faltar, em vez de não restaurar nada, e um passo doctor percorre cada registro de checkpoint para sondar a existência do objeto e marcar os não restauráveis (`[UNRESTORABLE: object missing]` na lista). O passo doctor está implementado e testado, mas ainda não está conectado à rota de restauração (o restore ainda não consulta a marcação `unrestorable`; acompanhamento na discussion #13).

**Posso retroceder para uma etapa no meio de um turno?** A restauração de arquivos é precisa por etapas (`/rewind step <N>` = snapshot mais próximo ≤ N). A reprodução da sessão, no entanto, respeita a granularidade do harness: a sessão filha é iniciada até o limite do turno do checkpoint.

**O que acontece se ninguém puder responder à confirmação?** Nada é tocado — o plugin fecha em falha (`unavailable`/`rejected`), mantém o checkpoint e retorna um erro explicativo. Com `confirmVia: approval` no rc.2, a mensagem diz para montar userQuestions, porque approval exige um turno aberto e os comandos rodam entre turnos.

**Posso desfazer uma reversão?** Sim — toda reversão aprovada captura primeiro um checkpoint de guarda do estado pré-reversão; o resultado imprime `rewind guard: <id>`, e `/rewind <guard-id>` restaura esse estado.

**Como endereço os checkpoints?** Pelo **número da sessão** (`/rewind 3` — veja `/rewind list brief`; por sessão, monotônico, nunca reutilizado), pelo prefixo de id único (o id de 8 caracteres da lista continua funcionando), por `/rewind step <N>` e por `/rewind latest`. `/rewind clear` apaga os checkpoints desta sessão e `/rewind clear --all` apaga os de todas as sessões e workspaces (arquivos intactos) — nenhum dos dois reinicia a numeração. `/rewind preview <target>` usa o mesmo endereçamento para mostrar o impacto sem mudar nada.

**Por que o número continua subindo depois de um clear?** Porque um número é um endereço, não uma posição: reutilizar `#1` para outro checkpoint após um clear redirecionaria em silêncio tudo que mencionasse `#1`. O contador é persistido no slot global do domínio `checkpoints` e cada registro guarda o próprio número, então podar e limpar apagam instantâneos sem reciclar ids.


**O que o `preview` faz — e o que não faz?** Ele resolve o checkpoint e executa uma comparação somente leitura: quais arquivos seriam sobrescritos (ou recriados), quais já coincidem e quais arquivos criados após o checkpoint seriam deixados no lugar. Ele nunca pergunta, nunca escreve, nunca bifurca e não registra nenhum evento `checkpoint/rewind` — a porta de aprovação só roda em um `/rewind <id>` real.

## Demonstração

Uma execução real de integração headless montada (`npm run test:integration`) percorre o fluxo completo: o agente modifica arquivos ao longo de dois turnos, então `/rewind preview` inspeciona o impacto em modo somente leitura (sem porta de confirmação, sem escritas) e `/rewind <id>` restaura os arquivos e reproduz a sessão em uma nova sessão filha. A execução verifica o conteúdo dos arquivos, o contexto do filho reproduzido, o checkpoint de guarda e a sobrevivência dos arquivos criados após o checkpoint — para os fluxos dos provedores copy e git (o fluxo git também verifica que `HEAD` e o reflog permanecem intactos). O driver vive em `test/integration/rewind-headless.mjs`.

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` e `network:none`.
- **Dados**: os registros de checkpoint vivem no domínio de armazenamento `checkpoints` (linhas SQLite ou um arquivo JSON); os instantâneos de cópia vivem sob `snapshotDir`. O **slot global** do domínio guarda os contadores de números curtos por sessão, por isso apagar registros (`prune`, `clear`, `clear --all`) nunca recicla um número. Totalmente local — sem rede, sem credenciais. O domínio é aberto em versão dupla: mídias da era 0.4.x (domínio v1) são abertas em modo de compatibilidade que mantém os registros antigos legíveis e grava as novas capturas no formato v2 — atualizar o plugin nunca órfã uma mídia existente.
- **Log de sessão**: os eventos `checkpoint/*` são anexados pela porta adaptativa; a cadeia de auditoria autoritativa é `command/run` + `command/done` mais o domínio durável.

## Limites de segurança

- **O histórico git é intocável.** Primitivas sem efeitos colaterais da lista branca; `reset --hard` só atrás do modo opt-in `workspaceRestore: 'reset-hard'`. Nunca `git clean`.
- **Reversão por sobrescrita, nunca exclusão.** A restauração sobrescreve apenas arquivos capturados; arquivos criados após o checkpoint são informados e deixados no lugar.
- **Sem escritas através de links, sem path traversal.** Os `ref` de copy são validados como ids de instantâneo; a restauração se recusa a seguir links simbólicos para fora do workspace.
- **A restauração exige aprovação.** Um answerer ausente ou que nega fecha em falha.
- **A reversão é reversível.** Um checkpoint de guarda do estado pré-reversão é capturado primeiro.

## Limitações conhecidas

- No rc.2, os eventos de sessão `checkpoint/*` são suprimidos pela porta adaptativa; a cadeia de auditoria usa `command/run` + `command/done` mais o domínio de armazenamento até que um host envie o vocabulário ou o envelope `ignorable`.
- `confirmVia: approval` precisa de um turno aberto, e os comandos rodam entre turnos — monte userQuestions (ou defina `confirmVia: userQuestions`) no rc.2.
- A reversão de sessão **bifurca (fork) uma nova sessão filha** no limite do checkpoint; ela nunca reescreve nem trunca a sessão original.
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
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.2-rc.1, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (incl. suites de provedores)
npm run test:integration  # verificação headless montada (test/integration/)
```

Sem etapa de build: ESM puro — `index.mjs`/`lib/` são os artefatos publicados.

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o modelo de checkpoint de três estados, a costura de provedores git/copy, a transação de reversão em três fases, a linha do tempo de Configurações, a documentação, CI/CD e releases.
- [@tmpdot](https://github.com/tmpdot) (rmUnlucky) — compatibilidade de dupla versão para mídia v1 (#8), resolução preguiçosa de `storageDomain` (#9), dicas de resposta na deduplicação de checkpoints (#10) e o relatório de bug do diretório de instantâneos com `$DSH_HOME` indefinido (#4).
- [@shipinliang](https://github.com/shipinliang) — relatórios do contrato wire do painel de checkpoints: o `acceptsUndefined` ausente no parâmetro `limit` (#5) e a falha de proxy pelo campo privado `#deps` (#6).
- [@hwz1456](https://github.com/hwz1456) — relatório de captura de checkpoints no perfil web (#3).
- [@Andiii208](https://github.com/Andiii208) — relatório da especificação de publicação do `plugin_check` (#2).
- [@alexchenzl](https://github.com/alexchenzl) (Ashu) — convite para listagem no DSH Directory (#7).

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors


## Interoperabilidade com outros plugins do DSH

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins com mais estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de mais estrelas:

- **Sem colisão de nome de ferramenta.** Todas as ferramentas têm namespace; nenhuma ocupa um nome puro já pertencente a uma ferramenta embutida ou a outro plugin.
- **Sem colisão de chave de serviço.** Não fornece nenhuma chave de serviço, portanto não pode colidir em uma.
- **Sem colisão de slot.** Não registra nenhuma chave de slot de cliente, então não disputa um assento `shadows-shipped-ui`.
- **Sem colisão de rota HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão na camada de patch.** O patch do bundle apenas faz `insert` da própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Observa os eventos sensíveis à ordem `fs/edit-intent`, `fs/write-intent`, `tools/pre-execute` com `ctx.on()` — o registro de difusão do Cordis, onde cada listener executa e nenhum pode privar outro do turno. **Todos os listeners aqui delegam via `next()`**, então a cadeia nunca é curto-circuitada:
  - `tools/pre-execute` — also used by `cc-safety-net` (1576★).

Evidência estática: `dsh-plugin-doctor` K10–K13 retornam `pass` em todas as verificações deste repositório.

## PerryLink DSH Plugin Family

Este projeto é um dos **87 plugins ativamente mantidos** do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro da família tem **95** plugins — **5 congelados**, **3 retirados** — e fica recolhido abaixo para que cada README mantenha uma primeira tela curta. Expanda para ver cada linha, com o motivo na coluna Status.

<details>
<summary>Expandir os 95 plugins</summary>

| Plugin | Uma linha | Status |
|---|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** | 水产养殖投入品记录核对（按投入品用量、休药期与起捕间隔核对记录自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** | 档案归档完整性与保管期限核对（依据《档案法》及配套规定，仅提示差异，不作出定性结论） |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command |  |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** | 投标文件符合性预检（按招标文件逐条核对响应情况，仅提示差异，不作出定性结论） |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** | 投标人资格条件核对（按资格条件与证明材料核对逐条响应，仅提示差异，不作出定性结论） |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |  |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** | 合同条款立场台账核对（按立场、风险等级与退让底线核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** | 报关单证一致性核对（按公开的报关单填制规范核对单证间字段一致性，仅提示差异，不作出定性结论） |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) |  |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** | 滞箱费台账核对（按免箱期与费率核对超期天数与金额的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review |  |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | 🧊 CONGELADO — ver o README do repositório |
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
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** | 维修工单结算核对（按项目金额、配件工时合计与结算总额核对算术自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** | 审稿意见逐条回应覆盖核对（按意见与回应一一对应核对覆盖完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** | 规则库文件自检核对（按条款引用纪律与效力上限核对规则库自身合规，仅提示差异，不作出定性结论） |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** | 安全技术交底记录要素齐备性与签字闭环核对（依据公开的安全生产法规与检查标准，仅提示差异，不作出定性结论） |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. |  |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** | 监理日志跨日连续性与旁站覆盖提示（依据 GB/T 50319-2013 等公开文件，仅提示差异，不作出定性结论） |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** | 三重一大决策台账核对（按前置研究、会议审议与决议记录核对程序留痕，仅提示差异，不作出定性结论） |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** | 土壤与地下水监测台账核对（按点位、监测项目、限值与超标判定核对台账自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** | 作业规程与 FMEA／控制计划一致性核对（按编号与版本核对三份文件是否同步，仅提示差异，不作出定性结论） |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** | 控制图常数与过程能力指数核对（按 GB/T 4091 的常规控制图常数表核对控制限与 Cp/Cpk 的自洽性，仅提示差异，不作出定性结论） |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. |  |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** | 招标文件条款摘录核对（按出处与原文逐字核对摘录完整性，仅提示差异，不作出定性结论） |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** | 评标因素评分矩阵核对（按分值上限与合计核对矩阵自洽，仅提示差异，不作出定性结论） |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** | 质保期与索赔金额核对（按质保期月数与里程、索赔金额算式核对自洽，仅提示差异，不作出定性结论） |  |

</details>

</details>

</details>