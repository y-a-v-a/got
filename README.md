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
```

## Install

```
npm install
npm link
```

Requires `ANTHROPIC_API_KEY` in your environment.

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

Response is always 2-3 lines max.

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
- `prompts/ME.md` — context about you (optional, delete if you want)

**Philosophy:**
Pull the lever, get a response. No ceremonies, no "let me help you", no walls
of text. Just sharp, contextual answers with personality baked in.

Vincent "got coffee" Bruijn <vebruijn@gmail.com>
