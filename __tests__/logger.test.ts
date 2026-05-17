import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, errorFields } from '../lib/logger';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('emits JSON with scope, level, msg', () => {
    logger.info('test.scope', 'hello', { k: 1 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.level).toBe('info');
    expect(parsed.scope).toBe('test.scope');
    expect(parsed.msg).toBe('hello');
    expect(parsed.k).toBe(1);
  });

  it('routes warn/error to stderr', () => {
    logger.warn('s', 'warn');
    logger.error('s', 'boom');
    expect(errSpy).toHaveBeenCalledTimes(2);
  });
});

describe('errorFields', () => {
  it('extracts message and trimmed stack from Error', () => {
    const e = new Error('boom');
    const f = errorFields(e);
    expect(f.error).toBe('boom');
    expect(typeof f.stack).toBe('string');
  });

  it('stringifies non-Error', () => {
    expect(errorFields('xyz').error).toBe('xyz');
  });
});
