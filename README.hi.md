# dsh-checkpoint-rewind

[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · **हिन्दी**

**DeepSeek Harness के लिए Claude Code का `/rewind`, सही तरीके से बनाया गया।**

एक capability-seam प्लगइन जो [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) में **वर्कस्पेस फ़ाइल स्नैपशॉट + सत्र-सीमा रोलबैक** जोड़ता है: हर mutating टूल के निष्पादन से पहले प्लगइन वर्कस्पेस कैप्चर करता है (git पहले, कॉपी फ़ॉलबैक), और एक `/rewind` कमांड फ़ाइलों को पुनर्स्थापित करता है **और** सत्र को चेकपॉइंट की टर्न-सीमा तक fork करता है — ताकि मॉडल का संदर्भ और डिस्क की फ़ाइलें हमेशा एक जैसी रहें।

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green.svg)](#)
[![Harness](https://img.shields.io/badge/dsh-0.1.0--rc.6-8a2be2.svg)](#)

> **Topics**: `dsh` · `dsh-plugin` · `deepseek-harness` · `rewind` · `checkpoint` · `session-fork` · `workspace-safety` · `undo` · `cordis-plugin`

---

## एक और rewind प्लगइन क्यों?

| प्लगइन | क्या बेचता है | फ़ाइलें बहाल करता है? | सत्र वापस ले जाता है? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (यही) | git-ऑब्जेक्ट स्नैपशॉट + टर्न-सीमा fork + एक-चरण बहाली | ✅ पूरा वर्कस्पेस स्टेट | ✅ fork-सीडेड चाइल्ड सत्र |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | हर बदलाव के डेल्टा का स्थायी Change Ledger | ✅ उल्टे डेल्टा दोहराकर | ✅ अपना ledger मॉडल |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | केवल संदर्भ को पिछले पूर्ण चरण तक रोलबैक | ❌ | ✅ केवल संदर्भ |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | संदेश वापसी (टर्न और उसके बाद सब हटाता है) | ❌ (स्पष्ट रूप से) | ✅ टर्न हटाना |

एक वाक्य में अंतर: **dsh-checkpoint-rewind हर बदलाव से पहले बिना साइड-इफ़ेक्ट वाली git प्रिमिटिव से *वर्कस्पेस स्टेट* कैप्चर करता है और "चरण N पर वापस जाओ" को एक स्वीकृत कमांड बनाता है — पहले फ़ाइलें बहाल, फिर सत्र fork, हर चरण लॉग होता है।** कोई डेल्टा-बही नहीं जो असंगत हो जाए, संदेश-स्तरीय संपादन नहीं (वह दूसरे प्लगइन का काम है), क्रॉस-डिवाइस सिंक नहीं।

## विशेषताएँ

- **हर बदलाव से पहले स्नैपशॉट** — `fs/write-intent` / `fs/edit-intent` पर prepend pass-through लिस्नर और गैर-fs mutators (`bash`, …) के लिए `tools/pre-execute`, ताकि *हर* बदलाव का रास्ता कवर हो और नीति का निर्णय-स्लॉट न छिने।
- **Provider seam** — `git` पहले: `git stash create` / `git commit-tree` बिना-संदर्भ वाले स्नैपशॉट ऑब्जेक्ट बनाते हैं जो **कभी worktree, index या इतिहास नहीं छूते**; बहाली केवल-worktree `git restore` है। गैर-git डायरेक्टरी `copy` पर डिग्रेड होती हैं (hardlink पुनर्प्रयोग के साथ वृद्धिशील स्नैपशॉट), सूची में स्पष्ट लेबल के साथ।
- **चरण-स्तरीय मैपिंग, टर्न-स्तरीय fork** — हर चेकपॉइंट अपना turn/step दर्ज करता है; `step/end` चरण मैपिंग भरता है ("चरण N पर वापस" = निकटतम ≤N स्नैपशॉट) और `turn/end` fork सीमा भरता है, harness के असली `ctx.sessions.fork` प्रिमिटिव का उपयोग करके।
- **दो-चरणीय rewind ट्रांज़ैक्शन** — `/rewind <id>` पुष्टि माँगता है (userQuestions / approval seam, **उत्तरदाता न होने पर fail-closed**), पहले फ़ाइलें बहाल करता है फिर fork करता है; बहाली विफल हो तो fork कभी नहीं, fork विफल हो तो "फ़ाइलें बहाल, सत्र fork नहीं हुआ" बताता है और चेकपॉइंट बचा रहता है।
- **टिकाऊ रजिस्ट्री + कोटा** — रिकॉर्ड `ctx.storageDomain` (डोमेन `checkpoints`; SQLite बैकएंड = पंक्तियाँ, JSON बैकएंड = पठनीय फ़ाइल) में रहते हैं; `maxSnapshots` (प्रति सत्र, डिफ़ॉल्ट 50), `maxSnapshotBytes` (वैश्विक, डिफ़ॉल्ट 512 MiB), `pruneOnTurnEnd`, सबसे-पुराना-पहले।
- **डिज़ाइन से पुनर्निर्माणीय** — `/rewind` का आउटपुट harness के अपने `command/run` + `command/done` इवेंट पर चलता है; `checkpoint/snapshot|bound|prune|rewind` इवेंट घोषित हैं और होस्ट बिल्ड के जानते ही अपने-आप जुड़ जाते हैं (rc.6 अनुकूली द्वार)।

## त्वरित शुरुआत

`dsh-checkpoint-rewind` एक **bundle plugin** के रूप में वितरित होता है (कोई बिल्ड चरण नहीं, शुद्ध ESM):

```sh
dsh plugin add dsh-checkpoint-rewind    # प्रोफ़ाइल के bundle स्टैक में जुड़ता है
# dsh पुनः आरंभ करें — /rewind Web UI में सक्रिय हो गया।
```

या प्रयोग के लिए सीधे माउंट करें:

```sh
pnpm dsh web --patch ./cordis.patch.yml
```

वर्कस्पेस में बदलाव होते ही चेकपॉइंट अपने-आप बनते हैं:

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

प्लगइन पूछता है **"Restore the workspace files to this checkpoint and fork the session?"** → स्वीकृति पर फ़ाइलें बहाल करता है, चेकपॉइंट की टर्न-सीमा पर सत्र fork करता है और नए सत्र का id लौटाता है:

```text
rewind: restored 2 file(s) from checkpoint b2c3d4e5-f6a7-… (provider git)
and forked a new session at seq 87 (end of turn 2).
session: session-123
Open the new session to continue from before that turn; this session keeps its later history.
```

headless रन वही परिणाम छापते हैं और आगे बढ़ने का मार्गदर्शन देते हैं; Web shell लौटाए गए `session:` id से नेविगेट कर सकता है (देखें [Web UI एंकर](#web-ui-एंकर))।

## कॉन्फ़िगरेशन

सब कुछ `Config` फ़ील्ड है (cordis.yml से बदला जा सकता है; कुछ भी हार्डकोड नहीं):

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---:|---|
| `enabled` | `true` | मास्टर स्विच; `false` पर कमांड, लिस्नर और providers सब हट जाते हैं। |
| `provider` | `auto` | स्नैपशॉट provider: `auto` (git उपलब्ध हो तो git, वरना copy) · `git` (गैर-git डायरेक्टरी पर ज़ोरदार विफलता) · `copy`। |
| `gitBin` | `git` | git एक्ज़ीक्यूटेबल का पथ। |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | copy provider के स्नैपशॉट की जड़। |
| `maxSnapshots` | `50` | **प्रति सत्र** रखे जाने वाले चेकपॉइंट (सबसे पुराना पहले हटेगा)। |
| `maxSnapshotBytes` | `536870912` (512 MiB) | सभी सत्रों की वैश्विक सामग्री-कोटा (सबसे पुराना पहले)। |
| `pruneOnTurnEnd` | `true` | टर्न समाप्त होने पर कोटा-प्रूनिंग चलाएँ। |
| `mutationTools` | `['bash','write','edit','str_replace_editor']` | `tools/pre-execute` पर mutating माने जाने वाले टूल (fs टूल `fs/*-intent` से पहले ही कवर हैं)। |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | copy provider द्वारा छोड़े गए डायरेक्टरी/फ़ाइलें (`.git` और स्नैपशॉट डायरेक्टरी हमेशा बाहर)। |
| `confirmVia` | `auto` | पुष्टि चैनल: `auto` (पहले userQuestions, फिर approval) · `userQuestions` · `approval`। |
| `listLimit` | `10` | बिना-तर्क `/rewind` में दिखने वाले चेकपॉइंट। |

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

## सुरक्षा मॉडल

- **git इतिहास अछूत है।** git provider केवल व्हाइटलिस्ट की साइड-इफ़ेक्ट-रहित प्रिमिटिव चलाता है — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse` — runtime assertion द्वारा लागू। **कभी `reset --hard` नहीं, कभी `clean` नहीं, कभी index/इतिहास में बदलाव नहीं।**
- **बहाली के लिए स्वीकृति अनिवार्य।** उपयोगकर्ता की फ़ाइलों पर लिखना हमेशा `ask` सिमेंटिक वाले पुष्टि seam से गुज़रता है; उत्तरदाता अनुपस्थित, त्रुटि फेंकने वाला या मना करने वाला हो तो **fail closed**।
- **ओवरराइट रोलबैक, कभी विलोपन नहीं।** दोनों providers कैप्चर की गई फ़ाइलें बहाल करते हैं और चेकपॉइंट के बाद बनी फ़ाइलों को *रिपोर्ट* करते हैं (git: अनट्रैक्ड; copy: manifest एक्स्ट्रा) — हटाते नहीं।
- **दो-चरणीय ट्रांज़ैक्शन, निश्चित क्रम।** पहले फ़ाइलें, फिर fork; हर चरण लॉग होता है; विफल बहाली फ़ाइलों, चेकपॉइंट और सत्र को अछूता छोड़ती है।
- **मॉडल-दृश्य ⟺ लॉग।** उपयोगकर्ता या मॉडल जो कुछ देखते हैं वह सत्र लॉग (`command/run` + `command/done` और, होस्ट के जानते ही, `checkpoint/*` इवेंट) + टिकाऊ `checkpoints` डोमेन से पुनर्निर्माणीय है।

## यह कैसे काम करता है

`checkpoint/snapshot` (निर्माण) → `checkpoint/bound` (step/end व turn/end भराई) → `/rewind` (सूची / पुष्टि / दो-चरणीय बहाली)। पूरा निर्णय-रिकॉर्ड, इवेंट शब्दावली और provider seam अनुबंध: [ARCHITECTURE.md](ARCHITECTURE.md)।

## सत्र इवेंट (rc.6 नोट)

प्लगइन `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` और `checkpoint/rewind` को log-only `SessionEventMap` सदस्यों के रूप में घोषित करता है। harness rc.6 में **प्लगइन इवेंट-पंजीकरण सतह नहीं है** और `Session.append` अज्ञात प्रकारों को `ignorable` चिह्नित नहीं कर सकता, इसलिए इन्हें जोड़ने से सत्र रीलोड पर अपठनीय हो जाता। प्लगइन **अनुकूली द्वार** (`KNOWN_SESSION_EVENT_TYPES`) से इवेंट जोड़ता है: आज छोड़े जाते हैं, होस्ट बिल्ड में प्रकार शामिल होते ही अपने-आप चालू। तब तक आधिकारिक ऑडिट-शृंखला harness-ज्ञात `command/run` + `command/done` और टिकाऊ `checkpoints` डोमेन है।

## Web UI एंकर

प्लगइन पहले से ही कमांड परिणाम में नया सत्र id लौटाता है (`session: <id>`) और Web shell वहाँ नेविगेट कर सकता है। **सत्र-प्रोजेक्शन इकाई `checkpoints` अब साथ वितरित होती है**: जहाँ `ctx.sessionProjections` मौजूद है, प्लगइन इकाई पंजीकृत करता है (`checkpoint/snapshot|bound|prune|rewind` को संपूर्ण-सूची मान में मोड़ना, `stateVersion` 0) — rc.6 होस्ट पर यह खाली सूची रहती है जब तक कोई harness बिल्ड `checkpoint/*` शब्दावली नहीं लाता, फिर बिना किसी प्लगइन बदलाव के भर जाती है। शेष अनुवर्ती कार्य shell का है: उस प्रोजेक्शन को दिखाने वाला **केवल-पढ़ने वाला पैनल** (देखें [ARCHITECTURE.md](ARCHITECTURE.md#todo-web-ui-checkpoint-strip))।

## परीक्षण

```sh
npm install
npm test                 # 58 यूनिट टेस्ट: स्नैपशॉट निर्माण/डिडप/समवर्ती, git व गैर-git पथ, ≤N सीमा मैपिंग,
                         # कोटा-प्रूनिंग, दो-चरणीय विफलता मैट्रिक्स, स्वीकृति-अस्वीकार, अनुकूली इवेंट द्वार
                         # (असली Cordis + असली SessionStore/CommandRuntime)
npm run test:integration # असेंबल्ड headless सत्यापन: एजेंट 2 टर्न में 2 फ़ाइलें बदलता है → /rewind सूची →
                         # बहाली → फ़ाइल सामग्री व fork संदर्भ सुनिश्चित
```

## लाइसेंस

Apache License 2.0 — देखें [LICENSE](LICENSE) और [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)।

## संबंधित प्लगइन

- [dsh-memento](https://github.com/…/dsh-memento) — सीमित, स्वीकृति-द्वार वाली क्रॉस-सत्र स्मृति (समान प्लगइन परंपराएँ)।
- [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) · [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) — वे विकल्प जिनसे यह प्लगइन अलग है (ऊपर की तालिका)।
