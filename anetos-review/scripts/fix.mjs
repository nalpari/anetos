#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, LedgerError, fileHash, loadLedger, saveLedger } from './ledger.mjs';

const CONFIG_VERSION = 1;
const KINDS = ['test', 'static'];

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return ['설정이 객체가 아닙니다'];
  const errors = [];
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  if (cfg.version !== CONFIG_VERSION) errors.push(`version: ${CONFIG_VERSION} 이어야 합니다`);
  if (!Array.isArray(cfg.testPaths) || !cfg.testPaths.every(filled)) {
    errors.push('testPaths: 비어 있지 않은 문자열의 배열이어야 합니다');
  }
  if (!Array.isArray(cfg.checks)) {
    errors.push('checks: 배열이어야 합니다');
    return errors;
  }
  const names = new Set();
  cfg.checks.forEach((c, i) => {
    const at = `checks[${i}]`;
    if (!c || typeof c !== 'object') {
      errors.push(`${at}: 객체가 아닙니다`);
      return;
    }
    if (!filled(c.name)) errors.push(`${at}: name 이 비어 있습니다`);
    else if (names.has(c.name)) errors.push(`${at}: name 이 겹칩니다 (${c.name})`);
    else names.add(c.name);
    if (!KINDS.includes(c.kind)) errors.push(`${at}: kind 는 test 또는 static 이어야 합니다`);
    if (!filled(c.command)) errors.push(`${at}: command 가 비어 있습니다`);
    if (c.timeoutSec !== undefined && !(typeof c.timeoutSec === 'number' && c.timeoutSec > 0)) {
      errors.push(`${at}: timeoutSec 는 0보다 큰 수여야 합니다`);
    }
  });
  return errors;
}

function configPath(root) {
  return path.join(root, DIR, 'config.json');
}

export function loadConfig(root) {
  let raw;
  try {
    raw = fs.readFileSync(configPath(root), 'utf8');
  } catch {
    throw new LedgerError('검증 설정이 없습니다. /anetos-review:review-config 를 먼저 실행하세요.');
  }
  let cfg;
  try {
    cfg = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    throw new LedgerError(`config.json 을 읽을 수 없습니다: ${e.message}`);
  }
  const errors = validateConfig(cfg);
  if (errors.length) throw new LedgerError(`config.json 형식 오류:\n- ${errors.join('\n- ')}`);
  return cfg;
}

export function saveConfig(root, cfg) {
  const errors = validateConfig(cfg);
  if (errors.length) throw new LedgerError(`설정 형식 오류:\n- ${errors.join('\n- ')}`);
  if (!fs.existsSync(path.join(root, DIR))) {
    throw new LedgerError(`${DIR}/ 가 없습니다. 먼저 /anetos-review:review 를 실행하세요.`);
  }
  fs.writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function isTestPath(cfg, file) {
  return cfg.testPaths.some((glob) => globToRegExp(glob).test(file));
}

const TAIL_LINES = 40;
const DEFAULT_TIMEOUT_SEC = 600;

export function runCheck(root, check) {
  const r = spawnSync(check.command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: (check.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    name: check.name,
    kind: check.kind,
    result: r.status === 0 && !r.error ? 'pass' : 'fail',
    timedOut: r.error?.code === 'ETIMEDOUT',
    tail: output.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n'),
  };
}

export function runChecks(root, cfg) {
  return cfg.checks.map((check) => runCheck(root, check));
}

export function compare(baseline, current) {
  const before = new Map(baseline.map((b) => [b.name, b.result]));
  return current.map((c) => {
    const was = before.get(c.name) ?? 'pass';
    const verdict =
      was === 'pass'
        ? c.result === 'pass' ? 'kept' : 'regressed'
        : c.result === 'pass' ? 'improved' : 'masked';
    return { name: c.name, kind: c.kind, verdict, tail: c.tail };
  });
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new LedgerError(`git ${args[0]} 실패: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout;
}

const inReview = (file) => file === DIR || file.startsWith(`${DIR}/`);

// 추적 파일의 변경과 미추적 파일. .review/ 아래는 뺀다.
function workingChanges(root) {
  const parts = git(root, ['status', '--porcelain', '-z', '--untracked-files=all'])
    .split('\0')
    .filter(Boolean);
  const tracked = [];
  const untracked = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const files = [parts[i].slice(3)];
    // 이름 변경과 복사는 원래 경로가 다음 항목으로 온다.
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[++i];
      if (code[0] === 'R') files.push(from);
    }
    for (const file of files) {
      if (inReview(file)) continue;
      (code === '??' ? untracked : tracked).push(file);
    }
  }
  return { tracked, untracked };
}

function statePath(root) {
  return path.join(root, DIR, 'fix.tmp');
}

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(root, state) {
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

function requireState(root, stages) {
  const state = readState(root);
  if (!state || !stages.includes(state.stage)) {
    throw new LedgerError(
      `단계를 건너뛸 수 없습니다. 지금 단계는 ${state?.stage ?? '시작 전'} 이고, ${stages.join(' 또는 ')} 단계여야 합니다.`,
    );
  }
  return state;
}

// 수정을 시작한 뒤로 바뀌거나 새로 생긴 파일.
function changedSince(root, state) {
  const { tracked, untracked } = workingChanges(root);
  const known = new Set(state.untracked);
  return [...new Set([...tracked, ...untracked.filter((file) => !known.has(file))])];
}

export function start(root, id, log = () => {}) {
  const cfg = loadConfig(root);
  const finding = loadLedger(root).findings.find((f) => f.id === id);
  if (!finding) throw new LedgerError(`원장에 없는 id 입니다: ${id}`);
  if (finding.status !== 'open') {
    throw new LedgerError(`${id} 의 상태가 ${finding.status} 입니다. open 인 지적만 고칠 수 있습니다.`);
  }
  if (fs.existsSync(statePath(root))) {
    throw new LedgerError('진행 중인 수정이 있습니다. 먼저 finish 하거나 abort 하세요.');
  }
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const dirty = workingChanges(root).tracked;
  if (dirty.length) {
    throw new LedgerError(
      `커밋하지 않은 변경이 있어 시작할 수 없습니다: ${dirty.join(', ')}. 커밋하거나 치워 둔 뒤 다시 실행하세요.`,
    );
  }

  for (const check of cfg.checks) log(`검사 실행: ${check.name} → ${check.command}`);
  const baseline = runChecks(root, cfg);
  // 검사가 만든 파일도 "원래 있던 것"이 되도록 기준선 실행 뒤에 기록한다.
  const { untracked } = workingChanges(root);
  writeState(root, {
    id, head, untracked, baseline, stage: 'started', repro: false, testHashes: {}, result: null,
  });
  return {
    id,
    baseline: baseline.map(({ name, kind, result }) => ({ name, kind, result })),
    masked: baseline.filter((b) => b.result === 'fail').map((b) => b.name),
  };
}

export function abort(root) {
  const state = readState(root);
  if (!state) return { aborted: false };

  const exclude = `:(exclude)${DIR}`;
  git(root, ['reset', '-q', '--', '.', exclude]);
  git(root, ['checkout', '--', '.', exclude]);
  const known = new Set(state.untracked);
  for (const file of workingChanges(root).untracked) {
    if (!known.has(file)) fs.rmSync(path.join(root, file), { force: true });
  }

  const ledger = loadLedger(root);
  const finding = ledger.findings.find((f) => f.id === state.id);
  if (finding) {
    finding.fixAttempts = (finding.fixAttempts ?? 0) + 1;
    saveLedger(root, ledger);
  }
  fs.rmSync(statePath(root), { force: true });
  return { aborted: true, id: state.id, fixAttempts: finding?.fixAttempts ?? 0 };
}
