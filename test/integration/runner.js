var util = require('util');
var mocha = require('mocha');
var TestRunner = require('waterline-adapter-tests');
var Adapter = require('../../dist/adapter');

// Grab targeted interfaces from this adapter's `package.json` file:
var pkg = { };
var interfaces = [ ];
var features = [ ];

try {
  pkg = require('../../package.json');
  interfaces = pkg.waterlineAdapter.interfaces;
  features = pkg.waterlineAdapter.features;
}
catch (e) {
  throw new Error(
    '\n' +
    'Could not read supported interfaces from `waterlineAdapter.interfaces`' + '\n' +
    'in this adapter\'s `package.json` file ::' + '\n' +
    util.inspect(e)
  );
}

console.log('Testing `' + pkg.name + '`, a Sails/Waterline adapter.');
console.log('Running `waterline-adapter-tests` against ' + interfaces.length + ' interfaces...');
console.log('( ' + interfaces.join(', ') + ' )');
console.log();
console.log('Latest draft of Waterline adapter interface spec:');
console.log('http://links.sailsjs.org/docs/plugins/adapters/interfaces');
console.log();

/**
 * Integration Test Runner
 *
 * Uses the `waterline-adapter-tests` module to
 * run mocha tests against the specified interfaces
 * of the currently-implemented Waterline adapter API.
 */
new TestRunner({
  mocha: { bail: false },
  failOnError: true,
  interfaces: interfaces,
  features: features,

  adapter: Adapter,
  config: {
    type: 'disk'
  }
});
