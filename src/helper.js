/**
 * Contains helper functions for core and compile.js
 */
const path = require('path');
const beautify = require('js-beautify').html;
const colors = require('colors');
const amphtmlValidator = require('amphtml-validator');
const fse = require('fs-extra');
const argv = require('minimist')(process.argv.slice(2));
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const watermarkTpl = require('./watermark');
const fs = require('fs');



function replaceEnvVars(str) {
    Object.keys(envVars).forEach((key) => {
      if (typeof str === 'string') {
        str = str.replace(key, envVars[key]);
      }
    });
    return str;
}
  
async function collectStyles(response) {
if (response.request().resourceType() === 'stylesheet') {
    let url = await response.url();
    let text = await response.text();
    allStyles += text;
    styleByUrls[url] = text;
}
}

async function validateAMP(html, printResult) {
const ampValidator = await amphtmlValidator.getInstance();
let errors = [];

let result = ampValidator.validateString(html);
if (result.status === 'PASS') {
    if (printResult) console.log('\tAMP validation successful.'.green);
} else {
    result.errors.forEach((e) => {
    var msg = `line ${e.line}, col ${e.col}: ${e.message}`;
    if (e.specUrl) msg += ` (see ${e.specUrl})`;
    if (verbose) console.log('\t' + msg.dim);
    errors.push(msg);
    });
    if (printResult)
    console.log(`\t${errors.length} AMP validation errors.`.red);
}
return Promise.resolve(errors);
}

function matchAmpErrors(errors, ampErrorsRegex) {
let resultSet = new Set();
errors.forEach(error => {
    let matches = error.match(new RegExp(ampErrorsRegex));
    if (matches) {
    resultSet.add(matches);
    }
});
return resultSet;
}

function beautifyHtml(sourceDom) {
// Beautify html.
let html = beautify(sourceDom.documentElement.outerHTML, {
    indent_size: 2,
    preserve_newlines: false,
    content_unformatted: ['script', 'style'],
});
return '<!DOCTYPE html>\n' + html;
}

async function writeToFile(filename, html) {
    let filePath = path.resolve(`./output/${outputPath}/${filename}`);
    console.log(filePath)
    try {
        fse.outputFileSync(filePath, html);
    } catch (err){
        console.error(err);
    }
}
//add disclaimer watermark
//TODO: refactor disclaimer text to a static file
function addDisclaminerWatermark(html) {
console.log('Adding disclaimer'.yellow);
let bodyTag = html.match(/<body[^>]*>/);
return bodyTag ? html.replace(bodyTag, bodyTag + watermarkTpl) : html;
}

async function compareImages(image1Path, image2Path, diffPath, computedHeight, computedWidth, page, backgroundImage, server, replacementPath){
const img1 = PNG.sync.read(fse.readFileSync(image1Path));
let img2 = PNG.sync.read(fse.readFileSync(image2Path));

let {width, height} = img1;
if(img1.height > img2.height) {
    img2 = await resizeImage(computedHeight, computedWidth, backgroundImage, replacementPath, server, page);
}
const diff = new PNG({width,height});
const mismatch = runComparison(img1.data, img2.data, diff, width, height);

console.log(`Difference between original and converted: ${((mismatch/(width * height)) * 100).toFixed(2)}%`);

fse.writeFileSync(diffPath, PNG.sync.write(diff));
}

async function resizeImage(height, width, imageLocation, replacementPath, server, page) {
server = httpServer.createServer({root:`output/${outputPath}/`});
await server.listen(port, '127.0.0.1', () => {
});
await page.goto(`http://127.0.0.1:${port}`);
const newscreenshot = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1">
    </head>
    <body style="padding:0;margin:0;">
    <div style="padding:0; margin:0; max-height:${height}; height:${height};width:${width};background:url(${imageLocation}) no-repeat; background-size: contain;">

    </div>
    </body>
    </html>
`;
await page.setContent(newscreenshot);
// Uncomment if you want to debug
await writeToFile(`output-replace.html`, await page.content());
await page.screenshot({
    path: replacementPath,
    fullPage: argv['fullPageScreenshot']
});
await server.close();
return PNG.sync.read(fse.readFileSync(replacementPath));
}

function runComparison(img1Data, img2Data, diff, width, height){
return pixelmatch(img1Data, img2Data, diff.data, width, height, {threshold: 0.1});
}

// Check if a string is a URL for compiler
function validURL(str) {
    var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
      '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
      '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
      '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
    return !!pattern.test(str);
}
  

module.exports = {
    replaceEnvVars: replaceEnvVars,
    collectStyles: collectStyles,
    validateAMP: validateAMP,
    matchAmpErrors: matchAmpErrors,
    beautifyHtml: beautifyHtml,
    writeToFile: writeToFile,
    addDisclaminerWatermark: addDisclaminerWatermark,
    compareImages: compareImages,
    resizeImage: resizeImage,
    runComparison: runComparison,
    validURL: validURL
}