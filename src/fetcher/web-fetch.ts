import type { Browser } from "playwright";
import { chromium } from "playwright";
import { config } from "../config.js";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.connectOverCDP(config.playwright.cdpUrl);
  }
  return browser;
}

export async function fetchPageContent(url: string): Promise<string> {
  const b = await getBrowser();
  const context = b.contexts()[0] ?? (await b.newContext());
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
    return await page.content();
  } finally {
    await page.close();
  }
}
