/**
 * Pure views of the data: what each section of the page shows, computed from
 * the index and from one run's record.  Nothing here touches the DOM.
 */

import {
    META_KEY,
    record_checks,
    type CheckResult,
    type Finding,
    type RunSummary,
    type ScanRecord,
    type Severity,
} from "./data.js";

/** The state of one check of one repository. */
export type Status = "consistent" | "info" | "warning" | "error" | "unchecked";

/** Stacking order, from the baseline up: consistent, then inconsistent by rising severity, then unchecked. */
export const STATUS_ORDER: Status[] = ["consistent", "info", "warning", "error", "unchecked"];

export const STATUS_LABELS: Record<Status, string> = {
    consistent: "Consistent",
    info: "Inconsistent (info)",
    warning: "Inconsistent (warning)",
    error: "Inconsistent (error)",
    unchecked: "Not checked",
};

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/** Display names of con/sistent's default checks; any other name is turned into words. */
const CHECK_LABELS: Record<string, string> = {
    agent_instructions: "Agent instructions",
    readme: "README",
    readme_badges: "README badges",
    layout: "Layout",
    community_files: "Community files",
    pyproject: "pyproject.toml",
    workflows: "Workflows",
    pre_commit: "Pre-commit",
};

export const ALL_CHECKS = "all";

export function check_label(name: string): string {
    if (name === ALL_CHECKS) return "All checks";
    if (CHECK_LABELS[name]) return CHECK_LABELS[name];
    const words = name.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The most severe severity among `findings` (`info` for none). */
export function worst_severity(findings: Finding[]): Severity {
    return findings.reduce<Severity>(
        (worst, finding) => (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[worst] ? finding.severity : worst),
        "info"
    );
}

/** The state of `repo` in one check. */
export function cell_status(check: CheckResult, repo: string): Status {
    const findings = check.inconsistent[repo];
    if (findings && findings.length > 0) return worst_severity(findings);
    if (repo in check.unchecked) return "unchecked";
    if (check.consistent.includes(repo)) return "consistent";
    return "unchecked";
}

/** Every repository of a run, main first, in the order the scan listed them. */
export function repositories_of(record: ScanRecord): string[] {
    const meta = record[META_KEY];
    const names = Object.keys(meta.repositories);
    return [meta.main, ...names.filter((name) => name !== meta.main)];
}

export interface MatrixCell {
    status: Status;
    findings: number;
    reason: string | null;
}

export interface MatrixRow {
    repo: string;
    is_main: boolean;
    available: boolean;
    error: string | null;
    cells: Record<string, MatrixCell>;
    /** Number of checks the repository is inconsistent in. */
    inconsistent: number;
    findings: number;
    /** Highest rank among the row's states, for sorting (unchecked ranks below consistent). */
    worst_rank: number;
}

const STATUS_RANK: Record<Status, number> = { unchecked: -1, consistent: 0, info: 1, warning: 2, error: 3 };

/** One row per repository with its state in every check. */
export function matrix_rows(record: ScanRecord): MatrixRow[] {
    const meta = record[META_KEY];
    const checks = record_checks(record);
    return repositories_of(record).map((repo) => {
        const cells: Record<string, MatrixCell> = {};
        let findings = 0;
        let inconsistent = 0;
        let worst_rank = -1;
        for (const [name, check] of checks) {
            const status = cell_status(check, repo);
            const count = check.inconsistent[repo]?.length ?? 0;
            cells[name] = { status, findings: count, reason: check.unchecked[repo] ?? null };
            findings += count;
            if (count > 0) inconsistent += 1;
            worst_rank = Math.max(worst_rank, STATUS_RANK[status]);
        }
        const status = meta.repositories[repo];
        return {
            repo,
            is_main: repo === meta.main,
            available: !status || status.status === "ok",
            error: status?.error ?? null,
            cells,
            inconsistent,
            findings,
            worst_rank,
        };
    });
}

export interface RowFilter {
    query: string;
    only_inconsistent: boolean;
}

export function filter_rows(rows: MatrixRow[], filter: RowFilter): MatrixRow[] {
    const query = filter.query.trim().toLowerCase();
    return rows.filter(
        (row) =>
            (!query || row.repo.toLowerCase().includes(query)) && (!filter.only_inconsistent || row.inconsistent > 0)
    );
}

export type RowOrder = "findings" | "name";

/** Main stays first; the rest by most findings (then name) or by name alone. */
export function sort_rows(rows: MatrixRow[], order: RowOrder): MatrixRow[] {
    const by_name = (a: MatrixRow, b: MatrixRow) => a.repo.toLowerCase().localeCompare(b.repo.toLowerCase());
    const compare =
        order === "name"
            ? by_name
            : (a: MatrixRow, b: MatrixRow) => b.worst_rank - a.worst_rank || b.findings - a.findings || by_name(a, b);
    return [...rows].sort((a, b) => Number(b.is_main) - Number(a.is_main) || compare(a, b));
}

/** Repositories per state in one run, for one check or summed over all of them (repository–check pairs). */
export function run_status_counts(run: RunSummary, check: string): Record<Status, number> {
    const counts: Record<Status, number> = { consistent: 0, info: 0, warning: 0, error: 0, unchecked: 0 };
    const names = check === ALL_CHECKS ? Object.keys(run.checks) : [check];
    for (const name of names) {
        const summary = run.checks[name];
        if (!summary) continue;
        counts.consistent += summary.consistent;
        counts.info += summary.info;
        counts.warning += summary.warning;
        counts.error += summary.error;
        counts.unchecked += summary.unchecked;
    }
    return counts;
}

export interface OverTimeSeries {
    timestamps: string[];
    counts: Record<Status, number[]>;
    /** Runs that did not have the check at all (the check was added or removed later). */
    missing: boolean[];
}

/** The state counts of every run, oldest first. */
export function over_time_series(runs: RunSummary[], check: string): OverTimeSeries {
    const series: OverTimeSeries = {
        timestamps: [],
        counts: { consistent: [], info: [], warning: [], error: [], unchecked: [] },
        missing: [],
    };
    for (const run of runs) {
        const counts = run_status_counts(run, check);
        series.timestamps.push(run.timestamp);
        series.missing.push(check !== ALL_CHECKS && !run.checks[check]);
        for (const status of STATUS_ORDER) series.counts[status].push(counts[status]);
    }
    return series;
}

/** Every check name that appears in any run, in order of first appearance. */
export function checks_of_runs(runs: RunSummary[]): string[] {
    const names: string[] = [];
    for (const run of runs) for (const name of Object.keys(run.checks)) if (!names.includes(name)) names.push(name);
    return names;
}

export interface CheckBreakdown {
    checks: string[];
    counts: Record<Status, number[]>;
}

/** Repositories per state in each check of one run. */
export function check_breakdown(record: ScanRecord): CheckBreakdown {
    const breakdown: CheckBreakdown = {
        checks: [],
        counts: { consistent: [], info: [], warning: [], error: [], unchecked: [] },
    };
    const repos = repositories_of(record);
    for (const [name, check] of record_checks(record)) {
        breakdown.checks.push(name);
        const counts: Record<Status, number> = { consistent: 0, info: 0, warning: 0, error: 0, unchecked: 0 };
        for (const repo of repos) counts[cell_status(check, repo)] += 1;
        for (const status of STATUS_ORDER) breakdown.counts[status].push(counts[status]);
    }
    return breakdown;
}

export interface Kpis {
    repositories: number;
    unavailable: number;
    /** Repositories consistent in every check they were checked in (and checked in at least one). */
    fully_consistent: number;
    checked_repositories: number;
    /** Share of checked repository–check pairs that are consistent; null when nothing was checked. */
    pass_rate: number | null;
    findings: number;
    by_severity: Record<Severity, number>;
}

export function compute_kpis(record: ScanRecord): Kpis {
    const rows = matrix_rows(record);
    const by_severity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const [, check] of record_checks(record)) {
        for (const findings of Object.values(check.inconsistent)) {
            for (const finding of findings) by_severity[finding.severity] += 1;
        }
    }
    let pairs_checked = 0;
    let pairs_consistent = 0;
    let checked_repositories = 0;
    let fully_consistent = 0;
    for (const row of rows) {
        const states = Object.values(row.cells).map((cell) => cell.status);
        const checked = states.filter((state) => state !== "unchecked");
        pairs_checked += checked.length;
        pairs_consistent += checked.filter((state) => state === "consistent").length;
        if (checked.length > 0) {
            checked_repositories += 1;
            if (checked.every((state) => state === "consistent")) fully_consistent += 1;
        }
    }
    return {
        repositories: rows.length,
        unavailable: rows.filter((row) => !row.available).length,
        fully_consistent,
        checked_repositories,
        pass_rate: pairs_checked > 0 ? pairs_consistent / pairs_checked : null,
        findings: by_severity.error + by_severity.warning + by_severity.info,
        by_severity,
    };
}

/** The pass rate and findings of a run from its index entry, to compare a run against the one before it. */
export function summary_kpis(run: RunSummary): Pick<Kpis, "pass_rate" | "findings"> {
    const counts = run_status_counts(run, ALL_CHECKS);
    const checked = counts.consistent + counts.info + counts.warning + counts.error;
    const findings = Object.values(run.checks).reduce((total, check) => total + check.findings, 0);
    return { pass_rate: checked > 0 ? counts.consistent / checked : null, findings };
}

export interface FindingRow {
    repo: string;
    check: string;
    finding: Finding;
}

/** Findings of one run, optionally of one check and/or one repository: most severe first. */
export function finding_rows(record: ScanRecord, scope: { check: string; repo: string | null }): FindingRow[] {
    const order = repositories_of(record);
    const rows: FindingRow[] = [];
    for (const [name, check] of record_checks(record)) {
        if (scope.check !== ALL_CHECKS && name !== scope.check) continue;
        for (const [repo, findings] of Object.entries(check.inconsistent)) {
            if (scope.repo && repo !== scope.repo) continue;
            for (const finding of findings) rows.push({ repo, check: name, finding });
        }
    }
    return rows.sort(
        (a, b) =>
            SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
            order.indexOf(a.repo) - order.indexOf(b.repo)
    );
}

export interface CandidateRow {
    check: string;
    locator: string;
    message: string;
    repositories: string[];
    support: number;
    total: number;
}

/** Upstream suggestions of one run, best supported first. */
export function candidate_rows(record: ScanRecord, check: string): CandidateRow[] {
    const rows: CandidateRow[] = [];
    for (const [name, result] of record_checks(record)) {
        if (check !== ALL_CHECKS && name !== check) continue;
        for (const candidate of result.candidates) {
            rows.push({
                check: name,
                locator: candidate.locator,
                message: candidate.message,
                repositories: candidate.repositories,
                support: candidate.support,
                total: candidate.total,
            });
        }
    }
    return rows.sort((a, b) => b.support / (b.total || 1) - a.support / (a.total || 1) || b.support - a.support);
}

// ── Formatting ───────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-17T02:13:45Z` → `Oct 17, 2026 02:13 UTC`; independent of the viewer's locale and time zone. */
export function format_timestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    const pad = (value: number) => String(value).padStart(2, "0");
    return (
        `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} ` +
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
    );
}

export function format_percent(value: number | null): string {
    return value === null ? "–" : `${Math.round(value * 100)}%`;
}

/** Signed change in percentage points, or null when either side is unknown. */
export function format_points(current: number | null, previous: number | null): string | null {
    if (current === null || previous === null) return null;
    const points = Math.round((current - previous) * 100);
    if (points === 0) return "no change";
    return `${points > 0 ? "+" : "−"}${Math.abs(points)} pts`;
}

/** Signed change in a count, or null when there is nothing to compare against. */
export function format_count_change(current: number, previous: number | null): string | null {
    if (previous === null) return null;
    const change = current - previous;
    if (change === 0) return "no change";
    return `${change > 0 ? "+" : "−"}${Math.abs(change)}`;
}

export function short_sha(sha: string | null): string {
    return sha ? sha.slice(0, 7) : "";
}

export function github_url(repo: string, path?: string): string {
    return `https://github.com/${repo}${path ? `/${path}` : ""}`;
}
