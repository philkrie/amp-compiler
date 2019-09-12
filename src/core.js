/**
 * Additional functions for the purpose of compiling AMP w/o Puppeteer
 */

const fse = require('fs-extra');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const path = require('path');
const beautify = require('js-beautify').html;
const purify = require("purify-css")
const CleanCSS = require('clean-css');
const Diff = require('diff');
const assert = require('assert');
const {
  JSDOM
} = require("jsdom");
const fs = require('fs');
const core = require('./core')
const helper = require('./helper');


function runCompileAction(action, sourceDom) {
  let elements, el, destEl, elHtml, regex, matches, newEl, body;
  let numReplaced = 0,
    oldStyles = '',
    newStyles = '',
    optimizedStyles = '';
  let message = action.actionType;
  let result = {};

  // Replace the action's all properties with envVars values.
  Object.keys(action).forEach((prop) => {
    action[prop] = helper.replaceEnvVars(action[prop]);
  });

  switch (action.actionType) {
    case 'setAttribute':
      elements = sourceDom.querySelectorAll(action.selector);
      elements.forEach((el) => {
        el.setAttribute(action.attribute, action.value);
      });
      message = `set ${action.attribute} as ${action.value}`;
      break;

    case 'removeAttribute':
      elements = sourceDom.querySelectorAll(action.selector);
      elements.forEach((el) => {
        el.removeAttribute(action.attribute);
      });
      message = `remove ${action.attribute} from ${elements.length} elements`;
      break;

    case 'replaceBasedOnAmpErrors':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      let ampErrorMatches = matchAmpErrors(ampErrors, action.ampErrorRegex);
      let regexStr;
      let matchSet = new Set();

      elements.forEach((el) => {
        ampErrorMatches.forEach(matches => {
          regexStr = action.regex;
          for (let i = 1; i <= 9; i++) {
            if (matches[i]) {
              regexStr = regexStr.replace(new RegExp('\\$' + i, 'g'), matches[i]);
              matchSet.add(matches[i])
            }
          }
          regex = new RegExp(regexStr);
          matches = el.innerHTML.match(regex);
          numReplaced += matches ? matches.length : 0;
          el.innerHTML = el.innerHTML.replace(regex, action.replace);
        });
      });
      message = `${numReplaced} replaced: ${[...matchSet].join(', ')}`;
      break;

    case 'removeDisallowedAttribute': {
      let ampErrorRegex = 'The attribute \'([^\']*)\' may not appear in tag \'([\\w-]* > )*([\\w-]*)\'';
      let ampErrorMatches = matchAmpErrors(ampErrors, ampErrorRegex);
      let matchSet = new Set();
      let numRemoved = 0;

      ampErrorMatches.forEach(matches => {
        let attribute = matches[1];
        let tag = matches[3];
        matchSet.add(attribute)
        numRemoved += matches ? matches.length : 0;

        elements = sourceDom.querySelectorAll(tag);
        elements.forEach((el) => {
          el.removeAttribute(attribute);
        });
      });

      message = `${numRemoved} removed: ${[...matchSet].join(', ')}`;
      break; }

    case 'replace':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      elements.forEach((el) => {
        elHtml = el.innerHTML;
        regex = new RegExp(action.regex, 'ig');
        matches = elHtml.match(regex, 'ig');
        numReplaced += matches ? matches.length : 0;
        elHtml = elHtml.replace(regex, action.replace);
        el.innerHTML = elHtml;
      });
      message = `${numReplaced} replaced`;
      break;

    case 'replaceOrInsert':
      el = sourceDom.querySelector(action.selector);
      if (!el) throw new Error(`No matched element(s): ${action.selector}`);

      elHtml = el.innerHTML;
      regex = new RegExp(action.regex, 'ig');
      if (elHtml.match(regex, 'ig')) {
        elHtml = elHtml.replace(regex, action.replace);
        el.innerHTML = elHtml;
        message = 'Replaced';
      } else {
        newEl = sourceDom.createElement('template');
        newEl.innerHTML = action.replace;
        newEl.content.childNodes.forEach((node) => {
          el.appendChild(node);
        });
        message = `Inserted in ${action.selector}`;
      }
      break;

    case 'insert':
      el = sourceDom.querySelector(action.selector);
      if (!el) throw new Error(`No matched element(s): ${action.selector}`);

      el.innerHTML += (action.value || '');
      message = `Inserted in ${action.selector}`;
      break;

    case 'appendAfter':
      el = sourceDom.querySelector(action.selector);
      if (!el) throw new Error(`No matched element(s): ${action.selector}`);

      newEl = sourceDom.createElement('template');
      newEl.innerHTML = action.value;
      Array.from(newEl.content.childNodes).forEach((node) => {
        el.parentNode.insertBefore(node, el.nextSibling);
      });
      message = 'Dom appended';
      break;

    case 'move':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      destEl = sourceDom.querySelector(action.destSelector);
      if (!destEl) throw new Error(`No matched element: ${action.destSelector}`);

      var movedContent = '';
      elements.forEach((el) => {
        movedContent += el.outerHTML + '\n';
        el.parentNode.removeChild(el);
      });

      destEl.innerHTML += movedContent;
      message = `Moved ${elements.length} elements`;
      break;

      // Merge multiple DOMs into one.
    case 'mergeContent':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      destEl = sourceDom.querySelector(action.destSelector);
      if (!destEl) throw new Error(`No matched element: ${action.destSelector}`);

      var mergedContent = '';
      var firstEl = elements[0];
      elements.forEach((el) => {
        mergedContent += el.innerHTML + '\n';
        el.parentNode.removeChild(el);
      });

      firstEl.innerHTML = mergedContent;
      destEl.innerHTML += firstEl.outerHTML;
      message = `Merged ${elements.length} elements`;
      break;

    case 'inlineExternalStyles':
      el = sourceDom.querySelector(action.selector);
      if (!el) throw new Error(`No matched element(s): ${action.selector}`);

      newStyles = action.minify ?
        new CleanCSS({}).minify(allStyles).styles : allStyles;

      newEl = sourceDom.createElement('style');
      newEl.appendChild(sourceDom.createTextNode(newStyles));
      el.appendChild(newEl);
      message = 'styles appended';
      break;

    case 'removeUnusedStyles':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      body = sourceDom.querySelector('body');
      oldStyles = '';
      newStyles = '';
      optimizedStyles = '';

      elements.forEach((el) => {
        // if (el.tagName !== 'style') return;
        oldStyles += el.innerHTML;

        // Use CleanCSS to prevent breaking from bad syntax.
        newStyles = new CleanCSS({
          all: false, // Disabled minification.
          format: 'beautify',
        }).minify(el.innerHTML).styles;

        // Use PurifyCSS to remove unused CSS.
        let purifyOptions = {
          minify: action.minify || false,
        };
        newStyles = purify(body.innerHTML, newStyles, purifyOptions);
        el.innerHTML = newStyles;
        optimizedStyles += '\n\n' + newStyles;
      });

      // Collect unused styles.
      if (action.outputCSS) {
        let diff = Diff.diffLines(optimizedStyles, oldStyles, {
          ignoreWhitespace: true,
        });
        let unusedStyles = '';
        diff.forEach((part) => {
          unusedStyles += part.value + '\n';
        });
        unusedStyles = new CleanCSS({
          all: false, // Disabled minification.
          format: 'beautify',
        }).minify(unusedStyles).styles;

        // Return back to action result.
        result.optimizedStyles = optimizedStyles;
        result.unusedStyles = unusedStyles;
      }

      let oldSize = oldStyles.length,
        newSize = optimizedStyles.length;
      let ratio = Math.round((oldSize - newSize) / oldSize * 100);
      message = `Removed ${ratio}% styles. (${oldSize} -> ${newSize} bytes)`;
      break;

    // customfunc not supported if requires puppeteer page
    case 'customFunc':
      elements = sourceDom.querySelectorAll(action.selector);
      if (!elements.length) throw new Error(`No matched element(s): ${action.selector}`);

      // if (action.customFunc) {
      //   await action.customFunc(action, elements, page);
      // }
      break;

    default:
      console.log(`${action.actionType} is not supported.`.red);
      break;
  }
  console.log(`\t${action.log || action.actionType}:`.reset + ` ${message}`.dim);

  // Beautify html and update to source DOM.
  html = helper.beautifyHtml(sourceDom);
  sourceDom.documentElement.innerHTML = html;

  //TODO Enable final validation
  // Validate AMP.
  //ampErrors = validateAMP(html);

  // Update page content with updated HTML.

  result.html = html;
  return result;
}


async function compileFunc(path, steps, argv) {
  console.log("Compiling...");
  console.log(core);
  //Identify if path is local or a remote URL
  var pageContent = null;
  //TODO enable URL path
  //URL path
  if (helper.validURL(path)) {
    console.log("Requesting document from URL");
    pageContent = fetch(path);
  //Local path
  } else {
    console.log("Requesting document from local path");
    try {
      pageContent = fs.readFileSync(path, 'utf8');
    } catch (err) {
      console.log(err)
    }
  }

  try {

    argv = argv || {};
    // Fix or remove dependency
    envVars = {
        '$URL': "testing",
        '$HOST': "testing",
        '$DOMAIN': "testing",
      };

    verbose = argv.hasOwnProperty('verbose');

    let customHost = argv['customHost']

    // Print warnings when missing necessary arguments.
    assert(steps, 'Missing steps');

    outputPath = argv['output'] || path.replace(/\//ig, '_');

    console.log('Output Path: ' + outputPath.green);

    // Create directory if it doesn't exist.
    mkdirp(`./output/${outputPath}/`, (err) => {
      if (err) throw new Error(`Unable to create directory ${err}`);
    });
    rimraf(`./output/${outputPath}/*`, () => {
      console.log(`Removed previous output in ./output/${outputPath}`.dim);
    });

    console.log("Created")
    // Open URL and save source to sourceDom.
    sourceDom = new JSDOM(pageContent).window.document;

    // Output initial HTML, screenshot and amp errors.
    await helper.writeToFile(`output-original.html`, pageContent);

    let i = 1;
    let stepOutput = '';
    let html = helper.beautifyHtml(sourceDom);
    let actionResult, optimizedStyles, unusedStyles, oldStyles;

    for (let i = 0; i < steps.length; i++) {
      consoleOutputs = [];
      let step = steps[i];

      if (!step.actions || step.skip) continue;
      console.log(`Step ${i+1}: ${step.name}`.yellow);

      for (let j = 0; j < step.actions.length; j++) {
        let action = step.actions[j];
        try {
          // The sourceDom will be updated after each action.
          actionResult = runCompileAction(action, sourceDom);
          html = actionResult.html;
          optimizedStyles = actionResult.optimizedStyles;
          unusedStyles = actionResult.unusedStyles;
        } catch (e) {
          if (verbose) {
            console.log(e);
          } else {
            console.log(`\t${action.log || action.type}:`.reset +
            ` Error: ${e.message}`.red);
          }
        }
      }

      // Write HTML to file.
      helper.writeToFile(`steps/output-step-${i+1}.html`, html);

      console.log("PLS")


      if (optimizedStyles) {
          helper.writeToFile(`steps/output-step-${i+1}-optimized-css.css`,
          optimizedStyles);
      }
      if (unusedStyles) {
          helper.writeToFile(`steps/output-step-${i+1}-unused-css.css`,
          unusedStyles);
      }

      // helper.writeToFile(`steps/output-step-${i+1}-validation.txt`, (ampErrors || []).join('\n'));

      // Print AMP validation result.

      // ampErrors = validateAMP(html, true /* printResult */ );
    }

    //Add the disclaimer watermark
    html = helper.addDisclaminerWatermark(html);

    // Write final outcome to file.
    await helper.writeToFile(`output-final.html`, html);

    // await helper.writeToFile(`output-final-validation.txt`, (ampErrors || []).join('\n'));



    console.log(`You can find the output files at ./output/${outputPath}/`.cyan);


    // Get doc from remote URL, or read in local file
    // Utilize step logic to parse through the text as per the amplifyFunc
  } catch (error) {
    console.log(error)
  }
}

// TODO
// Change to pass a file instead of a URL
// This should eventually contain logic for URLs
// And other cases, otherwise it's pretty redundant lol
async function compile(path, steps, argv) {
    compileFunc(path, steps, argv);
}

module.exports = {
  compile: compile,
};
