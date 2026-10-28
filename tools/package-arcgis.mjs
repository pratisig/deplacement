#!/usr/bin/env node
/* Package the ArcGIS Pro toolbox: one folder you can drop anywhere, plus a
   single zip you can send to someone.

   node tools/package-arcgis.mjs [--out dist]

   It copies FlowMap.pyt, flowmap_core.py, the built index.html and the
   README, then runs the Python demo to prove the whole chain works from the
   packaged copy, and writes dist/FlowMap-arcgis-pro.zip.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, 'dist');
const folder = join(out, 'arcgis-pro');

/* ------------------------------------------------------------------- zip */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** A zip with deflated entries — no dependencies, no surprises. */
function zip(files, when = new Date()) {
  const dosTime =
    ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() / 2)) & 0xffff;
  const dosDate =
    (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const body = deflated.length < data.length ? deflated : data;
    const method = body === deflated && deflated.length < data.length ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

/* -------------------------------------------------------------- assemble */
const page = join(root, 'index.html');
if (!existsSync(page)) throw new Error('index.html is missing — run node build.mjs first');

// the parameter help comes from the toolbox itself, so it can never drift
execFileSync('python3', [join(root, 'tools/arcgis/build-help.py'), '--check'], {
  cwd: root,
  stdio: 'inherit',
});

rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
for (const name of [
  'FlowMap.pyt',
  'FlowMap.pyt.xml',
  'FlowMap.BuildFlowMapPage.pyt.xml',
  'flowmap_core.py',
  'check_install.py',
  'README.md',
])
  copyFileSync(join(root, 'arcgis', name), join(folder, name));
copyFileSync(page, join(folder, 'index.html'));

// the demo runs from the packaged copy, so a broken package cannot pass
const demo = join(folder, 'demo.html');
execFileSync('python3', [join(folder, 'flowmap_core.py'), 'demo', '--out', demo], {
  cwd: folder,
  stdio: 'inherit',
});

// a folder that is only the tool's output, so it can be served as-is
mkdirSync(join(out, 'arcgis-demo'), { recursive: true });
copyFileSync(demo, join(out, 'arcgis-demo', 'index.html'));

const names = [
  'FlowMap.pyt',
  'FlowMap.pyt.xml',
  'FlowMap.BuildFlowMapPage.pyt.xml',
  'flowmap_core.py',
  'check_install.py',
  'index.html',
  'demo.html',
  'README.md',
];
const files = names.map(name => ({ name, data: readFileSync(join(folder, name)) }));
const archive = join(out, 'FlowMap-arcgis-pro.zip');
writeFileSync(archive, zip(files));

console.log(`\npackaged ${folder}`);
for (const name of names)
  console.log(`  ${name.padEnd(18)} ${(statSync(join(folder, name)).size / 1024).toFixed(0)} kB`);
console.log(
  `wrote ${archive.replace(root + '/', '')} (${(statSync(archive).size / 1024).toFixed(0)} kB)`,
);
console.log(`
In ArcGIS Pro:  Insert > Toolbox > Add Toolbox… > ${join(folder, 'FlowMap.pyt')}
Then:           Flow map > Build a flow map page`);
