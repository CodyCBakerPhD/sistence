import { defineConfig } from "@playwright/test";
import { sharedConfig } from "./playwright.shared.js";

// One project only: the viewports each snapshot is taken at are set per test
// rather than per project, since Chromatic keys an archive by the test's title
// alone.  See tests/chromatic/visual.test.js.
export default defineConfig(
    sharedConfig({ testDir: "../tests/chromatic", outputFolder: "../playwright-report-chromatic" })
);
