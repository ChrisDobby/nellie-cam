"use client";

import { Amplify } from "aws-amplify";
import { amplifyConfig } from "./amplify-config";

// ssr: true keeps the Cognito session in cookies so the server can read it.
// Import this module from any client component that uses Amplify.
Amplify.configure(amplifyConfig, { ssr: true });
