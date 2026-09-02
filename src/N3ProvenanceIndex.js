// **N3ProvenanceIndex** stores and resolves the locations of quad utterances.
import { N3EntityIndex } from './N3Store';
import { termRanges } from './N3TermLocationParser';

export class ProvenanceIndex {
  constructor(input = '', entityIndex = new N3EntityIndex()) {
    this._input = input;
    this._entityIndex = entityIndex;
    // The entity index's numeric quad ID is the array slot; each value is one
    // occurrence ID, or an array only when the same quad occurs more than once.
    this._quadOccurrences = [];
    this._quadIds = [];
    this._quads = null;
    this._utteranceCount = 0;
  }

  _add(quad) {
    const occurrenceId = this._utteranceCount++;
    const quadId = this._entityIndex._termToNewNumericId(quad);
    const previous = this._quadOccurrences[quadId];
    if (previous === undefined) {
      this._quadIds.push(quadId);
      this._quadOccurrences[quadId] = occurrenceId;
    }
    else if (!Array.isArray(previous))
      this._quadOccurrences[quadId] = [previous, occurrenceId];
    else
      previous.push(occurrenceId);
  }

  _utterance(id) {
    const quad = this._quads[id];
    return {
      quad,
      subject: termRanges(this._input, quad.subject),
      predicate: termRanges(this._input, quad.predicate),
      object: termRanges(this._input, quad.object),
      graph: termRanges(this._input, quad.graph),
    };
  }

  get(quad) {
    const quadId = this._entityIndex._termToNumericId(quad);
    const ids = quadId && this._quadOccurrences[quadId];
    if (ids === undefined)
      return [];
    return typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
  }

  get size() { return this._quadIds.length; }
  get utteranceCount() { return this._utteranceCount; }

  *[Symbol.iterator]() {
    for (const quadId of this._quadIds) {
      const ids = this._quadOccurrences[quadId];
      yield typeof ids === 'number' ? [this._utterance(ids)] : ids.map(id => this._utterance(id));
    }
  }
}
