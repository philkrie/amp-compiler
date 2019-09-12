const {compile} = require('./core');
const argv = require('minimist')(process.argv.slice(2));
const steps = require('../steps/default-steps.js')

//TODO Redo examples
function printUsage() {
  let usage = `
Usage: ./amp-compiler [path]

Required:
  path\tPath of the file to convert.

Options (*denotes default value if not passed in):
  --steps=FILE\tPath to the custom steps JS file. If not defined, it will use ./steps/default-steps.js
  --output=FILE\tPath to the output file.

Examples:
  # TODO
  `;
  console.log(usage);
}

/**
 * Main CLI function.
 */
async function begin() {
  let path = argv['_'][0], output = argv['output'];
  let customSteps = argv['steps'] ?
      require(`../${argv['steps']}`) : null;

  if (!path) {
    printUsage();
    return;
  }

  let allSteps = customSteps || steps;
  if (customSteps) console.log(`Use custom steps ${argv['steps']}`);

  await compile(path, allSteps, argv);
}

module.exports = {
  begin,
};
