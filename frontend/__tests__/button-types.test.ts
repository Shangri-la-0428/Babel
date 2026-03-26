import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { glob } from "glob";

/**
 * Static analysis: every <button in .tsx files must have an explicit type attribute.
 * HTML buttons default to type="submit" which causes accidental form submission.
 * Acceptable: type="button", type="submit", type="reset"
 */
describe("button type attribute audit", () => {
  const root = path.resolve(__dirname, "..");
  const dirs = ["components", "app"];

  // Collect all tsx files from components/ and app/
  const tsxFiles: string[] = [];
  for (const dir of dirs) {
    const pattern = path.join(root, dir, "**/*.tsx");
    tsxFiles.push(...glob.sync(pattern));
  }

  it("finds tsx files to audit", () => {
    expect(tsxFiles.length).toBeGreaterThan(0);
  });

  for (const file of tsxFiles) {
    const relative = path.relative(root, file);

    it(`${relative}: all <button elements have explicit type`, () => {
      const source = fs.readFileSync(file, "utf-8");
      const lines = source.split("\n");
      const violations: string[] = [];

      // Track multi-line button tags
      let inButtonTag = false;
      let buttonStartLine = 0;
      let tagBuffer = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inButtonTag) {
          tagBuffer += " " + line;
          // Check if tag closes (either self-closing or >)
          if (line.includes(">")) {
            // Tag complete — check if type is present
            if (!tagBuffer.match(/type\s*=\s*["'](button|submit|reset)["']/)) {
              violations.push(`line ${buttonStartLine + 1}: <button without type attribute`);
            }
            inButtonTag = false;
            tagBuffer = "";
          }
          continue;
        }

        // Look for <button that opens a tag
        const buttonMatch = line.match(/<button\b/g);
        if (!buttonMatch) continue;

        // For each <button on this line
        let searchPos = 0;
        for (const _match of buttonMatch) {
          const idx = line.indexOf("<button", searchPos);
          searchPos = idx + 7;

          // Extract from <button to the closing > on this or subsequent lines
          const rest = line.slice(idx);

          if (rest.includes(">")) {
            // Single-line tag
            const tagEnd = rest.indexOf(">");
            const tag = rest.slice(0, tagEnd + 1);
            if (!tag.match(/type\s*=\s*["'](button|submit|reset)["']/)) {
              violations.push(`line ${i + 1}: <button without type attribute`);
            }
          } else {
            // Multi-line tag — start buffering
            inButtonTag = true;
            buttonStartLine = i;
            tagBuffer = rest;
          }
        }
      }

      expect(violations, `Missing type on <button> elements:\n${violations.join("\n")}`).toHaveLength(0);
    });
  }
});
