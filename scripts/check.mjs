// Kiểm tra cú pháp toàn bộ file JavaScript trong src/ (không cần dependency).
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(m?js)$/.test(entry.name)) yield path;
  }
}
let failed = 0, count = 0;
for (const dir of ["src", "scripts", "test"]) {
  for await (const file of walk(join(root, dir))) {
    count += 1;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) { failed += 1; console.error(result.stderr); }
  }
}
for (const file of ["server.mjs"]) {
  count += 1;
  const result = spawnSync(process.execPath, ["--check", join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) { failed += 1; console.error(result.stderr); }
}
if (failed) { console.error(`${failed}/${count} file lỗi cú pháp.`); process.exit(1); }
console.log(`✓ ${count} file JavaScript hợp lệ.`);
