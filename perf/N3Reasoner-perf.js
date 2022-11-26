#!/usr/bin/env node
const { Reasoner } = require('..');
const { SUBCLASS_RULE, RDFS_RULE } = require('../test/util');
const { getTimblAndFoaf, generateDeepTaxonomy } = require('deep-taxonomy-benchmark');

async function deepTaxonomy(extended = false) {
  for (let i = 1; i <= 6; i++) {
    const TITLE = `test-dl-${10 ** i}.n3`;
    const store = generateDeepTaxonomy(10 ** i, extended);

    console.time(`Reasoning: ${TITLE}`);
    new Reasoner(store).reason(SUBCLASS_RULE);
    console.timeEnd(`Reasoning: ${TITLE}`);
  }
}

async function run() {
  console.time('Loading timbl and foaf');
  const store = await getTimblAndFoaf();
  console.timeEnd('Loading timbl and foaf');

  console.time('Reasoning');
  new Reasoner(store).reason(RDFS_RULE);
  console.timeEnd('Reasoning');
}

(async () => {
  console.log('Reasoning over TimBL profile and FOAF');
  await run();

  console.log('\nRunning Deep Taxonomy Benchmark');
  await deepTaxonomy();

  console.log('\nRunning Extended Deep Taxonomy Benchmark');
  await deepTaxonomy(true);
})();
