/**
 * Light and dark themes.  The chart colors here mirror the CSS custom
 * properties of styles.css, since Plotly is handed literal colors.
 */

import type { Status } from "./model.js";

export type ThemeName = "light" | "dark";

export interface ChartTheme {
    surface: string;
    text: string;
    text_secondary: string;
    muted: string;
    grid: string;
    baseline: string;
    status: Record<Status, string>;
}

export const LIGHT_THEME: ChartTheme = {
    surface: "#fcfcfb",
    text: "#0b0b0b",
    text_secondary: "#52514e",
    muted: "#6f6e69",
    grid: "#e1e0d9",
    baseline: "#c3c2b7",
    status: {
        consistent: "#0ca30c",
        info: "#ef9483",
        warning: "#dc5a48",
        error: "#ad281d",
        unchecked: "#a9a8a1",
    },
};

export const DARK_THEME: ChartTheme = {
    surface: "#1a1a19",
    text: "#f0efec",
    text_secondary: "#c3c2b7",
    muted: "#a3a29b",
    grid: "#2c2c2a",
    baseline: "#383835",
    status: {
        consistent: "#0ca30c",
        info: "#f19a8a",
        warning: "#e0614f",
        error: "#b42a1f",
        unchecked: "#8a8984",
    },
};

export const STORAGE_KEY = "theme";

const SUN_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const MOON_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

/** A saved choice wins; otherwise the OS preference.  Must match the inline script of index.html. */
export function resolve_theme(saved: string | null, prefers_light: boolean): ThemeName {
    if (saved === "light" || saved === "dark") return saved;
    return prefers_light ? "light" : "dark";
}

export function current_theme(): ThemeName {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function chart_theme(name: ThemeName = current_theme()): ChartTheme {
    return name === "light" ? LIGHT_THEME : DARK_THEME;
}

function read_saved(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function prefers_light_query(): MediaQueryList | null {
    return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
}

/** Applies `name` to the page and points the toggle button at the other theme. */
export function apply_theme(name: ThemeName): void {
    document.documentElement.setAttribute("data-theme", name);
    const button = document.getElementById("theme_toggle_btn");
    if (!button) return;
    const other = name === "dark" ? "light" : "dark";
    button.innerHTML = name === "dark" ? SUN_ICON : MOON_ICON;
    button.setAttribute("aria-label", `Switch to ${other} mode`);
    button.setAttribute("title", `Switch to ${other} mode`);
}

/**
 * Applies the saved or preferred theme, wires the toggle button (which saves
 * the choice), and follows OS changes until the viewer picks a theme.
 * `on_change` runs after every change, to redraw the charts.
 */
export function init_theme(on_change: () => void): void {
    const query = prefers_light_query();
    apply_theme(resolve_theme(read_saved(), query?.matches ?? false));
    document.getElementById("theme_toggle_btn")?.addEventListener("click", () => {
        const next: ThemeName = current_theme() === "dark" ? "light" : "dark";
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Storage blocked: the choice lasts for this page view only.
        }
        apply_theme(next);
        on_change();
    });
    query?.addEventListener?.("change", (event) => {
        if (read_saved()) return;
        apply_theme(event.matches ? "light" : "dark");
        on_change();
    });
}
