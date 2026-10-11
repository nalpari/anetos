#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
export const DIR = '.review';

export class LedgerError extends Error {}

export function normFile(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function findingId(source, file, symbol) {
  const hash = createHash('sha1')
    .update(`${source}|${normFile(file)}|${symbol}`)
    .digest('hex');
  return `F-${hash.slice(0, 8)}`;
}

export function init(root, pluginRoot) {
  const dir = path.join(root, DIR);
  if (fs.existsSync(dir)) return { created: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(pluginRoot, 'rules', 'default.md'), path.join(dir, 'rules.md'));
  fs.writeFileSync(
    path.join(dir, 'findings.json'),
    JSON.stringify({ version: VERSION, findings: [] }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'decisions.md'), '# 결정 기록\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.tmp\n');
  return { created: true };
}

function ledgerPath(root) {
  return path.join(root, DIR, 'findings.json');
}

export function loadLedger(root) {
  const file = ledgerPath(root);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new LedgerError(`원장이 없습니다: ${file}. 먼저 init 을 실행하세요.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new LedgerError(`findings.json 을 읽을 수 없습니다: ${e.message}`);
  }
  if (!data || data.version !== VERSION || !Array.isArray(data.findings)) {
    throw new LedgerError(`findings.json 의 형식이 맞지 않습니다 (version ${VERSION} 필요).`);
  }
  return data;
}

export function saveLedger(root, ledger) {
  const file = ledgerPath(root);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function list(ledger, { files, status } = {}) {
  const wanted = files && new Set(files.map(normFile));
  return ledger.findings.filter(
    (f) => (!wanted || wanted.has(f.file)) && (!status || f.status === status),
  );
}
