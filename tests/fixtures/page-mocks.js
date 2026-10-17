import { expect } from "@playwright/test";
import { BASE_URL, INDEX_JSON, REPORT_FILES } from "./mock-data.js";

// This module is shared by every Playwright suite that needs the page
// rendered against fixed content: the integration tests, the Chromatic
// archive run and the screenshot-comparison run all import it.

// ── Static fixture data ──────────────────────────────────────────────────────
// Every request for the `data` branch is answered with the fixed content of
// mock-data.js (shared with the jsdom harness of src/main.ts), so that runs
// are deterministic and never depend on what the live branch holds today.

/**
 * Registers route handlers answering every request for the `data` branch.
 * With `missing: true` the branch answers 404 throughout, as it does before
 * the first scan.  Must be called before page.goto().
 */
export async function setupDataMocks(page, { missing = false } = {}) {
    await page.route(`${BASE_URL}/**`, (route) => {
        const path = route
            .request()
            .url()
            .slice(BASE_URL.length + 1);
        if (missing) return route.fulfill({ status: 404, body: "404: Not Found" });
        if (path === "data/index.json") {
            return route.fulfill({ status: 200, contentType: "text/plain", body: INDEX_JSON });
        }
        if (path in REPORT_FILES) {
            return route.fulfill({ status: 200, contentType: "text/plain", body: REPORT_FILES[path] });
        }
        return route.fulfill({ status: 404, body: "404: Not Found" });
    });
}

/**
 * Replaces the footer version string with a fixed value so that snapshots
 * are not invalidated by version bumps or new commits.
 */
export async function mockVersion(page) {
    await page.evaluate(() => {
        const versionEl = document.getElementById("site_version");
        if (versionEl) versionEl.textContent = "v0.0.0+test0000";
    });
}

export const PLOT_IDS = ["over_time_plot", "checks_plot"];

// Text the page writes into a section when it gives up, e.g. "Failed to load the index of runs".
export const PLOT_FAILURE_TEXT = "Failed to load";

/**
 * Waits until both Plotly charts and the repository matrix have settled:
 * either everything has drawn, or a section has given up and written its
 * failure message.  A plot counts as drawn only once it holds a drawing
 * surface, not merely the class Plotly adds partway through drawing.
 */
export async function waitForPageToRender(page) {
    await page.waitForFunction(
        ([ids, failureText]) => {
            const failed = document.body.innerText.includes(failureText);
            const drawn = ids.every((id) => {
                const el = document.getElementById(id);
                return el?.classList.contains("js-plotly-plot") && el.querySelector("svg") !== null;
            });
            return failed || (drawn && document.querySelector("#matrix table") !== null);
        },
        [PLOT_IDS, PLOT_FAILURE_TEXT],
        { timeout: 30000 }
    );
    // The bundled web font must be in place before anything is measured or captured.
    await page.evaluate(() => document.fonts.ready);
}

/** Fails unless both charts drew and no section reported a failure. */
export async function expectPageRendered(page) {
    await expect(page.locator("body")).not.toContainText(PLOT_FAILURE_TEXT);
    for (const id of PLOT_IDS) {
        await expect(page.locator(`#${id} .main-svg`).first(), `#${id} drew`).toBeVisible();
    }
    await expect(page.locator("#matrix table")).toBeVisible();
}

/** Fails when the page is wider than the viewport, i.e. scrolls sideways. */
export async function expectNoHorizontalOverflow(page) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "page width vs viewport width").toBeLessThanOrEqual(clientWidth);
}
