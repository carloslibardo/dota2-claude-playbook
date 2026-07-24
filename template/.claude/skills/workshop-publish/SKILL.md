---
name: workshop-publish
description: Use when publishing or updating the game on the Steam Workshop — the cook-then-upload path, the steamcmd recipe that creates the item headlessly, and the three things that genuinely still need a human
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
    "previewfile"     "<abs path to preview image>"
    "visibility"      "2"          // 0 public · 1 friends · 2 hidden · 3 unlisted
    "title"           "<title>"
    "changenote"      "<note>"
}
```

```powershell
steamcmd +login <account> +workshop_build_item C:\path\to\<addon>.vdf +quit
```

**Record the returned ID** in the `.vdf` and wherever your scripts read config.
A second run with `0` creates a *second* item.

Start at `visibility 2` (hidden). Flip to public only after the release gate
below has passed on the version you actually uploaded.

## What is still manual

- A **Steam-Guard-approved session** on the machine that runs `steamcmd`. One
  time, by hand, on a box that persists; after that a cached login works
  non-interactively over SSH.
- The **Workshop Legal Agreement**, accepted on steamcommunity.com by the owning
  account. An upload from an account that never accepted it does not take.
- The **store presentation** — preview image, description, tags.

## Release gate before you flip it public

- [ ] Map rebuilt in this run, not inherited from the box
- [ ] Cook produced fresh `.v*_c` output (check timestamps, not the exit code)
- [ ] The quality-gate rig mode passed on this commit: every ability and every
      item produces an observable effect (`/vm-testrig`, `/evidence-gate`)
- [ ] Frames reviewed for anything visual that changed
- [ ] `publishedfileid` in the `.vdf` is the real item, not `0`
- [ ] The uploaded build is the commit you think it is — tag it

`.github/workflows/release.yml` in this template is the skeleton, disabled by
default: it targets a self-hosted Windows runner with the tools, and expects a
`scripts/publish.ps1` that you write around the recipe above. Verify it manually
once before enabling it.
