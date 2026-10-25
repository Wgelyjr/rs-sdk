// WALL/GROUND dump around the Wizard Tower laddertop (3104,3162).
import { LocIndex, valueLocId } from './world/LocIndex.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { readFileSync } from 'node:fs';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

const CX = 3104, CZ = 3162; // laddertop anchor
const X0 = 3096, X1 = 3114, Z0 = 3154, Z1 = 3172;

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
    const short = (t: string) => (t || '·').slice(0, 5);
    const pad = (s: string) => s.padEnd(5);

    console.log(`WALL/GROUND around laddertop(${CX},${CZ}). Cell = "wall/ground". L = laddertop anchor.\n`);
    let hdr = '     ';
    for (let x = X0; x <= X1; x++) hdr += `${(x % 100).toString().padStart(2, '0')}    `;
    console.log(hdr);
    for (let z = Z1; z >= Z0; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = X0; x <= X1; x++) {
            const w = short(at(0, x, z));
            const g = short(at(2, x, z));
            const mark = (x === CX && z === CZ) ? 'L' : ' ';
            row += `${pad(w)}/${pad(g)}${mark} `;
        }
        console.log(row);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
