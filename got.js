#!/usr/bin/env node

const Anthropic = require('@anthropic-ai/sdk');
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

// ── Config ──────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;
const CMD_TIMEOUT = 5000;
const CACHE_DIR = join(homedir(), '.got');
const LOCATION_CACHE = join(CACHE_DIR, 'location.json');
const LOCATION_TTL = 24 * 60 * 60 * 1000;
const LOG_FILE = join(CACHE_DIR, 'got.log');
const SHOULD_LOG = process.env.GOT_LOG === '1';

// ── Load prompts ────────────────────────────────────────────

const promptDir = join(__dirname, 'prompts');
const promptParts = [
  readFileSync(join(promptDir, 'SYSTEM_PROMPT.md'), 'utf-8'),
  readFileSync(join(promptDir, 'SOUL.md'), 'utf-8'),
];
const mePath = join(promptDir, 'ME.md');
if (existsSync(mePath)) {
  const me = readFileSync(mePath, 'utf-8').trim();
  if (me) promptParts.push(`# About the person you work with\n\n${me}`);
}
const systemPrompt = promptParts.join('\n\n');

// Debug: Log prompt loading info
if (SHOULD_LOG) {
  log('prompts_loaded', {
    prompt_count: promptParts.length,
    total_length: systemPrompt.length,
    has_me: existsSync(mePath),
  });
}

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

// ── Command safety ──────────────────────────────────────────

const ALLOWED_COMMANDS = new Set([
  // system info
  'uname', 'hostname', 'uptime', 'whoami', 'date', 'id', 'arch',
  'sw_vers', 'system_profiler', 'sysctl', 'nproc', 'lsb_release',
  // files (read-only)
  'ls', 'cat', 'head', 'tail', 'find', 'file', 'wc', 'stat',
  'du', 'df', 'tree', 'realpath', 'basename', 'dirname',
  // processes
  'ps', 'pgrep', 'lsof', 'vm_stat', 'free', 'top',
  // network (read-only)
  'ping', 'dig', 'nslookup', 'ifconfig', 'ip', 'host', 'networksetup',
  // git (all subcommands are read-safe enough given no shell writes)
  'git',
  // text processing
  'grep', 'awk', 'sed', 'sort', 'uniq', 'cut', 'tr', 'jq', 'xargs',
  // introspection
  'which', 'type', 'echo', 'printenv', 'env', 'locale', 'pwd',
  // language version checks
  'node', 'npm', 'python', 'python3', 'ruby', 'java', 'rustc', 'cargo',
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
];

function validateCommand(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { ok: false, reason: `Blocked: ${pattern.source}` };
    }
  }
  const segments = cmd.split('|').map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const base = seg.split(/\s+/)[0];
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
    });
    return output.trim().slice(0, 4000); // cap output for token sanity
  } catch (e) {
    return (e.stderr || e.message || 'Command failed').trim().slice(0, 1000);
  }
}

// ── Location ────────────────────────────────────────────────

function readLocationCache() {
  if (!existsSync(LOCATION_CACHE)) return null;
  try {
    const cached = JSON.parse(readFileSync(LOCATION_CACHE, 'utf-8'));
    if (Date.now() - cached.timestamp < LOCATION_TTL) return cached.data;
  } catch {}
  return null;
}

async function fetchLocation() {
  const cached = readLocationCache();
  if (cached) return cached;

  try {
    const res = await fetch('http://ip-api.com/json/?fields=city,regionName,country,countryCode,lat,lon,timezone');
    const data = await res.json();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(LOCATION_CACHE, JSON.stringify({ timestamp: Date.now(), data }));
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Tool definitions ────────────────────────────────────────

const customTools = [
  {
    name: 'run_command',
    description: [
      'Run a read-only shell command on the local machine.',
      'Allowed: ls, cat, head, tail, find, grep, git, ps, df, du, uptime, uname, date, etc.',
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

// ── Main ────────────────────────────────────────────────────

async function main() {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.log('Usage: got <anything>');
    console.log('Examples: got weather, got status, got pizza, got "meaning of life"');
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }

  const client = new Anthropic();
  const tools = [buildWebSearchTool(), ...customTools];
  const messages = [{ role: 'user', content: query }];

  // Tool-use loop
  let response;
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations++ < MAX_ITERATIONS) {
    const apiRequest = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    };
    
    log('api_request', {
      iteration: iterations,
      model: MODEL,
      max_tokens: MAX_TOKENS,
      message_count: messages.length,
      tools: tools.map(t => t.name || t.type),
      system_prompt_length: systemPrompt.length,
    });
    
    response = await client.messages.create(apiRequest);
    
    log('api_response', {
      iteration: iterations,
      stop_reason: response.stop_reason,
      usage: response.usage,
      content_types: response.content.map(b => b.type),
    });

    // Only loop if the model wants us to execute custom tools
    const toolCalls = response.content.filter(b => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolCalls.length === 0) break;

    // Append the assistant's full response (including server_tool_use blocks)
    messages.push({ role: 'assistant', content: response.content });

    // Execute each custom tool and collect results
    const results = [];
    for (const call of toolCalls) {
      const result = await executeTool(call.name, call.input);
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: String(result),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  // Extract and print text
  const output = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  if (output) {
    console.log(output);
  }
}

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
