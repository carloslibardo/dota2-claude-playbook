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
- **Server/client split:** `OnCreated`/`OnDestroy` run on BOTH. Gate
  server-only work with `IsServer()`. Values needed client-side (for
  tooltips/bars) transfer via `OnCreated` kv arg or nettables, not by reading
  server state that isn't there.
- **Thinkers:** `StartIntervalThink(interval)` in `OnCreated` (server-gated);
  keep `OnIntervalThink` allocation-free (see /tstl-lua-gotchas). Interval
  ≥ 0.1 s unless you have a measured reason.
- **Stacking:** decide `IsMultiple`/stack counts deliberately; two copies of
  a modifier silently double aura-style effects.

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
