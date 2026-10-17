import { defineConfig } from "@playwright/test";
import { sharedConfig } from "./playwright.shared.js";

/**
 * Screenshot-comparison suite.  Separate from the Chromatic config because the
 * two answer different questions: Chromatic diffs an archived DOM in its own
 * service, this one diffs the pixels the browser painted against PNGs
 * committed beside the tests.  A small tolerance absorbs anti-aliasing
 * differences between machines; a moved or missing element exceeds it.
 */
export default defineConfig({
    ...sharedConfig({ testDir: "../tests/visual", outputFolder: "../playwright-report-visual" }),
    expect: {
        toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.25, animations: "disabled" },
    },
});
