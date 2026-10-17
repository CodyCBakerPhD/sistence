/**
 * The `data` branch: its index of runs and the JSON Lines report files the
 * scan workflow appends to.  See scanner/src/sistence_scanner/record.py for
 * the producing side of every shape declared here.
 */

/** Where the `data` branch of this repository is served raw. */
export const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/CodyCBakerPhD/sistence/data";

/** The index of every run, relative to the base URL. */
export const INDEX_PATH = "data/index.json";

/** The reserved outer key of a record that describes the run rather than a check. */
export const META_KEY = "_meta";

/** The record shape this page reads; runs of another version are skipped. */
export const RECORD_SCHEMA_VERSION = 1;

export type Severity = "error" | "warning" | "info";

export interface Finding {
    id: string;
    severity: Severity;
    kind: string;
    subject: string;
    direction: string;
    locator: string;
    message: string;
    detail: string | null;
    option: string | null;
}

export interface Candidate {
    kind: string;
    subject: string;
    locator: string;
    message: string;
    repositories: string[];
    support: number;
    total: number;
}

/** One consistency check of one run: every repository is in exactly one of the three groups. */
export interface CheckResult {
    consistent: string[];
    inconsistent: Record<string, Finding[]>;
    unchecked: Record<string, string>;
    candidates: Candidate[];
}

export interface RepositoryStatus {
    status: "ok" | "unavailable";
    head: string | null;
    error: string | null;
}

export interface RecordMeta {
    schema_version: number;
    timestamp: string;
    sistent_version: string;
    main: string;
    config: {
        organizations: string[];
        repositories: string[];
        main: string;
        include_forks: boolean;
        include_archived: boolean;
    };
    repositories: Record<string, RepositoryStatus>;
    skipped: Record<string, string>;
    errors: { stage: string; repository: string | null; message: string }[];
    run_url: string | null;
}

/** One line of a report file: `_meta`, then one entry per consistency check. */
export type ScanRecord = { [META_KEY]: RecordMeta } & Record<string, unknown>;

export interface CheckSummary {
    consistent: number;
    inconsistent: number;
    unchecked: number;
    error: number;
    warning: number;
    info: number;
    findings: number;
    candidates: number;
}

/** One run as listed in the index: where its record is, and its per-check counts. */
export interface RunSummary {
    file: string;
    line: number;
    timestamp: string;
    main: string;
    sistent_version: string;
    repositories: number;
    unavailable: number;
    checks: Record<string, CheckSummary>;
}

export interface DataIndex {
    schema_version: number;
    runs: RunSummary[];
}

/** A failed or unusable response; `status` is the HTTP status when there was one. */
export class DataError extends Error {
    status: number | null;

    constructor(message: string, status: number | null = null) {
        super(message);
        this.name = "DataError";
        this.status = status;
    }
}

/**
 * The raw `data` branch of the repository this page is published from: a page
 * on `<owner>.github.io/<repo>/...` reads `<owner>/<repo>`, so that a fork
 * publishing its own page reads its own data.  Anywhere else (a custom domain,
 * a local server) falls back to {@link DEFAULT_BASE_URL}.
 */
export function derive_base_url(location: { hostname: string; pathname: string }): string {
    const match = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    const repo = location.pathname.split("/").filter(Boolean)[0];
    if (!match || !repo) return DEFAULT_BASE_URL;
    return `https://raw.githubusercontent.com/${match[1]}/${repo}/data`;
}

/** The consistency checks of a record, in their recorded order, without `_meta`. */
export function record_checks(record: ScanRecord): [string, CheckResult][] {
    return Object.entries(record).filter(([key]) => key !== META_KEY) as [string, CheckResult][];
}

type Fetcher = (url: string) => Promise<Response>;

/**
 * Reads the index and the report files from the `data` branch, fetching each
 * report file once however many of its runs are looked at.
 */
export class DataSource {
    readonly base_url: string;
    private readonly fetcher: Fetcher;
    private readonly files = new Map<string, Promise<string[]>>();

    constructor(base_url: string = DEFAULT_BASE_URL, fetcher: Fetcher = (url) => fetch(url)) {
        this.base_url = base_url.replace(/\/+$/, "");
        this.fetcher = fetcher;
    }

    url(path: string): string {
        return `${this.base_url}/${path}`;
    }

    private async text(path: string): Promise<string> {
        let response: Response;
        try {
            response = await this.fetcher(this.url(path));
        } catch (error) {
            throw new DataError(`Could not reach ${this.url(path)}: ${(error as Error).message}`);
        }
        if (!response.ok) {
            throw new DataError(`${this.url(path)} answered ${response.status}`, response.status);
        }
        return response.text();
    }

    /** The index of every run, oldest first. */
    async index(): Promise<DataIndex> {
        const index = JSON.parse(await this.text(INDEX_PATH)) as DataIndex;
        if (!index || !Array.isArray(index.runs)) throw new DataError(`${this.url(INDEX_PATH)} is not an index`);
        if (index.schema_version !== RECORD_SCHEMA_VERSION) {
            throw new DataError(
                `${this.url(INDEX_PATH)} has version ${index.schema_version}; this page reads version ${RECORD_SCHEMA_VERSION}`
            );
        }
        return index;
    }

    /** The record of one run. */
    async record(run: Pick<RunSummary, "file" | "line">): Promise<ScanRecord> {
        let lines = this.files.get(run.file);
        if (!lines) {
            lines = this.text(run.file).then((text) => text.split("\n"));
            this.files.set(run.file, lines);
            lines.catch(() => this.files.delete(run.file));
        }
        const line = (await lines)[run.line - 1] as string | undefined;
        if (!line || !line.trim()) throw new DataError(`${this.url(run.file)} has no record on line ${run.line}`);
        const record = JSON.parse(line) as ScanRecord;
        if (!record[META_KEY]) throw new DataError(`${this.url(run.file)}:${run.line} is not a scan record`);
        return record;
    }
}
