import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // CommonJS Node dev harness (XMPP stanza flow tests) — not app code.
    'strophe-test/**',
    // Generated single-file bubble (inlined minified Strophe UMD + source).
    'public/openplaud.js',
  ]),
]);

export default eslintConfig;
