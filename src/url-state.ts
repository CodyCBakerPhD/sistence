/** Page state mirrored into the query string, so that a view can be linked to and survives a reload. */

export function get_url_param(name: string): string | null {
    return new URLSearchParams(window.location.search).get(name);
}

/** Sets (or, for null or the default value, removes) one query parameter without adding a history entry. */
export function set_url_param(name: string, value: string | null, default_value: string | null = null): void {
    const url = new URL(window.location.href);
    if (value === null || value === default_value) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    window.history.replaceState(null, "", url.toString());
}
