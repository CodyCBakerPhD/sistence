/**
 * DOM rendering of the page's tiles and tables.  Every piece of text that
 * comes from the data — repository names, messages, locators — is inserted as
 * text, never as markup.
 */

import type { RecordMeta, RunSummary, Severity } from "./data.js";
import {
    ALL_CHECKS,
    STATUS_LABELS,
    STATUS_ORDER,
    check_label,
    format_count_change,
    format_percent,
    format_points,
    format_timestamp,
    github_url,
    run_status_counts,
    short_sha,
    type CandidateRow,
    type CheckBreakdown,
    type FindingRow,
    type Kpis,
    type MatrixRow,
    type Status,
} from "./model.js";

type Child = Node | string | null | undefined | false;

/** Creates an element with the given class, attributes and children (strings become text nodes). */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: { class?: string; attrs?: Record<string, string>; text?: string } = {},
    children: Child[] = []
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options.class) element.className = options.class;
    for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
    if (options.text !== undefined) element.textContent = options.text;
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        element.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return element;
}

export function render_message(container: HTMLElement, text: string): void {
    container.replaceChildren(el("div", { class: "message", text }));
}

/** A link to a repository on GitHub, breakable after the owner rather than anywhere in the name. */
export function repo_link(repo: string): HTMLAnchorElement {
    const slash = repo.indexOf("/");
    const parts: Child[] = slash < 0 ? [repo] : [repo.slice(0, slash + 1), el("wbr"), repo.slice(slash + 1)];
    return el("a", { class: "repo-link", attrs: { href: github_url(repo), target: "_blank", rel: "noopener" } }, parts);
}

const SEVERITY_NAMES: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Info" };

function severity_label(severity: Severity): HTMLElement {
    return el("span", { class: "severity-label" }, [
        el("span", { class: "severity-dot", attrs: { style: `background: var(--status-${severity})` } }),
        SEVERITY_NAMES[severity],
    ]);
}

// ── Generic table ────────────────────────────────────────────────────────────

export interface Column<Row> {
    header: string;
    cell: (row: Row) => Child | Child[];
    numeric?: boolean;
}

export function render_table<Row>(
    container: HTMLElement,
    columns: Column<Row>[],
    rows: Row[],
    extra_class = ""
): HTMLTableElement {
    const head = el("thead", {}, [
        el(
            "tr",
            {},
            columns.map((column) =>
                el("th", { class: column.numeric ? "num" : "", text: column.header, attrs: { scope: "col" } })
            )
        ),
    ]);
    const body = el(
        "tbody",
        {},
        rows.map((row) =>
            el(
                "tr",
                {},
                columns.map((column) => {
                    const content = column.cell(row);
                    return el(
                        "td",
                        { class: column.numeric ? "num" : "" },
                        Array.isArray(content) ? content : [content]
                    );
                })
            )
        )
    );
    const table = el("table", { class: `data-table ${extra_class}`.trim() }, [head, body]);
    container.replaceChildren(table);
    return table;
}

// ── Run caption & KPI tiles ──────────────────────────────────────────────────

export function render_caption(container: HTMLElement, meta: RecordMeta): void {
    const skipped = Object.keys(meta.skipped).length;
    container.replaceChildren(
        `Scanned ${format_timestamp(meta.timestamp)} against `,
        repo_link(meta.main),
        ` with con/sistent ${meta.sistent_version}`,
        skipped === 1 ? " · 1 fork or archived repository skipped" : "",
        skipped > 1 ? ` · ${skipped} forks or archived repositories skipped` : ""
    );
}

function tile(label: string, value: Child, sub: Child[] = [], value_class = ""): HTMLElement {
    return el("div", { class: "kpi-tile" }, [
        el("div", { class: "kpi-label", text: label }),
        el("div", { class: `kpi-value ${value_class}`.trim() }, [value]),
        sub.length ? el("div", { class: "kpi-sub" }, sub) : null,
    ]);
}

function delta(text: string | null, good: boolean | null): Child {
    if (!text) return null;
    const cls = text === "no change" || good === null ? "" : good ? "kpi-delta-good" : "kpi-delta-bad";
    return el("span", { class: cls, text: `${text} vs previous run` });
}

export function render_kpis(
    container: HTMLElement,
    kpis: Kpis,
    meta: RecordMeta,
    previous: { pass_rate: number | null; findings: number } | null
): void {
    const points = format_points(kpis.pass_rate, previous?.pass_rate ?? null);
    const pass_change =
        kpis.pass_rate !== null && previous?.pass_rate != null ? kpis.pass_rate - previous.pass_rate : 0;
    const findings_change = format_count_change(kpis.findings, previous?.findings ?? null);
    const { error, warning, info } = kpis.by_severity;
    container.replaceChildren(
        tile("Checks passing", format_percent(kpis.pass_rate), [
            "of repository checks are consistent with main",
            el("br"),
            delta(points, pass_change > 0),
        ]),
        tile("Fully consistent", `${kpis.fully_consistent} of ${kpis.checked_repositories}`, [
            "repositories pass every check",
        ]),
        tile("Findings", String(kpis.findings), [
            `${error} error · ${warning} warning · ${info} info`,
            el("br"),
            delta(findings_change, findings_change ? kpis.findings < (previous?.findings ?? 0) : null),
        ]),
        tile("Repositories", String(kpis.repositories), [
            kpis.unavailable ? `${kpis.unavailable} could not be cloned` : "all could be cloned",
        ]),
        tile(
            "Main",
            repo_link(meta.main),
            [`@${short_sha(meta.repositories[meta.main]?.head ?? null)}`],
            "kpi-value-text"
        )
    );
}

// ── Status legend & matrix ───────────────────────────────────────────────────

export function render_status_legend(container: HTMLElement): void {
    container.replaceChildren(
        ...STATUS_ORDER.map((status) =>
            el("span", { class: "legend-item" }, [
                el("span", { class: "legend-swatch", attrs: { style: `background: var(--status-${status})` } }),
                STATUS_LABELS[status],
            ])
        )
    );
}

function chip_text(status: Status, findings: number): string {
    if (status === "consistent") return "✓";
    if (status === "unchecked") return "–";
    return String(findings);
}

function chip_title(status: Status, findings: number, reason: string | null): string {
    if (status === "consistent") return "Consistent with main";
    if (status === "unchecked") return `Not checked${reason ? `: ${reason}` : ""}`;
    return `${findings} finding${findings === 1 ? "" : "s"}, the worst of severity ${status}`;
}

export interface Selection {
    repo: string;
    check: string;
}

/** The repository × check grid; selecting a cell calls `on_select` (with null when it was already selected). */
export function render_matrix(
    container: HTMLElement,
    rows: MatrixRow[],
    checks: string[],
    selected: Selection | null,
    on_select: (selection: Selection | null) => void
): void {
    if (rows.length === 0) {
        render_message(container, "No repository matches the filter.");
        return;
    }
    const head = el("thead", {}, [
        el("tr", {}, [
            el("th", { text: "Repository", attrs: { scope: "col" } }),
            ...checks.map((check) => el("th", { text: check_label(check), attrs: { scope: "col" } })),
            el("th", { class: "num", text: "Findings", attrs: { scope: "col" } }),
        ]),
    ]);
    const body = el(
        "tbody",
        {},
        rows.map((row) => {
            const name_cell = el("th", { attrs: { scope: "row" } }, [
                repo_link(row.repo),
                row.is_main ? el("span", { class: "badge", text: "main" }) : null,
                row.available
                    ? null
                    : el("span", { class: "badge", text: "unavailable", attrs: { title: row.error ?? "" } }),
            ]);
            const cells = checks.map((check) => {
                const cell = row.cells[check] ?? {
                    status: "unchecked" as Status,
                    findings: 0,
                    reason: "not in this run",
                };
                const is_selected = selected?.repo === row.repo && selected?.check === check;
                const title = chip_title(cell.status, cell.findings, cell.reason);
                const button = el("button", {
                    class: "status-chip",
                    text: chip_text(cell.status, cell.findings),
                    attrs: {
                        type: "button",
                        "data-status": cell.status,
                        "data-repo": row.repo,
                        "data-check": check,
                        "aria-pressed": String(is_selected),
                        "aria-label": `${check_label(check)} of ${row.repo}: ${title}`,
                        title,
                    },
                });
                button.addEventListener("click", () => on_select(is_selected ? null : { repo: row.repo, check }));
                return el("td", {}, [button]);
            });
            return el("tr", { class: selected?.repo === row.repo ? "selected-row" : "" }, [
                name_cell,
                ...cells,
                el("td", { class: "num", text: String(row.findings) }),
            ]);
        })
    );
    container.replaceChildren(el("table", { class: "data-table matrix" }, [head, body]));
}

// ── Findings & candidates ────────────────────────────────────────────────────

/** Rows a long table shows before offering to show the rest. */
export const TABLE_PAGE = 50;

/** After `table`, a button revealing every row when only the first `TABLE_PAGE` of `total` are shown. */
function add_show_all(container: HTMLElement, shown: number, total: number, show_all: () => void): void {
    if (shown >= total) return;
    const button = el("button", {
        class: "text-btn show-all-btn",
        text: `Show all ${total} rows`,
        attrs: { type: "button" },
    });
    button.addEventListener("click", show_all);
    container.append(el("div", { class: "show-all" }, [`Showing ${shown} of ${total}. `, button]));
}

export function render_findings(
    container: HTMLElement,
    rows: FindingRow[],
    empty_text: string,
    limit = TABLE_PAGE
): void {
    if (rows.length === 0) {
        render_message(container, empty_text);
        return;
    }
    const shown = rows.slice(0, limit);
    render_table<FindingRow>(
        container,
        [
            { header: "Severity", cell: (row) => severity_label(row.finding.severity) },
            { header: "Repository", cell: (row) => repo_link(row.repo) },
            { header: "Check", cell: (row) => check_label(row.check) },
            { header: "Kind", cell: (row) => `${row.finding.kind} ${row.finding.subject}` },
            { header: "Location", cell: (row) => el("code", { text: row.finding.locator }) },
            {
                header: "Message",
                cell: (row) => [
                    row.finding.message,
                    row.finding.detail || row.finding.option
                        ? el("details", {}, [
                              el("summary", { text: "Details" }),
                              row.finding.option
                                  ? el("div", {}, ["Option: ", el("code", { text: row.finding.option })])
                                  : null,
                              row.finding.detail ? el("pre", { text: row.finding.detail }) : null,
                          ])
                        : null,
                ],
            },
        ],
        shown,
        "findings"
    );
    add_show_all(container, shown.length, rows.length, () => render_findings(container, rows, empty_text, Infinity));
}

export function render_candidates(container: HTMLElement, rows: CandidateRow[], limit = TABLE_PAGE): void {
    if (rows.length === 0) {
        render_message(container, "No repository has anything main lacks in this selection.");
        return;
    }
    const shown = rows.slice(0, limit);
    render_table<CandidateRow>(
        container,
        [
            { header: "Check", cell: (row) => check_label(row.check) },
            { header: "Location", cell: (row) => el("code", { text: row.locator }) },
            { header: "Suggestion", cell: (row) => row.message },
            { header: "Support", numeric: true, cell: (row) => `${row.support} of ${row.total}` },
            {
                header: "Repositories",
                cell: (row) => row.repositories.flatMap((repo, i) => (i ? [", ", repo_link(repo)] : [repo_link(repo)])),
            },
        ],
        shown,
        "candidates"
    );
    add_show_all(container, shown.length, rows.length, () => render_candidates(container, rows, Infinity));
}

// ── Table views of the charts ────────────────────────────────────────────────

const COUNT_COLUMNS: { header: string; status: Status }[] = STATUS_ORDER.map((status) => ({
    header: STATUS_LABELS[status],
    status,
}));

export function render_over_time_table(container: HTMLElement, runs: RunSummary[], check: string): void {
    const rows = [...runs].reverse();
    render_table<RunSummary>(
        container,
        [
            { header: "Run", cell: (run) => format_timestamp(run.timestamp) },
            { header: "Main", cell: (run) => run.main },
            ...COUNT_COLUMNS.map((column) => ({
                header: column.header,
                numeric: true,
                cell: (run: RunSummary) => String(run_status_counts(run, check)[column.status]),
            })),
            {
                header: check === ALL_CHECKS ? "Findings" : "Findings in check",
                numeric: true,
                cell: (run) =>
                    String(
                        check === ALL_CHECKS
                            ? Object.values(run.checks).reduce((sum, c) => sum + c.findings, 0)
                            : (run.checks[check]?.findings ?? 0)
                    ),
            },
        ],
        rows
    );
}

export function render_breakdown_table(container: HTMLElement, breakdown: CheckBreakdown): void {
    render_table<number>(
        container,
        [
            { header: "Check", cell: (i) => check_label(breakdown.checks[i]) },
            ...COUNT_COLUMNS.map((column) => ({
                header: column.header,
                numeric: true,
                cell: (i: number) => String(breakdown.counts[column.status][i]),
            })),
        ],
        breakdown.checks.map((_, i) => i)
    );
}
