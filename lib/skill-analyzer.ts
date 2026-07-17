export type Severity = "critical" | "error" | "warning" | "info";
export type Risk = "low" | "medium" | "high" | "critical";

export interface Location {
  path: string;
  line?: number;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  location: Location;
}

export interface CapabilityEntry {
  name: string;
  evidence: Location[];
}

export interface SideEffect extends CapabilityEntry {
  kind: string;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface SkillBundle {
  sourceUrl: string;
  repository: string;
  skillPath: string;
  files: SourceFile[];
}

export interface SkillReport {
  sourceUrl: string;
  repository: string;
  skillPath: string;
  name: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  risk: Risk;
  filesScanned: number;
  findings: Finding[];
  capabilities: {
    commands: CapabilityEntry[];
    environment: CapabilityEntry[];
    networkHosts: CapabilityEntry[];
    fileWrites: CapabilityEntry[];
    sideEffects: SideEffect[];
  };
}

type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  size?: number;
};

const RULES: Record<string, { severity: Severity; title: string }> = {
  SP002: { severity: "critical", title: "Invalid frontmatter" },
  SP003: { severity: "error", title: "Invalid skill name" },
  SP004: { severity: "error", title: "Missing description" },
  SP005: { severity: "warning", title: "Folder and skill name differ" },
  SP006: { severity: "warning", title: "Weak description" },
  SP008: { severity: "warning", title: "Unresolved placeholder" },
  SP009: { severity: "warning", title: "Oversized SKILL.md" },
  SP010: { severity: "error", title: "Missing referenced resource" },
  SP011: { severity: "critical", title: "Reference escapes skill root" },
  SP100: { severity: "critical", title: "Possible embedded secret" },
  SP101: { severity: "critical", title: "Remote code piped to a shell" },
  SP102: { severity: "error", title: "Destructive command" },
  SP103: { severity: "critical", title: "Possible environment exfiltration" },
  SP104: { severity: "warning", title: "User-specific absolute path" },
};

const PENALTY: Record<Severity, number> = {
  critical: 30,
  error: 15,
  warning: 5,
  info: 1,
};

const TEXT_EXTENSIONS = new Set([
  ".md", ".mdc", ".txt", ".yaml", ".yml", ".json", ".toml", ".sh", ".bash",
  ".zsh", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css",
]);

const COMMON_COMMANDS = new Set([
  "agent-browser", "apt", "apt-get", "bash", "brew", "bun", "cargo", "cat", "chmod", "cp",
  "curl", "deno", "docker", "docker-compose", "ffmpeg", "gh", "git", "go", "helm", "jq", "just",
  "kubectl", "make", "mkdir", "mv", "node", "npm", "npx", "osascript", "pip", "pip3", "pnpm",
  "poetry", "python", "python3", "rg", "rm", "ruby", "rustc", "tee", "terraform", "touch", "uv",
  "uvx", "wget", "yarn", "zsh",
]);

function extension(filePath: string) {
  const match = filePath.match(/(\.[A-Za-z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

function dirname(filePath: string) {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "" : filePath.slice(0, index);
}

function basename(filePath: string) {
  return filePath.split("/").filter(Boolean).pop() ?? filePath;
}

function joinPath(...parts: string[]) {
  const stack: string[] = [];
  for (const part of parts.join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function grade(score: number): SkillReport["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function githubError(response: Response) {
  if (response.status === 403 || response.status === 429) {
    return new Error("GitHub’s public API limit has been reached. Please try again later.");
  }
  if (response.status === 404) {
    return new Error("Repository, branch, or Skill path not found. Only public GitHub repositories are supported.");
  }
  return new Error(`GitHub returned ${response.status}. Please check the URL and try again.`);
}

function parseGitHubUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Enter a complete GitHub URL.");
  }
  if (parsed.hostname !== "github.com") throw new Error("Only public github.com Skill URLs are supported.");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("The GitHub URL must include an owner and repository.");
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/, "");
  const mode = parts[2];
  let ref: string | undefined;
  let target = "";
  if (mode === "tree" || mode === "blob") {
    ref = parts[3];
    target = parts.slice(4).join("/");
    if (mode === "blob" && target.endsWith("SKILL.md")) target = dirname(target);
  }
  return { owner, repo, ref, target };
}

export async function fetchPublicSkill(sourceUrl: string): Promise<SkillBundle> {
  const parsed = parseGitHubUrl(sourceUrl);
  let ref = parsed.ref;
  if (!ref) {
    const repositoryResponse = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!repositoryResponse.ok) throw githubError(repositoryResponse);
    const repository = (await repositoryResponse.json()) as { default_branch?: string };
    ref = repository.default_branch;
  }
  if (!ref) throw new Error("The repository has no default branch.");

  const treeResponse = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!treeResponse.ok) throw githubError(treeResponse);
  const treeData = (await treeResponse.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  if (treeData.truncated) throw new Error("This repository is too large for a safe public scan. Link directly to the Skill folder.");
  const tree = treeData.tree ?? [];
  const skillCandidates = tree
    .filter((entry) => entry.type === "blob" && basename(entry.path) === "SKILL.md")
    .filter((entry) => !parsed.target || entry.path === `${parsed.target}/SKILL.md` || entry.path.startsWith(`${parsed.target}/`))
    .sort((left, right) => left.path.length - right.path.length);
  const skillEntry = skillCandidates[0];
  if (!skillEntry) throw new Error("No SKILL.md was found at that repository path.");

  const root = dirname(skillEntry.path);
  const sourceEntries = tree
    .filter((entry) => entry.type === "blob")
    .filter((entry) => entry.path === skillEntry.path || (root && entry.path.startsWith(`${root}/`)))
    .filter((entry) => TEXT_EXTENSIONS.has(extension(entry.path)))
    .filter((entry) => (entry.size ?? 0) <= 256_000)
    .slice(0, 80);

  let totalSize = 0;
  const files: SourceFile[] = [];
  for (const entry of sourceEntries) {
    const size = entry.size ?? 0;
    if (totalSize + size > 1_000_000) break;
    const rawPath = entry.path.split("/").map(encodeURIComponent).join("/");
    const rawResponse = await fetch(
      `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeURIComponent(ref)}/${rawPath}`,
    );
    if (!rawResponse.ok) continue;
    files.push({
      path: root ? entry.path.slice(root.length + 1) : entry.path,
      content: await rawResponse.text(),
    });
    totalSize += size;
  }

  if (!files.some((file) => file.path === "SKILL.md")) {
    throw new Error("SKILL.md could not be read from GitHub.");
  }

  return {
    sourceUrl,
    repository: `${parsed.owner}/${parsed.repo}`,
    skillPath: root || "/",
    files,
  };
}

function addEntry(map: Map<string, Location[]>, name: string, location: Location) {
  const normalized = name.trim();
  if (!normalized) return;
  const locations = map.get(normalized) ?? [];
  if (locations.length < 4 && !locations.some((item) => item.path === location.path && item.line === location.line)) {
    locations.push(location);
  }
  map.set(normalized, locations);
}

function entries(map: Map<string, Location[]>): CapabilityEntry[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, evidence]) => ({ name, evidence }));
}

function shellSnippets(file: SourceFile) {
  const lines = file.content.split(/\r?\n/);
  if ([".sh", ".bash", ".zsh"].includes(extension(file.path))) {
    return lines.map((text, index) => ({ text, line: index + 1 }));
  }
  if (![".md", ".mdc"].includes(extension(file.path))) return [];
  const snippets: Array<{ text: string; line: number }> = [];
  let shellFence = false;
  lines.forEach((text, index) => {
    const fence = text.match(/^\s*```\s*([A-Za-z0-9_-]*)/);
    if (fence) {
      shellFence = shellFence ? false : ["bash", "sh", "shell", "zsh", "console", "terminal"].includes((fence[1] ?? "").toLowerCase());
      return;
    }
    if (shellFence) snippets.push({ text, line: index + 1 });
    for (const inline of text.matchAll(/`([^`\n]+)`/g)) {
      if (inline[1]) snippets.push({ text: inline[1], line: index + 1 });
    }
  });
  return snippets;
}

function inferCapabilities(files: SourceFile[]) {
  const commands = new Map<string, Location[]>();
  const environment = new Map<string, Location[]>();
  const networkHosts = new Map<string, Location[]>();
  const fileWrites = new Map<string, Location[]>();
  const effects = new Map<string, { name: string; evidence: Location[] }>();
  let critical = false;

  const addEffect = (kind: string, name: string, location: Location) => {
    const current = effects.get(kind) ?? { name, evidence: [] };
    if (current.evidence.length < 4 && !current.evidence.some((item) => item.path === location.path && item.line === location.line)) current.evidence.push(location);
    effects.set(kind, current);
  };

  for (const file of files) {
    for (const snippet of shellSnippets(file)) {
      const location = { path: file.path, line: snippet.line };
      for (const match of snippet.text.matchAll(/\b([A-Za-z0-9][A-Za-z0-9._-]*)\b/g)) {
        if (match[1] && COMMON_COMMANDS.has(match[1])) addEntry(commands, match[1], location);
      }
      if (/(?:^|\s)(?:cp|mv|touch|mkdir|chmod|rm)\s|(?:^|[^>])>>?[^=]|\btee\s/.test(snippet.text)) {
        const target = snippet.text.match(/(?:>>?|\btee\s+(?:-a\s+)?|\b(?:cp|mv|touch|mkdir|chmod|rm)\s+(?:-[A-Za-z]+\s+)*)([^\s;|]+)/)?.[1] ?? "dynamic path";
        addEntry(fileWrites, target.replace(/["'`,)]*$/, ""), location);
        const deleting = /\brm\b/.test(snippet.text);
        addEffect(deleting ? "file-delete" : "file-write", deleting ? "May delete local files" : "May write local files", location);
      }
      if (/\b(?:npm|pnpm|yarn|pip3?|uv)\s+(?:add|install)|\bnpx\s+skills\s+add\b/.test(snippet.text)) {
        addEffect("package-install", "May install packages or Skills", location);
      }
    }

    file.content.split(/\r?\n/).forEach((line, index) => {
      const location = { path: file.path, line: index + 1 };
      const behaviorDocument = file.path === "SKILL.md" || file.path.startsWith("references/");
      for (const pattern of [
        /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g,
        /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
        /\bgetenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
      ]) {
        for (const match of line.matchAll(pattern)) if (match[1]) addEntry(environment, match[1], location);
      }
      for (const match of line.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
        try { addEntry(networkHosts, new URL(match[0]).host, location); } catch { /* ignore */ }
      }
      if (behaviorDocument && /\b(?:agent-browser|playwright|puppeteer|browser-use|browser|chrome)\b/i.test(line)) addEffect("browser-control", "May control a web browser", location);
      if (behaviorDocument && /\b(?:send|submit|publish|post|reply|comment|upvote|downvote)\b/i.test(line) && !/\b(?:do not|don't|never|without)\b/i.test(line)) addEffect("external-write", "May create externally visible actions", location);
      if (behaviorDocument && /\b(?:purchase|pay|payment|refund|transfer)\b/i.test(line) && !/\b(?:do not|don't|never|without)\b/i.test(line)) addEffect("financial-transaction", "May initiate a financial transaction", location);
      if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i.test(line)) critical = true;
    });
  }

  const environmentEntries = entries(environment);
  const networkEntries = entries(networkHosts);
  if (networkEntries[0]?.evidence[0]) addEffect("network-access", "May access external network hosts", networkEntries[0].evidence[0]);
  const credential = environmentEntries.find((item) => /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE)/.test(item.name));
  if (credential?.evidence[0]) addEffect("credential-access", "May read credentials from the environment", credential.evidence[0]);
  const sideEffects: SideEffect[] = [...effects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, value]) => ({ kind, name: value.name, evidence: value.evidence }));
  const highKinds = new Set(["credential-access", "external-write", "file-delete", "financial-transaction"]);
  const risk: Risk = critical ? "critical" : sideEffects.some((item) => highKinds.has(item.kind)) ? "high" : sideEffects.length ? "medium" : "low";
  return { commands: entries(commands), environment: environmentEntries, networkHosts: networkEntries, fileWrites: entries(fileWrites), sideEffects, risk };
}

function addFinding(findings: Finding[], ruleId: string, message: string, location: Location) {
  const rule = RULES[ruleId];
  if (!rule) return;
  findings.push({ ruleId, severity: rule.severity, title: rule.title, message, location });
}

export function analyzeSkill(bundle: SkillBundle): SkillReport {
  const skill = bundle.files.find((file) => file.path === "SKILL.md");
  if (!skill) throw new Error("SKILL.md is missing from the fetched bundle.");
  const findings: Finding[] = [];
  const frontmatter = skill.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) addFinding(findings, "SP002", "SKILL.md must begin with YAML frontmatter between --- lines.", { path: "SKILL.md", line: 1 });
  const yaml = frontmatter?.[1] ?? "";
  const name = yaml.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() ?? "";
  const description = yaml.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() ?? "";
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) addFinding(findings, "SP003", "Frontmatter name must be lowercase hyphen-case and no longer than 64 characters.", { path: "SKILL.md", line: 2 });
  if (!description) addFinding(findings, "SP004", "Frontmatter description is required.", { path: "SKILL.md", line: 3 });
  else if (description.length < 50) addFinding(findings, "SP006", "Description is too short to explain both capability and trigger context.", { path: "SKILL.md", line: 3 });
  if (name && basename(bundle.skillPath) !== name) addFinding(findings, "SP005", `Folder “${basename(bundle.skillPath)}” does not match skill name “${name}”.`, { path: "SKILL.md", line: 2 });
  for (const match of skill.content.matchAll(/\b(?:TODO|FIXME|REPLACE[_ -]?ME|Lorem ipsum)\b/gi)) {
    addFinding(findings, "SP008", `Unresolved placeholder: ${match[0]}`, { path: "SKILL.md", line: skill.content.slice(0, match.index).split("\n").length });
  }
  const lineCount = skill.content.split(/\r?\n/).length;
  if (lineCount > 500) addFinding(findings, "SP009", `SKILL.md has ${lineCount} lines; the recommended maximum is 500.`, { path: "SKILL.md", line: 1 });

  const filePaths = new Set(bundle.files.map((file) => file.path));
  for (const match of skill.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const value = match[1]?.split("#")[0]?.trim() ?? "";
    if (!value || /^(?:https?:|mailto:|data:|#)/i.test(value)) continue;
    const line = skill.content.slice(0, match.index).split("\n").length;
    if (value.startsWith("../") || joinPath(value).startsWith("../")) addFinding(findings, "SP011", `Reference leaves the skill directory: ${value}`, { path: "SKILL.md", line });
    else if (!filePaths.has(joinPath(value))) addFinding(findings, "SP010", `Referenced resource does not exist: ${value}`, { path: "SKILL.md", line });
  }

  for (const file of bundle.files) {
    file.content.split(/\r?\n/).forEach((line, index) => {
      const location = { path: file.path, line: index + 1 };
      if (/(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_ -]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,})/i.test(line)) addFinding(findings, "SP100", "A credential-like value appears here; the value is intentionally redacted.", location);
      if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i.test(line)) addFinding(findings, "SP101", "A remote response is piped directly into a shell.", location);
      if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[^\n]*(?:\/|\$HOME|~)|\bgit\s+reset\s+--hard\b|\bchmod\s+777\b/i.test(line)) addFinding(findings, "SP102", "A destructive or difficult-to-reverse command is present.", location);
      if (/(?:curl|wget)[^\n]*(?:\$\{?(?:TOKEN|API_KEY|SECRET|PASSWORD))/i.test(line)) addFinding(findings, "SP103", "Environment or credential data may be sent to a remote endpoint.", location);
      if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(line)) addFinding(findings, "SP104", "A user-specific absolute path reduces portability.", location);
    });
  }

  const capabilities = inferCapabilities(bundle.files);
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + PENALTY[finding.severity], 0));
  return {
    sourceUrl: bundle.sourceUrl,
    repository: bundle.repository,
    skillPath: bundle.skillPath,
    name: name || basename(bundle.skillPath) || "unnamed-skill",
    score,
    grade: grade(score),
    risk: capabilities.risk,
    filesScanned: bundle.files.length,
    findings,
    capabilities: {
      commands: capabilities.commands,
      environment: capabilities.environment,
      networkHosts: capabilities.networkHosts,
      fileWrites: capabilities.fileWrites,
      sideEffects: capabilities.sideEffects,
    },
  };
}
