// **N3ProvenanceIndex** stores and resolves the locations of quad utterances.
import { N3EntityIndex } from './N3Store';
import { termRanges } from './N3TermLocationParser';

export class ProvenanceIndex {
  constructor(entityIndex = new N3EntityIndex()) {
    this._entityIndex = entityIndex;
    this._quadOccurrences = new Map();
    this._quads = null;
    this._utteranceCount = 0;
  }

  _add(quad) {
    const occurrenceId = this._utteranceCount++;
    const quadId = this._entityIndex._termToNewNumericId(quad);
    const previous = this._quadOccurrences.get(quadId);
    if (previous === undefined)
      this._quadOccurrences.set(quadId, occurrenceId);
    else if (!Array.isArray(previous))
      this._quadOccurrences.set(quadId, [previous, occurrenceId]);
    else
      previous.push(occurrenceId);
  }

  _utterance(id) {
    const quad = this._quads[id];
    return {
      quad,
      subject: termRanges(quad.subject),
      predicate: termRanges(quad.predicate),
      object: termRanges(quad.object),
      graph: termRanges(quad.graph),
    };
  }

  _utterances(ids) {
    return typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }

  get(quad) {
    const quadId = this._entityIndex._termToNumericId(quad);
    const ids = this._quadOccurrences.get(quadId);
    return ids === undefined ? [] : this._utterances(ids);
  }

  get size() { return this._quadOccurrences.size; }
  get utteranceCount() { return this._utteranceCount; }

  *[Symbol.iterator]() {
    for (const ids of this._quadOccurrences.values())
      yield this._utterances(ids);
  }
}
