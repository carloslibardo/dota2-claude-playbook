const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getAddonName, getDotaPath } = require("./utils");

// The Dota 2 Workshop Tools (`-tools`: Hammer, the asset browser, the
// resourcecompiler) are Windows-only. The macOS and Linux clients can run a
// custom game whose map is already cooked, but they cannot cook one and they
// cannot open the tools. Launching with `-tools` there gets you a client that
// ignores the flag at best, so this script refuses instead of pretending.

const BINARIES = {
    win32: { dir: "win64", exe: "dota2.exe" },
    darwin: { dir: "osx64", exe: path.join("dota2.app", "Contents", "MacOS", "dota2") },
    linux: { dir: "linux64", exe: "dota2.sh" },
};

(async () => {
    const dotaPath = await getDotaPath();
    if (dotaPath === undefined) {
        throw new Error(
            "No Dota 2 installation found — nothing to launch.\n" +
                "`bun run build` and `bun run test` do not need one; only this command does.",
        );
    }

    const binary = BINARIES[process.platform];
    if (binary === undefined) {
        throw new Error(`No known Dota 2 binary layout for platform '${process.platform}'.`);
    }

    const binDir = path.join(dotaPath, "game", "bin", binary.dir);
    const exePath = path.join(binDir, binary.exe);
    if (!fs.existsSync(exePath)) {
        throw new Error(
            `Could not find the Dota 2 binary at '${exePath}'.\n` +
                "Steam installs the client per-platform; check that Dota 2 is fully downloaded.",
        );
    }

    // -tools opens Workshop Tools; without it you get the ordinary client, which
    // can still load an already-cooked custom map.
    const tools = process.platform === "win32";
    if (!tools) {
        console.log(
            `Workshop Tools are Windows-only — launching the plain client instead.\n` +
                `Hammer, the resourcecompiler, and the e2e rig all need a Windows machine\n` +
                `(see playbook chapter 6 for the VM that exists for exactly this reason).`,
        );
    }

    // Add your own arguments here. `+dota_launch_custom_game <addon> <map>`
    // boots straight into the game instead of stopping at the main menu.
    const args = ["-novid", ...(tools ? ["-tools"] : []), "-addon", getAddonName()];
    const child = spawn(exePath, args, { detached: true, stdio: "ignore", cwd: binDir });
    child.on("error", error => {
        console.error(`Failed to start Dota 2: ${error.message}`);
        process.exit(1);
    });
    child.unref();
})().catch(error => {
    console.error(error.message ?? error);
    process.exit(1);
});
