// Probe the basement band around Sedridor (3103,9571): find the ladder base
// (expected near 3104, 3162+6400=9562 if the tower maps straight down) and
// check walkability from the ladder to Sedridor.
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

    const BBX = 3056, BBZ = 9520; // 104x104 -> x3056-3159, z9520-9623
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BBX, BBZ, maps);
    const map = maps[0]!;
    const f = map.flags, N = BuildArea.SIZE;
    const idx = (x: number, z: number) => (x - BBX) * N + (z - BBZ);
    const inB = (x: number, z: number) => x - BBX >= 0 && z - BBZ >= 0 && x - BBX < N && z - BBZ < N;

    // --- ALL locs (all layers, level 0) in the tower-basement box ---
    console.log('=== locs in box x3088-3124, z9548-9596 (all layers) ===');
    const seen = new Map<string, string[]>();
    for (let z = 9548; z <= 9596; z++)
        for (let x = 3088; x <= 3124; x++)
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

    // --- walkability grid x3092-3120, z9550-9590 (north=up) ---
    const cell = (x: number, z: number): string => {
        if (!inB(x, z)) return '?';
        const v = f[idx(x, z)];
        if ((v & SQ) !== 0) return '#';
        if (v & 0xff) return 'W';
        return '.';
    };
    console.log('\n=== basement walkability (north=up) x3092-3120, z9550-9590 ===');
    let hdr = '       ';
    for (let x = 3092; x <= 3120; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = 9590; z >= 9550; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = 3092; x <= 3120; x++) row += cell(x, z) + ' ';
        console.log(row);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
