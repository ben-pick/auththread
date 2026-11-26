import { measureAll } from "./index.ts";

const results = await measureAll();
let failed = false;

for (const result of results) {
  const budget =
    result.budgetBytes === undefined
      ? "no budget"
      : `${result.gzippedBytes} / ${result.budgetBytes} B gzipped`;
  const status = result.ok ? "ok" : "OVER";
  console.log(
    `${result.name}: raw ${result.shippedBytes} B, minified ${result.minifiedBytes} B, gzipped ${result.gzippedBytes} B (${budget}) ${status}`,
  );
  if (!result.ok) failed = true;
}

if (failed) {
  console.error("bundle budget exceeded");
  process.exit(1);
}
