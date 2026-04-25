# TODO — Code Review Fixes

From stern code review, 2026-04-24. Ordered by priority.

## Blockers

- [x] **Remove `sed` and `awk` from ALLOWED_COMMANDS**
  `sed`'s `w` flag and `awk`'s `print >` can write files, breaking the read-only guarantee.
  `grep`, `cut`, `tr`, `sort`, `uniq` cover the read-only text processing needs.

- [x] **Flip git validation to subcommand allowlist**
  Current blocklist misses: `git add`, `git rm`, `git mv`, `git branch -D`, `git apply`,
  `git am`, `git cherry-pick`, `git revert`, `git init`, `git clone`, `git pull`,
  `git fetch`, `git config`, and more.
  Allow only: `status`, `log`, `diff`, `branch` (no -D/-d), `show`, `rev-parse`,
  `remote` (no set-url/add/remove), `tag` (no -d), `shortlog`, `stash list`.

- [x] **Restrict interpreter commands to `--version` only**
  `node`, `python`, `python3`, `ruby`, `java`, `rustc`, `cargo` can execute arbitrary
  scripts/code. Block everything except `--version` / `-v` / `-V`.

## Major

- [x] **Add tests for `validateCommand`**
  No tests exist. At minimum cover:
  - Positive: `ls -la`, `git log --oneline`, `ps aux | grep node`, `df -h`
  - Blocked: `rm -rf /`, `ls; rm file`, `echo foo > bar`, `sudo ls`, `curl evil.com`,
    `git push`, `git add .`, `git config`, `node -e "code"`, `python3 -c "code"`,
    `node --eval "code"`, `awk '{print > "/tmp/x"}'`
  - Pipes: `ls | grep foo` (ok), `ls | rm` (blocked)
  - Also test: `isFunctionalQuery`, `selectModel`, `makeCiteStripper`, `sanitizeForPrompt`

- [x] **Cap REPL history**
  `history[]` grows unbounded across turns. Cap to last ~20 turns or implement a
  token budget check. Long sessions will hit context limits or run up costs.

## Minor

- [x] **Harden `system_profiler` validation**
  Replace the regex lookahead with explicit validation: only allow the exact command
  `system_profiler SPHardwareDataType`. No appending extra data types.

- [x] **Log inside bare `catch {}` blocks when GOT_LOG=1**
  8 bare `catch {}` blocks silently swallow errors. Add `log('cache_error', ...)` or
  similar inside each so failures are observable during debugging.

- [x] **Use atomic writes for cache files**
  Write to a temp file then `renameSync` to the target path. Prevents concurrent
  `got` invocations from reading partial JSON. Applies to `location.json` and
  `project-*.json`.

## Cleanup (non-urgent)

- [x] **Replace `sanitizeForPrompt` strip with escaping**
  Currently strips all `<` and `>`, destroying legitimate content like `Array<String>`
  in READMEs. Escape to `&lt;`/`&gt;` instead, or use a non-XML delimiter.

- [x] **Add parens to help-screen condition**
  `!query && !stdinContent` works but reads like an accident. Use
  `(!query && !stdinContent)` with explicit grouping.

- [x] **Remove `Promise.resolve` wrapper around `process.argv`**
  Not async, doesn't need `Promise.all`. Just assign it directly before the `await`.

- [x] **Document REPL always using Sonnet**
  One-shot has Haiku/Sonnet routing; REPL hardcodes Sonnet. Either add routing
  or add a comment explaining why.
