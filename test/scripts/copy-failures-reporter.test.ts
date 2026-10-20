import { describe, expect, it } from "vitest";
import type { TestModule } from "vitest/node";
import {
  collectFailedTestLines,
  formatFailedTestSummary,
  normalizeTestModuleId
} from "../support/copy-failures-reporter";

function reportedModule(
  moduleId: string,
  tests: Array<{ fullName: string; state: "passed" | "failed" }>
): TestModule {
  return {
    moduleId,
    children: {
      *allTests() {
        for (const test of tests) {
          yield {
            fullName: test.fullName,
            result: () => ({ state: test.state })
          };
        }
      }
    }
  } as unknown as TestModule;
}

describe("copy-friendly Vitest failure reporter", () => {
  it("normalizes Windows module paths to repository-relative forward-slash paths", () => {
    expect(
      normalizeTestModuleId(
        "C:/GitHub/seezambia/tests/example.test.ts",
        "C:\\GitHub\\seezambia"
      )
    ).toBe("tests/example.test.ts");
  });

  it("collects only failed tests with file, suite and test name on one line", () => {
    const module = reportedModule("C:/GitHub/seezambia/tests/example.test.ts", [
      { fullName: "example suite > passes", state: "passed" },
      { fullName: "example suite > fails", state: "failed" }
    ]);

    expect(collectFailedTestLines([module], "C:/GitHub/seezambia")).toEqual([
      "× tests/example.test.ts > example suite > fails"
    ]);
  });

  it("prints no extra summary for a green run", () => {
    expect(formatFailedTestSummary([])).toBe("");
  });

  it("formats failures as a compact copy list", () => {
    expect(
      formatFailedTestSummary([
        "× tests/first.test.ts > first suite > first failure",
        "× tests/second.test.ts > second suite > second failure"
      ])
    ).toBe(
      [
        "",
        "──────────────── Failed Tests: Copy List ────────────────",
        "",
        "× tests/first.test.ts > first suite > first failure",
        "× tests/second.test.ts > second suite > second failure",
        "",
        "─────────────────────────────────────────────────────────"
      ].join("\n")
    );
  });
});
