/* Boundary tests: do the embedded outlines actually sit on the districts?
   Every district point in the dataset is tested against its own polygon, and
   against the governorate polygon it claims to belong to. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pointInShape } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const D = read('displacement.json');
const ADM1 = read('boundaries-adm1.json');
const ADM2 = read('boundaries-adm2.json');

test('boundary files cover the dataset', () => {
  const names = D.nodes.map(n => n[0]);
  const missing = names.filter(n => !ADM2[n]);
  assert.deepEqual(missing, [], 'every district has an outline');
  const govs = [...new Set(D.nodes.map(n => n[1]))].sort();
  const have = Object.keys(ADM1).sort();
  for (const g of govs) assert.ok(have.includes(g), 'governorate outline for ' + g);
  assert.equal(have.length, 21, 'all 21 governorates');
  assert.equal(Object.keys(ADM2).length, 227, 'all 227 districts');
});

test('district points sit inside their governorate polygon', () => {
  const outside = [];
  for (const [name, gov, lon, lat] of D.nodes) {
    if (!ADM1[gov]) continue;
    if (!pointInShape(lon, lat, ADM1[gov].p)) outside.push(`${name} (${gov})`);
  }
  // Districts and governorates come from two different sources, so a handful
  // of centres sitting on a province border land on the wrong side of it.
  const ratio = 1 - outside.length / D.nodes.length;
  assert.ok(ratio >= 0.95, `only ${(ratio * 100).toFixed(0)}% inside: ${outside.join(', ')}`);
  assert.ok(outside.length <= 8, `${outside.length} border disagreements: ${outside.join(', ')}`);
});

test('governorate outlines are usable as shapes, not just points', () => {
  for (const [gov, val] of Object.entries(ADM1)) {
    // the label point has to be inside its own outline, or it lands on a neighbour
    assert.ok(pointInShape(val.c[0], val.c[1], val.p), gov + ' label inside its outline');
    let points = 0;
    for (const ring of val.p) points += ring.length / 2;
    assert.ok(points >= 8, gov + ' outline has real detail (' + points + ' points)');
  }
  // islands: Socotra belongs to Hadramawt and must be part of some outline
  const socotra = Object.entries(ADM1).filter(([, v]) =>
    v.p.some(r => {
      for (let i = 0; i < r.length; i += 2) if (r[i] < 54.5 && r[i] > 53) return true;
      return false;
    }),
  );
  assert.ok(socotra.length >= 1, 'Socotra is inside a governorate outline');
});

test('district points fall inside their own district outline', () => {
  const outside = [];
  for (const [name, , lon, lat] of D.nodes) {
    if (!ADM2[name]) continue;
    if (!pointInShape(lon, lat, ADM2[name])) outside.push(name);
  }
  // The point is the district centre from the dataset and the outline comes
  // from a different source; a few centres sit a kilometre or two off after
  // simplification, which is fine for a country-scale map.
  const ratio = 1 - outside.length / D.nodes.length;
  assert.ok(ratio >= 0.9, `only ${(ratio * 100).toFixed(0)}% of points in their district`);
  assert.ok(outside.length <= 20, `${outside.length} outliers: ${outside.slice(0, 8).join(', ')}…`);
});

test('outlines are plausible for Yemen', () => {
  const each = (obj, label) => {
    for (const [name, val] of Object.entries(obj)) {
      const rings = Array.isArray(val) ? val : val.p;
      assert.ok(rings.length > 0, label + ' ' + name + ' has rings');
      let points = 0;
      for (const ring of rings) {
        assert.equal(ring.length % 2, 0, 'flat coordinate pairs');
        points += ring.length / 2;
        assert.ok(ring.length >= 6, name + ' ring has at least 3 points');
      }
      assert.ok(points <= 400, name + ' outline is simplified (' + points + ' points)');
    }
  };
  each(ADM1, 'governorate');
  each(ADM2, 'district');
  for (const [name, val] of Object.entries(ADM2)) {
    const flat = val[val.length - 1];
    for (let i = 0; i < flat.length; i += 2) {
      assert.ok(flat[i] > 41 && flat[i] < 55, name + ' longitude inside Yemen');
      assert.ok(flat[i + 1] > 11 && flat[i + 1] < 20, name + ' latitude inside Yemen');
    }
  }
});
