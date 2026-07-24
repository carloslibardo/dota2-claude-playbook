const assert = require("assert");
const fs = require("fs-extra");
const path = require("path");
const { getAddonName, getDotaPath } = require("./utils");

// Linking is OPT-IN. This script runs as `postinstall`, and the linking step
// MOVES `game/` and `content/` out of the project into `dota_addons/`, leaving
// symlinks behind. That is the right end state for developing an addon, and a
// genuinely surprising thing for `bun install` to do to someone who is still
// evaluating the template — so `bun install` only reports what it found.
// `bun run link` is the command that mutates anything.

const LINKED_DIRS = ["game", "content"];

const projectRoot = path.resolve(__dirname, "..");

/** Where `<addon>/game` and `<addon>/content` live inside the Dota install. */
const targetFor = (dotaPath, directoryName) =>
    path.join(dotaPath, directoryName, "dota_addons", getAddonName());

const isLinkTo = (sourcePath, targetPath) =>
    fs.existsSync(sourcePath) &&
    fs.lstatSync(sourcePath).isSymbolicLink() &&
    fs.realpathSync(sourcePath) === fs.realpathSync(targetPath);

/**
 * Validate every directory before moving any of them. Checking as we go can
 * leave a half-linked project — `game/` inside Dota, `content/` still here —
 * which nothing else in the toolchain knows how to recover from.
 */
function planLink(dotaPath) {
    const plan = [];
    for (const directoryName of LINKED_DIRS) {
        const sourcePath = path.join(projectRoot, directoryName);
        const targetPath = targetFor(dotaPath, directoryName);
        const targetRoot = path.dirname(targetPath);

        assert(fs.existsSync(sourcePath), `Could not find '${sourcePath}'`);
        assert(fs.existsSync(targetRoot), `Could not find '${targetRoot}'`);

        if (fs.existsSync(targetPath)) {
            if (isLinkTo(sourcePath, targetPath)) {
                plan.push({ sourcePath, targetPath, action: "skip" });
                continue;
            }
            throw new Error(
                `'${targetPath}' already exists and is not this project.\n` +
                    `Another copy of an addon named '${getAddonName()}' is installed there.\n` +
                    `Give this project a unique name with \`bun run init <name>\`, or remove that directory.`,
            );
        }

        plan.push({ sourcePath, targetPath, action: "link" });
    }
    return plan;
}

function link(dotaPath) {
    for (const { sourcePath, targetPath, action } of planLink(dotaPath)) {
        if (action === "skip") {
            console.log(`Already linked: ${sourcePath}`);
            continue;
        }
        fs.moveSync(sourcePath, targetPath);
        fs.symlinkSync(targetPath, sourcePath, "junction");
        console.log(`Linked ${sourcePath} <==> ${targetPath}`);
    }
}

function unlink(dotaPath) {
    for (const directoryName of LINKED_DIRS) {
        const sourcePath = path.join(projectRoot, directoryName);
        const targetPath = targetFor(dotaPath, directoryName);

        if (!fs.existsSync(targetPath) || !isLinkTo(sourcePath, targetPath)) {
            console.log(`Not linked, nothing to undo: ${sourcePath}`);
            continue;
        }

        fs.removeSync(sourcePath); // the symlink, not what it points at
        fs.moveSync(targetPath, sourcePath);
        console.log(`Unlinked ${targetPath} ==> ${sourcePath}`);
    }
}

function reportStatus(dotaPath) {
    for (const directoryName of LINKED_DIRS) {
        const sourcePath = path.join(projectRoot, directoryName);
        const linked = isLinkTo(sourcePath, targetFor(dotaPath, directoryName));
        console.log(`  ${directoryName}/  ${linked ? "linked" : "not linked"}`);
    }
}

(async () => {
    const mode = process.argv.includes("--link")
        ? "link"
        : process.argv.includes("--unlink")
          ? "unlink"
          : "report";

    const dotaPath = await getDotaPath();

    if (dotaPath === undefined) {
        if (mode === "report") {
            // The CI path, and every machine without Dota. Everything except
            // `bun run launch` works from here.
            console.log("No Dota 2 installation found — nothing to link. Build and tests run anyway.");
            return;
        }
        throw new Error(
            "No Dota 2 installation found, so there is nothing to link into.\n" +
                "Install Dota 2 (and the Workshop Tools) first, or skip this step —\n" +
                "`bun run build` and `bun run test` do not need it.",
        );
    }

    if (mode === "link") return link(dotaPath);
    if (mode === "unlink") return unlink(dotaPath);

    console.log(`Dota 2 found: ${dotaPath}`);
    reportStatus(dotaPath);
    console.log(
        `Addon linking is opt-in and this command changed nothing.\n` +
            `Run \`bun run link\` to move game/ and content/ into dota_addons/${getAddonName()}\n` +
            `(symlinked back here) — that is what \`bun run launch\` needs. \`bun run unlink\` reverses it.`,
    );
})().catch(error => {
    console.error(error.message ?? error);
    process.exit(1);
});
