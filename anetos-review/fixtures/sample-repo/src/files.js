const fs = require('fs');

function readHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  const bytes = fs.readSync(fd, buffer, 0, 16, 0);
  if (bytes < 16) {
    throw new Error('header too short');
  }
  fs.closeSync(fd);
  return buffer;
}

module.exports = { readHeader };
