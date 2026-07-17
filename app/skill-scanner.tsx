"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  analyzeSkill,
  fetchPublicSkill,
  type CapabilityEntry,
  type Finding,
  type SkillReport,
} from "../lib/skill-analyzer";

const EXAMPLE_URL =
  "https://github.com/starinzlob/skillinspect/tree/main/skills/skillinspect";

const capabilityLabels = {
  commands: "Runtime commands",
  environment: "Environment & credentials",
  networkHosts: "Network hosts",
  fileWrites: "Local file writes",
} as const;

function Evidence({ item }: { item: CapabilityEntry }) {
  const first = item.evidence[0];
  if (!first) return null;
  return (
    <span className="evidence">
      {first.path}
      {first.line ? `:${first.line}` : ""}
    </span>
  );
}

function CapabilityList({
  title,
  items,
}: {
  title: string;
  items: CapabilityEntry[];
}) {
  return (
    <section className="capability-column">
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.name}>
              <span>{item.name}</span>
              <Evidence item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="none-found">None detected</p>
      )}
    </section>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className={`finding finding-${finding.severity}`}>
      <div className="finding-code">{finding.ruleId}</div>
      <div>
        <div className="finding-title-row">
          <strong>{finding.title}</strong>
          <span className="severity">{finding.severity}</span>
        </div>
        <p>{finding.message}</p>
        <span className="evidence">
          {finding.location.path}
          {finding.location.line ? `:${finding.location.line}` : ""}
        </span>
      </div>
    </li>
  );
}

function Report({ report }: { report: SkillReport }) {
  const [copied, setCopied] = useState(false);
  const command = `npx --yes skillinspect check ./path/to/${report.name} --smoke --strict`;

  async function copyReportLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article className="report" aria-live="polite">
      <div className="report-kicker">
        <span>Inspection ledger</span>
        <span>Source · GitHub public repository</span>
      </div>

      <header className="report-header">
        <div>
          <p className="eyebrow">Static pre-install report</p>
          <h2>{report.name}</h2>
          <a href={report.sourceUrl} target="_blank" rel="noreferrer">
            {report.repository} · {report.skillPath}
          </a>
        </div>
        <div className="report-marks" aria-label="Inspection summary">
          <div className={`risk-stamp risk-${report.risk}`}>
            <span>Capability risk</span>
            <strong>{report.risk}</strong>
          </div>
          <div className="grade-mark">
            <span>Grade</span>
            <strong>{report.grade}</strong>
            <small>{report.score}/100</small>
          </div>
        </div>
      </header>

      <dl className="report-stats">
        <div>
          <dt>Files read</dt>
          <dd>{report.filesScanned}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd>{report.findings.length}</dd>
        </div>
        <div>
          <dt>Capabilities</dt>
          <dd>{report.capabilities.sideEffects.length}</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>None</dd>
        </div>
      </dl>

      <section className="side-effect-strip">
        <p>Declared by the evidence</p>
        <div>
          {report.capabilities.sideEffects.length ? (
            report.capabilities.sideEffects.map((effect) => (
              <span key={effect.kind}>{effect.name}</span>
            ))
          ) : (
            <span>No material side effects detected</span>
          )}
        </div>
      </section>

      <div className="capability-grid">
        {(Object.keys(capabilityLabels) as Array<keyof typeof capabilityLabels>).map(
          (key) => (
            <CapabilityList
              key={key}
              title={capabilityLabels[key]}
              items={report.capabilities[key]}
            />
          ),
        )}
      </div>

      <section className="findings-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Quality & safety desk</p>
            <h3>Traceable findings</h3>
          </div>
          <span>{report.findings.length} notices</span>
        </div>
        {report.findings.length ? (
          <ol className="finding-list">
            {report.findings.map((finding, index) => (
              <FindingRow
                key={`${finding.ruleId}-${finding.location.path}-${finding.location.line ?? index}`}
                finding={finding}
              />
            ))}
          </ol>
        ) : (
          <div className="clean-notice">
            <strong>No static findings.</strong>
            <p>This is not a security guarantee. Review capabilities before granting access.</p>
          </div>
        )}
      </section>

      <footer className="report-footer">
        <div>
          <p>Run the full local audit</p>
          <code>{command}</code>
        </div>
        <button className="secondary-button" type="button" onClick={copyReportLink}>
          {copied ? "Link copied" : "Copy report link"}
        </button>
      </footer>
    </article>
  );
}

export function SkillScanner() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<SkillReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  async function inspect(input: string) {
    const value = input.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const bundle = await fetchPublicSkill(value);
      const nextReport = analyzeSkill(bundle);
      setReport(nextReport);
      const share = new URL(window.location.href);
      share.searchParams.set("skill", value);
      window.history.replaceState({}, "", share);
      window.setTimeout(() => {
        document.getElementById("report")?.scrollIntoView({ behavior: "smooth" });
      }, 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The inspection could not be completed.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void inspect(url);
  }

  useEffect(() => {
    const shared = new URL(window.location.href).searchParams.get("skill");
    if (shared) {
      setUrl(shared);
      void inspect(shared);
    }
  }, []);

  return (
    <main>
      <div className="paper-shell">
        <header className="newspaper-header">
          <div className="edition-line">
            <span>Independent Agent Tooling</span>
            <span>Issue No. 02</span>
            <span>London · Seattle · The Open Web</span>
            <span>{currentYear}</span>
          </div>
          <div className="masthead-row">
            <a className="maker-mark" href="https://github.com/starinzlob/skillinspect" aria-label="SkillInspect GitHub">
              SI
            </a>
            <div>
              <p className="masthead-pretitle">The installation intelligence ledger</p>
              <h1>SkillInspect</h1>
            </div>
            <nav aria-label="Project links">
              <a href="https://github.com/starinzlob/skillinspect">GitHub</a>
              <a href="https://www.npmjs.com/package/skillinspect">npm</a>
            </nav>
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Public beta · No sign-in · No code execution</p>
            <h2>Read the small print before an Agent Skill reads your machine.</h2>
            <p className="standfirst">
              Paste a public GitHub Skill. We inspect its files for commands,
              credentials, network hosts, file writes, external side effects,
              and traceable safety findings—before you install it.
            </p>

            <form className="scanner-form" onSubmit={submit}>
              <label htmlFor="skill-url">Public GitHub Skill URL</label>
              <div className="input-row">
                <input
                  id="skill-url"
                  data-testid="skill-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo/tree/main/skills/example"
                  spellCheck={false}
                  required
                />
                <button data-testid="inspect-button" type="submit" disabled={loading}>
                  {loading ? "Reading files…" : "Inspect this Skill"}
                </button>
              </div>
              <div className="form-meta">
                <button
                  className="example-link"
                  type="button"
                  onClick={() => {
                    setUrl(EXAMPLE_URL);
                    void inspect(EXAMPLE_URL);
                  }}
                >
                  Try the SkillInspect example
                </button>
                <span>Public repositories only · GitHub rate limits apply</span>
              </div>
            </form>

            {error ? <p className="error-notice" role="alert">{error}</p> : null}
          </div>

          <aside className="inspection-note">
            <p className="note-number">Before you grant access</p>
            <h3>A Skill is executable intent.</h3>
            <ol>
              <li><span>01</span> What will it run?</li>
              <li><span>02</span> What secrets can it read?</li>
              <li><span>03</span> Where can it connect?</li>
              <li><span>04</span> What can it change outside?</li>
            </ol>
            <p className="note-footer">Static evidence first. Trust remains a human decision.</p>
          </aside>
        </section>

        <section className="principles" aria-label="Inspection principles">
          <div><strong>Static by default</strong><span>Third-party code is never executed.</span></div>
          <div><strong>Evidence attached</strong><span>Every notice points to a file and line.</span></div>
          <div><strong>Open source</strong><span>Rules and CLI are inspectable on GitHub.</span></div>
          <div><strong>Values redacted</strong><span>Credential names appear; secret values do not.</span></div>
        </section>

        <div id="report">{report ? <Report report={report} /> : null}</div>

        <footer className="site-footer">
          <p>SkillInspect is an open-source static analysis project. A clean report is not a security guarantee.</p>
          <p>MIT Licensed · Built in public · v0.2</p>
        </footer>
      </div>
    </main>
  );
}
