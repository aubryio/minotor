import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test, TestContext } from 'node:test';

import log from 'loglevel';

import { GtfsParser, setParserLogLevel } from '../../parser.js';
import { parserLog } from '../logging.js';
import { parseTransfers } from '../transfers.js';

let previousParserLevel: ReturnType<typeof parserLog.getLevel>;
let previousRootLevel: ReturnType<typeof log.getLevel>;
beforeEach(() => {
  previousParserLevel = parserLog.getLevel();
  previousRootLevel = log.getLevel();
});
afterEach(() => {
  parserLog.setLevel(previousParserLevel, false);
  log.setLevel(previousRootLevel, false);
});

function captureConsole(t: TestContext) {
  const calls = {
    info: t.mock.method(console, 'info', () => {}),
    warn: t.mock.method(console, 'warn', () => {}),
    error: t.mock.method(console, 'error', () => {}),
  };
  t.after(() => {
    t.mock.restoreAll();
    parserLog.rebuild();
    log.rebuild();
  });
  return calls;
}

test('parser defaults to warnings', () => {
  assert.equal(parserLog.getLevel(), parserLog.levels.WARN);
});

for (const [level, expected] of [
  ['info', [1, 1, 1]],
  ['warn', [0, 1, 1]],
  ['error', [0, 0, 1]],
  ['silent', [0, 0, 0]],
] as const) {
  test(`parser filters diagnostics at ${level}`, (t) => {
    const calls = captureConsole(t);
    setParserLogLevel(level);
    parserLog.info('progress');
    parserLog.warn('warning');
    parserLog.error('error');
    assert.deepEqual(
      Object.values(calls).map((method) => method.mock.callCount()),
      expected,
    );
  });
}

test('parsing respects the level and preserves output and application logging', async (t) => {
  const calls = captureConsole(t);
  const parser = new GtfsParser(
    './src/gtfs/__tests__/resources/sample-feed.zip',
  );
  const date = new Date('2007-01-10');
  log.setLevel('error', false);
  setParserLogLevel('info');
  const stops = (await parser.parseStops()).serialize();
  assert.ok(calls.info.mock.callCount() > 0);
  calls.info.mock.resetCalls();
  const timetable = (await parser.parseTimetable(date)).serialize();
  assert.ok(calls.info.mock.callCount() > 0);
  assert.equal(log.getLevel(), log.levels.ERROR);

  setParserLogLevel('silent');
  for (const method of Object.values(calls)) method.mock.resetCalls();
  assert.deepEqual((await parser.parseStops()).serialize(), stops);
  assert.deepEqual((await parser.parseTimetable(date)).serialize(), timetable);
  assert.deepEqual(
    Object.values(calls).map((method) => method.mock.callCount()),
    [0, 0, 0],
  );
  assert.equal(parserLog.getLevel(), parserLog.levels.SILENT);
  assert.equal(log.getLevel(), log.levels.ERROR);
});

test('transfer warnings use the parser logger', async (t) => {
  const calls = captureConsole(t);
  for (const level of ['warn', 'silent'] as const) {
    setParserLogLevel(level);
    calls.warn.mock.resetCalls();
    await parseTransfers(
      Readable.from([
        'from_stop_id,to_stop_id,transfer_type\nmissing,other,0\n',
      ]),
      new Map(),
      new Set(),
    );
    assert.equal(calls.warn.mock.callCount(), level === 'warn' ? 1 : 0);
  }
});
