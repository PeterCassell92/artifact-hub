import { Router } from "express";
import { ListRelationshipsInput, RelationshipListResponse } from "contracts";
import { listRelationshipsByType } from "../../../database-service/relationships";
import { sendError } from "../errors";

export function createRelationshipsRouter(): Router {
  const router = Router();

  // GET /api/relationships — corpus-wide, optionally ?type=-filtered, cursor-paginated. The REST
  // counterpart to the MCP `list_relationships` tool; both call listRelationshipsByType, which
  // only returns rows where the caller can view at least one side (see its doc comment).
  router.get("/", async (req, res) => {
    const query = ListRelationshipsInput.safeParse(req.query);
    if (!query.success) {
      sendError(res, 400, "bad_request", "Invalid query", query.error.flatten());
      return;
    }

    const { items, nextCursor } = await listRelationshipsByType(req.viewer!, query.data.type, {
      cursor: query.data.cursor,
      limit: query.data.limit,
    });
    res.json(RelationshipListResponse.parse({ items, nextCursor }));
  });

  return router;
}
