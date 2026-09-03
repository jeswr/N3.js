#!/usr/bin/env node

const assert = require('assert'),
    path = require('path'),
    { spawnSync } = require('child_process');

const workloadNames = ['unique', 'reused', 'duplicate', 'turtle', 'n3'];
const modeNames = ['plain', 'provenance', 'materialized'];

function makeWorkload(name, count) {
  let input = '', format = 'N-Triples';
  switch (name) {
  case 'unique':
    for (let i = 0; i < count; i++)
      input += `<http://e/s${i}> <http://e/p${i}> "value ${i}" .\n`;
    break;
  case 'reused':
    for (let i = 0; i < count; i++)
      input += `<http://e/s${i % 1000}> <http://e/p${i % 30}> <http://e/o${i % 10}> .\n`;
    break;
  case 'duplicate':
    input = '<http://e/s> <http://e/p> <http://e/o> .\n'.repeat(count);
    break;
  case 'turtle':
    format = 'Turtle';
    input = '@prefix ex: <http://e/> .\n';
    for (let i = 0; i < count; i++)
      input += `ex:s${i % 1000} ex:p${i % 30} "v${i}"@en, [ ex:q ex:o ]; ex:list (ex:a ex:b).\n`;
    break;
  case 'n3':
    format = 'N3';
    input = '@prefix ex: <http://e/> .\n@forAll ex:x .\n';
    for (let i = 0; i < count; i++) {
      input += `{ ex:s${i % 1000} ex:p ex:x } => ` +
        `{ ex:s${i % 1000} ex:q (ex:o [ ex:r """line\nvalue"""@en ]) } .\n` +
        `ex:s${i % 1000} ex:t <<( ex:s${i % 1000} ex:p ex:o )>> .\n` +
        `ex:s${i % 1000} ex:p ex:o ~ ex:r${i % 1000} {| ex:a ex:b |} .\n`;
    }
    break;
  default:
    throw new Error(`Unknown workload: ${name}`);
  }
  return { input, format };
}

function consumeProvenance(result) {
  let checksum = result.quads.length, entries = 0, occurrences = 0;
  for (const [, values] of result.provenance) {
    entries++;
    occurrences += values.length;
    const subject = values[0] && values[0].subject;
    if (subject)
      checksum += subject.start.line + subject.start.column + subject.end.line + subject.end.column;
  }
  return { checksum, entries, occurrences };
}

function collectGarbage() {
  if (global.gc)
    for (let pass = 0; pass < 3; pass++)
      global.gc();
}

function runWorker() {
  const modulePath = path.resolve(process.argv[3]),
      workload = process.argv[4],
      count = Number.parseInt(process.argv[5], 10),
      mode = process.argv[6];
  // The benchmark intentionally loads the candidate supplied on the command line.
  // eslint-disable-next-line import-x/no-dynamic-require
  const N3 = require(modulePath);
  const target = makeWorkload(workload, count),
      // Warm enough code to avoid timing parser initialization and JIT setup.
      warm = makeWorkload(workload, Math.min(count, 2_000));

  function parse(input, format) {
    if (mode === 'plain')
      return new N3.Parser({ format }).parse(input);
    return new N3.ProvenanceParser({ format }).parse(input);
  }

  parse(warm.input, warm.format);
  collectGarbage();
  const before = process.memoryUsage().heapUsed,
      start = process.hrtime.bigint(),
      result = parse(target.input, target.format);
  let checksum, holder = result, distinctQuads = 0, occurrences = 0;
  if (mode === 'plain')
    checksum = result.length;
  else if (mode === 'materialized') {
    const consumed = consumeProvenance(result);
    checksum = consumed.checksum;
    distinctQuads = consumed.entries;
    occurrences = consumed.occurrences;
    holder = [result, consumed];
  }
  else
    checksum = result.quads.length;
  const milliseconds = Number(process.hrtime.bigint() - start) / 1e6;
  collectGarbage();
  const retainedBytes = process.memoryUsage().heapUsed - before,
      quads = mode === 'plain' ? result.length : result.quads.length;
  assert(checksum >= quads);
  assert(holder);
  process.stdout.write(JSON.stringify({
    workload, mode, count, bytes: target.input.length, quads,
    distinctQuads, occurrences, milliseconds, retainedBytes,
    node: process.version, arch: process.arch,
  }));
}

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rounded(value) {
  return Number(value.toFixed(2));
}

function summarize(samples) {
  const times = samples.map(sample => sample.milliseconds).sort((a, b) => a - b),
      middle = median(times),
      deviations = times.map(value => Math.abs(value - middle));
  return {
    medianMs: rounded(middle),
    madMs: rounded(median(deviations)),
    p10Ms: rounded(times[Math.floor((times.length - 1) * 0.1)]),
    p90Ms: rounded(times[Math.ceil((times.length - 1) * 0.9)]),
    retainedKiBPerQuad: rounded(median(samples.map(sample => sample.retainedBytes / sample.quads)) / 1024),
    samplesMs: samples.map(sample => rounded(sample.milliseconds)),
  };
}

function runController() {
  const modulePath = path.resolve(option('module', path.join(__dirname, '..'))),
      count = Number.parseInt(option('count', '5000'), 10),
      sampleCount = Number.parseInt(option('samples', '9'), 10),
      workloads = option('workloads', workloadNames.join(',')).split(',');
  console.log(JSON.stringify({ modulePath, count, sampleCount, workloads }));

  for (const workload of workloads) {
    if (!workloadNames.includes(workload))
      throw new Error(`Unknown workload: ${workload}`);
    const samples = { plain: [], provenance: [], materialized: [] };
    for (let sample = 0; sample < sampleCount; sample++) {
      const modes = sample % 2 === 0 ? modeNames : [...modeNames].reverse();
      for (const mode of modes) {
        const child = spawnSync(process.execPath, [
          '--expose-gc', __filename, '--worker', modulePath, workload, String(count), mode,
        ], { encoding: 'utf8' });
        if (child.status !== 0)
          throw new Error(child.stderr || child.stdout || `Worker exited with ${child.status}`);
        samples[mode].push(JSON.parse(child.stdout));
      }
    }

    const summary = {};
    for (const mode of modeNames)
      summary[mode] = summarize(samples[mode]);
    summary.provenance.slowdown = rounded(summary.provenance.medianMs / summary.plain.medianMs);
    summary.materialized.slowdown = rounded(summary.materialized.medianMs / summary.plain.medianMs);
    console.log(JSON.stringify({
      workload,
      bytes: samples.plain[0].bytes,
      quads: samples.plain[0].quads,
      ...summary,
    }));
  }
}

if (process.argv[2] === '--worker')
  runWorker();
else
  runController();
