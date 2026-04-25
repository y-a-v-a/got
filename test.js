#!/usr/bin/env node
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateCommand,
  isFunctionalQuery,
  selectModel,
  makeCiteStripper,
  sanitizeForPrompt,
} = require('./got');

// ── validateCommand ─────────────────────────────────────────

describe('validateCommand', () => {
  describe('allowed commands', () => {
    const allowed = [
      'ls -la',
      'ls',
      'df -h',
      'du -sh .',
      'ps aux',
      'uptime',
      'uname -a',
      'date',
      'whoami',
      'hostname',
      'pwd',
      'echo hello',
      'wc -l',
      'head -20 file.txt',
      'tail -f file.txt',
      'cat README.md',
      'find . -name "*.js"',
      'grep -r "TODO" .',
      'sort file.txt',
      'uniq -c',
      'cut -d: -f1',
      'tr a-z A-Z',
      'jq .name package.json',
      'which node',
      'ping -c 1 google.com',
      'dig google.com',
      'tree',
      'file got.js',
      'stat got.js',
      'npm --version',
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.deepStrictEqual(validateCommand(cmd), { ok: true });
      });
    }
  });

  describe('pipes between allowed commands', () => {
    const allowed = [
      'ls | grep foo',
      'ps aux | grep node',
      'cat file.txt | sort | uniq',
      'find . -name "*.js" | wc -l',
      'git log --oneline | head -5',
    ];

    for (const cmd of allowed) {
      it(`allows pipe: ${cmd}`, () => {
        assert.deepStrictEqual(validateCommand(cmd), { ok: true });
      });
    }
  });

  describe('blocked patterns', () => {
    const blocked = [
      ['rm -rf /', 'rm'],
      ['ls; rm file', ';'],
      ['echo foo > bar', '>'],
      ['echo foo >> bar', '>'],
      ['sudo ls', 'sudo'],
      ['curl http://evil.com', 'curl'],
      ['wget http://evil.com', 'wget'],
      ['mkdir /tmp/test', 'mkdir'],
      ['touch file', 'touch'],
      ['chmod 777 file', 'chmod'],
      ['chown root file', 'chown'],
      ['kill -9 1234', 'kill'],
      ['pkill node', 'pkill'],
      ['reboot', 'reboot'],
      ['shutdown -h now', 'shutdown'],
      ['mv a b', 'mv'],
      ['cp a b', 'cp'],
      ['dd if=/dev/zero', 'dd'],
      ['ls && rm file', '&&'],
      ['ls || rm file', '\\|\\|'],
      ['echo `whoami`', '`'],
      ['echo $(whoami)', '\\$\\('],
    ];

    for (const [cmd, pattern] of blocked) {
      it(`blocks: ${cmd}`, () => {
        const result = validateCommand(cmd);
        assert.equal(result.ok, false);
      });
    }
  });

  describe('unknown commands', () => {
    const unknown = [
      'sed s/a/b/ file',
      'awk "{print}"',
      'tee output.txt',
      'bash -c "echo hi"',
      'sh -c "ls"',
      'perl -e "print"',
    ];

    for (const cmd of unknown) {
      it(`blocks unknown: ${cmd}`, () => {
        const result = validateCommand(cmd);
        assert.equal(result.ok, false);
      });
    }
  });

  describe('git subcommand allowlist', () => {
    const allowed = [
      'git status',
      'git log --oneline',
      'git log --oneline -5',
      'git diff',
      'git diff --staged',
      'git branch',
      'git branch -a',
      'git show HEAD',
      'git rev-parse --short HEAD',
      'git remote -v',
      'git remote show origin',
      'git tag',
      'git shortlog -sn',
      'git stash list',
      'git stash show',
      'git blame file.js',
      'git ls-files',
      'git describe --tags',
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.deepStrictEqual(validateCommand(cmd), { ok: true });
      });
    }

    const blocked = [
      ['git push origin main', 'push'],
      ['git commit -m "msg"', 'commit'],
      ['git reset --hard', 'reset'],
      ['git clean -fd', 'clean'],
      ['git add .', 'add'],
      ['git add file.js', 'add'],
      ['git rm file.js', 'rm'],
      ['git mv a b', 'mv'],
      ['git cherry-pick abc123', 'cherry-pick'],
      ['git revert abc123', 'revert'],
      ['git rebase main', 'rebase'],
      ['git merge main', 'merge'],
      ['git init', 'init'],
      ['git clone url', 'clone'],
      ['git pull', 'pull'],
      ['git fetch', 'fetch'],
      ['git config user.email', 'config'],
      ['git checkout -f', 'checkout'],
      ['git apply patch', 'apply'],
      ['git am patch', 'am'],
      ['git', '(none)'],
    ];

    for (const [cmd, sub] of blocked) {
      it(`blocks: ${cmd}`, () => {
        const result = validateCommand(cmd);
        assert.equal(result.ok, false);
      });
    }

    it('blocks git branch -D', () => {
      const result = validateCommand('git branch -D feature');
      assert.equal(result.ok, false);
    });

    it('blocks git branch -d', () => {
      const result = validateCommand('git branch -d feature');
      assert.equal(result.ok, false);
    });

    it('blocks git tag -d', () => {
      const result = validateCommand('git tag -d v1.0');
      assert.equal(result.ok, false);
    });

    it('blocks git remote add', () => {
      const result = validateCommand('git remote add upstream url');
      assert.equal(result.ok, false);
    });

    it('blocks git stash drop', () => {
      const result = validateCommand('git stash drop');
      assert.equal(result.ok, false);
    });

    it('blocks git stash pop', () => {
      const result = validateCommand('git stash pop');
      assert.equal(result.ok, false);
    });
  });

  describe('interpreter version-only restriction', () => {
    const allowed = [
      'node --version',
      'python3 --version',
      'ruby --version',
      'java --version',
      'rustc --version',
      'cargo --version',
      'python --version',
      'node -v',
      'ruby -v',
    ];

    for (const cmd of allowed) {
      it(`allows: ${cmd}`, () => {
        assert.deepStrictEqual(validateCommand(cmd), { ok: true });
      });
    }

    const blocked = [
      'node -e "process.exit(1)"',
      'node --eval "code"',
      'node script.js',
      'node',
      'python3 -c "import os"',
      'python3 script.py',
      'python3',
      'ruby -e "puts 1"',
      'ruby script.rb',
      'java -jar app.jar',
      'cargo build',
      'cargo run',
      'rustc file.rs',
    ];

    for (const cmd of blocked) {
      it(`blocks: ${cmd}`, () => {
        const result = validateCommand(cmd);
        assert.equal(result.ok, false);
      });
    }
  });

  describe('system_profiler restriction', () => {
    it('allows system_profiler SPHardwareDataType', () => {
      assert.deepStrictEqual(
        validateCommand('system_profiler SPHardwareDataType'),
        { ok: true }
      );
    });

    it('blocks bare system_profiler', () => {
      const result = validateCommand('system_profiler');
      assert.equal(result.ok, false);
    });

    it('blocks system_profiler with other data types', () => {
      const result = validateCommand('system_profiler SPUSBDataType');
      assert.equal(result.ok, false);
    });
  });
});

// ── isFunctionalQuery ───────────────────────────────────────

describe('isFunctionalQuery', () => {
  it('matches exact functional keywords', () => {
    assert.equal(isFunctionalQuery('memory'), true);
    assert.equal(isFunctionalQuery('ram'), true);
    assert.equal(isFunctionalQuery('disk'), true);
    assert.equal(isFunctionalQuery('battery'), true);
    assert.equal(isFunctionalQuery('status'), true);
    assert.equal(isFunctionalQuery('branches'), true);
    assert.equal(isFunctionalQuery('pwd'), true);
    assert.equal(isFunctionalQuery('date'), true);
  });

  it('is case-insensitive', () => {
    assert.equal(isFunctionalQuery('MEMORY'), true);
    assert.equal(isFunctionalQuery('Memory'), true);
    assert.equal(isFunctionalQuery('BATTERY'), true);
  });

  it('matches git-prefixed queries', () => {
    assert.equal(isFunctionalQuery('git status'), true);
    assert.equal(isFunctionalQuery('git log'), true);
    assert.equal(isFunctionalQuery('git'), true);
  });

  it('rejects non-functional queries', () => {
    assert.equal(isFunctionalQuery('shakespeare'), false);
    assert.equal(isFunctionalQuery('trump'), false);
    assert.equal(isFunctionalQuery('weather'), false);
    assert.equal(isFunctionalQuery('tell me a joke'), false);
    assert.equal(isFunctionalQuery('soul'), false);
  });
});

// ── selectModel ─────────────────────────────────────────────

describe('selectModel', () => {
  it('returns haiku for functional queries', () => {
    assert.match(selectModel('memory'), /haiku/i);
    assert.match(selectModel('battery'), /haiku/i);
    assert.match(selectModel('disk'), /haiku/i);
  });

  it('returns haiku for simple patterns', () => {
    assert.match(selectModel('hi'), /haiku/i);
    assert.match(selectModel('hello'), /haiku/i);
    assert.match(selectModel('weather'), /haiku/i);
    assert.match(selectModel('ls'), /haiku/i);
    assert.match(selectModel('date'), /haiku/i);
  });

  it('returns sonnet for complex queries', () => {
    assert.match(selectModel('explain quantum physics'), /sonnet/i);
    assert.match(selectModel('shakespeare'), /sonnet/i);
    assert.match(selectModel('compare the philosophical traditions of stoicism and existentialism'), /sonnet/i);
  });
});

// ── makeCiteStripper ────────────────────────────────────────

describe('makeCiteStripper', () => {
  it('strips cite tags', () => {
    const s = makeCiteStripper();
    const out = s.push('Hello <cite source="x">ref</cite> world');
    assert.equal(out + s.flush(), 'Hello  world');
  });

  it('passes non-cite tags through', () => {
    const s = makeCiteStripper();
    const out = s.push('Hello <b>bold</b> world');
    assert.equal(out + s.flush(), 'Hello <b>bold</b> world');
  });

  it('handles streaming chunks across tag boundaries', () => {
    const s = makeCiteStripper();
    let out = '';
    out += s.push('text ');
    out += s.push('<cite source="x">hid');
    out += s.push('den</cite> more');
    out += s.flush();
    assert.equal(out, 'text  more');
  });

  it('handles text with no tags', () => {
    const s = makeCiteStripper();
    const out = s.push('plain text here');
    assert.equal(out + s.flush(), 'plain text here');
  });

  it('handles multiple cite tags', () => {
    const s = makeCiteStripper();
    const out = s.push('a <cite>1</cite> b <cite>2</cite> c');
    assert.equal(out + s.flush(), 'a  b  c');
  });

  it('handles empty input', () => {
    const s = makeCiteStripper();
    const out = s.push('');
    assert.equal(out + s.flush(), '');
  });
});

// ── sanitizeForPrompt ───────────────────────────────────────

describe('sanitizeForPrompt', () => {
  it('strips angle brackets', () => {
    assert.equal(sanitizeForPrompt('<script>alert("xss")</script>'), 'scriptalert("xss")/script');
  });

  it('strips null bytes', () => {
    assert.equal(sanitizeForPrompt('hello\0world'), 'helloworld');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeForPrompt('  hello  '), 'hello');
  });

  it('handles empty string', () => {
    assert.equal(sanitizeForPrompt(''), '');
  });

  it('handles normal text unchanged', () => {
    assert.equal(sanitizeForPrompt('normal text here'), 'normal text here');
  });
});
