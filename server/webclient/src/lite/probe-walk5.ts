// DEFINITIVE walkability probe around the Wizard Tower laddertop (3104,3162).
// Uses buildCollision — the SAME CollisionMap the client routes on — so this
// includes loc footprints (width/length/blockrange), not just raw layers.
// Also dumps the ladder loc's own collision properties.
import './dom-shim.js'; // before any '#/' imports (document.createElement at module scope)
import { readFileSync } from 'node:fs';
import { LocIndex } from './world/LocIndex.js';
import { buildCollision } from './world/CollisionBuilder.js';
import JagFile from '#/io/JagFile.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import LocType from '#/config/LocType.js';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

const BASE_X = 3054, BASE_Z = 3112; // 104x104 build area, ladder at offset (50,50)
const CX = 3104, CZ = 3162;         // laddertop anchor
const X0 = 3096, X1 = 3114, Z0 = 3154, Z1 = 3172;

const SQ_BLOCKED = 0x280100; // WR_GRND | BLOCK_NPCS_AND_PLAYERS | WALK_SCENERY
const WALL_DIR = 0x00ff;

async function main() {
    // 1. The ladder loc itself (config archive from the disk cache - no HTTP).
    const cfg = readFileSync(`${CACHE}/config819086852.jag`);
    LocType.init(new JagFile(new Uint8Array(cfg)));
    for (const id of [2147, 2148]) {
        const loc = LocType.list(id);
        console.log(`loc ${id}: name=${loc.name} width=${loc.width} length=${loc.length} ` +
            `blockwalk=${loc.blockwalk} active=${loc.active} blockrange=${loc.blockrange} ` +
            `forceapproach=${loc.forceapproach} shape=${loc.shape ? [...loc.shape].join(',') : (loc.model ? `model:${[...loc.model].join(',')}` : 'none')} ` +
            `multiloc=${loc.multiloc ? [...loc.multiloc].join(',') : 'none'}`);
    }
    console.log('');

    // 2. The true walkability grid.
    const index = await LocIndex.load({ origin: 'http://127.0.0.1:3000', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const maps: (CollisionMap | null)[] = [null, null, null, null];
    buildCollision(index, BASE_X, BASE_Z, maps);
    const map = maps[0]!;
    const flag = (wx: number, wz: number): number => {
        const lx = wx - BASE_X, lz = wz - BASE_Z;
        if (lx < 0 || lz < 0 || lx >= BuildArea.SIZE || lz >= BuildArea.SIZE) return 0xffffff;
        return map.flags[CollisionMap.index(lx, lz)];
    };
    const cell = (x: number, z: number): string => {
        if (x === CX && z === CZ) return 'L';
        const f = flag(x, z);
        if (f & SQ_BLOCKED) return '#';
        if (f & WALL_DIR) return 'W';
        return '.';
    };

    console.log(`TRUE walkability (client collision map). # = solid, W = wall edge, . = open, L = ladder anchor.`);
    console.log(`north = up (z increases upward). Ladder anchor (3104,3162).\n`);
    let hdr = '      ';
    for (let x = X0; x <= X1; x++) hdr += (x % 100).toString().padStart(2, '0') + ' ';
    console.log(hdr);
    for (let z = Z1; z >= Z0; z--) {
        let row = `z${z.toString().padStart(4)}|`;
        for (let x = X0; x <= X1; x++) row += cell(x, z) + ' ';
        console.log(row);
    }
    console.log('\nLegend: the 8 approach tiles around L are (3103-3105, 3161-3163).');
}
main().catch((e) => { console.error(e); process.exit(1); });
