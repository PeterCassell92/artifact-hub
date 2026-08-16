import { useState, type FormEvent } from "react";
import { useAddCommentMutation } from "../store/api";
import { useAppDispatch } from "../store/hooks";
import { notify } from "../store/slices/notifications";

/** Requires view permission — reaching the artifact detail page already required `canView`
 * (docs/architecture/06 §3: canComment = canView + authenticated). */
export function CommentForm({ artifactId }: { artifactId: string }) {
  const [body, setBody] = useState("");
  const [addComment, { isLoading }] = useAddCommentMutation();
  const dispatch = useAppDispatch();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await addComment({ artifactId, body: body.trim() }).unwrap();
      setBody("");
    } catch {
      dispatch(notify("error", "Failed to add comment"));
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-2">
      <label htmlFor="comment-body" className="sr-only">
        Add a comment
      </label>
      <textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Add a comment…"
        className="rounded-md border border-neutral-300 p-2 text-sm"
      />
      <button
        type="submit"
        disabled={isLoading || !body.trim()}
        className="self-start rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        Comment
      </button>
    </form>
  );
}
