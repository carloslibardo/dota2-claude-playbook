# 8. Publishing, and its ceiling

Everything up to this point automates cleanly. This chapter is where it stops —
and the interesting part is that it stops somewhere other than where we spent
most of the project believing it stopped.

## What "publish" actually is

Two steps:

1. **Cook.** `resourcecompiler` turns your `content/dota_addons/<addon>` sources
   — maps, materials, particles, Panorama — into shipped form: `.vpk` archives
   and compiled `.v*_c` assets under `game/dota_addons/<addon>`.
2. **Upload.** Push the cooked addon to Steam UGC under a Workshop item ID.

Both are scriptable, including the first upload that creates the item — which
is not what the documentation says, and not what this chapter said until we
tried it. See below.

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

## First publish: scriptable, with a human step left

Valve's documentation — and every community writeup we found, including the
first version of this chapter — says the first publish must go through the
Workshop Tools GUI, because only the GUI can *create* an item. We believed that
and wrote it down as the ceiling.

It is not true. A `.vdf` whose `publishedfileid` is `0` handed to
`steamcmd +workshop_build_item` **creates** the item and returns its ID, with no
GUI anywhere in the loop:

```
"workshopitem"
{
    "appid"           "570"
    "publishedfileid" "0"          // 0 = create a new item; replace with the
                                   // returned ID so later runs UPDATE it
    "contentfolder"   "<abs path to cooked content>"
    "previewfile"     "<abs path to preview image>"
    "visibility"      "2"          // 0 public · 1 friends · 2 hidden · 3 unlisted
    "title"           "<title>"
    "changenote"      "<note>"
}
```

```powershell
steamcmd +login <your-account> +workshop_build_item C:\path\to\<addon>.vdf +quit
```

The whole path — build → cook with `resourcecompiler` → resolve the `.vdf`
template → `steamcmd` — runs headless over SSH, on the same VM that does the
playtesting in [chapter 6](06-autonomous-vm-rig.md). Record the returned ID in
your `.vdf` and wherever your scripts read config from; every later run updates
that item instead of creating another one.

We found this out the way this playbook recommends finding anything out: by
running it, after a year's worth of documentation said not to bother.

### What is actually still manual

This is the real ceiling, and it is smaller and more sensible than the one we
thought we had:

- **A Steam-Guard-approved session** on whatever machine runs `steamcmd`. Do it
  once, by hand, on a box that persists — the same one-time cost as the test
  rig's. After that a cached login works non-interactively over SSH.
- **The Workshop Legal Agreement**, confirmed on steamcommunity.com under the
  owning account. An upload from an account that has never accepted it will not
  produce a usable item.
- **The visibility flip.** Create the item hidden (`"visibility" "2"`), verify
  it, and only then make it public, deliberately. Treat this as a feature: you
  do not want a first upload landing in front of an audience.

None of those are things you would want automated anyway. A legal agreement
acceptance is meant to be a human action, and a first public release should cost
one deliberate click.

## Updates: the same command

Once the item ID exists, updating it is the identical call with the ID filled
in:

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

> **One honest caveat, and it now covers the whole path.** The `steamcmd` route
> for Dota custom games is **community-validated, not Valve-documented** — that
> was true when it was only the update path, and it is still true now that it is
> also the creation path. It works, people rely on it, and Valve could change it
> without telling anyone. Validate one run by hand before you wire it into a
> pipeline. The GUI *Publish* button remains a working fallback if it misbehaves;
> it is just no longer the only way in.

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

1. Create the item once — `steamcmd +workshop_build_item` with
   `publishedfileid 0`, or the GUI — and record the returned ID.
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
| **First Workshop publish** | ⚠️ **scriptable** | `steamcmd +workshop_build_item`, `publishedfileid 0` |
| Legal agreement + visibility flip | ❌ **manual** | steamcommunity.com, owning account |
| Subsequent updates | ⚠️ self-hosted only | `publish.ps1` / `release.yml` |

Ship a table like this in your own repo. Setting correct expectations is the
whole point: the difference between "publishing is manual" and "publishing
mysteriously does not work" is one honest paragraph written before anyone needs
it.

## A note on the correction

This chapter used to say the opposite of what it now says, confidently, for two
pages. It said the first publish was a GUI button and no amount of scripting
would remove it — for exactly the reason everybody else says that: the
documentation says so, the community repeats it, and nobody in the loop had
tried the other thing.

That is landmine-shaped, and the landmine is one this playbook already told you
about. [Chapter 1](01-why-this-is-hard.md) argues that when documentation and a
live run disagree, the live run wins, and that the right next move is a probe
rather than a fifth theory. We had not run the probe. We had inherited a claim,
believed it because it was plausible and universally repeated, and written it
down as a law.

The correction is left visible rather than quietly edited in, because a playbook
whose thesis is *prove it, don't claim it* does not get to launder its own
unproven claims. If you are reading this and wondering which of the other
assertions here are inherited rather than tested — good. That is the correct
posture, and the answer is in whether each one carries a live run behind it.

## What this means for how you work

The ceiling shapes the process above it. The last step before an audience sees
your game is still a deliberate human action — the visibility flip — and
everything before it has to be trustworthy, because you cannot iterate your way
out of a bad Workshop release the way you can with a web deploy.

Which is the argument for the quality gate in
[chapter 6](06-autonomous-vm-rig.md): if the final step is a human making one
irreversible-feeling decision, the thing being released should already have been
proven by a run that cast every ability, bought every item, and recorded itself
doing it.

Automate up to the ceiling. Be loud about where it is — and go check
occasionally whether it is still there.
