// Fixed-width WALL/GROUND loc dump around the bot (3191,9825) -> stair (3187,9833) path.
// Direct index.lookup (proven to work in probe-walk.ts), 6-char fixed cells so alignment holds.
import { LocIndex, valueLocId } from './world/LocIndex.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { readFileSync } from 'node:fs';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

const CX = 3191, CZ = 9825; // bot
const X0 = 3185, X1 = 3199, Z0 = 9821, Z1 = 9835;

async function main() {
    const idToType = new Map<number, string>();
    for (const line of readFileSync('/home/wgelyjr/Projects/rs-sdk/server/content/pack/loc.pack', 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)$/);
        if (m) idToType.set(parseInt(m[1], 10), m[2]);
    }
    const type = (id: number) => idToType.get(id) ?? `l${id}`;

    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const at = (layer: number, x: number, z: number): string => {
        const v = index.lookup(layer as LocLayer, 0, x, z);
        return v ? type(valueLocId(v)) : '';
    };
    // Short names, forced to <=5 chars.
    const short = (t: string) => {
        const map: Record<string, string> = {
            brickwall: 'Brick', oldwall: 'OldW', oldw: 'OldW', timberwall: 'Timb',
            wood2: 'Wood2', wall: 'Wall', gate: 'GATE', gate1: 'GATE', gate2: 'GATE',
            iron: 'Iron', lock: 'LOCK', stairs_cellar: 'STAIR', stairs: 'Stair',
            loc_1734: 'STAIR', door: 'door', door1: 'door', bankbooth: 'bank',
            chestclosed: 'chest', crate: 'crate', table: 'table', bigtable: 'bigT',
            chair: 'chair', candles: 'cndl', railing: 'rail', warehouse: 'shelv',
            warehouse_shelf: 'shelv', barrel: 'brrel', sack: 'sack', gold: 'gold',
            fern1: 'fern', rareflowers_1: 'flow', wood: 'wood',
        };
        return (map[t] ?? t.slice(0, 5));
    };
    const pad = (s: string) => (s || '·').padEnd(5);

    console.log(`WALL/GROUND locs around bot(${CX},${CZ}). Cell = "wall/ground". @ = bot, S = stair(3187,9833).\n`);
    let hdr = '     ';
    for (let x = X0; x <= X1; x++) hdr += `${(x % 100).toString().padStart(2, '0')}    `;
    console.log(hdr);
    for (let z = Z1; z >= Z0; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = X0; x <= X1; x++) {
            let w = short(at(0, x, z));
            let g = short(at(2, x, z));
            let mark = (x === CX && z === CZ) ? '@' : (x === 3187 && z === 9833) ? 'S' : ' ';
            const cell = `${pad(w)}/${pad(g)}${mark}`;
            row += cell + ' ';
        }
        console.log(row);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
