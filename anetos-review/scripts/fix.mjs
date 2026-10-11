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
