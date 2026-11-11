it("handles empty input", () => {
  expect(parse("")).toBe(null);
});

it.skip("rejects a bad checksum", () => {
  expect(() => parse("abc")).toThrow();
});
