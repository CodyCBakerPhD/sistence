/**
 * The page's entry module: loads the index of runs and the selected run's
 * record from the `data` branch, and keeps every section in step with the
 * controls.
 */

import Plotly from "plotly.js-basic-dist-min";
import { PLOTLY_CONFIG, breakdown_figure, over_time_figure, type Figure, type Scale } from "./charts.js";
import {
    DataError,
    DataSource,
    META_KEY,
    derive_base_url,
    record_checks,
    type RunSummary,
    type ScanRecord,
} from "./data.js";
import {
    ALL_CHECKS,
    candidate_rows,
    check_breakdown,
    check_label,
    checks_of_runs,
    compute_kpis,
    filter_rows,
    finding_rows,
    format_timestamp,
    matrix_rows,
    over_time_series,
    sort_rows,
    summary_kpis,
    type RowOrder,
} from "./model.js";
import {
    render_breakdown_table,
    render_candidates,
    render_caption,
    render_findings,
    render_kpis,
    render_matrix,
    render_message,
    render_over_time_table,
    render_status_legend,
    type Selection,
} from "./render.js";
import { chart_theme, init_theme } from "./theme.js";
import { get_url_param, set_url_param } from "./url-state.js";

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

/** Text the sections show when they cannot be drawn; the Playwright suites wait on it. */
export const FAILURE_TEXT = "Failed to load";

type View = "plot" | "table";

const state = {
    source: new DataSource(derive_base_url(window.location)),
    runs: [] as RunSummary[],
    run: -1,
    check: ALL_CHECKS,
    selection: null as Selection | null,
    record: null as ScanRecord | null,
    over_time_view: "plot" as View,
    over_time_scale: "count" as Scale,
    checks_view: "plot" as View,
    query: "",
    only_inconsistent: false,
    order: "findings" as RowOrder,
    /** Bumped on every run change, so that a slow fetch of an earlier selection is dropped. */
    generation: 0,
};

function $(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`#${id} is missing from the page`);
    return element;
}

function draw(id: string, figure: Figure): void {
    const element = $(id);
    // A message left by an earlier failure is not Plotly's to replace.
    if (!element.classList.contains("js-plotly-plot")) element.replaceChildren();
    void Plotly.react(element, figure.data, figure.layout, PLOTLY_CONFIG).catch((error: unknown) => {
        render_message(element, `${FAILURE_TEXT}: ${(error as Error).message}`);
    });
}

function clear_plot(id: string, text: string): void {
    const element = $(id);
    Plotly.purge(element);
    render_message(element, text);
}

function show_banner(content: (string | Node)[]): void {
    const banner = $("status_banner");
    banner.replaceChildren(...content);
    banner.hidden = false;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function render_over_time(): void {
    const plot = $("over_time_plot");
    const table = $("over_time_table");
    plot.hidden = state.over_time_view !== "plot";
    table.hidden = state.over_time_view !== "table";
    $("over_time_note").textContent =
        state.check === ALL_CHECKS
            ? "Each bar is one run; it counts every check of every repository."
            : `Each bar is one run; it counts the repositories in the ${check_label(state.check)} check.`;
    if (state.over_time_view === "table") {
        render_over_time_table(table, state.runs, state.check);
        return;
    }
    const series = over_time_series(state.runs, state.check);
    draw(
        "over_time_plot",
        over_time_figure(series, {
            scale: state.over_time_scale,
            all_checks: state.check === ALL_CHECKS,
            theme: chart_theme(),
            // Room for one two-line date label per ~110 px of plot.
            max_ticks: Math.max(2, Math.floor((plot.clientWidth || 800) / 110)),
        })
    );
}

function render_checks(record: ScanRecord): void {
    const plot = $("checks_plot");
    const table = $("checks_table");
    plot.hidden = state.checks_view !== "plot";
    table.hidden = state.checks_view !== "table";
    const breakdown = check_breakdown(record);
    if (state.checks_view === "table") render_breakdown_table(table, breakdown);
    else draw("checks_plot", breakdown_figure(breakdown, chart_theme()));
}

function render_repositories(record: ScanRecord): void {
    const checks = record_checks(record)
        .map(([name]) => name)
        .filter((name) => state.check === ALL_CHECKS || name === state.check);
    const rows = sort_rows(
        filter_rows(matrix_rows(record), { query: state.query, only_inconsistent: state.only_inconsistent }),
        state.order
    );
    render_matrix($("matrix"), rows, checks, state.selection, (selection) => {
        select(selection);
        if (selection) $("findings").scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

function render_findings_section(record: ScanRecord): void {
    const selection = state.selection;
    const check = selection?.check ?? state.check;
    const repo = selection?.repo ?? null;
    const rows = finding_rows(record, { check, repo });
    const scope = [
        check === ALL_CHECKS ? "all checks" : check_label(check),
        repo ? `of ${repo}` : "of every repository",
    ];
    $("findings_scope").textContent = `${rows.length} finding${rows.length === 1 ? "" : "s"} in ${scope.join(" ")}`;
    $("findings_clear").hidden = !selection;
    render_findings(
        $("findings_table"),
        rows,
        repo ? `${repo} is consistent with main here.` : "Everything is consistent with main here."
    );
    render_candidates($("candidates_table"), candidate_rows(record, state.check));
}

function render_run(): void {
    const record = state.record;
    if (!record) return;
    const meta = record[META_KEY];
    render_caption($("run_caption"), meta);
    const previous = state.run > 0 ? summary_kpis(state.runs[state.run - 1]) : null;
    render_kpis($("kpis"), compute_kpis(record), meta, previous);
    const link = $("run_link") as HTMLAnchorElement;
    link.hidden = !meta.run_url;
    if (meta.run_url) link.href = meta.run_url;
    render_checks(record);
    render_repositories(record);
    render_findings_section(record);
}

function redraw_charts(): void {
    if (state.runs.length) render_over_time();
    if (state.record) render_checks(state.record);
}

// ── State changes ────────────────────────────────────────────────────────────

function select(selection: Selection | null): void {
    state.selection = selection;
    set_url_param("repo", selection?.repo ?? null);
    set_url_param("cell", selection?.check ?? null);
    if (state.record) {
        render_repositories(state.record);
        render_findings_section(state.record);
    }
}

async function load_run(index: number): Promise<void> {
    state.run = index;
    const run = state.runs[index];
    set_url_param("run", run.timestamp, state.runs[state.runs.length - 1].timestamp);
    const generation = ++state.generation;
    document.body.classList.add("loading");
    try {
        const record = await state.source.record(run);
        if (generation !== state.generation) return;
        state.record = record;
        const repos = Object.keys(record[META_KEY].repositories);
        if (state.selection && !repos.includes(state.selection.repo)) select(null);
        render_run();
    } catch (error) {
        if (generation !== state.generation) return;
        state.record = null;
        const text = `${FAILURE_TEXT} the run of ${format_timestamp(run.timestamp)}: ${(error as Error).message}`;
        for (const id of ["kpis", "matrix", "findings_table", "candidates_table"]) render_message($(id), text);
        clear_plot("checks_plot", text);
    } finally {
        if (generation === state.generation) document.body.classList.remove("loading");
    }
}

function populate_selectors(): void {
    const run_selector = $("run_selector") as HTMLSelectElement;
    run_selector.replaceChildren(
        ...state.runs
            .map(
                (run, index) =>
                    new Option(
                        `${format_timestamp(run.timestamp)}${index === state.runs.length - 1 ? " (latest)" : ""}`,
                        String(index)
                    )
            )
            .reverse()
    );
    run_selector.value = String(state.run);
    run_selector.disabled = false;

    const check_selector = $("check_selector") as HTMLSelectElement;
    check_selector.replaceChildren(
        new Option("All checks", ALL_CHECKS),
        ...checks_of_runs(state.runs).map((name) => new Option(check_label(name), name))
    );
    check_selector.value = state.check;
    check_selector.disabled = false;
}

function no_data(error: unknown): void {
    const missing = error instanceof DataError && error.status === 404;
    const text = missing
        ? "No scans have been recorded yet."
        : `${FAILURE_TEXT} the index of runs: ${(error as Error).message}`;
    const workflow = document.createElement("a");
    workflow.href = "https://github.com/CodyCBakerPhD/sistence/actions/workflows/scan.yml";
    workflow.target = "_blank";
    workflow.rel = "noopener";
    workflow.textContent = "Scan workflow";
    show_banner(missing ? [text, " Run the ", workflow, " to record the first one."] : [text]);
    for (const id of ["kpis", "matrix", "findings_table", "candidates_table"]) render_message($(id), text);
    for (const id of ["over_time_plot", "checks_plot"]) clear_plot(id, text);
}

/** Plotly measures its labels once, as it draws: the page's font has to be in place by then for its margins to fit. */
async function fonts_ready(): Promise<void> {
    const fonts = document.fonts as FontFaceSet | undefined;
    if (!fonts?.load) return;
    await Promise.all(['400 14px "Source Sans 3"', '600 14px "Source Sans 3"'].map((font) => fonts.load(font))).catch(
        () => undefined
    );
}

async function load(): Promise<void> {
    try {
        [{ runs: state.runs }] = await Promise.all([state.source.index(), fonts_ready()]);
    } catch (error) {
        no_data(error);
        return;
    }
    if (state.runs.length === 0) {
        no_data(new DataError("no runs", 404));
        return;
    }
    const known = checks_of_runs(state.runs);
    if (state.check !== ALL_CHECKS && !known.includes(state.check)) state.check = ALL_CHECKS;
    const wanted = get_url_param("run");
    const found = state.runs.findIndex((run) => run.timestamp === wanted);
    populate_selectors();
    render_over_time();
    await load_run(found >= 0 ? found : state.runs.length - 1);
    ($("run_selector") as HTMLSelectElement).value = String(state.run);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function radio_value(name: string): string {
    return (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null)?.value ?? "";
}

function set_radio(name: string, value: string): void {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement | null;
    if (input) input.checked = true;
}

function read_url_state(): void {
    state.check = get_url_param("check") ?? ALL_CHECKS;
    state.over_time_view = get_url_param("over_time") === "table" ? "table" : "plot";
    state.over_time_scale = get_url_param("scale") === "percent" ? "percent" : "count";
    state.checks_view = get_url_param("checks") === "table" ? "table" : "plot";
    const repo = get_url_param("repo");
    const cell = get_url_param("cell");
    state.selection = repo && cell ? { repo, check: cell } : null;
    set_radio("over_time_view", state.over_time_view);
    set_radio("over_time_scale", state.over_time_scale);
    set_radio("checks_view", state.checks_view);
}

function wire_controls(): void {
    $("run_selector").addEventListener("change", (event) => {
        void load_run(Number((event.target as HTMLSelectElement).value));
    });
    $("check_selector").addEventListener("change", (event) => {
        state.check = (event.target as HTMLSelectElement).value;
        set_url_param("check", state.check, ALL_CHECKS);
        if (state.selection && state.check !== ALL_CHECKS && state.selection.check !== state.check) select(null);
        render_over_time();
        if (state.record) {
            render_repositories(state.record);
            render_findings_section(state.record);
        }
    });
    for (const name of ["over_time_view", "over_time_scale"]) {
        document.querySelectorAll(`input[name="${name}"]`).forEach((input) =>
            input.addEventListener("change", () => {
                state.over_time_view = radio_value("over_time_view") as View;
                state.over_time_scale = radio_value("over_time_scale") as Scale;
                set_url_param("over_time", state.over_time_view, "plot");
                set_url_param("scale", state.over_time_scale, "count");
                if (state.runs.length) render_over_time();
            })
        );
    }
    document.querySelectorAll('input[name="checks_view"]').forEach((input) =>
        input.addEventListener("change", () => {
            state.checks_view = radio_value("checks_view") as View;
            set_url_param("checks", state.checks_view, "plot");
            if (state.record) render_checks(state.record);
        })
    );
    $("repo_filter").addEventListener("input", (event) => {
        state.query = (event.target as HTMLInputElement).value;
        if (state.record) render_repositories(state.record);
    });
    $("only_inconsistent").addEventListener("change", (event) => {
        state.only_inconsistent = (event.target as HTMLInputElement).checked;
        if (state.record) render_repositories(state.record);
    });
    $("repo_sort").addEventListener("change", (event) => {
        state.order = (event.target as HTMLSelectElement).value as RowOrder;
        if (state.record) render_repositories(state.record);
    });
    $("findings_clear").addEventListener("click", () => select(null));
}

document.addEventListener("DOMContentLoaded", () => {
    init_theme(redraw_charts);
    $("site_version").textContent = `v${__APP_VERSION__}+${__GIT_HASH__}`;
    render_status_legend($("status_legend"));
    read_url_state();
    wire_controls();
    // Transitions stay off until the initial state has been applied (see index.html).
    requestAnimationFrame(() => document.documentElement.classList.remove("preload"));
    void load();
});
