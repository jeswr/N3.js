// **N3ProvenanceParser** parses a document and indexes each quad utterance by
// the locations emitted by N3TermLocationParser.
import N3TermLocationParser from './N3TermLocationParser';
import { ProvenanceIndex } from './N3ProvenanceIndex';

export { ProvenanceIndex };

export default class N3ProvenanceParser {
  constructor(options = {}) { this._options = options; }

  parse(input) {
    const { entityIndex, ...parserOptions } = this._options;
    const provenance = new ProvenanceIndex(entityIndex);
    parserOptions.onQuad = (quad, occurrence) => provenance._add(quad, occurrence);
    const parser = new N3TermLocationParser(parserOptions);
    const quads = parser.parse(input);
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
