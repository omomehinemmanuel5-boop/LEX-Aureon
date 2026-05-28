/**
 * POST /api/lex/kernel/stream — DEPRECATED
 * Unified SSE stream is now POST /api/lex/govern/stream
 * This route proxies for backwards compatibility.
 */
export { POST } from '@/app/api/lex/govern/stream/route';
