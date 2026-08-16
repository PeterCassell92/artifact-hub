import { useState } from "react";
import { API_BASE_URL } from "../config";

const MCP_URL = new URL("/mcp", API_BASE_URL || window.location.origin).toString();
const CLAUDE_CODE_COMMAND = `claude mcp add --transport http artifact-hub ${MCP_URL}`;
const CLAUDE_DESKTOP_CONFIG = JSON.stringify(
  { mcpServers: { "artifact-hub": { type: "http", url: MCP_URL } } },
  null,
  2,
);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <pre className="min-w-0 flex-1 overflow-x-auto text-xs text-neutral-800">
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

/**
 * /get-started — explains how to connect an agent (Claude Code / Claude Desktop) to the MCP
 * server. Publishing/discovery/comment/share all happen through the agent — there is no
 * publish/upload screen in this SPA (docs/frontend README, docs/architecture/05).
 */
export function GetStartedPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Get started</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Artifact Hub is published to and managed from your AI agent, not this web app — the web
          app is for viewing, commenting, sharing, and managing access. Connect Claude Code or
          Claude Desktop to the Artifact Hub MCP server below, then ask your agent to publish,
          list, or share an artifact.
        </p>
      </div>

      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-800">Claude Code</h2>
        <p className="mt-1 text-sm text-neutral-600">Run this from a terminal:</p>
        <div className="mt-3">
          <CodeBlock code={CLAUDE_CODE_COMMAND} />
        </div>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-800">Claude Desktop</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Settings → Connectors → Add custom connector, then enter this URL:
        </p>
        <div className="mt-3">
          <CodeBlock code={MCP_URL} />
        </div>
        <p className="mt-4 text-sm text-neutral-600">
          If your version of Claude Desktop instead expects a config file, add this to your{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">claude_desktop_config.json</code>:
        </p>
        <div className="mt-3">
          <CodeBlock code={CLAUDE_DESKTOP_CONFIG} />
        </div>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-800">Signing in</h2>
        <p className="mt-1 text-sm text-neutral-600">
          No token to copy — the first time your agent calls the server, it opens your browser to
          sign in with the same email magic link you use for this site. Once signed in, your agent
          can do anything you can do (subject to the same access policies), except manage users or
          groups.
        </p>
      </section>

      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-800">What you can ask your agent to do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
          <li>Publish a new artifact and set who can see it</li>
          <li>List your own artifacts, or what&apos;s been shared with you (incl. &quot;in the last 24 hours&quot;)</li>
          <li>Fetch an artifact&apos;s contents to reason over</li>
          <li>Add a comment to an artifact</li>
          <li>Create a share link, or change an artifact&apos;s access policy (including revoking access)</li>
        </ul>
      </section>
    </div>
  );
}
