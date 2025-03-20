import { Octokit } from "@octokit/rest";
import { OctokitOptions } from "@octokit/core";
import express, { Express, RequestHandler, Router } from "express";
import crypto from "crypto";

import {
  AgentContext,
  createLogger,
  PluginBase,
  PluginResult,
  UserInputContext,
} from "@maiar-ai/core";
import { GithubRepoSchema } from "./types";

const log = createLogger("plugin:github");

interface GithubWebhookConfig {
  port?: number;
  path?: string;
  secret: string;
}

export class PluginGithub extends PluginBase {
  private octokit: Octokit;
  private config: OctokitOptions;
  private prompt: string;
  private webhookConfig: GithubWebhookConfig;
  private app: Express | null = null;

  constructor(
    config: OctokitOptions,
    webhookConfig: GithubWebhookConfig,
    prompt: string
  ) {
    super({
      id: "plugin-github",
      name: "Github Plugin",
      description:
        "Agents can use this plugin to interact with Github to get information using Github's API",
    });

    this.config = config;
    this.octokit = new Octokit(this.config);
    this.webhookConfig = webhookConfig;
    this.prompt = prompt;

    this.addTrigger({
      id: "github_webhook_event_listener",
      start: async () => {
        log.info("Starting Github webhook event listener...");
        const port = this.webhookConfig?.port || 3000;
        const path = this.webhookConfig?.path || "/webhook";

        this.app = express();
        this.app.use(express.json());
        const router = Router();

        router.post("/", ((req, res) => {
          const signature = req.headers["x-hub-signature-256"];
          const event = req.headers["x-github-event"];
          const delivery = req.headers["x-github-delivery"];

          // Verify webhook signature
          const hmac = crypto.createHmac("sha256", this.webhookConfig.secret);
          const body = JSON.stringify(req.body);
          const digest = "sha256=" + hmac.update(body).digest("hex");

          if (!signature || signature !== digest) {
            log.warn(
              {
                receivedSignature: signature,
                calculatedDigest: digest,
              },
              "Invalid webhook signature"
            );

            return res.status(401).json({ error: "Invalid signature" });
          }

          const commits = req.body.commits;

          res.status(200).json({ status: "ok" });

          try {
            // Create event context
            const eventContext: UserInputContext = {
              id: `github-${delivery}`,
              pluginId: this.id,
              type: "user_input",
              action: `receieve_github_webhook`,
              timestamp: Date.now(),
              content: JSON.stringify(commits),
              rawMessage: JSON.stringify(commits),
              user: "webhook",
              helpfulInstruction: `This is a webhook event from Github`,
            };

            // Create platform context
            const platformContext = {
              platform: "github",
              responseHandler: (response: unknown) => {
                log.info({ response }, "Response from Github webhook");
              },
              metadata: {
                event,
                delivery,
                signature,
              },
            };

            // Process the webhook event
            this.runtime
              .createEvent(eventContext, platformContext)
              .catch((error) => {
                log.error({ error }, "Error processing GitHub webhook");
                res.status(500).json({ error: "Internal server error" });
              });
          } catch (error) {
            log.error({ error }, "Error processing GitHub webhook");
            res.status(500).json({ error: "Internal server error" });
          }
        }) as RequestHandler);

        this.app.use(path, router);
        this.app.listen(port, () => {
          log.info(`Github Webhook Server started on port ${port}`);
        });
      },
    });

    this.addExecutor({
      name: "describe_github_webhook_event",
      description: `Describe a Github webhook event in a few sentences. Run this executor after receiving a Github webhook event. ${this.prompt}`,
      execute: async (context: AgentContext): Promise<PluginResult> => {
        log.info("Describing Github webhook event...");
        const description = await this.runtime.operations.executeCapability<
          string,
          string
        >(
          "text-generation",
          `Infer from the Github webhook event of the activity that is happening with the repository rather than the event itself.
          Make sure to only look at fields that are rich in data that can be used to infer the event.
          If the value of the fields do not describe anything useful ignore it.
          Do not include any other personal information but you are allowed to use usernames.
          Do not describe the repository itself and its metadata.

          ${JSON.stringify(context.contextChain)}
          `
        );

        log.info("Described Github webhook event", {
          description,
        });

        const pluginResult: PluginResult = {
          success: true,
          data: {
            description,
            helpfulInstruction:
              "This describes a Github webhook event that was received",
          },
          error: undefined,
        };

        return pluginResult;
      },
    });

    this.addExecutor({
      name: "get_repo_info",
      description:
        "Get information about a Github repository given a repository name and owner. Search for the repository name and owner first",
      execute: async (context: AgentContext): Promise<PluginResult> => {
        log.info("Getting information about a Github repository...");
        const params = await this.runtime.operations.getObject(
          GithubRepoSchema,
          `Extract the owner and repo name from the context chain that is the most recent and relevant to the user's message:
          
          ${JSON.stringify(context.contextChain)}`
        );

        try {
          const { data } = await this.octokit.repos.get(params);
          const pluginResult: PluginResult = {
            success: true,
            data: {
              content: data,
              helpfulInstruction:
                "This is the information about the Github repository",
            },
          };

          return pluginResult;
        } catch (err: unknown) {
          log.error(
            { err },
            "Error getting information about a Github repository"
          );
          const pluginResult: PluginResult = {
            success: false,
            data: undefined,
            error: err instanceof Error ? err.message : String(err),
          };

          return pluginResult;
        }
      },
    });
  }
}
