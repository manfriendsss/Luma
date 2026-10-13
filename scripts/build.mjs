import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/", import.meta.url));
const output = fileURLToPath(new URL("../dist/", import.meta.url));

await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });

console.log("Built src/ → dist/");
