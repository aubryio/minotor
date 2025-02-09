import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'src/router.ts',
    output: [
      {
        file: 'dist/router.umd.js',
        format: 'umd',
        name: 'minotor',
        sourcemap: true,
      },
      {
        file: 'dist/router.esm.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/router.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
    ],
    plugins: [resolve(), commonjs(), typescript(), terser()],
  },
  {
    input: 'src/parser.ts',
    output: [
      {
        file: 'dist/parser.esm.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/parser.cjs.js',
        format: 'cjs',
        sourcemap: true,
      },
    ],
    plugins: [resolve(), commonjs(), typescript()],
  },
  {
    input: 'src/cli/minotor.ts',
    output: {
      file: 'dist/cli.mjs',
      format: 'es',
      banner: '#!/usr/bin/env node',
      sourcemap: true,
    },
    plugins: [resolve(), commonjs(), typescript()],
  },
];
