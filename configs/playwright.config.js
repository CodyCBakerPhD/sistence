import { defineConfig } from "@playwright/test";
import { sharedConfig } from "./playwright.shared.js";

export default defineConfig(sharedConfig({ testDir: "../tests/integration", outputFolder: "../playwright-report" }));
