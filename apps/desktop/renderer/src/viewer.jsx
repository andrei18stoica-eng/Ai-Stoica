import React, { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { authedFetch, useAuthedBlobUrl, useModal, mediaKind, downloadLibraryFile, toast, formatBytes } from "./core.jsx";

// Opens a file from the Library or a generated file inside AI Stoica, without downloading it: images, video and audio
// play here, PDFs open in the built-in reader, and Word / PowerPoint / Excel / text show their content.
function viewKind(mime, name) {
  const m = String(mime || "").toLowerCase(), n = String(name || "").toLowerCase();
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  const k = mediaKind(mime, name);
  if (k !== "file") return k;
  if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(m) || /\.(docx?|pptx?|xlsx?|od[tsp]|rtf)$/.test(n)) return "office";
  return "file";
}

export function canView(file) { return viewKind(file?.mimeType || file?.mime, file?.name) !== "file"; }

// Chrome on Android (and other browsers without a PDF reader) cannot show a PDF inside the page: there the PDF's text is shown.
const PDF_INLINE = typeof navigator === "undefined" || navigator.pdfViewerEnabled !== false;

export function FileViewer({ file, onClose }) {
  const id = file?.libraryId || file?.id;
  const found = viewKind(file?.mimeType || file?.mime, file?.name);
  const kind = found === "pdf" && !PDF_INLINE ? "office" : found;
  const blobPath = ["image", "video", "audio", "pdf"].includes(kind) && id ? `/api/library/${id}/content` : "";
  const { src, failed } = useAuthedBlobUrl(blobPath);
  const [text, setText] = useState({ value: "", loading: kind === "text" || kind === "office", error: "" });
  const { ref, backdropProps } = useModal(onClose);
  useEffect(() => {
    if (!id || (kind !== "text" && kind !== "office")) return;
    let active = true;
    (async () => {
      try {
        const r = await authedFetch(kind === "text" ? `/api/library/${id}/content` : `/api/library/${id}/preview`);
        const value = kind === "text" ? await r.text() : String((await r.json())?.data?.text || "");
        if (active) setText({ value: value || "Fișierul nu conține text care poate fi afișat.", loading: false, error: "" });
      } catch (e) { if (active) setText({ value: "", loading: false, error: e.message }); }
    })();
    return () => { active = false; };
  }, [id, kind]);
  async function download() { try { await downloadLibraryFile({ libraryId: id, name: file?.name }); } catch (e) { toast(e.message); } }
  const loading = blobPath ? !src && !failed : text.loading;
  return <div className="modalBackdrop viewerBackdrop" {...backdropProps}>
    <div className={"fileViewer " + kind} ref={ref} role="dialog" aria-modal="true" aria-label={file?.name || "Fișier"} tabIndex={-1}>
      <div className="viewerHead">
        <div><b>{file?.name || "Fișier"}</b>{file?.size ? <small>{formatBytes(file.size)}</small> : null}</div>
        <button type="button" className="secondary" onClick={download}><Download size={15}/> Descarcă</button>
        <button type="button" className="iconOnly" onClick={onClose} aria-label="Închide" title="Închide"><X size={20}/></button>
      </div>
      <div className="viewerBody">
        {loading && <div className="mediaPlaceholder">Se deschide…</div>}
        {failed && <div className="mediaPlaceholder">Fișierul nu mai este disponibil.</div>}
        {src && kind === "image" && <img src={src} alt={file?.name || ""}/>}
        {src && kind === "video" && <video src={src} controls autoPlay playsInline/>}
        {src && kind === "audio" && <audio src={src} controls autoPlay/>}
        {src && kind === "pdf" && <iframe src={src} title={file?.name || "PDF"}/>}
        {!text.loading && (kind === "text" || kind === "office") && (text.error ? <div className="mediaPlaceholder">{text.error}</div> : <pre className="viewerText">{text.value}</pre>)}
        {kind === "file" && <div className="mediaPlaceholder">Acest tip de fișier nu poate fi deschis aici. Folosește „Descarcă”.</div>}
      </div>
    </div>
  </div>;
}
