import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { getEnv } from "../../env";
import { logger } from "../../logger";
import type { AgentConfig } from "./agent-definitions/types";

/** One handler per tool name an `AgentConfig` declares — receives the tool call's arguments
 * already validated against that tool's `AgentToolDef.schema`, returns the text to hand back to
 * the model as the tool result. */
export type AgentToolHandlers = Record<string, (args: Record<string, unknown>) => Promise<string>>;

function buildModel<TPromptParams extends Record<string, unknown>, TOutput>(
  agentConfig: AgentConfig<TPromptParams, TOutput>,
): ChatBedrockConverse {
  const env = getEnv();
  const region = agentConfig.region ?? env.BEDROCK_AWS_REGION;
  if (!env.BEDROCK_API_KEY || !region) {
    throw new Error("BEDROCK_API_KEY/BEDROCK_AWS_REGION are not configured");
  }
  return new ChatBedrockConverse({
    model: agentConfig.model,
    region,
    // Bedrock API key (bearer token), not an IAM access key/secret pair — see env.ts's comment
    // on BEDROCK_API_KEY for why (these expire and need periodic rotation, unlike a typical IAM key).
    bedrockBearerToken: env.BEDROCK_API_KEY,
    temperature: agentConfig.temperature ?? 0,
  });
}

/**
 * General-purpose Bedrock chat runner — knows how to execute *any* `AgentConfig` (model/region/
 * temperature/prompt/tools/output schema), not just artifact enrichment. New agents are added by
 * dropping a new `agent-definitions/<name>/` folder and calling `run()` with it, not by writing
 * new Bedrock-calling code.
 *
 * The tool-calling loop is a manual `.bindTools()` loop, not `createReactAgent`/LangGraph
 * (docs/architecture/01 decision #25 already ruled out LangGraph for backend orchestration —
 * this keeps that decision's outer reliability loop, the plain outbox drain loop, cleanly
 * separate from this bounded, per-call, per-agent reasoning loop).
 */
export class BedrockChatService {
  async run<TPromptParams extends Record<string, unknown>, TOutput>(
    agentConfig: AgentConfig<TPromptParams, TOutput>,
    params: TPromptParams,
    toolHandlers: AgentToolHandlers = {},
  ): Promise<TOutput> {
    // Fail fast on a caller/prompt mismatch rather than silently sending `{undefined}` to the model.
    agentConfig.promptParameters.parse(params);

    const model = buildModel(agentConfig);
    const modelWithTools = agentConfig.tools?.length
      ? model.bindTools(agentConfig.tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })))
      : model;

    const messages: BaseMessage[] = await agentConfig.prompt.formatMessages(params);

    const maxTurns = agentConfig.maxToolTurns ?? 4;
    for (let turn = 0; turn < maxTurns; turn++) {
      const start = Date.now();
      const response = await modelWithTools.invoke(messages);
      logger.info(
        { model: agentConfig.model, turn, latencyMs: Date.now() - start, toolCalls: response.tool_calls?.length ?? 0 },
        "bedrock agent turn",
      );
      messages.push(response);

      if (!response.tool_calls?.length) break;

      for (const call of response.tool_calls) {
        const toolDef = agentConfig.tools?.find((t) => t.name === call.name);
        const handler = toolHandlers[call.name];
        let content: string;

        if (!toolDef || !handler) {
          content = `No handler registered for tool "${call.name}".`;
        } else {
          const parsedArgs = toolDef.schema.safeParse(call.args);
          content = parsedArgs.success
            ? await handler(parsedArgs.data)
            : `Invalid arguments for tool "${call.name}".`;
        }

        messages.push(new ToolMessage({ tool_call_id: call.id ?? call.name, content }));
      }
    }

    messages.push(new HumanMessage("Provide your final structured result now, covering everything you were asked for."));

    const start = Date.now();
    // withStructuredOutput's generic default (Record<string, any>) doesn't narrow from a plain
    // z.ZodType<TOutput> parameter — outputSchema.parse would have thrown by now if the shape
    // were wrong, so this cast just restores the type-level guarantee the schema already gives us.
    const result = (await model
      .withStructuredOutput(agentConfig.outputSchema, { name: "AgentOutput" })
      .invoke(messages)) as TOutput;
    logger.info({ model: agentConfig.model, latencyMs: Date.now() - start }, "bedrock agent final output");

    return result;
  }
}
