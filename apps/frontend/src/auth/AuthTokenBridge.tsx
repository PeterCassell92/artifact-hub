import { useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { setTokenGetter } from "./tokenBridge";

/** No-UI component, mounted once inside Auth0Provider — see tokenBridge.ts. */
export function AuthTokenBridge() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();

  useEffect(() => {
    setTokenGetter(isAuthenticated ? () => getAccessTokenSilently() : null);
    return () => setTokenGetter(null);
  }, [getAccessTokenSilently, isAuthenticated]);

  return null;
}
