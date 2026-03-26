import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import path from "path";

/**
 * Runs ESLint as a test to catch:
 * - Missing React hook dependencies
 * - Unused imports
 * - Unused variables
 * - TypeScript errors caught by next/typescript
 */
describe("ESLint", () => {
  const root = path.resolve(__dirname, "..");

  it("passes with no errors on components/", () => {
    try {
      execSync("npx next lint --dir components --max-warnings 0", {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err) {
      const output = (err as { stdout?: string; stderr?: string }).stdout || (err as { stderr?: string }).stderr || "";
      expect.fail(`ESLint errors in components/:\n${output}`);
    }
  });

  it("passes with no errors on app/", () => {
    try {
      execSync("npx next lint --dir app --max-warnings 0", {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err) {
      const output = (err as { stdout?: string; stderr?: string }).stdout || (err as { stderr?: string }).stderr || "";
      expect.fail(`ESLint errors in app/:\n${output}`);
    }
  });

  it("passes with no errors on lib/", () => {
    try {
      execSync("npx next lint --dir lib --max-warnings 0", {
        cwd: root,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err) {
      const output = (err as { stdout?: string; stderr?: string }).stdout || (err as { stderr?: string }).stderr || "";
      expect.fail(`ESLint errors in lib/:\n${output}`);
    }
  });
});
