import { add } from "../src/math.js";

it("adds two positives", () => {
  expect(add(2, 2)).toBe(4);
});
