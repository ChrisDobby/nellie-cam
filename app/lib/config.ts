// Values come from the NellieCamStack outputs. Next.js inlines NEXT_PUBLIC_ variables at build
// time, so each must be referenced literally. None of these are secrets.
export const config = {
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? "",
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? "",
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? "",
  identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID ?? "",
  iotEndpoint: process.env.NEXT_PUBLIC_IOT_ENDPOINT ?? "",
  streamName: process.env.NEXT_PUBLIC_STREAM_NAME || "nellie-cam-live",
  thingName: process.env.NEXT_PUBLIC_THING_NAME || "nellie-cam",
};

export const missingConfig = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);
