import { add } from "../src/math.js";

it("adds two positives", () => {
  expect(add(2, 2)).toBe(4);
});

it("adds a negative and a positive", () => {
  expect(add(-1, 1)).toBe(0);
});
