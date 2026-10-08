# nellie-cam viewer

A Next.js app to watch the `nellie-cam-live` stream and start or stop the camera. Sign-in is
with Cognito.

The app is server-rendered:

- Sign-in happens in the browser (Amplify's `Authenticator`), and the Cognito session is kept in
  cookies so the server can read it.
- `proxy.ts` refreshes the session cookies when the tokens expire and redirects signed-out
  visitors to `/login`.
- `app/page.tsx` renders on the server with the camera's current state. Starting and stopping the
  camera, polling its state and getting the video URL are Server Actions (`app/actions.ts`).
  The page and every action check the session themselves.
- The video plays in the browser, straight from Kinesis over HLS. Only the playback URL comes
  from the server.

The server calls AWS in two ways:

- It gets the playback URL with the signed-in user's temporary credentials from the Cognito
  identity pool, which can only play `nellie-cam-live` over HLS
  (`kinesisvideo:GetHLSStreamingSessionURL` and related reads).
- It reads and updates the `nellie-cam` device shadow, which is how the camera is started and
  stopped (see [`../pi/README.md`](../pi/README.md#shadow-contract)), with its own credentials:
  the Lambda's role when hosted, which can only use that shadow, or your AWS profile when running
  locally. AWS IoT doesn't accept identity pool credentials unless an IoT policy is also
  attached to each user's identity, so the user's credentials aren't used for this.

## Setup

1. Deploy the stack (`cd ../aws && npx cdk deploy NellieCamStack`). It creates the `nellie-cam-viewers` user pool,
   an app client and an identity pool.

2. Create a user. Self sign-up is disabled, so accounts are created by an admin:

   ```sh
   aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
     --username someone@example.com \
     --user-attributes Name=email,Value=someone@example.com Name=email_verified,Value=true
   ```

   Cognito emails them a temporary password, which they change at first sign-in.

3. Configure the app:

   ```sh
   cp .env.example .env.local
   ```

   Fill it in from the stack outputs (`UserPoolId`, `UserPoolClientId`, `IdentityPoolId`) and the
   IoT data endpoint (`aws iot describe-endpoint --endpoint-type iot:Data-ATS`). These values are
   built into the browser bundle; none of them are secrets.

4. Run it:

   ```sh
   npm install
   npm run dev
   ```

   and open http://localhost:3000.

## Using it

**Start streaming** sets `desired.streaming` in the shadow. The page polls the shadow every few
seconds: it shows "Starting the camera…" until the Pi reports it's streaming, then "Waiting for
video…" until the first video reaches Kinesis, which takes a few seconds. Streams stop
automatically after 30 minutes, and the page shows a countdown.

## Hosting

The app is built with [OpenNext](https://opennext.js.org/aws) (`open-next.config.ts`) and
deployed by `NellieCamWebStack`: CloudFront in front of a Lambda for server rendering and Server
Actions, with static files in S3. The Lambda can only read its bucket and use the camera's shadow.

The `NEXT_PUBLIC_` variables are inlined at build time, so the app is built after `NellieCamStack`
is deployed, from its outputs. To build and deploy:

```sh
cd ../aws
./scripts/deploy-app.sh
```

It writes `.env.production.local` from the stack outputs, runs `npx open-next build` and deploys
`NellieCamWebStack`, which outputs the app's URL.
