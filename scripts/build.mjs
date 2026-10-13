import { cp, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/", import.meta.url));
const output = fileURLToPath(new URL("../dist/", import.meta.url));

// Xoá dist/ trước để file đã bị xoá trong src/ không còn sót lại.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });

console.log("Built src/ → dist/");
