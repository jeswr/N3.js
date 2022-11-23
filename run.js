const Parser = require('./lib/N3Parser').default;
new Parser().parse('<a> <b> ( << <c> <d> <e> >> ) .');
