import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/worker-safety-tests.yml', import.meta.url);
const workflow = readFileSync(workflowUrl, 'utf8');

function jobBlock(jobName, nextJobName = null) {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  assert.notEqual(start, -1, `workflow job ${jobName} must exist`);
  const from = start + 1;
  const end = nextJobName ? workflow.indexOf(`\n  ${nextJobName}:\n`, from) : workflow.length;
  assert.notEqual(end, -1, `workflow job ${nextJobName} must exist after ${jobName}`);
  return workflow.slice(from, end);
}

test('blocking Worker Safety owns the complete Worker suite and excludes browser QA', () => {
  const workerSafety = jobBlock('worker-safety', 'dashboard-visual-qa');
  assert.match(workerSafety, /Run complete Worker safety suite/);
  assert.match(workerSafety, /npm run test:worker/);
  assert.doesNotMatch(workerSafety, /visual-dashboard-browser\.mjs/);
  assert.doesNotMatch(workerSafety, /continue-on-error:\s*true/);
});

test('dashboard browser QA is isolated, non-blocking, and preserves diagnostics', () => {
  const visualQa = jobBlock('dashboard-visual-qa');
  assert.match(visualQa, /id:\s*visual_qa/);
  assert.match(visualQa, /continue-on-error:\s*true/);
  assert.match(visualQa, /node worker\/test\/visual-dashboard-browser\.mjs/);
  assert.match(visualQa, /actions\/upload-artifact@v4/);
  assert.match(visualQa, /if-no-files-found:\s*warn/);
  assert.match(visualQa, /steps\.visual_qa\.outcome/);
  assert.match(visualQa, /::warning title=Dashboard Visual QA isolated::/);
});
