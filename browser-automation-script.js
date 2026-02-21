import puppeteer from "puppeteer-extra";
import { argv } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { tmpdir } from "node:os";
import { error } from "node:console";
// import StealthPlugin from "puppeteer-extra-plugin-stealth"; // <= for bypassing googles stupid bot detection >:(
// import { Cluster } from "puppeteer-cluster";

//Links
const browserURL = "http://127.0.0.1:21222";
const newChat = `https://aistudio.google.com/prompts/new_chat`;

//Selectors
const chatBar = `::-p-aria([name="Enter a prompt"][role=textbox])`;
const plusButton = `::-p-aria([role=button][name='Insert images, videos, audio, or files'])`;
const uploadFile = "/html/body/div[1]/div/div[2]/div/div/button[2]/span/input";
const moreOptions = `::-p-aria([role=button][name="View more actions"])`;
const rawMode = `[aria-label*='Toggle viewing raw output'][role*=menuitem]`;
const runButton = `::-p-aria([role=button][name="Run Ctrl keyboard_return"])`;
const transparentOverlay = `.cdk-overlay-backdrop.cdk-overlay-transparent-backdrop.cdk-overlay-backdrop-showing`;

//Prompts
const mainPrompt = String.raw`Role: You are an expert Mathematics Tutor and a LaTeX/TikZ developer. Your goal is to solve the worksheet provided by creating a high-quality, standalone LaTeX document compatible with Overleaf, you NEED to stick to the training files as MUCH as possible. 
  Each worksheet will be split into pages, I need you to solve the ***ENTIRE*** sheet, ***NO EXCEPTIONS***. Ignore any previous solutions.
  the first page will be sent to you now.
  Requirements for the Output:
  Format: Output a single, raw LaTeX code block starting with \documentclass{article} and ending with \end{document}.
  Visuals (Crucial):
  You must generate a TikZ diagram or PGFPlot for EVERY major step of the solution. Do not just solve it algebraically; visualize the algebraic manipulation or geometric reasoning.
  Use colors (red, blue, green) in the TikZ code to highlight specific parts of the diagrams that correspond to the current step (e.g., highlight the angle being calculated or the variable being substituted).
  Ensure all TikZ code is self-contained and compiles with standard TeX distributions (pdfLaTeX).
  separate each problem with this macro:
  use \newcommand{\coolines}{%
  \par % Ensure we start on a new line
  \vspace{70pt} % Top margin (adjusted from pixels to points)
  \noindent % Prevent indentation
  {\color{gray!50} % Sets the color; change 'gray!50' to your --border-color
  \rule{\linewidth}{1pt} % Width = full line, Height/Thickness = 1pt
  }%
  \vspace{70pt} % Bottom margin
  \noindent % Optional: keeps text after rule from being indented
  } 
  Explanations:
  Write intuitive, conversational text between the visual steps.
  Explain why a step is taken, not just what was calculated.
  LaTeX Preamble:
  Include these packages: amsmath, amssymb, tikz, pgfplots, float, geometry, xcolor.
  Set \pgfplotsset{compat=1.18}.
  Use \usepackage[margin=1in]{geometry} for better layout.
  Layout:
  Use \begin{figure}[H] to force diagrams to stay exactly where the step is described.
  Ensure equations are properly formatted using \begin{align*}.
  Tone: Educational, visual, and rigorous.
  Structure of the Response:
  Step 1: Explanation + Equation + TikZ Visualization.
  Step 2: Explanation + Equation + TikZ Visualization.
  ...
  Final Answer: Boxed result + Summary Visualization.
  make sure the code box you send it correct and no formating issues`;
const continuePrompt = String.raw`great work, now solve this page, ***ALL OF IT*** start with \coolines and ***NO*** preamble, ***NO*** \begin{document}, this code will be a PART of the rest of the document, make sure you format it for that purpose. output ***ONLY*** the LaTeX code.`;
const endPromptNotFinished = String.raw`great, you finished the worksheet, make sure end the document ,I will send you the next one now.`;
const endPromptFinished = String.raw`great, this is the last page and then we are done. make sure you end it properly with \end{document} and all.`;

// I hate this function but it keeps my code running somehow
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//arguments
let trainingFilesPath;
let worksheetFilesPath;
process.argv.splice(0, 2);
if (process.argv.length == 0) {
  console.log(
    `\n\tWelcome to AI answer keys!\n\tthere is only one command as of now, might create more later:\n\t node browser-automation-script.js --training-folder "/path/to/training/folder" --worksheets-folder "/path/to/worksheets/folder"\n`,
  );
} else if (
  process.argv[0] == "--training-folder" &&
  process.argv[2] == "--worksheets-folder"
) {
  trainingFilesPath = process.argv[1];
  worksheetFilesPath = process.argv[3];
} else {
  console.log(
    'invalid input\ntype into the terminal "node browser-automation-script.js" to get proper syntax',
  );
  process.exit(1);
}

//pdf processing functions
async function splitPDF(pdfPath, pageNumber) {
  const osTempDir = await fs.realpath(tmpdir());
  const tempPathForPDF = path.join(osTempDir, `temp-page-${pageNumber + 1}`);
  const pdf = await fs.readFile(pdfPath);
  const pdfBuffer = await PDFDocument.load(pdf);
  const tempPdf = await PDFDocument.create();
  const extractedPage = await tempPdf.copyPages(pdfBuffer, [pageNumber]);
  tempPdf.insertPage(0, extractedPage[0]);
  const newPage = await tempPdf.save();
  await fs.writeFile(tempPathForPDF, newPage);
  return tempPathForPDF;
}

async function removeNonPDFs(worksheets) {
  for (let i = 0; i < worksheets.length; i++) {
    const worksheet = worksheets[i];
    if (path.extname(worksheet) !== ".pdf") {
      worksheets.splice(i, 1);
      console.log(`Removed worksheet ${worksheet} because it isn't a pdf file`);
    }
  }
}

async function processPDF(page, pdf) {
  const fullPath = path.join(worksheetFilesPath, pdf);
  const bytebuffer = await fs.readFile(fullPath);
  const worksheet = await PDFDocument.load(bytebuffer);
  const pages = worksheet.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pagePath = await splitPDF(fullPath, i);
    await uploadFiles(page, pagePath);
    await fs.rm(pagePath);
    if (i === 0) {
      await sendPrompt(page, mainPrompt);
    } else if (i < pages.length - 1) {
      await sendPrompt(page, endPromptNotFinished);
    } else {
      await sendPrompt(page, endPromptFinished);
    }
    await waitTillReply(page, runButton);
  }
  await extractLaTeXCode(page, pdf);
}

//browser automation functions
async function uploadFiles(page, Path) {
  console.log("Uploading files...");
  await sleep(500);
  await page.click(plusButton);
  console.log("plus button clicked");
  const uploadFileElementHandle = await page.waitForSelector(
    "xpath/" + uploadFile,
  );
  const stats = await fs.lstat(Path);
  if (stats.isDirectory()) {
    const trainingFiles = await fs.readdir(Path);
    for (const file of trainingFiles) {
      await uploadFileElementHandle.uploadFile(path.join(Path, file));
      console.log(`${file} uploaded successfully!`);
    }
  } else if (stats.isFile()) {
    await uploadFileElementHandle.uploadFile(Path);
    console.log("worksheet page uploaded successfully!");
  }
}

async function cleanUpFile(file) {
  let content = await fs.readFile(file, "utf-8");
  //replace \n with actual new lines
  content = content.replace(/\\n/g, "\n");
  content = content.replace(/\\"/g, '"');
  let lines = content.split("\n");
  lines.splice(0, 2);
  lines.splice(lines.length - 2, 2);
  content = lines.join("\n");
  await fs.writeFile(file, content);
  console.log("file cleaned up");
}

async function extractLaTeXCode(page, fileName) {
  const name = path.parse(fileName);
  const filePath = path.join(worksheetFilesPath, `${name}.key.TeX`);
  let tempString = "";
  tempString += file;
  await page.waitForSelector(
    `.chat-turn-container.code-block-aligner.model.render.ng-star-inserted`,
    { visible: true },
  );
  let replies = await page.$$(
    `.chat-turn-container.code-block-aligner.model.render.ng-star-inserted`,
  );
  for (let i = 0; i < replies.length; i++) {
    if (i % 2 !== 0) {
      const el = await replies[i].evaluate((e) => e.innerText);
      tempString += el;
      console.log(`appended ${i}-th reply to temporary string`);
    }
  }
  await fs.writeFile(filePath, tempString);
  await cleanUpFile(filePath);
}

async function ensureRawModeEnabled(page) {
  await page.click(moreOptions);
  console.log("clicked more options");
  const rawModeSelector = await page.$(rawMode);
  const snapshot = await page.accessibility.snapshot({
    root: rawModeSelector,
  });
  await sleep(250);
  if (snapshot.description === "Show conversation with markdown formatting") {
    console.log("raw mode is already enabled.");
    await page.click(transparentOverlay);
  } else {
    await page.click(rawMode);
    console.log("enabled raw mode");
  }
}

async function waitTillReply(page, runButton) {
  console.log("waiting for model to finish replying...");
  await page.waitForFunction(
    () => {
      const button = document.querySelector(runButton);
      const text = button.innerText.trim();
      return button && !(text !== String.raw`progress_activity\nStop`);
    },
    {
      timeout: 0,
    },
  );
  console.log("model finished replying.");
}

async function run(page) {
  await page.$eval(runButton, (el) => el.click());
}

async function sendPrompt(page, prompt) {
  console.log("Sending prompt...");
  await page.focus(chatBar);
  await page.type(chatBar, prompt);
  await run(page);
  console.log("Prompt sent!");
}

(async function main() {
  const browser = await puppeteer.launch({
    defaultViewport: null,
    headless: false,
    userDataDir: "./userdata",
  });
});

(async function testing() {
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL,
      defaultViewport: null,
    });
    const [page] = await browser.pages();
    await page.goto(newChat);
    await ensureRawModeEnabled(page);
    const worksheets = await fs.readdir(worksheetFilesPath);
    await removeNonPDFs(worksheets);
    for (const worksheet of worksheets) {
      await uploadFiles(page, trainingFilesPath);
      await processPDF(page, worksheet);
      await page.goto(newChat);
    }
    await browser.disconnect();
  } catch (error) {
    console.log("Script failed with error: ", error);
  } finally {
    if (browser) await browser.disconnect();
  }
})();
/**
 * TODO: fix the absorbtion of replies and some debugging and error handling
 */
