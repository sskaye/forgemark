import { useEffect, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { bodyWithAnchorSpans } from "../format";
import type { Comment, Reply } from "../format/types";
import { createMarkdownExtensions } from "./markdownRendering";
import type { PrintOptions } from "./PrintOptionsModal";
import "./PrintDocument.css";

type Props = {
  body: string;
  comments: Comment[];
  fileName: string;
  filePath?: string | null;
  options: PrintOptions | null;
};

export function PrintDocument({ body, comments, fileName, filePath = null, options }: Props) {
  const initialMarkdown = useMemo(() => bodyWithAnchorSpans(body), [body]);
  const editor = useEditor({
    extensions: createMarkdownExtensions({ documentPath: filePath }),
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

  const printOptions = options ?? { includeComments: true, includeSuggestions: true };
  const reviewItems = comments.filter((comment) =>
    comment.suggested_edit ? printOptions.includeSuggestions : printOptions.includeComments,
  );

  return (
    <article className="fm-print-document" data-testid="fm-print-document" aria-hidden="true">
      <header className="fm-print-header">
        <h1>{fileName}</h1>
      </header>
      <EditorContent editor={editor} className="fm-print-rendered" />
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

function PrintReply({ reply }: { reply: Reply }) {
  return (
    <li>
      <span className="fm-print-reply-author">{reply.author}: </span>
      <span>{reply.body}</span>
    </li>
  );
}
