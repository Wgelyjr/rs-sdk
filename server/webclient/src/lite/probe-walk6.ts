// Definitive reachability probe for the Wizard Tower ladder (3104,3162).
//
// Replicates the movement.ts route() BFS EXACTLY (same PL_WALK_* expansion
// rules) over the real CollisionMap from buildCollision, then answers:
//   1. Which tiles are reachable from each known bot standing position?
//   2. Of those, which can trigger the ladder via testLoc (1x1, forceapproach=0)?
//   3. Which is the closest reachable tile to the ladder anchor (for a raw dispatch)?
//   4. Per-tile wall direction bits around the ladder, to see why crossings block.
import './dom-shim.js'; // before any '#/' imports
import { readFileSync } from 'node:fs';
import { LocIndex } from './world/LocIndex.js';
import { buildCollision } from './world/CollisionBuilder.js';
import JagFile from '#/io/JagFile.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import LocType from '#/config/LocType.js';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;
const BASE_X = 3054, BASE_Z = 3112;
const LADDER_X = 3104, LADDER_Z = 3162;
const X0 = 3094, X1 = 3116, Z0 = 3152, Z1 = 3174;
const SQ_BLOCKED = 0x280100;

async function main() {
    const cfg = readFileSync(`${CACHE}/config819086852.jag`);
    LocType.init(new JagFile(new Uint8Array(cfg)));
    const loc = LocType.list(2147);
    console.log(`ladder loc: w=${loc.width} l=${loc.length} blockwalk=${loc.blockwalk} forceapproach=${loc.forceapproach}`);

    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BASE_X, BASE_Z, maps);
    const map = maps[0]!;
    const flags = map.flags;
    const N = BuildArea.SIZE;
    const idx = (x: number, z: number) => x * N + z;
    const inB = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N;
    const L = { x: LADDER_X - BASE_X, z: LADDER_Z - BASE_Z };

    // ---- exact expansion rules from movement.ts route() ----
    function canStep(x: number, z: number, nx: number, nz: number): boolean {
        if (!inB(nx, nz)) return false;
        const d = flags[idx(nx, nz)];
        const dx = nx - x, dz = nz - z;
        if (dx === -1 && dz === 0) return (d & CollisionFlag.PL_WALK_E) === 0;
        if (dx === 1 && dz === 0) return (d & CollisionFlag.PL_WALK_W) === 0;
        if (dx === 0 && dz === -1) return (d & CollisionFlag.PL_WALK_N) === 0;
        if (dx === 0 && dz === 1) return (d & CollisionFlag.PL_WALK_S) === 0;
        if (dx === -1 && dz === -1) return (d & CollisionFlag.PL_WALK_NE) === 0
            && (flags[idx(x - 1, z)] & CollisionFlag.PL_WALK_E) === 0
            && (flags[idx(x, z - 1)] & CollisionFlag.PL_WALK_N) === 0;
        if (dx === 1 && dz === -1) return (d & CollisionFlag.PL_WALK_NW) === 0
            && (flags[idx(x + 1, z)] & CollisionFlag.PL_WALK_W) === 0
            && (flags[idx(x, z - 1)] & CollisionFlag.PL_WALK_N) === 0;
        if (dx === -1 && dz === 1) return (d & CollisionFlag.PL_WALK_SE) === 0
            && (flags[idx(x - 1, z)] & CollisionFlag.PL_WALK_E) === 0
            && (flags[idx(x, z + 1)] & CollisionFlag.PL_WALK_S) === 0;
        if (dx === 1 && dz === 1) return (d & CollisionFlag.PL_WALK_SW) === 0
            && (flags[idx(x + 1, z)] & CollisionFlag.PL_WALK_W) === 0
            && (flags[idx(x, z + 1)] & CollisionFlag.PL_WALK_S) === 0;
        return false;
    }

    function bfs(sx: number, sz: number): Set<number> {
        const s = { x: sx - BASE_X, z: sz - BASE_Z };
        if (!inB(s.x, s.z) || (flags[idx(s.x, s.z)] & SQ_BLOCKED) !== 0) {
            console.log(`  (start (${sx},${sz}) is solid - skipping)`);
            return new Set();
        }
        const seen = new Set<number>([idx(s.x, s.z)]);
        const q: [number, number][] = [[s.x, s.z]];
        for (let head = 0; head < q.length; head++) {
            const [x, z] = q[head];
            for (const [ax, az] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                const nx = x + ax, nz = z + az;
                if (!inB(nx, nz) || seen.has(idx(nx, nz)) || !canStep(x, z, nx, nz)) continue;
                seen.add(idx(nx, nz));
                q.push([nx, nz]);
            }
        }
        return seen;
    }

    // ---- testLoc for the 1x1 ladder (forceapproach = 0) ----
    function triggersLadder(sx: number, sz: number): boolean {
        const i = idx(sx, sz);
        if (sx === L.x && sz === L.z) return true;
        if (sx === L.x - 1 && sz === L.z) return (flags[i] & CollisionFlag.W_E) === 0;
        if (sx === L.x + 1 && sz === L.z) return (flags[i] & CollisionFlag.W_W) === 0;
        if (sz === L.z - 1 && sx === L.x) return (flags[i] & CollisionFlag.W_N) === 0;
        if (sz === L.z + 1 && sx === L.x) return (flags[i] & CollisionFlag.W_S) === 0;
        return false;
    }
    // a trigger tile only counts if the bot can actually stand on it
    const standableTrigger = (sx: number, sz: number) =>
        inB(sx, sz) && (flags[idx(sx, sz)] & SQ_BLOCKED) === 0 && triggersLadder(sx, sz);

    const allTriggers: [number, number][] = [];
    for (let z = L.z - 2; z <= L.z + 2; z++)
        for (let x = L.x - 2; x <= L.x + 2; x++)
            if (triggersLadder(x, z)) allTriggers.push([x + BASE_X, z + BASE_Z]);
    console.log(`\ntestLoc trigger tiles for ladder: ${allTriggers.map(([x, z]) => `(${x},${z})`).join(' ')}`);
    console.log(`standable+trigger: ${allTriggers.filter(([x, z]) => standableTrigger(x - BASE_X, z - BASE_Z)).map(([x, z]) => `(${x},${z})`).join(' ') || 'NONE'}`);

    // ---- BFS from each known standing position ----
    const STARTS: [number, number][] = [
        [3102, 3161], // bot's current position
        [3102, 3164],
        [3104, 3165],
        [3104, 3166],
        [3102, 3165],
        [3103, 3164],
    ];
    for (const [sx, sz] of STARTS) {
        const reach = bfs(sx, sz);
        const trigger = [...reach].filter(i => standableTrigger(Math.floor(i / N) + BASE_X, (i % N) + BASE_Z));
        console.log(`\nBFS from (${sx},${sz}): ${reach.size} reachable tiles; trigger tiles reachable: ${
            trigger.length ? trigger.map(i => `(${Math.floor(i / N) + BASE_X},${i % N + BASE_Z})`).join(' ') : 'NONE'
        }`);
    }

    // ---- BFS from each trigger tile: which component does the pocket belong to? ----
    const WEST = { x: 3102 - BASE_X, z: 3161 - BASE_Z }; // bot side
    for (const [tx, tz] of [[3103, 3162], [3104, 3161], [3105, 3162], [3104, 3163]]) {
        const reach = bfs(tx, tz);
        const west = reach.has(idx(WEST.x, WEST.z));
        // a few open-world samples to see how far this component reaches
        const samples: [number, number, string][] = [
            [3110, 3162, 'east-field'],
            [3120, 3165, 'east-far'],
            [3104, 3150, 'south'],
            [3108, 3158, 'south-pocket'],
            [3115, 3157, 'south-east'],
            [3104, 3180, 'north'],
            [3090, 3162, 'west-far'],
        ];
        const hit = samples.filter(([x, z]) => reach.has(idx(x - BASE_X, z - BASE_Z))).map(([, , n]) => n);
        console.log(`\nBFS from trigger (${tx},${tz}): component size=${reach.size}; reaches bot-side(${west ? 'YES' : 'no'}); open-world samples: ${hit.join(', ') || 'NONE (walled off)'}`);
    }

    // ---- grid + wall directions ----
    const reach = bfs(3102, 3161);
    const wallStr = (f: number): string => {
        let s = '';
        if (f & 0x1) s += 'nw';
        if (f & 0x2) s += 'n';
        if (f & 0x4) s += 'ne';
        if (f & 0x8) s += 'e';
        if (f & 0x10) s += 'se';
        if (f & 0x20) s += 's';
        if (f & 0x40) s += 'sw';
        if (f & 0x80) s += 'w';
        return s || '-';
    };
    const cell = (x: number, z: number): string => {
        const lx = x - BASE_X, lz = z - BASE_Z;
        if (!inB(lx, lz)) return '?';
        const f = flags[idx(lx, lz)];
        if (x === LADDER_X && z === LADDER_Z) return 'L';
        if ((f & SQ_BLOCKED) !== 0) return '#';
        if (standableTrigger(lx, lz)) return 'T';
        return reach.has(idx(lx, lz)) ? 'r' : '.';
    };
    console.log(`\nGrid from (3102,3161): r=reachable, .=unreachable open, #=solid, T=standable+trigger, L=ladder. north=up.`);
    let hdr = '      ';
    for (let x = X0; x <= X1; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = Z1; z >= Z0; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = X0; x <= X1; x++) row += cell(x, z) + ' ';
        console.log(row);
    }

    console.log('\nWall bits on the 8 ladder neighbors (bit set = wall on that edge of the tile):');
    for (const [x, z] of [
        [L.x - 1, L.z - 1], [L.x, L.z - 1], [L.x + 1, L.z - 1],
        [L.x - 1, L.z], [L.x + 1, L.z],
        [L.x - 1, L.z + 1], [L.x, L.z + 1], [L.x + 1, L.z + 1],
    ]) {
        const f = flags[idx(x, z)];
        console.log(`  (${x + BASE_X},${z + BASE_Z}): ${wallStr(f)}${(f & SQ_BLOCKED) ? ' SOLID' : ''} trigger=${triggersLadder(x, z)}`);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
