export function generateGithubWebhookEventDescriptionTemplate(
  contextChain: string
): string {
  return `Infer the following GitHub webhook event data of the activity that is happening in the repository rather than the event itself from the context chain:
      
    ${contextChain}
    
    When explaining the event, use the most recent Github webhook event data and ignore the rest.
    Do not explain how Github works or what a webhook is.
    Focus only on meaningful fields that indicate what action happened.
    Do not describe the repository itself and its metadata.
    Narrate it to a casual person who is not familiar with Github.
    Ignore unnecessary metadata or empty fields.
    `;
}
