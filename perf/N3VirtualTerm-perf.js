#!/usr/bin/env node
const { performance } = require('perf_hooks');
const { isMainThread, parentPort, Worker, workerData } = require('worker_threads');
const N3 = require('..');

const size = Number.parseInt(process.argv[2], 10) || 50_000;
const rounds = Number.parseInt(process.argv[3], 10) || 9;

function collect() {
  if (global.gc)
    for (let attempt = 0; attempt < 3; attempt++) global.gc();
}

function median(values) {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

function createEagerFactory() {
  const factory = {};
  for (const name of ['namedNode', 'blankNode', 'literal', 'variable', 'defaultGraph', 'quad'])
    factory[name] = N3.DataFactory[name];
  return factory;
}

function eagerTermFromId(id, entities, factory) {
  if (id[0] !== '.')
    return N3.termFromId(id, factory);
  const parts = id.split('.');
  return factory.quad(
    eagerTermFromId(entities[parts[1]], entities, factory),
    eagerTermFromId(entities[parts[2]], entities, factory),
    eagerTermFromId(entities[parts[3]], entities, factory),
    parts[4] && eagerTermFromId(entities[parts[4]], entities, factory),
  );
}

class EagerStore extends N3.Store {
  // Retain an eager baseline now that every production store emits virtual quads.
  *_findInIndex(index0, key0, key1, key2, name0, name1, name2, graphId) {
    let tmp, index1, index2;
    const entities = this._entities;
    const factory = this._factory;
    const graph = eagerTermFromId(entities[graphId], entities, factory);
    const parts = { subject: null, predicate: null, object: null };

    if (key0) (tmp = index0, index0 = {})[key0] = tmp[key0];
    for (const value0 in index0) {
      if (index1 = index0[value0]) {
        parts[name0] = eagerTermFromId(entities[value0], entities, factory);
        if (key1) (tmp = index1, index1 = {})[key1] = tmp[key1];
        for (const value1 in index1) {
          if (index2 = index1[value1]) {
            parts[name1] = eagerTermFromId(entities[value1], entities, factory);
            const values = key2 ? (key2 in index2 ? [key2] : []) : Object.keys(index2);
            for (let index = 0; index < values.length; index++) {
              parts[name2] = eagerTermFromId(entities[values[index]], entities, factory);
              yield factory.quad(parts.subject, parts.predicate, parts.object, graph);
            }
          }
        }
      }
    }
  }
}

function createStore(useVirtualTerms, count = size) {
  const factory = useVirtualTerms ? N3.DataFactory : createEagerFactory();
  const store = useVirtualTerms ? new N3.Store({ factory }) : new EagerStore({ factory });
  for (let index = 0; index < count; index++)
    store.addQuad(
      `subject${index}`,
      `predicate${index % 31}`,
      `object${index}`,
      `graph${index % 7}`,
    );
  return store;
}

function enumerate(store, mode) {
  let checksum = 0;
  const start = performance.now();
  for (const quad of store.match()) {
    switch (mode) {
    case 'iterate': checksum++;
      break;
    case 'terms': {
      const subject = quad.subject, object = quad.object;
      checksum += (subject === quad.subject) + (object === quad.object);
      break;
    }
    case 'termType': checksum += quad.object.termType.length;
      break;
    case 'selectedValues': checksum += quad.subject.value.length + quad.object.value.length;
      break;
    case 'repeatedValues': checksum += quad.subject.value.length + quad.subject.value.length +
        quad.object.value.length + quad.object.value.length;
      break;
    case 'allValues': checksum += N3.termToId(quad).length;
      break;
    }
  }
  const milliseconds = performance.now() - start;
  if (!checksum)
    throw new Error('Unexpected empty result');
  return milliseconds;
}

function compareEnumeration() {
  const stores = {
    eager: createStore(false),
    virtual: createStore(true),
  };
  const result = {};
  for (const mode of ['iterate', 'terms', 'termType', 'selectedValues', 'repeatedValues', 'allValues']) {
    enumerate(stores.eager, mode);
    enumerate(stores.virtual, mode);
    const measurements = { eager: [], virtual: [] };
    for (let round = 0; round < rounds; round++) {
      collect();
      const order = round % 2 ? ['virtual', 'eager'] : ['eager', 'virtual'];
      for (const scenario of order)
        measurements[scenario].push(enumerate(stores[scenario], mode));
    }
    const eager = median(measurements.eager), virtual = median(measurements.virtual);
    result[mode] = { eager, virtual, ratio: virtual / eager };
  }
  return result;
}

function measureMemory(count, useVirtualTerms) {
  const store = createStore(useVirtualTerms, count);
  collect();
  const before = process.memoryUsage().heapUsed;
  const quads = store.getQuads();
  collect();
  const bytes = process.memoryUsage().heapUsed - before;
  if (quads.length !== count)
    throw new Error(`Unexpected result size ${quads.length}`);
  return { bytes, bytesPerQuad: bytes / count };
}

function memoryInWorker(count, useVirtualTerms) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { count, useVirtualTerms } });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
}

async function main() {
  const memory = global.gc ? {
    eager: await memoryInWorker(size, false),
    virtual: await memoryInWorker(size, true),
  } : { skipped: 'Run with --expose-gc to compare retained heap' };
  if (memory.eager)
    memory.ratio = memory.virtual.bytesPerQuad / memory.eager.bytesPerQuad;
  console.log(JSON.stringify({
    size,
    rounds,
    enumeration: compareEnumeration(),
    retainedOutput: memory,
  }, null, 2));
}

if (isMainThread) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
else
  parentPort.postMessage(measureMemory(workerData.count, workerData.useVirtualTerms));
