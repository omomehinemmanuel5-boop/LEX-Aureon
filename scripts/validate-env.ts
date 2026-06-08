/**
 * Environment Validation Script
 * Checks for required environment variables and API connectivity
 * Run with: npx ts-node scripts/validate-env.ts
 */

import { createClient } from '@libsql/client';

interface ValidationResult {
  name: string;
  status: 'OK' | 'MISSING' | 'INVALID' | 'ERROR';
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

const results: ValidationResult[] = [];

function checkEnv(key: string, severity: 'critical' | 'warning' = 'critical'): ValidationResult {
  const value = process.env[key];
  if (!value) {
    return {
      name: key,
      status: 'MISSING',
      message: `Environment variable ${key} is not set`,
      severity,
    };
  }
  return {
    name: key,
    status: 'OK',
    message: `${key} is configured`,
    severity: 'info',
  };
}

async function validateTurso(): Promise<ValidationResult> {
  try {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;

    if (!url || !token) {
      return {
        name: 'Turso Database',
        status: 'MISSING',
        message: 'TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set',
        severity: 'critical',
      };
    }

    const client = createClient({ url, authToken: token });
    const result = await client.execute('SELECT 1 as test');

    if (result.rows.length > 0) {
      return {
        name: 'Turso Database',
        status: 'OK',
        message: 'Successfully connected to Turso database',
        severity: 'info',
      };
    }

    return {
      name: 'Turso Database',
      status: 'ERROR',
      message: 'Connected to Turso but query failed',
      severity: 'critical',
    };
  } catch (e) {
    return {
      name: 'Turso Database',
      status: 'ERROR',
      message: `Turso connection failed: ${String(e).substring(0, 100)}`,
      severity: 'critical',
    };
  }
}

async function validateGroq(): Promise<ValidationResult> {
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      return {
        name: 'Groq API',
        status: 'MISSING',
        message: 'GROQ_API_KEY not set',
        severity: 'critical',
      };
    }

    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        name: 'Groq API',
        status: 'OK',
        message: 'Successfully authenticated with Groq',
        severity: 'info',
      };
    }

    return {
      name: 'Groq API',
      status: 'INVALID',
      message: `Groq API returned ${response.status}`,
      severity: 'critical',
    };
  } catch (e) {
    return {
      name: 'Groq API',
      status: 'ERROR',
      message: `Groq connection failed: ${String(e).substring(0, 100)}`,
      severity: 'warning',
    };
  }
}

async function validateJina(): Promise<ValidationResult> {
  try {
    const key = process.env.JINA_API_KEY;
    if (!key) {
      return {
        name: 'Jina Embeddings',
        status: 'MISSING',
        message: 'JINA_API_KEY not set',
        severity: 'critical',
      };
    }

    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'text-matching',
        input: ['test'],
        dimensions: 256,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return {
        name: 'Jina Embeddings',
        status: 'OK',
        message: 'Successfully authenticated with Jina',
        severity: 'info',
      };
    }

    return {
      name: 'Jina Embeddings',
      status: 'INVALID',
      message: `Jina API returned ${response.status}`,
      severity: 'critical',
    };
  } catch (e) {
    return {
      name: 'Jina Embeddings',
      status: 'ERROR',
      message: `Jina connection failed: ${String(e).substring(0, 100)}`,
      severity: 'warning',
    };
  }
}

async function main() {
  console.log('🔍 Lex Aureon Environment Validation\n');

  // Check required environment variables
  results.push(checkEnv('GROQ_API_KEY', 'critical'));
  results.push(checkEnv('JINA_API_KEY', 'critical'));
  results.push(checkEnv('TURSO_DATABASE_URL', 'critical'));
  results.push(checkEnv('TURSO_AUTH_TOKEN', 'critical'));
  results.push(checkEnv('ADMIN_PASSWORD', 'critical'));
  results.push(checkEnv('CRON_SECRET', 'critical'));
  results.push(checkEnv('NEXT_PUBLIC_SITE_URL', 'critical'));

  // Check optional environment variables
  results.push(checkEnv('GEMINI_API_KEY', 'warning'));
  results.push(checkEnv('LOG_DRAIN_URL', 'warning'));

  // Validate API connectivity
  console.log('🌐 Validating API connectivity...\n');
  results.push(await validateTurso());
  results.push(await validateGroq());
  results.push(await validateJina());

  // Print results
  console.log('\n📋 Validation Results:\n');
  const criticalFailed = results.filter(
    r => r.severity === 'critical' && r.status !== 'OK',
  );
  const warningsFailed = results.filter(
    r => r.severity === 'warning' && r.status !== 'OK',
  );

  results.forEach(r => {
    const icon =
      r.status === 'OK'
        ? '✅'
        : r.status === 'MISSING'
          ? '❌'
          : r.status === 'INVALID'
            ? '⚠️ '
            : '❓';
    console.log(`${icon} ${r.name}: ${r.message}`);
  });

  console.log('\n' + '='.repeat(60));

  if (criticalFailed.length > 0) {
    console.log(`\n❌ CRITICAL: ${criticalFailed.length} critical issue(s) found`);
    console.log('The application will not start without these.');
    process.exit(1);
  }

  if (warningsFailed.length > 0) {
    console.log(`\n⚠️  WARNING: ${warningsFailed.length} warning(s) found`);
    console.log('The application will start but with reduced functionality.');
  }

  console.log('\n✅ Environment validation passed!\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Validation error:', e);
  process.exit(1);
});
