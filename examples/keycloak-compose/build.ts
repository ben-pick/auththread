import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const BUDGET = 5 * 1024;

const result = await build({
  entryPoints: ["web/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "web/app.js",
  write: false,
});

const file = result.outputFiles?.[0];
if (file === undefined) throw new Error("esbuild produced no output");
writeFileSync("web/app.js", file.contents);

const gzipped = gzipSync(file.contents).length;
console.error(
  `browser bundle: ${file.contents.length} bytes, ${gzipped} bytes gzipped`,
);
if (gzipped > BUDGET) {
  console.error(`over the ${BUDGET} byte budget`);
  process.exit(1);
}
