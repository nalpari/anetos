const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHeader } = require('../src/files');

test('readHeader: 앞 16바이트를 돌려준다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-')), 'data.bin');
  fs.writeFileSync(file, Buffer.from('0123456789abcdefTAIL'));
  assert.equal(readHeader(file).toString(), '0123456789abcdef');
});
