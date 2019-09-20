/**
 * Functions that run through steps provided via cli (or default) for compiling AMP
 */
require('colors');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const purify = require("purify-css")
const CleanCSS = require('clean-css');
const Diff = require('diff');
const assert = require('assert');
const {
  JSDOM
} = require("jsdom");
const fs = require('fs');
const path = require('path');
const beautify = require('js-beautify').html;
const fse = require('fs-extra');

function runCompileAction(action, sourceDom) {
    let elements, el, destEl, elHtml, regex, matches, newEl, body;
    let numReplaced = 0,
        oldStyles = '',
        newStyles = '',
        optimizedStyles = '';
    let message = action.actionType;
    let result = {};

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
    html = beautifyHtml(sourceDom);
    sourceDom.documentElement.innerHTML = html;

    // Update page content with updated HTML.
    result.html = html;
    return result;
}

async function compileFunc(path, steps, argv) {
    //Access file contents
    var pageContent = null;
    console.log("Requesting document from local path");
    try {
        pageContent = fs.readFileSync(path, 'utf8');
    } catch (err) {
        console.log(err)
    }

    //Check arguments
    argv = argv || {};
    let verbose = argv.hasOwnProperty('verbose');
    let saveSteps = argv.hasOwnProperty('saveSteps');
    customOutput = argv.hasOwnProperty('output');

    //Print warnings when missing necessary arguments.
    assert(steps, 'Missing steps');

    //Setup output filepath (replace / with _)
    var pos = path.lastIndexOf(".");
    outputPath = argv['output'] || path.substr(0, pos < 0 ? path.length : pos) + ".amp.html";
    var outputDirectory = outputPath.substring(0, outputPath.lastIndexOf("/"));
    console.log('Output Path: ' + outputPath.cyan);
    console.log('Output Directory: ' + outputDirectory.cyan);

    // Create custom output directory if it doesn't exist.
    if(saveSteps){
        mkdirp(`./${outputDirectory}/compile_steps/`, (err) => {
            if (err) throw new Error(`Unable to create directory ${err}`);
            console.log("Created", `./${outputDirectory}/compile_steps/*`);
        });
        rimraf(`./${outputDirectory}/compile_steps/*`, () => {
            console.log(`Removed previous output in ./compile_steps/${outputPath}`.dim);
        });
        console.log("Created", `./${outputDirectory}/compile_steps/*`);
    }

    
    // Open URL and save source to sourceDom.
    sourceDom = new JSDOM(pageContent).window.document;

    let actionResult, optimizedStyles, unusedStyles;
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
        
        // After each step Write HTML to file if user indicates
        if(saveSteps){
                writeToFile(`${outputDirectory}/compile_steps/output-step-${i+1}.html`, html);

                if (optimizedStyles) {
                    writeToFile(`${outputDirectory}/compile_steps/output-step-${i+1}-optimized-css.css`,
                    optimizedStyles);
                }

                if (unusedStyles) {
                    writeToFile(`${outputDirectory}/compile_steps/output-step-${i+1}-unused-css.css`,
                    unusedStyles);
                }
        }
    }

    // Write final outcome to file.
    await writeToFile(outputPath, html);
    console.log(`You can find the output files at ./output/${outputPath}/`.cyan);
}

function beautifyHtml(sourceDom) {
    // Beautify html.
    let html = beautify(sourceDom.documentElement.outerHTML, {
        indent_size: 4,
        preserve_newlines: false,
        content_unformatted: ['script', 'style'],
    });
    return '<!DOCTYPE html>\n' + html;
}

async function writeToFile(filepath, html) {
    let filePath;
    filePath = path.resolve(`./${filepath}`);
    console.log(filePath)
    
    try {
        fse.outputFileSync(filePath, html)
    } catch (err){
        console.error(err);
    }
}

module.exports = {
    compile: compileFunc
};
