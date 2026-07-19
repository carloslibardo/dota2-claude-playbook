# 8. Publishing, and its ceiling

Everything up to this point automates cleanly. This chapter is where it stops,
and saying so plainly is half the value.

**Valve ships no headless or command-line publish for Dota 2 custom games.**
Only the in-tool GUI *Publish* button drives the full flow. That is the ceiling.
No amount of scripting removes it, and pretending otherwise costs you a day
before you find out.

## What "publish" actually is

Two steps, both performed by the Workshop Tools:

1. **Cook.** `resourcecompiler` turns your `content/dota_addons/<addon>` sources
   — maps, materials, particles, Panorama — into shipped form: `.vpk` archives
   and compiled `.v*_c` assets under `game/dota_addons/<addon>`.
2. **Upload.** Push the cooked addon to Steam UGC under a Workshop item ID.

Cook is scriptable. Upload is scriptable *for updates*, using a community path
Valve does not document. Creating the item in the first place is not.

## Prerequisites

Windows only, and there is no way around that either.

- Dota 2 **plus the Workshop Tools** — a separate, multi-gigabyte download on
  the beta branch.
- Steam logged in on that machine, with Steam Guard satisfied.
- The repo built: `bun install && bun run build`.

## Bake the map first

Compiled maps (`.vmap_c`, `.vpk`) are never committed — they are large, binary,
machine-generated build artifacts.

Which means: **run your map build before publishing**, or you will cook whatever
`.vmap` happens to be sitting in `content/maps/` on that machine. In a project
where terrain is generated, that is often the flat pre-terrain placeholder, and
you will ship it without noticing until someone loads the game.

This is the same family as landmines L9 and L10 — a gap between what you edited
and what is actually there — with the highest stakes, because the result is
public.

## First publish: manual, unavoidable

1. `bun run launch` → Dota opens with `-tools -addon <your_addon>`.
2. Tools menu → **Asset Publisher**, or the custom-game **Publish** flow.
3. Select your addon. Fill in title, description, preview image, visibility.
4. Accept the Workshop Legal Agreement.
5. **Publish.** Steam creates the item and returns a **published file ID**.
6. Record that ID — in your `.vdf` file and wherever your scripts read config
   from. It is what unlocks scripted updates.

Steps 3 and 4 are why this cannot be automated. A legal agreement acceptance and
a first-party content submission are deliberately human actions, and that is a
reasonable design decision on Valve's part even when it is inconvenient.

## Updates: semi-automatable

Once the item ID exists, updating it can be scripted:

```powershell
pwsh scripts/publish.ps1 -WorkshopId 1234567890 -SteamUser myaccount
```

Which does: `bun run build` → `resourcecompiler` cook → `steamcmd
+workshop_build_item <vdf>`.

The `.vdf` is a small Steam manifest naming the content folder, preview image,
and change note. Scripts typically resolve a template — substituting
`__CONTENT_FOLDER__`, `__PREVIEW_FILE__`, and `__CHANGENOTE__` (from
`git rev-parse --short HEAD`) — into a temp file, so the committed template
never carries machine-specific paths.

> **One honest caveat.** The `steamcmd` upload path for Dota custom games is
> **community-validated, not Valve-documented**. It works, people rely on it,
> and it could change. Validate one manual run before you trust it in a
> pipeline, and if it misbehaves, fall back to the GUI button — the build and
> cook steps the script performs are still useful on their own.

## Tag → release: self-hosted runners only

`git push --tags` cannot publish from a GitHub-hosted runner. There is no Dota,
no Workshop Tools, and no Steam session there, and there is no way to provide
them.

To wire a `v*` tag to a release you need a **self-hosted GitHub Actions runner
on the Windows machine** that has the tools and a persistent Steam login.

The template ships that workflow, deliberately **disabled**:

```yaml
jobs:
  publish:
    if: false # flip to true once a self-hosted dota-tools runner is registered
    runs-on: [self-hosted, windows, dota-tools]
```

Shipping it disabled with a comment explaining why is better than not shipping
it: the next person gets a working starting point *and* an accurate picture of
what it requires, instead of discovering both by trying.

To enable it:

1. Do the first publish via the GUI, to mint the item ID.
2. Register a self-hosted runner on the Windows box, labelled
   `[self-hosted, windows, dota-tools]`.
3. Add repository secrets: `WORKSHOP_ID`, `STEAM_USER`. That account's Steam
   session must already be Steam-Guard-approved on the runner machine.
4. Run `publish.ps1` manually, successfully, at least once.
5. Then flip `if:` to true.

Step 4 before step 5 is not bureaucracy. A publish pipeline that has never
succeeded by hand will fail in a way you cannot debug from a runner log.

## The automation table

| Step | Automated? | Where |
|------|-----------|-------|
| Build TS→Lua + Panorama | ✅ | `bun run build`, CI on every push |
| Typecheck both projects | ✅ | CI on every push |
| Unit tests | ✅ | vitest, CI on every push |
| Headless playtest + evidence | ✅ | The VM rig ([chapter 6](06-autonomous-vm-rig.md)) |
| Map cook + addon assembly | ⚠️ scriptable | `resourcecompiler`, Windows only |
| **First Workshop publish** | ❌ **manual** | Workshop Tools GUI |
| Subsequent updates | ⚠️ self-hosted only | `publish.ps1` / `release.yml` |

Ship a table like this in your own repo. Setting correct expectations is the
whole point: the difference between "publishing is manual" and "publishing
mysteriously does not work" is one honest paragraph written before anyone needs
it.

## What this means for how you work

The ceiling shapes the process above it. Because the last step is manual and
public, everything before it has to be trustworthy — you cannot iterate your way
out of a bad Workshop release the way you can with a web deploy.

Which is the argument for the quality gate in
[chapter 6](06-autonomous-vm-rig.md): if the final step is a human clicking a
button, the thing that button ships should already have been proven by a run
that cast every ability, bought every item, and recorded itself doing it.

Automate up to the ceiling. Be loud about where it is.
