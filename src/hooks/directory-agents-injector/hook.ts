import { processFilePathForAgentsInjection } from './injector';

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface ToolExecuteBeforeOutput {
  args: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

export function createDirectoryAgentsInjectorHook(directory: string) {
  const sessionCaches = new Map<string, Set<string>>();

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const toolName = input.tool.toLowerCase();

    if (toolName === 'read') {
      await processFilePathForAgentsInjection({
        directory,
        sessionCaches,
        filePath: output.title,
        sessionID: input.sessionID,
        output,
      });
    }
  };

  const toolExecuteBefore = async (
    _input: ToolExecuteInput,
    _output: ToolExecuteBeforeOutput,
  ): Promise<void> => {
    // Reserved for future use
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === 'session.deleted') {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        sessionCaches.delete(sessionInfo.id);
      }
    }

    if (event.type === 'session.compacted') {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        sessionCaches.delete(sessionID);
      }
    }
  };

  return {
    'tool.execute.before': toolExecuteBefore,
    'tool.execute.after': toolExecuteAfter,
    event: eventHandler,
  };
}
