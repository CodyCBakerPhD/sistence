import { test, takeSnapshot } from "@chromatic-com/playwright";
import {
    expectNoHorizontalOverflow,
    expectPageRendered,
    mockVersion,
    setupDataMocks,
    waitForPageToRender,
} from "../fixtures/page-mocks.js";

/**
 * Viewports every snapshot is taken at, as a matrix of the two device classes
 * against the two orientations, plus a desktop width.
 *
 * These are per-test rather than per-project because Chromatic keys an archive
 * by the test's title alone: run as Playwright projects, each viewport writes
 * over the last one's manifest and only the project that runs last reaches
 * Chromatic at all.  Naming the viewport in the test title keeps them apart.
 */
const VIEWPORTS = [
    { name: "desktop", width: 1280, height: 720 },
    { name: "tablet-portrait", width: 768, height: 1024 },
    { name: "tablet-landscape", width: 1024, height: 768 },
    { name: "mobile-portrait", width: 390, height: 844 },
    { name: "mobile-landscape", width: 844, height: 390 },
];

test.describe("sistence dashboard", () => {
    // The Chromatic fixture calls takeSnapshot automatically after the test body
    // unless disableAutoSnapshot is set. Since we call takeSnapshot explicitly
    // ourselves, disabling the automatic one prevents two identical captures per
    // test (which would show up as redundant snapshots in Chromatic's UI).
    test.use({ disableAutoSnapshot: true });

    for (const viewport of VIEWPORTS) {
        for (const theme of ["dark", "light"]) {
            test(`${theme} theme — ${viewport.name}`, async ({ page }, testInfo) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await setupDataMocks(page);
                await page.addInitScript((theme) => {
                    localStorage.setItem("theme", theme);
                }, theme);
                await page.goto("/");
                await waitForPageToRender(page);
                await mockVersion(page);
                await expectPageRendered(page);
                await expectNoHorizontalOverflow(page);
                await takeSnapshot(page, testInfo.title, testInfo);
            });
        }
    }

    test("empty data branch", async ({ page }, testInfo) => {
        await setupDataMocks(page, { missing: true });
        await page.goto("/");
        await page.locator("#status_banner").waitFor();
        await mockVersion(page);
        await takeSnapshot(page, testInfo.title, testInfo);
    });
});
