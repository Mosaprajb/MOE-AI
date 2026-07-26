import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(directory, '..', '..');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (!files.length) {
  console.error('No Worker test files were found.');
  process.exit(1);
}

const failures = [];
for (const name of files) {
  const absolute = join(directory, name);
  const display = relative(repositoryRoot, absolute).replaceAll('\\', '/');
  console.log(`\n=== ${display} ===`);
  const result = spawnSync(process.execPath, ['--test', absolute], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) failures.push(display);
}

if (failures.length) {
  console.error(`\nWorker test failures (${failures.length}): ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`\nAll ${files.length} Worker test files passed in isolated processes.`);
