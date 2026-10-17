import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, change, install_fetch, params, pick, settle, start_page, text } from "./main-harness.js";
import { INDEX } from "../fixtures/mock-data.js";
import { DARK_THEME, LIGHT_THEME } from "../../src/theme.js";

/** Plotly stand-in: records what each plot was handed, as Plotly records it on the graph div. */
const plotly = vi.hoisted(() => ({
    react: vi.fn(
        async (element: HTMLElement & { data?: unknown; layout?: unknown }, data: unknown, layout: unknown) => {
            element.classList.add("js-plotly-plot");
            element.data = data;
            element.layout = layout;
        }
    ),
    purge: vi.fn((element: HTMLElement) => element.classList.remove("js-plotly-plot")),
}));
vi.mock("plotly.js-basic-dist-min", () => ({ default: plotly }));

type Plotted = HTMLElement & {
    data: Array<{ name: string; y: unknown[]; x: unknown[] }>;
    layout: Record<string, unknown>;
};

const OLDEST = INDEX.runs[0];
const SECOND = INDEX.runs[1];

beforeEach(() => {
    plotly.react.mockClear();
    plotly.purge.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("the latest run", () => {
    it("fills the controls, tiles, charts and tables", async () => {
        install_fetch();
        await start_page();
        const runs = [...($("run_selector") as HTMLSelectElement).options].map((o) => o.text);
        expect(runs).toHaveLength(5);
        expect(runs[0]).toBe("Oct 17, 2026 02:13 UTC (latest)");
        expect(($("run_selector") as HTMLSelectElement).disabled).toBe(false);
        expect([...($("check_selector") as HTMLSelectElement).options].map((o) => o.value)).toEqual([
            "all",
            "agent_instructions",
            "readme",
            "readme_badges",
            "layout",
            "community_files",
            "pyproject",
            "workflows",
            "pre_commit",
        ]);
        expect(text("run_caption")).toContain("against CodyCBakerPhD/sistent");
        expect([...$("kpis").querySelectorAll(".kpi-value")].map((n) => n.textContent)).toEqual([
            "33%",
            "0 of 3",
            "57",
            "4",
            "CodyCBakerPhD/sistent",
        ]);
        expect(text("kpis")).toContain("no change vs previous run");
        expect(($("run_link") as HTMLAnchorElement).href).toBe(
            "https://github.com/CodyCBakerPhD/sistence/actions/runs/1004"
        );
        expect($("matrix").querySelectorAll("tbody tr")).toHaveLength(4);
        expect(text("findings_scope")).toBe("57 findings in all checks of every repository");
        expect($("findings_clear").hidden).toBe(true);
        expect($("candidates_table").querySelector("table")).not.toBeNull();
        expect(text("status_legend")).toContain("Not checked");
        expect(text("site_version")).toBe("v0.0.0+test0000");
        expect(params().toString()).toBe("");

        const over_time = $("over_time_plot") as Plotted;
        expect(over_time.data[0].x).toHaveLength(5);
        expect(over_time.layout.paper_bgcolor).toBe(DARK_THEME.surface);
        expect(($("checks_plot") as Plotted).data[0].y).toHaveLength(8);
        expect($("status_banner").hidden).toBe(true);
    });

    it("redraws the charts in the other theme", async () => {
        install_fetch();
        await start_page();
        plotly.react.mockClear();
        ($("theme_toggle_btn") as HTMLButtonElement).click();
        expect(plotly.react).toHaveBeenCalledTimes(2);
        expect(($("over_time_plot") as Plotted).layout.paper_bgcolor).toBe(LIGHT_THEME.surface);
        expect(($("checks_plot") as Plotted).layout.paper_bgcolor).toBe(LIGHT_THEME.surface);
    });
});

describe("fonts", () => {
    afterEach(() => {
        // @ts-expect-error: jsdom has no FontFaceSet; the stub below stands in for one
        delete document.fonts;
    });

    it("waits for the page's font before drawing, and draws even when it fails to load", async () => {
        for (const outcome of ["loads", "fails"]) {
            const load = vi.fn(() =>
                outcome === "loads" ? Promise.resolve([]) : Promise.reject(new Error("offline"))
            );
            Object.defineProperty(document, "fonts", { value: { load }, configurable: true });
            install_fetch();
            plotly.react.mockClear();
            await start_page();
            expect(load).toHaveBeenCalledWith('400 14px "Source Sans 3"');
            expect(load).toHaveBeenCalledWith('600 14px "Source Sans 3"');
            expect(plotly.react).toHaveBeenCalled();
        }
    });
});

describe("selecting", () => {
    it("narrows the findings to one cell of the matrix, and back", async () => {
        install_fetch();
        await start_page();
        ($("matrix").querySelector('[data-repo="dandi/usage-page"][data-check="readme"]') as HTMLButtonElement).click();
        await settle();
        expect(params().get("repo")).toBe("dandi/usage-page");
        expect(params().get("cell")).toBe("readme");
        expect(text("findings_scope")).toBe("11 findings in README of dandi/usage-page");
        expect($("findings_clear").hidden).toBe(false);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        expect($("matrix").querySelector('[aria-pressed="true"]')?.getAttribute("data-repo")).toBe("dandi/usage-page");

        ($("findings_clear") as HTMLButtonElement).click();
        await settle();
        expect(params().get("repo")).toBeNull();
        expect(text("findings_scope")).toBe("57 findings in all checks of every repository");
    });

    it("says when a selected repository is consistent", async () => {
        install_fetch();
        await start_page();
        (
            $("matrix").querySelector(
                '[data-repo="dandi/usage-page"][data-check="community_files"]'
            ) as HTMLButtonElement
        ).click();
        await settle();
        expect(text("findings_table")).toBe("dandi/usage-page is consistent with main here.");
    });

    it("scopes everything to one check", async () => {
        install_fetch();
        await start_page();
        await change("check_selector", "community_files");
        expect(params().get("check")).toBe("community_files");
        expect([...$("matrix").querySelectorAll("thead th")].map((n) => n.textContent)).toEqual([
            "Repository",
            "Community files",
            "Findings",
        ]);
        expect(text("over_time_note")).toContain("the Community files check");
        expect(text("findings_scope")).toBe("3 findings in Community files of every repository");
        expect(text("candidates_table")).toBe("No repository has anything main lacks in this selection.");
        await change("check_selector", "all");
        expect(params().get("check")).toBeNull();
    });

    it("drops a selected cell that the chosen check hides", async () => {
        install_fetch();
        await start_page("/?repo=dandi/usage-page&cell=readme");
        expect(text("findings_scope")).toBe("11 findings in README of dandi/usage-page");
        await change("check_selector", "layout");
        expect(params().get("repo")).toBeNull();
        expect(text("findings_scope")).toBe("8 findings in Layout of every repository");
    });

    it("filters and sorts the matrix", async () => {
        install_fetch();
        await start_page();
        const names = () => [...$("matrix").querySelectorAll("tbody th a")].map((n) => n.textContent);
        expect(names()).toEqual([
            "CodyCBakerPhD/sistent",
            "dandi/usage-page",
            "CodyCBakerPhD/sistence",
            "CodyCBakerPhD/does-not-exist-xyz",
        ]);
        await change("repo_sort", "name");
        expect(names()).toEqual([
            "CodyCBakerPhD/sistent",
            "CodyCBakerPhD/does-not-exist-xyz",
            "CodyCBakerPhD/sistence",
            "dandi/usage-page",
        ]);
        await change("only_inconsistent", true);
        expect(names()).toEqual(["CodyCBakerPhD/sistent", "CodyCBakerPhD/sistence", "dandi/usage-page"]);
        await change("repo_filter", "dandi", "input");
        expect(names()).toEqual(["dandi/usage-page"]);
        await change("repo_filter", "nothing-matches", "input");
        expect(text("matrix")).toBe("No repository matches the filter.");
    });
});

describe("runs", () => {
    it("loads an older run, fetching its report file", async () => {
        const fetcher = install_fetch();
        await start_page();
        await change("run_selector", "0");
        expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(OLDEST.file));
        expect(params().get("run")).toBe(OLDEST.timestamp);
        expect(text("run_caption")).toContain("Sep 1, 2026 12:00 UTC");
        expect(text("kpis")).not.toContain("previous run");
        expect(document.body.classList.contains("loading")).toBe(false);
        await change("run_selector", String(INDEX.runs.length - 1));
        expect(params().get("run")).toBeNull();
    });

    it("compares a run with the one before it", async () => {
        install_fetch();
        await start_page(`/?run=${SECOND.timestamp}`);
        expect(($("run_selector") as HTMLSelectElement).value).toBe("1");
        expect(text("kpis")).toContain("no change vs previous run");
        expect($("kpis").querySelector(".kpi-delta-good")?.textContent).toBe("−2 vs previous run");
    });

    it("keeps only the newest of several selections in flight", async () => {
        install_fetch();
        await start_page();
        const select = $("run_selector") as HTMLSelectElement;
        select.value = "0";
        select.dispatchEvent(new Event("change"));
        select.value = "1";
        select.dispatchEvent(new Event("change"));
        await settle();
        expect(text("run_caption")).toContain("Sep 15, 2026");
        expect(params().get("run")).toBe(SECOND.timestamp);
    });

    it("drops a selected repository the chosen run does not have", async () => {
        install_fetch();
        await start_page("/?repo=someone/else&cell=readme");
        expect(params().get("repo")).toBeNull();
        expect(text("findings_scope")).toBe("57 findings in all checks of every repository");
    });
});

describe("views", () => {
    it("switches the history between plot, table and shares", async () => {
        install_fetch();
        await start_page();
        await pick("over_time_view", "table");
        expect($("over_time_plot").hidden).toBe(true);
        expect($("over_time_table").hidden).toBe(false);
        expect($("over_time_table").querySelectorAll("tbody tr")).toHaveLength(5);
        expect(params().get("over_time")).toBe("table");
        await pick("over_time_view", "plot");
        await pick("over_time_scale", "percent");
        expect(params().get("scale")).toBe("percent");
        expect((($("over_time_plot") as Plotted).layout.yaxis as { range: number[] }).range).toEqual([0, 100]);
    });

    it("switches the checks between plot and table", async () => {
        install_fetch();
        await start_page();
        await pick("checks_view", "table");
        expect($("checks_table").querySelectorAll("tbody tr")).toHaveLength(8);
        expect($("checks_plot").hidden).toBe(true);
        expect(params().get("checks")).toBe("table");
    });

    it("restores every view from the URL", async () => {
        install_fetch();
        await start_page(`/?run=${OLDEST.timestamp}&check=readme&over_time=table&scale=percent&checks=table`);
        expect(($("check_selector") as HTMLSelectElement).value).toBe("readme");
        expect(($("over_time_view_table") as HTMLInputElement).checked).toBe(true);
        expect(($("over_time_scale_percent") as HTMLInputElement).checked).toBe(true);
        expect(($("checks_view_table") as HTMLInputElement).checked).toBe(true);
        expect($("over_time_table").hidden).toBe(false);
        expect(text("run_caption")).toContain("Sep 1, 2026");
    });

    it("ignores a check that no run has", async () => {
        install_fetch();
        await start_page("/?check=bogus");
        expect(($("check_selector") as HTMLSelectElement).value).toBe("all");
    });
});

describe("failures", () => {
    it("explains an empty data branch", async () => {
        install_fetch({ index_status: 404 });
        await start_page();
        expect($("status_banner").hidden).toBe(false);
        expect(text("status_banner")).toBe(
            "No scans have been recorded yet. Run the Scan workflow to record the first one."
        );
        expect(($("status_banner").querySelector("a") as HTMLAnchorElement).href).toContain(
            "/actions/workflows/scan.yml"
        );
        expect(($("run_selector") as HTMLSelectElement).disabled).toBe(true);
        expect(text("matrix")).toBe("No scans have been recorded yet.");
        expect(text("over_time_plot")).toBe("No scans have been recorded yet.");
    });

    it("explains an index without runs the same way", async () => {
        install_fetch({ index_body: JSON.stringify({ schema_version: 1, runs: [] }) });
        await start_page();
        expect(text("status_banner")).toContain("No scans have been recorded yet.");
    });

    it("reports an index that cannot be read", async () => {
        install_fetch({ index_status: 500 });
        await start_page();
        expect(text("status_banner")).toMatch(/^Failed to load the index of runs: .*answered 500$/);
        expect(text("kpis")).toContain("Failed to load");
    });

    it("reports a run that cannot be read", async () => {
        install_fetch({ record_status: 500 });
        await start_page();
        expect(text("kpis")).toMatch(/^Failed to load the run of Oct 17, 2026 02:13 UTC: .*answered 500$/);
        expect(text("checks_plot")).toContain("Failed to load");
        expect(($("over_time_plot") as Plotted).data).toBeDefined();
        // Controls that need a run do nothing without one.
        await change("repo_filter", "x", "input");
        await pick("checks_view", "table");
        expect($("checks_table").textContent).toBe("");
    });

    it("reports a chart Plotly cannot draw", async () => {
        install_fetch();
        plotly.react.mockRejectedValueOnce(new Error("no WebGL"));
        await start_page();
        expect(text("over_time_plot")).toBe("Failed to load: no WebGL");
    });
});
