import type { ReactNode } from "react";
import { Auth0Provider, type AppState } from "@auth0/auth0-react";
import { useNavigate } from "react-router-dom";
import { AuthTokenBridge } from "./AuthTokenBridge";
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_DOMAIN } from "../config";

/** Wraps the app in Auth0Provider (Authorization Code + PKCE, docs/architecture/02 §1) and routes
 * the post-login redirect through React Router instead of a full page reload. Must render inside
 * <BrowserRouter> — it uses useNavigate(). */
export function Auth0ProviderWithNavigate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  function onRedirectCallback(appState?: AppState) {
    navigate(appState?.returnTo ?? "/", { replace: true });
  }

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: AUTH0_AUDIENCE,
      }}
      onRedirectCallback={onRedirectCallback}
    >
      <AuthTokenBridge />
      {children}
    </Auth0Provider>
  );
}
