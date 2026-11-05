
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("dashboard assets and built entry exist",async()=>{
  const html=await readFile(new URL("./ui/index.html",import.meta.url),"utf8");
  const js=await readFile(new URL("./ui/app.js",import.meta.url),"utf8");
  assert.ok(html.includes("TimeWarp"));
  assert.ok(html.includes("__TIMEWARP_TOKEN__"));
  assert.ok(js.includes("restore-plan"));
});
