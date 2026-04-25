#!/usr/bin/env node
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, renameSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const readline = require('readline');
const { createHash } = require('crypto');

// ── Config ──────────────────────────────────────────────────

const MODEL_SONNET = process.env.GOT_MODEL_SONNET || 'claude-sonnet-4-5-20250929';
const MODEL_HAIKU  = process.env.GOT_MODEL_HAIKU  || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 256;
const CMD_TIMEOUT = 5000;
const MAX_HISTORY_TURNS = 20; // each turn = user + assistant = 2 entries
const CACHE_DIR = join(homedir(), '.got');
const LOCATION_CACHE = join(CACHE_DIR, 'location.json');
const LOCATION_TTL = 24 * 60 * 60 * 1000;
const PROJECT_CACHE_TTL = 5 * 60 * 1000;
const LOG_FILE = join(CACHE_DIR, 'got.log');
const SHOULD_LOG = process.env.GOT_LOG === '1';

// ── Logging ─────────────────────────────────────────────────

function log(type, data) {
  if (!SHOULD_LOG) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    type,
    data,
  };
  appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// ── Load prompts ────────────────────────────────────────────

const promptDir = join(__dirname, 'prompts');
const promptParts = [];

// Personality first — primacy bias means the model internalizes voice before rules
promptParts.push('<personality>');
promptParts.push(readFileSync(join(promptDir, 'SOUL.md'), 'utf-8'));
promptParts.push('</personality>');

promptParts.push('<system_instructions>');
promptParts.push(readFileSync(join(promptDir, 'SYSTEM_PROMPT.md'), 'utf-8'));
promptParts.push('</system_instructions>');

// User context lives at ~/.got/me.md (not in the repo — see prompts/ME.md.example)
const mePath = join(CACHE_DIR, 'me.md');
if (existsSync(mePath)) {
  const me = readFileSync(mePath, 'utf-8').trim();
  if (me) {
    promptParts.push('<user_context>');
    promptParts.push(me);
    promptParts.push('</user_context>');
  }
}

const baseSystemPrompt = promptParts.join('\n\n');

log('prompts_loaded', {
  prompt_count: promptParts.length,
  total_length: baseSystemPrompt.length,
  has_me: existsSync(mePath),
});

// ── Command safety ──────────────────────────────────────────

const ALLOWED_COMMANDS = new Set([
  // system info
  'uname', 'hostname', 'uptime', 'whoami', 'date', 'id', 'arch',
  'sw_vers', 'system_profiler', 'sysctl', 'nproc', 'lsb_release',
  // files (read-only)
  'ls', 'cat', 'head', 'tail', 'find', 'file', 'wc', 'stat',
  'du', 'df', 'tree', 'realpath', 'basename', 'dirname',
  // processes & system health
  'ps', 'pgrep', 'lsof', 'vm_stat', 'free', 'pmset', 'top',
  // network (read-only)
  'ping', 'dig', 'nslookup', 'ifconfig', 'ip', 'host', 'networksetup',
  // git — validated separately via GIT_ALLOWED_SUBCOMMANDS
  // text processing (no sed/awk — both can write files)
  'grep', 'sort', 'uniq', 'cut', 'tr', 'jq',
  // introspection
  'which', 'type', 'echo', 'locale', 'pwd',
  // language runtimes — validated separately via VERSION_ONLY_COMMANDS
  'npm',
]);

// Git: only these subcommands are allowed (read-only operations)
const GIT_ALLOWED_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'branch', 'show', 'rev-parse', 'remote',
  'tag', 'shortlog', 'stash', 'blame', 'ls-files', 'ls-tree',
  'describe', 'name-rev', 'rev-list',
]);

// These commands may only be called with --version / -v / -V
const VERSION_ONLY_COMMANDS = new Set([
  'node', 'python', 'python3', 'ruby', 'java', 'rustc', 'cargo',
]);

const BLOCKED_PATTERNS = [
  /;/,                  // chaining
  /&&/,                 // conditional chain
  /\|\|/,              // or-chain
  /`/,                  // backtick substitution
  /\$\(/,              // command substitution
  />/,                  // redirects (covers > and >>)
  /\bsudo\b/,
  /\brm\s/,
  /\bmv\s/,
  /\bcp\s/,
  /\bdd\s/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bcurl\b/,          // no arbitrary HTTP — use web_search
  /\bwget\b/,
  // git and interpreter restrictions handled in validateCommand
  // system_profiler handled in validateCommand
  /[\n\r]/,             // no newline injection
];

function validateCommand(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { ok: false, reason: `Blocked: ${pattern.source}` };
    }
  }
  const segments = cmd.split('|').map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const parts = seg.split(/\s+/);
    const base = parts[0];

    // Git: allowlist of read-only subcommands
    if (base === 'git') {
      const sub = parts[1];
      if (!sub || !GIT_ALLOWED_SUBCOMMANDS.has(sub)) {
        return { ok: false, reason: `Git subcommand not allowed: ${sub || '(none)'}` };
      }
      // Block destructive flags on otherwise-safe subcommands
      if (sub === 'branch' && parts.some(a => /^-[dD]$/.test(a))) {
        return { ok: false, reason: 'Blocked: git branch delete' };
      }
      if (sub === 'tag' && parts.some(a => /^-[dD]$/.test(a))) {
        return { ok: false, reason: 'Blocked: git tag delete' };
      }
      if (sub === 'remote' && parts.length > 2 && !['show', '-v'].includes(parts[2])) {
        return { ok: false, reason: 'Blocked: git remote mutation' };
      }
      if (sub === 'stash' && parts.length > 2 && !['list', 'show'].includes(parts[2])) {
        return { ok: false, reason: 'Blocked: git stash mutation' };
      }
      continue;
    }

    // Language runtimes: version check only
    if (VERSION_ONLY_COMMANDS.has(base)) {
      const args = parts.slice(1);
      if (args.length !== 1 || !['--version', '-v', '-V'].includes(args[0])) {
        return { ok: false, reason: `${base} only allowed with --version` };
      }
      continue;
    }

    // top: only snapshot mode (-l), not interactive
    if (base === 'top') {
      if (!parts.some(a => a === '-l')) {
        return { ok: false, reason: 'top only allowed in snapshot mode (-l)' };
      }
      continue;
    }

    // system_profiler: only SPHardwareDataType, nothing else
    if (base === 'system_profiler') {
      if (parts.length !== 2 || parts[1] !== 'SPHardwareDataType') {
        return { ok: false, reason: 'system_profiler only allowed with SPHardwareDataType' };
      }
      continue;
    }

    if (!ALLOWED_COMMANDS.has(base)) {
      return { ok: false, reason: `Not allowed: ${base}` };
    }
  }
  return { ok: true };
}

function runCommand(cmd) {
  const check = validateCommand(cmd);
  if (!check.ok) return `BLOCKED: ${check.reason}`;
  try {
    const output = execSync(cmd, {
      timeout: CMD_TIMEOUT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().slice(0, 4000); // cap output for token sanity
  } catch (e) {
    const stderr = (e.stderr || e.message || 'Command failed').toString().trim();
    log('command_error', { cmd, stderr });
    // Return empty string if command not found, otherwise return the error
    if (stderr.includes('command not found') || stderr.includes('illegal option')) {
      return '';
    }
    return stderr.slice(0, 1000);
  }
}

// ── Location ────────────────────────────────────────────────

function readLocationCache() {
  if (!existsSync(LOCATION_CACHE)) return null;
  try {
    const cached = JSON.parse(readFileSync(LOCATION_CACHE, 'utf-8'));
    if (Date.now() - cached.timestamp < LOCATION_TTL) return cached.data;
  } catch (e) { log('cache_error', { file: 'location', error: e.message }); }
  return null;
}

async function fetchLocation() {
  const cached = readLocationCache();
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      'http://ip-api.com/json/?fields=city,regionName,country,countryCode,lat,lon,timezone',
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const data = await res.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = LOCATION_CACHE + '.tmp';
    writeFileSync(tmp, JSON.stringify({ timestamp: Date.now(), data }));
    renameSync(tmp, LOCATION_CACHE);
    return data;
  } catch (e) {
    return { error: e.message }; // includes timeout (AbortError) — graceful fallback
  }
}

// ── Tool definitions ────────────────────────────────────────

const customTools = [
  {
    name: 'run_command',
    description: [
      'Run a read-only shell command on the local machine.',
      'Allowed: ls, cat, head, tail, find, grep, git, ps, df, du, uptime, uname, date, system_profiler SPHardwareDataType, etc.',
      'Pipes between allowed commands are fine. No writes, no redirects, no sudo, no curl.',
      'The working directory is wherever the user invoked got.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
      },
      required: ['command'],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────

async function executeTool(name, input) {
  log('tool_execution', { tool: name, input });
  
  let result;
  switch (name) {
    case 'run_command':
      result = runCommand(input.command);
      break;
    default:
      result = `Unknown tool: ${name}`;
  }
  
  log('tool_result', { tool: name, result: result.slice(0, 500) });
  return result;
}

// ── Functional query whitelist (swiss army knife mode) ─────

const FUNCTIONAL_QUERIES = new Set([
  // System info
  'memory', 'ram', 'disk', 'diskspace', 'storage', 'battery', 'cpu', 'load',
  'uptime', 'processes', 'network', 'wifi', 'ip', 'ports',
  // Git
  'status', 'branches', 'branch', 'commits', 'log', 'diff', 'stash',
  // File system
  'pwd', 'cwd', 'ls', 'files', 'tree', 'here',
  // Dev environment
  'node', 'npm', 'python', 'ruby', 'java', 'go', 'rust', 'cargo',
  'versions', 'path',
  // Other utilities
  'date', 'time', 'timezone', 'locale', 'whoami', 'hostname',
]);

function isFunctionalQuery(query) {
  const q = query.toLowerCase().trim();
  return FUNCTIONAL_QUERIES.has(q) || q.startsWith('git ') || q === 'git';
}

// ── Model selection ─────────────────────────────────────────

function selectModel(query) {
  // Haiku for system/functional queries only — data, no personality needed.
  // Everything else uses Sonnet — personality requires the stronger model.
  if (isFunctionalQuery(query)) {
    log('model_selection', { model: 'haiku', query: query.slice(0, 50) });
    return MODEL_HAIKU;
  }
  
  log('model_selection', { model: 'sonnet', query: query.slice(0, 50) });
  return MODEL_SONNET;
}

// ── Build web search tool config ────────────────────────────

function buildWebSearchTool() {
  const tool = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 3,
  };

  // Hint user location if cached (don't block on it)
  const loc = readLocationCache();
  if (loc && loc.city) {
    tool.user_location = {
      type: 'approximate',
      city: loc.city,
      region: loc.regionName,
      country: loc.countryCode,
      timezone: loc.timezone,
    };
  }

  return tool;
}

// ── Project context ──────────────────────────────────────────

// Strip characters that could break the <project_context> XML structure
// or be used for prompt injection from untrusted project files.
function sanitizeForPrompt(text) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\0/g, '').trim();
}

function gatherProjectContext() {
  const cwd = process.cwd();
  const hash = createHash('md5').update(cwd).digest('hex').slice(0, 8);
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `project-${hash}.json`);

  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      if (Date.now() - cached.timestamp < PROJECT_CACHE_TTL) return cached.context;
    } catch (e) { log('cache_error', { file: 'project', error: e.message }); }
  }

  const lines = [];
  const opts = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 };

  // Determine project root (git root if available, else cwd)
  let projectRoot = cwd;
  try { projectRoot = execSync('git rev-parse --show-toplevel', opts).trim(); } catch (e) { log('git_error', { cmd: 'rev-parse', error: e.message }); }

  // Git: branch, recent commits, dirty state
  try {
    const branch = sanitizeForPrompt(execSync('git branch --show-current', opts).trim());
    if (branch) lines.push(`Branch: ${branch}`);
  } catch (e) { log('git_error', { cmd: 'branch', error: e.message }); }
  try {
    const gitLog = sanitizeForPrompt(execSync('git log --oneline -5', opts).trim());
    if (gitLog) lines.push(`Recent commits:\n${gitLog}`);
  } catch (e) { log('git_error', { cmd: 'log', error: e.message }); }
  try {
    const dirty = sanitizeForPrompt(execSync('git status --short', opts).trim());
    if (dirty) lines.push(`Uncommitted:\n${dirty}`);
  } catch (e) { log('git_error', { cmd: 'status', error: e.message }); }

  // Project manifest — first match wins, prepended so it leads the context
  const manifests = [
    ['package.json', (c) => {
      const p = JSON.parse(c);
      return [p.name && `${p.name} (Node.js)`, p.description].filter(Boolean).join(' — ');
    }],
    ['Cargo.toml', (c) => {
      const name = c.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
      const desc = c.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
      return [name && `${name} (Rust)`, desc].filter(Boolean).join(' — ');
    }],
    ['pyproject.toml', (c) => {
      const name = c.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
      const desc = c.match(/^description\s*=\s*["']([^"']+)["']/m)?.[1];
      return [name && `${name} (Python)`, desc].filter(Boolean).join(' — ');
    }],
    ['setup.cfg', (c) => {
      const name = c.match(/^name\s*=\s*(.+)/m)?.[1]?.trim();
      const desc = c.match(/^description\s*=\s*(.+)/m)?.[1]?.trim();
      return [name && `${name} (Python)`, desc].filter(Boolean).join(' — ');
    }],
    ['go.mod', (c) => {
      const mod = c.match(/^module\s+(\S+)/m)?.[1];
      return mod ? `${mod} (Go)` : '';
    }],
    ['composer.json', (c) => {
      const p = JSON.parse(c);
      return [p.name && `${p.name} (PHP)`, p.description].filter(Boolean).join(' — ');
    }],
    ['pubspec.yaml', (c) => {
      const name = c.match(/^name:\s*(.+)/m)?.[1]?.trim();
      const desc = c.match(/^description:\s*(.+)/m)?.[1]?.trim();
      return [name && `${name} (Dart/Flutter)`, desc].filter(Boolean).join(' — ');
    }],
  ];

  for (const [file, parse] of manifests) {
    if (existsSync(join(projectRoot, file))) {
      try {
        const result = parse(readFileSync(join(projectRoot, file), 'utf-8'));
        if (result) { lines.unshift(`Project: ${sanitizeForPrompt(result)}`); break; }
      } catch (e) { log('manifest_error', { file, error: e.message }); }
    }
  }

  // README: first 3 non-empty lines, max 300 chars
  for (const name of ['README.md', 'README.rst', 'README.txt', 'README']) {
    if (existsSync(join(projectRoot, name))) {
      try {
        const preview = sanitizeForPrompt(
          readFileSync(join(projectRoot, name), 'utf-8')
            .split('\n')
            .map(l => l.replace(/^[#*\s]+/, '').trim())
            .filter(Boolean)
            .slice(0, 3)
            .join(' ')
            .slice(0, 300)
        );
        if (preview) lines.push(`README: ${preview}`);
      } catch (e) { log('readme_error', { name, error: e.message }); }
      break;
    }
  }

  const context = lines.length ? lines.join('\n') : null;
  log('project_context', { cwd, lines: lines.length });

  try {
    const tmp = cacheFile + '.tmp';
    writeFileSync(tmp, JSON.stringify({ timestamp: Date.now(), context }));
    renameSync(tmp, cacheFile);
  } catch (e) { log('cache_write_error', { file: cacheFile, error: e.message }); }
  return context;
}

// ── Stdin ────────────────────────────────────────────────────

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim().slice(0, 4000)));
    process.stdin.on('error', () => resolve(''));
  });
}

// ── Query runner ─────────────────────────────────────────────

// Stateful filter: strips <cite>…</cite> tags from a text stream without
// buffering the full response. Buffers only when inside a potential tag.
function makeCiteStripper() {
  let buf = '';
  return {
    push(text) {
      buf += text;
      let out = '';
      while (buf.length) {
        const lt = buf.indexOf('<');
        if (lt === -1) { out += buf; buf = ''; break; }
        out += buf.slice(0, lt);
        buf = buf.slice(lt);
        if (buf.startsWith('<cite')) {
          const end = buf.indexOf('</cite>');
          if (end === -1) break;           // incomplete tag — keep buffered
          buf = buf.slice(end + 7);        // skip entire <cite>…</cite>
        } else {
          out += '<'; buf = buf.slice(1);  // not a cite tag, pass through
        }
      }
      return out;
    },
    flush() {
      const out = buf.replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '').replace(/<[^>]*$/, '');
      buf = '';
      return out;
    },
  };
}

// Few-shot examples — shows the model the exact voice + format we want.
// Stronger than instructions because the model pattern-matches conversation history.
const FEW_SHOT = [
  { role: 'user', content: 'got uk elections\n[max 2 lines total]' },
  { role: 'assistant', content: 'Labour\'s 20 points ahead and still finding ways to make it interesting.\nElection\'s July 4th. Independence Day, if you squint.' },
  { role: 'user', content: 'got coffee\n[max 2 lines total]' },
  { role: 'assistant', content: 'Bold choice at this hour.' },
];

// Runs one formatted query through the tool-use loop, streaming text to stdout.
// history: shared array for REPL context (clean turns only). Pass [] for one-shot.
async function runQuery(formattedMessage, history, client, model, tools, systemPrompt) {
  const messages = [...FEW_SHOT, ...history, { role: 'user', content: formattedMessage }];

  let response;
  let iterations = 0;
  const MAX_ITERATIONS = 10;
  let rawText = '';
  let didOutput = false;

  while (iterations++ < MAX_ITERATIONS) {
    log('api_request', {
      iteration: iterations,
      model,
      max_tokens: MAX_TOKENS,
      message_count: messages.length,
      tools: tools.map(t => t.name || t.type),
      system_prompt_length: systemPrompt.length,
    });

    const stripper = makeCiteStripper();
    let iterText = '';

    const stream = client.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    });

    stream.on('text', text => {
      const safe = stripper.push(text);
      if (safe) { process.stdout.write(safe); didOutput = true; }
      iterText += text;
    });

    response = await stream.finalMessage();

    const flushed = stripper.flush();
    if (flushed) { process.stdout.write(flushed); didOutput = true; }

    log('api_response', {
      iteration: iterations,
      stop_reason: response.stop_reason,
      usage: response.usage,
      content_types: response.content.map(b => b.type),
    });

    const toolCalls = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolCalls.length === 0) {
      rawText = iterText;
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const results = [];
    for (const call of toolCalls) {
      const result = await executeTool(call.name, call.input);
      results.push({ type: 'tool_result', tool_use_id: call.id, content: String(result) });
    }
    // Voice nudge after tool results — recency reinforcement
    const usedWebSearch = toolCalls.some(c => c.name === 'web_search');
    const nudge = usedWebSearch
      ? '[you just read a lot of news. ignore most of it. 2 lines: one detail, one dry remark. you are not a journalist.]'
      : '[max 2 lines. end with a remark, not a fact.]';
    results.push({ type: 'text', text: nudge });
    messages.push({ role: 'user', content: results });
  }

  if (didOutput) process.stdout.write('\n');

  // Strip citations from accumulated text before storing in history
  const cleanText = rawText.replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '').trim();

  history.push({ role: 'user', content: formattedMessage });
  if (cleanText) history.push({ role: 'assistant', content: cleanText });

  // Cap history to avoid unbounded context growth in REPL sessions
  const maxEntries = MAX_HISTORY_TURNS * 2;
  while (history.length > maxEntries) history.shift();

  return cleanText;
}

// ── REPL ────────────────────────────────────────────────────

async function startRepl(client, tools, systemPrompt) {
  const history = [];

  console.log('got repl — quit or ctrl+d to exit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write('> ');

  for await (const line of rl) {
    const input = line.trim();

    if (!input) {
      process.stdout.write('> ');
      continue;
    }

    if (input === 'quit' || input === 'exit') {
      rl.close();
      break;
    }

    const query = isFunctionalQuery(input)
      ? `[system query] ${input}`
      : `got ${input}\n[max 2 lines total]`;

    try {
      // REPL always uses Sonnet — conversational context benefits from the stronger model
      await runQuery(query, history, client, MODEL_SONNET, tools, systemPrompt);
      process.stdout.write('\n'); // blank line between response and next prompt
    } catch (e) {
      process.stdout.write('\n');
      if (e.status === 429) {
        console.log('Rate limited. Give it a second.\n');
      } else {
        console.log(`${e.message || 'Something went wrong.'}\n`);
      }
    }

    process.stdout.write('> ');
  }

  console.log('later.');
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2).join(' ');
  const stdinContent = await readStdin();

  let query = rawArgs;

  if ((!query && !stdinContent) || query === 'help' || query === '--help' || query === '-h') {
    console.log(`got — one-arm-bandit CLI with personality

Usage: got <query>
       got repl
       <command> | got [question]

WITTY MODE (default — personality first):
  got shakespeare      Shakespeare quote with commentary
  got soul             Witty response ("Blame it on the boogie")
  got trump            Current news with maximum sarcasm
  got weather          Local weather with personality
  got wit              BE witty (not define wit)

SWISS ARMY KNIFE MODE (functional — straight facts):
  System:   memory, ram, disk, diskspace, storage, battery, cpu, load,
            uptime, processes, network, wifi, ip, ports
  Git:      status, branches, branch, commits, log, diff, stash
  Files:    pwd, cwd, ls, files, tree, here
  Dev:      node, npm, python, ruby, java, go, rust, cargo, versions
  Other:    date, time, timezone, locale, whoami, hostname

PIPE MODE (pipe content as context):
  npm test 2>&1 | got what broke
  git diff | got
  cat error.log | got explain this

REPL MODE (persistent session with memory):
  got repl

Set ANTHROPIC_API_KEY in your environment.
Set GOT_LOG=1 to enable logging to ~/.got/got.log

Override models: GOT_MODEL_SONNET, GOT_MODEL_HAIKU
`);
    process.exit(0);
  }

  if (query === 'version' || query === '--version' || query === '-v') {
    const { version } = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
    console.log(`got v${version}`);
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }

  const client = new Anthropic();
  const location = await fetchLocation();
  const tools = [buildWebSearchTool(), ...customTools];

  const projectContext = gatherProjectContext();
  let systemPrompt = baseSystemPrompt;
  if (location && location.city) {
    const loc = sanitizeForPrompt(
      `${location.city}, ${location.regionName}, ${location.country} (${location.timezone})`
    );
    systemPrompt += `\n\n<location>\n${loc}\n</location>`;
  }
  if (projectContext) {
    systemPrompt += `\n\n<project_context>\n${projectContext}\n</project_context>`;
  }

  // Voice anchor at the end of system prompt — recency bias reinforcement
  systemPrompt += '\n\n<reminder>2-3 lines max. Dry, brief, opinionated. Not an assistant. Not a summarizer.</reminder>';

  if (query === 'repl') {
    await startRepl(client, tools, systemPrompt);
    return;
  }

  const model = stdinContent ? MODEL_SONNET : selectModel(query);

  // Build the final query, injecting piped content when present
  if (stdinContent) {
    const question = query || 'what is this?';
    const tag = isFunctionalQuery(question) ? '[system query]' : '[piped input]';
    query = `${tag} ${question}\n\n<stdin>\n${stdinContent}\n</stdin>\n[max 3 lines]`;
  } else if (isFunctionalQuery(query)) {
    query = `[system query] ${query}`;
  } else {
    query = `got ${query}\n[max 2 lines total]`;
  }

  await runQuery(query, [], client, model, tools, systemPrompt);
}

// ── Exports for testing ─────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateCommand,
    isFunctionalQuery,
    selectModel,
    makeCiteStripper,
    sanitizeForPrompt,
  };
}

// ── Run ─────────────────────────────────────────────────────

if (require.main === module) {
main().catch(e => {
  if (e.status === 401) {
    console.log('Invalid API key.');
  } else if (e.status === 429) {
    console.log('Rate limited. Try again in a moment.');
  } else {
    console.error(e.message || 'Something went wrong.');
  }
  process.exit(1);
});
}
