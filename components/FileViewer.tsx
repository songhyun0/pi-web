// biome-ignore-all lint/performance/noImgElement: local file previews use authenticated runtime URLs.
// biome-ignore-all lint/a11y/useMediaCaption: the generic audio-file inspector cannot synthesize a caption track.
"use client";

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { diffFileLines, type FileDiffLine } from "@/lib/file-diff";
import { encodeFilePathForApi, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
} from "@/lib/file-types";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins } from "@/lib/markdown";
import styles from "./FileViewer.module.css";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
}

async function readFileResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok
      ? "The file service returned an unreadable response."
      : `File service unavailable (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `File service unavailable (HTTP ${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

function fileErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  return (
    <a
      className={styles.download}
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      aria-label={`Download ${getFileName(filePath)}`}
      title="Download file"
    >
      <span className={styles.visuallyHidden}>Download {getFileName(filePath)}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}


function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CODE_LINE_NUMBER_STYLE: CSSProperties = {
  color: "var(--text-dim)",
  fontStyle: "normal",
  minWidth: "3em",
  paddingRight: "1em",
};

const CODE_CUSTOM_STYLE: CSSProperties = {
  margin: 0,
  padding: "12px 0",
  background: "var(--bg)",
  fontSize: 13,
  lineHeight: 1.6,
  fontFamily: "var(--font-mono)",
  minHeight: "100%",
};

const CODE_TAG_PROPS = { style: { fontFamily: "var(--font-mono)" } };

function ViewerState({ title, description, loading = false, tone, action }: {
  title: string;
  description?: string;
  loading?: boolean;
  tone?: "danger";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={styles.state}>
      <div className={styles.stateCard} data-tone={tone}>
        {loading ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <svg className={styles.stateIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="2" />
            {tone === "danger" ? <><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></> : <><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /></>}
          </svg>
        )}
        <h3 className={styles.stateTitle}>{title}</h3>
        {description && <p className={styles.stateDescription}>{description}</p>}
        {action && <button type="button" className={styles.stateAction} onClick={action.onClick}>{action.label}</button>}
      </div>
    </div>
  );
}

function LiveStatus({ watching }: { watching: boolean }) {
  return (
    <span className={styles.live} data-live={watching || undefined} title={watching ? "Live sync active" : "Not watching"}>
      <span className={styles.liveDot} aria-hidden="true" />
      {watching ? "live" : "static"}
    </span>
  );
}

function ViewerToolbar({ filePath, cwd, sourceSessionId, watching, meta, controls }: Props & { watching: boolean; meta?: ReactNode; controls?: ReactNode }) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.pathGroup}>
        <span className={styles.path} title={filePath}>{getRelativeFilePath(filePath, cwd)}</span>
        <LiveStatus watching={watching} />
      </div>
      {meta && <div className={styles.meta}>{meta}</div>}
      {controls && <div className={styles.controls}>{controls}</div>}
      <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
    </header>
  );
}

const MAX_FILE_DIFF_SOURCE_LINES = 5000;
function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  if (oldLines.length + newLines.length > MAX_FILE_DIFF_SOURCE_LINES) {
    return <ViewerState title="Diff too large" description="This revision pair exceeds 5,000 source lines. Switch to Source to inspect the latest file." />;
  }
  const diff = diffFileLines(oldLines, newLines);
  const hasChanges = diff.some((line) => line.type !== "unchanged");
  if (!hasChanges) return <ViewerState title="No changes" description="The live file matches the previous snapshot." />;

  const context = 3;
  const changed = new Set(diff.flatMap((line, index) => line.type !== "unchanged" ? [index] : []));
  const visible = new Set<number>();
  for (const changedIndex of changed) {
    for (let index = Math.max(0, changedIndex - context); index <= Math.min(diff.length - 1, changedIndex + context); index++) visible.add(index);
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: FileDiffLine[] }> = [];
  let index = 0;
  while (index < diff.length) {
    if (visible.has(index)) {
      const block: FileDiffLine[] = [];
      while (index < diff.length && visible.has(index)) block.push(diff[index++]);
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (index < diff.length && !visible.has(index)) { count++; index++; }
      segments.push({ hidden: true, count });
    }
  }

  const newLineNumbers: number[] = [];
  let newLineNumber = 1;
  for (const line of diff) {
    if (line.type === "removed") newLineNumbers.push(0);
    else newLineNumbers.push(newLineNumber++);
  }

  let diffIndex = 0;
  return (
    <div className={styles.diffView}>
      {segments.map((segment, segmentIndex) => {
        if (segment.hidden) {
          diffIndex += segment.count;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered diff segments have no stable external identifier.
            <div key={segmentIndex} className={styles.diffCollapsed}>… {segment.count} unchanged lines …</div>
          );
        }
        const rows = segment.lines.map((line, lineIndex) => {
          const orderedIndex = diffIndex + lineIndex;
          const displayedLineNumber = line.type === "removed" ? line.lineNo : newLineNumbers[orderedIndex] || "";
          const prefix = line.type === "added" ? "+" : line.type === "removed" ? "−" : " ";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered diff lines have no stable external identifier.
            <div key={lineIndex} className={styles.diffLine} data-kind={line.type}>
              <span className={styles.diffNumber}>{displayedLineNumber}</span>
              <span className={styles.diffPrefix}>{prefix}</span>
              <span className={styles.diffText}>{line.text || "\u00a0"}</span>
            </div>
          );
        });
        diffIndex += segment.lines.length;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ordered diff segments have no stable external identifier.
          <div key={segmentIndex}>{rows}</div>
        );
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId }: Props) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div className={styles.viewer}>
      <ViewerToolbar
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        watching={watching}
        meta={
          <>
            <span>{ext || "image"}</span>
            {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
            {formatSizeStr && <span>{formatSizeStr}</span>}
          </>
        }
      />
      <div className={styles.imageStage}>
        {error ? (
          <ViewerState title="Image unavailable" description={error} tone="danger" action={{ label: "Try again", onClick: () => { setError(null); setNaturalSize(null); setBust((value) => value + 1); } }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.image}
            src={src}
            alt={filePath}
            onLoad={(event) => setNaturalSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            onError={() => setError("Failed to load image")}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, sourceSessionId }: Props) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div className={styles.viewer}>
      <ViewerToolbar
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        watching={watching}
        meta={
          <>
            <span>{ext || "audio"}</span>
            {duration != null && <span>{formatDuration(duration)}</span>}
            {size != null && <span>{formatSize(size)}</span>}
          </>
        }
      />
      <div className={styles.audioStage}>
        {error ? (
          <ViewerState title="Audio unavailable" description={error} tone="danger" action={{ label: "Try again", onClick: () => { setError(null); setDuration(null); setBust((value) => value + 1); } }} />
        ) : (
          <div className={styles.audioCard}>
            <audio
              key={src}
              className={styles.audio}
              controls
              preload="metadata"
              src={src}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onError={() => setError("Failed to load audio")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId }: Props) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((response) => readFileResponse<{ size?: number; error?: string }>(response))
      .then((d: { size?: number; error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
        setError(null);
      })
      .catch((caught) => setError(fileErrorMessage(caught)));

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId]);

  return (
    <div className={styles.viewer}>
      <ViewerToolbar
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        watching={watching}
        meta={
          <>
            <span>{ext === "docx" ? "docx preview" : "pdf"}</span>
            {size != null && <span>{formatSize(size)}</span>}
          </>
        }
      />
      <div className={styles.documentStage}>
        {error ? (
          <ViewerState
            title="Document unavailable"
            description={error}
            tone="danger"
            action={error.startsWith("DOCX too large") ? undefined : { label: "Try again", onClick: () => { setError(null); setBust((value) => value + 1); } }}
          />
        ) : (
          <iframe
            key={previewUrl}
            className={styles.frame}
            data-pdf={isPdf || undefined}
            src={previewUrl}
            sandbox={isPdf ? undefined : ""}
            title={`Preview ${getFileName(filePath)}`}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({ filePath, cwd, sourceSessionId }: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} />;
}

function TextFileViewer({ filePath, cwd, sourceSessionId }: Props) {
  const { isDark } = useTheme();
  const [data, setData] = useState<FileData | null>(null);
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const dataRef = useRef<FileData | null>(null);

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId))
      .then((response) => readFileResponse<FileData & { error?: string }>(response))
      .then((d: FileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        setError(null);
        if (isRefresh) {
          const previous = dataRef.current;
          if (!previous || previous.content !== d.content) {
            if (previous) {
              setPrevContent(previous.content);
              setChangeCount((count) => count + 1);
            }
            dataRef.current = d;
            setData(d);
          }
        } else {
          dataRef.current = d;
          setData(d);
        }
        return d;
      })
      .catch((caught) => {
        setError(fileErrorMessage(caught));
        return null;
      });
  }, [sourceSessionId]);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    dataRef.current = null;
    setPrevContent(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown") setPreviewMode(true);
    }).finally(() => setLoading(false));

    // Set up SSE watch
    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      fetchContent(filePath, true);
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, sourceSessionId]);

  const retryLoad = () => {
    setLoading(true);
    setError(null);
    void fetchContent(filePath)
      .then((next) => { if (next?.language === "markdown") setPreviewMode(true); })
      .finally(() => setLoading(false));
  };

  if (loading) return <ViewerState title="Loading file" description="Reading the latest file contents." loading />;
  if (error) return <ViewerState title="File unavailable" description={error} tone="danger" action={{ label: "Try again", onClick: retryLoad }} />;
  if (!data) return <ViewerState title="No file content" description="The selected file returned no displayable content." />;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const lines = data.content.split("\n");
  const hasDiff = prevContent !== null && prevContent !== data.content;

  const controls = (
    <>
      {hasDiff && (
        <fieldset className={styles.segmented}>
          <legend className={styles.visuallyHidden}>File revision view</legend>
          <button type="button" aria-pressed={viewMode === "source"} onClick={() => setViewMode("source")}>Source</button>
          <button type="button" aria-pressed={viewMode === "diff"} onClick={() => setViewMode("diff")}>Diff{changeCount > 0 ? ` +${changeCount}` : ""}</button>
        </fieldset>
      )}
      {viewMode === "source" && !previewMode && (
        <button type="button" className={styles.control} aria-pressed={wrapLines} onClick={() => setWrapLines((value) => !value)} title={wrapLines ? "Disable word wrap" : "Enable word wrap"}>Wrap</button>
      )}
      {isHtml && viewMode === "source" && (
        <fieldset className={styles.segmented}>
          <legend className={styles.visuallyHidden}>HTML view</legend>
          <button type="button" aria-pressed={!previewMode} onClick={() => setPreviewMode(false)}>Code</button>
          <button type="button" aria-pressed={previewMode} onClick={() => setPreviewMode(true)}>Preview</button>
        </fieldset>
      )}
      {isMarkdown && viewMode === "source" && (
        <fieldset className={styles.segmented}>
          <legend className={styles.visuallyHidden}>Markdown view</legend>
          <button type="button" aria-pressed={previewMode} onClick={() => setPreviewMode(true)}>Preview</button>
          <button type="button" aria-pressed={!previewMode} onClick={() => setPreviewMode(false)}>Raw</button>
        </fieldset>
      )}
    </>
  );

  return (
    <div className={styles.viewer}>
      <ViewerToolbar
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        watching={watching}
        meta={
          <>
            <span>{data.language}</span>
            {viewMode === "source" && <span>{lines.length} lines</span>}
            <span>{formatSize(data.size)}</span>
          </>
        }
        controls={controls}
      />
      <div className={styles.content}>
        {viewMode === "diff" && hasDiff && prevContent !== null ? (
          <DiffView oldContent={prevContent} newContent={data.content} />
        ) : isHtml && previewMode ? (
          <iframe className={styles.frame} srcDoc={data.content} sandbox="allow-scripts" title="HTML preview" />
        ) : isMarkdown && previewMode ? (
          <div className={`markdown-body markdown-file-preview ${styles.markdownPreview}`}>
            <ReactMarkdown remarkPlugins={markdownPreviewRemarkPlugins} rehypePlugins={markdownPreviewRehypePlugins}>
              {data.content}
            </ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            language={data.language === "text" ? "plaintext" : data.language}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            lineNumberStyle={CODE_LINE_NUMBER_STYLE}
            customStyle={CODE_CUSTOM_STYLE}
            codeTagProps={CODE_TAG_PROPS}
            wrapLongLines={wrapLines}
          >
            {data.content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
