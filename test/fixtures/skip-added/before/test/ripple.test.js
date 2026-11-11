it("handles empty input", () => {
  expect(parse("")).toBe(null);
});

it("rejects a bad checksum", () => {
  expect(() => parse("abc")).toThrow();
});
