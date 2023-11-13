import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'src/umdIndex.ts',
    output: {
      file: 'dist/bundle.umd.js',
      format: 'umd',
      name: 'minotor',
      sourcemap: true,
    },
    plugins: [resolve(), commonjs(), typescript(), terser()],
  },
  // CommonJS and ES module builds for Node.js and bundlers
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/bundle.esm.js',
        format: 'es',
        sourcemap: true,
      },
      {
        file: 'dist/bundle.cjs.js',
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
