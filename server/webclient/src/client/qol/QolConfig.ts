// QoL settings registry + localStorage persistence ('rs-qol-v1').
//
// Single JSON blob in localStorage, written debounced, loaded at init.
// Unknown keys in the stored blob are preserved across saves (forward/backward
// compat when plugins come and go). Corrupt JSON falls back to defaults.
// Every `window`/`localStorage` touch is behind a `typeof` guard so this module
// is safe under the lite runner's dom-shim and any future headless import
// (ground rule 3 in docs/qol-features-plan.md).

/** Value domain of a setting. */
export type SettingValue = boolean | number | string;

/** Control kind rendered by the settings panel (C2). */
export type SettingType = 'boolean' | 'choice' | 'slider' | 'color' | 'keybind' | 'text';

/** Definition of one QoL setting, registered by its owning plugin. */
export interface SettingDef {
    /** Unique dotted key, e.g. 'menu.shiftDrop'. */
    key: string;
    /** Panel category: 'Menu', 'Skilling', 'Bank', 'Visuals', 'Overlays'. */
    section: string;
    /** Human-readable label for the panel row. */
    label: string;
    /** Control kind. */
    type: SettingType;
    /** Value used when nothing is stored. */
    default: boolean | number | string;
    /** choice: the options to cycle through. */
    choices?: string[];
    /** slider: lower bound. */
    min?: number;
    /** slider: upper bound. */
    max?: number;
    /** Panel tooltip. */
    tooltip?: string;
    /** Hide (and neutralize) this setting in bot builds. */
    hiddenInBotBuild?: boolean;
}

const STORAGE_KEY = 'rs-qol-v1';
const SAVE_DEBOUNCE_MS = 500;

/**
 * QoL setting registry with debounced localStorage persistence.
 */
export class QolConfig {
    private readonly registry: Map<string, SettingDef> = new Map();
    private readonly sectionOrder: string[] = [];
    private readonly values: Map<string, SettingValue> = new Map();
    private readonly listeners: Map<string, Array<() => void>> = new Map();
    /** Stored blob keys that no plugin has defined (v1: raw JSON values kept). */
    private readonly unknownKeys: Record<string, unknown> = {};
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private stored: Record<string, unknown> | null = null;

    /**
     * @param botBuild when true, settings flagged `hiddenInBotBuild` are omitted
     * from `defs()` so the panel (and bots inspecting it) never see them.
     */
    constructor(private readonly botBuild: boolean = false) {
        this.load();
        if (this.stored !== null) {
            // Everything read is "unknown" until a plugin `define()`s it; defined
            // keys drop out of the pool and onto the typed value map.
            for (const [key, value] of Object.entries(this.stored)) {
                this.unknownKeys[key] = value;
            }
        }
    }

    /** Register a setting. Existing stored values are applied; duplicates are ignored. */
    define(def: SettingDef): void {
        if (this.registry.has(def.key)) {
            return;
        }

        this.registry.set(def.key, def);
        delete this.unknownKeys[def.key];

        if (!this.sectionOrder.includes(def.section)) {
            this.sectionOrder.push(def.section);
        }

        const storedValue = this.coerce(def, this.stored?.[def.key]);
        this.values.set(def.key, storedValue !== null ? storedValue : def.default);
    }

    /** Current value coerced to boolean; unknown keys read as their default (false). */
    getBool(key: string): boolean {
        const value = this.values.get(key);
        return typeof value === 'boolean' ? value : this.booleanDefault(key);
    }

    /** Current value coerced to number; unknown keys read as 0. */
    getNum(key: string): number {
        const value = this.values.get(key);
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        if (typeof value === 'string') {
            const parsed: number = Number(value);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
            // Color settings persist as '#rrggbb' (settings-panel normalizeColor);
            // parse '#'-prefixed 3/6-hex so getNum-based plugins see panel-picked
            // colors instead of silently falling back to the default.
            const trimmed: string = value.trim();
            if (trimmed.startsWith('#') && (trimmed.length === 4 || trimmed.length === 7)) {
                let hex: string = trimmed.slice(1);
                if (hex.length === 3) {
                    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
                }
                const parsedHex: number = parseInt(hex, 16);
                if (!Number.isNaN(parsedHex)) {
                    return parsedHex;
                }
            }
        }
        const def = this.registry.get(key);
        return def !== undefined && typeof def.default === 'number' ? def.default : 0;
    }

    /** Current value coerced to string; unknown keys read as ''. */
    getStr(key: string): string {
        const value = this.values.get(key);
        if (typeof value === 'string') {
            return value;
        }
        if (value !== undefined) {
            return String(value);
        }
        const def = this.registry.get(key);
        return def !== undefined ? String(def.default) : '';
    }

    /** Update a setting; persists (debounced) and notifies `onChange` listeners. */
    set(key: string, value: boolean | number | string): void {
        const def = this.registry.get(key);
        if (def === undefined) {
            // Still record undeclared runtime writes so nothing silently vanishes.
            this.values.set(key, value);
            this.scheduleSave();
            return;
        }

        const coerced = this.coerce(def, value);
        this.values.set(key, coerced !== null ? coerced : def.default);
        this.scheduleSave();
        this.notify(key);
    }

    /** Subscribe to value changes of one key. Registration is one-shot (no unsubscribe). */
    onChange(key: string, cb: () => void): void {
        let list = this.listeners.get(key);
        if (list === undefined) {
            list = [];
            this.listeners.set(key, list);
        }
        list.push(cb);
    }

    /** Section names in registration order. */
    sections(): string[] {
        return this.sectionOrder.slice();
    }

    /** All definitions, or those of one section; bot-invisible defs filtered out. */
    defs(section?: string): SettingDef[] {
        const out: SettingDef[] = [];
        for (const def of this.registry.values()) {
            if (section !== undefined && def.section !== section) {
                continue;
            }
            if (def.hiddenInBotBuild && this.botBuild) {
                continue;
            }
            out.push(def);
        }
        return out;
    }

    /** JSON snapshot of all known + preserved-unknown settings. */
    exportJson(): string {
        const blob: Record<string, unknown> = { ...this.unknownKeys };
        for (const [key, value] of this.values) {
            blob[key] = value;
        }
        return JSON.stringify(blob);
    }

    /** Merge a JSON snapshot (see `exportJson`) into the config; bad JSON is ignored. */
    importJson(s: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(s);
        } catch (_e) {
            return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return;
        }

        const blob = parsed as Record<string, unknown>;
        for (const [key, value] of Object.entries(blob)) {
            const def = this.registry.get(key);
            if (def === undefined) {
                this.unknownKeys[key] = value;
                continue;
            }
            const coerced = this.coerce(def, value);
            if (coerced !== null) {
                this.values.set(key, coerced);
                this.notify(key);
            }
        }
        this.saveNow();
    }

    /** Restore every known setting to its default and persist. */
    resetAll(): void {
        for (const def of this.registry.values()) {
            this.values.set(def.key, def.default);
            this.notify(def.key);
        }
        this.saveNow();
    }

    /** Write the pending blob to storage without waiting out the debounce. */
    flush(): void {
        if (this.saveTimer !== null) {
            this.saveNow();
        }
    }

    // ---- internals ----

    private booleanDefault(key: string): boolean {
        const def = this.registry.get(key);
        return def !== undefined && typeof def.default === 'boolean' ? def.default : false;
    }

    /** Coerce a raw stored value to the def's type; returns null when unusable. */
    private coerce(def: SettingDef, raw: unknown): SettingValue | null {
        switch (def.type) {
            case 'boolean':
                if (typeof raw === 'boolean') {
                    return raw;
                }
                if (raw === 1 || raw === '1' || raw === 'true') {
                    return true;
                }
                if (raw === 0 || raw === '0' || raw === 'false') {
                    return false;
                }
                return null;
            case 'slider': {
                let value: number;
                if (typeof raw === 'number') {
                    value = raw;
                } else if (typeof raw === 'string' && raw.trim() !== '') {
                    value = Number(raw);
                    if (Number.isNaN(value)) {
                        return null;
                    }
                } else {
                    return null;
                }
                if (def.min !== undefined && value < def.min) {
                    value = def.min;
                }
                if (def.max !== undefined && value > def.max) {
                    value = def.max;
                }
                return value;
            }
            case 'choice':
                if (typeof raw === 'string' || typeof raw === 'number') {
                    return raw;
                }
                return null;
            default:
                // color / keybind / text: strings (colors '#rrggbb' or 0xrrggbb numbers).
                if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
                    return raw;
                }
                return null;
        }
    }

    private notify(key: string): void {
        const list = this.listeners.get(key);
        if (list === undefined) {
            return;
        }
        for (const cb of list) {
            try {
                cb();
            } catch (e) {
                console.warn(`[qol] onChange listener failed for '${key}'`, e);
            }
        }
    }

    private storageAvailable(): boolean {
        if (typeof window === 'undefined') {
            return false;
        }
        try {
            return window.localStorage !== null && window.localStorage !== undefined;
        } catch (_e) {
            return false;
        }
    }

    private load(): void {
        if (!this.storageAvailable()) {
            return;
        }
        let raw: string | null = null;
        try {
            raw = window.localStorage.getItem(STORAGE_KEY);
        } catch (_e) {
            // Safari private mode throws on access.
            return;
        }
        if (raw === null) {
            return;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.stored = parsed as Record<string, unknown>;
            }
        } catch (_e) {
            // Corrupt JSON -> defaults (and the next save rewrites the blob).
            this.stored = null;
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) {
            return;
        }
        if (typeof window === 'undefined') {
            return;
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
        }, SAVE_DEBOUNCE_MS);
    }

    private saveNow(): void {
        if (!this.storageAvailable()) {
            return;
        }
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            // exportJson() merges unknown keys back in, so they survive every save.
            window.localStorage.setItem(STORAGE_KEY, this.exportJson());
        } catch (_e) {
            // Quota or private-mode failure: values stay in memory.
        }
    }
}

export default QolConfig;
