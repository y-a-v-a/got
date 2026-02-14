# got — Project Guidelines

## What This Is

A one-arm-bandit CLI powered by Claude. Feed it a topic, get a sharp response instantly.

**Core characteristic:** Personality-first responses with a swiss army knife mode. Not a search wrapper, not a command runner — a witty colleague with tools who knows when to be functional.

**Two modes:**
1. **Witty mode** (default): `got shakespeare` → quote with commentary, `got trump` → news with snark
2. **Swiss army knife mode**: `got memory` → RAM usage (no jokes), `got battery` → battery status (straight facts)

The query is wrapped with "with an ironic or sarcastic twist" UNLESS it matches the functional query whitelist (see `FUNCTIONAL_QUERIES` in got.js). This gives you both: a sarcastic colleague for general queries, and a fast utility tool for system info.

## Core Architecture

- **got.js** — Main executable. Tool-use loop, command safety, prompt loading, model selection
- **prompts/** — Personality (SOUL.md), capabilities (SYSTEM_PROMPT.md), user context (ME.md)
- **~/.got/** — Cache directory for location data and logs (when GOT_LOG=1)

### Tools Available to the LLM

1. `run_command` — Read-only shell commands (allowlist + blocklist enforced)
2. `web_search` — Anthropic's built-in web search (auto-configured with cached location)

### Safety Model

Commands are validated through:
- **Allowlist** (`ALLOWED_COMMANDS`) — Only specific binaries permitted
- **Blocklist** (`BLOCKED_PATTERNS`) — No redirects, no chaining, no sudo, no curl/wget
- Pipes between allowed commands are permitted
- 5-second timeout, 64KB buffer cap, 4KB output truncation

## Design Principles

1. **Personality first, information second** — "2°C and miserable" beats "2°C with clouds"
2. **Read-only by default** — Never writes, modifies, or deletes anything
3. **Radical brevity with flavor** — 2-3 lines maximum, but never bland
4. **Smart query interpretation** — "got wit" means BE witty, not define wit. "got shakespeare" delivers a quote, doesn't search Wikipedia.
5. **Context-aware intelligence** — Model selection (Haiku vs Sonnet) based on query complexity
6. **Location-aware** — Caches IP geolocation for 24h to inform web search
7. **Simple first** — No config files, no databases, no complexity

## Code Conventions

- **Node.js CLI** — Requires Node 18+, uses CommonJS (not ESM)
- **No dependencies beyond SDK** — Only `@anthropic-ai/sdk` in package.json
- **Minimal logging** — Opt-in via GOT_LOG=1, logs to ~/.got/got.log as newline-delimited JSON
- **Prompt composition** — System prompt assembled from prompts/*.md files wrapped in XML tags (`<system_instructions>`, `<personality>`, `<user_context>`) for better parsing
- **Output sanitization** — Strip `<cite>` tags and other markup from responses
- **Error handling** — User-friendly messages for common errors (401, 429), generic fallback otherwise

## When Making Changes

- **Personality is the product** — If changes make responses more bland or "assistant-like", you're going the wrong direction
- **Safety first** — Never weaken command validation. If adding commands, justify why they're read-only
- **Token efficiency** — Cap command output (4KB text, 1KB stderr), limit web search to 3 uses
- **Model routing** — Haiku for simple queries (math, basic commands, greetings), Sonnet for everything else
- **Prompt editing** — Changes to personality/capabilities go in prompts/, not hardcoded strings. Use concrete examples in prompts ("got soul" → "Blame it on the boogie") to teach voice.
- **Output must be plain text** — Strip any markup (`<cite>`, etc.) from final output
- **Cache strategy** — Location cache is 24h TTL. Don't add more caches without reason

## Testing

Run `npm link` to install locally, then test both modes:

```bash
# Witty mode (should have personality)
got weather          # Location + weather with personality
got shakespeare      # Quote without web search, with commentary
got soul             # Witty response, not info about soul music
got trump            # Current info with snark

# Swiss army knife mode (should be functional, no jokes)
got memory           # RAM usage, straight facts
got battery          # Battery status, no commentary
got disk             # Disk space, just the numbers
got status           # Git status or system health
got branches         # Git branches, plain list
```

**Expected behavior:**
- Responses are 2-3 lines maximum
- Witty mode: personality present (wit, snark, or dry observation)
- Swiss army knife mode: straight facts, no jokes
- No preamble ("Here's what I found"), just the answer
- No markdown, citations, or markup in output

Set `GOT_LOG=1` to inspect tool use and API calls in `~/.got/got.log`.

## What NOT to Do

- Don't add write capabilities (this is a read-only oracle)
- Don't add curl/wget to the allowlist (use web_search tool instead)
- Don't weaken command validation patterns
- Don't add configuration files (use environment variables if needed)
- Don't add complex state management (this is stateless by design)
- Don't add authentication beyond ANTHROPIC_API_KEY

## Dependencies

- `@anthropic-ai/sdk` — Official Anthropic SDK
- Node.js built-ins only (child_process, fs, path, os)

## Environment Variables

- `ANTHROPIC_API_KEY` — Required
- `GOT_LOG` — Optional, set to "1" to enable logging
