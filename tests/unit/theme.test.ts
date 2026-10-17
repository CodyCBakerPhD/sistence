import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DARK_THEME,
    LIGHT_THEME,
    apply_theme,
    chart_theme,
    current_theme,
    init_theme,
    resolve_theme,
} from "../../src/theme.js";

function stub_media(matches: boolean) {
    const listeners: Array<(event: { matches: boolean }) => void> = [];
    window.matchMedia = vi.fn(() => ({
        matches,
        addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => listeners.push(listener),
    })) as unknown as typeof window.matchMedia;
    return (value: boolean) => listeners.forEach((listener) => listener({ matches: value }));
}

describe("theme", () => {
    beforeEach(() => {
        document.body.innerHTML = '<button id="theme_toggle_btn"></button>';
        localStorage.clear();
    });
    afterEach(() => {
        document.documentElement.removeAttribute("data-theme");
        vi.restoreAllMocks();
    });

    it("prefers a saved choice, then the OS", () => {
        expect(resolve_theme("light", false)).toBe("light");
        expect(resolve_theme("dark", true)).toBe("dark");
        expect(resolve_theme(null, true)).toBe("light");
        expect(resolve_theme("bogus", false)).toBe("dark");
    });

    it("applies a theme and points the toggle at the other one", () => {
        apply_theme("light");
        expect(current_theme()).toBe("light");
        expect(chart_theme()).toBe(LIGHT_THEME);
        const button = document.getElementById("theme_toggle_btn") as HTMLButtonElement;
        expect(button.getAttribute("aria-label")).toBe("Switch to dark mode");
        apply_theme("dark");
        expect(chart_theme()).toBe(DARK_THEME);
        expect(button.getAttribute("title")).toBe("Switch to light mode");
        expect(button.querySelector("svg")).not.toBeNull();
    });

    it("works without a toggle button", () => {
        document.body.innerHTML = "";
        apply_theme("light");
        expect(current_theme()).toBe("light");
    });

    it("toggles, saves the choice and redraws", () => {
        stub_media(false);
        const redraw = vi.fn();
        init_theme(redraw);
        expect(current_theme()).toBe("dark");
        (document.getElementById("theme_toggle_btn") as HTMLButtonElement).click();
        expect(current_theme()).toBe("light");
        expect(localStorage.getItem("theme")).toBe("light");
        expect(redraw).toHaveBeenCalledTimes(1);
    });

    it("follows the OS until the viewer chooses", () => {
        const change = stub_media(true);
        const redraw = vi.fn();
        init_theme(redraw);
        expect(current_theme()).toBe("light");
        change(false);
        expect(current_theme()).toBe("dark");
        expect(redraw).toHaveBeenCalledTimes(1);
        localStorage.setItem("theme", "dark");
        change(true);
        expect(current_theme()).toBe("dark");
        expect(redraw).toHaveBeenCalledTimes(1);
    });

    it("survives blocked storage and a missing matchMedia", () => {
        const original = window.matchMedia;
        // @ts-expect-error: simulating a browser without matchMedia
        delete window.matchMedia;
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        init_theme(() => {});
        expect(current_theme()).toBe("dark");
        (document.getElementById("theme_toggle_btn") as HTMLButtonElement).click();
        expect(current_theme()).toBe("light");
        window.matchMedia = original;
    });
});
