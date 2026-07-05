import { callLLM } from './llm';

export async function parserAgent(code: string): Promise<string> {
  const system = 'You are a Senior Code Parser. Extract functions, classes, imports, and business logic. Return JSON.';
  return callLLM('parser', system, 'Parse this code:\n\n' + code);
}

export async function architectAgent(parsedData: string, targetFramework: string): Promise<string> {
  const system = 'You are a Software Architect. Design the target framework structure. Return JSON with routes, models, dependencies.';
  return callLLM('architect', system, 'Parsed data: ' + parsedData + '\nTarget: ' + targetFramework);
}

export async function devAgent(architectPlan: string, parsedData: string): Promise<string> {
  const system = 'You are a Senior Developer. Write executable code for the target framework. Output ONLY the code files.';
  return callLLM('developer', system, 'Architect Plan: ' + architectPlan + '\n\nParsed Data: ' + parsedData);
}

export async function qaAgent(generatedCode: string): Promise<string> {
  const system = 'You are a QA Engineer. Review the code for errors. Return JSON: { "approved": boolean, "feedback": string }';
  return callLLM('qa', system, 'Generated code:\n\n' + generatedCode);
}

export async function reviewerAgent(qaFeedback: string, generatedCode: string): Promise<string> {
  const system = 'You are a Senior Reviewer. Provide actionable fix instructions to the Dev agent.';
  return callLLM('reviewer', system, 'QA Feedback: ' + qaFeedback + '\n\nCode:\n' + generatedCode);
}
