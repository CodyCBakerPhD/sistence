import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { INDEX } from "../fixtures/mock-data.js";
import {
    expectNoHorizontalOverflow,
    expectPageRendered,
    setupDataMocks,
    waitForPageToRender,
} from "../fixtures/page-mocks.js";

const COVERAGE_ENABLED = process.env.PW_COVERAGE === "1";
const COVERAGE_RAW_OUTPUT_DIR = resolve(process.cwd(), "coverage", "integration", "raw");

const test = COVERAGE_ENABLED
    ? base.extend({
          page: async ({ page }, use, testInfo) => {
              if (typeof page.coverage?.startJSCoverage !== "function") {
                  await use(page);
                  return;
              }

              await page.coverage.startJSCoverage({ resetOnNavigation: false });
              try {
                  await use(page);
              } finally {
                  const coverage = await page.coverage.stopJSCoverage();
                  if (coverage.length === 0) return;

                  await mkdir(COVERAGE_RAW_OUTPUT_DIR, { recursive: true });
                  const fileHash = createHash("sha1").update(testInfo.testId).digest("hex");
                  const outputFile = resolve(COVERAGE_RAW_OUTPUT_DIR, `${fileHash}.json`);
                  await writeFile(outputFile, JSON.stringify(coverage));
              }
          },
      })
    : base;

test.describe("sistence dashboard", () => {
    test.beforeEach(async ({ page }) => {
        page.on("console", (msg) => {
            if (msg.type() === "warning") {
                const text = msg.text();
                // Suppress GPU/GL driver performance warnings emitted by the
                // software rasterizer (Swiftshader) in headless CI environments.
                if (text.includes("GL Driver Message")) return;
                console.warn(`[browser:warning] ${text}`);
            }
        });
        await page.addInitScript(() => localStorage.clear());
    });

    test.describe("with data", () => {
        test.beforeEach(async ({ page }) => {
            await setupDataMocks(page);
            await page.goto("/");
            await waitForPageToRender(page);
        });

        test("page loads with the header and every section drawn", async ({ page }) => {
            await expect(page.locator("header img")).toBeVisible();
            await expect(page.locator("header")).toContainText("sistence");
            await expectPageRendered(page);
            await expect(page.locator("#status_banner")).toBeHidden();
        });

        test("run selector lists every run, newest first", async ({ page }) => {
            const options = page.locator("#run_selector option");
            await expect(options).toHaveCount(INDEX.runs.length);
            await expect(options.first()).toHaveText("Oct 17, 2026 02:13 UTC (latest)");
        });

        test("headline numbers describe the latest run", async ({ page }) => {
            await expect(page.locator(".kpi-value")).toHaveText(["33%", "0 of 3", "57", "4", "CodyCBakerPhD/sistent"]);
        });

        test("selecting a matrix cell lists its findings", async ({ page }) => {
            await page.locator('[data-repo="dandi/usage-page"][data-check="readme"]').click();
            await expect(page.locator("#findings_scope")).toHaveText("11 findings in README of dandi/usage-page");
            await expect(page.locator("#findings_table tbody tr")).toHaveCount(11);
            await expect(page).toHaveURL(/repo=dandi%2Fusage-page&cell=readme/);
            await page.locator("#findings_clear").click();
            await expect(page.locator("#findings_scope")).toHaveText("57 findings in all checks of every repository");
        });

        test("an older run can be selected and linked to", async ({ page }) => {
            await page.locator("#run_selector").selectOption({ label: "Sep 1, 2026 12:00 UTC" });
            await expect(page.locator("#run_caption")).toContainText("Sep 1, 2026 12:00 UTC");
            await expect(page).toHaveURL(/run=2026-09-01T12%3A00%3A00Z/);
            await page.reload();
            await waitForPageToRender(page);
            await expect(page.locator("#run_selector")).toHaveValue("0");
        });

        test("the check filter scopes the matrix", async ({ page }) => {
            await page.locator("#check_selector").selectOption("community_files");
            await expect(page.locator("#matrix thead th")).toHaveText(["Repository", "Community files", "Findings"]);
        });

        test("charts switch to table views", async ({ page }) => {
            await page.locator('label[for="over_time_view_table"]').click();
            await expect(page.locator("#over_time_table tbody tr")).toHaveCount(INDEX.runs.length);
            await expect(page.locator("#over_time_plot")).toBeHidden();
            await page.locator('label[for="checks_view_table"]').click();
            await expect(page.locator("#checks_table tbody tr")).toHaveCount(8);
        });

        test("theme toggle switches between dark and light mode", async ({ page }) => {
            const html = page.locator("html");
            const initialTheme = await html.getAttribute("data-theme");
            const otherTheme = initialTheme === "dark" ? "light" : "dark";

            await page.locator("#theme_toggle_btn").click();
            await expect(html).toHaveAttribute("data-theme", otherTheme);
            expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(otherTheme);

            await page.locator("#theme_toggle_btn").click();
            await expect(html).toHaveAttribute("data-theme", initialTheme);
        });
    });

    test("a phone-sized viewport does not scroll sideways", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setupDataMocks(page);
        await page.goto("/");
        await waitForPageToRender(page);
        await expectNoHorizontalOverflow(page);
    });

    test("an empty data branch points at the Scan workflow", async ({ page }) => {
        await setupDataMocks(page, { missing: true });
        await page.goto("/");
        await expect(page.locator("#status_banner")).toContainText("No scans have been recorded yet.");
        await expect(page.locator("#status_banner a")).toHaveAttribute("href", /actions\/workflows\/scan\.yml$/);
        await expect(page.locator("#run_selector")).toBeDisabled();
    });
});
