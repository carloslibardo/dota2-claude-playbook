/**
 * One-command project rename. `bun run init my_game` turns this template into
 * your game: every addon-name token in every text file, the addoninfo, the net
 * tables, the convars, the localization, the docs.
 *
 * The rename is driven by the CURRENT name in package.json, never by a
 * hardcoded starting name — so it is idempotent, and re-runnable later if you
 * change your mind. It needs no network and no dependencies (it runs before
 * `bun install` if you like), and it never touches a Dota install: linking is
 * `bun run link`, always explicit.
 *
 * Usage:
 *   bun run init <addon_name> [--title "Display Name"] [--no-verify]
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Same rule `scripts/utils.js` enforces, and the same rule the engine enforces
// on a directory under dota_addons. Failing here beats failing at launch.
const ADDON_NAME = /^[a-z][\d_a-z]+$/;

const SKIP_DIRS = new Set(["node_modules", ".git", ".vscode", "artifacts"]);

// The renamer never renames itself: any name appearing in here describes the
// tool, not the project, and rewriting those turns its own docs into nonsense.
const SKIP_FILES = new Set([fileURLToPath(import.meta.url)]);

const titleize = (name: string) =>
    name
        .split("_")
        .filter(Boolean)
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(" ");

const pascalize = (name: string) => titleize(name).replace(/ /g, "");

function readAddonName(): string {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as { name?: string };
    if (typeof pkg.name !== "string" || pkg.name === "") {
        throw new Error("package.json has no `name` — cannot tell what this project is currently called.");
    }
    return pkg.name;
}

/** The display name as it currently stands, so a second rename catches it too. */
function readAddonTitle(fallback: string): string {
    const localization = join(projectRoot, "game", "resource", "addon_english.txt");
    if (existsSync(localization)) {
        const match = /"addon_game_name"\s+"([^"]+)"/.exec(readFileSync(localization, "utf8"));
        if (match) return match[1];
    }
    return fallback;
}

function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue; // a linked addon dir points into the Dota install
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (entry.isFile() && !SKIP_FILES.has(full)) {
            yield full;
        }
    }
}

/** Text-vs-binary by NUL byte — cheaper and more reliable than an extension list. */
function readTextFile(path: string): string | undefined {
    if (statSync(path).size > 8 * 1024 * 1024) return undefined;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) return undefined;
    return buffer.toString("utf8");
}

function renameTokens(from: { name: string; title: string; pascal: string }, to: typeof from): string[] {
    const changed: string[] = [];
    // The three casings are disjoint — snake has underscores, title has spaces,
    // pascal has neither — so no replacement can consume another's match.
    const replacements: [RegExp, string][] = [
        [new RegExp(escapeRegExp(from.name), "g"), to.name],
        [new RegExp(escapeRegExp(from.pascal), "g"), to.pascal],
        [new RegExp(escapeRegExp(from.title), "g"), to.title],
    ];

    for (const path of walk(projectRoot)) {
        const original = readTextFile(path);
        if (original === undefined) continue;

        let next = original;
        for (const [pattern, value] of replacements) next = next.replace(pattern, value);
        if (next === original) continue;

        writeFileSync(path, next);
        changed.push(path.slice(projectRoot.length + 1));
    }
    return changed;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Only replace the README while it is still visibly the template's. */
function rewriteReadme(name: string, title: string): boolean {
    const path = join(projectRoot, "README.md");
    if (!existsSync(path)) return false;
    if (!readFileSync(path, "utf8").includes("a Dota 2 custom game template")) return false;

    writeFileSync(
        path,
        `# ${title}

A Dota 2 custom game written in TypeScript, compiled to Lua with
TypeScriptToLua. Scaffolded from [dota2-claude-playbook][playbook].

[playbook]: https://github.com/carloslibardo/dota2-claude-playbook

\`\`\`bash
bun install     # dependencies only — never touches your Dota install
bun run build   # TypeScript -> Lua, and panorama TypeScript -> JS
bun run test    # unit tests. No Dota required, works on macOS and Linux
\`\`\`

With Dota 2 installed, one more step wires the addon into it:

\`\`\`bash
bun run link    # moves game/ and content/ into dota_addons/${name} (symlinked back)
bun run launch  # opens Dota 2 with this addon. Workshop Tools need Windows
bun run unlink  # reverses the link
\`\`\`

## The one step you cannot script

You need a \`.vmap\`. Maps are made in Hammer, which is Windows-only and has no
command-line "new map" path. See \`content/maps/README.md\`.

## Where things are

| Path | What |
|------|------|
| \`src/vscripts/\` | Game logic. TS -> \`game/scripts/vscripts/*.lua\` |
| \`src/vscripts/lib/\` | Pure helpers, unit-tested in \`lib/__tests__/\` |
| \`src/vscripts/abilities/\` | One TypeScript class per ability |
| \`src/panorama/\` | UI TS -> \`content/panorama/scripts/custom_game/\` |
| \`game/\`, \`content/\` | KV data, layouts, maps. Compiled output is gitignored |
| \`docs/specs/\` | One directory per feature: spec + plan + marker contract |
| \`.claude/skills/\` | The skills an agent should reach for. Triggers in \`CLAUDE.md\` |

\`CLAUDE.md\` holds the architecture invariants — the engine failures that are
silent. Read it before writing anything, and add to it every time this engine
surprises you.
`,
    );
    return true;
}

/** The template tells you to personalize CLAUDE.md; once you have, stop saying so. */
function tidyClaudeMd(): void {
    const path = join(projectRoot, "CLAUDE.md");
    if (!existsSync(path)) return;
    const original = readFileSync(path, "utf8");
    const next = original.replace(
        /Replace the "[^"]+" specifics with your\n> own; keep the \*\*Architecture invariants\*\* section and add to it\./,
        "Keep the **Architecture invariants** section\n> and add to it.",
    );
    if (next !== original) writeFileSync(path, next);
}

function run(command: string, args: string[]): boolean {
    console.log(`\n$ ${command} ${args.join(" ")}`);
    return spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" }).status === 0;
}

async function promptForName(): Promise<string> {
    if (!process.stdin.isTTY) {
        throw new Error("Usage: bun run init <addon_name> [--title \"Display Name\"] [--no-verify]");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question("Addon name (lowercase, digits, underscores — e.g. my_game): ")).trim();
    } finally {
        rl.close();
    }
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
};

(async () => {
    const positional = argv.filter(arg => !arg.startsWith("--") && arg !== option("--title"));
    const name = positional[0] ?? (await promptForName());

    if (!ADDON_NAME.test(name)) {
        throw new Error(
            `'${name}' is not a usable addon name.\n` +
                "It must start with a letter and contain only lowercase letters, digits, and\n" +
                "underscores — the engine derives the dota_addons directory from it.",
        );
    }

    const from = { name: readAddonName(), title: "", pascal: "" };
    from.title = readAddonTitle(titleize(from.name));
    from.pascal = pascalize(from.name);
    const to = { name, title: option("--title") ?? titleize(name), pascal: pascalize(name) };

    if (from.name === to.name && from.title === to.title) {
        console.log(`Already named '${to.name}' — nothing to rename.`);
    } else {
        const changed = renameTokens(from, to);
        rewriteReadme(to.name, to.title);
        tidyClaudeMd();
        console.log(`Renamed '${from.name}' -> '${to.name}' across ${changed.length} files:`);
        for (const path of changed) console.log(`  ${path}`);
    }

    // The map filename is derived from the addon name and cannot be generated —
    // say so now rather than at the first confusing launch.
    const mapPath = join(projectRoot, "content", "maps", `${to.name}.vmap`);
    const hasMap = existsSync(mapPath);

    if (flag("--no-verify")) {
        console.log("\nSkipped verification (--no-verify).");
    } else {
        const installed = existsSync(join(projectRoot, "node_modules"));
        const steps: [string, string[]][] = [
            ...(installed ? [] : ([["bun", ["install"]]] as [string, string[]][])),
            ["bun", ["run", "build"]],
            ["bun", ["run", "test"]],
        ];
        for (const [command, args] of steps) {
            if (!run(command, args)) {
                throw new Error(`\n'${command} ${args.join(" ")}' failed. Fix that before building on top of it.`);
            }
        }
        console.log("\nBuild and tests green.");
    }

    console.log(
        [
            "",
            `${to.title} is ready.`,
            "",
            "Next:",
            "  1. git init && git add -A && git commit -m \"chore: scaffold from dota2-claude-playbook\"",
            "  2. Read CLAUDE.md — the Architecture invariants are the engine failures that are silent.",
            "  3. Start your first feature with the /sdd-feature skill: spec -> plan -> marker",
            "     contract -> implement -> evidence -> landmine. `/ability-modifier-patterns`",
            "     before you write the ability itself, `/landmine-check` before you commit.",
            hasMap
                ? "  4. `bun run link && bun run launch` to open it in Dota."
                : `  4. Make a map: Hammer, saved as content/maps/${to.name}.vmap (content/maps/README.md).`,
            "",
        ].join("\n"),
    );
})().catch((error: Error) => {
    console.error(error.message ?? error);
    process.exit(1);
});
