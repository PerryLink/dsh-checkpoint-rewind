<div align="center">

# ⏪ dsh-checkpoint-rewind

**एकीकृत DeepSeek Harness चेकपॉइंट — सत्र + वर्कस्पेस + कॉन्फ़िग तीन-अवस्था स्नैपशॉट, एक-चरण रोलबैक के साथ।**

*Claude Code Checkpoints का समतुल्य, एक क्षमता-सीम प्लगइन के रूप में बनाया गया: हर बदलाव से पहले कैप्चर करें, एक अनुमोदित कमांड से तीनों में से कोई भी अवस्था बहाल करें।*

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
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers `0.1.0-rc.6` पर पिन किए गए) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| प्लेटफ़ॉर्म | सभी (होस्ट कमांड + श्रोता; settings क्षमता के ज़रिए वैकल्पिक सेटिंग्स-पृष्ठ टाइमलाइन) |
| मॉडल | कोई भी (कोई मॉडल कॉल नहीं — स्नैपशॉट और बहाली नियतात्मक हैं) |

## आपको क्या मिलता है

`dsh-checkpoint-rewind` एक **तीन-अवस्था एकीकृत चेकपॉइंट** कैप्चर करता है — वर्कस्पेस, सत्र कर्सर और प्लगइन कॉन्फ़िग — और एक अनुमोदित कमांड से इनमें से एक या सभी को बहाल करता है:

1. **तीन-अवस्था रिकॉर्ड** — हर चेकपॉइंट वर्कस्पेस अवस्था (git ट्री SHA, या कॉपी मेनिफ़ेस्ट), सत्र घटना कर्सर (`seq` + टर्न सीमा) और कॉन्फ़िग स्नैपशॉट रखता है, स्रोत (`manual` / `auto` / `guard` / `mutation`) से चिह्नित।
2. **चार कैप्चर ट्रिगर** — हर बदलाव वाले टूल से पहले (`fs/write-intent`, `fs/edit-intent`, `tools/pre-execute`), स्वचालित अंतराल पर (`autoCheckpoint`, डिफ़ॉल्ट हर चरण), मैन्युअल (`/checkpoint` और `checkpoint` टूल), और हर रोलबैक से पहले गार्ड के रूप में।
3. **git-प्रथम प्रदाता** — `git stash create` / `commit-tree` असंदर्भित स्नैपशॉट ऑब्जेक्ट बनाते हैं जो आपके वर्कट्री, इंडेक्स या इतिहास को कभी नहीं छूते; बहाली केवल-वर्कट्री और स्पष्ट-पथ है। गैर-git निर्देशिकाएँ (और अजन्मे-HEAD रेपो) हार्डलिंक पुनःउपयोग वाले वृद्धिशील `copy` प्रदाता पर गिर जाती हैं।
4. **एक-चरण रोलबैक** — `/rewind workspace|session|config|all <target>` चुनी गई अवस्थाएँ बहाल करता है; `preview` एक केवल-पढ़ने प्रभाव रिपोर्ट है, `diff <a> <b>` दो चेकपॉइंट की तुलना करता है, `clear` उन्हें हटाता है।
5. **सीड-रीप्ले सत्र रोलबैक** — सत्र रोलबैक आधिकारिक `sessions.create` सीड API से चेकपॉइंट सीमा तक की घटनाएँ दोहराकर एक नया चाइल्ड सत्र बनाता है; मूल सत्र अपना पूरा इतिहास रखता है।
6. **सेटिंग्स-पृष्ठ टाइमलाइन** — `Plugins → Checkpoints` टैब सत्र के चेकपॉइंट को जोड़ी-वार पंक्ति-स्तरीय diff के साथ दिखाता है।

## त्वरित शुरुआत

```sh
# 1. अपने प्रोफ़ाइल में बंडल इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"

# या npm से (प्रकाशित रिलीज़)
dsh plugin --profile web add dsh-checkpoint-rewind

# 2. पुनः प्रारंभ करें और पंक्ति सत्यापित करें
dsh --profile web --dump-config | grep -A4 'id: checkpoint-rewind'
```

पैकेज शुद्ध ESM है और इसमें कोई बिल्ड चरण नहीं है — `index.mjs` और `lib/` ही शिप किए गए आर्टिफ़ैक्ट हैं। वर्कस्पेस बदलाव अब स्वचालित रूप से चेकपॉइंट बनाते हैं; उन्हें सूचीबद्ध करने के लिए `/rewind` चलाएँ।

## इंस्टॉल और अनइंस्टॉल

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-checkpoint-rewind#main"` — शुद्ध ESM, कोई `prepare` या `allowBuilds` चरण नहीं।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-checkpoint-rewind`।
- **tarball चैनल**: इस रेपो में `npm pack`, फिर `dsh plugin --profile web add ./dsh-checkpoint-rewind-<version>.tgz`।
- **अनइंस्टॉल**: `dsh plugin --profile web remove dsh-checkpoint-rewind` — स्नैपशॉट फ़ाइलें तब तक रहती हैं जब तक आप `$DSH_HOME/dsh-checkpoint-rewind` नहीं हटाते; git ऑब्जेक्ट गार्बेज-कलेक्ट हो जाते हैं।

## कॉन्फ़िगरेशन

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। कुछ भी हार्डकोडेड नहीं है।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `enabled` | `true` | मास्टर स्विच; `false` पर कमांड, श्रोता और प्रदाता पूरी तरह हटा देता है |
| `provider` | `auto` | स्नैपशॉट प्रदाता: `auto` (git उपलब्ध हो तो git, वरना copy) · `git` · `copy` |
| `gitBin` | `git` | git निष्पादन योग्य का पथ |
| `snapshotDir` | `$DSH_HOME/dsh-checkpoint-rewind` | copy प्रदाता के स्नैपशॉट का मूल |
| `maxSnapshots` | `50` | प्रति सत्र रखे गए चेकपॉइंट (सबसे पुराने पहले हटते हैं) |
| `maxSnapshotBytes` | `536870912` (512 MiB) | वैश्विक वृद्धिशील-बाइट नरम कोटा (प्रति सत्र नवीनतम हमेशा रहता है) |
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
| `promptSection` | `true` | एक संक्षिप्त भूमिका-वाक्य प्रॉम्प्ट अनुभाग इंजेक्ट करें |
| `checkpointTool` | `true` | `checkpoint` मॉडल टूल पंजीकृत करें |

## उपकरण और सतहें

| सतह | प्रकार | नोट्स |
|---|---|---|
| `/rewind` | कमांड | `[workspace\|session\|config\|all] <id-prefix\|step <N>\|latest>` · `diff <a> <b>` · `preview <target>` · `clear` |
| `/checkpoint` | कमांड | `[note <text>\|list\|diff <a> <b>]` — मैन्युअल चेकपॉइंट कैप्चर करें |
| `checkpoint` | टूल | वैकल्पिक नोट के साथ मैन्युअल चेकपॉइंट कैप्चर करें |
| `fs/write-intent` · `fs/edit-intent` · `tools/pre-execute` | श्रोता | बदलाव-पूर्व कैप्चर (prepend pass-through; नीति स्थान कभी नहीं छीनता) |
| `session/event` | श्रोता | टर्न/चरण ट्रैकिंग, स्वचालित अंतराल, सीमा भरण, टर्न-अंत छँटाई |
| `checkpoints` प्रोजेक्शन | सत्र प्रोजेक्शन | सत्र लॉग से मोड़ी गई टाइमलाइन पट्टी |
| सेटिंग्स-पृष्ठ टाइमलाइन | क्लाइंट | जोड़ी-वार diff के साथ `Plugins → Checkpoints` टैब |

## अनुमतियाँ और डेटा

- **अनुमतियाँ**: workshop मेनिफ़ेस्ट `workspace:read`, `workspace:write`, `git:read`, `git:write`, `snapshot-storage:write`, `session-log:read`, `settings:write` और `network:none` घोषित करता है।
- **डेटा**: चेकपॉइंट रिकॉर्ड `checkpoints` स्टोरेज डोमेन (SQLite पंक्तियाँ या JSON फ़ाइल) में रहते हैं; कॉपी स्नैपशॉट `snapshotDir` के अंतर्गत रहते हैं। पूरी तरह स्थानीय — कोई नेटवर्क नहीं, कोई क्रेडेंशियल नहीं।
- **सत्र लॉग**: `checkpoint/*` घटनाएँ एक अनुकूली द्वार से जोड़ी जाती हैं (केवल जब होस्ट इन प्रकारों को जानता है या `ignorable` लिफ़ाफ़ा समर्थित करता है); आधिकारिक ऑडिट श्रृंखला `command/run` + `command/done` और टिकाऊ डोमेन है।

## सुरक्षा सीमाएँ

- **git इतिहास अछूत है।** git प्रदाता केवल श्वेतसूचीबद्ध दुष्प्रभाव-रहित आदिम (`stash create`, `commit-tree`, `restore --worktree`, …) चलाता है; `reset --hard` केवल ऑप्ट-इन `workspaceRestore: 'reset-hard'` मोड के पीछे मौजूद है। कभी `git clean` नहीं।
- **अधिलेखन रोलबैक, कभी विलोपन नहीं।** बहाली केवल कैप्चर की गई फ़ाइलों को अधिलेखित करती है; चेकपॉइंट के बाद बनी फ़ाइलें सूचित की जाती हैं और जगह पर रहती हैं।
- **लिंक से होकर कोई लेखन नहीं, कोई पथ-यात्रा नहीं।** copy के `ref` स्नैपशॉट id के रूप में सत्यापित होते हैं; बहाली वर्कस्पेस से बाहर सिमलिंक का अनुसरण करने से इनकार करती है।
- **बहाली के लिए अनुमोदन चाहिए।** उपयोगकर्ता फ़ाइलों को अधिलेखित करना हमेशा पुष्टि सीम से गुजरता है; अनुपस्थित या इनकार करने वाला answerer विफल-बंद होता है।
- **रोलबैक उलटा जा सकता है।** पहले पूर्व-रोलबैक अवस्था का गार्ड चेकपॉइंट कैप्चर होता है; `/rewind <guard-id>` रोलबैक को उलट देता है।
- **मॉडल-दृश्य ⟺ रिकॉर्डेड।** उपयोगकर्ता या मॉडल जो कुछ देखता है वह `command/run` + `command/done` और टिकाऊ `checkpoints` डोमेन से पुनर्निर्मित होता है।

## ज्ञात सीमाएँ

- rc.6 पर, `checkpoint/*` सत्र घटनाएँ अनुकूली द्वार से दबाई जाती हैं (होस्ट इन प्रकारों को नहीं जानता); जब तक कोई होस्ट शब्दावली या `ignorable` लिफ़ाफ़ा नहीं भेजता, ऑडिट श्रृंखला `command/run` + `command/done` और स्टोरेज डोमेन पर चलती है।
- `confirmVia: approval` को खुले टर्न की आवश्यकता है, और कमांड टर्न के बीच चलते हैं — rc.6 पर userQuestions माउंट करें (या `confirmVia: userQuestions` सेट करें)।
- सत्र रोलबैक चेकपॉइंट सीमा से सीड किया गया एक **नया चाइल्ड सत्र** बनाता है; यह मूल सत्र को कभी दोबारा नहीं लिखता या काटता।
- `workspaceRestore: 'reset-hard'` CC-समतुल्य है और ब्रांच हेड को स्नैपशॉट कमिट पर ले जाता है; यह डिफ़ॉल्ट रूप से बंद है।

## विकास

```sh
npm install               # peer deps: @deepseek-ai/dsh-session@0.1.0-rc.6, schemastery, zod
npm test                  # node --test test/**/*.test.mjs (प्रदाता सुइट सहित)
npm run test:integration  # असेंबल्ड-हेडलेस सत्यापन (test/integration/)
```

## विषय

`deepseek-harness`, `dsh`, `dsh-plugin`, `rewind`, `checkpoint`, `snapshot`, `session-replay`, `session-fork`, `config-restore`, `workspace-safety`, `undo`, `cordis-plugin`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: तीन-अवस्था चेकपॉइंट मॉडल, git/copy प्रदाता सीम, तीन-चरण रोलबैक लेनदेन, सेटिंग्स-पृष्ठ टाइमलाइन, दस्तावेज़, CI/CD और रिलीज़।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-checkpoint-rewind contributors
