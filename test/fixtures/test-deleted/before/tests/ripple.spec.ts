it("handles empty input", () => {
  expect(parse("")).toBe(null);
});

it("rejects a bad checksum", () => {
  expect(() => parse("abc")).toThrow();
});

it("parses a single hop", () => {
  expect(parse("a->b").length).toBe(1);
});

it("parses a cycle", () => {
  expect(parse("a->b->a").cyclic).toBe(true);
});

it("trims whitespace", () => {
  expect(parse("  a  ")).toEqual({ id: "a" });
});

it("rejects an unknown verb", () => {
  expect(() => parse("a flies b")).toThrow();
});

it("keeps insertion order", () => {
  expect(names(parse("b,a"))).toEqual(["b", "a"]);
});
