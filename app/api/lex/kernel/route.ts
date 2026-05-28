/**
 * POST /api/lex/kernel — DEPRECATED
 * Unified endpoint is now POST /api/lex/govern
 * This route proxies to /api/lex/govern for backwards compatibility.
 */
export { POST } from '@/app/api/lex/govern/route';
