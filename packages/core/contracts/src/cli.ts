import { generate } from "./generate.ts";

const check = process.argv.includes("--check");
const result = generate(check);

if (check) {
  if (result.stale.length > 0) {
    console.error(
      `Stale generated contract: ${result.stale.join(", ")}. Run \`mise exec -- pnpm schema:generate\`.`,
    );
    process.exit(1);
  }
  console.log("generated contract is up to date");
} else {
  console.log("wrote the generated wide-event JSON Schema");
}
