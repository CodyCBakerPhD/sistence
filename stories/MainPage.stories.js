import rawHTML from "../src/index.html?raw";

export default {
    title: "sistence/Main Page",
};

/**
 * Full page HTML derived from index.html via ?raw import so it always stays
 * in sync with the source.  The entry module is not run, so the sections stay
 * empty: this story covers the page's frame — header, controls and section
 * chrome — in both themes.
 *
 * Only the <body> content is extracted: the inline <head> script that adds
 * the `preload` class to <html> never runs.
 */
const bodyMatch = rawHTML.match(/<body[^>]*>([\s\S]*)<\/body>/i);
const pageHTML = bodyMatch ? bodyMatch[1] : "";

export const DarkTheme = {
    render: () => {
        document.documentElement.setAttribute("data-theme", "dark");
        return pageHTML;
    },
};

export const LightTheme = {
    render: () => {
        document.documentElement.setAttribute("data-theme", "light");
        return pageHTML;
    },
};
