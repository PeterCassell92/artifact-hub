import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ArtifactDetail } from "contracts";
import { useResolveDownloadUrlMutation } from "../store/api";

type Kind = "pdf" | "image" | "html" | "markdown" | "mermaid" | "unsupported";

function kindOf(artifact: ArtifactDetail): Kind {
  if (artifact.contentType === "application/pdf") return "pdf";
  if (artifact.contentType.startsWith("image/")) return "image";
  if (artifact.contentType === "text/html") return "html";
  if (artifact.format === "markdown" || artifact.fileName.endsWith(".md")) return "markdown";
  if (artifact.format === "mermaid" || artifact.fileName.endsWith(".mmd")) return "mermaid";
  return "unsupported";
}

function MermaidDiagram({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamically imported — mermaid bundles every diagram-type renderer and is heavy; most
    // artifact views never render a .mmd file, so it shouldn't ship in the main bundle.
    void import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false });
      return mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, text);
    }).then(({ svg: rendered }) => {
      if (!cancelled) setSvg(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!svg) return <p className="text-sm text-neutral-500">Rendering diagram…</p>;
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

function TextContentViewer({ url, kind }: { url: string; kind: "markdown" | "mermaid" }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(url)
      .then((res) => res.text())
      .then((body) => {
        if (!cancelled) setText(body);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (text === null) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading preview…
      </p>
    );
  }

  return kind === "markdown" ? (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  ) : (
    <MermaidDiagram text={text} />
  );
}

/** Dispatches on artifact type — PDF/image/HTML use the presigned URL directly; markdown/mermaid
 * fetch and render the text. Download uses the same resolved URL (docs/frontend/01 §6). */
export function ArtifactViewer({ artifact }: { artifact: ArtifactDetail }) {
  const [resolveDownloadUrl, { data, isLoading, isError }] = useResolveDownloadUrlMutation();

  useEffect(() => {
    void resolveDownloadUrl(artifact.id);
  }, [artifact.id, resolveDownloadUrl]);

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading preview…
      </p>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-red-600">Couldn&apos;t load a preview for this artifact.</p>;
  }

  const url = data.url;
  const kind = kindOf(artifact);

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
        {kind === "pdf" && <iframe src={url} title={artifact.title} className="h-[70vh] w-full" />}
        {kind === "image" && <img src={url} alt={artifact.title} className="max-h-[70vh] w-full object-contain" />}
        {kind === "html" && (
          // No allow-same-origin — that's what gives the isolation docs/architecture/06 §9 wants.
          <iframe sandbox="allow-scripts" src={url} title={artifact.title} className="h-[70vh] w-full" />
        )}
        {(kind === "markdown" || kind === "mermaid") && (
          <div className="max-h-[70vh] overflow-auto p-4">
            <TextContentViewer url={url} kind={kind} />
          </div>
        )}
        {kind === "unsupported" && (
          <p className="p-6 text-center text-sm text-neutral-500">
            Preview not available for this file type — use Download.
          </p>
        )}
      </div>
      <a
        href={url}
        download={artifact.fileName}
        className="mt-3 block w-full rounded-md bg-neutral-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-neutral-800"
      >
        Download
      </a>
    </div>
  );
}
