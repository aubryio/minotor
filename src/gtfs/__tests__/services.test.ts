import * as assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { DateTime } from 'luxon';

import { parseCalendar, parseCalendarDates, ServiceIds } from '../services.js';
describe('GTFS calendar parser', () => {
  describe('parsing a well formed stream', () => {
    it('should find valid services present in the source', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n',
      );
      mockedStream.push(
        '"testId","0","0","0","0","0","1","0","20231115","20231120"\n',
      );
      mockedStream.push(
        '"otherTestId","0","0","0","0","0","1","0","20231010","20231220"\n',
      );
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set();
      await parseCalendar(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-18T12:00:00+00:00'),
      );

      assert.deepEqual(validServiceIds, new Set(['testId', 'otherTestId']));
    });
    it('should not alter valid services already present in the input', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n',
      );
      mockedStream.push(
        '"testId","0","0","0","0","0","1","0","20231115","20231120"\n',
      );
      mockedStream.push(
        '"otherTestId","0","0","0","0","0","1","0","20231010","20231220"\n',
      );
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set([
        'testId',
        'yetAnotherTestId',
      ]);

      await parseCalendar(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-18T12:00:00+00:00'),
      );

      assert.deepEqual(
        validServiceIds,
        new Set(['testId', 'otherTestId', 'yetAnotherTestId']),
      );
    });
    it('should ignore services not valid on the right weekday', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n',
      );
      mockedStream.push(
        '"testId","1","0","0","0","0","0","0","20231115","20231120"\n',
      );
      mockedStream.push(
        '"otherTestId","0","0","0","0","0","1","0","20231010","20231220"\n',
      );
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set();
      await parseCalendar(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-18T12:00:00+00:00'),
      );

      assert.deepEqual(validServiceIds, new Set(['otherTestId']));
    });
    it('should ignore services not valid on the date window', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n',
      );
      mockedStream.push(
        '"testId","0","0","0","0","0","1","0","20231119","20231120"\n',
      );
      mockedStream.push(
        '"otherTestId","0","0","0","0","0","1","0","20231010","20231220"\n',
      );
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set();
      await parseCalendar(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-18T12:00:00+00:00'),
      );

      assert.deepEqual(validServiceIds, new Set(['otherTestId']));
    });
  });
});

describe('GTFS calendar dates parser', () => {
  describe('parsing a well formed stream', () => {
    it('should find valid services present in the source', async () => {
      const mockedStream = new Readable();
      mockedStream.push('service_id,date,exception_type\n');
      mockedStream.push('"testId","20231115","1"\n');
      mockedStream.push('"otherTestId","20231115","1"\n');
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set();
      await parseCalendarDates(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-15T12:00:00+00:00'),
      );

      assert.deepEqual(validServiceIds, new Set(['testId', 'otherTestId']));
    });
    it('should ignore services valid on a different date', async () => {
      const mockedStream = new Readable();
      mockedStream.push('service_id,date,exception_type\n');
      mockedStream.push('"testId","20231116","1"\n');
      mockedStream.push('"otherTestId","20231115","1"\n');
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set();
      await parseCalendarDates(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-15T12:00:00+00:00'),
      );

      assert.deepEqual(validServiceIds, new Set(['otherTestId']));
    });
    it('should not alter valid services already present in the input', async () => {
      const mockedStream = new Readable();
      mockedStream.push('service_id,date,exception_type\n');
      mockedStream.push('"testId","20231115","1"\n');
      mockedStream.push('"otherTestId","20231115","1"\n');
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set([
        'testId',
        'yetAnotherTestId',
      ]);
      await parseCalendarDates(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-15T12:00:00+00:00'),
      );

      assert.deepEqual(
        validServiceIds,
        new Set(['testId', 'otherTestId', 'yetAnotherTestId']),
      );
    });
    it('should remove services from the input in case of exception', async () => {
      const mockedStream = new Readable();
      mockedStream.push('service_id,date,exception_type\n');
      mockedStream.push('"testId","20231115","2"\n');
      mockedStream.push('"otherTestId","20231115","1"\n');
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set([
        'testId',
        'yetAnotherTestId',
      ]);
      await parseCalendarDates(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-15T12:00:00+00:00'),
      );

      assert.deepEqual(
        validServiceIds,
        new Set(['otherTestId', 'yetAnotherTestId']),
      );
    });
    it('should ignore exceptions on a different date', async () => {
      const mockedStream = new Readable();
      mockedStream.push('service_id,date,exception_type\n');
      mockedStream.push('"testId","20231114","2"\n');
      mockedStream.push('"otherTestId","20231115","1"\n');
      mockedStream.push(null);

      const validServiceIds: ServiceIds = new Set([
        'testId',
        'yetAnotherTestId',
      ]);
      await parseCalendarDates(
        mockedStream,
        validServiceIds,
        DateTime.fromISO('2023-11-15T12:00:00+00:00'),
      );

      assert.deepEqual(
        validServiceIds,
        new Set(['testId', 'otherTestId', 'yetAnotherTestId']),
      );
    });
  });
});
