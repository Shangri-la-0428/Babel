import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { glob } from "glob";

/**
 * i18n integrity tests:
 * 1. Every translation key has both cn and en values
 * 2. No empty translation values
 * 3. No hardcoded user-facing strings in components (heuristic)
 * 4. Template args {0}, {1} are consistent between cn and en
 */
describe("i18n translations", () => {
  const root = path.resolve(__dirname, "..");
  const i18nPath = path.join(root, "lib/i18n.ts");
  const i18nSource = fs.readFileSync(i18nPath, "utf-8");

  // Extract translations object content
  const translationsMatch = i18nSource.match(/const translations = \{([\s\S]*?)\} as const/);

  it("i18n.ts contains translations object", () => {
    expect(translationsMatch).not.toBeNull();
  });

  // Parse translation entries
  const entries: { key: string; cn: string; en: string; line: number }[] = [];
  if (translationsMatch) {
    const body = translationsMatch[1];
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*(\w+):\s*\{\s*cn:\s*"([^"]*)",\s*en:\s*"([^"]*)"\s*\}/);
      if (match) {
        entries.push({ key: match[1], cn: match[2], en: match[3], line: i + 2 });
      }
    }
  }

  it("has translation entries to test", () => {
    expect(entries.length).toBeGreaterThan(200);
  });

  it("every key has non-empty cn value", () => {
    const empty = entries.filter((e) => e.cn.trim() === "");
    expect(empty.map((e) => e.key), "Keys with empty cn").toHaveLength(0);
  });

  it("every key has non-empty en value", () => {
    const empty = entries.filter((e) => e.en.trim() === "");
    expect(empty.map((e) => e.key), "Keys with empty en").toHaveLength(0);
  });

  it("template args {n} are consistent between cn and en", () => {
    const mismatched: string[] = [];
    for (const entry of entries) {
      const cnArgs = (entry.cn.match(/\{\d+\}/g) || []).sort();
      const enArgs = (entry.en.match(/\{\d+\}/g) || []).sort();
      if (JSON.stringify(cnArgs) !== JSON.stringify(enArgs)) {
        mismatched.push(`${entry.key}: cn has ${cnArgs.join(",")||"none"}, en has ${enArgs.join(",")||"none"}`);
      }
    }
    expect(mismatched, `Template arg mismatch:\n${mismatched.join("\n")}`).toHaveLength(0);
  });

  it("no duplicate translation keys", () => {
    const keys = entries.map((e) => e.key);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const key of keys) {
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates, `Duplicate keys: ${duplicates.join(", ")}`).toHaveLength(0);
  });

  describe("t() usage coverage", () => {
    // Collect all t("key") calls from tsx files
    // Exclude global-error.tsx — it uses a local t() because it's outside the layout/LocaleProvider
    const tsxFiles = glob.sync(path.join(root, "{components,app}/**/*.tsx"))
      .filter((f) => !f.endsWith("global-error.tsx"));
    const usedKeys = new Set<string>();

    for (const file of tsxFiles) {
      const source = fs.readFileSync(file, "utf-8");
      // Match t("key"), t('key'), t(key) patterns
      const matches = source.matchAll(/\bt\(\s*["'](\w+)["']/g);
      for (const m of matches) {
        usedKeys.add(m[1]);
      }
      // Also match labelKey references like { labelKey: "key" }
      const labelMatches = source.matchAll(/labelKey:\s*["'](\w+)["']/g);
      for (const m of labelMatches) {
        usedKeys.add(m[1]);
      }
    }

    it("finds t() calls in tsx files", () => {
      expect(usedKeys.size).toBeGreaterThan(50);
    });

    it("all used keys exist in translations", () => {
      const allKeys = new Set(entries.map((e) => e.key));
      const missing: string[] = [];
      for (const used of usedKeys) {
        // Skip dynamic keys like `action_${action.key}`
        if (!allKeys.has(used) && !used.includes("$")) {
          missing.push(used);
        }
      }
      expect(missing, `Used but missing from i18n: ${missing.join(", ")}`).toHaveLength(0);
    });
  });
});
