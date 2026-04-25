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

## Prompt Engineering: What We Learned

Getting an LLM to consistently sound like a specific person — not an assistant, not a search engine, but a dry colleague with opinions — turned out to be harder than writing the rest of the tool combined. This section documents the approach that emerged over ~27 commits of iterative prompt tuning, in case it's useful to others building personality-first LLM tools.

### The core problem

LLMs default to being helpful, thorough, and neutral. That's the opposite of what `got` needs. Every instinct the model has — summarize fully, cover all angles, be accurate, hedge when uncertain — works against the goal of a 2-line response with a dry human remark at the end.

The hardest variant of this problem is **post-search verbosity**: when the model calls `web_search` and gets back 10 paragraphs of news, the gravitational pull of all that data is enormous. The model wants to relay it faithfully. Teaching it to ignore 95% of what it just read and say something *human* instead required multiple reinforcement layers.

### What didn't work

**Telling the model what to do.** Instructions like "be brief", "be witty", "maximum 2-3 lines" had limited effect. The model acknowledged the constraint and then wrote 5 lines anyway, especially after web searches. Repeating the instruction more emphatically didn't help much either. LLMs are instruction-followers, but when instructions compete with the instinct to be comprehensive, comprehensiveness usually wins.

**Putting all constraints in the system prompt.** The system prompt is processed as background context. It sets the stage, but the model's strongest compliance is with whatever is closest to the generation point — the end of the conversation. Constraints buried in a 2500-token system prompt were too far from where the action happens.

**Verbose meta-instructions.** Telling the model "one fact, then one dry take" was interpreted as two deliverables: it would produce a fact line AND a take line, but the take was often just another fact with slightly different framing. Prescribing structure led to formulaic output.

### What worked

The final approach uses several techniques, each addressing a different failure mode:

#### 1. Personality first, rules second (primacy bias)

LLMs pay more attention to the beginning of the system prompt. We restructured so the model reads **who it is** (SOUL.md — voice, identity, examples) before **what to do** (SYSTEM_PROMPT.md — query routing, tools, rules). Previously it was the reverse. This single change had the largest impact on consistent voice.

#### 2. Slash the system prompt (signal-to-noise ratio)

The original system prompt was ~2500 tokens across two files with significant duplication. We cut it to ~850 tokens. Every instruction that isn't about personality actively *dilutes* personality — the model gives equal weight to "use metric units" and "be witty", so operational noise drowns out voice. The final ratio is 2.4:1 personality-to-operations.

#### 3. Teach how to think, not what to do

Instead of "be witty" (what), we wrote: *"When you hear a piece of news, your first instinct is never 'let me relay this accurately.' It's 'huh' — followed by the one observation that makes it human. A 90,000 sq ft ballroom isn't a fact to report, it's an absurd thing a person did."* This reframes the model's self-concept from information-deliverer to observer-who-remarks. The shift from prescribing behavior to describing an inner monologue was a turning point.

#### 4. Few-shot examples in conversation history

Every conversation is prepended with 2 synthetic user/assistant exchanges that demonstrate the exact voice and format. This is stronger than any system prompt instruction because the model pattern-matches against conversation history — it's not interpreting a rule, it's continuing an established pattern. The examples show both a news-query response (fact + remark) and a one-liner, giving the model two templates to match against.

#### 5. Constraint in the user message (compliance weight)

The user message carries more behavioral weight than the system prompt because it's what the model is directly responding to. We append `[max 2 lines total]` to every witty-mode query. This exploits the model's strong instinct to fulfill the immediate request. The brevity instruction moved from background context to foreground request.

#### 6. Post-tool voice reinforcement (recency bias)

After `web_search` returns results, the last thing the model sees before generating is a wall of news data. We inject a text block after tool results: *"you just read a lot of news. ignore most of it. 2 lines: one detail, one dry remark. you are not a journalist."* This is the single most effective lever for post-search personality. Different nudges for web search vs. command execution, because the data gravity differs.

#### 7. System prompt tail anchor (recency within system)

A `<reminder>` tag at the very end of the system prompt: *"2-3 lines max. Dry, brief, opinionated. Not an assistant. Not a summarizer."* This exploits recency bias within the system prompt itself — the last system instruction is freshest when the model starts processing the conversation.

#### 8. Sonnet for personality, Haiku for data

Smaller models (Haiku) are worse at maintaining persona. They follow instructions more literally but have less capacity for genuine wit. We route all personality queries to Sonnet and only use Haiku for system/functional queries (`got memory`, `got disk`) where personality doesn't matter.

#### 9. Lower MAX_TOKENS as a hard backstop

Reduced from 1024 to 256 tokens. For 2-line responses you need ~50-100 tokens of output. The generous token budget was giving the model room to ramble. The lower cap acts as a physical constraint when all the soft constraints fail.

#### 10. Diversified voice examples

Early examples were all zingers about dramatic topics (wars, crashes). The model could do the voice for dramatic news but defaulted to reporter mode for mundane topics (construction, local events). Adding examples across different topic types — stadiums, climate reports, political mundanity — taught the model that the voice applies to *everything*, not just obviously riffable material.

### The reinforcement stack

The final architecture has constraints at every layer, each exploiting a different cognitive bias:

```
System prompt (beginning)  →  personality identity     [primacy]
System prompt (end)        →  <reminder> tag           [recency within system]
User message (suffix)      →  [max 2 lines total]      [compliance weight]
Post-tool result           →  "ignore most of it"     [recency before generation]
Few-shot history           →  2 example exchanges      [pattern matching]
MAX_TOKENS = 256           →  hard physical limit       [backstop]
```

No single layer is sufficient. The model will find a way past any individual constraint. The stack works because different layers catch different failure modes: the system prompt sets identity, the user message enforces length, the post-tool nudge fights data gravity, the few-shot examples anchor the pattern, and the token limit catches everything else.

### Key insight

Prompt engineering is not writing — it's psychology. You're trying to shift the behavioral prior of a system that is strongly trained to be helpful and thorough. Telling it to be different has limited effect. Showing it what "different" looks like (few-shot), changing what it reads last before responding (recency), and removing competing signals (cutting prompt noise) are all more effective than adding more instructions.

The best single-sentence summary: **less instruction, more demonstration; less telling, more showing; and put the important thing last.**

---

Vincent "got coffee" Bruijn <vebruijn@gmail.com>
