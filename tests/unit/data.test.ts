import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, DataError, DataSource, META_KEY, derive_base_url, record_checks } from "../../src/data.js";
import { BASE_URL, INDEX, INDEX_JSON, LATEST_RECORD, LATEST_RUN, REPORT_FILES } from "../fixtures/mock-data.js";

function respond(body: string, status = 200): Response {
    return new Response(body, { status });
}

/** A fetch over the fixture `data` branch that counts its requests. */
function fixture_fetch() {
    return vi.fn(async (url: string) => {
        const path = url.slice(BASE_URL.length + 1);
        if (path === "data/index.json") return respond(INDEX_JSON);
        if (path in REPORT_FILES) return respond(REPORT_FILES[path as keyof typeof REPORT_FILES]);
        return respond("404: Not Found", 404);
    });
}

describe("derive_base_url", () => {
    it("reads the data branch of the repository a GitHub Pages site is published from", () => {
        expect(derive_base_url({ hostname: "someone.github.io", pathname: "/sistence/" })).toBe(
            "https://raw.githubusercontent.com/someone/sistence/data"
        );
        expect(derive_base_url({ hostname: "Someone.github.io", pathname: "/fork/pr-preview/pr-3/" })).toBe(
            "https://raw.githubusercontent.com/Someone/fork/data"
        );
    });

    it("falls back to the default anywhere else", () => {
        expect(derive_base_url({ hostname: "localhost", pathname: "/" })).toBe(DEFAULT_BASE_URL);
        expect(derive_base_url({ hostname: "someone.github.io", pathname: "/" })).toBe(DEFAULT_BASE_URL);
        expect(derive_base_url({ hostname: "consistency.example.org", pathname: "/sistence/" })).toBe(DEFAULT_BASE_URL);
    });
});

describe("DataSource", () => {
    it("reads the index", async () => {
        const source = new DataSource(`${BASE_URL}/`, fixture_fetch());
        expect(source.base_url).toBe(BASE_URL);
        expect(await source.index()).toEqual(INDEX);
    });

    it("reports a missing index with its status", async () => {
        const source = new DataSource(BASE_URL, async () => respond("nope", 404));
        const error = await source.index().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DataError);
        expect((error as DataError).status).toBe(404);
        expect((error as DataError).name).toBe("DataError");
    });

    it("reports a network failure without a status", async () => {
        const source = new DataSource(BASE_URL, async () => {
            throw new TypeError("Failed to fetch");
        });
        const error = (await source.index().catch((e: unknown) => e)) as DataError;
        expect(error.status).toBeNull();
        expect(error.message).toContain("Failed to fetch");
    });

    it("refuses an index of another version, or something else entirely", async () => {
        const other = new DataSource(BASE_URL, async () => respond(JSON.stringify({ schema_version: 2, runs: [] })));
        await expect(other.index()).rejects.toThrow("this page reads version 1");
        const junk = new DataSource(BASE_URL, async () => respond(JSON.stringify({ hello: "world" })));
        await expect(junk.index()).rejects.toThrow("is not an index");
    });

    it("reads a record by file and line, fetching each file once", async () => {
        const fetcher = fixture_fetch();
        const source = new DataSource(BASE_URL, fetcher);
        const [first, second] = INDEX.runs.filter((run: { file: string }) => run.file.endsWith("20261001_report.json"));
        const a = await source.record(first);
        const b = await source.record(second);
        expect(a[META_KEY].timestamp).toBe(first.timestamp);
        expect(b[META_KEY].timestamp).toBe(second.timestamp);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(await source.record(LATEST_RUN)).toEqual(LATEST_RECORD);
    });

    it("refetches a file whose fetch failed", async () => {
        let fail = true;
        const fetcher = vi.fn(async (url: string) => {
            if (fail) return respond("busy", 503);
            return fixture_fetch()(url);
        });
        const source = new DataSource(BASE_URL, fetcher);
        await expect(source.record(LATEST_RUN)).rejects.toThrow("answered 503");
        fail = false;
        await Promise.resolve();
        expect((await source.record(LATEST_RUN))[META_KEY].main).toBe("CodyCBakerPhD/sistent");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("rejects a line that is missing or is not a record", async () => {
        const source = new DataSource(BASE_URL, async () => respond('{"not": "a record"}\n\n'));
        await expect(source.record({ file: "x.json", line: 5 })).rejects.toThrow("no record on line 5");
        await expect(source.record({ file: "x.json", line: 2 })).rejects.toThrow("no record on line 2");
        await expect(source.record({ file: "x.json", line: 1 })).rejects.toThrow("is not a scan record");
    });

    it("uses the global fetch by default", async () => {
        const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(INDEX_JSON));
        await new DataSource().index();
        expect(spy).toHaveBeenCalledWith(`${DEFAULT_BASE_URL}/data/index.json`);
        spy.mockRestore();
    });
});

describe("record_checks", () => {
    it("lists the checks of a record without its metadata", () => {
        expect(record_checks(LATEST_RECORD).map(([name]) => name)).toEqual([
            "agent_instructions",
            "readme",
            "readme_badges",
            "layout",
            "community_files",
            "pyproject",
            "workflows",
            "pre_commit",
        ]);
    });
});
