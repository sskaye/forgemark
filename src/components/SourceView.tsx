import "./SourceView.css";

type Props = {
  text: string;
};

// Phase 2 source view: raw markdown in mono. CodeMirror replaces this in
// Phase 8, which adds dimmed marker rendering and a "read-only review" chip.
// For now it is a `pre` block — read-only, selectable for copy.
export function SourceView({ text }: Props) {
  return (
    <pre className="fm-source-view" data-testid="fm-source-view">
      {text}
    </pre>
  );
}
