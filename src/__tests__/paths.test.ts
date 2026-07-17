import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { resolveInside, safeExtension } from "../paths.js";

let root: string;
let sibling: string;

before(async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "fs-paths-"));
  root = path.join(base, "uploads");
  // The name matters: it shares a string prefix with "uploads".
  sibling = path.join(base, "uploads-evil");

  await fsp.mkdir(path.join(root, "2026", "08"), { recursive: true });
  await fsp.mkdir(sibling, { recursive: true });
  await fsp.writeFile(path.join(root, "2026", "08", "ok.png"), "ok");
  await fsp.writeFile(path.join(sibling, "secret.txt"), "secret");
});

after(async () => {
  await fsp.rm(path.dirname(root), { recursive: true, force: true });
});

describe("resolveInside", () => {
  it("allows a path inside the root", async () => {
    const resolved = await resolveInside(root, "2026/08/ok.png");
    assert.ok(resolved);
    assert.ok(resolved.endsWith(path.join("2026", "08", "ok.png")));
  });

  /**
   * The original guard was `resolved.startsWith(path.resolve(directory))`, so
   * /base/uploads-evil/secret.txt passed: it really does start with
   * /base/uploads. This is that exact request.
   */
  it("rejects a sibling directory sharing the root's prefix", async () => {
    assert.equal(await resolveInside(root, "../uploads-evil/secret.txt"), null);
  });

  it("rejects classic traversal", async () => {
    for (const attack of [
      "../../etc/passwd",
      "2026/../../../etc/passwd",
      "../uploads-evil/secret.txt",
    ]) {
      assert.equal(await resolveInside(root, attack), null, `allowed: ${attack}`);
    }
  });

  it("rejects absolute paths", async () => {
    assert.equal(await resolveInside(root, "/etc/passwd"), null);
  });

  it("rejects null bytes", async () => {
    assert.equal(await resolveInside(root, "ok.png\0.txt"), null);
  });

  it("rejects a symlink pointing outside the root", async () => {
    const link = path.join(root, "escape");
    await fsp.symlink(sibling, link).catch(() => {});
    assert.equal(await resolveInside(root, "escape/secret.txt"), null);
  });

  it("returns a lexically-contained path even when the file is missing", async () => {
    // Containment held, so the caller's stat should be what produces the 404.
    const resolved = await resolveInside(root, "2026/08/nope.png");
    assert.ok(resolved);
  });
});

describe("safeExtension", () => {
  it("keeps a normal extension", () => {
    assert.equal(safeExtension("photo.PNG"), "png");
  });

  it("drops anything that is not a plain short extension", () => {
    assert.equal(safeExtension("archive.tar.gz"), "gz");
    assert.equal(safeExtension("noext"), "");
    assert.equal(safeExtension("weird.this-is-far-too-long"), "");
    assert.equal(safeExtension("shell.php%00"), "");
    assert.equal(safeExtension("../../etc/passwd"), "");
  });
});
