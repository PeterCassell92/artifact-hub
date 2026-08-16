import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AccessPolicyInput,
  ArtifactDetail,
  ArtifactListResponse,
  ChangeRoleInput,
  CommentView,
  CorrectiveGroupChangeInput,
  CreateGroupInput,
  CreateInvitationInput,
  DownloadUrlResponse,
  GroupView,
  InvitationPreview,
  InvitationView,
  ShareLinkView,
  UserView,
} from "contracts";
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
  tagTypes: ["Me", "Artifact", "ArtifactList", "Comment", "User", "Group", "Invitation"],
  endpoints: (builder) => ({
    getMe: builder.query<UserView, void>({
      query: () => "/me",
      providesTags: ["Me"],
    }),

    getMyArtifacts: builder.query<ArtifactListResponse, { cursor?: string; limit?: number }>({
      query: ({ cursor, limit } = {}) => ({
        url: "/artifacts",
        params: { scope: "mine", ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) },
      }),
      providesTags: ["ArtifactList"],
    }),

    getSharedWithMe: builder.query<
      ArtifactListResponse,
      { sinceHours?: number; cursor?: string; limit?: number }
    >({
      query: ({ sinceHours, cursor, limit } = {}) => ({
        url: "/artifacts",
        params: {
          scope: "sharedWithMe",
          ...(sinceHours ? { sinceHours } : {}),
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        },
      }),
      providesTags: ["ArtifactList"],
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
      invalidatesTags: ["Invitation"],
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
  useGetArtifactQuery,
  useGetCommentsQuery,
  useAddCommentMutation,
  useUpdatePolicyMutation,
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
  useGetInvitationPreviewQuery,
  useAcceptInvitationMutation,
} = api;
