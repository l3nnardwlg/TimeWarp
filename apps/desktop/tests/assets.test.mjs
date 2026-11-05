
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
test("desktop build artifacts are generated",async()=>{
  const file=await readFile(new URL("../dist/index.html",import.meta.url),"utf8");
  assert.ok(file.includes("TimeWarp Desktop"));
});
