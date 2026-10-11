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
