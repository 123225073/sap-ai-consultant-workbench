import { useEffect, useRef, useState } from "react";
import { Code2, Download, Workflow } from "lucide-react";
import type { CaseDiagramExportFormat, CaseFilePreview, WorkbenchState } from "../shared/workbenchTypes";
import { mountSanitizedSvg, renderMermaidSafely, utf8ToBase64, type SafeMermaidRender } from "./mermaidRenderer";

interface MermaidPreviewProps {
  preview: CaseFilePreview;
  onStateChange: (state: WorkbenchState) => void;
  onNotice: (message: string) => void;
}

export default function MermaidPreview({ preview, onStateChange, onNotice }: MermaidPreviewProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState<SafeMermaidRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState<CaseDiagramExportFormat | null>(null);

  useEffect(() => {
    setRendered(null);
    setError(null);
    setShowSource(true);
    setRendering(false);
  }, [preview.relativePath, preview.content]);

  useEffect(() => {
    if (rendered && canvasRef.current && !showSource) mountSanitizedSvg(canvasRef.current, rendered.svg);
  }, [rendered, showSource]);

  async function renderDiagram() {
    setRendering(true);
    setError(null);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const result = await renderMermaidSafely(preview.content);
      setRendered(result);
      setShowSource(false);
    } catch {
      setError("流程图包含不支持或不安全的语法，已保留源码预览。");
      setShowSource(true);
    } finally {
      setRendering(false);
    }
  }

  async function exportDiagram(format: CaseDiagramExportFormat) {
    if (!rendered || !window.workbench) return;
    setExporting(format);
    try {
      const response = await window.workbench.exportCaseDiagram({
        sourceRelativePath: preview.relativePath,
        sourceSha256: rendered.sourceSha256,
        format,
        contentBase64: utf8ToBase64(rendered.svg)
      });
      if (!response.ok) {
        onNotice(response.error);
        return;
      }
      onStateChange(response.data.state);
      onNotice(`流程图已导出为 ${format.toUpperCase()}：${response.data.relativePath}`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="mermaid-preview">
      <div className="mermaid-preview-actions">
        <button type="button" onClick={() => rendered ? setShowSource((value) => !value) : void renderDiagram()} disabled={rendering}>
          {showSource ? <Workflow size={14} /> : <Code2 size={14} />}{rendering ? "渲染中" : showSource ? "图形" : "源码"}
        </button>
        {(["svg", "png", "pdf"] as const).map((format) => (
          <button type="button" key={format} onClick={() => void exportDiagram(format)} disabled={!rendered || exporting !== null}>
            <Download size={14} />{exporting === format ? "导出中" : format.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? <p className="mermaid-preview-error">{error}</p> : null}
      {showSource || error ? <pre>{preview.content}</pre> : <div ref={canvasRef} className="mermaid-preview-canvas" aria-label="Mermaid 流程图预览" />}
    </div>
  );
}
