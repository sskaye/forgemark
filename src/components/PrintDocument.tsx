import { useEffect, useMemo, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { bodyWithAnchorElements } from "../format";
import type { Comment, DocFormat, Reply } from "../format/types";
import { renderedExtensions } from "./editorExtensions";
import type { PrintOptions } from "./PrintOptionsModal";
import "./PrintDocument.css";

type Props = {
  body: string;
  comments: Comment[];
  fileName: string;
  options: PrintOptions | null;
  format?: DocFormat;
  // The folder the document is in, for images written relative to it.
  baseDir?: string | null;
};

// Printing renders the document into a hidden article and then prints the
// whole webview. The review-notes appendix is the same either way; only
// the body differs, and it has to, because a report printed through the
// Markdown editor would come out as its own source code.
export function PrintDocument({
  body,
  comments,
  fileName,
  options,
  format = "markdown",
  baseDir = null,
}: Props) {
  const printOptions = options ?? { includeComments: true, includeSuggestions: true };
  const reviewItems = comments.filter((comment) =>
    comment.suggested_edit ? printOptions.includeSuggestions : printOptions.includeComments,
  );

  return (
    <article className="fm-print-document" data-testid="fm-print-document" aria-hidden="true">
      <header className="fm-print-header">
        <h1>{fileName}</h1>
      </header>
      {format === "html" ? (
        <PrintHtmlBody body={body} />
      ) : (
        <PrintMarkdownBody body={body} baseDir={baseDir} />
      )}
      {reviewItems.length > 0 && (
        <section className="fm-print-review" data-testid="fm-print-review">
          <h2>Review notes</h2>
          <ol>
            {reviewItems.map((comment) => (
              <li key={comment.id} className="fm-print-review-item">
                <div className="fm-print-review-meta">
                  #{comment.id} · {comment.author}
                  {comment.resolved ? " · resolved" : ""}
                </div>
                {comment.anchor_text && (
                  <blockquote className="fm-print-anchor">{comment.anchor_text}</blockquote>
                )}
                {comment.suggested_edit && (
                  <div className="fm-print-suggestion" data-testid="fm-print-suggestion">
                    <span>{comment.suggested_edit.from}</span>
                    <span aria-hidden>→</span>
                    <span>{comment.suggested_edit.to}</span>
                  </div>
                )}
                {comment.body && <p className="fm-print-comment-body">{comment.body}</p>}
                {comment.replies && comment.replies.length > 0 && (
                  <ul className="fm-print-replies">
                    {comment.replies.map((reply, index) => (
                      <PrintReply
                        key={`${reply.author}-${reply.timestamp}-${index}`}
                        reply={reply}
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

// An HTML report prints itself. The frame carries the report's own CSS,
// so what comes out of the printer is the document its author designed
// rather than an approximation of it.
function PrintHtmlBody({ body }: { body: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    doc.open();
    doc.write(body);
    doc.close();
    // No scrollbars on paper: the frame has to be as tall as its content
    // or printing would clip everything past the first screen.
    frame.style.height = `${Math.max(doc.documentElement?.scrollHeight ?? 0, 320)}px`;
  }, [body]);

  return (
    <iframe
      ref={frameRef}
      className="fm-print-html"
      data-testid="fm-print-html"
      title="Report"
      sandbox="allow-same-origin"
    />
  );
}

function PrintMarkdownBody({ body, baseDir }: { body: string; baseDir: string | null }) {
  const initialMarkdown = useMemo(() => bodyWithAnchorElements(body), [body]);
  const editor = useEditor({
    // The editor's own pipeline, so the page prints what the reader saw.
    extensions: renderedExtensions([], { baseDir }),
    content: initialMarkdown,
    editable: false,
    editorProps: {
      attributes: {
        class: "fm-print-prose",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(initialMarkdown, { emitUpdate: false });
  }, [editor, initialMarkdown]);

  return <EditorContent editor={editor} className="fm-print-rendered" />;
}

function PrintReply({ reply }: { reply: Reply }) {
  return (
    <li>
      <span className="fm-print-reply-author">{reply.author}: </span>
      <span>{reply.body}</span>
    </li>
  );
}
