/* A toy model of superposition trained live in the browser.
   n sparse features x in [0,1]^n are stored in m = 2 dimensions by h = W x and read back by
   x_hat = ReLU(W^T h + b), with importance-weighted squared error, as in the toy-models report.
   Exported as a plain function so it can also run under Node for testing. */
(function (root) {
  "use strict";

  function createToy({ n = 5, density = 0.03, decay = 0.8, batch = 1024, lr = 0.02, seed = 1 } = {}) {
    let s = seed >>> 0 || 1;
    const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

    const imp = Array.from({ length: n }, (_, i) => Math.pow(decay, i));
    const W = new Float64Array(2 * n).map(() => gauss() * 0.4);   // W[k * n + i]
    const b = new Float64Array(n);
    const mW = new Float64Array(2 * n), vW = new Float64Array(2 * n);
    const mb = new Float64Array(n), vb = new Float64Array(n);
    const x = new Float64Array(n);
    let t = 0;
    let loss = 0;

    function step() {
      const gW = new Float64Array(2 * n), gb = new Float64Array(n);
      let total = 0;
      for (let sample = 0; sample < batch; sample += 1) {
        let h0 = 0, h1 = 0;
        for (let i = 0; i < n; i += 1) {
          x[i] = rand() < density ? rand() : 0;
          if (x[i]) { h0 += W[i] * x[i]; h1 += W[n + i] * x[i]; }
        }
        let dh0 = 0, dh1 = 0;
        for (let i = 0; i < n; i += 1) {
          const y = W[i] * h0 + W[n + i] * h1 + b[i];
          const diff = (y > 0 ? y : 0) - x[i];
          total += imp[i] * diff * diff;
          if (y > 0) {
            const g = 2 * imp[i] * diff;
            gb[i] += g; gW[i] += g * h0; gW[n + i] += g * h1;
            dh0 += g * W[i]; dh1 += g * W[n + i];
          }
        }
        if (dh0 || dh1) {
          for (let i = 0; i < n; i += 1) {
            if (x[i]) { gW[i] += dh0 * x[i]; gW[n + i] += dh1 * x[i]; }
          }
        }
      }
      t += 1;
      const c1 = 1 - Math.pow(0.9, t), c2 = 1 - Math.pow(0.999, t);
      const adam = (p, g, m, v) => {
        for (let j = 0; j < p.length; j += 1) {
          const gj = g[j] / batch;
          m[j] = 0.9 * m[j] + 0.1 * gj;
          v[j] = 0.999 * v[j] + 0.001 * gj * gj;
          p[j] -= lr * (m[j] / c1) / (Math.sqrt(v[j] / c2) + 1e-8);
        }
      };
      adam(W, gW, mW, vW);
      adam(b, gb, mb, vb);
      loss = total / batch;
      return loss;
    }

    return {
      n, imp, W, b, step,
      get loss() { return loss; },
      get steps() { return t; },
      columns() {
        return Array.from({ length: n }, (_, i) => ({ x: W[i], y: W[n + i], norm: Math.hypot(W[i], W[n + i]), imp: imp[i] }));
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { createToy };
  else root.createToy = createToy;
})(typeof window !== "undefined" ? window : globalThis);
