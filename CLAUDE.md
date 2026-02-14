# got — Project Guidelines

## What This Is

A one-arm-bandit CLI powered by Claude. Feed it a topic, get a sharp response instantly.

**Core characteristic:** Personality-first responses. Not a search wrapper, not a command runner — a witty colleague with tools. You pull the lever (`got shakespeare`), you get a quote with commentary. You ask `got APPL`, you get stock price with snark. Always 2-3 lines max.

Users throw queries at it (`got weather`, `got soul`, `got trump`) and the LLM interprets intent — sometimes it needs tools (web search, shell commands), sometimes it just responds with wit or knowledge.

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

Run `npm link` to install locally, then test with:
```bash
got weather          # Should get location + weather with personality
got shakespeare      # Should deliver a quote, not web search
got soul             # Should respond with wit, not info about soul music
got APPL             # Should get current stock price
got status           # Should run git status or system health
got trump            # Should get current info with appropriate snark
```

**Expected behavior:**
- Responses are 2-3 lines maximum
- Personality is present (wit, snark, or dry observation)
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
