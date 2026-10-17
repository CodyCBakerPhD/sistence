import { test, expect } from "@playwright/test";
import { expectPageRendered, setupDataMocks, waitForPageToRender } from "../fixtures/page-mocks.js";

/**
 * Pixel comparison of the dashboard's sections against PNG baselines
 * committed beside this file.  Chromatic archives the DOM, and a Plotly chart
 * is an SVG whose look depends on layout computed in the browser; this suite
 * holds what the browser actually painted to account.
 *
 * After an intended change, regenerate the baselines with
 * `npm run test:visual -- --update-snapshots` (or the "Update visual
 * baselines" workflow, which runs on the same Linux image as CI) and commit
 * them.
 */

const VIEWPORTS = [
    { name: "desktop", width: 1280, height: 900, sections: ["kpis", "over_time", "checks", "repositories"] },
    { name: "mobile-portrait", width: 390, height: 844, sections: ["kpis", "over_time", "repositories"] },
];

for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"]) {
        test(`${theme} — ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await setupDataMocks(page);
            await page.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
            await page.goto("/");
            await waitForPageToRender(page);
            await expectPageRendered(page);
            for (const section of viewport.sections) {
                await expect(page.locator(`#${section}`)).toHaveScreenshot(`${section}-${theme}-${viewport.name}.png`);
            }
        });
    }
}
