import type { TestDef } from "./types.js";
import { splitLines } from "./paths.js";

/** Extract named test definitions from a source file. */
export function extractTests(content: string, path: string): TestDef[] {
  const lines = splitLines(content);
  const tests: TestDef[] = [];
  const ext = (path.split(".").pop() ?? "").toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const n = i + 1;

    // JS / TS — it('name'), test("name"), it.skip(`name`), xtest('name'), etc.
    const js = line.match(
      /^\s*(?:(?:it|test|specify|xit|xtest|fit|describe|xdescribe|context|fdescribe)\s*(?:\.(?:skip|only|todo|failing|concurrent|each(?:\.[A-Za-z]+)?)?)*\s*(?:<[^>]*>)?\s*)\(\s*(['"`])([\s\S]*?)\1/,
    );
    if (js && !/^\s*(?:if|for|while|switch)\s*\(/.test(line)) {
      tests.push({ name: js[2] ?? "", line: n, raw: line.trim() });
      continue;
    }

    // Python test functions and TestCase classes
    const py = line.match(/^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/);
    if (py) {
      tests.push({ name: py[1] ?? "", line: n, raw: line.trim() });
      continue;
    }
    const pyClass = line.match(/^\s*class\s+(Test\w+)\s*[(:]/);
    if (pyClass && (ext === "py" || path.endsWith(".py"))) {
      tests.push({ name: pyClass[1] ?? "", line: n, raw: line.trim() });
      continue;
    }

    // Go
    const go = line.match(/^\s*func\s+(Test\w+)\s*\(/);
    if (go) {
      tests.push({ name: go[1] ?? "", line: n, raw: line.trim() });
      continue;
    }

    // Rust: #[test] / #[tokio::test] / #[ignore] then fn name on this or next lines
    if (/#\[(?:\w+::)*test(?:\s*\(.*\))?\]/.test(line) || (line.includes("#[test]") || /#\[tokio::test\]/.test(line))) {
      for (let j = i; j < Math.min(lines.length, i + 4); j++) {
        const fn = (lines[j] ?? "").match(/^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/);
        if (fn) {
          tests.push({ name: fn[1] ?? "", line: j + 1, raw: (lines[j] ?? "").trim() });
          break;
        }
      }
      continue;
    }
  }
  return tests;
}

export const ASSERT_RE =
  /\bexpect\s*\(|\bassert(?:_eq|_ne|_lt|_gt|_le|_ge|_ok|_in|_not|_true|_false|_is|_equals?|_that|_almost|_raises|_throws)?!?\s*\(|\bassert(?:Equal|Equals|True|False|That|Is|In|Not|Almost|Raises|IsNone|IsNotNone|Greater|Less)\b|\bself\.assert\w*\s*\(|(?:\.\s*(?:toBe|toEqual|toStrictEqual|toMatchObject|toMatch|toContain|toThrow|toHaveBeenCalled|toHaveBeenCalledWith|toHaveLength|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined|toBeDefined|toBeGreaterThan|toBeLessThan|toHaveProperty|toBeInstanceOf)\s*\()|\bshould\s*\./;

/** A tautology or no-op that replaced a real assertion. */
export const TRIVIAL_ASSERT_RE =
  /^\s*(?:assert\s+(?:True|true|1)\s*(?:#.*)?$|assert\s*\(\s*(?:True|true|1)\s*\)\s*;?\s*(?:\/\/.*)?$|expect\s*\(\s*true\s*\)\s*(?:\.\s*(?:toBe(?:Truthy)?|toEqual|toBeTruthy)\s*\(\s*(?:true)?\s*\))?;?|assert\s*\.\s*ok\s*\(\s*true\s*\)|pass\s*(?:#.*)?$)/;

export function countAssertions(text: string): number {
  if (!text) return 0;
  return text.match(new RegExp(ASSERT_RE.source, "g"))?.length ?? 0;
}

export function isAssertLine(line: string): boolean {
  return ASSERT_RE.test(line) && !/^\s*(\/\/|#|\/\*)/.test(line);
}

export function isTrivialAssert(line: string): boolean {
  return TRIVIAL_ASSERT_RE.test(line.trim());
}

const EMPTY_CATCH_RE =
  /catch\s*(?:\([^)]*\))?\s*\{\s*\}|except(?:\s+\w+(?:\s+as\s+\w+)?)?\s*:\s*(?:pass\s*)?(?:#.*)?$/;

export function isEmptyCatch(line: string): boolean {
  return EMPTY_CATCH_RE.test(line);
}

export function evidenceFor(lines: string[], limit = 6): string {
  const trimmed = lines.map((l) => l.replace(/\t/g, "  "));
  if (trimmed.length <= limit) return trimmed.join("\n");
  return [...trimmed.slice(0, limit), `  ... (${trimmed.length - limit} more)`].join("\n");
}
