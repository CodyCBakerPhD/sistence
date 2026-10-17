/**
 * Harness for exercising src/main.ts — the page's entry module — the way the
 * browser does.
 *
 * The module has no exports worth calling: everything it does, it does on
 * import and in response to events.  So it is imported into a jsdom document
 * holding the body of index.html, its DOMContentLoaded handler is fired, and
 * the page is then driven through its controls.  Plotly is replaced by a
 * recording stub (see main.test.ts) and fetch by a router over the same
 * fixture data the Playwright suites mock the network with.
 */

import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE_URL, INDEX_JSON, REPORT_FILES } from "../fixtures/mock-data.js";

const HTML = readFileSync(resolve(__dirname, "../../src/index.html"), "utf-8");
const BODY = /<body[^>]*>([\s\S]*)<\/body>/i.exec(HTML)?.[1] ?? "";

export interface FetchOptions {
    /** Status of the index; anything but 200 answers with an error body. */
    index_status?: number;
    /** Overrides the index body. */
    index_body?: string;
    /** Status of every report file. */
    record_status?: number;
}

/** Installs a fetch over the fixture `data` branch, returning the mock to inspect its calls. */
export function install_fetch(options: FetchOptions = {}) {
    const fetcher = vi.fn(async (input: string | URL) => {
        const url = String(input);
        const path = url.slice(BASE_URL.length + 1);
        if (path === "data/index.json") {
            const status = options.index_status ?? 200;
            return new Response(status === 200 ? (options.index_body ?? INDEX_JSON) : "error", { status });
        }
        if (path in REPORT_FILES) {
            const status = options.record_status ?? 200;
            return new Response(status === 200 ? REPORT_FILES[path as keyof typeof REPORT_FILES] : "error", { status });
        }
        return new Response("404: Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
}

/** Lets every pending fetch, promise and timer of the page run. */
export async function settle(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
}

/** The DOMContentLoaded handler of the page loaded last; removed again before the next page loads. */
let loaded: EventListenerOrEventListenerObject | null = null;

/** Loads the page at `url` with a fresh copy of the entry module, and waits for it to draw. */
export async function start_page(url = "/"): Promise<void> {
    // Each test imports its own copy of the module, which registers its own
    // handler on the one document jsdom keeps; only the newest may run.
    if (loaded) document.removeEventListener("DOMContentLoaded", loaded);
    document.documentElement.setAttribute("data-theme", "dark");
    document.body.innerHTML = BODY;
    window.history.replaceState(null, "", url);
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.resetModules();
    const add = vi.spyOn(document, "addEventListener");
    await import("../../src/main.js");
    loaded = add.mock.calls.find(([type]) => type === "DOMContentLoaded")?.[1] ?? null;
    add.mockRestore();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await settle();
}

export function $(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`#${id} is missing`);
    return element;
}

/** Sets a select or input's value and fires the event the page listens for. */
export async function change(id: string, value: string | boolean, event = "change"): Promise<void> {
    const element = $(id) as HTMLInputElement | HTMLSelectElement;
    if (typeof value === "boolean") (element as HTMLInputElement).checked = value;
    else element.value = value;
    element.dispatchEvent(new Event(event, { bubbles: true }));
    await settle();
}

/** Picks a radio button by name and value. */
export async function pick(name: string, value: string): Promise<void> {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
}

export function text(id: string): string {
    return $(id).textContent ?? "";
}

export function params(): URLSearchParams {
    return new URLSearchParams(window.location.search);
}
