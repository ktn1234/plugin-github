import { z } from "zod";

export const GithubRepoSchema = z.object({
  owner: z.string(),
  repo: z.string()
});
