# got

A read-only CLI oracle. Ask it anything, it figures out the rest.

```
got weather
got status
got pizza
got "who painted guernica"
got "am i in a git repo"
```

## Install

```
npm install
npm link
```

Requires `ANTHROPIC_API_KEY` in your environment.

## How it works

`got` sends your query to Claude with three capabilities:

- **run_command** — executes read-only shell commands (allowlisted, filtered, no writes)
- **get_location** — IP geolocation, cached for 24h in `~/.got/`
- **web_search** — Anthropic's built-in web search

The LLM decides which tools to use based on your query. "weather" triggers
location + web search. "status" triggers git and system commands. "pizza"
could go either way. That's the fun part.

## Safety

`got` never writes, modifies, or deletes anything. Commands are filtered
through an allowlist and blocked pattern set. No sudo, no redirects, no
curl, no chaining. Pipes between allowed commands are permitted.

## Personality

- Edit `prompts/SOUL.md` to change who `got` is.
- Edit `prompts/SYSTEM_PROMPT.md` to change what `got` does.
- Edit `prompts/ME.md` to teach `got` about you. Optional — delete it and `got` just doesn't know you personally.

Vincent "got coffee" Bruijn <vebruijn@gmail.com>
