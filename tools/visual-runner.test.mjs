import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const exitCode of [0, 7]) {
  test(`visual container owns dependencies, workers and cleanup when tests exit ${exitCode}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'workspace-visual-runner-'));
    const log = path.join(directory, 'docker.jsonl');
    writeFileSync(path.join(directory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
process.exit(args[0] === 'run' ? Number(process.env.DOCKER_EXIT) : 0);
`, { mode: 0o755 });
    try {
      const result = spawnSync('bash', [fileURLToPath(new URL('../browser/run-visual.sh', import.meta.url)), '--grep', 'a test'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DOCKER_LOG: log,
          DOCKER_EXIT: String(exitCode), CEDAR_TEST_WORKERS: '3' },
      });
      assert.equal(result.status, exitCode, result.stderr);
      const [run, cleanup] = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(run[0], 'run');
      assert.ok(run.includes('--rm'));
      assert.ok(run.includes('/repo/browser/node_modules'));
      assert.ok(!run.some(arg => arg.startsWith('workspace-browser-modules:')));
      assert.ok(run.includes('CEDAR_TEST_WORKERS=3'));
      assert.deepEqual(run.slice(-2), ['--grep', 'a test']);
      assert.deepEqual(cleanup, ['rm', '-f', run[run.indexOf('--name') + 1]]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
