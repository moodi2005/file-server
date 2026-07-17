import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRange } from "../handlers/download.js";

const SIZE = 1000;

describe("parseRange", () => {
  it("returns null when no range is asked for", () => {
    assert.equal(parseRange(undefined, SIZE), null);
  });

  it("parses a closed range", () => {
    assert.deepEqual(parseRange("bytes=0-499", SIZE), { start: 0, end: 499 });
  });

  it("parses an open-ended range", () => {
    assert.deepEqual(parseRange("bytes=500-", SIZE), { start: 500, end: 999 });
  });

  /**
   * The bug this exists for: the old code did parseInt("") on the start half,
   * got NaN, and emitted Content-Length: NaN. Video players send this form on
   * every seek.
   */
  it("parses a suffix range", () => {
    assert.deepEqual(parseRange("bytes=-500", SIZE), { start: 500, end: 999 });
  });

  it("clamps a suffix longer than the file", () => {
    assert.deepEqual(parseRange("bytes=-5000", SIZE), { start: 0, end: 999 });
  });

  it("clamps an end past the last byte", () => {
    assert.deepEqual(parseRange("bytes=900-99999", SIZE), { start: 900, end: 999 });
  });

  it("rejects a start past the end of the file", () => {
    assert.equal(parseRange("bytes=1000-", SIZE), "invalid");
    assert.equal(parseRange("bytes=5000-6000", SIZE), "invalid");
  });

  it("rejects an inverted range", () => {
    assert.equal(parseRange("bytes=500-100", SIZE), "invalid");
  });

  it("rejects malformed headers", () => {
    for (const header of [
      "bytes=",
      "bytes=-",
      "bytes=abc-def",
      "items=0-10",
      "bytes=0-10, 20-30", // multi-range is not supported
      "0-10",
    ]) {
      assert.equal(parseRange(header, SIZE), "invalid", `expected invalid: ${header}`);
    }
  });

  it("never returns NaN bounds", () => {
    for (const header of ["bytes=-500", "bytes=500-", "bytes=0-499"]) {
      const r = parseRange(header, SIZE);
      assert.ok(r && r !== "invalid");
      assert.ok(Number.isInteger(r.start) && Number.isInteger(r.end));
    }
  });
});
