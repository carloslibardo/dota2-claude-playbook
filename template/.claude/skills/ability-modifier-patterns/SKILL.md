---
name: ability-modifier-patterns
description: Use when writing a new ability, item, or modifier — the TypeScript patterns that keep Dota abilities correct, leak-free, and balance-tunable from KV
---

# Ability and modifier patterns

## Abilities

- **One class per file**, `@registerAbility()` decorated, imported from
  `GameMode.ts` (side-effect import). The KV entry in
  `npc_abilities_custom.txt` and the class name must match exactly.
- **Numbers come from KV**, read with `this.GetSpecialValueFor("value_name")`
  — never hardcoded in TS. This is what makes balance a data change instead
  of a code change, and it keeps the spec's numbers table honest.
- **Projectile abilities:** `OnProjectileHit(target, location)` receives
  `undefined` target when the projectile reaches max distance — handle it.
  Guard `target.IsNull()` anyway: the target can die mid-flight.
- **Cast validation belongs in `CastFilterResult*`/`GetCastRange`/KV
  behavior flags**, not in `OnSpellStart` — by OnSpellStart the mana and
  cooldown are already spent.
- **Damage flows through one pipeline.** A skillshot game lives or dies on
  consistent hit rules; route every arrow through a single shared hit
  function (pipeline module) so lifesteal/armor/on-hit effects have exactly
  one integration point. Bypass it only deliberately (ults), with a comment.
- **Sounds/particles the ability uses must be precached** in the ability's
  `Precache(context)` or the GameMode's — un-precached particles render
  NOTHING, silently (landmine L3/L12).

## Modifiers

- `@registerModifier()`, one per file, imported (transitively) from the entry.
- **Never name a custom modifier after a stock kit's modifier on the hero you
  are re-kitting.** `modifier_pudge_rot` declared on Pudge resolves to the inert
  C++ built-in, not your Lua class: `HasModifier` returns **true**, the buff
  icon shows, and not one of your callbacks ever runs (landmine L26). The
  base-hero override model (`/new-hero-authoring`) puts you in this setup by
  default — the stock kit's modifier names are reserved by the engine forever.
  Use a distinguishing infix: `modifier_pw_pudge_rot`, `modifier_arena_rot`.
- **Declare intent explicitly, every time:**
  ```ts
  IsHidden() { return false; }
  IsPurgable() { return true; }
  RemoveOnDeath() { return true; }
  ```
  The defaults are rarely what you want and differ from what readers assume.
- **`DeclareFunctions()` minimal.** Every declared function is a hook the
  engine calls constantly; declare only what you implement.
- **Particle lifecycle is manual and leaks are real:**
  ```ts
  OnCreated() {
      if (!IsServer()) return;
      this.particle = ParticleManager.CreateParticle(FX, ParticleAttachment.ABSORIGIN_FOLLOW, this.GetParent());
  }
  OnDestroy() {
      if (this.particle !== undefined) {
          ParticleManager.DestroyParticle(this.particle, false);
          ParticleManager.ReleaseParticleIndex(this.particle);
      }
  }
  ```
  `DestroyParticle` without `ReleaseParticleIndex` leaks the index forever —
  the classic slow server-memory death across a long match.
- **A particle is networked only to clients connected the instant it is
  created** (landmine L27). World FX spawned at `Activate` or GameMode
  construction are created while the server sits in INIT, ~15 s before the
  first client connects: they render for NOBODY, silently, while every
  server-side log marker stays green. Create persistent world visuals at
  `GAME_IN_PROGRESS` and print a draw marker so the rig can prove the timing.
  Per-cast FX are fine — a cast implies a connected client.
- **Some vanilla particles never render under script CP driving, even
  precached** (landmine L28). `pudge_meathook.vpcf` and
  `rattletrap_hookshot.vpcf` need engine-internal state no script API provides;
  raw `SetParticleControl` and entity-anchored both fail SILENTLY. Verified
  CP0→CP1 renderers: `wisp_tether.vpcf`, `razor_static_link_beam.vpcf`,
  `batrider_flaming_lasso.vpcf`. **Never swap a tether particle blind** —
  frame-verify the replacement (`/evidence-gate`) before believing it.
- **Server/client split:** `OnCreated`/`OnDestroy` run on BOTH. Gate
  server-only work with `IsServer()`. Values needed client-side (for
  tooltips/bars) transfer via `OnCreated` kv arg or nettables, not by reading
  server state that isn't there.
- **Thinkers:** `StartIntervalThink(interval)` in `OnCreated` (server-gated);
  keep `OnIntervalThink` allocation-free (see /tstl-lua-gotchas). Interval
  ≥ 0.1 s unless you have a measured reason.
- **Stacking:** decide `IsMultiple`/stack counts deliberately; two copies of
  a modifier silently double aura-style effects.

## Motion-controller modifiers

Anything that moves a unit the unit did not order — hook drags, knockbacks,
pulls, leaps, tethers that reel in — is a motion controller, and it is a
**four-callback contract** (landmine L32). Implement all four; a partial
implementation is the shape that looks right and desyncs in play (casebook F8).

```ts
IsMotionController() { return true; }
GetMotionControllerPriority() { return ModifierMotionPriority.MEDIUM; }

OnCreated() {
    if (!IsServer()) return;
    // Declaring the motion type ALONE does nothing. You must claim the unit.
    if (!this.ApplyHorizontalMotionController(this.GetParent())) {
        this.Destroy();            // someone with higher priority owns it
        return;
    }
}
UpdateHorizontalMotion(unit, dt) { /* the actual per-frame movement */ }
OnHorizontalMotionInterrupted() { this.Destroy(); }   // displacement won
OnDestroy() {
    if (!IsServer()) return;
    this.GetParent().InterruptMotionControllers(true); // release the claim
}
```

- **`LuaModifierMotionType` on the registration + `IsMotionController()` are
  declarations, not activations.** Nothing moves until
  `ApplyHorizontalMotionController(parent)` succeeds — and it *returns a
  boolean*, so honour it.
- **`OnHorizontalMotionInterrupted` is not optional.** It fires when something
  else displaces the unit mid-drag: respawn, Force Staff, a second hook, a
  stronger controller. Skip it and the unit keeps being dragged by a controller
  nobody owns, or freezes in place for the rest of the match.
- **Release in `OnDestroy`,** on the server side, every exit path (duration
  expiry, purge, death, `Destroy()` above). An unreleased claim is the classic
  "hero can never move again" bug.
- Vertical motion is a separate, parallel contract
  (`ApplyVerticalMotionController` / `UpdateVerticalMotion` /
  `OnVerticalMotionInterrupted`) — an arc-hop needs both, wired independently.

## Shared bases over copy-paste

Two abilities differing only in numbers/particle = one base class + KV
deltas. Copy-paste ability files drift: a fix lands in one and not the other,
and nothing tells you. If you copy a file twice, extract the base.

## Definition of done for an ability

From /sdd-feature, specialized:
- [ ] KV entry + TS class + entry-file import + precache + localization tokens
      (`addon_english.txt`: name, description, notes) — all five, every time
- [ ] Numbers via `GetSpecialValueFor`, sourced in the spec
- [ ] Pure decision math (arcs, falloff, pierce rules) extracted to `lib/`
      with a vitest
- [ ] e2e marker or frame evidence that it fires, hits, and shows
