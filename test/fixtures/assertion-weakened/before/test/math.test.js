it("subtracts", () => {
  expect(sub(5, 3)).toBe(2);
});

it("handles negatives", () => {
  expect(sub(-1, 1)).toBe(-2);
});
