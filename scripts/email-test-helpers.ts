import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

export async function localVerificationToken(id: string) {
  const names = (await readdir(".mail")).filter((file) => file.startsWith(`${id}-`)).sort();
  assert.ok(names.length, "Local email missing: smoke checks require development file transport");
  const email = JSON.parse(await readFile(`.mail/${names.at(-1)}`, "utf8"));
  return new URL(email.text.match(/https?:\/\/\S+/)[0]).hash.slice("#token=".length);
}
