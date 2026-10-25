// Clean walkability probe around qwenrune: uses buildCollision (the SAME CollisionMap the
// client routes on) to show, per tile:
//   '#' = SQ_BLOCKED (terrain block / scenery that blocks walking / npcs)  -> cannot stand
//   'W' = has a wall direction flag (W_*) but not SQ_BLOCKED               -> wall on an edge
//   '.' = open                                                            -> can stand
//   '@' = bot, 'S' = climb-up stair (loc_1734)
import { LocIndex } from './world/LocIndex.js';
import { buildCollision } from './world/CollisionBuilder.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

const BASE_X = 3160, BASE_Z = 9800; // build-area corner (104x104 covers the warehouse)
const CX = 3191, CZ = 9825;          // bot
const SX = 3187, SZ = 9833;          // climb-up stair
const X0 = 3183, X1 = 3199, Z0 = 9818, Z1 = 9835;

const SQ_BLOCKED = 0x280100;         // WR_GRND | BLOCK_NPCS_AND_PLAYERS | WALK_SCENERY
const WALL_DIR = 0x00ff;             // W_NW|W_N|...|W_W

async function main() {
    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BASE_X, BASE_Z, maps);
    const map = maps[0]!;

    const flag = (wx: number, wz: number): number => {
        const lx = wx - BASE_X, lz = wz - BASE_Z;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) return 0xffffff;
        return map.flags[CollisionMap.index(lx, lz)];
    };
    const cell = (x: number, z: number): string => {
        if (x === CX && z === CZ) return '@';
        if (x === SX && z === SZ) return 'S';
        const f = flag(x, z);
        if (f & SQ_BLOCKED) return '#';
        if (f & WALL_DIR) return 'W';
        return '.';
    };

    console.log(`level-0 walkability. # = solid/blocked, W = wall edge, . = open, @ = bot, S = stair\n`);
    let hdr = '      ';
    for (let x = X0; x <= X1; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = Z1; z >= Z0; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = X0; x <= X1; x++) row += cell(x, z) + ' ';
        console.log(row);
    }
    console.log('\nLegend: north is up (z increases upward). Stair at (3187,9833) = top-left area.');
}
main().catch((e) => { console.error(e); process.exit(1); });
