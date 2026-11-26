import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundleFile } from "@auththread/tooling-budget";

const here = import.meta.dirname;
const result = await bundleFile(resolve(here, "web/app.ts"));
writeFileSync(resolve(here, "web/app.js"), result.code);

console.error(
  `browser bundle: ${result.minifiedBytes} bytes, ${result.gzippedBytes} bytes gzipped`,
);
