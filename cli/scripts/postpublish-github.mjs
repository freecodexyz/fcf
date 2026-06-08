import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);
const repoRootUrl = new URL("../..", import.meta.url);
const packageJson = JSON.parse(readFileSync(packageUrl, "utf8"));

if (isTrue(process.env.npm_config_dry_run) || isTrue(process.env.NPM_CONFIG_DRY_RUN)) {
  console.log("Skipping GitHub release for dry-run publish.");
  process.exit(0);
}

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.NODE_AUTH_TOKEN ?? ghAuthToken();
if (!token) {
  throw Error("GH_TOKEN, GITHUB_TOKEN, NODE_AUTH_TOKEN, or gh auth is required to create a GitHub Release.");
}

const repository = githubRepositoryFromPackage() ?? githubRepositoryFromOrigin();
if (!repository) {
  throw Error("Could not determine GitHub repository from package.json or origin remote.");
}

const distTag = process.env.npm_config_tag ?? process.env.NPM_CONFIG_TAG ?? process.env.pnpm_config_tag ?? "latest";
const version = packageJson.version;
const packageName = packageJson.name;
const tagName = `cli-v${version}`;
const releaseName = `${packageName} v${version}`;
const prerelease = distTag !== "latest" || version.includes("-");
const targetCommitish = git(["rev-parse", "HEAD"]);

const releasePayload = {
  tag_name: tagName,
  name: releaseName,
  generate_release_notes: true,
  prerelease,
  make_latest: prerelease ? "false" : "true",
  ...(targetCommitish ? { target_commitish: targetCommitish } : {}),
};

let release;
let created = true;
try {
  release = await githubRequest("POST", `/repos/${repository}/releases`, releasePayload);
} catch (error) {
  if (error.status !== 422) throw error;
  release = await githubRequest("GET", `/repos/${repository}/releases/tags/${encodeURIComponent(tagName)}`);
  created = false;
}

const changed = updateChangelog(release);
console.log(`${created ? "Created" : "Found"} GitHub Release: ${release.html_url}`);
if (changed) console.log("Updated CHANGELOG.md with GitHub-generated release notes.");

function updateChangelog(release) {
  const marker = `<!-- ${tagName} -->`;
  const existing = existsSync(changelogUrl) ? readFileSync(changelogUrl, "utf8") : "# Changelog\n";
  if (existing.includes(marker)) return false;

  const date = new Date().toISOString().slice(0, 10);
  const body = release.body?.trim() || `GitHub Release: ${release.html_url}`;
  const entry = `${marker}\n## ${releaseName} - ${date}\n\n${body}\n`;
  const normalized = existing.trimEnd();
  writeFileSync(changelogUrl, `${normalized}\n\n${entry}\n`);
  return true;
}

async function githubRequest(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${packageName}-publish`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = Error(`GitHub ${method} ${path} failed: ${response.status} ${response.statusText}\n${text}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function githubRepositoryFromPackage() {
  const repository = packageJson.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  return parseGitHubRepository(url);
}

function githubRepositoryFromOrigin() {
  return parseGitHubRepository(git(["config", "--get", "remote.origin.url"]));
}

function parseGitHubRepository(value) {
  if (!value) return undefined;
  const url = value.trim().replace(/^git\+/, "");
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;

  const https = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (https) return `${https[1]}/${https[2]}`;

  return undefined;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRootUrl, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function ghAuthToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function isTrue(value) {
  return value === "true" || value === "1";
}
