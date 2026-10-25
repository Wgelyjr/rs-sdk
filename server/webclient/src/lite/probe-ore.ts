// Dump ground-layer loc types in candidate ore-node regions:
//   A: (3243,3160) — the script's "Al Kharid mine" (claimed mith+adam)
//   B: (3304,3305) — "real mithril rocks" recorded in lab notes
// Prints every unique ground-loc type with its coordinates, plus a compact grid
// of ore-ish tiles for each region.
import { LocIndex, valueLocId } from './world/LocIndex.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { readFileSync } from 'node:fs';

const CACHE = `${process.env.HOME}/.cache/rs-sdk-lite`;
const CRC = 1333187759;

const REGIONS: Array<{ label: string; x0: number; x1: number; z0: number; z1: number }> = [
    { label: 'A: Al Kharid node (script MINE 3243,3160)', x0: 3223, x1: 3263, z0: 3140, z1: 3180 },
    { label: 'B: desert node (notes 3304-3305)', x0: 3289, x1: 3319, z0: 3289, z1: 3319 },
];

async function main() {
    const idToType = new Map<number, string>();
    for (const line of readFileSync('/home/wgelyjr/Projects/rs-sdk/server/content/pack/loc.pack', 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)$/);
        if (m) idToType.set(parseInt(m[1], 10), m[2]);
    }
    const type = (id: number) => idToType.get(id) ?? `l${id}`;

    const index = await LocIndex.load({ origin: 'http://127.0.0.1', cacheDir: CACHE, versionlistCrc: CRC, quiet: true });
    const at = (x: number, z: number): string => {
        const v = index.lookup(2 as LocLayer, 0, x, z);
        return v ? type(valueLocId(v)) : '';
    };

    for (const r of REGIONS) {
        console.log(`\n=== ${r.label} (x${r.x0}-${r.x1}, z${r.z0}-${r.z1}) ===`);
        const byType = new Map<string, Array<[number, number]>>();
        for (let z = r.z0; z <= r.z1; z++) {
            for (let x = r.x0; x <= r.x1; x++) {
                const t = at(x, z);
                if (!t) continue;
                const arr = byType.get(t) ?? [];
                arr.push([x, z]);
                byType.set(t, arr);
            }
        }
        // Ore-ish first, then everything else.
        const oreRe = /ore|rock|rock_|mine/i;
        const types = [...byType.entries()].sort((a, b) => {
            const ao = oreRe.test(a[0]) ? 0 : 1, bo = oreRe.test(b[0]) ? 0 : 1;
            return ao - bo || a[0].localeCompare(b[0]);
        });
        for (const [t, coords] of types) {
            const star = oreRe.test(t) ? ' *' : '';
            console.log(`  ${t}${star} x${coords.length}: ${coords.map(([x, z]) => `(${x},${z})`).join(' ')}`);
        }
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
