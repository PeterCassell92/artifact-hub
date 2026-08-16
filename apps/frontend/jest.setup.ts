import { TextDecoder, TextEncoder } from "node:util";
import "@testing-library/jest-dom";

// jsdom doesn't provide these globally; @auth0/auth0-spa-js (a transitive dep of
// @auth0/auth0-react) needs them even when useAuth0 itself is mocked in a test, since the
// package's own module-level code still runs on import.
Object.assign(globalThis, { TextEncoder, TextDecoder });
