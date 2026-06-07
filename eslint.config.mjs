import { FlatCompat } from '@eslint/eslintrc';
  import { fileURLToPath } from 'url';
  import path from 'path';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const compat = new FlatCompat({ baseDirectory: __dirname });

  const config = [
    {
      ignores: [
        'node_modules/**',
        '.next/**',
        'out/**',
        'build/**',
        'next-env.d.ts',
        '**/*.d.ts',
      ],
    },
    ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ];

  export default config;
  