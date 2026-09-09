import https from 'https';

// Check /api/health which is a GET endpoint — not /api/lex/run (POST only).
// Override HEALTHCHECK_URL for staging or a local deployment.
const API_URL = process.env.HEALTHCHECK_URL || 'https://www.lexaureon.com/api/health';

function checkHealth(): void {
  const url = new URL(API_URL);
  const req = https.request(
    { hostname: url.hostname, path: url.pathname, method: 'GET',
      headers: { 'Content-Type': 'application/json' } },
    (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const healthy = res.statusCode === 200
            && data.ok === true
            && data.api === 'healthy'
            && data.kernel_active === true
            && data.storage?.stats_readable === true
            && data.services?.turso === 'connected';
          if (healthy) {
            console.log('SYSTEM HEALTHY');
            console.log(`  version:    ${data.version}`);
            console.log(`  kernel:     ${data.kernel_active ? 'active' : 'inactive'}`);
            console.log(`  runs:       ${data.counters?.total_runs ?? '?'}`);
            console.log(`  turso:      ${data.services?.turso}`);
          } else {
            console.error('SYSTEM DEGRADED', data.status, `http_${res.statusCode}`);
            process.exit(1);
          }
        } catch {
          console.error('SYSTEM DOWN — invalid JSON');
          console.error(body.slice(0, 200));
          process.exit(1);
        }
      });
    }
  );
  req.on('error', (e: Error) => { console.error('NETWORK ERROR:', e.message); process.exit(1); });
  req.end();
}

checkHealth();
