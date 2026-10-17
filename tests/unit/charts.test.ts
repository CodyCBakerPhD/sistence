import { describe, expect, it } from "vitest";
import { PLOTLY_CONFIG, breakdown_figure, over_time_figure, tick_positions } from "../../src/charts.js";
import { ALL_CHECKS, check_breakdown, check_label, over_time_series } from "../../src/model.js";
import { DARK_THEME, LIGHT_THEME } from "../../src/theme.js";
import { INDEX, LATEST_RECORD } from "../fixtures/mock-data.js";

type Trace = {
    name: string;
    x: unknown[];
    y: number[];
    customdata?: number[];
    marker: { color: string; line: { color: string } };
    hovertemplate: string;
};

describe("over_time_figure", () => {
    const series = over_time_series(INDEX.runs, ALL_CHECKS);

    it("stacks one bar per run and state, colored by state", () => {
        const { data, layout } = over_time_figure(series, { scale: "count", all_checks: true, theme: LIGHT_THEME });
        const traces = data as unknown as Trace[];
        expect(traces.map((t) => t.name)).toEqual([
            "Consistent",
            "Inconsistent (info)",
            "Inconsistent (warning)",
            "Inconsistent (error)",
            "Not checked",
        ]);
        expect(traces[0].x).toHaveLength(INDEX.runs.length);
        expect(traces[0].y).toEqual(series.counts.consistent);
        expect(traces[3].marker.color).toBe(LIGHT_THEME.status.error);
        expect(traces[0].marker.line.color).toBe(LIGHT_THEME.surface);
        expect(traces[0].hovertemplate).toContain("repository checks");
        expect(layout.barmode).toBe("stack");
        expect((layout.yaxis as { title: { text: string } }).title.text).toBe("Number of repository checks");
        expect(layout.paper_bgcolor).toBe(LIGHT_THEME.surface);
    });

    it("can show shares of each run instead", () => {
        const { data, layout } = over_time_figure(series, { scale: "percent", all_checks: false, theme: DARK_THEME });
        const traces = data as unknown as Trace[];
        const sums = traces[0].y.map((_, i) => traces.reduce((sum, t) => sum + t.y[i], 0));
        for (const sum of sums) expect(sum).toBeCloseTo(100);
        expect(traces[0].customdata).toEqual(series.counts.consistent);
        expect(traces[0].hovertemplate).toContain("% (%{customdata} repositories)");
        expect((layout.yaxis as { range: number[] }).range).toEqual([0, 100]);
        expect(layout.paper_bgcolor).toBe(DARK_THEME.surface);
    });

    it("leaves states that never occur out of the legend", () => {
        const empty = {
            timestamps: ["2026-01-01T00:00:00Z"],
            counts: { consistent: [0], info: [0], warning: [0], error: [2], unchecked: [0] },
            missing: [false],
        };
        const { data, layout } = over_time_figure(empty, { scale: "percent", all_checks: true, theme: LIGHT_THEME });
        expect((data as unknown as Trace[]).map((t) => t.name)).toEqual(["Consistent", "Inconsistent (error)"]);
        expect((data as unknown as Trace[])[0].y).toEqual([0]);
        expect(layout.bargap).toBeCloseTo(0.85);
    });

    it("labels at most max_ticks runs, always the newest", () => {
        const { layout } = over_time_figure(series, {
            scale: "count",
            all_checks: true,
            theme: LIGHT_THEME,
            max_ticks: 2,
        });
        const axis = layout.xaxis as { tickvals: string[]; ticktext: string[] };
        expect(axis.tickvals).toEqual(["Sep 15, 2026 12:00 UTC", "Oct 17, 2026 02:13 UTC"]);
        expect(axis.ticktext[1]).toBe("Oct 17, 2026<br>02:13 UTC");
    });
});

describe("tick_positions", () => {
    it("spaces ticks evenly, ending on the last category", () => {
        expect(tick_positions(5, 8)).toEqual([0, 1, 2, 3, 4]);
        expect(tick_positions(10, 3)).toEqual([1, 5, 9]);
        expect(tick_positions(3, 0)).toEqual([2]);
        expect(tick_positions(0, 4)).toEqual([]);
    });
});

describe("breakdown_figure", () => {
    it("draws one horizontal bar per check with whole-repository ticks", () => {
        const breakdown = check_breakdown(LATEST_RECORD);
        const { data, layout } = breakdown_figure(breakdown, DARK_THEME);
        const traces = data as unknown as Array<Trace & { orientation: string }>;
        expect(traces.every((t) => t.orientation === "h")).toBe(true);
        expect(traces[0].y).toEqual(breakdown.checks.map(check_label));
        expect((layout.yaxis as { autorange: string }).autorange).toBe("reversed");
        expect((layout.xaxis as { dtick?: number }).dtick).toBe(1);
        expect(layout.height).toBe(60 + 44 * breakdown.checks.length);
    });

    it("lets Plotly pick ticks for larger fleets", () => {
        const breakdown = {
            checks: ["readme"],
            counts: { consistent: [40], info: [0], warning: [0], error: [0], unchecked: [0] },
        };
        const { layout } = breakdown_figure(breakdown, LIGHT_THEME);
        expect((layout.xaxis as { dtick?: number }).dtick).toBeUndefined();
        expect(layout.height).toBe(240);
    });
});

it("keeps the Plotly logo off the mode bar", () => {
    expect(PLOTLY_CONFIG.displaylogo).toBe(false);
});
