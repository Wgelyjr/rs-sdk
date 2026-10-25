// Loc dump (all layers, level 0) for two boxes:
//   A: the Wizard Tower ring - looking for the door/entrance
//   B: the warehouse surface exit at (3186,3433) - looking for the climb-DOWN loc
// Also prints interaction options for any door/stair/ladder locs found.
import './dom-shim.js';
import { readFileSync } from 'node:fs';
import { LocIndex, valueLocId, valueShape, valueAngle } from './world/LocIndex.js';
import JagFile from '#/io/JagFile.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import LocType from '#/config/LocType.js';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

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

    const dump = (label: string, X0: number, X1: number, Z0: number, Z1: number) => {
        console.log(`\n=== ${label} (level 0, all layers) ===`);
        const found = new Map<number, string[]>();
        for (let z = Z0; z <= Z1; z++) {
            for (let x = X0; x <= X1; x++) {
                for (let layer = LocLayer.WALL; layer <= LocLayer.GROUND_DECOR; layer++) {
                    const v = index.lookup(layer as LocLayer, 0, x, z);
                    if (v) {
                        const id = valueLocId(v);
                        const t = type(id);
                        if (!found.has(id)) found.set(id, []);
                        found.get(id)!.push(`(${x},${z})L${layer}`);
                    }
                }
            }
        }
        for (const [id, spots] of found) {
            console.log(`  ${id} ${type(id)}: ${spots.join(' ')}`);
        }
    };

    dump('TOWER', 3096, 3120, 3148, 3176);
    dump('WAREHOUSE EXIT', 3178, 3198, 3420, 3448);

    console.log('\n=== options for door/stair/ladder-like locs ===');
    const all = new Set<number>();
    for (const [box, X0, X1, Z0, Z1] of [['T', 3096, 3120, 3148, 3176], ['W', 3178, 3198, 3420, 3448]] as const) {
        for (let z = Z0; z <= Z1; z++)
            for (let x = X0; x <= X1; x++)
                for (let layer = LocLayer.WALL; layer <= LocLayer.GROUND_DECOR; layer++) {
                    const v = index.lookup(layer as LocLayer, 0, x, z);
                    if (v) all.add(valueLocId(v));
                }
    }
    for (const id of all) {
        const t = type(id);
        if (/door|stair|ladder|gate|open|close|climb|enter|exit/i.test(t)) {
            try {
                const loc = LocType.list(id);
                console.log(`  ${id} ${t}: options=[${(loc.options ?? []).map((o: string | null) => o ?? '?').join(' | ')}]`);
            } catch {
                console.log(`  ${id} ${t}: (no config entry)`);
            }
        }
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
