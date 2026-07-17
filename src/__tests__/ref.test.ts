import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * The ref is the one string the caller stores, and both sides have to agree on
 * how to read it. These lock the contract:
 *
 *   ref  = "<fileId>/<url-encoded original name>"
 *   id   = everything before the first slash
 *   name = decoded remainder
 *
 * The old server encoded the name into the filename with a "___" separator and
 * the client looked for "_<stamp>_", so the two drifted apart and the display
 * name silently broke. There is nothing to drift here as long as these hold.
 */

const makeRef = (id: string, name: string) => `${id}/${encodeURIComponent(name)}`;

// What the server does with an incoming /f/<...> path.
const idFromRef = (ref: string) => ref.split("/")[0];

// What the client does to show a name.
const nameFromRef = (ref: string) =>
  decodeURIComponent(ref.slice(ref.indexOf("/") + 1));

describe("ref round-trip", () => {
  const cases: [string, string][] = [
    ["n1-202608-a3f2b8c19d4e", "image.png"],
    ["n1-202608-7fa39d4e2b1c", "گزارش ماهانه.pdf"],
    ["n1-202608-0000deadbeef", "a b c.png"],
    ["n1-202608-1111deadbeef", "100% done.png"],
    ["n1-202608-2222deadbeef", "with#hash.png"],
    ["n1-202608-3333deadbeef", "with?query.png"],
    ["n1-202608-4444deadbeef", "sub/dir/name.png"],
    ["n1-202608-5555deadbeef", "under___scores.png"],
    ["n1-202608-6666deadbeef", "../../etc/passwd"],
  ];

  for (const [id, name] of cases) {
    it(`survives ${JSON.stringify(name)}`, () => {
      const ref = makeRef(id, name);
      assert.equal(idFromRef(ref), id, "id must be recoverable");
      assert.equal(nameFromRef(ref), name, "name must round-trip exactly");
    });
  }

  it("keeps the id intact when the name contains slashes", () => {
    // Encoding is what stops a name from adding path segments.
    const ref = makeRef("n1-202608-a3f2b8c19d4e", "a/b/c.png");
    assert.equal(ref.split("/").length, 2);
    assert.equal(idFromRef(ref), "n1-202608-a3f2b8c19d4e");
  });

  it("cannot smuggle traversal into the id", () => {
    const ref = makeRef("n1-202608-a3f2b8c19d4e", "../../etc/passwd");
    assert.equal(idFromRef(ref), "n1-202608-a3f2b8c19d4e");
    // The id is a database key, never a path — but the encoding means the name
    // half cannot introduce segments even before that lookup happens.
    assert.ok(!ref.slice(ref.indexOf("/") + 1).includes("/"));
  });

  it("two files with the same name stay distinguishable", () => {
    const a = makeRef("n1-202608-aaaaaaaaaaaa", "image.png");
    const b = makeRef("n1-202608-bbbbbbbbbbbb", "image.png");
    assert.notEqual(a, b);
    assert.equal(nameFromRef(a), nameFromRef(b));
    assert.notEqual(idFromRef(a), idFromRef(b));
  });
});
