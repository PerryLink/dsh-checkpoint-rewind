<div align="center">

# ⏪ dsh-checkpoint-rewind
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-checkpoint-rewind` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)।

**एकीकृत DeepSeek Harness चेकपॉइंट — सत्र + वर्कस्पेस + कॉन्फ़िग तीन-अवस्था स्नैपशॉट, एक-चरण रोलबैक के साथ।**

*Claude Code Checkpoints का समतुल्य, क्षमता-सीम (capability-seam) प्लगइन के रूप में बनाया गया: हर बदलाव से पहले कैप्चर करें, एक अनुमोदित कमांड से तीनों अवस्थाओं में से किसी को भी बहाल करें।*

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

## अनुकूलता

| सतह | स्थिति |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` (peers `>=0.1.0-rc.8 <0.2.0`) 0.1.2-alpha.5 (2026-09-02 को अनुकूलित): सत्र लिफ़ाफ़ा अपना ignorable फ़ील्ड केवल संग्रहीत-लॉग पठन संगतता के लिए रखता है - Session.append अभी भी इसे स्टैम्प नहीं कर सकता, इसलिए गेट व्यवहार अपरिवर्तित है। |
| Node | `^22.19.0 \|\| >=24.0.0` |
| प्लेटफ़ॉर्म | सभी (होस्ट कमांड + श्रोता; settings क्षमता के ज़रिए वैकल्पिक सेटिंग्स-पृष्ठ टाइमलाइन) |
| मॉडल | कोई भी (कोई मॉडल कॉल नहीं — स्नैपशॉट और बहाली नियतात्मक हैं) |

## आपको क्या मिलता है

`dsh-checkpoint-rewind` एक **तीन-अवस्था एकीकृत चेकपॉइंट** कैप्चर करता है — वर्कस्पेस, सत्र कर्सर और प्लगइन कॉन्फ़िग — और एक अनुमोदित कमांड से इनमें से एक या सभी को बहाल करता है:

1. **तीन-अवस्था रिकॉर्ड** — हर चेकपॉइंट वर्कस्पेस अवस्था (git ट्री SHA, या कॉपी मेनिफ़ेस्ट), सत्र घटना कर्सर (`seq` + टर्न सीमा) और कॉन्फ़िग स्नैपशॉट रखता है, स्रोत (`manual` / `auto` / `guard` / `mutation`) से चिह्नित।
2. **चार कैप्चर ट्रिगर** — हर बदलाव वाले टूल से पहले (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), स्वचालित अंतराल पर (`autoCheckpoint`, डिफ़ॉल्ट हर चरण), मैन्युअल (`/checkpoint` और `checkpoint` टूल), और हर रोलबैक से पहले गार्ड के रूप में।
3. **git-प्रथम प्रदाता** — `git stash create` / `commit-tree` असंदर्भित स्नैपशॉट ऑब्जेक्ट बनाते हैं जो आपके वर्कट्री, इंडेक्स या इतिहास को कभी नहीं छूते; बहाली केवल-वर्कट्री और स्पष्ट-पथ है। गैर-git निर्देशिकाएँ (और अजन्मे-HEAD रेपो) हार्डलिंक पुनःउपयोग वाले वृद्धिशील `copy` प्रदाता पर गिर जाती हैं।
4. **एक-चरण रोलबैक** — `/rewind workspace|session|config|all <target>` चुनी गई अवस्थाएँ बहाल करता है; `preview` एक केवल-पढ़ने प्रभाव रिपोर्ट है, `diff <a> <b>` दो चेकपॉइंट की तुलना करता है, `clear` उन्हें हटाता है (इस सत्र के; `clear --all` सभी सत्रों और वर्कस्पेस तक फैला है)।
5. **सीड-रीप्ले सत्र रोलबैक** — सत्र रोलबैक आधिकारिक `sessions.create` सीड API से चेकपॉइंट सीमा तक की घटनाएँ दोहराकर एक नया चाइल्ड सत्र बनाता है; मूल सत्र अपना पूरा इतिहास रखता है।
6. **सेटिंग्स-पृष्ठ टाइमलाइन** — `Plugins → Checkpoints` टैब सत्र के चेकपॉइंट को जोड़ी-वार पंक्ति-स्तरीय diff के साथ दिखाता है।

## एक और rewind प्लगइन क्यों?

| प्लगइन | क्या बेचता है | फ़ाइलें बहाल करता है? | सत्र को रिवाइंड करता है? |
|---|---|---|---|
| **dsh-checkpoint-rewind** (यह) | git-ऑब्जेक्ट स्नैपशॉट + तीन-अवस्था रोलबैक + एक-चरण बहाली | ✅ पूर्ण वर्कस्पेस अवस्था | ✅ सीड-रीप्ले चाइल्ड सत्र |
| [Anionex/dsh-turn-rewind](https://github.com/Anionex/dsh-turn-rewind) | प्रति-बदलाव डेल्टा का स्थायी Change Ledger | ✅ व्युत्क्रम डेल्टा दोहराकर | ✅ इसका अपना ledger मॉडल |
| [LingLambda/dsh-undo](https://github.com/LingLambda/dsh-undo) | अंतिम पूर्ण चरण तक शुद्ध संदर्भ रोलबैक | ❌ | ✅ केवल संदर्भ |
| [Mongfayi/dsh-recall](https://github.com/Mongfayi/dsh-recall) | संदेश recall (एक टर्न और उसके बाद सब हटाएँ) | ❌ (स्पष्ट रूप से) | ✅ टर्न हटाना |

एक वाक्य में अंतर: **dsh-checkpoint-rewind हर बदलाव से पहले दुष्प्रभाव-रहित git आदिम से *वर्कस्पेस अवस्था* कैप्चर करता है, और “चरण N पर वापस” को एक अनुमोदित कमांड बनाता है — पहले गार्ड चेकपॉइंट, फिर फ़ाइलें बहाल, फिर कॉन्फ़िग बहाल, फिर सत्र रीप्ले, हर चरण लॉग।** कोई डेल्टा हिसाब नहीं जो बह सके, कोई संदेश-स्तरीय संपादन नहीं (वह दूसरे प्लगइन का काम है), कोई क्रॉस-डिवाइस सिंक नहीं।

## त्वरित शुरुआत

```sh
# 1. अपने प्रोफ़ाइल में बंडल इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# या npm से (प्रकाशित रिलीज़)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. पुनः प्रारंभ करें और पंक्ति सत्यापित करें
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

चेकपॉइंट `storageDomain` सेवा के ज़रिए बने रहते हैं। प्लगइन इसके बिना भी माउंट होता है और प्रोफ़ाइल स्टार्टअप को कभी रोकता नहीं — तब checkpoint/rewind कमांड एक संरचित त्रुटि लौटाते हैं जिसमें जोड़ने वाली सटीक पंक्तियाँ बताई जाती हैं। चेकपॉइंट सक्षम करने के लिए स्टोरेज स्टैक एक बार जोड़ें:

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

पैकेज शुद्ध ESM है और इसमें कोई बिल्ड चरण नहीं है — `index.mjs` और `lib/` ही शिप किए गए आर्टिफ़ैक्ट हैं। वर्कस्पेस बदलाव अब स्वचालित रूप से चेकपॉइंट बनाते हैं; उन्हें सूचीबद्ध करने के लिए `/rewind` चलाएँ:

```text
rewind: 3 checkpoints (newest last):
#a1b2c3d4 · (git) · turn 2 step 1 · 2026-08-14 12:00:01 (3 min ago) · trigger: bash · 4 files · 1.2 MiB
#b2c3d4e5 · (git) · turn 2 step 3 · 2026-08-14 12:00:41 · trigger: str_replace_editor · 2 files · 310 KiB
#c3d4e5f6 · (copy) · turn 3 step 1 · 2026-08-14 12:01:10 · trigger: write · 1 file · 90 KiB
run "/rewind <id>" to restore files and fork the session from that checkpoint
```

किसी चेकपॉइंट को उसके अद्वितीय id उपसर्ग, चरण संख्या या `latest` से संबोधित करें:

```text
/rewind b2c3d4e5
/rewind step 2
/rewind latest
/rewind preview b2c3d4e5   # केवल-पढ़ने: दिखाएँ कि कौन सी फ़ाइलें बदलेंगी, कुछ न छुएँ
/rewind clear              # इस सत्र के चेकपॉइंट की पुष्ट विलोपन (फ़ाइलें अछूती)
/rewind clear --all        # सभी सत्रों और वर्कस्पेस के चेकपॉइंट की पुष्ट विलोपन (फ़ाइलें अछूती)
```

`preview` उसी संबोधन से हल होता है और बिना पुष्टि माँगे या कुछ लिखे प्रभाव प्रिंट करता है।

## इंस्टॉल और अनइंस्टॉल

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — शुद्ध ESM, कोई `prepare` या `allowBuilds` चरण नहीं।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-checkpoint-rewind`।
- **tarball चैनल**: इस रेपो में `npm pack`, फिर `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`।
- **स्टोरेज स्टैक** (चेकपॉइंट के लिए आवश्यक, माउंट के लिए वैकल्पिक): `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` (कॉन्फ़िग `root`) + `@deepseek-ai/dsh-storage-domain` (कॉन्फ़िग `backend: json`) — त्वरित शुरुआत देखें; इसके बिना भी प्लगइन माउंट होता है और हर कमांड समाधान बताता है।
- **अनइंस्टॉल**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — स्नैपशॉट फ़ाइलें तब तक रहती हैं जब तक आप `$DSH_HOME/dsh-checkpoint-rewind` नहीं हटाते; git ऑब्जेक्ट गार्बेज-कलेक्ट हो जाते हैं।

## कॉन्फ़िगरेशन

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। कुछ भी हार्डकोडेड नहीं है। प्रदाता विकल्प (`gitBin`, `snapshotDir`, `excludeGlobs`, `verifyByHash`) उपयोग के समय लाइव कॉन्फ़िग से पढ़े जाते हैं, इसलिए cordis.yml के बदलाव बिना रीस्टार्ट लागू होते हैं।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `enabled` | `true` | मास्टर स्विच; `false` पर कमांड, श्रोता और प्रदाता पूरी तरह हटा देता है |
| `provider` | `auto` | स्नैपशॉट प्रदाता: `auto` (git उपलब्ध हो तो git, वरना copy) · `git` · `copy` |
| `gitBin` | `git` | git निष्पादन योग्य का पथ |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` (`$DSH_HOME` सेट न होने पर `~/.dsh/dsh-checkpoint-rewind` फ़ॉलबैक) | copy प्रदाता के स्नैपशॉट का मूल |
| `maxSnapshots` | `50` | प्रति सत्र रखे गए चेकपॉइंट (सबसे पुराने पहले हटते हैं) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | वैश्विक वृद्धिशील-बाइट नरम कोटा (प्रति लाइव सत्र नवीनतम हमेशा रहता है) |
| `pruneOnTurnEnd` | `true` | टर्न समाप्त होने पर कोटा छँटाई चलाएँ |
| `mutationTools` | `['bash','write','edit','str_replace_editor','pwsh','terminal_send']` | `tools/pre-execute` पर बदलाव वाले माने गए टूल |
| `excludeGlobs` | `['node_modules','.git','.dsh','dist','build']` | copy प्रदाता द्वारा छोड़े गए glob पैटर्न |
| `confirmVia` | `auto` | पुष्टि चैनल: `auto` (पहले userQuestions) · `userQuestions` · `approval` |
| `listLimit` | `10` | बिना तर्क के `/rewind` द्वारा दिखाए गए चेकपॉइंट |
| `preRewindCheckpoint` | `warn` | बहाली से पहले गार्ड चेकपॉइंट: `warn` · `require` · `off` |
| `verifyByHash` | `false` | copy प्रदाता की सामग्री-हैश तुलना और बहाली सत्यापन |
| `autoCheckpoint.enabled` | `true` | `step/start` पर स्वचालित अंतराल स्नैपशॉट |
| `autoCheckpoint.intervalMinutes` | `0` | अंतराल; `0` = हर चरण |
| `workspaceRestore` | `restore` | वर्कस्पेस रोलबैक: `restore` (सुरक्षित अधिलेखन) · `reset-hard` (CC शैली, ऑप्ट-इन) |
| `diffRenderer` | `pairwise` | सेटिंग्स-पेज diff रेंडरर: `pairwise` (लाइन-स्तरीय टेक्स्ट) · `side-by-side` (प्रति-फ़ाइल दो-कॉलम) |
| `selectiveRestore` | `true` | प्रति-फ़ाइल चयनात्मक बहाली (`/rewind … --files`) और पैनल का प्रति-फ़ाइल चेकबॉक्स + आकार योग |
| `promptSection` | `true` | एक संक्षिप्त भूमिका-वाक्य प्रॉम्प्ट अनुभाग इंजेक्ट करें |
| `checkpointTool` | `true` | `checkpoint` मॉडल टूल पंजीकृत करें |

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

## उपकरण और सतहें

| सतह | प्रकार | नोट्स |
|---|---|---|
| `/rewind` | कमांड | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear [--all]` |
| `/checkpoint` | कमांड | `[note <text>\|list\|diff <a> <b>]` — मैन्युअल चेकपॉइंट कैप्चर करें |
| `checkpoint` | टूल | वैकल्पिक नोट के साथ मैन्युअल चेकपॉइंट कैप्चर करें |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | श्रोता | बदलाव-पूर्व कैप्चर (prepend pass-through; नीति स्थान कभी नहीं छीनता) |
| `session/event` | श्रोता | टर्न/चरण ट्रैकिंग, स्वचालित अंतराल, सीमा भरण, टर्न-अंत छँटाई |
| `checkpoints` प्रोजेक्शन | सत्र प्रोजेक्शन | सत्र लॉग से मोड़ी गई टाइमलाइन पट्टी |
| सेटिंग्स-पृष्ठ टाइमलाइन | क्लाइंट | जोड़ी-वार diff के साथ `Plugins → Checkpoints` टैब |

## सुरक्षा मॉडल

- **git इतिहास अछूत है।** git प्रदाता केवल श्वेतसूचीबद्ध दुष्प्रभाव-रहित आदिम — `stash create`, `commit-tree`, `restore --worktree`, `ls-tree`, `diff-tree`, `ls-files`, `status`, `rev-parse`, `cat-file -e` — चलाता है, जो रनटाइम दावे द्वारा लागू होते हैं, और ऑब्जेक्ट संदर्भ git को दिए जाने से पहले हेक्स id के रूप में सत्यापित होते हैं (छेड़छाड़ किया गया रिकॉर्ड git विकल्प इंजेक्ट नहीं कर सकता)। **डिफ़ॉल्ट रूप से कभी `reset --hard` नहीं, कभी `clean` नहीं, कभी इंडेक्स/इतिहास बदलाव नहीं** (नीचे `workspaceRestore` देखें)।
- **अधिलेखन रोलबैक, कभी विलोपन नहीं।** बहाली केवल कैप्चर की गई फ़ाइलों को अधिलेखित करती है, और git प्रदाता **स्पष्ट पथ** बहाल करता है (`git restore … -- .` चेकपॉइंट के बाद `git add` की गई फ़ाइलें हटा देगा)। चेकपॉइंट के बाद बनी फ़ाइलें (अनट्रैक्ड **या** staged) *सूचित* की जाती हैं और जगह पर रहती हैं।
- **लिंक से होकर कोई लेखन नहीं, कोई पथ-यात्रा नहीं।** copy प्रदाता चेकपॉइंट संदर्भों को स्नैपशॉट-निर्देशिका पथों में जोड़ने से पहले सत्यापित करता है, और ऐसे गंतव्य (या पूर्वज) से होकर बहाल करने से इनकार करता है जो प्रतीकात्मक लिंक बन गया हो — इसलिए बहाली कभी वर्कस्पेस से बाहर किसी लिंक का अनुसरण नहीं कर सकती।
- **बहाली के लिए अनुमोदन चाहिए।** उपयोगकर्ता फ़ाइलों को अधिलेखित करना हमेशा `ask` शब्दार्थ वाली पुष्टि सीम से गुजरता है; अनुपस्थित, त्रुटि फेंकने वाला या “नहीं” उत्तर देने वाला answerer **विफल-बंद** होता है। `/rewind preview` पहले प्रभाव देखने का केवल-पढ़ने तरीका है।
- **रोलबैक उलटा जा सकता है।** बहाली से पहले एक गार्ड चेकपॉइंट वर्तमान अवस्था कैप्चर करता है; गार्ड को बहाल करने से रोलबैक उलट जाता है। गार्ड कैप्चर न हो पाने पर `preRewindCheckpoint: require` रोलबैक को रद्द कर देता है।
- **निश्चित-क्रम लेनदेन।** पहले गार्ड, फिर वर्कस्पेस, फिर कॉन्फ़िग, फिर सत्र रीप्ले; हर चरण लॉग होता है; असफल बहाली फ़ाइलें, चेकपॉइंट और सत्र अछूते छोड़ देती है।
- **`workspaceRestore: 'reset-hard'` CC-समतुल्य और ऑप्ट-इन है।** यह `git reset --hard <snapshot commit>` चलाता है (ब्रांच हेड स्नैपशॉट कमिट पर चला जाता है; स्नैपशॉट-पूर्व इतिहास reflog से पुनर्प्राप्त रहता है; अनट्रैक्ड फ़ाइलें अछूती रहती हैं)। यह डिफ़ॉल्ट रूप से बंद है।
- **मॉडल-दृश्य ⟺ रिकॉर्डेड।** उपयोगकर्ता या मॉडल जो कुछ देखता है वह `command/run` + `command/done` (और, जब होस्ट उन्हें जान ले, `checkpoint/*` घटनाएँ) और टिकाऊ `checkpoints` डोमेन से पुनर्निर्मित होता है।

## यह कैसे काम करता है

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

संपूर्ण निर्णय रिकॉर्ड, घटना शब्दावली और प्रदाता सीम अनुबंध: [ARCHITECTURE.md](ARCHITECTURE.md)।

## सत्र घटनाएँ (rc.2 नोट)

प्लगइन `checkpoint/snapshot`, `checkpoint/bound`, `checkpoint/prune` और `checkpoint/rewind` को केवल-लॉग `SessionEventMap` सदस्यों के रूप में घोषित करता है। Harness rc.2 में **कोई प्लगइन घटना-पंजीकरण सतह नहीं** है और `Session.append` अज्ञात विकल्प कुंजियों को चुपचाप छोड़ देता है, इसलिए अज्ञात प्रकार जोड़ने से पुनः लोड पर सत्र अपठनीय हो जाता है। इसीलिए प्लगइन एक **अनुकूली द्वार** से जोड़ता है: एक रनटाइम जाँच (एक अलग, कभी-स्थायी न होने वाले सत्र स्टोर पर) पता लगाती है कि होस्ट का `append` `ignorable` लिफ़ाफ़े पर मुहर लगाता है या नहीं — rc.2 पर द्वार बंद रहता है; इसे समर्थित करने वाले होस्ट पर, `checkpoint/*` घटनाएँ स्वचालित रूप से `ignorable: true` के साथ जुड़ती हैं। तब तक, आधिकारिक ऑडिट श्रृंखला `command/run` + `command/done` (हार्नेस-ज्ञात) और टिकाऊ `checkpoints` स्टोरेज डोमेन है।

## Web UI एंकर

प्लगइन कमांड परिणाम में नई सत्र id लौटाता है (`session: <id>`) और Web shell वहाँ नेविगेट कर सकता है। **सत्र-प्रोजेक्शन इकाई `checkpoints` शिप की गई है**: जब भी `ctx.sessionProjections` मौजूद हो, प्लगइन `ctx.inject` से इकाई पंजीकृत करता है (`checkpoint/snapshot|bound|prune|rewind` को संपूर्ण-मान सूची में मोड़ता है) — यह rc.2 होस्ट पर एक खाली सूची रहती है जब तक कोई हार्नेस बिल्ड `checkpoint/*` शब्दावली या `ignorable` लिफ़ाफ़ा शिप नहीं करता, और फिर बिना किसी प्लगइन बदलाव के भर जाती है।

## FAQ

**क्या यह git की जगह लेता है?** नहीं — यह उपलब्ध होने पर git का *उपयोग* करता है। git रेपो में आपको इतिहास को छुए बिना बाइट-सटीक, डीडुप्लीकेटेड स्नैपशॉट ऑब्जेक्ट मिलते हैं; किसी अन्य निर्देशिका में copy प्रदाता सामान्य फ़ाइलों से वही करता है। नियमित कमिट आपका दीर्घकालिक इतिहास बने रहते हैं।

**डिफ़ॉल्ट रूप से `git reset --hard` क्यों नहीं?** क्योंकि अवस्था को नष्ट करना सुरक्षा-जाल का काम नहीं है। डिफ़ॉल्ट रूप से, प्लगइन केवल असंदर्भित ऑब्जेक्ट बनाता है और केवल-वर्कट्री, स्पष्ट-पथ बहाली करता है, इसलिए एक खराब रिवाइंड कभी इतिहास, इंडेक्स या चेकपॉइंट के बाद बनी फ़ाइलों को नहीं खो सकता। `reset-hard` `workspaceRestore: 'reset-hard'` के पीछे उन उपयोगकर्ताओं के लिए उपलब्ध है जो स्पष्ट रूप से CC समानता चाहते हैं।

**चेकपॉइंट कब तक पुनर्स्थापित करने योग्य है?** git-provider स्नैपशॉट पर कोई ref नहीं रखी जाती है। वे डिज़ाइन द्वारा `stash create`/`commit-tree` के अनरेफरेंस्ड ऑब्जेक्ट हैं, और `discard` केवल मेटाडेटा रिकॉर्ड हटाता है, जिससे ऑब्जेक्ट `git gc` के लिए बच जाता है। दो स्वतंत्र सीमाएँ तय करती हैं कि चेकपॉइंट वास्तव में कब तक पुनर्स्थापित रहता है: प्लगइन का अपना कोटा प्रूनिंग (`maxSnapshots` डिफ़ॉल्ट रूप से 50 प्रति सत्र; `maxSnapshotBytes` 512 MiB वैश्विक सॉफ्ट कोटा जो प्रत्येक कैप्चर पर `pruneAll()` द्वारा लागू होता है और टर्न समाप्त होने पर साफ़ होता है) और होस्ट रेपो का git gc (`gc.pruneExpire` 2 सप्ताह)। मैनुअल `git gc --prune=now` या री-क्लोन उन्हें तुरंत हटा देता है। प्रून किए गए ऑब्जेक्ट अब पहले से पहचाने जाते हैं: git प्रदाता बहाली से पहले स्नैपशॉट ऑब्जेक्ट की जाँच करता है (`git cat-file -e`) और ऑब्जेक्ट गायब होने पर ज़ोर से विफल होता है (चुपचाप कुछ नहीं बहाल करने के बजाय), और एक डॉक्टर पास हर चेकपॉइंट रिकॉर्ड पर चलकर ऑब्जेक्ट अस्तित्व की जाँच करता है व बहाल-अयोग्य रिकॉर्ड को चिह्नित करता है (सूची में `[UNRESTORABLE: object missing]`)। डॉक्टर पास लागू और परीक्षित है, पर अभी बहाली पथ से नहीं जुड़ा है (restore अभी `unrestorable` चिह्न नहीं पढ़ता; discussion #13 में ट्रैक हो रहा है)।

**क्या मैं किसी टर्न के बीच के चरण पर रिवाइंड कर सकता हूँ?** फ़ाइल बहाली चरण-सटीक है (`/rewind step <N>` = N के ≤ निकटतम स्नैपशॉट)। हालाँकि, सत्र रीप्ले हार्नेस की रीप्ले ग्रैन्युलैरिटी का पालन करता है: चाइल्ड सत्र चेकपॉइंट की टर्न सीमा तक सीड किया जाता है।

**अगर कोई पुष्टि का उत्तर न दे सके तो क्या होगा?** कुछ नहीं छुआ जाता — प्लगइन विफल-बंद होता है (`unavailable`/`rejected`), चेकपॉइंट रखता है और व्याख्यात्मक त्रुटि लौटाता है। rc.2 पर `confirmVia: approval` के साथ, संदेश userQuestions माउंट करने को कहता है, क्योंकि approval को खुले टर्न की आवश्यकता है और कमांड टर्न के बीच चलते हैं।

**क्या मैं रिवाइंड को उलट सकता हूँ?** हाँ — हर अनुमोदित रिवाइंड पहले पूर्व-रिवाइंड अवस्था का गार्ड चेकपॉइंट कैप्चर करता है; परिणाम `rewind guard: <id>` प्रिंट करता है, और `/rewind <guard-id>` उस अवस्था को बहाल करता है।

**चेकपॉइंट को कैसे संबोधित करूँ?** अद्वितीय id उपसर्ग (सूची का 8-अक्षर छोटा id काम करता है), `/rewind step <N>`, `/rewind latest`, इस सत्र के चेकपॉइंट हटाने के लिए `/rewind clear`, या सभी सत्रों व वर्कस्पेस के चेकपॉइंट हटाने के लिए `/rewind clear --all` (फ़ाइलें अछूती)। `/rewind preview <target>` बिना कुछ बदले प्रभाव दिखाने के लिए वही संबोधन उपयोग करता है।

**`preview` क्या करता है — और क्या नहीं करता?** यह चेकपॉइंट हल करता है, फिर केवल-पढ़ने तुलना चलाता है: कौन सी फ़ाइलें अधिलेखित (या पुनर्निर्मित) होंगी, कौन सी पहले से मेल खाती हैं, और चेकपॉइंट के बाद बनी कौन सी फ़ाइलें जगह पर रहेंगी। यह कभी संकेत नहीं देता, कभी लिखता नहीं, कभी फ़ोर्क नहीं करता और कोई `checkpoint/rewind` घटना रिकॉर्ड नहीं करता — अनुमोदन द्वार केवल वास्तविक `/rewind <id>` पर चलता है।

## डेमो

एक वास्तविक असेंबल्ड-हेडलेस एकीकरण रन (`npm run test:integration`) पूरे प्रवाह को चलाता है: एजेंट दो टर्न में फ़ाइलें बदलता है, फिर `/rewind preview` केवल-पढ़ने रूप में प्रभाव देखता है (कोई पुष्टि द्वार नहीं, कोई लेखन नहीं) और `/rewind <id>` फ़ाइलों को बहाल करके सत्र को एक नए चाइल्ड सत्र में रीप्ले करता है। रन फ़ाइल सामग्री, रीप्ले किए गए चाइल्ड संदर्भ, गार्ड चेकपॉइंट और चेकपॉइंट के बाद बनी फ़ाइलों के बचे रहने की पुष्टि करता है — copy और git दोनों प्रदाता प्रवाहों के लिए (git प्रवाह यह भी पुष्टि करता है कि `HEAD` और reflog अछूते रहते हैं)। ड्राइवर `test/integration/rewind-headless.mjs` में है।

## अनुमतियाँ और डेटा

- **अनुमतियाँ**: workshop मेनिफ़ेस्ट `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` और `network:none` घोषित करता है।
- **डेटा**: चेकपॉइंट रिकॉर्ड `checkpoints` स्टोरेज डोमेन (SQLite पंक्तियाँ या JSON फ़ाइल) में रहते हैं; कॉपी स्नैपशॉट `snapshotDir` के अंतर्गत रहते हैं। पूरी तरह स्थानीय — कोई नेटवर्क नहीं, कोई क्रेडेंशियल नहीं। डोमेन दो-संस्करण रूप में खोला जाता है: 0.4.x युग के मीडिया (डोमेन v1) को संगतता मोड में खोला जाता है जो पुराने रिकॉर्ड को पठनीय रखता है और नए कैप्चर को v2 रूप में संग्रहीत करता है — प्लगइन अपग्रेड करने से मौजूदा मीडिया कभी अनाथ नहीं होता।
- **सत्र लॉग**: `checkpoint/*` घटनाएँ अनुकूली द्वार से जोड़ी जाती हैं; आधिकारिक ऑडिट श्रृंखला `command/run` + `command/done` और टिकाऊ डोमेन है।

## सुरक्षा सीमाएँ

- **git इतिहास अछूत है।** श्वेतसूचीबद्ध दुष्प्रभाव-रहित आदिम; `reset --hard` केवल ऑप्ट-इन `workspaceRestore: 'reset-hard'` मोड के पीछे। कभी `git clean` नहीं।
- **अधिलेखन रोलबैक, कभी विलोपन नहीं।** बहाली केवल कैप्चर की गई फ़ाइलों को अधिलेखित करती है; चेकपॉइंट के बाद बनी फ़ाइलें सूचित की जाती हैं और जगह पर रहती हैं।
- **लिंक से होकर कोई लेखन नहीं, कोई पथ-यात्रा नहीं।** copy के `ref` स्नैपशॉट id के रूप में सत्यापित होते हैं; बहाली वर्कस्पेस से बाहर सिमलिंक का अनुसरण करने से इनकार करती है।
- **बहाली के लिए अनुमोदन चाहिए।** अनुपस्थित या इनकार करने वाला answerer विफल-बंद होता है।
- **रोलबैक उलटा जा सकता है।** पहले पूर्व-रोलबैक अवस्था का गार्ड चेकपॉइंट कैप्चर होता है।

## ज्ञात सीमाएँ

- rc.2 पर, `checkpoint/*` सत्र घटनाएँ अनुकूली द्वार से दबाई जाती हैं; जब तक कोई होस्ट शब्दावली या `ignorable` लिफ़ाफ़ा नहीं भेजता, ऑडिट श्रृंखला `command/run` + `command/done` और स्टोरेज डोमेन पर चलती है।
- `confirmVia: approval` को खुले टर्न की आवश्यकता है, और कमांड टर्न के बीच चलते हैं — rc.2 पर userQuestions माउंट करें (या `confirmVia: userQuestions` सेट करें)।
- सत्र रोलबैक चेकपॉइंट सीमा से सीड किया गया एक **नया चाइल्ड सत्र** बनाता है; यह मूल सत्र को कभी दोबारा नहीं लिखता या काटता।
- `workspaceRestore: 'reset-hard'` ब्रांच हेड को स्नैपशॉट कमिट पर ले जाता है; यह डिफ़ॉल्ट रूप से बंद है।
- किसी बंद टर्न से पहले कैप्चर किया गया चेकपॉइंट कोई रीप्ले सीमा नहीं रखता — तब सत्र रोलबैक खाली संदर्भ वाला एक नया चाइल्ड सत्र बनाता है।

## समस्या निवारण

| लक्षण | कारण / समाधान |
|---|---|
| `/rewind <id>` कहता है `rewind cancelled: no confirmation answerer` | कोई userQuestions/approval चैनल माउंट नहीं है — प्लगइन विफल-बंद होता है। Web UI में चलाएँ (या प्रश्न प्रदाता माउंट करें); `confirmVia` चैनल चुनता है। |
| `/rewind <id>` कहता है `approval requires an open turn …` | कमांड टर्न के बीच चलते हैं और approval को टर्न चाहिए — userQuestions माउंट करें या `confirmVia: userQuestions` सेट करें। |
| `rewind: checkpoint registry unavailable` | `checkpoints` स्टोरेज डोमेन खुल नहीं सका। या तो `storageDomain` सेवा जुड़ी नहीं है (त्वरित शुरुआत की स्टोरेज स्टैक पंक्तियाँ जोड़ें: `@deepseek-ai/dsh-storage` + `@deepseek-ai/dsh-storage-json` कॉन्फ़िग `root` के साथ + `@deepseek-ai/dsh-storage-domain` कॉन्फ़िग `backend: json` के साथ) या बैकएंड में त्रुटि है; हार्नेस लॉग जाँचें। |
| कोई चेकपॉइंट `fork: pending (turn not closed)` के रूप में दिखता है | उसके टर्न का अभी `turn/end` नहीं है; फ़ाइलें फिर भी बहाल हो सकती हैं, पर सत्र रीप्ले टर्न बंद होने की प्रतीक्षा करता है। |
| `files restored … but the session was NOT replayed` | लेनदेन का सत्र चरण विफल रहा (कोई बंद सीमा नहीं, या रीप्ले अस्वीकृत)। फ़ाइलें बहाल रहती हैं; उलटने के लिए प्रिंट किए गए `rewind guard: <id>` का उपयोग करें। |
| `rewind: aborted — the pre-rewind guard checkpoint could not be captured` | `preRewindCheckpoint: require` ने रोलबैक अस्वीकार किया क्योंकि गार्ड कैप्चर विफल रहा; स्टोरेज ठीक करें (या `warn`/`off` सेट करें)। |
| कोई चेकपॉइंट `(copy)` के रूप में दिखता है जबकि निर्देशिका रेपो है | अजन्मा HEAD (कोई प्रारंभिक कमिट नहीं): git स्नैपशॉट आदिम को HEAD चाहिए, इसलिए पहली कमिट तक प्लगइन `copy` पर गिर जाता है। |
| headless रन में `MISSING_CREDENTIAL` | इस प्लगइन से असंबंधित: मॉडल प्रदाता के लिए कोई `DEEPSEEK_API_KEY` कॉन्फ़िगर नहीं है। |
| स्नैपशॉट स्टोरेज बढ़ता है | हर स्नैपशॉट के बाद और `turn/end` (`pruneOnTurnEnd`) पर छँटाई चलती है; `maxSnapshots` / `maxSnapshotBytes` घटाएँ, `/rewind clear` चलाएँ, या अनइंस्टॉल के बाद `$DSH_HOME/dsh-checkpoint-rewind` हटाएँ। |

## विकास

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.1-rc.2, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (प्रदाता सुइट सहित)
npm run test:integration  # असेंबल्ड-हेडलेस सत्यापन (test/integration/)
```

कोई बिल्ड चरण नहीं: शुद्ध ESM — `index.mjs`/`lib/` प्रकाशित आर्टिफ़ैक्ट हैं।

## विषय

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: तीन-अवस्था चेकपॉइंट मॉडल, git/copy प्रदाता सीम, तीन-चरण रोलबैक लेनदेन, सेटिंग्स-पृष्ठ टाइमलाइन, दस्तावेज़, CI/CD और रिलीज़।
- [@tmpdot](https://github.com/tmpdot) (rmUnlucky) — v1 मीडिया दोहरे-संस्करण संगतता (#8), आलसी `storageDomain` समाधान (#9), checkpoint डिडुप उत्तर संकेत (#10), और `$DSH_HOME` अनसेट स्नैपशॉट-डायरेक्टरी बग रिपोर्ट (#4)।
- [@shipinliang](https://github.com/shipinliang) — checkpoint पैनल wire-अनुबंध रिपोर्ट: `limit` पैरामीटर पर अनुपस्थित `acceptsUndefined` (#5) और `#deps` निजी-फ़ील्ड प्रॉक्सी विफलता (#6)।
- [@hwz1456](https://github.com/hwz1456) — web-profile checkpoint-कैप्चर रिपोर्ट (#3)।
- [@Andiii208](https://github.com/Andiii208) — `plugin_check` प्रकाशन-विशिष्टता रिपोर्ट (#2)।
- [@alexchenzl](https://github.com/alexchenzl) (Ashu) — DSH डायरेक्टरी सूचीबद्धता आमंत्रण (#7)।

## PerryLink DSH प्लगइन परिवार

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) द्वारा अनुरक्षित [33 DeepSeek Harness प्लगइनों](https://github.com/PerryLink) में से एक है। अगर यह आपकी मदद करता है, तो बाकी भी करेंगे:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-auto-review](https://github.com/PerryLink/dsh-dsh-auto-review)** | अनुमोदन श्रृंखला पर द्वितीय-मॉडल स्वतः-समीक्षा, डिफ़ॉल्ट रूप से विफल-बंद | |
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | वेब UI साइडबार, संदेश और अवरोधन के साथ टिकाऊ पृष्ठभूमि चाइल्ड एजेंट | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | DeepSeek Harness के लिए लागत प्रशासन: बजट, कार्बन और विलंबता एक पैनल में। | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Claude Code सत्र, मेमोरी, कौशल और CLAUDE.md को DSH में स्थानांतरित करें | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | DeepSeek Harness के लिए क्रॉस-प्लेटफ़ॉर्म नेटिव डेस्कटॉप नियंत्रण — Windows पहले। | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | वेब कंपोज़र के लिए टर्मिनल-शैली इनपुट इतिहास: तीर, Ctrl+R खोज | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | डेटासेट गुणवत्ता जाँच व उद्धरण सत्यापन (यहाँ उपभोग किया गया वैकल्पिक संख्या-सेतु) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | DeepSeek Harness के लिए प्रॉम्प्ट-इंजेक्शन, जेलब्रेक और सीक्रेट-लीक रक्षा। | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | इंजीनियरिंग-अनुशासन रक्षक: आवश्यकताओं की पूछताछ, परीक्षण द्वार, प्रतिद्वंद्वी समीक्षा | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | DeepSeek Harness के लिए एकीकृत स्थैतिक-छवि निर्माण रूटिंग। | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | DeepSeek Harness के लिए रीड-ओनली प्रदर्शन डायग्नोस्टिक्स। | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | चीनी सार्वजनिक म्यूचुअल फंड के लिए नियतात्मक अनुसंधान रिपोर्ट | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | DSH के लिए GitHub PR/issues एकीकरण, हर लेखन अनुमोदन-द्वारित | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | उद्योग-अनुसंधान ऑर्केस्ट्रेशन जो इस प्लगिन के `ctx.researchReport.assemble` से डिलीवरेबल सील करता है | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | DeepSeek Harness के लिए स्थानीय दस्तावेज़ ज्ञानकोश। | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | DeepSeek Harness के लिए स्थानीय-मॉडल (Ollama) एकीकरण। | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | भाषा सर्वरों पर LSP निदान, फ़ॉर्मेटिंग, पूर्णता, कोड क्रियाएँ और नाम बदलना | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | PII मास्किंग मिडलवेयर: मॉडल सीमा पर अनाम करें, डिस्प्ले लेयर पर पुनर्स्थापित करें | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | केवल-पढ़ने वाला MCP रनटाइम पैनल: /mcp कमांड + स्थिति, टूल और त्रुटियों वाला Settings टैब | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | अनुमोदन-द्वारित क्रॉस-सत्र मेमोरी: ctx.memory सीम + SQLite + मेमोरी टूल | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | DeepSeek Harness के लिए OpenTelemetry और Langfuse अवलोकनीयता निर्यातक। | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Claude Code outputStyles-समतुल्य रनटाइम शैली बदलाव | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | ऑडिट के साथ Claude Code-शैली घोषणात्मक allow/deny/ask अनुमति नियम | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | माँग पर एजेंट कौशल के रूप में प्लगइन-विकास ज्ञान आधार | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | सामग्री-पता साक्ष्य और सीलबंद संस्करणों वाला सत्यापन-योग्य अनुसंधान-रिपोर्ट इंजन | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | DeepSeek Harness प्लगिनों की बहु-आयामी गुणवत्ता स्कोरिंग। | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | टिकाऊ क्रम के साथ वेब साइडबार में सत्र पिन करें | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | DeepSeek Harness के लिए क्रॉस-डिवाइस सत्र सिंक — आपके सत्र स्टोर का एक समर्पित git मिरर। | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | सुरक्षा-ऑडिट कौशल पैक: गुप्त स्कैन, निर्भरता और आपूर्ति-श्रृंखला समीक्षा | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | DeepSeek Harness के लिए आवाज़-प्रथम सत्र लूप: बोलें और उत्तर सुनें। | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | DeepSeek Harness प्लगिनों के लिए पृथक इंस्टॉल-एंड-स्मोक टेस्ट ड्राइव। | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | DeepSeek Harness के लिए वेंडर पैरामीटर अनुवाद और नियतात्मक JSON मरम्मत। | |

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
