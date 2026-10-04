import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyNotes } from "../src/lib/ai/notes.ts";

const raw = (over: Record<string, unknown> = {}) =>
  tidyNotes({
    overview: "",
    sections: [],
    tables: [],
    formulas: [],
    takeaways: [],
    ...over,
  } as never);

test("a slightly broken grid still prints, which is the point of the padding", () => {
  const n = raw({
    tables: [{ caption: "T", columns: ["A", "B", "C"], rows: [["1", "2"]] }],
  });
  assert.equal(n.tables.length, 1);
  assert.equal(n.tables[0].rows[0].length, 3);
});

test("a grid comes through with its columns and rows", () => {
  const n = raw({
    tables: [
      {
        caption: "Distributions",
        columns: ["Name", "Mean", "Variance"],
        rows: [
          ["Normal", "μ", "σ²"],
          ["Poisson", "λ", "λ"],
        ],
      },
    ],
  });
  assert.equal(n.tables.length, 1);
  assert.equal(n.tables[0].caption, "Distributions");
  assert.deepEqual(n.tables[0].columns, ["Name", "Mean", "Variance"]);
  assert.equal(n.tables[0].rows.length, 2);
});

test("a row with too few cells is padded, so it stays under its own heading", () => {
  // Drawn as it comes, the third value lands under the wrong column and the row
  // reads as belonging to a different question.
  const n = raw({
    tables: [{ caption: "", columns: ["A", "B", "C"], rows: [["1", "2"]] }],
  });
  assert.deepEqual(n.tables[0].rows, [["1", "2", ""]]);
});

test("a row with too many cells loses the extras rather than the width", () => {
  const n = raw({
    tables: [{ caption: "", columns: ["A", "B"], rows: [["1", "2", "3", "4"]] }],
  });
  assert.deepEqual(n.tables[0].rows, [["1", "2"]]);
});

test("a grid with one column is not a grid", () => {
  const n = raw({
    tables: [{ caption: "List", columns: ["Only"], rows: [["a"], ["b"]] }],
  });
  assert.deepEqual(n.tables, []);
});

test("a grid with headings but no rows is not a grid", () => {
  const n = raw({ tables: [{ caption: "Empty", columns: ["A", "B"], rows: [] }] });
  assert.deepEqual(n.tables, []);
});

test("a row that is empty all the way across is not printed as a blank band", () => {
  const n = raw({
    tables: [{ caption: "", columns: ["A", "B"], rows: [["1", "2"], ["", ""]] }],
  });
  assert.equal(n.tables[0].rows.length, 1);
});

test("a repeated row is kept once", () => {
  const n = raw({
    tables: [
      {
        caption: "",
        columns: ["A", "B"],
        rows: [
          ["1", "2"],
          ["1", "2"],
          ["1", "3"],
        ],
      },
    ],
  });
  assert.equal(n.tables[0].rows.length, 2);
});

test("the same grid twice is kept once", () => {
  const one = { caption: "X", columns: ["A", "B"], rows: [["1", "2"]] };
  const n = raw({ tables: [one, { ...one }] });
  assert.equal(n.tables.length, 1);
});

test("a caption is optional", () => {
  const n = raw({ tables: [{ caption: "", columns: ["A", "B"], rows: [["1", "2"]] }] });
  assert.equal(n.tables[0].caption, "");
});

test("a ragged row is still counted as a table", () => {
  // The point of the padding is that a slightly broken grid still prints.
  const n = raw({
    tables: [{ caption: "T", columns: ["A", "B", "C"], rows: [["1", "2"]] }],
  });
  assert.equal(n.tables.length, 1);
  assert.equal(n.tables[0].rows[0].length, 3);
});