/**
 * GitHub plugin for Maiar AI that provides integration with GitHub webhooks and API
 * Enables receiving and processing GitHub events and querying GitHub repository information
 */
import {
  AgentContext,
  createLogger,
  ExecutorImplementation,
  PluginBase,
  PluginResult,
  Trigger,
  UserInputContext,
} from "@maiar-ai/core";
import { OctokitOptions } from "@octokit/core";
import { Octokit } from "@octokit/rest";
import { createNodeMiddleware, Webhooks } from "@octokit/webhooks";
import {
  Commit,
  PullRequestEvent,
  PushEvent,
  ReleaseEvent,
  Schema,
} from "@octokit/webhooks-types";
import {
  EmitterWebhookEvent,
  Options,
} from "@octokit/webhooks/dist-types/types";
import { createServer, Server } from "http";
import { generateGithubWebhookEventDescriptionTemplate } from "./templates";
import { GithubRepoSchema } from "./types";

const log = createLogger("plugin:github");

/**
 * Configuration options for the webhook server
 *
 * @interface ServerOptions
 * @property {number} port - The port to run the webhook server on
 * @property {string} path - The URL path to listen for webhook events
 */
interface ServerOptions {
  port: number;
  path: string;
}

/**
 * Configuration options for the GitHub plugin
 *
 * @interface PluginGithubOptions
 * @property {Options<Schema> & { secret: string }} webhookOptions - GitHub webhook configuration options including the webhook secret
 * @property {string} [describeGithubWebhookEventPrompt] - Optional custom prompt to add to the description of the describe_github_webhook_event executor - Useful to tell MAIAR runtime where to send the output to
 * @property {string} [recievedGithubWebhookEventPrompt] - Optional custom prompt to add to the received_github_webhook_event executor
 * @property {ServerOptions} [serverOptions] - Optional configuration options for the webhook server (default: { port: 3000, path: "/webhooks" })
 * @property {OctokitOptions} [octokitOptions] - Optional configuration options for the Octokit (Github API) client
 */
interface PluginGithubOptions {
  webhookOptions: Options<Schema> & { secret: string };
  describeGithubWebhookEventPrompt?: string;
  recievedGithubWebhookEventPrompt?: string;
  serverOptions?: ServerOptions;
  octokitOptions?: OctokitOptions;
}

/**
 * GitHub plugin for MAIAR that integrates with Github to get information using Github's API and receive webhook events from Github
 *
 * Triggers:
 * - github_webhook_event_listener: Listens for Github webhook events and processes them
 *
 * Executors:
 * - describe_github_webhook_event: Describes a Github webhook event in a few sentences
 * - get_repo_info: Gets information about a Github repository given a repository name and owner
 *
 */
export class PluginGithub extends PluginBase {
  private webhooks: Webhooks;
  private serverOptions: ServerOptions;
  private describeGithubWebhookEventPrompt: string;
  private recievedGithubWebhookEventPrompt: string;
  private server: Server | undefined;

  private octokit: Octokit;

  /**
   * Creates a new GitHub plugin instance
   *
   * @param {PluginGithubOptions} options - Configuration options for the GitHub plugin
   */
  constructor({
    webhookOptions,
    describeGithubWebhookEventPrompt,
    recievedGithubWebhookEventPrompt,
    serverOptions,
    octokitOptions,
  }: PluginGithubOptions) {
    super({
      id: "plugin-github",
      name: "Github Plugin",
      description:
        "Use this plugin as a way to interact with Github to get information using Github's API",
    });

    this.webhooks = new Webhooks<Schema>(webhookOptions);
    this.webhooks.onAny(this.handleWebhookEvent.bind(this));
    this.describeGithubWebhookEventPrompt =
      describeGithubWebhookEventPrompt || "";
    this.recievedGithubWebhookEventPrompt =
      recievedGithubWebhookEventPrompt || "";

    this.server = undefined;
    this.serverOptions = serverOptions || { port: 3000, path: "/webhooks" };

    this.octokit = new Octokit(octokitOptions);

    for (const executor of this.executors) {
      this.addExecutor(executor);
    }

    for (const trigger of this.triggers) {
      this.addTrigger(trigger);
    }
  }

  /**
   * Returns the list of available executors for the plugin
   *
   * @returns {ExecutorImplementation[]} Array of executor implementations
   */
  get executors(): ExecutorImplementation[] {
    const describeGithubWebhookEvent: ExecutorImplementation = {
      name: "describe_github_webhook_event",
      description: `Describe a Github webhook event in a few sentences. ${this.describeGithubWebhookEventPrompt}`,
      execute: this.describeGithbWebhookEvent.bind(this),
    };

    const getRepoInfo: ExecutorImplementation = {
      name: "get_repo_info",
      description:
        "Get information about a Github repository given a repository name and owner. Search for the repository name and owner first",
      execute: this.getRepoInfo.bind(this),
    };

    return [describeGithubWebhookEvent, getRepoInfo];
  }

  /**
   * Returns the list of available triggers for the plugin
   *
   * @returns {Array<Trigger>} Array of triggers
   */
  get triggers(): Array<Trigger> {
    const githubWebhookEvent: Trigger = {
      id: "github_webhook_event_listener",
      start: this.githubWebhookEventTrigger.bind(this),
    };

    return [githubWebhookEvent];
  }

  /**
   * Starts the GitHub webhook event listener server
   * Called when the MAIAR runtime registers the trigger
   */
  private githubWebhookEventTrigger(): void {
    log.info("Starting Github webhook event listener...");

    this.server = createServer(
      createNodeMiddleware(this.webhooks, {
        path: this.serverOptions.path,
        log,
      })
    );
    this.server.listen(this.serverOptions.port, () => {
      log.info(
        `Github Webhook Server started on port ${this.serverOptions.port}`
      );
    });
  }

  /**
   * Handles incoming GitHub webhook events
   * Processes different event types (pull_request, push, release) and creates a runtime event
   *
   * @param {EmitterWebhookEvent} event - The webhook event received from GitHub
   */
  private handleWebhookEvent(event: EmitterWebhookEvent): void {
    log.info(`Received a Github webhook event ${event.name}`);

    let data;
    switch (event.name) {
      case "pull_request": {
        const payload = event.payload as PullRequestEvent;
        data = {
          action: payload.action,
          prNumber: payload.number,
          prTitle: payload.pull_request?.title,
          prBody: payload.pull_request?.body, // ✅ PR body included
          author: payload.pull_request?.user?.login,
          merged: payload.pull_request?.merged,
          repository: payload.repository?.full_name,
        };
        break;
      }
      case "push": {
        const payload = event.payload as PushEvent;
        data = {
          ref: payload.ref,
          repository: payload.repository?.full_name,
          pusher: payload.pusher?.name,
          commits: payload.commits?.map((commit: Commit) => ({
            id: commit.id,
            message: commit.message,
            author: commit.author?.name,
          })),
        };
        break;
      }
      case "release": {
        const payload = event.payload as ReleaseEvent;
        data = {
          action: payload.action,
          releaseTag: payload.release?.tag_name,
          releaseName: payload.release?.name,
          releasedBy: payload.release?.author?.login,
          repository: payload.repository?.full_name,
          releaseBody: payload.release?.body, // ✅ Release body included
        };
        break;
      }
      default: {
        log.warn(
          `Github webhook event ${event.name} will not create a runtime event`
        );
        return;
      }
    }

    // Create event context
    const eventContext: UserInputContext = {
      id: `github-${event.name}-${Date.now()}`,
      pluginId: this.id,
      type: "user_input",
      action: "receive_github_webhook",
      timestamp: Date.now(),
      content: JSON.stringify(data),
      rawMessage: JSON.stringify(data),
      user: "webhook",
      helpfulInstruction: `This is a webhook event payload from Github. ${this.recievedGithubWebhookEventPrompt}`,
    };

    // Create platform context
    const platformContext = {
      platform: "github",
      responseHandler: (response: unknown) => {
        log.info({ response }, "Response from Github webhook");
      },
      metadata: { payload: data },
    };

    try {
      this.runtime.createEvent(eventContext, platformContext);
    } catch (error: unknown) {
      log.error({ error }, "Error processing GitHub webhook");
    }
  }

  /**
   * Describes a GitHub webhook event using text generation
   *
   * @param {AgentContext} context - The agent context containing the webhook event data
   * @returns {Promise<PluginResult>} Plugin result containing the event description
   */
  private async describeGithbWebhookEvent(
    context: AgentContext
  ): Promise<PluginResult> {
    log.info("Describing Github webhook event...");

    const contextChain = JSON.stringify(context.contextChain);
    const description = await this.runtime.operations.executeCapability(
      "text-generation",
      generateGithubWebhookEventDescriptionTemplate(contextChain)
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
  }

  /**
   * Retrieves information about a GitHub repository
   * Extracts owner and repo name from the context chain and queries the GitHub API
   *
   * @param {AgentContext} context - The agent context containing the repository information
   * @returns {Promise<PluginResult>} Plugin result containing the repository data or error
   */
  private async getRepoInfo(context: AgentContext): Promise<PluginResult> {
    log.info("Getting information about a Github repository...");

    const contextChain = JSON.stringify(context.contextChain);
    const params = await this.runtime.operations.getObject(
      GithubRepoSchema,
      `Extract the owner and repo name from the context chain that is the most recent and relevant:
            
      ${contextChain}`
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
        error: undefined,
      };

      return pluginResult;
    } catch (err: unknown) {
      log.error({ err }, "Error getting information about a Github repository");
      const pluginResult: PluginResult = {
        success: false,
        data: undefined,
        error: err instanceof Error ? err.message : String(err),
      };

      return pluginResult;
    }
  }
}
