import { useGetCommentsQuery } from "../store/api";
import { formatPublishedAt } from "../lib/formatters";

export function CommentList({ artifactId }: { artifactId: string }) {
  const { data: comments, isLoading } = useGetCommentsQuery(artifactId);

  if (isLoading) {
    return (
      <p className="text-sm text-neutral-500" role="status">
        Loading comments…
      </p>
    );
  }

  if (!comments || comments.length === 0) {
    return <p className="text-sm text-neutral-500">No comments yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-md border border-neutral-200 bg-white p-3">
          <p className="text-sm text-neutral-800">{comment.body}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {comment.authorName} · {formatPublishedAt(comment.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
