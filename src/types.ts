import { z } from "zod";

export const TEXT_GENERATION_CAPABILITY_ID = "text-generation";

declare module "@maiar-ai/core" {
  interface ICapabilities {
    [TEXT_GENERATION_CAPABILITY_ID]: {
      input: string;
      output: string;
    };
  }
}

export const GithubRepoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});
