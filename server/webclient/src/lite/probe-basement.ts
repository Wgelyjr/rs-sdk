// Basement-band probe: map the corridor from the bank-cellar stair
// (3187,9833) toward Sedridor (3103,9571), and the locked gate at
// (3191/3192,9825) that is currently blocking the march.
//
// Answers:
//   1. What locs (doors/gates/stairs/teleports) sit between the stair and Sedridor?
//   2. Is the gate a dead end, or is there a way around it?
//   3. What does the walkable corridor look like (BFS from the stair)?
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
    const index = await LocIndex.load({ origin: 'http://127.0.01'.replace('01', '01'), cacheDir: CACHE, versionlistCrc: CRC, quiet: true });

    // Build area covering the stair (3187,9833) + gate (3191,9825) + a margin.
    const BASE_X = 3160, BASE_Z = 9780; // 104x104 -> x 3160-3263, z 9780-9883
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BASE_X, BASE_Z, maps);
    const map = maps[0]!;
    const f = map.flags, N = BuildArea.SIZE;
    const idx = (x: number, z: number) => (x - BASE_X) * N + (z - BASE_Z);
    const inB = (x: number, z: number) => x - BASE_X >= 0 && z - BASE_Z >= 0 && x - BASE_X < N && z - BASE_Z < N;

    // ---- locs (all layers, level 0) in a box around the stair->sedridor line ----
    console.log('=== interesting locs between stair (3187,9833) and Sedridor (3103,9571) ===');
    const X0 = 3095, X1 = 3195, Z0 = 9800, Z1 = 9840;
    const interesting = /door|stair|ladder|gate|tele|spiral|window|entrance|exit|ladd|bridge|passage|corridor/i;
    const found: string[] = [];
    for (let z = Z0; z <= Z1; z++)
        for (let x = X0; x <= X1; x++)
            for (let layer = LocLayer.WALL; layer <= LocLayer.GROUND_DECOR; layer++) {
                const v = index.lookup(layer, 0, x, z);
                if (v) {
                    const t = type(valueLocId(v));
                    if (interesting.test(t)) found.push(`(${x},${z}) L${layer} ${t}`);
                }
            }
    console.log(found.length ? found.join('\n') : '(none matching)');

    // ---- ALL locs in the immediate gate/stair area (level 0) ----
    console.log('\n=== all locs near stair+gate (x3180-3200, z9810-9840), level 0 ===');
    const seen = new Map<string, string[]>();
    for (let z = 9810; z <= 9840; z++)
        for (let x = 3180; x <= 3200; x++)
            for (let layer = LocLayer.WALL; layer <= LocLayer.GROUND_DECOR; layer++) {
                const v = index.lookup(layer, 0, x, z);
                if (v) {
                    const id = valueLocId(v);
                    const t = type(id);
                    const key = `${id} ${t}`;
                    if (!seen.has(key)) seen.set(key, []);
                    seen.get(key)!.push(`(${x},${z})L${layer}`);
                }
            }
    for (const [k, spots] of seen) console.log(`  ${k}: ${spots.join(' ')}`);

    // ---- grid: walkability around the gate (level 0) ----
    const cell = (x: number, z: number): string => {
        if (!inB(x, z)) return '?';
        const v = f[idx(x, z)];
        if ((v & SQ) !== 0) return '#';
        if (v & 0xff) return 'W';
        return '.';
    };
    console.log('\n=== walkability grid (north=up) x3182-3200, z9808-9836 ===');
    let hdr = '       ';
    for (let x = 3182; x <= 3200; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = 9836; z >= 9808; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = 3182; x <= 3200; x++) row += cell(x, z) + ' ';
        console.log(row);
    }

    // ---- BFS from the stair (3187,9833) with movement.ts expansion rules ----
    const PL = { E: 0x280108, W: 0x280180, N: 0x280102, S: 0x280120, NE: 0x28010E, SE: 0x280138, NW: 0x280183, SW: 0x2801E0 };
    function canStep(x: number, z: number, nx: number, nz: number): boolean {
        if (!inB(nx, nz)) return false;
        const d = f[idx(nx, nz)];
        const dx = nx - x, dz = nz - z;
        if (dx === -1 && dz === 0) return (d & PL.E) === 0;
        if (dx === 1 && dz === 0) return (d & PL.W) === 0;
        if (dx === 0 && dz === -1) return (d & PL.N) === 0;
        if (dx === 0 && dz === 1) return (d & PL.S) === 0;
        if (dx === -1 && dz === -1) return (d & PL.NE) === 0 && (f[idx(x - 1, z)] & PL.E) === 0 && (f[idx(x, z - 1)] & PL.N) === 0;
        if (dx === 1 && dz === -1) return (d & PL.NW) === 0 && (f[idx(x + 1, z)] & PL.W) === 0 && (f[idx(x, z - 1)] & PL.N) === 0;
        if (dx === -1 && dz === 1) return (d & PL.SE) === 0 && (f[idx(x - 1, z)] & PL.E) === 0 && (f[idx(x, z + 1)] & PL.S) === 0;
        if (dx === 1 && dz === 1) return (d & PL.SW) === 0 && (f[idx(x + 1, z)] & PL.W) === 0 && (f[idx(x, z + 1)] & PL.S) === 0;
        return false;
    }
    const SX = 3187, SZ = 9833;
    const bfs = new Set<number>([idx(SX, SZ)]);
    const q: [number, number][] = [[SX, SZ]];
    for (let head = 0; head < q.length; head++) {
        const [x, z] = q[head];
        for (const [ax, az] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const nx = x + ax, nz = z + az;
            if (!inB(nx, nz) || bfs.has(idx(nx, nz)) || !canStep(x, z, nx, nz)) continue;
            bfs.add(idx(nx, nz));
            q.push([nx, nz]);
        }
    }
    console.log(`\nBFS from stair (3187,9833): ${bfs.size} tiles reachable in this build area.`);
    const south = [...bfs].filter(i => { const z = (i % N) + BASE_Z; return z < 9825; });
    console.log(`  tiles reachable SOUTH of the gate (z<9825): ${south.length}`);
    // closest reachable tile to the gate line
    let best = 1e9;
    for (const i of bfs) { const x = Math.floor(i / N) + BASE_X, z = (i % N) + BASE_Z; best = Math.min(best, Math.abs(x - 3191) + Math.abs(z - 9825)); }
    console.log(`  min manhattan distance from any reachable tile to (3191,9825): ${best}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
