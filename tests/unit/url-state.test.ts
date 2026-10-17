import { afterEach, describe, expect, it } from "vitest";
import { get_url_param, set_url_param } from "../../src/url-state.js";

describe("url state", () => {
    afterEach(() => window.history.replaceState(null, "", "/"));

    it("sets, reads and removes parameters", () => {
        set_url_param("check", "readme");
        expect(get_url_param("check")).toBe("readme");
        expect(window.location.search).toBe("?check=readme");
        set_url_param("check", null);
        expect(get_url_param("check")).toBeNull();
    });

    it("leaves a default value out of the URL", () => {
        set_url_param("scale", "percent", "count");
        expect(get_url_param("scale")).toBe("percent");
        set_url_param("scale", "count", "count");
        expect(window.location.search).toBe("");
    });
});
