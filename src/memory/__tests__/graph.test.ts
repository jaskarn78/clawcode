import { describe, it, expect } from "vitest";
import { extractWikilinks, traverseGraph } from "../graph.js";

describe("extractWikilinks", () => {
  it("extracts a single wikilink", () => {
    expect(extractWikilinks("Hello [[abc123]] world")).toEqual(["abc123"]);
  });

  it("extracts multiple wikilinks", () => {
    expect(extractWikilinks("[[a]] and [[b]] linked")).toEqual(["a", "b"]);
  });

  it("deduplicates repeated wikilinks", () => {
    expect(extractWikilinks("[[a]] duplicate [[a]]")).toEqual(["a"]);
  });

  it("returns empty array for no links", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });

  it("ignores empty brackets", () => {
    expect(extractWikilinks("empty [[]] brackets")).toEqual([]);
  });

  it("trims whitespace inside brackets", () => {
    expect(extractWikilinks("  [[ spaced ]]  ")).toEqual(["spaced"]);
  });

  it("handles regex lastIndex correctly across calls", () => {
    const first = extractWikilinks("[[x]] and [[y]]");
    const second = extractWikilinks("[[z]]");
    expect(first).toEqual(["x", "y"]);
    expect(second).toEqual(["z"]);
  });
});

describe("traverseGraph", () => {
  it("traverses a linear chain", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: [],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 2);
    expect(result).toEqual(new Set(["B", "C"]));
  });

  it("terminates on circular references", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: ["A"],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 10);
    expect(result).toEqual(new Set(["B", "C"]));
  });

  it("respects depth limit", () => {
    const neighbors: Record<string, readonly string[]> = {
      A: ["B"],
      B: ["C"],
      C: [],
    };
    const result = traverseGraph("A", (id) => neighbors[id] ?? [], 1);
    expect(result).toEqual(new Set(["B"]));
  });

  it("returns empty set when no neighbors", () => {
    const result = traverseGraph("A", () => [], 5);
    expect(result).toEqual(new Set());
  });
});
