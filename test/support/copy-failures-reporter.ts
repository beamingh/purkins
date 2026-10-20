import type { Reporter, TestModule } from "vitest/node";

const SUMMARY_HEADING = "──────────────── Failed Tests: Copy List ────────────────";
const SUMMARY_FOOTER = "─────────────────────────────────────────────────────────";

export function normalizeTestModuleId(moduleId: string, cwd = process.cwd()): string {
  const normalizedModuleId = moduleId.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  const moduleIdLower = normalizedModuleId.toLowerCase();
  const cwdPrefix = `${normalizedCwd}/`;

  if (moduleIdLower.startsWith(cwdPrefix.toLowerCase())) {
    return normalizedModuleId.slice(cwdPrefix.length);
  }

  return normalizedModuleId;
}

export function collectFailedTestLines(
  testModules: ReadonlyArray<TestModule>,
  cwd = process.cwd()
): string[] {
  const failures: string[] = [];

  for (const testModule of testModules) {
    const moduleId = normalizeTestModuleId(testModule.moduleId, cwd);

    for (const testCase of testModule.children.allTests()) {
      if (testCase.result().state !== "failed") continue;
      failures.push(`× ${moduleId} > ${testCase.fullName}`);
    }
  }

  return failures;
}

export function formatFailedTestSummary(failures: readonly string[]): string {
  if (failures.length === 0) return "";

  return ["", SUMMARY_HEADING, "", ...failures, "", SUMMARY_FOOTER].join("\n");
}

export default class CopyFailuresReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const summary = formatFailedTestSummary(collectFailedTestLines(testModules));
    if (summary) console.log(summary);
  }
}
