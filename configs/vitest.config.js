import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: resolve(__dirname, ".."),
    define: {
        __APP_VERSION__: JSON.stringify("0.0.0"),
        __GIT_HASH__: JSON.stringify("test0000"),
    },
    test: {
        environment: "jsdom",
        globals: true,
        include: ["tests/unit/**/*.test.{js,ts}"],
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            include: ["src/**/*.{js,ts}"],
            exclude: ["src/scripts/**", "src/types/**"],
        },
    },
});
