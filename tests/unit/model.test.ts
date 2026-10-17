import { describe, expect, it } from "vitest";
import type { CheckResult, Finding, RunSummary, ScanRecord } from "../../src/data.js";
import {
    ALL_CHECKS,
    candidate_rows,
    cell_status,
    check_breakdown,
    check_label,
    checks_of_runs,
    compute_kpis,
    filter_rows,
    finding_rows,
    format_count_change,
    format_percent,
    format_points,
    format_timestamp,
    github_url,
    matrix_rows,
    over_time_series,
    repositories_of,
    run_status_counts,
    short_sha,
    sort_rows,
    summary_kpis,
    worst_severity,
} from "../../src/model.js";
import { INDEX, LATEST_RECORD, LATEST_RUN } from "../fixtures/mock-data.js";

function finding(severity: Finding["severity"], locator = "README.md#Usage"): Finding {
    return {
        id: `${severity}-${locator}`,
        severity,
        kind: "missing",
        subject: "section",
        direction: "downstream",
        locator,
        message: `section missing: ${locator}`,
        detail: null,
        option: null,
    };
}

function check(partial: Partial<CheckResult> = {}): CheckResult {
    return { consistent: [], inconsistent: {}, unchecked: {}, candidates: [], ...partial };
}

/** A three-repository run: main, a drifted satellite and an unavailable one. */
const RECORD = {
    _meta: {
        schema_version: 1,
        timestamp: "2026-10-17T12:00:00Z",
        sistent_version: "0.1.0",
        main: "o/main",
        config: {
            organizations: [],
            repositories: ["o/main"],
            main: "o/main",
            include_forks: false,
            include_archived: false,
        },
        repositories: {
            "o/zeta": { status: "ok", head: "b", error: null },
            "o/main": { status: "ok", head: "a", error: null },
            "o/gone": { status: "unavailable", head: null, error: "clone failed" },
        },
        skipped: {},
        errors: [],
        run_url: null,
    },
    readme: check({
        consistent: ["o/main"],
        inconsistent: { "o/zeta": [finding("info"), finding("error", "README.md#License")] },
        unchecked: { "o/gone": "unavailable: clone failed" },
        candidates: [
            {
                kind: "extra",
                subject: "section",
                locator: "README.md#A",
                message: "a",
                repositories: ["o/zeta"],
                support: 1,
                total: 1,
            },
        ],
    }),
    layout: check({
        consistent: ["o/main", "o/zeta"],
        unchecked: { "o/gone": "unavailable: clone failed" },
        candidates: [
            {
                kind: "extra",
                subject: "path",
                locator: "docs/",
                message: "b",
                repositories: ["o/zeta"],
                support: 1,
                total: 2,
            },
        ],
    }),
} as unknown as ScanRecord;

describe("labels and severities", () => {
    it("names the default checks and words any other", () => {
        expect(check_label("readme_badges")).toBe("README badges");
        expect(check_label("pyproject")).toBe("pyproject.toml");
        expect(check_label("my_custom-check")).toBe("My custom check");
        expect(check_label(ALL_CHECKS)).toBe("All checks");
    });

    it("finds the worst severity", () => {
        expect(worst_severity([finding("info"), finding("error"), finding("warning")])).toBe("error");
        expect(worst_severity([finding("info"), finding("warning")])).toBe("warning");
        expect(worst_severity([])).toBe("info");
    });

    it("gives each repository one state per check", () => {
        const result = check({
            consistent: ["a"],
            inconsistent: { b: [finding("warning")], c: [] },
            unchecked: { d: "x" },
        });
        expect(cell_status(result, "a")).toBe("consistent");
        expect(cell_status(result, "b")).toBe("warning");
        expect(cell_status(result, "c")).toBe("unchecked");
        expect(cell_status(result, "d")).toBe("unchecked");
        expect(cell_status(result, "e")).toBe("unchecked");
    });
});

describe("matrix", () => {
    it("lists main first, then the scan's order", () => {
        expect(repositories_of(RECORD)).toEqual(["o/main", "o/zeta", "o/gone"]);
    });

    it("builds one row per repository", () => {
        const [main, zeta, gone] = matrix_rows(RECORD);
        expect(main).toMatchObject({
            repo: "o/main",
            is_main: true,
            available: true,
            findings: 0,
            inconsistent: 0,
            worst_rank: 0,
        });
        expect(zeta.cells.readme).toEqual({ status: "error", findings: 2, reason: null });
        expect(zeta).toMatchObject({ findings: 2, inconsistent: 1, worst_rank: 3 });
        expect(gone).toMatchObject({ available: false, error: "clone failed", worst_rank: -1 });
        expect(gone.cells.layout).toEqual({ status: "unchecked", findings: 0, reason: "unavailable: clone failed" });
    });

    it("filters by name and by inconsistency", () => {
        const rows = matrix_rows(RECORD);
        expect(filter_rows(rows, { query: " ZET ", only_inconsistent: false }).map((r) => r.repo)).toEqual(["o/zeta"]);
        expect(filter_rows(rows, { query: "", only_inconsistent: true }).map((r) => r.repo)).toEqual(["o/zeta"]);
        expect(filter_rows(rows, { query: "", only_inconsistent: false })).toHaveLength(3);
    });

    it("keeps main first whatever the order", () => {
        const rows = matrix_rows(RECORD);
        expect(sort_rows(rows, "name").map((r) => r.repo)).toEqual(["o/main", "o/gone", "o/zeta"]);
        expect(sort_rows(rows, "findings").map((r) => r.repo)).toEqual(["o/main", "o/zeta", "o/gone"]);
    });
});

describe("history", () => {
    const run = (checks: Record<string, Partial<RunSummary["checks"][string]>>, timestamp = "2026-01-01T00:00:00Z") =>
        ({
            file: "f",
            line: 1,
            timestamp,
            main: "o/main",
            sistent_version: "0.1.0",
            repositories: 3,
            unavailable: 0,
            checks: Object.fromEntries(
                Object.entries(checks).map(([name, c]) => [
                    name,
                    {
                        consistent: 0,
                        inconsistent: 0,
                        unchecked: 0,
                        error: 0,
                        warning: 0,
                        info: 0,
                        findings: 0,
                        candidates: 0,
                        ...c,
                    },
                ])
            ),
        }) as RunSummary;

    it("counts states for one check or for all of them", () => {
        const summary = run({ a: { consistent: 2, error: 1, unchecked: 1 }, b: { consistent: 1, info: 2 } });
        expect(run_status_counts(summary, "a")).toEqual({ consistent: 2, info: 0, warning: 0, error: 1, unchecked: 1 });
        expect(run_status_counts(summary, ALL_CHECKS)).toEqual({
            consistent: 3,
            info: 2,
            warning: 0,
            error: 1,
            unchecked: 1,
        });
        expect(run_status_counts(summary, "missing")).toEqual({
            consistent: 0,
            info: 0,
            warning: 0,
            error: 0,
            unchecked: 0,
        });
    });

    it("builds one point per run and marks runs without the check", () => {
        const runs = [
            run({ a: { consistent: 1 } }, "2026-01-01T00:00:00Z"),
            run({ b: { consistent: 2 } }, "2026-02-01T00:00:00Z"),
        ];
        const series = over_time_series(runs, "a");
        expect(series.timestamps).toEqual(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]);
        expect(series.counts.consistent).toEqual([1, 0]);
        expect(series.missing).toEqual([false, true]);
        expect(over_time_series(runs, ALL_CHECKS).missing).toEqual([false, false]);
        expect(checks_of_runs(runs)).toEqual(["a", "b"]);
    });

    it("compares a run with the one before it", () => {
        expect(summary_kpis(run({ a: { consistent: 3, error: 1, findings: 4 } }))).toEqual({
            pass_rate: 0.75,
            findings: 4,
        });
        expect(summary_kpis(run({ a: { unchecked: 3 } }))).toEqual({ pass_rate: null, findings: 0 });
    });
});

describe("one run", () => {
    it("breaks each check down by state", () => {
        expect(check_breakdown(RECORD)).toEqual({
            checks: ["readme", "layout"],
            counts: { consistent: [1, 2], info: [0, 0], warning: [0, 0], error: [1, 0], unchecked: [1, 1] },
        });
    });

    it("computes the headline numbers", () => {
        expect(compute_kpis(RECORD)).toEqual({
            repositories: 3,
            unavailable: 1,
            fully_consistent: 1,
            checked_repositories: 2,
            pass_rate: 0.75,
            findings: 2,
            by_severity: { error: 1, warning: 0, info: 1 },
        });
    });

    it("has no pass rate when nothing was checked", () => {
        const record = {
            ...RECORD,
            readme: check({ unchecked: { "o/main": "x", "o/zeta": "x", "o/gone": "x" } }),
        } as ScanRecord;
        delete (record as Record<string, unknown>).layout;
        expect(compute_kpis(record).pass_rate).toBeNull();
    });

    it("agrees with the index on the real fixture", () => {
        const kpis = compute_kpis(LATEST_RECORD);
        expect(kpis.findings).toBe(summary_kpis(LATEST_RUN).findings);
        expect(kpis.pass_rate).toBeCloseTo(summary_kpis(LATEST_RUN).pass_rate as number);
        expect(check_breakdown(LATEST_RECORD).counts.consistent).toEqual(
            Object.values(LATEST_RUN.checks as Record<string, { consistent: number }>).map((c) => c.consistent)
        );
    });

    it("lists findings most severe first, scoped to a check and a repository", () => {
        expect(finding_rows(RECORD, { check: ALL_CHECKS, repo: null }).map((r) => r.finding.severity)).toEqual([
            "error",
            "info",
        ]);
        expect(finding_rows(RECORD, { check: "layout", repo: null })).toEqual([]);
        expect(finding_rows(RECORD, { check: "readme", repo: "o/main" })).toEqual([]);
        expect(finding_rows(RECORD, { check: "readme", repo: "o/zeta" })).toHaveLength(2);
        const real = finding_rows(LATEST_RECORD, { check: ALL_CHECKS, repo: null });
        expect(real).toHaveLength(compute_kpis(LATEST_RECORD).findings);
    });

    it("lists candidates best supported first", () => {
        expect(candidate_rows(RECORD, ALL_CHECKS).map((r) => r.locator)).toEqual(["README.md#A", "docs/"]);
        expect(candidate_rows(RECORD, "layout").map((r) => r.check)).toEqual(["layout"]);
    });
});

describe("formatting", () => {
    it("formats timestamps in UTC", () => {
        expect(format_timestamp("2026-10-17T02:13:45Z")).toBe("Oct 17, 2026 02:13 UTC");
        expect(format_timestamp("2026-01-05T23:30:00-02:00")).toBe("Jan 6, 2026 01:30 UTC");
        expect(format_timestamp("yesterday")).toBe("yesterday");
    });

    it("formats shares and changes", () => {
        expect(format_percent(0.3333)).toBe("33%");
        expect(format_percent(null)).toBe("–");
        expect(format_points(0.5, 0.4)).toBe("+10 pts");
        expect(format_points(0.4, 0.5)).toBe("−10 pts");
        expect(format_points(0.5, 0.5)).toBe("no change");
        expect(format_points(0.5, null)).toBeNull();
        expect(format_count_change(5, 3)).toBe("+2");
        expect(format_count_change(3, 5)).toBe("−2");
        expect(format_count_change(3, 3)).toBe("no change");
        expect(format_count_change(3, null)).toBeNull();
    });

    it("formats commits and links", () => {
        expect(short_sha("0035bd9e5bddae16")).toBe("0035bd9");
        expect(short_sha(null)).toBe("");
        expect(github_url("o/r")).toBe("https://github.com/o/r");
        expect(github_url("o/r", "tree/data")).toBe("https://github.com/o/r/tree/data");
    });
});

it("the fixture index lists five runs, oldest first", () => {
    expect(INDEX.runs).toHaveLength(5);
});
