// Wrap the original SVG-derived PNG in a Windows ICO container; no third-party artwork.
import { readFile, writeFile } from 'node:fs/promises';
const directory = new URL('../apps/desktop/src-tauri/icons/', import.meta.url);
const png = await readFile(new URL('32x32.png', directory));
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32; header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(new URL('icon.ico', directory), Buffer.concat([header, png]));
