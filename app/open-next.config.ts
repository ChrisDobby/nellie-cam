import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

// The app has no ISR or revalidateTag, so there's no tag cache or revalidation queue to run.
// Prerendered pages are read from the S3 incremental cache, which the CDK stack uploads.
const config = {
  default: {
    override: {
      tagCache: "dummy",
      queue: "dummy",
    },
  },
} satisfies OpenNextConfig;

export default config;
