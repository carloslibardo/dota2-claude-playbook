// The engine can load ability/modifier scripts directly (KV ScriptFile)
// without going through addon_game_mode — make sure the shim is in place
// before any error handler here runs on retail macOS.
import "./debugPolyfill";

export interface BaseAbility extends CDOTA_Ability_Lua {}
export class BaseAbility {}

export interface BaseItem extends CDOTA_Item_Lua {}
export class BaseItem {}

export interface BaseModifier extends CDOTA_Modifier_Lua {}
export class BaseModifier {
    public static apply<T extends typeof BaseModifier>(
        this: T,
        target: CDOTA_BaseNPC,
        caster?: CDOTA_BaseNPC,
        ability?: CDOTABaseAbility,
        modifierTable?: object,
    ): InstanceType<T> {
        return target.AddNewModifier(caster, ability, this.name, modifierTable) as any;
    }
}

export interface BaseModifierMotionHorizontal extends CDOTA_Modifier_Lua_Horizontal_Motion {}
export class BaseModifierMotionHorizontal extends BaseModifier {}

export interface BaseModifierMotionVertical extends CDOTA_Modifier_Lua_Vertical_Motion {}
export class BaseModifierMotionVertical extends BaseModifier {}

export interface BaseModifierMotionBoth extends CDOTA_Modifier_Lua_Motion_Both {}
export class BaseModifierMotionBoth extends BaseModifier {}

// Add standard base classes to prototype chain to make `super.*` work as `self.BaseClass.*`
setmetatable(BaseAbility.prototype, { __index: CDOTA_Ability_Lua ?? C_DOTA_Ability_Lua });
setmetatable(BaseItem.prototype, { __index: CDOTA_Item_Lua ?? C_DOTA_Item_Lua });
setmetatable(BaseModifier.prototype, { __index: CDOTA_Modifier_Lua ?? CDOTA_Modifier_Lua });

export const registerAbility = (name?: string) => (ability: new () => CDOTA_Ability_Lua | CDOTA_Item_Lua, context: ClassDecoratorContext) => {
    if (name !== undefined) {
        // @ts-ignore
        ability.name = name;
    } if (context.name) {
        name = context.name;   
    }else {
        throw "Unable to determine name of this ability class!";
    }

    const [env] = getFileScope();

    env[name] = {};

    toDotaClassInstance(env[name], ability);

    const originalSpawn = (env[name] as CDOTA_Ability_Lua).Spawn;
    env[name].Spawn = function () {
        this.____constructor();
        if (originalSpawn) {
            originalSpawn.call(this);
        }
    };
};

export const registerModifier = (name?: string) => (modifier: new () => CDOTA_Modifier_Lua, context: ClassDecoratorContext) => {
    if (name !== undefined) {
        // @ts-ignore
        modifier.name = name;
    } if (context.name) {
        name = context.name;   
    }else {
        throw "Unable to determine name of this modifier class!";
    }

    const [env, source] = getFileScope();
    // No `debug` lib (retail macOS) → source unknowable; every modifier here
    // lives in a file named exactly after its class, so derive the path.
    const [fileName] =
        source === "unknown"
            ? [`modifiers/${name}`]
            : string.gsub(source, ".*scripts[\\/]vscripts[\\/]", "");

    env[name] = {};

    toDotaClassInstance(env[name], modifier);

    const originalOnCreated = (env[name] as CDOTA_Modifier_Lua).OnCreated;
    env[name].OnCreated = function (parameters: any) {
        this.____constructor();
        if (originalOnCreated !== undefined) {
            originalOnCreated.call(this, parameters);
        }
    };

    let type = LuaModifierMotionType.NONE;
    let base = (modifier as any).____super;
    while (base) {
        if (base === BaseModifierMotionBoth) {
            type = LuaModifierMotionType.BOTH;
            break;
        } else if (base === BaseModifierMotionHorizontal) {
            type = LuaModifierMotionType.HORIZONTAL;
            break;
        } else if (base === BaseModifierMotionVertical) {
            type = LuaModifierMotionType.VERTICAL;
            break;
        }

        base = base.____super;
    }

    LinkLuaModifier(name, fileName, type);
};

/**
 * Use to expose top-level functions in entity scripts.
 * Usage: registerEntityFunction("OnStartTouch", (trigger: TriggerStartTouchEvent) => { <your code here> });
 */
export function registerEntityFunction(name: string, f: (...args: any[]) => any) {
    const [env] = getFileScope();
    env[name] = function (this: void, ...args: any[]) {
        f(...args);
    };
}

function clearTable(table: object) {
    for (const key in table) {
        delete (table as any)[key];
    }
}

function getFileScope(): [any, string] {
    // Check getinfo specifically: lib/debugPolyfill.ts installs a partial
    // `debug` (traceback only) on retail macOS where the real lib is absent.
    if (debug !== undefined && debug.getinfo !== undefined) {
        let level = 1;
        while (true) {
            const info = debug.getinfo(level, "S");
            if (info && info.what === "main") {
                return [getfenv(level), info.source!];
            }

            level += 1;
        }
    }
    // The retail macOS client ships Lua WITHOUT the `debug` library (tools
    // mode and Windows keep it), so debug.getinfo crashes there — seen live
    // 2026-07-05: every ability/modifier registration died at load, taking
    // the whole addon with it. Fallback: walk the stack with pcall(getfenv).
    // A sandboxed file scope is the deepest env that isn't _G; when scripts
    // run unsandboxed every frame's env IS _G and _G is the right answer.
    // Source is unknowable without `debug` — registerModifier falls back to
    // the name==filename convention instead.
    let level = 2;
    let candidate: any = undefined;
    while (true) {
        const [ok, env] = pcall(() => getfenv(level + 1));
        if (!ok) break;
        if (env !== _G) candidate = env;
        level += 1;
    }
    return [candidate ?? _G, "unknown"];
}

function toDotaClassInstance(instance: any, table: new () => any) {
    let { prototype } = table;
    while (prototype) {
        for (const key in prototype) {
            // Using hasOwnProperty to ignore methods from metatable added by ExtendInstance
            // https://github.com/SteamDatabase/GameTracking-Dota2/blob/7edcaa294bdcf493df0846f8bbcd4d47a5c3bd57/game/core/scripts/vscripts/init.lua#L195
            if (!instance.hasOwnProperty(key)) {
                instance[key] = prototype[key];
            }
        }

        prototype = getmetatable(prototype);
    }
}
