---
name: workshop-publish
description: Use when publishing or updating the game on the Steam Workshop — the cook-then-upload path, the steamcmd recipe that creates the item headlessly, and the four things that genuinely still need a human (including the one GUI pass that tags the item into the Arcade)
---

# Workshop publish

Publishing is two steps, both scriptable, on a Windows machine with the
Workshop Tools. The reasoning and the correction of the widely-repeated claim
that the first publish must go through the GUI is the playbook's chapter 8.

1. **Cook.** `resourcecompiler` turns `content/dota_addons/<addon>` sources —
   maps, materials, particles, panorama — into `.vpk` archives and compiled
   `.v*_c` assets under `game/dota_addons/<addon>`.
2. **Upload.** Push the cooked addon to Steam UGC under a Workshop item ID.

## Prerequisites

- Windows. Dota 2 **plus Workshop Tools** (separate, multi-gigabyte, beta
  branch). No way around either.
- Steam logged in on that machine with Steam Guard satisfied.
- The repo built: `bun install && bun run build`.

## Bake the map first

Compiled maps are gitignored build artifacts. Publish without rebuilding and you
cook whatever `.vmap` happens to sit in `content/maps/` on that box — often a
placeholder — and ship it publicly without noticing. Same family as L9/L10, with
the highest stakes.

## The first publish creates the item, headlessly

A `.vdf` with `publishedfileid` `0` handed to `steamcmd +workshop_build_item`
**creates** the item and returns its ID. No GUI in the loop.

```
"workshopitem"
{
    "appid"           "570"
    "publishedfileid" "0"          // 0 = create. Replace with the returned ID
                                   // so every later run UPDATES that item
    "contentfolder"   "<abs path to cooked content>"
    "previewfile"     "<abs path to preview image>"   // CREATE only
    "visibility"      "2"          // 0 public · 1 friends · 2 hidden · 3 unlisted
    "title"           "<title>"
    "changenote"      "<note>"
}
```

```powershell
C:\steamcmd\steamcmd.exe +login <account> +workshop_build_item C:\path\to\<addon>.vdf +quit
```

- **Always call `steamcmd` by its FULL PATH.** It is not on `PATH`. A bare
  `steamcmd` silently no-ops **and the wrapper still reports `PUBLISH OK`** —
  a false success on the one step whose result is public. Verify a publish by
  the item's `timeupdated` on the Workshop page, never by the script's own
  "OK".
- **Record the returned ID** in the `.vdf` and wherever your scripts read
  config. A second run with `0` creates a *second* item.
- **`previewfile` and `visibility` are honoured on create — and on update.**
  Leaving them in the update `.vdf` reverts whatever you changed on the item
  page since (including flipping a public item back to hidden). Once the item
  exists, omit both keys from the update path.
- Start at `visibility 2` (hidden). Flip to public only after the release gate
  below has passed on the version you actually uploaded.

## What is still manual

- A **Steam-Guard-approved session** on the machine that runs `steamcmd`. One
  time, by hand, on a box that persists; after that a cached login works
  non-interactively over SSH.
- The **Workshop Legal Agreement**, accepted on steamcommunity.com by the owning
  account. An upload from an account that never accepted it does not take.
- **One GUI republish to set the item's TAGS.** An item created headlessly has
  an empty tag set, and an untagged custom game is **invisible in the Arcade
  browse and search** — public, playable by direct link, findable by nobody.
  `steamcmd` has no tag argument; the Workshop web edit page and the
  published-file API will not set the Dota game tags either. One publish from
  the Workshop Tools publisher GUI does, and later `steamcmd` updates preserve
  the tags. **The automation ceiling is exactly one GUI pass per item, not
  zero** — budget it, and do not report a headless create as "published".
- The **store presentation** — preview image, description.

## Release gate before you flip it public

- [ ] Map rebuilt in this run, not inherited from the box
- [ ] Cook produced fresh `.v*_c` output (check timestamps, not the exit code)
- [ ] The quality-gate rig mode passed on this commit: every ability and every
      item produces an observable effect (`/vm-testrig`, `/evidence-gate`)
- [ ] Frames reviewed for anything visual that changed
- [ ] `publishedfileid` in the `.vdf` is the real item, not `0`
- [ ] `steamcmd` invoked by full path, and the item's `timeupdated` actually moved
- [ ] Tags set (once, via the GUI publisher) — or the game is unfindable in the Arcade
- [ ] The uploaded build is the commit you think it is — tag it

`.github/workflows/release.yml` in this template is the skeleton, disabled by
default: it targets a self-hosted Windows runner with the tools, and expects a
`scripts/publish.ps1` that you write around the recipe above. Verify it manually
once before enabling it.
