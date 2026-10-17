import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

let gitHash = "unknown";
try {
    gitHash = execSync("git rev-parse --short=8 HEAD").toString().trim();
} catch {
    // Not a git repo or git not available; leave as "unknown"
}

export default defineConfig({
    root: "src",
    publicDir: false,
    base: "./",
    build: {
        outDir: "../dist",
        emptyOutDir: true,
        // Plotly's partial bundle is most of the page, and splitting it would not make it any smaller.
        chunkSizeWarningLimit: 1600,
    },
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __GIT_HASH__: JSON.stringify(gitHash),
    },
});
