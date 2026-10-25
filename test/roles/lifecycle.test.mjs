import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeContributions } from '../../src/roles/lifecycle.mjs';

test('contribution cleanup attempts every disposer and awaits delayed cleanup after a failure', async () => {
  const delayed = Promise.withResolvers();
  const called = [];
  let finished = false;
  const cleanup = disposeContributions([
    () => { called.push('context'); throw new Error('context failed'); },
    async () => { called.push('tool'); await delayed.promise; },
    () => { called.push('catalog'); throw new Error('catalog failed'); },
  ]).then(() => { finished = true; }, error => { finished = true; throw error; });
  assert.deepEqual(called, ['catalog', 'tool', 'context']);
  await Promise.resolve();
  assert.equal(finished, false);
  delayed.resolve();
  await assert.rejects(cleanup, error => error instanceof AggregateError && error.errors.length === 2);
  assert.equal(finished, true);
});
