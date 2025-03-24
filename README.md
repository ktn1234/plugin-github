# @ktn1234/plugin-github

This package is a plugin for the [Maiar](https://maiar.dev) ecosystem, designed to work with the `@maiar-ai/core` package.

## Documentation

For detailed documentation on how to use plugins, please refer to the [Maiar documentation](https://maiar.dev/docs).

## Overview

The GitHub plugin enables your Maiar agent to receive webhook events, describe webhook events and get information about a GitHub repository given a repository name and owner.

## Configuration

The GitHub plugin requires the following configuration:

```typescript
interface PluginGithubOptions {
  webhookOptions: Options<Schema> & { secret: string }; // GitHub webhook configuration options including the webhook secret
  describeGithubWebhookEventPrompt?: string; // Optional custom prompt to add to the description of the describe_github_webhook_event executor
  recievedGithubWebhookEventPrompt?: string; // Optional custom prompt to add to the received_github_webhook_event executor
  serverOptions?: {
    port: number; // The port to run the webhook server on (default: 3000)
    path: string; // The URL path to listen for webhook events (default: "/webhooks")
  }; // Optional configuration options for the webhook server (default: { port: 3000, path: "/webhooks" })
  octokitOptions?: OctokitOptions; // Optional configuration options for the Octokit (Github API) client
}
```

## Plugin Information

### Executors

- `describe_github_webhook_event`: Describes a GitHub webhook event in human-readable sentences, making it easier for users to understand what happened in the repository.

- `get_repo_info`: Gets information about a GitHub repository given a repository name and owner. The executor extracts the details from the context chain, providing access to repository metadata.

### Triggers

- `github_webhook_event_listener`: Listens for GitHub webhook events and processes them. Currently supports pull request, push, and release events.

## Webhook Events

The plugin processes the following webhook events:

- **Pull Requests**: Actions like opening, closing, or merging pull requests.
- **Push Events**: Code pushes to branches.
- **Release Events**: New releases published.

All other events are ignored. Please open an [issue](https://github.com/ktn1234/plugin-github/issues) or [PR](https://github.com/ktn1234/plugin-github/pulls) if you want to add support for other events.

## Usage

### Setting Up GitHub Webhooks

1. Create a webhook on your GitHub repository:

   - Go to your repository settings
   - Navigate to "Webhooks" and click "Add webhook"
   - Set the Payload URL to your server's endpoint (e.g., `http://your-server.com:3000/webhooks`)
   - Set Content type to `application/json`
   - Create a secret and provide it in your plugin configuration
   - Select the events you want to receive (pull requests, pushes, releases)

2. Configure your Maiar agent to use the GitHub plugin:

```typescript
import { createRuntime } from "@maiar-ai/core";
import { PluginGithub } from "@ktn1234/plugin-github";

const runtime = createRuntime({
  ...
  plugins: [
    new PluginGithub({
      webhookOptions: {
        secret: "your-webhook-secret",
      },
      serverOptions: {
        port: 3000,
        path: "/webhooks",
      },
    }),
  ],
});
```
