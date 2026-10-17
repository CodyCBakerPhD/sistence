import { devices } from "@playwright/test";

/**
 * What every Playwright suite shares: the dev server the page is served from
 * and the one browser it runs in.
 *
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the suites at a Chromium installed
 * elsewhere, for machines where `npx playwright install` is not an option; CI
 * leaves it unset and uses the browser Playwright installs.
 */
export const BASE_URL = "http://localhost:5173";

export function sharedConfig({ testDir, outputFolder }) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
    return {
        testDir,
        fullyParallel: true,
        forbidOnly: !!process.env.CI,
        retries: process.env.CI ? 2 : 0,
        workers: process.env.CI ? 1 : undefined,
        reporter: [["html", { outputFolder, open: "never" }]],
        use: {
            baseURL: BASE_URL,
            trace: "on-first-retry",
            launchOptions: {
                args: ["--disable-gpu"],
                executablePath,
            },
        },
        projects: [
            {
                name: "chromium",
                use: { ...devices["Desktop Chrome"] },
            },
        ],
        webServer: {
            command: "npm run dev",
            url: BASE_URL,
            reuseExistingServer: !process.env.CI,
        },
    };
}
