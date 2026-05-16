import { useEffect, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { bodyWithAnchorSpans } from "../format";
import type { Comment, Reply } from "../format/types";
import { AnchorMark } from "./AnchorMark";
import type { PrintOptions } from "./PrintOptionsModal";
import "./PrintDocument.css";

type Props = {
  body: string;
  comments: Comment[];
  fileName: string;
  options: PrintOptions | null;
};

export function PrintDocument({ body, comments, fileName, options }: Props) {
  const initialMarkdown = useMemo(() => bodyWithAnchorSpans(body), [body]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      AnchorMark,
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
      }),
    ],
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
