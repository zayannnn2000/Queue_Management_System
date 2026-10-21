// Renders docs/documentation.html to docs/documentation.pdf (A4) with Playwright.
// Usage: node scripts/docs-pdf.mjs
import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = path.join(root, "docs", "documentation.html");
const pdf = path.join(root, "docs", "documentation.pdf");

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href);
await page.pdf({ path: pdf, format: "A4", preferCSSPageSize: true, printBackground: true });
await browser.close();
console.log(`Wrote ${pdf}`);
