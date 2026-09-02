// **N3ProvenanceParser** parses a document and indexes each quad utterance by
// the source tokens attached by N3TermLocationParser.
import N3TermLocationParser, { TERM_TOKEN, termRanges } from './N3TermLocationParser';
import { ProvenanceIndex, quadKey, termKey } from './N3ProvenanceIndex';

export { TERM_TOKEN, termRanges, ProvenanceIndex, quadKey, termKey };

export default class N3ProvenanceParser {
  constructor(options = {}) { this._options = options; }

  parse(input) {
    const provenance = new ProvenanceIndex(input);
    const parser = new N3TermLocationParser({
      ...this._options,
      onQuad: quad => provenance._add(quad),
    });
    const quads = parser.parse(input);
    return { quads, provenance, prefixes: parser._prefixes };
  }
}
