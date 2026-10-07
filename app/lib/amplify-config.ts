import type { ResourcesConfig } from "aws-amplify";
import { config } from "./config";

export const amplifyConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: config.userPoolId,
      userPoolClientId: config.userPoolClientId,
      identityPoolId: config.identityPoolId,
      loginWith: { email: true },
    },
  },
};
