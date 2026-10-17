import {
    ALL_CHECKS,
    candidate_rows,
    compute_kpis,
    finding_rows,
    matrix_rows,
    sort_rows,
    summary_kpis,
} from "../src/model.ts";
import {
    render_candidates,
    render_findings,
    render_kpis,
    render_matrix,
    render_over_time_table,
    render_status_legend,
} from "../src/render.ts";
import { INDEX, LATEST_RECORD } from "../tests/fixtures/mock-data.js";

export default {
    title: "sistence/Sections",
    argTypes: {
        theme: { control: "inline-radio", options: ["dark", "light"] },
    },
    args: { theme: "dark" },
};

/** Renders into a fresh element styled like a section of the page, in the chosen theme. */
function section(theme, build) {
    document.documentElement.setAttribute("data-theme", theme);
    const wrapper = document.createElement("div");
    wrapper.className = "page-content";
    const inner = document.createElement("div");
    wrapper.append(inner);
    build(inner);
    return wrapper;
}

const previous = summary_kpis(INDEX.runs[INDEX.runs.length - 2]);

export const HeadlineNumbers = {
    render: ({ theme }) =>
        section(theme, (el) => {
            el.className = "kpi-row";
            render_kpis(el, compute_kpis(LATEST_RECORD), LATEST_RECORD._meta, previous);
        }),
};

export const RepositoryMatrix = {
    render: ({ theme }) =>
        section(theme, (el) => {
            el.className = "dashboard-section";
            const legend = document.createElement("div");
            legend.className = "status-legend";
            render_status_legend(legend);
            const matrix = document.createElement("div");
            matrix.className = "matrix-wrapper";
            const checks = Object.keys(LATEST_RECORD).filter((key) => key !== "_meta");
            render_matrix(
                matrix,
                sort_rows(matrix_rows(LATEST_RECORD), "findings"),
                checks,
                { repo: "dandi/usage-page", check: "readme" },
                () => {}
            );
            el.append(legend, matrix);
        }),
};

export const Findings = {
    render: ({ theme }) =>
        section(theme, (el) => {
            el.className = "dashboard-section plot-table";
            render_findings(el, finding_rows(LATEST_RECORD, { check: ALL_CHECKS, repo: null }), "Nothing to list.");
        }),
};

export const CandidatesForMain = {
    render: ({ theme }) =>
        section(theme, (el) => {
            el.className = "dashboard-section plot-table";
            render_candidates(el, candidate_rows(LATEST_RECORD, ALL_CHECKS), 12);
        }),
};

export const HistoryTable = {
    render: ({ theme }) =>
        section(theme, (el) => {
            el.className = "dashboard-section plot-table";
            render_over_time_table(el, INDEX.runs, ALL_CHECKS);
        }),
};
