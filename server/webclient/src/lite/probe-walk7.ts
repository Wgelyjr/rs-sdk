// Multi-level probe for the Wizard Tower: which collision level holds the
// laddertop, is the pocket open on any level, and what locs (doors/stairs/
// ladders) exist around the tower and around the warehouse surface exit.
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
const BASE_X = 3054, BASE_Z = 3112; // 104x104 build area covering the tower

const idToType = new Map<number, string>();
for (const line of readFileSync('/home/wgelyjr/Projects/rs-sdk/server/content/pack/loc.pack', 'utf8').split('\n')) {
    const m = line.match(/^(\d+)=(\S+)$/);
    if (m) idToType.set(parseInt(m[1], 10), m[2]);
}
const type = (id: number) => idToType.get(id) ?? `l${id}`;
const SQ = 0x280100;

async function main() {
    const cfg = readFileSync(`${CACHE}/config819086852.jag`);
    LocType.init(new JagFile(new Uint8Array(cfg)));
    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });

    console.log('--- laddertop anchor (3104,3162) by level ---');
    for (let level = 0; level < 4; level++) {
        const g = index.lookup(LocLayer.GROUND, level, 3104, 3162);
        const w = index.lookup(LocLayer.WALL, level, 3104, 3162);
        console.log(`  level ${level}: ground=${g ? type(valueLocId(g)) : '-'} wall=${w ? type(valueLocId(w)) : '-'}`);
    }

    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BASE_X, BASE_Z, maps);

    const POCKET: [number, number][] = [[3103, 3162], [3104, 3161], [3105, 3162], [3104, 3163]];
    console.log('\n--- pocket tiles + anchor by level (#=solid W=wall-edge .=open) ---');
    for (let level = 0; level < 4; level++) {
        const map = maps[level];
        if (!map) { console.log(`  level ${level}: no map`); continue; }
        const f = map.flags, N = BuildArea.SIZE;
        const cell = (x: number, z: number) => {
            const i = (x - BASE_X) * N + (z - BASE_Z);
            const v = f[i];
            if (v & SQ) return '#';
            if (v & 0xff) return 'W';
            return '.';
        };
        const pocket = POCKET.map(([x, z]) => cell(x, z)).join(' ');
        console.log(`  level ${level}: anchor=${cell(3104, 3162)} pocket=[${pocket}]`);
    }

    console.log('\n--- interesting locs around the tower (all levels) ---');
    const X0 = 3090, X1 = 3130, Z0 = 3135, Z1 = 3185;
    const interesting = /door|stair|ladder|gate|tele|roof|spiral|window|entrance|exit|ladd/i;
    for (let level = 0; level < 4; level++) {
        const found: string[] = [];
        for (let z = Z0; z <= Z1; z++) {
            for (let x = X0; x <= X1; x++) {
                for (const layer of [LocLayer.WALL, LocLayer.WALL_DECOR, LocLayer.GROUND, LocLayer.GROUND_DECOR]) {
                    const v = index.lookup(layer, level, x, z);
                    if (v) {
                        const t = type(valueLocId(v));
                        if (interesting.test(t)) found.push(`(${x},${z}) L${layer} ${t}`);
                    }
                }
            }
        }
        console.log(`  level ${level}: ${found.length ? found.join(' | ') : '(none matching)'}`);
    }

    console.log('\n--- ALL locs (any layer, any level) in the pocket + 2-tile ring ---');
    const seen = new Set<string>();
    for (let level = 0; level < 4; level++) {
        for (let z = 3158; z <= 3166; z++) {
            for (let x = 3100; x <= 3110; x++) {
                for (const layer of [LocLayer.WALL, LocLayer.WALL_DECOR, LocLayer.GROUND, LocLayer.GROUND_DECOR]) {
                    const v = index.lookup(layer, level, x, z);
                    if (v) {
                        const key = `(${x},${z}) L${level} L${layer} ${type(valueLocId(v))}`;
                        if (!seen.has(key)) { seen.add(key); console.log(`  ${key}`); }
                    }
                }
            }
        }
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
