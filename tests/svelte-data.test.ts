import { describe, expect, it } from "vitest";
import { parseSvelteDataResponse, unflattenSvelteData } from "../src/lib/svelte-data.js";

describe("SvelteKit public data decoder", () => {
  it("unflattens objects, arrays and undefined without evaluating code", () => {
    const decoded = unflattenSvelteData([
      { title: 1, list: 2, optional: -1 },
      "Kaede to Suzu",
      [3, 4],
      1,
      2,
    ]);
    expect(decoded).toEqual({
      title: "Kaede to Suzu",
      list: [1, 2],
      optional: undefined,
    });
  });

  it("extracts the final route node", () => {
    const body = JSON.stringify({
      type: "data",
      nodes: [null, { type: "data", data: [{ user: 1 }, null] }, {
        type: "data",
        data: [{ results: 1 }, [2], { id: 3, title: 4, slug: 5 }, "894", "Kaede", "kaede"],
      }],
    });
    expect(parseSvelteDataResponse(body)).toEqual({
      results: [{ id: "894", title: "Kaede", slug: "kaede" }],
    });
  });

  it("rejects malformed payloads", () => {
    expect(() => parseSvelteDataResponse("not json")).toThrow(/invalid JSON/);
    expect(() => parseSvelteDataResponse('{"type":"data"}')).toThrow(/nodes/);
  });
});
