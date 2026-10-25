// Dump the loc layout around qwenrune's current position in the dungeon room
// (3191,9825) to understand the room walls and where the exit gate leads.
// Shows WALL layer (L0), GROUND layer (L2) types. Gates highlighted.

import { LocIndex, valueLocId } from './world/LocIndex.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { readFileSync } from 'node:fs';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;
const CX = 3191, CZ = 9825; // bot position

async function main() {
    const idToType = new Map<number, string>();
    for (const line of readFileSync('/home/wgelyjr/Projects/rs-sdk/server/content/pack/loc.pack', 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)$/);
        if (m) idToType.set(parseInt(m[1], 10), m[2]);
    }
    const type = (id: number) => idToType.get(id) ?? `loc${id}`;

    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const at = (layer: number, x: number, z: number): string => {
        const v = index.lookup(layer as LocLayer, 0, x, z);
        return v ? type(valueLocId(v)) : '';
    };

    const R = 11;
    // Compact: only show wall-ish + gate + notable ground types. Map long names to short.
    const short = (t: string) => {
        if (!t) return '';
        const map: Record<string, string> = {
            brickwall: 'Brick', timberwall: 'Timb', wood2: 'Wood2', wall: 'Wall',
            gate: 'GATE', gate1: 'GATE', gate2: 'GATE', iron: 'Iron',
            stairs_cellar: 'STAIR', stairs: 'Stair', door: 'door', door1: 'door',
            bankbooth: 'bank', chestclosed: 'chest', crate: 'crate', table: 'table',
            chair: 'chair', candles: 'cndl', railing: 'rail', fern1: 'fern', fern2: 'fern',
            rareflowers_1: 'flow', rareflower_1: 'flow', wood: 'wood',
        };
        return map[t] ?? t.slice(0, 4);
    };

    console.log(`Loc layout around bot (${CX},${CZ}). Cell = "wall/ground". @ = bot tile.\n`);
    const cols = [];
    for (let x = CX - R; x <= CX + R; x++) cols.push(`${(x % 100).toString().padStart(2, ' ')} `);
    console.log('      ' + cols.join(''));
    for (let z = CZ + R; z >= CZ - R; z--) {
        let row = `z${z.toString().padStart(4, ' ')}|`;
        for (let x = CX - R; x <= CX + R; x++) {
            const w = short(at(0, x, z));
            const g = short(at(2, x, z));
            const cell = (x === CX && z === CZ) ? '@' : `${w}${w || g ? '/' : ''}${g}`;
            row += cell.padEnd(8);
        }
        console.log(row);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
