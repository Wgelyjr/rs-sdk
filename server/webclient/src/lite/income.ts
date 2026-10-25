// In-process Varrock guard/knight pickpocket + West-bank supply runs.
//
//   cd server/webclient
//   bun src/lite/income.ts <bot>
//
// This is the single-bot adaptation of swarm.ts. Where swarm.ts runs N lite
// clients in one process and hands coins over by dropping them, a lone bot has
// no collector to hand to - so instead of drop/hoover it runs supply loops:
// bank its loot at the Varrock West bank (3185,3436), keeping
// a standing coin reserve, buy food at a Varrock general store
// (2613,3294) while the bag is light, and walk back. The pickpocket core is
// unchanged:
// the same BotStateCollector and ActionExecutor run against LiteClient on the
// game-tick callback, so an attempt costs the 2 ticks the engine actually needs
// rather than the ~2.0s a gateway round-trip costs through runner.ts + the SDK.
//
// Why it beats the SDK script: the SDK loop re-aims every pick through the
// gateway (a WebSocket RTT plus a full state broadcast), over-waits 4s after a
// stun, and treats a server-rejected op like a stun. Here a stun costs the 8
// ticks the engine actually applies, a rejection the server DID signal is caught
// via opFeedback and retried next tick, and the target is re-chosen (nearest
// pickpocketable guard/knight) every tick so the bot never sits on one busy paladin.

import { fileURLToPath } from 'node:url';
import { loginJitterMs } from './LoginBackoff.js';

import { OutdatedClientError } from './net/GameConnection.js';
import { startSession, type LiteSession, type SessionEnd } from './session.js';
import { BotStateCollector } from '#/bot/StateCollector.js';
import { ActionExecutor } from '#/bot/ActionExecutor.js';
import type { BotAction, BotWorldState } from '#/bot/types.js';
import type { Client } from '#/client/Client.js';
import type { LiteClient } from './LiteClient.js';

// Varrock guards & knights (2026-10-24 retarget): the old HOLD=true safe-stop
// assumed this bot was th1 — but while HOLD'd it never READ its skills, so
// "th1" was a default. Live read: Thieving 94. It is standing in central
// Varrock next to guards (thieving 40, 30 gp, stun 2 dmg) with knights
// (thieving 55, 50 gp + knight's pocket key, stun 3 dmg) nearby. Passive to
// pickpocketing, no death routes, banked gold is death-proof. Supply run
// banks at Varrock West (~35 tiles N).
// Varrock EAST bank square. NOT the west side: (3212,3363) sits in the
// west-gate dark-wizard camp (lvl 7+20 aggressive within 14 tiles - a death
// trap for this hp13 bot, and why it drifted/died when parked there). The
// east square is packed with roamable men and has no aggressive mobs.
const STATION_X = 3250;   // (bank counter is 18 tiles N)
const STATION_Z = 3410;
// Varrock West bank (3185,3436) — "Banking works at Varrock West" per
// learnings/banking.md.
const BANK_X = 3252;  // Varrock EAST bankers (3252-3256,3417-18)
const BANK_Z = 3421;  // standing tile proven with the essence fleet
const BANK_AT = 1000; // gp a bot carries before a supply run (18 tiles)
// Eat when HP drops below this fraction of max. Stun deals 2-3 dmg; with
// maxHp 13 keep a real buffer.
const EAT_FRACTION = 0.7;
// Food: DEACTIVATED (shop leg unreliable in-process). The chosen target is
// Varrock men (lvl 1, STUN DAMAGE 1) — one stun heals back via natural regen
// well before the next one lands, so a 13-hp bot sustains indefinitely.
// (Guards/paladins stun 2-3 and killed it repeatedly on the old config.)
const FOOD_MIN = 0;
const FOOD_TARGET = 0;
// Coins kept in the bag after banking: a standing food budget.
const FOOD_RESERVE = 200;
// General stores sell bread/cake/chicken here.
const SHOP_X = 3235;
const SHOP_Z = 3388;
const SHOP_NAME = /shop|general|store/i;

// HOLD: safe-stop switch — false, station is Varrock city center (already
// where this bot stands; no monster routes anywhere near it).
const HOLD = false;
const FOOD_BUY = /bread|cake|chicken|bacon|shrimp|sardine|meat/i;
// Bank food to withdraw when restocking (Ardougne shops sell these; meat pie
// heals 12, salmon 6 - both far better than the 1-heal shrimp).
const FOOD = /meat pie|salmon|cooked meat|bread|shrimp|anchov|trout|cod|tuna|bass|pike|herring|lobster|kebab|cake|banana|potato|worm|chicken|oomlie|pie/i;
// Movement stuck-detection: if a walk leg makes no progress for this many game
// ticks the route silently failed (observed: walkTo to the bank resolved with
// no movement and busy=false, leaving the bot stranded on 20k gp). Nudge off to
// a side tile, then re-path.
const STUCK_TICKS = 30;
// An attempt spans 2+ engine ticks inside a p_delay; leave it alone until it
// resolves. This is the backstop for the case where nothing resolves and the
// server said nothing either; a refusal the server DID signal is caught by
// opFeedback and retried next tick.
const PICK_RETRY_TICKS = Number(process.env.PICK_RETRY ?? 6);
const UNREACHABLE_TICKS = 50; // how long to skip an npc local routing could not reach
const UNREACHABLE_PILE_TICKS = 50; // ...and a coin pile local routing could not reach
const STUN_TICKS = 8; // %stunned in pickpocket.rs2; further opnpc3 is dropped
// The engine holds a dropped session open for a few seconds and answers
// "already logged in" until it lets go, so the first retry always waits.
const RELOGIN_MS = 5_000;
const RELOGIN_MAX_MS = 60_000;
const DEBUG = process.env.DEBUG === '1';

interface Stats {
    picks: number;
    stuns: number;
    deaths: number;
    banks: number;
    bankedGp: number;
    relogins: number;
    /** Attempts the server refused outright. A high count means something is
     *  blocking ops - a modal, a stun, an npc that left view - not bad luck. */
    rejected: number;
    /** Food items bought at the shop (optimistic: counted when the buy is sent). */
    foodBought: number;
}

type Phase = 'pick' | 'toBank' | 'openBank' | 'deposit' | 'closeBank' | 'toShop' | 'buyFood' | 'return';

class IncomeBot {
    private session: LiteSession | null = null;
    private client: LiteClient | null = null;
    private collector: BotStateCollector | null = null;
    private executor: ActionExecutor | null = null;

    private tick = 0;
    private waitTicks = 0;
    private lastHp = 0;
    private seenHp = false;
    private lastCoins = 0;
    private lastPickTick = -99;
    private awaitingPick = false;
    /** opFeedback.opRejectedCount as of the last attempt sent. */
    private pickRejectCursor = 0;
    private busy = false;
    /** Tick an async routing action (walkTo) started; the busy guard below
     *  force-clears it if it never resolves (observed: walkTo to the tile the
     *  bot already stands on - e.g. at the bank - resolves nothing, so busy
     *  stuck true and the tick loop silently froze). */
    private busySince = 0;
    /** npcIndex -> tick until which local routing said it cannot be reached. */
    private unreachable = new Map<number, number>();
    /** "x,z" -> tick until which a coin pile was not routable. */
    private unreachablePiles = new Map<string, number>();
    phase: Phase = 'pick';
    lastFailure = '';
    /** Food still to buy on the current supply run, set before the shop opens
     *  (the shop modal hides the inventory, so it cannot be recomputed there). */
    private foodToBuy = 0;
    /** Position-based stuck detection for walk legs (toBank/return). */
    private lastPX = -1;
    private lastPZ = -1;
    /** Tick the bot last observed moving; (tick - stillSince) = time standing. */
    private stillSince = 0;

    readonly stats: Stats = { picks: 0, stuns: 0, deaths: 0, banks: 0, bankedGp: 0, relogins: 0, rejected: 0, foodBought: 0 };
    coins = 0;
    thieving = 1;
    hp = 10;

    constructor(readonly name: string) {}

    get online(): boolean {
        return this.client !== null && this.client.isInGame();
    }

    /**
     * Take ownership of a freshly logged-in session. Stats survive a re-login;
     * everything keyed to the old session does not - npc indices are per-session
     * and the tick counter restarts at 0, so stale deadlines would read as
     * far-future and never expire.
     */
    attach(session: LiteSession): void {
        this.session = session;
        this.client = session.client;
        const asClient = this.client as unknown as Client;
        this.collector = new BotStateCollector(asClient);
        this.executor = new ActionExecutor(asClient);
        this.executor.setScanProvider(this.collector);

        this.tick = 0;
        this.waitTicks = 0;
        this.seenHp = false;
        this.lastPickTick = -99;
        this.awaitingPick = false;
        this.busy = false;
        this.unreachable.clear();
        this.unreachablePiles.clear();
        this.lastPX = -1;
        this.lastPZ = -1;
        this.stillSince = 0;
        this.foodToBuy = 0;
        this.phase = 'pick';

        this.client.setOnGameTickCallback(() => {
            this.tick++;
            this.onTick().catch(e => console.error(`[${this.name}] tick error:`, e));
        });
    }

    stop(): void {
        this.client?.setOnGameTickCallback(null);
        this.session?.stop();
        this.session = null;
        this.client = null;
    }

    private exec(action: BotAction): void {
        if (!this.executor) return;
        const res = this.executor.execute(action);
        if (!(res instanceof Promise) && !res.success) {
            this.lastFailure = `${action.type}:${res.reason ?? res.message}`;
        }
        if (res instanceof Promise) {
            // Only routing actions (walkTo over long distances) go async.
            this.busy = true;
            this.busySince = this.tick;
            res.catch(() => undefined).finally(() => {
                this.busy = false;
            });
        }
    }

    private coinsIn(state: BotWorldState): number {
        return state.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
    }

    private coinSlot(state: BotWorldState): number | undefined {
        return state.inventory.find(i => /^coins$/i.test(i.name))?.slot;
    }

    /**
     * An inventory item the server lets us Eat or Drink, else undefined.
     * Capability-based (reads the item's own options) so it is name-independent
     * - it works for any food without a hardcoded item list.
     */
    private edibleSlot(state: BotWorldState): { slot: number; opIndex: number } | undefined {
        const food = state.inventory.find(i => i.optionsWithIndex.some(o => /^(eat|drink)$/i.test(o.text)));
        if (!food) return undefined;
        const opt = food.optionsWithIndex.find(o => /^(eat|drink)$/i.test(o.text))!;
        return { slot: food.slot, opIndex: opt.opIndex };
    }

    /** Total edible items in the bag (for the food buffer). */
    private foodCount(state: BotWorldState): number {
        return state.inventory
            .filter(i => i.optionsWithIndex.some(o => /^(eat|drink)$/i.test(o.text)))
            .reduce((a, i) => a + i.count, 0);
    }

    /**
     * Walk a few tiles off to one side of the current heading. Used when a walk
     * leg is stuck (no progress for STUCK_TICKS): nudging to a side tile breaks
     * the failed route, and the next tick re-paths to the real destination.
     */
    private nudge(px: number, pz: number, tx: number, tz: number): void {
        const dx = tx - px, dz = tz - pz;
        const len = Math.hypot(dx, dz) || 1;
        const step = 3;
        this.exec({
            type: 'walkTo',
            x: Math.round(px + (-dz / len) * step),
            z: Math.round(pz + (dx / len) * step),
            running: true,
            reason: 'unstuck'
        });
        this.waitTicks = 3;
        this.stillSince = this.tick; // don't nudge again until it moves (or stalls)
    }

    /** The nearest bank booth: a loc named *bank* offering a Bank/Use option. */
    private findBankBooth(state: BotWorldState) {
        return (
            state.nearbyLocs
                .filter(l => /bank/i.test(l.name))
                .filter(l => l.optionsWithIndex.some(o => /^bank$/i.test(o.text) || /use/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0] ?? null
        );
    }

    private bankOpen(state: BotWorldState): boolean {
        // state.bank.isOpen is authoritative (what the SDK's isBankOpen uses);
        // the bank modal does not reliably flip interface.isOpen/modalOpen,
        // which made openBank re-click the booth forever with the screen up.
        return state.bank?.isOpen === true ||
            state.interface?.isOpen === true ||
            state.modalOpen === true;
    }

    private shopOpen(state: BotWorldState): boolean {
        return state.shop?.isOpen === true;
    }

    /**
     * Coins in the bag. A shop (or bank) modal replaces the inventory tab, so
     * `state.inventory` reads empty underneath it - when the shop is open the
     * bag is mirrored in `shop.playerItems` instead.
     */
    private coinsHere(state: BotWorldState): number {
        if (this.shopOpen(state)) {
            return state.shop.playerItems
                .filter(i => /^coins$/i.test(i.name))
                .reduce((a, i) => a + i.count, 0);
        }
        return this.coinsIn(state);
    }

    private async onTick(): Promise<void> {
        if (!this.client || !this.collector) return;
        if (this.busy) {
            if (this.tick - this.busySince > 40) { this.busy = false; console.warn(`[${this.name}] cleared stuck busy after ${this.tick - this.busySince} ticks`); }
            else return;
        }
        if (this.waitTicks > 0) {
            this.waitTicks--;
            return;
        }

        const state = this.collector.collectState(this.tick, true) as BotWorldState | null;
        if (!state?.player) return;

        // Level-ups block every op server-side and must be dismissed - but the
        // bank/shop INTERFACES also read as an open dialog, and auto-clicking
        // them (and returning) froze the bank state machine forever in
        // openBank (observed 2026-10-24: phase stuck, no ticks emitted). Only
        // dismiss when NOT driving a bank/shop modal.
        if (this.client.isDialogOpen() && !state.bank.isOpen) {
            this.exec({ type: 'clickDialogOption', optionIndex: 0, reason: 'level up' });
            return;
        }

        // Safe-hold: the target station is infeasible for this bot's combat
        // level, so stay put at spawn (safe) instead of walking to death.
        if (HOLD) return;

        const hp = state.skills.find(s => /hitpoint/i.test(s.name))?.level ?? 0;
        const coins = this.coinsIn(state);
        this.hp = hp;
        this.coins = coins;
        this.thieving = state.skills.find(s => /thieving/i.test(s.name))?.level ?? 1;

        // Score the previous tick from the deltas rather than blocking on a
        // confirmation - a pickpocket resolves 2-3 ticks after it is sent, and
        // waiting for that round-trip is what made the gateway version slow.
        if (this.seenHp) {
            if (hp - this.lastHp >= 3) {
                // hp snapped back up: died and respawned. (Regen is 1 at a time,
                // and a death reads as 0 for a tick, so >=3 is unambiguous.)
                this.stats.deaths++;
                this.awaitingPick = false;
                this.phase = 'pick'; // back on station after respawn
            } else if (hp < this.lastHp) {
                this.stats.stuns++;
                this.lastHp = hp;
                this.awaitingPick = false;
                this.waitTicks = STUN_TICKS; // %stunned drops further opnpc3 anyway
                return;
            }
        }
        // seenHp gates this too: the first tick of a session (or of a re-login)
        // only resynchronises the baselines, or a restored inventory would score
        // as a pickpocket.
        if (this.seenHp && this.phase === 'pick' && coins > this.lastCoins) {
            this.stats.picks++;
            this.awaitingPick = false;
        }
        this.lastHp = hp;
        this.lastCoins = coins;
        if (hp > 0) this.seenHp = true; // skills read 0 on the first tick after login

        const px = state.player.worldX;
        const pz = state.player.worldZ;

        // Client-level walkTo does not open doors (the SDK script path does).
        // When wedged near a gate for a while, open it, then let the phase
        // re-dispatch its walk through the now-open door.
        if (this.tick - this.stillSince > 10) {
            const door = state.nearbyLocs.find(l =>
                /door|gate/i.test(l.name) &&
                l.optionsWithIndex.some(o => /open/i.test(o.text)));
            if (door) {
                const opt = door.optionsWithIndex.find(o => /open/i.test(o.text))!;
                this.exec({ type: 'interactLoc', x: door.x, z: door.z, locId: door.id, optionIndex: opt.opIndex, reason: 'open door' });
                this.waitTicks = 3;
                this.stillSince = this.tick;
            }
        }

        // Track progress for stuck-detection: stillSince is the tick the bot
        // last moved, so (tick - stillSince) is how long it has been standing.
        if (px !== this.lastPX || pz !== this.lastPZ) {
            this.lastPX = px;
            this.lastPZ = pz;
            this.stillSince = this.tick;
        }

        if (DEBUG) {
            const npal = state.nearbyNpcs.filter(n => /^man$/i.test(n.name)).length;
            const npick = state.nearbyNpcs.filter(n => /^man$/i.test(n.name) && n.optionsWithIndex.some(o => /pickpocket/i.test(o.text))).length;
            const still = this.tick - this.stillSince;
            console.log(`  t${this.tick} ph=${this.phase} pos=(${px},${pz}) hp=${hp}/${state.player.maxHp} gp=${coins} food=${this.foodCount(state)} rej=${state.opFeedback.opRejectedCount} men=${npal}/${npick} still=${still} dlg=${this.client.isDialogOpen()} busy=${this.busy} wait=${this.waitTicks}`);
        }

        // --- banking state machine -------------------------------------------
        // Only entered once loaded; the rest of onTick (pickpocketing) is the
        // 'pick' phase. A failed leg just re-dispatches next tick.
        if (this.phase !== 'pick') {
            switch (this.phase) {
                case 'toBank':
                    if (Math.hypot(px - BANK_X, pz - BANK_Z) <= 3) {
                        this.phase = 'openBank';
                    } else if (this.tick - this.stillSince > STUCK_TICKS) {
                        this.nudge(px, pz, BANK_X, BANK_Z);
                    } else {
                        this.exec({ type: 'walkTo', x: BANK_X, z: BANK_Z, running: true, reason: 'to bank' });
                        this.waitTicks = 4;
                    }
                    return;

                case 'openBank': {
                    if (this.bankOpen(state)) {
                        this.phase = 'deposit';
                        return;
                    }
                    // Banker NPC first where present (east-bank counters): the
                    // booth loc can sit behind the counter and never enter
                    // nearbyLocs, so a booth-only click wedges the phase (the
                    // SDK's openBank talks to the banker for the same reason).
                    const banker = state.nearbyNpcs
                        .filter(n => /banker/i.test(n.name) &&
                            n.optionsWithIndex.some(o => /bank|talk/i.test(o.text)))
                        .sort((a, b) => a.distance - b.distance)[0];
                    if (banker && banker.distance <= 4) {
                        const bopt = banker.optionsWithIndex.find(o => /^bank$/i.test(o.text))
                            ?? banker.optionsWithIndex.find(o => /bank|talk/i.test(o.text))!;
                        this.exec({ type: 'interactNpc', npcIndex: banker.index, optionIndex: bopt.opIndex, reason: 'open bank via banker' });
                        this.waitTicks = 4;
                        return;
                    }
                    const booth = this.findBankBooth(state);
                    if (booth) {
                        const opt =
                            booth.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ??
                            booth.optionsWithIndex.find(o => /use/i.test(o.text))!;
                        this.exec({ type: 'interactLoc', x: booth.x, z: booth.z, locId: booth.id, optionIndex: opt.opIndex, reason: 'open bank' });
                        this.waitTicks = 3;
                    } else {
                        // Booth not in nearbyLocs. If we're standing ON the bank
                        // tile a walkTo(BANK) is a no-op that never resolves, so
                        // sidestep to a booth-facing tile instead and rescan.
                        if (Math.hypot(px - BANK_X, pz - BANK_Z) <= 4) {
                            this.exec({ type: 'walkTo', x: BANK_X + 1, z: BANK_Z - 1, running: false, reason: 'reposition to booth' });
                        } else {
                            this.exec({ type: 'walkTo', x: BANK_X, z: BANK_Z, running: false, reason: 'find bank booth' });
                        }
                        this.waitTicks = 4;
                    }
                    return;
                }

                case 'deposit': {
                    if (!this.bankOpen(state)) {
                        this.phase = 'openBank'; // bank closed unexpectedly; re-open
                        return;
                    }
                    // Bank every non-food item, one op per tick, until only food
                    // and the coin reserve remain. Guards drop coins (knights also pocket keys)
                    // runes (and the first run carries mining junk), so we clear
                    // the whole bag rather than just the coin slot. Coins keep a
                    // standing FOOD_RESERVE in the bag - that is the food budget
                    // for the shop leg of this same run.
                    const coin = state.inventory.find(i => /^coins$/i.test(i.name));
                    const coinToBank = coin ? Math.max(0, coin.count - FOOD_RESERVE) : 0;
                    const loot = state.inventory.find(i =>
                        !FOOD.test(i.name) &&
                        !( /^coins$/i.test(i.name) && coinToBank <= 0 )
                    );
                    if (loot) {
                        if (/^coins$/i.test(loot.name)) {
                            this.stats.banks++;
                            this.stats.bankedGp += coinToBank;
                            this.exec({ type: 'bankDeposit', slot: loot.slot, amount: coinToBank, reason: 'bank coins' });
                        } else {
                            this.exec({ type: 'bankDeposit', slot: loot.slot, amount: -1, reason: 'bank loot' });
                        }
                        this.waitTicks = 3;
                        return;
                    }
                    // Bag holds only food + the coin reserve: if the bank itself
                    // still has food (a one-shot seed) top up from it, otherwise
                    // the shop leg of the run will.
                    const have = this.foodCount(state);
                    if (have < FOOD_MIN) {
                        const foodItem = state.bank.items.find(b => FOOD.test(b.name) && b.count > 0);
                        if (foodItem) {
                            const need = Math.min(FOOD_TARGET - have, foodItem.count);
                            this.exec({ type: 'bankWithdraw', slot: foodItem.slot, amount: need, reason: 'restock food' });
                            this.waitTicks = 4;
                            return;
                        }
                    }
                    this.phase = 'closeBank';
                    this.waitTicks = 2;
                    return;
                }

                case 'closeBank':
                    if (this.bankOpen(state)) {
                        this.exec({ type: 'closeModal', reason: 'close bank' });
                        this.waitTicks = 2;
                    } else {
                        // Bag is clear and the food reserve is in hand. Recompute
                        // the buy from the live bag (a bank restock may have
                        // filled it since the trigger), then on to the shop or
                        // straight home.
                        this.foodToBuy = Math.max(0, FOOD_TARGET - this.foodCount(state));
                        this.phase = this.foodToBuy > 0 ? 'toShop' : 'return';
                    }
                    return;

                case 'toShop':
                    if (Math.hypot(px - SHOP_X, pz - SHOP_Z) <= 3) {
                        this.phase = 'buyFood';
                    } else if (this.tick - this.stillSince > STUCK_TICKS) {
                        this.nudge(px, pz, SHOP_X, SHOP_Z);
                    } else {
                        this.exec({ type: 'walkTo', x: SHOP_X, z: SHOP_Z, running: true, reason: 'to shop' });
                        this.waitTicks = 4;
                    }
                    return;

                case 'buyFood': {
                    if (this.foodToBuy <= 0) {
                        if (this.shopOpen(state)) {
                            this.exec({ type: 'closeShop', reason: 'done buying' });
                            this.waitTicks = 2;
                        } else {
                            this.phase = 'return';
                        }
                        return;
                    }
                    if (!this.shopOpen(state)) {
                        // Open Aemad's shop via his Trade option.
                        const keeper = state.nearbyNpcs
                            .filter(n => SHOP_NAME.test(n.name) && n.optionsWithIndex.some(o => /trade/i.test(o.text)))
                            .sort((a, b) => a.distance - b.distance)[0];
                        if (keeper && keeper.distance <= 4) {
                            const tradeOpt = keeper.optionsWithIndex.find(o => /trade/i.test(o.text))!;
                            this.exec({ type: 'interactNpc', npcIndex: keeper.index, optionIndex: tradeOpt.opIndex, reason: 'open food shop' });
                            this.waitTicks = 4;
                        } else {
                            this.exec({ type: 'walkTo', x: SHOP_X, z: SHOP_Z, running: false, reason: 'find Aemad' });
                            this.waitTicks = 4;
                        }
                        return;
                    }
                    // Shop open: buy one food per tick (1-at-a-time avoids the
                    // count dialog the executor does not resolve).
                    const coins = this.coinsHere(state);
                    const food = state.shop.shopItems.find(s => FOOD_BUY.test(s.name) && s.count > 0);
                    if (food && coins >= food.buyPrice) {
                        this.exec({ type: 'shopBuy', slot: food.slot, amount: 1, reason: 'buy food' });
                        this.foodToBuy--;
                        this.stats.foodBought++;
                        this.waitTicks = 3;
                    } else {
                        // Out of stock or out of coins: close and head home.
                        this.exec({ type: 'closeShop', reason: food ? 'cannot afford food' : 'shop out of stock' });
                        this.phase = 'return';
                        this.waitTicks = 2;
                    }
                    return;
                }

                case 'return':
                    if (Math.hypot(px - STATION_X, pz - STATION_Z) <= 12) {
                        this.phase = 'pick';
                    } else if (this.tick - this.stillSince > 3 * STUCK_TICKS) {
                        // Station repeatedly unroutable (e.g. city gates shut
                        // the loop): banked loot is safe, so work here instead
                        // of freezing forever.
                        this.phase = 'pick';
                    } else if (this.tick - this.stillSince > STUCK_TICKS) {
                        this.nudge(px, pz, STATION_X, STATION_Z);
                    } else {
                        this.exec({ type: 'walkTo', x: STATION_X, z: STATION_Z, running: true, reason: 'back to station' });
                        this.waitTicks = 4;
                    }
                    return;
            }
        }

        // --- supply run (BEFORE the station check: a loaded or hungry bot
        // banks/buys from wherever it stands, instead of looping "return to
        // station" forever against a station local routing cannot reach) -------
        const food = this.foodCount(state);
        if (food < FOOD_MIN || coins >= BANK_AT) {
            this.foodToBuy = Math.max(0, FOOD_TARGET - food);
            this.phase = 'toBank';
            return;
        }

        // --- back on station ---------------------------------------------------
        if (Math.hypot(px - STATION_X, pz - STATION_Z) > 12) {
            if (this.tick - this.stillSince > STUCK_TICKS) {
                this.nudge(px, pz, STATION_X, STATION_Z);
            } else {
                this.exec({ type: 'walkTo', x: STATION_X, z: STATION_Z, running: true, reason: 'return to station' });
                this.waitTicks = 4;
            }
            return;
        }

        // --- eat when hurt -----------------------------------------------------
        // Guard/knight stun deals 2-3 damage; with maxHp ~12 a couple of stuns can
        // kill. Eat from the bag whenever HP dips below the buffer. No modal is
        // open in the 'pick' phase, so the use op is not hidden behind the bank.
        const maxHp = state.player.maxHp || hp || 1;
        if (hp > 0 && hp < maxHp * EAT_FRACTION) {
            const edible = this.edibleSlot(state);
            if (edible) {
                this.exec({ type: 'useInventoryItem', slot: edible.slot, optionIndex: edible.opIndex, reason: 'eat' });
                this.waitTicks = 3;
                return;
            }
        }

        // The server can take an op and throw it away - stunned, mid-action, or a
        // modal open underneath - and the only thing it sends back is
        // UNSET_MAP_FLAG. Without this the bot sits out the whole retry window
        // waiting for a resolution that was never coming.
        if (this.awaitingPick && state.opFeedback.opRejectedCount > this.pickRejectCursor) {
            this.stats.rejected++;
            this.awaitingPick = false;
        }

        // --- hoover up loose coins ---------------------------------------------
        // A death scatters the coin stack (and any pocket keys) where the bot
        // died, so any pile nearby is ours to reclaim.
        const pile = state.groundItems
            .filter(g => /^coins$/i.test(g.name) || /pocket|chaos/i.test(g.name))
            .filter(g => Math.abs(g.x - px) <= 12 && Math.abs(g.z - pz) <= 12)
            .filter(g => g.reachable !== false) // taking routes 0x0 - you must stand on the pile
            .filter(g => (this.unreachablePiles.get(`${g.x},${g.z}`) ?? 0) < this.tick)
            .sort((a, b) => b.count - a.count || a.distance - b.distance)[0];
        if (pile) {
            this.lastFailure = '';
            this.exec({ type: 'pickupItem', x: pile.x, z: pile.z, itemId: pile.id, reason: 'loose gold' });
            if (this.lastFailure.endsWith('cant_reach')) {
                this.unreachablePiles.set(`${pile.x},${g_key(pile)}`, this.tick + UNREACHABLE_PILE_TICKS);
                return;
            }
            this.waitTicks = 2;
            return;
        }

        // --- the actual work ----------------------------------------------------
        const candidates = state.nearbyNpcs
            .filter(n => /^man$/i.test(n.name))
            .filter(n => n.optionsWithIndex.some(o => /pickpocket/i.test(o.text)))
            .filter(n => n.reachable !== false)
            .filter(n => (this.unreachable.get(n.index) ?? 0) < this.tick)
            .sort((a, b) => a.distance - b.distance);
        const pal = candidates[0];
        if (!pal) {
            if (this.tick - this.stillSince > STUCK_TICKS) {
                this.nudge(px, pz, STATION_X, STATION_Z);
            } else {
                this.exec({ type: 'walkTo', x: STATION_X, z: STATION_Z, running: true, reason: 'find guards' });
                this.waitTicks = 5;
            }
            return;
        }
        // Leave an outstanding attempt alone until it lands or times out.
        if (this.awaitingPick && this.tick - this.lastPickTick < PICK_RETRY_TICKS) return;
        const opt = pal.optionsWithIndex.find(o => /pickpocket/i.test(o.text))!;
        this.lastFailure = '';
        this.exec({ type: 'interactNpc', npcIndex: pal.index, optionIndex: opt.opIndex, reason: 'pickpocket' });
        if (this.lastFailure.endsWith('cant_reach')) {
            this.unreachable.set(pal.index, this.tick + UNREACHABLE_TICKS);
            return; // no packet went out - try a different paladin on the next tick
        }
        this.lastPickTick = this.tick;
        this.awaitingPick = true;
        this.pickRejectCursor = state.opFeedback.opRejectedCount;
    }
}

function g_key(p: { x: number; z: number }): string {
    return `${p.x},${p.z}`;
}

// ------------------------------------------------------------------ CLI entry

const argv = process.argv.slice(2);
const name = argv.find(a => !a.startsWith('-'));
if (!name) {
    console.error('Usage: bun src/lite/income.ts <bot>');
    process.exit(1);
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

async function readEnv(bot: string): Promise<Record<string, string>> {
    const text = await Bun.file(`${repoRoot}bots/${bot}/bot.env`).text();
    return Object.fromEntries(
        text
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );
}

let shuttingDown = false;
const bot = new IncomeBot(name);

/** Log the bot in and hand it the session, arranging for its own resurrection. */
async function login(): Promise<void> {
    const env = await readEnv(name);
    const session = await startSession({
        host: env.SERVER || 'localhost',
        username: env.BOT_USERNAME!,
        password: env.PASSWORD!,
        quiet: true,
        onEnd: (end: SessionEnd) => onSessionEnd(end)
    });
    bot.attach(session);
}

function onSessionEnd(end: SessionEnd): void {
    if (shuttingDown || end.reason === 'stopped') {
        return;
    }
    console.warn(`[income] ${name} lost its session (${end.reason}) - re-logging in`);
    void relogin();
}

/** A revision mismatch hits every retry; there is nothing to gain by looping. */
function exitIfOutdated(e: unknown): void {
    if (e instanceof OutdatedClientError) {
        console.error(`[income] ${e.message}`);
        process.exit(3);
    }
}

/** Retry forever: the world may be restarting, and a bot is no use logged out. */
async function relogin(): Promise<void> {
    let delay = RELOGIN_MS;
    while (!shuttingDown) {
        await Bun.sleep(RELOGIN_MS + loginJitterMs(Math.max(1000, delay - RELOGIN_MS)));
        if (shuttingDown) {
            return;
        }
        try {
            await login();
            bot.stats.relogins++;
            console.log(`[income] ${name} back online (${bot.stats.relogins} re-logins so far)`);
            return;
        } catch (e) {
            exitIfOutdated(e);
            console.error(`[income] ${name} re-login failed (${e}); retrying in ${Math.round(delay / 1000)}s`);
            delay = Math.min(delay * 2, RELOGIN_MAX_MS);
        }
    }
}

try {
    await login();
    console.log(`[income] ${name} logged in (in-process Lumbridge men pickpocket + bank runs)`);
} catch (e) {
    exitIfOutdated(e);
    console.error(`[income] ${name} failed to log in: ${e}`);
    void relogin(); // keep trying in the background rather than losing the bot
}

const startedAt = Date.now();
const report = setInterval(() => {
    const mins = (Date.now() - startedAt) / 60_000;
    console.log(
        `\n[income] ${mins.toFixed(1)}m | ${bot.online ? 'online' : 'OFFLINE'} | ` +
            `th${bot.thieving} hp${bot.hp} | ${bot.coins} gp in bag | ` +
            `${bot.stats.picks} picks ${bot.stats.stuns} stuns ${bot.stats.deaths} deaths ` +
            `${bot.stats.banks} bank-runs ${bot.stats.bankedGp} gp banked` +
            (bot.stats.foodBought ? ` ${bot.stats.foodBought} food bought` : '') +
            (bot.stats.rejected ? ` ${bot.stats.rejected} refused` : '') +
            (bot.stats.relogins ? ` ${bot.stats.relogins} re-logins` : '') +
            (bot.phase !== 'pick' ? ` | phase=${bot.phase}` : '')
    );
}, 30_000);

function shutdown(): void {
    shuttingDown = true;
    clearInterval(report);
    console.log(`\n[income] stopping. ${bot.coins} gp in bag.`);
    bot.stop();
    process.exit(0);
}

process.on('SIGINT', shutdown);
