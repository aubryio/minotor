import path from "node:path";
import url from "node:url";
import { globbyStream } from "globby";
import { build as esbuild } from "esbuild";

const srcPath = path.join(process.cwd(), "src");
const buildPath = path.join(process.cwd(), "build");

async function buildFile(filePath: string) {
  return esbuild({
    platform: "node",
    target: "node21",
    format: "esm",
    nodePaths: [srcPath],
    sourcemap: true,
    external: [],
    entryPoints: [path.join(srcPath, filePath)],
    outdir: path.join(buildPath, path.dirname(filePath)),
  });
}

async function build({ includeTests = false }: { includeTests?: boolean }) {
  const filesStream = globbyStream("**/*.ts", {
    cwd: srcPath,
    onlyFiles: true,
    ignore: includeTests ? [] : ["__tests__"],
  });

  for await (const filePath of filesStream) {
    if (typeof filePath !== "string") {
      throw new TypeError("Unexpected file type");
    }

    await buildFile(filePath);
  }
}

if (import.meta.url.startsWith("file:")) {
  if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
    await build({
      includeTests: process.argv.includes("--tests"),
    });
  }
}
