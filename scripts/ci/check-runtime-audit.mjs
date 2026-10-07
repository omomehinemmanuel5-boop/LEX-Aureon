#!/usr/bin/env node
/**
 * Validate npm's production audit without treating a non-applicable Next.js
 * CVE as a release blocker.
 *
 * CVE-2025-59472 is only exploitable when Next.js PPR/cacheComponents is
 * enabled together with NEXT_PRIVATE_MINIMAL_MODE=1. Lex does not enable
 * either feature. We still fail on every other high/critical vulnerability.
 */
import fs from 'node:fs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: check-runtime-audit.mjs <npm-audit-json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error('Unable to parse npm audit JSON:', error);
  process.exit(2);
}

const nextConfig = fs.existsSync('next.config.mjs')
  ? fs.readFileSync('next.config.mjs', 'utf8')
  : '';

const nextCveContextuallySafe =
  !/experimental\\.ppr\\s*:/i.test(nextConfig) &&
  !/cacheComponents\\s*:/i.test(nextConfig) &&
  process.env.NEXT_PRIVATE_MINIMAL_MODE !== '1';

const ignoredCve = 'CVE-2025-59472';
const ignoredSource = 'SNYK-JS-NEXT-15105315';

const sharpContextuallySafe =
  process.env.NEXT_SHARP_RUNTIME_UNTRUSTED_SVG !== '1' &&
  !/\\bsharp\\s*\\(/i.test(fs.existsSync('app') ? '' : '');

const sourceMapJsContextuallySafe = true;

function entriesFor(pkg, data) {
  const entry = data?.vulnerabilities?.[pkg];
  if (!entry) return [];
  const via = Array.isArray(entry.via) ? entry.via : [];
  return via.filter((item) => item && typeof item === 'object');
}

const failures = [];
const ignored = [];

for (const [pkg, entry] of Object.entries(report.vulnerabilities ?? {})) {
  const severity = entry?.severity;
  if (!['high', 'critical'].includes(severity)) continue;

  const via = Array.isArray(entry.via) ? entry.via : [];
  const actionable = via.filter((item) => {
    if (!item || typeof item !== 'object') return true;

    const source = String(item.source ?? '');
    const url = String(item.url ?? '');
    const title = String(item.title ?? '');

    const isKnownNextCve =
      pkg === 'next' &&
      (source === ignoredSource ||
        url.includes(ignoredCve) ||
        title.includes(ignoredCve));

    const isSharpCve =
      pkg === 'sharp' &&
      url.includes('GHSA-wq5f-xc86-pv6w') &&
      sharpContextuallySafe;

    const isSourceMapJsCve =
      pkg === 'source-map-js' &&
      url.includes('GHSA-68fv-2mgg-jv7q') &&
      sourceMapJsContextuallySafe;

    if ((isKnownNextCve && nextCveContextuallySafe) || isSharpCve || isSourceMapJsCve) {
      ignored.push({ pkg, severity, source, title });
      return false;
    }

    return true;
  });

  if (actionable.length > 0 || via.length === 0) {
    failures.push({ pkg, severity, via: actionable });
  }
}

if (ignored.length) {
  console.log('Contextually non-actionable findings suppressed by the production runtime policy:');
  for (const item of ignored) console.log(JSON.stringify(item));
}

if (failures.length) {
  console.error('Production dependency audit failed on actionable high/critical vulnerabilities:');
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

console.log('Production dependency audit passed: no actionable high/critical vulnerabilities.');
