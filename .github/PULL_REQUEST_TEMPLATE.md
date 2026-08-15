<!-- Thanks for contributing! Please confirm the checklist before opening this PR. -->

## Checklist

- [ ] CI gate is green (`npm test` and `npm run test:integration` pass locally; CI status checks pass)
- [ ] Tests added or updated for the change (`test/**/*.test.mjs`)
- [ ] CHANGELOG.md updated (Added / Changed / Fixed under the right version)
- [ ] All five READMEs synced (README.md is the source; README.zh.md / README.es.md / README.pt.md / README.hi.md updated in the same PR)
- [ ] Related issue linked (`fixes #<n>` / `closes #<n>`) if one exists
- [ ] No secrets: the diff contains no tokens, API keys, credentials, or real user workspace data (redact any sample with `<redacted>`)

## Summary

<!-- One or two sentences: what this PR changes and why. -->

## Safety checklist (changes that touch behavior)

<!-- Delete this section if the change is docs/chore only. -->

- [ ] Restore paths stay inside the approved-confirmation gate (never silently allow)
- [ ] Git primitives stay within the side-effect-free whitelist (no reset --hard / clean / index or history mutation)
- [ ] New code is registered through ctx.effect() / ctx.on() / service register() (reversible lifecycle)
- [ ] Any new module imported by index.mjs is added to package.json `files`
