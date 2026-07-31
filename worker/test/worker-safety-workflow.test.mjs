import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/worker-safety-tests.yml', import.meta.url);
const rawWorkflow = readFileSync(workflowUrl, 'utf8');

function normalizeNewlines(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

const workflow = normalizeNewlines(rawWorkflow);

function jobBlock(jobName, nextJobName = null, source = workflow) {
  const normalized = `\n${normalizeNewlines(source)}`;
  const marker = `\n  ${jobName}:\n`;
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `workflow job ${jobName} must exist`);
  const from = start + 1;
  const endMarker = nextJobName ? `\n  ${nextJobName}:\n` : null;
  const end = endMarker ? normalized.indexOf(endMarker, from) : normalized.length;
  assert.notEqual(end, -1, `workflow job ${nextJobName} must exist after ${jobName}`);
  return normalized.slice(from, end);
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

test('workflow job parsing is stable with Windows CRLF line endings', () => {
  const windowsWorkflow = workflow.replace(/\n/g, '\r\n');
  const workerSafety = jobBlock('worker-safety', 'dashboard-visual-qa', windowsWorkflow);
  const visualQa = jobBlock('dashboard-visual-qa', null, windowsWorkflow);
  assert.match(workerSafety, /npm run test:worker/);
  assert.match(visualQa, /continue-on-error:\s*true/);
});
