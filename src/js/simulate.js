/* Layout: the network simulation runs in the background all the time; the
   blend slider decides how much of it the view shows. At blend 0 the dots sit
   on their true coordinates, at 1 they sit where the forces put them, and in
   between they slide across. */

const sim = d3
  .forceSimulation()
  .alphaDecay(0.028)
  .velocityDecay(0.36)
  .on('tick', () => {
    for (const n of act) {
      if (n.y < n.r + 90) n.vy += (n.r + 90 - n.y) * 0.04;
      if (n.y > H - n.r - 60) n.vy -= (n.y - (H - n.r - 60)) * 0.04;
      if (n.x < n.r + 60) n.vx += (n.r + 60 - n.x) * 0.04;
      if (n.x > W - n.r - 60) n.vx -= (n.x - (W - n.r - 60)) * 0.04;
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x));
      n.y = Math.max(n.r + 34, Math.min(H - n.r - 6, n.y));
    }
  });

function simStop() {
  sim.stop();
}

function configure(alpha) {
  sim.nodes(act);
  const sc = Math.max(0.8, Math.min(1.7, Math.min(W, H * 1.3) / 540));
  sim
    .force(
      'link',
      d3
        .forceLink(links)
        .distance(l => (24 + 62 / (1 + Math.log(1 + l.w) * 0.4)) * sc)
        .strength(l => Math.min(0.55, 0.05 + 0.03 * Math.log(1 + l.w))),
    )
    .force(
      'charge',
      d3
        .forceManyBody()
        .strength(n => (-14 - n.r * 13) * sc)
        .distanceMax(150 * sc),
    )
    // a light pull towards the geographic position keeps the network readable
    .force('x', d3.forceX(n => W / 2 + (n.gx - W / 2) * 0.4).strength(0.07))
    .force('y', d3.forceY(n => H / 2 + (n.gy - H / 2) * 0.09).strength(0.09))
    .force(
      'collide',
      d3.forceCollide(n => n.r + 3 * sc),
    )
    .force('mid', () => {
      let sx = 0,
        sy = 0,
        sw = 0;
      for (const n of act) {
        const w = 1 + n.t;
        sx += n.x * w;
        sy += n.y * w;
        sw += w;
      }
      if (!sw) return;
      const dx = (W / 2 - sx / sw) * 0.15,
        dy = (H / 2 - sy / sw) * 0.15;
      for (const n of act) {
        n.x += dx;
        n.y += dy;
      }
    });
  sim.alpha(alpha);
  if (blend < 0.02) simStop();
  else sim.restart();
  if (RM) {
    sim.stop();
    for (let i = 0; i < 300; i++) sim.tick();
    draw(0);
  }
}

/** Where each place is drawn right now: geography, network, or a mix. */
function viewPositions() {
  const b = blend;
  for (const n of act) {
    const rGeo = Math.min(15, 1.8 + Math.sqrt(n.t) * 0.13);
    const rNet = Math.min(24, 2 + Math.sqrt(n.t) * 0.23);
    n.r = rGeo + (rNet - rGeo) * b;
    n.rx = n.gx + (n.x - n.gx) * b;
    n.ry = n.gy + (n.y - n.gy) * b;
  }
}
