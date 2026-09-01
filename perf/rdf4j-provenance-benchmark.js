const { performance } = require('node:perf_hooks');
const { Parser, ProvenanceParser, TokenLog } = require('../lib');

const tripleCount = Number.parseInt(process.argv[2] || '100000', 10);
const rounds = Number.parseInt(process.argv[3] || '7', 10);
const warmups = Number.parseInt(process.argv[4] || '2', 10);
const batchSize = Number.parseInt(process.argv[5] || '3', 10);
// eslint-disable-next-line import-x/no-dynamic-require
const baseline = require(process.argv[6] || '/private/tmp/n3-pr672-event-baseline/lib');

const lines = new Array(tripleCount);
for (let i = 0; i < tripleCount; i++)
  lines[i] = `<http://example.org/s${i}> <http://example.org/p> "value ${i}" .\n`;
const input = lines.join('');

const cases = {
  baselinePlain() {
    return baseline.Parser ? new baseline.Parser({ format: 'N-Triples' }).parse(input) : null;
  },
  baselineProvenance() {
    return new baseline.ProvenanceParser({ format: 'N-Triples' }).parse(input);
  },
  eventPlain() {
    return new Parser({ format: 'N-Triples' }).parse(input);
  },
  lexicalOnly() {
    const tokens = new TokenLog(input);
    const quads = new Parser({
      format: 'N-Triples',
      onToken(token, start, end, sourceId) {
        tokens._add(token, start, end, sourceId);
      },
    }).parse(input);
    tokens._finish();
    return { quads, tokens };
  },
  eventProvenance() {
    return new ProvenanceParser({ format: 'N-Triples' }).parse(input);
  },
};

function consume(result) {
  if (Array.isArray(result))
    return result.length;
  return result.quads.length + (result.tokens ? result.tokens.length : result.provenance.size);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return { heap: memory.heapUsed, arrayBuffers: memory.arrayBuffers };
}

const names = Object.keys(cases);
for (const name of names) {
  for (let warmup = 0; warmup < warmups; warmup++) {
    for (let batch = 0; batch < batchSize; batch++) {
      let result = cases[name]();
      consume(result);
      result = null;
    }
  }
  if (global.gc)
    global.gc();
}

const measurements = Object.fromEntries(names.map(name => [name, []]));
for (let round = 0; round < rounds; round++) {
  const offset = round % names.length;
  const order = [...names.slice(offset), ...names.slice(0, offset)];
  for (const name of order) {
    if (global.gc)
      global.gc();
    const before = memorySnapshot();
    const start = performance.now();
    let result;
    for (let batch = 0; batch < batchSize; batch++) {
      result = cases[name]();
      consume(result);
      if (batch + 1 < batchSize)
        result = null;
    }
    const milliseconds = (performance.now() - start) / batchSize;
    if (global.gc)
      global.gc();
    const after = memorySnapshot();
    measurements[name].push({
      milliseconds,
      heap: after.heap - before.heap,
      arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    });
    result = null;
  }
}

const plain = median(measurements.baselinePlain.map(sample => sample.milliseconds));
console.log(JSON.stringify({
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  tripleCount,
  bytes: input.length,
  rounds,
  warmups,
  batchSize,
}));
for (const name of names) {
  const samples = measurements[name];
  const milliseconds = median(samples.map(sample => sample.milliseconds));
  const heap = median(samples.map(sample => sample.heap));
  const arrayBuffers = median(samples.map(sample => sample.arrayBuffers));
  console.log(JSON.stringify({
    name,
    milliseconds: Number(milliseconds.toFixed(1)),
    versusPlain: Number((milliseconds / plain).toFixed(2)),
    retainedHeapMiB: Number((heap / 1024 / 1024).toFixed(1)),
    retainedArrayBuffersMiB: Number((arrayBuffers / 1024 / 1024).toFixed(1)),
    samples: samples.map(sample => Number(sample.milliseconds.toFixed(1))),
  }));
}
