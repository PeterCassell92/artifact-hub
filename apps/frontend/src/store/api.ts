import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AccessEventListResponse,
  AccessPolicyInput,
  ArtifactDetail,
  ArtifactFacetOptions,
  ArtifactListQuery,
  ArtifactListResponse,
  ArtifactRelationshipCreateResponse,
  ArtifactRelationshipInput,
  ArtifactRelationshipSummary,
  ChangeRoleInput,
  CommentView,
  CorrectiveGroupChangeInput,
  CreateArtifactInput,
  CreateArtifactResponse,
  CreateGroupInput,
  CreateInvitationInput,
  DownloadUrlResponse,
  GroupView,
  InvitationPreview,
  InvitationView,
  PublicUserView,
  ShareLinkView,
  UserView,
} from "contracts";

/** The filter/sort part of ArtifactListQuery — everything except `scope`/`cursor`/`limit`, which
 * each list endpoint below takes as its own params (docs/frontend/02, implementation-plan.md
 * Phase 7). Shared by both list endpoints so one filter bar's state fits either page. `sort` is
 * made optional here (the zod schema defaults it server-side) so callers that just want "the
 * usual order" — e.g. DashboardPage's top-N previews — don't have to name a default. */
export type ArtifactListFilters = Omit<ArtifactListQuery, "scope" | "cursor" | "limit" | "sort"> & {
  sort?: ArtifactListQuery["sort"];
};
import { getAccessToken } from "../auth/tokenBridge";
import { API_BASE_URL } from "../config";

/**
 * One RTK Query slice for the whole SPA. Endpoints map 1:1 onto the routes that exist today
 * (docs/architecture/06 as extended by implementation-plan.md Phase 6) — response bodies are
 * typed against `packages/contracts` so a drifted backend response fails typecheck, not silently.
 */
export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: API_BASE_URL,
    prepareHeaders: async (headers) => {
      const token = await getAccessToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: ["Me", "Artifact", "ArtifactList", "Comment", "Relationship", "AccessEvent", "User", "Group", "Invitation"],
  endpoints: (builder) => ({
    getMe: builder.query<UserView, void>({
      query: () => "/me",
      providesTags: ["Me"],
    }),

    getMyArtifacts: builder.query<
      ArtifactListResponse,
      ArtifactListFilters & { cursor?: string; limit?: number }
    >({
      query: ({ cursor, limit, ...filters }) => ({
        url: "/artifacts",
        params: { scope: "mine", ...filters, ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) },
      }),
      providesTags: ["ArtifactList"],
    }),

    getSharedWithMe: builder.query<
      ArtifactListResponse,
      ArtifactListFilters & { cursor?: string; limit?: number }
    >({
      query: ({ cursor, limit, ...filters }) => ({
        url: "/artifacts",
        params: {
          scope: "sharedWithMe",
          ...filters,
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        },
      }),
      providesTags: ["ArtifactList"],
    }),

    getArtifactFacets: builder.query<ArtifactFacetOptions, { scope: "mine" | "sharedWithMe" }>({
      query: ({ scope }) => ({ url: "/artifacts/facets", params: { scope } }),
    }),

    getArtifact: builder.query<ArtifactDetail, string>({
      query: (id) => `/artifacts/${id}`,
      providesTags: (_result, _error, id) => [{ type: "Artifact", id }],
    }),

    getComments: builder.query<CommentView[], string>({
      query: (artifactId) => `/artifacts/${artifactId}/comments`,
      providesTags: (_result, _error, artifactId) => [{ type: "Comment", id: artifactId }],
    }),

    addComment: builder.mutation<CommentView, { artifactId: string; body: string }>({
      query: ({ artifactId, body }) => ({
        url: `/artifacts/${artifactId}/comments`,
        method: "POST",
        body: { body },
      }),
      invalidatesTags: (_result, _error, { artifactId }) => [
        { type: "Comment", id: artifactId },
        { type: "Artifact", id: artifactId },
      ],
    }),

    getRelationships: builder.query<ArtifactRelationshipSummary[], string>({
      query: (artifactId) => `/artifacts/${artifactId}/relationships`,
      providesTags: (_result, _error, artifactId) => [{ type: "Relationship", id: artifactId }],
    }),

    createRelationship: builder.mutation<
      ArtifactRelationshipCreateResponse,
      { artifactId: string } & ArtifactRelationshipInput
    >({
      query: ({ artifactId, ...body }) => ({
        url: `/artifacts/${artifactId}/relationships`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_result, _error, { artifactId }) => [{ type: "Relationship", id: artifactId }],
    }),

    deleteRelationship: builder.mutation<void, { artifactId: string; relationshipId: string }>({
      query: ({ artifactId, relationshipId }) => ({
        url: `/artifacts/${artifactId}/relationships/${relationshipId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, _error, { artifactId }) => [{ type: "Relationship", id: artifactId }],
    }),

    getAccessEvents: builder.query<AccessEventListResponse, { artifactId: string; cursor?: string }>({
      query: ({ artifactId, cursor }) => ({
        url: `/artifacts/${artifactId}/access-events`,
        params: cursor ? { cursor } : {},
      }),
      providesTags: (_result, _error, { artifactId }) => [{ type: "AccessEvent", id: artifactId }],
    }),

    updatePolicy: builder.mutation<ArtifactDetail, { artifactId: string; policy: AccessPolicyInput }>({
      query: ({ artifactId, policy }) => ({
        url: `/artifacts/${artifactId}/policy`,
        method: "PUT",
        body: policy,
      }),
      invalidatesTags: (_result, _error, { artifactId }) => [
        { type: "Artifact", id: artifactId },
        "ArtifactList",
      ],
    }),

    // Instant, whole-artifact cutoff (03 §1a) — independent of updatePolicy, which is what clears
    // it back (saving any policy always un-revokes as a side effect).
    revokeAccess: builder.mutation<ArtifactDetail, string>({
      query: (artifactId) => ({ url: `/artifacts/${artifactId}/revoke`, method: "POST" }),
      invalidatesTags: (_result, _error, artifactId) => [{ type: "Artifact", id: artifactId }, "ArtifactList"],
    }),

    // Two-call publish flow (docs/architecture/01 decision #44) — the raw bytes PUT to
    // `uploadUrl` in between these two goes straight to Tigris/MinIO, not through this app's
    // /api, so it isn't (and can't be) an RTK Query endpoint; it's a plain fetch orchestrated by
    // the caller (PublishArtifactModal).
    createArtifact: builder.mutation<CreateArtifactResponse, CreateArtifactInput>({
      query: (body) => ({ url: "/artifacts", method: "POST", body }),
      // No invalidatesTags — the artifact isn't "real" (0 bytes) until finalizeArtifact succeeds.
    }),

    finalizeArtifact: builder.mutation<ArtifactDetail, { artifactId: string; checksumSha256?: string }>({
      query: ({ artifactId, checksumSha256 }) => ({
        url: `/artifacts/${artifactId}/finalize`,
        method: "POST",
        body: checksumSha256 ? { checksumSha256 } : {},
      }),
      invalidatesTags: ["ArtifactList"],
    }),

    createShareLink: builder.mutation<ShareLinkView, string>({
      query: (artifactId) => ({ url: `/artifacts/${artifactId}/share-links`, method: "POST" }),
    }),

    // A `mutation`, not a cached `query` — the URL is a ~60s presigned link (06 §2); caching or
    // dedup-ing it would actively serve a stale/expired URL.
    resolveDownloadUrl: builder.mutation<DownloadUrlResponse, string>({
      query: (artifactId) => ({
        url: `/artifacts/${artifactId}/download`,
        headers: { Accept: "application/json" },
      }),
    }),

    getUsers: builder.query<UserView[], void>({
      query: () => "/admin/users",
      providesTags: ["User"],
    }),
    inviteUser: builder.mutation<InvitationView, CreateInvitationInput>({
      query: (body) => ({ url: "/admin/invitations", method: "POST", body }),
      // Also invalidates "User" — inviting creates a placeholder invited user row immediately
      // (see apps/backend database-service/invitations.ts createInvitation), so the users table
      // must refetch too, not just the invitations list.
      invalidatesTags: ["Invitation", "User"],
    }),
    getInvitations: builder.query<InvitationView[], void>({
      query: () => "/admin/invitations",
      providesTags: ["Invitation"],
    }),
    changeUserRole: builder.mutation<void, { userId: string } & ChangeRoleInput>({
      query: ({ userId, ...body }) => ({ url: `/admin/users/${userId}/role`, method: "POST", body }),
      invalidatesTags: ["User"],
    }),
    changeUserGroups: builder.mutation<void, { userId: string } & CorrectiveGroupChangeInput>({
      query: ({ userId, ...body }) => ({ url: `/admin/users/${userId}/groups`, method: "POST", body }),
      invalidatesTags: ["User"],
    }),
    disableUser: builder.mutation<void, string>({
      query: (userId) => ({ url: `/admin/users/${userId}/disable`, method: "POST" }),
      invalidatesTags: ["User"],
    }),
    getGroups: builder.query<GroupView[], void>({
      query: () => "/admin/groups",
      providesTags: ["Group"],
    }),
    // Non-admin-gated (unlike getGroups → /admin/groups) — feeds AccessPolicyEditor's group
    // multiselect so any artifact owner can pick real group names, not just admins.
    listGroups: builder.query<GroupView[], void>({
      query: () => "/groups",
      providesTags: ["Group"],
    }),
    // Non-admin-gated (unlike getUsers → /admin/users) — feeds AccessPolicyFields' "Specific
    // people" picker so any artifact owner can select real emails, not just admins.
    listUsers: builder.query<PublicUserView[], void>({
      query: () => "/users",
      providesTags: ["User"],
    }),
    createGroup: builder.mutation<GroupView, CreateGroupInput>({
      query: (body) => ({ url: "/admin/groups", method: "POST", body }),
      invalidatesTags: ["Group"],
    }),

    // Public invitation-accept bootstrap (06 §6) — no auth header available/needed, see tokenBridge.
    getInvitationPreview: builder.query<InvitationPreview, string>({
      query: (token) => `/invitations/${token}`,
    }),
    acceptInvitation: builder.mutation<void, string>({
      query: (token) => ({ url: "/invitations/accept", method: "POST", body: { token } }),
    }),
  }),
});

export const {
  useGetMeQuery,
  useGetMyArtifactsQuery,
  useGetSharedWithMeQuery,
  useGetArtifactFacetsQuery,
  useGetArtifactQuery,
  useGetCommentsQuery,
  useAddCommentMutation,
  useGetRelationshipsQuery,
  useCreateRelationshipMutation,
  useDeleteRelationshipMutation,
  useGetAccessEventsQuery,
  useUpdatePolicyMutation,
  useRevokeAccessMutation,
  useCreateArtifactMutation,
  useFinalizeArtifactMutation,
  useCreateShareLinkMutation,
  useResolveDownloadUrlMutation,
  useGetUsersQuery,
  useInviteUserMutation,
  useGetInvitationsQuery,
  useChangeUserRoleMutation,
  useChangeUserGroupsMutation,
  useDisableUserMutation,
  useGetGroupsQuery,
  useCreateGroupMutation,
  useListGroupsQuery,
  useListUsersQuery,
  useGetInvitationPreviewQuery,
  useAcceptInvitationMutation,
} = api;
