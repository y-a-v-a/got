# got

A one-arm-bandit CLI. Feed it a topic, get a sharp response instantly.

Witty colleague energy. Current info when needed. Zero side effects.

```bash
# Witty mode (default)
got weather          # 2°C in Leiden, feels like -4. Bring layers.
got shakespeare      # "All the world's a stage..." with commentary
got soul             # Blame it on the boogie.
got trump            # Current news, maximum sarcasm

# Swiss army knife mode (functional, no jokes)
got memory           # RAM usage
got battery          # Battery status
got disk             # Disk space
got status           # Git status or system health
got branches         # Git branches

# Pipe mode (pipe anything as context)
git diff | got                          # what changed, briefly
npm test 2>&1 | got what broke          # pinpoint the failure
cat error.log | got anything alarming   # scan with attitude

# REPL mode (persistent session with memory)
got repl
```

## Install

```
npm install
npm link
```

Requires `ANTHROPIC_API_KEY` in your environment.

```bash
got version          # print version
```

## How it works

`got` is your witty colleague with tools. It reads your query, decides what you
actually want (info, wit, sarcasm, a quote), and responds accordingly.

**Tools available:**
- **run_command** — read-only shell commands (git, ls, ps, etc.)
- **web_search** — current info from the web
- **Location** — cached IP geolocation for context

**Query interpretation:**
- `got shakespeare` → delivers a quote with flair (no search needed)
- `got weather` → current weather with personality
- `got wit` → BE witty (not define wit)
- `got memory` → RAM usage (functional mode, no jokes)
- `got status` → git status if you're in a repo, system health otherwise

**Swiss army knife mode:** System queries like `memory`, `disk`, `battery`, `cpu`, `branches` skip the sarcasm and give you straight facts. Everything else gets personality.

**Pipe mode:** Pipe any content into `got` as context. Ask a question or leave it
blank — it figures out the most useful thing to say. Input is capped at 4KB.
```bash
git diff | got
npm test 2>&1 | got what broke
cat package.json | got anything weird
```

**REPL mode:** `got repl` starts a persistent session. Conversation history is kept
in memory across turns so it can reference what was just said. Same two modes apply
(functional queries get straight facts, everything else gets personality). `quit` or
ctrl+d to exit.

Response is always 2-3 lines max.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required |
| `GOT_LOG=1` | Enable logging to `~/.got/got.log` |
| `GOT_MODEL_SONNET` | Override the Sonnet model ID |
| `GOT_MODEL_HAIKU` | Override the Haiku model ID |

## Safety

`got` never writes, modifies, or deletes anything. Commands are filtered
through an allowlist and blocked pattern set. No sudo, no redirects, no
curl, no chaining. Pipes between allowed commands are permitted.

## Personality

`got` is a slightly sarcastic, witty colleague who knows a bit about everything.
Not an assistant. Not a search engine. A person with opinions and access to tools.

**Customize:**
- `prompts/SOUL.md` — who `got` is (voice, wit, personality)
- `prompts/SYSTEM_PROMPT.md` — how `got` interprets queries
- `~/.got/me.md` — context about you (optional, not in the repo). Copy
  `prompts/me.md.example` there and fill it in.

**Philosophy:**
Pull the lever, get a response. No ceremonies, no "let me help you", no walls
of text. Just sharp, contextual answers with personality baked in.

Vincent "got coffee" Bruijn <vebruijn@gmail.com>
