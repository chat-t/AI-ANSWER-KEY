import puppeteer from "puppeteer";
import { argv } from "node:process";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { tmpdir } from "node:os";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async function () {
  const browserURL = "http://127.0.0.1:21222";
  const browser = await puppeteer.connect({
    browserURL,
    defaultViewport: null,
  });
  const [page] = await browser.pages();
  const chat_bar = `::-p-aria([name="Enter a prompt"][role=textbox])`;
  const plus_button = `::-p-aria([role=button][name='Insert images, videos, audio, or files'])`;
  const plus_button_selector = await page.$(plus_button);
  const upload_file =
    "/html/body/div[1]/div/div[2]/div/div/button[2]/span/input";
  const more_options = `::-p-aria([role=button][name="View more actions"])`;
  const raw_mode = `[aria-label*='Toggle viewing raw output'][role*=menuitem]`;
  const continue_prompt = String.raw`
    great work, now solve this page, ***ALL OF IT*** start with \coolines and ***NO*** preamble, ***NO*** \begin{document}, this code will be a PART of the rest of the document, make sure you format it for that purpose. output ***ONLY*** the LaTeX code. 
        `;
  const end_prompt_not_finished = String.raw`great, you finished the worksheet, make sure end the document ,I will send you the next one now.`;
  const end_prompt_finished = String.raw`great, this is the last page, and then we are done. make sure you end it properly with \end{document}.`;
  const main_prompt_sent = false;
  const run_button = `::-p-aria([role=button][name="Run Ctrl keyboard_return"])`;

  async function clean_up_file(file) {
    let content = fs.readFileSync(file, "utf-8");
    content = content.replace(/\\n(?![a-zA-Z])/g, "\n");
    let lines = content.split("\n");
    lines.splice(0, 2);
    lines.splice(lines.length - 2, 2);
    content = lines.join("\n");
    fs.writeFileSync(file, content, "utf-8");
    console.log("file cleaned up");
  }

  function todo(function_name) {
    (async function () {
      const ini = await initLip();
      const lip = new Lipgloss();
      console.log(
        lip.RenderMD(`${function_name} is not implemented`, "dracula"),
      );
    })();
  }

  async function extract_LaTeX_code(LaTeX_file) {
    let File = await fs.readFile(LaTeX_file, "utf-8");
    let temp_string = "";
    temp_string += File;
    let replies = await page.$$(
      `.chat-turn-container.code-block-aligner.model.render.ng-star-inserted`,
    );
    await page.waitForSelector(
      `.chat-turn-container.code-block-aligner.model.render.ng-star-inserted`,
      { visible: true },
    );
    for (let i = 0; i < replies.length; i++) {
      if (i % 2 !== 0) {
        const el = await replies[i].evaluate((e) => e.innerText);
        temp_string += el;
        console.log(`appended ${i}-th reply to temporary string`);
      }
    }
    await fs.writeFile(LaTeX_file, temp_string);
    await clean_up_file(LaTeX_file);
  }

  function readFileAsync(file) {
    return new Promise((resolve, reject) => {
      let reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result);
      };
      reader.error = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async function send_prompt() {
    let main_prompt = String.raw`
  Role: You are an expert Mathematics Tutor and a LaTeX/TikZ developer. Your goal is to solve the worksheet provided by creating a high-quality, standalone LaTeX document compatible with Overleaf, you NEED to stick to the training files as MUCH as possible. 
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

    //sending first prompt
    console.log("sending AIStudio the main prompt...");
    await page.type(chat_bar, main_prompt);
    console.log("prompt sent successfully!");
  }

  async function send_a_single_page(i, pdf, len, name) {
    const plus_button_clicked = await page.evaluate(
      (el) => el.getAttribute("aria-expanded"),
      plus_button_selector,
    );
    const page_number = [i];
    console.log(`uploading page ${i + 1}/${len} from ${name}...`);
    const temppdf = await PDFDocument.create();
    await temppdf.copyPages(pdf, page_number);
    const extracted_page = await temppdf.save();
    const temp_path = await path.join(
      await fs.realpath(tmpdir()),
      `temp-page-${i + 1}.pdf`,
    );
    await fs.writeFile(temp_path, extracted_page);
    if (plus_button_clicked === "false") {
      await page.click(plus_button);
    }
    const upload_file_selector = await page.waitForSelector(
      `xpath//${upload_file}`,
    );
    await upload_file_selector.uploadFile(temp_path);
    await sleep(500);
    await fs.rm(temp_path);
    console.log("page uploaded successfully!");
  }

  async function upload_training_files(path_to_training_folder) {
    await page.click(plus_button);
    const worksheets = await fs.readdir(path_to_training_folder);
    for (const curr of worksheets) {
      if (path.extname(curr) === ".pdf") {
        console.log(`uploading ${curr}...`);
        const file_path = path.join(path_to_training_folder, curr);
        const file_input = await page.waitForSelector(`xpath//${upload_file}`);
        await file_input.uploadFile(file_path);
        console.log(`${curr} uploaded!`);
      }
    }
  }

  function take_in_commands() {
    argv.splice(0, 2);
    if (argv == []) {
      const tutorial = `
  Welcome to AI answer keys!
  
  there is only one command as of now, might create more later:
  
  --training-folder "/path/to/training/folder" --worksheets-folder "/path/to/worksheets/folder"`;
      console.log(tutorial);
      return { path_to_training_folder: null, path_to_worksheets_folder: null };
    } else if (
      argv[0] == "--training-folder" &&
      argv[2] == "--worksheets-folder"
    ) {
      return {
        path_to_training_folder: argv[1],
        path_to_worksheets_folder: argv[3],
      };
    } else {
      const error = `
  You have entered either a non-existing command or have entered it wrong, for proper syntax type in: node main.js
        `;
      console.error(error);
      return { path_to_training_folder: null, path_to_worksheets_folder: null };
    }
  }
  //take in arguments
  const { path_to_training_folder, path_to_worksheets_folder } =
    take_in_commands();
  //enable raw mode
  await page.click(more_options);
  console.log("clicked more options");
  await sleep(500);
  await page.waitForSelector(raw_mode);
  await page.click(raw_mode);
  console.log("enabled raw mode");
  await send_prompt();
  await upload_training_files(path_to_training_folder);
  const worksheets = await fs.readdir(path_to_worksheets_folder);
  // let keep_track_of_worksheets = {};
  let idx = 0;
  for (const curr of worksheets) {
    if (path.extname(curr) === ".json") {
      keep_track_of_worksheets = require(
        path.join(path_to_worksheets_folder, curr),
      );
    }
    if (path.extname(curr) !== ".pdf") {
      worksheets.splice(idx, 1);
    }
    idx++;
  }

  let idx2 = 0;
  for (const current_worksheet of worksheets) {
    const path_to_current_sheet = path.join(
      path_to_worksheets_folder,
      current_worksheet,
    );
    const pdf_buffer = await fs.readFile(path_to_current_sheet);
    const pdf = await PDFDocument.load(pdf_buffer);
    const pages_to_loop_through = await pdf.getPages();
    // let i =
    //   Object.values(keep_track_of_worksheets).indexOf(current_worksheet) > -1
    //     ? keep_track_of_worksheets[current_worksheet]
    //     : 0;
    for (let i = 0; i < pages_to_loop_through.length; i++) {
      if (!main_prompt_sent) {
        await send_a_single_page(
          i,
          pdf,
          pages_to_loop_through.length,
          current_worksheet,
        );
        await page.click(run_button);
      } else if (i + 1 !== pages_to_loop_through.length) {
        await send_a_single_page(
          i,
          pdf,
          pages_to_loop_through.length,
          current_worksheet,
        );
        await page.type(chat_bar, continue_prompt);
        await page.click(run_button);
      } else if (
        i + 1 == pages_to_loop_through.length &&
        idx2 + 1 != worksheets.length
      ) {
        await send_a_single_page(
          i,
          pdf,
          pages_to_loop_through.length,
          current_worksheet,
        );
        await page.type(chat_bar, end_prompt_not_finished);
        await page.click(run_button);
        const TeX_file = path.join(
          path_to_worksheets_folder,
          `${curr}.key.TeX`,
        );
        await fs.writeFile(TeX_file);
        await extract_LaTeX_code(TeX_file);
      } else {
        await send_a_single_page(
          i,
          pdf,
          pages_to_loop_through.length,
          current_worksheet,
        );
        await page.type(chat_bar, end_prompt_finished);
        await page.click(run_button);
      }
    }
    idx2++;
  }
})();
