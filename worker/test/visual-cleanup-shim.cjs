const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const originalRmSync = fs.rmSync.bind(fs);
const sleeper = new Int32Array(new SharedArrayBuffer(4));

fs.rmSync = function resilientRmSync(path, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return originalRmSync(path, options);
    } catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      Atomics.wait(sleeper, 0, 0, 150);
    }
  }
  if (lastError?.code === 'ENOTEMPTY' || lastError?.code === 'EBUSY' || lastError?.code === 'EPERM') return undefined;
  throw lastError;
};

syncBuiltinESMExports();
