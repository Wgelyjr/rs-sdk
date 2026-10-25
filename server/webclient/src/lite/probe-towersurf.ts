// Probe the Wizard Tower SURFACE to find the entrance + the ladder that
// descends to the basement (basement ladder 2148 is at 3103,9576 -> surface
// equivalent ~3103,3176, NOT the 3104,3162 ladder I tested before).
import './dom-shim.js';
import { readFileSync } from 'node:fs';
import { LocIndex, valueLocId } from './world/LocIndex.js';
import { buildCollision } from './world/CollisionBuilder.js';
import JagFile from '#/io/JagFile.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import LocType from '#/config/LocType.js';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;
const SQ = 0x280100;

const idToType = new Map<number, string>();
for (const line of readFileSync('/home/wgelyjr/Projects/rs-sdk/server/content/pack/loc.pack', 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)$/);
    if (m) idToType.set(parseInt(m[1], 10), m[2]);
}
const type = (id: number) => idToType.get(id) ?? `l${id}`;

async function main() {
    const cfg = readFileSync(`${CACHE}/config819086852.jag`);
    LocType.init(new JagFile(new Uint8Array(cfg)));
    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });

    // Surface tower box: cover 3104,3162 (old ladder) and 3103,3176 (new candidate)
    const BX = 3080, BZ = 3140; // 104x104 -> x3080-3183, z3140-3243
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BX, BZ, maps);
    const map = maps[0]!;
    const f = map.flags, N = BuildArea.SIZE;
    const idx = (x: number, z: number) => (x - BX) * N + (z - BZ);
    const inB = (x: number, z: number) => x - BX >= 0 && z - BZ >= 0 && x - BX < N && z - BZ < N;

    // --- ALL locs (all layers) in the tower box, x3092-3122 z3150-3190 ---
    console.log('=== locs in box x3092-3122, z3150-3190 (all layers) ===');
    const seen = new Map<string, string[]>();
    for (let z = 3150; z <= 3190; z++)
        for (let x = 3092; x <= 3122; x++)
            for (let layer = LocLayer.WALL; layer <= LocLayer.GROUND_DECOR; layer++) {
                const v = index.lookup(layer, 0, x, z);
                if (v) {
                    const t = type(valueLocId(v));
                    const key = `${valueLocId(v)} ${t}`;
                    if (!seen.has(key)) seen.set(key, []);
                    seen.get(key)!.push(`(${x},${z})L${layer}`);
                }
            }
    for (const [k, spots] of seen) console.log(`  ${k}: ${spots.join(' ')}`);

    // --- walkability grid x3094-3118, z3152-3188 (north=up) ---
    const cell = (x: number, z: number): string => {
        if (!inB(x, z)) return '?';
        const v = f[idx(x, z)];
        if ((v & SQ) !== 0) return '#';
        if (v & 0xff) return 'W';
        return '.';
    };
    console.log('\n=== tower surface walkability (north=up) x3094-3118, z3152-3188 ===');
    let hdr = '       ';
    for (let x = 3094; x <= 3118; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = 3188; z >= 3152; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = 3094; x <= 3118; x++) row += cell(x, z) + ' ';
        console.log(row);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
