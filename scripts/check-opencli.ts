import { execFile } from "node:child_process";
import { promisify, styleText } from "node:util";
import { coerce, gte, lt, valid } from "semver";
import { config } from "@/config.js";
import { MIN_OPENCLI_VERSION } from "@/fetcher/opencli.js";

const execFileAsync = promisify(execFile);

const REGISTRY_URL = "https://registry.npmjs.org/@jackwener/opencli/latest";
const INSTALL_HINT = "pnpm add -g @jackwener/opencli@latest";

async function getLocalVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(config.opencli.binaryPath, [
      "--version",
    ]);
    const raw = stdout.trim();
    return valid(raw) ?? coerce(raw)?.version ?? null;
  } catch {
    return null;
  }
}

async function getLatestVersion(): Promise<string> {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) {
    throw new Error(`npm registry returned HTTP ${res.status}`);
  }
  const { version } = (await res.json()) as {
    version: string;
  };
  return version;
}

const dim = (s: string) => styleText("dim", s);
const green = (s: string) => styleText("green", s);
const yellow = (s: string) => styleText("yellow", s);
const red = (s: string) => styleText("red", s);
const bold = (s: string) => styleText("bold", s);

function row(label: string, value: string): void {
  console.log(`  ${dim(label.padEnd(10))}  ${value}`);
}

async function main(): Promise<void> {
  console.log(bold("opencli version check"));
  console.log("");

  const [local, latest] = await Promise.all([
    getLocalVersion(),
    getLatestVersion().catch((err: Error) => {
      console.log(red(`✗ failed to fetch latest version: ${err.message}`));
      process.exit(2);
    }),
  ]);

  row("binary", config.opencli.binaryPath);
  row("local", local ?? red("not found"));
  row("latest", latest);
  row("min req", MIN_OPENCLI_VERSION);
  console.log("");

  if (!local) {
    console.log(red("✗ opencli not installed or not in PATH"));
    console.log(dim(`  install: ${INSTALL_HINT}`));
    process.exit(2);
  }

  if (lt(local, MIN_OPENCLI_VERSION)) {
    console.log(
      red(`✗ local ${local} is below required ${MIN_OPENCLI_VERSION}`),
    );
    console.log(dim(`  upgrade: ${INSTALL_HINT}`));
    process.exit(2);
  }

  if (gte(local, latest)) {
    console.log(green(`✓ up to date (${local})`));
    process.exit(0);
  }

  console.log(yellow(`⚠ newer version available: ${local} → ${latest}`));
  console.log(dim(`  upgrade: ${INSTALL_HINT}`));
  process.exit(0);
}

main();
