import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordMeta } from "../../src/data.js";
import {
    ALL_CHECKS,
    candidate_rows,
    check_breakdown,
    compute_kpis,
    finding_rows,
    matrix_rows,
} from "../../src/model.js";
import {
    TABLE_PAGE,
    el,
    render_breakdown_table,
    render_candidates,
    render_caption,
    render_findings,
    render_kpis,
    render_matrix,
    render_message,
    render_over_time_table,
    render_status_legend,
    repo_link,
} from "../../src/render.js";
import { INDEX, LATEST_RECORD } from "../fixtures/mock-data.js";

let container: HTMLElement;
const meta = LATEST_RECORD._meta as RecordMeta;

beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.append(container);
});

function texts(selector: string): string[] {
    return [...container.querySelectorAll(selector)].map((node) => node.textContent ?? "");
}

describe("el", () => {
    it("builds elements with text, attributes and children, skipping empty ones", () => {
        const node = el("p", { class: "x", attrs: { title: "t" } }, [
            "a",
            null,
            false,
            undefined,
            el("b", { text: "c" }),
        ]);
        expect(node.outerHTML).toBe('<p class="x" title="t">a<b>c</b></p>');
    });

    it("inserts data as text, never as markup", () => {
        render_message(container, "<img src=x onerror=alert(1)>");
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toBe("<img src=x onerror=alert(1)>");
    });

    it("breaks a repository name only after its owner", () => {
        const link = repo_link("owner/name");
        expect(link.textContent).toBe("owner/name");
        expect(link.querySelector("wbr")).not.toBeNull();
        expect(link.href).toBe("https://github.com/owner/name");
        expect(repo_link("plain").textContent).toBe("plain");
    });
});

describe("caption and tiles", () => {
    it("describes the run", () => {
        render_caption(container, meta);
        expect(container.textContent).toBe(
            "Scanned Oct 17, 2026 02:13 UTC against CodyCBakerPhD/sistent with con/sistent 0.1.0 · 1 fork or archived repository skipped"
        );
        render_caption(container, { ...meta, skipped: { a: "fork", b: "archived" } });
        expect(container.textContent).toContain("· 2 forks or archived repositories skipped");
        render_caption(container, { ...meta, skipped: {} });
        expect(container.textContent).not.toContain("skipped");
    });

    it("shows the headline numbers with their change since the previous run", () => {
        render_kpis(container, compute_kpis(LATEST_RECORD), meta, { pass_rate: 0.2, findings: 60 });
        expect(texts(".kpi-label")).toEqual(["Checks passing", "Fully consistent", "Findings", "Repositories", "Main"]);
        expect(texts(".kpi-value")).toEqual(["33%", "0 of 3", "57", "4", "CodyCBakerPhD/sistent"]);
        expect(container.querySelector(".kpi-delta-good")?.textContent).toBe("+13 pts vs previous run");
        expect(texts(".kpi-delta-good")).toContain("−3 vs previous run");
        expect(container.textContent).toContain("1 could not be cloned");
        expect(container.textContent).toContain("@0035bd9");
    });

    it("marks a worse run as such, and a first run without a comparison", () => {
        render_kpis(container, compute_kpis(LATEST_RECORD), meta, { pass_rate: 0.5, findings: 50 });
        expect(texts(".kpi-delta-bad")).toEqual(["−17 pts vs previous run", "+7 vs previous run"]);
        render_kpis(container, { ...compute_kpis(LATEST_RECORD), unavailable: 0 }, meta, null);
        expect(container.textContent).not.toContain("previous run");
        expect(container.textContent).toContain("all could be cloned");
    });
});

describe("matrix", () => {
    const checks = ["readme", "community_files"];

    it("draws a chip per repository and check", () => {
        render_matrix(container, matrix_rows(LATEST_RECORD), checks, null, () => {});
        expect(texts("thead th")).toEqual(["Repository", "README", "Community files", "Findings"]);
        expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
        const chip = container.querySelector(
            '[data-repo="dandi/usage-page"][data-check="readme"]'
        ) as HTMLButtonElement;
        expect(chip.textContent).toBe("11");
        expect(chip.dataset.status).toBe("warning");
        expect(chip.title).toBe("11 findings, the worst of severity warning");
        const ok = container.querySelector(
            '[data-repo="dandi/usage-page"][data-check="community_files"]'
        ) as HTMLElement;
        expect(ok.textContent).toBe("✓");
        const gone = container.querySelector(
            '[data-repo="CodyCBakerPhD/does-not-exist-xyz"][data-check="readme"]'
        ) as HTMLElement;
        expect(gone.textContent).toBe("–");
        expect(gone.title).toMatch(/^Not checked: unavailable: /);
        expect(texts(".badge")).toEqual(["main", "unavailable"]);
    });

    it("reports selection and deselection", () => {
        const select = vi.fn();
        render_matrix(
            container,
            matrix_rows(LATEST_RECORD),
            checks,
            { repo: "dandi/usage-page", check: "readme" },
            select
        );
        const chip = container.querySelector(
            '[data-repo="dandi/usage-page"][data-check="readme"]'
        ) as HTMLButtonElement;
        expect(chip.getAttribute("aria-pressed")).toBe("true");
        expect(container.querySelector("tr.selected-row")).not.toBeNull();
        chip.click();
        expect(select).toHaveBeenLastCalledWith(null);
        (
            container.querySelector('[data-repo="CodyCBakerPhD/sistence"][data-check="readme"]') as HTMLButtonElement
        ).click();
        expect(select).toHaveBeenLastCalledWith({ repo: "CodyCBakerPhD/sistence", check: "readme" });
    });

    it("says so when no row is left, and copes with a check a row lacks", () => {
        render_matrix(container, [], checks, null, () => {});
        expect(container.textContent).toBe("No repository matches the filter.");
        render_matrix(container, matrix_rows(LATEST_RECORD), ["not_in_this_run"], null, () => {});
        expect(texts(".status-chip")).toEqual(["–", "–", "–", "–"]);
        expect(container.querySelector(".status-chip")?.getAttribute("title")).toBe("Not checked: not in this run");
    });

    it("has a legend of every state", () => {
        render_status_legend(container);
        expect(texts(".legend-item")).toEqual([
            "Consistent",
            "Inconsistent (info)",
            "Inconsistent (warning)",
            "Inconsistent (error)",
            "Not checked",
        ]);
    });
});

describe("findings and candidates", () => {
    it("lists findings with their details, a page at a time", () => {
        const rows = finding_rows(LATEST_RECORD, { check: ALL_CHECKS, repo: null });
        expect(rows.length).toBeGreaterThan(TABLE_PAGE);
        render_findings(container, rows, "none");
        expect(container.querySelectorAll("tbody tr")).toHaveLength(TABLE_PAGE);
        expect(texts("thead th")).toEqual(["Severity", "Repository", "Check", "Kind", "Location", "Message"]);
        expect(container.querySelector("tbody tr td")?.textContent).toBe("Error");
        expect(container.querySelector(".show-all")?.textContent).toBe(
            `Showing ${TABLE_PAGE} of ${rows.length}. Show all ${rows.length} rows`
        );
        (container.querySelector(".show-all-btn") as HTMLButtonElement).click();
        expect(container.querySelectorAll("tbody tr")).toHaveLength(rows.length);
        expect(container.querySelector(".show-all")).toBeNull();
        expect(container.querySelectorAll("details pre").length).toBeGreaterThan(0);
    });

    it("shows a finding's option", () => {
        const [row] = finding_rows(LATEST_RECORD, { check: ALL_CHECKS, repo: null });
        render_findings(
            container,
            [{ ...row, finding: { ...row.finding, option: "aspects.readme.x=1", detail: null } }],
            "none"
        );
        expect(container.querySelector("details")?.textContent).toBe("DetailsOption: aspects.readme.x=1");
    });

    it("says when there is nothing to list", () => {
        render_findings(container, [], "Everything is consistent.");
        expect(container.textContent).toBe("Everything is consistent.");
        render_candidates(container, []);
        expect(container.textContent).toBe("No repository has anything main lacks in this selection.");
    });

    it("lists candidates with their support", () => {
        const rows = candidate_rows(LATEST_RECORD, ALL_CHECKS);
        render_candidates(container, rows, 3);
        expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
        expect(texts("thead th")).toEqual(["Check", "Location", "Suggestion", "Support", "Repositories"]);
        expect(container.querySelector("tbody td.num")?.textContent).toMatch(/^\d+ of \d+$/);
        (container.querySelector(".show-all-btn") as HTMLButtonElement).click();
        expect(container.querySelectorAll("tbody tr")).toHaveLength(rows.length);
        const multi = { ...rows[0], repositories: ["a/b", "c/d"] };
        render_candidates(container, [multi]);
        expect(container.querySelector("tbody tr td:last-child")?.textContent).toBe("a/b, c/d");
    });
});

describe("table views of the charts", () => {
    it("lists runs newest first", () => {
        render_over_time_table(container, INDEX.runs, ALL_CHECKS);
        const rows = [...container.querySelectorAll("tbody tr")];
        expect(rows).toHaveLength(5);
        expect(rows[0].querySelector("td")?.textContent).toBe("Oct 17, 2026 02:13 UTC");
        expect(texts("thead th")).toContain("Findings");
        expect(rows[0].lastElementChild?.textContent).toBe("57");
        render_over_time_table(container, INDEX.runs, "community_files");
        expect(texts("thead th")).toContain("Findings in check");
        expect(container.querySelector("tbody tr")?.lastElementChild?.textContent).toBe("3");
        render_over_time_table(container, INDEX.runs, "not_a_check");
        expect(container.querySelector("tbody tr")?.lastElementChild?.textContent).toBe("0");
    });

    it("lists the checks of a run", () => {
        render_breakdown_table(container, check_breakdown(LATEST_RECORD));
        expect(container.querySelectorAll("tbody tr")).toHaveLength(8);
        expect(container.querySelector("tbody tr td")?.textContent).toBe("Agent instructions");
    });
});
