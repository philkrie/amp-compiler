const compiler = require('../src/core');
const steps = require('../steps/default-steps');
const filesToTest = [
  {path:'', expected_output: ''},
  {path: '', expected_output: ''},
];

async function tests() {
  console.log('Compiling sites....'.cyan);
  let size = urlsToTest.length;
  let pass = 0;
  for (let [index, url] of filesToTest.entries()) {
    //TODO write compile loop
  }
  console.log('....Completed compilation\n'.cyan);

  for (let [index, url] of urlsToTest.entries()) {
    //TODO confirm tests
  }

  // let message = `Passed ${pass}/${size}`;
  // if (pass === size) {
  //   console.log(message.green);
  //   return;
  // }
  // console.log(message.red);
}

Promise.all([
  tests()
]).then(process.exit)
.catch((reason) => {
  console.log(reason);
  process.exit();
});
