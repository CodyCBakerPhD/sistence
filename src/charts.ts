/**
 * Plotly figures.  Each builder is a pure function of the data and the theme,
 * so that a theme switch redraws by calling it again.
 */

import type { Config, Data, Layout } from "plotly.js";
import {
    STATUS_LABELS,
    STATUS_ORDER,
    check_label,
    format_timestamp,
    type CheckBreakdown,
    type OverTimeSeries,
} from "./model.js";
import type { ChartTheme } from "./theme.js";

export type Scale = "count" | "percent";

export interface Figure {
    data: Data[];
    layout: Partial<Layout>;
}

const FONT_FAMILY = '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif';

export const PLOTLY_CONFIG: Partial<Config> = {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d", "toggleSpikelines"],
    toImageButtonOptions: { format: "svg", filename: "sistence" },
};

function base_layout(theme: ChartTheme): Partial<Layout> {
    const axis = {
        gridcolor: theme.grid,
        linecolor: theme.baseline,
        zerolinecolor: theme.baseline,
        tickfont: { color: theme.muted, size: 13 },
        automargin: true,
        fixedrange: true,
    };
    return {
        paper_bgcolor: theme.surface,
        plot_bgcolor: theme.surface,
        font: { family: FONT_FAMILY, color: theme.text, size: 14 },
        margin: { l: 8, r: 8, t: 8, b: 8 },
        barmode: "stack",
        bargap: 0.4,
        // Rounds the free end of each stack; Plotly leaves the baseline square.
        barcornerradius: 4,
        hoverlabel: { font: { family: FONT_FAMILY } },
        legend: {
            orientation: "h",
            x: 0,
            xanchor: "left",
            y: 1.02,
            yanchor: "bottom",
            font: { color: theme.text_secondary, size: 13 },
            traceorder: "normal",
        },
        xaxis: { ...axis },
        yaxis: { ...axis },
    } as Partial<Layout>;
}

/** States that never occur are left out of the legend; the colors of the rest never change. */
function present(counts: Record<string, number[]>): typeof STATUS_ORDER {
    return STATUS_ORDER.filter((status, index) => index === 0 || counts[status].some((value) => value > 0));
}

/** `Oct 17, 2026<br>02:13 UTC`: the two halves of {@link format_timestamp} on two lines, for a narrower tick. */
function two_line(timestamp: string): string {
    const text = format_timestamp(timestamp);
    const split = text.lastIndexOf(" ", text.length - 5);
    return split > 0 ? `${text.slice(0, split)}<br>${text.slice(split + 1)}` : text;
}

/** Every `step`-th category, ending on the newest, so that at most `max_ticks` labels share the axis. */
export function tick_positions(count: number, max_ticks: number): number[] {
    const step = Math.max(1, Math.ceil(count / Math.max(1, max_ticks)));
    const positions: number[] = [];
    for (let i = count - 1; i >= 0; i -= step) positions.unshift(i);
    return positions;
}

/** Repositories (or repository–check pairs) per state, one stacked bar per run. */
export function over_time_figure(
    series: OverTimeSeries,
    options: { scale: Scale; all_checks: boolean; theme: ChartTheme; max_ticks?: number }
): Figure {
    const { scale, theme } = options;
    const labels = series.timestamps.map(format_timestamp);
    const ticks = tick_positions(labels.length, options.max_ticks ?? 8);
    const totals = series.timestamps.map((_, i) =>
        STATUS_ORDER.reduce((sum, status) => sum + series.counts[status][i], 0)
    );
    const unit = options.all_checks ? "repository checks" : "repositories";
    const data: Data[] = present(series.counts).map((status) => {
        const counts = series.counts[status];
        const values =
            scale === "percent" ? counts.map((count, i) => (totals[i] ? (100 * count) / totals[i] : 0)) : counts;
        return {
            type: "bar",
            name: STATUS_LABELS[status],
            x: labels,
            y: values,
            customdata: counts,
            marker: { color: theme.status[status], line: { color: theme.surface, width: 2 } },
            hovertemplate:
                scale === "percent"
                    ? `%{y:.0f}% (%{customdata} ${unit})<extra>${STATUS_LABELS[status]}</extra>`
                    : `%{y} ${unit}<extra>${STATUS_LABELS[status]}</extra>`,
        } as Data;
    });
    const layout = base_layout(theme);
    layout.hovermode = "x unified";
    layout.xaxis = {
        ...layout.xaxis,
        type: "category",
        tickangle: 0,
        tickmode: "array",
        tickvals: ticks.map((i) => labels[i]),
        ticktext: ticks.map((i) => two_line(series.timestamps[i])),
    };
    layout.yaxis = {
        ...layout.yaxis,
        title: {
            text: scale === "percent" ? `Share of ${unit} (%)` : `Number of ${unit}`,
            font: { color: theme.text_secondary, size: 13 },
        },
        rangemode: "tozero",
        ...(scale === "percent" ? { range: [0, 100] } : {}),
    };
    // A lone run would otherwise be drawn as one bar spanning the whole plot.
    if (labels.length < 4) layout.bargap = 1 - 0.15 * labels.length;
    return { data, layout };
}

/** Repositories per state in each check of one run, one horizontal stacked bar per check. */
export function breakdown_figure(breakdown: CheckBreakdown, theme: ChartTheme): Figure {
    const labels = breakdown.checks.map(check_label);
    const totals = breakdown.checks.map((_, i) =>
        STATUS_ORDER.reduce((sum, status) => sum + breakdown.counts[status][i], 0)
    );
    const data: Data[] = present(breakdown.counts).map(
        (status) =>
            ({
                type: "bar",
                orientation: "h",
                name: STATUS_LABELS[status],
                y: labels,
                x: breakdown.counts[status],
                marker: { color: theme.status[status], line: { color: theme.surface, width: 2 } },
                hovertemplate: `%{y}: %{x} repositories<extra>${STATUS_LABELS[status]}</extra>`,
            }) as Data
    );
    const layout = base_layout(theme);
    layout.hovermode = "closest";
    layout.yaxis = {
        ...layout.yaxis,
        type: "category",
        autorange: "reversed",
        tickfont: { color: theme.text_secondary, size: 14 },
    };
    layout.xaxis = {
        ...layout.xaxis,
        title: { text: "Number of repositories", font: { color: theme.text_secondary, size: 13 } },
        rangemode: "tozero",
        // Whole repositories: with few of them, Plotly would otherwise tick every half.
        ...(Math.max(0, ...totals) <= 10 ? { dtick: 1 } : {}),
    };
    layout.height = Math.max(240, 60 + 44 * labels.length);
    return { data, layout };
}
