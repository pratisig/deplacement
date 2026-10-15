/* Animated GIF encoder (GIF89a, looping), written from scratch so a page with
   no dependencies can still export an animation.
 *
 * Two passes: median-cut the frames down to one 256-colour palette, then LZW
 * each frame against it. Pixels are looked up through a 32768-entry table
 * built once, so encoding stays fast even for a few hundred frames. */

/** Histogram over 5-bit RGB cells: counts and exact colour sums. */
function gifHistogram(frames) {
  const count = new Int32Array(32768);
  const sums = new Float64Array(32768 * 3);
  for (const frame of frames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const cell = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[cell]++;
      sums[cell * 3] += r;
      sums[cell * 3 + 1] += g;
      sums[cell * 3 + 2] += b;
    }
  }
  const cells = [];
  for (let c = 0; c < 32768; c++) {
    if (count[c]) {
      cells.push({
        cell: c,
        n: count[c],
        r: sums[c * 3] / count[c],
        g: sums[c * 3 + 1] / count[c],
        b: sums[c * 3 + 2] / count[c],
      });
    }
  }
  return cells;
}

/** Median cut: split the widest box at its weighted median until max boxes. */
function gifPalette(cells, maxColors = 256) {
  if (!cells.length) return [[0, 0, 0]];
  let boxes = [cells];
  while (boxes.length < maxColors) {
    let best = -1,
      bestRange = 0,
      bestChannel = 'r';
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const ch of ['r', 'g', 'b']) {
        let lo = Infinity,
          hi = -Infinity;
        for (const c of box) {
          if (c[ch] < lo) lo = c[ch];
          if (c[ch] > hi) hi = c[ch];
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = i;
          bestChannel = ch;
        }
      }
    });
    if (best < 0 || bestRange <= 0) break;
    const box = boxes[best].slice().sort((a, b) => a[bestChannel] - b[bestChannel]);
    const total = box.reduce((a, c) => a + c.n, 0);
    let acc = 0,
      split = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].n;
      if (acc >= total / 2) {
        split = i + 1;
        break;
      }
    }
    boxes = boxes
      .slice(0, best)
      .concat([box.slice(0, split), box.slice(split)], boxes.slice(best + 1));
  }
  return boxes
    .filter(b => b.length)
    .map(box => {
      let n = 0,
        r = 0,
        g = 0,
        bl = 0;
      for (const c of box) {
        n += c.n;
        r += c.r * c.n;
        g += c.g * c.n;
        bl += c.b * c.n;
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
    });
}

/** 32768-entry lookup: 5-bit RGB cell -> palette index. */
function gifLookup(cells, palette) {
  const lut = new Uint8Array(32768);
  for (const c of cells) {
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = c.r - palette[i][0],
        dg = c.g - palette[i][1],
        db = c.b - palette[i][2];
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    lut[c.cell] = best;
  }
  return lut;
}

function gifIndices(frame, lut) {
  const data = frame.data;
  const out = new Uint8Array(frame.width * frame.height);
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    const cell = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    out[p] = lut[cell];
  }
  return out;
}

/** GIF LZW compression, LSB-first, with clear/EOI handling. */
function gifLzw(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = eoiCode + 1;
  const dict = new Map();
  const out = [];
  let bits = 0,
    bitCount = 0;
  const push = code => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bits & 0xff);
      bits >>= 8;
      bitCount -= 8;
    }
  };
  push(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    push(prefix);
    if (next === 4096) {
      // the dictionary is full: start again, as the decoder expects
      push(clearCode);
      dict.clear();
      codeSize = minCodeSize + 1;
      next = eoiCode + 1;
    } else {
      dict.set(key, next);
      next++;
      // the decoder is one entry behind, so the code size grows one step
      // after the table would need it — being eager here corrupts the stream
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    }
    prefix = k;
  }
  push(prefix);
  push(eoiCode);
  if (bitCount > 0) out.push(bits & 0xff);
  return out;
}

function gifSubBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/**
 * @param frames [{data: Uint8ClampedArray RGBA, width, height}]
 * @param delay  hundredths of a second per frame (2 = 50 fps, 8 = 12.5 fps)
 * @returns Uint8Array — a complete GIF89a file
 */
function encodeGIF(frames, { delay = 8, paletteSize = 256 } = {}) {
  if (!frames.length) throw new Error('Nothing to encode.');
  const width = frames[0].width,
    height = frames[0].height;
  const cells = gifHistogram(frames);
  const palette = gifPalette(cells, Math.min(256, paletteSize));
  const lut = gifLookup(cells, palette);

  const out = [];
  const push = (...values) => out.push(...values);
  const u16 = v => push(v & 0xff, (v >> 8) & 0xff);

  // header + logical screen descriptor with a global colour table
  push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  u16(width);
  u16(height);
  push(0xf7, 0, 0); // global table, 256 entries, colour resolution 8
  for (let i = 0; i < 256; i++) {
    const c = palette[i] || [0, 0, 0];
    push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff);
  }
  // NETSCAPE2.0 looping extension
  push(
    0x21,
    0xff,
    0x0b,
    ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)),
    0x03,
    0x01,
    0x00,
    0x00,
    0x00,
  );

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height)
      throw new Error('All frames must have the same size.');
    push(0x21, 0xf9, 0x04, 0x04); // graphic control: disposal 1
    u16(Math.max(2, Math.round(delay)));
    push(0x00, 0x00);
    push(0x2c); // image descriptor
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    push(0x00);
    push(8); // LZW minimum code size
    push(...gifSubBlocks(gifLzw(gifIndices(frame, lut), 8)));
  }
  push(0x3b); // trailer
  return new Uint8Array(out);
}
